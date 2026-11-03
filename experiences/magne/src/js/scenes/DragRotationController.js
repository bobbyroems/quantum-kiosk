export class DragRotationController {
  constructor({ view, config = {} } = {}) {
    this.view = view
    this.rotation = {
      targetX: 0,
      targetY: 0,
      currentX: 0,
      currentY: 0
    }
    this.rotationConfig = {
      limitRad: (30 * Math.PI) / 180,
      maxTarget: (90 * Math.PI) / 180,
      sensitivity: 0.004,
      easing: 0.12,
      returnEase: 0.1,
      ...config
    }
    this.pointer = {
      isDown: false,
      id: null,
      lastX: 0,
      lastY: 0
    }

    this._bind()
  }

  _bind() {
    if (!this.view) return
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

    this._handlePointerDown = (event) => {
      this.pointer.isDown = true
      this.pointer.id = event.pointerId
      this.pointer.lastX = event.clientX
      this.pointer.lastY = event.clientY
      this.view.classList.add('is-dragging')
      this.view.setPointerCapture(this.pointer.id)
    }

    this._handlePointerMove = (event) => {
      if (!this.pointer.isDown || event.pointerId !== this.pointer.id) return

      const deltaX = event.clientX - this.pointer.lastX
      const deltaY = event.clientY - this.pointer.lastY

      this.pointer.lastX = event.clientX
      this.pointer.lastY = event.clientY

      this.rotation.targetY += deltaX * this.rotationConfig.sensitivity
      this.rotation.targetX += deltaY * this.rotationConfig.sensitivity

      this.rotation.targetX = clamp(this.rotation.targetX, -this.rotationConfig.maxTarget, this.rotationConfig.maxTarget)
      this.rotation.targetY = clamp(this.rotation.targetY, -this.rotationConfig.maxTarget, this.rotationConfig.maxTarget)
    }

    this._handlePointerUp = (event) => {
      if (event.pointerId !== this.pointer.id) return
      this.pointer.isDown = false
      this.pointer.id = null
      this.view.classList.remove('is-dragging')
      if (this.view.hasPointerCapture(event.pointerId)) {
        this.view.releasePointerCapture(event.pointerId)
      }
    }

    this.view.addEventListener('pointerdown', this._handlePointerDown)
    this.view.addEventListener('pointermove', this._handlePointerMove)
    window.addEventListener('pointerup', this._handlePointerUp)
    window.addEventListener('pointercancel', this._handlePointerUp)
  }

  update() {
    if (!this.pointer.isDown) {
      this.rotation.targetX += (0 - this.rotation.targetX) * this.rotationConfig.returnEase
      this.rotation.targetY += (0 - this.rotation.targetY) * this.rotationConfig.returnEase
    }

    const limitedX = this.rotationConfig.limitRad * Math.tanh(this.rotation.targetX / this.rotationConfig.limitRad)
    const limitedY = this.rotationConfig.limitRad * Math.tanh(this.rotation.targetY / this.rotationConfig.limitRad)

    this.rotation.currentX += (limitedX - this.rotation.currentX) * this.rotationConfig.easing
    this.rotation.currentY += (limitedY - this.rotation.currentY) * this.rotationConfig.easing

    return { x: this.rotation.currentX, y: this.rotation.currentY }
  }

  destroy() {
    if (!this.view) return
    if (this.pointer.id !== null && this.view.hasPointerCapture(this.pointer.id)) {
      this.view.releasePointerCapture(this.pointer.id)
    }
    this.view.removeEventListener('pointerdown', this._handlePointerDown)
    this.view.removeEventListener('pointermove', this._handlePointerMove)
    window.removeEventListener('pointerup', this._handlePointerUp)
    window.removeEventListener('pointercancel', this._handlePointerUp)
  }
}
