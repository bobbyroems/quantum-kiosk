export const QUBIT_PHASES = Object.freeze({
  INTRO: 'intro',
  MATERIALS: 'materials',
  READY: 'ready',
  DRAGGING: 'dragging',
  RETURNING: 'returning',
  SNAPPING: 'snapping',
  TUNING: 'tuning',
  COMPLETE: 'complete'
})

/*
 * Distance at which the layers commit and snap together, in the units
 * assemblyDistanceFromProgress produces (0 joined, 4 fully apart). Deliberately
 * generous: once the visitor has clearly brought the pair together the join
 * should close itself rather than demand the last few percent of the drag. It
 * also governs releasing early, and the "is-magnetic" cue at 1.45x this.
 */
export const QUBIT_DROP_THRESHOLD = 1.4
export const QUBIT_TUNE_COMPLETE_THRESHOLD = 1

export const QUBIT_MATERIAL_STEPS = Object.freeze({
  SUPERCONDUCTOR: 'superconductor',
  SEMICONDUCTOR: 'semiconductor'
})

export function createQubitExplorerState() {
  return {
    phase: QUBIT_PHASES.INTRO,
    attempts: 0,
    hasInteracted: false,
    /* The board opens on a screen of its own — "Two materials. One new state."
       with "Tap anywhere to continue" — so the copy is up from the start and
       the module waits there rather than running straight into the materials. */
    introDismissed: false,
    introSettled: false,
    materialStep: null,
    tuneProgress: 0
  }
}

export function isQubitDragEnabled(state) {
  return state.phase === QUBIT_PHASES.READY
}

/*
 * Both slabs are on screen from the opening, which is how the board draws it
 * (Figma 11:12587): two materials present, and each lesson lifting one of them
 * out while the other falls back.
 *
 * They used to arrive one at a time, which left the superconductor lesson with
 * nothing to contrast against — the scene showed a single slab while the copy
 * talked about a pair, and the dimming that exists to do the highlighting had
 * nothing to dim.
 */
export function isQubitSemiconductorVisible(state) {
  return Boolean(state)
}

export function isValidQubitDrop(distance, threshold) {
  return Number.isFinite(distance) &&
    Number.isFinite(threshold) &&
    threshold >= 0 &&
    distance <= threshold
}

export function reduceQubitExplorerState(state, event) {
  switch (event.type) {
    /* Teach the first slab, then reveal and teach the second before asking the
       visitor to combine them. */
    /* The entrance animation finishing does not move the module on any more —
       it settles the opening screen, which then waits to be tapped. */
    case 'INTRO_SETTLED':
      if (state.phase !== QUBIT_PHASES.INTRO) return state
      return { ...state, introSettled: true }

    case 'INTRO_COMPLETE':
      if (state.phase !== QUBIT_PHASES.INTRO) return state
      return {
        ...state,
        phase: QUBIT_PHASES.MATERIALS,
        introDismissed: true,
        materialStep: QUBIT_MATERIAL_STEPS.SUPERCONDUCTOR
      }

    /* A press while the slabs are arriving may skip only the entrance motion;
       it must not skip either material explanation. */
    case 'SKIP_INTRO':
      if (state.phase !== QUBIT_PHASES.INTRO) return state
      return { ...state, introSettled: true }

    case 'MATERIALS_NEXT':
      if (state.phase !== QUBIT_PHASES.MATERIALS) return state
      if (state.materialStep === QUBIT_MATERIAL_STEPS.SUPERCONDUCTOR) {
        return {
          ...state,
          materialStep: QUBIT_MATERIAL_STEPS.SEMICONDUCTOR
        }
      }
      if (state.materialStep !== QUBIT_MATERIAL_STEPS.SEMICONDUCTOR) return state
      return {
        ...state,
        phase: QUBIT_PHASES.READY,
        introDismissed: false,
        materialStep: null
      }

    case 'DRAG_START':
      if (!isQubitDragEnabled(state)) return state
      return {
        ...state,
        phase: QUBIT_PHASES.DRAGGING,
        hasInteracted: true,
        introDismissed: true
      }

    case 'DROP':
      if (state.phase !== QUBIT_PHASES.DRAGGING) return state
      return {
        ...state,
        phase: event.valid ? QUBIT_PHASES.SNAPPING : QUBIT_PHASES.RETURNING,
        attempts: event.valid ? state.attempts : state.attempts + 1
      }

    case 'RETURN_COMPLETE':
      if (state.phase !== QUBIT_PHASES.RETURNING) return state
      return {
        ...state,
        phase: QUBIT_PHASES.READY
      }

    case 'SNAP_COMPLETE':
      if (state.phase !== QUBIT_PHASES.SNAPPING) return state
      return {
        ...state,
        phase: QUBIT_PHASES.TUNING,
        materialStep: null
      }

    case 'TUNE_INPUT': {
      const tunePhase = state.phase === QUBIT_PHASES.TUNING ||
        state.phase === QUBIT_PHASES.COMPLETE
      if (!tunePhase || !Number.isFinite(event.value)) return state

      const tuneProgress = Math.min(1, Math.max(0, event.value))
      if (tuneProgress >= QUBIT_TUNE_COMPLETE_THRESHOLD) {
        return {
          ...state,
          phase: QUBIT_PHASES.COMPLETE,
          tuneProgress: 1
        }
      }

      return {
        ...state,
        phase: QUBIT_PHASES.TUNING,
        tuneProgress
      }
    }

    case 'RESTART':
      return createQubitExplorerState()

    default:
      return state
  }
}
