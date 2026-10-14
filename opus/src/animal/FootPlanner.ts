/**
 * Procedural foot placement.
 *
 * Moving: a gait cycle (walk / trot / gallop, blended by speed) decides when
 * each leg is in stance or swing. Stance feet stay planted in world space;
 * swing feet travel on an arc to a predicted landing point (body velocity and
 * turn rate extrapolated to mid-stance), snapped to the terrain.
 *
 * Standing / turning in place: feet stay planted until they drift too far
 * from their neutral spot, then take corrective steps in diagonal pairs.
 */
import { hyp } from '../utils/math';
import * as THREE from 'three';
import type { Rig } from './Rig';
import type { GaitSpec } from './species/types';
import { clamp, smoothstep } from '../utils/math';

export interface Ground {
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3;
  waterDepth(x: number, z: number): number;
}

export interface MotionState {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  yawRate: number;
  speed: number;
  grounded: boolean;
}

export interface FootState {
  front: boolean;
  left: boolean;
  stance: boolean;
  /** Ground contact point while planted. */
  plant: THREE.Vector3;
  lift: THREE.Vector3;
  landing: THREE.Vector3;
  /** Current paw-joint IK target (world). */
  target: THREE.Vector3;
  /** Ground contact under the current target. */
  contact: THREE.Vector3;
  normal: THREE.Vector3;
  swingT: number;
  swingDur: number;
  swingScale: number;
  neutralX: number;
  neutralZ: number;
  pawHeight: number;
  restMeta: number;
  metaAngle: number;
  toeCurl: number;
  /** Set for one frame when the foot touches down. */
  justPlanted: boolean;
}

// Phase offsets [FL, FR, HL, HR]
const OFF_WALK = [0.25, 0.75, 0.0, 0.5];
const OFF_TROT = [0.5, 1.0, 0.0, 0.5];
const OFF_GALLOP = [0.6, 0.7, 0.0, 0.1];

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

export class FootPlanner {
  readonly feet: FootState[] = [];
  phase = 0;
  cadence = 1;
  duty = 0.62;
  walkW = 1;
  trotW = 0;
  gallopW = 0;
  /** 0 = standing stepping mode, 1 = full cyclic gait */
  cyclic = 0;
  private cyclicActive = false;
  private settleTimer = 0;
  enabled = true;
  /** Multiplier on stance width/length (e.g. crouched stalking) */
  stanceScale = 1;

  constructor(
    private rig: Rig,
    private gait: GaitSpec,
    private ground: Ground,
    pawHeight: [number, number],
  ) {
    for (const leg of rig.legs) {
      const n = leg.neutral;
      const restMeta = Math.atan2(-leg.restMetaDir.z, -leg.restMetaDir.y) * -1;
      this.feet.push({
        front: leg.front,
        left: leg.side === 'L',
        stance: true,
        plant: new THREE.Vector3(),
        lift: new THREE.Vector3(),
        landing: new THREE.Vector3(),
        target: new THREE.Vector3(),
        contact: new THREE.Vector3(),
        normal: new THREE.Vector3(0, 1, 0),
        swingT: 0,
        swingDur: 0.3,
        swingScale: 1,
        neutralX: n.x * (leg.front ? 1.0 : 1.0),
        neutralZ: n.z,
        pawHeight: leg.front ? pawHeight[0] : pawHeight[1],
        restMeta,
        metaAngle: restMeta,
        toeCurl: 0,
        justPlanted: false,
      });
    }
  }

  /** World position of a foot's neutral spot for a given body position/yaw. */
  neutralWorld(f: FootState, pos: THREE.Vector3, yaw: number, out: THREE.Vector3): THREE.Vector3 {
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    const x = f.neutralX * (1 + (this.stanceScale - 1) * 0.3);
    const z = f.neutralZ * this.stanceScale;
    out.set(pos.x + x * c + z * s, 0, pos.z - x * s + z * c);
    out.y = this.ground.heightAt(out.x, out.z);
    return out;
  }

  /** Plants every foot at its neutral spot (teleport / landing / reset). */
  resetFeet(m: MotionState): void {
    for (const f of this.feet) {
      this.neutralWorld(f, m.pos, m.yaw, f.plant);
      f.stance = true;
      f.swingT = 0;
      f.lift.copy(f.plant);
      f.landing.copy(f.plant);
      f.contact.copy(f.plant);
      this.ground.normalAt(f.plant.x, f.plant.z, f.normal);
      f.target.copy(f.plant).addScaledVector(f.normal, f.pawHeight);
      f.metaAngle = f.restMeta;
      f.toeCurl = 0;
    }
    this.cyclicActive = false;
    this.cyclic = 0;
  }

  /** Updates gait blend weights from forward speed. */
  private updateGaitParams(speed: number): void {
    const g = this.gait;
    const s = Math.abs(speed);
    this.walkW = 1 - smoothstep(g.walkToTrot - 0.25, g.walkToTrot + 0.25, s);
    this.gallopW = smoothstep(g.trotToGallop - 0.4, g.trotToGallop + 0.5, s);
    this.trotW = Math.max(0, 1 - this.walkW - this.gallopW);
    const cad = this.walkW * (1.0 + 0.3 * s) + this.trotW * (1.95 + 0.1 * s) + this.gallopW * (2.25 + 0.04 * s);
    this.cadence = Math.max(cad, 0.9);
    this.duty = this.walkW * 0.62 + this.trotW * 0.44 + this.gallopW * clamp(0.3 - 0.008 * s, 0.2, 0.3);
  }

  private offset(i: number): number {
    return OFF_WALK[i] * this.walkW + OFF_TROT[i] * this.trotW + OFF_GALLOP[i] * this.gallopW;
  }

  get gaitName(): string {
    if (!this.cyclicActive) return 'stand';
    if (this.gallopW > 0.5) return 'gallop';
    if (this.trotW > 0.5) return 'trot';
    return 'walk';
  }

  update(dt: number, m: MotionState, legsInGait: boolean[]): void {
    for (const f of this.feet) f.justPlanted = false;
    if (!this.enabled) return;
    const speed = hyp(m.vel.x, m.vel.z);
    this.updateGaitParams(speed);
    const wantCyclic = speed > 0.18 || (speed > 0.05 && Math.abs(m.yawRate) > 0.5);
    if (wantCyclic && !this.cyclicActive) this.cyclicActive = true;
    if (!wantCyclic && this.cyclicActive) {
      this.cyclicActive = false;
      this.settleTimer = 1.2;
    }
    this.cyclic += ((this.cyclicActive ? 1 : 0) - this.cyclic) * (1 - Math.exp(-6 * dt));
    if (this.cyclicActive) this.phase = (this.phase + this.cadence * dt) % 1;
    this.settleTimer = Math.max(0, this.settleTimer - dt);

    const stanceDur = this.duty / this.cadence;
    const swingDurCyc = (1 - this.duty) / this.cadence;
    const reach = this.rig.legs[0].lUpper + this.rig.legs[0].lLower;

    let swinging = 0;
    for (const f of this.feet) if (!f.stance) swinging++;

    for (let i = 0; i < 4; i++) {
      const f = this.feet[i];
      const inGait = legsInGait[i];
      if (!inGait) {
        // Leg is driven by a pose; keep the planner foot glued under it.
        this.neutralWorld(f, m.pos, m.yaw, f.plant);
        f.stance = true;
        f.contact.copy(f.plant);
        this.ground.normalAt(f.plant.x, f.plant.z, f.normal);
        f.target.copy(f.plant).addScaledVector(f.normal, f.pawHeight);
        continue;
      }
      if (f.stance) {
        let startSwing = false;
        let dur = 0.26;
        if (this.cyclicActive) {
          const p = (this.phase + this.offset(i)) % 1;
          if (p >= this.duty) {
            startSwing = true;
            const s0 = (p - this.duty) / (1 - this.duty);
            dur = Math.max(0.1, (1 - s0) * swingDurCyc);
          }
          // Forced lift if the planted foot is left too far behind.
          this.neutralWorld(f, m.pos, m.yaw, _v);
          const err = hyp(f.plant.x - _v.x, f.plant.z - _v.z);
          if (err > reach * 0.85) {
            startSwing = true;
            dur = Math.max(0.12, swingDurCyc * 0.7);
          }
          f.swingScale = 1;
        } else {
          this.neutralWorld(f, m.pos, m.yaw, _v);
          const err = hyp(f.plant.x - _v.x, f.plant.z - _v.z);
          const thresh = this.settleTimer > 0 ? 0.045 : 0.13;
          if (err > thresh && this.canIdleStep(i)) {
            startSwing = true;
            dur = 0.24 + Math.min(err, 0.3) * 0.4;
            f.swingScale = clamp(err / 0.15, 0.4, 1);
          }
        }
        if (startSwing && (this.cyclicActive || swinging < 2)) {
          f.stance = false;
          f.swingT = 0;
          f.swingDur = dur;
          f.lift.copy(f.plant);
          swinging++;
        }
      }

      if (!f.stance) {
        f.swingT += dt / f.swingDur;
        // Predict landing: extrapolate the body to mid-stance.
        const remaining = Math.max(0, (1 - f.swingT) * f.swingDur);
        const ahead = remaining + (this.cyclicActive ? stanceDur * 0.5 : 0);
        _v.set(m.pos.x + m.vel.x * ahead, 0, m.pos.z + m.vel.z * ahead);
        this.neutralWorld(f, _v, m.yaw + m.yawRate * ahead * 0.85, f.landing);
        if (f.swingT >= 1) {
          f.stance = true;
          f.plant.copy(f.landing);
          f.justPlanted = true;
          f.swingT = 0;
        }
      }

      // Final target for IK.
      if (f.stance) {
        f.contact.copy(f.plant);
        f.contact.y = this.ground.heightAt(f.plant.x, f.plant.z);
        this.ground.normalAt(f.contact.x, f.contact.z, f.normal);
        f.target.copy(f.contact).addScaledVector(f.normal, f.pawHeight);
        // Heel lifts as the foot trails behind the hip (push-off).
        this.neutralWorld(f, m.pos, m.yaw, _v);
        const fx = Math.sin(m.yaw);
        const fz = Math.cos(m.yaw);
        const dz = (f.plant.x - _v.x) * fx + (f.plant.z - _v.z) * fz;
        const push = clamp(-dz * (f.front ? 0.9 : 1.6), -0.12, f.front ? 0.5 : 0.75);
        f.metaAngle = f.restMeta + push * this.cyclic;
        f.toeCurl = 0;
      } else {
        const t = f.swingT;
        const e = t * t * (3 - 2 * t);
        f.contact.lerpVectors(f.lift, f.landing, e);
        const gh = this.ground.heightAt(f.contact.x, f.contact.z);
        f.contact.y = Math.max(f.contact.y, gh);
        const height = this.gait.stepHeight * (1 + this.trotW * 0.25 + this.gallopW * 0.9) * f.swingScale;
        const arc = Math.pow(Math.sin(Math.PI * t), 0.85) * height;
        this.ground.normalAt(f.contact.x, f.contact.z, _n);
        f.normal.lerp(_n, 0.3);
        f.target.copy(f.contact);
        f.target.y += f.pawHeight + arc;
        const flex = (f.front ? 1.75 : 0.95) * (0.45 + 0.55 * this.cyclic) * f.swingScale;
        f.metaAngle = f.restMeta + Math.sin(Math.PI * Math.min(1, t * 1.1)) * flex;
        f.toeCurl = Math.sin(Math.PI * t) * 0.7;
      }
    }
  }

  /** Idle stepping: allow at most a diagonal pair to swing simultaneously. */
  private canIdleStep(i: number): boolean {
    const diag = [3, 2, 1, 0][i];
    for (let k = 0; k < 4; k++) {
      if (k === i || this.feet[k].stance) continue;
      if (k !== diag) return false;
    }
    return true;
  }

  /** True if any foot is touching the ground. */
  anyStance(): boolean {
    for (const f of this.feet) if (f.stance) return true;
    return false;
  }
}
