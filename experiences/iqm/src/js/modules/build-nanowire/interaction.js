export const NANOWIRE_PHASES = Object.freeze({
  loading: 'loading',
  awaitingStart: 'awaitingStart',
  intro: 'intro',
  ready: 'ready',
  assembling: 'assembling',
  scanning: 'scanning',
  inspect: 'inspect',
  targeted: 'targeted',
  correcting: 'correcting',
  repaired: 'repaired',
  finale: 'finale',
  complete: 'complete'
})

export const NANOWIRE_EVENTS = Object.freeze({
  loaded: 'loaded',
  started: 'started',
  introduced: 'introduced',
  swiped: 'swiped',
  assembled: 'assembled',
  scanned: 'scanned',
  targeted: 'targeted',
  untargeted: 'untargeted',
  correct: 'correct',
  repaired: 'repaired',
  finalized: 'finalized',
  completed: 'completed'
})

const TRANSITIONS = Object.freeze({
  [NANOWIRE_PHASES.loading]: Object.freeze({
    [NANOWIRE_EVENTS.loaded]: NANOWIRE_PHASES.awaitingStart
  }),
  [NANOWIRE_PHASES.awaitingStart]: Object.freeze({
    [NANOWIRE_EVENTS.started]: NANOWIRE_PHASES.intro
  }),
  [NANOWIRE_PHASES.intro]: Object.freeze({
    [NANOWIRE_EVENTS.introduced]: NANOWIRE_PHASES.ready
  }),
  [NANOWIRE_PHASES.ready]: Object.freeze({
    [NANOWIRE_EVENTS.swiped]: NANOWIRE_PHASES.assembling
  }),
  [NANOWIRE_PHASES.assembling]: Object.freeze({
    [NANOWIRE_EVENTS.assembled]: NANOWIRE_PHASES.scanning
  }),
  [NANOWIRE_PHASES.scanning]: Object.freeze({
    [NANOWIRE_EVENTS.scanned]: NANOWIRE_PHASES.inspect
  }),
  [NANOWIRE_PHASES.inspect]: Object.freeze({
    [NANOWIRE_EVENTS.targeted]: NANOWIRE_PHASES.targeted
  }),
  [NANOWIRE_PHASES.targeted]: Object.freeze({
    [NANOWIRE_EVENTS.untargeted]: NANOWIRE_PHASES.inspect,
    [NANOWIRE_EVENTS.correct]: NANOWIRE_PHASES.correcting
  }),
  [NANOWIRE_PHASES.correcting]: Object.freeze({
    [NANOWIRE_EVENTS.repaired]: NANOWIRE_PHASES.repaired
  }),
  [NANOWIRE_PHASES.repaired]: Object.freeze({
    [NANOWIRE_EVENTS.finalized]: NANOWIRE_PHASES.finale
  }),
  [NANOWIRE_PHASES.finale]: Object.freeze({
    [NANOWIRE_EVENTS.completed]: NANOWIRE_PHASES.complete
  })
})

const clamp01 = value => Math.min(1, Math.max(0, value))
const easeInOutCubic = value => {
  const t = clamp01(value)
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
const easeOutCubic = value => 1 - Math.pow(1 - clamp01(value), 3)
const smoothstep01 = value => {
  const t = clamp01(value)
  return t * t * (3 - (2 * t))
}
const smootherstep01 = value => {
  const t = clamp01(value)
  return t * t * t * ((t * ((t * 6) - 15)) + 10)
}
const TAU = Math.PI * 2
const sine01 = phase => 0.5 + (Math.sin(phase * TAU) * 0.5)

export const NANOWIRE_FLOW_DEBUG_MODES = Object.freeze({
  final: 'final',
  macro: 'macro',
  filaments: 'filaments',
  gust: 'gust'
})

export const NANOWIRE_FLOW_DEFAULT_SEED = 0x6d2b79f5

export const NANOWIRE_ERROR_DISPLACEMENT = Object.freeze({
  radius: 1.68,
  innerRadius: 0.28,
  maximumOffset: 0.22
})

export const NANOWIRE_SCAN_VIBRATION = Object.freeze({
  duration: 1_050,
  attack: 110,
  release: 420
})

export const NANOWIRE_LOUPE_TARGETING = Object.freeze({
  lockRadius: 52,
  releaseRadius: 72,
  centeringDuration: 360,
  pullRadius: 900,
  pullStrength: 0.98,
  pullCurve: 1.5
})

export const NANOWIRE_INTRO_TIMING = Object.freeze({
  /* The hero atom is the first presentation-ready frame under the route wipe,
     so its entrance is intentionally immediate and its hold owns the opening beat. */
  atomEntrance: 0,
  atomHold: 120,
  lineDuration: 1_350,
  lineHold: 750,
  sheetDuration: 1_400,
  sheetHold: 150,
  /* Fast enough to keep the prompt responsive, but long enough for the raised
     atom sheet to grow and settle instead of appearing in a single frame. */
  handoffDuration: 240,
  totalDuration: 4_010
})

export const NANOWIRE_INTRO_REDUCED_TIMING = Object.freeze({
  atomEntrance: 0,
  atomHold: 120,
  lineDuration: 1,
  lineHold: 249,
  sheetDuration: 1,
  sheetHold: 249,
  handoffDuration: 1,
  totalDuration: 621
})

export const NANOWIRE_FLOW_MOTION = Object.freeze({
  perturbation: Object.freeze({
    advectionSpeed: 0.00034,
    meander: 0.18,
    fineMeander: 0.075,
    shapeWarp: 0.09,
    lateralDrift: 0.065,
    continuityFloor: 0.34
  }),
  corrected: Object.freeze({
    advectionSpeed: 0.00032,
    meander: 0.16,
    fineMeander: 0.065,
    shapeWarp: 0.075,
    lateralDrift: 0.052,
    continuityFloor: 0.46
  })
})

const PERTURBATION_FILAMENTS = Object.freeze([
  Object.freeze({ offset: 0.08, width: 0.16, wave: 0.58, sway: 0.92, fine: 1.86, flutter: 1.34, packet: 0.82, packetSpeed: 0.74, widthWave: 1.12, target: 0.04, gain: 1 }),
  Object.freeze({ offset: 0.34, width: 0.13, wave: 0.79, sway: -0.71, fine: 2.28, flutter: 1.08, packet: 1.04, packetSpeed: 0.57, widthWave: 1.47, target: 0.96, gain: 0.94 }),
  Object.freeze({ offset: 0.61, width: 0.15, wave: 0.66, sway: 0.63, fine: 1.67, flutter: -1.26, packet: 0.91, packetSpeed: 0.82, widthWave: 1.26, target: 0.08, gain: 0.98 }),
  Object.freeze({ offset: 0.87, width: 0.12, wave: 0.93, sway: -1.08, fine: 2.46, flutter: 0.91, packet: 1.16, packetSpeed: 0.66, widthWave: 1.61, target: 0.84, gain: 0.9 })
])

const CORRECTED_FILAMENTS = Object.freeze([
  Object.freeze({ offset: 0.06, width: 0.13, wave: 0.51, sway: 0.76, fine: 1.72, flutter: -0.88, packet: 0.72, packetSpeed: 0.52, widthWave: 1.03, target: 0.04, gain: 0.98 }),
  Object.freeze({ offset: 0.3, width: 0.11, wave: 0.68, sway: -0.58, fine: 2.12, flutter: 0.81, packet: 0.87, packetSpeed: 0.43, widthWave: 1.31, target: 0.68, gain: 0.94 }),
  Object.freeze({ offset: 0.55, width: 0.125, wave: 0.59, sway: 0.54, fine: 1.84, flutter: 0.96, packet: 0.76, packetSpeed: 0.61, widthWave: 1.17, target: 0.08, gain: 1 }),
  Object.freeze({ offset: 0.8, width: 0.115, wave: 0.82, sway: -0.72, fine: 2.34, flutter: -0.79, packet: 0.96, packetSpeed: 0.49, widthWave: 1.42, target: 0.84, gain: 0.92 }),
  Object.freeze({ offset: 1.02, width: 0.1, wave: 0.63, sway: 0.69, fine: 1.59, flutter: 1.12, packet: 0.81, packetSpeed: 0.57, widthWave: 1.23, target: 0.22, gain: 0.86 })
])

const FLOW_PRESETS = Object.freeze({
  perturbation: Object.freeze({
    motion: NANOWIRE_FLOW_MOTION.perturbation,
    filaments: PERTURBATION_FILAMENTS,
    verticalSkew: 0.13,
    macroBase: 0.54,
    macroAmplitude: 0.16,
    macroDetail: 0.09,
    mixGain: 1.08
  }),
  corrected: Object.freeze({
    motion: NANOWIRE_FLOW_MOTION.corrected,
    filaments: CORRECTED_FILAMENTS,
    verticalSkew: 0.1,
    macroBase: 0.27,
    macroAmplitude: 0.12,
    macroDetail: 0.06,
    mixGain: 1.12
  })
})

function resolveFlowSeedPhase(seed) {
  const safeSeed = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : NANOWIRE_FLOW_DEFAULT_SEED
  let mixed = Math.imul(safeSeed ^ 0x9e3779b9, 0x85ebca6b) >>> 0
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35) >>> 0
  return ((mixed ^ (mixed >>> 16)) >>> 0) / 0xffffffff
}

function selectFlowDiagnostic(debugMode, macro, filaments, gust, finalValue) {
  if (debugMode === NANOWIRE_FLOW_DEBUG_MODES.macro) return clamp01(macro)
  if (debugMode === NANOWIRE_FLOW_DEBUG_MODES.filaments) return clamp01(filaments)
  if (debugMode === NANOWIRE_FLOW_DEBUG_MODES.gust) return clamp01(gust)
  return clamp01(finalValue)
}

export function nextNanowirePhase(phase, event) {
  return TRANSITIONS[phase]?.[event] ?? phase
}

export function resolveNanowireIntroSequence(elapsed, options = {}, out = {}) {
  const timing = options.timing
    ?? (options.reducedMotion ? NANOWIRE_INTRO_REDUCED_TIMING : NANOWIRE_INTRO_TIMING)
  const safeElapsed = Number.isFinite(elapsed) ? Math.max(elapsed, 0) : 0
  const lineStart = timing.atomEntrance + timing.atomHold
  const sheetStart = lineStart + timing.lineDuration + timing.lineHold
  const handoffStart = sheetStart + timing.sheetDuration + timing.sheetHold
  const totalDuration = timing.totalDuration ?? (handoffStart + timing.handoffDuration)
  const complete = safeElapsed >= totalDuration

  out.stage = complete
    ? 'complete'
    : safeElapsed < lineStart
      ? 'atom'
      : safeElapsed < sheetStart
        ? 'line'
        : safeElapsed < handoffStart
          ? 'sheet'
          : 'handoff'
  out.atomProgress = timing.atomEntrance <= 0
    ? 1
    : easeOutCubic(safeElapsed / timing.atomEntrance)
  out.lineProgress = smoothstep01((safeElapsed - lineStart) / Math.max(timing.lineDuration, 1))
  out.sheetProgress = smoothstep01((safeElapsed - sheetStart) / Math.max(timing.sheetDuration, 1))
  out.handoffProgress = smoothstep01((safeElapsed - handoffStart) / Math.max(timing.handoffDuration, 1))
  out.complete = complete
  out.totalDuration = totalDuration
  return out
}

export function resolveNanowireIntroGridOpacity(timeline, maximumOpacity = 0.4) {
  if (!timeline) return maximumOpacity
  const reveal = Math.max(
    0.38,
    smoothstep01((timeline.lineProgress - 0.05) / 0.7),
    smoothstep01((timeline.sheetProgress - 0.04) / 0.86)
  )
  return maximumOpacity * reveal
}

export function isDownwardSwipe(start, end, options = {}) {
  if (!start || !end) return false
  const minimumDistance = options.minimumDistance ?? 150
  const maximumDuration = options.maximumDuration ?? 1_200
  const maximumOffAxisRatio = options.maximumOffAxisRatio ?? 0.72
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const duration = Math.max(0, end.time - start.time)

  return deltaY >= minimumDistance
    && Math.abs(deltaX) <= deltaY * maximumOffAxisRatio
    && duration <= maximumDuration
}

export function getSheetBuildTiming(sheetIndex, elapsed = null, options = {}) {
  const stagger = options.stagger ?? 270
  const revealDuration = options.revealDuration ?? 110
  const startDelay = sheetIndex * stagger

  if (elapsed === null) {
    return {
      visible: sheetIndex === 0,
      localElapsed: 0,
      revealProgress: sheetIndex === 0 ? 1 : 0
    }
  }

  const localElapsed = elapsed - startDelay
  const visible = localElapsed >= 0
  return {
    visible,
    localElapsed,
    revealProgress: visible ? clamp01(localElapsed / revealDuration) : 0
  }
}

export function resolveRigidSheetDrop(sheetIndex, elapsed = null, options = {}) {
  const duration = Math.max(options.duration ?? 760, 1)
  const sourceOffset = Math.max(options.sourceOffset ?? 3.35, 0)
  const timing = getSheetBuildTiming(sheetIndex, elapsed, options)
  const progress = elapsed === null
    ? 0
    : easeOutCubic(timing.localElapsed / duration)

  return {
    visible: timing.visible,
    progress,
    offsetY: sourceOffset * (1 - progress)
  }
}

export function resolveScanVibrationEnvelope(elapsed, options = {}) {
  if (options.active === false || options.reducedMotion) return 0

  const duration = Math.max(options.duration ?? NANOWIRE_SCAN_VIBRATION.duration, 1)
  const attack = Math.min(Math.max(options.attack ?? NANOWIRE_SCAN_VIBRATION.attack, 0), duration)
  const release = Math.min(Math.max(options.release ?? NANOWIRE_SCAN_VIBRATION.release, 0), duration)
  const safeElapsed = Number.isFinite(elapsed) ? elapsed : -1
  if (safeElapsed <= 0) return 0

  const attackEnvelope = attack <= Number.EPSILON
    ? 1
    : smoothstep01(safeElapsed / attack)
  /* The scan owns the vibration lifecycle in the live scene. Sustain lets it
     hold at full strength until inspection begins and its tooltip is revealed. */
  if (options.sustain === true) return attackEnvelope
  if (safeElapsed >= duration) return 0

  const releaseStart = Math.max(attack, duration - release)
  const releaseEnvelope = release <= Number.EPSILON || safeElapsed <= releaseStart
    ? 1
    : 1 - smoothstep01((safeElapsed - releaseStart) / Math.max(duration - releaseStart, Number.EPSILON))

  return Math.min(attackEnvelope, releaseEnvelope)
}

export function resolveErrorDisplacement(distance, revealProgress, repairProgress = 0, options = {}) {
  const radius = Math.max(options.radius ?? NANOWIRE_ERROR_DISPLACEMENT.radius, Number.EPSILON)
  const innerRadius = Math.min(Math.max(
    options.innerRadius ?? NANOWIRE_ERROR_DISPLACEMENT.innerRadius,
    0
  ), radius)
  const maximumOffset = Math.max(
    options.maximumOffset ?? NANOWIRE_ERROR_DISPLACEMENT.maximumOffset,
    0
  )
  const safeDistance = Number.isFinite(distance) ? Math.max(distance, 0) : Infinity
  if (safeDistance <= Number.EPSILON || safeDistance >= radius) return 0

  const falloffRange = Math.max(radius - innerRadius, Number.EPSILON)
  const falloff = 1 - smoothstep01((safeDistance - innerRadius) / falloffRange)
  const strength = clamp01(revealProgress) * (1 - clamp01(repairProgress))
  return maximumOffset * falloff * strength
}

export function resolveGradientSpan(value, stopCount, out = {}) {
  if (!Number.isFinite(value) || !Number.isInteger(stopCount) || stopCount < 2) {
    out.lower = 0
    out.upper = 0
    out.mix = 0
    return out
  }

  const scaled = clamp01(value) * (stopCount - 1)
  const lower = Math.min(Math.floor(scaled), stopCount - 1)
  out.lower = lower
  out.upper = Math.min(lower + 1, stopCount - 1)
  out.mix = scaled - lower
  return out
}

export function createLoupePointerMapping(bounds, designWidth, designHeight, out = {}) {
  const width = Math.max(Number.isFinite(bounds?.width) ? bounds.width : 0, 1)
  const height = Math.max(Number.isFinite(bounds?.height) ? bounds.height : 0, 1)
  out.left = Number.isFinite(bounds?.left) ? bounds.left : 0
  out.top = Number.isFinite(bounds?.top) ? bounds.top : 0
  out.scaleX = Math.max(Number.isFinite(designWidth) ? designWidth : 0, 1) / width
  out.scaleY = Math.max(Number.isFinite(designHeight) ? designHeight : 0, 1) / height
  return out
}

export function mapLoupePointer(clientX, clientY, time, mapping, out = {}) {
  const left = Number.isFinite(mapping?.left) ? mapping.left : 0
  const top = Number.isFinite(mapping?.top) ? mapping.top : 0
  const scaleX = Number.isFinite(mapping?.scaleX) ? mapping.scaleX : 1
  const scaleY = Number.isFinite(mapping?.scaleY) ? mapping.scaleY : 1
  out.x = ((Number.isFinite(clientX) ? clientX : left) - left) * scaleX
  out.y = ((Number.isFinite(clientY) ? clientY : top) - top) * scaleY
  out.time = Number.isFinite(time) ? time : 0
  return out
}

/* Pointer hardware can report several samples before the browser paints. Keep
   only the newest sample so DOM positioning and magnifier-camera work happen
   at most once per display frame. */
export function createLoupeFrameQueue(commit, options = {}) {
  if (typeof commit !== 'function') throw new TypeError('A loupe frame commit function is required')
  const requestFrame = options.requestFrame
    ?? (callback => globalThis.requestAnimationFrame(callback))
  const cancelFrame = options.cancelFrame
    ?? (frame => globalThis.cancelAnimationFrame(frame))
  const stageLatest = typeof options.stageLatest === 'function'
    ? options.stageLatest
    : null
  let frame = null
  let pending = false
  let pendingX = 0
  let pendingY = 0

  const apply = () => {
    frame = null
    if (!pending) return false
    pending = false
    commit(pendingX, pendingY)
    return true
  }

  return {
    schedule(x, y) {
      pendingX = x
      pendingY = y
      pending = true
      /* The Three.js loop is already registered before this queue's RAF. Feed
         it the latest scalars now so its next render and the queued DOM move
         present the same centre; expensive camera work still happens in RAF. */
      stageLatest?.(x, y)
      if (frame === null) frame = requestFrame(apply)
    },
    flush() {
      if (frame !== null) cancelFrame(frame)
      frame = null
      return apply()
    },
    cancel() {
      if (frame !== null) cancelFrame(frame)
      frame = null
      pending = false
    }
  }
}

function resolveFilamentFlowField(position, elapsed, options, preset) {
  const x = Number.isFinite(position?.x) ? position.x : 0
  const y = Number.isFinite(position?.y) ? position.y : 0
  const z = Number.isFinite(position?.z) ? position.z : 0
  const safeElapsed = Number.isFinite(elapsed) ? Math.max(elapsed, 0) : 0
  const motion = preset.motion
  const speed = options.speed ?? motion.advectionSpeed
  const time = safeElapsed * speed
  const seed = resolveFlowSeedPhase(options.seed ?? NANOWIRE_FLOW_DEFAULT_SEED)
  const advected = x - time
  const cross = z + ((y - 0.5) * preset.verticalSkew)
  const macro = clamp01(
    preset.macroBase
    + (Math.sin((advected * 0.53 - time * 0.21 + seed * 0.71) * TAU) * preset.macroAmplitude)
    + (Math.sin((advected * 1.17 + time * 0.36 - cross * 0.24 + seed * 1.63) * TAU) * preset.macroDetail)
  )

  let strongestFilament = 0
  let weightedTarget = 0
  let totalWeight = 0
  let gust = 0

  for (let index = 0; index < preset.filaments.length; index += 1) {
    const filament = preset.filaments[index]
    const filamentSeed = seed + (index * 0.217)
    const pathX = advected + (Math.sin((
      advected * (0.36 + index * 0.047)
      - time * (0.19 + filament.packetSpeed * 0.21)
      + filamentSeed * 1.31
    ) * TAU) * motion.shapeWarp)
    const lateralDrift = Math.sin((
      time * (0.34 + filament.wave * 0.16)
      + filamentSeed * 1.89
    ) * TAU) * motion.lateralDrift
    const centre = filament.offset
      + lateralDrift
      + (Math.sin((pathX * filament.wave + time * filament.sway + filamentSeed) * TAU) * motion.meander)
      + (Math.sin((pathX * filament.fine - time * filament.flutter + y * 0.11 + filamentSeed * 1.73) * TAU) * motion.fineMeander)
    const widthBreath = 0.76 + (sine01(
      advected * filament.widthWave - time * 0.67 + filamentSeed * 2.11
    ) * 0.24)
    const halfWidth = filament.width * widthBreath
    const normalizedDistance = Math.abs(cross - centre) / Math.max(halfWidth, Number.EPSILON)
    const centreline = 1 - smoothstep01((normalizedDistance - 0.12) / 0.88)
    const continuity = motion.continuityFloor + (sine01(
      advected * filament.packet - time * filament.packetSpeed + filamentSeed * 2.47
    ) * (1 - motion.continuityFloor))
    const localWave = 0.76 + (sine01(
      x * (filament.fine * 0.72) + time * filament.flutter + cross * 0.17 + filamentSeed * 3.19
    ) * 0.24)
    const strength = centreline * continuity * localWave * filament.gain

    strongestFilament = Math.max(strongestFilament, strength)
    weightedTarget += filament.target * strength
    totalWeight += strength
    gust += continuity * centreline
  }

  const filamentTarget = totalWeight > Number.EPSILON ? weightedTarget / totalWeight : macro
  const filamentMix = clamp01((strongestFilament * 0.76 + totalWeight * 0.21) * preset.mixGain)
  const field = macro + ((filamentTarget - macro) * filamentMix)
  const normalizedGust = clamp01(gust / preset.filaments.length)

  return selectFlowDiagnostic(
    options.debugMode,
    macro,
    strongestFilament,
    normalizedGust,
    field
  )
}

export function resolvePerturbationField(position, elapsed, options = {}) {
  return resolveFilamentFlowField(position, elapsed, options, FLOW_PRESETS.perturbation)
}

export function resolveCorrectedFlowField(position, elapsed, options = {}) {
  return resolveFilamentFlowField(position, elapsed, options, FLOW_PRESETS.corrected)
}

/* The finished wire is one uniform blue with a single light running its length.
   IQM's note on the 25 Aug board: "Entire nanowire transitions into a uniform
   blue. A smooth pulse/light wave travels from one end to the other. The flow
   is uninterrupted."

   That is deliberately not the corrected flow field above. That field is a
   turbulent weave of filaments and gusts, which is what made the old finish
   read as a moving rainbow; asked to carry a single pulse it would carry
   several at once. So the finish gets its own function, and it is the simplest
   thing that satisfies the note: one band, travelling one way, forever. */
export const NANOWIRE_CORRECTED_PULSE = Object.freeze({
  /* One length of the wire. The 3s pass moves decisively while still reading
     as one continuous wave rather than a flash across the whole model. */
  periodMs: 3000,
  /* The leading atom column owns the brightest line. Behind it, a compact
     shoulder and a longer low-energy tail step down through the lattice. The
     tiny front width keeps the wave directional instead of reading as a
     symmetric glossy stripe. */
  frontWidth: 0.045,
  trailWidth: 0.13,
  glowTrailWidth: 0.24,
  corePeak: 0.55,
  glowPeak: 0.13
})

export const NANOWIRE_CORRECTION_COLOR_TRANSITION = Object.freeze({
  /* Long enough for the multi-colour perturbation to visibly settle, but still
     within the immediate confirmation beat initiated by Correct. */
  durationMs: 780
})

export function resolveNanowireCorrectionColorTransition(elapsed, options = {}) {
  if (options.reducedMotion) return 1
  const duration = Math.max(
    options.durationMs ?? NANOWIRE_CORRECTION_COLOR_TRANSITION.durationMs,
    1
  )
  const safeElapsed = Number.isFinite(elapsed) ? Math.max(elapsed, 0) : 0
  return smootherstep01(safeElapsed / duration)
}

export const NANOWIRE_FINAL_HANDOFF = Object.freeze({
  durationMs: 920
})

export function resolveNanowireFinalHandoff(elapsed, options = {}) {
  if (options.reducedMotion) return 1
  const duration = Math.max(options.durationMs ?? NANOWIRE_FINAL_HANDOFF.durationMs, 1)
  const safeElapsed = Number.isFinite(elapsed) ? Math.max(elapsed, 0) : 0
  return smootherstep01(safeElapsed / duration)
}

/* The final Figma frame annotates the completed qubit as rising clear of the
   grid. Keep that as a separate, finite beat from the endlessly travelling
   light: the object settles once, while the light can continue uninterrupted. */
export const NANOWIRE_FINAL_RISE = Object.freeze({
  durationMs: 920,
  distance: 0.34
})

export function resolveNanowireFinalRise(elapsed, options = {}) {
  if (options.reducedMotion) return 1
  const duration = Math.max(options.durationMs ?? NANOWIRE_FINAL_RISE.durationMs, 1)
  const safeElapsed = Number.isFinite(elapsed) ? Math.max(elapsed, 0) : 0
  return smoothstep01(safeElapsed / duration)
}

export function resolveNanowireFinalFlowElapsed(now, options = {}) {
  if (options.reducedMotion) return 3_200
  const repairOrigin = Number.isFinite(options.repairStartedAt)
    ? options.repairStartedAt + Math.max(options.correctionTransitionDuration ?? 0, 0)
    : null
  /* Once correction has launched the blue pulse, the finale must inherit that
     clock. finalFlowStartedAt belongs only to the model rise; preferring it
     here would restart the light exactly as the completed wire lifts. */
  const origin = repairOrigin ?? (
    Number.isFinite(options.finalFlowStartedAt) ? options.finalFlowStartedAt : null
  )
  const safeNow = Number.isFinite(now) ? now : origin ?? 0
  return Math.max(0, safeNow - (origin ?? safeNow))
}

/**
 * How brightly the travelling pulse lights an atom, 0..1.
 *
 * The head runs from just off one end to just off the other, so the pulse
 * enters and leaves the wire rather than appearing and vanishing part way
 * along it.
 */
export function resolveCorrectedPulse(position, elapsed, options = {}) {
  const along = Number.isFinite(position?.x) ? position.x : 0
  const vertical = Number.isFinite(position?.y) ? position.y : 0.5
  const depth = Number.isFinite(position?.z) ? position.z : 0.5
  const period = Math.max(options.periodMs ?? NANOWIRE_CORRECTED_PULSE.periodMs, 1)
  const frontWidth = Math.max(
    options.frontWidth ?? NANOWIRE_CORRECTED_PULSE.frontWidth,
    0.01
  )
  const trailWidth = Math.max(
    options.trailWidth ?? NANOWIRE_CORRECTED_PULSE.trailWidth,
    frontWidth
  )
  const glowTrailWidth = Math.max(
    options.glowTrailWidth ?? NANOWIRE_CORRECTED_PULSE.glowTrailWidth,
    trailWidth
  )
  const corePeak = clamp01(options.corePeak ?? NANOWIRE_CORRECTED_PULSE.corePeak)
  const glowPeak = clamp01(options.glowPeak ?? NANOWIRE_CORRECTED_PULSE.glowPeak)
  const safeElapsed = Number.isFinite(elapsed) ? Math.max(elapsed, 0) : 0

  const travel = (safeElapsed % period) / period
  /* Start with the front just outside the left edge and finish only after the
     complete tail has left the right edge. This makes the loop continuous
     even though the profile is intentionally asymmetric. */
  const head = -frontWidth + (travel * (1 + frontWidth + glowTrailWidth))
  /* The reference is a broad volume of light, not a ruler-straight stripe.
     A small depth/height bend lets neighbouring rows meet the front at
     slightly different moments while preserving one continuous wave. */
  const bentAlong = along
    + ((depth - 0.5) * 0.045)
    + ((vertical - 0.5) * 0.018)
    + (Math.sin((depth * 1.15 + vertical * 0.32) * Math.PI) * 0.012)
  const signedDistance = bentAlong - head
  if (signedDistance >= frontWidth || signedDistance <= -glowTrailWidth) return 0

  /* Vector 114 is the visual reference, not a moving runtime layer. Applying
     this field per atom clips it to the actual model. At the head the first
     column is brightest; every column behind it receives less light. A very
     short leading falloff softens entry without creating a second shoulder. */
  if (signedDistance >= 0) {
    return clamp01(
      smootherstep01(1 - (signedDistance / frontWidth)) * (corePeak + glowPeak)
    )
  }

  const behind = -signedDistance
  const glow = smootherstep01(1 - (behind / glowTrailWidth)) * glowPeak
  const core = behind < trailWidth
    ? smootherstep01(1 - (behind / trailWidth)) * corePeak
    : 0
  return clamp01(core + glow)
}

export function resolveErrorReveal(distance, elapsed, options = {}) {
  const duration = Math.max(options.duration ?? 760, 1)
  const safeDistance = Number.isFinite(distance) ? Math.max(distance, 0) : Infinity
  const safeElapsed = Number.isFinite(elapsed) ? elapsed : 0
  const progress = clamp01(safeElapsed / duration)
  const easedProgress = smoothstep01(progress)
  const front = -0.12 + (easedProgress * 1.44)
  const edgeStart = front - 0.14
  const spatialReveal = 1 - smoothstep01((safeDistance - edgeStart) / 0.26)
  const opacityReveal = smoothstep01(progress / 0.35)
  return spatialReveal * opacityReveal
}

export function resolveRepairSequence(elapsed, options = {}) {
  const atomDuration = Math.max(options.atomDuration ?? 620, 1)
  const fieldDuration = Math.max(options.fieldDuration ?? 720, 1)
  const safeElapsed = Number.isFinite(elapsed) ? Math.max(elapsed, 0) : 0
  const totalDuration = atomDuration + fieldDuration

  return {
    atomProgress: easeInOutCubic(safeElapsed / atomDuration),
    fieldProgress: easeInOutCubic((safeElapsed - atomDuration) / fieldDuration),
    complete: safeElapsed >= totalDuration,
    totalDuration
  }
}

export function resolveCorrectionPulse(elapsed, options = {}) {
  const duration = Math.max(options.duration ?? 1_100, 1)
  if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed >= duration) return 0
  const progress = elapsed / duration
  return Math.pow(Math.sin(progress * Math.PI), 2)
}

export function resolveLoupeCenteringProgress(elapsed, options = {}) {
  if (options.reducedMotion) return 1
  const duration = Math.max(
    options.duration ?? options.centeringDuration ?? NANOWIRE_LOUPE_TARGETING.centeringDuration,
    1
  )
  const safeElapsed = Number.isFinite(elapsed) ? Math.max(elapsed, 0) : 0
  return smoothstep01(safeElapsed / duration)
}

export function resolveLoupeMagneticPull(position, defectPosition, options = {}, out = {}) {
  const x = Number.isFinite(position?.x) ? position.x : 0
  const y = Number.isFinite(position?.y) ? position.y : 0
  const defectX = Number.isFinite(defectPosition?.x) ? defectPosition.x : x
  const defectY = Number.isFinite(defectPosition?.y) ? defectPosition.y : y
  const distance = Math.hypot(x - defectX, y - defectY)
  const pullRadius = Math.max(options.pullRadius ?? NANOWIRE_LOUPE_TARGETING.pullRadius, 1)
  const pullStrength = clamp01(options.pullStrength ?? NANOWIRE_LOUPE_TARGETING.pullStrength)
  const pullCurve = Math.max(options.pullCurve ?? NANOWIRE_LOUPE_TARGETING.pullCurve, 0.001)
  const proximity = distance >= pullRadius
    ? 0
    : smoothstep01(1 - (distance / pullRadius))
  /* A long field should be perceptible without steering the loupe from across
     the screen. The power curve keeps the outer reach gentle, then ramps into
     a near-total capture once the defect enters the loupe's visible area. */
  const amount = pullStrength * Math.pow(proximity, pullCurve)

  out.x = x + ((defectX - x) * amount)
  out.y = y + ((defectY - y) * amount)
  out.distance = distance
  out.amount = amount
  return out
}

export function resolveLoupeTarget(position, defectPosition, options = {}) {
  if (!position || !defectPosition) {
    return { targeted: false, distance: Infinity, x: position?.x ?? 0, y: position?.y ?? 0 }
  }

  const lockRadius = options.lockRadius ?? NANOWIRE_LOUPE_TARGETING.lockRadius
  const releaseRadius = options.releaseRadius ?? NANOWIRE_LOUPE_TARGETING.releaseRadius
  const radius = options.wasTargeted ? releaseRadius : lockRadius
  const distance = Math.hypot(position.x - defectPosition.x, position.y - defectPosition.y)
  const targeted = distance <= radius

  return {
    targeted,
    distance,
    x: position.x,
    y: position.y
  }
}
