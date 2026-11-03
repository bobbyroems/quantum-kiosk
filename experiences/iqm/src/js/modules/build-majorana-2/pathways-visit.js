import { PATHWAYS_TIMINGS } from './pathways-timeline.js'

export function createPathwaysVisitController({
  loopStartMs = PATHWAYS_TIMINGS.loopStartMs
} = {}) {
  let introCompleted = false

  function enter() {
    const shouldPlayIntro = !introCompleted
    return {
      initialElapsedMs: shouldPlayIntro ? 0 : loopStartMs,
      showGuidance: shouldPlayIntro
    }
  }

  function markIntroCompleted() {
    introCompleted = true
  }

  function resetSession() {
    introCompleted = false
  }

  return {
    enter,
    markIntroCompleted,
    resetSession
  }
}
