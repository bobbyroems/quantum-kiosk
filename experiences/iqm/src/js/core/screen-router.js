const LEAVE_ANIMATION_MS = 640

export class ScreenRouter {
  constructor(root) {
    this.screens = new Map(
      [...root.querySelectorAll('[data-screen]')].map(screen => [screen.dataset.screen, screen])
    )
    this.currentScreen = null
    this.leaveTimers = new Map()
  }

  show(screenId) {
    const nextScreen = this.screens.get(screenId)
    if (!nextScreen) throw new Error(`Unknown screen: ${screenId}`)
    if (this.currentScreen === screenId) return

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }

    nextScreen.parentElement.scrollTop = 0

    const previousScreen = this.screens.get(this.currentScreen)
    if (previousScreen && previousScreen !== nextScreen) {
      previousScreen.classList.add('is-leaving')
      window.clearTimeout(this.leaveTimers.get(previousScreen))
      this.leaveTimers.set(previousScreen, window.setTimeout(() => {
        previousScreen.classList.remove('is-leaving')
      }, LEAVE_ANIMATION_MS))
    }

    for (const [id, screen] of this.screens) {
      const isActive = id === screenId
      screen.classList.toggle('is-active', isActive)
      if (isActive) {
        screen.classList.remove('is-leaving')
        window.clearTimeout(this.leaveTimers.get(screen))
      }
      screen.setAttribute('aria-hidden', String(!isActive))
    }

    this.currentScreen = screenId
  }
}
