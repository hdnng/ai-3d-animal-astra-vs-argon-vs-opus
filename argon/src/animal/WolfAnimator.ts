import * as THREE from 'three';
import { WolfBoneMap } from './WolfMeshBuilder';
import { clamp, damp, lerp, solveTwoBoneIK, SpringDamper1D, wrapAngle } from '../utils/math';

export type WolfAnimState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'swim'
  | 'turn'
  | 'rest'
  | 'sleep'
  | 'eat'
  | 'drink'
  | 'jump'
  | 'howl'
  | 'pounce'
  | 'shake';

export interface FootstepEvent {
  footIndex: number; // 0=FL, 1=FR, 2=BL, 3=BR
  worldPos: THREE.Vector3;
  speed: number;
  inWater: boolean;
}

export type TerrainHeightSampler = (x: number, z: number) => number;

/**
 * Procedural Quadruped Animation State Machine + 2-Bone Terrain IK + Secondary Spring Physics
 */
export class WolfAnimator {
  public state: WolfAnimState = 'idle';
  public previousState: WolfAnimState = 'idle';
  public stateTime = 0;
  public transitionAlpha = 1.0;
  private transitionDuration = 0.25;

  public gaitCycle = 0;
  public breathCycle = 0;

  // Blinking state
  private blinkTimer = 3.2;
  private blinkDuration = 0.16;
  private blinkElapsed = 1.0;

  // Secondary physics springs
  private spineBendSpring = new SpringDamper1D(0, 110, 12);
  private tailSwingSpring = new SpringDamper1D(0, 75, 8);
  private tailLiftSpring = new SpringDamper1D(0, 65, 9);
  private earPitchSpringL = new SpringDamper1D(0, 150, 11);
  private earPitchSpringR = new SpringDamper1D(0, 150, 11);
  private headYawSpring = new SpringDamper1D(0, 90, 12);
  private headPitchSpring = new SpringDamper1D(0, 90, 12);

  // Slope adaptation smoothed angles
  public bodyPitch = 0;
  public bodyRoll = 0;
  public baseHeightOffset = 0;

  // Foot tracking for IK & footstep events
  private footStance = [true, true, true, true];
  public footWorldPositions = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3()
  ];

  private tempVec = new THREE.Vector3();

  constructor(private bones: WolfBoneMap) {}

  setState(next: WolfAnimState, transitionTime = 0.24): void {
    if (this.state === next) return;
    this.previousState = this.state;
    this.state = next;
    this.stateTime = 0;
    this.transitionDuration = Math.max(0.05, transitionTime);
    this.transitionAlpha = 0;
  }

  update(
    dt: number,
    worldPos: THREE.Vector3,
    heading: number,
    speed: number,
    turnRate: number,
    verticalVel: number,
    airborneHeight: number,
    waterLevel: number,
    sampleTerrain: TerrainHeightSampler,
    lookTarget: THREE.Vector3 | null,
    onFootstep?: (ev: FootstepEvent) => void
  ): void {
    this.stateTime += dt;
    if (this.transitionAlpha < 1) {
      this.transitionAlpha = Math.min(1, this.transitionAlpha + dt / this.transitionDuration);
    }

    // 1. Advance breathing & gait cycles
    const breathRate = lerp(1.6, 4.2, clamp(speed / 9.0, 0, 1));
    this.breathCycle = (this.breathCycle + dt * breathRate * Math.PI * 2) % (Math.PI * 2);

    const effectiveSpeed = this.state === 'turn' ? Math.max(speed, 1.4) : speed;
    const strideFreq = effectiveSpeed > 0.1 ? lerp(1.3, 3.3, clamp(effectiveSpeed / 9.5, 0, 1)) : 0;
    this.gaitCycle = (this.gaitCycle + dt * strideFreq) % 1.0;

    // 2. Terrain Slope Adaptation (sample front vs back, left vs right around wolf)
    const sinH = Math.sin(heading);
    const cosH = Math.cos(heading);
    const frontX = worldPos.x + sinH * 0.45;
    const frontZ = worldPos.z + cosH * 0.45;
    const backX = worldPos.x - sinH * 0.35;
    const backZ = worldPos.z - cosH * 0.35;
    const leftX = worldPos.x + cosH * 0.16;
    const leftZ = worldPos.z - sinH * 0.16;
    const rightX = worldPos.x - cosH * 0.16;
    const rightZ = worldPos.z + sinH * 0.16;

    const hFront = sampleTerrain(frontX, frontZ);
    const hBack = sampleTerrain(backX, backZ);
    const hLeft = sampleTerrain(leftX, leftZ);
    const hRight = sampleTerrain(rightX, rightZ);

    const targetSlopePitch = clamp(Math.atan2(hFront - hBack, 0.80), -0.48, 0.48);
    const targetSlopeRoll = clamp(Math.atan2(hLeft - hRight, 0.32), -0.35, 0.35);

    const slopeWeight = airborneHeight > 0.08 || this.state === 'swim' ? 0.15 : 1.0;
    this.bodyPitch = damp(this.bodyPitch, -targetSlopePitch * slopeWeight, 10, dt);
    this.bodyRoll = damp(this.bodyRoll, targetSlopeRoll * slopeWeight, 10, dt);

    // 3. Evaluate Posture & State-Specific Body Modifiers
    let crouchOffset = 0;
    let spineArch = 0;
    let neckPitchTarget = 0;
    let headPitchOffset = 0;
    let headRollTarget = 0;
    let jawOpenTarget = 0.0;
    let tailLiftTarget = -0.15;
    let tailWagAmp = 0.12;
    let tailWagFreq = 2.2;
    let earAlert = 0.1;

    const gallopFactor = clamp((effectiveSpeed - 3.6) / 4.5, 0, 1);

    // Speed-dependent spinal flexion during gallop
    const gallopPhaseRad = this.gaitCycle * Math.PI * 2;
    if (effectiveSpeed > 0.2 && (this.state === 'walk' || this.state === 'run' || this.state === 'turn')) {
      crouchOffset = Math.sin(gallopPhaseRad * (gallopFactor > 0.3 ? 1 : 2)) * lerp(0.015, 0.048, gallopFactor);
      spineArch = Math.cos(gallopPhaseRad) * 0.12 * gallopFactor;
      neckPitchTarget = lerp(0.05, 0.22, gallopFactor) + Math.sin(gallopPhaseRad) * 0.08 * gallopFactor;
      tailLiftTarget = lerp(-0.1, 0.25, gallopFactor);
      tailWagAmp = lerp(0.16, 0.08, gallopFactor);
      tailWagFreq = lerp(3.0, 6.0, gallopFactor);
      jawOpenTarget = effectiveSpeed > 5.0 ? 0.14 + 0.05 * Math.sin(this.breathCycle) : 0.0;
      earAlert = lerp(0.15, -0.35, gallopFactor); // Ears fold back slightly at full sprint
    }

    switch (this.state) {
      case 'rest':
        crouchOffset = -0.26;
        spineArch = 0.06;
        neckPitchTarget = -0.12;
        headPitchOffset = 0.08;
        tailLiftTarget = -0.45;
        tailWagAmp = 0.04;
        earAlert = 0.0;
        break;

      case 'sleep':
        crouchOffset = -0.35;
        spineArch = 0.14;
        neckPitchTarget = 0.38;
        headPitchOffset = 0.22;
        headRollTarget = 0.35;
        tailLiftTarget = -0.55;
        tailWagAmp = 0.01;
        earAlert = -0.4;
        jawOpenTarget = 0.02;
        break;

      case 'eat':
      case 'drink': {
        crouchOffset = -0.14;
        neckPitchTarget = 0.62;
        headPitchOffset = 0.28 + Math.sin(this.stateTime * 7.5) * 0.07;
        jawOpenTarget = 0.18 + Math.abs(Math.sin(this.stateTime * 7.5)) * 0.24;
        tailLiftTarget = 0.05;
        tailWagAmp = 0.22;
        tailWagFreq = 4.5;
        earAlert = 0.2;
        break;
      }

      case 'howl': {
        // Iconic timber wolf howl: head tilted skyward, chest expanded, jaw open wide
        const howlRamp = Math.sin(clamp(this.stateTime / 3.2, 0, 1) * Math.PI);
        crouchOffset = -0.04 * howlRamp;
        spineArch = -0.12 * howlRamp;
        neckPitchTarget = -0.52 * howlRamp;
        headPitchOffset = -0.58 * howlRamp + Math.sin(this.stateTime * 5.0) * 0.03;
        jawOpenTarget = 0.05 + 0.48 * howlRamp + Math.sin(this.stateTime * 8.0) * 0.04;
        tailLiftTarget = 0.18 * howlRamp;
        tailWagAmp = 0.05;
        earAlert = -0.22 * howlRamp;
        break;
      }

      case 'jump':
      case 'pounce': {
        const isAscending = verticalVel > 0;
        spineArch = isAscending ? -0.22 : 0.20;
        neckPitchTarget = isAscending ? -0.20 : 0.25;
        headPitchOffset = isAscending ? 0.10 : -0.15;
        tailLiftTarget = 0.32;
        jawOpenTarget = this.state === 'pounce' ? 0.35 : 0.12;
        earAlert = 0.30;
        break;
      }

      case 'shake': {
        // Vigorous wet-dog rotary body shake propagating from head to tail
        const shakeWave = Math.sin(this.stateTime * 34.0);
        const env = Math.sin(clamp(this.stateTime / 1.4, 0, 1) * Math.PI);
        headRollTarget = shakeWave * 0.65 * env;
        crouchOffset = -0.04 * env;
        jawOpenTarget = 0.12 * env;
        tailWagAmp = 0.45 * env;
        tailWagFreq = 16.0;
        earAlert = -0.3 * env;
        break;
      }

      case 'swim': {
        crouchOffset = -0.08;
        neckPitchTarget = -0.25; // Keep head elevated above water
        headPitchOffset = -0.18;
        tailLiftTarget = 0.10;
        tailWagAmp = 0.25;
        tailWagFreq = 3.5;
        break;
      }
    }

    this.baseHeightOffset = damp(this.baseHeightOffset, crouchOffset, 10, dt);

    // 4. Apply Spine, Pelvis, Breathing & Secondary Turn Lag
    const spineYawLag = this.spineBendSpring.update(clamp(turnRate * 0.18, -0.32, 0.32), dt);
    const breathExpand = Math.sin(this.breathCycle) * 0.018;

    const shakeEnv = this.state === 'shake' ? Math.sin(clamp(this.stateTime / 1.4, 0, 1) * Math.PI) : 0;
    const shakeRollSpine = shakeEnv * Math.sin(this.stateTime * 34.0 - 0.8) * 0.38;

    this.bones.pelvis.position.y = 0.62 + this.baseHeightOffset;
    this.bones.pelvis.rotation.set(
      this.bodyPitch + spineArch * 0.4,
      -spineYawLag * 0.4,
      this.bodyRoll + shakeRollSpine * 0.5
    );

    this.bones.spine1.rotation.set(spineArch * 0.35, spineYawLag * 0.35, shakeRollSpine * 0.4);
    this.bones.spine2.rotation.set(spineArch * 0.35 + breathExpand, spineYawLag * 0.35, shakeRollSpine * 0.4);
    this.bones.spine2.scale.set(1 + breathExpand * 0.8, 1 + breathExpand, 1);
    this.bones.spine3.rotation.set(-spineArch * 0.3 - breathExpand * 0.5, spineYawLag * 0.3, shakeRollSpine * 0.3);

    // 5. Head Look-At Target + Neck/Jaw/Ear/Blink Articulation
    let targetYaw = spineYawLag * 0.5;
    let targetPitch = headPitchOffset;

    if (lookTarget && this.state !== 'sleep' && this.state !== 'howl') {
      const dx = lookTarget.x - (worldPos.x + sinH * 0.8);
      const dy = lookTarget.y - (worldPos.y + 0.88);
      const dz = lookTarget.z - (worldPos.z + cosH * 0.8);
      const horizDist = Math.hypot(dx, dz);
      if (horizDist > 0.2 && horizDist < 28) {
        const worldAngle = Math.atan2(dx, dz);
        const relYaw = wrapAngle(worldAngle - heading);
        if (Math.abs(relYaw) < 1.35) {
          targetYaw = clamp(relYaw * 0.65, -0.75, 0.75);
          targetPitch += clamp(-Math.atan2(dy, horizDist) * 0.5, -0.45, 0.45);
        }
      }
    }

    const smoothYaw = this.headYawSpring.update(targetYaw, dt);
    const smoothPitch = this.headPitchSpring.update(targetPitch, dt);

    this.bones.neck1.rotation.set(
      damp(this.bones.neck1.rotation.x, neckPitchTarget * 0.55, 10, dt),
      smoothYaw * 0.45,
      0
    );
    this.bones.neck2.rotation.set(
      damp(this.bones.neck2.rotation.x, neckPitchTarget * 0.45, 10, dt),
      smoothYaw * 0.35,
      0
    );
    this.bones.head.rotation.set(
      smoothPitch,
      smoothYaw * 0.35,
      damp(this.bones.head.rotation.z, headRollTarget, 12, dt)
    );

    // Jaw articulation
    this.bones.jaw.rotation.x = damp(this.bones.jaw.rotation.x, jawOpenTarget, 16, dt);

    // Ear secondary spring motion
    const earBounce = clamp(-verticalVel * 0.08, -0.25, 0.25);
    const earLTarget = earAlert + earBounce + Math.sin(this.stateTime * 2.3) * 0.04;
    const earRTarget = earAlert + earBounce + Math.cos(this.stateTime * 2.7) * 0.04;
    const earPitchL = this.earPitchSpringL.update(earLTarget, dt);
    const earPitchR = this.earPitchSpringR.update(earRTarget, dt);
    this.bones.earL.rotation.set(earPitchL, 0.1 + smoothYaw * 0.15, -0.12 + headRollTarget * 0.4);
    this.bones.earR.rotation.set(earPitchR, -0.1 + smoothYaw * 0.15, 0.12 + headRollTarget * 0.4);

    // Blinking
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkTimer = 2.8 + Math.random() * 3.8;
      this.blinkElapsed = 0;
    }
    let blinkClosed = 0;
    if (this.state === 'sleep' || this.state === 'howl') {
      blinkClosed = 1.0;
    } else if (this.blinkElapsed < this.blinkDuration) {
      this.blinkElapsed += dt;
      blinkClosed = Math.sin((this.blinkElapsed / this.blinkDuration) * Math.PI);
    }
    const lidRot = lerp(-0.55, 0.42, blinkClosed);
    this.bones.eyelidL.rotation.x = lidRot;
    this.bones.eyelidR.rotation.x = lidRot;

    // 6. Multi-Bone Tail Chain with Spring Propagation
    const wagOsc = Math.sin(this.stateTime * tailWagFreq * Math.PI * 2) * tailWagAmp;
    const tailSwing = this.tailSwingSpring.update(wagOsc - spineYawLag * 1.1, dt);
    const tailLift = this.tailLiftSpring.update(tailLiftTarget + clamp(-verticalVel * 0.06, -0.2, 0.2), dt);

    const tailBones = [
      this.bones.tail1,
      this.bones.tail2,
      this.bones.tail3,
      this.bones.tail4,
      this.bones.tail5
    ];
    for (let i = 0; i < tailBones.length; i++) {
      const phaseLag = i * 0.45;
      const segWag = Math.sin(this.stateTime * tailWagFreq * Math.PI * 2 - phaseLag) * tailWagAmp * 0.45;
      tailBones[i].rotation.set(
        tailLift * 0.28 + Math.cos(this.breathCycle + i * 0.5) * 0.02,
        tailSwing * 0.32 + segWag,
        0
      );
    }

    // 7. 4-Limb Procedural Gait & Terrain Height IK
    this.solveLimbsIK(
      dt,
      worldPos,
      heading,
      effectiveSpeed,
      gallopFactor,
      airborneHeight,
      waterLevel,
      sampleTerrain,
      onFootstep
    );
  }

  private solveLimbsIK(
    dt: number,
    worldPos: THREE.Vector3,
    heading: number,
    speed: number,
    gallopFactor: number,
    airborneHeight: number,
    waterLevel: number,
    sampleTerrain: TerrainHeightSampler,
    onFootstep?: (ev: FootstepEvent) => void
  ): void {
    const sinH = Math.sin(heading);
    const cosH = Math.cos(heading);

    // Phase offsets: Walk/Trot vs Gallop
    // 0: Front Left, 1: Front Right, 2: Back Left, 3: Back Right
    const walkOffsets = [0.0, 0.5, 0.5, 0.0]; // Diagonal trot synchronization
    const gallopOffsets = [0.52, 0.67, 0.0, 0.16]; // Transverse/rotary gallop

    const limbConfigs = [
      {
        index: 0,
        isFront: true,
        localX: 0.135,
        localZ: 0.46,
        hipHeight: 0.61,
        L1: 0.28,
        L2: 0.27,
        upperBone: this.bones.upperArmL,
        lowerBone: this.bones.forearmL,
        pawBone: this.bones.pawL
      },
      {
        index: 1,
        isFront: true,
        localX: -0.135,
        localZ: 0.46,
        hipHeight: 0.61,
        L1: 0.28,
        L2: 0.27,
        upperBone: this.bones.upperArmR,
        lowerBone: this.bones.forearmR,
        pawBone: this.bones.pawR
      },
      {
        index: 2,
        isFront: false,
        localX: 0.13,
        localZ: -0.31,
        hipHeight: 0.59,
        L1: 0.27,
        L2: 0.26,
        upperBone: this.bones.thighL,
        lowerBone: this.bones.shinL,
        pawBone: this.bones.hindPawL
      },
      {
        index: 3,
        isFront: false,
        localX: -0.13,
        localZ: -0.31,
        hipHeight: 0.59,
        L1: 0.27,
        L2: 0.26,
        upperBone: this.bones.thighR,
        lowerBone: this.bones.shinR,
        pawBone: this.bones.hindPawR
      }
    ];

    const moveBlend = clamp(speed / 0.8, 0, 1);
    const strideLength = lerp(0.14, 0.42, clamp(speed / 9.0, 0, 1)) * moveBlend;
    const stepClearance = lerp(0.06, 0.19, clamp(speed / 9.0, 0, 1)) * moveBlend;

    for (const limb of limbConfigs) {
      if (this.state === 'rest' || this.state === 'sleep') {
        // Folded legs posture on ground
        const foldUpper = limb.isFront ? -0.95 : 0.95;
        const foldLower = limb.isFront ? 1.65 : -1.65;
        limb.upperBone.rotation.x = damp(limb.upperBone.rotation.x, foldUpper, 10, dt);
        limb.lowerBone.rotation.x = damp(limb.lowerBone.rotation.x, foldLower, 10, dt);
        limb.pawBone.rotation.x = damp(limb.pawBone.rotation.x, -0.5, 10, dt);
        continue;
      }

      const phaseOffset = lerp(walkOffsets[limb.index], gallopOffsets[limb.index], gallopFactor);
      const phase = (this.gaitCycle + phaseOffset) % 1.0;

      // Swing phase is [0, 0.45), stance phase is [0.45, 1.0)
      let swingZ = 0;
      let swingLift = 0;
      const isSwinging = moveBlend > 0.08 && phase < 0.45;

      if (this.state === 'swim') {
        const swimAngle = (this.stateTime * 2.6 + phaseOffset) * Math.PI * 2;
        swingZ = Math.cos(swimAngle) * 0.18;
        swingLift = Math.sin(swimAngle) * 0.12 + 0.08;
      } else if (airborneHeight > 0.06) {
        // Jumping / Pouncing airborne tuck/extension
        swingZ = limb.isFront ? 0.18 : -0.18;
        swingLift = 0.14;
      } else if (moveBlend > 0.05) {
        if (phase < 0.45) {
          const s = phase / 0.45;
          swingZ = lerp(-strideLength * 0.5, strideLength * 0.5, s);
          swingLift = Math.sin(s * Math.PI) * stepClearance;
        } else {
          const s = (phase - 0.45) / 0.55;
          swingZ = lerp(strideLength * 0.5, -strideLength * 0.5, s);
          swingLift = 0;
        }
      }

      // Compute world-space foot target to sample exact terrain height under this paw
      const localFootZ = limb.localZ + swingZ;
      const footWorldX = worldPos.x + sinH * localFootZ + cosH * limb.localX;
      const footWorldZ = worldPos.z + cosH * localFootZ - sinH * limb.localX;
      const groundAtFoot = sampleTerrain(footWorldX, footWorldZ);

      this.footWorldPositions[limb.index].set(footWorldX, groundAtFoot + swingLift, footWorldZ);

      // Detect footstep strike when transitioning from swing to stance
      const wasStance = this.footStance[limb.index];
      const nowStance = !isSwinging && airborneHeight <= 0.06 && this.state !== 'swim';
      this.footStance[limb.index] = nowStance;

      if (!wasStance && nowStance && speed > 0.4 && onFootstep) {
        this.tempVec.set(footWorldX, Math.max(groundAtFoot, waterLevel), footWorldZ);
        onFootstep({
          footIndex: limb.index,
          worldPos: this.tempVec.clone(),
          speed,
          inWater: groundAtFoot < waterLevel + 0.08
        });
      }

      // Compute vertical distance from hip/shoulder joint to terrain + swingLift
      const hipWorldY = worldPos.y + limb.hipHeight + this.baseHeightOffset;
      const pawTargetWorldY = groundAtFoot + 0.055 + swingLift;
      const dy = clamp(pawTargetWorldY - hipWorldY, -(limb.L1 + limb.L2) * 0.99, -0.18);

      // Solve 2-bone IK in limb plane
      // Front limbs bend elbow backward (kneeForward = false), hind limbs bend hock/stifle nicely
      const { upperAngle, lowerAngle } = solveTwoBoneIK(
        limb.L1,
        limb.L2,
        dy,
        swingZ,
        !limb.isFront
      );

      // Compensate for parent pelvis/spine pitch so foot stays planted on slopes
      const parentPitchComp = -this.bodyPitch * 0.75;
      limb.upperBone.rotation.x = upperAngle + parentPitchComp;
      limb.lowerBone.rotation.x = lowerAngle;

      // Keep paw pad level with ground during stance, flexed during swing
      const pawFlex = isSwinging ? -0.45 : -(upperAngle + lowerAngle + parentPitchComp);
      limb.pawBone.rotation.x = clamp(pawFlex, -0.7, 0.7);
    }
  }
}
