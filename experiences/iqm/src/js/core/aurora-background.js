/* Preserve the original CSS aurora's gradients and layer transforms inside a
   small bitmap. The compositor sees a stationary, screen-sized canvas rather
   than two oversized, rotating surfaces. Soft gradients need no device-DPI
   allocation; 360 × 640 is sufficient for their low-frequency colour field. */
const WIDTH = 360
const HEIGHT = 640
const FRAME_MS = 1000 / 30
const LAYER_WIDTH = WIDTH * 1.7
const LAYER_HEIGHT = HEIGHT * 1.7

function gradientSprite(rgb, alpha) {
  const sprite = document.createElement('canvas')
  sprite.width = sprite.height = 256
  const context = sprite.getContext('2d')
  if (!context) return null
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128)
  gradient.addColorStop(0, `rgba(${rgb}, ${alpha})`)
  gradient.addColorStop(1, `rgba(${rgb}, 0)`)
  context.fillStyle = gradient
  context.fillRect(0, 0, 256, 256)
  return sprite
}

/* CSS ease-in-out is cubic-bezier(.42, 0, .58, 1). Solve its x coordinate
   before sampling y so the original drift and breathing keep their timing. */
function easeInOut(progress) {
  let low = 0
  let high = 1
  for (let i = 0; i < 14; i += 1) {
    const t = (low + high) / 2
    const x = 3 * (1 - t) ** 2 * t * 0.42 + 3 * (1 - t) * t ** 2 * 0.58 + t ** 3
    if (x < progress) low = t
    else high = t
  }
  const t = (low + high) / 2
  return 3 * (1 - t) * t ** 2 + t ** 3
}

function drawEllipse(context, sprite, x, y, radiusX, radiusY) {
  context.drawImage(sprite, x - radiusX, y - radiusY, radiusX * 2, radiusY * 2)
}

export function mountAuroraBackgrounds(root = document) {
  const sprites = {
    blue: gradientSprite('0, 120, 212', 0.14),
    pink: gradientSprite('186, 28, 118', 0.08),
    purple: gradientSprite('122, 95, 212', 0.1)
  }
  if (Object.values(sprites).some(sprite => !sprite)) return null

  const entries = [...root.querySelectorAll('.screen--attract, .screen--menu')].flatMap(screen => {
    const canvas = document.createElement('canvas')
    canvas.className = 'aurora-background'
    canvas.width = WIDTH
    canvas.height = HEIGHT
    canvas.setAttribute('aria-hidden', 'true')
    const context = canvas.getContext('2d')
    if (!context) return []
    const menu = screen.classList.contains('screen--menu')
    screen.prepend(canvas)
    return [{ screen, canvas, context, driftSeconds: menu ? 14 : 12, orbitSeconds: menu ? 34 : 30 }]
  })
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  const startedAt = performance.now()
  let frame = null
  let lastPaintFrame = -1
  let disposed = false

  function paint(entry, seconds) {
    const { context, screen, driftSeconds, orbitSeconds } = entry
    const cycle = (seconds / driftSeconds) % 2
    const drift = easeInOut(cycle <= 1 ? cycle : 2 - cycle)
    const orbit = (seconds / orbitSeconds) % 1
    const scale = 1.05 + 0.25 * (1 - Math.abs(orbit * 2 - 1))
    // The menu scene publishes this inline in design pixels, avoiding a
    // computed-style or layout read in the paint loop.
    const parallax = motionPreference.matches ? 0 :
      (Number.parseFloat(screen.style.getPropertyValue('--aurora-parallax')) || 0) * WIDTH / 2160

    context.clearRect(0, 0, WIDTH, HEIGHT)
    context.save()
    context.translate(
      WIDTH / 2 + (-0.11 + 0.22 * drift) * LAYER_WIDTH + parallax,
      HEIGHT / 2 + (-0.07 + 0.15 * drift) * LAYER_HEIGHT
    )
    context.scale(1.04 + 0.2 * drift, 1.04 + 0.2 * drift)
    context.translate(-LAYER_WIDTH / 2, -LAYER_HEIGHT / 2)
    context.beginPath()
    context.rect(0, 0, LAYER_WIDTH, LAYER_HEIGHT)
    context.clip()
    context.globalAlpha = 0.85 + 0.15 * drift
    // CSS lists blue first, so it is composited over pink.
    drawEllipse(context, sprites.pink, LAYER_WIDTH * 0.22, LAYER_HEIGHT * 0.42,
      LAYER_WIDTH * 0.46 * 0.66, LAYER_HEIGHT * 0.36 * 0.66)
    drawEllipse(context, sprites.blue, LAYER_WIDTH * 0.76, LAYER_HEIGHT * 0.28,
      LAYER_WIDTH * 0.44 * 0.68, LAYER_HEIGHT * 0.30 * 0.68)
    context.restore()

    context.save()
    context.translate(WIDTH / 2, HEIGHT / 2)
    context.rotate(orbit * Math.PI * 2)
    context.scale(scale, scale)
    context.translate(-LAYER_WIDTH / 2, -LAYER_HEIGHT / 2)
    drawEllipse(context, sprites.purple, LAYER_WIDTH * 0.50, LAYER_HEIGHT * 0.30,
      LAYER_WIDTH * 0.34 * 0.72, LAYER_HEIGHT * 0.26 * 0.72)
    context.restore()
    if (!screen.classList.contains('has-aurora-background')) {
      screen.classList.add('has-aurora-background')
    }
  }

  function tick(now) {
    frame = null
    if (disposed || document.hidden) return
    const active = entries.filter(entry => entry.screen.classList.contains('is-active'))
    if (!active.length) return
    const paintFrame = Math.floor((now - startedAt) / FRAME_MS)
    if (paintFrame !== lastPaintFrame) {
      const seconds = motionPreference.matches ? 0 : (now - startedAt) / 1000
      active.forEach(entry => paint(entry, seconds))
      lastPaintFrame = paintFrame
    }
    if (!motionPreference.matches) frame = window.requestAnimationFrame(tick)
  }

  function sync() {
    if (frame !== null) window.cancelAnimationFrame(frame)
    lastPaintFrame = -1
    tick(performance.now())
  }

  // Class changes come from ScreenRouter. Freeze the outgoing frame for its
  // crossfade; hidden screens perform no drawing and retain only the bitmap.
  const observer = new MutationObserver(sync)
  entries.forEach(entry => observer.observe(entry.screen, { attributes: true, attributeFilter: ['class'] }))
  document.addEventListener('visibilitychange', sync)
  motionPreference.addEventListener('change', sync)
  sync()

  return {
    dispose() {
      disposed = true
      if (frame !== null) window.cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener('visibilitychange', sync)
      motionPreference.removeEventListener('change', sync)
      entries.forEach(({ canvas, screen }) => {
        canvas.remove()
        screen.classList.remove('has-aurora-background')
      })
    }
  }
}
