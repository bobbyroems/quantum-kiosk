export const MODULE_NAVIGATION_PROJECTION = Object.freeze({
  distance: 10,
  far: 40,
  fovDegrees: 32,
  height: 1.7,
  lookAtY: -0.25,
  near: 0.1
})

export const MODULE_NAVIGATION_GRID = Object.freeze({
  color: '#b4bac3',
  exposure: 1.18,
  fadeInnerRatio: 0.3,
  fadeRadiusByFrustumWidth: 0.34,
  heightRatio: 0.15,
  opacity: 0.4,
  referenceRadius: 1.14,
  referenceScalePercent: 36,
  sideByFrustumWidth: 2.4,
  sideRatio: 0.83,
  spacingByReferenceScale: 0.55,
  thicknessRatio: 0.002
})

export function getModuleNavigationGridLayout({
  aspect = 1,
  ground = MODULE_NAVIGATION_GRID
} = {}) {
  const projection = MODULE_NAVIGATION_PROJECTION
  const safeAspect = Math.max(0.001, Number(aspect) || 1)
  const halfViewAngle = (projection.fovDegrees * Math.PI) / 360
  const frustumHeight = 2 * projection.distance * Math.tan(halfViewAngle)
  const frustumWidth = frustumHeight * safeAspect
  const requestedGroundSide = frustumHeight * ground.sideRatio
  const pitch = Math.atan(
    (projection.height - projection.lookAtY) / projection.distance
  )
  const halfDiagonalMax =
    (projection.distance * (frustumWidth / 2)) /
    (projection.distance + (frustumWidth / 2))
  const groundSide = Math.min(
    requestedGroundSide,
    halfDiagonalMax / Math.SQRT1_2
  )
  const nearDistance = projection.distance - (groundSide * Math.SQRT1_2)
  const lowestGroundY =
    projection.height -
    (nearDistance * Math.tan(pitch + halfViewAngle)) +
    0.08
  const groundY = Math.max(
    -frustumHeight * ground.heightRatio,
    lowestGroundY
  )
  const groundThickness = Math.max(
    0.001,
    frustumHeight * ground.thicknessRatio
  )
  const referenceScale =
    ((MODULE_NAVIGATION_GRID.referenceScalePercent / 100) * frustumWidth) /
    2 /
    MODULE_NAVIGATION_GRID.referenceRadius
  const groundDrop = 0.35 * referenceScale

  return Object.freeze({
    fadeInnerRatio: MODULE_NAVIGATION_GRID.fadeInnerRatio,
    fadeRadius:
      frustumWidth * MODULE_NAVIGATION_GRID.fadeRadiusByFrustumWidth,
    frustumHeight,
    frustumWidth,
    gridY: groundY - groundThickness - groundDrop,
    groundDrop,
    groundSide,
    groundThickness,
    groundY,
    opacity: MODULE_NAVIGATION_GRID.opacity,
    side: frustumWidth * MODULE_NAVIGATION_GRID.sideByFrustumWidth,
    spacing:
      MODULE_NAVIGATION_GRID.spacingByReferenceScale * referenceScale
  })
}
