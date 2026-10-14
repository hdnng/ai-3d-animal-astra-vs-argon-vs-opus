/**
 * Animated water surface. Depth comes from the terrain heightmap texture, so
 * the shader can tint shallow vs deep water, fade the shoreline, draw foam
 * and show ripple rings without a depth pre-pass. Reflections use the same
 * analytic sky function as the sky dome; the sun produces a sharp glint.
 */
import * as THREE from 'three';
import { globalUniforms } from '../render/Uniforms';
import { GLSL_HASH, GLSL_NOISE } from '../render/shaders/common';
import { GLSL_SKY } from './Sky';
import { HALF, LAKE, WORLD_SIZE, WATER_LEVEL } from './WorldGen';

const MAX_RIPPLES = 16;

export class Water {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private ripples: THREE.Vector4[] = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0));
  private rippleIdx = 0;

  constructor(heightTex: THREE.Texture, noiseTex: THREE.Texture) {
    const size = LAKE.r * 3.4;
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.material = new THREE.ShaderMaterial({
      name: 'WaterMaterial',
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uHeight: { value: heightTex },
          uNoise: { value: noiseTex },
          uRipples: { value: this.ripples },
        },
      ]),
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform sampler2D uHeight;
        uniform sampler2D uNoise;
        uniform float uTime;
        uniform vec3 uCameraPos;
        uniform vec2 uWindDir;
        uniform float uWindStrength;
        uniform float uNight;
        uniform float uWetness;
        uniform vec4 uRipples[${MAX_RIPPLES}];
        varying vec3 vWorld;
        ${GLSL_HASH}
        ${GLSL_NOISE}
        ${GLSL_SKY}
        vec2 waveGrad(vec2 p) {
          vec2 g = vec2(0.0);
          float t = uTime;
          vec2 w = uWindDir;
          // layered scrolling noise normals
          vec4 a = texture2D(uNoise, p * 0.06 + w * t * 0.02);
          vec4 b = texture2D(uNoise, p * 0.17 - w.yx * t * 0.035);
          vec4 c = texture2D(uNoise, p * 0.55 + vec2(t * 0.05, -t * 0.03));
          g += (a.rg - 0.5) * 0.9 + (b.ba - 0.5) * 0.6 + (c.rg - 0.5) * 0.35;
          // rain drops
          if (uWetness > 0.01) {
            vec2 cell = floor(p * 2.5);
            vec2 f = fract(p * 2.5) - 0.5;
            float h = hash21(cell + floor(t * 1.7));
            float ph = fract(t * 1.7 + h);
            float r = length(f - (hash22(cell) - 0.5) * 0.4);
            float ring = sin((r - ph * 0.5) * 60.0) * (1.0 - smoothstep(0.0, 0.5, r)) * (1.0 - ph);
            g += normalize(f + 1e-4) * ring * 0.35 * uWetness;
          }
          // interactive ripples
          for (int i = 0; i < ${MAX_RIPPLES}; i++) {
            vec4 rp = uRipples[i];
            float age = t - rp.z;
            if (age < 0.0 || age > 3.0) continue;
            vec2 d = p - rp.xy;
            float r = length(d);
            float front = age * 1.6;
            float ring = sin((r - front) * 14.0) * exp(-abs(r - front) * 3.0) * exp(-age * 1.2) * rp.w;
            g += (d / max(r, 1e-3)) * ring * 0.8;
          }
          return g * (0.5 + uWindStrength);
        }
        void main() {
          vec2 uvH = (vWorld.xz + ${HALF.toFixed(1)}) / ${WORLD_SIZE.toFixed(1)};
          float ground = texture2D(uHeight, uvH).r;
          float depth = ${WATER_LEVEL.toFixed(2)} - ground;
          if (depth < -0.05) discard;
          vec2 g = waveGrad(vWorld.xz);
          vec3 N = normalize(vec3(-g.x * 0.12, 1.0, -g.y * 0.12));
          vec3 V = normalize(uCameraPos - vWorld);
          float NdV = max(dot(N, V), 0.0);
          float fresnel = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
          vec3 R = reflect(-V, N);
          R.y = abs(R.y);
          vec3 refl = skyGradient(R);
          // water body colour by depth
          vec3 shallow = vec3(0.16, 0.26, 0.2);
          vec3 deep = vec3(0.02, 0.07, 0.09);
          float dk = 1.0 - exp(-max(depth, 0.0) * 0.9);
          vec3 body = mix(shallow, deep, dk);
          vec3 skyAmb = mix(uSkyHorizon, uSkyZenith, 0.5);
          body *= skyAmb * 1.6 + uSunColor * max(uSunDir.y, 0.0) * 0.5;
          vec3 col = mix(body, refl, fresnel);
          // sun glint
          vec3 H = normalize(uSunDir + V);
          float spec = pow(max(dot(N, H), 0.0), 600.0) * 18.0 + pow(max(dot(N, H), 0.0), 60.0) * 0.3;
          col += uSunColor * spec * smoothstep(-0.02, 0.1, uSunDir.y);
          // shoreline foam
          float foamN = vnoise2(vWorld.xz * 3.0 + uTime * 0.4) * 0.6 + vnoise2(vWorld.xz * 7.0 - uTime * 0.3) * 0.4;
          float foam = (1.0 - smoothstep(0.0, 0.18, depth)) * smoothstep(0.35, 0.65, foamN + sin(depth * 30.0 - uTime * 2.0) * 0.15);
          col = mix(col, vec3(0.85, 0.88, 0.86) * (skyAmb + uSunColor * 0.4), foam * 0.6 * (1.0 - uNight * 0.7));
          float alpha = smoothstep(-0.05, 0.25, depth) * mix(0.55, 0.93, dk);
          alpha = max(alpha, fresnel * smoothstep(-0.05, 0.05, depth));
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
    });
    const u = this.material.uniforms;
    u.uTime = globalUniforms.uTime;
    u.uCameraPos = globalUniforms.uCameraPos;
    u.uWindDir = globalUniforms.uWindDir;
    u.uWindStrength = globalUniforms.uWindStrength;
    u.uNight = globalUniforms.uNight;
    u.uWetness = globalUniforms.uWetness;
    u.uSunDir = globalUniforms.uSunDir;
    u.uMoonDir = globalUniforms.uMoonDir;
    u.uSkyZenith = globalUniforms.uSkyZenith;
    u.uSkyHorizon = globalUniforms.uSkyHorizon;
    u.uSunGlow = globalUniforms.uSunGlow;
    u.uSunColor = globalUniforms.uSunColor;
    u.uLightning = globalUniforms.uLightning;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.set(LAKE.x, WATER_LEVEL, LAKE.z);
    this.mesh.name = 'water';
    this.mesh.renderOrder = 2;
    this.mesh.receiveShadow = false;
  }

  /** Spawns an expanding ripple ring at (x,z). */
  ripple(x: number, z: number, time: number, strength = 1): void {
    this.ripples[this.rippleIdx].set(x, z, time, strength);
    this.rippleIdx = (this.rippleIdx + 1) % MAX_RIPPLES;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
