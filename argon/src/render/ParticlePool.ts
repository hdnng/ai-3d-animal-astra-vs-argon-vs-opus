import * as THREE from 'three';

interface ParticleSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  maxAge: number;
  size: number;
  r: number;
  g: number;
  b: number;
  gravity: number;
}

/**
 * Zero-Allocation Object-Pooled Particle System
 * Emits footstep dust puffs, water splashes, body-shake droplets, and cold breath mist.
 */
export class ParticlePool {
  private readonly maxParticles = 360;
  private pool: ParticleSlot[] = [];
  private cursor = 0;

  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private points: THREE.Points;

  private posArray: Float32Array;
  private colArray: Float32Array;
  private sizeAlphaArray: Float32Array; // x = size, y = alpha

  constructor(scene: THREE.Scene) {
    this.posArray = new Float32Array(this.maxParticles * 3);
    this.colArray = new Float32Array(this.maxParticles * 3);
    this.sizeAlphaArray = new Float32Array(this.maxParticles * 2);

    for (let i = 0; i < this.maxParticles; i++) {
      this.pool.push({
        active: false,
        x: 0, y: -100, z: 0,
        vx: 0, vy: 0, vz: 0,
        age: 0, maxAge: 1,
        size: 1,
        r: 1, g: 1, b: 1,
        gravity: 0
      });
      this.posArray[i * 3 + 1] = -100;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.posArray, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colArray, 3));
    this.geometry.setAttribute('aSizeAlpha', new THREE.BufferAttribute(this.sizeAlphaArray, 2));

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute vec2 aSizeAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aSizeAlpha.y;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSizeAlpha.x * (120.0 / max(1.0, -mvPosition.z)), 1.0, 38.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.01) discard;
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float soft = smoothstep(0.5, 0.1, d);
          gl_FragColor = vec4(vColor, soft * vAlpha);
        }
      `
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  private spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    maxAge: number, size: number,
    r: number, g: number, b: number,
    gravity: number
  ): void {
    const slot = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.maxParticles;

    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.vx = vx;
    slot.vy = vy;
    slot.vz = vz;
    slot.age = 0;
    slot.maxAge = maxAge;
    slot.size = size;
    slot.r = r;
    slot.g = g;
    slot.b = b;
    slot.gravity = gravity;
  }

  emitFootstepDust(pos: THREE.Vector3, intensity = 1.0): void {
    const count = Math.min(7, Math.ceil(3 * intensity));
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = (0.3 + Math.random() * 0.7) * intensity;
      this.spawn(
        pos.x + (Math.random() - 0.5) * 0.12,
        pos.y + 0.05,
        pos.z + (Math.random() - 0.5) * 0.12,
        Math.cos(angle) * spd,
        0.35 + Math.random() * 0.45,
        Math.sin(angle) * spd,
        0.45 + Math.random() * 0.35,
        0.32 + Math.random() * 0.22,
        0.65, 0.59, 0.49,
        -0.5
      );
    }
  }

  emitWaterSplash(pos: THREE.Vector3, intensity = 1.0): void {
    const count = Math.min(12, Math.ceil(6 * intensity));
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = (0.6 + Math.random() * 1.4) * intensity;
      this.spawn(
        pos.x + (Math.random() - 0.5) * 0.16,
        pos.y + 0.06,
        pos.z + (Math.random() - 0.5) * 0.16,
        Math.cos(angle) * spd,
        1.4 + Math.random() * 1.8 * intensity,
        Math.sin(angle) * spd,
        0.45 + Math.random() * 0.3,
        0.22 + Math.random() * 0.15,
        0.82, 0.93, 0.99,
        -6.5
      );
    }
  }

  emitBreathMist(muzzlePos: THREE.Vector3, heading: number): void {
    const sinH = Math.sin(heading);
    const cosH = Math.cos(heading);
    for (let i = 0; i < 2; i++) {
      this.spawn(
        muzzlePos.x + sinH * 0.22,
        muzzlePos.y,
        muzzlePos.z + cosH * 0.22,
        sinH * 0.6 + (Math.random() - 0.5) * 0.25,
        0.25 + Math.random() * 0.25,
        cosH * 0.6 + (Math.random() - 0.5) * 0.25,
        0.75 + Math.random() * 0.35,
        0.38 + Math.random() * 0.18,
        0.90, 0.95, 1.0,
        0.15
      );
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.pool[i];
      if (!p.active) {
        this.sizeAlphaArray[i * 2 + 1] = 0;
        continue;
      }

      p.age += dt;
      if (p.age >= p.maxAge) {
        p.active = false;
        this.posArray[i * 3 + 1] = -100;
        this.sizeAlphaArray[i * 2 + 1] = 0;
        continue;
      }

      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      const lifeNorm = p.age / p.maxAge;
      const alpha = Math.sin(lifeNorm * Math.PI) * 0.65;

      this.posArray[i * 3] = p.x;
      this.posArray[i * 3 + 1] = p.y;
      this.posArray[i * 3 + 2] = p.z;

      this.colArray[i * 3] = p.r;
      this.colArray[i * 3 + 1] = p.g;
      this.colArray[i * 3 + 2] = p.b;

      this.sizeAlphaArray[i * 2] = p.size * (0.8 + lifeNorm * 0.7);
      this.sizeAlphaArray[i * 2 + 1] = alpha;
    }

    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aSizeAlpha as THREE.BufferAttribute).needsUpdate = true;
  }
}
