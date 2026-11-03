const PRESS_BLOOM_SELECTOR = [
  '.primary-action',
  '.microsoft-header__action',
  '.module-carousel__arrow'
].join(', ')

export function installPressBloom(root = document) {
  root.addEventListener('pointerdown', event => {
    const button = event.target.closest(PRESS_BLOOM_SELECTOR)
    if (!button || button.disabled) return

    const rect = button.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * 100
    const y = ((event.clientY - rect.top) / rect.height) * 100
    button.style.setProperty('--press-x', `${x}%`)
    button.style.setProperty('--press-y', `${y}%`)
    button.classList.add('is-pressing')

    const pointerId = event.pointerId
    const release = releaseEvent => {
      if (releaseEvent.pointerId !== pointerId) return
      button.classList.remove('is-pressing')
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
  }, { passive: true })
}
