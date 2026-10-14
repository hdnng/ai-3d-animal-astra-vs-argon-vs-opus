/**
 * Places and renders all static vegetation and props: pines, autumn
 * broadleaf trees, boulders, stones, bushes, flowers, mushrooms, logs,
 * reeds and lily pads. Trees/boulders/logs register collision obstacles.
 */
import * as THREE from 'three';
import { InstancedLOD } from './InstancedLOD';
import {
  AUTUMN,
  broadleafGeometry,
  bushGeometry,
  flowerGeometry,
  lilyGeometry,
  logGeometry,
  mushroomGeometry,
  pineGeometry,
  reedGeometry,
  rockGeometry,
} from './VegetationGeometry';
import { withWind } from '../render/WindMaterial';
import { Random } from '../utils/Random';
import { HALF, PLAY_RADIUS, SPAWN, type TerrainData, WATER_LEVEL, LAKE } from './WorldGen';
import type { Obstacles } from './Obstacles';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export interface TreeInfo {
  x: number;
  z: number;
  height: number;
  kind: 'pine' | 'broadleaf';
}

/** Combines several geometry variants into one by laying them out? No: picks per-variant meshes. */
function variants<T>(n: number, make: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => make(i));
}

export class Vegetation {
  readonly group = new THREE.Group();
  readonly sets: InstancedLOD[] = [];
  readonly trees: TreeInfo[] = [];
  readonly flowerSpots: THREE.Vector3[] = [];
  readonly bushSpots: THREE.Vector3[] = [];
  private materials: THREE.Material[] = [];
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();
  private frameCounter = 0;
  lodScale = 1;

  constructor(
    private data: TerrainData,
    obstacles: Obstacles,
    seed: number,
  ) {
    this.group.name = 'vegetation';
    const rnd = new Random(seed ^ 0x7ee5);

    // Materials (vertex coloured, wind-animated).
    const foliage = withWind(new THREE.MeshLambertMaterial({ vertexColors: true }), { stiffness: 6, flutter: 1.0 }, 'foliage');
    const bush = withWind(new THREE.MeshLambertMaterial({ vertexColors: true }), { stiffness: 2.5, flutter: 1.4 }, 'bush');
    const rock = new THREE.MeshLambertMaterial({ vertexColors: true });
    const flower = withWind(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { stiffness: 1.2, flutter: 2 }, 'flower');
    const reed = withWind(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { stiffness: 1.6, flutter: 1.5 }, 'reed');
    const plain = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.materials.push(foliage.material, foliage.depth, bush.material, bush.depth, rock, flower.material, flower.depth, reed.material, reed.depth, plain);

    // ---- Trees -------------------------------------------------------
    const pineSets = variants(3, (v) =>
      new InstancedLOD(
        `pine${v}`,
        [
          { geometry: pineGeometry(0, 11 + v * 7), maxDistance: 38, castShadow: true },
          { geometry: pineGeometry(1, 11 + v * 7), maxDistance: 110, castShadow: false },
          { geometry: pineGeometry(2, 11 + v * 7), maxDistance: 420, castShadow: false },
        ],
        foliage.material,
        900,
        false,
        foliage.depth,
      ),
    );
    const palettes = [AUTUMN.slice(0, 3), AUTUMN.slice(2, 5), [AUTUMN[0], AUTUMN[5], AUTUMN[6]]];
    const leafSets = variants(3, (v) =>
      new InstancedLOD(
        `broadleaf${v}`,
        [
          { geometry: broadleafGeometry(0, 101 + v * 13, palettes[v]), maxDistance: 34, castShadow: true },
          { geometry: broadleafGeometry(1, 101 + v * 13, palettes[v]), maxDistance: 100, castShadow: false },
          { geometry: broadleafGeometry(2, 101 + v * 13, palettes[v]), maxDistance: 380, castShadow: false },
        ],
        foliage.material,
        700,
        false,
        foliage.depth,
      ),
    );
    this.sets.push(...pineSets, ...leafSets);

    const cell = 3.2;
    const n = this.data.noise;
    for (let gz = -HALF + 4; gz < HALF - 4; gz += cell) {
      for (let gx = -HALF + 4; gx < HALF - 4; gx += cell) {
        const x = gx + (rnd.next() - 0.5) * cell * 0.9;
        const z = gz + (rnd.next() - 0.5) * cell * 0.9;
        const r = Math.hypot(x, z);
        if (r > HALF - 6) continue;
        const forest = data.forestAt(x, z);
        const lone = data.meadowAt(x, z) > 0.5 ? 0.004 : 0.015;
        if (rnd.next() > forest * 0.85 + lone) continue;
        const h = data.heightAt(x, z);
        if (h < WATER_LEVEL + 0.7) continue;
        if (data.slopeAt(x, z) > 0.42) continue;
        if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 9) continue;
        if (obstacles.blocked(x, z, 1.2)) continue;
        const pineBias = n.fbm2(x * 0.02 + 5, z * 0.02 - 9, 2) * 0.6 + (h - 4) * 0.05 + (r > PLAY_RADIUS ? 0.4 : 0);
        const isPine = rnd.next() < 0.45 + pineBias;
        const scale = (isPine ? 0.85 : 0.8) + rnd.next() * 0.55;
        const sets = isPine ? pineSets : leafSets;
        const set = sets[Math.floor(rnd.next() * sets.length)];
        _q.setFromAxisAngle(UP, rnd.next() * Math.PI * 2);
        // slight lean
        const lean = new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd.next() - 0.5) * 0.06, 0, (rnd.next() - 0.5) * 0.06));
        _q.multiply(lean);
        _s.setScalar(scale);
        _p.set(x, h - 0.15, z);
        _m.compose(_p, _q, _s);
        const height = (isPine ? 10.5 : 8) * scale;
        set.add(_m, height * 0.55);
        this.trees.push({ x, z, height, kind: isPine ? 'pine' : 'broadleaf' });
        obstacles.add({ x, z, radius: (isPine ? 0.32 : 0.24) * scale + 0.12, kind: 'tree' });
      }
    }

    // ---- Boulders & stones -------------------------------------------
    const rockSets = variants(4, (v) =>
      new InstancedLOD(
        `rock${v}`,
        [
          { geometry: rockGeometry(0, 31 + v * 5), maxDistance: 30, castShadow: true },
          { geometry: rockGeometry(1, 31 + v * 5), maxDistance: 95, castShadow: false },
          { geometry: rockGeometry(2, 31 + v * 5), maxDistance: 320, castShadow: false },
        ],
        rock,
        260,
      ),
    );
    this.sets.push(...rockSets);
    // Clusters of boulders on hills plus scattered stones.
    const clusters: [number, number][] = [];
    for (let i = 0; i < 26; i++) {
      for (let tries = 0; tries < 30; tries++) {
        const a = rnd.next() * Math.PI * 2;
        const rr = 20 + rnd.next() * (PLAY_RADIUS + 15);
        const x = Math.cos(a) * rr;
        const z = Math.sin(a) * rr;
        if (data.heightAt(x, z) < 1 || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 14) continue;
        clusters.push([x, z]);
        break;
      }
    }
    const placeRock = (x: number, z: number, size: number, obstacle: boolean): void => {
      const h = data.heightAt(x, z);
      if (h < WATER_LEVEL - 1.2) return;
      data.normalAt(x, z, _n);
      _q.setFromUnitVectors(UP, _n.clone().lerp(UP, 0.4).normalize());
      _q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, rnd.next() * Math.PI * 2));
      _s.setScalar(size);
      _p.set(x, h - size * 0.25, z);
      _m.compose(_p, _q, _s);
      rockSets[Math.floor(rnd.next() * rockSets.length)].add(_m, size * 1.2);
      if (obstacle) obstacles.add({ x, z, radius: size * 0.95, kind: 'rock' });
    };
    for (const [cx, cz] of clusters) {
      const k = 2 + Math.floor(rnd.next() * 5);
      for (let i = 0; i < k; i++) {
        const x = cx + (rnd.next() - 0.5) * 9;
        const z = cz + (rnd.next() - 0.5) * 9;
        if (obstacles.blocked(x, z, 0.8)) continue;
        placeRock(x, z, 0.7 + rnd.next() * 1.6, true);
      }
    }
    for (let i = 0; i < 380; i++) {
      const x = (rnd.next() - 0.5) * (HALF * 2 - 20);
      const z = (rnd.next() - 0.5) * (HALF * 2 - 20);
      if (obstacles.blocked(x, z, 0.4)) continue;
      const s = 0.12 + rnd.next() * 0.35;
      placeRock(x, z, s, false);
    }
    // Shoreline stones.
    for (let i = 0; i < 80; i++) {
      const a = rnd.next() * Math.PI * 2;
      const rr = LAKE.r * (0.85 + rnd.next() * 0.35);
      const x = LAKE.x + Math.cos(a) * rr;
      const z = LAKE.z + Math.sin(a) * rr;
      const h = data.heightAt(x, z);
      if (h < -0.4 || h > 0.8) continue;
      placeRock(x, z, 0.15 + rnd.next() * 0.45, false);
    }

    // ---- Fallen logs ---------------------------------------------------
    const logGeo = logGeometry(3.6, 0.22);
    const logs = new InstancedLOD('logs', [{ geometry: logGeo, maxDistance: 140, castShadow: true }], plain, 40);
    this.sets.push(logs);
    for (let i = 0, placed = 0; i < 400 && placed < 26; i++) {
      const x = (rnd.next() - 0.5) * PLAY_RADIUS * 1.8;
      const z = (rnd.next() - 0.5) * PLAY_RADIUS * 1.8;
      if (data.forestAt(x, z) < 0.35 || data.slopeAt(x, z) > 0.2 || obstacles.blocked(x, z, 2)) continue;
      const yaw = rnd.next() * Math.PI;
      const dx = Math.cos(yaw);
      const dz = -Math.sin(yaw);
      const h0 = data.heightAt(x - dx * 1.6, z - dz * 1.6);
      const h1 = data.heightAt(x + dx * 1.6, z + dz * 1.6);
      const pitch = Math.atan2(h1 - h0, 3.2);
      _q.setFromEuler(new THREE.Euler(0, yaw, pitch, 'YXZ'));
      _p.set(x, (h0 + h1) / 2 + 0.12, z);
      _m.compose(_p, _q, _s.setScalar(1));
      logs.add(_m, 2);
      for (const t of [-1.2, 0, 1.2]) obstacles.add({ x: x + dx * t, z: z + dz * t, radius: 0.35, kind: 'log' });
      placed++;
    }

    // ---- Bushes --------------------------------------------------------
    const bushColors = [0x7a3c26, 0x8f5a2c, 0x56632c, 0x5e3424, 0x8c7634].map((c) => new THREE.Color(c));
    const bushSets = variants(5, (v) =>
      new InstancedLOD(
        `bush${v}`,
        [
          { geometry: bushGeometry(0, 61 + v, bushColors[v], v === 2 || v === 3), maxDistance: 30, castShadow: true },
          { geometry: bushGeometry(1, 61 + v, bushColors[v], false), maxDistance: 80, castShadow: false },
          { geometry: bushGeometry(2, 61 + v, bushColors[v], false), maxDistance: 160, castShadow: false },
        ],
        bush.material,
        220,
        false,
        bush.depth,
      ),
    );
    this.sets.push(...bushSets);
    for (let i = 0; i < 2600; i++) {
      const x = (rnd.next() - 0.5) * (PLAY_RADIUS * 2 + 30);
      const z = (rnd.next() - 0.5) * (PLAY_RADIUS * 2 + 30);
      const f = data.forestAt(x, z);
      const edge = 1 - Math.abs(f - 0.4) * 2.2;
      if (rnd.next() > edge * 0.45 + 0.03) continue;
      const h = data.heightAt(x, z);
      if (h < 0.7 || data.slopeAt(x, z) > 0.35 || obstacles.blocked(x, z, 0.6)) continue;
      const s = 0.6 + rnd.next() * 0.7;
      _q.setFromAxisAngle(UP, rnd.next() * Math.PI * 2);
      _p.set(x, h - 0.08, z);
      _m.compose(_p, _q, _s.setScalar(s));
      bushSets[Math.floor(rnd.next() * bushSets.length)].add(_m, s);
      this.bushSpots.push(new THREE.Vector3(x, h, z));
    }

    // ---- Flowers (instance colours) -----------------------------------
    const flowerSet = new InstancedLOD('flowers', [{ geometry: flowerGeometry(), maxDistance: 55, castShadow: false }], flower.material, 4200, true);
    this.sets.push(flowerSet);
    const petal = [0xf2f0e8, 0xe8c832, 0xb07ad8, 0xe8743a, 0x7aa8e8, 0xd84a5a].map((c) => new THREE.Color(c));
    for (let i = 0; i < 9000 && flowerSet.count < 4200; i++) {
      const x = (rnd.next() - 0.5) * (PLAY_RADIUS * 2);
      const z = (rnd.next() - 0.5) * (PLAY_RADIUS * 2);
      const meadow = data.meadowAt(x, z);
      const patch = n.noise2(x * 0.08, z * 0.08);
      if (rnd.next() > meadow * 0.9 * (patch > 0 ? 1 : 0.25) + 0.02) continue;
      const h = data.heightAt(x, z);
      if (h < 0.5 || data.grassAt(x, z) < 0.4) continue;
      const s = 0.7 + rnd.next() * 0.7;
      _q.setFromAxisAngle(UP, rnd.next() * Math.PI * 2);
      _p.set(x, h - 0.02, z);
      _m.compose(_p, _q, _s.setScalar(s));
      const ci = Math.floor((patch * 0.5 + 0.5) * petal.length * 0.999 + rnd.next() * 1.5) % petal.length;
      flowerSet.add(_m, 0.4, petal[ci]);
      if (i % 9 === 0) this.flowerSpots.push(new THREE.Vector3(x, h, z));
    }

    // ---- Mushrooms -----------------------------------------------------
    const mush = new InstancedLOD('mushrooms', [{ geometry: mushroomGeometry(), maxDistance: 40, castShadow: false }], plain, 400);
    this.sets.push(mush);
    for (const t of this.trees) {
      if (mush.count >= 400 || rnd.next() > 0.18) continue;
      const k = 1 + Math.floor(rnd.next() * 4);
      for (let i = 0; i < k; i++) {
        const a = rnd.next() * Math.PI * 2;
        const rr = 0.8 + rnd.next() * 1.8;
        const x = t.x + Math.cos(a) * rr;
        const z = t.z + Math.sin(a) * rr;
        const s = 0.6 + rnd.next() * 0.9;
        _p.set(x, data.heightAt(x, z) - 0.01, z);
        _q.setFromAxisAngle(UP, rnd.next() * 6.28);
        _m.compose(_p, _q, _s.setScalar(s));
        mush.add(_m, 0.2);
      }
    }

    // ---- Reeds and lily pads around the lake ---------------------------
    const reedGeo = mergeGeometries([reedGeometry(5)], false)!;
    const reeds = new InstancedLOD('reeds', [{ geometry: reedGeo, maxDistance: 90, castShadow: false }], reed.material, 900);
    this.sets.push(reeds);
    for (let i = 0; i < 6000 && reeds.count < 900; i++) {
      const a = rnd.next() * Math.PI * 2;
      const rr = LAKE.r * (0.6 + rnd.next() * 0.8);
      const x = LAKE.x + Math.cos(a) * rr;
      const z = LAKE.z + Math.sin(a) * rr;
      const h = data.heightAt(x, z);
      if (h < -0.35 || h > 0.25) continue;
      if (n.noise2(x * 0.15, z * 0.15) < -0.1) continue;
      const s = 0.7 + rnd.next() * 0.6;
      _q.setFromAxisAngle(UP, rnd.next() * 6.28);
      _p.set(x, h - 0.05, z);
      _m.compose(_p, _q, _s.setScalar(s));
      reeds.add(_m, 1);
    }
    const lilies = new InstancedLOD('lilies', [{ geometry: lilyGeometry(), maxDistance: 120, castShadow: false }], plain, 120);
    this.sets.push(lilies);
    for (let i = 0; i < 3000 && lilies.count < 110; i++) {
      const a = rnd.next() * Math.PI * 2;
      const rr = LAKE.r * (0.3 + rnd.next() * 0.6);
      const x = LAKE.x + Math.cos(a) * rr;
      const z = LAKE.z + Math.sin(a) * rr;
      const d = data.waterDepth(x, z);
      if (d < 0.35 || d > 1.8 || n.noise2(x * 0.12 + 3, z * 0.12) < 0.15) continue;
      _q.setFromAxisAngle(UP, rnd.next() * 6.28);
      _p.set(x, WATER_LEVEL + 0.015, z);
      _m.compose(_p, _q, _s.setScalar(0.7 + rnd.next() * 0.8));
      lilies.add(_m, 0.4);
    }

    for (const s of this.sets) this.group.add(s.group);
  }

  update(camera: THREE.Camera): void {
    // Re-bucket every other frame (cheap, and LOD changes are not visible at this rate).
    if (this.frameCounter++ % 2 !== 0) return;
    camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices((camera as THREE.PerspectiveCamera).projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    for (const s of this.sets) s.update(camera, this.frustum, this.lodScale);
  }

  /** Forces an immediate LOD refresh (after camera jumps). */
  refresh(camera: THREE.Camera): void {
    this.frameCounter = 0;
    this.update(camera);
  }

  stats(): { instances: number; visible: number; drawCalls: number } {
    let instances = 0;
    let visible = 0;
    let drawCalls = 0;
    for (const s of this.sets) {
      instances += s.count;
      visible += s.visibleCount;
      drawCalls += s.drawCalls;
    }
    return { instances, visible, drawCalls };
  }

  dispose(): void {
    for (const s of this.sets) s.dispose();
    for (const m of this.materials) m.dispose();
    this.group.clear();
  }
}
