const MAX_RIPPLES = 9
const DEFAULT_TRAIL_DECAY = 0.08
const FULL_SURFACE_DENSITY_X = 3.8
const FULL_SURFACE_DENSITY_Z = 3.4

/*
 * `radius` is what sets the height of the skyline, and through that the room the
 * horizon wash has to work in. The cap bends the overscan away from the eye, so a
 * tight radius drops the silhouette low in frame and squeezes the wash against it;
 * opening the radius flattens the curve, pushes the silhouette up and hands those
 * rows back. Measured on a 720-row portrait frame from the 7 m opening camera:
 * radius 220 -> skyline row 177, 700 -> 145, 1200 -> 133, 2000 -> 125, 3000 -> 121.
 *
 * 121 is the floor for a 200 m deep sheet: past roughly 2000 the cap is flat enough
 * that the silhouette IS the sheet edge at z -100 rather than the curve, and further
 * opening buys nothing. Going higher than that means a deeper sheet, which is not
 * free - concentrateFullSurfaceGeometry spends its vertices as a fraction of the
 * extent, so a deeper sheet thins the ripple resolution across the play field unless
 * FULL_SURFACE_DENSITY_Z is raised to match.
 */
export const INTERFERENCE_HORIZON_CONFIG = Object.freeze({
  flatRadius: 14,
  radius: 2000
})

/*
 * Two ramps carry the water into the backdrop, because the job splits in two.
 * The wash grades the water COLOUR to the backdrop tint over a long run, and that is
 * the gradient a visitor actually reads. The alpha fade only dissolves the surface at
 * the very end, by which point the colour already matches the sky, so the dissolve
 * itself is invisible. Fading alpha alone cannot be stretched the same way: thinning
 * the water early makes the background buoys float on bare backdrop.
 *
 * Both are metered in metres FROM THE CAMERA (see the shader), not from the field
 * centre. The camera stands 14 m back, so a centre-radial ramp is symmetric about a
 * point in mid-scene and hazes the foreground as hard as the skyline.
 *
 * The numbers are set from measured pixels, not from theory: on a 400-row frame the
 * far water only spans rows ~98 (silhouette) to ~204 (field centre), so the ramp has
 * to be spread deliberately or it collapses. 16 -> 58 puts the visible gradient
 * across ~90 rows at a maximum step of about 2/255 per row, which is what keeps it
 * reading as a gradient rather than an edge.
 *
 * `end` must land at or before the silhouette, never past it. The spherical cap (see
 * INTERFERENCE_HORIZON_CONFIG) bends the far water out of sight around 64 m from the
 * eye, and that silhouette is a real geometric edge: any alpha still left there draws
 * as a crisp blue line against the sky.
 */
export const INTERFERENCE_WATER_EDGE_FADE_CONFIG = Object.freeze({
  end: 88,
  start: 71
})

export const INTERFERENCE_WATER_HORIZON_WASH_CONFIG = Object.freeze({
  /* The backdrop gradient sampled at the screen row the silhouette sits on, so the
     far water resolves into the sky it is standing in front of. */
  /*
   * `start` sets where the falloff begins; `end` sets how long it takes to finish.
   * Measured steepest luminance change per row on a 720-row frame - lower is softer,
   * and the water's own depth gradient runs at 1.2, which is the floor:
   *
   * `start` is the horizontal camera distance where the falloff begins, so it also
   * decides how much of the buoy field sits on washed water. The furthest background
   * buoy is 48.7 m out, and the play field ends at 21.8 m. Measured on a 720-row
   * portrait frame from the opening camera, at radius 2000 and end 88:
   *
   *   start        30     38     42     46     50     52
   *   steepest    1.93   1.93   1.93   2.00   2.21   2.72
   *   wash on
   *   furthest     62%    33%    17%     4%     0%     0%
   *   buoy
   *   span (rows)   82     56     45     37     30     27
   *
   * Note that the softness holds flat out to 46 and only the length gives way. That
   * is because the water's own depth gradient has already lightened the far field, so
   * a wash starting further out has less colour to cover and covers it just as
   * gently. 46 is where the furthest buoy is effectively back on blue - 4% wash is a
   * shift of about five levels - without paying for it in softness.
   *
   * Keeping BOTH the 82 row band and the buoys on blue is not available here. The
   * band would have to begin below the buoys, so it would need the skyline far higher
   * than a 200 m sheet can put it; a 900 m sheet gets the span to 63 but needs the
   * camera far plane taken from 360 to about 1600, and it rescales the base water
   * colour, which is keyed to sheet extent through iqmDepthMix - the play field would
   * change colour to buy skyline.
   *
   * `end` must still finish before the sheet edge. At radius 2000 the edge is row
   * 125 and the wash completes at 131, six rows clear; the outcome camera holds ten.
   * When the wash stops completing before the edge, the hard line comes back.
   */
  color: '#eaf1f4',
  end: 88,
  start: 46
})

export const INTERFERENCE_OUTCOME_SUCTION_CONFIG = Object.freeze({
  depth: 0.24,
  radius: 1.25
})

export const INTERFERENCE_SOLUTION_MOUND_CONFIG = Object.freeze({
  height: 1.28,
  outcomeScaleXZ: 0.72,
  outcomeScaleY: 1.35,
  radius: 2.65,
  seatDepth: 0.12,
  seatRadius: 0.22
})

function writeOutcomeSuctionSample(
  x,
  z,
  origins,
  progress,
  config,
  target,
  offset
) {
  const safeProgress = Number.isFinite(progress)
    ? Math.max(0, Math.min(1, progress))
    : 0
  const radius = Number.isFinite(config?.radius)
    ? Math.max(0.0001, config.radius)
    : INTERFERENCE_OUTCOME_SUCTION_CONFIG.radius
  const depth = Number.isFinite(config?.depth)
    ? Math.max(0, config.depth)
    : INTERFERENCE_OUTCOME_SUCTION_CONFIG.depth
  const radiusSquared = radius * radius
  let height = 0
  let slopeX = 0
  let slopeZ = 0

  if (safeProgress > 0 && depth > 0) {
    for (const origin of origins) {
      const deltaX = x - (Number(origin?.x) || 0)
      const deltaZ = z - (Number(origin?.z) || 0)
      const distanceSquared = (deltaX * deltaX) + (deltaZ * deltaZ)
      if (distanceSquared >= radiusSquared) continue

      /* Compact cubic support keeps every dimple exactly local and gives a zero
         derivative at its edge. The negative centre and outward-positive slope
         produce the concave water collar visible around each submerged state. */
      const support = 1 - (distanceSquared / radiusSquared)
      const supportSquared = support * support
      height -= safeProgress * depth * supportSquared * support
      const derivative = safeProgress * 6 * depth * supportSquared / radiusSquared
      slopeX += derivative * deltaX
      slopeZ += derivative * deltaZ
    }
  }

  target[offset] = height
  target[offset + 1] = slopeX
  target[offset + 2] = slopeZ
}

export function sampleInterferenceOutcomeSuction(
  x,
  z,
  origins = [],
  progress = 1,
  config = INTERFERENCE_OUTCOME_SUCTION_CONFIG
) {
  const sample = new Float32Array(3)
  writeOutcomeSuctionSample(x, z, origins, progress, config, sample, 0)
  return Object.freeze({
    height: sample[0],
    slopeX: sample[1],
    slopeZ: sample[2]
  })
}

function writeSolutionMoundSample(
  x,
  z,
  origin,
  config,
  scaleXZ,
  scaleY,
  target,
  offset
) {
  const originX = Number(origin?.x) || 0
  const originZ = Number(origin?.z) || 0
  const safeScaleXZ = Number.isFinite(scaleXZ) ? Math.max(0.0001, scaleXZ) : 1
  const safeScaleY = Number.isFinite(scaleY) ? Math.max(0, scaleY) : 1
  const radius = (Number.isFinite(config?.radius)
    ? Math.max(0.0001, config.radius)
    : INTERFERENCE_SOLUTION_MOUND_CONFIG.radius) * safeScaleXZ
  const height = (Number.isFinite(config?.height)
    ? Math.max(0, config.height)
    : INTERFERENCE_SOLUTION_MOUND_CONFIG.height) * safeScaleY
  const seatDepth = Number.isFinite(config?.seatDepth)
    ? Math.max(0, config.seatDepth)
    : INTERFERENCE_SOLUTION_MOUND_CONFIG.seatDepth
  const seatRadius = Number.isFinite(config?.seatRadius)
    ? Math.max(0.0001, config.seatRadius)
    : INTERFERENCE_SOLUTION_MOUND_CONFIG.seatRadius
  const deltaX = x - originX
  const deltaZ = z - originZ
  const distance = Math.hypot(deltaX, deltaZ)
  const radiusProgress = distance / radius

  if (height <= 0 || radiusProgress >= 1) {
    target[offset] = 0
    target[offset + 1] = 0
    target[offset + 2] = 0
    return
  }

  const domeBase = Math.max(0, 1 - (radiusProgress * radiusProgress))
  const dome = Math.pow(domeBase, 1.75)
  const seatProgress = Math.max(0, Math.min(1, radiusProgress / seatRadius))
  const seatSmooth = seatProgress * seatProgress * (3 - (2 * seatProgress))
  const seat = seatDepth * (1 - seatSmooth)
  const profile = dome - seat

  if (profile <= 0) {
    target[offset] = 0
    target[offset + 1] = 0
    target[offset + 2] = 0
    return
  }

  const domeDerivative = -3.5 * radiusProgress * Math.pow(domeBase, 0.75)
  const seatDerivative = seatProgress < 1
    ? -(seatDepth * 6 * seatProgress * (1 - seatProgress)) / seatRadius
    : 0
  const radialSlope = height * (domeDerivative - seatDerivative) / radius
  const directionX = distance > 0.000001 ? deltaX / distance : 0
  const directionZ = distance > 0.000001 ? deltaZ / distance : 0

  target[offset] = height * profile
  target[offset + 1] = radialSlope * directionX
  target[offset + 2] = radialSlope * directionZ
}

export function sampleInterferenceSolutionMound(
  x,
  z,
  origin = { x: 0, z: 0 },
  {
    config = INTERFERENCE_SOLUTION_MOUND_CONFIG,
    scaleXZ = 1,
    scaleY = 1
  } = {}
) {
  const sample = new Float32Array(3)
  writeSolutionMoundSample(x, z, origin, config, scaleXZ, scaleY, sample, 0)
  return Object.freeze({
    height: sample[0],
    slopeX: sample[1],
    slopeZ: sample[2]
  })
}

export function distributeInterferenceWaterCoordinate(
  normalizedCoordinate,
  halfExtent,
  density
) {
  const coordinate = Number.isFinite(normalizedCoordinate)
    ? Math.max(-1, Math.min(1, normalizedCoordinate))
    : 0
  const extent = Number.isFinite(halfExtent) ? Math.max(0, halfExtent) : 0
  const concentration = Number.isFinite(density) ? Math.max(0, density) : 0
  if (concentration < 0.0001) return coordinate * extent
  return (Math.sinh(coordinate * concentration) / Math.sinh(concentration)) * extent
}

function writeInterferenceHorizonSample(
  x,
  z,
  config,
  target
) {
  const safeX = Number.isFinite(x) ? x : 0
  const safeZ = Number.isFinite(z) ? z : 0
  const radius = Number.isFinite(config?.radius)
    ? Math.max(1, config.radius)
    : INTERFERENCE_HORIZON_CONFIG.radius
  const flatRadius = Number.isFinite(config?.flatRadius)
    ? Math.max(0, config.flatRadius)
    : INTERFERENCE_HORIZON_CONFIG.flatRadius
  const distance = Math.hypot(safeX, safeZ)
  const curvedDistance = Math.min(
    Math.max(0, distance - flatRadius),
    radius * 0.995
  )
  const capY = Math.sqrt(Math.max(0.0001, (radius * radius) -
    (curvedDistance * curvedDistance)))
  const radialNormal = curvedDistance / capY
  const directionX = distance > 0.0001 ? safeX / distance : 0
  const directionZ = distance > 0.0001 ? safeZ / distance : 0
  const normalX = radialNormal * directionX
  const normalZ = radialNormal * directionZ
  const normalLength = Math.hypot(normalX, 1, normalZ)

  target.height = capY - radius
  target.normalX = normalX / normalLength
  target.normalY = 1 / normalLength
  target.normalZ = normalZ / normalLength
  return target
}

export function sampleInterferenceHorizon(
  x,
  z,
  config = INTERFERENCE_HORIZON_CONFIG
) {
  return Object.freeze({ ...writeInterferenceHorizonSample(x, z, config, {}) })
}

function concentrateFullSurfaceGeometry(geometry, { depth, horizonConfig, width }) {
  const positions = geometry.attributes.position
  const normals = geometry.attributes.normal
  const halfWidth = width * 0.5
  const halfDepth = depth * 0.5
  const horizonSample = {}

  for (let index = 0; index < positions.count; index += 1) {
    const normalizedX = positions.getX(index) / Math.max(0.0001, halfWidth)
    const normalizedZ = positions.getZ(index) / Math.max(0.0001, halfDepth)
    const x = distributeInterferenceWaterCoordinate(
      normalizedX,
      halfWidth,
      FULL_SURFACE_DENSITY_X
    )
    const z = distributeInterferenceWaterCoordinate(
      normalizedZ,
      halfDepth,
      FULL_SURFACE_DENSITY_Z
    )
    writeInterferenceHorizonSample(x, z, horizonConfig, horizonSample)
    positions.setXYZ(index, x, horizonSample.height, z)
    normals.setXYZ(
      index,
      horizonSample.normalX,
      horizonSample.normalY,
      horizonSample.normalZ
    )
  }

  positions.needsUpdate = true
  normals.needsUpdate = true
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
}

function addOutcomeSuctionAttribute(THREE, geometry, origins, config) {
  const positions = geometry.attributes.position
  const samples = new Float32Array(positions.count * 3)
  const safeOrigins = Array.isArray(origins) ? origins : []

  for (let index = 0; index < positions.count; index += 1) {
    writeOutcomeSuctionSample(
      positions.getX(index),
      positions.getZ(index),
      safeOrigins,
      1,
      config,
      samples,
      index * 3
    )
  }

  geometry.setAttribute(
    'iqmOutcomeSuction',
    new THREE.BufferAttribute(samples, 3)
  )
}

function addSolutionMoundAttributes(THREE, geometry, origin, config) {
  const positions = geometry.attributes.position
  const settledSamples = new Float32Array(positions.count * 3)
  const outcomeSamples = new Float32Array(positions.count * 3)
  const hasOrigin = origin && Number.isFinite(origin.x) && Number.isFinite(origin.z)

  if (hasOrigin) {
    for (let index = 0; index < positions.count; index += 1) {
      const offset = index * 3
      const x = positions.getX(index)
      const z = positions.getZ(index)
      writeSolutionMoundSample(x, z, origin, config, 1, 1, settledSamples, offset)
      writeSolutionMoundSample(
        x,
        z,
        origin,
        config,
        config.outcomeScaleXZ,
        config.outcomeScaleY,
        outcomeSamples,
        offset
      )
    }
  }

  geometry.setAttribute(
    'iqmSolutionMoundSettled',
    new THREE.BufferAttribute(settledSamples, 3)
  )
  geometry.setAttribute(
    'iqmSolutionMoundOutcome',
    new THREE.BufferAttribute(outcomeSamples, 3)
  )
}

function createEmptyUniformState() {
  return {
    activeCount: 0,
    amplitude: 0,
    angularFrequency: 0,
    damping: 0,
    frontWidth: 1,
    impulses: [],
    speed: 0,
    trailDecay: DEFAULT_TRAIL_DECAY,
    waveNumber: 0
  }
}

/* Deliberately not THREE.Color: colour management would convert this to linear, and
   the wash consumes it in output space. */
function srgbTriple(THREE, hex) {
  const value = Number.parseInt(String(hex).replace('#', ''), 16)
  return new THREE.Vector3(
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255
  )
}

function patchWaterMaterial(THREE, material, {
  depth,
  edgeFadeConfig,
  horizonWashConfig,
  solutionPosition,
  solutionRadius,
  variant,
  width
}) {
  const ripples = Array.from(
    { length: MAX_RIPPLES },
    () => new THREE.Vector4(0, 0, -1000, 0)
  )
  const rippleRepeats = new Float32Array(MAX_RIPPLES)
  const uniforms = {
    uInterferenceActiveCount: { value: 0 },
    uInterferenceAmplitude: { value: 0 },
    uInterferenceAngularFrequency: { value: 0 },
    /* Crest-green / valley-red wash, faded in only while an explainer graph is
       on screen so the water reads the same way the diagram does. */
    uInterferenceCrestTint: { value: 0 },
    /* metres from the field centre over which the crest light and the wash give up */
    uInterferenceDetailFade: { value: new THREE.Vector2(7.5, 13) },
    /* the trough accent dies before the crest accent, so the compressed far field is
       green on blue rather than two colours of hash */
    uInterferenceTroughFade: { value: new THREE.Vector2(6.5, 12.5) },
    uInterferenceDamping: { value: 0 },
    uInterferenceEdgeFadeRange: {
      value: new THREE.Vector2(edgeFadeConfig.start, edgeFadeConfig.end)
    },
    uInterferenceHorizonColor: {
      value: srgbTriple(THREE, horizonWashConfig.color)
    },
    uInterferenceHorizonWashRange: {
      value: new THREE.Vector2(horizonWashConfig.start, horizonWashConfig.end)
    },
    uInterferenceFrontWidth: { value: 1 },
    uInterferenceHalfSize: { value: new THREE.Vector2(width * 0.5, depth * 0.5) },
    uInterferenceOutcomeProgress: { value: 0 },
    uInterferenceOutcomePulseProgress: { value: 0 },
    uInterferencePacketLength: { value: 1 },
    uInterferencePulseSpacing: { value: 1 },
    uInterferencePulseTaper: { value: 0.5 },
    uInterferenceRippleGain: { value: 1 },
    uInterferenceRippleRepeats: { value: rippleRepeats },
    uInterferenceRipples: { value: ripples },
    uInterferenceSolutionCenter: {
      value: new THREE.Vector2(
        Number(solutionPosition?.x) || 0,
        Number(solutionPosition?.z) || 0
      )
    },
    uInterferenceSpeed: { value: 0 },
    uInterferenceSolutionProgress: { value: 0 },
    uInterferenceSolutionRadius: {
      value: Number.isFinite(solutionRadius) ? Math.max(0.001, solutionRadius) : 1
    },
    uInterferenceTime: { value: 0 },
    uInterferenceTrailDecay: { value: DEFAULT_TRAIL_DECAY },
    uInterferenceWaveNumber: { value: 0 }
  }
  let compiledShader = null

  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
      #define IQM_MAX_RIPPLES ${MAX_RIPPLES}
      uniform int uInterferenceActiveCount;
      uniform float uInterferenceAmplitude;
      uniform float uInterferenceAngularFrequency;
      uniform float uInterferenceDamping;
      uniform float uInterferenceFrontWidth;
      uniform vec2 uInterferenceHalfSize;
      uniform float uInterferenceOutcomeProgress;
      uniform float uInterferenceOutcomePulseProgress;
      uniform float uInterferencePacketLength;
      uniform float uInterferencePulseSpacing;
      uniform float uInterferencePulseTaper;
      uniform float uInterferenceRippleGain;
      uniform float uInterferenceRippleRepeats[IQM_MAX_RIPPLES];
      uniform vec4 uInterferenceRipples[IQM_MAX_RIPPLES];
      uniform vec2 uInterferenceSolutionCenter;
      uniform float uInterferenceSpeed;
      uniform float uInterferenceSolutionProgress;
      uniform float uInterferenceSolutionRadius;
      uniform float uInterferenceTime;
      uniform float uInterferenceTrailDecay;
      uniform float uInterferenceWaveNumber;
      attribute vec3 iqmOutcomeSuction;
      attribute vec3 iqmSolutionMoundOutcome;
      attribute vec3 iqmSolutionMoundSettled;
      varying vec2 vIqmWaterPosition;
      varying float vIqmWaveHeight;
      varying vec2 vIqmWaveSlope;
      varying float vIqmWaveTallest;
      varying float vIqmRippleEnergy;
      varying float vIqmOutcomePulse;
      varying float vIqmSolutionMound;
      varying float vIqmSolutionWash;

      vec3 iqmOutcomePulseField(vec2 point) {
        float progress = clamp(uInterferenceOutcomePulseProgress, 0.0, 1.0);
        if (progress <= 0.0 || progress >= 1.0) return vec3(0.0);

        vec2 delta = point - uInterferenceSolutionCenter;
        float distanceFromCenter = max(0.0001, length(delta));
        float surfaceRadius = length(uInterferenceHalfSize) * 1.08;
        float ringRadius = mix(0.0, surfaceRadius, progress);
        float ringWidth = mix(1.35, 5.2, progress);
        float ringPosition = (distanceFromCenter - ringRadius) / ringWidth;
        float ring = exp(-2.4 * ringPosition * ringPosition);
        float life = smoothstep(0.0, 0.055, progress) *
          (1.0 - smoothstep(0.72, 1.0, progress));
        float height = 0.82 * ring * life;
        float radialDerivative = height * (-4.8 * ringPosition / ringWidth);
        return vec3(height, radialDerivative * (delta / distanceFromCenter));
      }

      /* tallestSingle is the largest contribution any one ring makes here. The
         summed amplitude divided by it says how many rings arrived in step, which is
         what lets a crossing read brighter rather than merely wider. */
      vec3 iqmInterferenceField(vec2 point, out float tallestSingle) {
        float height = 0.0;
        vec2 slope = vec2(0.0);
        tallestSingle = 0.0;
        if (
          uInterferenceActiveCount <= 0 ||
          uInterferenceRippleGain <= 0.0001
        ) return vec3(0.0);

        for (int index = 0; index < IQM_MAX_RIPPLES; index += 1) {
          if (index >= uInterferenceActiveCount) break;
          vec4 ripple = uInterferenceRipples[index];
          float age = uInterferenceTime - ripple.z;
          if (age < 0.0) continue;

          vec2 delta = point - ripple.xy;
          float radius = max(0.0001, length(delta));
          float front = uInterferenceSpeed * age;
          float rawProgress = (front - radius) / uInterferenceFrontWidth;
          if (rawProgress <= 0.0) continue;

          float distanceBehindFront = max(0.0, front - radius);
          float pulseDistance = uInterferenceRippleRepeats[index] > 0.5
            ? mod(
                distanceBehindFront,
                max(0.001, uInterferencePulseSpacing)
              )
            : distanceBehindFront;
          float pulseProgress = clamp(
            pulseDistance / uInterferenceFrontWidth,
            0.0,
            1.0
          );
          if (pulseDistance >= uInterferencePacketLength) continue;
          float frontGate = pulseProgress * pulseProgress *
            (3.0 - (2.0 * pulseProgress));
          float frontDerivative = pulseProgress < 1.0
            ? -((6.0 * pulseProgress) -
              (6.0 * pulseProgress * pulseProgress)) /
              uInterferenceFrontWidth
            : 0.0;
          float trail = exp(-uInterferenceTrailDecay * pulseDistance);
          /* Tail taped to nothing before the repeat: without it the envelope steps
             back to full strength at the wrap and draws a hard arc across the rings. */
          float taperProgress = clamp(
            (pulseDistance - (uInterferencePacketLength - uInterferencePulseTaper)) /
              max(0.0001, uInterferencePulseTaper),
            0.0,
            1.0
          );
          float taper = 1.0 - (taperProgress * taperProgress *
            (3.0 - (2.0 * taperProgress)));
          float taperSlope = (taperProgress > 0.0 && taperProgress < 1.0)
            ? -((6.0 * taperProgress) - (6.0 * taperProgress * taperProgress)) /
              max(0.0001, uInterferencePulseTaper)
            : 0.0;
          float visibleGate = frontGate * trail * taper;
          float visibleDerivative = (taper * trail * (
            frontDerivative + (uInterferenceTrailDecay * frontGate)
          )) - (frontGate * trail * taperSlope);

          float phase = (uInterferenceWaveNumber * radius) -
            (uInterferenceAngularFrequency * age) + ripple.w;
          float sine = sin(phase);
          float cosine = cos(phase);
          float attenuation = exp(-uInterferenceDamping * radius);
          float radialDerivative = uInterferenceAmplitude * attenuation * (
            (visibleDerivative * sine) +
            (visibleGate * (
              (uInterferenceWaveNumber * cosine) -
              (uInterferenceDamping * sine)
            ))
          );

          float contribution = uInterferenceRippleGain * uInterferenceAmplitude *
            attenuation * visibleGate;
          tallestSingle = max(tallestSingle, contribution);
          height += contribution * sine;
          slope += uInterferenceRippleGain * radialDerivative * (delta / radius);
        }

        return vec3(height, slope);
      }`
    )
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `float iqmWaveTallestSingle;
      vec3 iqmInterferenceWaveSample = iqmInterferenceField(position.xz, iqmWaveTallestSingle);
      vec3 iqmOutcomePulseSample = iqmOutcomePulseField(position.xz);
      vec3 iqmSolutionMoundSample = mix(
        iqmSolutionMoundSettled,
        iqmSolutionMoundOutcome,
        uInterferenceOutcomeProgress
      ) * uInterferenceSolutionProgress;
      vec3 iqmInterferenceSample = iqmInterferenceWaveSample +
        iqmOutcomePulseSample +
        (iqmOutcomeSuction * uInterferenceOutcomeProgress) +
        iqmSolutionMoundSample;
      #include <beginnormal_vertex>
      objectNormal = normalize(objectNormal + vec3(
        -iqmInterferenceSample.y,
        0.0,
        -iqmInterferenceSample.z
      ));`
    )
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      transformed.y += iqmInterferenceSample.x;
      vIqmWaterPosition = position.xz;
      /* The crest maths moved to the fragment stage, so the wave itself travels
         across as height and slope. Interpolating those two is faithful; interpolating
         a narrow band cut out of them is not, and the fragment stage is also the only
         place the on-screen ripple pitch can be measured. */
      vIqmWaveHeight = iqmInterferenceWaveSample.x;
      vIqmWaveSlope = iqmInterferenceWaveSample.yz;
      vIqmWaveTallest = iqmWaveTallestSingle;
      vIqmRippleEnergy = clamp(
        (abs(iqmInterferenceWaveSample.x) * 0.9) +
        (length(iqmInterferenceWaveSample.yz) * 0.11),
        0.0,
        1.0
      );
      vIqmOutcomePulse = clamp(
        (abs(iqmOutcomePulseSample.x) * 1.65) +
        (length(iqmOutcomePulseSample.yz) * 0.16),
        0.0,
        1.0
      );
      vIqmSolutionMound = smoothstep(
        0.004,
        0.82,
        iqmSolutionMoundSample.x
      );
      float iqmSolutionDistance = length(position.xz - uInterferenceSolutionCenter);
      float iqmSolutionWashRadius = uInterferenceSolutionRadius * 1.38;
      vIqmSolutionWash = uInterferenceSolutionProgress * (
        1.0 - smoothstep(
          uInterferenceSolutionRadius * 0.68,
          iqmSolutionWashRadius,
          iqmSolutionDistance
        )
      );`
    )

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      uniform vec2 uInterferenceEdgeFadeRange;
      uniform vec3 uInterferenceHorizonColor;
      uniform vec2 uInterferenceHorizonWashRange;
      uniform vec2 uInterferenceHalfSize;
      uniform float uInterferenceCrestTint;
      uniform vec2 uInterferenceDetailFade;
      uniform vec2 uInterferenceTroughFade;
      uniform float uInterferenceWaveNumber;
      varying vec2 vIqmWaterPosition;
      varying float vIqmWaveHeight;
      varying vec2 vIqmWaveSlope;
      varying float vIqmWaveTallest;
      varying float vIqmRippleEnergy;
      varying float vIqmOutcomePulse;
      varying float vIqmSolutionMound;
      varying float vIqmSolutionWash;`
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      float iqmDepthMix = clamp(
        (vIqmWaterPosition.y / max(0.001, uInterferenceHalfSize.y)) * 0.5 + 0.5,
        0.0,
        1.0
      );
      float iqmSideLight = 1.0 - clamp(
        abs(vIqmWaterPosition.x) / max(0.001, uInterferenceHalfSize.x),
        0.0,
        1.0
      );
      vec3 iqmNearWater = vec3(0.460, 0.680, 0.820);
      vec3 iqmFarWater = vec3(0.025, 0.330, 0.550);
      float iqmDepthBlend = smoothstep(0.22, 0.52, iqmDepthMix);
      vec3 iqmWaterColor = mix(iqmNearWater, iqmFarWater, iqmDepthBlend);
      float iqmQuietBand =
        (0.028 * exp(-pow((iqmDepthMix - 0.28) * 8.0, 2.0))) -
        (0.018 * exp(-pow((iqmDepthMix - 0.52) * 6.5, 2.0)));
      iqmWaterColor += vec3(0.022, 0.032, 0.036) * iqmSideLight;
      iqmWaterColor += vec3(iqmQuietBand);
      iqmWaterColor += vec3(0.150, 0.085, 0.050) *
        smoothstep(0.46, 0.56, iqmDepthMix);
      /*
       * Where the top of a wave is, measured from the wave itself.
       *
       * For a wave of this wavenumber the slope runs in quadrature with the height:
       * height is A*sin, slope is A*k*cos. So height and slope/k are the two legs of
       * the same local amplitude, and sqrt of their squares recovers A wherever the
       * surface happens to be in its cycle. height/A is then exactly 1 at the top of
       * every crest, whether that crest is a tall one beside its source or a faint one
       * at the far edge. An absolute height threshold has to be tuned to one crest
       * size and misses the rest.
       */
      float iqmWaveQuadrature = length(vIqmWaveSlope) /
        max(0.0001, uInterferenceWaveNumber);
      float iqmLocalAmplitude = sqrt(
        (vIqmWaveHeight * vIqmWaveHeight) +
        (iqmWaveQuadrature * iqmWaveQuadrature)
      );
      float iqmCrestRatio = vIqmWaveHeight / max(0.0001, iqmLocalAmplitude);

      /*
       * Two ways for the wave detail to bow out, both of which stop the far water
       * turning into a shimmering stripe mat. The first is metric: colour and crest
       * light are for the near field where a visitor is looking. The second is
       * screen-space: once one pixel spans a sizeable part of a wavelength there is
       * no crest left to resolve, only aliasing, so the detail gives up before it can
       * break into stipple. Measuring it per pixel means it holds at any camera height.
       */
      float iqmWavelength = 6.2831853 / max(0.0001, uInterferenceWaveNumber);
      float iqmFootprint = max(fwidth(vIqmWaterPosition.x), fwidth(vIqmWaterPosition.y));
      float iqmResolved = 1.0 - smoothstep(
        iqmWavelength * 0.10,
        iqmWavelength * 0.25,
        iqmFootprint
      );
      float iqmNearField = 1.0 - smoothstep(
        uInterferenceDetailFade.x,
        uInterferenceDetailFade.y,
        length(vIqmWaterPosition)
      );
      float iqmWaveDetail = smoothstep(0.005, 0.022, iqmLocalAmplitude) *
        iqmResolved * iqmNearField;

      /* The top of the crest only. No separate slope gate: at ratio 1 the surface is
         level by construction, so the ramp already carries it. */
      float iqmRippleCrest = smoothstep(0.80, 0.995, iqmCrestRatio) * iqmWaveDetail;

      /*
       * How many rings arrived here in step: 1 where a single ring passes alone, 2
       * where two crests land together. Without this, summation reads as a wider
       * green shape rather than a brighter one, and "peaks that line up amplify"
       * never actually shows up as amplification.
       */
      float iqmSummation = iqmLocalAmplitude / max(0.0001, vIqmWaveTallest);
      float iqmAdded = smoothstep(1.25, 2.30, iqmSummation);

      /* Coral runs on its own, nearer falloff, and only where the trough is deep
         enough to be a trough - otherwise every shallow dip in the crowded middle
         picks up a fleck of orange and the field fills with confetti. */
      float iqmTroughField = 1.0 - smoothstep(
        uInterferenceTroughFade.x,
        uInterferenceTroughFade.y,
        length(vIqmWaterPosition)
      );
      float iqmTroughDetail = smoothstep(0.012, 0.030, iqmLocalAmplitude) *
        iqmResolved * iqmTroughField;

      /*
       * The accent is drawn in two tiers rather than as one wash: a wide, faint halo
       * that gives the band a soft shoulder, and a narrow saturated core along the very
       * top of the crest and the floor of the trough. A single band at this strength
       * reads as a plastic strip; the pair reads as light lying on water. Water between
       * the accents keeps its own blue, which is what makes the surface look designed
       * rather than painted.
       */
      vec3 iqmCrestGreen = mix(
        vec3(0.220, 0.800, 0.520),
        vec3(0.520, 1.000, 0.720),
        iqmAdded
      );
      /* Lighter than the water it sits in. A dark red mixed into a dark trough turns
         brick; the accent has to stay above the water's own value to read as coral. */
      vec3 iqmValleyRed = vec3(1.000, 0.520, 0.400);
      float iqmCrestTint = clamp(uInterferenceCrestTint, 0.0, 1.0);

      /*
       * The two halves are deliberately not symmetric. Green is the hill: it starts
       * just above the rest line and covers the whole raised body of the wave, so the
       * eye reads the green mass as the wave itself. Coral is only the floor of the
       * trough, a narrow line at the very bottom. Run them at matching widths instead
       * and the broad warm band reads as the wave while the green looks like the gap
       * between two of them, which is exactly backwards.
       */
      /* The green band narrows with distance. Near the camera it carries the whole
         raised body of the wave; far off, where rings crowd together, it pulls back to
         the top so neighbouring rings keep daylight between them. */
      float iqmGreenLow = mix(0.30, 0.18, iqmNearField);

      float iqmHaloGreen = smoothstep(0.06, 0.34, iqmCrestRatio) * iqmWaveDetail;
      /* The trough is filled rather than outlined: a long shoulder starting near the
         waterline carries the colour down, and the core adds the last of it at the
         floor. Two overlapping ramps rather than one narrow band, so the coral has no
         edge of its own - it simply runs out as the water comes back up. */
      float iqmHaloRed = smoothstep(0.16, 0.70, -iqmCrestRatio) * iqmTroughDetail;
      iqmWaterColor = mix(iqmWaterColor, iqmCrestGreen, iqmCrestTint * iqmHaloGreen * 0.22);
      iqmWaterColor = mix(iqmWaterColor, iqmValleyRed, iqmCrestTint * iqmHaloRed * 0.20);

      float iqmCoreGreen = smoothstep(iqmGreenLow, 0.68, iqmCrestRatio) * iqmWaveDetail;
      float iqmCoreRed = smoothstep(0.58, 0.97, -iqmCrestRatio) * iqmTroughDetail;
      iqmWaterColor = mix(iqmWaterColor, iqmCrestGreen, iqmCrestTint * iqmCoreGreen * 0.85);
      iqmWaterColor = mix(iqmWaterColor, iqmValleyRed, iqmCrestTint * iqmCoreRed * 0.55);
      vec3 iqmSolutionGreen = vec3(0.155, 0.560, 0.315);
      iqmWaterColor = mix(
        iqmWaterColor,
        iqmSolutionGreen,
        0.36 * smoothstep(0.0, 1.0, vIqmSolutionWash)
      );
      iqmWaterColor = mix(
        iqmWaterColor,
        iqmSolutionGreen,
        0.82 * vIqmSolutionMound
      );
      diffuseColor.rgb = iqmWaterColor;
      float iqmHorizonWash = 0.0;
      ${variant === 'full'
        ? `/*
         * Ramp on how far this pixel sits BELOW THE HORIZON, not on how far away it
         * is. Distance is the wrong ruler here: the spherical cap bends the far water
         * away, so past roughly 48 m the surface loses height about as fast as it
         * gains distance and a dozen metres collapse into two or three screen rows.
         * Any distance-keyed ramp therefore arrives at the skyline almost vertically,
         * however its endpoints are placed - that is the hard top edge.
         *
         * tan(depression) is the natural ruler for haze over a ground plane, it maps
         * very nearly linearly to screen rows, and because it is built from the
         * fragment's height it already accounts for the cap instead of fighting it.
         * The ranges stay authored in metres: each one is converted to the angle that
         * flat water at that distance would subtend, so the numbers still read as
         * distances and follow the camera if its height changes.
         */
        vec3 iqmFragView = -vViewPosition;
        vec3 iqmUpView = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        float iqmAlong = dot(iqmFragView, iqmUpView);
        float iqmFlat = length(iqmFragView - (iqmUpView * iqmAlong));
        float iqmDepression = -iqmAlong / max(iqmFlat, 0.0001);
        float iqmEyeHeight = max(cameraPosition.y, 0.0001);
        iqmHorizonWash = 1.0 - smoothstep(
          iqmEyeHeight / uInterferenceHorizonWashRange.y,
          iqmEyeHeight / uInterferenceHorizonWashRange.x,
          iqmDepression
        );
        float iqmEdgeFade = 1.0 - smoothstep(
          iqmEyeHeight / uInterferenceEdgeFadeRange.y,
          iqmEyeHeight / uInterferenceEdgeFadeRange.x,
          iqmDepression
        );
        diffuseColor.a *= 1.0 - iqmEdgeFade;`
        : `vec2 iqmMenuPosition = abs(vIqmWaterPosition) /
          max(uInterferenceHalfSize, vec2(0.001));
        float iqmMenuRadius = length(iqmMenuPosition);
        diffuseColor.a *= 1.0 - smoothstep(0.82, 1.0, iqmMenuRadius);`}
      `
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
      float iqmGrazing = pow(
        1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))),
        2.0
      );
      float iqmRingSpecular = (vIqmRippleEnergy + vIqmOutcomePulse) *
        (0.055 + (0.18 * iqmGrazing));
      reflectedLight.indirectSpecular += vec3(iqmRingSpecular);`
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float iqmRippleLighting = clamp(vIqmRippleEnergy * 1.25, 0.0, 0.2);
      outgoingLight = mix(
        outgoingLight,
        iqmWaterColor,
        0.78 * (1.0 - iqmRippleLighting)
      );
      /* The cyan crest light and the green crest wash want the same pixels, and the
         light wins every time: a crest lit at this strength reads white-cyan, so the
         green never showed and the water looked like it carried only the red half.
         While an explainer graph is up the light steps aside and lets the colour
         carry the crest. */
      float iqmWaveEmission = clamp(
        (iqmRippleCrest * 2.6) +
        (vIqmRippleEnergy * 0.72) +
        (vIqmOutcomePulse * 2.1),
        0.0,
        2.35
      ) * (1.0 - (0.85 * iqmCrestTint));
      outgoingLight += vec3(0.1, 1.12, 1.5) * iqmWaveEmission;
      /* A small specular pip on the very top of the crest, only while the accent is
         up. It is what stops the green band reading as flat paint. */
      /* Gated hard on the pixel footprint, not merely scaled by it: a specular pip is
         a spike in the normal field, and where a wavelength covers two or three pixels
         it pops on and off between frames as scintillation rather than shimmer. */
      float iqmGlintGate = 1.0 - smoothstep(
        iqmWavelength * 0.06,
        iqmWavelength * 0.16,
        iqmFootprint
      );
      float iqmCrestGlint = smoothstep(0.93, 0.999, iqmCrestRatio) *
        iqmWaveDetail * iqmGlintGate * iqmCrestTint *
        min(0.55, 0.42 + (0.5 * iqmAdded));
      outgoingLight += vec3(0.82, 0.95, 1.0) * iqmCrestGlint;
      #include <opaque_fragment>`
    )
    /*
     * The wash lands AFTER tone mapping and the output-colour-space conversion, and
     * uInterferenceHorizonColor is stored as raw sRGB to match. scene.background is
     * blitted straight to the framebuffer without tone mapping, so a wash applied in
     * the lit path gets ACES-compressed on the way out and settles about 30 levels
     * below the sky it is supposed to disappear into - the far water goes grey
     * instead of going away. Matching in output space is exact by construction.
     */
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <colorspace_fragment>',
      `#include <colorspace_fragment>
      gl_FragColor.rgb = mix(
        gl_FragColor.rgb,
        uInterferenceHorizonColor,
        iqmHorizonWash
      );`
    )
    compiledShader = shader
  }
  material.customProgramCacheKey = () => `iqm-interference-water-v20-${variant}`

  function update(uniformState = createEmptyUniformState(), time = 0, {
    crestTint = 0,
    outcomeProgress = 0,
    pulseProgress = 0,
    rippleGain = 1,
    solutionProgress = 0
  } = {}) {
    const target = compiledShader?.uniforms || uniforms
    const impulses = Array.isArray(uniformState.impulses) ? uniformState.impulses : []
    target.uInterferenceTime.value = Number.isFinite(time) ? time : 0
    target.uInterferenceCrestTint.value = Number.isFinite(crestTint)
      ? Math.max(0, Math.min(1, crestTint))
      : 0
    target.uInterferenceOutcomeProgress.value = Number.isFinite(outcomeProgress)
      ? Math.max(0, Math.min(1, outcomeProgress))
      : 0
    target.uInterferenceOutcomePulseProgress.value = Number.isFinite(pulseProgress)
      ? Math.max(0, Math.min(1, pulseProgress))
      : 0
    target.uInterferencePulseSpacing.value = Number.isFinite(uniformState.pulseSpacing)
      ? Math.max(0.001, uniformState.pulseSpacing)
      : 1
    target.uInterferencePacketLength.value = Number.isFinite(uniformState.packetLength)
      ? Math.max(0.001, uniformState.packetLength)
      : target.uInterferencePulseSpacing.value
    target.uInterferencePulseTaper.value = Number.isFinite(uniformState.pulseTaper)
      ? Math.max(0.0001, uniformState.pulseTaper)
      : 0.5
    target.uInterferenceRippleGain.value = Number.isFinite(rippleGain) ? rippleGain : 1
    target.uInterferenceSolutionProgress.value = Number.isFinite(solutionProgress)
      ? Math.max(0, Math.min(1, solutionProgress))
      : 0
    target.uInterferenceActiveCount.value = Math.min(
      MAX_RIPPLES,
      Math.max(0, Number.isFinite(uniformState.activeCount)
        ? Math.floor(uniformState.activeCount)
        : impulses.length)
    )
    target.uInterferenceAmplitude.value = uniformState.amplitude ?? 0
    target.uInterferenceAngularFrequency.value = uniformState.angularFrequency ?? 0
    target.uInterferenceDamping.value = uniformState.damping ?? 0
    target.uInterferenceFrontWidth.value = Math.max(0.0001, uniformState.frontWidth ?? 1)
    target.uInterferenceSpeed.value = uniformState.speed ?? 0
    target.uInterferenceTrailDecay.value = Math.max(
      0,
      uniformState.trailDecay ?? DEFAULT_TRAIL_DECAY
    )
    target.uInterferenceWaveNumber.value = uniformState.waveNumber ?? 0

    for (let index = 0; index < MAX_RIPPLES; index += 1) {
      const impulse = impulses[index]
      if (impulse) {
        ripples[index].set(
          impulse.originX,
          impulse.originZ,
          impulse.startTime,
          impulse.phase
        )
        rippleRepeats[index] = impulse.repeating ? 1 : 0
      } else {
        ripples[index].set(0, 0, -1000, 0)
        rippleRepeats[index] = 0
      }
    }
  }

  return { update }
}

export function createInterferenceWater({
  THREE,
  width = 6.4,
  depth = 5.1,
  segmentsX = 256,
  segmentsZ = 160,
  edgeFadeConfig = INTERFERENCE_WATER_EDGE_FADE_CONFIG,
  horizonConfig = INTERFERENCE_HORIZON_CONFIG,
  horizonWashConfig = INTERFERENCE_WATER_HORIZON_WASH_CONFIG,
  outcomePullPositions = [],
  outcomeSuctionConfig = INTERFERENCE_OUTCOME_SUCTION_CONFIG,
  solutionMoundConfig = INTERFERENCE_SOLUTION_MOUND_CONFIG,
  solutionPosition = null,
  variant = 'full'
}) {
  if (!['full', 'menu'].includes(variant)) {
    throw new RangeError(`Unknown interference water variant: ${variant}`)
  }

  const safeEdgeFadeConfig = {
    end: Number.isFinite(edgeFadeConfig?.end)
      ? Math.max(0.001, edgeFadeConfig.end)
      : INTERFERENCE_WATER_EDGE_FADE_CONFIG.end,
    start: Number.isFinite(edgeFadeConfig?.start)
      ? Math.max(0, edgeFadeConfig.start)
      : INTERFERENCE_WATER_EDGE_FADE_CONFIG.start
  }
  safeEdgeFadeConfig.end = Math.max(
    safeEdgeFadeConfig.start + 0.001,
    safeEdgeFadeConfig.end
  )

  const safeHorizonWashConfig = {
    color: horizonWashConfig?.color || INTERFERENCE_WATER_HORIZON_WASH_CONFIG.color,
    end: Number.isFinite(horizonWashConfig?.end)
      ? Math.max(0.001, horizonWashConfig.end)
      : INTERFERENCE_WATER_HORIZON_WASH_CONFIG.end,
    start: Number.isFinite(horizonWashConfig?.start)
      ? Math.max(0, horizonWashConfig.start)
      : INTERFERENCE_WATER_HORIZON_WASH_CONFIG.start
  }
  safeHorizonWashConfig.end = Math.max(
    safeHorizonWashConfig.start + 0.001,
    safeHorizonWashConfig.end
  )

  const geometry = new THREE.PlaneGeometry(width, depth, segmentsX, segmentsZ)
  geometry.rotateX(-Math.PI / 2)
  /* The full sheet is intentionally huge so its horizon never reveals an edge. A
     uniform grid would spend almost all vertices outside the interactive field and
     leave only a handful across each 2.18 m ripple. Concentrating the same topology
     around the candidates gives smooth crests up close. Beyond that level field, the
     overscan bends into a spherical cap so the distant water has a curved horizon. */
  if (variant === 'full') {
    concentrateFullSurfaceGeometry(geometry, { depth, horizonConfig, width })
  }
  addOutcomeSuctionAttribute(
    THREE,
    geometry,
    variant === 'full' ? outcomePullPositions : [],
    outcomeSuctionConfig
  )
  addSolutionMoundAttributes(
    THREE,
    geometry,
    variant === 'full' ? solutionPosition : null,
    solutionMoundConfig
  )
  const material = new THREE.MeshPhysicalMaterial({
    clearcoat: 0.72,
    clearcoatRoughness: 0.22,
    color: '#ffffff',
    depthWrite: variant === 'full',
    envMapIntensity: 0.82,
    ior: 1.42,
    metalness: 0.04,
    opacity: 1,
    roughness: 0.27,
    side: THREE.DoubleSide,
    specularColor: '#f4ffff',
    specularIntensity: 0.68,
    transparent: true
  })
  material.forceSinglePass = true
  const controller = patchWaterMaterial(THREE, material, {
    depth,
    edgeFadeConfig: safeEdgeFadeConfig,
    horizonWashConfig: safeHorizonWashConfig,
    solutionPosition,
    solutionRadius: solutionMoundConfig.radius,
    variant,
    width
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'InterferenceWater'
  mesh.receiveShadow = false

  const group = new THREE.Group()
  group.name = 'InterferenceWaterSurface'
  group.add(mesh)

  return {
    group,
    mesh,
    update: controller.update,
    dispose() {
      geometry.dispose()
      material.dispose()
    }
  }
}
