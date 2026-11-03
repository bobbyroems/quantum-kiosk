/**
 * Quantum Kiosk - App Controller
 */

// Dev mode: enable via ?dev=1 to persist state across hot reloads
const DEV_MODE = new URLSearchParams(window.location.search).get('dev') === '1'

class AppController {
  constructor() {
    this.attractScreen = document.getElementById('attract-screen')
    this.interactiveScreen = document.getElementById('interactive-screen')
    this.brandSlides = Array.from(document.querySelectorAll('.brand-slide'))

    this.isInteractive = false
    this.idleTimer = null
    // 10 minutes in dev mode, 60 seconds in production
    this.idleTimeout = DEV_MODE ? 600000 : 60000

    this.attract = new AttractController({
      screen: this.attractScreen,
      brandSlides: this.brandSlides
    })

    this.interactive = new InteractiveController({
      screen: this.interactiveScreen
    })

    this.init()
  }

  init() {
    this.attract.init()
    this.preventUnwantedActions()
    this.setupTouchHandler()
    this.setupHomeButton()

    // Preload tab assets to avoid hitches on first navigation
    this.interactive.registry.preload()

    // Dev mode: restore previous state on hot reload
    if (DEV_MODE && this.restoreDevState()) {
      return
    }

    this.attract.start()
  }

  setupHomeButton() {
    const homeBtn = document.getElementById('navHomeBtn')
    if (homeBtn) {
      homeBtn.addEventListener('click', () => {
        this.returnToAttractMode()
      })
    }
  }

  // Save current state for dev hot reload
  saveDevState() {
    if (!DEV_MODE) return
    const currentTab = this.interactive.currentTab
    const tab = this.interactive.tabs?.[currentTab]
    const state = {
      isInteractive: this.isInteractive,
      tab: currentTab,
      slide: tab?._deck?.activeIndex || 0,
      timestamp: Date.now()
    }
    sessionStorage.setItem('kiosk-dev-state', JSON.stringify(state))
  }

  // Restore state after hot reload (only if recent)
  restoreDevState() {
    const saved = sessionStorage.getItem('kiosk-dev-state')
    if (!saved) return false

    try {
      const state = JSON.parse(saved)
      const age = Date.now() - (state.timestamp || 0)

      // Allow a longer window in dev to avoid reset on slow reloads
      if (age > 600000) {
        sessionStorage.removeItem('kiosk-dev-state')
        return false
      }

      if (state.isInteractive) {
        // Skip animations, go straight to interactive mode
        this.isInteractive = true
        this.attractScreen.classList.remove('active')
        this.attractScreen.style.display = 'none'
        this.attractScreen.style.visibility = 'hidden'
        document.getElementById('startButton').style.display = 'none'

        this.interactive.show(state.tab || 'connect', state.slide || 0)
        return true
      }
    } catch (e) {
      console.warn('Failed to restore dev state:', e)
    }
    return false
  }

  preventUnwantedActions() {
    document.addEventListener('contextmenu', e => e.preventDefault())
    document.addEventListener('selectstart', e => e.preventDefault())
    document.addEventListener('dragstart', e => e.preventDefault())
  }

  setupTouchHandler() {
    const startButton = document.getElementById('startButton')

    const handleButtonTap = () => {
      const currentSlide = this.attract.currentSlide

      if (currentSlide === 0) {
        // Hide button after first tap - disable pointer events immediately
        startButton.style.pointerEvents = 'none'
        gsap.to(startButton, {
          opacity: 0,
          scale: 0.9,
          duration: 0.3,
          ease: 'power2.in',
          onComplete: () => {
            startButton.style.display = 'none'
          }
        })

        // On QuNorth - advance to Magne, then auto-advance to Connect/Compute/Control after 2 sec
        this.attract.transitionToSlide(1)
        setTimeout(() => {
          if (this.attract.currentSlide === 1) {
            this.attract.transitionToSlide(2)
          }
        }, 2000)
      }
    }

    startButton.addEventListener('click', handleButtonTap)
    startButton.addEventListener('touchstart', (e) => {
      e.preventDefault()
      handleButtonTap()
    })

    // Use capture phase so these fire before any stopPropagation() calls
    document.addEventListener('touchstart', () => this.resetIdleTimer(), true)
    document.addEventListener('click', () => this.resetIdleTimer(), true)

    // Nav words on slide 2 - clicking them enters interactive mode with that tab
    const navWords = document.querySelectorAll('.nav-word')
    navWords.forEach(word => {
      const handleNavWordTap = (e) => {
        // Only respond when on slide 2
        if (this.attract.currentSlide === 2) {
          e.stopPropagation()
          const tabId = word.textContent.trim().toLowerCase()
          this.enterInteractiveMode(tabId)
        }
      }

      word.addEventListener('click', handleNavWordTap)
      word.addEventListener('touchstart', (e) => {
        e.preventDefault()
        handleNavWordTap(e)
      })
    })
  }

  enterInteractiveMode(tabId = 'connect') {
    if (this.isInteractive) return

    this.isInteractive = true
    this.attract.stop()
    this.attractScreen.style.pointerEvents = 'none'

    // Animate dots out
    gsap.to(this.attract.allDots, {
      opacity: 0,
      scale: 0.3,
      y: () => (Math.random() - 0.5) * 300,
      x: () => (Math.random() - 0.5) * 200,
      duration: 0.5,
      stagger: 0.008,
      ease: 'power2.in'
    })

    // Fade out text
    gsap.to('.brand-slide.active', {
      opacity: 0,
      y: -30,
      duration: 0.4
    })

    // Fade out and hide start button
    gsap.to('#startButton', {
      opacity: 0,
      scale: 0.9,
      duration: 0.3,
      ease: 'power2.in',
      onComplete: () => {
        document.getElementById('startButton').style.display = 'none'
      }
    })

    // Start showing interactive screen early (overlap the transition)
    this.interactive.show(tabId)

    // Fade out attract screen (but interactive is already fading in behind it)
    gsap.to(this.attractScreen, {
      opacity: 0,
      duration: 0.5,
      delay: 0.2,
      onComplete: () => {
        this.attractScreen.classList.remove('active')
        this.attractScreen.style.display = 'none'
        this.attractScreen.style.visibility = 'hidden'
        this.attractScreen.style.opacity = 1
      }
    })

    this.startIdleTimer()
    this.saveDevState()
  }

  returnToAttractMode() {
    this.isInteractive = false
    clearTimeout(this.idleTimer)

    // Reset global elements data attributes
    delete this.interactiveScreen.dataset.activeTab
    delete this.interactiveScreen.dataset.connectSlide

    // Reset global QuNorth text animations
    const globalQuNorth = document.getElementById('globalQuNorth')
    if (globalQuNorth) {
      const title = globalQuNorth.querySelector('.qunorth-title')
      const subtitle = globalQuNorth.querySelector('.qunorth-subtitle')
      const body = globalQuNorth.querySelector('.qunorth-body')
      const locationSection = globalQuNorth.querySelector('.qunorth-location')
      gsap.set([title, subtitle, body], { opacity: 0, y: 30 })
      if (locationSection) {
        locationSection.classList.remove('location-visible')
        locationSection.classList.add('location-hidden')
        gsap.set(locationSection, { opacity: 0, y: 20 })
      }
    }

    // Reset global locator dot
    const globalDot = document.querySelector('.global-locator-dot')
    if (globalDot) {
      gsap.set(globalDot, { opacity: 0, scale: 0 })
    }

    this.interactive.hide().then(() => {
      this.attractScreen.style.display = ''  // Clear inline display style
      this.attractScreen.style.visibility = ''  // Clear inline visibility style
      this.attractScreen.classList.add('active')
      this.attractScreen.style.opacity = 1
      this.attractScreen.style.pointerEvents = ''

      // Reset and show start button
      const startButton = document.getElementById('startButton')
      startButton.style.display = ''
      startButton.style.pointerEvents = ''
      gsap.set(startButton, { opacity: 1, scale: 1 })

      // Full reset of all dots and slides
      this.attract.reset()
      this.attract.start()
    })
  }

  startIdleTimer() {
    this.idleTimer = setTimeout(() => {
      this.returnToAttractMode()
    }, this.idleTimeout)
  }

  resetIdleTimer() {
    if (this.isInteractive) {
      clearTimeout(this.idleTimer)
      this.startIdleTimer()
    }
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Enable kiosk mode (hide cursor) when not in dev mode
  const urlParams = new URLSearchParams(window.location.search)
  const isDevMode = urlParams.get('dev') === '1'

  if (!isDevMode) {
    document.body.classList.add('kiosk-mode')
  }

  window.quantumKiosk = new AppController()
  if (window.ShaderWarmup && typeof window.ShaderWarmup.start === 'function') {
    window.ShaderWarmup.start()
  }
})
