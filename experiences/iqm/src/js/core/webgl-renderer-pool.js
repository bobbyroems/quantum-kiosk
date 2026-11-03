const poolsByThree = new WeakMap()
const allEntries = new Set()

const CONTEXT_OPTION_KEYS = [
  'alpha',
  'antialias',
  'depth',
  'failIfMajorPerformanceCaveat',
  'logarithmicDepthBuffer',
  'powerPreference',
  'precision',
  'premultipliedAlpha',
  'preserveDrawingBuffer',
  'reverseDepthBuffer',
  'stencil'
]

function contextKey(options) {
  if (options.canvas || options.context) {
    throw new TypeError('Pooled WebGL renderers must own their canvas and context.')
  }

  return CONTEXT_OPTION_KEYS
    .map(key => `${key}:${JSON.stringify(options[key] ?? null)}`)
    .join('|')
}

/*
 * A pooled renderer outlives every scene that borrows it, so anything the last
 * lessee configured is inherited by the next one. Left alone that is how a
 * leak returns: a scene that forgets to turn shadows back off gets a shadow map
 * allocated on a renderer nothing ever disposes. Reset the dials to three.js
 * defaults, and strip the canvas so no class, dataset entry or ARIA attribute
 * from the previous module survives either.
 */
function resetRenderer(entry) {
  const { renderer, THREE } = entry
  renderer.setAnimationLoop?.(null)
  renderer.setRenderTarget?.(null)
  renderer.setScissorTest?.(false)
  renderer.renderLists?.dispose?.()
  renderer.state?.reset?.()
  renderer.info?.reset?.()

  if (renderer.shadowMap) {
    renderer.shadowMap.enabled = false
    if (THREE?.PCFShadowMap !== undefined) renderer.shadowMap.type = THREE.PCFShadowMap
  }
  if (THREE?.NoToneMapping !== undefined) renderer.toneMapping = THREE.NoToneMapping
  renderer.toneMappingExposure = 1
  if (THREE?.SRGBColorSpace !== undefined) renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.autoClear = true
  renderer.sortObjects = true
  renderer.localClippingEnabled = false
  renderer.clippingPlanes = []
  renderer.setClearColor?.(0x000000, 0)
}

function resetCanvas(canvas) {
  if (!canvas) return
  for (const attribute of canvas.getAttributeNames?.() ?? []) {
    canvas.removeAttribute(attribute)
  }
  canvas.width = 1
  canvas.height = 1
  canvas.remove?.()
}

function releaseEntry(entry) {
  if (!entry.inUse) return
  const { renderer } = entry

  resetRenderer(entry)
  renderer.setSize?.(1, 1, false)
  resetCanvas(renderer.domElement)
  entry.inUse = false
}

/**
 * Lease an app-lifetime renderer instead of creating and explicitly losing a
 * WebGL context on every kiosk visit. Callers still own and must dispose every
 * scene resource they create before releasing the lease.
 */
export function leaseWebGLRenderer(THREE, options = {}) {
  if (!THREE?.WebGLRenderer) throw new TypeError('THREE.WebGLRenderer is required.')

  let pools = poolsByThree.get(THREE)
  if (!pools) {
    pools = new Map()
    poolsByThree.set(THREE, pools)
  }

  const key = contextKey(options)
  let entries = pools.get(key)
  if (!entries) {
    entries = []
    pools.set(key, entries)
  }

  let entry = entries.find(candidate => !candidate.inUse)
  if (!entry) {
    entry = {
      renderer: new THREE.WebGLRenderer(options),
      THREE,
      inUse: false
    }
    entries.push(entry)
    allEntries.add(entry)
  }
  entry.inUse = true

  let released = false
  return {
    renderer: entry.renderer,
    release() {
      if (released) return
      released = true
      releaseEntry(entry)
    }
  }
}

/** Release native resources only when the page itself is going away. */
export function disposePooledWebGLRenderers() {
  for (const entry of allEntries) {
    releaseEntry(entry)
    entry.renderer.dispose?.()
    entry.renderer.forceContextLoss?.()
  }
  allEntries.clear()
}

globalThis.addEventListener?.('pagehide', disposePooledWebGLRenderers, { once: true })
