/**
 * Weather: drives cloud cover, rain, wetness, wind gusts and lightning.
 * Rain is a GPU streak field wrapped around the camera (like the grass), so
 * it costs one draw call and no CPU work per drop.
 */
import * as THREE from 'three';
import { globalUniforms } from '../render/Uniforms';
import { events } from '../core/Events';
import type { WeatherMode } from '../core/Settings';
import { Random } from '../utils/Random';
import { clamp01, damp, lerp } from '../utils/math';
import type { DayNight } from './DayNight';

type Phase = 'clear' | 'cloudy' | 'rain' | 'clearing';

export class Weather {
  readonly rainMesh: THREE.Mesh;
  private rainGeo: THREE.InstancedBufferGeometry;
  private rainMat: THREE.ShaderMaterial;
  private rnd = new Random(99);
  phase: Phase = 'clear';
  private phaseT = 90;
  /** Smoothed 0..1 values. */
  rain = 0;
  cloud = 0.3;
  wind = 0.45;
  wetness = 0;
  private windTarget = 0.45;
  private gustT = 0;
  private lightningT = 12;
  private flash = 0;
  mode: WeatherMode = 'auto';
  enabled = true;
  private readonly maxDrops = 7000;

  constructor(private dayNight: DayNight) {
    const quad = new THREE.PlaneGeometry(0.018, 0.65);
    this.rainGeo = new THREE.InstancedBufferGeometry();
    this.rainGeo.index = quad.index;
    this.rainGeo.setAttribute('position', quad.attributes.position);
    this.rainGeo.setAttribute('uv', quad.attributes.uv);
    const offs = new Float32Array(this.maxDrops * 4);
    for (let i = 0; i < this.maxDrops; i++) {
      offs[i * 4] = (this.rnd.next() * 2 - 1) * 22;
      offs[i * 4 + 1] = this.rnd.next() * 20;
      offs[i * 4 + 2] = (this.rnd.next() * 2 - 1) * 22;
      offs[i * 4 + 3] = this.rnd.next();
    }
    this.rainGeo.setAttribute('aDrop', new THREE.InstancedBufferAttribute(offs, 4));
    this.rainGeo.instanceCount = 0;
    this.rainMat = new THREE.ShaderMaterial({
      name: 'RainMaterial',
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: globalUniforms.uTime,
        uCam: globalUniforms.uCameraPos,
        uWindDir: globalUniforms.uWindDir,
        uWind: { value: 0 },
        uLight: { value: new THREE.Color(1, 1, 1) },
        uIntensity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aDrop;
        uniform float uTime;
        uniform vec3 uCam;
        uniform vec2 uWindDir;
        uniform float uWind;
        varying float vA;
        varying vec2 vUv;
        void main() {
          const float R = 22.0;
          const float H = 20.0;
          float fall = 9.0 + aDrop.w * 3.0;
          vec3 p;
          p.xz = uCam.xz + mod(aDrop.xz - uCam.xz + R, 2.0 * R) - R;
          p.y = uCam.y - H * 0.4 + mod(aDrop.y - uTime * fall, H);
          vec2 slant = uWindDir * uWind * 3.0;
          p.xz += slant * (p.y - uCam.y) * 0.1;
          // billboard around the vertical (streak) axis
          vec3 toCam = normalize(vec3(uCam.x - p.x, 0.0, uCam.z - p.z));
          vec3 side = vec3(toCam.z, 0.0, -toCam.x); // quad faces the camera (CCW)
          vec3 dir = normalize(vec3(-slant.x * 0.3, -1.0, -slant.y * 0.3));
          vec3 world = p + side * position.x + dir * -position.y;
          vA = (1.0 - smoothstep(R * 0.5, R, length(p.xz - uCam.xz))) * (0.35 + aDrop.w * 0.4);
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uLight;
        uniform float uIntensity;
        varying float vA;
        varying vec2 vUv;
        void main() {
          float a = vA * smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y)) * uIntensity;
          gl_FragColor = vec4(uLight, a * 0.8);
          #include <colorspace_fragment>
        }
      `,
    });
    this.rainMesh = new THREE.Mesh(this.rainGeo, this.rainMat);
    this.rainMesh.name = 'rain';
    this.rainMesh.frustumCulled = false;
    this.rainMesh.renderOrder = 6;
  }

  setMode(m: WeatherMode): void {
    this.mode = m;
    if (m === 'rain') this.startPhase('rain');
    if (m === 'clear') this.startPhase('clear');
  }

  private startPhase(p: Phase): void {
    this.phase = p;
    switch (p) {
      case 'clear':
        this.phaseT = 120 + this.rnd.next() * 120;
        break;
      case 'cloudy':
        this.phaseT = 25 + this.rnd.next() * 20;
        break;
      case 'rain':
        this.phaseT = 70 + this.rnd.next() * 60;
        this.lightningT = 6 + this.rnd.next() * 8;
        break;
      case 'clearing':
        this.phaseT = 30;
        break;
    }
  }

  update(dt: number): void {
    // Phase machine (auto mode cycles; forced modes hold).
    if (this.mode === 'auto' && this.enabled) {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        const next: Record<Phase, Phase> = { clear: 'cloudy', cloudy: 'rain', rain: 'clearing', clearing: 'clear' };
        this.startPhase(next[this.phase]);
      }
    }
    let cloudT = 0.3;
    let rainT = 0;
    const phase = this.enabled ? (this.mode === 'auto' ? this.phase : this.mode === 'rain' ? 'rain' : 'clear') : 'clear';
    switch (phase) {
      case 'clear':
        cloudT = 0.28;
        break;
      case 'cloudy':
        cloudT = 0.75;
        rainT = 0;
        break;
      case 'rain':
        cloudT = 0.95;
        rainT = 1;
        break;
      case 'clearing':
        cloudT = 0.55;
        break;
    }
    this.cloud = damp(this.cloud, cloudT, 0.12, dt);
    this.rain = damp(this.rain, rainT, rainT > this.rain ? 0.12 : 0.2, dt);
    this.wetness = clamp01(this.wetness + (this.rain > 0.3 ? dt * 0.03 * this.rain : -dt * 0.008));
    // Wind gusts.
    this.gustT -= dt;
    if (this.gustT <= 0) {
      this.gustT = 3 + this.rnd.next() * 6;
      this.windTarget = 0.3 + this.rnd.next() * 0.35 + this.rain * 0.45;
      const a = Math.atan2(globalUniforms.uWindDir.value.y, globalUniforms.uWindDir.value.x) + (this.rnd.next() - 0.5) * 0.4;
      globalUniforms.uWindDir.value.set(Math.cos(a), Math.sin(a));
    }
    this.wind = damp(this.wind, this.windTarget, 0.6, dt);
    // Lightning in heavy rain.
    this.flash = Math.max(0, this.flash - dt * 5);
    if (this.rain > 0.75) {
      this.lightningT -= dt;
      if (this.lightningT <= 0) {
        this.lightningT = 8 + this.rnd.next() * 14;
        this.flash = 1;
        events.emit('lightning', { intensity: 0.6 + this.rnd.next() * 0.4, delay: 0.6 + this.rnd.next() * 2.5 });
      }
    }
    const flicker = this.flash > 0 ? this.flash * (0.6 + 0.4 * Math.sin(this.flash * 40)) : 0;

    // Push to shared state.
    globalUniforms.uCloudCover.value = this.cloud;
    globalUniforms.uWetness.value = this.wetness;
    globalUniforms.uWindStrength.value = this.wind;
    globalUniforms.uLightning.value = flicker;
    this.dayNight.overcast = clamp01((this.cloud - 0.3) / 0.65);
    this.dayNight.rain = this.rain;
    const drops = Math.floor(this.maxDrops * clamp01(this.rain * 1.2 - 0.05));
    this.rainGeo.instanceCount = drops;
    this.rainMesh.visible = drops > 0;
    this.rainMat.uniforms.uIntensity.value = this.rain;
    this.rainMat.uniforms.uWind.value = this.wind;
    const amb = lerp(0.25, 0.85, 1 - this.dayNight.night);
    this.rainMat.uniforms.uLight.value.setRGB(0.85 * amb, 0.9 * amb, 1.0 * amb);
  }

  /** Extra light added by lightning (for the hemisphere light). */
  get lightningBoost(): number {
    return globalUniforms.uLightning.value;
  }

  describe(): string {
    if (this.rain > 0.6) return this.flash > 0 || this.lightningT < 3 ? 'Thunderstorm' : 'Rain';
    if (this.rain > 0.15) return 'Light rain';
    if (this.cloud > 0.6) return 'Overcast';
    if (this.cloud > 0.45) return 'Cloudy';
    return 'Clear';
  }

  dispose(): void {
    this.rainGeo.dispose();
    this.rainMat.dispose();
  }
}
