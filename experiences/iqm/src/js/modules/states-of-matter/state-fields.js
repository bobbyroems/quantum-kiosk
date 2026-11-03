/*
 * Data producers for the States of Matter screen shader.
 *
 * Both follow the technique the effect is modelled on: instead of evaluating
 * noise per pixel every frame, the expensive shape work happens once (the noise
 * map) or on the CPU at low resolution (the frost field) and is packed into a
 * texture the fragment shader only has to sample. That keeps the per-pixel cost
 * to a few texture fetches, which is what makes a full-screen pass affordable on
 * the 2160x3840 panel.
 *
 * The frost field uses the same channel packing as the rain, so the shader can
 * refract it with the same maths:
 *   R - normal y, biased    G - normal x, biased
 *   B - thickness           A - coverage mask (the shader sharpens this)
 */

export const NOISE_MAP_SIZE = 512

/* The info card, likewise carved out — but only its interior. The band above it is
   deliberately deep, so the ice laps over the panel's top edge and reads as growing
   across the interface; what it may not do is sit on the heading and the copy. Card
   geometry from styles.css: top 774px, left 645px, 870px wide, 326px tall. */
const CARD_TOP_V = 830 / 3840
const CARD_BOTTOM_V = 1120 / 3840
const CARD_LEFT_U = 620 / 2160
const CARD_RIGHT_U = 1540 / 2160
const CARD_FEATHER_V = 0.022
const CARD_FEATHER_U = 0.05
/* Not a hard hole: a trace of ice over the panel keeps it part of the same surface. */
const CARD_KEEP_OUT = 0.94
export const FROST_FIELD_WIDTH = 675
export const FROST_FIELD_HEIGHT = 1200

function positiveInteger(value, fallback) {
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function frostFieldDimensions({ size, width, height } = {}) {
  const square = Number.isFinite(Number(size)) && Number(size) > 0
    ? Math.round(Number(size))
    : null

  return {
    width: positiveInteger(width, square ?? FROST_FIELD_WIDTH),
    height: positiveInteger(height, square ?? FROST_FIELD_HEIGHT)
  }
}

/* Deterministic hashing so a given seed always produces the same ice. */
function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

function smoothstep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - (2 * t))
}

/* Tileable value noise: the lattice wraps at `period`, so the map can repeat
   across the panel without a visible seam. */
function valueNoise(x, y, period, seed, periodY = period) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const fx = xf * xf * (3 - (2 * xf))
  const fy = yf * yf * (3 - (2 * yf))

  const x0 = ((xi % period) + period) % period
  const y0 = ((yi % periodY) + periodY) % periodY
  const x1 = (x0 + 1) % period
  const y1 = (y0 + 1) % periodY

  const n00 = hash2(x0, y0, seed)
  const n10 = hash2(x1, y0, seed)
  const n01 = hash2(x0, y1, seed)
  const n11 = hash2(x1, y1, seed)

  return (n00 * (1 - fx) * (1 - fy)) +
    (n10 * fx * (1 - fy)) +
    (n01 * (1 - fx) * fy) +
    (n11 * fx * fy)
}

function fbm(x, y, basePeriod, octaves, seed) {
  let value = 0
  let amplitude = 0.5
  let total = 0
  let period = basePeriod

  for (let octave = 0; octave < octaves; octave += 1) {
    value += valueNoise(x * period, y * period, period, seed + octave) * amplitude
    total += amplitude
    amplitude *= 0.5
    period *= 2
  }

  return value / total
}

/* Portrait frost textures contain proportionally more noise periods vertically.
   Without this, the same number of features is stretched across 3840px vertically
   and 2160px horizontally, making every crystal almost 1.8x too tall. Integer
   lattice periods keep both axes tileable. */
function fbmRect(x, y, basePeriod, octaves, seed, aspect) {
  let value = 0
  let amplitude = 0.5
  let total = 0
  let period = basePeriod

  for (let octave = 0; octave < octaves; octave += 1) {
    const periodY = Math.max(1, Math.round(period * aspect))
    value += valueNoise(
      x * period,
      y * periodY,
      period,
      seed + octave,
      periodY
    ) * amplitude
    total += amplitude
    amplitude *= 0.5
    period *= 2
  }

  return value / total
}

/**
 * One-time procedural frost map. Density is an fbm ridge stack — the ridge
 * transform (1 - |2n-1|) is what turns smooth blobs into crystal filaments —
 * and the normal is taken from central differences of that density so the
 * shader can refract along the crystal facets.
 *
 * Packed R = normal x, G = normal y, B = density, A = 255.
 *
 * Alpha is deliberately opaque rather than carrying a fourth field: a 2D canvas
 * stores premultiplied colour, so a translucent pixel's RGB is quantised by its
 * alpha on the way in and un-quantised on upload. At low alpha that round-trip
 * badly corrupts the very channels the shader decodes as vectors.
 */
export function createNoiseMap({ size = NOISE_MAP_SIZE, seed = 1337 } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) return null

  const density = new Float32Array(size * size)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size
      const v = y / size

      /* Ridged fbm: sharp filaments rather than soft blobs. */
      const base = fbm(u, v, 6, 5, seed)
      const ridge = 1 - Math.abs((2 * base) - 1)
      /* A second, coarser field breaks the ridges into crystal clusters, and a
         third adds vein-like variation.

         Every UV span here must stay exactly 1.0 for the lattice to wrap
         seamlessly. Scaling an input (this once read u * 1.7) makes the field
         non-periodic, and the discontinuity shows as a hard line the moment
         anything samples across the tile boundary — which the drifting fog does
         constantly. Offsets are fine; scales are not. Use a higher basePeriod
         for finer detail instead. */
      const cluster = fbm(u + 0.37, v - 0.19, 3, 3, seed + 91)
      const veins = fbm(u + 0.11, v + 0.43, 7, 2, seed + 401)

      const index = (y * size) + x
      density[index] = Math.pow(ridge, 1.6) *
        (0.45 + (0.55 * cluster)) *
        (0.7 + (0.3 * veins))
    }
  }

  const image = context.createImageData(size, size)
  const sample = (x, y) => density[(((y % size) + size) % size * size) + (((x % size) + size) % size)]

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size) + x
      /* Central differences, scaled so the normal reads as a shallow facet
         rather than a cliff — the refraction offset is small by design. */
      const dx = (sample(x + 1, y) - sample(x - 1, y)) * 2.2
      const dy = (sample(x, y + 1) - sample(x, y - 1)) * 2.2

      const offset = index * 4
      image.data[offset] = Math.round(Math.min(1, Math.max(0, (dx * 0.5) + 0.5)) * 255)
      image.data[offset + 1] = Math.round(Math.min(1, Math.max(0, (dy * 0.5) + 0.5)) * 255)
      image.data[offset + 2] = Math.round(Math.min(1, Math.max(0, density[index])) * 255)
      /* Opaque — see the note above about the premultiplied-alpha round-trip. */
      image.data[offset + 3] = 255
    }
  }

  context.putImageData(image, 0, 0)
  return canvas
}


/* ============ Frost map ============
 *
 * Packed exactly like the rain's water map, because the shader runs both through
 * the same glass pass:
 *
 *   R - refraction y      G - refraction x
 *   B - thickness         A - growth order
 *
 * The one difference is alpha. The rain redraws its map every frame, so its alpha
 * is live coverage. Regenerating a continuous field per frame would be far too
 * slow, so alpha here is a *growth order* map instead — high where frost appears
 * first, zero where it must never appear — and the shader turns it into coverage
 * for the current amount using the freeze progression curve. That keeps the frost
 * a pure function of the scrubber, so it un-builds exactly as it built.
 *
 * Frost was briefly built by stamping crystal sprites into a canvas the way the
 * rain stamps drops. That reads as blotches however irregular the sprite, because
 * frost is a continuous field at every scale — hence the procedural field here.
 */

/**
 * @param {object} options
 * @param {number} options.size optional square texture size, retained for offline tools
 * @param {number} options.width portrait texture width
 * @param {number} options.height portrait texture height
 * @param {number} options.seed deterministic seed
 */
export function createFrostMap(options = {}) {
  const { seed = 2024 } = options
  const { width, height } = frostFieldDimensions(options)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) return null

  const surface = new Float32Array(width * height)
  const growth = new Float32Array(width * height)
  const aspect = height / width

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = x / width
      const v = y / height
      const index = (y * width) + x

      /* Crystal height. Two ridged stacks multiplied gives feathery dendrites
         rather than smooth marbling; the periods stay low because this map covers
         the whole 2160px panel, and finer values land detail at tens of pixels
         where it reads as noise instead of ice. */
      const coarse = 1 - Math.abs((2 * fbmRect(u, v, 6, 4, seed, aspect)) - 1)
      const fine = 1 - Math.abs((2 * fbmRect(u + 0.23, v + 0.71, 27, 3, seed + 19, aspect)) - 1)
      surface[index] = smoothstep(
        0.08,
        0.62,
        Math.pow(coarse, 2.3) * (0.3 + (0.7 * Math.pow(fine, 2.6)))
      )

      /* Growth order: a vignette, so frost creeps in from the borders and the
         centre never freezes. The distance to each edge is WARPED by low
         frequency noise before the ramp, which pushes the frontier in and out in
         lobes — modulating the result afterwards only varies intensity and leaves
         an obviously elliptical boundary. A finer octave breaks up the rest.

         Every fbm input keeps a UV span of exactly 1.0 so the map stays tileable:
         offsets are fine, scaling the input is not. */
      /* TWO octave bands per axis, not one. A single low-frequency warp only
         undulates a few times across the panel, so along the left and right edges
         the boundary stays near-constant for hundreds of pixels — and because the
         shader's coverage sharpening is a hard step, that smooth contour resolves
         into a long straight edge. The finer term breaks it up so no stretch of
         the frontier reads as a line. */
      const warpX = ((fbmRect(u + 0.13, v + 0.57, 5, 3, seed + 211, aspect) - 0.5) * 0.1) +
        ((fbmRect(u + 0.44, v + 0.08, 19, 3, seed + 233, aspect) - 0.5) * 0.06)
      const warpY = ((fbmRect(u + 0.79, v + 0.31, 7, 3, seed + 307, aspect) - 0.5) * 0.07) +
        ((fbmRect(u + 0.26, v + 0.93, 23, 3, seed + 331, aspect) - 0.5) * 0.045)
      const edgeX = smoothstep(0.0, 0.18, Math.min(u, 1 - u) + warpX)
      /* The two vertical reaches are separate: the top band runs deeper than the
         bottom, which is where the ice reads as coming down over the interface. Taking
         them from one min() forced them to match, and deepening the bottom to suit the
         top only pushed ice up into the cube.

         The top reach is set against the info card, whose top edge is at 774/3840 =
         0.20: it is meant to cross the card's heading and thin out over its copy, not
         to bury the whole panel. */
      const edgeY = smoothstep(0.0, 0.14, v + warpY) *
        smoothstep(0.0, 0.1, (1 - v) + warpY)
      const grain = fbmRect(u + 0.61, v + 0.29, 13, 3, seed + 77, aspect)

      const overCard =
        smoothstep(CARD_TOP_V - CARD_FEATHER_V, CARD_TOP_V, v) *
        (1 - smoothstep(CARD_BOTTOM_V, CARD_BOTTOM_V + CARD_FEATHER_V, v)) *
        smoothstep(CARD_LEFT_U - CARD_FEATHER_U, CARD_LEFT_U, u) *
        (1 - smoothstep(CARD_RIGHT_U, CARD_RIGHT_U + CARD_FEATHER_U, u))
      growth[index] = Math.min(1, Math.max(0,
        (1 - (edgeX * edgeY)) *
        (0.62 + (0.6 * grain)) *
        (1 - (overCard * CARD_KEEP_OUT))
      ))
    }
  }

  const image = context.createImageData(width, height)
  const at = (x, y) => surface[
    ((((y % height) + height) % height) * width) + (((x % width) + width) % width)
  ]

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width) + x
      /* Central differences. Scaled hard: the glass pass turns these into a UV
         offset, and shallow normals give no visible refraction. */
      const dx = (at(x + 1, y) - at(x - 1, y)) * 6.5
      const dy = (at(x, y + 1) - at(x, y - 1)) * 6.5
      const offset = index * 4

      /* R = y, G = x — the order the glass pass decodes. */
      image.data[offset] = Math.round(Math.min(1, Math.max(0, (dy * 0.5) + 0.5)) * 255)
      image.data[offset + 1] = Math.round(Math.min(1, Math.max(0, (dx * 0.5) + 0.5)) * 255)
      image.data[offset + 2] = Math.round(surface[index] * 255)
      image.data[offset + 3] = Math.round(growth[index] * 255)
    }
  }

  context.putImageData(image, 0, 0)
  return canvas
}

/**
 * The fine frost that sits under the main crystals, densest at the panel edge.
 *
 * A separate field rather than the main map at a higher tiling: tiling only
 * shrinks the same shape, and this layer needs a different *character* — the
 * spiky, feathery needles of hoar frost rather than smooth glassy lobes. That
 * comes from stacking high-frequency ridges and powering them hard, which turns
 * the ridge lines into thin filaments with dark gaps between.
 *
 * Packed for the shared glass pass, with alpha carrying a lacy coverage mask
 * rather than a growth order — the growth for this layer is read from the main
 * map, so the two stay in step as the freeze advances.
 *   R - refraction y      G - refraction x
 *   B - thickness         A - lacy coverage mask
 */
export function createFrostFineMap(options = {}) {
  const { seed = 8801 } = options
  const { width, height } = frostFieldDimensions(options)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) return null

  const surface = new Float32Array(width * height)
  const aspect = height / width

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = x / width
      const v = y / height

      /* Three ridge stacks, each powered hard so only the ridge crests survive.
         The product is what reads as needles: any one stack alone gives worms. */
      const a = 1 - Math.abs((2 * fbmRect(u, v, 22, 3, seed, aspect)) - 1)
      const b = 1 - Math.abs((2 * fbmRect(u + 0.41, v + 0.17, 47, 3, seed + 31, aspect)) - 1)
      const c = 1 - Math.abs((2 * fbmRect(u + 0.83, v + 0.62, 91, 2, seed + 67, aspect)) - 1)
      surface[(y * width) + x] = Math.pow(a, 2.6) *
        Math.pow(b, 2.2) *
        (0.45 + (0.55 * Math.pow(c, 1.8)))
    }
  }

  const image = context.createImageData(width, height)
  const at = (x, y) => surface[
    ((((y % height) + height) % height) * width) + (((x % width) + width) % width)
  ]

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width) + x
      const h = surface[index]
      /* Steep, so the needles catch light as sparkle rather than soft shading. */
      const dx = (at(x + 1, y) - at(x - 1, y)) * 9.0
      const dy = (at(x, y + 1) - at(x, y - 1)) * 9.0
      const offset = index * 4

      image.data[offset] = Math.round(Math.min(1, Math.max(0, (dy * 0.5) + 0.5)) * 255)
      image.data[offset + 1] = Math.round(Math.min(1, Math.max(0, (dx * 0.5) + 0.5)) * 255)
      image.data[offset + 2] = Math.round(Math.min(1, h * 2.4) * 255)
      /* A tight ramp low down the range: the field is mostly near zero after
         three powered stacks, so the mask has to open early or nothing shows. */
      image.data[offset + 3] = Math.round(smoothstep(0.004, 0.1, h) * 255)
    }
  }

  context.putImageData(image, 0, 0)
  return canvas
}

/**
 * The thinnest ice stratum: a dense, static speckle of micro-beads.
 *
 * Deliberately the character of the rain's non-animating droplet layer — that
 * layer is a fine scatter of tiny beads that accumulate and then sit still, and it
 * is what makes glass read as *covered* rather than merely decorated. Here it acts
 * as the film the thicker crystals grow on top of.
 *
 * Beads are splatted with `max` rather than added, so overlapping ones stay
 * distinct instead of fusing into a plateau, and every write wraps, so the map
 * tiles.
 *
 * Packed for the shared glass pass: R = refraction y, G = refraction x,
 * B = thickness, A = coverage.
 */
export function createFrostFilmMap(options = {}) {
  const {
    seed = 61803,
    beadCount = 4600,
    beadScale = 1
  } = options
  const { width, height } = frostFieldDimensions(options)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) return null

  const surface = new Float32Array(width * height)
  const wrapX = value => ((value % width) + width) % width
  const wrapY = value => ((value % height) + height) % height
  const count = Math.max(1, Math.round(beadCount))

  for (let index = 0; index < count; index += 1) {
    const cx = hash2(index, 5, seed) * width
    const cy = hash2(index, 13, seed) * height
    /* Skewed small — a film is mostly pinpricks — but with a real tail, because at
       the tiling this is sampled at the smallest beads land under a couple of
       screen pixels and simply vanish. */
    const radius = (1.6 + ((hash2(index, 29, seed) ** 2.1) * 7.0)) * beadScale
    const reach = Math.ceil(radius)

    for (let dy = -reach; dy <= reach; dy += 1) {
      for (let dx = -reach; dx <= reach; dx += 1) {
        const distance = Math.sqrt((dx * dx) + (dy * dy)) / radius
        if (distance >= 1) continue
        const bead = Math.sqrt(1 - (distance * distance))
        const target = (wrapY(Math.round(cy) + dy) * width) + wrapX(Math.round(cx) + dx)
        if (bead > surface[target]) surface[target] = bead
      }
    }
  }

  const image = context.createImageData(width, height)
  const at = (x, y) => surface[(wrapY(y) * width) + wrapX(x)]

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width) + x
      const h = surface[index]
      const offset = index * 4

      if (h <= 0.001) {
        image.data[offset + 3] = 0
        continue
      }

      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2.2

      image.data[offset] = Math.round(Math.min(1, Math.max(0, (dy * 0.5) + 0.5)) * 255)
      image.data[offset + 1] = Math.round(Math.min(1, Math.max(0, (dx * 0.5) + 0.5)) * 255)
      /* Low by definition — this is the thin layer, and thickness is what the glass
         pass scales refraction by. */
      image.data[offset + 2] = Math.round(Math.min(1, h * 0.35) * 255)
      /* Opened up so more of each bead's area clears the glass pass's coverage
         threshold: at a tighter ramp only the very cores survived and the film read
         as a faint dusting rather than as beads. */
      image.data[offset + 3] = Math.round(Math.min(1, h * 1.7) * 255)
    }
  }

  context.putImageData(image, 0, 0)
  return canvas
}
