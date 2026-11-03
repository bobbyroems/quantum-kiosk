import {
  createGaussianGlow,
  disposeGaussianGlow,
  updateGaussianGlow
} from '../../core/gaussian-glow.js'
import { leaseWebGLRenderer } from '../../core/webgl-renderer-pool.js'
import { warmSceneVariants } from '../../core/warm-scene-variants.js'
import { calculateStageAwarePixelRatio, elementCssScale } from '../../core/three-render-budget.js'
import {
  NANOWIRE_FLOW_DEBUG_MODES,
  NANOWIRE_FLOW_DEFAULT_SEED,
  NANOWIRE_CORRECTION_COLOR_TRANSITION,
  NANOWIRE_FINAL_HANDOFF,
  NANOWIRE_FINAL_RISE,
  NANOWIRE_INTRO_REDUCED_TIMING,
  NANOWIRE_INTRO_TIMING,
  NANOWIRE_SCAN_VIBRATION,
  resolveCorrectedPulse,
  resolveErrorDisplacement,
  resolveErrorReveal,
  resolveGradientSpan,
  resolveNanowireIntroSequence,
  resolveNanowireIntroGridOpacity,
  resolveNanowireFinalRise,
  resolveNanowireFinalFlowElapsed,
  resolveNanowireFinalHandoff,
  resolvePerturbationField,
  resolveRigidSheetDrop,
  resolveRepairSequence,
  resolveScanVibrationEnvelope,
} from './interaction.js'
import {
  NANOWIRE_ATOM_SURFACE,
  NANOWIRE_COLORS,
  NANOWIRE_FINAL_FLOW_BASE,
  NANOWIRE_FINAL_FLOW_PULSE,
  NANOWIRE_LOUPE_CORRECTED_GRADIENT,
  NANOWIRE_LOUPE_ERROR_GRADIENT,
  NANOWIRE_PERTURBED_FLOW_GRADIENT
} from './palette.js'

const SHEET_COUNT = 4
const FOUNDATION_LAYER_COUNT = 1
const ATOMIC_LAYER_COUNT = FOUNDATION_LAYER_COUNT + SHEET_COUNT
const ATOMS_LONG = 24
const ATOMS_WIDE = 8
const ATOMS_PER_ATOMIC_LAYER = ATOMS_LONG * ATOMS_WIDE
const TOTAL_ATOMS = ATOMIC_LAYER_COUNT * ATOMS_PER_ATOMIC_LAYER
const ATOM_RADIUS = 0.245
const ATOM_SPACING = 0.46
/* The single atom breathes while it is the only thing on screen (IQM, 25 Aug:
   "have the atom floating up and down"). Small enough to read as the atom
   hanging there rather than travelling anywhere — it has to still look like it
   is waiting to be tapped. */
const INTRO_HERO_FLOAT_AMPLITUDE = 0.07
const INTRO_HERO_FLOAT_PERIOD_MS = 2800
const WIRE_SCALE = 0.5
const SHADOW_CATCHER_CLEARANCE = 0.008
const INTRO_HERO_LONG = Math.floor((ATOMS_LONG - 1) / 2)
const INTRO_LINE_WIDE = Math.floor((ATOMS_WIDE - 1) / 2)
const INTRO_HERO_INDEX = (INTRO_HERO_LONG * ATOMS_WIDE) + INTRO_LINE_WIDE
const INTRO_HERO_SCALE = 2.65
const INTRO_LINE_DELAY_SPAN = 0.34
const INTRO_LINE_REVEAL_SPAN = 1 - INTRO_LINE_DELAY_SPAN
/* Let each mirrored row pair read before the next pair starts, so the sheet is
   visibly assembled from multiple lines instead of blooming all at once. */
const INTRO_ROW_DELAY_SPAN = 0.54
const INTRO_ROW_REVEAL_SPAN = 1 - INTRO_ROW_DELAY_SPAN
const GRID_OPACITY = 0.4
const SHADOW_OPACITY = 0.2
const DEFECT_ATOMIC_LAYER = ATOMIC_LAYER_COUNT - 1
/*
 * Fitted to the authored render (Figma 9:2578), where the lattice's long axis
 * runs 17.9deg below horizontal and its width axis 26.3deg above. Projecting
 * the wire's local axes through this camera, -1.48/0.10 put the long axis at
 * 31.9deg — a good 16deg steeper than the design; -1.29/0.03 lands both within
 * a tenth of a degree.
 */
const WIRE_ROTATION_X = 0.03
const WIRE_ROTATION_Y = -1.29
const LOUPE_FIELD_RADII = Object.freeze({ longitudinal: 2.1, vertical: 1.65, lateral: 1.95 })
const PERTURBATION_RED_BIAS = 1.16
const SCAN_VIBRATION_AMPLITUDE = ATOM_RADIUS * 0.055
const SCAN_VIBRATION_ANGULAR_SPEED = (Math.PI * 2 * 8.2) / 1_000
const DEFECT_CORE_COLOR = NANOWIRE_COLORS.defectCore
const DEFECT_CORE_EMISSIVE = NANOWIRE_COLORS.defectCoreEmissive
const DEFECT_GLOW_COLOR = NANOWIRE_COLORS.defectHalo
const DEFECT_GLOW_FALLOFF = 5.4
const REPAIRED_GLOW_FALLOFF = 3.6
const REPAIRED_DEFECT_COLOR = NANOWIRE_COLORS.repairedDefect
/* The repaired core itself remains neutral gray. Green belongs exclusively to
   the additive shell around it, otherwise emissive light tints the sphere. */
const REPAIRED_DEFECT_EMISSIVE = 0x000000
const LOUPE_BACKGROUND_COLOR = 0xf7eee9
const ACTIVE_SCAN_VIBRATION = Object.freeze({ ...NANOWIRE_SCAN_VIBRATION, sustain: true })
export const NANOWIRE_EXPERIENCE_WIRE_ROTATION_Z = 0.16
export const NANOWIRE_EXPERIENCE_STAGE_Y = 0.2
export const NANOWIRE_EXPERIENCE_WIRE_Y = 0.165
export const NANOWIRE_SHADOW_MAP_SIZE = 1_024
export const NANOWIRE_LOUPE_OPTICS = Object.freeze({
  distortion: 0.105,
  chromaticAberration: 0.0024,
  edgeSoftness: 0.08,
  maximumRenderSize: 768
})

export const NANOWIRE_LOUPE_OPTICS_MODES = Object.freeze({
  final: 'final',
  undistorted: 'undistorted',
  distortion: 'distortion'
})

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const smoothstep = (minimum, maximum, value) => {
  const t = clamp((value - minimum) / (maximum - minimum))
  return t * t * (3 - 2 * t)
}

export function resolveNanowireIntroAtomState(coordinates, timeline, options = {}, out = {}) {
  const long = Number.isFinite(coordinates?.long) ? coordinates.long : 0
  const wide = Number.isFinite(coordinates?.wide) ? coordinates.wide : 0
  const longCenter = (ATOMS_LONG - 1) * 0.5
  const wideCenter = (ATOMS_WIDE - 1) * 0.5
  const targetX = (long - longCenter) * ATOM_SPACING
  const targetZ = (wide - wideCenter) * ATOM_SPACING
  const longRing = Math.max(0, Math.abs(long - longCenter) - 0.5)
  const rowRing = Math.max(0, Math.abs(wide - wideCenter) - 0.5)
  const lineDistance = longRing / Math.max(longCenter - 0.5, 1)
  const rowDistance = rowRing / Math.max((ATOMS_WIDE * 0.5) - 1, 1)
  const lineDelay = lineDistance * INTRO_LINE_DELAY_SPAN
  const rowDelay = rowDistance * INTRO_ROW_DELAY_SPAN
  const lineProgress = smoothstep(
    lineDelay,
    lineDelay + INTRO_LINE_REVEAL_SPAN,
    timeline?.lineProgress ?? 0
  )
  const rowProgress = smoothstep(
    rowDelay,
    rowDelay + INTRO_ROW_REVEAL_SPAN,
    timeline?.sheetProgress ?? 0
  )
  const isHero = long === INTRO_HERO_LONG && wide === INTRO_LINE_WIDE
  const isLineAtom = wide === INTRO_LINE_WIDE
  const reducedMotion = options.reducedMotion === true
  let scale = 0
  let x = targetX
  let y = 0
  let z = targetZ

  if (isLineAtom) {
    const direction = Math.sign(targetX)
    const sourceX = Math.abs(targetX) <= ATOM_SPACING * 0.5
      ? 0
      : targetX - (direction * ATOM_SPACING)
    const travelProgress = reducedMotion
      ? ((timeline?.lineProgress ?? 0) > 0 ? 1 : 0)
      : lineProgress
    x = sourceX + ((targetX - sourceX) * travelProgress)
    z = reducedMotion
      ? ((timeline?.sheetProgress ?? 0) > 0 ? targetZ : 0)
      : targetZ * rowProgress

    if (isHero && (timeline?.lineProgress ?? 0) <= 0) {
      scale = INTRO_HERO_SCALE * (timeline?.atomProgress ?? 0)
    } else if (isHero) {
      scale = 1 + ((INTRO_HERO_SCALE - 1) * (1 - (timeline?.lineProgress ?? 0)))
    } else {
      scale = lineProgress
    }
  } else {
    const direction = Math.sign(targetZ)
    const sourceZ = Math.abs(targetZ) <= ATOM_SPACING * 0.5
      ? 0
      : targetZ - (direction * ATOM_SPACING)
    z = reducedMotion && rowProgress > 0
      ? targetZ
      : sourceZ + ((targetZ - sourceZ) * rowProgress)
    scale = rowProgress
  }

  if (isHero && scale > 1) y = ATOM_RADIUS * (scale - 1)

  /* The float belongs to the atom stage only, and fades out as the line starts
     building so it never fights the atoms travelling into place. Reduced motion
     leaves it still. */
  if (isHero && !reducedMotion) {
    const beforeTheLine = 1 - Math.min(1, Math.max(0, timeline?.lineProgress ?? 0))
    if (beforeTheLine > 0) {
      const elapsed = Number.isFinite(options.floatElapsed) ? options.floatElapsed : 0
      const phase = (elapsed / INTRO_HERO_FLOAT_PERIOD_MS) * Math.PI * 2
      y += Math.sin(phase) * INTRO_HERO_FLOAT_AMPLITUDE * beforeTheLine
    }
  }

  out.x = x
  out.y = y
  out.z = z
  out.scale = scale
  out.visible = scale > 0.01
  out.lineProgress = lineProgress
  out.rowProgress = rowProgress
  return out
}

export function resolveNanowireShadowAtomCount(buildStartedAt = null) {
  return buildStartedAt === null ? ATOMS_PER_ATOMIC_LAYER : TOTAL_ATOMS
}

export function resolveNanowireDefect(seed = 0) {
  const safeSeed = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
  let mixed = Math.imul(safeSeed ^ 0x9e3779b9, 0x85ebca6b) >>> 0
  mixed = (mixed ^ (mixed >>> 13)) >>> 0
  const long = 6 + (mixed % 13)
  const wide = 1 + ((mixed >>> 8) % 6)
  return {
    atomicLayer: DEFECT_ATOMIC_LAYER,
    long,
    wide,
    index: (DEFECT_ATOMIC_LAYER * ATOMS_PER_ATOMIC_LAYER) + (long * ATOMS_WIDE) + wide
  }
}

function createDefectSeed() {
  const values = new Uint32Array(1)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values)
    return values[0]
  }
  return Math.floor(Math.random() * 0x1_0000_0000)
}

function createAtomMaterial(THREE) {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    ...NANOWIRE_ATOM_SURFACE,
    /* Use the light-facing surface of each solid atom. Back-face shadow depth
       can fall below the normal-biased ground sample near contact, leaving
       hollow centres in the single-atom and foundation-sheet shadows. */
    shadowSide: THREE.FrontSide
  })
}

export function createNanowireLoupeOpticsMaterial(THREE) {
  return new THREE.ShaderMaterial({
    name: 'NanowireLoupeOpticsMaterial',
    uniforms: {
      uScene: { value: null },
      uDistortion: { value: NANOWIRE_LOUPE_OPTICS.distortion },
      uChromaticAberration: { value: NANOWIRE_LOUPE_OPTICS.chromaticAberration },
      uEdgeSoftness: { value: NANOWIRE_LOUPE_OPTICS.edgeSoftness },
      uDebugMode: { value: 0 }
    },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform sampler2D uScene;
      uniform float uDistortion;
      uniform float uChromaticAberration;
      uniform float uEdgeSoftness;
      uniform float uDebugMode;

      void main() {
        vec2 centred = (vUv * 2.0) - 1.0;
        float radiusSquared = dot(centred, centred);
        float radialWeight = smoothstep(0.08, 1.0, radiusSquared);
        vec2 refractedUv = 0.5 + 0.5 * centred * (1.0 - uDistortion * radialWeight);
        vec2 radialDirection = centred / max(length(centred), 0.0001);
        vec2 spectrumOffset = radialDirection * uChromaticAberration * radialWeight;

        float red = texture2D(uScene, clamp(refractedUv + spectrumOffset, 0.0, 1.0)).r;
        vec2 greenBlue = texture2D(uScene, clamp(refractedUv, 0.0, 1.0)).gb;
        float blue = texture2D(uScene, clamp(refractedUv - spectrumOffset, 0.0, 1.0)).b;
        vec3 refractedColor = vec3(red, greenBlue.x, blue);

        float edge = smoothstep(1.0 - uEdgeSoftness, 1.0, length(centred));
        vec3 glassColor = mix(refractedColor, vec3(0.969, 0.933, 0.914), edge * 0.12);
        if (uDebugMode > 1.5) glassColor = vec3(radialWeight);

        gl_FragColor = vec4(glassColor, 1.0);
        #include <colorspace_fragment>
      }
    `
  })
}

export function createNanowireExperienceGrid(THREE) {
  const grid = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 11.6),
    new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color('#b4bac3').convertSRGBToLinear() },
        uSpacing: { value: 0.92 },
        uOpacity: { value: 0.4 },
        uFadeRadius: { value: 7.3 }
      },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vGridPosition;

        void main() {
          vGridPosition = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vGridPosition;
        uniform vec3 uColor;
        uniform float uSpacing;
        uniform float uOpacity;
        uniform float uFadeRadius;

        void main() {
          vec2 diagonal = vec2(
            vGridPosition.x - vGridPosition.y,
            vGridPosition.x + vGridPosition.y
          ) * 0.7071068;
          vec2 coordinate = diagonal / uSpacing;
          vec2 gridWidth = abs(fract(coordinate - 0.5) - 0.5) / fwidth(coordinate);
          float line = 1.0 - min(min(gridWidth.x, gridWidth.y), 1.0);
          float ellipticalRadius = length(vGridPosition / vec2(1.0, 0.72));
          float fade = 1.0 - smoothstep(
            uFadeRadius * 0.34,
            uFadeRadius,
            ellipticalRadius
          );
          gl_FragColor = vec4(uColor, line * fade * uOpacity);
        }
      `
    })
  )
  grid.name = 'NanowireExperienceGrid'
  grid.layers.set(0)
  return grid
}

export function createNanowireShadowCatcher(THREE) {
  const catcher = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 11.6),
    new THREE.ShadowMaterial({
      color: 0x434a55,
      opacity: 0.2,
      transparent: true,
      depthWrite: false
    })
  )
  catcher.name = 'NanowireShadowCatcher'
  catcher.receiveShadow = true
  catcher.renderOrder = 1
  catcher.layers.set(0)
  return catcher
}

export function alignNanowireGround(THREE, wire, grid, shadowCatcher) {
  const wireNormal = new THREE.Vector3(0, 1, 0).applyQuaternion(wire.quaternion)
  const gridBasis = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-Math.PI / 2, 0, -Math.PI / 4)
  )
  const catcherBasis = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-Math.PI / 2, 0, 0)
  )

  /* PlaneGeometry starts in XY, while an atomic sheet is built in the wire's
     XZ plane. The extra -45deg maps the shader's diagonal grid lines onto the
     wire's local X/Z axes; inheriting the wire quaternion makes both planes
     genuinely parallel without changing the model transform. */
  grid.quaternion.copy(wire.quaternion).multiply(gridBasis)
  shadowCatcher.quaternion.copy(wire.quaternion).multiply(catcherBasis)

  /* Move the ground, not the model. The catcher sits tangent to the foundation
     atoms and the visible grid stays one clearance step behind it, avoiding
     both intersections and a floating gap. */
  const groundDistance = (ATOM_RADIUS * wire.scale.y) + SHADOW_CATCHER_CLEARANCE
  grid.position.copy(wire.position).addScaledVector(wireNormal, -groundDistance)
  shadowCatcher.position
    .copy(grid.position)
    .addScaledVector(wireNormal, SHADOW_CATCHER_CLEARANCE)
}

export async function createNanowireScene(host, loupeHost, options = {}) {
  const {
    reducedMotion = false,
    defectSeed = createDefectSeed(),
    flowSeed = NANOWIRE_FLOW_DEFAULT_SEED
  } = options
  const defect = resolveNanowireDefect(defectSeed)
  const defectIndex = defect.index
  const THREE = await import('three')
  const rendererLease = leaseWebGLRenderer(THREE, {
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  })
  const { renderer } = rendererLease
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.08
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.domElement.className = 'nw__canvas'
  renderer.domElement.setAttribute('aria-hidden', 'true')
  host.append(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 100)
  camera.position.set(-10.5, 13.2, 19)
  camera.lookAt(0, 1.15, 0)
  camera.layers.set(0)

  /* IQM, 25 Aug: "a simultaneous zoom out to fit the entire sheet comfortably.
     Use the grid size below to support the illusion of panning out."

     The camera starts close on the single atom and eases back to the authored
     framing while the sheet fills in, so the sheet grows into a view that is
     making room for it rather than appearing inside a view that was always
     going to fit. The grid is what sells it: fixed in world space, it slides
     outward as the camera pulls back and gives the move something to be
     measured against.

     The offset is scaled, never re-aimed, and the end of the intro copies the
     authored position back exactly. Everything downstream assumes that framing
     — the loupe's magnifier camera copies this one, and the defect's projected
     screen position is cached until something says otherwise. */
  const introCameraTarget = new THREE.Vector3(0, 1.15, 0)
  const introCameraOffset = camera.position.clone().sub(introCameraTarget)
  const introCameraHome = camera.position.clone()
  /* The aim travels with the distance. Dollying towards a point above the wire
     while leaving the aim there pushes the atoms down out of the middle of the
     frame, which is not what the board draws — it keeps the subject centred the
     whole way through. So the close end aims at the atoms themselves and the
     far end lands exactly on the authored aim. */
  const introCameraNearAim = new THREE.Vector3(0, 0.25, 0)
  const introCameraAim = new THREE.Vector3()
  const INTRO_CAMERA_PULL_IN = 0.66
  let introCameraMoved = false

  const magnifierCamera = camera.clone()
  magnifierCamera.layers.set(2)
  const magnifierRendererLease = loupeHost
    ? leaseWebGLRenderer(THREE, {
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
      })
    : null
  const magnifierRenderer = magnifierRendererLease?.renderer ?? null
  if (magnifierRenderer) {
    magnifierRenderer.outputColorSpace = THREE.SRGBColorSpace
    magnifierRenderer.toneMapping = THREE.ACESFilmicToneMapping
    magnifierRenderer.toneMappingExposure = 1.08
    magnifierRenderer.setClearColor(LOUPE_BACKGROUND_COLOR, 1)
    magnifierRenderer.domElement.className = 'nw__loupe-canvas'
    magnifierRenderer.domElement.setAttribute('aria-hidden', 'true')
    loupeHost.append(magnifierRenderer.domElement)
  }
  const loupeOpticsMaterial = magnifierRenderer
    ? createNanowireLoupeOpticsMaterial(THREE)
    : null
  const loupeOpticsScene = magnifierRenderer ? new THREE.Scene() : null
  const loupeOpticsCamera = magnifierRenderer
    ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    : null
  const loupeOpticsGeometry = magnifierRenderer ? new THREE.PlaneGeometry(2, 2) : null
  const loupeOpticsQuad = magnifierRenderer
    ? new THREE.Mesh(loupeOpticsGeometry, loupeOpticsMaterial)
    : null
  if (loupeOpticsQuad) {
    loupeOpticsQuad.frustumCulled = false
    loupeOpticsScene.add(loupeOpticsQuad)
  }
  let loupeRenderTarget = null
  let loupeOpticsMode = NANOWIRE_LOUPE_OPTICS_MODES.final

  const stage = new THREE.Group()
  stage.name = 'NanowireExperienceStage'
  stage.position.y = NANOWIRE_EXPERIENCE_STAGE_Y
  scene.add(stage)

  const grid = createNanowireExperienceGrid(THREE)
  stage.add(grid)

  const shadowCatcher = createNanowireShadowCatcher(THREE)
  stage.add(shadowCatcher)

  const wire = new THREE.Group()
  wire.scale.setScalar(WIRE_SCALE)
  wire.position.set(-0.08, NANOWIRE_EXPERIENCE_WIRE_Y, 0)
  wire.rotation.set(WIRE_ROTATION_X, WIRE_ROTATION_Y, NANOWIRE_EXPERIENCE_WIRE_ROTATION_Z)
  stage.add(wire)
  alignNanowireGround(THREE, wire, grid, shadowCatcher)
  const wireRestPosition = wire.position.clone()
  const wireRiseDirection = new THREE.Vector3(0, 1, 0).applyQuaternion(wire.quaternion)
  grid.material.uniforms.uOpacity.value = 0
  shadowCatcher.material.opacity = SHADOW_OPACITY * 0.78

  const ambient = new THREE.HemisphereLight(0xffffff, 0x62666d, 2.25)
  ambient.layers.enable(2)
  scene.add(ambient)
  const key = new THREE.DirectionalLight(0xffffff, 3.5)
  key.position.set(7, 14, 2)
  key.target.position.set(0, NANOWIRE_EXPERIENCE_STAGE_Y, 0)
  key.castShadow = true
  key.shadow.mapSize.set(NANOWIRE_SHADOW_MAP_SIZE, NANOWIRE_SHADOW_MAP_SIZE)
  key.shadow.camera.near = 1
  key.shadow.camera.far = 28
  key.shadow.camera.left = -4.6
  key.shadow.camera.right = 4.6
  key.shadow.camera.top = 4.6
  key.shadow.camera.bottom = -4.6
  key.shadow.bias = -0.00035
  key.shadow.normalBias = 0.035
  key.shadow.radius = 0.9
  key.layers.enable(2)
  scene.add(key, key.target)
  const fill = new THREE.DirectionalLight(0xdde3ec, 1.35)
  fill.position.set(9, 3, -8)
  fill.layers.enable(2)
  scene.add(fill)

  const geometry = new THREE.SphereGeometry(ATOM_RADIUS, 16, 12)
  const material = createAtomMaterial(THREE)
  const atoms = new THREE.InstancedMesh(geometry, material, TOTAL_ATOMS)
  atoms.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  atoms.frustumCulled = false
  atoms.castShadow = true
  atoms.layers.set(0)
  wire.add(atoms)

  const magnifierAtoms = new THREE.InstancedMesh(geometry, material, TOTAL_ATOMS)
  magnifierAtoms.name = 'NanowireMagnifierAtoms'
  magnifierAtoms.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  magnifierAtoms.frustumCulled = false
  magnifierAtoms.layers.set(2)
  wire.add(magnifierAtoms)

  const defectMaterial = new THREE.MeshPhysicalMaterial({
    color: DEFECT_CORE_COLOR,
    emissive: DEFECT_CORE_EMISSIVE,
    emissiveIntensity: 0.72,
    ...NANOWIRE_ATOM_SURFACE,
    transparent: true,
    opacity: 0,
    depthWrite: false
  })
  const defectAtom = new THREE.Mesh(geometry, defectMaterial)
  defectAtom.layers.set(2)
  defectAtom.renderOrder = 4
  defectAtom.visible = false
  wire.add(defectAtom)

  /* One screen-facing Gaussian shader supplies both semantic states. This is a
     bounded bloom-like spread: smooth at every pixel and independent of the
     sphere tessellation, while the solid defect renders over its centre. */
  const defectGlowAtom = createGaussianGlow(THREE, {
    color: DEFECT_GLOW_COLOR,
    intensity: 1.55,
    falloff: DEFECT_GLOW_FALLOFF
  })
  defectGlowAtom.name = 'NanowireDefectGlow'
  defectGlowAtom.layers.set(2)
  defectGlowAtom.renderOrder = 3
  wire.add(defectGlowAtom)

  const matrix = new THREE.Matrix4()
  const vector = new THREE.Vector3()
  const errorOffset = new THREE.Vector3()
  const errorDirection = new THREE.Vector3()
  const defectWorldPosition = new THREE.Vector3()
  const defectProjectionNdc = new THREE.Vector2()
  const defectScreenPosition = { x: 0, y: 0 }
  const openingAtomMatrix = new THREE.Matrix4()
  const openingAtomWorldPosition = new THREE.Vector3()
  const openingAtomScreenPosition = { x: 0, y: 0 }
  const quaternion = new THREE.Quaternion()
  const atomScale = new THREE.Vector3(1, 1, 1)
  const workingColor = new THREE.Color()
  const magnifierWorkingColor = new THREE.Color()
  const magnifierCorrectedColor = new THREE.Color()
  const finalFlowTarget = new THREE.Color()
  const neutralColor = new THREE.Color(NANOWIRE_COLORS.neutral)
  const airborneColor = new THREE.Color(NANOWIRE_COLORS.airborne)
  const repairedDefectColor = new THREE.Color(REPAIRED_DEFECT_COLOR)
  const repairedDefectEmissive = new THREE.Color(REPAIRED_DEFECT_EMISSIVE)
  const defectGlowColor = new THREE.Color(DEFECT_GLOW_COLOR)
  const repairedGlowColor = new THREE.Color(NANOWIRE_COLORS.repairHalo)
  const perturbedFlowColors = NANOWIRE_PERTURBED_FLOW_GRADIENT.map(color => new THREE.Color(color))
  const loupeErrorColors = NANOWIRE_LOUPE_ERROR_GRADIENT.map(color => new THREE.Color(color))
  const loupeCorrectedColors = NANOWIRE_LOUPE_CORRECTED_GRADIENT.map(color => new THREE.Color(color))
  const correctedPulseOptions = {}
  const finalFlowBase = new THREE.Color(NANOWIRE_FINAL_FLOW_BASE)
  const finalFlowPulse = new THREE.Color(NANOWIRE_FINAL_FLOW_PULSE)
  const flowFieldOptions = {
    debugMode: NANOWIRE_FLOW_DEBUG_MODES.final,
    seed: flowSeed
  }
  const gradientSpan = { lower: 0, upper: 0, mix: 0 }
  const buildState = {
    atomicLayer: 0,
    sheet: -1,
    progress: 1,
    offsetY: 0,
    visible: true,
    scale: 1
  }
  const errorTransformState = { reveal: 0, repair: 0 }
  const targetPositions = Array.from({ length: TOTAL_ATOMS }, (_, index) => {
    const layer = Math.floor(index / ATOMS_PER_ATOMIC_LAYER)
    const inLayer = index % ATOMS_PER_ATOMIC_LAYER
    const long = Math.floor(inLayer / ATOMS_WIDE)
    const wide = inLayer % ATOMS_WIDE
    return new THREE.Vector3(
      (long - (ATOMS_LONG - 1) / 2) * ATOM_SPACING,
      layer * ATOM_SPACING,
      (wide - (ATOMS_WIDE - 1) / 2) * ATOM_SPACING
    )
  })
  const scanVibrationPhases = new Float32Array(TOTAL_ATOMS)
  const scanVibrationDirections = new Float32Array(TOTAL_ATOMS * 3)
  for (let index = 0; index < TOTAL_ATOMS; index += 1) {
    const sample = index + 1
    const phase = ((sample * 0.61803398875) % 1) * Math.PI * 2
    const azimuth = ((sample * 0.75487766625) % 1) * Math.PI * 2
    const vertical = ((((sample * 0.569840296) % 1) * 2) - 1) * 0.72
    const horizontal = Math.sqrt(1 - (vertical * vertical))
    const directionOffset = index * 3
    scanVibrationPhases[index] = phase
    scanVibrationDirections[directionOffset] = Math.cos(azimuth) * horizontal
    scanVibrationDirections[directionOffset + 1] = vertical
    scanVibrationDirections[directionOffset + 2] = Math.sin(azimuth) * horizontal
  }
  const minimumWireX = targetPositions[0].x
  const maximumWireX = targetPositions[ATOMS_PER_ATOMIC_LAYER - 1].x
  const normalizedPositions = targetPositions.map(position => Object.freeze({
    x: (position.x - minimumWireX) / (maximumWireX - minimumWireX),
    y: position.y / ((ATOMIC_LAYER_COUNT - 1) * ATOM_SPACING),
    z: (position.z / ((ATOMS_WIDE - 1) * ATOM_SPACING)) + 0.5
  }))
  const defectPosition = targetPositions[defectIndex].clone()
  const loupeFieldDistances = targetPositions.map(position => Math.hypot(
    (position.x - defectPosition.x) / LOUPE_FIELD_RADII.longitudinal,
    (position.y - defectPosition.y) / LOUPE_FIELD_RADII.vertical,
    (position.z - defectPosition.z) / LOUPE_FIELD_RADII.lateral
  ))
  const firstSheetSourceOffset = resolveRigidSheetDrop(0).offsetY
  const introTiming = reducedMotion ? NANOWIRE_INTRO_REDUCED_TIMING : NANOWIRE_INTRO_TIMING
  const introTimelineOptions = { timing: introTiming }
  const introTimelineState = {
    stage: 'atom',
    atomProgress: 0,
    lineProgress: 0,
    sheetProgress: 0,
    handoffProgress: 0,
    complete: false,
    totalDuration: introTiming.totalDuration
  }
  const introCoordinates = { long: 0, wide: 0 }
  const introOptions = { reducedMotion }
  const introAtomState = { x: 0, y: 0, z: 0, scale: 0, visible: false }
  const sheetStagger = reducedMotion ? 52 : 270
  const atomFallDuration = reducedMotion ? 145 : 760
  const buildDuration = ((SHEET_COUNT - 1) * sheetStagger) + atomFallDuration + 120
  /* The loupe is the actual interaction, so the automatic scan should establish
     the perturbation quickly and hand control over without a dead wait. */
  const scanDuration = reducedMotion ? 180 : 700
  const scanSettleDuration = reducedMotion ? 20 : 80
  const errorRevealDuration = reducedMotion ? 180 : 760
  /* Let the red-to-gray core resolve before the surrounding field finishes.
     The slightly longer calibration keeps both changes readable at kiosk
     scale without turning the handoff into a separate scene. */
  const defectRepairDuration = reducedMotion ? 150 : 600
  const repairFieldDuration = reducedMotion ? 170 : 700
  const repairDuration = defectRepairDuration + repairFieldDuration
  const sheetDropOptions = { stagger: sheetStagger, duration: atomFallDuration }
  const errorRevealOptions = { duration: errorRevealDuration }
  const repairSequenceOptions = {
    atomDuration: defectRepairDuration,
    fieldDuration: repairFieldDuration
  }
  const pendingDelays = new Map()
  let introStartedAt = null
  const sceneStartedAt = performance.now()
  let introCompleted = false
  let introStage = 'atom'
  let introStageCallback = null
  let introPromise = null
  let buildStartedAt = null
  let transformMode = 'intro-idle'
  let transformDirty = true
  let colorDirty = true
  let scanStartedAt = null
  let scanVibrationApplied = false
  let inspectionStartedAt = null
  let inspectionRevealSettled = false
  let defectRevealed = false
  let repairStartedAt = null
  let repairCompleteAt = null
  let finalFlowStartedAt = null
  let finalRiseSettled = false
  const magnifierCenter = { x: 0, y: 0 }
  let magnifierHasCenter = false
  let magnifierLockedToDefect = false
  let magnifierVisible = false
  let hostWidth = 0
  let hostHeight = 0
  let loupeWidth = 0
  let loupeHeight = 0
  let magnifierRenderWidth = 0
  let magnifierRenderHeight = 0
  let magnifierCameraDirty = true
  let defectProjectionDirty = true
  let raf = null
  let disposed = false

  /* The airborne sheets overlap the foundation on the first screen, but only
     the foundation should contribute to that screen's contact shadow. Limit
     the existing instanced draw only for the shadow pass; the color pass still
     renders every visible atom, and falling sheets regain their shadows once
     the build begins. */
  atoms.onBeforeShadow = () => {
    atoms.count = resolveNanowireShadowAtomCount(buildStartedAt)
  }
  atoms.onAfterShadow = () => {
    atoms.count = TOTAL_ATOMS
  }

  function delay(duration) {
    return new Promise(resolve => {
      const timer = window.setTimeout(() => {
        pendingDelays.delete(timer)
        resolve()
      }, duration)
      pendingDelays.set(timer, resolve)
    })
  }

  function setAtom(mesh, index, position, scale = 1) {
    atomScale.setScalar(Math.max(scale, 0.001))
    matrix.compose(position, quaternion, atomScale)
    mesh.setMatrixAt(index, matrix)
  }

  function getBuildState(index, now, out = buildState) {
    const atomicLayer = Math.floor(index / ATOMS_PER_ATOMIC_LAYER)
    out.atomicLayer = atomicLayer
    if (atomicLayer < FOUNDATION_LAYER_COUNT) {
      out.sheet = -1
      out.progress = 1
      out.offsetY = 0
      out.visible = true
      out.scale = 1
      return out
    }
    const sheet = atomicLayer - FOUNDATION_LAYER_COUNT
    out.sheet = sheet
    if (buildStartedAt === null) {
      const drop = resolveRigidSheetDrop(sheet)
      out.progress = 0
      out.offsetY = drop.offsetY
      out.visible = drop.visible
      out.scale = drop.visible ? 1 : 0
      return out
    }
    const drop = resolveRigidSheetDrop(sheet, now - buildStartedAt, sheetDropOptions)
    out.progress = drop.progress
    out.offsetY = drop.offsetY
    out.visible = drop.visible
    out.scale = drop.visible ? 1 : 0
    return out
  }

  function getErrorTransformProgress(now) {
    errorTransformState.reveal = inspectionStartedAt === null
      ? 0
      : reducedMotion
      ? 1
      : resolveErrorReveal(0, now - inspectionStartedAt, errorRevealOptions)
    errorTransformState.repair = repairStartedAt === null
      ? 0
      : resolveRepairSequence(now - repairStartedAt, repairSequenceOptions).fieldProgress
    return errorTransformState
  }

  function updateIntroEnvironment(timeline) {
    if (!timeline) {
      grid.material.uniforms.uOpacity.value = GRID_OPACITY
      shadowCatcher.material.opacity = SHADOW_OPACITY
      return
    }

    /* The board draws the grid under the opening atom, with big cells that
       shrink as the view pulls back. It starts softly and reaches its authored
       strength while the line and foundation sheet assemble. */
    const gridOpacity = resolveNanowireIntroGridOpacity(timeline, GRID_OPACITY)
    const surfaceReveal = gridOpacity / GRID_OPACITY
    grid.material.uniforms.uOpacity.value = gridOpacity
    shadowCatcher.material.opacity = SHADOW_OPACITY * (0.78 + (surfaceReveal * 0.22))
    if (timeline.stage !== introStage) {
      introStage = timeline.stage
      introStageCallback?.(introStage)
    }
  }

  function updateAtomTransforms(now, introTimeline = null) {
    introOptions.floatElapsed = now - (introStartedAt ?? sceneStartedAt)
    const errorTransformsAreAnimated = inspectionStartedAt !== null
      && (repairStartedAt === null ? !inspectionRevealSettled : repairCompleteAt === null)
    if (
      !transformDirty
      && transformMode !== 'building'
      && introTimeline === null
      && !errorTransformsAreAnimated
    ) return
    let allSettled = transformMode === 'building'
    const errorTransform = getErrorTransformProgress(now)
    for (let index = 0; index < TOTAL_ATOMS; index += 1) {
      if (introTimeline) {
        const atomicLayer = Math.floor(index / ATOMS_PER_ATOMIC_LAYER)
        const inLayer = index % ATOMS_PER_ATOMIC_LAYER
        const long = Math.floor(inLayer / ATOMS_WIDE)
        const wide = inLayer % ATOMS_WIDE
        vector.copy(targetPositions[index])
        let scale = 0

        if (atomicLayer < FOUNDATION_LAYER_COUNT) {
          introCoordinates.long = long
          introCoordinates.wide = wide
          resolveNanowireIntroAtomState(
            introCoordinates,
            introTimeline,
            introOptions,
            introAtomState
          )
          vector.set(introAtomState.x, introAtomState.y, introAtomState.z)
          scale = introAtomState.scale
        } else if (atomicLayer === FOUNDATION_LAYER_COUNT) {
          const handoff = introTimeline.handoffProgress
          vector.y += firstSheetSourceOffset + (reducedMotion ? 0 : (1 - handoff) * 0.28)
          scale = handoff
        }

        setAtom(atoms, index, vector, scale)
        setAtom(magnifierAtoms, index, vector, scale)
        continue
      }

      const state = getBuildState(index, now)
      vector.copy(targetPositions[index])
      if (state.sheet >= 0 && state.progress < 1) {
        vector.y += state.offsetY
        allSettled = false
      }
      setAtom(atoms, index, vector, state.scale)

      errorOffset.copy(vector)
      if (index !== defectIndex && errorTransform.reveal > 0) {
        errorDirection.copy(targetPositions[index]).sub(defectPosition)
        const displacement = resolveErrorDisplacement(
          errorDirection.length(),
          errorTransform.reveal,
          errorTransform.repair
        )
        if (displacement > 0) errorOffset.add(errorDirection.normalize().multiplyScalar(displacement))
      }
      const magnifierScale = defectRevealed && index === defectIndex ? 0.001 : state.scale
      setAtom(magnifierAtoms, index, errorOffset, magnifierScale)
    }
    atoms.instanceMatrix.needsUpdate = true
    magnifierAtoms.instanceMatrix.needsUpdate = true
    transformDirty = false
    if (transformMode === 'building' && allSettled) transformMode = 'settled'
  }

  function updateScanVibration(now) {
    const isScanning = scanStartedAt !== null && inspectionStartedAt === null
    /* Correct is a hard semantic boundary: the unstable material stops moving
       on the input frame. The blue confirmation is colour-only and must never
       inherit the scan vibration. */
    const elapsed = isScanning ? Math.max(0, now - scanStartedAt) : 0
    const envelope = isScanning && !reducedMotion
      ? resolveScanVibrationEnvelope(elapsed, ACTIVE_SCAN_VIBRATION)
      : 0
    if (envelope <= 0 && !scanVibrationApplied) return

    const strength = SCAN_VIBRATION_AMPLITUDE * envelope
    const timePhase = elapsed * SCAN_VIBRATION_ANGULAR_SPEED
    for (let index = 0; index < TOTAL_ATOMS; index += 1) {
      vector.copy(targetPositions[index])
      if (strength > 0) {
        const directionOffset = index * 3
        const offset = Math.sin(timePhase + scanVibrationPhases[index]) * strength
        vector.x += scanVibrationDirections[directionOffset] * offset
        vector.y += scanVibrationDirections[directionOffset + 1] * offset
        vector.z += scanVibrationDirections[directionOffset + 2] * offset
      }
      setAtom(atoms, index, vector)
    }
    atoms.instanceMatrix.needsUpdate = true
    scanVibrationApplied = envelope > 0
  }

  function sampleGradient(colors, value, target) {
    const span = resolveGradientSpan(value, colors.length, gradientSpan)
    return target.copy(colors[span.lower]).lerp(colors[span.upper], span.mix)
  }

  function setLoupeFieldColor(distance, colors, target) {
    if (distance >= 1.16) return target.copy(neutralColor)
    sampleGradient(colors, clamp(distance / 0.92), target)
    if (distance > 0.92) target.lerp(neutralColor, smoothstep(0.92, 1.16, distance))
    return target
  }

  function setMagnifierColor(distance, now, repairFieldProgress, target) {
    const pulse = reducedMotion ? 0 : Math.sin((now * 0.0045) - (distance * 3.2)) * 0.035
    const animatedDistance = Math.max(0, distance + pulse)
    setLoupeFieldColor(animatedDistance, loupeErrorColors, target)
    const reveal = inspectionStartedAt === null
      ? 0
      : reducedMotion
        ? 1
        : resolveErrorReveal(distance, now - inspectionStartedAt, errorRevealOptions)
    target.lerp(neutralColor, 1 - reveal)

    if (repairStartedAt === null) return target
    setLoupeFieldColor(distance, loupeCorrectedColors, magnifierCorrectedColor)
    return target.lerp(magnifierCorrectedColor, repairFieldProgress)
  }

  function setPerturbedFlowColor(normalizedPosition, now, target) {
    const elapsed = reducedMotion ? 4_600 : Math.max(0, now - scanStartedAt)
    const palettePosition = resolvePerturbationField(normalizedPosition, elapsed, flowFieldOptions)
    sampleGradient(perturbedFlowColors, Math.pow(palettePosition, PERTURBATION_RED_BIAS), target)
    const reveal = reducedMotion ? 1 : smoothstep(0, 720, elapsed)
    return target.lerp(neutralColor, 1 - reveal)
  }

  function setCorrectionBeatColor(normalizedPosition, now, target) {
    /* Keep the device on the exact perturbation frame the visitor found while
       the loupe calibrates. The blue finale begins only after the loupe leaves;
       this matches the two annotated Figma states and avoids competing with
       the gray atom / green-glow repair signal inside the lens. */
    return setPerturbedFlowColor(
      normalizedPosition,
      repairStartedAt ?? now,
      target
    )
  }

  function setCorrectedFlowColor(normalizedPosition, now, target) {
    const elapsed = resolveNanowireFinalFlowElapsed(now, {
      finalFlowStartedAt,
      repairStartedAt,
      correctionTransitionDuration: NANOWIRE_CORRECTION_COLOR_TRANSITION.durationMs,
      reducedMotion
    })
    /* Uniform blue, with the one travelling light lifting the atoms it passes.
       Reduced motion holds a fixed elapsed, which parks the pulse rather than
       running it — the wire still reads as finished, it just does not move. */
    finalFlowTarget.copy(finalFlowBase)
    const pulse = resolveCorrectedPulse(normalizedPosition, elapsed, correctedPulseOptions)
    if (pulse > 0) finalFlowTarget.lerp(finalFlowPulse, pulse)

    const handoff = resolveNanowireFinalHandoff(now - finalFlowStartedAt, {
      durationMs: NANOWIRE_FINAL_HANDOFF.durationMs,
      reducedMotion
    })
    if (handoff >= 1) return target.copy(finalFlowTarget)

    /* Both sides now sample the same repair-origin clock. The handoff can
       preserve the material transition without fading between pulse epochs. */
    setCorrectionBeatColor(normalizedPosition, now, target)
    return target.lerp(finalFlowTarget, handoff)
  }

  function updateAtomColors(now) {
    const colorsAreAnimated = transformMode === 'building'
      || scanStartedAt !== null
    if (!colorDirty && !colorsAreAnimated) return
    const repairFieldProgress = repairStartedAt === null
      ? 0
      : repairCompleteAt !== null
        ? 1
        : resolveRepairSequence(now - repairStartedAt, repairSequenceOptions).fieldProgress

    for (let index = 0; index < TOTAL_ATOMS; index += 1) {
      const normalizedPosition = normalizedPositions[index]

      if (finalFlowStartedAt !== null) {
        setCorrectedFlowColor(normalizedPosition, now, workingColor)
      } else if (repairStartedAt !== null) {
        setCorrectionBeatColor(normalizedPosition, now, workingColor)
      } else if (scanStartedAt !== null) {
        setPerturbedFlowColor(normalizedPosition, now, workingColor)
      } else {
        const state = getBuildState(index, now)
        if (state.sheet >= 0) {
          workingColor.copy(airborneColor).lerp(neutralColor, state.progress)
        } else {
          workingColor.copy(neutralColor)
        }
      }
      atoms.setColorAt(index, workingColor)
      if (magnifierVisible) {
        setMagnifierColor(loupeFieldDistances[index], now, repairFieldProgress, magnifierWorkingColor)
        magnifierAtoms.setColorAt(index, magnifierWorkingColor)
      }
    }
    atoms.instanceColor.needsUpdate = true
    if (magnifierVisible) magnifierAtoms.instanceColor.needsUpdate = true
    if (
      inspectionStartedAt !== null
      && now - inspectionStartedAt >= errorRevealDuration
    ) inspectionRevealSettled = true
    colorDirty = false
  }

  function updateDefect(now) {
    if (!defectRevealed) {
      defectAtom.visible = false
      defectGlowAtom.visible = false
      return
    }
    const errorReveal = inspectionStartedAt === null || reducedMotion
      ? 1
      : resolveErrorReveal(0, now - inspectionStartedAt, errorRevealOptions)
    if (errorReveal <= 0) {
      defectAtom.visible = false
      defectGlowAtom.visible = false
      return
    }
    defectAtom.visible = true
    defectGlowAtom.visible = true
    defectAtom.position.copy(defectPosition)
    defectGlowAtom.position.copy(defectPosition)
    defectMaterial.opacity = errorReveal
    if (repairStartedAt === null) {
      defectMaterial.color.set(DEFECT_CORE_COLOR)
      defectMaterial.emissive.set(DEFECT_CORE_EMISSIVE)
      defectMaterial.emissiveIntensity = 1.12
      const pulse = (Math.sin(now * 0.005) + 1) * 0.5
      const defectScale = 0.9 + (errorReveal * 0.25) + (pulse * 0.026 * errorReveal)
      defectAtom.scale.setScalar(defectScale)
      defectGlowColor.set(DEFECT_GLOW_COLOR)
      updateGaussianGlow(defectGlowAtom, {
        color: defectGlowColor,
        cue: errorReveal * (0.78 + (pulse * 0.22)),
        intensity: 1.55,
        falloff: DEFECT_GLOW_FALLOFF,
        motion: !reducedMotion,
        time: now / 1_000
      })
      defectGlowAtom.scale.setScalar(defectScale * (0.88 + (pulse * 0.025)))
      return
    }
    const repairElapsed = now - repairStartedAt
    const repairSequence = resolveRepairSequence(repairElapsed, repairSequenceOptions)
    defectMaterial.color.set(DEFECT_CORE_COLOR).lerp(repairedDefectColor, repairSequence.atomProgress)
    defectMaterial.emissive.set(DEFECT_CORE_EMISSIVE).lerp(repairedDefectEmissive, repairSequence.atomProgress)
    defectMaterial.emissiveIntensity = 1.12 - (repairSequence.atomProgress * 1.02)
    defectGlowColor
      .set(DEFECT_GLOW_COLOR)
      .lerp(repairedGlowColor, repairSequence.atomProgress)
    updateGaussianGlow(defectGlowAtom, {
      color: defectGlowColor,
      cue: 0.84 + (repairSequence.atomProgress * 0.16),
      intensity: 1.55 + (repairSequence.atomProgress * 0.05),
      falloff: DEFECT_GLOW_FALLOFF + (
        (REPAIRED_GLOW_FALLOFF - DEFECT_GLOW_FALLOFF) * repairSequence.atomProgress
      ),
      motion: !reducedMotion,
      time: now / 1_000
    })
    /* Settle monotonically to the normal atom size. There is no celebratory
       bounce here: the travelling light supplies the confirmation motion. */
    const repairedScale = 1.15 - (repairSequence.atomProgress * 0.15)
    defectAtom.scale.setScalar(repairedScale)
    defectGlowAtom.scale.setScalar(repairedScale * (0.9 + (repairSequence.atomProgress * 0.035)))
    if (repairSequence.complete && repairCompleteAt === null) {
      repairCompleteAt = now
      colorDirty = true
      transformDirty = true
    }
  }

  function projectDefectToScreen(out = defectScreenPosition) {
    if (defectProjectionDirty) {
      wire.updateWorldMatrix(true, false)
      camera.updateMatrixWorld()
      defectWorldPosition
        .copy(defectAtom.visible ? defectAtom.position : defectPosition)
        .applyMatrix4(wire.matrixWorld)
        .project(camera)
      defectProjectionNdc.set(defectWorldPosition.x, defectWorldPosition.y)
      defectProjectionDirty = false
    }
    out.x = (defectProjectionNdc.x + 1) * 0.5 * Math.max(hostWidth, 1)
    out.y = (1 - defectProjectionNdc.y) * 0.5 * Math.max(hostHeight, 1)
    return out
  }

  function getDefectScreenPosition() {
    return projectDefectToScreen()
  }

  function getOpeningAtomScreenPosition(out = openingAtomScreenPosition) {
    /* Use the rendered instance transform, not a second layout estimate. This
       follows the atom's authored float and remains correct if the camera,
       wire rotation, or kiosk aspect changes later. */
    atoms.getMatrixAt(INTRO_HERO_INDEX, openingAtomMatrix)
    wire.updateWorldMatrix(true, false)
    camera.updateMatrixWorld()
    openingAtomWorldPosition
      .setFromMatrixPosition(openingAtomMatrix)
      .applyMatrix4(wire.matrixWorld)
      .project(camera)
    out.x = (openingAtomWorldPosition.x + 1) * 0.5 * Math.max(hostWidth, 1)
    out.y = (1 - openingAtomWorldPosition.y) * 0.5 * Math.max(hostHeight, 1)
    return out
  }

  function renderMagnifier(preparing = false) {
    if (!magnifierRenderer || (!preparing && (!magnifierVisible || !magnifierHasCenter))) return
    const width = Math.max(loupeWidth, 1)
    const height = Math.max(loupeHeight, 1)
    if (width !== magnifierRenderWidth || height !== magnifierRenderHeight) {
      magnifierRenderWidth = width
      magnifierRenderHeight = height
      magnifierRenderer.setSize(width, height, false)
      const renderScale = Math.min(
        magnifierRenderer.getPixelRatio(),
        NANOWIRE_LOUPE_OPTICS.maximumRenderSize / Math.max(width, height)
      )
      loupeRenderTarget?.dispose()
      loupeRenderTarget = new THREE.WebGLRenderTarget(
        Math.max(1, Math.round(width * renderScale)),
        Math.max(1, Math.round(height * renderScale)),
        {
          depthBuffer: true,
          stencilBuffer: false,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter
        }
      )
      loupeRenderTarget.texture.name = 'NanowireLoupeSceneTexture'
      loupeRenderTarget.texture.colorSpace = THREE.SRGBColorSpace
      loupeOpticsMaterial.uniforms.uScene.value = loupeRenderTarget.texture
    }
    if (magnifierCameraDirty) {
      const fullWidth = Math.max(hostWidth, 1)
      const fullHeight = Math.max(hostHeight, 1)
      const magnification = 3.05
      const sampleWidth = width / magnification
      const sampleHeight = height / magnification
      /* Repair changes the atom's scale, not its projected centre, so the
         cached projection remains exact until the host or camera resizes. */
      const sampleCenter = magnifierLockedToDefect
        ? projectDefectToScreen()
        : magnifierCenter
      const offsetX = clamp(sampleCenter.x - sampleWidth * 0.5, 0, fullWidth - sampleWidth)
      const offsetY = clamp(sampleCenter.y - sampleHeight * 0.5, 0, fullHeight - sampleHeight)
      magnifierCamera.copy(camera)
      magnifierCamera.layers.set(2)
      magnifierCamera.setViewOffset(fullWidth, fullHeight, offsetX, offsetY, sampleWidth, sampleHeight)
      magnifierCamera.updateProjectionMatrix()
      magnifierCameraDirty = false
    }
    if (loupeOpticsMode === NANOWIRE_LOUPE_OPTICS_MODES.undistorted || !loupeRenderTarget) {
      magnifierRenderer.setRenderTarget(null)
      magnifierRenderer.render(scene, magnifierCamera)
      return
    }
    magnifierRenderer.setRenderTarget(loupeRenderTarget)
    magnifierRenderer.render(scene, magnifierCamera)
    magnifierRenderer.setRenderTarget(null)
    loupeOpticsMaterial.uniforms.uDebugMode.value = loupeOpticsMode === NANOWIRE_LOUPE_OPTICS_MODES.distortion
      ? 2
      : 0
    magnifierRenderer.render(loupeOpticsScene, loupeOpticsCamera)
  }

  /* Pulls the view back across the intro, then puts it exactly where it was. */
  function updateIntroCamera(timeline, elapsed) {
    if (timeline === null || reducedMotion) {
      if (!introCameraMoved) return
      camera.position.copy(introCameraHome)
      camera.lookAt(introCameraTarget)
      camera.updateMatrixWorld()
      defectProjectionDirty = true
      introCameraMoved = false
      return
    }

    const linear = Math.min(1, Math.max(0, elapsed / introTiming.totalDuration))
    /* Eased both ends, per the note. Slow to leave the atom, slow to settle on
       the finished sheet, quickest in the middle where the sheet is filling. */
    const eased = linear < 0.5
      ? 2 * linear * linear
      : 1 - (((-2 * linear) + 2) ** 2) / 2
    const distance = INTRO_CAMERA_PULL_IN + ((1 - INTRO_CAMERA_PULL_IN) * eased)

    introCameraAim.lerpVectors(introCameraNearAim, introCameraTarget, eased)
    camera.position.copy(introCameraAim).addScaledVector(introCameraOffset, distance)
    camera.lookAt(introCameraAim)
    camera.updateMatrixWorld()
    /* The cached defect projection is only ever invalidated on a resize, so a
       moving camera has to say so itself. */
    defectProjectionDirty = true
    introCameraMoved = true
  }

  function updateFinalRise(now) {
    if (finalFlowStartedAt === null || finalRiseSettled) return
    const progress = resolveNanowireFinalRise(now - finalFlowStartedAt, { reducedMotion })
    wire.position
      .copy(wireRestPosition)
      .addScaledVector(wireRiseDirection, NANOWIRE_FINAL_RISE.distance * progress)
    defectProjectionDirty = true
    magnifierCameraDirty = true
    finalRiseSettled = progress >= 1
  }

  function render(now) {
    if (disposed) return
    const introElapsed = introStartedAt === null ? 0 : now - introStartedAt
    const introTimeline = introCompleted
      ? null
      : resolveNanowireIntroSequence(
          introElapsed,
          introTimelineOptions,
          introTimelineState
        )
    updateIntroCamera(introTimeline, introElapsed)
    updateIntroEnvironment(introTimeline)
    updateFinalRise(now)
    updateAtomTransforms(now, introTimeline)
    updateScanVibration(now)
    updateAtomColors(now)
    updateDefect(now)
    renderer.render(scene, camera)
    renderMagnifier()
    raf = requestAnimationFrame(render)
  }

  const resize = () => {
    const nextHostWidth = Math.max(host.clientWidth, 1)
    const nextHostHeight = Math.max(host.clientHeight, 1)
    const pixelRatio = calculateStageAwarePixelRatio({
      width: nextHostWidth, height: nextHostHeight,
      cssScale: elementCssScale(host), devicePixelRatio: window.devicePixelRatio || 1,
      maxRenderPixels: 4_500_000, minPixelRatio: 0.1, maxPixelRatio: 1
    })
    if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio)
    if (nextHostWidth !== hostWidth || nextHostHeight !== hostHeight) {
      hostWidth = nextHostWidth
      hostHeight = nextHostHeight
      renderer.setSize(hostWidth, hostHeight, false)
      camera.aspect = hostWidth / hostHeight
      camera.updateProjectionMatrix()
      defectProjectionDirty = true
      magnifierCameraDirty = true
    }
    if (!loupeHost) return
    const nextLoupeWidth = Math.max(loupeHost.clientWidth, 1)
    const nextLoupeHeight = Math.max(loupeHost.clientHeight, 1)
    const loupePixelRatio = calculateStageAwarePixelRatio({
      width: nextLoupeWidth, height: nextLoupeHeight,
      cssScale: elementCssScale(loupeHost), devicePixelRatio: window.devicePixelRatio || 1,
      maxRenderPixels: NANOWIRE_LOUPE_OPTICS.maximumRenderSize ** 2,
      minPixelRatio: 0.1, maxPixelRatio: 1.2
    })
    if (magnifierRenderer.getPixelRatio() !== loupePixelRatio) {
      magnifierRenderer.setPixelRatio(loupePixelRatio)
      magnifierRenderWidth = 0
    }
    if (nextLoupeWidth === loupeWidth && nextLoupeHeight === loupeHeight) return
    loupeWidth = nextLoupeWidth
    loupeHeight = nextLoupeHeight
    magnifierCameraDirty = true
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  observer.observe(host.closest('#kiosk-stage') || host)
  window.addEventListener('resize', resize)
  if (loupeHost) observer.observe(loupeHost)
  const controller = {
    playIntro(options = {}) {
      if (introPromise) return introPromise
      introStageCallback = typeof options.onStage === 'function' ? options.onStage : null
      introStartedAt = performance.now()
      introStage = 'atom'
      transformMode = 'intro'
      transformDirty = true
      colorDirty = true
      introStageCallback?.(introStage)
      introPromise = delay(introTiming.totalDuration).then(() => {
        if (disposed) return false
        introCompleted = true
        transformMode = 'ready'
        transformDirty = true
        updateIntroEnvironment(null)
        introStage = 'complete'
        introStageCallback?.(introStage)
        return true
      })
      return introPromise
    },
    buildAllLayers() {
      if (buildStartedAt !== null) return Promise.resolve()
      buildStartedAt = performance.now()
      transformMode = 'building'
      transformDirty = true
      colorDirty = true
      return delay(buildDuration)
    },
    scanForDefect() {
      if (scanStartedAt !== null) return Promise.resolve()
      scanStartedAt = performance.now()
      scanVibrationApplied = false
      colorDirty = true
      return delay(scanDuration + scanSettleDuration)
    },
    beginInspection() {
      inspectionStartedAt = performance.now()
      scanVibrationApplied = false
      magnifierLockedToDefect = false
      magnifierCameraDirty = true
      inspectionRevealSettled = false
      defectRevealed = true
      transformDirty = true
      colorDirty = true
    },
    getOpeningAtomScreenPosition,
    getDefectScreenPosition,
    setMagnifierPosition(x, y) {
      if (magnifierHasCenter && magnifierCenter.x === x && magnifierCenter.y === y) return
      magnifierCenter.x = x
      magnifierCenter.y = y
      magnifierHasCenter = true
      magnifierCameraDirty = true
    },
    setMagnifierDefectLock(locked) {
      const nextLocked = Boolean(locked)
      if (magnifierLockedToDefect === nextLocked) return
      magnifierLockedToDefect = nextLocked
      magnifierCameraDirty = true
    },
    setMagnifierVisible(visible) {
      const nextVisible = Boolean(visible)
      if (magnifierVisible !== nextVisible) magnifierCameraDirty = true
      magnifierVisible = nextVisible
      if (!nextVisible && magnifierLockedToDefect) {
        magnifierLockedToDefect = false
        magnifierCameraDirty = true
      }
    },
    repairDefect() {
      if (repairStartedAt !== null) return Promise.resolve()
      repairStartedAt = performance.now()
      transformDirty = true
      colorDirty = true
      return delay(repairDuration)
    },
    beginFinalFlow(startedAt = performance.now()) {
      finalFlowStartedAt = startedAt
      finalRiseSettled = false
      wire.position.copy(wireRestPosition)
      colorDirty = true
    },
    setFlowDebugMode(mode) {
      if (!Object.values(NANOWIRE_FLOW_DEBUG_MODES).includes(mode)) return false
      flowFieldOptions.debugMode = mode
      colorDirty = true
      return true
    },
    setLoupeOpticsMode(mode) {
      if (!Object.values(NANOWIRE_LOUPE_OPTICS_MODES).includes(mode)) return false
      loupeOpticsMode = mode
      return true
    },
    dispose() {
      disposed = true
      if (raf !== null) cancelAnimationFrame(raf)
      observer.disconnect()
      window.removeEventListener('resize', resize)
      for (const [timer, resolve] of pendingDelays) {
        window.clearTimeout(timer)
        resolve()
      }
      pendingDelays.clear()
      atoms.dispose()
      magnifierAtoms.dispose()
      geometry.dispose()
      material.dispose()
      defectMaterial.dispose()
      disposeGaussianGlow(defectGlowAtom)
      key.shadow.map?.dispose()
      key.shadow.map = null
      shadowCatcher.geometry.dispose()
      shadowCatcher.material.dispose()
      grid.geometry.dispose()
      grid.material.dispose()
      magnifierRenderer?.setRenderTarget(null)
      if (loupeOpticsMaterial?.uniforms?.uScene) {
        loupeOpticsMaterial.uniforms.uScene.value = null
      }
      loupeRenderTarget?.dispose()
      loupeOpticsGeometry?.dispose()
      loupeOpticsMaterial?.dispose()
      loupeOpticsScene?.clear()
      scene.clear()
      rendererLease.release()
      magnifierRendererLease?.release()
    }
  }
  try {
    resize()
    if (magnifierRenderer) {
      // Allocate the lens at its real size while the module is still covered.
      // This renderer has its own GPU programs and cannot reuse the main view's.
      renderMagnifier(true)
      magnifierRenderer.setRenderTarget(loupeRenderTarget)
      await warmSceneVariants(magnifierRenderer, scene, magnifierCamera)
      magnifierRenderer.setRenderTarget(null)
      await magnifierRenderer.compileAsync(loupeOpticsScene, loupeOpticsCamera)
      renderMagnifier(true)
    }
    raf = requestAnimationFrame(render)
    return controller
  } catch (error) {
    controller.dispose()
    throw error
  }
}
