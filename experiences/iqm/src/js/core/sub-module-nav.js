/**
 * The 1-2-3 control that shows where a visitor is inside a module's set of
 * sub-modules (Figma "Sub-Module Navigation Menu" 255:3555 on the band, and
 * "Container" 255:3786 on the sub-menu screen).
 *
 * There were two of these before — module 01 drew one as a blue-on-light rail
 * inside its transition cover and another, unlabelled, on its sub-menu — and
 * neither matched what the 27 Aug board draws. This is the only one now, and
 * every call site comes here.
 *
 * The two places it appears differ in ink, whether the labels show, and how far
 * apart the circles sit; everything else is the same drawing. So they are one
 * component with a `tone`, rather than two components that will drift.
 *
 * A step is in one of three states, and 255:4301 draws one of each:
 *
 *   done      a white disc carrying a checkmark — they have been through it
 *   current   a white disc with a ring, carrying its number
 *   upcoming  a translucent disc, carrying its number
 *
 * The connector behind a done step is solid, and dashed while it is not, which
 * is what makes the travelled part of the route read as travelled.
 */

/* Figma 255:1830, inlined on currentColor: the disc it sits in is white in both
   tones, and the tick takes the tone's ink. */
const CHECK_ICON = `
  <svg class="kiosk-submodule-nav__check" viewBox="0 0 60 60" aria-hidden="true" focusable="false">
    <path d="M50.3958 15.8692C51.1239 16.6055 51.1172 17.7927 50.3808 18.5208L22.5683 46.0208C21.842 46.7389 20.6745 46.7436 19.9425 46.0314L8.37996 34.7814C7.63777 34.0592 7.62151 32.8722 8.34364 32.13C9.06577 31.3878 10.2528 31.3715 10.995 32.0936L21.2394 42.0612L47.7442 15.8542C48.4805 15.1261 49.6677 15.1328 50.3958 15.8692Z" fill="currentColor"/>
  </svg>
`

function stepMarkup(step, index, showLabels) {
  const label = showLabels
    ? `<span class="kiosk-submodule-nav__label">${step.label}</span>`
    : ''
  return `
    <li class="kiosk-submodule-nav__step" data-state="upcoming" data-locked="false">
      <span class="kiosk-submodule-nav__index">
        <span class="kiosk-submodule-nav__number">${index + 1}</span>
        ${CHECK_ICON}
      </span>
      ${label}
    </li>
  `
}

function navMarkup(steps, { showLabels, tone, ariaLabel }) {
  /* A connector between each pair rather than one rail behind everything: the
     gap is a fixed distance in the design, so the connector can simply be the
     gap and the circles never sit on top of a line. */
  const items = steps
    .map((step, index) => stepMarkup(step, index, showLabels))
    .join('<li class="kiosk-submodule-nav__rail" data-travelled="false" aria-hidden="true"></li>')

  return `
    <nav
      class="kiosk-submodule-nav"
      data-tone="${tone}"
      data-labels="${showLabels}"
      aria-label="${ariaLabel}"
    >
      <ol class="kiosk-submodule-nav__track">${items}</ol>
    </nav>
  `
}

/**
 * @param {object} options
 * @param {{ id: string, label: string }[]} options.steps In route order.
 * @param {string|null} [options.current] Id of the step the visitor is on, or
 *   null when they are on none — every step finished, or the module's own menu
 *   rather than one of its sub-modules.
 * @param {Iterable<string>} [options.completed] Ids they have been through.
 * @param {Iterable<string>} [options.unlocked] Ids they may open. Defaults to
 *   everything up to and including the one after `current`, which is the state
 *   the board draws: the step just ahead reads at full strength and only what
 *   is locked behind it fades.
 * @param {'on-band'|'on-light'} [options.tone] Which surface it sits on.
 * @param {boolean} [options.showLabels] The sub-menu draws circles only.
 * @param {string} [options.ariaLabel]
 */
export function createSubModuleNav({
  steps,
  current = null,
  completed,
  unlocked,
  tone = 'on-band',
  showLabels = true,
  ariaLabel = 'Progress through this module'
}) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new TypeError('createSubModuleNav needs at least one step.')
  }

  const wrapper = document.createElement('div')
  wrapper.innerHTML = navMarkup(steps, { showLabels, tone, ariaLabel }).trim()
  const element = wrapper.firstElementChild
  const stepNodes = [...element.querySelectorAll('.kiosk-submodule-nav__step')]
  const railNodes = [...element.querySelectorAll('.kiosk-submodule-nav__rail')]

  /**
   * @param {string|null} stepId
   * @param {{ completed?: Iterable<string>, unlocked?: Iterable<string> }} [next]
   */
  function setCurrent(stepId, next = {}) {
    const activeIndex = steps.findIndex(step => step.id === stepId)
    const done = new Set(next.completed ?? completed ?? [])
    const nextUnlocked = next.unlocked ?? unlocked
    const reachable = nextUnlocked
      ? new Set(nextUnlocked)
      : new Set(steps.slice(0, Math.max(activeIndex, 0) + 2).map(step => step.id))

    stepNodes.forEach((node, index) => {
      const id = steps[index].id
      /* Finished outranks current: replaying something they have already been
         through should still read as a step they have completed. */
      const state = done.has(id)
        ? 'done'
        : index === activeIndex ? 'current' : 'upcoming'
      node.dataset.state = state
      /* Only what they cannot open yet fades. */
      node.dataset.locked = String(state === 'upcoming' && !reachable.has(id))
      node.setAttribute('aria-current', index === activeIndex ? 'step' : 'false')
    })

    /* The rail leaving a step is travelled once that step is done. */
    railNodes.forEach((rail, index) => {
      rail.dataset.travelled = String(done.has(steps[index].id))
    })
  }

  setCurrent(current)

  return {
    element,
    setCurrent,
    dispose() {
      element.remove()
    }
  }
}
