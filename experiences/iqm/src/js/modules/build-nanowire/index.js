import { assetUrl } from '../../core/asset-url.js'
import { sound } from '../../core/kiosk-audio.js'
import {
  createKioskExplainer,
  disposeKioskExplainer,
  updateKioskExplainer
} from '../../core/kiosk-explainer.js'
import { createKioskTooltip, updateKioskTooltip } from '../../core/kiosk-tooltip.js'
import {
  NANOWIRE_EVENTS,
  NANOWIRE_LOUPE_TARGETING,
  NANOWIRE_PHASES,
  createLoupeFrameQueue,
  createLoupePointerMapping,
  isDownwardSwipe,
  mapLoupePointer,
  nextNanowirePhase,
  resolveLoupeCenteringProgress,
  resolveLoupeMagneticPull,
  resolveLoupeTarget
} from './interaction.js'
import { createNanowireScene } from './nanowire-scene.js'
import { mountModuleOutro } from '../module-outro.js'
import {
  acquireNanowireScene,
  createNanowireAbortError
} from './scene-mount.js'

const LOUPE_RADIUS = 262
const LOUPE_LABEL_CLEARANCE = 168
/* Nothing in this module may enter the bottom 30% of the stage: stage y 2688,
   which is 2568 here because .nw__experience starts 120px down under the
   header. The loupe is the only element a visitor can move, so it and its
   label are clamped. */
const SAFE_BOTTOM_Y = 2568
const INITIAL_LOUPE_POSITION = Object.freeze({ x: 1660, y: 1580 })
const FINAL_COPY_READING_LEAD_MS = 1_800
const FOUND_CONFIRMATION_HOLD_MS = 1_400
const CORRECTION_CONFIRMATION_HOLD_MS = 2_600
const REPAIR_EXIT_FADE_MS = 420
export const NANOWIRE_COPY = Object.freeze({
  intro: Object.freeze({
    title: 'Build a qubit atom-by-atom',
    body: 'There’s no factory for this. Microsoft grows these materials atom-by-atom, placing each one where it belongs.',
    tooltip: 'Tap the atom to start'
  }),
  ready: Object.freeze({
    title: 'Why so precise?',
    body: 'In a topological qubit, the quantum information is protected by the structure of the material itself. So the structure must be flawless.',
    tooltip: 'Swipe down to snap all layers into place'
  }),
  defect: Object.freeze({
    title: 'Can you find the defect?',
    body: 'It looks like there\'s a defect in this qubit. At the atomic scale, even tiny imperfections can affect the entire device.',
    tooltip: 'Scan the qubit for defects'
  }),
  finale: Object.freeze({
    title: 'Every atom in place',
    body: 'In real life, there’s no “Correct” button. In the lab, a qubit with defects is simply unusable. You can’t repair it.',
    footer: 'Microsoft has spent years building up expertise to grow near-flawless quantum material on demand, not by luck.'
  })
})

function moduleMarkup() {
  const microsoftLogo = assetUrl('assets/ui/microsoft-logo.png')
  const restartIcon = assetUrl('assets/ui/restart.svg')
  const exitIcon = assetUrl('assets/ui/exit-x.svg')
  const correctCheck = assetUrl('assets/modules/build-nanowire/correct-check.svg')

  return `
    <section class="nw" data-nw-root data-phase="loading" data-intro-stage="atom" data-complete="false" aria-labelledby="nw-title">
      <header class="microsoft-header nw__header">
        <div class="microsoft-brand" aria-label="Microsoft Quantum">
          <span class="microsoft-brand__logo" aria-hidden="true">
            <img src="${microsoftLogo}" alt="" draggable="false">
          </span>
          <span class="microsoft-brand__divider" aria-hidden="true"></span>
          <span class="microsoft-brand__quantum">Quantum</span>
        </div>
        <div class="microsoft-header__actions">
          <button class="microsoft-header__action" type="button" data-nw-action="restart">
            <span>Restart</span>
            <span class="microsoft-header__action-icon" aria-hidden="true"><img src="${restartIcon}" alt=""></span>
          </button>
          <button class="microsoft-header__action" type="button" data-nw-action="exit">
            <span>Exit</span>
            <span class="microsoft-header__action-icon" aria-hidden="true"><img src="${exitIcon}" alt=""></span>
          </button>
        </div>
      </header>

      <div class="nw__experience" data-nw-experience tabindex="0">
        <h1 class="nw__sr-only" id="nw-title">Building a nanowire</h1>
        <div class="nw__backdrop nw__backdrop--perturbation" aria-hidden="true"></div>
        <div class="nw__backdrop nw__backdrop--repair" aria-hidden="true"></div>
        <div class="nw__scene" data-nw-scene></div>
        <div class="nw__scene-wash" aria-hidden="true"></div>
        <button class="nw__atom-start" type="button" data-nw-action="start" aria-label="Start building the qubit" hidden></button>

        <div
          class="nw__loupe"
          data-nw-loupe
          role="group"
          aria-label="Magnifying glass. Drag it over the nanowire to find the defective atom."
          aria-hidden="true"
          tabindex="-1"
        >
          <span class="nw__loupe-visual">
            <span class="nw__loupe-glass">
              <span class="nw__loupe-view" data-nw-loupe-view></span>
            </span>
            <span class="nw__loupe-frame" aria-hidden="true"></span>
            <!-- Invisible grip over the handle the frame bitmap draws. The
                 frame reaches far outside the loupe's own box and cannot take
                 pointer events, so without this the handle is the one part of a
                 magnifier a hand reaches for and the only part it cannot. -->
            <span class="nw__loupe-grip" aria-hidden="true"></span>
          </span>
          <span class="nw__found" aria-hidden="true" hidden>Found the defect!</span>
          <span class="nw__corrected" aria-hidden="true" hidden>
            <span>Defect fixed</span>
            <span class="nw__action-check" aria-hidden="true"><img src="${correctCheck}" alt=""></span>
          </span>
        </div>

        <!-- Completion is announced, not offered as a control: the header's Exit
             already returns to the module menu. -->
        <div class="nw__completion" data-nw-completion hidden aria-label="Experience complete">
          <p class="nw__sr-only">Experience complete. The nanowire is ready.</p>
        </div>

        <p class="nw__status nw__sr-only" data-nw-status aria-live="polite">Loading the nanowire.</p>
      </div>
    </section>
  `
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const easeOut = value => 1 - Math.pow(1 - clamp(value, 0, 1), 3)

export async function mount(container, options = {}) {
  if (!container?.replaceChildren) throw new TypeError('Building a Nanowire requires a DOM container')
  const { signal, navigate = {}, onActivity, module } = options
  if (signal?.aborted) throw createNanowireAbortError()

  const shell = document.createElement('div')
  shell.innerHTML = moduleMarkup().trim()
  const root = shell.firstElementChild
  container.replaceChildren(root)

  const experience = root.querySelector('[data-nw-experience]')
  const sceneHost = root.querySelector('[data-nw-scene]')
  const explainer = createKioskExplainer({
    className: 'nw__prompt',
    headingLevel: 2,
    hidden: true,
    visible: false,
    ariaHidden: true,
    variant: 'plain'
  })
  const instruction = createKioskTooltip({
    className: 'kiosk-tooltip--blue nw__instruction',
    hidden: true,
    ariaHidden: true
  })
  const instructionArrow = document.createElement('img')
  instructionArrow.className = 'nw__instruction-arrow'
  instructionArrow.src = assetUrl('assets/modules/build-nanowire/swipe-down-arrow.svg')
  instructionArrow.alt = ''
  instructionArrow.draggable = false
  instructionArrow.setAttribute('aria-hidden', 'true')
  instruction.element.append(instructionArrow)
  experience.append(explainer.element, instruction.element)
  const status = root.querySelector('[data-nw-status]')
  const loupe = root.querySelector('[data-nw-loupe]')
  const loupeView = root.querySelector('[data-nw-loupe-view]')
  const loupeFrame = root.querySelector('.nw__loupe-frame')
  const foundBadge = root.querySelector('.nw__found')
  const startButton = root.querySelector('[data-nw-action="start"]')
  const completion = root.querySelector('[data-nw-completion]')

  /* Offered once the wire is finished, so the visitor can carry straight on
     rather than going back out to the carousel. What follows comes from the
     registry, so the run order stays in one place. */
  /* The band states where the visitor is, then follows the registry route. */
  const upNextBanner = mountModuleOutro({
    module,
    root,
    navigate,
    onActivity,
    onRestart: () => root.querySelector('[data-nw-action="restart"]')?.click()
  })
  const correctedBadge = root.querySelector('.nw__corrected')
  loupeFrame.style.setProperty(
    '--nw-loupe-asset-image',
    `url("${assetUrl('assets/modules/build-nanowire/loupe2.png')}")`
  )
  const listeners = new AbortController()
  const timers = new Map()
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  let phase = NANOWIRE_PHASES.loading
  let scene = null
  let disposed = false
  let swipeStart = null
  let loupeDrag = null
  const loupePosition = { ...INITIAL_LOUPE_POSITION }
  const pointerPoint = { x: 0, y: 0, time: 0 }
  const magneticPoint = { x: 0, y: 0, distance: Infinity, amount: 0 }
  let experienceWidth = Math.max(experience.offsetWidth, 1)
  let experienceHeight = Math.max(experience.offsetHeight, 1)
  let uiRaf = null
  let uiMotionFinish = null
  let startTargetRaf = null
  let lastActivityAt = -Infinity

  const noteActivity = () => {
    const now = performance.now()
    if (now - lastActivityAt < 180) return
    lastActivityAt = now
    onActivity?.()
  }

  const transition = event => {
    const nextPhase = nextNanowirePhase(phase, event)
    if (nextPhase === phase) return false
    phase = nextPhase
    root.dataset.phase = phase
    return true
  }

  const stopStartTargetTracking = () => {
    if (startTargetRaf !== null) cancelAnimationFrame(startTargetRaf)
    startTargetRaf = null
  }

  const trackStartTarget = () => {
    startTargetRaf = null
    if (disposed || phase !== NANOWIRE_PHASES.awaitingStart) return
    const point = scene?.getOpeningAtomScreenPosition()
    if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) {
      startButton.style.setProperty('--nw-atom-start-x', `${point.x}px`)
      startButton.style.setProperty('--nw-atom-start-y', `${point.y}px`)
      startButton.hidden = false
    }
    /* The atom floats while waiting, so its transparent hit target follows the
       rendered centre rather than merely matching one static screenshot. */
    startTargetRaf = requestAnimationFrame(trackStartTarget)
  }

  const setExplainer = (copy, options = {}) => {
    const visible = Boolean(copy)
    explainer.element.classList.toggle('nw__prompt--defect', copy === NANOWIRE_COPY.defect)
    updateKioskExplainer(explainer, {
      title: copy?.title ?? '',
      body: copy?.body ?? '',
      footer: copy?.footer ?? '',
      layout: options.layout ?? 'stacked',
      variant: options.variant ?? 'plain',
      media: options.media ?? null,
      visible,
      ariaHidden: !visible,
      replay: options.replay ?? false
    })
  }

  const setInstruction = (copy, replay = false) => {
    instruction.element.classList.toggle(
      'has-swipe-arrow',
      copy === NANOWIRE_COPY.ready.tooltip
    )
    updateKioskTooltip(instruction, { text: copy, visible: Boolean(copy), replay })
  }

  const setStatus = message => {
    status.textContent = message
  }

  const measurePointerMapping = (out = {}) => {
    experienceWidth = Math.max(experience.offsetWidth, 1)
    experienceHeight = Math.max(experience.offsetHeight, 1)
    const bounds = experience.getBoundingClientRect()
    return createLoupePointerMapping(bounds, experienceWidth, experienceHeight, out)
  }

  const toDesignPoint = (event, mapping, out = pointerPoint) => mapLoupePointer(
    event.clientX,
    event.clientY,
    event.timeStamp,
    mapping,
    out
  )

  const getLatestPointerSample = event => {
    const samples = event.getCoalescedEvents?.()
    return samples?.length ? samples[samples.length - 1] : event
  }

  const clampLoupeX = (x, allowOffscreen = false) => allowOffscreen
    ? x
    : clamp(x, LOUPE_RADIUS, experienceWidth - LOUPE_RADIUS)

  const clampLoupeY = y => {
    const lowestY = Math.min(
      experienceHeight - LOUPE_RADIUS,
      SAFE_BOTTOM_Y - LOUPE_RADIUS - LOUPE_LABEL_CLEARANCE
    )
    return clamp(y, LOUPE_RADIUS, lowestY)
  }

  const setLoupePosition = (x, y, allowOffscreen = false) => {
    const nextX = clampLoupeX(x, allowOffscreen)
    const nextY = clampLoupeY(y)
    loupePosition.x = nextX
    loupePosition.y = nextY
    loupe.style.setProperty('--nw-loupe-x', `${nextX}px`)
    loupe.style.setProperty('--nw-loupe-y', `${nextY}px`)
    scene?.setMagnifierPosition(nextX, nextY)
  }

  const wait = duration => new Promise(resolve => {
    const timer = window.setTimeout(() => {
      timers.delete(timer)
      resolve()
    }, duration)
    timers.set(timer, resolve)
  })

  const cancelUiMotion = () => {
    if (uiRaf !== null) cancelAnimationFrame(uiRaf)
    uiRaf = null
    const finish = uiMotionFinish
    uiMotionFinish = null
    finish?.(false)
  }

  const animateLoupeTo = (x, y, options = {}) => {
    cancelUiMotion()
    if (disposed) return Promise.resolve(false)

    const duration = Math.max(options.duration ?? 0, 0)
    const allowOffscreen = options.allowOffscreen ?? false
    const distance = Math.hypot(x - loupePosition.x, y - loupePosition.y)
    if (reducedMotion || duration === 0 || distance < 0.5) {
      setLoupePosition(x, y, allowOffscreen)
      return Promise.resolve(true)
    }

    const fromX = loupePosition.x
    const fromY = loupePosition.y
    const startedAt = performance.now()
    return new Promise(resolve => {
      let finished = false
      const finish = result => {
        if (finished) return
        finished = true
        if (uiMotionFinish === finish) uiMotionFinish = null
        uiRaf = null
        resolve(result)
      }
      uiMotionFinish = finish

      const move = now => {
        if (disposed) {
          finish(false)
          return
        }
        const elapsed = now - startedAt
        const progress = options.easing === 'centering'
          ? resolveLoupeCenteringProgress(elapsed, NANOWIRE_LOUPE_TARGETING)
          : easeOut(elapsed / duration)
        setLoupePosition(
          fromX + ((x - fromX) * progress),
          fromY + ((y - fromY) * progress),
          allowOffscreen
        )
        if (progress >= 1) {
          setLoupePosition(x, y, allowOffscreen)
          finish(true)
          return
        }
        uiRaf = requestAnimationFrame(move)
      }
      uiRaf = requestAnimationFrame(move)
    })
  }

  const glideLoupeAway = async () => {
    const moved = await animateLoupeTo(
      experienceWidth + LOUPE_RADIUS,
      loupePosition.y,
      { duration: 820, allowOffscreen: true }
    )
    if (!moved || disposed) return false
    scene?.setMagnifierVisible(false)
    loupe.setAttribute('aria-hidden', 'true')
    loupe.tabIndex = -1
    return true
  }

  const lockLoupeToDefect = async defectPosition => {
    const pointerId = loupeDrag?.pointerId
    loupeMoveQueue.cancel()
    loupeDrag = null
    loupe.classList.remove('is-dragging')
    if (pointerId !== undefined) releaseCapturedPointer(loupe, pointerId)
    loupe.classList.add('is-locking')
    const centred = await animateLoupeTo(defectPosition.x, defectPosition.y, {
      duration: NANOWIRE_LOUPE_TARGETING.centeringDuration,
      easing: 'centering'
    })
    loupe.classList.remove('is-locking')
    if (!centred || disposed || phase !== NANOWIRE_PHASES.targeted) return

    loupe.classList.add('is-locked')
    scene?.setMagnifierDefectLock(true)
    foundBadge.hidden = false
    setInstruction('')
    setStatus('Defect found. The magnifying glass is locked on the faulty atom while it calibrates.')
    sound.pop()
    await wait(reducedMotion ? 80 : FOUND_CONFIRMATION_HOLD_MS)
    if (disposed || phase !== NANOWIRE_PHASES.targeted) return
    await correctDefect()
  }

  const updateLoupeAlignment = () => {
    if (phase !== NANOWIRE_PHASES.inspect) return false
    const defectPosition = scene?.getDefectScreenPosition()
    if (!defectPosition) return false
    const target = resolveLoupeTarget(loupePosition, defectPosition, {
      lockRadius: NANOWIRE_LOUPE_TARGETING.lockRadius
    })
    loupe.classList.toggle('is-near-defect', target.distance < LOUPE_RADIUS * 0.72)
    if (!target.targeted || !transition(NANOWIRE_EVENTS.targeted)) return false
    void lockLoupeToDefect(defectPosition)
    return true
  }

  const loupeMoveQueue = createLoupeFrameQueue((x, y) => {
    if (
      disposed
      || !loupeDrag
      || phase !== NANOWIRE_PHASES.inspect
    ) return
    setLoupePosition(x, y)
    updateLoupeAlignment()
  }, {
    requestFrame: callback => window.requestAnimationFrame(callback),
    cancelFrame: frame => window.cancelAnimationFrame(frame),
    stageLatest: (x, y) => scene?.setMagnifierPosition(x, y)
  })

  const scheduleLoupeMove = (x, y) => {
    const clampedX = clampLoupeX(x)
    const clampedY = clampLoupeY(y)
    const defectPosition = scene?.getDefectScreenPosition()
    if (!defectPosition || phase !== NANOWIRE_PHASES.inspect) {
      return loupeMoveQueue.schedule(clampedX, clampedY)
    }
    resolveLoupeMagneticPull(
      { x: clampedX, y: clampedY },
      defectPosition,
      NANOWIRE_LOUPE_TARGETING,
      magneticPoint
    )
    return loupeMoveQueue.schedule(
      clampLoupeX(magneticPoint.x),
      clampLoupeY(magneticPoint.y)
    )
  }

  const beginInspection = () => {
    if (!transition(NANOWIRE_EVENTS.scanned)) return
    setExplainer(NANOWIRE_COPY.defect, { replay: true })
    setInstruction(NANOWIRE_COPY.defect.tooltip, true)
    setStatus('Drag the magnifying glass across the nanowire to inspect the atoms.')
    loupe.setAttribute('aria-hidden', 'false')
    loupe.tabIndex = 0
    loupe.classList.remove('has-interacted', 'is-locking', 'is-locked')
    foundBadge.hidden = true
    correctedBadge.hidden = true
    setLoupePosition(INITIAL_LOUPE_POSITION.x, INITIAL_LOUPE_POSITION.y)
    scene?.beginInspection()
    scene?.setMagnifierVisible(true)
    sound.whoosh()
  }

  const runIntroFlow = async () => {
    if (!scene || phase !== NANOWIRE_PHASES.intro) return
    root.dataset.introStage = 'atom'
    setExplainer(null)
    setInstruction('')
    startButton.hidden = true
    setStatus('A single atom begins the nanowire.')
    const played = await scene.playIntro({
      onStage: stage => {
        if (disposed || stage === 'complete') return
        root.dataset.introStage = stage
      }
    })
    if (disposed || !played || !transition(NANOWIRE_EVENTS.introduced)) return

    root.dataset.introStage = 'complete'
    setExplainer(NANOWIRE_COPY.ready, {
      layout: 'split',
      variant: 'glass',
      media: {
        src: assetUrl('assets/modules/build-nanowire/precision-microscope.png'),
        alt: 'Microscope view of an atomically precise material lattice'
      },
      replay: true
    })
    setInstruction(NANOWIRE_COPY.ready.tooltip, true)
    setStatus('Swipe down once to attach all four layers together.')
  }

  const startIntro = () => {
    if (!transition(NANOWIRE_EVENTS.started)) return false
    stopStartTargetTracking()
    noteActivity()
    void runIntroFlow()
    return true
  }

  const runBuildFlow = async () => {
    if (!scene || !transition(NANOWIRE_EVENTS.swiped)) return
    setInstruction('')
    setStatus('All four atomic layers are falling into place together.')
    sound.whoosh()
    await scene.buildAllLayers()
    if (disposed || !transition(NANOWIRE_EVENTS.assembled)) return

    setExplainer(NANOWIRE_COPY.defect, { replay: true })
    setInstruction(NANOWIRE_COPY.defect.tooltip, true)
    setStatus('Scanning the assembled nanowire for atomic errors.')
    sound.chime()
    await scene.scanForDefect()
    if (disposed) return
    beginInspection()
  }

  const correctDefect = async () => {
    if (!scene || !transition(NANOWIRE_EVENTS.correct)) return
    setInstruction('')
    setStatus('Calibrating the atom positions around the defect.')
    await scene.repairDefect()
    if (disposed || !transition(NANOWIRE_EVENTS.repaired)) return

    foundBadge.hidden = true
    correctedBadge.hidden = false
    setExplainer(null)
    setStatus('Defect fixed. The repaired atom is gray and confirmed with a green glow.')
    sound.chime()
    await wait(reducedMotion ? 120 : CORRECTION_CONFIRMATION_HOLD_MS)
    if (disposed) return
    scene?.setMagnifierDefectLock(false)
    await glideLoupeAway()
    if (disposed) return
    root.dataset.repairExit = 'true'
    await wait(reducedMotion ? 1 : REPAIR_EXIT_FADE_MS)
    if (disposed || !transition(NANOWIRE_EVENTS.finalized)) return
    root.dataset.repairExit = 'false'
    correctedBadge.hidden = true
    const finalStartedAt = performance.now()
    scene?.beginFinalFlow(finalStartedAt)
    setExplainer(NANOWIRE_COPY.finale, { replay: true })
    await wait(FINAL_COPY_READING_LEAD_MS)
    if (disposed) return
    upNextBanner?.offer()
    await wait(reducedMotion ? 80 : 900)
    if (disposed) return
    transition(NANOWIRE_EVENTS.completed)
    root.dataset.complete = 'true'
    completion.hidden = false
    setStatus('Experience complete. Return to the module menu when you are ready.')
  }

  const releaseCapturedPointer = (element, pointerId) => {
    if (!element.hasPointerCapture?.(pointerId)) return
    element.releasePointerCapture(pointerId)
  }

  const abortMount = () => {
    if (disposed) return
    disposed = true
    listeners.abort()
    for (const [timer, resolve] of timers) {
      window.clearTimeout(timer)
      resolve()
    }
    timers.clear()
    loupeMoveQueue.cancel()
    cancelUiMotion()
    stopStartTargetTracking()
    upNextBanner?.dispose()
    disposeKioskExplainer(explainer)
    scene?.dispose()
    scene = null
  }
  signal?.addEventListener('abort', abortMount, { once: true, signal: listeners.signal })

  /* A kiosk touch must not depend on the browser synthesising a click after
     pointer handling on the full experience surface. Pointer-up starts the
     flow directly; the delegated click below remains the keyboard fallback. */
  startButton.addEventListener('pointerup', event => {
    if (!event.isPrimary || event.button > 0) return
    event.preventDefault()
    event.stopPropagation()
    startIntro()
  }, { signal: listeners.signal })

  experience.addEventListener('pointerdown', event => {
    if (phase !== NANOWIRE_PHASES.ready || event.button > 0) return
    noteActivity()
    const mapping = measurePointerMapping()
    const point = toDesignPoint(event, mapping)
    swipeStart = {
      pointerId: event.pointerId,
      mapping,
      x: point.x,
      y: point.y,
      time: point.time
    }
    experience.setPointerCapture?.(event.pointerId)
  }, { signal: listeners.signal })

  experience.addEventListener('pointerup', event => {
    if (!swipeStart || swipeStart.pointerId !== event.pointerId) return
    const start = swipeStart
    swipeStart = null
    releaseCapturedPointer(experience, event.pointerId)
    if (isDownwardSwipe(start, toDesignPoint(event, start.mapping))) void runBuildFlow()
  }, { signal: listeners.signal })

  experience.addEventListener('pointercancel', event => {
    if (swipeStart?.pointerId === event.pointerId) swipeStart = null
    releaseCapturedPointer(experience, event.pointerId)
  }, { signal: listeners.signal })

  experience.addEventListener('keydown', event => {
    if (phase !== NANOWIRE_PHASES.ready) return
    if (event.key !== 'ArrowDown' && event.key !== ' ') return
    event.preventDefault()
    noteActivity()
    void runBuildFlow()
  }, { signal: listeners.signal })

  loupe.addEventListener('pointerdown', event => {
    if (
      loupeDrag
      || phase !== NANOWIRE_PHASES.inspect
      || event.button > 0
    ) return
    event.preventDefault()
    event.stopPropagation()
    noteActivity()
    loupe.classList.add('has-interacted')
    loupeMoveQueue.cancel()
    const mapping = measurePointerMapping()
    const point = toDesignPoint(event, mapping)
    loupeDrag = {
      pointerId: event.pointerId,
      mapping,
      offsetX: point.x - loupePosition.x,
      offsetY: point.y - loupePosition.y
    }
    loupe.classList.add('is-dragging')
    loupe.setPointerCapture?.(event.pointerId)
  }, { signal: listeners.signal })

  loupe.addEventListener('pointermove', event => {
    if (
      !loupeDrag
      || loupeDrag.pointerId !== event.pointerId
      || phase !== NANOWIRE_PHASES.inspect
    ) return
    event.preventDefault()
    const point = toDesignPoint(getLatestPointerSample(event), loupeDrag.mapping)
    scheduleLoupeMove(
      point.x - loupeDrag.offsetX,
      point.y - loupeDrag.offsetY
    )
  }, { signal: listeners.signal })

  const finishLoupeDrag = event => {
    if (loupeDrag?.pointerId !== event.pointerId) return
    if (event.type === 'pointerup') {
      const point = toDesignPoint(getLatestPointerSample(event), loupeDrag.mapping)
      scheduleLoupeMove(
        point.x - loupeDrag.offsetX,
        point.y - loupeDrag.offsetY
      )
    }
    loupeMoveQueue.flush()
    loupeDrag = null
    loupe.classList.remove('is-dragging')
    releaseCapturedPointer(loupe, event.pointerId)
  }
  loupe.addEventListener('pointerup', finishLoupeDrag, { signal: listeners.signal })
  loupe.addEventListener('pointercancel', finishLoupeDrag, { signal: listeners.signal })

  loupe.addEventListener('keydown', event => {
    if (phase !== NANOWIRE_PHASES.inspect) return
    const movement = reducedMotion ? 64 : 36
    const moves = {
      ArrowLeft: [-movement, 0],
      ArrowRight: [movement, 0],
      ArrowUp: [0, -movement],
      ArrowDown: [0, movement]
    }
    const delta = moves[event.key]
    if (!delta) return
    event.preventDefault()
    noteActivity()
    loupe.classList.add('has-interacted')
    const defectPosition = scene?.getDefectScreenPosition()
    resolveLoupeMagneticPull(
      { x: loupePosition.x + delta[0], y: loupePosition.y + delta[1] },
      defectPosition,
      NANOWIRE_LOUPE_TARGETING,
      magneticPoint
    )
    setLoupePosition(magneticPoint.x, magneticPoint.y)
    updateLoupeAlignment()
  }, { signal: listeners.signal })

  root.addEventListener('click', event => {
    const action = event.target.closest('[data-nw-action]')?.dataset.nwAction
    if (!action) return
    if (action === 'restart') {
      noteActivity()
      abortMount()
      if (!signal?.aborted) void mount(container, options)
      return
    }
    if (action === 'exit') {
      noteActivity()
      navigate.menu?.()
      return
    }
    if (action === 'start') {
      startIntro()
      return
    }
  }, { signal: listeners.signal })

  setExplainer(null)
  setInstruction('')

  try {
    scene = await acquireNanowireScene(
      () => createNanowireScene(sceneHost, loupeView, { reducedMotion }),
      () => disposed || signal?.aborted
    )
    transition(NANOWIRE_EVENTS.loaded)
    root.classList.add('is-scene-ready')
    setExplainer(NANOWIRE_COPY.intro, { replay: true })
    setInstruction(NANOWIRE_COPY.intro.tooltip, true)
    setStatus('Tap the atom to start building the qubit.')
    startTargetRaf = requestAnimationFrame(trackStartTarget)
  } catch (error) {
    abortMount()
    throw error
  }

  return abortMount
}

export default { mount }
