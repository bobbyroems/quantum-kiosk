'use strict'

function hasDisplayOverride(env = {}) {
  return ['KIOSK_DISPLAY_ID', 'KIOSK_DISPLAY_INDEX', 'KIOSK_DISPLAY_LABEL']
    .some(key => env[key] !== undefined && String(env[key]).trim() !== '')
}

function selectDisplay(displays, primaryDisplay, env = {}) {
  if (!displays.length) {
    if (primaryDisplay) return primaryDisplay
    throw new Error('No displays are available')
  }
  const id = String(env.KIOSK_DISPLAY_ID ?? '').trim()
  if (id) {
    const match = displays.find(display => String(display.id) === id)
    if (match) return match
  }
  const index = String(env.KIOSK_DISPLAY_INDEX ?? '').trim()
  if (/^\d+$/.test(index) && displays[Number(index)]) return displays[Number(index)]
  const label = String(env.KIOSK_DISPLAY_LABEL ?? '').trim().toLowerCase()
  const candidates = label
    ? displays.filter(display => String(display.label || '').toLowerCase().includes(label))
    : []
  const ranked = candidates.length ? candidates : displays
  const score = display => {
    const portrait = display.bounds.height > display.bounds.width
    const elo = /elo/i.test(display.label || '')
    const scale = display.scaleFactor || 1
    const nativePortrait = Math.round(display.bounds.width * scale) === 2160 &&
      Math.round(display.bounds.height * scale) === 3840
    return (elo && portrait ? 64 : 0) + (elo ? 16 : 0) + (portrait ? 8 : 0) +
      (display.touchSupport === 'available' ? 4 : 0) + (nativePortrait ? 2 : 0) +
      (display.id === primaryDisplay?.id ? 0 : 1)
  }
  return [...ranked].sort((left, right) => score(right) - score(left) ||
    right.bounds.width * right.bounds.height - left.bounds.width * left.bounds.height)[0]
}

function getWindowedBounds(display) {
  const area = display.workArea || display.bounds
  const height = Math.max(1, Math.min(960, area.height - 48, (area.width - 48) * 16 / 9))
  const width = Math.max(1, Math.round(height * 9 / 16))
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height: Math.round(height)
  }
}

module.exports = { getWindowedBounds, hasDisplayOverride, selectDisplay }
