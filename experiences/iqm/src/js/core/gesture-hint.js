/*
 * Animated hand-gesture hints (Lottie, from the quantum-kiosk repo's
 * "swipe left" animation, plus a derived in-place "tap" variant).
 * For swipes, `direction` rotates the base leftward motion so one asset
 * covers all four directions; the tap variant presses straight down and
 * ignores rotation. Falls back silently to whatever static hint the host
 * already renders.
 */

import { assetUrl } from './asset-url.js'

const ROTATIONS = Object.freeze({ left: 0, up: 90, right: 180, down: 270 })
const VARIANT_PATHS = Object.freeze({
  swipe: 'assets/ui/animations/swipe-left.json',
  tap: 'assets/ui/animations/tap.json'
})

let lottiePromise = null
function loadLottie() {
  lottiePromise ??= import('lottie-web').then(module => module.default ?? module)
  return lottiePromise
}

export function mountGestureHint(host, { direction = 'left', variant = 'swipe' } = {}) {
  if (!host) return { dispose() {} }
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  if (reducedMotion) return { dispose() {} }

  let animation = null
  let disposed = false
  loadLottie().then(lottie => {
    if (disposed) return
    host.classList.add('has-gesture-animation')
    const rotation = variant === 'tap' ? 0 : (ROTATIONS[direction] ?? 0)
    host.style.transform = `rotate(${rotation}deg)`
    animation = lottie.loadAnimation({
      container: host,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      path: assetUrl(VARIANT_PATHS[variant] ?? VARIANT_PATHS.swipe)
    })
  }).catch(() => {
    /* lottie unavailable — the host's static CSS hint remains */
  })

  return {
    dispose() {
      disposed = true
      animation?.destroy()
      animation = null
    }
  }
}
