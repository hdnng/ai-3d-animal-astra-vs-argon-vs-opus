/**
 * Deer (prey species): long slender legs, long neck, large ears, short tail
 * with a white rump patch. Bucks get procedural antlers.
 */
import * as THREE from 'three';
import type { RigJoints, V3 } from '../Rig';
import { Rig } from '../Rig';
import { SDFField, type VertexInfo } from '../SDFMesher';
import { TAG, type PaintOut, type SpeciesSpec } from './types';
import type { SimplexNoise } from '../../utils/noise';
import { clamp01, smoothstep } from '../../utils/math';
import { Random } from '../../utils/Random';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const v3 = (a: V3, mirror = false): THREE.Vector3 => new THREE.Vector3(mirror ? -a[0] : a[0], a[1], a[2]);

export const DEER_JOINTS: RigJoints = {
  body: [0, 0.93, -0.04],
  pelvis: [0, 0.96, -0.42],
  spine: [0, 0.95, 0.04],
  chest: [0, 0.97, 0.3],
  ribs: [0, 0.86, 0.12],
  neck0: [0, 1.04, 0.46],
  neck1: [0, 1.22, 0.58],
  head: [0, 1.4, 0.67],
  noseTip: [0, 1.29, 0.96],
  jaw: [0, 1.345, 0.71],
  jawTip: [0, 1.275, 0.93],
  ear: [0.055, 1.46, 0.655],
  earTip: [0.17, 1.55, 0.61],
  tail: [
    [0, 0.98, -0.6],
    [0, 0.94, -0.66],
    [0, 0.89, -0.69],
    [0, 0.83, -0.7],
  ],
  hip: [0.1, 0.92, -0.48],
  knee: [0.11, 0.63, -0.36],
  hock: [0.11, 0.37, -0.57],
  hpaw: [0.11, 0.045, -0.51],
  htoe: [0.11, 0.0, -0.46],
  scap: [0.08, 1.0, 0.33],
  shoulder: [0.11, 0.75, 0.43],
  elbow: [0.11, 0.56, 0.35],
  wrist: [0.11, 0.27, 0.38],
  fpaw: [0.11, 0.045, 0.4],
  ftoe: [0.11, 0.0, 0.45],
  eye: [0.05, 1.415, 0.75],
  eyeRadius: 0.019,
};

function buildDeerField(rig: Rig): SDFField {
  const j = rig.j;
  const f = new SDFField();
  f.margin = 0.1;
  const back = V(0, -0.1, -1);
  // torso: barrel shaped, slimmer than the wolf
  f.ellipsoid(V(0, 0.9, 0.27), V(0.15, 0.2, 0.22), { bone: 'chest', tag: TAG.TORSO, k: 0.08, comb: back });
  f.ellipsoid(V(0, 0.9, 0.04), V(0.165, 0.2, 0.25), { bone: 'ribs', tag: TAG.TORSO, k: 0.09, comb: back });
  f.ellipsoid(V(0, 0.92, -0.22), V(0.14, 0.165, 0.2), { bone: 'spine', tag: TAG.BELLY, k: 0.09, comb: back });
  f.ellipsoid(V(0, 0.93, -0.44), V(0.135, 0.15, 0.17), { bone: 'pelvis', tag: TAG.TORSO, k: 0.08, comb: back });
  f.ellipsoid(V(0, 1.0, 0.33), V(0.1, 0.07, 0.14), { bone: 'chest', tag: TAG.TORSO, k: 0.06, comb: back });
  f.ellipsoid(V(0, 0.8, 0.38), V(0.1, 0.12, 0.09), { bone: 'chest', tag: TAG.TORSO, k: 0.07, comb: V(0, -1, -0.3) });
  // long neck
  f.cone(V(0, 0.96, 0.4), V(0, 1.36, 0.66), 0.12, 0.065, { bone: 'neck0', bone2: 'neck1', tag: TAG.NECK, k: 0.07, comb: V(0, -0.6, -1) });
  f.ellipsoid(V(0, 1.05, 0.5), V(0.085, 0.13, 0.1), { bone: 'neck0', tag: TAG.NECK, k: 0.06, comb: V(0, -1, -0.5) });
  // head: narrow, long muzzle
  f.ellipsoid(V(0, 1.42, 0.69), V(0.066, 0.068, 0.09), { bone: 'head', tag: TAG.HEAD, k: 0.045, comb: V(0, 0, -1) });
  f.cone(V(0, 1.39, 0.74), V(0, 1.305, 0.93), 0.055, 0.03, { bone: 'head', tag: TAG.SNOUT, k: 0.04, comb: V(0, 0.4, -1) });
  f.ellipsoid(V(0, 1.302, 0.945), V(0.028, 0.022, 0.02), { bone: 'head', tag: TAG.NOSE, k: 0.014, comb: V(0, 0, -1) });
  f.cone(V(0, 1.34, 0.72), V(0, 1.275, 0.915), 0.03, 0.017, { bone: 'jaw', tag: TAG.JAW, k: 0.018, comb: V(0, 0, -1), weightFalloff: 0.008 });
  for (const s of [1, -1]) {
    f.sphere(v3(j.eye, s < 0).add(V(0, 0, 0.004)), j.eyeRadius * 1.12, { bone: 'head', tag: TAG.HEAD, k: 0.012, subtract: true });
    // large leaf-shaped ears
    f.cone(v3(j.ear, s < 0), v3(j.earTip, s < 0), 0.04, 0.012, {
      bone: s > 0 ? 'earL' : 'earR',
      tag: TAG.EAR,
      k: 0.025,
      comb: V(0.5 * s, 0.5, 0),
      flatAxis: V(0.1 * s, 0.4, 1),
      flatFactor: 3.6,
      weightFalloff: 0.012,
    });
  }
  // short tail
  for (let i = 0; i < j.tail.length - 1; i++) {
    const a = v3(j.tail[i]);
    const b = v3(j.tail[i + 1]);
    f.cone(a, b, [0.05, 0.045, 0.035][i], [0.045, 0.035, 0.015][i], { bone: `tail${i}`, bone2: i < j.tail.length - 2 ? `tail${i + 1}` : null, tag: TAG.TAIL, k: 0.03, comb: b.clone().sub(a) });
  }
  // legs: thin with muscular upper parts and small hooves
  for (const s of [1, -1]) {
    const m = s < 0;
    const side = m ? 'R' : 'L';
    const P = (a: V3): THREE.Vector3 => v3(a, m);
    f.ellipsoid(V(0.095 * s, 0.8, -0.41), V(0.07, 0.17, 0.12), { bone: `thigh${side}`, tag: TAG.ULEG, k: 0.06, comb: V(0, -1, -0.3), rot: new THREE.Euler(0.25, 0, 0) });
    f.cone(P(j.hip), P(j.knee), 0.075, 0.045, { bone: `thigh${side}`, tag: TAG.ULEG, k: 0.05, comb: V(0, -1, 0) });
    f.cone(P(j.knee), P(j.hock), 0.042, 0.022, { bone: `shin${side}`, tag: TAG.LLEG, k: 0.03, comb: V(0, -1, 0) });
    f.cone(P(j.hock), P(j.hpaw), 0.02, 0.016, { bone: `metaH${side}`, tag: TAG.LLEG, k: 0.015, comb: V(0, -1, 0) });
    f.ellipsoid(V(0.11 * s, 0.03, -0.49), V(0.022, 0.03, 0.035), { bone: `toeH${side}`, tag: TAG.PAW, k: 0.012, comb: V(0, 0, 1) });
    f.ellipsoid(V(0.09 * s, 0.86, 0.4), V(0.05, 0.13, 0.08), { bone: `scap${side}`, tag: TAG.TORSO, k: 0.05, comb: back, rot: new THREE.Euler(0.4, 0, 0) });
    f.cone(P(j.shoulder), P(j.elbow), 0.06, 0.042, { bone: `arm${side}`, tag: TAG.ULEG, k: 0.05, comb: V(0, -1, 0) });
    f.cone(P(j.elbow), P(j.wrist), 0.035, 0.02, { bone: `fore${side}`, tag: TAG.LLEG, k: 0.025, comb: V(0, -1, 0) });
    f.cone(P(j.wrist), P(j.fpaw), 0.019, 0.016, { bone: `metaF${side}`, tag: TAG.LLEG, k: 0.015, comb: V(0, -1, 0) });
    f.ellipsoid(V(0.11 * s, 0.03, 0.415), V(0.022, 0.03, 0.035), { bone: `toeF${side}`, tag: TAG.PAW, k: 0.012, comb: V(0, 0, 1) });
  }
  return f;
}

const C = (h: number): THREE.Color => new THREE.Color(h);
const COAT = {
  back: C(0x7a5434),
  side: C(0x95683e),
  belly: C(0xe6dccb),
  dark: C(0x2a1d14),
  nose: C(0x101010),
  hoof: C(0x1c1612),
  earIn: C(0xcfb9a2),
};
const _c = new THREE.Color();

function paintDeer(v: VertexInfo, noise: SimplexNoise, out: PaintOut): void {
  const { pos: p, normal: n, tags: t } = v;
  const col = out.color.copy(COAT.side);
  const mot = noise.fbm3(p.x * 7, p.y * 7, p.z * 7, 3);
  col.lerp(COAT.back, smoothstep(0.2, 0.8, n.y + mot * 0.3) * 0.8);
  const body = t[TAG.TORSO] + t[TAG.BELLY] + t[TAG.NECK] + t[TAG.ULEG];
  col.lerp(COAT.belly, clamp01(smoothstep(-0.1, -0.6, n.y + mot * 0.2) * body));
  // white rump patch and tail underside
  const rump = smoothstep(-0.4, -0.75, n.z) * smoothstep(0.75, 0.9, p.y) * (t[TAG.TORSO] + t[TAG.TAIL]);
  col.lerp(COAT.belly, clamp01(rump * 1.2));
  if (t[TAG.TAIL] > 0.01) col.lerp(COAT.belly, t[TAG.TAIL] * smoothstep(0.2, -0.6, n.z + n.y));
  // white throat patch
  col.lerp(COAT.belly, t[TAG.NECK] * smoothstep(0.4, 0.8, n.z) * smoothstep(1.25, 1.3, p.y) * 0.9);
  // legs lighter below, hooves dark
  col.lerp(_c.copy(COAT.side).multiplyScalar(1.1), t[TAG.LLEG] * 0.6);
  col.lerp(COAT.belly, t[TAG.LLEG] * smoothstep(0.0, -0.8, n.x * Math.sign(p.x)) * 0.7);
  col.lerp(COAT.hoof, t[TAG.PAW]);
  // head: greyer face, pale muzzle ring, black nose, dark eye ring
  if (t[TAG.HEAD] + t[TAG.SNOUT] > 0.01) {
    _c.copy(COAT.side).lerp(C(0x6e5a48), 0.4);
    _c.lerp(COAT.belly, smoothstep(0.0, -0.6, n.y) * 0.8);
    col.lerp(_c, t[TAG.HEAD] + t[TAG.SNOUT]);
    col.lerp(COAT.belly, t[TAG.SNOUT] * smoothstep(0.89, 0.92, p.z) * 0.8);
  }
  if (t[TAG.JAW] > 0.01) col.lerp(COAT.belly, t[TAG.JAW] * 0.8);
  col.lerp(COAT.nose, smoothstep(0.2, 0.7, t[TAG.NOSE]));
  if (t[TAG.EAR] > 0.01) {
    _c.copy(C(0x8a6a4e)).lerp(COAT.earIn, smoothstep(0.0, 0.6, n.z));
    _c.lerp(COAT.dark, smoothstep(1.52, 1.55, p.y) * 0.8);
    col.lerp(_c, t[TAG.EAR]);
  }
  col.multiplyScalar(0.92 + mot * 0.14);
  out.furLen = 0.008;
}

/** Branching antlers built from tapered tubes, merged into a single mesh. */
function antlers(head: THREE.Bone, rig: Rig, variant: number): THREE.Object3D | null {
  if (variant % 2 !== 0) return null;
  const rnd = new Random(77 + variant);
  const parts: THREE.BufferGeometry[] = [];
  const headPos = rig.restPos.get('head')!;
  const up = new THREE.Vector3(0, 1, 0);
  const tube = (from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number): void => {
    const len = from.distanceTo(to);
    const geo = new THREE.CylinderGeometry(r1, r0, len, 6, 1);
    geo.translate(0, len / 2, 0);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, to.clone().sub(from).normalize()));
    geo.translate(from.x, from.y, from.z);
    geo.deleteAttribute('uv');
    parts.push(geo.toNonIndexed());
    geo.dispose();
  };
  for (const s of [1, -1]) {
    let p = new THREE.Vector3(0.04 * s, 1.47, 0.665).sub(headPos);
    let dir = new THREE.Vector3(0.45 * s, 0.85, -0.3).normalize();
    let r = 0.016;
    for (let seg = 0; seg < 4; seg++) {
      const len = 0.13 - seg * 0.015;
      const next = p.clone().addScaledVector(dir, len);
      tube(p, next, r, r * 0.8);
      if (seg < 3) {
        const tdir = new THREE.Vector3(0.1 * s, 0.5, 1).normalize().lerp(dir, 0.3).normalize();
        tube(next, next.clone().addScaledVector(tdir, 0.08 + rnd.next() * 0.04), r * 0.7, 0.003);
      }
      p = next;
      dir = dir.applyAxisAngle(new THREE.Vector3(0, 0, 1), -0.12 * s).normalize();
      dir.z -= 0.08;
      dir.normalize();
      r *= 0.8;
    }
  }
  const geo = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xcdb898, roughness: 0.7 }));
  mesh.name = 'antlers';
  mesh.castShadow = true;
  head.add(mesh);
  return mesh;
}

export const DEER: SpeciesSpec = {
  name: 'deer',
  joints: DEER_JOINTS,
  cellSize: 0.015,
  buildField: buildDeerField,
  paint: paintDeer,
  eyeIris: new THREE.Color(0x2a1a10),
  gait: {
    walkSpeed: 1.2,
    trotSpeed: 3.0,
    runSpeed: 10,
    maxSpeed: 11.5,
    walkToTrot: 1.8,
    trotToGallop: 4.2,
    stepHeight: 0.1,
    turnRate: 3.4,
  },
  shells: 0,
  furScale: 1,
  shellNoiseScale: 10,
  skinNoiseScale: 7,
  pawHeight: [0.045, 0.045],
  decorate: antlers,
};
