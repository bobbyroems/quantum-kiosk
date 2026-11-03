/**
 * The popup a finished module raises once its band has been offering the next
 * module for a while (Figma "Module Specific", pop-up 255:1843 + overlay
 * 255:1842).
 *
 * It is the last of three beats and the only one that interrupts. The band
 * states where the visitor is; when the module finishes the band turns into an
 * offer; if the offer goes untaken the popup asks directly. IQM asked for the
 * third beat explicitly — on the floor people finished a module and stood
 * looking at a finished screen — so it is deliberately unmissable rather than
 * quiet.
 *
 * Module 01 carried a card like this between its own three games. That card is
 * this component now: same anatomy, restated on the 27 Aug board with the
 * restart row underneath and the teal band the rest of the floor uses.
 */

import { assetUrl } from './asset-url.js'

/* How long the offer stands on the band before the popup asks outright. The
   band is the polite version and gets first go; five seconds is what the board
   specifies and roughly how long someone takes to decide they are finished. */
export const UP_NEXT_POPUP_DELAY_MS = 5000

/* Long enough for the scrim to clear before the node is pulled, so a visitor
   who dismisses does not watch the panel disappear mid-fade. */
const EXIT_FALLBACK_MS = 320

/* How far a press on the scrim may wander and still count as a tap, in stage
   pixels. Generous enough to forgive the drift in a real finger press on a 4K
   panel, far below the hundreds of pixels a swipe covers. */
const SCRIM_DISMISS_TRAVEL_LIMIT = 24

/* All three glyphs already exist in public/assets/ui as the same shapes with a
   fill baked in (#2A446F), and this panel needs them in three different inks —
   half-white on the photograph, white on the teal, dark teal on the mint. They
   are inlined on currentColor instead, which is what the band already does with
   its chevron for the same reason. */
const CLOSE_ICON = `
  <svg class="kiosk-up-next-popup__glyph" viewBox="0 0 70 70" aria-hidden="true" focusable="false">
    <path d="M12.2874 12.7959L12.5301 12.5211C13.5815 11.4697 15.2359 11.3888 16.3801 12.2784L16.6548 12.5211L35.0091 30.8731L53.3634 12.5211C54.5024 11.3821 56.3492 11.3821 57.4882 12.5211C58.6272 13.6601 58.6272 15.5069 57.4882 16.6459L39.1339 34.9979L57.4882 53.3499C58.6272 54.4889 58.6272 56.3357 57.4882 57.4747C56.3492 58.6137 54.5024 58.6137 53.3634 57.4747L35.0091 39.1227L16.6548 57.4747C15.5158 58.6137 13.669 58.6137 12.53 57.4747C11.391 56.3357 11.391 54.4889 12.53 53.3499L30.8843 34.9979L12.53 16.6459C11.4786 15.5945 11.3977 13.9401 12.2874 12.7959Z" fill="currentColor"/>
  </svg>
`

const CHEVRON_ICON = `
  <svg class="kiosk-up-next-popup__glyph" viewBox="0 0 60.7856 60.7856" aria-hidden="true" focusable="false">
    <path d="M21.2153 7.34145L42.4285 28.5547L21.2153 49.7679" fill="none" stroke="currentColor" stroke-width="3.80484"/>
  </svg>
`

const RESTART_ICON = `
  <svg class="kiosk-up-next-popup__glyph" viewBox="0 0 60 60" aria-hidden="true" focusable="false">
    <path d="M26.3573 4.48223C27.3336 3.50592 28.9165 3.50592 29.8928 4.48223L36.1425 10.7319C36.6113 11.2008 36.8747 11.8366 36.8747 12.4997C36.8747 13.1627 36.6113 13.7986 36.1425 14.2675L29.8928 20.5172C28.9165 21.4935 27.3335 21.4935 26.3572 20.5171C25.3809 19.5408 25.3809 17.9579 26.3572 16.9816L28.2527 15.0861C19.4081 15.9629 12.5 23.4247 12.5 32.5C12.5 42.165 20.335 50 30 50C38.9223 50 46.2883 43.3207 47.3645 34.6907C47.5353 33.3206 48.7845 32.3484 50.1546 32.5192C51.5247 32.6901 52.4969 33.9393 52.3261 35.3094C50.9417 46.4109 41.4758 55 30 55C17.5736 55 7.5 44.9264 7.5 32.5C7.5 20.613 16.7181 10.8789 28.3958 10.0563L26.3573 8.01777C25.381 7.04146 25.3809 5.45855 26.3573 4.48223Z" fill="currentColor"/>
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

function visualMarkup(visual) {
  if (!visual) return ''
  /* Most cutouts share the contained box. A Figma-authored layout name may opt
     a specific offer into the geometry its visual area defines. */
  return `
    <img
      class="kiosk-up-next-popup__art"
      src="${assetUrl(visual.src)}"
      alt="${escapeHtml(visual.alt || '')}"
      ${visual.fit === 'cover' ? 'data-fit="cover"' : ''}
      ${visual.layout ? `data-layout="${escapeHtml(visual.layout)}"` : ''}
      draggable="false"
    >
  `
}

function popupMarkup({ chip, title, visual, restartLabel }) {
  return `
    <div class="kiosk-up-next-popup" data-up-next-popup data-kiosk-chrome hidden>
      <div class="kiosk-up-next-popup__scrim" data-popup-scrim></div>
      <div
        class="kiosk-up-next-popup__panel"
        role="dialog"
        aria-modal="true"
        aria-label="Up next: ${escapeHtml(title)}"
      >
        <div class="kiosk-up-next-popup__visual">
          ${visualMarkup(visual)}
          <button
            class="kiosk-up-next-popup__close"
            type="button"
            data-popup-close
            aria-label="Stay in this module"
          >${CLOSE_ICON}</button>
        </div>

        <button class="kiosk-up-next-popup__go" type="button" data-popup-go>
          <span class="kiosk-up-next-popup__label">
            <span class="kiosk-up-next-popup__chip">${escapeHtml(chip)}</span>
            <span class="kiosk-up-next-popup__title">${escapeHtml(title)}</span>
          </span>
          <span class="kiosk-up-next-popup__action" aria-hidden="true">${CHEVRON_ICON}</span>
        </button>

        <button class="kiosk-up-next-popup__restart" type="button" data-popup-restart>
          <span class="kiosk-up-next-popup__restart-label">${escapeHtml(restartLabel)}</span>
          <span
            class="kiosk-up-next-popup__action kiosk-up-next-popup__action--restart"
            aria-hidden="true"
          >${RESTART_ICON}</span>
        </button>
      </div>
    </div>
  `
}

/**
 * @param {object} options
 * @param {string} [options.chip] The line above the title. "All modules
 *   complete" at the end of the run, where the offer is the way home.
 * @param {string} options.title Name of the module being offered.
 * @param {object|null} [options.visual] Artwork box from up-next-visuals.js.
 * @param {string} [options.restartLabel]
 * @param {() => void} options.onContinue Take the offer.
 * @param {() => void} [options.onRestart] Run this module again from the top.
 * @param {() => void} [options.onDismiss] Close and stay where they are.
 */
export function createUpNextPopup({
  chip = 'Up next',
  title,
  visual = null,
  restartLabel = 'Restart this module',
  onContinue,
  onRestart,
  onDismiss
}) {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = popupMarkup({ chip, title, visual, restartLabel }).trim()
  const element = wrapper.firstElementChild

  let revealTimer = null
  let exitTimer = null
  let disposed = false
  const listeners = new AbortController()

  function close(notify) {
    if (disposed || element.hidden) return
    delete element.dataset.showing
    if (exitTimer !== null) window.clearTimeout(exitTimer)
    exitTimer = window.setTimeout(() => {
      exitTimer = null
      if (!disposed) element.hidden = true
    }, EXIT_FALLBACK_MS)
    if (notify) onDismiss?.()
  }

  element.querySelector('[data-popup-go]').addEventListener('click', () => {
    if (disposed) return
    close(false)
    onContinue?.()
  }, { signal: listeners.signal })

  element.querySelector('[data-popup-close]').addEventListener(
    'click',
    () => close(true),
    { signal: listeners.signal }
  )
  /*
   * Tapping the scrim dismisses; swiping across it must not.
   *
   * The scrim covers the whole stage, so on a scroll-driven module a visitor
   * who keeps swiping when the offer arrives swipes straight onto it — and a
   * swipe that starts and ends on the same element still produces a `click`,
   * which was closing the offer on what the visitor meant as a scroll. The
   * journey behind is already held still while this is up; the offer has to
   * hold still with it.
   *
   * Measured against the pointer's own travel rather than a time limit, so a
   * slow deliberate press still dismisses and a fast flick still does not.
   */
  const scrim = element.querySelector('[data-popup-scrim]')
  let scrimOrigin = null
  let scrimTravelled = false

  scrim.addEventListener('pointerdown', event => {
    scrimOrigin = { x: event.clientX, y: event.clientY }
    scrimTravelled = false
  }, { signal: listeners.signal })

  scrim.addEventListener('pointermove', event => {
    if (!scrimOrigin || scrimTravelled) return
    const travel = Math.hypot(event.clientX - scrimOrigin.x, event.clientY - scrimOrigin.y)
    if (travel > SCRIM_DISMISS_TRAVEL_LIMIT) scrimTravelled = true
  }, { signal: listeners.signal })

  /* A pointer that leaves the scrim mid-gesture never reports the `up`, and the
     flag has to be spent either way or the next tap inherits it. */
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    scrim.addEventListener(type, () => { scrimOrigin = null }, { signal: listeners.signal })
  }

  scrim.addEventListener('click', () => {
    if (scrimTravelled) {
      scrimTravelled = false
      return
    }
    close(true)
  }, { signal: listeners.signal })

  const restartButton = element.querySelector('[data-popup-restart]')
  if (onRestart) {
    restartButton.addEventListener('click', () => {
      if (disposed) return
      close(false)
      onRestart()
    }, { signal: listeners.signal })
  } else {
    /* Nothing to restart — a module that cannot replay itself should not offer
       a control that does nothing. */
    restartButton.remove()
  }

  return {
    element,

    /** Raises the popup after `delayMs`. Calling it again does not restart it. */
    raise(delayMs = UP_NEXT_POPUP_DELAY_MS) {
      if (disposed || revealTimer !== null || !element.hidden) return
      revealTimer = window.setTimeout(() => {
        revealTimer = null
        /* A popup whose module has already been torn down must not arrive over
           whatever replaced it — leaving on Exit inside the escalation window is
           exactly when that happens. dispose() is the contract; this is the
           backstop for a detach that skipped it. */
        if (disposed || !element.isConnected) return
        element.hidden = false
        /* Two frames: the first commits the resting state, the second lets the
           transition run. Both in one frame and the panel simply appears. */
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            if (!disposed) element.dataset.showing = 'true'
          })
        })
      }, delayMs)
    },

    /** Cancels a pending raise and takes the popup back down. */
    withdraw() {
      if (revealTimer !== null) window.clearTimeout(revealTimer)
      revealTimer = null
      close(false)
    },

    dispose() {
      disposed = true
      listeners.abort()
      if (revealTimer !== null) window.clearTimeout(revealTimer)
      if (exitTimer !== null) window.clearTimeout(exitTimer)
      revealTimer = null
      exitTimer = null
      element.remove()
    }
  }
}
