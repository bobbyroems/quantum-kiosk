import { DragRotationController } from './DragRotationController.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

export class SceneBase {
  constructor({ panel, getThree }) {
    this.panel = panel
    this.getThree = getThree
    this._RoomEnvironment = RoomEnvironment

    this.view = null
    this.canvasHost = null
    this.overlay = null

    this.renderer = null
    this.scene = null
    this.camera = null
    this.sceneGroup = null
    this.animationId = null
    this.resizeObserver = null
    this.usesWindowResize = false
    this.disposed = false
    this.three = null
    this.rotationController = null
    this.rotationTarget = null
    this.environmentMap = null
    this.pmremGenerator = null
    this._isSceneReady = false
    this._readyPromise = new Promise((resolve) => {
      this._resolveReady = resolve
    })
    this._warmupDone = false
    this._animationPaused = false
  }

  init() {
    this._initDom()
    this._bindEvents()
    this._loadThree()
  }

  destroy() {
    if (this.disposed) return
    this.disposed = true

    if (this.rotationController) {
      this.rotationController.destroy()
      this.rotationController = null
    }

    if (this.usesWindowResize) {
      window.removeEventListener('resize', this._resizeRenderer)
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
    }

    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
    }

    if (this.environmentMap) {
      this.environmentMap.dispose()
      this.environmentMap = null
      if (this.scene) {
        this.scene.environment = null
      }
    }
    if (this.pmremGenerator) {
      this.pmremGenerator.dispose()
      this.pmremGenerator = null
    }

    this._disposeScene()

    if (this.renderer) {
      if (typeof this.renderer.forceContextLoss === 'function') {
        this.renderer.forceContextLoss()
      }
      this.renderer.dispose()
      if (this.renderer.domElement && this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement)
      }
      this.renderer = null
    }

    this.scene = null
    this.camera = null
    this.sceneGroup = null
    this.three = null

    this._onDestroy()
  }

  _onDestroy() {
    // Override in subclass for additional cleanup
  }

  _initDom() {
    this.panel.innerHTML = `
      <div class="compute-view" data-swipe-ignore="true">
        <div class="compute-canvas"></div>
        <div class="compute-overlay"></div>
      </div>
    `
    this.view = this.panel.querySelector('.compute-view')
    this.canvasHost = this.panel.querySelector('.compute-canvas')
    this.overlay = this.panel.querySelector('.compute-overlay')
  }

  _bindEvents() {
    if (!this.disableRotation) {
      this.rotationController = new DragRotationController({ view: this.view })
    }

    this._resizeRenderer = () => {
      if (!this.renderer || !this.camera) return
      const width = this.canvasHost.clientWidth
      const height = this.canvasHost.clientHeight
      if (!width || !height) return
      this.renderer.setSize(width, height, false)
      this.camera.aspect = width / height
      this.camera.updateProjectionMatrix()
    }

    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this._resizeRenderer())
      this.resizeObserver.observe(this.canvasHost)
    } else {
      window.addEventListener('resize', this._resizeRenderer)
      this.usesWindowResize = true
    }
  }

  _loadThree() {
    this.getThree()
      .then((THREE) => {
        if (this.disposed || !this.view.isConnected) {
          this.destroy()
          return
        }
        this.three = THREE
        this._setupRenderer(THREE)
        this._setupScene(THREE)
        this._loadEnvironment(THREE)
        this._resizeRenderer()
        this._animate()
      })
      .catch((error) => {
        console.error('[scene] Failed to load three.js', error)
      })
  }

  whenReady() {
    if (this._isSceneReady) return Promise.resolve()
    return this._readyPromise
  }

  _markReady() {
    if (this._isSceneReady) return
    this._isSceneReady = true
    if (this._resolveReady) {
      this._resolveReady()
      this._resolveReady = null
    }
  }

  async warmupShaders() {
    if (this._warmupDone || !this.renderer || !this.scene || !this.camera || !this.three) return
    if (typeof this._beforeWarmup === 'function') {
      await this._beforeWarmup()
    }
    if (typeof this._resizeRenderer === 'function') {
      this._resizeRenderer()
    }
    try {
      this.renderer.compile(this.scene, this.camera)
      const target = new this.three.WebGLRenderTarget(1, 1)
      this.renderer.setRenderTarget(target)
      this.renderer.render(this.scene, this.camera)
      this.renderer.setRenderTarget(null)
      target.dispose()
    } catch (error) {
      console.warn('[scene] Shader warmup failed', error)
    }
    if (typeof this._afterWarmup === 'function') {
      this._afterWarmup()
    }
    this._warmupDone = true
  }

  _setupRenderer(THREE) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.canvasHost.appendChild(this.renderer.domElement)
  }

  _setupScene(THREE) {
    this.scene = new THREE.Scene()
    this.sceneGroup = new THREE.Group()
    this.scene.add(this.sceneGroup)
    // Override in subclass
  }

  _centerSceneGroup() {
    if (!this.sceneGroup || !this.three) return null
    const box = new this.three.Box3().setFromObject(this.sceneGroup)
    const center = new this.three.Vector3()
    box.getCenter(center)
    if (Number.isNaN(center.x) || Number.isNaN(center.y) || Number.isNaN(center.z)) return null
    this.sceneGroup.position.sub(center)
    return center
  }

  _loadEnvironment(THREE) {
    if (this.disposed || !this.scene || !this.renderer) return
    try {
      const envScene = new this._RoomEnvironment()
      const pmremGenerator = new THREE.PMREMGenerator(this.renderer)
      pmremGenerator.compileEquirectangularShader()
      const envTexture = pmremGenerator.fromScene(envScene).texture
      this.scene.environment = envTexture
      this.scene.environmentIntensity = 0.5
      this.environmentMap = envTexture
      this.pmremGenerator = pmremGenerator
      this._onEnvironmentLoaded(envTexture)
    } catch (error) {
      console.error('[scene] Failed to load environment', error)
    }
  }

  _onEnvironmentLoaded(envTexture) {
    // Override in subclass if needed
  }

  _disposeScene() {
    if (!this.scene) return
    const materials = new Set()
    const geometries = new Set()
    this.scene.traverse((object) => {
      if (object.isMesh) {
        if (object.geometry) geometries.add(object.geometry)
        const material = object.material
        if (Array.isArray(material)) {
          material.forEach(item => materials.add(item))
        } else if (material) {
          materials.add(material)
        }
      }
    })
    geometries.forEach(geometry => geometry.dispose())
    materials.forEach(material => material.dispose())
  }

  _animate() {
    if (this.disposed) return
    if (this._animationPaused) return
    if (!this.view.isConnected) {
      this.destroy()
      return
    }

    this._update()

    if (this.rotationController) {
      const { x, y } = this.rotationController.update()
      this._applyDragRotation({ x, y })
    }

    this.renderer.render(this.scene, this.camera)
    this.animationId = requestAnimationFrame(() => this._animate())
  }

  pauseAnimation() {
    this._animationPaused = true
    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
  }

  resumeAnimation() {
    if (!this._animationPaused) return
    this._animationPaused = false
    this._animate()
  }

  attachToPanel(panel) {
    if (!panel || !this.view) return
    panel.innerHTML = ''
    panel.appendChild(this.view)
    this.panel = panel
  }

  _update() {
    // Override in subclass for per-frame updates
  }

  _applyDragRotation({ x, y }) {
    const target = this.rotationTarget || this.sceneGroup
    if (!target) return
    target.rotation.x = x
    target.rotation.y = y
    target.rotation.z = 0
  }
}
