/**
 * Builds the skinned creature mesh for a species: SDF -> Surface Nets ->
 * smooth skin weights -> vertex-coloured coat -> SkinnedMesh + fur shells +
 * eyes. Geometry is generated once per species and shared by individuals.
 */
import * as THREE from 'three';
import { Rig } from './Rig';
import type { SpeciesSpec } from './species/types';
import { createEyeGeometry, createShellMaterial, createSkinMaterial, type FurUniforms } from './FurMaterial';
import { buildSpeciesData, type MeshArrays, type SpeciesMeshData } from './SpeciesBuilder';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { globalUniforms } from '../render/Uniforms';

interface SpeciesAssets {
  geometry: THREE.BufferGeometry;
  lods: THREE.BufferGeometry[];
  shellGeometry: THREE.InstancedBufferGeometry | null;
  eyeGeometry: THREE.BufferGeometry;
  vertexCount: number;
  shellVertexCount: number;
  buildMs: number;
}

const cache = new Map<string, SpeciesAssets>();

function geometryFromArrays(d: MeshArrays): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(d.colors, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(d.skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(d.skinWeight, 4));
  geo.setAttribute('furLen', new THREE.BufferAttribute(d.furLen, 1));
  geo.setAttribute('comb', new THREE.BufferAttribute(d.comb, 3));
  geo.setIndex(new THREE.BufferAttribute(d.indices, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

function assetsFromData(spec: SpeciesSpec, d: SpeciesMeshData): SpeciesAssets {
  const lods = d.lods.map(geometryFromArrays);
  let shellGeometry: THREE.InstancedBufferGeometry | null = null;
  if (spec.shells > 0) {
    const sg = lods[1];
    shellGeometry = new THREE.InstancedBufferGeometry();
    for (const name of Object.keys(sg.attributes)) shellGeometry.setAttribute(name, sg.attributes[name]);
    shellGeometry.setIndex(sg.index);
    shellGeometry.instanceCount = spec.shells;
    shellGeometry.boundingSphere = sg.boundingSphere!.clone();
    shellGeometry.boundingBox = sg.boundingBox!.clone();
  }
  return {
    geometry: lods[0],
    lods,
    shellGeometry,
    eyeGeometry: createEyeGeometry(spec.joints.eyeRadius, spec.eyeIris),
    vertexCount: d.lods[0].positions.length / 3,
    shellVertexCount: d.lods[1].positions.length / 3,
    buildMs: d.buildMs,
  };
}

/** Synchronous build (fallback when the species was not preloaded). */
export function buildSpeciesAssets(spec: SpeciesSpec): SpeciesAssets {
  const cached = cache.get(spec.name);
  if (cached) return cached;
  const assets = assetsFromData(spec, buildSpeciesData(spec));
  cache.set(spec.name, assets);
  return assets;
}

/** Sculpts all species in parallel Web Workers. */
export async function preloadSpecies(specs: SpeciesSpec[]): Promise<void> {
  const todo = specs.filter((s) => !cache.has(s.name));
  if (typeof Worker === 'undefined') {
    for (const s of todo) buildSpeciesAssets(s);
    return;
  }
  await Promise.all(
    todo.map(
      (spec) =>
        new Promise<void>((resolve) => {
          const worker = new Worker(new URL('./meshWorker.ts', import.meta.url), { type: 'module' });
          const finish = (): void => {
            worker.terminate();
            resolve();
          };
          worker.onmessage = (e: MessageEvent<{ data?: SpeciesMeshData; error?: string }>) => {
            if (e.data.data) cache.set(spec.name, assetsFromData(spec, e.data.data));
            else buildSpeciesAssets(spec);
            finish();
          };
          worker.onerror = (ev) => {
            ev.preventDefault();
            buildSpeciesAssets(spec);
            finish();
          };
          worker.postMessage({ name: spec.name });
        }),
    ),
  );
}

export function speciesBuildInfo(): Record<string, { vertices: number; shellVertices: number; ms: number }> {
  const out: Record<string, { vertices: number; shellVertices: number; ms: number }> = {};
  for (const [k, a] of cache) out[k] = { vertices: a.vertexCount, shellVertices: a.shellVertexCount, ms: Math.round(a.buildMs) };
  return out;
}

/** Releases cached species geometry (used on full teardown). */
export function disposeSpeciesAssets(): void {
  for (const a of cache.values()) {
    a.lods.forEach((g) => g.dispose());
    a.shellGeometry?.dispose();
    a.eyeGeometry.dispose();
  }
  cache.clear();
}

export class CreatureMesh {
  readonly group = new THREE.Group();
  readonly rig: Rig;
  readonly skeleton: THREE.Skeleton;
  readonly body: THREE.SkinnedMesh;
  readonly shells: THREE.SkinnedMesh | null = null;
  readonly skinMaterial: THREE.MeshLambertMaterial;
  readonly shellMaterial: THREE.MeshLambertMaterial | null = null;
  readonly eyeMaterial: THREE.MeshStandardMaterial;
  readonly eyes: THREE.Mesh;
  readonly fur: FurUniforms = {
    uShells: { value: 0 },
    uFurScale: { value: 1 },
    uWetness: { value: 0 },
    uBlink: { value: 0 },
  };
  readonly maxShells: number;
  decoration: THREE.Object3D | null = null;
  readonly assets: SpeciesAssets;

  constructor(
    readonly spec: SpeciesSpec,
    tint: THREE.Color,
    variant = 0,
  ) {
    const assets = (this.assets = buildSpeciesAssets(spec));
    this.rig = new Rig(spec.joints);
    this.skeleton = new THREE.Skeleton(this.rig.bones);
    this.skinMaterial = createSkinMaterial({ strandScale: spec.skinNoiseScale });
    this.skinMaterial.color.copy(tint);
    this.body = new THREE.SkinnedMesh(assets.geometry, this.skinMaterial);
    this.body.name = `${spec.name}-body`;
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.body.add(this.rig.root);
    this.body.updateMatrixWorld(true);
    this.body.bind(this.skeleton);
    // Manual generous bounds: avoids CPU skinning for culling every frame.
    this.body.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 1.6);
    this.group.add(this.body);

    this.maxShells = spec.shells;
    if (assets.shellGeometry) {
      this.shellMaterial = createShellMaterial(spec.shells, this.fur, { strandScale: spec.shellNoiseScale });
      this.shellMaterial.color.copy(tint);
      this.fur.uFurScale.value = spec.furScale;
      // Per-creature instance count requires its own geometry wrapper.
      const sg = new THREE.InstancedBufferGeometry();
      for (const name of Object.keys(assets.shellGeometry.attributes)) sg.setAttribute(name, assets.shellGeometry.attributes[name]);
      sg.setIndex(assets.shellGeometry.index);
      sg.instanceCount = spec.shells;
      sg.boundingSphere = assets.shellGeometry.boundingSphere!.clone();
      this.shells = new THREE.SkinnedMesh(sg, this.shellMaterial);
      this.shells.name = `${spec.name}-fur`;
      this.shells.castShadow = false;
      this.shells.receiveShadow = true;
      this.shells.bind(this.skeleton, this.body.bindMatrix);
      this.shells.boundingSphere = this.body.boundingSphere.clone();
      this.shells.renderOrder = 1;
      this.group.add(this.shells);
    }

    // Both eyes in one mesh; blinking squashes each eye toward its own centre in the shader.
    this.eyeMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.0 });
    const blink = this.fur.uBlink;
    this.eyeMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uBlink = blink;
      shader.uniforms.uNight = globalUniforms.uNight;
      // Eyeshine (tapetum lucidum): the iris glows faintly at night.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * diffuseColor.rgb * 6.0 * uNight;');
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aCenter;\nuniform float uBlink;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y = aCenter.y + (transformed.y - aCenter.y) * (1.0 - uBlink * 0.93);');
    };
    this.eyeMaterial.customProgramCacheKey = () => 'creature-eyes';
    const j = spec.joints;
    const headPos = this.rig.restPos.get('head')!;
    const parts: THREE.BufferGeometry[] = [];
    const tmp = new THREE.Object3D();
    for (const s of [1, -1]) {
      tmp.position.set(j.eye[0] * s - headPos.x, j.eye[1] - headPos.y, j.eye[2] - headPos.z);
      tmp.lookAt(tmp.position.clone().add(new THREE.Vector3(0.45 * s, 0.05, 1)));
      tmp.updateMatrix();
      const g = assets.eyeGeometry.clone().applyMatrix4(tmp.matrix);
      const n = g.attributes.position.count;
      const c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) tmp.position.toArray(c, i * 3);
      g.setAttribute('aCenter', new THREE.BufferAttribute(c, 3));
      parts.push(g);
    }
    this.eyes = new THREE.Mesh(mergeGeometries(parts, false)!, this.eyeMaterial);
    parts.forEach((g) => g.dispose());
    this.eyes.name = `${spec.name}-eyes`;
    this.rig.head.add(this.eyes);
    if (spec.decorate) {
      this.decoration = spec.decorate(this.rig.head, this.rig, variant);
    }
  }

  /** 0 = open, 1 = closed. */
  setBlink(v: number): void {
    this.fur.uBlink.value = Math.min(1, Math.max(0, v));
  }

  /** Swaps the body mesh LOD (0 fine .. 2 coarse). */
  setMeshLOD(level: number): void {
    const g = this.assets.lods[Math.max(0, Math.min(this.assets.lods.length - 1, level))];
    if (this.body.geometry !== g) this.body.geometry = g;
    this.body.castShadow = level < 2;
    this.eyes.visible = level < 2;
  }

  setShellCount(n: number): void {
    if (!this.shells) return;
    const c = Math.max(0, Math.min(this.maxShells, Math.round(n)));
    (this.shells.geometry as THREE.InstancedBufferGeometry).instanceCount = c;
    this.fur.uShells.value = Math.max(c, 1);
    this.shells.visible = c > 0;
  }

  dispose(): void {
    this.skinMaterial.dispose();
    this.shellMaterial?.dispose();
    this.eyeMaterial.dispose();
    this.eyes.geometry.dispose();
    if (this.shells) this.shells.geometry.dispose();
    this.skeleton.dispose();
    if (this.decoration) {
      this.decoration.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
    }
  }
}
