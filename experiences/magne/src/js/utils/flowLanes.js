(() => {
  const getFlowLanes = ({
    width,
    height,
    laneCount = 6,
    barHeightRatio = 260 / 1080,
    barYOffsetRatio = 0,
    paddingRatio = 0.27
  } = {}) => {
    if (!width || !height || laneCount <= 0) {
      return { laneYs: [], laneRatios: [], barHeight: 0, barCenterY: 0 }
    }

    const barHeight = width * barHeightRatio
    const barCenterY = height * (0.403 + barYOffsetRatio)
    const padding = barHeight * paddingRatio
    const laneSpacing = laneCount > 1 ? (barHeight - padding * 2) / (laneCount - 1) : 0
    const laneYs = Array.from({ length: laneCount }, (_val, index) => (
      barCenterY - barHeight * 0.5 + padding + index * laneSpacing
    ))
    const laneRatios = laneYs.map(y => y / height)

    return { laneYs, laneRatios, barHeight, barCenterY }
  }

  window.FlowLanes = {
    getFlowLanes
  }
})()
