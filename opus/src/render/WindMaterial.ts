/**
 * Patches standard materials (and matching shadow depth materials) with a
 * world-space wind sway driven by the per-vertex `aWind` flexibility
 * attribute. Works for instanced meshes (uniform scale + any rotation).
 */
import * as THREE from 'three';
import { globalUniforms } from './Uniforms';
import { GLSL_HASH, GLSL_NOISE, GLSL_WIND } from './shaders/common';

export interface WindOptions {
  stiffness: number;
  flutter: number;
  /** Bend away from creatures (grass-like interaction). */
  interact?: boolean;
}

function windChunk(o: WindOptions): string {
  return /* glsl */ `
    {
      vec3 instPos = vec3(0.0);
      mat3 instRot = mat3(1.0);
      float instScale2 = 1.0;
      #ifdef USE_INSTANCING
        instPos = instanceMatrix[3].xyz;
        instRot = mat3(instanceMatrix);
        instScale2 = dot(instanceMatrix[0].xyz, instanceMatrix[0].xyz);
      #endif
      vec3 wp = instPos + instRot * transformed;
      vec3 wo = windOffset(wp, aWind, ${o.stiffness.toFixed(3)});
      float fl = ${o.flutter.toFixed(3)} * aWind * uWindStrength;
      wo += vec3(sin(uTime * 7.3 + wp.x * 3.1 + wp.y * 2.3), sin(uTime * 6.1 + wp.z * 2.7) * 0.6, cos(uTime * 6.7 + wp.z * 3.3 + wp.y)) * fl * 0.03;
      transformed += transpose(instRot) * wo / instScale2;
    }
  `;
}

function patch(shader: THREE.WebGLProgramParametersWithUniforms, o: WindOptions): void {
  shader.uniforms.uTime = globalUniforms.uTime;
  shader.uniforms.uWindDir = globalUniforms.uWindDir;
  shader.uniforms.uWindStrength = globalUniforms.uWindStrength;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\nattribute float aWind;\n${GLSL_HASH}\n${GLSL_NOISE}\n${GLSL_WIND}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${windChunk(o)}`);
}

/** Applies wind to a material; returns a matching depth material for shadows. */
export function withWind<T extends THREE.Material>(material: T, o: WindOptions, key: string): { material: T; depth: THREE.MeshDepthMaterial } {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    patch(shader, o);
  };
  material.customProgramCacheKey = () => `wind-${key}`;
  const depth = new THREE.MeshDepthMaterial();
  depth.onBeforeCompile = (shader) => patch(shader, o);
  depth.customProgramCacheKey = () => `wind-depth-${key}`;
  return { material, depth };
}
