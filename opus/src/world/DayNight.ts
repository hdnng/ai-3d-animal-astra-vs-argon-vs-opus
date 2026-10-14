/**
 * Day/night cycle: moves sun and moon, drives light colors/intensities, sky
 * palette, fog and exposure. A single shadow-casting directional light is used
 * for both sun and moon (swapped while both are below/at the horizon).
 */
import * as THREE from 'three';
import { globalUniforms } from '../render/Uniforms';
import { clamp01, lerp, smoothstep } from '../utils/math';

interface SkyKey {
  e: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
  glow: THREE.Color;
}

const key = (e: number, z: number, h: number, g: number): SkyKey => ({
  e,
  zenith: new THREE.Color(z),
  horizon: new THREE.Color(h),
  glow: new THREE.Color(g),
});

/** Sky palette keyed by sun elevation (sine of the angle). */
const SKY_KEYS: SkyKey[] = [
  key(-0.4, 0x02040b, 0x060a16, 0x000000),
  key(-0.16, 0x050a1e, 0x0e1630, 0x000000),
  key(-0.06, 0x16214a, 0x4a3e66, 0x5a2a3a),
  key(0.0, 0x2e4680, 0xd27a4c, 0xff6a2a),
  key(0.08, 0x4070b0, 0xeeac78, 0xff9a4a),
  key(0.25, 0x3a74c2, 0xb4cde6, 0xffd7a0),
  key(1.0, 0x2a62bc, 0xa2c2e2, 0xfff0d6),
];

const DAY_LENGTH_SECONDS = 720; // real seconds per in-game day at time speed 1
const TILT = 0.95; // max sun elevation ~54 deg
const EAST = new THREE.Vector3(1, 0, 0.25).normalize();
const SUN_NOON = new THREE.Vector3(0, Math.sin(TILT), -Math.cos(TILT));
const MOON_NOON = new THREE.Vector3(0.15, Math.sin(TILT * 0.85), -Math.cos(TILT * 0.85)).normalize();

export class DayNight {
  /** Hours 0..24 */
  time = 16.2;
  day = 1;
  readonly sunDir = new THREE.Vector3();
  readonly moonDir = new THREE.Vector3();
  /** Sine of sun elevation. */
  sunElevation = 0;
  /** 0 = full day, 1 = deep night */
  night = 0;
  readonly mainLight: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fog: THREE.FogExp2;
  exposure = 1;
  fogDensityBase = 0.0042;
  /** Cloudiness 0..1 and rain 0..1, set by Weather. */
  overcast = 0;
  rain = 0;
  private tmpC = new THREE.Color();
  private tmpC2 = new THREE.Color();

  constructor() {
    this.mainLight = new THREE.DirectionalLight(0xffffff, 3);
    this.mainLight.name = 'celestialLight';
    this.mainLight.castShadow = true;
    this.hemi = new THREE.HemisphereLight(0xa0c0e0, 0x3a3020, 1);
    this.hemi.name = 'ambientHemi';
    this.fog = new THREE.FogExp2(0xa0b8d0, this.fogDensityBase);
  }

  /** Real-time step. `speed` scales the day length. */
  update(dt: number, speed: number): void {
    this.time += (dt * speed * 24) / DAY_LENGTH_SECONDS;
    if (this.time >= 24) {
      this.time -= 24;
      this.day++;
    }
    this.apply();
  }

  setTime(h: number): void {
    this.time = ((h % 24) + 24) % 24;
    this.apply();
  }

  /** Recomputes all derived lighting from the current time. */
  apply(): void {
    const H = (this.time / 24) * Math.PI * 2 - Math.PI; // 0 at noon
    this.sunDir.copy(EAST).multiplyScalar(-Math.sin(H)).addScaledVector(SUN_NOON, Math.cos(H));
    this.sunDir.y += 0.08;
    this.sunDir.normalize();
    const Hm = H + Math.PI * 0.93;
    this.moonDir.copy(EAST).multiplyScalar(-Math.sin(Hm)).addScaledVector(MOON_NOON, Math.cos(Hm));
    this.moonDir.y += 0.1;
    this.moonDir.normalize();

    const e = this.sunElevation = this.sunDir.y;
    this.night = 1 - smoothstep(-0.14, 0.06, e);

    // Sky palette.
    const zen = globalUniforms.uSkyZenith.value;
    const hor = globalUniforms.uSkyHorizon.value;
    const glow = globalUniforms.uSunGlow.value;
    this.samplePalette(e, zen, hor, glow);
    // Overcast desaturates toward grey.
    const oc = this.overcast;
    if (oc > 0) {
      const lum = 0.2 + 0.55 * (1 - this.night);
      this.tmpC.setRGB(lum * 0.62, lum * 0.66, lum * 0.72);
      zen.lerp(this.tmpC, oc * 0.85);
      this.tmpC.setRGB(lum * 0.78, lum * 0.8, lum * 0.84);
      hor.lerp(this.tmpC, oc * 0.85);
      glow.multiplyScalar(1 - oc * 0.85);
    }

    // Sun & moon light.
    const sunUp = smoothstep(-0.05, 0.22, e);
    const warm = 1 - smoothstep(0.02, 0.42, e);
    const sunColor = this.tmpC.setRGB(1.0, lerp(0.96, 0.58, warm), lerp(0.9, 0.32, warm));
    globalUniforms.uSunColor.value.copy(sunColor);
    const sunI = 3.4 * sunUp * (1 - oc * 0.75);
    const moonUp = smoothstep(-0.03, 0.2, this.moonDir.y);
    const moonI = 0.55 * moonUp * smoothstep(-0.02, -0.16, e) * (1 - oc * 0.7);
    const L = this.mainLight;
    if (sunI >= moonI) {
      L.position.copy(this.sunDir).multiplyScalar(100);
      L.color.copy(sunColor);
      L.intensity = sunI;
    } else {
      L.position.copy(this.moonDir).multiplyScalar(100);
      L.color.setRGB(0.62, 0.72, 1.0);
      L.intensity = moonI;
    }

    // Hemisphere ambient.
    const dayAmb = smoothstep(-0.12, 0.3, e);
    this.hemi.color.copy(hor).lerp(zen, 0.5).multiplyScalar(lerp(1.0, 0.85, dayAmb));
    this.tmpC2.setRGB(0.2, 0.26, 0.42);
    this.hemi.color.lerp(this.tmpC2, this.night * 0.6);
    this.hemi.groundColor.setRGB(lerp(0.05, 0.3, dayAmb), lerp(0.06, 0.24, dayAmb), lerp(0.09, 0.14, dayAmb));
    this.hemi.intensity = lerp(0.55, 1.25, dayAmb) * (1 + oc * 0.25);

    // Fog follows the horizon colour; morning mist & rain thicken it.
    this.fog.color.copy(hor).lerp(zen, 0.15);
    const mist = smoothstep(4.5, 6.5, this.time) * (1 - smoothstep(7.5, 10, this.time));
    this.fog.density = this.fogDensityBase * (1 + mist * 1.4 + this.rain * 1.6 + this.night * 0.2);

    // Exposure: eye adaptation lifts the night a bit.
    this.exposure = lerp(1.0, 1.85, this.night) * (1 + oc * 0.15);

    // Shared uniforms.
    globalUniforms.uSunDir.value.copy(this.sunDir);
    globalUniforms.uMoonDir.value.copy(this.moonDir);
    globalUniforms.uStarVis.value = clamp01(smoothstep(0.02, -0.2, e) * (1 - oc * 0.9));
    globalUniforms.uNight.value = this.night;
    globalUniforms.uMoonPhase.value = 0.47;
    const cloudLit = this.tmpC2.setRGB(1, 1, 1).lerp(sunColor, warm * 0.6).multiplyScalar(lerp(0.06, 1.0, dayAmb));
    globalUniforms.uCloudColor.value.copy(cloudLit).lerp(this.tmpC.setRGB(0.45, 0.47, 0.5).multiplyScalar(lerp(0.08, 1, dayAmb)), oc);
  }

  private samplePalette(e: number, zen: THREE.Color, hor: THREE.Color, glow: THREE.Color): void {
    const keys = SKY_KEYS;
    if (e <= keys[0].e) {
      zen.copy(keys[0].zenith);
      hor.copy(keys[0].horizon);
      glow.copy(keys[0].glow);
      return;
    }
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i];
      const b = keys[i + 1];
      if (e <= b.e) {
        const t = (e - a.e) / (b.e - a.e);
        zen.copy(a.zenith).lerp(b.zenith, t);
        hor.copy(a.horizon).lerp(b.horizon, t);
        glow.copy(a.glow).lerp(b.glow, t);
        return;
      }
    }
    const last = keys[keys.length - 1];
    zen.copy(last.zenith);
    hor.copy(last.horizon);
    glow.copy(last.glow);
  }

  /** Human readable clock string. */
  clock(): string {
    const h = Math.floor(this.time);
    const m = Math.floor((this.time - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  phaseName(): string {
    const t = this.time;
    if (t < 5) return 'Night';
    if (t < 7) return 'Dawn';
    if (t < 11) return 'Morning';
    if (t < 14) return 'Noon';
    if (t < 17.3) return 'Afternoon';
    if (t < 19.2) return 'Dusk';
    if (t < 21) return 'Evening';
    return 'Night';
  }
}
