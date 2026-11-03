import { assetUrl } from '../../core/asset-url.js'
import { createKioskTooltip, updateKioskTooltip } from '../../core/kiosk-tooltip.js'
import {
  createKioskExplainer,
  disposeKioskExplainer,
  updateKioskExplainer
} from '../../core/kiosk-explainer.js'
import {
  abortError,
  releaseVideoElement,
  throwIfAborted
} from '../../core/media-lifecycle.js'
import { mountModuleOutro } from '../module-outro.js'
import { CALLOUT_GEOMETRY, calloutGlowMask, calloutRevealMask, mountCalloutEntrances } from './callout-entrance.js'
import {
  canAdvanceMeasurementStory,
  createMeasurementStoryState,
  getMeasurementStoryForwardTransition,
  getMeasurementStoryProgress,
  getMeasurementStoryStableMedia,
  MEASUREMENT_STORY_EVENTS,
  MEASUREMENT_STORY_STEP_IDS,
  MEASUREMENT_STORY_TRANSITION_IDS,
  reduceMeasurementStoryState
} from './story-state.js'

const MEDIA_READY_TIMEOUT_MS = 8_000
const MEDIA_END_BUFFER_MS = 1_500
/* How long each kind of join between two clips takes, kept in step with the
   mbqc-media-* keyframes in the stylesheet.

   In both, the arriving clip is stacked underneath at full strength and the
   leaving one fades off the top of it, so the module's surface is never visible
   through the gap between them.

   `fade` is the plain one, used wherever a cut would jump. `shrink` is the
   opening edge: the module opens on a close-up card that is a different shape
   from the wide grid it becomes, so the card scales down onto the video's
   rectangle as it leaves and uncovers it, rather than dissolving out at a size
   that was never the size of the frame it turns into. */
const MEDIA_JOIN_MS = Object.freeze({
  fade: 620,
  shrink: 380
})

/* The copy's whole entrance, measured from the moment the transition phase is
   set: the hold it waits out, the entrance's own offset inside that, and its
   travel. The stylesheet owns these three numbers -- --mbqc-copy-hold, and the
   130ms offset and 780ms duration built into mbqc-copy-in -- so a test asserts
   the two files still agree rather than trusting them to drift together. */
export const MEASUREMENT_COPY_ENTRANCE_MS = Object.freeze({
  hold: 620,
  offset: 130,
  travel: 780,
  get total() { return this.hold + this.offset + this.travel }
})

/* Resolves once the wait is over, or rejects the moment the operation is
   abandoned -- a bare setTimeout would keep a torn-down transition alive. */
function afterDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal))
      return
    }
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(abortError(signal))
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

const SHARED_STORY_TITLE = 'Topological quantum computers\ntake a different approach'

const PROTECTED_STORY_TITLE = 'Topological hardware protects\nquantum information'

/* The board turns the heading over for the last two readings: the story stops
   being about how the approach works and starts being about what it buys. */
const SCALE_STORY_TITLE = 'Topological quantum computers\nare built for scale'

/* Final document copy grouped into its five reading screens. The footage
   keeps its existing build clips and loops underneath those readings. */
const STORY_COPY = Object.freeze({
  [MEASUREMENT_STORY_STEP_IDS.OPENING]: Object.freeze({
    title: '',
    body: 'Many quantum computers solve problems by nudging their qubits with finely tuned pulses — delicate to get right, since qubits are famously fragile.'
  }),
  [MEASUREMENT_STORY_STEP_IDS.MEASUREMENT_PAIR]: Object.freeze({
    title: SHARED_STORY_TITLE,
    body: 'They solve problems using a series of measurements. Each measurement has two possible outcomes.'
  }),
  [MEASUREMENT_STORY_STEP_IDS.MEASUREMENT_SEQUENCE]: Object.freeze({
    title: SHARED_STORY_TITLE,
    body: 'Together, those outcomes guide the quantum state step by step until an answer emerges.'
  }),
  [MEASUREMENT_STORY_STEP_IDS.PROTECTED_INFORMATION]: Object.freeze({
    title: PROTECTED_STORY_TITLE,
    body: 'This is also where topological hardware pays off. Quantum information isn’t kept in one fragile spot. It’s encoded across separate parts of the device.\n\nWith this design, a carefully chosen sequence of measurements carries out computation without physically moving the parts that hold information.'
  }),
  [MEASUREMENT_STORY_STEP_IDS.BUILT_FOR_SCALE]: Object.freeze({
    title: SCALE_STORY_TITLE,
    body: 'A topological quantum computer has one guiding principle: spread information across the device, and compute through measurement. This approach to computation makes topological qubits scalable.'
  })
})

function mediaError(video, message) {
  const code = Number(video?.error?.code)
  const suffix = Number.isFinite(code) && code > 0 ? ` (media error ${code})` : ''
  return new Error(`${message}${suffix}`)
}

function waitForMediaReady(video, { signal, timeoutMs = MEDIA_READY_TIMEOUT_MS } = {}) {
  if (signal?.aborted) return Promise.reject(abortError(signal))
  if (video.readyState >= 2) return Promise.resolve()

  return new Promise((resolve, reject) => {
    let timeout = null
    let settled = false

    const cleanup = () => {
      video.removeEventListener('loadeddata', onReady)
      video.removeEventListener('error', onError)
      signal?.removeEventListener?.('abort', onAbort)
      if (timeout !== null) window.clearTimeout(timeout)
    }
    const settle = callback => value => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }
    const succeed = settle(resolve)
    const fail = settle(reject)
    const onReady = () => succeed()
    const onError = () => fail(mediaError(video, 'A topological-qubit video could not be decoded'))
    const onAbort = () => fail(abortError(signal))

    video.addEventListener('loadeddata', onReady)
    video.addEventListener('error', onError)
    signal?.addEventListener?.('abort', onAbort, { once: true })
    timeout = window.setTimeout(
      () => fail(new Error(`A topological-qubit video did not become ready within ${timeoutMs}ms.`)),
      timeoutMs
    )
  })
}

function waitForMediaEnd(video, { signal } = {}) {
  if (signal?.aborted) return Promise.reject(abortError(signal))
  if (video.ended) return Promise.resolve()

  const duration = Number(video.duration)
  const fallbackMs = Number.isFinite(duration) && duration > 0
    ? Math.ceil(duration * 1000) + MEDIA_END_BUFFER_MS
    : 12_000

  return new Promise((resolve, reject) => {
    let timeout = null
    let settled = false

    const cleanup = () => {
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('error', onError)
      signal?.removeEventListener?.('abort', onAbort)
      if (timeout !== null) window.clearTimeout(timeout)
    }
    const settle = callback => value => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }
    const succeed = settle(resolve)
    const fail = settle(reject)
    const onEnded = () => succeed()
    const onError = () => fail(mediaError(video, 'A topological-qubit transition could not be decoded'))
    const onAbort = () => fail(abortError(signal))

    video.addEventListener('ended', onEnded)
    video.addEventListener('error', onError)
    signal?.addEventListener?.('abort', onAbort, { once: true })
    /* `ended` can be suppressed by a decoder interruption. Settling on the
       last composited frame is preferable to trapping the visitor forever. */
    timeout = window.setTimeout(succeed, fallbackMs)
  })
}

async function playVideo(video) {
  const result = video.play()
  if (result?.then) await result
}

function delay(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError(signal))
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(abortError(signal))
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

function moduleMarkup() {
  const microsoftLogo = assetUrl('assets/ui/microsoft-logo.png')
  const restartIcon = assetUrl('assets/ui/restart.svg')
  const exitIcon = assetUrl('assets/ui/exit-x.svg')
  const protectedConnector = assetUrl(
    'assets/modules/measurement-based/protected-information-connector.svg'
  )

  return `
    <section
      class="mbqc"
      data-mbqc-root
      data-phase="loading"
      data-step="${MEASUREMENT_STORY_STEP_IDS.OPENING}"
      aria-labelledby="mbqc-title"
      aria-busy="true"
      tabindex="0"
    >
      <div class="mbqc__media" aria-hidden="true">
        <video class="mbqc__video is-active" data-mbqc-video="a" muted playsinline preload="auto" disablepictureinpicture></video>
        <video class="mbqc__video" data-mbqc-video="b" muted playsinline preload="auto" disablepictureinpicture></video>
      </div>

      <svg class="mbqc__effect-defs" width="0" height="0" aria-hidden="true" focusable="false">
        <defs>
          ${calloutGlowMask({ id: 'mbqc-measurement-glow', ...CALLOUT_GEOMETRY.measurement })}
          <!-- Map backdrop luminance continuously between soft lavender (#CFC9E6)
               and pale lavender (#E3DCF4), keeping the glow in one colour family. -->
          <filter id="mbqc-adaptive-glow-tone" color-interpolation-filters="sRGB">
            <feComponentTransfer>
              <feFuncR type="linear" slope="0.078431" intercept="0.811765"/>
              <feFuncG type="linear" slope="0.074510" intercept="0.788235"/>
              <feFuncB type="linear" slope="0.054902" intercept="0.901961"/>
            </feComponentTransfer>
          </filter>
        </defs>
      </svg>

      <!-- This artwork-anchored shadow must share the video's backdrop root.
           Nesting it inside a fading callout would hide the video from the
           backdrop filter. The mask affects only the connector silhouette.
           The protected callout carries no such glow: over the dense green
           grid it read as a smear behind the line rather than as light. -->
      <div class="mbqc__connector-shadow mbqc__connector-shadow--measurement" aria-hidden="true"></div>

      <!-- The artwork-anchored measurement callout, a Figma reference layer.
           Its coordinates live in the stylesheet because the kiosk's CSP sets
           style-src 'self' with no unsafe-inline, so a style attribute never
           reaches the CSSOM. It belongs to the measurement-pair loop.

           The white corner and bar marks that sat under it are gone: they were
           a stand-in for marks the footage did not yet carry, and the re-cut
           clips draw their own.

           The leader line is drawn here rather than stamped from an exported
           SVG. The export was one shape placed once and reused for both
           callouts, and its two legs landed 150px and 62px to the right of the
           marks the pair loop draws, because nothing in it was tied to the
           footage. Against the full 2160x3840 viewBox every number below is the
           design pixel it points at: the legs come down on x 718 and x 1138,
           the centres of the two marks, and stop at y 1786, just above their
           tops at y 1816. -->
      <div class="mbqc__measurement-annotations" aria-hidden="true">
        <div class="mbqc__measurement-callout">
          <span>Quantum Measurements</span>
          <svg class="mbqc__measurement-connector" viewBox="0 0 2160 3840" aria-hidden="true" focusable="false">
            <defs>
              ${calloutRevealMask({
                id: 'mbqc-measurement-reveal', ...CALLOUT_GEOMETRY.measurement
              })}
              <linearGradient id="mbqc-measurement-flow-gradient" x1="0" y1="0" x2="0" y2="100%">
                <stop offset="0" stop-color="#c6aff5" stop-opacity="0"/>
                <stop offset="0.3" stop-color="#c6aff5" stop-opacity="0.12"/>
                <stop offset="0.5" stop-color="#c6aff5" stop-opacity="0.55"/>
                <stop offset="0.7" stop-color="#c6aff5" stop-opacity="0.12"/>
                <stop offset="1" stop-color="#c6aff5" stop-opacity="0"/>
              </linearGradient>
              <mask id="mbqc-measurement-flow-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="2160" height="3840">
                <path d="M928 1516V1616H718V1786M928 1616H1138V1786" fill="none" stroke="#fff" stroke-width="5"/>
                <circle cx="928" cy="1516" r="14" fill="#fff"/>
                <circle cx="718" cy="1786" r="13.5" fill="#fff"/>
                <circle cx="1138" cy="1786" r="13.5" fill="#fff"/>
              </mask>
            </defs>
            <g class="mbqc__connector-ink" mask="url(#mbqc-measurement-reveal)">
              <path d="M928 1516V1616H718V1786M928 1616H1138V1786"/>
              <circle cx="928" cy="1516" r="14"/>
              <circle cx="718" cy="1786" r="13.5"/>
              <circle cx="1138" cy="1786" r="13.5"/>
              <rect
                class="mbqc__connector-flow"
                x="0"
                y="1380"
                width="2160"
                height="120"
                fill="url(#mbqc-measurement-flow-gradient)"
                mask="url(#mbqc-measurement-flow-mask)"
              >
                <animate
                  attributeName="y"
                  values="1380;1804;1804"
                  dur="4s"
                  repeatCount="indefinite"
                  calcMode="spline"
                  keyTimes="0;0.7;1"
                  keySplines="0.4 0 0.2 1;0 0 1 1"
                />
              </rect>
            </g>
          </svg>
        </div>
      </div>

      <header class="microsoft-header mbqc__header">
        <div class="microsoft-brand" aria-label="Microsoft Quantum">
          <span class="microsoft-brand__logo" aria-hidden="true">
            <img src="${microsoftLogo}" alt="" draggable="false">
          </span>
          <span class="microsoft-brand__divider" aria-hidden="true"></span>
          <span class="microsoft-brand__quantum">Quantum</span>
        </div>

        <div class="microsoft-header__actions">
          <button class="microsoft-header__action" type="button" data-mbqc-action="restart">
            <span>Restart</span>
            <span class="microsoft-header__action-icon" aria-hidden="true">
              <img src="${restartIcon}" alt="" draggable="false">
            </span>
          </button>
          <button class="microsoft-header__action" type="button" data-mbqc-action="exit">
            <span>Exit</span>
            <span class="microsoft-header__action-icon" aria-hidden="true">
              <img src="${exitIcon}" alt="" draggable="false">
            </span>
          </button>
        </div>
      </header>

      <h1 class="mbqc__sr-only" id="mbqc-title">Computing with topological qubits</h1>

      <div class="mbqc__protected-callout" data-mbqc-protected-callout aria-hidden="true">
        <span class="mbqc__protected-title">Protected information</span>
        <span class="mbqc__protected-body">Encoded across separate<br>parts of the device</span>
        <svg
          class="mbqc__protected-connector"
          viewBox="0 0 784 555"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            ${calloutRevealMask({
              id: 'mbqc-protected-reveal', ...CALLOUT_GEOMETRY.protected
            })}
          </defs>
          <image href="${protectedConnector}" width="784" height="555" mask="url(#mbqc-protected-reveal)"/>
        </svg>
      </div>

      <!-- An interactive stage target is separate from the shared noninteractive
           guidance tooltip. -->
      <button class="mbqc__advance" type="button" data-mbqc-next aria-label="Continue to the next explanation" hidden></button>

      <p class="mbqc__sr-only" data-mbqc-status aria-live="polite">
        Preparing the topological-qubit animation.
      </p>
    </section>
  `
}

export async function mount(container, options = {}) {
  if (!container?.replaceChildren) {
    throw new TypeError('Computing with topological qubits requires a DOM container')
  }

  const { signal, onActivity, navigate = {}, module } = options
  throwIfAborted(signal)

  const wrapper = document.createElement('div')
  wrapper.innerHTML = moduleMarkup().trim()
  const root = wrapper.firstElementChild
  const videos = [...root.querySelectorAll('[data-mbqc-video]')]
  const nextButton = root.querySelector('[data-mbqc-next]')
  const continueTooltip = createKioskTooltip({
    className: 'mbqc__continue',
    text: 'Tap anywhere to continue',
    hidden: true
  })
  root.append(continueTooltip.element)
  const status = root.querySelector('[data-mbqc-status]')
  const listeners = new AbortController()
  const mediaController = new AbortController()
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

  const explainer = createKioskExplainer({
    className: 'mbqc__explainer mbqc__explainer--current',
    title: STORY_COPY[MEASUREMENT_STORY_STEP_IDS.OPENING].title,
    body: STORY_COPY[MEASUREMENT_STORY_STEP_IDS.OPENING].body,
    variant: 'plain',
    visible: false
  })
  explainer.element.dataset.copyStep = MEASUREMENT_STORY_STEP_IDS.OPENING
  const transitionExplainer = createKioskExplainer({
    className: 'mbqc__explainer mbqc__explainer--transition',
    title: '',
    body: '',
    variant: 'plain',
    visible: false
  })
  root.append(explainer.element, transitionExplainer.element)

  let state = createMeasurementStoryState()
  let activeVideo = videos[0]
  let disposed = false
  let operationId = 0
  let transitionController = null
  let preloadPromise = null
  let fastForwardVideo = null
  let fastForwardBaseRate = 1
  let fastForwarded = false

  function clearFastForward() {
    fastForwardVideo = null
    fastForwardBaseRate = 1
    fastForwarded = false
    delete root.dataset.fastForward
  }

  function showContinue(visible) {
    updateKioskTooltip(continueTooltip, { text: 'Tap anywhere to continue', visible })
  }

  const upNextBanner = mountModuleOutro({
    module,
    root,
    navigate,
    onActivity,
    onRestart: () => root.querySelector('[data-mbqc-action="restart"]')?.click(),
    delayMs: 0
  })
  container.replaceChildren(root)
  mountCalloutEntrances(root, { signal: listeners.signal })

  function standbyVideo() {
    return videos.find(video => video !== activeVideo)
  }

  function showVideo(video) {
    for (const layer of videos) layer.classList.toggle('is-active', layer === video)
  }


  /* Put `video` on screen in place of whatever is there.
   *
   * A cut is right wherever the two clips' frames continue each other, which
   * story-state records per edge from the delivered footage. Where they do not
   * -- leaving a loop mid-cycle, a build that does not end on its loop's first
   * frame, or any jump the visitor asks for by hand -- the swap is joined by
   * one of the moves in MEDIA_JOIN_MS instead, and the stylesheet draws it from
   * the pair of roles set here. */
  async function revealVideo(video, { join = 'fade', operationSignal } = {}) {
    const outgoing = activeVideo
    const durationMs = MEDIA_JOIN_MS[join]
    if (!durationMs || reducedMotion || outgoing === video || !outgoing) {
      showVideo(video)
      return
    }

    outgoing.dataset.mbqcFade = `${join}-out`
    video.dataset.mbqcFade = `${join}-in`
    video.classList.add('is-active')
    try {
      await delay(durationMs, operationSignal)
    } finally {
      showVideo(video)
      delete outgoing.dataset.mbqcFade
      delete video.dataset.mbqcFade
    }
  }

  async function prepareVideo(video, media, {
    play = false,
    operationSignal = mediaController.signal
  } = {}) {
    if (!video || !media) return
    if (operationSignal?.aborted) throw abortError(operationSignal)

    /* A failed media element keeps its error even when the requested URL is
       unchanged. Reloading in that case makes the visible retry path real. */
    if (video.dataset.assetSrc !== media.src || video.error) {
      video.pause()
      video.dataset.assetSrc = media.src
      video.src = assetUrl(media.src)
      video.load()
    }

    video.loop = media.loop === true && !reducedMotion
    video.playbackRate = Number.isFinite(media.playbackRate) ? media.playbackRate : 1
    await waitForMediaReady(video, { signal: operationSignal })
    if (operationSignal?.aborted) throw abortError(operationSignal)

    try { video.currentTime = 0 } catch { /* A ready frame is already usable. */ }
    if (play && !reducedMotion) await playVideo(video)
    else video.pause()
  }

  function setStableCopy({ advance = null, replay = false } = {}) {
    const copy = STORY_COPY[state.stepId]
    const progress = getMeasurementStoryProgress(state)
    delete root.dataset.transition
    delete root.dataset.copyChange
    delete root.dataset.copyAdvance
    root.dataset.phase = 'stable'
    root.dataset.step = state.stepId
    root.dataset.chapter = String(progress.chapterNumber)
    root.setAttribute('aria-busy', 'false')
    clearFastForward()
    const finalScreen = !canAdvanceMeasurementStory(state)
    nextButton.hidden = finalScreen
    nextButton.disabled = finalScreen
    showContinue(!finalScreen)
    if (finalScreen) upNextBanner?.offer()
    explainer.element.dataset.copyStep = state.stepId
    updateKioskExplainer(explainer, {
      ariaHidden: false,
      body: copy.body,
      replay,
      title: copy.title,
      visible: true
    })
    /* Clear the transition layer at the boundary. Leaving the incoming copy in
       this hidden surface for even one exit frame lets a fast Next press
       overlap it with the following frame's copy. */
    updateKioskExplainer(transitionExplainer, {
      ariaHidden: true,
      body: '',
      title: '',
      visible: false
    })
    status.textContent =
      `${copy.title.replace(/\n/g, ' ')}. ${copy.body} Step ${progress.stepNumber} of ${progress.stepCount}.`

    /* A copy-only advance plays no build clip, so there is no transition layer
       to hand the entrance to: the current panel runs it in place. Where the
       heading carries over, only the paragraph moves and the heading above it
       stays still; where it turns over, the whole block comes in.

       That second case used to replay the panel instead, which restarted the
       shared surface's own show transition and never ran this entrance at all.
       It is the only advance in the story where the heading changes without a
       clip between, which is why the "built for scale" frame was the one that
       arrived differently from every other. */
    if (advance) {
      void root.offsetWidth
      root.dataset.copyAdvance = advance
    }
  }

  function beginPreparingState(message = 'Preparing the next measurement animation.') {
    clearFastForward()
    showContinue(false)
    root.dataset.phase = 'preparing'
    root.setAttribute('aria-busy', 'true')
    nextButton.disabled = true
    nextButton.hidden = false
    status.textContent = message
  }

  function beginTransitionState(nextState, transition) {
    const copy = STORY_COPY[nextState.stepId]
    /* Two of the three builds keep the title and swap only the paragraph under
       it; the opening build swaps the whole block. The board draws no other
       distinction, so the choreography is chosen from the copy itself. */
    const copyChange = copy.title === STORY_COPY[state.stepId].title ? 'body' : 'copy'

    transitionExplainer.element.dataset.copyStep = nextState.stepId
    updateKioskExplainer(explainer, { ariaHidden: true, visible: true })
    updateKioskExplainer(transitionExplainer, {
      ariaHidden: true,
      body: copy.body,
      replay: true,
      title: copy.title,
      visible: true
    })
    delete root.dataset.transition
    delete root.dataset.copyChange
    root.dataset.phase = 'preparing'
    void root.offsetWidth
    root.dataset.transition = transition.id
    root.dataset.copyChange = copyChange
    root.dataset.phase = 'transition'
    showContinue(false)
    root.setAttribute('aria-busy', 'true')
    nextButton.disabled = true
    nextButton.hidden = false
    status.textContent = 'Showing how the measurement architecture changes.'
  }

  /* Warm the standby element with whatever the next Next press will show: the
     build clip on an authored edge, otherwise the destination's own loop. A
     copy-only advance stays on the active clip and needs no prefetch. */
  function prefetchNextBoundary() {
    const standby = standbyVideo()
    if (!standby || disposed) return

    const nextState = reduceMeasurementStoryState(state, {
      type: MEASUREMENT_STORY_EVENTS.NEXT
    })
    if (nextState === state) return

    const transition = getMeasurementStoryForwardTransition(state, nextState)
    const media = transition && transition.src !== activeVideo.dataset.assetSrc
      ? transition
      : getMeasurementStoryStableMedia(nextState)
    if (
      !media ||
      media.src === activeVideo.dataset.assetSrc ||
      (
        standby.dataset.assetSrc === media.src &&
        !standby.error &&
        standby.readyState >= 2
      )
    ) return

    preloadPromise = prepareVideo(standby, media, { play: false })
      .catch(error => {
        if (error?.name !== 'AbortError') {
          console.warn('A topological-qubit transition could not be prefetched.', error)
        }
      })
      .finally(() => { preloadPromise = null })
  }

  async function settleOn(nextState, settleVideo, settleMedia, currentOperationId, operationSignal) {
    await prepareVideo(settleVideo, settleMedia, {
      play: true,
      operationSignal
    })
    if (disposed || currentOperationId !== operationId || operationSignal.aborted) return

    await revealVideo(settleVideo, { operationSignal })
    if (disposed || currentOperationId !== operationId || operationSignal.aborted) return
    activeVideo = settleVideo
    for (const video of videos) {
      if (video !== activeVideo) video.pause()
    }
    state = nextState
    setStableCopy()
    prefetchNextBoundary()
  }

  async function playForwardTransition(nextState, transition) {
    const currentOperationId = ++operationId
    transitionController?.abort()
    const controller = new AbortController()
    transitionController = controller
    const abortFromHost = () => controller.abort(signal?.reason)
    signal?.addEventListener?.('abort', abortFromHost, { once: true })
    beginPreparingState()

    try {
      const settleMedia = getMeasurementStoryStableMedia(nextState)
      if (reducedMotion) {
        await settleOn(nextState, standbyVideo(), settleMedia, currentOperationId, controller.signal)
        return
      }

      let transitionVideo
      let settleVideo

      if (activeVideo.dataset.assetSrc === transition.src) {
        transitionVideo = activeVideo
        settleVideo = standbyVideo()
      } else {
        transitionVideo = standbyVideo()
        await prepareVideo(transitionVideo, transition, {
          play: false,
          operationSignal: controller.signal
        })
        const outgoing = activeVideo
        await revealVideo(transitionVideo, { operationSignal: controller.signal })
        if (disposed || currentOperationId !== operationId || controller.signal.aborted) return
        outgoing.pause()
        /* The layer on screen is now the build's, and the one it replaced is
           free to be re-pointed at the loop this build settles onto. That has
           to wait for the swap: loading a new source into the outgoing element
           blanks it, which was invisible behind a cut and would not be behind
           a fade. */
        activeVideo = transitionVideo
        settleVideo = outgoing
      }

      transitionVideo.loop = false
      transitionVideo.playbackRate = Number.isFinite(transition.playbackRate)
        ? transition.playbackRate
        : 1
      try { transitionVideo.currentTime = 0 } catch { /* Starts at its ready frame. */ }
      beginTransitionState(nextState, transition)
      fastForwardVideo = transitionVideo
      fastForwardBaseRate = transitionVideo.playbackRate
      await playVideo(transitionVideo)

      /* Decoding the clip this build settles onto is the heaviest thing the
         module does, and it used to start here, in the same frames as the copy
         entrance. Holding the copy off the media join fixed the join but not
         this: the decode began the moment the build started playing and ran
         straight through the entrance, which is what was left of the chug.

         The build has the runway to give it away. The shortest one is 7s and
         this costs it the 1.5s the copy takes to arrive, so the decode still
         has more than five seconds before the boundary waits on it. */
      const settlePreparation = afterDelay(
        MEASUREMENT_COPY_ENTRANCE_MS.total, controller.signal
      ).then(() => prepareVideo(settleVideo, settleMedia, {
        play: false,
        operationSignal: controller.signal
      }))

      await Promise.all([
        waitForMediaEnd(transitionVideo, { signal: controller.signal }),
        settlePreparation
      ])
      if (disposed || currentOperationId !== operationId || controller.signal.aborted) return
      await settleOn(nextState, settleVideo, settleMedia, currentOperationId, controller.signal)
    } finally {
      clearFastForward()
      signal?.removeEventListener?.('abort', abortFromHost)
      if (transitionController === controller) transitionController = null
    }
  }

  /* Move between two stable frames on different clips with no build between
     them. This is the opening edge, whose delivered build clip was a cross fade
     between two mismatched framings and nothing else, so the module fades the
     two frames itself. */
  async function playStableFade(nextState) {
    const currentOperationId = ++operationId
    transitionController?.abort()
    const controller = new AbortController()
    transitionController = controller
    const abortFromHost = () => controller.abort(signal?.reason)
    signal?.addEventListener?.('abort', abortFromHost, { once: true })
    beginPreparingState()

    try {
      const settleMedia = getMeasurementStoryStableMedia(nextState)
      const incoming = standbyVideo()
      const outgoing = activeVideo
      await prepareVideo(incoming, settleMedia, {
        play: !reducedMotion && settleMedia.loop === true,
        operationSignal: controller.signal
      })
      if (disposed || currentOperationId !== operationId || controller.signal.aborted) return

      beginTransitionState(nextState, { id: MEASUREMENT_STORY_TRANSITION_IDS.OPENING })
      await revealVideo(incoming, { join: 'shrink', operationSignal: controller.signal })
      if (disposed || currentOperationId !== operationId || controller.signal.aborted) return

      outgoing.pause()
      activeVideo = incoming
      state = nextState
      setStableCopy()
      prefetchNextBoundary()
    } finally {
      signal?.removeEventListener?.('abort', abortFromHost)
      if (transitionController === controller) transitionController = null
    }
  }

  async function moveForward() {
    if (disposed || root.dataset.phase !== 'stable') return
    onActivity?.()

    if (!canAdvanceMeasurementStory(state)) return

    const nextState = reduceMeasurementStoryState(state, {
      type: MEASUREMENT_STORY_EVENTS.NEXT
    })
    const transition = getMeasurementStoryForwardTransition(state, nextState)
    if (transition) {
      await playForwardTransition(nextState, transition)
      return
    }

    /* No build clip and a different clip underneath means the two frames have
       to be joined by the module rather than by the footage. */
    if (getMeasurementStoryStableMedia(nextState)?.src !== activeVideo.dataset.assetSrc) {
      await playStableFade(nextState)
      return
    }

    const titleHeld = STORY_COPY[nextState.stepId].title === STORY_COPY[state.stepId].title
    state = nextState
    setStableCopy({ advance: titleHeld ? 'body' : 'copy' })
    prefetchNextBoundary()
  }

  async function moveBack() {
    if (
      disposed ||
      (root.dataset.phase !== 'stable' && root.dataset.phase !== 'complete') ||
      state.stepIndex === 0
    ) return
    onActivity?.()
    const currentOperationId = ++operationId
    transitionController?.abort()
    transitionController = null
    upNextBanner?.withdraw()

    const previous = reduceMeasurementStoryState(state, {
      type: MEASUREMENT_STORY_EVENTS.BACK
    })
    const media = getMeasurementStoryStableMedia(previous)
    if (activeVideo.dataset.assetSrc === media.src) {
      state = previous
      setStableCopy({ replay: true })
      prefetchNextBoundary()
      return
    }

    beginPreparingState('Returning to the previous explanation.')
    const target = standbyVideo()
    const previousVideo = activeVideo
    try {
      await prepareVideo(target, media, { play: media.loop === true })
    } catch (error) {
      if (disposed || currentOperationId !== operationId) return
      throw error
    }
    if (disposed || currentOperationId !== operationId) return
    /* A step back lands on a frame that has nothing to do with the one on
       screen, so it is always faded. */
    await revealVideo(target)
    if (disposed || currentOperationId !== operationId) return
    previousVideo.pause()
    activeVideo = target
    state = previous
    setStableCopy({ replay: true })
    prefetchNextBoundary()
  }

  async function restart() {
    if (disposed || root.dataset.phase === 'loading') return
    onActivity?.()
    const currentOperationId = ++operationId
    transitionController?.abort()
    transitionController = null
    upNextBanner?.withdraw()
    root.dataset.phase = 'loading'
    clearFastForward()
    showContinue(false)
    root.setAttribute('aria-busy', 'true')
    nextButton.hidden = true
    updateKioskExplainer(explainer, { ariaHidden: true, visible: false })
    updateKioskExplainer(transitionExplainer, { ariaHidden: true, visible: false })

    state = reduceMeasurementStoryState(state, {
      type: MEASUREMENT_STORY_EVENTS.RESTART
    })
    const firstMedia = getMeasurementStoryStableMedia(state)
    const target = videos[0]
    await prepareVideo(target, firstMedia, { play: false })
    if (disposed || currentOperationId !== operationId) return
    await revealVideo(target)
    if (disposed || currentOperationId !== operationId) return
    for (const video of videos) {
      if (video !== target) video.pause()
    }
    activeVideo = target
    setStableCopy({ replay: true })
    prefetchNextBoundary()
  }

  function reportInteractionError(error) {
    if (error?.name === 'AbortError' || disposed) return
    console.error('The topological-qubit story could not advance.', error)
    root.dataset.phase = 'stable'
    root.dataset.mediaState = 'error'
    clearFastForward()
    showContinue(true)
    root.setAttribute('aria-busy', 'false')
    nextButton.hidden = false
    nextButton.disabled = false
    updateKioskExplainer(transitionExplainer, { ariaHidden: true, visible: false })
    updateKioskExplainer(explainer, { ariaHidden: false, visible: true })
    status.textContent = 'The animation could not load. You can try again or restart the module.'
  }

  nextButton.addEventListener('click', () => {
    void moveForward().catch(reportInteractionError)
  }, { signal: listeners.signal })

  root.addEventListener('pointerup', event => {
    if (
      event.defaultPrevented ||
      root.dataset.phase !== 'transition' ||
      event.target.closest('button, a, input, select, textarea') ||
      !fastForwardVideo ||
      fastForwarded ||
      fastForwardVideo.currentTime < 1
    ) return

    onActivity?.()
    fastForwarded = true
    fastForwardVideo.playbackRate = fastForwardBaseRate * 5
    root.dataset.fastForward = 'true'
    status.textContent = 'Fast-forwarding the current animation.'
  }, { signal: listeners.signal })

  root.querySelector('[data-mbqc-action="restart"]').addEventListener('click', () => {
    void restart().catch(reportInteractionError)
  }, { signal: listeners.signal })

  root.querySelector('[data-mbqc-action="exit"]').addEventListener('click', () => {
    onActivity?.()
    if (typeof navigate.menu === 'function') navigate.menu()
    else navigate.home?.()
  }, { signal: listeners.signal })

  root.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.repeat) return
    if (event.target.closest('button, a, input, select, textarea')) return
    if (['ArrowRight', 'PageDown', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      void moveForward().catch(reportInteractionError)
    } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
      event.preventDefault()
      void moveBack().catch(reportInteractionError)
    } else if (event.key === 'Home') {
      event.preventDefault()
      void restart().catch(reportInteractionError)
    }
  }, { signal: listeners.signal })

  const dispose = () => {
    if (disposed) return
    disposed = true
    operationId += 1
    transitionController?.abort()
    transitionController = null
    listeners.abort()
    mediaController.abort()
    clearFastForward()
    upNextBanner?.dispose()
    disposeKioskExplainer(explainer)
    disposeKioskExplainer(transitionExplainer)
    for (const video of videos) releaseVideoElement(video)
    if (root.parentNode === container) root.remove()
    signal?.removeEventListener?.('abort', dispose)
  }

  signal?.addEventListener?.('abort', dispose, { once: true })

  try {
    await prepareVideo(activeVideo, getMeasurementStoryStableMedia(state), { play: false })
    if (disposed) throw abortError(signal)
    showVideo(activeVideo)
    root.dataset.mediaState = 'ready'
    setStableCopy()
    prefetchNextBoundary()
  } catch (error) {
    dispose()
    throw error
  }

  return {
    dispose,
    /* The first frame is decoded before mount resolves. This hook gives the
       host one compositor frame as well when the module enters through a wipe. */
    presentationReady: () => new Promise(resolve => window.requestAnimationFrame(resolve))
  }
}
