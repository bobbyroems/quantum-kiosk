const DUPLICATE_CHASSIS_NODE = 'Chassis_LowPoly'

// The GLB contains two closed chassis meshes with the same bounds, surface
// area and volume. Most faces are exactly coplanar, so drawing both causes
// depth competition that reads as crawling lines on the kiosk display. Keep
// the denser Chassis_LowPoly_1 layer and suppress the redundant sparse copy.
export function hideDuplicateMajoranaChassis(modelRoot) {
  let hiddenCount = 0

  modelRoot?.traverse?.(object => {
    if (object?.name !== DUPLICATE_CHASSIS_NODE) return
    object.visible = false
    hiddenCount += 1
  })

  return hiddenCount
}
