'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createPackagingConfig } = require('../scripts/package-win.cjs')
const base = path.join(__dirname, '..', '.runtime', 'packaging-tests', String(process.pid))
let sequence = 0

function write(file, content = 'fixture') {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function fixture(t) {
  const root = path.join(base, String(++sequence))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const entry = { id: 'custom', label: 'Custom', directory: 'experiences\\nested\\custom',
    defaultSource: '..\\source', importProfile: 'custom', adapter: null, runtimeConfig: 'config\\runtime.json' }
  write(path.join(root, 'experiences.json'), JSON.stringify({ version: 1, experiences: [entry] }))
  write(path.join(root, 'launcher', 'index.html'))
  write(path.join(root, entry.directory, 'config', 'runtime.json'), '{"design":{"width":2160,"height":3840}}')
  for (const file of ['index.html', 'assets\\font.woff2', 'assets\\module\\model.obj', 'assets\\video.mp4']) {
    write(path.join(root, entry.directory, 'dist', file))
  }
  return { root, entry }
}

function copyPayload(root, config, output) {
  for (const mapping of config.extraResources) {
    const destination = path.join(output, 'resources', mapping.to)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.cpSync(path.join(root, mapping.from), destination, { recursive: true })
  }
}

test('portable package targets Windows x64 and includes only shell code and registry-selected runtime content', t => {
  const { root } = fixture(t)
  const config = createPackagingConfig(root)
  assert.deepEqual(config.win.target, [{ target: 'portable', arch: ['x64'] }])
  assert.equal(config.portable.requestExecutionLevel, 'user')
  assert.equal(config.portable.useZip, true)
  assert.match(config.portable.artifactName, /portable/)
  assert.equal(config.asar, true)
  assert.equal(config.compression, 'store')
  assert.deepEqual(config.files, ['electron/**/*', 'package.json'])
  assert.deepEqual(config.extraResources.map(entry => entry.from), ['experiences.json', 'launcher',
    'experiences/nested/custom/dist', 'experiences/nested/custom/config/runtime.json'])
  assert.ok(config.extraResources[2].filter.includes('**/*.obj'))
  assert.ok(config.extraResources.every(entry => entry.to.startsWith('app-content/')))
})

test('packaging fails explicitly for missing builds or missing/invalid runtime configuration', t => {
  for (const missing of ['dist\\index.html', 'config\\runtime.json']) {
    const { root, entry } = fixture(t)
    fs.unlinkSync(path.join(root, entry.directory, missing))
    assert.throws(() => createPackagingConfig(root), /Required kiosk content is missing/)
  }
  const { root, entry } = fixture(t)
  write(path.join(root, entry.directory, 'config', 'runtime.json'), '[]')
  assert.throws(() => createPackagingConfig(root), /Invalid runtime configuration/)
})

test('post-pack check verifies all media and model files and rejects omitted or truncated content', async t => {
  const { root, entry } = fixture(t)
  const config = createPackagingConfig(root)
  const appOutDir = path.join(root, 'output')
  copyPayload(root, config, appOutDir)
  await config.afterPack({ appOutDir })
  const model = path.join(appOutDir, 'resources', 'app-content', entry.directory, 'dist', 'assets', 'module', 'model.obj')
  fs.unlinkSync(model)
  await assert.rejects(config.afterPack({ appOutDir }), /Required kiosk content is missing/)
  write(model, 'truncated')
  await assert.rejects(config.afterPack({ appOutDir }), /content size mismatch/)
})
