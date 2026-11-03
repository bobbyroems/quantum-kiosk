/**
 * The teal band that runs directly under a module's header (Figma "Module
 * Specific", 255:1719 / 255:3888).
 *
 * It has two states and is one element, because the board draws it as one:
 *
 *   direction  — where the visitor is now: "2: A new state of matter".
 *   up next    — where they can go, once the module is finished.
 *
 * The band is the same surface in both, so it changes rather than being
 * replaced; the offer grows out of the statement instead of arriving over it.
 * Figma models this with the chip and the chevron as hidden layers on the
 * direction bar, which is what the two states here are.
 *
 * If the offer goes untaken the band escalates to the popup — see
 * up-next-popup.js for why there is a third beat at all.
 *
 * The band never decides what comes next. A module hands it a title and what to
 * do, so the same component serves whatever the registry says follows.
 *
 * Inside a module's own sub-modules the band carries the 1-2-3 control instead
 * of a title — the board annotates 255:1719 with exactly that ("Module title in
 * banner on this screen, but within the sub-module use the pagination
 * component"), which is what `mountPagination` is for.
 */

/* Long enough that the band does not talk over whatever the module does to
   celebrate finishing, short enough that someone who is done is not left
   looking at a finished screen wondering what happens now. Modules that want
   the offer the instant they finish pass delayMs: 0. */
export const UP_NEXT_BANNER_DELAY_MS = 1500

/* The chevron the offer carries, on currentColor so the label's ink drives it
   rather than a fill baked into the file.

   Drawn here rather than reused from the popup because the two sit differently:
   the popup's rides a disc, which hides how the shape sits in its box, while
   this one stands beside a word and has to look centred on it. The box is cut
   tight to the stroke and the stroke is centred in the box, so "beside the
   word" is a flex gap and nothing else — no padding standing in for the empty
   corners of a square viewBox. Round joins to match the type's weight. */
const CHEVRON_ICON = `
  <svg class="kiosk-continue-action__glyph" viewBox="0 0 12 20" aria-hidden="true" focusable="false">
    <path
      d="M2 2 L10 10 L2 18"
      fill="none"
      stroke="currentColor"
      stroke-width="2.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
`

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character])
}

/* The offer is a button and the statement is not, so they are two elements
   rather than one that changes role. A div that becomes a button mid-visit is
   the kind of thing that reads fine and announces badly. */
function bandMarkup(label) {
  return `
    <div class="kiosk-module-band" data-state="direction" data-kiosk-chrome>
      <p class="kiosk-module-band__where" data-band-where>${escapeHtml(label)}</p>

      <div class="kiosk-module-band__pagination" data-band-pagination hidden></div>

      <button class="kiosk-module-band__offer" type="button" data-band-offer hidden>
        <span class="kiosk-module-band__label">
          <span class="kiosk-module-band__chip" data-band-chip>Up next</span>
          <span class="kiosk-module-band__title" data-band-title></span>
        </span>
        <span class="kiosk-continue-action">
          <span class="kiosk-continue-action__label" data-band-action-label>Continue</span>
          <span class="kiosk-continue-action__arrow" aria-hidden="true">${CHEVRON_ICON}</span>
        </span>
      </button>
    </div>
  `
}

/**
 * @param {object} options
 * @param {string} [options.label] What the band states first, e.g. "2: A new
 *   state of matter". Omit when the band opens carrying a pagination control.
 */
export function createModuleBand({ label = '' } = {}) {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = bandMarkup(label).trim()
  const element = wrapper.firstElementChild

  const whereNode = element.querySelector('[data-band-where]')
  const paginationSlot = element.querySelector('[data-band-pagination]')
  const offerNode = element.querySelector('[data-band-offer]')
  const titleNode = element.querySelector('[data-band-title]')
  const chipNode = element.querySelector('[data-band-chip]')
  const actionLabelNode = element.querySelector('[data-band-action-label]')

  let revealTimer = null
  let disposed = false
  let onContinue = null
  let onEscalate = null
  let escalateTimer = null
  /* Tracked rather than read back off the slot's `hidden`: showing the offer
     hides the slot, so the slot cannot also be the record of whether anything
     is in it — withdrawing would then restore the title over a game that is
     still running its three principles. */
  let hasPagination = false

  offerNode.addEventListener('click', () => {
    if (disposed) return
    /* Taking the offer cancels the popup: the visitor has answered the question
       the popup exists to ask. */
    cancelEscalation()
    onContinue?.()
  })

  function cancelEscalation() {
    if (escalateTimer !== null) window.clearTimeout(escalateTimer)
    escalateTimer = null
  }

  /* The bar keeps its position and size — it is already on screen and simply
     says something else. The one moving part is the chevron, which nudges a few
     times towards where it is pointing. */
  function showOffer() {
    element.dataset.state = 'up-next'
    whereNode.hidden = true
    paginationSlot.hidden = true
    offerNode.hidden = false
  }

  return {
    element,

    /** Restates where the visitor is, without leaving the direction state. */
    setLabel(next) {
      whereNode.textContent = next
    },

    /**
     * Puts a control — the 1-2-3 — in the band instead of a title, for the
     * stretch of a module that runs as sub-modules.
     */
    mountPagination(node) {
      hasPagination = true
      paginationSlot.replaceChildren(node)
      /* Not while an offer is standing: the module finished, and the offer is
         what the band is for until it is withdrawn. */
      if (offerNode.hidden) {
        paginationSlot.hidden = false
        whereNode.hidden = true
        element.dataset.state = 'pagination'
      }
    },

    /** Returns the band to stating the module title. */
    clearPagination() {
      hasPagination = false
      paginationSlot.replaceChildren()
      paginationSlot.hidden = true
      if (offerNode.hidden) {
        whereNode.hidden = false
        element.dataset.state = 'direction'
      }
    },

    /**
     * Turns the band into the offer for what comes next, then — if the offer
     * goes untaken — escalates to the popup.
     *
     * @param {object} options
     * @param {string} options.title Name of the module being offered.
     * @param {string} [options.chip] The line above it. "All modules complete"
     *   at the end of the run, where the offer is the way home.
     * @param {string} [options.actionLabel] Visible action and accessible-name
     *   prefix, e.g. "Go home" when the run is complete.
     * @param {() => void} options.onContinue Run when the visitor takes it.
     * @param {() => void} [options.onEscalate] Run once the offer has stood
     *   unanswered for `escalateMs`.
     * @param {number} [options.delayMs] Wait before the offer appears.
     * @param {number} [options.escalateMs] Wait before escalating.
     */
    offerNext({
      title,
      chip = 'Up next',
      actionLabel = 'Continue',
      onContinue: continueHandler,
      onEscalate: escalateHandler,
      delayMs = UP_NEXT_BANNER_DELAY_MS,
      escalateMs
    }) {
      if (disposed || revealTimer !== null || !offerNode.hidden) return
      onContinue = continueHandler
      onEscalate = escalateHandler
      titleNode.textContent = title
      chipNode.textContent = chip
      actionLabelNode.textContent = actionLabel
      offerNode.setAttribute('aria-label', `${actionLabel} — ${chip}: ${title}`)

      revealTimer = window.setTimeout(() => {
        revealTimer = null
        if (disposed || !element.isConnected) return
        showOffer()
        if (!onEscalate || escalateMs === undefined) return
        escalateTimer = window.setTimeout(() => {
          escalateTimer = null
          if (!disposed && element.isConnected) onEscalate()
        }, escalateMs)
      }, delayMs)
    },

    /** Takes the offer back down and returns the band to its statement. */
    withdrawOffer() {
      if (revealTimer !== null) window.clearTimeout(revealTimer)
      revealTimer = null
      cancelEscalation()
      offerNode.hidden = true
      paginationSlot.hidden = !hasPagination
      whereNode.hidden = hasPagination
      element.dataset.state = hasPagination ? 'pagination' : 'direction'
    },

    /** Stops the popup without taking the offer down — the visitor said no. */
    cancelEscalation,

    dispose() {
      disposed = true
      if (revealTimer !== null) window.clearTimeout(revealTimer)
      revealTimer = null
      cancelEscalation()
      element.remove()
    }
  }
}
