import { assetUrl } from '../../core/asset-url.js'
import {
  composeNanoscaleSimilarities,
  interpolateNanoscaleSimilarityAroundAnchor,
  invertNanoscaleSimilarity,
  NANOSCALE_CAMERA_GEOMETRY,
  NANOSCALE_CAMERA_HANDOFFS,
  NANOSCALE_CAMERA_SCENES,
  nanoscaleCameraCssTransform,
  nanoscaleSimilarityFromRects,
  sampleNanoscaleCamera,
  sampleNanoscalePresentationSegment,
  transformNanoscaleRect
} from '../nanoscale/nanoscale-camera.js'

const UI_CLEAR_MS = 300
const ENCLOSURE_REVEAL_MS = 1_100
const CHIP_SWAP_START_MS = 180
const CHIP_SWAP_MS = 1_100
const PULLOUT_MS = 4_800

const CRYOSTAT_STOP = 1
const MAJORANA_STOP = 2
const FINALE_STAGE = Object.freeze({ width: 2160, height: 3720 })
const FIGMA_HEADER_HEIGHT = 120
const majoranaArt = NANOSCALE_CAMERA_SCENES[MAJORANA_STOP].art
const cryostatArt = NANOSCALE_CAMERA_SCENES[CRYOSTAT_STOP].art
const majoranaHandoff = NANOSCALE_CAMERA_HANDOFFS[CRYOSTAT_STOP]

/* Node 895:8670 keeps the pullout above the bottom of the 2160 x 3840 frame:
   its 2927.9px-tall enclosure starts at frame y=0, while this build view starts
   directly below the persistent 120px header. */
const FIGMA_FINAL_CRYOSTAT_HEIGHT = 2927.9

export const MAJORANA_FINALE_END_FRAME = Object.freeze({
  height: FIGMA_FINAL_CRYOSTAT_HEIGHT,
  width: cryostatArt.assetSize.width * (
    FIGMA_FINAL_CRYOSTAT_HEIGHT / cryostatArt.assetSize.height
  ),
  x: (FINALE_STAGE.width - (
    cryostatArt.assetSize.width * (
      FIGMA_FINAL_CRYOSTAT_HEIGHT / cryostatArt.assetSize.height
    )
  )) / 2,
  y: -FIGMA_HEADER_HEIGHT
})

const finalCryostatAssetScale = (
  MAJORANA_FINALE_END_FRAME.height / cryostatArt.assetSize.height
)

/*
 * The cold finger the package hangs from, as its own plate.
 *
 * The pull-out starts hard against the arm's tip and ends on the whole
 * chandelier, so at the start the cryostat plate is magnified about five times.
 * The package survives that because it has a close-up plate of its own; the
 * gold tube above it did not, and it was the softest thing on the screen.
 *
 * `M2_Coldfinger_8k.png` is that tube and package rendered again at 4608 x 8192.
 * Matching its gradients against the cryostat plate across scale and offset —
 * the same method stop 01 was registered with — puts it on
 * (778, 2678) 245 x 436 of that plate, 18.8 master pixels per plate pixel, at a
 * correlation of 0.78 against 0.47 for the next candidate. Nothing here is
 * authored: the plate is laid out in the cryostat plate's own pixels and pushed
 * through the same transform, so it lands wherever the chandelier's arm lands
 * and no registration moves.
 *
 * Baked to 1536px wide, which is 1:1 at the closest the camera comes and 17 MB
 * of decoded bitmap; the tube needs about 1200 stage pixels there and the plate
 * gives it 245 today.
 */
const COLDFINGER_PLATE = Object.freeze({
  src: 'assets/modules/nanoscale/coldfinger.webp',
  assetRect: Object.freeze({ x: 778, y: 2678, width: 245, height: 436 })
})

/*
 * Where the registered package stands when the live board dissolves into it,
 * before the 02 -> 01 camera handoff runs in reverse and pulls it back into the
 * cryostat. It has to match the board, or the crossfade jumps.
 *
 * Figma authored this against the flat arm-and-package render module 08's
 * stop 02 used to paint: that plate's 1300 intrinsic pixels were drawn 2270px
 * wide with its bitmap starting at (-57, -1360). Stop 02 now paints a
 * different plate -- the package alone, at a different size and framing, and
 * fitted to the chandelier's arm rather than to where the old render sat -- so
 * neither those bitmap numbers nor the plate's stage placement can be reused
 * as they are.
 *
 * What the Figma numbers actually pinned is where the package's circuit board
 * fell in this frame. So that board is recovered from the retired plate and its
 * placement, the same board is measured on the current plate (both as the
 * blue-mask extent at half alpha), and the start is the similarity that lays
 * one on the other. Stop 02 can refit its plate however it likes; the board
 * still lands on the live one.
 */
const RETIRED_PLATE_PLACEMENT = Object.freeze({ scale: 2270 / 1300, translateX: -57, translateY: -1360 })
const RETIRED_PLATE_BOARD = Object.freeze({ x: 295, y: 1461, width: 707, height: 957 })
const PLATE_BOARD = Object.freeze({ x: 564, y: 210, width: 2735, height: 3706 })

const BOARD_IN_FRAME = transformNanoscaleRect(RETIRED_PLATE_PLACEMENT, RETIRED_PLATE_BOARD)

export const MAJORANA_FINALE_START_REGISTRATION = composeNanoscaleSimilarities(
  nanoscaleSimilarityFromRects(BOARD_IN_FRAME, PLATE_BOARD),
  invertNanoscaleSimilarity(majoranaArt.assetToScene)
)

/* Settle the complete module-08 bitmap in the higher Figma-authored frame. */
export const MAJORANA_FINALE_END_REGISTRATION = Object.freeze({
  scale: finalCryostatAssetScale / cryostatArt.assetToScene.scale,
  translateX: MAJORANA_FINALE_END_FRAME.x - (
    (finalCryostatAssetScale / cryostatArt.assetToScene.scale) *
    cryostatArt.assetToScene.translateX
  ),
  translateY: MAJORANA_FINALE_END_FRAME.y - (
    (finalCryostatAssetScale / cryostatArt.assetToScene.scale) *
    cryostatArt.assetToScene.translateY
  )
})

const majoranaFocus = Object.freeze({
  x: NANOSCALE_CAMERA_GEOMETRY.majoranaRegisteredTarget.x +
    (NANOSCALE_CAMERA_GEOMETRY.majoranaRegisteredTarget.width / 2),
  y: NANOSCALE_CAMERA_GEOMETRY.majoranaRegisteredTarget.y +
    (NANOSCALE_CAMERA_GEOMETRY.majoranaRegisteredTarget.height / 2)
})

const clamp01 = value => Math.min(1, Math.max(0, value))
const lerp = (from, to, progress) => from + ((to - from) * progress)

function easeInOutCubic(value) {
  const progress = clamp01(value)
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - ((-2 * progress + 2) ** 3) / 2
}

export function sampleMajoranaFinaleCamera(progress) {
  const safeProgress = clamp01(Number.isFinite(progress) ? progress : 0)
  return interpolateNanoscaleSimilarityAroundAnchor(
    MAJORANA_FINALE_START_REGISTRATION,
    MAJORANA_FINALE_END_REGISTRATION,
    majoranaFocus,
    safeProgress
  )
}

export function sampleMajoranaFinaleComposition(progress) {
  const safeProgress = clamp01(Number.isFinite(progress) ? progress : 0)
  const cameraSample = sampleNanoscaleCamera(
    lerp(MAJORANA_STOP, CRYOSTAT_STOP, safeProgress)
  )
  const majoranaCameraTransform = composeNanoscaleSimilarities(
    sampleNanoscalePresentationSegment(CRYOSTAT_STOP, 1 - safeProgress),
    majoranaHandoff.registration
  )
  return Object.freeze({
    camera: sampleMajoranaFinaleCamera(safeProgress),
    layers: cameraSample.layers,
    majoranaCameraTransform,
    progress: safeProgress
  })
}

/**
 * Crossfades the assembled live board into module 08's registered Majorana
 * plate, then keeps that same DOM image throughout the reversed Majorana ->
 * Cryostat handoff. The package therefore remains continuous and registered
 * while the complete cryostat.webp plate settles into the higher Figma frame.
 */
export function createMajoranaFinale({ reducedMotion = false, stage } = {}) {
  if (!(stage instanceof HTMLElement)) {
    throw new TypeError('Majorana finale requires the build stage element.')
  }

  const element = document.createElement('div')
  element.className = 'majorana-finale'
  element.hidden = true
  element.setAttribute('aria-hidden', 'true')

  const camera = document.createElement('div')
  camera.className = 'majorana-finale__camera'

  const chipElement = document.createElement('div')
  chipElement.className = 'majorana-finale-chip-overlay'
  chipElement.hidden = true
  chipElement.setAttribute('aria-hidden', 'true')

  const chipCamera = document.createElement('div')
  chipCamera.className = 'majorana-finale__chip-camera'

  /* Both plates are placed by transforms that map their own intrinsic pixels
     onto the shared stage, so each element has to be laid out at exactly the
     size the camera believes its bitmap to be. */
  const sizeToArt = (image, art) => {
    image.style.width = `${art.assetSize.width}px`
    image.style.height = `${art.assetSize.height}px`
  }

  const pullout = document.createElement('img')
  pullout.className = 'majorana-finale__pullout'
  pullout.src = assetUrl('assets/modules/nanoscale/cryostat.webp')
  pullout.alt = ''
  pullout.draggable = false
  pullout.decoding = 'async'
  pullout.dataset.finaleArt = 'module-08-cryostat'
  sizeToArt(pullout, cryostatArt)

  /* Sits above the chandelier and below the package close-up, so the package
     plate still owns the package and this only replaces the tube behind it. */
  const coldfinger = document.createElement('img')
  coldfinger.className = 'majorana-finale__coldfinger'
  coldfinger.src = assetUrl(COLDFINGER_PLATE.src)
  coldfinger.alt = ''
  coldfinger.draggable = false
  coldfinger.decoding = 'async'
  coldfinger.dataset.finaleArt = 'module-08-coldfinger'
  coldfinger.style.width = `${COLDFINGER_PLATE.assetRect.width}px`
  coldfinger.style.height = `${COLDFINGER_PLATE.assetRect.height}px`

  const chip = document.createElement('img')
  chip.className = 'majorana-finale__chip'
  chip.src = assetUrl('assets/modules/nanoscale/majorana-2.webp')
  chip.alt = ''
  chip.draggable = false
  chip.decoding = 'async'
  chip.dataset.finaleArt = 'module-08-majorana-2'
  sizeToArt(chip, majoranaArt)

  camera.append(pullout, coldfinger)
  chipCamera.append(chip)
  chipElement.append(chipCamera)
  element.append(camera)

  let animationFrame = 0
  let playToken = 0
  let pendingResolve = null
  let pulloutReveal = 0
  let chipReveal = 0
  let cryostatLayerOpacity = 0
  let preparation = null
  let disposed = false

  function applyLayerOpacities() {
    const cryostatOpacity = clamp01(pulloutReveal * cryostatLayerOpacity)
    pullout.style.opacity = String(cryostatOpacity)
    /* It is part of the chandelier plate, so it comes and goes with it. */
    coldfinger.style.opacity = String(cryostatOpacity)
    chip.style.opacity = String(clamp01(chipReveal))
  }

  function renderComposition(progress) {
    const composition = sampleMajoranaFinaleComposition(progress)
    const cameraTransform = nanoscaleCameraCssTransform(composition.camera)
    camera.style.transform = cameraTransform
    chipCamera.style.transform = cameraTransform

    const cryostatLayer = composition.layers.find(layer => layer.sceneId === 'cryostat')

    cryostatLayerOpacity = cryostatLayer?.opacity ?? 0
    if (cryostatLayer) {
      const cryostatToStage = composeNanoscaleSimilarities(
        cryostatLayer.cameraTransform,
        cryostatArt.assetToScene
      )
      pullout.style.transform = nanoscaleCameraCssTransform(cryostatToStage)
      /* The same chain plus the plate-space offset of the rect this was cut
         from, so the tube rides the chandelier exactly. */
      coldfinger.style.transform = nanoscaleCameraCssTransform(
        composeNanoscaleSimilarities(cryostatToStage, {
          scale: 1,
          translateX: COLDFINGER_PLATE.assetRect.x,
          translateY: COLDFINGER_PLATE.assetRect.y
        })
      )
    }
    chip.style.transform = nanoscaleCameraCssTransform(
      composeNanoscaleSimilarities(
        composition.majoranaCameraTransform,
        majoranaArt.assetToScene
      )
    )
    applyLayerOpacities()
  }

  function renderPulloutOpacity(opacity) {
    pulloutReveal = clamp01(opacity)
    applyLayerOpacities()
  }

  function renderChipSwap(progress) {
    const eased = easeInOutCubic(progress)
    chipReveal = eased
    stage.style.setProperty('--majorana-finale-live-opacity', String(1 - eased))
    applyLayerOpacities()
  }

  async function decode() {
    await Promise.all([pullout, coldfinger, chip].map(image => (
      typeof image.decode === 'function'
        ? image.decode().catch(() => undefined)
        : undefined
    )))
  }

  function prepare() {
    preparation ??= (async () => {
      await decode()
      if (disposed) return
      // Paint the registered plates while the visitor is assembling the board.
      // Decoding alone does not prepare Chromium's compositor textures.
      renderComposition(0)
      pullout.style.opacity = coldfinger.style.opacity = chip.style.opacity = '1'
      element.style.opacity = chipElement.style.opacity = '0.001'
      element.hidden = chipElement.hidden = false
      await new Promise(resolve => requestAnimationFrame(resolve))
      await new Promise(resolve => requestAnimationFrame(resolve))
      element.hidden = chipElement.hidden = true
      element.style.removeProperty('opacity')
      chipElement.style.removeProperty('opacity')
      applyLayerOpacities()
    })()
    return preparation
  }

  function cancel(result = false) {
    playToken += 1
    if (animationFrame) window.cancelAnimationFrame(animationFrame)
    animationFrame = 0
    pendingResolve?.(result)
    pendingResolve = null
  }

  async function play() {
    if (disposed) return false
    cancel(false)
    const token = playToken
    await prepare()
    if (token !== playToken) return false

    renderComposition(0)
    renderPulloutOpacity(0)
    renderChipSwap(0)
    element.dataset.finalePhase = 'clearing'
    element.hidden = false
    element.setAttribute('aria-hidden', 'false')
    chipElement.hidden = false
    window.requestAnimationFrame(() => {
      element.classList.add('is-showing')
      chipElement.classList.add('is-showing')
    })

    if (reducedMotion) {
      renderPulloutOpacity(1)
      renderChipSwap(1)
      renderComposition(1)
      element.dataset.finalePhase = 'complete'
      return true
    }

    return new Promise(resolve => {
      pendingResolve = resolve
      // Enclosure and board dissolve overlap; no stationary intermediate plate.
      const chipSwapStartMs = CHIP_SWAP_START_MS
      const chipSwapEndMs = chipSwapStartMs + CHIP_SWAP_MS
      const pulloutStartMs = chipSwapEndMs
      const totalMs = pulloutStartMs + PULLOUT_MS
      const startedAt = performance.now()

      const tick = timestamp => {
        if (token !== playToken) return
        const elapsedMs = timestamp - startedAt
        const enclosureProgress = clamp01(
          (elapsedMs - (UI_CLEAR_MS * 0.35)) / ENCLOSURE_REVEAL_MS
        )
        renderPulloutOpacity(easeInOutCubic(enclosureProgress))
        renderChipSwap(clamp01((elapsedMs - chipSwapStartMs) / CHIP_SWAP_MS))

        if (elapsedMs < chipSwapStartMs) {
          element.dataset.finalePhase = 'clearing'
        } else if (elapsedMs < chipSwapEndMs) {
          element.dataset.finalePhase = 'chip-swap'
        } else {
          element.dataset.finalePhase = 'pulling-out'
          renderComposition(clamp01((elapsedMs - pulloutStartMs) / PULLOUT_MS))
        }

        if (elapsedMs >= totalMs) {
          renderPulloutOpacity(1)
          renderChipSwap(1)
          renderComposition(1)
          element.dataset.finalePhase = 'complete'
          animationFrame = 0
          pendingResolve = null
          resolve(true)
          return
        }
        animationFrame = window.requestAnimationFrame(tick)
      }
      animationFrame = window.requestAnimationFrame(tick)
    })
  }

  function reset() {
    cancel(false)
    element.classList.remove('is-showing')
    chipElement.classList.remove('is-showing')
    element.hidden = true
    element.setAttribute('aria-hidden', 'true')
    chipElement.hidden = true
    element.dataset.finalePhase = 'idle'
    stage.style.setProperty('--majorana-finale-camera-scale', '1')
    stage.style.setProperty('--majorana-finale-camera-x', '0px')
    stage.style.setProperty('--majorana-finale-camera-y', '0px')
    renderComposition(0)
    renderPulloutOpacity(0)
    renderChipSwap(0)
  }

  function dispose() {
    disposed = true
    cancel(false)
    element.remove()
    chipElement.remove()
  }

  reset()
  return { chipElement, element, prepare, play, reset, dispose }
}
