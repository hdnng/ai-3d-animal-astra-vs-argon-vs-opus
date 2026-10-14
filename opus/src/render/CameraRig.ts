/**
 * Camera controller with three modes and eased transitions between them:
 *  - follow:    third-person chase camera behind the focus animal (drag to look around)
 *  - orbit:     free orbit around the animal (drag rotates, wheel zooms)
 *  - cinematic: automatic shots (orbit, low tracking, wide, close-up) with blends
 * A 'fixed' mode is used by tests/screenshots to set an explicit view.
 */
import * as THREE from 'three';
import type { Input } from '../core/Input';
import { clamp, damp, dampAngle, lerp, smootherstep } from '../utils/math';
import { fxRandom } from '../utils/Random';

export type CameraMode = 'follow' | 'orbit' | 'cinematic' | 'fixed';

export interface CameraFocus {
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  /** Height of the head above `pos` */
  height: number;
}

export interface CameraGround {
  heightAt(x: number, z: number): number;
  waterLevel: number;
  /** Pushes a camera position out of tree canopies / trunks / boulders. */
  clearance?(p: THREE.Vector3): void;
  /** True if the segment a-b passes through foliage or trunks. */
  occluded?(a: THREE.Vector3, b: THREE.Vector3): boolean;
}

const _tp = new THREE.Vector3();
const _tt = new THREE.Vector3();

interface Shot {
  kind: 'orbit' | 'track' | 'wide' | 'close' | 'front';
  dur: number;
  seed: number;
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'follow';
  private prevMode: CameraMode = 'follow';
  private yawOffset = 0;
  private pitch = 0.32;
  private dist = 5.2;
  private orbitYaw = 0;
  private orbitPitch = 0.35;
  private orbitDist = 7;
  private readonly target = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();
  private readonly fromPos = new THREE.Vector3();
  private readonly fromTarget = new THREE.Vector3();
  private readonly smoothPos = new THREE.Vector3();
  private readonly smoothTarget = new THREE.Vector3();
  private transitionT = 1;
  private transitionDur = 1.4;
  private followYaw = 0;
  private shot: Shot = { kind: 'orbit', dur: 10, seed: 0 };
  private shotT = 0;
  private shotBlend = 1;
  private readonly shotFromPos = new THREE.Vector3();
  private readonly shotFromTarget = new THREE.Vector3();
  readonly fixedPos = new THREE.Vector3(10, 6, 10);
  readonly fixedTarget = new THREE.Vector3();
  private initialized = false;
  fovBase = 50;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.fovBase, aspect, 0.1, 1400);
    this.camera.position.set(8, 6, 8);
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.prevMode = this.mode;
    this.mode = mode;
    this.fromPos.copy(this.camera.position);
    this.fromTarget.copy(this.smoothTarget);
    this.transitionT = 0;
    this.transitionDur = mode === 'fixed' ? 0.0001 : 1.5;
    if (mode === 'orbit') {
      // Start orbit from the current view direction.
      const d = new THREE.Vector3().subVectors(this.camera.position, this.smoothTarget);
      this.orbitYaw = Math.atan2(d.x, d.z);
      this.orbitDist = clamp(d.length(), 2.5, 30);
      this.orbitPitch = clamp(Math.asin(clamp(d.y / Math.max(d.length(), 1e-3), -1, 1)), -0.1, 1.4);
    }
    if (mode === 'cinematic') {
      this.shotT = 0;
      this.shot = this.pickShot();
      this.shotBlend = 1;
    }
  }

  cycleMode(): CameraMode {
    const order: CameraMode[] = ['follow', 'orbit', 'cinematic'];
    const i = order.indexOf(this.mode as CameraMode);
    this.setMode(order[(i + 1) % order.length]);
    return this.mode;
  }

  get previousMode(): CameraMode {
    return this.prevMode;
  }

  setFixedView(pos: THREE.Vector3, target: THREE.Vector3): void {
    this.fixedPos.copy(pos);
    this.fixedTarget.copy(target);
    this.setMode('fixed');
    this.transitionT = 1;
    this.camera.position.copy(pos);
    this.smoothTarget.copy(target);
    this.camera.lookAt(target);
  }

  /** Picks a new cinematic shot, preferring ones with a clear view of the subject. */
  private pickShot(f?: CameraFocus, ground?: CameraGround): Shot {
    const kinds: Shot['kind'][] = ['orbit', 'track', 'wide', 'close', 'front'];
    let start = Math.floor(fxRandom.next() * kinds.length);
    if (kinds[start] === this.shot.kind) start = (start + 1) % kinds.length;
    let fallback: Shot | null = null;
    for (let i = 0; i < kinds.length; i++) {
      const shot: Shot = { kind: kinds[(start + i) % kinds.length], dur: 7 + fxRandom.next() * 6, seed: fxRandom.next() * 100 };
      if (!fallback) fallback = shot;
      if (!f || !ground?.occluded) return shot;
      this.computeShot(shot, 0, f, _tp, _tt);
      if (!ground.occluded(_tp, _tt)) return shot;
    }
    return { ...fallback!, kind: 'wide' };
  }

  private blockedT = 0;

  private computeShot(shot: Shot, t: number, f: CameraFocus, outPos: THREE.Vector3, outTarget: THREE.Vector3): void {
    const head = f.height;
    outTarget.set(f.pos.x, f.pos.y + head * 0.75, f.pos.z);
    const sd = shot.seed;
    switch (shot.kind) {
      case 'orbit': {
        const a = sd + t * 0.12;
        const r = 6.5 + Math.sin(t * 0.2 + sd) * 1.2;
        outPos.set(f.pos.x + Math.sin(a) * r, f.pos.y + 1.8 + Math.sin(t * 0.15) * 0.6, f.pos.z + Math.cos(a) * r);
        break;
      }
      case 'track': {
        const side = sd % 2 > 1 ? 1 : -1;
        const a = f.yaw + side * (Math.PI / 2 + 0.25);
        outPos.set(f.pos.x + Math.sin(a) * 4.2, f.pos.y + 0.45, f.pos.z + Math.cos(a) * 4.2);
        break;
      }
      case 'wide': {
        const a = sd + t * 0.04;
        outPos.set(f.pos.x + Math.sin(a) * 22, f.pos.y + 9 + t * 0.15, f.pos.z + Math.cos(a) * 22);
        outTarget.y = f.pos.y + 0.6;
        break;
      }
      case 'close': {
        const a = f.yaw + 0.6 + Math.sin(t * 0.1 + sd) * 0.3;
        outPos.set(f.pos.x + Math.sin(a) * 2.1, f.pos.y + head * 1.05, f.pos.z + Math.cos(a) * 2.1);
        outTarget.set(f.pos.x + Math.sin(f.yaw) * 0.45, f.pos.y + head * 1.15, f.pos.z + Math.cos(f.yaw) * 0.45);
        break;
      }
      case 'front': {
        const a = f.yaw + Math.sin(t * 0.12 + sd) * 0.4;
        const r = 5.5 - Math.min(t * 0.1, 1.5);
        outPos.set(f.pos.x + Math.sin(a) * r, f.pos.y + 0.9, f.pos.z + Math.cos(a) * r);
        break;
      }
    }
  }

  /** True while the player steers manually (camera then stops chasing the wolf's heading). */
  manualSteer = false;

  /**
   * Heading (yaw) that movement keys are relative to. Stable in follow/orbit
   * modes (independent of the wolf's own heading) to avoid feedback loops.
   */
  get controlYaw(): number {
    if (this.mode === 'follow') return this.followYaw + this.yawOffset;
    if (this.mode === 'orbit') return this.orbitYaw + Math.PI;
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    return Math.atan2(d.x, d.z);
  }

  update(dt: number, f: CameraFocus, input: Input | null, ground: CameraGround): void {
    const cam = this.camera;
    // User input.
    if (input) {
      if (this.mode === 'follow') {
        this.yawOffset -= input.dragX * 0.006;
        this.pitch = clamp(this.pitch + input.dragY * 0.004, -0.05, 1.25);
        this.dist = clamp(this.dist * (1 + input.wheel * 0.001), 2.2, 16);
        if (!input.dragging && f.speed > 0.5 && !this.manualSteer) this.yawOffset = damp(this.yawOffset, 0, 0.6, dt);
      } else if (this.mode === 'orbit') {
        this.orbitYaw -= input.dragX * 0.006;
        this.orbitPitch = clamp(this.orbitPitch + input.dragY * 0.004, -0.05, 1.45);
        this.orbitDist = clamp(this.orbitDist * (1 + input.wheel * 0.001), 2.0, 60);
      } else if (this.mode === 'cinematic' && (input.dragX !== 0 || input.wheel !== 0)) {
        // any interaction skips to the next shot
        this.shotT = this.shot.dur;
      }
    }

    // Desired view for the current mode.
    const head = f.height;
    switch (this.mode) {
      case 'follow': {
        if (!this.initialized) this.followYaw = f.yaw;
        if (this.manualSteer) {
          // Recentre gently only while running roughly away from the camera.
          const diff = Math.abs(((f.yaw - this.followYaw - this.yawOffset + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          if (f.speed > 0.5 && diff < 1.0) this.followYaw = dampAngle(this.followYaw, f.yaw - this.yawOffset, 1.2, dt);
        } else {
          this.followYaw = dampAngle(this.followYaw, f.yaw, f.speed > 0.3 ? 2.2 : 0.6, dt);
        }
        const a = this.followYaw + Math.PI + this.yawOffset;
        const horiz = Math.cos(this.pitch) * this.dist;
        this.desiredTarget.set(f.pos.x + Math.sin(f.yaw) * 0.6, f.pos.y + head * 0.85, f.pos.z + Math.cos(f.yaw) * 0.6);
        this.desiredPos.set(
          this.desiredTarget.x + Math.sin(a) * horiz,
          this.desiredTarget.y + Math.sin(this.pitch) * this.dist,
          this.desiredTarget.z + Math.cos(a) * horiz,
        );
        break;
      }
      case 'orbit': {
        this.desiredTarget.set(f.pos.x, f.pos.y + head * 0.7, f.pos.z);
        const horiz = Math.cos(this.orbitPitch) * this.orbitDist;
        this.desiredPos.set(
          this.desiredTarget.x + Math.sin(this.orbitYaw) * horiz,
          this.desiredTarget.y + Math.sin(this.orbitPitch) * this.orbitDist,
          this.desiredTarget.z + Math.cos(this.orbitYaw) * horiz,
        );
        break;
      }
      case 'cinematic': {
        this.shotT += dt;
        // Cut away early if foliage blocks the view for a while.
        if (ground.occluded && ground.occluded(cam.position, this.smoothTarget)) this.blockedT += dt;
        else this.blockedT = 0;
        if (this.shotT >= this.shot.dur || this.blockedT > 1.2) {
          this.blockedT = 0;
          this.shotFromPos.copy(cam.position);
          this.shotFromTarget.copy(this.smoothTarget);
          this.shot = this.pickShot(f, ground);
          this.shotT = 0;
          this.shotBlend = 0;
        }
        this.computeShot(this.shot, this.shotT, f, this.desiredPos, this.desiredTarget);
        if (this.shotBlend < 1) {
          this.shotBlend = Math.min(1, this.shotBlend + dt / 2.2);
          const e = smootherstep(this.shotBlend);
          this.desiredPos.lerpVectors(this.shotFromPos, this.desiredPos, e);
          this.desiredTarget.lerpVectors(this.shotFromTarget, this.desiredTarget, e);
        }
        break;
      }
      case 'fixed':
        this.desiredPos.copy(this.fixedPos);
        this.desiredTarget.copy(this.fixedTarget);
        break;
    }

    // Keep out of trees/rocks and above terrain and water.
    if (this.mode !== 'fixed') ground.clearance?.(this.desiredPos);
    const minY = Math.max(ground.heightAt(this.desiredPos.x, this.desiredPos.z), ground.waterLevel) + 0.35;
    if (this.desiredPos.y < minY) this.desiredPos.y = minY;

    // Smoothing (frame-rate independent).
    if (!this.initialized) {
      this.smoothPos.copy(this.desiredPos);
      this.smoothTarget.copy(this.desiredTarget);
      this.initialized = true;
    } else if (this.mode === 'fixed') {
      this.smoothPos.copy(this.desiredPos);
      this.smoothTarget.copy(this.desiredTarget);
    } else {
      const kp = this.mode === 'follow' ? 6 : this.mode === 'orbit' ? 12 : 4;
      const kt = this.mode === 'follow' ? 10 : this.mode === 'orbit' ? 14 : 5;
      this.smoothPos.x = damp(this.smoothPos.x, this.desiredPos.x, kp, dt);
      this.smoothPos.y = damp(this.smoothPos.y, this.desiredPos.y, kp, dt);
      this.smoothPos.z = damp(this.smoothPos.z, this.desiredPos.z, kp, dt);
      this.smoothTarget.x = damp(this.smoothTarget.x, this.desiredTarget.x, kt, dt);
      this.smoothTarget.y = damp(this.smoothTarget.y, this.desiredTarget.y, kt, dt);
      this.smoothTarget.z = damp(this.smoothTarget.z, this.desiredTarget.z, kt, dt);
    }

    // Mode transition blend.
    if (this.transitionT < 1) {
      this.transitionT = Math.min(1, this.transitionT + dt / this.transitionDur);
      const e = smootherstep(this.transitionT);
      cam.position.lerpVectors(this.fromPos, this.smoothPos, e);
      this.target.lerpVectors(this.fromTarget, this.smoothTarget, e);
      // Arc upward mid-transition for a nicer move.
      cam.position.y += Math.sin(e * Math.PI) * 0.8;
    } else {
      cam.position.copy(this.smoothPos);
      this.target.copy(this.smoothTarget);
    }
    const minCam = Math.max(ground.heightAt(cam.position.x, cam.position.z), ground.waterLevel) + 0.3;
    if (cam.position.y < minCam) cam.position.y = minCam;
    cam.lookAt(this.target);
    const wantFov = this.mode === 'cinematic' ? (this.shot.kind === 'close' ? 38 : this.shot.kind === 'wide' ? 45 : 42) : this.fovBase + clamp(f.speed - 4, 0, 8) * 0.8;
    cam.fov = lerp(cam.fov, wantFov, 1 - Math.exp(-2 * dt));
    cam.updateProjectionMatrix();
  }

  get focusTarget(): THREE.Vector3 {
    return this.target;
  }

  get shotName(): string {
    return this.mode === 'cinematic' ? this.shot.kind : this.mode;
  }

  setAspect(a: number): void {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }
}
