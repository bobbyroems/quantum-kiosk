/**
 * Attract Screen Controller
 * Dot patterns traced from the MSFT design
 */

// 0 = no dot, 1 = white (row-based), 'w' = pure white
// 'y' = yellow (#E8CD86), 'Y' = yellow2 (#FFB900)
// 'b' = blue (#0078D4), 'B' = blue2 (#115EA3)
// 't' = teal (#49C5B1), 'd' = dark (#45423F), 'o' = orange

// Slide 0 (QuNorth) - fewest dots
const SLIDE_0_UPPER = [
  [1, 0, 0, 0],
  [1, 1, 0, 0],
  [0, 1, 0, 1],
  [0, 'o', 'Y', 1],
  [1, 1, 1, 1],
  [0, 1, 't', 'y'],
  [1, 1, 1, 1],
  ['o', 1, 1, 1],
]

const SLIDE_0_LOWER = [
  [1, 1, 1, 1],
  [1, 'w', 'd', 1],
  [1, 1, 1, 0],
  ['B', 'b', 1, 1],
  [1, 1, 'o', 0],
  [1, 0, 1, 0],
  [0, 0, 1, 1],
  [0, 0, 0, 1],
]

// Slide 1 (MAGNE) - medium dots
const SLIDE_1_UPPER = [
  [1, 0, 0, 0],
  [0, 0, 0 , 0],
  [0, 1, 0, 1],
  [0, 'o', 'Y', 1],
  [1, 0, 1, 1],
  [0, 1, 'd', 'y'],
  [1, 0, 1, 1],
  ['o', 1, 1, 1],
  [1, 1, 0, 0],
  [0, 1, 0, 1],
  [0, 'o', 'Y', 1],
  [1, 1, 1, 1],
  [0, 1, 'd', 'y'],
  [1, 1, 1, 1],
  ['o', 1, 1, 1],
]

const SLIDE_1_LOWER = [
  [1, 1, 1, 1],
  [1, 'w', 'd', 1],
  [1, 1, 1, 0],
  ['B', 'b', 1, 1],
  [1, 1, 'o', 0],
  [1, 0, 1, 0],
  [0, 0, 1, 1],
  [0, 0, 0, 1],
  [1, 1, 1, 1],
  [1, 'w', 'd', 1],
  [1, 1, 1, 0],
  ['B', 'b', 1, 1],
  [1, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
]

// Slide 2 (Connect Compute Control) - most dots
const SLIDE_2_UPPER = [
  [1, 0, 0, 0],
  [1, 1, 0 , 0],
  [0, 1, 0, 1],
  [0, 'o', 'Y', 1],
  [1, 1, 1, 1],
  [0, 1, 'd', 'y'],
  [1, 1, 1, 1],
  ['o', 1, 1, 1],
  [1, 1, 0, 0],
  [0, 1, 0, 1],
  [0, 'o', 'Y', 1],
  [1, 1, 1, 1],
  [0, 1, 'd', 'y'],
  [1, 1, 1, 1],
  ['o', 1, 1, 1],
]

const SLIDE_2_LOWER = [
  [1, 1, 1, 1],
  [1, 'w', 'd', 1],
  [1, 1, 1, 0],
  ['B', 'b', 1, 1],
  [1, 1, 'o', 0],
  [1, 0, 1, 0],
  [0, 0, 1, 1],
  [0, 0, 0, 1],
  [1, 1, 1, 1],
  [1, 'w', 'd', 1],
  [1, 1, 1, 0],
  ['B', 'b', 1, 1],
  [1, 1, 'o', 0],
  [1, 0, 1, 0],
  [0, 0, 1, 1],
  [0, 0, 0, 1],
]

const SLIDE_PATTERNS = [
  { upper: SLIDE_0_UPPER, lower: SLIDE_0_LOWER },
  { upper: SLIDE_1_UPPER, lower: SLIDE_1_LOWER },
  { upper: SLIDE_2_UPPER, lower: SLIDE_2_LOWER },
]

const COLOR_MAP = {
  y: 'yellow',      // #E8CD86 (muted gold)
  Y: 'yellow2',     // #FFB900 (bright yellow)
  b: 'blue',        // #0078D4
  B: 'blue2',       // #115EA3 (darker blue)
  t: 'teal',        // #49C5B1
  o: 'orange',
  d: 'dark'         // #45423F
}

class AttractController {
  constructor({ screen, brandSlides }) {
    this.screen = screen
    this.brandSlides = brandSlides

    // Dots organized per slide
    this.slideDots = [] // Array of { upper: [], lower: [], all: [] }

    this.currentSlide = 0
    this.slideInterval = null
    this.slideDuration = 5000
    this.hasCompletedCycle = false

    this.floatAnimations = []
    this.pulseAnimations = []

    // Touch interaction
    this.touchActive = false
    this.touchX = 0
    this.touchY = 0
    this.dotMass = new Map() // Random mass for each dot (affects animations)
    this.dotVelocity = new Map() // Track current scale state
    this.rafId = null
    this.isTransitioning = false // Flag to prevent touch interference during transitions
    this.forceDotsTimer = null
    this.normalizeDotsTimer = null

    // Grid-constrained pinch interaction (dots stay in formation)
    this.pinchRadius = 200 // pixels - area of effect
    this.pullStrength = 8 // subtle pull toward touch
    this.minScale = 0.35 // scale at the touch point

  }

  // Get all dots from all slides (for transitions to interactive mode)
  get allDots() {
    return this.slideDots.flatMap(slide => slide.all)
  }

  init() {
    // Build dot patterns for each slide
    this.brandSlides.forEach((slide, index) => {
      const upperContainer = slide.querySelector('.dot-pattern-upper')
      const lowerContainer = slide.querySelector('.dot-pattern-lower')
      const patterns = SLIDE_PATTERNS[index]

      const slideData = { upper: [], lower: [], all: [] }

      if (patterns && upperContainer) {
        this.buildDotPattern(upperContainer, patterns.upper, slideData.upper, 'upper')
        slideData.all.push(...slideData.upper)
      }

      if (patterns && lowerContainer) {
        this.buildDotPattern(lowerContainer, patterns.lower, slideData.lower, 'lower')
        slideData.all.push(...slideData.lower)
      }

      this.slideDots.push(slideData)
    })

    // Setup touch interaction
    this._bindTouchEvents()
  }

  _bindTouchEvents() {
    // Touch events
    this.screen.addEventListener('touchstart', this._onTouchStart.bind(this), { passive: true })
    this.screen.addEventListener('touchmove', this._onTouchMove.bind(this), { passive: true })
    this.screen.addEventListener('touchend', this._onTouchEnd.bind(this), { passive: true })
    this.screen.addEventListener('touchcancel', this._onTouchEnd.bind(this), { passive: true })

    // Mouse events for desktop testing
    this.screen.addEventListener('mousedown', this._onMouseDown.bind(this))
    this.screen.addEventListener('mousemove', this._onMouseMove.bind(this))
    this.screen.addEventListener('mouseup', this._onMouseUp.bind(this))
    this.screen.addEventListener('mouseleave', this._onMouseUp.bind(this))
  }

  _onTouchStart(e) {
    if (this.isTransitioning) return
    if (e.touches.length > 0) {
      this.touchActive = true
      this.touchX = e.touches[0].clientX
      this.touchY = e.touches[0].clientY
      this.stopContinuousAnimations()
      this._startRepulsionLoop()
    }
  }

  _onTouchMove(e) {
    if (this.touchActive && e.touches.length > 0) {
      this.touchX = e.touches[0].clientX
      this.touchY = e.touches[0].clientY
    }
  }

  _onTouchEnd() {
    this.touchActive = false
    this._stopRepulsionLoop()
    this._returnDotsToOrigin()
  }

  _onMouseDown(e) {
    if (this.isTransitioning) return
    this.touchActive = true
    this.touchX = e.clientX
    this.touchY = e.clientY
    this.stopContinuousAnimations()
    this._startRepulsionLoop()
  }

  _onMouseMove(e) {
    if (this.touchActive) {
      this.touchX = e.clientX
      this.touchY = e.clientY
    }
  }

  _onMouseUp() {
    this.touchActive = false
    this._stopRepulsionLoop()
    this._returnDotsToOrigin()
  }

  _startRepulsionLoop() {
    if (this.rafId) return

    const update = () => {
      if (!this.touchActive) return
      this._applyGridScaling()
      this.rafId = requestAnimationFrame(update)
    }
    this.rafId = requestAnimationFrame(update)
  }

  _stopRepulsionLoop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  _applyGridScaling() {
    const currentDots = this.slideDots[this.currentSlide]
    if (!currentDots || currentDots.all.length === 0) return

    currentDots.all.forEach(dot => {
      const rect = dot.getBoundingClientRect()
      const dotCenterX = rect.left + rect.width / 2
      const dotCenterY = rect.top + rect.height / 2

      const dx = dotCenterX - this.touchX
      const dy = dotCenterY - this.touchY
      const distance = Math.sqrt(dx * dx + dy * dy)

      // Get current state
      let state = this.dotVelocity.get(dot) || { x: 0, y: 0, scale: 1 }
      let targetX = 0
      let targetY = 0
      let targetScale = 1

      if (distance < this.pinchRadius && distance > 0) {
        const t = distance / this.pinchRadius
        const falloff = Math.pow(1 - t, 1.8) // Smooth falloff

        // Subtle pull toward touch point
        const angle = Math.atan2(dy, dx)
        const pull = falloff * this.pullStrength
        targetX = -Math.cos(angle) * pull
        targetY = -Math.sin(angle) * pull

        // Scale down
        targetScale = 1 - (1 - this.minScale) * falloff
      }

      // Smooth interpolation
      state.x += (targetX - state.x) * 0.2
      state.y += (targetY - state.y) * 0.2
      state.scale += (targetScale - state.scale) * 0.25

      this.dotVelocity.set(dot, state)

      gsap.to(dot, {
        x: state.x,
        y: state.y,
        scale: state.scale,
        duration: 0.06,
        ease: 'power1.out',
        overwrite: 'auto'
      })
    })
  }

  _returnDotsToOrigin() {
    if (this.isTransitioning) return

    const currentDots = this.slideDots[this.currentSlide]
    if (!currentDots || currentDots.all.length === 0) return

    // Smoothly return dots to original position and scale
    currentDots.all.forEach((dot, index) => {
      const delay = Math.random() * 0.02

      // Reset state tracking
      this.dotVelocity.set(dot, { x: 0, y: 0, scale: 1 })

      gsap.to(dot, {
        x: 0,
        y: 0,
        scale: 1,
        duration: 0.35,
        delay,
        ease: 'elastic.out(1, 0.6)',
        overwrite: true
      })
    })

    // Restart continuous animations after dots settle
    setTimeout(() => {
      if (!this.touchActive && !this.isTransitioning) {
        this.startContinuousAnimations()
      }
    }, 350)
  }

  start() {
    this.hasCompletedCycle = false
    this.currentSlide = 0
    this.showSlide(0, false)

    this.animateDotsIn().then(() => {
      // Slideshow is now controlled by button tap, not auto-advance
      const currentDots = this.slideDots[this.currentSlide]
      if (currentDots) {
        this._normalizeDots(currentDots.all)
      }
      this.startContinuousAnimations()
    })
  }

  stop() {
    this.stopSlideshow()
    this.stopContinuousAnimations()
  }

  reset() {
    // Kill any running animations
    this.stopSlideshow()
    this.stopContinuousAnimations()
    gsap.killTweensOf(this.allDots)
    gsap.killTweensOf('.brand-slide')
    gsap.killTweensOf('.brand-copy')
    gsap.killTweensOf('.brand-nav-words')

    // Reset all dots to clean state
    this.slideDots.forEach(slideData => {
      gsap.set(slideData.all, {
        x: 0,
        y: 0,
        scale: 1,
        opacity: 1,
        rotation: 0,
        clearProps: 'transform'
      })
    })

    // Reset all brand slides
    this.brandSlides.forEach((slide, index) => {
      slide.classList.remove('active')
      gsap.set(slide, { opacity: 0, y: 0, clearProps: 'transform' })

      // Reset text elements inside
      const text = slide.querySelector('.brand-copy, .brand-nav-words')
      if (text) {
        gsap.set(text, { opacity: 1, y: 0, clearProps: 'transform' })
      }
    })

    // Reset state
    this.currentSlide = 0
    this.hasCompletedCycle = false
  }

  buildDotPattern(container, pattern, dotsArray, position) {
    const numRows = pattern.length
    const numCols = pattern[0].length

    container.style.display = 'grid'
    container.style.gridTemplateColumns = `repeat(${numCols}, var(--dot-size))`
    container.style.gridTemplateRows = `repeat(${numRows}, var(--dot-size))`
    container.style.gap = 'var(--dot-gap)'

    for (let row = 0; row < numRows; row++) {
      for (let col = 0; col < numCols; col++) {
        const cell = pattern[row][col]

        if (cell === 0) {
          const placeholder = document.createElement('div')
          placeholder.style.visibility = 'hidden'
          container.appendChild(placeholder)
        } else {
          const dot = document.createElement('div')
          dot.className = 'dot'
          dot.dataset.row = row
          dot.dataset.col = col

          if (typeof cell === 'string' && COLOR_MAP[cell]) {
            // Colored dot
            dot.classList.add(COLOR_MAP[cell])
          } else if (cell === 'w') {
            // Pure white dot (100% opacity)
            dot.classList.add('pure-white')
          } else if (cell === 1) {
            // Standard white dot - apply row-based color
            dot.classList.add(this.getWhiteClass(row, position))
          }

          container.appendChild(dot)
          dotsArray.push(dot)

          // Assign random mass (lighter dots move more easily)
          this.dotMass.set(dot, 0.3 + Math.random() * 0.7)
          this.dotVelocity.set(dot, { x: 0, y: 0, scale: 1 })
        }
      }
    }
  }

  getWhiteClass(row, position) {
    if (position === 'upper') {
      // Upper: rows 0-6 (1-7) = warm, rows 7+ (8+) = cool
      return row < 7 ? 'upper-warm' : 'upper-cool'
    } else {
      // Lower: rows 0-7 (1-8) = warm, rows 8+ (9+) = cool
      return row < 8 ? 'lower-warm' : 'lower-cool'
    }
  }

  animateDotsIn() {
    return new Promise((resolve) => {
      const currentDots = this.slideDots[0]

      if (this.forceDotsTimer) {
        clearTimeout(this.forceDotsTimer)
        this.forceDotsTimer = null
      }
      if (this.normalizeDotsTimer) {
        clearTimeout(this.normalizeDotsTimer)
        this.normalizeDotsTimer = null
      }

      gsap.set(currentDots.all, { opacity: 0, scale: 0 })
      gsap.set('.brand-slide', { opacity: 0 })

      const finalizeDots = () => {
        if (this.currentSlide !== 0) return
        this._normalizeDots(currentDots.all)
      }

      const tl = gsap.timeline({
        onComplete: () => {
          finalizeDots()
          resolve()
        }
      })

      tl.to(currentDots.upper, {
        opacity: 1,
        scale: 1,
        duration: 0.6,
        stagger: {
          each: 0.015,
          from: 'center',
          grid: 'auto'
        },
        ease: 'back.out(1.4)'
      })
      .to(this.brandSlides[0], {
        opacity: 1,
        duration: 0.8,
        ease: 'power2.out'
      }, '-=0.3')
      .to(currentDots.lower, {
        opacity: 1,
        scale: 1,
        duration: 0.6,
        stagger: {
          each: 0.015,
          from: 'center',
          grid: 'auto'
        },
        ease: 'back.out(1.4)'
      }, '-=0.5')

      this.forceDotsTimer = setTimeout(finalizeDots, 1200)
      this.normalizeDotsTimer = setTimeout(finalizeDots, 1800)
    })
  }

  _normalizeDots(dots) {
    if (!dots || !dots.length) return
    if (window.gsap) {
      window.gsap.set(dots, { opacity: 1, scale: 1, clearProps: 'transform' })
      return
    }
    dots.forEach(dot => {
      dot.style.opacity = '1'
      dot.style.transform = 'scale(1)'
    })
  }

  startSlideshow() {
    this.stopSlideshow()
    this.slideInterval = setInterval(() => {
      this.nextSlide()
    }, this.slideDuration)
  }

  stopSlideshow() {
    if (this.slideInterval) {
      clearInterval(this.slideInterval)
      this.slideInterval = null
    }
  }

  nextSlide() {
    const nextIndex = (this.currentSlide + 1) % this.brandSlides.length

    if (nextIndex === 0 && !this.hasCompletedCycle) {
      this.hasCompletedCycle = true
      if (typeof this.onCycleComplete === 'function') {
        this.onCycleComplete()
      }
      return
    }

    this.transitionToSlide(nextIndex)
  }

  showSlide(index, animate = true) {
    this.brandSlides.forEach((slide, i) => {
      if (i === index) {
        slide.classList.add('active')
        if (animate) {
          gsap.fromTo(slide,
            { opacity: 0, y: 20 },
            { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }
          )
        }
      } else {
        slide.classList.remove('active')
      }
    })
    this.currentSlide = index
  }

  transitionToSlide(nextIndex) {
    const currentSlide = this.brandSlides[this.currentSlide]
    const nextSlide = this.brandSlides[nextIndex]
    const currentDots = this.slideDots[this.currentSlide]
    const nextDots = this.slideDots[nextIndex]

    // Prevent touch interference during transition
    this.isTransitioning = true
    this.touchActive = false
    this._stopRepulsionLoop()
    this.stopContinuousAnimations()

    // Get text elements
    const currentText = currentSlide.querySelector('.brand-copy, .brand-nav-words')
    const nextText = nextSlide.querySelector('.brand-copy, .brand-nav-words')

    // Prepare next slide (invisible but ready)
    nextSlide.classList.add('active')
    gsap.set(nextSlide, { opacity: 1, visibility: 'visible' })
    gsap.set(nextDots.all, { opacity: 0, scale: 0.3, x: 0, y: 0 })
    if (nextText) {
      gsap.set(nextText, { opacity: 0, y: 15 })
    }

    const tl = gsap.timeline({
      onComplete: () => {
        currentSlide.classList.remove('active')
        this.isTransitioning = false
        this.startContinuousAnimations()
      }
    })

    // Phase 1: Fade out current text (dots stay visible longer)
    if (currentText) {
      tl.to(currentText, {
        opacity: 0,
        y: -15,
        duration: 0.35,
        ease: 'power2.in'
      })
    }

    // Phase 2: Cross-fade - current dots gently fade while next dots spawn
    if (currentDots.all.length > 0) {
      tl.to(currentDots.all, {
        opacity: 0,
        scale: 0.7,
        duration: 0.5,
        ease: 'power1.inOut'
      }, currentText ? '-=0.2' : '0')
    }

    // Phase 3: Atom spawn animation for next dots
    if (nextDots.all.length > 0) {
      // Slide 2 (Connect/Compute/Control): simple fade, no expand animation
      if (nextIndex === 2) {
        tl.to(nextDots.all, {
          opacity: 1,
          scale: 1,
          duration: 0.5,
          ease: 'power2.out'
        }, '-=0.3')
      } else {
        // Slides 0 and 1: expand animation with stagger
        tl.to(nextDots.all, {
          opacity: 1,
          scale: 1,
          duration: 0.6,
          stagger: {
            each: 0.015,
            from: 'center',
            grid: 'auto'
          },
          ease: 'elastic.out(1, 0.7)'
        }, '-=0.4')

        // Quantum fluctuation on colored dots
        const coloredNext = nextDots.all.filter(dot =>
          dot.classList.contains('yellow') ||
          dot.classList.contains('yellow2') ||
          dot.classList.contains('blue') ||
          dot.classList.contains('blue2') ||
          dot.classList.contains('teal') ||
          dot.classList.contains('orange')
        )
        if (coloredNext.length > 0) {
          tl.fromTo(coloredNext,
            { rotation: () => (Math.random() - 0.5) * 25 },
            { rotation: 0, duration: 0.35, ease: 'power2.out' },
            '-=0.5'
          )
        }
      }
    }

    // Phase 4: Fade in next text (starts with dots, not after)
    if (nextText) {
      gsap.to(nextText, {
        opacity: 1,
        y: 0,
        duration: 0.5,
        delay: 0.25,
        ease: 'power2.out'
      })
    }

    this.currentSlide = nextIndex
  }

  startContinuousAnimations() {
    this.stopContinuousAnimations()

    const currentDots = this.slideDots[this.currentSlide]
    if (!currentDots || currentDots.all.length === 0) return
    this._normalizeDots(currentDots.all)

    currentDots.all.forEach((dot, index) => {
      const delay = (index * 0.05) % 2
      const duration = 2.5 + Math.random() * 1.5
      const yOffset = -3 + Math.random() * 6
      const xOffset = -2 + Math.random() * 4

      const anim = gsap.to(dot, {
        y: yOffset,
        x: xOffset,
        duration,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
        delay
      })
      this.floatAnimations.push(anim)
    })

    const coloredDots = currentDots.all.filter(dot =>
      dot.classList.contains('yellow') ||
      dot.classList.contains('yellow2') ||
      dot.classList.contains('blue') ||
      dot.classList.contains('blue2') ||
      dot.classList.contains('teal') ||
      dot.classList.contains('orange')
    )

    coloredDots.forEach((dot, index) => {
      const anim = gsap.to(dot, {
        scale: 1.15,
        duration: 1.2 + Math.random() * 0.5,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
        delay: index * 0.25
      })
      this.pulseAnimations.push(anim)
    })
  }

  stopContinuousAnimations() {
    this.floatAnimations.forEach(anim => anim.kill())
    this.pulseAnimations.forEach(anim => anim.kill())
    this.floatAnimations = []
    this.pulseAnimations = []
  }
}

window.AttractController = AttractController
