/*
 * Staged sequencing for Interference.
 *
 * The scene is ours; this is the order it is revealed in. Rather than opening with
 * five buoys and free tapping, the field arrives a piece at a time:
 *
 *   1. one buoy above water, prompted        -> tap
 *   2. wave lesson 1                         -> tap anywhere
 *   3. a second buoy rises, prompted         -> tap
 *   4. constructive-interference lesson      -> tap anywhere
 *   5. destructive-interference lesson       -> tap anywhere
 *   6. the rest of the field rises; each remaining buoy is highlighted in turn
 *   7. resolving — the flags settle and the finale line lands
 *
 * Kept free of DOM and three so the whole order is testable: the game asks it what
 * is revealed, what the current target is and which prompt belongs on screen, and
 * it never reaches back.
 */

export const INTERFERENCE_STAGES = Object.freeze({
  FIRST_SOURCE: 'first-source',
  FIRST_LESSON: 'first-lesson',
  SECOND_SOURCE: 'second-source',
  SECOND_LESSON: 'second-lesson',
  THIRD_LESSON: 'third-lesson',
  FIELD_SEQUENCE: 'field-sequence',
  RESOLVING: 'resolving'
})

/* Which prompt the stage puts on screen. The game maps these onto elements. */
export const INTERFERENCE_PROMPTS = Object.freeze({
  BUOY: 'buoy',
  SEQUENCE: 'sequence',
  LESSON_ONE: 'lesson-one',
  LESSON_TWO: 'lesson-two',
  LESSON_THREE: 'lesson-three',
  NONE: 'none'
})

export const FIRST_SOURCE_INDEX = 0
export const SECOND_SOURCE_INDEX = 1

/*
 * Delays, in seconds, from the reference. Each one waits for a rise to read before
 * asking for the next tap — a buoy highlighted while it is still breaking the
 * surface reads as an error rather than an invitation.
 */
export const INTERFERENCE_STAGE_TIMING = Object.freeze({
  secondSourceTarget: 0.82,
  fieldFirstTarget: 0.98,
  fieldNextTarget: 0.28,
  fieldRingInterval: 0.35
})

function shuffled(indices, random) {
  const order = [...indices]
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const held = order[index]
    order[index] = order[swapIndex]
    order[swapIndex] = held
  }
  return order
}

export function createInterferenceStages({
  buoyCount = 5,
  random = Math.random,
  reducedMotion = false
} = {}) {
  const fieldIndices = []
  for (let index = SECOND_SOURCE_INDEX + 1; index < buoyCount; index += 1) {
    fieldIndices.push(index)
  }

  /* Under reduced motion the rises are near-instant, so the waits collapse too. */
  const wait = seconds => (reducedMotion ? Math.min(0.06, seconds) : seconds)

  let stage = INTERFERENCE_STAGES.FIRST_SOURCE
  let revealed = new Set()
  let targetIndex = null
  let pendingTarget = null
  let pendingTargetAt = Number.POSITIVE_INFINITY
  let fieldQueue = []
  let activated = new Set()
  let sequencePromptShown = false

  function scheduleTarget(index, time, delay) {
    pendingTarget = index
    pendingTargetAt = time + wait(delay)
  }

  function reset(time = 0) {
    stage = INTERFERENCE_STAGES.FIRST_SOURCE
    revealed = new Set([FIRST_SOURCE_INDEX])
    targetIndex = FIRST_SOURCE_INDEX
    pendingTarget = null
    pendingTargetAt = Number.POSITIVE_INFINITY
    fieldQueue = shuffled(fieldIndices, random)
    activated = new Set()
    sequencePromptShown = false
    return snapshot(time)
  }

  /*
   * The prompt is derived rather than stored: every stage has exactly one thing to
   * say, and deriving it means a prompt can never be left behind by a transition.
   * The buoy prompt waits for its target, so it does not appear over a buoy that is
   * still rising.
   */
  function promptFor() {
    if (stage === INTERFERENCE_STAGES.FIRST_LESSON) return INTERFERENCE_PROMPTS.LESSON_ONE
    if (stage === INTERFERENCE_STAGES.SECOND_LESSON) return INTERFERENCE_PROMPTS.LESSON_TWO
    if (stage === INTERFERENCE_STAGES.THIRD_LESSON) return INTERFERENCE_PROMPTS.LESSON_THREE
    if (stage === INTERFERENCE_STAGES.RESOLVING) return INTERFERENCE_PROMPTS.NONE
    if (targetIndex === null) return INTERFERENCE_PROMPTS.NONE
    if (stage === INTERFERENCE_STAGES.FIELD_SEQUENCE) return INTERFERENCE_PROMPTS.SEQUENCE
    return INTERFERENCE_PROMPTS.BUOY
  }

  function snapshot(time = 0) {
    return Object.freeze({
      activatedCount: activated.size,
      fieldRevealed: stage === INTERFERENCE_STAGES.FIELD_SEQUENCE ||
        stage === INTERFERENCE_STAGES.RESOLVING,
      isLesson: stage === INTERFERENCE_STAGES.FIRST_LESSON ||
        stage === INTERFERENCE_STAGES.SECOND_LESSON ||
        stage === INTERFERENCE_STAGES.THIRD_LESSON,
      prompt: promptFor(),
      revealed: Object.freeze(
        Array.from({ length: buoyCount }, (_, index) => revealed.has(index))
      ),
      sequencePromptShown,
      stage,
      targetIndex,
      time
    })
  }

  function update(time = 0) {
    if (pendingTarget !== null && time >= pendingTargetAt) {
      targetIndex = pendingTarget
      pendingTarget = null
      pendingTargetAt = Number.POSITIVE_INFINITY
      if (stage === INTERFERENCE_STAGES.FIELD_SEQUENCE) sequencePromptShown = true
    }
    return snapshot(time)
  }

  /*
   * Only the highlighted buoy scores. A tap anywhere else is not an error, it simply
   * does nothing at all — the scene no longer ripples under it — which is what makes
   * "complete the sequence" literal.
   */
  function tap(index, time = 0) {
    if (index !== targetIndex) return false
    activated.add(index)
    targetIndex = null

    if (stage === INTERFERENCE_STAGES.FIRST_SOURCE) {
      stage = INTERFERENCE_STAGES.FIRST_LESSON
      return true
    }
    if (stage === INTERFERENCE_STAGES.SECOND_SOURCE) {
      stage = INTERFERENCE_STAGES.SECOND_LESSON
      return true
    }

    if (fieldQueue.length > 0) {
      scheduleTarget(fieldQueue.shift(), time, INTERFERENCE_STAGE_TIMING.fieldNextTarget)
      return true
    }

    stage = INTERFERENCE_STAGES.RESOLVING
    return true
  }

  /* The lessons are dismissed by tapping anywhere, as in the reference. */
  function continueLesson(time = 0) {
    if (stage === INTERFERENCE_STAGES.FIRST_LESSON) {
      stage = INTERFERENCE_STAGES.SECOND_SOURCE
      revealed.add(SECOND_SOURCE_INDEX)
      scheduleTarget(
        SECOND_SOURCE_INDEX,
        time,
        INTERFERENCE_STAGE_TIMING.secondSourceTarget
      )
      return true
    }

    if (stage === INTERFERENCE_STAGES.SECOND_LESSON) {
      stage = INTERFERENCE_STAGES.THIRD_LESSON
      return true
    }

    if (stage === INTERFERENCE_STAGES.THIRD_LESSON) {
      stage = INTERFERENCE_STAGES.FIELD_SEQUENCE
      for (const index of fieldIndices) revealed.add(index)
      scheduleTarget(
        fieldQueue.shift(),
        time,
        INTERFERENCE_STAGE_TIMING.fieldFirstTarget
      )
      return true
    }

    return false
  }

  /* Rings rise outward from the middle of the field, so the reveal reads as
     spreading rather than as three buoys appearing at once. */
  function fieldRiseDelay(index) {
    const position = fieldIndices.indexOf(index)
    if (position < 0) return 0
    return wait(position * INTERFERENCE_STAGE_TIMING.fieldRingInterval)
  }

  reset(0)
  return {
    continueLesson,
    fieldIndices: Object.freeze([...fieldIndices]),
    fieldRiseDelay,
    reset,
    snapshot,
    tap,
    update
  }
}
