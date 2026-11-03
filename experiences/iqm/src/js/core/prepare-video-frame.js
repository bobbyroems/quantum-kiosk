/** Start decoding under the entry cover; a missing clip must not block entry. */
export function prepareVideoFrame(video, { signal, timeoutMs = 4000 } = {}) {
  if (!video || signal?.aborted) return Promise.resolve(false)
  return new Promise(resolve => {
    let callback = null
    let settled = false
    const finish = ready => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      if (callback !== null) video.cancelVideoFrameCallback?.(callback)
      video.removeEventListener('loadeddata', loaded)
      video.removeEventListener('error', failed)
      signal?.removeEventListener('abort', failed)
      resolve(ready)
    }
    const failed = () => finish(false)
    const loaded = () => finish(true)
    const deadline = setTimeout(failed, timeoutMs)
    video.addEventListener('error', failed, { once: true })
    signal?.addEventListener('abort', failed, { once: true })
    if (video.requestVideoFrameCallback) {
      callback = video.requestVideoFrameCallback(() => finish(true))
    } else if (video.readyState >= 2) {
      finish(true)
    } else {
      video.addEventListener('loadeddata', loaded, { once: true })
    }
    try { Promise.resolve(video.play()).catch(failed) } catch { failed() }
  })
}
