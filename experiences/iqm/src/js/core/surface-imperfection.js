/*
 * Surface imperfection: shared fBm-driven micro-variation that breaks the
 * "CG-perfect" uniformity of rendered materials. Three dials, all sampled
 * in object space (so the pattern sticks to spinning objects):
 *   - normal jitter  — orange-peel waviness in reflections and highlights
 *   - roughness var  — patchy sheen: wear, smudge, fingerprints
 *   - albedo mottle  — few-percent brightness drift: pigment/dirt history
 *
 * Every patched material shares the ONE uniform set below, so the dev
 * material panel dials the whole app at once, live, with no recompiles.
 */

export const imperfectionParams = {
  master: 4, // one-slider global dial; 0 turns the whole effect off
  normalAmt: 0.6,
  normalScale: 160,
  roughAmt: 0.1,
  roughScale: 14.7,
  mottleAmt: 0,
  mottleScale: 0.5
}

/* Plain { value } uniforms shared by reference across every material. */
export const imperfectionUniforms = {
  uImpMaster: { value: imperfectionParams.master },
  uImpNormalAmt: { value: imperfectionParams.normalAmt },
  uImpNormalScale: { value: imperfectionParams.normalScale },
  uImpRoughAmt: { value: imperfectionParams.roughAmt },
  uImpRoughScale: { value: imperfectionParams.roughScale },
  uImpMottleAmt: { value: imperfectionParams.mottleAmt },
  uImpMottleScale: { value: imperfectionParams.mottleScale }
}

export function setImperfection(next) {
  Object.assign(imperfectionParams, next)
  imperfectionUniforms.uImpMaster.value = imperfectionParams.master
  imperfectionUniforms.uImpNormalAmt.value = imperfectionParams.normalAmt
  imperfectionUniforms.uImpNormalScale.value = imperfectionParams.normalScale
  imperfectionUniforms.uImpRoughAmt.value = imperfectionParams.roughAmt
  imperfectionUniforms.uImpRoughScale.value = imperfectionParams.roughScale
  imperfectionUniforms.uImpMottleAmt.value = imperfectionParams.mottleAmt
  imperfectionUniforms.uImpMottleScale.value = imperfectionParams.mottleScale
}

/* GLSL helpers, imp_-prefixed to avoid colliding with host-shader noise. */
export const IMP_GLSL = /* glsl */ `
uniform float uImpMaster;
uniform float uImpNormalAmt;
uniform float uImpNormalScale;
uniform float uImpRoughAmt;
uniform float uImpRoughScale;
uniform float uImpMottleAmt;
uniform float uImpMottleScale;
varying vec3 vImpPos;

float imp_hash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float imp_noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(imp_hash(i), imp_hash(i + vec3(1, 0, 0)), f.x),
        mix(imp_hash(i + vec3(0, 1, 0)), imp_hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(imp_hash(i + vec3(0, 0, 1)), imp_hash(i + vec3(1, 0, 1)), f.x),
        mix(imp_hash(i + vec3(0, 1, 1)), imp_hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z
  );
}
/* Two octaves broad + one fine: layered frequencies read as material
   history instead of static. */
float imp_fbm(vec3 p) {
  return (imp_noise(p) * 0.55 + imp_noise(p * 2.13 + 7.7) * 0.3 + imp_noise(p * 4.9 + 19.1) * 0.15);
}
/* Anti-sparkle: how visible one noise cell is on screen. Below ~1.5px per
   cell the jitter aliases into highlight flicker, so it fades to zero (and
   imp_roughComp turns the lost detail into roughness instead — the same
   trade a normal-map mip chain makes). */
float imp_normalFade(vec3 p) {
  vec3 q = p * uImpNormalScale;
  float cellsPerPixel = fwidth(q.x) + fwidth(q.y) + fwidth(q.z);
  float pixelsPerCell = 1.0 / max(cellsPerPixel, 1e-4);
  return smoothstep(1.5, 4.0, pixelsPerCell);
}
vec3 imp_normalOffset(vec3 p) {
  vec3 q = p * uImpNormalScale;
  return (vec3(imp_noise(q), imp_noise(q + 19.1), imp_noise(q + 47.7)) - 0.5)
    * uImpNormalAmt * uImpMaster * imp_normalFade(p);
}
/* Roughness owed for normal detail too fine to resolve per-pixel. */
float imp_roughComp(vec3 p) {
  return (1.0 - imp_normalFade(p)) * uImpNormalAmt * uImpMaster * 0.12;
}
float imp_roughShift(vec3 p) {
  return (imp_fbm(p * uImpRoughScale) - 0.5) * uImpRoughAmt * uImpMaster;
}
float imp_mottle(vec3 p) {
  /* Floored so extreme dial settings darken toward black instead of
     inverting into negative color. */
  return max(1.0 + (imp_fbm(p * uImpMottleScale) - 0.5) * uImpMottleAmt * uImpMaster, 0.0);
}
`

const VERT_VARYING = 'varying vec3 vImpPos;\n'

/*
 * Patches a MeshStandardMaterial / MeshPhysicalMaterial so its normals,
 * roughness and albedo pick up the shared imperfection field. Chains any
 * existing onBeforeCompile (gloss facet blends, tile shaders, ...).
 */
export function applyImperfection(material) {
  if (!material || material.userData.imperfectionApplied) return false
  if (!material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial) return false
  if (material.userData.noImperfection) return false
  material.userData.imperfectionApplied = true

  const previous = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer)
    Object.assign(shader.uniforms, imperfectionUniforms)
    shader.vertexShader = VERT_VARYING + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vImpPos = transformed;'
    )
    shader.fragmentShader = IMP_GLSL + shader.fragmentShader
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\n  normal = normalize(normal + imp_normalOffset(vImpPos));'
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor + imp_roughShift(vImpPos) + imp_roughComp(vImpPos), 0.04, 1.0);'
      )
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\n  diffuseColor.rgb *= imp_mottle(vImpPos);'
      )
  }
  /* The patch changes the generated program: force distinct cache keys from
     unpatched materials, shared among patched ones. */
  const baseKey = material.customProgramCacheKey?.bind(material)
  material.customProgramCacheKey = () => `${baseKey ? baseKey() : ''}|imp1`
  material.needsUpdate = true
  return true
}

/* Walks a scene/object and patches every eligible PBR material. */
export function applyImperfectionToObject(root) {
  let patched = 0
  root?.traverse?.(node => {
    if (!node.isMesh) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    for (const material of materials) {
      if (applyImperfection(material)) patched += 1
    }
  })
  return patched
}
