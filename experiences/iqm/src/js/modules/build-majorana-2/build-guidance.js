export const BUILD_GUIDANCE_TIMINGS = Object.freeze({
  initialTooltipDelayMs: 3_000,
  idleGuidanceDelayMs: 10_000,
  firstPlacementTooltipDurationMs: 10_000,
  partialReentryTooltipDurationMs: 5_000,
  /* Long enough to let the second chip finish seating, short enough that the
     module reads as answering the drop rather than thinking about it. */
  completionTooltipDelayMs: 300
})

const PART_IDS = Object.freeze(['qpu-stack', 'cryo-cmos'])

function normalizePlacements(placements = {}) {
  return {
    'qpu-stack': Boolean(placements['qpu-stack']),
    'cryo-cmos': Boolean(placements['cryo-cmos'])
  }
}

function placementCount(placements) {
  return PART_IDS.reduce(
    (count, partId) => count + Number(Boolean(placements[partId])),
    0
  )
}

function placementsMatch(first, second) {
  return PART_IDS.every(partId => first[partId] === second[partId])
}

function safeTime(atMs) {
  return Number.isFinite(atMs) ? Math.max(0, atMs) : 0
}

export function createBuildGuidanceState(placements = {}) {
  return {
    active: false,
    completedAt: null,
    enteredAt: null,
    firstPlacedAt: null,
    firstPlacedPartId: null,
    hasEntered: false,
    interactionActive: false,
    lastActivityAt: null,
    partialReenteredAt: null,
    placements: normalizePlacements(placements)
  }
}

export function reduceBuildGuidanceState(state, event) {
  const atMs = safeTime(event.atMs)

  switch (event.type) {
    case 'SET_ACTIVE': {
      const active = Boolean(event.active)
      if (state.active === active) return state

      if (!active) {
        return {
          ...state,
          active: false,
          enteredAt: null,
          interactionActive: false,
          lastActivityAt: null,
          partialReenteredAt: null
        }
      }

      const progress = placementCount(state.placements)
      const isPartialReentry = state.hasEntered && progress === 1
      return {
        ...state,
        active: true,
        enteredAt: atMs,
        firstPlacedAt: isPartialReentry ? null : state.firstPlacedAt,
        hasEntered: true,
        interactionActive: false,
        lastActivityAt: atMs,
        partialReenteredAt: isPartialReentry ? atMs : null
      }
    }

    case 'ACTIVITY':
      if (!state.active) return state
      return {
        ...state,
        lastActivityAt: atMs
      }

    case 'SET_INTERACTION_ACTIVE': {
      const interactionActive = Boolean(event.active)
      if (state.interactionActive === interactionActive) return state
      return {
        ...state,
        interactionActive,
        lastActivityAt: state.active && !interactionActive
          ? atMs
          : state.lastActivityAt
      }
    }

    case 'SYNC_PLACEMENTS': {
      const placements = normalizePlacements(event.placements)
      if (placementsMatch(state.placements, placements)) return state

      const previousCount = placementCount(state.placements)
      const nextCount = placementCount(placements)

      if (nextCount < previousCount || nextCount === 0) {
        const remainingPartId = nextCount === 1
          ? PART_IDS.find(partId => placements[partId]) ?? null
          : null
        return {
          ...state,
          completedAt: null,
          enteredAt: state.active ? atMs : null,
          firstPlacedAt: null,
          firstPlacedPartId: remainingPartId,
          interactionActive: false,
          lastActivityAt: state.active ? atMs : null,
          partialReenteredAt: null,
          placements
        }
      }

      const firstPlacedPartId = previousCount === 0 && nextCount === 1
        ? PART_IDS.find(partId => !state.placements[partId] && placements[partId]) ?? null
        : state.firstPlacedPartId
      const firstPlacedAt = previousCount === 0 && nextCount === 1
        ? atMs
        : state.firstPlacedAt
      const completedAt = previousCount < PART_IDS.length && nextCount === PART_IDS.length
        ? atMs
        : state.completedAt

      return {
        ...state,
        completedAt,
        firstPlacedAt,
        firstPlacedPartId,
        lastActivityAt: state.active ? atMs : state.lastActivityAt,
        partialReenteredAt: null,
        placements
      }
    }

    case 'RESET':
      return {
        ...createBuildGuidanceState(),
        active: state.active,
        enteredAt: state.active ? atMs : null,
        lastActivityAt: state.active ? atMs : null
      }

    default:
      return state
  }
}

export function getBuildGuidanceSnapshot(
  state,
  atMs,
  timings = BUILD_GUIDANCE_TIMINGS
) {
  const nowMs = safeTime(atMs)
  const progress = placementCount(state.placements)

  if (!state.active) {
    return {
      active: false,
      activePathwayCount: progress === 2 ? 3 : 0,
      bottomTooltip: null,
      complete: progress === 2,
      completionTooltipVisible: false,
      guidanceTargets: [],
      guidanceVisible: false,
      interactionActive: false,
      missingSlotId: null,
      phase: 'inactive'
    }
  }

  const firstTooltipUntil = state.firstPlacedAt == null
    ? null
    : state.firstPlacedAt + timings.firstPlacementTooltipDurationMs
  const firstTooltipVisible = firstTooltipUntil != null && nowMs < firstTooltipUntil
  const partialReentryTooltipUntil = state.partialReenteredAt == null
    ? null
    : state.partialReenteredAt + timings.partialReentryTooltipDurationMs
  const partialReentryTooltipVisible =
    progress === 1 &&
    partialReentryTooltipUntil != null &&
    nowMs < partialReentryTooltipUntil
  const initialTooltipVisible =
    progress === 0 &&
    state.enteredAt != null &&
    nowMs >= state.enteredAt + timings.initialTooltipDelayMs

  let phase = 'empty'
  let activePathwayCount = 0
  let missingSlotId = null
  let bottomTooltip = initialTooltipVisible ? 'initial' : null

  /* Which chip landed first. Falls back to whichever slot is filled, so a
     re-entry that lost the recorded order still reports a side. */
  const firstPlacedPartId = state.firstPlacedPartId ??
    PART_IDS.find(partId => state.placements[partId]) ??
    null

  if (progress === 1) {
    const qpuFirst = firstPlacedPartId === 'qpu-stack'
    phase = qpuFirst ? 'qpu-first' : 'cryo-first'
    activePathwayCount = qpuFirst ? 1 : 2
    missingSlotId = qpuFirst ? 'cryo-cmos' : 'qpu-stack'
    bottomTooltip = firstTooltipVisible || partialReentryTooltipVisible
      ? phase
      : null
  } else if (progress === 2) {
    phase = 'complete'
    activePathwayCount = 3
    bottomTooltip = firstTooltipVisible
      ? (firstPlacedPartId === 'qpu-stack' ? 'qpu-first' : 'cryo-first')
      : null
  }

  const baseIdleAt = state.lastActivityAt == null
    ? Number.POSITIVE_INFINITY
    : state.lastActivityAt + timings.idleGuidanceDelayMs
  const idleAt = progress === 1
    ? Math.max(
        baseIdleAt,
        firstTooltipUntil ?? Number.NEGATIVE_INFINITY,
        partialReentryTooltipUntil ?? Number.NEGATIVE_INFINITY
      )
    : baseIdleAt
  const guidanceVisible =
    progress < 2 &&
    !state.interactionActive &&
    nowMs >= idleAt
  const completionTooltipVisible =
    progress === 2 &&
    state.completedAt != null &&
    nowMs >= state.completedAt + timings.completionTooltipDelayMs

  return {
    active: true,
    activePathwayCount,
    bottomTooltip,
    complete: progress === 2,
    completionTooltipVisible,
    guidanceTargets: progress < 2
      ? PART_IDS.filter(partId => !state.placements[partId])
      : [],
    guidanceVisible,
    firstPlacedPartId,
    interactionActive: state.interactionActive,
    missingSlotId,
    phase
  }
}

export function getNextBuildGuidanceDeadline(
  state,
  atMs,
  timings = BUILD_GUIDANCE_TIMINGS
) {
  if (!state.active) return null

  const nowMs = safeTime(atMs)
  const progress = placementCount(state.placements)
  const candidates = []

  if (
    progress === 0 &&
    state.enteredAt != null
  ) {
    candidates.push(state.enteredAt + timings.initialTooltipDelayMs)
  }

  if (progress < 2 && !state.interactionActive && state.lastActivityAt != null) {
    let idleAt = state.lastActivityAt + timings.idleGuidanceDelayMs
    if (progress === 1 && state.firstPlacedAt != null) {
      idleAt = Math.max(
        idleAt,
        state.firstPlacedAt + timings.firstPlacementTooltipDurationMs
      )
    }
    if (progress === 1 && state.partialReenteredAt != null) {
      idleAt = Math.max(
        idleAt,
        state.partialReenteredAt + timings.partialReentryTooltipDurationMs
      )
    }
    candidates.push(idleAt)
  }

  if (state.firstPlacedAt != null) {
    candidates.push(state.firstPlacedAt + timings.firstPlacementTooltipDurationMs)
  }

  if (progress === 1 && state.partialReenteredAt != null) {
    candidates.push(
      state.partialReenteredAt + timings.partialReentryTooltipDurationMs
    )
  }

  if (progress === 2 && state.completedAt != null) {
    candidates.push(state.completedAt + timings.completionTooltipDelayMs)
  }

  return candidates
    .filter(deadline => deadline > nowMs)
    .sort((first, second) => first - second)[0] ?? null
}

function snapshotsMatch(first, second) {
  return JSON.stringify(first) === JSON.stringify(second)
}

export function createBuildGuidanceController({
  timings = BUILD_GUIDANCE_TIMINGS,
  now = () => performance.now(),
  setTimeoutFn = (callback, delay) => window.setTimeout(callback, delay),
  clearTimeoutFn = timerId => window.clearTimeout(timerId),
  onChange = () => {}
} = {}) {
  let disposed = false
  let state = createBuildGuidanceState()
  let timerId = null
  let timerRun = 0
  let renderedSnapshot = getBuildGuidanceSnapshot(state, now(), timings)

  function clearTimer() {
    if (timerId == null) return
    clearTimeoutFn(timerId)
    timerId = null
  }

  function emitAndSchedule({ force = false } = {}) {
    clearTimer()
    if (disposed) return

    const atMs = now()
    const snapshot = getBuildGuidanceSnapshot(state, atMs, timings)
    if (force || !snapshotsMatch(snapshot, renderedSnapshot)) {
      renderedSnapshot = snapshot
      onChange(snapshot)
    }

    const deadline = getNextBuildGuidanceDeadline(state, atMs, timings)
    if (deadline == null) return

    const scheduledRun = ++timerRun
    timerId = setTimeoutFn(() => {
      timerId = null
      if (disposed || timerRun !== scheduledRun) return
      emitAndSchedule()
    }, Math.max(0, deadline - atMs))
  }

  function dispatch(event) {
    if (disposed) return
    const nextState = reduceBuildGuidanceState(state, {
      ...event,
      atMs: now()
    })
    if (nextState === state) return
    state = nextState
    timerRun += 1
    emitAndSchedule()
  }

  function getSnapshot() {
    return getBuildGuidanceSnapshot(state, now(), timings)
  }

  function dispose() {
    if (disposed) return
    disposed = true
    timerRun += 1
    clearTimer()
    state = reduceBuildGuidanceState(state, {
      type: 'SET_ACTIVE',
      active: false,
      atMs: now()
    })
    renderedSnapshot = getBuildGuidanceSnapshot(state, now(), timings)
    onChange(renderedSnapshot)
  }

  return {
    dispose,
    getSnapshot,
    noteActivity: () => dispatch({ type: 'ACTIVITY' }),
    reset: () => dispatch({ type: 'RESET' }),
    setActive: active => dispatch({ type: 'SET_ACTIVE', active }),
    setInteractionActive: active => dispatch({ type: 'SET_INTERACTION_ACTIVE', active }),
    syncPlacements: placements => dispatch({ type: 'SYNC_PLACEMENTS', placements })
  }
}
