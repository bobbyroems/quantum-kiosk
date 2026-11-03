export const PARTICLE_ROLES = Object.freeze({
  bath: 0,
  voltageEvacuated: 1,
  nanowireReserve: 2
})

export const PARTICLE_TIER_LEVELS = Object.freeze({
  low: 0,
  medium: 1,
  high: 2
})

export const PARTICLE_TIERS = Object.freeze({
  low: Object.freeze({ bath: 1200, voltageEvacuated: 320, nanowireReserve: 80, total: 1600 }),
  medium: Object.freeze({ bath: 1536, voltageEvacuated: 416, nanowireReserve: 96, total: 2048 }),
  high: Object.freeze({ bath: 1920, voltageEvacuated: 512, nanowireReserve: 128, total: 2560 })
})

export const DEFAULT_WIRE_LAYOUT = Object.freeze({
  xMin: -2.8,
  xMax: 2.8,
  surfaceY: 0.2094,
  zRows: Object.freeze([-0.86, 0.86])
})

// Normalized from the shipped BASE mesh after the scene's 11.9-unit fit. The
// outer footprint is 11.9 x 7.376 units with a roughly 0.28-unit corner radius.
export const CHIP_SURFACE_FOOTPRINT = Object.freeze({
  halfWidth: 5.95,
  halfDepth: 3.688,
  cornerRadius: 0.28
})

export const CHIP_SURFACE_Y = -0.16234

// Particle centres use the complete authored BASE footprint. Their sprites are
// clipped by the actual top-facing BASE triangles in the scene.
export const PARTICLE_FOOTPRINT = Object.freeze({
  halfWidth: CHIP_SURFACE_FOOTPRINT.halfWidth,
  halfDepth: CHIP_SURFACE_FOOTPRINT.halfDepth,
  cornerRadius: CHIP_SURFACE_FOOTPRINT.cornerRadius,
  edgeAttenuationDistance: 0.7
})

export const VOLTAGE_CORRIDORS = Object.freeze({
  zCenters: Object.freeze([-0.86, 0.86]),
  halfWidth: 0.8,
  xMin: -3.24,
  xMax: 3.24
})

export const PARTICLE_VOLUME = Object.freeze({
  xMin: -PARTICLE_FOOTPRINT.halfWidth,
  xMax: PARTICLE_FOOTPRINT.halfWidth,
  yMin: -0.15,
  yMax: -0.12,
  zMin: -PARTICLE_FOOTPRINT.halfDepth,
  zMax: PARTICLE_FOOTPRINT.halfDepth
})

export const THERMAL_MOTION_PROFILE = Object.freeze({
  agitatedSpeed: 2,
  settledSpeed: 0.55,
  agitatedAmplitude: 1,
  settledAmplitude: 0.08,
  edgeMotionFloor: 0.34
})

const TAU = Math.PI * 2
const EVACUATION_TARGETS_PER_SIDE = PARTICLE_TIERS.high.voltageEvacuated / 2
const EVACUATION_BLUE_NOISE_CANDIDATES = 12
const EVACUATION_TARGET_MIN_DEPTH = 2.28
const EVACUATION_TARGET_MAX_DEPTH = PARTICLE_FOOTPRINT.halfDepth - 0.055
const PAIR_SURFACE_CLEARANCE = 0.022
const PAIR_LOCK_START = 0.72
const PAIR_LOCK_XZ_JITTER = 0.07
const PAIR_LOCK_Y_JITTER = 0.18

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function clamp01(value) {
  return clamp(value, 0, 1)
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1
  const normalized = clamp01((value - edge0) / (edge1 - edge0))
  return normalized * normalized * (3 - (2 * normalized))
}

export function roundedFootprintSignedDistance(
  x,
  z,
  footprint = PARTICLE_FOOTPRINT
) {
  const radius = Math.max(0, Math.min(
    Number(footprint.cornerRadius) || 0,
    Number(footprint.halfWidth) || 0,
    Number(footprint.halfDepth) || 0
  ))
  const innerHalfWidth = Math.max(0, footprint.halfWidth - radius)
  const innerHalfDepth = Math.max(0, footprint.halfDepth - radius)
  const distanceX = Math.abs(x) - innerHalfWidth
  const distanceZ = Math.abs(z) - innerHalfDepth
  const outsideDistance = Math.hypot(Math.max(distanceX, 0), Math.max(distanceZ, 0))
  const insideDistance = Math.min(Math.max(distanceX, distanceZ), 0)
  return outsideDistance + insideDistance - radius
}

export function isInsideParticleFootprint(x, z, footprint = PARTICLE_FOOTPRINT) {
  return roundedFootprintSignedDistance(x, z, footprint) <= 1e-7
}

export function projectToParticleFootprint(x, z, footprint = PARTICLE_FOOTPRINT) {
  if (isInsideParticleFootprint(x, z, footprint)) return { x, z }

  const radius = Math.max(0, Math.min(
    Number(footprint.cornerRadius) || 0,
    Number(footprint.halfWidth) || 0,
    Number(footprint.halfDepth) || 0
  ))
  if (radius <= 1e-7) {
    return {
      x: clamp(x, -footprint.halfWidth, footprint.halfWidth),
      z: clamp(z, -footprint.halfDepth, footprint.halfDepth)
    }
  }

  const signX = x < 0 ? -1 : 1
  const signZ = z < 0 ? -1 : 1
  const absoluteX = Math.abs(x)
  const absoluteZ = Math.abs(z)
  const innerHalfWidth = footprint.halfWidth - radius
  const innerHalfDepth = footprint.halfDepth - radius

  if (absoluteX <= innerHalfWidth) {
    return { x, z: signZ * footprint.halfDepth }
  }
  if (absoluteZ <= innerHalfDepth) {
    return { x: signX * footprint.halfWidth, z }
  }

  const cornerX = absoluteX - innerHalfWidth
  const cornerZ = absoluteZ - innerHalfDepth
  const cornerDistance = Math.max(1e-7, Math.hypot(cornerX, cornerZ))
  return {
    x: signX * (innerHalfWidth + ((cornerX / cornerDistance) * radius)),
    z: signZ * (innerHalfDepth + ((cornerZ / cornerDistance) * radius))
  }
}

export function particleEdgeAttenuation(x, z, footprint = PARTICLE_FOOTPRINT) {
  const distanceInside = -roundedFootprintSignedDistance(x, z, footprint)
  return smoothstep(0, footprint.edgeAttenuationDistance, distanceInside)
}

function seededRandom(seed) {
  let value = seed >>> 0
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0
    return value / 4294967296
  }
}

function createChaoticFootprintSampler(seed, salt, predicate = () => true) {
  const random = seededRandom((seed ^ salt) >>> 0)
  return () => {
    // Seeded rejection keeps every mount stable while retaining the local
    // clustering and uneven gaps of a natural random field. The previous R2
    // sequence was evenly spaced enough to read as a repeating lattice.
    for (;;) {
      const x = ((random() * 2) - 1) * PARTICLE_FOOTPRINT.halfWidth
      const z = ((random() * 2) - 1) * PARTICLE_FOOTPRINT.halfDepth
      if (isInsideParticleFootprint(x, z) && predicate(x, z)) return { x, z }
    }
  }
}

function horizontalFootprintExtentAt(z, footprint = PARTICLE_FOOTPRINT) {
  const radius = footprint.cornerRadius
  const innerHalfDepth = footprint.halfDepth - radius
  if (Math.abs(z) <= innerHalfDepth || radius <= 1e-7) return footprint.halfWidth
  const cornerDepth = Math.abs(z) - innerHalfDepth
  const cornerWidth = Math.sqrt(Math.max(
    0,
    (radius * radius) - (cornerDepth * cornerDepth)
  ))
  return (footprint.halfWidth - radius) + cornerWidth
}

function createEvacuationTargets(seed, side) {
  const random = seededRandom((seed ^ (side < 0 ? 0x6d2b79f5 : 0x9e3779b9)) >>> 0)
  const normalizedTargets = []
  const targets = new Float32Array(EVACUATION_TARGETS_PER_SIDE * 2)

  for (let ordinal = 0; ordinal < EVACUATION_TARGETS_PER_SIDE; ordinal += 1) {
    let selectedU = 0.5
    let selectedV = 0.5
    let selectedDistance = -1
    const candidateCount = ordinal === 0 ? 1 : EVACUATION_BLUE_NOISE_CANDIDATES

    for (let candidate = 0; candidate < candidateCount; candidate += 1) {
      const u = random()
      const v = random()
      let nearestDistance = Number.POSITIVE_INFINITY
      for (let targetIndex = 0; targetIndex < normalizedTargets.length; targetIndex += 2) {
        const deltaX = (u - normalizedTargets[targetIndex]) * (PARTICLE_FOOTPRINT.halfWidth * 2)
        const deltaZ = (v - normalizedTargets[targetIndex + 1]) *
          (EVACUATION_TARGET_MAX_DEPTH - EVACUATION_TARGET_MIN_DEPTH)
        nearestDistance = Math.min(nearestDistance, (deltaX * deltaX) + (deltaZ * deltaZ))
      }
      if (nearestDistance > selectedDistance) {
        selectedU = u
        selectedV = v
        selectedDistance = nearestDistance
      }
    }

    normalizedTargets.push(selectedU, selectedV)
    const targetOffset = ordinal * 2
    const targetZ = side * (
      EVACUATION_TARGET_MIN_DEPTH +
      (selectedV * (EVACUATION_TARGET_MAX_DEPTH - EVACUATION_TARGET_MIN_DEPTH))
    )
    const targetHalfWidth = horizontalFootprintExtentAt(targetZ) - 0.035
    const projected = projectToParticleFootprint(
      ((selectedU * 2) - 1) * targetHalfWidth,
      targetZ
    )
    targets[targetOffset] = projected.x
    targets[targetOffset + 1] = projected.z
  }

  return targets
}

function tierForOrdinal(role, ordinal) {
  if (ordinal < PARTICLE_TIERS.low[role]) return PARTICLE_TIER_LEVELS.low
  if (ordinal < PARTICLE_TIERS.medium[role]) return PARTICLE_TIER_LEVELS.medium
  return PARTICLE_TIER_LEVELS.high
}

function isInsideVoltageCorridor(x, z, margin = 0) {
  const safeMargin = Math.max(0, Number(margin) || 0)
  return x >= VOLTAGE_CORRIDORS.xMin - safeMargin &&
    x <= VOLTAGE_CORRIDORS.xMax + safeMargin &&
    VOLTAGE_CORRIDORS.zCenters.some(
      center => Math.abs(z - center) <= VOLTAGE_CORRIDORS.halfWidth + safeMargin
    )
}

function createChaoticCorridorSampler(seed, corridorIndex) {
  const random = seededRandom((seed ^ (
    corridorIndex === 0 ? 0x51ed270b : 0x743a9c5d
  )) >>> 0)
  const centerZ = VOLTAGE_CORRIDORS.zCenters[corridorIndex]
  return () => {
    return {
      x: VOLTAGE_CORRIDORS.xMin +
        (random() * (VOLTAGE_CORRIDORS.xMax - VOLTAGE_CORRIDORS.xMin)),
      z: centerZ + (((random() * 2) - 1) * VOLTAGE_CORRIDORS.halfWidth * 0.97)
    }
  }
}

function createPairSlots() {
  const low = [0, 2, 3, 5, 7, 8, 10, 12, 13, 15, 16, 18, 20, 21, 23, 25, 26, 28, 29, 31]
  const mediumAdditions = [4, 11, 19, 27]
  const highAdditions = [1, 6, 9, 14, 17, 22, 24, 30]
  return [
    ...low.map(slot => ({ slot, tier: 0 })),
    ...mediumAdditions.map(slot => ({ slot, tier: 1 })),
    ...highAdditions.map(slot => ({ slot, tier: 2 }))
  ]
}

function normalizeWireLayout(layout = DEFAULT_WIRE_LAYOUT) {
  const xMin = Number.isFinite(layout.xMin) ? layout.xMin : DEFAULT_WIRE_LAYOUT.xMin
  const xMax = Number.isFinite(layout.xMax) ? layout.xMax : DEFAULT_WIRE_LAYOUT.xMax
  const surfaceY = Number.isFinite(layout.surfaceY)
    ? layout.surfaceY
    : DEFAULT_WIRE_LAYOUT.surfaceY
  const rows = Array.isArray(layout.zRows) && layout.zRows.length >= 2
    ? [...layout.zRows].slice(0, 2).sort((a, b) => a - b)
    : [...DEFAULT_WIRE_LAYOUT.zRows]
  return {
    xMin: Math.min(xMin, xMax - 0.1),
    xMax: Math.max(xMax, xMin + 0.1),
    surfaceY,
    zRows: rows
  }
}

function assignThermal(thermal, index, random, scale = 1) {
  const offset = index * 4
  thermal[offset] = random() * TAU
  thermal[offset + 1] = 0.7 + (random() * 0.75)
  thermal[offset + 2] = (0.22 + (random() * 0.46)) * (random() < 0.5 ? -1 : 1) * scale
  thermal[offset + 3] = (0.2 + (random() * 0.42)) * (random() < 0.5 ? -1 : 1) * scale
}

function writeParticle(arrays, index, {
  role,
  minTier,
  baseX,
  baseY,
  baseZ,
  voltageX = baseX,
  voltageY = baseY,
  voltageZ = baseZ,
  overvoltageX = baseX,
  overvoltageY = baseY,
  overvoltageZ = baseZ,
  magneticX = baseX,
  magneticY = baseY,
  magneticZ = baseZ,
  pairRow = -1,
  pairSlot = -1,
  random,
  thermalScale = 1
}) {
  const offset = index * 3
  arrays.basePosition[offset] = baseX
  arrays.basePosition[offset + 1] = baseY
  arrays.basePosition[offset + 2] = baseZ
  arrays.voltageDisplacement[offset] = voltageX - baseX
  arrays.voltageDisplacement[offset + 1] = voltageY - baseY
  arrays.voltageDisplacement[offset + 2] = voltageZ - baseZ
  arrays.overvoltageDisplacement[offset] = overvoltageX - baseX
  arrays.overvoltageDisplacement[offset + 1] = overvoltageY - baseY
  arrays.overvoltageDisplacement[offset + 2] = overvoltageZ - baseZ
  arrays.magneticDisplacement[offset] = magneticX - baseX
  arrays.magneticDisplacement[offset + 1] = magneticY - baseY
  arrays.magneticDisplacement[offset + 2] = magneticZ - baseZ
  arrays.role[index] = role
  arrays.minTier[index] = minTier
  arrays.pairRow[index] = pairRow
  arrays.pairSlot[index] = pairSlot
  assignThermal(arrays.thermal, index, random, thermalScale)
}

export function createProtectingParticleData({
  seed = 58921,
  wireLayout = DEFAULT_WIRE_LAYOUT
} = {}) {
  const random = seededRandom(seed)
  const sampleBathPosition = createChaoticFootprintSampler(
    seed,
    0x2c9277b5,
    // A small guard band prevents cold thermal jitter from drifting ordinary
    // bath electrons back beneath the authored H gates after Voltage is tuned.
    (x, z) => !isInsideVoltageCorridor(x, z, 0.2)
  )
  const sampleVoltagePosition = VOLTAGE_CORRIDORS.zCenters.map((_, corridorIndex) =>
    createChaoticCorridorSampler(seed, corridorIndex)
  )
  const evacuationTargets = [
    createEvacuationTargets(seed, -1),
    createEvacuationTargets(seed, 1)
  ]
  const layout = normalizeWireLayout(wireLayout)
  const count = PARTICLE_TIERS.high.total
  const arrays = {
    basePosition: new Float32Array(count * 3),
    thermal: new Float32Array(count * 4),
    voltageDisplacement: new Float32Array(count * 3),
    overvoltageDisplacement: new Float32Array(count * 3),
    magneticDisplacement: new Float32Array(count * 3),
    role: new Float32Array(count),
    minTier: new Float32Array(count),
    pairRow: new Float32Array(count),
    pairSlot: new Float32Array(count)
  }
  let index = 0

  for (let ordinal = 0; ordinal < PARTICLE_TIERS.high.bath; ordinal += 1) {
    const { x: baseX, z: baseZ } = sampleBathPosition()
    writeParticle(arrays, index, {
      role: PARTICLE_ROLES.bath,
      minTier: tierForOrdinal('bath', ordinal),
      baseX,
      baseY: -0.136 + ((random() - 0.5) * 0.024),
      baseZ,
      random,
      thermalScale: 0.78
    })
    index += 1
  }

  for (let ordinal = 0; ordinal < PARTICLE_TIERS.high.voltageEvacuated; ordinal += 1) {
    const corridorIndex = ordinal % 2
    const targetOffset = Math.floor(ordinal / 2) * 2
    const { x: baseX, z: baseZ } = sampleVoltagePosition[corridorIndex]()
    const targetX = evacuationTargets[corridorIndex][targetOffset]
    const targetZ = evacuationTargets[corridorIndex][targetOffset + 1]
    const voltageY = -0.134 + ((random() - 0.5) * 0.024)
    writeParticle(arrays, index, {
      role: PARTICLE_ROLES.voltageEvacuated,
      minTier: tierForOrdinal('voltageEvacuated', ordinal),
      baseX,
      baseY: voltageY,
      baseZ,
      voltageX: targetX,
      voltageY: clamp(voltageY + ((random() - 0.5) * 0.008), PARTICLE_VOLUME.yMin, PARTICLE_VOLUME.yMax),
      voltageZ: targetZ,
      random,
      thermalScale: 0.72
    })
    index += 1
  }

  const pairSlots = createPairSlots()
  const pairInset = Math.min(0.065, (layout.xMax - layout.xMin) * 0.08)
  const pairXMin = layout.xMin + pairInset
  const pairXMax = layout.xMax - pairInset
  for (let row = 0; row < 2; row += 1) {
    for (const { slot, tier } of pairSlots) {
      const pairX = pairXMin + ((slot / 31) * (pairXMax - pairXMin))
      for (const memberOffset of [-0.03, 0.03]) {
        const baseX = layout.xMin + (random() * (layout.xMax - layout.xMin))
        const baseZ = layout.zRows[row] + ((random() - 0.5) * 0.3)
        const evacuationOrdinal = (slot * 2) + (memberOffset > 0 ? 1 : 0)
        const evacuationOffset = evacuationOrdinal * 2
        const overvoltageX = evacuationTargets[row][evacuationOffset]
        const overvoltageZ = evacuationTargets[row][evacuationOffset + 1]
        writeParticle(arrays, index, {
          role: PARTICLE_ROLES.nanowireReserve,
          minTier: tier,
          baseX,
          baseY: -0.127 + ((random() - 0.5) * 0.012),
          baseZ,
          overvoltageX,
          overvoltageY: -0.134 + ((random() - 0.5) * 0.024),
          overvoltageZ,
          magneticX: pairX + memberOffset,
          magneticY: layout.surfaceY + PAIR_SURFACE_CLEARANCE,
          magneticZ: layout.zRows[row],
          pairRow: row,
          pairSlot: slot,
          random,
          thermalScale: 0.32
        })
        index += 1
      }
    }
  }

  return {
    seed,
    count,
    counts: PARTICLE_TIERS,
    wireLayout: layout,
    ...arrays
  }
}

export function countParticlesForTier(data, tier = 'high') {
  const level = PARTICLE_TIER_LEVELS[tier] ?? PARTICLE_TIER_LEVELS.high
  const counts = { bath: 0, voltageEvacuated: 0, nanowireReserve: 0, total: 0 }
  for (let index = 0; index < data.count; index += 1) {
    if (data.minTier[index] > level) continue
    const role = data.role[index]
    if (role === PARTICLE_ROLES.bath) counts.bath += 1
    else if (role === PARTICLE_ROLES.voltageEvacuated) counts.voltageEvacuated += 1
    else if (role === PARTICLE_ROLES.nanowireReserve) counts.nanowireReserve += 1
    counts.total += 1
  }
  return counts
}

export function advanceThermalTime(currentTime, deltaSeconds, temperatureDrive) {
  const drive = Math.min(1, Math.max(0, Number(temperatureDrive) || 0))
  const delta = Math.max(0, Number(deltaSeconds) || 0)
  const speed = THERMAL_MOTION_PROFILE.agitatedSpeed + (
    (THERMAL_MOTION_PROFILE.settledSpeed - THERMAL_MOTION_PROFILE.agitatedSpeed) * drive
  )
  return (Number(currentTime) || 0) + (delta * speed)
}

export function composeParticlePosition(data, index, {
  thermalTime = 0,
  temperatureDrive = 0,
  voltageDrive = 0,
  voltageOverdriveDrive = 0,
  magneticDrive = 0
} = {}) {
  const offset = index * 3
  const thermalOffset = index * 4
  const temperature = clamp01(temperatureDrive)
  const voltage = clamp01(voltageDrive)
  const voltageOverdrive = clamp01(voltageOverdriveDrive)
  const magnetic = clamp01(magneticDrive)
  const reserve = data.role[index] === PARTICLE_ROLES.nanowireReserve ? 1 : 0
  const pairLock = reserve * smoothstep(PAIR_LOCK_START, 1, magnetic)
  const amplitude = THERMAL_MOTION_PROFILE.agitatedAmplitude + (
    (THERMAL_MOTION_PROFILE.settledAmplitude - THERMAL_MOTION_PROFILE.agitatedAmplitude) *
      temperature
  )
  const phase = data.thermal[thermalOffset]
  const speed = data.thermal[thermalOffset + 1]
  const travel = thermalTime * speed
  let effectX = data.basePosition[offset] +
    (data.voltageDisplacement[offset] * voltage) +
    (data.magneticDisplacement[offset] * magnetic)
  let effectY = data.basePosition[offset + 1] +
    (data.voltageDisplacement[offset + 1] * voltage) +
    (data.magneticDisplacement[offset + 1] * magnetic)
  let effectZ = data.basePosition[offset + 2] +
    (data.voltageDisplacement[offset + 2] * voltage) +
    (data.magneticDisplacement[offset + 2] * magnetic)
  if (reserve > 0 && voltageOverdrive > 0) {
    const overvoltageX = data.basePosition[offset] + data.overvoltageDisplacement[offset]
    const overvoltageY = data.basePosition[offset + 1] + data.overvoltageDisplacement[offset + 1]
    const overvoltageZ = data.basePosition[offset + 2] + data.overvoltageDisplacement[offset + 2]
    effectX += (overvoltageX - effectX) * voltageOverdrive
    effectY += (overvoltageY - effectY) * voltageOverdrive
    effectZ += (overvoltageZ - effectZ) * voltageOverdrive
  }
  const edgeAttenuation = particleEdgeAttenuation(effectX, effectZ)
  const edgeMotion = THERMAL_MOTION_PROFILE.edgeMotionFloor + (
    (1 - THERMAL_MOTION_PROFILE.edgeMotionFloor) * edgeAttenuation
  )
  const x = effectX +
    (Math.sin(travel + phase) * data.thermal[thermalOffset + 2] * amplitude *
      edgeMotion * (1 - (pairLock * (1 - PAIR_LOCK_XZ_JITTER))))
  const y = effectY +
      (Math.sin((travel * 1.3) + phase) * 0.025 * amplitude *
        (1 - (pairLock * (1 - PAIR_LOCK_Y_JITTER))))
  const z = effectZ +
    (Math.cos((travel * 0.86) + phase) * data.thermal[thermalOffset + 3] *
      amplitude * edgeMotion * (1 - (pairLock * (1 - PAIR_LOCK_XZ_JITTER))))
  const projected = projectToParticleFootprint(x, z)
  const magneticTargetY = data.basePosition[offset + 1] + data.magneticDisplacement[offset + 1]
  const pairedYCeiling = Math.max(PARTICLE_VOLUME.yMax, magneticTargetY + 0.035)
  const particleYCeiling = PARTICLE_VOLUME.yMax + (
    (pairedYCeiling - PARTICLE_VOLUME.yMax) * reserve * magnetic
  )
  return {
    x: projected.x,
    y: clamp(y, PARTICLE_VOLUME.yMin, particleYCeiling),
    z: projected.z
  }
}

export function isParticleInVoltageCorridor(data, index) {
  const offset = index * 3
  return isInsideVoltageCorridor(data.basePosition[offset], data.basePosition[offset + 2])
}

export function sampleNanowireReserve(data, { count = 40, tier = 'high' } = {}) {
  const activeLevel = PARTICLE_TIER_LEVELS[tier] ?? PARTICLE_TIER_LEVELS.high
  const pairsByRow = [new Map(), new Map()]
  for (let index = 0; index < data.count; index += 1) {
    if (data.role[index] !== PARTICLE_ROLES.nanowireReserve || data.minTier[index] > activeLevel) continue
    const row = data.pairRow[index]
    const slot = data.pairSlot[index]
    const members = pairsByRow[row].get(slot) || []
    members.push(index)
    pairsByRow[row].set(slot, members)
  }

  const desiredPairsPerRow = Math.max(1, Math.floor(count / 4))
  const sample = []
  for (let row = 0; row < 2; row += 1) {
    const pairs = [...pairsByRow[row].entries()].sort((a, b) => a[0] - b[0])
    const pairCount = Math.min(desiredPairsPerRow, pairs.length)
    for (let ordinal = 0; ordinal < pairCount; ordinal += 1) {
      const pairIndex = pairCount === 1
        ? Math.floor((pairs.length - 1) / 2)
        : Math.round((ordinal / (pairCount - 1)) * (pairs.length - 1))
      for (const index of pairs[pairIndex][1]) {
        const offset = index * 3
        sample.push({
          index,
          row,
          pairSlot: data.pairSlot[index],
          base: Object.freeze({
            x: data.basePosition[offset],
            y: data.basePosition[offset + 1],
            z: data.basePosition[offset + 2]
          }),
          paired: Object.freeze({
            x: data.basePosition[offset] + data.magneticDisplacement[offset],
            y: data.basePosition[offset + 1] + data.magneticDisplacement[offset + 1],
            z: data.basePosition[offset + 2] + data.magneticDisplacement[offset + 2]
          })
        })
      }
    }
  }
  return Object.freeze(sample.slice(0, count))
}

export function recommendedParticleTierLevel(previousPerformance) {
  if (!previousPerformance?.finalTier) return PARTICLE_TIER_LEVELS.high
  const previousLevel = PARTICLE_TIER_LEVELS[previousPerformance.finalTier]
  if (!Number.isFinite(previousLevel)) return PARTICLE_TIER_LEVELS.high
  const windows = Array.isArray(previousPerformance.windows) ? previousPerformance.windows : []
  const lastWindow = windows.at(-1)
  return lastWindow?.failedBudget === false
    ? Math.min(PARTICLE_TIER_LEVELS.high, previousLevel + 1)
    : previousLevel
}
