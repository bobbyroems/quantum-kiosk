import { sound } from './kiosk-audio.js'
import { ensureRectAreaLightUniformsInitialized } from './rect-area-light-uniforms.js'
import { advanceCarouselSpring, createCarouselSpring } from './carousel-spring.js'
import {
  getModuleNavigationGridLayout,
  MODULE_NAVIGATION_GRID,
  MODULE_NAVIGATION_PROJECTION
} from './module-navigation-projection.js'
import {
  createBallTemplate,
  createBrushedEnv,
  createErrorCorrectionBall,
  createFrostShell,
  BALL_ACCENT_LIGHTS,
  BALL_CONFIG,
  BALL_KEY_LIGHT,
  BALL_PHASE_LABELS,
  BALL_RADIUS,
  BALL_SHELL_RADIUS
} from './error-correction-ball.js'
import { applyIceReflector, createIceCube, loadIceCubeGeometry } from './ice-cube.js'
import { applyImperfectionToObject, imperfectionUniforms, IMP_GLSL } from './surface-imperfection.js'
import {
  createNanowireMenuObject,
  NANOWIRE_MENU_LIGHTING,
  NANOWIRE_MENU_SCALE_PERCENT
} from '../modules/build-nanowire/menu-scene.js'
import {
  createProtectionMenuObject,
  loadProtectionMenuModel
} from '../modules/protecting-information/menu-scene.js'
import { createQuantumComputerMenuObject } from '../modules/quantum-vs-classical/nav-model.js'
import { createQubitNavPreview } from '../modules/qubit-explorer/qubit-nav-preview.js'
import {
  COLUMN_COUNT as QP_COLUMNS,
  DOT_PITCH as QP_PITCH,
  DOT_ROWS as QP_DOT_ROWS,
  DOT_SIZE as QP_DOT
} from '../modules/quantum-platform/stack.js'

const ICE = '#8fd2ff'
const GREEN = '#8be6b4'
const GOLD = '#ffd489'
const NAVYBLUE = '#4f7bd9'
const SILVER = '#c9d4e8'
const BLUE = '#5eb2ff'
const PURPLE = '#b18cff'
const MAGENTA = '#ff7ad1'
const TEAL = '#6fe0d2'
const WHITE = '#bcd0ff'
const STEEL = '#9fb0dd'

/* Module 02 keeps the shared error-correction story and changes only the two
   colors identified in the supplied reference. */
export const NANOSCALE_MENU_BALL_PALETTE = Object.freeze({
  healthy: Object.freeze(['#0078D4']),
  /* Sampled from the dominant red tile faces in the supplied reference. The
     optical material supplies the lighter and darker variants. */
  error: Object.freeze(['#C21F28']),
  fixed: Object.freeze(['#49C5B1']),
  tileGlowColor: '#0078D4',
  isolateErrorHue: true,
  jitter: false,
  cleanReflections: true,
  glossRoughness: 0,
  clearcoatRoughness: 0
})

export const NANOSCALE_MENU_BALL_TIMING = Object.freeze({
  calmDuration: 2,
  errorRate: 3,
  maxErrorTiles: 6,
  instantErrors: true
})

/* Module 09's field, in the units its own table is written in: the lattice is
   4 columns of 56px dots on a 92px pitch, so the field is 332 across. The card
   works in fractions of these rather than in pixels, which is what lets `s`
   size the object without the lattice changing shape. */
const QP_FIELD_WIDTH = (QP_COLUMNS - 1) * QP_PITCH + QP_DOT
/* How deep the field is spread, as a multiple of its own pitch. Enough that the
   column has a near and a far side to find when it turns; not so much that the
   board's arrangement stops reading head-on, or that the column comes apart
   into loose dots once it is side on. */
const QP_DEPTH_RATIO = 0.7

/* Distance from the centre of a drawn ground shadow -> how dark it is there,
   as a fraction of its peak. Sampled off the Figma plate for Module 09, which
   is the only artwork on the floor that draws one. */
const GROUND_SHADOW_PROFILE = Object.freeze([
  [0, 1], [0.3, 0.96], [0.5, 0.87], [0.7, 0.72], [0.8, 0.55], [0.9, 0.24], [1, 0]
])
/* The module's six inks, as the plate's flat colours. The shade each one falls
   to on the artwork is a consistent 60% of it warmed back towards blue, which
   is a light-to-shade ratio of about 1.44 — the number the card's `contrast`
   is set from, below. The values live here rather than in the module's own
   table because that table names them for a stylesheet, and this is the other
   place they are drawn. */
const QP_INKS = Object.freeze({
  blue: '#0078d4',
  purple: '#8661c5',
  teal: '#49c5b1',
  grey: '#b1b3b3',
  slate: '#7b7b7b',
  mist: '#d9d9d9'
})

/* The shader offers two ways to shade a surface, and only one of them suits
   this artwork.

   Its matte term runs the ball light-to-dark top-to-bottom, which is not where
   the plate's gradient goes — on the plate the light comes from over the
   visitor's right shoulder and the shading runs diagonally away from it. Its
   directional term does exactly that, and with a range wide enough to reach
   the plate's own contrast, so the spheres take that one and the vertical mix
   is switched off by handing both of its ends the same colour.

   That leaves one number to set: the tone which, lit, peaks at the plate's
   flat colour. The directional term's high end is about 1.3x at the contrast
   below, so the tone is the ink divided by that — fitted against the rendered
   card rather than taken from the shader, since the renderer's tone mapping
   sits in between. */
const QP_TONE_GAIN = 1.3


/*
 * New-style nav previews: one sphere centred in the visual, tinted by the
 * module's category. x/y are % of the scene box (y down), s is width in %
 * of scene width, drift is float travel in scene-box px.
 */
const SPHERE = { type: 'sphere', x: 50, y: 45, s: 36, delay: 0, drift: 16, core: true }
const SCENE_DEFS = {
  /* Bloch sphere with a precessing state arrow; the arrow "measures" itself
     (snaps to |0⟩ or |1⟩) as the dive into the module starts. */
  /* Stashed Bloch-sphere card, in case the OBJ hero doesn't stick:
     [{ ...SPHERE, type: 'bloch', color: '#e3ecf7', s: 27, y: 47, dur: 6.4 }] */
  'quantum-vs-classical': [{ ...SPHERE, type: 'quantum-computer', s: 38, y: 38 }],
  nanoscale: [{
    ...SPHERE,
    color: BLUE,
    dur: 5.6,
    ballPalette: NANOSCALE_MENU_BALL_PALETTE,
    ballTiming: NANOSCALE_MENU_BALL_TIMING,
    showStatus: false
  }],
  /* The framing is deliberate — a length of the stack cropped by the circle — and
     an idle turntable swings that composition away from it, so this one holds
     still. Dragging still turns it. */
  'qubit-explorer': [{
    ...SPHERE,
    type: 'topoconductor',
    color: BLUE,
    s: 40,
    y: 46,
    dur: 9.6,
    drift: 0,
    autoRotate: false,
    /* Facing the visitor square-on, as dialled in the framing panel. */
    startAngle: 3.14
  }],
  /* The Ice+Cube.glb chunk under the procedural ice shader (frost interior,
     cracks, welded droplets); falls back to the ball if the model is missing. */
  'states-of-matter': [{ ...SPHERE, type: 'ice', color: ICE, s: 32, dur: 5.2 }],
  'protecting-information': [{
    ...SPHERE,
    type: 'protection-core',
    color: BLUE,
    s: 51,
    y: 47,
    dur: 9.6,
    /* No cameraHeight/cameraLookAtY override any more: the device is framed by its
       own circle now, so it uses the same camera as every other card rather than a
       raised one picked when the bare chip had to be looked down on. */
    contactShadowScale: 5.6,
    drift: 0,
    /* Deliberate framing inside its circle, same as the topoconductor: an idle
       turntable swings the composition off it. Dragging still turns the card. */
    autoRotate: false,
    startAngle: -1.62
  }],
  'build-nanowire': [{
    ...SPHERE,
    type: 'nanowire',
    core: true,
    userOrbit: false,
    /* Both were moduleId checks in the pool; declared here now, same behaviour. */
    autoRotate: false,
    startAngle: 0,
    color: '#b8c4d0',
    s: NANOWIRE_MENU_SCALE_PERCENT,
    y: 44,
    dur: 10,
    drift: 0
  }],
  'build-majorana-2': [{ ...SPHERE, color: PURPLE, dur: 5.8 }],
  /* The stack, standing rather than lying on the page. It is much taller than
     it is wide, so `s` sizes it well under the round objects beside it: `s` is
     the field's width, and this field is nearly three times as tall as wide.
     Square-on to start, because that is the arrangement the board draws and
     the one a visitor should meet; turning it is theirs to do. No turntable
     for the same reason the topoconductor has none — an idle spin would swing
     the composition off the framing it was drawn for. */
  'quantum-platform': [{
    ...SPHERE,
    type: 'stack-column',
    color: BLUE,
    s: 15,
    y: 44,
    dur: 8.4,
    drift: 10,
    /* Painted, not projected — see the drawn-shadow block in the pool. Its
       width is the plate's: a touch wider than the field itself. */
    groundShadow: { widthRatio: 1.08, opacity: 0.21, forward: 0.5 },
    autoRotate: false,
    startAngle: 0
  }]
}

const CAMERA_DISTANCE = MODULE_NAVIGATION_PROJECTION.distance
const CAMERA_HEIGHT = MODULE_NAVIGATION_PROJECTION.height
const FOV_DEGREES = MODULE_NAVIGATION_PROJECTION.fovDegrees
/* Ceiling on the shared drawing buffer (width × height in device pixels):
   full kiosk-card resolution fits, runaway dpr × viewport combinations don't. */
const MAX_RENDER_PIXELS = 3_300_000
/* Compositions occupy the top band of the render region; the rest is floor room. */
const COMPOSITION_BAND = 0.75
/* Slight three-quarter pose every scene opens with when its card takes centre. */
const SCENE_START_ANGLE = -0.35
/* Pull compositions toward the centre of the frame (negative lifts them).
   Tuned so the sphere's top never clips the frame at the peak of its bob. */
const COMPOSITION_SHIFT_Y = 0.06
const COMPOSITION_SQUEEZE_X = 0.72

export function hasShapeScene(moduleId) {
  return Boolean(SCENE_DEFS[moduleId])
}

function allowsShapeSceneUserOrbit(moduleId) {
  return Boolean(SCENE_DEFS[moduleId]?.some(def => def.userOrbit !== false))
}

function allowsShapeSceneAutoRotate(moduleId) {
  return Boolean(SCENE_DEFS[moduleId]?.every(def => def.autoRotate !== false))
}

/*
 * The ball runs a repair story on its own clock — tiles redden, a wave sweeps
 * through, they settle teal — and without a caption a visitor sees colour but no
 * cause. This is the playground's HUD pill, sat under the sphere: it names the
 * phase and takes the phase's colour. Returns the setter the ball calls, or null
 * when there is no host to hang it on, which is what `onPhase` expects.
 */
function bindBallStatusPill(host) {
  const parent = host?.element
  if (!parent) return null

  const pill = document.createElement('span')
  pill.className = 'module-card__ball-status'
  /* Decorative: the phase is already narrated to screen readers by the module
     status copy, and a live region here would interrupt on its own timer. */
  pill.setAttribute('aria-hidden', 'true')

  const dot = document.createElement('span')
  dot.className = 'module-card__ball-status-dot'
  const text = document.createElement('span')
  text.className = 'module-card__ball-status-text'
  pill.append(dot, text)
  parent.append(pill)

  return phase => {
    const info = BALL_PHASE_LABELS[phase]
    if (!info) return
    text.textContent = info.text
    pill.style.setProperty('--ball-status-color', info.color)
  }
}

function createSoftMaterial(THREE, colorHex, sharedUniforms, { qubitLines = false, greenDots = false } = {}) {
  const base = new THREE.Color(colorHex)
  return new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      /* Lighten and darken in HSL so pale tints keep their hue instead of washing to white. */
      uLight: { value: base.clone().offsetHSL(0, 0.04, 0.14) },
      uShadow: {
        value: base.clone().offsetHSL(0.03, 0.08, -0.3).lerp(new THREE.Color('#241c3e'), 0.3)
      },
      uQubitLines: { value: qubitLines ? 1 : 0 },
      uGreenDots: { value: greenDots ? 1 : 0 },
      uMelt: { value: 0 },
      uMeltHalf: { value: 1 },
      ...sharedUniforms,
      ...imperfectionUniforms
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      varying vec2 vUv;
      varying vec3 vImpPos;

      uniform float uMelt;
      uniform float uMeltHalf;

      void main() {
        vec3 objectNormal = normal;
        vec3 meltedPosition = position;
        if (uMelt > 0.001) {
          /* Sag toward the base while the lower half flares into a puddle. */
          float heightNorm = clamp(position.y / max(uMeltHalf, 0.0001) * 0.5 + 0.5, 0.0, 1.0);
          meltedPosition.y = mix(
            position.y,
            -uMeltHalf + (position.y + uMeltHalf) * 0.16,
            uMelt
          );
          float spread = 1.0 + uMelt * (0.3 + 1.2 * pow(1.0 - heightNorm, 1.6));
          meltedPosition.x *= spread;
          meltedPosition.z *= spread;
        }
        vImpPos = meltedPosition;
        vec4 objectPosition = vec4(meltedPosition, 1.0);
        #ifdef USE_INSTANCING
          objectNormal = mat3(instanceMatrix) * objectNormal;
          objectPosition = instanceMatrix * objectPosition;
        #endif
        vNormal = normalize(normalMatrix * objectNormal);
        vec4 mvPosition = modelViewMatrix * objectPosition;
        vViewDir = normalize(-mvPosition.xyz);
        vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
        vWorldPosition = (modelMatrix * objectPosition).xyz;
        vUv = uv;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      ${IMP_GLSL}
      uniform vec3 uLight;
      uniform vec3 uShadow;
      uniform vec3 uRim;
      uniform float uAlphaBase;
      uniform float uRimStrength;
      uniform float uIrid;
      uniform float uSpec;
      uniform float uContrast;
      uniform float uDiffuseMix;
      uniform float uShadowSide;
      uniform float uQubitLines;
      uniform float uGreenDots;
      uniform vec3 uSpecColor;
      uniform vec3 uDotColor;
      uniform vec3 uLightDir;
      uniform float uEnvWash;
      uniform float uGrain;
      uniform float uGloss;

      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      varying vec2 vUv;

      // Soft glowing dot at a fixed UV anchor, aspect-corrected for the sphere.
      float dotGlow(vec2 uv, vec2 anchor, float size) {
        vec2 offset = vec2((uv.x - anchor.x) * 2.0 * sin(3.14159 * anchor.y), uv.y - anchor.y);
        float len = length(offset);
        float core = 1.0 - smoothstep(size * 0.55, size, len);
        float halo = (1.0 - smoothstep(size, size * 3.2, len)) * 0.3;
        return core + halo;
      }

      void main() {
        vec3 normal = normalize(vNormal);
        vec3 viewDir = normalize(vViewDir);
        vec3 worldNormal = normalize(vWorldNormal);
        /* Shared surface imperfection: orange-peel normal jitter plus a
           per-patch sheen/albedo drift, dialed globally by the dev panel. */
        vec3 impOff = imp_normalOffset(vImpPos);
        normal = normalize(normal + impOff);
        worldNormal = normalize(worldNormal + impOff);
        float impSpecVar = clamp(1.0 - imp_roughShift(vImpPos) * 2.5, 0.2, 1.6);
        /* Where the normal jitter went sub-pixel (faded by imp_normalFade),
           soften the highlight instead — kills the sparkle crawl. */
        impSpecVar *= mix(0.72, 1.0, imp_normalFade(vImpPos));
        float ndv = clamp(dot(normal, viewDir), 0.0, 1.0);

        float topLight = clamp(worldNormal.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 base = mix(uShadow, uLight, topLight);

        vec3 lightDirection = normalize(uLightDir);
        float lambert = clamp(dot(worldNormal, lightDirection) * 0.5 + 0.5, 0.0, 1.0);
        float diffuse = pow(lambert, mix(1.4, 2.8, uContrast));
        float lowEnd = mix(0.82, 0.4, uContrast);
        float highEnd = mix(1.08, 1.45, uContrast);
        vec3 color = base * mix(lowEnd, highEnd, diffuse);

        // Pearlescent hue drift: thin-film style pink/cyan rings driven by view angle.
        vec3 iridescence = 0.5 + 0.5 * cos(6.28318 * (ndv * 0.85 + vec3(0.0, 0.33, 0.67)));
        color = mix(color, color * (0.72 + 0.55 * iridescence), uIrid);

        // Soft studio-reflection wash so flat faces get a gradient too, not just curved ones.
        vec3 reflectDir = reflect(-viewDir, normal);
        float envBand = smoothstep(-0.45, 1.0, reflectDir.y);
        color *= mix(1.0, 0.92 + 0.14 * envBand, uEnvWash);
        color += uRim * envBand * 0.1 * uRimStrength * uEnvWash;

        // Fine specular grain, like the reference's sparkling micro-texture.
        float grain = fract(sin(dot(vWorldPosition * 64.0, vec3(12.9898, 78.233, 37.719))) * 43758.5453);

        // Wet clearcoat: one tight highlight, one broad satin sheen.
        vec3 halfDirection = normalize(lightDirection + viewDir);
        float specular = pow(max(dot(normal, halfDirection), 0.0), 110.0) * 0.9 * uSpec;
        vec3 fillDirection = normalize(vec3(0.65, 0.25, 0.6));
        vec3 fillHalf = normalize(fillDirection + viewDir);
        float sheen = pow(max(dot(normal, fillHalf), 0.0), 26.0) * 0.3 * uSpec;
        color += uSpecColor * (specular + sheen) * impSpecVar * mix(1.0, 0.82 + 0.36 * grain, uGrain);

        // Studio window reflection: a broad soft glossy card up and to the left,
        // like the big highlight in the product-photo reference.
        vec3 windowDir = normalize(vec3(-0.45, 0.75, 0.5));
        float windowHighlight = smoothstep(0.86, 0.985, dot(reflectDir, windowDir)) * uGloss;
        color += uSpecColor * windowHighlight * impSpecVar * (0.55 + 0.45 * envBand);

        // Iridescent milky rim, strongest at grazing angles.
        float fresnel = pow(1.0 - ndv, 2.1);
        color += uRim * fresnel * (0.5 + 0.5 * iridescence) * uRimStrength;

        // Optional matte-diffuse blend: pulls the pearl toward soft velvety shading.
        vec3 matte = base * mix(0.78, 1.18, lambert * lambert);
        color = mix(color, matte, uDiffuseMix);

        // Negative fill: an invisible flag darkening faces toward the bottom-right.
        float flag = clamp(dot(worldNormal, normalize(vec3(0.55, -0.6, 0.25))), 0.0, 1.0);
        color *= 1.0 - flag * uShadowSide * 0.65;

        // Qubit surface markings: a solid meridian and a dotted equator, drawn in UV space.
        float qubitLine = 0.0;
        if (uQubitLines > 0.5) {
          float equator = 1.0 - smoothstep(0.0035, 0.007, abs(vUv.y - 0.5));
          equator *= step(0.5, fract(vUv.x * 22.0));
          float meridianDistance = min(abs(vUv.x - 0.25), abs(vUv.x - 0.75));
          float meridian = 1.0 - smoothstep(0.0018, 0.0038, meridianDistance);
          qubitLine = max(equator, meridian) * 0.92;
          color = mix(color, vec3(1.0), qubitLine);
        }

        // Green qubit sparks scattered across the surface (Bloch core look).
        if (uGreenDots > 0.5) {
          float glow = 0.0;
          glow += dotGlow(vUv, vec2(0.16, 0.63), 0.016);
          glow += dotGlow(vUv, vec2(0.33, 0.41), 0.012);
          glow += dotGlow(vUv, vec2(0.46, 0.74), 0.015);
          glow += dotGlow(vUv, vec2(0.57, 0.33), 0.012);
          glow += dotGlow(vUv, vec2(0.70, 0.57), 0.016);
          glow += dotGlow(vUv, vec2(0.85, 0.45), 0.012);
          glow += dotGlow(vUv, vec2(0.94, 0.69), 0.014);
          glow = min(glow, 1.2);
          color = mix(color, uDotColor, min(glow, 1.0));
          color += uDotColor * 0.45 * glow;
          qubitLine = max(qubitLine, glow * 0.7);
        }

        color *= imp_mottle(vImpPos);

        // Slightly translucent body; rims, highlights and markings stay solid.
        float alpha = clamp(
          uAlphaBase + 0.25 * fresnel + specular + qubitLine * 0.5 + windowHighlight * 0.6,
          0.0,
          1.0
        );

        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  })
}

function buildMeltBlob(THREE, MarchingCubes, group, radius, material) {
  const blob = new MarchingCubes(26, material, true, false, 8192)
  const baseScale = radius * 1.15
  blob.scale.setScalar(baseScale)
  group.add(blob)

  const CYCLE_SECONDS = 11
  group.userData.update = seconds => {
    const cycle = (seconds / CYCLE_SECONDS) % 1

    /* Melt amount: hold solid → melt → puddle → quick refreeze → solid. */
    let melt
    if (cycle < 0.2) melt = 0
    else if (cycle < 0.45) melt = 1 - Math.pow(1 - (cycle - 0.2) / 0.25, 3)
    else if (cycle < 0.7) melt = 1
    else if (cycle < 0.8) melt = Math.pow(1 - (cycle - 0.7) / 0.1, 2)
    else melt = 0

    /* Sag vertically as it melts and sink the puddle down onto the platform. */
    const squash = 1 - melt * 0.42
    blob.scale.set(baseScale * (1 + melt * 0.05), baseScale * squash, baseScale * (1 + melt * 0.05))
    blob.position.y =
      -(1 - squash) * baseScale * 0.4 + melt * (group.userData.meltDropDistance ?? 0)

    blob.reset()

    /* Core mass: a corner-ball lattice reads as a rounded cube when solid,
       then collapses outward and flattens into a puddle as it melts. */
    const clusterY = 0.56 - melt * 0.24
    const wobble = Math.sin(seconds * 2.1) * 0.014 * melt
    const half = 0.085
    for (const gridX of [-1, 0, 1]) {
      for (const gridY of [-1, 0, 1]) {
        for (const gridZ of [-1, 0, 1]) {
          blob.addBall(
            0.5 + gridX * (half + melt * 0.09),
            clusterY + gridY * half * (1 - melt * 0.82) + wobble * gridX,
            0.5 + gridZ * (half + melt * 0.07),
            0.24,
            12
          )
        }
      }
    }
    blob.addBall(0.5, clusterY, 0.5, 0.35, 12)

    blob.update()
  }
  group.userData.update(0)
}

function buildShapeMesh(THREE, RoundedBoxGeometry, def, radius, material, makeMaterial, ballContext) {
  const group = new THREE.Group()

  if (def.type === 'sphere') {
    group.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), material))
  } else if (def.type === 'ring') {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.78, radius * (def.tube ?? 0.3), 24, 64),
      material
    )
    ring.rotation.x = def.tilt ?? 0.42
    group.add(ring)
  } else if (def.type === 'dome') {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
      material
    )
    const cap = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), material)
    cap.rotation.x = -Math.PI / 2
    dome.position.y = -radius * 0.45
    cap.position.y = -radius * 0.45
    group.add(dome, cap)
    group.rotation.y = 0.4
  } else if (def.type === 'arch') {
    const arcRadius = radius * 0.62
    const tube = radius * 0.34
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(arcRadius, tube, 24, 48, Math.PI),
      material
    )
    const legLength = radius * 0.55
    const legGeometry = new THREE.CylinderGeometry(tube, tube, legLength, 24)
    const leftLeg = new THREE.Mesh(legGeometry, material)
    const rightLeg = new THREE.Mesh(legGeometry, material)
    leftLeg.position.set(-arcRadius, -legLength / 2, 0)
    rightLeg.position.set(arcRadius, -legLength / 2, 0)
    group.add(arc, leftLeg, rightLeg)
  } else if (def.type === 'slab') {
    const size = radius * 1.7
    const slab = new THREE.Mesh(
      new RoundedBoxGeometry(size, size, size * 0.62, 5, size * 0.28),
      material
    )
    slab.rotation.set(0.18, -0.42, 0)
    group.add(slab)
  } else if (def.type === 'pill') {
    const aspect = def.aspect ?? 3.6
    const width = radius * 2
    const pillRadius = width / aspect / 2
    const pill = new THREE.Mesh(
      new THREE.CapsuleGeometry(pillRadius, width - pillRadius * 2, 8, 28),
      material
    )
    pill.rotation.z = Math.PI / 2
    group.add(pill)
  } else if (def.type === 'qubit') {
    /* Microsoft Quantum's qubit mark: surface lines are painted by the shader. */
    group.add(new THREE.Mesh(new THREE.SphereGeometry(radius * 0.68, 56, 40), material))
    group.rotation.y = 0.5
  } else if (def.type === 'bloch') {
    /* Bloch sphere built from the honeycomb ball's material stack: an SSS
       blue core under the ball's additive gloss coat (brushed-metal env
       reflections), inside its pure-fresnel frosted shell with the white
       dashed equator / solid meridian rings, lit by the same inner light.
       Ket labels and a measuring state arrow complete the diagram. */
    const { template, brushedEnv, SubsurfaceScatteringShader } = ballContext
    const lin = hex => new THREE.Color(hex).convertSRGBToLinear()

    /* Core: the ball's subsurface-scattering recipe on a smooth sphere. */
    const whiteTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
    whiteTex.needsUpdate = true
    const coreUniforms = THREE.UniformsUtils.clone(SubsurfaceScatteringShader.uniforms)
    coreUniforms.diffuse.value = lin('#2e66cc')
    coreUniforms.thicknessMap.value = whiteTex
    coreUniforms.thicknessColor.value = lin(BALL_CONFIG.tileGlowColor)
    coreUniforms.thicknessDistortion.value = BALL_CONFIG.tileDistortion
    coreUniforms.thicknessAmbient.value = BALL_CONFIG.tileAmbient
    coreUniforms.thicknessAttenuation.value = BALL_CONFIG.tileAttenuation
    coreUniforms.thicknessPower.value = BALL_CONFIG.tilePower
    coreUniforms.thicknessScale.value = BALL_CONFIG.tileScale
    coreUniforms.shininess.value = BALL_CONFIG.tileShininess
    coreUniforms.specular.value = lin(BALL_CONFIG.tileSpecular)
    const coreMaterial = new THREE.ShaderMaterial({
      uniforms: coreUniforms,
      vertexShader: SubsurfaceScatteringShader.vertexShader,
      fragmentShader: SubsurfaceScatteringShader.fragmentShader,
      lights: true
    })
    const coreRadius = radius * 0.86
    const core = new THREE.Mesh(new THREE.SphereGeometry(coreRadius, 56, 40), coreMaterial)
    group.add(core)

    /* Gloss coat: the ball's additive reflections-only layer. */
    const glossMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x000000,
      roughness: BALL_CONFIG.glossRoughness,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      envMap: brushedEnv ?? null,
      envMapIntensity: BALL_CONFIG.glossReflect,
      transparent: true,
      opacity: BALL_CONFIG.glossStrength,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    })
    const gloss = new THREE.Mesh(
      new THREE.SphereGeometry(coreRadius * 1.005, 56, 40),
      glossMaterial
    )
    gloss.renderOrder = 1
    gloss.userData.noShadow = true
    group.add(gloss)

    /* Frosted shell and white rings, reusing the ball's geometry template. */
    const frost = createFrostShell(THREE)
    const glass = new THREE.Group()
    glass.scale.setScalar(radius / BALL_SHELL_RADIUS)
    const shellBack = new THREE.Mesh(template.shellGeometry, frost.back)
    shellBack.renderOrder = 2
    shellBack.userData.noShadow = true
    const shellFront = new THREE.Mesh(template.shellGeometry, frost.front)
    shellFront.renderOrder = 3
    shellFront.userData.noShadow = true
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
      transparent: true
    })
    const equator = new THREE.Mesh(template.equatorGeometry, ringMaterial)
    equator.renderOrder = 4
    equator.userData.noShadow = true
    const meridian = new THREE.Mesh(template.meridianGeometry, ringMaterial)
    meridian.renderOrder = 4
    meridian.userData.noShadow = true
    /* Faded second pass drawn only where the sphere occludes the rings, so
       the equator/meridian stay readable on the far side, diagram-style. */
    const ringBackMaterial = ringMaterial.clone()
    ringBackMaterial.depthFunc = THREE.GreaterDepth
    ringBackMaterial.depthWrite = false
    ringBackMaterial.opacity = 0.35
    const equatorBack = new THREE.Mesh(template.equatorGeometry, ringBackMaterial)
    equatorBack.renderOrder = 4
    equatorBack.userData.noShadow = true
    const meridianBack = new THREE.Mesh(template.meridianGeometry, ringBackMaterial)
    meridianBack.renderOrder = 4
    meridianBack.userData.noShadow = true
    glass.add(shellBack, shellFront, equator, meridian, equatorBack, meridianBack)
    group.add(glass)

    /* The ball's inner light, intensity following the inverse-square law. */
    const innerScale = radius / BALL_RADIUS
    const innerLight = new THREE.PointLight(
      BALL_CONFIG.innerLight.color,
      BALL_CONFIG.innerLight.intensity * innerScale * innerScale,
      0,
      2
    )
    group.add(innerLight)

    /* Thin axis lines through the poles and equator, like the diagram. */
    const axisMaterial = new THREE.MeshBasicMaterial({
      color: '#8d97a8',
      transparent: true,
      opacity: 0.55,
      depthWrite: false
    })
    const axisGeometry = new THREE.CylinderGeometry(
      radius * 0.009,
      radius * 0.009,
      radius * 2.7,
      8
    )
    const axisY = new THREE.Mesh(axisGeometry, axisMaterial)
    const axisX = new THREE.Mesh(axisGeometry, axisMaterial)
    axisX.rotation.z = Math.PI / 2
    const axisZ = new THREE.Mesh(axisGeometry, axisMaterial)
    axisZ.rotation.x = Math.PI / 2
    for (const axis of [axisX, axisY, axisZ]) {
      axis.userData.noShadow = true
      group.add(axis)
    }

    /* Ket labels as billboarded sprites so they stay upright while the
       diorama orbits. */
    const makeKetLabel = text => {
      const canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 192
      const context = canvas.getContext('2d')
      context.fillStyle = '#6f7683'
      context.font = '600 104px "Segoe UI", "Segoe UI Symbol", sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(text, 128, 100)
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = 4
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false
      }))
      sprite.scale.set(radius * 0.22, radius * 0.165, 1)
      sprite.renderOrder = 5
      return sprite
    }
    const ketSprites = []
    /* Clear of the axis-line tips (1.35 r) so labels never touch the lines. */
    const ketDistance = radius * 1.5
    for (const [text, x, y, z] of [
      ['|0⟩', 0, ketDistance, 0],
      ['|1⟩', 0, -ketDistance, 0],
      ['|+⟩', ketDistance, 0, 0],
      ['|−⟩', -ketDistance, 0, 0],
      ['|+i⟩', 0, 0, ketDistance],
      ['|−i⟩', 0, 0, -ketDistance]
    ]) {
      const sprite = makeKetLabel(text)
      sprite.position.set(x, y, z)
      group.add(sprite)
      ketSprites.push({ sprite, direction: new THREE.Vector3(x, y, z).normalize() })
    }
    const worldQuaternion = new THREE.Quaternion()
    const ketWorldDir = new THREE.Vector3()

    /* Flat unshaded white — a pure diagram element, like the rings.
       depthTest off so it draws over the opaque SSS core, diagram-style. */
    const arrowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
      depthTest: false
    })
    const arrowLength = radius * 0.86
    const shaftLength = arrowLength - radius * 0.24
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.0175, radius * 0.0175, shaftLength, 16),
      arrowMaterial
    )
    shaft.position.y = shaftLength / 2
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(radius * 0.045, radius * 0.24, 24),
      arrowMaterial
    )
    tip.position.y = arrowLength - radius * 0.12
    const hub = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.03, 20, 14), arrowMaterial)
    const arrow = new THREE.Group()
    arrow.add(shaft, tip, hub)
    for (const part of [shaft, tip, hub]) part.renderOrder = 3.5
    group.add(arrow)

    const up = new THREE.Vector3(0, 1, 0)
    const direction = new THREE.Vector3()
    const snap = { pending: false, startAt: null, fromTheta: 1, target: 0, phi: 0 }
    let freeTheta = 1

    group.userData.update = seconds => {
      let theta
      let phi
      if (snap.pending) {
        if (snap.startAt === null) {
          /* Measurement: collapse to |0⟩ (up) or |1⟩ (down) at random. */
          snap.startAt = seconds
          snap.fromTheta = freeTheta
          snap.target = Math.random() < 0.5 ? 0 : Math.PI
        }
        const t = Math.min(1, (seconds - snap.startAt) / 0.45)
        /* Back-out ease: a fast snap with a springy overshoot at the pole. */
        const eased = 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2)
        theta = snap.fromTheta + (snap.target - snap.fromTheta) * eased
        phi = snap.phi
      } else {
        /* Superposition: wander around a tilted latitude, like the reference. */
        theta = 1.02 + Math.sin(seconds * 0.55) * 0.22
        phi = seconds * 1.5
        freeTheta = theta
        snap.phi = phi
      }
      direction.set(
        Math.sin(theta) * Math.cos(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.sin(phi)
      ).normalize()
      arrow.quaternion.setFromUnitVectors(up, direction)

      /* Fade ket labels whose axis is swinging toward the camera, so they
         never sit on top of the sphere while the diorama orbits. */
      group.getWorldQuaternion(worldQuaternion)
      for (const ket of ketSprites) {
        ketWorldDir.copy(ket.direction).applyQuaternion(worldQuaternion)
        const towardCamera = Math.abs(ketWorldDir.z)
        ket.sprite.material.opacity =
          towardCamera < 0.8 ? 1 : Math.max(0, 1 - (towardCamera - 0.8) / 0.15)
      }
    }
    group.userData.update(0)

    group.userData.blochMaterials = {
      core: coreMaterial,
      gloss: glossMaterial,
      shell: frost.uniforms,
      ring: ringMaterial,
      ringBack: ringBackMaterial,
      arrow: arrowMaterial
    }

    group.userData.snapMeasure = () => {
      if (!snap.pending) {
        snap.pending = true
        snap.startAt = null
      }
    }
    group.userData.resetMeasure = () => {
      snap.pending = false
      snap.startAt = null
    }
  } else if (def.type === 'digit-one') {
    group.add(new THREE.Mesh(new THREE.CapsuleGeometry(radius * 0.3, radius * 1.5, 8, 24), material))
  } else if (def.type === 'digit-zero') {
    const zero = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.6, radius * 0.28, 20, 48),
      material
    )
    zero.scale.y = 1.35
    group.add(zero)
  } else if (def.type === 'atom') {
    const nucleus = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.4, 48, 32), material)
    group.add(nucleus)
    const orbitGeometry = new THREE.TorusGeometry(radius * 0.95, radius * 0.05, 12, 64)
    const electronGeometry = new THREE.SphereGeometry(radius * 0.13, 24, 16)
    const orbitTilts = [
      [Math.PI / 2.4, 0],
      [Math.PI / 2.4, Math.PI / 1.5],
      [Math.PI / 2.4, -Math.PI / 1.5]
    ]
    orbitTilts.forEach(([tiltX, tiltZ], orbitIndex) => {
      const orbitPivot = new THREE.Group()
      orbitPivot.rotation.set(tiltX, 0, tiltZ)
      orbitPivot.add(new THREE.Mesh(orbitGeometry, material))
      const electron = new THREE.Mesh(electronGeometry, material)
      const electronAngle = orbitIndex * 2.3
      electron.position.set(
        Math.cos(electronAngle) * radius * 0.95,
        Math.sin(electronAngle) * radius * 0.95,
        0
      )
      orbitPivot.add(electron)
      group.add(orbitPivot)
    })
  } else if (def.type === 'magnifier') {
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.55, radius * 0.09, 16, 48),
      material
    )
    const handle = new THREE.Mesh(
      new THREE.CapsuleGeometry(radius * 0.09, radius * 0.85, 8, 20),
      material
    )
    handle.position.set(radius * 0.72, -radius * 0.72, 0)
    handle.rotation.z = Math.PI / 4
    group.add(rim, handle)
    group.rotation.z = -0.15
  } else if (def.type === 'droplet') {
    const body = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.58, 48, 32), material)
    const tip = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.34, radius * 0.85, 32), material)
    tip.position.y = radius * 0.62
    group.add(body, tip)
  } else if (def.type === 'wafer') {
    group.add(
      new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.9, radius * 0.9, radius * 0.16, 48), material)
    )
  } else if (def.type === 'padlock') {
    const body = new THREE.Mesh(
      new RoundedBoxGeometry(radius * 1.15, radius * 0.95, radius * 0.5, 4, radius * 0.12),
      material
    )
    body.position.y = -radius * 0.28
    const shackle = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.42, radius * 0.1, 16, 32, Math.PI),
      material
    )
    shackle.position.y = radius * 0.2
    group.add(body, shackle)
  } else if (def.type === 'wave') {
    const points = []
    for (let i = 0; i <= 24; i++) {
      const t = i / 24
      points.push(new THREE.Vector3(
        -radius + radius * 2 * t,
        Math.sin(t * Math.PI * 3) * radius * 0.3,
        0
      ))
    }
    const curve = new THREE.CatmullRomCurve3(points)
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, radius * 0.09, 12), material))
  } else if (def.type === 'screen') {
    const panel = new THREE.Mesh(
      new RoundedBoxGeometry(radius * 1.6, radius * 1.15, radius * 0.12, 3, radius * 0.06),
      material
    )
    const foot = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.3, radius * 0.42, radius * 0.12, 24),
      material
    )
    foot.position.y = -radius * 0.72
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.07, radius * 0.07, radius * 0.32, 16),
      material
    )
    neck.position.y = -radius * 0.6
    group.add(panel, neck, foot)
    group.rotation.y = -0.3
  } else if (def.type === 'stream') {
    /* Dashed particle lanes flowing along gentle curves: reads as data/signal. */
    const lanes = def.lanes ?? 4
    const dashesPerLane = 12
    const dashGeometry = new RoundedBoxGeometry(
      radius * 0.16,
      radius * 0.045,
      radius * 0.045,
      1,
      radius * 0.02
    )
    const instanced = new THREE.InstancedMesh(dashGeometry, material, lanes * dashesPerLane)
    instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    group.add(instanced)

    const curves = []
    for (let lane = 0; lane < lanes; lane++) {
      const laneOffset = (lane - (lanes - 1) / 2) * radius * 0.16
      const points = []
      for (let i = 0; i <= 10; i++) {
        const t = i / 10
        points.push(new THREE.Vector3(
          -radius + radius * 2 * t,
          laneOffset * (0.35 + 0.65 * Math.sin(Math.PI * t)),
          Math.sin(t * Math.PI * 2 + lane * 1.7) * radius * 0.05
        ))
      }
      curves.push(new THREE.CatmullRomCurve3(points))
    }

    const dummy = new THREE.Object3D()
    const pointTarget = new THREE.Vector3()
    const tangentTarget = new THREE.Vector3()
    const forward = new THREE.Vector3(1, 0, 0)
    group.userData.update = seconds => {
      let instanceIndex = 0
      for (let lane = 0; lane < lanes; lane++) {
        for (let dash = 0; dash < dashesPerLane; dash++) {
          const t = (dash / dashesPerLane + seconds * 0.055 + lane * 0.13) % 1
          curves[lane].getPointAt(t, pointTarget)
          curves[lane].getTangentAt(t, tangentTarget)
          dummy.position.copy(pointTarget)
          dummy.quaternion.setFromUnitVectors(forward, tangentTarget)
          dummy.scale.setScalar(0.55 + 0.45 * Math.sin(Math.PI * t))
          dummy.updateMatrix()
          instanced.setMatrixAt(instanceIndex, dummy.matrix)
          instanceIndex += 1
        }
      }
      instanced.instanceMatrix.needsUpdate = true
    }
  } else if (def.type === 'stack-column') {
    /* Module 09's quantum stack, as an object rather than a drawing.
       The field itself — which of the 44 lattice positions carry a dot, and in
       which of the six inks — is the module's own table, so the card and the
       module cannot drift apart.

       The board draws that field flat, and a flat field is not something a
       visitor can turn: side on it would be a line. So the dots take a shallow
       depth as well. It is deterministic rather than random — a kiosk that
       reshuffles its own menu art between sessions is a kiosk with a bug — and
       shallow enough that head-on the composition is still the board's.

       One geometry and six materials for all 27, since every dot is the same
       ball in one of the same handful of colours. */
    const fieldWidth = radius * 2
    const pitch = fieldWidth * (QP_PITCH / QP_FIELD_WIDTH)
    const dotRadius = (fieldWidth * (QP_DOT / QP_FIELD_WIDTH)) / 2
    const depth = pitch * QP_DEPTH_RATIO
    const rows = QP_DOT_ROWS.length

    const dotGeometry = new THREE.SphereGeometry(dotRadius, 32, 24)
    const inks = new Map()
    const inkMaterial = ink => {
      if (!inks.has(ink)) {
        const dotMaterial = makeMaterial ? makeMaterial(QP_INKS[ink]) : material
        /* One tone at both ends, so the light is the only thing shading these
           balls. The shared tint would instead roll a shadow by pushing the
           hue round and mixing in a dark violet — right for the pearls on the
           other cards, and what made these read cold and unlike the plate. */
        const tone = new THREE.Color(QP_INKS[ink]).multiplyScalar(1 / QP_TONE_GAIN)
        dotMaterial.uniforms?.uLight.value.copy(tone)
        dotMaterial.uniforms?.uShadow.value.copy(tone)
        inks.set(ink, dotMaterial)
      }
      return inks.get(ink)
    }

    /* The standard GLSL hash, used here for the one thing it is good at: a
       fixed, evenly spread number per lattice position. */
    const stagger = (row, column) => {
      const noise = Math.sin(row * 12.9898 + column * 78.233) * 43758.5453
      return (noise - Math.floor(noise) - 0.5) * depth
    }

    QP_DOT_ROWS.forEach((row, rowIndex) => {
      for (const dot of row) {
        const mesh = new THREE.Mesh(dotGeometry, inkMaterial(dot.ink))
        mesh.position.set(
          (dot.column - (QP_COLUMNS - 1) / 2) * pitch,
          ((rows - 1) / 2 - rowIndex) * pitch,
          stagger(rowIndex, dot.column)
        )
        group.add(mesh)
      }
    })
  } else if (def.type === 'board') {
    /* Simplified Majorana 2 puck: gold frame, blue PCB, gold modules, silver die. */
    const gold = makeMaterial ? makeMaterial(GOLD) : material
    const pcb = makeMaterial ? makeMaterial(NAVYBLUE) : material
    const silver = makeMaterial ? makeMaterial(SILVER) : material

    const frame = new THREE.Mesh(
      new RoundedBoxGeometry(radius * 1.9, radius * 0.2, radius * 1.55, 4, radius * 0.1),
      gold
    )
    group.add(frame)

    const board = new THREE.Mesh(
      new RoundedBoxGeometry(radius * 1.5, radius * 0.08, radius * 1.15, 3, radius * 0.03),
      pcb
    )
    board.position.y = radius * 0.11
    group.add(board)

    const moduleGeometry = new RoundedBoxGeometry(
      radius * 0.85,
      radius * 0.07,
      radius * 0.3,
      2,
      radius * 0.03
    )
    const moduleTop = new THREE.Mesh(moduleGeometry, gold)
    moduleTop.position.set(-radius * 0.2, radius * 0.17, -radius * 0.36)
    const moduleBottom = new THREE.Mesh(moduleGeometry, gold)
    moduleBottom.position.set(radius * 0.22, radius * 0.17, radius * 0.38)
    group.add(moduleTop, moduleBottom)

    const die = new THREE.Mesh(
      new RoundedBoxGeometry(radius * 0.56, radius * 0.07, radius * 0.56, 2, radius * 0.02),
      silver
    )
    die.position.set(radius * 0.06, radius * 0.17, 0)
    const dieCore = new THREE.Mesh(
      new RoundedBoxGeometry(radius * 0.22, radius * 0.05, radius * 0.22, 2, radius * 0.015),
      pcb
    )
    dieCore.position.set(radius * 0.06, radius * 0.22, 0)
    group.add(die, dieCore)

    const screwGeometry = new THREE.CylinderGeometry(radius * 0.07, radius * 0.07, radius * 0.1, 20)
    for (const screwX of [-1, 1]) {
      for (const screwZ of [-1, 1]) {
        const screw = new THREE.Mesh(screwGeometry, gold)
        screw.position.set(screwX * radius * 0.78, radius * 0.13, screwZ * radius * 0.6)
        group.add(screw)
      }
    }
  }

  return group
}

export async function createShapeScenePool({ hosts, isVisible, onActivity }) {
  let THREE
  let RoomEnvironment
  let RoundedBoxGeometry
  let MarchingCubes
  let SubsurfaceScatteringShader
  let BufferGeometryUtils
  let HorizontalBlurShader
  let VerticalBlurShader
  let RectAreaLightUniformsLib
  let GLTFLoader
  try {
    const [three, environment, roundedBox, marchingCubes, sssShader, geometryUtils, hBlur, vBlur, rectArea, gltf] = await Promise.all([
      import('three'),
      import('three/addons/environments/RoomEnvironment.js'),
      import('three/addons/geometries/RoundedBoxGeometry.js'),
      import('three/addons/objects/MarchingCubes.js'),
      import('three/addons/shaders/SubsurfaceScatteringShader.js'),
      import('three/addons/utils/BufferGeometryUtils.js'),
      import('three/addons/shaders/HorizontalBlurShader.js'),
      import('three/addons/shaders/VerticalBlurShader.js'),
      import('three/addons/lights/RectAreaLightUniformsLib.js'),
      import('three/addons/loaders/GLTFLoader.js')
    ])
    THREE = three
    RoomEnvironment = environment.RoomEnvironment
    RoundedBoxGeometry = roundedBox.RoundedBoxGeometry
    MarchingCubes = marchingCubes.MarchingCubes
    SubsurfaceScatteringShader = sssShader.SubsurfaceScatteringShader
    BufferGeometryUtils = geometryUtils
    HorizontalBlurShader = hBlur.HorizontalBlurShader
    VerticalBlurShader = vBlur.VerticalBlurShader
    RectAreaLightUniformsLib = rectArea.RectAreaLightUniformsLib
    ensureRectAreaLightUniformsInitialized(RectAreaLightUniformsLib)
    GLTFLoader = gltf.GLTFLoader
  } catch (error) {
    console.warn('Shape scenes: three.js could not be loaded.', error)
    return null
  }

  /* The states-of-matter card's ice cube; the card falls back to the
     error-correction ball if the model can't load. */
  let iceGeometry = null
  try {
    iceGeometry = await loadIceCubeGeometry({
      THREE,
      GLTFLoader,
      mergeVertices: BufferGeometryUtils.mergeVertices
    })
  } catch (error) {
    console.warn('Shape scenes: ice cube model unavailable; falling back to the ball.', error)
  }

  let protectionModel = null
  try {
    protectionModel = await loadProtectionMenuModel({ GLTFLoader })
  } catch (error) {
    console.warn('Shape scenes: Module 05 device model unavailable.', error)
  }

  let renderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  } catch (error) {
    console.warn('Shape scenes: WebGL is unavailable.', error)
    return null
  }

  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(1)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.18
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  /* Global scene dials (dev panel). The flag* fields describe a ring of
     black cards baked into the shared environment map — invisible to the
     cameras, but they carve dark streaks into the glossy reflections,
     studio negative-fill style. */
  const sceneParams = {
    exposure: 1.18,
    envIntensity: 0.35,
    flagCount: 0,
    flagSize: 5,
    flagDistance: 6.5,
    flagHeight: 1.5,
    flagAngle: 0,
    flagTilt: 0,
    envBlur: 0.04
  }

  const buildEnvironmentTexture = generator => {
    const envScene = new RoomEnvironment()
    if (sceneParams.flagCount > 0) {
      const flagMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 })
      for (let index = 0; index < sceneParams.flagCount; index += 1) {
        const flag = new THREE.Mesh(
          new THREE.PlaneGeometry(sceneParams.flagSize, sceneParams.flagSize * 1.6),
          flagMaterial
        )
        const angle = (index / sceneParams.flagCount) * Math.PI * 2 +
          THREE.MathUtils.degToRad(sceneParams.flagAngle)
        flag.position.set(
          Math.cos(angle) * sceneParams.flagDistance,
          sceneParams.flagHeight,
          Math.sin(angle) * sceneParams.flagDistance
        )
        flag.lookAt(0, sceneParams.flagHeight * 0.5, 0)
        flag.rotation.z += THREE.MathUtils.degToRad(sceneParams.flagTilt)
        envScene.add(flag)
      }
    }
    const target = generator.fromScene(envScene, sceneParams.envBlur)
    envScene.dispose?.()
    return target
  }

  /* States-of-matter only: its ice cube gets a dedicated environment with a
     single horizontal black flag — one dark band swept across the glossy
     reflections instead of the ring above. */
  const iceFlagParams = {
    enabled: true,
    width: 12,
    height: 2.5,
    distance: 6,
    elevation: 1.2,
    yaw: 0,
    pitch: 0
  }
  /* One source of truth for where the flag sits: the PMREM bake below puts
     the real card there for the gloss shell, and the ice shader's analytic
     blob is aimed at the same spot so the refracting body agrees with it. */
  const iceFlagPosition = () => {
    const yaw = THREE.MathUtils.degToRad(iceFlagParams.yaw)
    return new THREE.Vector3(
      Math.cos(yaw) * iceFlagParams.distance,
      iceFlagParams.elevation,
      Math.sin(yaw) * iceFlagParams.distance
    )
  }
  const iceReflectorSpec = () => ({
    position: iceFlagPosition(),
    width: iceFlagParams.width,
    height: iceFlagParams.height,
    enabled: iceFlagParams.enabled
  })
  const buildIceEnvironmentTexture = generator => {
    const envScene = new RoomEnvironment()
    if (iceFlagParams.enabled) {
      const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(iceFlagParams.width, iceFlagParams.height),
        new THREE.MeshBasicMaterial({ color: 0x000000 })
      )
      flag.position.copy(iceFlagPosition())
      flag.lookAt(0, iceFlagParams.elevation, 0)
      /* pitch -90 lays the card flat like a ceiling flag. */
      flag.rotateX(THREE.MathUtils.degToRad(iceFlagParams.pitch))
      envScene.add(flag)
    }
    const target = generator.fromScene(envScene, sceneParams.envBlur)
    envScene.dispose?.()
    return target
  }

  const pmrem = new THREE.PMREMGenerator(renderer)
  let environmentRenderTarget = buildEnvironmentTexture(pmrem)
  let environmentTexture = environmentRenderTarget.texture
  let iceEnvironmentRenderTarget = buildIceEnvironmentTexture(pmrem)
  let iceEnvironmentTexture = iceEnvironmentRenderTarget.texture
  const environmentFor = moduleId =>
    moduleId === 'states-of-matter' ? iceEnvironmentTexture : environmentTexture

  /* Shared across all card previews: the hex-ball geometry is built once and
     cloned per scene; the brushed reflection map feeds every gloss coat. */
  const ballTemplate = createBallTemplate(THREE, BufferGeometryUtils)
  const brushedEnvironment = createBrushedEnv(THREE, pmrem)
  const brushedEnv = brushedEnvironment.texture

  /* Contact-shadow pipeline (after webgl_shadow_contact), shared materials. */
  const contactDepthMat = new THREE.MeshDepthMaterial()
  contactDepthMat.userData.darkness = { value: 0.9 }
  contactDepthMat.onBeforeCompile = shader => {
    shader.uniforms.darkness = contactDepthMat.userData.darkness
    shader.fragmentShader = 'uniform float darkness;\n' + shader.fragmentShader.replace(
      'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
      'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );'
    )
  }
  contactDepthMat.depthTest = false
  contactDepthMat.depthWrite = false
  const contactHBlur = new THREE.ShaderMaterial(HorizontalBlurShader)
  contactHBlur.depthTest = false
  const contactVBlur = new THREE.ShaderMaterial(VerticalBlurShader)
  contactVBlur.depthTest = false

  /* Kiosk hardening: survive GPU resets. three.js re-uploads geometry and
     textures itself, but the PMREM environment must be regenerated. */
  renderer.domElement.addEventListener('webglcontextlost', event => event.preventDefault())
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    try {
      const regenerator = new THREE.PMREMGenerator(renderer)
      /* The old render targets died with the context; just replace them. */
      environmentRenderTarget = buildEnvironmentTexture(regenerator)
      environmentTexture = environmentRenderTarget.texture
      iceEnvironmentRenderTarget = buildIceEnvironmentTexture(regenerator)
      iceEnvironmentTexture = iceEnvironmentRenderTarget.texture
      for (const entry of entries) entry.scene.environment = environmentFor(entry.moduleId)
      regenerator.dispose()
      console.info('Shape scenes: WebGL context restored.')
    } catch (error) {
      console.warn('Shape scenes: context restore failed.', error)
    }
  })

  const frustumHeight = 2 * CAMERA_DISTANCE * Math.tan(THREE.MathUtils.degToRad(FOV_DEGREES / 2))
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

  /* Defaults tuned live with the dev material panel (2026-08-07). Every
     scene gets its own copy of these params plus its own uniform set, so
     each nav card can be lit and finished independently. */
  const groundParams = {
    sideRatio: MODULE_NAVIGATION_GRID.sideRatio,
    thicknessRatio: MODULE_NAVIGATION_GRID.thicknessRatio,
    heightRatio: MODULE_NAVIGATION_GRID.heightRatio
  }
  const defaultMaterialParams = {
    alphaBase: 1,
    rim: 0.3,
    irid: 1,
    spec: 0.7,
    contrast: 1.5,
    diffuseMix: 0.17,
    shadowSide: 0.8,
    specColor: '#ffffff',
    rimColor: '#eaf6ff',
    envWash: 1,
    grain: 1,
    gloss: 0.45
  }
  const defaultLightParams = {
    dirX: -0.42,
    dirY: 0.85,
    dirZ: 0.55,
    keyIntensity: BALL_KEY_LIGHT.intensity,
    keyColor: `#${new THREE.Color(BALL_KEY_LIGHT.color).getHexString()}`,
    /* Key/area light placement (panel-tuned 2026-08-07); the area light
       re-aims at the origin whenever it moves. */
    keyX: -3.8,
    keyY: 7,
    keyZ: -2.4,
    hemiIntensity: 0.5,
    hemiSky: '#f2f5fa',
    hemiGround: '#c9cdd4',
    /* Accent point lights (teal glint + white fill) and the sphere's inner
       light; intensities are base values, scaled per scene by lightScale².
       Positions are offsets from the ball's rest point in accent space
       (panel-tuned 2026-08-07, like the key placement above). */
    accent1Color: BALL_ACCENT_LIGHTS[0].color,
    accent1Intensity: 4.4,
    accent1X: BALL_ACCENT_LIGHTS[0].position[0],
    accent1Y: BALL_ACCENT_LIGHTS[0].position[1],
    accent1Z: BALL_ACCENT_LIGHTS[0].position[2],
    accent2Color: BALL_ACCENT_LIGHTS[1].color,
    accent2Intensity: 4.7,
    accent2X: BALL_ACCENT_LIGHTS[1].position[0],
    accent2Y: BALL_ACCENT_LIGHTS[1].position[1],
    accent2Z: BALL_ACCENT_LIGHTS[1].position[2],
    innerColor: BALL_CONFIG.innerLight.color,
    innerIntensity: 1.42,
    /* Key light as a soft rectangular area light instead of a directional.
       Affects the light-responsive materials (the hex ball); the stylized
       shapes are lit by the shader's dir sliders. */
    areaKey: true,
    areaSize: 6.8
  }
  /* Per-module rig overrides. States-of-matter mirrors the ice shader
     playground's setup (playground/ice-block.html): plain white directional
     key, soft hemisphere — no red area key. */
  const MODULE_LIGHT_OVERRIDES = {
    'build-nanowire': NANOWIRE_MENU_LIGHTING,
    nanoscale: {
      /* Preserve the complete error-correction rig, changing only the tint
         sources that turned the authored blue material violet. */
      keyColor: '#ffffff',
      accent1Color: '#49C5B1',
      innerColor: '#0078D4'
    },
    'states-of-matter': {
      areaKey: false,
      keyColor: '#ffffff',
      /* The playground's key. It had been zeroed here, which left the ice
         with no speculars, no crack glow and no sun lobe in its fog — the
         single biggest reason the menu cube read flatter than the study. */
      keyIntensity: 1.2,
      keyX: 2.4,
      keyY: 3,
      keyZ: 2,
      hemiIntensity: 0.45
    },
    /* Module 09's plate is lit from over the visitor's right shoulder, not the
       left: on every sphere in it the brightest point sits at 0.54 right and
       0.76 up from the centre, which is this direction. World-space, so
       turning the column moves the lit side rather than carrying it round. */
    'quantum-platform': {
      dirX: 0.54,
      dirY: 0.76,
      dirZ: 0.36
    }
  }

  /* Per-module finish overrides, the material-side companion to the light rig
     above. The floor's objects are pearls — iridescent, glossy, sparkling —
     and Module 09's are not: the plate draws flat matte balls with one broad
     soft gradient and no highlight of their own. */
  const MODULE_MATERIAL_OVERRIDES = {
    'quantum-platform': {
      /* Shading comes from the directional term alone: no matte blend, no
         studio wash, and none of the pearl finish. `contrast` is the one that
         matters — it sets how far the surface swings either side of its tone,
         and 0.58 is the plate's own light-to-shade ratio of about 1.44. */
      contrast: 0.58,
      diffuseMix: 0,
      envWash: 0,
      irid: 0,
      spec: 0,
      gloss: 0,
      rim: 0,
      /* The negative fill darkens toward the bottom right; on this rig that is
         the lit side, so it would be cutting into the highlight. */
      shadowSide: 0,
      grain: 0
    }
  }

  const applyMaterialParams = (uniforms, params) => {
    uniforms.uAlphaBase.value = params.alphaBase
    uniforms.uRimStrength.value = params.rim
    uniforms.uIrid.value = params.irid
    uniforms.uSpec.value = params.spec
    uniforms.uContrast.value = params.contrast
    uniforms.uDiffuseMix.value = params.diffuseMix
    uniforms.uShadowSide.value = params.shadowSide
    uniforms.uRim.value.set(params.rimColor)
    uniforms.uSpecColor.value.set(params.specColor)
    uniforms.uEnvWash.value = params.envWash
    uniforms.uGrain.value = params.grain
    uniforms.uGloss.value = params.gloss
  }
  const createUniformSet = params => {
    const uniforms = {
      uAlphaBase: { value: 0 },
      uRimStrength: { value: 0 },
      uIrid: { value: 0 },
      uSpec: { value: 0 },
      uContrast: { value: 0 },
      uDiffuseMix: { value: 0 },
      uShadowSide: { value: 0 },
      uRim: { value: new THREE.Color() },
      uSpecColor: { value: new THREE.Color() },
      uEnvWash: { value: 1 },
      uGrain: { value: 1 },
      uGloss: { value: 0 },
      uDotColor: { value: new THREE.Color('#40f296') },
      uLightDir: {
        value: new THREE.Vector3(
          defaultLightParams.dirX,
          defaultLightParams.dirY,
          defaultLightParams.dirZ
        )
      }
    }
    applyMaterialParams(uniforms, params)
    return uniforms
  }

  const tintSoftMaterial = (target, colorHex) => {
    const base = new THREE.Color(colorHex)
    target.uniforms.uLight.value.copy(base.clone().offsetHSL(0, 0.04, 0.14))
    target.uniforms.uShadow.value.copy(
      base.clone().offsetHSL(0.03, 0.08, -0.3).lerp(new THREE.Color('#241c3e'), 0.3)
    )
  }

  /* Pushes an entry's lightParams onto its actual light objects. Runs once
     when a scene is built (so tuned defaults land) and again on every dev
     panel edit via setLightsFor. */
  const applyLightParams = entry => {
    const lights = entry.lightParams
    entry.scene.environmentIntensity = Number.isFinite(lights.environmentIntensity)
      ? lights.environmentIntensity
      : sceneParams.envIntensity
    entry.uniforms.uLightDir.value.set(lights.dirX, lights.dirY, lights.dirZ)
    if (lights.areaKey && !entry.areaLight) {
      entry.areaLight = new THREE.RectAreaLight(
        lights.keyColor,
        lights.keyIntensity,
        lights.areaSize,
        lights.areaSize
      )
      entry.scene.add(entry.areaLight)
    }
    entry.keyLight.visible = !lights.areaKey
    entry.keyLight.intensity = lights.keyIntensity
    entry.keyLight.color.set(lights.keyColor)
    entry.keyLight.position.set(lights.keyX, lights.keyY, lights.keyZ)
    if (entry.areaLight) {
      entry.areaLight.visible = lights.areaKey
      entry.areaLight.intensity = lights.keyIntensity
      entry.areaLight.color.set(lights.keyColor)
      entry.areaLight.width = lights.areaSize
      entry.areaLight.height = lights.areaSize
      entry.areaLight.position.copy(entry.keyLight.position)
      entry.areaLight.lookAt(0, 0, 0)
    }
    entry.hemiLight.intensity = lights.hemiIntensity
    entry.hemiLight.color.set(lights.hemiSky)
    entry.hemiLight.groundColor.set(lights.hemiGround)
    const scaleSq = entry.lightScale * entry.lightScale
    /* Only the first two accents are panel-addressable (accent1/accent2). */
    entry.accentLights.slice(0, 2).forEach((light, index) => {
      const n = index + 1
      light.color.set(lights[`accent${n}Color`])
      light.intensity = lights[`accent${n}Intensity`] * scaleSq
      const anchor = light.userData.anchor
      if (anchor) {
        light.position.set(
          anchor.baseX + lights[`accent${n}X`] * anchor.scale,
          anchor.baseY + lights[`accent${n}Y`] * anchor.scale,
          lights[`accent${n}Z`] * anchor.scale
        )
      }
    })
    for (const inner of entry.innerLights) {
      inner.color.set(lights.innerColor)
      inner.intensity = lights.innerIntensity * scaleSq
    }
    /* The ice shader lights itself from these uniforms: aim its key at the
       same place as the scene's key light so the panel drives both. The
       colour stays white — the scene's red studio key would tint the
       interior crack glow pink. */
    for (const ice of entry.iceUniforms ?? []) {
      ice.uKeyDir.value.set(lights.keyX, lights.keyY, lights.keyZ).normalize()
      ice.uKeyIntensity.value = lights.keyIntensity * 0.75
    }
  }

  const raycaster = new THREE.Raycaster()
  const pointerNdc = new THREE.Vector2()
  const confettiDummy = new THREE.Object3D()
  let lastInteractionAt = performance.now()
  let lastSelfPokeAt = 0

  const pulseShape = () => {
    /* Pulse-scaling on tap is retired: the spring sway is response enough. */
  }

  const applyShapeTint = (shape, colorHex) => {
    const base = new THREE.Color(colorHex)
    shape.material.uniforms.uLight.value.copy(base.clone().offsetHSL(0, 0.04, 0.14))
    shape.material.uniforms.uShadow.value.copy(
      base.clone().offsetHSL(0.03, 0.08, -0.3).lerp(new THREE.Color('#241c3e'), 0.3)
    )
  }

  const launchConfetti = entry => {
    if (!entry.confetti) {
      const mesh = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.055, 10, 8),
        createSoftMaterial(THREE, MAGENTA, entry.uniforms),
        48
      )
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.visible = false
      entry.scene.add(mesh)
      entry.confetti = { mesh, particles: [], endAt: 0 }
    }
    entry.confetti.particles = Array.from({ length: 48 }, () => ({
      x: (Math.random() - 0.5) * 2.6,
      y: 2.4 + Math.random() * 1.4,
      z: (Math.random() - 0.5) * 1.6,
      vx: (Math.random() - 0.5) * 1.6,
      vy: -0.2 - Math.random() * 0.8,
      vz: (Math.random() - 0.5) * 1.2,
      size: 0.5 + Math.random()
    }))
    entry.confetti.endAt = performance.now() + 3600
    entry.confetti.mesh.visible = true
  }

  const pokeScene = (entry, clientX, clientY) => {
    const rect = entry.host.getBoundingClientRect()
    if (rect.width < 2) return
    pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    )
    raycaster.setFromCamera(pointerNdc, entry.camera)
    const hits = raycaster.intersectObject(entry.stage, true)
    let hitShape = null
    let node = hits[0]?.object ?? null
    while (node && !hitShape) {
      hitShape = entry.shapes.find(shape => shape.group === node) ?? null
      node = node.parent
    }

    const moduleId = entry.host.closest('[data-module-id]')?.dataset.moduleId

    if (hitShape) {
      pulseShape(hitShape)
      if (!hitShape.ball) {
        hitShape.carouselSpring.velocity += 3.6 * hitShape.carouselSpring.response
      }

      /* Micro-toys: scene-specific reactions to poking the right object. */
      if (
        moduleId === 'protecting-information' &&
        hitShape.def.color === MAGENTA &&
        !hitShape.healed
      ) {
        /* Healing the noisy qubit: it turns blue like its corrected neighbours. */
        hitShape.healed = true
        applyShapeTint(hitShape, BLUE)
        sound.chime()
      } else if (moduleId === 'states-of-matter' && hitShape.loop?.kind === 'rise') {
        /* Popping a vapour bubble hides it until its next cycle. */
        const dur = hitShape.loop.dur ?? 5
        const local = entry.lastLocalSeconds ?? 0
        const cycle = (((local / dur + (hitShape.loop.phase ?? 0)) % 1) + 1) % 1
        hitShape.hiddenUntil = local + (1 - cycle) * dur
        sound.pop()
      } else {
        sound.pop()
      }

      /* Ripple outward to the neighbours. */
      entry.shapes.forEach((shape, rippleIndex) => {
        if (shape === hitShape || shape.ball) return
        window.setTimeout(() => {
          shape.carouselSpring.velocity +=
            (rippleIndex % 2 === 0 ? 1 : -1) * 1.2 * shape.carouselSpring.response
        }, 70 + rippleIndex * 45)
      })
    } else {
      entry.shapes.forEach((shape, shapeIndex) => {
        if (shape.ball) return
        shape.carouselSpring.velocity +=
          (shapeIndex % 2 === 0 ? 1 : -1) *
          (2.4 + (shapeIndex % 3) * 0.7) *
          shape.carouselSpring.response
      })
      sound.pop()
    }
  }

  const entries = hosts.map((host, hostIndex) => {
    const defs = host.gridOnly ? [] : SCENE_DEFS[host.moduleId]
    if (!defs) return null
    const allowsUserOrbit = !host.gridOnly && allowsShapeSceneUserOrbit(host.moduleId)

    /* Per-scene copies: the dev panel tunes each card independently. */
    const entryMaterialParams = {
      ...defaultMaterialParams,
      ...MODULE_MATERIAL_OVERRIDES[host.moduleId]
    }
    const entryLightParams = {
      ...defaultLightParams,
      ...MODULE_LIGHT_OVERRIDES[host.moduleId]
    }
    const entryUniforms = createUniformSet(entryMaterialParams)
    const accentLights = []
    const drawnShadows = []
    const entryIceUniforms = []
    let entryLightScale = 1

    const rect = host.element.getBoundingClientRect()
    const aspect = rect.height > 0 ? rect.width / rect.height : 1.27
    const gridLayout = getModuleNavigationGridLayout({ aspect, ground: groundParams })
    const frustumWidth = gridLayout.frustumWidth

    const scene = new THREE.Scene()
    scene.environment = environmentFor(host.moduleId)
    scene.environmentIntensity = 0.35

    const stage = new THREE.Group()
    scene.add(stage)

    const cameraHeight = defs[0]?.cameraHeight ?? CAMERA_HEIGHT
    const cameraLookAtY = defs[0]?.cameraLookAtY ?? MODULE_NAVIGATION_PROJECTION.lookAtY
    const camera = new THREE.PerspectiveCamera(
      FOV_DEGREES,
      aspect,
      MODULE_NAVIGATION_PROJECTION.near,
      MODULE_NAVIGATION_PROJECTION.far
    )
    camera.position.set(0, cameraHeight, CAMERA_DISTANCE)
    camera.lookAt(0, cameraLookAtY, 0)

    /* The scene's key rig: red key (area or directional) and soft hemisphere
       fill. applyLightParams below lands the tuned defaults on it. Ground
       shadowing comes from the blurred contact-shadow pass. */
    const keyLight = new THREE.DirectionalLight()
    const hemiLight = new THREE.HemisphereLight()
    scene.add(keyLight, hemiLight)

    const groundPlacement = {
      side: gridLayout.groundSide,
      y: gridLayout.groundY
    }
    const groundThickness = gridLayout.groundThickness
    const ground = new THREE.Mesh(
      new RoundedBoxGeometry(
        groundPlacement.side,
        groundThickness,
        groundPlacement.side,
        3,
        groundThickness * 0.45
      ),
      /* Light theme: the plinth is invisible and only catches the soft shadow. */
      new THREE.ShadowMaterial({ opacity: 0.16 })
    )
    ground.position.y = groundPlacement.y
    ground.receiveShadow = true
    ground.visible = false // shadowing moved to the contact-shadow pass
    stage.add(ground)

    /* Grid floor fading at the edges, matching the concept-module scene. */
    const groundDrop = gridLayout.groundDrop
    /* One navigation floor across the full carousel. Per-module opacity made
       identical geometry read like separate stages (dim in 04, absent in 05). */
    const gridOpacity = gridLayout.opacity
    const gridMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(gridLayout.side, gridLayout.side),
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: {
            value: new THREE.Color(MODULE_NAVIGATION_GRID.color).convertSRGBToLinear()
          },
          uSpacing: { value: gridLayout.spacing },
          uOpacity: { value: gridOpacity },
          uFadeRadius: { value: gridLayout.fadeRadius }
        },
        transparent: true,
        depthWrite: false,
        vertexShader: /* glsl */ `
          varying vec3 vWorldPos;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorldPos = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vWorldPos;
          uniform vec3 uColor;
          uniform float uSpacing, uOpacity, uFadeRadius;
          void main() {
            /* grid pattern rotated 45 degrees */
            vec2 p = vec2(vWorldPos.x - vWorldPos.z, vWorldPos.x + vWorldPos.z) * 0.7071068;
            vec2 coord = p / uSpacing;
            vec2 g = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
            float line = 1.0 - min(min(g.x, g.y), 1.0);
            float fade = 1.0 - smoothstep(
              uFadeRadius * ${gridLayout.fadeInnerRatio.toFixed(2)},
              uFadeRadius,
              length(vWorldPos.xz)
            );
            gl_FragColor = vec4(uColor, line * fade * uOpacity);
          }
        `
      })
    )
    gridMesh.rotation.x = -Math.PI / 2
    gridMesh.position.y = gridLayout.gridY
    gridMesh.visible = gridOpacity > 0
    scene.add(gridMesh)


    const shapes = defs.map((def, shapeIndex) => {
      const radius = ((def.s / 100) * frustumWidth) / 2
      let material = null
      let group
      let ball = null

      if (def.type === 'ice' && iceGeometry) {
        /* States of matter: the Ice+Cube chunk under the procedural ice
           shader. Wrapped so the pool's per-frame scale animation doesn't
           stomp the radius fit baked into the inner group. */
        const ice = createIceCube({ THREE, geometry: iceGeometry, radius })
        applyIceReflector(ice.uniforms, iceReflectorSpec())
        ice.iceMesh.castShadow = true
        group = new THREE.Group()
        group.add(ice.group)
        group.userData.update = seconds => ice.update(seconds, camera)
        group.userData.dispose = () => ice.dispose()
        entryIceUniforms.push(ice.uniforms)
      } else if (def.type === 'sphere' || def.type === 'ice') {
        /* Every other card preview is the error-correction ball. */
        const ballScale = radius / BALL_RADIUS
        ball = createErrorCorrectionBall({
          THREE,
          SubsurfaceScatteringShader,
          template: ballTemplate,
          brushedEnv,
          viewDir: new THREE.Vector3(0, 0.25, 1).normalize(),
          lightScale: ballScale,
          palette: def.ballPalette,
          timing: def.ballTiming,
          onPhase: def.showStatus === false ? undefined : bindBallStatusPill(host)
        })
        ball.group.scale.setScalar(ballScale)
        ball.tileMesh.castShadow = true
        ball.coreMesh.castShadow = true
        /* Outer wrapper so the pool's per-frame scale animation doesn't
           stomp the radius fit baked into the inner group. */
        group = new THREE.Group()
        group.add(ball.group)
        group.userData.update = seconds => ball.update(seconds)
      } else if (def.type === 'topoconductor') {
        group = createQubitNavPreview({
          THREE,
          RoundedBoxGeometry,
          radius,
          brushedEnv,
          SubsurfaceScatteringShader
        })
        group.traverse(node => {
          if (node.isMesh && !node.userData.noShadow) node.castShadow = true
        })
      } else if (def.type === 'quantum-computer') {
        group = createQuantumComputerMenuObject({ radius })
      } else if (def.type === 'nanowire') {
        group = createNanowireMenuObject(THREE, radius, {
          brushedEnv,
          SubsurfaceScatteringShader
        })
        group.traverse(node => {
          if (node.isMesh && !node.userData.noShadow) node.castShadow = true
        })
      } else if (def.type === 'protection-core') {
        group = createProtectionMenuObject({
          THREE,
          RoundedBoxGeometry,
          radius,
          brushedEnv,
          modelTemplate: protectionModel
        })
        group.traverse(node => {
          if (node.isMesh && !node.userData.noShadow) node.castShadow = true
        })
      } else {
        material = createSoftMaterial(THREE, def.color, entryUniforms, {
          qubitLines: def.type === 'qubit' || def.type === 'bloch'
        })
        group = buildShapeMesh(
          THREE,
          RoundedBoxGeometry,
          def,
          radius,
          material,
          (tint, options) => createSoftMaterial(THREE, tint, entryUniforms, options),
          { template: ballTemplate, brushedEnv, SubsurfaceScatteringShader }
        )
        if (def.type === 'blob') {
          buildMeltBlob(THREE, MarchingCubes, group, radius, material)
        }
        group.traverse(node => {
          if (node.isMesh && !node.userData.noShadow) node.castShadow = true
        })
        if (def.loop?.kind === 'melt') {
          material.uniforms.uMeltHalf.value = radius * 0.85
        }
      }
      const baseX = ((def.x / 100) - 0.5) * frustumWidth * COMPOSITION_SQUEEZE_X
      const baseY =
        (0.5 - (def.y / 100) * COMPOSITION_BAND - COMPOSITION_SHIFT_Y) * frustumHeight
      group.position.set(baseX, baseY, 0)
      if (def.type === 'blob') {
        /* How far the melt has to sink for the puddle to rest on the platform. */
        group.userData.meltDropDistance =
          groundPlacement.y + groundThickness / 2 - baseY + radius * 1.15 * 0.42
      }
      stage.add(group)
      if (ball || def.type === 'bloch' || group.userData.useOpticalRig) {
        /* The ball's accent lights are camera-static (never orbit), placed
           around the sphere's rest position and scaled with it. The teal one
           is what glints green off the gloss coat. */
        const s = radius / BALL_RADIUS
        entryLightScale = s
        for (const accent of BALL_ACCENT_LIGHTS) {
          const light = new THREE.PointLight(accent.color, accent.intensity * s * s, 0, 2)
          light.position.set(
            baseX + accent.position[0] * s,
            baseY + accent.position[1] * s,
            accent.position[2] * s
          )
          /* The panel repositions accents in accent space (offsets from the
             ball's rest point); remember the anchor that maps them back. */
          light.userData.anchor = { baseX, baseY, scale: s }
          scene.add(light)
          accentLights.push(light)
        }
      }
      const carouselSpring = createCarouselSpring(def.s)
      return {
        group,
        ball,
        baseX,
        baseY,
        amplitude: ((def.drift ?? 14) / 1120) * frustumHeight,
        angularSpeed: (Math.PI * 2) / (def.dur ?? 6),
        phase: -(def.delay ?? 0) * ((Math.PI * 2) / (def.dur ?? 6)),
        spin: def.spin ?? 0,
        isCore: def.core === true,
        introDelay: 0.15 + shapeIndex * 0.07,
        introPlayed: false,
        pulseStart: 0,
        hiddenUntil: 0,
        healed: false,
        def,
        material,
        carouselSpring,
        loop: def.loop ?? null
      }
    })

    /* A drawn ground shadow, for objects the rendered one cannot serve. The
       rendered contact shadow works by reading an object's depth from just
       under the floor, which needs the object to be sitting more or less on
       it; a tall column floating above the plane projects almost nothing.

       So this one is painted rather than derived — the same soft ellipse the
       board's own artwork carries, at the profile measured off it: peaking at
       21% black and easing to nothing at the rim. It is a circle on the
       ground, so the camera's own 11-degree pitch is what flattens it to the
       ellipse the plate draws, and turning the object leaves it unchanged. */
    for (const shape of shapes) {
      const spec = shape.def.groundShadow
      if (!spec) continue
      const canvas = document.createElement('canvas')
      canvas.width = 128
      canvas.height = 128
      const paint = canvas.getContext('2d')
      const falloff = paint.createRadialGradient(64, 64, 0, 64, 64, 64)
      for (const [stop, darkness] of GROUND_SHADOW_PROFILE) {
        falloff.addColorStop(stop, `rgba(0, 0, 0, ${(darkness * spec.opacity).toFixed(4)})`)
      }
      paint.fillStyle = falloff
      paint.fillRect(0, 0, 128, 128)
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      const diameter = spec.widthRatio * ((shape.def.s / 100) * frustumWidth)
      const disc = new THREE.Mesh(
        new THREE.PlaneGeometry(diameter, diameter).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })
      )
      disc.renderOrder = 1
      /* Nudged toward the visitor along the floor rather than dropped below
         it: the shadow stays welded to the ground plane the grid establishes,
         and the camera's downward pitch is what turns that into sitting lower
         under the object. */
      disc.position.set(
        shape.baseX,
        groundPlacement.y - groundThickness - groundDrop + 0.004,
        (spec.forward ?? 0) * diameter
      )
      scene.add(disc)
      drawnShadows.push(disc)
    }

    /* Contact shadow: render the ball's depth from under the floor, blur it,
       and use it as the ground shadow texture — same look as the module view. */
    const ballShape = shapes.find(
      shape =>
        shape.ball ||
        shape.def.type === 'bloch' ||
        shape.def.type === 'ice' ||
        shape.def.type === 'topoconductor' ||
        shape.def.type === 'protection-core' ||
        shape.def.type === 'nanowire'
    )
    let contactShadow = null
    if (ballShape) {
      const ballScale = ((ballShape.def.s / 100) * frustumWidth) / 2 / BALL_RADIUS
      if (ballShape.ball) {
        ballShape.ball.tileMesh.layers.enable(1)
        ballShape.ball.coreMesh.layers.enable(1)
      } else {
        ballShape.group.traverse(node => {
          if (node.isMesh && !node.userData.noShadow) node.layers.enable(1)
        })
      }
      const size = (ballShape.def.contactShadowScale ?? 3.4) * ballScale
      const groundY = groundPlacement.y - groundThickness - groundDrop + 0.002
      const rt = new THREE.WebGLRenderTarget(256, 256)
      rt.texture.generateMipmaps = false
      const rtBlur = new THREE.WebGLRenderTarget(256, 256)
      rtBlur.texture.generateMipmaps = false
      const planeGeo = new THREE.PlaneGeometry(size, size).rotateX(Math.PI / 2)
      const plane = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({
        map: rt.texture,
        transparent: true,
        opacity: 0.32,
        depthWrite: false
      }))
      plane.scale.y = -1
      plane.renderOrder = 1
      plane.position.set(ballShape.baseX, groundY, 0)
      const blurPlane = new THREE.Mesh(planeGeo)
      blurPlane.visible = false
      blurPlane.layers.enable(1)
      blurPlane.position.copy(plane.position)
      const cam = new THREE.OrthographicCamera(
        -size / 2, size / 2, size / 2, -size / 2,
        0, ballShape.baseY + BALL_RADIUS * ballScale * 1.3 - groundY
      )
      cam.position.set(ballShape.baseX, groundY, 0)
      cam.rotation.x = Math.PI / 2
      cam.layers.set(1)
      scene.add(plane, blurPlane, cam)
      contactShadow = { rt, rtBlur, plane, blurPlane, cam, planeGeo }
    }

    const canvas = document.createElement('canvas')
    canvas.className = 'module-card__scene-canvas'
    canvas.dataset.userOrbit = String(allowsUserOrbit)
    host.element.append(canvas)

    /* Inner point lights live inside the shape groups (ball and bloch). */
    const innerLights = []
    for (const shape of shapes) {
      shape.group.traverse(node => {
        if (node.isPointLight) innerLights.push(node)
      })
    }

    const sceneEntry = {
      contactShadow,
      drawnShadows,
      host: host.element,
      moduleId: host.moduleId,
      materialParams: entryMaterialParams,
      lightParams: entryLightParams,
      uniforms: entryUniforms,
      iceUniforms: entryIceUniforms,
      keyLight,
      hemiLight,
      areaLight: null,
      accentLights,
      innerLights,
      lightScale: entryLightScale,
      scene,
      camera,
      shapes,
      frustumWidth,
      stage,
      allowsUserOrbit,
      cameraHeight,
      cameraLookAtY,
      lockPitch: shapes.some(shape => shape.group.userData.lockMenuPitch),
      /* A scene opts out of the idle turntable with `autoRotate: false` in its
         def. It used to be a moduleId check for build-nanowire alone; reading it
         from the def means a new scene declares its own behaviour instead of
         this list growing. Pointer orbit is separate — see userOrbit. */
      orbitSpeed: !host.gridOnly && allowsShapeSceneAutoRotate(host.moduleId)
        ? (hostIndex % 2 === 0 ? 1 : -1) * 0.11
        : 0,
      /* The angle the scene rests at, and the one a non-rotating scene simply
         keeps. Per-def, defaulting to the shared three-quarter pose — this too
         was a moduleId check for build-nanowire before. */
      startAngle: defs[0]?.startAngle ?? SCENE_START_ANGLE,
      userYaw: 0,
      userPitch: 0,
      yawVelocity: 0,
      spinAccum: 0,
      lastLocalSeconds: 0,
      floorTopY: groundPlacement.y + groundThickness / 2,
      ground,
      groundBaseY: ground.position.y,
      groundPhase: hostIndex * 1.3,
      canvas,
      context: canvas.getContext('2d')
    }

    /* Orbitable scenes consume a drag. Static previews leave it untouched so
       the parent carousel can still interpret the same gesture as a swipe. */
    canvas.addEventListener('pointerdown', event => {
      if (!sceneEntry.allowsUserOrbit) return
      if (event.button !== 0) return
      event.stopPropagation()
      onActivity?.()
      lastInteractionAt = performance.now()
      const pointerId = event.pointerId
      const startX = event.clientX
      const startY = event.clientY
      const startedAt = performance.now()
      const startYaw = sceneEntry.userYaw
      const startPitch = sceneEntry.userPitch
      let moved = false
      let lastMoveX = startX
      let lastMoveAt = startedAt
      let flickVelocity = 0
      sceneEntry.yawVelocity = 0
      const dragFactor = 5 / Math.max(200, sceneEntry.host.getBoundingClientRect().width)
      const handleMove = moveEvent => {
        if (moveEvent.pointerId !== pointerId) return
        if (
          Math.abs(moveEvent.clientX - startX) > 8 ||
          Math.abs(moveEvent.clientY - startY) > 8
        ) moved = true
        const moveAt = performance.now()
        const moveDt = Math.max(1, moveAt - lastMoveAt)
        flickVelocity = ((moveEvent.clientX - lastMoveX) * dragFactor * 1000) / moveDt
        sceneEntry.spinAccum += Math.abs(moveEvent.clientX - lastMoveX) * dragFactor
        lastMoveX = moveEvent.clientX
        lastMoveAt = moveAt
        sceneEntry.userYaw = startYaw + (moveEvent.clientX - startX) * dragFactor
        sceneEntry.userPitch = sceneEntry.lockPitch
          ? 0
          : Math.max(-0.55, Math.min(0.75,
              startPitch + (moveEvent.clientY - startY) * dragFactor * 0.7
            ))
      }
      const cleanupDrag = () => {
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', stopDrag)
        window.removeEventListener('pointercancel', stopDrag)
        if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId)
        sceneEntry.stopPointerDrag = null
      }
      const stopDrag = endEvent => {
        if (endEvent?.pointerId !== undefined && endEvent.pointerId !== pointerId) return
        cleanupDrag()
        lastInteractionAt = performance.now()
        if (!moved && performance.now() - startedAt < 350) {
          /* Quick tap: poke what was actually touched. */
          pokeScene(sceneEntry, startX, startY)
        } else if (moved && performance.now() - lastMoveAt < 90) {
          /* Released while still moving: throw the diorama with momentum. */
          sceneEntry.yawVelocity = Math.max(-9, Math.min(9, flickVelocity))
        }
      }
      sceneEntry.stopPointerDrag?.()
      sceneEntry.stopPointerDrag = cleanupDrag
      try {
        canvas.setPointerCapture?.(pointerId)
      } catch {
        /* Synthetic pointers and older kiosk engines may not support capture. */
      }
      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', stopDrag)
      window.addEventListener('pointercancel', stopDrag)
    })

    /* Shared surface imperfection on every PBR material in the scene
       (gloss coats, ball core, ...); custom shaders opt in individually. */
    applyImperfectionToObject(scene)

    applyLightParams(sceneEntry)
    return sceneEntry
  }).filter(Boolean)

  if (!entries.length) {
    renderer.dispose()
    pmrem.dispose()
    return null
  }

  /* Front-load shader compilation while the attract screen is up, so the
     first menu frame doesn't stall on compiling every program at once.

     Every card has to be warmed, not just the first. The cards are five
     different scene types — quantum-computer, ball, topoconductor, ice and
     protection-core — and they share no programs, so warming entries[0] only
     covered whichever card happened to sort first and left the rest to
     compile as they scrolled into view. That is the "slow on the first pass
     through the menu, smooth on the second" hitch. */
  try {
    if (typeof renderer.compileAsync === 'function') {
      /* Parallel where the driver supports KHR_parallel_shader_compile, and
         off the main thread either way. */
      await Promise.all(
        entries.map(entry => renderer.compileAsync(entry.scene, entry.camera))
      )
    } else {
      for (const entry of entries) renderer.compile(entry.scene, entry.camera)
    }
  } catch (error) {
    console.warn('Shape scenes: shader warm-up failed.', error)
  }

  let disposed = false
  let lastCenterEntry = null
  const rendererSize = new THREE.Vector2()

  /* Auto-quality governor: when sustained frame time exceeds budget, step down
     render resolution and heavy per-frame work; step back up with hysteresis. */
  const QUALITY_LEVELS = [
    { resolution: 1, blobStride: 1 },
    { resolution: 0.78, blobStride: 2 },
    { resolution: 0.6, blobStride: 3 }
  ]
  let qualityLevel = 0
  let frameTimeEma = 16
  let lastQualityChangeAt = 0
  let lastFrameStamp = 0
  let frameCounter = 0

  const intersectionObserver = new IntersectionObserver(records => {
    for (const record of records) {
      const entry = entries.find(candidate => candidate.host === record.target)
      if (entry) entry.onScreen = record.isIntersecting
    }
  }, { rootMargin: '15%' })
  for (const entry of entries) {
    entry.onScreen = true
    intersectionObserver.observe(entry.host)
  }

  const menuScreen = document.querySelector('.screen--menu')

  const renderFrame = now => {
    if (disposed) return
    window.requestAnimationFrame(renderFrame)
    if (!isVisible()) {
      lastFrameStamp = 0
      return
    }

    frameCounter += 1
    const frameDelta = lastFrameStamp > 0 ? Math.min(0.05, (now - lastFrameStamp) / 1000) : 0.016
    if (lastFrameStamp > 0) {
      /* Clamp the sample so one load hitch or tab stall can't poison the
         average and trigger a spurious quality step-down. */
      frameTimeEma = frameTimeEma * 0.95 + Math.min(100, now - lastFrameStamp) * 0.05
    }
    lastFrameStamp = now
    /* Auto-degradation is deliberately disabled: the menu always renders
       at full quality; performance is tuned by hand instead. The governor
       plumbing stays for reference (frameTimeEma still measures). */
    const quality = QUALITY_LEVELS[qualityLevel]

    const seconds = now / 1000
    const animate = !reducedMotion.matches
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    /* Measure pass: collect on-screen rects and find the centre card. */
    let centerEntry = null
    let centerDistance = Infinity
    const visibleEntries = []
    for (const entry of entries) {
      entry.frameRect = null
      if (!entry.onScreen) continue
      const rect = entry.host.getBoundingClientRect()
      if (
        rect.width < 2 ||
        rect.bottom < 0 ||
        rect.top > window.innerHeight ||
        rect.right < 0 ||
        rect.left > window.innerWidth
      ) continue

      entry.frameRect = rect
      visibleEntries.push(entry)
      const offCenter = Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2)
      if (offCenter < centerDistance) {
        centerDistance = offCenter
        centerEntry = entry
      }
    }

    /* Reset a newly centred scene before its first render. Doing this after
       the render pass exposed one stale frame from the card's previous cycle. */
    if (centerEntry && centerEntry !== lastCenterEntry) {
      centerEntry.sceneEpoch = now / 1000
      centerEntry.userYaw = 0
      centerEntry.userPitch = 0
      centerEntry.yawVelocity = 0
      centerEntry.spinAccum = 0
      for (const shape of centerEntry.shapes) {
        shape.introPlayed = false
        shape.hiddenUntil = 0
        shape.pulseStart = 0
        if (shape.healed) {
          shape.healed = false
          applyShapeTint(shape, shape.def.color)
        }
      }
      lastCenterEntry = centerEntry
    }

    /* One fixed render size for every scene, taken from the centre card so
       the hero diorama maps 1:1 onto device pixels — no upscale blur. The
       blit scales the side cards, and the GL pipeline never flushes on
       per-card size differences mid-slide. */
    let renderWidth = 0
    let renderHeight = 0
    if (centerEntry) {
      renderWidth = Math.max(2, Math.round(centerEntry.frameRect.width * dpr * quality.resolution))
      renderHeight = Math.max(2, Math.round(centerEntry.frameRect.height * dpr * quality.resolution))
      const pixels = renderWidth * renderHeight
      if (pixels > MAX_RENDER_PIXELS) {
        const shrink = Math.sqrt(MAX_RENDER_PIXELS / pixels)
        renderWidth = Math.max(2, Math.round(renderWidth * shrink))
        renderHeight = Math.max(2, Math.round(renderHeight * shrink))
      }
    }

    for (const entry of visibleEntries) {
      const rect = entry.frameRect

      /* Side cards sit dimmed behind the centre card: refresh them at half
         rate and keep every frame for the hero. */
      if (entry !== centerEntry && frameCounter % 2 === 0) continue

      const centerX = rect.left + rect.width / 2
      const dtSeconds = entry.prevFrameAt === undefined ? 0 : (now - entry.prevFrameAt) / 1000
      let slideVelocity = 0
      if (entry.prevCenterX !== undefined && dtSeconds > 0 && dtSeconds < 0.2) {
        const deltaX = centerX - entry.prevCenterX
        /* Dead-band: sub-pixel getBoundingClientRect noise is measurement
           jitter, not a slide — feeding it to the sway springs makes the
           shapes tremble at random. */
        if (Math.abs(deltaX) > 0.5) slideVelocity = deltaX / rect.width / dtSeconds
      }
      entry.prevCenterX = centerX
      entry.prevFrameAt = now

      if (!animate) {
        for (const shape of entry.shapes) shape.group.userData.applyReducedMotion?.()
      }

      if (animate) {
        const dt = Math.min(dtSeconds || 0.033, 0.066)
        const drive = Math.max(-3, Math.min(3, slideVelocity))
        const entrySeconds = seconds - (entry.sceneEpoch ?? 0)
        entry.lastLocalSeconds = entrySeconds

        /* Flick momentum: a thrown diorama keeps spinning and eases out. */
        if (entry.yawVelocity !== 0) {
          entry.userYaw += entry.yawVelocity * frameDelta
          entry.spinAccum += Math.abs(entry.yawVelocity) * frameDelta
          entry.yawVelocity *= Math.pow(0.12, frameDelta)
          if (Math.abs(entry.yawVelocity) < 0.04) entry.yawVelocity = 0
        }
        entry.spinAccum *= Math.pow(0.7, frameDelta)
        if (entry.spinAccum > 17) {
          /* Easter egg: three fast spins rain confetti qubits. */
          entry.spinAccum = 0
          launchConfetti(entry)
          sound.chime()
        }

        const stageAngle = entry.startAngle + entrySeconds * entry.orbitSpeed + entry.userYaw
        entry.stage.rotation.y = stageAngle
        entry.stage.rotation.x = entry.userPitch
        entry.userPitch *= 0.997

        /* Dive-in: dolly the camera into the diorama when opening its module. */
        const dive = entry.diveProgress ?? 0
        entry.camera.position.set(
          0,
          entry.cameraHeight - dive * 1.1,
          CAMERA_DISTANCE - dive * 6.2
        )
        entry.camera.lookAt(0, entry.cameraLookAtY + dive * 0.4, 0)

        for (const shape of entry.shapes) {
          const springOffset = advanceCarouselSpring(shape.carouselSpring, drive, dt)

          const localSeconds = entrySeconds
          let loopX = 0
          let loopY = Math.sin(seconds * shape.angularSpeed + shape.phase) * shape.amplitude
          let loopScale = 1
          let customScale = false
          if (shape.loop) {
            const cycle =
              (((localSeconds / (shape.loop.dur ?? 5) + (shape.loop.phase ?? 0)) % 1) + 1) % 1
            const travel = ((shape.loop.dist ?? 20) / 100) * frustumHeight
            if (shape.loop.kind === 'rise') {
              loopY = cycle * travel
              /* Constant size in flight; quick grow/shrink only at the loop seam. */
              loopScale = Math.min(1, cycle * 10, (1 - cycle) * 10)
            } else if (shape.loop.kind === 'drop') {
              const pingpong = 1 - Math.abs(1 - 2 * cycle)
              const eased = pingpong * pingpong * (3 - 2 * pingpong)
              loopY = -eased * travel
            } else if (shape.loop.kind === 'travel') {
              loopX = cycle * travel
              loopScale = 0.55 + 0.45 * Math.sin(Math.PI * cycle)
            } else if (shape.loop.kind === 'wave-path') {
              /* Rides the same sine curve the wave tube is built from. */
              const spanRadius = (((shape.loop.span ?? 40) / 100) * entry.frustumWidth) / 2
              loopX = -spanRadius + spanRadius * 2 * cycle
              loopY += Math.sin(cycle * Math.PI * 3) * spanRadius * 0.3
              loopScale = 0.7 + 0.3 * Math.sin(Math.PI * cycle)
            } else if (shape.loop.kind === 'melt') {
              /* Character melt: stretch up in anticipation, slump into a jiggly
                 puddle, breathe as a blob, then spring back with overshoot. */
              let squashY
              let spread
              if (cycle < 0.08) {
                const k = cycle / 0.08
                squashY = 1 + k * 0.14
                spread = 1 - k * 0.06
              } else if (cycle < 0.34) {
                const k = (cycle - 0.08) / 0.26
                const drop = 1 - Math.pow(1 - k, 3)
                const jiggle = Math.sin(k * Math.PI * 3) * (1 - k) * 0.1
                squashY = 1.14 - drop + jiggle * 0.3
                spread = 0.94 + drop + jiggle
              } else if (cycle < 0.6) {
                const k = (cycle - 0.34) / 0.26
                const blob = Math.sin(k * Math.PI * 4) * 0.05 * (1 - k * 0.5)
                squashY = 0.14 + Math.abs(blob) * 0.3
                spread = 1.94 + blob
              } else if (cycle < 0.82) {
                const k = (cycle - 0.6) / 0.22
                const springUp = 1 - Math.pow(1 - k, 2)
                const overshoot = Math.sin(k * Math.PI) * 0.18 * k
                squashY = 0.14 + springUp * 0.86 + overshoot
                spread = 1.94 - springUp * 0.94
              } else {
                const k = (cycle - 0.82) / 0.18
                const wobble = Math.sin(k * Math.PI * 3) * (1 - k) * 0.08
                squashY = 1 + wobble
                spread = 1 - wobble * 0.6
              }
              shape.group.scale.set(spread, Math.max(0.12, squashY), spread)
              loopY = -(1 - Math.min(1, squashY)) * travel
              customScale = true
            } else if (shape.loop.kind === 'spin') {
              shape.group.rotation.y = seconds * (shape.loop.rate ?? 0.5)
            }
          }
          if (shape.group.userData.update && frameCounter % quality.blobStride === 0) {
            shape.group.userData.update(localSeconds)
          }

          shape.group.position.x =
            shape.baseX + springOffset * Math.cos(stageAngle) + loopX
          shape.group.position.z = springOffset * Math.sin(stageAngle)
          shape.group.position.y = shape.baseY + loopY
          shape.group.rotation.z = springOffset * 0.4

          /* Entrance: supporting shapes pop in; core objects are always present. */
          const introT = shape.isCore
            ? 1
            : Math.min(1, Math.max(0, (localSeconds - shape.introDelay) / 0.55))
          const backEase =
            introT === 1
              ? 1
              : 1 + 2.70158 * Math.pow(introT - 1, 3) + 1.70158 * Math.pow(introT - 1, 2)
          if (!shape.isCore && introT > 0 && !shape.introPlayed) {
            shape.introPlayed = true
            if (entry === lastCenterEntry) {
              sound.blip(760 - Math.min(45, shape.def.s ?? 10) * 9)
            }
          }

          let effectScale = Math.max(0.001, backEase)
          if (shape.pulseStart) {
            const pulseT = (now - shape.pulseStart) / 450
            if (pulseT < 1) effectScale *= 1 + Math.sin(Math.PI * pulseT) * 0.3
            else shape.pulseStart = 0
          }
          if (shape.hiddenUntil) {
            if (localSeconds < shape.hiddenUntil) effectScale = 0.001
            else shape.hiddenUntil = 0
          }
          if (customScale) shape.group.scale.multiplyScalar(effectScale)
          else shape.group.scale.setScalar(loopScale * effectScale)
        }

        /* Confetti physics: fall, bounce on the platform, settle, expire. */
        if (entry.confetti?.mesh.visible) {
          if (now > entry.confetti.endAt) {
            entry.confetti.mesh.visible = false
          } else {
            entry.confetti.particles.forEach((particle, particleIndex) => {
              particle.vy -= 4.2 * frameDelta
              particle.x += particle.vx * frameDelta
              particle.y += particle.vy * frameDelta
              particle.z += particle.vz * frameDelta
              const restY = entry.floorTopY + 0.06
              if (particle.y < restY) {
                particle.y = restY
                particle.vy *= -0.35
                particle.vx *= 0.8
                particle.vz *= 0.8
              }
              confettiDummy.position.set(particle.x, particle.y, particle.z)
              confettiDummy.scale.setScalar(particle.size)
              confettiDummy.updateMatrix()
              entry.confetti.mesh.setMatrixAt(particleIndex, confettiDummy.matrix)
            })
            entry.confetti.mesh.instanceMatrix.needsUpdate = true
          }
        }


        entry.ground.position.y =
          entry.groundBaseY +
          Math.sin(seconds * 0.7 + entry.groundPhase) * frustumHeight * 0.009
      } else {
        entry.stage.rotation.y = entry.startAngle + entry.userYaw
        entry.stage.rotation.x = entry.userPitch
      }

      /* The blurred contact shadow costs five extra passes: keep it live for
         the centre card, freeze it on the dimmed side cards. */
      if (entry.contactShadow && (entry === centerEntry || !entry.contactShadow.hasRendered)) {
        const cs = entry.contactShadow
        cs.hasRendered = true
        entry.scene.overrideMaterial = contactDepthMat
        renderer.setRenderTarget(cs.rt)
        renderer.render(entry.scene, cs.cam)
        entry.scene.overrideMaterial = null
        for (const amount of [4.5, 1.8]) {
          cs.blurPlane.visible = true
          cs.blurPlane.material = contactHBlur
          contactHBlur.uniforms.tDiffuse.value = cs.rt.texture
          contactHBlur.uniforms.h.value = amount / 256
          renderer.setRenderTarget(cs.rtBlur)
          renderer.render(cs.blurPlane, cs.cam)
          cs.blurPlane.material = contactVBlur
          contactVBlur.uniforms.tDiffuse.value = cs.rtBlur.texture
          contactVBlur.uniforms.v.value = amount / 256
          renderer.setRenderTarget(cs.rt)
          renderer.render(cs.blurPlane, cs.cam)
          cs.blurPlane.visible = false
        }
        renderer.setRenderTarget(null)
      }

      renderer.getSize(rendererSize)
      if (rendererSize.x !== renderWidth || rendererSize.y !== renderHeight) {
        renderer.setSize(renderWidth, renderHeight, false)
      }
      renderer.render(entry.scene, entry.camera)

      if (entry.canvas.width !== renderWidth || entry.canvas.height !== renderHeight) {
        entry.canvas.width = renderWidth
        entry.canvas.height = renderHeight
      }
      entry.context.clearRect(0, 0, renderWidth, renderHeight)
      entry.context.drawImage(renderer.domElement, 0, 0, renderWidth, renderHeight)
    }

    /* Idle self-play: after 30s untouched, the centre scene pokes itself.
       The error-correction ball is left alone — its story is the show. */
    if (lastCenterEntry && now - lastInteractionAt > 30000 && now - lastSelfPokeAt > 6000) {
      lastSelfPokeAt = now
      const idleShapes = lastCenterEntry.shapes
      const idleTarget = idleShapes[Math.floor(Math.random() * idleShapes.length)]
      /* Hero shapes (ball, Bloch sphere) are left alone — their own story is
         the show; a self-poke just reads as a random rumble. */
      if (
        idleTarget &&
        !idleTarget.ball &&
        idleTarget.def.type !== 'bloch' &&
        idleTarget.def.type !== 'ice' &&
        idleTarget.def.type !== 'topoconductor' &&
        idleTarget.def.type !== 'nanowire' &&
        idleTarget.def.type !== 'protection-core' &&
        idleTarget.def.type !== 'quantum-computer'
      ) {
        pulseShape(idleTarget)
        idleTarget.carouselSpring.velocity += 2.2 * idleTarget.carouselSpring.response
      }
    }

    /* The aurora sways with the centre scene's rotation for a parallax feel. */
    if (menuScreen && centerEntry) {
      const stageAngle =
        (seconds - (centerEntry.sceneEpoch ?? 0)) * centerEntry.orbitSpeed + centerEntry.userYaw
      menuScreen.style.setProperty(
        '--aurora-parallax',
        `${(Math.sin(stageAngle) * 120).toFixed(1)}px`
      )
    }
  }

  window.requestAnimationFrame(renderFrame)

  return {
    /* Dev tooling (material panel, console probes). */
    entries,

    /* Compiles every scene's programs and uploads its textures ahead of time.
     *
     * The render loop is gated on the menu being on screen, so until the
     * visitor leaves the attract screen not one frame has been drawn — and the
     * first one then pays for every shader link and texture upload in the pool
     * at once, which is the hitch on that transition. compileAsync does that
     * work while the attract screen is still up and nothing is competing for
     * the frame.
     *
     * Deliberately not awaited by the caller: it is an optimisation, and a
     * driver that never resolves it must not be able to hold up startup.
     */
    async warmUp() {
      if (disposed) return
      for (const entry of entries) {
        if (disposed) return
        try {
          if (renderer.compileAsync) await renderer.compileAsync(entry.scene, entry.camera)
          else renderer.compile(entry.scene, entry.camera)
        } catch (error) {
          /* A warm-up that fails just means the first frame pays as before. */
          console.warn('Shape scene warm-up skipped for', entry.moduleId, error)
        }
      }
    },
    /* Dolly into the centred diorama; resolves when the camera arrives. */
    diveIn(durationMs = 750) {
      return new Promise(resolve => {
        const entry = lastCenterEntry ?? entries[0]
        if (!entry || disposed) {
          resolve()
          return
        }
        /* The Bloch arrow measures itself the moment the dive starts. */
        for (const shape of entry.shapes) shape.group.userData.snapMeasure?.()
        const startedAt = performance.now()
        const step = frameNow => {
          if (disposed) {
            resolve()
            return
          }
          const t = Math.min(1, (frameNow - startedAt) / durationMs)
          entry.diveProgress = t * t * (3 - 2 * t)
          if (t < 1) window.requestAnimationFrame(step)
          else resolve()
        }
        window.requestAnimationFrame(step)
      })
    },
    resetDive() {
      for (const entry of entries) {
        entry.diveProgress = 0
        /* Back on the menu: the Bloch arrow returns to superposition. */
        for (const shape of entry.shapes) shape.group.userData.resetMeasure?.()
      }
    },
    groundParams,
    sceneParams,
    /* Starting values are the honeycomb ball's material recipe; mirrors the
       defaults hard-coded in the bloch branch of buildShapeMesh. */
    blochParams: {
      coreColor: '#2e66cc',
      glossStrength: BALL_CONFIG.glossStrength,
      glossRoughness: BALL_CONFIG.glossRoughness,
      glossReflect: BALL_CONFIG.glossReflect,
      shellRimAlpha: 0.856,
      shellFresnelPow: 8,
      ringOpacity: 1,
      ringBackOpacity: 0.35,
      arrowColor: '#ffffff'
    },
    setBloch(next) {
      Object.assign(this.blochParams, next)
      for (const entry of entries) {
        for (const shape of entry.shapes) {
          const materials = shape.group.userData.blochMaterials
          if (!materials) continue
          materials.core.uniforms.diffuse.value
            .set(this.blochParams.coreColor)
            .convertSRGBToLinear()
          materials.gloss.opacity = this.blochParams.glossStrength
          materials.gloss.roughness = this.blochParams.glossRoughness
          materials.gloss.envMapIntensity = this.blochParams.glossReflect
          materials.shell.uRimAlpha.value = this.blochParams.shellRimAlpha
          materials.shell.uFresnelPow.value = this.blochParams.shellFresnelPow
          materials.ring.opacity = this.blochParams.ringOpacity
          materials.ringBack.opacity = this.blochParams.ringBackOpacity
          materials.arrow.color.set(this.blochParams.arrowColor)
        }
      }
    },
    /* The centred card's identity and live params, for the dev panel. */
    getCenter() {
      const entry = lastCenterEntry ?? entries[0]
      return {
        moduleId: entry.moduleId,
        materialParams: entry.materialParams,
        lightParams: entry.lightParams,
        hasBloch: entry.shapes.some(shape => shape.def.type === 'bloch')
      }
    },
    /* The resting yaw a scene opens at, in radians — live so it can be dialled in
       the dev panel rather than guessed at as a constant. */
    getStartAngleFor(moduleId) {
      return entries.find(candidate => candidate.moduleId === moduleId)?.startAngle ?? null
    },
    setStartAngleFor(moduleId, radians) {
      const entry = entries.find(candidate => candidate.moduleId === moduleId)
      if (!entry || !Number.isFinite(radians)) return
      entry.startAngle = radians
      /* A non-rotating scene is only written on its own branch, so nudge it now
         rather than waiting for a frame that may never re-pose it. */
      entry.stage.rotation.y = entry.startAngle + entry.userYaw
    },

    /* Dev-only: the nav preview's own framing controls, when its scene has any
       (currently the topoconductor stack). Null keeps the panel's section out. */
    getNavTuning(moduleId) {
      const entry = entries.find(candidate => candidate.moduleId === moduleId)
      if (!entry) return null
      for (const shape of entry.shapes) {
        /* The topoconductor preview is its own root; other shapes sit under a
           wrapper group the pool adds for scale animation. Check both. */
        const tuning =
          shape.group?.userData?.navTuning ?? shape.group?.children?.[0]?.userData?.navTuning
        if (tuning) return tuning
      }
      return null
    },
    setMaterialFor(moduleId, next) {
      const entry = entries.find(candidate => candidate.moduleId === moduleId)
      if (!entry) return
      Object.assign(entry.materialParams, next)
      applyMaterialParams(entry.uniforms, entry.materialParams)
    },
    setLightsFor(moduleId, next) {
      const entry = entries.find(candidate => candidate.moduleId === moduleId)
      if (!entry) return
      Object.assign(entry.lightParams, next)
      applyLightParams(entry)
    },
    setScene(next) {
      const flagKeys = [
        'flagCount', 'flagSize', 'flagDistance', 'flagHeight',
        'flagAngle', 'flagTilt', 'envBlur'
      ]
      const needsEnvRebuild = flagKeys.some(
        key => key in next && next[key] !== sceneParams[key]
      )
      Object.assign(sceneParams, next)
      renderer.toneMappingExposure = sceneParams.exposure
      if (needsEnvRebuild) {
        const nextTarget = buildEnvironmentTexture(pmrem)
        environmentRenderTarget.dispose()
        environmentRenderTarget = nextTarget
        environmentTexture = nextTarget.texture
        /* envBlur is shared with the ice flag's bake. */
        const nextIceTarget = buildIceEnvironmentTexture(pmrem)
        iceEnvironmentRenderTarget.dispose()
        iceEnvironmentRenderTarget = nextIceTarget
        iceEnvironmentTexture = nextIceTarget.texture
        for (const entry of entries) entry.scene.environment = environmentFor(entry.moduleId)
      }
      for (const entry of entries) entry.scene.environmentIntensity = sceneParams.envIntensity
    },
    iceFlagParams,
    setIceFlag(next) {
      Object.assign(iceFlagParams, next)
      const nextTarget = buildIceEnvironmentTexture(pmrem)
      iceEnvironmentRenderTarget.dispose()
      iceEnvironmentRenderTarget = nextTarget
      iceEnvironmentTexture = nextTarget.texture
      for (const entry of entries) {
        if (entry.moduleId === 'states-of-matter') entry.scene.environment = iceEnvironmentTexture
        for (const ice of entry.iceUniforms ?? []) applyIceReflector(ice, iceReflectorSpec())
      }
    },
    setGround(next) {
      Object.assign(groundParams, next)
      for (const entry of entries) {
        const layout = getModuleNavigationGridLayout({
          aspect: entry.frustumWidth / frustumHeight,
          ground: groundParams
        })
        const placement = { side: layout.groundSide, y: layout.groundY }
        const thickness = layout.groundThickness
        entry.ground.geometry.dispose()
        entry.ground.geometry = new RoundedBoxGeometry(
          placement.side,
          thickness,
          placement.side,
          3,
          thickness * 0.45
        )
        entry.groundBaseY = placement.y
        entry.ground.position.y = placement.y
      }
    },
    dispose() {
      disposed = true
      intersectionObserver.disconnect()
      for (const entry of entries) {
        entry.stopPointerDrag?.()
        entry.canvas.remove()
        for (const shape of entry.shapes) {
          shape.group.userData.dispose?.()
          shape.ball?.dispose()
        }
        for (const disc of entry.drawnShadows ?? []) {
          disc.geometry.dispose()
          disc.material.map?.dispose()
          disc.material.dispose()
        }
        if (entry.contactShadow) {
          entry.contactShadow.rt.dispose()
          entry.contactShadow.rtBlur.dispose()
          entry.contactShadow.planeGeo.dispose()
          entry.contactShadow.plane.material.dispose()
        }
      }
      contactDepthMat.dispose()
      contactHBlur.dispose()
      contactVBlur.dispose()
      iceGeometry?.dispose()
      ballTemplate.dispose()
      brushedEnvironment.dispose()
      environmentRenderTarget.dispose()
      iceEnvironmentRenderTarget.dispose()
      renderer.dispose()
      pmrem.dispose()
    }
  }
}
