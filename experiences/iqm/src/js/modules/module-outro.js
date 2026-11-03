/**
 * Wires the three beats a module ends on: the band that has been stating where
 * the visitor is turns into an offer, and if the offer goes untaken the popup
 * asks outright.
 *
 * This lives in modules/ rather than core/ because it is the piece that knows
 * the route — core draws the band and the popup without knowing what follows
 * what, and only the registry can answer that. Keeping the dependency pointing
 * this way is why core/ still imports nothing from modules/.
 *
 * Every module ends the same way, so the wiring is here once instead of eight
 * times. What differs per module is the artwork, which up-next-visuals.js
 * carries, and how it restarts itself, which it passes in.
 */

import { createModuleBand, UP_NEXT_BANNER_DELAY_MS } from '../core/module-band.js'
import { createUpNextPopup, UP_NEXT_POPUP_DELAY_MS } from '../core/up-next-popup.js'
import { UP_NEXT_COMPLETE_VISUAL, upNextVisualFor } from '../core/up-next-visuals.js'
import { areUpNextCardsEnabled, onUpNextCardsChange } from '../core/kiosk-settings.js'
import { nextPlayableModule } from './module-registry.js'

/* The board writes the number without its leading zero — "2: A new state of
   matter", not "02:" — while the registry stores the printed two-digit label
   the carousel uses. */
function bandLabel(module) {
  if (!module) return ''
  const number = Number.parseInt(module.number, 10)
  return Number.isFinite(number) ? `${number}: ${module.title}` : module.title
}

export function bindUpNextPopupPreference(popup) {
  return onUpNextCardsChange(enabled => {
    if (!enabled) popup.withdraw()
  })
}

/**
 * @param {object} options
 * @param {object} options.module The module being played.
 * @param {HTMLElement} options.root Where the band and popup are appended.
 * @param {object} [options.navigate] The host's navigation callbacks.
 * @param {() => void} [options.onActivity] Idle-timer poke.
 * @param {() => void} [options.onRestart] Run this module again from the top.
 * @param {number} [options.delayMs] Wait before the offer replaces the title.
 * @param {number} [options.popupDelayMs] Wait while the band offer stands
 *   before escalating to the interrupting popup.
 */
export function mountModuleOutro({
  module,
  root,
  navigate,
  onActivity,
  onRestart,
  delayMs = UP_NEXT_BANNER_DELAY_MS,
  popupDelayMs = UP_NEXT_POPUP_DELAY_MS
}) {
  const band = createModuleBand({ label: bandLabel(module) })
  root.append(band.element)

  /* The registry is the single source of truth for the floor route. Concept
     entries without a loader are skipped automatically. */
  const following = module ? nextPlayableModule(module.id) : null

  /* The last module ends the run, and the board gives that its own offer
     (255:3527): the same band and pop-up, pointing back to the start instead of
     on. Without this the final module simply stopped, with nothing to say.
     The board leaves its picture area empty; the run instead closes on the
     attract screen's chip, so the offer home is a picture rather than a gap. */
  const offerChip = following ? 'Up next' : 'All modules complete'
  const offerTitle = following ? bandLabel(following) : 'Return to home'

  /* The band says it shorter than the pop-up does. Both carry the same chip
     everywhere else, but at the end of the run the full wording is three times
     the length of "Up next", and on a bar sized for that it swells across the
     left of the band and throws off proportions every other module holds. The
     pop-up is a tall card with room to spare, so it keeps the full phrase. */
  const bandChip = following ? offerChip : 'Complete'
  const takeOffer = () => {
    onActivity?.()
    if (following) navigate?.module?.(following.id)
    else navigate?.home?.()
  }

  const popup = createUpNextPopup({
    chip: offerChip,
    title: offerTitle,
    visual: following ? upNextVisualFor(following.id) : UP_NEXT_COMPLETE_VISUAL,
    onContinue: takeOffer,
    onRestart: onRestart
      ? () => {
        onActivity?.()
        onRestart()
      }
      : undefined,
    /* Dismissing leaves the offer standing on the band. The visitor said no to
       being asked, not to what follows. */
    onDismiss: () => onActivity?.()
  })

  root.append(popup.element)
  /* Every registered module comes through this shared outro. Turning cards off
     also cancels an escalation already counting down (or closes one already
     raised) while leaving the quieter band offer in place. */
  const unbindUpNextPreference = bindUpNextPopupPreference(popup)

  return {
    band,
    popup,
    /** The module has finished: turn the band into the offer. */
    offer() {
      /* The settings switch means the same thing here as it does inside module
         01: it turns the interruption off, never the way on. */
      const escalates = areUpNextCardsEnabled()
      band.offerNext({
        chip: bandChip,
        title: offerTitle,
        actionLabel: following ? 'Continue' : 'Go home',
        delayMs,
        escalateMs: escalates ? popupDelayMs : undefined,
        onEscalate: escalates ? () => popup.raise(0) : undefined,
        onContinue: takeOffer
      })
    },
    /** Takes the offer back down — the module is replayable again. */
    withdraw() {
      band.withdrawOffer()
      popup?.withdraw()
    },
    dispose() {
      unbindUpNextPreference()
      band.dispose()
      popup?.dispose()
    }
  }
}
