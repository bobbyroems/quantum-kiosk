/*
 * Top narrative cards for Interference.
 *
 * Layout and diagram assets come from the
 * authored Interference frames; copy follows the final content document. The three
 * diagrams are the delivered animated clips, prepared by
 * scripts/prepare-panel-video.mjs.
 */

import {
  createKioskExplainer,
  disposeKioskExplainer
} from '../../core/kiosk-explainer.js'

const TOOLTIP_ASSET_ROOT = '/assets/modules/differences/interference-tooltips'

/* The three diagrams are delivered as animated clips. Each one draws its wave
   from an empty axis and clears back to it, so it returns to its own first
   frame and loops without the crossfade the one-shot panel clips need — see
   scripts/prepare-panel-video.mjs. The constructive and destructive panels come
   from a single master that draws both in sequence, cut on the blank frame
   between them. */
function graphic(filename, width, height, alt) {
  return Object.freeze({
    alt,
    height,
    src: `${TOOLTIP_ASSET_ROOT}/${filename}`,
    type: 'video',
    width
  })
}

export const LESSON_COPY = Object.freeze({
  intro: Object.freeze({
    body: 'Quantum computers use waves to increase the likelihood of some outcomes and reduce the likelihood of others.',
    bodyHtml: 'Quantum computers use waves to <strong>increase</strong> the likelihood of some outcomes and <strong>reduce</strong> the likelihood of others.',
    continue: false,
    graphic: null,
    title: 'Quantum interference'
  }),
  one: Object.freeze({
    body: 'Each wave is a quantum instruction that affects many possible outcomes at once.',
    bodyHtml: 'Each wave is a <strong>quantum instruction</strong> that affects many possible outcomes at once.',
    continue: true,
    graphic: graphic(
      'wave-probability.webm',
      808,
      639,
      'A probability wave rising from a horizontal axis.'
    ),
    title: 'Sea of probabilities'
  }),
  bridge: Object.freeze({
    body: 'One wave can change probabilities, but it takes more to make the outcome stand out.',
    bodyHtml: 'One wave can change probabilities, but it takes more to make the outcome stand out.',
    continue: false,
    graphic: null,
    title: ''
  }),
  constructive: Object.freeze({
    body: 'When waves meet, they combine and will amplify, or cancel each other out. This interference shifts the likelihood of different outcomes.',
    bodyHtml: 'When waves meet, they combine and will <strong>amplify</strong>, or <strong>cancel</strong> each other out. This interference shifts the likelihood of different outcomes.',
    continue: true,
    graphic: graphic(
      'constructive-interference.webm',
      800,
      639,
      'Aligned waves combining into constructive interference.'
    ),
    title: 'Interference'
  }),
  destructive: Object.freeze({
    body: 'When waves meet, they combine and will amplify, or cancel each other out. This interference shifts the likelihood of different outcomes.',
    bodyHtml: 'When waves meet, they combine and will <strong>amplify</strong>, or <strong>cancel</strong> each other out. This interference shifts the likelihood of different outcomes.',
    continue: true,
    graphic: graphic(
      'destructive-interference.webm',
      800,
      639,
      'Opposing waves combining into destructive interference.'
    ),
    title: 'Interference'
  }),
  add: Object.freeze({
    body: 'As more waves interact, interference strengthens promising outcomes while reducing less likely ones.',
    bodyHtml: 'As more waves interact, interference <strong>strengthens promising outcomes</strong> while reducing less likely ones.',
    continue: false,
    graphic: null,
    title: 'Add more waves'
  })
})

function authoredBodyContent(html) {
  /* `bodyHtml` is a closed set of local authored strings. Parsing stays in the
     Interference adapter; the shared component only accepts safe DOM content. */
  const template = document.createElement('template')
  template.innerHTML = html
  return template.content
}

function createLessonPanel(key, copy) {
  const panel = createKioskExplainer({
    bodyAriaLabel: copy.body,
    bodyContent: authoredBodyContent(copy.bodyHtml),
    className: [
      'qvc-interference__lesson-panel',
      copy.graphic ? 'qvc-interference__lesson-panel--graphic' : ''
    ].filter(Boolean).join(' '),
    layout: copy.graphic ? 'split' : 'stacked',
    media: copy.graphic,
    title: copy.title,
    visible: true
  })
  panel.element.dataset.lessonStage = key
  panel.element.hidden = key !== 'intro'
  panel.copy.classList.add('qvc-interference__lesson-copy')
  panel.title.classList.add('qvc-interference__tooltip-title')
  panel.body.classList.add('qvc-interference__tooltip-description')
  panel.media.classList.add('qvc-interference__lesson-visual')
  return panel
}

/**
 * Starts the active panel's clip and stops every other one.
 *
 * The lesson switches panels by toggling `hidden` on them directly rather than
 * through the explainer's own visibility API, so the component's play-on-show
 * never fires here. Each clip is also rewound: a panel the visitor returns to
 * should draw its wave again from the empty axis rather than resume wherever it
 * was stopped, and its first frame is that empty axis, so a paused clip left
 * mid-animation would otherwise be the still they see.
 *
 * @param {Element} lesson root returned by createInterferenceLesson
 * @param {string|null} key active panel's stage key, null to stop all
 */
export function setLessonPlayback(lesson, key) {
  for (const panel of lesson.querySelectorAll('[data-lesson-stage]')) {
    const video = panel.querySelector('video')
    if (!video) continue
    if (panel.dataset.lessonStage === key) {
      video.currentTime = 0
      video.play().catch(() => {})
    } else {
      video.pause()
    }
  }
}

/* Keyed on the lesson root so the game hands the whole thing back on teardown
   rather than carrying seven explainer handles through its own state. */
const lessonPanels = new WeakMap()

export function createInterferenceLesson() {
  const lesson = document.createElement('section')
  lesson.className = 'qvc-interference__lesson'
  lesson.dataset.lesson = ''
  lesson.hidden = true
  lesson.setAttribute('aria-hidden', 'true')
  lesson.toggleAttribute('inert', true)
  lesson.inert = true
  const panels = Object.entries(LESSON_COPY).map(([key, copy]) => (
    createLessonPanel(key, copy)
  ))
  lesson.append(...panels.map(panel => panel.element))
  lessonPanels.set(lesson, panels)
  return lesson
}

/**
 * Releases the three panel clips. Taking the lesson out of the DOM does not:
 * Chromium keeps the decoder alive behind a detached <video> until the element
 * is collected, so a visitor replaying Interference builds up a backlog of
 * loaded clips. Every other module in the kiosk releases its media explicitly
 * (see core/media-lifecycle.js); this is how Interference joins them.
 *
 * @param {Element} lesson root returned by createInterferenceLesson
 */
export function disposeInterferenceLesson(lesson) {
  const panels = lessonPanels.get(lesson)
  if (!panels) return
  lessonPanels.delete(lesson)
  panels.forEach(disposeKioskExplainer)
}
