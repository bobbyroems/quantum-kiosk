import { assetUrl } from '../../core/asset-url.js'
import { disposeObject3DResources } from '../../core/three-resource-disposal.js'
import { leaseWebGLRenderer } from '../../core/webgl-renderer-pool.js'
import { ensureRectAreaLightUniformsInitialized } from '../../core/rect-area-light-uniforms.js'
import {
  getModuleNavigationGridLayout,
  MODULE_NAVIGATION_GRID,
  MODULE_NAVIGATION_PROJECTION
} from '../../core/module-navigation-projection.js'
import { MeshoptDecoder } from '../protecting-information/meshopt-decoder.js'
import { registerLightRig } from '../../core/light-rig-registry.js'
import { dampAngle, shortestAngleDelta } from './component-inspection.js'
import { createMajoranaStudioEnvironment } from './majorana-environment.js'
import { hideDuplicateMajoranaChassis } from './majorana-model-cleanup.js'
import {
  getMajoranaIntroLightLayout,
  MAJORANA_INTRO_LIGHTING
} from './majorana-intro-lighting.js'
import {
  applyMajoranaClearcoat,
  applyMajoranaReferencePalette,
  configureMajoranaTextureSampling,
  tuneMajoranaGoldMaterials
} from './majorana-palette.js'
import {
  calculateCssScale,
  calculateDrawingBufferSize,
  calculateStageAwarePixelRatio,
  MAJORANA_NAVIGATION_SWAY,
  MAJORANA_NAVIGATION_DISTANCE_SCALE,
  MAJORANA_NAVIGATION_TARGET_OFFSET_RATIO,
  stepMajoranaNavigationSway,
  shouldAnimateNavigationPreview,
  shouldContinueRendering
} from './majorana-render-utils.js'

const MAX_RENDER_PIXELS = 10_000_000
const INTRO_FOCAL_LENGTH_MM = 80
const THREE_DEFAULT_FILM_GAUGE_MM = 35
// The portrait kiosk uses the full 35 mm film height, so an 80 mm product lens
// maps to a vertical FOV of about 24.68° in Three.js.
const INTRO_FOV = (2 * Math.atan(
  THREE_DEFAULT_FILM_GAUGE_MM / (2 * INTRO_FOCAL_LENGTH_MM)
)) * (180 / Math.PI)
const INTRO_INTERACTION_FRAME_PADDING = 1.06
const COMPONENTS_FOV = 24
const COMPONENT_DETAIL_FOV = 32
const COMPONENT_DETAIL_FRAME_PADDING = 1.18
const COMPONENT_DETAIL_DEPTH_PADDING = 1.04
const SCHEMATIC_COMPONENT_CAMERA_DISTANCE_SCALE = 0.86
const COMPONENTS_TRANSITION_MS = 1_800
const INTRO_FLOAT_ENTRY_DELAY_MS = 500
const COMPONENT_DETAIL_ENVIRONMENT_INTENSITY = Object.freeze({
  'qpu-stack': 0.42,
  'cryo-cmos': 0.32
})
const COMPONENT_FOCUS_ENVIRONMENT_INTENSITY = Object.freeze({
  'qpu-stack': 0.48,
  'cryo-cmos': 0.4
})
const COMPONENT_FOCUS_TONE_MAPPING_EXPOSURE = Object.freeze({
  'qpu-stack': 0.88,
  'cryo-cmos': 0.87
})
const COMPONENT_BUILD_ENVIRONMENT_INTENSITY = Object.freeze({
  'qpu-stack': 0.46,
  'cryo-cmos': 0.52
})
const COMPONENT_BUILD_TONE_MAPPING_EXPOSURE = Object.freeze({
  'qpu-stack': 0.96,
  'cryo-cmos': 1.05
})
const COMPONENT_BUILD_FILL_INTENSITY = Object.freeze({
  'qpu-stack': 0.18,
  'cryo-cmos': 0.28
})
// Calibrated against the shared outer chassis bounds in the GLB and schematic.
// Both views retain the same small inset so every rounded edge remains visible.
const COMPONENTS_FRAME_PADDING = 1.0301
const COMPONENTS_VERTICAL_OFFSET_RATIO = 0
const INTRO_DISTANCE_SCALE = 1.28
// Keep the approved product pose fixed. Material and studio-light matching
// must not alter this camera direction or the model's resting composition.
const INTRO_CAMERA_DIRECTION = Object.freeze({ x: -0.64, y: 0.08, z: 1.6 })
const NAVIGATION_MAX_PITCH = 0.75
const NAVIGATION_MIN_PITCH = -0.55
let majoranaSceneSequence = 0

const PART_NODE_NAMES = Object.freeze({
  'qpu-stack': Object.freeze([
    'QPU_Chip_RT_LowPoly_Export',
    'Ceramic_Isolator_RT_LowPoly_Export',
    'Silicon_Interposer_RT_LowPoly_Export'
  ]),
  'cryo-cmos': Object.freeze([
    'MJN2_CMOS_Demo_Chip_RT_LowPoly_Export',
    'MJN2_CMOS_Demo_PCB_RT_LowPoly_Export',
    'MJN2_CMOS_Demo_Heatsink_RT_LowPoly_Export'
  ])
})

function abortError() {
  return new DOMException('Majorana scene loading was aborted.', 'AbortError')
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError()
}

function disposeObject(root) {
  disposeObject3DResources(root)
}

function loadGltf(loader, url, onProgress) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      resolve,
      event => {
        const progress = event.total > 0 ? event.loaded / event.total : null
        onProgress?.(progress, event.loaded)
      },
      reject
    )
  })
}

function gatherPartNodes(modelRoot) {
  const nodesByNormalizedName = new Map()
  modelRoot.traverse(node => {
    const normalizedName = node.name.trim().toLowerCase()
    if (!nodesByNormalizedName.has(normalizedName)) nodesByNormalizedName.set(normalizedName, [])
    nodesByNormalizedName.get(normalizedName).push(node)
  })

  return Object.fromEntries(
    Object.entries(PART_NODE_NAMES).map(([partId, names]) => {
      const matches = names.flatMap(name => nodesByNormalizedName.get(name.toLowerCase()) || [])
      const rootsOnly = matches.filter(node => {
        let ancestor = node.parent
        while (ancestor) {
          if (matches.includes(ancestor)) return false
          ancestor = ancestor.parent
        }
        return true
      })
      return [partId, rootsOnly]
    })
  )
}

function smoothStep(progress) {
  return progress * progress * (3 - (2 * progress))
}

function elementCssScale(element) {
  const scaleReference = element.closest?.('#kiosk-stage') || element
  const bounds = scaleReference.getBoundingClientRect()
  return calculateCssScale({
    layoutWidth: scaleReference.offsetWidth || scaleReference.clientWidth,
    layoutHeight: scaleReference.offsetHeight || scaleReference.clientHeight,
    renderedWidth: bounds.width,
    renderedHeight: bounds.height
  })
}

function calculatePixelRatio(element, width, height) {
  return calculateStageAwarePixelRatio({
    width,
    height,
    cssScale: elementCssScale(element),
    devicePixelRatio: window.devicePixelRatio || 1,
    maxRenderPixels: MAX_RENDER_PIXELS
  })
}

function resizeDrawingBuffer(renderer, sizeCache, width, height, pixelRatio) {
  const nextSize = calculateDrawingBufferSize(width, height, pixelRatio)
  if (sizeCache.width === nextSize.width && sizeCache.height === nextSize.height) return false

  renderer.setDrawingBufferSize(width, height, pixelRatio)
  sizeCache.width = nextSize.width
  sizeCache.height = nextSize.height
  return true
}

export async function createMajoranaScene({
  host: initialHost,
  componentHosts: initialComponentHosts = {},
  schematicComponentHosts: initialSchematicComponentHosts = {},
  pathwaysComponentHosts: initialPathwaysComponentHosts = {},
  buildComponentHosts: initialBuildComponentHosts = {},
  signal,
  onActivity,
  onProgress,
  onReady,
  onComponentsReady,
  navigationPreview = false
}) {
  throwIfAborted(signal)
  if (!(initialHost instanceof HTMLElement)) {
    throw new TypeError('A Majorana scene host is required.')
  }

  const [
    THREE,
    { GLTFLoader },
    { OrbitControls },
    { RectAreaLightUniformsLib },
    { HorizontalBlurShader },
    { VerticalBlurShader }
  ] = await Promise.all([
    import('three'),
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/controls/OrbitControls.js'),
    import('three/addons/lights/RectAreaLightUniformsLib.js'),
    import('three/addons/shaders/HorizontalBlurShader.js'),
    import('three/addons/shaders/VerticalBlurShader.js')
  ])

  throwIfAborted(signal)
  ensureRectAreaLightUniformsInitialized(RectAreaLightUniformsLib)

  let host = initialHost
  let componentHosts = { ...initialComponentHosts }
  let schematicComponentHosts = { ...initialSchematicComponentHosts }
  let pathwaysComponentHosts = { ...initialPathwaysComponentHosts }
  let buildComponentHosts = { ...initialBuildComponentHosts }
  let disposed = false
  let animationFrame = 0
  let lastFrameTime = performance.now()
  let mainDirty = true
  let mainTransformsAreMoving = false
  let mainIsReturning = false
  let modelRoot = null
  let navigationGrid = null
  let navigationShadow = null
  let environmentRenderTarget = null
  let modelDiameter = 1
  let view = 'intro'
  let buildPlacements = { 'qpu-stack': false, 'cryo-cmos': false }
  let transformRecords = []
  let controlsAreActive = false
  let navigationDrag = null
  let navigationUserYaw = 0
  let navigationUserPitch = 0
  let navigationYawVelocity = 0
  let navigationMotionEnabled = false
  let navigationCardWasActive = false
  let navigationPivotReady = false
  let navigationPivotIsReturning = false
  let returnToRestAt = Number.POSITIVE_INFINITY
  let introPoseReady = false
  let introBaseCameraDistance = 1
  let introFloatStartsAt = 0
  let floatWeight = 0
  let cameraTransition = null
  let resolveCameraTransition = null
  let componentViewsActive = false
  let loadedPartNodes = null
  let partsFound = {}
  let portalViewportSession = null
  let suspended = false
  let isNavigationPreview = Boolean(navigationPreview)
  const mainRendererSize = { width: 0, height: 0 }
  const componentViews = new Map()
  const loadingManager = new THREE.LoadingManager()
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const navigationSway = { offset: 0, velocity: 0, previousCenterX: undefined }

  function requestRender() {
    if (disposed || suspended || document.hidden || animationFrame) return
    lastFrameTime = performance.now()
    animationFrame = window.requestAnimationFrame(render)
  }

  function invalidateMain() {
    mainDirty = true
    requestRender()
  }

  const scene = new THREE.Scene()
  scene.environmentIntensity = MAJORANA_INTRO_LIGHTING.environmentIntensity
  scene.environmentRotation.x = THREE.MathUtils.degToRad(
    MAJORANA_INTRO_LIGHTING.environmentRotationXDegrees
  )
  scene.environmentRotation.y = THREE.MathUtils.degToRad(
    MAJORANA_INTRO_LIGHTING.environmentRotationYDegrees
  )
  const navigationGridScene = new THREE.Scene()
  const navigationGridCamera = new THREE.PerspectiveCamera(
    MODULE_NAVIGATION_PROJECTION.fovDegrees,
    1,
    MODULE_NAVIGATION_PROJECTION.near,
    MODULE_NAVIGATION_PROJECTION.far
  )
  navigationGridCamera.position.set(
    0,
    MODULE_NAVIGATION_PROJECTION.height,
    MODULE_NAVIGATION_PROJECTION.distance
  )
  navigationGridCamera.lookAt(0, MODULE_NAVIGATION_PROJECTION.lookAtY, 0)
  const motionRoot = new THREE.Group()
  const navigationPivot = new THREE.Group()
  const presentationRoot = new THREE.Group()
  motionRoot.add(navigationPivot)
  navigationPivot.add(presentationRoot)
  scene.add(motionRoot)
  const identityQuaternion = new THREE.Quaternion()
  const introCameraPosition = new THREE.Vector3()
  const introControlsTarget = new THREE.Vector3()
  const introCameraUp = new THREE.Vector3(0, 1, 0)
  const componentsCameraPosition = new THREE.Vector3()
  const componentsControlsTarget = new THREE.Vector3()
  const worldCameraUp = new THREE.Vector3(0, 1, 0)
  const transitionTarget = new THREE.Vector3()
  const transitionDirection = new THREE.Vector3()
  const returnCurrentOffset = new THREE.Vector3()
  const returnTargetOffset = new THREE.Vector3()
  const returnCurrentDirection = new THREE.Vector3()
  const returnTargetDirection = new THREE.Vector3()
  const returnRotation = new THREE.Quaternion()
  const returnStepRotation = new THREE.Quaternion()
  const introFrameOffsets = []
  const introFrameForward = new THREE.Vector3()
  const introFrameRight = new THREE.Vector3()
  const introFrameUp = new THREE.Vector3()
  const introFrameCameraOffset = new THREE.Vector3()

  const camera = new THREE.PerspectiveCamera(INTRO_FOV, 1, 0.01, 10_000)
  scene.add(camera)
  const rendererLease = leaseWebGLRenderer(THREE, {
    alpha: true,
    antialias: true,
    depth: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false
  })
  const { renderer } = rendererLease
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = MAJORANA_INTRO_LIGHTING.exposure
  renderer.shadowMap.enabled = false
  renderer.setClearColor(0xffffff, 0)
  renderer.domElement.className = 'majorana-model-stage__canvas'

  const majoranaLook = {
    environmentTiltDegrees: MAJORANA_INTRO_LIGHTING.environmentRotationXDegrees,
    environmentRotationDegrees: MAJORANA_INTRO_LIGHTING.environmentRotationYDegrees,
    environmentIntensity: MAJORANA_INTRO_LIGHTING.environmentIntensity,
    exposure: MAJORANA_INTRO_LIGHTING.exposure,
    goldReflection: 1,
    clearcoat: 1,
    coatBlur: 1
  }

  function applyMajoranaLook(next = {}) {
    for (const [key, value] of Object.entries(next)) {
      if (key in majoranaLook && Number.isFinite(value)) majoranaLook[key] = value
    }
    scene.environmentRotation.x = THREE.MathUtils.degToRad(
      majoranaLook.environmentTiltDegrees
    )
    scene.environmentRotation.y = THREE.MathUtils.degToRad(
      majoranaLook.environmentRotationDegrees
    )
    scene.environmentIntensity = majoranaLook.environmentIntensity
    renderer.toneMappingExposure = majoranaLook.exposure
    tuneMajoranaGoldMaterials(modelRoot, {
      reflectionScale: majoranaLook.goldReflection,
      clearcoatScale: majoranaLook.clearcoat,
      coatBlurScale: majoranaLook.coatBlur
    })
    componentViews.forEach(componentView => componentView.markDirty())
  }

  const majoranaLookControls = [
    {
      type: 'range',
      label: 'env rotation',
      min: 0,
      max: 360,
      step: 1,
      getValue: () => majoranaLook.environmentRotationDegrees,
      setValue: value => applyMajoranaLook({ environmentRotationDegrees: value })
    },
    {
      type: 'range',
      label: 'env tilt',
      min: -180,
      max: 180,
      step: 1,
      getValue: () => majoranaLook.environmentTiltDegrees,
      setValue: value => applyMajoranaLook({ environmentTiltDegrees: value })
    },
    {
      type: 'range',
      label: 'environment',
      min: 0,
      max: 1.5,
      step: 0.01,
      getValue: () => majoranaLook.environmentIntensity,
      setValue: value => applyMajoranaLook({ environmentIntensity: value })
    },
    {
      type: 'range',
      label: 'exposure',
      min: 0.4,
      max: 1.8,
      step: 0.01,
      getValue: () => majoranaLook.exposure,
      setValue: value => applyMajoranaLook({ exposure: value })
    },
    {
      type: 'range',
      label: 'gold reflection',
      min: 0,
      max: 2,
      step: 0.01,
      getValue: () => majoranaLook.goldReflection,
      setValue: value => applyMajoranaLook({ goldReflection: value })
    },
    {
      type: 'range',
      label: 'clearcoat',
      min: 0,
      max: 1,
      step: 0.01,
      getValue: () => majoranaLook.clearcoat,
      setValue: value => applyMajoranaLook({ clearcoat: value })
    },
    {
      type: 'range',
      label: 'coat blur',
      min: 0,
      max: 4,
      step: 0.01,
      getValue: () => majoranaLook.coatBlur,
      setValue: value => applyMajoranaLook({ coatBlur: value })
    }
  ]
  const renderNavigationContactShadow = () => {
    if (!navigationShadow) return
    const shadow = navigationShadow
    /* Five extra passes, as in the pool: silhouette from below, then a wide and
       a tight separable blur. Run before the grid pass so autoClear still holds. */
    scene.overrideMaterial = shadow.depthMaterial
    renderer.setRenderTarget(shadow.rt)
    renderer.render(scene, shadow.shadowCamera)
    scene.overrideMaterial = null
    for (const amount of [4.5, 1.8]) {
      shadow.blurPlane.visible = true
      shadow.blurPlane.material = shadow.horizontalBlur
      shadow.horizontalBlur.uniforms.tDiffuse.value = shadow.rt.texture
      shadow.horizontalBlur.uniforms.h.value = amount / 256
      renderer.setRenderTarget(shadow.rtBlur)
      renderer.render(shadow.blurPlane, shadow.shadowCamera)
      shadow.blurPlane.material = shadow.verticalBlur
      shadow.verticalBlur.uniforms.tDiffuse.value = shadow.rtBlur.texture
      shadow.verticalBlur.uniforms.v.value = amount / 256
      renderer.setRenderTarget(shadow.rt)
      renderer.render(shadow.blurPlane, shadow.shadowCamera)
      shadow.blurPlane.visible = false
    }
    renderer.setRenderTarget(null)
  }

  const renderMainScene = () => {
    if (!isNavigationPreview || !navigationGrid?.visible) {
      renderer.render(scene, camera)
      return
    }

    renderNavigationContactShadow()
    const previousAutoClear = renderer.autoClear
    const previousExposure = renderer.toneMappingExposure
    renderer.autoClear = false
    renderer.clear(true, true, true)
    renderer.toneMappingExposure = MODULE_NAVIGATION_GRID.exposure
    renderer.render(navigationGridScene, navigationGridCamera)
    renderer.clearDepth()
    renderer.toneMappingExposure = previousExposure
    renderer.render(scene, camera)
    renderer.autoClear = previousAutoClear
  }

  const sceneId = `majorana-scene-${++majoranaSceneSequence}`
  renderer.domElement.dataset.majoranaSceneId = sceneId
  renderer.domElement.setAttribute('aria-hidden', 'true')
  host.prepend(renderer.domElement)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = false
  controls.enablePan = false
  controls.enableZoom = false
  controls.rotateSpeed = 1.8
  controls.zoomSpeed = 0.65
  controls.autoRotate = false
  controls.enabled = !isNavigationPreview
  const handleControlsStart = () => {
    controlsAreActive = true
    returnToRestAt = Number.POSITIVE_INFINITY
    invalidateMain()
    onActivity?.()
  }
  const handleControlsEnd = () => {
    controlsAreActive = false
    returnToRestAt = performance.now() + 80
    invalidateMain()
  }
  const handleControlsChange = () => invalidateMain()
  const handleReducedMotionChange = () => {
    if (reducedMotion.matches) {
      floatWeight = 0
      motionRoot.position.set(0, 0, 0)
      motionRoot.rotation.set(0, 0, 0)
      navigationSway.offset = 0
      navigationSway.velocity = 0
      navigationSway.previousCenterX = undefined
      navigationUserYaw = 0
      navigationUserPitch = 0
      navigationYawVelocity = 0
      if (isNavigationPreview) navigationPivot.rotation.set(0, 0, 0)
    }
    configureControls()
    invalidateMain()
  }
  controls.addEventListener('start', handleControlsStart)
  controls.addEventListener('end', handleControlsEnd)
  controls.addEventListener('change', handleControlsChange)
  reducedMotion.addEventListener('change', handleReducedMotionChange)

  // Match the shared navigation dioramas: the camera and grid stay fixed while
  // the object itself rotates. Pointer capture keeps the same gesture from
  // becoming a swipe on the surrounding module carousel.
  const handleNavigationPointerDown = event => {
    if (!isNavigationPreview || event.button !== 0) return
    event.stopPropagation()
    onActivity?.()
    controlsAreActive = true
    navigationYawVelocity = 0
    navigationDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startYaw: navigationUserYaw,
      startPitch: navigationUserPitch,
      lastX: event.clientX,
      lastAt: performance.now(),
      velocity: 0
    }
    try {
      renderer.domElement.setPointerCapture?.(event.pointerId)
    } catch {
      // Synthetic pointers and older kiosk engines may not support capture.
    }
    invalidateMain()
  }

  const handleNavigationPointerMove = event => {
    if (!isNavigationPreview || navigationDrag?.pointerId !== event.pointerId) return
    event.stopPropagation()
    const dragFactor = 5 / Math.max(200, renderer.domElement.getBoundingClientRect().width)
    const now = performance.now()
    const elapsed = Math.max(1, now - navigationDrag.lastAt)
    navigationDrag.velocity = ((event.clientX - navigationDrag.lastX) * dragFactor * 1000) /
      elapsed
    navigationDrag.lastX = event.clientX
    navigationDrag.lastAt = now
    navigationUserYaw = navigationDrag.startYaw +
      (event.clientX - navigationDrag.startX) * dragFactor
    navigationUserPitch = THREE.MathUtils.clamp(
      navigationDrag.startPitch +
        (event.clientY - navigationDrag.startY) * dragFactor * 0.7,
      NAVIGATION_MIN_PITCH,
      NAVIGATION_MAX_PITCH
    )
    invalidateMain()
  }

  const finishNavigationPointer = event => {
    if (!isNavigationPreview || navigationDrag?.pointerId !== event.pointerId) return
    event.stopPropagation()
    navigationYawVelocity = THREE.MathUtils.clamp(navigationDrag.velocity, -9, 9)
    navigationDrag = null
    controlsAreActive = false
    if (renderer.domElement.hasPointerCapture?.(event.pointerId)) {
      renderer.domElement.releasePointerCapture(event.pointerId)
    }
    invalidateMain()
  }

  const cancelNavigationPointer = event => {
    if (!isNavigationPreview || navigationDrag?.pointerId !== event.pointerId) return
    event.stopPropagation()
    navigationDrag = null
    navigationYawVelocity = 0
    controlsAreActive = false
    if (renderer.domElement.hasPointerCapture?.(event.pointerId)) {
      renderer.domElement.releasePointerCapture(event.pointerId)
    }
    invalidateMain()
  }

  renderer.domElement.addEventListener('pointerdown', handleNavigationPointerDown)
  renderer.domElement.addEventListener('pointermove', handleNavigationPointerMove)
  renderer.domElement.addEventListener('pointerup', finishNavigationPointer)
  renderer.domElement.addEventListener('pointercancel', cancelNavigationPointer)

  const initialMainLightLayout = getMajoranaIntroLightLayout({
    viewDirection: [
      INTRO_CAMERA_DIRECTION.x,
      INTRO_CAMERA_DIRECTION.y,
      INTRO_CAMERA_DIRECTION.z
    ]
  })
  const mainLights = new Map(initialMainLightLayout.map(lightConfig => {
    const light = new THREE.RectAreaLight(
      lightConfig.color,
      lightConfig.intensity,
      lightConfig.width,
      lightConfig.height
    )
    light.position.fromArray(lightConfig.position)
    light.lookAt(...lightConfig.target)
    light.rotateZ(THREE.MathUtils.degToRad(lightConfig.rollDegrees ?? 0))
    scene.add(light)
    return [lightConfig.name, light]
  }))

  /* Temporary authoring controls use a camera-relative spherical frame. It is
     much easier to orbit a light around the chip with azimuth/elevation and a
     distance than to guess three unrelated world coordinates. Unlike the old
     raw XYZ sliders, every edit also re-aims the RectAreaLight at its retained
     target, so highlights move predictably. */
  const mainLightFrame = {
    center: new THREE.Vector3(),
    front: new THREE.Vector3(0, 0, 1),
    right: new THREE.Vector3(1, 0, 0),
    modelWidth: 1,
    modelHeight: 1
  }
  const mainLightTuning = new Map()
  const mainLightPosition = new THREE.Vector3()
  const mainLightTarget = new THREE.Vector3()

  function setMainLightFrame(center, size, viewDirection) {
    mainLightFrame.center.copy(center)
    mainLightFrame.modelWidth = Math.max(size.x, 0.001)
    mainLightFrame.modelHeight = Math.max(size.y, 0.001)
    mainLightFrame.front.set(viewDirection.x, 0, viewDirection.z)
    if (mainLightFrame.front.lengthSq() <= Number.EPSILON) {
      mainLightFrame.front.set(0, 0, 1)
    } else {
      mainLightFrame.front.normalize()
    }
    mainLightFrame.right
      .set(mainLightFrame.front.z, 0, -mainLightFrame.front.x)
      .normalize()
  }

  function readMainLightTuning(lightConfig) {
    const position = new THREE.Vector3().fromArray(lightConfig.position)
    const target = new THREE.Vector3().fromArray(lightConfig.target)
    const offset = position.sub(mainLightFrame.center)
    const targetOffset = target.sub(mainLightFrame.center)
    const distance = Math.max(offset.length(), 0.001)
    const horizontalFront = offset.dot(mainLightFrame.front)
    const horizontalRight = offset.dot(mainLightFrame.right)
    return {
      azimuthDegrees: THREE.MathUtils.radToDeg(
        Math.atan2(horizontalRight, horizontalFront)
      ),
      elevationDegrees: THREE.MathUtils.radToDeg(
        Math.asin(THREE.MathUtils.clamp(offset.y / distance, -1, 1))
      ),
      distanceByModelHeight: distance / mainLightFrame.modelHeight,
      targetRightByModelWidth:
        targetOffset.dot(mainLightFrame.right) / mainLightFrame.modelWidth,
      targetUpByModelHeight: targetOffset.y / mainLightFrame.modelHeight,
      targetFrontByModelHeight:
        targetOffset.dot(mainLightFrame.front) / mainLightFrame.modelHeight,
      widthByModelWidth: lightConfig.width / mainLightFrame.modelWidth,
      heightByModelHeight: lightConfig.height / mainLightFrame.modelHeight,
      rollDegrees: lightConfig.rollDegrees ?? 0
    }
  }

  function composeMainLightTarget(tuning, target = mainLightTarget) {
    return target
      .copy(mainLightFrame.center)
      .addScaledVector(
        mainLightFrame.right,
        tuning.targetRightByModelWidth * mainLightFrame.modelWidth
      )
      .addScaledVector(
        mainLightFrame.front,
        tuning.targetFrontByModelHeight * mainLightFrame.modelHeight
      )
      .setY(
        mainLightFrame.center.y +
        (tuning.targetUpByModelHeight * mainLightFrame.modelHeight)
      )
  }

  function applyMainLightTuning(name) {
    const light = mainLights.get(name)
    const tuning = mainLightTuning.get(name)
    if (!light || !tuning) return
    const azimuth = THREE.MathUtils.degToRad(tuning.azimuthDegrees)
    const elevation = THREE.MathUtils.degToRad(tuning.elevationDegrees)
    const distance = tuning.distanceByModelHeight * mainLightFrame.modelHeight
    const horizontalDistance = Math.cos(elevation) * distance

    mainLightPosition
      .copy(mainLightFrame.center)
      .addScaledVector(mainLightFrame.front, Math.cos(azimuth) * horizontalDistance)
      .addScaledVector(mainLightFrame.right, Math.sin(azimuth) * horizontalDistance)
    mainLightPosition.y += Math.sin(elevation) * distance
    light.position.copy(mainLightPosition)
    light.width = tuning.widthByModelWidth * mainLightFrame.modelWidth
    light.height = tuning.heightByModelHeight * mainLightFrame.modelHeight
    light.lookAt(composeMainLightTarget(tuning))
    light.rotateZ(THREE.MathUtils.degToRad(tuning.rollDegrees))
    invalidateMain()
  }

  function updateMainLightTuning(name, key, value) {
    const tuning = mainLightTuning.get(name)
    if (!tuning || !(key in tuning) || !Number.isFinite(value)) return
    tuning[key] = value
    applyMainLightTuning(name)
  }

  function configureMainLightRig(center, size, viewDirection) {
    setMainLightFrame(center, size, viewDirection)
    const layout = getMajoranaIntroLightLayout({
      center: center.toArray(),
      modelWidth: size.x,
      modelHeight: size.y,
      viewDirection: viewDirection.toArray()
    })

    layout.forEach(lightConfig => {
      const light = mainLights.get(lightConfig.name)
      if (!light) return
      light.color.set(lightConfig.color)
      light.intensity = lightConfig.intensity
      light.width = lightConfig.width
      light.height = lightConfig.height
      light.position.fromArray(lightConfig.position)
      light.lookAt(...lightConfig.target)
      light.rotateZ(THREE.MathUtils.degToRad(lightConfig.rollDegrees ?? 0))
      mainLightTuning.set(lightConfig.name, readMainLightTuning(lightConfig))
    })
  }

  setMainLightFrame(
    new THREE.Vector3(),
    new THREE.Vector3(1, 1, 1),
    new THREE.Vector3(
      INTRO_CAMERA_DIRECTION.x,
      INTRO_CAMERA_DIRECTION.y,
      INTRO_CAMERA_DIRECTION.z
    )
  )
  initialMainLightLayout.forEach(lightConfig => {
    mainLightTuning.set(lightConfig.name, readMainLightTuning(lightConfig))
  })

  const lightRangeControl = (name, label, key, min, max, step) => ({
    type: 'range',
    label,
    min,
    max,
    step,
    getValue: () => mainLightTuning.get(name)?.[key] ?? 0,
    setValue: value => updateMainLightTuning(name, key, value)
  })

  function serializeMajoranaTuning() {
    const round = value => Number(value.toFixed(3))
    const lights = {}
    mainLights.forEach((light, name) => {
      const tuning = mainLightTuning.get(name)
      if (!tuning) return
      const target = composeMainLightTarget(tuning, new THREE.Vector3())
      lights[name] = {
        color: `#${light.color.getHexString()}`,
        intensity: round(light.intensity),
        azimuthDegrees: round(tuning.azimuthDegrees),
        elevationDegrees: round(tuning.elevationDegrees),
        distanceByModelHeight: round(tuning.distanceByModelHeight),
        targetRightByModelWidth: round(tuning.targetRightByModelWidth),
        targetUpByModelHeight: round(tuning.targetUpByModelHeight),
        targetFrontByModelHeight: round(tuning.targetFrontByModelHeight),
        widthByModelWidth: round(tuning.widthByModelWidth),
        heightByModelHeight: round(tuning.heightByModelHeight),
        rollDegrees: round(tuning.rollDegrees),
        worldPosition: light.position.toArray().map(round),
        worldTarget: target.toArray().map(round)
      }
    })
    return JSON.stringify({
      environment: {
        rotationDegrees: round(majoranaLook.environmentRotationDegrees),
        tiltDegrees: round(majoranaLook.environmentTiltDegrees),
        intensity: round(majoranaLook.environmentIntensity),
        exposure: round(majoranaLook.exposure),
        goldReflection: round(majoranaLook.goldReflection),
        clearcoat: round(majoranaLook.clearcoat),
        coatBlur: round(majoranaLook.coatBlur)
      },
      lights
    }, null, 2)
  }

  majoranaLookControls.push(
    {
      type: 'copy',
      label: 'Copy full preset',
      getText: serializeMajoranaTuning
    },
    {
      type: 'note',
      text: 'Azimuth 0° is in front of the chip; +90° moves to screen-right. ' +
        'Distance and card size are relative to the model, so the values stay portable.'
    }
  )
  for (const [name, light] of mainLights) {
    majoranaLookControls.push(
      { type: 'group', label: `${name} light`, open: name === 'key' },
      {
        type: 'range',
        label: 'intensity',
        min: 0,
        max: 12,
        step: 0.05,
        getValue: () => light.intensity,
        setValue: value => { light.intensity = value }
      },
      {
        type: 'color',
        label: 'color',
        getValue: () => `#${light.color.getHexString()}`,
        setValue: value => { light.color.set(value) }
      },
      lightRangeControl(name, 'azimuth °', 'azimuthDegrees', -180, 180, 1),
      lightRangeControl(name, 'elevation °', 'elevationDegrees', -89, 89, 1),
      lightRangeControl(name, 'distance ×H', 'distanceByModelHeight', 0.1, 12, 0.01),
      lightRangeControl(name, 'aim right ×W', 'targetRightByModelWidth', -3, 3, 0.01),
      lightRangeControl(name, 'aim up ×H', 'targetUpByModelHeight', -3, 3, 0.01),
      lightRangeControl(name, 'aim depth ×H', 'targetFrontByModelHeight', -3, 3, 0.01),
      lightRangeControl(name, 'card width ×W', 'widthByModelWidth', 0.05, 6, 0.01),
      lightRangeControl(name, 'card height ×H', 'heightByModelHeight', 0.05, 6, 0.01),
      lightRangeControl(name, 'roll °', 'rollDegrees', -180, 180, 1)
    )
  }

  const unregisterLights = registerLightRig(
    sceneId,
    [...mainLights].map(([name, light]) => ({ name, light })),
    invalidateMain,
    {
      label: isNavigationPreview ? sceneId : 'Majorana look — camera locked',
      controls: isNavigationPreview ? [] : majoranaLookControls,
      showDefaultLightControls: isNavigationPreview
    }
  )

  function createComponentView(
    partId,
    nodes,
    componentHost,
    schematicComponentHost,
    pathwaysComponentHost,
    buildComponentHost
  ) {
    if (!(componentHost instanceof HTMLElement) || !nodes.length) return null

    const detailScene = new THREE.Scene()
    detailScene.environmentIntensity =
      COMPONENT_FOCUS_ENVIRONMENT_INTENSITY[partId] ?? 0.4
    const detailCamera = new THREE.PerspectiveCamera(COMPONENT_DETAIL_FOV, 1, 0.01, 10_000)
    detailScene.add(detailCamera)
    const detailRendererLease = leaseWebGLRenderer(THREE, {
      alpha: true,
      antialias: true,
      depth: true,
      powerPreference: 'high-performance'
    })
    const { renderer: detailRenderer } = detailRendererLease
    detailRenderer.outputColorSpace = THREE.SRGBColorSpace
    detailRenderer.toneMapping = THREE.ACESFilmicToneMapping
    detailRenderer.toneMappingExposure =
      COMPONENT_FOCUS_TONE_MAPPING_EXPOSURE[partId] ?? 0.87
    detailRenderer.setClearColor(0xffffff, 0)
    detailRenderer.domElement.className =
      'majorana-part-model__canvas majorana-focus-component__canvas'
    detailRenderer.domElement.style.filter = 'contrast(1.035) saturate(0.96)'
    detailRenderer.domElement.setAttribute('aria-hidden', 'true')
    detailRenderer.domElement.dataset.majoranaPose = 'components'
    detailRenderer.domElement.dataset.majoranaPresentation = 'components'
    detailRenderer.domElement.dataset.majoranaAppearance = 'components'
    componentHost.append(detailRenderer.domElement)

    const detailHemi = new THREE.HemisphereLight(0xfff8ed, 0x344052, 0.76)
    detailScene.add(detailHemi)
    const detailKey = new THREE.RectAreaLight(0xffe4c5, 2.9, 5, 4)
    detailKey.position.set(4, 7, 5)
    detailKey.lookAt(0, 0, 0)
    detailScene.add(detailKey)
    const detailRim = new THREE.RectAreaLight(0xa4b9d6, 0.86, 4, 6)
    detailRim.position.set(-5, 2, -4)
    detailRim.lookAt(0, 0, 0)
    detailScene.add(detailRim)
    const detailFill = new THREE.DirectionalLight(0xfff7e8, 0.22)
    detailFill.position.set(0, 0.5, 6)
    detailScene.add(detailFill)
    const detailViewFill = new THREE.RectAreaLight(0xfff4e3, 0.78, 1.8, 1.8)
    detailViewFill.position.set(0, 0, 1)
    detailCamera.add(detailViewFill)
    const unregisterDetailLights = registerLightRig(
      `${sceneId} ${partId}`,
      [
        { name: 'hemi', light: detailHemi },
        { name: 'key', light: detailKey },
        { name: 'rim', light: detailRim },
        { name: 'fill', light: detailFill },
        { name: 'view fill', light: detailViewFill }
      ],
      () => {
        dirty = true
        requestRender()
      }
    )

    const motionGroup = new THREE.Group()
    const contentGroup = new THREE.Group()
    let detailEnvironmentRenderTarget = null
    motionGroup.add(contentGroup)
    detailScene.add(motionGroup)

    presentationRoot.updateMatrixWorld(true)
    const toPresentationSpace = presentationRoot.matrixWorld.clone().invert()
    nodes.forEach(node => {
      const clone = node.clone(true)
      const presentationMatrix = toPresentationSpace.clone().multiply(node.matrixWorld)
      presentationMatrix.decompose(clone.position, clone.quaternion, clone.scale)
      contentGroup.add(clone)
    })

    const bounds = new THREE.Box3().setFromObject(contentGroup)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const diameter = Math.max(size.length(), size.x, size.y, size.z, 0.001)
    const halfSize = size.clone().multiplyScalar(0.5)
    contentGroup.position.copy(center).multiplyScalar(-1)

    const componentBaseRotation = new THREE.Euler(0.025, 0, 0)
    const buildBaseRotation = new THREE.Euler(0, 0, 0)
    let presentationMode = 'components'
    let poseMode = 'components'
    let idleStartsAt = Number.POSITIVE_INFINITY
    let idleWeight = 0
    let activeHost = componentHost
    let dirty = true
    motionGroup.rotation.copy(componentBaseRotation)
    const interaction = {
      rotateX: 0,
      rotateY: 0,
      active: false,
      returning: false
    }
    const framingRotation = new THREE.Euler()
    const framingMatrix = new THREE.Matrix4()
    const verticalHalfFov = THREE.MathUtils.degToRad(COMPONENT_DETAIL_FOV * 0.5)
    let horizontalHalfFov = verticalHalfFov
    let staticCameraDistance = 1
    let staticCameraDistancePose = ''
    let staticCameraDistanceHalfFov = Number.NaN
    const detailRendererSize = { width: 0, height: 0 }

    function cameraDistanceForRotation(rotateX, rotateY, rotateZ) {
      framingRotation.set(rotateX, rotateY, rotateZ)
      framingMatrix.makeRotationFromEuler(framingRotation)
      const elements = framingMatrix.elements
      const horizontalExtent =
        Math.abs(elements[0]) * halfSize.x +
        Math.abs(elements[4]) * halfSize.y +
        Math.abs(elements[8]) * halfSize.z
      const verticalExtent =
        Math.abs(elements[1]) * halfSize.x +
        Math.abs(elements[5]) * halfSize.y +
        Math.abs(elements[9]) * halfSize.z
      const depthExtent =
        Math.abs(elements[2]) * halfSize.x +
        Math.abs(elements[6]) * halfSize.y +
        Math.abs(elements[10]) * halfSize.z
      const projectedDistance = Math.max(
        verticalExtent / Math.tan(verticalHalfFov),
        horizontalExtent / Math.tan(horizontalHalfFov)
      )

      return Math.max(
        projectedDistance * COMPONENT_DETAIL_FRAME_PADDING,
        depthExtent + projectedDistance * COMPONENT_DETAIL_DEPTH_PADDING
      )
    }

    function currentBaseRotation() {
      return poseMode === 'components' ? componentBaseRotation : buildBaseRotation
    }

    function cameraDistanceForPresentation(baseDistance) {
      return presentationMode === 'schematic'
        ? baseDistance * SCHEMATIC_COMPONENT_CAMERA_DISTANCE_SCALE
        : baseDistance
    }

    function applyPresentationLighting(appearanceMode = presentationMode) {
      const isComponentFocus = appearanceMode === 'components'
      const isBuild = appearanceMode === 'build'
      detailScene.environmentIntensity = isComponentFocus
        ? COMPONENT_FOCUS_ENVIRONMENT_INTENSITY[partId] ?? 0.4
        : isBuild
          ? COMPONENT_BUILD_ENVIRONMENT_INTENSITY[partId] ?? 0.48
          : COMPONENT_DETAIL_ENVIRONMENT_INTENSITY[partId] ?? 0.32
      detailRenderer.toneMappingExposure = isComponentFocus
        ? COMPONENT_FOCUS_TONE_MAPPING_EXPOSURE[partId] ?? 0.87
        : isBuild
          ? COMPONENT_BUILD_TONE_MAPPING_EXPOSURE[partId] ?? 1
          : partId === 'qpu-stack' ? 0.84 : 0.82
      detailFill.intensity = isComponentFocus
        ? 0.28
        : isBuild
          ? COMPONENT_BUILD_FILL_INTENSITY[partId] ?? 0.22
          : 0
      detailRenderer.domElement.dataset.majoranaAppearance = appearanceMode
    }

    function setAppearance(nextMode) {
      applyPresentationLighting(nextMode)
      dirty = true
      requestRender()
    }

    function updateStaticCameraDistance() {
      if (
        staticCameraDistancePose === poseMode &&
        staticCameraDistanceHalfFov === horizontalHalfFov
      ) return staticCameraDistance

      const baseRotation = currentBaseRotation()
      staticCameraDistance = cameraDistanceForRotation(
        baseRotation.x,
        baseRotation.y,
        baseRotation.z
      )
      staticCameraDistancePose = poseMode
      staticCameraDistanceHalfFov = horizontalHalfFov
      return staticCameraDistance
    }

    function resizeDetail() {
      if (disposed) return
      const componentFrame = presentationMode === 'components'
        ? activeHost.closest('.majorana-focus-component')
        : null
      const componentFrameStyle = componentFrame ? window.getComputedStyle(componentFrame) : null
      const activeHostStyle = window.getComputedStyle(activeHost)
      const width = Math.max(
        1,
        activeHost.clientWidth,
        Number.parseFloat(activeHostStyle.width) || 0,
        Number.parseFloat(componentFrameStyle?.width) || 0
      )
      const height = Math.max(
        1,
        activeHost.clientHeight,
        Number.parseFloat(activeHostStyle.height) || 0,
        Number.parseFloat(componentFrameStyle?.height) || 0
      )
      horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * (width / height))
      updateStaticCameraDistance()
      const baseDistance = interaction.active || interaction.returning
        ? cameraDistanceForRotation(
            motionGroup.rotation.x,
            motionGroup.rotation.y,
            motionGroup.rotation.z
          )
        : staticCameraDistance
      const distance = cameraDistanceForPresentation(baseDistance)

      resizeDrawingBuffer(
        detailRenderer,
        detailRendererSize,
        width,
        height,
        calculatePixelRatio(activeHost, width, height)
      )
      detailCamera.aspect = width / height
      detailCamera.near = Math.max(distance / 150, 0.001)
      detailCamera.far = Math.max(distance * 40, diameter * 40)
      detailCamera.position.set(0, 0, distance)
      detailCamera.lookAt(0, 0, 0)
      detailCamera.updateProjectionMatrix()
      dirty = true
      requestRender()
    }

    const detailResizeObserver = new ResizeObserver(resizeDetail)
    detailResizeObserver.observe(activeHost)
    resizeDetail()

    function applyPose(nextMode, { idleDelayMs = 0, immediate = false } = {}) {
      poseMode = nextMode === 'components' ? 'components' : 'flat'
      detailRenderer.domElement.dataset.majoranaPose = poseMode
      idleWeight = 0
      idleStartsAt = poseMode === 'components'
        ? performance.now() + Math.max(0, idleDelayMs)
        : Number.POSITIVE_INFINITY
      interaction.rotateX = 0
      interaction.rotateY = 0
      interaction.active = false
      interaction.returning = !immediate
      if (immediate) {
        motionGroup.rotation.copy(currentBaseRotation())
        motionGroup.position.y = 0
      }
      dirty = true
    }

    function setPose(nextMode, options = {}) {
      applyPose(nextMode, options)
      resizeDetail()
      requestRender()
    }

    function setPresentation(nextMode, poseOptions = {}) {
      const presentationHosts = {
        components: componentHost,
        schematic: schematicComponentHost,
        pathways: pathwaysComponentHost,
        build: buildComponentHost
      }
      const normalizedMode =
        presentationHosts[nextMode] instanceof HTMLElement ? nextMode : 'components'
      const nextHost = presentationHosts[normalizedMode]
      if (!(nextHost instanceof HTMLElement)) return
      if (presentationMode === normalizedMode && activeHost === nextHost) {
        const desiredPoseMode = normalizedMode === 'components' ? 'components' : 'flat'
        if (poseMode !== desiredPoseMode) setPose(desiredPoseMode, poseOptions)
        return
      }

      presentationMode = normalizedMode
      activeHost = nextHost
      applyPresentationLighting()
      detailRenderer.domElement.dataset.majoranaPresentation = presentationMode
      applyPose(normalizedMode, poseOptions)
      detailRenderer.domElement.classList.toggle(
        'majorana-focus-component__canvas',
        presentationMode === 'components'
      )
      detailRenderer.domElement.classList.toggle(
        'majorana-schematic__component-canvas',
        presentationMode === 'schematic'
      )
      detailRenderer.domElement.classList.toggle(
        'majorana-pathways__component-canvas',
        presentationMode === 'pathways'
      )
      detailRenderer.domElement.classList.toggle(
        'majorana-build-part__canvas',
        presentationMode === 'build'
      )
      activeHost.append(detailRenderer.domElement)
      detailResizeObserver.disconnect()
      detailResizeObserver.observe(activeHost)
      resizeDetail()
      requestRender()
    }

    return {
      interaction,
      motionGroup,
      renderer: detailRenderer,
      scene: detailScene,
      camera: detailCamera,
      diameter,
      phase: partId === 'qpu-stack' ? 0 : Math.PI,
      get presentationMode() {
        return presentationMode
      },
      get poseMode() {
        return poseMode
      },
      setPose,
      setAppearance,
      setPresentation,
      resize: resizeDetail,
      markDirty() {
        dirty = true
        requestRender()
      },
      needsRender() {
        return poseMode === 'components' ||
          dirty || interaction.active || interaction.returning
      },
      needsContinuousRender() {
        return poseMode === 'components' || interaction.active || interaction.returning
      },
      async prepare() {
        if (disposed) return
        resizeDetail()

        const detailPmremGenerator = new THREE.PMREMGenerator(detailRenderer)
        try {
          detailEnvironmentRenderTarget?.dispose()
          detailEnvironmentRenderTarget = createMajoranaStudioEnvironment(
            THREE,
            detailPmremGenerator
          )
          if (detailEnvironmentRenderTarget) {
            detailScene.environment = detailEnvironmentRenderTarget.texture
          }
        } finally {
          detailPmremGenerator.dispose()
        }

        await detailRenderer.compileAsync(detailScene, detailCamera)
        if (disposed) return
        // Layout may settle while compilation is pending. Allocate the final
        // drawing buffer before reporting that the component is ready.
        resizeDetail()
        detailRenderer.render(detailScene, detailCamera)
        dirty = false
      },
      render(now, deltaSeconds) {
        const baseRotation = currentBaseRotation()
        const idleIsActive =
          poseMode === 'components' &&
          now >= idleStartsAt &&
          !interaction.active &&
          !interaction.returning
        const idleSmoothing = 1 - Math.exp(-deltaSeconds * 1.8)
        idleWeight = THREE.MathUtils.lerp(
          idleWeight,
          idleIsActive ? 1 : 0,
          idleSmoothing
        )
        if (idleWeight < 0.0001) idleWeight = 0
        const idleAmount = idleWeight
        const time = (now / 1000) * 0.68 + this.phase
        const targetX = baseRotation.x +
          THREE.MathUtils.degToRad(interaction.rotateX) +
          Math.sin(time * 0.73) * 0.018 * idleAmount
        const targetY = baseRotation.y +
          THREE.MathUtils.degToRad(interaction.rotateY) +
          Math.sin(time) * 0.045 * idleAmount
        const targetZ = baseRotation.z + Math.cos(time * 0.61) * 0.009 * idleAmount
        const smoothing = 1 - Math.exp(-deltaSeconds * (interaction.active ? 18 : 5.5))

        motionGroup.rotation.x = dampAngle(motionGroup.rotation.x, targetX, smoothing)
        motionGroup.rotation.y = dampAngle(motionGroup.rotation.y, targetY, smoothing)
        motionGroup.rotation.z = dampAngle(motionGroup.rotation.z, targetZ, smoothing)
        const baseCameraDistance = interaction.active || interaction.returning
          ? cameraDistanceForRotation(
              motionGroup.rotation.x,
              motionGroup.rotation.y,
              motionGroup.rotation.z
            )
          : staticCameraDistance
        detailCamera.position.z = cameraDistanceForPresentation(baseCameraDistance)
        const targetPositionY = poseMode === 'components'
          ? Math.sin(time * 0.86) * diameter * 0.006 * idleAmount
          : 0
        motionGroup.position.y = THREE.MathUtils.lerp(
          motionGroup.position.y,
          targetPositionY,
          smoothing
        )
        if (
          interaction.returning &&
          Math.abs(shortestAngleDelta(motionGroup.rotation.x, baseRotation.x)) < 0.002 &&
          Math.abs(shortestAngleDelta(motionGroup.rotation.y, baseRotation.y)) < 0.002 &&
          Math.abs(shortestAngleDelta(motionGroup.rotation.z, baseRotation.z)) < 0.002 &&
          (
            poseMode === 'components' ||
            Math.abs(motionGroup.position.y) < diameter * 0.0002
          )
        ) {
          interaction.returning = false
        }
        detailRenderer.render(detailScene, detailCamera)
        dirty = false
      },
      dispose() {
        unregisterDetailLights()
        detailResizeObserver.disconnect()
        detailScene.environment = null
        detailEnvironmentRenderTarget?.dispose()
        detailScene.clear()
        detailRendererLease.release()
      }
    }
  }

  function setupComponentViews(partNodes) {
    for (const [partId, nodes] of Object.entries(partNodes)) {
      if (componentViews.has(partId)) continue
      const componentView = createComponentView(
        partId,
        nodes,
        componentHosts[partId],
        schematicComponentHosts[partId],
        pathwaysComponentHosts[partId],
        buildComponentHosts[partId]
      )
      if (componentView) componentViews.set(partId, componentView)
    }
  }

  async function prepareComponentViews(readyCallback = onComponentsReady) {
    // Prepare one renderer at a time instead of overlapping two environment
    // bakes, shader compilations and texture uploads during the chip transition.
    for (const [partId, componentView] of componentViews) {
      if (disposed) return
      try {
        await componentView.prepare()
      } catch (error) {
        if (!disposed && error?.name !== 'AbortError') {
          console.warn(`Majorana ${partId} detail view could not be prewarmed.`, error)
        }
      }
    }

    if (componentViews.size === Object.keys(componentHosts).length && componentViews.size > 0) {
      readyCallback?.([...componentViews.keys()])
    }
  }

  function getModuleIntroPortalPose() {
    // Measure the authored module pose, not the menu pose currently applied to
    // its navigation and ambient parents. Restoring those transforms before the
    // next paint keeps this calculation invisible while making the portal's
    // landing frame identical to the frame attachToModule() will produce.
    const currentNavigationRotation = navigationPivot.quaternion.clone()
    const currentMotionPosition = motionRoot.position.clone()
    const currentMotionRotation = motionRoot.rotation.clone()
    navigationPivot.quaternion.identity()
    motionRoot.position.set(0, 0, 0)
    motionRoot.rotation.set(0, 0, 0)
    motionRoot.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(presentationRoot)
    const size = bounds.getSize(new THREE.Vector3())
    const target = bounds.getCenter(new THREE.Vector3())
    navigationPivot.quaternion.copy(currentNavigationRotation)
    motionRoot.position.copy(currentMotionPosition)
    motionRoot.rotation.copy(currentMotionRotation)
    motionRoot.updateMatrixWorld(true)
    const largestDimension = Math.max(size.x, size.y, size.z, 0.001)
    const halfFov = THREE.MathUtils.degToRad(INTRO_FOV * 0.5)
    const distance = (largestDimension / (2 * Math.tan(halfFov))) * INTRO_DISTANCE_SCALE
    const direction = new THREE.Vector3(
      INTRO_CAMERA_DIRECTION.x,
      INTRO_CAMERA_DIRECTION.y,
      INTRO_CAMERA_DIRECTION.z
    ).normalize()
    const up = worldCameraUp.clone()

    return {
      direction,
      distance,
      fov: INTRO_FOV,
      target,
      up
    }
  }

  function applyPortalViewport(viewport) {
    if (!portalViewportSession) return
    const surfaceWidth = Math.max(1, portalViewportSession.surface.clientWidth)
    const surfaceHeight = Math.max(1, portalViewportSession.surface.clientHeight)
    const width = Math.max(1, viewport.width)
    const height = Math.max(1, viewport.height)
    const left = viewport.left
    const bottom = surfaceHeight - viewport.top - height

    portalViewportSession.viewport = { ...viewport, width, height }
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setViewport(left, bottom, width, height)
    renderer.setScissor(left, bottom, width, height)
    renderer.setScissorTest(true)
  }

  function beginViewportSession({ surface, viewport } = {}) {
    if (disposed) throw abortError()
    if (!(surface instanceof HTMLElement)) {
      throw new TypeError('A Majorana portal scene surface is required.')
    }
    if (!viewport || viewport.width <= 0 || viewport.height <= 0) {
      throw new TypeError('A valid Majorana portal viewport is required.')
    }

    setSuspended(false)
    resizeObserver.disconnect()
    host = surface
    const startTarget = controls.target.clone()
    const startOffset = camera.position.clone().sub(startTarget)
    portalViewportSession = {
      surface,
      viewport: { ...viewport },
      pendingViewport: null,
      afterRender: null,
      needsFullClear: true,
      transitionProgress: 0,
      cameraMotion: {
        startTarget,
        startDirection: startOffset.clone().normalize(),
        startDistance: startOffset.length(),
        startFov: camera.fov,
        startUp: camera.up.clone(),
        end: getModuleIntroPortalPose()
      }
    }
    renderer.domElement.dataset.majoranaSharedScene = ''
    surface.prepend(renderer.domElement)
    resize()
    applyPortalViewport(viewport)

    // Clear the old card-sized buffer before the first portal frame. Rendering
    // synchronously keeps the same WebGL canvas visible across the DOM move.
    renderer.setScissorTest(false)
    renderer.setViewport(0, 0, surface.clientWidth, surface.clientHeight)
    renderer.clear(true, true, true)
    applyPortalViewport(viewport)
    renderMainScene()
    mainDirty = false
    portalViewportSession.needsFullClear = false

    return {
      setViewport(nextViewport, afterRender, transitionProgress = 0) {
        if (disposed || !portalViewportSession) return
        portalViewportSession.pendingViewport = { ...nextViewport }
        portalViewportSession.afterRender = afterRender
        portalViewportSession.transitionProgress = THREE.MathUtils.clamp(
          transitionProgress,
          0,
          1
        )
        portalViewportSession.needsFullClear = true
        invalidateMain()
      }
    }
  }

  function attachToModule({
    host: nextHost,
    componentHosts: nextComponentHosts = {},
    schematicComponentHosts: nextSchematicComponentHosts = {},
    pathwaysComponentHosts: nextPathwaysComponentHosts = {},
    buildComponentHosts: nextBuildComponentHosts = {},
    onComponentsReady: nextOnComponentsReady
  } = {}) {
    if (disposed) throw abortError()
    if (!(nextHost instanceof HTMLElement)) {
      throw new TypeError('A Majorana module scene host is required.')
    }

    setSuspended(false)
    componentHosts = { ...nextComponentHosts }
    schematicComponentHosts = { ...nextSchematicComponentHosts }
    pathwaysComponentHosts = { ...nextPathwaysComponentHosts }
    buildComponentHosts = { ...nextBuildComponentHosts }

    if (isNavigationPreview) {
      isNavigationPreview = false
      unregisterLights.update?.({
        label: 'Majorana look — camera locked',
        controls: majoranaLookControls,
        showDefaultLightControls: false
      })
      navigationDrag = null
      controlsAreActive = false
      navigationYawVelocity = 0
      if (navigationGrid) navigationGrid.visible = false
      if (navigationShadow) navigationShadow.plane.visible = false
      navigationPivot.quaternion.identity()
      motionRoot.position.set(0, 0, 0)
      motionRoot.rotation.set(0, 0, 0)
      fitCameraToModel()
      // The portal's landing pose is authored from this same intro camera.
      // Keep it exact at the DOM handoff rather than restoring the preview pose.
      navigationPivot.quaternion.identity()
      floatWeight = 0
      motionRoot.position.set(0, 0, 0)
      motionRoot.rotation.set(0, 0, 0)
      introFloatStartsAt = performance.now() + INTRO_FLOAT_ENTRY_DELAY_MS
      navigationPivotIsReturning = false
      camera.position.copy(introCameraPosition)
      controls.target.copy(introControlsTarget)
      camera.up.copy(introCameraUp)
      camera.fov = INTRO_FOV
      camera.updateProjectionMatrix()
      camera.lookAt(controls.target)
      returnToRestAt = Number.POSITIVE_INFINITY
      configureControls()
      invalidateMain()
    }

    if (host !== nextHost) {
      // Establish the module camera before resizing and drawing the canvas in
      // its new host. Rendering with the old preview camera for one frame was
      // enough to make the chip visibly hop during the final handoff.
      resizeObserver.disconnect()
      portalViewportSession = null
      renderer.setScissorTest(false)
      host = nextHost
      renderer.domElement.dataset.majoranaSharedScene = ''
      host.prepend(renderer.domElement)
      resizeObserver.observe(host)
      resize()
      renderer.setViewport(0, 0, host.clientWidth, host.clientHeight)
      renderMainScene()
      mainDirty = false
    }

    const componentsReady = new Promise((resolve, reject) => {
      const prepare = () => {
        if (disposed) {
          reject(abortError())
          return
        }
        if (loadedPartNodes) setupComponentViews(loadedPartNodes)
        prepareComponentViews(nextOnComponentsReady).then(resolve, reject)
      }

      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(prepare, { timeout: 700 })
      } else {
        window.setTimeout(prepare, 80)
      }
    })

    return { componentsReady, partsFound }
  }

  function setComponentRotation(partId, rotateX = 0, rotateY = 0, active = false) {
    const componentView = componentViews.get(partId)
    if (!componentView) return
    componentView.interaction.rotateX = rotateX
    componentView.interaction.rotateY = rotateY
    componentView.interaction.active = active
    componentView.interaction.returning = !active
    componentView.markDirty()
  }

  function setBuildPartMotion(partId, rotateX = 0, rotateY = 0, active = false) {
    const componentView = componentViews.get(partId)
    if (!componentView || componentView.presentationMode !== 'build') return
    componentView.interaction.rotateX = rotateX
    componentView.interaction.rotateY = rotateY
    componentView.interaction.active = active
    componentView.interaction.returning = !active
    componentView.markDirty()
  }

  function setComponentViewsActive(active, presentationMode = null, poseOptions = {}) {
    if (
      presentationMode === 'components' ||
      presentationMode === 'schematic' ||
      presentationMode === 'pathways' ||
      presentationMode === 'build'
    ) {
      componentViews.forEach(componentView => {
        componentView.setPresentation(presentationMode, poseOptions)
      })
    }
    componentViewsActive = Boolean(active)
    requestRender()
  }

  function setComponentAppearance(presentationMode) {
    if (
      presentationMode !== 'components' &&
      presentationMode !== 'schematic' &&
      presentationMode !== 'pathways' &&
      presentationMode !== 'build'
    ) return

    componentViews.forEach(componentView => {
      componentView.setAppearance(presentationMode)
    })
    requestRender()
  }

  function setComponentPose(poseMode, options = {}) {
    componentViews.forEach(componentView => {
      componentView.setPose(poseMode, options)
    })
    requestRender()
  }

  function resetComponentRotations({ immediate = true } = {}) {
    componentViews.forEach(componentView => {
      componentView.setPose(componentView.poseMode, { immediate })
    })
    requestRender()
  }

  function resize() {
    if (disposed) return
    const width = Math.max(1, host.clientWidth)
    const height = Math.max(1, host.clientHeight)
    resizeDrawingBuffer(
      renderer,
      mainRendererSize,
      width,
      height,
      calculatePixelRatio(host, width, height)
    )
    camera.aspect = portalViewportSession
      ? portalViewportSession.viewport.width / portalViewportSession.viewport.height
      : width / height
    camera.updateProjectionMatrix()
    navigationGridCamera.aspect = camera.aspect
    navigationGridCamera.updateProjectionMatrix()
    updateNavigationGridLayout()
    if (portalViewportSession) {
      portalViewportSession.needsFullClear = true
      applyPortalViewport(portalViewportSession.viewport)
    }
    invalidateMain()
  }

  function handleWindowResize() {
    resize()
    componentViews.forEach(componentView => componentView.resize())
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      window.cancelAnimationFrame(animationFrame)
      animationFrame = 0
      return
    }

    lastFrameTime = performance.now()
    mainDirty = true
    componentViews.forEach(componentView => componentView.markDirty())
    requestRender()
  }

  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(host)
  window.addEventListener('resize', handleWindowResize, { passive: true })
  document.addEventListener('visibilitychange', handleVisibilityChange)
  resize()
  signal?.addEventListener('abort', dispose, { once: true })

  function configureNavigationPivot() {
    if (navigationPivotReady) return
    presentationRoot.updateMatrixWorld(true)
    const center = new THREE.Box3()
      .setFromObject(presentationRoot)
      .getCenter(new THREE.Vector3())
    navigationPivot.position.copy(center)
    presentationRoot.position.sub(center)
    navigationPivot.updateMatrixWorld(true)
    navigationPivotReady = true
  }

  function fitCameraToModel() {
    const bounds = new THREE.Box3().setFromObject(presentationRoot)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const largestDimension = Math.max(size.x, size.y, size.z, 0.001)
    const diagonal = Math.max(size.length(), largestDimension)
    const introHalfFov = THREE.MathUtils.degToRad(INTRO_FOV * 0.5)
    const componentsHalfFov = THREE.MathUtils.degToRad(COMPONENTS_FOV * 0.5)
    const introDistanceScale = isNavigationPreview
      ? MAJORANA_NAVIGATION_DISTANCE_SCALE
      : INTRO_DISTANCE_SCALE
    const introDistance = (largestDimension / (2 * Math.tan(introHalfFov))) *
      introDistanceScale
    const componentsDistance = (size.y / (2 * Math.tan(componentsHalfFov))) *
      COMPONENTS_FRAME_PADDING
    const introDirection = new THREE.Vector3(
      INTRO_CAMERA_DIRECTION.x,
      INTRO_CAMERA_DIRECTION.y,
      INTRO_CAMERA_DIRECTION.z
    ).normalize()
    configureMainLightRig(center, size, introDirection)
    const componentsDirection = new THREE.Vector3(0, 0, 1)
    const componentsCenter = center.clone()
    componentsCenter.y += size.y * COMPONENTS_VERTICAL_OFFSET_RATIO
    const nearestDistance = Math.min(introDistance, componentsDistance)
    const furthestDistance = Math.max(introDistance, componentsDistance)

    const introCenter = center.clone()
    if (isNavigationPreview) {
      // Aim slightly below the chassis so its projected silhouette sits in
      // the same vertical band as the shared carousel objects.
      introCenter.y -= size.y * MAJORANA_NAVIGATION_TARGET_OFFSET_RATIO
    }

    modelDiameter = diagonal
    introFrameOffsets.length = 0
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          introFrameOffsets.push(new THREE.Vector3(
            x - introCenter.x,
            y - introCenter.y,
            z - introCenter.z
          ))
        }
      }
    }
    controls.target.copy(introCenter)
    camera.fov = INTRO_FOV
    camera.position.copy(introCenter).addScaledVector(introDirection, introDistance)
    introCameraUp.copy(worldCameraUp)
    camera.up.copy(introCameraUp)
    camera.near = Math.max(nearestDistance / 200, 0.001)
    camera.far = Math.max(furthestDistance * 100, largestDimension * 50)
    camera.updateProjectionMatrix()
    controls.minDistance = nearestDistance * 0.55
    controls.maxDistance = furthestDistance * 1.8
    controls.update()
    introCameraPosition.copy(camera.position)
    introControlsTarget.copy(controls.target)
    introBaseCameraDistance = introCameraPosition.distanceTo(introControlsTarget)
    componentsCameraPosition
      .copy(componentsCenter)
      .addScaledVector(componentsDirection, componentsDistance)
    componentsControlsTarget.copy(componentsCenter)
    createNavigationContactShadow(bounds, size, center, introDistance)
    introPoseReady = true
  }

  function createNavigationGrid() {
    if (!isNavigationPreview || navigationGrid) return

    navigationGrid = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: {
            value: new THREE.Color(MODULE_NAVIGATION_GRID.color).convertSRGBToLinear()
          },
          uSpacing: { value: 1 },
          uOpacity: { value: MODULE_NAVIGATION_GRID.opacity },
          uFadeRadius: { value: 1 }
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          varying vec3 vWorldPos;
          void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPos = worldPosition.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vWorldPos;
          uniform vec3 uColor;
          uniform float uSpacing, uOpacity, uFadeRadius;
          void main() {
            vec2 rotatedPosition = vec2(
              vWorldPos.x - vWorldPos.z,
              vWorldPos.x + vWorldPos.z
            ) * 0.7071068;
            vec2 coordinate = rotatedPosition / uSpacing;
            vec2 gridDistance = abs(fract(coordinate - 0.5) - 0.5) / fwidth(coordinate);
            float line = 1.0 - min(min(gridDistance.x, gridDistance.y), 1.0);
            float fade = 1.0 - smoothstep(
              uFadeRadius * ${MODULE_NAVIGATION_GRID.fadeInnerRatio.toFixed(2)},
              uFadeRadius,
              length(vWorldPos.xz)
            );
            gl_FragColor = vec4(uColor, line * fade * uOpacity);
          }
        `
      })
    )
    navigationGrid.rotation.x = -Math.PI / 2
    navigationGrid.renderOrder = -1
    navigationGridScene.add(navigationGrid)
    updateNavigationGridLayout()
  }

  function updateNavigationGridLayout() {
    if (!navigationGrid) return
    const layout = getModuleNavigationGridLayout({
      aspect: navigationGridCamera.aspect
    })
    navigationGrid.scale.set(layout.side, layout.side, 1)
    navigationGrid.position.set(0, layout.gridY, 0)
    navigationGrid.material.uniforms.uSpacing.value = layout.spacing
    navigationGrid.material.uniforms.uFadeRadius.value = layout.fadeRadius
    updateNavigationShadowLayout()
  }

  /*
   * Ground shadow, matching the shared carousel pool (shape-scene-3d.js): the
   * chassis is rendered from directly below into a small target, blurred, and
   * laid onto the grid. The silhouette is captured in the model's own scene but
   * displayed in the grid scene, so the plane has to be re-sized through both
   * projections rather than sharing the capture's world units.
   */
  const NAVIGATION_SHADOW_OPACITY = 0.32

  function createNavigationContactShadow(bounds, size, center, introDistance) {
    if (!isNavigationPreview || navigationShadow) return

    /* Only meshes reach the silhouette pass — layer 1, as in the pool. */
    presentationRoot.traverse(node => {
      if (node.isMesh) node.layers.enable(1)
    })

    /* Wide enough for the plate's yaw diagonal plus the sway translation. */
    const captureSize = Math.hypot(size.x, size.z) * 1.3
    const rt = new THREE.WebGLRenderTarget(256, 256)
    rt.texture.generateMipmaps = false
    const rtBlur = new THREE.WebGLRenderTarget(256, 256)
    rtBlur.texture.generateMipmaps = false

    const depthMaterial = new THREE.MeshDepthMaterial()
    depthMaterial.userData.darkness = { value: 0.9 }
    depthMaterial.onBeforeCompile = shader => {
      shader.uniforms.darkness = depthMaterial.userData.darkness
      shader.fragmentShader = 'uniform float darkness;\n' + shader.fragmentShader.replace(
        'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
        'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );'
      )
    }
    depthMaterial.depthTest = false
    depthMaterial.depthWrite = false
    const horizontalBlur = new THREE.ShaderMaterial(HorizontalBlurShader)
    horizontalBlur.depthTest = false
    const verticalBlur = new THREE.ShaderMaterial(VerticalBlurShader)
    verticalBlur.depthTest = false

    /* Below the model looking up; the drop softens the depth-based falloff so
       the plate's underside doesn't print as a hard black slab. */
    const cameraY = bounds.min.y - size.y * 0.6
    const shadowCamera = new THREE.OrthographicCamera(
      -captureSize / 2, captureSize / 2, captureSize / 2, -captureSize / 2,
      0, (bounds.max.y - cameraY) * 1.05
    )
    shadowCamera.position.set(center.x, cameraY, center.z)
    shadowCamera.rotation.x = Math.PI / 2
    shadowCamera.layers.set(1)
    scene.add(shadowCamera)

    const planeGeometry = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2)
    const blurPlane = new THREE.Mesh(planeGeometry)
    blurPlane.visible = false
    blurPlane.layers.enable(1)
    blurPlane.scale.setScalar(captureSize)
    blurPlane.position.set(center.x, cameraY + size.y * 0.01, center.z)
    scene.add(blurPlane)

    const plane = new THREE.Mesh(planeGeometry, new THREE.MeshBasicMaterial({
      map: rt.texture,
      transparent: true,
      opacity: NAVIGATION_SHADOW_OPACITY,
      depthWrite: false
    }))
    plane.name = 'MajoranaNavigationContactShadow'
    navigationGridScene.add(plane)

    navigationShadow = {
      blurPlane,
      captureSize,
      depthMaterial,
      horizontalBlur,
      introDistance,
      plane,
      planeGeometry,
      rt,
      rtBlur,
      shadowCamera,
      verticalBlur
    }
    updateNavigationShadowLayout()
  }

  function updateNavigationShadowLayout() {
    if (!navigationShadow) return
    const layout = getModuleNavigationGridLayout({
      aspect: navigationGridCamera.aspect
    })
    /* Same viewport, two cameras: a length at the model's depth under the main
       camera spans the same screen fraction as
       length × (gridDepth·tan(gridFov/2)) / (modelDepth·tan(modelFov/2))
       at the grid's depth under the grid camera. */
    const gridDistance = Math.hypot(
      MODULE_NAVIGATION_PROJECTION.distance,
      MODULE_NAVIGATION_PROJECTION.height - layout.gridY
    )
    const gridHalfTan = Math.tan(
      THREE.MathUtils.degToRad(MODULE_NAVIGATION_PROJECTION.fovDegrees / 2)
    )
    const introHalfTan = Math.tan(THREE.MathUtils.degToRad(INTRO_FOV / 2))
    const side = navigationShadow.captureSize *
      ((gridDistance * gridHalfTan) / (navigationShadow.introDistance * introHalfTan))
    /* Negative y, as in the pool: flips the rotated plane's winding so its
       front face looks up at the fixed grid camera. */
    navigationShadow.plane.scale.set(side, -1, side)
    navigationShadow.plane.position.set(0, layout.gridY + layout.groundThickness, 0)
  }

  function maintainIntroInteractionFraming() {
    if (
      view !== 'intro' ||
      !introPoseReady ||
      (!controlsAreActive && !controls.autoRotate) ||
      introFrameOffsets.length === 0
    ) return

    camera.getWorldDirection(introFrameForward).normalize()
    introFrameRight.crossVectors(introFrameForward, camera.up).normalize()
    introFrameUp.crossVectors(introFrameRight, introFrameForward).normalize()

    const verticalTangent = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))
    const horizontalTangent = verticalTangent * camera.aspect
    let requiredDistance = 0

    for (const offset of introFrameOffsets) {
      const depthOffset = offset.dot(introFrameForward)
      requiredDistance = Math.max(
        requiredDistance,
        (Math.abs(offset.dot(introFrameRight)) * INTRO_INTERACTION_FRAME_PADDING) /
          horizontalTangent - depthOffset,
        (Math.abs(offset.dot(introFrameUp)) * INTRO_INTERACTION_FRAME_PADDING) /
          verticalTangent - depthOffset
      )
    }

    introFrameCameraOffset.copy(camera.position).sub(controls.target)
    const currentDistance = introFrameCameraOffset.length()
    const targetDistance = Math.max(introBaseCameraDistance, requiredDistance)
    if (Math.abs(targetDistance - currentDistance) <= modelDiameter * 0.00001) return

    camera.position
      .copy(controls.target)
      .addScaledVector(introFrameCameraOffset.normalize(), targetDistance)
    camera.updateMatrixWorld()
  }

  function startComponentsCameraTransition(startedAt) {
    resolveCameraTransition?.()
    const transitionFinished = new Promise(resolve => {
      resolveCameraTransition = resolve
    })
    const startTarget = controls.target.clone()
    const startOffset = camera.position.clone().sub(startTarget)

    cameraTransition = {
      startedAt,
      duration: reducedMotion.matches ? 1 : COMPONENTS_TRANSITION_MS,
      startTarget,
      endTarget: componentsControlsTarget.clone(),
      startDirection: startOffset.clone().normalize(),
      endDirection: componentsCameraPosition.clone().sub(componentsControlsTarget).normalize(),
      startDistance: startOffset.length(),
      endDistance: componentsCameraPosition.distanceTo(componentsControlsTarget),
      startFov: camera.fov,
      endFov: COMPONENTS_FOV,
      startUp: camera.up.clone(),
      endUp: worldCameraUp.clone()
    }

    const dampingWasEnabled = controls.enableDamping
    controls.enableDamping = false
    controls.update()
    controls.enableDamping = dampingWasEnabled
    controls.target.copy(cameraTransition.startTarget)
    camera.position
      .copy(cameraTransition.startTarget)
      .addScaledVector(cameraTransition.startDirection, cameraTransition.startDistance)
    camera.up.copy(cameraTransition.startUp)
    camera.lookAt(controls.target)

    controlsAreActive = false
    returnToRestAt = Number.POSITIVE_INFINITY
    return transitionFinished
  }

  function finishComponentsCameraTransition() {
    camera.position.copy(componentsCameraPosition)
    controls.target.copy(componentsControlsTarget)
    camera.up.copy(worldCameraUp)
    camera.fov = COMPONENTS_FOV
    camera.updateProjectionMatrix()
    camera.lookAt(controls.target)
    cameraTransition = null
    configureControls()
    resolveCameraTransition?.()
    resolveCameraTransition = null
  }

  function updateCameraTransition(now) {
    if (!cameraTransition) return false

    const rawProgress = THREE.MathUtils.clamp(
      (now - cameraTransition.startedAt) / cameraTransition.duration,
      0,
      1
    )
    const progress = smoothStep(rawProgress)
    const target = transitionTarget.lerpVectors(
      cameraTransition.startTarget,
      cameraTransition.endTarget,
      progress
    )
    const direction = transitionDirection.lerpVectors(
      cameraTransition.startDirection,
      cameraTransition.endDirection,
      progress
    ).normalize()
    const distance = THREE.MathUtils.lerp(
      cameraTransition.startDistance,
      cameraTransition.endDistance,
      progress
    )

    controls.target.copy(target)
    camera.position.copy(target).addScaledVector(direction, distance)
    camera.up.lerpVectors(cameraTransition.startUp, cameraTransition.endUp, progress).normalize()
    camera.fov = THREE.MathUtils.lerp(cameraTransition.startFov, cameraTransition.endFov, progress)
    camera.updateProjectionMatrix()
    camera.lookAt(controls.target)

    if (rawProgress >= 1) finishComponentsCameraTransition()
    return true
  }

  function configureControls() {
    navigationMotionEnabled = shouldAnimateNavigationPreview({
      isNavigationPreview,
      isIntro: view === 'intro',
      reducedMotion: reducedMotion.matches
    })
    controls.autoRotate = false
    renderer.domElement.dataset.majoranaNavigationMotion = navigationMotionEnabled
      ? 'carousel-sway'
      : 'still'
    controls.enabled =
      !isNavigationPreview &&
      !['build', 'components', 'pathways'].includes(view) &&
      cameraTransition === null
    controls.enableZoom = !['intro', 'components', 'pathways', 'build'].includes(view)

    if (view === 'intro' && introPoseReady) {
      controls.minAzimuthAngle = Number.NEGATIVE_INFINITY
      controls.maxAzimuthAngle = Number.POSITIVE_INFINITY
      controls.minPolarAngle = THREE.MathUtils.degToRad(4)
      controls.maxPolarAngle = Math.PI - THREE.MathUtils.degToRad(4)
      return
    }

    controls.minAzimuthAngle = Number.NEGATIVE_INFINITY
    controls.maxAzimuthAngle = Number.POSITIVE_INFINITY
    controls.minPolarAngle = 0
    controls.maxPolarAngle = Math.PI
  }

  function updateTransformTargets() {
    presentationRoot.updateMatrixWorld(true)
    for (const record of transformRecords) record.target.copy(record.original)

    const offsets = view === 'build'
      ? {
          'qpu-stack': new THREE.Vector3(-0.22, 0.14, 0.06),
          'cryo-cmos': new THREE.Vector3(0.24, -0.08, -0.04)
        }
      : null

    if (!offsets) return

    for (const record of transformRecords) {
      const shouldOffset = view !== 'build' || !buildPlacements[record.partId]
      if (!shouldOffset) continue

      const worldOffset = offsets[record.partId].clone().multiplyScalar(modelDiameter)
      if (!record.node.parent) {
        record.target.add(worldOffset)
        continue
      }

      const parentWorldOrigin = new THREE.Vector3().setFromMatrixPosition(record.node.parent.matrixWorld)
      const localOrigin = record.node.parent.worldToLocal(parentWorldOrigin.clone())
      const localOffsetEnd = record.node.parent.worldToLocal(parentWorldOrigin.add(worldOffset))
      record.target.add(localOffsetEnd.sub(localOrigin))
    }
  }

  function updateTransformPositions(interpolation, animate) {
    const epsilon = Math.max(modelDiameter * 0.00001, 0.0000001)
    const epsilonSquared = epsilon * epsilon
    let isMoving = false

    for (const record of transformRecords) {
      if (record.node.position.distanceToSquared(record.target) <= epsilonSquared) {
        record.node.position.copy(record.target)
        continue
      }
      if (!animate) {
        record.node.position.copy(record.target)
        continue
      }

      record.node.position.lerp(record.target, interpolation)
      if (record.node.position.distanceToSquared(record.target) <= epsilonSquared) {
        record.node.position.copy(record.target)
      } else {
        isMoving = true
      }
    }

    return isMoving
  }

  function setView(nextView, state = {}) {
    const viewChanged = nextView !== view
    const transitionStartedAt = performance.now()
    let transitionFinished = Promise.resolve()
    view = nextView
    buildPlacements = {
      'qpu-stack': Boolean(state.placements?.['qpu-stack']),
      'cryo-cmos': Boolean(state.placements?.['cryo-cmos'])
    }

    if (viewChanged && cameraTransition) {
      cameraTransition = null
      resolveCameraTransition?.()
      resolveCameraTransition = null
    }

    if (view === 'intro' && viewChanged && introPoseReady) {
      introFloatStartsAt = performance.now()
      camera.position.copy(introCameraPosition)
      controls.target.copy(introControlsTarget)
      camera.up.copy(introCameraUp)
      camera.fov = INTRO_FOV
      camera.updateProjectionMatrix()
      controls.update()
      returnToRestAt = Number.POSITIVE_INFINITY
    }

    if (view === 'components' && viewChanged && introPoseReady) {
      transitionFinished = startComponentsCameraTransition(transitionStartedAt)
    }

    if (view !== 'intro') {
      floatWeight = 0
      motionRoot.position.set(0, 0, 0)
      motionRoot.rotation.set(0, 0, 0)
      navigationPivot.quaternion.identity()
      navigationPivotIsReturning = false
    }
    configureControls()
    updateTransformTargets()
    mainTransformsAreMoving = transformRecords.some(record =>
      record.node.position.distanceToSquared(record.target) > 0
    )
    invalidateMain()
    return transitionFinished
  }

  function render(now) {
    animationFrame = 0
    if (disposed || suspended) return
    const deltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.05)
    lastFrameTime = now
    const interpolation = 1 - Math.exp(-deltaSeconds * 6.4)
    const mainSceneIsVisible = !host.classList.contains('is-schematic')

    mainTransformsAreMoving = updateTransformPositions(interpolation, mainSceneIsVisible)

    if (isNavigationPreview) {
      const navigationCardIsActive = Boolean(
        portalViewportSession ||
        host.closest('.module-card')?.classList.contains('is-active')
      )
      if (navigationCardIsActive && !navigationCardWasActive) {
        navigationUserYaw = 0
        navigationUserPitch = 0
        navigationYawVelocity = 0
        navigationPivot.rotation.set(0, 0, 0)
      }
      navigationCardWasActive = navigationCardIsActive
      const navigationCard = host.closest('.module-card')
      const navigationCardRect = navigationCard?.getBoundingClientRect()
      stepMajoranaNavigationSway(navigationSway, {
        centerX: navigationCardRect
          ? navigationCardRect.left + (navigationCardRect.width / 2)
          : undefined,
        deltaSeconds,
        reducedMotion:
          !navigationMotionEnabled ||
          reducedMotion.matches ||
          Boolean(portalViewportSession),
        width: navigationCardRect?.width
      })
      if (!controlsAreActive && navigationYawVelocity !== 0) {
        navigationUserYaw += navigationYawVelocity * deltaSeconds
        navigationYawVelocity *= Math.pow(0.12, deltaSeconds)
        if (Math.abs(navigationYawVelocity) < 0.04) navigationYawVelocity = 0
      }
      if (!controlsAreActive) navigationUserPitch *= Math.pow(0.997, deltaSeconds * 60)
      navigationPivot.rotation.order = 'YXZ'
      navigationPivot.rotation.set(
        navigationUserPitch,
        navigationUserYaw,
        navigationSway.offset * MAJORANA_NAVIGATION_SWAY.rollScale
      )

      if (portalViewportSession) {
        const portalProgress = portalViewportSession.transitionProgress
        const settleProgress = smoothStep(THREE.MathUtils.clamp(
          (portalProgress - 0.18) / 0.72,
          0,
          1
        ))
        navigationPivot.quaternion.slerp(identityQuaternion, settleProgress)

        const cameraProgress = smoothStep(THREE.MathUtils.clamp(
          (portalProgress - 0.08) / 0.82,
          0,
          1
        ))
        const motion = portalViewportSession.cameraMotion
        const target = transitionTarget.lerpVectors(
          motion.startTarget,
          motion.end.target,
          cameraProgress
        )
        const direction = transitionDirection.lerpVectors(
          motion.startDirection,
          motion.end.direction,
          cameraProgress
        ).normalize()
        const distance = THREE.MathUtils.lerp(
          motion.startDistance,
          motion.end.distance,
          cameraProgress
        )

        controls.target.copy(target)
        camera.position.copy(target).addScaledVector(direction, distance)
        camera.up.lerpVectors(motion.startUp, motion.end.up, cameraProgress).normalize()
        camera.fov = THREE.MathUtils.lerp(motion.startFov, motion.end.fov, cameraProgress)
        camera.updateProjectionMatrix()
        camera.lookAt(controls.target)

        if (navigationGrid) {
          const gridFade = smoothStep(THREE.MathUtils.clamp(
            (portalProgress - 0.34) / 0.5,
            0,
            1
          ))
          navigationGrid.material.uniforms.uOpacity.value = 0.4 * (1 - gridFade)
          if (navigationShadow) {
            navigationShadow.plane.material.opacity =
              NAVIGATION_SHADOW_OPACITY * (1 - gridFade)
          }
        }
      }
    }

    const shouldFloat =
      introPoseReady &&
      view === 'intro' &&
      !controlsAreActive &&
      !portalViewportSession &&
      (isNavigationPreview || now >= introFloatStartsAt) &&
      !reducedMotion.matches
    const floatTarget = shouldFloat ? 1 : 0
    const floatInterpolation = 1 - Math.exp(-deltaSeconds * 2.8)
    floatWeight += (floatTarget - floatWeight) * floatInterpolation
    if (portalViewportSession?.transitionProgress >= 1) floatWeight = 0
    if (view === 'intro') {
      const time = now / 1000
      motionRoot.position.x = isNavigationPreview
        ? navigationSway.offset * modelDiameter * MAJORANA_NAVIGATION_SWAY.translationScale
        : 0
      motionRoot.position.y = isNavigationPreview
        ? 0
        : Math.sin(time * 0.72) * modelDiameter * 0.008 * floatWeight
    }

    let cameraIsReturning = Boolean(
      view === 'intro' &&
      introPoseReady &&
      !controlsAreActive &&
      now >= returnToRestAt
    )
    if (cameraIsReturning) {
      const returnInterpolation = 1 - Math.exp(-deltaSeconds * 3.2)
      returnCurrentOffset.copy(camera.position).sub(controls.target)
      returnTargetOffset.copy(introCameraPosition).sub(introControlsTarget)
      const currentDistance = returnCurrentOffset.length()
      const targetDistance = returnTargetOffset.length()
      returnCurrentDirection.copy(returnCurrentOffset).normalize()
      returnTargetDirection.copy(returnTargetOffset).normalize()
      returnRotation.setFromUnitVectors(returnCurrentDirection, returnTargetDirection)
      returnStepRotation.identity().slerp(returnRotation, returnInterpolation)
      returnCurrentDirection.applyQuaternion(returnStepRotation)
      controls.target.lerp(introControlsTarget, returnInterpolation)
      camera.position
        .copy(controls.target)
        .addScaledVector(
          returnCurrentDirection,
          THREE.MathUtils.lerp(currentDistance, targetDistance, returnInterpolation)
        )
      camera.up.lerp(introCameraUp, returnInterpolation).normalize()
      if (
        camera.position.distanceToSquared(introCameraPosition) < 0.000001 &&
        controls.target.distanceToSquared(introControlsTarget) < 0.000001
      ) {
        camera.position.copy(introCameraPosition)
        controls.target.copy(introControlsTarget)
        camera.up.copy(introCameraUp)
        returnToRestAt = Number.POSITIVE_INFINITY
        cameraIsReturning = false
      }
    }

    if (navigationPivotIsReturning) {
      const pivotReturnInterpolation = 1 - Math.exp(-deltaSeconds * 4.2)
      navigationPivot.quaternion.slerp(identityQuaternion, pivotReturnInterpolation)
      if (navigationPivot.quaternion.angleTo(identityQuaternion) < 0.0001) {
        navigationPivot.quaternion.identity()
        navigationPivotIsReturning = false
      }
    }
    mainIsReturning = cameraIsReturning || navigationPivotIsReturning

    const cameraIsTransitioning = updateCameraTransition(now)
    if (!cameraIsTransitioning && controls.enabled) controls.update(deltaSeconds)
    maintainIntroInteractionFraming()
    const introIsAnimating = introPoseReady && view === 'intro' && !reducedMotion.matches
    if (
      mainSceneIsVisible && (
        mainDirty ||
        introIsAnimating ||
        cameraIsTransitioning ||
        controlsAreActive ||
        mainIsReturning ||
        mainTransformsAreMoving
      )
    ) {
      if (portalViewportSession) {
        const session = portalViewportSession
        const viewport = session.pendingViewport || session.viewport
        if (session.needsFullClear) {
          renderer.setScissorTest(false)
          renderer.setViewport(0, 0, session.surface.clientWidth, session.surface.clientHeight)
          renderer.clear(true, true, true)
        }
        applyPortalViewport(viewport)
      }
      renderMainScene()
      if (portalViewportSession) {
        const afterRender = portalViewportSession.afterRender
        portalViewportSession.pendingViewport = null
        portalViewportSession.afterRender = null
        portalViewportSession.needsFullClear = false
        afterRender?.()
      }
      mainDirty = false
    }
    if (componentViewsActive) {
      componentViews.forEach(componentView => {
        if (componentView.needsRender()) componentView.render(now, deltaSeconds)
      })
    }

    const componentAnimationIsActive = componentViewsActive &&
      [...componentViews.values()].some(componentView => componentView.needsContinuousRender())
    if (shouldContinueRendering({
      isVisible: !document.hidden && !suspended,
      introIsAnimating,
      cameraIsTransitioning: Boolean(cameraTransition),
      controlsAreActive,
      mainIsReturning,
      mainTransformsAreMoving,
      componentAnimationIsActive
    }) && !animationFrame) {
      animationFrame = window.requestAnimationFrame(render)
    }
  }

  requestRender()

  const modelUrl = assetUrl('assets/modules/build-majorana-2/majorana-2.glb')
  let pmremGenerator = null
  let gltf
  try {
    pmremGenerator = new THREE.PMREMGenerator(renderer)

    /* The model ships EXT_meshopt_compression, so the decoder is required, not
       an optimisation — without it the load throws rather than degrading. */
    const gltfLoader = new GLTFLoader(loadingManager)
    gltfLoader.setMeshoptDecoder(MeshoptDecoder)

    gltf = await loadGltf(gltfLoader, modelUrl, onProgress)
    throwIfAborted(signal)
    if (disposed) throw abortError()

    modelRoot = gltf.scene
    presentationRoot.add(modelRoot)
    hideDuplicateMajoranaChassis(modelRoot)
    applyMajoranaClearcoat(THREE, modelRoot)
    applyMajoranaReferencePalette(modelRoot)
    applyMajoranaLook()
    configureMajoranaTextureSampling(modelRoot, {
      minFilter: THREE.LinearMipmapLinearFilter,
      anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy())
    })
    const partNodes = gatherPartNodes(modelRoot)
    loadedPartNodes = partNodes
    partsFound = Object.fromEntries(
      Object.entries(partNodes).map(([partId, nodes]) => [partId, nodes.map(node => node.name)])
    )
    transformRecords = Object.entries(partNodes).flatMap(([partId, nodes]) =>
      nodes.map(node => ({
        partId,
        node,
        original: node.position.clone(),
        target: node.position.clone(),
        quaternion: node.quaternion.clone(),
        scale: node.scale.clone()
      }))
    )
    setupComponentViews(partNodes)

    // Let Three.js settle skinned/world transforms before deriving the shared
    // front-facing camera pose. Fitting one frame too early makes the chassis
    // center shift after the transition has already started.
    floatWeight = 0
    motionRoot.position.set(0, 0, 0)
    motionRoot.rotation.set(0, 0, 0)
    await new Promise(resolve => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))
    })
    throwIfAborted(signal)
    if (disposed) throw abortError()
    configureNavigationPivot()
    fitCameraToModel()
    createNavigationGrid()
    setView(view, { placements: buildPlacements })
    throwIfAborted(signal)
    if (disposed) throw abortError()

    environmentRenderTarget = createMajoranaStudioEnvironment(THREE, pmremGenerator)
    if (environmentRenderTarget) {
      scene.environment = environmentRenderTarget.texture
      invalidateMain()
    }
    if (componentViews.size > 0) {
      await prepareComponentViews()
    }

    throwIfAborted(signal)
    if (disposed) throw abortError()

    onReady?.({ partsFound })
  } catch (error) {
    if (gltf?.scene && gltf.scene !== modelRoot) disposeObject(gltf.scene)
    dispose()
    throw error
  } finally {
    pmremGenerator?.dispose()
  }

  function dispose() {
    if (disposed) return
    disposed = true
    unregisterLights()
    resolveCameraTransition?.()
    resolveCameraTransition = null
    loadingManager.abort()
    window.cancelAnimationFrame(animationFrame)
    animationFrame = 0
    resizeObserver.disconnect()
    window.removeEventListener('resize', handleWindowResize)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    signal?.removeEventListener('abort', dispose)
    controls.removeEventListener('start', handleControlsStart)
    controls.removeEventListener('end', handleControlsEnd)
    controls.removeEventListener('change', handleControlsChange)
    reducedMotion.removeEventListener('change', handleReducedMotionChange)
    renderer.domElement.removeEventListener('pointerdown', handleNavigationPointerDown)
    renderer.domElement.removeEventListener('pointermove', handleNavigationPointerMove)
    renderer.domElement.removeEventListener('pointerup', finishNavigationPointer)
    renderer.domElement.removeEventListener('pointercancel', cancelNavigationPointer)
    controls.dispose()
    componentViews.forEach(componentView => componentView.dispose())
    componentViews.clear()
    scene.environment = null
    environmentRenderTarget?.dispose()
    if (navigationGrid) {
      navigationGridScene.remove(navigationGrid)
      navigationGrid.geometry.dispose()
      navigationGrid.material.dispose()
      navigationGrid = null
    }
    if (navigationShadow) {
      navigationGridScene.remove(navigationShadow.plane)
      scene.remove(navigationShadow.blurPlane, navigationShadow.shadowCamera)
      navigationShadow.rt.dispose()
      navigationShadow.rtBlur.dispose()
      navigationShadow.planeGeometry.dispose()
      navigationShadow.plane.material.dispose()
      navigationShadow.depthMaterial.dispose()
      navigationShadow.horizontalBlur.dispose()
      navigationShadow.verticalBlur.dispose()
      navigationShadow = null
    }
    disposeObject(modelRoot)
    presentationRoot.remove(modelRoot)
    scene.clear()
    navigationGridScene.clear()
    rendererLease.release()
  }

  function setSuspended(nextSuspended) {
    if (disposed) return
    const shouldSuspend = Boolean(nextSuspended)
    if (suspended === shouldSuspend) return
    suspended = shouldSuspend

    if (suspended) {
      window.cancelAnimationFrame(animationFrame)
      animationFrame = 0
      controls.enabled = false
      return
    }

    lastFrameTime = performance.now()
    mainDirty = true
    configureControls()
    componentViews.forEach(componentView => componentView.markDirty())
    requestRender()
  }

  return {
    beginViewportSession,
    attachToModule,
    get partsFound() {
      return partsFound
    },
    setView,
    setComponentRotation,
    setComponentPose,
    resetComponentRotations,
    setBuildPartMotion,
    setComponentAppearance,
    setComponentViewsActive,
    setSuspended,
    dispose
  }
}
