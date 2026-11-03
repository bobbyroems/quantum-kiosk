import { NANOSCALE_FINALE_LAYOUT, NANOSCALE_STAGE } from './nanoscale-layout.js'

const FINALE_START = 5
/* The finale's one reading. Exported because the gesture layer settles onto it
   by name rather than by the bare 6 it used to carry. */
export const NANOSCALE_FINALE_SCALE_STOP = 6
const SCALE_STOP = NANOSCALE_FINALE_SCALE_STOP

const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))

function revealAtViewportEntry(sectionOffset, elementTop, trackY) {
  const currentTop = sectionOffset + elementTop + trackY
  const travel = Math.max(1, NANOSCALE_STAGE.height - elementTop)
  return clamp01((NANOSCALE_STAGE.height - currentTop) / travel)
}

/* Each paragraph simply reveals as it enters. It used to be dimmed by 30% of
   the following paragraph's reveal, which belonged to the scrolling finale:
   the reader moved down through several screens and the copy behind them
   stepped back. With one settled screen the two paragraphs are read together
   and nothing scrolls past, so that factor never recovered -- it parked the
   first paragraph at 0.7 against the second's 1.0 for as long as the frame was
   on screen, which read as a lighter weight rather than as depth. */
function sectionSample(section, trackY) {
  const heading = revealAtViewportEntry(section.offsetY, section.headingTop, trackY)
  const paragraphs = section.paragraphTops.map(top => (
    revealAtViewportEntry(section.offsetY, top, trackY)
  ))
  return { heading, paragraphs }
}

/**
 * Pure scroll-linked state for the authored finale frame. The same progress
 * always produces the same output, regardless of travel direction or release history.
 */
export function sampleNanoscaleFinale(timelineProgress) {
  const progress = Math.min(SCALE_STOP, Math.max(FINALE_START,
    Number.isFinite(timelineProgress) ? timelineProgress : FINALE_START))
  /* One screen, so the track only has to travel the stage's own height: it
     slides up into view across 5 -> 6 and stops there. */
  const entryProgress = clamp01(progress - FINALE_START)
  const trackY = (1 - entryProgress) * NANOSCALE_STAGE.height
  const [scaleLayout] = NANOSCALE_FINALE_LAYOUT.sections
  const scaleBase = sectionSample(scaleLayout, trackY)
  const scale = Object.freeze({
    heading: clamp01(scaleBase.heading),
    paragraphs: Object.freeze(scaleBase.paragraphs.map(clamp01)),
    figure: clamp01(revealAtViewportEntry(scaleLayout.offsetY, scaleLayout.field.y, trackY))
  })
  return Object.freeze({
    progress,
    entryProgress,
    trackY,
    scale
  })
}

