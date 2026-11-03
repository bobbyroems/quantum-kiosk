'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { getWindowedBounds, hasDisplayOverride, selectDisplay } = require('../electron/display.cjs')
const display = (id, label, width, height, extra = {}) => ({ id, label, bounds: { x: 0, y: 0, width, height }, ...extra })
const laptop = display(1, 'Laptop', 1920, 1080)
const elo = display(2, 'Elo Touch', 2160, 3840, { touchSupport: 'available' })
const landscapeElo = display(3, 'Elo Landscape', 3840, 2160, { touchSupport: 'available' })

test('portrait Elo is selected whether primary or secondary', () => {
  assert.equal(selectDisplay([laptop, landscapeElo, elo], laptop), elo)
  assert.equal(selectDisplay([laptop, landscapeElo, elo], elo), elo)
})
test('explicit ID, zero-based INDEX, and case-insensitive LABEL overrides have priority', () => {
  const displays = [laptop, elo, landscapeElo]
  assert.equal(selectDisplay(displays, laptop, { KIOSK_DISPLAY_ID: '1', KIOSK_DISPLAY_INDEX: '1', KIOSK_DISPLAY_LABEL: 'elo' }), laptop)
  assert.equal(selectDisplay(displays, laptop, { KIOSK_DISPLAY_INDEX: '0', KIOSK_DISPLAY_LABEL: 'elo' }), laptop)
  assert.equal(selectDisplay(displays, laptop, { KIOSK_DISPLAY_LABEL: 'LANDSCAPE' }), landscapeElo)
  assert.equal(selectDisplay(displays, laptop, { KIOSK_DISPLAY_LABEL: 'ELO' }), elo)
})
test('invalid overrides fall through deterministically instead of indexing coercible strings', () => {
  for (const index of ['-1', '1.5', 'Infinity', '0x0', '999', '']) {
    assert.equal(selectDisplay([laptop, elo], laptop, { KIOSK_DISPLAY_ID: 'missing', KIOSK_DISPLAY_INDEX: index }), elo)
  }
  assert.equal(selectDisplay([laptop, elo], laptop, { KIOSK_DISPLAY_LABEL: 'missing' }), elo)
  assert.equal(hasDisplayOverride({ KIOSK_DISPLAY_INDEX: '0' }), true)
  assert.equal(hasDisplayOverride({ KIOSK_DISPLAY_LABEL: ' ' }), false)
})
test('portrait touch and high-DPI native dimensions rank above ordinary screens', () => {
  const portrait = display(4, 'Portrait', 1080, 1920, { scaleFactor: 2, touchSupport: 'available' })
  assert.equal(selectDisplay([laptop, portrait], laptop), portrait)
  assert.equal(selectDisplay([], laptop), laptop)
  assert.throws(() => selectDisplay([], null), /No displays/)
})
test('windowed mode fits a centered portrait window within the work area', () => {
  const target = { ...laptop, workArea: { x: -1920, y: 20, width: 1920, height: 1000 } }
  const bounds = getWindowedBounds(target)
  assert.ok(bounds.width > 0 && bounds.height > 0)
  assert.ok(bounds.width <= target.workArea.width && bounds.height <= target.workArea.height)
  assert.ok(Math.abs(bounds.width / bounds.height - 9 / 16) < 0.002)
  assert.ok(bounds.x >= -1920 && bounds.y >= 20)
})
