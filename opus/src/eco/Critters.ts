/**
 * Instanced small creatures with lightweight AI:
 *  - Hares: hop, nibble, flee in zig-zags to burrows, can be caught by wolves
 *  - Birds: boids flock that wanders, lands to peck, scatters from wolves, roosts at night
 *  - Fish: swim in the lake, occasionally leap with splashes
 *  - Butterflies: flutter between flowers by day
 * Each type is ONE instanced draw call; animation is done with instance
 * transforms plus small vertex-shader deformations (wing flaps, tail wiggle).
 */
import { hyp } from '../utils/math';
import * as THREE from 'three';
import { SDFField, polygonize } from '../animal/SDFMesher';
import { globalUniforms } from '../render/Uniforms';
import { Random } from '../utils/Random';
import { angleDiff, clamp, clamp01, damp, lerp } from '../utils/math';
import { events } from '../core/Events';
import type { World } from '../world/World';
import type { NavGrid } from '../ai/NavGrid';
import { LAKE, WATER_LEVEL } from '../world/WorldGen';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _sep = new THREE.Vector3();
const _avg = new THREE.Vector3();
const _avgVel = new THREE.Vector3();

export interface WolfLike {
  pos: THREE.Vector3;
  speed: number;
}

// ------------------------------------------------------------------ hares

function hareGeometry(): THREE.BufferGeometry {
  const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  const f = new SDFField();
  f.margin = 0.05;
  const o = { bone: 'body', tag: 0 };
  f.ellipsoid(V(0, 0.12, -0.02), V(0.072, 0.088, 0.13), { ...o, k: 0.04 });
  f.ellipsoid(V(0, 0.1, -0.085), V(0.085, 0.085, 0.09), { ...o, k: 0.04 });
  f.ellipsoid(V(0, 0.13, 0.07), V(0.058, 0.07, 0.07), { ...o, k: 0.04 });
  f.ellipsoid(V(0, 0.205, 0.13), V(0.042, 0.044, 0.058), { ...o, k: 0.035 });
  f.ellipsoid(V(0, 0.192, 0.178), V(0.026, 0.026, 0.028), { ...o, k: 0.02 });
  for (const s of [1, -1]) {
    f.cone(V(0.018 * s, 0.235, 0.115), V(0.04 * s, 0.37, 0.06), 0.017, 0.009, { ...o, k: 0.015, flatAxis: V(0.2 * s, 0.1, 1), flatFactor: 2.6 });
    f.cone(V(0.035 * s, 0.09, 0.1), V(0.035 * s, 0.0, 0.115), 0.016, 0.012, { ...o, k: 0.02 });
    f.ellipsoid(V(0.05 * s, 0.02, -0.06), V(0.024, 0.02, 0.07), { ...o, k: 0.03 });
  }
  f.sphere(V(0, 0.13, -0.155), 0.03, { ...o, k: 0.02 });
  const raw = polygonize(f, 0.015);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(raw.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(raw.normals, 3));
  geo.setIndex(new THREE.BufferAttribute(raw.indices, 1));
  const col = new Float32Array(raw.positions.length);
  const base = new THREE.Color(0x8a6a4c);
  const belly = new THREE.Color(0xe8dcc8);
  const dark = new THREE.Color(0x2a2018);
  const c = new THREE.Color();
  for (let i = 0; i < raw.positions.length / 3; i++) {
    const x = raw.positions[i * 3];
    const y = raw.positions[i * 3 + 1];
    const z = raw.positions[i * 3 + 2];
    const ny = raw.normals[i * 3 + 1];
    c.copy(base).multiplyScalar(0.85 + 0.3 * Math.sin(x * 90 + z * 70) * Math.cos(y * 80));
    if (ny < -0.3 && y < 0.15) c.lerp(belly, 0.8);
    if (z < -0.13 && y > 0.1) c.copy(belly);
    if (y > 0.33) c.copy(dark);
    if (Math.abs(Math.abs(x) - 0.038) < 0.012 && Math.abs(y - 0.215) < 0.012 && Math.abs(z - 0.15) < 0.015) c.copy(dark);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

interface Hare {
  x: number;
  z: number;
  y: number;
  yaw: number;
  mode: 'idle' | 'hop' | 'flee' | 'hidden';
  timer: number;
  hopT: number;
  hopDur: number;
  hopH: number;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  alive: boolean;
  burrow: number;
  gen: number;
  vx: number;
  vz: number;
  nibble: number;
}

export class Hares {
  readonly mesh: THREE.InstancedMesh;
  readonly list: Hare[] = [];
  readonly burrows: THREE.Vector3[] = [];
  private rnd: Random;
  readonly material: THREE.MeshStandardMaterial;
  private burrowMesh: THREE.InstancedMesh;

  constructor(
    private world: World,
    private nav: NavGrid,
    count: number,
    seed: number,
  ) {
    this.rnd = new Random(seed);
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    this.mesh = new THREE.InstancedMesh(hareGeometry(), this.material, count);
    this.mesh.name = 'hares';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Burrows near the meadow edges.
    const tmp = new THREE.Vector3();
    for (let i = 0; i < 10; i++) {
      for (let t = 0; t < 40; t++) {
        if (!nav.randomPointNear(-10, -12, 10, 80, () => this.rnd.next(), tmp)) continue;
        if (world.data.grassAt(tmp.x, tmp.z) < 0.4 || world.waterDepth(tmp.x, tmp.z) > 0) continue;
        this.burrows.push(tmp.clone());
        break;
      }
    }
    const moundGeo = new THREE.SphereGeometry(0.35, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    moundGeo.scale(1, 0.35, 1);
    const holeGeo = new THREE.CircleGeometry(0.11, 10);
    holeGeo.rotateX(-Math.PI / 2 + 0.5);
    holeGeo.translate(0, 0.08, 0.2);
    const mc = new Float32Array(moundGeo.attributes.position.count * 3).fill(0.32);
    moundGeo.setAttribute('color', new THREE.BufferAttribute(mc, 3));
    const hc = new Float32Array(holeGeo.attributes.position.count * 3).fill(0.02);
    holeGeo.setAttribute('color', new THREE.BufferAttribute(hc, 3));
    moundGeo.deleteAttribute('uv');
    holeGeo.deleteAttribute('uv');
    const merged = new THREE.BufferGeometry();
    const g1 = moundGeo.toNonIndexed();
    const g2 = holeGeo.toNonIndexed();
    const pos = new Float32Array([...(g1.attributes.position.array as Float32Array), ...(g2.attributes.position.array as Float32Array)]);
    const nor = new Float32Array([...(g1.attributes.normal.array as Float32Array), ...(g2.attributes.normal.array as Float32Array)]);
    const colA = new Float32Array([...(g1.attributes.color.array as Float32Array), ...(g2.attributes.color.array as Float32Array)]);
    for (let i = 0; i < colA.length; i += 3) {
      colA[i] *= 1.25;
      colA[i + 1] *= 1.0;
      colA[i + 2] *= 0.7;
    }
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    merged.setAttribute('color', new THREE.BufferAttribute(colA, 3));
    [moundGeo, holeGeo, g1, g2].forEach((g) => g.dispose());
    this.burrowMesh = new THREE.InstancedMesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), this.burrows.length);
    this.burrowMesh.name = 'burrows';
    this.burrowMesh.receiveShadow = true;
    this.burrows.forEach((b, i) => {
      _q.setFromAxisAngle(UP, this.rnd.next() * 6.28);
      _m.compose(_p.set(b.x, world.heightAt(b.x, b.z) - 0.03, b.z), _q, _s.set(1, 1, 1));
      this.burrowMesh.setMatrixAt(i, _m);
    });
    this.mesh.add(this.burrowMesh);
    for (let i = 0; i < count; i++) {
      const h: Hare = {
        x: 0, z: 0, y: 0, yaw: 0, mode: 'idle', timer: 1, hopT: 0, hopDur: 0.3, hopH: 0.15,
        fromX: 0, fromZ: 0, toX: 0, toZ: 0, alive: true, burrow: i % Math.max(1, this.burrows.length), gen: 0, vx: 0, vz: 0, nibble: 0,
      };
      this.spawn(h, true);
      this.list.push(h);
    }
  }

  private spawn(h: Hare, scatter: boolean): void {
    const b = this.burrows[Math.floor(this.rnd.next() * this.burrows.length)] ?? new THREE.Vector3(0, 0, 0);
    const tmp = new THREE.Vector3();
    if (scatter && this.nav.randomPointNear(b.x, b.z, 2, 18, () => this.rnd.next(), tmp)) {
      h.x = tmp.x;
      h.z = tmp.z;
    } else {
      h.x = b.x;
      h.z = b.z;
    }
    h.y = this.world.heightAt(h.x, h.z);
    h.yaw = this.rnd.next() * 6.28;
    h.mode = 'idle';
    h.timer = 1 + this.rnd.next() * 4;
    h.alive = true;
    h.gen++;
  }

  nearest(p: THREE.Vector3, maxD: number): number {
    let best = -1;
    let bd = maxD;
    for (let i = 0; i < this.list.length; i++) {
      const h = this.list[i];
      if (!h.alive || h.mode === 'hidden') continue;
      const d = hyp(h.x - p.x, h.z - p.z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  position(i: number, out: THREE.Vector3): THREE.Vector3 {
    const h = this.list[i];
    return out.set(h.x, h.y, h.z);
  }

  isAvailable(i: number, gen: number): boolean {
    const h = this.list[i];
    return h.alive && h.gen === gen && h.mode !== 'hidden';
  }

  /** Called when a wolf catches the hare. */
  catch(i: number): void {
    const h = this.list[i];
    h.alive = false;
    h.mode = 'hidden';
    h.timer = 40 + this.rnd.next() * 40;
  }

  get aliveCount(): number {
    return this.list.reduce((a, h) => a + (h.alive && h.mode !== 'hidden' ? 1 : 0), 0);
  }

  update(dt: number, wolves: readonly WolfLike[]): void {
    for (let i = 0; i < this.list.length; i++) {
      const h = this.list[i];
      // threat
      let near = Infinity;
      let tx = 0;
      let tz = 0;
      for (const w of wolves) {
        const d = hyp(w.pos.x - h.x, w.pos.z - h.z);
        if (d < near) {
          near = d;
          tx = w.pos.x;
          tz = w.pos.z;
        }
      }
      if (h.mode === 'hidden') {
        h.timer -= dt;
        if (h.timer <= 0 && near > 18) {
          if (!h.alive) this.spawn(h, false);
          h.alive = true;
          h.mode = 'idle';
          h.timer = 2;
          const b = this.burrows[h.burrow];
          if (b) {
            h.x = b.x;
            h.z = b.z;
          }
        }
        continue;
      }
      if (near < 11 && h.mode !== 'flee') {
        h.mode = 'flee';
        h.timer = 6;
      }
      if (h.mode === 'hop' || h.mode === 'flee') {
        if (h.hopT >= h.hopDur || h.hopT === 0) {
          // landed: choose next hop
          h.x = h.toX || h.x;
          h.z = h.toZ || h.z;
          let dir: number;
          let len: number;
          if (h.mode === 'flee') {
            const b = this.nearestBurrow(h.x, h.z);
            const away = Math.atan2(h.x - tx, h.z - tz);
            dir = away + (this.rnd.next() - 0.5) * 1.3;
            if (b && hyp(b.x - h.x, b.z - h.z) < 30) {
              const toB = Math.atan2(b.x - h.x, b.z - h.z);
              if (Math.abs(angleDiff(toB, away)) < 1.6) dir = toB + (this.rnd.next() - 0.5) * 0.8;
              if (hyp(b.x - h.x, b.z - h.z) < 1.2) {
                h.mode = 'hidden';
                h.timer = 8 + this.rnd.next() * 14;
                h.burrow = this.burrows.indexOf(b);
                continue;
              }
            }
            len = 1.4 + this.rnd.next() * 0.7;
            h.hopDur = 0.22;
            h.hopH = 0.28;
            h.timer -= h.hopDur;
            if (h.timer <= 0 && near > 16) {
              h.mode = 'idle';
              h.timer = 2;
            }
          } else {
            dir = h.yaw + (this.rnd.next() - 0.5) * 1.6;
            len = 0.35 + this.rnd.next() * 0.3;
            h.hopDur = 0.26;
            h.hopH = 0.12;
            if (this.rnd.chance(0.35)) {
              h.mode = 'idle';
              h.timer = 1.5 + this.rnd.next() * 4;
            }
          }
          let nx = h.x + Math.sin(dir) * len;
          let nz = h.z + Math.cos(dir) * len;
          if (!this.nav.walkable(nx, nz) || this.world.waterDepth(nx, nz) > 0.05) {
            dir += Math.PI * (0.5 + this.rnd.next());
            nx = h.x + Math.sin(dir) * len;
            nz = h.z + Math.cos(dir) * len;
            if (!this.nav.walkable(nx, nz) || this.world.waterDepth(nx, nz) > 0.05) {
              nx = h.x;
              nz = h.z;
            }
          }
          h.fromX = h.x;
          h.fromZ = h.z;
          h.toX = nx;
          h.toZ = nz;
          h.vx = (nx - h.x) / h.hopDur;
          h.vz = (nz - h.z) / h.hopDur;
          h.yaw = Math.atan2(nx - h.x, nz - h.z);
          h.hopT = 1e-4;
        } else {
          h.hopT = Math.min(h.hopDur, h.hopT + dt);
          const t = h.hopT / h.hopDur;
          h.x = lerp(h.fromX, h.toX, t);
          h.z = lerp(h.fromZ, h.toZ, t);
        }
      } else {
        // idle: nibble, look around
        h.vx = h.vz = 0;
        h.timer -= dt;
        h.nibble += dt;
        if (h.timer <= 0) {
          h.mode = 'hop';
          h.hopT = 0;
          h.toX = h.x;
          h.toZ = h.z;
        }
      }
      h.y = this.world.heightAt(h.x, h.z);
    }
    // Write instance matrices.
    let k = 0;
    for (const h of this.list) {
      if (!h.alive || h.mode === 'hidden') continue;
      let lift = 0;
      let sy = 1;
      let pitch = 0;
      if ((h.mode === 'hop' || h.mode === 'flee') && h.hopT > 0 && h.hopT < h.hopDur) {
        const t = h.hopT / h.hopDur;
        lift = Math.sin(Math.PI * t) * h.hopH;
        sy = 1 + Math.sin(Math.PI * t) * 0.18;
        pitch = (t - 0.5) * 0.7;
      } else {
        pitch = Math.max(0, Math.sin(h.nibble * 3)) * 0.12;
      }
      _e.set(pitch, h.yaw, 0, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_p.set(h.x, h.y + lift, h.z), _q, _s.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy)));
      this.mesh.setMatrixAt(k++, _m);
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private nearestBurrow(x: number, z: number): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bd = Infinity;
    for (const b of this.burrows) {
      const d = hyp(b.x - x, b.z - z);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  velocity(i: number, out: THREE.Vector3): THREE.Vector3 {
    const h = this.list[i];
    return out.set(h.vx, 0, h.vz);
  }

  isFleeing(i: number): boolean {
    return this.list[i].mode === 'flee';
  }

  generation(i: number): number {
    return this.list[i].gen;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.burrowMesh.geometry.dispose();
    (this.burrowMesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

// ------------------------------------------------------------------ birds

function birdGeometry(): THREE.BufferGeometry {
  // body (diamond), tail, two wings (aWing = signed span factor)
  const P: number[] = [];
  const W: number[] = [];
  const C: number[] = [];
  const tri = (a: number[], b: number[], c: number[], w: [number, number, number], col: [number, number, number]): void => {
    P.push(...a, ...b, ...c);
    W.push(...w);
    for (let i = 0; i < 3; i++) C.push(...col);
  };
  const dark: [number, number, number] = [0.08, 0.08, 0.09];
  const mid: [number, number, number] = [0.16, 0.15, 0.15];
  const nose = [0, 0, 0.13];
  const tail = [0, 0.005, -0.09];
  const l = [0.035, 0, 0.01];
  const r = [-0.035, 0, 0.01];
  const top = [0, 0.03, 0.02];
  const bot = [0, -0.028, 0.02];
  tri(nose, l, top, [0, 0, 0], mid);
  tri(nose, top, r, [0, 0, 0], mid);
  tri(nose, bot, l, [0, 0, 0], dark);
  tri(nose, r, bot, [0, 0, 0], dark);
  tri(tail, top, l, [0, 0, 0], mid);
  tri(tail, r, top, [0, 0, 0], mid);
  tri(tail, l, bot, [0, 0, 0], dark);
  tri(tail, bot, r, [0, 0, 0], dark);
  tri([0, 0.005, -0.07], [0.045, 0, -0.17], [-0.045, 0, -0.17], [0, 0, 0], dark);
  tri([0, 0.005, -0.07], [-0.045, 0, -0.17], [0.045, 0, -0.17], [0, 0, 0], dark);
  for (const s of [1, -1]) {
    const a = [0.02 * s, 0.01, 0.05];
    const b = [0.02 * s, 0.01, -0.04];
    const c = [0.24 * s, 0.0, -0.03];
    const d = [0.17 * s, 0.0, 0.05];
    tri(a, c, b, [0.08 * s, 1 * s, 0.08 * s], mid);
    tri(a, b, c, [0.08 * s, 0.08 * s, 1 * s], mid);
    tri(a, d, c, [0.08 * s, 0.7 * s, 1 * s], dark);
    tri(a, c, d, [0.08 * s, 1 * s, 0.7 * s], dark);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('aWing', new THREE.Float32BufferAttribute(W, 1));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  geo.computeVertexNormals();
  return geo;
}

interface Bird {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  mode: 'fly' | 'land' | 'ground' | 'roost';
  phase: number;
  flapRate: number;
  glide: number;
  peckT: number;
  yaw: number;
  bank: number;
}

export class Birds {
  readonly mesh: THREE.InstancedMesh;
  readonly list: Bird[] = [];
  private flap: THREE.InstancedBufferAttribute;
  private rnd: Random;
  private attractor = new THREE.Vector3(0, 30, 0);
  private attractorTarget = new THREE.Vector3(0, 30, 0);
  private retargetT = 0;
  landing: THREE.Vector3 | null = null;
  private groundT = 0;
  private landCooldown = 25;
  readonly material: THREE.MeshStandardMaterial;

  constructor(
    private world: World,
    count: number,
    seed: number,
  ) {
    this.rnd = new Random(seed);
    const geo = birdGeometry();
    this.flap = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2);
    this.flap.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFlap', this.flap);
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aWing;\nattribute vec2 aFlap;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            float span = abs(aWing);
            float s = sign(aWing);
            float ang = sin(aFlap.x) * aFlap.y;
            float fold = clamp(aFlap.y, 0.15, 1.0);
            float ax = abs(transformed.x);
            if (span > 0.01) {
              float d = ax * mix(0.35, 1.0, fold);
              transformed.x = s * d * cos(ang);
              transformed.y += d * sin(ang) * span;
            }
          }`,
        );
    };
    this.material.customProgramCacheKey = () => 'bird-flap';
    this.mesh = new THREE.InstancedMesh(geo, this.material, count);
    this.mesh.name = 'birds';
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < count; i++) {
      const a = this.rnd.next() * 6.28;
      this.list.push({
        pos: new THREE.Vector3(Math.cos(a) * 20, 25 + this.rnd.next() * 10, Math.sin(a) * 20),
        vel: new THREE.Vector3(this.rnd.next() - 0.5, 0, this.rnd.next() - 0.5).multiplyScalar(8),
        mode: 'fly',
        phase: this.rnd.next() * 6.28,
        flapRate: 13 + this.rnd.next() * 5,
        glide: 0,
        peckT: this.rnd.next() * 3,
        yaw: 0,
        bank: 0,
      });
    }
  }

  get visibleCount(): number {
    return this.list.filter((b) => b.mode !== 'roost').length;
  }

  /** Scatter grounded birds near p. */
  scatter(p: THREE.Vector3): boolean {
    if (!this.landing) return false;
    if (hyp(p.x - this.landing.x, p.z - this.landing.z) > 14) return false;
    this.takeOff();
    events.emit('birdScatter', { x: this.landing.x, y: this.landing.y + 0.5, z: this.landing.z });
    this.landing = null;
    return true;
  }

  private takeOff(): void {
    for (const b of this.list) {
      if (b.mode === 'ground' || b.mode === 'land') {
        b.mode = 'fly';
        b.vel.set(this.rnd.next() - 0.5, 1.2 + this.rnd.next(), this.rnd.next() - 0.5).multiplyScalar(7);
      }
    }
    this.landCooldown = 30 + this.rnd.next() * 30;
  }

  update(dt: number, time: number, night: number, wolves: readonly WolfLike[], onLand: (p: THREE.Vector3) => void): void {
    // Wander attractor.
    this.retargetT -= dt;
    if (this.retargetT <= 0) {
      this.retargetT = 8 + this.rnd.next() * 10;
      const a = this.rnd.next() * 6.28;
      const r = 20 + this.rnd.next() * 70;
      this.attractorTarget.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      this.attractorTarget.y = Math.max(this.world.heightAt(this.attractorTarget.x, this.attractorTarget.z), 0) + 22 + this.rnd.next() * 18;
    }
    this.attractor.lerp(this.attractorTarget, 1 - Math.exp(-0.3 * dt));
    // Landing logic (daytime only).
    this.landCooldown -= dt;
    if (!this.landing && this.landCooldown <= 0 && night < 0.3) {
      const tmp = new THREE.Vector3();
      for (let t = 0; t < 10; t++) {
        const a = this.rnd.next() * 6.28;
        const r = 10 + this.rnd.next() * 60;
        tmp.set(-10 + Math.cos(a) * r, 0, -12 + Math.sin(a) * r);
        if (this.world.data.grassAt(tmp.x, tmp.z) > 0.5 && this.world.waterDepth(tmp.x, tmp.z) === 0 && this.world.data.forestAt(tmp.x, tmp.z) < 0.2) {
          tmp.y = this.world.heightAt(tmp.x, tmp.z);
          this.landing = tmp.clone();
          this.groundT = 18 + this.rnd.next() * 20;
          for (const b of this.list) if (b.mode === 'fly') b.mode = 'land';
          break;
        }
      }
      if (!this.landing) this.landCooldown = 10;
    }
    if (this.landing) {
      this.groundT -= dt;
      for (const w of wolves) {
        if (hyp(w.pos.x - this.landing.x, w.pos.z - this.landing.z) < 13) {
          this.scatter(w.pos);
          break;
        }
      }
      if (this.landing && (this.groundT <= 0 || night > 0.5)) {
        this.takeOff();
        this.landing = null;
      }
    }
    const roosting = night > 0.75;
    const sep = _sep;
    const avg = _avg.set(0, 0, 0);
    const avgVel = _avgVel.set(0, 0, 0);
    let n = 0;
    for (const b of this.list) {
      if (b.mode === 'fly') {
        avg.add(b.pos);
        avgVel.add(b.vel);
        n++;
      }
    }
    if (n) {
      avg.multiplyScalar(1 / n);
      avgVel.multiplyScalar(1 / n);
    }
    let landedOnce = false;
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i];
      if (roosting && b.mode !== 'roost') {
        b.mode = 'roost';
      } else if (!roosting && b.mode === 'roost') {
        b.mode = 'fly';
        b.pos.set(this.attractor.x + (this.rnd.next() - 0.5) * 30, this.attractor.y, this.attractor.z + (this.rnd.next() - 0.5) * 30);
      }
      if (b.mode === 'roost') continue;
      if (b.mode === 'fly') {
        const acc = _a.set(0, 0, 0);
        acc.addScaledVector(_b.subVectors(this.attractor, b.pos), 0.08);
        acc.addScaledVector(_b.subVectors(avg, b.pos), 0.25);
        acc.addScaledVector(_b.subVectors(avgVel, b.vel), 0.4);
        sep.set(0, 0, 0);
        for (let j = 0; j < this.list.length; j++) {
          if (j === i) continue;
          const o = this.list[j];
          const d = b.pos.distanceTo(o.pos);
          if (d < 1.5 && d > 0) sep.addScaledVector(_b.subVectors(b.pos, o.pos), (1.5 - d) / d);
        }
        acc.addScaledVector(sep, 3);
        const ground = Math.max(this.world.heightAt(b.pos.x, b.pos.z), WATER_LEVEL);
        if (b.pos.y < ground + 12) acc.y += (ground + 12 - b.pos.y) * 0.6;
        b.vel.addScaledVector(acc, dt);
        const sp = b.vel.length();
        const want = clamp(sp, 7, 12);
        b.vel.multiplyScalar(want / Math.max(sp, 1e-3));
        b.glide = b.vel.y < -0.5 ? Math.min(1, b.glide + dt) : Math.max(0, b.glide - dt * 2);
      } else if (b.mode === 'land' && this.landing) {
        const tgt = _b.set(this.landing.x + Math.sin(i * 7.1) * 3.5, this.landing.y, this.landing.z + Math.cos(i * 5.3) * 3.5);
        const to = tgt.sub(b.pos);
        const d = to.length();
        if (d < 0.4) {
          b.mode = 'ground';
          b.vel.set(0, 0, 0);
          b.pos.y = this.world.heightAt(b.pos.x, b.pos.z);
          if (!landedOnce) {
            landedOnce = true;
            onLand(this.landing);
          }
        } else {
          b.vel.lerp(to.multiplyScalar(Math.min(9, d * 1.5) / d), 1 - Math.exp(-3 * dt));
          b.glide = d < 10 ? 1 : 0;
        }
      } else if (b.mode === 'ground') {
        b.peckT -= dt;
        if (b.peckT <= 0) {
          b.peckT = 0.4 + this.rnd.next() * 2;
          if (this.rnd.chance(0.5)) {
            const a = this.rnd.next() * 6.28;
            b.vel.set(Math.sin(a) * 0.8, 0, Math.cos(a) * 0.8);
          } else b.vel.set(0, 0, 0);
        }
        b.vel.multiplyScalar(Math.exp(-3 * dt));
        b.pos.y = this.world.heightAt(b.pos.x, b.pos.z);
      }
      b.pos.addScaledVector(b.vel, dt);
      // orientation
      const hv = hyp(b.vel.x, b.vel.z);
      if (hv > 0.05) {
        const ny = Math.atan2(b.vel.x, b.vel.z);
        const turn = angleDiff(b.yaw, ny);
        b.yaw += turn * Math.min(1, dt * 6);
        b.bank = damp(b.bank, clamp(-turn * 3, -0.8, 0.8), 4, dt);
      }
      const flying = b.mode !== 'ground';
      b.phase += dt * (flying ? b.flapRate * (1 - b.glide * 0.85) : 0);
      const amp = flying ? lerp(0.9, 0.12, b.glide) : 0;
      this.flap.setXY(i, b.phase, b.mode === 'ground' ? 0 : amp + 0.05);
      const pitch = flying ? -clamp(b.vel.y / 10, -0.5, 0.5) : b.peckT < 0.2 ? 0.5 : 0;
      _e.set(pitch, b.yaw, flying ? b.bank : 0, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(b.pos, _q, _s.setScalar(1.25));
      this.mesh.setMatrixAt(i, _m);
    }
    // hide roosting birds by collapsing their matrices
    for (let i = 0; i < this.list.length; i++) {
      if (this.list[i].mode === 'roost') {
        _m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _m);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.flap.needsUpdate = true;
    void time;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}

// ------------------------------------------------------------------- fish

function fishGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(1, 10, 6);
  body.scale(0.035, 0.055, 0.17);
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.15, 0, 0.06, -0.26, 0, -0.06, -0.26, 0, 0, -0.15, 0, -0.06, -0.26, 0, 0.06, -0.26], 3));
  const fin = new THREE.BufferGeometry();
  fin.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.05, 0.04, 0, 0.09, -0.04, 0, 0.045, -0.07, 0, 0.05, 0.04, 0, 0.045, -0.07, 0, 0.09, -0.04], 3));
  const parts = [body.toNonIndexed(), tail, fin];
  for (const p of parts) {
    p.deleteAttribute('uv');
    p.deleteAttribute('normal');
  }
  const pos: number[] = [];
  for (const p of parts) pos.push(...(p.attributes.position.array as Float32Array));
  parts.forEach((p) => p.dispose());
  body.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const col = new Float32Array(pos.length);
  for (let i = 0; i < pos.length / 3; i++) {
    const y = pos[i * 3 + 1];
    const t = clamp01((y + 0.05) / 0.1);
    col[i * 3] = lerp(0.85, 0.25, t);
    col[i * 3 + 1] = lerp(0.85, 0.35, t);
    col[i * 3 + 2] = lerp(0.8, 0.25, t);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

interface Fish {
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  target: THREE.Vector3;
  jumpT: number;
  vy: number;
  depth: number;
}

export class FishSchool {
  readonly mesh: THREE.InstancedMesh;
  readonly list: Fish[] = [];
  private rnd: Random;
  private jumpCooldown = 6;
  readonly material: THREE.MeshStandardMaterial;

  constructor(
    private world: World,
    count: number,
    seed: number,
    private onSplash: (x: number, z: number, strength: number) => void,
  ) {
    this.rnd = new Random(seed);
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.3, side: THREE.DoubleSide });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = globalUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float ph = instanceMatrix[3].x * 3.1 + instanceMatrix[3].z * 1.7;
          #else
            float ph = 0.0;
          #endif
          float tailW = clamp(-transformed.z + 0.05, 0.0, 0.4);
          transformed.x += sin(uTime * 9.0 + ph + transformed.z * 14.0) * tailW * 0.22;`,
        );
    };
    this.material.customProgramCacheKey = () => 'fish-swim';
    this.mesh = new THREE.InstancedMesh(fishGeometry(), this.material, count);
    this.mesh.name = 'fish';
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < count; i++) {
      const f: Fish = { pos: new THREE.Vector3(), yaw: this.rnd.next() * 6.28, speed: 0.6 + this.rnd.next() * 0.8, target: new THREE.Vector3(), jumpT: -1, vy: 0, depth: 0.4 + this.rnd.next() * 0.8 };
      this.pickPoint(f.pos);
      this.pickPoint(f.target);
      this.list.push(f);
    }
  }

  private pickPoint(out: THREE.Vector3): void {
    for (let t = 0; t < 30; t++) {
      const a = this.rnd.next() * 6.28;
      const r = this.rnd.next() * LAKE.r * 0.8;
      const x = LAKE.x + Math.cos(a) * r;
      const z = LAKE.z + Math.sin(a) * r;
      if (this.world.waterDepth(x, z) > 0.9) {
        out.set(x, 0, z);
        return;
      }
    }
    out.set(LAKE.x, 0, LAKE.z);
  }

  update(dt: number): void {
    this.jumpCooldown -= dt;
    for (let i = 0; i < this.list.length; i++) {
      const f = this.list[i];
      if (f.jumpT >= 0) {
        f.jumpT += dt;
        f.vy -= 9.81 * dt;
        f.pos.y += f.vy * dt;
        f.pos.x += Math.sin(f.yaw) * 2.2 * dt;
        f.pos.z += Math.cos(f.yaw) * 2.2 * dt;
        if (f.pos.y < WATER_LEVEL - 0.3 && f.vy < 0) {
          f.jumpT = -1;
          this.onSplash(f.pos.x, f.pos.z, 0.7);
        }
      } else {
        const dx = f.target.x - f.pos.x;
        const dz = f.target.z - f.pos.z;
        const d = hyp(dx, dz);
        if (d < 1) this.pickPoint(f.target);
        const ty = Math.atan2(dx, dz);
        f.yaw += angleDiff(f.yaw, ty) * Math.min(1, dt * 1.5);
        f.pos.x += Math.sin(f.yaw) * f.speed * dt;
        f.pos.z += Math.cos(f.yaw) * f.speed * dt;
        const floor = this.world.heightAt(f.pos.x, f.pos.z) + 0.15;
        f.pos.y = Math.max(floor, WATER_LEVEL - f.depth);
        if (this.world.waterDepth(f.pos.x, f.pos.z) < 0.5) this.pickPoint(f.target);
        if (this.jumpCooldown <= 0 && this.rnd.chance(dt * 0.05)) {
          this.jumpCooldown = 5 + this.rnd.next() * 10;
          f.jumpT = 0;
          f.vy = 3.6;
          f.pos.y = WATER_LEVEL - 0.05;
          this.onSplash(f.pos.x, f.pos.z, 0.45);
          events.emit('fishJump', { x: f.pos.x, y: WATER_LEVEL, z: f.pos.z });
        }
      }
      const pitch = f.jumpT >= 0 ? -Math.atan2(f.vy, 2.2) : 0;
      _e.set(pitch, f.yaw, 0, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(f.pos, _q, _s.setScalar(1.2));
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}

// ------------------------------------------------------------- butterflies

interface Butterfly {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  phase: number;
  rest: number;
  yaw: number;
}

export class Butterflies {
  readonly mesh: THREE.InstancedMesh;
  readonly list: Butterfly[] = [];
  private rnd: Random;
  readonly material: THREE.MeshStandardMaterial;

  constructor(
    private world: World,
    private spots: THREE.Vector3[],
    count: number,
    seed: number,
  ) {
    this.rnd = new Random(seed);
    const P = [0, 0, 0.02, 0.07, 0, 0.05, 0.06, 0, -0.03, 0, 0, 0.02, 0.06, 0, -0.03, 0.03, 0, -0.06];
    const all: number[] = [];
    const wing: number[] = [];
    for (const s of [1, -1]) {
      for (let i = 0; i < P.length; i += 3) {
        all.push(P[i] * s, P[i + 1], P[i + 2]);
        wing.push(s);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(all, 3));
    geo.setAttribute('aSide', new THREE.Float32BufferAttribute(wing, 1));
    geo.computeVertexNormals();
    this.material = new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = globalUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aSide;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float ph = instanceMatrix[3].x * 5.0 + instanceMatrix[3].z * 3.0;
          #else
            float ph = 0.0;
          #endif
          float a = (0.2 + 0.9 * (0.5 + 0.5 * sin(uTime * 22.0 + ph)));
          float d = abs(transformed.x);
          transformed.x = aSide * d * cos(a);
          transformed.y += d * sin(a);`,
        );
    };
    this.material.customProgramCacheKey = () => 'butterfly';
    this.mesh = new THREE.InstancedMesh(geo, this.material, count);
    this.mesh.name = 'butterflies';
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const palette = [0xe8822a, 0xf2efe6, 0x4a7ae8, 0xe8d23a, 0xc84a8a].map((c) => new THREE.Color(c));
    for (let i = 0; i < count; i++) {
      const s = spots.length ? spots[Math.floor(this.rnd.next() * spots.length)] : new THREE.Vector3();
      this.list.push({ pos: s.clone().add(new THREE.Vector3(0, 0.8, 0)), target: s.clone(), phase: this.rnd.next() * 10, rest: 0, yaw: 0 });
      this.mesh.setColorAt(i, palette[i % palette.length]);
    }
  }

  update(dt: number, night: number): void {
    const visible = night < 0.5;
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i];
      if (!visible) {
        _m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _m);
        continue;
      }
      b.phase += dt;
      const to = _p.subVectors(b.target, b.pos);
      const d = to.length();
      if (d < 0.3) {
        b.rest += dt;
        if (b.rest > 2 + (i % 4)) {
          b.rest = 0;
          const s = this.spots[Math.floor(this.rnd.next() * this.spots.length)];
          if (s && s.distanceTo(b.pos) < 30) b.target.copy(s);
          else b.target.set(b.pos.x + (this.rnd.next() - 0.5) * 8, 0, b.pos.z + (this.rnd.next() - 0.5) * 8);
          b.target.y = this.world.heightAt(b.target.x, b.target.z) + 0.35;
        }
      } else {
        to.multiplyScalar(Math.min(1.6, d) / d);
        b.pos.addScaledVector(to, dt);
        b.pos.x += Math.sin(b.phase * 3.1) * dt * 0.8;
        b.pos.y += Math.sin(b.phase * 4.3) * dt * 0.9;
        b.yaw = Math.atan2(to.x, to.z);
      }
      const ground = this.world.heightAt(b.pos.x, b.pos.z);
      if (b.pos.y < ground + 0.25) b.pos.y = ground + 0.25;
      _q.setFromAxisAngle(UP, b.yaw);
      _m.compose(b.pos, _q, _s.setScalar(1.3));
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
