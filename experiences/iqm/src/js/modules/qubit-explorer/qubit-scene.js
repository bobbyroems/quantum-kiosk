import {
  calculateCssScale,
  calculateStageAwarePixelRatio
} from '../build-majorana-2/majorana-render-utils.js'
import { registerLightRig } from '../../core/light-rig-registry.js'
import { applyImperfectionToObject } from '../../core/surface-imperfection.js'
import { leaseWebGLRenderer } from '../../core/webgl-renderer-pool.js'
import {
  isValidQubitDrop,
  QUBIT_DROP_THRESHOLD
} from './qubit-state.js'
import {
  applyAssemblySnap,
  ASSEMBLY_IDLE_PULL_MAX_PROGRESS,
  assemblyDistanceFromProgress,
  assemblyIdlePullProgress,
  assemblyProgressFromPoint
} from './qubit-drag.js'
import { resolveQubitShellTransition } from './qubit-fusion.js'
import {
  advanceQubitMaterialEntrance,
  easeQubitMaterialEntrance,
  qubitMaterialEntranceOffset
} from './qubit-material-entrance.js'

const RETURN_DURATION_MS = 520
const SNAP_DURATION_MS = 1_350
const DROP_THRESHOLD = QUBIT_DROP_THRESHOLD
const MATERIAL_ENTRANCE_DISTANCE = 0.59
const MATERIAL_ENTRANCE_SCALE = 0.92
const SUPER_SHELL_OPACITY = 0.78
const SEMI_SHELL_OPACITY = 0.72
const TOPO_SHELL_COLOR = 0xa358d6
const TOPO_SHELL_OPACITY = 1
const FINAL_PRESENTATION_LIFT = 0
/* Two .42-high split shells span the same .79 height as the unified shell at
   this separation, avoiding an overlap or a size pop during their crossfade. */
const FINAL_LAYER_HALF_SEPARATION = 0.185
const MAX_RENDER_PIXELS = 4_500_000

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function lerp(start, end, amount) {
  return start + ((end - start) * amount)
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - clamp(value, 0, 1), 3)
}

function easeInOutCubic(value) {
  const t = clamp(value, 0, 1)
  return t < 0.5
    ? 4 * t * t * t
    : 1 - (Math.pow(-2 * t + 2, 3) / 2)
}

function damp(current, target, smoothing, deltaSeconds) {
  return lerp(current, target, 1 - Math.exp(-smoothing * deltaSeconds))
}

function seededRandom(seed) {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

function createGrid(THREE) {
  const geometry = new THREE.PlaneGeometry(18, 18)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#b4bac3').convertSRGBToLinear() },
      uSpacing: { value: 0.92 },
      uOpacity: { value: 0.18 },
      uAngle: { value: THREE.MathUtils.degToRad(18) },
      uFadeRadius: { value: 7.3 }
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorldPosition;
      uniform vec3 uColor;
      uniform float uSpacing;
      uniform float uOpacity;
      uniform float uAngle;
      uniform float uFadeRadius;

      void main() {
        float angleCos = cos(uAngle);
        float angleSin = sin(uAngle);
        mat2 gridRotation = mat2(
          angleCos, angleSin,
          -angleSin, angleCos
        );
        vec2 coordinate = gridRotation * vWorldPosition.xz / uSpacing;
        vec2 gridWidth = abs(fract(coordinate - 0.5) - 0.5) / fwidth(coordinate);
        float line = 1.0 - min(min(gridWidth.x, gridWidth.y), 1.0);
        float fade = 1.0 - smoothstep(
          uFadeRadius * 0.34,
          uFadeRadius,
          length(vWorldPosition.xz)
        );
        gl_FragColor = vec4(uColor, line * fade * uOpacity);
      }
    `
  })
  const grid = new THREE.Mesh(geometry, material)
  grid.name = 'QubitExplorerGrid'
  grid.rotation.x = -Math.PI / 2
  grid.position.set(0, -1.82, -0.25)
  grid.renderOrder = -5
  return grid
}

function createParticleField(THREE, {
  count,
  length,
  height,
  depth,
  seed,
  paired = false
}) {
  const random = seededRandom(seed)
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)
  const positionAttribute = new THREE.BufferAttribute(positions, 3)
  positionAttribute.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', positionAttribute)
  const material = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: {
      uMerge: { value: 0 },
      uOpacity: { value: 0 },
      uPixelRatio: { value: 1 },
      uPointSize: { value: 22 }
    },
    vertexShader: `
      uniform float uMerge;
      uniform float uPixelRatio;
      uniform float uPointSize;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        float perspective = 24.0 / max(1.0, -viewPosition.z);
        gl_PointSize = uPointSize * uPixelRatio * perspective * mix(1.0, 1.18, uMerge);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform float uMerge;
      uniform float uOpacity;
      void main() {
        float radius = length((gl_PointCoord - 0.5) * 2.0);
        if (radius >= 1.0) discard;
        float halo = 1.0 - smoothstep(0.12, 1.0, radius);
        float coreRadius = mix(0.22, 0.12, uMerge);
        float core = 1.0 - smoothstep(0.0, coreRadius, radius);
        vec3 warm = mix(vec3(0.96, 0.57, 0.08), vec3(1.0, 0.97, 0.76), core);
        float alpha = halo * mix(0.46, 0.58, uMerge) + core;
        gl_FragColor = vec4(warm, alpha * uOpacity);
      }
    `
  })
  const points = new THREE.Points(geometry, material)
  const particles = []
  const pairSeeds = []

  for (let index = 0; index < count; index += 1) {
    const pairIndex = paired ? Math.floor(index / 2) : index
    const pairSide = paired ? (index % 2 === 0 ? -1 : 1) : 0
    const lane = paired ? pairIndex % 4 : index % 6
    const pairSeed = paired
      ? (pairSeeds[pairIndex] ||= {
          baseX: random() * length - (length / 2),
          z: (random() - 0.5) * depth * 0.64,
          speed: 0.32 + random() * 0.1,
          phase: random() * Math.PI * 2
        })
      : null
    particles.push({
      baseX: pairSeed?.baseX ?? (random() * length - (length / 2)),
      y: ((lane / (paired ? 3 : 5)) - 0.5) * height * 0.72 + (random() - 0.5) * 0.04,
      z: pairSeed?.z ?? ((random() - 0.5) * depth * 0.64),
      speed: pairSeed?.speed ?? (0.05 + random() * 0.045),
      phase: pairSeed?.phase ?? (random() * Math.PI * 2),
      pairSide,
      cell: Math.floor(random() * 5)
    })
  }

  points.renderOrder = 5
  points.frustumCulled = false

  const update = (elapsedSeconds, mergeProgress = 0) => {
    for (let index = 0; index < particles.length; index += 1) {
      const particle = particles[index]
      let x
      let y

      if (paired) {
        const travel = ((particle.baseX + elapsedSeconds * particle.speed + length / 2) % length) - length / 2
        x = travel + particle.pairSide * 0.055
        y = particle.y + Math.sin(elapsedSeconds * 1.7 + particle.phase) * 0.018
      } else {
        const cellCenter = -length * 0.4 + (particle.cell / 4) * length * 0.8
        x = cellCenter + Math.sin(elapsedSeconds * particle.speed * 5 + particle.phase) * 0.24
        y = particle.y + Math.cos(elapsedSeconds * particle.speed * 7 + particle.phase) * 0.075
      }

      const unifiedX = ((particle.baseX + elapsedSeconds * 0.13 + length / 2) % length) - length / 2
      x = lerp(x, unifiedX, mergeProgress)
      const unifiedY = particle.y * 0.32 +
        Math.sin((x / length) * Math.PI * 4 + elapsedSeconds * 1.2 + particle.phase) * 0.07
      y = lerp(y, unifiedY, mergeProgress)
      const unifiedZ = particle.z * 0.5 +
        Math.sin(particle.phase + elapsedSeconds * 0.45) * 0.08
      const z = lerp(particle.z, unifiedZ, mergeProgress)
      positions[index * 3] = x
      positions[index * 3 + 1] = y
      positions[index * 3 + 2] = z
    }

    positionAttribute.needsUpdate = true
    material.uniforms.uMerge.value = mergeProgress
  }

  const group = new THREE.Group()
  group.add(points)

  return {
    group,
    material,
    update,
    setOpacity(value) {
      material.uniforms.uOpacity.value = clamp(value, 0, 1)
    },
    setPixelRatio(value) {
      material.uniforms.uPixelRatio.value = value
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    }
  }
}

function createLayer(THREE, RoundedBoxGeometry, {
  color,
  opacity,
  particles
}) {
  const root = new THREE.Group()
  const shellGeometry = new RoundedBoxGeometry(5.45, 0.42, 1.18, 3, 0.045)
  const hitGeometry = new THREE.BoxGeometry(5.8, 1.08, 1.72)
  const shellMaterial = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 0.04,
    transparent: true,
    opacity,
    depthWrite: false
  })
  const hitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false
  })
  const shell = new THREE.Mesh(shellGeometry, shellMaterial)
  const hitbox = new THREE.Mesh(hitGeometry, hitMaterial)
  shell.renderOrder = 1
  hitbox.renderOrder = 10
  root.add(shell, particles.group, hitbox)

  return {
    root,
    hitbox,
    shell,
    shellMaterial,
    dispose() {
      shellGeometry.dispose()
      hitGeometry.dispose()
      shellMaterial.dispose()
      hitMaterial.dispose()
      particles.dispose()
    }
  }
}

function createTopoconductor(THREE, RoundedBoxGeometry) {
  const root = new THREE.Group()
  const shellGeometry = new RoundedBoxGeometry(5.45, 0.79, 1.18, 4, 0.07)
  const shellMaterial = new THREE.MeshPhysicalMaterial({
    color: TOPO_SHELL_COLOR,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 0.04,
    transparent: true,
    opacity: 0,
    depthWrite: false
  })
  const shell = new THREE.Mesh(shellGeometry, shellMaterial)
  const ribbonGeometry = new THREE.PlaneGeometry(5.02, 0.48)
  const energyMaterial = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uOpacity: { value: 0 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uOpacity;
      void main() {
        float along = smoothstep(0.0, 0.12, vUv.x) * smoothstep(0.0, 0.12, 1.0 - vUv.x);
        float across = abs(vUv.y - 0.5) * 2.0;
        float glow = exp(-across * across * 5.4) * along;
        vec3 energy = mix(vec3(1.0, 0.68, 0.18), vec3(1.0, 0.93, 0.64), 1.0 - across);
        gl_FragColor = vec4(energy, glow * uOpacity);
      }
    `
  })
  const ribbonFace = new THREE.Mesh(ribbonGeometry, energyMaterial)
  const ribbonDepth = new THREE.Mesh(ribbonGeometry, energyMaterial)
  shell.name = 'UnifiedTopoconductorShell'
  shell.renderOrder = 2
  shell.visible = false
  ribbonDepth.rotation.x = Math.PI / 2
  ribbonFace.renderOrder = 4
  ribbonDepth.renderOrder = 4
  root.add(shell, ribbonFace, ribbonDepth)
  root.visible = false

  return {
    root,
    shell,
    shellMaterial,
    energyMaterial,
    dispose() {
      shellGeometry.dispose()
      shellMaterial.dispose()
      ribbonGeometry.dispose()
      energyMaterial.dispose()
    }
  }
}

/**
 * Creates the procedural material-layer scene used by Qubit Explorer.
 * The scene owns pointer capture and reports semantic interaction events to
 * the DOM module, while every visible surface remains real Three.js geometry.
 */
export async function createQubitScene(host, callbacks = {}) {
  if (!host?.append) throw new TypeError('Qubit Explorer requires a scene host')

  const [THREE, roundedBoxModule] = await Promise.all([
    import('three'),
    import('three/addons/geometries/RoundedBoxGeometry.js')
  ])
  const { RoundedBoxGeometry } = roundedBoxModule

  const rendererLease = leaseWebGLRenderer(THREE, {
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  })
  const { renderer } = rendererLease
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.setClearColor(0x000000, 0)
  renderer.domElement.className = 'qe__canvas'
  renderer.domElement.setAttribute('aria-hidden', 'true')
  host.append(renderer.domElement)
  let unregisterLights = null

  try {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 80)
    camera.position.set(0, 2.75, 25)
    camera.lookAt(0, -0.22, 0)

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xb9c5d0, 2.45)
    scene.add(hemiLight)
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.1)
    keyLight.position.set(-3.8, 6.5, 8)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0x9bd9ff, 1.35)
    fillLight.position.set(5, 1.5, 5)
    scene.add(fillLight)
    unregisterLights = registerLightRig('qubit explorer', [
      { name: 'hemi', light: hemiLight },
      { name: 'key', light: keyLight },
      { name: 'fill', light: fillLight }
    ])
    const grid = createGrid(THREE)
    scene.add(grid)

    const superParticles = createParticleField(THREE, {
      count: 180,
      length: 5.05,
      height: 0.32,
      depth: 0.92,
      seed: 4204,
      paired: true
    })
    const semiParticles = createParticleField(THREE, {
      count: 200,
      length: 5.05,
      height: 0.32,
      depth: 0.92,
      seed: 7319,
      paired: false
    })
    const superLayer = createLayer(THREE, RoundedBoxGeometry, {
      color: 0x477ad9,
      opacity: SUPER_SHELL_OPACITY,
      particles: superParticles
    })
    const semiLayer = createLayer(THREE, RoundedBoxGeometry, {
      color: 0xcc4535,
      opacity: SEMI_SHELL_OPACITY,
      particles: semiParticles
    })
    const topo = createTopoconductor(THREE, RoundedBoxGeometry)
    const targetGeometry = new RoundedBoxGeometry(5.66, 0.52, 1.28, 5, 0.11)
    const targetMaterial = new THREE.MeshBasicMaterial({
      color: 0x477ad9,
      transparent: true,
      opacity: 0,
      side: THREE.BackSide,
      depthWrite: false
    })
    const targetGlow = new THREE.Mesh(targetGeometry, targetMaterial)
    targetGlow.scale.set(1.025, 1.18, 1.05)
    targetGlow.renderOrder = 0
    semiLayer.root.add(targetGlow)

    const BASE_ROTATION = new THREE.Euler(0.1, 0.31, 0.18, 'XYZ')
    /* The authored separate-material composition uses a tighter vertical pair
       than the earlier implementation. These centers reproduce the reference
       bounds without moving the camera or changing the drag's joined target. */
    const superOrigin = new THREE.Vector3(-0.05, 0.84, -0.42)
    const semiOrigin = new THREE.Vector3(0.06, -0.6, 0.46)
    const topoTarget = new THREE.Vector3(0, -0.02, 0.22)
    const layerNormal = new THREE.Vector3(0, 1, 0).applyEuler(BASE_ROTATION).normalize()
    const finalUpperPosition = topoTarget.clone().addScaledVector(
      layerNormal,
      FINAL_LAYER_HALF_SEPARATION
    )
    const finalLowerPosition = topoTarget.clone().addScaledVector(
      layerNormal,
      -FINAL_LAYER_HALF_SEPARATION
    )
    const superInitialShellColor = superLayer.shellMaterial.color.clone()
    const semiInitialShellColor = semiLayer.shellMaterial.color.clone()
    const finalShellColor = new THREE.Color(TOPO_SHELL_COLOR)
    const superMutedShellColor = new THREE.Color(0xa9bbe1)
    const semiMutedShellColor = new THREE.Color(0xe0b2ac)
    const shellTransition = {
      progress: 0,
      splitShellWeight: 1,
      unifiedShellWeight: 0
    }
    superLayer.root.position.copy(superOrigin)
    semiLayer.root.position.copy(semiOrigin)
    topo.root.position.copy(topoTarget)
    superLayer.root.rotation.copy(BASE_ROTATION)
    semiLayer.root.rotation.copy(BASE_ROTATION)
    topo.root.rotation.copy(BASE_ROTATION)
    superLayer.root.position.y += MATERIAL_ENTRANCE_DISTANCE
    semiLayer.root.position.y -= MATERIAL_ENTRANCE_DISTANCE
    superLayer.root.scale.setScalar(MATERIAL_ENTRANCE_SCALE)
    semiLayer.root.scale.setScalar(MATERIAL_ENTRANCE_SCALE)
    superLayer.shellMaterial.opacity = 0
    semiLayer.shellMaterial.opacity = 0
    superParticles.setOpacity(0)
    semiParticles.setOpacity(0)
    semiLayer.root.visible = false
    scene.add(superLayer.root, semiLayer.root, topo.root)
    /* Shared surface imperfection on the layer PBR materials, dialed live
       by the dev material panel. */
    applyImperfectionToObject(scene)

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const dragPlane = new THREE.Plane()
    const planeNormal = new THREE.Vector3()
    const dragPoint = new THREE.Vector3()
    const dragOffset = new THREE.Vector3()
    const dragDesired = new THREE.Vector3()
    const dragSuperTarget = new THREE.Vector3()
    const dragSemiTarget = new THREE.Vector3()
    const pointerPrevious = new THREE.Vector2()
    const pointerVelocity = new THREE.Vector2()
    const layerRecords = {
      superconductor: {
        root: superLayer.root,
        origin: superOrigin,
        final: finalUpperPosition
      },
      semiconductor: {
        root: semiLayer.root,
        origin: semiOrigin,
        final: finalLowerPosition
      }
    }
    superLayer.hitbox.userData.qeLayer = 'superconductor'
    semiLayer.hitbox.userData.qeLayer = 'semiconductor'

    let phase = 'intro'
    let phaseStartedAt = performance.now()
    let interactive = false
    let interactiveRequested = false
    let activePointerId = null
    let introFinished = false
    let tuneProgress = 0
    let materialFocusTarget = 0
    let materialFocus = 0
    let superEntranceProgress = 0
    let semiconductorEntranceProgress = 0
    let semiconductorPresenceTarget = 0
    let semiconductorPresence = 0
    let idleMotionStrength = 0
    let idleMotionStartedAt = null
    let idlePullProgress = 0
    let tuningLiftTarget = 0
    let tuningLift = 0
    let activeLayerId = null
    let dragProgressTarget = 0
    let transitionStartPosition = superOrigin.clone()
    let transitionStartSemiPosition = semiOrigin.clone()
    let transitionStartSuperRotation = BASE_ROTATION.clone()
    let transitionStartSemiRotation = BASE_ROTATION.clone()
    let transitionStartSuperScale = 1
    let transitionStartSemiScale = 1
    let transitionStartTargetOpacity = 0
    let pointerPreviousAt = performance.now()
    let animationFrame = null
    let lastFrameAt = performance.now()
    let disposed = false
    let visible = !document.hidden
    let hiddenAt = visible ? null : performance.now()
    let resizeObserver = null
    const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const materialPresentation = {
      semiconductorPresence: 0,
      semiDim: 0,
      superDim: 0
    }

    const setPointerFromEvent = event => {
      const bounds = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1
      pointer.y = -(((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 2 - 1)
      raycaster.setFromCamera(pointer, camera)
    }

    const setPhase = nextPhase => {
      phase = nextPhase
      phaseStartedAt = performance.now()
      if (nextPhase === 'returning' || nextPhase === 'snapping') {
        transitionStartPosition = superLayer.root.position.clone()
        transitionStartSemiPosition = semiLayer.root.position.clone()
        transitionStartSuperRotation = superLayer.root.rotation.clone()
        transitionStartSemiRotation = semiLayer.root.rotation.clone()
        transitionStartSuperScale = superLayer.root.scale.x
        transitionStartSemiScale = semiLayer.root.scale.x
        transitionStartTargetOpacity = targetMaterial.opacity
      }
    }

    const finishIntro = ({ notify = true } = {}) => {
      if (introFinished) return
      introFinished = true
      superEntranceProgress = 1
      idleMotionStrength = 0
      superLayer.root.position.copy(superOrigin)
      semiLayer.root.position.copy(semiOrigin)
      superLayer.root.scale.setScalar(1)
      semiLayer.root.scale.setScalar(1)
      superLayer.shellMaterial.opacity = SUPER_SHELL_OPACITY
      semiLayer.shellMaterial.opacity = 0
      superParticles.setOpacity(1)
      semiParticles.setOpacity(0)
      semiLayer.root.visible = false
      setPhase('ready')
      interactive = false
      publishAnchorLayout()
      if (notify) {
        /* Let the renderer commit the exact entrance endpoint before the
           explainer performs its first layout pass. The model is already
           settled, so panel creation cannot interrupt its final moving frame. */
        queueMicrotask(() => {
          if (disposed || !introFinished || phase !== 'ready') return
          callbacks.onIntroComplete?.()
        })
      }
    }

    const onPointerDown = event => {
      if (disposed || activePointerId !== null || phase === 'stacked' || phase === 'snapping') return
      setPointerFromEvent(event)
      const hits = raycaster.intersectObjects([superLayer.hitbox, semiLayer.hitbox], false)
      if (!hits.length) return

      if (phase === 'intro') {
        finishIntro({ notify: false })
        callbacks.onIntroSkip?.()
      }
      if (!interactive || phase !== 'ready') return

      activeLayerId = hits[0].object.userData.qeLayer
      const activeLayer = layerRecords[activeLayerId]
      activePointerId = event.pointerId
      renderer.domElement.setPointerCapture?.(activePointerId)
      camera.getWorldDirection(planeNormal)
      dragPlane.setFromNormalAndCoplanarPoint(planeNormal, activeLayer.root.position)
      if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
        dragOffset.copy(dragPoint).sub(activeLayer.root.position)
      } else {
        dragOffset.set(0, 0, 0)
      }
      /* Begin from wherever the idle prompt has brought the pair. Resetting to
         zero here made the slabs retreat before following the visitor's drag. */
      dragProgressTarget = idlePullProgress
      pointerPrevious.set(event.clientX, event.clientY)
      pointerPreviousAt = event.timeStamp || performance.now()
      pointerVelocity.set(0, 0)
      setPhase('dragging')
      callbacks.onDragStart?.()
      callbacks.onActivity?.()
    }

    const finishDrag = ({ valid, distance, notifyActivity = true }) => {
      const pointerId = activePointerId
      activePointerId = null
      activeLayerId = null
      if (pointerId !== null) {
        try {
          renderer.domElement.releasePointerCapture?.(pointerId)
        } catch {
          // Pointer capture may already have been released by the browser.
        }
      }
      interactive = false
      setPhase(valid ? 'snapping' : 'returning')
      callbacks.onDrop?.({ valid, distance, threshold: DROP_THRESHOLD })
      if (notifyActivity) callbacks.onActivity?.()
    }

    const onPointerMove = event => {
      if (event.pointerId !== activePointerId || phase !== 'dragging') return
      setPointerFromEvent(event)
      if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return

      const activeLayer = layerRecords[activeLayerId]
      dragDesired.copy(dragPoint).sub(dragOffset)
      /* Both layers ride this one value in updateDragging, mirrored about the
         join, so whichever one was grabbed the pair always meets in the middle.
         The snap curve draws the last stretch closed on its own. */
      dragProgressTarget = applyAssemblySnap(assemblyProgressFromPoint(
        activeLayer.origin,
        activeLayer.final,
        dragDesired
      ))
      const canvasBounds = renderer.domElement.getBoundingClientRect()
      const stageScale = canvasBounds.width / Math.max(renderer.domElement.clientWidth, 1)
      const eventTime = event.timeStamp || performance.now()
      const deltaSeconds = clamp((eventTime - pointerPreviousAt) / 1000, 0.008, 0.05)
      pointerVelocity.set(
        clamp((event.clientX - pointerPrevious.x) / Math.max(stageScale, 0.001) / deltaSeconds, -3_000, 3_000),
        clamp((event.clientY - pointerPrevious.y) / Math.max(stageScale, 0.001) / deltaSeconds, -3_000, 3_000)
      )
      pointerPrevious.set(event.clientX, event.clientY)
      pointerPreviousAt = eventTime

      /* Distance is normalized to preserve the reducer's drop contract while the
         actual motion remains a clamped 0..1 assembly path. The layers therefore
         cannot pass through each other, regardless of which one was grabbed. */
      const distance = assemblyDistanceFromProgress(dragProgressTarget)
      targetMaterial.opacity = clamp(dragProgressTarget * 0.34, 0.04, 0.34)
      callbacks.onDragMove?.({ distance, threshold: DROP_THRESHOLD })

      if (isValidQubitDrop(distance, DROP_THRESHOLD)) {
        dragProgressTarget = 1
        finishDrag({ valid: true, distance })
      }
    }

    const releasePointer = event => {
      if (event.pointerId !== activePointerId) return
      const distance = assemblyDistanceFromProgress(dragProgressTarget)
      const valid = isValidQubitDrop(distance, DROP_THRESHOLD)
      finishDrag({ valid, distance })
    }

    const onPointerCancel = event => {
      if (event.pointerId !== activePointerId) return
      finishDrag({ valid: false, distance: Infinity, notifyActivity: false })
    }

    const onLostPointerCapture = event => {
      if (event.pointerId === activePointerId) onPointerCancel(event)
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', releasePointer)
    renderer.domElement.addEventListener('pointercancel', onPointerCancel)
    renderer.domElement.addEventListener('lostpointercapture', onLostPointerCapture)

    const anchorWorld = new THREE.Vector3()
    const topoconductorAnchor = new THREE.Vector3(1.95, 0.08, 0.66)
    const projectAnchor = (root, localPoint) => {
      anchorWorld.copy(localPoint)
      root.localToWorld(anchorWorld)
      anchorWorld.project(camera)
      return {
        x: (anchorWorld.x * 0.5 + 0.5) * Math.max(host.clientWidth, 1),
        y: (-anchorWorld.y * 0.5 + 0.5) * Math.max(host.clientHeight, 1)
      }
    }

    const publishAnchorLayout = () => {
      scene.updateMatrixWorld(true)
      camera.updateMatrixWorld(true)
      callbacks.onAnchorLayout?.({
        topoconductor: projectAnchor(topo.root, topoconductorAnchor)
      })
    }

    const resize = () => {
      if (disposed) return
      const bounds = host.getBoundingClientRect()
      const width = Math.max(1, host.clientWidth || bounds.width)
      const height = Math.max(1, host.clientHeight || bounds.height)
      const layoutWidth = Math.max(1, host.clientWidth || width)
      const layoutHeight = Math.max(1, host.clientHeight || height)
      const cssScale = calculateCssScale({
        layoutWidth,
        layoutHeight,
        renderedWidth: bounds.width,
        renderedHeight: bounds.height
      })
      const pixelRatio = calculateStageAwarePixelRatio({
        width,
        height,
        cssScale,
        devicePixelRatio: window.devicePixelRatio || 1,
        maxRenderPixels: MAX_RENDER_PIXELS
      })
      renderer.setPixelRatio(pixelRatio)
      superParticles.setPixelRatio(pixelRatio)
      semiParticles.setPixelRatio(pixelRatio)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      publishAnchorLayout()
    }
    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(host)
    resize()

    const updateMaterialPresentation = deltaSeconds => {
      materialFocus = damp(materialFocus, materialFocusTarget, 4.8, deltaSeconds)
      semiconductorEntranceProgress = semiconductorPresenceTarget > 0
        ? advanceQubitMaterialEntrance(
            semiconductorEntranceProgress,
            deltaSeconds,
            reducedMotionQuery?.matches
          )
        : 0
      semiconductorPresence = semiconductorPresenceTarget > 0
        ? easeQubitMaterialEntrance(semiconductorEntranceProgress)
        : 0
      interactive = interactiveRequested &&
        phase === 'ready' &&
        semiconductorEntranceProgress >= 1
      materialPresentation.superDim = Math.max(0, materialFocus)
      materialPresentation.semiDim = Math.max(0, -materialFocus)
      materialPresentation.semiconductorPresence = semiconductorPresence
      return materialPresentation
    }

    const applyUnjoinedAppearance = deltaSeconds => {
      const {
        semiconductorPresence: semiPresence,
        semiDim,
        superDim
      } = updateMaterialPresentation(deltaSeconds)

      superLayer.shell.visible = true
      semiLayer.shell.visible = true
      semiLayer.root.visible = semiconductorPresenceTarget > 0
      topo.shell.visible = false
      topo.shellMaterial.opacity = 0
      superLayer.shellMaterial.color
        .copy(superInitialShellColor)
        .lerp(superMutedShellColor, superDim)
      semiLayer.shellMaterial.color
        .copy(semiInitialShellColor)
        .lerp(semiMutedShellColor, semiDim)
      superLayer.shellMaterial.opacity = lerp(SUPER_SHELL_OPACITY, 0.3, superDim)
      semiLayer.shellMaterial.opacity =
        lerp(SEMI_SHELL_OPACITY, 0.3, semiDim) * semiPresence
      superParticles.setOpacity(1)
      semiParticles.setOpacity(semiPresence)
      if (
        phase === 'ready' &&
        semiconductorPresenceTarget > 0 &&
        (semiconductorEntranceProgress < 1 || materialFocusTarget !== 0)
      ) {
        semiLayer.root.position.y = semiOrigin.y +
          MATERIAL_ENTRANCE_DISTANCE *
          qubitMaterialEntranceOffset(semiconductorEntranceProgress, -1)
        semiLayer.root.scale.setScalar(
          lerp(MATERIAL_ENTRANCE_SCALE, 1, semiPresence)
        )
      }
    }

    const applyTunedAppearance = (elapsedSeconds, deltaSeconds = 1 / 60) => {
      const visualProgress = easeInOutCubic(tuneProgress)
      resolveQubitShellTransition(tuneProgress, shellTransition)
      const protectedPulse = (Math.sin(elapsedSeconds * 1.55) + 1) / 2
      /* The drift stops once the pair have joined. It reads as the slabs still
         hovering, waiting to be moved, when the point of the closing screens is
         that they have settled into one material — and it pulls the eye while
         the copy is being read. Faded out with the tune rather than cut, so the
         material comes to rest instead of stopping dead. */
      const float = Math.sin(elapsedSeconds * 0.62) * 0.014 * (1 - visualProgress)
      const dimming = updateMaterialPresentation(deltaSeconds)
      const superDim = dimming.superDim * (1 - visualProgress)
      const semiDim = dimming.semiDim * (1 - visualProgress)
      tuningLift = damp(tuningLift, tuningLiftTarget, 3.8, deltaSeconds)

      superLayer.shellMaterial.color
        .copy(superInitialShellColor)
        .lerp(finalShellColor, visualProgress)
        .lerp(superMutedShellColor, superDim)
      semiLayer.shellMaterial.color
        .copy(semiInitialShellColor)
        .lerp(finalShellColor, visualProgress)
        .lerp(semiMutedShellColor, semiDim)

      const superShellOpacity = lerp(
        SUPER_SHELL_OPACITY,
        TOPO_SHELL_OPACITY,
        visualProgress
      )
      const semiShellOpacity = lerp(
        SEMI_SHELL_OPACITY,
        TOPO_SHELL_OPACITY,
        visualProgress
      )
      superLayer.shellMaterial.opacity =
        lerp(superShellOpacity, 0.3, superDim) * shellTransition.splitShellWeight
      semiLayer.shellMaterial.opacity =
        lerp(semiShellOpacity, 0.3, semiDim) * shellTransition.splitShellWeight
      superLayer.shell.visible = shellTransition.splitShellWeight > 0.001
      semiLayer.shell.visible = shellTransition.splitShellWeight > 0.001
      topo.shellMaterial.opacity =
        TOPO_SHELL_OPACITY * shellTransition.unifiedShellWeight
      topo.shell.visible = shellTransition.unifiedShellWeight > 0.001

      superParticles.group.position.y = lerp(0, -0.16, visualProgress)
      semiParticles.group.position.y = lerp(0, 0.125, visualProgress)
      topo.root.visible = true
      topo.root.position.y = topoTarget.y + tuningLift + float
      topo.energyMaterial.uniforms.uOpacity.value =
        lerp(0.035, 0.17, visualProgress) +
        protectedPulse * lerp(0.006, 0.055, visualProgress)
      superLayer.root.position.y = finalUpperPosition.y + tuningLift + float
      semiLayer.root.position.y = finalLowerPosition.y + tuningLift + float
      /*
       * The material moves in these phases too — the tuning lift eases in and
       * the idle float never stops — so the callout anchors have to be
       * republished here. Without this the topoconductor's connector kept
       * pointing at wherever the layers stood when the snap finished, drawing a
       * line far longer than the gap it was meant to span.
       */
      publishAnchorLayout()
    }

    const updateIntro = deltaSeconds => {
      superEntranceProgress = advanceQubitMaterialEntrance(
        superEntranceProgress,
        deltaSeconds,
        reducedMotionQuery?.matches
      )
      const superPresence = easeQubitMaterialEntrance(superEntranceProgress)
      superLayer.root.position.y = superOrigin.y +
        MATERIAL_ENTRANCE_DISTANCE *
        qubitMaterialEntranceOffset(superEntranceProgress, 1)
      superLayer.root.scale.setScalar(
        lerp(MATERIAL_ENTRANCE_SCALE, 1, superPresence)
      )
      superLayer.shellMaterial.opacity = SUPER_SHELL_OPACITY * superPresence
      superParticles.setOpacity(superPresence)
      semiLayer.root.position.copy(semiOrigin)
      semiLayer.root.position.y -= MATERIAL_ENTRANCE_DISTANCE
      semiLayer.root.scale.setScalar(MATERIAL_ENTRANCE_SCALE)
      semiLayer.shellMaterial.opacity = 0
      semiParticles.setOpacity(0)
      semiLayer.root.visible = false
      if (superEntranceProgress >= 1) finishIntro()
    }

    const updateDragging = deltaSeconds => {
      dragSuperTarget.lerpVectors(superOrigin, finalUpperPosition, dragProgressTarget)
      dragSemiTarget.lerpVectors(semiOrigin, finalLowerPosition, dragProgressTarget)
      superLayer.root.position.x = damp(superLayer.root.position.x, dragSuperTarget.x, 20, deltaSeconds)
      superLayer.root.position.y = damp(superLayer.root.position.y, dragSuperTarget.y, 20, deltaSeconds)
      superLayer.root.position.z = damp(superLayer.root.position.z, dragSuperTarget.z, 20, deltaSeconds)
      semiLayer.root.position.x = damp(semiLayer.root.position.x, dragSemiTarget.x, 20, deltaSeconds)
      semiLayer.root.position.y = damp(semiLayer.root.position.y, dragSemiTarget.y, 20, deltaSeconds)
      semiLayer.root.position.z = damp(semiLayer.root.position.z, dragSemiTarget.z, 20, deltaSeconds)
      const selectedDirection = activeLayerId === 'semiconductor' ? -1 : 1
      superLayer.root.rotation.x = damp(
        superLayer.root.rotation.x,
        BASE_ROTATION.x + pointerVelocity.y * -0.000045 * selectedDirection,
        13,
        deltaSeconds
      )
      superLayer.root.rotation.y = damp(
        superLayer.root.rotation.y,
        BASE_ROTATION.y + pointerVelocity.x * 0.00004 * selectedDirection,
        13,
        deltaSeconds
      )
      superLayer.root.rotation.z = damp(
        superLayer.root.rotation.z,
        BASE_ROTATION.z + pointerVelocity.x * -0.000025 * selectedDirection,
        12,
        deltaSeconds
      )
      semiLayer.root.rotation.x = damp(
        semiLayer.root.rotation.x,
        BASE_ROTATION.x - pointerVelocity.y * -0.000045 * selectedDirection,
        13,
        deltaSeconds
      )
      semiLayer.root.rotation.y = damp(
        semiLayer.root.rotation.y,
        BASE_ROTATION.y - pointerVelocity.x * 0.00004 * selectedDirection,
        13,
        deltaSeconds
      )
      semiLayer.root.rotation.z = damp(
        semiLayer.root.rotation.z,
        BASE_ROTATION.z - pointerVelocity.x * -0.000025 * selectedDirection,
        12,
        deltaSeconds
      )
      superLayer.root.scale.setScalar(damp(superLayer.root.scale.x, 1.015, 11, deltaSeconds))
      semiLayer.root.scale.setScalar(damp(semiLayer.root.scale.x, 1.015, 11, deltaSeconds))
      pointerVelocity.multiplyScalar(Math.exp(-12 * deltaSeconds))
      publishAnchorLayout()
    }

    const updateReturn = elapsedMs => {
      const progress = easeOutCubic(elapsedMs / RETURN_DURATION_MS)
      superLayer.root.position.lerpVectors(transitionStartPosition, superOrigin, progress)
      semiLayer.root.position.lerpVectors(transitionStartSemiPosition, semiOrigin, progress)
      superLayer.root.rotation.x = lerp(transitionStartSuperRotation.x, BASE_ROTATION.x, progress)
      superLayer.root.rotation.y = lerp(transitionStartSuperRotation.y, BASE_ROTATION.y, progress)
      superLayer.root.rotation.z = lerp(transitionStartSuperRotation.z, BASE_ROTATION.z, progress)
      semiLayer.root.rotation.x = lerp(transitionStartSemiRotation.x, BASE_ROTATION.x, progress)
      semiLayer.root.rotation.y = lerp(transitionStartSemiRotation.y, BASE_ROTATION.y, progress)
      semiLayer.root.rotation.z = lerp(transitionStartSemiRotation.z, BASE_ROTATION.z, progress)
      superLayer.root.scale.setScalar(lerp(transitionStartSuperScale, 1, progress))
      semiLayer.root.scale.setScalar(lerp(transitionStartSemiScale, 1, progress))
      targetMaterial.opacity = lerp(transitionStartTargetOpacity, 0, progress)
      publishAnchorLayout()
      if (elapsedMs >= RETURN_DURATION_MS) {
        superLayer.root.position.copy(superOrigin)
        semiLayer.root.position.copy(semiOrigin)
        superLayer.root.rotation.copy(BASE_ROTATION)
        semiLayer.root.rotation.copy(BASE_ROTATION)
        superLayer.root.scale.setScalar(1)
        semiLayer.root.scale.setScalar(1)
        targetMaterial.opacity = 0
        setPhase('ready')
        interactive = true
        callbacks.onReturnComplete?.()
      }
    }

    const updateSnap = elapsedMs => {
      const positionProgress = easeOutCubic(elapsedMs / 620)
      const reactionProgress = easeInOutCubic((elapsedMs - 300) / 850)
      const settle = clamp((elapsedMs - 940) / 410, 0, 1)
      superLayer.root.position.lerpVectors(transitionStartPosition, finalUpperPosition, positionProgress)
      semiLayer.root.position.lerpVectors(transitionStartSemiPosition, finalLowerPosition, positionProgress)
      superLayer.root.rotation.x = lerp(transitionStartSuperRotation.x, BASE_ROTATION.x, positionProgress)
      superLayer.root.rotation.y = lerp(transitionStartSuperRotation.y, BASE_ROTATION.y, positionProgress)
      superLayer.root.rotation.z = lerp(transitionStartSuperRotation.z, BASE_ROTATION.z, positionProgress)
      semiLayer.root.rotation.x = lerp(transitionStartSemiRotation.x, BASE_ROTATION.x, positionProgress)
      semiLayer.root.rotation.y = lerp(transitionStartSemiRotation.y, BASE_ROTATION.y, positionProgress)
      semiLayer.root.rotation.z = lerp(transitionStartSemiRotation.z, BASE_ROTATION.z, positionProgress)
      superLayer.root.scale.setScalar(
        lerp(transitionStartSuperScale, 1, positionProgress) +
        Math.sin(Math.min(positionProgress, 1) * Math.PI) * 0.025
      )
      semiLayer.root.scale.setScalar(
        lerp(transitionStartSemiScale, 1, positionProgress) +
        Math.sin(Math.min(positionProgress, 1) * Math.PI) * 0.025
      )
      targetMaterial.opacity = lerp(transitionStartTargetOpacity, 0, reactionProgress)

      topo.root.visible = reactionProgress > 0
      topo.energyMaterial.uniforms.uOpacity.value = reactionProgress *
        (0.03 + Math.sin(elapsedMs * 0.018) * 0.005)
      semiconductorPresenceTarget = 1
      semiconductorEntranceProgress = 1
      semiconductorPresence = 1
      superLayer.shell.visible = true
      semiLayer.shell.visible = true
      semiLayer.root.visible = true
      topo.shell.visible = false
      topo.shellMaterial.opacity = 0
      superLayer.shellMaterial.opacity = SUPER_SHELL_OPACITY
      semiLayer.shellMaterial.opacity = SEMI_SHELL_OPACITY
      superLayer.shellMaterial.color.copy(superInitialShellColor)
      semiLayer.shellMaterial.color.copy(semiInitialShellColor)
      superParticles.setOpacity(1)
      semiParticles.setOpacity(1)
      superParticles.group.position.set(0, 0, 0)
      semiParticles.group.position.set(0, 0, 0)

      if (settle > 0) {
        const settleScale = 1 + Math.sin(settle * Math.PI) * 0.018
        topo.root.scale.setScalar(settleScale)
      }
      publishAnchorLayout()

      if (elapsedMs >= SNAP_DURATION_MS) {
        superLayer.root.position.copy(finalUpperPosition)
        semiLayer.root.position.copy(finalLowerPosition)
        superLayer.root.rotation.copy(BASE_ROTATION)
        semiLayer.root.rotation.copy(BASE_ROTATION)
        superLayer.root.scale.setScalar(1)
        semiLayer.root.scale.setScalar(1)
        superParticles.group.position.set(0, 0, 0)
        semiParticles.group.position.set(0, 0, 0)
        superLayer.shellMaterial.opacity = SUPER_SHELL_OPACITY
        semiLayer.shellMaterial.opacity = SEMI_SHELL_OPACITY
        superLayer.shellMaterial.color.copy(superInitialShellColor)
        semiLayer.shellMaterial.color.copy(semiInitialShellColor)
        topo.root.visible = true
        topo.root.scale.setScalar(1)
        tuneProgress = 0
        setPhase('stacked')
        applyTunedAppearance(performance.now() / 1000)
        publishAnchorLayout()
        callbacks.onSnapComplete?.()
      }
    }

    const render = now => {
      if (disposed) return
      const deltaSeconds = clamp((now - lastFrameAt) / 1000, 0, 0.05)
      lastFrameAt = now
      const phaseElapsedMs = now - phaseStartedAt
      const elapsedSeconds = now / 1000

      if (phase === 'intro') updateIntro(deltaSeconds)
      if (phase === 'dragging') updateDragging(deltaSeconds)
      if (phase === 'returning') updateReturn(phaseElapsedMs)
      if (phase === 'snapping') updateSnap(phaseElapsedMs)

      const mergeProgress = phase === 'stacked'
        ? easeInOutCubic(tuneProgress)
        : 0
      superParticles.update(elapsedSeconds, mergeProgress)
      if (semiLayer.root.visible) semiParticles.update(elapsedSeconds, mergeProgress)

      if (phase === 'ready') {
        const reducedMotion = Boolean(reducedMotionQuery?.matches)
        const idleMotionTarget = !reducedMotion &&
          interactiveRequested &&
          materialFocusTarget === 0 &&
          semiconductorPresenceTarget > 0 &&
          semiconductorEntranceProgress >= 1
          ? 1
          : 0
        idleMotionStrength = reducedMotion
          ? 0
          : damp(
              idleMotionStrength,
              idleMotionTarget,
              3.8,
              deltaSeconds
            )
        const idleElapsedSeconds = idleMotionStartedAt === null
          ? 0
          : Math.max(0, now - idleMotionStartedAt) / 1000
        idlePullProgress = reducedMotion
          ? 0
          : assemblyIdlePullProgress(idleElapsedSeconds, idleMotionStrength)

        /* The shared lift makes the pair levitate as one gesture while their
           symmetric convergence reads as a pinch. Particles and the moving
           shadows provide the quieter ambient/secondary layers. */
        superLayer.root.position.lerpVectors(
          superOrigin,
          finalUpperPosition,
          idlePullProgress
        )
        semiLayer.root.position.lerpVectors(
          semiOrigin,
          finalLowerPosition,
          idlePullProgress
        )
        const pinchStrength = idlePullProgress / ASSEMBLY_IDLE_PULL_MAX_PROGRESS
        const hover = Math.sin(idleElapsedSeconds * 1.05) * 0.035 * idleMotionStrength
        const pinchLift = pinchStrength * 0.035
        superLayer.root.position.y += hover + pinchLift
        semiLayer.root.position.y += hover + pinchLift
        targetMaterial.opacity = damp(targetMaterial.opacity, 0, 7, deltaSeconds)
      }

      if (phase === 'ready' || phase === 'dragging' || phase === 'returning') {
        applyUnjoinedAppearance(deltaSeconds)
      }

      if (phase === 'stacked') applyTunedAppearance(elapsedSeconds, deltaSeconds)

      if (visible) {
        renderer.render(scene, camera)
        animationFrame = requestAnimationFrame(render)
      } else {
        animationFrame = null
      }
    }

    const onVisibilityChange = () => {
      const now = performance.now()
      visible = !document.hidden
      if (!visible) hiddenAt = now
      if (visible && hiddenAt !== null) {
        phaseStartedAt += now - hiddenAt
        hiddenAt = null
      }
      lastFrameAt = now
      if (!visible && animationFrame !== null) {
        cancelAnimationFrame(animationFrame)
        animationFrame = null
        return
      }
      if (visible && animationFrame === null) animationFrame = requestAnimationFrame(render)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    animationFrame = requestAnimationFrame(render)

    return {
      /* Keyboard and switch users activate the visible action cue instead of
         drawing a pointer path across the aria-hidden WebGL canvas. It enters
         the same reducer and snap animation as a valid drag. */
      combine() {
        if (!interactive || phase !== 'ready') return false
        callbacks.onDragStart?.()
        dragProgressTarget = 1
        finishDrag({ valid: true, distance: 0 })
        return true
      },
      setInteractive(value) {
        const nextInteractiveRequested = Boolean(value)
        if (nextInteractiveRequested && !interactiveRequested) {
          idleMotionStartedAt = performance.now()
        } else if (!nextInteractiveRequested) {
          idleMotionStartedAt = null
          idlePullProgress = 0
        }
        interactiveRequested = nextInteractiveRequested
        interactive = interactiveRequested &&
          phase === 'ready' &&
          semiconductorEntranceProgress >= 1
      },
      setTuneProgress(value) {
        const numericValue = Number(value)
        if (!Number.isFinite(numericValue)) return tuneProgress
        tuneProgress = clamp(numericValue, 0, 1)
        if (phase === 'stacked') {
          applyTunedAppearance(performance.now() / 1000)
        }
        return tuneProgress
      },
      setMaterialFocus(value) {
        materialFocusTarget = value === 'superconductor'
          ? -1
          : value === 'semiconductor'
            ? 1
            : 0
      },
      setSemiconductorVisible(value) {
        const nextTarget = value ? 1 : 0
        if (nextTarget > 0 && semiconductorPresenceTarget === 0) {
          semiconductorEntranceProgress = reducedMotionQuery?.matches ? 1 : 0
          semiconductorPresence = easeQubitMaterialEntrance(
            semiconductorEntranceProgress
          )
          semiLayer.root.position.copy(semiOrigin)
          semiLayer.root.position.y += MATERIAL_ENTRANCE_DISTANCE *
            qubitMaterialEntranceOffset(semiconductorEntranceProgress, -1)
          semiLayer.root.scale.setScalar(
            lerp(MATERIAL_ENTRANCE_SCALE, 1, semiconductorPresence)
          )
          semiLayer.shellMaterial.opacity =
            SEMI_SHELL_OPACITY * semiconductorPresence
          semiParticles.setOpacity(semiconductorPresence)
          semiLayer.root.visible = true
        } else if (nextTarget === 0) {
          semiconductorEntranceProgress = 0
          semiconductorPresence = 0
          semiLayer.root.position.copy(semiOrigin)
          semiLayer.root.position.y -= MATERIAL_ENTRANCE_DISTANCE
          semiLayer.root.scale.setScalar(MATERIAL_ENTRANCE_SCALE)
          semiLayer.shellMaterial.opacity = 0
          semiParticles.setOpacity(0)
          semiLayer.root.visible = false
        }
        semiconductorPresenceTarget = nextTarget
        materialPresentation.semiconductorPresence = semiconductorPresence
      },
      setTuningActive(value) {
        /* The dial this lift originally cleared no longer exists. Keep the
           joined material at its authored target so it remains centered under
           every closing-screen copy block. */
        tuningLiftTarget = value ? FINAL_PRESENTATION_LIFT : 0
      },
      skipIntro() {
        finishIntro({ notify: false })
      },
      restart() {
        if (activePointerId !== null) {
          try {
            renderer.domElement.releasePointerCapture?.(activePointerId)
          } catch {
            // Capture may already be gone if Restart followed a cancellation.
          }
        }
        activePointerId = null
        introFinished = false
        tuneProgress = 0
        materialFocusTarget = 0
        materialFocus = 0
        superEntranceProgress = 0
        semiconductorEntranceProgress = 0
        semiconductorPresenceTarget = 0
        semiconductorPresence = 0
        idleMotionStrength = 0
        idleMotionStartedAt = null
        idlePullProgress = 0
        materialPresentation.semiconductorPresence = 0
        materialPresentation.semiDim = 0
        materialPresentation.superDim = 0
        tuningLiftTarget = 0
        tuningLift = 0
        interactiveRequested = false
        interactive = false
        superLayer.root.visible = true
        semiLayer.root.visible = false
        topo.root.visible = false
        superLayer.shell.visible = true
        semiLayer.shell.visible = true
        topo.shell.visible = false
        topo.shellMaterial.opacity = 0
        superLayer.root.add(superParticles.group)
        semiLayer.root.add(semiParticles.group)
        superLayer.root.position.copy(superOrigin)
        semiLayer.root.position.copy(semiOrigin)
        superLayer.root.position.y += MATERIAL_ENTRANCE_DISTANCE
        semiLayer.root.position.y -= MATERIAL_ENTRANCE_DISTANCE
        topo.root.position.copy(topoTarget)
        superLayer.root.rotation.copy(BASE_ROTATION)
        semiLayer.root.rotation.copy(BASE_ROTATION)
        topo.root.rotation.copy(BASE_ROTATION)
        superLayer.root.scale.setScalar(MATERIAL_ENTRANCE_SCALE)
        semiLayer.root.scale.setScalar(MATERIAL_ENTRANCE_SCALE)
        topo.root.scale.setScalar(1)
        superLayer.shellMaterial.color.copy(superInitialShellColor)
        semiLayer.shellMaterial.color.copy(semiInitialShellColor)
        superLayer.shellMaterial.opacity = 0
        semiLayer.shellMaterial.opacity = 0
        superParticles.setOpacity(0)
        semiParticles.setOpacity(0)
        superParticles.group.position.set(0, 0, 0)
        semiParticles.group.position.set(0, 0, 0)
        superParticles.update(performance.now() / 1000, 0)
        semiParticles.update(performance.now() / 1000, 0)
        activeLayerId = null
        dragProgressTarget = 0
        pointerVelocity.set(0, 0)
        targetMaterial.opacity = 0
        topo.energyMaterial.uniforms.uOpacity.value = 0
        setPhase('intro')
        publishAnchorLayout()
      },
      dispose() {
        if (disposed) return
        disposed = true
        unregisterLights?.()
        if (animationFrame !== null) cancelAnimationFrame(animationFrame)
        resizeObserver?.disconnect()
        document.removeEventListener('visibilitychange', onVisibilityChange)
        renderer.domElement.removeEventListener('pointerdown', onPointerDown)
        renderer.domElement.removeEventListener('pointermove', onPointerMove)
        renderer.domElement.removeEventListener('pointerup', releasePointer)
        renderer.domElement.removeEventListener('pointercancel', onPointerCancel)
        renderer.domElement.removeEventListener('lostpointercapture', onLostPointerCapture)
        targetGeometry.dispose()
        targetMaterial.dispose()
        grid.geometry.dispose()
        grid.material.dispose()
        superLayer.dispose()
        semiLayer.dispose()
        topo.dispose()
        rendererLease.release()
      }
    }
  } catch (error) {
    unregisterLights?.()
    rendererLease.release()
    throw error
  }
}
