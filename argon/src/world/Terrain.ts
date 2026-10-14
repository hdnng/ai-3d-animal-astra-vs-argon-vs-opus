import * as THREE from 'three';
import { NoiseGenerator } from '../utils/noise';
import { clamp, lerp, smoothstep } from '../utils/math';

/**
 * Procedural Multi-Octave Alpine Valley Terrain
 * Features a meandering river and central lake basin, fertile grassy meadows,
 * rocky slopes, and snow-dusted mountain ridges.
 */
export class Terrain {
  public mesh: THREE.Mesh;
  public geometry: THREE.BufferGeometry;
  public material: THREE.MeshStandardMaterial;
  public readonly size = 240;
  public readonly segments = 128;
  public readonly waterLevel = -0.65;

  private noise: NoiseGenerator;
  public shorelinePoints: THREE.Vector3[] = [];

  constructor(scene: THREE.Scene, seed = 104729) {
    this.noise = new NoiseGenerator(seed);

    this.geometry = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    this.geometry.rotateX(-Math.PI / 2);

    const posAttr = this.geometry.attributes.position as THREE.BufferAttribute;
    const count = posAttr.count;
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      const y = this.getHeightAt(x, z);
      posAttr.setY(i, y);
    }

    this.geometry.computeVertexNormals();
    const normAttr = this.geometry.attributes.normal as THREE.BufferAttribute;

    // Procedural Biome & Slope Vertex Coloring
    for (let i = 0; i < count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const z = posAttr.getZ(i);
      const ny = normAttr.getY(i);
      const slope = 1.0 - clamp(ny, 0, 1);

      const detail = this.noise.fbm2D(x * 0.08, z * 0.08, 3);

      // Base biome colors
      const colSand = { r: 0.36, g: 0.33, b: 0.27 };
      const colLushGrass = { r: 0.17, g: 0.33, b: 0.16 };
      const colDryMeadow = { r: 0.26, g: 0.35, b: 0.18 };
      const colRock = { r: 0.30, g: 0.31, b: 0.34 };
      const colSnow = { r: 0.88, g: 0.91, b: 0.95 };

      let r = colLushGrass.r;
      let g = colLushGrass.g;
      let b = colLushGrass.b;

      // Blend lush grass with dry meadow variation
      const meadowMix = clamp(detail * 0.5 + 0.5, 0, 1);
      r = lerp(colLushGrass.r, colDryMeadow.r, meadowMix);
      g = lerp(colLushGrass.g, colDryMeadow.g, meadowMix);
      b = lerp(colLushGrass.b, colDryMeadow.b, meadowMix);

      // Riverbank pebbles/sand near water level
      if (y < this.waterLevel + 0.45) {
        const shoreFactor = smoothstep(this.waterLevel + 0.45, this.waterLevel - 0.15, y);
        r = lerp(r, colSand.r, shoreFactor);
        g = lerp(g, colSand.g, shoreFactor);
        b = lerp(b, colSand.b, shoreFactor);
      }

      // Steep rocky cliffs
      const rockFactor = smoothstep(0.16, 0.38, slope + detail * 0.06);
      r = lerp(r, colRock.r, rockFactor);
      g = lerp(g, colRock.g, rockFactor);
      b = lerp(b, colRock.b, rockFactor);

      // High alpine snow caps
      if (y > 9.5) {
        const snowFactor = smoothstep(9.5, 14.5, y - detail * 1.5) * (1.0 - rockFactor * 0.6);
        r = lerp(r, colSnow.r, snowFactor);
        g = lerp(g, colSnow.g, snowFactor);
        b = lerp(b, colSnow.b, snowFactor);
      }

      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Custom micro-detail shader on terrain
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.02
    });

    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
         varying vec3 vTerrainWorldPos;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vTerrainWorldPos = position;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
         varying vec3 vTerrainWorldPos;
         float tHash(vec2 p) {
           return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
         }
         float tNoise(vec2 p) {
           vec2 i = floor(p);
           vec2 f = fract(p);
           f = f * f * (3.0 - 2.0 * f);
           return mix(
             mix(tHash(i), tHash(i + vec2(1.0, 0.0)), f.x),
             mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), f.x),
             f.y
           );
         }`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float micro1 = tNoise(vTerrainWorldPos.xz * 2.5);
         float micro2 = tNoise(vTerrainWorldPos.xz * 14.0);
         diffuseColor.rgb *= mix(0.86, 1.14, micro1 * 0.6 + micro2 * 0.4);`
      );
    };

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    scene.add(this.mesh);

    this.precomputeShorelinePoints();
  }

  /**
   * Continuous analytical/noise height function used by both terrain mesh generation
   * and exact per-paw IK placement so feet never float or sink.
   */
  getHeightAt(x: number, z: number): number {
    // 1. Meandering river channel along X with a central lake basin near (-14, -10)
    const riverMeanderZ = Math.sin(x * 0.032) * 14.0 + Math.cos(x * 0.015) * 6.0 - 12.0;
    const distToRiver = Math.abs(z - riverMeanderZ);
    const riverWidth = 7.5 + Math.sin(x * 0.05) * 2.0;

    // Central lake widening
    const lakeDx = x + 10.0;
    const lakeDz = z + 12.0;
    const distToLake = Math.hypot(lakeDx * 0.8, lakeDz * 1.1);

    const riverCarve = smoothstep(riverWidth + 8.0, riverWidth * 0.45, distToRiver) * 2.4;
    const lakeCarve = smoothstep(24.0, 9.0, distToLake) * 2.6;
    const waterCarve = Math.max(riverCarve, lakeCarve);

    // 2. Multi-octave rolling hills & valley floor
    const baseHills = this.noise.fbm2D(x * 0.014, z * 0.014, 5, 2.05, 0.5) * 4.5;
    const microUndulation = this.noise.fbm2D(x * 0.055, z * 0.055, 3, 2.0, 0.45) * 0.55;

    // 3. Surrounding mountain amphitheater ring outside radius 58m
    const radialDist = Math.hypot(x, z);
    const perimeterFactor = smoothstep(48.0, 115.0, radialDist);
    const mountainRidges = this.noise.ridged2D(x * 0.018 + 3.1, z * 0.018 - 1.7, 4) * 18.5 * perimeterFactor;

    // Keep central spawn meadow around (0, 8) gently sloped and walkable
    const spawnDist = Math.hypot(x - 0, z - 8);
    const spawnFlatten = smoothstep(3.0, 18.0, spawnDist);

    const rawHeight = (baseHills + microUndulation) * (0.35 + 0.65 * spawnFlatten) + mountainRidges + 0.45;
    return rawHeight - waterCarve;
  }

  private precomputeShorelinePoints(): void {
    for (let x = -70; x <= 70; x += 6) {
      for (let z = -60; z <= 40; z += 6) {
        const h = this.getHeightAt(x, z);
        if (h >= this.waterLevel - 0.05 && h <= this.waterLevel + 0.28) {
          this.shorelinePoints.push(new THREE.Vector3(x, h, z));
        }
      }
    }
    if (this.shorelinePoints.length === 0) {
      this.shorelinePoints.push(new THREE.Vector3(0, this.waterLevel, -5));
    }
  }

  getNearestShoreline(pos: THREE.Vector3): THREE.Vector3 {
    let best = this.shorelinePoints[0];
    let bestDistSq = Infinity;
    for (const pt of this.shorelinePoints) {
      const dSq = (pt.x - pos.x) ** 2 + (pt.z - pos.z) ** 2;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = pt;
      }
    }
    return best;
  }
}
