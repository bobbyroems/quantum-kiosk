export const MAJORANA_MATERIAL_COLOR_MULTIPLIERS = Object.freeze({
  Bars: '#e5d0a2',
  Chassis: '#d2b778',
  'CMOS Board': '#ffffff',
  Cover: '#ffffff',
  PCB: '#ffffff'
})

// The GLB already carries authored metallic-roughness and normal maps for
// every surface. Preserve those maps — replacing them with uniform scalar
// values removes the local mirror response visible in the approved viewer.
// These scalars multiply the authored maps rather than replacing them, so the
// local variation survives and only the overall level moves.
//
// Roughness and metalness are what decide whether the device goes dark as it is
// orbited. At the previous 0.1 roughness the chassis was effectively a mirror:
// its specular lobe sampled a near-point of the environment, so the reflection
// swung between a bright card and the surround as the model turned, and at 0.98
// metalness there was no diffuse lobe to steady it — which is also why no
// ambient or hemisphere light could have helped, both being diffuse-only.
//
// Widening the lobe (0.1 -> 0.22) makes each pixel average a broad patch of the
// environment instead of sampling one direction, and easing metalness back
// (0.98 -> 0.9) restores about a tenth of a diffuse response for the env
// irradiance to sit on. Together they flatten the angle-to-angle swing without
// giving up the gold's mirror character.
export const MAJORANA_MATERIAL_FINISHES = Object.freeze({
  Bars: Object.freeze({ metalness: 0.9, roughness: 0.26, envMapIntensity: 1.7 }),
  Chassis: Object.freeze({ metalness: 0.9, roughness: 0.22, envMapIntensity: 1.8 }),
  Cover: Object.freeze({ envMapIntensity: 0.95 }),
  'Qubit_Cover': Object.freeze({ envMapIntensity: 0.58 }),
  'CMOS Chip': Object.freeze({ envMapIntensity: 0.88 }),
  'Interposer_Silcon': Object.freeze({ envMapIntensity: 0.82 })
})

const MAJORANA_CLEARCOAT_FINISHES = Object.freeze({
  Bars: Object.freeze({ clearcoat: 0.8, clearcoatRoughness: 0.045 }),
  Chassis: Object.freeze({ clearcoat: 0.85, clearcoatRoughness: 0.04 })
})

function createClearcoatedMaterial(THREE, source, finish) {
  const material = new THREE.MeshPhysicalMaterial()

  // Copy the complete authored MeshStandard PBR bundle first. Calling the
  // physical copy method with a standard source would overwrite physical-only
  // fields with undefined values, so deliberately invoke the standard copy.
  THREE.MeshStandardMaterial.prototype.copy.call(material, source)
  material.defines = { STANDARD: '', PHYSICAL: '' }
  material.clearcoat = finish.clearcoat
  material.clearcoatRoughness = finish.clearcoatRoughness
  material.ior = 1.48
  material.needsUpdate = true
  return material
}

/**
 * Adds a smooth dielectric reflection lobe above the authored gold metal.
 * This creates the reference's white studio strips without flattening or
 * recolouring the metallic-roughness response underneath.
 */
export function applyMajoranaClearcoat(THREE, modelRoot) {
  if (!THREE?.MeshPhysicalMaterial || !modelRoot?.traverse) return 0

  const replacements = new Map()
  let replacementCount = 0

  const replaceMaterial = source => {
    const finish = MAJORANA_CLEARCOAT_FINISHES[source?.name]
    if (!finish) return source
    if (replacements.has(source)) return replacements.get(source)

    let material = source
    if (!source.isMeshPhysicalMaterial) {
      material = createClearcoatedMaterial(THREE, source, finish)
      source.dispose()
      replacementCount += 1
    } else {
      material.clearcoat = finish.clearcoat
      material.clearcoatRoughness = finish.clearcoatRoughness
      material.needsUpdate = true
    }
    replacements.set(source, material)
    return material
  }

  modelRoot.traverse(object => {
    if (!object?.isMesh || !object.material) return
    object.material = Array.isArray(object.material)
      ? object.material.map(replaceMaterial)
      : replaceMaterial(object.material)
  })

  return replacementCount
}

function applyMaterialFinish(material, finish) {
  if (!finish) return false

  if (Number.isFinite(finish.roughness)) material.roughness = finish.roughness
  if (Number.isFinite(finish.metalness)) material.metalness = finish.metalness
  if (Number.isFinite(finish.envMapIntensity)) {
    material.envMapIntensity = finish.envMapIntensity
  }
  if (Number.isFinite(finish.normalScale) && material.normalScale?.setScalar) {
    material.normalScale.setScalar(finish.normalScale)
  }
  material.needsUpdate = true
  return true
}

export function applyMajoranaReferencePalette(modelRoot) {
  const tunedMaterials = new Set()

  modelRoot?.traverse?.(object => {
    if (!object?.isMesh) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]

    materials.filter(Boolean).forEach(material => {
      if (tunedMaterials.has(material)) return
      const multiplier = MAJORANA_MATERIAL_COLOR_MULTIPLIERS[material.name]
      if (multiplier && material.color) {
        if (typeof multiplier === 'string') {
          material.color.set(multiplier)
        } else {
          material.color.setRGB(...multiplier)
        }
      }

      const finishApplied = applyMaterialFinish(
        material,
        MAJORANA_MATERIAL_FINISHES[material.name]
      )
      if (!multiplier && !finishApplied) return
      tunedMaterials.add(material)
    })
  })

  return tunedMaterials.size
}

/**
 * Applies live, non-destructive multipliers used by the development toolbar.
 * The authored maps and palette remain the baseline, so reloading always
 * restores the checked-in appearance.
 */
export function tuneMajoranaGoldMaterials(
  modelRoot,
  {
    reflectionScale = 1,
    clearcoatScale = 1,
    coatBlurScale = 1
  } = {}
) {
  const tunedMaterials = new Set()
  const safeReflection = Math.max(0, Number.isFinite(reflectionScale) ? reflectionScale : 1)
  const safeClearcoat = Math.max(0, Number.isFinite(clearcoatScale) ? clearcoatScale : 1)
  const safeCoatBlur = Math.max(0, Number.isFinite(coatBlurScale) ? coatBlurScale : 1)

  modelRoot?.traverse?.(object => {
    if (!object?.isMesh) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]

    materials.filter(Boolean).forEach(material => {
      if (tunedMaterials.has(material)) return
      const finish = MAJORANA_CLEARCOAT_FINISHES[material.name]
      if (!finish) return

      material.envMapIntensity =
        (MAJORANA_MATERIAL_FINISHES[material.name]?.envMapIntensity ?? 1) * safeReflection
      if (material.isMeshPhysicalMaterial) {
        material.clearcoat = Math.min(1, finish.clearcoat * safeClearcoat)
        material.clearcoatRoughness = Math.min(
          1,
          finish.clearcoatRoughness * safeCoatBlur
        )
      }
      material.needsUpdate = true
      tunedMaterials.add(material)
    })
  })

  return tunedMaterials.size
}

export function configureMajoranaTextureSampling(
  modelRoot,
  { minFilter, anisotropy = 1 } = {}
) {
  const tunedTextures = new Set()
  const safeAnisotropy = Math.max(1, Number.isFinite(anisotropy) ? anisotropy : 1)

  modelRoot?.traverse?.(object => {
    if (!object?.isMesh) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]

    materials.filter(Boolean).forEach(material => {
      Object.values(material).forEach(value => {
        if (!value?.isTexture || tunedTextures.has(value)) return
        if (minFilter !== undefined) value.minFilter = minFilter
        value.anisotropy = safeAnisotropy
        value.needsUpdate = true
        tunedTextures.add(value)
      })
    })
  })

  return tunedTextures.size
}
