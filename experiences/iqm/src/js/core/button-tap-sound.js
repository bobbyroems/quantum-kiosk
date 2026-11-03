/*
 * One uniform tap sound for every button in the kiosk. Delegated from the
 * document so controls the modules mount later are covered without wiring,
 * and fired on pointerdown so the click lands under the finger rather than
 * after the handler's work. Transition sounds (whoosh, dive) still layer on
 * top where a tap also moves the screen.
 */
import { sound } from './kiosk-audio.js'

const TAP_SELECTOR = 'button, [role="button"]'

/* Dev-only tooling stays silent — it is not part of the kiosk experience. */
const IGNORE_SELECTOR = '.development-hud, .development-material-panel'

export function installButtonTapSound(root = document) {
  root.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    playTap(event.target)
  }, { passive: true })

  /* Keyboard and assistive activation never produce a pointerdown; a click
     with no detail count is our signal that no pointer was involved. */
  root.addEventListener('click', event => {
    if (event.detail !== 0) return
    playTap(event.target)
  })
}

function playTap(target) {
  const button = target?.closest?.(TAP_SELECTOR)
  if (!button) return
  if (button.disabled || button.getAttribute('aria-disabled') === 'true') return
  if (button.closest(IGNORE_SELECTOR)) return
  sound.pop()
}
