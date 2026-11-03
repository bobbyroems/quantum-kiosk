/**
 * Returns a consistent AbortError even on browsers where AbortSignal.reason is
 * missing. Keeping this in one place also means async media setup can fail fast
 * before it allocates a decoder or graphics context.
 */
export function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal)
}

/**
 * Stops a media pipeline and detaches its source. Chromium can retain a video
 * decoder after the element leaves the DOM; load() after clearing src is the
 * operation that releases that decoder promptly.
 */
export function releaseVideoElement(video, { remove = false } = {}) {
  if (!video) return
  try { video.pause?.() } catch { /* A half-created media element is still safe to release. */ }
  try {
    if ('srcObject' in video) video.srcObject = null
  } catch { /* Some browser media shims expose a read-only srcObject. */ }
  video.removeAttribute?.('src')
  try { video.load?.() } catch { /* A detached/failed decoder may reject load(). */ }
  if (remove) video.remove?.()
}
