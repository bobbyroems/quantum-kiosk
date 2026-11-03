/*
 * Concept-module placeholder scene: the error-correction ball on a grid
 * floor with a blurred contact shadow. The ball itself (tiles, materials,
 * state machine) lives in error-correction-ball.js and is shared with the
 * menu carousel previews.
 */

import {
  createBallTemplate,
  createBrushedEnv,
  createErrorCorrectionBall,
  BALL_ACCENT_LIGHTS,
  BALL_KEY_LIGHT
} from './error-correction-ball.js'
import { disposeObject3DResources } from './three-resource-disposal.js'
import { leaseWebGLRenderer } from './webgl-renderer-pool.js'

const ROTATION_SPEED = 0.1

const SHADOW = Object.freeze({ blur: 4.5, darkness: 0.9, opacity: 0.32, size: 3.2, camHeight: 3 })
const GRID = Object.freeze({ spacing: 0.55, opacity: 0.4, fadeRadius: 4, color: '#b4bac3' })
const GROUND_Y = -1.55

export async function mountConceptSphere(host) {
  const [THREE, { RoomEnvironment }, BufferGeometryUtils, { HorizontalBlurShader }, { VerticalBlurShader }, { SubsurfaceScatteringShader }] =
    await Promise.all([
      import('three'),
      import('three/addons/environments/RoomEnvironment.js'),
      import('three/addons/utils/BufferGeometryUtils.js'),
      import('three/addons/shaders/HorizontalBlurShader.js'),
      import('three/addons/shaders/VerticalBlurShader.js'),
      import('three/addons/shaders/SubsurfaceScatteringShader.js')
    ])

  if (!host.isConnected) return () => {}

  let rendererLease
  try {
    rendererLease = leaseWebGLRenderer(THREE, { antialias: true, alpha: true })
  } catch (error) {
    console.warn('Concept sphere: WebGL is unavailable.', error)
    return () => {}
  }
  const { renderer } = rendererLease

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1
  renderer.setClearColor(0x000000, 0)
  host.append(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50)
  camera.position.set(0, 0.35, 3.6)
  camera.lookAt(0, 0, 0)

  const pmrem = new THREE.PMREMGenerator(renderer)
  const roomEnvironment = new RoomEnvironment()
  const environmentTarget = pmrem.fromScene(roomEnvironment, 0.04)
  disposeObject3DResources(roomEnvironment)
  scene.environment = environmentTarget.texture
  scene.environmentIntensity = 0.35

  const keyLight = new THREE.DirectionalLight(BALL_KEY_LIGHT.color, BALL_KEY_LIGHT.intensity)
  keyLight.position.set(...BALL_KEY_LIGHT.position)
  scene.add(keyLight)
  scene.add(new THREE.HemisphereLight(0xf2f5fa, 0xc9cdd4, 0.5))
  for (const def of BALL_ACCENT_LIGHTS) {
    const light = new THREE.PointLight(def.color, def.intensity, 0, 2)
    light.position.set(...def.position)
    scene.add(light)
  }

  const template = createBallTemplate(THREE, BufferGeometryUtils)
  const brushedEnvironment = createBrushedEnv(THREE, pmrem)
  const ball = createErrorCorrectionBall({
    THREE,
    SubsurfaceScatteringShader,
    template,
    brushedEnv: brushedEnvironment.texture,
    viewDir: camera.position.clone().normalize()
  })
  scene.add(ball.group)

  /* ---- contact shadow (after webgl_shadow_contact) ---- */
  const shadowGroup = new THREE.Group()
  shadowGroup.position.y = GROUND_Y
  scene.add(shadowGroup)

  const shadowRT = new THREE.WebGLRenderTarget(512, 512)
  shadowRT.texture.generateMipmaps = false
  const shadowRTBlur = new THREE.WebGLRenderTarget(512, 512)
  shadowRTBlur.texture.generateMipmaps = false

  const shadowPlaneGeo = new THREE.PlaneGeometry(SHADOW.size, SHADOW.size).rotateX(Math.PI / 2)
  const shadowPlane = new THREE.Mesh(shadowPlaneGeo, new THREE.MeshBasicMaterial({
    map: shadowRT.texture,
    opacity: SHADOW.opacity,
    transparent: true,
    depthWrite: false
  }))
  shadowPlane.scale.y = -1
  shadowPlane.renderOrder = 1
  shadowGroup.add(shadowPlane)

  const blurPlane = new THREE.Mesh(shadowPlaneGeo)
  blurPlane.visible = false
  blurPlane.layers.enable(1)
  shadowGroup.add(blurPlane)

  const shadowCam = new THREE.OrthographicCamera(
    -SHADOW.size / 2, SHADOW.size / 2, SHADOW.size / 2, -SHADOW.size / 2, 0, SHADOW.camHeight
  )
  shadowCam.rotation.x = Math.PI / 2
  shadowCam.layers.set(1)
  shadowGroup.add(shadowCam)
  ball.tileMesh.layers.enable(1)
  ball.coreMesh.layers.enable(1)

  const shadowDepthMat = new THREE.MeshDepthMaterial()
  shadowDepthMat.userData.darkness = { value: SHADOW.darkness }
  shadowDepthMat.onBeforeCompile = shader => {
    shader.uniforms.darkness = shadowDepthMat.userData.darkness
    shader.fragmentShader = 'uniform float darkness;\n' + shader.fragmentShader.replace(
      'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
      'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );'
    )
  }
  shadowDepthMat.depthTest = false
  shadowDepthMat.depthWrite = false

  const hBlurMat = new THREE.ShaderMaterial(HorizontalBlurShader)
  hBlurMat.depthTest = false
  const vBlurMat = new THREE.ShaderMaterial(VerticalBlurShader)
  vBlurMat.depthTest = false

  function blurShadow(amount) {
    blurPlane.visible = true
    blurPlane.material = hBlurMat
    hBlurMat.uniforms.tDiffuse.value = shadowRT.texture
    hBlurMat.uniforms.h.value = amount / 256
    renderer.setRenderTarget(shadowRTBlur)
    renderer.render(blurPlane, shadowCam)
    blurPlane.material = vBlurMat
    vBlurMat.uniforms.tDiffuse.value = shadowRTBlur.texture
    vBlurMat.uniforms.v.value = amount / 256
    renderer.setRenderTarget(shadowRT)
    renderer.render(blurPlane, shadowCam)
    blurPlane.visible = false
  }

  function renderContactShadow() {
    scene.overrideMaterial = shadowDepthMat
    renderer.setRenderTarget(shadowRT)
    renderer.render(scene, shadowCam)
    scene.overrideMaterial = null
    blurShadow(SHADOW.blur)
    blurShadow(SHADOW.blur * 0.4)
    renderer.setRenderTarget(null)
  }

  /* ---- grid floor fading at the edges ---- */
  const gridUniforms = {
    uColor: { value: new THREE.Color(GRID.color).convertSRGBToLinear() },
    uSpacing: { value: GRID.spacing },
    uOpacity: { value: GRID.opacity },
    uFadeRadius: { value: GRID.fadeRadius }
  }
  const gridMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.ShaderMaterial({
      uniforms: gridUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorldPos;
        uniform vec3 uColor;
        uniform float uSpacing, uOpacity, uFadeRadius;
        void main() {
          /* grid pattern rotated 45 degrees */
          vec2 p = vec2(vWorldPos.x - vWorldPos.z, vWorldPos.x + vWorldPos.z) * 0.7071068;
          vec2 coord = p / uSpacing;
          vec2 g = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
          float line = 1.0 - min(min(g.x, g.y), 1.0);
          float fade = 1.0 - smoothstep(uFadeRadius * 0.3, uFadeRadius, length(vWorldPos.xz));
          gl_FragColor = vec4(uColor, line * fade * uOpacity);
        }
      `
    })
  )
  gridMesh.rotation.x = -Math.PI / 2
  gridMesh.position.y = GROUND_Y - 0.002
  gridMesh.renderOrder = 0
  scene.add(gridMesh)

  /* ---- sizing ---- */
  function resize() {
    const width = Math.max(2, host.clientWidth)
    const height = Math.max(2, host.clientHeight)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height)
  }
  resize()
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(host)

  /* ---- loop ---- */
  const clock = new THREE.Clock()
  let disposed = false
  let animationFrame = null
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

  function frame() {
    if (disposed) return
    animationFrame = window.requestAnimationFrame(frame)
    const dt = Math.min(clock.getDelta(), 0.05)
    if (!reducedMotion.matches) ball.group.rotation.y += dt * ROTATION_SPEED
    ball.update(clock.elapsedTime)
    renderContactShadow()
    renderer.render(scene, camera)
  }
  animationFrame = window.requestAnimationFrame(frame)

  return function dispose() {
    disposed = true
    if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
    resizeObserver.disconnect()
    ball.dispose()
    template.dispose()
    gridMesh.geometry.dispose()
    gridMesh.material.dispose()
    shadowPlaneGeo.dispose()
    shadowPlane.material.dispose()
    shadowDepthMat.dispose()
    hBlurMat.dispose()
    vBlurMat.dispose()
    shadowRT.dispose()
    shadowRTBlur.dispose()
    scene.environment = null
    brushedEnvironment.dispose()
    environmentTarget.dispose()
    pmrem.dispose()
    rendererLease.release()
  }
}
