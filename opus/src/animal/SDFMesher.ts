/**
 * Signed-distance-field modelling + Surface Nets polygonisation.
 *
 * Creature bodies are described as a list of primitives (ellipsoids, round
 * cones) smoothly unioned together. Each primitive is bound to one or two
 * bones; skin weights are derived from how strongly each primitive "owns" a
 * surface point, which yields soft, natural weights at joints.
 */
import * as THREE from 'three';
import { clamp01 } from '../utils/math';

export type PrimKind = 0 | 1 | 2; // 0 sphere, 1 ellipsoid, 2 round cone

export interface Prim {
  kind: PrimKind;
  a: THREE.Vector3;
  b: THREE.Vector3;
  r1: number;
  r2: number;
  radii: THREE.Vector3;
  /** World->local rotation for ellipsoids. */
  invRot: THREE.Matrix3 | null;
  /** Optional flattening (squash along an axis) for ears etc. */
  flatAxis: THREE.Vector3 | null;
  flatFactor: number;
  k: number;
  subtract: boolean;
  bone: string;
  bone2: string | null;
  tag: number;
  comb: THREE.Vector3;
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** Weight falloff for skinning (meters). */
  weightFalloff: number;
}

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

function sdRoundCone(px: number, py: number, pz: number, a: THREE.Vector3, b: THREE.Vector3, r1: number, r2: number): number {
  const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = px - a.x, pay = py - a.y, paz = pz - a.z;
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const xvx = pax * l2 - bax * y, xvy = pay * l2 - bay * y, xvz = paz * l2 - baz * y;
  const x2 = xvx * xvx + xvy * xvy + xvz * xvz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

function sdEllipsoid(px: number, py: number, pz: number, r: THREE.Vector3): number {
  const k0 = Math.sqrt((px / r.x) ** 2 + (py / r.y) ** 2 + (pz / r.z) ** 2);
  const k1 = Math.sqrt((px / (r.x * r.x)) ** 2 + (py / (r.y * r.y)) ** 2 + (pz / (r.z * r.z)) ** 2);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(r.x, r.y, r.z);
}

export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

export class SDFField {
  readonly prims: Prim[] = [];
  readonly boundsMin = new THREE.Vector3(Infinity, Infinity, Infinity);
  readonly boundsMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  /** Distance returned far from every primitive. */
  margin = 0.08;

  private push(p: Omit<Prim, 'min' | 'max'>): Prim {
    const prim = p as Prim;
    const pad = Math.max(p.k, 0.005) + 0.03;
    if (p.kind === 2) {
      const r = Math.max(p.r1, p.r2);
      prim.min = new THREE.Vector3(Math.min(p.a.x, p.b.x) - r - pad, Math.min(p.a.y, p.b.y) - r - pad, Math.min(p.a.z, p.b.z) - r - pad);
      prim.max = new THREE.Vector3(Math.max(p.a.x, p.b.x) + r + pad, Math.max(p.a.y, p.b.y) + r + pad, Math.max(p.a.z, p.b.z) + r + pad);
    } else {
      const r = p.kind === 0 ? p.r1 : Math.max(p.radii.x, p.radii.y, p.radii.z);
      prim.min = new THREE.Vector3(p.a.x - r - pad, p.a.y - r - pad, p.a.z - r - pad);
      prim.max = new THREE.Vector3(p.a.x + r + pad, p.a.y + r + pad, p.a.z + r + pad);
    }
    if (!p.subtract) {
      this.boundsMin.min(prim.min);
      this.boundsMax.max(prim.max);
    }
    this.prims.push(prim);
    return prim;
  }

  sphere(c: THREE.Vector3, r: number, o: PrimOpts): Prim {
    return this.push({ kind: 0, a: c.clone(), b: c.clone(), r1: r, r2: r, radii: new THREE.Vector3(r, r, r), invRot: null, flatAxis: null, flatFactor: 1, ...defaults(o) });
  }

  ellipsoid(c: THREE.Vector3, radii: THREE.Vector3, o: PrimOpts & { rot?: THREE.Euler }): Prim {
    let invRot: THREE.Matrix3 | null = null;
    if (o.rot) {
      const m = new THREE.Matrix4().makeRotationFromEuler(o.rot);
      invRot = new THREE.Matrix3().setFromMatrix4(m).transpose();
    }
    return this.push({ kind: 1, a: c.clone(), b: c.clone(), r1: 0, r2: 0, radii: radii.clone(), invRot, flatAxis: null, flatFactor: 1, ...defaults(o) });
  }

  cone(a: THREE.Vector3, b: THREE.Vector3, r1: number, r2: number, o: PrimOpts & { flatAxis?: THREE.Vector3; flatFactor?: number }): Prim {
    return this.push({
      kind: 2,
      a: a.clone(),
      b: b.clone(),
      r1,
      r2,
      radii: new THREE.Vector3(),
      invRot: null,
      flatAxis: o.flatAxis ? o.flatAxis.clone().normalize() : null,
      flatFactor: o.flatFactor ?? 1,
      ...defaults(o),
    });
  }

  /** Distance from a point to one primitive. */
  primDist(p: Prim, x: number, y: number, z: number): number {
    if (p.kind === 0) {
      return Math.hypot(x - p.a.x, y - p.a.y, z - p.a.z) - p.r1;
    }
    if (p.kind === 1) {
      _q.set(x - p.a.x, y - p.a.y, z - p.a.z);
      if (p.invRot) _q.applyMatrix3(p.invRot);
      return sdEllipsoid(_q.x, _q.y, _q.z, p.radii);
    }
    if (p.flatAxis) {
      // Squash space along flatAxis around the cone's start point.
      const ax = p.flatAxis;
      const dx = x - p.a.x, dy = y - p.a.y, dz = z - p.a.z;
      const t = (dx * ax.x + dy * ax.y + dz * ax.z) * (p.flatFactor - 1);
      return sdRoundCone(x + ax.x * t, y + ax.y * t, z + ax.z * t, p.a, p.b, p.r1, p.r2) / Math.sqrt(p.flatFactor);
    }
    return sdRoundCone(x, y, z, p.a, p.b, p.r1, p.r2);
  }

  /** Full field evaluation (same op order as the grid fill). */
  eval(x: number, y: number, z: number): number {
    let d = this.margin;
    for (const p of this.prims) {
      if (x < p.min.x || y < p.min.y || z < p.min.z || x > p.max.x || y > p.max.y || z > p.max.z) continue;
      const pd = this.primDist(p, x, y, z);
      d = p.subtract ? smax(d, -pd, p.k) : smin(d, pd, p.k);
    }
    return d;
  }

  /** Tetrahedral finite-difference gradient (4 evaluations instead of 6). */
  gradient(x: number, y: number, z: number, out: THREE.Vector3, h = 0.0015): THREE.Vector3 {
    const a = this.eval(x + h, y - h, z - h);
    const b = this.eval(x - h, y - h, z + h);
    const c = this.eval(x - h, y + h, z - h);
    const d = this.eval(x + h, y + h, z + h);
    out.set(a - b - c + d, -a - b + c + d, -a + b - c + d);
    const l = out.length();
    return l > 1e-12 ? out.multiplyScalar(1 / l) : out.set(0, 1, 0);
  }
}

export interface PrimOpts {
  k?: number;
  subtract?: boolean;
  bone: string;
  bone2?: string | null;
  tag: number;
  comb?: THREE.Vector3;
  weightFalloff?: number;
}

function defaults(o: PrimOpts): Pick<Prim, 'k' | 'subtract' | 'bone' | 'bone2' | 'tag' | 'comb' | 'weightFalloff'> {
  return {
    k: o.k ?? 0.04,
    subtract: o.subtract ?? false,
    bone: o.bone,
    bone2: o.bone2 ?? null,
    tag: o.tag,
    comb: (o.comb ?? new THREE.Vector3(0, 0, -1)).clone().normalize(),
    weightFalloff: o.weightFalloff ?? 0.022,
  };
}

export interface RawMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/**
 * Naive Surface Nets on a regular grid. Vertices are then projected onto the
 * true zero level-set with Newton steps and normals come from the analytic
 * field gradient, giving a smooth organic surface.
 */
export function polygonize(field: SDFField, cell: number): RawMesh {
  const pad = cell * 2;
  const min = field.boundsMin.clone().subScalar(pad);
  const max = field.boundsMax.clone().addScalar(pad);
  const nx = Math.ceil((max.x - min.x) / cell) + 1;
  const ny = Math.ceil((max.y - min.y) / cell) + 1;
  const nz = Math.ceil((max.z - min.z) / cell) + 1;
  const N = nx * ny * nz;
  const vals = new Float32Array(N).fill(field.margin);
  const idx = (i: number, j: number, k: number): number => i + nx * (j + ny * k);

  // Per-primitive fill restricted to its AABB (cheap, order matches eval()).
  for (const p of field.prims) {
    const i0 = Math.max(0, Math.floor((p.min.x - min.x) / cell));
    const i1 = Math.min(nx - 1, Math.ceil((p.max.x - min.x) / cell));
    const j0 = Math.max(0, Math.floor((p.min.y - min.y) / cell));
    const j1 = Math.min(ny - 1, Math.ceil((p.max.y - min.y) / cell));
    const k0 = Math.max(0, Math.floor((p.min.z - min.z) / cell));
    const k1 = Math.min(nz - 1, Math.ceil((p.max.z - min.z) / cell));
    for (let k = k0; k <= k1; k++) {
      const z = min.z + k * cell;
      for (let j = j0; j <= j1; j++) {
        const y = min.y + j * cell;
        let id = idx(i0, j, k);
        for (let i = i0; i <= i1; i++, id++) {
          const x = min.x + i * cell;
          if (x < p.min.x || y < p.min.y || z < p.min.z || x > p.max.x || y > p.max.y || z > p.max.z) continue;
          const d = field.primDist(p, x, y, z);
          vals[id] = p.subtract ? smax(vals[id], -d, p.k) : smin(vals[id], d, p.k);
        }
      }
    }
  }

  // One vertex per sign-changing cell.
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cidx = (i: number, j: number, k: number): number => i + (nx - 1) * (j + (ny - 1) * k);
  const verts: number[] = [];
  const cornerOff: [number, number, number][] = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const edges: [number, number][] = [
    [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const o = cornerOff[c];
          const v = vals[idx(i + o[0], j + o[1], k + o[2])];
          cv[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        for (const [e0, e1] of edges) {
          const a = cv[e0];
          const b = cv[e1];
          if (a < 0 === b < 0) continue;
          const t = a / (a - b);
          const o0 = cornerOff[e0];
          const o1 = cornerOff[e1];
          sx += o0[0] + (o1[0] - o0[0]) * t;
          sy += o0[1] + (o1[1] - o0[1]) * t;
          sz += o0[2] + (o1[2] - o0[2]) * t;
          cnt++;
        }
        cellVert[cidx(i, j, k)] = verts.length / 3;
        verts.push(min.x + (i + sx / cnt) * cell, min.y + (j + sy / cnt) * cell, min.z + (k + sz / cnt) * cell);
      }
    }
  }

  // Faces for every sign-changing grid edge.
  const tris: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean): void => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // choose the shorter diagonal
    const dAC = dist2(verts, a, c);
    const dBD = dist2(verts, b, d);
    if (flip) {
      const t = b;
      b = d;
      d = t;
    }
    if (dAC <= dBD) tris.push(a, b, c, a, c, d);
    else tris.push(a, b, d, b, c, d);
  };
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const v0 = vals[idx(i, j, k)];
        const in0 = v0 < 0;
        // x edge
        if (i < nx - 1 && j > 0 && k > 0 && j < ny - 1 && k < nz - 1) {
          const in1 = vals[idx(i + 1, j, k)] < 0;
          if (in0 !== in1) {
            quad(cellVert[cidx(i, j - 1, k - 1)], cellVert[cidx(i, j, k - 1)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j - 1, k)], !in0);
          }
        }
        // y edge
        if (j < ny - 1 && i > 0 && k > 0 && i < nx - 1 && k < nz - 1) {
          const in1 = vals[idx(i, j + 1, k)] < 0;
          if (in0 !== in1) {
            quad(cellVert[cidx(i - 1, j, k - 1)], cellVert[cidx(i - 1, j, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j, k - 1)], !in0);
          }
        }
        // z edge
        if (k < nz - 1 && i > 0 && j > 0 && i < nx - 1 && j < ny - 1) {
          const in1 = vals[idx(i, j, k + 1)] < 0;
          if (in0 !== in1) {
            quad(cellVert[cidx(i - 1, j - 1, k)], cellVert[cidx(i, j - 1, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i - 1, j, k)], !in0);
          }
        }
      }
    }
  }

  // Project vertices onto the surface and compute normals.
  const nv = verts.length / 3;
  const positions = new Float32Array(verts);
  const normals = new Float32Array(nv * 3);
  const g = new THREE.Vector3();
  for (let v = 0; v < nv; v++) {
    let x = positions[v * 3];
    let y = positions[v * 3 + 1];
    let z = positions[v * 3 + 2];
    for (let it = 0; it < 2; it++) {
      const d = field.eval(x, y, z);
      if (Math.abs(d) < 1e-5) break;
      field.gradient(x, y, z, g);
      const step = Math.max(-cell, Math.min(cell, d));
      x -= g.x * step;
      y -= g.y * step;
      z -= g.z * step;
    }
    positions[v * 3] = x;
    positions[v * 3 + 1] = y;
    positions[v * 3 + 2] = z;
    field.gradient(x, y, z, g, cell * 0.35);
    normals[v * 3] = g.x;
    normals[v * 3 + 1] = g.y;
    normals[v * 3 + 2] = g.z;
  }
  return { positions, normals, indices: new Uint32Array(tris) };
}

function dist2(v: number[], a: number, b: number): number {
  const dx = v[a * 3] - v[b * 3];
  const dy = v[a * 3 + 1] - v[b * 3 + 1];
  const dz = v[a * 3 + 2] - v[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}

export interface VertexInfo {
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  /** Per-tag ownership weights (normalized). */
  tags: Float32Array;
  /** Bone weight by bone name (normalized). */
  boneW: Map<string, number>;
}

export interface SkinData {
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  comb: Float32Array;
  vertexInfo: (i: number) => VertexInfo;
}

/** Derives smooth skin weights + fur comb directions from primitive ownership. */
export function computeSkin(field: SDFField, mesh: RawMesh, boneIndex: Map<string, number>, tagCount: number): SkinData {
  const nv = mesh.positions.length / 3;
  const skinIndex = new Uint16Array(nv * 4);
  const skinWeight = new Float32Array(nv * 4);
  const comb = new Float32Array(nv * 3);
  const tagW = new Float32Array(nv * tagCount);
  const boneWAll: Map<string, number>[] = [];
  const prims = field.prims.filter((p) => !p.subtract);
  const dists = new Float32Array(prims.length);
  const ab = new THREE.Vector3();
  const ap = new THREE.Vector3();
  const cdir = new THREE.Vector3();
  for (let v = 0; v < nv; v++) {
    const x = mesh.positions[v * 3];
    const y = mesh.positions[v * 3 + 1];
    const z = mesh.positions[v * 3 + 2];
    let dmin = Infinity;
    for (let i = 0; i < prims.length; i++) {
      const d = field.primDist(prims[i], x, y, z);
      dists[i] = d;
      if (d < dmin) dmin = d;
    }
    const bw = new Map<string, number>();
    let total = 0;
    cdir.set(0, 0, 0);
    for (let i = 0; i < prims.length; i++) {
      const p = prims[i];
      const w = Math.exp(-Math.max(dists[i] - dmin, 0) / p.weightFalloff);
      if (w < 1e-3) continue;
      total += w;
      tagW[v * tagCount + p.tag] += w;
      cdir.addScaledVector(p.comb, w);
      if (p.bone2) {
        ab.subVectors(p.b, p.a);
        ap.set(x, y, z).sub(p.a);
        const t = clamp01(ap.dot(ab) / ab.lengthSq());
        const s = t * t * (3 - 2 * t);
        bw.set(p.bone, (bw.get(p.bone) ?? 0) + w * (1 - s));
        bw.set(p.bone2, (bw.get(p.bone2) ?? 0) + w * s);
      } else {
        bw.set(p.bone, (bw.get(p.bone) ?? 0) + w);
      }
    }
    for (let t = 0; t < tagCount; t++) tagW[v * tagCount + t] /= total;
    // Top 4 bone influences.
    const sorted = [...bw.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    let sum = 0;
    for (const [, w] of sorted) sum += w;
    const norm = new Map<string, number>();
    for (let s = 0; s < 4; s++) {
      if (s < sorted.length) {
        const [name, w] = sorted[s];
        const bi = boneIndex.get(name);
        if (bi === undefined) throw new Error(`Unknown bone ${name}`);
        skinIndex[v * 4 + s] = bi;
        skinWeight[v * 4 + s] = w / sum;
        norm.set(name, w / sum);
      } else {
        skinIndex[v * 4 + s] = 0;
        skinWeight[v * 4 + s] = 0;
      }
    }
    boneWAll.push(norm);
    // Comb direction projected onto the tangent plane.
    const nx = mesh.normals[v * 3], ny = mesh.normals[v * 3 + 1], nz = mesh.normals[v * 3 + 2];
    const dn = cdir.x * nx + cdir.y * ny + cdir.z * nz;
    cdir.x -= dn * nx;
    cdir.y -= dn * ny;
    cdir.z -= dn * nz;
    if (cdir.lengthSq() < 1e-8) cdir.set(0, -1, 0);
    cdir.normalize();
    comb[v * 3] = cdir.x;
    comb[v * 3 + 1] = cdir.y;
    comb[v * 3 + 2] = cdir.z;
  }
  _p.set(0, 0, 0);
  return {
    skinIndex,
    skinWeight,
    comb,
    vertexInfo: (i: number): VertexInfo => ({
      pos: new THREE.Vector3(mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]),
      normal: new THREE.Vector3(mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]),
      tags: tagW.subarray(i * tagCount, (i + 1) * tagCount),
      boneW: boneWAll[i],
    }),
  };
}
