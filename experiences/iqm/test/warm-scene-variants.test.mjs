import assert from 'node:assert/strict'
import test from 'node:test'
import { warmSceneVariants } from '../src/js/core/warm-scene-variants.js'

function fixture() {
  const mesh = { visible: false, frustumCulled: true }
  const material = { transparent: false, opacity: 1, depthWrite: true }
  const scene = { traverse: visit => visit(mesh) }
  return { mesh, material, scene }
}

test('warmup draws hidden effects and both fade variants, then restores gameplay state', async () => {
  const { mesh, material, scene } = fixture()
  const phases = []
  const renderer = {
    async compileAsync() { phases.push(['compile', material.transparent]) },
    render() {
      assert.equal(mesh.visible, true)
      assert.equal(mesh.frustumCulled, false)
      phases.push(['draw', material.transparent])
    }
  }
  await warmSceneVariants(renderer, scene, {}, { fadeMaterials: [material, material] })
  assert.deepEqual(phases, [['compile', false], ['draw', false], ['compile', true], ['draw', true]])
  assert.deepEqual(mesh, { visible: false, frustumCulled: true })
  assert.equal(material.transparent, false)
  assert.equal(material.opacity, 1)
  assert.equal(material.depthWrite, true)
})

test('a shader failure restores hidden objects and opaque materials before rollback', async () => {
  const { mesh, material, scene } = fixture()
  const renderer = { async compileAsync() { if (material.transparent) throw new Error('shader failed') }, render() {} }
  await assert.rejects(warmSceneVariants(renderer, scene, {}, { fadeMaterials: [material] }), /shader failed/)
  assert.equal(mesh.visible, false)
  assert.equal(material.transparent, false)
  assert.equal(material.opacity, 1)
  assert.equal(material.depthWrite, true)
})

test('leaving during compilation waits for its reader, then aborts without drawing', async () => {
  const { mesh, scene } = fixture()
  const controller = new AbortController()
  let finish, draws = 0
  const renderer = { compileAsync: () => new Promise(resolve => { finish = resolve }), render() { draws++ } }
  const warming = warmSceneVariants(renderer, scene, {}, { signal: controller.signal })
  controller.abort()
  finish()
  await assert.rejects(warming, { name: 'AbortError' })
  assert.equal(draws, 0)
  assert.equal(mesh.visible, false)
  assert.equal(mesh.frustumCulled, true)
})
