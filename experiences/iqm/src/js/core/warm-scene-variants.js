/** Prepare first-use effects while the caller still covers the canvas. */
export async function warmSceneVariants(renderer, scene, camera, { fadeMaterials = [], signal } = {}) {
  const objects = []
  const materials = [...new Set(fadeMaterials)].map(material => ({
    material, transparent: material.transparent, opacity: material.opacity, depthWrite: material.depthWrite
  }))
  const checkAbort = () => signal?.throwIfAborted()
  const draw = async () => {
    checkAbort()
    // Let compilation finish before the caller disposes its scene: Three's
    // parallel-compile polling still reads the materials until it settles.
    await renderer.compileAsync(scene, camera)
    checkAbort()
    // Compile alone does not upload geometry/instance buffers and textures.
    // Use the real canvas so output color-space variants match gameplay.
    renderer.render(scene, camera)
  }
  try {
    checkAbort()
    scene.traverse(object => {
      objects.push({ object, visible: object.visible, frustumCulled: object.frustumCulled })
      if (!object.isLight) object.visible = true
      object.frustumCulled = false
    })
    await draw()
    if (materials.length) {
      for (const { material } of materials) {
        material.transparent = true
        material.opacity = 0.5
        material.depthWrite = false
        material.needsUpdate = true
      }
      await draw()
    }
  } finally {
    for (const { material, transparent, opacity, depthWrite } of materials) {
      if (material.transparent !== transparent) material.needsUpdate = true
      Object.assign(material, { transparent, opacity, depthWrite })
    }
    for (const { object, visible, frustumCulled } of objects) {
      Object.assign(object, { visible, frustumCulled })
    }
  }
}
