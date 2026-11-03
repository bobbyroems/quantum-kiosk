const clamp01 = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))

function safeDimension(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export function getPathwayPulsePoint(
  pathwayId,
  progress,
  dimensions,
  absorptionProgress = 0,
  emissionProgress = 1
) {
  const width = safeDimension(dimensions?.width)
  const height = safeDimension(dimensions?.height)
  const travel = clamp01(progress)
  const absorption = clamp01(absorptionProgress)
  const emission = clamp01(emissionProgress)

  if (pathwayId === 'external') {
    return {
      x: width * 0.5,
      y: (height * travel) + (80 * absorption)
    }
  }

  if (pathwayId === 'control') {
    const baseX = width * (1 - travel)
    return {
      x: absorption > 0
        ? baseX - (72 * absorption)
        : baseX + (72 * (1 - emission)),
      y: height * 0.5
    }
  }

  return {
    x: width * 0.5,
    y: (height * (1 - travel)) + (80 * (1 - emission))
  }
}
