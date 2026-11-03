export const VFX_MOTION_WIDTH = 540
export const VFX_MOTION_HEIGHT = 960
export const VFX_MOTION_FPS = 24

const TAU = Math.PI * 2
const DEFAULT_SEED = 0x51a7e03

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function clamp01(value) {
  return Math.min(1, Math.max(0, finiteNumber(value)))
}

function wrap01(value) {
  return ((value % 1) + 1) % 1
}

function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function freezeItems(items) {
  items.forEach(Object.freeze)
  return Object.freeze(items)
}

/**
 * Builds a deterministic field once. Timeline weights only reveal this field,
 * so dragging backwards produces the exact inverse instead of new random VFX.
 */
export function createVfxField(seed = DEFAULT_SEED) {
  const random = seededRandom(finiteNumber(seed, DEFAULT_SEED))
  /* Painted droplets and frost crystals used to live here. Both are now the
     shader's job — the crystals read as small fern-like ticks scattered over the
     panel, and the droplets doubled up with the refracting rain field — so this
     layer contributes only the drifting mist. */
  const mistLayers = [0, 1].map(layer => {
    const blobs = []
    for (let index = 0; index < 5; index += 1) {
      blobs.push({
        x: random(),
        y: 0.1 + (random() * 0.8),
        radius: 0.17 + (random() * 0.18),
        stretch: 0.55 + (random() * 0.45),
        phase: random() * TAU
      })
    }
    return Object.freeze({
      direction: layer === 0 ? 1 : -1,
      speed: layer === 0 ? 0.0065 : 0.0038,
      drift: layer === 0 ? 0.016 : 0.024,
      opacity: layer === 0 ? 0.09 : 0.065,
      blobs: freezeItems(blobs)
    })
  })

  return Object.freeze({
    mistLayers: Object.freeze(mistLayers)
  })
}

export const DEFAULT_VFX_FIELD = createVfxField()

export function clampVfxWeights(weights = {}) {
  return Object.freeze({
    frost: clamp01(weights.frost),
    water: clamp01(weights.water ?? weights.condensation),
    fog: clamp01(weights.fog)
  })
}

/**
 * Pure render snapshot shared by canvas rendering and inspection tools. Ambient time
 * only changes local accents; all macro visibility comes from scrub weights.
 */
export function createVfxSnapshot(
  weights,
  ambientMs = 0,
  { field = DEFAULT_VFX_FIELD, reducedMotion = false } = {}
) {
  const safeWeights = clampVfxWeights(weights)
  const timeSeconds = reducedMotion ? 0 : Math.max(0, finiteNumber(ambientMs)) / 1000

  const mistLayers = field.mistLayers.map(layer => ({
    opacity: safeWeights.fog * layer.opacity,
    blobs: layer.blobs.map(blob => ({
      ...blob,
      x: wrap01(blob.x + (timeSeconds * layer.speed * layer.direction)),
      y: blob.y + (Math.sin((timeSeconds * 0.16) + blob.phase) * layer.drift)
    }))
  }))

  return {
    weights: safeWeights,
    ambientMs: timeSeconds * 1000,
    mistLayers
  }
}



function drawMistBlob(ctx, blob, opacity, width, height) {
  if (opacity <= 0.001) return
  const radius = blob.radius * width
  const drawAt = xOffset => {
    const x = (blob.x * width) + xOffset
    const y = blob.y * height
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(1, blob.stretch)
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius)
    gradient.addColorStop(0, `rgba(245, 250, 255, ${opacity})`)
    gradient.addColorStop(0.48, `rgba(235, 246, 255, ${opacity * 0.48})`)
    gradient.addColorStop(1, 'rgba(230, 244, 255, 0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(0, 0, radius, 0, TAU)
    ctx.fill()
    ctx.restore()
  }

  drawAt(0)
  if (blob.x < blob.radius) drawAt(width)
  if (blob.x > 1 - blob.radius) drawAt(-width)
}

export function renderVfxSnapshot(ctx, snapshot, width, height) {
  ctx.clearRect(0, 0, width, height)
  ctx.globalCompositeOperation = 'source-over'

  snapshot.mistLayers.forEach(layer => {
    layer.blobs.forEach(blob => drawMistBlob(ctx, blob, layer.opacity, width, height))
  })
}

/**
 * Owns the module's single animation loop. Rendering pauses when the document
 * is hidden, the module is offscreen, motion is reduced, or dispose is called.
 */
export function createMatterVfxMotion(canvas, options = {}) {
  const context = canvas?.getContext?.('2d', { alpha: true, desynchronized: true })
  if (!context) throw new TypeError('States of Matter VFX requires a 2D canvas')

  const requestFrame = options.requestAnimationFrameFn ?? globalThis.requestAnimationFrame?.bind(globalThis)
  const cancelFrame = options.cancelAnimationFrameFn ?? globalThis.cancelAnimationFrame?.bind(globalThis)
  const now = options.nowFn ?? (() => globalThis.performance?.now?.() ?? Date.now())
  const documentTarget = options.documentTarget ?? globalThis.document
  const matchMedia = options.matchMediaFn ?? globalThis.matchMedia?.bind(globalThis)
  const Observer = Object.hasOwn(options, 'IntersectionObserverCtor')
    ? options.IntersectionObserverCtor
    : globalThis.IntersectionObserver
  const drawFrame = options.drawFrameFn ?? renderVfxSnapshot
  const field = options.field ?? DEFAULT_VFX_FIELD
  const frameInterval = 1000 / VFX_MOTION_FPS
  const mediaQuery = matchMedia?.('(prefers-reduced-motion: reduce)') ?? null

  let weights = clampVfxWeights(options.initialWeights ?? { frost: 1, water: 0, fog: 0 })
  let ambientMs = 0
  let lastTickAt = null
  let lastDrawAt = now()
  let frameId = null
  let intersecting = true
  let dirty = true
  let disposed = false
  let reducedMotion = Boolean(mediaQuery?.matches)
  let interactionActive = false

  const isDocumentVisible = () => documentTarget?.hidden !== true
  const shouldAnimate = () => (
    !disposed &&
    !reducedMotion &&
    !interactionActive &&
    intersecting &&
    isDocumentVisible()
  )

  const renderNow = () => {
    if (disposed || !intersecting || !isDocumentVisible()) return
    const snapshot = createVfxSnapshot(weights, ambientMs, { field, reducedMotion })
    drawFrame(context, snapshot, canvas.width, canvas.height)
    dirty = false
  }

  const schedule = () => {
    if (frameId !== null || !shouldAnimate() || typeof requestFrame !== 'function') return
    frameId = requestFrame(tick)
  }

  const stop = () => {
    if (frameId !== null && typeof cancelFrame === 'function') cancelFrame(frameId)
    frameId = null
    lastTickAt = null
  }

  function tick(timestamp) {
    frameId = null
    if (!shouldAnimate()) return

    const time = finiteNumber(timestamp, now())
    if (lastTickAt !== null) ambientMs += Math.min(100, Math.max(0, time - lastTickAt))
    lastTickAt = time

    if (dirty || time - lastDrawAt >= frameInterval) {
      renderNow()
      const elapsed = Math.max(0, time - lastDrawAt)
      lastDrawAt = elapsed >= frameInterval
        ? time - (elapsed % frameInterval)
        : time
    }
    schedule()
  }

  const refresh = () => {
    if (shouldAnimate()) {
      dirty = true
      schedule()
    } else {
      stop()
      renderNow()
    }
  }

  const onVisibilityChange = () => refresh()
  const onReducedMotionChange = event => {
    reducedMotion = Boolean(event.matches)
    refresh()
  }

  documentTarget?.addEventListener?.('visibilitychange', onVisibilityChange)
  if (typeof mediaQuery?.addEventListener === 'function') {
    mediaQuery.addEventListener('change', onReducedMotionChange)
  } else {
    mediaQuery?.addListener?.(onReducedMotionChange)
  }

  let observer = null
  if (typeof Observer === 'function') {
    observer = new Observer(entries => {
      const entry = entries.at(-1)
      if (!entry) return
      intersecting = Boolean(entry.isIntersecting)
      refresh()
    }, { rootMargin: '80px' })
    observer.observe(options.element ?? canvas)
  }

  renderNow()
  schedule()

  return Object.freeze({
    setWeights(nextWeights) {
      if (disposed) return
      weights = clampVfxWeights(nextWeights)
      dirty = true
      if (shouldAnimate()) schedule()
      else renderNow()
    },
    setInteractionActive(active) {
      if (disposed || interactionActive === Boolean(active)) return
      interactionActive = Boolean(active)
      refresh()
    },
    snapshot() {
      return createVfxSnapshot(weights, ambientMs, { field, reducedMotion })
    },
    dispose() {
      if (disposed) return
      disposed = true
      stop()
      observer?.disconnect()
      documentTarget?.removeEventListener?.('visibilitychange', onVisibilityChange)
      if (typeof mediaQuery?.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', onReducedMotionChange)
      } else {
        mediaQuery?.removeListener?.(onReducedMotionChange)
      }
    }
  })
}
