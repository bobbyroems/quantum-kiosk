export const QUBIT_SHELL_FUSION = Object.freeze({
  unifiedFadeStart: 0.88,
  unifiedFadeEnd: 0.97,
  splitFadeStart: 0.97,
  splitFadeEnd: 1
})

function clampProgress(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
}

function smoothstepRange(start, end, value) {
  const progress = clampProgress((value - start) / (end - start))
  return progress * progress * (3 - (2 * progress))
}

/**
 * Resolves the reversible visual handoff from two shells to one solid shell.
 * Passing a result object lets the render loop reuse storage without creating
 * a new object every frame.
 */
export function resolveQubitShellTransition(progress, result = {}) {
  const normalizedProgress = clampProgress(progress)
  const unifiedShellWeight = smoothstepRange(
    QUBIT_SHELL_FUSION.unifiedFadeStart,
    QUBIT_SHELL_FUSION.unifiedFadeEnd,
    normalizedProgress
  )
  const splitShellWeight = 1 - smoothstepRange(
    QUBIT_SHELL_FUSION.splitFadeStart,
    QUBIT_SHELL_FUSION.splitFadeEnd,
    normalizedProgress
  )

  result.progress = normalizedProgress
  result.splitShellWeight = splitShellWeight
  result.unifiedShellWeight = unifiedShellWeight
  return result
}
