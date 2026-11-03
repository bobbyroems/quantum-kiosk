import { BALL_CONFIG, createFrostShell } from '../../core/error-correction-ball.js'
import {
  aimCropAtSphere,
  createCropUniforms,
  CROP_COVERAGE as CLIP_COVERAGE,
  CROP_VARYINGS as CLIP_VARYINGS,
  CROP_VERTEX as CLIP_VERTEX
} from '../../core/sphere-crop.js'

/*
 * Module 04's own wafer, to the millimetre: qubit-scene.js builds its layers from
 * a 5.45 x 0.42 x 1.18 shell around a 5.18 x 0.22 x 0.9 core, and the card now
 * shows that solid rather than an abstraction of it. Held as ratios of the shell
 * length so the preview can be scaled to the circle without drifting off-model;
 * the menu treatment uses a quarter of the source shell's corner radius for a
 * crisper bevel.
 */
const WAFER = Object.freeze({
  length: 1,
  height: 0.42 / 5.45,
  depth: 1.18 / 5.45,
  radius: (0.09 / 4) / 5.45,
  /* The palette stays the approved optical indigo rather than the interaction's
     own blue-and-red layers: those read as painted parts at card scale, which is
     what the abstraction replaced. Only the solid's proportions come across. */
  upper: '#17439a',
  upperGlow: '#7fb0ff',
  lower: '#392579',
  lowerGlow: '#a98cff'
})

/* The containing circle, as a fraction of the composition radius the pool hands
   over — a quarter smaller than the card's nominal shape so the circle reads as a
   held object rather than as the whole frame. */
const CIRCLE_SCALE = 0.75

/* Slab length as a fraction of that circle's diameter. Above 1 the wafer runs out
   past the rim, which is the intent: the camera sits close to the rectangles'
   edge, so the stack is cropped by the circle rather than sitting inside it. */
const WAFER_FILL = 1.08

/*
 * Where the two wafers sit before and after they couple, in composition radii.
 * Held here because the electron beds have to travel with the slabs they live in:
 * the same figures are read by JS for the meshes and compiled into the particle
 * shader below, and as two sets of literals in two languages they could only drift
 * apart. `apartY` is the visible gap — one wafer thickness at this framing, rather
 * than the three the concept pass opened with.
 */
const WAFER_OFFSETS = Object.freeze({
  apartX: 0.03,
  apartY: 0.125,
  apartZ: 0.012,
  togetherY: 0.057
})

/* GLSL has no implicit int-to-float promotion, so every one of these has to reach
   the shader with a decimal point on it. */
const glsl = value => value.toFixed(4)

export const TOPOCONDUCTOR_NAV_CYCLE_SECONDS = 9.6

export const TOPOCONDUCTOR_NAV_PARTICLE_COUNTS = Object.freeze({
  superconductor: 120,
  semiconductor: 144,
  total: 264
})

const TAU = Math.PI * 2

const clamp01 = value => Math.min(1, Math.max(0, value))
const smooth01 = value => {
  const t = clamp01(value)
  return t * t * (3 - (2 * t))
}
const smoothRange = (value, start, end) => smooth01((value - start) / (end - start))

/**
 * The original interaction still owns the story, but the menu presents it as
 * one optical object: two material wafers approach, couple, radiate, then release.
 */
export function topoconductorNavCycleState(seconds, { reducedMotion = false } = {}) {
  if (reducedMotion) {
    return {
      cycleSeconds: 0,
      phase: 'topoconductor',
      alignment: 1,
      reaction: 1,
      separation: 0,
      fusion: 1,
      energy: 0.92,
      particleFocus: 1
    }
  }

  const safeSeconds = Number.isFinite(seconds) ? seconds : 0
  const cycleSeconds = (
    (safeSeconds % TOPOCONDUCTOR_NAV_CYCLE_SECONDS) + TOPOCONDUCTOR_NAV_CYCLE_SECONDS
  ) % TOPOCONDUCTOR_NAV_CYCLE_SECONDS
  const release = smoothRange(cycleSeconds, 6.95, 8.9)
  const alignment = clamp01(smoothRange(cycleSeconds, 0.7, 2.25) * (1 - release))
  const reaction = clamp01(smoothRange(cycleSeconds, 2.05, 2.85) * (1 - release))
  const tuneIn = smoothRange(cycleSeconds, 2.9, 4.85)
  const tuneOut = smoothRange(cycleSeconds, 6.15, 7.1)
  const fusion = clamp01(tuneIn * (1 - tuneOut))
  const loopAngle = (cycleSeconds / TOPOCONDUCTOR_NAV_CYCLE_SECONDS) * TAU
  const pulse = 0.88 + (Math.sin(loopAngle * 4) * 0.12)

  let phase = 'separated'
  if (cycleSeconds >= 0.7 && cycleSeconds < 2.85) phase = 'assembling'
  else if (cycleSeconds >= 2.85 && cycleSeconds < 4.85) phase = 'tuning'
  else if (cycleSeconds >= 4.85 && cycleSeconds < 6.15) phase = 'topoconductor'
  else if (cycleSeconds >= 6.15 && cycleSeconds < 8.9) phase = 'releasing'

  return {
    cycleSeconds,
    phase,
    alignment,
    reaction,
    separation: 1 - alignment,
    fusion,
    energy: clamp01(reaction * (0.06 + (fusion * 0.94)) * pulse),
    particleFocus: clamp01(0.24 + (alignment * 0.16) + (fusion * 0.6))
  }
}

function seededRandom(seed) {
  let value = seed >>> 0
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0
    return value / 4294967296
  }
}

function remember(resources, ...items) {
  for (const item of items) {
    if (item?.isBufferGeometry) resources.geometries.add(item)
    else if (item?.isMaterial) resources.materials.add(item)
  }
}

/*
 * The nanoscale sphere's shading, applied to a slab. Its tiles are lit by a Phong
 * subsurface-scattering pass rather than a physical material, which is what gives
 * them depth instead of a plastic highlight — same tuned constants here, so the
 * two cards read as one family under the shared accent rig.
 */
/*
 * Emissive for a wafer: its own colour, lifted by how strongly the two layers are
 * coupling. Writes into the existing Color rather than making one, so the per-frame
 * update allocates nothing, and reads the pre-linearised base to avoid converting
 * colour spaces sixty times a second.
 */
function setWaferGlow(material, energy) {
  const base = material.userData?.baseLinear
  if (!base) return
  const lift = 0.14 + (energy * 0.46)
  const emissive = material.uniforms ? material.uniforms.emissive?.value : material.emissive
  emissive?.copy(base).multiplyScalar(lift)
}

function createWaferMaterial(THREE, SubsurfaceScatteringShader, { color, glow }, resources, crop) {
  if (!SubsurfaceScatteringShader) {
    /* The addon is loaded alongside the ball; if it ever isn't, a physical
       material keeps the card looking deliberate rather than untextured. */
    const fallback = new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.26,
      metalness: 0.08,
      clearcoat: 1,
      clearcoatRoughness: 0.14
    })
    fallback.userData.baseLinear = new THREE.Color(color).convertSRGBToLinear()
    remember(resources, fallback)
    return fallback
  }

  const uniforms = THREE.UniformsUtils.clone(SubsurfaceScatteringShader.uniforms)
  const thickness = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
  thickness.needsUpdate = true
  uniforms.thicknessMap.value = thickness
  uniforms.diffuse.value = new THREE.Color(color).convertSRGBToLinear()
  uniforms.thicknessColor.value = new THREE.Color(glow).convertSRGBToLinear()
  uniforms.thicknessDistortion.value = BALL_CONFIG.tileDistortion
  uniforms.thicknessAmbient.value = BALL_CONFIG.tileAmbient
  uniforms.thicknessAttenuation.value = BALL_CONFIG.tileAttenuation
  uniforms.thicknessPower.value = BALL_CONFIG.tilePower
  uniforms.thicknessScale.value = BALL_CONFIG.tileScale
  uniforms.shininess.value = BALL_CONFIG.tileShininess
  uniforms.specular.value = new THREE.Color(BALL_CONFIG.tileSpecular).convertSRGBToLinear()

  /*
   * The circle crops the wafer rather than merely overlapping it: the slab is
   * deliberately longer than the containing sphere, so anything outside that
   * sphere is discarded. A clipping plane cannot do this — the boundary is
   * curved — so the test is a radius check in the assembly's own space, which
   * keeps the silhouette circular from every angle the card can be dragged to.
   */
  uniforms.uClipRadius = crop.uClipRadius
  /* The sphere's centre, expressed in this wafer's own space — the wafers are
     offset from it as they converge, so the test cannot just measure from the
     mesh origin. Refreshed per frame from the inverse of the wafer's matrix. */
  uniforms.uClipCenter = crop.uClipCenter
  /* What a cropped surface fades into at the boundary: the shell's own tint, so the
     cut reads as the glass taking over rather than as an edge. */
  uniforms.uClipEdgeColor = { value: new THREE.Color('#c6d4e8').convertSRGBToLinear() }
  const vertexShader = SubsurfaceScatteringShader.vertexShader
    .replace(
      '#include <common>',
      `uniform float uClipRadius;\nuniform vec3 uClipCenter;\n${CLIP_VARYINGS}\n#include <common>`
    )
    .replace('#include <begin_vertex>', `${CLIP_VERTEX}\n#include <begin_vertex>`)
  const fragmentShader = SubsurfaceScatteringShader.fragmentShader
    .replace(
      '#include <common>',
      `uniform vec3 uClipEdgeColor;\n${CLIP_VARYINGS}\n${CLIP_COVERAGE}\n#include <common>`
    )
    .replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
  float clipMix = clipCoverage();
  if (clipMix <= 0.001) discard;`
    )
    /* Composed colour blends into the shell over the feather band. Placed after
       opaque_fragment so it catches the finished shading, and before tone mapping
       so the blend happens in the same space the shell is written in. */
    .replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
  gl_FragColor.rgb = mix(uClipEdgeColor, gl_FragColor.rgb, clipMix);`
    )

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    lights: true
  })
  /* Cloned uniforms own this texture, so disposing the material must take it. */
  material.userData.ownedTexture = thickness
  material.userData.baseLinear = new THREE.Color(color).convertSRGBToLinear()
  remember(resources, material)
  return material
}

/*
 * `radius` still drives the layer separation, because that is what applyState
 * animates; `waferLength` sizes the bed itself, so the electrons keep filling the
 * slab when the framing zooms rather than bunching in its middle.
 */
function createElectronField(THREE, radius, waferLength, resources, crop) {
  const random = seededRandom(40419)
  const count = TOPOCONDUCTOR_NAV_PARTICLE_COUNTS.total
  const positions = new Float32Array(count * 3)
  const metadata = new Float32Array(count * 4)

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3
    const metaOffset = index * 4
    const isUpper = index < TOPOCONDUCTOR_NAV_PARTICLE_COUNTS.superconductor
    /* Match the long electron beds in the full Module 04 layers instead of
       distributing the particles through the former ellipsoidal lenses. */
    positions[offset] = (random() - 0.5) * waferLength * 0.88
    positions[offset + 1] = (random() - 0.5) * waferLength * 0.032
    positions[offset + 2] = (random() - 0.5) * waferLength * 0.17
    metadata[metaOffset] = random() * TAU
    metadata[metaOffset + 1] = 1 + Math.floor(random() * 3)
    metadata[metaOffset + 2] = isUpper ? 1 : -1
    /* Keep the original deterministic field for continuity, while only a
       sparse constellation is optically present at card scale. */
    metadata[metaOffset + 3] = random() < 0.45 ? 0.78 + (random() * 0.22) : 0
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aWaferMeta', new THREE.BufferAttribute(metadata, 4))
  geometry.computeBoundingSphere()
  if (geometry.boundingSphere) geometry.boundingSphere.radius = radius * 1.1

  const material = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      uLoopAngle: { value: 0 },
      uConvergence: { value: 0 },
      uFusion: { value: 0 },
      uRadius: { value: radius },
      uPointSize: { value: radius * 11.5 },
      /* Electrons run the length of the slab, so the circle has to crop them too
         or gold dots float outside it. These points sit at the assembly origin,
         which is the sphere's centre, so a plain radius test is enough. */
      uClipRadius: crop.uClipRadius,
      /* Where the sphere's centre sits in this stack's space. Not the origin once
         the stack is offset inside the circle, which is exactly when particles
         would otherwise stream out past the rim. */
      uClipCenter: crop.uClipCenter
    },
    vertexShader: `
      attribute vec4 aWaferMeta;
      uniform float uLoopAngle;
      uniform float uConvergence;
      uniform float uFusion;
      uniform float uRadius;
      uniform float uPointSize;
      uniform float uClipRadius;
      uniform vec3 uClipCenter;
      varying float vPresence;
      ${CLIP_VARYINGS}
      ${CLIP_COVERAGE}

      void main() {
        float side = aWaferMeta.z;
        float phase = aWaferMeta.x;
        float harmonic = aWaferMeta.y;
        vec3 local = position;
        local.x += sin((uLoopAngle * harmonic) + phase) * uRadius * 0.014 * (1.0 - uFusion * 0.65);
        local.y += cos((uLoopAngle * (harmonic + 1.0)) + phase) * uRadius * 0.009 * (1.0 - uFusion * 0.72);
        local.y *= mix(1.0, 0.62, uFusion);
        local.z *= mix(1.0, 0.76, uFusion);

        float centreY = side * mix(
          uRadius * ${glsl(WAFER_OFFSETS.apartY)},
          uRadius * ${glsl(WAFER_OFFSETS.togetherY)},
          uConvergence
        );
        float centreX = side * mix(-uRadius * ${glsl(WAFER_OFFSETS.apartX)}, 0.0, uConvergence);
        float centreZ = side * mix(-uRadius * ${glsl(WAFER_OFFSETS.apartZ)}, 0.0, uConvergence);
        vec3 transformed = local + vec3(centreX, centreY, centreZ);
        vec4 viewPosition = modelViewMatrix * vec4(transformed, 1.0);
        float perspective = 10.0 / max(1.0, -viewPosition.z);
        gl_PointSize = uPointSize * perspective * aWaferMeta.w * mix(0.9, 1.12, uFusion);
        gl_Position = projectionMatrix * viewPosition;
        /*
         * Cropped against the circle on screen, per point. Sprites are squares
         * centred on the vertex, so coverage is pulled in by roughly the sprite's
         * own half-width — otherwise a point whose centre is just inside leaves
         * half a square hanging over the rim.
         */
        vClipViewCenter = (viewMatrix * vec4(uClipCenter, 1.0)).xyz;
        vClipViewPos = (viewMatrix * modelMatrix * vec4(transformed, 1.0)).xyz;
        vClipViewRadius = uClipRadius * 0.94;
        vPresence = aWaferMeta.w * clipCoverage();
      }
    `,
    fragmentShader: `
      varying float vPresence;
      void main() {
        float distanceToCentre = length((gl_PointCoord - 0.5) * 2.0);
        if (distanceToCentre >= 1.0 || vPresence <= 0.0) discard;
        float halo = 1.0 - smoothstep(0.08, 1.0, distanceToCentre);
        float core = 1.0 - smoothstep(0.0, 0.17, distanceToCentre);
        vec3 warmWhite = mix(vec3(1.0, 0.72, 0.27), vec3(1.0, 0.985, 0.88), core);
        gl_FragColor = vec4(warmWhite, ((halo * 0.58) + (core * 1.12)) * vPresence);
      }
    `
  })
  const points = new THREE.Points(geometry, material)
  points.name = 'TopoconductorNavElectrons'
  points.frustumCulled = false
  points.renderOrder = 6
  points.userData.noShadow = true
  points.userData.noImperfection = true
  remember(resources, geometry, material)
  return { points, material }
}

function createEnergyField(THREE, RoundedBoxGeometry, radius, resources, crop) {
  const geometry = new RoundedBoxGeometry(2, 2, 2, 6, 0.22)
  const material = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: {
      uStrength: { value: 0 },
      uLoopAngle: { value: 0 },
      uCyan: { value: new THREE.Color('#59e3ff').convertSRGBToLinear() },
      uViolet: { value: new THREE.Color('#9b72ff').convertSRGBToLinear() },
      /* This field is a stretched cube, so its own scale is needed to measure a
         distance from the sphere's centre — the crop has to reach it too, or the
         coupling glow spills past the rim the wafers are cut at. */
      uClipRadius: crop.uClipRadius,
      /* As with the electrons: the sphere's centre in stack space, which moves the
         moment the stack is offset inside the circle. */
      uClipCenter: crop.uClipCenter
    },
    vertexShader: `
      varying vec3 vLocalPosition;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      uniform float uClipRadius;
      uniform vec3 uClipCenter;
      ${CLIP_VARYINGS}
      void main() {
        vLocalPosition = position;
        vClipViewCenter = (viewMatrix * vec4(uClipCenter, 1.0)).xyz;
        vClipViewPos = (viewMatrix * modelMatrix * vec4(position, 1.0)).xyz;
        vClipViewRadius = uClipRadius;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vLocalPosition;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      uniform float uStrength;
      uniform float uLoopAngle;
      uniform vec3 uCyan;
      uniform vec3 uViolet;
      ${CLIP_VARYINGS}
      ${CLIP_COVERAGE}
      void main() {
        float clip = clipCoverage();
        if (clip <= 0.001) discard;
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - abs(dot(normalize(vWorldNormal), viewDirection)), 2.3);
        float contact = exp(-pow(abs(vLocalPosition.y) * 4.2, 2.0));
        float sweep = 0.9 + sin((vLocalPosition.x * 4.5) - (uLoopAngle * 2.0)) * 0.1;
        vec3 color = mix(uViolet, uCyan, smoothstep(-0.8, 0.8, vLocalPosition.x + vLocalPosition.z * 0.45));
        /* Held well down: cropped to the circle this glow sits right on top of the
           wafers, and at full coupling the old weight washed them out to a pale
           blob instead of reading as light coming off a solid. */
        float alpha = uStrength * sweep * (0.012 + fresnel * 0.085 + contact * 0.06);
        gl_FragColor = vec4(color, alpha * clip);
      }
    `
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'TopoconductorNavEnergyField'
  mesh.scale.set(radius * 0.78, radius * 0.16, radius * 0.28)
  mesh.renderOrder = 5
  mesh.userData.noShadow = true
  mesh.userData.noImperfection = true
  remember(resources, geometry, material)
  return { mesh, material }
}

/**
 * A premium optical abstraction of the real Module 04 material stack. The
 * pool owns camera movement and pointer rotation; this preview owns the quiet
 * wafer coupling loop inside one static frosted macro silhouette.
 */
export function createQubitNavPreview({
  THREE,
  RoundedBoxGeometry,
  radius,
  brushedEnv = null,
  SubsurfaceScatteringShader = null
}) {
  const root = new THREE.Group()
  root.name = 'TopoconductorNavPreview'
  root.userData.useOpticalRig = true

  const assembly = new THREE.Group()
  assembly.name = 'TopoconductorWaferAssembly'
  /* Looking down the slab rather than along its edge, so the top face and the
     electron bed read as a solid — the near-side-on pose made the zoomed wafer
     collapse into a bar. */
  assembly.rotation.set(0.42, 0.62, -0.05)
  root.add(assembly)

  const resources = { geometries: new Set(), materials: new Set() }
  /* One pair of world-space uniforms for every cropped surface in this preview. */
  const cropUniforms = createCropUniforms(THREE)
  /* The source interaction uses 5.45 × 0.42 × 1.18 layers. At menu scale we
     retain that very thin, long-wafer character and only soften the corners
     enough to keep the shared optical treatment clean under rotation. */
  /* Keep the approved calm optical envelope from the concept pass. Only the
     two interacting bodies become source-faithful wafers; turning the outer
     shell into a third rectangular part makes the preview read like a toy
     chassis rather than a field surrounding the material stack. */
  const envelopeGeometry = new THREE.SphereGeometry(1, 64, 40)
  /* One wafer length drives every other dimension, so the solid stays on-model
     however far it is zoomed into the circle. */
  const circleRadius = radius * CIRCLE_SCALE
  const waferLength = circleRadius * 2 * WAFER_FILL
  const coreGeometry = new RoundedBoxGeometry(
    waferLength * WAFER.length,
    waferLength * WAFER.height,
    waferLength * WAFER.depth,
    6,
    waferLength * WAFER.radius
  )
  remember(resources, envelopeGeometry, coreGeometry)

  const wafer = (color, glow) =>
    createWaferMaterial(THREE, SubsurfaceScatteringShader, { color, glow }, resources, cropUniforms)
  const upperMaterial = wafer(WAFER.upper, WAFER.upperGlow)
  const lowerMaterial = wafer(WAFER.lower, WAFER.lowerGlow)

  /* The slab lives in its own group so it can be moved and scaled inside the
     circle without dragging the circle along with it. */
  const stack = new THREE.Group()
  stack.name = 'TopoconductorStack'
  assembly.add(stack)

  const upperCore = new THREE.Mesh(coreGeometry, upperMaterial)
  upperCore.name = 'TopoconductorUpperWafer'
  upperCore.renderOrder = 4
  const lowerCore = new THREE.Mesh(coreGeometry, lowerMaterial)
  lowerCore.name = 'TopoconductorLowerWafer'
  lowerCore.renderOrder = 4
  /*
   * The card reads as one object — a sphere — so the sphere is what casts on the
   * floor. Letting the wafers cast put a hard angular shadow under a round shape,
   * and worse, they are cropped, so the shadow described a solid the visitor
   * cannot see. The fill shell takes the shadow instead; see below.
   */
  upperCore.userData.noShadow = true
  lowerCore.userData.noShadow = true
  stack.add(upperCore, lowerCore)

  /*
   * The shell is an envelope drawn around the contents, not a solid sharing space
   * with them. It writes no depth, but it was still depth-tested, so the near
   * hemisphere's haze was being clipped wherever that surface passed behind a
   * wafer — a hard curve across the stack where the two geometries intersected.
   * Taking the depth test off composites the shell uniformly: same shading, same
   * rim, same shadow, no seam. Nothing is ever in front of it to be wrongly
   * overdrawn, and every surface of it draws before the contents (renderOrder
   * above), so none of it paints over them.
   */
  /* No convertSRGBToLinear on these tints, unlike everywhere else: this shader
     writes gl_FragColor without a colourspace chunk, so whatever goes in is written
     straight out. A linearised tint reads as dark navy instead of soft blue —
     invisible on the ball only because its shell is white. */
  const SHELL_TINT = '#c6d4e8'

  /*
   * The envelope does two jobs, and they want opposite sides of the contents. The
   * soft blue field belongs *behind* the stack — painted over it, it washed the
   * wafers flat. The rim belongs in front, tracing the edge of the containment.
   * They were one surface, so the depth test was the only thing separating them,
   * and that is what drew a hard curve across the stack wherever the sphere's
   * surface passed through a wafer. Two shells, ordered either side, with no depth
   * test on either: fill behind, rim in front, nothing intersecting anything.
   */
  const backdrop = createFrostShell(THREE)
  backdrop.front.depthTest = false
  backdrop.uniforms.uColor.value = new THREE.Color(SHELL_TINT)
  backdrop.uniforms.uBaseAlpha.value = 0.34
  backdrop.uniforms.uRimAlpha.value = 0.12
  backdrop.uniforms.uFresnelPow.value = 2.6
  backdrop.uniforms.uRimStart.value = 0
  backdrop.uniforms.uBackAlpha.value = 0
  const shellFill = new THREE.Mesh(envelopeGeometry, backdrop.front)
  shellFill.name = 'TopoconductorEnvelopeFill'
  shellFill.scale.setScalar(circleRadius)
  /* Before the contents, so the wafers land on the field rather than under it. */
  shellFill.renderOrder = 0
  /* This full sphere is the silhouette the card presents, so it owns the contact
     shadow now that the reflective coat which used to carry it is gone. The shadow
     pass works off geometry, so a transparent shell still casts a solid circle. */
  shellFill.castShadow = true
  shellFill.userData.noImperfection = true
  backdrop.front.userData.noImperfection = true
  assembly.add(shellFill)
  remember(resources, backdrop.front, backdrop.back)

  const frost = createFrostShell(THREE)
  frost.front.depthTest = false
  frost.back.depthTest = false
  frost.uniforms.uColor.value = new THREE.Color(SHELL_TINT)
  /* Rim only — the fill is the shell above. */
  frost.uniforms.uBaseAlpha.value = 0
  frost.uniforms.uRimAlpha.value = 0.3
  frost.uniforms.uFresnelPow.value = 2.6
  frost.uniforms.uRimStart.value = 0
  frost.uniforms.uBackAlpha.value = 0.12
  const shellBack = new THREE.Mesh(envelopeGeometry, frost.back)
  shellBack.name = 'TopoconductorEnvelopeFrostBack'
  shellBack.scale.setScalar(circleRadius)
  shellBack.renderOrder = 1
  shellBack.userData.noShadow = true
  shellBack.userData.noImperfection = true
  const shellFront = new THREE.Mesh(envelopeGeometry, frost.front)
  shellFront.name = 'TopoconductorEnvelopeFrostFront'
  shellFront.scale.setScalar(circleRadius)
  /* Behind the contents like the rest of the envelope: drawn in front, the rim
     traced a bright outline across any wafer that reached the circle's edge. The
     circumference still reads wherever nothing covers it, and where a wafer is
     cropped its own blended edge becomes the boundary. */
  shellFront.renderOrder = 2
  shellFront.userData.noShadow = true
  shellFront.userData.noImperfection = true
  frost.front.userData.noImperfection = true
  frost.back.userData.noImperfection = true
  assembly.add(shellBack, shellFront)
  remember(resources, frost.front, frost.back)

  const electrons = createElectronField(THREE, radius, waferLength, resources, cropUniforms)
  const energy = createEnergyField(THREE, RoundedBoxGeometry, radius, resources, cropUniforms)
  stack.add(energy.mesh, electrons.points)

  const cyanLight = new THREE.PointLight('#65e5ff', 0, radius * 3, 2)
  cyanLight.position.set(radius * 0.3, radius * 0.14, radius * 0.26)
  const violetLight = new THREE.PointLight('#9c78ff', 0, radius * 3, 2)
  violetLight.position.set(-radius * 0.3, -radius * 0.14, radius * 0.22)
  assembly.add(cyanLight, violetLight)

  /*
   * Live-tunable framing, driven from the dev Materials panel. Everything here is
   * applied to transforms rather than geometry, so dragging a slider never rebuilds
   * a buffer. `circleScale` is a fraction of the composition radius the pool hands
   * over; `waferScale` multiplies the slab inside that circle, and `cropInset` keeps
   * the cut a hair inside the shell so it lands under the frosted rim.
   */
  const tuning = {
    /* Dialled in on the running kiosk rather than derived — these are the values
       the framing panel was left at, kept as the defaults. */
    circleScale: 0.75,
    waferScale: 2.02,
    tiltX: -0.31,
    tiltY: 0.57,
    tiltZ: -0.05,
    offsetX: -1.8,
    offsetY: 0,
    cropInset: 0.93
  }

  /* Aimed at the fill shell each frame. This replaced a per-mesh centre derived by
     inverting each wafer's matrix — correct, but only valid for meshes whose object
     space we control, and needlessly per-material. */
  const cropScratch = new THREE.Vector3()

  function applyTuning() {
    const shellRadius = radius * tuning.circleScale
    for (const shell of [shellFill, shellBack, shellFront]) {
      shell.scale.setScalar(shellRadius)
    }
    stack.scale.setScalar(tuning.waferScale)
    /* Offsets are in circle radii, not composition radii: 1.0 puts the stack's
       centre exactly on the rim, so the numbers mean something while sliding. */
    stack.position.set(shellRadius * tuning.offsetX, shellRadius * tuning.offsetY, 0)
    assembly.rotation.set(tuning.tiltX, tuning.tiltY, tuning.tiltZ)
    stack.updateMatrix()
  }

  function applyCrop() {
    aimCropAtSphere(cropUniforms, shellFill, {
      inset: tuning.cropInset,
      scratch: cropScratch
    })
  }

  const applyState = (seconds, reducedMotion = false) => {
    const state = topoconductorNavCycleState(seconds, { reducedMotion })
    const cycleProgress = reducedMotion
      ? 0
      : state.cycleSeconds / TOPOCONDUCTOR_NAV_CYCLE_SECONDS
    const loopAngle = cycleProgress * TAU
    const convergence = clamp01((state.alignment * 0.28) + (state.reaction * 0.72))

    upperCore.position.set(
      THREE.MathUtils.lerp(-radius * WAFER_OFFSETS.apartX, 0, convergence),
      THREE.MathUtils.lerp(radius * WAFER_OFFSETS.apartY, radius * WAFER_OFFSETS.togetherY, convergence),
      THREE.MathUtils.lerp(-radius * WAFER_OFFSETS.apartZ, 0, convergence)
    )
    lowerCore.position.set(
      THREE.MathUtils.lerp(radius * WAFER_OFFSETS.apartX, 0, convergence),
      THREE.MathUtils.lerp(-radius * WAFER_OFFSETS.apartY, -radius * WAFER_OFFSETS.togetherY, convergence),
      THREE.MathUtils.lerp(radius * WAFER_OFFSETS.apartZ, 0, convergence)
    )
    upperCore.rotation.z = THREE.MathUtils.lerp(-0.035, 0, convergence)
    lowerCore.rotation.z = THREE.MathUtils.lerp(0.035, 0, convergence)

    /* The coupling glow rides the scattering material's own emissive term, which
       is a uniform rather than a property now that the wafers are shader-lit. */
    setWaferGlow(upperMaterial, state.energy)
    setWaferGlow(lowerMaterial, state.energy)
    /* The sphere holds still while the contents move, but the stage yaw and the
       pool's scaling move it in world space, so re-aim every frame. */
    applyCrop()

    electrons.material.uniforms.uLoopAngle.value = loopAngle
    electrons.material.uniforms.uConvergence.value = convergence
    electrons.material.uniforms.uFusion.value = state.fusion
    energy.material.uniforms.uLoopAngle.value = loopAngle
    energy.material.uniforms.uStrength.value = state.energy
    /* Sized off the wafer rather than the composition radius, so the glow tracks
       the slab it belongs to instead of a frame the slab no longer fills. */
    energy.mesh.scale.set(
      waferLength * THREE.MathUtils.lerp(0.36, 0.44, state.fusion),
      waferLength * THREE.MathUtils.lerp(0.065, 0.1, state.fusion),
      waferLength * THREE.MathUtils.lerp(0.125, 0.165, state.fusion)
    )
    cyanLight.intensity = state.energy * radius * radius * 0.74
    violetLight.intensity = state.energy * radius * radius * 0.64
  }

  let reducedStateApplied = false
  let disposed = false
  /* Last time the pool handed over, so a panel edit can redraw the same frame. */
  let lastSeconds = 0
  root.userData.update = seconds => {
    if (disposed) return
    reducedStateApplied = false
    lastSeconds = seconds
    applyState(seconds, false)
  }
  root.userData.applyReducedMotion = () => {
    if (disposed || reducedStateApplied) return
    reducedStateApplied = true
    applyState(0, true)
  }
  root.userData.dispose = () => {
    if (disposed) return
    disposed = true
    for (const geometry of resources.geometries) geometry.dispose()
    for (const material of resources.materials) {
      /* The scattering wafers each clone their own 1x1 thickness texture. */
      material.userData?.ownedTexture?.dispose()
      material.dispose()
    }
  }

  /*
   * Handed to the dev Materials panel so the framing can be dialled in on the
   * running kiosk instead of through edit-reload cycles. Reading back the live
   * object means the panel's sliders open on whatever the card is actually using.
   */
  root.userData.navTuning = {
    params: tuning,
    ranges: Object.freeze({
      circleScale: [0.3, 1.4],
      waferScale: [0.4, 2.4],
      tiltX: [-1.2, 1.2],
      tiltY: [-1.6, 1.6],
      tiltZ: [-0.8, 0.8],
      offsetX: [-2.5, 2.5],
      offsetY: [-2.5, 2.5],
      cropInset: [0.5, 1.2]
    }),
    apply(next = {}) {
      for (const [key, value] of Object.entries(next)) {
        if (key in tuning && Number.isFinite(value)) tuning[key] = value
      }
      applyTuning()
      /* Re-run the frame so a slider shows up without waiting for the next tick. */
      applyState(lastSeconds, false)
    }
  }

  applyTuning()
  applyState(0, false)
  return root
}
