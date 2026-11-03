function freezeLight(light) {
  const frozen = { ...light }
  if (light.position) frozen.position = Object.freeze({ ...light.position })
  if (light.target) frozen.target = Object.freeze({ ...light.target })
  if (light.tuning) frozen.tuning = Object.freeze({ ...light.tuning })
  return Object.freeze(frozen)
}

export const MAJORANA_INTRO_LIGHTING = Object.freeze({
  // Keep the studio environment present enough to draw crisp reflections.
  // The gold identity comes from the material palette; the key stays close to
  // neutral so the device does not drift into an orange/bronze cast.
  environmentIntensity: 0.76,
  environmentRotationXDegrees: 26,
  environmentRotationYDegrees: 330,
  exposure: 0.75,
  lights: Object.freeze([
    freezeLight({
      name: 'key',
      color: '#ffffff',
      intensity: 3.2,
      // Authored with the temporary camera-relative light tool. Keeping these
      // exact values avoids a lossy conversion back through world XYZ.
      tuning: {
        azimuthDegrees: 85,
        elevationDegrees: -38,
        distanceByModelHeight: 1.18,
        targetRightByModelWidth: -0.48,
        targetUpByModelHeight: 0.53,
        targetFrontByModelHeight: 0.11,
        widthByModelWidth: 0.7,
        heightByModelHeight: 1.34,
        rollDegrees: -9
      }
    }),
    freezeLight({
      name: 'fill',
      color: '#f1f3f6',
      intensity: 1.25,
      widthByModelWidth: 2.8,
      heightByModelHeight: 2.2,
      position: {
        rightByModelWidth: 0,
        upByModelHeight: -0.35,
        frontByModelHeight: 2.5
      },
      target: { upByModelHeight: -0.24 }
    }),
    freezeLight({
      name: 'rim',
      color: '#fff9ee',
      intensity: 4.8,
      widthByModelWidth: 1.12,
      heightByModelHeight: 0.14,
      position: {
        rightByModelWidth: 0,
        upByModelHeight: -0.92,
        frontByModelHeight: 0.68
      },
      target: { upByModelHeight: -0.34 }
    })
  ])
})

function normalize([x, y, z], fallback) {
  const length = Math.hypot(x, y, z)
  if (!Number.isFinite(length) || length <= Number.EPSILON) return [...fallback]
  return [x / length, y / length, z / length]
}

function offsetPoint(center, front, right, modelWidth, modelHeight, offset = {}) {
  const rightOffset = (offset.rightByModelWidth ?? 0) * modelWidth
  const upOffset = (offset.upByModelHeight ?? 0) * modelHeight
  const frontOffset = (offset.frontByModelHeight ?? 0) * modelHeight

  return [
    center[0] + (right[0] * rightOffset) + (front[0] * frontOffset),
    center[1] + upOffset + (front[1] * frontOffset),
    center[2] + (right[2] * rightOffset) + (front[2] * frontOffset)
  ]
}

function tunedPosition(center, front, right, modelHeight, tuning) {
  const azimuth = tuning.azimuthDegrees * Math.PI / 180
  const elevation = tuning.elevationDegrees * Math.PI / 180
  const distance = tuning.distanceByModelHeight * modelHeight
  const horizontalDistance = Math.cos(elevation) * distance

  return [
    center[0] +
      (front[0] * Math.cos(azimuth) * horizontalDistance) +
      (right[0] * Math.sin(azimuth) * horizontalDistance),
    center[1] + (Math.sin(elevation) * distance),
    center[2] +
      (front[2] * Math.cos(azimuth) * horizontalDistance) +
      (right[2] * Math.sin(azimuth) * horizontalDistance)
  ]
}

function tunedTarget(center, front, right, modelWidth, modelHeight, tuning) {
  const rightOffset = tuning.targetRightByModelWidth * modelWidth
  const frontOffset = tuning.targetFrontByModelHeight * modelHeight
  return [
    center[0] + (right[0] * rightOffset) + (front[0] * frontOffset),
    center[1] + (tuning.targetUpByModelHeight * modelHeight),
    center[2] + (right[2] * rightOffset) + (front[2] * frontOffset)
  ]
}

export function getMajoranaIntroLightLayout({
  center = [0, 0, 0],
  modelWidth = 1,
  modelHeight = 1,
  viewDirection = [0, 0, 1]
} = {}) {
  const safeCenter = center.length === 3 && center.every(Number.isFinite)
    ? center
    : [0, 0, 0]
  const safeWidth = Number.isFinite(modelWidth) && modelWidth > 0 ? modelWidth : 1
  const safeHeight = Number.isFinite(modelHeight) && modelHeight > 0 ? modelHeight : 1
  const front = normalize(viewDirection, [0, 0, 1])
  const horizontalFront = normalize([front[0], 0, front[2]], [0, 0, 1])
  // World up × view gives screen-right while keeping the light rig roll-free.
  const right = normalize([front[2], 0, -front[0]], [1, 0, 0])

  return MAJORANA_INTRO_LIGHTING.lights.map(light => {
    const tuning = light.tuning
    return {
      ...light,
      width: (tuning?.widthByModelWidth ?? light.widthByModelWidth) * safeWidth,
      height: (tuning?.heightByModelHeight ?? light.heightByModelHeight) * safeHeight,
      position: tuning
        ? tunedPosition(safeCenter, horizontalFront, right, safeHeight, tuning)
        : offsetPoint(
            safeCenter,
            front,
            right,
            safeWidth,
            safeHeight,
            light.position
          ),
      target: tuning
        ? tunedTarget(safeCenter, horizontalFront, right, safeWidth, safeHeight, tuning)
        : offsetPoint(
            safeCenter,
            front,
            right,
            safeWidth,
            safeHeight,
            light.target
          ),
      rollDegrees: tuning?.rollDegrees ?? 0
    }
  })
}
