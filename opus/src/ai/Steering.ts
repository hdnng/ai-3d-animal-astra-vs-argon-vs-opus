/**
 * Path following and local steering (separation, obstacle probes, pursuit).
 */
import { hyp } from '../utils/math';
import * as THREE from 'three';
import type { Animal } from '../animal/Animal';
import type { NavGrid } from './NavGrid';
import type { Obstacles } from '../world/Obstacles';


export class PathFollower {
  path: THREE.Vector3[] = [];
  idx = 0;
  readonly goal = new THREE.Vector3();
  hasGoal = false;
  private stuckT = 0;
  private lastDist = Infinity;
  private repathT = 0;
  failed = false;

  constructor(private nav: NavGrid) {}

  setGoal(from: THREE.Vector3, goal: THREE.Vector3): boolean {
    this.goal.copy(goal);
    this.hasGoal = true;
    this.failed = false;
    this.stuckT = 0;
    this.lastDist = Infinity;
    const p = this.nav.findPath(from.x, from.z, goal.x, goal.z);
    if (!p || p.length === 0) {
      this.path = [];
      this.hasGoal = false;
      this.failed = true;
      return false;
    }
    this.path = p;
    this.idx = 0;
    return true;
  }

  clear(): void {
    this.path = [];
    this.idx = 0;
    this.hasGoal = false;
  }

  get remaining(): number {
    if (!this.hasGoal) return 0;
    return this.path.length - this.idx;
  }

  /** Current steering target (or null when finished). */
  current(): THREE.Vector3 | null {
    return this.idx < this.path.length ? this.path[this.idx] : null;
  }

  /**
   * Steers `agent` along the path. Returns true when the final waypoint is
   * reached (within `arrive`).
   */
  update(agent: Animal, speed: number, dt: number, arrive = 1.2): boolean {
    if (!this.hasGoal || this.path.length === 0) return true;
    const p = agent.pos;
    // Skip ahead when a later waypoint is directly visible.
    while (this.idx < this.path.length - 1) {
      const wp = this.path[this.idx];
      const d = hyp(wp.x - p.x, wp.z - p.z);
      const next = this.path[this.idx + 1];
      if (d < 1.6 || this.nav.lineOfSight(p.x, p.z, next.x, next.z)) this.idx++;
      else break;
    }
    const wp = this.path[this.idx];
    const dx = wp.x - p.x;
    const dz = wp.z - p.z;
    const dist = hyp(dx, dz);
    const last = this.idx === this.path.length - 1;
    if (last && dist < arrive) {
      agent.moveDir.set(0, 0);
      agent.moveSpeed = 0;
      this.hasGoal = false;
      return true;
    }
    // Stuck detection -> repath.
    const total = dist + (this.path.length - 1 - this.idx) * 3;
    if (total < this.lastDist - 0.05) {
      this.lastDist = total;
      this.stuckT = 0;
    } else {
      this.stuckT += dt;
    }
    this.repathT -= dt;
    if (this.stuckT > 2.5 && this.repathT <= 0) {
      this.repathT = 2;
      this.stuckT = 0;
      this.lastDist = Infinity;
      if (!this.setGoal(p, this.goal)) return true;
    }
    agent.moveDir.set(dx, dz);
    const slow = last ? Math.min(1, Math.max(0.35, dist / 4)) : 1;
    agent.moveSpeed = speed * slow;
    return false;
  }
}

/** Adds a separation push away from nearby animals to agent.moveDir. */
export function separate(agent: Animal, others: readonly Animal[], radius: number, weight = 1): void {
  let sx = 0;
  let sz = 0;
  for (const o of others) {
    if (o === agent) continue;
    const dx = agent.pos.x - o.pos.x;
    const dz = agent.pos.z - o.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > radius * radius || d2 < 1e-6) continue;
    const d = Math.sqrt(d2);
    const k = (1 - d / radius) / d;
    sx += dx * k;
    sz += dz * k;
  }
  if (sx === 0 && sz === 0) return;
  const len = hyp(agent.moveDir.x, agent.moveDir.y) || 1;
  agent.moveDir.x = agent.moveDir.x / len + sx * weight;
  agent.moveDir.y = agent.moveDir.y / len + sz * weight;
}

/**
 * Steers around static obstacles with a forward probe: if the segment ahead
 * hits a trunk/boulder, bend the heading to the side with more clearance.
 */
export function avoidObstacles(agent: Animal, obstacles: Obstacles, lookAhead: number): void {
  const len = hyp(agent.moveDir.x, agent.moveDir.y);
  if (len < 1e-4) return;
  const dx = agent.moveDir.x / len;
  const dz = agent.moveDir.y / len;
  const ax = agent.pos.x;
  const az = agent.pos.z;
  const hit = obstacles.segmentHit(ax, az, ax + dx * lookAhead, az + dz * lookAhead, agent.radius + 0.2);
  if (!hit) return;
  // side: perpendicular away from the obstacle centre
  const px = -dz;
  const pz = dx;
  const side = (hit.x - ax) * px + (hit.z - az) * pz > 0 ? -1 : 1;
  const ox = hit.x - ax;
  const oz = hit.z - az;
  const od = hyp(ox, oz);
  const urgency = Math.max(0.3, 1 - od / lookAhead) * 1.6;
  agent.moveDir.x = dx + px * side * urgency;
  agent.moveDir.y = dz + pz * side * urgency;
}

/** Pursuit: aim at the target's predicted position. */
export function pursuitPoint(agent: Animal, target: Animal, out: THREE.Vector3): THREE.Vector3 {
  const d = agent.pos.distanceTo(target.pos);
  const t = Math.min(1.5, d / Math.max(4, agent.speed + 1));
  return out.copy(target.pos).addScaledVector(target.vel, t);
}

export function flatDist(a: THREE.Vector3, b: THREE.Vector3): number {
  return hyp(a.x - b.x, a.z - b.z);
}

