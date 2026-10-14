/**
 * Deer herd member: grazes, wanders with the herd, becomes alert when a wolf
 * is noticed and flees (away from all threats, around obstacles and water)
 * with limited stamina. Rests at night.
 */
import { hyp } from '../utils/math';
import * as THREE from 'three';
import type { Animal } from '../animal/Animal';
import type { Ecosystem } from '../eco/Ecosystem';
import type { NavGrid } from './NavGrid';
import { PathFollower, avoidObstacles, flatDist, separate } from './Steering';
import { Random } from '../utils/Random';
import { clamp01 } from '../utils/math';
import { events } from '../core/Events';

export type DeerMode = 'graze' | 'walk' | 'alert' | 'flee' | 'rest' | 'dead';

const _v = new THREE.Vector3();

export class DeerBrain {
  mode: DeerMode = 'graze';
  private timer = 3;
  stamina = 1;
  private calmT = 0;
  private follower: PathFollower;
  private rnd: Random;
  awareness = 0;
  readonly target = new THREE.Vector3();
  hasTarget = false;
  threat: Animal | null = null;

  constructor(
    readonly deer: Animal,
    private nav: NavGrid,
    private eco: Ecosystem,
    seed: number,
  ) {
    this.follower = new PathFollower(nav);
    this.rnd = new Random(seed);
    this.timer = 2 + this.rnd.next() * 8;
  }

  get fleeing(): boolean {
    return this.mode === 'flee';
  }

  get thought(): string {
    switch (this.mode) {
      case 'graze':
        return 'Grazing';
      case 'walk':
        return 'Moving with the herd';
      case 'alert':
        return 'Alert!';
      case 'flee':
        return 'Fleeing!';
      case 'rest':
        return 'Resting';
      case 'dead':
        return '';
    }
  }

  reset(): void {
    this.mode = 'graze';
    this.timer = 2 + this.rnd.next() * 6;
    this.stamina = 1;
    this.awareness = 0;
    this.follower.clear();
  }

  update(dt: number, night: number): void {
    const d = this.deer;
    if (this.mode === 'dead') return;
    this.hasTarget = false;
    // --- perception
    let nearest = Infinity;
    let fast = false;
    this.threat = null;
    let fx = 0;
    let fz = 0;
    for (const w of this.eco.wolves) {
      const dist = flatDist(w.pos, d.pos);
      if (dist < 60) {
        const k = 1 / Math.max(dist * dist, 1);
        fx += (d.pos.x - w.pos.x) * k;
        fz += (d.pos.z - w.pos.z) * k;
      }
      if (dist < nearest) {
        nearest = dist;
        this.threat = w;
        fast = w.speed > 4.5;
      }
    }
    const stalking = this.threat?.state === 'stalk';
    const noticeRange = stalking ? 16 : fast ? 42 : 30;
    if (nearest < noticeRange) this.awareness = clamp01(this.awareness + dt * (stalking ? 0.35 : 1.5) * (1 + (noticeRange - nearest) / 10));
    else this.awareness = clamp01(this.awareness - dt * 0.2);
    this.stamina = clamp01(this.stamina + (this.mode === 'flee' ? -dt / 11 : dt / 25));

    if (this.mode !== 'flee' && (nearest < (stalking ? 9 : 17) || (this.awareness > 0.75 && (fast || nearest < 26)))) {
      this.mode = 'flee';
      this.calmT = 0;
      if (d.state !== 'locomotion') d.play('locomotion', { fade: 0.15 });
      events.emit('deerAlarm', { x: d.pos.x, y: d.pos.y + 1.2, z: d.pos.z });
      this.eco.alarmHerd(d);
    }

    switch (this.mode) {
      case 'flee': {
        let dx = fx;
        let dz = fz;
        const hc = this.eco.herdCenter;
        dx += (hc.x - d.pos.x) * 0.002;
        dz += (hc.z - d.pos.z) * 0.002;
        // keep inside the valley
        const r = hyp(d.pos.x, d.pos.z);
        if (r > 85) {
          dx -= (d.pos.x / r) * (r - 85) * 0.01;
          dz -= (d.pos.z / r) * (r - 85) * 0.01;
        }
        this.chooseClearDir(dx, dz, _v);
        d.moveDir.set(_v.x, _v.z);
        d.moveSpeed = d.spec.gait.maxSpeed * (0.55 + 0.45 * this.stamina);
        avoidObstacles(d, this.eco.world.obstacles, 5);
        separate(d, this.eco.deer, 1.8, 0.6);
        if (nearest > 48) this.calmT += dt;
        else this.calmT = 0;
        if (this.calmT > 3) {
          this.mode = 'alert';
          this.timer = 4;
        }
        break;
      }
      case 'alert': {
        d.moveSpeed = 0;
        if (d.state !== 'alert' && d.canAct()) d.play('alert');
        if (this.threat) d.lookTarget = this.threat.root.position;
        if (this.threat) d.turnToward(this.threat.pos.x, this.threat.pos.z);
        this.timer -= dt;
        if (this.timer <= 0 && this.awareness < 0.4) {
          d.faceYaw = null;
          d.lookTarget = null;
          d.play('locomotion');
          this.startWalk();
        }
        break;
      }
      case 'graze': {
        d.moveSpeed = 0;
        if (this.awareness > 0.4) {
          this.mode = 'alert';
          this.timer = 3 + this.rnd.next() * 3;
          break;
        }
        if (d.state !== 'eat' && d.canAct()) d.play('eat');
        this.timer -= dt;
        if (this.timer <= 0) {
          d.play('locomotion');
          if (night > 0.6 && this.rnd.chance(0.6)) {
            this.mode = 'rest';
            this.timer = 20 + this.rnd.next() * 30;
          } else this.startWalk();
        }
        break;
      }
      case 'walk': {
        if (this.awareness > 0.4) {
          this.mode = 'alert';
          this.timer = 3;
          break;
        }
        this.hasTarget = true;
        if (this.follower.update(d, d.spec.gait.walkSpeed * 0.9, dt, 1.2) || this.follower.failed) {
          this.mode = 'graze';
          this.timer = 6 + this.rnd.next() * 12;
        }
        separate(d, this.eco.deer, 1.6, 0.5);
        break;
      }
      case 'rest': {
        d.moveSpeed = 0;
        if (d.state !== 'lie' && d.canAct()) d.play('lie');
        this.timer -= dt;
        if (this.awareness > 0.3 || (this.timer <= 0 && night < 0.5)) {
          d.play('locomotion');
          this.mode = this.awareness > 0.3 ? 'alert' : 'graze';
          this.timer = 4;
        }
        break;
      }
    }
  }

  private startWalk(): void {
    const hc = this.eco.herdCenter;
    const d = this.deer;
    const cx = (hc.x * 0.7 + d.pos.x * 0.3);
    const cz = (hc.z * 0.7 + d.pos.z * 0.3);
    if (this.nav.randomPointNear(cx, cz, 3, 14, () => this.rnd.next(), this.target) && this.follower.setGoal(d.pos, this.target)) {
      this.mode = 'walk';
    } else {
      this.mode = 'graze';
      this.timer = 5;
    }
  }

  /** Picks the flee direction closest to (dx,dz) that leads to walkable dry ground. */
  private chooseClearDir(dx: number, dz: number, out: THREE.Vector3): void {
    const base = Math.atan2(dx, dz);
    const p = this.deer.pos;
    for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4, -2.4]) {
      const a = base + off;
      const sx = Math.sin(a);
      const sz = Math.cos(a);
      let ok = true;
      for (const dist of [3, 7]) {
        const x = p.x + sx * dist;
        const z = p.z + sz * dist;
        if (!this.nav.walkable(x, z) || this.eco.world.waterDepth(x, z) > 0.25) {
          ok = false;
          break;
        }
      }
      if (ok) {
        out.set(sx, 0, sz);
        return;
      }
    }
    out.set(Math.sin(base), 0, Math.cos(base));
  }

  kill(): void {
    this.mode = 'dead';
    this.deer.moveSpeed = 0;
    this.deer.moveDir.set(0, 0);
    this.deer.lookTarget = null;
  }
}
