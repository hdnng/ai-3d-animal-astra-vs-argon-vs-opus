import { Vector3 } from "three";
export const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const damp = (a: number, b: number, k: number, dt: number) =>
  lerp(a, b, 1 - Math.exp(-k * dt));
export const angleDelta = (a: number, b: number) =>
  Math.atan2(Math.sin(b - a), Math.cos(b - a));
export function random(seed = 73921) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(x: number, z: number) {
  const v = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return v - Math.floor(v);
}
export function noise(x: number, z: number) {
  const i = Math.floor(x),
    j = Math.floor(z);
  let u = x - i,
    v = z - j;
  u = u * u * (3 - 2 * u);
  v = v * v * (3 - 2 * v);
  return lerp(
    lerp(hash(i, j), hash(i + 1, j), u),
    lerp(hash(i, j + 1), hash(i + 1, j + 1), u),
    v,
  );
}
export function fbm(x: number, z: number) {
  let sum = 0,
    a = 0.5;
  for (let i = 0; i < 5; i++) {
    sum += a * (noise(x, z) * 2 - 1);
    x *= 2.03;
    z *= 2.03;
    a *= 0.5;
  }
  return sum;
}
export class Spring {
  value = 0;
  velocity = 0;
  update(target: number, dt: number, stiffness = 65, damping = 12) {
    this.velocity +=
      (stiffness * (target - this.value) - damping * this.velocity) * dt;
    this.value += this.velocity * dt;
    return this.value;
  }
}
export const UP = new Vector3(0, 1, 0);
