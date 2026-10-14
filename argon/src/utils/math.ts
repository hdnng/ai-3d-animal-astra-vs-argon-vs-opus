import * as THREE from 'three';

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

export function damp(a: number, b: number, lambda: number, dt: number): number {
  return lerp(a, b, 1 - Math.exp(-lambda * dt));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function wrapAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  const diff = wrapAngle(target - current);
  return wrapAngle(current + diff * (1 - Math.exp(-lambda * dt)));
}

/**
 * Second-order spring-damper for secondary physics (ears, tail, spine lag, camera)
 */
export class SpringDamper1D {
  public position: number;
  public velocity = 0;
  public stiffness: number;
  public damping: number;

  constructor(initial = 0, stiffness = 140, damping = 14) {
    this.position = initial;
    this.stiffness = stiffness;
    this.damping = damping;
  }

  update(target: number, dt: number): number {
    const safeDt = Math.min(dt, 0.05);
    const force = (target - this.position) * this.stiffness - this.velocity * this.damping;
    this.velocity += force * safeDt;
    this.position += this.velocity * safeDt;
    return this.position;
  }

  impulse(velDelta: number): void {
    this.velocity += velDelta;
  }
}

export class SpringDamper3D {
  public position: THREE.Vector3;
  public velocity = new THREE.Vector3();
  public stiffness: number;
  public damping: number;

  constructor(initial = new THREE.Vector3(), stiffness = 120, damping = 14) {
    this.position = initial.clone();
    this.stiffness = stiffness;
    this.damping = damping;
  }

  update(target: THREE.Vector3, dt: number): THREE.Vector3 {
    const safeDt = Math.min(dt, 0.05);
    const fx = (target.x - this.position.x) * this.stiffness - this.velocity.x * this.damping;
    const fy = (target.y - this.position.y) * this.stiffness - this.velocity.y * this.damping;
    const fz = (target.z - this.position.z) * this.stiffness - this.velocity.z * this.damping;

    this.velocity.x += fx * safeDt;
    this.velocity.y += fy * safeDt;
    this.velocity.z += fz * safeDt;

    this.position.x += this.velocity.x * safeDt;
    this.position.y += this.velocity.y * safeDt;
    this.position.z += this.velocity.z * safeDt;
    return this.position;
  }
}

/**
 * Analytic 2-bone Inverse Kinematics solver in the limb sagittal plane (Y-Z local plane).
 * Computes hip/shoulder pitch and knee/elbow bend to place the paw at target offset (dy, dz).
 *
 * @param L1 Upper limb length
 * @param L2 Lower limb length
 * @param dy Vertical offset from root joint to target (negative = downward)
 * @param dz Forward/backward offset from root joint to target (positive = forward)
 * @param kneeForward True if joint bends forward (hind hock/stifle config), false if backward (front elbow)
 */
export function solveTwoBoneIK(
  L1: number,
  L2: number,
  dy: number,
  dz: number,
  kneeForward: boolean
): { upperAngle: number; lowerAngle: number } {
  const maxReach = (L1 + L2) * 0.992;
  const minReach = Math.abs(L1 - L2) * 1.05;
  let dist = Math.sqrt(dy * dy + dz * dz);
  dist = clamp(dist, minReach, maxReach);

  // Law of cosines for interior angles
  const cosKnee = clamp((L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2), -1, 1);
  const interiorKnee = Math.acos(cosKnee);

  const cosHipOffset = clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1);
  const hipOffset = Math.acos(cosHipOffset);

  // Angle from downward (-Y) axis toward +Z (forward)
  const baseAngle = Math.atan2(dz, -dy);

  const bendSign = kneeForward ? 1 : -1;
  const upperAngle = baseAngle + bendSign * hipOffset;
  const lowerAngle = -bendSign * (Math.PI - interiorKnee);

  return { upperAngle, lowerAngle };
}
