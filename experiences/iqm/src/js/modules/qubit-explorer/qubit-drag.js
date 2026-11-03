const ASSEMBLY_DISTANCE_SCALE = 4

/* The ready-state prompt borrows the real assembly path, but only travels a
   small fraction of it so the two layers suggest the gesture without looking
   as if they are completing the interaction themselves. */
export const ASSEMBLY_IDLE_PULL_MAX_PROGRESS = 0.24
export const ASSEMBLY_IDLE_PULL_CYCLE_SECONDS = 4.4

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function smoothstep(value) {
  const t = clamp(value, 0, 1)
  return t * t * (3 - (2 * t))
}

export function assemblyProgressFromPoint(origin, target, point) {
  const travelX = Number(target?.x) - Number(origin?.x)
  const travelY = Number(target?.y) - Number(origin?.y)
  const travelZ = Number(target?.z) - Number(origin?.z)
  const pointX = Number(point?.x) - Number(origin?.x)
  const pointY = Number(point?.y) - Number(origin?.y)
  const pointZ = Number(point?.z) - Number(origin?.z)
  const travelLengthSquared =
    (travelX * travelX) + (travelY * travelY) + (travelZ * travelZ)

  if (
    !Number.isFinite(travelLengthSquared) ||
    travelLengthSquared <= 0 ||
    ![pointX, pointY, pointZ].every(Number.isFinite)
  ) return 0

  const projected =
    ((pointX * travelX) + (pointY * travelY) + (pointZ * travelZ)) /
    travelLengthSquared
  return clamp(projected, 0, 1)
}

export function assemblyDistanceFromProgress(progress) {
  const numericProgress = Number(progress)
  if (!Number.isFinite(numericProgress)) return ASSEMBLY_DISTANCE_SCALE
  return (1 - clamp(numericProgress, 0, 1)) * ASSEMBLY_DISTANCE_SCALE
}

/**
 * A seamless pinch rhythm for the untouched ready state: rest, squeeze, hold,
 * release, rest. Keeping this in progress space means the prompt follows the
 * exact same three-dimensional path as the visitor's drag.
 */
export function assemblyIdlePullProgress(elapsedSeconds, strength = 1) {
  const numericSeconds = Number(elapsedSeconds)
  const numericStrength = Number(strength)
  if (!Number.isFinite(numericSeconds) || !Number.isFinite(numericStrength)) return 0

  const cycle = ASSEMBLY_IDLE_PULL_CYCLE_SECONDS
  const wrappedSeconds = ((numericSeconds % cycle) + cycle) % cycle
  const phase = wrappedSeconds / cycle
  let pinch = 0
  if (phase >= 0.12 && phase < 0.42) {
    pinch = smoothstep((phase - 0.12) / 0.3)
  } else if (phase >= 0.42 && phase < 0.58) {
    pinch = 1
  } else if (phase >= 0.58 && phase < 0.88) {
    pinch = 1 - smoothstep((phase - 0.58) / 0.3)
  }
  return ASSEMBLY_IDLE_PULL_MAX_PROGRESS * pinch * clamp(numericStrength, 0, 1)
}

/*
 * How far along the join the layers stop tracking the pointer one-for-one and
 * start being drawn the rest of the way themselves.
 */
export const ASSEMBLY_SNAP_PROGRESS = 0.55

/**
 * Magnetism for the last stretch of the assembly. Below the snap point the drag
 * is literal; above it the pair closes faster than the finger moves, easing out
 * so the pull strengthens the nearer they get. That acceleration is what reads
 * as a snap rather than as the layers simply arriving.
 */
export function applyAssemblySnap(progress, snapStart = ASSEMBLY_SNAP_PROGRESS) {
  const numericProgress = Number(progress)
  if (!Number.isFinite(numericProgress)) return 0
  const clamped = clamp(numericProgress, 0, 1)
  const start = clamp(Number(snapStart), 0, 0.999)
  if (clamped <= start) return clamped

  const localProgress = (clamped - start) / (1 - start)
  const pulled = 1 - ((1 - localProgress) ** 2)
  return start + ((1 - start) * pulled)
}
