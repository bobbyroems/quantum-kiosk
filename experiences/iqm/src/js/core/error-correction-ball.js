/*
 * The error-correction ball: a hex-tiled Goldberg sphere whose tiles run a
 * quantum-error-correction story on loop — calm blue drift → one error
 * ignites facing the viewer and cascades to neighbours → a repair wave
 * recolours only the errored tiles to teal → stabilised → reset.
 *
 * Dependencies (three.js and the SSS shader) are injected so this module can
 * be shared by every host that lazy-loads three its own way. Build the
 * geometry template once per renderer and create one ball per scene.
 */

const CONFIG = Object.freeze({
  driftSpeed: 1,
  errorRate: 3.2,
  errorSpread: 1,
  maxErrorRatio: 0.5,
  waveDuration: 4.5,
  calmDuration: 6,
  errorsDuration: 9,
  fixedDuration: 7,
  tintStrength: 0.85,

  tileDistortion: 0.404,
  tileAmbient: 0.064,
  tileAttenuation: 0.808,
  tilePower: 4.235,
  tileScale: 8.096,
  tileGlowColor: '#9ea9ff',
  tileShininess: 1,
  tileSpecular: '#333333',
  coreColor: '#161f4d',
  edgeShade: 0.8,

  glossStrength: 0.45,
  glossRoughness: 0.18,
  glossReflect: 1,

  innerLight: { color: '#4072e7', intensity: 0.64 }
})

/* The ball's tuned material recipe, shared with the Bloch sphere. */
export const BALL_CONFIG = CONFIG

export const BALL_ACCENT_LIGHTS = Object.freeze([
  Object.freeze({ color: '#2effdc', intensity: 6.32, position: Object.freeze([-1.6, 0.9, -1.7]) }),
  Object.freeze({ color: '#e8f0ff', intensity: 1.96, position: Object.freeze([2.1, -0.5, -1.9]) })
])

export const BALL_KEY_LIGHT = Object.freeze({
  color: '#ff0000',
  intensity: 1.6,
  position: Object.freeze([2.6, 3.2, 2.2])
})

/* Outer radius of the built ball (glass shell included), for scaling hosts. */
export const BALL_RADIUS = 1.14
const SHELL_R = 1.12
/* Radius of the template's shell/ring geometry, for hosts that reuse it. */
export const BALL_SHELL_RADIUS = SHELL_R

/* Frosted glass shell material pair: pure fresnel (no lighting), milky at
   the rim. Shared by the error-correction ball and the Bloch sphere. */
export function createFrostShell(THREE) {
  const uniforms = {
    uColor: { value: new THREE.Color('#ffffff').convertSRGBToLinear() },
    uBaseAlpha: { value: 0 }, // clear centre; the shell reads only at the rim
    uRimAlpha: { value: 0.856 },
    uFresnelPow: { value: 8 },
    uRimStart: { value: 0 }, // raise to confine the glass to the silhouette
    uBackAlpha: { value: 0 },
    uGrain: { value: 0 }
  }
  const vertexShader = /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    void main() {
      vNormal = normalize(mat3(modelMatrix) * normal);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `
  const fragmentShader = /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    uniform vec3 uColor;
    uniform float uBaseAlpha, uRimAlpha, uFresnelPow, uRimStart, uBackAlpha, uGrain;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec3 N = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
      vec3 V = normalize(cameraPosition - vWorldPos);
      // rim start windows the falloff before the power curve, confining
      // the glass to a band right at the silhouette
      float edge = 1.0 - clamp(dot(N, V), 0.0, 1.0);
      float fres = pow(smoothstep(uRimStart, 1.0, edge), uFresnelPow);
      float grain = (hash(gl_FragCoord.xy * 0.75) - 0.5) * uGrain;
      float alpha = gl_FrontFacing ? (uBaseAlpha + fres * uRimAlpha) : (fres * uBackAlpha);
      // grain rides the alpha so the clear centre stays untouched
      alpha = clamp(alpha * (1.0 + grain * 8.0), 0.0, 1.0);
      gl_FragColor = vec4(uColor + vec3(fres * 0.05), alpha);
    }
  `
  const back = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide
  })
  const front = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide
  })
  return { uniforms, front, back }
}

const DETAIL = 3
const TILE_BASE_R = 0.965
const TILE_GAP = 0.86
const TILE_DEPTH = 0.055
const TILE_BEVEL = 0.008

const PHASE = Object.freeze({
  CALM: 'calm',
  ERRORS: 'errors',
  FIXING: 'fixing',
  FIXED: 'fixed',
  RESET: 'reset'
})

/*
 * What the ball is doing, said plainly, in the wording the playground used. It
 * lives next to the state machine rather than with the pill that shows it, so a
 * new phase cannot ship without a label — and the dot colour reads the same
 * story the tiles are already telling.
 */
export const BALL_PHASE_LABELS = Object.freeze({
  [PHASE.CALM]: Object.freeze({ text: 'Monitoring', color: '#2f63c9' }),
  [PHASE.ERRORS]: Object.freeze({ text: 'Errors detected', color: '#c23531' }),
  [PHASE.FIXING]: Object.freeze({ text: 'Correcting', color: '#e0a13c' }),
  [PHASE.FIXED]: Object.freeze({ text: 'Stabilized', color: '#2fa385' }),
  [PHASE.RESET]: Object.freeze({ text: 'Resetting', color: '#2f63c9' })
})

function roundedShape(THREE, points, radius) {
  const shape = new THREE.Shape()
  const count = points.length
  for (let i = 0; i < count; i++) {
    const prev = points[(i - 1 + count) % count]
    const curr = points[i]
    const next = points[(i + 1) % count]
    const inV = curr.clone().sub(prev)
    const outV = next.clone().sub(curr)
    const r = Math.min(radius, inV.length() * 0.5, outV.length() * 0.5)
    const p1 = curr.clone().sub(inV.normalize().multiplyScalar(r))
    const p2 = curr.clone().add(outV.normalize().multiplyScalar(r))
    if (i === 0) shape.moveTo(p1.x, p1.y)
    else shape.lineTo(p1.x, p1.y)
    shape.quadraticCurveTo(curr.x, curr.y, p2.x, p2.y)
  }
  shape.closePath()
  return shape
}

/*
 * Goldberg tiles: the dual of a subdivided icosahedron. Each unique vertex
 * becomes one hex (or pentagon) tile whose corners are the centroids of its
 * adjacent faces. Returns a static geometry (position/normal/uv/aTileLocal)
 * plus per-tile metadata; per-ball colour and glow attributes are added by
 * createErrorCorrectionBall.
 */
export function createBallTemplate(THREE, BufferGeometryUtils) {
  const icosa = new THREE.IcosahedronGeometry(1, DETAIL)
  const positions = icosa.getAttribute('position')
  const keyOf = v => `${v.x.toFixed(5)},${v.y.toFixed(5)},${v.z.toFixed(5)}`
  const vertMap = new Map()
  const verts = []
  for (let face = 0; face < positions.count / 3; face++) {
    const centroid = new THREE.Vector3()
    const records = []
    for (let corner = 0; corner < 3; corner++) {
      const v = new THREE.Vector3().fromBufferAttribute(positions, face * 3 + corner)
      centroid.add(v)
      const key = keyOf(v)
      let record = vertMap.get(key)
      if (!record) {
        record = { id: verts.length, n: v.clone().normalize(), corners: [], neighbors: new Set() }
        vertMap.set(key, record)
        verts.push(record)
      }
      records.push(record)
    }
    centroid.divideScalar(3).normalize()
    for (const a of records) {
      a.corners.push(centroid)
      for (const b of records) if (a !== b) a.neighbors.add(b.id)
    }
  }
  icosa.dispose()

  const tileGeos = []
  const tiles = []
  let vertOffset = 0
  for (const record of verts) {
    const n = record.n
    const helper = Math.abs(n.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
    const u = new THREE.Vector3().crossVectors(helper, n).normalize()
    const w = new THREE.Vector3().crossVectors(n, u)
    const pts = record.corners
      .map(c => new THREE.Vector2(c.dot(u), c.dot(w)))
      .sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x))
      .map(p => p.multiplyScalar(TILE_GAP))

    const geo = new THREE.ExtrudeGeometry(roundedShape(THREE, pts, 0.003), {
      depth: TILE_DEPTH,
      bevelEnabled: true,
      bevelThickness: TILE_BEVEL,
      bevelSize: 0.005,
      bevelSegments: 2,
      curveSegments: 1
    })

    /* tile-local coordinates drive per-pixel edge occlusion in the shader */
    const posAttr = geo.getAttribute('position')
    const maxR = Math.max(...pts.map(p => p.length()))
    const totalH = TILE_DEPTH + 2 * TILE_BEVEL
    const local = new Float32Array(posAttr.count * 3)
    for (let i = 0; i < posAttr.count; i++) {
      local[i * 3] = posAttr.getX(i) / maxR
      local[i * 3 + 1] = posAttr.getY(i) / maxR
      local[i * 3 + 2] = Math.min(Math.max((posAttr.getZ(i) + TILE_BEVEL) / totalH, 0), 1)
    }
    geo.setAttribute('aTileLocal', new THREE.BufferAttribute(local, 3))

    const matrix = new THREE.Matrix4().makeBasis(u, w, n)
    matrix.setPosition(n.clone().multiplyScalar(TILE_BASE_R))
    geo.applyMatrix4(matrix)

    const count = geo.getAttribute('position').count
    tiles.push({
      id: record.id,
      center: n.clone(),
      neighbors: [...record.neighbors],
      start: vertOffset,
      count
    })
    vertOffset += count
    tileGeos.push(geo)
  }

  const geometry = BufferGeometryUtils.mergeGeometries(tileGeos)
  tileGeos.forEach(g => g.dispose())

  /* Glass cover geometry: frosted shell plus dashed equator / solid meridian. */
  const shellGeometry = new THREE.SphereGeometry(SHELL_R, 72, 48)
  const DASHES = 60
  const arcs = []
  for (let i = 0; i < DASHES; i++) {
    const arc = new THREE.TorusGeometry(SHELL_R + 0.002, 0.016, 8, 8, (Math.PI * 2 / DASHES) * 0.52)
    arc.rotateZ((Math.PI * 2 / DASHES) * i)
    arcs.push(arc)
  }
  const equatorGeometry = BufferGeometryUtils.mergeGeometries(arcs)
  arcs.forEach(a => a.dispose())
  equatorGeometry.rotateX(Math.PI / 2)
  const meridianGeometry = new THREE.TorusGeometry(SHELL_R + 0.002, 0.016, 8, 128)
  meridianGeometry.rotateY(Math.PI / 2)

  return {
    geometry,
    tiles,
    shellGeometry,
    equatorGeometry,
    meridianGeometry,
    dispose() {
      geometry.dispose()
      shellGeometry.dispose()
      equatorGeometry.dispose()
      meridianGeometry.dispose()
    }
  }
}

/* Brushed-metal reflection map for the gloss coat: soft diagonal streaks. */
export function createBrushedEnv(THREE, pmrem) {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  const bg = ctx.createLinearGradient(0, 0, 0, 512)
  bg.addColorStop(0, '#9298a1')
  bg.addColorStop(0.45, '#5c636d')
  bg.addColorStop(1, '#363c45')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 1024, 512)
  ctx.lineCap = 'round'
  for (let i = 0; i < 320; i++) {
    const x = Math.random() * 1024
    const y = Math.random() * 512
    const len = 30 + Math.random() * 140
    const angle = ((-55 + (Math.random() - 0.5) * 14) * Math.PI) / 180
    const bright = Math.random() < 0.8
    ctx.strokeStyle = bright
      ? `rgba(255, 255, 255, ${0.02 + Math.random() * 0.09})`
      : `rgba(10, 14, 20, ${0.03 + Math.random() * 0.05})`
    ctx.lineWidth = 0.6 + Math.random() * 1.6
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len)
    ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.colorSpace = THREE.SRGBColorSpace
  const target = pmrem.fromEquirectangular(texture)
  texture.dispose()
  return {
    texture: target.texture,
    dispose() {
      target.dispose()
    }
  }
}

export function createErrorCorrectionBall({
  THREE,
  SubsurfaceScatteringShader,
  template,
  brushedEnv,
  viewDir,
  lightScale = 1,
  onPhase,
  palette,
  timing
}) {
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear()
  const colorSet = (custom, fallback) => {
    const hasCustomColors = Array.isArray(custom) && custom.length > 0
    const colors = hasCustomColors ? custom : fallback
    /* THREE.Color already converts CSS hex strings from sRGB into its linear
       working space. Preserve that single conversion for authored palettes;
       the legacy fallback keeps its historical darker treatment. */
    return colors.map(hex => hasCustomColors ? new THREE.Color(hex) : lin(hex))
  }
  const BLUES = colorSet(
    palette?.healthy,
    ['#3b6fd6', '#2d5ec4', '#2452ab', '#4a7ede', '#3465c8', '#1e4699']
  )
  const REDS = colorSet(palette?.error, ['#e01f1f', '#d41818', '#ef2c2c', '#c31414'])
  const TEALS = colorSet(
    palette?.fixed,
    ['#1f9478', '#188a6e', '#26a184', '#157f64', '#2aa98c']
  )

  const pick = list => list[Math.floor(Math.random() * list.length)]
  const jittered = base => {
    const color = base.clone()
    if (palette?.jitter === false) return color
    color.offsetHSL((Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.05)
    return color
  }

  const geometry = template.geometry.clone()
  const vertexCount = geometry.getAttribute('position').count
  const colorAttr = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3)
  colorAttr.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('color', colorAttr)
  const glowAttr = new THREE.BufferAttribute(new Float32Array(vertexCount), 1)
  glowAttr.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('aGlow', glowAttr)
  const errorAttr = new THREE.BufferAttribute(new Float32Array(vertexCount), 1)
  errorAttr.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('aError', errorAttr)

  const tiles = template.tiles.map(tile => ({
    ...tile,
    center: tile.center.clone(),
    state: 'healthy',
    glow: 0,
    current: jittered(pick(BLUES)),
    target: null,
    nextDrift: Math.random() * 4,
    waved: false
  }))
  for (const tile of tiles) tile.target = tile.current.clone()

  const whiteTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
  whiteTex.needsUpdate = true

  const tileUniforms = THREE.UniformsUtils.clone(SubsurfaceScatteringShader.uniforms)
  tileUniforms.thicknessMap.value = whiteTex
  tileUniforms.thicknessColor.value = palette?.tileGlowColor
    ? new THREE.Color(palette.tileGlowColor)
    : lin(CONFIG.tileGlowColor)
  tileUniforms.thicknessDistortion.value = CONFIG.tileDistortion
  tileUniforms.thicknessAmbient.value = CONFIG.tileAmbient
  tileUniforms.thicknessAttenuation.value = CONFIG.tileAttenuation
  tileUniforms.thicknessPower.value = CONFIG.tilePower
  tileUniforms.thicknessScale.value = CONFIG.tileScale
  tileUniforms.shininess.value = CONFIG.tileShininess
  tileUniforms.specular.value = lin(CONFIG.tileSpecular)
  tileUniforms.uEdgeShade = { value: CONFIG.edgeShade }

  const tileVert = SubsurfaceScatteringShader.vertexShader
    .replace('#include <common>', 'attribute vec3 aTileLocal;\nattribute float aGlow;\nattribute float aError;\nvarying vec3 vTileLocal;\nvarying float vGlow;\nvarying float vError;\n#include <common>')
    .replace('#include <begin_vertex>', 'vTileLocal = aTileLocal;\nvGlow = aGlow;\nvError = aError;\n#include <begin_vertex>')

  const scatteringStrength = palette?.isolateErrorHue
    ? '(1.0 - vError)'
    : '(1.0 - vGlow * 0.9)'
  const isolateErrorHue = palette?.isolateErrorHue
    ? `
  if (vError > 0.5) {
    float errorPeak = max(max(outgoingLight.r, outgoingLight.g), outgoingLight.b);
    float authoredPeak = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
    outgoingLight = diffuseColor.rgb * (errorPeak / max(authoredPeak, 0.0001));
  }`
    : ''

  const tileFrag = SubsurfaceScatteringShader.fragmentShader
    // Error-isolated hosts remove the blue scattering contribution completely
    // and restore the authored error hue after lighting. This keeps cool scene
    // lights from turning red error tiles violet while retaining their shading.
    .replace(
      'vec3 thickness = thicknessColor * texture2D(thicknessMap, uv).r;',
      `vec3 thickness = thicknessColor * ${scatteringStrength} * texture2D(thicknessMap, uv).r;`
    )
    .replace('#include <common>', 'varying vec3 vTileLocal;\nvarying float vGlow;\nvarying float vError;\nuniform float uEdgeShade;\n#include <common>')
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += diffuseColor.rgb * vGlow * 3.2;`)
    .replace('#include <color_fragment>', `#include <color_fragment>
  {
    float radial = length(vTileLocal.xy);
    float rimT = smoothstep(0.25, 1.05, radial);
    float wallT = 1.0 - pow(clamp(vTileLocal.z, 0.0, 1.0), 1.3);
    float shade = 1.0 - uEdgeShade * min(0.55 * rimT + 0.7 * wallT, 0.75);
    diffuseColor.rgb *= shade;
  }`)
    .replace('#include <opaque_fragment>', `${isolateErrorHue}
#include <opaque_fragment>`)

  const tileMat = new THREE.ShaderMaterial({
    uniforms: tileUniforms,
    vertexShader: tileVert,
    fragmentShader: tileFrag,
    lights: true,
    vertexColors: true
  })
  const tileMesh = new THREE.Mesh(geometry, tileMat)

  const coreMesh = new THREE.Mesh(
    new THREE.SphereGeometry(TILE_BASE_R + 0.005, 48, 32),
    new THREE.MeshStandardMaterial({ color: CONFIG.coreColor, roughness: 0.9 })
  )

  /* gloss coat: additive black-diffuse physical layer — reflections only */
  const glossMat = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    roughness: palette?.glossRoughness ?? CONFIG.glossRoughness,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: palette?.clearcoatRoughness ?? 0.12,
    envMap: palette?.cleanReflections ? null : (brushedEnv ?? null),
    envMapIntensity: CONFIG.glossReflect,
    transparent: true,
    opacity: CONFIG.glossStrength,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  })
  if (palette?.isolateErrorHue) {
    /* The gloss is a second additive mesh, so it needs the same per-tile error
       mask. Make cool reflections neutral over errors instead of adding blue
       back on top of the hue-isolated tile shader. */
    glossMat.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', 'attribute float aError;\nvarying float vGlossError;\n#include <common>')
        .replace('#include <begin_vertex>', 'vGlossError = aError;\n#include <begin_vertex>')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', 'varying float vGlossError;\n#include <common>')
        .replace('#include <opaque_fragment>', `
  if (vGlossError > 0.5) {
    float reflectionLuma = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
    outgoingLight = vec3(reflectionLuma);
  }
#include <opaque_fragment>`)
    }
    glossMat.customProgramCacheKey = () => 'error-hue-isolated-gloss-v1'
  }
  const glossMesh = new THREE.Mesh(geometry, glossMat)
  glossMesh.renderOrder = 1

  /* the inner light rides the ball's centre and never changes colour;
     intensity follows the inverse-square law when the ball is scaled */
  const innerLight = new THREE.PointLight(
    CONFIG.innerLight.color,
    CONFIG.innerLight.intensity * lightScale * lightScale,
    0,
    2
  )

  /* frosted glass shell: pure fresnel (no lighting), milky at the rim */
  const { uniforms: shellUniforms, front: shellFrontMat, back: shellBackMat } =
    createFrostShell(THREE)
  const shellBack = new THREE.Mesh(template.shellGeometry, shellBackMat)
  shellBack.renderOrder = 2
  const shellFront = new THREE.Mesh(template.shellGeometry, shellFrontMat)
  shellFront.renderOrder = 3

  /* pure white rings: unlit, un-tonemapped, drawn above the shell haze */
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true })
  const equator = new THREE.Mesh(template.equatorGeometry, ringMat)
  equator.renderOrder = 4
  const meridian = new THREE.Mesh(template.meridianGeometry, ringMat)
  meridian.renderOrder = 4

  const group = new THREE.Group()
  group.add(coreMesh, tileMesh, glossMesh, shellBack, shellFront, equator, meridian, innerLight)

  function writeTileColor(tile) {
    const colors = colorAttr.array
    const glows = glowAttr.array
    const errors = errorAttr.array
    const { r, g, b } = tile.current
    const isError = tile.state === 'error' ? 1 : 0
    for (let i = tile.start; i < tile.start + tile.count; i++) {
      colors[i * 3] = r
      colors[i * 3 + 1] = g
      colors[i * 3 + 2] = b
      glows[i] = tile.glow
      errors[i] = isError
    }
  }
  tiles.forEach(writeTileColor)
  colorAttr.needsUpdate = true
  glowAttr.needsUpdate = true
  errorAttr.needsUpdate = true

  /* ---- phase state machine ---- */
  let phase = PHASE.CALM
  let phaseT = 0
  let errorAccum = 0
  const waveDir = new THREE.Vector3(1, 0, 0)
  const errorTiles = new Set()
  const seedView = (viewDir ?? new THREE.Vector3(0, 0.1, 1)).clone().normalize()
  const worldQuat = new THREE.Quaternion()
  const scratch = new THREE.Vector3()

  function setPhase(next) {
    phase = next
    phaseT = 0
    errorAccum = 0
    if (next === PHASE.FIXING || next === PHASE.RESET) {
      waveDir.randomDirection()
      for (const tile of tiles) tile.waved = false
    }
    if (next === PHASE.ERRORS && errorTiles.size === 0) infectTile()
    onPhase?.(next)
  }

  /* The opening phase is assigned directly above rather than through setPhase,
     so announce it once here or a listener would sit on a stale first label. */
  onPhase?.(phase)

  function paletteFor(tile) {
    if (tile.state === 'error') return REDS
    if (tile.state === 'fixed') return TEALS
    return BLUES
  }

  function infectTile() {
    let tile = null
    if (errorTiles.size && Math.random() < CONFIG.errorSpread) {
      const frontier = []
      for (const id of errorTiles) {
        for (const nid of tiles[id].neighbors) {
          if (tiles[nid].state === 'healthy') frontier.push(tiles[nid])
        }
      }
      if (frontier.length) tile = pick(frontier)
    }
    if (!tile) {
      const healthy = tiles.filter(t => t.state === 'healthy')
      if (!healthy.length) return
      group.getWorldQuaternion(worldQuat)
      if (errorTiles.size === 0) {
        /* the seed always faces the viewer so the cascade is watchable */
        let best = healthy[0]
        let bestDot = -2
        for (const t of healthy) {
          const d = scratch.copy(t.center).applyQuaternion(worldQuat).dot(seedView)
          if (d > bestDot) {
            bestDot = d
            best = t
          }
        }
        tile = best
      } else {
        const facing = healthy.filter(t =>
          scratch.copy(t.center).applyQuaternion(worldQuat).dot(seedView) > 0.25)
        tile = pick(facing.length ? facing : healthy)
      }
    }
    tile.state = 'error'
    tile.target = jittered(pick(REDS))
    if (timing?.instantErrors) {
      /* The standard blue-to-red RGB lerp passes through violet. For hosts
         that need an unmistakable error signal, switch hue immediately and
         let the emissive glow carry the transition instead. */
      tile.current.copy(tile.target)
      tile.glow = 1
    }
    tile.nextDrift = time + 1.5 + Math.random() * 4
    errorTiles.add(tile.id)
  }

  let time = 0
  let prevSeconds = null

  function update(seconds) {
    /* External clocks may reset (carousel scenes re-epoch on focus); keep an
       internal monotonic clock so the story never jumps. */
    let dt = prevSeconds === null ? 0.016 : seconds - prevSeconds
    prevSeconds = seconds
    if (!(dt > 0)) dt = 0.016
    dt = Math.min(dt, 0.05)
    time += dt
    const t = time
    phaseT += dt

    if (phase === PHASE.ERRORS) {
      const ratio = errorTiles.size / tiles.length
      const maxErrorTiles = Number.isFinite(timing?.maxErrorTiles)
        ? Math.min(tiles.length, Math.max(1, Math.floor(timing.maxErrorTiles)))
        : Math.ceil(tiles.length * CONFIG.maxErrorRatio)
      if (errorTiles.size < maxErrorTiles) {
        errorAccum += dt * (timing?.errorRate ?? CONFIG.errorRate) * (0.5 + ratio * 2.2)
        while (errorAccum >= 1) {
          if (errorTiles.size >= maxErrorTiles) break
          infectTile()
          errorAccum -= 1
        }
      }
      if (phaseT > CONFIG.errorsDuration) setPhase(PHASE.FIXING)
    } else if (phase === PHASE.FIXING || phase === PHASE.RESET) {
      const progress = phaseT / CONFIG.waveDuration
      for (const tile of tiles) {
        if (tile.waved) continue
        const threshold = (tile.center.dot(waveDir) + 1) / 2
        if (progress > threshold) {
          tile.waved = true
          if (phase === PHASE.FIXING) {
            if (tile.state !== 'error') continue
            tile.state = 'fixed'
          } else {
            if (tile.state === 'healthy') continue
            tile.state = 'healthy'
          }
          errorTiles.delete(tile.id)
          tile.target = jittered(pick(paletteFor(tile)))
          tile.nextDrift = t + 2 + Math.random() * 5
        }
      }
      if (progress > 1.15) setPhase(phase === PHASE.FIXING ? PHASE.FIXED : PHASE.CALM)
    } else {
      if (phase === PHASE.CALM && phaseT > (timing?.calmDuration ?? CONFIG.calmDuration)) {
        setPhase(PHASE.ERRORS)
      }
      if (phase === PHASE.FIXED && phaseT > CONFIG.fixedDuration) setPhase(PHASE.RESET)
    }

    /* No phase tinting: every light and the SSS glow colour stay constant —
       the story is told entirely by the tiles' own colours and glow. */
    const k = 1 - Math.exp(-dt * 3.2)
    for (const tile of tiles) {
      if (t > tile.nextDrift) {
        tile.target = jittered(pick(paletteFor(tile)))
        tile.nextDrift = t + (2 + Math.random() * 5) / CONFIG.driftSpeed
      }
      tile.current.lerp(tile.target, k)
      const glowTarget = tile.state === 'error' ? 1 : tile.state === 'fixed' ? 0.45 : 0
      tile.glow += (glowTarget - tile.glow) * k
      writeTileColor(tile)
    }
    colorAttr.needsUpdate = true
    glowAttr.needsUpdate = true
    errorAttr.needsUpdate = true
  }

  return {
    group,
    tileMesh,
    coreMesh,
    glossMesh,
    update,
    dispose() {
      geometry.dispose()
      coreMesh.geometry.dispose()
      coreMesh.material.dispose()
      tileMat.dispose()
      glossMat.dispose()
      shellBackMat.dispose()
      shellFrontMat.dispose()
      ringMat.dispose()
      whiteTex.dispose()
    }
  }
}
