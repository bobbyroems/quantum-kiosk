export const IDLE_TIMEOUT_LIMITS = Object.freeze({
  minMs: 10000,
  maxMs: 600000,
  stepMs: 10000
})

const STORAGE_KEYS = Object.freeze({
  returnToMenuMs: 'kiosk-idle-return-to-menu-ms',
  returnToHomeMs: 'kiosk-idle-return-to-home-ms'
})

let configuredDefaults = {
  returnToMenuMs: IDLE_TIMEOUT_LIMITS.minMs,
  returnToHomeMs: IDLE_TIMEOUT_LIMITS.minMs
}
let sessionValues = {
  returnToMenuMs: null,
  returnToHomeMs: null
}

function clampTimeout(ms) {
  return Math.min(IDLE_TIMEOUT_LIMITS.maxMs, Math.max(IDLE_TIMEOUT_LIMITS.minMs, ms))
}

function configuredTimeout(ms) {
  const value = Number(ms)
  return Number.isFinite(value) ? clampTimeout(value) : IDLE_TIMEOUT_LIMITS.minMs
}

function readStoredTimeout(key, fallback) {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS[key])
    if (raw === null || raw === '') return fallback
    const value = Number(raw)
    if (
      Number.isFinite(value) &&
      value >= IDLE_TIMEOUT_LIMITS.minMs &&
      value <= IDLE_TIMEOUT_LIMITS.maxMs
    ) return value
  } catch {
    /* Storage unavailable — keep the configured default. */
  }
  return fallback
}

export function configureIdleTimeouts({ returnToMenuMs, returnToHomeMs }) {
  configuredDefaults = {
    returnToMenuMs: configuredTimeout(returnToMenuMs),
    returnToHomeMs: configuredTimeout(returnToHomeMs)
  }
  sessionValues = { returnToMenuMs: null, returnToHomeMs: null }
}

export function getIdleTimeouts() {
  return {
    returnToMenuMs: sessionValues.returnToMenuMs ??
      readStoredTimeout('returnToMenuMs', configuredDefaults.returnToMenuMs),
    returnToHomeMs: sessionValues.returnToHomeMs ??
      readStoredTimeout('returnToHomeMs', configuredDefaults.returnToHomeMs)
  }
}

export function setIdleTimeout(key, ms) {
  if (!Object.hasOwn(STORAGE_KEYS, key)) return null
  const value = Number(ms)
  if (!Number.isFinite(value)) return null
  const timeoutMs = clampTimeout(value)
  sessionValues[key] = timeoutMs
  try {
    window.localStorage.setItem(STORAGE_KEYS[key], String(timeoutMs))
  } catch {
    /* Storage unavailable — the selected value still applies for this session. */
  }
  return timeoutMs
}

export function formatIdleTimeout(ms) {
  const totalSeconds = Math.max(0, Math.round(Number(ms) / 1000) || 0)
  if (totalSeconds < 60) return `${totalSeconds} s`

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`
}
