export const SECTION_TRANSITION_KINDS = Object.freeze({
  COMPONENTS_PATHWAYS: 'components-pathways',
  PATHWAYS_BUILD: 'pathways-build'
})

export const SECTION_TRANSITION_TIMINGS = Object.freeze({
  [SECTION_TRANSITION_KINDS.COMPONENTS_PATHWAYS]: Object.freeze({
    durationMs: 1_300,
    switchDelayMs: 260
  }),
  [SECTION_TRANSITION_KINDS.PATHWAYS_BUILD]: Object.freeze({
    durationMs: 1_000,
    switchDelayMs: 180
  })
})

export function getSectionTransitionKind(fromView, toView) {
  if (fromView === 'components' && toView === 'pathways') {
    return SECTION_TRANSITION_KINDS.COMPONENTS_PATHWAYS
  }
  if (fromView === 'pathways' && toView === 'build') {
    return SECTION_TRANSITION_KINDS.PATHWAYS_BUILD
  }
  return null
}

function validRect(rect) {
  return Boolean(
    rect &&
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  )
}

export function transformBetweenRects(sourceRect, targetRect, stageScale = 1) {
  if (
    !validRect(sourceRect) ||
    !validRect(targetRect) ||
    !Number.isFinite(stageScale) ||
    stageScale <= 0
  ) return null

  return {
    translateX: (targetRect.left - sourceRect.left) / stageScale,
    translateY: (targetRect.top - sourceRect.top) / stageScale,
    scaleX: targetRect.width / sourceRect.width,
    scaleY: targetRect.height / sourceRect.height
  }
}

export function rectInStage(rect, stageRect, stageScale = 1) {
  if (
    !validRect(rect) ||
    !validRect(stageRect) ||
    !Number.isFinite(stageScale) ||
    stageScale <= 0
  ) return null

  return {
    left: (rect.left - stageRect.left) / stageScale,
    top: (rect.top - stageRect.top) / stageScale,
    width: rect.width / stageScale,
    height: rect.height / stageScale
  }
}
