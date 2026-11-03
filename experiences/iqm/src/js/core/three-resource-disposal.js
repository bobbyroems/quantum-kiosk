function collectTexture(value, textures) {
  if (!value) return
  if (value.isTexture) {
    textures.add(value)
    return
  }
  if (Array.isArray(value)) value.forEach(item => collectTexture(item, textures))
}

/**
 * Dispose resources created for one Object3D tree while preserving borrowed
 * app-lifetime assets such as preloaded geometry and texture maps.
 */
export function disposeObject3DResources(root, { preserve = new Set() } = {}) {
  const geometries = new Set()
  const instancedMeshes = new Set()
  const materials = new Set()
  const textures = new Set()

  root?.traverse?.(object => {
    if (object.isInstancedMesh) instancedMeshes.add(object)
    if (object.geometry) geometries.add(object.geometry)
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material]
    for (const material of objectMaterials) if (material) materials.add(material)
  })

  for (const material of materials) {
    for (const value of Object.values(material)) collectTexture(value, textures)
    for (const uniform of Object.values(material.uniforms ?? {})) {
      collectTexture(uniform?.value, textures)
    }
  }

  for (const texture of textures) if (!preserve.has(texture)) texture.dispose?.()
  for (const material of materials) if (!preserve.has(material)) material.dispose?.()
  for (const geometry of geometries) if (!preserve.has(geometry)) geometry.dispose?.()
  for (const mesh of instancedMeshes) if (!preserve.has(mesh)) mesh.dispose?.()
}
