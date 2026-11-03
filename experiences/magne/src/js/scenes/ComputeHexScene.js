import { SceneBase } from './SceneBase.js'
import { createGradientLink, createCurvedGradientLink, syncConnectionColors } from './GradientLink.js'
import { createQuantumSphereFactory } from './QuantumSphere.js'
import { createDimensionLines, createCalloutFromDefinition, CALLOUT_DEFINITIONS } from './DimensionLines.js'
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'

export class ComputeHexScene extends SceneBase {
  constructor({ panel, getThree }) {
    super({ panel, getThree })
    this.disableRotation = false

    this.horizontalHex = null
    this.verticalHex = null
    this.verticalHexBaseY = 0
    this.verticalHexBasePosition = null
    this.connectionLinks = []
    this.plateMaterial = null
    this.sphereFactory = null
    this._handoffActive = false
    this._handoffData = null
    this._handoffBaseY = null
    this.dimensionLines = null
    this.css3DRenderer = null
    this.CSS3DComponents = null
    this._resetTimer = null
    this._introTimer = null
    this._dimensionTimer = null
    this._hexOverlay = null
    this._hexBaseRotation = null

    this.init()
  }

  _initDom() {
    super._initDom()
    if (this.view) {
      this.view.classList.add('compute-hex-view')
    }
    if (this.overlay) {
      this.overlay.innerHTML = `
        <div class="compute-hex-layout">
          <div class="compute-hex-copy">
            <div class="compute-hex-title">2D qubit array</div>
            <div class="compute-hex-subtitle">
              In contrast, fixed connectivity modalities can be entangled only with their nearest neighbor.
            </div>
          </div>
          <div class="compute-hex-asset">
            <img src="assets/images/compute/haxagon_vis.png" alt="" />
          </div>
        </div>
      `
      this._hexOverlay = this.overlay.querySelector('.compute-hex-layout')
      if (this._hexOverlay) {
        this._hexOverlay.style.opacity = '0'
      }
    }
  }

  _onDestroy() {
    if (this._resetTimer) {
      clearTimeout(this._resetTimer)
      this._resetTimer = null
    }
    if (this._introTimer) {
      clearTimeout(this._introTimer)
      this._introTimer = null
    }
    if (this._dimensionTimer) {
      clearTimeout(this._dimensionTimer)
      this._dimensionTimer = null
    }
    this.horizontalHex = null
    this.floorGroup = null
    this.plate = null
    this.connectionLinks = []
    this.plateMaterial = null
    this._handoffActive = false
    this._handoffData = null
    this._handoffBaseY = null
    this.verticalHexBasePosition = null
    if (this.sphereFactory) {
      this.sphereFactory.dispose()
      this.sphereFactory = null
    }
    if (this.dimensionLines) {
      this.dimensionLines.dispose()
      this.dimensionLines = null
    }
    if (this.css3DRenderer && this.css3DRenderer.domElement && this.css3DRenderer.domElement.parentNode) {
      this.css3DRenderer.domElement.parentNode.removeChild(this.css3DRenderer.domElement)
      this.css3DRenderer = null
    }
  }

  _setupRenderer(THREE) {
    super._setupRenderer(THREE)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.8
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
  }

  _setupScene(THREE) {
    this.scene = new THREE.Scene()
    this.connectionLinks = []

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
    this.camera.position.set(-10, 16, 20.10)
    this.camera.lookAt(0, 3, 0)

    const ambient = new THREE.AmbientLight(0xffffff, 0)
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2)
    keyLight.position.set(0, 3, 0)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.width = 2048
    keyLight.shadow.mapSize.height = 2048
    keyLight.shadow.camera.near = 0.5
    keyLight.shadow.camera.far = 20
    keyLight.shadow.camera.left = -6
    keyLight.shadow.camera.right = 6
    keyLight.shadow.camera.top = 6
    keyLight.shadow.camera.bottom = -6
    keyLight.shadow.bias = -0.0005
    keyLight.shadow.normalBias = 0.02
    keyLight.shadow.radius = 2
    keyLight.shadow.intensity = 4
    const fillLight = new THREE.DirectionalLight(0xbcd6ff, 0)
    fillLight.position.set(-5, 3, -6)
    this.scene.add(ambient, keyLight, fillLight)

    this.sceneGroup = new THREE.Group()
    this.scene.add(this.sceneGroup)

    this._createHexagons(THREE)
  }

  _createHexagons(THREE) {
    const sphereRadius = 0.28

    // Load Line2 components and CSS3DRenderer
    Promise.all([
      this._loadLine2Components(THREE),
      this._loadCSS3DRenderer()
    ]).then(([Line2Components, CSS3DComponents]) => {
      if (this.disposed) return
      this.sphereFactory = createQuantumSphereFactory(THREE, { radius: sphereRadius, dashedLineWidth: 0.5 }, Line2Components)
      this.CSS3DComponents = CSS3DComponents
      this._setupCSS3DRenderer(CSS3DComponents)
      this._buildHexagons(THREE, sphereRadius)
      this._createDimensionLines(THREE)
      this._markReady()
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

    // Wrap resize handler to also resize CSS3DRenderer
    const originalResize = this._resizeRenderer
    this._resizeRenderer = () => {
      originalResize()
      if (this.css3DRenderer && this.canvasHost) {
        this.css3DRenderer.setSize(this.canvasHost.clientWidth, this.canvasHost.clientHeight)
      }
    }
  }

  _createDimensionLines(THREE) {
    if (!this.verticalHex || !this.CSS3DComponents) return

    // Position callout above the flying hexagon
    const hexY = this.verticalHexBaseY
    const hexZ = -3
    const radius = 0.75  // approximate radius for line sizing
    const labelScale = 0.01
    const descWidthPx = 600

    // Main callout for All-to-all connectivity (with lines)
    const allToAllCallout = createCalloutFromDefinition(CALLOUT_DEFINITIONS.allToAllConnectivity, {
      sphereX: 0,
      sphereY: hexY + 1.7,  // above the hexagon
      radius,
      descWidthPx,
      labelScale
    })
    allToAllCallout.label.html = allToAllCallout.label.html.replace(
      'dimension-description__title',
      'dimension-description__title dimension-description__title--all-to-all'
    )

    // Label only for Neutral atom array (to the right of the helix)
    const neutralAtomLabel = {
      position: [4.2, hexY - 1.5, 0],  // right side of the helix
      html: `
        <div class="dimension-description dimension-description--anchor-title dimension-description--neutral" style="width: 360px; --dimension-title-offset: 22px;">
          <div class="dimension-description__title">${CALLOUT_DEFINITIONS.neutralAtomArray.title}</div>
          <div class="dimension-description__text">${CALLOUT_DEFINITIONS.neutralAtomArray.text}</div>
        </div>
      `
    }

    // Include all labels together
    this.dimensionLines = createDimensionLines(THREE, this.CSS3DComponents, {
      labelScale,
      lines: allToAllCallout.lines,
      labels: [allToAllCallout.label, neutralAtomLabel]
    })

    // Add directly to scene (not sceneGroup) for proper billboarding
    // Account for sceneGroup's Y offset
    this.dimensionLines.group.position.set(0, this.sceneGroup.position.y, hexZ)
    this.scene.add(this.dimensionLines.group)

    // Hide initially - will be shown after intro animation
    this.dimensionLines.hide()
  }

  async _loadLine2Components(THREE) {
    return { Line2, LineMaterial, LineGeometry }
  }

  _buildHexagons(THREE, sphereRadius) {
    if (!this.sphereFactory) return

    const dyePalette = [
      0xab44af,
      0xd6b65c,
      0x3b72b8,
      0x887ab7,
      0x3273cf,
      0x73ada8
    ]
    const hexRadius = 2.25
    const verticalHex = this._createHexSphereGroup({
      factory: this.sphereFactory,
      hexRadius,
      dyeColors: dyePalette,
      linkRadius: 0.0225,
      linkTrim: sphereRadius * 2,
      castShadow: false,
      receiveShadow: false,
      linkCastShadow: false,
      sphereRotationX: -Math.PI / 2,
      curvedLinks: true,
      curveStrength: 0.2,
      addDiagonals: true,
      addSkipOneLinks: true,
      startHidden: true  // Start with connections hidden
    })
    verticalHex.rotation.x = Math.PI / 2
    this._hexBaseRotation = verticalHex.rotation.clone()
    verticalHex.position.y = 5
    verticalHex.position.z = -3
    this.verticalHex = verticalHex
    this.rotationTarget = verticalHex
    this.verticalHexBaseY = verticalHex.position.y
    this.verticalHexBasePosition = verticalHex.position.clone()
    this.sceneGroup.add(verticalHex)
    this.sceneGroup.position.y = -1.2

    // Vertical hex starts visible in 2x3 grid formation
    verticalHex.visible = true
    this._setupVerticalIntroPositions(verticalHex, hexRadius)

    // Don't auto-start - wait for playIntro() to be called when slide becomes visible
    this._introPlayed = false
  }

  // Called when the slide becomes visible - starts the intro animation
  playIntro() {
    if (this.disposed) return

    // Clear any pending timers
    if (this._introTimer) {
      clearTimeout(this._introTimer)
      this._introTimer = null
    }
    if (this._dimensionTimer) {
      clearTimeout(this._dimensionTimer)
      this._dimensionTimer = null
    }

    // Ensure reset has been done (positions should already be in grid from onExit)
    // Do a quick sync reset just in case
    if (this.verticalHex) {
      const gsap = window.gsap
      const hexRadius = 2.25

      // Clear handoff state
      this._handoffActive = false
      this._handoffData = null
      this._handoffBaseY = null

      // Ensure grid positions are set
      this._setupVerticalIntroPositions(this.verticalHex, hexRadius)
      this.verticalHex.visible = true
    }

    // Hide dimension lines
    if (this.dimensionLines) {
      this.dimensionLines.hide()
    }
    if (this._hexOverlay) {
      this._hexOverlay.style.opacity = '0'
    }
    if (this._hexOverlay) {
      const gsap = window.gsap
      if (gsap) {
        gsap.killTweensOf(this._hexOverlay)
        gsap.set(this._hexOverlay, { opacity: 0 })
      } else {
        this._hexOverlay.style.opacity = '0'
      }
    }
    // Start intro animation after a brief delay
    this._introTimer = setTimeout(() => {
      this._introTimer = null
      this._playIntroAnimation()
    }, 150)
  }

  cancelIntroAnimation() {
    if (this._introTimer) {
      clearTimeout(this._introTimer)
      this._introTimer = null
    }
    if (this._dimensionTimer) {
      clearTimeout(this._dimensionTimer)
      this._dimensionTimer = null
    }

    const gsap = window.gsap
    if (!gsap) return

    if (this.verticalHex) {
      const spheres = this.verticalHex.userData?.spheres || []
      spheres.forEach((sphere) => {
        gsap.killTweensOf(sphere.position)
        gsap.killTweensOf(sphere.scale)
      })

      const connections = this.verticalHex.userData?.connections || []
      connections.forEach((link) => {
        const uniforms = link.material && link.material.uniforms
        if (uniforms?.progress) {
          gsap.killTweensOf(uniforms.progress)
        }
        if (uniforms?.opacity) {
          gsap.killTweensOf(uniforms.opacity)
        }
      })
    }

  }

  _setupVerticalIntroPositions(hexGroup, hexRadius) {
    const spheres = hexGroup.userData?.spheres || []
    if (spheres.length !== 6) return

    // Arrange 6 spheres in a 2x3 grid (3 rows of 2)
    const spacingX = hexRadius * 0.6
    const spacingZ = hexRadius * 0.5
    const gridPositions = [
      // Row 0 (top)
      { x: -spacingX / 2, z: -spacingZ },
      { x: spacingX / 2, z: -spacingZ },
      // Row 1 (middle)
      { x: -spacingX / 2, z: 0 },
      { x: spacingX / 2, z: 0 },
      // Row 2 (bottom)
      { x: -spacingX / 2, z: spacingZ },
      { x: spacingX / 2, z: spacingZ }
    ]

    spheres.forEach((sphere, i) => {
      sphere.visible = true
      // Store the final hex position only once (first time) - use basePosition as source of truth
      if (!sphere.userData.hexPosition) {
        const basePos = sphere.userData.basePosition
        if (basePos) {
          sphere.userData.hexPosition = basePos.clone()
        } else {
          sphere.userData.hexPosition = sphere.position.clone()
        }
      }
      // Move to grid position - set each component explicitly
      const gridPos = gridPositions[i]
      sphere.position.x = gridPos.x
      sphere.position.y = 0
      sphere.position.z = gridPos.z
    })
  }

  _playIntroAnimation() {
    if (this.disposed) return
    const gsap = window.gsap
    if (!gsap) return

    const verticalHex = this.verticalHex
    if (!verticalHex) return

    const spheres = verticalHex.userData?.spheres || []
    const connections = verticalHex.userData?.connections || []

    // Phase 1: Animate spheres from 2x3 grid to hexagon formation
    const introSpeed = 0.7
    const hexFormDuration = 0.8 * introSpeed
    const staggerDelay = 0.08 * introSpeed

    spheres.forEach((sphere, i) => {
      const targetPos = sphere.userData.hexPosition
      if (!targetPos) return

      gsap.to(sphere.position, {
        x: targetPos.x,
        y: targetPos.y,
        z: targetPos.z,
        duration: hexFormDuration,
        delay: i * staggerDelay,
        ease: 'back.out(1.2)'
      })
    })

    // Phase 2: After hex forms, animate connection lines shooting out
    const lineDelay = hexFormDuration + (spheres.length * staggerDelay) + (0.2 * introSpeed)
    const lineDuration = 0.3 * introSpeed

    connections.forEach((link, i) => {
      const uniforms = link.material?.uniforms
      if (uniforms?.progress) {
        gsap.to(uniforms.progress, {
          value: 1,
          duration: lineDuration,
          delay: lineDelay + (i * 0.04),
          ease: 'power2.out'
        })
      }
    })

    // Phase 3: Show dimension lines after connections
    const dimensionDelay = lineDelay + lineDuration + (0.3 * introSpeed)
    if (this._dimensionTimer) {
      clearTimeout(this._dimensionTimer)
    }
    this._dimensionTimer = setTimeout(() => {
      if (this.disposed) return
      if (this.dimensionLines) {
        this.dimensionLines.show()
      }
      this._dimensionTimer = null
    }, dimensionDelay * 1000)

    if (this._hexOverlay) {
      if (gsap) {
        gsap.killTweensOf(this._hexOverlay)
        gsap.to(this._hexOverlay, {
          opacity: 1,
          duration: 0.6,
          delay: dimensionDelay,
          ease: 'power2.out'
        })
      } else {
        this._hexOverlay.style.opacity = '1'
      }
    }

  }

  _createHexSphereGroup({ factory, hexRadius, dyeColors, linkRadius, linkTrim, castShadow, receiveShadow, linkCastShadow, sphereRotationX = 0, curvedLinks = false, curveStrength = 0.3, addDiagonals = false, addSkipOneLinks = false, startHidden = false, solidLinkColor = null, skipColorSync = false }) {
    const THREE = this.three
    const group = new THREE.Group()
    const spheres = []
    const palette = Array.isArray(dyeColors) && dyeColors.length ? dyeColors : [0xffffff]

    for (let i = 0; i < 6; i++) {
      const sphereGroup = factory.create({
        castShadow: Boolean(castShadow),
        receiveShadow: Boolean(receiveShadow)
      })
      const angle = (i / 6) * Math.PI * 2
      const x = Math.cos(angle) * hexRadius
      const z = Math.sin(angle) * hexRadius
      sphereGroup.position.set(x, 0, z)
      if (sphereRotationX) {
        sphereGroup.rotation.x = sphereRotationX
      }
      sphereGroup.userData.dyeColor = new THREE.Color(palette[i % palette.length])
      sphereGroup.userData.basePosition = sphereGroup.position.clone()
      sphereGroup.userData.baseScale = sphereGroup.scale.clone()
      spheres.push(sphereGroup)
      group.add(sphereGroup)
    }

    const connections = []

    // Helper to set initial progress for hidden links (for shoot-out effect)
    const initLink = (link) => {
      if (startHidden && link.material?.uniforms?.progress) {
        link.material.uniforms.progress.value = 0
      }
      return link
    }

    // Neighbor connections (curved or straight)
    for (let i = 0; i < spheres.length; i++) {
      const startSphere = spheres[i]
      const endSphere = spheres[(i + 1) % spheres.length]
      const linkFn = curvedLinks ? createCurvedGradientLink : createGradientLink
      const linkColorA = solidLinkColor ? new THREE.Color(solidLinkColor) : startSphere.userData.dyeColor
      const linkColorB = solidLinkColor ? new THREE.Color(solidLinkColor) : endSphere.userData.dyeColor
      const linkOptions = {
        start: startSphere.position,
        end: endSphere.position,
        colorA: linkColorA,
        colorB: linkColorB,
        radius: linkRadius || 0.06,
        trim: linkTrim || 0,
        castShadow: linkCastShadow
      }
      if (curvedLinks) {
        linkOptions.curveStrength = curveStrength
      }
      const link = initLink(linkFn(THREE, linkOptions))
      link.userData.startSphere = startSphere
      link.userData.endSphere = endSphere
      connections.push(link)
      group.add(link)
    }

    // Diagonal connections (straight lines across: 0-3, 1-4, 2-5)
    if (addDiagonals) {
      const diagonalPairs = [[0, 3], [1, 4], [2, 5]]
      for (const [i, j] of diagonalPairs) {
        const startSphere = spheres[i]
        const endSphere = spheres[j]
        const link = initLink(createGradientLink(THREE, {
          start: startSphere.position,
          end: endSphere.position,
          colorA: startSphere.userData.dyeColor,
          colorB: endSphere.userData.dyeColor,
          radius: linkRadius || 0.06,
          trim: linkTrim || 0,
          castShadow: linkCastShadow
        }))
        link.userData.startSphere = startSphere
        link.userData.endSphere = endSphere
        connections.push(link)
        group.add(link)
      }
    }

    // Skip-one connections (curved: 0-2, 1-3, 2-4, 3-5, 4-0, 5-1)
    if (addSkipOneLinks) {
      const skipOnePairs = [[0, 2], [1, 3], [2, 4], [3, 5], [4, 0], [5, 1]]
      for (const [i, j] of skipOnePairs) {
        const startSphere = spheres[i]
        const endSphere = spheres[j]
        const link = initLink(createCurvedGradientLink(THREE, {
          start: startSphere.position,
          end: endSphere.position,
          colorA: startSphere.userData.dyeColor,
          colorB: endSphere.userData.dyeColor,
          radius: linkRadius || 0.06,
          trim: linkTrim || 0,
          castShadow: linkCastShadow,
          curveStrength: curveStrength
        }))
        link.userData.startSphere = startSphere
        link.userData.endSphere = endSphere
        connections.push(link)
        group.add(link)
      }
    }

    group.userData.spheres = spheres
    group.userData.connections = connections
    if (!skipColorSync) {
      this.connectionLinks.push(...connections)
    }
    return group
  }

  launchBallHandoff({ barHeightRatio = 260 / 1080, barYOffsetRatio = -0.3, duration = 0.6, transitionFraction = 0.95, edgeOffsetRatio = 0.08, laneCount = 6 } = {}) {
    if (this._handoffActive) {
      return { data: this._handoffData, totalDelayMs: 1.0 }
    }
    if (!this.verticalHex || !this.camera || !this.canvasHost || !this.three) return null

    this.cancelIntroAnimation()

    const spheres = this.verticalHex.userData?.spheres || []
    if (!spheres.length) return null

    const rect = this.canvasHost.getBoundingClientRect()
    const width = rect.width
    const height = rect.height
    if (!width || !height) return null

    const maxLanes = Math.max(1, Math.min(laneCount, spheres.length))
    const flowLanes = window.FlowLanes && typeof window.FlowLanes.getFlowLanes === 'function'
      ? window.FlowLanes.getFlowLanes
      : null
    if (!flowLanes) return null
    const { laneYs, laneRatios } = flowLanes({
      width,
      height,
      laneCount: maxLanes,
      barHeightRatio,
      barYOffsetRatio
    })
    if (!laneYs.length) return null

    const edgeOffset = width * edgeOffsetRatio
    const targetX = width + edgeOffset

    const THREE = this.three
    const temp = new THREE.Vector3()
    const projected = spheres.map((sphere) => {
      sphere.getWorldPosition(temp)
      temp.project(this.camera)
      const dye = sphere.userData?.dyeColor
      const color = dye && typeof dye.getHexString === 'function' ? `#${dye.getHexString()}` : '#ffffff'
      return { sphere, ndcZ: temp.z, screenY: (-temp.y * 0.5 + 0.5) * height, color }
    }).sort((a, b) => a.screenY - b.screenY)

    const gsap = window.gsap
    const targetNdcX = (targetX / width) * 2 - 1

    // Fade out dimension lines
    if (this.dimensionLines) {
      this.dimensionLines.fadeOut(gsap)
    }
    const connections = this.verticalHex.userData?.connections || []
    if (connections.length) {
      if (gsap) {
        const fadeDuration = Math.min(duration * 0.25, 0.2)
        connections.forEach((link) => {
          const uniforms = link.material && link.material.uniforms
          if (!uniforms || !uniforms.opacity) return
          gsap.to(uniforms.opacity, {
            value: 0,
            duration: fadeDuration,
            ease: 'power1.out'
          })
        })
      } else {
        connections.forEach((link) => {
          link.visible = false
        })
      }
    }

    projected.slice(0, maxLanes).forEach((item, index) => {
      const targetY = laneYs[index]
      const targetNdcY = -((targetY / height) * 2 - 1)
      const targetNdc = new THREE.Vector3(targetNdcX, targetNdcY, item.ndcZ)
      const targetWorld = targetNdc.unproject(this.camera)
      const targetLocal = this.verticalHex.worldToLocal(targetWorld)
      if (gsap) {
        gsap.to(item.sphere.position, {
          x: targetLocal.x,
          y: targetLocal.y,
          z: targetLocal.z,
          duration,
          ease: 'power2.in'
        })
        const baseScale = item.sphere.scale.x || 1
        gsap.to(item.sphere.scale, {
          x: baseScale * 0.65,
          y: baseScale * 0.65,
          z: baseScale * 0.65,
          duration: duration,
          ease: 'power2.inOut',
          onComplete: () => {
            item.sphere.visible = false
          }
        })
      } else {
        item.sphere.position.copy(targetLocal)
        item.sphere.visible = false
      }
    })

    this._handoffActive = true
    this._handoffBaseY = this.verticalHex.position.y
    this._handoffData = {
      laneRatios,
      colors: projected.slice(0, maxLanes).map(item => item.color),
      barHeightRatio,
      barYOffsetRatio
    }

    return {
      data: this._handoffData,
      totalDelayMs: Math.max(duration, 0.01) * Math.max(0, transitionFraction) * 1000
    }
  }

  resetScene() {
    // Clear any pending timers
    if (this._resetTimer) {
      clearTimeout(this._resetTimer)
      this._resetTimer = null
    }
    if (this._introTimer) {
      clearTimeout(this._introTimer)
      this._introTimer = null
    }
    if (this._dimensionTimer) {
      clearTimeout(this._dimensionTimer)
      this._dimensionTimer = null
    }

    // Reset immediately so positions are correct when slide is shown again
    this._doReset()
  }

  _doReset() {
    const gsap = window.gsap
    const hexRadius = 2.25

    // Reset vertical hex to 2x3 grid positions
    if (this.verticalHex) {
      const spheres = this.verticalHex.userData?.spheres || []
      spheres.forEach((sphereGroup) => {
        if (!sphereGroup) return
        if (gsap) {
          gsap.killTweensOf(sphereGroup.position)
          gsap.killTweensOf(sphereGroup.scale)
        }
        const baseScale = sphereGroup.userData?.baseScale
        if (baseScale) sphereGroup.scale.copy(baseScale)
      })

      const connections = this.verticalHex.userData?.connections || []
      connections.forEach((link) => {
        if (!link) return
        const uniforms = link.material && link.material.uniforms
        if (uniforms) {
          if (uniforms.progress) {
            if (gsap) gsap.killTweensOf(uniforms.progress)
            uniforms.progress.value = 0  // Start hidden for shoot-out
          }
          if (uniforms.opacity) {
            if (gsap) gsap.killTweensOf(uniforms.opacity)
            uniforms.opacity.value = 1  // Reset opacity
          }
        }
        link.visible = true
      })

      if (gsap) {
        gsap.killTweensOf(this.verticalHex.position)
      }
      if (this.verticalHexBasePosition) {
        this.verticalHex.position.copy(this.verticalHexBasePosition)
      } else if (typeof this.verticalHexBaseY === 'number') {
        this.verticalHex.position.y = this.verticalHexBaseY
      }

      // Keep visible but reset to grid positions
      this.verticalHex.visible = true
      this._setupVerticalIntroPositions(this.verticalHex, hexRadius)
    }

    this._handoffActive = false
    this._handoffData = null
    this._handoffBaseY = null

    // Hide dimension lines
    if (this.dimensionLines) {
      this.dimensionLines.hide()
    }
    // Don't auto-play intro here - playIntro() will be called by onEnter
  }

  _update() {
    const t = performance.now() * 0.001

    if (this.sphereFactory) {
      this.sphereFactory.update(t)
    }

    if (this.verticalHex) {
      if (this._handoffActive && typeof this._handoffBaseY === 'number') {
        this.verticalHex.position.y = this._handoffBaseY
      } else {
        this.verticalHex.position.y = this.verticalHexBaseY + Math.sin(t) * 0.12
      }
    }

    syncConnectionColors(this.connectionLinks, t)

    // Make dimension lines face camera (billboard) - quaternion copy keeps elements parallel to view plane
    if (this.dimensionLines && this.dimensionLines.group && this.camera) {
      this.dimensionLines.group.quaternion.copy(this.camera.quaternion)
    }

    // Render CSS3D layer
    if (this.css3DRenderer && this.scene && this.camera) {
      this.css3DRenderer.render(this.scene, this.camera)
    }
  }

  _applyDragRotation({ x, y }) {
    if (!this.verticalHex) return
    const base = this._hexBaseRotation
    if (base) {
      this.verticalHex.rotation.x = base.x + x
      this.verticalHex.rotation.y = base.y + y
      this.verticalHex.rotation.z = base.z
    } else {
      super._applyDragRotation({ x, y })
    }
  }
}
