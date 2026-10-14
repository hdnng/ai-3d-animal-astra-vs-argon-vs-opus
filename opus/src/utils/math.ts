/** Small, allocation-free math helpers used throughout the simulation. */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

export function remap(v: number, a0: number, a1: number, b0: number, b1: number): number {
  return lerp(b0, b1, clamp01(invLerp(a0, a1, v)));
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export function smootherstep(t: number): number {
  t = clamp01(t);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Frame-rate independent exponential smoothing. `lambda` is the decay rate
 * (higher = snappier). Equivalent to lerp(a, b, 1 - exp(-lambda * dt)).
 */
export function damp(a: number, b: number, lambda: number, dt: number): number {
  return lerp(a, b, 1 - Math.exp(-lambda * dt));
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Shortest signed angular difference b - a. */
export function angleDiff(a: number, b: number): number {
  return wrapAngle(b - a);
}

export function dampAngle(a: number, b: number, lambda: number, dt: number): number {
  return a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt));
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

export function fract(x: number): number {
  return x - Math.floor(x);
}

/** Integer hash -> [0,1). Deterministic, used for stable per-instance variation. */
export function hash1(n: number): number {
  let x = Math.imul(n | 0, 0x27d4eb2d) ^ 0x165667b1;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function hash2(x: number, y: number): number {
  return hash1((Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663)) | 0);
}

/** Bell-shaped pulse in [0,1] centered at c with half-width w. */
export function pulse(c: number, w: number, x: number): number {
  const d = Math.abs(x - c);
  if (d > w) return 0;
  const t = 1 - d / w;
  return t * t * (3 - 2 * t);
}

export function sign(x: number): number {
  return x < 0 ? -1 : 1;
}

/** Distance from point p to segment ab, all 2D (xz). */
export function distToSegment2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / len2 : 0;
  t = clamp01(t);
  const dx = px - (ax + abx * t);
  const dz = pz - (az + abz * t);
  return Math.sqrt(dx * dx + dz * dz);
}

/** 2D length without Math.hypot's varargs allocation (hot paths). */
export function hyp(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}
