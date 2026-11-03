export const QUBIT_MATERIAL_ENTRANCE = Object.freeze({
  durationSeconds: 1.35,
  maxFrameDeltaSeconds: 0.05
})

function clampProgress(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
}

export function advanceQubitMaterialEntrance(
  progress,
  deltaSeconds,
  reducedMotion = false
) {
  if (reducedMotion) return 1
  const boundedDelta = Number.isFinite(deltaSeconds)
    ? Math.min(
        QUBIT_MATERIAL_ENTRANCE.maxFrameDeltaSeconds,
        Math.max(0, deltaSeconds)
      )
    : 0
  const nextProgress = clampProgress(
    clampProgress(progress) +
    (boundedDelta / QUBIT_MATERIAL_ENTRANCE.durationSeconds)
  )
  return nextProgress >= 1 - 1e-9 ? 1 : nextProgress
}

export function easeQubitMaterialEntrance(progress) {
  const normalizedProgress = clampProgress(progress)
  return 1 - Math.pow(1 - normalizedProgress, 3)
}

export function qubitMaterialEntranceOffset(progress, direction = 1) {
  const normalizedDirection = direction < 0 ? -1 : 1
  return normalizedDirection * (1 - easeQubitMaterialEntrance(progress))
}
