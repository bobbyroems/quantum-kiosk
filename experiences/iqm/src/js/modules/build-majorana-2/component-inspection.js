export const COMPONENT_INSPECTION_DRAG_RANGE_DEGREES = 150
export const COMPONENT_INSPECTION_MAX_YAW_DEGREES = 65
export const COMPONENT_INSPECTION_MAX_PITCH_DEGREES = 35
const COMPONENT_INSPECTION_PITCH_SENSITIVITY = 0.72
const COMPONENT_INSPECTION_FALLBACK_WIDTH = 900

export function componentRotationFromDrag(deltaX, deltaY, componentWidth) {
  const safeDeltaX = Number.isFinite(deltaX) ? deltaX : 0
  const safeDeltaY = Number.isFinite(deltaY) ? deltaY : 0
  const safeWidth = Number.isFinite(componentWidth) && componentWidth > 0
    ? componentWidth
    : COMPONENT_INSPECTION_FALLBACK_WIDTH
  const yawDegreesPerPixel = COMPONENT_INSPECTION_DRAG_RANGE_DEGREES / safeWidth
  const rotateX = Math.max(
    -COMPONENT_INSPECTION_MAX_PITCH_DEGREES,
    Math.min(
      COMPONENT_INSPECTION_MAX_PITCH_DEGREES,
      -safeDeltaY * yawDegreesPerPixel * COMPONENT_INSPECTION_PITCH_SENSITIVITY
    )
  )

  return {
    rotateX: rotateX || 0,
    rotateY: Math.max(
      -COMPONENT_INSPECTION_MAX_YAW_DEGREES,
      Math.min(
        COMPONENT_INSPECTION_MAX_YAW_DEGREES,
        safeDeltaX * yawDegreesPerPixel
      )
    )
  }
}

export function shortestAngleDelta(current, target) {
  return Math.atan2(
    Math.sin(target - current),
    Math.cos(target - current)
  )
}

export function dampAngle(current, target, amount) {
  const safeAmount = Math.max(0, Math.min(1, amount))
  return current + shortestAngleDelta(current, target) * safeAmount
}
