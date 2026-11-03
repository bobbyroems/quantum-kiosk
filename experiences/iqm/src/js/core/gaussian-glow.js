/* A compact screen-facing alternative to a full bloom post-process. The
   corona is evaluated per pixel on one quad, giving a continuous falloff
   without concentric geometry shells or extra render targets. Scene depth is
   still respected so opaque geometry can pass in front of the halo. */
export function createGaussianGlow(THREE, options = {}) {
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1)
  const material = new THREE.ShaderMaterial({
    /* Normal alpha blending lets the inner rim become genuinely saturated on
       pale surfaces. Additive blending could only brighten the background,
       which made strong green values look milky and transparent. */
    blending: THREE.NormalBlending,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
    transparent: true,
    uniforms: {
      uColor: { value: new THREE.Color(options.color ?? 0xffffff) },
      uCue: { value: 0 },
      uIntensity: { value: Number.isFinite(options.intensity) ? options.intensity : 1 },
      uFalloff: { value: Number.isFinite(options.falloff) ? options.falloff : 3.6 },
      uTime: { value: 0 },
      uMotion: { value: 1 }
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        vec4 centre = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec2 billboardScale = vec2(
          length(modelMatrix[0].xyz),
          length(modelMatrix[1].xyz)
        );
        centre.xy += position.xy * billboardScale;
        gl_Position = projectionMatrix * centre;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uCue;
      uniform float uIntensity;
      uniform float uFalloff;
      uniform float uTime;
      uniform float uMotion;
      varying vec2 vUv;

      void main() {
        vec2 point = (vUv - 0.5) * 2.0;
        float radius = length(point);
        // The source sphere fills roughly the inner half of this billboard.
        // Start at a bounded opacity on its silhouette, then follow one smooth,
        // monotonic solar-corona curve all the way to transparent.
        float outsideSphere = smoothstep(0.46, 0.505, radius);
        float edgeDistance = max(radius - 0.49, 0.0);
        float sunFalloff = exp(-pow(edgeDistance * uFalloff, 1.45));
        float edgeFeather = 1.0 - smoothstep(0.9, 1.0, radius);
        float pulse = 0.97 + (0.03 * sin(uTime * uMotion * 1.35));
        float halo = sunFalloff * outsideSphere * edgeFeather;
        float alpha = min(halo * uCue * uIntensity * pulse * 0.74, 0.96);
        gl_FragColor = vec4(uColor * 1.05, alpha);
      }
    `
  })
  const glow = new THREE.Mesh(geometry, material)
  glow.visible = false
  glow.userData.glowMaterial = material
  return glow
}

export function updateGaussianGlow(glow, options = {}) {
  const material = glow?.userData?.glowMaterial
  if (!material) return
  const cue = Math.max(0, Math.min(1, Number.isFinite(options.cue) ? options.cue : 0))
  if (options.color) material.uniforms.uColor.value.copy(options.color)
  if (Number.isFinite(options.intensity)) {
    material.uniforms.uIntensity.value = Math.max(0, options.intensity)
  }
  if (Number.isFinite(options.falloff)) {
    material.uniforms.uFalloff.value = Math.max(0.001, options.falloff)
  }
  material.uniforms.uCue.value = cue
  material.uniforms.uTime.value = Number.isFinite(options.time) ? options.time : 0
  material.uniforms.uMotion.value = options.motion === false ? 0 : 1
  glow.visible = cue > 0.001
}

export function disposeGaussianGlow(glow) {
  glow?.geometry?.dispose()
  glow?.userData?.glowMaterial?.dispose()
}
