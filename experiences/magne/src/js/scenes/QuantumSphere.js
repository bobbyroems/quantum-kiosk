/**
 * Creates shared geometry and material for quantum spheres.
 * Each sphere has:
 * - Solid white vertical circle (meridian)
 * - Dotted white horizontal circle (equator)
 */
export function createQuantumSphereFactory(THREE, options = {}, Line2Components = null) {
  const {
    radius = 0.35,
    segments = 32,
    color = 0x0078d4,
    roughness = 0.45,
    metalness = 0.12,
    emissive = 0x0a1e35,
    emissiveIntensity = 0.35,
    lineColor = 0xffffff,
    lineWidth = 1,
    solidLineWidth = 0.5,
    dashedLineWidth = 0.5,
    circleSegments = 256,
    dashSize = 0.02,
    gapSize = 0.03
  } = options

  const useLine2 = Line2Components && Line2Components.Line2 && Line2Components.LineMaterial && Line2Components.LineGeometry

  // Shared geometry
  const sphereGeometry = new THREE.SphereGeometry(radius, segments, Math.floor(segments * 0.7))

  // Shared material
  const sphereMaterial = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    emissive,
    emissiveIntensity
  })

  // Circle radius slightly larger than sphere
  const circleRadius = radius * 1.01

  // Shared vertical circle geometry (fallback)
  const verticalPoints = []
  for (let i = 0; i <= circleSegments; i++) {
    const angle = (i / circleSegments) * Math.PI * 2
    verticalPoints.push(new THREE.Vector3(
      0,
      Math.sin(angle) * circleRadius,
      Math.cos(angle) * circleRadius
    ))
  }
  const verticalGeometry = new THREE.BufferGeometry().setFromPoints(verticalPoints)

  // Shared line materials (fallback)
  const solidLineMaterial = new THREE.LineBasicMaterial({
    color: lineColor,
    linewidth: lineWidth
  })

  // For Line2: create LineGeometry and LineMaterial
  let horizontalLineGeometry = null
  let verticalLineGeometry = null
  let dashedLineMaterial2 = null
  let solidLineMaterial2 = null

  if (useLine2) {
    const { LineGeometry, LineMaterial } = Line2Components

    // Horizontal circle (dashed) - Line2 positions
    const hPositions = []
    for (let i = 0; i <= circleSegments; i++) {
      const angle = (i / circleSegments) * Math.PI * 2
      hPositions.push(
        Math.cos(angle) * circleRadius,
        0,
        Math.sin(angle) * circleRadius
      )
    }

    horizontalLineGeometry = new LineGeometry()
    horizontalLineGeometry.setPositions(hPositions)

    dashedLineMaterial2 = new LineMaterial({
      color: lineColor,
      linewidth: dashedLineWidth,
      dashed: true,
      dashSize: dashSize,
      gapSize: gapSize,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
    })

    // Vertical circle (solid) - Line2 positions
    const vPositions = []
    for (let i = 0; i <= circleSegments; i++) {
      const angle = (i / circleSegments) * Math.PI * 2
      vPositions.push(
        0,
        Math.sin(angle) * circleRadius,
        Math.cos(angle) * circleRadius
      )
    }

    verticalLineGeometry = new LineGeometry()
    verticalLineGeometry.setPositions(vPositions)

    solidLineMaterial2 = new LineMaterial({
      color: lineColor,
      linewidth: solidLineWidth,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
    })
  }

  // Fallback: regular dashed line
  const horizontalPoints = []
  for (let i = 0; i <= circleSegments; i++) {
    const angle = (i / circleSegments) * Math.PI * 2
    horizontalPoints.push(new THREE.Vector3(
      Math.cos(angle) * circleRadius,
      0,
      Math.sin(angle) * circleRadius
    ))
  }
  const horizontalGeometry = new THREE.BufferGeometry().setFromPoints(horizontalPoints)

  const dashedLineMaterial = new THREE.LineDashedMaterial({
    color: lineColor,
    linewidth: lineWidth,
    dashSize,
    gapSize
  })

  const horizontalCircles = []

  return {
    sphereGeometry,
    sphereMaterial,
    verticalGeometry,
    horizontalGeometry,
    solidLineMaterial,
    dashedLineMaterial,

    /**
     * Update animation - call this in your render loop
     */
    update(time) {
      // Animation removed
    },

    /**
     * Update resolution for Line2 materials (call on resize)
     */
    updateResolution(width, height) {
      if (dashedLineMaterial2) {
        dashedLineMaterial2.resolution.set(width, height)
      }
      if (solidLineMaterial2) {
        solidLineMaterial2.resolution.set(width, height)
      }
    },

    /**
     * Create a sphere instance using shared resources
     */
    create(instanceOptions = {}) {
      const {
        castShadow = false,
        receiveShadow = false
      } = instanceOptions

      const group = new THREE.Group()

      const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial)
      sphere.castShadow = castShadow
      sphere.receiveShadow = receiveShadow
      group.add(sphere)

      let verticalCircle
      if (useLine2) {
        const { Line2 } = Line2Components
        verticalCircle = new Line2(verticalLineGeometry, solidLineMaterial2)
      } else {
        verticalCircle = new THREE.Line(verticalGeometry, solidLineMaterial)
      }
      group.add(verticalCircle)

      let horizontalCircle
      if (useLine2) {
        const { Line2 } = Line2Components
        horizontalCircle = new Line2(horizontalLineGeometry, dashedLineMaterial2)
        horizontalCircle.computeLineDistances()
      } else {
        horizontalCircle = new THREE.Line(horizontalGeometry, dashedLineMaterial)
        horizontalCircle.computeLineDistances()
      }
      horizontalCircles.push(horizontalCircle)
      group.add(horizontalCircle)

      group.userData.sphere = sphere
      group.userData.verticalCircle = verticalCircle
      group.userData.horizontalCircle = horizontalCircle

      return group
    },

    /**
     * Dispose of shared resources
     */
    dispose() {
      sphereGeometry.dispose()
      sphereMaterial.dispose()
      verticalGeometry.dispose()
      horizontalGeometry.dispose()
      solidLineMaterial.dispose()
      dashedLineMaterial.dispose()
      if (horizontalLineGeometry) horizontalLineGeometry.dispose()
      if (verticalLineGeometry) verticalLineGeometry.dispose()
      if (dashedLineMaterial2) dashedLineMaterial2.dispose()
      if (solidLineMaterial2) solidLineMaterial2.dispose()
    }
  }
}
