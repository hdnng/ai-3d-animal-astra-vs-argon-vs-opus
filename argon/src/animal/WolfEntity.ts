import * as THREE from 'three';
import { WolfMeshBuilder, WolfRigResult } from './WolfMeshBuilder';
import { FootstepEvent, TerrainHeightSampler, WolfAnimator, WolfAnimState } from './WolfAnimator';
import { clamp, dampAngle, wrapAngle } from '../utils/math';
import { InputManager } from '../core/Input';

export interface WolfNeeds {
  hunger: number;    // 0..100 (100 = full, 0 = starving)
  thirst: number;    // 0..100 (100 = hydrated, 0 = parched)
  energy: number;    // 0..100 (100 = rested, 0 = exhausted)
  curiosity: number; // 0..100 (social / territorial drive)
}

export interface ObstacleCollider {
  x: number;
  z: number;
  radius: number;
}

/**
 * Primary Wolf Entity (supports both Utility AI autonomy and Manual WASD/Arrow control).
 * Integrates skeleton, skinned mesh, terrain-conforming IK, biological needs, and physics.
 */
export class WolfEntity {
  public rig: WolfRigResult;
  public animator: WolfAnimator;
  public skeletonHelper: THREE.SkeletonHelper;

  public position = new THREE.Vector3(0, 0, 0);
  public velocity = new THREE.Vector3(0, 0, 0);
  public heading = 0; // Radians, 0 = +Z
  public speed = 0;
  public targetSpeed = 0;
  public turnRate = 0;
  public verticalVel = 0;
  public airborneHeight = 0;

  public isManualControl = false;
  public needs: WolfNeeds = {
    hunger: 84,
    thirst: 78,
    energy: 92,
    curiosity: 75
  };

  public thoughtIcon = '🐺';
  public thoughtText = 'Surveying pack territory';
  public lookTarget: THREE.Vector3 | null = null;
  public aiTargetPos: THREE.Vector3 | null = null;

  public actionLockTimer = 0;
  private onActionSound?: (action: 'howl' | 'pounce' | 'bark' | 'drink' | 'eat') => void;

  constructor(
    scene: THREE.Scene,
    coatVariant: 'alpha' | 'silver' | 'tundra' | 'russet' = 'alpha',
    onActionSound?: (action: 'howl' | 'pounce' | 'bark' | 'drink' | 'eat') => void
  ) {
    this.onActionSound = onActionSound;
    this.rig = WolfMeshBuilder.build(coatVariant);
    this.animator = new WolfAnimator(this.rig.bones);

    scene.add(this.rig.rootGroup);

    this.skeletonHelper = new THREE.SkeletonHelper(this.rig.rootGroup);
    this.skeletonHelper.visible = false;
    scene.add(this.skeletonHelper);
  }

  reset(x = 0, z = 8, sampleTerrain: TerrainHeightSampler): void {
    const y = sampleTerrain(x, z);
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.heading = 0;
    this.speed = 0;
    this.targetSpeed = 0;
    this.turnRate = 0;
    this.verticalVel = 0;
    this.airborneHeight = 0;
    this.actionLockTimer = 0;

    this.needs.hunger = 84;
    this.needs.thirst = 78;
    this.needs.energy = 92;
    this.needs.curiosity = 75;

    this.animator.setState('idle');
    this.thoughtIcon = '🐺';
    this.thoughtText = 'Surveying pack territory';
    this.syncTransform();
  }

  triggerSpecialAction(action: 'howl' | 'pounce' | 'shake' | 'rest' | 'jump'): void {
    if (action === 'jump') {
      if (this.airborneHeight <= 0.05) {
        this.verticalVel = 4.6;
        this.airborneHeight = 0.08;
        this.animator.setState('jump', 0.12);
        this.thoughtIcon = '🐾';
        this.thoughtText = 'Leaping over terrain!';
      }
      return;
    }

    if (action === 'pounce') {
      if (this.airborneHeight <= 0.05) {
        this.verticalVel = 4.2;
        this.airborneHeight = 0.08;
        this.speed = Math.max(this.speed, 6.8);
        this.actionLockTimer = 0.75;
        this.animator.setState('pounce', 0.1);
        this.thoughtIcon = '⚡';
        this.thoughtText = 'Pouncing on target!';
        this.onActionSound?.('pounce');
      }
      return;
    }

    if (action === 'howl') {
      this.speed = 0;
      this.targetSpeed = 0;
      this.actionLockTimer = 3.2;
      this.animator.setState('howl', 0.25);
      this.needs.curiosity = Math.min(100, this.needs.curiosity + 18);
      this.thoughtIcon = '🌕';
      this.thoughtText = 'Calling to the pack (Howling)...';
      this.onActionSound?.('howl');
      return;
    }

    if (action === 'shake') {
      this.speed = 0;
      this.targetSpeed = 0;
      this.actionLockTimer = 1.4;
      this.animator.setState('shake', 0.15);
      this.thoughtIcon = '💨';
      this.thoughtText = 'Shaking off moisture & dust';
      return;
    }

    if (action === 'rest') {
      this.speed = 0;
      this.targetSpeed = 0;
      this.actionLockTimer = 4.0;
      this.animator.setState(this.needs.energy < 40 ? 'sleep' : 'rest', 0.35);
      this.thoughtIcon = '💤';
      this.thoughtText = 'Resting to recover stamina';
    }
  }

  update(
    dt: number,
    input: InputManager,
    sampleTerrain: TerrainHeightSampler,
    waterLevel: number,
    obstacles: ObstacleCollider[],
    onFootstep?: (ev: FootstepEvent) => void
  ): void {
    // 1. Biological Needs Metabolism
    const exertion = 1.0 + (this.speed / 6.0) * 1.4;
    this.needs.hunger = clamp(this.needs.hunger - dt * 0.42 * exertion, 5, 100);
    this.needs.thirst = clamp(this.needs.thirst - dt * 0.55 * exertion, 5, 100);

    if (this.animator.state === 'rest' || this.animator.state === 'sleep') {
      this.needs.energy = clamp(this.needs.energy + dt * 6.5, 0, 100);
    } else if (this.speed > 4.2) {
      this.needs.energy = clamp(this.needs.energy - dt * 1.8, 8, 100);
    } else {
      this.needs.energy = clamp(this.needs.energy + dt * 0.4, 8, 100);
    }
    this.needs.curiosity = clamp(this.needs.curiosity - dt * 0.35, 10, 100);

    if (this.actionLockTimer > 0) {
      this.actionLockTimer = Math.max(0, this.actionLockTimer - dt);
    }

    // 2. Manual Control Input Processing
    if (this.isManualControl) {
      this.handleManualInput(dt, input, waterLevel, sampleTerrain);
    }

    // 3. Kinematics, Obstacle Avoidance & Terrain Clamping
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);

    this.velocity.x = sinH * this.speed;
    this.velocity.z = cosH * this.speed;

    let nextX = this.position.x + this.velocity.x * dt;
    let nextZ = this.position.z + this.velocity.z * dt;

    // Soft collision resolution against trees & boulders
    const wolfRadius = 0.55;
    for (let i = 0; i < obstacles.length; i++) {
      const obs = obstacles[i];
      const dx = nextX - obs.x;
      const dz = nextZ - obs.z;
      const minDist = obs.radius + wolfRadius;
      const distSq = dx * dx + dz * dz;
      if (distSq < minDist * minDist && distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        const push = (minDist - dist) / dist;
        nextX += dx * push;
        nextZ += dz * push;
      }
    }

    // Keep within world bounds (-105..105)
    nextX = clamp(nextX, -105, 105);
    nextZ = clamp(nextZ, -105, 105);

    this.position.x = nextX;
    this.position.z = nextZ;

    // Vertical jump physics & terrain height attachment
    const groundY = sampleTerrain(this.position.x, this.position.z);
    const inDeepWater = groundY < waterLevel - 0.32;

    if (this.airborneHeight > 0 || this.verticalVel > 0) {
      this.verticalVel -= 14.5 * dt;
      this.airborneHeight += this.verticalVel * dt;
      if (this.airborneHeight <= 0) {
        this.airborneHeight = 0;
        this.verticalVel = 0;
      }
    }

    if (inDeepWater && this.airborneHeight <= 0.02) {
      this.position.y = waterLevel - 0.34 + this.airborneHeight;
      if (this.actionLockTimer <= 0) {
        this.animator.setState('swim', 0.2);
      }
    } else {
      this.position.y = groundY + this.airborneHeight;
    }

    // 4. Update Animator & Skeleton IK
    this.animator.update(
      dt,
      this.position,
      this.heading,
      this.speed,
      this.turnRate,
      this.verticalVel,
      this.airborneHeight,
      waterLevel,
      sampleTerrain,
      this.lookTarget,
      onFootstep
    );

    this.syncTransform();
  }

  private handleManualInput(
    dt: number,
    input: InputManager,
    waterLevel: number,
    sampleTerrain: TerrainHeightSampler
  ): void {
    if (input.consumeJustPressed('KeyH') || input.consumeJustPressed('Digit1')) {
      this.triggerSpecialAction('howl');
      return;
    }
    if (input.consumeJustPressed('KeyP') || input.consumeJustPressed('Digit2')) {
      this.triggerSpecialAction('pounce');
      return;
    }
    if (input.consumeJustPressed('KeyK') || input.consumeJustPressed('Digit3')) {
      this.triggerSpecialAction('shake');
      return;
    }
    if (input.consumeJustPressed('KeyR') || input.consumeJustPressed('Digit4')) {
      this.triggerSpecialAction('rest');
      return;
    }
    if (input.consumeJustPressed('Space')) {
      this.triggerSpecialAction('jump');
    }

    const fwd = input.getForwardAxis();
    const turn = input.getTurnAxis();
    const sprint = input.isSprintDown();

    if (fwd !== 0 || turn !== 0) {
      this.actionLockTimer = 0; // Movement interrupts passive actions
    }

    if (this.actionLockTimer > 0) {
      this.speed = clamp(this.speed - dt * 12, 0, 10);
      return;
    }

    if (input.isDown('KeyE')) {
      const h = sampleTerrain(this.position.x, this.position.z);
      if (h < waterLevel + 0.45) {
        this.animator.setState('drink');
        this.needs.thirst = Math.min(100, this.needs.thirst + dt * 22);
        this.thoughtIcon = '💧';
        this.thoughtText = 'Drinking cool river water';
      } else {
        this.animator.setState('eat');
        this.needs.hunger = Math.min(100, this.needs.hunger + dt * 18);
        this.thoughtIcon = '🥩';
        this.thoughtText = 'Feeding on forage';
      }
      this.speed = 0;
      return;
    }

    const desiredTurnRate = turn * (this.speed > 4.0 ? 2.4 : 3.1);
    this.turnRate = desiredTurnRate;
    this.heading = wrapAngle(this.heading + this.turnRate * dt);

    const maxSpeed = sprint ? 8.8 : 3.5;
    if (fwd > 0) {
      this.targetSpeed = maxSpeed;
    } else if (fwd < 0) {
      this.targetSpeed = 2.0;
    } else {
      this.targetSpeed = 0;
    }

    const accel = this.targetSpeed > this.speed ? 9.5 : 12.0;
    this.speed += clamp(this.targetSpeed - this.speed, -accel * dt, accel * dt);

    if (this.airborneHeight > 0.05) {
      return;
    }

    const groundY = sampleTerrain(this.position.x, this.position.z);
    if (groundY < waterLevel - 0.32) {
      this.animator.setState('swim');
      this.thoughtIcon = '🌊';
      this.thoughtText = 'Swimming across alpine river';
    } else if (this.speed > 4.5) {
      this.animator.setState('run');
      this.thoughtIcon = '🐾';
      this.thoughtText = 'Galloping across territory (Manual)';
    } else if (this.speed > 0.25) {
      this.animator.setState('walk');
      this.thoughtIcon = '🐕';
      this.thoughtText = 'Trotting along trail (Manual)';
    } else if (Math.abs(turn) > 0.1) {
      this.animator.setState('turn');
      this.thoughtIcon = '🧭';
      this.thoughtText = 'Turning in place';
    } else {
      this.animator.setState('idle');
      this.thoughtIcon = '🐺';
      this.thoughtText = 'Awaiting manual command (WASD)';
    }
  }

  syncTransform(): void {
    this.rig.rootGroup.position.copy(this.position);
    this.rig.rootGroup.rotation.set(0, this.heading, 0);
    this.rig.rootGroup.updateMatrixWorld(true);
    if (this.skeletonHelper.visible) {
      this.skeletonHelper.updateMatrixWorld(true);
    }
  }

  getHeadWorldPosition(out = new THREE.Vector3()): THREE.Vector3 {
    this.rig.bones.head.getWorldPosition(out);
    return out;
  }
}
