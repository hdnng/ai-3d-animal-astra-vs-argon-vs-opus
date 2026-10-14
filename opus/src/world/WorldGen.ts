/**
 * Deterministic world generation: heightfield, biome masks and query helpers.
 * Everything here is pure CPU data; rendering lives in Terrain.ts etc.
 */
import { hyp } from '../utils/math';
import * as THREE from 'three';
import { SimplexNoise } from '../utils/noise';
import { clamp, clamp01, lerp, smoothstep } from '../utils/math';

export const WORLD_SIZE = 320;
export const HALF = WORLD_SIZE / 2;
/** Height samples per side (1 m spacing). */
export const GRID_N = WORLD_SIZE + 1;
export const WATER_LEVEL = 0;
/** Usable area radius: beyond this the mountains are too steep to walk. */
export const PLAY_RADIUS = 118;

export const LAKE = { x: 40, z: 30, r: 30 };
export const SPAWN = { x: -10, z: -12 };

function smin(a: number, b: number, k: number): number {
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return lerp(b, a, h) - k * h * (1 - h);
}

function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

export interface TerrainArrays {
  heights: Float32Array;
  normals: Float32Array;
  forest: Float32Array;
  grass: Float32Array;
  meadow: Float32Array;
  minHeight: number;
  maxHeight: number;
}

export class TerrainData {
  readonly heights = new Float32Array(GRID_N * GRID_N);
  readonly normals = new Float32Array(GRID_N * GRID_N * 3);
  /** Biome masks at 1 m resolution, 0..1. */
  readonly forest = new Float32Array(GRID_N * GRID_N);
  readonly grass = new Float32Array(GRID_N * GRID_N);
  readonly meadow = new Float32Array(GRID_N * GRID_N);
  readonly noise: SimplexNoise;
  minHeight = Infinity;
  maxHeight = -Infinity;

  constructor(
    readonly seed: number,
    pre?: TerrainArrays,
  ) {
    this.noise = new SimplexNoise(seed);
    if (pre) {
      this.heights.set(pre.heights);
      this.normals.set(pre.normals);
      this.forest.set(pre.forest);
      this.grass.set(pre.grass);
      this.meadow.set(pre.meadow);
      this.minHeight = pre.minHeight;
      this.maxHeight = pre.maxHeight;
    } else {
      this.generate();
    }
  }

  toArrays(): TerrainArrays {
    return {
      heights: this.heights,
      normals: this.normals,
      forest: this.forest,
      grass: this.grass,
      meadow: this.meadow,
      minHeight: this.minHeight,
      maxHeight: this.maxHeight,
    };
  }

  /** Raw analytic height function (before sampling into the grid). */
  private heightFn(x: number, z: number): number {
    const n = this.noise;
    const r = hyp(x, z);
    // Domain warp gives organic, non-grid-like hills.
    const qx = n.fbm2(x * 0.006 + 3.1, z * 0.006 - 1.7, 3) * 30;
    const qz = n.fbm2(x * 0.006 - 5.3, z * 0.006 + 2.9, 3) * 30;
    const wx = x + qx;
    const wz = z + qz;
    let h = 2.6 + n.fbm2(wx * 0.0085, wz * 0.0085, 5, 2.0, 0.48) * 7.0;
    h += n.fbm2(x * 0.045, z * 0.045, 3) * 0.55;

    // A broad, gently rolling meadow around the spawn point.
    const md = hyp(x - SPAWN.x, z - SPAWN.z);
    const meadow = 1 - smoothstep(18, 58, md);
    h = lerp(h, 2.1 + n.fbm2(x * 0.03, z * 0.03, 2) * 0.45 + (h - 2.1) * 0.2, meadow);

    // Mountain ring enclosing the valley.
    const rr = r + n.fbm2(x * 0.012, z * 0.012, 3) * 18;
    const rim = smoothstep(98, 158, rr);
    if (rim > 0) {
      const ridge = Math.pow(n.ridged2(x * 0.0075 + 7, z * 0.0075 - 3, 5, 2.0, 0.45), 1.25);
      const broad = n.fbm2(x * 0.004 - 11, z * 0.004 + 4, 3) * 0.5 + 0.5;
      h += rim * rim * (16 + ridge * 46 + broad * 14);
    }

    // Lake basin with an irregular shoreline and bumpy bottom.
    const lr = LAKE.r * (1 + n.fbm2(x * 0.028 + 9, z * 0.028, 2) * 0.28);
    const ld = hyp(x - LAKE.x, z - LAKE.z) / lr;
    if (ld < 1.7) {
      let target = -3.1 + 3.7 * smoothstep(0.12, 1.15, ld);
      target += n.fbm2(x * 0.09, z * 0.09, 2) * 0.3 * (1 - smoothstep(0.55, 0.9, ld));
      const w = smoothstep(1.0, 1.65, ld);
      h = lerp(target, Math.max(h, target), w);
    } else {
      // Keep dry land above the water table outside the lake.
      h = smax(h, 0.7, 1.2);
    }
    return h;
  }

  private generate(): void {
    const n = this.noise;
    const H = this.heights;
    for (let j = 0; j < GRID_N; j++) {
      const z = j - HALF;
      for (let i = 0; i < GRID_N; i++) {
        const x = i - HALF;
        const h = this.heightFn(x, z);
        H[j * GRID_N + i] = h;
        if (h < this.minHeight) this.minHeight = h;
        if (h > this.maxHeight) this.maxHeight = h;
      }
    }
    // Normals by central differences (consistent across chunk borders).
    const N = this.normals;
    for (let j = 0; j < GRID_N; j++) {
      for (let i = 0; i < GRID_N; i++) {
        const hl = H[j * GRID_N + Math.max(i - 1, 0)];
        const hr = H[j * GRID_N + Math.min(i + 1, GRID_N - 1)];
        const hd = H[Math.max(j - 1, 0) * GRID_N + i];
        const hu = H[Math.min(j + 1, GRID_N - 1) * GRID_N + i];
        const nx = hl - hr;
        const nz = hd - hu;
        const ny = 2;
        const inv = 1 / Math.hypot(nx, ny, nz);
        const k = (j * GRID_N + i) * 3;
        N[k] = nx * inv;
        N[k + 1] = ny * inv;
        N[k + 2] = nz * inv;
      }
    }
    // Biome masks.
    for (let j = 0; j < GRID_N; j++) {
      const z = j - HALF;
      for (let i = 0; i < GRID_N; i++) {
        const x = i - HALF;
        const idx = j * GRID_N + i;
        const h = H[idx];
        const ny = N[idx * 3 + 1];
        const slope = 1 - ny;
        const md = hyp(x - SPAWN.x, z - SPAWN.z);
        const meadow = 1 - smoothstep(16, 46, md + n.fbm2(x * 0.05, z * 0.05, 2) * 10);
        const r = hyp(x, z);
        let forest = smoothstep(-0.12, 0.32, n.fbm2(x * 0.011 + 40, z * 0.011 - 17, 4));
        forest *= 1 - meadow * 0.97;
        forest *= smoothstep(0.6, 1.6, h - WATER_LEVEL); // not on the shore
        forest *= 1 - smoothstep(30, 44, h); // tree line
        forest *= 1 - smoothstep(0.32, 0.5, slope);
        forest *= 1 - smoothstep(PLAY_RADIUS + 25, PLAY_RADIUS + 40, r) * 0.5;
        let grass = 1 - smoothstep(0.25, 0.42, slope);
        grass *= smoothstep(0.15, 0.55, h - WATER_LEVEL);
        grass *= 1 - smoothstep(26, 36, h);
        grass *= 1 - forest * 0.55;
        grass *= 0.7 + 0.3 * smoothstep(-0.3, 0.3, n.fbm2(x * 0.07 + 13, z * 0.07, 2));
        this.forest[idx] = clamp01(forest);
        this.grass[idx] = clamp01(grass);
        this.meadow[idx] = meadow;
      }
    }
  }

  /**
   * Exact height on the rendered LOD0 triangulation. Each grid cell is split
   * along the (i+1,j)-(i,j+1) diagonal, matching Terrain chunk indices.
   */
  heightAt(x: number, z: number): number {
    const gx = clamp(x + HALF, 0, WORLD_SIZE - 1e-4);
    const gz = clamp(z + HALF, 0, WORLD_SIZE - 1e-4);
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const H = this.heights;
    const a = H[j * GRID_N + i];
    const b = H[j * GRID_N + i + 1];
    const c = H[(j + 1) * GRID_N + i];
    const d = H[(j + 1) * GRID_N + i + 1];
    if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  /** Smoothly interpolated surface normal. */
  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const gx = clamp(x + HALF, 0, WORLD_SIZE - 1e-4);
    const gz = clamp(z + HALF, 0, WORLD_SIZE - 1e-4);
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const N = this.normals;
    const k00 = (j * GRID_N + i) * 3;
    const k10 = k00 + 3;
    const k01 = k00 + GRID_N * 3;
    const k11 = k01 + 3;
    for (let c = 0; c < 3; c++) {
      const top = lerp(N[k00 + c], N[k10 + c], fx);
      const bot = lerp(N[k01 + c], N[k11 + c], fx);
      out.setComponent(c, lerp(top, bot, fz));
    }
    return out.normalize();
  }

  private sampleMask(arr: Float32Array, x: number, z: number): number {
    const gx = clamp(x + HALF, 0, WORLD_SIZE - 1e-4);
    const gz = clamp(z + HALF, 0, WORLD_SIZE - 1e-4);
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const a = arr[j * GRID_N + i];
    const b = arr[j * GRID_N + i + 1];
    const c = arr[(j + 1) * GRID_N + i];
    const d = arr[(j + 1) * GRID_N + i + 1];
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
  }

  forestAt(x: number, z: number): number {
    return this.sampleMask(this.forest, x, z);
  }

  grassAt(x: number, z: number): number {
    return this.sampleMask(this.grass, x, z);
  }

  meadowAt(x: number, z: number): number {
    return this.sampleMask(this.meadow, x, z);
  }

  slopeAt(x: number, z: number): number {
    const tmp = TerrainData.tmpN;
    return 1 - this.normalAt(x, z, tmp).y;
  }

  waterDepth(x: number, z: number): number {
    return Math.max(0, WATER_LEVEL - this.heightAt(x, z));
  }

  isWater(x: number, z: number): boolean {
    return this.heightAt(x, z) < WATER_LEVEL;
  }

  inPlayArea(x: number, z: number, margin = 0): boolean {
    return hyp(x, z) < PLAY_RADIUS - margin;
  }

  private static tmpN = new THREE.Vector3();
}

/** Generates terrain data in a Web Worker (falls back to the main thread). */
export function loadTerrain(seed: number): Promise<TerrainData> {
  if (typeof Worker === 'undefined') return Promise.resolve(new TerrainData(seed));
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<TerrainArrays>) => {
      worker.terminate();
      resolve(new TerrainData(seed, e.data));
    };
    worker.onerror = (ev) => {
      ev.preventDefault();
      worker.terminate();
      resolve(new TerrainData(seed));
    };
    worker.postMessage({ seed });
  });
}
