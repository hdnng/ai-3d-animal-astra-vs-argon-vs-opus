/**
 * Grey wolf (Canis lupus): rig proportions, SDF body sculpt and coat pattern.
 * Dimensions are in meters and roughly match an adult wolf (~0.8 m at the
 * withers, ~1.75 m nose to tail tip).
 */
import * as THREE from 'three';
import type { RigJoints, V3 } from '../Rig';
import { Rig } from '../Rig';
import { SDFField, type VertexInfo } from '../SDFMesher';
import { TAG, type PaintOut, type SpeciesSpec } from './types';
import type { SimplexNoise } from '../../utils/noise';
import { clamp01, smoothstep } from '../../utils/math';

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const v3 = (a: V3, mirror = false): THREE.Vector3 => new THREE.Vector3(mirror ? -a[0] : a[0], a[1], a[2]);

function tailJoints(start: V3, seg: number, anglesDeg: number[]): V3[] {
  const out: V3[] = [start];
  const x = start[0];
  let y = start[1];
  let z = start[2];
  for (const a of anglesDeg) {
    const r = (a * Math.PI) / 180;
    y -= Math.sin(r) * seg;
    z -= Math.cos(r) * seg;
    out.push([x, y, z]);
  }
  return out;
}

/** Head proportions: the sculpt below is authored at 1.0 and scaled about the head pivot. */
const HEAD_PIVOT: V3 = [0, 0.955, 0.575];
const HEAD_SCALE = 1.1;
const hs = (p: V3): V3 => [
  HEAD_PIVOT[0] + (p[0] - HEAD_PIVOT[0]) * HEAD_SCALE,
  HEAD_PIVOT[1] + (p[1] - HEAD_PIVOT[1]) * HEAD_SCALE,
  HEAD_PIVOT[2] + (p[2] - HEAD_PIVOT[2]) * HEAD_SCALE,
];

export const WOLF_JOINTS: RigJoints = {
  body: [0, 0.68, -0.05],
  pelvis: [0, 0.7, -0.36],
  spine: [0, 0.7, 0.02],
  chest: [0, 0.71, 0.24],
  ribs: [0, 0.62, 0.06],
  neck0: [0, 0.76, 0.4],
  neck1: [0, 0.86, 0.5],
  head: [0, 0.955, 0.575],
  noseTip: hs([0, 0.918, 0.86]),
  jaw: hs([0, 0.905, 0.615]),
  jawTip: hs([0, 0.88, 0.82]),
  ear: hs([0.048, 1.02, 0.595]),
  earTip: hs([0.07, 1.135, 0.578]),
  tail: tailJoints([0, 0.715, -0.49], 0.075, [25, 40, 55, 65, 70, 72]),
  hip: [0.095, 0.68, -0.42],
  knee: [0.1, 0.46, -0.3],
  hock: [0.1, 0.2, -0.44],
  hpaw: [0.1, 0.035, -0.4],
  htoe: [0.1, 0.0, -0.335],
  scap: [0.07, 0.75, 0.29],
  shoulder: [0.105, 0.55, 0.4],
  elbow: [0.1, 0.38, 0.31],
  wrist: [0.1, 0.11, 0.35],
  fpaw: [0.1, 0.03, 0.38],
  ftoe: [0.1, 0.0, 0.44],
  eye: hs([0.042, 0.983, 0.673]),
  eyeRadius: 0.0165,
};

function buildWolfField(rig: Rig): SDFField {
  const j = rig.j;
  const f = new SDFField();
  f.margin = 0.1;
  const back = V(0, -0.15, -1);
  // ---- torso ----
  f.ellipsoid(V(0, 0.625, 0.235), V(0.122, 0.178, 0.2), { bone: 'chest', tag: TAG.TORSO, k: 0.07, comb: back });
  f.ellipsoid(V(0, 0.645, 0.05), V(0.128, 0.162, 0.2), { bone: 'ribs', tag: TAG.TORSO, k: 0.08, comb: back });
  f.ellipsoid(V(0, 0.672, -0.17), V(0.108, 0.122, 0.17), { bone: 'spine', tag: TAG.BELLY, k: 0.08, comb: back });
  f.ellipsoid(V(0, 0.683, -0.37), V(0.118, 0.128, 0.15), { bone: 'pelvis', tag: TAG.TORSO, k: 0.07, comb: back });
  f.ellipsoid(V(0, 0.722, -0.29), V(0.095, 0.07, 0.14), { bone: 'pelvis', tag: TAG.TORSO, k: 0.06, comb: back });
  f.ellipsoid(V(0, 0.738, 0.3), V(0.1, 0.082, 0.13), { bone: 'chest', tag: TAG.TORSO, k: 0.06, comb: back });
  f.ellipsoid(V(0, 0.53, 0.335), V(0.088, 0.115, 0.088), { bone: 'chest', tag: TAG.TORSO, k: 0.07, comb: V(0, -1, -0.3) });
  // ---- neck & mane ----
  f.cone(V(0, 0.7, 0.36), V(0, 0.9, 0.535), 0.118, 0.082, { bone: 'neck0', bone2: 'neck1', tag: TAG.NECK, k: 0.07, comb: V(0, -0.4, -1) });
  f.ellipsoid(V(0, 0.795, 0.43), V(0.125, 0.145, 0.12), { bone: 'neck0', tag: TAG.MANE, k: 0.06, comb: V(0, -0.5, -1) });
  f.ellipsoid(V(0, 0.735, 0.47), V(0.085, 0.1, 0.085), { bone: 'neck0', tag: TAG.MANE, k: 0.06, comb: V(0, -1, 0) });
  // ---- head ----
  f.ellipsoid(V(0, 0.975, 0.598), V(0.074, 0.068, 0.094), { bone: 'head', tag: TAG.HEAD, k: 0.045, comb: V(0, 0, -1) });
  for (const s of [1, -1]) {
    f.ellipsoid(V(0.05 * s, 0.94, 0.628), V(0.054, 0.05, 0.068), { bone: 'head', tag: TAG.HEAD, k: 0.035, comb: V(0.3 * s, -0.4, -1) });
  }
  f.ellipsoid(V(0, 0.985, 0.655), V(0.048, 0.034, 0.05), { bone: 'head', tag: TAG.HEAD, k: 0.03, comb: V(0, 0.2, -1) });
  f.cone(V(0, 0.945, 0.665), V(0, 0.916, 0.83), 0.046, 0.025, { bone: 'head', tag: TAG.SNOUT, k: 0.035, comb: V(0, 0.3, -1) });
  f.ellipsoid(V(0, 0.92, 0.845), V(0.021, 0.017, 0.016), { bone: 'head', tag: TAG.NOSE, k: 0.012, comb: V(0, 0, -1) });
  // lower jaw: sharp weights so the mouth can open cleanly
  f.cone(V(0, 0.892, 0.632), V(0, 0.882, 0.81), 0.034, 0.016, { bone: 'jaw', tag: TAG.JAW, k: 0.018, comb: V(0, 0, -1), weightFalloff: 0.008 });
  f.ellipsoid(V(0, 0.884, 0.715), V(0.03, 0.02, 0.06), { bone: 'jaw', tag: TAG.JAW, k: 0.015, comb: V(0, -0.3, -1), weightFalloff: 0.008 });
  // eye sockets
  for (const s of [1, -1]) {
    f.sphere(v3(j.eye, s < 0).add(V(0, 0, 0.004)), j.eyeRadius * 1.15, { bone: 'head', tag: TAG.HEAD, k: 0.012, subtract: true });
  }
  // ears (flattened cones facing forward)
  for (const s of [1, -1]) {
    const base = v3(j.ear, s < 0);
    const tip = v3(j.earTip, s < 0);
    f.cone(base, tip, 0.034, 0.005, {
      bone: s > 0 ? 'earL' : 'earR',
      tag: TAG.EAR,
      k: 0.025,
      comb: V(0, 1, 0),
      flatAxis: V(0.25 * s, 0.05, 1),
      flatFactor: 3.2,
      weightFalloff: 0.012,
    });
  }
  // Scale every head/jaw/ear primitive about the head pivot.
  const piv = new THREE.Vector3(...HEAD_PIVOT);
  for (const pr of f.prims) {
    // (ears are built from the already-scaled ear joints)
    if (!['head', 'jaw'].includes(pr.bone) || pr.subtract) continue;
    pr.a.sub(piv).multiplyScalar(HEAD_SCALE).add(piv);
    pr.b.sub(piv).multiplyScalar(HEAD_SCALE).add(piv);
    pr.r1 *= HEAD_SCALE;
    pr.r2 *= HEAD_SCALE;
    pr.radii.multiplyScalar(HEAD_SCALE);
    pr.min.sub(piv).multiplyScalar(HEAD_SCALE).add(piv).subScalar(0.01);
    pr.max.sub(piv).multiplyScalar(HEAD_SCALE).add(piv).addScalar(0.01);
    f.boundsMin.min(pr.min);
    f.boundsMax.max(pr.max);
  }
  // ---- tail (bushy) ----
  const tr = [0.045, 0.052, 0.056, 0.054, 0.047, 0.034, 0.014];
  for (let i = 0; i < j.tail.length - 1; i++) {
    const a = v3(j.tail[i]);
    const b = v3(j.tail[i + 1]);
    const isLast = i === j.tail.length - 2;
    f.cone(a, b, tr[i], tr[i + 1], {
      bone: `tail${i}`,
      bone2: isLast ? null : `tail${i + 1}`,
      tag: TAG.TAIL,
      k: 0.04,
      comb: b.clone().sub(a),
    });
  }
  // ---- legs ----
  for (const s of [1, -1]) {
    const m = s < 0;
    const side = m ? 'R' : 'L';
    const P = (a: V3): THREE.Vector3 => v3(a, m);
    // hind
    const hipP = P(j.hip), kneeP = P(j.knee), hockP = P(j.hock), hpawP = P(j.hpaw);
    f.ellipsoid(V(0.087 * s, 0.585, -0.36), V(0.064, 0.13, 0.1), { bone: `thigh${side}`, tag: TAG.ULEG, k: 0.06, comb: V(0, -1, -0.3), rot: new THREE.Euler(0.3, 0, 0) });
    f.cone(hipP, kneeP, 0.08, 0.048, { bone: `thigh${side}`, tag: TAG.ULEG, k: 0.05, comb: V(0, -1, 0) });
    f.cone(kneeP, hockP, 0.046, 0.026, { bone: `shin${side}`, tag: TAG.LLEG, k: 0.035, comb: V(0, -1, 0) });
    f.ellipsoid(V(0.1 * s, 0.37, -0.355), V(0.032, 0.075, 0.042), { bone: `shin${side}`, tag: TAG.LLEG, k: 0.03, comb: V(0, -1, 0), rot: new THREE.Euler(-0.5, 0, 0) });
    f.sphere(hockP.clone().add(V(0, 0, -0.008)), 0.026, { bone: `metaH${side}`, tag: TAG.LLEG, k: 0.02, comb: V(0, -1, 0) });
    f.cone(hockP, hpawP, 0.024, 0.021, { bone: `metaH${side}`, tag: TAG.LLEG, k: 0.02, comb: V(0, -1, 0) });
    f.ellipsoid(V(0.1 * s, 0.03, -0.368), V(0.033, 0.029, 0.05), { bone: `toeH${side}`, tag: TAG.PAW, k: 0.02, comb: V(0, 0, 1) });
    // front
    const shP = P(j.shoulder), elP = P(j.elbow), wrP = P(j.wrist), fpP = P(j.fpaw);
    f.ellipsoid(V(0.088 * s, 0.645, 0.35), V(0.048, 0.12, 0.075), { bone: `scap${side}`, tag: TAG.TORSO, k: 0.05, comb: back, rot: new THREE.Euler(0.45, 0, 0) });
    f.cone(shP, elP, 0.066, 0.046, { bone: `arm${side}`, tag: TAG.ULEG, k: 0.05, comb: V(0, -1, 0) });
    f.ellipsoid(V(0.098 * s, 0.455, 0.325), V(0.045, 0.085, 0.055), { bone: `arm${side}`, tag: TAG.ULEG, k: 0.04, comb: V(0, -1, 0), rot: new THREE.Euler(0.5, 0, 0) });
    f.cone(elP, wrP, 0.042, 0.025, { bone: `fore${side}`, tag: TAG.LLEG, k: 0.03, comb: V(0, -1, 0) });
    f.cone(wrP, fpP, 0.025, 0.022, { bone: `metaF${side}`, tag: TAG.LLEG, k: 0.02, comb: V(0, -1, 0) });
    f.ellipsoid(V(0.1 * s, 0.028, 0.405), V(0.035, 0.029, 0.052), { bone: `toeF${side}`, tag: TAG.PAW, k: 0.02, comb: V(0, 0, 1) });
  }
  return f;
}

const C = (hex: number): THREE.Color => new THREE.Color(hex);
const COAT = {
  base: C(0x8a8174),
  saddle: C(0x3d3833),
  cream: C(0xd8cfbf),
  tan: C(0xa7906f),
  legTan: C(0xb79e7c),
  dark: C(0x1d1a18),
  nose: C(0x0d0c0c),
  pad: C(0x1a1614),
  earIn: C(0xcfc0ae),
  mouth: C(0x1a0d0c),
};
const _c = new THREE.Color();

const _hp = new THREE.Vector3();

function paintWolf(v: VertexInfo, noise: SimplexNoise, out: PaintOut): void {
  const { normal: n, tags: t } = v;
  let p = v.pos;
  const headish = t[TAG.HEAD] + t[TAG.SNOUT] + t[TAG.JAW] + t[TAG.NOSE] + t[TAG.EAR];
  if (headish > 0.5) {
    // markings were authored for the unscaled head
    _hp.set(HEAD_PIVOT[0], HEAD_PIVOT[1], HEAD_PIVOT[2]);
    p = _hp.clone().add(v.pos.clone().sub(_hp).divideScalar(HEAD_SCALE));
  }
  const col = out.color.copy(COAT.base);
  const mot = noise.fbm3(p.x * 9, p.y * 9, p.z * 9, 3);
  const fine = noise.noise3(p.x * 40, p.y * 40, p.z * 40);
  let fur = 0.032;

  const torso = t[TAG.TORSO] + t[TAG.BELLY] + t[TAG.MANE] + t[TAG.NECK];
  // Dorsal saddle: dark band along the back, broken up by noise.
  const up = n.y;
  const saddle = smoothstep(0.25, 0.75, up + mot * 0.35) * clamp01(torso + t[TAG.TAIL] * 0.8) * smoothstep(-0.55, -0.2, p.z) * (1 - smoothstep(0.42, 0.55, p.z));
  col.lerp(COAT.saddle, saddle * 0.75);
  // Cream underside, chest and throat.
  const under = smoothstep(-0.05, -0.55, up + mot * 0.25);
  const throat = (t[TAG.MANE] + t[TAG.NECK]) * smoothstep(0.1, 0.6, n.z) * smoothstep(0.85, 0.7, p.y);
  const chestFront = t[TAG.TORSO] * smoothstep(0.3, 0.8, n.z) * smoothstep(0.62, 0.48, p.y);
  col.lerp(COAT.cream, clamp01(under * (torso + t[TAG.TAIL] + t[TAG.ULEG]) + throat + chestFront));
  // Tawny flanks/shoulders.
  col.lerp(COAT.tan, torso * smoothstep(0.55, 0.9, Math.abs(n.x)) * smoothstep(0.3, 0.6, p.y) * 0.25);

  // Legs: buff outer, cream inner, darker front stripe on forelegs.
  const legs = t[TAG.ULEG] + t[TAG.LLEG];
  if (legs > 0.01) {
    _c.copy(COAT.legTan).lerp(COAT.cream, smoothstep(0.1, -0.6, n.x * Math.sign(p.x)) * 0.8);
    if (p.z > 0) _c.lerp(COAT.tan.clone().multiplyScalar(0.7), smoothstep(0.5, 0.9, n.z) * t[TAG.LLEG] * 0.6);
    col.lerp(_c, clamp01(legs) * smoothstep(0.62, 0.45, p.y));
  }
  // Paws: lighter fur, dark pads underneath.
  if (t[TAG.PAW] > 0.01) {
    _c.copy(COAT.cream).multiplyScalar(0.85).lerp(COAT.pad, smoothstep(-0.3, -0.8, n.y));
    col.lerp(_c, t[TAG.PAW]);
  }
  // Head: grey crown, pale cheeks/face mask, tan muzzle top, cream lips/chin.
  const head = t[TAG.HEAD];
  if (head > 0.01) {
    _c.copy(COAT.base).multiplyScalar(0.92);
    const cheek = smoothstep(0.6, 0.9, Math.abs(n.x)) * smoothstep(0.98, 0.9, p.y);
    _c.lerp(COAT.cream, cheek * 0.85);
    // pale mask around the eyes
    const eyeD = Math.hypot(Math.abs(p.x) - 0.041, p.y - 0.982, p.z - 0.672);
    _c.lerp(COAT.cream, smoothstep(0.035, 0.018, eyeD) * 0.55);
    // pale "eyebrow" marks
    const brow = smoothstep(0.012, 0.0, Math.abs(p.y - 1.0)) * smoothstep(0.02, 0.05, Math.abs(p.x)) * smoothstep(0.62, 0.66, p.z);
    _c.lerp(COAT.cream, brow * 0.7);
    // dark line from eye toward the ear
    const eyeLine = smoothstep(0.012, 0.0, Math.abs(p.y - 0.985 + (p.z - 0.67) * 0.4)) * smoothstep(0.62, 0.66, p.z) * smoothstep(0.69, 0.66, p.z);
    _c.lerp(COAT.dark, eyeLine * 0.6);
    col.lerp(_c, head);
    fur = 0.012;
  }
  if (t[TAG.SNOUT] > 0.01) {
    _c.copy(COAT.tan).lerp(COAT.cream, smoothstep(0.2, -0.4, n.y + 0.2 * (1 - Math.abs(n.x))));
    col.lerp(_c, t[TAG.SNOUT]);
  }
  if (t[TAG.JAW] > 0.01) col.lerp(COAT.cream, t[TAG.JAW]);
  // Mouth seam / lips: where head and jaw weights meet near the snout.
  const wJaw = v.boneW.get('jaw') ?? 0;
  const lip = smoothstep(0.55, 0.95, 1 - Math.abs(wJaw - 0.5) * 2) * smoothstep(0.64, 0.69, p.z);
  col.lerp(COAT.mouth, clamp01(lip) * 0.85);
  if (t[TAG.NOSE] > 0.01) col.lerp(COAT.nose, smoothstep(0.2, 0.7, t[TAG.NOSE]));
  // Ears: grey-tan backs with dark rims, pale insides.
  if (t[TAG.EAR] > 0.01) {
    const front = smoothstep(0.0, 0.5, n.z);
    _c.copy(COAT.tan).multiplyScalar(0.85).lerp(COAT.earIn, front * 0.85);
    _c.lerp(COAT.dark, smoothstep(1.09, 1.13, p.y) * 0.8);
    col.lerp(_c, t[TAG.EAR]);
  }
  // Tail: dark tip and dark gland spot near the base.
  if (t[TAG.TAIL] > 0.01) {
    const tipT = smoothstep(0.48, 0.4, p.y);
    _c.copy(col).lerp(COAT.dark, tipT * 0.9);
    const gland = smoothstep(0.03, 0.0, Math.hypot(p.z + 0.57, p.y - 0.71)) * smoothstep(0.2, 0.6, up);
    _c.lerp(COAT.dark, gland * 0.8);
    col.lerp(_c, t[TAG.TAIL]);
  }
  // Natural mottling.
  col.multiplyScalar(0.9 + mot * 0.18 + fine * 0.05);

  // Fur length by region.
  fur =
    t[TAG.TORSO] * 0.034 +
    t[TAG.BELLY] * 0.03 +
    t[TAG.MANE] * 0.055 +
    t[TAG.NECK] * 0.048 +
    t[TAG.TAIL] * 0.05 +
    t[TAG.ULEG] * 0.024 +
    t[TAG.LLEG] * 0.011 +
    t[TAG.PAW] * 0.007 +
    t[TAG.HEAD] * 0.012 +
    t[TAG.SNOUT] * 0.005 +
    t[TAG.JAW] * 0.008 +
    t[TAG.EAR] * 0.006 +
    t[TAG.NOSE] * 0.0;
  // Dorsal guard hairs are longer.
  fur *= 1 + saddle * 0.35;
  fur *= 1 - clamp01(lip * 1.5);
  out.furLen = fur;
}

export const WOLF: SpeciesSpec = {
  name: 'wolf',
  joints: WOLF_JOINTS,
  cellSize: 0.0122,
  buildField: buildWolfField,
  paint: paintWolf,
  eyeIris: new THREE.Color(0xd99a26),
  gait: {
    walkSpeed: 1.25,
    trotSpeed: 3.2,
    runSpeed: 9.5,
    maxSpeed: 12.5,
    walkToTrot: 1.75,
    trotToGallop: 4.6,
    stepHeight: 0.085,
    turnRate: 3.2,
  },
  shells: 8,
  furScale: 1,
  shellNoiseScale: 10,
  skinNoiseScale: 5,
  pawHeight: [0.03, 0.035],
};
