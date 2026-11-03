import { SceneBase } from './SceneBase.js'
import { createQuantumSphereFactory } from './QuantumSphere.js'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'

const getNumber = (value, fallback) => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
)

const clampNumber = (value, min, max, fallback) => {
  const num = getNumber(value, fallback)
  return Math.max(min, Math.min(max, num))
}

const clampInt = (value, min, max, fallback) => {
  const num = getNumber(value, fallback)
  const intVal = Math.floor(num)
  return Math.max(min, Math.min(max, intVal))
}

const randomInt = (min, max) => (
  Math.floor(Math.random() * (max - min + 1)) + min
)

const pickRandomIndices = (total, count) => {
  if (count <= 0 || total <= 0) return []
  const clampedCount = Math.min(count, total)
  const indices = Array.from({ length: total }, (_val, index) => index)
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = indices[i]
    indices[i] = indices[j]
    indices[j] = temp
  }
  return indices.slice(0, clampedCount)
}

export class ComputeFlowScene extends SceneBase {
  constructor({ panel, getThree }) {
    super({ panel, getThree })

    this._active = false
    this._spawnTimer = null
    this._cleanupTimers = new Set()
    this._tweens = new Set()
    this._balls = new Set()
    this._lineMaterials = new Set()
    this._flowConfig = null
    this._handoff = null
    this._batchIndex = 0
    this._ready = false
    this._pendingStart = false

    this._ballGroup = null
    this._ballBaseRadius = 0.28
    this._ballScale = 1
    this._planeZ = 0
    this._viewport = { width: 0, height: 0 }
    this._warmupBall = null

    this.sphereFactory = null
    this._tmpNdc = null
    this._tmpDir = null
    this._tmpTarget = null

    this.init()
  }

  isActive() {
    return this._active
  }

  start({ flowConfig, handoff, force = false } = {}) {
    if (this._active && !force) return
    this.stop()

    if (!flowConfig) return
    this._flowConfig = flowConfig
    this._handoff = handoff || null
    this._active = true
    this._batchIndex = 0
    this._pendingStart = true

    if (this._ready) {
      this._pendingStart = false
      this._beginSpawning()
    }
  }

  stop() {
    if (this._spawnTimer) {
      clearInterval(this._spawnTimer)
      this._spawnTimer = null
    }

    this._cleanupTimers.forEach((timerId) => {
      clearTimeout(timerId)
    })
    this._cleanupTimers.clear()

    this._tweens.forEach((tween) => {
      if (tween && typeof tween.kill === 'function') {
        tween.kill()
      }
    })
    this._tweens.clear()

    Array.from(this._balls).forEach((ball) => {
      this._cleanupBall(ball)
    })
    this._balls.clear()

    this._active = false
    this._flowConfig = null
    this._handoff = null
    this._batchIndex = 0
    this._pendingStart = false
  }

  _onDestroy() {
    this.stop()

    if (this.sphereFactory) {
      this.sphereFactory.dispose()
      this.sphereFactory = null
    }

    this._lineMaterials.forEach((material) => {
      if (material && typeof material.dispose === 'function') {
        material.dispose()
      }
    })
    this._lineMaterials.clear()
  }

  _initDom() {
    let host = this.panel.querySelector('.compute-flow-balls')
    if (!host) {
      host = document.createElement('div')
      host.className = 'compute-flow-balls'
      this.panel.appendChild(host)
    }

    host.innerHTML = `
      <div class="compute-view compute-flow-view" data-swipe-ignore="true">
        <div class="compute-canvas"></div>
        <div class="compute-overlay"></div>
      </div>
    `
    this.view = host.querySelector('.compute-view')
    this.canvasHost = host.querySelector('.compute-canvas')
    this.overlay = host.querySelector('.compute-overlay')
  }

  _setupScene(THREE) {
    this.scene = new THREE.Scene()

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
    this.camera.position.set(0, 0, 10)
    this.camera.lookAt(0, 0, 0)

    const ambient = new THREE.AmbientLight(0xffffff, 0.0)
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.0)
    keyLight.position.set(2, 4, 6)
    this.scene.add(ambient, keyLight)

    this.sceneGroup = new THREE.Group()
    this.scene.add(this.sceneGroup)
    this._ballGroup = new THREE.Group()
    this.sceneGroup.add(this._ballGroup)

    this._tmpNdc = new THREE.Vector3()
    this._tmpDir = new THREE.Vector3()
    this._tmpTarget = new THREE.Vector3()

    this._loadLine2Components(THREE).then((Line2Components) => {
      if (this.disposed) return
      this.sphereFactory = createQuantumSphereFactory(
        THREE,
        { radius: this._ballBaseRadius, dashedLineWidth: 0.5 },
        Line2Components
      )
      this._ready = true
      this._markReady()
      this._wrapResize()
      this._updateBallScale()

      if (this._pendingStart) {
        this._pendingStart = false
        this._beginSpawning()
      }
    })
  }

  async _loadLine2Components(THREE) {
    return { Line2, LineMaterial, LineGeometry }
  }

  _wrapResize() {
    if (this._resizeWrapped) return
    const originalResize = this._resizeRenderer
    this._resizeRenderer = () => {
      originalResize()
      const width = this.canvasHost ? this.canvasHost.clientWidth : 0
      const height = this.canvasHost ? this.canvasHost.clientHeight : 0
      if (!width || !height) return
      this._viewport.width = width
      this._viewport.height = height
      if (this.sphereFactory) {
        this.sphereFactory.updateResolution(width, height)
      }
      this._lineMaterials.forEach((material) => {
        if (material && material.resolution && typeof material.resolution.set === 'function') {
          material.resolution.set(width, height)
        }
      })
      this._updateBallScale(width, height)
    }
    this._resizeWrapped = true
  }

  async _beforeWarmup() {
    if (this._warmupBall || !this.sphereFactory || !this._ballGroup) return
    const ball = this._createBall('#0078d4')
    if (!ball || !ball.group) return
    ball.group.visible = false
    this._ballGroup.add(ball.group)
    this._warmupBall = ball
  }

  _afterWarmup() {
    if (!this._warmupBall) return
    this._cleanupBall(this._warmupBall)
    this._warmupBall = null
  }

  attachToPanel(panel) {
    if (!panel || !this.view) return
    const host = panel.querySelector('.compute-flow-balls') || panel
    host.innerHTML = ''
    host.appendChild(this.view)
    this.panel = panel
  }

  _updateBallScale(width = this._viewport.width, height = this._viewport.height) {
    if (!this.camera || !width || !height || !this.three) return

    const sizeRatio = clampNumber(
      this._flowConfig && this._flowConfig.flowBallSizeRatio,
      0.001,
      1,
      18 / 1080
    )
    const diameterPx = width * sizeRatio
    const radiusPx = diameterPx * 0.5
    const distance = Math.abs(this.camera.position.z - this._planeZ)
    const vFov = (this.camera.fov * Math.PI) / 180
    const visibleHeight = 2 * Math.tan(vFov / 2) * distance
    const unitsPerPixel = visibleHeight / height
    const targetRadius = radiusPx * unitsPerPixel
    this._ballScale = targetRadius / this._ballBaseRadius

    this._balls.forEach((ball) => {
      if (ball && ball.group) {
        ball.group.scale.setScalar(this._ballScale)
      }
    })
  }

  _beginSpawning() {
    this._spawnBatch()

    const spawnInterval = getNumber(this._flowConfig.flowSpawnInterval, 0)
    if (spawnInterval > 0) {
      this._spawnTimer = window.setInterval(() => {
        this._spawnBatch()
      }, spawnInterval * 1000)
    }
  }

  _spawnBatch() {
    if (!this._active || !this._flowConfig || !this.camera || !this.sphereFactory) return

    const rect = this.canvasHost ? this.canvasHost.getBoundingClientRect() : null
    const width = rect ? rect.width : 0
    const height = rect ? rect.height : 0
    if (!width || !height) return

    this._viewport.width = width
    this._viewport.height = height
    this._updateBallScale(width, height)

    const flowConfig = this._flowConfig
    const handoff = this._handoff

    const laneCount = clampInt(flowConfig.laneCount, 1, 12, 6)
    const barHeightRatio = handoff && handoff.barHeightRatio ? handoff.barHeightRatio : flowConfig.barHeightRatio
    const barYOffsetRatio = handoff && typeof handoff.barYOffsetRatio === 'number'
      ? handoff.barYOffsetRatio
      : flowConfig.barYOffsetRatio

    let laneYs = []
    if (handoff && Array.isArray(handoff.laneRatios) && handoff.laneRatios.length) {
      laneYs = handoff.laneRatios.map(ratio => ratio * height)
    } else if (window.FlowLanes && typeof window.FlowLanes.getFlowLanes === 'function') {
      const lanes = window.FlowLanes.getFlowLanes({
        width,
        height,
        laneCount,
        barHeightRatio,
        barYOffsetRatio
      })
      laneYs = lanes && Array.isArray(lanes.laneYs) ? lanes.laneYs : []
    }

    if (!laneYs.length) return
    if (laneYs.length > laneCount) {
      laneYs = laneYs.slice(0, laneCount)
    }

    const effectiveLanes = laneYs.length
    const flowColor = flowConfig.flowColor || '#0078d4'
    const highlightStartColor = flowConfig.flowHighlightStartColor || '#F4364C'
    const highlightMidColor = flowConfig.flowHighlightMidColor || '#52b471'
    const fadeInDuration = clampNumber(flowConfig.flowFadeInDuration, 0, 5, 0.4)
    const colorFadeDuration = clampNumber(flowConfig.flowColorFadeDuration, 0, 5, 0.35)
    const fadeOutDuration = clampNumber(flowConfig.flowFadeOutDuration, 0, 5, 0.5)
    const travelDuration = clampNumber(flowConfig.flowTravelDuration, 0.1, 60, 8)

    const clampSectionStart = (value, fallback) => (
      typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(1, value))
        : fallback
    )
    const sectionOneStart = clampSectionStart(flowConfig.sectionOneStart, 0)
    const sectionTwoStart = Math.max(sectionOneStart, clampSectionStart(flowConfig.sectionTwoStart, 0.25))
    const sectionThreeStart = Math.max(sectionTwoStart, clampSectionStart(flowConfig.sectionThreeStart, 0.5))
    const sectionFourStart = Math.max(sectionThreeStart, clampSectionStart(flowConfig.sectionFourStart, 0.75))

    const edgeOffset = width * getNumber(flowConfig.flowEdgeOffsetRatio, 0)
    const startX = edgeOffset
    const endX = width + edgeOffset
    const sectionTwoTime = travelDuration * sectionTwoStart
    const sectionThreeTime = travelDuration * sectionThreeStart
    const sectionFourTime = travelDuration * sectionFourStart

    const highlightMax = clampInt(flowConfig.flowHighlightMax, 0, effectiveLanes, 0)
    const highlightMin = clampInt(flowConfig.flowHighlightMin, 0, highlightMax, 0)
    const firstBatchMin = clampInt(flowConfig.flowHighlightFirstMin, 0, highlightMax, 2)
    const batchMin = this._batchIndex === 0 ? Math.max(highlightMin, firstBatchMin) : highlightMin
    const highlightCount = highlightMax > 0 ? randomInt(batchMin, highlightMax) : 0
    const highlightIndices = pickRandomIndices(effectiveLanes, highlightCount)
    const highlightSet = new Set(highlightIndices)

    const gsap = window.gsap
    const flowColorObj = new this.three.Color(flowColor)
    const highlightMidObj = new this.three.Color(highlightMidColor)

    for (let i = 0; i < effectiveLanes; i += 1) {
      const laneY = laneYs[i]
      const startWorld = this._screenToWorld(startX, laneY, this._tmpTarget.clone())
      const endWorld = this._screenToWorld(endX, laneY, this._tmpTarget.clone())
      const isHighlight = highlightSet.has(i)
      const initialColor = isHighlight ? highlightStartColor : flowColor

      const ball = this._createBall(initialColor)
      if (!ball) continue

      ball.group.position.set(startWorld.x, startWorld.y, startWorld.z)
      ball.group.scale.setScalar(this._ballScale)
      this._ballGroup.add(ball.group)
      this._balls.add(ball)

      if (gsap) {
        const opacity = { value: 0 }
        this._applyBallOpacity(ball, 0)
        const timeline = gsap.timeline({
          onComplete: () => {
            this._cleanupBall(ball, timeline)
          }
        })

        timeline.to(ball.group.position, {
          x: endWorld.x,
          duration: travelDuration,
          ease: 'none'
        }, 0)

        if (fadeInDuration > 0) {
          timeline.to(opacity, {
            value: 1,
            duration: fadeInDuration,
            ease: 'power1.out',
            onUpdate: () => this._applyBallOpacity(ball, opacity.value)
          }, 0)
        } else {
          this._applyBallOpacity(ball, 1)
        }

        if (isHighlight) {
          timeline.to(ball.sphereMaterial.color, {
            r: highlightMidObj.r,
            g: highlightMidObj.g,
            b: highlightMidObj.b,
            duration: colorFadeDuration,
            ease: 'power1.out'
          }, sectionTwoTime)
        }

        timeline.to(ball.sphereMaterial.color, {
          r: flowColorObj.r,
          g: flowColorObj.g,
          b: flowColorObj.b,
          duration: colorFadeDuration,
          ease: 'power1.out'
        }, sectionThreeTime)

        timeline.to(opacity, {
          value: 0,
          duration: fadeOutDuration,
          ease: 'power1.out',
          onUpdate: () => this._applyBallOpacity(ball, opacity.value)
        }, sectionFourTime)

        this._tweens.add(timeline)
      } else {
        this._applyBallOpacity(ball, 1)
        ball.group.position.x = endWorld.x
        const cleanupTimer = window.setTimeout(() => {
          this._cleanupTimer(cleanupTimer)
          this._cleanupBall(ball)
        }, travelDuration * 1000)
        this._cleanupTimers.add(cleanupTimer)
      }
    }

    this._batchIndex += 1
  }

  _screenToWorld(x, y, target) {
    const width = this._viewport.width
    const height = this._viewport.height
    if (!width || !height || !this.camera || !target) return target

    const ndcX = (x / width) * 2 - 1
    const ndcY = -((y / height) * 2 - 1)
    this._tmpNdc.set(ndcX, ndcY, 0.5).unproject(this.camera)
    this._tmpDir.copy(this._tmpNdc).sub(this.camera.position).normalize()

    const denom = this._tmpDir.z || 1
    const distance = (this._planeZ - this.camera.position.z) / denom
    return target.copy(this.camera.position).add(this._tmpDir.multiplyScalar(distance))
  }

  _createBall(initialColor) {
    if (!this.sphereFactory) return null
    const group = this.sphereFactory.create()
    group.rotation.set(0, 0.2, 0)

    const { sphere, verticalCircle, horizontalCircle } = group.userData || {}
    if (!sphere || !sphere.material) return null

    const sphereMaterial = sphere.material.clone()
    sphereMaterial.transparent = true
    sphereMaterial.opacity = 1
    sphereMaterial.color.set(initialColor)
    sphere.material = sphereMaterial

    const lineMaterials = []
    if (verticalCircle && verticalCircle.material) {
      const material = verticalCircle.material.clone()
      material.transparent = true
      material.opacity = 1
      verticalCircle.material = material
      lineMaterials.push(material)
      this._trackLineMaterial(material)
    }

    if (horizontalCircle && horizontalCircle.material) {
      const material = horizontalCircle.material.clone()
      material.transparent = true
      material.opacity = 1
      horizontalCircle.material = material
      lineMaterials.push(material)
      this._trackLineMaterial(material)
    }

    return {
      group,
      sphereMaterial,
      lineMaterials
    }
  }

  _trackLineMaterial(material) {
    if (!material) return
    if (material.resolution && typeof material.resolution.set === 'function') {
      material.resolution.set(this._viewport.width || 1, this._viewport.height || 1)
    }
    this._lineMaterials.add(material)
  }

  _applyBallOpacity(ball, value) {
    if (!ball || !ball.sphereMaterial) return
    ball.sphereMaterial.opacity = value
    if (Array.isArray(ball.lineMaterials)) {
      ball.lineMaterials.forEach((material) => {
        if (material) {
          material.opacity = value
        }
      })
    }
  }

  _cleanupTimer(timerId) {
    if (!timerId) return
    clearTimeout(timerId)
    this._cleanupTimers.delete(timerId)
  }

  _cleanupBall(ball, tween) {
    if (!ball) return
    if (tween) {
      this._tweens.delete(tween)
    }

    if (ball.group && ball.group.parent) {
      ball.group.parent.remove(ball.group)
    }

    if (ball.sphereMaterial && typeof ball.sphereMaterial.dispose === 'function') {
      ball.sphereMaterial.dispose()
    }

    if (Array.isArray(ball.lineMaterials)) {
      ball.lineMaterials.forEach((material) => {
        this._lineMaterials.delete(material)
        if (material && typeof material.dispose === 'function') {
          material.dispose()
        }
      })
    }

    this._balls.delete(ball)
  }
}
