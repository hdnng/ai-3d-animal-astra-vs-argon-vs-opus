import * as THREE from 'three';
import type { RigJoints, Rig } from '../Rig';
import type { SDFField, VertexInfo } from '../SDFMesher';
import type { SimplexNoise } from '../../utils/noise';

/** Body-region tags used for colouring and fur length. */
export const TAG = {
  TORSO: 0,
  NECK: 1,
  HEAD: 2,
  SNOUT: 3,
  JAW: 4,
  NOSE: 5,
  EAR: 6,
  TAIL: 7,
  ULEG: 8,
  LLEG: 9,
  PAW: 10,
  MANE: 11,
  BELLY: 12,
} as const;
export const TAG_COUNT = 13;

export interface PaintOut {
  color: THREE.Color;
  furLen: number;
}

export interface GaitSpec {
  walkSpeed: number;
  trotSpeed: number;
  runSpeed: number;
  maxSpeed: number;
  /** Speed at which walk blends into trot, and trot into gallop. */
  walkToTrot: number;
  trotToGallop: number;
  stepHeight: number;
  turnRate: number;
}

export interface SpeciesSpec {
  name: string;
  joints: RigJoints;
  /** SDF grid resolution (meters). */
  cellSize: number;
  buildField(rig: Rig): SDFField;
  paint(v: VertexInfo, noise: SimplexNoise, out: PaintOut): void;
  eyeIris: THREE.Color;
  gait: GaitSpec;
  /** Fur shell configuration (0 shells = skin only). */
  shells: number;
  furScale: number;
  /** Fur noise texture scales (texture repeats per meter) for shells and skin. */
  shellNoiseScale: number;
  skinNoiseScale: number;
  /** Paw joint height above the ground when standing (front, hind). */
  pawHeight: [number, number];
  /** Extra decoration (antlers etc.) attached to the head bone. */
  decorate?(head: THREE.Bone, rig: Rig, variant: number): THREE.Object3D | null;
}
