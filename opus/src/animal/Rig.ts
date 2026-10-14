/**
 * Hierarchical quadruped skeleton built from a species spec of rest-pose joint
 * positions (model space, +Z forward, +Y up, ground at y = 0).
 *
 * Topology:
 *  body ─┬─ pelvis ─┬─ tail0 … tailN
 *        │          ├─ thighL ─ shinL ─ metaHL ─ toeHL       (hind legs)
 *        │          └─ thighR …
 *        └─ spine ── chest ─┬─ ribs                          (breathing)
 *                           ├─ neck0 ─ neck1 ─ head ─┬─ jaw
 *                           │                        ├─ earL / earR
 *                           ├─ scapL ─ armL ─ foreL ─ metaFL ─ toeFL  (front legs)
 *                           └─ scapR …
 *
 * All bones have identity rest rotations; animation sets local quaternions.
 */
import * as THREE from 'three';

export type V3 = [number, number, number];

export interface RigJoints {
  body: V3;
  pelvis: V3;
  spine: V3;
  chest: V3;
  ribs: V3;
  neck0: V3;
  neck1: V3;
  head: V3;
  noseTip: V3;
  jaw: V3;
  jawTip: V3;
  ear: V3; // left side, mirrored
  earTip: V3;
  tail: V3[]; // tail joint positions, last one is the tip (not a bone)
  // Hind leg (left): hip, knee, hock, paw, toe tip
  hip: V3;
  knee: V3;
  hock: V3;
  hpaw: V3;
  htoe: V3;
  // Front leg (left): scapula top, shoulder, elbow, wrist, paw, toe tip
  scap: V3;
  shoulder: V3;
  elbow: V3;
  wrist: V3;
  fpaw: V3;
  ftoe: V3;
  eye: V3; // left eye center
  eyeRadius: number;
}

export type Side = 'L' | 'R';

export interface LegBones {
  front: boolean;
  side: Side;
  /** Scapula (front only) */
  root: THREE.Bone | null;
  upper: THREE.Bone;
  lower: THREE.Bone;
  meta: THREE.Bone;
  toe: THREE.Bone;
  /** Rest lengths */
  lUpper: number;
  lLower: number;
  lMeta: number;
  lToe: number;
  /** Rest local offset (in its parent's space) of each child joint. */
  restUpperDir: THREE.Vector3;
  restLowerDir: THREE.Vector3;
  restMetaDir: THREE.Vector3;
  restToeDir: THREE.Vector3;
  /** Neutral foot position in model space at rest. */
  neutral: THREE.Vector3;
}

export class Rig {
  readonly bones: THREE.Bone[] = [];
  readonly byName = new Map<string, THREE.Bone>();
  readonly root: THREE.Bone;
  readonly pelvis: THREE.Bone;
  readonly spine: THREE.Bone;
  readonly chest: THREE.Bone;
  readonly ribs: THREE.Bone;
  readonly neck0: THREE.Bone;
  readonly neck1: THREE.Bone;
  readonly head: THREE.Bone;
  readonly jaw: THREE.Bone;
  readonly earL: THREE.Bone;
  readonly earR: THREE.Bone;
  readonly tail: THREE.Bone[] = [];
  readonly legs: LegBones[] = [];
  /** Model-space rest positions per bone name. */
  readonly restPos = new Map<string, THREE.Vector3>();
  /** Model-space tip (end) per bone name (for SDF segments and debug lines). */
  readonly restTip = new Map<string, THREE.Vector3>();
  readonly restBodyY: number;
  readonly hipHeight: number;
  readonly shoulderHeight: number;
  readonly bodyLength: number;

  constructor(readonly j: RigJoints) {
    const v = (a: V3): THREE.Vector3 => new THREE.Vector3(a[0], a[1], a[2]);
    const mir = (a: V3): V3 => [-a[0], a[1], a[2]];
    const make = (name: string, pos: V3, parent: THREE.Bone | null, tip: V3): THREE.Bone => {
      const b = new THREE.Bone();
      b.name = name;
      const wp = v(pos);
      this.restPos.set(name, wp);
      this.restTip.set(name, v(tip));
      if (parent) {
        b.position.copy(wp).sub(this.restPos.get(parent.name)!);
        parent.add(b);
      } else {
        b.position.copy(wp);
      }
      this.bones.push(b);
      this.byName.set(name, b);
      return b;
    };

    this.root = make('body', j.body, null, j.spine);
    this.pelvis = make('pelvis', j.pelvis, this.root, j.tail[0]);
    this.spine = make('spine', j.spine, this.root, j.chest);
    this.chest = make('chest', j.chest, this.spine, j.neck0);
    this.ribs = make('ribs', j.ribs, this.chest, [j.ribs[0], j.ribs[1] - 0.1, j.ribs[2]]);
    this.neck0 = make('neck0', j.neck0, this.chest, j.neck1);
    this.neck1 = make('neck1', j.neck1, this.neck0, j.head);
    this.head = make('head', j.head, this.neck1, j.noseTip);
    this.jaw = make('jaw', j.jaw, this.head, j.jawTip);
    this.earL = make('earL', j.ear, this.head, j.earTip);
    this.earR = make('earR', mir(j.ear), this.head, mir(j.earTip));
    let parent = this.pelvis;
    for (let i = 0; i < j.tail.length - 1; i++) {
      const b = make(`tail${i}`, j.tail[i], parent, j.tail[i + 1]);
      this.tail.push(b);
      parent = b;
    }

    const buildLeg = (front: boolean, side: Side): void => {
      const s = (a: V3): V3 => (side === 'L' ? a : mir(a));
      const sfx = side;
      let rootBone: THREE.Bone | null = null;
      let upper: THREE.Bone;
      let lower: THREE.Bone;
      let meta: THREE.Bone;
      let toe: THREE.Bone;
      let pUpper: V3, pLower: V3, pMeta: V3, pToe: V3, pTip: V3;
      if (front) {
        rootBone = make(`scap${sfx}`, s(j.scap), this.chest, s(j.shoulder));
        pUpper = j.shoulder;
        pLower = j.elbow;
        pMeta = j.wrist;
        pToe = j.fpaw;
        pTip = j.ftoe;
        upper = make(`arm${sfx}`, s(pUpper), rootBone, s(pLower));
        lower = make(`fore${sfx}`, s(pLower), upper, s(pMeta));
        meta = make(`metaF${sfx}`, s(pMeta), lower, s(pToe));
        toe = make(`toeF${sfx}`, s(pToe), meta, s(pTip));
      } else {
        pUpper = j.hip;
        pLower = j.knee;
        pMeta = j.hock;
        pToe = j.hpaw;
        pTip = j.htoe;
        upper = make(`thigh${sfx}`, s(pUpper), this.pelvis, s(pLower));
        lower = make(`shin${sfx}`, s(pLower), upper, s(pMeta));
        meta = make(`metaH${sfx}`, s(pMeta), lower, s(pToe));
        toe = make(`toeH${sfx}`, s(pToe), meta, s(pTip));
      }
      const d = (a: V3, b: V3): THREE.Vector3 => v(s(b)).sub(v(s(a)));
      const du = d(pUpper, pLower);
      const dl = d(pLower, pMeta);
      const dm = d(pMeta, pToe);
      const dt = d(pToe, pTip);
      this.legs.push({
        front,
        side,
        root: rootBone,
        upper,
        lower,
        meta,
        toe,
        lUpper: du.length(),
        lLower: dl.length(),
        lMeta: dm.length(),
        lToe: dt.length(),
        restUpperDir: du.clone().normalize(),
        restLowerDir: dl.clone().normalize(),
        restMetaDir: dm.clone().normalize(),
        restToeDir: dt.clone().normalize(),
        neutral: v(s(pToe)),
      });
    };
    // Order: FL, FR, HL, HR
    buildLeg(true, 'L');
    buildLeg(true, 'R');
    buildLeg(false, 'L');
    buildLeg(false, 'R');

    this.restBodyY = j.body[1];
    this.hipHeight = j.hip[1];
    this.shoulderHeight = j.shoulder[1];
    this.bodyLength = j.shoulder[2] - j.hip[2];
  }

  /** Resets all bones to rest rotation. */
  resetPose(): void {
    for (const b of this.bones) {
      b.quaternion.identity();
      b.scale.set(1, 1, 1);
    }
    this.root.position.copy(this.restPos.get('body')!);
  }
}
