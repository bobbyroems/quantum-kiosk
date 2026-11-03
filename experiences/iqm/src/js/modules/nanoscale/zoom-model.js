export const NANOSCALE_STOPS = Object.freeze([0, 1, 2])
export const NANOSCALE_VISUAL_KEYFRAMES = Object.freeze([0, 0.5, 1, 1.5, 2])

const EPSILON = 1e-9

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function assertAscendingNumbers(values, label, minimumLength = 2) {
  if (!Array.isArray(values) || values.length < minimumLength) {
    throw new RangeError(`${label} must contain at least ${minimumLength} values`)
  }

  for (let index = 0; index < values.length; index += 1) {
    if (!isFiniteNumber(values[index])) {
      throw new TypeError(`${label} must contain only finite numbers`)
    }
    if (index > 0 && values[index] <= values[index - 1]) {
      throw new RangeError(`${label} must be strictly ascending`)
    }
  }
}

export function clamp(value, minimum = 0, maximum = 1) {
  if (!isFiniteNumber(minimum) || !isFiniteNumber(maximum) || minimum > maximum) {
    throw new RangeError('clamp bounds must be finite and ascending')
  }
  if (!isFiniteNumber(value)) return minimum
  return Math.min(maximum, Math.max(minimum, value))
}

export function segmentProgress(value, start, end) {
  if (!isFiniteNumber(value) || !isFiniteNumber(start) || !isFiniteNumber(end)) return 0
  if (Math.abs(end - start) <= EPSILON) return value >= end ? 1 : 0
  return clamp((value - start) / (end - start))
}

export function interpolateSegment(
  value,
  start,
  end,
  fromValue,
  toValue,
  easing = (progress) => progress
) {
  if (!isFiniteNumber(fromValue) || !isFiniteNumber(toValue)) {
    throw new TypeError('segment values must be finite numbers')
  }
  if (typeof easing !== 'function') throw new TypeError('easing must be a function')

  const localProgress = clamp(easing(segmentProgress(value, start, end)))
  return fromValue + ((toValue - fromValue) * localProgress)
}

export function getKeyframeSegment(
  progress,
  keyframes = NANOSCALE_VISUAL_KEYFRAMES
) {
  assertAscendingNumbers(keyframes, 'keyframes')

  const safeProgress = isFiniteNumber(progress) ? progress : keyframes[0]
  const lastIndex = keyframes.length - 1

  if (safeProgress <= keyframes[0]) {
    return {
      fromIndex: 0,
      toIndex: 0,
      from: keyframes[0],
      to: keyframes[0],
      localProgress: 0
    }
  }

  if (safeProgress >= keyframes[lastIndex]) {
    return {
      fromIndex: lastIndex,
      toIndex: lastIndex,
      from: keyframes[lastIndex],
      to: keyframes[lastIndex],
      localProgress: 1
    }
  }

  let fromIndex = 0
  while (safeProgress >= keyframes[fromIndex + 1]) fromIndex += 1

  const toIndex = fromIndex + 1
  return {
    fromIndex,
    toIndex,
    from: keyframes[fromIndex],
    to: keyframes[toIndex],
    localProgress: segmentProgress(
      safeProgress,
      keyframes[fromIndex],
      keyframes[toIndex]
    )
  }
}

export function interpolateKeyframes(
  progress,
  keyframes,
  values,
  easing = (localProgress) => localProgress
) {
  assertAscendingNumbers(keyframes, 'keyframes')
  if (!Array.isArray(values) || values.length !== keyframes.length) {
    throw new RangeError('values must match the keyframe count')
  }
  if (!values.every(isFiniteNumber)) {
    throw new TypeError('values must contain only finite numbers')
  }
  if (typeof easing !== 'function') throw new TypeError('easing must be a function')

  const segment = getKeyframeSegment(progress, keyframes)
  if (segment.fromIndex === segment.toIndex) return values[segment.fromIndex]

  const localProgress = clamp(easing(segment.localProgress))
  const fromValue = values[segment.fromIndex]
  return fromValue + ((values[segment.toIndex] - fromValue) * localProgress)
}

/**
 * Converts client-space vertical travel to timeline progress.
 * Moving upward zooms in (positive progress); moving downward zooms out.
 */
export function dragDeltaToProgress(
  clientDeltaY,
  stageScale = 1,
  designPixelsPerStop = 720
) {
  if (
    !isFiniteNumber(clientDeltaY) ||
    !isFiniteNumber(stageScale) ||
    stageScale <= 0 ||
    !isFiniteNumber(designPixelsPerStop) ||
    designPixelsPerStop <= 0
  ) return 0

  const designDeltaY = clientDeltaY / stageScale
  return -designDeltaY / designPixelsPerStop
}

/** Rightward one-finger travel advances the scale; leftward travel retreats. */
export function horizontalDragDeltaToProgress(
  clientDeltaX,
  stageScale = 1,
  designPixelsPerStop = 720
) {
  return dragDeltaToProgress(-clientDeltaX, stageScale, designPixelsPerStop)
}

/**
 * Locks a one-finger gesture to its dominant axis after a small dead zone.
 * Keeping the axis stable prevents a diagonal swipe from changing direction
 * midway through the camera move.
 */
export function dominantDragAxis(
  clientDeltaX,
  clientDeltaY,
  activationDistance = 6
) {
  if (
    !isFiniteNumber(clientDeltaX) ||
    !isFiniteNumber(clientDeltaY) ||
    !isFiniteNumber(activationDistance) ||
    activationDistance < 0
  ) return null

  if (Math.max(Math.abs(clientDeltaX), Math.abs(clientDeltaY)) < activationDistance) {
    return null
  }
  return Math.abs(clientDeltaX) > Math.abs(clientDeltaY) ? 'horizontal' : 'vertical'
}

/**
 * Maps the dominant wheel/trackpad axis onto the journey's reading direction:
 * up and left advance; down and right retreat.
 */
export function wheelDeltaToProgressDirection(deltaX, deltaY) {
  if (!isFiniteNumber(deltaX) || !isFiniteNumber(deltaY)) return 0
  if (deltaX === 0 && deltaY === 0) return 0
  if (Math.abs(deltaX) > Math.abs(deltaY)) return Math.sign(deltaX) * -1
  return Math.sign(deltaY) * -1
}

/**
 * Pinch distance is logarithmic so deltas remain additive and independent of
 * viewport size. Doubling the finger distance advances one stop by default.
 */
export function pinchDeltaToProgress(
  startDistance,
  currentDistance,
  stopsPerDoubling = 1
) {
  if (
    !isFiniteNumber(startDistance) ||
    !isFiniteNumber(currentDistance) ||
    startDistance <= 0 ||
    currentDistance <= 0 ||
    !isFiniteNumber(stopsPerDoubling)
  ) return 0

  return Math.log2(currentDistance / startDistance) * stopsPerDoubling
}

export function nearestNanoscaleStop(
  progress,
  stops = NANOSCALE_STOPS
) {
  assertAscendingNumbers(stops, 'stops')
  const safeProgress = isFiniteNumber(progress) ? progress : stops[0]

  return stops.reduce((nearest, stop) => (
    Math.abs(stop - safeProgress) < Math.abs(nearest - safeProgress)
      ? stop
      : nearest
  ), stops[0])
}

export function getGestureProgressBounds(
  gestureStartProgress,
  stops = NANOSCALE_STOPS
) {
  assertAscendingNumbers(stops, 'stops')
  const anchor = nearestNanoscaleStop(gestureStartProgress, stops)
  const anchorIndex = stops.indexOf(anchor)

  return {
    anchor,
    minimum: stops[Math.max(0, anchorIndex - 1)],
    maximum: stops[Math.min(stops.length - 1, anchorIndex + 1)]
  }
}

export function constrainGestureProgress(
  proposedProgress,
  gestureStartProgress,
  stops = NANOSCALE_STOPS
) {
  const bounds = getGestureProgressBounds(gestureStartProgress, stops)
  return clamp(proposedProgress, bounds.minimum, bounds.maximum)
}

/**
 * How far past the first or last stop a gesture may stretch, in stops. Small on
 * purpose: it is a signal, not travel.
 */
export const NANOSCALE_EDGE_OVERSHOOT_STOPS = 0.06

/*
 * Reports whether a gesture is pushing against the end of the whole journey,
 * and how far it has stretched past it.
 *
 * Only the journey's two ends stretch. Capping a long drag at one stop is
 * deliberate and still snaps somewhere, so lending it the same elastic feel
 * would say "nothing this way" where a stop is in fact waiting. At the first
 * and last stop there genuinely is nothing, and a hard clamp there is silent:
 * the visitor drags and not one pixel moves.
 *
 * `progress` stays inside the gesture's bounds, so the camera is never asked to
 * render a position outside the journey. The stretch is reported separately for
 * the caller to express as a visual offset, which is what the platform
 * rubber-band does too — the content shifts while the scroll position stays
 * pinned to the boundary.
 */
export function resolveGestureProgress(
  proposedProgress,
  gestureStartProgress,
  stops = NANOSCALE_STOPS,
  overshootStops = NANOSCALE_EDGE_OVERSHOOT_STOPS
) {
  const bounds = getGestureProgressBounds(gestureStartProgress, stops)
  const progress = clamp(proposedProgress, bounds.minimum, bounds.maximum)
  const limit = isFiniteNumber(overshootStops) && overshootStops > 0
    ? overshootStops
    : 0
  const first = stops[0]
  const last = stops[stops.length - 1]

  if (!isFiniteNumber(proposedProgress) || limit === 0) {
    return { progress, edge: null, overshoot: 0 }
  }

  /* Asymptotic, so the stretch eases to `limit` however hard the drag pushes
     and never reaches a wall of its own. */
  const stretch = excess => (limit * excess) / (excess + limit)

  if (proposedProgress < first && bounds.minimum === first) {
    return { progress, edge: 'start', overshoot: stretch(first - proposedProgress) }
  }
  if (proposedProgress > last && bounds.maximum === last) {
    return { progress, edge: 'end', overshoot: stretch(proposedProgress - last) }
  }
  return { progress, edge: null, overshoot: 0 }
}

/**
 * Selects a semantic stopping point without ever skipping more than one stop
 * from the gesture's origin. A deliberate fling wins over positional snapping;
 * slow releases use a short inertial projection before choosing the nearest stop.
 */
export function getVelocityAwareSnapTarget(
  progress,
  velocity = 0,
  {
    gestureStartProgress = progress,
    stops = NANOSCALE_STOPS,
    flingVelocity = 0.55,
    projectionSeconds = 0.16
  } = {}
) {
  assertAscendingNumbers(stops, 'stops')
  const bounds = getGestureProgressBounds(gestureStartProgress, stops)
  const constrainedProgress = constrainGestureProgress(progress, gestureStartProgress, stops)
  const safeVelocity = isFiniteNumber(velocity) ? velocity : 0
  const safeThreshold = isFiniteNumber(flingVelocity) && flingVelocity >= 0
    ? flingVelocity
    : 0.55
  const safeProjection = isFiniteNumber(projectionSeconds) && projectionSeconds >= 0
    ? projectionSeconds
    : 0.16

  const candidates = stops.filter((stop) => (
    stop >= bounds.minimum && stop <= bounds.maximum
  ))

  if (Math.abs(safeVelocity) >= safeThreshold) {
    const anchorIndex = stops.indexOf(bounds.anchor)
    const targetIndex = safeVelocity > 0
      ? Math.min(stops.length - 1, anchorIndex + 1)
      : Math.max(0, anchorIndex - 1)
    return stops[targetIndex]
  }

  const projectedProgress = clamp(
    constrainedProgress + (safeVelocity * safeProjection),
    bounds.minimum,
    bounds.maximum
  )
  return nearestNanoscaleStop(projectedProgress, candidates)
}

/**
 * Samples a critically damped spring at an absolute elapsed time. Because this
 * is an analytical sample rather than a frame-by-frame integration, its result
 * is deterministic even when kiosk frames are dropped.
 */
export function sampleSettlingMotion({
  from,
  target,
  initialVelocity = 0,
  elapsedMs = 0,
  angularFrequency = 12,
  minimum = NANOSCALE_STOPS[0],
  maximum = NANOSCALE_STOPS[NANOSCALE_STOPS.length - 1],
  positionEpsilon = 0.001,
  velocityEpsilon = 0.01
}) {
  if (!isFiniteNumber(from) || !isFiniteNumber(target)) {
    throw new TypeError('settle endpoints must be finite numbers')
  }
  if (!isFiniteNumber(angularFrequency) || angularFrequency <= 0) {
    throw new RangeError('angularFrequency must be greater than zero')
  }

  const safeElapsedMs = isFiniteNumber(elapsedMs) ? Math.max(0, elapsedMs) : 0
  const safeVelocity = isFiniteNumber(initialVelocity) ? initialVelocity : 0
  const safePositionEpsilon = isFiniteNumber(positionEpsilon) && positionEpsilon >= 0
    ? positionEpsilon
    : 0.001
  const safeVelocityEpsilon = isFiniteNumber(velocityEpsilon) && velocityEpsilon >= 0
    ? velocityEpsilon
    : 0.01
  const initialProgress = clamp(from, minimum, maximum)
  const safeTarget = clamp(target, minimum, maximum)
  if (safeElapsedMs === 0) {
    const settled = (
      Math.abs(initialProgress - safeTarget) <= safePositionEpsilon &&
      Math.abs(safeVelocity) <= safeVelocityEpsilon
    )
    return settled
      ? { progress: safeTarget, velocity: 0, settled: true }
      : { progress: initialProgress, velocity: safeVelocity, settled: false }
  }

  const elapsedSeconds = safeElapsedMs / 1_000
  const displacement = initialProgress - safeTarget
  const coefficient = safeVelocity + (angularFrequency * displacement)
  const decay = Math.exp(-angularFrequency * elapsedSeconds)
  const rawProgress = safeTarget + (
    displacement + (coefficient * elapsedSeconds)
  ) * decay
  const rawVelocity = (
    coefficient -
    (angularFrequency * (displacement + (coefficient * elapsedSeconds)))
  ) * decay
  const progress = clamp(rawProgress, minimum, maximum)
  const settled = (
    Math.abs(progress - safeTarget) <= safePositionEpsilon &&
    Math.abs(rawVelocity) <= safeVelocityEpsilon
  )

  return settled
    ? { progress: safeTarget, velocity: 0, settled: true }
    : { progress, velocity: rawVelocity, settled: false }
}
