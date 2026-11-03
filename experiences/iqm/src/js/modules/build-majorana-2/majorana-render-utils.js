export {
  calculateCssScale,
  calculateDrawingBufferSize,
  calculateStageAwarePixelRatio
} from '../../core/three-render-budget.js'

export const MAJORANA_NAVIGATION_DISTANCE_SCALE = 1.5
export const MAJORANA_NAVIGATION_TARGET_OFFSET_RATIO = 0.16

export function shouldAnimateNavigationPreview({
  isNavigationPreview = false,
  isIntro = false,
  reducedMotion = false
} = {}) {
  return Boolean(isNavigationPreview && isIntro && !reducedMotion)
}

export const MAJORANA_NAVIGATION_SWAY = Object.freeze({
  damping: 2 * Math.sqrt(60) * 0.42,
  deadbandPx: 0.5,
  maxDrive: 3,
  response: 0.72,
  rollScale: 0.4,
  stiffness: 60,
  translationScale: 0.08
})

/**
 * Mirrors the carousel diorama spring: horizontal card velocity pushes the
 * model sideways, then an under-damped spring gives it one short settling
 * sway. The state is mutated so render loops do not allocate every frame.
 */
export function stepMajoranaNavigationSway(state, {
  centerX,
  deltaSeconds,
  reducedMotion = false,
  width
} = {}) {
  const safeCenterX = Number.isFinite(centerX) ? centerX : state.previousCenterX
  const safeWidth = Math.max(1, Number(width) || 1)
  const safeDelta = Number.isFinite(deltaSeconds) && deltaSeconds > 0
    ? Math.min(deltaSeconds, 0.066)
    : 0.033

  if (reducedMotion) {
    state.offset = 0
    state.velocity = 0
    state.previousCenterX = safeCenterX
    return state
  }

  let slideVelocity = 0
  if (
    Number.isFinite(state.previousCenterX) &&
    Number.isFinite(safeCenterX) &&
    deltaSeconds > 0 &&
    deltaSeconds < 0.2
  ) {
    const deltaX = safeCenterX - state.previousCenterX
    if (Math.abs(deltaX) > MAJORANA_NAVIGATION_SWAY.deadbandPx) {
      slideVelocity = deltaX / safeWidth / deltaSeconds
    }
  }
  state.previousCenterX = safeCenterX

  const drive = Math.max(
    -MAJORANA_NAVIGATION_SWAY.maxDrive,
    Math.min(MAJORANA_NAVIGATION_SWAY.maxDrive, slideVelocity)
  )
  const target = -drive * 0.3 * MAJORANA_NAVIGATION_SWAY.response
  const acceleration =
    -MAJORANA_NAVIGATION_SWAY.stiffness * (state.offset - target) -
    MAJORANA_NAVIGATION_SWAY.damping * state.velocity
  state.velocity += acceleration * safeDelta
  state.offset += state.velocity * safeDelta
  return state
}

export function shouldContinueRendering({
  isVisible = true,
  introIsAnimating = false,
  cameraIsTransitioning = false,
  controlsAreActive = false,
  mainIsReturning = false,
  mainTransformsAreMoving = false,
  componentAnimationIsActive = false
} = {}) {
  return Boolean(
    isVisible && (
      introIsAnimating ||
      cameraIsTransitioning ||
      controlsAreActive ||
      mainIsReturning ||
      mainTransformsAreMoving ||
      componentAnimationIsActive
    )
  )
}
