const ASSET_ROOT = 'assets/modules/measurement-based'

/* The board splits the module's footage into six clips. Three of them are the
   frames the visitor actually reads against — an opening hold and two loops —
   and the other three are builds that play exactly once on the forward edge
   between them. Every stable step therefore names one of the holds/loops, and
   every authored edge names one of the builds. */
export const MEASUREMENT_STORY_ASSETS = Object.freeze({
  OPENING_BUILD: `${ASSET_ROOT}/IQM_MultiQubit_VIDEO_split-001.webm`,
  MEASUREMENT_PAIR_LOOP: `${ASSET_ROOT}/IQM_MultiQubit_VIDEO_split-002.webm`,
  SEQUENCE_BUILD: `${ASSET_ROOT}/IQM_MultiQubit_VIDEO_split-003.webm`,
  MEASUREMENT_SEQUENCE_LOOP: `${ASSET_ROOT}/IQM_MultiQubit_VIDEO_split-004.webm`,
  INFORMATION_CLOUD_BUILD: `${ASSET_ROOT}/IQM_MultiQubit_VIDEO_split-005.webm`,
  INFORMATION_CLOUD_LOOP: `${ASSET_ROOT}/IQM_MultiQubit_VIDEO_split-006.webm`
})

export const MEASUREMENT_STORY_STEP_IDS = Object.freeze({
  OPENING: 'opening',
  MEASUREMENT_PAIR: 'measurement-pair',
  MEASUREMENT_SEQUENCE: 'measurement-sequence',
  PROTECTED_INFORMATION: 'protected-information',
  BUILT_FOR_SCALE: 'built-for-scale'
})

export const MEASUREMENT_STORY_TRANSITION_IDS = Object.freeze({
  OPENING: 'opening',
  SEQUENCE: 'sequence',
  INFORMATION_CLOUD: 'information-cloud'
})

/* A chapter is one clip. The last two steps share the final loop, so they
   share a chapter; every other step gets its own. */
export const MEASUREMENT_STORY_CHAPTER_IDS = Object.freeze({
  OPENING: 'opening',
  MEASUREMENT_PAIR: 'measurement-pair',
  MEASUREMENT_SEQUENCE: 'measurement-sequence',
  INFORMATION_CLOUD: 'information-cloud'
})

function storyStep(id, chapterId, chapterIndex) {
  return Object.freeze({ id, chapterId, chapterIndex })
}

/* Five readings follow the final content document. The final loop carries
   the complete protection explanation followed by the complete scale ending. */
export const MEASUREMENT_STORY_STEPS = Object.freeze([
  storyStep(
    MEASUREMENT_STORY_STEP_IDS.OPENING,
    MEASUREMENT_STORY_CHAPTER_IDS.OPENING,
    0
  ),
  storyStep(
    MEASUREMENT_STORY_STEP_IDS.MEASUREMENT_PAIR,
    MEASUREMENT_STORY_CHAPTER_IDS.MEASUREMENT_PAIR,
    1
  ),
  storyStep(
    MEASUREMENT_STORY_STEP_IDS.MEASUREMENT_SEQUENCE,
    MEASUREMENT_STORY_CHAPTER_IDS.MEASUREMENT_SEQUENCE,
    2
  ),
  storyStep(
    MEASUREMENT_STORY_STEP_IDS.PROTECTED_INFORMATION,
    MEASUREMENT_STORY_CHAPTER_IDS.INFORMATION_CLOUD,
    3
  ),
  storyStep(
    MEASUREMENT_STORY_STEP_IDS.BUILT_FOR_SCALE,
    MEASUREMENT_STORY_CHAPTER_IDS.INFORMATION_CLOUD,
    3
  )
])

function storyChapter(id, index, stepIds) {
  return Object.freeze({ id, index, stepIds: Object.freeze(stepIds) })
}

export const MEASUREMENT_STORY_CHAPTERS = Object.freeze([
  storyChapter(MEASUREMENT_STORY_CHAPTER_IDS.OPENING, 0, [
    MEASUREMENT_STORY_STEP_IDS.OPENING
  ]),
  storyChapter(MEASUREMENT_STORY_CHAPTER_IDS.MEASUREMENT_PAIR, 1, [
    MEASUREMENT_STORY_STEP_IDS.MEASUREMENT_PAIR
  ]),
  storyChapter(MEASUREMENT_STORY_CHAPTER_IDS.MEASUREMENT_SEQUENCE, 2, [
    MEASUREMENT_STORY_STEP_IDS.MEASUREMENT_SEQUENCE
  ]),
  storyChapter(MEASUREMENT_STORY_CHAPTER_IDS.INFORMATION_CLOUD, 3, [
    MEASUREMENT_STORY_STEP_IDS.PROTECTED_INFORMATION,
    MEASUREMENT_STORY_STEP_IDS.BUILT_FOR_SCALE
  ])
])

export const MEASUREMENT_STORY_EVENTS = Object.freeze({
  NEXT: 'NEXT',
  BACK: 'BACK',
  RESTART: 'RESTART'
})

const STEP_INDEX_BY_ID = new Map(
  MEASUREMENT_STORY_STEPS.map((step, index) => [step.id, index])
)

function stateAt(stepIndex) {
  const step = MEASUREMENT_STORY_STEPS[stepIndex]
  return {
    stepIndex,
    stepId: step.id,
    chapterIndex: step.chapterIndex,
    chapterId: step.chapterId
  }
}

export function createMeasurementStoryState() {
  return stateAt(0)
}

export function getMeasurementStoryStep(stateOrStepId) {
  const stepId = typeof stateOrStepId === 'string'
    ? stateOrStepId
    : stateOrStepId?.stepId
  const stepIndex = STEP_INDEX_BY_ID.get(stepId)
  return stepIndex === undefined ? null : MEASUREMENT_STORY_STEPS[stepIndex]
}

export function getMeasurementStoryProgress(state) {
  const step = getMeasurementStoryStep(state) || MEASUREMENT_STORY_STEPS[0]
  const stepIndex = STEP_INDEX_BY_ID.get(step.id)
  return {
    stepIndex,
    stepNumber: stepIndex + 1,
    stepCount: MEASUREMENT_STORY_STEPS.length,
    chapterIndex: step.chapterIndex,
    chapterNumber: step.chapterIndex + 1,
    chapterCount: MEASUREMENT_STORY_CHAPTERS.length
  }
}

export function canAdvanceMeasurementStory(state) {
  const step = getMeasurementStoryStep(state)
  return Boolean(step && STEP_INDEX_BY_ID.get(step.id) < MEASUREMENT_STORY_STEPS.length - 1)
}

export function canGoBackInMeasurementStory(state) {
  const step = getMeasurementStoryStep(state)
  return Boolean(step && STEP_INDEX_BY_ID.get(step.id) > 0)
}

function moveMeasurementStory(state, offset) {
  const step = getMeasurementStoryStep(state)
  if (!step) return createMeasurementStoryState()
  const currentIndex = STEP_INDEX_BY_ID.get(step.id)
  const nextIndex = Math.min(
    MEASUREMENT_STORY_STEPS.length - 1,
    Math.max(0, currentIndex + offset)
  )
  return nextIndex === currentIndex ? state : stateAt(nextIndex)
}

export function reduceMeasurementStoryState(state, event) {
  const current = state || createMeasurementStoryState()
  switch (event?.type) {
    case MEASUREMENT_STORY_EVENTS.NEXT:
      return moveMeasurementStory(current, 1)
    case MEASUREMENT_STORY_EVENTS.BACK:
      return moveMeasurementStory(current, -1)
    case MEASUREMENT_STORY_EVENTS.RESTART:
      return createMeasurementStoryState()
    default:
      return current
  }
}

function media(src, mode, extra = {}) {
  return Object.freeze({ src, mode, loop: mode === 'loop', ...extra })
}

/* The opening step holds the first frame of the opening build. Advancing plays
   that same clip once; every later stable frame sits on one of the two loops. */
const OPENING_HOLD = media(MEASUREMENT_STORY_ASSETS.OPENING_BUILD, 'hold-first-frame')
const MEASUREMENT_PAIR_LOOP = media(MEASUREMENT_STORY_ASSETS.MEASUREMENT_PAIR_LOOP, 'loop')
const MEASUREMENT_SEQUENCE_LOOP = media(
  MEASUREMENT_STORY_ASSETS.MEASUREMENT_SEQUENCE_LOOP,
  'loop'
)
const INFORMATION_CLOUD_LOOP = media(MEASUREMENT_STORY_ASSETS.INFORMATION_CLOUD_LOOP, 'loop')

export const MEASUREMENT_STORY_STABLE_MEDIA = Object.freeze({
  [MEASUREMENT_STORY_STEP_IDS.OPENING]: OPENING_HOLD,
  [MEASUREMENT_STORY_STEP_IDS.MEASUREMENT_PAIR]: MEASUREMENT_PAIR_LOOP,
  [MEASUREMENT_STORY_STEP_IDS.MEASUREMENT_SEQUENCE]: MEASUREMENT_SEQUENCE_LOOP,
  [MEASUREMENT_STORY_STEP_IDS.PROTECTED_INFORMATION]: INFORMATION_CLOUD_LOOP,
  [MEASUREMENT_STORY_STEP_IDS.BUILT_FOR_SCALE]: INFORMATION_CLOUD_LOOP
})

function edgeKey(fromStepId, toStepId) {
  return `${fromStepId}->${toStepId}`
}

/* The opening edge carries no build clip. The delivered one is 2.7s of straight
   cross fade between two compositions whose rectangles do not agree -- the
   close-up card is 1490x1010 centred at y 1919, the grid it becomes is 1540x760
   centred at y 2048 -- so the still dissolved out at a size that was never the
   size of the frame it turned into. The module fades between the two frames
   itself instead, which is the whole of what that clip contained: its first
   frame is the opening hold and its last frame is the pair loop.
 *
 * Every swap between two clips is faded rather than cut. Two of the four ends
 * would survive a cut -- measured off the delivered frames as mean luma
 * difference on a 0-255 scale:
 *
 *   pair loop end      -> sequence build start   0.02   continuous
 *   sequence build end -> sequence loop start    0.05   continuous
 *   sequence loop      -> cloud build start      up to 1.02
 *   cloud build end    -> cloud loop start       0.86
 *
 * -- but the other two cannot. The sequence loop runs 7s and wraps seamlessly
 * (its own ends differ by 0.00), so where it has got to when Next is pressed is
 * unknowable, and the cloud build does not end on the frame its loop begins on.
 * Those two were the visible flashes. Fading all four keeps every boundary the
 * same rather than making the visitor's experience of pressing Next depend on
 * which clip happens to line up. */
export const MEASUREMENT_STORY_FORWARD_TRANSITIONS = Object.freeze({
  [edgeKey(
    MEASUREMENT_STORY_STEP_IDS.MEASUREMENT_PAIR,
    MEASUREMENT_STORY_STEP_IDS.MEASUREMENT_SEQUENCE
  )]: media(MEASUREMENT_STORY_ASSETS.SEQUENCE_BUILD, 'once', {
    id: MEASUREMENT_STORY_TRANSITION_IDS.SEQUENCE,
    settleSrc: MEASUREMENT_STORY_ASSETS.MEASUREMENT_SEQUENCE_LOOP
  }),
  [edgeKey(
    MEASUREMENT_STORY_STEP_IDS.MEASUREMENT_SEQUENCE,
    MEASUREMENT_STORY_STEP_IDS.PROTECTED_INFORMATION
  )]: media(MEASUREMENT_STORY_ASSETS.INFORMATION_CLOUD_BUILD, 'once', {
    id: MEASUREMENT_STORY_TRANSITION_IDS.INFORMATION_CLOUD,
    settleSrc: MEASUREMENT_STORY_ASSETS.INFORMATION_CLOUD_LOOP
  })
})

export function getMeasurementStoryStableMedia(stateOrStepId) {
  const step = getMeasurementStoryStep(stateOrStepId)
  return step ? MEASUREMENT_STORY_STABLE_MEDIA[step.id] : null
}

/* Only authored forward edges play build clips. Backward navigation and
   copy-only moves land directly on the destination's stable loop. */
export function getMeasurementStoryForwardTransition(fromStateOrId, toStateOrId) {
  const from = getMeasurementStoryStep(fromStateOrId)
  const to = getMeasurementStoryStep(toStateOrId)
  if (!from || !to) return null
  return MEASUREMENT_STORY_FORWARD_TRANSITIONS[edgeKey(from.id, to.id)] || null
}

export function getMeasurementStoryPlayback(fromStateOrId, toStateOrId) {
  return getMeasurementStoryForwardTransition(fromStateOrId, toStateOrId) ||
    getMeasurementStoryStableMedia(toStateOrId)
}
