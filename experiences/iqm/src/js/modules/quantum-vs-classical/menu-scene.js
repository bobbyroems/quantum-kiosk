/*
 * Sub-menu visualizations for the current Figma selection screen (506:2224).
 * These deliberately reuse the same quarter geometry/materials and buoy GLB
 * as the full experiences. The canvas stays transparent so the authored
 * layout and CSS contact shadows remain the only surrounding chrome.
 */

import {
  createCoinMaterial,
  createStudioRig
} from './coin-assets.js'
import { BUOY_SCREEN_EAST_YAW, cloneBuoy } from './interference-assets.js'
import { calculateQvcPixelRatio } from './render-quality.js'
import { leaseWebGLRenderer } from '../../core/webgl-renderer-pool.js'

const INTERFERENCE_PREVIEW_BUOY_Y = -1.16
const INTERFERENCE_PREVIEW_PITCH = 15 * Math.PI / 180
const INTERFERENCE_PREVIEW_YAW = 1.5 * Math.PI / 180

export function menuViewportChanged(current, next) {
  if (!current) return true
  return Math.abs(current.width - next.width) > 0.01 ||
    Math.abs(current.height - next.height) > 0.01 ||
    Math.abs(current.pixelRatio - next.pixelRatio) > 0.001
}

export function createMenuScene(
  host,
  { assets, buoyAssets, RoomEnvironment }
) {
  const { THREE, geometry } = assets
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

  /* Menu-only material tuning: retain the game geometry and texture maps,
     but remove the gloss map's near-mirror patches so rotations never blow
     out into flat white discs under the studio environment. */
  let coinSeed = 0
  const coinMaterials = new Set()
  const createMenuCoinMaterial = (seed, opacity = 1) => {
    const material = createCoinMaterial(assets, seed)
    material.roughnessMap = null
    material.roughness = 0.74
    material.metalness = 0.52
    material.envMapIntensity = 0.18
    material.bumpScale = 0.78
    material.color.set('#b9b5ad')
    material.opacity = opacity
    material.transparent = opacity < 1
    material.depthWrite = opacity >= 0.75
    material.needsUpdate = true
    coinMaterials.add(material)
    return material
  }
  const nextCoinMaterial = (opacity = 1) => (
    createMenuCoinMaterial(++coinSeed, opacity)
  )

  const views = []

  /* One transparent canvas per visualization keeps the three independently
     framed source compositions while sharing the already-loaded assets. */
  function createCardView(id, { fitHalfWidth, fitHalfHeight }) {
    const cardHost = host.querySelector(`[data-qvc-card-scene="${id}"]`)
    if (!cardHost) throw new Error(`Missing sub-menu card scene host: ${id}`)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40)
    const rendererLease = leaseWebGLRenderer(THREE, {
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    })
    const { renderer } = rendererLease
    renderer.setClearColor(0x000000, 0)
    renderer.setClearAlpha(0)
    renderer.domElement.className = 'qvc__menu-canvas'
    renderer.domElement.style.background = 'transparent'
    const poster = document.createElement('canvas')
    poster.className = 'qvc__menu-poster'
    const posterContext = poster.getContext('2d', { alpha: true })
    cardHost.append(poster, renderer.domElement)

    const rig = createStudioRig(assets, renderer, scene, { RoomEnvironment })
    rig.keyLight.castShadow = false
    if (id !== 'interference') {
      renderer.toneMappingExposure = 0.88
      rig.keyLight.intensity = 1.45
      rig.fillLight.intensity = 0.46
      rig.rimLight.intensity = 0.58
      rig.hemiLight.intensity = 0.28
      if (id === 'entanglement') {
        renderer.toneMappingExposure = 0.96
        rig.keyLight.intensity = 1.7
        rig.fillLight.intensity = 0.55
        rig.rimLight.intensity = 0.68
        rig.hemiLight.intensity = 0.34
      }
    } else {
      renderer.toneMappingExposure = 0.7
      rig.keyLight.intensity = 1.1
      rig.fillLight.intensity = 0.18
      rig.rimLight.intensity = 0.28
      rig.hemiLight.intensity = 0.12
    }

    const view = {
      id,
      host: cardHost,
      scene,
      camera,
      renderer,
      rendererLease,
      poster,
      posterContext,
      rig,
      fitHalfWidth,
      fitHalfHeight,
      viewport: null,
      update: () => {},
      disposeCluster: null,
      contextRestorationToken: 0,
      onContextLost: null,
      onContextRestored: null
    }

    view.onContextLost = event => {
      event.preventDefault()
      view.contextRestorationToken += 1
      view.host.classList.add('is-context-lost')
    }
    view.onContextRestored = () => {
      const restorationToken = ++view.contextRestorationToken
      void restoreView(view, restorationToken)
    }
    renderer.domElement.addEventListener('webglcontextlost', view.onContextLost)
    renderer.domElement.addEventListener('webglcontextrestored', view.onContextRestored)
    views.push(view)
    return view
  }

  /* Superposition reads as five fully opaque, aligned samples from one coin
     trajectory. Spacing and phase offsets stay fixed while one shared clock
     rotates the whole sequence. */
  {
    const view = createCardView('superposition', {
      fitHalfWidth: 1,
      /* The render host has matching overflow padding in CSS. Increasing
         both values proportionally preserves apparent size and spacing. */
      fitHalfHeight: 2.64
    })
    const samples = [
      { y: -2.02, z: 0.02, phase: 0.18 },
      { y: -0.92, z: -0.03, phase: 1.12 },
      { y: 0.02, z: 0.04, phase: 2.38 },
      { y: 1.04, z: -0.02, phase: 3.2 },
      { y: 1.9, z: 0.03, phase: 4.55 }
    ]
    const coins = []
    for (const sample of samples) {
      const coin = new THREE.Mesh(geometry, nextCoinMaterial())
      coin.scale.setScalar(0.54)
      coin.position.set(0, sample.y, sample.z)
      coin.rotation.x = sample.phase
      coin.userData.sample = sample
      view.scene.add(coin)
      coins.push(coin)
    }
    view.update = elapsed => {
      const motionTime = reducedMotion ? 0 : elapsed
      const sharedSpin = motionTime * 0.62
      const sharedTilt = Math.sin(motionTime * 0.78) * 0.025
      const sharedLift = Math.sin(motionTime * 0.82) * 0.022
      coins.forEach(coin => {
        const sample = coin.userData.sample
        coin.rotation.x = sample.phase + sharedSpin
        coin.rotation.z = sharedTilt
        coin.position.x = 0
        coin.position.y = sample.y + sharedLift
      })
    }
  }

  /* Entanglement: two quarters spinning in one shared phase. */
  {
    const view = createCardView('entanglement', {
      fitHalfWidth: 1.55,
      /* Matches the taller padded canvas without changing on-screen scale. */
      fitHalfHeight: 1.86
    })
    const pair = []
    const silverCoinMaterial = createMenuCoinMaterial(0)
    silverCoinMaterial.color.setHSL(0.1, 0.015, 1)
    silverCoinMaterial.roughness = 0.66
    silverCoinMaterial.metalness = 0.42
    silverCoinMaterial.envMapIntensity = 0.26
    silverCoinMaterial.needsUpdate = true
    for (const side of [-1, 1]) {
      const holder = new THREE.Group()
      /* Seed zero is the neutral silver source quarter. Both halves receive
         the exact same material instance so their finish cannot diverge. */
      const coin = new THREE.Mesh(geometry, silverCoinMaterial)
      coin.rotation.x = Math.PI / 2
      coin.scale.setScalar(1.08)
      holder.add(coin)
      holder.position.x = side * 1.18
      holder.userData.faceOffset = side > 0 ? Math.PI : 0
      view.scene.add(holder)
      pair.push(holder)
    }
    view.update = elapsed => {
      const motionTime = reducedMotion ? 0 : elapsed
      const sharedSpin = motionTime * 0.92
      const sharedTilt = Math.sin(motionTime * 0.78) * 0.035
      const sharedLift = Math.sin(motionTime * 1.18) * 0.04
      for (const holder of pair) {
        /* Keep the coins upright while turning them. Their lower edge now
           stays inside the preview instead of dipping through its bottom. */
        holder.rotation.y = sharedSpin + holder.userData.faceOffset
        holder.rotation.z = sharedTilt
        holder.position.y = 0.12 + sharedLift
      }
    }
  }

  /* Interference is intentionally only the in-module buoy: no water mesh,
     ripple shader, horizon or card. Its motion implies the missing wave. */
  {
    const view = createCardView('interference', {
      fitHalfWidth: 0.72,
      fitHalfHeight: 1.12
    })
    const buoy = cloneBuoy({
      THREE,
      template: buoyAssets.template,
      identity: 'menu'
    })
    buoy.root.scale.multiplyScalar(1.9)
    buoy.root.position.y = INTERFERENCE_PREVIEW_BUOY_Y
    buoy.setFlagYaw(BUOY_SCREEN_EAST_YAW)
    buoy.setFlagHeight(1.18)
    buoy.setCue(0)
    buoy.parts.Qubit.material.color.set('#086acb')
    buoy.parts.Qubit.material.emissive.set('#063a7a')
    buoy.parts.Qubit.material.emissiveIntensity = 0.12
    buoy.parts.Qubit.material.envMapIntensity = 0.25
    buoy.parts.Qubit.material.roughness = 0.64
    buoy.parts.Qubit.material.clearcoatRoughness = 0.58
    buoy.parts.Frame.material.color.set('#e2e5e8')
    buoy.parts.Frame.material.envMapIntensity = 0.5
    buoy.parts.Frame.material.roughness = 0.42
    buoy.parts.Flagpole.material.color.set('#4f5257')
    buoy.parts.Flag.material.color.set('#e5a72d')
    view.scene.add(buoy.root)

    view.update = elapsed => {
      const motionTime = reducedMotion ? 0 : elapsed
      buoy.root.position.y = INTERFERENCE_PREVIEW_BUOY_Y +
        (Math.sin(motionTime * 1.28) * 0.11)
      buoy.root.rotation.x = INTERFERENCE_PREVIEW_PITCH +
        (Math.sin((motionTime * 1.04) + 0.7) * 0.04)
      buoy.root.rotation.y = INTERFERENCE_PREVIEW_YAW
      buoy.root.rotation.z = Math.sin(motionTime * 0.96) * 0.085
    }
    view.disposeCluster = () => buoy.dispose()
  }

  function resizeView(view) {
    const rect = view.host.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return false
    const { camera, renderer } = view
    const pixelRatio = calculateQvcPixelRatio({
      devicePixelRatio: window.devicePixelRatio,
      height: rect.height,
      width: rect.width
    })
    const viewport = {
      height: rect.height,
      pixelRatio,
      width: rect.width
    }
    if (!menuViewportChanged(view.viewport, viewport)) return false

    camera.aspect = rect.width / rect.height
    /* Back the camera off until the cluster fits both axes of its card. */
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const distance = Math.max(
      view.fitHalfHeight / tanHalfFov,
      view.fitHalfWidth / (tanHalfFov * camera.aspect),
      4.2
    )
    /* Slightly above eye level so the model volume reads clearly. */
    camera.position.set(0, 1, distance)
    camera.updateProjectionMatrix()
    camera.lookAt(0, -0.15, 0)
    /* One allocation and one clear for a real size/DPR change. setPixelRatio
       followed by setSize would resize the drawing buffer twice. */
    renderer.setDrawingBufferSize(rect.width, rect.height, pixelRatio)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    view.viewport = viewport
    return true
  }

  function resize() {
    let changed = false
    for (const view of views) changed = resizeView(view) || changed
    return changed
  }

  const clock = new THREE.Clock()
  let disposed = false
  let hasPresented = false
  let activeRequested = true
  let running = false
  let animationFrame = 0
  let previousElapsed = 0
  let previousSnapshotElapsed = -Infinity

  function snapshotView(view) {
    const source = view.renderer.domElement
    if (!view.posterContext || source.width < 1 || source.height < 1) return
    if (view.poster.width !== source.width) view.poster.width = source.width
    if (view.poster.height !== source.height) view.poster.height = source.height
    view.posterContext.clearRect(0, 0, source.width, source.height)
    view.posterContext.drawImage(source, 0, 0)
  }

  function renderFrame({ finish = false, snapshot = false } = {}) {
    const elapsed = clock.getElapsedTime()
    const delta = Math.max(0.001, elapsed - previousElapsed)
    const shouldSnapshot = snapshot || elapsed - previousSnapshotElapsed >= 0.5
    previousElapsed = elapsed
    for (const view of views) {
      view.update(elapsed, delta)
      view.renderer.render(view.scene, view.camera)
      if (finish) view.renderer.getContext().finish()
      if (shouldSnapshot) snapshotView(view)
    }
    if (shouldSnapshot) previousSnapshotElapsed = elapsed
  }

  async function restoreView(view, restorationToken) {
    try {
      view.rig.restoreEnvironment()
      view.viewport = null
      resizeView(view)
      view.update(clock.getElapsedTime(), 0.001)
      /* The render itself performs the only compile we need. A separate
         compile immediately beforehand leaves Three's temporary shader pair
         alive when this short-lived selector is disposed. */
      view.renderer.render(view.scene, view.camera)
      view.renderer.getContext().finish()
      snapshotView(view)
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      if (disposed || restorationToken !== view.contextRestorationToken) return
      view.host.classList.remove('is-context-lost')
    } catch (error) {
      /* Keep the stable poster visible if recovery cannot complete. */
      console.error(`Menu preview context restore failed: ${view.id}`, error)
    }
  }

  function animate() {
    if (disposed || !running) return
    animationFrame = requestAnimationFrame(animate)
    renderFrame()
  }

  function resizeAndRepaint() {
    if (!resize() || !hasPresented || disposed) return
    /* Resizing clears a WebGL drawing buffer. Repaint synchronously inside
       the same ResizeObserver delivery so a transparent frame cannot land. */
    renderFrame({ snapshot: true })
  }

  const resizeObserver = new ResizeObserver(resizeAndRepaint)
  for (const view of views) resizeObserver.observe(view.host)
  window.addEventListener('resize', resizeAndRepaint)

  resize()

  let readinessFrame = 0
  let settleReadinessFrame = null
  function waitForReadinessFrame() {
    return new Promise(resolve => {
      settleReadinessFrame = () => {
        readinessFrame = 0
        settleReadinessFrame = null
        resolve()
      }
      readinessFrame = requestAnimationFrame(settleReadinessFrame)
    })
  }

  const ready = (async () => {
    /* The first hidden render compiles exactly the variants it presents. Do
       not precompile: Three retains the precompile-only shader pair after the
       selector's materials are disposed. */
    renderFrame({ finish: true, snapshot: true })
    await waitForReadinessFrame()
    if (disposed) return

    /* The observer's mandatory first delivery has happened by now. Its
       unchanged dimensions are cached, so this second stable draw cannot be
       erased by a redundant canvas resize. Reveal all three atomically. */
    resize()
    renderFrame({ finish: true, snapshot: true })
    for (const view of views) view.renderer.domElement.classList.add('is-ready')
    hasPresented = true
    if (activeRequested) {
      running = true
      animationFrame = requestAnimationFrame(animate)
    }
  })()

  return {
    ready,
    setActive(active) {
      const shouldRun = Boolean(active)
      activeRequested = shouldRun
      if (disposed || !hasPresented || running === shouldRun) return
      running = shouldRun
      cancelAnimationFrame(animationFrame)
      animationFrame = 0
      if (!running) return
      resize()
      renderFrame({ finish: true, snapshot: true })
      animationFrame = requestAnimationFrame(animate)
    },
    dispose() {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(animationFrame)
      if (readinessFrame) {
        cancelAnimationFrame(readinessFrame)
        settleReadinessFrame?.()
      }
      resizeObserver.disconnect()
      window.removeEventListener('resize', resizeAndRepaint)
      for (const view of views) {
        view.contextRestorationToken += 1
        view.renderer.domElement.removeEventListener('webglcontextlost', view.onContextLost)
        view.renderer.domElement.removeEventListener('webglcontextrestored', view.onContextRestored)
        view.disposeCluster?.()
        view.rig.dispose()
        view.poster.remove()
      }
      for (const material of coinMaterials) material.dispose()
      coinMaterials.clear()
      for (const view of views) {
        view.scene.clear()
        view.rendererLease.release()
      }
    }
  }
}
