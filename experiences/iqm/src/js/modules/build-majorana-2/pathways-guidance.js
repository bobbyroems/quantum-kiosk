import { PATHWAYS_TIMINGS } from './pathways-timeline.js'

// Reveal on the first actionable frame. Waiting for loopStartMs would leave a
// 500 ms window in which Next is already enabled but the prompt is not shown.
const revealAtMs = PATHWAYS_TIMINGS.copy.endMs

export const PATHWAYS_GUIDANCE_TIMINGS = Object.freeze({
  revealAtMs,
  visibleDurationMs: 5_000
})

export function createPathwaysGuidanceController({
  timings = PATHWAYS_GUIDANCE_TIMINGS,
  onVisibilityChange = () => {}
} = {}) {
  let active = false
  let disposed = false
  let visible = false
  let phase = 'inactive'

  function setVisible(nextVisible) {
    if (visible === nextVisible) return
    visible = nextVisible
    onVisibilityChange(visible)
  }

  function start() {
    if (disposed) return
    active = true
    phase = 'waiting'
    setVisible(false)
    update(0)
  }

  function update(elapsedMs) {
    if (!active || disposed || phase === 'complete') return

    const safeElapsedMs = Number.isFinite(elapsedMs)
      ? Math.max(0, elapsedMs)
      : 0
    const showAtMs = timings.revealAtMs
    const hideAtMs = showAtMs + timings.visibleDurationMs

    if (safeElapsedMs >= hideAtMs) {
      phase = 'complete'
      setVisible(false)
      return
    }

    if (safeElapsedMs >= showAtMs) {
      phase = 'visible'
      setVisible(true)
      return
    }

    phase = 'waiting'
    setVisible(false)
  }

  function dismiss() {
    if (!active || disposed || !visible) return false
    phase = 'complete'
    setVisible(false)
    return true
  }

  function stop() {
    if (disposed) return
    active = false
    phase = 'inactive'
    setVisible(false)
  }

  function getSnapshot() {
    return {
      active,
      phase,
      visible
    }
  }

  function dispose() {
    if (disposed) return
    active = false
    disposed = true
    phase = 'inactive'
    setVisible(false)
  }

  return {
    dismiss,
    dispose,
    getSnapshot,
    start,
    stop,
    update
  }
}
