/**
 * Interactive Screen Controller
 */

class InteractiveController {
  constructor({ screen }) {
    this.screen = screen
    this.tabButtons = Array.from(document.querySelectorAll('.nav-tab'))
    this.navIndicator = document.querySelector('.nav-indicator')
    this.contentArea = document.getElementById('contentArea')
    this.registry = new TabRegistry()
    this.activeTabId = null

    this.bindEvents()
  }

  get currentTab() {
    return this.activeTabId
  }

  get tabs() {
    return this.registry.tabs
  }

  bindEvents() {
    this.tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        this.activateTab(button.dataset.tab)
        // Save dev state on tab switch
        if (window.quantumKiosk?.saveDevState) {
          window.quantumKiosk.saveDevState()
        }
      })
    })
  }

  activateTab(tabId, slideIndex = 0) {
    const tab = this.registry.get(tabId)
    if (!tab) return

    // Clean up global Connect elements when switching away from Connect
    if (this.activeTabId === 'connect' && tabId !== 'connect') {
      this._resetConnectGlobals()
    }

    // Set data attribute for CSS targeting (e.g., global map visibility)
    this.screen.dataset.activeTab = tabId
    // Clear connect slide attribute when not on connect
    if (tabId !== 'connect') {
      delete this.screen.dataset.connectSlide
    }

    this.tabButtons.forEach(button => {
      button.classList.toggle('active', button.dataset.tab === tabId)
    })

    this.moveIndicator(tabId)

    // Pass callbacks for cross-tab navigation
    tab.render(this.contentArea, {
      onSwitchTab: (nextTabId, options) => this.activateTab(nextTabId, options?.slideIndex || 0)
    })
    this.activeTabId = tabId

    // Go to specific slide if provided
    if (slideIndex > 0 && tab._deck?.goTo) {
      tab._deck.goTo(slideIndex)
    }
  }

  _resetConnectGlobals() {
    // Reset global QuNorth text - clear GSAP inline styles
    const globalQuNorth = document.getElementById('globalQuNorth')
    if (globalQuNorth) {
      const title = globalQuNorth.querySelector('.qunorth-title')
      const subtitle = globalQuNorth.querySelector('.qunorth-subtitle')
      const body = globalQuNorth.querySelector('.qunorth-body')
      const locationSection = globalQuNorth.querySelector('.qunorth-location')

      gsap.killTweensOf([title, subtitle, body])
      gsap.set([title, subtitle, body], { clearProps: 'all' })

      if (locationSection) {
        locationSection.classList.remove('location-visible')
        locationSection.classList.add('location-hidden')
        gsap.killTweensOf(locationSection)
        gsap.set(locationSection, { clearProps: 'all' })
      }
    }

    // Reset global locator dot - remove class and clear GSAP inline styles
    const globalDot = document.querySelector('.global-locator-dot')
    if (globalDot) {
      globalDot.classList.remove('dot-visible')
      gsap.killTweensOf(globalDot)
      gsap.set(globalDot, { clearProps: 'all' })
    }
  }

  moveIndicator(tabId) {
    const activeButton = this.tabButtons.find(btn => btn.dataset.tab === tabId)
    if (!activeButton || !this.navIndicator) return

    const buttonRect = activeButton.getBoundingClientRect()
    const navRect = activeButton.parentElement.getBoundingClientRect()

    const indicatorWidth = buttonRect.width * 0.8
    const leftOffset = buttonRect.left - navRect.left + (buttonRect.width - indicatorWidth) / 2

    this.navIndicator.style.width = `${indicatorWidth}px`
    this.navIndicator.style.left = `${leftOffset}px`
  }

  show(tabId = 'connect', slideIndex = 0) {
    return new Promise((resolve) => {
      this.screen.classList.add('active')
      this.activateTab(tabId, slideIndex)
      // Position indicator immediately without transition on first show
      requestAnimationFrame(() => {
        this.moveIndicator(tabId)
      })
      gsap.fromTo(this.screen,
        { opacity: 0 },
        { opacity: 1, duration: 0.5, onComplete: resolve }
      )
    })
  }

  hide() {
    return new Promise((resolve) => {
      gsap.to(this.screen, {
        opacity: 0,
        duration: 0.5,
        onComplete: () => {
          this.screen.classList.remove('active')
          resolve()
        }
      })
    })
  }
}

window.InteractiveController = InteractiveController
