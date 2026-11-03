/*
 * Interactive water-steam volume for the gas state.
 *
 * The solver is adapted from Three.js' MIT-licensed WebGPU volumetric fire
 * example, reduced to the parts this screen needs: semi-Lagrangian advection,
 * buoyancy, curl-noise turbulence and Jacobi pressure projection. The fire
 * emitter and shading are deliberately replaced with a low, irregular bank of
 * white vapor sources so the result reads as water evaporating from puddles.
 *
 * https://threejs.org/examples/webgpu_volume_fire.html
 */
import {
  calculateStageAwarePixelRatio,
  elementCssScale
} from '../../core/three-render-budget.js'

const GRID_X = 48
const GRID_Y = 72
const GRID_Z = 28
const CELL_COUNT = GRID_X * GRID_Y * GRID_Z
const PRESSURE_ITERATIONS = 2
const TARGET_FPS = 24
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS
const MAX_RENDER_PIXELS = 720_000

const VIEW_HEIGHT = 14
/* The 2160 × 3840 camera sees 7.875 × 14 world units. Keep the volume
   slightly larger than that frustum so its box boundary never becomes a clear
   frame along the left, right or bottom edge of the gas state. */
const VOLUME_WIDTH = 8.2
const VOLUME_HEIGHT = 14.4
const VOLUME_DEPTH = 4
const VOLUME_CENTER_Y = 0

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0))
}

/**
 * @returns {Promise<object|null>} null when the machine cannot run WebGPU compute
 */
export async function mountVolumetricSteam(canvas, { element: hostElement } = {}) {
  /* Reassignable so dispose can drop it: Chromium retains the WebGPU renderer
     after teardown, and anything this closure still points at rides along. */
  let element = hostElement
  if (!canvas) return null

  const [THREE, TSL, curlNoiseModule, webGpuModule] = await Promise.all([
    import('three/webgpu'),
    import('three/tsl'),
    import('three/addons/tsl/math/curlNoise.js'),
    import('three/addons/capabilities/WebGPU.js')
  ])
  const WebGPU = webGpuModule.default
  if (!WebGPU?.isAvailable?.()) return null

  const {
    Fn,
    If,
    float,
    vec3,
    vec4,
    uvec3,
    uniform,
    texture3D,
    textureStore,
    storageTexture,
    instanceIndex,
    smoothstep,
    min,
    max,
    sin,
    fract,
    interleavedGradientNoise,
    screenCoordinate,
    frameId
  } = TSL
  const { snoiseVec3 } = curlNoiseModule

  const volumeSize = new THREE.Vector3(VOLUME_WIDTH, VOLUME_HEIGHT, VOLUME_DEPTH)
  const volumeCenter = new THREE.Vector3(0, VOLUME_CENTER_Y, 0)
  const uVolumeSize = uniform(volumeSize)
  const uVolumeCenter = uniform(volumeCenter)
  const uDt = uniform(1 / 30)
  const uTime = uniform(0)
  const uSteamWeight = uniform(0)
  /* Simulation population is independent from reveal opacity. It starts when
     the host screen reports ready, so Gas reveals an established plume. */
  const uEmissionWeight = uniform(0)
  const uBuoyancy = uniform(2.35)
  const uDensityWeight = uniform(0.035)
  const uTurbulence = uniform(1.85)
  const uVelocityDamping = uniform(0.32)
  /* Hold a little more vapor in the volume so the gas reads as a continuous
     body, while retaining enough dissipation for pointer swipes to carve it. */
  const uDissipation = uniform(0.62)
  const uCooling = uniform(0.3)
  const uEmission = uniform(5.4)
  const uHeat = uniform(2.15)
  const uPointerPreviousPosition = uniform(new THREE.Vector3(0, 0, 0))
  const uPointerPosition = uniform(new THREE.Vector3(0, 0, 0))
  const uPointerVelocity = uniform(new THREE.Vector3())
  const uPointerImpulse = uniform(0)
  const uPointerRadius = uniform(1.2)

  const createStorage3D = name => {
    const texture = new THREE.Storage3DTexture(GRID_X, GRID_Y, GRID_Z)
    texture.name = name
    texture.format = THREE.RGBAFormat
    texture.type = THREE.HalfFloatType
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.wrapR = THREE.ClampToEdgeWrapping
    return texture
  }

  const velocityA = createStorage3D('steam velocity A')
  const velocityB = createStorage3D('steam velocity B')
  const dyeA = createStorage3D('steam density A')
  const dyeB = createStorage3D('steam density B')
  const divergenceTexture = createStorage3D('steam divergence')
  const pressureA = createStorage3D('steam pressure A')
  const pressureB = createStorage3D('steam pressure B')
  const curlNoiseTexture = createStorage3D('steam curl noise')
  curlNoiseTexture.wrapS = THREE.RepeatWrapping
  curlNoiseTexture.wrapT = THREE.RepeatWrapping
  curlNoiseTexture.wrapR = THREE.RepeatWrapping

  const dyeRead = texture3D(dyeA)
  const dyeWrite = storageTexture(dyeB).toWriteOnly()
  const curlNoise = texture3D(curlNoiseTexture)

  const getVoxelCoord = id => uvec3(
    id.mod(GRID_X),
    id.div(GRID_X).mod(GRID_Y),
    id.div(GRID_X * GRID_Y)
  )
  const coordToUvw = coord => vec3(coord).add(0.5).div(vec3(GRID_X, GRID_Y, GRID_Z))

  const computeCurlNoise = Fn(() => {
    const coord = getVoxelCoord(instanceIndex)
    const uvw = coordToUvw(coord)
    const frequency = float(7.2)
    const epsilon = float(0.1).div(frequency)
    const dx = vec3(epsilon, 0, 0)
    const dy = vec3(0, epsilon, 0)
    const dz = vec3(0, 0, epsilon)
    const p = uvw.mul(vec3(VOLUME_WIDTH / VOLUME_HEIGHT, 1, VOLUME_DEPTH / VOLUME_HEIGHT))
    const px0 = snoiseVec3(p.sub(dx).mul(frequency))
    const px1 = snoiseVec3(p.add(dx).mul(frequency))
    const py0 = snoiseVec3(p.sub(dy).mul(frequency))
    const py1 = snoiseVec3(p.add(dy).mul(frequency))
    const pz0 = snoiseVec3(p.sub(dz).mul(frequency))
    const pz1 = snoiseVec3(p.add(dz).mul(frequency))
    const curl = vec3(
      py1.z.sub(py0.z).sub(pz1.y).add(pz0.y),
      pz1.x.sub(pz0.x).sub(px1.z).add(px0.z),
      px1.y.sub(px0.y).sub(py1.x).add(py0.x)
    ).mul(5)
    textureStore(curlNoiseTexture, coord, vec4(curl, 0)).toWriteOnly()
  })().compute(CELL_COUNT).setName('steam curl noise')

  const advectVelocity = Fn(() => {
    const coord = getVoxelCoord(instanceIndex)
    const uvw = coordToUvw(coord)
    const velocity = texture3D(velocityA, uvw, 0).xyz
    const previous = uvw.sub(velocity.div(uVolumeSize).mul(uDt))
    const nextVelocity = texture3D(velocityA, previous, 0).xyz.toVar()
    const dye = dyeRead.sample(uvw).level(0)
    const density = dye.r
    const temperature = dye.g

    const lift = temperature.mul(uBuoyancy).sub(density.mul(uDensityWeight))
    nextVelocity.addAssign(vec3(0, lift.mul(VOLUME_HEIGHT), 0).mul(uDt))

    const curlUv = uvw.add(vec3(
      uTime.mul(0.024),
      uTime.mul(-0.072),
      uTime.mul(0.018)
    ))
    const curl = curlNoise.sample(curlUv).level(0).xyz
    const turbulencePresence = density.mul(0.75).add(temperature.mul(0.45)).clamp(0, 1)
    nextVelocity.addAssign(
      curl.mul(uTurbulence).mul(turbulencePresence).mul(VOLUME_HEIGHT).mul(uDt)
    )

    const worldPosition = uvw.sub(0.5).mul(uVolumeSize).add(uVolumeCenter)
    /* Treat the complete swipe segment as a wind tunnel through the volume's
       depth. Fast fingers therefore carve and carry the plume along their path
       instead of only disturbing a small spot at the latest event position. */
    const windStart = uPointerPreviousPosition.xy
    const windSegment = uPointerPosition.xy.sub(windStart)
    const segmentLengthSq = max(windSegment.dot(windSegment), 0.0001)
    const segmentT = worldPosition.xy.sub(windStart)
      .dot(windSegment)
      .div(segmentLengthSq)
      .clamp(0, 1)
    const closestWindPoint = windStart.add(windSegment.mul(segmentT))
    const pointerDistance = worldPosition.xy.distance(closestWindPoint)
    If(pointerDistance.lessThan(uPointerRadius), () => {
      const falloff = float(1).sub(smoothstep(0, uPointerRadius, pointerDistance))
      const rollingWake = vec3(
        uPointerVelocity.y.negate(),
        uPointerVelocity.x,
        uPointerVelocity.z
      ).mul(0.35)
      nextVelocity.addAssign(
        uPointerVelocity.add(rollingWake)
          .mul(falloff)
          .mul(uPointerImpulse)
          .mul(0.2)
      )
    })

    nextVelocity.mulAssign(max(float(1).sub(uVelocityDamping.mul(uDt)), 0))
    const edge = min(uvw, vec3(1).sub(uvw))
    const boundary = smoothstep(0, 0.065, min(edge.x, min(edge.y, edge.z)))
    nextVelocity.mulAssign(boundary)
    textureStore(velocityB, coord, vec4(nextVelocity, 0)).toWriteOnly()
  })().compute(CELL_COUNT).setName('steam advect velocity')

  const divergencePass = Fn(() => {
    const coord = getVoxelCoord(instanceIndex)
    const uvw = coordToUvw(coord)
    const right = texture3D(velocityB, uvw.add(vec3(1 / GRID_X, 0, 0)), 0).x
    const left = texture3D(velocityB, uvw.sub(vec3(1 / GRID_X, 0, 0)), 0).x
    const up = texture3D(velocityB, uvw.add(vec3(0, 1 / GRID_Y, 0)), 0).y
    const down = texture3D(velocityB, uvw.sub(vec3(0, 1 / GRID_Y, 0)), 0).y
    const front = texture3D(velocityB, uvw.add(vec3(0, 0, 1 / GRID_Z)), 0).z
    const back = texture3D(velocityB, uvw.sub(vec3(0, 0, 1 / GRID_Z)), 0).z
    const divergence = right.sub(left).add(up.sub(down)).add(front.sub(back)).mul(0.5)
    textureStore(divergenceTexture, coord, vec4(divergence, 0, 0, 0)).toWriteOnly()
  })().compute(CELL_COUNT).setName('steam divergence')

  const makeJacobiPass = (readTexture, writeTexture, name) => Fn(() => {
    const coord = getVoxelCoord(instanceIndex)
    const uvw = coordToUvw(coord)
    const right = texture3D(readTexture, uvw.add(vec3(1 / GRID_X, 0, 0)), 0).x
    const left = texture3D(readTexture, uvw.sub(vec3(1 / GRID_X, 0, 0)), 0).x
    const up = texture3D(readTexture, uvw.add(vec3(0, 1 / GRID_Y, 0)), 0).x
    const down = texture3D(readTexture, uvw.sub(vec3(0, 1 / GRID_Y, 0)), 0).x
    const front = texture3D(readTexture, uvw.add(vec3(0, 0, 1 / GRID_Z)), 0).x
    const back = texture3D(readTexture, uvw.sub(vec3(0, 0, 1 / GRID_Z)), 0).x
    const divergence = texture3D(divergenceTexture, uvw, 0).x
    const pressure = right.add(left).add(up).add(down).add(front).add(back).sub(divergence).div(6)
    textureStore(writeTexture, coord, vec4(pressure, 0, 0, 0)).toWriteOnly()
  })().compute(CELL_COUNT).setName(name)

  const jacobiAB = makeJacobiPass(pressureA, pressureB, 'steam pressure AB')
  const jacobiBA = makeJacobiPass(pressureB, pressureA, 'steam pressure BA')

  const projectVelocity = Fn(() => {
    const coord = getVoxelCoord(instanceIndex)
    const uvw = coordToUvw(coord)
    const right = texture3D(pressureA, uvw.add(vec3(1 / GRID_X, 0, 0)), 0).x
    const left = texture3D(pressureA, uvw.sub(vec3(1 / GRID_X, 0, 0)), 0).x
    const up = texture3D(pressureA, uvw.add(vec3(0, 1 / GRID_Y, 0)), 0).x
    const down = texture3D(pressureA, uvw.sub(vec3(0, 1 / GRID_Y, 0)), 0).x
    const front = texture3D(pressureA, uvw.add(vec3(0, 0, 1 / GRID_Z)), 0).x
    const back = texture3D(pressureA, uvw.sub(vec3(0, 0, 1 / GRID_Z)), 0).x
    const gradient = vec3(right.sub(left), up.sub(down), front.sub(back)).mul(0.5)
    const velocity = texture3D(velocityB, uvw, 0).xyz.sub(gradient)
    textureStore(velocityA, coord, vec4(velocity, 0)).toWriteOnly()
  })().compute(CELL_COUNT).setName('steam project velocity')

  const advectDye = Fn(() => {
    const coord = getVoxelCoord(instanceIndex)
    const uvw = coordToUvw(coord)
    const velocity = texture3D(velocityA, uvw, 0).xyz
    const previous = uvw.sub(velocity.div(uVolumeSize).mul(uDt))
    const dye = dyeRead.sample(previous).level(0)
    const density = dye.r.mul(max(float(1).sub(uDissipation.mul(uDt)), 0)).toVar()
    const temperature = dye.g.mul(max(float(1).sub(uCooling.mul(uDt)), 0)).toVar()
    const age = dye.b.add(uDt).toVar()

    const sourceBlob = (x, z, radiusX, radiusZ, phase) => {
      const sway = sin(uTime.mul(0.73).add(phase)).mul(0.012)
      const offset = vec3(
        uvw.x.sub(float(x).add(sway)).div(radiusX),
        uvw.y.sub(0.028).div(0.04),
        uvw.z.sub(z).div(radiusZ)
      )
      return float(1).sub(smoothstep(0.28, 1, offset.dot(offset)))
    }

    /* Uneven, overlapping sources read as a wet footprint instead of burners. */
    const source = max(
      max(sourceBlob(0.13, 0.42, 0.085, 0.17, 0.2), sourceBlob(0.32, 0.62, 0.105, 0.14, 1.7)),
      max(
        sourceBlob(0.5, 0.38, 0.125, 0.19, 3.1),
        max(sourceBlob(0.69, 0.58, 0.1, 0.155, 4.6), sourceBlob(0.87, 0.43, 0.08, 0.175, 5.8))
      )
    )
    const breath = sin(uTime.mul(1.13).add(uvw.x.mul(17)).add(uvw.z.mul(9)))
      .mul(0.16).add(0.84)
    const emission = source.mul(breath).mul(uEmissionWeight).mul(uDt)
    density.addAssign(emission.mul(uEmission))
    temperature.addAssign(emission.mul(uHeat))
    density.assign(density.clamp(0, 4.5))
    temperature.assign(temperature.clamp(0, 3))
    If(source.greaterThan(0.04), () => {
      age.assign(age.mul(float(1).sub(source.mul(0.7))))
    })
    textureStore(dyeWrite, coord, vec4(density, temperature, age, 1)).toWriteOnly()
  })().compute(CELL_COUNT).setName('steam advect density')

  let renderer = null
  try {
    renderer = new THREE.WebGPURenderer({ canvas, antialias: false, alpha: false })
    renderer.setClearColor(0x000000, 1)
    renderer.toneMapping = THREE.NoToneMapping
    await renderer.init()
  } catch {
    renderer?.dispose?.()
    return null
  }

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-4, 4, 7, -7, 0.1, 50)
  camera.position.set(0, 0, 15)
  camera.lookAt(0, 0, 0)

  const material = new THREE.VolumeNodeMaterial()
  material.steps = 40
  material.transparent = true
  material.blending = THREE.AdditiveBlending
  material.depthWrite = false
  material.offsetNode = fract(
    interleavedGradientNoise(screenCoordinate).add(float(frameId).mul(0.618033988749895))
  )

  const sampleSteam = positionRay => {
    const uvw = positionRay.sub(uVolumeCenter).div(uVolumeSize).add(0.5).toVar()
    const velocityWarp = texture3D(velocityA, uvw, 0).xyz.div(uVolumeSize).mul(0.12)
    const distorted = uvw.add(velocityWarp).clamp(0, 1).toVar()
    const sample = dyeRead.sample(distorted).level(0)
    const density = sample.r.mul(uSteamWeight).toVar()
    const detailUv = distorted.mul(2.35).add(vec3(
      uTime.mul(0.018),
      uTime.mul(-0.05),
      uTime.mul(0.013)
    ))
    const detail = curlNoise.sample(detailUv).level(0).x
    density.mulAssign(detail.mul(detail).mul(0.3).add(0.9))
    const edge = min(distorted, vec3(1).sub(distorted))
    density.mulAssign(smoothstep(0, 0.055, min(edge.x, min(edge.y, edge.z))))
    return density
  }

  material.scatteringNode = Fn(({ positionRay }) => {
    const density = sampleSteam(positionRay)
    return vec3(density.mul(5.9))
  })
  material.scatteringEmissiveNode = Fn(({ positionRay }) => {
    const density = sampleSteam(positionRay)
    return vec3(1, 1, 1).mul(density.mul(6.8))
  })

  const geometry = new THREE.BoxGeometry(VOLUME_WIDTH, VOLUME_HEIGHT, VOLUME_DEPTH)
  const volume = new THREE.Mesh(geometry, material)
  volume.position.copy(volumeCenter)
  volume.frustumCulled = false
  scene.add(volume)

  const softLight = new THREE.PointLight(0xffffff, 2.4, 30, 1.5)
  softLight.position.set(-1.8, 5.5, 6)
  scene.add(softLight)

  await renderer.computeAsync(computeCurlNoise)

  let disposed = false
  let animationFrame = 0
  let lastFrameAt = 0
  let steamWeight = 0
  let pointerImpulse = 0
  let activeUntil = 0
  let idleFrameDrawn = false
  let warmupStepsRemaining = 0

  const resize = () => {
    if (disposed) return
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width < 2 || height < 2) return
    const aspect = width / height
    camera.left = -(VIEW_HEIGHT * aspect) * 0.5
    camera.right = (VIEW_HEIGHT * aspect) * 0.5
    camera.top = VIEW_HEIGHT * 0.5
    camera.bottom = -VIEW_HEIGHT * 0.5
    camera.updateProjectionMatrix()
    renderer.setPixelRatio(calculateStageAwarePixelRatio({
      width,
      height,
      cssScale: element ? elementCssScale(element) : 1,
      devicePixelRatio: window.devicePixelRatio || 1,
      maxRenderPixels: MAX_RENDER_PIXELS,
      minPixelRatio: 0.2,
      maxPixelRatio: 0.55
    }))
    renderer.setSize(width, height, false)
    canvas.style.width = '100%'
    canvas.style.height = '100%'
  }

  const runSimulationStep = delta => {
    uDt.value = Math.min(1 / 30, Math.max(1 / 120, delta))
    renderer.compute(advectVelocity)
    renderer.compute(divergencePass)
    for (let index = 0; index < PRESSURE_ITERATIONS; index += 1) {
      renderer.compute(index % 2 === 0 ? jacobiAB : jacobiBA)
    }
    renderer.compute(projectVelocity)
    renderer.compute(advectDye)
    const previous = dyeRead.value
    dyeRead.value = dyeWrite.value
    dyeWrite.value = previous
  }

  const render = now => {
    if (disposed) return
    animationFrame = window.requestAnimationFrame(render)
    if (document.hidden || now - lastFrameAt < FRAME_INTERVAL_MS) return

    const delta = lastFrameAt === 0 ? 1 / TARGET_FPS : Math.min(0.05, (now - lastFrameAt) / 1000)
    lastFrameAt = now
    uTime.value = (uTime.value + delta) % 1000
    pointerImpulse *= Math.exp(-delta * 2.8)
    uPointerImpulse.value = pointerImpulse

    const active = uEmissionWeight.value > 0.001 ||
      steamWeight > 0.001 ||
      pointerImpulse > 0.001 ||
      now < activeUntil
    if (active) {
      runSimulationStep(delta)
      /* Build roughly two seconds of plume during the first second after media
         initialization, without blocking the screen's own startup. */
      if (warmupStepsRemaining > 0) {
        runSimulationStep(delta)
        warmupStepsRemaining -= 1
      }
      idleFrameDrawn = false
    } else if (idleFrameDrawn) {
      return
    }
    renderer.render(scene, camera)
    idleFrameDrawn = !active
  }

  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvas)
  window.addEventListener('resize', resize)
  resize()
  animationFrame = window.requestAnimationFrame(render)

  return Object.freeze({
    start() {
      if (disposed || uEmissionWeight.value > 0.001) return
      uEmissionWeight.value = 1
      warmupStepsRemaining = 30
      activeUntil = performance.now() + 1800
      idleFrameDrawn = false
    },
    setWeight(value) {
      if (disposed) return
      const next = clamp01(value)
      if (next <= 0.001 && steamWeight > 0.001) activeUntil = performance.now() + 4200
      if (next > 0.001) activeUntil = performance.now() + 600
      steamWeight = next
      uSteamWeight.value = next
      idleFrameDrawn = false
    },
    stir({ x, y, dx = 0, dy = 0, bounds } = {}) {
      if (disposed || steamWeight < 0.02 || !bounds?.width || !bounds?.height) return
      const nx = clamp01((x - bounds.left) / bounds.width)
      const ny = clamp01((y - bounds.top) / bounds.height)
      const previousNx = clamp01(((x - dx) - bounds.left) / bounds.width)
      const previousNy = clamp01(((y - dy) - bounds.top) / bounds.height)
      const viewWidth = VIEW_HEIGHT * (bounds.width / bounds.height)
      uPointerPreviousPosition.value.set(
        (previousNx - 0.5) * viewWidth,
        (0.5 - previousNy) * VIEW_HEIGHT,
        0
      )
      uPointerPosition.value.set(
        (nx - 0.5) * viewWidth,
        (0.5 - ny) * VIEW_HEIGHT,
        0
      )
      const velocityX = (dx / bounds.width) * viewWidth * TARGET_FPS * 14
      const velocityY = (-dy / bounds.height) * VIEW_HEIGHT * TARGET_FPS * 14
      uPointerVelocity.value.set(velocityX, velocityY, velocityX * -0.18)
      if (uPointerVelocity.value.length() > 44) uPointerVelocity.value.setLength(44)
      const travel = Math.hypot(dx / bounds.width, dy / bounds.height)
      const gust = travel > 0.00005 ? Math.max(0.85, travel * 65) : 0
      pointerImpulse = Math.min(2.4, Math.max(pointerImpulse, gust))
      uPointerImpulse.value = pointerImpulse
      activeUntil = performance.now() + 900
    },
    dispose() {
      if (disposed) return
      disposed = true
      window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      window.removeEventListener('resize', resize)
      geometry.dispose()
      material.dispose()
      ;[
        velocityA,
        velocityB,
        dyeA,
        dyeB,
        divergenceTexture,
        pressureA,
        pressureB,
        curlNoiseTexture
      ].forEach(texture => texture.dispose())
      renderer.dispose()
      /* Chromium keeps the WebGPU renderer alive past dispose (see
         runtime-policy.js). The renderer owns its canvas, and while that canvas
         is still in the tree the parentNode chain reaches the whole States of
         Matter screen — so a retained renderer pins ~291 DOM nodes per visit.
         Detaching the canvas and dropping the host reference leaves the
         retained renderer holding one orphaned element and nothing else. */
      canvas.remove()
      element = null
    }
  })
}
