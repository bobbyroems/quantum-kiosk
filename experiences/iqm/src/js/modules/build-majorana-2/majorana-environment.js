function freezeCard(card) {
  return Object.freeze({
    ...card,
    position: Object.freeze([...card.position]),
    size: Object.freeze([...card.size])
  })
}

// Module 05 still consumes the legacy equirectangular blur helper for its own
// environment texture. Keep it separate from Module 07's studio-card setup so
// restoring compatibility does not change the tuned Majorana reflections.
export const MAJORANA_ENVIRONMENT_BLUR_RADIUS = 36

function wrap(value, size) {
  return ((value % size) + size) % size
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export function blurEquirectangularData(data, width, height, channels, radius) {
  const safeRadius = Math.max(0, Math.floor(radius))
  if (safeRadius === 0) return data.slice()

  const horizontal = new data.constructor(data.length)
  const output = new data.constructor(data.length)
  const kernelSize = (safeRadius * 2) + 1

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width
    for (let channel = 0; channel < channels; channel += 1) {
      let sum = 0
      for (let offset = -safeRadius; offset <= safeRadius; offset += 1) {
        sum += data[((rowOffset + wrap(offset, width)) * channels) + channel]
      }
      for (let x = 0; x < width; x += 1) {
        horizontal[((rowOffset + x) * channels) + channel] = sum / kernelSize
        const leavingX = wrap(x - safeRadius, width)
        const enteringX = wrap(x + safeRadius + 1, width)
        sum += data[((rowOffset + enteringX) * channels) + channel] -
          data[((rowOffset + leavingX) * channels) + channel]
      }
    }
  }

  for (let x = 0; x < width; x += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      let sum = 0
      for (let offset = -safeRadius; offset <= safeRadius; offset += 1) {
        const sourceY = clamp(offset, 0, height - 1)
        sum += horizontal[(((sourceY * width) + x) * channels) + channel]
      }
      for (let y = 0; y < height; y += 1) {
        output[(((y * width) + x) * channels) + channel] = sum / kernelSize
        const leavingY = clamp(y - safeRadius, 0, height - 1)
        const enteringY = clamp(y + safeRadius + 1, 0, height - 1)
        sum += horizontal[(((enteringY * width) + x) * channels) + channel] -
          horizontal[(((leavingY * width) + x) * channels) + channel]
      }
    }
  }

  return output
}

export function blurMajoranaEnvironment(texture) {
  const image = texture?.image
  if (!image?.data || !image.width || !image.height) return false

  const channels = image.data.length / (image.width * image.height)
  if (!Number.isInteger(channels) || channels < 1) return false

  image.data = blurEquirectangularData(
    image.data,
    image.width,
    image.height,
    channels,
    MAJORANA_ENVIRONMENT_BLUR_RADIUS
  )
  texture.needsUpdate = true
  return true
}

/**
 * A deterministic product-photography environment: a warm studio surround,
 * one broad right-hand softbox, a cool upper-left fill, and restrained lower
 * bounce cards.
 * Unlike the former lab HDR, it contains no room, windows, or architectural
 * detail that can appear as unexplained shapes in the gold reflections.
 */
export const MAJORANA_STUDIO_ENVIRONMENT = Object.freeze({
  // Keep the uncarded reflection warm and mid-valued. A near-black surround
  // turns the edge of the chassis into a hard outline instead of the broad,
  // photographic gold gradient in the approved reference.
  //
  // This surround is 83% of the sphere, and on this model that number decides
  // almost everything. The Chassis is metalness 0.98 / roughness 0.1 — a near
  // mirror — so it has effectively no diffuse lobe, and what the viewer sees at
  // any pixel is this map sampled along the reflection vector. Orbiting sweeps
  // that vector across the sphere: land on one of the five cards (15% of it) and
  // the gold lights up, land anywhere else and it drops to this value. The dark
  // angles people notice are simply the reflection sitting in the surround.
  //
  // That also means an AmbientLight or HemisphereLight cannot fix those angles.
  // Both are diffuse-only in three.js, and at 98% metal there is no diffuse lobe
  // for them to feed. This map is the ambient light for this material, so the
  // floor has to be raised here.
  //
  // 1.65 puts the floor at 0.449 linear, a medium light grey, with the softbox
  // still 2.4 stops above it. Raising environmentIntensity or exposure instead
  // scales the cards along with the surround and so never lifts the floor
  // relative to the highlights, which is the only thing that matters here.
  background: Object.freeze({ color: '#918e8b', intensity: 1.65 }),
  // Stay within PMREM's 20-sample blur budget; material roughness supplies
  // the remaining softness without runtime sample clipping warnings.
  sigma: 0.04,
  near: 0.1,
  far: 100,
  cards: Object.freeze([
    freezeCard({
      name: 'broad right softbox',
      color: '#fffdf8',
      intensity: 2.4,
      size: [3.8, 8],
      position: [5.2, 0.1, 8.2]
    }),
    /* This card sits in the reflection the front and top faces actually sample,
       which is why it carries far more of the visible gold than its 1.8% share
       of the sphere suggests. It began as a black flag and read as a dark patch
       on the chassis rather than as shaping, so it is now a light grey that lifts
       that reflection instead — 1.6 stops above the surround, which puts it at
       roughly the level of a white seamless, and still a stop below the gold
       bounce cards so it fills without competing with the key. Cooled slightly
       (B/R 1.16) so it separates from the warm bounce cards and reads as daylight
       against the gold rather than more of the same. */
    freezeCard({
      name: 'upper-left cool fill',
      color: '#b8bec5',
      intensity: 1.4,
      size: [5.4, 3],
      // Counter the default -20deg environment yaw so the flag lands on the
      // front/top-left reflection instead of merely darkening the left edge.
      position: [2, 5.1, 6.2]
    }),
    freezeCard({
      name: 'right gold bounce',
      color: '#fff8e8',
      intensity: 1.6,
      size: [5.5, 9],
      position: [6, -0.3, 3.8]
    }),
    freezeCard({
      name: 'lower-left gold bounce',
      color: '#fff0cf',
      intensity: 1.15,
      size: [6, 6],
      position: [-5.4, -3.7, 4.2]
    }),
    freezeCard({
      name: 'lower warm fill',
      color: '#ffffff',
      intensity: 1.05,
      size: [10, 3],
      position: [0, -6, 4.6]
    })
  ])
})

function createStudioCard(THREE, card) {
  const geometry = new THREE.PlaneGeometry(card.size[0], card.size[1])
  const color = new THREE.Color(card.color).multiplyScalar(card.intensity)
  const material = new THREE.MeshBasicMaterial({
    color,
    side: THREE.DoubleSide,
    toneMapped: false
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = card.name
  mesh.position.fromArray(card.position)
  mesh.lookAt(0, 0, 0)
  return mesh
}

/**
 * Builds a renderer-owned PMREM target from simple photographic cards.
 * The temporary card scene is disposed immediately after convolution; the
 * caller owns and must dispose the returned render target.
 */
export function createMajoranaStudioEnvironment(
  THREE,
  pmremGenerator,
  definition = MAJORANA_STUDIO_ENVIRONMENT
) {
  if (!THREE?.Scene || !pmremGenerator?.fromScene) return null

  const studioScene = new THREE.Scene()
  studioScene.name = 'majorana-studio-environment'
  studioScene.background = new THREE.Color(definition.background.color)
    .multiplyScalar(definition.background.intensity)
  const cards = definition.cards.map(card => createStudioCard(THREE, card))
  studioScene.add(...cards)

  try {
    return pmremGenerator.fromScene(
      studioScene,
      definition.sigma,
      definition.near,
      definition.far
    )
  } finally {
    cards.forEach(card => {
      card.geometry.dispose()
      card.material.dispose()
    })
    studioScene.clear()
  }
}
