/**
 * Procedural fur rendering.
 *
 * - Base skin: Lambert with vertex-colour coat pattern, strand
 *   modulation and a soft rim/sheen term.
 * - Shells (Lambert, cheap): the skinned geometry drawn N times in ONE
 *   instanced draw call; each instance (gl_InstanceID) is pushed out along the
 *   skinned normal and combed along a skinned tangent, then alpha-cut by a
 *   strand pattern.
 *
 * Strand/clump patterns come from a small tileable 3D noise texture (one
 * trilinear fetch) instead of procedural noise, because shell fragments are
 * by far the most numerous in the scene.
 */
import * as THREE from 'three';
import { globalUniforms } from '../render/Uniforms';
import { hash1 } from '../utils/math';

export interface FurUniforms {
  uShells: { value: number };
  uFurScale: { value: number };
  uWetness: { value: number };
  uBlink: { value: number };
}

let furNoise: THREE.Data3DTexture | null = null;

/**
 * 32^3 tileable noise. R: per-voxel random (fine strands after trilinear
 * filtering), G: smooth value noise with an 8-voxel lattice (clumps).
 */
export function getFurNoise(): THREE.Data3DTexture {
  if (furNoise) return furNoise;
  const N = 32;
  const data = new Uint8Array(N * N * N * 4);
  const L = 8;
  const lattice = (i: number, j: number, k: number): number => hash1(((i % L) + L) % L + ((((j % L) + L) % L) << 4) + ((((k % L) + L) % L) << 8) + 977);
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const k = (x + N * (y + N * z)) * 4;
        data[k] = Math.floor(hash1(x + y * 37 + z * 1371) * 255);
        const fx = (x / N) * L;
        const fy = (y / N) * L;
        const fz = (z / N) * L;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const iz = Math.floor(fz);
        const ux = smooth(fx - ix);
        const uy = smooth(fy - iy);
        const uz = smooth(fz - iz);
        let v = 0;
        for (let c = 0; c < 8; c++) {
          const dx = c & 1;
          const dy = (c >> 1) & 1;
          const dz = (c >> 2) & 1;
          v += lattice(ix + dx, iy + dy, iz + dz) * (dx ? ux : 1 - ux) * (dy ? uy : 1 - uy) * (dz ? uz : 1 - uz);
        }
        data[k + 1] = Math.floor(v * 255);
        data[k + 2] = Math.floor(hash1(x * 13 + y * 7 + z * 101 + 5) * 255);
        data[k + 3] = 255;
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  furNoise = tex;
  return tex;
}

export function disposeFurNoise(): void {
  furNoise?.dispose();
  furNoise = null;
}

const NOISE_PARS = /* glsl */ `
uniform highp sampler3D uFurNoise;
`;

export function createSkinMaterial(opts: { strandScale?: number; sheen?: number }): THREE.MeshLambertMaterial {
  // Lambert + hand-made sheen: fur is not glossy and this is far cheaper than PBR.
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const scale = (opts.strandScale ?? 5).toFixed(2);
  const sheen = (opts.sheen ?? 0.35).toFixed(3);
  const noise = getFurNoise();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSunColor = globalUniforms.uSunColor;
    shader.uniforms.uFurNoise = { value: noise };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float furLen;\nvarying vec3 vRest;\nvarying float vFurLen;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvRest = position;\nvFurLen = furLen;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRest;\nvarying float vFurLen;\nuniform vec3 uSunColor;\n${NOISE_PARS}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 nz = texture(uFurNoise, vRest * ${scale}).rg;
          float strand = nz.r * 0.6 + nz.g * 0.4;
          float furAmt = clamp(vFurLen * 40.0, 0.0, 1.0);
          diffuseColor.rgb *= mix(1.0, 0.75 + 0.45 * strand, furAmt);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float ndv = clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
          float rim = pow(1.0 - ndv, 3.0) * clamp(vFurLen * 30.0, 0.0, 1.0);
          totalEmissiveRadiance += diffuseColor.rgb * uSunColor * rim * ${sheen};
        }`,
      );
  };
  mat.customProgramCacheKey = () => `fur-skin-${scale}-${sheen}`;
  return mat;
}

/**
 * Shell material. Geometry must be an InstancedBufferGeometry whose
 * instanceCount equals the shell count.
 */
export function createShellMaterial(shells: number, fu: FurUniforms, opts: { strandScale?: number }): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const sf = (opts.strandScale ?? 10).toFixed(2);
  const noise = getFurNoise();
  fu.uShells.value = shells;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uShells = fu.uShells;
    shader.uniforms.uFurScale = fu.uFurScale;
    shader.uniforms.uWetness = fu.uWetness;
    shader.uniforms.uSunColor = globalUniforms.uSunColor;
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.uniforms.uWindStrength = globalUniforms.uWindStrength;
    shader.uniforms.uFurNoise = { value: noise };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float furLen;
        attribute vec3 comb;
        uniform float uShells;
        uniform float uFurScale;
        uniform float uWetness;
        uniform float uTime;
        uniform float uWindStrength;
        varying vec3 vRest;
        varying float vShell;
        varying float vFurLen;`,
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvRest = position;`)
      .replace(
        '#include <skinning_vertex>',
        `#include <skinning_vertex>
        {
          float sh = (float(gl_InstanceID) + 1.0) / uShells;
          vShell = sh;
          float len = furLen * uFurScale * (1.0 - uWetness * 0.55);
          vFurLen = len;
          vec3 combDir = comb;
          #ifdef USE_SKINNING
            combDir = (skinMatrix * vec4(comb, 0.0)).xyz;
          #endif
          vec3 n = normalize(objectNormal);
          float flutter = sin(uTime * 7.0 + position.x * 40.0 + position.z * 31.0) * 0.12 * uWindStrength;
          transformed += n * len * sh;
          transformed += normalize(combDir + vec3(0.0, -0.25 - uWetness * 0.6, 0.0)) * len * sh * sh * (0.55 + flutter);
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vRest;
        varying float vShell;
        varying float vFurLen;
        uniform float uWetness;
        uniform vec3 uSunColor;
        ${NOISE_PARS}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        {
          if (vFurLen < 0.0015) discard;
          vec3 nz = texture(uFurNoise, vRest * ${sf}).rgb;
          // clumps (G) modulate fine strands (R); B jitters strand length
          float s = nz.r * 0.55 + nz.g * 0.45;
          float far = smoothstep(4.0, 16.0, length(vViewPosition));
          if (s < vShell * (0.8 + nz.b * 0.2) + 0.12 + far * 0.35) discard;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float ao = mix(0.5, 1.08, vShell);
          diffuseColor.rgb *= ao;
          float tip = smoothstep(0.7, 1.0, vShell) * clamp(vFurLen * 22.0, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.55, tip * 0.6);
          diffuseColor.rgb *= 1.0 - uWetness * 0.35;
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float ndv = clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
          float rim = pow(1.0 - ndv, 2.5) * vShell;
          totalEmissiveRadiance += diffuseColor.rgb * uSunColor * rim * 0.35;
        }`,
      );
  };
  mat.customProgramCacheKey = () => `fur-shell-${sf}`;
  return mat;
}

/** Eye: amber iris, black pupil (vertex coloured sphere looking down +Z). */
export function createEyeGeometry(radius: number, iris: THREE.Color): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(radius, 16, 12);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const t = v.z;
    if (t > 0.86) c.setRGB(0.01, 0.01, 0.01);
    else if (t > 0.45) c.copy(iris).multiplyScalar(0.7 + (t - 0.45) * 0.8);
    else c.setRGB(0.06, 0.04, 0.03);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}
