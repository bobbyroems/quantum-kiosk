import { withSceneSetup } from '../../core/scene-setup.js'
/*
 * Entanglement — "Two bodies. One state."
 * Port of the client's module-01b coin-entanglement prototype (ref/3js):
 * two coins spin in opposition, snap into a shared phase, then a tap on
 * either coin collapses both into the same random result. Interactions and
 * physics follow the prototype (the dev speed/clean-view panels are
 * dropped); the coin model, materials and lighting are the kiosk's quarter
 * + studio rig.
 */

import {
  COIN_RADIUS,
  ENTANGLEMENT_COIN_MATERIAL_SEEDS,
  QVC_COIN_ACCENT_COLOR,
  createCoinMaterial,
  createContactShadow,
  createGridFloor,
  createStudioRig
} from './coin-assets.js'
import { sound } from '../../core/kiosk-audio.js'
import { createKioskTooltip, updateKioskTooltip } from '../../core/kiosk-tooltip.js'
import { createUpNextPopup, UP_NEXT_POPUP_DELAY_MS } from '../../core/up-next-popup.js'
import { areUpNextCardsEnabled } from '../../core/kiosk-settings.js'
import { disposeObject3DResources } from '../../core/three-resource-disposal.js'
import { leaseWebGLRenderer } from '../../core/webgl-renderer-pool.js'

const ENTANGLE_DURATION = 1.15
const SPHERE_MEASURE_FADE_DURATION = 0.5
const SPHERE_OPACITY = 0.5
const FLOOR_Y = -2.05
const COIN_THICKNESS = 0.15
/* Grid sits at +0.003 and the contact shadows at +0.005, so the coins'
   undersides come to rest at +0.007 — clear of both, with no z-fighting. */
const COIN_REST_CLEARANCE = 0.007
/* The pair is drawn at SCENE_SCALE, so resting them means clearing half of
   their *scaled* thickness rather than a flat guess. */
const SCENE_SCALE = 0.72
const LANDING_Y = FLOOR_Y + COIN_REST_CLEARANCE + ((COIN_THICKNESS * SCENE_SCALE) / 2)
/*
 * Contact shadows, matching Superposition: dark and tight once the coins are
 * down, broad and faint while they hover. The old flat discs were squashed
 * narrower than the coins and drawn at 0.055, so they never read at all.
 */
const SHADOW_REST_OPACITY = 0.55
const SHADOW_AIR_OPACITY = 0.16
const SHADOW_REST_SCALE = 1
const SHADOW_AIR_SCALE = 1.6
const HOVER_Y = 0.45
const FALL_GRAVITY = -9.6
const MEASUREMENT_LAUNCH_VELOCITY = 3.4
const FACE_SPEED = 1
const ROLL_SPEED = 1
const MEDITATIVE_FACE_SPEED = 0.09
const MEDITATIVE_ROLL_SPEED = 0.015
const CLICK_SPIN_DURATION = 1.1

/*
 * The authored Entanglement sequence (Figma node 4:3695). Three stages: the
 * pair spinning free, the pair locked into one phase, and the shared result
 * after measurement. `emphasis` is the single phrase the design sets in accent
 * magenta.
 *
 * The board carries two copy blocks rather than one. A `lead` sits at the top
 * of the screen, above the coins, and the `title`/`body` pair sits below them —
 * which is what lets the first two stages name the idea overhead while the
 * phase label stays down with the thing it is labelling. The last stage has no
 * lower block: its lead is the whole point of the screen, and what sits low is
 * the result.
 */
const STAGE_COPY = Object.freeze({
  independent: Object.freeze({
    lead: 'Entanglement',
    leadIsTitle: true,
    title: 'Independent phase',
    body: 'Normally, separate qubits act completely on their own spinning with no connection to one another — just like these two coins above.',
    emphasis: '',
    action: 'Entangle the coins',
    hint: ''
  }),
  entangled: Object.freeze({
    lead: 'Through entanglement both coins result in the same answer.',
    leadIsTitle: false,
    title: 'Shared phase',
    body: 'Whatever happens to one coin instantly dictates the state of the other.',
    emphasis: '',
    action: 'Observe the result',
    hint: ''
  }),
  measured: Object.freeze({
    /* Broken where the board breaks it, the same way module 07 carries its
       two-line headings: the phrase is a pair of halves, and letting 128px type
       find its own wrap put "know" up with the first half. */
    lead: 'Measure one,\nknow both',
    leadIsTitle: true,
    leadBody: 'Measuring one coin determines the outcome of both. The moment one coin lands, its entangled pair reveals the same result.',
    title: '',
    body: '',
    emphasis: '',
    action: '',
    hint: 'Swipe up to flip the coins again'
  })
})

function gameMarkup() {
  return `
    <div class="qvc-game qvc-pair" data-state="independent" data-stage="independent" data-measured="false">
      <div class="qvc-game__scene" data-game-scene></div>
      <!-- The board's upper block: names the idea over the coins, while the
           phase label below stays with the thing it labels. -->
      <div class="qvc-pair__lead" data-pair-lead>
        <h2 class="qvc-pair__lead-title" data-pair-lead-title></h2>
        <p class="qvc-pair__lead-body" data-pair-lead-body></p>
      </div>
      <div class="qvc-pair__copy" data-pair-copy>
        <h2 class="qvc-pair__title" data-pair-title>Independent phase</h2>
        <p class="qvc-pair__body" data-pair-body></p>
      </div>
      <!-- Both sides resolve together, so the result is authored as one row
           rather than a single string: the join stays quiet while the two
           outcomes carry the colour. -->
      <div class="qvc-pair__outcome" data-pair-outcome aria-hidden="true">
        <span class="qvc-pair__outcome-side" data-outcome-left>Heads</span>
        <span class="qvc-pair__outcome-join">+</span>
        <span class="qvc-pair__outcome-side" data-outcome-right>Heads</span>
      </div>
      <button class="qvc-pair__action" type="button" data-action>Entangle the coins</button>
      <p class="qvc__sr" data-announce aria-live="polite"></p>
    </div>
  `
}

export function createEntanglementGame(host, options) {
  return withSceneSetup(defer => buildEntanglementGame(host, options, defer))
}

async function buildEntanglementGame(host, { assets, RoomEnvironment, onActivity, openGame, onGameComplete, band, popupHost }, defer) {
  const { THREE, geometry } = assets
  const TAU = Math.PI * 2

  const wrapper = document.createElement('div')
  wrapper.innerHTML = gameMarkup().trim()
  const root = wrapper.firstElementChild
  host.replaceChildren(root)
  defer(() => root.remove())

  const lead = root.querySelector('[data-pair-lead]')
  const leadTitle = root.querySelector('[data-pair-lead-title]')
  const leadBody = root.querySelector('[data-pair-lead-body]')
  const copyBlock = root.querySelector('[data-pair-copy]')

  const sceneHost = root.querySelector('[data-game-scene]')
  const copyTitle = root.querySelector('[data-pair-title]')
  const copyBody = root.querySelector('[data-pair-body]')
  const flipHint = createKioskTooltip({
    className: 'kiosk-tooltip--light qvc-pair__hint',
    hidden: true
  })
  copyBlock.after(flipHint.element)
  const outcomeLeft = root.querySelector('[data-outcome-left]')
  const outcomeRight = root.querySelector('[data-outcome-right]')
  const announce = root.querySelector('[data-announce]')
  const actionButton = root.querySelector('[data-action]')

  /* The band belongs to the module, which mounts the 1-2-3 on it and takes it
     back when the view changes. A game only borrows it to offer what follows —
     it must not clear it on the way out, because disposal is deferred by a
     frame and the next game has already put its own step up by then. */
  let upNextOffered = false
  const upNextBanner = band

  /* The popup is armed by each settled result rather than once alongside the
     band's offer.

     Starting another round drops it — one landing over a pair already
     spinning is what that guard is for — and only a result can put it back.
     Arming it once with the offer meant the first restart inside the
     five-second window cancelled it for the rest of the visit: the offer is
     one-shot, so nothing ever re-armed it. */
  let popupTimer = null
  let popupDeclined = false

  function cancelUpNextPopup () {
    if (popupTimer !== null) window.clearTimeout(popupTimer)
    popupTimer = null
  }

  /* Closing the popup is an answer, so it is not asked again. Starting
     another round is not: that withdraws it without reaching onDismiss. */
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
    title: 'Interference',
    /* A full-bleed plate rather than a cutout on white, so it fills the visual
       area instead of floating inside it. */
    visual: {
      src: 'assets/modules/differences/up-next/up-next-interference.webp',
      alt: 'A buoy marking one answer in the field.',
      fit: 'cover'
    },
    restartLabel: 'Entangle the coins again',
    onContinue() {
      onActivity?.()
      openGame?.('interference')
    },
    onRestart() {
      onActivity?.()
      resetScene()
    },
    onDismiss() {
      onActivity?.()
      popupDeclined = true
    }
  })
  defer(() => upNextCard.dispose())
  popupHost.append(upNextCard.element)

  /* Transparent scene: the kiosk's aurora backdrop shows through. */
  const scene = new THREE.Scene()
  defer(() => disposeObject3DResources(scene, { preserve: new Set([geometry, assets.bumpMap, ...assets.colorMaps, ...assets.roughnessMaps]) }))
  scene.fog = new THREE.Fog('#f4f3f5', 12, 30)

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
  /* These coins use authored contact shadows and explicitly do not cast real
     shadows, so do not allocate a new GPU shadow target for every visit. */
  rig.keyLight.castShadow = false

  /* Blue accent that breathes while the pair shares a phase (prototype). */
  const phaseLight = new THREE.PointLight(QVC_COIN_ACCENT_COLOR, 0, 8, 2)
  phaseLight.position.set(0, HOVER_Y, 2.2)
  scene.add(phaseLight)

  /* Shadow-only floor: catches the key light's shadow without hiding the
     aurora behind the canvas. */
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.ShadowMaterial({ opacity: 0.16 })
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = FLOOR_Y
  floor.receiveShadow = true
  scene.add(floor)

  /* The main-menu grid grounds the game in the same visual system, held at 80%
     of the shared default so it sits back from the coins. */
  scene.add(createGridFloor(assets, {
    size: 26,
    spacing: 0.6,
    opacity: 0.32,
    fadeRadius: 4.6,
    y: FLOOR_Y + 0.003
  }))

  function createCoin(direction, initialAngle) {
    const root3d = new THREE.Group()
    const materialSeed = direction > 0
      ? ENTANGLEMENT_COIN_MATERIAL_SEEDS[0]
      : ENTANGLEMENT_COIN_MATERIAL_SEEDS[1]
    const mesh = new THREE.Mesh(geometry, createCoinMaterial(assets, materialSeed))
    mesh.rotation.x = Math.PI / 2
    /* Prototype behaviour: the hovering pair uses the soft ellipse shadows
       only — a real cast shadow lands implausibly far from the coins. */
    mesh.castShadow = false
    mesh.receiveShadow = true
    root3d.add(mesh)
    scene.add(root3d)
    return {
      root: root3d,
      mesh,
      direction,
      angle: initialAngle,
      startAngle: initialAngle,
      targetAngle: initialAngle,
      rollAngle: initialAngle * 0.14,
      startRollAngle: initialAngle * 0.14,
      targetRollAngle: initialAngle * 0.14,
      clickSpinElapsed: 0,
      clickSpinOffset: 0,
      clickSpinActive: false,
      startPosition: new THREE.Vector3()
    }
  }

  const coins = [createCoin(1, 0), createCoin(-1, Math.PI * 0.68)]

  function createPhaseGuide(color) {
    const points = []
    for (let index = 0; index < 96; index += 1) {
      const angle = (index / 96) * TAU
      points.push(new THREE.Vector3(Math.cos(angle) * 1.28, Math.sin(angle) * 1.28, -0.18))
    }
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.16 })
    const group = new THREE.Group()
    group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), material))
    const markerMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.72 })
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), markerMaterial)
    marker.position.set(1.28, 0, -0.16)
    group.add(marker)
    scene.add(group)
    return { group, material, markerMaterial }
  }

  const guides = [createPhaseGuide(0x29313a), createPhaseGuide(0x0078d4)]

  function createSphereOverlay(coin) {
    const radius = COIN_RADIUS * 1.18
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
    coin.root.add(group)
    return { group, arrow, shellMaterial, equatorMaterial, meridianMaterial, arrowMaterials }
  }

  let sphereReveal = 1
  const sphereOverlays = coins.map(createSphereOverlay)

  function applySphereOverlayOpacity() {
    const opacity = SPHERE_OPACITY * sphereReveal
    for (const overlay of sphereOverlays) {
      overlay.group.visible = opacity > 0.001
      overlay.shellMaterial.opacity = opacity
      overlay.equatorMaterial.opacity = Math.min(1, opacity * 1.35)
      overlay.meridianMaterial.opacity = Math.min(1, opacity * 1.5)
      for (const material of overlay.arrowMaterials) {
        material.opacity = Math.min(1, opacity * 1.7)
      }
    }
  }

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
    for (const overlay of sphereOverlays) overlay.arrow.setDirection(arrowMotion.current)
  }

  const shadows = coins.map(() => {
    const shadow = createContactShadow(assets, {
      radius: COIN_RADIUS * 1.2,
      opacity: SHADOW_AIR_OPACITY,
      core: 100
    })
    shadow.position.y = FLOOR_Y + 0.005
    /* SCENE_SCALE, not the sceneScale binding: this runs during setup, which is
       above that `let` and so inside its temporal dead zone. */
    shadow.scale.set(SHADOW_AIR_SCALE * SCENE_SCALE, SHADOW_AIR_SCALE * SCENE_SCALE, 1)
    scene.add(shadow)
    return shadow
  })

  const linkedOrbitPoints = []
  for (let index = 0; index < 128; index += 1) {
    const angle = (index / 128) * TAU
    linkedOrbitPoints.push(new THREE.Vector3(Math.cos(angle) * 2.65, Math.sin(angle) * 0.58, -0.24))
  }
  const linkedOrbitMaterial = new THREE.LineBasicMaterial({ color: '#0078d4', transparent: true, opacity: 0 })
  const linkedOrbit = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(linkedOrbitPoints),
    linkedOrbitMaterial
  )
  linkedOrbit.position.y = HOVER_Y
  scene.add(linkedOrbit)

  const linkGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()])
  const linkMaterial = new THREE.LineBasicMaterial({ color: '#0078d4', transparent: true, opacity: 0 })
  scene.add(new THREE.Line(linkGeometry, linkMaterial))

  const linkNodes = [-0.36, 0, 0.36].map(offset => {
    const node = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 10, 8),
      new THREE.MeshBasicMaterial({ color: '#0078d4', transparent: true, opacity: 0 })
    )
    node.userData.offset = offset
    scene.add(node)
    return node
  })

  const STATE = Object.freeze({
    INDEPENDENT: 'independent',
    ENTANGLING: 'entangling',
    ENTANGLED: 'entangled',
    MEASURING: 'measuring',
    MEASURED: 'measured'
  })

  let state = STATE.INDEPENDENT
  let spread = 1.08
  let linkedSpread = 0.9
  let sceneScale = 0.72
  let stateElapsed = 0
  let sharedAngle = 0
  let sharedRollAngle = 0
  let fallVelocity = 0
  let measuredResult = 'Heads'
  let measurementStartAngle = 0
  let measurementStartRollAngle = 0
  let measurementTargetAngle = 0
  let measurementTargetRollAngle = 0
  let measurementFaceVelocity = 0
  let measurementRollVelocity = 0
  let measurementDuration = 1
  let measurementApexY = HOVER_Y
  let measurementPass = 0
  let impactElapsed = 0
  let spinPlayback = null
  let disposed = false

  const clamp01 = value => THREE.MathUtils.clamp(value, 0, 1)

  function smoothstep(value) {
    const clamped = clamp01(value)
    return clamped * clamped * (3 - 2 * clamped)
  }

  function easeOutBack(value) {
    const amount = 1.12
    const shifted = value - 1
    return 1 + (amount + 1) * shifted ** 3 + amount * shifted ** 2
  }

  function previousEquivalent(currentAngle, targetPhase) {
    let equivalent = targetPhase - Math.ceil((targetPhase - currentAngle) / TAU) * TAU
    if (equivalent > currentAngle - TAU * 0.45) equivalent -= TAU
    return equivalent
  }

  function nextEquivalent(currentAngle, targetPhase, minimumTurns) {
    let equivalent = targetPhase + Math.ceil((currentAngle - targetPhase) / TAU) * TAU
    while (equivalent < currentAngle + TAU * minimumTurns) equivalent += TAU
    return equivalent
  }

  function hermite(start, end, startVelocity, endVelocity, progress, duration) {
    const progress2 = progress * progress
    const progress3 = progress2 * progress
    return (2 * progress3 - 3 * progress2 + 1) * start
      + (progress3 - 2 * progress2 + progress) * duration * startVelocity
      + (-2 * progress3 + 3 * progress2) * end
      + (progress3 - progress2) * duration * endVelocity
  }

  function updateLinkGeometry() {
    const positions = linkGeometry.attributes.position
    positions.setXYZ(0, coins[0].root.position.x, coins[0].root.position.y, -0.08)
    positions.setXYZ(1, coins[1].root.position.x, coins[1].root.position.y, -0.08)
    positions.needsUpdate = true
    for (const node of linkNodes) {
      node.position.set(
        node.userData.offset,
        (coins[0].root.position.y + coins[1].root.position.y) / 2,
        -0.06
      )
    }
  }

  /* Which authored stage each state presents. The two transitions hold the copy
     they came from rather than flashing a message nobody can finish reading. */
  const STAGE_FOR_STATE = Object.freeze({
    [STATE.INDEPENDENT]: 'independent',
    [STATE.ENTANGLING]: 'independent',
    [STATE.ENTANGLED]: 'entangled',
    [STATE.MEASURING]: 'entangled',
    [STATE.MEASURED]: 'measured'
  })

  const COPY_SWAP_MS = 260
  let copySwap = null
  let appliedStage = null

  /* Split the authored body around its accent phrase so the emphasis is a real
     element rather than markup parsed back out of a string. */
  function renderBody(stage) {
    copyBody.replaceChildren()
    const index = stage.emphasis ? stage.body.indexOf(stage.emphasis) : -1
    if (index < 0) {
      copyBody.textContent = stage.body
      return
    }
    const accent = document.createElement('em')
    accent.className = 'qvc-pair__accent'
    accent.textContent = stage.emphasis
    copyBody.append(
      stage.body.slice(0, index),
      accent,
      stage.body.slice(index + stage.emphasis.length)
    )
  }

  function applyStage(stageId) {
    const stage = STAGE_COPY[stageId]
    if (!stage) return
    copyTitle.textContent = stage.title
    renderBody(stage)
    /* The upper block. Its lead is a heading on the stages that name an idea
       and a sentence on the one that explains it, so the element it lands in
       decides its weight rather than a second style rule. */
    leadTitle.textContent = stage.leadIsTitle ? stage.lead : ''
    leadTitle.hidden = !stage.leadIsTitle
    leadBody.textContent = stage.leadIsTitle ? (stage.leadBody ?? '') : stage.lead
    leadBody.hidden = !leadBody.textContent
    lead.hidden = !stage.lead
    /* Nothing sits below the coins on the measured stage; the result does. */
    copyBlock.hidden = !stage.title && !stage.body
    updateKioskTooltip(flipHint, { text: stage.hint, visible: Boolean(stage.hint) })
    /* The measured stage has no button, so it carries no label to apply. */
    if (stage.action) actionButton.textContent = stage.action
    root.dataset.stage = stageId
  }

  /* Fade out, swap, fade back in — each stage reads as a fresh panel instead of
     text mutating under the visitor's eye. */
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
    stateElapsed = 0
    root.dataset.state = nextState
    /* Only the two settled states take input; the transitions lock the button
       so a second press cannot interrupt an animation mid-flight. */
    actionButton.disabled = state !== STATE.INDEPENDENT && state !== STATE.ENTANGLED
    /* Unlocks the "Up next" band the moment Measure is pressed, and it then
       stays for the rest of the run. */
    if (state === STATE.MEASURING) root.dataset.measured = 'true'
    /* The magenta latches on once the pair are linked and stays for the rest
       of the run. Keying it off the stage alone let it drop out the moment the
       visitor threw the pair again, which reads as the entanglement being
       undone — it is not, and the copy above still says so. */
    if (state === STATE.ENTANGLING || state === STATE.ENTANGLED) {
      root.classList.add('is-entangled')
    }
    setStage(STAGE_FOR_STATE[state])
  }

  function setOutcome(result) {
    outcomeLeft.textContent = result
    outcomeRight.textContent = result
    positionOutcomeLabels()
  }

  /* Each word names one coin, so it is placed over that coin rather than by a
     centred row. A row centred on the stage is laid out by its own text widths,
     which puts "Tails + Tails" somewhere different to "Heads + Heads" and
     leaves neither above the thing it names. Projecting the coins is also what
     keeps the pair right when they close from `spread` to `linkedSpread`. */
  const outcomeProjection = new THREE.Vector3()

  function positionOutcomeLabels() {
    /* Layout pixels, not client pixels: the stage is CSS-scaled to the panel
       and these labels are positioned in its own 2160-wide space. */
    const stageWidth = sceneHost.offsetWidth
    if (!stageWidth) return
    const labels = [outcomeLeft, outcomeRight]
    coins.forEach((coin, index) => {
      coin.root.getWorldPosition(outcomeProjection)
      outcomeProjection.project(camera)
      const stageX = (outcomeProjection.x * 0.5 + 0.5) * stageWidth
      labels[index].style.left = `${stageX.toFixed(1)}px`
    })
  }

  function setIndependentPositions() {
    coins[0].root.position.set(-spread, HOVER_Y, 0)
    coins[1].root.position.set(spread, HOVER_Y, 0)
  }

  function settleClickSpin(coin) {
    if (!coin.clickSpinActive) return
    coin.angle += coin.clickSpinOffset
    coin.clickSpinElapsed = 0
    coin.clickSpinOffset = 0
    coin.clickSpinActive = false
  }

  function beginClickSpin(coin) {
    if (state !== STATE.INDEPENDENT) return
    /* Preserve the exact visible angle when a second tap interrupts a spin. */
    settleClickSpin(coin)
    coin.clickSpinActive = true
  }

  function resetScene() {
    /* Starting another round inside the popup's delay means they are not
       finished, so it is dropped rather than landing over a pair already
       spinning. The next result arms it afresh. The band keeps its offer: it
       does not interrupt, so it can stand through another round. */
    cancelUpNextPopup()
    upNextCard.withdraw()
    coins[0].angle = 0
    coins[1].angle = Math.PI * 0.68
    coins[0].rollAngle = 0
    coins[1].rollAngle = -Math.PI * 0.12
    coins.forEach((coin, index) => {
      coin.clickSpinElapsed = 0
      coin.clickSpinOffset = 0
      coin.clickSpinActive = false
      coin.root.rotation.set(coin.angle, 0, coin.rollAngle)
      coin.mesh.rotation.set(Math.PI / 2, 0, 0)
      coin.root.scale.setScalar(sceneScale)
      guides[index].group.rotation.z = coin.rollAngle
      guides[index].material.opacity = 0.16
      guides[index].markerMaterial.opacity = 0.72
    })
    sphereReveal = 1
    applySphereOverlayOpacity()
    setIndependentPositions()
    shadows.forEach((shadow, index) => {
      shadow.position.x = coins[index].root.position.x
      shadow.material.opacity = SHADOW_AIR_OPACITY
      shadow.scale.set(SHADOW_AIR_SCALE * sceneScale, SHADOW_AIR_SCALE * sceneScale, 1)
    })
    linkedOrbitMaterial.opacity = 0
    linkMaterial.opacity = 0
    for (const node of linkNodes) node.material.opacity = 0
    phaseLight.intensity = 0
    setOutcome('Heads')
    sharedAngle = 0
    sharedRollAngle = 0
    fallVelocity = 0
    impactElapsed = 0
    /* Restarting mid-wind-up would strand the spin. */
    spinPlayback?.stop()
    spinPlayback = null
    setState(STATE.INDEPENDENT)
  }

  function beginEntanglement() {
    if (state !== STATE.INDEPENDENT) return
    /* Held so the wind-up can be cut when the coins lock into phase. */
    spinPlayback?.stop()
    spinPlayback = sound.coinSpin()
    for (const coin of coins) {
      settleClickSpin(coin)
      coin.startAngle = coin.angle
      coin.startRollAngle = coin.rollAngle
      coin.startPosition.copy(coin.root.position)
    }
    const targetPhase = coins[0].angle + TAU * 1.15
    const targetRollPhase = coins[0].rollAngle + TAU * 0.18
    coins[0].targetAngle = targetPhase
    coins[1].targetAngle = previousEquivalent(coins[1].angle, targetPhase)
    coins[0].targetRollAngle = targetRollPhase
    coins[1].targetRollAngle = previousEquivalent(coins[1].rollAngle, targetRollPhase)
    sharedAngle = targetPhase
    sharedRollAngle = targetRollPhase
    setState(STATE.ENTANGLING)
  }

  function beginMeasurement() {
    if (state !== STATE.ENTANGLED) return
    measurementPass += 1
    measuredResult = Math.random() < 0.5 ? 'Heads' : 'Tails'
    measurementStartAngle = sharedAngle
    measurementStartRollAngle = sharedRollAngle
    fallVelocity = MEASUREMENT_LAUNCH_VELOCITY
    measurementFaceVelocity = 1.55 * FACE_SPEED
    measurementRollVelocity = 0.18 * ROLL_SPEED
    const fallDistance = coins[0].root.position.y - LANDING_Y
    measurementDuration = (
      fallVelocity + Math.sqrt(fallVelocity ** 2 + 2 * Math.abs(FALL_GRAVITY) * fallDistance)
    ) / Math.abs(FALL_GRAVITY)
    measurementApexY = coins[0].root.position.y + fallVelocity ** 2 / (2 * Math.abs(FALL_GRAVITY))
    const measurementTurns = 2.5
    const targetFaceRotation = measuredResult === 'Heads' ? 0 : Math.PI
    measurementTargetAngle = nextEquivalent(
      measurementStartAngle,
      targetFaceRotation - Math.PI / 2,
      measurementTurns
    )
    measurementTargetRollAngle = measurementStartRollAngle
      + measurementRollVelocity * measurementDuration * 0.7
    impactElapsed = 0
    setOutcome(measuredResult)
    announce.textContent = `Both coins measured ${measuredResult}`
    setState(STATE.MEASURING)
  }

  const listeners = new AbortController()
  defer(() => listeners.abort())
  actionButton.addEventListener('click', () => {
    onActivity?.()
    if (state === STATE.INDEPENDENT) beginEntanglement()
    else if (state === STATE.ENTANGLED) beginMeasurement()
    else if (state === STATE.MEASURED) resetScene()
  }, { signal: listeners.signal })

  const coinRaycaster = new THREE.Raycaster()
  const coinPointer = new THREE.Vector2()
  const coinMeshes = coins.map(coin => coin.mesh)

  function coinAtPointer(event) {
    const bounds = renderer.domElement.getBoundingClientRect()
    coinPointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1
    )
    coinRaycaster.setFromCamera(coinPointer, camera)
    const hit = coinRaycaster.intersectObjects(coinMeshes, false)[0]
    return hit ? coins[coinMeshes.indexOf(hit.object)] : null
  }

  /* A restart tap lands on the canvas too, and `click` fires after the
     `pointerup` that reset the scene — without this the same tap would spin
     the coin it happened to land on. */
  let swallowNextClick = false

  renderer.domElement.addEventListener('click', event => {
    if (swallowNextClick) {
      swallowNextClick = false
      return
    }
    onActivity?.()
    const clickedCoin = coinAtPointer(event)
    if (!clickedCoin) return
    if (state === STATE.INDEPENDENT) beginClickSpin(clickedCoin)
    else if (state === STATE.ENTANGLED) beginMeasurement()
  }, { signal: listeners.signal })

  /* The authored measured screen drops the button for "Tap to restart", so a
     tap anywhere on the stage has to do that. The upward swipe keeps working
     as well (same 52px threshold in physical screen pixels as Superposition),
     so visitors who learned the gesture on the earlier screens are not stuck. */
  const TAP_SLOP = 24
  let restartActive = false
  let restartStartX = 0
  let restartStartY = 0
  let restartCurrentX = 0
  let restartCurrentY = 0

  function onRestartStart(event) {
    if (state !== STATE.MEASURED) return
    restartActive = true
    restartStartX = event.clientX
    restartStartY = event.clientY
    restartCurrentX = event.clientX
    restartCurrentY = event.clientY
  }

  function onRestartMove(event) {
    if (!restartActive) return
    restartCurrentX = event.clientX
    restartCurrentY = event.clientY
  }

  function finishRestart() {
    if (!restartActive) return
    restartActive = false
    if (state !== STATE.MEASURED) return
    const dx = restartCurrentX - restartStartX
    const dy = restartCurrentY - restartStartY
    const isTap = Math.abs(dx) <= TAP_SLOP && Math.abs(dy) <= TAP_SLOP
    const isSwipeUp = -dy > 52
    if (isTap || isSwipeUp) {
      onActivity?.()
      swallowNextClick = true
      resetScene()
    }
  }

  renderer.domElement.addEventListener('pointerdown', onRestartStart, { signal: listeners.signal })
  renderer.domElement.addEventListener('pointermove', onRestartMove, { signal: listeners.signal })
  renderer.domElement.addEventListener('pointerup', finishRestart, { signal: listeners.signal })
  renderer.domElement.addEventListener('pointercancel', finishRestart, { signal: listeners.signal })

  function updateIndependent(delta, elapsed) {
    coins.forEach((coin, index) => {
      coin.angle += delta * MEDITATIVE_FACE_SPEED * coin.direction
      coin.rollAngle += delta * MEDITATIVE_ROLL_SPEED * coin.direction
      if (coin.clickSpinActive) {
        coin.clickSpinElapsed += delta
        const progress = clamp01(coin.clickSpinElapsed / CLICK_SPIN_DURATION)
        coin.clickSpinOffset = smoothstep(progress) * TAU * coin.direction
        if (progress >= 1) settleClickSpin(coin)
      }
      coin.root.rotation.x = coin.angle + coin.clickSpinOffset
      coin.root.rotation.z = coin.rollAngle
      coin.root.position.y = HOVER_Y + Math.sin(elapsed * 1.4 + index * 1.8) * 0.1
      coin.mesh.rotation.set(Math.PI / 2, Math.sin(elapsed * 0.8 + index) * 0.035, 0)
      guides[index].group.position.copy(coin.root.position)
      guides[index].group.rotation.z = coin.rollAngle
      shadows[index].position.x = coin.root.position.x
    })
    linkedOrbitMaterial.opacity = 0
    linkMaterial.opacity = 0
    phaseLight.intensity = 0
  }

  function updateEntangling(delta) {
    stateElapsed += delta
    const progress = clamp01(stateElapsed / ENTANGLE_DURATION)
    const movement = easeOutBack(progress)
    const rotation = smoothstep(progress)

    coins.forEach((coin, index) => {
      const targetX = index === 0 ? -linkedSpread : linkedSpread
      coin.root.position.x = THREE.MathUtils.lerp(coin.startPosition.x, targetX, movement)
      coin.root.position.y = HOVER_Y + Math.sin(progress * Math.PI) * 0.2
      coin.angle = THREE.MathUtils.lerp(coin.startAngle, coin.targetAngle, rotation)
      coin.rollAngle = THREE.MathUtils.lerp(coin.startRollAngle, coin.targetRollAngle, rotation)
      coin.root.rotation.x = coin.angle
      coin.root.rotation.z = coin.rollAngle
      guides[index].group.position.copy(coin.root.position)
      guides[index].group.rotation.z = coin.rollAngle
      guides[index].material.opacity = 0.16 * (1 - progress)
      guides[index].markerMaterial.opacity = 0.72 * (1 - progress)
      shadows[index].position.x = coin.root.position.x
    })

    linkedOrbitMaterial.opacity = progress * 0.18
    linkMaterial.opacity = progress * 0.42
    linkNodes.forEach((node, index) => {
      node.material.opacity = progress * (0.65 - index * 0.08)
    })
    phaseLight.intensity = progress * 2.6
    updateLinkGeometry()

    if (progress >= 1) {
      sharedAngle %= TAU
      sharedRollAngle %= TAU
      sphereReveal = 1
      applySphereOverlayOpacity()
      coins.forEach((coin, index) => {
        coin.angle = sharedAngle
        coin.rollAngle = sharedRollAngle
        coin.root.rotation.x = sharedAngle
        coin.root.rotation.z = sharedRollAngle
        coin.root.position.set(index === 0 ? -linkedSpread : linkedSpread, HOVER_Y, 0)
      })
      spinPlayback?.stop()
      spinPlayback = null
      setState(STATE.ENTANGLED)
    }
  }

  function updateEntangled(delta, elapsed) {
    sharedAngle += delta * MEDITATIVE_FACE_SPEED
    sharedRollAngle += delta * MEDITATIVE_ROLL_SPEED
    const linkedY = HOVER_Y + Math.sin(elapsed * 1.35) * 0.055

    coins.forEach((coin, index) => {
      coin.angle = sharedAngle
      coin.rollAngle = sharedRollAngle
      coin.root.rotation.x = sharedAngle
      coin.root.rotation.z = sharedRollAngle
      coin.root.position.set(index === 0 ? -linkedSpread : linkedSpread, linkedY, 0)
      coin.mesh.rotation.set(Math.PI / 2, 0, 0)
      guides[index].group.position.copy(coin.root.position)
      guides[index].group.rotation.z = sharedRollAngle
      guides[index].material.opacity = 0.055
      guides[index].markerMaterial.opacity = 0.42
      shadows[index].position.x = coin.root.position.x
    })

    linkedOrbit.rotation.z = Math.sin(elapsed * 0.35) * 0.025
    linkedOrbitMaterial.opacity = 0.18
    linkMaterial.opacity = 0.42 + Math.sin(elapsed * 2.2) * 0.08
    linkNodes.forEach((node, index) => {
      node.material.opacity = 0.58 + Math.sin(elapsed * 2.5 + index) * 0.18
    })
    phaseLight.intensity = 2.3 + Math.sin(elapsed * 1.8) * 0.35
    updateLinkGeometry()
  }

  function updateMeasuring(delta) {
    stateElapsed += delta
    fallVelocity += FALL_GRAVITY * delta
    sphereReveal = 1 - smoothstep(clamp01(stateElapsed / SPHERE_MEASURE_FADE_DURATION))
    applySphereOverlayOpacity()
    const nextY = coins[0].root.position.y + fallVelocity * delta
    const heightProgress = clamp01(1 - (nextY - LANDING_Y) / (HOVER_Y - LANDING_Y))
    const altitudeProgress = clamp01(
      (Math.max(nextY, LANDING_Y) - LANDING_Y) / (measurementApexY - LANDING_Y)
    )
    const motionProgress = clamp01(stateElapsed / measurementDuration)

    sharedAngle = hermite(
      measurementStartAngle,
      measurementTargetAngle,
      measurementFaceVelocity,
      0,
      motionProgress,
      measurementDuration
    )
    sharedRollAngle = hermite(
      measurementStartRollAngle,
      measurementTargetRollAngle,
      measurementRollVelocity,
      0,
      motionProgress,
      measurementDuration
    )

    coins.forEach((coin, index) => {
      coin.root.position.y = Math.max(LANDING_Y, nextY)
      coin.root.rotation.x = sharedAngle
      coin.root.rotation.z = sharedRollAngle
      coin.mesh.rotation.x = Math.PI / 2
      guides[index].group.position.copy(coin.root.position)
      guides[index].group.rotation.z = sharedRollAngle
      guides[index].material.opacity = 0.055 * (1 - heightProgress)
      guides[index].markerMaterial.opacity = 0.42 * (1 - heightProgress)
      shadows[index].position.x = coin.root.position.x
      shadows[index].material.opacity = THREE.MathUtils.lerp(
        SHADOW_REST_OPACITY,
        SHADOW_AIR_OPACITY,
        altitudeProgress
      )
      const shadowScale = THREE.MathUtils.lerp(
        SHADOW_REST_SCALE,
        SHADOW_AIR_SCALE,
        altitudeProgress
      ) * sceneScale
      shadows[index].scale.set(shadowScale, shadowScale, 1)
    })

    linkedOrbitMaterial.opacity = 0.18 * (1 - heightProgress)
    linkMaterial.opacity = 0.42 * (1 - heightProgress)
    for (const node of linkNodes) {
      node.material.opacity *= Math.max(0, 1 - delta * 4.5)
    }
    phaseLight.intensity = 2.3 * (1 - heightProgress)
    updateLinkGeometry()

    if (nextY <= LANDING_Y) {
      for (const coin of coins) {
        coin.root.position.y = LANDING_Y
        coin.root.rotation.set(measurementTargetAngle, 0, measurementTargetRollAngle)
        coin.mesh.rotation.x = Math.PI / 2
      }
      linkedOrbitMaterial.opacity = 0
      linkMaterial.opacity = 0
      for (const node of linkNodes) node.material.opacity = 0
      sphereReveal = 0
      applySphereOverlayOpacity()
      phaseLight.intensity = 0
      impactElapsed = 0
      sound.coinDrop()
      setState(STATE.MEASURED)
      /* The shared result is the moment there is somewhere to go next, so the
         card is offered once, here — but held back, so the pair they just landed
         gets the screen to itself first. Later rounds do not re-offer it; by
         then the band at the top is carrying the same invitation quietly. */
      if (!upNextOffered) {
        upNextOffered = true
        upNextBanner.offerNext({
          title: 'Interference',
          /* No delay: the band is the quiet half and does not cover the pair
             the visitor has just landed. */
          delayMs: 0,
          onContinue() {
            onActivity?.()
            openGame?.('interference')
          }
        })
        /* Finishing is landing the result, not the offer appearing. Reporting
           it from the offer is what once left the principle never marked
           complete when the popups were switched off, locking the next one. */
        onGameComplete?.('entanglement')
      }
      /* Give the first result its authored pause. On a repeated measurement,
         make the route onward explicit as soon as the coins land. */
      armUpNextPopup({ immediate: measurementPass > 1 })
    }
  }

  function updateMeasured(delta) {
    impactElapsed += delta
    const bounce = Math.abs(Math.sin(impactElapsed * 13)) * Math.exp(-impactElapsed * 8) * 0.07
    for (const coin of coins) {
      coin.root.position.y = LANDING_Y + bounce
    }
    for (const shadow of shadows) {
      shadow.material.opacity = THREE.MathUtils.lerp(
        shadow.material.opacity,
        SHADOW_REST_OPACITY,
        Math.min(1, delta * 5)
      )
    }
  }

  function resize() {
    const rect = sceneHost.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return
    /* Portrait kiosk framing (the prototype's portrait branch). */
    spread = 1.08
    linkedSpread = 0.9
    sceneScale = 0.72
    camera.aspect = rect.width / rect.height
    camera.position.set(0, 2.25, 15.4)
    camera.updateProjectionMatrix()
    camera.lookAt(0, -0.45, 0)
    /* The labels are placed by projecting the coins, so they have to be redone
       whenever the projection changes. */
    positionOutcomeLabels()
    renderer.setSize(rect.width, rect.height, false)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    linkedOrbit.scale.set(0.66, 0.84, 1)
    coins.forEach((coin, index) => {
      coin.root.scale.setScalar(sceneScale)
      guides[index].group.scale.setScalar(sceneScale)
    })
    if (state !== STATE.MEASURING && state !== STATE.MEASURED) {
      for (const shadow of shadows) {
        shadow.scale.set(SHADOW_AIR_SCALE * sceneScale, SHADOW_AIR_SCALE * sceneScale, 1)
      }
    }
    if (state === STATE.INDEPENDENT) {
      setIndependentPositions()
    } else if (state !== STATE.ENTANGLING) {
      coins.forEach((coin, index) => {
        coin.root.position.x = index === 0 ? -linkedSpread : linkedSpread
      })
    }
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

    if (state === STATE.INDEPENDENT) updateIndependent(delta, elapsed)
    else if (state === STATE.ENTANGLING) updateEntangling(delta)
    else if (state === STATE.ENTANGLED) updateEntangled(delta, elapsed)
    else if (state === STATE.MEASURING) updateMeasuring(delta)
    else if (state === STATE.MEASURED) updateMeasured(delta)

    if (sphereReveal > 0.001) updateArrowMotion(delta)
    renderer.render(scene, camera)
    if (!renderer.domElement.classList.contains('is-ready')) {
      renderer.domElement.classList.add('is-ready')
    }
  }

  resize()
  resetScene()
  animate()

  return {
    restart() {
      /* A full restart clears the run. resetScene() alone cannot: it is also
         the between-rounds reset, where the unlock has to survive. */
      root.dataset.measured = 'false'
      root.classList.remove('is-entangled')
      /* The next visitor should meet this as the first visitor did, so the band
         drops its offer and goes back to carrying the 1-2-3. */
      upNextBanner.withdrawOffer()
      upNextOffered = false
      popupDeclined = false
      measurementPass = 0
      cancelUpNextPopup()
      upNextCard.withdraw()
      resetScene()
    },
    dispose() {
      if (disposed) return
      disposed = true
      listeners.abort()
      /* Leaving the module mid-wind-up would otherwise leave it droning. */
      spinPlayback?.stop()
      spinPlayback = null
      cancelUpNextPopup()
      upNextCard.dispose()
      window.clearTimeout(copySwap)
      cancelAnimationFrame(animationFrame)
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
