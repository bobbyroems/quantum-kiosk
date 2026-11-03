export const COMPONENT_GUIDANCE_TIMINGS = Object.freeze({
  initialDelayMs: 1_000,
  visibleDurationMs: 5_000,
  dismissLockMs: 1_500,
  idleDelayMs: 10_000
})

export function createComponentsGuidanceController({
  timings = COMPONENT_GUIDANCE_TIMINGS,
  now = () => performance.now(),
  setTimeoutFn = (callback, delay) => window.setTimeout(callback, delay),
  clearTimeoutFn = timerId => window.clearTimeout(timerId),
  onVisibilityChange = () => {}
} = {}) {
  let active = false
  let disposed = false
  let initialVisitConsumed = false
  let interactionActive = false
  let visible = false
  let phase = 'inactive'
  let timerId = null
  let run = 0
  let dismissAllowedAt = Number.POSITIVE_INFINITY

  function clearTimer() {
    if (timerId == null) return
    clearTimeoutFn(timerId)
    timerId = null
  }

  function setVisible(nextVisible) {
    if (visible === nextVisible) return
    visible = nextVisible
    onVisibilityChange(visible)
  }

  function schedule(nextPhase, delay, callback) {
    clearTimer()
    phase = nextPhase
    const scheduledRun = run
    timerId = setTimeoutFn(() => {
      timerId = null
      if (
        disposed ||
        !active ||
        run !== scheduledRun ||
        phase !== nextPhase
      ) return
      callback()
    }, Math.max(0, delay))
  }

  function scheduleIdle() {
    if (!active) return
    if (interactionActive) {
      clearTimer()
      phase = 'idle-paused'
      return
    }
    schedule('idle', timings.idleDelayMs, show)
  }

  function hide({ scheduleNext = true } = {}) {
    clearTimer()
    dismissAllowedAt = Number.POSITIVE_INFINITY
    setVisible(false)
    if (active && scheduleNext) scheduleIdle()
    else phase = active ? 'hidden' : 'inactive'
  }

  function show() {
    if (!active || disposed) return
    clearTimer()
    phase = 'visible'
    dismissAllowedAt = now() + timings.dismissLockMs
    setVisible(true)
    schedule('visible', timings.visibleDurationMs, hide)
  }

  function setActive(nextActive) {
    if (disposed || active === nextActive) return
    run += 1
    clearTimer()
    active = nextActive
    dismissAllowedAt = Number.POSITIVE_INFINITY
    setVisible(false)

    if (!active) {
      interactionActive = false
      phase = 'inactive'
      return
    }

    if (initialVisitConsumed) {
      scheduleIdle()
      return
    }

    initialVisitConsumed = true
    schedule('initial', timings.initialDelayMs, show)
  }

  function noteActivity() {
    if (!active || disposed) return
    if (phase === 'idle') scheduleIdle()
  }

  function setInteractionActive(nextInteractionActive) {
    if (disposed || interactionActive === nextInteractionActive) return
    interactionActive = nextInteractionActive
    if (!active) return

    if (interactionActive && phase === 'idle') {
      clearTimer()
      phase = 'idle-paused'
      return
    }

    if (!interactionActive && phase === 'idle-paused') scheduleIdle()
  }

  function canDismiss() {
    return active && visible && now() >= dismissAllowedAt
  }

  function dismiss() {
    if (!canDismiss()) return false
    hide()
    return true
  }

  function resetSession() {
    if (disposed) return
    run += 1
    clearTimer()
    active = false
    initialVisitConsumed = false
    interactionActive = false
    dismissAllowedAt = Number.POSITIVE_INFINITY
    setVisible(false)
    phase = 'inactive'
  }

  function getSnapshot() {
    return {
      active,
      canDismiss: canDismiss(),
      interactionActive,
      phase,
      visible
    }
  }

  function dispose() {
    if (disposed) return
    run += 1
    active = false
    disposed = true
    interactionActive = false
    clearTimer()
    dismissAllowedAt = Number.POSITIVE_INFINITY
    phase = 'inactive'
    setVisible(false)
  }

  return {
    canDismiss,
    dismiss,
    dispose,
    getSnapshot,
    noteActivity,
    resetSession,
    setActive,
    setInteractionActive
  }
}
