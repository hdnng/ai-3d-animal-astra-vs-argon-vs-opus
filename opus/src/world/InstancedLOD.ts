/**
 * Instanced rendering with per-instance distance LOD and frustum culling.
 * All instance transforms are stored once; each update the visible instances
 * are bucketed into one InstancedMesh per LOD level (one draw call each).
 */
import * as THREE from 'three';

export interface LODLevel {
  geometry: THREE.BufferGeometry;
  /** Instances closer than this use this level. */
  maxDistance: number;
  castShadow: boolean;
}

const _sphere = new THREE.Sphere();
const _v = new THREE.Vector3();

export class InstancedLOD {
  readonly group = new THREE.Group();
  readonly meshes: THREE.InstancedMesh[] = [];
  private matrices: Float32Array;
  private centers: Float32Array;
  private radii: Float32Array;
  private colors: Float32Array | null = null;
  count = 0;
  visibleCount = 0;
  /** Instances closer than this are kept even when outside the view (shadow casters). */
  shadowKeep = 28;
  private counts: number[] = [];
  private arrays: Float32Array[] = [];
  private colArrays: Float32Array[] | null = null;

  constructor(
    readonly name: string,
    private levels: LODLevel[],
    material: THREE.Material,
    private capacity: number,
    useColors = false,
    depthMaterial?: THREE.Material,
  ) {
    this.group.name = name;
    this.matrices = new Float32Array(capacity * 16);
    this.centers = new Float32Array(capacity * 3);
    this.radii = new Float32Array(capacity);
    if (useColors) this.colors = new Float32Array(capacity * 3);
    for (let l = 0; l < levels.length; l++) {
      const m = new THREE.InstancedMesh(levels[l].geometry, material, capacity);
      m.name = `${name}_lod${l}`;
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = levels[l].castShadow;
      m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (useColors) {
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
        m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      }
      if (depthMaterial) m.customDepthMaterial = depthMaterial;
      this.meshes.push(m);
      this.group.add(m);
    }
    this.counts = this.meshes.map(() => 0);
    this.arrays = this.meshes.map((m) => m.instanceMatrix.array as Float32Array);
    this.colArrays = useColors ? this.meshes.map((m) => m.instanceColor!.array as Float32Array) : null;
  }

  add(matrix: THREE.Matrix4, radius: number, color?: THREE.Color): number {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    matrix.toArray(this.matrices, i * 16);
    this.centers[i * 3] = this.matrices[i * 16 + 12];
    this.centers[i * 3 + 1] = this.matrices[i * 16 + 13] + radius * 0.5;
    this.centers[i * 3 + 2] = this.matrices[i * 16 + 14];
    this.radii[i] = radius;
    if (this.colors && color) color.toArray(this.colors, i * 3);
    return i;
  }

  /** Re-buckets instances by LOD and visibility. */
  update(camera: THREE.Camera, frustum: THREE.Frustum, lodScale = 1): void {
    const cp = camera.position;
    const counts = this.counts;
    counts.fill(0);
    const arrays = this.arrays;
    const colArrays = this.colArrays;
    const maxD = this.levels[this.levels.length - 1].maxDistance * lodScale;
    let vis = 0;
    for (let i = 0; i < this.count; i++) {
      const x = this.centers[i * 3];
      const y = this.centers[i * 3 + 1];
      const z = this.centers[i * 3 + 2];
      const dx = x - cp.x;
      const dy = y - cp.y;
      const dz = z - cp.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > maxD) continue;
      if (d > this.shadowKeep) {
        _sphere.center.set(x, y, z);
        _sphere.radius = this.radii[i] * 1.2;
        if (!frustum.intersectsSphere(_sphere)) continue;
      }
      let l = 0;
      while (l < this.levels.length - 1 && d > this.levels[l].maxDistance * lodScale) l++;
      const k = counts[l]++;
      const dst = arrays[l];
      const src = this.matrices;
      const so = i * 16;
      const d0 = k * 16;
      for (let c = 0; c < 16; c++) dst[d0 + c] = src[so + c];
      if (colArrays && this.colors) {
        colArrays[l][k * 3] = this.colors[i * 3];
        colArrays[l][k * 3 + 1] = this.colors[i * 3 + 1];
        colArrays[l][k * 3 + 2] = this.colors[i * 3 + 2];
      }
      vis++;
    }
    for (let l = 0; l < this.meshes.length; l++) {
      const m = this.meshes[l];
      m.count = counts[l];
      if (counts[l] > 0) {
        m.instanceMatrix.clearUpdateRanges();
        m.instanceMatrix.addUpdateRange(0, counts[l] * 16);
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) {
          m.instanceColor.clearUpdateRanges();
          m.instanceColor.addUpdateRange(0, counts[l] * 3);
          m.instanceColor.needsUpdate = true;
        }
      }
    }
    this.visibleCount = vis;
  }

  /** World position of instance i. */
  position(i: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.matrices[i * 16 + 12], this.matrices[i * 16 + 13], this.matrices[i * 16 + 14]);
  }

  get drawCalls(): number {
    return this.meshes.reduce((a, m) => a + (m.count > 0 ? 1 : 0), 0);
  }

  dispose(): void {
    for (const l of this.levels) l.geometry.dispose();
    for (const m of this.meshes) m.dispose();
    this.group.clear();
    void _v;
  }
}
