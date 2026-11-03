/**
 * Interactive Dots Controller
 * Adds touch/mouse interaction to dot patterns (pinch effect like attract screen)
 */

class InteractiveDots {
  constructor(container) {
    this.container = container
    this.dots = []
    this.isActive = false

    // Touch interaction state
    this.touchActive = false
    this.touchX = 0
    this.touchY = 0
    this.rafId = null
    this.dotVelocity = new Map()

    // Interaction parameters
    this.pinchRadius = 200
    this.pullStrength = 8
    this.minScale = 0.35

    // Continuous animation state
    this.floatAnimations = []
    this.pulseAnimations = []

    // Bound handlers for cleanup
    this._boundTouchStart = this._onTouchStart.bind(this)
    this._boundTouchMove = this._onTouchMove.bind(this)
    this._boundTouchEnd = this._onTouchEnd.bind(this)
    this._boundMouseDown = this._onMouseDown.bind(this)
    this._boundMouseMove = this._onMouseMove.bind(this)
    this._boundMouseUp = this._onMouseUp.bind(this)
  }

  init() {
    // Find all dots in the container
    this.dots = Array.from(this.container.querySelectorAll('.dot'))

    // Initialize velocity state for each dot
    this.dots.forEach(dot => {
      this.dotVelocity.set(dot, { x: 0, y: 0, scale: 1 })
    })

    // Bind touch/mouse events
    this._bindEvents()
    this.isActive = true

    // Start continuous floating animations
    this.startContinuousAnimations()
  }

  destroy() {
    this.isActive = false
    this._unbindEvents()
    this._stopRepulsionLoop()
    this.stopContinuousAnimations()

    // Reset all dots
    this.dots.forEach(dot => {
      gsap.set(dot, { x: 0, y: 0, scale: 1, clearProps: 'transform' })
    })

    this.dots = []
    this.dotVelocity.clear()
  }

  _bindEvents() {
    this.container.addEventListener('touchstart', this._boundTouchStart, { passive: true })
    this.container.addEventListener('touchmove', this._boundTouchMove, { passive: true })
    this.container.addEventListener('touchend', this._boundTouchEnd, { passive: true })
    this.container.addEventListener('touchcancel', this._boundTouchEnd, { passive: true })

    this.container.addEventListener('mousedown', this._boundMouseDown)
    this.container.addEventListener('mousemove', this._boundMouseMove)
    this.container.addEventListener('mouseup', this._boundMouseUp)
    this.container.addEventListener('mouseleave', this._boundMouseUp)
  }

  _unbindEvents() {
    this.container.removeEventListener('touchstart', this._boundTouchStart)
    this.container.removeEventListener('touchmove', this._boundTouchMove)
    this.container.removeEventListener('touchend', this._boundTouchEnd)
    this.container.removeEventListener('touchcancel', this._boundTouchEnd)

    this.container.removeEventListener('mousedown', this._boundMouseDown)
    this.container.removeEventListener('mousemove', this._boundMouseMove)
    this.container.removeEventListener('mouseup', this._boundMouseUp)
    this.container.removeEventListener('mouseleave', this._boundMouseUp)
  }

  _onTouchStart(e) {
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
    if (!this.dots.length) return

    this.dots.forEach(dot => {
      const rect = dot.getBoundingClientRect()
      const dotCenterX = rect.left + rect.width / 2
      const dotCenterY = rect.top + rect.height / 2

      const dx = dotCenterX - this.touchX
      const dy = dotCenterY - this.touchY
      const distance = Math.sqrt(dx * dx + dy * dy)

      let state = this.dotVelocity.get(dot) || { x: 0, y: 0, scale: 1 }
      let targetX = 0
      let targetY = 0
      let targetScale = 1

      if (distance < this.pinchRadius && distance > 0) {
        const t = distance / this.pinchRadius
        const falloff = Math.pow(1 - t, 1.8)

        const angle = Math.atan2(dy, dx)
        const pull = falloff * this.pullStrength
        targetX = -Math.cos(angle) * pull
        targetY = -Math.sin(angle) * pull

        targetScale = 1 - (1 - this.minScale) * falloff
      }

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
    if (!this.dots.length) return

    this.dots.forEach((dot, index) => {
      const delay = Math.random() * 0.02

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

    setTimeout(() => {
      if (!this.touchActive && this.isActive) {
        this.startContinuousAnimations()
      }
    }, 350)
  }

  startContinuousAnimations() {
    this.stopContinuousAnimations()

    if (!this.dots.length) return

    this.dots.forEach((dot, index) => {
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

    // Pulse colored dots
    const coloredDots = this.dots.filter(dot =>
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

window.InteractiveDots = InteractiveDots
