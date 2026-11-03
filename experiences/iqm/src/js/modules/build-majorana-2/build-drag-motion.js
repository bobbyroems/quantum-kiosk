export const BUILD_DRAG_MAX_PITCH_DEGREES = 10
export const BUILD_DRAG_MAX_YAW_DEGREES = 12
export const BUILD_DRAG_VELOCITY_AT_MAX = 1.25

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function buildDragOffset(startX, startY, currentX, currentY, stageScale = 1) {
  const safeScale = Math.max(0.0001, Math.abs(finiteNumber(stageScale, 1)))
  return {
    x: (finiteNumber(currentX) - finiteNumber(startX)) / safeScale,
    y: (finiteNumber(currentY) - finiteNumber(startY)) / safeScale
  }
}

export function buildDragTiltFromVelocity(deltaX, deltaY, deltaMs) {
  const safeDeltaMs = finiteNumber(deltaMs)
  if (safeDeltaMs <= 0) return { rotateX: 0, rotateY: 0 }

  const velocityX = finiteNumber(deltaX) / safeDeltaMs
  const velocityY = finiteNumber(deltaY) / safeDeltaMs

  return {
    rotateX: clamp(
      (-velocityY / BUILD_DRAG_VELOCITY_AT_MAX) * BUILD_DRAG_MAX_PITCH_DEGREES,
      -BUILD_DRAG_MAX_PITCH_DEGREES,
      BUILD_DRAG_MAX_PITCH_DEGREES
    ),
    rotateY: clamp(
      (velocityX / BUILD_DRAG_VELOCITY_AT_MAX) * BUILD_DRAG_MAX_YAW_DEGREES,
      -BUILD_DRAG_MAX_YAW_DEGREES,
      BUILD_DRAG_MAX_YAW_DEGREES
    )
  }
}

export function blendBuildDragTilt(current, target, amount = 0.34) {
  const weight = clamp(finiteNumber(amount, 0.34), 0, 1)
  const currentX = finiteNumber(current?.rotateX)
  const currentY = finiteNumber(current?.rotateY)
  const targetX = finiteNumber(target?.rotateX)
  const targetY = finiteNumber(target?.rotateY)

  return {
    rotateX: currentX + ((targetX - currentX) * weight),
    rotateY: currentY + ((targetY - currentY) * weight)
  }
}

export function pointInsideRect(x, y, rect) {
  if (!rect) return false
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

export function centeredBuildSnap({
  baseVisualRect,
  slotRect,
  stageScale = 1,
  visualWidth,
  visualHeight
}) {
  const safeScale = Math.max(0.0001, Math.abs(finiteNumber(stageScale, 1)))
  const baseWidth = Math.max(0.0001, finiteNumber(visualWidth, baseVisualRect?.width || 1))
  const baseHeight = Math.max(0.0001, finiteNumber(visualHeight, baseVisualRect?.height || 1))
  const baseCenterX = (finiteNumber(baseVisualRect?.left) + finiteNumber(baseVisualRect?.right)) / 2
  const baseCenterY = (finiteNumber(baseVisualRect?.top) + finiteNumber(baseVisualRect?.bottom)) / 2
  const slotCenterX = (finiteNumber(slotRect?.left) + finiteNumber(slotRect?.right)) / 2
  const slotCenterY = (finiteNumber(slotRect?.top) + finiteNumber(slotRect?.bottom)) / 2
  const logicalSlotWidth = Math.max(0.0001, finiteNumber(slotRect?.width, 1) / safeScale)
  const logicalSlotHeight = Math.max(0.0001, finiteNumber(slotRect?.height, 1) / safeScale)

  return {
    x: (slotCenterX - baseCenterX) / safeScale,
    y: (slotCenterY - baseCenterY) / safeScale,
    scale: Math.min(logicalSlotWidth / baseWidth, logicalSlotHeight / baseHeight)
  }
}
