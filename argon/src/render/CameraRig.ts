import * as THREE from 'three';
import { WolfEntity } from '../animal/WolfEntity';
import { TerrainHeightSampler } from '../animal/WolfAnimator';
import { InputManager } from '../core/Input';
import { clamp, damp, SpringDamper3D, wrapAngle } from '../utils/math';

export type CameraMode = 'follow' | 'orbit' | 'cinematic';

/**
 * Multi-Mode Camera Controller (Follow-Animal, Free Orbit, Cinematic Auto-Orbit)
 * Uses spring-damper smoothing and terrain clearance clamping so the camera
 * transitions seamlessly between modes and never clips underground.
 */
export class CameraRig {
  public camera: THREE.PerspectiveCamera;
  public mode: CameraMode = 'follow';

  private posSpring: SpringDamper3D;
  private lookSpring: SpringDamper3D;

  public orbitYaw = 0.45;
  public orbitPitch = 0.28;
  public orbitDistance = 4.2;
  private cinematicTimer = 0;

  private desiredPos = new THREE.Vector3();
  private desiredLook = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(52, aspect, 0.25, 260);
    this.camera.position.set(0, 2.5, 4.0);
    this.posSpring = new SpringDamper3D(this.camera.position, 65, 13);
    this.lookSpring = new SpringDamper3D(new THREE.Vector3(0, 0.8, 8), 85, 15);
  }

  cycleMode(): CameraMode {
    if (this.mode === 'follow') {
      this.mode = 'orbit';
    } else if (this.mode === 'orbit') {
      this.mode = 'cinematic';
    } else {
      this.mode = 'follow';
    }
    return this.mode;
  }

  setMode(mode: CameraMode, customYaw?: number, customPitch?: number, customDist?: number): void {
    this.mode = mode;
    if (customYaw !== undefined) this.orbitYaw = customYaw;
    if (customPitch !== undefined) this.orbitPitch = customPitch;
    if (customDist !== undefined) this.orbitDistance = customDist;
  }

  snapToTarget(wolf: WolfEntity, sampleTerrain: TerrainHeightSampler): void {
    this.computeDesiredVectors(0, wolf, sampleTerrain);
    this.posSpring.position.copy(this.desiredPos);
    this.posSpring.velocity.set(0, 0, 0);
    this.lookSpring.position.copy(this.desiredLook);
    this.lookSpring.velocity.set(0, 0, 0);
    this.camera.position.copy(this.desiredPos);
    this.camera.lookAt(this.desiredLook);
  }

  update(
    dt: number,
    wolf: WolfEntity,
    input: InputManager,
    sampleTerrain: TerrainHeightSampler
  ): void {
    // Handle pointer orbit and scroll zoom
    if (input.pointerDown) {
      this.orbitYaw = wrapAngle(this.orbitYaw - input.pointerDeltaX * 0.0055);
      this.orbitPitch = clamp(this.orbitPitch + input.pointerDeltaY * 0.0045, 0.06, 1.25);
    }
    if (input.wheelDelta !== 0) {
      this.orbitDistance = clamp(this.orbitDistance + input.wheelDelta * 0.45, 2.0, 14.0);
    }

    this.cinematicTimer += dt;
    this.computeDesiredVectors(dt, wolf, sampleTerrain);

    const smoothPos = this.posSpring.update(this.desiredPos, dt);
    const smoothLook = this.lookSpring.update(this.desiredLook, dt);

    // Ensure camera never clips below terrain surface
    const groundAtCam = sampleTerrain(smoothPos.x, smoothPos.z);
    if (smoothPos.y < groundAtCam + 0.38) {
      smoothPos.y = groundAtCam + 0.38;
    }

    this.camera.position.copy(smoothPos);
    this.camera.lookAt(smoothLook);
  }

  private computeDesiredVectors(
    dt: number,
    wolf: WolfEntity,
    sampleTerrain: TerrainHeightSampler
  ): void {
    const sinH = Math.sin(wolf.heading);
    const cosH = Math.cos(wolf.heading);

    this.desiredLook.set(
      wolf.position.x + sinH * 0.45,
      wolf.position.y + 0.72,
      wolf.position.z + cosH * 0.45
    );

    if (this.mode === 'follow') {
      // Smoothly align behind wolf when moving if user isn't dragging mouse
      const targetYaw = wrapAngle(wolf.heading + Math.PI + 0.32);
      if (wolf.speed > 0.4 && dt > 0) {
        const diff = wrapAngle(targetYaw - this.orbitYaw);
        this.orbitYaw = wrapAngle(this.orbitYaw + diff * Math.min(1, dt * 2.2));
      }
      const dist = this.orbitDistance;
      const horiz = Math.cos(this.orbitPitch) * dist;
      const vert = Math.sin(this.orbitPitch) * dist;

      this.desiredPos.set(
        wolf.position.x + Math.sin(this.orbitYaw) * horiz,
        wolf.position.y + 0.65 + vert,
        wolf.position.z + Math.cos(this.orbitYaw) * horiz
      );
    } else if (this.mode === 'orbit') {
      const dist = this.orbitDistance;
      const horiz = Math.cos(this.orbitPitch) * dist;
      const vert = Math.sin(this.orbitPitch) * dist;

      this.desiredPos.set(
        wolf.position.x + Math.sin(this.orbitYaw) * horiz,
        wolf.position.y + 0.65 + vert,
        wolf.position.z + Math.cos(this.orbitYaw) * horiz
      );
    } else {
      // Cinematic sweeping low-angle & panoramic orbit
      const cineAngle = wolf.heading + Math.sin(this.cinematicTimer * 0.32) * 2.2 + 0.8;
      const cineDist = 3.2 + Math.cos(this.cinematicTimer * 0.25) * 0.9;
      const cineHeight = 0.85 + Math.sin(this.cinematicTimer * 0.4) * 0.35;

      this.desiredPos.set(
        wolf.position.x + Math.sin(cineAngle) * cineDist,
        wolf.position.y + cineHeight,
        wolf.position.z + Math.cos(cineAngle) * cineDist
      );
    }

    const terrainUnderDesired = sampleTerrain(this.desiredPos.x, this.desiredPos.z);
    if (this.desiredPos.y < terrainUnderDesired + 0.42) {
      this.desiredPos.y = terrainUnderDesired + 0.42;
    }
  }
}
