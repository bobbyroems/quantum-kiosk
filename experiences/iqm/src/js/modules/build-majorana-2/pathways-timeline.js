const freezeRange = (startMs, endMs) => Object.freeze({ startMs, endMs })

// Authored leg durations for the one-shot intro. Nothing on the screen accepts
// a tap until the intro reaches `copy.endMs`, so the sum of these legs is the
// visitor's lockout budget - keep it short and retune it here rather than in
// the derived timestamps below.
const INTRO_LEGS = Object.freeze({
  enterMs: 300,
  externalMs: 1_000,
  cmosHoldMs: 900,
  controlMs: 780,
  qpuHoldMs: 900,
  readoutMs: 1_000,
  copyDelayMs: 150,
  copyFadeMs: 400,
  loopHandoffMs: 300
})

// The looping cycle runs a little slower than the intro: by then the visitor
// can interact, so the pace serves reading rather than getting out of the way.
const LOOP_LEGS = Object.freeze({
  externalMs: 1_400,
  cmosHoldMs: 1_000,
  controlMs: 900,
  qpuHoldMs: 1_000,
  readoutMs: 1_400,
  pauseMs: 400
})

// Each label fades in a beat after its own leg starts, so the copy follows the
// pulse instead of racing it.
const LABEL_FADE_MS = 250
const LABEL_DELAY_RATIO = 0.36

const introExternalStartMs = INTRO_LEGS.enterMs
const introCmosHoldStartMs = introExternalStartMs + INTRO_LEGS.externalMs
const introControlStartMs = introCmosHoldStartMs + INTRO_LEGS.cmosHoldMs
const introQpuHoldStartMs = introControlStartMs + INTRO_LEGS.controlMs
const introReadoutStartMs = introQpuHoldStartMs + INTRO_LEGS.qpuHoldMs
const introReadoutEndMs = introReadoutStartMs + INTRO_LEGS.readoutMs
const copyStartMs = introReadoutEndMs + INTRO_LEGS.copyDelayMs
const copyEndMs = copyStartMs + INTRO_LEGS.copyFadeMs

function labelRange(legStartMs, legDurationMs) {
  const startMs = legStartMs + Math.round(legDurationMs * LABEL_DELAY_RATIO)
  return freezeRange(startMs, startMs + LABEL_FADE_MS)
}

export const PATHWAYS_TIMINGS = Object.freeze({
  enterEndMs: INTRO_LEGS.enterMs,
  junctionHoldMs: LOOP_LEGS.cmosHoldMs,
  pulseAbsorptionMs: 260,
  pulseEmissionMs: 260,
  intro: Object.freeze({
    external: freezeRange(introExternalStartMs, introCmosHoldStartMs),
    cmosHold: freezeRange(introCmosHoldStartMs, introControlStartMs),
    control: freezeRange(introControlStartMs, introQpuHoldStartMs),
    qpuHold: freezeRange(introQpuHoldStartMs, introReadoutStartMs),
    readout: freezeRange(introReadoutStartMs, introReadoutEndMs)
  }),
  labels: Object.freeze({
    external: labelRange(introExternalStartMs, INTRO_LEGS.externalMs),
    control: labelRange(introControlStartMs, INTRO_LEGS.controlMs),
    readout: labelRange(introReadoutStartMs, INTRO_LEGS.readoutMs)
  }),
  copy: freezeRange(copyStartMs, copyEndMs),
  loopStartMs: copyEndMs + INTRO_LEGS.loopHandoffMs,
  loop: Object.freeze({
    ...LOOP_LEGS,
    durationMs:
      LOOP_LEGS.externalMs +
      LOOP_LEGS.cmosHoldMs +
      LOOP_LEGS.controlMs +
      LOOP_LEGS.qpuHoldMs +
      LOOP_LEGS.readoutMs +
      LOOP_LEGS.pauseMs
  }),
  componentGlowRadiusMs: 225
})

const clamp01 = value => Math.max(0, Math.min(1, value))
const smoothstep = value => {
  const clamped = clamp01(value)
  return clamped * clamped * (3 - (2 * clamped))
}
// A selected pathway replays the loop's own travel legs, and
// `getPathwaysContinuationElapsed` maps one timeline onto the other by
// assuming they match. Derive them so the two cannot drift apart.
const DETAIL_PATHWAY_TRAVEL_MS = Object.freeze({
  external: PATHWAYS_TIMINGS.loop.externalMs,
  control: PATHWAYS_TIMINGS.loop.controlMs,
  readout: PATHWAYS_TIMINGS.loop.readoutMs
})

const OVERVIEW_PATHWAY_START_MS = Object.freeze({
  external: 0,
  control:
    PATHWAYS_TIMINGS.loop.externalMs +
    PATHWAYS_TIMINGS.loop.cmosHoldMs,
  readout:
    PATHWAYS_TIMINGS.loop.externalMs +
    PATHWAYS_TIMINGS.loop.cmosHoldMs +
    PATHWAYS_TIMINGS.loop.controlMs +
    PATHWAYS_TIMINGS.loop.qpuHoldMs
})

function progressBetween(elapsedMs, range) {
  const durationMs = range.endMs - range.startMs
  if (durationMs <= 0) return elapsedMs >= range.endMs ? 1 : 0
  return clamp01((elapsedMs - range.startMs) / durationMs)
}

function glowAt(elapsedMs, junctionMs) {
  const distance = Math.abs(elapsedMs - junctionMs)
  const linearGlow = clamp01(
    1 - (distance / PATHWAYS_TIMINGS.componentGlowRadiusMs)
  )

  // Smoothstep keeps the highlight soft at both edges while retaining an
  // exact peak when the pulse touches the component.
  return linearGlow * linearGlow * (3 - (2 * linearGlow))
}

function glowAcrossHold(elapsedMs, holdStartMs, holdEndMs) {
  if (elapsedMs >= holdStartMs && elapsedMs <= holdEndMs) return 1
  const nearestEdge = elapsedMs < holdStartMs ? holdStartMs : holdEndMs
  return glowAt(elapsedMs, nearestEdge)
}

function hiddenPulse() {
  return {
    visible: false,
    pathwayId: null,
    progress: 0
  }
}

function movingPulse(pathwayId, progress, presentation = {}) {
  const opacity = clamp01(presentation.opacity ?? 1)
  const scale = Math.max(0, presentation.scale ?? 1)
  const absorptionProgress = clamp01(presentation.absorptionProgress ?? 0)
  const emissionProgress = clamp01(presentation.emissionProgress ?? 1)
  const pulse = {
    visible: opacity > 0,
    pathwayId,
    progress: clamp01(progress)
  }

  if (opacity < 1) pulse.opacity = opacity
  if (scale !== 1) pulse.scale = scale
  if (absorptionProgress > 0) pulse.absorptionProgress = absorptionProgress
  if (emissionProgress < 1) pulse.emissionProgress = emissionProgress
  return pulse
}

function emittedPulse(pathwayId, elapsedMs, durationMs) {
  const emissionMs = Math.min(
    PATHWAYS_TIMINGS.pulseEmissionMs,
    Math.max(0, durationMs)
  )
  const reveal = emissionMs > 0
    ? smoothstep(elapsedMs / emissionMs)
    : 1
  const travelDurationMs = Math.max(1, durationMs - emissionMs)
  const travelElapsedMs = Math.max(0, elapsedMs - emissionMs)
  const progress = travelElapsedMs / travelDurationMs

  return movingPulse(pathwayId, progress, {
    opacity: reveal,
    scale: 0.68 + (0.32 * reveal),
    emissionProgress: reveal
  })
}

function absorbingPulse(pathwayId, elapsedMs) {
  const absorption = smoothstep(
    elapsedMs / PATHWAYS_TIMINGS.pulseAbsorptionMs
  )
  return movingPulse(pathwayId, 1, {
    opacity: 1 - absorption,
    scale: 1 - (0.32 * absorption),
    absorptionProgress: absorption
  })
}

function absorbedPulse(pathwayId) {
  return {
    visible: false,
    pathwayId,
    progress: 1
  }
}

function introPulse(elapsedMs) {
  const { intro } = PATHWAYS_TIMINGS

  if (elapsedMs >= intro.external.startMs && elapsedMs < intro.external.endMs) {
    return emittedPulse(
      'external',
      elapsedMs - intro.external.startMs,
      intro.external.endMs - intro.external.startMs
    )
  }
  if (elapsedMs >= intro.cmosHold.startMs && elapsedMs < intro.cmosHold.endMs) {
    const holdElapsedMs = elapsedMs - intro.cmosHold.startMs
    return holdElapsedMs < PATHWAYS_TIMINGS.pulseAbsorptionMs
      ? absorbingPulse('external', holdElapsedMs)
      : absorbedPulse('external')
  }
  if (elapsedMs >= intro.control.startMs && elapsedMs < intro.control.endMs) {
    return emittedPulse(
      'control',
      elapsedMs - intro.control.startMs,
      intro.control.endMs - intro.control.startMs
    )
  }
  if (elapsedMs >= intro.qpuHold.startMs && elapsedMs < intro.qpuHold.endMs) {
    const holdElapsedMs = elapsedMs - intro.qpuHold.startMs
    return holdElapsedMs < PATHWAYS_TIMINGS.pulseAbsorptionMs
      ? absorbingPulse('control', holdElapsedMs)
      : absorbedPulse('control')
  }
  if (elapsedMs >= intro.readout.startMs && elapsedMs < intro.readout.endMs) {
    return emittedPulse(
      'readout',
      elapsedMs - intro.readout.startMs,
      intro.readout.endMs - intro.readout.startMs
    )
  }
  return hiddenPulse()
}

function getIntroFrame(elapsedMs) {
  const { intro, labels, copy, enterEndMs } = PATHWAYS_TIMINGS
  const introProgress = {
    external: progressBetween(elapsedMs, intro.external),
    control: progressBetween(elapsedMs, intro.control),
    readout: progressBetween(elapsedMs, intro.readout)
  }
  const pulse = introPulse(elapsedMs)

  return {
    phase: elapsedMs < enterEndMs ? 'enter' : 'intro',
    introProgress,
    labelOpacity: {
      external: progressBetween(elapsedMs, labels.external),
      control: progressBetween(elapsedMs, labels.control),
      readout: progressBetween(elapsedMs, labels.readout)
    },
    copyOpacity: progressBetween(elapsedMs, copy),
    pulse,
    activePathwayId: pulse.pathwayId,
    componentGlow: {
      cmos: glowAcrossHold(
        elapsedMs,
        intro.cmosHold.startMs,
        intro.cmosHold.endMs
      ),
      qpu: glowAcrossHold(
        elapsedMs,
        intro.qpuHold.startMs,
        intro.qpuHold.endMs
      )
    }
  }
}

function getLoopFrame(elapsedMs) {
  const { loop, loopStartMs } = PATHWAYS_TIMINGS
  const loopElapsedMs = (elapsedMs - loopStartMs) % loop.durationMs
  const externalEndMs = loop.externalMs
  const cmosHoldEndMs = externalEndMs + loop.cmosHoldMs
  const controlEndMs = cmosHoldEndMs + loop.controlMs
  const qpuHoldEndMs = controlEndMs + loop.qpuHoldMs
  const readoutEndMs = qpuHoldEndMs + loop.readoutMs
  let pulse = hiddenPulse()

  if (loopElapsedMs < externalEndMs) {
    pulse = emittedPulse('external', loopElapsedMs, loop.externalMs)
  } else if (loopElapsedMs < cmosHoldEndMs) {
    const holdElapsedMs = loopElapsedMs - externalEndMs
    pulse = holdElapsedMs < PATHWAYS_TIMINGS.pulseAbsorptionMs
      ? absorbingPulse('external', holdElapsedMs)
      : absorbedPulse('external')
  } else if (loopElapsedMs < controlEndMs) {
    pulse = emittedPulse(
      'control',
      loopElapsedMs - cmosHoldEndMs,
      loop.controlMs
    )
  } else if (loopElapsedMs < qpuHoldEndMs) {
    const holdElapsedMs = loopElapsedMs - controlEndMs
    pulse = holdElapsedMs < PATHWAYS_TIMINGS.pulseAbsorptionMs
      ? absorbingPulse('control', holdElapsedMs)
      : absorbedPulse('control')
  } else if (loopElapsedMs < readoutEndMs) {
    pulse = emittedPulse(
      'readout',
      loopElapsedMs - qpuHoldEndMs,
      loop.readoutMs
    )
  }

  return {
    phase: 'loop',
    introProgress: {
      external: 1,
      control: 1,
      readout: 1
    },
    labelOpacity: {
      external: 1,
      control: 1,
      readout: 1
    },
    copyOpacity: 1,
    pulse,
    activePathwayId: pulse.pathwayId,
    componentGlow: {
      cmos: glowAcrossHold(
        loopElapsedMs,
        externalEndMs,
        cmosHoldEndMs
      ),
      qpu: glowAcrossHold(
        loopElapsedMs,
        controlEndMs,
        qpuHoldEndMs
      )
    }
  }
}

export function getSelectedPathwayFrame(
  elapsedMs,
  pathwayId
) {
  const travelMs = DETAIL_PATHWAY_TRAVEL_MS[pathwayId]
  if (!travelMs) return getPathwaysFrame(elapsedMs)

  const safeElapsedMs = Number.isFinite(elapsedMs)
    ? Math.max(0, elapsedMs)
    : 0
  const endpointHoldMs = pathwayId === 'readout'
    ? 0
    : PATHWAYS_TIMINGS.junctionHoldMs
  const cycleDurationMs = travelMs + endpointHoldMs + PATHWAYS_TIMINGS.loop.pauseMs
  const cycleElapsedMs = safeElapsedMs % cycleDurationMs
  let pulse = hiddenPulse()

  if (cycleElapsedMs < travelMs) {
    pulse = emittedPulse(pathwayId, cycleElapsedMs, travelMs)
  } else if (
    endpointHoldMs > 0 &&
    cycleElapsedMs < travelMs + endpointHoldMs
  ) {
    const holdElapsedMs = cycleElapsedMs - travelMs
    pulse = holdElapsedMs < PATHWAYS_TIMINGS.pulseAbsorptionMs
      ? absorbingPulse(pathwayId, holdElapsedMs)
      : absorbedPulse(pathwayId)
  }

  return {
    phase: 'detail',
    introProgress: {
      external: 1,
      control: 1,
      readout: 1
    },
    labelOpacity: {
      external: 1,
      control: 1,
      readout: 1
    },
    copyOpacity: 1,
    pulse,
    activePathwayId: pulse.pathwayId,
    highlightedPathwayId: pathwayId,
    componentGlow: {
      cmos: pathwayId === 'external' ? 1 : 0,
      qpu: pathwayId === 'control' ? 1 : 0
    }
  }
}

/**
 * Projects the final phase of a selected-pathway loop back onto the overview
 * loop. This lets the same pulse continue through the system when the detail
 * card closes instead of reviving the overview pulse at its old frozen time.
 */
export function getPathwaysContinuationElapsed(
  selectedElapsedMs,
  pathwayId,
  minimumElapsedMs = PATHWAYS_TIMINGS.loopStartMs
) {
  const travelMs = DETAIL_PATHWAY_TRAVEL_MS[pathwayId]
  const pathwayStartMs = OVERVIEW_PATHWAY_START_MS[pathwayId]
  if (!travelMs || !Number.isFinite(pathwayStartMs)) {
    return Math.max(
      PATHWAYS_TIMINGS.loopStartMs,
      Number.isFinite(minimumElapsedMs) ? minimumElapsedMs : 0
    )
  }

  const safeSelectedElapsedMs = Number.isFinite(selectedElapsedMs)
    ? Math.max(0, selectedElapsedMs)
    : 0
  const endpointHoldMs = pathwayId === 'readout'
    ? 0
    : PATHWAYS_TIMINGS.junctionHoldMs
  const cycleDurationMs =
    travelMs + endpointHoldMs + PATHWAYS_TIMINGS.loop.pauseMs
  const cycleElapsedMs = safeSelectedElapsedMs % cycleDurationMs
  const pauseStartMs = travelMs + endpointHoldMs
  let overviewOffsetMs

  if (cycleElapsedMs < pauseStartMs) {
    // Travel and absorption/hold phases exist in both timelines, so their
    // visual state can be transferred one-to-one.
    overviewOffsetMs = pathwayStartMs + cycleElapsedMs
  } else if (pathwayId === 'readout') {
    // The readout reset pause is also the overview loop's reset pause.
    overviewOffsetMs = pathwayStartMs + cycleElapsedMs
  } else {
    // The component has already absorbed the pulse. Resume at the next path's
    // zero-opacity emission frame so the pulse emerges instead of teleporting.
    overviewOffsetMs = pathwayStartMs + pauseStartMs
  }

  const firstMatchingElapsedMs =
    PATHWAYS_TIMINGS.loopStartMs + overviewOffsetMs
  const safeMinimumElapsedMs = Number.isFinite(minimumElapsedMs)
    ? Math.max(PATHWAYS_TIMINGS.loopStartMs, minimumElapsedMs)
    : PATHWAYS_TIMINGS.loopStartMs
  const cyclesToMinimum = Math.max(
    0,
    Math.ceil(
      (safeMinimumElapsedMs - firstMatchingElapsedMs) /
      PATHWAYS_TIMINGS.loop.durationMs
    )
  )

  return firstMatchingElapsedMs +
    (cyclesToMinimum * PATHWAYS_TIMINGS.loop.durationMs)
}

export function getPathwaysFrame(elapsedMs) {
  const safeElapsedMs = Number.isFinite(elapsedMs)
    ? Math.max(0, elapsedMs)
    : 0

  if (safeElapsedMs < PATHWAYS_TIMINGS.loopStartMs) {
    return getIntroFrame(safeElapsedMs)
  }
  return getLoopFrame(safeElapsedMs)
}
