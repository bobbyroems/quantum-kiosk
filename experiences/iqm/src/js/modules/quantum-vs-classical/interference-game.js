import { withSceneSetup } from '../../core/scene-setup.js'
import { warmSceneVariants } from '../../core/warm-scene-variants.js'
/*
 * Interference — Current Design V3.
 *
 * The water is deliberately quiet until a visitor activates one of the five
 * highlighted source buoys. Those five sources drive one shared analytic field on
 * both the GPU (the water mesh) and CPU (the buoy rigs), so every visible rise,
 * cancellation and tilt comes from the same wave equation. The other twenty buoys
 * are possible outcomes: they never emit decorative ripples of their own.
 */

import * as THREE from 'three'

import { sound } from '../../core/kiosk-audio.js'
import { updateKioskExplainer } from '../../core/kiosk-explainer.js'
import { updateKioskTooltip } from '../../core/kiosk-tooltip.js'
import { leaseWebGLRenderer } from '../../core/webgl-renderer-pool.js'
import { disposeObject3DResources } from '../../core/three-resource-disposal.js'
import {
  BUOY_FLAG_HEIGHT_LIMITS,
  BUOY_SCREEN_EAST_YAW,
  cloneBuoy
} from './interference-assets.js'
import {
  LESSON_COPY,
  setLessonPlayback
} from './interference-lesson.js'
import { createInterferenceGuidance } from './interference-guidance.js'
import {
  INTERFERENCE_BACKGROUND_BUOY_LAYOUT,
  INTERFERENCE_CANDIDATE_LAYOUT,
  INTERFERENCE_SOURCE_CANDIDATE_INDICES,
  INTERFERENCE_WINNER_CANDIDATE_INDEX,
  sourceIndexForCandidate
} from './interference-layout.js'
import { getInterferencePresentation } from './interference-presentation.js'
import {
  createInterferenceStages,
  INTERFERENCE_STAGES
} from './interference-stages.js'
import {
  createInterferenceWater,
  INTERFERENCE_SOLUTION_MOUND_CONFIG,
  sampleInterferenceHorizon,
  sampleInterferenceOutcomeSuction,
  sampleInterferenceSolutionMound
} from './interference-water.js'
import {
  createInterferenceRound,
  INTERFERENCE_PHASES,
  INTERFERENCE_WAVE_CONFIG
} from './interference-wave-model.js'
import { calculateQvcPixelRatio } from './render-quality.js'

const WATER_WIDTH = 320
const WATER_DEPTH = 200
const WATER_SEGMENTS_X = 1200
const WATER_SEGMENTS_Z = 750
const BUOY_FIELD_SMOOTHING = 10
const BUOY_ROTATION_SMOOTHING = 8
const CUE_SMOOTHING = 8.5
const SUBMERGED_REVEAL_Y = -2.4
const INITIAL_BUOY_YAW_OFFSET = THREE.MathUtils.degToRad(25)

/* A step burst is a fraction of the finale, enough to pull the eye back to the
   winning buoy as its flag lifts without spending the ending early. */
export const INTERFERENCE_STEP_CONFETTI_STRENGTH = 0.26

export const INTERFERENCE_MOTION_CONFIG = Object.freeze({
  /* The crest/valley wash follows the explainer panel rather than snapping with
     it, so the water has faded back to its own blue by the time the panel is gone. */
  crestTintSmoothing: 4.6,
  /* Slower than the mound's own step so the field concedes gradually rather than
     flicking red the moment a buoy is tapped. */
  fieldRedSmoothing: 1.15,
  revealDuration: 0.72,
  solutionStepSmoothing: 6.2,
  tapDuration: 0.58,
  targetFloatAmplitude: 0.065,
  targetFloatSpeed: 3.4
})

const IDLE_TAP_MOTION = Object.freeze({
  lift: 0,
  roll: 0,
  scaleXZ: 1,
  scaleY: 1
})

const WINNER_SETTLED_MOUND_HEIGHT = sampleInterferenceSolutionMound(0, 0).height
const WINNER_OUTCOME_MOUND_HEIGHT = sampleInterferenceSolutionMound(
  0,
  0,
  undefined,
  {
    scaleXZ: INTERFERENCE_SOLUTION_MOUND_CONFIG.outcomeScaleXZ,
    scaleY: INTERFERENCE_SOLUTION_MOUND_CONFIG.outcomeScaleY
  }
).height

export const INTERFERENCE_OUTCOME_VISUAL_CONFIG = Object.freeze({
  loserColor: '#ee3b32',
  winnerColor: '#39b874',
  winnerOutcomeRise: WINNER_OUTCOME_MOUND_HEIGHT,
  winnerSettledRise: WINNER_SETTLED_MOUND_HEIGHT
})

export const INTERFERENCE_CONFETTI_PALETTE = Object.freeze([
  '#32b77d',
  '#ff6f61',
  '#ffc84a',
  '#35b8d5',
  '#7b6dde',
  '#ee76b5'
])

export const INTERFERENCE_VISUAL_CONFIG = Object.freeze({
  constructiveStrength: 4,
  finalContrastPower: 16,
  flagFallSmoothing: 5.2,
  flagResponsePower: 1.45,
  flagRiseSmoothing: 3.9,
  normalFlagHeight: 1,
  enhancedFlagHeight: BUOY_FLAG_HEIGHT_LIMITS.max
})

export const INTERFERENCE_OUTCOME_TIMELINE = Object.freeze({
  cameraEnd: 0.74,
  cameraStart: 0.04,
  flagEnd: 0.96,
  flagStart: 0.76,
  moundEnd: 0.68,
  moundStart: 0,
  pulseEnd: 0.68,
  pulseStart: 0
})

export const INTERFERENCE_CAMERA_WHOOSH_LEAD_SECONDS = 0.2

export const INTERFERENCE_CAMERA_WHOOSH_TIMING =
  calculateInterferenceCameraWhooshTiming()

/* Kept in step with the lesson-card transitions in quantum-vs-classical.css: the
   content swap waits for the outgoing card to finish fading before it happens. */
export const INTERFERENCE_TOOLTIP_MOTION_CONFIG = Object.freeze({
  enterMs: 340,
  exitMs: 240
})

export function calculateInterferenceFlagHeight(strength) {
  const safeStrength = Number.isFinite(strength) ? Math.max(0, strength) : 0
  const normalized = Math.min(
    1,
    safeStrength / INTERFERENCE_VISUAL_CONFIG.constructiveStrength
  )
  const range = INTERFERENCE_VISUAL_CONFIG.enhancedFlagHeight -
    INTERFERENCE_VISUAL_CONFIG.normalFlagHeight
  return INTERFERENCE_VISUAL_CONFIG.normalFlagHeight +
    (range * Math.pow(normalized, INTERFERENCE_VISUAL_CONFIG.flagResponsePower))
}

export function calculateInterferenceLiveFlagHeight(strength, envelope) {
  const safeEnvelope = Number.isFinite(envelope) ? Math.max(0, envelope) : 0
  if (safeEnvelope < 0.25) return calculateInterferenceFlagHeight(strength)
  const safeStrength = Number.isFinite(strength) ? Math.max(0, strength) : 0
  const coherence = Math.min(1, safeStrength / safeEnvelope)
  if (coherence >= 0.5) return calculateInterferenceFlagHeight(strength)
  const dip = (0.5 - coherence) / 0.5
  return INTERFERENCE_VISUAL_CONFIG.normalFlagHeight -
    (dip * (INTERFERENCE_VISUAL_CONFIG.normalFlagHeight - BUOY_FLAG_HEIGHT_LIMITS.min))
}

export function calculateInterferenceFinalFlagTargets(strengths, winnerIndex) {
  const maximum = Math.max(
    0.0001,
    ...strengths.map(strength => Number.isFinite(strength) ? Math.max(0, strength) : 0)
  )
  const range = INTERFERENCE_VISUAL_CONFIG.enhancedFlagHeight -
    INTERFERENCE_VISUAL_CONFIG.normalFlagHeight
  return strengths.map((strength, index) => {
    if (index === winnerIndex) return INTERFERENCE_VISUAL_CONFIG.enhancedFlagHeight
    const normalized = Math.max(0, Math.min(1, (Number(strength) || 0) / maximum))
    return INTERFERENCE_VISUAL_CONFIG.normalFlagHeight +
      (range * Math.pow(normalized, INTERFERENCE_VISUAL_CONFIG.finalContrastPower))
  })
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0))
}

export function calculateInterferenceWinnerMoundOffset(
  solutionProgress,
  outcomeProgress
) {
  const outcome = clamp01(outcomeProgress)
  const moundHeight = INTERFERENCE_OUTCOME_VISUAL_CONFIG.winnerSettledRise +
    ((INTERFERENCE_OUTCOME_VISUAL_CONFIG.winnerOutcomeRise -
      INTERFERENCE_OUTCOME_VISUAL_CONFIG.winnerSettledRise) * outcome)
  return moundHeight * clamp01(solutionProgress)
}

function smoothstep01(value) {
  const progress = clamp01(value)
  return progress * progress * (3 - (2 * progress))
}

function inverseSmoothstep01(value) {
  const progress = clamp01(value)
  return 0.5 - Math.sin(Math.asin(1 - (2 * progress)) / 3)
}

export function calculateInterferenceCameraWhooshTiming({
  cameraStart = INTERFERENCE_OUTCOME_TIMELINE.cameraStart,
  fadeDuration = INTERFERENCE_WAVE_CONFIG.fadeDuration,
  outcomeDelay = INTERFERENCE_WAVE_CONFIG.outcomeDelay,
  leadSeconds = INTERFERENCE_CAMERA_WHOOSH_LEAD_SECONDS
} = {}) {
  const duration = Math.max(0.0001, Number(fadeDuration) || 0)
  const holdDuration = Math.max(0, Number(outcomeDelay) || 0)
  const cameraStartSeconds = inverseSmoothstep01(cameraStart) * duration
  const cueSeconds = Math.max(0, cameraStartSeconds - Math.max(0, Number(leadSeconds) || 0))
  return Object.freeze({
    cameraStartDelaySeconds: holdDuration + cameraStartSeconds,
    cameraStartSeconds,
    cueDelaySeconds: holdDuration + cueSeconds,
    cueFadeProgress: smoothstep01(cueSeconds / duration),
    cueSeconds,
    leadSeconds: cameraStartSeconds - cueSeconds
  })
}

function easeOutCubic(value) {
  const progress = clamp01(value)
  return 1 - Math.pow(1 - progress, 3)
}

function intervalProgress(value, start, end) {
  return clamp01((value - start) / Math.max(0.0001, end - start))
}

/*
 * How far the surrounding field has turned toward red.
 *
 * Only the buoys that arrive with the field take part, and only once it is on screen:
 * the opening one- and two-buoy scenes are about a single wave and then a pair, and
 * reddening anything there would answer a question the visitor has not been asked yet.
 * From then on each activation walks the field one step further toward red, so by the
 * last one the only thing that has not conceded is the solution.
 */
export function calculateInterferenceFieldRedProgress(
  activatedCount,
  sourceCount = 5,
  fieldRevealed = false
) {
  if (!fieldRevealed) return 0
  const safeSourceCount = Math.max(3, Math.floor(Number(sourceCount) || 0))
  const safeActivated = Math.max(0, Math.floor(Number(activatedCount) || 0))
  /* Two are already up when the field arrives, so the walk starts from the third. */
  return clamp01((safeActivated - 2) / (safeSourceCount - 2))
}

export function calculateInterferenceSequenceSolutionProgress(stepIndex, stepCount = 5) {
  const safeStepCount = Math.max(2, Math.floor(Number(stepCount) || 0))
  const safeStepIndex = Math.max(0, Math.floor(Number(stepIndex) || 0))
  if (safeStepIndex <= 1) return 0
  return clamp01((safeStepIndex - 1) / (safeStepCount - 1))
}

export function sampleInterferenceRevealMotion(elapsed, reducedMotion = false) {
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return Object.freeze({ lift: 0, progress: 0 })
  }
  if (reducedMotion) return Object.freeze({ lift: 0, progress: 1 })

  const progress = easeOutCubic(elapsed / INTERFERENCE_MOTION_CONFIG.revealDuration)
  const surfaceBreak = Math.sin(progress * Math.PI) * 0.12 * (0.35 + (0.65 * progress))
  return Object.freeze({ lift: surfaceBreak, progress })
}

export function sampleInterferenceTapMotion(elapsed, reducedMotion = false) {
  if (reducedMotion || !Number.isFinite(elapsed) || elapsed < 0 ||
    elapsed >= INTERFERENCE_MOTION_CONFIG.tapDuration) {
    return IDLE_TAP_MOTION
  }

  const progress = elapsed / INTERFERENCE_MOTION_CONFIG.tapDuration
  if (progress < 0.16) {
    const press = easeOutCubic(progress / 0.16)
    return Object.freeze({
      lift: -0.085 * press,
      roll: 0,
      scaleXZ: 1 + (0.045 * press),
      scaleY: 1 - (0.075 * press)
    })
  }

  if (progress < 0.48) {
    const rebound = easeOutCubic((progress - 0.16) / 0.32)
    return Object.freeze({
      lift: -0.085 + (0.255 * rebound),
      roll: -Math.sin(rebound * Math.PI) * 0.045,
      scaleXZ: 1.045 - (0.065 * rebound),
      scaleY: 0.925 + (0.11 * rebound)
    })
  }

  const settle = smoothstep01((progress - 0.48) / 0.52)
  const remaining = 1 - settle
  return Object.freeze({
    lift: (0.17 * remaining) + (Math.sin(settle * Math.PI * 2) * 0.025 * remaining),
    roll: Math.sin(settle * Math.PI * 2) * 0.025 * remaining,
    scaleXZ: 1 - (0.02 * remaining),
    scaleY: 1 + (0.035 * remaining)
  })
}

export function sampleInterferenceOutcomeTimeline(fadeProgress) {
  const progress = clamp01(fadeProgress)
  return Object.freeze({
    camera: smoothstep01(intervalProgress(
      progress,
      INTERFERENCE_OUTCOME_TIMELINE.cameraStart,
      INTERFERENCE_OUTCOME_TIMELINE.cameraEnd
    )),
    flag: easeOutCubic(intervalProgress(
      progress,
      INTERFERENCE_OUTCOME_TIMELINE.flagStart,
      INTERFERENCE_OUTCOME_TIMELINE.flagEnd
    )),
    mound: easeOutCubic(intervalProgress(
      progress,
      INTERFERENCE_OUTCOME_TIMELINE.moundStart,
      INTERFERENCE_OUTCOME_TIMELINE.moundEnd
    )),
    pulse: smoothstep01(intervalProgress(
      progress,
      INTERFERENCE_OUTCOME_TIMELINE.pulseStart,
      INTERFERENCE_OUTCOME_TIMELINE.pulseEnd
    )),
    payoff: progress >= 0.999
  })
}

export function calculateInterferenceSettlingFlagHeight(
  liveHeight,
  finalHeight,
  fadeProgress
) {
  const safeLiveHeight = Number.isFinite(liveHeight)
    ? liveHeight
    : INTERFERENCE_VISUAL_CONFIG.normalFlagHeight
  const safeFinalHeight = Number.isFinite(finalHeight) ? finalHeight : safeLiveHeight
  const progress = clamp01(fadeProgress)
  return safeLiveHeight + ((safeFinalHeight - safeLiveHeight) * progress)
}

export function calculateInterferenceWaterGains(fadeProgress) {
  const fade = clamp01(fadeProgress)
  return Object.freeze({
    rippleGain: 1 - fade
  })
}

export function calculateHalfSubmergedBuoyOffset({ centerY, radius }) {
  const safeCenterY = Number.isFinite(centerY) ? centerY : 0
  const safeRadius = Number.isFinite(radius) ? Math.max(0, radius) : 0
  if (safeRadius < 0.0001) return -safeCenterY
  const surfaceAtEquator = sampleInterferenceOutcomeSuction(
    safeRadius,
    0,
    [{ x: 0, z: 0 }]
  ).height
  return surfaceAtEquator - safeCenterY
}

export function candidateIndexForSource(sourceIndex) {
  if (!Number.isInteger(sourceIndex)) return null
  return INTERFERENCE_SOURCE_CANDIDATE_INDICES[sourceIndex] ?? null
}

export function shouldRevealInterferenceCandidate(candidateIndex, stageSnapshot) {
  const sourceIndex = sourceIndexForCandidate(candidateIndex)
  if (sourceIndex === 0 || sourceIndex === 1) {
    return Boolean(stageSnapshot?.revealed?.[sourceIndex])
  }
  return Boolean(stageSnapshot?.fieldRevealed)
}

function damp(current, target, smoothing, delta) {
  return current + ((target - current) * (1 - Math.exp(-smoothing * delta)))
}

function gameMarkup() {
  return `
    <div class="qvc-game qvc-interference" data-phase="ready" data-stage="first-source" data-outcome="false">
      <div class="qvc-game__scene qvc-interference__scene" data-game-scene></div>

      <!-- Names the buoy the first time one appears. The dot sits on the buoy
           and the label reaches away from it, so the line does the pointing
           and the text never covers what it is naming. -->
      <div class="qvc-interference__annotation" data-buoy-annotation aria-hidden="true">
        <span class="qvc-interference__annotation-text">The buoy represents a qubit</span>
        <span class="qvc-interference__annotation-line" aria-hidden="true"></span>
        <span class="qvc-interference__annotation-dot" aria-hidden="true"></span>
      </div>

      <div class="qvc-interference__target-arrow" data-target-arrow aria-hidden="true">
        <div class="qvc-interference__target-arrow-body">
          <svg viewBox="0 0 64 86" aria-hidden="true">
            <path d="M32 7v50M13 38l19 19 19-19" />
          </svg>
        </div>
      </div>

      <p class="qvc__sr" data-announce aria-live="polite"></p>
    </div>
  `
}

function createBackdropTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 128
  const context = canvas.getContext('2d')
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height)
  gradient.addColorStop(0, '#f1f5f7')
  gradient.addColorStop(0.42, '#e6eff2')
  gradient.addColorStop(1, '#b9d8de')
  context.fillStyle = gradient
  context.fillRect(0, 0, canvas.width, canvas.height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  return texture
}

export function sampleInterferenceConfettiSize(random = Math.random) {
  const sample = typeof random === 'function' ? random() : 0.5
  return 0.32 + (clamp01(sample) * 0.39)
}

export function createConfetti({ random = Math.random } = {}) {
  const count = 84
  const geometry = new THREE.PlaneGeometry(0.18, 0.38)
  const vertexColors = new Float32Array(geometry.attributes.position.count * 3)
  vertexColors.fill(1)
  geometry.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3))
  const palette = INTERFERENCE_CONFETTI_PALETTE.map(color => new THREE.Color(color))
  const material = new THREE.MeshBasicMaterial({
    blending: THREE.NormalBlending,
    color: '#ffffff',
    depthWrite: false,
    fog: false,
    opacity: 0,
    side: THREE.DoubleSide,
    toneMapped: false,
    transparent: true,
    vertexColors: true
  })
  const pieces = new THREE.InstancedMesh(geometry, material, count)
  pieces.name = 'InterferenceOutcomeConfetti'
  pieces.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  pieces.frustumCulled = false
  pieces.visible = false

  const burstOrigin = new THREE.Vector3()
  const position = new THREE.Vector3()
  const rotation = new THREE.Euler()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const matrix = new THREE.Matrix4()
  const pieceData = Array.from({ length: count }, (_, index) => {
    const band = ((index * 13) % 29) / 28
    const turn = index * 2.399963229728653
    pieces.setColorAt(index, palette[index % palette.length])
    const size = sampleInterferenceConfettiSize(random)
    return Object.freeze({
      angularX: 4.8 + (((index * 7) % 17) * 0.38),
      angularY: -5.2 + (((index * 11) % 23) * 0.46),
      angularZ: 3.6 + (((index * 5) % 19) * 0.42),
      delay: (index % 7) * 0.026,
      phase: ((index * 17) % 31) / 31 * Math.PI,
      scaleX: size * (0.72 + ((((index * 3) % 11) / 10) * 0.72)),
      scaleY: size * (0.74 + ((((index * 5) % 13) / 12) * 0.62)),
      velocityX: Math.cos(turn) * (2.2 + (band * 3.5)),
      velocityY: 4.4 + ((((index * 11) % 23) / 22) * 3.3),
      velocityZ: Math.sin(turn) * (1.5 + (band * 2.5))
    })
  })
  pieces.instanceColor.needsUpdate = true
  let age = Number.POSITIVE_INFINITY
  /* One burst rig serves both the finale and the small step bursts that mark each
     rise of the winner's flag. Strength scales how many pieces fly, how hard they
     are thrown and how long they last, so a step burst is recognisably the same
     effect at a fraction of the size rather than a second thing to maintain. */
  let activeCount = count
  let throwScale = 1
  let sizeScale = 1
  let lifeScale = 1

  function writePiece(index, localAge) {
    const piece = pieceData[index]
    if (index >= activeCount) {
      scale.setScalar(0)
      matrix.compose(burstOrigin, quaternion.identity(), scale)
      pieces.setMatrixAt(index, matrix)
      return
    }
    if (localAge < 0) {
      scale.setScalar(0)
      matrix.compose(burstOrigin, quaternion.identity(), scale)
      pieces.setMatrixAt(index, matrix)
      return
    }

    const drag = 0.48
    const travel = (1 - Math.exp(-drag * localAge)) / drag
    position.set(
      burstOrigin.x + (piece.velocityX * throwScale * travel),
      burstOrigin.y + (piece.velocityY * throwScale * localAge) -
        (3.55 * localAge * localAge),
      burstOrigin.z + (piece.velocityZ * throwScale * travel)
    )
    rotation.set(
      piece.phase + (piece.angularX * localAge),
      piece.phase * 0.7 + (piece.angularY * localAge),
      piece.phase * 0.35 + (piece.angularZ * localAge)
    )
    quaternion.setFromEuler(rotation)
    const entrance = easeOutCubic(localAge / 0.08)
    scale.set(
      piece.scaleX * sizeScale * entrance,
      piece.scaleY * sizeScale * entrance,
      entrance
    )
    matrix.compose(position, quaternion, scale)
    pieces.setMatrixAt(index, matrix)
  }

  function burst(origin, { strength = 1 } = {}) {
    const safeStrength = Math.max(0.08, Math.min(1, Number(strength) || 0))
    activeCount = Math.max(5, Math.round(count * safeStrength))
    throwScale = 0.52 + (0.48 * safeStrength)
    sizeScale = 0.68 + (0.32 * safeStrength)
    lifeScale = 0.5 + (0.5 * safeStrength)
    age = 0
    burstOrigin.copy(origin)
    pieces.visible = true
    material.opacity = 1
    for (let index = 0; index < count; index += 1) {
      writePiece(index, -pieceData[index].delay)
    }
    pieces.instanceMatrix.needsUpdate = true
  }

  function update(delta) {
    if (!pieces.visible) return
    age += delta
    for (let index = 0; index < count; index += 1) {
      writePiece(index, age - pieceData[index].delay)
    }
    pieces.instanceMatrix.needsUpdate = true
    material.opacity = 1 - smoothstep01((age - (1.55 * lifeScale)) / (1.25 * lifeScale))
    if (age >= 2.8 * lifeScale) pieces.visible = false
  }

  return {
    burst,
    points: pieces,
    reset() {
      age = Number.POSITIVE_INFINITY
      material.opacity = 0
      pieces.visible = false
      activeCount = count
      throwScale = 1
      sizeScale = 1
      lifeScale = 1
    },
    update,
    dispose() {
      pieces.dispose()
      geometry.dispose()
      material.dispose()
    }
  }
}

function setMaterialVisibility(material, amount) {
  const safeAmount = clamp01(amount)
  const transparent = safeAmount < 0.999
  if (material.transparent !== transparent) {
    material.transparent = transparent
    material.needsUpdate = true
  }
  material.opacity = safeAmount
  material.depthWrite = safeAmount > 0.96
}

export function createInterferenceGame(host, options) {
  return withSceneSetup(defer => buildInterferenceGame(host, options, defer))
}

async function buildInterferenceGame(
  host,
  { buoyAssets, onActivity, onGameComplete, showUpNext, random = Math.random, RoomEnvironment, signal },
  defer
) {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = gameMarkup().trim()
  const root = wrapper.firstElementChild

  const guidance = createInterferenceGuidance()
  defer(() => guidance.dispose())
  const { lesson, finaleExplainer, interactionTooltip } = guidance
  const targetArrow = root.querySelector('[data-target-arrow]')
  const buoyAnnotation = root.querySelector('[data-buoy-annotation]')
  const announcement = root.querySelector('[data-announce]')
  announcement.before(guidance.element)
  host.replaceChildren(root)
  defer(() => root.remove())

  const sceneHost = root.querySelector('[data-game-scene]')
  const lessonStages = Array.from(root.querySelectorAll('[data-lesson-stage]'))

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  const stages = createInterferenceStages({
    buoyCount: INTERFERENCE_SOURCE_CANDIDATE_INDICES.length,
    random,
    reducedMotion
  })
  const round = createInterferenceRound({
    fixedWinnerIndex: 0,
    observationPositions: INTERFERENCE_CANDIDATE_LAYOUT,
    random
  })

  const scene = new THREE.Scene()
  const borrowed = new Set()
  buoyAssets.template.traverse(object => {
    if (object.geometry) borrowed.add(object.geometry)
    for (const material of [object.material].flat().filter(Boolean)) {
      borrowed.add(material)
      for (const value of Object.values(material)) if (value?.isTexture) borrowed.add(value)
    }
  })
  defer(() => disposeObject3DResources(scene, { preserve: borrowed }))
  const backdropTexture = createBackdropTexture()
  defer(() => backdropTexture.dispose())
  scene.background = backdropTexture

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 360)
  const rendererLease = leaseWebGLRenderer(THREE, {
    alpha: false,
    antialias: true,
    depth: true,
    powerPreference: 'high-performance',
    stencil: true
  })
  defer(() => rendererLease.release())
  const { renderer } = rendererLease
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.82
  renderer.domElement.className = 'qvc-game__canvas qvc-interference__canvas'
  renderer.domElement.tabIndex = 0
  renderer.domElement.setAttribute('role', 'application')
  renderer.domElement.setAttribute(
    'aria-label',
    'Quantum interference. Activate only the glowing buoy to send one wave across the field.'
  )
  sceneHost.append(renderer.domElement)

  const pmrem = new THREE.PMREMGenerator(renderer)
  let environmentTarget = null
  defer(() => { environmentTarget?.dispose(); pmrem.dispose() })
  if (RoomEnvironment) {
    const roomEnvironment = new RoomEnvironment()
    environmentTarget = pmrem.fromScene(roomEnvironment, 0.04)
    scene.environment = environmentTarget.texture
    scene.environmentIntensity = 0.72
    disposeObject3DResources(roomEnvironment)
  }

  const hemisphere = new THREE.HemisphereLight('#e9f6f4', '#527d80', 0.62)
  scene.add(hemisphere)
  const keyLight = new THREE.DirectionalLight('#fff4df', 1.05)
  keyLight.position.set(-8, 13, 11)
  scene.add(keyLight)
  const fillLight = new THREE.DirectionalLight('#a9dbe0', 0.36)
  fillLight.position.set(11, 7, -9)
  scene.add(fillLight)

  const winnerLayout = INTERFERENCE_CANDIDATE_LAYOUT[INTERFERENCE_WINNER_CANDIDATE_INDEX]
  const outcomePullPositions = INTERFERENCE_CANDIDATE_LAYOUT.filter(
    (_, candidateIndex) => candidateIndex !== INTERFERENCE_WINNER_CANDIDATE_INDEX
  )
  const water = createInterferenceWater({
    THREE,
    width: WATER_WIDTH,
    depth: WATER_DEPTH,
    segmentsX: WATER_SEGMENTS_X,
    segmentsZ: WATER_SEGMENTS_Z,
    outcomePullPositions,
    solutionPosition: winnerLayout,
    variant: 'full'
  })
  scene.add(water.group)

  const proxyGeometry = new THREE.SphereGeometry(1.12, 18, 12)
  const proxyMaterial = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    opacity: 0,
    transparent: true
  })

  const hitProxies = []
  const buoyRigs = INTERFERENCE_CANDIDATE_LAYOUT.map((layout, candidateIndex) => {
    const sourceIndex = sourceIndexForCandidate(candidateIndex)
    const identity = candidateIndex === INTERFERENCE_WINNER_CANDIDATE_INDEX
      ? 'winner'
      : 'candidate'
    const buoy = cloneBuoy({
      THREE,
      template: buoyAssets.template,
      identity,
      qubitLineSeed: candidateIndex + 1
    })
    buoy.root.scale.multiplyScalar(1.35)
    const sceneQubitCenterY = buoy.qubitMetrics.centerY * buoy.root.scale.y
    const sceneQubitRadius = buoy.qubitMetrics.radius * buoy.root.scale.y
    const loserOutcomeSink = calculateHalfSubmergedBuoyOffset({
      centerY: sceneQubitCenterY,
      radius: sceneQubitRadius
    })
    buoy.setFlagYaw(BUOY_SCREEN_EAST_YAW - layout.heading)
    buoy.setFlagHeight(INTERFERENCE_VISUAL_CONFIG.normalFlagHeight)
    buoy.setOutcome(0)
    buoy.setColorStrength(sourceIndex === null ? 0.5 : 1)
    buoy.setCue(0)

    const group = new THREE.Group()
    group.name = `InterferenceCandidate-${String(candidateIndex + 1).padStart(2, '0')}`
    group.position.set(layout.x, 0, layout.z)
    group.rotation.y = layout.heading +
      (sourceIndex === 0 ? INITIAL_BUOY_YAW_OFFSET : 0)
    const inner = new THREE.Group()
    inner.add(buoy.root)
    group.add(inner)

    let hitProxy = null
    if (sourceIndex !== null) {
      hitProxy = new THREE.Mesh(proxyGeometry, proxyMaterial)
      hitProxy.position.y = 0.54
      hitProxy.userData.candidateIndex = candidateIndex
      hitProxy.userData.sourceIndex = sourceIndex
      hitProxy.visible = false
      inner.add(hitProxy)
      hitProxies.push(hitProxy)
    }

    const startsVisible = candidateIndex === INTERFERENCE_WINNER_CANDIDATE_INDEX
    group.visible = startsVisible
    inner.position.y = startsVisible ? 0 : SUBMERGED_REVEAL_Y
    scene.add(group)

    return {
      buoy,
      candidateIndex,
      cue: 0,
      fieldY: 0,
      flagHeight: INTERFERENCE_VISUAL_CONFIG.normalFlagHeight,
      group,
      hitProxy,
      inner,
      layout,
      loserOutcomeSink,
      revealAt: startsVisible
        ? -INTERFERENCE_MOTION_CONFIG.revealDuration
        : Number.POSITIVE_INFINITY,
      revealLift: 0,
      revealProgress: startsVisible ? 1 : 0,
      sourceIndex,
      tapAt: Number.NEGATIVE_INFINITY
    }
  })

  const horizonUp = new THREE.Vector3(0, 1, 0)
  const horizonNormal = new THREE.Vector3()
  const backgroundBuoyRigs = INTERFERENCE_BACKGROUND_BUOY_LAYOUT.map((layout, patternIndex) => {
    const surface = sampleInterferenceHorizon(layout.x, layout.z)
    const buoy = cloneBuoy({
      THREE,
      template: buoyAssets.template,
      identity: 'candidate',
      /* Offset past the field buoys' seeds so the two sets do not share angles. */
      qubitLineSeed: INTERFERENCE_CANDIDATE_LAYOUT.length + patternIndex + 1
    })
    buoy.root.scale.multiplyScalar(1.35)
    const sceneQubitCenterY = buoy.qubitMetrics.centerY * buoy.root.scale.y
    const sceneQubitRadius = buoy.qubitMetrics.radius * buoy.root.scale.y
    const loserOutcomeSink = calculateHalfSubmergedBuoyOffset({
      centerY: sceneQubitCenterY,
      radius: sceneQubitRadius
    })
    buoy.setFlagYaw(BUOY_SCREEN_EAST_YAW - layout.heading)
    buoy.setFlagHeight(INTERFERENCE_VISUAL_CONFIG.normalFlagHeight)
    buoy.setColorStrength(0.5)
    buoy.setCue(0)

    const anchor = new THREE.Group()
    anchor.name = `InterferenceBackground-${layout.id}`
    anchor.position.set(layout.x, surface.height, layout.z)
    anchor.visible = false
    horizonNormal.set(surface.normalX, surface.normalY, surface.normalZ)
    anchor.quaternion.setFromUnitVectors(horizonUp, horizonNormal)

    const inner = new THREE.Group()
    inner.rotation.y = layout.heading
    inner.position.y = SUBMERGED_REVEAL_Y
    inner.add(buoy.root)
    anchor.add(inner)
    scene.add(anchor)

    return {
      anchor,
      buoy,
      fieldY: 0,
      flagHeight: INTERFERENCE_VISUAL_CONFIG.normalFlagHeight,
      inner,
      layout,
      loserOutcomeSink,
      patternIndex,
      revealAt: Number.POSITIVE_INFINITY,
      revealLift: 0,
      revealProgress: 0,
      surfaceHeight: surface.height
    }
  })

  const confetti = createConfetti()
  scene.add(confetti.points)

  const clock = new THREE.Clock()
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const projectedTarget = new THREE.Vector3()
  const stepConfettiOrigin = new THREE.Vector3()
  const cameraPosition = new THREE.Vector3(0, 7, 14)
  const cameraTarget = new THREE.Vector3(0, 0, -0.45)

  let animationFrame = 0
  defer(() => cancelAnimationFrame(animationFrame))
  let disposed = false
  let previousFrameTime = 0
  let solutionBuildProgress = 0
  let roundEpoch = 0
  let fieldRevealAt = Number.POSITIVE_INFINITY
  let crestTintProgress = 0
  let sequenceSolutionShown = 0
  let fieldRedProgress = 0
  let lessonKey = null
  let lessonInputLocked = false
  let lessonTransitionAwaitingPaint = false
  let lessonTransitioning = false
  let lessonTransitionTimer = null
  let presentationSignature = ''
  let previousPhase = INTERFERENCE_PHASES.READY
  let outcome = false
  let cameraWhooshPlayback = null
  let cameraWhooshPlayed = false
  let payoffPlayed = false

  /* Only the two "Interference — where waves meet" cards, the constructive and
     destructive versions of the same beat. Every other explainer, including the
     single probability wave, leaves the water its own colour. */
  const CREST_TINT_LESSONS = Object.freeze(['constructive', 'destructive'])

  function crestTintTarget() {
    return CREST_TINT_LESSONS.includes(lessonKey) ? 1 : 0
  }

  function localTime() {
    return clock.getElapsedTime() - roundEpoch
  }

  function spokenText(...segments) {
    return segments
      .filter(Boolean)
      .map(segment => String(segment).trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .map(segment => /[.!?]$/.test(segment) ? segment : `${segment}.`)
      .join(' ')
  }

  function setAccessibleInstruction(text) {
    renderer.domElement.setAttribute('aria-label', text)
    announcement.textContent = text
  }

  function cancelLessonTransitionTimer() {
    if (lessonTransitionTimer === null) return
    window.clearTimeout(lessonTransitionTimer)
    lessonTransitionTimer = null
  }

  function commitLesson(key, stageSnapshot) {
    if (disposed || lessonKey !== key) return
    const copy = LESSON_COPY[key]
    const isBlocking = Boolean(copy?.continue)
    const presentation = getInterferencePresentation({
      outcome,
      stage: stageSnapshot.stage
    })
    lessonStages.forEach(stage => {
      stage.hidden = stage.dataset.lessonStage !== key
    })
    /* The diagrams are clips now, and the panels are shown by toggling `hidden`
       rather than through the explainer's visibility API, so playback is driven
       from here alongside the switch that reveals them. */
    setLessonPlayback(lesson, key)
    lesson.dataset.lessonStage = key
    lesson.dataset.isBlocking = String(isBlocking)
    lesson.hidden = false
    lesson.setAttribute('aria-hidden', 'false')
    lesson.toggleAttribute('inert', false)
    lesson.inert = false
    void lesson.offsetWidth
    lesson.classList.add('is-showing')
    lessonInputLocked = isBlocking
    lessonTransitionAwaitingPaint = true
    setAccessibleInstruction(copy
      ? spokenText(
          copy.title,
          copy.graphic?.alt,
          copy.body,
          presentation.tip
        )
      : spokenText('The combined interference field is resolving'))
  }

  function openLesson(key, stageSnapshot) {
    if (lessonKey === key) return
    cancelLessonTransitionTimer()
    const shouldFadeOut = !reducedMotion && lesson.classList.contains('is-showing')
    lessonKey = key
    lessonInputLocked = true
    lessonTransitionAwaitingPaint = false
    lessonTransitioning = true
    lesson.classList.remove('is-showing')
    lesson.setAttribute('aria-hidden', 'true')
    lesson.toggleAttribute('inert', true)
    lesson.inert = true

    if (!shouldFadeOut) {
      commitLesson(key, stageSnapshot)
      return
    }

    lessonTransitionTimer = window.setTimeout(() => {
      lessonTransitionTimer = null
      commitLesson(key, stageSnapshot)
    }, INTERFERENCE_TOOLTIP_MOTION_CONFIG.exitMs)
  }

  function closeLesson() {
    if (lessonKey === null) return
    cancelLessonTransitionTimer()
    const shouldFadeOut = !reducedMotion && lesson.classList.contains('is-showing')
    lessonKey = null
    lessonInputLocked = false
    lessonTransitionAwaitingPaint = false
    lessonTransitioning = shouldFadeOut
    lesson.classList.remove('is-showing')
    lesson.setAttribute('aria-hidden', 'true')
    lesson.toggleAttribute('inert', true)
    lesson.inert = true

    const finishClose = () => {
      lessonTransitionTimer = null
      if (disposed || lessonKey !== null) return
      /* Stopped only once the panel is actually gone, so a clip keeps running
         through the fade rather than freezing halfway out. */
      setLessonPlayback(lesson, null)
      lesson.hidden = true
      lessonTransitioning = false
    }
    if (shouldFadeOut) {
      lessonTransitionTimer = window.setTimeout(
        finishClose,
        INTERFERENCE_TOOLTIP_MOTION_CONFIG.exitMs
      )
    } else {
      finishClose()
    }
  }

  function syncLesson(stageSnapshot) {
    if (stageSnapshot.stage === INTERFERENCE_STAGES.FIRST_SOURCE) openLesson('intro', stageSnapshot)
    else if (stageSnapshot.stage === INTERFERENCE_STAGES.FIRST_LESSON) openLesson('one', stageSnapshot)
    else if (stageSnapshot.stage === INTERFERENCE_STAGES.SECOND_SOURCE) openLesson('bridge', stageSnapshot)
    else if (stageSnapshot.stage === INTERFERENCE_STAGES.SECOND_LESSON) openLesson('constructive', stageSnapshot)
    else if (stageSnapshot.stage === INTERFERENCE_STAGES.THIRD_LESSON) openLesson('destructive', stageSnapshot)
    else if (stageSnapshot.stage === INTERFERENCE_STAGES.FIELD_SEQUENCE) openLesson('add', stageSnapshot)
    else closeLesson()
  }

  function applyPresentation(stageSnapshot) {
    const presentation = getInterferencePresentation({
      outcome,
      stage: stageSnapshot.stage
    })
    const targetBoundTip = stageSnapshot.stage === INTERFERENCE_STAGES.FIRST_SOURCE ||
      stageSnapshot.stage === INTERFERENCE_STAGES.SECOND_SOURCE ||
      stageSnapshot.stage === INTERFERENCE_STAGES.FIELD_SEQUENCE
    const showTip = Boolean(presentation.tip) &&
      (!targetBoundTip || stageSnapshot.targetIndex !== null)
    const signature = [
      presentation.title,
      presentation.body,
      presentation.tip,
      presentation.showTitle,
      showTip
    ].join('|')
    if (signature === presentationSignature) return
    presentationSignature = signature

    updateKioskTooltip(interactionTooltip, {
      replay: true,
      text: presentation.tip ?? '',
      visible: showTip
    })
    updateKioskExplainer(finaleExplainer, {
      visible: presentation.showTitle
    })
    if (presentation.showTitle) {
      setAccessibleInstruction(spokenText(
        presentation.title,
        presentation.body,
        presentation.tip
      ))
    } else if (lessonKey === null) {
      setAccessibleInstruction(spokenText(
        presentation.tip || 'The combined interference field is resolving'
      ))
    }
  }

  function syncStagePresentation(stageSnapshot) {
    root.dataset.stage = stageSnapshot.stage
    syncLesson(stageSnapshot)
    applyPresentation(stageSnapshot)
  }

  function revealDelay(item) {
    if (item.sourceIndex === 0 || item.sourceIndex === 1) return 0
    const radialDistance = Math.hypot(
      item.layout.x - winnerLayout.x,
      item.layout.z - winnerLayout.z
    )
    return reducedMotion ? 0 : radialDistance * 0.045
  }

  function updateReveal(item, stageSnapshot, time) {
    const shouldReveal = shouldRevealInterferenceCandidate(
      item.candidateIndex,
      stageSnapshot
    )
    if (shouldReveal && !Number.isFinite(item.revealAt)) {
      const baseTime = stageSnapshot.fieldRevealed ? fieldRevealAt : time
      item.revealAt = baseTime + revealDelay(item)
    }
    if (!shouldReveal) item.revealAt = Number.POSITIVE_INFINITY

    const reveal = shouldReveal
      ? sampleInterferenceRevealMotion(time - item.revealAt, reducedMotion)
      : { lift: 0, progress: 0 }
    item.revealLift = reveal.lift
    item.revealProgress = reveal.progress
    item.group.visible = item.revealProgress > 0
  }

  function updateCue(stageSnapshot, time, delta) {
    const targetCandidateIndex = candidateIndexForSource(stageSnapshot.targetIndex)
    const pulse = 0.9 + (0.1 * Math.sin(time * 3.15))

    for (const item of buoyRigs) {
      const targetCue = item.candidateIndex === targetCandidateIndex
        ? pulse * item.revealProgress
        : 0
      item.cue = reducedMotion
        ? targetCue
        : damp(item.cue, targetCue, CUE_SMOOTHING, delta)
      item.buoy.setCue(item.cue, {
        outlineAmount: item.cue
      })
    }
  }

  function updateTargetArrow(stageSnapshot) {
    const targetCandidateIndex = candidateIndexForSource(stageSnapshot.targetIndex)
    const targetItem = targetCandidateIndex === null
      ? null
      : buoyRigs[targetCandidateIndex]
    const isVisible = Boolean(targetItem && targetItem.revealProgress > 0.72)

    targetArrow.classList.toggle('is-showing', isVisible)
    targetArrow.setAttribute('aria-hidden', String(!isVisible))
    if (!isVisible) return

    projectedTarget.set(
      targetItem.layout.x,
      targetItem.inner.position.y + 2.45,
      targetItem.layout.z
    )
    projectedTarget.project(camera)
    targetArrow.style.left = `${((projectedTarget.x * 0.5 + 0.5) * 100).toFixed(3)}%`
    targetArrow.style.top = `${((-projectedTarget.y * 0.5 + 0.5) * 100).toFixed(3)}%`

    /* The label rides the same buoy, but at its waterline rather than above
       its flag — that is where the board draws the dot. Only the stage rule in
       CSS decides whether it is on screen; this only ever places it. */
    projectedTarget.set(
      targetItem.layout.x,
      targetItem.inner.position.y + 0.25,
      targetItem.layout.z
    )
    projectedTarget.project(camera)
    buoyAnnotation.style.left = `${((projectedTarget.x * 0.5 + 0.5) * 100).toFixed(3)}%`
    buoyAnnotation.style.top = `${((-projectedTarget.y * 0.5 + 0.5) * 100).toFixed(3)}%`
  }

  function updateOutcomePartVisibility(item, finalProgress) {
    if (item.candidateIndex === INTERFERENCE_WINNER_CANDIDATE_INDEX) {
      setMaterialVisibility(
        item.buoy.parts.Frame.material,
        1 - smoothstep01((finalProgress - 0.08) / 0.72)
      )
      setMaterialVisibility(item.buoy.parts.Flagpole.material, 1)
      setMaterialVisibility(item.buoy.parts.Flag.material, 1)
      return
    }
    const guideVisibility = 1 - smoothstep01((finalProgress - 0.24) / 0.7)
    setMaterialVisibility(item.buoy.parts.Frame.material, guideVisibility)
    setMaterialVisibility(item.buoy.parts.Flagpole.material, guideVisibility)
    setMaterialVisibility(item.buoy.parts.Flag.material, guideVisibility)
  }

  function updateBuoys(delta, time, roundSnapshot, stageSnapshot, solutionProgress) {
    const rippleGain = calculateInterferenceWaterGains(roundSnapshot.fadeProgress).rippleGain
    const finalProgress = smoothstep01(roundSnapshot.fadeProgress)
    const timeline = sampleInterferenceOutcomeTimeline(roundSnapshot.fadeProgress)
    const loserPoseProgress = Math.max(finalProgress * 0.16, timeline.camera)
    const targetSourceIndex = stageSnapshot.targetIndex

    if (stageSnapshot.fieldRevealed && !Number.isFinite(fieldRevealAt)) {
      fieldRevealAt = time
    }

    for (const item of buoyRigs) {
      updateReveal(item, stageSnapshot, time)
      const sample = round.field.sample(item.layout.x, item.layout.z, time)
      const fieldY = sample.height * rippleGain
      item.fieldY = reducedMotion
        ? fieldY
        : damp(item.fieldY, fieldY, BUOY_FIELD_SMOOTHING, delta)

      const isWinner = item.candidateIndex === INTERFERENCE_WINNER_CANDIDATE_INDEX
      const outcomeOffset = isWinner
        ? calculateInterferenceWinnerMoundOffset(solutionProgress, timeline.camera)
        : item.loserOutcomeSink * timeline.camera
      const revealOffset = (1 - item.revealProgress) * SUBMERGED_REVEAL_Y
      const tapMotion = sampleInterferenceTapMotion(time - item.tapAt, reducedMotion)
      const isTarget = item.sourceIndex === targetSourceIndex
      const targetBreath = isTarget && !reducedMotion
        ? INTERFERENCE_MOTION_CONFIG.targetFloatAmplitude * item.cue *
          (0.5 + (0.5 * Math.sin(time * INTERFERENCE_MOTION_CONFIG.targetFloatSpeed)))
        : 0
      const targetY = item.fieldY + revealOffset + item.revealLift + outcomeOffset +
        tapMotion.lift + targetBreath
      item.inner.position.y = reducedMotion || isWinner
        ? targetY
        : damp(item.inner.position.y, targetY, BUOY_FIELD_SMOOTHING, delta)

      const attentionScale = 1 + (item.cue * 0.022)
      item.inner.scale.set(
        tapMotion.scaleXZ * attentionScale,
        tapMotion.scaleY * attentionScale,
        tapMotion.scaleXZ * attentionScale
      )

      const targetPitch = Math.max(-0.26, Math.min(0.26, -sample.slopeZ * rippleGain * 0.32))
      const loserPitch = isWinner
        ? 0
        : loserPoseProgress * (0.12 + ((item.candidateIndex % 4) * 0.035))
      const targetRoll = Math.max(-0.26, Math.min(0.26, sample.slopeX * rippleGain * 0.32)) +
        (isWinner ? 0 : loserPoseProgress * (((item.candidateIndex % 2) * 2 - 1) * 0.18)) +
        tapMotion.roll + (isTarget ? Math.sin(time * 2.7) * item.cue * 0.018 : 0)
      item.inner.rotation.x = reducedMotion
        ? targetPitch + loserPitch
        : damp(
            item.inner.rotation.x,
            targetPitch + loserPitch,
            BUOY_ROTATION_SMOOTHING,
            delta
          )
      item.inner.rotation.z = reducedMotion
        ? targetRoll
        : damp(item.inner.rotation.z, targetRoll, BUOY_ROTATION_SMOOTHING, delta)

      const liveFlagHeight = round.field.activeCount > 0
        ? calculateInterferenceLiveFlagHeight(sample.strength, sample.envelope)
        : INTERFERENCE_VISUAL_CONFIG.normalFlagHeight
      const finalFlagHeight = isWinner
        ? INTERFERENCE_VISUAL_CONFIG.enhancedFlagHeight
        : BUOY_FLAG_HEIGHT_LIMITS.min
      const targetFlagHeight = calculateInterferenceSettlingFlagHeight(
        liveFlagHeight,
        finalFlagHeight,
        timeline.flag
      )
      const smoothing = targetFlagHeight > item.flagHeight
        ? INTERFERENCE_VISUAL_CONFIG.flagRiseSmoothing
        : INTERFERENCE_VISUAL_CONFIG.flagFallSmoothing
      item.flagHeight = reducedMotion
        ? targetFlagHeight
        : damp(item.flagHeight, targetFlagHeight, smoothing, delta)
      item.buoy.setFlagHeight(item.flagHeight)
      const winnerFlagProgress = isWinner ? timeline.flag : 0
      item.buoy.setFlagAttachment(winnerFlagProgress)
      item.buoy.setFlagScale(1 + (1.9 * winnerFlagProgress))
      /* A source still waiting to be tapped keeps its blue: it is the thing being
         asked for, and a buoy that has already given up its colour does not read as
         the next thing to touch. */
      const awaitingTap = item.sourceIndex !== null &&
        roundSnapshot.remainingSources.includes(item.sourceIndex)
      const loserOutcome = awaitingTap
        ? timeline.camera
        : Math.max(fieldRedProgress, timeline.camera)
      item.buoy.setOutcome(isWinner ? solutionProgress : loserOutcome)
      updateOutcomePartVisibility(item, timeline.flag)

      if (item.hitProxy) {
        item.hitProxy.visible = item.sourceIndex === targetSourceIndex &&
          item.revealProgress > 0.62 &&
          roundSnapshot.phase !== INTERFERENCE_PHASES.SETTLING &&
          roundSnapshot.phase !== INTERFERENCE_PHASES.RESOLVED
      }
    }

    updateCue(stageSnapshot, time, delta)
    updateTargetArrow(stageSnapshot)
  }

  function updateBackgroundBuoys(delta, time, roundSnapshot, stageSnapshot) {
    const rippleGain = calculateInterferenceWaterGains(roundSnapshot.fadeProgress).rippleGain
    const timeline = sampleInterferenceOutcomeTimeline(roundSnapshot.fadeProgress)
    const guideVisibility = 1 - smoothstep01((timeline.flag - 0.24) / 0.7)
    for (const item of backgroundBuoyRigs) {
      if (stageSnapshot.fieldRevealed && !Number.isFinite(item.revealAt)) {
        const baseTime = Number.isFinite(fieldRevealAt) ? fieldRevealAt : time
        item.revealAt = baseTime + revealDelay(item)
      }
      if (!stageSnapshot.fieldRevealed) item.revealAt = Number.POSITIVE_INFINITY

      const reveal = stageSnapshot.fieldRevealed
        ? sampleInterferenceRevealMotion(time - item.revealAt, reducedMotion)
        : { lift: 0, progress: 0 }
      item.revealLift = reveal.lift
      item.revealProgress = reveal.progress
      item.anchor.visible = item.revealProgress > 0

      const sample = round.field.sample(item.layout.x, item.layout.z, time)
      const fieldY = sample.height * rippleGain
      item.fieldY = reducedMotion
        ? fieldY
        : damp(item.fieldY, fieldY, BUOY_FIELD_SMOOTHING, delta)
      item.anchor.position.y = item.surfaceHeight + item.fieldY

      const revealOffset = (1 - item.revealProgress) * SUBMERGED_REVEAL_Y
      const outcomeOffset = item.loserOutcomeSink * timeline.camera
      const targetY = revealOffset + item.revealLift + outcomeOffset
      item.inner.position.y = reducedMotion
        ? targetY
        : damp(item.inner.position.y, targetY, BUOY_FIELD_SMOOTHING, delta)

      const loserPitch = timeline.camera * (0.1 + ((item.patternIndex % 3) * 0.025))
      const loserRoll = timeline.camera * (((item.patternIndex % 2) * 2 - 1) * 0.14)
      const targetPitch = Math.max(
        -0.18,
        Math.min(0.18, -sample.slopeZ * rippleGain * 0.24)
      ) + loserPitch
      const targetRoll = Math.max(
        -0.18,
        Math.min(0.18, sample.slopeX * rippleGain * 0.24)
      ) + loserRoll
      item.inner.rotation.x = reducedMotion
        ? targetPitch
        : damp(item.inner.rotation.x, targetPitch, BUOY_ROTATION_SMOOTHING, delta)
      item.inner.rotation.z = reducedMotion
        ? targetRoll
        : damp(item.inner.rotation.z, targetRoll, BUOY_ROTATION_SMOOTHING, delta)

      const liveFlagHeight = round.field.activeCount > 0
        ? calculateInterferenceLiveFlagHeight(sample.strength, sample.envelope)
        : INTERFERENCE_VISUAL_CONFIG.normalFlagHeight
      const targetFlagHeight = calculateInterferenceSettlingFlagHeight(
        liveFlagHeight,
        BUOY_FLAG_HEIGHT_LIMITS.min,
        timeline.flag
      )
      const smoothing = targetFlagHeight > item.flagHeight
        ? INTERFERENCE_VISUAL_CONFIG.flagRiseSmoothing
        : INTERFERENCE_VISUAL_CONFIG.flagFallSmoothing
      item.flagHeight = reducedMotion
        ? targetFlagHeight
        : damp(item.flagHeight, targetFlagHeight, smoothing, delta)
      item.buoy.setFlagHeight(item.flagHeight)
      item.buoy.setOutcome(Math.max(fieldRedProgress, timeline.camera))
      setMaterialVisibility(item.buoy.parts.Frame.material, guideVisibility)
      setMaterialVisibility(item.buoy.parts.Flagpole.material, guideVisibility)
      setMaterialVisibility(item.buoy.parts.Flag.material, guideVisibility)
    }
  }

  /*
   * The finale still moves in, but not as far as it used to. The explainer card that
   * announces the one true solution covers y 380 to 1028 of the 3620-tall stage, and
   * the old end position put the winner's raised flag at 708-860 - squarely behind the
   * card. Pulling back and, mostly, raising where the camera looks drops the flag to
   * 1193-1310, clearing the card by about 165px with the buoy and the waterline still
   * comfortably in frame below it.
   */
  function updateCamera(progress) {
    const eased = reducedMotion ? (progress >= 1 ? 1 : 0) : clamp01(progress)
    cameraPosition.set(
      0,
      7 + ((5.9 - 7) * eased),
      14 + ((13.6 - 14) * eased)
    )
    cameraTarget.set(
      winnerLayout.x,
      0 + (1.95 * eased),
      -0.45 + ((winnerLayout.z + 0.35 + 0.45) * eased)
    )
    camera.position.copy(cameraPosition)
    camera.lookAt(cameraTarget)
    camera.fov = 62 - (eased * 4)
    camera.updateProjectionMatrix()
  }

  function announceProgress(snapshot) {
    if (snapshot.phase === INTERFERENCE_PHASES.RESOLVED) {
      announcement.textContent = 'State resolved. One flagged green state rises while the other possibilities cancel.'
      return
    }
    const remaining = 5 - snapshot.stepIndex
    announcement.textContent = remaining > 0
      ? `${snapshot.stepIndex} of 5 sources active. ${remaining} remaining.`
      : 'All five sources active. The shared field is settling.'
  }

  function activateSource(sourceIndex, time = localTime()) {
    const stageSnapshot = stages.snapshot(time)
    if (stageSnapshot.targetIndex !== sourceIndex) return false
    if (!round.tap(sourceIndex, time)) return false
    if (!stages.tap(sourceIndex, time)) return false
    const candidateIndex = candidateIndexForSource(sourceIndex)
    if (candidateIndex !== null) buoyRigs[candidateIndex].tapAt = time
    onActivity?.()
    sound.waterDunk()
    const nextRoundSnapshot = round.snapshot(time)
    const nextStageSnapshot = stages.snapshot(time)
    if (
      !cameraWhooshPlayed &&
      !reducedMotion &&
      nextRoundSnapshot.phase === INTERFERENCE_PHASES.SETTLING &&
      nextStageSnapshot.stage === INTERFERENCE_STAGES.RESOLVING
    ) {
      cameraWhooshPlayed = true
      cameraWhooshPlayback = sound.interferenceCameraWhoosh({
        delaySeconds: INTERFERENCE_CAMERA_WHOOSH_TIMING.cueDelaySeconds
      })
    }
    announceProgress(nextRoundSnapshot)
    syncStagePresentation(nextStageSnapshot)
    return true
  }

  function continueLesson(time = localTime()) {
    if (lessonTransitioning) {
      onActivity?.()
      return true
    }
    if (lessonKey === null || !LESSON_COPY[lessonKey]?.continue) return false
    onActivity?.()
    if (lessonInputLocked) return true
    const didContinue = stages.continueLesson(time)
    if (didContinue) {
      syncStagePresentation(stages.snapshot(time))
    }
    return didContinue
  }

  function onPointerDown(event) {
    if (!event.isPrimary || event.button > 0) return
    if (outcome) {
      onActivity?.()
      /* The finale's prompt reads "Tap to finish", and finishing means being
         shown what is next — not being put back at the start of the game they
         have just completed, which is what this used to do. */
      showUpNext?.()
      return
    }
    if (continueLesson()) return

    const bounds = renderer.domElement.getBoundingClientRect()
    if (bounds.width < 1 || bounds.height < 1) return
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1
    )
    raycaster.setFromCamera(pointer, camera)
    const time = localTime()
    const hit = raycaster.intersectObjects(
      hitProxies.filter(proxy => proxy.visible),
      false
    )[0]
    if (hit) {
      activateSource(hit.object.userData.sourceIndex, time)
      return
    }

    /* Bare water no longer answers a tap. Only the highlighted buoy sends a
       wave, so a ripple raised anywhere else was a second kind of wave with no
       source and no bearing on the sequence — visitors read it as progress and
       kept tapping open water instead of the buoy they had been asked for. */
    onActivity?.()
  }

  function onKeyDown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    if (outcome) {
      onActivity?.()
      showUpNext?.()
      return
    }
    if (continueLesson()) return
    const time = localTime()
    const targetIndex = stages.snapshot(time).targetIndex
    if (targetIndex !== null) activateSource(targetIndex, time)
  }

  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('keydown', onKeyDown)
  defer(() => { renderer.domElement.removeEventListener('pointerdown', onPointerDown); renderer.domElement.removeEventListener('keydown', onKeyDown) })

  function resize() {
    const rect = sceneHost.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return
    camera.aspect = rect.width / rect.height
    camera.updateProjectionMatrix()
    renderer.setPixelRatio(calculateQvcPixelRatio({
      devicePixelRatio: window.devicePixelRatio,
      height: rect.height,
      width: rect.width
    }))
    renderer.setSize(rect.width, rect.height, false)
  }

  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(sceneHost)
  window.addEventListener('resize', resize)
  defer(() => { resizeObserver.disconnect(); window.removeEventListener('resize', resize) })

  function restart() {
    roundEpoch = clock.getElapsedTime()
    previousFrameTime = 0
    solutionBuildProgress = 0
    const roundSnapshot = round.restart(0)
    const stageSnapshot = stages.reset(0)
    previousPhase = roundSnapshot.phase
    fieldRevealAt = Number.POSITIVE_INFINITY
    outcome = false
    cameraWhooshPlayback?.stop()
    cameraWhooshPlayback = null
    cameraWhooshPlayed = false
    payoffPlayed = false
    presentationSignature = ''
    confetti.reset()
    root.dataset.outcome = 'false'
    root.dataset.phase = roundSnapshot.phase
    root.dataset.stage = stageSnapshot.stage
    targetArrow.classList.remove('is-showing')
    targetArrow.setAttribute('aria-hidden', 'true')
    updateKioskTooltip(interactionTooltip)
    updateKioskExplainer(finaleExplainer, { visible: false })
    announcement.textContent = 'Interference reset. Activate the glowing central buoy to begin.'

    for (const item of buoyRigs) {
      const startsVisible = item.candidateIndex === INTERFERENCE_WINNER_CANDIDATE_INDEX
      item.revealProgress = startsVisible ? 1 : 0
      item.revealAt = startsVisible
        ? -INTERFERENCE_MOTION_CONFIG.revealDuration
        : Number.POSITIVE_INFINITY
      item.revealLift = 0
      item.group.visible = startsVisible
      item.fieldY = 0
      item.cue = 0
      item.inner.position.y = startsVisible ? 0 : SUBMERGED_REVEAL_Y
      item.inner.rotation.x = 0
      item.inner.rotation.z = 0
      item.inner.scale.setScalar(1)
      item.tapAt = Number.NEGATIVE_INFINITY
      item.flagHeight = INTERFERENCE_VISUAL_CONFIG.normalFlagHeight
      item.buoy.setFlagHeight(INTERFERENCE_VISUAL_CONFIG.normalFlagHeight)
      item.buoy.setFlagAttachment(0)
      item.buoy.setFlagScale(1)
      item.buoy.setOutcome(0)
      item.buoy.setCue(0, { outlineAmount: 0 })
      updateOutcomePartVisibility(item, 0)
      if (item.hitProxy) {
        item.hitProxy.visible = item.sourceIndex === 0
      }
    }
    for (const item of backgroundBuoyRigs) {
      item.fieldY = 0
      item.flagHeight = INTERFERENCE_VISUAL_CONFIG.normalFlagHeight
      item.revealAt = Number.POSITIVE_INFINITY
      item.revealLift = 0
      item.revealProgress = 0
      item.anchor.position.y = item.surfaceHeight
      item.anchor.visible = false
      item.inner.position.y = SUBMERGED_REVEAL_Y
      item.inner.rotation.x = 0
      item.inner.rotation.z = 0
      item.buoy.setFlagHeight(INTERFERENCE_VISUAL_CONFIG.normalFlagHeight)
      item.buoy.setOutcome(0)
      setMaterialVisibility(item.buoy.parts.Frame.material, 1)
      setMaterialVisibility(item.buoy.parts.Flagpole.material, 1)
      setMaterialVisibility(item.buoy.parts.Flag.material, 1)
    }
    crestTintProgress = 0
    sequenceSolutionShown = 0
    fieldRedProgress = 0
    water.update(round.field.getUniformState(), 0, {
      crestTint: 0,
      outcomeProgress: 0,
      pulseProgress: 0,
      rippleGain: 1,
      solutionProgress: 0
    })
    syncStagePresentation(stageSnapshot)
  }

  function animate() {
    if (disposed) return
    animationFrame = requestAnimationFrame(animate)
    const time = localTime()
    const delta = previousFrameTime === 0
      ? 1 / 60
      : Math.min(0.05, Math.max(0.001, time - previousFrameTime))
    previousFrameTime = time
    const roundSnapshot = round.update(time)
    const stageSnapshot = stages.update(time)

    root.dataset.phase = roundSnapshot.phase
    root.dataset.stage = stageSnapshot.stage

    if (roundSnapshot.phase !== previousPhase) {
      previousPhase = roundSnapshot.phase
      if (roundSnapshot.phase === INTERFERENCE_PHASES.RESOLVED) {
        outcome = true
        root.dataset.outcome = 'true'
        announceProgress(roundSnapshot)
        if (!payoffPlayed) {
          payoffPlayed = true
          /* The third principle resolving is the end of the module, not just of
             this game — it is what lets the module offer what comes next. */
          onGameComplete?.('interference')
          const origin = new THREE.Vector3(
            winnerLayout.x,
            INTERFERENCE_OUTCOME_VISUAL_CONFIG.winnerOutcomeRise + 1.15,
            winnerLayout.z
          )
          confetti.burst(origin)
          sound.chime()
        }
      }
    }
    const timeline = sampleInterferenceOutcomeTimeline(roundSnapshot.fadeProgress)
    const sequenceSolutionTarget = calculateInterferenceSequenceSolutionProgress(
      roundSnapshot.stepIndex,
      INTERFERENCE_SOURCE_CANDIDATE_INDICES.length
    )
    /* Each activation lifts the winner's flag another step. Mark the moment it
       starts rising rather than the moment it arrives: the burst wants to lead the
       movement, the way it does at the finale. */
    if (sequenceSolutionTarget > sequenceSolutionShown + 0.001) {
      sequenceSolutionShown = sequenceSolutionTarget
      if (!reducedMotion && roundSnapshot.phase !== INTERFERENCE_PHASES.RESOLVED) {
        confetti.burst(
          stepConfettiOrigin.set(
            winnerLayout.x,
            calculateInterferenceWinnerMoundOffset(
              solutionBuildProgress,
              timeline.camera
            ) + 1.05,
            winnerLayout.z
          ),
          { strength: INTERFERENCE_STEP_CONFETTI_STRENGTH }
        )
      }
    }
    const solutionTarget = Math.max(sequenceSolutionTarget, timeline.mound)
    solutionBuildProgress = reducedMotion
      ? solutionTarget
      : damp(
          solutionBuildProgress,
          solutionTarget,
          INTERFERENCE_MOTION_CONFIG.solutionStepSmoothing,
          delta
        )
    const fieldRedTarget = calculateInterferenceFieldRedProgress(
      stageSnapshot.activatedCount,
      INTERFERENCE_SOURCE_CANDIDATE_INDICES.length,
      stageSnapshot.fieldRevealed
    )
    fieldRedProgress = reducedMotion
      ? fieldRedTarget
      : damp(
          fieldRedProgress,
          fieldRedTarget,
          INTERFERENCE_MOTION_CONFIG.fieldRedSmoothing,
          delta
        )
    updateCamera(timeline.camera)
    const crestTint = crestTintTarget()
    crestTintProgress = reducedMotion
      ? crestTint
      : damp(
          crestTintProgress,
          crestTint,
          INTERFERENCE_MOTION_CONFIG.crestTintSmoothing,
          delta
        )
    water.update(round.field.getUniformState(), time, {
      crestTint: crestTintProgress,
      outcomeProgress: timeline.camera,
      pulseProgress: timeline.pulse,
      rippleGain: calculateInterferenceWaterGains(roundSnapshot.fadeProgress).rippleGain,
      solutionProgress: solutionBuildProgress
    })
    updateBuoys(delta, time, roundSnapshot, stageSnapshot, solutionBuildProgress)
    updateBackgroundBuoys(delta, time, roundSnapshot, stageSnapshot)
    confetti.update(delta)
    syncStagePresentation(stageSnapshot)
    renderer.render(scene, camera)
    if (lessonTransitionAwaitingPaint) {
      lessonTransitionAwaitingPaint = false
      lessonTransitioning = false
    }
    lessonInputLocked = false
    if (!renderer.domElement.classList.contains('is-ready')) {
      renderer.domElement.classList.add('is-ready')
    }
  }

  resize()
  restart()
  // Precompile the opaque and fading buoy variants plus hidden confetti and
  // background rigs. Finale fading must not introduce its first shader here.
  const fadeMaterials = [...buoyRigs, ...backgroundBuoyRigs].flatMap(item =>
    ['Frame', 'Flagpole', 'Flag'].map(name => item.buoy.parts[name].material)
  )
  await warmSceneVariants(renderer, scene, camera, { fadeMaterials, signal })
  restart()
  animationFrame = requestAnimationFrame(animate)

  return {
    restart,
    dispose() {
      if (disposed) return
      disposed = true
      cameraWhooshPlayback?.stop()
      cameraWhooshPlayback = null
      cancelLessonTransitionTimer()
      guidance.dispose()
      cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      window.removeEventListener('resize', resize)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('keydown', onKeyDown)
      buoyRigs.forEach(item => item.buoy.dispose())
      backgroundBuoyRigs.forEach(item => item.buoy.dispose())
      proxyGeometry.dispose()
      proxyMaterial.dispose()
      confetti.dispose()
      water.dispose()
      backdropTexture.dispose()
      environmentTarget?.dispose()
      pmrem.dispose()
      scene.clear()
      rendererLease.release()
      root.remove()
    }
  }
}
