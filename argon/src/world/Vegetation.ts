import * as THREE from 'three';
import { Terrain } from './Terrain';
import { SeededRandom } from '../utils/noise';
import { ObstacleCollider } from '../animal/WolfEntity';

export interface FoodSite {
  position: THREE.Vector3;
  type: 'carcass' | 'berries';
  nutrition: number;
}

/**
 * Instanced Procedural Flora & Geology
 * Generates instanced pine trees, birch trees, rocks, bushes, wildflowers,
 * and wind-animated grass clusters with upward-blended normals for lush lighting.
 */
export class VegetationManager {
  public obstacles: ObstacleCollider[] = [];
  public foodSites: FoodSite[] = [];

  private windTimeUniform = { value: 0 };
  private group = new THREE.Group();

  constructor(scene: THREE.Scene, terrain: Terrain, seed = 918273) {
    const rng = new SeededRandom(seed);
    scene.add(this.group);

    this.buildTreesAndRocks(terrain, rng);
    this.buildBushesAndFlowers(terrain, rng);
    this.buildInstancedGrass(terrain, rng);
    this.buildFoodSites(terrain);
  }

  private injectWindShader(mat: THREE.MeshStandardMaterial, strength: number, heightPivot = 0.0): void {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = this.windTimeUniform;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
         uniform float uWindTime;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float hFactor = max(0.0, position.y - ${heightPivot.toFixed(2)});
         #ifdef USE_INSTANCING
           vec3 instWorld = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
         #else
           vec3 instWorld = vec3(0.0);
         #endif
         float wave = sin(uWindTime * 2.2 + instWorld.x * 0.18 + instWorld.z * 0.14 + position.y * 0.8);
         float gust = cos(uWindTime * 0.9 + instWorld.x * 0.07 - instWorld.z * 0.09) * 0.5 + 0.5;
         transformed.x += wave * (0.4 + 0.6 * gust) * hFactor * ${strength.toFixed(4)};
         transformed.z += cos(uWindTime * 1.8 + instWorld.z * 0.2) * hFactor * ${(strength * 0.6).toFixed(4)};`
      );
    };
  }

  private buildTreesAndRocks(terrain: Terrain, rng: SeededRandom): void {
    const pineCount = 180;
    const birchCount = 70;
    const rockCount = 130;

    // 1. Pine Trunk + 3-Tier Needles Geometry
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.28, 2.2, 6);
    trunkGeo.translate(0, 1.1, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3525, roughness: 0.92 });

    const cone1 = new THREE.ConeGeometry(1.55, 2.5, 7);
    cone1.translate(0, 2.6, 0);
    const cone2 = new THREE.ConeGeometry(1.22, 2.2, 7);
    cone2.translate(0, 4.0, 0);
    const cone3 = new THREE.ConeGeometry(0.82, 1.8, 7);
    cone3.translate(0, 5.2, 0);
    const pineLeavesGeo = this.mergeGeometries([cone1, cone2, cone3]);
    const pineLeavesMat = new THREE.MeshStandardMaterial({
      color: 0x265432,
      roughness: 0.84,
      flatShading: true
    });
    this.injectWindShader(pineLeavesMat, 0.045, 1.2);

    const pineTrunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, pineCount);
    const pineLeavesInst = new THREE.InstancedMesh(pineLeavesGeo, pineLeavesMat, pineCount);
    pineTrunkInst.castShadow = true;
    pineTrunkInst.receiveShadow = true;
    pineLeavesInst.castShadow = true;
    pineLeavesInst.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let placedPines = 0;

    for (let attempt = 0; attempt < 1200 && placedPines < pineCount; attempt++) {
      const x = rng.range(-100, 100);
      const z = rng.range(-100, 100);
      if (Math.hypot(x - 0, z - 8) < 11.0) continue;
      const y = terrain.getHeightAt(x, z);
      if (y < terrain.waterLevel + 0.55 || y > 13.5) continue;

      const scale = rng.range(0.75, 1.45);
      dummy.position.set(x, y - 0.08, z);
      dummy.rotation.set(rng.range(-0.05, 0.05), rng.range(0, Math.PI * 2), rng.range(-0.05, 0.05));
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();

      pineTrunkInst.setMatrixAt(placedPines, dummy.matrix);
      pineLeavesInst.setMatrixAt(placedPines, dummy.matrix);
      color.setHSL(0.35 + rng.range(-0.03, 0.03), 0.46, 0.22 + rng.range(-0.03, 0.04));
      pineLeavesInst.setColorAt(placedPines, color);

      this.obstacles.push({ x, z, radius: 0.35 * scale });
      placedPines++;
    }
    pineTrunkInst.count = placedPines;
    pineLeavesInst.count = placedPines;
    this.group.add(pineTrunkInst, pineLeavesInst);

    // 2. Birch / Aspen Trees
    const birchTrunkGeo = new THREE.CylinderGeometry(0.09, 0.18, 2.6, 6);
    birchTrunkGeo.translate(0, 1.3, 0);
    const birchTrunkMat = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.8 });

    const birchCrownGeo = new THREE.DodecahedronGeometry(1.35, 1);
    birchCrownGeo.scale(1.0, 1.45, 1.0);
    birchCrownGeo.translate(0, 3.6, 0);
    const birchCrownMat = new THREE.MeshStandardMaterial({
      color: 0xd4a642,
      roughness: 0.80,
      flatShading: true
    });
    this.injectWindShader(birchCrownMat, 0.06, 1.5);

    const birchTrunkInst = new THREE.InstancedMesh(birchTrunkGeo, birchTrunkMat, birchCount);
    const birchCrownInst = new THREE.InstancedMesh(birchCrownGeo, birchCrownMat, birchCount);
    birchTrunkInst.castShadow = true;
    birchCrownInst.castShadow = true;
    birchCrownInst.receiveShadow = true;

    let placedBirch = 0;
    for (let attempt = 0; attempt < 600 && placedBirch < birchCount; attempt++) {
      const x = rng.range(-88, 88);
      const z = rng.range(-88, 88);
      if (Math.hypot(x - 0, z - 8) < 11.0) continue;
      const y = terrain.getHeightAt(x, z);
      if (y < terrain.waterLevel + 0.35 || y > 6.5) continue;

      const scale = rng.range(0.75, 1.25);
      dummy.position.set(x, y - 0.05, z);
      dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();

      birchTrunkInst.setMatrixAt(placedBirch, dummy.matrix);
      birchCrownInst.setMatrixAt(placedBirch, dummy.matrix);
      color.setHSL(rng.range(0.11, 0.24), 0.62, rng.range(0.45, 0.56));
      birchCrownInst.setColorAt(placedBirch, color);

      this.obstacles.push({ x, z, radius: 0.26 * scale });
      placedBirch++;
    }
    birchTrunkInst.count = placedBirch;
    birchCrownInst.count = placedBirch;
    this.group.add(birchTrunkInst, birchCrownInst);

    // 3. Procedural Boulders & River Rocks
    const rockGeo = new THREE.DodecahedronGeometry(0.65, 1);
    const pos = rockGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      const n = 1.0 + 0.18 * Math.sin(vx * 5.0) * Math.cos(vz * 5.0);
      pos.setXYZ(i, vx * n, vy * 0.72 * n, vz * n);
    }
    rockGeo.computeVertexNormals();

    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x6c737d,
      roughness: 0.86,
      metalness: 0.05,
      flatShading: true
    });
    const rockInst = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
    rockInst.castShadow = true;
    rockInst.receiveShadow = true;

    let placedRocks = 0;
    for (let attempt = 0; attempt < 800 && placedRocks < rockCount; attempt++) {
      const x = rng.range(-95, 95);
      const z = rng.range(-95, 95);
      if (Math.hypot(x - 0, z - 8) < 8.0) continue;
      const y = terrain.getHeightAt(x, z);
      if (y < terrain.waterLevel - 0.25) continue;

      const sx = rng.range(0.5, 2.0);
      const sy = rng.range(0.45, 1.4);
      const sz = rng.range(0.5, 1.9);
      dummy.position.set(x, y + sy * 0.18 - 0.1, z);
      dummy.rotation.set(rng.range(-0.2, 0.2), rng.range(0, Math.PI * 2), rng.range(-0.2, 0.2));
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();

      rockInst.setMatrixAt(placedRocks, dummy.matrix);
      const shade = rng.range(0.82, 1.18);
      color.setRGB(0.42 * shade, 0.45 * shade, 0.49 * shade);
      rockInst.setColorAt(placedRocks, color);

      if (Math.max(sx, sz) > 0.85) {
        this.obstacles.push({ x, z, radius: Math.max(sx, sz) * 0.52 });
      }
      placedRocks++;
    }
    rockInst.count = placedRocks;
    this.group.add(rockInst);
  }

  private buildBushesAndFlowers(terrain: Terrain, rng: SeededRandom): void {
    const bushCount = 160;
    const flowerCount = 320;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    const bushGeo = new THREE.IcosahedronGeometry(0.52, 0);
    bushGeo.scale(1.2, 0.78, 1.2);
    bushGeo.translate(0, 0.32, 0);
    const bushMat = new THREE.MeshStandardMaterial({
      color: 0x356b30,
      roughness: 0.85,
      flatShading: true
    });
    this.injectWindShader(bushMat, 0.05, 0.0);

    const bushInst = new THREE.InstancedMesh(bushGeo, bushMat, bushCount);
    bushInst.castShadow = false;
    bushInst.receiveShadow = true;

    let placedBushes = 0;
    for (let i = 0; i < 600 && placedBushes < bushCount; i++) {
      const x = rng.range(-85, 85);
      const z = rng.range(-85, 85);
      if (Math.hypot(x - 0, z - 8) < 7.0) continue;
      const y = terrain.getHeightAt(x, z);
      if (y < terrain.waterLevel + 0.25 || y > 7.5) continue;

      const s = rng.range(0.6, 1.35);
      dummy.position.set(x, y - 0.04, z);
      dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      bushInst.setMatrixAt(placedBushes, dummy.matrix);
      color.setHSL(0.29 + rng.range(-0.04, 0.04), 0.48, 0.28 + rng.range(-0.04, 0.04));
      bushInst.setColorAt(placedBushes, color);
      placedBushes++;
    }
    bushInst.count = placedBushes;
    this.group.add(bushInst);

    // Multi-blossom Alpine Wildflower Geometry
    const b1 = new THREE.TetrahedronGeometry(0.06, 0);
    b1.translate(0, 0.22, 0);
    const b2 = new THREE.TetrahedronGeometry(0.05, 0);
    b2.translate(0.045, 0.18, 0.03);
    const flowerGeo = this.mergeGeometries([b1, b2]);
    this.biasNormalsUpward(flowerGeo, 0.75);

    const flowerMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.65
    });
    this.injectWindShader(flowerMat, 0.09, 0.0);

    const flowerInst = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerCount);
    let placedFlowers = 0;
    for (let i = 0; i < 1000 && placedFlowers < flowerCount; i++) {
      const x = rng.range(-70, 70);
      const z = rng.range(-70, 70);
      const y = terrain.getHeightAt(x, z);
      if (y < terrain.waterLevel + 0.35 || y > 5.0) continue;

      dummy.position.set(x, y, z);
      dummy.rotation.set(rng.range(-0.1, 0.1), rng.range(0, Math.PI * 2), rng.range(-0.1, 0.1));
      dummy.scale.setScalar(rng.range(0.75, 1.35));
      dummy.updateMatrix();
      flowerInst.setMatrixAt(placedFlowers, dummy.matrix);

      const isLupine = rng.next() < 0.58;
      if (isLupine) {
        color.setHSL(rng.range(0.71, 0.78), 0.72, rng.range(0.62, 0.74));
      } else {
        color.setHSL(rng.range(0.11, 0.15), 0.88, rng.range(0.60, 0.70));
      }
      flowerInst.setColorAt(placedFlowers, color);
      placedFlowers++;
    }
    flowerInst.count = placedFlowers;
    this.group.add(flowerInst);
  }

  private buildInstancedGrass(terrain: Terrain, rng: SeededRandom): void {
    const grassCount = 2400;

    // 3-blade organic grass tuft with upward-blended normals
    const blade1 = new THREE.ConeGeometry(0.065, 0.38, 3);
    blade1.rotateZ(0.14);
    blade1.translate(0.02, 0.18, 0);

    const blade2 = new THREE.ConeGeometry(0.06, 0.34, 3);
    blade2.rotateZ(-0.20);
    blade2.rotateY(2.1);
    blade2.translate(-0.03, 0.16, 0.02);

    const blade3 = new THREE.ConeGeometry(0.06, 0.35, 3);
    blade3.rotateZ(0.22);
    blade3.rotateY(4.2);
    blade3.translate(0.03, 0.17, -0.03);

    const tuftGeo = this.mergeGeometries([blade1, blade2, blade3]);
    this.biasNormalsUpward(tuftGeo, 0.85);

    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x4e8a38,
      roughness: 0.78
    });
    this.injectWindShader(grassMat, 0.16, 0.0);

    const grassInst = new THREE.InstancedMesh(tuftGeo, grassMat, grassCount);
    grassInst.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let placed = 0;

    for (let i = 0; i < 6000 && placed < grassCount; i++) {
      const x = rng.range(-72, 72);
      const z = rng.range(-72, 72);
      const y = terrain.getHeightAt(x, z);
      if (y < terrain.waterLevel + 0.22 || y > 5.8) continue;

      const s = rng.range(0.75, 1.45);
      dummy.position.set(x, y - 0.02, z);
      dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
      dummy.scale.set(s, s * rng.range(0.85, 1.3), s);
      dummy.updateMatrix();

      grassInst.setMatrixAt(placed, dummy.matrix);
      color.setHSL(0.25 + rng.range(-0.04, 0.05), 0.50, 0.36 + rng.range(-0.05, 0.06));
      grassInst.setColorAt(placed, color);
      placed++;
    }
    grassInst.count = placed;
    this.group.add(grassInst);
  }

  private biasNormalsUpward(geo: THREE.BufferGeometry, upWeight: number): void {
    const norm = geo.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < norm.count; i++) {
      const nx = norm.getX(i) * (1 - upWeight);
      const ny = norm.getY(i) * (1 - upWeight) + upWeight;
      const nz = norm.getZ(i) * (1 - upWeight);
      const len = Math.hypot(nx, ny, nz) || 1;
      norm.setXYZ(i, nx / len, ny / len, nz / len);
    }
    norm.needsUpdate = true;
  }

  private buildFoodSites(terrain: Terrain): void {
    const coords: Array<{ x: number; z: number; type: 'carcass' | 'berries' }> = [
      { x: 14, z: 12, type: 'carcass' },
      { x: -18, z: 15, type: 'berries' },
      { x: 22, z: -18, type: 'carcass' },
      { x: -24, z: -22, type: 'berries' }
    ];

    const meatGeos: THREE.BufferGeometry[] = [];
    const berryBushGeos: THREE.BufferGeometry[] = [];

    for (const c of coords) {
      const y = terrain.getHeightAt(c.x, c.z);
      const pos = new THREE.Vector3(c.x, y, c.z);
      this.foodSites.push({ position: pos, type: c.type, nutrition: 100 });

      if (c.type === 'carcass') {
        const core = new THREE.DodecahedronGeometry(0.32, 0);
        core.scale(1.4, 0.6, 0.9);
        core.translate(pos.x, pos.y + 0.15, pos.z);
        meatGeos.push(core);
      } else {
        const shrub = new THREE.IcosahedronGeometry(0.55, 0);
        shrub.translate(pos.x, pos.y + 0.35, pos.z);
        berryBushGeos.push(shrub);
      }
    }

    if (meatGeos.length > 0) {
      const mergedMeat = this.mergeGeometries(meatGeos);
      const meatMesh = new THREE.Mesh(
        mergedMeat,
        new THREE.MeshStandardMaterial({ color: 0x8b2e2e, roughness: 0.75, flatShading: true })
      );
      meatMesh.castShadow = true;
      this.group.add(meatMesh);
    }

    if (berryBushGeos.length > 0) {
      const mergedBerries = this.mergeGeometries(berryBushGeos);
      const berryMesh = new THREE.Mesh(
        mergedBerries,
        new THREE.MeshStandardMaterial({ color: 0x8f2430, roughness: 0.75, flatShading: true })
      );
      berryMesh.castShadow = true;
      this.group.add(berryMesh);
    }
  }

  private mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    let vertexOffset = 0;

    for (const g of geos) {
      const pos = g.attributes.position as THREE.BufferAttribute;
      const norm = g.attributes.normal as THREE.BufferAttribute;
      const idx = g.index;

      for (let i = 0; i < pos.count; i++) {
        positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
      }

      if (idx) {
        for (let i = 0; i < idx.count; i++) {
          indices.push(idx.getX(i) + vertexOffset);
        }
      } else {
        for (let i = 0; i < pos.count; i++) {
          indices.push(i + vertexOffset);
        }
      }
      vertexOffset += pos.count;
      g.dispose();
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    merged.setIndex(indices);
    return merged;
  }

  update(elapsed: number): void {
    this.windTimeUniform.value = elapsed;
  }
}
