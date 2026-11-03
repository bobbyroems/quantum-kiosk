/* Ink and glow share geometry and entrance timing. The glow's mask animates
   its own blurred strokes; its backdrop-filter element remains a direct child
   of the stage so the adaptive colour still comes from the video. */
export const CALLOUT_GEOMETRY = {
  measurement: {
    width: 2160, height: 3840,
    top: [928, 1516, 14], stem: 'M928 1516V1616',
    branches: ['M928 1616H718V1786', 'M928 1616H1138V1786'],
    bottoms: [[718, 1786, 13.5], [1138, 1786, 13.5]],
    glow: { x: 662, y: 1460, width: 532, height: 382 }
  },
  /* The right branch runs the width of the device and drops to a second
     location, rather than mirroring the left one — the point of the frame is
     that the information sits in separate parts of the device. Everything above
     the split is unchanged, so the label and its stem do not move. The box has
     to grow with the route: it turns down at x 770, so the box runs to 770 +
     the dot's 13.333 across and 541.333 + the same down. This one carries no
     glow entry: over the device's dense green grid the adaptive halo read as a
     smear behind the line rather than as light, so only the ink is drawn. */
  protected: {
    width: 784, height: 555,
    top: [174.351, 13.9861, 13.9861], stem: 'M174.351 13.9861V148.986',
    branches: ['M174.351 148.894H12.7866L13.3333 208.463', 'M174.351 148.894H770V541.333'],
    bottoms: [[13.3333, 208.463, 13.3333], [770, 541.333, 13.3333]]
  }
}

export function calloutGlowMask({ id, top, stem, branches, bottoms, glow }) {
  const { x, y, width, height } = glow
  const line = (d, part) => `<path data-reveal-part="${part}" d="${d}"
    pathLength="1" stroke-dasharray="1" stroke-dashoffset="0"/>`
  const lines = line(stem, 'stem') + branches.map(d => line(d, 'branch')).join('')
  const dot = ([cx, cy, radius], part) => `<circle class="mbqc__reveal-dot"
    data-reveal-part="${part}" cx="${cx}" cy="${cy}" r="${radius + 2}"/>`
  const layer = (name, blur, opacity, strokeWidth, dots = '') => `
    <filter id="${id}-${name}" x="0" y="0" width="${width}" height="${height}" filterUnits="userSpaceOnUse">
      <feGaussianBlur stdDeviation="${blur}"/>
    </filter>
    <g filter="url(#${id}-${name})" opacity="${opacity}">
      <g transform="translate(${-x} ${-y})">
        <g fill="none" stroke="#fff" stroke-width="${strokeWidth}" stroke-linejoin="round">${lines}</g>
        ${dots}
      </g>
    </g>`

  // Blur AFTER drawing the partial paths, giving the advancing tip a soft
  // falloff instead of slicing the finished halo with a hard clipping edge.
  return `<mask id="${id}" class="mbqc__glow-mask" maskUnits="userSpaceOnUse"
    maskContentUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">
    ${layer('outer', 14, 0.28, 19)}
    ${layer('inner', 4, 0.8, 11, `<g fill="#fff" opacity="0.5">${dot(top, 'top')}${bottoms.map(point => dot(point, 'bottom')).join('')}</g>`)}
  </mask>`
}

export function calloutRevealMask({ id, width, height, top, stem, branches, bottoms }) {
  const dot = ([x, y, radius], part) => `
    <circle class="mbqc__reveal-dot" data-reveal-part="${part}"
      cx="${x}" cy="${y}" r="${radius + 1}" fill="#fff"/>`
  const line = (d, part) => `
    <path data-reveal-part="${part}" d="${d}" fill="none" stroke="#fff"
      stroke-width="10" pathLength="1" stroke-dasharray="1" stroke-dashoffset="0"/>`

  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">
    ${dot(top, 'top')}
    ${line(stem, 'stem')}
    ${branches.map(d => line(d, 'branch')).join('')}
    ${bottoms.map(point => dot(point, 'bottom')).join('')}
  </mask>`
}

export function mountCalloutEntrances(root, { signal } = {}) {
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  const callouts = [
    {
      masks: root.querySelectorAll('#mbqc-measurement-reveal, #mbqc-measurement-glow'),
      selector: '[data-step="measurement-pair"][data-phase="stable"]'
    },
    {
      masks: root.querySelectorAll('#mbqc-protected-reveal'),
      selector: '[data-phase="transition"][data-transition="information-cloud"], '
        + '[data-step="protected-information"]:not([data-phase="loading"]):not([data-phase="preparing"])'
    }
  ].map(callout => ({ ...callout, visible: false, animations: [] }))

  function cancel(callout) {
    callout.animations.forEach(animation => animation.cancel())
    callout.animations = []
  }

  function reveal(callout) {
    cancel(callout)
    if (motionPreference.matches) return

    const parts = [...callout.masks].flatMap(mask => [...mask.querySelectorAll('[data-reveal-part]')])
    for (const part of parts) {
      const kind = part.dataset.revealPart
      const isDot = kind === 'top' || kind === 'bottom'
      const timing = {
        top: { duration: 160, delay: 0 },
        stem: { duration: 160, delay: 120 },
        branch: { duration: 220, delay: 280 },
        bottom: { duration: 160, delay: 500 }
      }[kind]
      callout.animations.push(part.animate(
        isDot
          ? [{ opacity: 0, transform: 'scale(0.55)' }, { opacity: 1, transform: 'scale(1)' }]
          : [{ strokeDashoffset: '1' }, { strokeDashoffset: '0' }],
        { ...timing, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'both' }
      ))
    }
  }

  function sync() {
    for (const callout of callouts) {
      const visible = root.matches(callout.selector)
      if (visible === callout.visible) continue
      callout.visible = visible
      if (visible) reveal(callout)
      // Freeze even a partial entrance during the wrapper's exit fade. Reset
      // only on re-entry, never while the outgoing artwork is still visible.
      else callout.animations.forEach(animation => animation.pause())
    }
  }

  // Batch the story's phase/step updates so the protected callout does not
  // replay when its build clip settles into the continuously visible loop.
  const observer = new MutationObserver(sync)
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['data-phase', 'data-step', 'data-transition']
  })
  motionPreference.addEventListener('change', () => {
    if (motionPreference.matches) callouts.forEach(cancel)
  }, { signal })
  signal?.addEventListener('abort', () => {
    observer.disconnect()
    callouts.forEach(cancel)
  }, { once: true })
  sync()
}
