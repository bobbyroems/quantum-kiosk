import { assetUrl } from '../../core/asset-url.js'
import { ensureRectAreaLightUniformsInitialized } from '../../core/rect-area-light-uniforms.js'
import { leaseWebGLRenderer } from '../../core/webgl-renderer-pool.js'
import { disposeObject3DResources } from '../../core/three-resource-disposal.js'
import { visibleFramebufferRegion } from '../../core/visible-framebuffer-region.js'
import {
  calculateStageAwarePixelRatio,
  elementCssScale
} from '../../core/three-render-budget.js'
import {
  advanceThermalTime,
  CHIP_SURFACE_FOOTPRINT,
  createProtectingParticleData,
  DEFAULT_WIRE_LAYOUT,
  PARTICLE_FOOTPRINT,
  PARTICLE_VOLUME,
  PARTICLE_TIER_LEVELS,
  PARTICLE_TIERS,
  recommendedParticleTierLevel,
  sampleNanowireReserve,
  THERMAL_MOTION_PROFILE
} from './protecting-information-physics.js'
import { getProtectionEffectDrives } from './protecting-information-state.js'
import { MeshoptDecoder } from './meshopt-decoder.js'
import { blurMajoranaEnvironment } from '../build-majorana-2/majorana-environment.js'

const MODEL_PATH = 'assets/modules/protecting-information/protect-quantum-information.glb'
const REFLECTION_ENVIRONMENT_PATH = 'assets/modules/build-majorana-2/lab-sweep.hdr'
const VOLTAGE_ICON_PATH =
  'assets/modules/protecting-information/voltage-bolts-flat-glow.png'
const INTRO_HOLD_DURATION = 1
const INTRO_TRANSITION_DURATION = 1.05
const INTERRUPTED_INTRO_DURATION = 0.15
const H_GATE_UPPER_SMOKED_OPACITY = 0.06
const H_GATE_LOWER_SMOKED_OPACITY = 0.44
const PERFORMANCE_WINDOW_SECONDS = 2
const MAX_PERFORMANCE_WINDOWS = 2
const PRESENTATION_OFFSET_X = 0.8
const BASE_SCENE_LAYER = 0
const MAGNETIC_BLUR_LAYER = 1
/* Ceiling on the visible-region copy, independent of the full canvas budget. */
const MAX_MAGNETIC_BLUR_PIXELS = 3_000_000

const VOLTAGE_PACKET_GLSL = `
  float pqiVoltagePacket(vec3 packetPosition, float packetTime) {
    float flow = (packetPosition.x * 0.105) + (packetTime * 0.34);
    float cycleA = fract(flow);
    float cycleB = fract(flow + 0.53);
    float tailA = smoothstep(0.0, 0.045, cycleA) *
      (1.0 - smoothstep(0.1, 0.48, cycleA));
    float tailB = smoothstep(0.0, 0.055, cycleB) *
      (1.0 - smoothstep(0.1, 0.38, cycleB));
    float coreA = 1.0 - smoothstep(0.0, 0.055, abs(cycleA - 0.075));
    float coreB = 1.0 - smoothstep(0.0, 0.045, abs(cycleB - 0.08));
    float packet = clamp(max(
      (tailA * 0.58) + coreA,
      (tailB * 0.42) + (coreB * 0.72)
    ), 0.0, 1.0);
    return smoothstep(0.1, 0.72, packet);
  }
`

export const PROTECTING_INFORMATION_MATERIAL_KEYS = Object.freeze({
  'UPPER-GATE': 'gold',
  'LOWER-GATE': 'gold',
  'UPPER-GATE_FRONT': 'gold',
  'UPPER-GATE_REAR': 'gold',
  'LOWER-GATE_FRONT': 'gold',
  'LOWER-GATE_REAR': 'gold',
  'UPPER-GATE_H': 'hGate',
  'LOWER-GATE_H': 'hGateLower',
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

function createAbortError() {
  return new DOMException('Protecting Information scene was aborted', 'AbortError')
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0))
}

function easeInOutCubic(value) {
  const progress = clamp(value)
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - (Math.pow((-2 * progress) + 2, 3) / 2)
}

function damp(current, target, delta, durationTo95Percent) {
  if (durationTo95Percent <= 0) return target
  return target + ((current - target) * Math.exp((-2.995732 * delta) / durationTo95Percent))
}

const OVERVOLTAGE_EVACUATION_DURATION = 0.6

function percentile(values, percentileValue) {
  if (!values.length) return 0
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * percentileValue))]
}

/* Bumped from the unsuffixed key: measurements taken before the probe learned
   to wait for the video stack recorded that stack's startup cost as if it were
   steady state, and a session carrying one of those would start needlessly
   degraded. */
const PARTICLE_PERFORMANCE_KEY = 'pqi-particle-performance-v2'

function particleTierName(level) {
  return level === PARTICLE_TIER_LEVELS.high
    ? 'high'
    : level === PARTICLE_TIER_LEVELS.medium ? 'medium' : 'low'
}

function initialParticleTierLevel() {
  try {
    const prior = JSON.parse(sessionStorage.getItem(PARTICLE_PERFORMANCE_KEY))
    return recommendedParticleTierLevel(prior)
  } catch {
    return PARTICLE_TIER_LEVELS.high
  }
}

function normalizedNodeName(name) {
  return String(name || '').toUpperCase().replace(/\.\d+$/, '')
}

function disposeMaterial(material, disposedTextures) {
  if (!material) return
  for (const value of Object.values(material)) {
    if (!value?.isTexture || disposedTextures.has(value)) continue
    disposedTextures.add(value)
    value.dispose()
  }
  material.dispose?.()
}

function createRoundedRectangularGeometry(THREE, width, depth, radius) {
  const halfWidth = width / 2
  const halfDepth = depth / 2
  const cornerRadius = Math.min(radius, halfWidth, halfDepth)
  const shape = new THREE.Shape()

  shape.moveTo(-halfWidth + cornerRadius, -halfDepth)
  shape.lineTo(halfWidth - cornerRadius, -halfDepth)
  shape.quadraticCurveTo(halfWidth, -halfDepth, halfWidth, -halfDepth + cornerRadius)
  shape.lineTo(halfWidth, halfDepth - cornerRadius)
  shape.quadraticCurveTo(halfWidth, halfDepth, halfWidth - cornerRadius, halfDepth)
  shape.lineTo(-halfWidth + cornerRadius, halfDepth)
  shape.quadraticCurveTo(-halfWidth, halfDepth, -halfWidth, halfDepth - cornerRadius)
  shape.lineTo(-halfWidth, -halfDepth + cornerRadius)
  shape.quadraticCurveTo(-halfWidth, -halfDepth, -halfWidth + cornerRadius, -halfDepth)
  shape.closePath()

  return new THREE.ShapeGeometry(shape, 8)
}

function addBlueTopSurface(THREE, material) {
  const deviceWorldInverse = new THREE.Matrix4()
  const shadowBlue = new THREE.Color(0x0b1f55)
  const litBlue = new THREE.Color(0x476bd4)
  const violetBlue = new THREE.Color(0x7650cf)
  const exposedSubstrate = new THREE.Color(0x34415e)
  material.userData.pqiDeviceWorldInverse = deviceWorldInverse
  material.onBeforeCompile = shader => {
    shader.uniforms.uPqiDeviceWorldInverse = { value: deviceWorldInverse }
    shader.uniforms.uPqiShadowBlue = { value: shadowBlue }
    shader.uniforms.uPqiLitBlue = { value: litBlue }
    shader.uniforms.uPqiVioletBlue = { value: violetBlue }
    shader.uniforms.uPqiExposedSubstrate = { value: exposedSubstrate }
    shader.vertexShader = `
      varying vec3 vPqiWorldNormal;
      varying vec3 vPqiBaseWorldPosition;
      ${shader.vertexShader}
    `
      .replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nvPqiWorldNormal = normalize(mat3(modelMatrix) * objectNormal);'
      )
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvPqiBaseWorldPosition = worldPosition.xyz;'
      )
    shader.fragmentShader = `
      varying vec3 vPqiWorldNormal;
      varying vec3 vPqiBaseWorldPosition;
      uniform mat4 uPqiDeviceWorldInverse;
      uniform vec3 uPqiShadowBlue;
      uniform vec3 uPqiLitBlue;
      uniform vec3 uPqiVioletBlue;
      uniform vec3 uPqiExposedSubstrate;
      ${shader.fragmentShader}
    `
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float pqiTopSurface = smoothstep(0.48, 0.86, vPqiWorldNormal.y);
        vec3 pqiBasePosition = (uPqiDeviceWorldInverse * vec4(vPqiBaseWorldPosition, 1.0)).xyz;
        float pqiBroadLight = smoothstep(-5.8, 5.8, -pqiBasePosition.x) * 0.7 +
          smoothstep(-3.6, 3.6, -pqiBasePosition.z) * 0.28;
        pqiBroadLight = smoothstep(0.04, 0.96, pqiBroadLight);
        vec2 pqiVioletCoordinate = (pqiBasePosition.xz - vec2(2.3, -1.8)) /
          vec2(5.1, 2.8);
        float pqiVioletLobe = exp(-dot(pqiVioletCoordinate, pqiVioletCoordinate) * 1.35);
        float pqiOpticalBand = 0.5 + (0.5 * sin(
          (pqiBasePosition.x * 0.58) + (pqiBasePosition.z * 0.74) + 0.8
        ));
        float pqiCoatingReveal = smoothstep(-4.85, 2.9, pqiBasePosition.x);
        pqiCoatingReveal = pow(pqiCoatingReveal, 0.88);
        float pqiCoatingWeight = mix(0.035, 0.96, pqiCoatingReveal);
        vec3 pqiLayeredBlue = mix(uPqiShadowBlue, uPqiLitBlue, pqiBroadLight);
        pqiLayeredBlue = mix(pqiLayeredBlue, uPqiVioletBlue, pqiVioletLobe * 0.36);
        pqiLayeredBlue *= 0.9 + (pqiOpticalBand * 0.1);
        vec3 pqiExposedTop = mix(diffuseColor.rgb, uPqiExposedSubstrate, 0.76);
        diffuseColor.rgb = mix(
          pqiExposedTop,
          pqiLayeredBlue,
          pqiTopSurface * pqiCoatingWeight
        );`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(0.002, 0.006, 0.018) * pqiTopSurface;`
      )
  }
  material.customProgramCacheKey = () => 'pqi-blue-top-surface-v5'
  material.needsUpdate = true
  return material
}

function addCoatingOpacityGradient(THREE, material, cacheKey, frontOpacity = 0.12) {
  const deviceWorldInverse = new THREE.Matrix4()
  material.userData.pqiDeviceWorldInverse = deviceWorldInverse
  material.onBeforeCompile = shader => {
    shader.uniforms.uPqiDeviceWorldInverse = { value: deviceWorldInverse }
    shader.uniforms.uPqiCoatingFrontOpacity = { value: frontOpacity }
    shader.vertexShader = `varying vec3 vPqiCoatingWorldPosition;\n${shader.vertexShader}`
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvPqiCoatingWorldPosition = worldPosition.xyz;'
      )
    shader.fragmentShader = `
      varying vec3 vPqiCoatingWorldPosition;
      uniform mat4 uPqiDeviceWorldInverse;
      uniform float uPqiCoatingFrontOpacity;
      ${shader.fragmentShader}
    `.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      vec3 pqiCoatingPosition = (
        uPqiDeviceWorldInverse * vec4(vPqiCoatingWorldPosition, 1.0)
      ).xyz;
      float pqiCoatingReveal = smoothstep(-4.85, 2.9, pqiCoatingPosition.x);
      pqiCoatingReveal = pow(pqiCoatingReveal, 0.88);
      float pqiCoatingAlpha = mix(
        uPqiCoatingFrontOpacity,
        1.0,
        pqiCoatingReveal
      );
      diffuseColor.a *= pqiCoatingAlpha;`
    )
  }
  material.customProgramCacheKey = () => `pqi-coating-opacity-${cacheKey}-v2`
  material.needsUpdate = true
  return material
}

function addHVoltageSurface(THREE, material, voltageDrive) {
  const deviceWorldInverse = new THREE.Matrix4()
  const introProgress = { value: 1 }
  const smokedColor = new THREE.Color(0x5a667a)
  const introGoldColor = new THREE.Color(0xe5ad52)
  const goldColor = new THREE.Color(0xff9f19)
  const hotColor = new THREE.Color(0xfff0a1)
  material.userData.pqiDeviceWorldInverse = deviceWorldInverse
  material.userData.pqiVoltageStrength = voltageDrive.strength
  material.userData.pqiVoltageTime = voltageDrive.time
  material.userData.pqiIntroProgress = introProgress
  material.onBeforeCompile = shader => {
    shader.uniforms.uPqiDeviceWorldInverse = { value: deviceWorldInverse }
    shader.uniforms.uPqiVoltageStrength = voltageDrive.strength
    shader.uniforms.uPqiVoltageTime = voltageDrive.time
    shader.uniforms.uPqiIntroProgress = introProgress
    shader.uniforms.uPqiHSmoked = { value: smokedColor }
    shader.uniforms.uPqiHIntroGold = { value: introGoldColor }
    shader.uniforms.uPqiHGold = { value: goldColor }
    shader.uniforms.uPqiHHot = { value: hotColor }
    shader.vertexShader = `varying vec3 vPqiHWorldPosition;\n${shader.vertexShader}`
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvPqiHWorldPosition = worldPosition.xyz;'
      )
    shader.fragmentShader = `
      varying vec3 vPqiHWorldPosition;
      uniform mat4 uPqiDeviceWorldInverse;
      uniform float uPqiVoltageStrength;
      uniform float uPqiVoltageTime;
      uniform float uPqiIntroProgress;
      uniform vec3 uPqiHSmoked;
      uniform vec3 uPqiHIntroGold;
      uniform vec3 uPqiHGold;
      uniform vec3 uPqiHHot;
      ${VOLTAGE_PACKET_GLSL}
      ${shader.fragmentShader}
    `.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      vec3 pqiHPosition = (uPqiDeviceWorldInverse * vec4(vPqiHWorldPosition, 1.0)).xyz;
      float pqiHDrive = clamp(uPqiVoltageStrength, 0.0, 1.0);
      float pqiHOverdrive = max(0.0, uPqiVoltageStrength - 1.0);
      float pqiHPulse = pqiVoltagePacket(pqiHPosition, uPqiVoltageTime) * pqiHDrive;
      vec3 pqiHActiveColor = mix(uPqiHGold, uPqiHHot, pqiHPulse * 0.78);
      diffuseColor.rgb = mix(uPqiHSmoked, uPqiHGold, pqiHDrive * 0.2);
      diffuseColor.rgb = mix(diffuseColor.rgb, pqiHActiveColor, pqiHPulse * 0.2);
      diffuseColor.rgb = mix(uPqiHIntroGold, diffuseColor.rgb, uPqiIntroProgress);
      diffuseColor.rgb *= 1.0 + pqiHOverdrive * 0.05;`
    ).replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float pqiHViewRim = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.5);
      totalEmissiveRadiance += uPqiHGold * pqiHDrive * (0.022 + pqiHOverdrive * 0.035);
      totalEmissiveRadiance += uPqiHHot * pqiHPulse * (0.34 + pqiHOverdrive * 0.12);
      totalEmissiveRadiance += uPqiHHot * pqiHViewRim * pqiHDrive * 0.055;`
    )
  }
  material.customProgramCacheKey = () => 'pqi-authored-h-voltage-v3'
  material.needsUpdate = true
  return material
}

function addMagneticWireSurface(THREE, material, magneticDrive, endAccent = 1) {
  const deviceWorldInverse = new THREE.Matrix4()
  const coolColor = new THREE.Color(0x4ed8ef)
  const warmColor = new THREE.Color(0xff5672)
  material.userData.pqiDeviceWorldInverse = deviceWorldInverse
  material.userData.pqiMagneticStrength = magneticDrive.strength
  material.onBeforeCompile = shader => {
    shader.uniforms.uPqiDeviceWorldInverse = { value: deviceWorldInverse }
    shader.uniforms.uPqiMagneticStrength = magneticDrive.strength
    shader.uniforms.uPqiWireCool = { value: coolColor }
    shader.uniforms.uPqiWireWarm = { value: warmColor }
    shader.uniforms.uPqiWireEndAccent = { value: endAccent }
    shader.vertexShader = `varying vec3 vPqiWireWorldPosition;\n${shader.vertexShader}`
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvPqiWireWorldPosition = worldPosition.xyz;'
      )
    shader.fragmentShader = `
      varying vec3 vPqiWireWorldPosition;
      uniform mat4 uPqiDeviceWorldInverse;
      uniform float uPqiMagneticStrength;
      uniform vec3 uPqiWireCool;
      uniform vec3 uPqiWireWarm;
      uniform float uPqiWireEndAccent;
      ${shader.fragmentShader}
    `.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      vec3 pqiWirePosition = (uPqiDeviceWorldInverse * vec4(vPqiWireWorldPosition, 1.0)).xyz;
      float pqiMagneticDrive = clamp(uPqiMagneticStrength, 0.0, 1.0);
      float pqiWireEnd = smoothstep(2.08, 2.72, -pqiWirePosition.x) *
        uPqiWireEndAccent;
      vec3 pqiMagneticWireColor = mix(uPqiWireCool, uPqiWireWarm, pqiWireEnd);
      diffuseColor.rgb = mix(diffuseColor.rgb, pqiMagneticWireColor, pqiMagneticDrive * 0.88);`
    ).replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      totalEmissiveRadiance += mix(uPqiWireCool, uPqiWireWarm, pqiWireEnd) *
        pqiMagneticDrive * (0.12 + (pqiWireEnd * 0.12));`
    )
  }
  material.customProgramCacheKey = () => `pqi-magnetic-wire-v2-${endAccent}`
  material.needsUpdate = true
  return material
}

function addGateSurfaceVariation(THREE, material, voltageDrive) {
  const deviceWorldInverse = new THREE.Matrix4()
  const activeGold = new THREE.Color(0xe3c66f)
  const hotGold = new THREE.Color(0xfff0a1)
  material.userData.pqiDeviceWorldInverse = deviceWorldInverse
  material.userData.pqiVoltageStrength = voltageDrive.strength
  material.userData.pqiVoltageTime = voltageDrive.time
  material.onBeforeCompile = shader => {
    shader.uniforms.uPqiDeviceWorldInverse = { value: deviceWorldInverse }
    shader.uniforms.uPqiVoltageStrength = voltageDrive.strength
    shader.uniforms.uPqiVoltageTime = voltageDrive.time
    shader.uniforms.uPqiGateActiveGold = { value: activeGold }
    shader.uniforms.uPqiGateHotGold = { value: hotGold }
    shader.vertexShader = `varying vec3 vPqiGateWorldPosition;\n${shader.vertexShader}`
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvPqiGateWorldPosition = worldPosition.xyz;'
      )
    shader.fragmentShader = `
      varying vec3 vPqiGateWorldPosition;
      uniform mat4 uPqiDeviceWorldInverse;
      uniform float uPqiVoltageStrength;
      uniform float uPqiVoltageTime;
      uniform vec3 uPqiGateActiveGold;
      uniform vec3 uPqiGateHotGold;
      ${VOLTAGE_PACKET_GLSL}
      ${shader.fragmentShader}
    `.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      vec3 pqiGatePosition = (uPqiDeviceWorldInverse * vec4(vPqiGateWorldPosition, 1.0)).xyz;
      float pqiGateDrive = clamp(uPqiVoltageStrength, 0.0, 1.0);
      float pqiGateOverdrive = max(0.0, uPqiVoltageStrength - 1.0);
      float pqiGatePulse = pqiVoltagePacket(
        pqiGatePosition,
        uPqiVoltageTime
      ) * pqiGateDrive;
      vec3 pqiGateActiveColor = mix(
        uPqiGateActiveGold,
        uPqiGateHotGold,
        pqiGatePulse * 0.78
      );
      diffuseColor.rgb = mix(
        diffuseColor.rgb,
        pqiGateActiveColor,
        (pqiGateDrive * 0.15) + (pqiGatePulse * 0.14)
      );
      diffuseColor.rgb *= 1.0 + (pqiGateOverdrive * 0.035);`
    ).replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      totalEmissiveRadiance += uPqiGateActiveGold * pqiGateDrive *
        (0.014 + (pqiGateOverdrive * 0.022));
      totalEmissiveRadiance += uPqiGateHotGold * pqiGatePulse *
        (0.42 + (pqiGateOverdrive * 0.1));`
    )
  }
  material.customProgramCacheKey = () => 'pqi-gate-surface-voltage-v4'
  material.needsUpdate = true
  return material
}

function addTemperatureGeometryRim(
  THREE,
  material,
  temperatureDrive,
  cacheKey,
  intensity = 0.5
) {
  const previousOnBeforeCompile = material.onBeforeCompile.bind(material)
  const previousCacheKey = material.customProgramCacheKey.bind(material)
  const rimColor = new THREE.Color(0x75efff)
  material.userData.pqiTemperatureStrength = temperatureDrive.strength
  material.onBeforeCompile = shader => {
    previousOnBeforeCompile(shader)
    shader.uniforms.uPqiTemperatureStrength = temperatureDrive.strength
    shader.uniforms.uPqiTemperatureRimColor = { value: rimColor }
    shader.fragmentShader = `
      uniform float uPqiTemperatureStrength;
      uniform vec3 uPqiTemperatureRimColor;
      ${shader.fragmentShader}
    `.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float pqiTemperatureIncidence = 1.0 - abs(dot(
        normalize(normal),
        normalize(vViewPosition)
      ));
      float pqiTemperatureMetalRim = pow(
        smoothstep(0.14, 0.96, pqiTemperatureIncidence),
        2.15
      );
      totalEmissiveRadiance += uPqiTemperatureRimColor *
        pqiTemperatureMetalRim * uPqiTemperatureStrength * ${intensity.toFixed(2)};`
    )
  }
  material.customProgramCacheKey = () => `${previousCacheKey()}-temperature-rim-${cacheKey}-v1`
  material.needsUpdate = true
  return material
}

function createDeviceMaterials(THREE) {
  const voltageDrive = {
    strength: { value: 0 },
    time: { value: 0 },
    deviceWorldInverse: new THREE.Matrix4()
  }
  const magneticDrive = {
    strength: { value: 0 }
  }
  const temperatureDrive = {
    strength: { value: 0 }
  }
  const gold = addTemperatureGeometryRim(
    THREE,
    addGateSurfaceVariation(THREE, new THREE.MeshPhysicalMaterial({
      color: 0xd7a84d,
      metalness: 1,
      roughness: 0.12,
      clearcoat: 0.34,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.85
    }), voltageDrive),
    temperatureDrive,
    'gold',
    0.66
  )
  const createHGateMaterial = () => addTemperatureGeometryRim(
    THREE,
    addHVoltageSurface(
      THREE,
      new THREE.MeshPhysicalMaterial({
        // The authored H meshes begin with the exact gate response, then become
        // two differently weighted smoked layers around the gold nanowires.
        color: 0xd7a84d,
        metalness: 1,
        roughness: 0.12,
        clearcoat: 0.34,
        clearcoatRoughness: 0.08,
        envMapIntensity: 1.85,
        emissive: 0x000000,
        emissiveIntensity: 1,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.FrontSide
      }),
      voltageDrive
    ),
    temperatureDrive,
    'h-gate',
    0.54
  )
  const hGate = createHGateMaterial()
  const hGateLower = createHGateMaterial()
  const nanowire = addTemperatureGeometryRim(
    THREE,
    addMagneticWireSurface(THREE, new THREE.MeshPhysicalMaterial({
      // The authored rails are the gold lines visible beneath the smoked cover.
      color: 0xd0a74f,
      metalness: 0.96,
      roughness: 0.14,
      emissive: 0x5a2a04,
      emissiveIntensity: 0.08,
      clearcoat: 0.34,
      clearcoatRoughness: 0.1,
      envMapIntensity: 1.72
    }), magneticDrive, 1),
    temperatureDrive,
    'nanowire',
    0.48
  )
  const connector = addTemperatureGeometryRim(
    THREE,
    addMagneticWireSurface(THREE, new THREE.MeshPhysicalMaterial({
      color: 0xd9b45f,
      metalness: 0.96,
      roughness: 0.13,
      clearcoat: 0.3,
      clearcoatRoughness: 0.09,
      envMapIntensity: 1.72
    }), magneticDrive, 0),
    temperatureDrive,
    'connector',
    0.44
  )
  const science = addCoatingOpacityGradient(THREE, new THREE.MeshPhysicalMaterial({
    color: 0x1d438c,
    roughness: 0.16,
    metalness: 0.08,
    emissive: 0x061742,
    emissiveIntensity: 0.06,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    side: THREE.FrontSide,
    envMapIntensity: 0.75
  }), 'science', 0.1)
  const barrierTop = addCoatingOpacityGradient(THREE, new THREE.MeshPhysicalMaterial({
    color: 0x426fbd,
    roughness: 0.12,
    transparent: true,
    opacity: 0.03,
    depthWrite: false,
    side: THREE.FrontSide
  }), 'barrier-top', 0.08)
  const barrier02 = addCoatingOpacityGradient(THREE, new THREE.MeshPhysicalMaterial({
    color: 0x4b668c,
    roughness: 0.18,
    transparent: true,
    opacity: 0.018,
    depthWrite: false,
    side: THREE.FrontSide
  }), 'barrier-02', 0.08)
  const barrier03 = addCoatingOpacityGradient(THREE, new THREE.MeshPhysicalMaterial({
    color: 0x7189a5,
    roughness: 0.09,
    transparent: true,
    opacity: 0.008,
    depthWrite: false,
    side: THREE.FrontSide
  }), 'barrier-03', 0.08)
  const barrier04 = addCoatingOpacityGradient(THREE, new THREE.MeshPhysicalMaterial({
    color: 0x34475d,
    roughness: 0.24,
    metalness: 0.18,
    transparent: true,
    opacity: 0.022,
    depthWrite: false,
    side: THREE.FrontSide
  }), 'barrier-04', 0.1)
  const base = addBlueTopSurface(THREE, new THREE.MeshPhysicalMaterial({
    color: 0x151b27,
    metalness: 0.42,
    roughness: 0.38,
    clearcoat: 0.24,
    envMapIntensity: 0.78
  }))
  return {
    gold,
    hGate,
    hGateLower,
    nanowire,
    connector,
    science,
    barrierTop,
    barrier02,
    barrier03,
    barrier04,
    base,
    voltageDrive,
    magneticDrive,
    temperatureDrive
  }
}

function materialForNode(materials, key) {
  return materials[PROTECTING_INFORMATION_MATERIAL_KEYS[key]] || null
}

function renderOrderForNode(key) {
  return {
    'BARRIER-04': 10,
    'SCIENCE-MATERIAL-LAYER': 11,
    'BARRIER-03': 12,
    'BARRIER-02': 13,
    'BARRIER-TOP-01': 14,
    'UPPER-GATE_H': 18,
    'LOWER-GATE_H': 18
  }[key] || 0
}

function addGateDissolve(material, geometry) {
  geometry.computeBoundingBox()
  const minimumX = geometry.boundingBox?.min.x ?? -0.2
  const maximumX = geometry.boundingBox?.max.x ?? 0.2
  const extentX = Math.max(0.0001, maximumX - minimumX)
  const progress = { value: 0 }
  const previousOnBeforeCompile = material.onBeforeCompile.bind(material)

  material.onBeforeCompile = shader => {
    previousOnBeforeCompile(shader)
    shader.uniforms.uPqiIntro = progress
    shader.uniforms.uPqiIntroMinimumX = { value: minimumX }
    shader.uniforms.uPqiIntroMaximumX = { value: maximumX }
    shader.uniforms.uPqiIntroNoiseScale = { value: extentX * 0.055 }
    shader.vertexShader = `varying vec3 vPqiIntroLocalPosition;\n${shader.vertexShader}`
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvPqiIntroLocalPosition = position;'
      )
    shader.fragmentShader = `
      uniform float uPqiIntro;
      uniform float uPqiIntroMinimumX;
      uniform float uPqiIntroMaximumX;
      uniform float uPqiIntroNoiseScale;
      varying vec3 vPqiIntroLocalPosition;
      ${shader.fragmentShader}
    `.replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
      if (uPqiIntro > 0.0001) {
        float pqiIntroNoise = fract(sin(dot(
          vPqiIntroLocalPosition,
          vec3(12.9898, 78.233, 37.719)
        )) * 43758.5453);
        float pqiIntroCut = mix(
          uPqiIntroMinimumX - (uPqiIntroNoiseScale * 1.5),
          uPqiIntroMaximumX + uPqiIntroNoiseScale,
          uPqiIntro
        );
        if (vPqiIntroLocalPosition.x +
          ((pqiIntroNoise - 0.5) * uPqiIntroNoiseScale) < pqiIntroCut) discard;
      }`
    )
  }
  material.customProgramCacheKey = () => 'pqi-full-model-front-dissolve-v2'
  material.needsUpdate = true
  return progress
}

function createTopBoundaryRibbonGeometry(THREE, sourceGeometry, width, outset = 0) {
  const position = sourceGeometry?.getAttribute?.('position')
  if (!position) return null
  sourceGeometry.computeBoundingBox()
  const bounds = sourceGeometry.boundingBox
  if (!bounds) return null

  const sourceIndex = sourceGeometry.getIndex()
  const triangleCount = Math.floor((sourceIndex?.count || position.count) / 3)
  const boundaryEdges = new Map()
  const first = new THREE.Vector3()
  const second = new THREE.Vector3()
  const third = new THREE.Vector3()
  const firstEdge = new THREE.Vector3()
  const secondEdge = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const vertexIndex = offset => sourceIndex ? sourceIndex.getX(offset) : offset
  const pointKey = point => `${Math.round(point.x * 1e7)}:${Math.round(point.z * 1e7)}`
  const boundaryPoints = new Map()

  const registerEdge = (start, end) => {
    const startKey = pointKey(start)
    const endKey = pointKey(end)
    const key = startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`
    const existing = boundaryEdges.get(key)
    if (existing) existing.count += 1
    else {
      boundaryPoints.set(startKey, { x: start.x, z: start.z })
      boundaryPoints.set(endKey, { x: end.x, z: end.z })
      boundaryEdges.set(key, { count: 1, startKey, endKey })
    }
  }

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = triangle * 3
    first.fromBufferAttribute(position, vertexIndex(offset))
    second.fromBufferAttribute(position, vertexIndex(offset + 1))
    third.fromBufferAttribute(position, vertexIndex(offset + 2))
    firstEdge.subVectors(second, first)
    secondEdge.subVectors(third, first)
    normal.crossVectors(firstEdge, secondEdge).normalize()
    if (normal.y <= 0.85) continue
    registerEdge(first, second)
    registerEdge(second, third)
    registerEdge(third, first)
  }

  const edges = [...boundaryEdges.values()].filter(edge => edge.count === 1)
  if (edges.length < 3) return null
  const adjacency = new Map()
  const connect = (key, edgeIndex) => {
    const list = adjacency.get(key) || []
    list.push(edgeIndex)
    adjacency.set(key, list)
  }
  edges.forEach((edge, edgeIndex) => {
    connect(edge.startKey, edgeIndex)
    connect(edge.endKey, edgeIndex)
  })

  const unusedEdges = new Set(edges.map((_, edgeIndex) => edgeIndex))
  const loops = []
  while (unusedEdges.size > 0) {
    const firstEdgeIndex = unusedEdges.values().next().value
    const firstBoundaryEdge = edges[firstEdgeIndex]
    unusedEdges.delete(firstEdgeIndex)
    const startKey = firstBoundaryEdge.startKey
    let previousKey = startKey
    let currentKey = firstBoundaryEdge.endKey
    const loopKeys = [startKey, currentKey]
    let guard = edges.length + 1

    while (currentKey !== startKey && guard > 0) {
      guard -= 1
      const candidateIndices = (adjacency.get(currentKey) || [])
        .filter(edgeIndex => unusedEdges.has(edgeIndex))
      if (candidateIndices.length === 0) break
      const nextEdgeIndex = candidateIndices.find(edgeIndex => {
        const edge = edges[edgeIndex]
        const otherKey = edge.startKey === currentKey ? edge.endKey : edge.startKey
        return otherKey !== previousKey
      }) ?? candidateIndices[0]
      const nextEdge = edges[nextEdgeIndex]
      unusedEdges.delete(nextEdgeIndex)
      const nextKey = nextEdge.startKey === currentKey
        ? nextEdge.endKey
        : nextEdge.startKey
      previousKey = currentKey
      currentKey = nextKey
      loopKeys.push(currentKey)
    }

    if (currentKey === startKey && loopKeys.length > 3) {
      loopKeys.pop()
      loops.push(loopKeys)
    }
  }

  if (loops.length === 0) return null
  const signedArea = loop => loop.reduce((area, key, index) => {
    const point = boundaryPoints.get(key)
    const nextPoint = boundaryPoints.get(loop[(index + 1) % loop.length])
    return area + ((point.x * nextPoint.z) - (nextPoint.x * point.z))
  }, 0) * 0.5
  const boundaryLoop = loops.reduce((largest, loop) => (
    Math.abs(signedArea(loop)) > Math.abs(signedArea(largest)) ? loop : largest
  ), loops[0])

  const centerX = (bounds.min.x + bounds.max.x) / 2
  const centerZ = (bounds.min.z + bounds.max.z) / 2
  const footprint = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z)
  const y = bounds.max.y + (footprint * 0.0028)
  const positions = []
  const indices = []
  const outwardNormal = (start, end) => {
    const deltaX = end.x - start.x
    const deltaZ = end.z - start.z
    const length = Math.max(1e-8, Math.hypot(deltaX, deltaZ))
    let x = -deltaZ / length
    let z = deltaX / length
    const midpointX = (start.x + end.x) / 2
    const midpointZ = (start.z + end.z) / 2
    if (((midpointX - centerX) * x) + ((midpointZ - centerZ) * z) < 0) {
      x *= -1
      z *= -1
    }
    return { x, z }
  }

  boundaryLoop.forEach((key, index) => {
    const previous = boundaryPoints.get(
      boundaryLoop[(index - 1 + boundaryLoop.length) % boundaryLoop.length]
    )
    const point = boundaryPoints.get(key)
    const next = boundaryPoints.get(boundaryLoop[(index + 1) % boundaryLoop.length])
    const previousNormal = outwardNormal(previous, point)
    const nextNormal = outwardNormal(point, next)
    let normalX = previousNormal.x + nextNormal.x
    let normalZ = previousNormal.z + nextNormal.z
    const normalLength = Math.max(1e-8, Math.hypot(normalX, normalZ))
    normalX /= normalLength
    normalZ /= normalLength
    const miterDot = Math.max(0.42, (normalX * nextNormal.x) + (normalZ * nextNormal.z))
    const miterScale = Math.min(2.35, 1 / miterDot)
    normalX *= miterScale
    normalZ *= miterScale
    positions.push(
      point.x + (normalX * outset), y, point.z + (normalZ * outset),
      point.x + (normalX * (outset + width)), y,
      point.z + (normalZ * (outset + width))
    )
  })
  boundaryLoop.forEach((_, index) => {
    const nextIndex = (index + 1) % boundaryLoop.length
    const inner = index * 2
    const outer = inner + 1
    const nextInner = nextIndex * 2
    const nextOuter = nextInner + 1
    indices.push(inner, nextInner, nextOuter, inner, nextOuter, outer)
  })
  if (positions.length === 0) return null
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

function createRoundedRectangleBoundary(rectangle, expansion = 0, segments = 8) {
  const minX = rectangle.minX - expansion
  const maxX = rectangle.maxX + expansion
  const minZ = rectangle.minZ - expansion
  const maxZ = rectangle.maxZ + expansion
  const radius = Math.min(
    Math.max(0.0001, rectangle.radius + expansion),
    (maxX - minX) / 2,
    (maxZ - minZ) / 2
  )
  const corners = [
    { x: maxX - radius, z: maxZ - radius, angle: 0 },
    { x: minX + radius, z: maxZ - radius, angle: Math.PI / 2 },
    { x: minX + radius, z: minZ + radius, angle: Math.PI },
    { x: maxX - radius, z: minZ + radius, angle: Math.PI * 1.5 }
  ]
  const points = []
  for (const corner of corners) {
    for (let index = 0; index < segments; index += 1) {
      const angle = corner.angle + ((index / segments) * Math.PI * 0.5)
      points.push({
        x: corner.x + (Math.cos(angle) * radius),
        z: corner.z + (Math.sin(angle) * radius)
      })
    }
  }
  return points
}

function createRoundedPlateSurfaceGeometry(THREE, plates, y) {
  const positions = []
  const indices = []
  for (const plate of plates) {
    const boundary = createRoundedRectangleBoundary(plate)
    const vertexBase = positions.length / 3
    positions.push(
      (plate.minX + plate.maxX) / 2,
      y,
      (plate.minZ + plate.maxZ) / 2
    )
    boundary.forEach(point => positions.push(point.x, y, point.z))
    boundary.forEach((_, index) => {
      const current = vertexBase + 1 + index
      const next = vertexBase + 1 + ((index + 1) % boundary.length)
      indices.push(vertexBase, next, current)
    })
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

function createRoundedPlateRibbonGeometry(THREE, plates, y, width, outset = 0) {
  const positions = []
  const indices = []
  for (const plate of plates) {
    const innerBoundary = createRoundedRectangleBoundary(plate, outset)
    const outerBoundary = createRoundedRectangleBoundary(plate, outset + width)
    const vertexBase = positions.length / 3
    innerBoundary.forEach((point, index) => {
      const outerPoint = outerBoundary[index]
      positions.push(point.x, y, point.z, outerPoint.x, y, outerPoint.z)
    })
    innerBoundary.forEach((_, index) => {
      const nextIndex = (index + 1) % innerBoundary.length
      const inner = vertexBase + (index * 2)
      const outer = inner + 1
      const nextInner = vertexBase + (nextIndex * 2)
      const nextOuter = nextInner + 1
      indices.push(inner, nextInner, nextOuter, inner, nextOuter, outer)
    })
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

function getVoltagePlateLayout(sourceNode, footprint) {
  const bounds = sourceNode.geometry.boundingBox
  const spanX = bounds.max.x - bounds.min.x
  const spanZ = bounds.max.z - bounds.min.z
  const xInset = spanX * 0.05
  const zInset = spanZ * 0.09
  const laneGap = spanZ * 0.085
  const laneDepth = (spanZ - (zInset * 2) - laneGap) / 2
  const minX = bounds.min.x + xInset
  const maxX = bounds.max.x - xInset
  const centerZ = (bounds.min.z + bounds.max.z) / 2
  const radius = Math.min(laneDepth * 0.23, (maxX - minX) * 0.055)
  const plates = [
    {
      minX,
      maxX,
      minZ: bounds.min.z + zInset,
      maxZ: centerZ - (laneGap / 2),
      radius
    },
    {
      minX,
      maxX,
      minZ: centerZ + (laneGap / 2),
      maxZ: bounds.max.z - zInset,
      radius
    }
  ]
  const y = bounds.max.y + (footprint * 0.004)
  return { plates, y }
}

function createVoltagePlateGeometries(THREE, sourceNode, footprint) {
  const { plates, y } = getVoltagePlateLayout(sourceNode, footprint)
  return {
    surface: createRoundedPlateSurfaceGeometry(THREE, plates, y),
    core: createRoundedPlateRibbonGeometry(THREE, plates, y, footprint * 0.0046),
    halo: createRoundedPlateRibbonGeometry(
      THREE,
      plates,
      y,
      footprint * 0.011,
      footprint * 0.0015
    ),
    outerHalo: createRoundedPlateRibbonGeometry(
      THREE,
      plates,
      y,
      footprint * 0.022,
      footprint * 0.003
    ),
    surfaceOffsetY: 0
  }
}

function insetTopSurfaceGeometry(geometry, inset) {
  if (!geometry || inset <= 0) return geometry
  geometry.computeBoundingBox()
  const bounds = geometry.boundingBox
  const position = geometry.getAttribute('position')
  if (!bounds || !position) return geometry
  const spanX = Math.max(1e-8, bounds.max.x - bounds.min.x)
  const spanZ = Math.max(1e-8, bounds.max.z - bounds.min.z)
  const centerX = (bounds.min.x + bounds.max.x) / 2
  const centerZ = (bounds.min.z + bounds.max.z) / 2
  const scaleX = Math.max(0.9, (spanX - (inset * 2)) / spanX)
  const scaleZ = Math.max(0.9, (spanZ - (inset * 2)) / spanZ)
  for (let index = 0; index < position.count; index += 1) {
    position.setXYZ(
      index,
      centerX + ((position.getX(index) - centerX) * scaleX),
      position.getY(index),
      centerZ + ((position.getZ(index) - centerZ) * scaleZ)
    )
  }
  position.needsUpdate = true
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function createActivationOverlay(THREE, sourceNode, {
  name,
  surfaceColor,
  coreColor,
  haloColor,
  outerHaloColor,
  surfaceOpacity,
  coreOpacity,
  haloOpacity,
  outerHaloOpacity,
  surfaceAlwaysVisible = false,
  surfaceEnergyDrive = null,
  surfaceInset = 0,
  boundaryInset = 0,
  geometryFactory = null,
  renderOrder = 28
}) {
  if (!sourceNode?.isMesh || !sourceNode.geometry) return null
  sourceNode.geometry.computeBoundingBox()
  const bounds = sourceNode.geometry.boundingBox
  if (!bounds) return null
  const footprint = Math.max(
    bounds.max.x - bounds.min.x,
    bounds.max.z - bounds.min.z
  )

  const createGlowMaterial = color => new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false
  })

  const markSinglePass = material => {
    material.forceSinglePass = true
    return material
  }

  const surfaceMaterial = markSinglePass(new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(surfaceColor) },
      uEnergyColor: { value: new THREE.Color(0xffff66) },
      uOpacity: { value: 0 },
      uEnergyAmount: { value: surfaceEnergyDrive ? 1 : 0 },
      uEnergyStrength: surfaceEnergyDrive?.strength ?? { value: 0 },
      uEnergyTime: surfaceEnergyDrive?.time ?? { value: 0 },
      uDeviceWorldInverse: {
        value: surfaceEnergyDrive?.deviceWorldInverse ?? new THREE.Matrix4()
      }
    },
    vertexShader: `
      uniform mat4 uDeviceWorldInverse;
      varying vec3 vPqiDevicePosition;
      void main() {
        vPqiDevicePosition = (
          uDeviceWorldInverse * modelMatrix * vec4(position, 1.0)
        ).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform vec3 uEnergyColor;
      uniform float uOpacity;
      uniform float uEnergyAmount;
      uniform float uEnergyStrength;
      uniform float uEnergyTime;
      varying vec3 vPqiDevicePosition;
      ${VOLTAGE_PACKET_GLSL}

      void main() {
        float rawPacket = pqiVoltagePacket(
          vPqiDevicePosition,
          uEnergyTime
        ) * clamp(uEnergyStrength, 0.0, 1.0) * uEnergyAmount;
        float packetHalo = smoothstep(0.015, 0.42, rawPacket);
        float packetCore = smoothstep(0.22, 0.9, rawPacket);
        vec3 color = uColor * 0.76;
        color = mix(color, uEnergyColor * 2.2, packetCore * 0.94);
        color += uEnergyColor * packetHalo * 0.42;
        float alpha = min(0.5, uOpacity * (1.0 + (packetHalo * 1.35)));
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.FrontSide,
    toneMapped: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  }))
  const coreMaterial = markSinglePass(createGlowMaterial(coreColor))
  const haloMaterial = markSinglePass(createGlowMaterial(haloColor))
  const outerHaloMaterial = markSinglePass(createGlowMaterial(outerHaloColor))
  const geometrySet = geometryFactory
    ? geometryFactory(THREE, sourceNode, footprint)
    : {
        surface: createTopSurfaceGeometry(THREE, sourceNode.geometry),
        core: createTopBoundaryRibbonGeometry(
          THREE,
          sourceNode.geometry,
          footprint * 0.0046,
          -footprint * (0.0023 + boundaryInset)
        ),
        halo: createTopBoundaryRibbonGeometry(
          THREE,
          sourceNode.geometry,
          footprint * 0.011,
          footprint * (0.0015 - boundaryInset)
        ),
        outerHalo: createTopBoundaryRibbonGeometry(
          THREE,
          sourceNode.geometry,
          footprint * 0.022,
          footprint * (0.003 - boundaryInset)
        ),
        surfaceOffsetY: footprint * 0.0028
      }
  const surfaceGeometry = geometrySet.surface
  const coreGeometry = geometrySet.core
  const haloGeometry = geometrySet.halo
  const outerHaloGeometry = geometrySet.outerHalo
  insetTopSurfaceGeometry(surfaceGeometry, footprint * surfaceInset)
  if (!surfaceGeometry || !coreGeometry || !haloGeometry || !outerHaloGeometry) {
    surfaceGeometry?.dispose()
    coreGeometry?.dispose()
    haloGeometry?.dispose()
    outerHaloGeometry?.dispose()
    surfaceMaterial.dispose()
    coreMaterial.dispose()
    haloMaterial.dispose()
    outerHaloMaterial.dispose()
    return null
  }
  const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial)
  const core = new THREE.Mesh(coreGeometry, coreMaterial)
  const halo = new THREE.Mesh(haloGeometry, haloMaterial)
  const outerHalo = new THREE.Mesh(outerHaloGeometry, outerHaloMaterial)

  surface.name = `${name}_SURFACE`
  surface.position.y = geometrySet.surfaceOffsetY ?? 0
  surface.renderOrder = renderOrder
  surface.frustumCulled = false

  core.name = `${name}_CORE`
  core.renderOrder = renderOrder + 3
  core.frustumCulled = false

  halo.name = `${name}_HALO`
  halo.renderOrder = renderOrder + 2
  halo.frustumCulled = false

  outerHalo.name = `${name}_OUTER_HALO`
  outerHalo.renderOrder = renderOrder + 1
  outerHalo.frustumCulled = false

  const overlay = new THREE.Group()
  overlay.name = name
  overlay.frustumCulled = false
  overlay.visible = false
  /* Decoration, not structure: it glows on top of the device rather than being
     part of its body, so in overlay mode it is hidden outright instead of
     being kept as an occluder. */
  overlay.userData.pqiDecoration = true
  overlay.userData.surfaceMaterial = surfaceMaterial
  overlay.userData.coreMaterial = coreMaterial
  overlay.userData.haloMaterial = haloMaterial
  overlay.userData.outerHaloMaterial = outerHaloMaterial
  overlay.userData.surfaceAlwaysVisible = surfaceAlwaysVisible
  overlay.userData.opacityProfile = {
    surface: surfaceOpacity,
    core: coreOpacity,
    halo: haloOpacity,
    outerHalo: outerHaloOpacity
  }
  overlay.add(surface, outerHalo, halo, core)
  return overlay
}

function createTemperatureActivationOverlay(THREE, sourceNode) {
  return createActivationOverlay(THREE, sourceNode, {
    name: 'PQI_TEMPERATURE_ACTIVATION',
    surfaceColor: 0x4f8fe8,
    coreColor: 0xb7fbff,
    haloColor: 0x3addff,
    outerHaloColor: 0x5476ff,
    surfaceOpacity: 0.32,
    coreOpacity: 0.9,
    haloOpacity: 0.46,
    outerHaloOpacity: 0.18,
    surfaceAlwaysVisible: true,
    surfaceInset: 0.009,
    boundaryInset: 0.009,
    renderOrder: 28
  })
}

function createVoltageActivationOverlay(THREE, sourceNode, voltageDrive) {
  return createActivationOverlay(THREE, sourceNode, {
    name: 'PQI_VOLTAGE_ACTIVATION',
    surfaceColor: 0xffc936,
    coreColor: 0xfff4a8,
    haloColor: 0xffcc36,
    outerHaloColor: 0xff9d18,
    surfaceOpacity: 0.17,
    coreOpacity: 0.96,
    haloOpacity: 0.5,
    outerHaloOpacity: 0.2,
    surfaceEnergyDrive: voltageDrive,
    geometryFactory: createVoltagePlateGeometries,
    renderOrder: 33
  })
}

function createVoltageLightningIcon(THREE, sourceNode) {
  if (!sourceNode?.isMesh || !sourceNode.geometry) return null
  sourceNode.geometry.computeBoundingBox()
  const bounds = sourceNode.geometry.boundingBox
  if (!bounds) return null

  const footprint = Math.max(
    bounds.max.x - bounds.min.x,
    bounds.max.z - bounds.min.z
  )
  const { plates, y } = getVoltagePlateLayout(sourceNode, footprint)
  const minX = Math.min(...plates.map(plate => plate.minX))
  const maxX = Math.max(...plates.map(plate => plate.maxX))
  const minZ = Math.min(...plates.map(plate => plate.minZ))
  const maxZ = Math.max(...plates.map(plate => plate.maxZ))
  const plateLength = maxX - minX
  const iconWidth = plateLength * 0.2
  const iconAspect = 1459 / 1078

  const texture = new THREE.TextureLoader().load(assetUrl(VOLTAGE_ICON_PATH))
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter

  const material = new THREE.SpriteMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    alphaTest: 0.002,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    sizeAttenuation: true,
    toneMapped: false
  })
  const icon = new THREE.Sprite(material)
  icon.name = 'PQI_VOLTAGE_LIGHTNING_ICON'
  icon.position.set(
    minX - (plateLength * 0.01),
    y + (footprint * 0.09),
    (minZ + maxZ) / 2
  )
  icon.scale.set(iconWidth, iconWidth / iconAspect, 1)
  icon.renderOrder = 38
  icon.frustumCulled = false
  icon.visible = false
  icon.userData.pqiDecoration = true
  icon.userData.material = material
  icon.userData.basePosition = icon.position.clone()
  icon.userData.baseScale = icon.scale.clone()
  icon.userData.footprint = footprint
  return icon
}

function electricalJitter(time, seed) {
  const sample = time * 6.5
  const index = Math.floor(sample)
  const progress = sample - index
  const easedProgress = progress * progress * (3 - (2 * progress))
  const randomAt = value => {
    const noise = Math.sin((value + seed) * 12.9898) * 43758.5453
    return ((noise - Math.floor(noise)) * 2) - 1
  }
  const current = randomAt(index)
  return current + ((randomAt(index + 1) - current) * easedProgress)
}

function updateVoltageLightningIcon(
  icon,
  voltageStrength,
  visualTime,
  reducedMotion
) {
  if (!icon) return
  const strength = clamp((voltageStrength - 0.08) / 0.72)
  icon.visible = strength > 0.001
  if (!icon.visible) return

  const activity = reducedMotion ? 0 : strength
  const footprint = icon.userData.footprint
  const basePosition = icon.userData.basePosition
  const baseScale = icon.userData.baseScale
  const xJitter = electricalJitter(visualTime, 1.7)
  const yJitter = electricalJitter(visualTime, 5.3)
  const zJitter = electricalJitter(visualTime, 9.1)
  const rotationJitter = electricalJitter(visualTime, 13.7)
  const flicker = electricalJitter(visualTime, 18.2)

  icon.position.set(
    basePosition.x + (xJitter * footprint * 0.002 * activity),
    basePosition.y + (yJitter * footprint * 0.0015 * activity),
    basePosition.z + (zJitter * footprint * 0.001 * activity)
  )
  icon.userData.material.rotation = rotationJitter * 0.018 * activity
  icon.userData.material.opacity = strength * (0.94 + (flicker * 0.025 * activity))
  const scaleFlicker = 1 + (flicker * 0.012 * activity)
  icon.scale.set(
    baseScale.x * scaleFlicker,
    baseScale.y * scaleFlicker,
    1
  )
}

function updateActivationOverlay(overlay, strength, visualTime, reducedMotion) {
  if (!overlay) return
  const normalizedStrength = clamp(strength, 0, 1.15)
  const profile = overlay.userData.opacityProfile
  const breath = reducedMotion
    ? 1
    : 0.95 + (Math.sin((visualTime * 1.8) + 0.6) * 0.05)
  const surfaceUniforms = overlay.userData.surfaceMaterial.uniforms
  const surfaceStrength = overlay.userData.surfaceAlwaysVisible
    ? 1
    : normalizedStrength
  surfaceUniforms.uOpacity.value = surfaceStrength * profile.surface
  overlay.userData.coreMaterial.opacity = normalizedStrength * profile.core
  overlay.userData.haloMaterial.opacity = normalizedStrength * profile.halo * breath
  overlay.userData.outerHaloMaterial.opacity = normalizedStrength * profile.outerHalo * breath
  overlay.visible = overlay.userData.surfaceAlwaysVisible || normalizedStrength > 0.001
}

function createParticleGeometry(THREE, data) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(data.basePosition, 3))
  geometry.setAttribute('aThermal', new THREE.BufferAttribute(data.thermal, 4))
  geometry.setAttribute('aVoltageDisplacement', new THREE.BufferAttribute(data.voltageDisplacement, 3))
  geometry.setAttribute('aOvervoltageDisplacement', new THREE.BufferAttribute(data.overvoltageDisplacement, 3))
  geometry.setAttribute('aMagneticDisplacement', new THREE.BufferAttribute(data.magneticDisplacement, 3))
  geometry.setAttribute('aRole', new THREE.BufferAttribute(data.role, 1))
  geometry.setAttribute('aMinTier', new THREE.BufferAttribute(data.minTier, 1))
  geometry.computeBoundingSphere()
  if (geometry.boundingSphere) geometry.boundingSphere.radius += 4
  return geometry
}

function createParticleMaterial(THREE) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uThermalTime: { value: 0 },
      uVisualTime: { value: 0 },
      uTemperature: { value: 0 },
      uVoltage: { value: 0 },
      uVoltageOverdrive: { value: 0 },
      uMagnetic: { value: 0 },
      uCompletion: { value: 0 },
      uDetailLevel: { value: PARTICLE_TIER_LEVELS.high },
      uPixelRatio: { value: 1 }
    },
    vertexShader: `
      attribute vec4 aThermal;
      attribute vec3 aVoltageDisplacement;
      attribute vec3 aOvervoltageDisplacement;
      attribute vec3 aMagneticDisplacement;
      attribute float aRole;
      attribute float aMinTier;
      uniform float uThermalTime;
      uniform float uVisualTime;
      uniform float uTemperature;
      uniform float uVoltage;
      uniform float uVoltageOverdrive;
      uniform float uMagnetic;
      uniform float uCompletion;
      uniform float uDetailLevel;
      uniform float uPixelRatio;
      varying vec3 vParticleColor;
      varying float vVisibility;

      float pqiRoundedFootprintDistance(vec2 point) {
        vec2 halfSize = vec2(${PARTICLE_FOOTPRINT.halfWidth}, ${PARTICLE_FOOTPRINT.halfDepth});
        float radius = ${PARTICLE_FOOTPRINT.cornerRadius};
        vec2 q = abs(point) - (halfSize - vec2(radius));
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
      }

      vec2 pqiProjectToRoundedFootprint(vec2 point) {
        if (pqiRoundedFootprintDistance(point) <= 0.0) return point;
        vec2 halfSize = vec2(${PARTICLE_FOOTPRINT.halfWidth}, ${PARTICLE_FOOTPRINT.halfDepth});
        float radius = ${PARTICLE_FOOTPRINT.cornerRadius};
        vec2 inner = halfSize - vec2(radius);
        vec2 absolutePoint = abs(point);
        vec2 direction = sign(point);
        if (absolutePoint.x <= inner.x) return vec2(point.x, direction.y * halfSize.y);
        if (absolutePoint.y <= inner.y) return vec2(direction.x * halfSize.x, point.y);
        vec2 corner = absolutePoint - inner;
        return direction * (inner + (corner / max(length(corner), 0.000001)) * radius);
      }

      void main() {
        float tierVisibility = 1.0;
        if (aMinTier > 1.5) tierVisibility = smoothstep(1.0, 2.0, uDetailLevel);
        else if (aMinTier > 0.5) tierVisibility = smoothstep(0.0, 1.0, uDetailLevel);
        vVisibility = tierVisibility;

        float reserve = step(1.5, aRole);
        float pairLock = reserve * smoothstep(0.72, 1.0, uMagnetic);
        float coolingStrength = clamp(uTemperature, 0.0, 1.0);
        float thermalAmplitude = mix(
          ${THERMAL_MOTION_PROFILE.agitatedAmplitude.toFixed(2)},
          ${THERMAL_MOTION_PROFILE.settledAmplitude.toFixed(2)},
          coolingStrength
        );
        float travel = uThermalTime * aThermal.y;
        vec3 thermalNoise = vec3(
          sin(travel + aThermal.x) * aThermal.z,
          sin((travel * 1.3) + aThermal.x) * 0.025,
          cos((travel * 0.86) + aThermal.x) * aThermal.w
        ) * thermalAmplitude;
        vec3 effectPosition = position +
          (aVoltageDisplacement * uVoltage) +
          (aMagneticDisplacement * uMagnetic);
        vec3 overvoltagePosition = position + aOvervoltageDisplacement;
        effectPosition = mix(
          effectPosition,
          overvoltagePosition,
          reserve * clamp(uVoltageOverdrive, 0.0, 1.0)
        );
        float pqiEdgeAttenuation = smoothstep(
          0.0,
          ${PARTICLE_FOOTPRINT.edgeAttenuationDistance},
          -pqiRoundedFootprintDistance(effectPosition.xz)
        );
        float pqiEdgeMotion = mix(
          ${THERMAL_MOTION_PROFILE.edgeMotionFloor.toFixed(2)},
          1.0,
          pqiEdgeAttenuation
        );
        thermalNoise.xz *= pqiEdgeMotion;
        thermalNoise.xz *= mix(1.0, 0.07, pairLock);
        thermalNoise.y *= mix(1.0, 0.18, pairLock);
        vec3 transformed = effectPosition + thermalNoise;
        transformed.xz = pqiProjectToRoundedFootprint(transformed.xz);
        float magneticTargetY = position.y + aMagneticDisplacement.y;
        float pairedYCeiling = max(${PARTICLE_VOLUME.yMax}, magneticTargetY + 0.035);
        float particleYCeiling = mix(
          ${PARTICLE_VOLUME.yMax},
          pairedYCeiling,
          reserve * clamp(uMagnetic, 0.0, 1.0)
        );
        transformed.y = clamp(transformed.y, ${PARTICLE_VOLUME.yMin}, particleYCeiling);

        vec3 gold = vec3(1.0, 0.62, 0.12);
        vParticleColor = gold;

        vec4 modelViewPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * modelViewPosition;
        gl_PointSize = (0.68 + (pairLock * 0.18)) * uPixelRatio *
          (330.0 / max(1.0, -modelViewPosition.z)) * sqrt(max(0.0, tierVisibility));
        if (tierVisibility < 0.001) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          gl_PointSize = 0.0;
        }
      }
    `,
    fragmentShader: `
      varying vec3 vParticleColor;
      varying float vVisibility;
      void main() {
        vec2 centered = gl_PointCoord - 0.5;
        float radius = length(centered) * 2.0;
        if (radius > 1.0) discard;
        float core = 1.0 - smoothstep(0.035, 0.43, radius);
        float glow = 1.0 - smoothstep(0.1, 1.0, radius);
        vec3 color = mix(vParticleColor, vec3(1.0, 0.995, 0.88), core * 0.9);
        gl_FragColor = vec4(color * (1.0 + (core * 0.22)), (core + (glow * 0.98)) * vVisibility);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    stencilWrite: true,
    stencilRef: 1,
    stencilFunc: THREE.EqualStencilFunc,
    stencilFail: THREE.KeepStencilOp,
    stencilZFail: THREE.KeepStencilOp,
    stencilZPass: THREE.KeepStencilOp,
    toneMapped: false
  })
}

/* The board's magnetic pass is a metronome. Every crest is the same crest: same
   width, same bow, same length, evenly spaced around one cycle and carried at
   one speed along one heading. Anything that varies per ribbon — profile,
   spacing or easing — reads back as the pass speeding up and slowing down, so
   the only thing that differs between them is the colour phase. */
const MAGNETIC_RIBBON_COUNT = 9
/* The ramp can only be as wide as the ribbon it is drawn on, so the ribbon is
   what had to give — wide enough for the surround to have somewhere to go,
   without the long dilute reach that 1.6 gave it.

   Several thresholds in the fragment shader are fractions of this width, and
   they are NOT one linked set. `shoulder` and the vapour noise frequency were
   rescaled with the width, to hold their size in world units. `core`,
   `hazeMask` and `fringeColorMask` were then tuned by eye against the design
   reference and no longer sit at the rescaled values. Changing this width again
   means rescaling the first group and re-checking the second against the
   reference — not multiplying all of them through. */
const MAGNETIC_RIBBON_HALF_WIDTH = 1.0
const MAGNETIC_RIBBON_HALF_LENGTH = 7.2
/* Depth of the bow, as a fraction of the crest's half length. Two things are
   folded in: the bow now lies flat instead of standing up, and the level
   direction it is taken along reads about fifteen percent smaller than the
   vertical did from this camera, so matching the delivered curve alone would
   want about 1.25. Carried past that on purpose — a flat bow needs more depth
   than an upright one before it reads as a curve rather than a straight edge
   sitting at an angle. */
const MAGNETIC_RIBBON_CURVE = 1.8
/* Solved, not scaled. The obvious move when the travel got longer was to divide
   this by the same factor, but the perspective reparametrisation sits between
   the two and that came out 21 percent fast. This is the value that puts the
   measured on-screen rate back where it was. */
const MAGNETIC_RIBBON_CYCLE_SPEED = 0.075
/* The delivered heading, kept: in low from the bottom right, out through the
   top left. Held as two endpoints rather than as a direction because the climb
   is the point — the pass crosses in front of the device, rises over it, and
   leaves behind it, and only the pair of endpoints says that.

   It is a heading in the device's own space, not a screen direction. On a plane
   raked this far, screen-up and away-from-camera are nearly the same move, so a
   heading solved for the screen either climbs clean off the device or visibly
   slows as it recedes. The authored one does neither. */
/* Both ends lifted 2.2 off the delivered heading, which is the smallest lift
   that stops the crest cutting through the device.

   The device is a thin slab — the GLB's own bounds put the whole of it inside
   local y -0.157 to +0.157 — and in overlay mode it is drawn as a depth-only
   occluder, so it clips whatever it intersects. The old path crossed it while
   still climbing out from below, and the ribbon is a flat sheet, so it went
   through the slab and came out the far side with a hard edge along the
   intersection. Measured: it reached 2.02 units below the device's top face.
   Lifting both ends by the same amount keeps the heading exactly as it was and
   only raises the track. */
/* Screen-left, in the device's own space. From the authored view the camera's
   right axis has no vertical component at all, so sliding the path along it
   moves it across the frame without raising or lowering it by a pixel — which
   is the only reason the lift above survives this shift untouched. One unit is
   10.8 percent of the frame width. */
const MAGNETIC_RIBBON_SCREEN_LEFT = Object.freeze({ x: -0.6737, y: 0, z: -0.739 })
const MAGNETIC_RIBBON_TRAVEL_SHIFT = 3.5

function shiftedAcross(point) {
  return Object.freeze({
    x: point.x + (MAGNETIC_RIBBON_SCREEN_LEFT.x * MAGNETIC_RIBBON_TRAVEL_SHIFT),
    y: point.y + (MAGNETIC_RIBBON_SCREEN_LEFT.y * MAGNETIC_RIBBON_TRAVEL_SHIFT),
    z: point.z + (MAGNETIC_RIBBON_SCREEN_LEFT.z * MAGNETIC_RIBBON_TRAVEL_SHIFT)
  })
}

const MAGNETIC_RIBBON_TRAVEL_START = shiftedAcross({ x: 0, y: 1.3, z: 7.2 })
const MAGNETIC_RIBBON_TRAVEL_END = shiftedAcross({ x: 0, y: 6.9, z: -7.2 })
/* Both ends pushed further out along that same line, so the crest is off frame
   at the wrap and the fade that hides the wrap never plays on screen.

   2.6 was enough while the canvas was the video's square; the taller canvas
   sees further up and down and brought the far end back into view, where the
   fade would have shown as a pop. 3.8 is the first value that clears both ends
   again, so this sits just past it.

   The count and the cycle speed are tied to this number. A longer travel at the
   same speed means the crests cross faster and sit further apart, so the speed
   is divided by the same factor this was multiplied by and the count multiplied
   by it — which is what keeps the pass looking identical. Change one of the
   three and the other two have to follow. */
const MAGNETIC_RIBBON_TRAVEL_OVERSHOOT = 4.0

function overshotTravel(from, to) {
  const midpoint = axis => (from[axis] + to[axis]) / 2
  const pushed = axis => midpoint(axis) +
    ((from[axis] - midpoint(axis)) * MAGNETIC_RIBBON_TRAVEL_OVERSHOOT)
  return { x: pushed('x'), y: pushed('y'), z: pushed('z') }
}

const MAGNETIC_RIBBON_TRAVEL_FROM = overshotTravel(
  MAGNETIC_RIBBON_TRAVEL_START,
  MAGNETIC_RIBBON_TRAVEL_END
)
const MAGNETIC_RIBBON_TRAVEL_TO = overshotTravel(
  MAGNETIC_RIBBON_TRAVEL_END,
  MAGNETIC_RIBBON_TRAVEL_START
)

function createMagneticAuroraRibbons(THREE) {
  const segments = 512
  const positions = []
  const phases = []
  const hues = []
  const indices = []

  for (let ribbon = 0; ribbon < MAGNETIC_RIBBON_COUNT; ribbon += 1) {
    /* Evenly spaced around the cycle, so the gap between crests is the same
       everywhere including across the wrap. */
    const phase = ribbon / MAGNETIC_RIBBON_COUNT
    /* Colour is the one thing allowed to differ, and it is spaced by the golden
       ratio rather than by phase: tying it to phase would make every crest an
       exact copy of the one before it, down to the vapour. */
    const hue = (ribbon * 0.618033988749895) % 1
    const vertexBase = positions.length / 3
    for (let index = 0; index <= segments; index += 1) {
      const progress = index / segments
      for (const edge of [-1, 1]) {
        positions.push(progress, edge, 0)
        phases.push(phase)
        hues.push(hue)
      }
    }
    for (let index = 0; index < segments; index += 1) {
      const left = vertexBase + (index * 2)
      indices.push(left, left + 1, left + 2, left + 1, left + 3, left + 2)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1))
  geometry.setAttribute('aHue', new THREE.Float32BufferAttribute(hues, 1))
  geometry.setIndex(indices)

  const timeUniform = { value: 0 }
  const strengthUniform = { value: 0 }
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: timeUniform,
      uStrength: strengthUniform,
      uWidthScale: { value: 1 }
    },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      attribute float aHue;
      uniform float uTime;
      uniform float uWidthScale;
      varying float vEdge;
      varying float vProgress;
      varying float vPhase;
      varying float vHue;
      varying float vSweepFade;

      void main() {
        float progress = position.x;
        /* Even in phase — no easing, and the crests evenly spaced around the
           cycle. Not even in ground covered: the reparametrisation below bends
           this deliberately so that what comes out even is the motion on
           screen. */
        float sweep = fract((uTime * ${MAGNETIC_RIBBON_CYCLE_SPEED.toFixed(6)}) + aPhase);

        vec3 travelFrom = vec3(
          ${MAGNETIC_RIBBON_TRAVEL_FROM.x.toFixed(6)},
          ${MAGNETIC_RIBBON_TRAVEL_FROM.y.toFixed(6)},
          ${MAGNETIC_RIBBON_TRAVEL_FROM.z.toFixed(6)}
        );
        vec3 travelTo = vec3(
          ${MAGNETIC_RIBBON_TRAVEL_TO.x.toFixed(6)},
          ${MAGNETIC_RIBBON_TRAVEL_TO.y.toFixed(6)},
          ${MAGNETIC_RIBBON_TRAVEL_TO.z.toFixed(6)}
        );
        /* Paced so that it is the crest's position ON SCREEN that advances
           evenly, not its position in the room. The heading climbs away from
           the camera, and an evenly paced walk along it arrives more and more
           foreshortened: the pass drifts in briskly and then crawls out, and the
           gaps between crests close up behind it. Both are perspective, not
           timing, and no amount of evening out the phases touches them.

           This is the perspective-correct reparametrisation — the same one that
           keeps a texture from swimming across a raked quad. Step evenly through
           reciprocal depth and the projection comes out even. */
        vec4 fromInView = modelViewMatrix * vec4(travelFrom, 1.0);
        vec4 toInView = modelViewMatrix * vec4(travelTo, 1.0);
        float fromDepth = -fromInView.z;
        float toDepth = -toInView.z;
        /* Guarded against the camera, not against zero. Reciprocal depth only
           means anything while both ends are in front of the lens, and the
           alignment pass can orbit. Clamping a behind-camera end to some small
           epsilon would not divide by zero — it would do something worse, and
           quietly: an end at a depth of a thousandth carries a thousandfold
           weight, so the crest would cover its whole travel in the first frames
           of the cycle and then sit still. Falling back to pacing along the
           line is merely uneven, which is the failure worth having. The
           threshold is the camera's own near plane. */
        float alongTravel = sweep;
        if (fromDepth > 0.05 && toDepth > 0.05) {
          float towardEnd = sweep / toDepth;
          alongTravel = towardEnd / (((1.0 - sweep) / fromDepth) + towardEnd);
        }
        vec3 travelCentre = mix(travelFrom, travelTo, alongTravel);

        /* The crest runs across the heading and stays level with the device: a
           cross product with the world up is perpendicular to both, so no part
           of the crest ever leaves the plane the topoconductor lies in, however
           steeply the heading itself climbs. */
        vec3 planeUp = vec3(0.0, 1.0, 0.0);
        vec3 crestAxis = normalize(cross(planeUp, travelTo - travelFrom));
        vec3 bowAxis = cross(crestAxis, planeUp);

        /* The bow is taken along that level axis rather than along the heading.
           Either would curve the crest forward, but only this one keeps the
           curve parallel to the device: bowing along the heading tips it out of
           the plane, and a crest tipped out of the plane reads as a hoop stood
           on its edge and pushed along rather than a wave passing over. */
        float across = (progress * 2.0) - 1.0;
        float bow = 1.0 - (across * across);
        vec3 centre = travelCentre +
          (bowAxis * (bow * ${MAGNETIC_RIBBON_CURVE.toFixed(6)})) +
          (crestAxis * (across * ${MAGNETIC_RIBBON_HALF_LENGTH.toFixed(6)}));
        vec3 tangent = normalize(
          (crestAxis * ${MAGNETIC_RIBBON_HALF_LENGTH.toFixed(6)}) +
          (bowAxis * (-2.0 * across * ${MAGNETIC_RIBBON_CURVE.toFixed(6)}))
        );

        vec3 worldCentre = (modelMatrix * vec4(centre, 1.0)).xyz;
        vec3 worldTangent = normalize(mat3(modelMatrix) * tangent);
        vec3 viewDirection = normalize(cameraPosition - worldCentre);
        vec3 ribbonSide = normalize(cross(worldTangent, viewDirection));
        vec3 worldPosition = worldCentre + (ribbonSide * position.y *
          ${MAGNETIC_RIBBON_HALF_WIDTH.toFixed(6)} * uWidthScale);

        vEdge = position.y;
        vProgress = progress;
        vPhase = aPhase;
        vHue = aHue;
        /* Insurance only. Both ends of the travel sit outside the frame, so
           this is never something anyone watches happen. */
        vSweepFade = smoothstep(0.0, 0.04, sweep) *
          (1.0 - smoothstep(0.96, 1.0, sweep));
        gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uStrength;
      varying float vEdge;
      varying float vProgress;
      varying float vPhase;
      varying float vHue;
      varying float vSweepFade;

      float pqiAuroraHash(vec2 point) {
        vec3 wrapped = fract(vec3(point.xyx) * vec3(0.1031, 0.103, 0.0973));
        wrapped += dot(wrapped, wrapped.yxz + 33.33);
        return fract((wrapped.x + wrapped.y) * wrapped.z);
      }

      float pqiAuroraNoise(vec2 point) {
        vec2 cell = floor(point);
        vec2 local = fract(point);
        local = local * local * (3.0 - (2.0 * local));
        return mix(
          mix(pqiAuroraHash(cell), pqiAuroraHash(cell + vec2(1.0, 0.0)), local.x),
          mix(
            pqiAuroraHash(cell + vec2(0.0, 1.0)),
            pqiAuroraHash(cell + vec2(1.0, 1.0)),
            local.x
          ),
          local.y
        );
      }

      void main() {
        float edgeDistance = abs(vEdge);
        vec2 vaporCoordinate = vec2(
          (vProgress * 5.4) - (uTime * 0.02) + (vPhase * 7.0),
          (vEdge * 4.3) + (vHue * 5.0)
        );
        float broadVapor = pqiAuroraNoise(vaporCoordinate * 0.72);
        float vapor = mix(
          broadVapor,
          pqiAuroraNoise((vaporCoordinate * 1.45) + 4.3),
          0.14
        );
        /* The band's shape across its width, matched to the design reference.

           A solid spine, a step down where it ends, and a surround that thins
           from there to nothing. Two colours were picked off the reference —
           the band at #8887d5 and the surround at #989ee8 — and both sit on the
           same line out from the background, same hue, the surround at four
           tenths the strength. What separates them is opacity, not colour, so
           that is where the step lives.

           The falloff is a single power curve rather than curves summed and
           clamped. A clamp pins the middle flat at full strength and leaves a
           knee where it lets go, and that knee reads as a hard edge on the
           band. An exponent above one lands at zero exactly on the strip
           boundary with no slope left, so there is nothing to clip.

           The two dials: the exponent spreads the surround wider as it goes
           down, and the mix floor sets how far the step drops. */
        float spine = 1.0 - smoothstep(0.0414, 0.0608, edgeDistance);
        float surroundFalloff = pow(
          max(0.0, 1.0 - (edgeDistance * edgeDistance)),
          1.06
        );
        /* The glow carries its own opacity. Colour alone cannot make the
           surround pale: mixing toward white at the alpha the falloff leaves
           out there only tints the ground a few levels, which is why the
           surround kept reading as a wash rather than a glow. This lobe adds
           opacity across the glow band and nowhere else — it is zero at the
           spine, so the dark core keeps exactly the alpha it had and still
           composites to the colour it was matched to. */
        float glowLobe = smoothstep(0.0495, 0.126, edgeDistance) *
          (1.0 - smoothstep(0.4, 0.95, edgeDistance));
        /* The gain came down as the overall scale went up. Between them the
           glow is more solid than it was, but the product now peaks at 0.74
           rather than clipping: at the old gain against the new scale it
           reached 1.45, and everything past 1.0 is a flat fully opaque band
           that would blot out the device it passes over. */
        /* Solved, not chosen: this is the gain that puts the glow's peak
           opacity at 0.573, seven tenths of the 0.818 it was carrying before.
           With the middle back down to 0.5 there is room for it — the peak
           reaches 0.66 even at the drive ceiling, well under the clamp at one,
           and the glow sits 1.15 times the middle's opacity. */
        float opticalProfile = surroundFalloff *
          (mix(0.86, 1.0, spine) + (glowLobe * 0.3049));

        /* Across the body of the ribbon the vapour scales the haze rather than
           cutting it. Thresholding drew a contour through the outer haze
           wherever the noise crossed the cut, and a contour is a line however
           soft its sides are; scaling leaves every gradient continuous, so the
           haze thickens and thins and still arrives at nothing on the profile's
           own terms.

           The cut is kept at the crest's two tips, where it erodes them into
           something less like a cropped ribbon — see endpointSurvival below.
           vaporAA exists for that one consumer and nothing else. */
        float hazeMask = smoothstep(0.192, 0.568, edgeDistance);
        float vaporAA = max(fwidth(vapor) * 1.5, 0.012);
        float vaporSurvival = mix(0.6, 1.0, vapor);
        float centeredProgress = abs((vProgress * 2.0) - 1.0);
        float visibleLength = 1.0 - centeredProgress;
        float revealAA = max(fwidth(visibleLength) * 1.5, 0.002);
        float endFeather = smoothstep(
          0.0,
          0.2 + revealAA,
          visibleLength
        );
        float endpointZone = 1.0 - smoothstep(0.03, 0.22, visibleLength);
        float endpointThreshold = mix(0.48, 0.78, endpointZone);
        float endpointSurvival = smoothstep(
          endpointThreshold - vaporAA,
          endpointThreshold + 0.1 + vaporAA,
          vapor
        );
        float hazeSurvival = vaporSurvival *
          mix(1.0, endpointSurvival, endpointZone);
        float vaporizedProfile = opticalProfile *
          mix(1.0, hazeSurvival, hazeMask);
        /* Flat, not a gradient, and now flat for 98 percent of the band.
           Ramping from the centre meant the true dark was a single line down
           the middle with everything either side already on its way out.

           Two percent of this band is 0.0009 of the strip, which is comfortably
           under a pixel on screen, so the ramp would alias into a staircase if
           it were taken literally. fwidth widens it to a pixel when it needs to
           be and leaves the 98 percent alone when it does not. */
        float coreAA = fwidth(edgeDistance);
        float core = 1.0 - smoothstep(
          min(0.0441, 0.045 - coreAA),
          0.045 + coreAA,
          edgeDistance
        );
        float shoulder = smoothstep(0.101, 0.328, edgeDistance) *
          (1.0 - smoothstep(0.403, 0.579, edgeDistance));

        /* Solved against the reference rather than chosen: at the spine's
           opacity this is the colour that composites to #8887d5, the value
           picked off the reference band. The old near-black purple came out a
           touch green and short of blue once laid over the ground. */
        vec3 darkPurple = vec3(0.2, 0.0, 0.48);
        vec3 deepViolet = vec3(0.28, 0.06, 0.56);
        vec3 violetMist = vec3(0.58, 0.34, 0.88);
        vec3 magentaMist = vec3(0.72, 0.3, 0.74);
        vec3 blueMist = vec3(0.35, 0.62, 0.92);
        float spectralFlow = 0.5 + (0.5 * sin(
          (vProgress * 5.2) - (uTime * 0.16) + (vHue * 6.28318530718)
        ));
        vec3 spectral = mix(deepViolet, violetMist, 0.34 + (spectralFlow * 0.38));
        spectral = mix(spectral, magentaMist, 0.06 + (spectralFlow * 0.1));
        spectral = mix(spectral, blueMist, shoulder * (0.04 + (vapor * 0.07)));
        vec3 color = mix(spectral, darkPurple, core * 0.86);
        color *= 0.86 + (shoulder * 0.12);
        /* The glow around the spine goes almost to white, and gets there fast.
           The core is dark out to 0.19 and this ramps in from 0.2, so the two
           meet at a boundary rather than blending: a solid dark band with a pale
           halo around it, which is the read being asked for.

           It is lighter than the ground it sits on, so unlike every earlier
           attempt at a pale surround it does not vanish into it. */
        float fringeColorMask = smoothstep(0.054, 0.1305, edgeDistance) *
          hazeSurvival;
        /* Lavender rather than the cool blue-white it was: red and green pulled
           down together and blue left at the top, which walks it around to pale
           purple instead of making it colder. */
        vec3 coolWhiteFringe = vec3(0.86, 0.82, 1.0);
        color = mix(color, coolWhiteFringe, fringeColorMask);

        /* The profile is the whole falloff. Two further tapers used to hang
           off the core here, and between them they cut the haze to 0.374 of
           what the profile asked for by a third of the way out, then held it
           flat at that. A second falloff, steeper than the real one and over
           long before it — which is why the band stopped at a line well short
           of its own edge instead of thinning away. */
        /* Every factor here is bounded by one, so the ceiling is exactly the
           two constants times the profile, which the glow lobe carries above one. There used to be a min() on the
           next line pinning it to 0.3 — dead from the moment the scale dropped
           below 0.261, and worse than useless, because it read as a live safety
           rail. If the ceiling needs to move, move the scale. */
        float alpha = vaporizedProfile * endFeather * vSweepFade *
          min(uStrength, 1.15) * 0.5;
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    blending: THREE.NormalBlending,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  })
  material.forceSinglePass = true

  const blurMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: timeUniform,
      uStrength: strengthUniform,
      /* Against the wider strip this holds the blur field at the size it has
         always been. It smears what is behind the ribbon, which is a separate
         job from how far the ribbon's own haze reaches, and it is the expensive
         pass — seventeen framebuffer taps a fragment. */
      uWidthScale: { value: 0.9 },
      uFrame: { value: null },
      uInvFramebufferSize: { value: new THREE.Vector2(1, 1) },
      uFrameOrigin: { value: new THREE.Vector2() },
      uBlurRadiusPx: { value: 8 }
    },
    vertexShader: material.vertexShader,
    fragmentShader: /* glsl */ `
      uniform sampler2D uFrame;
      uniform vec2 uInvFramebufferSize;
      uniform vec2 uFrameOrigin;
      uniform float uBlurRadiusPx;
      uniform float uStrength;
      varying float vEdge;
      varying float vProgress;
      varying float vSweepFade;

      void main() {
        // Zero contribution with depth writes disabled: reject before the
        // framebuffer reads. Keep every nonzero feather value unchanged.
        float edgeFade = 1.0 - smoothstep(0.36, 0.98, abs(vEdge));
        float centeredProgress = abs((vProgress * 2.0) - 1.0);
        float visibleLength = 1.0 - centeredProgress;
        float endFeather = smoothstep(0.0, 0.26, visibleLength);
        float field = edgeFade * endFeather * vSweepFade *
          min(uStrength, 1.0) * 0.72;
        if (field <= 0.0) discard;

        vec2 uv = (gl_FragCoord.xy - uFrameOrigin) * uInvFramebufferSize;
        vec4 center = texture2D(uFrame, uv);
        field *= smoothstep(0.002, 0.035, center.a);
        // The original alpha mask makes these fragments exact no-ops, even
        // if neighbours contain color. Avoid the remaining sixteen taps.
        if (field <= 0.0) discard;
        vec2 offset = uInvFramebufferSize * uBlurRadiusPx;
        vec2 halfOffset = offset * 0.5;
        vec4 blurred = center * 0.2;
        blurred += (
          texture2D(uFrame, uv + vec2(halfOffset.x, 0.0)) +
          texture2D(uFrame, uv - vec2(halfOffset.x, 0.0)) +
          texture2D(uFrame, uv + vec2(0.0, halfOffset.y)) +
          texture2D(uFrame, uv - vec2(0.0, halfOffset.y))
        ) * 0.1;
        blurred += (
          texture2D(uFrame, uv + halfOffset) +
          texture2D(uFrame, uv - halfOffset) +
          texture2D(uFrame, uv + vec2(halfOffset.x, -halfOffset.y)) +
          texture2D(uFrame, uv + vec2(-halfOffset.x, halfOffset.y))
        ) * 0.06;
        blurred += (
          texture2D(uFrame, uv + vec2(offset.x, 0.0)) +
          texture2D(uFrame, uv - vec2(offset.x, 0.0)) +
          texture2D(uFrame, uv + vec2(0.0, offset.y)) +
          texture2D(uFrame, uv - vec2(0.0, offset.y))
        ) * 0.03;
        blurred += (
          texture2D(uFrame, uv + offset) +
          texture2D(uFrame, uv - offset) +
          texture2D(uFrame, uv + vec2(offset.x, -offset.y)) +
          texture2D(uFrame, uv + vec2(-offset.x, offset.y))
        ) * 0.01;

        vec3 straightBlur = blurred.rgb / max(blurred.a, 0.0001);
        vec3 replacementPremultiplied = straightBlur * center.a;
        gl_FragColor = vec4(replacementPremultiplied, field);
      }
    `,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    premultipliedAlpha: false
  })
  blurMaterial.forceSinglePass = true

  const colorMesh = new THREE.Mesh(geometry, material)
  colorMesh.name = 'PQI_MAGNETIC_AURORA_COLOR'
  colorMesh.layers.set(BASE_SCENE_LAYER)
  colorMesh.renderOrder = 32
  colorMesh.frustumCulled = false

  const blurMesh = new THREE.Mesh(geometry, blurMaterial)
  blurMesh.name = 'PQI_MAGNETIC_AURORA_BLUR_FIELD'
  blurMesh.layers.set(MAGNETIC_BLUR_LAYER)
  blurMesh.renderOrder = 33
  blurMesh.frustumCulled = false

  const ribbons = new THREE.Group()
  ribbons.name = 'PQI_MAGNETIC_AURORA_RIBBONS'
  ribbons.visible = false
  ribbons.userData.timeUniform = timeUniform
  ribbons.userData.strengthUniform = strengthUniform
  ribbons.userData.blurMaterial = blurMaterial
  ribbons.userData.blurMesh = blurMesh
  ribbons.add(colorMesh, blurMesh)
  return ribbons
}

function createParticleStencilMaterial(THREE) {
  return new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    stencilWrite: true,
    stencilRef: 1,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilFail: THREE.KeepStencilOp,
    stencilZFail: THREE.KeepStencilOp,
    stencilZPass: THREE.ReplaceStencilOp
  })
}

function createFallbackParticleStencil(THREE, bounds, center, scale) {
  const minX = (bounds.min.x - center.x) * scale
  const maxX = (bounds.max.x - center.x) * scale
  const minZ = (bounds.min.z - center.z) * scale
  const maxZ = (bounds.max.z - center.z) * scale
  const topY = (bounds.max.y - center.y) * scale
  const mask = new THREE.Mesh(
    createRoundedRectangularGeometry(
      THREE,
      maxX - minX,
      maxZ - minZ,
      CHIP_SURFACE_FOOTPRINT.cornerRadius
    ),
    createParticleStencilMaterial(THREE)
  )
  mask.name = 'PQI_FALLBACK_PARTICLE_STENCIL'
  mask.rotation.x = -Math.PI / 2
  mask.position.set(
    (minX + maxX) / 2,
    topY + 0.002,
    (minZ + maxZ) / 2
  )
  mask.renderOrder = 9.5
  mask.frustumCulled = false
  return mask
}

function createTopSurfaceGeometry(THREE, sourceGeometry, normalThreshold = 0.85) {
  const position = sourceGeometry?.getAttribute?.('position')
  if (!position) return null

  const sourceIndex = sourceGeometry.getIndex()
  const triangleCount = Math.floor((sourceIndex?.count || position.count) / 3)
  const topPositions = []
  const first = new THREE.Vector3()
  const second = new THREE.Vector3()
  const third = new THREE.Vector3()
  const firstEdge = new THREE.Vector3()
  const secondEdge = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const vertexIndex = offset => sourceIndex ? sourceIndex.getX(offset) : offset

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = triangle * 3
    first.fromBufferAttribute(position, vertexIndex(offset))
    second.fromBufferAttribute(position, vertexIndex(offset + 1))
    third.fromBufferAttribute(position, vertexIndex(offset + 2))
    firstEdge.subVectors(second, first)
    secondEdge.subVectors(third, first)
    normal.crossVectors(firstEdge, secondEdge).normalize()
    if (normal.y <= normalThreshold) continue
    topPositions.push(
      first.x, first.y, first.z,
      second.x, second.y, second.z,
      third.x, third.y, third.z
    )
  }
  if (topPositions.length === 0) return null

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(topPositions, 3))
  geometry.computeBoundingSphere()
  return geometry
}

function createBaseTopParticleStencil(THREE, sourceMesh) {
  const geometry = createTopSurfaceGeometry(THREE, sourceMesh.geometry)
  if (!geometry) return null
  const mask = new THREE.Mesh(geometry, createParticleStencilMaterial(THREE))
  mask.name = 'PQI_BASE_TOP_PARTICLE_STENCIL'
  mask.position.copy(sourceMesh.position)
  mask.quaternion.copy(sourceMesh.quaternion)
  mask.scale.copy(sourceMesh.scale)
  mask.matrix.copy(sourceMesh.matrix)
  mask.matrixAutoUpdate = sourceMesh.matrixAutoUpdate
  mask.renderOrder = 9.5
  mask.frustumCulled = false
  mask.visible = true
  return mask
}

export async function createProtectingInformationScene(host, {
  signal,
  onProgress,
  onReady,
  overlayMode: overlayModeOption = false,
  reducedMotion: reducedMotionOption
} = {}) {
  if (!(host instanceof HTMLElement)) throw new TypeError('A scene host is required')
  if (signal?.aborted) throw createAbortError()

  const [
    THREE,
    { GLTFLoader },
    { HDRLoader },
    { RectAreaLightUniformsLib },
    { RoomEnvironment }
  ] = await Promise.all([
    import('three'),
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/loaders/HDRLoader.js'),
    import('three/addons/lights/RectAreaLightUniformsLib.js'),
    import('three/addons/environments/RoomEnvironment.js')
  ])
  if (signal?.aborted) throw createAbortError()
  ensureRectAreaLightUniformsInitialized(RectAreaLightUniformsLib)

  const mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  let reducedMotion = typeof reducedMotionOption === 'boolean'
    ? reducedMotionOption
    : Boolean(mediaQuery?.matches)
  const scene = new THREE.Scene()
  const presentation = new THREE.Group()
  const deviceRoot = new THREE.Group()
  presentation.position.x = PRESENTATION_OFFSET_X
  deviceRoot.rotation.y = 0.16
  deviceRoot.position.y = -0.18
  scene.add(presentation)
  presentation.add(deviceRoot)

  const baseCameraFov = 21.006
  const baseCameraAspect = 2135 / 1270
  const camera = new THREE.PerspectiveCamera(baseCameraFov, 1, 0.05, 120)

  /* The authored view: the alignment found against the video, resolved into
     position, target and yaw so that the knobs below all rest at identity.

     Held as values rather than left in the camera because the alignment pass
     orbits away from them and has to be able to return, and because a match
     someone settles on belongs here as the view itself — a match that lives on
     as a stored delta is one browser profile away from being lost. */
  const BASE_CAMERA_POSITION = new THREE.Vector3(-16.521, 10.095, 15.458)
  const BASE_CAMERA_TARGET = new THREE.Vector3(-0.4, -0.28, -0.21)
  const BASE_DEVICE_YAW = 0.032

  /* Matching the three.js particles to the device in the video is an alignment
     problem with a small number of degrees of freedom: where the camera sits on
     its orbit, how far away it is, how the device is turned underneath it, and
     where the whole thing lands in frame. These are those knobs, at identity.

     Angles are radians, `distance` and `fov` are multipliers on the authored
     values, and the pan moves the camera's target in world units on all three
     axes — the device sits at an oblique angle, so sliding it along the screen
     takes a combination of the axes rather than any one of them. */
  const cameraAlignment = {
    yaw: 0,
    pitch: 0,
    distance: 1,
    fov: 1,
    deviceYaw: 0,
    panX: 0,
    panY: 0,
    panZ: 0
  }

  const applyCameraAlignment = () => {
    const offset = BASE_CAMERA_POSITION.clone().sub(BASE_CAMERA_TARGET)
    const spherical = new THREE.Spherical().setFromVector3(offset)
    spherical.theta += cameraAlignment.yaw
    /* Clamped off the poles: at phi 0 the up vector and the view direction are
       parallel and lookAt has no defined roll. */
    spherical.phi = clamp(spherical.phi + cameraAlignment.pitch, 0.01, Math.PI - 0.01)
    spherical.radius *= cameraAlignment.distance

    const target = BASE_CAMERA_TARGET.clone()
    target.x += cameraAlignment.panX
    target.y += cameraAlignment.panY
    target.z += cameraAlignment.panZ

    camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(spherical))
    camera.lookAt(target)
    deviceRoot.rotation.y = BASE_DEVICE_YAW + cameraAlignment.deviceYaw
  }

  applyCameraAlignment()

  const rendererLease = leaseWebGLRenderer(THREE, {
    alpha: true,
    antialias: true,
    depth: true,
    stencil: true,
    powerPreference: 'high-performance'
  })
  const { renderer } = rendererLease
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.04
  renderer.setClearColor(0xffffff, 0)
  renderer.domElement.className = 'pqi__canvas'
  renderer.domElement.setAttribute('aria-hidden', 'true')
  host.prepend(renderer.domElement)

  const loadingManager = new THREE.LoadingManager()
  const pmrem = new THREE.PMREMGenerator(renderer)
  const environmentScene = new RoomEnvironment()
  let environmentTarget = pmrem.fromScene(environmentScene, 0.04)
  scene.environment = environmentTarget.texture
  scene.environmentIntensity = 0.42
  disposeObject3DResources(environmentScene)
  const reflectionEnvironmentPromise = new HDRLoader(loadingManager)
    .setDataType(THREE.FloatType)
    .loadAsync(assetUrl(REFLECTION_ENVIRONMENT_PATH))
    .then(texture => {
      blurMajoranaEnvironment(texture)
      return texture
    })
    .catch(error => {
      if (!signal?.aborted && error?.name !== 'AbortError') {
        console.warn('Protecting Information reflection environment could not be loaded.', error)
      }
      return null
    })

  scene.add(new THREE.HemisphereLight(0xf2f7ff, 0x273143, 0.78))
  const keyLight = new THREE.RectAreaLight(0xffd9ad, 5.8, 8.8, 2.7)
  keyLight.position.set(-2.3, 6.8, 7.5)
  keyLight.lookAt(0, -0.25, 0)
  scene.add(keyLight)
  const fillLight = new THREE.RectAreaLight(0xeef4ff, 0.72, 13.5, 7.2)
  fillLight.position.set(-7.5, 4.5, 2.4)
  fillLight.lookAt(0, -0.35, 0)
  scene.add(fillLight)
  const rimLight = new THREE.RectAreaLight(0x9fd5ff, 2.65, 2.4, 6.5)
  rimLight.position.set(8.2, 3.4, -4.6)
  rimLight.lookAt(0, -0.15, 0)
  scene.add(rimLight)

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(8.6, 96),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      vertexShader: `
        varying vec2 vFloorUv;
        void main() {
          vFloorUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vFloorUv;
        void main() {
          float radius = length(vFloorUv - 0.5) * 2.0;
          float alpha = (1.0 - smoothstep(0.18, 0.74, radius)) * 0.055;
          if (alpha < 0.001) discard;
          gl_FragColor = vec4(vec3(0.447, 0.643, 0.933), alpha);
        }
      `
    })
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -1.25
  floor.scale.set(1, 0.46, 1)
  presentation.add(floor)

  const magneticAuroraRibbons = createMagneticAuroraRibbons(THREE)
  deviceRoot.add(magneticAuroraRibbons)
  // The blur pass needs only this mesh, not another traversal and matrix
  // update of the complete device/particle/light scene. Share GPU resources;
  // the original ribbon owns their disposal. Copy its world transform below.
  const magneticBlurScene = new THREE.Scene()
  const magneticBlurSource = magneticAuroraRibbons.userData.blurMesh
  const magneticBlurMesh = new THREE.Mesh(magneticBlurSource.geometry, magneticBlurSource.material)
  magneticBlurMesh.layers.set(MAGNETIC_BLUR_LAYER)
  magneticBlurMesh.frustumCulled = false
  magneticBlurMesh.matrixAutoUpdate = false
  magneticBlurMesh.matrixWorldAutoUpdate = false
  magneticBlurScene.add(magneticBlurMesh)

  let particleData = createProtectingParticleData()
  const particleMaterial = createParticleMaterial(THREE)
  const particlePoints = new THREE.Points(createParticleGeometry(THREE, particleData), particleMaterial)
  particlePoints.renderOrder = 10.5
  particlePoints.frustumCulled = false
  deviceRoot.add(particlePoints)

  const installParticleLayout = wireLayout => {
    particleData = createProtectingParticleData({ wireLayout })
    const previousGeometry = particlePoints.geometry
    particlePoints.geometry = createParticleGeometry(THREE, particleData)
    previousGeometry.dispose()
  }

  const loader = new GLTFLoader(loadingManager)
  loader.setMeshoptDecoder(MeshoptDecoder)
  let modelRoot = null
  let modelPivot = null
  let resizeObserver = null
  let animationFrame = 0
  let disposed = false
  let suspended = document.hidden
  let modelReady = false

  /* Overlay mode is the board's arrangement: the video carries the device and
     its effects, and three.js contributes only what the board asks it to —
     the particle passes and the magnetic arcs — composited over the top.

     The device geometry is not removed, because it does real work even when it
     is not being looked at: the die occludes the particles behind and beneath
     it, and that occlusion is most of what makes them read as sitting *in* the
     device rather than floating over a picture of one. So the meshes keep
     drawing and keep writing depth, and only stop contributing colour.

     Each occluder inherits its material's depth settings rather than asserting
     its own. A surface that does not write depth today does not occlude today,
     and it should not start occluding just because the colour went away.

     Two exceptions. The particle stencil is left alone — it hangs off the BASE
     node and clips the particles to the top face, so it has to keep working
     exactly as it did. And the activation overlays are decoration rather than
     body, so they are hidden outright; the video is carrying those glows. */
  /* Taken at construction rather than set afterwards. The device meshes are
     hidden by the same pass that runs when the model finishes loading, so a
     scene told at build time that it will be composited under video never
     draws the device at all — asked afterwards, it draws it once first, and
     that single frame is a flash of the full device as the module opens. */
  let overlayMode = Boolean(overlayModeOption)
  const occluderMaterials = new Set()

  const isDecoration = node => {
    for (let current = node; current; current = current.parent) {
      if (current.userData?.pqiDecoration) return true
      if (current === modelPivot) break
    }
    return false
  }

  const occluderFor = node => {
    if (!node.userData.pqiOccluder) {
      const source = Array.isArray(node.material) ? node.material[0] : node.material
      const occluder = new THREE.MeshBasicMaterial({
        colorWrite: false,
        depthWrite: source?.depthWrite ?? true,
        depthTest: source?.depthTest ?? true,
        side: source?.side ?? THREE.FrontSide
      })
      node.userData.pqiOccluder = occluder
      occluderMaterials.add(occluder)
    }
    return node.userData.pqiOccluder
  }

  const applyOverlayMode = () => {
    if (!modelPivot) return
    modelPivot.traverse(node => {
      if (!node.isMesh || node.name.includes('PARTICLE_STENCIL')) return

      if (isDecoration(node)) {
        if (node.userData.pqiDeviceVisible === undefined) {
          node.userData.pqiDeviceVisible = node.visible
        }
        node.visible = overlayMode ? false : node.userData.pqiDeviceVisible
        return
      }

      if (overlayMode) {
        if (!node.userData.pqiDeviceMaterial) node.userData.pqiDeviceMaterial = node.material
        node.material = occluderFor(node)
      } else if (node.userData.pqiDeviceMaterial) {
        node.material = node.userData.pqiDeviceMaterial
      }
    })
  }
  let lastFrameAt = performance.now()
  let visualTime = 0
  let voltageFlowTime = 0
  let thermalTime = 0
  let complete = false
  let effectDrives = getProtectionEffectDrives()
  let temperatureQualityTarget = 0
  let temperatureQualityStrength = 0
  let voltageQualityTarget = 0
  let voltageQualityStrength = 0
  let temperatureStrength = 0
  let voltageStrength = 0
  let voltageOverdriveStrength = 0
  let voltageVisualStrength = 0
  let magneticStrength = 0
  let magneticVisualStrength = 0
  let completionStrength = 0
  let wireLayout = { ...DEFAULT_WIRE_LAYOUT, zRows: [...DEFAULT_WIRE_LAYOUT.zRows] }
  let loupeAnchorLocal = null
  let deviceMaterials = null
  let temperatureActivationOverlay = null
  const voltageActivationOverlays = []
  let voltageLightningIcon = null
  let introElapsed = reducedMotion
    ? INTRO_HOLD_DURATION + INTRO_TRANSITION_DURATION
    : 0
  let introProgress = reducedMotion ? 1 : 0
  let introInterrupted = false
  const splitGateFronts = []
  const gateDissolveUniforms = []
  const startedDetailLevel = initialParticleTierLevel()
  let detailLevel = startedDetailLevel
  let detailTarget = startedDetailLevel
  particleMaterial.uniforms.uDetailLevel.value = startedDetailLevel
  /* The probe decides how many particles the machine can afford, and it gets one
     chance per session. It must therefore not sample while something transient
     is happening — and mounting the video stack is exactly that: five clips and
     three multi-megabyte plates decoding at once, right after the intro ends,
     which is precisely when this used to start measuring. It read that as the
     steady state and cut the particle count for the rest of the session.

     So the module holds the probe until the composite is up and settled. */
  let performanceProbeEnabled = true
  let performanceWindowElapsed = 0
  let performanceSamples = []
  let performanceWindows = 0
  const performanceMetrics = []
  const magneticFramebufferSize = new THREE.Vector2()
  const magneticFrameOrigin = new THREE.Vector2()
  const savedMagneticScissor = new THREE.Vector4()
  let magneticCopyRegion = null
  let magneticFrameTexture = null
  let magneticBlurFailed = false

  const releaseMagneticFrameTexture = () => {
    magneticAuroraRibbons.userData.blurMaterial.uniforms.uFrame.value = null
    magneticFrameTexture?.dispose()
    magneticFrameTexture = null
  }

  const ensureMagneticFrameTexture = () => {
    renderer.getDrawingBufferSize(magneticFramebufferSize)
    const region = magneticCopyRegion ?? {
      x: 0, y: 0, width: magneticFramebufferSize.x, height: magneticFramebufferSize.y
    }
    const { width, height } = region
    if (width <= 0 || height <= 0) return null
    magneticFrameOrigin.set(region.x, region.y)
    magneticAuroraRibbons.userData.blurMaterial.uniforms.uFrameOrigin.value.copy(magneticFrameOrigin)
    if (
      width > renderer.capabilities.maxTextureSize ||
      height > renderer.capabilities.maxTextureSize ||
      width * height > MAX_MAGNETIC_BLUR_PIXELS
    ) {
      releaseMagneticFrameTexture()
      return null
    }
    if (
      magneticFrameTexture?.image?.width === width &&
      magneticFrameTexture?.image?.height === height
    ) return magneticFrameTexture

    const previousTexture = magneticFrameTexture
    magneticFrameTexture = new THREE.FramebufferTexture(width, height)
    magneticFrameTexture.name = 'PQI_MAGNETIC_FRAMEBUFFER'
    magneticFrameTexture.colorSpace = THREE.NoColorSpace
    magneticFrameTexture.minFilter = THREE.LinearFilter
    magneticFrameTexture.magFilter = THREE.LinearFilter
    magneticFrameTexture.wrapS = THREE.ClampToEdgeWrapping
    magneticFrameTexture.wrapT = THREE.ClampToEdgeWrapping
    magneticFrameTexture.generateMipmaps = false
    const blurUniforms = magneticAuroraRibbons.userData.blurMaterial.uniforms
    blurUniforms.uFrame.value = magneticFrameTexture
    blurUniforms.uInvFramebufferSize.value.set(1 / width, 1 / height)
    previousTexture?.dispose()
    return magneticFrameTexture
  }

  const resize = () => {
    if (disposed) return
    const width = Math.max(1, host.clientWidth)
    const height = Math.max(1, host.clientHeight)
    const pixelRatio = calculateStageAwarePixelRatio({
      width,
      height,
      cssScale: elementCssScale(host),
      devicePixelRatio: window.devicePixelRatio || 1,
      // The overscanned kiosk canvas needs a lower floor to stay within the
      // pixel budget; 0.55 would exceed it and disable the magnetic blur pass.
      minPixelRatio: 0.25
    })
    /* The framing is authored against the video's composition box, and the
       canvas is allowed to be larger than that box so the pass has somewhere to
       run off to. Only the part of the width that belongs to the box drives the
       projection; the rest is overscan.

       This matters because pixels per world unit works out to width / (2 d K),
       so pinning the field to the LIVE width — which is what dividing by
       camera.aspect does — magnifies the whole scene the moment the canvas gets
       wider, and the device stops sitting where the video puts it. Referencing
       the authored width instead makes extra canvas reveal more rather than
       zoom in. Extra height already behaved this way, which is why the vertical
       overscan needed no change here; this makes the horizontal match.

       With no overscan declared this is arithmetically identical to what it
       replaced, so the non-video framing is untouched. */
    const sceneOverscanX = parseFloat(
      getComputedStyle(host).getPropertyValue('--pqi-scene-overscan-x')
    ) || 0
    const authoredWidth = Math.max(1, width - (sceneOverscanX * 2))
    camera.aspect = width / height
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(
      Math.tan(THREE.MathUtils.degToRad(baseCameraFov * cameraAlignment.fov) / 2) *
      ((baseCameraAspect * height) / authoredWidth)
    ))
    camera.updateProjectionMatrix()
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(width, height, false)
    renderer.getDrawingBufferSize(magneticFramebufferSize)
    // The overscanned canvas extends far above the kiosk. Retain a full-size
    // base render, but copy/filter only pixels the visitor can see, plus all
    // neighbouring samples used by the unchanged eight-pixel blur kernel.
    const stage = host.closest('#kiosk-stage')
    magneticCopyRegion = visibleFramebufferRegion(
      magneticFramebufferSize.x, magneticFramebufferSize.y,
      renderer.domElement.getBoundingClientRect(), stage?.getBoundingClientRect(), 9
    )
    particleMaterial.uniforms.uPixelRatio.value = pixelRatio
    if (magneticFrameTexture) ensureMagneticFrameTexture()
  }

  const applyIntroProgress = () => {
    const easedProgress = easeInOutCubic(introProgress)
    for (const uniform of gateDissolveUniforms) uniform.value = easedProgress
    if (deviceMaterials?.hGate) {
      const updateHGateLayer = (material, smokedOpacity) => {
        if (material.userData.pqiIntroProgress) {
          material.userData.pqiIntroProgress.value = easedProgress
        }
        material.opacity = 1 - ((1 - smokedOpacity) * easedProgress)
        material.metalness = 1 - (0.84 * easedProgress)
        material.roughness = 0.16 + (0.09 * easedProgress)
        material.envMapIntensity = 1.45 - (0.65 * easedProgress)
        material.depthWrite = introProgress < 0.2
      }
      updateHGateLayer(deviceMaterials.hGate, H_GATE_UPPER_SMOKED_OPACITY)
      updateHGateLayer(deviceMaterials.hGateLower, H_GATE_LOWER_SMOKED_OPACITY)
    }
    for (const mesh of splitGateFronts) {
      mesh.visible = introProgress < 0.999
      mesh.material.opacity = 1 - easedProgress
      mesh.material.depthWrite = introProgress < 0.28
    }
  }

  const updatePerformanceTier = (rawDelta, delta) => {
    if (
      !modelReady ||
      introProgress < 1 ||
      reducedMotion ||
      !performanceProbeEnabled ||
      performanceWindows >= MAX_PERFORMANCE_WINDOWS
    ) return
    performanceWindowElapsed += delta
    performanceSamples.push(Math.min(100, rawDelta * 1000))
    if (performanceWindowElapsed < PERFORMANCE_WINDOW_SECONDS) return
    const medianFrame = percentile(performanceSamples, 0.5)
    const p95Frame = percentile(performanceSamples, 0.95)
    const medianFps = medianFrame > 0 ? 1000 / medianFrame : 60
    /* Relaxed from 58fps/20ms. The module now composites a video stack under the
       scene by design, so the old budget described a workload that no longer
       exists; held to it, a composite running a perfectly good 55 would be
       downgraded. This still catches a machine that is genuinely struggling. */
    const failedBudget = medianFps < 50 || p95Frame > 26
    if (failedBudget && detailTarget > PARTICLE_TIER_LEVELS.low) {
      detailTarget -= 1
    }
    performanceMetrics.push({
      medianFps: Math.round(medianFps * 10) / 10,
      p95FrameMs: Math.round(p95Frame * 10) / 10,
      failedBudget,
      resultingTier: particleTierName(detailTarget)
    })
    performanceWindows += 1
    performanceWindowElapsed = 0
    performanceSamples = []
    if (performanceWindows >= MAX_PERFORMANCE_WINDOWS) {
      try {
        sessionStorage.setItem(PARTICLE_PERFORMANCE_KEY, JSON.stringify({
          measuredAt: Date.now(),
          startedTier: particleTierName(startedDetailLevel),
          windows: performanceMetrics,
          finalTier: particleTierName(detailTarget)
        }))
      } catch {}
    }
  }

  const isSettled = () => Math.max(
    Math.abs(temperatureStrength - effectDrives.temperature),
    Math.abs(voltageStrength - effectDrives.voltage),
    Math.abs(voltageOverdriveStrength - effectDrives.voltageOverdrive),
    Math.abs(voltageVisualStrength - effectDrives.voltageVisual),
    Math.abs(magneticStrength - effectDrives.magnetic),
    Math.abs(magneticVisualStrength - effectDrives.magneticVisual),
    Math.abs(temperatureQualityStrength - temperatureQualityTarget),
    Math.abs(voltageQualityStrength - voltageQualityTarget),
    Math.abs(completionStrength - (complete ? 1 : 0)),
    Math.abs(detailLevel - detailTarget),
    1 - introProgress
  ) < 0.001

  const renderSceneFrame = () => {
    const previousCameraLayerMask = camera.layers.mask
    const previousAutoClear = renderer.autoClear
    const previousRenderTarget = renderer.getRenderTarget()
    const previousScissorTest = renderer.getScissorTest()
    renderer.getScissor(savedMagneticScissor)
    try {
      camera.layers.set(BASE_SCENE_LAYER)
      renderer.autoClear = true
      renderer.setRenderTarget(null)
      renderer.render(scene, camera)

      const blurEligible =
        !magneticBlurFailed &&
        magneticVisualStrength > 0.02
      if (!blurEligible) return
      for (let object = magneticBlurSource; object; object = object.parent) {
        if (!object.visible) return
      }

      try {
        const frameTexture = ensureMagneticFrameTexture()
        if (!frameTexture) return
        renderer.copyFramebufferToTexture(frameTexture, magneticFrameOrigin)
        const ratio = renderer.getPixelRatio()
        renderer.setScissor(
          (magneticFrameOrigin.x + 0.01) / ratio,
          (magneticFrameOrigin.y + 0.01) / ratio,
          (frameTexture.image.width + 0.01) / ratio,
          (frameTexture.image.height + 0.01) / ratio
        )
        renderer.setScissorTest(true)
        camera.layers.set(MAGNETIC_BLUR_LAYER)
        renderer.autoClear = false
        magneticBlurMesh.matrixWorld.copy(magneticBlurSource.matrixWorld)
        renderer.render(magneticBlurScene, camera)
      } catch (error) {
        magneticBlurFailed = true
        releaseMagneticFrameTexture()
        console.warn('Protecting Information magnetic blur was disabled.', error)
      }
    } finally {
      camera.layers.mask = previousCameraLayerMask
      renderer.autoClear = previousAutoClear
      renderer.setRenderTarget(previousRenderTarget)
      renderer.setScissor(savedMagneticScissor)
      renderer.setScissorTest(previousScissorTest)
    }
  }

  const render = now => {
    animationFrame = 0
    if (disposed || suspended) return
    const rawDelta = Math.max(0, (now - lastFrameAt) / 1000)
    const delta = Math.min(0.05, rawDelta)
    lastFrameAt = now
    visualTime += reducedMotion ? 0 : delta

    if (modelReady && introProgress < 1) {
      if (introInterrupted) {
        introProgress = Math.min(1, introProgress + (delta / INTERRUPTED_INTRO_DURATION))
      } else {
        introElapsed += delta
        introProgress = clamp(
          (introElapsed - INTRO_HOLD_DURATION) / INTRO_TRANSITION_DURATION
        )
      }
      applyIntroProgress()
    }

    temperatureStrength = damp(
      temperatureStrength,
      effectDrives.temperature,
      delta,
      reducedMotion ? 0.2 : 0.75
    )
    voltageStrength = damp(voltageStrength, effectDrives.voltage, delta, reducedMotion ? 0.22 : 0.9)
    // The over-voltage state itself is binary, so every corridor particle
    // leaves together. Ease only their travel to the evacuation positions so
    // crossing the threshold reads as motion rather than a visibility cut.
    voltageOverdriveStrength = damp(
      voltageOverdriveStrength,
      effectDrives.voltageOverdrive,
      delta,
      reducedMotion ? 0.12 : OVERVOLTAGE_EVACUATION_DURATION
    )
    voltageVisualStrength = damp(
      voltageVisualStrength,
      effectDrives.voltageVisual,
      delta,
      reducedMotion ? 0.22 : 0.9
    )
    magneticStrength = damp(magneticStrength, effectDrives.magnetic, delta, reducedMotion ? 0.2 : 0.8)
    magneticVisualStrength = damp(
      magneticVisualStrength,
      effectDrives.magneticVisual,
      delta,
      reducedMotion ? 0.2 : 0.8
    )
    temperatureQualityStrength = damp(
      temperatureQualityStrength,
      temperatureQualityTarget,
      delta,
      reducedMotion ? 0.18 : 0.62
    )
    voltageQualityStrength = damp(
      voltageQualityStrength,
      voltageQualityTarget,
      delta,
      reducedMotion ? 0.18 : 0.62
    )
    completionStrength = damp(completionStrength, complete ? 1 : 0, delta, reducedMotion ? 0.18 : 0.4)
    detailLevel = damp(detailLevel, detailTarget, delta, 0.6)
    if (!reducedMotion) thermalTime = advanceThermalTime(thermalTime, delta, temperatureStrength)

    const particleUniforms = particleMaterial.uniforms
    particleUniforms.uThermalTime.value = thermalTime
    particleUniforms.uVisualTime.value = visualTime
    particleUniforms.uTemperature.value = temperatureStrength
    particleUniforms.uVoltage.value = voltageStrength
    particleUniforms.uVoltageOverdrive.value = voltageOverdriveStrength
    particleUniforms.uMagnetic.value = magneticStrength
    particleUniforms.uCompletion.value = completionStrength
    particleUniforms.uDetailLevel.value = detailLevel

    magneticAuroraRibbons.userData.timeUniform.value = visualTime
    magneticAuroraRibbons.userData.strengthUniform.value = clamp(
      magneticVisualStrength,
      0,
      1.5
    )
    magneticAuroraRibbons.visible = magneticVisualStrength > 0.001

    updateActivationOverlay(
      temperatureActivationOverlay,
      temperatureQualityStrength,
      visualTime,
      reducedMotion
    )
    voltageActivationOverlays.forEach(overlay => {
      updateActivationOverlay(
        overlay,
        voltageQualityStrength,
        visualTime,
        reducedMotion
      )
    })
    updateVoltageLightningIcon(
      voltageLightningIcon,
      voltageVisualStrength,
      visualTime,
      reducedMotion
    )
    const voltageOnStrength = clamp((voltageVisualStrength - 0.08) / 0.18)
    if (!reducedMotion && voltageOnStrength > 0.001) voltageFlowTime += delta
    if (deviceMaterials) {
      deviceMaterials.voltageDrive.strength.value =
        clamp(voltageVisualStrength, 0, 1.75) * voltageOnStrength
      deviceMaterials.voltageDrive.time.value = voltageFlowTime
      deviceMaterials.magneticDrive.strength.value = clamp(magneticStrength)
      deviceMaterials.temperatureDrive.strength.value = temperatureQualityStrength
    }
    rimLight.intensity = 2.65 + (completionStrength * 0.55)

    updatePerformanceTier(rawDelta, delta)
    renderSceneFrame()
    if (!reducedMotion || !isSettled()) animationFrame = requestAnimationFrame(render)
  }

  const requestRender = () => {
    if (disposed || suspended || animationFrame) return
    lastFrameAt = performance.now()
    animationFrame = requestAnimationFrame(render)
  }

  const finishIntro = (fast = true) => {
    if (introProgress >= 1) return
    introInterrupted = Boolean(fast)
    if (!modelReady || reducedMotion) {
      introProgress = 1
      applyIntroProgress()
    }
    requestRender()
  }

  const handleVisibilityChange = () => {
    suspended = document.hidden
    if (suspended && animationFrame) {
      cancelAnimationFrame(animationFrame)
      animationFrame = 0
    } else {
      requestRender()
    }
  }

  const handleMotionPreference = event => {
    if (typeof reducedMotionOption === 'boolean') return
    reducedMotion = event.matches
    if (reducedMotion && introProgress < 1) {
      introProgress = 1
      applyIntroProgress()
    }
    requestRender()
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    loadingManager.abort?.()
    if (animationFrame) cancelAnimationFrame(animationFrame)
    resizeObserver?.disconnect()
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('resize', resize)
    window.visualViewport?.removeEventListener('resize', resize)
    mediaQuery?.removeEventListener?.('change', handleMotionPreference)
    signal?.removeEventListener?.('abort', dispose)
    releaseMagneticFrameTexture()
    magneticBlurScene.clear()

    const geometries = new Set()
    const materials = new Set()
    presentation.traverse(object => {
      if (object.geometry) geometries.add(object.geometry)
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of objectMaterials) if (material) materials.add(material)
      /* In overlay mode the mesh is wearing its occluder and the real material
         is parked in userData, where this traversal would not find it. */
      const parked = object.userData?.pqiDeviceMaterial
      if (parked) for (const material of Array.isArray(parked) ? parked : [parked]) materials.add(material)
    })
    for (const occluder of occluderMaterials) materials.add(occluder)
    occluderMaterials.clear()
    for (const geometry of geometries) geometry.dispose?.()
    const disposedTextures = new Set()
    for (const material of materials) disposeMaterial(material, disposedTextures)
    scene.environment = null
    environmentTarget.dispose()
    pmrem.dispose()
    rendererLease.release()
  }

  signal?.addEventListener('abort', dispose, { once: true })
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('resize', resize)
  window.visualViewport?.addEventListener('resize', resize)
  mediaQuery?.addEventListener?.('change', handleMotionPreference)
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(host)
  resize()
  requestRender()

  try {
    const gltf = await new Promise((resolve, reject) => {
      loader.load(
        assetUrl(MODEL_PATH),
        resolve,
        progress => {
          const ratio = progress.total > 0 ? progress.loaded / progress.total : 0
          onProgress?.(clamp(ratio))
        },
        reject
      )
    })
    if (disposed || signal?.aborted) throw createAbortError()

    const reflectionEnvironment = await reflectionEnvironmentPromise
    if (disposed || signal?.aborted) {
      reflectionEnvironment?.dispose()
      throw createAbortError()
    }
    if (reflectionEnvironment) {
      const reflectedEnvironmentTarget = pmrem.fromEquirectangular(reflectionEnvironment)
      reflectionEnvironment.dispose()
      environmentTarget.dispose()
      environmentTarget = reflectedEnvironmentTarget
      scene.environment = environmentTarget.texture
    }
    pmrem.dispose()

    modelRoot = gltf.scene
    const materials = createDeviceMaterials(THREE)
    deviceMaterials = materials
    modelRoot.traverse(object => {
      if (!object.isMesh) return
      const key = normalizedNodeName(object.name)
      const mappedMaterial = materialForNode(materials, key)
      if (mappedMaterial) object.material = mappedMaterial
      object.renderOrder = renderOrderForNode(key)
      object.castShadow = false
      object.receiveShadow = false

      if (key === 'UPPER-GATE_FRONT' || key === 'LOWER-GATE_FRONT') {
        object.material = materials.gold.clone()
        object.material.transparent = true
        object.material.opacity = 1
        object.material.depthWrite = true
        gateDissolveUniforms.push(addGateDissolve(object.material, object.geometry))
        splitGateFronts.push(object)
      }

    })
    modelRoot.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(modelRoot)
    const center = bounds.getCenter(new THREE.Vector3())
    const size = bounds.getSize(new THREE.Vector3())
    const modelScale = 11.9 / Math.max(size.x, size.z, 0.001)
    const wireSides = ['NANOWIRE_SIDE-A', 'NANOWIRE_SIDE-B']
      .map(name => modelRoot.getObjectByName(name))
      .filter(Boolean)
      .map(object => new THREE.Box3().setFromObject(object))

    if (wireSides.length === 2) {
      const normalizedSides = wireSides.map(sideBounds => ({
        minX: (sideBounds.min.x - center.x) * modelScale,
        maxX: (sideBounds.max.x - center.x) * modelScale,
        maxY: (sideBounds.max.y - center.y) * modelScale,
        centerZ: (((sideBounds.min.z + sideBounds.max.z) / 2) - center.z) * modelScale
      }))
      const edgeInset = 0.13
      const xMin = Math.max(...normalizedSides.map(side => side.minX)) + edgeInset
      const xMax = Math.min(...normalizedSides.map(side => side.maxX)) - edgeInset
      if (xMax - xMin > 0.5) {
        const foregroundSide = normalizedSides.reduce((foreground, side) => (
          side.centerZ > foreground.centerZ ? side : foreground
        ), normalizedSides[0])
        wireLayout = {
          xMin,
          xMax,
          surfaceY: Math.max(...normalizedSides.map(side => side.maxY)),
          zRows: normalizedSides.map(side => side.centerZ).sort((a, b) => a - b)
        }
        loupeAnchorLocal = new THREE.Vector3(
          foregroundSide.minX + 0.02,
          foregroundSide.maxY + 0.015,
          foregroundSide.centerZ
        )
      }
    }
    installParticleLayout(wireLayout)

    const baseNode = modelRoot.getObjectByName('BASE')
    if (baseNode?.isMesh && baseNode.parent) {
      const baseStencil = createBaseTopParticleStencil(THREE, baseNode)
      if (baseStencil) baseNode.parent.add(baseStencil)
      else {
        const baseBounds = new THREE.Box3().setFromObject(baseNode)
        deviceRoot.add(createFallbackParticleStencil(THREE, baseBounds, center, modelScale))
      }
    } else {
      particleMaterial.stencilWrite = false
      particleMaterial.needsUpdate = true
    }
    if (baseNode) {
      temperatureActivationOverlay = createTemperatureActivationOverlay(
        THREE,
        baseNode
      )
      if (temperatureActivationOverlay) baseNode.add(temperatureActivationOverlay)
    }
    const voltageSource = modelRoot.getObjectByName('UPPER-GATE_H')
    if (voltageSource?.isMesh) {
      const voltageOverlay = createVoltageActivationOverlay(
        THREE,
        voltageSource,
        materials.voltageDrive
      )
      if (voltageOverlay) {
        voltageSource.add(voltageOverlay)
        voltageActivationOverlays.push(voltageOverlay)
      }
      voltageLightningIcon = createVoltageLightningIcon(THREE, voltageSource)
      if (voltageLightningIcon) voltageSource.add(voltageLightningIcon)
    }

    modelRoot.position.copy(center).multiplyScalar(-1)
    modelPivot = new THREE.Group()
    modelPivot.scale.setScalar(modelScale)
    modelPivot.add(modelRoot)
    deviceRoot.add(modelPivot)
    deviceRoot.updateMatrixWorld(true)
    materials.gold.userData.pqiDeviceWorldInverse.copy(deviceRoot.matrixWorld).invert()
    materials.hGate.userData.pqiDeviceWorldInverse.copy(deviceRoot.matrixWorld).invert()
    materials.hGateLower.userData.pqiDeviceWorldInverse.copy(deviceRoot.matrixWorld).invert()
    materials.nanowire.userData.pqiDeviceWorldInverse.copy(deviceRoot.matrixWorld).invert()
    materials.connector.userData.pqiDeviceWorldInverse.copy(deviceRoot.matrixWorld).invert()
    materials.base.userData.pqiDeviceWorldInverse.copy(deviceRoot.matrixWorld).invert()
    materials.voltageDrive.deviceWorldInverse.copy(deviceRoot.matrixWorld).invert()
    for (const material of [
      materials.science,
      materials.barrierTop,
      materials.barrier02,
      materials.barrier03,
      materials.barrier04
    ]) {
      material.userData.pqiDeviceWorldInverse.copy(deviceRoot.matrixWorld).invert()
    }
    modelReady = true
    /* The stencil is attached during this load, so the mode can only be put
       into effect now — a call before this point recorded the intent only. */
    applyOverlayMode()
    if (reducedMotion) introProgress = 1
    applyIntroProgress()

    onProgress?.(1)
    onReady?.()
    requestRender()
  } catch (error) {
    dispose()
    if (signal?.aborted || error?.name === 'AbortError') throw createAbortError()
    throw error
  }

  return {
    setState(nextState = {}, progress = {}) {
      effectDrives = getProtectionEffectDrives(nextState)
      complete = Boolean(progress.complete)
      temperatureQualityTarget = clamp(progress.qualities?.temperature)
      voltageQualityTarget = clamp(progress.qualities?.voltage)
      requestRender()
    },
    setFocus() {
      requestRender()
    },
    finishIntro,
    interruptIntro: finishIntro,

    /* Re-enabling restarts the window rather than resuming it, so samples taken
       either side of a stall are never averaged into one verdict. */
    setPerformanceProbeEnabled(enabled) {
      performanceProbeEnabled = Boolean(enabled)
      if (performanceProbeEnabled) {
        performanceWindowElapsed = 0
        performanceSamples = []
      }
    },

    getParticleTier() {
      return {
        tier: particleTierName(detailTarget),
        count: PARTICLE_TIERS[particleTierName(detailTarget)].total,
        windowsMeasured: performanceWindows
      }
    },

    setOverlayMode(enabled) {
      const next = Boolean(enabled)
      if (next === overlayMode) return
      overlayMode = next
      applyOverlayMode()
      requestRender()
    },

    /* Partial: pass only the knobs being changed. Returns the resolved set so a
       caller tuning the alignment can read back what it is now looking at. */
    setCameraAlignment(values = {}) {
      for (const key of Object.keys(cameraAlignment)) {
        if (Number.isFinite(values[key])) cameraAlignment[key] = values[key]
      }
      applyCameraAlignment()
      resize()
      requestRender()
      return { ...cameraAlignment }
    },

    getCameraAlignment() {
      return { ...cameraAlignment }
    },

    getLoupeAnchor() {
      if (!modelReady) return { x: 0.5, y: 0.52, visible: false }
      const anchor = loupeAnchorLocal?.clone() || new THREE.Vector3(
        wireLayout.xMin + 0.02,
        0.225,
        Math.max(...wireLayout.zRows)
      )
      deviceRoot.updateWorldMatrix(true, false)
      deviceRoot.localToWorld(anchor)
      anchor.project(camera)
      return {
        x: clamp((anchor.x + 1) / 2),
        y: clamp((1 - anchor.y) / 2),
        visible: anchor.z >= -1 && anchor.z <= 1
      }
    },
    getReserveSample() {
      return sampleNanowireReserve(particleData, { count: 40, tier: 'low' })
    },
    getWireLayout() {
      return {
        xMin: wireLayout.xMin,
        xMax: wireLayout.xMax,
        zRows: [...wireLayout.zRows]
      }
    },
    dispose
  }
}

export default { createProtectingInformationScene }
