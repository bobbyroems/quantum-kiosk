function createGlowMaterial(THREE, color, opacity, intensity, scale, depthTest, stencilRef) {
  const usesStencilMask = Number.isInteger(stencilRef)
  return new THREE.ShaderMaterial({
    blending: THREE.AdditiveBlending,
    depthTest,
    depthWrite: false,
    side: THREE.BackSide,
    toneMapped: false,
    transparent: true,
    stencilWrite: usesStencilMask,
    stencilRef: usesStencilMask ? stencilRef : 0,
    stencilFunc: usesStencilMask ? THREE.NotEqualStencilFunc : THREE.AlwaysStencilFunc,
    stencilFail: THREE.KeepStencilOp,
    stencilZFail: THREE.KeepStencilOp,
    stencilZPass: THREE.KeepStencilOp,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uCue: { value: 0 },
      uIntensity: { value: intensity },
      uOpacity: { value: opacity },
      uInnerRadius: { value: 1 / scale },
      uMotion: { value: 1 },
      uTime: { value: 0 }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDirection;

      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vViewDirection = normalize(-viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uCue;
      uniform float uIntensity;
      uniform float uOpacity;
      uniform float uInnerRadius;
      uniform float uMotion;
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vViewDirection;

      void main() {
        vec3 normal = normalize(vNormal);
        float facing = abs(dot(normal, normalize(vViewDirection)));

        /* Convert Fresnel facing to projected screen radius, then normalize the
           exact visible distance between the solid buoy and the shell edge.
           This keeps the opacity journey spatially even instead of compressing
           most of it into the outer few pixels. */
        float screenRadius = sqrt(max(1.0 - (facing * facing), 0.0));
        float travel = clamp(
          (screenRadius - uInnerRadius) / max(1.0 - uInnerRadius, 0.001),
          0.0,
          1.0
        );
        float halo = 1.0 - travel;

        float motionTime = uTime * uMotion;
        float pulse = 0.96 + (0.04 * sin(motionTime * 1.35));
        float vapour = 0.96 + (0.04 * sin(
          (normal.x * 5.0) + (normal.y * 7.0) + (motionTime * 0.36)
        ));
        float radiance = max(uIntensity, 0.0);
        float alpha = uCue * uOpacity * halo * pulse * vapour * radiance;
        vec3 glowColor = uColor * (0.82 + (radiance * 0.28));
        gl_FragColor = vec4(glowColor, alpha);
      }
    `
  })
}

/* Callers scale the returned mesh to choose the halo radius and update its
   single colour uniform to transition between semantic states. Depth testing
   stays on by default, but scene-specific treatments may opt out. */
export function createFresnelGlow(THREE, geometry, options = {}) {
  const color = options.color ?? '#8fffe9'
  const intensity = Number.isFinite(options.intensity) ? Math.max(0, options.intensity) : 1
  const opacity = Number.isFinite(options.opacity) ? Math.max(0, options.opacity) : 0.78
  const scale = Number.isFinite(options.scale) ? Math.max(1, options.scale) : 1.82
  const depthTest = options.depthTest !== false
  const material = createGlowMaterial(
    THREE,
    color,
    opacity,
    intensity,
    scale,
    depthTest,
    options.stencilRef
  )
  const glow = new THREE.Mesh(geometry, material)
  glow.scale.setScalar(scale)
  glow.userData.materials = [material]
  glow.visible = false
  return glow
}

export function updateFresnelGlow(glow, options = {}) {
  const cue = Math.max(0, Math.min(1, Number.isFinite(options.cue) ? options.cue : 0))
  const time = Number.isFinite(options.time) ? options.time : 0
  const motion = options.motion === false ? 0 : 1
  const [material] = glow?.userData?.materials ?? []
  if (material) {
    if (options.color) material.uniforms.uColor.value.copy(options.color)
    if (Number.isFinite(options.intensity)) {
      material.uniforms.uIntensity.value = Math.max(0, options.intensity)
    }
    material.uniforms.uCue.value = cue
    material.uniforms.uMotion.value = motion
    material.uniforms.uTime.value = time
  }
  if (glow) glow.visible = cue > 0.001
}

export function disposeFresnelGlow(glow) {
  for (const material of glow?.userData?.materials ?? []) material.dispose()
}
