const initializedLibraries = new WeakSet()

/**
 * Three.js creates four new LTC lookup textures every time init() runs.
 * Those renderer-shared textures are app-lifetime resources, so initialize
 * each imported library exactly once instead of replacing them per scene.
 */
export function ensureRectAreaLightUniformsInitialized(RectAreaLightUniformsLib) {
  if (!RectAreaLightUniformsLib || initializedLibraries.has(RectAreaLightUniformsLib)) {
    return
  }

  RectAreaLightUniformsLib.init()
  initializedLibraries.add(RectAreaLightUniformsLib)
}
