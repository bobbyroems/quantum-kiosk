import { assetUrl } from '../../core/asset-url.js'
import { mountModuleOutro } from '../module-outro.js'
import { createKioskTooltip } from '../../core/kiosk-tooltip.js'
import { sound } from '../../core/kiosk-audio.js'
import {
  createVideoSeekQueue,
  waitForVideoReady
} from './media.js'
import {
  LAST_FRAME,
  MATTER_PHASES,
  TIMELINE_LAST_FRAME,
  clampFrame,
  clampProgress,
  frameForKeyboardKey,
  frameToProgress,
  phaseForFrame,
  progressToFrame,
  visualStateForFrame
} from './timeline.js'
import {
  mountStateShader,
  SCENE_SOURCE_HEIGHT,
  SCENE_SOURCE_WIDTH,
  WATER_MAP_HEIGHT,
  WATER_MAP_WIDTH
} from './state-shader.js'
import {
  createMatterVfxMotion,
  VFX_MOTION_FPS,
  VFX_MOTION_HEIGHT,
  VFX_MOTION_WIDTH
} from './vfx-motion.js'
import { mountVolumetricSteam } from './volumetric-steam.js'

const VIDEO_ASSET = 'assets/modules/states-of-matter/SoM_IceCube_4k_vertical.mp4'
const POSTER_ASSET = 'assets/modules/states-of-matter/som-poster.jpg'
const MICROSOFT_ASSET = 'assets/ui/microsoft-logo.png'
const RESTART_ASSET = 'assets/ui/restart.svg'
const EXIT_ASSET = 'assets/ui/exit-x.svg'

/* Blur applied to the footage at full fog. */
const FOG_BLUR_PX = 16

/*
 * How fast the scrubber is allowed to travel, in progress per second, however
 * fast the finger moves.
 *
 * Dragging mapped the pointer straight onto progress, so a flick across the
 * stage crossed the whole journey in a couple of hundred milliseconds: the ice
 * became steam with nothing legible in between, which is the one thing this
 * module exists to show. The pointer now sets a target and the scrubber travels
 * toward it under this cap, so melting and boiling both have time to read.
 */
const SCRUB_PROGRESS_PER_SECOND = 0.3
/* A single fast gesture should not skip the whole lesson even after release.
   Roughly one authored phase per grab keeps the intermediate states legible. */
const MAX_SCRUB_PROGRESS_PER_GESTURE = 0.3

const TIMELINE_WIDTH_PX = 1500
const KNOB_WIDTH_PX = 120
const KNOB_RADIUS_PX = 60
/* Progress 0 puts the knob flush with the left end of the track. Its centre
   therefore sits one radius in, which is as far left as a round knob can go
   without overhanging the rail. */
const KNOB_MIN_CENTER_PX = KNOB_RADIUS_PX
const KNOB_MIN_X_PX = KNOB_MIN_CENTER_PX - KNOB_RADIUS_PX
const KNOB_MAX_X_PX = TIMELINE_WIDTH_PX - KNOB_WIDTH_PX
const KNOB_VISUAL_TRAVEL_PX = KNOB_MAX_X_PX - KNOB_MIN_X_PX
const INFO_SOLID_HEIGHT_PX = 248
/* Four 75px lines plus 20px for font descenders and the copy transition. */
const COPY_LINE_HEIGHT_PX = 320
const INFO_COPY_HEIGHT_PX = 60 + 128 + 80 + COPY_LINE_HEIGHT_PX + 60

/* Copy is verbatim from the authored States of Matter frames (Figma 7:1992).
   Every phase now carries a paragraph — Solid used to be heading-only. */
/* Placeholder, pending IQM's copy for the fourth screen. */
/* Copy from the 25 Aug board (Figma 4:4363). The three everyday states share
   one sentence there rather than carrying three — the scrub is what changes
   between them, not the explanation — and the fourth state is where the copy
   turns over. */
const CLASSIC_INFO = 'We all know these everyday states of matter — solid, liquid, gas. Change the conditions, and matter changes with it.'
const TOPOCONDUCTOR_INFO = 'Microsoft created a brand-new one for quantum computing: the topoconductor. Quantum information is hidden inside the material itself — protected by physics.'

/* Mark both endpoints and each state transition using the scrubber's mapping. */
function mountTimelineTicks(element) {
  const stops = [
    ...MATTER_PHASES.map(phase => ({ id: phase.id, frame: phase.startFrame })),
    { id: 'end', frame: TIMELINE_LAST_FRAME }
  ]
  stops.forEach(stop => {
    const tick = document.createElement('span')
    tick.className = 'som__tick'
    tick.dataset.somTick = stop.id
    tick.style.setProperty('--som-tick-position', `${frameToProgress(stop.frame) * 100}%`)
    element.append(tick)
  })
}

function resolveMountArguments(container, options) {
  if (container?.root && !options) {
    return { container: container.root, options: container }
  }

  return { container, options: options || {} }
}

export async function mount(containerArgument, optionsArgument) {
  const { container, options } = resolveMountArguments(containerArgument, optionsArgument)
  if (!container?.replaceChildren) throw new TypeError('States of Matter requires a DOM container')

  const { signal, onActivity, navigate = {}, module } = options
  const listeners = new AbortController()
  let disposed = false
  let mediaReady = false
  let activePointerId = null
  let pointerMode = null
  let startX = 0
  let previousPointerX = 0
  let previousPointerY = 0
  let startProgress = 0
  let dragWidth = 1
  let pendingDragFrame = null
  let dragAnimationFrame = null
  /* Where the finger says the scrubber should be, and where it has actually
     been allowed to reach. See SCRUB_PROGRESS_PER_SECOND. */
  let scrubTargetProgress = 0
  let scrubProgress = 0
  let scrubTicker = null
  let scrubTickedAt = 0
  let rangePointerActive = false
  let rangeStartProgress = 0
  let requestedFrame = 0
  let frameRequested = false
  let announcedPhase = null
  let lastActivityAt = -Infinity

  const screen = document.createElement('section')
  screen.className = 'som'
  screen.dataset.phase = 'solid'
  screen.dataset.mediaState = 'loading'
  screen.style.setProperty('--som-progress', '0')
  screen.style.setProperty('--som-knob-x', `${KNOB_MIN_X_PX}px`)
  screen.style.setProperty('--som-progress-width', `${KNOB_MIN_CENTER_PX}px`)
  screen.setAttribute('aria-busy', 'true')
  screen.setAttribute('aria-labelledby', 'som-title')
  const asset = path => assetUrl(path)
  screen.innerHTML = `
    <div class="som__media" aria-hidden="true">
      <img class="som__poster" src="${asset(POSTER_ASSET)}" alt="" draggable="false">
      <video class="som__video" src="${asset(VIDEO_ASSET)}" muted playsinline preload="auto"></video>
      <canvas
        class="som__vfx-motion"
        width="${VFX_MOTION_WIDTH}"
        height="${VFX_MOTION_HEIGHT}"
        data-som-vfx-motion="ambient-accents"
        data-render-size="${VFX_MOTION_WIDTH}x${VFX_MOTION_HEIGHT}"
        data-target-fps="${VFX_MOTION_FPS}"
      ></canvas>
      <div class="som__wash"></div>
      <!-- The environmental treatment belongs to the footage plane. CSS places the
           shader above the scrubber but below navigation, copy, phase labels and
           interaction guidance. -->
      <canvas
        class="som__state-shader"
        data-som-state-shader="screen-effect"
        data-render-size="${SCENE_SOURCE_WIDTH}x${SCENE_SOURCE_HEIGHT}"
        data-water-map-size="${WATER_MAP_WIDTH}x${WATER_MAP_HEIGHT}"
        aria-hidden="true"
      ></canvas>
      <canvas
        class="som__steam-volume"
        data-som-steam-volume="interactive-water-steam"
        aria-hidden="true"
      ></canvas>
    </div>

    <nav class="microsoft-header som__nav" aria-label="Module controls">
      <div class="microsoft-brand som__brand" aria-label="Microsoft Quantum">
        <span class="microsoft-brand__logo som__microsoft">
          <img src="${asset(MICROSOFT_ASSET)}" alt="Microsoft" draggable="false">
        </span>
        <span class="microsoft-brand__divider som__brand-divider" aria-hidden="true"></span>
        <span class="microsoft-brand__quantum som__brand-quantum">Quantum</span>
      </div>
      <div class="microsoft-header__actions som__nav-actions">
        <button class="microsoft-header__action som__nav-action" type="button" data-som-action="restart">
          <span>Restart</span>
          <span class="microsoft-header__action-icon" aria-hidden="true">
            <img class="som__restart-icon" src="${asset(RESTART_ASSET)}" alt="" draggable="false">
          </span>
        </button>
        <button class="microsoft-header__action som__nav-action" type="button" data-som-action="exit">
          <span>Exit</span>
          <span class="microsoft-header__action-icon som__exit-mark" aria-hidden="true">
            <img class="som__exit-icon" src="${asset(EXIT_ASSET)}" alt="" draggable="false">
          </span>
        </button>
      </div>
    </nav>

    <article class="som__info">
      <h2 id="som-title" data-som-title>Classic states of matter</h2>
      <div class="som__info-copy" aria-live="polite">
        <p data-som-copy="solid">${CLASSIC_INFO}</p>
        <p data-som-copy="liquid">${CLASSIC_INFO}</p>
        <p data-som-copy="gas">${CLASSIC_INFO}</p>
        <p data-som-copy="topoconductor">${TOPOCONDUCTOR_INFO}</p>
      </div>
    </article>

    <!-- The screen the fourth stop reaches: the device itself, between the
         label and the scrubber. This is IQM's own topoconductor artwork, which
         replaced module 03's semiconductor inset — that was standing in, and
         was the wrong material. A still rather than a clip, as drawn. -->
    <section class="som__topoconductor" data-som-topoconductor aria-hidden="true">
      <img
        class="som__topoconductor-media"
        src="${asset('assets/modules/states-of-matter/topoconductor-device.jpg')}"
        alt=""
        draggable="false"
      >
    </section>

    <div class="som__title-group">
      <div class="som__active-phase" aria-hidden="true">
        <span data-som-phase="solid">Solid</span>
        <span data-som-phase="liquid">Liquid</span>
        <span data-som-phase="gas">Gas</span>
        <span data-som-phase="topoconductor">Topological qubit</span>
      </div>
    </div>

    <div class="som__timeline">
      <div class="som__track" aria-hidden="true"></div>
      <div class="som__progress" aria-hidden="true"></div>
      <div class="som__ticks" aria-hidden="true"></div>
      <div class="som__knob" aria-hidden="true"></div>
      <label class="som__range-label">
        <span class="som__sr-only">Explore the four states of matter</span>
        <input class="som__range" type="range" min="0" max="${TIMELINE_LAST_FRAME}" step="1" value="0" disabled>
      </label>
    </div>

    <p class="som__sr-only" data-som-media-status aria-live="polite">Preparing the states of matter video.</p>
    <p class="som__sr-only" data-som-status aria-live="polite">Solid.</p>
  `

  mountTimelineTicks(screen.querySelector('.som__ticks'))

  const matterTooltip = createKioskTooltip({
    ariaHidden: true,
    className: 'som__hint',
    text: 'Drag across the screen to shift the state'
  })
  screen.append(matterTooltip.element)

  const video = screen.querySelector('.som__video')
  const stateShaderCanvas = screen.querySelector('.som__state-shader')
  const steamVolumeCanvas = screen.querySelector('.som__steam-volume')
  const vfxMotionCanvas = screen.querySelector('.som__vfx-motion')
  const range = screen.querySelector('.som__range')
  const mediaStatus = screen.querySelector('[data-som-media-status]')
  const status = screen.querySelector('[data-som-status]')
  const liquidCopy = screen.querySelector('[data-som-copy="liquid"]')
  const gasCopy = screen.querySelector('[data-som-copy="gas"]')
  const topoconductorCopy = screen.querySelector('[data-som-copy="topoconductor"]')
  const screenTitle = screen.querySelector('[data-som-title]')

  /* Reaching the fourth state is the end of this module — there is nothing
     past it on the scrubber — so that is where the band offering the next one
     arrives. */
  /* The band states where the visitor is, then follows the registry route. */
  const upNextBanner = mountModuleOutro({
    module,
    root: screen,
    navigate,
    onActivity,
    onRestart: () => screen.querySelector('[data-som-action="restart"]')?.click()
  })
  const topoconductorScreen = screen.querySelector('[data-som-topoconductor]')

  container.replaceChildren(screen)

  /* Assigned once WebGL is up; stays null if the context could not be created,
     in which case the module runs without the effect layer. */
  let stateShader = null
  let steamVolume = null
  screen.dataset.steamRenderer = 'webgpu'

  const vfxMotion = createMatterVfxMotion(vfxMotionCanvas, {
    element: screen,
    initialWeights: { frost: 1, water: 0, fog: 0 }
  })

  const audioMixer = sound.createLoopMixer(
    ['matterSolidIce', 'matterLiquidWater', 'matterGasSteam'],
    { volume: 0.14, ambientDuck: 0.4, fadeSeconds: 0.4 }
  )

  /* The frame the overlay is drawn for. It deliberately leads the footage: labels,
     copy, shader weights and audio commit the moment the finger moves, while the
     decoder catches up a beat later. */
  let visualFrame = 0
  const applyVisualState = frame => {
    if (disposed) return
    const state = visualStateForFrame(frame)
    visualFrame = state.frame
    /* Solid carries a paragraph now too, so the block holds its full height
       across the whole scrub instead of growing out of a heading-only start. */
    const copyPresence = Math.min(1, state.copy.solid + state.copy.liquid + state.copy.gas + state.copy.topoconductor)
    const infoHeight = INFO_SOLID_HEIGHT_PX +
      ((INFO_COPY_HEIGHT_PX - INFO_SOLID_HEIGHT_PX) * copyPresence)
    const copyHeight = COPY_LINE_HEIGHT_PX * copyPresence

    /* The procedural gas layer remains a fallback until WebGPU compute is ready.
       Once the volume mounts, it fully replaces both legacy steam treatments. */
    const legacyVfx = steamVolume
      ? { ...state.vfx, fog: 0 }
      : state.vfx
    stateShader?.setWeights(legacyVfx)
    steamVolume?.setWeight(state.vfx.fog)

    screen.dataset.phase = state.phase.id
    screen.style.setProperty('--som-label-solid', String(state.labels.solid))
    screen.style.setProperty('--som-label-liquid', String(state.labels.liquid))
    screen.style.setProperty('--som-label-gas', String(state.labels.gas))
    screen.style.setProperty('--som-label-topoconductor', String(state.labels.topoconductor))
    screen.style.setProperty('--som-label-solid-y', `${(1 - state.labels.solid) * 20}px`)
    screen.style.setProperty('--som-label-liquid-y', `${(1 - state.labels.liquid) * 20}px`)
    screen.style.setProperty('--som-label-gas-y', `${(1 - state.labels.gas) * 20}px`)
    screen.style.setProperty('--som-label-topoconductor-y', `${(1 - state.labels.topoconductor) * 20}px`)
    screen.style.setProperty('--som-copy-solid', String(state.copy.solid))
    screen.style.setProperty('--som-copy-liquid', String(state.copy.liquid))
    screen.style.setProperty('--som-copy-gas', String(state.copy.gas))
    screen.style.setProperty('--som-copy-topoconductor', String(state.copy.topoconductor))
    screen.style.setProperty('--som-copy-solid-y', `${(1 - state.copy.solid) * -12}px`)
    screen.style.setProperty('--som-copy-liquid-y', `${(1 - state.copy.liquid) * -12}px`)
    screen.style.setProperty('--som-copy-gas-y', `${(1 - state.copy.gas) * 12}px`)
    screen.style.setProperty('--som-copy-topoconductor-y', `${(1 - state.copy.topoconductor) * 12}px`)
    screen.style.setProperty('--som-info-height', `${infoHeight}px`)
    screen.style.setProperty('--som-copy-height', `${copyHeight}px`)
    /* Only the fog step touches the footage, and only to blur it — that is the
       whole point of fog. The interface remains on a separate, clear layer. */
    screen.style.setProperty('--som-video-blur', `${state.vfx.fog * FOG_BLUR_PX}px`)
    screen.style.setProperty('--som-video-scale', String(1 + (state.vfx.fog * 0.02)))
    vfxMotion.setWeights(legacyVfx)

    liquidCopy.setAttribute('aria-hidden', String(state.phase.id !== 'liquid'))
    gasCopy.setAttribute('aria-hidden', String(state.phase.id !== 'gas'))
    topoconductorCopy.setAttribute('aria-hidden', String(state.phase.id !== 'topoconductor'))
    /* The heading turns over with the fourth state: the first three are the
       classic ones, and the last is the board's line introducing what follows
       them. */
    screenTitle.textContent = state.phase.id === 'topoconductor'
      ? 'But there are other states, too.'
      : 'Classic states of matter'
    topoconductorScreen.setAttribute('aria-hidden', String(state.labels.topoconductor < 0.5))
    /* Reaching the fourth state is the end of the module, so the band offering
       the next one arrives here. */
    if (state.phase.id === 'topoconductor') upNextBanner?.offer()
    if (mediaReady) {
      audioMixer.setWeights({
        matterSolidIce: state.audio.ice,
        matterLiquidWater: state.audio.water,
        matterGasSteam: state.audio.steam
      })
    }
  }

  /* The seek queue drives the shader's refraction source and nothing else. Only a
     landed video frame invalidates that texture; everything the visitor reads as
     "responding" is already on screen by the time this fires. */
  const seekQueue = createVideoSeekQueue(video, {
    onCommit: () => {
      if (disposed) return
      stateShader?.markSceneDirty()
    }
  })

  const stateShaderReady = mountStateShader(stateShaderCanvas, { element: screen, video })
    .then(controller => {
      if (disposed || !controller) {
        controller?.dispose()
        return null
      }
      stateShader = controller
      /* Seed the weights from the frame already on screen. */
      applyVisualState(visualFrame)
      return controller
    })
    .catch(error => {
      console.warn('States of Matter screen shader could not start.', error)
      return null
    })

  const steamVolumeReady = mountVolumetricSteam(steamVolumeCanvas, { element: screen })
    .then(controller => {
      if (disposed || !controller) {
        controller?.dispose()
        return null
      }
      steamVolume = controller
      if (mediaReady) steamVolume.start()
      applyVisualState(visualFrame)
      return controller
    })
    .catch(error => {
      console.warn('Volumetric water steam could not start; using the procedural fallback.', error)
      return null
    })

  const noteActivity = () => {
    screen.classList.add('som--engaged')
    const now = window.performance?.now?.() ?? Date.now()
    if (now - lastActivityAt >= 250) {
      lastActivityAt = now
      onActivity?.()
    }
  }

  const requestFrame = frame => {
    const nextFrame = clampFrame(frame)
    if (frameRequested && nextFrame === requestedFrame) return

    requestedFrame = nextFrame
    frameRequested = true
    const phase = phaseForFrame(requestedFrame)
    const progress = frameToProgress(requestedFrame)
    /* Virtual 0 begins 20% across the visual rail. The media/timeline frame remains
       a true zero; only the rendered control is inset. */
    const knobX = KNOB_MIN_X_PX + (progress * KNOB_VISUAL_TRAVEL_PX)

    screen.style.setProperty('--som-progress', String(progress))
    screen.style.setProperty('--som-knob-x', `${knobX}px`)
    screen.style.setProperty('--som-progress-width', `${knobX + KNOB_RADIUS_PX}px`)
    range.value = String(requestedFrame)
    range.setAttribute('aria-valuetext', `${phase.label}, frame ${requestedFrame + 1} of ${LAST_FRAME + 1}`)
    if (phase.id !== announcedPhase) {
      announcedPhase = phase.id
      status.textContent = `${phase.label}.`
    }
    /* The overlay is not gated on the decoder. A seek costs ~14ms on the all-intra
       master, and that is still a frame of lag the interface has no reason to
       inherit — the scrub reads as instant because every part that can be instant
       is. The footage lands underneath it. */
    applyVisualState(requestedFrame)
    seekQueue.request(requestedFrame)
  }

  const clampGestureTarget = (targetProgress, gestureStartProgress) => clampProgress(
    Math.min(
      gestureStartProgress + MAX_SCRUB_PROGRESS_PER_GESTURE,
      Math.max(gestureStartProgress - MAX_SCRUB_PROGRESS_PER_GESTURE, targetProgress)
    )
  )

  const onRangeInput = event => {
    noteActivity()
    if (!rangePointerActive) {
      requestFrame(event.currentTarget.valueAsNumber)
      return
    }

    const targetProgress = frameToProgress(event.currentTarget.valueAsNumber)
    scrubTargetProgress = clampGestureTarget(targetProgress, rangeStartProgress)
    /* The native range is visually hidden. Keep its internal value aligned with
       the throttled thumb instead of leaving it at the finger's uncapped jump. */
    event.currentTarget.value = String(requestedFrame)
    startScrubTicker()
  }

  const onRangeInteractionStart = event => {
    if (event.button !== undefined && event.button !== 0) return
    rangePointerActive = true
    rangeStartProgress = frameToProgress(requestedFrame)
    scrubProgress = rangeStartProgress
    scrubTargetProgress = rangeStartProgress
    scrubTickedAt = 0
    stopScrubTicker()
    vfxMotion.setInteractionActive(true)
  }

  const onRangeInteractionEnd = () => {
    rangePointerActive = false
    vfxMotion.setInteractionActive(false)
  }

  const onRangeKeyDown = event => {
    const nextFrame = frameForKeyboardKey(event.key, requestedFrame)
    if (nextFrame === null) return
    event.preventDefault()
    noteActivity()
    requestFrame(nextFrame)
  }

  const flushDragFrame = () => {
    dragAnimationFrame = null
    if (disposed || pendingDragFrame === null) return

    const frame = pendingDragFrame
    pendingDragFrame = null
    requestFrame(frame)
  }

  const scheduleDragFrame = frame => {
    pendingDragFrame = frame
    if (dragAnimationFrame !== null) return
    dragAnimationFrame = window.requestAnimationFrame(flushDragFrame)
  }

  const commitPendingDragFrame = () => {
    if (pendingDragFrame === null) return
    if (dragAnimationFrame !== null) window.cancelAnimationFrame(dragAnimationFrame)
    dragAnimationFrame = null
    flushDragFrame()
  }

  const stopScrubTicker = () => {
    if (scrubTicker === null) return
    window.cancelAnimationFrame(scrubTicker)
    scrubTicker = null
  }

  /* Walks the scrubber toward wherever the finger has asked for, never faster
     than SCRUB_PROGRESS_PER_SECOND. It keeps running after release so a flick
     still arrives where it was thrown, rather than stopping wherever the finger
     happened to leave the glass. */
  const advanceScrub = timestamp => {
    scrubTicker = null
    if (disposed) return

    const elapsed = scrubTickedAt ? (timestamp - scrubTickedAt) / 1000 : 0
    scrubTickedAt = timestamp

    const remaining = scrubTargetProgress - scrubProgress
    /* A frame is one step; below it there is nothing left to travel. */
    const step = SCRUB_PROGRESS_PER_SECOND * Math.min(elapsed, 0.1)
    if (Math.abs(remaining) <= step) scrubProgress = scrubTargetProgress
    else scrubProgress += Math.sign(remaining) * step

    scheduleDragFrame(progressToFrame(scrubProgress))

    if (scrubProgress !== scrubTargetProgress) startScrubTicker()
    else scrubTickedAt = 0
  }

  function startScrubTicker() {
    if (scrubTicker !== null || disposed) return
    scrubTicker = window.requestAnimationFrame(advanceScrub)
  }

  const onPointerDown = event => {
    if (!mediaReady || (event.button !== undefined && event.button !== 0)) return
    if (event.target.closest('button, input')) return

    activePointerId = event.pointerId
    pointerMode = steamVolume && screen.dataset.phase === 'gas'
      ? 'steam'
      : 'scrub'
    startX = event.clientX
    startProgress = frameToProgress(requestedFrame)
    /* A new grab starts from where the scrubber actually is, so interrupting a
       flick mid-travel takes over from that point rather than snapping. */
    scrubProgress = startProgress
    scrubTargetProgress = startProgress
    scrubTickedAt = 0
    stopScrubTicker()
    dragWidth = screen.getBoundingClientRect().width || 1
    previousPointerX = event.clientX
    previousPointerY = event.clientY
    screen.classList.toggle('som--dragging', pointerMode === 'scrub')
    screen.classList.toggle('som--stirring', pointerMode === 'steam')
    vfxMotion.setInteractionActive(true)
    try {
      screen.setPointerCapture?.(activePointerId)
    } catch {
      // The interaction still works while the pointer remains over the stage.
    }
    noteActivity()
    event.preventDefault()
  }

  const onPointerMove = event => {
    if (event.pointerId !== activePointerId) return

    const bounds = screen.getBoundingClientRect()
    if (pointerMode === 'steam') {
      steamVolume?.stir({
        x: event.clientX,
        y: event.clientY,
        dx: event.clientX - previousPointerX,
        dy: event.clientY - previousPointerY,
        bounds
      })
    }
    previousPointerX = event.clientX
    previousPointerY = event.clientY

    if (pointerMode === 'steam') {
      noteActivity()
      event.preventDefault()
      return
    }

    /* The pointer sets the destination; the ticker decides how fast the
       scrubber is allowed to get there. */
    scrubTargetProgress = clampGestureTarget(
      startProgress + ((event.clientX - startX) / dragWidth),
      startProgress
    )
    noteActivity()
    startScrubTicker()
    event.preventDefault()
  }

  const finishPointer = event => {
    if (event.pointerId !== activePointerId) return

    if (pointerMode === 'scrub') commitPendingDragFrame()
    if (screen.hasPointerCapture?.(activePointerId)) {
      try {
        screen.releasePointerCapture(activePointerId)
      } catch {
        // Capture may already have been released by the browser.
      }
    }
    activePointerId = null
    pointerMode = null
    screen.classList.remove('som--dragging')
    screen.classList.remove('som--stirring')
    vfxMotion.setInteractionActive(false)
  }

  const onLostPointerCapture = event => {
    if (event.pointerId !== activePointerId) return
    if (pointerMode === 'scrub') commitPendingDragFrame()
    activePointerId = null
    pointerMode = null
    screen.classList.remove('som--dragging')
    screen.classList.remove('som--stirring')
    vfxMotion.setInteractionActive(false)
  }

  const onNavClick = event => {
    const action = event.currentTarget.dataset.somAction
    noteActivity()

    if (action === 'restart') {
      /* Back to the first state, so the band goes back to naming this module.
         Left standing, the offer outlived the run that earned it and sat over a
         module the visitor had just started again. */
      upNextBanner?.withdraw()
      stopScrubTicker()
      scrubProgress = 0
      scrubTargetProgress = 0
      scrubTickedAt = 0
      rangePointerActive = false
      frameRequested = false
      requestFrame(0)
      screen.classList.remove('som--engaged')
      return
    }

    if (action === 'exit') {
      if (typeof navigate.menu === 'function') navigate.menu()
      else navigate.home?.()
    }
  }

  range.addEventListener('input', onRangeInput, { signal: listeners.signal })
  range.addEventListener('change', noteActivity, { signal: listeners.signal })
  range.addEventListener('change', onRangeInteractionEnd, { signal: listeners.signal })
  range.addEventListener('keydown', onRangeKeyDown, { signal: listeners.signal })
  range.addEventListener('pointerdown', onRangeInteractionStart, { signal: listeners.signal })
  range.addEventListener('pointerup', onRangeInteractionEnd, { signal: listeners.signal })
  range.addEventListener('pointercancel', onRangeInteractionEnd, { signal: listeners.signal })
  range.addEventListener('blur', onRangeInteractionEnd, { signal: listeners.signal })
  screen.addEventListener('pointerdown', onPointerDown, { signal: listeners.signal })
  screen.addEventListener('pointermove', onPointerMove, { signal: listeners.signal })
  screen.addEventListener('pointerup', finishPointer, { signal: listeners.signal })
  screen.addEventListener('pointercancel', finishPointer, { signal: listeners.signal })
  screen.addEventListener('lostpointercapture', onLostPointerCapture, { signal: listeners.signal })
  screen.querySelectorAll('[data-som-action]').forEach(button => {
    button.addEventListener('click', onNavClick, { signal: listeners.signal })
  })

  const dispose = () => {
    if (disposed) return
    disposed = true
    upNextBanner?.dispose()
    mediaReady = false

    if (activePointerId !== null && screen.hasPointerCapture?.(activePointerId)) {
      try {
        screen.releasePointerCapture(activePointerId)
      } catch {
        // Capture may already have been released by the browser.
      }
    }
    activePointerId = null
    pointerMode = null
    pendingDragFrame = null
    if (dragAnimationFrame !== null) window.cancelAnimationFrame(dragAnimationFrame)
    dragAnimationFrame = null
    stopScrubTicker()
    listeners.abort()
    seekQueue.dispose()
    vfxMotion.dispose()
    /* The shader may still be resolving its dynamic three import; the pending
       chain sees `disposed` and tears down whatever it created. */
    stateShader?.dispose()
    stateShader = null
    steamVolume?.dispose()
    steamVolume = null
    void stateShaderReady
    void steamVolumeReady
    audioMixer.dispose()
    video.pause()
    video.removeAttribute('src')
    video.load()
    if (screen.parentNode === container) screen.remove()
    signal?.removeEventListener?.('abort', dispose)
  }

  signal?.addEventListener?.('abort', dispose, { once: true })
  applyVisualState(0)
  requestFrame(0)

  try {
    await waitForVideoReady(video, { signal })
    if (disposed) throw new DOMException('States of Matter was disposed.', 'AbortError')

    mediaReady = true
    steamVolume?.start()
    range.disabled = false
    screen.dataset.mediaState = 'ready'
    screen.classList.add('som--media-ready')
    screen.setAttribute('aria-busy', 'false')
    mediaStatus.textContent = 'The states of matter video is ready.'
    seekQueue.request(requestedFrame)
    return dispose
  } catch (error) {
    dispose()
    throw error
  }
}
