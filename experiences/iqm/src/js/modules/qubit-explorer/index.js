import { assetUrl } from '../../core/asset-url.js'
import {
  createKioskExplainer,
  disposeKioskExplainer,
  updateKioskExplainer
} from '../../core/kiosk-explainer.js'
import {
  createKioskTooltip,
  updateKioskTooltip
} from '../../core/kiosk-tooltip.js'
import { sound } from '../../core/kiosk-audio.js'
import { createQubitScene } from './qubit-scene.js'
import { mountModuleOutro } from '../module-outro.js'
import {
  createQubitExplorerState,
  isQubitSemiconductorVisible,
  QUBIT_MATERIAL_STEPS,
  reduceQubitExplorerState
} from './qubit-state.js'

/*
 * The two material lessons share the authored panel structure and artwork.
 * Keeping both in the shared explainer makes their sequence read as one lesson
 * while each introduced 3D material remains visible below.
 */
const SUPERCONDUCTOR_LEAD = 'A material that, when made cold enough, lets electricity flow freely.'
const SUPERCONDUCTOR_DETAIL = 'At super cold temperatures, electrons in a superconductor slow down and move in a flawless, orderly flow — exactly what our qubit needs.'
const SEMICONDUCTOR_LEAD = 'A material that acts like an on/off switch for electricity.'
const SEMICONDUCTOR_DETAIL = 'That switch is the reason semiconductors run the modern world. Every phone, laptop, and game console is built from billions of these tiny switches flipping on and off. A semiconductor steers electrons one at a time, guiding them precisely where you want them to go.'

/* One string for both the initial markup and the re-render that follows, which
   held their own copies of it before.
 *
 * The first break is stated rather than left to the wrap. Nothing here is a
 * webfont -- there is no @font-face in the build -- so where the line falls is
 * whatever font the machine resolved, and it differed: the kiosk's Segoe Sans
 * Display fitted "naturally" onto the first line where the Inter and Helvetica
 * fallbacks did not. Breaking after "occur" is the shorter of the two, which
 * is why it is the one to force -- it clears the 1080 column in every font in
 * the stack, so the paragraph holds its shape wherever it runs rather than
 * gaining a line on the machines that cannot fit the longer opener. */
const TOPOCONDUCTOR_INTRO_BODY = 'A topoconductor doesn’t occur <br>naturally — you build it. '
  + 'Stacked with perfect precision, Microsoft layers a semiconductor onto a '
  + 'superconductor. The two together do something neither can do alone.'

const INTRO_TO_PANEL_DELAY_MS = 520
const MATERIAL_PANEL_SWAP_DELAY_MS = 320
const PANEL_TO_BUILD_COPY_DELAY_MS = 320
const END_COPY_EXIT_MS = 260

/* The board closes this module on three screens rather than one (Figma
   11:12587, Screens D and E): the pair have joined and are named, then the
   material is named, then what it still needs is added underneath and the band
   arrives. Showing them together is what had the callout, the title and both
   paragraphs stacked on the same spot. */
const END_SCREENS = Object.freeze([
  Object.freeze({
    id: 'result',
    title: '',
    one: 'When engineered to work together, a semiconductor and superconductor can behave differently than either material alone.',
    two: 'The result is a topoconductor.',
    foot: '',
    holdMs: 0
  }),
  Object.freeze({
    id: 'named',
    title: 'Topoconductor: a new state of matter',
    one: 'Topoconductors do not occur naturally. Microsoft engineered this material to create the foundation for topological qubits.',
    two: '',
    foot: '',
    holdMs: 3400
  }),
  Object.freeze({
    id: 'conditions',
    title: 'Topoconductor: a new state of matter',
    one: 'Topoconductors do not occur naturally. Microsoft engineered this material to create the foundation for topological qubits.',
    two: '',
    foot: 'Creating the material is only the beginning. The topoconductor only switches on when you tune it just right.',
    holdMs: 1800,
    offerAfterHold: true
  })
])

const MATERIAL_PANEL_CONTENT = Object.freeze({
  [QUBIT_MATERIAL_STEPS.SUPERCONDUCTOR]: Object.freeze({
    detail: SUPERCONDUCTOR_DETAIL,
    lead: SUPERCONDUCTOR_LEAD,
    title: 'Superconductor'
  }),
  [QUBIT_MATERIAL_STEPS.SEMICONDUCTOR]: Object.freeze({
    detail: SEMICONDUCTOR_DETAIL,
    lead: SEMICONDUCTOR_LEAD,
    title: 'Semiconductor'
  })
})

/* Each material now shows its own clip. Until these were delivered both panels
   shared one still borrowed from the interference tooltips in module 01, so a
   wave chart appeared under the Superconductor heading and again, unchanged,
   under Semiconductor.

   The masters are one-shot animations; scripts/prepare-inset-video.mjs wraps
   them with a circular crossfade so `loop` has no visible seam. */
const PANEL_GRAPHIC = Object.freeze({
  [QUBIT_MATERIAL_STEPS.SUPERCONDUCTOR]: Object.freeze({
    alt: 'A cube levitating above a chilled plate.',
    src: 'assets/modules/qubit-explorer/superconductor-inset.mp4',
    type: 'video'
  }),
  [QUBIT_MATERIAL_STEPS.SEMICONDUCTOR]: Object.freeze({
    alt: 'A silicon die at the centre of a circuit board.',
    src: 'assets/modules/qubit-explorer/semiconductor-inset.mp4',
    type: 'video'
  })
})

function panelGraphic(materialStep) {
  const graphic = PANEL_GRAPHIC[materialStep]
  return graphic ? { ...graphic, src: assetUrl(graphic.src) } : null
}

/* The body is two paragraphs, but the shared explainer's body IS a <p>, so the
   parts are block-level spans rather than nested paragraphs. */
function panelBodyContent(lead, detail) {
  const fragment = document.createDocumentFragment()
  for (const [index, text] of [lead, detail].entries()) {
    const paragraph = document.createElement('span')
    paragraph.className = index === 0
      ? 'qe__panel-lead'
      : 'qe__panel-detail'
    paragraph.textContent = text
    fragment.append(paragraph)
  }
  return fragment
}

function createMaterialPanel() {
  const initialContent = MATERIAL_PANEL_CONTENT[QUBIT_MATERIAL_STEPS.SUPERCONDUCTOR]
  return createKioskExplainer({
    bodyAriaLabel: `${initialContent.lead} ${initialContent.detail}`,
    bodyContent: panelBodyContent(initialContent.lead, initialContent.detail),
    className: 'qe__panel',
    layout: 'split',
    media: panelGraphic(QUBIT_MATERIAL_STEPS.SUPERCONDUCTOR),
    title: initialContent.title,
    variant: 'solid',
    visible: false
  })
}

function calloutMarkup(id, title, copy) {
  return `
    <article
      class="qe__callout qe__callout--${id}"
      data-qe-callout="${id}"
      aria-hidden="true"
    >
      <span class="qe__callout-anchor" aria-hidden="true">
        <span class="qe__callout-line qe__callout-line--horizontal"></span>
        <span class="qe__callout-line qe__callout-line--vertical"></span>
      </span>
      <p class="qe__callout-title">${title}</p>
      <p class="qe__callout-copy">${copy}</p>
    </article>
  `
}

function moduleMarkup() {
  const microsoftLogo = assetUrl('assets/ui/microsoft-logo.png')
  const restartIcon = assetUrl('assets/ui/restart.svg')
  const exitIcon = assetUrl('assets/ui/exit-x.svg')

  return `
    <section class="qe" data-qe-root data-phase="intro" data-intro="dismissed" aria-labelledby="qe-title">
      <header class="microsoft-header qe__header">
        <div class="microsoft-brand" aria-label="Microsoft Quantum">
          <span class="microsoft-brand__logo" aria-hidden="true">
            <img src="${microsoftLogo}" alt="" draggable="false">
          </span>
          <span class="microsoft-brand__divider" aria-hidden="true"></span>
          <span class="microsoft-brand__quantum">Quantum</span>
        </div>

        <div class="microsoft-header__actions">
          <button class="microsoft-header__action" type="button" data-qe-action="restart">
            <span>Restart</span>
            <span class="microsoft-header__action-icon" aria-hidden="true">
              <img src="${restartIcon}" alt="" draggable="false">
            </span>
          </button>
          <button class="microsoft-header__action" type="button" data-qe-action="exit">
            <span>Exit</span>
            <span class="microsoft-header__action-icon" aria-hidden="true">
              <img src="${exitIcon}" alt="" draggable="false">
            </span>
          </button>
        </div>
      </header>

      <div class="qe__experience">
        <h1 class="qe__sr-only" id="qe-title">Build a topoconductor</h1>

        <div class="qe__intro" data-qe-intro aria-hidden="true">
          <div class="qe__intro-copy">
            <h2>Two materials, one new state of matter.</h2>
            <p>${TOPOCONDUCTOR_INTRO_BODY}</p>
          </div>
        </div>

        <div class="qe__scene" data-qe-scene></div>
        <div class="qe__ambient-wash" aria-hidden="true"></div>

        <!-- Material education uses the shared explainer panels built below.
             This anchored label is reserved for the completed 3D material. -->

        <button
          class="qe__continue"
          type="button"
          data-qe-continue
          aria-label="Continue to the next explanation"
          hidden
        ></button>

        <section class="qe__tuning" data-qe-tuning aria-hidden="true">
          <div class="qe__tuning-copy">
            <p class="qe__tuning-title" data-qe-end-title hidden></p>
            <p class="qe__tuning-description" data-qe-end-one></p>
            <p class="qe__tuning-description" data-qe-end-two hidden></p>
          </div>
          <!-- Only the closing screen's last paragraph goes under the material.
               The others belong with the copy above it. -->
          <p class="qe__tuning-footnote" data-qe-end-foot aria-hidden="true"></p>
        </section>

        <p class="qe__status qe__sr-only" data-qe-status aria-live="polite">
          Introducing the two materials.
        </p>
      </div>
    </section>
  `
}

function createAbortError() {
  return new DOMException('Qubit Explorer mount was aborted', 'AbortError')
}

export async function mount(container, options = {}) {
  if (!container?.replaceChildren) throw new TypeError('Qubit Explorer requires a DOM container')

  const { signal, onActivity, navigate = {}, module } = options
  if (signal?.aborted) throw createAbortError()

  const screen = document.createElement('div')
  screen.innerHTML = moduleMarkup().trim()
  const root = screen.firstElementChild

  /* Offered once the topoconductor is made, so the visitor can carry straight
     on instead of going back out to the carousel. The registry decides what
     follows, so the run order stays in one place. */
  /* The band states where the visitor is, then follows the registry route. */
  const upNextBanner = mountModuleOutro({
    module,
    root,
    navigate,
    /* Wrapped rather than passed by reference: noteActivity is a const declared
       further down this file, so reading it here would be a use before its
       initialisation. The closure defers the lookup to the call. */
    onActivity: () => noteActivity(),
    onRestart: () => root.querySelector('[data-qe-action="restart"]')?.click(),
    delayMs: 0
  })
  container.replaceChildren(root)

  const sceneHost = root.querySelector('[data-qe-scene]')
  const status = root.querySelector('[data-qe-status]')
  const experience = root.querySelector('.qe__experience')
  const intro = root.querySelector('[data-qe-intro]')
  const tuning = root.querySelector('[data-qe-tuning]')
  const continuePrompt = root.querySelector('[data-qe-continue]')
  const introTitle = root.querySelector('.qe__intro-copy h2')
  const introBody = root.querySelector('.qe__intro-copy p')
  const endTitle = root.querySelector('[data-qe-end-title]')
  const endOne = root.querySelector('[data-qe-end-one]')
  const endTwo = root.querySelector('[data-qe-end-two]')
  const endFoot = root.querySelector('[data-qe-end-foot]')

  /* These are concise action cues, so their surface, typography and reduced-
     motion behavior come from the shared tooltip. The button remains the
     semantic control for keyboard users; the adjacent visual is presentation
     only. */
  const continueTooltip = createKioskTooltip({
    ariaHidden: true,
    className: 'kiosk-tooltip--blue qe__continue-tooltip',
    hidden: true,
    text: 'Tap anywhere to continue'
  })
  continuePrompt.before(continueTooltip.element)
  const dragHint = createKioskTooltip({
    ariaHidden: true,
    className: 'kiosk-tooltip--blue qe__drag-hint',
    hidden: true,
    text: 'Pull the two materials together'
  })
  experience.append(dragHint.element)

  /* The result copy stays in place throughout the material transformation.
     Once the topoconductor is complete, the top copy swaps, the lower copy
     follows, and only then does the next-module band arrive. */
  let endIndex = -1
  let endTimer = null
  let endFrame = null

  function setEndScreen(index) {
    const screenCopy = END_SCREENS[index]
    if (!screenCopy) return null
    endIndex = index
    endTitle.textContent = screenCopy.title
    endTitle.hidden = !screenCopy.title
    endOne.textContent = screenCopy.one
    endTwo.textContent = screenCopy.two
    endTwo.hidden = !screenCopy.two
    endFoot.textContent = screenCopy.foot
    endFoot.classList.toggle('is-visible', Boolean(screenCopy.foot))
    endFoot.setAttribute('aria-hidden', String(!screenCopy.foot))
    root.dataset.endScreen = screenCopy.id
    return screenCopy
  }

  function scheduleEndAdvance(screenCopy, index) {
    if (screenCopy.holdMs > 0) {
      endTimer = window.setTimeout(() => {
        endTimer = null
        if (disposed) return
        if (screenCopy.offerAfterHold) {
          root.dataset.endScreen = 'up-next'
          upNextBanner?.offer()
          return
        }
        showEndScreen(index + 1)
      }, screenCopy.holdMs)
    }
  }

  function showEndScreen(index, { transitionCopy = false } = {}) {
    const screenCopy = END_SCREENS[index]
    if (!screenCopy) return

    if (
      transitionCopy &&
      endIndex >= 0 &&
      !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      tuning.querySelector('.qe__tuning-copy')?.classList.add('is-exiting')
      endTimer = window.setTimeout(() => {
        endTimer = null
        if (disposed) return
        const tuningCopy = tuning.querySelector('.qe__tuning-copy')
        setEndScreen(index)
        tuningCopy?.classList.remove('is-exiting')
        tuningCopy?.classList.add('is-entering')
        if (tuningCopy) void tuningCopy.offsetWidth
        endFrame = window.requestAnimationFrame(() => {
          endFrame = null
          tuningCopy?.classList.remove('is-entering')
          scheduleEndAdvance(screenCopy, index)
        })
      }, END_COPY_EXIT_MS)
      return
    }

    setEndScreen(index)
    scheduleEndAdvance(screenCopy, index)
  }

  function startEndSequence() {
    if (endIndex >= 0) return
    showEndScreen(0)
    startTuneRamp()
  }

  function resetEndSequence() {
    if (endTimer !== null) window.clearTimeout(endTimer)
    if (endFrame !== null) window.cancelAnimationFrame(endFrame)
    endTimer = null
    endFrame = null
    endIndex = -1
    tuning.querySelector('.qe__tuning-copy')?.classList.remove('is-entering', 'is-exiting')
    endFoot.classList.remove('is-visible')
    endFoot.setAttribute('aria-hidden', 'true')
    delete root.dataset.endScreen
  }

  const materialPanel = createMaterialPanel()
  /* No figcaption here: the exported artwork already draws its own
     "Constructive interference" label, so adding one prints it twice. */
  root.querySelector('.qe__experience').append(materialPanel.element)
  const callouts = new Map(
    [...root.querySelectorAll('[data-qe-callout]')]
      .map(callout => [callout.dataset.qeCallout, callout])
  )
  const listeners = new AbortController()
  let state = createQubitExplorerState()
  let sceneController = null
  let disposed = false
  let lineUpdateFrame = null
  let lineTrackingUntil = 0
  let lastAnchorLayout = null
  let lastActivityAt = -Infinity
  let lastDialBlipAt = -Infinity
  let materialPanelPresented = false
  let materialTransitioning = false
  let introRevealPending = false
  let continueTooltipVisible = false
  let dragHintVisible = false
  let restoreContinueFocus = false
  const presentationTimers = new Set()

  /* Every action cue follows the content it advances: the opening/build copy
     or the active material explainer. Measure the rendered lower edge so each
     tooltip and its transparent control stay exactly 80px below it. */
  const syncActionPromptPosition = () => {
    const anchor = state.phase === 'materials'
      ? materialPanel.element
      : introBody
    let top = anchor.offsetHeight + 80
    let node = anchor
    while (node && node !== experience) {
      top += node.offsetTop
      node = node.offsetParent
    }
    root.style.setProperty('--qe-action-prompt-top', `${top}px`)
  }

  const schedulePresentation = (callback, delayMs) => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      callback()
      return null
    }
    const timer = window.setTimeout(() => {
      presentationTimers.delete(timer)
      callback()
    }, delayMs)
    presentationTimers.add(timer)
    return timer
  }

  const cancelPresentationTimers = () => {
    for (const timer of presentationTimers) window.clearTimeout(timer)
    presentationTimers.clear()
  }

  const syncSceneInteractive = () => {
    sceneController?.setInteractive(
      state.phase === 'ready' &&
      !introRevealPending &&
      !materialTransitioning
    )
  }

  const syncGuidance = () => {
    syncActionPromptPosition()
    const introContinueVisible = state.phase === 'intro' && state.introSettled
    const materialContinueVisible = state.phase === 'materials' &&
      materialPanelPresented &&
      !materialTransitioning
    const continueVisible = introContinueVisible || materialContinueVisible
    const readyActionVisible = state.phase === 'ready' &&
      !state.introDismissed &&
      !introRevealPending &&
      !materialTransitioning
    const actionVisible = continueVisible || readyActionVisible

    continuePrompt.hidden = !actionVisible
    continuePrompt.disabled = !actionVisible
    continuePrompt.tabIndex = actionVisible ? 0 : -1
    continuePrompt.setAttribute(
      'aria-label',
      readyActionVisible
        ? 'Pull the two materials together: combine the materials'
        : state.phase === 'intro'
          ? 'Tap anywhere to continue: show the superconductor explanation'
          : state.materialStep === QUBIT_MATERIAL_STEPS.SUPERCONDUCTOR
            ? 'Tap anywhere to continue: show the semiconductor explanation'
            : 'Tap anywhere to continue: show the combining step'
    )

    if (continueVisible !== continueTooltipVisible) {
      continueTooltipVisible = continueVisible
      updateKioskTooltip(continueTooltip, {
        replay: continueVisible,
        text: 'Tap anywhere to continue',
        visible: continueVisible
      })
    }

    /* The 3D canvas follows the same reveal gate as its action cue. Otherwise
       a quick drag can skip the Build screen while the previous panel exits. */
    syncSceneInteractive()

    const nextDragHintVisible = readyActionVisible
    if (nextDragHintVisible !== dragHintVisible) {
      dragHintVisible = nextDragHintVisible
      updateKioskTooltip(dragHint, {
        replay: nextDragHintVisible,
        text: 'Pull the two materials together',
        visible: nextDragHintVisible
      })
    }

    if (actionVisible && restoreContinueFocus) {
      restoreContinueFocus = false
      queueMicrotask(() => {
        if (!continuePrompt.hidden && !continuePrompt.disabled) {
          continuePrompt.focus({ preventScroll: true })
        }
      })
    }
  }

  const showMaterialPanel = materialStep => {
    if (state.phase !== 'materials' || state.materialStep !== materialStep) return
    const content = MATERIAL_PANEL_CONTENT[materialStep]
    updateKioskExplainer(materialPanel, {
      bodyAriaLabel: `${content.lead} ${content.detail}`,
      bodyContent: panelBodyContent(content.lead, content.detail),
      media: panelGraphic(materialStep),
      replay: true,
      title: content.title,
      visible: true
    })
    materialPanelPresented = true
    materialTransitioning = false
    syncGuidance()
  }

  const updateMaterialPresentation = previousState => {
    const materialsVisible = state.phase === 'materials'
    const wasMaterialsVisible = previousState?.phase === 'materials'
    const materialChanged = materialsVisible && (
      !wasMaterialsVisible || previousState.materialStep !== state.materialStep
    )

    if (materialChanged) {
      cancelPresentationTimers()
      materialTransitioning = true
      materialPanelPresented = false
      updateKioskExplainer(materialPanel, { visible: false })
      syncGuidance()
      const delay = wasMaterialsVisible
        ? MATERIAL_PANEL_SWAP_DELAY_MS
        : INTRO_TO_PANEL_DELAY_MS
      const nextMaterialStep = state.materialStep
      schedulePresentation(() => showMaterialPanel(nextMaterialStep), delay)
      return
    }

    if (!materialsVisible && (wasMaterialsVisible || materialPanelPresented)) {
      cancelPresentationTimers()
      materialTransitioning = true
      materialPanelPresented = false
      updateKioskExplainer(materialPanel, { visible: false })
      syncGuidance()

      if (state.phase === 'ready' && !state.introDismissed) {
        schedulePresentation(() => {
          if (state.phase !== 'ready' || state.introDismissed) return
          introRevealPending = false
          materialTransitioning = false
          root.dataset.intro = 'visible'
          intro.setAttribute('aria-hidden', 'false')
          syncGuidance()
        }, PANEL_TO_BUILD_COPY_DELAY_MS)
      } else {
        materialTransitioning = false
      }
    }
  }

  const noteActivity = () => {
    const now = window.performance?.now?.() ?? Date.now()
    if (now - lastActivityAt < 220) return
    lastActivityAt = now
    onActivity?.()
  }

  const setCalloutLine = (calloutId, point, experienceRect, stageScale) => {
    const callout = callouts.get(calloutId)
    const anchor = callout?.querySelector('.qe__callout-anchor')
    const horizontal = anchor?.querySelector('.qe__callout-line--horizontal')
    const vertical = anchor?.querySelector('.qe__callout-line--vertical')
    if (
      !callout ||
      !anchor ||
      !horizontal ||
      !vertical ||
      !Number.isFinite(point?.x) ||
      !Number.isFinite(point?.y)
    ) return

    const anchorRect = anchor.getBoundingClientRect()
    const startX = (anchorRect.left - experienceRect.left) / stageScale
    const startY = (anchorRect.top - experienceRect.top) / stageScale
    const deltaX = point.x - startX
    const deltaY = point.y - startY

    horizontal.style.left = `${Math.min(0, deltaX)}px`
    horizontal.style.width = `${Math.abs(deltaX)}px`
    vertical.style.left = `${deltaX}px`
    vertical.style.top = `${Math.min(0, deltaY)}px`
    vertical.style.height = `${Math.abs(deltaY)}px`
    /* The connector's far end, where it meets the material. The dot rides this
       rather than the anchor origin beside the text. */
    anchor.style.setProperty('--qe-anchor-x', `${deltaX}px`)
    anchor.style.setProperty('--qe-anchor-y', `${deltaY}px`)
  }

  const updateCalloutLines = () => {
    lineUpdateFrame = null
    if (!lastAnchorLayout) return
    const experienceRect = experience.getBoundingClientRect()
    const stageScale = Math.max(experienceRect.width / Math.max(experience.offsetWidth, 1), 0.001)
    setCalloutLine(
      'topoconductor',
      lastAnchorLayout.topoconductor,
      experienceRect,
      stageScale
    )

    const now = window.performance?.now?.() ?? Date.now()
    if (now < lineTrackingUntil) {
      lineUpdateFrame = window.requestAnimationFrame(updateCalloutLines)
    }
  }

  const scheduleCalloutLineUpdate = (trackingDuration = 0) => {
    const now = window.performance?.now?.() ?? Date.now()
    lineTrackingUntil = Math.max(lineTrackingUntil, now + trackingDuration)
    if (lineUpdateFrame !== null) return
    lineUpdateFrame = window.requestAnimationFrame(updateCalloutLines)
  }

  const setCalloutVisible = (calloutId, visible) => {
    callouts.get(calloutId)?.setAttribute('aria-hidden', String(!visible))
  }

  const renderState = (previousState = state) => {
    const materialsVisible = state.phase === 'materials'
    const tuningVisible = state.phase === 'tuning' || state.phase === 'complete'

    if (
      previousState.phase === 'materials' &&
      state.phase === 'ready' &&
      !state.introDismissed
    ) {
      introRevealPending = true
    } else if (state.phase !== 'ready') {
      introRevealPending = false
    }

    root.dataset.phase = state.phase
    /* The board uses this block twice: once to open the module, and again to
       ask for the drag. Same furniture, different words. */
    /* Keep the outgoing intro copy intact while it fades. The build copy is
       prepared only while the intro is fully hidden, then revealed after the
       material panel has completed its exit. */
    const opening = state.phase === 'intro' || state.phase === 'materials'
    introTitle.textContent = opening
      ? 'Two materials, one new state of matter.'
      : 'Build the topoconductor'
    introBody.innerHTML = opening
      ? TOPOCONDUCTOR_INTRO_BODY
      : 'A semiconductor controls electrons. A superconductor allows electricity to flow freely. Put together, they create something new.'
    syncActionPromptPosition()
    const introVisible = !state.introDismissed && !introRevealPending
    root.dataset.intro = introVisible ? 'visible' : 'dismissed'
    root.dataset.materialStep = state.materialStep || ''
    intro.setAttribute('aria-hidden', String(!introVisible))
    root.classList.toggle('has-interacted', state.hasInteracted)
    root.classList.toggle('is-complete', state.phase === 'complete')
    updateMaterialPresentation(previousState)
    /* Nothing anchored at the end any more: the board puts this copy at the
       top of the screen, and the leader line and its dot sat on top of it. */
    if (tuningVisible) startEndSequence()
    else resetEndSequence()
    tuning.setAttribute('aria-hidden', String(!tuningVisible))
    syncGuidance()

    syncSceneInteractive()
    sceneController?.setMaterialFocus(materialsVisible ? state.materialStep : null)
    sceneController?.setSemiconductorVisible(isQubitSemiconductorVisible(state))
    sceneController?.setTuningActive(tuningVisible)
    sceneController?.setTuneProgress(state.tuneProgress)

    const messages = {
      intro: 'Introducing the superconductor.',
      materials: state.materialStep === QUBIT_MATERIAL_STEPS.SUPERCONDUCTOR
        ? 'Superconductor. A material that lets electricity flow freely when cold enough.'
        : 'Semiconductor. A material that acts like an on and off switch for electricity.',
      ready: 'Drag either material to bring the layers together.',
      dragging: 'Keep moving the layers toward the center.',
      returning: 'The materials need to overlap. The superconductor is returning.',
      snapping: 'The material layers are combining.',
      tuning: 'The layers are tuning themselves into the protected state.',
      complete: 'Topoconductor created. The combined state protects quantum information.'
    }
    status.textContent = messages[state.phase] || ''

    scheduleCalloutLineUpdate(state.phase === 'intro' ? 2_100 : 620)
  }

  const dispatch = event => {
    const nextState = reduceQubitExplorerState(state, event)
    if (nextState === state) return
    const previousState = state
    state = nextState
    renderState(previousState)
  }

  /* IQM removed the knob after internal testing (25 Aug): once the two slabs
     are brought together the tune runs itself.

     The state machine is untouched. This drives the same TUNE_INPUT the dial
     used to, at the same 0..1 range, so the scene colour, the audio and the
     completion transition all behave exactly as they did — the only thing that
     changed is what moves the value.

     `tuneRamp` is a three-state flag rather than a null check on the frame
     handle, because each frame dispatches before requesting the next one and a
     dispatch re-enters renderState; keyed on the handle alone, that re-entry
     would see no pending frame and start a second ramp. */
  const TUNE_HOLD_MS = 600
  const TUNE_RAMP_MS = 2800
  let tuneRamp = 'idle'
  let tuneRampFrame = null
  let tuneRampStartedAt = null

  function stopTuneRamp() {
    if (tuneRampFrame !== null) window.cancelAnimationFrame(tuneRampFrame)
    tuneRampFrame = null
    tuneRampStartedAt = null
  }

  function resetTuneRamp() {
    stopTuneRamp()
    tuneRamp = 'idle'
  }

  function startTuneRamp() {
    if (tuneRamp !== 'idle') return
    tuneRamp = 'running'

    const step = timestamp => {
      tuneRampFrame = null
      if (disposed || tuneRamp !== 'running') return
      if (tuneRampStartedAt === null) tuneRampStartedAt = timestamp

      /* The hold lets the slabs finish coming together and be seen as joined
         before anything starts changing colour. */
      const elapsed = timestamp - tuneRampStartedAt - TUNE_HOLD_MS
      if (elapsed >= TUNE_RAMP_MS) {
        tuneRamp = 'done'
        stopTuneRamp()
        dispatch({ type: 'TUNE_INPUT', value: 1 })
        if (endIndex === 0) showEndScreen(1, { transitionCopy: true })
        return
      }

      const linear = Math.max(0, elapsed) / TUNE_RAMP_MS
      /* Eased both ends, so it reads as a condition settling rather than a bar
         filling at a constant rate. */
      const eased = linear < 0.5
        ? 2 * linear * linear
        : 1 - (((-2 * linear) + 2) ** 2) / 2

      const now = window.performance?.now?.() ?? Date.now()
      if (linear > 0 && now - lastDialBlipAt > 120) {
        lastDialBlipAt = now
        sound.blip(420 + (eased * 240))
      }

      tuneRampFrame = window.requestAnimationFrame(step)
      dispatch({ type: 'TUNE_INPUT', value: eased })
    }

    tuneRampFrame = window.requestAnimationFrame(step)
  }

  continuePrompt.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    continuePrompt.click()
  }, { signal: listeners.signal })

  root.addEventListener('click', event => {
    const action = event.target.closest('[data-qe-action]')?.dataset.qeAction
    if (!action) {
      const requestedContinue = event.target.closest('[data-qe-continue]')
      /* Native keyboard activation dispatches a click with detail 0. Preserve
         focus only for that path; pointer visitors should not inherit a focus
         ring on the next visual cue. */
      const shouldAdvanceKeyboardFocus = Boolean(requestedContinue && event.detail === 0)
      /* The opening screen is tapped through, like the material ones after it. */
      if (state.phase === 'intro') {
        if (!state.introSettled) return
        restoreContinueFocus = shouldAdvanceKeyboardFocus
        noteActivity()
        dispatch({ type: 'INTRO_COMPLETE' })
        return
      }
      if (state.phase === 'ready') {
        if (!requestedContinue || introRevealPending || materialTransitioning) return
        restoreContinueFocus = false
        if (sceneController?.combine()) noteActivity()
        return
      }
      if (state.phase !== 'materials' || materialTransitioning) return
      restoreContinueFocus = shouldAdvanceKeyboardFocus
      noteActivity()
      dispatch({ type: 'MATERIALS_NEXT' })
      return
    }
    noteActivity()

    if (action === 'restart') {
      const previousState = state
      cancelPresentationTimers()
      materialPanelPresented = false
      materialTransitioning = false
      introRevealPending = false
      dragHintVisible = false
      state = reduceQubitExplorerState(state, { type: 'RESTART' })
      resetTuneRamp()
      upNextBanner?.withdraw()
      root.classList.remove('is-magnetic')
      root.classList.add('is-restarting')
      root.getBoundingClientRect()
      root.classList.remove('is-restarting')
      sceneController?.restart()
      updateKioskTooltip(dragHint, { visible: false })
      renderState(previousState)
      return
    }

    if (action === 'exit') navigate.menu?.()
  }, { signal: listeners.signal })

  const abortMount = () => {
    if (disposed) return
    disposed = true
    if (lineUpdateFrame !== null) window.cancelAnimationFrame(lineUpdateFrame)
    lineUpdateFrame = null
    stopTuneRamp()
    resetEndSequence()
    cancelPresentationTimers()
    upNextBanner?.dispose()
    lineTrackingUntil = 0
    listeners.abort()
    /* The explainer schedules its own exit timers; cancel them before the panel
       leaves the DOM. */
    disposeKioskExplainer(materialPanel)
    sceneController?.dispose()
    sceneController = null
  }
  signal?.addEventListener('abort', abortMount, { once: true })

  try {
    sceneController = await createQubitScene(sceneHost, {
      onIntroComplete() {
        dispatch({ type: 'INTRO_SETTLED' })
      },
      onIntroSkip() {
        dispatch({ type: 'SKIP_INTRO' })
      },
      onDragStart() {
        dispatch({ type: 'DRAG_START' })
      },
      onDragMove({ distance, threshold }) {
        root.classList.toggle('is-magnetic', distance <= threshold * 1.45)
      },
      onDrop({ valid }) {
        root.classList.remove('is-magnetic')
        dispatch({ type: 'DROP', valid })
      },
      onReturnComplete() {
        dispatch({ type: 'RETURN_COMPLETE' })
      },
      onSnapComplete() {
        dispatch({ type: 'SNAP_COMPLETE' })
      },
      onAnchorLayout(layout) {
        lastAnchorLayout = layout
        scheduleCalloutLineUpdate()
      },
      onActivity: noteActivity
    })

    if (disposed || signal?.aborted) {
      sceneController.dispose()
      sceneController = null
      throw createAbortError()
    }

    root.classList.add('is-scene-ready')
    renderState()
  } catch (error) {
    abortMount()
    throw error
  }

  return abortMount
}

export default { mount }
