import { assetUrl } from '../../core/asset-url.js'

const BUOY_URL = 'assets/modules/differences/Buoy.glb'
const TARGET_HEIGHT = 1.36
const REQUIRED_PARTS = Object.freeze(['Qubit', 'Frame', 'Flagpole', 'Flag'])
const BUOY_STENCIL_REF = 1

export const BUOY_FLAG_HEIGHT_LIMITS = Object.freeze({ min: 0.72, max: 8.5 })
export const BUOY_SCREEN_EAST_YAW = -Math.PI / 2
export const BUOY_QUBIT_COLORS = Object.freeze({
  source: '#42b9f5',
  candidate: '#ee3b32',
  winner: '#39b874',
  menu: '#5547c9',
  cue: '#07529c'
})

export const BUOY_SELECTION_OUTLINE_COLOR = '#63c7ff'

export const BUOY_WASHED_COLORS = Object.freeze({
  emissive: '#16364a',
  flag: '#91a9b8',
  frame: '#a7bac6',
  pole: '#738e9e',
  qubit: '#789dae'
})

export const BUOY_SOURCE_PRESET = Object.freeze({
  qubitColor: BUOY_QUBIT_COLORS.source,
  qubitEmissive: '#0879bd',
  frameColor: '#d6f1ff',
  poleColor: '#8cc9e8',
  flagColor: '#b9e7fb'
})

export const BUOY_IDENTITY_PRESETS = Object.freeze({
  candidate: Object.freeze({
    qubitColor: BUOY_QUBIT_COLORS.candidate,
    qubitEmissive: '#5c1512',
    frameColor: '#ffc0b7',
    poleColor: '#c45b51',
    flagColor: '#ed786b'
  }),
  winner: Object.freeze({
    qubitColor: BUOY_QUBIT_COLORS.winner,
    qubitEmissive: '#135c38',
    frameColor: '#c0ecd1',
    poleColor: '#238d6b',
    flagColor: '#168f58'
  }),
  menu: Object.freeze({
    qubitColor: BUOY_QUBIT_COLORS.menu,
    qubitEmissive: '#21185f',
    frameColor: '#e4e9ff',
    poleColor: '#707aa9',
    flagColor: '#897bef'
  })
})

const BUOY_CUE_PRESET = Object.freeze({
  qubitColor: BUOY_QUBIT_COLORS.cue,
  qubitEmissive: '#032b5c',
  qubitEmissiveIntensity: 0.2
})

const BUOY_MATERIAL_PRESETS = Object.freeze({
  default: Object.freeze({
    frameEnvMapIntensity: 1.45,
    frameMetalness: 0.28,
    frameRoughness: 0.26,
    quietEmissiveIntensity: 0.12
  }),
  menu: Object.freeze({
    frameEnvMapIntensity: 1.35,
    frameMetalness: 0.18,
    frameRoughness: 0.3,
    quietEmissiveIntensity: 0.26
  })
})

let buoyAssetsPromise = null

function findRequiredParts(root) {
  const parts = Object.fromEntries(REQUIRED_PARTS.map(name => [name, root.getObjectByName(name)]))
  const missing = REQUIRED_PARTS.filter(name => !parts[name]?.isMesh)
  if (missing.length) throw new Error(`Buoy GLB is missing: ${missing.join(', ')}`)
  return parts
}

export function calculateBuoyFlagTransform(multiplier, {
  baseFlagY,
  basePoleScaleY,
  poleHeight
}) {
  const requestedMultiplier = Number.isFinite(multiplier) ? multiplier : 1
  const safeMultiplier = Math.max(
    BUOY_FLAG_HEIGHT_LIMITS.min,
    Math.min(BUOY_FLAG_HEIGHT_LIMITS.max, requestedMultiplier)
  )
  return {
    flagY: baseFlagY + (poleHeight * basePoleScaleY * (safeMultiplier - 1)),
    poleScaleY: basePoleScaleY * safeMultiplier
  }
}

function boundsInParentSpace(THREE, part) {
  part.geometry.computeBoundingBox()
  part.updateMatrix()
  return part.geometry.boundingBox.clone().applyMatrix4(part.matrix)
}

/*
 * The two guide lines drawn on every qubit: a solid meridian running pole to pole and
 * a dashed equator around it, both white. They are drawn as thin tori
 * rather than lines because WebGL ignores line width, and at kiosk resolution a
 * one-pixel line disappears on the far buoys and aliases on the near ones.
 *
 * Geometry and materials are built once and shared by every buoy - the qubit is the
 * same mesh on all of them, so there is nothing per-buoy to vary.
 */
export const BUOY_QUBIT_LINE_COLOR = '#ffffff'
const QUBIT_LINE_DASHES = 30
let qubitLineAssets = null

function getQubitLineAssets(THREE, radius) {
  if (qubitLineAssets) return qubitLineAssets
  const lineMaterial = dashes => new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(BUOY_QUBIT_LINE_COLOR) },
      uDashes: { value: dashes }
    },
    vertexShader: `
      varying vec2 vQubitLineUv;

      void main() {
        vQubitLineUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uDashes;
      varying vec2 vQubitLineUv;

      void main() {
        /* v says which ring this is - 0 the solid meridian, 1 the dashed equator -
           and u runs around the ring, so cutting u into bands makes the dashes. */
        if (vQubitLineUv.y > 0.5 && fract(vQubitLineUv.x * uDashes) > 0.55) discard;
        gl_FragColor = vec4(uColor, 1.0);
      }
    `,
    toneMapped: false
  })
  /* Sat just off the surface so the sphere still hides the far half of each ring.
     A torus lies in its own XY plane, which is already the vertical circle; the
     equator is the same ring laid flat. */
  const meridian = new THREE.TorusGeometry(radius * 1.008, radius * 0.021, 6, 128)
  const equator = meridian.clone().rotateX(Math.PI / 2)
  qubitLineAssets = {
    /* Both rings in one geometry, so a buoy spends one draw call on its lines rather
       than two. v carries which ring a vertex belongs to; the shader dashes on it. */
    geometry: mergeQubitLineRings(THREE, meridian, equator),
    material: lineMaterial(QUBIT_LINE_DASHES)
  }
  meridian.dispose()
  equator.dispose()
  return qubitLineAssets
}

function mergeQubitLineRings(THREE, solidRing, dashedRing) {
  const merged = new THREE.BufferGeometry()
  const rings = [
    { geometry: solidRing, band: 0 },
    { geometry: dashedRing, band: 1 }
  ]
  const vertexCount = rings.reduce((total, r) => total + r.geometry.attributes.position.count, 0)
  const indexCount = rings.reduce((total, r) => total + r.geometry.index.count, 0)
  const positions = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const indices = new Uint32Array(indexCount)
  let vertexOffset = 0
  let indexOffset = 0
  for (const { geometry, band } of rings) {
    const source = geometry.attributes.position.array
    const sourceUv = geometry.attributes.uv.array
    const count = geometry.attributes.position.count
    positions.set(source, vertexOffset * 3)
    for (let index = 0; index < count; index += 1) {
      uvs[(vertexOffset + index) * 2] = sourceUv[index * 2]
      uvs[((vertexOffset + index) * 2) + 1] = band
    }
    const sourceIndex = geometry.index.array
    for (let index = 0; index < sourceIndex.length; index += 1) {
      indices[indexOffset + index] = sourceIndex[index] + vertexOffset
    }
    vertexOffset += count
    indexOffset += sourceIndex.length
  }
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  merged.setIndex(new THREE.BufferAttribute(indices, 1))
  merged.computeBoundingSphere()
  return merged
}

/*
 * Each qubit wears its rings at its own angle, so a field of buoys shows the pair from
 * every side rather than reading as one shape stamped twenty-five times. Derived from
 * the buoy's index rather than from Math.random so a buoy keeps its angle across
 * rounds and restarts; the golden angle spreads the yaw evenly however many there are,
 * and the tilts stay small enough that the pair still reads as a meridian and an
 * equator rather than as two arbitrary hoops. Seed 0 keeps the authored upright pose,
 * which is what the selection-screen preview wants.
 */
const QUBIT_LINE_GOLDEN_ANGLE = 2.399963229728653
const QUBIT_LINE_MAX_TILT = 0.33

function orientQubitLines(lines, seed) {
  const index = Math.max(0, Math.floor(Number(seed) || 0))
  if (index === 0) return lines
  lines.rotation.set(
    ((((index * 7) % 13) / 12) - 0.5) * 2 * QUBIT_LINE_MAX_TILT,
    (index * QUBIT_LINE_GOLDEN_ANGLE) % (Math.PI * 2),
    ((((index * 5) % 11) / 10) - 0.5) * 2 * QUBIT_LINE_MAX_TILT
  )
  return lines
}

function createQubitAxisLines(THREE, qubit, seed) {
  qubit.geometry.computeBoundingSphere()
  const { geometry, material } = getQubitLineAssets(
    THREE,
    qubit.geometry.boundingSphere.radius
  )
  const lines = new THREE.Mesh(geometry, material)
  lines.name = 'QubitLines'
  orientQubitLines(lines, seed)
  qubit.add(lines)
  return lines
}

function createMeshSelectionOutline(THREE, mesh, screenThickness, {
  scaleFromCenter = false,
  showThroughWater = false
} = {}) {
  mesh.geometry.computeBoundingSphere()
  const material = new THREE.ShaderMaterial({
    blending: THREE.NormalBlending,
    depthTest: !showThroughWater,
    depthWrite: false,
    /* Stencil removes the original mesh footprint, so both face orientations
       are safe here. Rendering both fixes gaps on the buoy's thin cage bars,
       open seams, and concave joins that a back-face-only hull can miss. */
    side: THREE.DoubleSide,
    stencilWrite: showThroughWater,
    stencilRef: showThroughWater ? BUOY_STENCIL_REF : 0,
    stencilFunc: showThroughWater ? THREE.NotEqualStencilFunc : THREE.AlwaysStencilFunc,
    stencilFail: THREE.KeepStencilOp,
    stencilZFail: THREE.KeepStencilOp,
    stencilZPass: THREE.KeepStencilOp,
    toneMapped: false,
    transparent: true,
    uniforms: {
      uColor: { value: new THREE.Color(BUOY_SELECTION_OUTLINE_COLOR) },
      uCue: { value: 0 },
      uScale: { value: scaleFromCenter ? 1.3 : 1 },
      uScaleCenter: { value: mesh.geometry.boundingSphere.center.clone() },
      uScaleFromCenter: { value: scaleFromCenter ? 1 : 0 },
      uScreenThickness: { value: screenThickness }
    },
    vertexShader: `
      uniform float uScale;
      uniform vec3 uScaleCenter;
      uniform float uScaleFromCenter;
      uniform float uScreenThickness;

      void main() {
        vec3 scaledOutline = uScaleCenter + ((position - uScaleCenter) * uScale);
        vec3 outlinedPosition = mix(position, scaledOutline, uScaleFromCenter);
        vec4 viewPosition = modelViewMatrix * vec4(outlinedPosition, 1.0);
        vec4 clipPosition = projectionMatrix * viewPosition;

        if (uScaleFromCenter < 0.5) {
          vec3 viewNormal = normalize(normalMatrix * normal);
          vec2 projectedNormal = (projectionMatrix * vec4(viewNormal, 0.0)).xy;
          float aspect = projectionMatrix[1][1] / projectionMatrix[0][0];
          vec2 pixelNormal = vec2(projectedNormal.x * aspect, projectedNormal.y);
          float normalLength = length(pixelNormal);
          if (normalLength > 0.0001) {
            vec2 pixelDirection = pixelNormal / normalLength;
            vec2 ndcDirection = vec2(pixelDirection.x / aspect, pixelDirection.y);
            clipPosition.xy += ndcDirection * uScreenThickness * clipPosition.w;
          }
        }

        gl_Position = clipPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uCue;

      void main() {
        gl_FragColor = vec4(uColor, uCue);
      }
    `
  })
  /* Classic game outline: solid parts extrude along their projected normals at
     a constant screen width. The flat flag scales from its geometry centre;
     stencil hides each original footprint and leaves the hard silhouette. */
  const outline = new THREE.Mesh(mesh.geometry, material)
  outline.name = `${mesh.name}SelectionOutline`
  outline.renderOrder = showThroughWater
    ? Math.max(6, mesh.renderOrder + 1)
    : mesh.renderOrder + 1
  outline.visible = false
  outline.userData.materials = [material]
  mesh.add(outline)
  return outline
}

function createBuoySelectionOutlines(THREE, parts, options) {
  /* NDC height units: about 9px on the kiosk canvas. Larger values make the
     cage's long side rails read as displaced rather than tightly outlined. */
  const screenThickness = 0.005
  return REQUIRED_PARTS.map(name => createMeshSelectionOutline(
    THREE,
    parts[name],
    screenThickness,
    {
      ...options,
      scaleFromCenter: name === 'Flag'
    }
  ))
}

export function calculateBuoyFlagAttachmentOffset({ THREE, qubit, flagpole }) {
  if (!qubit?.isMesh || !flagpole?.isMesh || qubit.parent !== flagpole.parent) return 0
  const qubitBounds = boundsInParentSpace(THREE, qubit)
  const poleBounds = boundsInParentSpace(THREE, flagpole)
  return qubitBounds.max.y - poleBounds.min.y
}

export function calculateBuoyQubitMetrics({ THREE, qubit }) {
  if (!qubit?.isMesh) return Object.freeze({ centerY: 0, radius: 0 })
  const bounds = boundsInParentSpace(THREE, qubit)
  const size = bounds.getSize(new THREE.Vector3())
  return Object.freeze({
    centerY: (bounds.min.y + bounds.max.y) * 0.5,
    radius: size.y * 0.5
  })
}

export function loadBuoyAssets() {
  buoyAssetsPromise ??= (async () => {
    const [THREE, { GLTFLoader }] = await Promise.all([
      import('three'),
      import('three/addons/loaders/GLTFLoader.js')
    ])
    const gltf = await new GLTFLoader().loadAsync(assetUrl(BUOY_URL))
    const template = gltf.scene
    findRequiredParts(template)

    const bounds = new THREE.Box3().setFromObject(template)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const scale = TARGET_HEIGHT / Math.max(0.0001, size.y)
    template.scale.setScalar(scale)
    template.position.set(-center.x * scale, 0, -center.z * scale)
    template.updateMatrixWorld(true)

    return Object.freeze({ template })
  })().catch(error => {
    buoyAssetsPromise = null
    throw error
  })
  return buoyAssetsPromise
}

export function cloneBuoy({
  THREE,
  template,
  identity: requestedIdentity,
  /* Which buoy this is, so its rings can face a different way from its neighbours.
     Stable across rounds; 0 leaves them upright. */
  qubitLineSeed = 0
}) {
  const root = template.clone(true)
  const materials = new Set()
  const identity = BUOY_IDENTITY_PRESETS[requestedIdentity]
    ? requestedIdentity
    : 'candidate'
  const identityPreset = BUOY_IDENTITY_PRESETS[identity]
  const initialPreset = identity === 'menu' ? identityPreset : BUOY_SOURCE_PRESET
  const materialPreset = identity === 'menu'
    ? BUOY_MATERIAL_PRESETS.menu
    : BUOY_MATERIAL_PRESETS.default
  const showOutlineThroughWater = identity !== 'menu'

  root.traverse(object => {
    if (!object.isMesh) return
    if (object.name === 'Qubit') {
      object.material = new THREE.MeshPhysicalMaterial({
        clearcoat: 0.78,
        clearcoatRoughness: 0.18,
        color: initialPreset.qubitColor,
        emissive: initialPreset.qubitEmissive,
        emissiveIntensity: materialPreset.quietEmissiveIntensity,
        envMapIntensity: identity === 'menu' ? 1.5 : 1,
        metalness: 0.03,
        roughness: 0.24
      })
    } else {
      object.material = object.material.clone()
      if (object.name === 'Frame') {
        object.material.color.set(initialPreset.frameColor)
        object.material.metalness = materialPreset.frameMetalness
        object.material.roughness = materialPreset.frameRoughness
        object.material.envMapIntensity = materialPreset.frameEnvMapIntensity
      } else if (object.name === 'Flagpole') {
        object.material.color.set(initialPreset.poleColor)
        object.material.metalness = 0.3
        object.material.roughness = 0.3
      } else if (object.name === 'Flag') {
        object.material.color.set(initialPreset.flagColor)
        object.material.forceSinglePass = true
        object.material.roughness = 0.34
        object.material.side = THREE.DoubleSide
      }
      object.material.needsUpdate = true
    }
    if (showOutlineThroughWater) {
      object.material.stencilWrite = true
      object.material.stencilRef = BUOY_STENCIL_REF
      object.material.stencilFunc = THREE.AlwaysStencilFunc
      object.material.stencilFail = THREE.KeepStencilOp
      object.material.stencilZFail = THREE.KeepStencilOp
      object.material.stencilZPass = THREE.ReplaceStencilOp
    }
    materials.add(object.material)
  })

  const parts = findRequiredParts(root)
  parts.QubitLines = createQubitAxisLines(THREE, parts.Qubit, qubitLineSeed)
  parts.SelectionOutlines = createBuoySelectionOutlines(THREE, parts, {
    showThroughWater: showOutlineThroughWater
  })
  parts.SelectionOutlines.forEach(outline => {
    outline.userData.materials.forEach(material => materials.add(material))
  })
  parts.Flagpole.geometry.computeBoundingBox()
  const poleHeight = parts.Flagpole.geometry.boundingBox.getSize(new THREE.Vector3()).y
  const basePoleScaleY = parts.Flagpole.scale.y
  const basePoleY = parts.Flagpole.position.y
  const baseFlagY = parts.Flag.position.y
  const baseFlagScale = parts.Flag.scale.clone()
  const baseFlagQuaternion = parts.Flag.quaternion.clone()
  const flagAttachmentOffset = calculateBuoyFlagAttachmentOffset({
    THREE,
    qubit: parts.Qubit,
    flagpole: parts.Flagpole
  })
  const qubitMetrics = calculateBuoyQubitMetrics({ THREE, qubit: parts.Qubit })
  const flagYawQuaternion = new THREE.Quaternion()
  const flagYawAxis = new THREE.Vector3(0, 1, 0)
  /* Every field buoy starts from the same blue possibility. Callers can reveal its
     identity progressively, allowing the winning green to accumulate step by step. */
  const outcomeStartPreset = initialPreset
  const outcomeEndPreset = identityPreset
  const outcomeStartColors = {
    qubit: new THREE.Color(outcomeStartPreset.qubitColor),
    emissive: new THREE.Color(outcomeStartPreset.qubitEmissive),
    frame: new THREE.Color(outcomeStartPreset.frameColor),
    pole: new THREE.Color(outcomeStartPreset.poleColor),
    flag: new THREE.Color(outcomeStartPreset.flagColor)
  }
  const outcomeEndColors = {
    qubit: new THREE.Color(outcomeEndPreset.qubitColor),
    emissive: new THREE.Color(outcomeEndPreset.qubitEmissive),
    frame: new THREE.Color(outcomeEndPreset.frameColor),
    pole: new THREE.Color(outcomeEndPreset.poleColor),
    flag: new THREE.Color(outcomeEndPreset.flagColor)
  }
  const outcomeColors = {
    qubit: outcomeEndColors.qubit.clone(),
    emissive: outcomeEndColors.emissive.clone(),
    frame: outcomeEndColors.frame.clone(),
    pole: outcomeEndColors.pole.clone(),
    flag: outcomeEndColors.flag.clone()
  }
  const scratchColors = {
    qubit: new THREE.Color(),
    emissive: new THREE.Color(),
    frame: new THREE.Color(),
    pole: new THREE.Color(),
    flag: new THREE.Color()
  }
  const cueColors = {
    qubit: new THREE.Color(BUOY_CUE_PRESET.qubitColor),
    emissive: new THREE.Color(BUOY_CUE_PRESET.qubitEmissive)
  }
  const washedColors = {
    qubit: new THREE.Color(BUOY_WASHED_COLORS.qubit),
    emissive: new THREE.Color(BUOY_WASHED_COLORS.emissive),
    frame: new THREE.Color(BUOY_WASHED_COLORS.frame),
    pole: new THREE.Color(BUOY_WASHED_COLORS.pole),
    flag: new THREE.Color(BUOY_WASHED_COLORS.flag)
  }
  let cueAmount = 0
  let flagBaseOffset = 0
  let flagHeight = 1
  let flagScale = 1
  let colorStrength = 1
  let outcomeAmount = 0

  function applyFlagTransform() {
    const transform = calculateBuoyFlagTransform(flagHeight, {
      baseFlagY,
      basePoleScaleY,
      poleHeight
    })
    parts.Flagpole.position.y = basePoleY + flagBaseOffset
    parts.Flagpole.scale.y = transform.poleScaleY
    parts.Flag.position.y = transform.flagY + flagBaseOffset
    parts.Flag.scale.copy(baseFlagScale).multiplyScalar(flagScale)
  }

  function applyAppearance() {
    outcomeColors.qubit.copy(outcomeStartColors.qubit).lerp(
      outcomeEndColors.qubit,
      outcomeAmount
    )
    outcomeColors.emissive.copy(outcomeStartColors.emissive).lerp(
      outcomeEndColors.emissive,
      outcomeAmount
    )
    outcomeColors.frame.copy(outcomeStartColors.frame).lerp(
      outcomeEndColors.frame,
      outcomeAmount
    )
    outcomeColors.pole.copy(outcomeStartColors.pole).lerp(
      outcomeEndColors.pole,
      outcomeAmount
    )
    outcomeColors.flag.copy(outcomeStartColors.flag).lerp(
      outcomeEndColors.flag,
      outcomeAmount
    )

    const washAmount = 1 - colorStrength
    scratchColors.qubit.copy(outcomeColors.qubit).lerp(washedColors.qubit, washAmount)
    scratchColors.emissive.copy(outcomeColors.emissive).lerp(
      washedColors.emissive,
      washAmount
    )
    scratchColors.frame.copy(outcomeColors.frame).lerp(washedColors.frame, washAmount)
    scratchColors.pole.copy(outcomeColors.pole).lerp(washedColors.pole, washAmount)
    scratchColors.flag.copy(outcomeColors.flag).lerp(washedColors.flag, washAmount)
    scratchColors.qubit.lerp(cueColors.qubit, cueAmount)
    scratchColors.emissive.lerp(cueColors.emissive, cueAmount)

    parts.Qubit.material.color.copy(scratchColors.qubit)
    parts.Qubit.material.emissive.copy(scratchColors.emissive)
    parts.Qubit.material.emissiveIntensity = materialPreset.quietEmissiveIntensity +
      (cueAmount * (
        BUOY_CUE_PRESET.qubitEmissiveIntensity - materialPreset.quietEmissiveIntensity
      ))
    parts.Frame.material.color.copy(scratchColors.frame)
    parts.Flagpole.material.color.copy(scratchColors.pole)
    parts.Flag.material.color.copy(scratchColors.flag)
  }

  function setCue(amount, { outlineAmount = amount } = {}) {
    const requestedAmount = Number.isFinite(amount) ? amount : 0
    cueAmount = Math.max(0, Math.min(1, requestedAmount))
    const requestedOutlineAmount = Number.isFinite(outlineAmount)
      ? outlineAmount
      : cueAmount
    const safeOutlineAmount = Math.max(0, Math.min(1, requestedOutlineAmount))
    for (const outline of parts.SelectionOutlines) {
      for (const material of outline.userData.materials) {
        material.uniforms.uCue.value = safeOutlineAmount
      }
      outline.visible = safeOutlineAmount > 0.001
    }
    applyAppearance()
  }

  return {
    identity,
    qubitMetrics,
    root,
    parts,
    setFlagHeight(multiplier) {
      flagHeight = Number.isFinite(multiplier) ? multiplier : 1
      applyFlagTransform()
    },
    setFlagAttachment(amount) {
      const requestedAmount = Number.isFinite(amount) ? amount : 0
      flagBaseOffset = flagAttachmentOffset * Math.max(0, Math.min(1, requestedAmount))
      applyFlagTransform()
    },
    setFlagScale(multiplier) {
      flagScale = Number.isFinite(multiplier) ? Math.max(0, multiplier) : 1
      applyFlagTransform()
    },
    setFlagYaw(yaw) {
      const safeYaw = Number.isFinite(yaw) ? yaw : 0
      flagYawQuaternion.setFromAxisAngle(flagYawAxis, safeYaw)
      parts.Flag.quaternion.copy(baseFlagQuaternion).premultiply(flagYawQuaternion)
    },
    setCue,
    setColorStrength(amount) {
      const requestedAmount = Number.isFinite(amount) ? amount : 0
      colorStrength = Math.max(0, Math.min(1, requestedAmount))
      applyAppearance()
    },
    setOutcome(amount) {
      const requestedAmount = Number.isFinite(amount) ? amount : 0
      outcomeAmount = Math.max(0, Math.min(1, requestedAmount))
      applyAppearance()
    },
    dispose() {
      materials.forEach(material => material.dispose())
    }
  }
}
