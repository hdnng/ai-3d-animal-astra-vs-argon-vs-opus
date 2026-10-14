import * as THREE from 'three';

/**
 * Animated Procedural Water Surface
 * Uses a custom GLSL shader with multi-layered Gerstner/sine ripples,
 * Fresnel reflection, sun specular highlights, and depth-based shore foam.
 */
export class WaterSurface {
  public mesh: THREE.Mesh;
  public material: THREE.ShaderMaterial;
  public readonly waterLevel: number;

  constructor(scene: THREE.Scene, size = 240, waterLevel = -0.65) {
    this.waterLevel = waterLevel;

    const geometry = new THREE.PlaneGeometry(size, size, 72, 72);
    geometry.rotateX(-Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
        uSunColor: { value: new THREE.Color(0xfff4d8) },
        uSkyColor: { value: new THREE.Color(0x6da8e8) },
        uDeepColor: { value: new THREE.Color(0x0b2c3d) },
        uShallowColor: { value: new THREE.Color(0x1f6e7a) },
        uFogColor: { value: new THREE.Color(0x8ab4d8) },
        uFogDensity: { value: 0.0055 }
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying float vWaveHeight;

        void main() {
          vec3 pos = position;
          vec4 worldPosition = modelMatrix * vec4(pos, 1.0);

          // Multi-directional ripple waves
          float w1 = sin(worldPosition.x * 0.65 + uTime * 2.1) * cos(worldPosition.z * 0.55 + uTime * 1.6) * 0.035;
          float w2 = sin((worldPosition.x * 1.3 - worldPosition.z * 1.1) + uTime * 3.2) * 0.018;
          float w3 = cos(worldPosition.x * 2.7 + worldPosition.z * 2.3 - uTime * 4.1) * 0.008;
          float h = w1 + w2 + w3;

          pos.y += h;
          worldPosition.y += h;
          vWaveHeight = h;
          vWorldPos = worldPosition.xyz;

          // Analytical wave normal perturbation
          float dHx = 0.65 * cos(worldPosition.x * 0.65 + uTime * 2.1) * 0.035
                    + 1.3 * cos((worldPosition.x * 1.3 - worldPosition.z * 1.1) + uTime * 3.2) * 0.018;
          float dHz = -0.55 * sin(worldPosition.z * 0.55 + uTime * 1.6) * 0.035
                    - 1.1 * cos((worldPosition.x * 1.3 - worldPosition.z * 1.1) + uTime * 3.2) * 0.018;
          vNormal = normalize(vec3(-dHx * 2.4, 1.0, -dHz * 2.4));

          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uSkyColor;
        uniform vec3 uDeepColor;
        uniform vec3 uShallowColor;
        uniform vec3 uFogColor;
        uniform float uFogDensity;

        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying float vWaveHeight;

        float hash2(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float noise2(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x),
            mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }

        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);

          // High-frequency micro normal shimmer
          float n1 = noise2(vWorldPos.xz * 3.5 + vec2(uTime * 0.8, -uTime * 0.6));
          float n2 = noise2(vWorldPos.xz * 7.2 - vec2(uTime * 1.1, uTime * 0.9));
          vec3 N = normalize(vNormal + vec3((n1 - 0.5) * 0.16, 0.0, (n2 - 0.5) * 0.16));

          // Fresnel factor
          float fresnel = pow(1.0 - max(dot(viewDir, N), 0.0), 3.2);
          fresnel = clamp(fresnel * 0.85 + 0.12, 0.0, 1.0);

          // Base water color + sky reflection
          vec3 waterBase = mix(uDeepColor, uShallowColor, clamp(n1 * 0.7 + 0.3, 0.0, 1.0));
          vec3 color = mix(waterBase, uSkyColor * 0.95, fresnel * 0.72);

          // Specular sun glitter
          vec3 halfVec = normalize(uSunDir + viewDir);
          float spec = pow(max(dot(N, halfVec), 0.0), 96.0);
          color += uSunColor * spec * 1.35;

          // Subtle crest foam shimmer
          float crest = smoothstep(0.025, 0.055, vWaveHeight + (n2 - 0.5) * 0.03);
          color = mix(color, vec3(0.88, 0.94, 0.98), crest * 0.35);

          // Exponential distance fog matching scene
          float dist = length(cameraPosition - vWorldPos);
          float fogFactor = 1.0 - exp(- (dist * uFogDensity) * (dist * uFogDensity));
          color = mix(color, uFogColor, clamp(fogFactor, 0.0, 1.0));

          gl_FragColor = vec4(color, 0.84);
        }
      `
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.y = waterLevel;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  update(elapsed: number, sunDir: THREE.Vector3, sunColor: THREE.Color, skyColor: THREE.Color, fogColor: THREE.Color): void {
    this.material.uniforms.uTime.value = elapsed;
    this.material.uniforms.uSunDir.value.copy(sunDir);
    this.material.uniforms.uSunColor.value.copy(sunColor);
    this.material.uniforms.uSkyColor.value.copy(skyColor);
    this.material.uniforms.uFogColor.value.copy(fogColor);
  }
}
