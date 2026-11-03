import { assetUrl } from '../../core/asset-url.js'
import { sound } from '../../core/kiosk-audio.js'
import { createKioskTooltip } from '../../core/kiosk-tooltip.js'
import { releaseVideoElement } from '../../core/media-lifecycle.js'
import { prepareVideoFrame } from '../../core/prepare-video-frame.js'
import { bindProtectionDial } from './parameter-dial.js'
import {
  createProtectingParticleData,
  sampleNanowireReserve
} from './protecting-information-physics.js'
import { createProtectingInformationScene } from './protecting-information-scene.js'
import {
  createProtectingInformationState,
  focusProtectionParameter,
  getProtectionBackgroundDrives,
  getProtectionContent,
  getProtectionEffectDrives,
  getProtectionParameterStatus,
  getProtectionProgress,
  PROTECTION_PARAMETER_IDS,
  PROTECTION_PARAMETERS,
  updateProtectionParameter
} from './protecting-information-state.js'
import { cameraDebugRequested, mountCameraDebugPanel } from './protecting-information-camera-debug.js'
import { mountModuleOutro } from '../module-outro.js'
import { mountProtectionVideoLayers } from './protecting-information-video-layers.js'

/* The single source of truth for where the loupe sits. The stylesheet used to
   carry its own copy of `top`, which is a quiet trap: the pointer's tangents are
   computed from these numbers, so a change made only in CSS moves the circle and
   leaves its leader lines pointing at where it used to be. The value is pushed
   into a custom property at mount instead — see mount().

   `top` is the authored 250 plus the 424 the scene shell was lifted by. The
   loupe lives inside that shell, so the lift carried it up too, and this is what
   puts it back down where it was composed against the device. */
/* Matches the .pqi__experience fade in the stylesheet. */
const EXPERIENCE_FADE_MS = 560

/* A beat on the covered device, after the module has faded up and before the
   wipe runs. The scene arrives, settles, and is then revealed — rather than
   the wipe chasing the fade in. */
const REVEAL_HOLD_MS = 3000

/* How long the module will wait for the video stack before opening anyway.
   Waiting for everything is what makes the opening feel composed, but only up
   to a point: a clip that never decodes must not be able to hold the module
   behind its loading card indefinitely. Generous enough that this never fires
   on a healthy machine. The held beat is after the reveal now, so this only has
   to cover the wait for the clips themselves. */
const VIDEO_READY_DEADLINE_MS = 6000

const LOUPE_LAYOUT = Object.freeze({
  stageWidth: 2135,
  stageHeight: 1695,
  size: 660,
  top: 674,
  right: 74
})

function loupePointerTangents(anchorX, anchorY) {
  const left = LOUPE_LAYOUT.stageWidth - LOUPE_LAYOUT.right - LOUPE_LAYOUT.size
  const centerX = left + (LOUPE_LAYOUT.size / 2)
  const centerY = LOUPE_LAYOUT.top + (LOUPE_LAYOUT.size / 2)
  const radius = (LOUPE_LAYOUT.size / 2) - 12
  const deltaX = anchorX - centerX
  const deltaY = anchorY - centerY
  const distanceSquared = (deltaX * deltaX) + (deltaY * deltaY)
  if (distanceSquared <= (radius * radius) + 1) {
    return [
      { x: left + 70, y: LOUPE_LAYOUT.top + 530 },
      { x: left + 140, y: LOUPE_LAYOUT.top + 610 }
    ]
  }
  const radialScale = (radius * radius) / distanceSquared
  const tangentScale = radius * Math.sqrt(distanceSquared - (radius * radius)) / distanceSquared
  return [
    {
      x: centerX + (radialScale * deltaX) - (tangentScale * deltaY),
      y: centerY + (radialScale * deltaY) + (tangentScale * deltaX)
    },
    {
      x: centerX + (radialScale * deltaX) + (tangentScale * deltaY),
      y: centerY + (radialScale * deltaY) - (tangentScale * deltaX)
    }
  ]
}

function clampUnit(value) {
  return Math.min(1, Math.max(0, Number(value) || 0))
}

function parameterIconUrl(parameterId) {
  return assetUrl(`assets/modules/protecting-information/${
    parameterId === 'magnetic' ? 'magnetic-field' : parameterId
  }.svg`)
}

function parameterMarkup(parameterId) {
  const parameter = PROTECTION_PARAMETERS[parameterId]
  const icon = parameterIconUrl(parameterId)
  const target = assetUrl(`assets/modules/protecting-information/dial-target-${parameterId}.png`)
  return `
    <div class="pqi__control" data-pqi-control="${parameterId}">
      <p class="pqi__control-label">${parameter.label}</p>
      <button
        class="pqi__dial"
        type="button"
        role="slider"
        aria-label="${parameter.label}"
        aria-valuemin="0"
        aria-valuemax="100"
        data-pqi-dial="${parameterId}"
      >
        <span class="pqi__dial-scale" aria-hidden="true">
          <span class="pqi__dial-target"><img src="${target}" alt=""></span>
          <span class="pqi__dial-ticks"></span>
        </span>
        <span class="pqi__dial-body" aria-hidden="true">
          <span class="pqi__dial-rim"></span>
          <span class="pqi__dial-face">
            <img class="pqi__dial-icon" src="${icon}" alt="" draggable="false">
          </span>
          <span class="pqi__dial-needle">
            <span class="pqi__dial-indicator"></span>
          </span>
        </span>
      </button>
      <span class="pqi__control-state" data-pqi-control-state="${parameterId}">Adjust</span>
    </div>
  `
}

function moduleMarkup() {
  const microsoftLogo = assetUrl('assets/ui/microsoft-logo.png')
  const restartIcon = assetUrl('assets/ui/restart.svg')
  const exitIcon = assetUrl('assets/ui/exit-x.svg')
  return `
    <section class="pqi" data-pqi-root data-focus="temperature" aria-labelledby="pqi-title">
      <header class="microsoft-header pqi__header">
        <div class="microsoft-brand" aria-label="Microsoft Quantum">
          <span class="microsoft-brand__logo" aria-hidden="true">
            <img src="${microsoftLogo}" alt="" draggable="false">
          </span>
          <span class="microsoft-brand__divider" aria-hidden="true"></span>
          <span class="microsoft-brand__quantum">Quantum</span>
        </div>
        <div class="microsoft-header__actions">
          <button class="microsoft-header__action" type="button" data-pqi-action="restart">
            <span>Restart</span>
            <span class="microsoft-header__action-icon" aria-hidden="true"><img src="${restartIcon}" alt=""></span>
          </button>
          <button class="microsoft-header__action" type="button" data-pqi-action="exit">
            <span>Exit</span>
            <span class="microsoft-header__action-icon" aria-hidden="true"><img src="${exitIcon}" alt=""></span>
          </button>
        </div>
      </header>

      <!-- Outside the experience, and outside the scene shell it used to sit in.
           It centres on the stage rather than on a box that has since been
           shifted left and lifted, and it has to stay visible while everything
           behind it is still faded out. -->
      <div class="pqi__loading" data-pqi-loading aria-hidden="true">
        <span class="pqi__loading-spinner" aria-hidden="true"></span>
        <span data-pqi-loading-label>Loading device…</span>
      </div>

      <div class="pqi__experience">
        <h1 class="pqi__sr-only" id="pqi-title">Protecting quantum information</h1>

        <article class="pqi__content">
          <h2 data-pqi-content-title>Protecting quantum information</h2>
          <p data-pqi-content-description>To keep qubits stable, this device uses three precise controls to tame chaotic particles.</p>
        </article>

        <div class="pqi__scene-shell">
          <div class="pqi__scene" data-pqi-scene></div>
          <div class="pqi__scene-glow" aria-hidden="true"></div>
          <svg class="pqi__loupe-link" viewBox="0 0 2135 1695" preserveAspectRatio="none" aria-hidden="true">
            <path data-pqi-loupe-pointer></path>
            <circle data-pqi-loupe-locator r="23"></circle>
            <circle class="pqi__loupe-locator-core" data-pqi-loupe-locator-core r="8"></circle>
          </svg>
          <div class="pqi__loupe" aria-hidden="true">
            <canvas width="1024" height="1024" data-pqi-loupe></canvas>
            <!-- The delivered inset. It sits over the drawn one rather than
                 replacing it, so the canvas is what shows if the clip cannot
                 play — the loupe is never an empty circle. -->
            <video
              data-pqi-loupe-video
              src="${assetUrl('assets/modules/protecting-information/nanowire-inset.mp4')}"
              muted
              playsinline
              preload="auto"
            ></video>
          </div>
        </div>

        <div class="pqi__controls" aria-label="Adjust all three conditions">
          ${PROTECTION_PARAMETER_IDS.map(parameterMarkup).join('')}
        </div>

        <p class="pqi__progress" data-pqi-progress>0 of 3 conditions tuned</p>
        <p class="pqi__sr-only" data-pqi-status aria-live="polite" aria-atomic="true"></p>
      </div>
    </section>
  `
}

function createAbortError() {
  return new DOMException('Protecting Information mount was aborted', 'AbortError')
}

/**
 * The delivered alpha-video treatment is the module's visual, on the kiosk as
 * much as in the browser: it is what the board specifies and what the device
 * is meant to look like. The three.js device stays built underneath as the
 * fallback for when the masters cannot be decoded, and `?visual=scene` selects
 * it explicitly for comparison.
 *
 * (0.5.3 defaulted the kiosk to the three.js device to save the decoder stack.
 * That silently shipped the wrong visual to the only build that matters.)
 */
export function shouldUseProtectionVideoVisual({ search = '' } = {}) {
  return new URLSearchParams(search).get('visual') !== 'scene'
}

function mix(from, to, amount) {
  return from + ((to - from) * amount)
}

function drawGoldElectron(context, x, y, opacity = 1, scale = 1) {
  const glowRadius = 22 * scale
  const glow = context.createRadialGradient(x, y, 1, x, y, glowRadius)
  glow.addColorStop(0, `rgba(255, 251, 213, ${opacity})`)
  glow.addColorStop(0.24, `rgba(255, 218, 91, ${opacity * 0.94})`)
  glow.addColorStop(1, 'rgba(255, 191, 48, 0)')
  context.fillStyle = glow
  context.beginPath()
  context.arc(x, y, glowRadius, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = `rgba(255, 229, 128, ${opacity})`
  context.beginPath()
  context.arc(x, y, 5.2 * scale, 0, Math.PI * 2)
  context.fill()
}

const LOUPE_WIRE_START = Object.freeze({ x: 318, y: 496.5 })
const LOUPE_WIRE_END = Object.freeze({ x: 1138, y: 148.5 })

function loupeWireFrame() {
  const deltaX = LOUPE_WIRE_END.x - LOUPE_WIRE_START.x
  const deltaY = LOUPE_WIRE_END.y - LOUPE_WIRE_START.y
  const length = Math.hypot(deltaX, deltaY)
  return {
    tangentX: deltaX / length,
    tangentY: deltaY / length,
    normalX: -deltaY / length,
    normalY: deltaX / length
  }
}

function pointOnLoupeAxis(amount, rowOffset = 0) {
  const frame = loupeWireFrame()
  return {
    x: mix(LOUPE_WIRE_START.x, LOUPE_WIRE_END.x, amount) + (frame.normalX * rowOffset),
    y: mix(LOUPE_WIRE_START.y, LOUPE_WIRE_END.y, amount) + (frame.normalY * rowOffset)
  }
}

function loupeAxisQuad(startAmount, endAmount, normalOffset, halfWidth) {
  return [
    pointOnLoupeAxis(startAmount, normalOffset - halfWidth),
    pointOnLoupeAxis(endAmount, normalOffset - halfWidth),
    pointOnLoupeAxis(endAmount, normalOffset + halfWidth),
    pointOnLoupeAxis(startAmount, normalOffset + halfWidth)
  ]
}

function offsetLoupePoints(points, x, y) {
  return points.map(point => ({ x: point.x + x, y: point.y + y }))
}

function traceLoupePolygon(context, points) {
  if (!points.length) return
  context.beginPath()
  context.moveTo(points[0].x, points[0].y)
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y)
  }
  context.closePath()
}

function fillLoupePolygon(context, points, fillStyle) {
  traceLoupePolygon(context, points)
  context.fillStyle = fillStyle
  context.fill()
}

function loupePrismFaces(quad, depth) {
  const bottom = offsetLoupePoints(quad, 0, depth)
  return {
    top: quad,
    front: [quad[3], quad[2], bottom[2], bottom[3]],
    terminal: [quad[0], quad[3], bottom[3], bottom[0]],
    bottom
  }
}

function drawLoupeLowerPrism(context, alignment) {
  const top = loupeAxisQuad(-0.1, 1.1, 72, 92)
  const faces = loupePrismFaces(top, 68)

  context.save()
  context.shadowBlur = 30
  context.shadowColor = 'rgba(16, 28, 44, 0.3)'
  fillLoupePolygon(context, offsetLoupePoints(faces.front, 8, 14), 'rgba(19, 30, 43, 0.25)')
  context.restore()

  fillLoupePolygon(context, faces.terminal, 'rgba(80, 88, 91, 0.58)')
  fillLoupePolygon(context, faces.front, 'rgba(111, 121, 123, 0.52)')
  fillLoupePolygon(context, faces.top, 'rgba(194, 205, 207, 0.24)')

  context.save()
  context.lineJoin = 'round'
  context.lineWidth = 4
  context.setLineDash([14, 10])
  context.strokeStyle = `rgba(18, 27, 34, ${mix(0.28, 0.82, alignment)})`
  traceLoupePolygon(context, faces.top)
  context.stroke()
  traceLoupePolygon(context, [...faces.top.slice(0, 1), faces.top[3], faces.bottom[3], faces.bottom[0]])
  context.stroke()
  traceLoupePolygon(context, faces.front)
  context.stroke()
  context.restore()

  return faces
}

function drawLoupeUpperPrism(context, alignment) {
  const terminalTop = loupeAxisQuad(-0.16, 0.2, -8, 92)
  const continuationTop = loupeAxisQuad(0.2, 1.12, -8, 92)
  const terminal = loupePrismFaces(terminalTop, 74)
  const continuation = loupePrismFaces(continuationTop, 74)

  for (const faces of [terminal, continuation]) {
    fillLoupePolygon(context, faces.terminal, 'rgba(113, 121, 128, 0.34)')
    fillLoupePolygon(context, faces.front, 'rgba(153, 162, 170, 0.3)')
    fillLoupePolygon(context, faces.top, 'rgba(225, 230, 235, 0.25)')
  }

  const colorStrength = mix(0.22, 1, alignment)
  fillLoupePolygon(
    context,
    terminal.terminal,
    `rgba(181, 58, 58, ${0.44 * colorStrength})`
  )
  fillLoupePolygon(
    context,
    terminal.front,
    `rgba(211, 76, 70, ${0.46 * colorStrength})`
  )
  fillLoupePolygon(
    context,
    terminal.top,
    `rgba(255, 112, 101, ${0.56 * colorStrength})`
  )
  fillLoupePolygon(
    context,
    continuation.terminal,
    `rgba(28, 135, 145, ${0.34 * colorStrength})`
  )
  fillLoupePolygon(
    context,
    continuation.front,
    `rgba(38, 171, 169, ${0.42 * colorStrength})`
  )
  fillLoupePolygon(
    context,
    continuation.top,
    `rgba(82, 219, 207, ${0.52 * colorStrength})`
  )

  context.save()
  context.lineJoin = 'round'
  context.lineWidth = 3
  context.strokeStyle = `rgba(224, 255, 249, ${mix(0.4, 0.78, alignment)})`
  traceLoupePolygon(context, terminal.top)
  context.stroke()
  traceLoupePolygon(context, continuation.top)
  context.stroke()
  context.restore()
}

function groupLoupePairs(reserveSample) {
  const rows = [new Map(), new Map()]
  for (const particle of reserveSample) {
    const row = particle.row === 1 ? 1 : 0
    const pair = rows[row].get(particle.pairSlot) || []
    pair.push(particle)
    rows[row].set(particle.pairSlot, pair)
  }
  return rows.map(row => [...row.entries()]
    .sort((first, second) => first[0] - second[0])
    .map(([, members]) => members.sort((first, second) => first.index - second.index))
    .filter(members => members.length === 2)
    .slice(0, 10))
}

function drawLoupeFrame(context, visualState, reserveSample) {
  const { alignment } = visualState
  const width = context.canvas.width
  const height = context.canvas.height
  const center = width / 2
  context.clearRect(0, 0, width, height)

  const background = context.createRadialGradient(430, 376, 70, center, center, 690)
  background.addColorStop(0, '#8495b0')
  background.addColorStop(0.58, '#667a9a')
  background.addColorStop(1, '#475e82')
  context.fillStyle = background
  context.fillRect(0, 0, width, height)
  const lowerPrism = drawLoupeLowerPrism(context, alignment)

  const frame = loupeWireFrame()
  const pairing = alignment * alignment * (3 - (2 * alignment))
  const pairRows = groupLoupePairs(reserveSample)
  context.save()
  traceLoupePolygon(context, lowerPrism.top)
  context.clip()
  pairRows.forEach((pairs, row) => {
    pairs.forEach((members, pairIndex) => {
      const amount = mix(0.045, 0.735, pairIndex / Math.max(1, pairs.length - 1))
      const pairCenter = pointOnLoupeAxis(amount, 72 + (row === 0 ? -36 : 36))
      members.forEach((particle, memberIndex) => {
        const memberDirection = memberIndex === 0 ? -1 : 1
        const paired = {
          x: pairCenter.x + (frame.tangentX * memberDirection * 12),
          y: pairCenter.y + (frame.tangentY * memberDirection * 12)
        }
        const scatterAngle = (particle.index * 2.399963) + (row * 0.73)
        const scatterDistance = 38 + ((particle.index % 7) * 5)
        const scattered = {
          x: paired.x + (Math.cos(scatterAngle) * scatterDistance),
          y: paired.y + (Math.sin(scatterAngle) * scatterDistance * 0.72)
        }
        drawGoldElectron(
          context,
          mix(scattered.x, paired.x, pairing),
          mix(scattered.y, paired.y, pairing),
          0.84 + ((particle.index % 4) * 0.04),
          0.72
        )
      })
    })
  })
  context.restore()

  drawLoupeUpperPrism(context, alignment)

  const sheen = context.createLinearGradient(170, 130, 840, 810)
  sheen.addColorStop(0.12, 'rgba(255, 255, 255, 0.15)')
  sheen.addColorStop(0.42, 'rgba(255, 255, 255, 0)')
  sheen.addColorStop(0.78, 'rgba(100, 246, 220, 0.06)')
  context.fillStyle = sheen
  context.fillRect(0, 0, width, height)
}

function createLoupeRenderer(canvas) {
  const context = canvas?.getContext('2d')
  if (!context) return { setSample() {}, setState() {}, dispose() {} }
  let reserveSample = sampleNanowireReserve(createProtectingParticleData(), { count: 40, tier: 'low' })
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  const current = { alignment: 0 }
  const target = { alignment: 0 }
  let initialized = false
  let frame = 0
  let previousTime = 0

  const approach = (value, nextValue, delta, duration) => {
    if (Math.abs(nextValue - value) < 0.001) return nextValue
    const effectiveDuration = reducedMotion ? 0.18 : duration
    return mix(value, nextValue, 1 - Math.exp((-3 * delta) / effectiveDuration))
  }

  const tick = time => {
    frame = 0
    const delta = Math.min(0.05, Math.max(0.001, (time - previousTime) / 1000 || 0.016))
    previousTime = time
    current.alignment = approach(current.alignment, target.alignment, delta, 0.8)
    drawLoupeFrame(context, current, reserveSample)
    if (Math.abs(current.alignment - target.alignment) > 0.001) {
      frame = requestAnimationFrame(tick)
    }
  }

  const schedule = () => {
    if (frame) return
    previousTime = performance.now()
    frame = requestAnimationFrame(tick)
  }

  return {
    setSample(nextSample) {
      if (!Array.isArray(nextSample) || nextSample.length !== 40) return
      reserveSample = nextSample
      drawLoupeFrame(context, current, reserveSample)
    },
    setState(progress) {
      target.alignment = progress.tuned.magnetic ? 1 : 0
      if (!initialized) {
        initialized = true
        Object.assign(current, target)
        drawLoupeFrame(context, current, reserveSample)
        return
      }
      schedule()
    },
    dispose() {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
    }
  }
}

export async function mount(container, options = {}) {
  if (!container?.replaceChildren) throw new TypeError('Protecting Information requires a DOM container')
  const { signal, navigate = {}, onActivity, module } = options
  if (signal?.aborted) throw createAbortError()

  const shell = document.createElement('div')
  shell.innerHTML = moduleMarkup().trim()
  const root = shell.firstElementChild

  /* Offered once all three conditions are tuned, so the visitor can carry
     straight on rather than going back out to the carousel. */
  /* The band states where the visitor is, then follows the registry route. */
  const upNextBanner = mountModuleOutro({
    module,
    root,
    navigate,
    onActivity,
    onRestart: () => root.querySelector('[data-pqi-action="restart"]')?.click()
  })
  container.replaceChildren(root)

  const sceneHost = root.querySelector('[data-pqi-scene]')
  const sceneShell = root.querySelector('.pqi__scene-shell')
  const contentTitle = root.querySelector('[data-pqi-content-title]')
  const contentDescription = root.querySelector('[data-pqi-content-description]')
  const guidanceTooltip = createKioskTooltip({
    className: 'pqi__guidance',
    text: 'Turn the dials into their green zones to activate the device'
  })
  root.querySelector('.pqi__content').after(guidanceTooltip.element)
  const guidance = guidanceTooltip.copy
  guidance.dataset.pqiGuidance = ''
  const progressLabel = root.querySelector('[data-pqi-progress]')
  const status = root.querySelector('[data-pqi-status]')
  const loading = root.querySelector('[data-pqi-loading]')
  const loadingLabel = root.querySelector('[data-pqi-loading-label]')
  const loupeCanvas = root.querySelector('[data-pqi-loupe]')
  const loupeVideo = root.querySelector('[data-pqi-loupe-video]')
  const loupePointer = root.querySelector('[data-pqi-loupe-pointer]')
  const loupeLocator = root.querySelector('[data-pqi-loupe-locator]')
  const loupeLocatorCore = root.querySelector('[data-pqi-loupe-locator-core]')
  /* Handing the stylesheet the layout it must agree with, rather than trusting
     two files to hold the same number. */
  root.style.setProperty('--pqi-loupe-top', `${LOUPE_LAYOUT.top}px`)
  root.style.setProperty('--pqi-loupe-right', `${LOUPE_LAYOUT.right}px`)
  root.style.setProperty('--pqi-loupe-size', `${LOUPE_LAYOUT.size}px`)

  const listeners = new AbortController()

  const wait = ms => new Promise(resolve => {
    const timer = setTimeout(resolve, ms)
    listeners.signal.addEventListener(
      'abort',
      () => { clearTimeout(timer); resolve() },
      { once: true }
    )
  })

  /* One reveal for the whole module, once everything that has to be ready is.
     The scene alone used to decide this, and the clips, the plates and the loupe
     each arrived afterwards in their own time — which is what made the opening
     feel assembled rather than presented.

     Idempotent, because two things race to call it: the video stack finishing,
     and the deadline that fires if it does not. */
  let revealed = false
  const revealExperience = () => {
    if (revealed) return
    revealed = true
    root.classList.add('is-scene-ready', 'is-revealed')
    loading.setAttribute('aria-hidden', 'true')
    playLoupeWhenVisible()
  }

  let loupeIsReady = false
  let loupeHasPlayed = false
  /* Play once when the inset first appears, then leave its last frame visible.
     Preloading must not use up the animation while the inset is still hidden. */
  const playLoupeWhenVisible = () => {
    if (!loupeIsReady || loupeHasPlayed || !revealed || !root.classList.contains('is-magnetic-visible')) return
    loupeHasPlayed = true
    loupeVideo.play().catch(() => { loupeHasPlayed = false })
  }
  const loupeFrameReady = prepareVideoFrame(loupeVideo, { signal: listeners.signal }).then(ready => {
    if (!ready || listeners.signal.aborted) return ready
    loupeVideo.pause()
    loupeVideo.currentTime = 0
    loupeIsReady = true
    root.dataset.loupeVideo = 'ready'
    playLoupeWhenVisible()
    return ready
  })
  const loupeRenderer = createLoupeRenderer(loupeCanvas)
  let state = createProtectingInformationState()
  let sceneController = null
  let videoLayers = null
  let cameraDebug = null
  const useVideoVisual = shouldUseProtectionVideoVisual({
    search: globalThis.location?.search ?? ''
  })

  /* Set before the scene is built, not after the clips arrive. This attribute
     reframes the canvas from the shell's 2135x1695 onto the 2160 square the
     composition needs, and the camera's aspect follows the canvas — so flipping
     it late meant the scene rendered at one framing and then jumped to the
     other the moment the layers mounted. That jump is the flash of particles
     landing in the wrong place. */
  if (useVideoVisual) root.dataset.pqiVisual = 'video'
  let disposed = false
  let lastActivityAt = -Infinity
  let lastBlipAt = -Infinity
  let introFinishRequested = false
  let previousProgress = getProtectionProgress(state)
  const dialControllers = new Map()

  const noteActivity = () => {
    const now = performance.now()
    if (now - lastActivityAt < 180) return
    lastActivityAt = now
    onActivity?.()
  }

  const finishIntroFromInteraction = () => {
    if (introFinishRequested) return
    introFinishRequested = true
    sceneController?.finishIntro?.(true)
  }

  /* The anchor arrives normalised to the scene canvas, but the leader lines are
     drawn in an SVG whose viewBox is the shell. Those were the same rectangle
     until the canvas was reframed onto the video composition — a 2160 square
     inset from the top — and treating them as the same afterwards is what left
     the locator hanging in the air beside the device instead of on it.

     Measured from the live boxes rather than recomputed from the CSS numbers,
     so the mapping cannot fall out of step with a change in framing. */
  const sceneElement = root.querySelector('[data-pqi-scene]')
  const canvasWithinShell = () => {
    const shell = sceneShell?.getBoundingClientRect()
    const scene = sceneElement?.getBoundingClientRect()
    if (!shell?.width || !scene?.width) return { x: 0, y: 0, width: 1, height: 1 }
    const scaleX = LOUPE_LAYOUT.stageWidth / shell.width
    const scaleY = LOUPE_LAYOUT.stageHeight / shell.height
    return {
      x: (scene.left - shell.left) * scaleX,
      y: (scene.top - shell.top) * scaleY,
      width: scene.width * scaleX,
      height: scene.height * scaleY
    }
  }

  const updateLoupeLink = () => {
    const projected = sceneController?.getLoupeAnchor?.()
    const hasProjectedAnchor = projected?.visible === true
    const canvas = canvasWithinShell()
    const anchorX = canvas.x + (clampUnit(hasProjectedAnchor ? projected.x : 0.52) * canvas.width)
    const anchorY = canvas.y + (clampUnit(hasProjectedAnchor ? projected.y : 0.64) * canvas.height)
    const [pointerA, pointerB] = loupePointerTangents(anchorX, anchorY)
    loupePointer?.setAttribute(
      'd',
      `M ${anchorX.toFixed(1)} ${anchorY.toFixed(1)} L ${pointerA.x.toFixed(1)} ${pointerA.y.toFixed(1)} L ${pointerB.x.toFixed(1)} ${pointerB.y.toFixed(1)} Z`
    )
    for (const locator of [loupeLocator, loupeLocatorCore]) {
      locator?.setAttribute('cx', anchorX.toFixed(1))
      locator?.setAttribute('cy', anchorY.toFixed(1))
    }
    root.classList.toggle('has-loupe-anchor', hasProjectedAnchor)
  }

  const renderState = ({ announcement = '', firstCompletion = false } = {}) => {
    const progress = getProtectionProgress(state)
    const content = getProtectionContent(state)
    const effectDrives = getProtectionEffectDrives(state)
    const backgroundDrives = getProtectionBackgroundDrives(state)
    /* The electricity passes are the voltage dial's visual, so they follow the
       same drive the three.js voltage packets read rather than inventing a
       second curve for the same knob. */
    videoLayers?.setElectricity(clampUnit(effectDrives.voltageVisual))
    /* The glow pass rides the same dial, on the plain drive rather than the
       visual one: it is a reveal that should track the knob, not a pulse that
       should bloom with it. */
    videoLayers?.setAddOnFx(clampUnit(effectDrives.voltage))
    root.dataset.focus = state.focusedParameter
    root.dataset.complete = String(progress.complete)
    root.classList.toggle('has-interacted', state.hasInteracted)
    root.classList.toggle(
      'is-magnetic-visible',
      state.focusedParameter === 'magnetic' || state.values.magnetic > 0.01 || progress.complete
    )
    playLoupeWhenVisible()
    const temperatureQuality = clampUnit(progress.qualities.temperature)
    root.style.setProperty('--pqi-temperature', clampUnit(state.values.temperature).toFixed(3))
    root.style.setProperty('--pqi-background-cooling', backgroundDrives.cooling.toFixed(3))
    root.style.setProperty('--pqi-rim', temperatureQuality.toFixed(3))

    contentTitle.textContent = content.title
    contentDescription.textContent = content.description
    guidance.textContent = content.prompt
    progressLabel.textContent = `${progress.tunedCount} of 3 conditions tuned`

    for (const parameterId of PROTECTION_PARAMETER_IDS) {
      const active = state.focusedParameter === parameterId
      const tuned = progress.tuned[parameterId]
      const parameterStatus = getProtectionParameterStatus(parameterId, state.values[parameterId])
      const percentage = Math.round(state.values[parameterId] * 100)
      const control = root.querySelector(`[data-pqi-control="${parameterId}"]`)
      const controlState = root.querySelector(`[data-pqi-control-state="${parameterId}"]`)
      control.classList.toggle('is-active', active)
      control.classList.toggle('is-tuned', tuned)
      control.dataset.rangeStatus = parameterStatus
      controlState.textContent = `${percentage}% · ${
        parameterStatus === 'tuned'
          ? 'Condition tuned'
          : parameterStatus === 'below' ? 'Below target' : 'Above target'
      }`
      dialControllers.get(parameterId)?.setValue(state.values[parameterId])
      dialControllers.get(parameterId)?.setTuned(tuned)
    }

    const changedParameter = PROTECTION_PARAMETER_IDS.find(
      parameterId => previousProgress.tuned[parameterId] !== progress.tuned[parameterId]
    )
    if (progress.complete && !previousProgress.complete) {
      /* The outro is built and its clips are loaded, but it does not play yet —
         held back deliberately rather than unfinished. Re-enabling it is the one
         call below: videoLayers?.playOutro(). */
      /* All three dials in target is the module's payoff, so it gets the bonus
         cue rather than the same chime a single step lands on. */
      if (firstCompletion) sound.bonus()
      upNextBanner?.offer()
      announcement = 'Topoconductor activated. Quantum information is shielded from errors.'
    } else if (!announcement && changedParameter) {
      const label = PROTECTION_PARAMETERS[changedParameter].label
      announcement = progress.tuned[changedParameter]
        ? `${label} tuned. ${progress.tunedCount} of 3 conditions tuned.`
        : `${label} moved outside its target. ${progress.tunedCount} of 3 conditions tuned.`
    }
    if (announcement) status.textContent = announcement
    previousProgress = progress

    loupeRenderer.setState(progress)
    sceneController?.setFocus(state.focusedParameter)
    sceneController?.setState(state, progress)
    updateLoupeLink()
  }

  const focusParameter = parameterId => {
    state = focusProtectionParameter(state, parameterId)
    finishIntroFromInteraction()
    noteActivity()
    renderState()
  }

  const inputParameter = (parameterId, value) => {
    const hadEverCompleted = state.hasEverCompleted
    state = updateProtectionParameter(state, parameterId, value)
    const firstCompletion = !hadEverCompleted && state.hasEverCompleted
    finishIntroFromInteraction()
    noteActivity()
    const now = performance.now()
    if (now - lastBlipAt > 120) {
      lastBlipAt = now
      sound.blip(420 + (value * 240))
    }
    renderState({ firstCompletion })
  }

  for (const parameterId of PROTECTION_PARAMETER_IDS) {
    const dial = root.querySelector(`[data-pqi-dial="${parameterId}"]`)
    dialControllers.set(parameterId, bindProtectionDial(dial, {
      parameterId,
      signal: listeners.signal,
      onFocus: focusParameter,
      onInput: inputParameter,
      onCommit: (_, __, moved) => {
        if (moved) sound.pop()
      }
    }))
  }

  root.addEventListener('click', event => {
    const action = event.target.closest('[data-pqi-action]')?.dataset.pqiAction
    if (!action) return
    noteActivity()
    if (action === 'restart') {
      /* Back to an untuned device, so the band goes back to naming this module.
         Left standing, the offer outlived the run that earned it and sat over a
         module the visitor had just started again. */
      upNextBanner?.withdraw()
      loupeHasPlayed = false
      loupeVideo?.pause()
      if (loupeVideo?.readyState >= 1) loupeVideo.currentTime = 0
      state = createProtectingInformationState()
      previousProgress = getProtectionProgress(state)
      sound.whoosh()
      renderState({ announcement: 'Module restarted. All three conditions need tuning.' })
    } else if (action === 'exit') {
      navigate.menu?.()
    }
  }, { signal: listeners.signal })

  const dispose = () => {
    if (disposed) return
    disposed = true
    listeners.abort()
    upNextBanner?.dispose()
    releaseVideoElement(loupeVideo)
    delete root.dataset.loupeVideo
    loupeRenderer.dispose()
    sceneController?.dispose()
    sceneController = null
    videoLayers?.dispose()
    videoLayers = null
    cameraDebug?.dispose()
    cameraDebug = null
  }
  signal?.addEventListener('abort', dispose, { once: true, signal: listeners.signal })

  renderState()


  try {
    sceneController = await createProtectingInformationScene(sceneHost, {
      signal,
      /* Declared up front so the device is never drawn: waiting until the video
         layers are up and then hiding it shows it for a frame first. */
      overlayMode: useVideoVisual,
      onProgress(progress) {
        loadingLabel.textContent = `Loading device… ${Math.round(progress * 100)}%`
      },
      onReady() {
        /* Noted, not acted on. The scene being ready is only the first of the
           two things that have to be true, and revealing here is what made the
           module arrive in pieces. See revealExperience. */
        loadingLabel.textContent = 'Loading device… 100%'
      }
    })
    if (disposed || signal?.aborted) {
      sceneController.dispose()
      sceneController = null
      throw createAbortError()
    }
    if (introFinishRequested) sceneController.finishIntro?.(true)
    loupeRenderer.setSample(sceneController.getReserveSample?.())
    renderState()
  } catch (error) {
    dispose()
    throw error
  }

  /* The delivered video treatment replaces the three.js device. It is opt-out
     rather than removal: the scene above still builds and is only hidden, so
     the two can be compared on the real screen and reverting is a query string
     rather than a revert. Add ?visual=scene to see the three.js device again.

     Mounted after the scene rather than before it so a slow or stalled clip
     delays only the swap, never the module opening. */
  /* Mounted before the video stack rather than after it. The alignment panel is
     a debug tool for a scene that may well be misbehaving, so it must not be
     downstream of the thing being debugged — awaiting six clips first meant one
     slow decode took the panel with it. It reads `videoLayers` at the moment
     the fader moves, so it works once the stack arrives and does nothing until
     then, and it is just as useful against the three.js device on
     ?visual=scene. */
  if (cameraDebugRequested()) {
    cameraDebug = mountCameraDebugPanel({
      scene: sceneController,
      onVideoOpacity(opacity) {
        videoLayers?.setStackOpacity(opacity)
      }
    })
    console.info('[pqi] camera alignment panel mounted (?debug=camera)')
  }

  /* Held across the mount and for a moment after it. Decoding the stack is a
     one-off cost, and the probe gets a single verdict per session — if it
     samples here it concludes the machine cannot afford the particles and
     halves them for good. */
  const PROBE_SETTLE_MS = 2000

  /* The guarantee that the loading card comes down. Started once the scene is
     up, so it measures only the wait for the clips. */
  const revealDeadline = setTimeout(revealExperience, VIDEO_READY_DEADLINE_MS)
  listeners.signal.addEventListener('abort', () => clearTimeout(revealDeadline), { once: true })

  if (useVideoVisual) {
    sceneController?.setPerformanceProbeEnabled?.(false)
    try {
      const mountedVideoLayers = await mountProtectionVideoLayers(sceneShell, { signal })
      if (disposed || signal?.aborted) {
        mountedVideoLayers.dispose()
        throw createAbortError()
      }
      videoLayers = mountedVideoLayers

      /* The board keeps the particles and the magnetic arcs in three.js over
         the video, so the scene stays live and drops only its device meshes —
         the video is carrying the device now. */
      sceneController?.setOverlayMode?.(true)
      renderState()

      /* Armed, not played: the reveal sits in its covering state while the
         module is faded up behind it, so what appears is a covered device
         rather than a device assembling itself in public. */
      await videoLayers.prepareIntro()
    } catch (error) {
      if (disposed || signal?.aborted || error?.name === 'AbortError') {
        dispose()
        throw error
      }
      /* An unavailable manifest must not take the module down: the three.js
         device is still fully built underneath it. */
      console.warn('[pqi] video layers unavailable, keeping the three.js scene', error)
      videoLayers?.dispose()
      videoLayers = null
      delete root.dataset.pqiVisual
      /* Nothing is going to carry the device now, so the scene has to draw it
         after all. */
      sceneController?.setOverlayMode?.(false)
    } finally {
      if (!disposed) {
        const settle = setTimeout(
          () => sceneController?.setPerformanceProbeEnabled?.(true),
          PROBE_SETTLE_MS
        )
        listeners.signal.addEventListener('abort', () => clearTimeout(settle), { once: true })
      }
    }
  }

  await loupeFrameReady
  if (disposed || signal?.aborted) throw createAbortError()
  revealExperience()

  /* The fade first, so the wipe reads as uncovering the device rather than
     racing it, and then the held beat on the covered device before it runs. */
  await wait(EXPERIENCE_FADE_MS)
  await wait(REVEAL_HOLD_MS)
  if (!disposed && !signal?.aborted) videoLayers?.playIntro().catch(() => {})

  return dispose
}

export default { mount }
