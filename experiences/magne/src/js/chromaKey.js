/**
 * Chroma Key Video Processor (WebGL-accelerated)
 * Removes a target color (default: white) from video and renders to canvas
 * Uses GPU shaders for high performance
 */

class ChromaKeyVideo {
  constructor(options = {}) {
    this.video = options.video
    this.canvas = options.canvas
    this.threshold = (options.threshold || 30) / 255 // Normalize to 0-1
    this.targetColor = options.targetColor || { r: 255, g: 255, b: 255 }

    this.isRunning = false
    this._frameId = null
    this._useWebGL = true

    // Try WebGL first, fallback to Canvas2D
    if (!this._initWebGL()) {
      console.warn('WebGL not available, falling back to Canvas2D')
      this._useWebGL = false
      this._initCanvas2D()
    }

    this._init()
  }

  _initWebGL() {
    const gl = this.canvas.getContext('webgl', {
      premultipliedAlpha: false,
      alpha: true
    })

    if (!gl) return false

    this.gl = gl

    // Vertex shader - just passes through coordinates
    const vertexShaderSrc = `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_texCoord;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
    `

    // Fragment shader - does the chroma key magic on GPU
    const fragmentShaderSrc = `
      precision mediump float;
      uniform sampler2D u_image;
      uniform vec3 u_targetColor;
      uniform float u_threshold;
      varying vec2 v_texCoord;

      void main() {
        vec4 color = texture2D(u_image, v_texCoord);

        // Calculate difference from target color
        vec3 diff = abs(color.rgb - u_targetColor);
        float maxDiff = max(max(diff.r, diff.g), diff.b);

        // Smooth alpha based on distance from target color
        float alpha = smoothstep(u_threshold, u_threshold * 2.0, maxDiff);

        gl_FragColor = vec4(color.rgb, color.a * alpha);
      }
    `

    // Compile shaders
    const vertexShader = this._createShader(gl, gl.VERTEX_SHADER, vertexShaderSrc)
    const fragmentShader = this._createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSrc)

    if (!vertexShader || !fragmentShader) return false

    // Create program
    const program = gl.createProgram()
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program))
      return false
    }

    this.program = program

    // Get attribute/uniform locations
    this.positionLocation = gl.getAttribLocation(program, 'a_position')
    this.texCoordLocation = gl.getAttribLocation(program, 'a_texCoord')
    this.imageLocation = gl.getUniformLocation(program, 'u_image')
    this.targetColorLocation = gl.getUniformLocation(program, 'u_targetColor')
    this.thresholdLocation = gl.getUniformLocation(program, 'u_threshold')

    // Create buffers
    // Position buffer (fullscreen quad)
    this.positionBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1
    ]), gl.STATIC_DRAW)

    // Texture coordinate buffer
    this.texCoordBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0, 1,
      1, 1,
      0, 0,
      0, 0,
      1, 1,
      1, 0
    ]), gl.STATIC_DRAW)

    // Create texture for video
    this.texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    // Enable blending for transparency
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    return true
  }

  _createShader(gl, type, source) {
    const shader = gl.createShader(type)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader))
      gl.deleteShader(shader)
      return null
    }

    return shader
  }

  _initCanvas2D() {
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })
    this.offscreenCanvas = document.createElement('canvas')
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true })
  }

  _init() {
    this._boundOnPlay = () => this.start()
    this._boundOnPause = () => this.stop()
    this._boundOnEnded = () => this.stop()
    this._boundOnMetadata = () => this._resize()

    this.video.addEventListener('loadedmetadata', this._boundOnMetadata)
    this.video.addEventListener('play', this._boundOnPlay)
    this.video.addEventListener('pause', this._boundOnPause)
    this.video.addEventListener('ended', this._boundOnEnded)

    if (this.video.readyState >= 1) {
      this._resize()
    }
  }

  _resize() {
    const width = this.video.videoWidth
    const height = this.video.videoHeight

    this.canvas.width = width
    this.canvas.height = height

    if (this._useWebGL && this.gl) {
      this.gl.viewport(0, 0, width, height)
    } else if (this.offscreenCanvas) {
      this.offscreenCanvas.width = width
      this.offscreenCanvas.height = height
    }
  }

  start() {
    if (this.isRunning) return
    this.isRunning = true
    this._processFrame()
  }

  stop() {
    this.isRunning = false
    if (this._frameId) {
      cancelAnimationFrame(this._frameId)
      this._frameId = null
    }
  }

  _processFrame() {
    if (!this.isRunning) return

    if (this._useWebGL) {
      this._processFrameWebGL()
    } else {
      this._processFrameCanvas2D()
    }

    this._frameId = requestAnimationFrame(() => this._processFrame())
  }

  _processFrameWebGL() {
    const gl = this.gl

    // Clear canvas
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    // Use program
    gl.useProgram(this.program)

    // Update video texture
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video)

    // Set uniforms
    gl.uniform1i(this.imageLocation, 0)
    gl.uniform3f(
      this.targetColorLocation,
      this.targetColor.r / 255,
      this.targetColor.g / 255,
      this.targetColor.b / 255
    )
    gl.uniform1f(this.thresholdLocation, this.threshold)

    // Set position attribute
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer)
    gl.enableVertexAttribArray(this.positionLocation)
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0)

    // Set texCoord attribute
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer)
    gl.enableVertexAttribArray(this.texCoordLocation)
    gl.vertexAttribPointer(this.texCoordLocation, 2, gl.FLOAT, false, 0, 0)

    // Draw
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  _processFrameCanvas2D() {
    // Fallback: CPU-based processing (slower)
    this.offscreenCtx.drawImage(
      this.video,
      0, 0,
      this.offscreenCanvas.width,
      this.offscreenCanvas.height
    )

    const imageData = this.offscreenCtx.getImageData(
      0, 0,
      this.offscreenCanvas.width,
      this.offscreenCanvas.height
    )
    const data = imageData.data

    const { r: tr, g: tg, b: tb } = this.targetColor
    const threshold = this.threshold * 255

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]

      const diffR = Math.abs(r - tr)
      const diffG = Math.abs(g - tg)
      const diffB = Math.abs(b - tb)

      if (diffR < threshold && diffG < threshold && diffB < threshold) {
        data[i + 3] = 0
      } else if (diffR < threshold * 2 && diffG < threshold * 2 && diffB < threshold * 2) {
        const maxDiff = Math.max(diffR, diffG, diffB)
        const alpha = Math.min(255, (maxDiff / (threshold * 2)) * 255)
        data[i + 3] = alpha
      }
    }

    this.ctx.putImageData(imageData, 0, 0)
  }

  setThreshold(value) {
    this.threshold = value / 255
  }

  setTargetColor(r, g, b) {
    this.targetColor = { r, g, b }
  }

  destroy() {
    this.stop()

    this.video.removeEventListener('loadedmetadata', this._boundOnMetadata)
    this.video.removeEventListener('play', this._boundOnPlay)
    this.video.removeEventListener('pause', this._boundOnPause)
    this.video.removeEventListener('ended', this._boundOnEnded)

    if (this._useWebGL && this.gl) {
      const gl = this.gl
      gl.deleteTexture(this.texture)
      gl.deleteBuffer(this.positionBuffer)
      gl.deleteBuffer(this.texCoordBuffer)
      gl.deleteProgram(this.program)
    }
  }
}

window.ChromaKeyVideo = ChromaKeyVideo
