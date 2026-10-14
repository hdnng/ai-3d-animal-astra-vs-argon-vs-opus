/**
 * Uniform objects shared by reference across many materials, so updating
 * the value once per frame updates every shader (wind, time, sun, weather).
 */
import * as THREE from 'three';

export const globalUniforms = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(0.8, 0.6).normalize() },
  uWindStrength: { value: 0.45 },
  uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
  uMoonDir: { value: new THREE.Vector3(-0.3, 0.6, -0.2).normalize() },
  uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
  uSkyZenith: { value: new THREE.Color(0.2, 0.4, 0.8) },
  uSkyHorizon: { value: new THREE.Color(0.7, 0.8, 0.9) },
  uSunGlow: { value: new THREE.Color(1, 0.7, 0.4) },
  uCloudCover: { value: 0.35 },
  uCloudColor: { value: new THREE.Color(1, 1, 1) },
  uStarVis: { value: 0 },
  uMoonPhase: { value: 0.5 },
  uNight: { value: 0 },
  uWetness: { value: 0 },
  uLightning: { value: 0 },
  uWaterLevel: { value: 0 },
  uCameraPos: { value: new THREE.Vector3() },
  /** xz + radius of up to 8 creatures pushing grass aside. */
  uInteractors: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -1000, 0)) },
};

export type GlobalUniforms = typeof globalUniforms;
