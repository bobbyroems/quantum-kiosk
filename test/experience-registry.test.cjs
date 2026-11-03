'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadExperienceRegistry, resolveExperiencePath } = require('../electron/experience-registry.cjs')
const { createRuntimeEnvelope, loadRuntimeConfig } = require('../electron/runtime-config.cjs')
const { createAppProtocolHandler, createAppUrl, resolveAppRequestPath } = require('../electron/content-protocol.cjs')
const fixtureBase = path.join(__dirname, '..', '.runtime', 'registry-tests', String(process.pid))
let sequence = 0
const entry = overrides => ({ id: 'sample', label: 'Sample experience', directory: 'experiences\\sample',
  defaultSource: '..\\sample-source', importProfile: 'unknown-profile', adapter: null, runtimeConfig: null, ...overrides })
function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  if (process.platform === 'win32' && !fs.existsSync(`${file}:Zone.Identifier`)) {
    fs.writeFileSync(`${file}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\n')
  }
}
function fixture(data = { version: 1, experiences: [entry()] }) {
  const root = path.join(fixtureBase, String(++sequence))
  write(path.join(root, 'experiences.json'), JSON.stringify(data))
  return root
}
const schema = experiences => ({ version: 1, experiences })

test('registry retains relative fields, freezes every entry, and accepts additional unknown profiles without adapters', () => {
  const values = [entry(), entry({ id: 'third', label: 'Third & final', directory: 'experiences\\nested\\third', importProfile: 'custom', adapter: 'not-installed' })]
  const registry = loadExperienceRegistry(fixture(schema(values)))
  assert.deepEqual(registry, values)
  assert.ok(Object.isFrozen(registry) && registry.every(Object.isFrozen))
  assert.deepEqual(loadExperienceRegistry(fixture(schema([]))), [])
})
test('registry rejects malformed schema, non-DNS IDs, reserved hosts, duplicate IDs and unsafe labels', () => {
  for (const data of [null, [], {}, { version: 2, experiences: [] }, { version: 1, experiences: {} },
    { version: 1, experiences: [], extra: true }, schema([{}]), schema([entry({ extra: true })]),
    ...['launcher', 'Sample', '-sample', 'sample-', 'a.b', '__proto__', 'a'.repeat(64), null].map(id => schema([entry({ id })])),
    schema([entry(), entry({ directory: 'experiences\\other' })]),
    ...['', ' padded ', '<script>', 'Line\nBreak', 'Bad\u202eLabel', null].map(label => schema([entry({ label })])),
    schema([entry({ importProfile: null })]), schema([entry({ adapter: {} })]), schema([entry({ defaultSource: null })])]) {
    assert.throws(() => loadExperienceRegistry(fixture(data)), undefined, JSON.stringify(data))
  }
})
test('registry rejects absolute, traversal, device, ADS, escaping and overlapping directories and runtime config paths', () => {
  for (const directory of ['launcher', 'experiences', '..\\sample', 'experiences\\..\\sample', 'experiences\\.\\sample',
    'C:\\outside', '\\\\server\\share', '/outside', 'experiences\\sample:stream', 'experiences\\sample.', 'experiences\\con', 'experiences\\\\sample']) {
    assert.throws(() => loadExperienceRegistry(fixture(schema([entry({ directory })]))), undefined, directory)
  }
  for (const runtimeConfig of ['..\\outside.json', 'config\\..\\file.json', 'C:\\secret.json', '/secret', 'file.json:stream', {}]) {
    assert.throws(() => loadExperienceRegistry(fixture(schema([entry({ runtimeConfig })]))), undefined, String(runtimeConfig))
  }
  for (const directory of ['EXPERIENCES\\SAMPLE', 'experiences\\sample\\child', 'experiences']) {
    assert.throws(() => loadExperienceRegistry(fixture(schema([entry(), entry({ id: 'other', directory })]))))
  }
})
test('directory, dist and config symlinks or junctions are refused', () => {
  for (const mode of ['directory', 'dist', 'config']) {
    const value = entry({ runtimeConfig: mode === 'config' ? 'config\\runtime.json' : null })
    const root = fixture(schema([value]))
    const target = path.join(root, 'outside')
    const link = mode === 'directory' ? path.join(root, 'experiences', 'sample') :
      path.join(root, 'experiences', 'sample', mode)
    fs.mkdirSync(target, { recursive: true })
    fs.mkdirSync(path.dirname(link), { recursive: true })
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => loadExperienceRegistry(root), /symlink|junction/)
  }
})
test('existing path components must have the expected directory or configuration-file type', () => {
  for (const relative of ['experiences', 'experiences\\sample', 'experiences\\sample\\dist']) {
    const root = fixture()
    write(path.join(root, ...relative.split('\\')), 'not a directory')
    assert.throws(() => loadExperienceRegistry(root), /component|ENOTDIR/)
  }
  const value = entry({ runtimeConfig: 'config\\runtime.json' })
  const root = fixture(schema([value]))
  fs.mkdirSync(resolveExperiencePath(root, value, value.runtimeConfig), { recursive: true })
  assert.throws(() => loadExperienceRegistry(root), /component/)
})
test('launcher-owned return adapters are registry-driven and preserve MAGNE cursor policy independently of imported files', () => {
  const values = [entry({ adapter: 'magne' }), entry({ id: 'renamed-iqm', directory: 'experiences\\renamed-iqm', adapter: 'iqm' }),
    entry({ id: 'plain', directory: 'experiences\\plain' })]
  const root = fixture(schema(values))
  const runtime = createRuntimeEnvelope(root, loadExperienceRegistry(root), { platform: 'win32', appVersion: '1.0.0', windowed: true })
  assert.deepEqual(runtime.documents[1].returnControl, { selector: '#attract-screen', activeClass: 'active', theme: 'magne' })
  assert.deepEqual(runtime.documents[1].cursorPolicy, { hideClass: 'kiosk-mode' })
  assert.deepEqual(runtime.documents[2].returnControl, { selector: '[data-screen="attract"]', activeClass: 'is-active', theme: 'iqm' })
  assert.equal(runtime.documents[0].returnControl, undefined)
  assert.equal(runtime.documents[3].returnControl, undefined)
  assert.equal(runtime.documents[2].cursorPolicy, undefined)
  assert.ok(Object.isFrozen(runtime.documents[1].returnControl))
})
test('per-entry runtime configuration is isolated and renamed experiences use production-safe defaults', () => {
  const values = [entry({ id: 'renamed', runtimeConfig: 'settings\\runtime.json' }),
    entry({ id: 'without-config', directory: 'experiences\\without-config' })]
  const root = fixture(schema(values))
  write(resolveExperiencePath(root, values[0], values[0].runtimeConfig), '{"kiosk":{"idleReturnToHomeMs":42000},"custom":{"theme":"local"}}')
  const registry = loadExperienceRegistry(root)
  const runtime = createRuntimeEnvelope(root, registry, { platform: 'win32', appVersion: '1.0.0', windowed: true })
  assert.equal(runtime.bridgeVersion, 1)
  assert.equal(runtime.isDevelopment, true)
  assert.equal(runtime.documents[1].config.kiosk.idleReturnToHomeMs, 42000)
  assert.equal(runtime.documents[1].config.kiosk.idleReturnToMenuMs, 120000)
  assert.deepEqual(runtime.documents[1].config.custom, { theme: 'local' })
  assert.deepEqual(runtime.documents[0].config, {})
  assert.deepEqual(runtime.documents[2].config, {})
  const warnings = []
  write(resolveExperiencePath(root, values[0], values[0].runtimeConfig), '{"kiosk":false}')
  const safe = loadRuntimeConfig(root, values[0], { warn: message => warnings.push(message) })
  assert.equal(safe.kiosk.idleReturnToHomeMs, 120000)
  assert.equal(warnings.length, 1)
})
test('hosting accepts explicit registered additional origins only and keeps protocol traversal defenses', async () => {
  const root = fixture()
  const roots = { launcher: path.join(root, 'launcher'), sample: path.join(root, 'experiences', 'sample', 'dist') }
  write(path.join(roots.sample, 'index.html'), 'sample')
  const hosts = Object.keys(roots)
  assert.equal(createAppUrl('sample', hosts), 'quantum-app://sample/index.html')
  assert.throws(() => createAppUrl('absent', hosts), /Unknown/)
  const handler = createAppProtocolHandler({ roots })
  assert.equal(await (await handler(new Request('quantum-app://sample/index.html'))).text(), 'sample')
  assert.equal((await handler(new Request('quantum-app://absent/index.html'))).status, 404)
  for (const url of ['quantum-app://sample/%2e%2e/experiences.json', 'quantum-app://sample/index.html:Zone.Identifier', 'quantum-app://constructor/index.html']) {
    assert.equal(resolveAppRequestPath(url, roots), null)
  }
})
