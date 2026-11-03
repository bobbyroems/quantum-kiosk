/** Pixel-aligned WebGL copy region, including the blur kernel's guard band. */
export function visibleFramebufferRegion(width, height, canvasRect, clipRect, padding = 0) {
  if (!canvasRect?.width || !canvasRect?.height || !clipRect) {
    return { x: 0, y: 0, width, height }
  }
  const scaleX = width / canvasRect.width
  const scaleY = height / canvasRect.height
  const left = Math.max(canvasRect.left, clipRect.left)
  const right = Math.min(canvasRect.right, clipRect.right)
  const top = Math.max(canvasRect.top, clipRect.top)
  const bottom = Math.min(canvasRect.bottom, clipRect.bottom)
  if (right <= left || bottom <= top) return { x: 0, y: 0, width: 0, height: 0 }
  const x = Math.max(0, Math.floor((left - canvasRect.left) * scaleX) - padding)
  const y = Math.max(0, Math.floor((canvasRect.bottom - bottom) * scaleY) - padding)
  const endX = Math.min(width, Math.ceil((right - canvasRect.left) * scaleX) + padding)
  const endY = Math.min(height, Math.ceil((canvasRect.bottom - top) * scaleY) + padding)
  return { x, y, width: endX - x, height: endY - y }
}
