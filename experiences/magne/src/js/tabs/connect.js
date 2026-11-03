class ConnectTab {
  constructor() {
    this.id = 'connect'
    this.title = 'Connect'
    this._deck = null
    this._fullstackLottie = null
    this._quNorthHandlers = null
    this._swipeHintDestroyTimer = null
    this.views = [
      {
        label: 'Connect Intro',
        html: this._quNorthPage(),
        onEnter: ({ panel }) => this._animateQuNorthIn(panel),
        onExit: ({ panel }) => this._animateQuNorthOut(panel)
      },
      {
        label: 'Connect Overview',
        html: this._magnePage(),
        onEnter: ({ panel }) => this._animateMagneIn(panel),
        onExit: ({ panel }) => this._animateMagneOut(panel)
      },
      {
        label: 'Connect Tools',
        html: this._qdkPage(),
        onEnter: ({ panel }) => this._animateQdkIn(panel),
        onExit: ({ panel }) => this._animateQdkOut(panel)
      },
      {
        label: 'Connect Stack',
        html: this._fullStackPage(),
        onEnter: ({ panel }) => this._animateFullStackIn(panel),
        onExit: ({ panel }) => this._animateFullStackOut(panel)
      }
    ]
  }

  _quNorthPage() {
    return window.ConnectTemplates ? window.ConnectTemplates.quNorthPage() : ''
  }

  _magnePage() {
    return window.ConnectTemplates ? window.ConnectTemplates.magnePage() : ''
  }

  _animateMagneIn(panel) {
    this._setConnectSlide(1)

    // Switch to Magne gradient (warmer bottom)
    const gradientBg = document.querySelector('#interactive-screen .gradient-bg')
    if (gradientBg) {
      gradientBg.classList.add('gradient-bg--magne')
    }

    const circle = panel.querySelector('.magne-circle')
    const ring = panel.querySelector('.magne-circle-ring')
    const videoWrap = panel.querySelector('.magne-video-wrap')
    const frame = panel.querySelector('.magne-video-frame')
    const title = panel.querySelector('.magne-title')
    const body = panel.querySelector('.magne-body')
    const specs = panel.querySelector('.magne-specs')
    const specColumns = panel.querySelectorAll('.specs-column')
    const swipeHint = panel.querySelector('.magne-swipe-hint')

    // Remove hidden class
    const hiddenEls = panel.querySelectorAll('.anim-hidden')
    hiddenEls.forEach(el => {
      el.classList.remove('anim-hidden')
      el.style.visibility = 'visible'
    })

    // Set initial states
    gsap.set(circle, { opacity: 0, scale: 0.8 })
    gsap.set(ring, { opacity: 0, scale: 0.9 })
    gsap.set(videoWrap, { opacity: 0, y: 30 })
    gsap.set([title, body], { opacity: 0, y: 20 })
    gsap.set(specs, { opacity: 0, y: 30 })
    gsap.set(specColumns, { opacity: 0, y: 20 })

    if (frame) {
      this._setupMagneInteraction(panel, circle, videoWrap, frame)
    }

    // Setup swipe hint Lottie animation
    if (swipeHint && window.lottie) {
      this._setupSwipeHint(swipeHint)
    }

    // Animate in
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })

    tl.to(circle, { opacity: 1, scale: 1, duration: 0.8 })
    .to(ring, { opacity: 1, scale: 1, duration: 0.6 }, '-=0.6')
    .to(videoWrap, { opacity: 1, y: 0, duration: 0.7 }, '-=0.5')
    .to(title, { opacity: 1, y: 0, duration: 0.5 }, '-=0.4')
    .to(body, { opacity: 1, y: 0, duration: 0.5 }, '-=0.3')
    .to(specs, { opacity: 1, y: 0, duration: 0.5 }, '-=0.3')
    .to(specColumns, {
      opacity: 1,
      y: 0,
      duration: 0.4,
      stagger: 0.1,
      ease: 'power2.out'
    }, '-=0.3')
    // Show swipe hint after main animation
    .call(() => this._showSwipeHint(), null, '-=0.2')
  }

  _setupSwipeHint(container) {
    // Clean up any existing animation
    this._hideSwipeHint()

    // Load Lottie animation
    this._swipeHintAnim = window.lottie.loadAnimation({
      container: container,
      renderer: 'svg',
      loop: true,
      autoplay: false,
      path: './assets/animations/Animation - swipe left.json'
    })
    this._swipeHintContainer = container
  }

  _showSwipeHint() {
    if (!this._swipeHintContainer || !this._swipeHintAnim) return

    // Show the container and play animation
    this._swipeHintContainer.classList.add('visible')
    this._swipeHintAnim.play()

    // Auto-hide after 5.5 seconds
    this._swipeHintTimeout = setTimeout(() => {
      this._hideSwipeHint()
    }, 5500)
  }

  _hideSwipeHint() {
    // Clear timeout if exists
    if (this._swipeHintTimeout) {
      clearTimeout(this._swipeHintTimeout)
      this._swipeHintTimeout = null
    }
    if (this._swipeHintDestroyTimer) {
      clearTimeout(this._swipeHintDestroyTimer)
      this._swipeHintDestroyTimer = null
    }

    // Fade out and stop animation
    if (this._swipeHintContainer) {
      this._swipeHintContainer.classList.remove('visible')
    }

    // Destroy Lottie animation after fade out
    if (this._swipeHintAnim) {
      const anim = this._swipeHintAnim
      this._swipeHintAnim = null
      this._swipeHintDestroyTimer = setTimeout(() => {
        anim.destroy()
        this._swipeHintDestroyTimer = null
      }, 400) // Match CSS transition duration
    }
  }

  _animateMagneOut(panel) {
    if (!panel) return

    // Revert to default gradient
    const gradientBg = document.querySelector('#interactive-screen .gradient-bg')
    if (gradientBg) {
      gradientBg.classList.remove('gradient-bg--magne')
    }

    const circle = panel.querySelector('.magne-circle')
    const specs = panel.querySelector('.magne-specs')

    // Clean up circle click handler
    if (this._magneScrubTarget && this._magnePointerDownHandler) {
      this._magneScrubTarget.removeEventListener('pointerdown', this._magnePointerDownHandler)
    }
    if (this._magneScrubTarget && this._magnePointerMoveHandler) {
      this._magneScrubTarget.removeEventListener('pointermove', this._magnePointerMoveHandler)
    }
    if (this._magneScrubTarget && this._magnePointerUpHandler) {
      this._magneScrubTarget.removeEventListener('pointerup', this._magnePointerUpHandler)
      this._magneScrubTarget.removeEventListener('pointercancel', this._magnePointerUpHandler)
      this._magneScrubTarget.removeEventListener('pointerleave', this._magnePointerUpHandler)
    }
    if (this._magneScrubTarget && this._magneTouchStartHandler) {
      this._magneScrubTarget.removeEventListener('touchstart', this._magneTouchStartHandler)
    }
    if (this._magneScrubTarget && this._magneTouchMoveHandler) {
      this._magneScrubTarget.removeEventListener('touchmove', this._magneTouchMoveHandler)
    }
    if (this._magneScrubLoopId) {
      cancelAnimationFrame(this._magneScrubLoopId)
      this._magneScrubLoopId = null
    }

    // Clean up swipe hint
    this._hideSwipeHint()

    const duration = 0.25

    gsap.to(circle, {
      opacity: 0,
      scale: 0.95,
      duration: duration,
      ease: 'power2.in'
    })

    gsap.to(specs, {
      opacity: 0,
      y: 20,
      duration: duration,
      ease: 'power2.in'
    })
  }

  _qdkPage() {
    return window.ConnectTemplates ? window.ConnectTemplates.qdkPage() : ''
  }

  _animateQdkIn(panel) {
    this._setConnectSlide(2)

    const intro = panel.querySelector('.qdk-intro')
    const logos = panel.querySelector('.qdk-logos')
    const qdkWindow = panel.querySelector('.qdk-window')
    const molecule = panel.querySelector('.qdk-molecule')
    const chemistryInfo = panel.querySelector('.qdk-chemistry-info')
    const accelerateInfo = panel.querySelector('.qdk-accelerate-info')

    // Set initial states FIRST (before making visible)
    if (intro) gsap.set(intro, { opacity: 0, y: 30, visibility: 'visible' })
    if (logos) gsap.set(logos, { opacity: 0, scale: 0.8, visibility: 'visible' })
    if (qdkWindow) gsap.set(qdkWindow, { opacity: 0, x: -50, visibility: 'visible' })
    if (molecule) gsap.set(molecule, { opacity: 0, scale: 0.8, visibility: 'visible' })
    if (chemistryInfo) gsap.set(chemistryInfo, { opacity: 0, x: 50, visibility: 'visible' })
    if (accelerateInfo) gsap.set(accelerateInfo, { opacity: 0, y: 30, visibility: 'visible' })

    // Remove hidden class after setting initial states
    const hiddenEls = panel.querySelectorAll('.anim-hidden')
    hiddenEls.forEach(el => {
      el.classList.remove('anim-hidden')
    })

    // Animate in
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })

    if (intro) tl.to(intro, { opacity: 1, y: 0, duration: 0.6 })
    if (logos) tl.to(logos, { opacity: 1, scale: 1, duration: 0.5 }, '-=0.4')
    if (qdkWindow) tl.to(qdkWindow, { opacity: 1, x: 0, duration: 0.7 }, '-=0.3')
    if (molecule) tl.to(molecule, { opacity: 1, scale: 1, duration: 0.8 }, '-=0.5')
    if (chemistryInfo) tl.to(chemistryInfo, { opacity: 1, x: 0, duration: 0.6 }, '-=0.5')
    if (accelerateInfo) tl.to(accelerateInfo, { opacity: 1, y: 0, duration: 0.5 }, '-=0.3')
  }

  _animateQdkOut(panel) {
    if (!panel) return

    const intro = panel.querySelector('.qdk-intro')
    const logos = panel.querySelector('.qdk-logos')
    const qdkWindow = panel.querySelector('.qdk-window')
    const molecule = panel.querySelector('.qdk-molecule')
    const chemistryInfo = panel.querySelector('.qdk-chemistry-info')
    const accelerateInfo = panel.querySelector('.qdk-accelerate-info')

    const duration = 0.25

    const introGroup = [intro, logos].filter(Boolean)
    if (introGroup.length) {
      gsap.to(introGroup, {
        opacity: 0,
        y: -20,
        duration: duration,
        ease: 'power2.in'
      })
    }

    if (qdkWindow) {
      gsap.to(qdkWindow, {
        opacity: 0,
        x: -30,
        duration: duration,
        ease: 'power2.in'
      })
    }

    if (molecule) {
      gsap.to(molecule, {
        opacity: 0,
        scale: 0.9,
        duration: duration,
        ease: 'power2.in'
      })
    }

    const infoGroup = [chemistryInfo, accelerateInfo].filter(Boolean)
    if (infoGroup.length) {
      gsap.to(infoGroup, {
        opacity: 0,
        y: 20,
        duration: duration,
        ease: 'power2.in'
      })
    }
  }

  _animateQuNorthIn(panel) {
    // Store panel reference for exit animation
    this._quNorthPanel = panel
    this._locationRevealed = false

    // Show global map on first slide
    this._setConnectSlide(0)

    // Elements are now in the global containers
    const globalQuNorth = document.getElementById('globalQuNorth')
    const dot = document.querySelector('.global-locator-dot')
    const title = globalQuNorth?.querySelector('.qunorth-title')
    const subtitle = globalQuNorth?.querySelector('.qunorth-subtitle')
    const body = globalQuNorth?.querySelector('.qunorth-body')
    const locationSection = globalQuNorth?.querySelector('.qunorth-location')

    // Reset location section to hidden state
    if (locationSection) {
      locationSection.classList.remove('location-visible')
      locationSection.classList.add('location-hidden')
      const locImage = locationSection.querySelector('.location-image')
      const locInfo = locationSection.querySelector('.location-info')
      gsap.killTweensOf([locationSection, locImage, locInfo])
      gsap.set(locationSection, { opacity: 0, y: 20 })
      gsap.set([locImage, locInfo], { clearProps: 'all' })
    }

    // Kill any existing tweens and timeline
    if (this._quNorthTimeline) {
      this._quNorthTimeline.kill()
      this._quNorthTimeline = null
    }
    gsap.killTweensOf([title, subtitle, body, dot])
    gsap.set([title, subtitle, body], { opacity: 0, y: 30 })
    gsap.set(dot, { opacity: 0, scale: 1 })

    // Create timeline and store reference
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
    this._quNorthTimeline = tl

    // Animate title
    tl.to(title, {
      opacity: 1,
      y: 0,
      duration: 0.6
    }, 0.4)

    // Animate subtitle
    .to(subtitle, {
      opacity: 1,
      y: 0,
      duration: 0.5
    }, '-=0.4')

    // Animate body text
    .to(body, {
      opacity: 1,
      y: 0,
      duration: 0.5
    }, '-=0.3')

    // Show dot (add class first, then fade in)
    .call(() => dot?.classList.add('dot-visible'), null, '-=0.3')
    .to(dot, {
      opacity: 1,
      duration: 0.5,
      ease: 'power2.out'
    }, '-=0.3')

    // Add touch/hover interactions
    this._setupQuNorthInteractions()
  }

  _animateQuNorthOut(panel) {
    this._teardownQuNorthInteractions()

    // Kill the entrance timeline to prevent delayed animations from running
    if (this._quNorthTimeline) {
      this._quNorthTimeline.kill()
      this._quNorthTimeline = null
    }

    // Hide global map when leaving first slide
    this._setConnectSlide(null)

    // Clear the location timeout if it exists
    if (this._locationTimeout) {
      clearTimeout(this._locationTimeout)
      this._locationTimeout = null
    }

    // Elements are in global containers
    const globalQuNorth = document.getElementById('globalQuNorth')
    const dot = document.querySelector('.global-locator-dot')
    const title = globalQuNorth?.querySelector('.qunorth-title')
    const subtitle = globalQuNorth?.querySelector('.qunorth-subtitle')
    const body = globalQuNorth?.querySelector('.qunorth-body')
    const locationSection = globalQuNorth?.querySelector('.qunorth-location')

    // Quick exit animation - needs to complete during slide transition (0.6s)
    const duration = 0.25

    // All elements fade out and scale down quickly
    gsap.to([title, subtitle, body], {
      opacity: 0,
      y: -30,
      duration: duration,
      ease: 'power2.in',
      stagger: 0.03
    })

    if (locationSection) {
      gsap.to(locationSection, {
        opacity: 0,
        y: 30,
        duration: duration,
        ease: 'power2.in'
      })
    }

    gsap.to(dot, {
      opacity: 0,
      duration: duration * 0.8,
      ease: 'power2.in',
      onComplete: () => dot?.classList.remove('dot-visible')
    })
  }

  _setConnectSlide(index) {
    const interactiveScreen = document.getElementById('interactive-screen')
    if (interactiveScreen) {
      if (index === null || index === undefined) {
        delete interactiveScreen.dataset.connectSlide
      } else {
        interactiveScreen.dataset.connectSlide = String(index)
      }
    }

    // Always hide the dot when not on slide 0
    if (index !== 0) {
      const dot = document.querySelector('.global-locator-dot')
      if (dot) {
        dot.classList.remove('dot-visible')
        if (window.gsap) {
          gsap.killTweensOf(dot)
          gsap.set(dot, { opacity: 0, scale: 0 })
        }
      }
    }
  }

  _setupMagneInteraction(panel, circle, videoWrap, frame) {
    if (!videoWrap || !frame) return

    const target = videoWrap
    const frameCount = 720
    const dragScale = 0.6
    const velocityScale = 0.6
    const minVelocity = 5
    const maxVelocity = 1200
    let isDragging = false
    let startX = 0
    let lastX = 0
    let lastTime = 0
    let targetVelocity = 0
    let currentVelocity = 0
    let lastLoopTime = 0
    let lastVelocity = 0
    let startFrame = 1
    let frameIndex = 1
    let activePointerId = null
    let pointerCount = 0
    let multitouchActive = false
    const frameCache = new Map()

    const framePath = index => `assets/images/connect/turntable/frame_${String(index).padStart(4, '0')}.png`

    const normalizeFrame = value => {
      const rounded = Math.round(value)
      const wrapped = ((rounded - 1) % frameCount + frameCount) % frameCount
      return wrapped + 1
    }

    // Preload all frames for buttery smooth rotation
    const preloadAllFrames = () => {
      let loaded = 0
      const loadPromises = []

      for (let i = 1; i <= frameCount; i++) {
        const promise = new Promise((resolve) => {
          const img = new Image()
          img.decoding = 'async'
          img.onload = () => {
            frameCache.set(i, img)
            loaded++
            resolve()
          }
          img.onerror = () => {
            resolve() // Continue even if frame fails
          }
          img.src = framePath(i)
        })
        loadPromises.push(promise)
      }

      return Promise.all(loadPromises)
    }

    const setFrame = index => {
      const normalized = normalizeFrame(index)
      if (frame.dataset.frame !== String(normalized)) {
        const cachedImg = frameCache.get(normalized)
        if (cachedImg && cachedImg.complete) {
          frame.src = cachedImg.src
          frame.dataset.frame = String(normalized)
        }
      }
    }

    // Start preloading all frames immediately
    preloadAllFrames()

    const onPointerDown = event => {
      // Hide swipe hint when user starts interacting
      this._hideSwipeHint()

      if (event.pointerType === 'mouse' && event.button !== 0) return
      if (!event.isPrimary) return
      pointerCount += 1
      if (pointerCount > 1) {
        multitouchActive = true
        activePointerId = null
        isDragging = false
        targetVelocity = 0
        currentVelocity = 0
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (activePointerId !== null) return
      event.preventDefault()
      event.stopPropagation()
      isDragging = true
      activePointerId = event.pointerId
      startX = event.clientX
      lastX = event.clientX
      lastTime = performance.now()
      startFrame = frameIndex
      target.setPointerCapture(event.pointerId)

      if (!this._magneScrubLoopId) {
        lastLoopTime = performance.now()
        this._magneScrubLoopId = requestAnimationFrame(scrubLoop)
      }
    }

    const onPointerMove = event => {
      if (!isDragging) return
      if (multitouchActive) return
      if (event.pointerId !== activePointerId) return
      event.preventDefault()
      const now = performance.now()
      const deltaX = event.clientX - lastX
      const deltaT = Math.max(now - lastTime, 8)
      const velocity = deltaX / deltaT
      lastVelocity = velocity
      const speed = Math.min(maxVelocity, Math.max(minVelocity, Math.abs(velocity) * 1000 * velocityScale))
      targetVelocity = Math.abs(velocity) < 0.01 ? 0 : speed * Math.sign(velocity)
      frameIndex = startFrame + (event.clientX - startX) * dragScale
      setFrame(frameIndex)
      lastX = event.clientX
      lastTime = now
    }

    const onPointerUp = event => {
      pointerCount = Math.max(0, pointerCount - 1)
      if (pointerCount === 0) {
        multitouchActive = false
      }
      if (!isDragging) return
      if (multitouchActive) return
      if (event.pointerId !== activePointerId) return
      event.preventDefault()
      isDragging = false
      activePointerId = null
      const velocity = lastVelocity
      const speed = Math.min(maxVelocity, Math.max(minVelocity, Math.abs(velocity) * 1000 * velocityScale))
      targetVelocity = Math.abs(velocity) < 0.02 ? 0 : speed * Math.sign(velocity)
      target.releasePointerCapture(event.pointerId)
    }

    const onTouchStart = event => {
      if (event.touches && event.touches.length > 1) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    const onTouchMove = event => {
      if (event.touches && event.touches.length > 1) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    const scrubLoop = () => {
      const now = performance.now()
      const deltaSeconds = Math.max((now - lastLoopTime) / 1000, 0)
      lastLoopTime = now

      if (!isDragging && Math.abs(currentVelocity) < 0.001) {
        this._magneScrubLoopId = null
        return
      }

      currentVelocity += (targetVelocity - currentVelocity) * 0.2
      if (!isDragging) {
        targetVelocity *= 0.94
        if (Math.abs(targetVelocity) < 1) targetVelocity = 0
      }
      if (Math.abs(currentVelocity) < 0.5) {
        currentVelocity = 0
      } else {
        frameIndex += currentVelocity * deltaSeconds
        setFrame(frameIndex)
      }

      this._magneScrubLoopId = requestAnimationFrame(scrubLoop)
    }

    target.addEventListener('pointerdown', onPointerDown)
    target.addEventListener('pointermove', onPointerMove)
    target.addEventListener('pointerup', onPointerUp)
    target.addEventListener('pointercancel', onPointerUp)
    target.addEventListener('pointerleave', onPointerUp)
    target.addEventListener('touchstart', onTouchStart, { passive: false })
    target.addEventListener('touchmove', onTouchMove, { passive: false })

    setFrame(frameIndex)

    this._magnePointerDownHandler = onPointerDown
    this._magnePointerMoveHandler = onPointerMove
    this._magnePointerUpHandler = onPointerUp
    this._magneTouchStartHandler = onTouchStart
    this._magneTouchMoveHandler = onTouchMove
    this._magneScrubTarget = target
    this._magneCircle = circle
  }

  _setupQuNorthInteractions() {
    this._teardownQuNorthInteractions()

    const globalQuNorth = document.getElementById('globalQuNorth')
    const locationImage = globalQuNorth?.querySelector('.location-image')
    const dot = document.querySelector('.global-locator-dot')
    const locationSection = globalQuNorth?.querySelector('.qunorth-location')
    this._quNorthHandlers = {}

    // Image hover/touch effect
    if (locationImage) {
      const onPointerEnter = () => {
        gsap.to(locationImage, {
          scale: 1.03,
          duration: 0.3,
          ease: 'power2.out'
        })
      }

      const onPointerLeave = () => {
        gsap.to(locationImage, {
          scale: 1,
          duration: 0.3,
          ease: 'power2.out'
        })
      }

      const onPointerDown = () => {
        gsap.to(locationImage, {
          scale: 0.98,
          duration: 0.15
        })
      }

      const onPointerUp = () => {
        gsap.to(locationImage, {
          scale: 1.03,
          duration: 0.15
        })
      }

      locationImage.addEventListener('pointerenter', onPointerEnter)
      locationImage.addEventListener('pointerleave', onPointerLeave)
      locationImage.addEventListener('pointerdown', onPointerDown)
      locationImage.addEventListener('pointerup', onPointerUp)

      this._quNorthHandlers.locationImage = {
        onPointerEnter,
        onPointerLeave,
        onPointerDown,
        onPointerUp
      }
    }

    // Dot tap - reveal location section
    if (dot && locationSection) {
      const revealLocation = () => {
        // Reveal location section on tap
        if (!this._locationRevealed) {
          this._locationRevealed = true
          locationSection.classList.remove('location-hidden')
          locationSection.classList.add('location-visible')

          // Hide the dot immediately - kill any running animations first
          gsap.killTweensOf(dot)
          dot.classList.remove('dot-visible')
          gsap.set(dot, { opacity: 0, scale: 0 })

          // Animate the content in
          const locImage = locationSection.querySelector('.location-image')
          const locInfo = locationSection.querySelector('.location-info')

          gsap.fromTo(locImage,
            { opacity: 0, x: -40 },
            { opacity: 1, x: 0, duration: 0.6, ease: 'power2.out' }
          )
          gsap.fromTo(locInfo,
            { opacity: 0, x: 40 },
            { opacity: 1, x: 0, duration: 0.6, delay: 0.1, ease: 'power2.out' }
          )

          // After 30 seconds, hide location and show dot again
          this._locationTimeout = setTimeout(() => {
            if (!this._locationRevealed) return

            // Animate location out
            gsap.to(locImage, {
              opacity: 0,
              x: -40,
              duration: 0.5,
              ease: 'power2.in'
            })
            gsap.to(locInfo, {
              opacity: 0,
              x: 40,
              duration: 0.5,
              ease: 'power2.in',
              onComplete: () => {
                locationSection.classList.remove('location-visible')
                locationSection.classList.add('location-hidden')
              }
            })

            // Show dot again
            dot.classList.add('dot-visible')
            gsap.to(dot, {
              opacity: 1,
              scale: 1,
              duration: 0.5,
              delay: 0.3,
              ease: 'back.out(2)'
            })

            this._locationRevealed = false
          }, 30000)
        }
      }

      // Mark dot to ignore swipe detection
      dot.setAttribute('data-swipe-ignore', 'true')

      // Prevent slideshow swipe without changing dot size/position
      const onPointerDown = (e) => {
        e.stopPropagation()
      }

      const onPointerUp = (e) => {
        e.stopPropagation()
      }

      // Use click for the actual reveal action - stop propagation
      const onClick = (e) => {
        e.stopPropagation()
        revealLocation()
      }

      // Also support touch - stop propagation
      const onTouchStart = (e) => {
        e.stopPropagation()
      }
      const onTouchEnd = (e) => {
        e.preventDefault()
        e.stopPropagation()
        revealLocation()
      }

      dot.addEventListener('pointerdown', onPointerDown)
      dot.addEventListener('pointerup', onPointerUp)
      dot.addEventListener('click', onClick)
      dot.addEventListener('touchstart', onTouchStart)
      dot.addEventListener('touchend', onTouchEnd)

      this._quNorthHandlers.dot = {
        onPointerDown,
        onPointerUp,
        onClick,
        onTouchStart,
        onTouchEnd
      }
    }
  }

  _teardownQuNorthInteractions() {
    if (!this._quNorthHandlers) return

    const globalQuNorth = document.getElementById('globalQuNorth')
    const locationImage = globalQuNorth?.querySelector('.location-image')
    const dot = document.querySelector('.global-locator-dot')

    const locationHandlers = this._quNorthHandlers.locationImage
    if (locationImage && locationHandlers) {
      locationImage.removeEventListener('pointerenter', locationHandlers.onPointerEnter)
      locationImage.removeEventListener('pointerleave', locationHandlers.onPointerLeave)
      locationImage.removeEventListener('pointerdown', locationHandlers.onPointerDown)
      locationImage.removeEventListener('pointerup', locationHandlers.onPointerUp)
    }

    const dotHandlers = this._quNorthHandlers.dot
    if (dot && dotHandlers) {
      dot.removeEventListener('pointerdown', dotHandlers.onPointerDown)
      dot.removeEventListener('pointerup', dotHandlers.onPointerUp)
      dot.removeEventListener('click', dotHandlers.onClick)
      dot.removeEventListener('touchstart', dotHandlers.onTouchStart)
      dot.removeEventListener('touchend', dotHandlers.onTouchEnd)
    }

    this._quNorthHandlers = null
  }

  render(container, options = {}) {
    if (this._deck) {
      this._deck.destroy()
      this._deck = null
    }

    this._onSwitchTab = options.onSwitchTab || null

    container.innerHTML = `<div class="tab-slides"></div>`
    const deckHost = container.querySelector('.tab-slides')
    this._deck = new Slideshow({
      container: deckHost,
      slides: this.views,
      initialIndex: 0,
      unmountInactive: true,
      useSwipe: false,
      onOverflowNext: () => {
        // Switch to Compute tab when swiping past last Connect slide
        if (this._onSwitchTab) {
          this._onSwitchTab('compute')
        }
      }
    })
  }

  _fullStackPage() {
    return window.ConnectTemplates ? window.ConnectTemplates.fullStackPage() : ''
  }

  // Tooltip content
  _getTooltipContent() {
    return {
      devtools: {
        title: 'The Quantum Development Kit (QDK)',
        body: "Microsoft's open-source developer toolkit for building quantum applications. It provides everything needed to build, simulate, and execute quantum code, both locally and on quantum hardware. "
      },
      os: {
        title: 'Quantum operating system',
        body: 'An operating system built for quantum.<br>A platform that integrates wide support, customizable readout, and enterprise administrative tools.'
      },
      engine: {
        title: 'Quantum engine',
        body: 'The Microsoft quantum engine orchestrates quantum hardware, integrating advanced error correction techniques to detect and correct physical qubit errors in real time for reliable, scalable quantum computation.'
      }
    }
  }

  // Build the exact layout from reference
  _buildFullstackLayout(container, activeTooltip = null) {
    container.innerHTML = ''

    // 4-column grid system - null = empty space, color = visible dot
    // Each row must have exactly 4 entries to maintain grid alignment
    // Colors match reference: blue=#0078D4, purple=#8661C5, teal=#49C5B1, gray-light=#D9D9D6, white=#FFFFFF
    const layout = [
      // Application section (top endpoint)
      { type: 'label', text: 'Applications', align: 'center' },
      { type: 'dots', pattern: ['blue', 'purple', 'gray-light', 'teal'], origin: 'top' },
      { type: 'dots', pattern: ['white', 'gray-light', 'blue', null], origin: 'top' },

      // Development tools section
      { type: 'layer', text: 'Development tools', dot: 'blue', align: 'left' },
      { type: 'tooltip-slot', id: 'devtools' },
      { type: 'dots', pattern: ['white', 'white', 'teal', 'purple'], origin: 'top' },
      { type: 'dots', pattern: [null, 'white', 'purple', 'white'], origin: 'top' },

      // Operating system section
      { type: 'layer', text: 'Operating system', dot: 'purple', align: 'right' },
      { type: 'tooltip-slot', id: 'os' },
      { type: 'dots', pattern: ['teal', 'white', 'gray-light', 'white'], origin: 'bottom' },
      { type: 'dots', pattern: ['teal', 'gray-light', 'white', null], origin: 'bottom' },

      // Quantum engine section
      { type: 'layer', text: 'Quantum engine', dot: 'teal', align: 'left' },
      { type: 'tooltip-slot', id: 'engine' },
      { type: 'dots', pattern: [null, 'gray-light', 'white', null], origin: 'bottom' },
      { type: 'dots', pattern: [null, null, 'white', null], origin: 'bottom' },

      // Qubits section (bottom endpoint)
      { type: 'label', text: 'Qubits', align: 'center' },
    ]

    const tooltipContent = this._getTooltipContent()
    const elements = { labels: [], layers: [], dots: [], tooltips: [] }

    layout.forEach((item, index) => {
      const row = document.createElement('div')
      row.className = 'fs-row'
      row.dataset.index = index

      if (item.type === 'label') {
        row.classList.add('fs-row-label')
        const label = document.createElement('span')
        label.className = 'fs-label-endpoint'
        label.textContent = item.text
        row.appendChild(label)
        elements.labels.push(label)
      }
      else if (item.type === 'layer') {
        row.classList.add('fs-row-layer')
        const layerKey = item.text.toLowerCase().replace(/ /g, '-')
        row.dataset.layerType = layerKey // Add to parent row for CSS targeting

        const labelRow = document.createElement('div')
        labelRow.className = 'fs-label-row'
        labelRow.dataset.layer = layerKey

        // Create text element
        const text = document.createElement('span')
        text.className = 'fs-label-text'
        text.textContent = item.text

        // Create dot element
        const dot = document.createElement('div')
        dot.className = `fs-dot ${item.dot}`

        // Order depends on alignment
        if (item.align === 'left') {
          labelRow.appendChild(text)
          labelRow.appendChild(dot)
        } else {
          labelRow.appendChild(dot)
          labelRow.appendChild(text)
        }

        row.appendChild(labelRow)
        elements.layers.push(labelRow)
      }
      else if (item.type === 'dots') {
        row.classList.add('fs-row-dots')
        row.dataset.origin = item.origin
        const dotRow = document.createElement('div')
        dotRow.className = 'fs-dot-row'

        // Create dots at fixed column positions (1-indexed)
        item.pattern.forEach((color, colIndex) => {
          if (color === null) return // Skip empty columns

          const dot = document.createElement('div')
          dot.className = `fs-dot ${color} col-${colIndex + 1}`
          elements.dots.push({ el: dot, origin: item.origin })
          dotRow.appendChild(dot)
        })

        row.appendChild(dotRow)
      }
      else if (item.type === 'tooltip-slot') {
        row.classList.add('fs-row-tooltip')
        row.dataset.tooltipId = item.id

        // Always render tooltip content, visibility controlled by CSS/JS
        const content = tooltipContent[item.id]
        const tooltip = document.createElement('div')
        tooltip.className = `fs-tooltip fs-tooltip-${item.id}`

        const title = document.createElement('h4')
        title.className = 'fs-tooltip-title'
        title.textContent = content.title

        const body = document.createElement('p')
        body.className = 'fs-tooltip-body'
        body.innerHTML = content.body

        tooltip.appendChild(title)
        tooltip.appendChild(body)
        row.appendChild(tooltip)
        elements.tooltips.push({ el: tooltip, id: item.id, row: row })
      }

      container.appendChild(row)
    })

    return elements
  }

  _animateFullStackIn(panel) {
    this._setConnectSlide(3)

    if (this._fullstackRaf) {
      cancelAnimationFrame(this._fullstackRaf)
      this._fullstackRaf = null
    }
    if (this._fullstackTimeline) {
      this._fullstackTimeline.kill()
      this._fullstackTimeline = null
    }
    if (this._tooltipCycleTimeout) {
      clearTimeout(this._tooltipCycleTimeout)
      this._tooltipCycleTimeout = null
    }
    if (this._tooltipCycleRestartTimeout) {
      clearTimeout(this._tooltipCycleRestartTimeout)
      this._tooltipCycleRestartTimeout = null
    }
    if (this._fullstackClickHandlers) {
      this._fullstackClickHandlers.forEach(({ el, handler }) => {
        el.removeEventListener('click', handler)
      })
      this._fullstackClickHandlers = null
    }

    this._fullstackPanel = panel
    this._activeTooltip = null // Start with no tooltip visible

    const container = panel.querySelector('.fs-stack-content')
    const footer = panel.querySelector('.fs-footer')
    if (!container) return

    // Build initial layout
    const elements = this._buildFullstackLayout(container, this._activeTooltip)

    // Get the label elements and their parent rows
    const applicationLabel = elements.labels[0]
    const qubitsLabel = elements.labels[1]
    const applicationRow = applicationLabel?.closest('.fs-row')
    const qubitsRow = qubitsLabel?.closest('.fs-row')

    // Hide everything initially
    gsap.set(elements.labels, { opacity: 0 })
    gsap.set(elements.layers, { opacity: 0 })
    elements.layers.forEach(layer => {
      const text = layer.querySelector('.fs-label-text')
      const dot = layer.querySelector('.fs-dot')
      if (text) gsap.set(text, { x: layer.dataset.layer?.includes('operating') ? 50 : -50 })
      if (dot) gsap.set(dot, { scale: 0 })
    })
    elements.dots.forEach(d => gsap.set(d.el, { opacity: 0 }))
    // Hide all tooltips and collapse their rows initially
    elements.tooltips.forEach(t => {
      gsap.set(t.el, { opacity: 0 })
      gsap.set(t.row, { height: 0, overflow: 'hidden' })
    })
    if (footer) {
      footer.classList.remove('anim-hidden')
      gsap.set(footer, { opacity: 0, y: 30, visibility: 'visible' })
    }

    // Store tooltip elements for later animation
    this._tooltipElements = elements.tooltips

    // Calculate how far to move labels to center them
    // After layout is built, measure positions
    this._fullstackRaf = requestAnimationFrame(() => {
      this._fullstackRaf = null
      const containerRect = container.getBoundingClientRect()
      const containerCenter = containerRect.height / 2

      const appRect = applicationRow?.getBoundingClientRect()
      const qubitsRect = qubitsRow?.getBoundingClientRect()
      const labelHeight = appRect?.height || 40

      // Calculate offsets to move both labels to center, stacked vertically
      // Application sits just above center, Qubits just below
      const appOffset = containerCenter - (appRect ? (appRect.top - containerRect.top + appRect.height / 2) : 0) - labelHeight / 2
      const qubitsOffset = containerCenter - (qubitsRect ? (qubitsRect.top - containerRect.top + qubitsRect.height / 2) : 0) + labelHeight / 2

      // Position labels at center, stacked
      gsap.set(applicationLabel, { opacity: 1, y: appOffset })
      gsap.set(qubitsLabel, { opacity: 1, y: qubitsOffset })

      // Animation timeline
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
      this._fullstackTimeline = tl

      // Bring in footer text immediately
      if (footer) {
        tl.to(footer, { opacity: 1, y: 0, duration: 0.5 }, 0)
      }

      // Step 1: Pause with Application and Qubits centered together
      tl.to({}, { duration: 1 })

      // Step 2: Move labels to their final positions
      tl.to(applicationLabel, { y: 0, duration: 0.8, ease: 'power2.inOut' })
        .to(qubitsLabel, { y: 0, duration: 0.8, ease: 'power2.inOut' }, '<')

      // Step 3: Dots animate in from top and bottom in pairs of 2
      // Group dots by their parent row first
      const dotRows = new Map()
      elements.dots.forEach(d => {
        const row = d.el.closest('.fs-dot-row')
        if (!dotRows.has(row)) {
          dotRows.set(row, { dots: [], origin: d.origin })
        }
        dotRows.get(row).dots.push(d.el)
      })

      // Create pairs of adjacent dots within each row
      const createPairs = (rowData) => {
        const pairs = []
        const dots = rowData.dots
        const origin = rowData.origin

        // Sort dots by column position
        dots.sort((a, b) => {
          const colA = parseInt(a.className.match(/col-(\d)/)?.[1] || 0)
          const colB = parseInt(b.className.match(/col-(\d)/)?.[1] || 0)
          return colA - colB
        })

        // Group into pairs of adjacent dots
        let i = 0
        while (i < dots.length) {
          if (i + 1 < dots.length) {
            const col1 = parseInt(dots[i].className.match(/col-(\d)/)?.[1] || 0)
            const col2 = parseInt(dots[i + 1].className.match(/col-(\d)/)?.[1] || 0)
            // Check if they're adjacent (columns differ by 1)
            if (col2 - col1 === 1) {
              pairs.push({ dots: [dots[i], dots[i + 1]], origin })
              i += 2
              continue
            }
          }
          // Single dot (no adjacent partner)
          pairs.push({ dots: [dots[i]], origin })
          i++
        }
        return pairs
      }

      // Create all pairs
      let allPairs = []
      dotRows.forEach(rowData => {
        allPairs = allPairs.concat(createPairs(rowData))
      })

      // Separate by origin and shuffle
      const topPairs = allPairs.filter(p => p.origin === 'top')
      const bottomPairs = allPairs.filter(p => p.origin === 'bottom')
      const shuffle = arr => arr.sort(() => Math.random() - 0.5)
      shuffle(topPairs)
      shuffle(bottomPairs)

      // Set initial positions (off-screen)
      topPairs.forEach(p => gsap.set(p.dots, { opacity: 0, y: -80 }))
      bottomPairs.forEach(p => gsap.set(p.dots, { opacity: 0, y: 80 }))

      // Animate pairs coming in
      const allShuffled = []
      const maxLen = Math.max(topPairs.length, bottomPairs.length)
      for (let i = 0; i < maxLen; i++) {
        if (topPairs[i]) allShuffled.push(topPairs[i])
        if (bottomPairs[i]) allShuffled.push(bottomPairs[i])
      }

      allShuffled.forEach((pair, i) => {
        tl.to(pair.dots, {
          opacity: 1,
          y: 0,
          duration: 0.6,
          ease: 'power3.out'
        }, i === 0 ? '-=0.4' : '-=0.55')
      })

      // Step 4: Layer labels slide in
      elements.layers.forEach((layer, i) => {
        const text = layer.querySelector('.fs-label-text')
        const dot = layer.querySelector('.fs-dot')

        tl.to(layer, { opacity: 1, duration: 0.3 }, '-=0.4')
        if (text) tl.to(text, { x: 0, duration: 0.4, ease: 'power2.out' }, '<')
        if (dot) tl.to(dot, { scale: 1, duration: 0.3, ease: 'back.out(2)' }, '-=0.2')
      })

      // Step 5: First tooltip comes in (2 sec delay after layers)
      tl.call(() => this._showTooltip(panel, container, 'devtools'), null, '+=1.7')

      // Setup interactions
      this._setupFullstackInteractions(panel, container)

      // Start auto-cycle after animation completes
      tl.call(() => this._startTooltipCycle(panel, container))
    })
  }

  _setupFullstackInteractions(panel, container) {
    this._fullstackClickHandlers = []
    this._fullstackLabelTimeouts = new Map()

    const layers = container.querySelectorAll('.fs-label-row')
    layers.forEach(layer => {
      const text = layer.querySelector('.fs-label-text')
      if (!text) return

      const layerName = layer.dataset.layer
      let tooltipId = null
      if (layerName?.includes('development')) tooltipId = 'devtools'
      else if (layerName?.includes('operating')) tooltipId = 'os'
      else if (layerName?.includes('quantum')) tooltipId = 'engine'

      if (!tooltipId) return

      const handler = () => {
        this._showTooltip(panel, container, tooltipId)
        this._resetTooltipCycle(panel, container)
        this._flashFullstackLabel(text)
      }

      text.addEventListener('click', handler)
      this._fullstackClickHandlers.push({ el: text, handler })
    })
  }

  _flashFullstackLabel(label) {
    if (!label) return
    label.classList.add('is-active')

    const existing = this._fullstackLabelTimeouts?.get(label)
    if (existing) clearTimeout(existing)

    const timeoutId = setTimeout(() => {
      label.classList.remove('is-active')
      this._fullstackLabelTimeouts?.delete(label)
    }, 350)

    this._fullstackLabelTimeouts?.set(label, timeoutId)
  }

  _showTooltip(panel, container, tooltipId) {
    if (this._activeTooltip === tooltipId) return

    const tooltips = this._tooltipElements
    if (!tooltips) return

    if (this._tooltipTimeline) {
      this._tooltipTimeline.kill()
      this._tooltipTimeline = null
    }

    // Ensure any non-active tooltips are fully hidden
    tooltips.forEach(t => {
      if (t.id !== this._activeTooltip) {
        gsap.set(t.el, { opacity: 0, y: 0 })
        gsap.set(t.row, { height: 0, overflow: 'hidden' })
      }
    })

    const tl = gsap.timeline()
    this._tooltipTimeline = tl

    // Hide current tooltip if any
    if (this._activeTooltip) {
      const current = tooltips.find(t => t.id === this._activeTooltip)
      if (current) {
        // Fade out with subtle upward movement
        tl.to(current.el, {
          opacity: 0,
          y: -8,
          duration: 0.35,
          ease: 'power2.inOut'
        })
        .to(current.row, {
          height: 0,
          duration: 0.45,
          ease: 'power3.inOut'
        }, '-=0.2')
        .set(current.el, { y: 0 })
      }
    }

    this._activeTooltip = tooltipId

    // If tooltipId is null, just hide (no new tooltip to show)
    if (!tooltipId) return

    // Show new tooltip - expand row first, then fade in content with subtle movement
    const newTooltip = tooltips.find(t => t.id === tooltipId)
    if (newTooltip) {
      // Measure the tooltip's natural height
      gsap.set(newTooltip.row, { height: 'auto' })
      const naturalHeight = newTooltip.row.offsetHeight
      gsap.set(newTooltip.row, { height: 0 })
      gsap.set(newTooltip.el, { y: 12, opacity: 0 })

      tl.to(newTooltip.row, {
        height: naturalHeight,
        overflow: 'visible',
        duration: 0.5,
        ease: 'power2.out'
      })
      .to(newTooltip.el, {
        opacity: 1,
        y: 0,
        duration: 0.45,
        ease: 'power2.out'
      }, '-=0.35')
    }
  }

  _startTooltipCycle(panel, container) {
    if (this._tooltipCycleTimeout) {
      clearTimeout(this._tooltipCycleTimeout)
      this._tooltipCycleTimeout = null
    }

    // null = no tooltip shown (brief pause between cycles)
    const tooltipOrder = ['devtools', 'os', 'engine', null]
    const normalDelay = 12000
    const pauseDelay = 4000

    const showNext = () => {
      const currentIdx = tooltipOrder.indexOf(this._activeTooltip)
      const nextIdx = (currentIdx + 1) % tooltipOrder.length
      const nextTooltip = tooltipOrder[nextIdx]
      this._showTooltip(panel, container, nextTooltip)

      // Use shorter delay after showing null (the pause), normal delay otherwise
      const delay = nextTooltip === null ? pauseDelay : normalDelay
      this._tooltipCycleTimeout = setTimeout(showNext, delay)
    }

    this._tooltipCycleTimeout = setTimeout(showNext, normalDelay)
  }

  _resetTooltipCycle(panel, container) {
    // Clear existing cycle timeout
    if (this._tooltipCycleTimeout) {
      clearTimeout(this._tooltipCycleTimeout)
      this._tooltipCycleTimeout = null
    }
    if (this._tooltipCycleRestartTimeout) {
      clearTimeout(this._tooltipCycleRestartTimeout)
      this._tooltipCycleRestartTimeout = null
    }

    // Restart after 8 seconds of no interaction
    this._tooltipCycleRestartTimeout = setTimeout(() => {
      this._startTooltipCycle(panel, container)
    }, 8000)
  }

  _animateFullStackOut(panel) {
    if (!panel) return

    if (this._fullstackRaf) {
      cancelAnimationFrame(this._fullstackRaf)
      this._fullstackRaf = null
    }
    if (this._fullstackTimeline) {
      this._fullstackTimeline.kill()
      this._fullstackTimeline = null
    }
    if (this._tooltipTimeline) {
      this._tooltipTimeline.kill()
      this._tooltipTimeline = null
    }

    // Clear timers
    if (this._tooltipCycleTimeout) {
      clearTimeout(this._tooltipCycleTimeout)
      this._tooltipCycleTimeout = null
    }
    if (this._tooltipCycleRestartTimeout) {
      clearTimeout(this._tooltipCycleRestartTimeout)
      this._tooltipCycleRestartTimeout = null
    }

    // Clean up handlers
    if (this._fullstackClickHandlers) {
      this._fullstackClickHandlers.forEach(({ el, handler }) => {
        el.removeEventListener('click', handler)
      })
      this._fullstackClickHandlers = null
    }
    if (this._fullstackLabelTimeouts) {
      this._fullstackLabelTimeouts.forEach((timeoutId, label) => {
        clearTimeout(timeoutId)
        if (label) label.classList.remove('is-active')
      })
      this._fullstackLabelTimeouts = null
    }

    const container = panel.querySelector('.fs-stack-content')
    const footer = panel.querySelector('.fs-footer')
    const duration = 0.25

    if (container) {
      gsap.to(container, {
        opacity: 0,
        y: 20,
        duration: duration,
        ease: 'power2.in'
      })
    }

    if (footer) {
      gsap.to(footer, {
        opacity: 0,
        y: 20,
        duration: duration,
        ease: 'power2.in'
      })
    }
  }

  _placeholder(index) {
    return `<div class="slide-placeholder">${this.title} - Page ${index}</div>`
  }
}

window.ConnectTab = ConnectTab
