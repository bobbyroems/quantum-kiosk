const BLUE = '#1f9bff'
const PURPLE = '#9567ff'

/*
 * New-style nav previews: one sphere centred in the visual, tinted by the
 * module's category. x/y: shape centre in % of the scene box. s: width in %
 * of scene width. drift: float travel in px.
 */
const SPHERE = { type: 'sphere', x: 50, y: 48, s: 36, drift: 16 }
const SCENES = {
  'quantum-vs-classical': [{ ...SPHERE, color: PURPLE, dur: 6.4 }],
  nanoscale: [{ ...SPHERE, color: BLUE, dur: 5.6 }],
  'qubit-explorer': [{
    ...SPHERE,
    type: 'topoconductor',
    color: BLUE,
    s: 40,
    y: 46,
    dur: 9.6,
    drift: 0
  }],
  'states-of-matter': [{ ...SPHERE, color: PURPLE, dur: 5.2 }],
  'protecting-information': [{ ...SPHERE, color: BLUE, dur: 6.2 }],
  'build-nanowire': [{ ...SPHERE, color: BLUE, dur: 7 }],
  'build-majorana-2': [{ ...SPHERE, color: PURPLE, dur: 5.8 }],
  'quantum-platform': [{ ...SPHERE, color: BLUE, dur: 6.6 }]
}

const DEFAULT_ASPECT = {
  sphere: 1,
  topoconductor: 1.8
}

export function buildShapeScene(host, moduleId, accent) {
  const shapes = SCENES[moduleId]
  if (!host || !shapes) return false

  const scene = document.createElement('span')
  scene.className = 'module-card__shape-scene'
  scene.setAttribute('aria-hidden', 'true')
  scene.style.setProperty('--scene-tint', accent || BLUE)

  for (const shape of shapes) {
    const element = document.createElement('i')
    element.className = `ss ss--${shape.type}`
    element.style.left = `${shape.x}%`
    element.style.top = `${shape.y}%`
    element.style.width = `${shape.s}%`
    element.style.aspectRatio = String(shape.aspect ?? DEFAULT_ASPECT[shape.type] ?? 1)
    element.style.setProperty('--ss-color', shape.color)
    element.style.setProperty('--ss-drift', `${shape.drift ?? 14}px`)
    element.style.setProperty('--ss-dur', `${shape.dur ?? 6}s`)
    element.style.setProperty('--ss-delay', `${-(shape.delay ?? 0)}s`)
    scene.append(element)
  }

  host.append(scene)
  return true
}
