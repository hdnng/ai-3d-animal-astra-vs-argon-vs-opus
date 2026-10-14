/**
 * Navigation grid (2 m cells) built from terrain slope, water depth, world
 * bounds and static obstacles. A* with an octile heuristic (8-connected, no
 * corner cutting) plus line-of-sight string pulling for smooth paths.
 */
import { hyp } from '../utils/math';
import * as THREE from 'three';
import { BinaryHeap } from '../utils/BinaryHeap';
import { HALF, PLAY_RADIUS, type TerrainData, WORLD_SIZE } from '../world/WorldGen';
import type { Obstacles } from '../world/Obstacles';

export const NAV_CELL = 2;
const N = Math.floor(WORLD_SIZE / NAV_CELL);
const SQRT2 = Math.SQRT2;

export class NavGrid {
  readonly size = N;
  /** 0 = blocked; otherwise traversal cost multiplier (1..255). */
  readonly cost = new Uint8Array(N * N);
  private g = new Float32Array(N * N);
  private f = new Float32Array(N * N);
  private parent = new Int32Array(N * N);
  private stamp = new Uint32Array(N * N);
  private closed = new Uint32Array(N * N);
  private gen = 1;
  private heap = new BinaryHeap(this.f);
  /** Shore cells (walkable, next to water) for drinking. */
  readonly shore: THREE.Vector3[] = [];
  lastExpanded = 0;

  constructor(
    private terrain: TerrainData,
    obstacles: Obstacles,
  ) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = (i + 0.5) * NAV_CELL - HALF;
        const z = (j + 0.5) * NAV_CELL - HALF;
        const idx = j * N + i;
        let c = 1;
        const depth = terrain.waterDepth(x, z);
        const slope = terrain.slopeAt(x, z);
        if (hyp(x, z) > PLAY_RADIUS - 2) c = 0;
        else if (depth > 0.45) c = 0;
        else if (slope > 0.55) c = 0;
        else if (obstacles.blocked(x, z, 0.45)) c = 0;
        else {
          c = 1 + Math.round(slope * 8 + (depth > 0.02 ? 3 + depth * 6 : 0));
        }
        this.cost[idx] = Math.min(255, c);
      }
    }
    // Shore points: walkable cells adjacent to deep-ish water.
    for (let j = 1; j < N - 1; j++) {
      for (let i = 1; i < N - 1; i++) {
        const idx = j * N + i;
        if (!this.cost[idx]) continue;
        const x = (i + 0.5) * NAV_CELL - HALF;
        const z = (j + 0.5) * NAV_CELL - HALF;
        if (terrain.waterDepth(x, z) > 0.05) continue;
        let water = false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (terrain.waterDepth(x + dx * NAV_CELL, z + dz * NAV_CELL) > 0.12) water = true;
        }
        if (water) this.shore.push(new THREE.Vector3(x, terrain.heightAt(x, z), z));
      }
    }
  }

  cellOf(x: number, z: number): number {
    const i = Math.floor((x + HALF) / NAV_CELL);
    const j = Math.floor((z + HALF) / NAV_CELL);
    if (i < 0 || j < 0 || i >= N || j >= N) return -1;
    return j * N + i;
  }

  walkable(x: number, z: number): boolean {
    const c = this.cellOf(x, z);
    return c >= 0 && this.cost[c] > 0;
  }

  /** Nearest walkable cell centre within `maxRadius` cells. */
  nearestWalkable(x: number, z: number, out: THREE.Vector3, maxRadius = 12): boolean {
    const ci = Math.floor((x + HALF) / NAV_CELL);
    const cj = Math.floor((z + HALF) / NAV_CELL);
    for (let r = 0; r <= maxRadius; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= N || j >= N) continue;
          const idx = j * N + i;
          if (!this.cost[idx]) continue;
          const d = di * di + dj * dj;
          if (d < bestD) {
            bestD = d;
            best = idx;
          }
        }
      }
      if (best >= 0) {
        out.set(((best % N) + 0.5) * NAV_CELL - HALF, 0, (Math.floor(best / N) + 0.5) * NAV_CELL - HALF);
        out.y = this.terrain.heightAt(out.x, out.z);
        return true;
      }
    }
    return false;
  }

  /** Grid line of sight (samples every half cell). */
  lineOfSight(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const len = hyp(dx, dz);
    const steps = Math.ceil(len / (NAV_CELL * 0.45));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const c = this.cellOf(ax + dx * t, az + dz * t);
      if (c < 0 || !this.cost[c]) return false;
    }
    return true;
  }

  /**
   * A* from (sx,sz) to (tx,tz). Returns smoothed waypoints (excluding the
   * start) or null if unreachable within the expansion budget.
   */
  findPath(sx: number, sz: number, tx: number, tz: number, maxExpand = 9000): THREE.Vector3[] | null {
    let start = this.cellOf(sx, sz);
    let goal = this.cellOf(tx, tz);
    if (start < 0 || goal < 0) return null;
    const tmp = new THREE.Vector3();
    if (!this.cost[start]) {
      if (!this.nearestWalkable(sx, sz, tmp, 4)) return null;
      start = this.cellOf(tmp.x, tmp.z);
    }
    if (!this.cost[goal]) {
      if (!this.nearestWalkable(tx, tz, tmp, 8)) return null;
      goal = this.cellOf(tmp.x, tmp.z);
      tx = tmp.x;
      tz = tmp.z;
    }
    if (start === goal || this.lineOfSight(sx, sz, tx, tz)) {
      return [new THREE.Vector3(tx, this.terrain.heightAt(tx, tz), tz)];
    }
    const gen = ++this.gen;
    const gi = goal % N;
    const gj = Math.floor(goal / N);
    const h = (idx: number): number => {
      const dx = Math.abs((idx % N) - gi);
      const dz = Math.abs(Math.floor(idx / N) - gj);
      return (dx + dz + (SQRT2 - 2) * Math.min(dx, dz)) * 1.05;
    };
    const heap = this.heap;
    heap.clear();
    this.g[start] = 0;
    this.f[start] = h(start);
    this.stamp[start] = gen;
    this.parent[start] = -1;
    heap.push(start);
    let expanded = 0;
    let found = false;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === goal) {
        found = true;
        break;
      }
      if (++expanded > maxExpand) break;
      const ci = cur % N;
      const cj = (cur - ci) / N;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const nIdx = nj * N + ni;
          const c = this.cost[nIdx];
          if (!c || this.closed[nIdx] === gen) continue;
          if (di && dj && (!this.cost[cj * N + ni] || !this.cost[nj * N + ci])) continue; // no corner cutting
          const step = (di && dj ? SQRT2 : 1) * c;
          const ng = this.g[cur] + step;
          if (this.stamp[nIdx] !== gen || ng < this.g[nIdx]) {
            this.stamp[nIdx] = gen;
            this.g[nIdx] = ng;
            this.f[nIdx] = ng + h(nIdx);
            this.parent[nIdx] = cur;
            heap.push(nIdx);
          }
        }
      }
    }
    this.lastExpanded = expanded;
    if (!found) return null;
    // Reconstruct.
    const cells: number[] = [];
    for (let c = goal; c !== -1; c = this.parent[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map((c) => new THREE.Vector3(((c % N) + 0.5) * NAV_CELL - HALF, 0, (Math.floor(c / N) + 0.5) * NAV_CELL - HALF));
    pts[pts.length - 1].set(tx, 0, tz);
    // String pulling.
    const out: THREE.Vector3[] = [];
    let ax = sx;
    let az = sz;
    let k = 0;
    while (k < pts.length) {
      let far = k;
      for (let m = pts.length - 1; m > k; m--) {
        if (this.lineOfSight(ax, az, pts[m].x, pts[m].z)) {
          far = m;
          break;
        }
      }
      const p = pts[far];
      p.y = this.terrain.heightAt(p.x, p.z);
      out.push(p);
      ax = p.x;
      az = p.z;
      k = far + 1;
    }
    return out;
  }

  /** Random walkable point in a ring around (x,z). */
  randomPointNear(x: number, z: number, minR: number, maxR: number, rnd: () => number, out: THREE.Vector3): boolean {
    for (let t = 0; t < 20; t++) {
      const a = rnd() * Math.PI * 2;
      const r = minR + rnd() * (maxR - minR);
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (this.walkable(px, pz) && this.terrain.waterDepth(px, pz) < 0.05) {
        out.set(px, this.terrain.heightAt(px, pz), pz);
        return true;
      }
    }
    return false;
  }

  nearestShore(x: number, z: number, out: THREE.Vector3): boolean {
    let best: THREE.Vector3 | null = null;
    let bd = Infinity;
    for (const p of this.shore) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best) return false;
    out.copy(best);
    return true;
  }
}
