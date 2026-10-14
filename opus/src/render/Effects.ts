/**
 * Gameplay-driven visual effects built on the pooled particle systems:
 * footstep dust, water splashes, shake-off droplets, landing puffs, paw-print
 * decals, falling autumn leaves, sunlit pollen and night fireflies.
 */
import * as THREE from 'three';
import { ParticleSystem } from './Particles';
import { createSoftDotTexture } from './ProceduralTextures';
import { events } from '../core/Events';
import { fxRandom } from '../utils/Random';
import type { World } from '../world/World';
import type { Vegetation } from '../world/Vegetation';
import { WATER_LEVEL } from '../world/WorldGen';

function pawTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(0,0,0,0)';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,255,1)';
  const blob = (x: number, y: number, rx: number, ry: number): void => {
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  };
  blob(32, 40, 13, 11); // main pad
  blob(18, 22, 5.5, 7);
  blob(27, 15, 5.5, 7);
  blob(37, 15, 5.5, 7);
  blob(46, 22, 5.5, 7);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Instanced ground decals for paw prints with fade-out. */
class PawPrints {
  readonly mesh: THREE.InstancedMesh;
  private ages: Float32Array;
  private next = 0;
  private alpha: THREE.InstancedBufferAttribute;
  private tex: THREE.CanvasTexture;
  readonly max = 160;

  constructor() {
    this.tex = pawTexture();
    const geo = new THREE.PlaneGeometry(0.09, 0.09);
    geo.rotateX(-Math.PI / 2);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(this.max), 1);
    this.alpha.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iAlpha', this.alpha);
    const mat = new THREE.MeshLambertMaterial({ color: 0x2a2018, transparent: true, depthWrite: false, alphaMap: this.tex, polygonOffset: true, polygonOffsetFactor: -2 });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float iAlpha;\nvarying float vPrint;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPrint = iAlpha;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vPrint;')
        .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\ndiffuseColor.a *= vPrint;');
    };
    mat.customProgramCacheKey = () => 'pawprints';
    this.mesh = new THREE.InstancedMesh(geo, mat, this.max);
    this.mesh.name = 'pawprints';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    this.ages = new Float32Array(this.max).fill(1e9);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.max; i++) this.mesh.setMatrixAt(i, zero);
  }

  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private m = new THREE.Matrix4();
  private p = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);

  add(x: number, y: number, z: number, yaw: number, normal: THREE.Vector3, strength: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.q.setFromUnitVectors(this.up, normal).multiply(this.q2.setFromAxisAngle(this.up, yaw));
    this.m.compose(this.p.set(x, y + 0.012, z), this.q, this.one);
    this.mesh.setMatrixAt(i, this.m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.ages[i] = 0;
    this.alpha.setX(i, 0.55 * strength);
  }

  update(dt: number): void {
    let changed = false;
    for (let i = 0; i < this.max; i++) {
      if (this.ages[i] > 40) continue;
      this.ages[i] += dt;
      const a = this.alpha.getX(i);
      if (this.ages[i] > 25) {
        this.alpha.setX(i, Math.max(0, a - dt * 0.05));
        changed = true;
      }
    }
    if (changed) this.alpha.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.tex.dispose();
    this.mesh.dispose();
  }
}

export class Effects {
  readonly group = new THREE.Group();
  readonly dust: ParticleSystem;
  readonly water: ParticleSystem;
  readonly leaves: ParticleSystem;
  readonly glow: ParticleSystem;
  readonly prints: PawPrints;
  private dot: THREE.Texture;
  private leafTex: THREE.Texture;
  private unsub: (() => void)[] = [];
  private leafT = 0;
  private pollenT = 0;
  private fireflyTimer = 0;
  private tmpN = new THREE.Vector3();
  enabled = true;

  constructor(
    private world: World,
    private veg: Vegetation,
  ) {
    this.group.name = 'effects';
    this.dot = createSoftDotTexture(64);
    this.leafTex = this.makeLeafTexture();
    this.dust = new ParticleSystem({ max: 500, texture: this.dot, name: 'dust' });
    this.water = new ParticleSystem({ max: 700, texture: this.dot, name: 'water' });
    this.leaves = new ParticleSystem({ max: 260, texture: this.leafTex, name: 'leaves' });
    this.glow = new ParticleSystem({ max: 420, texture: this.dot, additive: true, name: 'glow' });
    this.prints = new PawPrints();
    this.group.add(this.dust.mesh, this.water.mesh, this.leaves.mesh, this.glow.mesh, this.prints.mesh);

    this.unsub.push(
      events.on('footstep', (e) => {
        if (!this.enabled) return;
        if (e.surface === 'water') {
          this.splash(e.x, WATER_LEVEL, e.z, 0.25 * e.strength, 5);
          return;
        }
        if (e.animal === 'wolf' && (e.surface === 'dirt' || this.world.data.waterDepth(e.x, e.z) === 0 && this.world.heightAt(e.x, e.z) < 0.9)) {
          this.world.normalAt(e.x, e.z, this.tmpN);
          this.prints.add(e.x, this.world.heightAt(e.x, e.z), e.z, fxRandom.next() * 0.3, this.tmpN, 1);
        }
        if (e.strength > 0.65) this.puff(e.x, e.y, e.z, e.strength * 0.6, 2);
      }),
      events.on('land', (e) => this.puff(e.x, e.y, e.z, 0.6 + e.strength, 8)),
      events.on('splash', (e) => this.splash(e.x, WATER_LEVEL, e.z, e.strength, Math.round(10 + e.strength * 20))),
      events.on('shake', (e) => this.shakeDrops(e.x, e.y, e.z)),
      events.on('kill', (e) => this.puff(e.x, e.y + 0.2, e.z, 1.2, 14)),
    );
  }

  private makeLeafTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(16, 2);
    g.quadraticCurveTo(30, 14, 16, 30);
    g.quadraticCurveTo(2, 14, 16, 2);
    g.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.NoColorSpace;
    return t;
  }

  puff(x: number, y: number, z: number, strength: number, n: number): void {
    const surf = this.world.surfaceAt(x, z);
    const c = surf === 'grass' ? [0.36, 0.32, 0.22] : surf === 'rock' ? [0.42, 0.4, 0.37] : [0.42, 0.34, 0.25];
    for (let i = 0; i < n; i++) {
      const a = fxRandom.next() * Math.PI * 2;
      const sp = 0.4 + fxRandom.next() * 0.8 * strength;
      this.dust.emit({
        x: x + Math.cos(a) * 0.1,
        y: y + 0.05,
        z: z + Math.sin(a) * 0.1,
        vx: Math.cos(a) * sp,
        vy: 0.3 + fxRandom.next() * 0.5 * strength,
        vz: Math.sin(a) * sp,
        life: 0.9 + fxRandom.next() * 0.8,
        size0: 0.12 * strength + 0.05,
        size1: 0.55 * strength + 0.25,
        r: c[0],
        g: c[1],
        b: c[2],
        a0: 0.22,
        a1: 0,
        gravity: -0.2,
        drag: 2.5,
        spin: (fxRandom.next() - 0.5) * 2,
      });
    }
  }

  splash(x: number, y: number, z: number, strength: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = fxRandom.next() * Math.PI * 2;
      const sp = (0.5 + fxRandom.next() * 1.4) * strength;
      this.water.emit({
        x,
        y: y + 0.02,
        z,
        vx: Math.cos(a) * sp,
        vy: (1.5 + fxRandom.next() * 2.5) * strength + 0.4,
        vz: Math.sin(a) * sp,
        life: 0.6 + fxRandom.next() * 0.5,
        size0: 0.035 + fxRandom.next() * 0.03,
        size1: 0.02,
        r: 0.85,
        g: 0.92,
        b: 1,
        a0: 0.8,
        a1: 0.3,
        gravity: 9.8,
        drag: 0.3,
      });
    }
    // mist
    for (let i = 0; i < 3; i++) {
      this.water.emit({ x, y: y + 0.1, z, vy: 0.4, life: 0.9, size0: 0.15, size1: 0.7 * strength + 0.2, r: 0.9, g: 0.95, b: 1, a0: 0.25, a1: 0, drag: 1 });
    }
  }

  private shakeDrops(x: number, y: number, z: number): void {
    for (let i = 0; i < 70; i++) {
      const a = fxRandom.next() * Math.PI * 2;
      const sp = 1.5 + fxRandom.next() * 2.5;
      this.water.emit({
        x: x + Math.cos(a) * 0.25,
        y: y + (fxRandom.next() - 0.3) * 0.3,
        z: z + Math.sin(a) * 0.4,
        vx: Math.cos(a) * sp,
        vy: 0.5 + fxRandom.next() * 2,
        vz: Math.sin(a) * sp,
        life: 0.5 + fxRandom.next() * 0.4,
        size0: 0.03,
        size1: 0.02,
        r: 0.85,
        g: 0.92,
        b: 1,
        a0: 0.75,
        a1: 0.2,
        gravity: 9.8,
      });
    }
  }

  /** Ambient effects around the camera (leaves, pollen, fireflies). */
  update(dt: number, time: number, camera: THREE.Camera, night: number, sunLight: THREE.Color, rain: number, wind: number): void {
    const cp = camera.position;
    // Falling leaves from nearby broadleaf trees.
    this.leafT -= dt;
    if (this.enabled && this.leafT <= 0) {
      this.leafT = 0.12;
      for (let k = 0; k < 6; k++) {
        const tr = this.veg.trees[Math.floor(fxRandom.next() * this.veg.trees.length)];
        if (tr.kind === 'broadleaf' && Math.hypot(tr.x - cp.x, tr.z - cp.z) < 40) {
          const h = this.world.heightAt(tr.x, tr.z);
          const hue = fxRandom.next();
          this.leaves.emit({
            x: tr.x + (fxRandom.next() - 0.5) * 3,
            y: h + tr.height * (0.55 + fxRandom.next() * 0.3),
            z: tr.z + (fxRandom.next() - 0.5) * 3,
            vx: wind * 0.8,
            vy: -0.5,
            vz: wind * 0.4,
            life: 7 + fxRandom.next() * 4,
            size0: 0.09,
            size1: 0.09,
            r: 0.75 + hue * 0.2,
            g: 0.35 + hue * 0.35,
            b: 0.08,
            a0: 1,
            a1: 1,
            drag: 0.6,
            spin: (fxRandom.next() - 0.5) * 5,
            flutter: 0.6,
          });
          break;
        }
      }
    }
    // Pollen / dust motes catching the sun.
    this.pollenT -= dt;
    if (this.enabled && night < 0.4 && rain < 0.2 && this.pollenT <= 0) {
      this.pollenT = 0.15;
      const a = fxRandom.next() * Math.PI * 2;
      const r = 2 + fxRandom.next() * 12;
      const x = cp.x + Math.cos(a) * r;
      const z = cp.z + Math.sin(a) * r;
      this.glow.emit({ x, y: this.world.heightAt(x, z) + 0.3 + fxRandom.next() * 2, z, vx: 0.1, vy: 0.05, life: 6, size0: 0.025, size1: 0.025, r: 1, g: 0.9, b: 0.6, a0: 0.5, a1: 0, flutter: 0.25 });
    }
    // Fireflies at night near the meadow and the lake.
    this.fireflyTimer -= dt;
    if (this.enabled && night > 0.55 && rain < 0.3 && this.fireflyTimer <= 0) {
      this.fireflyTimer = 0.03;
      const a = fxRandom.next() * Math.PI * 2;
      const r = 3 + fxRandom.next() * 26;
      const x = cp.x + Math.cos(a) * r;
      const z = cp.z + Math.sin(a) * r;
      const g = this.world.data.grassAt(x, z);
      if (g > 0.3 && this.world.waterDepth(x, z) === 0) {
        this.glow.emit({
          x,
          y: this.world.heightAt(x, z) + 0.3 + fxRandom.next() * 1.4,
          z,
          vx: (fxRandom.next() - 0.5) * 0.3,
          vy: (fxRandom.next() - 0.5) * 0.15,
          vz: (fxRandom.next() - 0.5) * 0.3,
          life: 4 + fxRandom.next() * 4,
          size0: 0.09,
          size1: 0.06,
          r: 0.75,
          g: 1.0,
          b: 0.35,
          a0: 1.6,
          a1: 0,
          flutter: 0.35,
        });
      }
    }
    // Lighting tint for non-emissive particles.
    this.dust.uniforms.uLight.value.copy(sunLight);
    this.water.uniforms.uLight.value.copy(sunLight);
    this.leaves.uniforms.uLight.value.copy(sunLight);
    this.dust.update(dt, time);
    this.water.update(dt, time);
    this.leaves.update(dt, time);
    this.glow.update(dt, time);
    this.prints.update(dt);
  }

  get particleCount(): number {
    return this.dust.count + this.water.count + this.leaves.count + this.glow.count;
  }

  clear(): void {
    this.dust.clear();
    this.water.clear();
    this.leaves.clear();
    this.glow.clear();
  }

  dispose(): void {
    this.unsub.forEach((u) => u());
    this.dust.dispose();
    this.water.dispose();
    this.leaves.dispose();
    this.glow.dispose();
    this.prints.dispose();
    this.dot.dispose();
    this.leafTex.dispose();
  }
}
