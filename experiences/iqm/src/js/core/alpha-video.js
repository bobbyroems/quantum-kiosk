/**
 * Plays the alpha clips produced by scripts/pack-alpha-video.mjs.
 *
 * Three layouts exist and the manifest says which a clip uses.
 *
 * 'alpha-webm' is the default: VP9 in WebM with a real alpha channel, straight
 * (not premultiplied), which the browser composites itself. There is no canvas
 * and no shader — the element is a positioned <video>. Measured on an RTX 3090
 * it also beat the packed alternative outright: 1.2ms median decode against
 * 99.9ms, and 26.3fps against 23.8 with three clips running at once, mostly
 * because it decodes half the pixels.
 *
 * 'over-under' is the fallback: colour in the top half of each frame and the
 * matte in the bottom, premultiplied, recombined by a two-tap fragment shader.
 * It exists because VP9 hardware decode varies far more by GPU than H.264 does
 * and the kiosk PC's GPU is not specified anywhere. That path draws through
 * WebGL rather than a 2D canvas because a 2D composite pass would read the
 * frame back twice per draw and cost more than the decode.
 *
 * The shader path only redraws when the decoder hands over a new frame, via
 * requestVideoFrameCallback, so a paused clip costs nothing and a 30fps clip
 * costs 30 draws per second rather than the 60 a naive rAF loop would spend
 * re-uploading frames the decoder never changed.
 *
 * Placement comes from the manifest either way. Every master was authored
 * inside a square 4096 composition and then cropped to its alpha bounding box,
 * so a clip's on-screen rectangle is its crop expressed as a fraction of that
 * composition. Callers hand over the box the composition maps onto and the clip
 * positions itself inside it.
 */

import { assetUrl } from './asset-url.js'
import {
  abortError,
  releaseVideoElement,
  throwIfAborted
} from './media-lifecycle.js'

export const DEFAULT_MANIFEST_PATH = 'assets/video-fx/manifest.json'

/* See createStillPlate: decode() can hang forever on a hidden tab. */
const STILL_DECODE_TIMEOUT_MS = 2000

const VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  /* y is flipped here rather than with UNPACK_FLIP_Y_WEBGL so the texture
     upload stays on the driver's fast path for video frames. */
  vUv = vec2(aPosition.x * 0.5 + 0.5, 0.5 - aPosition.y * 0.5);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uPacked;
uniform float uOpacity;
uniform float uHalfTexel;
varying vec2 vUv;

void main() {
  /* Clamped half a texel inside each half so linear filtering at the seam
     cannot pull color into the matte or the other way round. */
  float colorV = clamp(vUv.y * 0.5, uHalfTexel, 0.5 - uHalfTexel);
  float matteV = clamp(vUv.y * 0.5 + 0.5, 0.5 + uHalfTexel, 1.0 - uHalfTexel);

  vec3 color = texture2D(uPacked, vec2(vUv.x, colorV)).rgb;
  float alpha = texture2D(uPacked, vec2(vUv.x, matteV)).r;

  /* The two halves are compressed independently, so a soft edge can end up
     with color slightly above its own alpha. Left alone that reads as a bright
     fringe; clamping costs one instruction and removes it. */
  color = min(color, vec3(alpha));

  gl_FragColor = vec4(color, alpha) * uOpacity;
}
`

/**
 * GLSL for modules that already own a three.js material and want to sample a
 * packed clip themselves rather than composite through this helper's canvas.
 * Pair it with a THREE.VideoTexture and premultiplied blending.
 */
/* `packed` is a reserved word in GLSL ES, so the sampler cannot be named after
   what it holds — naming it that fails to compile rather than misbehaving. */
export const ALPHA_VIDEO_GLSL = `
vec4 sampleAlphaVideo(sampler2D packedTexture, vec2 uv, float halfTexel) {
  float colorV = clamp(uv.y * 0.5, halfTexel, 0.5 - halfTexel);
  float matteV = clamp(uv.y * 0.5 + 0.5, 0.5 + halfTexel, 1.0 - halfTexel);
  vec3 color = texture2D(packedTexture, vec2(uv.x, colorV)).rgb;
  float alpha = texture2D(packedTexture, vec2(uv.x, matteV)).r;
  return vec4(min(color, vec3(alpha)), alpha);
}
`

let manifestPromise = null

/** Loads and caches the packed-clip manifest. */
export function loadAlphaVideoManifest(path = DEFAULT_MANIFEST_PATH) {
  if (!manifestPromise) {
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), 15000)
    manifestPromise = fetch(assetUrl(path), { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error(`Alpha video manifest ${path} failed: ${response.status}`)
      return response.json()
    }).catch(error => {
      manifestPromise = null
      throw error
    }).finally(() => clearTimeout(deadline))
  }
  return manifestPromise
}

/** Discards the cached manifest. Only useful for tests. */
export function resetAlphaVideoManifest() {
  manifestPromise = null
}

/**
 * The clip's rectangle inside the box its source composition maps onto,
 * as fractions in 0..1. Multiply by a stage rect to place it in pixels.
 */
export function placementOf(clip) {
  return {
    left: clip.crop.x / clip.frame.width,
    top: clip.crop.y / clip.frame.height,
    width: clip.crop.width / clip.frame.width,
    height: clip.crop.height / clip.frame.height
  }
}

/** Positions an element on its clip's rectangle within the composition box. */
function applyPlacement(element, clip) {
  const placement = placementOf(clip)
  element.style.position = 'absolute'
  element.style.left = `${placement.left * 100}%`
  element.style.top = `${placement.top * 100}%`
  element.style.width = `${placement.width * 100}%`
  element.style.height = `${placement.height * 100}%`
  element.style.pointerEvents = 'none'
}

function compile(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Alpha video shader failed to compile: ${log}`)
  }
  return shader
}

function createProgram(gl) {
  const program = gl.createProgram()
  let vertex = null
  let fragment = null
  try {
    vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
  } catch (error) {
    gl.deleteProgram(program)
    throw error
  } finally {
    if (vertex) gl.deleteShader(vertex)
    if (fragment) gl.deleteShader(fragment)
  }
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`Alpha video program failed to link: ${log}`)
  }
  return program
}

function createVideoElement(source, { loop, muted = true }) {
  const video = document.createElement('video')
  video.src = source
  video.loop = loop
  video.muted = muted
  video.playsInline = true
  video.preload = 'auto'
  video.setAttribute('aria-hidden', 'true')
  /* Kept out of the layout but not display:none — Chromium throttles decoding
     for elements it believes are invisible, which stalls the first frame. */
  video.style.position = 'absolute'
  video.style.width = '1px'
  video.style.height = '1px'
  video.style.opacity = '0'
  video.style.pointerEvents = 'none'
  return video
}

/* A stalled decode must not be able to hang whatever is awaiting the clip.
   Chromium suspends media loading entirely for a window it is not compositing,
   and readyState simply sits at 0 with no error event ever firing — so a bare
   wait here is a wait with no upper bound. */
function waitForFirstFrame(video, signal, timeoutMs = 15000) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (signal?.aborted) {
      rejectPromise(abortError(signal))
      return
    }
    if (video.readyState >= 2) {
      resolvePromise()
      return
    }
    const timer = setTimeout(() => {
      settle()
      rejectPromise(new Error(`Alpha video stalled before its first frame: ${video.src}`))
    }, timeoutMs)
    const settle = () => {
      clearTimeout(timer)
      video.removeEventListener('loadeddata', onLoaded)
      video.removeEventListener('error', onError)
      signal?.removeEventListener('abort', onAbort)
    }
    const onLoaded = () => { settle(); resolvePromise() }
    const onError = () => {
      settle()
      rejectPromise(video.error ?? new Error('Alpha video failed to load'))
    }
    const onAbort = () => { settle(); rejectPromise(abortError(signal)) }

    video.addEventListener('loadeddata', onLoaded, { once: true })
    video.addEventListener('error', onError, { once: true })
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/* A seek is part of setup for several hidden one-shot clips. It needs the same
   abort and deadline guarantees as first-frame loading; otherwise a decoder
   that never emits `seeked` retains the entire partially mounted video stack. */
function waitForSeek(video, signal, timeoutMs = 5000) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (signal?.aborted) {
      rejectPromise(abortError(signal))
      return
    }
    const timer = setTimeout(() => {
      settle()
      rejectPromise(new Error(`Alpha video stalled while seeking: ${video.src}`))
    }, timeoutMs)
    const settle = () => {
      clearTimeout(timer)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      signal?.removeEventListener('abort', onAbort)
    }
    const onSeeked = () => { settle(); resolvePromise() }
    const onError = () => {
      settle()
      rejectPromise(video.error ?? new Error('Alpha video failed while seeking'))
    }
    const onAbort = () => { settle(); rejectPromise(abortError(signal)) }

    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onError, { once: true })
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function waitForStillDecode(image, signal) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (signal?.aborted) {
      rejectPromise(abortError(signal))
      return
    }
    const timer = setTimeout(() => settle(resolvePromise), STILL_DECODE_TIMEOUT_MS)
    const onAbort = () => settle(() => rejectPromise(abortError(signal)))
    const settle = callback => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      Promise.resolve(image.decode())
        .catch(() => {})
        .then(() => settle(resolvePromise))
    } catch {
      settle(resolvePromise)
    }
  })
}

/* The 'over-under' fallback: unpacks the two halves through a shader. */
async function createPackedAlphaVideo({
  clip,
  container,
  loop,
  autoplay,
  opacity,
  basePath,
  signal
}) {
  const canvas = document.createElement('canvas')
  canvas.width = clip.color.width
  canvas.height = clip.color.height
  canvas.setAttribute('aria-hidden', 'true')

  const gl = canvas.getContext('webgl', {
    alpha: true,
    /* The shader emits premultiplied color, matching how the clip was encoded;
       telling the compositor that avoids a needless unmultiply on every draw. */
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance'
  })
  if (!gl) throw new Error('Alpha video needs a WebGL context')

  const video = createVideoElement(assetUrl(`${basePath}${clip.file}`), { loop })

  let program = null
  let buffer = null
  let texture = null
  let uniforms = null
  let frameHandle = 0
  let usingFrameCallback = false
  let currentOpacity = opacity
  let disposed = false

  function buildGpuResources() {
    program = createProgram(gl)
    uniforms = {
      packed: gl.getUniformLocation(program, 'uPacked'),
      opacity: gl.getUniformLocation(program, 'uOpacity'),
      halfTexel: gl.getUniformLocation(program, 'uHalfTexel')
    }

    buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'aPosition')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

    texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    gl.useProgram(program)
    gl.uniform1i(uniforms.packed, 0)
    gl.uniform1f(uniforms.halfTexel, 0.5 / clip.packed.height)
    gl.uniform1f(uniforms.opacity, currentOpacity)
    gl.viewport(0, 0, canvas.width, canvas.height)
  }

  function draw() {
    if (disposed || gl.isContextLost() || video.readyState < 2) return
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video)
    gl.useProgram(program)
    gl.uniform1f(uniforms.opacity, currentOpacity)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  function scheduleNextFrame() {
    if (disposed) return
    if (usingFrameCallback) {
      frameHandle = video.requestVideoFrameCallback(onFrame)
      return
    }
    frameHandle = requestAnimationFrame(onFrame)
  }

  function onFrame() {
    draw()
    if (!video.paused && !video.ended) scheduleNextFrame()
    else frameHandle = 0
  }

  function startFrameLoop() {
    if (frameHandle) return
    scheduleNextFrame()
  }

  function stopFrameLoop() {
    if (!frameHandle) return
    if (usingFrameCallback) video.cancelVideoFrameCallback(frameHandle)
    else cancelAnimationFrame(frameHandle)
    frameHandle = 0
  }

  function onContextLost(event) {
    /* Preventing the default is what makes restoration possible at all. A kiosk
       runs for days, and a driver reset must not leave a dead black rectangle
       where the effect was. */
    event.preventDefault()
    stopFrameLoop()
  }

  function onContextRestored() {
    if (disposed) return
    try {
      buildGpuResources()
      draw()
      if (!video.paused) startFrameLoop()
    } catch (error) {
      /* A failed restore cannot leave a decoder and a second half-built set of
         GL objects running behind an empty canvas. */
      cleanup()
      console.warn('Alpha video graphics context could not be restored.', error)
    }
  }

  function cleanup() {
    if (disposed) return
    disposed = true
    stopFrameLoop()
    signal?.removeEventListener('abort', cleanup)
    canvas.removeEventListener('webglcontextlost', onContextLost)
    canvas.removeEventListener('webglcontextrestored', onContextRestored)
    /* Order matters: drop GL objects while the context is still alive, then
       detach the source so Chromium releases the decoder. Every handle is
       conditional because setup may have failed between two allocations. */
    if (texture) gl.deleteTexture(texture)
    if (buffer) gl.deleteBuffer(buffer)
    if (program) gl.deleteProgram(program)
    texture = null
    buffer = null
    program = null
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    releaseVideoElement(video, { remove: true })
    canvas.remove()
  }

  const instance = {
    clip,
    canvas,
    video,
    /* The visible element, so callers can style one thing without caring which
       path a clip took. It is the canvas here and the video on the WebM path. */
    element: canvas,
    placement: placementOf(clip),

    async play() {
      if (disposed) return
      await video.play()
      if (!disposed) startFrameLoop()
    },

    pause() {
      video.pause()
      stopFrameLoop()
    },

    /* Seeking while paused still needs one draw, otherwise the canvas keeps
       showing the frame the decoder handed over before the seek. */
    async seek(seconds) {
      throwIfAborted(signal)
      if (disposed) throw abortError(signal)
      const target = Number(seconds) || 0
      if (!video.seeking && Math.abs(video.currentTime - target) < 0.001) {
        draw()
        return
      }
      video.currentTime = target
      await waitForSeek(video, signal)
      draw()
    },

    setOpacity(value) {
      currentOpacity = value
      draw()
    },

    dispose() {
      cleanup()
    }
  }

  try {
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)
    signal?.addEventListener('abort', cleanup, { once: true })

    usingFrameCallback = typeof video.requestVideoFrameCallback === 'function'
    buildGpuResources()

    if (container) {
      applyPlacement(canvas, clip)
      container.append(video, canvas)
    } else {
      /* Callers that place the canvas themselves still need the source element
         attached somewhere: Chromium throttles decoding for a detached video and
         the first frame can take seconds to arrive. */
      document.body.append(video)
    }

    await waitForFirstFrame(video, signal)
    throwIfAborted(signal)
    draw()
    if (autoplay) await instance.play()
    throwIfAborted(signal)
    return instance
  } catch (error) {
    cleanup()
    throw error
  }
}

/* The default 'alpha-webm' path. The browser composites a real alpha channel
   itself, so there is no canvas, no shader and no per-frame texture upload —
   the clip is a positioned <video> and nothing more. */
/**
 * A still plate. Several passes in the device stack do not move — the base
 * device, the plate over Particles A, the "H" bar — and they arrive as PNGs
 * from the same composition the clips were authored in. They place themselves
 * from the same crop rectangle, so the stack does not care which of its layers
 * happen to be moving.
 *
 * The transport methods are present and inert rather than absent, so a caller
 * can drive a mixed stack without asking each layer what it is.
 */
async function createStillPlate({ clip, container, opacity, basePath, signal }) {
  const image = document.createElement('img')
  image.src = assetUrl(`${basePath}${clip.file}`)
  image.alt = ''
  image.decoding = 'async'
  image.setAttribute('aria-hidden', 'true')
  image.style.opacity = String(opacity)

  if (clip.blend && clip.blend !== 'normal') {
    image.style.mixBlendMode = clip.blend
  }

  if (container) {
    applyPlacement(image, clip)
    container.append(image)
  }

  let disposed = false
  const cleanup = () => {
    if (disposed) return
    disposed = true
    signal?.removeEventListener('abort', cleanup)
    image.removeAttribute('src')
    image.remove()
  }
  signal?.addEventListener('abort', cleanup, { once: true })

  /* Decoded before returning, for the same reason the clip paths wait for a
     first frame: the caller is about to reveal the stack and a plate that
     decodes late pops in over the layers beneath it.

     Raced against a deadline because decode() is allowed to simply never
     settle — a backgrounded tab will park it indefinitely on an image that has
     already fully loaded. Waiting is an optimisation; the plate is on screen
     either way, so it must not be able to hold up the stack behind it. */
  try {
    await waitForStillDecode(image, signal)
    throwIfAborted(signal)
  } catch (error) {
    cleanup()
    throw error
  }

  const instance = {
    clip,
    video: null,
    element: image,
    canvas: null,
    placement: placementOf(clip),

    async play() {},
    pause() {},
    async seek() {},

    setOpacity(value) {
      image.style.opacity = String(value)
    },

    dispose() {
      cleanup()
    }
  }
  return instance
}

async function createAlphaWebmVideo({
  clip,
  container,
  loop,
  autoplay,
  opacity,
  basePath,
  signal
}) {
  const video = document.createElement('video')
  video.src = assetUrl(`${basePath}${clip.file}`)
  video.loop = loop
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.setAttribute('aria-hidden', 'true')
  video.style.opacity = String(opacity)

  /* An additive clip has no alpha channel: it is already premultiplied, so it
     is black wherever the effect is absent and the blend adds nothing there.
     plus-lighter is true addition, which is what the design's "Add/Screen Mode"
     asks for — screen would compress the highlights and lose the sense of light
     stacking up where two passes overlap. */
  if (clip.blend && clip.blend !== 'normal') {
    video.style.mixBlendMode = clip.blend
  }

  let disposed = false
  const cleanup = () => {
    if (disposed) return
    disposed = true
    signal?.removeEventListener('abort', cleanup)
    releaseVideoElement(video, { remove: true })
  }
  const instance = {
    clip,
    video,
    /* No canvas on this path. Callers that style the visible element should use
       `element`, which is the video here and the canvas on the packed path. */
    element: video,
    canvas: null,
    placement: placementOf(clip),

    async play() {
      if (disposed) return
      await video.play()
    },

    pause() {
      video.pause()
    },

    async seek(seconds) {
      throwIfAborted(signal)
      if (disposed) throw abortError(signal)
      const target = Number(seconds) || 0
      if (!video.seeking && Math.abs(video.currentTime - target) < 0.001) return
      video.currentTime = target
      await waitForSeek(video, signal)
    },

    setOpacity(value) {
      video.style.opacity = String(value)
    },

    dispose() {
      cleanup()
    }
  }

  try {
    signal?.addEventListener('abort', cleanup, { once: true })
    if (container) {
      applyPlacement(video, clip)
      container.append(video)
    }
    await waitForFirstFrame(video, signal)
    throwIfAborted(signal)
    if (autoplay) await instance.play()
    throwIfAborted(signal)
    return instance
  } catch (error) {
    cleanup()
    throw error
  }
}

/**
 * Creates a player for one alpha clip, picking the path its manifest entry
 * asks for. Both return the same shape, so callers do not need to know which
 * encoding a clip happens to use.
 *
 * @param {object} options
 * @param {object} options.manifest manifest from loadAlphaVideoManifest
 * @param {string} options.id clip id, the manifest key
 * @param {Element} [options.container] appended to and positioned within
 * @param {boolean} [options.loop]
 * @param {boolean} [options.autoplay]
 * @param {number} [options.opacity]
 * @param {string} [options.basePath] directory holding the clips
 * @param {AbortSignal} [options.signal]
 */
export async function createAlphaVideo({
  manifest,
  id,
  container = null,
  loop = false,
  autoplay = false,
  opacity = 1,
  basePath = 'assets/video-fx/',
  signal
} = {}) {
  throwIfAborted(signal)
  const clip = manifest?.clips?.[id]
  if (!clip) throw new Error(`Unknown alpha video clip: ${id}`)

  const settings = { clip, container, loop, autoplay, opacity, basePath, signal }
  /* Older manifests predate the field and were all packed. */
  if (clip.layout === 'still') return createStillPlate(settings)
  return clip.layout === 'over-under'
    ? createPackedAlphaVideo(settings)
    : createAlphaWebmVideo(settings)
}
