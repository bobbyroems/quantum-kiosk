export function createCarouselSpring(size) {
  const stiffness = 46 + (size % 7) * 7
  return {
    offset: 0,
    velocity: 0,
    stiffness,
    damping: 2 * Math.sqrt(stiffness) * 0.42,
    response: Math.max(0.4, 1.35 - Math.min(size, 30) / 30)
  }
}

export function advanceCarouselSpring(spring, drive, deltaSeconds) {
  const target = -drive * 0.3 * spring.response
  const acceleration =
    -spring.stiffness * (spring.offset - target) -
    spring.damping * spring.velocity
  spring.velocity += acceleration * deltaSeconds
  spring.offset += spring.velocity * deltaSeconds
  return spring.offset
}
