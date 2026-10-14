/**
 * Pooled GPU billboard particles. One InstancedBufferGeometry per system,
 * CPU integration (positions, colours, sizes) streamed to dynamic instance
 * attributes each frame; dead particles are recycled from a free list so
 * nothing is allocated after startup.
 */
import * as THREE from 'three';

export interface ParticleSystemOptions {
  max: number;
  texture: THREE.Texture;
  additive?: boolean;
  /** 0 = flat billboard, 1 = stretched along velocity (rain, sparks). */
  stretch?: number;
  lit?: boolean;
  name: string;
}

export interface EmitParams {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size0: number;
  size1: number;
  r: number;
  g: number;
  b: number;
  a0: number;
  a1?: number;
  gravity?: number;
  drag?: number;
  spin?: number;
  /** Flutter amplitude (leaves). */
  flutter?: number;
}

export class ParticleSystem {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private iPos: THREE.InstancedBufferAttribute;
  private iCol: THREE.InstancedBufferAttribute;
  private iSize: THREE.InstancedBufferAttribute;
  // simulation state (struct of arrays)
  private px: Float32Array;
  private py: Float32Array;
  private pz: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private vz: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private col: Float32Array;
  private a0: Float32Array;
  private a1: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private rot: Float32Array;
  private spin: Float32Array;
  private flutter: Float32Array;
  private alive: Int32Array;
  private aliveCount = 0;
  private free: number[] = [];
  readonly material: THREE.ShaderMaterial;
  readonly uniforms: { uLight: { value: THREE.Color } };

  constructor(readonly opts: ParticleSystemOptions) {
    const n = opts.max;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.s0 = new Float32Array(n);
    this.s1 = new Float32Array(n);
    this.col = new Float32Array(n * 3);
    this.a0 = new Float32Array(n);
    this.a1 = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.spin = new Float32Array(n);
    this.flutter = new Float32Array(n);
    this.alive = new Int32Array(n);
    for (let i = n - 1; i >= 0; i--) this.free.push(i);

    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.attributes.position);
    this.geo.setAttribute('uv', quad.attributes.uv);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.iCol = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.iSize = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
    for (const a of [this.iPos, this.iCol, this.iSize]) a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.iPos);
    this.geo.setAttribute('iCol', this.iCol);
    this.geo.setAttribute('iSize', this.iSize);
    this.geo.instanceCount = 0;
    this.uniforms = { uLight: { value: new THREE.Color(1, 1, 1) } };
    const stretch = (opts.stretch ?? 0).toFixed(2);
    this.material = new THREE.ShaderMaterial({
      name: `Particles-${opts.name}`,
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: opts.texture }, uLight: { value: new THREE.Color(1, 1, 1) } }]),
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        attribute vec3 iPos;
        attribute vec4 iCol;
        attribute vec2 iSize; // size, rotation
        varying vec2 vUv;
        varying vec4 vCol;
        void main() {
          vUv = uv;
          vCol = iCol;
          vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
          float c = cos(iSize.y), s = sin(iSize.y);
          vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iSize.x;
          p.y *= 1.0 + ${stretch} * 8.0;
          mvPosition.xy += p;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform sampler2D uMap;
        uniform vec3 uLight;
        varying vec2 vUv;
        varying vec4 vCol;
        void main() {
          float a = texture2D(uMap, vUv).a * vCol.a;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vCol.rgb * uLight, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
    });
    this.material.uniforms.uLight = this.uniforms.uLight;
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.name = `particles-${opts.name}`;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  emit(p: EmitParams): void {
    const i = this.free.pop();
    if (i === undefined) return;
    this.px[i] = p.x;
    this.py[i] = p.y;
    this.pz[i] = p.z;
    this.vx[i] = p.vx ?? 0;
    this.vy[i] = p.vy ?? 0;
    this.vz[i] = p.vz ?? 0;
    this.life[i] = 0;
    this.maxLife[i] = p.life;
    this.s0[i] = p.size0;
    this.s1[i] = p.size1;
    this.col[i * 3] = p.r;
    this.col[i * 3 + 1] = p.g;
    this.col[i * 3 + 2] = p.b;
    this.a0[i] = p.a0;
    this.a1[i] = p.a1 ?? 0;
    this.grav[i] = p.gravity ?? 0;
    this.drag[i] = p.drag ?? 0;
    this.rot[i] = Math.random() * 6.28;
    this.spin[i] = p.spin ?? 0;
    this.flutter[i] = p.flutter ?? 0;
    this.alive[this.aliveCount++] = i;
  }

  get count(): number {
    return this.aliveCount;
  }

  get capacity(): number {
    return this.opts.max;
  }

  update(dt: number, time: number): void {
    const pos = this.iPos.array as Float32Array;
    const col = this.iCol.array as Float32Array;
    const siz = this.iSize.array as Float32Array;
    let w = 0;
    for (let k = 0; k < this.aliveCount; k++) {
      const i = this.alive[k];
      this.life[i] += dt;
      const t = this.life[i] / this.maxLife[i];
      if (t >= 1) {
        this.free.push(i);
        continue;
      }
      this.alive[w] = i;
      const dr = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= dr;
      this.vz[i] *= dr;
      this.vy[i] = this.vy[i] * dr - this.grav[i] * dt;
      const fl = this.flutter[i];
      this.px[i] += (this.vx[i] + (fl ? Math.sin(time * 2.3 + i) * fl : 0)) * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += (this.vz[i] + (fl ? Math.cos(time * 1.9 + i * 1.3) * fl : 0)) * dt;
      this.rot[i] += this.spin[i] * dt;
      pos[w * 3] = this.px[i];
      pos[w * 3 + 1] = this.py[i];
      pos[w * 3 + 2] = this.pz[i];
      const fadeIn = Math.min(1, t * 8);
      col[w * 4] = this.col[i * 3];
      col[w * 4 + 1] = this.col[i * 3 + 1];
      col[w * 4 + 2] = this.col[i * 3 + 2];
      col[w * 4 + 3] = (this.a0[i] + (this.a1[i] - this.a0[i]) * t) * fadeIn;
      siz[w * 2] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      siz[w * 2 + 1] = this.rot[i];
      w++;
    }
    this.aliveCount = w;
    this.geo.instanceCount = w;
    if (w > 0) {
      for (const a of [this.iPos, this.iCol, this.iSize]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, w * a.itemSize);
        a.needsUpdate = true;
      }
    }
  }

  clear(): void {
    for (let k = 0; k < this.aliveCount; k++) this.free.push(this.alive[k]);
    this.aliveCount = 0;
    this.geo.instanceCount = 0;
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}
