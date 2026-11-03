'use strict'

const fsp = require('node:fs/promises')
const path = require('node:path')
const { Readable } = require('node:stream')

const APP_PROTOCOL_SCHEME = 'quantum-app'
const { loadExperienceRegistry, validId } = require('./experience-registry.cjs')
const defaultHosts = () => ['launcher', ...loadExperienceRegistry().map(entry => entry.id)]
const APP_PROTOCOL_PRIVILEGES = Object.freeze({ codeCache: true, secure: true, standard: true, stream: true, supportFetchAPI: true })
const CONTENT_TYPES = Object.freeze({
  '.bmp': 'image/bmp', '.css': 'text/css; charset=utf-8', '.exr': 'image/x-exr',
  '.fbx': 'application/octet-stream', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.hdr': 'image/vnd.radiance', '.htm': 'text/html; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
  '.mtl': 'text/plain; charset=utf-8', '.obj': 'text/plain; charset=utf-8', '.ogg': 'audio/ogg',
  '.otf': 'font/otf', '.png': 'image/png', '.svg': 'image/svg+xml', '.tga': 'image/x-tga',
  '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.wav': 'audio/wav',
  '.wasm': 'application/wasm', '.webm': 'video/webm', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.avif': 'image/avif', '.ico': 'image/x-icon'
})
const TRANSIENT_ERROR_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'UNKNOWN', 'EMFILE', 'ENFILE'])
const RETRY_DELAYS_MS = Object.freeze([25, 75, 200])
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

function createAppUrl(host = 'launcher', hosts = defaultHosts()) {
  if (!hosts.includes(host)) throw new TypeError('Unknown document host')
  return `${APP_PROTOCOL_SCHEME}://${host}/index.html`
}

function isWithinRoot(root, filePath) {
  const relative = path.relative(root, filePath)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function resolveAppRequestPath(requestUrl, roots) {
  let request
  try { request = new URL(requestUrl) } catch { return null }
  if (request.protocol !== `${APP_PROTOCOL_SCHEME}:` || request.username || request.password || request.port ||
      !Object.hasOwn(roots, request.hostname) || (request.hostname !== 'launcher' && !validId(request.hostname))) return null
  // Inspect the original path too: URL parsing normalizes literal and encoded dot segments.
  const raw = /^quantum-app:\/\/[^/\\?#]+(\/[^?#]*)?(?:[?#].*)?$/.exec(requestUrl)
  if (!raw) return null
  let decoded
  try { decoded = decodeURIComponent(raw[1] || '/') } catch { return null }
  if (/[\\\u0000:]/.test(decoded) || decoded.split('/').some(segment => segment === '..' || segment === '.')) return null
  const root = path.resolve(roots[request.hostname])
  const filePath = path.resolve(root, decoded.replace(/^\/+/, '') || 'index.html')
  return isWithinRoot(root, filePath) ? { host: request.hostname, root, filePath } : null
}

function contentTypeFor(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

async function withFileRetry(operation, { signal, delay = wait } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    signal?.throwIfAborted()
    try { return await operation() } catch (error) {
      if (!TRANSIENT_ERROR_CODES.has(error.code) || attempt >= RETRY_DELAYS_MS.length) throw error
      await delay(RETRY_DELAYS_MS[attempt])
    }
  }
}

function parseRangeHeader(value, size) {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || (match[1] === '' && match[2] === '')) return null
  const [, rawStart, rawEnd] = match
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (!Number.isSafeInteger(suffix) || suffix <= 0 || size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(rawStart)
  const requestedEnd = rawEnd === '' ? size - 1 : Number(rawEnd)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)) return 'unsatisfiable'
  const end = Math.min(requestedEnd, size - 1)
  return start >= size || start > end ? 'unsatisfiable' : { start, end }
}

async function bodyFor(filePath, method, range, signal, fileSystem, delay) {
  if (method === 'HEAD') return null
  const handle = await withFileRetry(() => fileSystem.open(filePath, 'r'), { signal, delay })
  try {
    signal?.throwIfAborted()
    const stream = handle.createReadStream(range ? { start: range.start, end: range.end } : {})
    const body = Readable.toWeb(stream)
    const abort = () => stream.destroy(signal.reason)
    signal?.addEventListener('abort', abort, { once: true })
    stream.once('close', () => signal?.removeEventListener('abort', abort))
    return body
  } catch (error) {
    await handle.close()
    throw error
  }
}

const FALLBACK_LAUNCHER = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quantum kiosk unavailable</title><style>body{font:24px system-ui;background:#fafaf8;color:#252525;margin:10%;line-height:1.5}h1{font-size:1.6em}</style><h1>Welcome screen unavailable</h1><p>Restore launcher\\index.html in the kiosk project and restart the shared shell.</p><p>No experiences have been started.</p></html>'

function createAppProtocolHandler({ roots, fileSystem = fsp, delay = wait, logger = console } = {}) {
  if (!roots || !Object.hasOwn(roots, 'launcher') || !Object.entries(roots).every(([host, root]) =>
    (host === 'launcher' || validId(host)) && typeof root === 'string' && root)) {
    throw new TypeError('A launcher root and valid registered document roots are required')
  }
  roots = Object.freeze({ ...roots })
  const textResponse = (message, status) => new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  const fallbackLauncher = request => new Response(request.method === 'HEAD' ? null : FALLBACK_LAUNCHER, {
    headers: { 'content-type': CONTENT_TYPES['.html'], 'content-length': String(Buffer.byteLength(FALLBACK_LAUNCHER)),
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'x-content-type-options': 'nosniff' }
  })
  return async request => {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
    const resolved = resolveAppRequestPath(request.url, roots)
    if (!resolved) return textResponse('Not found', 404)
    const isLauncherEntry = resolved.host === 'launcher' && resolved.filePath === path.join(resolved.root, 'index.html')
    let filePath
    let stats
    try {
      const retryOptions = { signal: request.signal, delay }
      const realRoot = await withFileRetry(() => fileSystem.realpath(resolved.root), retryOptions)
      filePath = await withFileRetry(() => fileSystem.realpath(resolved.filePath), retryOptions)
      if (!isWithinRoot(realRoot, filePath)) return textResponse('Not found', 404)
      stats = await withFileRetry(() => fileSystem.stat(filePath), retryOptions)
      if (!stats.isFile()) throw Object.assign(new Error('Not a file'), { code: 'ENOENT' })
    } catch (error) {
      if (request.signal?.aborted) return textResponse('Request cancelled', 499)
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) logger.error(`[protocol] File unavailable: ${error.code || error.message}`)
      return isLauncherEntry ? fallbackLauncher(request) : textResponse('Not found', 404)
    }
    const size = stats.size
    const headers = { 'accept-ranges': 'bytes', 'content-type': contentTypeFor(filePath),
      'last-modified': stats.mtime.toUTCString(), 'x-content-type-options': 'nosniff' }
    const range = parseRangeHeader(request.headers.get('range'), size)
    if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } })
    try {
      const body = await bodyFor(filePath, request.method, range, request.signal, fileSystem, delay)
      return new Response(body, {
        status: range ? 206 : 200,
        headers: range ? { ...headers, 'content-length': String(range.end - range.start + 1),
          'content-range': `bytes ${range.start}-${range.end}/${size}` } : { ...headers, 'content-length': String(size) }
      })
    } catch (error) {
      if (request.signal?.aborted) return textResponse('Request cancelled', 499)
      logger.error(`[protocol] File could not be opened: ${error.code || error.message}`)
      return isLauncherEntry ? fallbackLauncher(request) : textResponse('Unavailable', 503)
    }
  }
}

module.exports = { APP_PROTOCOL_PRIVILEGES, APP_PROTOCOL_SCHEME, CONTENT_TYPES,
  RETRY_DELAYS_MS, contentTypeFor, createAppProtocolHandler, createAppUrl, isWithinRoot, parseRangeHeader,
  resolveAppRequestPath, withFileRetry }
