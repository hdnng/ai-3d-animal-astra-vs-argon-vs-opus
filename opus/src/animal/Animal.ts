/**
 * Generic procedurally-animated quadruped: character controller (heading,
 * speed, jumping, swimming, collisions), animation state machine, foot
 * planning, pose application with leg IK, secondary spring motion, look-at
 * and blinking. Wolves and deer are both instances of this class.
 */
import { hyp } from '../utils/math';
import * as THREE from 'three';
import { CreatureMesh } from './CreatureMesh';
import { FootPlanner, type Ground, type MotionState } from './FootPlanner';
import { Animator, type AnimContext, type StateName } from './Animator';
import { ALL_STATES } from './AnimStates';
import type { PoseParams } from './Pose';
import type { LegBones, Rig } from './Rig';
import type { SpeciesSpec } from './species/types';
import { Spring, Spring2 } from '../utils/Spring';
import { angleDiff, approach, clamp, clamp01, damp, lerp } from '../utils/math';
import { fxRandom } from '../utils/Random';
import { events } from '../core/Events';

export type Surface = 'grass' | 'dirt' | 'water' | 'rock';

export interface AnimalEnv extends Ground {
  /** Pushes `p` out of static obstacles and keeps it inside the world. */
  collide(p: THREE.Vector3, radius: number): boolean;
  surfaceAt(x: number, z: number): Surface;
  readonly waterLevel: number;
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qFk = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _A = new THREE.Vector3();
const _H = new THREE.Vector3();
const _K = new THREE.Vector3();
const _T = new THREE.Vector3();
const _N = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _lat = new THREE.Vector3();
const _up = new THREE.Vector3();
const _bFwd = new THREE.Vector3();
const _bLat = new THREE.Vector3();
const _b0 = new THREE.Vector3();
const _l0 = new THREE.Vector3();
const _c0 = new THREE.Vector3();
const _b1 = new THREE.Vector3();
const _l1 = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _m0 = new THREE.Matrix4();
const _m1 = new THREE.Matrix4();
const X_AXIS = new THREE.Vector3(1, 0, 0);

let nextId = 1;
const BUSY_STATES = new Set<StateName>(['jump', 'pounce', 'dead']);

export class Animal implements AnimContext {
  readonly id = nextId++;
  readonly root = new THREE.Group();
  readonly mesh: CreatureMesh;
  readonly rig: Rig;
  readonly planner: FootPlanner;
  readonly animator: Animator;
  readonly spec: SpeciesSpec;

  // ---- motion state ----
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  yawRate = 0;
  speed = 0;
  readonly motion: MotionState;
  /** Desired travel direction (xz, need not be normalized) and speed. */
  readonly moveDir = new THREE.Vector2();
  moveSpeed = 0;
  /** If set while not moving, turn in place to this yaw. */
  faceYaw: number | null = null;
  radius = 0.35;

  // ---- airborne ----
  airborne = false;
  vy = 0;
  baseY = 0;
  timeSinceLanded = 99;
  crouchT = 0.15;
  private launch: { at: number; vy: number; hSpeed: number; dirX: number; dirZ: number } | null = null;
  private stateTime = 0;

  // ---- AnimContext ----
  time = 0;
  readonly scale: number;
  exertion = 0;
  happy = 0.2;
  alert = 0;
  random = Math.random();

  // ---- environment status ----
  swimming = false;
  waterDepth = 0;
  wetness = 0;
  surface: Surface = 'grass';

  // ---- secondary motion ----
  private tailSprings: Spring2[] = [];
  private earSprings: Spring2[] = [new Spring2(160, 9), new Spring2(160, 9)];
  /** Additive spine bend (x = yaw, y = pitch); under-damped so the torso lags and overshoots. */
  private spineSpring = new Spring2(70, 9);
  private prevYawRate = 0;
  /** Pelvis acceleration of the previous frame in the body frame (m/s^2). */
  private bodyAccFwd = 0;
  private bodyAccLat = 0;
  private bodyAccUp = 0;
  private prevPelvis = new THREE.Vector3();
  private pelvisVel = new THREE.Vector3();
  private prevHead = new THREE.Vector3();
  private headVel = new THREE.Vector3();
  private bodyPitchS = 0;
  private bodyRollS = 0;
  private baseYSpring = new Spring(0, 220, 26);
  private breathPhase = Math.random() * 10;
  private wagPhase = 0;
  private earTwitchT = 2;
  private blinkT = 2 + Math.random() * 3;
  private blinkV = 0;
  lookTarget: THREE.Vector3 | null = null;
  private lookYaw = 0;
  private lookPitch = 0;
  private initialized = false;
  /** 0 = full detail; 1 = reduced (no secondary); 2 = minimal (no IK) */
  lod = 0;
  readonly tongue: THREE.Mesh | null = null;
  readonly legsInGait = [true, true, true, true];
  /** Last blended pose (for debugging/inspection). */
  lastPose: PoseParams | null = null;
  name: string;

  constructor(
    spec: SpeciesSpec,
    readonly env: AnimalEnv,
    readonly kind: 'wolf' | 'deer',
    tint = new THREE.Color(1, 1, 1),
    variant = 0,
  ) {
    this.spec = spec;
    this.name = kind;
    this.mesh = new CreatureMesh(spec, tint, variant);
    this.rig = this.mesh.rig;
    this.scale = this.rig.restBodyY / 0.68;
    this.root.add(this.mesh.group);
    this.root.name = `${kind}-${this.id}`;
    this.planner = new FootPlanner(this.rig, spec.gait, env, spec.pawHeight);
    this.animator = new Animator(ALL_STATES);
    this.animator.onFinish = (n) => this.onStateFinished(n);
    this.motion = { pos: this.pos, vel: this.vel, yaw: 0, yawRate: 0, speed: 0, grounded: true };
    for (let i = 0; i < this.rig.tail.length; i++) {
      const k = lerp(240, 70, i / Math.max(1, this.rig.tail.length - 1));
      this.tailSprings.push(new Spring2(k, Math.sqrt(k) * 1.1));
    }
    this.radius = 0.32 * this.scale;
    if (kind === 'wolf') {
      const tg = new THREE.CapsuleGeometry(0.018, 0.06, 4, 8);
      tg.rotateX(Math.PI / 2);
      tg.scale(1, 0.35, 1);
      const tm = new THREE.MeshStandardMaterial({ color: 0xc0506a, roughness: 0.35 });
      const tongue = new THREE.Mesh(tg, tm);
      tongue.name = 'tongue';
      const jawPos = this.rig.restPos.get('jaw')!;
      tongue.position.set(0, 0.892 - jawPos.y, 0.7 - jawPos.z);
      tongue.userData.base = tongue.position.clone();
      tongue.scale.setScalar(0.001);
      this.rig.jaw.add(tongue);
      this.tongue = tongue;
    }
  }

  // ------------------------------------------------------------------ API

  get state(): StateName {
    return this.animator.current;
  }

  get grounded(): boolean {
    return !this.airborne;
  }

  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** Teleports the animal and plants its feet. */
  place(x: number, z: number, yaw: number): void {
    this.pos.set(x, this.env.heightAt(x, z), z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.yawRate = 0;
    this.prevYawRate = 0;
    this.spineSpring.reset();
    this.speed = 0;
    this.airborne = false;
    this.vy = 0;
    this.launch = null;
    this.baseY = this.pos.y;
    this.baseYSpring.reset(this.pos.y);
    this.syncMotion();
    this.planner.resetFeet(this.motion);
    this.root.position.set(x, this.pos.y, z);
    this.root.rotation.set(0, yaw, 0);
    this.initialized = false;
    this.animator.play('locomotion', { fade: 0.01 });
  }

  /** Leader of the pack (its howls make the others join in). */
  isLeader = false;
  /** Voice pitch multiplier for howls/barks. */
  voicePitch = 1;

  play(name: StateName, opts?: { fade?: number; restart?: boolean }): boolean {
    if (this.airborne && name !== 'jump' && name !== 'pounce') return false;
    const ok = this.animator.play(name, opts);
    if (ok && name === 'howl') {
      events.emit('howl', { x: this.pos.x, y: this.pos.y + 0.9, z: this.pos.z, pitch: this.voicePitch, leader: this.isLeader });
    }
    return ok;
  }

  canAct(): boolean {
    return !this.airborne && !this.swimming && this.launch === null && !BUSY_STATES.has(this.state);
  }

  /** Starts a jump (crouch -> launch). */
  jump(): boolean {
    if (!this.canAct()) return false;
    this.crouchT = 0.14;
    this.animator.play('jump', { restart: true });
    const f = this.forward(_v);
    const h = Math.max(this.speed, 0) + 1.6;
    this.launch = { at: this.crouchT, vy: 4.1, hSpeed: h, dirX: f.x, dirZ: f.z };
    this.timeSinceLanded = 99;
    this.stateTime = 0;
    return true;
  }

  /** Pounce toward a ground point (mouse-pounce arc). */
  pounce(target: THREE.Vector3 | null): boolean {
    if (!this.canAct()) return false;
    this.crouchT = 0.6;
    this.animator.play('pounce', { restart: true });
    const vy = 4.4;
    const flight = (2 * vy) / 9.81;
    let dx = Math.sin(this.yaw);
    let dz = Math.cos(this.yaw);
    let dist = 2.2;
    if (target) {
      dx = target.x - this.pos.x;
      dz = target.z - this.pos.z;
      dist = clamp(hyp(dx, dz), 0.8, 4.2);
      const l = hyp(dx, dz) || 1;
      dx /= l;
      dz /= l;
    }
    this.launch = { at: this.crouchT, vy, hSpeed: dist / flight, dirX: dx, dirZ: dz };
    this.timeSinceLanded = 99;
    this.stateTime = 0;
    return true;
  }

  private onStateFinished(name: StateName): void {
    if (name === 'howl' || name === 'shake' || name === 'playbow') this.animator.play('locomotion');
  }

  private syncMotion(): void {
    this.motion.yaw = this.yaw;
    this.motion.yawRate = this.yawRate;
    this.motion.speed = this.speed;
    this.motion.grounded = !this.airborne;
  }

  // --------------------------------------------------------------- update

  update(dt: number, globalTime: number): void {
    this.time = globalTime;
    this.stateTime += dt;
    this.updateMovement(dt);
    this.syncMotion();
    const pose = (this.lastPose = this.animator.update(dt, this));
    for (let i = 0; i < 4; i++) this.legsInGait[i] = pose.legs[i].poseW < 0.999 && pose.legs[i].ik > 0.001 && !this.airborne && !this.swimming;
    this.planner.enabled = !this.airborne && !this.swimming;
    this.planner.update(dt, this.motion, this.legsInGait);
    for (const f of this.planner.feet) {
      if (f.justPlanted) this.emitFootstep(f.contact, f.front);
    }
    this.applyPose(dt, pose);
  }

  private emitFootstep(p: THREE.Vector3, front: boolean): void {
    const depth = this.env.waterDepth(p.x, p.z);
    const surface: Surface = depth > 0.02 ? 'water' : this.env.surfaceAt(p.x, p.z);
    events.emit('footstep', {
      x: p.x,
      y: p.y,
      z: p.z,
      strength: clamp01(0.25 + this.speed / 8) * (front ? 1 : 0.85) * this.scale,
      surface,
      animal: this.kind,
    });
  }

  private updateMovement(dt: number): void {
    const g = this.spec.gait;
    const env = this.env;
    // Water state.
    this.waterDepth = env.waterDepth(this.pos.x, this.pos.z);
    const swimDepth = 0.52 * this.scale;
    if (!this.airborne) {
      if (!this.swimming && this.waterDepth > swimDepth && this.kind === 'wolf') {
        this.swimming = true;
        this.animator.play('swim');
        events.emit('splash', { x: this.pos.x, y: env.waterLevel, z: this.pos.z, strength: 0.8 });
      } else if (this.swimming && this.waterDepth < swimDepth * 0.7) {
        this.swimming = false;
        this.animator.play('locomotion');
        this.planner.resetFeet(this.motion);
      }
    }
    if (this.waterDepth > 0.25 * this.scale) this.wetness = Math.min(1, this.wetness + dt * 0.8);
    else this.wetness = Math.max(0, this.wetness - dt * 0.012);
    this.mesh.fur.uWetness.value = this.wetness;

    // Pending launch after the anticipation crouch.
    if (this.launch && this.stateTime >= this.launch.at) {
      const L = this.launch;
      this.launch = null;
      this.airborne = true;
      this.vy = L.vy;
      this.vel.set(L.dirX * L.hSpeed, 0, L.dirZ * L.hSpeed);
      this.speed = L.hSpeed;
      this.pos.y = this.baseY;
      events.emit('jump', { x: this.pos.x, y: this.pos.y, z: this.pos.z });
    }

    if (this.airborne) {
      this.vy -= 9.81 * dt;
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.pos.y += this.vy * dt;
      env.collide(this.pos, this.radius);
      const gh = env.heightAt(this.pos.x, this.pos.z);
      const floor = Math.max(gh, this.waterDepth > 0.3 ? env.waterLevel - 0.4 : gh);
      if (this.pos.y <= floor && this.vy < 0) {
        this.pos.y = gh;
        this.airborne = false;
        this.timeSinceLanded = 0;
        const impact = clamp01(-this.vy / 6);
        this.vy = 0;
        this.speed *= 0.55;
        this.forward(_v);
        this.vel.set(_v.x * this.speed, 0, _v.z * this.speed);
        this.planner.resetFeet(this.motion);
        events.emit('land', { x: this.pos.x, y: gh, z: this.pos.z, strength: impact });
        if (this.waterDepth > 0.05) events.emit('splash', { x: this.pos.x, y: env.waterLevel, z: this.pos.z, strength: 1 });
      }
      return;
    }
    this.timeSinceLanded += dt;
    if ((this.state === 'jump' || this.state === 'pounce') && this.launch === null && this.timeSinceLanded > 0.45) {
      this.animator.play('locomotion', { fade: 0.35 });
    }

    // Steering.
    const moveScale = this.launch ? 0 : this.animator.moveScale;
    const maxSpeed = (this.swimming ? 1.6 * this.scale : g.maxSpeed) * moveScale;
    const wantMove = this.moveDir.lengthSq() > 1e-4 && this.moveSpeed > 0.01;
    let speedTarget = 0;
    let yawRateTarget = 0;
    const turnRate = g.turnRate * (this.speed < 1.5 ? 1.15 : lerp(1, 0.5, clamp01((this.speed - 1.5) / (g.maxSpeed - 1.5))));
    if (wantMove && moveScale > 0.01) {
      const targetYaw = Math.atan2(this.moveDir.x, this.moveDir.y);
      const diff = angleDiff(this.yaw, targetYaw);
      yawRateTarget = clamp(diff * 5, -turnRate, turnRate);
      const align = clamp01(1 - (Math.abs(diff) - 0.35) / 1.4);
      speedTarget = Math.min(this.moveSpeed, maxSpeed) * align;
    } else if (this.faceYaw !== null && moveScale > 0.01) {
      const diff = angleDiff(this.yaw, this.faceYaw);
      yawRateTarget = Math.abs(diff) > 0.05 ? clamp(diff * 4, -turnRate * 0.8, turnRate * 0.8) : 0;
    }
    this.yawRate = damp(this.yawRate, yawRateTarget, 9, dt);
    this.yaw += this.yawRate * dt;
    // Slope resistance.
    this.forward(_v);
    const ahead = env.heightAt(this.pos.x + _v.x * 0.8, this.pos.z + _v.z * 0.8) - env.heightAt(this.pos.x, this.pos.z);
    const slope = ahead / 0.8;
    if (slope > 0.45) speedTarget *= clamp01(1 - (slope - 0.45) * 2.5);
    // Shallow water drags.
    if (!this.swimming && this.waterDepth > 0.08) speedTarget *= clamp(1 - this.waterDepth * 0.9, 0.45, 1);
    const accel = speedTarget > this.speed ? (this.speed < 3 ? 5 : 7) : 10;
    this.speed = approach(this.speed, speedTarget, accel * dt);
    this.vel.set(_v.x * this.speed, 0, _v.z * this.speed);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    if (env.collide(this.pos, this.radius)) {
      // Lose speed when sliding along obstacles.
      this.speed *= 0.97;
    }
    this.pos.y = env.heightAt(this.pos.x, this.pos.z);
    // Exertion: rises with speed, decays at rest.
    const effort = clamp01((this.speed - 2) / (g.maxSpeed - 2));
    this.exertion = clamp01(this.exertion + (effort > 0.15 ? effort * 0.09 : -0.045) * dt);
  }

  // ----------------------------------------------------------- pose / IK

  private applyPose(dt: number, pose: PoseParams): void {
    const rig = this.rig;
    const env = this.env;
    const feet = this.planner.feet;
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);

    // --- Ground under the body (front/hind, left/right).
    let hF = 0, hH = 0, hL = 0, hR = 0;
    for (let i = 0; i < 4; i++) {
      const f = feet[i];
      const x = this.pos.x + f.neutralX * c + f.neutralZ * s;
      const z = this.pos.z - f.neutralX * s + f.neutralZ * c;
      const h = env.heightAt(x, z);
      if (f.front) hF += h * 0.5;
      else hH += h * 0.5;
      if (f.left) hL += h * 0.5;
      else hR += h * 0.5;
    }
    const len = rig.bodyLength;
    const groundPitch = Math.atan2(hF - hH, len);
    const groundRoll = Math.atan2(hL - hR, 0.4 * this.scale) * 0.45;
    let base: number;
    if (this.airborne) {
      base = this.pos.y;
      this.baseYSpring.reset(base);
    } else if (this.swimming) {
      const target = env.waterLevel - rig.restBodyY - 0.06 * this.scale + Math.sin(this.time * 2.4) * 0.012;
      this.baseYSpring.target = target;
      base = this.baseYSpring.update(dt);
    } else {
      this.baseYSpring.target = (hF + hH) * 0.5;
      if (!this.initialized) this.baseYSpring.reset(this.baseYSpring.target);
      base = this.baseYSpring.update(dt);
      // Never let the spring sink the body into rising ground.
      base = Math.max(base, this.baseYSpring.target - 0.05);
    }
    this.baseY = this.airborne ? this.pos.y : (hF + hH) * 0.5;
    this.root.position.set(this.pos.x, base, this.pos.z);
    this.root.rotation.set(0, this.yaw, 0);

    const align = pose.groundAlign * (this.airborne || this.swimming ? 0 : 1);
    const pitchT = pose.bodyPitch + groundPitch * align;
    const rollT = pose.bodyRoll + groundRoll * align;
    if (!this.initialized) {
      this.bodyPitchS = pitchT;
      this.bodyRollS = rollT;
    }
    this.bodyPitchS = damp(this.bodyPitchS, pitchT, 14, dt);
    this.bodyRollS = damp(this.bodyRollS, rollT, 12, dt);

    // --- Body & spine FK.
    const restBody = rig.restPos.get('body')!;
    // Standing crouch gives the legs slack; the reach constraint (below) adds more when needed.
    const grounded = !this.airborne && !this.swimming;
    const standDrop = grounded ? 0.022 * this.scale : 0;
    if (!grounded) {
      this.reachDropF = damp(this.reachDropF, 0, 6, dt);
      this.reachDropH = damp(this.reachDropH, 0, 6, dt);
    }
    this.placeBody(restBody, pose, standDrop, len);

    // --- Spine lag: an additive spring forced by yaw acceleration and body
    // acceleration. The torso bends late into a turn and keeps bending briefly
    // after it, rounds when braking and flexes with the gallop's bounce.
    const yawAcc = this.initialized ? (this.yawRate - this.prevYawRate) / Math.max(dt, 1e-3) : 0;
    this.prevYawRate = this.yawRate;
    if (this.lod === 0) {
      this.spineSpring.update(
        dt,
        clamp(-yawAcc * 0.35 + this.bodyAccLat * 0.25, -14, 14),
        clamp(-this.bodyAccFwd * 0.5 + this.bodyAccUp * 0.3, -14, 14),
      );
    } else this.spineSpring.reset();
    const spineYaw = pose.spineYaw + clamp(this.spineSpring.x.value, -0.22, 0.22);
    const spinePitch = pose.spinePitch + clamp(this.spineSpring.y.value, -0.12, 0.12);
    rig.spine.quaternion.setFromEuler(_e.set(spinePitch * 0.5, spineYaw * 0.5, pose.spineRoll * 0.45, 'XYZ'));
    rig.pelvis.quaternion.setFromEuler(_e.set(-spinePitch * 0.5, spineYaw * 0.5, -pose.spineRoll * 0.45, 'XYZ'));
    rig.chest.quaternion.setFromEuler(_e.set(spinePitch * 0.2, spineYaw * 0.25, pose.spineRoll * 0.4, 'XYZ'));

    // --- Breathing.
    this.breathPhase += dt * Math.PI * 2 * 0.28 * pose.breath;
    const br = Math.sin(this.breathPhase) * 0.022 * clamp01(pose.breath + 0.3);
    rig.ribs.scale.set(1 + br, 1 + br * 1.2, 1 + br * 0.3);

    // --- Look-at (computed in the yaw frame from last frame's head position).
    let wantYaw = 0;
    let wantPitch = 0;
    if (this.lookTarget && pose.lookW > 0.01) {
      _v.setFromMatrixPosition(rig.head.matrixWorld);
      const dx = this.lookTarget.x - _v.x;
      const dy = this.lookTarget.y - _v.y;
      const dz = this.lookTarget.z - _v.z;
      const heading = Math.atan2(dx, dz);
      wantYaw = clamp(angleDiff(this.yaw + pose.spineYaw * 0.5, heading), -1.15, 1.15);
      wantPitch = clamp(Math.atan2(dy, hyp(dx, dz)), -0.55, 0.5);
      if (Math.abs(angleDiff(this.yaw, heading)) > 2.2) {
        wantYaw = 0;
        wantPitch = 0;
      }
      wantYaw *= pose.lookW;
      wantPitch *= pose.lookW;
    }
    this.lookYaw = damp(this.lookYaw, wantYaw, 4.5, dt);
    this.lookPitch = damp(this.lookPitch, wantPitch, 4.5, dt);

    // --- Neck & head.
    const ly = this.lookYaw;
    const lp = this.lookPitch;
    rig.neck0.quaternion.setFromEuler(_e.set(-pose.neckPitch * 0.5 - lp * 0.15, pose.neckYaw * 0.5 + ly * 0.3, 0, 'YXZ'));
    rig.neck1.quaternion.setFromEuler(_e.set(-pose.neckPitch * 0.5 - lp * 0.25, pose.neckYaw * 0.5 + ly * 0.3, 0, 'YXZ'));
    rig.head.quaternion.setFromEuler(_e.set(-pose.headPitch - lp * 0.6, pose.headYaw + ly * 0.4, pose.headRoll, 'YXZ'));
    rig.jaw.quaternion.setFromAxisAngle(X_AXIS, clamp(pose.jaw, 0, 1) * 0.55);
    if (this.tongue) {
      const t = clamp01(pose.tongue);
      this.tongue.scale.setScalar(t < 0.02 ? 0.001 : 0.6 + 0.4 * t);
      const b = this.tongue.userData.base as THREE.Vector3;
      this.tongue.position.set(b.x, b.y - 0.004 * t, b.z + 0.03 * t);
      this.tongue.visible = t > 0.02;
    }

    // --- Ears with spring flop and random twitches.
    this.root.updateMatrixWorld(true);
    _v.setFromMatrixPosition(rig.head.matrixWorld);
    const hvx = (_v.x - this.prevHead.x) / Math.max(dt, 1e-3);
    const hvy = (_v.y - this.prevHead.y) / Math.max(dt, 1e-3);
    const hvz = (_v.z - this.prevHead.z) / Math.max(dt, 1e-3);
    const hax = this.initialized ? (hvx - this.headVel.x) / Math.max(dt, 1e-3) : 0;
    const hay = this.initialized ? (hvy - this.headVel.y) / Math.max(dt, 1e-3) : 0;
    const haz = this.initialized ? (hvz - this.headVel.z) / Math.max(dt, 1e-3) : 0;
    this.headVel.set(hvx, hvy, hvz);
    this.prevHead.copy(_v);
    const hLat = hax * c - haz * s;
    this.earTwitchT -= dt;
    if (this.earTwitchT <= 0 && this.lod === 0) {
      this.earTwitchT = 1.5 + fxRandom.next() * 5;
      const which = fxRandom.next() < 0.5 ? 0 : 1;
      this.earSprings[which].x.impulse((fxRandom.next() - 0.3) * 6);
      this.earSprings[which].y.impulse((fxRandom.next() - 0.5) * 5);
    }
    for (let i = 0; i < 2; i++) {
      const sp = this.earSprings[i];
      sp.update(dt, clamp(-hay * 0.012, -3, 3), clamp((i === 0 ? 1 : -1) * hLat * 0.01, -3, 3));
      const ear = i === 0 ? rig.earL : rig.earR;
      const sgn = i === 0 ? 1 : -1;
      ear.quaternion.setFromEuler(_e.set(pose.earPitch + clamp(sp.x.value, -0.6, 0.6), sgn * clamp(sp.y.value, -0.5, 0.5) * 0.5, -sgn * (pose.earYaw + clamp(sp.y.value, -0.5, 0.5) * 0.5), 'XYZ'));
    }

    // --- Tail: pose + wag + chain springs driven by pelvis acceleration.
    _v.setFromMatrixPosition(rig.pelvis.matrixWorld);
    const pvx = (_v.x - this.prevPelvis.x) / Math.max(dt, 1e-3);
    const pvy = (_v.y - this.prevPelvis.y) / Math.max(dt, 1e-3);
    const pvz = (_v.z - this.prevPelvis.z) / Math.max(dt, 1e-3);
    const pax = this.initialized ? (pvx - this.pelvisVel.x) / Math.max(dt, 1e-3) : 0;
    const pay = this.initialized ? (pvy - this.pelvisVel.y) / Math.max(dt, 1e-3) : 0;
    const paz = this.initialized ? (pvz - this.pelvisVel.z) / Math.max(dt, 1e-3) : 0;
    this.pelvisVel.set(pvx, pvy, pvz);
    this.prevPelvis.copy(_v);
    const aLat = clamp(pax * c - paz * s, -40, 40);
    const aUp = clamp(pay, -40, 40);
    this.bodyAccLat = aLat;
    this.bodyAccUp = aUp;
    this.bodyAccFwd = clamp(pax * s + paz * c, -40, 40);
    this.wagPhase += dt * Math.PI * 2 * Math.max(pose.tailWagFreq, 0.5);
    const n = rig.tail.length;
    for (let i = 0; i < n; i++) {
      const sp = this.tailSprings[i];
      if (i > 0) {
        sp.x.target = this.tailSprings[i - 1].x.value * 0.55;
        sp.y.target = this.tailSprings[i - 1].y.value * 0.55;
      }
      if (this.lod === 0) sp.update(dt, -aUp * 0.02 * (1 + i * 0.3), aLat * 0.025 * (1 + i * 0.3));
      const lift = i === 0 ? pose.tailLift * 0.6 : (pose.tailLift * 0.4) / Math.max(1, n - 1);
      const curl = pose.tailCurl * (i / n);
      const wag = pose.tailWag * Math.sin(this.wagPhase - i * 0.55) * (0.35 + (0.65 * i) / n);
      const yaw = (pose.tailYaw / n) + wag / n * 2.2 + clamp(sp.y.value, -0.7, 0.7);
      rig.tail[i].quaternion.setFromEuler(_e.set(lift + curl + clamp(sp.x.value, -0.6, 0.6), yaw, 0, 'YXZ'));
    }

    // --- Blink.
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blinkT = 2 + fxRandom.next() * 4.5;
      this.blinkV = 1;
    }
    this.blinkV = Math.max(0, this.blinkV - dt * 7);
    const bl = this.blinkV > 0 ? Math.sin(this.blinkV * Math.PI) : 0;
    this.mesh.setBlink(Math.max(pose.eyeClose, bl));

    // --- Legs: gather targets, enforce reach by lowering/pitching the body, then IK.
    _fwd.set(s, 0, c);
    _lat.set(c, 0, -s);
    let dyF = Infinity;
    let dyH = Infinity;
    for (let i = 0; i < 4; i++) {
      const dy = this.prepareLeg(rig.legs[i], i, pose);
      if (rig.legs[i].front) dyF = Math.min(dyF, dy);
      else dyH = Math.min(dyH, dy);
    }
    if (grounded && this.lod < 2) {
      const maxDrop = 0.3 * this.scale;
      const wantF = isFinite(dyF) ? clamp(this.reachDropF - dyF, 0, maxDrop) : 0;
      const wantH = isFinite(dyH) ? clamp(this.reachDropH - dyH, 0, maxDrop) : 0;
      // Drop instantly (never float), recover smoothly.
      const newF = wantF > this.reachDropF ? wantF : damp(this.reachDropF, wantF, 5, dt);
      const newH = wantH > this.reachDropH ? wantH : damp(this.reachDropH, wantH, 5, dt);
      if (Math.abs(newF - this.reachDropF) > 1e-5 || Math.abs(newH - this.reachDropH) > 1e-5) {
        this.reachDropF = newF;
        this.reachDropH = newH;
        this.placeBody(restBody, pose, standDrop, len);
        this.root.updateMatrixWorld(true);
        for (let i = 0; i < 4; i++) if (rig.legs[i].root) this.prepareLeg(rig.legs[i], i, pose);
      }
    }
    for (let i = 0; i < 4; i++) this.solveLeg(rig.legs[i], i, pose);

    this.initialized = true;
  }

  private reachDropF = 0;
  private reachDropH = 0;
  private readonly legT = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly legN = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly legMeta = [0, 0, 0, 0];
  private readonly legToe = [0, 0, 0, 0];

  /** Sets the root bone from pose + terrain pitch/roll + reach drop. */
  private placeBody(restBody: THREE.Vector3, pose: PoseParams, standDrop: number, len: number): void {
    const rig = this.rig;
    const dropMid = (this.reachDropF + this.reachDropH) * 0.5;
    const dropPitch = Math.atan2(this.reachDropH - this.reachDropF, len);
    rig.root.position.set(restBody.x, restBody.y + pose.bodyY - standDrop - dropMid, restBody.z + pose.bodyZ);
    rig.root.quaternion.setFromEuler(_e.set(-(this.bodyPitchS + dropPitch), 0, this.bodyRollS, 'YXZ'));
  }

  /**
   * Computes the leg's IK target and the vertical body offset that would make
   * it reachable (negative = body must drop). Front legs also set the scapula.
   */
  private prepareLeg(leg: LegBones, i: number, pose: PoseParams): number {
    const lp = pose.legs[i];
    const foot = this.planner.feet[i];
    const ik = this.airborne || this.swimming ? 0 : clamp01(lp.ik);
    if (ik <= 0.001 || this.lod >= 2) return Infinity;
    const T = this.legT[i];
    const pw = clamp01(lp.poseW);
    T.copy(foot.target);
    let meta = foot.metaAngle;
    let toeCurl = foot.toeCurl;
    if (pw > 0.001) {
      const s = Math.sin(this.yaw);
      const c = Math.cos(this.yaw);
      const px = this.pos.x + lp.tx * c + lp.tz * s;
      const pz = this.pos.z - lp.tx * s + lp.tz * c;
      const py = this.env.heightAt(px, pz) + lp.ty;
      _v.set(px, py, pz);
      T.lerp(_v, pw);
      meta = lerp(meta, lp.metaAngle, pw);
      toeCurl = lerp(toeCurl, lp.toeCurl, pw);
    }
    const gh = this.env.heightAt(T.x, T.z);
    if (T.y < gh + 0.01) T.y = gh + 0.01;
    this.env.normalAt(T.x, T.z, this.legN[i]);
    this.legMeta[i] = meta;
    this.legToe[i] = toeCurl;
    // Scapula assists reach for front legs.
    if (leg.root) {
      _H.setFromMatrixPosition(leg.root.matrixWorld);
      const dzf = (T.x - _H.x) * _fwd.x + (T.z - _H.z) * _fwd.z - (leg.neutral.z - this.rig.restPos.get(leg.root.name)!.z);
      const scap = clamp(-dzf * 0.85, -0.5, 0.45);
      this.setBone(leg.root, null, lerp(lp.fkRoot, scap, ik), 0);
    }
    if (ik < 0.5) return Infinity;
    this.metaJoint(leg, T, this.legN[i], meta, _A);
    _H.setFromMatrixPosition(leg.upper.matrixWorld);
    const L = (leg.lUpper + leg.lLower) * 0.985;
    const h = hyp(_A.x - _H.x, _A.z - _H.z);
    if (h >= L) return Infinity;
    return Math.sqrt(L * L - h * h) - (_H.y - _A.y);
  }

  /** Position of the hock/wrist given the paw target and metatarsal angle. */
  private metaJoint(leg: LegBones, T: THREE.Vector3, N: THREE.Vector3, meta: number, out: THREE.Vector3): THREE.Vector3 {
    _up.set(0, 1, 0).lerp(N, 0.4).normalize();
    _v2.copy(_fwd).addScaledVector(_up, -_fwd.dot(_up)).normalize();
    return out
      .copy(T)
      .addScaledVector(_up, Math.cos(meta) * leg.lMeta)
      .addScaledVector(_v2, -Math.sin(meta) * leg.lMeta);
  }

  /** Sets a bone's local rotation so its rest direction points along `dir` (world). */
  private aimBone(bone: THREE.Bone, restDir: THREE.Vector3, dir: THREE.Vector3, lateral: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
    _b0.copy(restDir);
    _l0.copy(X_AXIS).addScaledVector(_b0, -_b0.x).normalize();
    _c0.crossVectors(_b0, _l0);
    _b1.copy(dir).normalize();
    _l1.copy(lateral).addScaledVector(_b1, -_b1.dot(lateral));
    if (_l1.lengthSq() < 1e-8) _l1.copy(lateral);
    _l1.normalize();
    _c1.crossVectors(_b1, _l1);
    _m0.makeBasis(_b0, _l0, _c0);
    _m1.makeBasis(_b1, _l1, _c1);
    _m.multiplyMatrices(_m1, _m0.transpose());
    out.setFromRotationMatrix(_m);
    _q2.setFromRotationMatrix(bone.parent!.matrixWorld);
    return out.premultiply(_q2.invert());
  }

  private setBone(bone: THREE.Bone, ikLocal: THREE.Quaternion | null, fkAngle: number, ik: number): void {
    _qFk.setFromAxisAngle(X_AXIS, fkAngle);
    if (ikLocal && ik > 0.001) {
      if (ik >= 0.999) bone.quaternion.copy(ikLocal);
      else bone.quaternion.copy(_qFk).slerp(ikLocal, ik);
    } else {
      bone.quaternion.copy(_qFk);
    }
    bone.updateMatrixWorld(true);
  }

  private solveLeg(leg: LegBones, i: number, pose: PoseParams): void {
    const lp = pose.legs[i];
    const ik = this.airborne || this.swimming ? 0 : clamp01(lp.ik);
    if (ik <= 0.001 || this.lod >= 2) {
      if (leg.root) this.setBone(leg.root, null, lp.fkRoot, 0);
      this.setBone(leg.upper, null, lp.fkUpper, 0);
      this.setBone(leg.lower, null, lp.fkLower, 0);
      this.setBone(leg.meta, null, lp.fkMeta, 0);
      this.setBone(leg.toe, null, lp.fkToe, 0);
      return;
    }
    _T.copy(this.legT[i]);
    _N.copy(this.legN[i]);
    const toeCurl = this.legToe[i];
    // Body frame (world).
    _q.setFromRotationMatrix(leg.upper.parent!.matrixWorld);
    _bFwd.set(0, 0, 1).applyQuaternion(_q);
    _bLat.set(1, 0, 0).applyQuaternion(_q);
    this.metaJoint(leg, _T, _N, this.legMeta[i], _A);

    // Two-bone IK hip/shoulder -> hock/wrist.
    _H.setFromMatrixPosition(leg.upper.matrixWorld);
    const l1 = leg.lUpper;
    const l2 = leg.lLower;
    _v.subVectors(_A, _H);
    let d = _v.length();
    const maxD = (l1 + l2) * 0.999;
    const minD = Math.abs(l1 - l2) + 0.01;
    if (d > maxD) {
      _A.copy(_H).addScaledVector(_v, maxD / d);
      d = maxD;
    }
    d = Math.max(d, minD);
    const u = _v.normalize();
    // Pole: hind knees forward, front elbows backward.
    _v2.copy(_bFwd).multiplyScalar(leg.front ? -1 : 1);
    _v2.addScaledVector(u, -_v2.dot(u));
    if (_v2.lengthSq() < 1e-6) _v2.set(0, 1, 0);
    _v2.normalize();
    const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    _K.copy(_H).addScaledVector(u, cosA * l1).addScaledVector(_v2, sinA * l1);

    // Upper.
    _v.subVectors(_K, _H);
    this.setBone(leg.upper, this.aimBone(leg.upper, leg.restUpperDir, _v, _bLat, _q), lp.fkUpper, ik);
    // Lower.
    _v2.setFromMatrixPosition(leg.lower.matrixWorld);
    _v.subVectors(_A, _v2);
    this.setBone(leg.lower, this.aimBone(leg.lower, leg.restLowerDir, _v, _bLat, _q), lp.fkLower, ik);
    // Meta.
    _v2.setFromMatrixPosition(leg.meta.matrixWorld);
    _v.subVectors(_T, _v2);
    this.setBone(leg.meta, this.aimBone(leg.meta, leg.restMetaDir, _v, _bLat, _q), lp.fkMeta, ik);
    // Toe: lie flat on the terrain, curled during swing.
    _v2.copy(_fwd).addScaledVector(_N, -_fwd.dot(_N)).normalize();
    _v.crossVectors(_N, _v2); // lateral
    _m.makeBasis(_v, _N, _v2);
    _q.setFromRotationMatrix(_m);
    _q2.setFromAxisAngle(_v.normalize(), toeCurl);
    _q.premultiply(_q2);
    _q2.setFromRotationMatrix(leg.toe.parent!.matrixWorld);
    _q.premultiply(_q2.invert());
    this.setBone(leg.toe, _q, lp.fkToe, ik);
  }

  /**
   * World transforms are read straight from matrixWorld: applyPose keeps them
   * current, and Object3D.getWorld*() would re-walk the whole parent chain.
   */
  /** Approximate world position of the mouth (for eating/drinking checks). */
  mouthPosition(out: THREE.Vector3): THREE.Vector3 {
    const tip = this.rig.restTip.get('head')!;
    const hp = this.rig.restPos.get('head')!;
    out.set(tip.x - hp.x, tip.y - hp.y, tip.z - hp.z);
    return out.applyMatrix4(this.rig.head.matrixWorld);
  }

  headPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.setFromMatrixPosition(this.rig.head.matrixWorld);
  }

  /** Human readable locomotion/gait description for the HUD. */
  describeMotion(): string {
    if (this.airborne) return this.state === 'pounce' ? 'Pouncing' : 'Jumping';
    if (this.swimming) return 'Swimming';
    const st = this.state;
    if (st !== 'locomotion') return st.charAt(0).toUpperCase() + st.slice(1);
    const g = this.planner.gaitName;
    if (g === 'stand') return Math.abs(this.yawRate) > 0.4 ? 'Turning' : 'Idle';
    return g === 'walk' ? 'Walking' : g === 'trot' ? 'Trotting' : 'Galloping';
  }

  /**
   * Level of detail: 0 = full (fine mesh, IK, springs), 1 = medium mesh,
   * 2 = coarse mesh without IK/secondary motion. `shells` is the fur shell count.
   */
  setLOD(level: number, shells: number): void {
    this.lod = level;
    this.mesh.setMeshLOD(level);
    this.mesh.setShellCount(shells);
  }

  dispose(): void {
    this.mesh.dispose();
    if (this.tongue) {
      this.tongue.geometry.dispose();
      (this.tongue.material as THREE.Material).dispose();
    }
    this.root.removeFromParent();
  }

  /** Smoothly track a heading (used by AI when idle). */
  turnToward(x: number, z: number): void {
    this.faceYaw = Math.atan2(x - this.pos.x, z - this.pos.z);
  }

}
