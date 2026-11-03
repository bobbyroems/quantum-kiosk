/** Stop awaiting abandoned work, but still observe and release late results. */
export function waitForTask(task, signal, onLateResolve = () => {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    const abort = () => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      reject(signal.reason || new DOMException('Operation aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    Promise.resolve(task).then(value => {
      if (settled) {
        onLateResolve(value)
        return
      }
      settled = true
      signal?.removeEventListener('abort', abort)
      resolve(value)
    }, error => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      reject(error)
    }).catch(error => console.error('Late task cleanup failed.', error))
  })
}

export function taskTimeout(message) {
  return new DOMException(message, 'TimeoutError')
}
