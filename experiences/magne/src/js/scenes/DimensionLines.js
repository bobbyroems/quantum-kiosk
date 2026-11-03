/**
 * Creates dimension lines and 3D CSS labels for measurement callouts.
 * Flexible configuration for different layouts per page.
 *
 * Usage:
 *   const dims = createDimensionLines(THREE, CSS3DComponents, {
 *     lines: [
 *       { from: [0, 0, 0], to: [5, 0, 0] },
 *       { from: [0, 0, 0], to: [0, -5, 0] }
 *     ],
 *     labels: [
 *       { position: [6, -2, 0], title: 'Magnification', value: 'x100,000,000' }
 *     ],
 *     lineColor: 0x000000,
 *     labelScale: 0.02
 *   })
 *
 *   sceneGroup.add(dims.group)
 *   dims.fadeIn(gsap)
 *   dims.fadeOut(gsap)
 */

/**
 * Builds a callout configuration with lines pointing to a label.
 * Creates: horizontal line -> vertical line -> horizontal line -> label
 *
 * @param {Object} config
 * @param {number} config.sphereX - X position of the sphere
 * @param {number} config.sphereY - Y position of the sphere
 * @param {number} config.radius - Sphere radius (for gap calculation)
 * @param {string} config.direction - 'up' or 'down'
 * @param {string} config.labelSide - 'right' or 'left'
 * @param {number} config.horizLength - Length of first horizontal line
 * @param {number} config.verticalLength - Length of vertical line
 * @param {number} config.endHorizLength - Length of final horizontal line
 * @param {string} config.title - Label title
 * @param {string} config.text - Label text (can contain HTML)
 * @param {number} config.descWidthPx - Label width in pixels
 * @param {number} config.labelScale - Scale factor for labels
 * @param {number} [config.gap=0.5] - Gap from sphere edge
 * @param {number} [config.labelGap=0.3] - Gap between line end and label
 * @param {number} [config.titleOffset=25] - CSS variable for title offset
 * @returns {Object} { lines: Array, label: Object }
 */
export function buildCalloutConfig({
  sphereX,
  sphereY,
  radius,
  direction = 'up',
  labelSide = 'right',
  horizLength,
  verticalLength,
  endHorizLength,
  title,
  text,
  descWidthPx,
  labelScale,
  gap = 0.5,
  labelGap = 0.3,
  titleOffset = 25
}) {
  const isUp = direction === 'up'
  const isRight = labelSide === 'right'

  // First horizontal line (above or below sphere)
  const horizStartX = sphereX - horizLength / 2
  const horizEndX = sphereX + horizLength / 2
  const horizY = isUp ? sphereY + radius + gap : sphereY - radius - gap

  // Vertical line from middle of horizontal
  const vertX = sphereX
  const vertEndY = isUp ? horizY + verticalLength : horizY - verticalLength

  // End horizontal line
  const endHorizStartX = vertX
  const endHorizEndX = isRight ? vertX + endHorizLength : vertX - endHorizLength

  // Label position
  const descWidthWorld = descWidthPx * labelScale
  const labelOffsetX = descWidthWorld / 2
  const labelX = isRight
    ? endHorizEndX + labelOffsetX + labelGap
    : endHorizEndX - labelOffsetX - labelGap
  const labelY = vertEndY

  const anchorClass = isRight
    ? 'dimension-description--anchor-title'
    : 'dimension-description--anchor-title-right'

  return {
    lines: [
      { from: [horizStartX, horizY, 0], to: [horizEndX, horizY, 0] },
      { from: [vertX, horizY, 0], to: [vertX, vertEndY, 0] },
      { from: [endHorizStartX, vertEndY, 0], to: [endHorizEndX, vertEndY, 0] }
    ],
    label: {
      position: [labelX, labelY, 0],
      html: `
        <div class="dimension-description ${anchorClass}" style="width: ${descWidthPx}px; --dimension-title-offset: ${titleOffset}px;">
          <div class="dimension-description__title">${title}</div>
          <div class="dimension-description__text">${text}</div>
        </div>
      `
    }
  }
}

/**
 * Callout definitions for the Compute Grid stages
 */
export const CALLOUT_DEFINITIONS = {
  quantumBits: {
    direction: 'up',
    labelSide: 'right',
    horizLengthFactor: 2,      // multiplied by radius
    verticalLength: 3.5,
    endHorizLengthFactor: 1.6, // multiplied by radius
    title: 'Every atom is a qubit',
    text: 'When computing with atomic arrays, qubits are formed from the nuclear spin of neutral atoms.'
  },
  laserTweezers: {
    direction: 'down',
    labelSide: 'right',
    horizLengthFactor: 2,
    verticalLength: 1.5,
    endHorizLengthFactor: 1.6,
    title: 'Laser control of qubits',
    text: 'Lasers control the atom’s state to perform quantum logic, enabling controlled interactions between qubits in a scalable way.'
  },
  entangledWithLight: {
    direction: 'up',
    labelSide: 'left',
    horizLengthFactor: 4,      // wider to span both spheres
    verticalLength: 4,
    endHorizLengthFactor: 2,
    title: 'Entangled with light',
    text: 'Quantum entanglement correlates qubits so that the state of one instantly reflects the state of another. Magne uses lasers to entangle atoms together, producing the large, entangled states that are a requirement for reliable quantum computing.'
  },
  allToAllConnectivity: {
    direction: 'up',
    labelSide: 'right',
    horizLengthFactor: 1,
    verticalLength: 3.0,
    endHorizLengthFactor: 0.8,
    title: 'All-to-all connectivity',
    text: 'All-to-all connectivity means any qubit can interact directly with any other qubit, providing an architectural advantage over modalities with fixed, local connectivity.'
  },
  neutralAtomArray: {
    direction: 'up',
    labelSide: 'left',
    horizLengthFactor: 1,
    verticalLength: 4,
    endHorizLengthFactor: 1,
    title: 'Neutral atom array',
    text: 'Neutral-atom systems can physically rearrange qubits in an array so they can interact with other atoms.'
  },
  siliconQubitArray: {
    direction: 'down',
    labelSide: 'right',
    horizLengthFactor: 1,
    verticalLength: 4,
    endHorizLengthFactor: 1,
    title: '2D qubit array',
    text: 'In contrast, fixed connectivity modalities can be entangled only with their nearest neighbor.'
  }
}

/**
 * Creates a callout config from a definition
 * @param {Object} definition - One of CALLOUT_DEFINITIONS
 * @param {Object} params - { sphereX, sphereY, radius, descWidthPx, labelScale }
 */
export function createCalloutFromDefinition(definition, params) {
  const { sphereX, sphereY, radius, descWidthPx, labelScale } = params
  return buildCalloutConfig({
    sphereX,
    sphereY,
    radius,
    direction: definition.direction,
    labelSide: definition.labelSide,
    horizLength: radius * definition.horizLengthFactor,
    verticalLength: definition.verticalLength,
    endHorizLength: radius * definition.endHorizLengthFactor,
    title: definition.title,
    text: definition.text,
    descWidthPx,
    labelScale
  })
}

export function createDimensionLines(THREE, CSS3DComponents, config = {}) {
  const {
    lines = [],
    labels = [],
    lineColor = 0x000000,
    lineWidth = 2,
    labelScale = 0.02
  } = config

  const group = new THREE.Group()
  const lineMaterials = []
  const labelElements = []
  let fadeToken = 0

  // Create lines
  lines.forEach(lineDef => {
    const { from, to } = lineDef
    const material = new THREE.LineBasicMaterial({
      color: lineColor,
      linewidth: lineWidth,
      transparent: true,
      opacity: 1
    })
    lineMaterials.push(material)

    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from[0], from[1], from[2] || 0),
      new THREE.Vector3(to[0], to[1], to[2] || 0)
    ])
    const line = new THREE.Line(geometry, material)
    group.add(line)
  })

  // Create 3D CSS labels
  if (CSS3DComponents) {
    const { CSS3DObject } = CSS3DComponents

    labels.forEach(labelDef => {
      const { position, title, value, html } = labelDef
      const labelDiv = document.createElement('div')
      labelDiv.className = 'dimension-labels'

      if (html) {
        labelDiv.innerHTML = html
      } else {
        labelDiv.innerHTML = `
          ${title ? `<div class="dimension-label dimension-label--title">${title}</div>` : ''}
          ${value ? `<div class="dimension-label dimension-label--value">${value}</div>` : ''}
        `
      }

      const labelObject = new CSS3DObject(labelDiv)
      // CSS3DObject constructor sets pointer-events: auto inline, override it
      // so labels don't block clicks on the highlight rings in the overlay
      labelDiv.style.pointerEvents = 'none'
      labelObject.position.set(position[0], position[1], position[2] || 0)
      labelObject.scale.set(labelScale, labelScale, labelScale)
      group.add(labelObject)
      labelElements.push(labelDiv)
    })
  }

  return {
    group,

    /**
     * Fade in all lines and labels
     */
    fadeIn(gsap, duration = 0.4) {
      fadeToken += 1
      group.visible = true
      if (gsap) {
        gsap.killTweensOf(lineMaterials)
        gsap.killTweensOf(labelElements)
        lineMaterials.forEach(mat => {
          mat.opacity = 0
          gsap.to(mat, {
            opacity: 1,
            duration,
            ease: 'power2.out',
            overwrite: 'auto'
          })
        })
        labelElements.forEach(el => {
          gsap.fromTo(el, { opacity: 0 }, {
            opacity: 1,
            duration,
            ease: 'power2.out',
            overwrite: 'auto'
          })
        })
      } else {
        lineMaterials.forEach(mat => mat.opacity = 1)
        labelElements.forEach(el => el.style.opacity = '1')
      }
    },

    /**
     * Fade out all lines and labels
     */
    fadeOut(gsap, duration = 0.3) {
      const token = ++fadeToken
      if (gsap) {
        gsap.killTweensOf(lineMaterials)
        gsap.killTweensOf(labelElements)
        lineMaterials.forEach(mat => {
          gsap.to(mat, {
            opacity: 0,
            duration,
            ease: 'power2.out',
            overwrite: 'auto'
          })
        })
        labelElements.forEach(el => {
          gsap.to(el, {
            opacity: 0,
            duration,
            ease: 'power2.out',
            overwrite: 'auto'
          })
        })
        gsap.delayedCall(duration, () => {
          if (fadeToken === token) {
            group.visible = false
          }
        })
      } else {
        group.visible = false
      }
    },

    /**
     * Show immediately (no animation)
     */
    show() {
      group.visible = true
      lineMaterials.forEach(mat => mat.opacity = 1)
      labelElements.forEach(el => el.style.opacity = '1')
    },

    /**
     * Hide immediately (no animation)
     */
    hide() {
      group.visible = false
    },

    /**
     * Dispose of resources
     */
    dispose() {
      lineMaterials.forEach(mat => mat.dispose())
      group.traverse(child => {
        if (child.geometry) child.geometry.dispose()
      })
    }
  }
}
