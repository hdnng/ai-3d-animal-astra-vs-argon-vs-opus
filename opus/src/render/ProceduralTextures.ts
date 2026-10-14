/**
 * Procedurally generated textures (no image assets). All textures are created
 * on the CPU once at startup and uploaded as DataTextures.
 */
import * as THREE from 'three';
import { GRID_N, TerrainData } from '../world/WorldGen';
import { hash2 } from '../utils/math';

/** Gradient table for a periodic lattice of size p x p (cos, sin pairs). */
function gradTable(p: number, seed: number): Float32Array {
  const t = new Float32Array(p * p * 2);
  for (let j = 0; j < p; j++) {
    for (let i = 0; i < p; i++) {
      const a = hash2(i + seed * 131, j - seed * 71) * Math.PI * 2;
      t[(j * p + i) * 2] = Math.cos(a);
      t[(j * p + i) * 2 + 1] = Math.sin(a);
    }
  }
  return t;
}

/** Tileable 2D gradient noise on a lattice with period `p` (table from gradTable). */
function periodicGradient(x: number, y: number, p: number, g: Float32Array): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const x0 = ((xi % p) + p) % p;
  const y0 = ((yi % p) + p) % p;
  const x1 = (x0 + 1) % p;
  const y1 = (y0 + 1) % p;
  const k00 = (y0 * p + x0) * 2;
  const k10 = (y0 * p + x1) * 2;
  const k01 = (y1 * p + x0) * 2;
  const k11 = (y1 * p + x1) * 2;
  const n00 = g[k00] * xf + g[k00 + 1] * yf;
  const n10 = g[k10] * (xf - 1) + g[k10 + 1] * yf;
  const n01 = g[k01] * xf + g[k01 + 1] * (yf - 1);
  const n11 = g[k11] * (xf - 1) + g[k11 + 1] * (yf - 1);
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const nx0 = n00 + (n10 - n00) * u;
  const nx1 = n01 + (n11 - n01) * u;
  return (nx0 + (nx1 - nx0) * v) * 1.414;
}

function periodicFbm(x: number, y: number, period: number, tables: Float32Array[]): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let p = period;
  let fx = x;
  let fy = y;
  for (let o = 0; o < tables.length; o++) {
    sum += amp * periodicGradient(fx, fy, p, tables[o]);
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
    p *= 2;
  }
  return sum / norm;
}

/**
 * RGBA tileable noise texture. Channels hold fbm at increasing base
 * frequencies (4, 8, 16, 32 lattice cells per tile) for cheap multi-scale
 * variation in shaders.
 */
export function createNoiseTexture(size = 256, seed = 7): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const periods = [4, 8, 16, 32];
  const tables = periods.map((p, c) => [0, 1, 2, 3].map((o) => gradTable(p << o, seed + c * 101 + o * 17)));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = (y * size + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p = periods[c];
        const v = periodicFbm((x / size) * p, (y / size) * p, p, tables[c]);
        data[k + c] = Math.max(0, Math.min(255, Math.round((v * 0.5 + 0.5) * 255)));
      }
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Terrain heights as a filterable half-float texture (for grass, water, rain). */
export function createHeightTexture(t: TerrainData): THREE.DataTexture {
  const data = new Uint16Array(GRID_N * GRID_N);
  for (let i = 0; i < data.length; i++) data[i] = THREE.DataUtils.toHalfFloat(t.heights[i]);
  const tex = new THREE.DataTexture(data, GRID_N, GRID_N, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Biome masks: R = forest, G = grass density, B = meadow, A = flower bias. */
export function createSplatTexture(t: TerrainData): THREE.DataTexture {
  const data = new Uint8Array(GRID_N * GRID_N * 4);
  for (let i = 0; i < GRID_N * GRID_N; i++) {
    data[i * 4] = Math.round(t.forest[i] * 255);
    data[i * 4 + 1] = Math.round(t.grass[i] * 255);
    data[i * 4 + 2] = Math.round(t.meadow[i] * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, GRID_N, GRID_N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Soft round sprite (radial falloff) used by particles. */
export function createSoftDotTexture(size = 64): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;
      const a = Math.max(0, 1 - d);
      const k = (y * size + x) * 4;
      data[k] = data[k + 1] = data[k + 2] = 255;
      data[k + 3] = Math.round(Math.pow(a, 1.6) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
