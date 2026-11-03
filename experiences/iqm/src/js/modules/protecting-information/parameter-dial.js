import {
  clampUnit,
  dialAngleFromValue,
  getProtectionParameterStatus,
  isProtectionParameterTuned,
  PROTECTION_PARAMETERS,
  valueFromDialPoint
} from './protecting-information-state.js'

const KEY_STEP = 0.025

export function accumulateDialTurn(value, previousAngle, nextAngle) {
  let delta = nextAngle - previousAngle
  if (delta > 180) delta -= 360
  else if (delta < -180) delta += 360
  return clampUnit(value + (delta / 360))
}

export function getDialAriaValueText(parameterId, value) {
  const parameter = PROTECTION_PARAMETERS[parameterId]
  const normalizedValue = clampUnit(value)
  const angle = Math.round(normalizedValue * 360)
  const percentage = Math.round(normalizedValue * 100)
  const rangeStatus = getProtectionParameterStatus(parameterId, normalizedValue)
  const status = rangeStatus === 'tuned' ? 'tuned' : `${rangeStatus} target`
  return `${parameter?.label || 'Parameter'}: ${percentage} percent, ${angle} degrees, ${status}`
}

function setAriaValue(element, parameterId, value) {
  element.setAttribute('aria-valuenow', String(Math.round(value * 100)))
  element.setAttribute('aria-valuetext', getDialAriaValueText(parameterId, value))
}

export function bindProtectionDial(element, {
  parameterId,
  signal,
  onFocus,
  onInput,
  onCommit
}) {
  const parameter = PROTECTION_PARAMETERS[parameterId]
  if (!element || !parameter) throw new TypeError('A valid dial element and parameter are required')

  let value = parameter.initialTurn
  let tuned = isProtectionParameterTuned(parameterId, value)
  let pointerId = null
  let previousPointerAngle = Number.NaN
  let moved = false

  element.style.setProperty('--pqi-target-start', `${parameter.targetArc.startDeg}deg`)
  element.style.setProperty('--pqi-target-end', `${parameter.targetArc.endDeg}deg`)

  const setValue = nextValue => {
    const normalizedValue = clampUnit(nextValue)
    const nextAngle = dialAngleFromValue(normalizedValue)
    value = normalizedValue
    tuned = isProtectionParameterTuned(parameterId, value)
    element.style.setProperty('--pqi-dial-angle', `${nextAngle}deg`)
    element.dataset.rangeStatus = getProtectionParameterStatus(parameterId, value)
    setAriaValue(element, parameterId, value)
  }

  const pointerAngle = event => {
    const bounds = element.getBoundingClientRect()
    return valueFromDialPoint({ x: event.clientX, y: event.clientY }, bounds) * 360
  }

  const updateFromPointer = event => {
    const nextPointerAngle = pointerAngle(event)
    // Accumulate travel instead of mapping the pointer directly to the dial.
    // At the 12:00 minimum, touching the 10–12 sector counter-clockwise must
    // stay at zero; the visitor reaches that sector only by circling clockwise.
    const nextValue = accumulateDialTurn(value, previousPointerAngle, nextPointerAngle)
    previousPointerAngle = nextPointerAngle
    if (Math.abs(nextValue - value) < 0.00001) return
    moved = true
    setValue(nextValue)
    onInput?.(parameterId, nextValue)
  }

  element.addEventListener('pointerdown', event => {
    if (event.button > 0) return
    event.preventDefault()
    pointerId = event.pointerId
    previousPointerAngle = pointerAngle(event)
    moved = false
    element.setPointerCapture?.(pointerId)
    element.classList.add('is-dragging')
    onFocus?.(parameterId)
  }, { signal })

  element.addEventListener('pointermove', event => {
    if (pointerId !== event.pointerId) return
    event.preventDefault()
    updateFromPointer(event)
  }, { signal })

  const finishPointer = event => {
    if (pointerId !== event.pointerId) return
    if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId)
    pointerId = null
    previousPointerAngle = Number.NaN
    element.classList.remove('is-dragging')
    onCommit?.(parameterId, value, moved)
  }

  element.addEventListener('pointerup', finishPointer, { signal })
  element.addEventListener('pointercancel', finishPointer, { signal })
  element.addEventListener('focus', () => onFocus?.(parameterId), { signal })
  element.addEventListener('keydown', event => {
    let nextValue = value
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nextValue -= KEY_STEP
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nextValue += KEY_STEP
    else if (event.key === 'Home') nextValue = 0
    else if (event.key === 'End') nextValue = 1
    else return

    event.preventDefault()
    setValue(nextValue)
    onInput?.(parameterId, value)
    onCommit?.(parameterId, value, true)
  }, { signal })

  setValue(value)

  return {
    setValue,
    setTuned(nextTuned) {
      tuned = Boolean(nextTuned)
      element.classList.toggle('is-tuned', tuned)
      element.dataset.tuned = String(tuned)
      setAriaValue(element, parameterId, value)
    }
  }
}
