import { SceneBase } from './SceneBase.js'
import { createQuantumSphereFactory } from './QuantumSphere.js'
import { createDimensionLines, createCalloutFromDefinition, CALLOUT_DEFINITIONS } from './DimensionLines.js'
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'

export class ComputeGridScene extends SceneBase {
  constructor({ panel, gridConfig, getThree, initialStage = 1 }) {
    super({ panel, getThree })
    this.gridConfig = gridConfig

    this.isReady = false
    this.pendingStage = null
    this.stage = initialStage
    this.highlights = []
    this.stageTimeline = null
    this.sphereHomePositions = new Map()
    this.cameraDefaults = { z: 50, y: -3 }
    this.cameraZoomStage2 = { z: 35, y: -1.2 }
    this.cameraZoomStage3 = { z: 22, y: 2 }
    this.cameraPan = { y: 0 }
    this.cameraTarget = { x: 0, y: 0, z: 0 }

    this._tmpWorld = null
    this._tmpScreen = null
    this._tmpEdge = null
    this._tmpScale = null
    this._tmpRight = null

    this.sphereGrid = []
    this.sphereLookup = new Map()
    this.sphereFactory = null
    this.selectedSpheres = []
    this.selectedColor = 0x46b4c5
    this.defaultColor = 0x0078d4
    this.page0Opacity = 0.5
    this.jitterActive = false
    this.jitterConfig = {
      scale: 0.8,
      minAmplitude: this.gridConfig.radius * 0.1,
      maxAmplitude: this.gridConfig.radius * 0.18,
      minSpeed: 3.8,
      maxSpeed: 8.6,
      microSpeed: 18.4,
      microAmplitudeFactor: 0.2,
      zFactor: 0.6,
      stepRate: 10
    }
    this.glowConfig = {
      intensity: 0.7,
      color: this.defaultColor,
      baseIntensity: null,
      baseColor: null
    }
    this.ghostConfig = {
      color: this.defaultColor,
      opacity: 0.2,
      opacityFalloff: 0.5,
      scale: 1.12,
      trailCount: 5,
      trailStep: 6,
      historySize: 48,
      stretch: 1.3
    }
    this.ghostGroup = null
    this.ghostMaterials = []
    this._jitterStepIndex = null
    this.dimensionLines = null
    this.stage2DimensionLines = null
    this.stage3DimensionLines = null
    this.css3DRenderer = null
    this._dragHintSuppressed = false
    this._timers = new Set()

    this.init()
  }

  setStage(stage) {
    this.stage = stage
    if (!this.isReady) {
      this.pendingStage = stage
      return
    }
    this._applyStage(stage)
  }

  /**
   * Triggers the entanglement animation (lifts spheres) if on stage 3 and not already done.
   * @returns {boolean} true if animation was triggered, false if already done or not on stage 3
   */
  triggerEntanglement() {
    // Only works on stage 3
    if (this.stage !== 3) return false

    // Check if spheres are already lifted
    const alreadyLifted = this._stage3LiftedCount >= 2
    if (alreadyLifted) return false

    // Trigger the lift animation
    this._hideDragHint()
    this._dragHintSuppressed = true
    this._liftAllSpheres()
    return true
  }

  /**
   * Check if entanglement animation has been completed
   * @returns {boolean} true if on stage 3 and spheres have been lifted
   */
  isEntanglementComplete() {
    return this.stage === 3 && this._stage3LiftedCount >= 2
  }

  _onDestroy() {
    this._clearTimers()
    if (this.stageTimeline) {
      this.stageTimeline.kill()
      this.stageTimeline = null
    }
    this._clearHighlights()
    this._disposeStage3Gradient()
    this.sphereGrid = []
    this.sphereLookup = new Map()
    if (this.sphereFactory) {
      this.sphereFactory.dispose()
      this.sphereFactory = null
    }
    if (this.ghostGroup && this.ghostGroup.parent) {
      this.ghostGroup.parent.remove(this.ghostGroup)
    }
    this.ghostGroup = null
    if (this.ghostMaterials.length) {
      this.ghostMaterials.forEach((material) => material.dispose())
    }
    this.ghostMaterials = []
    if (this.css3DRenderer && this.css3DRenderer.domElement && this.css3DRenderer.domElement.parentNode) {
      this.css3DRenderer.domElement.parentNode.removeChild(this.css3DRenderer.domElement)
      this.css3DRenderer = null
    }
    if (this.dimensionLines) {
      this.dimensionLines.dispose()
      this.dimensionLines = null
    }
    if (this.stage2DimensionLines) {
      this.stage2DimensionLines.dispose()
      this.stage2DimensionLines = null
    }
    if (this.stage3DimensionLines) {
      this.stage3DimensionLines.dispose()
      this.stage3DimensionLines = null
    }
  }

  _setupScene(THREE) {
    this.scene = new THREE.Scene()

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
    this.camera.position.set(0, this.cameraDefaults.y, this.cameraDefaults.z)
    this.camera.lookAt(0, 0, 0)
    this.cameraTarget.x = 0
    this.cameraTarget.y = 0
    this.cameraTarget.z = 0
    this.cameraDefaults.z = this.camera.position.z
    this.cameraDefaults.y = this.camera.position.y

    this._tmpWorld = new THREE.Vector3()
    this._tmpScreen = new THREE.Vector3()
    this._tmpEdge = new THREE.Vector3()
    this._tmpScale = new THREE.Vector3()
    this._tmpRight = new THREE.Vector3()

    const ambient = new THREE.AmbientLight(0xffffff, 0.00)
    const keyLight = new THREE.DirectionalLight(0xffffff, 0)
    keyLight.position.set(4, 6, 4)
    const fillLight = new THREE.DirectionalLight(0xbcd6ff, 0.0)
    fillLight.position.set(-4, 2, -6)
    this.scene.add(ambient, keyLight, fillLight)

    this.sceneGroup = new THREE.Group()
    this.scene.add(this.sceneGroup)
    this.ghostGroup = new THREE.Group()
    this.sceneGroup.add(this.ghostGroup)

    const { rows, cols, spacing, radius } = this.gridConfig

    // Load Line2 components and CSS3DRenderer for proper line width and 3D labels
    Promise.all([
      this._loadLine2Components(THREE),
      this._loadCSS3DRenderer()
    ]).then(([Line2Components, CSS3DComponents]) => {
      if (this.disposed) return
      this.sphereFactory = createQuantumSphereFactory(THREE, { radius, dashedLineWidth: 0.5 }, Line2Components)
      this.CSS3DComponents = CSS3DComponents
      this._setupCSS3DRenderer(CSS3DComponents)
      this._buildGrid(THREE, rows, cols, spacing)
    })
  }

  async _loadCSS3DRenderer() {
    return { CSS3DRenderer, CSS3DObject }
  }

  _setupCSS3DRenderer(CSS3DComponents) {
    if (!CSS3DComponents || !this.canvasHost) return

    const { CSS3DRenderer } = CSS3DComponents
    this.css3DRenderer = new CSS3DRenderer()
    this.css3DRenderer.setSize(this.canvasHost.clientWidth, this.canvasHost.clientHeight)
    this.css3DRenderer.domElement.style.position = 'absolute'
    this.css3DRenderer.domElement.style.top = '0'
    this.css3DRenderer.domElement.style.left = '0'
    this.css3DRenderer.domElement.style.pointerEvents = 'none'
    this.canvasHost.appendChild(this.css3DRenderer.domElement)

    // Wrap the resize handler to also resize CSS3DRenderer
    const originalResize = this._resizeRenderer
    this._resizeRenderer = () => {
      originalResize()
      if (this.css3DRenderer && this.canvasHost) {
        this.css3DRenderer.setSize(this.canvasHost.clientWidth, this.canvasHost.clientHeight)
      }
    }
  }

  async _loadLine2Components(THREE) {
    return { Line2, LineMaterial, LineGeometry }
  }

  _buildGrid(THREE, rows, cols, spacing) {
    if (!this.sphereFactory) return

    this.sphereGrid = []
    this.sphereLookup = new Map()
    this.sphereHomePositions = new Map()
    this._cacheGlowDefaults()

    const xOffset = (cols - 1) * spacing * 0.5
    const yOffset = (rows - 1) * spacing * 0.5

    for (let row = 0; row < rows; row++) {
      const rowItems = []
      for (let col = 0; col < cols; col++) {
        const sphereGroup = this.sphereFactory.create()
        const { sphere, horizontalCircle, verticalCircle } = sphereGroup.userData
        const ghost = this._createGhostSphere(THREE, sphere)
        const id = `sphere-${row}-${col}`
        sphereGroup.name = id
        sphereGroup.userData = {
          row, col, id,
          sphere,
          horizontalCircle,
          verticalCircle,
          ghost
        }
        sphereGroup.position.set(col * spacing - xOffset, yOffset - row * spacing, 0)
        // Rotate spheres a bit to the left and up
        sphereGroup.rotation.set(0., 0.2, 0)
        this._assignJitterData(sphereGroup)
        this.sceneGroup.add(sphereGroup)
        if (ghost && ghost.meshes && this.ghostGroup) {
          ghost.meshes.forEach((mesh) => {
            mesh.position.copy(sphereGroup.position)
            this.ghostGroup.add(mesh)
          })
        }
        rowItems.push(sphereGroup)
        this.sphereLookup.set(id, sphereGroup)
        this.sphereHomePositions.set(id, sphereGroup.position.clone())
      }
      this.sphereGrid.push(rowItems)
    }

    this._createDimensionLines(THREE)
    this._createStage2DimensionLines(THREE)
    this._createStage3DimensionLines(THREE)
    this._createStage3Gradient() // Pre-create gradient for performance
    this.sceneGroup.position.y = -1.2

    this.isReady = true
    if (this.pendingStage !== null) {
      const stage = this.pendingStage
      this.pendingStage = null
      this._applyStage(stage, { immediate: true })
    } else {
      this._applyStage(this.stage, { immediate: true })
    }
    this._markReady()
  }

  _applyStage(stage, options = {}) {
    if (!this.isReady || !this.camera) return

    const immediate = options.immediate === true
    const shouldAnimateTransition = !immediate && this.jitterActive && stage !== 1

    if (this.stageTimeline) {
      this.stageTimeline.kill()
      this.stageTimeline = null
    }

    this._clearHighlights()
    // Only reset positions here if not animating (animation handles it)
    if (!shouldAnimateTransition) {
      this._resetSpherePositions()
    }
    this._resetSphereColors()
    this._resetSphereRotations()
    this.selectedSpheres = []
    this._applySphereStyle(stage, { animate: shouldAnimateTransition })

    const gsap = window.gsap
    let targetZ = this.cameraDefaults.z
    if (stage === 2) targetZ = this.cameraZoomStage2.z
    if (stage === 3) targetZ = this.cameraZoomStage3.z
    let targetY = this.cameraPan.y
    if (stage === 1) targetY = this.cameraDefaults.y
    if (stage === 2) targetY = this.cameraZoomStage2.y
    if (stage === 3) targetY = this.cameraZoomStage3.y
    let timeline = null

    if (gsap && !immediate) {
      timeline = gsap.timeline()
      timeline.to(this.camera.position, {
        z: targetZ,
        y: targetY,
        duration: 0.45,
        ease: 'power2.out'
      })
      timeline.to(this.cameraTarget, {
        y: targetY,
        duration: 0.45,
        ease: 'power2.out'
      }, '<')
      this.stageTimeline = timeline
    } else {
      this.camera.position.z = targetZ
      this.camera.position.y = targetY
      this.cameraTarget.y = targetY
    }

    // Show/hide dimension lines based on stage
    if (this.dimensionLines) {
      if (stage === 1) {
        this.dimensionLines.fadeIn(immediate ? null : gsap)
      } else {
        this.dimensionLines.fadeOut(immediate ? null : gsap)
      }
    }

    // Add pulsing highlight to one sphere in stage 1
    if (stage === 1) {
      const pulseSphere = this._getSphere(2, 2) // Center sphere
      const pulseHighlight = this._createHighlight({ sphere: pulseSphere })
      if (pulseHighlight) {
        pulseHighlight.ring.style.opacity = '1'
        pulseHighlight.ringWrap.classList.add('clickable')

        // Stop pointer events from reaching the drag controller
        const stopPropagation = (e) => {
          e.stopPropagation()
        }
        pulseHighlight.ringWrap.addEventListener('pointerdown', stopPropagation)
        pulseHighlight.ringWrap.addEventListener('pointermove', stopPropagation)
        pulseHighlight.ringWrap.addEventListener('pointerup', stopPropagation)

        // Click handler to "protect" the sphere
        const protectHandler = (e) => {
          e.stopPropagation()
          this._protectSphere(pulseSphere, pulseHighlight)
        }
        pulseHighlight.ringWrap.addEventListener('click', protectHandler)
        pulseHighlight.clickHandler = protectHandler
      }
    }

    // Show/hide stage 2 dimension lines
    if (this.stage2DimensionLines) {
      if (stage === 2) {
        this.stage2DimensionLines.fadeIn(immediate ? null : gsap)
      } else {
        this.stage2DimensionLines.fadeOut(immediate ? null : gsap)
      }
    }

    // Show/hide stage 3 dimension lines
    // Note: In stage 3, dimension lines are shown after user drags both spheres up (see _liftSphere)
    if (this.stage3DimensionLines) {
      if (stage !== 3) {
        this.stage3DimensionLines.fadeOut(immediate ? null : gsap)
      }
      // Don't auto-show in stage 3 - wait for user interaction
    }

    const animateHighlightIn = (highlight, position) => {
      if (!highlight) return
      if (gsap && timeline) {
        timeline.fromTo(highlight.ring, { scale: 0.6, opacity: 0 }, {
          scale: 1,
          opacity: 1,
          duration: 0.225,
          ease: 'back.out(1.4)'
        }, position)
      } else {
        highlight.ring.style.opacity = '1'
      }
    }

    if (stage === 2) {
      const focusSphere = this._getSphere(0, 2)
      const highlight = this._createHighlight({ sphere: focusSphere })
      if (highlight) {
        highlight.ring.style.opacity = '1'
        highlight.ringWrap.classList.add('clickable')

        // Stop pointer events from reaching the drag controller
        const stopPropagation = (e) => {
          e.stopPropagation()
        }
        highlight.ringWrap.addEventListener('pointerdown', stopPropagation)
        highlight.ringWrap.addEventListener('pointermove', stopPropagation)
        highlight.ringWrap.addEventListener('pointerup', stopPropagation)

        // Click handler to advance to next slide
        const advanceHandler = (e) => {
          e.stopPropagation()
          if (this.panel) {
            const event = new CustomEvent('stage2AdvanceRequest', { bubbles: false })
            this.panel.dispatchEvent(event)
          }
        }
        highlight.ringWrap.addEventListener('click', advanceHandler)
        highlight.clickHandler = advanceHandler
      }
      animateHighlightIn(highlight, '-=0.2')
    }

    // Clean up stage 3 gradient if leaving stage 3
    if (stage !== 3) {
      this._removeStage3Gradient()
    }

    if (stage === 3) {
      const leftSphere = this._getSphere(0, 2)
      const rightSphere = this._getSphere(0, 3)
      this._dragHintSuppressed = false
      this._stage3LiftAmount = 2.3
      this._stage3LiftedCount = 0

      // Show gradient overlay above the spheres
      this._showStage3Gradient()

      // Prepare spheres for dragging (clone materials)
      ;[leftSphere, rightSphere].forEach((sphereGroup) => {
        if (!sphereGroup) return
        this.selectedSpheres.push(sphereGroup)
        const innerSphere = sphereGroup.userData.sphere
        if (innerSphere && innerSphere.material && !sphereGroup.userData.ownsMaterial) {
          innerSphere.material = innerSphere.material.clone()
          sphereGroup.userData.ownsMaterial = true
        }
        sphereGroup.userData.isLifted = false
      })

      // Create visual highlights for both spheres (no drag handlers)
      const leftHighlight = this._createHighlight({ sphere: leftSphere })
      const rightHighlight = this._createHighlight({ sphere: rightSphere })

      animateHighlightIn(leftHighlight, '-=0.2')
      animateHighlightIn(rightHighlight, '<')

      // Create a single drag zone that encompasses both spheres
      this._createDragZone([leftHighlight, rightHighlight])

      // Show drag hint after highlights appear
      if (timeline) {
        timeline.call(() => this._showDragHint(), null, '+=0.3')
      } else {
        this._showDragHint()
      }
    }
  }

  _setupDragHint() {
    if (this._dragHintContainer || !this.overlay) return

    // Create drag hint container
    const container = document.createElement('div')
    container.className = 'compute-drag-hint'
    this.overlay.appendChild(container)
    this._dragHintContainer = container
  }

  _showDragHint() {
    if (!this.overlay || !window.lottie) return
    if (this._dragHintSuppressed) return

    // Setup container if not exists
    this._setupDragHint()

    // Don't show again if already shown and lifted
    if (this.selectedSpheres.every(s => s.userData.isLifted)) return

    // Clean up any existing animation
    this._hideDragHint()

    // Load Lottie animation
    this._dragHintAnim = window.lottie.loadAnimation({
      container: this._dragHintContainer,
      renderer: 'svg',
      loop: true,
      autoplay: false,
      path: './assets/animations/Animation - swipe left.json'
    })

    // Show the container and play animation
    this._dragHintContainer.classList.add('visible')
    this._dragHintAnim.play()

    // Auto-hide after 5.5 seconds
    this._dragHintTimeout = this._setTimer(() => {
      this._hideDragHint()
    }, 5500)
  }

  _hideDragHint() {
    // Clear timeout if exists
    if (this._dragHintTimeout) {
      clearTimeout(this._dragHintTimeout)
      this._timers.delete(this._dragHintTimeout)
      this._dragHintTimeout = null
    }

    // Fade out
    if (this._dragHintContainer) {
      this._dragHintContainer.classList.remove('visible')
    }

    // Destroy Lottie animation after fade out
    if (this._dragHintAnim) {
      this._setTimer(() => {
        if (this._dragHintAnim) {
          this._dragHintAnim.destroy()
          this._dragHintAnim = null
        }
      }, 400) // Match CSS transition duration
    }
  }

  _resetSpherePositions() {
    if (!this.sphereHomePositions.size) return
    this.sphereHomePositions.forEach((position, id) => {
      const sphere = this.sphereLookup.get(id)
      if (sphere) {
        sphere.position.set(position.x, position.y, position.z)
      }
    })
    this._resetGhostPositions()
  }

  _resetSphereColors() {
    if (!this.three) return
    const defaultColor = new this.three.Color(this.defaultColor)
    this.sphereLookup.forEach((sphereGroup) => {
      const innerSphere = sphereGroup.userData.sphere
      if (innerSphere && innerSphere.material) {
        innerSphere.material.color.copy(defaultColor)
      }
    })
  }

  _resetSphereRotations() {
    this.selectedSpheres.forEach(sphereGroup => {
      sphereGroup.rotation.y = 0
    })
  }

  _applySphereStyle(stage, options = {}) {
    const jitterStage = stage === 1
    const previousJitterActive = this.jitterActive
    this.jitterActive = jitterStage

    if (jitterStage) {
      this._jitterStepIndex = null
    }

    // Reset protected flag on all spheres when stage changes
    this.sphereLookup.forEach((sphereGroup) => {
      if (sphereGroup.userData) {
        sphereGroup.userData.protected = false
      }
    })
    this._isProtecting = false

    const gsap = window.gsap
    const shouldAnimate = options.animate && gsap && previousJitterActive && !jitterStage

    // If transitioning from jitter (stage 1) to non-jitter (stage 2+), animate the change
    if (shouldAnimate) {
      // First, stop jitter and snap to home positions
      this._resetSpherePositions()

      // Hide ghosts immediately
      this._setGhostVisible(false)

      // Animate opacity and scale
      // Skip spheres that are already at full opacity/scale (e.g., from protect animation)
      this.sphereLookup.forEach((sphereGroup) => {
        const innerSphere = sphereGroup.userData && sphereGroup.userData.sphere
        const alreadyFullOpacity = innerSphere && innerSphere.material && innerSphere.material.opacity >= 0.9
        const alreadyFullScale = sphereGroup.scale.x >= 0.99

        if (innerSphere && innerSphere.material && !alreadyFullOpacity) {
          gsap.to(innerSphere.material, {
            opacity: 1,
            duration: 0.3,
            ease: 'power2.out'
          })
        }
        if (!alreadyFullScale) {
          gsap.to(sphereGroup.scale, {
            x: 1, y: 1, z: 1,
            duration: 0.3,
            ease: 'power2.out'
          })
        }
      })

      // Fade in the dashed lines with a slight delay
      // Skip lines that are already visible and opaque (e.g., from protect animation)
      this.sphereLookup.forEach((sphereGroup) => {
        const { verticalCircle, horizontalCircle } = sphereGroup.userData || {}
        if (verticalCircle && verticalCircle.material) {
          const alreadyVisible = verticalCircle.visible && verticalCircle.material.opacity >= 0.9
          if (!alreadyVisible) {
            verticalCircle.visible = true
            verticalCircle.material.transparent = true
            verticalCircle.material.opacity = 0
            gsap.to(verticalCircle.material, {
              opacity: 1,
              duration: 0.3,
              delay: 0.15,
              ease: 'power2.out'
            })
          }
        }
        if (horizontalCircle && horizontalCircle.material) {
          const alreadyVisible = horizontalCircle.visible && horizontalCircle.material.opacity >= 0.9
          if (!alreadyVisible) {
            horizontalCircle.visible = true
            horizontalCircle.material.transparent = true
            horizontalCircle.material.opacity = 0
            gsap.to(horizontalCircle.material, {
              opacity: 1,
              duration: 0.3,
              delay: 0.15,
              ease: 'power2.out'
            })
          }
        }
      })

      // Turn off glow
      this._setSphereGlow(false)
    } else {
      // Instant changes (for initial load or going back to stage 1)
      this._setSphereGlow(jitterStage)
      this._setSphereOpacity(jitterStage ? this.page0Opacity : 1)
      this._setSphereScale(jitterStage ? this.jitterConfig.scale : 1)
      this._setSphereLinesVisible(!jitterStage)
      this._setGhostVisible(jitterStage)
      if (jitterStage) {
        this._resetGhostPositions()
      }
    }
  }

  _setSphereScale(scale) {
    const ghostScale = scale * this.ghostConfig.scale
    this.sphereLookup.forEach((sphereGroup) => {
      sphereGroup.scale.setScalar(scale)
      const ghost = sphereGroup.userData && sphereGroup.userData.ghost
      if (ghost && ghost.meshes) {
        ghost.meshes.forEach((mesh) => {
          mesh.scale.setScalar(ghostScale)
        })
      }
    })
  }

  _setSphereLinesVisible(visible) {
    this.sphereLookup.forEach((sphereGroup) => {
      const { verticalCircle, horizontalCircle } = sphereGroup.userData || {}
      if (verticalCircle) verticalCircle.visible = visible
      if (horizontalCircle) horizontalCircle.visible = visible
    })
  }

  _setSphereOpacity(opacity) {
    const useTransparency = opacity < 1
    this.sphereLookup.forEach((sphereGroup) => {
      const innerSphere = sphereGroup.userData && sphereGroup.userData.sphere
      if (!innerSphere || !innerSphere.material) return
      innerSphere.material.transparent = useTransparency
      innerSphere.material.opacity = opacity
      innerSphere.material.needsUpdate = true
    })
  }

  _cacheGlowDefaults() {
    if (!this.three || !this.sphereFactory) return
    if (this.glowConfig.baseIntensity !== null && this.glowConfig.baseColor) return
    const material = this.sphereFactory.sphereMaterial
    if (!material) return
    this.glowConfig.baseIntensity = typeof material.emissiveIntensity === 'number' ? material.emissiveIntensity : 0
    this.glowConfig.baseColor = material.emissive ? material.emissive.clone() : new this.three.Color(0x000000)
  }

  _setSphereGlow(enabled) {
    if (!this.three) return
    this._cacheGlowDefaults()
    const intensity = enabled ? this.glowConfig.intensity : this.glowConfig.baseIntensity
    const color = enabled
      ? new this.three.Color(this.glowConfig.color)
      : (this.glowConfig.baseColor || new this.three.Color(0x000000))

    this.sphereLookup.forEach((sphereGroup) => {
      const innerSphere = sphereGroup.userData && sphereGroup.userData.sphere
      if (!innerSphere || !innerSphere.material) return
      if (innerSphere.material.emissive) {
        innerSphere.material.emissive.copy(color)
      }
      innerSphere.material.emissiveIntensity = intensity
    })
  }

  _setGhostVisible(visible) {
    this.sphereLookup.forEach((sphereGroup) => {
      const ghost = sphereGroup.userData && sphereGroup.userData.ghost
      if (ghost && ghost.meshes) {
        ghost.meshes.forEach((mesh) => {
          mesh.visible = visible
        })
      }
    })
  }

  _resetGhostPositions() {
    this.sphereLookup.forEach((sphereGroup) => {
      const ghost = sphereGroup.userData && sphereGroup.userData.ghost
      if (!ghost || !ghost.meshes) return
      const pos = sphereGroup.position
      ghost.history.forEach((entry) => entry.copy(pos))
      ghost.cursor = 0
      ghost.meshes.forEach((mesh) => mesh.position.copy(pos))
    })
  }

  _getGhostMaterial(THREE, index) {
    if (this.ghostMaterials[index]) return this.ghostMaterials[index]
    const falloff = Math.pow(this.ghostConfig.opacityFalloff, index)
    const material = new THREE.MeshBasicMaterial({
      color: this.ghostConfig.color,
      transparent: true,
      opacity: this.ghostConfig.opacity * falloff,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
      toneMapped: false
    })
    this.ghostMaterials[index] = material
    return material
  }

  _createGhostSphere(THREE, sphere) {
    if (!sphere || !sphere.geometry) return null
    const meshes = []
    for (let i = 0; i < this.ghostConfig.trailCount; i++) {
      const material = this._getGhostMaterial(THREE, i)
      if (!material) continue
      const mesh = new THREE.Mesh(sphere.geometry, material)
      mesh.renderOrder = 10 + i
      mesh.visible = false
      mesh.castShadow = false
      mesh.receiveShadow = false
      meshes.push(mesh)
    }
    if (!meshes.length) return null
    const minHistory = this.ghostConfig.trailCount * this.ghostConfig.trailStep + 2
    const historySize = Math.max(this.ghostConfig.historySize, minHistory)
    return {
      meshes,
      history: Array.from({ length: historySize }, () => new THREE.Vector3()),
      cursor: 0,
      tmp: new THREE.Vector3()
    }
  }

  _assignJitterData(sphereGroup) {
    const { minAmplitude, maxAmplitude, minSpeed, maxSpeed, microAmplitudeFactor, microSpeed, zFactor } = this.jitterConfig
    const ampX = this._randomRange(minAmplitude, maxAmplitude)
    const ampY = this._randomRange(minAmplitude, maxAmplitude) * 0.9
    const ampZ = this._randomRange(minAmplitude, maxAmplitude) * zFactor
    sphereGroup.userData.jitter = {
      ampX,
      ampY,
      ampZ,
      speedX: this._randomRange(minSpeed, maxSpeed),
      speedY: this._randomRange(minSpeed, maxSpeed),
      speedZ: this._randomRange(minSpeed, maxSpeed),
      microAmp: ampX * microAmplitudeFactor,
      microSpeed: microSpeed + this._randomRange(0, 0.6),
      seedX: Math.random() * Math.PI * 2,
      seedY: Math.random() * Math.PI * 2 + 1.3,
      seedZ: Math.random() * Math.PI * 2 + 2.6
    }
  }

  _randomRange(min, max) {
    return min + (max - min) * Math.random()
  }

  _jitterNoise(t, seed) {
    return Math.sin(t + seed) * 0.6 + Math.sin(t * 1.7 + seed * 1.3) * 0.4
  }

  _updateJitter(time) {
    const stepIndex = Math.floor(time * this.jitterConfig.stepRate)
    const steppedTime = stepIndex / this.jitterConfig.stepRate
    const stepChanged = stepIndex !== this._jitterStepIndex
    this._jitterStepIndex = stepIndex
    this.sphereLookup.forEach((sphereGroup, id) => {
      // Skip protected spheres
      if (sphereGroup.userData && sphereGroup.userData.protected) return
      const base = this.sphereHomePositions.get(id)
      const jitter = sphereGroup.userData && sphereGroup.userData.jitter
      if (!base || !jitter) return

      const x = this._jitterNoise(steppedTime * jitter.speedX, jitter.seedX) * jitter.ampX
      const y = this._jitterNoise(steppedTime * jitter.speedY, jitter.seedY) * jitter.ampY
      const z = this._jitterNoise(steppedTime * jitter.speedZ, jitter.seedZ) * jitter.ampZ
      const microT = steppedTime * jitter.microSpeed
      const microX = Math.sin(microT + jitter.seedX * 1.7) * jitter.microAmp
      const microY = Math.cos(microT + jitter.seedY * 1.9) * jitter.microAmp
      const microZ = Math.sin(microT + jitter.seedZ * 2.1) * jitter.microAmp * 0.7

      sphereGroup.position.set(
        base.x + x + microX,
        base.y + y + microY,
        base.z + z + microZ
      )

      const ghost = sphereGroup.userData && sphereGroup.userData.ghost
      if (stepChanged && ghost && ghost.meshes) {
        const history = ghost.history
        history[ghost.cursor].copy(sphereGroup.position)
        ghost.cursor = (ghost.cursor + 1) % history.length
        const step = this.ghostConfig.trailStep
        const stretch = this.ghostConfig.stretch
        ghost.meshes.forEach((mesh, index) => {
          let historyIndex = ghost.cursor - 1 - (index + 1) * step
          while (historyIndex < 0) historyIndex += history.length
          ghost.tmp.copy(history[historyIndex])
          ghost.tmp.sub(sphereGroup.position).multiplyScalar(stretch).add(sphereGroup.position)
          mesh.position.copy(ghost.tmp)
        })
      }
    })
  }

  _createDimensionLines(THREE) {
    const { rows, cols, spacing, radius } = this.gridConfig
    const arrayWidth = (cols - 1) * spacing
    const arrayHeight = (rows - 1) * spacing
    const bottomY = -arrayHeight / 2 - radius - 1.2  // moved down more
    const leftX = -arrayWidth / 2
    const offsetX = arrayWidth / 5  // 1/5th offset from left
    const verticalX = leftX + offsetX  // vertical line starts 1/5th in
    const verticalLength = arrayWidth * 0.6  // shorter vertical line
    const shortLength = arrayWidth / 8  // shorter horizontal line
    const shortLineY = bottomY - verticalLength

    const topY = arrayHeight / 2 + radius + 6
    const descWidth = arrayWidth * 1.5

    this.dimensionLines = createDimensionLines(THREE, this.CSS3DComponents, {
      lines: [
        // Horizontal line under array
        { from: [leftX, bottomY, 0], to: [leftX + arrayWidth, bottomY, 0] },
        // Vertical line going down (offset 1/5th from left)
        { from: [verticalX, bottomY, 0], to: [verticalX, shortLineY, 0] },
        // Short horizontal line to the right
        { from: [verticalX, shortLineY, 0], to: [verticalX + shortLength, shortLineY, 0] }
      ],
      labels: [
        {
          position: [verticalX + shortLength + 5, shortLineY - 0.2, 0],
          title: 'Representation of atoms magnified',
          value: 'x11,800,000,000'
        },
        {
          position: [leftX, topY, 0],
          html: `
            <div class="dimension-description" style="width: ${descWidth * 50}px;">
              <div class="dimension-description__title">Quantum computing with neutral atoms</div>
              <div class="dimension-description__text">Applications with commercial value will require universal gate-based quantum computers with large numbers of error-corrected qubits, long coherence times, optimized connectivity, and fast operations. Computing with atomic arrays offers an easy and fast path to quantum computing at scale.</div>
            </div>
          `
        }
      ]
    })

    this.sceneGroup.add(this.dimensionLines.group)
  }

  // Helper to get sphere position by row/col
  _getSpherePosition(row, col) {
    const { cols, spacing } = this.gridConfig
    const xOffset = (cols - 1) * spacing * 0.5
    const yOffset = (this.gridConfig.rows - 1) * spacing * 0.5
    return {
      x: col * spacing - xOffset,
      y: yOffset - row * spacing
    }
  }

  _createStage2DimensionLines(THREE) {
    const { rows, cols, spacing, radius } = this.gridConfig
    const arrayWidth = (cols - 1) * spacing
    const labelScale = 0.014
    const descWidthPx = arrayWidth * 1.35 * 50
    const baseParams = { radius, descWidthPx, labelScale }

    // Quantum bits callout - from sphere (0, 2)
    const qubitSphere = this._getSpherePosition(0, 2)
    const qubitCallout = createCalloutFromDefinition(CALLOUT_DEFINITIONS.quantumBits, {
      ...baseParams,
      sphereX: qubitSphere.x,
      sphereY: qubitSphere.y + 0.45
    })

    // Laser tweezers callout - from sphere (last row, col 1)
    const laserSphere = this._getSpherePosition(rows - 1, 1)
    const laserCallout = createCalloutFromDefinition(CALLOUT_DEFINITIONS.laserTweezers, {
      ...baseParams,
      sphereX: laserSphere.x,
      sphereY: laserSphere.y - 0.35
    })

    this.stage2DimensionLines = createDimensionLines(THREE, this.CSS3DComponents, {
      labelScale,
      lines: [...qubitCallout.lines, ...laserCallout.lines],
      labels: [qubitCallout.label, laserCallout.label]
    })

    this.stage2DimensionLines.hide()
    this.sceneGroup.add(this.stage2DimensionLines.group)
  }

  _createStage3DimensionLines(THREE) {
    const { cols, spacing, radius } = this.gridConfig
    const arrayWidth = (cols - 1) * spacing
    const labelScale = 0.0084  // scaled for stage 3 zoom (20/50 = 0.4)
    const descWidthPx = arrayWidth * 1.2 * 50

    // Entangled with Light callout - centered above spheres (0,2) and (0,3)
    const sphere1 = this._getSpherePosition(0, 2)
    const sphere2 = this._getSpherePosition(0, 3)
    const centerX = (sphere1.x + sphere2.x) / 2
    const topY = Math.max(sphere1.y, sphere2.y)

    const entangledCallout = createCalloutFromDefinition(CALLOUT_DEFINITIONS.entangledWithLight, {
      radius,
      descWidthPx,
      labelScale,
      sphereX: centerX,
      sphereY: topY + 2.3
    })

    this.stage3DimensionLines = createDimensionLines(THREE, this.CSS3DComponents, {
      labelScale,
      lines: entangledCallout.lines,
      labels: [entangledCallout.label]
    })

    this.stage3DimensionLines.hide()
    this.sceneGroup.add(this.stage3DimensionLines.group)
  }

  _getSphere(row, col) {
    if (!this.sphereGrid[row]) return null
    return this.sphereGrid[row][col] || null
  }

  _protectSphere(sphereGroup, highlight) {
    if (!sphereGroup || this._isProtecting) return
    this._isProtecting = true

    const gsap = window.gsap
    const { verticalCircle, horizontalCircle, sphere, ghost } = sphereGroup.userData || {}

    // Store home position to stop jitter for this sphere
    const homePos = this.sphereHomePositions.get(sphereGroup.name)
    if (homePos) {
      sphereGroup.userData.protected = true
    }

    // Create animation timeline
    const tl = gsap ? gsap.timeline() : null

    // Fade out the highlight ring
    if (highlight && highlight.ring && tl) {
      tl.to(highlight.ring, {
        opacity: 0,
        duration: 0.2,
        ease: 'power2.out'
      }, 0)
    } else if (highlight && highlight.ring) {
      highlight.ring.style.opacity = '0'
    }

    // 1. Animate sphere back to home position and stop wiggle
    if (tl && homePos) {
      tl.to(sphereGroup.position, {
        x: homePos.x,
        y: homePos.y,
        z: homePos.z,
        duration: 0.3,
        ease: 'power2.out'
      }, 0)
    } else if (homePos) {
      sphereGroup.position.copy(homePos)
    }

    // 2. Scale up to normal size
    if (tl) {
      tl.to(sphereGroup.scale, {
        x: 1, y: 1, z: 1,
        duration: 0.3,
        ease: 'power2.out'
      }, '<')
    } else {
      sphereGroup.scale.setScalar(1)
    }

    // 3. Increase opacity and turn off glow to match stage 2 appearance
    // Clone material so only this sphere is affected
    if (sphere && sphere.material) {
      if (!sphereGroup.userData.ownsMaterial) {
        sphere.material = sphere.material.clone()
        sphereGroup.userData.ownsMaterial = true
      }
      if (tl) {
        tl.to(sphere.material, {
          opacity: 1,
          emissiveIntensity: 0,
          duration: 0.3,
          ease: 'power2.out'
        }, '<')
      } else {
        sphere.material.opacity = 1
        sphere.material.emissiveIntensity = 0
      }
    }

    // 4. Hide ghost trail
    if (ghost && ghost.meshes) {
      ghost.meshes.forEach(mesh => mesh.visible = false)
    }

    // 5. Animate the dashed hemisphere lines in
    if (verticalCircle && verticalCircle.material) {
      verticalCircle.visible = true
      verticalCircle.material.opacity = 0
      verticalCircle.material.transparent = true
      if (tl) {
        tl.to(verticalCircle.material, {
          opacity: 1,
          duration: 0.4,
          ease: 'power2.out'
        }, '-=0.1')
        // Animate rotation for visual effect
        tl.fromTo(verticalCircle.rotation,
          { z: -Math.PI * 0.25 },
          { z: 0, duration: 0.5, ease: 'power2.out' },
          '<'
        )
      } else {
        verticalCircle.material.opacity = 1
      }
    }
    if (horizontalCircle && horizontalCircle.material) {
      horizontalCircle.visible = true
      horizontalCircle.material.opacity = 0
      horizontalCircle.material.transparent = true
      if (tl) {
        tl.to(horizontalCircle.material, {
          opacity: 1,
          duration: 0.4,
          ease: 'power2.out'
        }, '<')
        // Animate rotation for visual effect
        tl.fromTo(horizontalCircle.rotation,
          { x: -Math.PI * 0.25 },
          { x: 0, duration: 0.5, ease: 'power2.out' },
          '<'
        )
      } else {
        horizontalCircle.material.opacity = 1
      }
    }

    // 6. After animation, advance to next slide (longer delay to show protected state)
    const advanceDelay = tl ? 1.5 : 0
    this._setTimer(() => {
      this._isProtecting = false
      // Dispatch event to advance slide
      if (this.panel) {
        const event = new CustomEvent('protectComplete', { bubbles: false })
        this.panel.dispatchEvent(event)
      }
    }, advanceDelay * 1000)
  }

  _bindStage3DragHandlers(targetEl) {
    if (!targetEl) return null

    let isDragging = false
    let startY = 0
    const liftAmount = this._stage3LiftAmount || 1.4
    const liftThreshold = liftAmount * 0.4 // 40% of lift distance to trigger snap

    // Store starting Y positions for all selected spheres
    const startPositions = new Map()

    // Convert screen pixels to world units (approximate)
    const pixelsToWorld = () => {
      if (!this.camera || !this.canvasHost) return 0.01
      const height = this.canvasHost.clientHeight
      const fov = this.camera.fov * Math.PI / 180
      const distance = this.camera.position.z
      return (2 * Math.tan(fov / 2) * distance) / height
    }

    const onPointerDown = (e) => {
      // Hide drag hint when user starts interacting
      this._dragHintSuppressed = true
      this._hideDragHint()

      // Don't start drag if already lifted
      if (this.selectedSpheres.every(s => s.userData.isLifted)) return
      e.stopPropagation()
      isDragging = true
      startY = e.clientY

      // Store start positions for all selected spheres
      startPositions.clear()
      this.selectedSpheres.forEach(sphere => {
        startPositions.set(sphere.name, sphere.position.y)
      })

      targetEl.setPointerCapture(e.pointerId)
    }

    const onPointerMove = (e) => {
      if (!isDragging) return
      if (this.selectedSpheres.every(s => s.userData.isLifted)) return
      e.stopPropagation()

      const deltaY = startY - e.clientY // Inverted: drag up = positive
      const worldDelta = deltaY * pixelsToWorld()

      // Track max progress for gradient opacity
      let maxProgress = 0

      // Move ALL selected spheres together
      this.selectedSpheres.forEach(sphere => {
        if (sphere.userData.isLifted) return
        const basePos = this.sphereHomePositions.get(sphere.name)
        const startSphereY = startPositions.get(sphere.name) || sphere.position.y
        const minY = basePos ? basePos.y : startSphereY
        const maxY = minY + liftAmount
        const newY = Math.max(minY, Math.min(maxY, startSphereY + worldDelta))
        sphere.position.y = newY

        // Calculate progress (0 to 1)
        const progress = (newY - minY) / liftAmount
        maxProgress = Math.max(maxProgress, progress)
      })

      // Update gradient opacity based on drag progress
      this._updateStage3GradientOpacity(maxProgress)
    }

    const onPointerUp = (e) => {
      if (!isDragging) return
      e.stopPropagation()
      isDragging = false

      if (targetEl.hasPointerCapture(e.pointerId)) {
        targetEl.releasePointerCapture(e.pointerId)
      }

      // Check if any sphere crossed the threshold
      let shouldLift = false
      this.selectedSpheres.forEach(sphere => {
        if (sphere.userData.isLifted) return
        const basePos = this.sphereHomePositions.get(sphere.name)
        const baseY = basePos ? basePos.y : 0
        const currentLift = sphere.position.y - baseY
        if (currentLift >= liftThreshold) {
          shouldLift = true
        }
      })

      if (shouldLift) {
        // Lift ALL spheres together
        this._liftAllSpheres()
      } else {
        // Snap ALL spheres back to base position
        const gsap = window.gsap
        this.selectedSpheres.forEach(sphere => {
          if (sphere.userData.isLifted) return
          const basePos = this.sphereHomePositions.get(sphere.name)
          const baseY = basePos ? basePos.y : 0
          if (gsap) {
            gsap.to(sphere.position, {
              y: baseY,
              duration: 0.3,
              ease: 'power2.out'
            })
          } else {
            sphere.position.y = baseY
          }
        })
        // Fade gradient back to 0
        if (gsap && this._stage3GradientMaterial?.uniforms) {
          gsap.to(this._stage3GradientMaterial.uniforms.opacity, {
            value: 0,
            duration: 0.3,
            ease: 'power2.out'
          })
        } else {
          this._updateStage3GradientOpacity(0)
        }
      }
    }

    targetEl.addEventListener('pointerdown', onPointerDown)
    targetEl.addEventListener('pointermove', onPointerMove)
    targetEl.addEventListener('pointerup', onPointerUp)
    targetEl.addEventListener('pointercancel', onPointerUp)

    return () => {
      targetEl.removeEventListener('pointerdown', onPointerDown)
      targetEl.removeEventListener('pointermove', onPointerMove)
      targetEl.removeEventListener('pointerup', onPointerUp)
      targetEl.removeEventListener('pointercancel', onPointerUp)
    }
  }

  _createDragZone(targetHighlights) {
    if (!this.overlay) return

    // Create drag zone element
    const dragZone = document.createElement('div')
    dragZone.className = 'compute-drag-zone'
    this.overlay.appendChild(dragZone)
    this._dragZone = dragZone
    this._dragZoneTargets = Array.isArray(targetHighlights)
      ? targetHighlights.filter(Boolean)
      : []

    this._dragZoneCleanup = this._bindStage3DragHandlers(dragZone)
  }

  _updateDragZone() {
    if (!this._dragZone || !this._dragZoneTargets || !this._dragZoneTargets.length) return
    if (!this.camera || !this.canvasHost || !this.three) return

    const padding = 40

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    let hasBounds = false
    let allVisible = true

    this._dragZoneTargets.forEach((highlight) => {
      if (!highlight || !highlight.isVisible) {
        allVisible = false
        return
      }

      const radius = highlight.screenRadius || 0
      const x = highlight.screenX
      const y = highlight.screenY
      minX = Math.min(minX, x - radius)
      maxX = Math.max(maxX, x + radius)
      minY = Math.min(minY, y - radius)
      maxY = Math.max(maxY, y + radius)
      hasBounds = true
    })

    if (!hasBounds || !allVisible) {
      this._dragZone.style.opacity = '0'
      return
    }

    const zoneWidth = maxX - minX + padding * 2
    const zoneHeight = maxY - minY + padding * 2
    const zoneX = minX - padding
    const zoneY = minY - padding

    this._dragZone.style.opacity = '1'
    this._dragZone.style.left = `${zoneX}px`
    this._dragZone.style.top = `${zoneY}px`
    this._dragZone.style.width = `${zoneWidth}px`
    this._dragZone.style.height = `${zoneHeight}px`
  }

  _liftAllSpheres() {
    const gsap = window.gsap
    const selectedColor = new this.three.Color(this.selectedColor)
    const liftAmount = this._stage3LiftAmount || 1.4

    // Animate gradient to full opacity
    if (gsap && this._stage3GradientMaterial?.uniforms) {
      gsap.to(this._stage3GradientMaterial.uniforms.opacity, {
        value: 0.85,
        duration: 0.3,
        ease: 'power2.out'
      })
    } else {
      this._updateStage3GradientOpacity(1)
    }

    // Lift all selected spheres
    let liftedCount = 0
    this.selectedSpheres.forEach(sphereGroup => {
      if (sphereGroup.userData.isLifted) {
        liftedCount++
        return
      }
      sphereGroup.userData.isLifted = true
      liftedCount++

      const basePos = this.sphereHomePositions.get(sphereGroup.name)
      const targetY = basePos ? basePos.y + liftAmount : sphereGroup.position.y
      const innerSphere = sphereGroup.userData.sphere

      if (gsap) {
        gsap.to(sphereGroup.position, {
          y: targetY,
          duration: 0.3,
          ease: 'power2.out'
        })

        if (innerSphere && innerSphere.material) {
          gsap.to(innerSphere.material.color, {
            r: selectedColor.r,
            g: selectedColor.g,
            b: selectedColor.b,
            duration: 0.3,
            ease: 'power2.out'
          })
        }
      } else {
        sphereGroup.position.y = targetY
        if (innerSphere && innerSphere.material) {
          innerSphere.material.color.copy(selectedColor)
        }
      }
    })

    // Update lifted count so triggerEntanglement knows it's done
    this._stage3LiftedCount = liftedCount

    // Fade out all highlights
    this.highlights.forEach(highlight => {
      if (highlight && highlight.ring) {
        if (gsap) {
          gsap.to(highlight.ring, {
            opacity: 0,
            duration: 0.3,
            ease: 'power2.out'
          })
        } else {
          highlight.ring.style.opacity = '0'
        }
      }
    })

    // Show dimension lines after lift animation
    if (this.stage3DimensionLines) {
      this._setTimer(() => {
        this.stage3DimensionLines.fadeIn(gsap)
      }, 300)
    }
  }

  _liftSphere(sphereGroup, highlight, targetY) {
    if (sphereGroup.userData.isLifted) return
    sphereGroup.userData.isLifted = true

    const gsap = window.gsap
    const selectedColor = new this.three.Color(this.selectedColor)
    const innerSphere = sphereGroup.userData.sphere

    // Animate to final position and change color
    if (gsap) {
      gsap.to(sphereGroup.position, {
        y: targetY,
        duration: 0.3,
        ease: 'power2.out'
      })

      if (innerSphere && innerSphere.material) {
        gsap.to(innerSphere.material.color, {
          r: selectedColor.r,
          g: selectedColor.g,
          b: selectedColor.b,
          duration: 0.3,
          ease: 'power2.out'
        })
      }

      // Fade out the highlight
      if (highlight && highlight.ring) {
        gsap.to(highlight.ring, {
          opacity: 0,
          duration: 0.3,
          ease: 'power2.out'
        })
      }
    } else {
      sphereGroup.position.y = targetY
      if (innerSphere && innerSphere.material) {
        innerSphere.material.color.copy(selectedColor)
      }
      if (highlight && highlight.ring) {
        highlight.ring.style.opacity = '0'
      }
    }

    // Track lifted count and show dimension lines when both are lifted
    this._stage3LiftedCount = (this._stage3LiftedCount || 0) + 1
    if (this._stage3LiftedCount >= 2 && this.stage3DimensionLines) {
      this._setTimer(() => {
        this.stage3DimensionLines.fadeIn(gsap)
      }, 300)
    }
  }

  _setTimer(fn, delayMs) {
    const timerId = window.setTimeout(() => {
      this._timers.delete(timerId)
      fn()
    }, delayMs)
    this._timers.add(timerId)
    return timerId
  }

  _clearTimers() {
    if (!this._timers.size) return
    this._timers.forEach((timerId) => {
      clearTimeout(timerId)
    })
    this._timers.clear()
  }

  _clearHighlights() {
    // Hide and clean up drag hint
    this._hideDragHint()
    if (this._dragHintContainer && this._dragHintContainer.parentNode) {
      this._dragHintContainer.parentNode.removeChild(this._dragHintContainer)
      this._dragHintContainer = null
    }

    // Clean up drag zone
    if (this._dragZoneCleanup) {
      this._dragZoneCleanup()
      this._dragZoneCleanup = null
    }
    if (this._dragZone && this._dragZone.parentNode) {
      this._dragZone.parentNode.removeChild(this._dragZone)
      this._dragZone = null
    }
    this._dragZoneTargets = null

    if (!this.highlights.length) return
    this.highlights.forEach((highlight) => {
      // Clean up drag event listeners if they exist
      if (highlight.dragCleanup) {
        highlight.dragCleanup()
      }
      if (highlight.wrapper && highlight.wrapper.parentNode) {
        highlight.wrapper.parentNode.removeChild(highlight.wrapper)
      }
    })
    this.highlights = []
  }

  _createStage3Gradient() {
    if (this._stage3GradientMesh || !this.three || !this.sceneGroup) return

    const THREE = this.three

    // Create gradient texture with edge fade using canvas
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    const ctx = canvas.getContext('2d')

    // Draw vertical gradient: #8DC8E8 → #0078D4 → #8DC8E8
    const vertGradient = ctx.createLinearGradient(0, 0, 0, canvas.height)
    vertGradient.addColorStop(0, '#8DC8E8')
    vertGradient.addColorStop(0.4, '#0078D4')
    vertGradient.addColorStop(0.6, '#0078D4')
    vertGradient.addColorStop(1, '#8DC8E8')
    ctx.fillStyle = vertGradient
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Apply edge fade by modifying alpha channel
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = imageData.data
    const edgeFade = 0.15 // 15% of each edge fades to transparent

    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const idx = (y * canvas.width + x) * 4

        // Calculate distance from edges (0 = at edge, 1 = past fade zone)
        const leftDist = x / canvas.width / edgeFade
        const rightDist = (canvas.width - 1 - x) / canvas.width / edgeFade
        const topDist = y / canvas.height / edgeFade
        const bottomDist = (canvas.height - 1 - y) / canvas.height / edgeFade

        // Clamp to 0-1 and take minimum (closest edge)
        const edgeAlpha = Math.min(
          Math.min(leftDist, rightDist),
          Math.min(topDist, bottomDist),
          1
        )

        // Apply smooth fade curve
        const smoothAlpha = edgeAlpha * edgeAlpha * (3 - 2 * edgeAlpha)
        data[idx + 3] = Math.floor(data[idx + 3] * smoothAlpha)
      }
    }
    ctx.putImageData(imageData, 0, 0)

    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true

    // Create plane geometry - sized to span view area
    const planeWidth = 24
    const planeHeight = 3.5
    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight)

    // Create material with animated pulse
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        time: { value: 0 },
        opacity: { value: 0.85 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        uniform float time;
        uniform float opacity;
        varying vec2 vUv;
        void main() {
          vec4 tex = texture2D(map, vUv);

          // Soft luminous sweep with seamless wrap
          float sweep = fract(time * 0.15);
          float dist = abs(vUv.x - sweep);
          dist = min(dist, 1.0 - dist); // Wrap around
          float glow = exp(-pow(dist * 8.0, 2.0)) * 0.25;

          gl_FragColor = vec4(tex.rgb + glow, tex.a * opacity);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false
    })

    // Create mesh and position above spheres
    // Position it slightly behind (negative z) and above the spheres
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(0, 5.8, -2)
    mesh.renderOrder = -1 // Render behind spheres

    this.sceneGroup.add(mesh)
    this._stage3GradientMesh = mesh
    this._stage3GradientTexture = texture
    this._stage3GradientMaterial = material

    // Hide initially - will be shown when entering stage 3
    mesh.visible = false
  }

  _hideStage3Gradient() {
    if (this._stage3GradientMesh) {
      this._stage3GradientMesh.visible = false
    }
  }

  _showStage3Gradient() {
    if (this._stage3GradientMesh) {
      this._stage3GradientMesh.visible = true
      // Start at 0 opacity - will fade in as user drags
      if (this._stage3GradientMaterial?.uniforms) {
        this._stage3GradientMaterial.uniforms.opacity.value = 0
      }
    }
  }

  _updateStage3GradientOpacity(progress) {
    if (this._stage3GradientMaterial?.uniforms) {
      // Map progress (0-1) to opacity (0-0.85)
      this._stage3GradientMaterial.uniforms.opacity.value = Math.min(1, progress) * 0.85
    }
  }

  _removeStage3Gradient() {
    // Just hide - disposal happens in _onDestroy
    this._hideStage3Gradient()
  }

  _disposeStage3Gradient() {
    if (this._stage3GradientMesh) {
      if (this._stage3GradientMesh.parent) {
        this._stage3GradientMesh.parent.remove(this._stage3GradientMesh)
      }
      if (this._stage3GradientMesh.geometry) {
        this._stage3GradientMesh.geometry.dispose()
      }
      if (this._stage3GradientMaterial) {
        this._stage3GradientMaterial.dispose()
      }
      if (this._stage3GradientTexture) {
        this._stage3GradientTexture.dispose()
      }
      this._stage3GradientMesh = null
      this._stage3GradientMaterial = null
      this._stage3GradientTexture = null
    }
  }

  _createHighlight({ sphere }) {
    if (!sphere || !this.overlay) return null

    const wrapper = document.createElement('div')
    wrapper.className = 'compute-highlight'

    const ringWrap = document.createElement('div')
    ringWrap.className = 'compute-highlight__ring-wrap'

    const ring = document.createElement('div')
    ring.className = 'compute-highlight__ring'
    ring.style.opacity = '0'
    ringWrap.appendChild(ring)

    wrapper.appendChild(ringWrap)
    this.overlay.appendChild(wrapper)

    const highlight = { sphere, wrapper, ringWrap, ring }
    this.highlights.push(highlight)
    return highlight
  }

  _update() {
    const t = performance.now() * 0.001
    if (this.sphereFactory) {
      this.sphereFactory.update(t)
    }

    if (this.jitterActive) {
      this._updateJitter(t)
    }

    // Animate gradient pulse
    if (this._stage3GradientMesh?.visible && this._stage3GradientMaterial?.uniforms) {
      this._stage3GradientMaterial.uniforms.time.value = t
    }

    this._updateHighlights()
    this._updateDragZone()

    if (this.camera) {
      this.camera.lookAt(this.cameraTarget.x, this.cameraTarget.y, this.cameraTarget.z)
      this.camera.updateMatrixWorld()
    }

    // Render CSS3D layer
    if (this.css3DRenderer && this.scene && this.camera) {
      this.css3DRenderer.render(this.scene, this.camera)
    }
  }

  _updateHighlights() {
    if (!this.highlights.length || !this.camera || !this.canvasHost || !this.three) return

    const width = this.canvasHost.clientWidth
    const height = this.canvasHost.clientHeight
    if (!width || !height) return

    const worldPos = this._tmpWorld
    const screenPos = this._tmpScreen
    const edgePos = this._tmpEdge
    const scale = this._tmpScale
    const right = this._tmpRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion)

    this.highlights.forEach((highlight) => {
      if (!highlight.sphere) return

      highlight.sphere.getWorldPosition(worldPos)
      screenPos.copy(worldPos).project(this.camera)
      const isVisible = screenPos.z >= -1 && screenPos.z <= 1

      highlight.isVisible = isVisible
      if (!isVisible) {
        highlight.wrapper.style.opacity = '0'
        return
      }

      const x = (screenPos.x * 0.5 + 0.5) * width
      const y = (-screenPos.y * 0.5 + 0.5) * height

      highlight.wrapper.style.opacity = '1'
      highlight.wrapper.style.left = `${x}px`
      highlight.wrapper.style.top = `${y}px`

      highlight.sphere.getWorldScale(scale)
      const innerSphere = highlight.sphere.userData.sphere
      const baseRadius = innerSphere && innerSphere.geometry && innerSphere.geometry.parameters
        ? innerSphere.geometry.parameters.radius
        : this.gridConfig.radius
      const worldRadius = baseRadius * scale.x

      edgePos.copy(right).multiplyScalar(worldRadius).add(worldPos).project(this.camera)
      const edgeX = (edgePos.x * 0.5 + 0.5) * width
      const edgeY = (-edgePos.y * 0.5 + 0.5) * height
      const screenRadius = Math.hypot(edgeX - x, edgeY - y)
      const ringSize = Math.max(24, screenRadius * 2.6)

      highlight.screenX = x
      highlight.screenY = y
      highlight.screenRadius = screenRadius
      highlight.ringWrap.style.width = `${ringSize}px`
      highlight.ringWrap.style.height = `${ringSize}px`
    })
  }
}
