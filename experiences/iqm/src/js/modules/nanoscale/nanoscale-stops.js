/*
 * Nanoscale, design v3.
 *
 * The interaction has seven timeline positions: a room-scale splash, five numbered content
 * stops and the Figma-authored finale screen. Content indices stay zero-based so the
 * five-entry content and layout arrays remain easy to address; timeline indices include the
 * splash and therefore run one higher.
 */

export const NANOSCALE_V3_STOPS = Object.freeze([0, 1, 2, 3, 4, 5, 6])

const NANOSCALE_ROOT = 'assets/modules/nanoscale'
const COMPARISON_ROOT = `${NANOSCALE_ROOT}/Comparison Images`

export const NANOSCALE_V3_SPLASH = Object.freeze({
  id: 'splash',
  kind: 'splash',
  timelineIndex: 0,
  title: 'Exploring the nanoscale',
  body: 'Zoom from quantum hardware to nanoscale structures, using familiar objects to put their size in perspective.',
  /* Names the direction, not just the gesture. "Pinch or scroll to zoom" left
     the one thing a visitor has to guess unsaid, and at this first stop a
     downward drag is the one direction with nowhere to go. */
  instruction: 'Swipe up to zoom in',
  hero: Object.freeze({ image: `${NANOSCALE_ROOT}/splash-room.webp` })
})

/*
 * `index` is the stable content/layout index (0-4). `timelineIndex` is the actual zoom stop
 * (1-5) after accounting for the splash. Copy is kept verbatim from the audited Figma nodes.
 */
export const NANOSCALE_V3_SEQUENCE = Object.freeze([
  Object.freeze({
    id: 'cryostat',
    kind: 'content',
    index: 0,
    timelineIndex: 1,
    number: '01',
    name: 'Cryostat',
    description: 'The cryostat is designed to isolate and chill quantum processors to temperatures colder than outer space.',
    dimension: Object.freeze({ label: '3 ft', axis: 'vertical' }),
    hero: Object.freeze({ image: `${NANOSCALE_ROOT}/cryostat.webp` }),
    comparison: Object.freeze({
      caption: 'a guitar',
      image: `${COMPARISON_ROOT}/AdobeStock_guitar.kiosk.jpg`
    })
  }),
  Object.freeze({
    id: 'majorana-2',
    kind: 'content',
    index: 1,
    timelineIndex: 2,
    number: '02',
    name: 'Majorana 2',
    description: "Majorana 2 is Microsoft's second-generation topological quantum processor, designed to make quantum computing scalable by creating qubits that are smaller, longer-lived, and more resistant to errors.",
    dimension: Object.freeze({ label: '10 cm', axis: 'vertical' }),
    hero: Object.freeze({ image: `${NANOSCALE_ROOT}/majorana-2.webp` }),
    comparison: Object.freeze({
      caption: 'a hockey puck',
      image: `${COMPARISON_ROOT}/AdobeStock_puck.kiosk.jpg`
    })
  }),
  Object.freeze({
    id: 'qpu-chip',
    kind: 'content',
    index: 2,
    timelineIndex: 3,
    number: '03',
    /* Not "QPU chip". Stop 02 calls Majorana 2 a quantum processor, so naming
       the die a processing unit put the same word on two adjacent objects — and
       "QPU" already means the QPU Stack the visitor assembles in module 07, so
       it was carrying two meanings across the kiosk. "Qubit chip" matches this
       stop's own copy, leaves "array" to stop 04, and keeps the zoom nesting:
       processor, chip, array, wire. The id and asset names stay `qpu-chip`. */
    name: 'Qubit array',
    description: 'This tiny square is where the qubits live and the computing happens. Chips like this are designed for room to grow — with power measured not in size, but in scale.',
    dimension: Object.freeze({ label: '~0.5 cm', axis: 'vertical' }),
    hero: Object.freeze({ image: `${NANOSCALE_ROOT}/qpu-chip-clean.webp` }),
    comparison: Object.freeze({
      caption: 'an eraser',
      image: `${COMPARISON_ROOT}/pencil.kiosk.jpg`
    })
  }),
  Object.freeze({
    id: 'qubit-array',
    kind: 'content',
    index: 3,
    timelineIndex: 4,
    number: '04',
    name: 'Qubit array',
    /* The card's heading, split the way the board draws it: the name at the
       title's own size and the qualifier under it at 36px. `name` stays the
       short label, because it also names the image for a screen reader and is
       read out with the size comparison, where the qualifier would not
       belong. */
    headline: 'Qubit array',
    subheadline: '(as captured by a scanning electron microscope)',
    description: 'This grid holds interconnected qubits smaller than a grain of salt. Pack this grid tighter and repeat it, and the path to a million-qubit machine comes into view.',
    dimension: Object.freeze({ label: '~3 mm', axis: 'horizontal' }),
    hero: Object.freeze({ image: `${NANOSCALE_ROOT}/qubit-array-clean.webp` }),
    comparison: Object.freeze({
      caption: 'a grain of salt',
      image: `${COMPARISON_ROOT}/AdobeStock_salt.kiosk.jpg`
    })
  }),
  Object.freeze({
    id: 'nanowire',
    kind: 'content',
    index: 4,
    timelineIndex: 5,
    number: '05',
    name: 'Nanowire',
    description: 'Microscopic, engineered wires that create the conditions to protect quantum information.',
    dimension: Object.freeze({ label: '~3 microns', axis: 'horizontal' }),
    hero: Object.freeze({ image: `${NANOSCALE_ROOT}/nanowire-clean.webp` }),
    comparison: Object.freeze({
      caption: 'a red blood cell',
      image: `${COMPARISON_ROOT}/AdobeStock_redbloodcell.kiosk.jpg`
    })
  })
])

export const NANOSCALE_V3_FINALE = Object.freeze([
  Object.freeze({
    id: 'scale',
    kind: 'finale',
    timelineIndex: 6,
    title: 'Scale without bulk',
    paragraphs: Object.freeze([
      'Other quantum systems grow into room-sized machines as you add qubits.',
      'With topological qubits, the machine barely changes size whether it holds one qubit or one million qubits.'
    ]),
    figure: Object.freeze({
      image: `${NANOSCALE_ROOT}/footprint-field.webp`,
      /* The same field reduced to 8-design-pixel blocks, which is what the
         board's "pixelated censor" is. It sits under the crisp field as the
         ground the count has not reached yet. */
      pixels: `${NANOSCALE_ROOT}/footprint-field-pixels.png`,
      marker: `${NANOSCALE_ROOT}/built-to-scale-marker.svg`,
      alt: 'A football field comparison showing the compact footprint of a topological quantum machine.',
      machineLabel: 'Microsoft Quantum machine',
      otherLabel: 'Other quantum systems'
    }),
    /* The count the screen climbs to, and the word beside it. The copy above
       promises "one million qubits", so this is the same number said twice. */
    counter: Object.freeze({ target: 1000000, unit: 'qubits' })
  })
])

export const NANOSCALE_V3_TIMELINE = Object.freeze([
  NANOSCALE_V3_SPLASH,
  ...NANOSCALE_V3_SEQUENCE,
  ...NANOSCALE_V3_FINALE
])

/* The last numbered specimen. The finale screen has no measurement, comparison
   card or scrubber tick of its own. */
export const NANOSCALE_LAST_CONTENT_STOP = NANOSCALE_V3_SEQUENCE.at(-1).timelineIndex

/* Shown on the last numbered specimen, where the sequence runs out and nothing
   on screen says the module carries on below it. It fades on the timeline's
   curve once the visitor takes it up. */
export const NANOSCALE_SCROLL_CUE = 'Keep scrolling'

/* The designer's reveal order: visual, identity, then measurement and comparison
   together. The stagger is meant to read as one cue arriving in parts, not as a
   queue to wait through, so it runs at about half its original length. */
export const NANOSCALE_V3_REVEAL = Object.freeze({
  visual: 0,
  identity: 150,
  measurement: 300
})

/* How long a gesture has to stop moving before the module treats it as over and
   snaps to its stop. Long enough not to fight a slow drag, short enough that a
   hand left resting on the glass after a pinch does not hold the copy back. */
export const NANOSCALE_HOLD_SNAP_MS = 220

/* How long the qubit count takes to run, and how coarsely it steps while it
   runs. The board shows it mid-flight at 550,000 — a round ten thousand — so it
   counts in ten thousands rather than ticking every last digit. */
export const NANOSCALE_COUNT_DURATION_MS = 3200
export const NANOSCALE_COUNT_STEP = 10000

/** The count and the fill share one 0..1 progress, eased so it settles rather than stops. */
export function nanoscaleCountState(elapsedMs, { target, reducedMotion = false } = {}) {
  const total = Number.isFinite(target) && target > 0 ? target : 0
  if (reducedMotion) return Object.freeze({ progress: 1, value: total })
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  const linear = Math.min(1, elapsed / NANOSCALE_COUNT_DURATION_MS)
  /* Ease out cubic: quick off the mark, so the field is visibly filling before
     the number has climbed far. */
  const progress = 1 - ((1 - linear) ** 3)
  /* Stepped while it runs, exact when it lands — otherwise it finishes on
     something like 998,000 and the copy above it reads as a lie. */
  const value = progress >= 1
    ? total
    : Math.min(total, Math.round((progress * total) / NANOSCALE_COUNT_STEP) * NANOSCALE_COUNT_STEP)
  return Object.freeze({ progress, value })
}

export function formatNanoscaleCount(value) {
  const safe = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
  return safe.toLocaleString('en-US')
}

/* Content lookup deliberately retains the pre-splash, zero-based API. */
export function nanoscaleStopAt(contentIndex) {
  const safeIndex = Number.isFinite(contentIndex) ? Math.round(contentIndex) : 0
  const clamped = Math.min(NANOSCALE_V3_SEQUENCE.length - 1, Math.max(0, safeIndex))
  return NANOSCALE_V3_SEQUENCE[clamped]
}

export function nanoscaleTimelineStopAt(timelineIndex) {
  const safeIndex = Number.isFinite(timelineIndex) ? Math.round(timelineIndex) : 0
  const clamped = Math.min(NANOSCALE_V3_TIMELINE.length - 1, Math.max(0, safeIndex))
  return NANOSCALE_V3_TIMELINE[clamped]
}

export function nanoscaleRevealState(elapsedMs) {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  return Object.freeze({
    visual: elapsed >= NANOSCALE_V3_REVEAL.visual,
    identity: elapsed >= NANOSCALE_V3_REVEAL.identity,
    measurement: elapsed >= NANOSCALE_V3_REVEAL.measurement
  })
}

/* Copy is hidden while moving; a position only counts as settled close to a timeline stop. */
export const NANOSCALE_SETTLED_EPSILON = 0.04

export function isNanoscaleSettled(progress) {
  if (!Number.isFinite(progress)) return false
  return NANOSCALE_V3_STOPS.some(stop => Math.abs(stop - progress) <= NANOSCALE_SETTLED_EPSILON)
}
