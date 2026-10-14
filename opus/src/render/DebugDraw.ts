/**
 * Debug overlay geometry: skeleton bones of every animal, AI target lines
 * and paths, deer threat lines, and a global wireframe toggle.
 */
import * as THREE from 'three';
import type { Ecosystem } from '../eco/Ecosystem';

const MAX_VERTS = 24000;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class DebugDraw {
  readonly lines: THREE.LineSegments;
  private pos: Float32Array;
  private col: Float32Array;
  private n = 0;
  showSkeleton = false;
  showAI = false;
  private wire = false;
  private wireMats = new Set<THREE.Material>();

  constructor() {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX_VERTS * 3);
    this.col = new Float32Array(MAX_VERTS * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9, toneMapped: false });
    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.name = 'debug-lines';
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 999;
    this.lines.visible = false;
  }

  private seg(a: THREE.Vector3, b: THREE.Vector3, r: number, g: number, bl: number): void {
    if (this.n + 2 > MAX_VERTS) return;
    let k = this.n * 3;
    this.pos[k] = a.x;
    this.pos[k + 1] = a.y;
    this.pos[k + 2] = a.z;
    this.col[k] = r;
    this.col[k + 1] = g;
    this.col[k + 2] = bl;
    k += 3;
    this.pos[k] = b.x;
    this.pos[k + 1] = b.y;
    this.pos[k + 2] = b.z;
    this.col[k] = r;
    this.col[k + 1] = g;
    this.col[k + 2] = bl;
    this.n += 2;
  }

  update(eco: Ecosystem): void {
    this.lines.visible = this.showSkeleton || this.showAI;
    if (!this.lines.visible) return;
    this.n = 0;
    if (this.showSkeleton) {
      for (const a of eco.allAnimals) {
        if (!a.root.visible) continue;
        for (const bone of a.rig.bones) {
          if (!(bone.parent instanceof THREE.Bone)) continue;
          bone.getWorldPosition(_a);
          bone.parent.getWorldPosition(_b);
          const leg = /thigh|shin|meta|toe|arm|fore|scap/.test(bone.name);
          this.seg(_b, _a, leg ? 1 : 0.3, leg ? 0.85 : 1, leg ? 0.2 : 0.6);
        }
        // planted feet markers
        for (const f of a.planner.feet) {
          _a.copy(f.contact);
          _b.copy(f.contact).y += f.stance ? 0.15 : 0.05;
          this.seg(_a, _b, f.stance ? 0.2 : 1, f.stance ? 1 : 0.3, 0.3);
        }
      }
    }
    if (this.showAI) {
      const b = eco.alphaBrain;
      const w = eco.alpha;
      _a.copy(w.pos).setY(w.pos.y + 0.5);
      if (b.hasTarget) {
        _b.copy(b.target).setY(b.target.y + 0.5);
        this.seg(_a, _b, 1, 0.8, 0.2);
      }
      // path polyline
      const path = b.follower.path;
      for (let i = b.follower.idx; i < path.length; i++) {
        _a.copy(i === b.follower.idx ? w.pos : path[i - 1]).setY((i === b.follower.idx ? w.pos.y : path[i - 1].y) + 0.3);
        _b.copy(path[i]).setY(path[i].y + 0.3);
        this.seg(_a, _b, 0.3, 0.8, 1);
      }
      for (const p of eco.packBrains) {
        if (!p.hasTarget) continue;
        _a.copy(p.wolf.pos).setY(p.wolf.pos.y + 0.4);
        _b.copy(p.target).setY(p.target.y + 0.4);
        this.seg(_a, _b, 0.7, 0.7, 0.7);
      }
      for (const d of eco.deerBrains) {
        if (d.mode === 'dead') continue;
        if (d.threat && (d.mode === 'flee' || d.mode === 'alert')) {
          _a.copy(d.deer.pos).setY(d.deer.pos.y + 1);
          _b.copy(d.threat.pos).setY(d.threat.pos.y + 0.6);
          this.seg(_a, _b, 1, 0.2, 0.2);
        } else if (d.hasTarget) {
          _a.copy(d.deer.pos).setY(d.deer.pos.y + 0.6);
          _b.copy(d.target).setY(d.target.y + 0.6);
          this.seg(_a, _b, 0.6, 0.45, 0.25);
        }
      }
      if (eco.pointOfInterest) {
        _a.copy(eco.pointOfInterest);
        _b.copy(_a).setY(_a.y + 3);
        this.seg(_a, _b, 1, 0.3, 1);
      }
    }
    const geo = this.lines.geometry;
    geo.setDrawRange(0, this.n);
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  setWireframe(scene: THREE.Scene, on: boolean): void {
    if (on === this.wire) return;
    this.wire = on;
    if (on) {
      scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!m || o === this.lines) return;
        for (const mm of Array.isArray(m) ? m : [m]) {
          if ('wireframe' in mm && !(mm as THREE.MeshBasicMaterial).wireframe) {
            (mm as THREE.MeshBasicMaterial).wireframe = true;
            this.wireMats.add(mm);
          }
        }
      });
    } else {
      for (const m of this.wireMats) (m as THREE.MeshBasicMaterial).wireframe = false;
      this.wireMats.clear();
    }
  }

  get wireframe(): boolean {
    return this.wire;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
  }
}
