/*
 * Crop a scene's contents to a sphere's outline as it appears on screen, while the
 * sphere itself stays a real 3D object that shades, rims and casts a shadow.
 *
 * The rays from the eye that graze a sphere form a cone, and that cone's cross
 * section is exactly the disc the sphere projects to — so "is this fragment inside
 * the circle" reduces to "is this ray inside the cone", one dot product against the
 * half-angle. Cropping against the sphere as a *volume* instead cuts by depth as
 * well as by outline, which pares a long object down far more than the visible
 * circle does.
 *
 * Everything is derived per-vertex from the mesh's own matrices, so no camera or
 * viewport values have to be threaded through from whoever owns the render loop.
 */

export const CROP_VARYINGS = /* glsl */ `
varying vec3 vClipViewPos;
varying vec3 vClipViewCenter;
varying float vClipViewRadius;
`

/*
 * uClipCenter and uClipRadius are in WORLD units, deliberately. Mapping the centre
 * through modelMatrix instead would express it per-mesh, so one shared uniform could
 * only ever be right for a single object space — fine for a handful of hand-built
 * meshes, wrong the moment the cropped thing is a loaded model whose every node
 * carries its own transform. In world space one pair of uniforms crops any tree.
 */
export const CROP_VERTEX = /* glsl */ `
  vClipViewCenter = (viewMatrix * vec4(uClipCenter, 1.0)).xyz;
  /* An instanced mesh carries its per-instance placement in instanceMatrix, not in
     modelMatrix, so leaving it out puts every instance at the wrong world position —
     the crop then measures the wrong distance and the instances leak past the rim. */
  #ifdef USE_INSTANCING
    vec4 clipLocalPosition = instanceMatrix * vec4(position, 1.0);
  #else
    vec4 clipLocalPosition = vec4(position, 1.0);
  #endif
  vClipViewPos = (viewMatrix * modelMatrix * clipLocalPosition).xyz;
  vClipViewRadius = uClipRadius;
`

/*
 * 1 inside the projected circle, 0 outside. A discard is binary, so the cut gets no
 * antialiasing of its own and steps along the rim; the feather band is a proportion
 * of the whole half-angle so it holds a consistent width on screen at any circle
 * size, and surfaces can blend into the shell across it rather than ending abruptly.
 */
export const CROP_COVERAGE = /* glsl */ `
float clipCoverage() {
  if (vClipViewRadius <= 0.0) return 1.0;
  float centerDistance = length(vClipViewCenter);
  /* Eye inside the sphere: there is no silhouette to crop against. */
  if (centerDistance <= vClipViewRadius) return 1.0;
  float cosHalfAngle = sqrt(max(0.0, 1.0 - (vClipViewRadius * vClipViewRadius) /
    (centerDistance * centerDistance)));
  float cosToFragment = dot(normalize(vClipViewPos), normalize(vClipViewCenter));
  float feather = (1.0 - cosHalfAngle) * 0.16 + 1e-6;
  return smoothstep(cosHalfAngle - feather, cosHalfAngle + feather, cosToFragment);
}
`

/* One set of uniforms per cropped scene, shared by reference across its materials so
   a single write per frame reaches all of them. */
export function createCropUniforms(THREE) {
  return {
    uClipRadius: { value: 0 },
    uClipCenter: { value: new THREE.Vector3() }
  }
}

/*
 * Point the crop at a sphere mesh. Its world matrix is refreshed here rather than
 * trusted, because this runs before the renderer updates the graph — reading a stale
 * matrix would leave the crop a frame behind whatever posed the scene, which shows
 * as the circle sliding against its contents.
 *
 * The mesh is expected to be a unit-radius sphere, so its world scale *is* its world
 * radius. `inset` pulls the cut just inside the shell so it lands under the rim.
 */
export function aimCropAtSphere(uniforms, sphereMesh, { inset = 1, scratch } = {}) {
  if (!sphereMesh) return
  sphereMesh.updateWorldMatrix(true, false)
  uniforms.uClipCenter.value.setFromMatrixPosition(sphereMesh.matrixWorld)
  const axis = scratch ?? uniforms.uClipCenter.value.clone()
  axis.setFromMatrixColumn(sphereMesh.matrixWorld, 0)
  uniforms.uClipRadius.value = axis.length() * inset
}

/*
 * Patch an ordinary material — including the ones a GLTF arrives with — to honour the
 * crop. onBeforeCompile is used rather than authoring the shader by hand so the
 * material keeps its own lighting, maps and tone mapping untouched.
 *
 * Returns false when the material's shader has no include hooks to patch (a raw
 * ShaderMaterial, say), so callers can handle those explicitly instead of silently
 * shipping an uncropped surface.
 */
export function applyCropToMaterial(material, uniforms) {
  if (!material || material.userData?.sphereCropApplied) return Boolean(material)
  if (material.isShaderMaterial && !material.isRawShaderMaterial) {
    /* Hand-authored shaders have no <common>/<begin_vertex> to hook. */
    if (!material.vertexShader?.includes('#include <begin_vertex>')) return false
  }

  const previousHook = material.onBeforeCompile
  material.onBeforeCompile = function onBeforeCompile(shader, renderer) {
    previousHook?.call(this, shader, renderer)
    if (!shader.vertexShader.includes('#include <begin_vertex>')) return
    shader.uniforms.uClipRadius = uniforms.uClipRadius
    shader.uniforms.uClipCenter = uniforms.uClipCenter
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `uniform float uClipRadius;\nuniform vec3 uClipCenter;\n${CROP_VARYINGS}\n#include <common>`
      )
      .replace('#include <begin_vertex>', `${CROP_VERTEX}\n#include <begin_vertex>`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `${CROP_VARYINGS}\n${CROP_COVERAGE}\n#include <common>`)
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
  if (clipCoverage() <= 0.001) discard;`
      )
  }

  /* Cropped and uncropped copies of the same material need separate programs, or
     whichever compiled first wins for both. */
  const previousCacheKey = material.customProgramCacheKey
  material.customProgramCacheKey = function customProgramCacheKey() {
    return `${previousCacheKey ? previousCacheKey.call(this) : ''}|sphere-crop`
  }

  material.userData.sphereCropApplied = true
  material.needsUpdate = true
  return true
}

/*
 * Walk a subtree and crop every surface in it, reporting what could not be patched so
 * a caller can deal with those rather than finding out on the panel.
 */
export function applyCropToTree(root, uniforms) {
  const unpatched = []
  root?.traverse(object => {
    if (!(object.isMesh || object.isPoints || object.isInstancedMesh)) return
    if (object.userData?.noSphereCrop) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue
      if (!applyCropToMaterial(material, uniforms)) {
        unpatched.push(object.name || material.type)
      }
    }
  })
  return { unpatched }
}
