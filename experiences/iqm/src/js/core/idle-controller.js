const ACTIVITY_EVENTS = ['pointerdown', 'keydown']

export class IdleController {
  constructor({ timeoutMs, onIdle }) {
    this.timeoutMs = timeoutMs
    this.onIdle = onIdle
    this.timer = null
    this.enabled = false
    this.reset = this.reset.bind(this)
  }

  start(timeoutMs) {
    if (timeoutMs !== undefined) this.timeoutMs = timeoutMs
    if (!this.enabled) {
      this.enabled = true
      ACTIVITY_EVENTS.forEach(eventName => {
        window.addEventListener(eventName, this.reset, { passive: true, capture: true })
      })
    }
    this.reset()
  }

  stop() {
    this.enabled = false
    window.clearTimeout(this.timer)
    this.timer = null
    ACTIVITY_EVENTS.forEach(eventName => {
      window.removeEventListener(eventName, this.reset, { capture: true })
    })
  }

  reset() {
    if (!this.enabled) return
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.onIdle?.(), this.timeoutMs)
  }
}
