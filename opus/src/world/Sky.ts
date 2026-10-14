/**
 * Procedural sky dome: gradient atmosphere, sun disk + mie glow, moon with
 * phase, twinkling stars, milky way band and animated fbm clouds.
 */
import * as THREE from 'three';
import { globalUniforms } from '../render/Uniforms';
import { GLSL_HASH } from '../render/shaders/common';

export const GLSL_SKY = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSunGlow;
uniform vec3 uSunColor;
uniform float uLightning;
vec3 skyGradient(vec3 dir) {
  float y = dir.y;
  float t = pow(clamp(y, 0.0, 1.0), 0.42);
  vec3 col = mix(uSkyHorizon, uSkyZenith, t);
  // Horizon glow toward the sun (sunset band).
  vec3 sd = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-5);
  float az = max(dot(normalize(vec3(dir.x, 0.0, dir.z) + 1e-5), sd), 0.0);
  float band = pow(1.0 - clamp(abs(y) * 2.4, 0.0, 1.0), 3.0);
  col += uSunGlow * band * (0.25 + 0.75 * pow(az, 3.0)) * 0.55;
  float mu = max(dot(dir, uSunDir), 0.0);
  col += uSunGlow * (pow(mu, 6.0) * 0.22 + pow(mu, 48.0) * 0.45);
  // Below the horizon blend into a darker haze.
  col = mix(col, uSkyHorizon * 0.75, (1.0 - smoothstep(-0.25, 0.0, y)));
  col += vec3(0.55, 0.6, 0.8) * uLightning * 0.8;
  return col;
}
`;

export class Sky {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(noiseTex: THREE.Texture) {
    const geo = new THREE.SphereGeometry(900, 48, 24);
    this.material = new THREE.ShaderMaterial({
      name: 'SkyMaterial',
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
      uniforms: {
        uSunDir: globalUniforms.uSunDir,
        uMoonDir: globalUniforms.uMoonDir,
        uSkyZenith: globalUniforms.uSkyZenith,
        uSkyHorizon: globalUniforms.uSkyHorizon,
        uSunGlow: globalUniforms.uSunGlow,
        uSunColor: globalUniforms.uSunColor,
        uTime: globalUniforms.uTime,
        uCloudCover: globalUniforms.uCloudCover,
        uCloudColor: globalUniforms.uCloudColor,
        uStarVis: globalUniforms.uStarVis,
        uMoonPhase: globalUniforms.uMoonPhase,
        uLightning: globalUniforms.uLightning,
        uWindDir: globalUniforms.uWindDir,
        uNoise: { value: noiseTex },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww; // push to far plane
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform float uTime;
        uniform float uCloudCover;
        uniform vec3 uCloudColor;
        uniform float uStarVis;
        uniform float uMoonPhase;
        uniform vec2 uWindDir;
        uniform sampler2D uNoise;
        // Texture-based fbm: 3 fetches instead of ~60 procedural hashes.
        float tfbm(vec2 p) {
          return texture2D(uNoise, p * 0.25).r * 0.5 + texture2D(uNoise, p * 0.25 * 2.03 + 0.37).g * 0.3 + texture2D(uNoise, p * 0.25 * 4.1 + 0.71).b * 0.2;
        }
        ${GLSL_HASH}
        ${GLSL_SKY}
        float stars(vec3 d) {
          vec3 p = d * 220.0;
          vec3 c = floor(p);
          vec3 f = fract(p) - 0.5;
          float h = hash31(c);
          if (h < 0.965) return 0.0;
          vec3 o = (hash33(c) - 0.5) * 0.6;
          float r = length(f - o);
          float tw = 0.65 + 0.35 * sin(uTime * (2.0 + h * 5.0) + h * 40.0);
          return (1.0 - smoothstep(0.0, 0.16, r)) * (h - 0.965) * 28.0 * tw;
        }
        void main() {
          vec3 dir = normalize(vDir);
          vec3 col = skyGradient(dir);
          float up = clamp(dir.y, 0.0, 1.0);

          // Stars and milky way.
          if (uStarVis > 0.001) {
            float s = stars(dir) + stars(dir.zxy * 1.37) * 0.6;
            vec3 mwAxis = normalize(vec3(0.3, 0.55, 0.78));
            float band = 1.0 - abs(dot(dir, mwAxis));
            float mw = pow(band, 18.0) * smoothstep(0.35, 0.75, tfbm(dir.xz * 6.0 + dir.y * 3.0));
            col += uStarVis * (vec3(s) * vec3(0.9, 0.95, 1.0) + vec3(0.05, 0.055, 0.085) * mw) * smoothstep(0.0, 0.15, dir.y);
          }

          // Sun disk.
          float mu = dot(dir, uSunDir);
          float sunDisk = smoothstep(0.99955, 0.99975, mu);
          col += uSunColor * sunDisk * 18.0 * smoothstep(-0.02, 0.02, uSunDir.y);

          // Moon with simple phase terminator and craters.
          float mm = dot(dir, uMoonDir);
          float moonR = 0.0275;
          float md = acos(clamp(mm, -1.0, 1.0));
          if (md < moonR * 1.2) {
            vec3 mr = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
            vec3 mu2 = cross(mr, uMoonDir);
            vec2 lp = vec2(dot(dir - uMoonDir, mr), dot(dir - uMoonDir, mu2)) / moonR;
            float r2 = dot(lp, lp);
            if (r2 < 1.0) {
              vec3 n = vec3(lp, sqrt(1.0 - r2));
              float phaseX = cos(uMoonPhase * 6.2831);
              float lit = smoothstep(-0.08, 0.08, dot(n, normalize(vec3(-sin(uMoonPhase * 6.2831), 0.0, phaseX))));
              float crater = 0.75 + 0.25 * tfbm(lp * 3.5 + 7.0);
              vec3 moonCol = vec3(0.95, 0.93, 0.85) * crater * (0.06 + lit * 1.6);
              float edge = (1.0 - smoothstep(0.92, 1.0, r2));
              col = mix(col, moonCol, edge * smoothstep(-0.05, 0.05, uMoonDir.y));
            }
          }
          col += vec3(0.5, 0.55, 0.7) * pow(max(mm, 0.0), 900.0) * 0.6 * uStarVis;
          col += vec3(0.25, 0.3, 0.45) * pow(max(mm, 0.0), 40.0) * 0.12 * uStarVis;

          // Clouds on a virtual plane.
          if (dir.y > 0.0) {
            vec2 uv = dir.xz / (dir.y + 0.08) * 0.9;
            vec2 drift = uWindDir * uTime * 0.012;
            float n = tfbm(uv * 0.9 + drift);
            n += 0.35 * tfbm(uv * 2.7 - drift * 1.7);
            float cover = mix(1.15, 0.55, uCloudCover);
            float dens = smoothstep(cover - 0.15, cover + 0.35, n);
            float lightN = tfbm(uv * 0.9 + drift + uSunDir.xz * 0.12);
            float shade = clamp(1.0 - (lightN - n) * 2.5, 0.35, 1.25);
            vec3 cloud = uCloudColor * mix(0.55, 1.15, shade);
            float silver = pow(max(mu, 0.0), 12.0) * (1.0 - dens) * 2.0;
            cloud += uSunGlow * silver;
            float fade = smoothstep(0.0, 0.18, dir.y);
            col = mix(col, cloud, dens * fade * 0.92);
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'sky';
    this.mesh.frustumCulled = false;
    // Drawn after all opaque geometry: depth testing then skips covered pixels.
    this.mesh.renderOrder = 1000;
  }

  update(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
