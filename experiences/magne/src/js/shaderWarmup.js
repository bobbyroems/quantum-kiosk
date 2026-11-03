class ShaderWarmup {
  constructor() {
    this._started = false
    this._running = false
    this._scenes = []
    this._sceneMap = new Map()
    this._panelMap = new Map()
    this._host = null
  }

  start() {
    if (this._started) return
    this._started = true
    const schedule = window.requestIdleCallback
      ? (fn) => window.requestIdleCallback(fn, { timeout: 2000 })
      : (fn) => window.setTimeout(fn, 200)
    schedule(() => this._run())
  }

  async _run() {
    if (this._running) return
    this._running = true
    if (!window.THREE || !document.body) return

    this._host = document.createElement('div')
    this._host.className = 'shader-warmup-host'
    this._host.style.cssText = [
      'position: absolute',
      'width: 2px',
      'height: 2px',
      'left: -9999px',
      'top: -9999px',
      'opacity: 0',
      'pointer-events: none',
      'overflow: hidden'
    ].join('; ')
    document.body.appendChild(this._host)

    const makePanel = (label) => {
      const panel = document.createElement('div')
      panel.dataset.label = label
      panel.style.width = '2px'
      panel.style.height = '2px'
      this._host.appendChild(panel)
      this._panelMap.set(label, panel)
      return panel
    }

    const getThree = () => Promise.resolve(window.THREE)
    const gridConfig = { rows: 5, cols: 5, spacing: 1.6, radius: 0.45 }

    try {
      const [gridMod, hexMod, flowMod] = await Promise.all([
        import('./scenes/ComputeGridScene.js'),
        import('./scenes/ComputeHexScene.js'),
        import('./scenes/ComputeFlowScene.js')
      ])

      const grid = new gridMod.ComputeGridScene({
        panel: makePanel('compute-grid'),
        gridConfig,
        getThree,
        initialStage: 1
      })
      const hex = new hexMod.ComputeHexScene({
        panel: makePanel('compute-hex'),
        getThree
      })
      const flow = new flowMod.ComputeFlowScene({
        panel: makePanel('compute-flow'),
        getThree
      })

      this._scenes = [grid, hex, flow]
      this._sceneMap.set('compute-grid', grid)
      this._sceneMap.set('compute-hex', hex)
      this._sceneMap.set('compute-flow', flow)

      await Promise.all(this._scenes.map((scene) => this._warmScene(scene)))
      this._scenes.forEach((scene) => {
        if (scene && typeof scene.pauseAnimation === 'function') {
          scene.pauseAnimation()
        }
      })
    } catch (error) {
      console.warn('[warmup] Failed to preheat shaders', error)
      this._cleanup()
    }
  }

  async _warmScene(scene) {
    if (!scene || typeof scene.warmupShaders !== 'function') return
    await this._waitReady(scene, 7000)
    await scene.warmupShaders()
  }

  adopt(label, panel) {
    if (!panel || !label) return null
    const scene = this._sceneMap.get(label)
    if (!scene) return null

    if (typeof scene.attachToPanel === 'function') {
      scene.attachToPanel(panel)
    } else if (scene.view) {
      panel.innerHTML = ''
      panel.appendChild(scene.view)
      scene.panel = panel
    }

    if (typeof scene.resumeAnimation === 'function') {
      scene.resumeAnimation()
    }

    this._sceneMap.delete(label)
    this._panelMap.delete(label)
    this._cleanupHostIfEmpty()
    return scene
  }

  _waitReady(scene, timeoutMs) {
    if (!scene || typeof scene.whenReady !== 'function') return Promise.resolve()
    let timeoutId = null
    const timeoutPromise = new Promise((resolve) => {
      timeoutId = window.setTimeout(resolve, timeoutMs)
    })
    return Promise.race([scene.whenReady(), timeoutPromise]).finally(() => {
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
    })
  }

  _cleanupHostIfEmpty() {
    if (!this._host || this._sceneMap.size > 0) return
    if (this._host.parentNode) {
      this._host.parentNode.removeChild(this._host)
    }
    this._host = null
  }

  _cleanup() {
    this._scenes.forEach((scene) => {
      if (scene && typeof scene.destroy === 'function') {
        scene.destroy()
      }
    })
    this._scenes = []
    this._sceneMap.clear()
    this._panelMap.clear()
    if (this._host && this._host.parentNode) {
      this._host.parentNode.removeChild(this._host)
    }
    this._host = null
  }
}

window.ShaderWarmup = new ShaderWarmup()
