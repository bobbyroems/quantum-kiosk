import { assetUrl } from '../../core/asset-url.js'
import { createFrostShell } from '../../core/error-correction-ball.js'
import {
  aimCropAtSphere,
  applyCropToTree,
  createCropUniforms,
  CROP_COVERAGE,
  CROP_VARYINGS
} from '../../core/sphere-crop.js'
import {
  getProtectionEffectDrives,
  PROTECTION_PARAMETERS
} from './protecting-information-state.js'
import { THERMAL_MOTION_PROFILE } from './protecting-information-physics.js'
import { MeshoptDecoder } from './meshopt-decoder.js'

export const PROTECTION_MENU_LOOP_SECONDS = 9.6
export const PROTECTION_MENU_PARTICLE_COUNT = 1024
export const PROTECTION_MENU_MODEL_PATH =
  'assets/modules/protecting-information/protect-quantum-information.glb'

const TAU = Math.PI * 2
const PROCESSOR_WIDTH = 2.58
const PROCESSOR_SURFACE_Y = 0.104

export async function loadProtectionMenuModel({ GLTFLoader }) {
  if (typeof GLTFLoader !== 'function') throw new TypeError('GLTFLoader is required')
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  const gltf = await loader.loadAsync(assetUrl(PROTECTION_MENU_MODEL_PATH))
  if (!gltf?.scene) throw new Error('Protecting Information navigation model has no scene')
  return gltf.scene
}

const clamp = (value, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, Number(value) || 0))
const clamp01 = value => clamp(value)
const mix = (from, to, progress) => from + ((to - from) * progress)

function targetCenterTurn(parameterId) {
  const { startDeg, endDeg } = PROTECTION_PARAMETERS[parameterId].targetArc
  return ((startDeg + endDeg) / 2) / 360
}

export const PROTECTION_MENU_TARGET_VALUES = Object.freeze({
  temperature: targetCenterTurn('temperature'),
  voltage: targetCenterTurn('voltage'),
  magnetic: targetCenterTurn('magnetic')
})

/*
 * The containing sphere's tint. Deliberately not the topoconductor card's pale blue:
 * two adjacent cards in the same carousel, both presenting a circle, read as the same
 * card twice when the circles match. A pale violet also sits better against this
 * device, which is dark navy and gold — a warm subject wants a cooler surround than
 * the indigo wafers next door do.
 *
 * No convertSRGBToLinear on this: the shell shader writes gl_FragColor with no
 * colourspace chunk, so whatever goes in comes straight out, and a linearised tint
 * reads as dark navy rather than soft violet.
 */
export const PROTECTION_MENU_SHELL_TINT = '#cfc9e6'

/*
 * The card's ambient loop.
 *
 * This used to replay the experience's own 9.6-second story on the menu: temperature
 * ramping up and back down, voltage sweeping in and overdriving, the magnetic phase
 * arriving and leaving. That is a narrative with a beginning and an end, and a card
 * that keeps restarting it reads as a trailer for the module rather than as an object
 * sitting there. So the device is simply held in the settled protected state the story
 * ends on, and the only thing that moves is the electron field.
 *
 * Everything the ramps used to compute — the piecewise temperature/voltage/magnetic
 * curves, and the integrated thermal phase that kept the drift continuous while the
 * temperature changed — is gone with them. Nothing ramps any more, so a plain wrapping
 * phase is exactly right, and it closes its own seam by construction.
 */
export function sampleProtectionMenuAmbient(seconds, { reducedMotion = false } = {}) {
  const safeSeconds = Number.isFinite(seconds) ? seconds : 0
  /* Reduced motion is one frame, so time must not reach any of it — pinning only the
     thermal phase still let `cycle` and `loopSeconds` advance. */
  const drift = reducedMotion
    ? 0
    : ((safeSeconds / PROTECTION_MENU_LOOP_SECONDS) % 1 + 1) % 1
  return {
    loopSeconds: drift * PROTECTION_MENU_LOOP_SECONDS,
    cycle: drift,
    temperatureValue: PROTECTION_MENU_TARGET_VALUES.temperature,
    voltageValue: PROTECTION_MENU_TARGET_VALUES.voltage,
    magneticValue: PROTECTION_MENU_TARGET_VALUES.magnetic,
    ...getProtectionEffectDrives(PROTECTION_MENU_TARGET_VALUES),
    /* The one moving value. Held still under reduced motion, at the same offset the
       old loop parked at, so that frame is unchanged. */
    thermalPhase: reducedMotion ? 0.18 : drift,
    reducedMotion
  }
}

/** Mirrors the integer harmonics in the GPU particle shader for seam verification. */
export function sampleProtectionMenuParticleOffset(state, {
  phase = 0,
  harmonic = 1,
  xAmplitude = 1,
  zAmplitude = 1
} = {}) {
  const thermalAmplitude = mix(
    THERMAL_MOTION_PROFILE.agitatedAmplitude,
    THERMAL_MOTION_PROFILE.settledAmplitude,
    clamp01(state?.temperature)
  )
  const travel = clamp01(state?.thermalPhase) * TAU * Math.max(1, Math.round(harmonic))
  return {
    x: Math.sin(travel + phase) * xAmplitude * thermalAmplitude,
    y: Math.sin((travel * 2) + phase) * 0.0125 * thermalAmplitude,
    z: Math.cos((travel * 3) - phase) * zAmplitude * thermalAmplitude
  }
}

function seededRandom(seed) {
  let value = seed >>> 0
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0
    return value / 4294967296
  }
}

function setInstances(THREE, mesh, transforms) {
  const dummy = new THREE.Object3D()
  transforms.forEach((transform, index) => {
    dummy.position.set(...transform.position)
    dummy.rotation.set(...(transform.rotation || [0, 0, 0]))
    dummy.scale.set(...(transform.scale || [1, 1, 1]))
    dummy.updateMatrix()
    mesh.setMatrixAt(index, dummy.matrix)
  })
  mesh.instanceMatrix.needsUpdate = true
}

function createParticleGeometry(THREE, radius) {
  const bathCount = 640
  const voltageCount = 256
  const reserveCount = PROTECTION_MENU_PARTICLE_COUNT - bathCount - voltageCount
  const random = seededRandom(58921)
  const basePosition = new Float32Array(PROTECTION_MENU_PARTICLE_COUNT * 3)
  const thermal = new Float32Array(PROTECTION_MENU_PARTICLE_COUNT * 4)
  const voltageDisplacement = new Float32Array(PROTECTION_MENU_PARTICLE_COUNT * 3)
  const magneticDisplacement = new Float32Array(PROTECTION_MENU_PARTICLE_COUNT * 3)
  const role = new Float32Array(PROTECTION_MENU_PARTICLE_COUNT)
  const wireZ = [-0.2 * radius, 0.2 * radius]
  let particleIndex = 0

  const writeParticle = ({
    particleRole,
    x,
    y,
    z,
    voltageX = x,
    voltageY = y,
    voltageZ = z,
    magneticX = x,
    magneticY = y,
    magneticZ = z,
    thermalScale = 1
  }) => {
    const positionOffset = particleIndex * 3
    const thermalOffset = particleIndex * 4
    basePosition.set([x, y, z], positionOffset)
    voltageDisplacement.set([
      voltageX - x,
      voltageY - y,
      voltageZ - z
    ], positionOffset)
    magneticDisplacement.set([
      magneticX - x,
      magneticY - y,
      magneticZ - z
    ], positionOffset)
    thermal.set([
      random() * TAU,
      1 + Math.floor(random() * 3),
      radius * (0.022 + (random() * 0.04)) * (random() < 0.5 ? -1 : 1) * thermalScale,
      radius * (0.018 + (random() * 0.035)) * (random() < 0.5 ? -1 : 1) * thermalScale
    ], thermalOffset)
    role[particleIndex] = particleRole
    particleIndex += 1
  }

  const bathColumns = 32
  const bathRows = bathCount / bathColumns
  for (let index = 0; index < bathCount; index += 1) {
    const column = index % bathColumns
    const row = Math.floor(index / bathColumns)
    writeParticle({
      particleRole: 0,
      x: radius * (-1.18 + (((column + (random() * 0.86) + 0.07) / bathColumns) * 2.36)),
      y: radius * (PROCESSOR_SURFACE_Y + 0.018 + ((random() - 0.5) * 0.026)),
      z: radius * (-0.68 + (((row + (random() * 0.86) + 0.07) / bathRows) * 1.36))
    })
  }

  for (let index = 0; index < voltageCount; index += 1) {
    const lane = index % 2
    const x = radius * (-0.94 + (random() * 1.88))
    const y = radius * (PROCESSOR_SURFACE_Y + 0.024 + ((random() - 0.5) * 0.018))
    const z = wireZ[lane] + ((random() - 0.5) * radius * 0.115)
    const side = x < 0 ? -1 : 1
    writeParticle({
      particleRole: 1,
      x,
      y,
      z,
      voltageX: side * radius * (1.08 + (random() * 0.18)),
      voltageY: y,
      voltageZ: z + ((random() - 0.5) * radius * 0.06),
      thermalScale: 0.72
    })
  }

  const pairsPerRow = reserveCount / 4
  for (let row = 0; row < 2; row += 1) {
    for (let pair = 0; pair < pairsPerRow; pair += 1) {
      const pairX = radius * (-0.72 + ((pair / (pairsPerRow - 1)) * 1.44))
      for (const member of [-1, 1]) {
        const x = radius * (-0.78 + (random() * 1.56))
        const y = radius * (PROCESSOR_SURFACE_Y + 0.032 + ((random() - 0.5) * 0.014))
        const z = wireZ[row] + ((random() - 0.5) * radius * 0.09)
        writeParticle({
          particleRole: 2,
          x,
          y,
          z,
          magneticX: pairX + (member * radius * 0.027),
          magneticY: radius * (PROCESSOR_SURFACE_Y + 0.038),
          magneticZ: wireZ[row],
          thermalScale: 0.35
        })
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(basePosition, 3))
  geometry.setAttribute('aThermal', new THREE.BufferAttribute(thermal, 4))
  geometry.setAttribute('aVoltageDisplacement', new THREE.BufferAttribute(voltageDisplacement, 3))
  geometry.setAttribute('aMagneticDisplacement', new THREE.BufferAttribute(magneticDisplacement, 3))
  geometry.setAttribute('aRole', new THREE.BufferAttribute(role, 1))
  geometry.computeBoundingSphere()
  if (geometry.boundingSphere) geometry.boundingSphere.radius += radius * 0.3
  return geometry
}

function createParticleMaterial(THREE, crop) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uThermalPhase: { value: 0.18 },
      uTemperature: { value: 0 },
      uVoltage: { value: 0 },
      uMagnetic: { value: 0 },
      /* Shared by reference with every other cropped surface in this scene. */
      uClipRadius: crop.uClipRadius,
      uClipCenter: crop.uClipCenter
    },
    vertexShader: /* glsl */ `
      attribute vec4 aThermal;
      attribute vec3 aVoltageDisplacement;
      attribute vec3 aMagneticDisplacement;
      attribute float aRole;
      uniform float uThermalPhase;
      uniform float uTemperature;
      uniform float uVoltage;
      uniform float uMagnetic;
      uniform float uClipRadius;
      uniform vec3 uClipCenter;
      varying float vReserve;
      varying float vCropCoverage;
      ${CROP_VARYINGS}
      ${CROP_COVERAGE}

      void main() {
        float thermalAmplitude = mix(
          ${THERMAL_MOTION_PROFILE.agitatedAmplitude.toFixed(2)},
          ${THERMAL_MOTION_PROFILE.settledAmplitude.toFixed(2)},
          clamp(uTemperature, 0.0, 1.0)
        );
        float travel = uThermalPhase * 6.28318530718 * aThermal.y;
        vec3 thermalNoise = vec3(
          sin(travel + aThermal.x) * aThermal.z,
          sin((travel * 2.0) + aThermal.x) * 0.0125,
          cos((travel * 3.0) - aThermal.x) * aThermal.w
        ) * thermalAmplitude;
        vec3 transformed = position + thermalNoise +
          (aVoltageDisplacement * uVoltage) +
          (aMagneticDisplacement * uMagnetic);
        vReserve = step(1.5, aRole) * uMagnetic;
        /* Cropped by hand: this shader is authored here, so it has no include hooks
           for the shared patcher to reach. Coverage is taken at the point's displaced
           position and pulled in slightly, because sprites are squares centred on the
           vertex and one just inside the rim would leave half a square hanging out. */
        vClipViewCenter = (viewMatrix * vec4(uClipCenter, 1.0)).xyz;
        vClipViewPos = (viewMatrix * modelMatrix * vec4(transformed, 1.0)).xyz;
        vClipViewRadius = uClipRadius * 0.94;
        vCropCoverage = clipCoverage();
        vec4 modelViewPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * modelViewPosition;
        gl_PointSize = (6.2 + (vReserve * 1.1)) *
          (10.0 / max(1.0, -modelViewPosition.z));
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vReserve;

      varying float vCropCoverage;
      void main() {
        float distanceToCenter = length((gl_PointCoord - 0.5) * 2.0);
        if (distanceToCenter > 1.0 || vCropCoverage <= 0.001) discard;
        float core = 1.0 - smoothstep(0.02, 0.42, distanceToCenter);
        float halo = 1.0 - smoothstep(0.12, 1.0, distanceToCenter);
        vec3 gold = mix(vec3(1.0, 0.66, 0.14), vec3(1.0, 0.86, 0.4), vReserve);
        vec3 color = mix(gold, vec3(1.0, 0.995, 0.92), core * 0.94);
        gl_FragColor = vec4(
          color * (0.92 + (core * 0.55)),
          (core + (halo * 0.78)) * vCropCoverage
        );
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  })
}

function createAuroraRibbons(THREE, radius, crop) {
  const segments = 36
  const positions = []
  const lanes = []
  const colors = []
  const indices = []
  const palette = [0x4df2ff, 0xf28ad2, 0x7ae8ff]

  for (let ribbon = 0; ribbon < 3; ribbon += 1) {
    const color = new THREE.Color(palette[ribbon])
    const vertexBase = positions.length / 3
    for (let index = 0; index <= segments; index += 1) {
      const x = radius * (-1.15 + ((index / segments) * 2.3))
      for (const edge of [-1, 1]) {
        positions.push(x, edge, 0)
        lanes.push(ribbon)
        colors.push(color.r, color.g, color.b)
      }
    }
    for (let index = 0; index < segments; index += 1) {
      const left = vertexBase + (index * 2)
      indices.push(left, left + 1, left + 2, left + 1, left + 3, left + 2)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aLane', new THREE.Float32BufferAttribute(lanes, 1))
  geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uPhase: { value: 0 },
      uStrength: { value: 0 },
      uClipRadius: crop.uClipRadius,
      uClipCenter: crop.uClipCenter
    },
    vertexShader: /* glsl */ `
      attribute float aLane;
      attribute vec3 aColor;
      uniform float uPhase;
      uniform float uClipRadius;
      uniform vec3 uClipCenter;
      varying float vEdge;
      varying float vFlow;
      varying vec3 vColor;
      varying float vCropCoverage;
      ${CROP_VARYINGS}
      ${CROP_COVERAGE}

      void main() {
        float progress = (position.x / ${radius.toFixed(6)} + 1.15) / 2.3;
        float laneOffset = (aLane - 1.0) * ${Number(radius * 0.29).toFixed(6)};
        float wave = sin((progress * 12.5663706144) - (uPhase * 6.28318530718) + aLane) *
          ${Number(radius * 0.075).toFixed(6)};
        float width = ${Number(radius * 0.105).toFixed(6)} *
          (0.72 + (0.28 * sin((progress * 6.28318530718) + aLane)));
        vec3 transformed = vec3(
          position.x,
          ${Number(radius * (PROCESSOR_SURFACE_Y + 0.09)).toFixed(6)} + wave + (position.y * width),
          laneOffset
        );
        vEdge = position.y;
        vFlow = 0.72 + (0.28 * sin((progress * 18.8495559215) - (uPhase * 6.28318530718)));
        vColor = aColor;
        /* Cropped by hand for the same reason as the electrons: no include hooks. */
        vClipViewCenter = (viewMatrix * vec4(uClipCenter, 1.0)).xyz;
        vClipViewPos = (viewMatrix * modelMatrix * vec4(transformed, 1.0)).xyz;
        vClipViewRadius = uClipRadius;
        vCropCoverage = clipCoverage();
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uStrength;
      varying float vEdge;
      varying float vFlow;
      varying vec3 vColor;
      varying float vCropCoverage;

      void main() {
        if (vCropCoverage <= 0.001) discard;
        float feather = 1.0 - smoothstep(0.05, 1.0, abs(vEdge));
        gl_FragColor = vec4(
          vColor * (0.75 + (vFlow * 0.3)),
          feather * uStrength * 0.42 * vCropCoverage
        );
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  })
  material.forceSinglePass = true

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'pqi-menu-aurora-ribbons'
  /* Cropped in its own shader above, so the tree walker must not claim it failed. */
  mesh.userData.noSphereCrop = true
  mesh.renderOrder = 7
  mesh.frustumCulled = false
  mesh.userData.noShadow = true
  return { mesh, material }
}

const MODEL_MATERIAL_KEYS = Object.freeze({
  'UPPER-GATE_REAR': 'gold',
  'LOWER-GATE_REAR': 'gold',
  'NANOWIRE_SIDE-A': 'nanowire',
  'NANOWIRE_SIDE-B': 'nanowire',
  NANOWIRE_CONNECTION: 'connector',
  'SCIENCE-MATERIAL-LAYER': 'science',
  'BARRIER-TOP-01': 'barrierTop',
  'BARRIER-02': 'barrier02',
  'BARRIER-03': 'barrier03',
  'BARRIER-04': 'barrier04',
  BASE: 'base'
})

function normalizedNodeName(name) {
  return String(name || '').toUpperCase().replace(/\.\d+$/, '')
}

function createModelMaterials(THREE, brushedEnv) {
  const physical = options => new THREE.MeshPhysicalMaterial({
    envMap: brushedEnv,
    ...options
  })
  return {
    gold: physical({
      color: 0xe5ad52,
      metalness: 1,
      roughness: 0.16,
      clearcoat: 0.5,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.45
    }),
    nanowire: physical({
      color: 0x197e8b,
      metalness: 0.58,
      roughness: 0.22,
      emissive: 0x063d4b,
      emissiveIntensity: 0.75,
      clearcoat: 0.52,
      envMapIntensity: 1.1
    }),
    connector: physical({
      color: 0x8d99a8,
      metalness: 0.82,
      roughness: 0.24,
      clearcoat: 0.28,
      envMapIntensity: 1.2
    }),
    science: physical({
      color: 0x9bdcff,
      roughness: 0.16,
      metalness: 0.12,
      transparent: true,
      opacity: 0.085,
      depthWrite: false,
      side: THREE.FrontSide,
      envMapIntensity: 1.05
    }),
    barrierTop: physical({
      color: 0xe7f8ff,
      roughness: 0.08,
      transparent: true,
      opacity: 0.025,
      depthWrite: false,
      side: THREE.FrontSide
    }),
    barrier02: physical({
      color: 0xa4c9dc,
      roughness: 0.18,
      transparent: true,
      opacity: 0.04,
      depthWrite: false,
      side: THREE.FrontSide
    }),
    barrier03: physical({
      color: 0xd8eaf4,
      roughness: 0.09,
      transparent: true,
      opacity: 0.022,
      depthWrite: false,
      side: THREE.FrontSide
    }),
    barrier04: physical({
      color: 0x8299aa,
      roughness: 0.24,
      metalness: 0.18,
      transparent: true,
      opacity: 0.052,
      depthWrite: false,
      side: THREE.FrontSide
    }),
    base: physical({
      color: 0x202832,
      metalness: 0.48,
      roughness: 0.33,
      clearcoat: 0.18,
      envMapIntensity: 0.92
    })
  }
}

function modelRenderOrder(key) {
  return {
    'BARRIER-04': 10,
    'SCIENCE-MATERIAL-LAYER': 11,
    'BARRIER-03': 12,
    'BARRIER-02': 13,
    'BARRIER-TOP-01': 14
  }[key] || 0
}

/**
 * The production Module 05 device inside the shared navigation renderer. The
 * model is the same Meshopt-compressed GLB as the full experience; only the
 * front gate halves are hidden to match its interactive, exposed state.
 */
export function createProtectionMenuObject({
  THREE,
  RoundedBoxGeometry,
  radius,
  brushedEnv = null,
  modelTemplate = null
}) {
  const root = new THREE.Group()
  root.userData.useOpticalRig = true
  root.userData.lockMenuPitch = true
  /* One pair of world-space uniforms for every cropped surface in this scene. */
  const cropUniforms = createCropUniforms(THREE)
  const visual = new THREE.Group()
  visual.name = 'pqi-menu-production-device'
  visual.rotation.set(0.04, -0.42, -0.04)
  root.add(visual)

  const geometries = new Set()
  const materials = new Set()
  const rememberGeometry = geometry => {
    geometries.add(geometry)
    return geometry
  }
  const rememberMaterial = material => {
    materials.add(material)
    material.userData.noImperfection = true
    return material
  }

  let modelRenderableCount = 0
  let modelTriangleCount = 0
  const modelRoot = modelTemplate?.clone?.(true) || new THREE.Group()
  modelRoot.name = 'pqi-menu-production-glb'
  const modelMaterials = createModelMaterials(THREE, brushedEnv)
  for (const material of Object.values(modelMaterials)) rememberMaterial(material)
  modelRoot.traverse(object => {
    if (!object.isMesh) return
    const key = normalizedNodeName(object.name)
    rememberGeometry(object.geometry)
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of sourceMaterials) if (material) rememberMaterial(material)
    if (key.endsWith('_FRONT')) {
      object.visible = false
      object.userData.noShadow = true
      return
    }
    const materialKey = MODEL_MATERIAL_KEYS[key]
    if (materialKey) object.material = modelMaterials[materialKey]
    object.renderOrder = modelRenderOrder(key)
    object.castShadow = key === 'BASE'
    object.receiveShadow = false
    object.userData.noShadow = key !== 'BASE'
    modelRenderableCount += 1
    const indexCount = object.geometry.index?.count
    const vertexCount = object.geometry.getAttribute('position')?.count || 0
    modelTriangleCount += Math.floor((indexCount || vertexCount) / 3)
  })
  modelRoot.updateMatrixWorld(true)
  const modelBounds = new THREE.Box3().setFromObject(modelRoot)
  const modelCenter = modelBounds.getCenter(new THREE.Vector3())
  const modelSize = modelBounds.getSize(new THREE.Vector3())
  const modelScale = (radius * PROCESSOR_WIDTH) / Math.max(modelSize.x, modelSize.z, 0.001)
  modelRoot.position.copy(modelCenter).multiplyScalar(-1)
  modelRoot.scale.setScalar(modelScale)
  visual.add(modelRoot)

  const voltageMaterial = rememberMaterial(new THREE.MeshBasicMaterial({
    color: 0xcceeff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  }))
  const voltageBands = new THREE.InstancedMesh(
    rememberGeometry(new RoundedBoxGeometry(
      radius * 1.98,
      radius * 0.012,
      radius * 0.145,
      2,
      radius * 0.006
    )),
    voltageMaterial,
    2
  )
  voltageBands.name = 'pqi-menu-voltage-bands'
  setInstances(THREE, voltageBands, [-0.2, 0.2].map(z => ({
    position: [0, radius * (PROCESSOR_SURFACE_Y + 0.022), radius * z]
  })))
  voltageBands.renderOrder = 4
  voltageBands.userData.noShadow = true
  voltageBands.visible = false
  visual.add(voltageBands)

  const particleGeometry = rememberGeometry(createParticleGeometry(THREE, radius))
  const particleMaterial = rememberMaterial(createParticleMaterial(THREE, cropUniforms))
  const particles = new THREE.Points(particleGeometry, particleMaterial)
  particles.name = 'pqi-menu-electrons'
  /* Cropped inside its own shader, so the tree walker must not report it failed. */
  particles.userData.noSphereCrop = true
  particles.renderOrder = 5
  particles.frustumCulled = false
  particles.userData.noShadow = true
  visual.add(particles)

  const { mesh: auroraRibbons, material: auroraMaterial } = createAuroraRibbons(THREE, radius, cropUniforms)
  rememberGeometry(auroraRibbons.geometry)
  rememberMaterial(auroraMaterial)
  visual.add(auroraRibbons)

  const applyState = state => {
    particleMaterial.uniforms.uThermalPhase.value = state.thermalPhase
    particleMaterial.uniforms.uTemperature.value = state.temperature
    particleMaterial.uniforms.uVoltage.value = state.voltage
    particleMaterial.uniforms.uMagnetic.value = state.magnetic

    voltageMaterial.opacity = clamp(state.voltageVisual * 0.26, 0, 0.76)
    voltageBands.visible = state.voltageVisual > 0.001
    modelMaterials.nanowire.emissiveIntensity =
      0.58 + (clamp(state.voltageVisual, 0, 2.4) * 0.2)

    /*
     * The ribbons hold their settled pose rather than drifting with the loop. They are
     * the magnetic phase *arriving*, which was the story's climax; with the device held
     * in its protected state there is nothing for them to announce, so they sit at the
     * calm strength the reduced-motion frame always used and let the electrons carry
     * the movement.
     */
    auroraMaterial.uniforms.uPhase.value = 0.46
    auroraMaterial.uniforms.uStrength.value = clamp(state.magneticVisual * 0.46, 0, 0.92)
  }

  let reducedStateApplied = false
  root.userData.update = seconds => {
    reducedStateApplied = false
    applyState(sampleProtectionMenuAmbient(seconds))
  }
  root.userData.applyReducedMotion = () => {
    if (reducedStateApplied) return
    reducedStateApplied = true
    applyState(sampleProtectionMenuAmbient(0, { reducedMotion: true }))
  }
  root.userData.dispose = () => {
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
  }
  root.userData.previewStats = Object.freeze({
    particles: PROTECTION_MENU_PARTICLE_COUNT,
    primarySilhouettes: 1,
    modelRenderables: modelRenderableCount,
    modelTriangles: modelTriangleCount,
    magneticRibbons: 3,
    drawCalls: modelRenderableCount + 3
  })

  /*
   * The device sits inside the same circle the topoconductor card uses: an envelope
   * of unlit shells, all drawn before the contents so none of them paint over the
   * model, with the crop cutting everything to the circle as it appears on screen.
   * The model arrives as a GLTF whose nodes each carry their own transform, which is
   * exactly why the crop works in world space — one uniform pair covers the tree.
   */
  const envelopeGeometry = new THREE.SphereGeometry(1, 64, 40)
  rememberGeometry(envelopeGeometry)

  const shells = []
  const addShell = (name, frost, side, order, castShadow = false) => {
    const mesh = new THREE.Mesh(envelopeGeometry, side)
    mesh.name = name
    mesh.renderOrder = order
    mesh.userData.noShadow = !castShadow
    mesh.userData.noImperfection = true
    mesh.userData.noSphereCrop = true
    mesh.castShadow = castShadow
    /* Decorative as well: no depth interaction, so it cannot cut against the device.
       It only shows at the silhouette, where the crop has already removed the
       device, so drawing after costs nothing. */
    side.depthWrite = false
    side.depthTest = false
    side.userData.noImperfection = true
    rememberMaterial(side)
    shells.push(mesh)
    root.add(mesh)
    return mesh
  }

  /*
   * Fill: the soft blue field. Three draws every transparent surface after every
   * opaque one, so renderOrder alone cannot put a translucent shell behind the
   * device — it tinted the chip and its gold gates no matter what order was asked
   * for. Drawing only the far hemisphere (BackSide) puts this geometry genuinely
   * behind the device, so turning the depth test back on is what keeps it off the
   * contents: its fragments are simply rejected wherever the device is nearer.
   */
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PROTECTION_MENU_SHELL_TINT),
    /*
     * Purely decorative, so it takes no part in depth at all: it writes none, so it
     * can never occlude the device, and tests none, so nothing clips it. Opaque
     * rather than translucent is what puts it in the same pass as the device — three
     * draws every transparent surface after every opaque one, so a translucent fill
     * could only ever be painted on top, which is what was shading the chip.
     *
     * Drawn first, then overwritten wherever the device is. The crop is screen-space,
     * so the sphere never needs to interact with the contents geometrically.
     */
    transparent: false,
    depthWrite: false,
    depthTest: false,
    toneMapped: false
  })
  fillMaterial.userData.noImperfection = true
  rememberMaterial(fillMaterial)
  const shellFill = new THREE.Mesh(envelopeGeometry, fillMaterial)
  shellFill.name = 'pqi-menu-envelope-fill'
  /* Ahead of every device surface, so the device paints over it. */
  shellFill.renderOrder = -1
  shellFill.castShadow = true
  shellFill.userData.noImperfection = true
  shellFill.userData.noSphereCrop = true
  shells.push(shellFill)
  root.add(shellFill)

  /* Rim: the edge of the containment, also behind the contents so it never traces an
     outline across the part of the device that reaches the circle's edge. */
  const rim = createFrostShell(THREE)
  rim.uniforms.uColor.value = new THREE.Color(PROTECTION_MENU_SHELL_TINT)
  rim.uniforms.uBaseAlpha.value = 0
  rim.uniforms.uRimAlpha.value = 0.3
  rim.uniforms.uFresnelPow.value = 2.6
  rim.uniforms.uBackAlpha.value = 0.12
  addShell('pqi-menu-envelope-rim-back', rim, rim.back, 1)
  addShell('pqi-menu-envelope-rim-front', rim, rim.front, 2)

  /* The device casts nothing: cropped, its shadow would describe a solid the visitor
     cannot see. The circle owns the contact shadow, as on the topoconductor card. */
  visual.traverse(object => {
    if (object.isMesh || object.isPoints || object.isInstancedMesh) {
      object.userData.noShadow = true
      object.castShadow = false
    }
  })

  const cropReport = applyCropToTree(visual, cropUniforms)

  const tuning = {
    /* Dialled in on the running kiosk rather than derived — these are the values the
       framing panel was left at, kept as the defaults. */
    circleScale: 0.63,
    deviceScale: 1.25,
    tiltX: -0.12,
    tiltY: -0.65,
    tiltZ: -0.2,
    offsetX: -3.5,
    offsetY: 0.26,
    /* Depth as well as the two screen axes: pushing the device toward or away from
       the camera changes how much of it the circle's cone takes in, which is a
       different framing lever from sliding it across the circle. */
    offsetZ: -0.29,
    cropInset: 0.92
  }
  const cropScratch = new THREE.Vector3()

  function applyTuning() {
    const shellRadius = radius * tuning.circleScale
    for (const shell of shells) shell.scale.setScalar(shellRadius)
    visual.scale.setScalar(tuning.deviceScale)
    /* Offsets in circle radii, so 1.0 puts the device's centre on the rim. */
    visual.position.set(
      shellRadius * tuning.offsetX,
      shellRadius * tuning.offsetY,
      shellRadius * tuning.offsetZ
    )
    visual.rotation.set(tuning.tiltX, tuning.tiltY, tuning.tiltZ)
  }

  function applyCrop() {
    aimCropAtSphere(cropUniforms, shellFill, {
      inset: tuning.cropInset,
      scratch: cropScratch
    })
  }

  root.userData.navTuning = {
    params: tuning,
    ranges: Object.freeze({
      circleScale: [0.3, 1.4],
      deviceScale: [0.3, 3],
      tiltX: [-1.2, 1.2],
      tiltY: [-1.6, 1.6],
      tiltZ: [-0.8, 0.8],
      offsetX: [-3.5, 3.5],
      offsetY: [-3.5, 3.5],
      offsetZ: [-3.5, 3.5],
      cropInset: [0.5, 1.2]
    }),
    apply(next = {}) {
      for (const [key, value] of Object.entries(next)) {
        if (key in tuning && Number.isFinite(value)) tuning[key] = value
      }
      applyTuning()
      applyCrop()
    },
    /* Surfaced so an unpatchable material shows up here rather than as a stray
       uncropped surface someone has to notice by eye. */
    unpatched: cropReport.unpatched
  }

  const baseUpdate = root.userData.update
  root.userData.update = seconds => {
    baseUpdate(seconds)
    applyCrop()
  }

  applyTuning()
  applyCrop()
  applyState(sampleProtectionMenuAmbient(0))
  return root
}
