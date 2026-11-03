export function createCurvedGradientLink(THREE, { start, end, colorA, colorB, radius, trim, castShadow, curveStrength = 0.5 }) {
  const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5)
  const direction = new THREE.Vector3().subVectors(end, start)
  const distance = direction.length()

  // Curve outward perpendicular to the line
  const up = new THREE.Vector3(0, 1, 0)
  const perpendicular = new THREE.Vector3().crossVectors(direction, up).normalize()
  if (perpendicular.length() < 0.1) {
    perpendicular.set(1, 0, 0)
  }
  const controlPoint = midpoint.clone().add(perpendicular.multiplyScalar(distance * curveStrength))

  const curve = new THREE.QuadraticBezierCurve3(start.clone(), controlPoint, end.clone())

  const trimAmount = trim ? trim / 2 : 0
  const trimmedCurve = trimAmount > 0 ? {
    getPoints: (n) => {
      const fullPoints = curve.getPoints(n + 4)
      const totalLen = curve.getLength()
      const startT = trimAmount / totalLen
      const endT = 1 - (trimAmount / totalLen)
      return curve.getPoints(n).map((_, i) => curve.getPoint(startT + (endT - startT) * (i / n)))
    },
    getPoint: (t) => {
      const totalLen = curve.getLength()
      const startT = trimAmount / totalLen
      const endT = 1 - (trimAmount / totalLen)
      return curve.getPoint(startT + (endT - startT) * t)
    }
  } : curve

  const geometry = new THREE.TubeGeometry(trimAmount > 0 ? new THREE.QuadraticBezierCurve3(
    curve.getPoint(trimAmount / curve.getLength()),
    controlPoint,
    curve.getPoint(1 - trimAmount / curve.getLength())
  ) : curve, 32, radius, 12, false)

  const material = new THREE.ShaderMaterial({
    uniforms: {
      colorA: { value: colorA.clone() },
      colorB: { value: colorB.clone() },
      emissiveStrength: { value: 1.35 },
      flowSpeed: { value: 0.55 },
      time: { value: 0 },
      opacity: { value: 1 },
      progress: { value: 1 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 colorA;
      uniform vec3 colorB;
      uniform float emissiveStrength;
      uniform float flowSpeed;
      uniform float time;
      uniform float opacity;
      uniform float progress;
      varying vec2 vUv;
      void main() {
        // Discard pixels beyond progress (creates shoot-out effect)
        if (vUv.x > progress) discard;

        vec3 color = mix(colorA, colorB, vUv.x);
        float phase = fract(vUv.x - time * flowSpeed);
        float pulse = smoothstep(0.32, 0.0, abs(phase - 0.5));
        color *= (emissiveStrength + pulse * 0.65);
        color *= opacity;
        gl_FragColor = vec4(color, 0.9 * opacity);
      }
    `,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    toneMapped: false
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = Boolean(castShadow)
  return mesh
}

export function createGradientLink(THREE, { start, end, colorA, colorB, radius, trim, castShadow }) {
  const direction = new THREE.Vector3().subVectors(end, start)
  const distance = direction.length()
  const length = Math.max(0.1, distance - trim)
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 24, 1, true)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      colorA: { value: colorA.clone() },
      colorB: { value: colorB.clone() },
      emissiveStrength: { value: 1.35 },
      flowSpeed: { value: 0.55 },
      time: { value: 0 },
      opacity: { value: 1 },
      progress: { value: 1 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 colorA;
      uniform vec3 colorB;
      uniform float emissiveStrength;
      uniform float flowSpeed;
      uniform float time;
      uniform float opacity;
      uniform float progress;
      varying vec2 vUv;
      void main() {
        // Discard pixels beyond progress (creates shoot-out effect)
        if (vUv.y > progress) discard;

        vec3 color = mix(colorA, colorB, vUv.y);
        float phase = fract(vUv.y - time * flowSpeed);
        float pulse = smoothstep(0.32, 0.0, abs(phase - 0.5));
        color *= (emissiveStrength + pulse * 0.65);
        color *= opacity;
        gl_FragColor = vec4(color, 0.9 * opacity);
      }
    `,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    toneMapped: false
  })
  const mesh = new THREE.Mesh(geometry, material)
  const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5)
  direction.normalize()
  mesh.position.copy(midpoint)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction)
  mesh.castShadow = Boolean(castShadow)
  return mesh
}

export function syncConnectionColors(links, time) {
  if (!links.length) return
  links.forEach((link) => {
    const { startSphere, endSphere } = link.userData || {}
    const uniforms = link.material && link.material.uniforms
    if (!uniforms || !startSphere || !endSphere) return
    if (uniforms.time && typeof time === 'number') {
      uniforms.time.value = time
    }
    if (startSphere.userData && startSphere.userData.dyeColor) {
      uniforms.colorA.value.copy(startSphere.userData.dyeColor)
    }
    if (endSphere.userData && endSphere.userData.dyeColor) {
      uniforms.colorB.value.copy(endSphere.userData.dyeColor)
    }
  })
}
