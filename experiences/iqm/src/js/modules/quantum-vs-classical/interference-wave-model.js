import { INTERFERENCE_SOURCE_LAYOUT } from './interference-layout.js'

/* Kept as a public alias because the round model speaks in terms of buoys. In V3
   these are specifically the five source buoys selected from the wider candidate
   field. */
export const INTERFERENCE_BUOY_LAYOUT = INTERFERENCE_SOURCE_LAYOUT

export const INTERFERENCE_WAVE_CONFIG = Object.freeze({
  amplitude: 0.19,
  damping: 0.09,
  frontWidth: 0.45,
  /*
   * The ring cadence is counted in wavelengths rather than seconds. A repeat that
   * lands on a fraction of a cycle restarts every ring at a different point in the
   * carrier, so consecutive rings alternate between leading with a crest and
   * leading with a trough — which is what made ridges read wrong where two trains
   * crossed. A whole number keeps every ring in the train identical.
   */
  pulseWavelengths: 2,
  /*
   * The last stretch of each packet is taped down to nothing, and a short run of
   * dead water follows before the next one starts. Value and slope both reach zero
   * at the repeat, so there is no seam: without this the envelope steps back up to
   * full strength at the wrap and draws a hard dark arc straight across the rings.
   * Both are measured in wavelengths.
   */
  pulseTaperWavelengths: 0.5,
  pulseHoldWavelengths: 0.25,
  speed: 1.7,
  /*
   * Shorter than the 2.18 m the field was first authored at: finer rings read as a
   * higher-resolution surface, and the five sources happen to cancel better at this
   * pitch - the tightest winner-versus-rival agreement margin across the five rounds
   * goes from 0.022 to 0.036, so the solution stands out more, not less.
   */
  wavelength: 1.7,
  /*
   * About one wavelength of coherence per ring. Long enough that rings still meet and
   * add across most of the field - two or more waves are present on 64% of it - and
   * short enough that each ring stays a ring you can trace back to its buoy instead of
   * merging with its neighbours into a labyrinth.
   */
  trailDecay: 0.9,
  /*
   * The gap between the fifth tap and the "One true solution!" card is
   * outcomeDelay + fadeDuration, and at 7.2 s the visitor had already read the
   * finished field and started looking for what to do next. Halved to 3.6 s,
   * with most of the cut taken out of the static hold rather than the camera
   * move, so the push-in still reads as a move rather than a jump.
   */
  outcomeDelay: 2.2,
  fadeDuration: 1.4
})

export const INTERFERENCE_PHASES = Object.freeze({
  READY: 'ready',
  ACTIVATING: 'activating',
  SETTLING: 'settling',
  RESOLVED: 'resolved'
})

export const INTERFERENCE_TOUCH_RIPPLE_LIMIT = 4
export const INTERFERENCE_TOUCH_RIPPLE_INTERVAL = 0.28

const TAU = Math.PI * 2

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

function smoothstep01(value) {
  const t = clamp01(value)
  return t * t * (3 - (2 * t))
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

export function combinePhaseStrength(contributions) {
  let x = 0
  let y = 0
  for (const { amplitude = 1, phase = 0 } of contributions) {
    x += amplitude * Math.cos(phase)
    y += amplitude * Math.sin(phase)
  }
  return Math.hypot(x, y)
}

function chooseWinner(count, previousWinner, random) {
  if (count <= 1) return 0
  if (!Number.isInteger(previousWinner)) {
    return Math.min(count - 1, Math.floor(clamp01(random()) * count))
  }
  const offset = 1 + Math.min(count - 2, Math.floor(clamp01(random()) * (count - 1)))
  return (previousWinner + offset) % count
}

export function createInterferenceWaveField({
  positions = INTERFERENCE_BUOY_LAYOUT,
  observationPositions = positions,
  config = INTERFERENCE_WAVE_CONFIG
} = {}) {
  if (positions.length < 2) throw new TypeError('Interference requires at least two sources')
  if (!Array.isArray(observationPositions) || observationPositions.length === 0) {
    throw new TypeError('Interference requires at least one observation position')
  }

  const waveNumber = TAU / config.wavelength
  const angularFrequency = waveNumber * config.speed
  const trailDecay = Number.isFinite(config.trailDecay)
    ? Math.max(0, config.trailDecay)
    : INTERFERENCE_WAVE_CONFIG.trailDecay
  const pulseWavelengths = Number.isFinite(config.pulseWavelengths)
    ? Math.max(1, Math.round(config.pulseWavelengths))
    : INTERFERENCE_WAVE_CONFIG.pulseWavelengths
  const pulseSpacing = pulseWavelengths * config.wavelength
  const pulseInterval = pulseSpacing / config.speed
  const pulseHold = Math.max(0, Number.isFinite(config.pulseHoldWavelengths)
    ? config.pulseHoldWavelengths
    : INTERFERENCE_WAVE_CONFIG.pulseHoldWavelengths) * config.wavelength
  const packetLength = Math.max(config.frontWidth * 2, pulseSpacing - pulseHold)
  const pulseTaper = Math.min(
    packetLength * 0.9,
    Math.max(0.0001, Number.isFinite(config.pulseTaperWavelengths)
      ? config.pulseTaperWavelengths
      : INTERFERENCE_WAVE_CONFIG.pulseTaperWavelengths) * config.wavelength
  )
  const packetTaperStart = packetLength - pulseTaper
  let targetIndex = 0
  let impulses = []
  let touchRipples = []
  let lastTouchRippleAt = Number.NEGATIVE_INFINITY

  function reset({ winnerIndex = 0 } = {}) {
    if (!Number.isInteger(winnerIndex) || !positions[winnerIndex]) {
      throw new RangeError('A valid winnerIndex is required')
    }
    targetIndex = winnerIndex
    impulses = []
    touchRipples = []
    lastTouchRippleAt = Number.NEGATIVE_INFINITY
  }

  function activate(sourceIndex, startTime) {
    if (!Number.isInteger(sourceIndex) || !positions[sourceIndex]) return false
    if (!Number.isFinite(startTime) || impulses.some(impulse => impulse.sourceIndex === sourceIndex)) {
      return false
    }

    const origin = positions[sourceIndex]
    const targetDistance = distance(origin, positions[targetIndex])
    impulses.push(Object.freeze({
      sourceIndex,
      origin,
      startTime,
      phase: (-waveNumber * targetDistance) - (angularFrequency * startTime)
    }))
    return true
  }

  function frontEnvelope(distanceFromSource, age) {
    if (age < 0) return { gate: 0, derivative: 0 }
    const front = config.speed * age
    const rawProgress = (front - distanceFromSource) / config.frontWidth
    if (rawProgress <= 0) return { gate: 0, derivative: 0 }
    if (rawProgress >= 1) return { gate: 1, derivative: 0 }

    const gate = smoothstep01(rawProgress)
    const derivative = -((6 * rawProgress) - (6 * rawProgress * rawProgress)) / config.frontWidth
    return { gate, derivative }
  }

  /* `frontEnvelope` remains the phase-stable scoring memory. For the visible water,
     distance behind that first front wraps onto a whole number of wavelengths. Each
     wrap is a fresh pulse identical to the last, so activated buoys keep radiating
     without timers or an ever-growing list of rings. */
  function visualEnvelope(distanceFromSource, age, repeating = true) {
    const front = frontEnvelope(distanceFromSource, age)
    if (front.gate <= 0) return front

    const distanceBehindFront = Math.max(
      0,
      (config.speed * age) - distanceFromSource
    )
    const pulseDistance = repeating
      ? distanceBehindFront % pulseSpacing
      : distanceBehindFront
    const pulseProgress = clamp01(pulseDistance / config.frontWidth)
    const pulseGate = smoothstep01(pulseProgress)
    const pulseDerivative = pulseProgress < 1
      ? -((6 * pulseProgress) - (6 * pulseProgress * pulseProgress)) /
        config.frontWidth
      : 0
    const trail = Math.exp(-trailDecay * pulseDistance)
    if (pulseDistance >= packetLength) return { gate: 0, derivative: 0 }

    /* Taper the tail to zero before the repeat. `taper` is 1 through the body of the
       packet and smoothsteps down to 0 at its end, where its own slope is zero too. */
    const taperProgress = clamp01((pulseDistance - packetTaperStart) / pulseTaper)
    const taper = 1 - smoothstep01(taperProgress)
    const taperSlope = taperProgress > 0 && taperProgress < 1
      ? -((6 * taperProgress) - (6 * taperProgress * taperProgress)) / pulseTaper
      : 0

    /* Derivatives are with respect to distance from the source, and distance behind
       the front runs the other way, hence the sign flip on the taper term. */
    return {
      gate: pulseGate * trail * taper,
      derivative: (taper * trail * (pulseDerivative + (trailDecay * pulseGate))) -
        (pulseGate * trail * taperSlope)
    }
  }

  function sample(x, z, time) {
    let height = 0
    let slopeX = 0
    let slopeZ = 0
    let phasorX = 0
    let phasorY = 0
    let envelope = 0

    for (const impulse of impulses) {
      const age = time - impulse.startTime
      if (age < 0) continue

      const dx = x - impulse.origin.x
      const dz = z - impulse.origin.z
      const radialDistance = Math.max(0.0001, Math.hypot(dx, dz))
      const scoringEnvelope = frontEnvelope(radialDistance, age)
      if (scoringEnvelope.gate <= 0) continue
      const visibleEnvelope = visualEnvelope(radialDistance, age)

      const attenuation = Math.exp(-config.damping * radialDistance)
      const phase = (waveNumber * radialDistance) - (angularFrequency * age) + impulse.phase
      const sine = Math.sin(phase)
      const cosine = Math.cos(phase)
      const radialDerivative = config.amplitude * attenuation * (
        (visibleEnvelope.derivative * sine) +
        (visibleEnvelope.gate * ((waveNumber * cosine) - (config.damping * sine)))
      )
      height += config.amplitude * attenuation * visibleEnvelope.gate * sine
      slopeX += radialDerivative * (dx / radialDistance)
      slopeZ += radialDerivative * (dz / radialDistance)

      const stablePhase = (waveNumber * radialDistance) +
        (angularFrequency * impulse.startTime) + impulse.phase
      phasorX += scoringEnvelope.gate * attenuation * Math.cos(stablePhase)
      phasorY += scoringEnvelope.gate * attenuation * Math.sin(stablePhase)
      envelope += scoringEnvelope.gate * attenuation
    }

    /* Touch ripples use the original fully additive physical channel. They
       move nearby buoys but intentionally never enter the scoring phasor. */
    for (const ripple of touchRipples) {
      const age = time - ripple.startTime
      if (age < 0) continue
      const dx = x - ripple.origin.x
      const dz = z - ripple.origin.z
      const radialDistance = Math.max(0.0001, Math.hypot(dx, dz))
      const visibleEnvelope = visualEnvelope(radialDistance, age, false)
      if (visibleEnvelope.gate <= 0) continue
      const attenuation = Math.exp(-config.damping * radialDistance)
      const phase = (waveNumber * radialDistance) -
        (angularFrequency * age) + ripple.phase
      const sine = Math.sin(phase)
      const cosine = Math.cos(phase)
      const radialDerivative = config.amplitude * attenuation * (
        (visibleEnvelope.derivative * sine) +
        (visibleEnvelope.gate * ((waveNumber * cosine) - (config.damping * sine)))
      )
      height += config.amplitude * attenuation * visibleEnvelope.gate * sine
      slopeX += radialDerivative * (dx / radialDistance)
      slopeZ += radialDerivative * (dz / radialDistance)
    }

    /* strength is the coherent phasor sum; envelope is the incoherent sum
       of the same contributions. strength ≈ envelope means the waves agree
       (constructive); strength ≪ envelope means they cancel. */
    return {
      envelope,
      height,
      slopeX,
      slopeZ,
      strength: Math.hypot(phasorX, phasorY)
    }
  }

  /* Per-impulse surface heights at (x, z) — the wave-chart's input lines. */
  function sampleComponents(x, z, time) {
    return impulses.map(impulse => {
      const age = time - impulse.startTime
      if (age < 0) return { sourceIndex: impulse.sourceIndex, height: 0 }
      const dx = x - impulse.origin.x
      const dz = z - impulse.origin.z
      const radialDistance = Math.max(0.0001, Math.hypot(dx, dz))
      const { gate } = visualEnvelope(radialDistance, age)
      if (gate <= 0) return { sourceIndex: impulse.sourceIndex, height: 0 }
      const attenuation = Math.exp(-config.damping * radialDistance)
      const phase = (waveNumber * radialDistance) - (angularFrequency * age) + impulse.phase
      return {
        sourceIndex: impulse.sourceIndex,
        height: config.amplitude * attenuation * gate * Math.sin(phase)
      }
    })
  }

  function getUniformState() {
    const visibleRipples = [
      ...impulses.map(impulse => ({ ...impulse, repeating: true })),
      ...touchRipples.map(impulse => ({ ...impulse, repeating: false }))
    ]
    return {
      activeCount: visibleRipples.length,
      amplitude: config.amplitude,
      angularFrequency,
      damping: config.damping,
      frontWidth: config.frontWidth,
      impulses: visibleRipples.map(impulse => ({
        originX: impulse.origin.x,
        originZ: impulse.origin.z,
        phase: impulse.phase,
        repeating: impulse.repeating,
        startTime: impulse.startTime
      })),
      packetLength,
      pulseInterval,
      pulseSpacing,
      pulseTaper,
      speed: config.speed,
      trailDecay,
      waveNumber
    }
  }

  function addTouchRipple(x, z, startTime) {
    if (![x, z, startTime].every(Number.isFinite)) return false
    /* A kiosk screen can dispatch a very dense pointer stream when visitors
       drum on the glass. Keep the gesture responsive while limiting both the
       wave work and overlapping one-shot audio to a deliberate cadence. */
    if (startTime - lastTouchRippleAt < INTERFERENCE_TOUCH_RIPPLE_INTERVAL) {
      return false
    }
    lastTouchRippleAt = startTime
    touchRipples.push(Object.freeze({
      origin: Object.freeze({ x, z }),
      phase: Math.PI * 0.5,
      startTime
    }))
    if (touchRipples.length > INTERFERENCE_TOUCH_RIPPLE_LIMIT) {
      touchRipples.shift()
    }
    return true
  }

  function lastArrivalTime() {
    let arrival = 0
    for (const impulse of impulses) {
      for (const position of observationPositions) {
        arrival = Math.max(
          arrival,
          impulse.startTime + (distance(impulse.origin, position) / config.speed)
        )
      }
    }
    return arrival
  }

  reset()
  return {
    activate,
    addTouchRipple,
    get activeCount() {
      return impulses.length
    },
    get targetIndex() {
      return targetIndex
    },
    get touchRippleCount() {
      return touchRipples.length
    },
    getUniformState,
    lastArrivalTime,
    reset,
    sample,
    sampleComponents
  }
}

export function createInterferenceRound({
  positions = INTERFERENCE_BUOY_LAYOUT,
  observationPositions = positions,
  config = INTERFERENCE_WAVE_CONFIG,
  random = Math.random,
  fixedWinnerIndex
} = {}) {
  const hasFixedWinner = fixedWinnerIndex !== undefined && fixedWinnerIndex !== null
  if (hasFixedWinner && (!Number.isInteger(fixedWinnerIndex) || !positions[fixedWinnerIndex])) {
    throw new RangeError('fixedWinnerIndex must identify a configured buoy')
  }

  const field = createInterferenceWaveField({ positions, observationPositions, config })
  let previousWinner = null
  let winnerIndex = 0
  let activated = new Set()
  let settleAt = Number.POSITIVE_INFINITY
  let resolvedAt = Number.POSITIVE_INFINITY
  let phase = INTERFERENCE_PHASES.READY

  function restart(time = 0) {
    winnerIndex = hasFixedWinner
      ? fixedWinnerIndex
      : chooseWinner(positions.length, previousWinner, random)
    if (!hasFixedWinner) previousWinner = winnerIndex
    activated = new Set()
    settleAt = Number.POSITIVE_INFINITY
    resolvedAt = Number.POSITIVE_INFINITY
    phase = INTERFERENCE_PHASES.READY
    field.reset({ winnerIndex })
    return snapshot(time)
  }

  function isTappable() {
    return phase === INTERFERENCE_PHASES.READY ||
      phase === INTERFERENCE_PHASES.ACTIVATING
  }

  function remainingSources() {
    if (!isTappable()) return []
    return positions
      .map((_, index) => index)
      .filter(index => !activated.has(index))
  }

  /* Any buoy that has not fired yet is a valid start or continuation —
     the field's phase alignment converges at the winner in every order. */
  function tap(sourceIndex, time) {
    if (!isTappable() || activated.has(sourceIndex)) return false
    if (!field.activate(sourceIndex, time)) return false

    activated.add(sourceIndex)
    if (activated.size >= positions.length) {
      phase = INTERFERENCE_PHASES.SETTLING
      /* The final tap is the cause of the payoff. Hold on the completed wave field,
         then resolve directly instead of waiting for every wave front. */
      settleAt = time + config.outcomeDelay
      resolvedAt = settleAt + config.fadeDuration
    } else {
      phase = INTERFERENCE_PHASES.ACTIVATING
    }
    return true
  }

  function update(time) {
    if (phase === INTERFERENCE_PHASES.SETTLING && time >= resolvedAt) {
      phase = INTERFERENCE_PHASES.RESOLVED
    }
    return snapshot(time)
  }

  function snapshot(time) {
    const fadeProgress = Number.isFinite(settleAt)
      ? smoothstep01((time - settleAt) / config.fadeDuration)
      : 0
    const outcomeTransitionIn = Number.isFinite(settleAt)
      ? Math.max(0, settleAt - time)
      : null
    const remaining = remainingSources()
    return Object.freeze({
      activeSourceIndex: remaining[0] ?? null,
      fadeProgress,
      outcomeTransitionIn,
      phase,
      progress: activated.size / positions.length,
      remainingSources: Object.freeze(remaining),
      stepIndex: activated.size,
      winnerIndex
    })
  }

  restart(0)
  return {
    field,
    restart,
    snapshot,
    tap,
    update
  }
}
