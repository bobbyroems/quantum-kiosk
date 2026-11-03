import { withSceneSetup } from '../../core/scene-setup.js'
import { warmSceneVariants } from '../../core/warm-scene-variants.js'
/*
 * Superposition — "One toss. Two possibilities."
 * Port of the client's module-01a coin bullet-time prototype (ref/3js):
 * swipe up to flip; at the apex time dilates and two counter-rotating
 * outcomes coexist inside a Bloch shell; one survives, lands, and advances
 * its tally. Interactions and physics follow the prototype; the coin model,
 * materials and lighting are the kiosk's quarter + studio rig.
 */

import { sound } from '../../core/kiosk-audio.js'
import { createKioskTooltip } from '../../core/kiosk-tooltip.js'
import { createUpNextPopup, UP_NEXT_POPUP_DELAY_MS } from '../../core/up-next-popup.js'
import { areUpNextCardsEnabled } from '../../core/kiosk-settings.js'
import { disposeObject3DResources } from '../../core/three-resource-disposal.js'
import { leaseWebGLRenderer } from '../../core/webgl-renderer-pool.js'
import {
  COIN_RADIUS,
  ENTANGLEMENT_COIN_MATERIAL_SEEDS,
  QVC_COIN_ACCENT_COLOR,
  createCoinMaterial,
  createContactShadow,
  createGridFloor,
  createStudioRig
} from './coin-assets.js'

const BULLET_DURATION = 5
const BULLET_SPHERE_OPACITY = 0.5
const COIN_THICKNESS = 0.15
const FLOOR_Y = -1.75
/*
 * Stacking at the floor, spaced just enough not to z-fight: grid at +0.003,
 * contact shadow at +0.005, the coin's underside at +0.007. The coin's origin
 * is its centre, so resting it on the ground means clearing half its own
 * thickness — the old flat +0.2 left it hovering a visible ~0.13 above the grid.
 */
const COIN_REST_CLEARANCE = 0.007
const START_Y = FLOOR_Y + COIN_REST_CLEARANCE + (COIN_THICKNESS / 2)
const PEAK_Y = 1.2
const GRAVITY = -11.5
const LAUNCH_VELOCITY = Math.sqrt(2 * Math.abs(GRAVITY) * (PEAK_Y - START_Y))
/* Ground contact shadow. The resting coin sits only ~0.13 units off the floor,
   so its shadow wants to be dark and tight against the rim — a wide, soft one
   reads as the coin hovering well above the grid. It spreads and fades only as
   the coin actually climbs. */
const SHADOW_REST_OPACITY = 0.55
const SHADOW_AIR_OPACITY = 0.08
/*
 * Footprint multipliers on the shadow plane, which is already 1.45 coin radii.
 * These stay equal in X and Z: the plane lies flat on the floor, so the camera
 * angle supplies the foreshortening. Squashing Z as well (the old 0.3) left the
 * shadow narrower than the coin it belonged to, hidden underneath it.
 */
const SHADOW_REST_SCALE = 1
const SHADOW_AIR_SCALE = 1.55

export function getSuperpositionResultText(state, selectedResult) {
  if (state !== 'landed') return ''
  return selectedResult === 'Heads' || selectedResult === 'Tails' ? selectedResult : ''
}

/*
 * The authored Superposition sequence. Each stage owns a copy block, a hint pill
 * and where on the stage they sit: the intro and the result read at eye level
 * above the coin, while the bullet-time narration drops below the airborne coin
 * so it never covers it. `emphasis` is the one phrase the design sets in accent
 * blue, and `body` may be a pair where the design sets two paragraphs.
 *
 * The 25 Aug flow puts an ordinary coin first. The visitor flips it and it
 * simply falls — no bullet time, no sphere, nothing quantum — and only then is
 * it reframed as a qubit and thrown again. That first ordinary flip is the
 * point of the rewrite: superposition means little without having just watched
 * the same object behave classically. So the sequence runs in two passes, and
 * which pass the visitor is on decides both what the copy says and whether the
 * coin stops in the air at all.
 */
const STAGE_COPY = Object.freeze({
  ready: Object.freeze({
    title: 'Heads or tails?',
    body: ['This is a regular coin.', 'It can be heads or tails.'],
    emphasis: '',
    hint: 'Swipe up to flip the coin',
    place: 'high'
  }),
  /* Between the passes: the coin has landed like any coin, and is reframed as a
     qubit before it is thrown again. No `emphasis`: the copy runs in one ink. */
  reframed: Object.freeze({
    title: '',
    body: [
      'Now think of the coin as a qubit. A qubit is where quantum information is stored.',
      'A qubit can hold both possibilities of heads and tails simultaneously.'
    ],
    emphasis: '',
    hint: 'Swipe up to flip the coin again',
    place: 'high'
  }),
  /* The ordinary coin in the air. The board puts nothing on screen here — no
     copy, no hint — so the flip itself is the only thing happening. */
  flight: Object.freeze({
    title: '',
    body: [],
    emphasis: '',
    hint: '',
    place: 'low'
  }),
  /* Bullet time: the coin is held in the air. No `emphasis` here either. */
  bullet: Object.freeze({
    title: 'Superposition',
    body: ['The coin in the air represents superposition, a quantum state in which heads and tails exist together as possibilities until measurement.'],
    emphasis: '',
    hint: 'Watch both outcomes coexist until time resumes',
    place: 'low'
  }),
  landed: Object.freeze({
    title: '',
    body: 'Measuring the coin forces it to pick a side, collapsing superposition into a single result.',
    emphasis: '',
    hint: 'Swipe up to flip the coin again',
    place: 'high'
  })
})

function gameMarkup() {
  return `
    <div class="qvc-game qvc-flip" data-state="ready" data-place="high" data-flipped="false">
      <div class="qvc-game__scene" data-game-scene></div>
      <div class="qvc-flip__copy" data-flip-copy>
        <h2 class="qvc-flip__title" data-flip-title>Superposition</h2>
        <p class="qvc-flip__body" data-flip-body></p>
      </div>
      <div class="qvc-flip__result" data-result aria-hidden="true">Heads</div>
      <section class="qvc-flip__tally" aria-label="Running tally">
        <div class="qvc-flip__tally-groups">
          <div class="qvc-flip__tally-group">
            <span class="qvc-flip__tally-label">Heads</span>
            <span class="qvc-flip__tally-digits" data-tally="Heads"></span>
          </div>
          <div class="qvc-flip__tally-group">
            <span class="qvc-flip__tally-label">Tails</span>
            <span class="qvc-flip__tally-digits" data-tally="Tails"></span>
          </div>
        </div>
      </section>
      <p class="qvc__sr" data-announce aria-live="polite"></p>
    </div>
  `
}

export function createSuperpositionGame(host, options) {
  return withSceneSetup(defer => buildSuperpositionGame(host, options, defer))
}

async function buildSuperpositionGame(host, { assets, RoomEnvironment, onActivity, openGame, onGameComplete, band, popupHost, signal }, defer) {
  const { THREE, geometry } = assets
  const TAU = Math.PI * 2

  const wrapper = document.createElement('div')
  wrapper.innerHTML = gameMarkup().trim()
  const root = wrapper.firstElementChild
  host.replaceChildren(root)
  defer(() => root.remove())

  const sceneHost = root.querySelector('[data-game-scene]')
  const copyPanel = root.querySelector('[data-flip-copy]')
  const copyTitle = root.querySelector('[data-flip-title]')
  const copyBody = root.querySelector('[data-flip-body]')
  const flipHint = createKioskTooltip({
    className: 'kiosk-tooltip--light qvc-flip__hint'
  })
  copyPanel.after(flipHint.element)
  const hintText = flipHint.copy

  /* The band belongs to the module, which mounts the 1-2-3 on it and takes it
     back when the view changes. A game only borrows it to offer what follows —
     it must not clear it on the way out, because disposal is deferred by a
     frame and the next game has already put its own step up by then. */
  let upNextOffered = false
  const upNextBanner = band

  /* The popup is armed by each settled result rather than once alongside the
     band's offer.

     Flipping again drops it — one landing over a coin already back in the
     air is what that guard is for — and only a result can put it back. Arming
     it once with the offer meant the first re-flip inside the five-second
     window cancelled it for the rest of the visit: the offer is one-shot, so
     nothing ever re-armed it. */
  let popupTimer = null
  let popupDeclined = false

  function cancelUpNextPopup () {
    if (popupTimer !== null) window.clearTimeout(popupTimer)
    popupTimer = null
  }

  /* Closing the popup is an answer, so it is not asked again. Flipping is
     not: that withdraws it without ever reaching onDismiss. */
  function armUpNextPopup ({ immediate = false } = {}) {
    cancelUpNextPopup()
    if (popupDeclined || !areUpNextCardsEnabled()) return
    if (immediate) {
      upNextCard.raise(0)
      return
    }
    popupTimer = window.setTimeout(() => {
      popupTimer = null
      upNextCard.raise(0)
    }, UP_NEXT_POPUP_DELAY_MS)
  }

  /* The last beat, and the only one that interrupts. It now follows the band
     rather than preceding it: the quiet offer gets first refusal and the popup
     only asks outright if that goes unanswered, which is the order the rest of
     the floor runs. Settings can still switch it off, and then the band is the
     whole offer. */
  const upNextCard = createUpNextPopup({
    title: 'Entanglement',
    /* A full-bleed plate rather than a cutout on white, so it fills the visual
       area instead of floating inside it. */
    visual: {
      src: 'assets/modules/differences/up-next/up-next-entanglement.webp',
      alt: 'Two linked Bloch spheres sharing one state.',
      fit: 'cover'
    },
    restartLabel: 'Flip the coin again',
    onContinue() {
      onActivity?.()
      openGame?.('entanglement')
    },
    /* Only steps out of the way. Flipping it for them would skip the gesture
       the whole game is teaching — it puts them back in front of the coin,
       ready to swipe. */
    onRestart() {
      onActivity?.()
    },
    onDismiss() {
      onActivity?.()
      popupDeclined = true
    }
  })
  defer(() => upNextCard.dispose())
  popupHost.append(upNextCard.element)
  const resultLabel = root.querySelector('[data-result]')
  const announce = root.querySelector('[data-announce]')
  const tallyCells = {
    Heads: root.querySelector('[data-tally="Heads"]'),
    Tails: root.querySelector('[data-tally="Tails"]')
  }
  const tallyCounts = { Heads: 0, Tails: 0 }

  /* Transparent scene: the kiosk's aurora backdrop shows through. */
  const scene = new THREE.Scene()
  defer(() => disposeObject3DResources(scene, { preserve: new Set([geometry, assets.bumpMap, ...assets.colorMaps, ...assets.roughnessMaps]) }))
  scene.fog = new THREE.Fog('#f4f3f5', 12, 26)

  const camera = new THREE.PerspectiveCamera(29, 1, 0.1, 60)

  const rendererLease = leaseWebGLRenderer(THREE, {
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  })
  defer(() => rendererLease.release())
  const { renderer } = rendererLease
  renderer.setClearColor(0x000000, 0)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.domElement.className = 'qvc-game__canvas'
  sceneHost.append(renderer.domElement)

  const rig = createStudioRig(assets, renderer, scene, { RoomEnvironment })
  defer(() => rig.dispose())

  /* Electric-blue accent that swells during bullet time (prototype). */
  const blueLight = new THREE.PointLight(QVC_COIN_ACCENT_COLOR, 0, 8, 2)
  blueLight.position.set(0, 1.8, 2.8)
  scene.add(blueLight)

  /* The main-menu grid grounds the game in the same visual system, held at 80%
     of the shared default so it sits back from the coin. */
  scene.add(createGridFloor(assets, {
    size: 26,
    spacing: 0.6,
    opacity: 0.32,
    fadeRadius: 4.6,
    y: FLOOR_Y + 0.003
  }))

  /* Same soft gradient contact shadow as the sub-menu cards — no
     shadow-mapped floor. */
  rig.keyLight.castShadow = false
  const contactShadow = createContactShadow(assets, {
    /* Only a fifth wider than the coin: at this height the penumbra is narrow,
       so the plane stays close to the silhouette it belongs to. */
    radius: COIN_RADIUS * 1.2,
    opacity: SHADOW_REST_OPACITY,
    /* Solid out to 0.94 units against a coin of 1.0 — the shadow is dark right
       up to the rim and only softens over the last stretch past it. */
    core: 100
  })
  contactShadow.position.set(0, FLOOR_Y + 0.005, 0)
  contactShadow.scale.set(SHADOW_REST_SCALE, SHADOW_REST_SCALE, 1)
  scene.add(contactShadow)

  /* Same seed on purpose: the ghost is the same quarter's other outcome,
     so its mint-and-wear fingerprint must match the primary exactly. */
  const sharedMaterialSeed = ENTANGLEMENT_COIN_MATERIAL_SEEDS[0]
  const primaryCoin = new THREE.Mesh(geometry, createCoinMaterial(assets, sharedMaterialSeed))
  primaryCoin.castShadow = true
  primaryCoin.receiveShadow = true
  const ghostMaterial = createCoinMaterial(assets, sharedMaterialSeed)
  ghostMaterial.transparent = true
  ghostMaterial.opacity = 0
  ghostMaterial.depthWrite = false
  const alternateCoin = new THREE.Mesh(geometry, ghostMaterial)
  primaryCoin.position.set(0, START_Y, 0)
  alternateCoin.position.copy(primaryCoin.position)
  alternateCoin.visible = false
  scene.add(primaryCoin, alternateCoin)

  /* Bloch shell overlay shown while the two outcomes coexist. */
  function createSphereOverlay() {
    const radius = COIN_RADIUS * 1.2
    const group = new THREE.Group()
    const shellMaterial = new THREE.MeshPhysicalMaterial({
      color: '#d9e9ff',
      transparent: true,
      opacity: 0,
      roughness: 0.32,
      metalness: 0,
      clearcoat: 0.82,
      clearcoatRoughness: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false
    })
    const shell = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), shellMaterial)
    shell.renderOrder = 4
    group.add(shell)

    const ring = (mapPoint, dashed) => {
      const points = []
      for (let index = 0; index <= 128; index += 1) {
        points.push(mapPoint((index / 128) * TAU, radius))
      }
      const material = dashed
        ? new THREE.LineDashedMaterial({
            color: '#0078d4',
            transparent: true,
            opacity: 0,
            dashSize: 0.09,
            gapSize: 0.065,
            depthTest: false,
            depthWrite: false
          })
        : new THREE.LineBasicMaterial({
            color: '#0078d4',
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false
          })
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material)
      if (dashed) line.computeLineDistances()
      line.renderOrder = dashed ? 6 : 7
      group.add(line)
      return material
    }
    const equatorMaterial = ring(
      (angle, r) => new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r),
      true
    )
    const meridianMaterial = ring(
      (angle, r) => new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * r, 0),
      false
    )

    const arrow = new THREE.ArrowHelper(
      new THREE.Vector3(0.52, 0.68, 0.52).normalize(),
      new THREE.Vector3(0, 0, 0),
      radius,
      0x2a446f,
      0.18,
      0.11
    )
    const arrowMaterials = [arrow.line.material, arrow.cone.material]
    for (const material of arrowMaterials) {
      material.transparent = true
      material.opacity = 0
      material.depthTest = false
      material.depthWrite = false
    }
    arrow.line.renderOrder = 8
    arrow.cone.renderOrder = 8
    group.add(arrow)

    group.visible = false
    scene.add(group)
    return { group, arrow, shellMaterial, equatorMaterial, meridianMaterial, arrowMaterials }
  }

  const sphereOverlay = createSphereOverlay()
  const arrowMotion = {
    start: new THREE.Vector3(0.52, 0.68, 0.52).normalize(),
    target: new THREE.Vector3(),
    current: new THREE.Vector3(),
    elapsed: 0,
    duration: THREE.MathUtils.randFloat(0.9, 1.6)
  }

  function randomArrowDirection(reference) {
    const direction = new THREE.Vector3()
    do {
      const vertical = Math.random() * 2 - 1
      const azimuth = Math.random() * TAU
      const radial = Math.sqrt(1 - vertical * vertical)
      direction.set(radial * Math.cos(azimuth), vertical, radial * Math.sin(azimuth))
    } while (direction.dot(reference) < -0.55)
    return direction
  }
  arrowMotion.target.copy(randomArrowDirection(arrowMotion.start))
  arrowMotion.current.copy(arrowMotion.start)

  function updateArrowMotion(delta) {
    arrowMotion.elapsed += delta
    if (arrowMotion.elapsed >= arrowMotion.duration) {
      arrowMotion.elapsed -= arrowMotion.duration
      arrowMotion.start.copy(arrowMotion.target)
      arrowMotion.target.copy(randomArrowDirection(arrowMotion.start))
      arrowMotion.duration = THREE.MathUtils.randFloat(0.9, 1.6)
    }
    arrowMotion.current
      .lerpVectors(arrowMotion.start, arrowMotion.target, smoothstep(arrowMotion.elapsed / arrowMotion.duration))
      .normalize()
    sphereOverlay.arrow.setDirection(arrowMotion.current)
  }

  function updateSphereOverlay(reveal) {
    const opacity = BULLET_SPHERE_OPACITY * THREE.MathUtils.clamp(reveal, 0, 1)
    sphereOverlay.group.visible = opacity > 0.001
    sphereOverlay.shellMaterial.opacity = opacity
    sphereOverlay.equatorMaterial.opacity = Math.min(1, opacity * 1.35)
    sphereOverlay.meridianMaterial.opacity = Math.min(1, opacity * 1.5)
    for (const material of sphereOverlay.arrowMaterials) {
      material.opacity = Math.min(1, opacity * 1.7)
    }
  }

  function syncSphereOverlayTransform() {
    /* Keep the shell centred on the two outcomes while they split. */
    sphereOverlay.group.position.lerpVectors(primaryCoin.position, alternateCoin.position, 0.5)
    sphereOverlay.group.rotation.copy(primaryCoin.rotation)
    sphereOverlay.group.scale.copy(primaryCoin.scale)
  }

  const STATE = Object.freeze({
    READY: 'ready',
    RISING: 'rising',
    BULLET: 'bullet',
    FALLING: 'falling',
    LANDED: 'landed'
  })

  let state = STATE.READY
  let velocityY = 0
  let flipAngle = 0
  let spinVelocity = 0
  let alternateAngle = 0
  let bulletElapsed = 0
  let bulletBlend = 0
  let fadeBlend = 0
  let selectedResult = 'Heads'
  /* Which throw this is. 0 before anything has been flipped, 1 for the ordinary
     coin, 2 and up for the qubit. It gates both the copy and bullet time. */
  let flipPass = 0
  let targetAngle = 0
  let pointerActive = false
  let pointerStartY = 0
  let pointerCurrentY = 0
  let disposed = false

  function smoothstep(value) {
    const clamped = THREE.MathUtils.clamp(value, 0, 1)
    return clamped * clamped * (3 - 2 * clamped)
  }

  /* Which authored stage each flip state presents. Rising and falling are the
     travelling states: they hold the copy on either side of them rather than
     flashing a third message the visitor has no time to read. */
  /* The first flip is the ordinary one: it rises with nothing on screen, falls,
     and lands on the reframing that turns the coin into a qubit. Every flip
     after it is the quantum one and gets the bullet-time narration. */
  function stageForState(currentState, pass) {
    const classicalPass = pass <= 1
    switch (currentState) {
      case STATE.RISING:
        return classicalPass ? 'flight' : (appliedStage ?? 'reframed')
      case STATE.BULLET:
        return 'bullet'
      case STATE.FALLING:
        return classicalPass ? 'flight' : 'bullet'
      case STATE.LANDED:
        return pass <= 1 ? 'reframed' : 'landed'
      default:
        return pass === 0 ? 'ready' : (pass === 1 ? 'reframed' : 'landed')
    }
  }

  const COPY_SWAP_MS = 260
  let copySwap = null
  let appliedStage = null

  /* Split the authored body around its accent phrase so the emphasis is a real
     element rather than markup parsed back out of a string. */
  function renderBody(stage) {
    copyBody.replaceChildren()
    const paragraphs = Array.isArray(stage.body) ? stage.body : [stage.body]
    for (const text of paragraphs) {
      const line = document.createElement('span')
      line.className = 'qvc-flip__body-line'
      const index = stage.emphasis ? text.indexOf(stage.emphasis) : -1
      if (index < 0) {
        line.textContent = text
      } else {
        const accent = document.createElement('em')
        accent.className = 'qvc-flip__accent'
        accent.textContent = stage.emphasis
        line.append(
          text.slice(0, index),
          accent,
          text.slice(index + stage.emphasis.length)
        )
      }
      copyBody.append(line)
    }
  }

  function applyStage(stageId) {
    const stage = STAGE_COPY[stageId]
    if (!stage) return
    copyTitle.textContent = stage.title
    copyTitle.hidden = !stage.title
    renderBody(stage)
    hintText.textContent = stage.hint
    flipHint.element.hidden = !stage.hint
    /* Drives where the copy and hint sit: the airborne coin owns the middle of
       the stage, so bullet time pushes its narration below it. */
    root.dataset.place = stage.place
    root.dataset.stage = stageId
  }

  /* Fade out, swap, fade back in — each stage reads as a fresh panel instead
     of text mutating under the visitor's eye. */
  function setStage(stageId) {
    if (!stageId || stageId === appliedStage) return
    const isFirst = appliedStage === null
    appliedStage = stageId
    window.clearTimeout(copySwap)
    if (isFirst) {
      applyStage(stageId)
      root.classList.add('is-copy-in')
      return
    }
    root.classList.remove('is-copy-in')
    copySwap = window.setTimeout(() => {
      if (disposed) return
      applyStage(stageId)
      root.classList.add('is-copy-in')
    }, COPY_SWAP_MS)
  }

  function setState(nextState) {
    state = nextState
    root.dataset.state = state
    resultLabel.textContent = getSuperpositionResultText(state, selectedResult)
    setStage(stageForState(state, flipPass))
  }

  /* Two-digit flip counter, as authored: every digit is its own dark tile, so
     the running total reads as a mechanical tally rather than a number in a
     box. Padded to a fixed width so the row never reflows as it climbs. */
  function paintTally(result) {
    const cell = tallyCells[result]
    const digits = String(Math.min(99, tallyCounts[result])).padStart(2, '0')
    cell.replaceChildren(...[...digits].map(digit => {
      const tile = document.createElement('span')
      tile.className = 'qvc-flip__tally-digit'
      tile.textContent = digit
      return tile
    }))
    return cell
  }

  function renderTally(result) {
    const cell = paintTally(result)
    cell.classList.remove('is-counting')
    void cell.offsetWidth
    cell.classList.add('is-counting')
    announce.textContent = `${result} tally ${tallyCounts[result]}`
  }

  function reset() {
    velocityY = 0
    flipAngle = 0
    alternateAngle = 0
    spinVelocity = 0
    bulletElapsed = 0
    bulletBlend = 0
    fadeBlend = 0
    primaryCoin.position.set(0, START_Y, 0)
    primaryCoin.rotation.set(0, 0, 0)
    primaryCoin.scale.setScalar(1)
    alternateCoin.position.copy(primaryCoin.position)
    alternateCoin.rotation.copy(primaryCoin.rotation)
    alternateCoin.scale.setScalar(1)
    alternateCoin.visible = false
    ghostMaterial.opacity = 0
    syncSphereOverlayTransform()
    updateSphereOverlay(0)
    blueLight.intensity = 0
    contactShadow.material.opacity = SHADOW_REST_OPACITY
    setState(STATE.READY)
  }

  function launch(strength = 1) {
    if (state !== STATE.READY && state !== STATE.LANDED) return
    if (state === STATE.LANDED) reset()
    /* Throwing again inside the popup's delay means they are not finished, so
       it is dropped rather than landing over a coin already back in the air.
       The next result arms it afresh. The band keeps its offer: it does not
       interrupt, so it can stand while they flip again. */
    cancelUpNextPopup()
    upNextCard.withdraw()

    flipPass += 1
    selectedResult = Math.random() > 0.5 ? 'Heads' : 'Tails'
    velocityY = LAUNCH_VELOCITY * THREE.MathUtils.clamp(strength, 0.92, 1.12)
    spinVelocity = 11.5 * THREE.MathUtils.clamp(strength, 0.94, 1.14)
    sound.coinFlip()
    flipAngle = 0
    alternateAngle = 0
    bulletElapsed = 0
    bulletBlend = 0
    fadeBlend = 0
    setState(STATE.RISING)
  }

  function enterBulletTime() {
    primaryCoin.position.y = PEAK_Y
    alternateCoin.position.copy(primaryCoin.position)
    alternateCoin.rotation.copy(primaryCoin.rotation)
    alternateAngle = flipAngle
    alternateCoin.visible = true
    velocityY = 0
    bulletElapsed = 0
    setState(STATE.BULLET)
  }

  function resolveOutcome({ fromBullet = true } = {}) {
    const primarySurvives = selectedResult === 'Heads'
    /* Only bullet time puts a second coin in the air to collapse into. Coming
       straight off the apex there is nothing to swap, so the coin that is
       already spinning simply spins on to the face it landed on. */
    if (!primarySurvives && fromBullet) {
      flipAngle = alternateAngle
      primaryCoin.rotation.copy(alternateCoin.rotation)
    }
    const finalPhase = selectedResult === 'Heads' ? 0 : Math.PI
    const direction = primarySurvives ? 1 : -1
    const currentTurn = (flipAngle - finalPhase) / TAU
    targetAngle = (
      direction > 0 ? Math.ceil(currentTurn + 1.25) : Math.floor(currentTurn - 1.25)
    ) * TAU + finalPhase
    fadeBlend = 1
    velocityY = -0.62
    updateSphereOverlay(0)
    setState(STATE.FALLING)
  }

  function updateReady(delta) {
    primaryCoin.rotation.y += delta * 0.16
    /* No idle bob: a coin lying on the ground does not hover. The slow yaw
       above is all the life it needs while it waits to be flipped. */
    primaryCoin.position.y = START_Y
    contactShadow.material.opacity = SHADOW_REST_OPACITY
    contactShadow.scale.set(SHADOW_REST_SCALE, SHADOW_REST_SCALE, 1)
  }

  function updateRising(delta) {
    velocityY += GRAVITY * delta
    primaryCoin.position.y += velocityY * delta
    flipAngle += spinVelocity * delta
    primaryCoin.rotation.x = flipAngle
    primaryCoin.rotation.z = Math.sin(flipAngle * 0.24) * 0.08
    primaryCoin.position.x = Math.sin(flipAngle * 0.18) * 0.08

    const heightProgress = THREE.MathUtils.clamp(
      (primaryCoin.position.y - START_Y) / (PEAK_Y - START_Y),
      0,
      1
    )
    contactShadow.material.opacity = THREE.MathUtils.lerp(
      SHADOW_REST_OPACITY,
      SHADOW_AIR_OPACITY,
      heightProgress
    )
    const shadowScale = THREE.MathUtils.lerp(SHADOW_REST_SCALE, SHADOW_AIR_SCALE, heightProgress)
    contactShadow.scale.set(shadowScale, shadowScale, 1)

    if (velocityY <= 0.12 || primaryCoin.position.y >= PEAK_Y) {
      /* The ordinary coin just falls. Bullet time, the sphere and the whole
         superposition narration belong to the qubit, which is the throw after
         this one. */
      if (flipPass <= 1) resolveOutcome({ fromBullet: false })
      else enterBulletTime()
    }
  }

  function updateBullet(delta, elapsed) {
    bulletElapsed += delta
    const intro = smoothstep(bulletElapsed / 0.85)
    const outroStart = BULLET_DURATION - 0.72
    const outro = bulletElapsed > outroStart
      ? 1 - smoothstep((bulletElapsed - outroStart) / 0.72)
      : 1
    bulletBlend = intro * outro

    const slowDelta = delta * 0.07
    flipAngle += spinVelocity * slowDelta
    alternateAngle -= spinVelocity * slowDelta
    primaryCoin.rotation.x = flipAngle
    alternateCoin.rotation.x = alternateAngle
    primaryCoin.rotation.z = Math.sin(elapsed * 0.42) * 0.045
    alternateCoin.rotation.z = -Math.sin(elapsed * 0.42) * 0.045

    /* Both outcomes start at centre, then slide equal distances apart. */
    const separation = 0.22 * bulletBlend
    const offset = separation * 0.5
    primaryCoin.position.set(-offset, PEAK_Y, 0)
    alternateCoin.position.set(offset, PEAK_Y, -0.05)
    const pulse = 1 + Math.sin(elapsed * 1.35) * 0.012 * bulletBlend
    primaryCoin.scale.setScalar(pulse)
    alternateCoin.scale.setScalar(2 - pulse)
    syncSphereOverlayTransform()
    if (bulletBlend > 0.001) updateArrowMotion(delta)
    updateSphereOverlay(bulletBlend)

    ghostMaterial.opacity = bulletBlend * 0.72
    blueLight.intensity = bulletBlend * 2.8

    if (bulletElapsed >= BULLET_DURATION) resolveOutcome()
  }

  function updateFalling(delta) {
    velocityY += GRAVITY * delta
    primaryCoin.position.y += velocityY * delta

    const distance = Math.max(0.001, primaryCoin.position.y - START_Y)
    const totalDistance = PEAK_Y - START_Y
    const fallProgress = 1 - THREE.MathUtils.clamp(distance / totalDistance, 0, 1)
    const easedFall = smoothstep(fallProgress)

    flipAngle = THREE.MathUtils.lerp(flipAngle, targetAngle, Math.min(1, delta * (2.4 + easedFall * 8)))
    primaryCoin.rotation.x = flipAngle
    primaryCoin.rotation.z *= Math.max(0, 1 - delta * 5)
    primaryCoin.position.x *= Math.max(0, 1 - delta * 5)

    fadeBlend = Math.max(0, fadeBlend - delta * 1.85)
    ghostMaterial.opacity = fadeBlend * 0.72
    alternateCoin.position.lerp(primaryCoin.position, Math.min(1, delta * 4))
    alternateCoin.scale.setScalar(0.98 + fadeBlend * 0.02)
    blueLight.intensity = fadeBlend * 1.2

    contactShadow.material.opacity = THREE.MathUtils.lerp(
      SHADOW_AIR_OPACITY,
      SHADOW_REST_OPACITY,
      easedFall
    )
    const shadowScale = THREE.MathUtils.lerp(SHADOW_AIR_SCALE, SHADOW_REST_SCALE, easedFall)
    contactShadow.scale.set(shadowScale, shadowScale, 1)

    if (primaryCoin.position.y <= START_Y) {
      primaryCoin.position.set(0, START_Y, 0)
      primaryCoin.rotation.set(targetAngle, 0, 0)
      primaryCoin.scale.setScalar(1)
      alternateCoin.visible = false
      blueLight.intensity = 0
      sound.coinDrop()
      setState(STATE.LANDED)
      tallyCounts[selectedResult] = Math.min(99, tallyCounts[selectedResult] + 1)
      renderTally(selectedResult)
      /* Unlocks the tally, which stays for the rest of the run — a counter that
         came and went between flips would read as a glitch rather than as
         progress. */
      root.dataset.flipped = 'true'
      /* The first quantum result is the moment there is somewhere to go next,
         so the band turns into the offer once, here. Later flips do not
         re-offer it — it is already standing.

         Not after the ordinary coin: at that point the visitor has seen a coin
         fall, which is not the thing this game exists to show them. */
      if (flipPass > 1) {
        if (!upNextOffered) {
          upNextOffered = true
          upNextBanner.offerNext({
            title: 'Entanglement',
            /* No delay: the band is the quiet half and does not cover the
               result the visitor has just produced. */
            delayMs: 0,
            onContinue() {
              onActivity?.()
              openGame?.('entanglement')
            }
          })
          /* Finishing is landing the result, not the offer appearing. Reporting
             it from the offer is what once left the principle never marked
             complete when the popups were switched off, locking the next one. */
          onGameComplete?.('superposition')
        }
        /* The first quantum result keeps the authored breathing room. If the
           visitor repeats it before noticing the route onward, the second
           quantum result raises that route immediately. */
        armUpNextPopup({ immediate: flipPass > 2 })
      }
    }
  }

  function updateLanded(delta) {
    contactShadow.material.opacity = THREE.MathUtils.lerp(contactShadow.material.opacity, SHADOW_REST_OPACITY, Math.min(1, delta * 3))
    contactShadow.scale.x = THREE.MathUtils.lerp(contactShadow.scale.x, SHADOW_REST_SCALE, Math.min(1, delta * 3))
    contactShadow.scale.y = THREE.MathUtils.lerp(contactShadow.scale.y, SHADOW_REST_SCALE, Math.min(1, delta * 3))
  }

  function onPointerDown(event) {
    onActivity?.()
    if (state !== STATE.READY && state !== STATE.LANDED) return
    pointerActive = true
    pointerStartY = event.clientY
    pointerCurrentY = event.clientY
    renderer.domElement.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event) {
    if (!pointerActive) return
    pointerCurrentY = event.clientY
  }

  function finishPointer(event) {
    if (!pointerActive) return
    pointerActive = false
    const distance = pointerStartY - pointerCurrentY
    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
      renderer.domElement.releasePointerCapture(event.pointerId)
    }
    /* clientY is physical screen pixels, so the prototype's swipe
       threshold carries over unchanged. */
    if (distance > 52) {
      launch(0.92 + Math.min(distance, 260) / 1300)
    }
  }

  const listeners = new AbortController()
  defer(() => listeners.abort())
  renderer.domElement.addEventListener('pointerdown', onPointerDown, { signal: listeners.signal })
  renderer.domElement.addEventListener('pointermove', onPointerMove, { signal: listeners.signal })
  renderer.domElement.addEventListener('pointerup', finishPointer, { signal: listeners.signal })
  renderer.domElement.addEventListener('pointercancel', finishPointer, { signal: listeners.signal })

  function resize() {
    const rect = sceneHost.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return
    camera.aspect = rect.width / rect.height
    camera.position.set(0, 1.95, 13.5)
    camera.updateProjectionMatrix()
    camera.lookAt(0, -0.15, 0)
    renderer.setSize(rect.width, rect.height, false)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
  }

  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(sceneHost)
  window.addEventListener('resize', resize)
  defer(() => { resizeObserver.disconnect(); window.removeEventListener('resize', resize) })

  const clock = new THREE.Clock()
  let animationFrame = 0
  defer(() => cancelAnimationFrame(animationFrame))
  function animate() {
    if (disposed) return
    animationFrame = requestAnimationFrame(animate)
    const delta = Math.min(clock.getDelta(), 0.035)
    const elapsed = clock.elapsedTime

    if (state === STATE.READY) updateReady(delta)
    else if (state === STATE.RISING) updateRising(delta)
    else if (state === STATE.BULLET) updateBullet(delta, elapsed)
    else if (state === STATE.FALLING) updateFalling(delta)
    else if (state === STATE.LANDED) updateLanded(delta)

    renderer.render(scene, camera)
    if (!renderer.domElement.classList.contains('is-ready')) {
      renderer.domElement.classList.add('is-ready')
    }
  }

  resize()
  paintTally('Heads')
  paintTally('Tails')
  reset()
  // Include the hidden ghost coin, physical sphere, rings and arrow before
  // is-ready reveals the canvas. The ordinary first toss never draws them.
  await warmSceneVariants(renderer, scene, camera, { signal })
  animate()

  return {
    restart() {
      /* A full restart clears the run. reset() alone cannot: launch() also
         calls it between flips, where the tally has to survive. */
      tallyCounts.Heads = 0
      tallyCounts.Tails = 0
      paintTally('Heads')
      paintTally('Tails')
      root.dataset.flipped = 'false'
      /* The next visitor should meet this as the first visitor did, so the band
         drops its offer and goes back to carrying the 1-2-3. */
      upNextBanner.withdrawOffer()
      upNextOffered = false
      popupDeclined = false
      cancelUpNextPopup()
      /* Back to the ordinary coin. reset() cannot do this — launch() calls it
         between flips, where the pass has to survive — so the count is cleared
         here with the tally, for the same reason. */
      flipPass = 0
      upNextCard.withdraw()
      reset()
    },
    dispose() {
      if (disposed) return
      disposed = true
      listeners.abort()
      window.clearTimeout(copySwap)
      cancelAnimationFrame(animationFrame)
      cancelUpNextPopup()
      upNextCard.dispose()
      resizeObserver.disconnect()
      window.removeEventListener('resize', resize)
      rig.dispose()
      disposeObject3DResources(scene, {
        preserve: new Set([
          geometry,
          assets.bumpMap,
          ...assets.colorMaps,
          ...assets.roughnessMaps
        ])
      })
      scene.clear()
      rendererLease.release()
      root.remove()
    }
  }
}
