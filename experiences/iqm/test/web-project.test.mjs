import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8')
const manifest = JSON.parse(read('../package.json'))
const lock = JSON.parse(read('../package-lock.json'))

test('the standalone renderer pins its exact browser dependency lock', () => {
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), ['gsap', 'lottie-web', 'three'])
  assert.deepEqual(Object.keys(manifest.devDependencies), ['vite'])
  assert.equal(lock.name, manifest.name)
  assert.equal(lock.version, manifest.version)
  for (const field of ['name', 'version', 'engines', 'dependencies', 'devDependencies']) {
    assert.deepEqual(lock.packages[''][field], manifest[field])
  }
  for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
    assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/)
    assert.equal(lock.packages['node_modules/' + name].version, version)
  }
  for (const name of Object.keys(lock.packages)) assert.doesNotMatch(name, /electron|gltf-transform|concurrently|wait-on/)
})

test('the renderer retains web validation and no Electron wrappers', () => {
  assert.equal('main' in manifest, false)
  assert.equal('build' in manifest, false)
  assert.doesNotMatch(JSON.stringify(manifest.scripts), /electron|package:win|smoke:protocol/)
  assert.equal(manifest.scripts.dev, 'vite --host 127.0.0.1 --port 0')
  assert.match(read('../vite.config.js'), /host: '127\.0\.0\.1'/)
  assert.match(read('../vite.config.js'), /port: 0/)
  assert.match(read('../vite.config.js'), /dedupe: \['three'\]/)
  assert.match(read('../vite.config.js'), /exclude: \['three', 'three\/webgpu', 'three\/tsl'\]/)
  assert.equal(manifest.scripts['prebuild:renderer'], 'node scripts/check-media-assets.mjs public')
  assert.equal(manifest.scripts['postbuild:renderer'], 'node scripts/check-media-assets.mjs dist')
  assert.match(read('../scripts/check-syntax.mjs'), /const roots = \['scripts', 'src\/js', 'test'\]/)
  for (const relative of ['../electron', './app-protocol.test.mjs', './pro-runtime-mode.test.mjs']) {
    assert.equal(existsSync(new URL(relative, import.meta.url)), false)
  }
})
