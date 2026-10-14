/**
 * Manual control: camera-relative WASD/arrow movement, Shift to run,
 * Ctrl/C to walk slowly, Space to jump, plus action keys for special moves.
 */
import * as THREE from 'three';
import type { Input } from '../core/Input';
import type { Animal } from '../animal/Animal';

export type PlayerAction = 'howl' | 'interact' | 'shake' | 'pounce' | 'sit' | 'lie' | 'sniff' | 'playbow';

const KEY_ACTIONS: Record<string, PlayerAction> = {
  KeyQ: 'howl',
  KeyE: 'interact',
  KeyR: 'shake',
  KeyF: 'pounce',
  KeyZ: 'sit',
  KeyX: 'lie',
  KeyV: 'sniff',
  KeyB: 'playbow',
};

const _f = new THREE.Vector3();
const RESTING = new Set(['sit', 'lie', 'sleep', 'eat', 'drink', 'sniff', 'stalk', 'playbow']);
const _r = new THREE.Vector3();

export class PlayerController {
  /** Last action requested this frame (consumed by the simulation). */
  action: PlayerAction | null = null;
  moving = false;

  /** @param controlYaw heading that "forward" maps to (camera-relative). */
  update(input: Input, wolf: Animal, controlYaw: number): void {
    this.action = null;
    let fx = 0;
    let fz = 0;
    if (input.anyDown('KeyW', 'ArrowUp')) fz += 1;
    if (input.anyDown('KeyS', 'ArrowDown')) fz -= 1;
    if (input.anyDown('KeyA', 'ArrowLeft')) fx -= 1;
    if (input.anyDown('KeyD', 'ArrowRight')) fx += 1;
    _f.set(Math.sin(controlYaw), 0, Math.cos(controlYaw));
    _r.set(-_f.z, 0, _f.x); // camera right on the ground plane
    const dx = _f.x * fz + _r.x * fx;
    const dz = _f.z * fz + _r.z * fx;
    this.moving = fx !== 0 || fz !== 0;
    if (this.moving) {
      wolf.moveDir.set(dx, dz);
      const run = input.anyDown('ShiftLeft', 'ShiftRight');
      const slow = input.anyDown('ControlLeft', 'ControlRight', 'AltLeft', 'AltRight');
      wolf.moveSpeed = run ? wolf.spec.gait.maxSpeed : slow ? wolf.spec.gait.walkSpeed : wolf.spec.gait.trotSpeed;
      // Moving out of a resting pose stands the wolf up.
      if (RESTING.has(wolf.state)) wolf.play('locomotion');
    } else {
      wolf.moveDir.set(0, 0);
      wolf.moveSpeed = 0;
    }
    wolf.faceYaw = null;
    if (input.pressed('Space')) wolf.jump();
    for (const code in KEY_ACTIONS) {
      if (input.pressed(code)) this.action = KEY_ACTIONS[code];
    }
  }
}
