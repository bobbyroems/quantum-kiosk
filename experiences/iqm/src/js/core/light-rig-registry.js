/* Live scenes register their light rigs here so the dev material panel can
   offer per-light controls for whichever module is on screen. Registration
   is a cheap Map write and always on; only the dev panel ever reads it. */

const rigs = new Map()
let version = 0

/**
 * @param {string} id - unique rig name, shown as the panel section title
 * @param {Array<{ name: string, light: object }>} lights - named three.js lights
 * @param {() => void} [onChange] - called after a light is edited, for
 *   scenes that render on demand and need an invalidation poke
 * @param {{ label?: string, controls?: Array<object>, showDefaultLightControls?: boolean }}
 *   [options] - optional dev-panel metadata; existing light-only rigs need no changes
 * @returns {() => void} unregister
 */
export function registerLightRig(id, lights, onChange, options = {}) {
  const rig = {
    id,
    lights,
    onChange,
    label: options.label || id,
    controls: Array.isArray(options.controls) ? options.controls : [],
    showDefaultLightControls: options.showDefaultLightControls !== false
  }
  rigs.set(id, rig)
  version += 1
  const unregister = () => {
    if (rigs.get(id) === rig) {
      rigs.delete(id)
      version += 1
    }
  }
  unregister.update = (nextOptions = {}) => {
    if (rigs.get(id) !== rig) return
    if ('label' in nextOptions) rig.label = nextOptions.label || id
    if ('controls' in nextOptions) {
      rig.controls = Array.isArray(nextOptions.controls) ? nextOptions.controls : []
    }
    if ('showDefaultLightControls' in nextOptions) {
      rig.showDefaultLightControls = nextOptions.showDefaultLightControls !== false
    }
    version += 1
  }
  return unregister
}

export function getLightRigs() {
  return [...rigs.values()]
}

/* Monotonic counter; the panel polls it to know when to re-render. */
export function lightRigsVersion() {
  return version
}
