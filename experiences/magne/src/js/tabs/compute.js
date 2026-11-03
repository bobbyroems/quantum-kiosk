class ComputeTab {
  constructor() {
    this.id = 'compute'
    this.title = 'Compute'
    this.gridConfig = {
      rows: 5,
      cols: 5,
      spacing: 1.6,
      radius: 0.45
    }
    this._deck = null
    this._threePromise = null
    this._gridScenePromise = null
    this._hexScenePromise = null
    this._flowScenePromise = null
    this._gridView = null
    this._hexView = null
    this._flowView = null
    this._flowViewPromise = null
    this._flowHandoff = null
    this._flowTransitionTimer = null
    this._isFlowTransitioning = false
    this._flowStartToken = 0
    this._binaryAnimInterval = null
    this._flowStatsTimer = null
    this._deckGoTo = null
    this._hexSlideIndex = null
    this._flowSlideIndex = null
    this._flowConfig = {
      laneCount: 6,
      barHeightRatio: 227.144 / 1080,
      barYOffsetRatio: -0.065,
      handoffDuration: 0.3,
      transitionFraction: 1.4,
      handoffEdgeOffsetRatio: 0.08,
      flowColor: '#0078d4',
      flowEdgeOffsetRatio: -0.04,
      flowTravelDuration: 8,
      flowSpawnInterval: 2,
      flowDiagramOpacity: 0.5,
      sectionOneStart: 0.0,
      sectionTwoStart: 0.39,
      sectionThreeStart: 0.65,
      sectionFourStart: 0.9,
      flowHighlightMin: 0,
      flowHighlightMax: 4,
      flowHighlightFirstMin: 2,
      flowHighlightStartColor: '#F4364C',
      flowHighlightMidColor: '#52b471',
      flowFadeInDuration: 0.4,
      flowColorFadeDuration: 0.35,
      flowFadeOutDuration: 0.5,
      flowBallSizeRatio: 18 / 1080
    }
    this._pendingStage = null
    this.views = [
      this._createGridSlide(),
      {
        label: 'Atom Focus',
        panelKey: 'compute-grid',
        onEnter: () => this._setGridStage(2)
      },
      {
        label: 'Dual Atom',
        panelKey: 'compute-grid',
        onEnter: () => {
          this._setGridStage(3)
          this._preloadHexScene()
        }
      },
      this._createHexSlide(),
      this._createFlowSlide()
    ]
    this._hexSlideIndex = this.views.length - 2
    this._flowSlideIndex = this.views.length - 1
  }

  render(container, options = {}) {
    if (this._deck) {
      this._deck.destroy()
      this._deck = null
    }
    this._cancelFlowTransition()
    this._deckGoTo = null

    this._onSwitchTab = options.onSwitchTab || null
    const initialIndex = typeof options.initialSlide === 'number' ? options.initialSlide : 0

    container.innerHTML = `<div class="tab-slides"></div>`
    const deckHost = container.querySelector('.tab-slides')
    this._deck = new Slideshow({
      container: deckHost,
      slides: this.views,
      initialIndex,
      unmountInactive: true,
      useSwipe: false,
      onOverflowNext: () => {
        // Switch to Control tab when swiping past last Compute slide
        if (this._onSwitchTab) {
          this._onSwitchTab('control')
        }
      },
      onOverflowPrev: () => {
        // Switch to Connect tab (last slide) when swiping before first Compute slide
        if (this._onSwitchTab) {
          this._onSwitchTab('connect', { slideIndex: 999 }) // 999 will be clamped to last slide
        }
      }
    })
    this._wrapDeckNavigation()
  }

  _placeholder(index) {
    return `<div class="slide-placeholder">${this.title} - Page ${index}</div>`
  }

  _createGridSlide() {
    return {
      label: 'Neutral Atoms',
      panelKey: 'compute-grid',
      render: (panel) => this._renderGridSlide(panel),
      onEnter: () => this._setGridStage(1)
    }
  }

  _renderGridSlide(panel) {
    const initialStage = this._pendingStage !== null ? this._pendingStage : 1
    this._pendingStage = null

    const warmed = this._adoptWarmScene('compute-grid', panel)
    if (warmed) {
      this._gridView = warmed
      if (typeof this._gridView.setStage === 'function') {
        this._gridView.setStage(initialStage)
      }
    } else {
      this._getGridScene().then(({ ComputeGridScene }) => {
        this._gridView = new ComputeGridScene({
          panel,
          gridConfig: this.gridConfig,
          getThree: () => this._getThree(),
          initialStage
        })
      })
    }

    // Listen for protect complete event to advance to next slide
    const protectHandler = () => {
      if (this._deck) {
        this._deck.goTo(1)
      }
    }
    panel.addEventListener('protectComplete', protectHandler)

    // Listen for stage 2 advance request to go to next slide
    const stage2AdvanceHandler = () => {
      if (this._deck) {
        this._deck.goTo(2)
      }
    }
    panel.addEventListener('stage2AdvanceRequest', stage2AdvanceHandler)

    return () => {
      panel.removeEventListener('protectComplete', protectHandler)
      panel.removeEventListener('stage2AdvanceRequest', stage2AdvanceHandler)
      if (this._gridView) {
        this._gridView.destroy()
        this._gridView = null
      }
    }
  }

  _createHexSlide() {
    return {
      label: 'Compute Hex',
      panelKey: 'compute-hex',
      render: (panel) => this._renderHexSlide(panel),
      onEnter: () => {
        if (this._hexView && typeof this._hexView.playIntro === 'function') {
          this._hexView.playIntro()
        }
      }
    }
  }

  _renderHexSlide(panel) {
    const warmed = this._adoptWarmScene('compute-hex', panel)
    if (warmed) {
      this._hexView = warmed
    } else {
      this._getHexScene().then(({ ComputeHexScene }) => {
        this._hexView = new ComputeHexScene({
          panel,
          getThree: () => this._getThree()
        })
      })
    }

    return () => {
      if (this._hexView) {
        this._hexView.destroy()
        this._hexView = null
      }
    }
  }

  _preloadHexScene() {
    if (!this._deck || this._hexView) return
    this._getHexScene()
    this._deck.getPanelForSlide(this._hexSlideIndex, { mount: true })
  }

  _wrapDeckNavigation() {
    if (!this._deck || this._deckGoTo) return
    this._deckGoTo = this._deck.goTo.bind(this._deck)
    this._deck.goTo = (index, options = {}) => this._handleDeckGoTo(index, options)
  }

  _handleDeckGoTo(index, options = {}) {
    if (!this._deckGoTo || !this._deck) return
    if (options && options.immediate) {
      this._deckGoTo(index, options)
      return
    }

    const targetSlide = this.views[index]
    const gridStage = this._getGridStageForSlide(targetSlide, index)
    if (gridStage) {
      this._setGridStage(gridStage)
    }

    const fromIndex = this._deck.activeIndex

    // On stage 3 (entanglement slide, index 2), first click triggers entanglement animation
    // Second click advances to next slide
    if (fromIndex === 2 && index === 3 && this._gridView) {
      const triggered = this._gridView.triggerEntanglement()
      if (triggered) {
        // Animation was triggered, don't advance yet
        return
      }
      // Animation already done, proceed to next slide
    }

    if (fromIndex === this._hexSlideIndex && index === this._flowSlideIndex) {
      if (this._isFlowTransitioning) return
      this._isFlowTransitioning = true
      const flowConfig = this._flowConfig
      const handoff = this._hexView && typeof this._hexView.launchBallHandoff === 'function'
        ? this._hexView.launchBallHandoff({
          barHeightRatio: flowConfig.barHeightRatio,
          barYOffsetRatio: flowConfig.barYOffsetRatio,
          duration: flowConfig.handoffDuration,
          transitionFraction: flowConfig.transitionFraction,
          edgeOffsetRatio: flowConfig.handoffEdgeOffsetRatio,
          laneCount: flowConfig.laneCount
        })
        : null
      if (!handoff) {
        this._cancelFlowTransition()
        this._deckGoTo(index, options)
        return
      }
      this._flowHandoff = handoff.data || null
      const flowPanel = this._getFlowPanel()
      this._startFlowAnimation(flowPanel)
      const totalDelayMs = typeof handoff.totalDelayMs === 'number' ? handoff.totalDelayMs : 900
      this._flowTransitionTimer = window.setTimeout(() => {
        this._flowTransitionTimer = null
        this._isFlowTransitioning = false
        if (!this._deck) return
        this._deckGoTo(index, options)
      }, totalDelayMs)
      return
    }

    if (this._flowTransitionTimer) {
      this._cancelFlowTransition()
    }

    this._deckGoTo(index, options)
  }

  _getGridStageForSlide(slide, index) {
    if (!slide || slide.panelKey !== 'compute-grid') return null
    if (index === 0) return 1
    if (index === 1) return 2
    if (index === 2) return 3
    return null
  }

  _createFlowSlide() {
    return {
      label: 'Compute Flow',
      panelKey: 'compute-flow',
      render: (panel) => this._renderFlowSlide(panel),
      onEnter: ({ panel }) => {
        this._animateFlowSteps(panel)
        this._startFlowAnimation(panel)

        // Delay bottom section until balls turn blue (+ small offset)
        const { flowTravelDuration, sectionThreeStart } = this._flowConfig
        const bottomSectionDelay = (flowTravelDuration * sectionThreeStart) + 0.5

        if (this._flowStatsTimer) {
          clearTimeout(this._flowStatsTimer)
          this._flowStatsTimer = null
        }
        this._flowStatsTimer = setTimeout(() => {
          this._flowStatsTimer = null
          this._animateFlowStats(panel)
        }, bottomSectionDelay * 1000)
      },
      onExit: ({ panel }) => {
        this._cleanupFlowSlide(panel)
      }
    }
  }

  _renderFlowSlide(panel) {
    const offsetPercent = this._flowConfig.barYOffsetRatio * 100
    const barHeightPercent = this._flowConfig.barHeightRatio * 100
    const diagramOpacity = typeof this._flowConfig.flowDiagramOpacity === 'number'
      ? this._flowConfig.flowDiagramOpacity
      : 1
    const { greenDots, blueDots } = this._getFlowCodeDots()
    const template = window.ComputeTemplates && window.ComputeTemplates.getFlowMarkup
    panel.innerHTML = template
      ? template({ offsetPercent, barHeightPercent, diagramOpacity, greenDotsMarkup: greenDots, blueDotsMarkup: blueDots })
      : ''

    const warmed = this._adoptWarmScene('compute-flow', panel)
    if (warmed) {
      this._flowView = warmed
      this._flowViewPromise = Promise.resolve(warmed)
    } else {
      this._flowViewPromise = this._getFlowScene().then(({ ComputeFlowScene }) => {
        if (this._flowView) return this._flowView
        this._flowView = new ComputeFlowScene({
          panel,
          getThree: () => this._getThree()
        })
        return this._flowView
      })
    }

    return () => {
      this._stopFlowAnimation()
      this._cleanupFlowSlide(panel)
      if (this._flowView) {
        this._flowView.destroy()
        this._flowView = null
      }
      this._flowViewPromise = null
    }
  }

  _cleanupFlowSlide(panel) {
    if (this._flowStatsTimer) {
      clearTimeout(this._flowStatsTimer)
      this._flowStatsTimer = null
    }
    if (panel && window.gsap) {
      const nodes = panel.querySelectorAll('*')
      if (nodes.length) {
        window.gsap.killTweensOf(nodes)
      }
    }
  }

  _getFlowCodeDots() {
    // Green dots (logical qubits) - 1 row of 6
    let greenDots = ''
    for (let i = 0; i < 6; i += 1) {
      greenDots += `<span class="compute-flow-dot compute-flow-dot--green"></span>`
    }

    // Blue dots (physical qubits) - 6 rows of 8
    let blueDots = ''
    for (let row = 0; row < 6; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        blueDots += `<span class="compute-flow-dot compute-flow-dot--blue"></span>`
      }
    }

    return { greenDots, blueDots }
  }

  _adoptWarmScene(panelKey, panel) {
    const warmup = window.ShaderWarmup
    if (!warmup || typeof warmup.adopt !== 'function') return null
    const scene = warmup.adopt(panelKey, panel)
    if (scene && typeof scene._resizeRenderer === 'function') {
      scene._resizeRenderer()
    }
    return scene
  }

  _getFlowPanel() {
    if (!this._deck || typeof this._deck.getPanelForSlide !== 'function') return null
    return this._deck.getPanelForSlide(this._flowSlideIndex, { mount: true })
  }

  _cancelFlowTransition() {
    if (this._flowTransitionTimer) {
      clearTimeout(this._flowTransitionTimer)
      this._flowTransitionTimer = null
    }
    this._isFlowTransitioning = false
    this._flowHandoff = null
    this._stopFlowAnimation()
  }

  _startFlowAnimation(panel) {
    if (!panel) return

    this._startBinaryAnimation(panel)

    const startToken = this._flowStartToken + 1
    this._flowStartToken = startToken

    const startFlow = (flowView) => {
      if (!flowView || startToken !== this._flowStartToken) return
      if (typeof flowView.isActive === 'function' && flowView.isActive()) return
      flowView.start({
        flowConfig: this._flowConfig,
        handoff: this._flowHandoff
      })
    }

    if (this._flowView) {
      startFlow(this._flowView)
      return
    }

    const flowPromise = this._flowViewPromise || this._getFlowScene().then(({ ComputeFlowScene }) => {
      if (!panel.isConnected) return null
      this._flowView = new ComputeFlowScene({
        panel,
        getThree: () => this._getThree()
      })
      return this._flowView
    })

    this._flowViewPromise = flowPromise
    flowPromise.then(startFlow)
  }

  _startBinaryAnimation(panel) {
    this._stopBinaryAnimation()
    const binaryElements = panel.querySelectorAll('.compute-flow-arrow-binary p')
    if (!binaryElements.length) return

    const flipRandomBits = () => {
      binaryElements.forEach((el) => {
        const text = el.textContent
        const chars = text.split('')
        const flipsPerLine = Math.floor(Math.random() * 3) + 1
        for (let i = 0; i < flipsPerLine; i += 1) {
          const idx = Math.floor(Math.random() * chars.length)
          chars[idx] = chars[idx] === '0' ? '1' : '0'
        }
        el.textContent = chars.join('')
      })
    }

    this._binaryAnimInterval = window.setInterval(flipRandomBits, 150)
  }

  _stopBinaryAnimation() {
    if (this._binaryAnimInterval) {
      window.clearInterval(this._binaryAnimInterval)
      this._binaryAnimInterval = null
    }
  }

  _stopFlowAnimation() {
    this._stopBinaryAnimation()
    this._flowStartToken += 1
    if (this._flowView) {
      this._flowView.stop()
    }
  }

  _animateFlowStats(panel) {
    if (!panel || !window.gsap) return

    const bottomInfo = panel.querySelector('.compute-flow-info--bottom')
    const bottomDivider = panel.querySelector('.compute-flow-divider--bottom')
    const codeCard = panel.querySelector('.compute-flow-code-card')
    const greenDots = panel.querySelectorAll('.compute-flow-dot--green')
    const blueDots = panel.querySelectorAll('.compute-flow-dot--blue')
    const logicalLabel = panel.querySelector('.compute-flow-code-label--logical')
    const physicalLabel = panel.querySelector('.compute-flow-code-label--physical')
    const metrics = panel.querySelectorAll('.compute-flow-metric')
    const metricBars = panel.querySelectorAll('.compute-flow-metric-fill')

    // Set initial states
    gsap.set(bottomInfo, { opacity: 0, y: 20 })
    gsap.set(bottomDivider, { opacity: 0 })
    gsap.set(codeCard, { opacity: 0, scale: 0.9 })
    gsap.set([greenDots, blueDots], { scale: 0, opacity: 0 })
    gsap.set(logicalLabel, { opacity: 0, x: -30 })
    gsap.set(physicalLabel, { opacity: 0, x: -30 })
    gsap.set(metrics, { opacity: 0, y: 20 })

    // Store original widths
    metricBars.forEach(bar => {
      const originalWidth = bar.style.getPropertyValue('--metric-width')
      bar.dataset.targetWidth = originalWidth
      bar.style.setProperty('--metric-width', '0%')
    })

    // Animation timeline
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })

    // Bottom info and divider fade in first
    tl.to(bottomInfo, { opacity: 1, y: 0, duration: 0.6 })
    tl.to(bottomDivider, { opacity: 1, duration: 0.5 }, '-=0.5')

    // Card fades in
    tl.to(codeCard, { opacity: 1, scale: 1, duration: 0.6 }, '-=0.3')

    // Labels slide in
    tl.to(logicalLabel, { opacity: 1, x: 0, duration: 0.5 }, '-=0.3')
    tl.to(physicalLabel, { opacity: 1, x: 0, duration: 0.5 }, '-=0.4')

    // Green dots pop in with bounce
    tl.to(greenDots, {
      scale: 1,
      opacity: 1,
      duration: 0.5,
      stagger: 0.05,
      ease: 'back.out(2)'
    }, '-=0.3')

    // Blue dots cascade in
    tl.to(blueDots, {
      scale: 1,
      opacity: 1,
      duration: 0.4,
      stagger: {
        amount: 0.8,
        from: 'start',
        grid: [6, 8]
      },
      ease: 'back.out(1.5)'
    }, '-=0.4')

    // Metrics fade in
    tl.to(metrics, {
      opacity: 1,
      y: 0,
      duration: 0.5,
      stagger: 0.1
    }, '-=0.5')

    // Meter bars fill up one by one
    metricBars.forEach((bar, index) => {
      const targetWidth = bar.dataset.targetWidth
      tl.to(bar, {
        '--metric-width': targetWidth,
        duration: 1.2,
        ease: 'power2.out'
      }, index === 0 ? '-=0.3' : '-=0.9')
    })
  }

  _animateFlowSteps(panel) {
    const steps = panel.querySelectorAll('.compute-flow-steps .step')
    if (!steps.length || !window.gsap) return

    const { flowTravelDuration, sectionTwoStart, sectionThreeStart } = this._flowConfig

    // Set initial state
    gsap.set(steps, { opacity: 0, y: 10 })

    // Detect: fade in immediately
    gsap.to(steps[0], { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' })

    // Correct: fade in when balls turn green (2.4s)
    gsap.to(steps[1], {
      opacity: 1, y: 0, duration: 0.5, ease: 'power2.out',
      delay: flowTravelDuration * sectionTwoStart
    })

    // Compute: fade in when balls turn blue (4.8s)
    gsap.to(steps[2], {
      opacity: 1, y: 0, duration: 0.5, ease: 'power2.out',
      delay: flowTravelDuration * sectionThreeStart
    })
  }

  _setGridStage(stage) {
    if (this._gridView) {
      if (this._gridView.stage !== stage) {
        this._gridView.setStage(stage)
      }
    } else {
      this._pendingStage = stage
    }
  }

  _getThree() {
    if (!this._threePromise) {
      // Use bundled THREE from window (set by main.js)
      this._threePromise = Promise.resolve(window.THREE)
    }
    return this._threePromise
  }

  _getGridScene() {
    if (!this._gridScenePromise) {
      this._gridScenePromise = import('../scenes/ComputeGridScene.js')
    }
    return this._gridScenePromise
  }

  _getHexScene() {
    if (!this._hexScenePromise) {
      this._hexScenePromise = import('../scenes/ComputeHexScene.js')
    }
    return this._hexScenePromise
  }

  _getFlowScene() {
    if (!this._flowScenePromise) {
      this._flowScenePromise = import('../scenes/ComputeFlowScene.js')
    }
    return this._flowScenePromise
  }

  /**
   * Preload modules and assets to avoid hitches on first load.
   * Call this early (e.g., during app init) before user navigates to Compute tab.
   */
  preload() {
    // Trigger dynamic imports to cache the modules
    this._getGridScene()
    this._getHexScene()
    this._getFlowScene()

    // Prefetch Lottie animation JSON (used in stage 3 drag hint)
    fetch('./assets/animations/Animation - swipe left.json')
      .then(res => res.json())
      .catch(() => {})
  }
}

window.ComputeTab = ComputeTab
