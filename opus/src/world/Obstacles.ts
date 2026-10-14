/** Static circular obstacles (tree trunks, boulders) with spatial queries. */
import * as THREE from 'three';
import { SpatialHash } from '../utils/SpatialHash';

export interface Obstacle {
  x: number;
  z: number;
  radius: number;
  kind: 'tree' | 'rock' | 'log';
}

export class Obstacles {
  readonly list: Obstacle[] = [];
  private hash = new SpatialHash<Obstacle>(6);
  private tmp: Obstacle[] = [];

  add(o: Obstacle): void {
    this.list.push(o);
    this.hash.insert(o);
  }

  query(x: number, z: number, r: number): Obstacle[] {
    return this.hash.query(x, z, r, this.tmp);
  }

  /** True if a circle at (x,z) with radius r overlaps any obstacle. */
  blocked(x: number, z: number, r: number): boolean {
    for (const o of this.query(x, z, r + 1)) {
      const dx = x - o.x;
      const dz = z - o.z;
      const rr = r + o.radius;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    return false;
  }

  /** Pushes p out of any overlapping obstacle. Returns true on contact. */
  resolve(p: THREE.Vector3, r: number): boolean {
    let hit = false;
    for (const o of this.query(p.x, p.z, r + 1)) {
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      const rr = r + o.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1e-4;
        const push = rr - d;
        p.x += (dx / d) * push;
        p.z += (dz / d) * push;
        hit = true;
      }
    }
    return hit;
  }

  /** Segment vs obstacles test (for line-of-sight / steering probes). */
  segmentHit(ax: number, az: number, bx: number, bz: number, r: number): Obstacle | null {
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const half = Math.hypot(bx - ax, bz - az) / 2;
    const abx = bx - ax;
    const abz = bz - az;
    const len2 = abx * abx + abz * abz || 1e-6;
    let best: Obstacle | null = null;
    let bestT = Infinity;
    for (const o of this.query(mx, mz, half + r + 1)) {
      let t = ((o.x - ax) * abx + (o.z - az) * abz) / len2;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + abx * t - o.x;
      const cz = az + abz * t - o.z;
      const rr = r + o.radius;
      if (cx * cx + cz * cz < rr * rr && t < bestT) {
        bestT = t;
        best = o;
      }
    }
    return best;
  }
}
