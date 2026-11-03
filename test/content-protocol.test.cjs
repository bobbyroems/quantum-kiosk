'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { Readable } = require('node:stream')
const { APP_PROTOCOL_PRIVILEGES, contentTypeFor, createAppProtocolHandler, createAppUrl,
  parseRangeHeader, resolveAppRequestPath, withFileRetry } = require('../electron/content-protocol.cjs')
const roots = Object.fromEntries(['launcher', 'magne', 'iqm'].map(host => [host, path.resolve(__dirname, 'fixture-not-written', host)]))
const missing = () => Object.assign(new Error('Missing file'), { code: 'ENOENT' })
function memoryFiles(files, { openFailures = [], realPaths = {} } = {}) {
  let opens = 0
  let closed = 0
  const streams = []
  const fileSystem = {
    async realpath(filePath) {
      if (Object.values(roots).includes(filePath) || files[filePath]) return realPaths[filePath] || filePath
      throw missing()
    },
    async stat(filePath) {
      if (!files[filePath]) throw missing()
      return { size: files[filePath].length, mtime: new Date('2026-01-01T00:00:00Z'), isFile: () => true }
    },
    async open(filePath) {
      const failure = openFailures[opens++]
      if (failure) throw Object.assign(new Error(failure), { code: failure })
      if (!files[filePath]) throw missing()
      return {
        async close() { closed += 1 },
        createReadStream(options) {
          const data = files[filePath].subarray(options.start || 0, options.end === undefined ? undefined : options.end + 1)
          const stream = Readable.from([data])
          stream.once('close', () => { closed += 1 })
          streams.push(stream)
          return stream
        }
      }
    }
  }
  return { fileSystem, streams, opens: () => opens, closed: () => closed }
}
const request = (url, { method = 'GET', range, signal } = {}) => ({ url, method, headers: new Headers(range ? { range } : {}), signal })
const silentLogger = { error() {} }

test('secure standard isolated hosts map root-relative assets only within assigned roots', () => {
  assert.equal(APP_PROTOCOL_PRIVILEGES.secure, true)
  assert.equal(APP_PROTOCOL_PRIVILEGES.standard, true)
  assert.equal(APP_PROTOCOL_PRIVILEGES.stream, true)
  for (const host of ['launcher', 'magne', 'iqm']) {
    assert.equal(createAppUrl(host), `quantum-app://${host}/index.html`)
    assert.deepEqual(resolveAppRequestPath(`quantum-app://${host}/assets/clip%20one.mp4?version=1`, roots),
      { host, root: roots[host], filePath: path.join(roots[host], 'assets', 'clip one.mp4') })
    assert.equal(resolveAppRequestPath(`quantum-app://${host}/`, roots).filePath, path.join(roots[host], 'index.html'))
  }
  assert.throws(() => createAppUrl('../iqm'), /Unknown/)
})
test('unknown hosts, foreign schemes, malformed encoding, traversal, backslashes, ADS and credentials are rejected', () => {
  for (const url of ['quantum-app://other/index.html', 'https://iqm/index.html', 'file:///index.html',
    'quantum-app://iqm/%', 'quantum-app://iqm/../secret', 'quantum-app://iqm/%2e%2e/secret',
    'quantum-app://iqm/assets/%2e%2e%2fsecret', 'quantum-app://iqm/%5csecret',
    'quantum-app://iqm/C%3a/secret', 'quantum-app://iqm/clip.mp4%3aZone.Identifier',
    'quantum-app://iqm/%00', 'quantum-app://user@iqm/index.html', 'quantum-app://iqm:443/index.html']) {
    assert.equal(resolveAppRequestPath(url, roots), null, url)
  }
})
test('range parser supports inclusive, open-ended and suffix ranges, with correct invalid handling', () => {
  assert.deepEqual(parseRangeHeader('bytes=2-5', 10), { start: 2, end: 5 })
  assert.deepEqual(parseRangeHeader('bytes=5-', 10), { start: 5, end: 9 })
  assert.deepEqual(parseRangeHeader('bytes=-4', 10), { start: 6, end: 9 })
  assert.deepEqual(parseRangeHeader('bytes=-20', 10), { start: 0, end: 9 })
  assert.deepEqual(parseRangeHeader('bytes=2-99', 10), { start: 2, end: 9 })
  for (const value of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=9007199254740992-']) assert.equal(parseRangeHeader(value, 10), 'unsatisfiable')
  assert.equal(parseRangeHeader('bytes=0-', 0), 'unsatisfiable')
  for (const value of [null, '', 'bytes=-', 'bytes=0-1,3-4', 'items=1-2']) assert.equal(parseRangeHeader(value, 10), null)
})
test('module, video, model, font and uppercase MIME types remain correct', () => {
  assert.equal(contentTypeFor('clip.MP4'), 'video/mp4')
  assert.equal(contentTypeFor('module.mjs'), 'text/javascript; charset=utf-8')
  assert.equal(contentTypeFor('mesh.GLB'), 'model/gltf-binary')
  assert.equal(contentTypeFor('font.woff2'), 'font/woff2')
  assert.equal(contentTypeFor('unknown.ext'), 'application/octet-stream')
})
test('GET, HEAD, 206 and 416 responses preserve seekable media headers and stream bytes', async () => {
  const media = path.join(roots.iqm, 'clip.mp4')
  const memory = memoryFiles({ [media]: Buffer.from('0123456789') })
  const handler = createAppProtocolHandler({ roots, fileSystem: memory.fileSystem })
  const full = await handler(request('quantum-app://iqm/clip.mp4'))
  assert.equal(full.status, 200)
  assert.equal(full.headers.get('accept-ranges'), 'bytes')
  assert.equal(full.headers.get('content-length'), '10')
  assert.equal(full.headers.get('content-type'), 'video/mp4')
  assert.equal(await full.text(), '0123456789')
  const partial = await handler(request('quantum-app://iqm/clip.mp4', { range: 'bytes=2-5' }))
  assert.equal(partial.status, 206)
  assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10')
  assert.equal(partial.headers.get('content-length'), '4')
  assert.equal(await partial.text(), '2345')
  const suffix = await handler(request('quantum-app://iqm/clip.mp4', { range: 'bytes=-3' }))
  assert.equal(await suffix.text(), '789')
  const beforeHead = memory.opens()
  const head = await handler(request('quantum-app://iqm/clip.mp4', { method: 'HEAD', range: 'bytes=5-' }))
  assert.equal(head.status, 206)
  assert.equal(head.headers.get('content-length'), '5')
  assert.equal(await head.text(), '')
  assert.equal(memory.opens(), beforeHead)
  const unsatisfiable = await handler(request('quantum-app://iqm/clip.mp4', { range: 'bytes=10-' }))
  assert.equal(unsatisfiable.status, 416)
  assert.equal(unsatisfiable.headers.get('content-range'), 'bytes */10')
  const wrongMethod = await handler(request('quantum-app://iqm/clip.mp4', { method: 'POST' }))
  assert.equal(wrongMethod.status, 405)
})
test('host roots do not share assets and realpath checks refuse escaping symlinks', async () => {
  const iqmFile = path.join(roots.iqm, 'private.js')
  const memory = memoryFiles({ [iqmFile]: Buffer.from('private') }, { realPaths: { [iqmFile]: path.resolve(roots.iqm, '..', 'outside.js') } })
  const handler = createAppProtocolHandler({ roots, fileSystem: memory.fileSystem })
  assert.equal((await handler(request('quantum-app://magne/private.js'))).status, 404)
  assert.equal((await handler(request('quantum-app://iqm/private.js'))).status, 404)
  assert.equal(memory.opens(), 0)
})
test('missing launcher gets a static recovery document, not an invisible experience', async () => {
  const memory = memoryFiles({})
  const handler = createAppProtocolHandler({ roots, fileSystem: memory.fileSystem })
  const launcher = await handler(request(createAppUrl('launcher')))
  assert.equal(launcher.status, 200)
  assert.match(await launcher.text(), /Welcome screen unavailable/)
  assert.equal((await handler(request(createAppUrl('iqm')))).status, 404)
  assert.equal(memory.opens(), 0)
})
test('an unreadable launcher entry still serves the safe recovery document after retries', async () => {
  const entry = path.join(roots.launcher, 'index.html')
  const memory = memoryFiles({ [entry]: Buffer.from('launcher') }, { openFailures: ['EPERM', 'EPERM', 'EPERM', 'EPERM'] })
  const handler = createAppProtocolHandler({ roots, fileSystem: memory.fileSystem, delay: async () => {}, logger: silentLogger })
  const response = await handler(request(createAppUrl('launcher')))
  assert.equal(response.status, 200)
  assert.match(await response.text(), /Welcome screen unavailable/)
  assert.equal(memory.opens(), 4)
})
test('scanner locks are retried before headers; permanent failures and exhausted retries remain recoverable', async () => {
  const file = path.join(roots.iqm, 'clip.mp4')
  const memory = memoryFiles({ [file]: Buffer.from('video') }, { openFailures: ['EPERM', 'EBUSY'] })
  const delays = []
  const handler = createAppProtocolHandler({ roots, fileSystem: memory.fileSystem, delay: async ms => delays.push(ms) })
  const response = await handler(request('quantum-app://iqm/clip.mp4'))
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'video')
  assert.deepEqual(delays, [25, 75])
  assert.equal(memory.opens(), 3)
  const failed = memoryFiles({ [file]: Buffer.from('video') }, { openFailures: ['EACCES', 'EACCES', 'EACCES', 'EACCES'] })
  const unavailable = await createAppProtocolHandler({ roots, fileSystem: failed.fileSystem, delay: async () => {}, logger: silentLogger })(request('quantum-app://iqm/clip.mp4'))
  assert.equal(unavailable.status, 503)
  assert.equal(failed.opens(), 4)
  let attempts = 0
  await assert.rejects(withFileRetry(async () => { attempts++; throw missing() }, { delay: async () => {} }), { code: 'ENOENT' })
  assert.equal(attempts, 1)
})
test('cancelling a seek destroys the source stream and closes its file handle', async () => {
  const file = path.join(roots.iqm, 'clip.mp4')
  const memory = memoryFiles({ [file]: Buffer.alloc(1024) })
  const handler = createAppProtocolHandler({ roots, fileSystem: memory.fileSystem })
  const response = await handler(request('quantum-app://iqm/clip.mp4'))
  await response.body.cancel()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(memory.streams[0].destroyed, true)
  assert.equal(memory.closed(), 1)
})
test('abort signals cancel a still-streaming seek and close the source', async () => {
  const file = path.join(roots.iqm, 'clip.mp4')
  const memory = memoryFiles({ [file]: Buffer.alloc(1024) })
  let stream
  memory.fileSystem.open = async () => ({
    async close() {},
    createReadStream() { stream = new Readable({ read() {} }); return stream }
  })
  const controller = new AbortController()
  const response = await createAppProtocolHandler({ roots, fileSystem: memory.fileSystem })(
    request('quantum-app://iqm/clip.mp4', { signal: controller.signal }))
  const reading = response.text()
  controller.abort(new Error('Seek superseded'))
  await assert.rejects(reading, /Seek superseded/)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(stream.destroyed, true)
})
test('aborted requests never open files or leave live streams', async () => {
  const controller = new AbortController()
  controller.abort()
  const memory = memoryFiles({})
  const response = await createAppProtocolHandler({ roots, fileSystem: memory.fileSystem })(request(createAppUrl('iqm'), { signal: controller.signal }))
  assert.equal(response.status, 499)
  assert.equal(memory.opens(), 0)
})
