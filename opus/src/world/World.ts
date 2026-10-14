/**
 * World container: terrain data + meshes, sky, day/night, water, vegetation,
 * obstacles. Implements the environment queries used by animals and AI.
 */
import { hyp } from '../utils/math';
import * as THREE from 'three';
import { HALF, PLAY_RADIUS, type TerrainData, WATER_LEVEL } from './WorldGen';
import { Terrain } from './Terrain';
import { Sky } from './Sky';
import { DayNight } from './DayNight';
import { Obstacles } from './Obstacles';
import { Water } from './Water';
import { Vegetation } from './Vegetation';
import { Grass } from './Grass';
import type { AnimalEnv, Surface } from '../animal/Animal';
import { createHeightTexture, createNoiseTexture, createSplatTexture } from '../render/ProceduralTextures';
import { SpatialHash } from '../utils/SpatialHash';

/** Tree volume used for camera collision: trunk below, canopy cylinder above. */
interface Canopy {
  x: number;
  z: number;
  radius: number;
  y0: number;
  y1: number;
  trunk: number;
}

export class World implements AnimalEnv {
  readonly group = new THREE.Group();
  readonly terrain: Terrain;
  readonly sky: Sky;
  readonly dayNight: DayNight;
  readonly obstacles = new Obstacles();
  readonly noiseTex: THREE.DataTexture;
  readonly heightTex: THREE.DataTexture;
  readonly splatTex: THREE.DataTexture;
  readonly waterLevel = WATER_LEVEL;
  readonly water: Water;
  readonly vegetation: Vegetation;
  readonly grass: Grass;
  private canopies = new SpatialHash<Canopy>(8);
  private canopyTmp: Canopy[] = [];

  constructor(readonly data: TerrainData) {
    const seed = data.seed;
    this.group.name = 'world';
    this.noiseTex = createNoiseTexture(256, seed);
    this.heightTex = createHeightTexture(this.data);
    this.splatTex = createSplatTexture(this.data);
    this.terrain = new Terrain(this.data, this.noiseTex, this.splatTex);
    this.group.add(this.terrain.group);
    this.sky = new Sky(this.noiseTex);
    this.group.add(this.sky.mesh);
    this.dayNight = new DayNight();
    this.water = new Water(this.heightTex, this.noiseTex);
    this.group.add(this.water.mesh);
    this.vegetation = new Vegetation(this.data, this.obstacles, seed);
    this.group.add(this.vegetation.group);
    this.grass = new Grass(this.heightTex, this.splatTex, this.noiseTex, seed);
    this.group.add(this.grass.group);
    for (const t of this.vegetation.trees) {
      const base = this.data.heightAt(t.x, t.z);
      const r = t.height * (t.kind === 'pine' ? 0.22 : 0.3);
      this.canopies.insert({ x: t.x, z: t.z, radius: r, y0: base + t.height * (t.kind === 'pine' ? 0.18 : 0.45), y1: base + t.height * 1.05, trunk: 0.45 });
    }
  }

  /** Pushes a camera point horizontally out of tree canopies/trunks and boulders. */
  clearance(p: THREE.Vector3): void {
    for (const c of this.canopies.query(p.x, p.z, 1, this.canopyTmp)) {
      const inCanopy = p.y > c.y0 - 0.6 && p.y < c.y1 + 0.4;
      const r = (inCanopy ? c.radius : c.trunk) + 0.5;
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < r && p.y < c.y1 + 0.4) {
        const k = d > 1e-3 ? r / d : 1;
        p.x = c.x + (d > 1e-3 ? dx : 1) * k;
        p.z = c.z + (d > 1e-3 ? dz : 0) * k;
      }
    }
    for (const o of this.obstacles.query(p.x, p.z, 1)) {
      if (o.kind !== 'rock') continue;
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const r = o.radius + 0.4;
      if (d < r && p.y < this.data.heightAt(o.x, o.z) + o.radius * 1.2) {
        const k = r / Math.max(d, 1e-3);
        p.x = o.x + dx * k;
        p.z = o.z + dz * k;
      }
    }
  }

  /** Coarse visibility test against tree volumes along a segment. */
  occluded(a: THREE.Vector3, b: THREE.Vector3): boolean {
    for (let i = 1; i < 10; i++) {
      const t = i / 10;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const z = a.z + (b.z - a.z) * t;
      for (const c of this.canopies.query(x, z, 0.5, this.canopyTmp)) {
        const dx = x - c.x;
        const dz = z - c.z;
        const d2 = dx * dx + dz * dz;
        if (y > c.y0 && y < c.y1 && d2 < c.radius * c.radius * 0.8) return true;
        if (y <= c.y0 && d2 < c.trunk * c.trunk) return true;
      }
    }
    return false;
  }

  heightAt(x: number, z: number): number {
    return this.data.heightAt(x, z);
  }

  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    return this.data.normalAt(x, z, out);
  }

  waterDepth(x: number, z: number): number {
    return this.data.waterDepth(x, z);
  }

  collide(p: THREE.Vector3, radius: number): boolean {
    let hit = this.obstacles.resolve(p, radius);
    const r = hyp(p.x, p.z);
    const lim = PLAY_RADIUS;
    if (r > lim) {
      p.x *= lim / r;
      p.z *= lim / r;
      hit = true;
    }
    const e = HALF - 2;
    p.x = Math.max(-e, Math.min(e, p.x));
    p.z = Math.max(-e, Math.min(e, p.z));
    return hit;
  }

  surfaceAt(x: number, z: number): Surface {
    if (this.data.waterDepth(x, z) > 0.02) return 'water';
    if (this.data.slopeAt(x, z) > 0.35) return 'rock';
    if (this.data.grassAt(x, z) > 0.45) return 'grass';
    return 'dirt';
  }

  update(dt: number, camera: THREE.Camera, timeSpeed: number): void {
    this.dayNight.update(dt, timeSpeed);
    this.terrain.update(camera);
    this.sky.update(camera);
    this.vegetation.update(camera);
  }

  dispose(): void {
    this.terrain.dispose();
    this.sky.dispose();
    this.water.dispose();
    this.vegetation.dispose();
    this.grass.dispose();
    this.noiseTex.dispose();
    this.heightTex.dispose();
    this.splatTex.dispose();
  }
}
