/**
 * Pure (DOM-free) creature mesh generation. Runs inside a Web Worker at
 * startup so several species are sculpted in parallel without blocking the
 * main thread; falls back to synchronous execution if workers are missing.
 *
 * Two polygonisations are produced from the same SDF: a fine one for the
 * skin and a coarser one for the instanced fur shells (shells multiply the
 * triangle count, and their offset hides the small chord differences).
 */
import * as THREE from 'three';
import { Rig } from './Rig';
import { computeSkin, polygonize, type SDFField } from './SDFMesher';
import { TAG_COUNT, type SpeciesSpec } from './species/types';
import { SimplexNoise } from '../utils/noise';

export interface MeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  furLen: Float32Array;
  comb: Float32Array;
  indices: Uint32Array;
}

export interface SpeciesMeshData {
  name: string;
  /** LOD0 (fine) .. LOD2 (coarse). LOD1 also serves as the fur shell mesh. */
  lods: MeshArrays[];
  buildMs: number;
}

/** Cell size multipliers for the mesh LOD chain. */
export const LOD_CELL_SCALE = [1, 1.7, 2.8];

function buildArrays(spec: SpeciesSpec, field: SDFField, rig: Rig, cell: number): MeshArrays {
  const raw = polygonize(field, cell);
  const boneIndex = new Map<string, number>();
  rig.bones.forEach((b, i) => boneIndex.set(b.name, i));
  const skin = computeSkin(field, raw, boneIndex, TAG_COUNT);
  const nv = raw.positions.length / 3;
  const colors = new Float32Array(nv * 3);
  const furLen = new Float32Array(nv);
  const noise = new SimplexNoise(0x5eed);
  const out = { color: new THREE.Color(), furLen: 0 };
  for (let i = 0; i < nv; i++) {
    spec.paint(skin.vertexInfo(i), noise, out);
    colors[i * 3] = out.color.r;
    colors[i * 3 + 1] = out.color.g;
    colors[i * 3 + 2] = out.color.b;
    furLen[i] = out.furLen;
  }
  return {
    positions: raw.positions,
    normals: raw.normals,
    colors,
    skinIndex: skin.skinIndex,
    skinWeight: skin.skinWeight,
    furLen,
    comb: skin.comb,
    indices: raw.indices,
  };
}

export function buildSpeciesData(spec: SpeciesSpec): SpeciesMeshData {
  const t0 = performance.now();
  const rig = new Rig(spec.joints);
  const field = spec.buildField(rig);
  const lods = LOD_CELL_SCALE.map((k) => buildArrays(spec, field, rig, spec.cellSize * k));
  return { name: spec.name, lods, buildMs: performance.now() - t0 };
}

function arraysBuffers(m: MeshArrays): ArrayBuffer[] {
  return [m.positions, m.normals, m.colors, m.skinIndex, m.skinWeight, m.furLen, m.comb, m.indices].map((a) => a.buffer as ArrayBuffer);
}

export function transferablesOf(d: SpeciesMeshData): ArrayBuffer[] {
  return d.lods.flatMap(arraysBuffers);
}
