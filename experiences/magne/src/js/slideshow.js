class Slideshow {
  constructor({ container, slides, initialIndex = 0, unmountInactive = true, useSwipe = true, onOverflowNext = null, onOverflowPrev = null } = {}) {
    this.container = container
    this.slides = Array.isArray(slides) ? slides : []
    this.activeIndex = 0
    this.unmountInactive = unmountInactive
    this.useSwipe = useSwipe
    this.onOverflowNext = onOverflowNext  // Called when swiping past last slide
    this.onOverflowPrev = onOverflowPrev  // Called when swiping before first slide
    this._isAnimating = false
    this._pointer = {
      active: false,
      id: null,
      startX: 0,
      startY: 0,
      deltaX: 0,
      deltaY: 0
    }
    this._buildPanelMap()

    if (!this.container) return

    this._build()
    this._bind()
    this.goTo(initialIndex, { immediate: true, forceEnter: true })
  }

  _buildPanelMap() {
    const panelKeyBySlide = this.slides.map((slide, index) => {
      if (slide && slide.panelKey) return slide.panelKey
      return `slide-${index}`
    })

    const panelIndexByKey = new Map()
    const panelIndexBySlide = []
    const slidesByPanel = []

    panelKeyBySlide.forEach((key, index) => {
      if (!panelIndexByKey.has(key)) {
        panelIndexByKey.set(key, panelIndexByKey.size)
        slidesByPanel.push([])
      }
      const panelIndex = panelIndexByKey.get(key)
      panelIndexBySlide[index] = panelIndex
      slidesByPanel[panelIndex].push(index)
    })

    const panelOwnerIndex = slidesByPanel.map((indices) => {
      const withRender = indices.find((slideIndex) => {
        const slide = this.slides[slideIndex]
        return slide && (typeof slide.render === 'function' || typeof slide.html === 'string')
      })
      return withRender !== undefined ? withRender : indices[0]
    })

    const panelKeepMounted = slidesByPanel.map((indices) => {
      return indices.some((slideIndex) => {
        const slide = this.slides[slideIndex]
        return slide && slide.keepMounted
      })
    })

    this._panelKeyBySlide = panelKeyBySlide
    this._panelIndexBySlide = panelIndexBySlide
    this._slidesByPanel = slidesByPanel
    this._panelOwnerIndex = panelOwnerIndex
    this._panelKeepMounted = panelKeepMounted
    this._panelStates = slidesByPanel.map(() => ({ mounted: false, cleanup: null }))
  }

  _build() {
    this.container.innerHTML = `
      <div class="slide-deck">
        <button class="slide-nav slide-prev" type="button" aria-label="Previous page"></button>
        <div class="slide-viewport">
          <div class="slide-track"></div>
        </div>
        <button class="slide-nav slide-next" type="button" aria-label="Next page"></button>
        <div class="slide-dots"></div>
      </div>
    `

    this.root = this.container.querySelector('.slide-deck')
    this.track = this.container.querySelector('.slide-track')
    this.viewport = this.container.querySelector('.slide-viewport')
    this.prevButton = this.container.querySelector('.slide-prev')
    this.nextButton = this.container.querySelector('.slide-next')
    this.dotsContainer = this.container.querySelector('.slide-dots')

    this.panels = this._panelStates.map((_state, panelIndex) => {
      const panel = document.createElement('div')
      panel.className = 'slide-panel'
      panel.dataset.panelIndex = panelIndex
      panel.setAttribute('aria-hidden', 'true')
      panel.setAttribute('role', 'group')
      panel.setAttribute('aria-roledescription', 'slide')
      const ownerIndex = this._panelOwnerIndex[panelIndex]
      const ownerSlide = this.slides[ownerIndex]
      panel.setAttribute('aria-label', ownerSlide && ownerSlide.label ? ownerSlide.label : `Slide ${ownerIndex + 1}`)
      this.track.appendChild(panel)
      return panel
    })

    // Create pagination dots for each slide
    this.dots = this.slides.map((slide, index) => {
      const dot = document.createElement('button')
      dot.className = 'slide-dot'
      dot.setAttribute('type', 'button')
      dot.setAttribute('aria-label', `Go to slide ${index + 1}`)
      dot.dataset.slideIndex = index
      this.dotsContainer.appendChild(dot)
      return dot
    })
  }

  _bind() {
    this._onPrev = () => this.prev()
    this._onNext = () => this.next()
    this.prevButton.addEventListener('click', this._onPrev)
    this.nextButton.addEventListener('click', this._onNext)

    // Dot click handlers
    this._onDotClick = (event) => {
      const index = parseInt(event.currentTarget.dataset.slideIndex, 10)
      if (!isNaN(index)) {
        this.goTo(index)
      }
    }
    this.dots.forEach(dot => {
      dot.addEventListener('click', this._onDotClick)
    })

    if (!this.useSwipe) return

    this._onPointerDown = (event) => {
      if (event.button !== undefined && event.button !== 0) return
      if (event.target.closest('[data-swipe-ignore="true"]')) return

      this._pointer.active = true
      this._pointer.id = event.pointerId
      this._pointer.startX = event.clientX
      this._pointer.startY = event.clientY
      this._pointer.deltaX = 0
      this._pointer.deltaY = 0
    }

    this._onPointerMove = (event) => {
      if (!this._pointer.active || event.pointerId !== this._pointer.id) return
      this._pointer.deltaX = event.clientX - this._pointer.startX
      this._pointer.deltaY = event.clientY - this._pointer.startY
    }

    this._onPointerUp = (event) => {
      if (!this._pointer.active || event.pointerId !== this._pointer.id) return

      const { deltaX, deltaY } = this._pointer
      const absX = Math.abs(deltaX)
      const absY = Math.abs(deltaY)
      const threshold = 60

      if (absX > threshold && absX > absY * 1.2) {
        if (deltaX < 0) {
          this.next()
        } else {
          this.prev()
        }
      }

      this._pointer.active = false
      this._pointer.id = null
    }

    this.viewport.addEventListener('pointerdown', this._onPointerDown)
    this.viewport.addEventListener('pointermove', this._onPointerMove)
    this.viewport.addEventListener('pointerup', this._onPointerUp)
    this.viewport.addEventListener('pointercancel', this._onPointerUp)
    this.viewport.addEventListener('pointerleave', this._onPointerUp)
  }

  _mountPanel(panelIndex) {
    if (!this.panels[panelIndex]) return
    const state = this._panelStates[panelIndex]
    if (state.mounted) return

    const panel = this.panels[panelIndex]
    const ownerIndex = this._panelOwnerIndex[panelIndex]
    const slide = this.slides[ownerIndex]

    let cleanup = null
    if (slide && typeof slide.render === 'function') {
      cleanup = slide.render(panel) || null
    } else if (slide && typeof slide.html === 'string') {
      panel.innerHTML = slide.html
    }

    state.mounted = true
    state.cleanup = cleanup
  }

  _unmountPanel(panelIndex) {
    if (!this.panels[panelIndex]) return
    const state = this._panelStates[panelIndex]
    if (!state.mounted) return

    if (typeof state.cleanup === 'function') {
      state.cleanup()
    }

    this.panels[panelIndex].innerHTML = ''
    state.cleanup = null
    state.mounted = false
  }

  _updatePanels() {
    const activePanelIndex = this._panelIndexBySlide[this.activeIndex]
    this.panels.forEach((panel, panelIndex) => {
      const isActive = panelIndex === activePanelIndex
      panel.setAttribute('aria-hidden', isActive ? 'false' : 'true')
      panel.classList.toggle('is-active', isActive)
    })
    const activePanel = this.panels[activePanelIndex]
    const activeSlide = this.slides[this.activeIndex]
    if (activePanel) {
      activePanel.setAttribute('aria-label', activeSlide && activeSlide.label ? activeSlide.label : `Slide ${this.activeIndex + 1}`)
    }
  }

  _updateNav(index = this.activeIndex) {
    const hasSlides = this.slides.length > 1
    const isFirst = index <= 0
    const isLast = index >= this.slides.length - 1

    // Keep prev/next visible if overflow callbacks are defined (for cross-tab navigation)
    const hidePrev = !hasSlides || (isFirst && !this.onOverflowPrev)
    const hideNext = !hasSlides || (isLast && !this.onOverflowNext)

    this.prevButton.classList.toggle('is-hidden', hidePrev)
    this.nextButton.classList.toggle('is-hidden', hideNext)
    this.prevButton.disabled = isFirst && !this.onOverflowPrev
    this.nextButton.disabled = isLast && !this.onOverflowNext

    // Update pagination dots
    if (this.dots) {
      this.dots.forEach((dot, dotIndex) => {
        dot.classList.toggle('is-active', dotIndex === index)
      })
    }
  }

  getPanelForSlide(slideIndex, { mount = false } = {}) {
    if (!this.panels || !this._panelIndexBySlide) return null
    const panelIndex = this._panelIndexBySlide[slideIndex]
    if (panelIndex === undefined || panelIndex === null) return null
    if (mount) {
      this._mountPanel(panelIndex)
    }
    return this.panels[panelIndex] || null
  }

  _afterChange() {
    this._updatePanels()
    this._updateNav()

    if (this.unmountInactive) {
      const activePanelIndex = this._panelIndexBySlide[this.activeIndex]
      this.panels.forEach((_panel, panelIndex) => {
        if (panelIndex !== activePanelIndex && !this._panelKeepMounted[panelIndex]) {
          this._unmountPanel(panelIndex)
        }
      })
    }
  }

  _triggerSlideExit(prevIndex, nextIndex) {
    const slide = this.slides[prevIndex]
    if (slide && typeof slide.onExit === 'function') {
      const panelIndex = this._panelIndexBySlide[prevIndex]
      slide.onExit({
        from: prevIndex,
        to: nextIndex,
        panel: this.panels[panelIndex]
      })
    }
  }

  _triggerSlideEnter(nextIndex, prevIndex) {
    const slide = this.slides[nextIndex]
    if (slide && typeof slide.onEnter === 'function') {
      const panelIndex = this._panelIndexBySlide[nextIndex]
      slide.onEnter({
        index: nextIndex,
        previousIndex: prevIndex,
        panel: this.panels[panelIndex]
      })
    }
  }

  goTo(index, { immediate = false, forceEnter = false } = {}) {
    if (!this.slides.length) return
    const nextIndex = Math.max(0, Math.min(index, this.slides.length - 1))
    const nextPanelIndex = this._panelIndexBySlide[nextIndex]
    const currentPanelIndex = this._panelIndexBySlide[this.activeIndex]
    if (this._isAnimating || nextIndex === this.activeIndex) {
      if (nextIndex === this.activeIndex) {
        this._mountPanel(nextPanelIndex)
        this._updatePanels()
        this._updateNav()
        if (forceEnter) {
          this._triggerSlideEnter(nextIndex, this.activeIndex)
        }
      }
      return
    }

    const prevIndex = this.activeIndex
    this._updateNav(nextIndex)
    this._mountPanel(nextPanelIndex)
    this._triggerSlideExit(prevIndex, nextIndex)
    const xPercent = -nextPanelIndex * 100
    const shouldAnimate = !immediate && nextPanelIndex !== currentPanelIndex && window.gsap
    this._isAnimating = shouldAnimate

    const finish = () => {
      this.activeIndex = nextIndex
      this._isAnimating = false
      this._afterChange()
      this._triggerSlideEnter(nextIndex, prevIndex)
      // Save dev state on slide change
      if (window.quantumKiosk?.saveDevState) {
        window.quantumKiosk.saveDevState()
      }
    }

    if (!shouldAnimate) {
      this.track.style.transform = `translateX(${xPercent}%)`
      finish()
      return
    }

    window.gsap.to(this.track, {
      xPercent,
      duration: 0.6,
      ease: 'power2.out',
      onComplete: finish
    })
  }

  next() {
    if (this._isAnimating) return
    // Check if at last slide
    if (this.activeIndex >= this.slides.length - 1) {
      if (typeof this.onOverflowNext === 'function') {
        this.onOverflowNext()
      }
      return
    }
    this.goTo(this.activeIndex + 1)
  }

  prev() {
    if (this._isAnimating) return
    // Check if at first slide
    if (this.activeIndex <= 0) {
      if (typeof this.onOverflowPrev === 'function') {
        this.onOverflowPrev()
      }
      return
    }
    this.goTo(this.activeIndex - 1)
  }

  destroy() {
    if (!this.container) return

    this.prevButton.removeEventListener('click', this._onPrev)
    this.nextButton.removeEventListener('click', this._onNext)

    // Remove dot event listeners
    if (this.dots && this._onDotClick) {
      this.dots.forEach(dot => {
        dot.removeEventListener('click', this._onDotClick)
      })
    }

    if (this.useSwipe && this.viewport) {
      this.viewport.removeEventListener('pointerdown', this._onPointerDown)
      this.viewport.removeEventListener('pointermove', this._onPointerMove)
      this.viewport.removeEventListener('pointerup', this._onPointerUp)
      this.viewport.removeEventListener('pointercancel', this._onPointerUp)
      this.viewport.removeEventListener('pointerleave', this._onPointerUp)
    }

    this.panels.forEach((_panel, panelIndex) => this._unmountPanel(panelIndex))
    this.container.innerHTML = ''
  }
}

window.Slideshow = Slideshow
