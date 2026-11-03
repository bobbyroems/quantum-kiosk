import { waitForTask, taskTimeout } from './abortable-task.js'

const PORTAL_ANTICIPATION_MS = 160
const PORTAL_EXPAND_MS = 900
const PORTAL_REVEAL_AT_MS = 460
const PORTAL_SURROUNDINGS_EXIT_MS = 560
const PORTAL_SURROUNDINGS_FADE_MS = 300
const PORTAL_ARC_Y = -64

function animationFinished(animation) {
  return animation.finished.catch(() => undefined)
}

export function rectToStageCoordinates(rect, stageRect, designWidth, designHeight) {
  if (![rect, stageRect].every(Boolean)) return null
  const scaleX = stageRect.width > 0 ? designWidth / stageRect.width : 0
  const scaleY = stageRect.height > 0 ? designHeight / stageRect.height : 0
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    return null
  }

  return {
    left: (rect.left - stageRect.left) * scaleX,
    top: (rect.top - stageRect.top) * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY
  }
}

export function unionRects(first, second) {
  const left = Math.min(first.left, second.left)
  const top = Math.min(first.top, second.top)
  const right = Math.max(first.left + first.width, second.left + second.width)
  const bottom = Math.max(first.top + first.height, second.top + second.height)
  return { left, top, width: right - left, height: bottom - top }
}

export function localizeRect(rect, surface) {
  return {
    left: rect.left - surface.left,
    top: rect.top - surface.top,
    width: rect.width,
    height: rect.height
  }
}

export function interpolatePortalRect(from, to, progress, arcY = PORTAL_ARC_Y) {
  const clampedProgress = Math.min(1, Math.max(0, progress))
  const lerp = (start, end) => start + ((end - start) * clampedProgress)
  const rect = {
    left: lerp(from.left, to.left),
    top: lerp(from.top, to.top),
    width: lerp(from.width, to.width),
    height: lerp(from.height, to.height)
  }
  rect.top += Math.sin(Math.PI * clampedProgress) * arcY
  return rect
}

function smoothStep(progress) {
  return progress * progress * (3 - (2 * progress))
}

function animateSharedScene({
  session,
  localSource,
  localDestination,
  signal
}) {
  return new Promise((resolve, reject) => {
    let frame = 0
    const abort = () => { cancelAnimationFrame(frame); reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { abort(); return }
    const startedAt = performance.now()

    const update = now => {
      if (signal.aborted) return
      const rawProgress = Math.min(1, Math.max(0, (now - startedAt) / PORTAL_EXPAND_MS))
      const progress = smoothStep(rawProgress)
      const sceneViewport = interpolatePortalRect(localSource, localDestination, progress)

      const complete = rawProgress >= 1
      session.setViewport(sceneViewport, () => {
        if (signal.aborted) return
        if (complete) {
          signal.removeEventListener('abort', abort)
          resolve()
        } else {
          frame = window.requestAnimationFrame(update)
        }
      }, progress)
    }

    frame = window.requestAnimationFrame(update)
  })
}

function createPortal(source) {
  const portal = document.createElement('div')
  portal.className = 'experience-portal'
  portal.setAttribute('aria-hidden', 'true')
  portal.innerHTML = `
    <div class="experience-portal__veil"></div>
    <div class="experience-portal__field"></div>
    <div class="experience-portal__scene-surface"></div>
    <div class="experience-portal__handoff"></div>
  `

  const field = portal.querySelector('.experience-portal__field')
  const handoff = portal.querySelector('.experience-portal__handoff')
  const sceneSurface = portal.querySelector('.experience-portal__scene-surface')
  const veil = portal.querySelector('.experience-portal__veil')
  Object.assign(field.style, {
    left: `${source.left}px`,
    top: `${source.top}px`,
    width: `${source.width}px`,
    height: `${source.height}px`
  })
  return { field, handoff, portal, sceneSurface, veil }
}

export async function playMajoranaPortalTransition({
  stage,
  menuScreen,
  sourceElement,
  sceneController,
  prepare,
  reveal
}) {
  if (!(stage instanceof HTMLElement) || !(sourceElement instanceof HTMLElement)) {
    throw new TypeError('The portal transition requires a stage and source element.')
  }

  const stageRect = stage.getBoundingClientRect()
  const source = rectToStageCoordinates(
    sourceElement.getBoundingClientRect(),
    stageRect,
    stage.offsetWidth,
    stage.offsetHeight
  )
  if (!source) throw new Error('The Majorana portal source could not be measured.')
  const controller = new AbortController()
  const deadline = setTimeout(() => controller.abort(taskTimeout('The Majorana transition took too long. Please try again.')), 45000)
  const wait = task => waitForTask(task, controller.signal)
  let revealTimer = 0
  let revealed = false
  let portal = null
  let menuAnimation = null
  const revealOnce = () => {
    if (revealed) return
    revealed = true
    reveal?.()
  }

  try {
    const prepared = await wait(prepare())
    const destinationElement = prepared?.destinationElement
    if (!(destinationElement instanceof HTMLElement)) {
      throw new Error('The Majorana intro destination could not be measured.')
    }

    const destination = rectToStageCoordinates(
      destinationElement.getBoundingClientRect(),
      stage.getBoundingClientRect(),
      stage.offsetWidth,
      stage.offsetHeight
    )
    if (!destination) throw new Error('The Majorana intro destination is invalid.')

    const surfaceRect = unionRects(source, destination)
    const localSource = localizeRect(source, surfaceRect)
    const localDestination = localizeRect(destination, surfaceRect)
    const portalElements = createPortal(source)
    const { field, handoff, sceneSurface, veil } = portalElements
    portal = portalElements.portal
    Object.assign(sceneSurface.style, {
      left: `${surfaceRect.left}px`,
      top: `${surfaceRect.top}px`,
      width: `${surfaceRect.width}px`,
      height: `${surfaceRect.height}px`
    })
    stage.append(portal)

    const sceneSession = sceneController?.beginViewportSession({
      surface: sceneSurface,
      viewport: localSource
    })
    if (!sceneSession) throw new Error('The shared Majorana scene is unavailable.')

    stage.classList.add('is-experience-transitioning')
    menuScreen?.classList.add('is-portal-leaving')
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    if (reducedMotion) {
      Object.assign(handoff.style, {
        left: `${surfaceRect.left}px`,
        top: `${surfaceRect.top}px`,
        width: `${surfaceRect.width}px`,
        height: `${surfaceRect.height}px`,
        background: 'var(--color-background)'
      })
      const coverAnimation = handoff.animate([
        { opacity: 0 },
        { opacity: 1 }
      ], {
        duration: 120,
        easing: 'ease-out',
        fill: 'forwards'
      })
      menuAnimation = menuScreen?.animate([
        { opacity: 1 },
        { opacity: 0 }
      ], {
        duration: 120,
        easing: 'ease-out',
        fill: 'forwards'
      })
      await wait(Promise.all([
        animationFinished(coverAnimation),
        menuAnimation ? animationFinished(menuAnimation) : Promise.resolve()
      ]))
      revealOnce()
      await wait(new Promise(resolve => {
        sceneSession.setViewport(localDestination, resolve, 1)
      }))
      await wait(prepared.handoffScene?.() || Promise.resolve())
      await wait(animationFinished(handoff.animate([
        { opacity: 1 },
        { opacity: 0 }
      ], {
        duration: 160,
        easing: 'ease-out',
        fill: 'forwards'
      })))
      return
    }

    const anticipation = field.animate([
      { opacity: 0, transform: 'scale(0.92)' },
      { opacity: 0.42, transform: 'scale(1.04)' }
    ], {
      duration: PORTAL_ANTICIPATION_MS,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
      fill: 'forwards'
    })

    await wait(animationFinished(anticipation))
    const sceneAnimation = animateSharedScene({
      session: sceneSession,
      localSource,
      localDestination,
      signal: controller.signal
    })
    const veilAnimation = veil.animate([
      { opacity: 0 },
      { opacity: 0.16, offset: 0.18 },
      { opacity: 0.76, offset: 0.62 },
      { opacity: 1 }
    ], {
      duration: PORTAL_EXPAND_MS,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      fill: 'forwards'
    })
    const fieldAnimation = field.animate([
      { opacity: 0.42, transform: 'scale(1.04)' },
      { opacity: 0.24, transform: 'scale(1.12)', offset: 0.42 },
      { opacity: 0, transform: 'scale(1.28)' }
    ], {
      duration: 520,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
      fill: 'forwards'
    })
    menuAnimation = menuScreen?.animate([
      { opacity: 1, transform: 'translateY(0) scale(1)' },
      { opacity: 0.16, transform: 'translateY(26px) scale(0.992)', offset: 0.72 },
      { opacity: 0, transform: 'translateY(42px) scale(0.988)' }
    ], {
      duration: PORTAL_SURROUNDINGS_EXIT_MS,
      easing: 'cubic-bezier(0.3, 0, 1, 1)',
      fill: 'forwards'
    })

    revealTimer = window.setTimeout(revealOnce, PORTAL_REVEAL_AT_MS)
    await wait(Promise.all([
      sceneAnimation,
      animationFinished(veilAnimation),
      animationFinished(fieldAnimation),
      menuAnimation ? animationFinished(menuAnimation) : Promise.resolve()
    ]))
    revealOnce()

    // Reveal the mounted module before moving the shared canvas. Reparenting
    // and rendering the canvas happen synchronously, so completing the
    // background crossfade first avoids a second light sweep at the handoff
    // without exposing an empty frame.
    await wait(animationFinished(veil.animate([
      { opacity: 1 },
      { opacity: 0 }
    ], {
      duration: PORTAL_SURROUNDINGS_FADE_MS,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
      fill: 'forwards'
    })))
    await wait(prepared.handoffScene?.() || Promise.resolve())
  } finally {
    clearTimeout(deadline)
    controller.abort()
    portal?.getAnimations({ subtree: true }).forEach(animation => animation.cancel())
    window.clearTimeout(revealTimer)
    revealOnce()
    // `fill: forwards` otherwise keeps the menu at opacity: 0 after the
    // module exits, even though the router has made that screen active again.
    menuAnimation?.cancel()
    portal?.remove()
    menuScreen?.classList.remove('is-portal-leaving')
    stage.classList.remove('is-experience-transitioning')
  }
}
