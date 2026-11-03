const DEFAULT_MAX_RENDER_PIXELS = 2_600_000
const DEFAULT_MIN_PIXEL_RATIO = 0.55
const DEFAULT_MAX_PIXEL_RATIO = 1.35

function positiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export function calculateCssScale({
  layoutWidth,
  layoutHeight,
  renderedWidth,
  renderedHeight
}) {
  const safeLayoutWidth = positiveNumber(layoutWidth, 1)
  const safeLayoutHeight = positiveNumber(layoutHeight, 1)
  const scaleX = positiveNumber(renderedWidth, safeLayoutWidth) / safeLayoutWidth
  const scaleY = positiveNumber(renderedHeight, safeLayoutHeight) / safeLayoutHeight
  return positiveNumber(Math.min(scaleX, scaleY), 1)
}

export function calculateStageAwarePixelRatio({
  width,
  height,
  cssScale = 1,
  devicePixelRatio = 1,
  maxRenderPixels = DEFAULT_MAX_RENDER_PIXELS,
  minPixelRatio = DEFAULT_MIN_PIXEL_RATIO,
  maxPixelRatio = DEFAULT_MAX_PIXEL_RATIO
}) {
  const safeWidth = positiveNumber(width, 1)
  const safeHeight = positiveNumber(height, 1)
  const safeScale = positiveNumber(cssScale, 1)
  const nativePixelRatio = Math.max(1, positiveNumber(devicePixelRatio, 1))
  const effectivePixelRatio = nativePixelRatio * safeScale
  const budgetPixelRatio = Math.sqrt(
    positiveNumber(maxRenderPixels, DEFAULT_MAX_RENDER_PIXELS) /
    Math.max(1, safeWidth * safeHeight)
  )

  return Math.max(
    positiveNumber(minPixelRatio, DEFAULT_MIN_PIXEL_RATIO),
    Math.min(
      effectivePixelRatio,
      budgetPixelRatio,
      positiveNumber(maxPixelRatio, DEFAULT_MAX_PIXEL_RATIO)
    )
  )
}

export function calculateDrawingBufferSize(width, height, pixelRatio) {
  const safeWidth = positiveNumber(width, 1)
  const safeHeight = positiveNumber(height, 1)
  const safePixelRatio = positiveNumber(pixelRatio, 1)

  return {
    width: Math.max(1, Math.floor(safeWidth * safePixelRatio)),
    height: Math.max(1, Math.floor(safeHeight * safePixelRatio))
  }
}

export function elementCssScale(element) {
  const scaleReference = element?.closest?.('#kiosk-stage') || element
  if (!scaleReference?.getBoundingClientRect) return 1
  const bounds = scaleReference.getBoundingClientRect()
  return calculateCssScale({
    layoutWidth: scaleReference.offsetWidth || scaleReference.clientWidth,
    layoutHeight: scaleReference.offsetHeight || scaleReference.clientHeight,
    renderedWidth: bounds.width,
    renderedHeight: bounds.height
  })
}
