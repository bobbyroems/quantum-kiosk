import { createFrostShell } from '../../core/error-correction-ball.js'
import {
  aimCropAtSphere,
  applyCropToTree,
  createCropUniforms
} from '../../core/sphere-crop.js'
import {
  NANOWIRE_FLOW_DEBUG_MODES,
  NANOWIRE_FLOW_DEFAULT_SEED,
  resolveCorrectionPulse,
  resolveCorrectedPulse,
  resolveGradientSpan,
  resolvePerturbationField,
  resolveRepairSequence
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

const clamp01 = value => Math.min(1, Math.max(0, value))

const smooth01 = value => {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

const smoothRange = (value, start, end) => {
  if (value <= start) return 0
  if (value >= end) return 1
  return smooth01((value - start) / (end - start))
}

export const NANOWIRE_MENU_LOOP_SECONDS = 21
export const NANOWIRE_MENU_SEQUENCE_SECONDS = 14
const NANOWIRE_MENU_STORY_SECONDS = 10
const NANOWIRE_MENU_STORY_RATE = NANOWIRE_MENU_STORY_SECONDS / NANOWIRE_MENU_SEQUENCE_SECONDS
const NANOWIRE_MENU_SCAN_START_SECONDS = 0.95 / NANOWIRE_MENU_STORY_RATE
const NANOWIRE_MENU_INSPECTION_START_SECONDS = 2.7 / NANOWIRE_MENU_STORY_RATE
const NANOWIRE_MENU_REPAIR_START_SECONDS = 4.2 / NANOWIRE_MENU_STORY_RATE
const NANOWIRE_MENU_DEFECT_REVEAL_DURATION_MS = 760
const NANOWIRE_MENU_DEFECT_REPAIR_DURATION_MS = 620
const NANOWIRE_MENU_REPAIR_FIELD_DURATION_MS = 720
export const NANOWIRE_MENU_MOTIF_PITCH = 2
export const NANOWIRE_MENU_TRAVEL_MOTIFS = 3
export const NANOWIRE_MENU_LAYER_BIAS = 0.006
export const NANOWIRE_MENU_LAYER_BASE_BIAS = 0.052
/*
 * Composition width as a percentage of the scene box. Scaling the authored radius
 * preserves atom spacing and every effect, so this is purely how close the camera
 * sits to the lattice.
 *
 * The reference crop put roughly 4.8 atom diameters across the frame, which an atom
 * being 0.6 composition radii wide (atomRadius is 0.3 of the radius) makes 69.4.
 * A quarter off that reads better on the real card than the reference proportion
 * does — the lattice is a texture behind the title, not the subject.
 */
export const NANOWIRE_MENU_SCALE_PERCENT = 52.05
export const NANOWIRE_MENU_MOTIF_COUNT = 21
export const NANOWIRE_MENU_PORTAL = Object.freeze({
  /* The outer composition stays the same size, while the actual portal matches
     the roughly one-third-card circles used by the neighbouring modules. */
  circleScale: 0.63,
  /* Five atom diameters remain visible across the crop, which keeps the moving
     scan, defect and repair legible without turning the portal into a texture. */
  wireScale: 0.44,
  offsetX: 0,
  offsetY: 0,
  cropInset: 0.92,
  tint: '#d7f2ed'
})
export const NANOWIRE_MENU_ERROR_DEFORMATION = Object.freeze({
  longitudinalRadius: 3.2,
  verticalRadius: 2.7,
  maximumOffset: 0.28
})
export const NANOWIRE_MENU_FOCUSED_ERROR_COLOR = NANOWIRE_COLORS.defectCore
export const NANOWIRE_MENU_ERROR_GRADIENT = NANOWIRE_PERTURBED_FLOW_GRADIENT
export const NANOWIRE_MENU_INSPECTION_GRADIENT = NANOWIRE_LOUPE_ERROR_GRADIENT
export const NANOWIRE_MENU_INSPECTION_REPAIRED_GRADIENT = NANOWIRE_LOUPE_CORRECTED_GRADIENT
export const NANOWIRE_MENU_FINAL_FLOW_BASE = NANOWIRE_FINAL_FLOW_BASE
export const NANOWIRE_MENU_FINAL_FLOW_PULSE = NANOWIRE_FINAL_FLOW_PULSE
export const NANOWIRE_MENU_COLOR_TREATMENT = Object.freeze({
  neutral: NANOWIRE_COLORS.neutral,
  paletteSaturation: 0,
  paletteLightness: 0,
  scanMix: 1,
  flowMix: 1
})
export const NANOWIRE_MENU_MATERIAL = Object.freeze({
  ...NANOWIRE_ATOM_SURFACE
})
export const NANOWIRE_MENU_LIGHTING = Object.freeze({
  areaKey: false,
  environmentIntensity: 0.12,
  areaSize: 6.2,
  keyColor: '#ffffff',
  keyIntensity: 3.5,
  keyX: 7,
  keyY: 14,
  keyZ: 8,
  hemiIntensity: 2,
  hemiSky: '#ffffff',
  hemiGround: '#091f2c'
})
export const NANOWIRE_MENU_PATTERN = Object.freeze([
  Object.freeze({ role: 'pair-top', x: 0, y: -1, z: 0 }),
  Object.freeze({ role: 'pair-bottom', x: 0, y: 1, z: 0 }),
  Object.freeze({ role: 'single', x: 1, y: 0, z: 0 })
])
export const NANOWIRE_MENU_DEBUG_MODES = Object.freeze(['final', 'base', 'effects'])

/**
 * A condensed version of the module story: the lattice keeps travelling through
 * the crop while it develops the same moving perturbation field, settles for
 * inspection, repairs, and returns to its neutral state.
 */
export function sampleNanowireMenuLoop(seconds, { reducedMotion = false } = {}) {
  if (reducedMotion) {
    return {
      loopSeconds: 0,
      phase: 'neutral',
      travelProgress: 0,
      scanProgress: 0,
      scanStrength: 0,
      inspectionProgress: 0,
      inspectionPresence: 0,
      defectReveal: 0,
      repairProgress: 0,
      repairFieldProgress: 0,
      neutralizeProgress: 0,
      defectPresence: 0,
      fieldPresence: 0,
      defectPulse: 0,
      correctionPulse: 0,
      flowProgress: 0,
      flowStrength: 0,
      vibrationStrength: 0,
      effectElapsed: 0,
      correctedFlowElapsed: 0
    }
  }

  const safeSeconds = Number.isFinite(seconds) ? seconds : 0
  const loopSeconds = ((safeSeconds % NANOWIRE_MENU_LOOP_SECONDS) +
    NANOWIRE_MENU_LOOP_SECONDS) % NANOWIRE_MENU_LOOP_SECONDS
  /* Keep the approved fourteen-second sequence at exactly the same speed, then
     hold a clean neutral wire before it plays again. The conveyor keeps moving
     throughout that pause. */
  const sequenceSeconds = Math.min(loopSeconds, NANOWIRE_MENU_SEQUENCE_SECONDS)
  const storySeconds = sequenceSeconds * NANOWIRE_MENU_STORY_RATE
  /* Keep progress monotonic for the whole story. The previous modulo reset at
     five seconds teleported the highlighted atom while it was turning green. */
  const travelProgress = loopSeconds / NANOWIRE_MENU_LOOP_SECONDS
  const scanProgress = clamp01((storySeconds - 1.05) / 1.45)
  const inspectionProgress = smoothRange(
    sequenceSeconds,
    NANOWIRE_MENU_INSPECTION_START_SECONDS,
    NANOWIRE_MENU_INSPECTION_START_SECONDS +
      NANOWIRE_MENU_DEFECT_REVEAL_DURATION_MS / 1_000
  )
  const scanStrength =
    smoothRange(
      sequenceSeconds,
      NANOWIRE_MENU_SCAN_START_SECONDS,
      NANOWIRE_MENU_SCAN_START_SECONDS + 0.72
    ) *
    (1 - inspectionProgress) *
    (1 - smoothRange(storySeconds, 7.45, 8.3))
  const defectReveal = inspectionProgress
  const repairElapsed = Math.max(
    0,
    (sequenceSeconds - NANOWIRE_MENU_REPAIR_START_SECONDS) * 1_000
  )
  const repairSequence = resolveRepairSequence(repairElapsed, {
    atomDuration: NANOWIRE_MENU_DEFECT_REPAIR_DURATION_MS,
    fieldDuration: NANOWIRE_MENU_REPAIR_FIELD_DURATION_MS
  })
  const repairProgress = repairSequence.atomProgress
  const repairFieldProgress = repairSequence.fieldProgress
  const inspectionPresence =
    inspectionProgress * (1 - smoothRange(repairFieldProgress, 0.72, 1))
  const flowProgress = clamp01((storySeconds - 5.95) / 1.85)
  const flowStrength =
    smoothRange(storySeconds, 5.95, 6.28) *
    (1 - smoothRange(storySeconds, 7.45, 8.3))
  const neutralizeProgress = smoothRange(storySeconds, 7.45, 8.3)
  /* As the corrected blue field enters, the repaired atom stops being a
     separate marker and becomes part of that field. */
  const defectPresence =
    defectReveal * (1 - repairFieldProgress) * (1 - neutralizeProgress)
  const fieldPresence = defectPresence
  const pulsePhase = Math.sin(Math.max(0, storySeconds - 2.45) * Math.PI * 2.05)
  const correctionPulse = resolveCorrectionPulse(
    repairElapsed - NANOWIRE_MENU_DEFECT_REPAIR_DURATION_MS
  )
  const defectPulse =
    defectPresence * (1 - repairProgress) * (0.16 + pulsePhase * 0.08) +
    correctionPulse
  const vibrationStrength =
    smoothRange(storySeconds, 0.95, 1.06) *
    (1 - smoothRange(storySeconds, 2.58, 2.7))

  let phase = 'neutral'
  if (storySeconds >= 0.95 && storySeconds < 2.7) phase = 'scanning'
  else if (storySeconds >= 2.7 && storySeconds < 4.2) phase = 'defect'
  else if (storySeconds >= 4.2 && storySeconds < 5.95) phase = 'repairing'
  else if (storySeconds >= 5.95 && storySeconds < 8.3) phase = 'flowing'

  return {
    loopSeconds,
    phase,
    travelProgress,
    scanProgress,
    scanStrength,
    inspectionProgress,
    inspectionPresence,
    defectReveal,
    repairProgress,
    repairFieldProgress,
    neutralizeProgress,
    defectPresence,
    fieldPresence,
    defectPulse,
    correctionPulse,
    flowProgress,
    flowStrength,
    vibrationStrength,
    effectElapsed: Math.max(0, sequenceSeconds - NANOWIRE_MENU_SCAN_START_SECONDS) * 1_000,
    correctedFlowElapsed: Math.max(
      0,
      repairElapsed - NANOWIRE_MENU_DEFECT_REPAIR_DURATION_MS
    )
  }
}

/*
 * The depth bias that keeps the conveyor's layering stable: each atom is pulled
 * toward the camera in proportion to its x, so the lattice reads front-to-back the
 * same way at every point in the travel. Shared by every surface stacked on an atom
 * — base, gloss coat, effect shell — because they have to agree to the same bias or
 * a coat separates from the sphere it belongs to.
 */
function injectLayerBias(material, { baseBias, bias }) {
  const previousHook = material.onBeforeCompile
  material.onBeforeCompile = function onBeforeCompile(shader, renderer) {
    previousHook?.call(this, shader, renderer)
    shader.uniforms.uNanowireLayerBaseBias = { value: baseBias }
    shader.uniforms.uNanowireLayerBias = { value: bias }
    shader.vertexShader = `
      uniform float uNanowireLayerBaseBias;
      uniform float uNanowireLayerBias;
    ` + shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      #ifdef USE_INSTANCING
        float nanowireInstanceX = instanceMatrix[3].x;
        gl_Position.z -= (
          uNanowireLayerBaseBias + nanowireInstanceX * uNanowireLayerBias
        ) * gl_Position.w;
      #endif`
    )
  }
}

/*
 * Navigation and the full experience deliberately share one physical atom surface.
 * Per-instance colours then carry the same semantic palettes without an extra
 * saturation or gloss treatment changing them at card scale.
 */
function createAtomMaterial(THREE) {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: false,
    depthWrite: true,
    ...NANOWIRE_MENU_MATERIAL
  })
}

export function createNanowireMenuObject(THREE, radius) {
  const group = new THREE.Group()
  group.name = 'NanowireMenuPortal'
  const wire = new THREE.Group()
  wire.name = 'NanowireMenuPortalContents'
  /* The Figma composition is deliberately frontal. The shared scene still
     accepts manual drag rotation, but its authored rest pose is this one. */
  wire.rotation.set(0, 0, 0)
  group.add(wire)

  const atomRadius = radius * 0.3
  const motifPitch = NANOWIRE_MENU_MOTIF_PITCH * atomRadius
  const motifCount = NANOWIRE_MENU_MOTIF_COUNT
  const atomCount = motifCount * NANOWIRE_MENU_PATTERN.length
  const trainSpan = motifCount * motifPitch

  /* The card is commonly reviewed at 25% kiosk scale. Extra radial segments
     keep the large specular silhouette circular even after that downsample. */
  const atomGeometry = new THREE.SphereGeometry(atomRadius, 44, 30)
  const vertexCount = atomGeometry.getAttribute('position').count
  atomGeometry.setAttribute(
    'color',
    new THREE.BufferAttribute(new Float32Array(vertexCount * 3).fill(1), 3)
  )
  /* A white geometry-colour attribute keeps Three's vertex-colour path valid, so
     dynamic instance colours are multiplied by white instead of black. */
  const atomMaterial = createAtomMaterial(THREE)
  atomMaterial.userData.layerBaseBias = NANOWIRE_MENU_LAYER_BASE_BIAS
  atomMaterial.userData.layerBias = NANOWIRE_MENU_LAYER_BIAS / atomRadius
  injectLayerBias(atomMaterial, {
    baseBias: atomMaterial.userData.layerBaseBias,
    bias: atomMaterial.userData.layerBias
  })
  /* The depth-bias hook is unique to this instanced navigation material. */
  atomMaterial.customProgramCacheKey = () => 'nanowire-menu-module-surface-v1'

  const createMenuEffectColor = color => new THREE.Color(color).offsetHSL(
    0,
    NANOWIRE_MENU_COLOR_TREATMENT.paletteSaturation,
    NANOWIRE_MENU_COLOR_TREATMENT.paletteLightness
  )
  const neutralColor = new THREE.Color(NANOWIRE_MENU_COLOR_TREATMENT.neutral)
  const defectCore = new THREE.Color(NANOWIRE_COLORS.defectCore)
  const defectCoreEmissive = new THREE.Color(NANOWIRE_COLORS.defectCoreEmissive)
  const focusedErrorColor = new THREE.Color(NANOWIRE_MENU_FOCUSED_ERROR_COLOR)
  const repairedDefect = createMenuEffectColor(NANOWIRE_COLORS.repairedDefect)
  const correctionPulseGreen = createMenuEffectColor(NANOWIRE_COLORS.correctionPulse)
  const correctionPulseEmissive = new THREE.Color(NANOWIRE_COLORS.correctionPulseEmissive)
  const errorGradientColors = NANOWIRE_MENU_ERROR_GRADIENT.map(
    createMenuEffectColor
  )
  const inspectionGradientColors = NANOWIRE_MENU_INSPECTION_GRADIENT.map(
    createMenuEffectColor
  )
  const inspectionRepairedGradientColors =
    NANOWIRE_MENU_INSPECTION_REPAIRED_GRADIENT.map(createMenuEffectColor)
  const finalFlowBase = new THREE.Color(NANOWIRE_MENU_FINAL_FLOW_BASE)
  const finalFlowPulse = new THREE.Color(NANOWIRE_MENU_FINAL_FLOW_PULSE)
  const workingColor = new THREE.Color()
  const overlayColor = new THREE.Color()
  const effectColor = new THREE.Color()
  const inspectionColor = new THREE.Color()
  const inspectionRepairedColor = new THREE.Color()
  const flowColor = new THREE.Color()
  const dummy = new THREE.Object3D()
  const atoms = []
  const mesh = new THREE.InstancedMesh(atomGeometry, atomMaterial, atomCount)
  mesh.name = 'NanowireAtoms'
  mesh.renderOrder = 3
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.castShadow = true
  mesh.frustumCulled = false
  wire.add(mesh)

  /* The focused atom uses the same red, low-metalness defect surface as the
     full experience, then follows its pale-green correction pulse. */
  const gradientUniforms = {
    uNanowireGradientDepthBias: {
      value: NANOWIRE_MENU_LAYER_BASE_BIAS + 0.003
    }
  }
  const gradientMaterial = new THREE.MeshStandardMaterial({
    color: focusedErrorColor,
    emissive: defectCoreEmissive,
    emissiveIntensity: 0.12,
    transparent: true,
    opacity: 1,
    depthTest: true,
    depthWrite: false,
    metalness: 0,
    roughness: 0.82
  })
  gradientMaterial.userData.uniforms = gradientUniforms
  gradientMaterial.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, gradientUniforms)
    shader.vertexShader = `
      uniform float uNanowireGradientDepthBias;
    ` + shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      gl_Position.z -= uNanowireGradientDepthBias * gl_Position.w;`
    )
  }
  gradientMaterial.customProgramCacheKey = () => 'nanowire-menu-focused-atom-v1'
  const gradientAtom = new THREE.Mesh(atomGeometry, gradientMaterial)
  gradientAtom.name = 'NanowireDefectGradient'
  gradientAtom.renderOrder = 6
  gradientAtom.frustumCulled = false
  gradientAtom.userData.noShadow = true
  gradientAtom.visible = false
  wire.add(gradientAtom)

  /* The experience's colour fields are semantic effects, not a recoloured
     base material. This shell is fully absent while neutral and appears only
     for scan, error, repair and flow, leaving the shared PBR atom untouched. */
  const effectStrength = new THREE.InstancedBufferAttribute(
    new Float32Array(atomCount),
    1
  )
  effectStrength.setUsage(THREE.DynamicDrawUsage)
  atomGeometry.setAttribute('nanowireEffectStrength', effectStrength)
  const effectMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.62,
    blending: THREE.NormalBlending,
    depthTest: true,
    depthWrite: false
  })
  effectMaterial.onBeforeCompile = shader => {
    shader.uniforms.uNanowireEffectLayerBaseBias = {
      value: atomMaterial.userData.layerBaseBias + 0.002
    }
    shader.uniforms.uNanowireEffectLayerBias = {
      value: atomMaterial.userData.layerBias
    }
    shader.vertexShader = `
      uniform float uNanowireEffectLayerBaseBias;
      uniform float uNanowireEffectLayerBias;
      attribute float nanowireEffectStrength;
      varying float vNanowireEffectStrength;
    ` + shader.vertexShader.replace(
      '#include <color_vertex>',
      `#include <color_vertex>
      vNanowireEffectStrength = nanowireEffectStrength;`
    ).replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      #ifdef USE_INSTANCING
        float nanowireEffectInstanceX = instanceMatrix[3].x;
        gl_Position.z -= (
          uNanowireEffectLayerBaseBias +
          nanowireEffectInstanceX * uNanowireEffectLayerBias
        ) * gl_Position.w;
      #endif`
    )
    shader.fragmentShader = `
      varying float vNanowireEffectStrength;
    ` + shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      diffuseColor.a *= vNanowireEffectStrength;`
    )
  }
  effectMaterial.customProgramCacheKey = () => 'nanowire-menu-effects-v2'
  const effectMesh = new THREE.InstancedMesh(atomGeometry, effectMaterial, atomCount)
  effectMesh.name = 'NanowireEffects'
  effectMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  effectMesh.renderOrder = 5
  effectMesh.frustumCulled = false
  effectMesh.userData.noShadow = true
  wire.add(effectMesh)

  let instance = 0
  for (let motif = 0; motif < motifCount; motif += 1) {
    const motifX = (motif - (motifCount - 1) / 2) * motifPitch
    for (const point of NANOWIRE_MENU_PATTERN) {
      const atom = {
        baseX: motifX + point.x * atomRadius,
        role: point.role,
        x: 0,
        y: point.y * atomRadius,
        z: point.z * atomRadius,
        normalizedPosition: Object.freeze({
          x: motif / Math.max(motifCount - 1, 1),
          y: 0,
          z: point.y * 0.5 + 0.5
        })
      }
      atoms.push(atom)
      dummy.position.set(atom.baseX, atom.y, atom.z)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      mesh.setMatrixAt(instance, dummy.matrix)
      mesh.setColorAt(instance, neutralColor)
      instance += 1
    }
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
  mesh.instanceColor.needsUpdate = true

  /* The same portal construction used by the neighbouring material and protection
     cards: an unlit field behind the model, a frosted silhouette at the edge, and
     one world-space crop shared by every nanowire surface. */
  const cropUniforms = createCropUniforms(THREE)
  const portalGeometry = new THREE.SphereGeometry(1, 64, 40)
  const portalFillMaterial = new THREE.MeshBasicMaterial({
    color: NANOWIRE_MENU_PORTAL.tint,
    transparent: false,
    depthWrite: false,
    depthTest: false,
    toneMapped: false
  })
  portalFillMaterial.userData.noImperfection = true
  const portalFill = new THREE.Mesh(portalGeometry, portalFillMaterial)
  portalFill.name = 'NanowireMenuPortalFill'
  portalFill.renderOrder = -1
  portalFill.castShadow = true
  portalFill.userData.noImperfection = true
  portalFill.userData.noSphereCrop = true

  const portalFrost = createFrostShell(THREE)
  portalFrost.uniforms.uColor.value = new THREE.Color(NANOWIRE_MENU_PORTAL.tint)
  portalFrost.uniforms.uBaseAlpha.value = 0
  portalFrost.uniforms.uRimAlpha.value = 0.3
  portalFrost.uniforms.uFresnelPow.value = 2.6
  portalFrost.uniforms.uBackAlpha.value = 0.12
  for (const material of [portalFrost.back, portalFrost.front]) {
    material.depthWrite = false
    material.depthTest = false
    material.userData.noImperfection = true
  }
  const portalBack = new THREE.Mesh(portalGeometry, portalFrost.back)
  portalBack.name = 'NanowireMenuPortalRimBack'
  portalBack.renderOrder = 1
  portalBack.userData.noShadow = true
  portalBack.userData.noImperfection = true
  portalBack.userData.noSphereCrop = true
  const portalFront = new THREE.Mesh(portalGeometry, portalFrost.front)
  portalFront.name = 'NanowireMenuPortalRimFront'
  portalFront.renderOrder = 2
  portalFront.userData.noShadow = true
  portalFront.userData.noImperfection = true
  portalFront.userData.noSphereCrop = true
  group.add(portalFill, portalBack, portalFront)

  /* The portal owns the visible silhouette and its contact shadow. Cropped atoms
     must not cast a rectangular conveyor shadow outside that silhouette. */
  wire.traverse(node => {
    if (!(node.isMesh || node.isInstancedMesh)) return
    node.castShadow = false
    node.userData.noShadow = true
  })
  const cropReport = applyCropToTree(wire, cropUniforms)
  const cropScratch = new THREE.Vector3()
  const portalTuning = {
    circleScale: NANOWIRE_MENU_PORTAL.circleScale,
    wireScale: NANOWIRE_MENU_PORTAL.wireScale,
    offsetX: NANOWIRE_MENU_PORTAL.offsetX,
    offsetY: NANOWIRE_MENU_PORTAL.offsetY,
    cropInset: NANOWIRE_MENU_PORTAL.cropInset
  }

  const applyPortalTuning = () => {
    const portalRadius = radius * portalTuning.circleScale
    for (const shell of [portalFill, portalBack, portalFront]) {
      shell.scale.setScalar(portalRadius)
    }
    wire.scale.setScalar(portalTuning.wireScale)
    wire.position.set(
      portalRadius * portalTuning.offsetX,
      portalRadius * portalTuning.offsetY,
      0
    )
  }

  const applyPortalCrop = () => {
    aimCropAtSphere(cropUniforms, portalFill, {
      inset: portalTuning.cropInset,
      scratch: cropScratch
    })
  }

  const defectMotif = Math.floor(motifCount / 2) - 1
  const defectIndex = defectMotif * NANOWIRE_MENU_PATTERN.length + 2
  let reducedStateApplied = false
  let defectVisible = false
  const flowFieldOptions = Object.freeze({
    debugMode: NANOWIRE_FLOW_DEBUG_MODES.final,
    seed: NANOWIRE_FLOW_DEFAULT_SEED
  })

  const shortestTrainDistance = (left, right) => {
    const distance = Math.abs(left - right)
    return Math.min(distance, trainSpan - distance)
  }

  const signedTrainDelta = (left, right) => {
    const halfSpan = trainSpan / 2
    return ((((left - right) + halfSpan) % trainSpan) + trainSpan) % trainSpan - halfSpan
  }

  const sampleGradient = (colors, value, target) => {
    const span = resolveGradientSpan(value, colors.length)
    return target.copy(colors[span.lower]).lerp(colors[span.upper], span.mix)
  }

  const applyState = state => {
    const travel = state.travelProgress * motifPitch * NANOWIRE_MENU_TRAVEL_MOTIFS
    const defectLogicalX = atoms[defectIndex].baseX + travel
    const defectLogicalY = atoms[defectIndex].y
    const deformationStrength =
      state.fieldPresence * atomRadius * NANOWIRE_MENU_ERROR_DEFORMATION.maximumOffset

    /* Update geometry first so every colour sample sees the same defect position. */
    for (let atomIndex = 0; atomIndex < atoms.length; atomIndex += 1) {
      const atom = atoms[atomIndex]
      atom.x = atom.baseX + travel
      atom.renderX = atom.x
      atom.renderY = atom.y
      atom.renderZ = atom.z
      if (atomIndex !== defectIndex && deformationStrength > 0) {
        const deltaX = signedTrainDelta(atom.x, defectLogicalX)
        const deltaY = atom.y - defectLogicalY
        const normalizedDistance = Math.hypot(
          deltaX / (
            atomRadius * NANOWIRE_MENU_ERROR_DEFORMATION.longitudinalRadius
          ),
          deltaY / (atomRadius * NANOWIRE_MENU_ERROR_DEFORMATION.verticalRadius)
        )
        const deformationEnvelope = 1 - smoothRange(normalizedDistance, 0.18, 1)
        const physicalDistance = Math.hypot(deltaX, deltaY)
        if (physicalDistance > 0.0001 && deformationEnvelope > 0) {
          const offset = deformationStrength * deformationEnvelope
          atom.renderX += deltaX / physicalDistance * offset
          atom.renderY += deltaY / physicalDistance * offset
        }
      }
      if (state.vibrationStrength > 0) {
        const vibrationPhase =
          state.effectElapsed * 0.001 * Math.PI * 2 * 8.2 + atomIndex * 2.39996
        const vibrationOffset =
          Math.sin(vibrationPhase) * atomRadius * 0.055 * state.vibrationStrength
        atom.renderX += Math.cos(atomIndex * 1.618) * vibrationOffset
        atom.renderY += Math.sin(atomIndex * 2.117 + 0.7) * vibrationOffset
        atom.renderZ += Math.sin(atomIndex * 1.417 + 1.2) * vibrationOffset
      }
      const scale = atomIndex === defectIndex
        ? 1 + state.defectPulse * 0.04
        : 1
      dummy.position.set(atom.renderX, atom.renderY, atom.renderZ)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(atomIndex, dummy.matrix)
      dummy.scale.setScalar(scale * 1.012)
      dummy.updateMatrix()
      effectMesh.setMatrixAt(atomIndex, dummy.matrix)
    }

    const defect = atoms[defectIndex]
    /* Same defect material transition as the experience: red core, pale-green
       repair, then the short saturated correction pulse. */
    gradientUniforms.uNanowireGradientDepthBias.value =
      NANOWIRE_MENU_LAYER_BASE_BIAS +
      defect.renderX * atomMaterial.userData.layerBias +
      0.003
    gradientMaterial.color.copy(defectCore).lerp(repairedDefect, state.repairProgress)
    gradientMaterial.color.lerp(correctionPulseGreen, state.correctionPulse * 0.96)
    gradientMaterial.emissive.copy(defectCoreEmissive).lerp(
      correctionPulseEmissive,
      state.repairProgress
    )
    gradientMaterial.emissiveIntensity = 0.12 + state.correctionPulse * 0.42
    gradientMaterial.roughness = 0.82 - state.correctionPulse * 0.24
    gradientMaterial.opacity = state.defectPresence
    gradientAtom.position.set(defect.renderX, defect.renderY, defect.renderZ)
    gradientAtom.scale.setScalar(1.15 + state.correctionPulse * 0.13)
    defectVisible = state.defectPresence > 0.001
    gradientAtom.visible = group.userData.debugMode === 'final' && defectVisible
    for (let atomIndex = 0; atomIndex < atoms.length; atomIndex += 1) {
      const atom = atoms[atomIndex]
      workingColor.copy(neutralColor)
      overlayColor.copy(neutralColor)
      let effectSignal = 0

      /* Navigation samples the same continuous field as the experience. */
      const perturbationPosition = resolvePerturbationField(
        atom.normalizedPosition,
        state.effectElapsed,
        flowFieldOptions
      )
      sampleGradient(errorGradientColors, Math.pow(perturbationPosition, 1.16), effectColor)
      const scanSignal = state.scanStrength * NANOWIRE_MENU_COLOR_TREATMENT.scanMix
      workingColor.lerp(effectColor, scanSignal)
      if (scanSignal > effectSignal) {
        effectSignal = scanSignal
        overlayColor.copy(effectColor)
      }

      /* This is the loupe's inspection field without the loupe UI: the atoms
         stop vibrating and hold the same pink-violet-indigo spatial palette. */
      const inspectionDistance = Math.hypot(
        shortestTrainDistance(atom.x, defect.x) / (atomRadius * 4.1),
        (atom.y - defect.y) / (atomRadius * 2.5)
      )
      const inspectionEnvelope = 1 - smoothRange(inspectionDistance, 0.86, 1.12)
      sampleGradient(
        inspectionGradientColors,
        inspectionDistance / 0.9,
        inspectionColor
      )
      sampleGradient(
        inspectionRepairedGradientColors,
        inspectionDistance / 0.9,
        inspectionRepairedColor
      )
      inspectionColor.lerp(inspectionRepairedColor, state.repairFieldProgress)
      const inspectionSignal =
        inspectionEnvelope * state.inspectionPresence
      workingColor.lerp(inspectionColor, inspectionSignal)
      if (inspectionSignal > effectSignal) {
        effectSignal = inspectionSignal
        overlayColor.copy(inspectionColor)
      }

      flowColor.copy(finalFlowBase)
      const correctedPulse = resolveCorrectedPulse(
        atom.normalizedPosition,
        state.correctedFlowElapsed
      )
      if (correctedPulse > 0) flowColor.lerp(finalFlowPulse, correctedPulse)
      const flowSignal =
        state.repairFieldProgress *
        (1 - state.neutralizeProgress) *
        NANOWIRE_MENU_COLOR_TREATMENT.flowMix
      workingColor.lerp(flowColor, flowSignal)
      if (flowSignal > effectSignal) {
        effectSignal = flowSignal
        overlayColor.copy(flowColor)
      }

      if (atomIndex === defectIndex && state.defectPresence > 0) {
        effectColor.copy(defectCore).lerp(repairedDefect, state.repairProgress)
        effectColor.lerp(correctionPulseGreen, state.correctionPulse * 0.96)
        workingColor.lerp(effectColor, state.defectPresence)
        if (state.defectPresence > effectSignal) {
          effectSignal = state.defectPresence
          overlayColor.copy(effectColor)
        }
      }
      mesh.setColorAt(atomIndex, workingColor)
      effectMesh.setColorAt(atomIndex, overlayColor)
      effectStrength.setX(atomIndex, effectSignal * 0.85)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor.needsUpdate = true
    effectMesh.instanceMatrix.needsUpdate = true
    effectMesh.instanceColor.needsUpdate = true
    effectStrength.needsUpdate = true
  }

  group.userData.update = seconds => {
    reducedStateApplied = false
    applyState(sampleNanowireMenuLoop(seconds))
    applyPortalCrop()
  }
  group.userData.applyReducedMotion = () => {
    if (reducedStateApplied) return
    reducedStateApplied = true
    applyState(sampleNanowireMenuLoop(0, { reducedMotion: true }))
    applyPortalCrop()
  }
  group.userData.setDebugMode = mode => {
    const resolvedMode = NANOWIRE_MENU_DEBUG_MODES.includes(mode) ? mode : 'final'
    mesh.visible = resolvedMode !== 'effects'
    effectMesh.visible = resolvedMode === 'effects'
    gradientAtom.visible = resolvedMode === 'final' && defectVisible
    group.userData.debugMode = resolvedMode
  }
  group.userData.dispose = () => {
    atomGeometry.dispose()
    atomMaterial.dispose()
    effectMaterial.dispose()
    gradientMaterial.dispose()
    portalGeometry.dispose()
    portalFillMaterial.dispose()
    portalFrost.back.dispose()
    portalFrost.front.dispose()
  }

  group.userData.navTuning = {
    params: portalTuning,
    ranges: Object.freeze({
      circleScale: [0.3, 1.2],
      wireScale: [0.2, 1],
      offsetX: [-1, 1],
      offsetY: [-1, 1],
      cropInset: [0.5, 1.2]
    }),
    apply(next = {}) {
      for (const [key, value] of Object.entries(next)) {
        if (key in portalTuning && Number.isFinite(value)) portalTuning[key] = value
      }
      applyPortalTuning()
      applyPortalCrop()
    },
    unpatched: cropReport.unpatched
  }

  applyPortalTuning()
  applyPortalCrop()
  group.userData.setDebugMode('final')
  applyState(sampleNanowireMenuLoop(0))
  return group
}
