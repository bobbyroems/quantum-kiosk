import test from 'node:test'
import assert from 'node:assert/strict'
import { createNanoscaleRasterRefresh } from '../src/js/modules/nanoscale/nanoscale-presentation.js'
import { visibleFramebufferRegion } from '../src/js/core/visible-framebuffer-region.js'

test('zoom refresh restores promotion on the next frame and limits repaint frequency', () => {
  const refresh = createNanoscaleRasterRefresh()
  assert.equal(refresh(0, 1, 0, false), false)
  assert.equal(refresh(0, 1.6, 200, true), true)
  assert.equal(refresh(0, 1.8, 216, true), false)
  assert.equal(refresh(0, 3, 250, true), false)
  assert.equal(refresh(0, 3, 400, true), true)
  assert.equal(refresh(0, 3, 416, false), false)
  assert.equal(refresh(1, 1, 600, true), false)
})

test('a quick flick can sharpen before the first interval elapses', () => {
  const refresh = createNanoscaleRasterRefresh()
  refresh(0, 1, 0, false)
  assert.equal(refresh(0, 1.6, 50, true), true)
  assert.equal(refresh(0, 1.8, 66, true), false)
  assert.equal(refresh(0, 3, 100, true), false)
})

test('framebuffer crop uses bottom-left pixels and retains the full blur guard band', () => {
  const canvas = { left: -100, right: 1100, top: -750, bottom: 2000, width: 1200, height: 2750 }
  const stage = { left: 0, right: 1080, top: 0, bottom: 1920 }
  assert.deepEqual(visibleFramebufferRegion(1200, 2750, canvas, stage, 9), {
    x: 91, y: 71, width: 1098, height: 1938
  })
  assert.deepEqual(visibleFramebufferRegion(600, 1375, canvas, stage, 9), {
    x: 41, y: 31, width: 558, height: 978
  })
})

test('framebuffer cropping keeps an unclipped scene intact and handles offstage canvases', () => {
  const canvas = { left: 0, right: 100, top: 0, bottom: 100, width: 100, height: 100 }
  assert.deepEqual(visibleFramebufferRegion(100, 100, canvas, canvas, 9), {
    x: 0, y: 0, width: 100, height: 100
  })
  assert.deepEqual(visibleFramebufferRegion(100, 100, canvas, { left: 200, right: 300, top: 0, bottom: 100 }, 9), {
    x: 0, y: 0, width: 0, height: 0
  })
})
