/**
 * Alignment controls for sitting the three.js particles on the device in the
 * video.
 *
 * The board wants the particle passes and the magnetic arcs kept in three.js
 * and composited over the video device. That only reads correctly if the two
 * agree about where the device is in space, and the video was rendered
 * elsewhere — so the match has to be found by eye rather than derived. This is
 * the panel for finding it.
 *
 * It is deliberately not part of the module: it mounts only when asked for by
 * query string, attaches to the document rather than the kiosk stage so it is
 * not scaled with it, and its whole output is a block of numbers to paste back
 * into the scene's authored constants. Nothing here should ship enabled.
 *
 *   ?debug=camera
 */

/* Suffixed because a stored set is a delta on the authored view, and baking one
   of those deltas into that view changes what the rest are relative to: a stored
   distance of 1.328 would multiply the 1.328 now baked in.
   
   Only distance moved, though, so the other knobs are still meaningful and a
   session's tuning is not something to throw away over one of them. The old key
   is migrated rather than abandoned — see readStored. */
const STORAGE_KEY = 'pqi-camera-alignment-v2'
const LEGACY_STORAGE_KEY = 'pqi-camera-alignment'

/* label, key, min, max, step, and the value the knob rests at. Angles are
   radians — the panel shows degrees for those, because nobody eyeballs radians.
   `initial` lives here rather than in a separate defaults table so that adding a
   knob cannot leave Reset behind, which is exactly how Pan Z would have been
   missed. */
const CONTROLS = Object.freeze([
  Object.freeze({ key: 'yaw', label: 'Camera yaw', min: -1.6, max: 1.6, step: 0.002, initial: 0, degrees: true }),
  Object.freeze({ key: 'pitch', label: 'Camera pitch', min: -0.9, max: 0.9, step: 0.002, initial: 0, degrees: true }),
  Object.freeze({ key: 'deviceYaw', label: 'Device yaw', min: -1.6, max: 1.6, step: 0.002, initial: 0, degrees: true }),
  Object.freeze({ key: 'distance', label: 'Distance', min: 0.4, max: 2.2, step: 0.002, initial: 1 }),
  Object.freeze({ key: 'fov', label: 'Field of view', min: 0.4, max: 1.8, step: 0.002, initial: 1 }),
  Object.freeze({ key: 'panX', label: 'Pan X', min: -5, max: 5, step: 0.01, initial: 0 }),
  Object.freeze({ key: 'panY', label: 'Pan Y', min: -5, max: 5, step: 0.01, initial: 0 }),
  Object.freeze({ key: 'panZ', label: 'Pan Z', min: -5, max: 5, step: 0.01, initial: 0 })
])

const IDENTITY = Object.freeze(
  Object.fromEntries(CONTROLS.map(control => [control.key, control.initial]))
)

export function cameraDebugRequested(search = window.location.search) {
  return new URLSearchParams(search).get('debug') === 'camera'
}

function readStored() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (stored && typeof stored === 'object') return stored

    /* Carried over from before distance was baked in. Every other knob still
       means what it meant, so only distance returns to identity. */
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY))
    if (legacy && typeof legacy === 'object') {
      console.info('[pqi] carried your alignment over; distance reset, it is now in the authored view')
      return { ...legacy, distance: 1 }
    }
    return null
  } catch {
    return null
  }
}

function store(values) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(values))
  } catch {
    /* Private windows and cleared site data are not a reason to stop tuning. */
  }
}

/**
 * @param {object} options
 * @param {object} options.scene scene controller, for get/setCameraAlignment
 * @param {(opacity: number) => void} [options.onVideoOpacity] fades the video
 *   stack so both treatments can be seen at once while matching them
 * @returns {{ dispose: () => void }}
 */
export function mountCameraDebugPanel({ scene, onVideoOpacity } = {}) {
  if (!scene?.setCameraAlignment) {
    return { dispose() {} }
  }

  const panel = document.createElement('div')
  panel.className = 'pqi-camera-debug'
  panel.innerHTML = `
    <header>
      <strong>Particle alignment</strong>
      <button type="button" data-action="collapse" title="Collapse">–</button>
    </header>
    <div data-role="body"></div>
    <footer>
      <button type="button" data-action="reset">Reset</button>
      <button type="button" data-action="copy">Copy values</button>
    </footer>
    <pre data-role="output"></pre>
  `

  const body = panel.querySelector('[data-role="body"]')
  const output = panel.querySelector('[data-role="output"]')
  const inputs = new Map()

  /* Restored from the last session, because alignment is done over several
     sittings and losing the match to a page reload is its own small tragedy. */
  const stored = readStored()
  if (stored) scene.setCameraAlignment(stored)

  const render = () => {
    const values = scene.getCameraAlignment()
    for (const [key, input] of inputs) {
      const control = CONTROLS.find(entry => entry.key === key)
      input.range.value = String(values[key])
      input.readout.textContent = control.degrees
        ? `${((values[key] * 180) / Math.PI).toFixed(1)}°`
        : values[key].toFixed(3)
    }
    output.textContent = Object.entries(values)
      .map(([key, value]) => `  ${key}: ${Number(value.toFixed(4))}`)
      .join(',\n')
    store(values)
  }

  for (const control of CONTROLS) {
    const row = document.createElement('label')
    row.className = 'pqi-camera-debug__row'
    row.innerHTML = `
      <span class="pqi-camera-debug__label">${control.label}</span>
      <input type="range" min="${control.min}" max="${control.max}" step="${control.step}">
      <output class="pqi-camera-debug__value"></output>
    `
    const range = row.querySelector('input')
    range.addEventListener('input', () => {
      scene.setCameraAlignment({ [control.key]: Number(range.value) })
      render()
    })
    inputs.set(control.key, { range, readout: row.querySelector('output') })
    body.append(row)
  }

  /* The alignment that actually matters is between two devices, not between
     particles and a device — particles are sparse and drift, and there is
     little in them to line up by eye. Bringing the three.js device back in full
     colour gives two of the same object to superimpose, which together with the
     opacity fader below is the whole matching workflow: show the device, fade
     the video until both read at once, tune until they coincide, hide it again.

     Not persisted, unlike the alignment itself. It is a thing you hold down
     while looking, not a state to come back to. */
  if (scene.setOverlayMode) {
    const row = document.createElement('label')
    row.className = 'pqi-camera-debug__toggle'
    row.innerHTML = `
      <input type="checkbox">
      <span>Show 3D device (for matching)</span>
    `
    const checkbox = row.querySelector('input')
    checkbox.addEventListener('change', () => {
      scene.setOverlayMode(!checkbox.checked)
    })
    body.append(row)
  }

  if (onVideoOpacity) {
    const row = document.createElement('label')
    row.className = 'pqi-camera-debug__row'
    row.innerHTML = `
      <span class="pqi-camera-debug__label">Video opacity</span>
      <input type="range" min="0" max="1" step="0.01" value="1">
      <output class="pqi-camera-debug__value">1.00</output>
    `
    const range = row.querySelector('input')
    const readout = row.querySelector('output')
    range.addEventListener('input', () => {
      const value = Number(range.value)
      readout.textContent = value.toFixed(2)
      onVideoOpacity(value)
    })
    body.append(row)
  }

  const onClick = event => {
    const action = event.target.closest('button')?.dataset.action
    if (action === 'reset') {
      scene.setCameraAlignment({ ...IDENTITY })
      render()
    } else if (action === 'copy') {
      navigator.clipboard?.writeText(output.textContent ?? '')
      const button = event.target.closest('button')
      button.textContent = 'Copied'
      setTimeout(() => { button.textContent = 'Copy values' }, 1200)
    } else if (action === 'collapse') {
      panel.classList.toggle('pqi-camera-debug--collapsed')
    }
  }
  panel.addEventListener('click', onClick)

  /* On the document rather than inside the kiosk stage: the stage is scaled to
     fit the screen, and a panel scaled with it is unusable. */
  document.body.append(panel)
  render()

  return {
    dispose() {
      panel.removeEventListener('click', onClick)
      panel.remove()
    }
  }
}
