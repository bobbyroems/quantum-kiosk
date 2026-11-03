import { advanceCarouselSpring, createCarouselSpring } from './carousel-spring.js'
import { sound } from './kiosk-audio.js'
import { getModuleNavigationGridLayout } from './module-navigation-projection.js'

export function clampCarouselIndex(index, itemCount) {
  if (!Number.isFinite(index) || itemCount <= 0) return 0
  return Math.min(itemCount - 1, Math.max(0, Math.round(index)))
}

export function carouselOffset(index, cardWidth, gap) {
  if (![index, cardWidth, gap].every(Number.isFinite)) return 0
  return Math.max(0, index) * Math.max(0, cardWidth + gap)
}

export function swipeTargetIndex(currentIndex, dragDistance, threshold, itemCount) {
  if (dragDistance <= -Math.abs(threshold)) {
    return clampCarouselIndex(currentIndex + 1, itemCount)
  }
  if (dragDistance >= Math.abs(threshold)) {
    return clampCarouselIndex(currentIndex - 1, itemCount)
  }
  return clampCarouselIndex(currentIndex, itemCount)
}

export function hasHorizontalDragIntent(deltaX, deltaY, threshold = 6) {
  if (![deltaX, deltaY, threshold].every(Number.isFinite)) return false
  const minimumDistance = Math.max(0, threshold)
  return Math.abs(deltaX) >= minimumDistance && Math.abs(deltaX) >= Math.abs(deltaY)
}

export class ModuleCarousel {
  constructor({
    currentLabel,
    nextButton,
    onActivity,
    onOpen,
    pagination,
    previousButton,
    root,
    track,
    viewport
  }) {
    this.currentLabel = currentLabel
    this.nextButton = nextButton
    this.onActivity = onActivity
    this.onOpen = onOpen
    this.pagination = pagination
    this.previousButton = previousButton
    this.root = root
    this.track = track
    this.viewport = viewport

    this.cards = []
    this.currentIndex = 0
    this.drag = null
    this.suppressClick = false
    this.wrapAnimating = false
    this.previewMotion = null
    this.previewMotions = []
    this.previewMotionFrame = 0
    this.active = false

    this.handleCardClick = this.handleCardClick.bind(this)
    this.handleKeyDown = this.handleKeyDown.bind(this)
    this.handleNext = this.handleNext.bind(this)
    this.handlePaginationClick = this.handlePaginationClick.bind(this)
    this.handlePointerCancel = this.handlePointerCancel.bind(this)
    this.handlePointerDown = this.handlePointerDown.bind(this)
    this.handlePointerMove = this.handlePointerMove.bind(this)
    this.handlePointerUp = this.handlePointerUp.bind(this)
    this.handlePrevious = this.handlePrevious.bind(this)
    this.handleWheel = this.handleWheel.bind(this)
    this.updatePreviewMotion = this.updatePreviewMotion.bind(this)
    this.lastWheelAt = 0

    this.root.addEventListener('wheel', this.handleWheel, { passive: false })
    this.track.addEventListener('click', this.handleCardClick)
    this.pagination.addEventListener('click', this.handlePaginationClick)
    this.previousButton.addEventListener('click', this.handlePrevious)
    this.nextButton.addEventListener('click', this.handleNext)
    this.root.addEventListener('keydown', this.handleKeyDown)
    this.viewport.addEventListener('pointerdown', this.handlePointerDown)
    this.viewport.addEventListener('pointermove', this.handlePointerMove, { passive: false })
    this.viewport.addEventListener('pointerup', this.handlePointerUp)
    this.viewport.addEventListener('pointercancel', this.handlePointerCancel)
  }

  mount(cards) {
    this.cards = [...cards]
    const indicators = this.cards.map((card, index) => {
      const indicator = document.createElement('button')
      indicator.className = 'module-carousel__indicator'
      indicator.type = 'button'
      indicator.dataset.carouselIndex = String(index)
      indicator.setAttribute(
        'aria-label',
        `Show module ${card.dataset.moduleNumber}: ${card.dataset.moduleTitle}`
      )
      indicator.innerHTML = '<span></span>'
      return indicator
    })
    this.pagination.replaceChildren(...indicators)
    this.setIndex(clampCarouselIndex(this.currentIndex, this.cards.length), {
      animate: false
    })
    window.cancelAnimationFrame(this.previewMotionFrame)
    this.previewMotionFrame = 0
    this.previewMotions = [...this.track.querySelectorAll('[data-carousel-preview-motion]')]
      .map(preview => ({
        preview,
        card: preview.closest('.module-card'),
        spring: createCarouselSpring(51),
        previousCenterX: undefined,
        previousFrameAt: undefined
      }))
    this.previewMotion = this.previewMotions[0] || null
    this.startPreviewMotion()
    window.requestAnimationFrame(() => this.root.classList.add('is-ready'))
  }

  startPreviewMotion() {
    if (!this.previewMotions.length) return
    for (const motion of this.previewMotions) {
      motion.previousCenterX = undefined
      motion.previousFrameAt = undefined
    }
    this.schedulePreviewMotion()
  }

  schedulePreviewMotion() {
    if (!this.active || !this.previewMotions.length || this.previewMotionFrame) return
    this.previewMotionFrame = window.requestAnimationFrame(this.updatePreviewMotion)
  }

  stopPreviewMotion() {
    window.cancelAnimationFrame(this.previewMotionFrame)
    this.previewMotionFrame = 0
  }

  /** Only the visible menu is allowed to decode its video or run its motion RAF. */
  setActive(active) {
    this.active = Boolean(active)
    if (this.active) this.startPreviewMotion()
    else {
      this.stopPreviewMotion()
    }
    this.updatePreviewVideoPlayback()
  }

  updatePreviewMotion(now) {
    this.previewMotionFrame = 0
    if (!this.active || !this.previewMotions.length) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    for (const motion of this.previewMotions) {
      const rect = motion.card.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const deltaSeconds = motion.previousFrameAt === undefined
        ? 0
        : (now - motion.previousFrameAt) / 1000
      let slideVelocity = 0
      if (motion.previousCenterX !== undefined && deltaSeconds > 0 && deltaSeconds < 0.2) {
        const deltaX = centerX - motion.previousCenterX
        if (Math.abs(deltaX) > 0.5 && rect.width > 1) {
          slideVelocity = deltaX / rect.width / deltaSeconds
        }
      }
      motion.previousCenterX = centerX
      motion.previousFrameAt = now

      if (rect.width < 2 || reducedMotion) {
        motion.spring.offset = 0
        motion.spring.velocity = 0
      } else {
        const drive = Math.max(-3, Math.min(3, slideVelocity))
        advanceCarouselSpring(motion.spring, drive, Math.min(deltaSeconds || 0.033, 0.066))
        if (Math.abs(motion.spring.offset) < 0.00001 && Math.abs(motion.spring.velocity) < 0.00001) {
          motion.spring.offset = 0
          motion.spring.velocity = 0
        }
      }

      const visual = motion.preview.closest('.module-card__visual')
      const sceneAspect = visual.offsetWidth / Math.max(1, visual.offsetHeight + 280)
      const frustumWidth = getModuleNavigationGridLayout({ aspect: sceneAspect }).frustumWidth
      const offsetX = (motion.spring.offset / frustumWidth) * visual.offsetWidth
      motion.preview.style.setProperty('--carousel-preview-motion-x', `${offsetX}px`)
      motion.preview.style.setProperty(
        '--carousel-preview-motion-rotation',
        `${motion.spring.offset * 0.4}rad`
      )
    }

    this.schedulePreviewMotion()
  }

  setIndex(index, {
    animate = true,
    announceActivity = false
  } = {}) {
    if (this.cards.length === 0 || this.wrapAnimating) return
    const nextIndex = clampCarouselIndex(index, this.cards.length)
    if (animate && nextIndex !== this.currentIndex) sound.whoosh()
    this.currentIndex = nextIndex
    this.root.classList.toggle('is-jumping', !animate)
    this.track.style.setProperty(
      '--carousel-offset',
      `${carouselOffset(nextIndex, this.cardWidth(), this.trackGap())}px`
    )
    this.track.style.setProperty('--carousel-drag', '0px')
    this.root.dataset.carouselIndex = String(nextIndex)

    this.applyIndexState(nextIndex)
    if (announceActivity) this.onActivity?.()

    if (!animate) {
      window.requestAnimationFrame(() => this.root.classList.remove('is-jumping'))
    }
  }

  applyIndexState(nextIndex) {
    this.cards.forEach((card, cardIndex) => {
      const distance = Math.abs(cardIndex - nextIndex)
      const isActive = cardIndex === nextIndex
      card.classList.toggle('is-active', isActive)
      card.classList.toggle('is-neighbour', distance === 1)
      card.classList.toggle('is-distant', distance > 1)
      card.dataset.carouselPosition = cardIndex < nextIndex
        ? 'before'
        : cardIndex > nextIndex ? 'after' : 'active'
      card.tabIndex = isActive ? 0 : -1
      if (isActive) card.setAttribute('aria-current', 'true')
      else card.removeAttribute('aria-current')
    })
    this.updatePreviewVideoPlayback()

    const indicators = [...this.pagination.querySelectorAll('[data-carousel-index]')]
    indicators.forEach((indicator, indicatorIndex) => {
      const isActive = indicatorIndex === nextIndex
      indicator.classList.toggle('is-active', isActive)
      indicator.setAttribute('aria-pressed', String(isActive))
    })

    /* Navigation wraps, so the arrows never disable. */
    this.previousButton.disabled = false
    this.nextButton.disabled = false
    this.currentLabel.textContent = this.cards[nextIndex].dataset.moduleNumber
  }

  updatePreviewVideoPlayback() {
    this.cards.forEach((card, cardIndex) => {
      const previewVideo = card.querySelector('.module-card__preview-video')
      if (!previewVideo) return
      if (this.active && cardIndex === this.currentIndex) previewVideo.play().catch(() => {})
      else previewVideo.pause()
    })
  }

  cardWidth() {
    return this.cards[0]?.offsetWidth || 1420
  }

  trackGap() {
    const style = window.getComputedStyle(this.track)
    return Number.parseFloat(style.columnGap || style.gap) || 64
  }

  stageScale() {
    if (this.root.offsetWidth <= 0) return 1
    return this.root.getBoundingClientRect().width / this.root.offsetWidth || 1
  }

  moveBy(direction) {
    if (this.wrapAnimating) return
    const count = this.cards.length
    if (count === 0) return
    const target = this.currentIndex + direction
    if (count > 1 && target >= count) this.wrapForward()
    else if (count > 1 && target < 0) this.wrapBackward()
    else this.setIndex(target, { announceActivity: true })
  }

  /* Seamless loop: teleport the wrapping card to the far side of the track,
     then slide a single normal step so it always arrives from the direction
     of travel instead of the track rewinding. */
  wrapForward() {
    const count = this.cards.length
    const step = this.cardWidth() + this.trackGap()
    const first = this.cards[0]

    this.root.classList.add('is-jumping')
    this.track.append(first)
    this.track.style.setProperty('--carousel-offset', `${(count - 2) * step}px`)
    this.track.getBoundingClientRect()
    this.root.classList.remove('is-jumping')

    this.wrapAnimating = true
    this.track.style.setProperty('--carousel-offset', `${(count - 1) * step}px`)
    this.applyIndexState(0)
    sound.whoosh()
    this.onActivity?.()
    window.setTimeout(() => {
      this.wrapAnimating = false
      this.track.prepend(first)
      this.currentIndex = 0
      this.setIndex(0, { animate: false })
    }, 790)
  }

  wrapBackward() {
    const count = this.cards.length
    const step = this.cardWidth() + this.trackGap()
    const last = this.cards[count - 1]

    this.root.classList.add('is-jumping')
    this.track.prepend(last)
    this.track.style.setProperty('--carousel-offset', `${step}px`)
    this.track.getBoundingClientRect()
    this.root.classList.remove('is-jumping')

    this.wrapAnimating = true
    this.track.style.setProperty('--carousel-offset', '0px')
    this.applyIndexState(count - 1)
    sound.whoosh()
    this.onActivity?.()
    window.setTimeout(() => {
      this.wrapAnimating = false
      this.track.append(last)
      this.currentIndex = count - 1
      this.setIndex(count - 1, { animate: false })
    }, 790)
  }

  markVisited(moduleId) {
    const cardIndex = this.cards.findIndex(card => card.dataset.moduleId === moduleId)
    if (cardIndex < 0) return
    this.pagination
      .querySelectorAll('[data-carousel-index]')[cardIndex]
      ?.classList.add('is-visited')
  }

  handlePrevious() {
    this.moveBy(-1)
  }

  handleNext() {
    this.moveBy(1)
  }

  handlePaginationClick(event) {
    const indicator = event.target.closest('[data-carousel-index]')
    if (!indicator) return
    this.setIndex(Number(indicator.dataset.carouselIndex), { announceActivity: true })
  }

  handleCardClick(event) {
    const card = event.target.closest('[data-module-id]')
    if (!card || this.suppressClick) {
      event.preventDefault()
      return
    }
    const cardIndex = this.cards.indexOf(card)
    if (cardIndex !== this.currentIndex) {
      event.preventDefault()
      this.setIndex(cardIndex, { announceActivity: true })
      return
    }
    this.onActivity?.()
    if (event.target.closest('.module-card__footer')) {
      this.onOpen?.(card.dataset.moduleId)
    }
  }

  handleWheel(event) {
    event.preventDefault()
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (Math.abs(delta) < 10) return
    const now = performance.now()
    if (now - this.lastWheelAt < 450) return
    this.lastWheelAt = now
    this.moveBy(delta > 0 ? 1 : -1)
  }

  handleKeyDown(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    this.moveBy(event.key === 'ArrowLeft' ? -1 : 1)
  }

  handlePointerDown(event) {
    if (event.button !== 0 || this.cards.length < 2) return
    this.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      designDistance: 0,
      horizontal: false,
      captured: false
    }
    this.suppressClick = false
    this.onActivity?.()
  }

  handlePointerMove(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return
    const deltaX = event.clientX - this.drag.startX
    const deltaY = event.clientY - this.drag.startY
    if (!this.drag.horizontal && Math.abs(deltaX) < 6 && Math.abs(deltaY) < 6) return
    this.drag.horizontal = hasHorizontalDragIntent(deltaX, deltaY)
    if (!this.drag.horizontal) return

    if (!this.drag.captured) {
      this.viewport.setPointerCapture?.(event.pointerId)
      this.drag.captured = true
      this.root.classList.add('is-dragging')
    }

    event.preventDefault()
    const designDistance = deltaX / this.stageScale()
    const atStart = this.currentIndex === 0 && designDistance > 0
    const atEnd = this.currentIndex === this.cards.length - 1 && designDistance < 0
    this.drag.designDistance = (atStart || atEnd) ? designDistance * 0.22 : designDistance
    this.suppressClick = Math.abs(designDistance) > 28
    this.track.style.setProperty('--carousel-drag', `${this.drag.designDistance}px`)
  }

  finishPointer(event, cancelled = false) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return
    const distance = this.drag.designDistance
    const dragged = this.suppressClick
    if (this.drag.captured) this.viewport.releasePointerCapture?.(event.pointerId)
    this.drag = null
    this.root.classList.remove('is-dragging')
    this.setIndex(
      cancelled
        ? this.currentIndex
        : swipeTargetIndex(this.currentIndex, distance, 150, this.cards.length),
      { announceActivity: dragged }
    )
    if (dragged) {
      window.setTimeout(() => {
        this.suppressClick = false
      }, 0)
    }
  }

  handlePointerUp(event) {
    this.finishPointer(event)
  }

  handlePointerCancel(event) {
    this.finishPointer(event, true)
  }
}
