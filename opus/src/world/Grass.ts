/**
 * GPU grass. Blades live in a square around the camera; each instance's world
 * position is wrapped with mod() so blades stay fixed in the world as the
 * camera moves (no CPU updates at all). Heights/density come from the terrain
 * height + biome textures. Two layers (dense near, sparse far tufts), wind
 * gusts, creature interaction (blades bend away from animals) and sun
 * translucency.
 */
import * as THREE from 'three';
import { globalUniforms } from '../render/Uniforms';
import { HALF, WORLD_SIZE } from './WorldGen';
import { Random } from '../utils/Random';

interface Layer {
  mesh: THREE.Mesh;
  geometry: THREE.InstancedBufferGeometry;
  material: THREE.MeshLambertMaterial;
  total: number;
}

function bladeGeometry(segments: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let s = 0; s < segments; s++) {
    const t = s / segments;
    const w = 0.5 * Math.pow(1 - t, 0.7);
    pos.push(-w, t, 0, w, t, 0);
  }
  pos.push(0, 1, 0);
  for (let s = 0; s < segments - 1; s++) {
    const a = s * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = (segments - 1) * 2;
  idx.push(last, last + 1, segments * 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(pos.length).fill(1), 3));
  g.setIndex(idx);
  return g;
}

export class Grass {
  readonly group = new THREE.Group();
  private layers: Layer[] = [];
  private density = 1;

  constructor(heightTex: THREE.Texture, splatTex: THREE.Texture, noiseTex: THREE.Texture, seed: number) {
    this.group.name = 'grass';
    this.layers.push(this.makeLayer('near', 20, 42000, 0.05, 1.0, heightTex, splatTex, noiseTex, seed, 0, 2));
    this.layers.push(this.makeLayer('far', 50, 24000, 0.075, 0.7, heightTex, splatTex, noiseTex, seed + 1, 18, 1));
  }

  private makeLayer(
    name: string,
    radius: number,
    count: number,
    width: number,
    heightScale: number,
    heightTex: THREE.Texture,
    splatTex: THREE.Texture,
    noiseTex: THREE.Texture,
    seed: number,
    innerFade: number,
    segments: number,
  ): Layer {
    const blade = bladeGeometry(segments);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = blade.index;
    for (const k of Object.keys(blade.attributes)) geo.setAttribute(k, blade.attributes[k]);
    const rnd = new Random(seed);
    const offs = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      offs[i * 4] = (rnd.next() * 2 - 1) * radius;
      offs[i * 4 + 1] = (rnd.next() * 2 - 1) * radius;
      offs[i * 4 + 2] = rnd.next();
      offs[i * 4 + 3] = rnd.next();
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offs, 4));
    geo.instanceCount = count;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        uHeight: { value: heightTex },
        uSplat: { value: splatTex },
        uNoise: { value: noiseTex },
        uCam: globalUniforms.uCameraPos,
        uTime: globalUniforms.uTime,
        uWindDir: globalUniforms.uWindDir,
        uWindStrength: globalUniforms.uWindStrength,
        uInteractors: globalUniforms.uInteractors,
        uSunDir: globalUniforms.uSunDir,
        uSunColor: globalUniforms.uSunColor,
        uWetness: globalUniforms.uWetness,
      });
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec4 aOffset;
          uniform sampler2D uHeight;
          uniform sampler2D uSplat;
          uniform sampler2D uNoise;
          uniform vec3 uCam;
          uniform vec4 uInteractors[8];
          uniform float uWetness;
          varying vec3 vGrassView;
          varying float vTip;
          uniform float uTime;
          uniform vec2 uWindDir;
          uniform float uWindStrength;
          // Gusts from the noise texture (cheaper than procedural noise per vertex).
          vec3 grassWind(vec3 wp, float h) {
            vec2 p = wp.xz * 0.012 - uWindDir * uTime * 0.14;
            float gust = textureLod(uNoise, p, 0.0).r * 1.5 - 0.35 + textureLod(uNoise, p * 3.7, 0.0).g * 0.5;
            float sway = sin(uTime * 1.9 + wp.x * 0.21 + wp.z * 0.17) * 0.25 + gust;
            float amt = uWindStrength * sway * h * h;
            vec2 d = uWindDir * amt;
            return vec3(d.x, -amt * 0.25 * h, d.y);
          }`,
        )
        .replace(
          '#include <begin_vertex>',
          `
          const float R = ${radius.toFixed(1)};
          vec2 wxz = uCam.xz + mod(aOffset.xy - uCam.xz + R, 2.0 * R) - R;
          vec2 uvW = (wxz + ${HALF.toFixed(1)}) / ${WORLD_SIZE.toFixed(1)};
          float ground = textureLod(uHeight, uvW, 0.0).r;
          vec4 splat = textureLod(uSplat, uvW, 0.0);
          float dens = splat.g * smoothstep(0.08, 0.3, splat.g);
          float keep = step(aOffset.z, dens);
          float dist = length(wxz - uCam.xz);
          float fade = 1.0 - smoothstep(R * 0.62, R, dist);
          ${innerFade > 0 ? `fade *= smoothstep(${(innerFade * 0.6).toFixed(1)}, ${innerFade.toFixed(1)}, dist);` : ''}
          vec4 nz = textureLod(uNoise, wxz * 0.0125, 0.0);
          float tall = (0.16 + 0.3 * aOffset.w) * (0.7 + 0.35 * splat.b + 0.35 * nz.g) * ${heightScale.toFixed(2)};
          float h = tall * keep * fade;
          float ang = aOffset.z * 47.0 + aOffset.w * 13.0;
          vec2 dir = vec2(cos(ang), sin(ang));
          float t = position.y;
          float w = position.x * ${width.toFixed(3)} * (0.7 + 0.6 * aOffset.w) * (keep * fade > 0.0 ? 1.0 : 0.0);
          vec3 p = vec3(wxz.x, ground - 0.02, wxz.y);
          p.xz += vec2(-dir.y, dir.x) * w;
          p.y += t * h;
          // natural curvature along the facing
          p.xz += dir * t * t * h * (0.25 + aOffset.z * 0.3);
          // wind
          vec3 wo = grassWind(p, t) * h * 1.6;
          p += wo;
          // creatures push blades aside
          for (int i = 0; i < 8; i++) {
            vec4 it = uInteractors[i];
            vec2 d = wxz - it.xy;
            float dl = length(d);
            float infl = (1.0 - smoothstep(it.z * 0.35, it.z, dl)) * step(0.0, it.z);
            p.xz += (d / max(dl, 1e-3)) * infl * t * h * 0.9 * it.w;
            p.y -= infl * t * h * 0.55 * it.w;
          }
          p.y -= uWetness * t * t * h * 0.15;
          vec3 transformed = p;
          vTip = t;
          vGrassView = normalize(p - uCam);
          // colour: dark roots, sunlit tips, lush vs dry patches
          float dry = smoothstep(0.38, 0.72, nz.r * 0.75 + textureLod(uNoise, wxz * 0.071, 0.0).g * 0.35 + (1.0 - splat.g) * 0.2);
          vec3 lush = vec3(0.16, 0.24, 0.06);
          vec3 dryC = vec3(0.42, 0.34, 0.13);
          vec3 base = mix(lush, dryC, dry);
          base *= 0.8 + 0.4 * aOffset.w;
          vec3 grassCol = mix(base * ${innerFade > 0 ? '0.85' : '0.62'}, base * ${innerFade > 0 ? '1.05' : '1.15'}, sqrt(t));
          #ifdef USE_COLOR
            vColor.rgb = grassCol;
          #endif
          `,
        )
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vGrassView;\nvarying float vTip;\nuniform vec3 uSunDir;\nuniform vec3 uSunColor;`)
        // Blades are lit with an up-facing normal on both sides (no back-face flip).
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float trans = pow(max(dot(normalize(vGrassView), uSunDir), 0.0), 3.0) * vTip * smoothstep(-0.02, 0.15, uSunDir.y);
          totalEmissiveRadiance += diffuseColor.rgb * uSunColor * trans * 0.9;`,
        );
    };
    mat.customProgramCacheKey = () => `grass-${name}`;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `grass-${name}`;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.group.add(mesh);
    return { mesh, geometry: geo, material: mat, total: count };
  }

  setDensity(d: number): void {
    this.density = Math.max(0, Math.min(1, d));
    for (const l of this.layers) {
      l.geometry.instanceCount = Math.floor(l.total * this.density);
      l.mesh.visible = l.geometry.instanceCount > 0;
    }
  }

  get bladeCount(): number {
    return this.layers.reduce((a, l) => a + l.geometry.instanceCount, 0);
  }

  dispose(): void {
    for (const l of this.layers) {
      l.geometry.dispose();
      l.material.dispose();
    }
    this.group.clear();
  }
}
