/*
 * Geometry and per-stop treatments for the seven-position nanoscale timeline.
 *
 * Coordinates are audited from the current Feedback / Copy Updates for Makeshift frames
 * (58:4672 and siblings), normalized from their 0.5232527852 canvas scale to the
 * 2160 x 3840 kiosk stage. The splash has its own full-stage layout at timeline index 0;
 * `NANOSCALE_LAYOUT` remains a five-entry, zero-based content array so existing
 * content-indexed lookups stay unambiguous.
 */

export const NANOSCALE_STAGE = Object.freeze({ width: 2160, height: 3840 })

const BLUE = '#0078D4'
const BLUE_LIGHT = '#8DC8E8'
const NAVY = '#2A446F'
const WHITE = '#FFFFFF'
/* Light glass for the scrubber plate, in the same family as the card fills. */
const PANEL_BLUE = '#E3EEF8'
/* User-directed balance correction shared with camera geometry for stops 02/03. */
const STOP_02_03_ALIGNMENT_X = -100

const box = (x, y, width, height) => Object.freeze({ x, y, width, height })
const point = (x, y) => Object.freeze({ x, y })
const fill = (color, opacity = 1) => Object.freeze({ color, opacity })
const stroke = (color, width = 4, align = 'inside') => Object.freeze({ color, width, align })
const line = (fromX, fromY, toX, toY) => Object.freeze({
  from: point(fromX, fromY),
  to: point(toX, toY)
})

const HARDWARE_SCALE_GRADIENT = Object.freeze([
  Object.freeze({ offset: 0, color: NAVY }),
  Object.freeze({ offset: 0.42, color: '#185998' }),
  Object.freeze({ offset: 0.6, color: '#1163AB' }),
  Object.freeze({ offset: 0.97, color: BLUE })
])

const IDENTITY_TITLE_TYPE = Object.freeze({
  fontSize: 60,
  fontWeight: 600,
  letterSpacing: '-0.02em',
  lineHeight: 80.267131
})

/* The qualifier under a heading. 36px is the board's value; the leading keeps
   the title's 1.338 ratio so the two stack on one rhythm. */
const IDENTITY_SUBTITLE_TYPE = Object.freeze({
  fontSize: 36,
  fontWeight: 600,
  letterSpacing: '-0.02em',
  lineHeight: 48
})

const IDENTITY_BODY_TYPE = Object.freeze({
  fontSize: 40,
  fontWeight: 400,
  letterSpacing: '-0.01em',
  lineHeight: 48
})

/* Type stays at the authored 60/40 on every stop. The cards are sized to their
   copy instead: heights below are 60 + title + 60 + body + 60, measured against
   the real face at the 500px column. `titleType`/`bodyType` remain overridable
   for a stop that ever needs to break from that. */
function identityCard({
  bodyHeight,
  bodyTop,
  bodyType = IDENTITY_BODY_TYPE,
  effectVisible = false,
  fillValue = null,
  glassBlur = 50,
  height,
  subtitleHeight = 0,
  subtitleType = IDENTITY_SUBTITLE_TYPE,
  titleHeight,
  titleType = IDENTITY_TITLE_TYPE
}) {
  return Object.freeze({
    box: box(1437.5, 666, 620, height),
    cornerRadius: 12,
    surface: Object.freeze({
      effectVisible,
      fill: fillValue,
      glassBlur,
      glassOffsetY: 4,
      refractionRadius: 20
    }),
    title: Object.freeze({
      box: box(60, 60, 500, titleHeight),
      type: titleType
    }),
    /* Sits directly under the title with no gap of its own — it reads as the
       second line of one heading, not as a separate block. Null on the stops
       that have no qualifier, so nothing is written for them. */
    subtitle: subtitleHeight
      ? Object.freeze({
          box: box(60, 60 + titleHeight, 500, subtitleHeight),
          type: subtitleType
        })
      : null,
    body: Object.freeze({
      box: box(60, bodyTop, 500, bodyHeight),
      type: bodyType
    })
  })
}

/* `y` moves the whole card, footer included. The identity card above it grows
   with its copy, and three stops now carry enough of it to reach past 1333 —
   so rather than squeezing the type, the comparison card steps down out of the
   way. Its internals are all measured from `y` for that reason; they used to be
   absolute, which is what made the card unmovable. */
function comparisonCard({ effectVisible = false, y = 1333 } = {}) {
  const FOOTER_OFFSET = 666
  return Object.freeze({
    box: box(1439, y, 613, 828),
    captionColor: NAVY,
    fill: fill(WHITE, 0.6),
    shadow: Object.freeze({
      x: 0,
      y: 20,
      blur: 60,
      color: 'rgb(122 165 199 / 0.2)'
    }),
    surface: Object.freeze({
      effectVisible,
      glassBlur: 40,
      glassOffsetY: 4,
      refractionRadius: 20
    }),
    media: Object.freeze({
      box: box(1439, y, 613, 662),
      fill: null,
      stroke: stroke(BLUE, 2, 'outside'),
      strokeOpacity: 0.2,
      cornerRadii: Object.freeze([12, 12, 0, 0])
    }),
    footer: Object.freeze({
      box: box(1439, y + FOOTER_OFFSET, 613, 162),
      fill: null,
      stroke: stroke(BLUE, 2, 'outside'),
      strokeOpacity: 0.2,
      cornerRadii: Object.freeze([0, 0, 0, 0]),
      type: Object.freeze({
        fontSize: 40,
        fontWeight: 600,
        letterSpacing: '0',
        lineHeight: 53.5114
      })
    })
  })
}

/*
 * `scrim` backs the track where the artwork behind it is photographic. On the
 * SEM stops no single ink reads across the whole band -- stop 05's background
 * runs from luminance 41 in the gaps to 189 on the bright wire traces -- so the
 * track is given its own ground instead. It is light rather than dark so the
 * widget can keep the navy selection ink every other stop uses; a dark plate
 * put navy at 1.01:1 against it. Strength and blur are interpolated against the
 * zoom in index.js rather than switched on arrival.
 */
const SCRUBBER_PHOTO_SCRIM = Object.freeze({
  fill: fill(PANEL_BLUE, 0.5),
  blur: 20
})

function scrubberTreatment({
  activeIndex,
  trackColor,
  activeColor,
  numberBox,
  scrim = null
}) {
  return Object.freeze({
    activeIndex,
    trackColor,
    inactiveTickColor: trackColor,
    activeTickColor: activeColor,
    markerColor: activeColor,
    numberColor: activeColor,
    numberBox,
    scrim,
    strokeWidth: 4
  })
}

/*
 * Measurement labels sit in a break in the dimension line rather than on a plate
 * over it, so the span reads as two arrows pointing away from the number. The
 * label is centred on its span at draw time, which is why no position is
 * authored here: only the text width, which sizes a break along a horizontal
 * span, and the ink colour survive from the Figma node.
 */
function measurementLabel({ textWidth, color }) {
  return Object.freeze({ textWidth, color })
}

/*
 * Figma's label boxes were sized around the retired backing plate, so their
 * heights are not text metrics. A vertical break is measured from the display
 * line box instead; a horizontal one from the authored text width, which is
 * real. Both keep a little air between the number and the arrowheads.
 */
const LABEL_GAP_PADDING = 8
const LABEL_LINE_HEIGHT = 64

function labelGapFor(axis, label) {
  const extent = axis === 'horizontal' ? label.textWidth : LABEL_LINE_HEIGHT
  return extent + (LABEL_GAP_PADDING * 2)
}

function annotation({
  axis,
  from,
  to,
  extend,
  extensions,
  color,
  label,
  spanGradient = null
}) {
  return Object.freeze({
    axis,
    from,
    to,
    /* Retained as a coarse fallback; `extensions` contains the exact asymmetric raw lines. */
    extend,
    extensions: Object.freeze(extensions),
    color,
    labelGap: labelGapFor(axis, label),
    extensionColor: color,
    spanColor: color,
    spanGradient,
    arrowColors: spanGradient
      ? Object.freeze({ from: spanGradient[0].color, to: spanGradient.at(-1).color })
      : Object.freeze({ from: color, to: color }),
    strokeWidth: 4,
    dashPattern: Object.freeze([5, 9]),
    arrow: Object.freeze({ style: 'equilateral', size: 20 }),
    label
  })
}

/*
 * The five ticks are the zoom's scientific scale steps, on their authored 277px rhythm.
 * The finale deliberately does not extend this control.
 */
export const NANOSCALE_SCRUBBER = Object.freeze({
  x: 499,
  /* Lifted a fifth of the stage (768px of 3840) off the authored 3470, which
     sat far enough down the panel to be out of comfortable reach. */
  y: 2852,
  width: 1109,
  height: 155,
  trackY: 82,
  tickTop: 65,
  tickHeight: 30,
  tickOffsets: Object.freeze([0, 277, 554, 831, 1108]),
  markerTop: 120,
  markerSize: 35,
  strokeWidth: 4
})

export const NANOSCALE_SPLASH_LAYOUT = Object.freeze({
  sourceFrameId: '58:4672',
  timelineIndex: 0,
  subject: box(0, 0, 2160, 3840),
  fit: 'contain',
  anchor: 'center top',
  ui: Object.freeze({
    /*
     * Figma authored this block at y=2120 against a splash plate that only
     * reached partway down the frame. The delivered vertical room fills it, so
     * the cryostat now hangs 280px lower and the panel's top edge cut straight
     * through the gold tip and the package on the end of it -- the one thing on
     * this screen the visitor is about to zoom into.
     *
     * The whole block moves down 200px, which clears the tip with room to
     * spare and still stops above the base plinth. Everything below is line
     * art the glass reads over comfortably; the scroll prompt at y=3250 does
     * not move and keeps its own space.
     */
    intro: Object.freeze({
      box: box(480, 2320, 1200, 774.7781),
      explainerBox: box(480, 2320, 1200, 649.1137),
      title: Object.freeze({
        box: box(583.1083, 2380, 993.7835, 128.0452),
        type: Object.freeze({
          fontSize: 96,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          lineHeight: 127.6875
        })
      }),
      body: Object.freeze({
        box: box(640, 2588.0452, 880, 321.0685),
        type: Object.freeze({
          fontSize: 60,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          lineHeight: 80.2671
        })
      }),
      instruction: Object.freeze({
        /* Pushed clear of the title/body block so the prompt reads as its own
           call to action in the empty lower half rather than as more copy. */
        box: box(858.7992, 3250, 442.4022, 91.7781),
        padding: Object.freeze({ x: 32, y: 22 }),
        type: Object.freeze({
          fontSize: 36,
          fontWeight: 600,
          letterSpacing: '0',
          lineHeight: 47.7781
        })
      })
    })
  })
})

export const NANOSCALE_LAYOUT = Object.freeze([
  Object.freeze({
    sourceFrameId: '58:4926',
    timelineIndex: 1,
    subject: box(255, 0, 1030, 2718),
    fit: 'cover',
    anchor: 'center bottom',
    annotation: annotation({
      axis: 'vertical',
      from: point(111, 123),
      to: point(111, 2719),
      extend: 696,
      extensions: {
        from: line(111, 123, 2707, 123),
        to: line(112, 2721, 807, 2721)
      },
      color: NAVY,
      spanGradient: HARDWARE_SCALE_GRADIENT,
      label: measurementLabel({ textWidth: 106, color: NAVY })
    }),
    ui: Object.freeze({
      identity: identityCard({
        height: 452,
        titleHeight: 80,
        bodyTop: 200,
        bodyHeight: 192,
        effectVisible: false,
        fillValue: null,
        glassBlur: 50
      }),
      comparison: comparisonCard(),
      scrubber: scrubberTreatment({
        activeIndex: 0,
        trackColor: BLUE_LIGHT,
        activeColor: NAVY,
        numberBox: box(481, 3470, 35, 48)
      })
    })
  }),
  Object.freeze({
    sourceFrameId: '58:5197',
    timelineIndex: 2,
    subject: box(301 + STOP_02_03_ALIGNMENT_X, 0, 1180, 2213),
    fit: 'cover',
    anchor: 'center bottom',
    /* The span measures the package plate's frame, top edge to bottom edge. It
       was authored at 1274..2218 against the retired plate; the plate is now
       fitted onto the package the chandelier renders at the arm's tip (see
       MAJORANA_ART_BOX) and spans 1264..2199, so the bracket follows it. */
    annotation: annotation({
      axis: 'vertical',
      from: point(221 + STOP_02_03_ALIGNMENT_X, 1264),
      to: point(221 + STOP_02_03_ALIGNMENT_X, 2197),
      extend: 223,
      extensions: {
        from: line(222 + STOP_02_03_ALIGNMENT_X, 1264, 444 + STOP_02_03_ALIGNMENT_X, 1264),
        to: line(222 + STOP_02_03_ALIGNMENT_X, 2199, 444 + STOP_02_03_ALIGNMENT_X, 2199)
      },
      color: NAVY,
      spanGradient: HARDWARE_SCALE_GRADIENT,
      label: measurementLabel({ textWidth: 159.956, color: NAVY })
    }),
    ui: Object.freeze({
      identity: identityCard({
        height: 692,
        titleHeight: 80,
        bodyTop: 200,
        bodyHeight: 432,
        effectVisible: false,
        fillValue: null,
        glassBlur: 50
      }),
      comparison: comparisonCard({ y: 1423 }),
      scrubber: scrubberTreatment({
        activeIndex: 1,
        trackColor: BLUE_LIGHT,
        activeColor: NAVY,
        numberBox: box(756, 3470, 39, 48)
      })
    })
  }),
  Object.freeze({
    sourceFrameId: '58:5475',
    timelineIndex: 3,
    subject: box(0, 0, 2160, 3840),
    fit: 'cover',
    annotation: annotation({
      axis: 'vertical',
      from: point(277 + STOP_02_03_ALIGNMENT_X, 1553),
      to: point(277 + STOP_02_03_ALIGNMENT_X, 1886),
      extend: 333,
      extensions: {
        from: line(278 + STOP_02_03_ALIGNMENT_X, 1553, 610 + STOP_02_03_ALIGNMENT_X, 1553),
        to: line(278 + STOP_02_03_ALIGNMENT_X, 1886, 610 + STOP_02_03_ALIGNMENT_X, 1886)
      },
      color: WHITE,
      label: measurementLabel({ textWidth: 203.468, color: WHITE })
    }),
    ui: Object.freeze({
      identity: identityCard({
        /* "Qubit chip" is one line where "Quantum processing unit (QPU) chip"
           was three, so the card comes back down and the comparison card below
           it returns to its authored 1333. */
        height: 596,
        titleHeight: 80,
        bodyTop: 200,
        bodyHeight: 336,
        effectVisible: true,
        fillValue: fill(WHITE, 0.6),
        glassBlur: 80
      }),
      comparison: comparisonCard({ effectVisible: true }),
      scrubber: scrubberTreatment({
        activeIndex: 2,
        trackColor: BLUE,
        activeColor: NAVY,
        numberBox: box(1033, 3470, 39, 48),
        scrim: SCRUBBER_PHOTO_SCRIM
      })
    })
  }),
  Object.freeze({
    sourceFrameId: '58:4395',
    timelineIndex: 4,
    subject: box(0, 0, 2160, 3840),
    fit: 'cover',
    annotation: annotation({
      axis: 'horizontal',
      from: point(562, 2013),
      to: point(895, 2013),
      extend: 274,
      extensions: {
        from: line(562, 1739, 562, 2013),
        to: line(895, 1739, 895, 2004)
      },
      color: NAVY,
      label: measurementLabel({ textWidth: 200.534, color: NAVY })
    }),
    ui: Object.freeze({
      identity: identityCard({
        /* The heading is a name plus a qualifier rather than a label: one line
           at 60 with two at 36 under it, over seven of body. That is 306px less
           than the six-line-at-60 heading it replaced, so the card and the
           comparison card below it both come back up. */
        height: 692,
        titleHeight: 80,
        subtitleHeight: 96,
        bodyTop: 296,
        bodyHeight: 336,
        effectVisible: true,
        fillValue: fill(WHITE, 0.6),
        glassBlur: 80
      }),
      comparison: comparisonCard({ effectVisible: true, y: 1423 }),
      scrubber: scrubberTreatment({
        activeIndex: 3,
        /* Was off-white, which was how this stop held its own against dark
           artwork with nothing behind the track. The plate is the better answer
           to the same problem, and on light blue the off-white all but
           disappeared — so this joins 03 and 05 on the deeper blue. */
        trackColor: BLUE,
        activeColor: NAVY,
        numberBox: box(1311, 3470, 39, 48),
        scrim: SCRUBBER_PHOTO_SCRIM
      })
    })
  }),
  Object.freeze({
    sourceFrameId: '58:5749',
    timelineIndex: 5,
    subject: box(0, 0, 2160, 3840),
    fit: 'cover',
    annotation: annotation({
      axis: 'horizontal',
      from: point(499, 2104.7032165527344),
      to: point(1220, 2104.7032165527344),
      extend: 306.7032165527344,
      extensions: {
        from: line(499, 1798, 499, 2104.7032165527344),
        to: line(1220, 1798, 1220, 2094.6290283203125)
      },
      color: WHITE,
      label: measurementLabel({ textWidth: 296.09, color: WHITE })
    }),
    ui: Object.freeze({
      identity: identityCard({
        height: 452,
        titleHeight: 80,
        bodyTop: 200,
        bodyHeight: 192,
        effectVisible: true,
        fillValue: fill(WHITE, 0.6),
        glassBlur: 80
      }),
      comparison: comparisonCard({ effectVisible: true }),
      scrubber: scrubberTreatment({
        activeIndex: 4,
        /* The plate here is light blue, so the track takes the deeper blue
           rather than the light one the white-stage stops use. */
        trackColor: BLUE,
        activeColor: NAVY,
        numberBox: box(1588, 3470, 39, 48),
        scrim: SCRUBBER_PHOTO_SCRIM
      })
    })
  })
])

/* Full-stage frame 921:1312, the module's one closing screen. */
export const NANOSCALE_FINALE_LAYOUT = Object.freeze({
  timelineIndices: Object.freeze([6]),
  track: box(0, 0, 2160, 3840),
  pullback: Object.freeze({ scale: 0.34, fade: 1 }),
  sections: Object.freeze([
    Object.freeze({
      id: 'scale',
      /* The only section, so it sits at the head of the track and the track's
         travel alone brings it on. */
      offsetY: 0,
      background: WHITE,
      guide: box(1070, 0, 20, 470),
      copy: box(520, 500, 1120, 908),
      headingTop: 580,
      paragraphTops: Object.freeze([848, 1088]),
      field: box(1305, 2058, 673, 323),
      marker: box(600, 2176, 20, 20),
      count: box(750, 1500, 660, 128),
      machineLabel: box(366, 1836, 494, 53),
      otherLabel: box(1425, 1836, 414, 53),
      divider: box(1080, 1920, 1, 625)
    })
  ])
})

/* Finale progress clamps to the final scientific treatment; no sixth marker exists. */
export function nanoscaleTimelineScrubberAt(timelineIndex) {
  const safeIndex = Number.isFinite(timelineIndex) ? Math.round(timelineIndex) : 1
  const clamped = Math.min(NANOSCALE_LAYOUT.length, Math.max(1, safeIndex))
  return NANOSCALE_LAYOUT[clamped - 1].ui.scrubber
}

export function nanoscaleLayoutAt(contentIndex) {
  const safeIndex = Number.isFinite(contentIndex) ? Math.round(contentIndex) : 0
  const clamped = Math.min(NANOSCALE_LAYOUT.length - 1, Math.max(0, safeIndex))
  return NANOSCALE_LAYOUT[clamped]
}

export function nanoscaleTimelineLayoutAt(timelineIndex) {
  const safeIndex = Number.isFinite(timelineIndex) ? Math.round(timelineIndex) : 0
  const clamped = Math.min(NANOSCALE_LAYOUT.length + 1, Math.max(0, safeIndex))
  if (clamped === 0) return NANOSCALE_SPLASH_LAYOUT
  if (clamped > NANOSCALE_LAYOUT.length) return NANOSCALE_FINALE_LAYOUT
  return NANOSCALE_LAYOUT[clamped - 1]
}

export function nanoscaleAnnotationLength(annotationValue) {
  if (!annotationValue) return 0
  return Math.hypot(
    annotationValue.to.x - annotationValue.from.x,
    annotationValue.to.y - annotationValue.from.y
  )
}

export const NANOSCALE_ZOOM_PER_STOP = 2.8

/*
 * Plates retain content indices 0-4, while progress is now on the seven-position timeline.
 * Adding one here places content plate 0 at timeline stop 1 without renumbering content data.
 */
export function nanoscalePlateTransform(contentIndex, timelineProgress) {
  const safeContentIndex = Number.isFinite(contentIndex) ? contentIndex : 0
  const progress = Number.isFinite(timelineProgress) ? timelineProgress : 0
  const distance = progress - (safeContentIndex + 1)
  const scale = Math.pow(NANOSCALE_ZOOM_PER_STOP, distance)
  const opacity = Math.max(0, 1 - Math.abs(distance))
  const visible = opacity > 0
  return Object.freeze({ distance, opacity, scale, visible })
}
