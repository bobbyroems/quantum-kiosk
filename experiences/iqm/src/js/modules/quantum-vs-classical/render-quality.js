import { calculateStageAwarePixelRatio } from '../../core/three-render-budget.js'

export const QVC_MAX_RENDER_PIXELS = 10_000_000

export function calculateQvcPixelRatio({
  width,
  height,
  devicePixelRatio = 1
}) {
  return calculateStageAwarePixelRatio({
    width,
    height,
    cssScale: 1,
    devicePixelRatio,
    maxRenderPixels: QVC_MAX_RENDER_PIXELS,
    minPixelRatio: 1,
    maxPixelRatio: 2
  })
}
