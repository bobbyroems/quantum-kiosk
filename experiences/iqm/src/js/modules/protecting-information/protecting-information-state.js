const TARGET_FEATHER_DEGREES = 16

function parameter({
  id,
  label,
  shortLabel = label,
  title,
  description,
  prompt,
  startDeg,
  endDeg
}) {
  return Object.freeze({
    id,
    label,
    shortLabel,
    title,
    description,
    prompt,
    targetArc: Object.freeze({
      startDeg,
      endDeg,
      featherDeg: TARGET_FEATHER_DEGREES
    }),
    initialTurn: 0
  })
}

export const PROTECTION_PARAMETERS = Object.freeze({
  temperature: parameter({
    id: 'temperature',
    label: 'Temperature',
    title: 'Freezing temperature',
    description: 'Extremely low temperature slows down electrons to better control them.',
    prompt: 'Lower the temperature',
    startDeg: 300,
    /* Runs to the end of the sweep: colder is always better here, so the top of
       the dial's travel belongs inside the target rather than past it. Stopping
       at 354 left the last six degrees — including a fully wound dial — reading
       as mistuned, which is the one place this dial cannot be wrong. */
    endDeg: 360
  }),
  voltage: parameter({
    id: 'voltage',
    label: 'Voltage',
    title: 'Voltage',
    description: 'Voltage adjusts the behavior of electrons.',
    prompt: 'Apply voltage',
    startDeg: 175,
    endDeg: 244
  }),
  magnetic: parameter({
    id: 'magnetic',
    label: 'Magnetic field',
    shortLabel: 'Magnetic\nfield',
    title: 'Magnetic field',
    description: 'A magnetic field changes how electrons organize themselves.',
    prompt: 'Apply magnetic field',
    startDeg: 147,
    endDeg: 216
  })
})

export const PROTECTION_PARAMETER_IDS = Object.freeze(Object.keys(PROTECTION_PARAMETERS))

export const PROTECTION_INTRO_COPY = Object.freeze({
  title: 'Protecting quantum information',
  description: 'Building a topoconductor is only the beginning. The right conditions are needed to help shield quantum information from noise.',
  prompt: 'Adjust all three conditions'
})

export const PROTECTION_SUCCESS_COPY = Object.freeze({
  title: 'Topoconductor activated!',
  description: 'When all three are tuned right, the topoconductor switches on and creates protected quantum states.',
  prompt: ''
})

export function clampUnit(value) {
  return Math.min(1, Math.max(0, Number(value) || 0))
}

export function normalizeDegrees(value) {
  const degrees = Number(value) || 0
  return ((degrees % 360) + 360) % 360
}

/*
 * These dials sweep 0-360 and stop at both ends — the value behind them is
 * clamped to one turn, so they cannot wrap. Measuring them circularly folded a
 * full turn back onto zero, which put the very top of Temperature's travel at
 * the bottom of its own dial and therefore outside its target: winding it all
 * the way up read as not tuned. Both are plain ranges on the sweep.
 */
function degreeDistance(first, second) {
  return Math.abs(first - second)
}

function angleIsInsideArc(angle, { startDeg, endDeg }) {
  return angle >= startDeg && angle <= endDeg
}

function smoothstep01(value) {
  const normalizedValue = clampUnit(value)
  return normalizedValue * normalizedValue * (3 - (2 * normalizedValue))
}

export function getProtectionParameterQuality(parameterId, value) {
  const parameterConfig = PROTECTION_PARAMETERS[parameterId]
  if (!parameterConfig) return 0

  const angle = clampUnit(value) * 360
  const { targetArc } = parameterConfig
  if (angleIsInsideArc(angle, targetArc)) return 1

  const distanceFromArc = Math.min(
    degreeDistance(angle, targetArc.startDeg),
    degreeDistance(angle, targetArc.endDeg)
  )
  if (distanceFromArc >= targetArc.featherDeg) return 0
  return smoothstep01(1 - (distanceFromArc / targetArc.featherDeg))
}

export function isProtectionParameterTuned(parameterId, value) {
  return getProtectionParameterQuality(parameterId, value) === 1
}

export function getProtectionParameterStatus(parameterId, value) {
  const parameterConfig = PROTECTION_PARAMETERS[parameterId]
  if (!parameterConfig) return 'outside'
  if (isProtectionParameterTuned(parameterId, value)) return 'tuned'
  const angle = clampUnit(value) * 360
  return angle < parameterConfig.targetArc.startDeg ? 'below' : 'above'
}

function targetCenterTurn(parameterId) {
  const { startDeg, endDeg } = PROTECTION_PARAMETERS[parameterId].targetArc
  return ((startDeg + endDeg) / 2) / 360
}

function targetStartTurn(parameterId) {
  return PROTECTION_PARAMETERS[parameterId].targetArc.startDeg / 360
}

function targetEndTurn(parameterId) {
  return PROTECTION_PARAMETERS[parameterId].targetArc.endDeg / 360
}

export function getProtectionEffectDrives(stateOrValues = {}) {
  const values = stateOrValues?.values || stateOrValues
  const temperature = clampUnit(values.temperature)
  const voltage = clampUnit(values.voltage)
  const magnetic = clampUnit(values.magnetic)
  const temperatureTargetStart = targetStartTurn('temperature')
  const voltageTargetCenter = targetCenterTurn('voltage')
  const magneticTargetCenter = targetCenterTurn('magnetic')
  const voltageTargetStart = targetStartTurn('voltage')
  const voltageTargetEnd = targetEndTurn('voltage')
  const magneticTargetStart = targetStartTurn('magnetic')

  return {
    // The temperature dial represents cooling power. Reach the calm particle
    // state as the knob enters its target instead of requiring a full turn.
    temperature: smoothstep01(temperature / temperatureTargetStart),
    voltage: smoothstep01(voltage / voltageTargetStart),
    // Crossing the upper target boundary is a fault state, not another
    // analogue effect: any over-voltage fully clears the energized corridors.
    voltageOverdrive: Number(voltage > voltageTargetEnd),
    voltageVisual: Math.pow(voltage / voltageTargetCenter, 1.4),
    magnetic: smoothstep01(magnetic / magneticTargetStart),
    magneticVisual: Math.pow(magnetic / magneticTargetCenter, 1.5)
  }
}

export function getProtectionBackgroundDrives(stateOrValues = {}) {
  const values = stateOrValues?.values || stateOrValues
  const temperature = clampUnit(values.temperature)

  // Reach the cold blue gradient as Temperature enters its green target zone.
  return {
    cooling: smoothstep01(temperature / targetStartTurn('temperature'))
  }
}

export function createProtectingInformationState() {
  return {
    focusedParameter: 'temperature',
    values: Object.fromEntries(
      PROTECTION_PARAMETER_IDS.map(parameterId => [
        parameterId,
        PROTECTION_PARAMETERS[parameterId].initialTurn
      ])
    ),
    completed: false,
    hasEverCompleted: false,
    hasInteracted: false
  }
}

export function getProtectionQualities(state) {
  const qualities = Object.fromEntries(
    PROTECTION_PARAMETER_IDS.map(parameterId => [
      parameterId,
      getProtectionParameterQuality(parameterId, state?.values?.[parameterId])
    ])
  )
  return {
    ...qualities,
    complete: PROTECTION_PARAMETER_IDS.every(parameterId => qualities[parameterId] === 1)
  }
}

export function getProtectionProgress(state) {
  const qualities = getProtectionQualities(state)
  const tuned = Object.fromEntries(
    PROTECTION_PARAMETER_IDS.map(parameterId => [parameterId, qualities[parameterId] === 1])
  )
  const tunedCount = Object.values(tuned).filter(Boolean).length
  return {
    tuned,
    tunedCount,
    complete: qualities.complete,
    qualities
  }
}

export function updateProtectionParameter(state, parameterId, value) {
  if (!PROTECTION_PARAMETERS[parameterId]) return state
  const nextState = {
    ...state,
    focusedParameter: parameterId,
    values: {
      ...state.values,
      [parameterId]: clampUnit(value)
    },
    hasInteracted: true
  }
  const complete = getProtectionQualities(nextState).complete
  nextState.completed = complete
  nextState.hasEverCompleted = Boolean(state.hasEverCompleted || complete)
  return nextState
}

export function focusProtectionParameter(state, parameterId) {
  if (!PROTECTION_PARAMETERS[parameterId] || state.focusedParameter === parameterId) return state
  return {
    ...state,
    focusedParameter: parameterId
  }
}

export function getProtectionContent(state) {
  if (getProtectionQualities(state).complete) return PROTECTION_SUCCESS_COPY
  if (!state?.hasInteracted) return PROTECTION_INTRO_COPY
  const parameterConfig = PROTECTION_PARAMETERS[state.focusedParameter] || PROTECTION_PARAMETERS.temperature
  return {
    title: parameterConfig.title,
    description: parameterConfig.description,
    prompt: parameterConfig.prompt
  }
}

export function valueFromDialPoint(point, bounds) {
  if (!point || !bounds || bounds.width <= 0 || bounds.height <= 0) return 0
  const centerX = bounds.left + (bounds.width / 2)
  const centerY = bounds.top + (bounds.height / 2)
  const clockwiseDegreesFromTwelve = Math.atan2(
    point.x - centerX,
    centerY - point.y
  ) * 180 / Math.PI
  return normalizeDegrees(clockwiseDegreesFromTwelve) / 360
}

export function dialAngleFromValue(value) {
  return clampUnit(value) * 360
}
