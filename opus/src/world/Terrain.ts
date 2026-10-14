/**
 * Chunked terrain renderer with 3 LOD levels, skirts to hide LOD cracks and a
 * procedural splat shader (grass / dry grass / forest floor / dirt / rock /
 * sand / snow) layered on MeshStandardMaterial so shadows/fog/lights work.
 */
import * as THREE from 'three';
import { GRID_N, HALF, TerrainData, WATER_LEVEL, WORLD_SIZE } from './WorldGen';
import { globalUniforms } from '../render/Uniforms';
import { Disposer } from '../utils/Disposer';

const CHUNK = 32; // meters (and cells at LOD0)
const LOD_STEPS = [1, 2, 4];
const LOD_DIST = [80, 165];

interface Chunk {
  cx: number;
  cz: number;
  meshes: THREE.Mesh[];
  level: number;
}

export class Terrain {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshLambertMaterial;
  private chunks: Chunk[] = [];
  private disposer = new Disposer();

  constructor(
    private data: TerrainData,
    noiseTex: THREE.Texture,
    splatTex: THREE.Texture,
  ) {
    this.group.name = 'terrain';
    this.material = this.createMaterial(noiseTex, splatTex);
    this.disposer.track(this.material);
    const n = WORLD_SIZE / CHUNK;
    for (let cz = 0; cz < n; cz++) {
      for (let cx = 0; cx < n; cx++) {
        const meshes: THREE.Mesh[] = [];
        for (let l = 0; l < LOD_STEPS.length; l++) {
          const geo = this.disposer.track(this.buildChunk(cx * CHUNK, cz * CHUNK, LOD_STEPS[l]));
          const mesh = new THREE.Mesh(geo, this.material);
          mesh.receiveShadow = true;
          mesh.castShadow = false;
          mesh.visible = l === 0;
          mesh.matrixAutoUpdate = false;
          mesh.name = `terrain_${cx}_${cz}_lod${l}`;
          this.group.add(mesh);
          meshes.push(mesh);
        }
        this.chunks.push({ cx, cz, meshes, level: 0 });
      }
    }
  }

  /** Builds a chunk mesh in world coordinates. Index convention matches TerrainData.heightAt. */
  private buildChunk(i0: number, j0: number, step: number): THREE.BufferGeometry {
    const cells = CHUNK / step;
    const vn = cells + 1;
    const d = this.data;
    const skirtCount = vn * 4;
    const total = vn * vn + skirtCount;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    let v = 0;
    for (let j = 0; j < vn; j++) {
      for (let i = 0; i < vn; i++) {
        const gi = Math.min(i0 + i * step, GRID_N - 1);
        const gj = Math.min(j0 + j * step, GRID_N - 1);
        const idx = gj * GRID_N + gi;
        pos[v * 3] = gi - HALF;
        pos[v * 3 + 1] = d.heights[idx];
        pos[v * 3 + 2] = gj - HALF;
        nor[v * 3] = d.normals[idx * 3];
        nor[v * 3 + 1] = d.normals[idx * 3 + 1];
        nor[v * 3 + 2] = d.normals[idx * 3 + 2];
        v++;
      }
    }
    const indices: number[] = [];
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const a = j * vn + i;
        const b = a + 1;
        const c = a + vn;
        const e = c + 1;
        // split along b-c diagonal (CCW when seen from +Y)
        indices.push(a, c, b, b, c, e);
      }
    }
    // Skirts: duplicate border verts pushed down; hides cracks between LODs.
    const border: number[][] = [
      Array.from({ length: vn }, (_, i) => i), // j = 0 edge
      Array.from({ length: vn }, (_, i) => (vn - 1) * vn + i), // j = max edge
      Array.from({ length: vn }, (_, j) => j * vn), // i = 0 edge
      Array.from({ length: vn }, (_, j) => j * vn + vn - 1), // i = max edge
    ];
    const flips = [false, true, true, false];
    for (let s = 0; s < 4; s++) {
      const edge = border[s];
      const start = v;
      for (const src of edge) {
        pos[v * 3] = pos[src * 3];
        pos[v * 3 + 1] = pos[src * 3 + 1] - 2.5;
        pos[v * 3 + 2] = pos[src * 3 + 2];
        nor[v * 3] = nor[src * 3];
        nor[v * 3 + 1] = nor[src * 3 + 1];
        nor[v * 3 + 2] = nor[src * 3 + 2];
        v++;
      }
      for (let k = 0; k < edge.length - 1; k++) {
        const t0 = edge[k];
        const t1 = edge[k + 1];
        const b0 = start + k;
        const b1 = start + k + 1;
        if (flips[s]) indices.push(t0, b0, t1, t1, b0, b1);
        else indices.push(t0, t1, b0, t1, b1, b0);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }

  private createMaterial(noiseTex: THREE.Texture, splatTex: THREE.Texture): THREE.MeshLambertMaterial {
    // Lambert keeps the full-screen terrain cheap; wet sheen is added by hand.
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const c = (hex: number): THREE.Color => new THREE.Color(hex);
    const uniforms = {
      uNoise: { value: noiseTex },
      uSplat: { value: splatTex },
      uGrassLush: { value: c(0x4a5e24) },
      uGrassDry: { value: c(0x9c8a48) },
      uForestFloor: { value: c(0x5b4128) },
      uDirt: { value: c(0x6e5538) },
      uRock: { value: c(0x7d776c) },
      uSand: { value: c(0x9f8c66) },
      uMud: { value: c(0x4a3f30) },
      uSnow: { value: c(0xe8ecf2) },
      uTime: globalUniforms.uTime,
      uWetness: globalUniforms.uWetness,
      uWaterLevel: globalUniforms.uWaterLevel,
      uSunDir: globalUniforms.uSunDir,
      uSunColorT: globalUniforms.uSunColor,
      uNight: globalUniforms.uNight,
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vTWorld;\nvarying vec3 vTNormal;`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>\nvTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTNormal = normalize(mat3(modelMatrix) * objectNormal);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vTWorld;
varying vec3 vTNormal;
uniform sampler2D uNoise;
uniform sampler2D uSplat;
uniform vec3 uGrassLush, uGrassDry, uForestFloor, uDirt, uRock, uSand, uMud, uSnow;
uniform float uTime, uWetness, uWaterLevel, uNight;
uniform vec3 uSunDir;
uniform vec3 uSunColorT;
float tRockAmt;
float tWet;
vec3 tDetailN;
vec3 terrainAlbedo() {
  vec2 xz = vTWorld.xz;
  vec4 n1 = texture2D(uNoise, xz * 0.0125);
  vec4 n2 = texture2D(uNoise, xz * 0.071);
  vec4 n3 = texture2D(uNoise, xz * 0.43);
  vec4 n4 = texture2D(uNoise, xz * 1.7);
  vec4 splat = texture2D(uSplat, (xz + ${HALF.toFixed(1)}) / ${WORLD_SIZE.toFixed(1)});
  float slope = 1.0 - clamp(vTNormal.y, 0.0, 1.0);
  float h = vTWorld.y - uWaterLevel;
  // Grass: lush / dry mixture with large-scale patches.
  float dryMask = smoothstep(0.38, 0.72, n1.r * 0.75 + n2.g * 0.35 + (1.0 - splat.g) * 0.2);
  vec3 col = mix(uGrassLush, uGrassDry, dryMask);
  col *= 0.82 + 0.36 * n3.b;
  col = mix(col, col * vec3(1.08, 1.0, 0.75), n2.a * 0.5);
  // Forest floor (needles + fallen autumn leaves).
  float forest = smoothstep(0.25, 0.75, splat.r + (n2.b - 0.5) * 0.35);
  vec3 floorCol = uForestFloor * (0.75 + 0.5 * n3.r);
  floorCol = mix(floorCol, vec3(0.42, 0.16, 0.04), smoothstep(0.62, 0.8, n4.g) * 0.55);
  floorCol = mix(floorCol, vec3(0.45, 0.32, 0.06), smoothstep(0.65, 0.85, n4.a) * 0.45);
  col = mix(col, floorCol, forest);
  // Bare dirt where grass is thin.
  float dirt = (1.0 - splat.g) * smoothstep(0.55, 0.8, n2.a + n3.g * 0.25) * (1.0 - forest);
  col = mix(col, uDirt * (0.8 + 0.4 * n4.r), clamp(dirt, 0.0, 1.0) * 0.55);
  // Shore sand and underwater mud.
  float shore = 1.0 - smoothstep(0.15, 1.1 + n2.r * 0.6, h);
  col = mix(col, uSand * (0.85 + 0.3 * n3.r), shore);
  col = mix(col, uMud * (0.8 + 0.4 * n3.g), (1.0 - smoothstep(-0.5, 0.05, h)));
  // Rock on steep slopes, with strata bands.
  tRockAmt = smoothstep(0.27, 0.42, slope + (n2.r - 0.5) * 0.22);
  float strata = 0.93 + 0.07 * sin(vTWorld.y * 0.9 + n2.g * 5.0);
  vec3 rockCol = uRock * (0.62 + 0.55 * n3.r) * (0.85 + 0.3 * n1.g) * strata;
  rockCol = mix(rockCol, vec3(0.3, 0.33, 0.2), smoothstep(0.6, 0.8, n3.a) * (1.0 - slope) * 0.6);
  col = mix(col, rockCol, tRockAmt);
  // Snow caps on high peaks.
  float snow = smoothstep(40.0, 50.0, vTWorld.y + n1.b * 10.0) * (1.0 - smoothstep(0.38, 0.62, slope));
  col = mix(col, uSnow, snow);
  // Underwater caustics.
  if (h < 0.0) {
    vec2 cp = xz * 0.9;
    float ca = sin(cp.x * 1.7 + uTime * 1.3 + sin(cp.y * 2.1 + uTime)) * sin(cp.y * 1.9 - uTime * 1.1 + sin(cp.x * 1.3));
    col += vec3(0.35, 0.42, 0.38) * pow(abs(ca), 6.0) * (1.0 - uNight) * smoothstep(-2.5, -0.1, h);
  }
  tWet = clamp(uWetness * (1.0 - snow) + (1.0 - smoothstep(0.0, 0.35, h)) * 0.8, 0.0, 1.0);
  col *= 1.0 - tWet * 0.38;
  // Micro normal detail.
  tDetailN = vec3(n4.r - 0.5, 0.0, n4.g - 0.5) * (0.35 + tRockAmt * 0.9) + vec3(n3.b - 0.5, 0.0, n3.a - 0.5) * 0.3;
  return col;
}`,
        )
        .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = terrainAlbedo();`)
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>\nnormal = normalize(normal + (viewMatrix * vec4(tDetailN, 0.0)).xyz * 0.6);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            // Fake specular sheen on wet ground (rain / shoreline).
            vec3 Ls = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
            vec3 Vv = normalize(vViewPosition);
            float sp = pow(max(dot(reflect(-Ls, normal), Vv), 0.0), 40.0);
            totalEmissiveRadiance += uSunColorT * sp * tWet * 0.6 * smoothstep(-0.02, 0.1, uSunDir.y);
          }`,
        );
    };
    mat.customProgramCacheKey = () => 'terrain-v2';
    return mat;
  }

  /** Selects LOD per chunk based on camera distance. */
  update(camera: THREE.Camera): void {
    const cp = camera.position;
    for (const ch of this.chunks) {
      const mx = ch.cx * CHUNK + CHUNK / 2 - HALF;
      const mz = ch.cz * CHUNK + CHUNK / 2 - HALF;
      const d = Math.sqrt((cp.x - mx) ** 2 + (cp.z - mz) ** 2) - CHUNK * 0.7;
      const lvl = d < LOD_DIST[0] ? 0 : d < LOD_DIST[1] ? 1 : 2;
      if (lvl !== ch.level) {
        ch.meshes[ch.level].visible = false;
        ch.meshes[lvl].visible = true;
        ch.level = lvl;
      }
    }
  }

  /** Counts of chunks per LOD level (for the debug HUD). */
  lodStats(): number[] {
    const s = [0, 0, 0];
    for (const ch of this.chunks) s[ch.level]++;
    return s;
  }

  dispose(): void {
    this.disposer.dispose();
    this.group.clear();
  }
}

export { WATER_LEVEL };
