/*
 * Raindrop simulation, ported from the Codrops "Rain & Water Effect
 * Experiments" by Lucas Bebber (2015).
 *
 *   https://github.com/codrops/RainEffect  —  src/raindrops.js
 *
 * Licence: "Integrate or build upon it for free in your personal or commercial
 * projects. Don't republish, redistribute or sell as-is."
 * https://tympanus.net/codrops/licensing/
 *
 * The algorithm is kept faithful — drop spawning, trail shedding, collision
 * merging, shrinkage and the separate droplet layer all behave as the original.
 * The changes are structural rather than behavioural:
 *
 * - ES module with a factory instead of a prototype constructor.
 * - The caller owns the animation loop, so `update(delta)` is driven from the
 *   shader's render loop rather than its own requestAnimationFrame.
 * - Rain intensity is scaled by a 0..1 weight so the effect can ramp with the
 *   module's slider instead of being simply on or off.
 * - No Math.random: the kiosk needs the field to be reproducible, so a seeded
 *   generator stands in.
 *
 * The output canvas is a normal map the shader refracts:
 *   R - refraction y      G - refraction x
 *   B - thickness         A - drop mask (the shader sharpens this)
 */

const DROP_SIZE = 64
/* The original bakes 255 thickness variants; the visual difference between
   adjacent levels is imperceptible, and fewer keeps init cheap. */
const DROPS_GFX_VARIANTS = 64

const DEFAULT_OPTIONS = Object.freeze({
  minR: 10,
  maxR: 40,
  maxDrops: 900,
  rainChance: 0.3,
  rainLimit: 3,
  dropletsRate: 50,
  dropletsSize: [2, 4],
  dropletsCleaningRadiusMultiplier: 0.43,
  globalTimeScale: 1,
  trailRate: 1,
  autoShrink: true,
  spawnArea: [-0.1, 0.95],
  trailScaleRange: [0.2, 0.5],
  collisionRadius: 0.65,
  collisionRadiusIncrease: 0.01,
  dropFallMultiplier: 1,
  collisionBoostMultiplier: 0.05,
  collisionBoost: 1
})

function createDrop(overrides) {
  return {
    x: 0,
    y: 0,
    r: 0,
    spreadX: 0,
    spreadY: 0,
    momentum: 0,
    momentumX: 0,
    lastSpawn: 0,
    nextSpawn: 0,
    parent: null,
    isNew: true,
    killed: false,
    shrink: 0,
    ...overrides
  }
}

/* Seeded stand-in for the original's Math.random helpers. */
function createRandom(seed) {
  let state = seed >>> 0
  const next = () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }

  const random = (from = 1, to = null, interpolation = null) => {
    let low = from
    let high = to
    if (high === null) {
      high = low
      low = 0
    }
    const delta = high - low
    if (delta === 0) return low
    const t = interpolation ? interpolation(next()) : next()
    return low + (t * delta)
  }

  return {
    random,
    chance: probability => random(1) <= probability
  }
}

function createLayerCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

/**
 * Bakes the drop sprites: the colour map masked by the alpha map, with a blue
 * fill screened over it so each variant carries its own thickness. Reproduces
 * the original's renderDropsGfx.
 */
function renderDropsGfx(dropAlpha, dropColor) {
  const buffer = createLayerCanvas(DROP_SIZE, DROP_SIZE)
  const bufferCtx = buffer.getContext('2d')
  if (!bufferCtx) return null

  const sprites = []
  for (let index = 0; index < DROPS_GFX_VARIANTS; index += 1) {
    const drop = createLayerCanvas(DROP_SIZE, DROP_SIZE)
    const dropCtx = drop.getContext('2d')
    if (!dropCtx) return null

    bufferCtx.clearRect(0, 0, DROP_SIZE, DROP_SIZE)

    bufferCtx.globalCompositeOperation = 'source-over'
    bufferCtx.drawImage(dropColor, 0, 0, DROP_SIZE, DROP_SIZE)

    /* Blue carries thickness, which the shader turns into refraction strength. */
    const blue = Math.round((index / (DROPS_GFX_VARIANTS - 1)) * 254)
    bufferCtx.globalCompositeOperation = 'screen'
    bufferCtx.fillStyle = `rgba(0,0,${blue},1)`
    bufferCtx.fillRect(0, 0, DROP_SIZE, DROP_SIZE)

    dropCtx.globalCompositeOperation = 'source-over'
    dropCtx.drawImage(dropAlpha, 0, 0, DROP_SIZE, DROP_SIZE)
    dropCtx.globalCompositeOperation = 'source-in'
    dropCtx.drawImage(buffer, 0, 0, DROP_SIZE, DROP_SIZE)

    sprites.push(drop)
  }

  return sprites
}

/**
 * @param {object} config
 * @param {number} config.width  output width in px
 * @param {number} config.height output height in px
 * @param {number} config.scale  world-to-canvas scale, as the original
 * @param {HTMLImageElement} config.dropAlpha drop mask sprite
 * @param {HTMLImageElement} config.dropColor drop refraction sprite
 */
export function createRainDrops({
  width,
  height,
  scale = 1,
  dropAlpha,
  dropColor,
  seed = 0x5eed,
  options = {}
} = {}) {
  const canvas = createLayerCanvas(width, height)
  const context = canvas.getContext('2d')
  const dropletsPixelDensity = 1
  const droplets = createLayerCanvas(width * dropletsPixelDensity, height * dropletsPixelDensity)
  const dropletsCtx = droplets.getContext('2d')
  if (!context || !dropletsCtx) return null

  const dropsGfx = renderDropsGfx(dropAlpha, dropColor)
  if (!dropsGfx) return null

  /* Brush used to erase droplets along a moving drop's path. */
  const clearDropletsGfx = createLayerCanvas(128, 128)
  const clearCtx = clearDropletsGfx.getContext('2d')
  clearCtx.fillStyle = '#000'
  clearCtx.beginPath()
  clearCtx.arc(64, 64, 64, 0, Math.PI * 2)
  clearCtx.fill()

  const settings = { ...DEFAULT_OPTIONS, ...options }
  const { random, chance } = createRandom(seed)

  let drops = []
  let dropletsCounter = 0
  let textureCleaningIterations = 0

  const deltaR = () => settings.maxR - settings.minR
  const area = () => (width * height) / scale
  const areaMultiplier = () => Math.sqrt(area() / (1024 * 768))

  const drawDrop = (ctx, drop) => {
    if (dropsGfx.length === 0 || drop.r <= 0) return
    const scaleX = 1
    const scaleY = 1.5

    let d = Math.max(0, Math.min(1, ((drop.r - settings.minR) / deltaR()) * 0.9))
    d *= 1 / (((drop.spreadX + drop.spreadY) * 0.5) + 1)

    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'

    const index = Math.floor(d * (dropsGfx.length - 1))
    ctx.drawImage(
      dropsGfx[index],
      (drop.x - (drop.r * scaleX * (drop.spreadX + 1))) * scale,
      (drop.y - (drop.r * scaleY * (drop.spreadY + 1))) * scale,
      (drop.r * 2 * scaleX * (drop.spreadX + 1)) * scale,
      (drop.r * 2 * scaleY * (drop.spreadY + 1)) * scale
    )
  }

  const drawDroplet = (x, y, r) => {
    drawDrop(dropletsCtx, createDrop({
      x: x * dropletsPixelDensity,
      y: y * dropletsPixelDensity,
      r: r * dropletsPixelDensity
    }))
  }

  const clearDroplets = (x, y, r = 30) => {
    dropletsCtx.globalCompositeOperation = 'destination-out'
    dropletsCtx.drawImage(
      clearDropletsGfx,
      (x - r) * dropletsPixelDensity * scale,
      (y - r) * dropletsPixelDensity * scale,
      r * 2 * dropletsPixelDensity * scale,
      r * 2 * dropletsPixelDensity * scale * 1.5
    )
  }

  const spawn = options_ => {
    if (drops.length >= settings.maxDrops * areaMultiplier()) return null
    return createDrop(options_)
  }

  const updateRain = (timeScale, weight) => {
    const rainDrops = []
    const limit = settings.rainLimit * timeScale * areaMultiplier()
    let count = 0
    /* weight scales how hard it is raining, so the slider can ramp it. */
    while (chance(settings.rainChance * timeScale * areaMultiplier() * weight) && count < limit) {
      count += 1
      /* Light rain first: the top of the radius range opens up with the weight,
         so a low amount gives fine droplets and only a full amount produces the
         big runners. Without this every drop is full-size from the first frame
         and there is no sense of the rain building. */
      const weightedMaxR = settings.minR +
        ((settings.maxR - settings.minR) * (0.3 + (0.7 * weight)))
      const r = random(settings.minR, weightedMaxR, n => n ** 3)
      const rainDrop = spawn({
        x: random(width / scale),
        y: random(
          (height / scale) * settings.spawnArea[0],
          (height / scale) * settings.spawnArea[1]
        ),
        r,
        momentum: 1 + ((r - settings.minR) * 0.1) + random(2),
        spreadX: 1.5,
        spreadY: 1.5
      })
      if (rainDrop !== null) rainDrops.push(rainDrop)
    }
    return rainDrops
  }

  const updateDroplets = (timeScale, weight) => {
    if (textureCleaningIterations > 0) {
      textureCleaningIterations -= 1 * timeScale
      dropletsCtx.globalCompositeOperation = 'destination-out'
      dropletsCtx.fillStyle = `rgba(0,0,0,${0.05 * timeScale})`
      dropletsCtx.fillRect(
        0,
        0,
        width * dropletsPixelDensity,
        height * dropletsPixelDensity
      )
    }

    dropletsCounter += settings.dropletsRate * timeScale * areaMultiplier() * weight
    while (dropletsCounter >= 1) {
      dropletsCounter -= 1
      drawDroplet(
        random(width / scale),
        random(height / scale),
        random(settings.dropletsSize[0], settings.dropletsSize[1], n => n * n)
      )
    }

    context.globalCompositeOperation = 'source-over'
    context.globalAlpha = 1
    context.drawImage(droplets, 0, 0, width, height)
  }

  const updateDrops = (timeScale, weight) => {
    let newDrops = []

    updateDroplets(timeScale, weight)
    newDrops = newDrops.concat(updateRain(timeScale, weight))

    /* Sorted so collision only ever has to look forward through the list. */
    drops.sort((a, b) => {
      const va = (a.y * (width / scale)) + a.x
      const vb = (b.y * (width / scale)) + b.x
      if (va > vb) return 1
      return va === vb ? 0 : -1
    })

    drops.forEach((drop, index) => {
      if (drop.killed) return

      /* Chance of a drop breaking loose and creeping down. */
      if (chance((drop.r - (settings.minR * settings.dropFallMultiplier)) * (0.1 / deltaR()) * timeScale)) {
        drop.momentum += random((drop.r / settings.maxR) * 4)
      }

      if (settings.autoShrink && drop.r <= settings.minR && chance(0.05 * timeScale)) {
        drop.shrink += 0.01
      }

      drop.r -= drop.shrink * timeScale
      if (drop.r <= 0) {
        drop.killed = true
        return
      }

      /* Trails: a moving drop sheds smaller drops behind it and loses mass. */
      drop.lastSpawn += drop.momentum * timeScale * settings.trailRate
      if (drop.lastSpawn > drop.nextSpawn) {
        const trailDrop = spawn({
          x: drop.x + (random(-drop.r, drop.r) * 0.1),
          y: drop.y - (drop.r * 0.01),
          r: drop.r * random(settings.trailScaleRange[0], settings.trailScaleRange[1]),
          spreadY: drop.momentum * 0.1,
          parent: drop
        })

        if (trailDrop !== null) {
          newDrops.push(trailDrop)
          drop.r *= 0.97 ** timeScale
          drop.lastSpawn = 0
          drop.nextSpawn = random(settings.minR, settings.maxR) -
            (drop.momentum * 2 * settings.trailRate) +
            (settings.maxR - drop.r)
        }
      }

      drop.spreadX *= 0.4 ** timeScale
      drop.spreadY *= 0.7 ** timeScale

      const moved = drop.momentum > 0
      if (moved && !drop.killed) {
        drop.y += drop.momentum * settings.globalTimeScale
        drop.x += drop.momentumX * settings.globalTimeScale
        if (drop.y > (height / scale) + drop.r) drop.killed = true
      }

      const checkCollision = (moved || drop.isNew) && !drop.killed
      drop.isNew = false

      if (checkCollision) {
        /* Only the next 70 in sort order can plausibly be in range. */
        drops.slice(index + 1, index + 70).forEach(other => {
          if (
            drop === other ||
            drop.r <= other.r ||
            drop.parent === other ||
            other.parent === drop ||
            other.killed
          ) return

          const dx = other.x - drop.x
          const dy = other.y - drop.y
          const distance = Math.sqrt((dx * dx) + (dy * dy))
          const reach = (drop.r + other.r) *
            (settings.collisionRadius + (drop.momentum * settings.collisionRadiusIncrease * timeScale))
          if (distance >= reach) return

          /* Merge: conserve most of the combined area, and let the bigger drop
             inherit a speed boost. */
          const a1 = Math.PI * (drop.r * drop.r)
          const a2 = Math.PI * (other.r * other.r)
          drop.r = Math.min(settings.maxR, Math.sqrt((a1 + (a2 * 0.8)) / Math.PI))
          drop.momentumX += dx * 0.1
          drop.spreadX = 0
          drop.spreadY = 0
          other.killed = true
          drop.momentum = Math.max(
            other.momentum,
            Math.min(
              40,
              drop.momentum + (drop.r * settings.collisionBoostMultiplier) + settings.collisionBoost
            )
          )
        })
      }

      drop.momentum -= Math.max(1, (settings.minR * 0.5) - drop.momentum) * 0.1 * timeScale
      if (drop.momentum < 0) drop.momentum = 0
      drop.momentumX *= 0.7 ** timeScale

      if (drop.killed) return
      newDrops.push(drop)
      if (moved && settings.dropletsRate > 0) {
        clearDroplets(drop.x, drop.y, drop.r * settings.dropletsCleaningRadiusMultiplier)
      }
      drawDrop(context, drop)
    })

    drops = newDrops
  }

  return {
    canvas,
    /**
     * @param {number} delta  seconds since the previous update
     * @param {number} weight 0..1 rain intensity
     */
    update(delta, weight) {
      context.clearRect(0, 0, width, height)

      const clamped = Math.min(1, Math.max(0, weight))
      /* The original normalises against a 60fps step; keep that so the tuning
         constants above stay meaningful. */
      let timeScale = Math.max(0, delta) / (1 / 60)
      if (timeScale > 1.1) timeScale = 1.1
      timeScale *= settings.globalTimeScale

      if (clamped <= 0.001) {
        /* Fade the accumulated droplet texture out rather than snapping. */
        if (drops.length > 0) drops = []
        textureCleaningIterations = 50
        updateDroplets(timeScale, 0)
        return
      }

      updateDrops(timeScale, clamped)
    },
    dispose() {
      drops = []
      context.clearRect(0, 0, width, height)
      dropletsCtx.clearRect(0, 0, droplets.width, droplets.height)
    }
  }
}
