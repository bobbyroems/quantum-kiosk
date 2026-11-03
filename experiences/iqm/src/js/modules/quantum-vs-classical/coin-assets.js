/*
 * Shared quarter-dollar assets for the Quantum vs. Classical sub-games.
 * The mesh is the TwentyFiveCent group from the differences coin OBJ with
 * its real color/bump maps; the lighting rig mirrors the coin shader
 * playground (playground/coin.html): white key, cool fill, warm rim, soft
 * hemisphere, RoomEnvironment reflections, ACES @ 1.1.
 */

import { assetUrl } from '../../core/asset-url.js'
import { disposeObject3DResources } from '../../core/three-resource-disposal.js'

export const QVC_COIN_ACCENT_COLOR = '#5a9bff'
export const ENTANGLEMENT_COIN_MATERIAL_SEEDS = Object.freeze([41, 42])

const COIN_DIR = 'assets/modules/differences/coins/'
const OBJ_URL = `${COIN_DIR}US Coins OBj.obj`
const COLOR_URL = `${COIN_DIR}TwentyFive_Cent_Color.bmp`
const BUMP_URL = `${COIN_DIR}TwentyFive_Cent_Bump.bmp`
/* Photographed quarter variants — assigned per seed so a pile of coins
   never shows the same face twice in a row. */
const COLOR_VARIANT_URLS = Object.freeze([
  COLOR_URL,
  `${COIN_DIR}TwentyFive_Cent_Color01.jpg`,
  `${COIN_DIR}TwentyFive_Cent_Color02.jpg`,
  `${COIN_DIR}TwentyFive_Cent_Color03.jpg`,
  `${COIN_DIR}TwentyFive_Cent_Color04.jpg`
])
/* Grayscale gloss-variation maps: mostly 01, occasionally 02, so worn and
   polished regions break up the mirror-perfect reflections. */
const REFLECTION_MAP_URLS = Object.freeze([
  `${COIN_DIR}reflection-map01.png`,
  `${COIN_DIR}reflection-map02.png`
])

/* Matches the client prototypes' coin scale so their physics reads 1:1. */
export const COIN_RADIUS = 1

let assetsPromise = null

/* The authored reflection maps are near-black with bright streak detail —
   gloss maps. three.js roughnessMap multiplies (dark = mirror), so invert
   them: the coin body goes matte and the streaks stay polished. */
function toRoughnessTexture(THREE, texture) {
  const image = texture.image
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  context.filter = 'invert(1)'
  context.drawImage(image, 0, 0)
  texture.dispose()
  const inverted = new THREE.CanvasTexture(canvas)
  inverted.anisotropy = 4
  return inverted
}

export function loadCoinAssets() {
  assetsPromise ??= (async () => {
    const [THREE, { OBJLoader }] = await Promise.all([
      import('three'),
      import('three/addons/loaders/OBJLoader.js')
    ])

    const object = await new OBJLoader().loadAsync(assetUrl(OBJ_URL))
    /* The OBJ carries SD and MD variants of each coin; take the densest
       TwentyFiveCent mesh (MD) for the hero coin. */
    let geometry = null
    for (const child of object.children) {
      if (!child.isMesh || !child.name.includes('TwentyFiveCent')) continue
      if (!geometry || child.geometry.attributes.position.count >
          geometry.attributes.position.count) {
        geometry = child.geometry
      }
    }
    if (!geometry) throw new Error('TwentyFiveCent mesh missing from coin OBJ')

    /* Normalise: centred, face up along +Y, radius COIN_RADIUS — the same
       frame as the prototypes' CylinderGeometry coins. */
    geometry.computeBoundingBox()
    const box = geometry.boundingBox
    const center = box.getCenter(new THREE.Vector3())
    geometry.translate(-center.x, -center.y, -center.z)
    const size = box.getSize(new THREE.Vector3())
    const scale = (COIN_RADIUS * 2) / Math.max(size.x, size.z)
    geometry.scale(scale, scale, scale)
    geometry.computeVertexNormals()

    const textureLoader = new THREE.TextureLoader()
    const [colorMaps, glossMaps, bumpMap] = await Promise.all([
      Promise.all(COLOR_VARIANT_URLS.map(url => textureLoader.loadAsync(assetUrl(url)))),
      Promise.all(REFLECTION_MAP_URLS.map(url => textureLoader.loadAsync(assetUrl(url)))),
      textureLoader.loadAsync(assetUrl(BUMP_URL))
    ])
    for (const map of colorMaps) {
      map.colorSpace = THREE.SRGBColorSpace
      map.anisotropy = 8
    }
    const roughnessMaps = glossMaps.map(map => toRoughnessTexture(THREE, map))
    bumpMap.anisotropy = 8

    return {
      THREE,
      geometry,
      colorMap: colorMaps[0],
      colorMaps,
      roughnessMaps,
      bumpMap
    }
  })().catch(error => {
    assetsPromise = null
    throw error
  })
  return assetsPromise
}

/* Tiny deterministic PRNG so a coin's variation is stable per seed. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* The coin playground's material recipe. A non-zero seed adds a subtle
   mint-and-wear fingerprint — roughness, relief depth, shine and a whisper
   of warm/cool patina — so a pile of quarters never reads as clones. Two
   coins given the same seed stay identical twins (the superposition ghost
   must match its primary). */
export function createCoinMaterial(assets, seed = 0) {
  const { THREE, colorMaps, roughnessMaps, bumpMap } = assets
  const safeSeed = Number.isFinite(seed) ? Math.abs(Math.floor(seed)) : 0
  /* Gloss varies across the face via the reflection maps (mostly 01,
     every third coin 02), and metalness sits below 1 so a diffuse
     component softens the mirror look of a fresh mint. */
  const material = new THREE.MeshPhysicalMaterial({
    map: colorMaps[safeSeed % colorMaps.length],
    roughnessMap: roughnessMaps[safeSeed % 3 === 0 ? 1 : 0],
    bumpMap,
    bumpScale: 1.2,
    envMapIntensity: 0.6,
    metalness: 0.82,
    roughness: 0.52
  })
  if (seed) {
    const rand = mulberry32(Math.floor(seed * 1013) + 17)
    material.roughness = 0.52 + (rand() - 0.5) * 0.14
    material.bumpScale = 1.2 + (rand() - 0.5) * 0.4
    material.envMapIntensity = 0.6 + (rand() - 0.5) * 0.2
    material.metalness = 0.82 + (rand() - 0.5) * 0.12
    material.color.setHSL(
      rand() < 0.5 ? 0.09 : 0.58,
      0.04 + rand() * 0.05,
      0.96 + (rand() - 0.5) * 0.045
    )
  }
  return material
}

/*
 * The coin playground's studio rig, applied to a game scene. Returns the
 * lights (the games animate their own accent lights separately) and a
 * dispose that releases the PMREM environment.
 */
/* The main menu's floor: a 45°-rotated line grid fading out radially
   (mirrors the shader in shape-scene-3d.js). */
export function createGridFloor(assets, {
  size = 24,
  spacing = 0.6,
  opacity = 0.4,
  fadeRadius = 5,
  y = 0
} = {}) {
  const { THREE } = assets
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color('#b4bac3').convertSRGBToLinear() },
        uSpacing: { value: spacing },
        uOpacity: { value: opacity },
        uFadeRadius: { value: fadeRadius }
      },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorldPos;
        uniform vec3 uColor;
        uniform float uSpacing, uOpacity, uFadeRadius;
        void main() {
          vec2 p = vec2(vWorldPos.x - vWorldPos.z, vWorldPos.x + vWorldPos.z) * 0.7071068;
          vec2 coord = p / uSpacing;
          vec2 g = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
          float line = 1.0 - min(min(g.x, g.y), 1.0);
          float fade = 1.0 - smoothstep(uFadeRadius * 0.3, uFadeRadius, length(vWorldPos.xz));
          gl_FragColor = vec4(uColor, line * fade * uOpacity);
        }
      `
    })
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = y
  return mesh
}

/*
 * Soft elliptical contact shadow, the nav-scene look. `core` is the radius of
 * the fully opaque centre in texture pixels (of 128): widen it when the caster
 * is broad and flat, or the only part of the shadow that clears the object's
 * own silhouette is the faint tail of the falloff.
 */
export function createContactShadow(assets, { radius = 1, opacity = 0.16, core = 20 } = {}) {
  const { THREE } = assets
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const context = canvas.getContext('2d')
  const gradient = context.createRadialGradient(128, 128, core, 128, 128, 126)
  gradient.addColorStop(0, 'rgba(30, 38, 52, 1)')
  gradient.addColorStop(1, 'rgba(30, 38, 52, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 256, 256)
  const texture = new THREE.CanvasTexture(canvas)
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity,
      depthWrite: false
    })
  )
  mesh.rotation.x = -Math.PI / 2
  return mesh
}

export function createStudioRig(assets, renderer, scene, { RoomEnvironment }) {
  const { THREE } = assets

  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1

  let environmentTarget = null
  function restoreEnvironment() {
    environmentTarget?.dispose()
    const pmrem = new THREE.PMREMGenerator(renderer)
    const roomEnvironment = new RoomEnvironment()
    try {
      environmentTarget = pmrem.fromScene(roomEnvironment, 0.04)
      scene.environment = environmentTarget.texture
    } finally {
      disposeObject3DResources(roomEnvironment)
      pmrem.dispose()
    }
  }
  restoreEnvironment()

  const keyLight = new THREE.DirectionalLight('#ffffff', 2.4)
  keyLight.position.set(2.6, 3.4, 2.4)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(2048, 2048)
  keyLight.shadow.camera.left = -7
  keyLight.shadow.camera.right = 7
  keyLight.shadow.camera.top = 7
  keyLight.shadow.camera.bottom = -5
  keyLight.shadow.bias = -0.0003
  const fillLight = new THREE.DirectionalLight('#bcd6ff', 0.7)
  fillLight.position.set(-3.2, 0.6, 2.2)
  const rimLight = new THREE.DirectionalLight('#ffe2b8', 1.2)
  rimLight.position.set(-1.4, 2.2, -3.2)
  const hemiLight = new THREE.HemisphereLight('#f2f5fa', '#c9cdd4', 0.35)
  scene.add(keyLight, fillLight, rimLight, hemiLight)

  return {
    keyLight,
    fillLight,
    rimLight,
    hemiLight,
    restoreEnvironment,
    dispose() {
      scene.environment = null
      environmentTarget?.dispose()
      environmentTarget = null
      /* The key light is built casting shadows, and every caller currently
         turns that off before the first render — so no map is allocated. The
         renderer is pooled and never disposed, though, so if one caller ever
         drops that line the 2048x2048 depth target would outlive the scene
         with nothing to release it. Releasing it here removes that trap. */
      keyLight.shadow?.map?.dispose()
      if (keyLight.shadow) keyLight.shadow.map = null
    }
  }
}
