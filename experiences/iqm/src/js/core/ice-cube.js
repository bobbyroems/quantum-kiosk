import { assetUrl } from './asset-url.js'

/*
 * The states-of-matter ice cube: the Ice+Cube.glb body under the
 * playground's procedural ice shader — a refracting surface over a
 * raymarched fBm frost interior with cracks, trapped-air flakes and
 * Beer–Lambert absorption.
 *
 * Ported from playground/ice-block.html; defaults are the panel-dialed
 * values (2026-08-11 photo-reference pass).
 */

const NORMAL_MAP_PATH =
  'assets/modules/states-of-matter/6e07645d25fbf75018a90fc7255386d77c474263.jpg'

export const ICE_CONFIG = Object.freeze({
  faceting: 0.25,
  quality: 16,
  density: 1.7,
  densityScale: 2,
  absorption: 1.85,
  iceTint: '#667f93',
  frostColor: '#cfdce8',
  milkiness: 0.14,
  cracks: 0.7,
  crackScale: 1.9,
  crackThreshold: 0.86,
  flakes: 0.12,
  flakeScale: 20,
  dispersion: 0.0221,
  ior: 1.31,
  fresnelPow: 2,
  reflectivity: 1,
  specIntensity: 1,
  specPower: 120,
  /* Scanned surface relief, sampled triplanar — the chunk carries no UVs. */
  normalStrength: 0.38,
  normalScale: 0.32,
  microRough: 0.03,
  crust: 0.05,
  crustColor: '#f4f9fd',
  glossStrength: 0.5,
  glossRoughness: 0.14,
  glossReflect: 1.1,
  /* In-shader environment the refraction/reflection rays land in. It is
     deliberately NOT the kiosk's light backdrop: ice has no colour of its
     own and reads grey only by refracting a dark room, so a bright dome in
     every direction renders it as white plastic. Bright above, dark below. */
  bgTop: '#e8edf2',
  bgBottom: '#8b94a0',
  bgGround: '#4a5563',
  groundLevel: 0.75,
  /* Analytic dark blob in the same environment, so the ice body sees the
     negative-fill card too. The gloss shell reads the real card out of the
     baked envmap; this is what puts it in the refraction. Driven from
     shape-scene-3d's iceFlagParams so both stay on one source of truth. */
  reflectorDark: 0.55
})

/* Fitted bounding-sphere radius of the prepared geometry (object space). */
export const ICE_FIT_RADIUS = 1.05
const MAX_STEPS = 24

/*
 * Loads Ice+Cube.glb and prepares the chunk: body welded, centred, fitted to
 * ICE_FIT_RADIUS, with smooth normals kept as an attribute and flat facet
 * normals in `normal` (blended by uFacet).
 *
 * The file's "Droplets" condensation mesh is skipped — surface relief now
 * comes from the scanned normal map, and welding bumps into the chunk fought
 * that detail instead of adding to it.
 */
export async function loadIceCubeGeometry({ THREE, GLTFLoader, mergeVertices }) {
  const gltf = await new GLTFLoader().loadAsync(
    assetUrl('assets/modules/states-of-matter/Ice+Cube.glb')
  )
  gltf.scene.updateMatrixWorld(true)

  let bodySource = null
  gltf.scene.traverse(node => {
    if (!node.isMesh) return
    if (/droplet/i.test(node.name)) return
    if (
      !bodySource ||
      node.geometry.attributes.position.count > bodySource.geometry.attributes.position.count
    ) bodySource = node
  })
  if (!bodySource) throw new Error('Ice+Cube.glb contains no body mesh.')

  const strip = geo => {
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position') geo.deleteAttribute(name)
    }
    return mergeVertices(geo)
  }

  const base = strip(bodySource.geometry.clone().applyMatrix4(bodySource.matrixWorld))
  base.computeBoundingSphere()
  const bounds = base.boundingSphere
  base.translate(-bounds.center.x, -bounds.center.y, -bounds.center.z)
  const fit = ICE_FIT_RADIUS / bounds.radius
  base.scale(fit, fit, fit)
  base.computeVertexNormals()

  /* aDisp drives the frost crust: radial deviation from the mean radius so
     crust grows on the protruding corners. */
  const pos = base.attributes.position
  const v = new THREE.Vector3()
  const radii = new Float32Array(pos.count)
  let mean = 0
  for (let i = 0; i < pos.count; i++) {
    radii[i] = v.fromBufferAttribute(pos, i).length()
    mean += radii[i]
  }
  mean /= Math.max(pos.count, 1)
  const disp = new Float32Array(pos.count)
  for (let i = 0; i < pos.count; i++) disp[i] = (radii[i] - mean) / mean
  base.setAttribute('aDisp', new THREE.BufferAttribute(disp, 1))

  /* Explode to per-face vertices: smooth normal kept as an attribute, flat
     facet normal in `normal`, blended in the vertex shaders with uFacet. */
  const geometry = base.toNonIndexed()
  base.dispose()
  geometry.setAttribute('aSmoothNormal', geometry.attributes.normal.clone())
  const p = geometry.attributes.position
  const n = geometry.attributes.normal
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i)
    b.fromBufferAttribute(p, i + 1)
    c.fromBufferAttribute(p, i + 2)
    ab.subVectors(b, a)
    ac.subVectors(c, a)
    ab.cross(ac).normalize()
    for (let k = 0; k < 3; k++) n.setXYZ(i + k, ab.x, ab.y, ab.z)
  }
  n.needsUpdate = true
  return geometry
}

/* One shared texture across every ice instance — it is the same scan, and
   the carousel rebuilds card previews on relayout. Lives for the life of the
   page, so instance dispose() deliberately leaves it alone. */
let sharedNormalMap = null
function iceNormalMap(THREE) {
  if (sharedNormalMap) return sharedNormalMap
  const texture = new THREE.TextureLoader().load(assetUrl(NORMAL_MAP_PATH))
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  /* Tangent vectors, not colour — an sRGB decode bends every normal. */
  texture.colorSpace = THREE.NoColorSpace
  texture.generateMipmaps = true
  sharedNormalMap = texture
  return texture
}

/*
 * Aims the ice shader's analytic negative-fill blob at a card, so the body's
 * refraction sees the same flag the PMREM bake gives the gloss shell.
 *
 * The blob is a cone and the card is a rectangle, so the half-angle uses the
 * mean of its half-extents — exact enough for a soft, out-of-focus dark
 * region, which is all the reflection ever resolves.
 */
export function applyIceReflector(uniforms, { position, width, height, enabled = true }) {
  const distance = Math.max(position.length(), 0.001)
  uniforms.uReflectorDir.value.copy(position).divideScalar(distance)
  const halfAngle = Math.atan2((width + height) * 0.25, distance)
  uniforms.uReflectorCos.value = Math.min(Math.cos(halfAngle), 0.9995)
  uniforms.uReflectorDark.value = enabled ? ICE_CONFIG.reflectorDark : 0
}

export function createIceCube({ THREE, geometry, radius }) {
  const config = ICE_CONFIG
  const uniforms = {
    uCamPosObj: { value: new THREE.Vector3() },
    uModelRot: { value: new THREE.Matrix3() },
    uKeyDir: { value: new THREE.Vector3(1, 1, 0.8).normalize() },
    uKeyColor: { value: new THREE.Color('#ffffff') },
    uKeyIntensity: { value: 1.2 },
    uFacet: { value: config.faceting },
    uRadius: { value: ICE_FIT_RADIUS },
    uSteps: { value: config.quality },
    uIor: { value: config.ior },
    uDensity: { value: config.density },
    uDensityScale: { value: config.densityScale },
    uAbsorb: { value: config.absorption },
    uIceTint: { value: new THREE.Color(config.iceTint) },
    uFrostColor: { value: new THREE.Color(config.frostColor) },
    uMilkiness: { value: config.milkiness },
    uCracks: { value: config.cracks },
    uCrackScale: { value: config.crackScale },
    uCrackThreshold: { value: config.crackThreshold },
    uFlakes: { value: config.flakes },
    uFlakeScale: { value: config.flakeScale },
    uDispersion: { value: config.dispersion },
    uFresnelPow: { value: config.fresnelPow },
    uReflectivity: { value: config.reflectivity },
    uSpecIntensity: { value: config.specIntensity },
    uSpecPower: { value: config.specPower },
    uNormalMap: { value: iceNormalMap(THREE) },
    uNormalStrength: { value: config.normalStrength },
    uNormalScale: { value: config.normalScale },
    uMicroRough: { value: config.microRough },
    uCrust: { value: config.crust },
    uCrustColor: { value: new THREE.Color(config.crustColor) },
    uBgTop: { value: new THREE.Color(config.bgTop) },
    uBgBottom: { value: new THREE.Color(config.bgBottom) },
    uBgGround: { value: new THREE.Color(config.bgGround) },
    uGroundLevel: { value: config.groundLevel },
    uReflectorDir: { value: new THREE.Vector3(1, 0, 0) },
    uReflectorCos: { value: 0.95 },
    uReflectorDark: { value: 0 },
    uSeedOffset: { value: new THREE.Vector3(3.1, 7.7, 1.9) },
    uGrow: { value: 1 },
    uTime: { value: 0 }
  }

  const iceMaterial = new THREE.ShaderMaterial({
    uniforms,
    /* Base pass sits slightly deeper so the coplanar additive gloss shell
       always wins the depth test — no z-fighting. */
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    vertexShader: /* glsl */ `
      attribute vec3 aSmoothNormal;
      attribute float aDisp;

      uniform float uFacet;

      varying vec3 vObjPos;
      varying vec3 vObjNormal;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vDisp;

      void main() {
        vObjPos = position;
        vec3 blended = normalize(mix(aSmoothNormal, normal, uFacet));
        vObjNormal = blended;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * blended);
        vDisp = aDisp;
        /* Matches MeshPhysicalMaterial's transform bit-for-bit — the gloss
           shell draws the same geometry. Two statements on purpose:
           P * (MV * v), not (P * MV) * v. */
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCamPosObj;
      uniform mat3 uModelRot;
      uniform vec3 uKeyDir;
      uniform vec3 uKeyColor;
      uniform float uKeyIntensity;
      uniform float uRadius;
      uniform int uSteps;
      uniform float uIor;
      uniform float uDensity;
      uniform float uDensityScale;
      uniform float uAbsorb;
      uniform vec3 uIceTint;
      uniform vec3 uFrostColor;
      uniform float uMilkiness;
      uniform float uCracks;
      uniform float uCrackScale;
      uniform float uCrackThreshold;
      uniform float uFlakes;
      uniform float uFlakeScale;
      uniform float uDispersion;
      uniform float uFresnelPow;
      uniform float uReflectivity;
      uniform float uSpecIntensity;
      uniform float uSpecPower;
      uniform sampler2D uNormalMap;
      uniform float uNormalStrength;
      uniform float uNormalScale;
      uniform float uMicroRough;
      uniform float uCrust;
      uniform vec3 uCrustColor;
      uniform vec3 uBgTop;
      uniform vec3 uBgBottom;
      uniform vec3 uBgGround;
      uniform float uGroundLevel;
      uniform vec3 uReflectorDir;
      uniform float uReflectorCos;
      uniform float uReflectorDark;
      uniform vec3 uSeedOffset;
      uniform float uGrow;
      uniform float uTime;

      varying vec3 vObjPos;
      varying vec3 vObjNormal;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vDisp;

      float hash13(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.zyx + 31.32);
        return fract((p.x + p.y) * p.z);
      }

      float vnoise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float n000 = hash13(i);
        float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
        float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
        float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
        float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
        float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
        float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
        float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
        return mix(
          mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
          mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
          f.z
        );
      }

      float fbm(vec3 p) {
        float amp = 0.5;
        float sum = 0.0;
        for (int o = 0; o < 3; o++) {
          sum += amp * vnoise(p);
          p *= 2.07;
          amp *= 0.5;
        }
        return sum / 0.875;
      }

      /* Triplanar normal mapping, UDN blend.

         Three planar projections of the scan, weighted by how much the
         surface faces each axis. Each sample arrives in its projection's own
         tangent space, so the .xy detail is added to the swizzled surface
         normal — the two axes that projection spans — then swizzled back. */
      vec3 triplanarNormal(vec3 p, vec3 n) {
        vec3 uvw = p * uNormalScale;

        /* Power-4 keeps the seams between projections tight; a softer blend
           cross-fades the three copies over half the chunk and mushes the
           relief out wherever the faces angle away. */
        vec3 blend = pow(abs(n), vec3(4.0));
        blend /= max(blend.x + blend.y + blend.z, 1e-4);

        vec3 tx = texture2D(uNormalMap, uvw.zy).xyz * 2.0 - 1.0;
        vec3 ty = texture2D(uNormalMap, uvw.xz).xyz * 2.0 - 1.0;
        vec3 tz = texture2D(uNormalMap, uvw.xy).xyz * 2.0 - 1.0;

        tx = vec3(tx.xy * uNormalStrength + n.zy, n.x);
        ty = vec3(ty.xy * uNormalStrength + n.xz, n.y);
        tz = vec3(tz.xy * uNormalStrength + n.xy, n.z);

        return normalize(tx.zyx * blend.x + ty.xzy * blend.y + tz.xyz * blend.z);
      }

      /* The studio the ice refracts. Not the page backdrop: ice has no
         colour of its own, and against a bright dome in every direction the
         body can never be darker than the page and reads as white plastic. */
      vec3 fogColor(vec3 dir) {
        vec3 fog = mix(uBgBottom, uBgTop, clamp(dir.y * 0.5 + 0.55, 0.0, 1.0));

        /* Dark floor and surround, wrapping up around the block. */
        fog = mix(fog, uBgGround, 1.0 - smoothstep(-uGroundLevel, 0.02, dir.y));

        float sunGlow = pow(max(dot(dir, uKeyDir), 0.0), 10.0);
        fog += uKeyColor * sunGlow * 0.18 * uKeyIntensity;

        /* The negative-fill card, as a cone of dark directions. This
           environment has no origin — only a direction — so the card can
           enter it only as an angular blob, sized by the caller from how
           much of the sky it covers. */
        float toward = dot(dir, uReflectorDir);
        float blob = smoothstep(uReflectorCos, mix(uReflectorCos, 1.0, 0.45), toward);
        return mix(fog, fog * 0.05, blob * uReflectorDark);
      }

      void main() {
        vec3 nObj = normalize(vObjNormal);

        /* Scanned surface relief, before the refraction below so the
           interior march bends with the detail rather than sitting behind a
           smooth shell. */
        nObj = triplanarNormal(vObjPos, nObj);

        /* Orange-peel jitter on top, for grain finer than the scan resolves. */
        vec3 peel = vec3(
          vnoise(vObjPos * 34.0),
          vnoise(vObjPos * 34.0 + 19.1),
          vnoise(vObjPos * 34.0 + 47.7)
        ) - 0.5;
        nObj = normalize(nObj + peel * uMicroRough);
        vec3 nWorld = normalize(uModelRot * nObj);

        vec3 rayObj = normalize(vObjPos - uCamPosObj);
        float ndv = clamp(dot(nObj, -rayObj), 0.0, 1.0);
        float fresnel = pow(1.0 - ndv, uFresnelPow);

        /* ---- interior: refract, then march frost density ---- */
        vec3 refr = refract(rayObj, nObj, 1.0 / uIor);
        if (dot(refr, refr) < 0.0001) refr = rayObj;

        float tMid = dot(-vObjPos, refr);
        float b2 = dot(vObjPos, vObjPos) - tMid * tMid;
        float chord = tMid + sqrt(max(uRadius * uRadius - b2, 0.0));
        chord = clamp(chord, uRadius * 0.15, uRadius * 2.2);

        float stepLen = chord / float(uSteps);
        vec3 samplePos = vObjPos;
        /* Static per-pixel jitter on the march start breaks step banding
           into stable fine grain. */
        samplePos += refr * stepLen * hash13(vec3(gl_FragCoord.xy, 17.0));
        float opticalDepth = 0.0;
        float crackGlow = 0.0;
        float flakeGlow = 0.0;
        float scatter = 0.0;

        for (int i = 0; i < ${MAX_STEPS}; i++) {
          if (i >= uSteps) break;
          samplePos += refr * stepLen;
          /* Floor sits high so most of the volume is genuinely clear and the
             frost reads as a few sheets rather than marbling; squashed on Y
             so features draw out into vertical feathering, the way block ice
             actually freezes. */
          float dens = smoothstep(0.56, 0.9, fbm(samplePos * uDensityScale * vec3(1.0, 0.4, 1.0) + uSeedOffset));
          dens = max(dens - (1.0 - uGrow) * 0.9, 0.0);
          float transNow = exp(-opticalDepth * uDensity);
          opticalDepth += (dens + uAbsorb * 0.35) * stepLen;

          float ridge = 1.0 - abs(2.0 * fbm(samplePos * uCrackScale * vec3(1.0, 0.35, 1.0) + uSeedOffset * 1.71) - 1.0);
          crackGlow += smoothstep(uCrackThreshold, uCrackThreshold + 0.06, ridge) * transNow * stepLen;

          vec3 cell = floor(samplePos * uFlakeScale);
          float speck = step(0.996 - uFlakes * 0.008, hash13(cell))
            * step(0.5, vnoise(samplePos * uFlakeScale * 2.0));
          flakeGlow += speck * transNow * stepLen
            * (0.5 + 0.5 * sin(uTime * 1.4 + hash13(cell) * 40.0));

          scatter += dens * transNow * stepLen;
        }

        vec3 transmitted = pow(max(uIceTint, vec3(0.001)), vec3(opticalDepth * uDensity));

        vec3 background;
        background.r = fogColor(normalize(uModelRot * refract(rayObj, nObj, 1.0 / (uIor * (1.0 - uDispersion))))).r;
        background.g = fogColor(normalize(uModelRot * refr)).g;
        background.b = fogColor(normalize(uModelRot * refract(rayObj, nObj, 1.0 / (uIor * (1.0 + uDispersion))))).b;

        float topLight = clamp(nWorld.y * 0.5 + 0.65, 0.0, 1.0);
        vec3 color = background * transmitted;
        color += uFrostColor * (1.0 - exp(-scatter * uMilkiness * 2.2)) * topLight;
        color += uKeyColor * crackGlow * uCracks * 1.6 * uKeyIntensity;
        color += vec3(1.0) * flakeGlow * 2.4;

        /* ---- surface: reflection, speculars, frost crust ---- */
        vec3 viewWorld = normalize(vWorldPos - cameraPosition);
        vec3 reflWorld = reflect(viewWorld, nWorld);
        vec3 reflection = fogColor(reflWorld);
        color = mix(color, reflection, clamp(fresnel * uReflectivity, 0.0, 1.0));

        vec3 halfDir = normalize(-viewWorld + uKeyDir);
        float grain = vnoise(vObjPos * 21.0);
        float spec = pow(max(dot(nWorld, halfDir), 0.0), uSpecPower) * uSpecIntensity;
        vec3 fillDir = normalize(vec3(-0.6, 0.3, 0.55));
        float sheen = pow(max(dot(nWorld, normalize(-viewWorld + fillDir)), 0.0), 24.0) * 0.25;
        color += uKeyColor * (spec + sheen) * (0.8 + 0.4 * grain) * uKeyIntensity;

        float crustMask = smoothstep(0.12, 0.5, vDisp) * fbm(vObjPos * 7.0 + uSeedOffset * 3.3);
        crustMask = clamp(crustMask * uCrust * 2.2, 0.0, 1.0);
        color = mix(color, uCrustColor * (0.72 + 0.4 * topLight), crustMask);

        color += uFrostColor * fresnel * 0.12;

        float lambert = clamp(dot(nWorld, uKeyDir), 0.0, 1.0);
        color *= 0.84 + 0.28 * lambert;

        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  })

  /* Additive black-diffuse physical shell: env reflections and clearcoat
     glints only (same trick as the error-correction ball's coat). Honors
     the same smooth↔facet normal blend via the shared uFacet uniform. */
  const glossMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    metalness: 0,
    roughness: config.glossRoughness,
    envMapIntensity: config.glossReflect,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    transparent: true,
    opacity: config.glossStrength,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  })
  glossMaterial.onBeforeCompile = shader => {
    shader.uniforms.uFacet = uniforms.uFacet
    shader.vertexShader =
      'attribute vec3 aSmoothNormal;\nuniform float uFacet;\n' +
      shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        'vec3 objectNormal = normalize(mix(aSmoothNormal, normal, uFacet));'
      )
  }
  /* Distinct program-cache key: without it, chained onBeforeCompile
     wrappers (surface imperfection) make this shell's cache key collide
     with other patched physical materials that lack the facet blend. */
  glossMaterial.customProgramCacheKey = () => 'ice-gloss-facet'

  const iceMesh = new THREE.Mesh(geometry, iceMaterial)
  const glossMesh = new THREE.Mesh(geometry, glossMaterial)
  glossMesh.renderOrder = 1
  glossMesh.userData.noShadow = true

  const group = new THREE.Group()
  group.scale.setScalar(radius / ICE_FIT_RADIUS)
  group.add(iceMesh, glossMesh)

  const inverseModel = new THREE.Matrix4()
  const camObj = new THREE.Vector3()

  return {
    group,
    uniforms,
    iceMesh,
    materials: { ice: iceMaterial, gloss: glossMaterial },
    /* Per-frame: object-space camera + rotation for the interior march. */
    update(seconds, camera) {
      iceMesh.updateWorldMatrix(true, false)
      inverseModel.copy(iceMesh.matrixWorld).invert()
      camObj.copy(camera.position).applyMatrix4(inverseModel)
      uniforms.uCamPosObj.value.copy(camObj)
      uniforms.uModelRot.value.setFromMatrix4(iceMesh.matrixWorld)
      uniforms.uTime.value = seconds
    },
    dispose() {
      iceMaterial.dispose()
      glossMaterial.dispose()
    }
  }
}
