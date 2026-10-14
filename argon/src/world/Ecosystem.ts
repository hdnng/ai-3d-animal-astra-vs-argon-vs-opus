import * as THREE from 'three';
import { Terrain } from './Terrain';
import { ObstacleCollider, WolfEntity } from '../animal/WolfEntity';
import { SeededRandom } from '../utils/noise';
import { clamp, wrapAngle } from '../utils/math';

export interface HareAgent {
  position: THREE.Vector3;
  heading: number;
  speed: number;
  hopPhase: number;
  state: 'graze' | 'hop' | 'flee';
  timer: number;
}

interface TroutAgent {
  position: THREE.Vector3;
  heading: number;
  speed: number;
  phase: number;
  baseZ: number;
}

/**
 * Living Ecosystem Manager
 * Manages 3 autonomous pack companion wolves, 32 instanced fleeing mountain hares,
 * and 55 instanced swimming river trout.
 */
export class EcosystemManager {
  public packWolves: WolfEntity[] = [];
  public hares: HareAgent[] = [];
  public trout: TroutAgent[] = [];

  private hareInstancedMesh: THREE.InstancedMesh;
  private troutInstancedMesh: THREE.InstancedMesh;
  private troutTimeUniform = { value: 0 };
  private dummy = new THREE.Object3D();

  constructor(
    scene: THREE.Scene,
    private terrain: Terrain,
    seed = 551199
  ) {
    const rng = new SeededRandom(seed);

    // 1. Spawn 3 Pack Companion Wolves (Silver, Tundra, Russet coats)
    const variants: Array<'silver' | 'tundra' | 'russet'> = ['silver', 'tundra', 'russet'];
    const spawnOffsets = [
      { x: -5.5, z: 11.5 },
      { x: 6.0, z: 12.0 },
      { x: -2.0, z: 15.5 }
    ];

    for (let i = 0; i < variants.length; i++) {
      const w = new WolfEntity(scene, variants[i]);
      const sx = spawnOffsets[i].x;
      const sz = spawnOffsets[i].z;
      w.reset(sx, sz, (x, z) => this.terrain.getHeightAt(x, z));
      w.heading = rng.range(-Math.PI, Math.PI);
      this.packWolves.push(w);
    }

    // 2. Build Instanced Mountain Hares (32 agents)
    const hareCount = 32;
    const hareGeo = this.createHareGeometry();
    const hareMat = new THREE.MeshStandardMaterial({
      color: 0xb8a996,
      roughness: 0.85
    });
    this.hareInstancedMesh = new THREE.InstancedMesh(hareGeo, hareMat, hareCount);
    this.hareInstancedMesh.castShadow = true;
    this.hareInstancedMesh.receiveShadow = true;
    scene.add(this.hareInstancedMesh);

    const hareColor = new THREE.Color();
    for (let i = 0; i < hareCount; i++) {
      const pos = this.findDryMeadowSpot(rng);
      this.hares.push({
        position: pos,
        heading: rng.range(-Math.PI, Math.PI),
        speed: 0,
        hopPhase: rng.range(0, Math.PI * 2),
        state: 'graze',
        timer: rng.range(1.0, 4.5)
      });
      const shade = rng.range(0.85, 1.15);
      hareColor.setRGB(0.72 * shade, 0.66 * shade, 0.58 * shade);
      this.hareInstancedMesh.setColorAt(i, hareColor);
    }

    // 3. Build Instanced Alpine River Trout (55 agents)
    const troutCount = 55;
    const troutGeo = new THREE.ConeGeometry(0.065, 0.38, 6);
    troutGeo.rotateX(Math.PI / 2);
    troutGeo.scale(0.65, 1.0, 1.0);

    const troutMat = new THREE.MeshStandardMaterial({
      color: 0x3b7a6e,
      roughness: 0.35,
      metalness: 0.25
    });
    troutMat.onBeforeCompile = (shader) => {
      shader.uniforms.uFishTime = this.troutTimeUniform;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
         uniform float uFishTime;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           float fPhase = instanceMatrix[3][0] * 1.7 + instanceMatrix[3][2] * 1.3;
         #else
           float fPhase = 0.0;
         #endif
         float tailFactor = clamp(0.5 - position.z * 2.5, 0.0, 1.0);
         transformed.x += sin(uFishTime * 12.0 + position.z * 14.0 + fPhase) * 0.045 * tailFactor;`
      );
    };

    this.troutInstancedMesh = new THREE.InstancedMesh(troutGeo, troutMat, troutCount);
    scene.add(this.troutInstancedMesh);

    const troutColor = new THREE.Color();
    for (let i = 0; i < troutCount; i++) {
      const rx = rng.range(-75, 75);
      const riverZ = Math.sin(rx * 0.032) * 14.0 + Math.cos(rx * 0.015) * 6.0 - 12.0 + rng.range(-3.8, 3.8);
      const ry = this.terrain.waterLevel - rng.range(0.18, 0.45);
      this.trout.push({
        position: new THREE.Vector3(rx, ry, riverZ),
        heading: rng.next() < 0.5 ? Math.PI / 2 : -Math.PI / 2,
        speed: rng.range(1.2, 2.6),
        phase: rng.range(0, Math.PI * 2),
        baseZ: riverZ
      });
      troutColor.setHSL(0.45 + rng.range(-0.05, 0.05), 0.45, rng.range(0.32, 0.48));
      this.troutInstancedMesh.setColorAt(i, troutColor);
    }
  }

  private findDryMeadowSpot(rng: SeededRandom): THREE.Vector3 {
    for (let attempt = 0; attempt < 100; attempt++) {
      const x = rng.range(-68, 68);
      const z = rng.range(-68, 68);
      const y = this.terrain.getHeightAt(x, z);
      if (y > this.terrain.waterLevel + 0.5 && y < 6.0) {
        return new THREE.Vector3(x, y, z);
      }
    }
    return new THREE.Vector3(18, this.terrain.getHeightAt(18, 18), 18);
  }

  private createHareGeometry(): THREE.BufferGeometry {
    // Combine torso, head, long ears, and cotton tail into one compact BufferGeometry
    const parts: THREE.BufferGeometry[] = [];

    const body = new THREE.SphereGeometry(0.14, 8, 6);
    body.scale(0.85, 0.85, 1.35);
    body.translate(0, 0.16, 0);
    parts.push(body);

    const head = new THREE.SphereGeometry(0.085, 7, 6);
    head.scale(0.85, 0.9, 1.15);
    head.translate(0, 0.25, 0.16);
    parts.push(head);

    const earL = new THREE.ConeGeometry(0.028, 0.17, 5);
    earL.rotateX(-0.2);
    earL.rotateZ(-0.12);
    earL.translate(0.038, 0.38, 0.14);
    parts.push(earL);

    const earR = new THREE.ConeGeometry(0.028, 0.17, 5);
    earR.rotateX(-0.2);
    earR.rotateZ(0.12);
    earR.translate(-0.038, 0.38, 0.14);
    parts.push(earR);

    const tail = new THREE.SphereGeometry(0.042, 5, 5);
    tail.translate(0, 0.18, -0.19);
    parts.push(tail);

    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    let offset = 0;

    for (const p of parts) {
      const pos = p.attributes.position as THREE.BufferAttribute;
      const norm = p.attributes.normal as THREE.BufferAttribute;
      const idx = p.index;
      for (let i = 0; i < pos.count; i++) {
        positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
      }
      if (idx) {
        for (let i = 0; i < idx.count; i++) {
          indices.push(idx.getX(i) + offset);
        }
      }
      offset += pos.count;
      p.dispose();
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    merged.setIndex(indices);
    return merged;
  }

  getTotalEntityCount(): number {
    return 1 + this.packWolves.length + this.hares.length + this.trout.length;
  }

  respawnHare(hare: HareAgent): void {
    const angle = Math.random() * Math.PI * 2;
    const dist = 26 + Math.random() * 34;
    const x = clamp(Math.cos(angle) * dist, -68, 68);
    const z = clamp(Math.sin(angle) * dist, -68, 68);
    const y = Math.max(this.terrain.waterLevel + 0.5, this.terrain.getHeightAt(x, z));
    hare.position.set(x, y, z);
    hare.state = 'graze';
    hare.speed = 0;
  }

  update(
    dt: number,
    elapsed: number,
    alphaWolf: WolfEntity,
    obstacles: ObstacleCollider[],
    DummyInput: any
  ): void {
    const sampleH = (x: number, z: number) => this.terrain.getHeightAt(x, z);

    // 1. Update Pack Companion Wolves
    for (let i = 0; i < this.packWolves.length; i++) {
      const pw = this.packWolves[i];

      // Answer Alpha's howl!
      if (alphaWolf.animator.state === 'howl' && pw.animator.state !== 'howl') {
        pw.triggerSpecialAction('howl');
      } else if (pw.animator.state !== 'howl') {
        // Companion pack AI: loose flank formation around alpha with strong separation
        const flankAngle = alphaWolf.heading + (i === 0 ? 2.15 : i === 1 ? -2.15 : 3.05);
        let targetX = alphaWolf.position.x + Math.sin(flankAngle) * (6.2 + i * 2.2);
        let targetZ = alphaWolf.position.z + Math.cos(flankAngle) * (6.2 + i * 2.2);

        // Separation from Alpha and other packmates (min distance 3.2m)
        const allWolves = [alphaWolf, ...this.packWolves];
        for (const other of allWolves) {
          if (other === pw) continue;
          const ox = pw.position.x - other.position.x;
          const oz = pw.position.z - other.position.z;
          const d = Math.hypot(ox, oz);
          if (d < 3.4 && d > 0.001) {
            const push = ((3.4 - d) / 3.4) * 5.0;
            targetX += (ox / d) * push;
            targetZ += (oz / d) * push;
          }
        }

        const dx = targetX - pw.position.x;
        const dz = targetZ - pw.position.z;
        const dist = Math.hypot(dx, dz);

        if (dist > 1.8) {
          const desiredHeading = Math.atan2(dx, dz);
          const diff = wrapAngle(desiredHeading - pw.heading);
          pw.turnRate = clamp(diff * 3.0, -2.5, 2.5);
          pw.heading = wrapAngle(pw.heading + pw.turnRate * dt);
          pw.targetSpeed = dist > 10.0 ? 6.2 : 2.9;
        } else {
          pw.turnRate = 0;
          pw.targetSpeed = 0;
        }

        pw.speed += clamp(pw.targetSpeed - pw.speed, -8 * dt, 8 * dt);
        pw.lookTarget = alphaWolf.position;

        if (pw.position.y < this.terrain.waterLevel - 0.3) {
          pw.animator.setState('swim');
        } else if (pw.speed > 4.2) {
          pw.animator.setState('run');
        } else if (pw.speed > 0.25) {
          pw.animator.setState('walk');
        } else {
          pw.animator.setState('idle');
        }
      }

      pw.update(dt, DummyInput, sampleH, this.terrain.waterLevel, obstacles);
    }

    // 2. Update Instanced Mountain Hares
    for (let i = 0; i < this.hares.length; i++) {
      const h = this.hares[i];
      h.timer -= dt;

      // Check threat distance from alpha and pack wolves
      let closestWolfDist = Math.hypot(h.position.x - alphaWolf.position.x, h.position.z - alphaWolf.position.z);
      let threatX = alphaWolf.position.x;
      let threatZ = alphaWolf.position.z;

      for (const pw of this.packWolves) {
        const d = Math.hypot(h.position.x - pw.position.x, h.position.z - pw.position.z);
        if (d < closestWolfDist) {
          closestWolfDist = d;
          threatX = pw.position.x;
          threatZ = pw.position.z;
        }
      }

      if (closestWolfDist < 15.0) {
        h.state = 'flee';
        const fleeAngle = Math.atan2(h.position.x - threatX, h.position.z - threatZ) + Math.sin(elapsed * 5 + i) * 0.35;
        const diff = wrapAngle(fleeAngle - h.heading);
        h.heading = wrapAngle(h.heading + clamp(diff, -6 * dt, 6 * dt));
        h.speed = 6.8;
      } else if (h.timer <= 0) {
        if (h.state === 'graze') {
          h.state = 'hop';
          h.timer = 1.5 + (i % 4) * 0.6;
          h.heading = wrapAngle(h.heading + (Math.random() - 0.5) * 1.8);
          h.speed = 2.4;
        } else {
          h.state = 'graze';
          h.timer = 2.0 + (i % 5) * 0.8;
          h.speed = 0;
        }
      }

      if (h.speed > 0.1) {
        h.hopPhase += dt * (h.state === 'flee' ? 14.0 : 8.5);
        const nx = clamp(h.position.x + Math.sin(h.heading) * h.speed * dt, -75, 75);
        const nz = clamp(h.position.z + Math.cos(h.heading) * h.speed * dt, -75, 75);
        const ny = sampleH(nx, nz);

        // Avoid running into deep river water
        if (ny < this.terrain.waterLevel + 0.15) {
          h.heading = wrapAngle(h.heading + Math.PI * 0.75);
        } else {
          h.position.set(nx, ny, nz);
        }
      } else {
        h.position.y = sampleH(h.position.x, h.position.z);
      }

      const hopHeight = h.speed > 0.1 ? Math.abs(Math.sin(h.hopPhase)) * (h.state === 'flee' ? 0.28 : 0.14) : 0;
      const pitch = h.speed > 0.1 ? Math.cos(h.hopPhase) * 0.25 : 0;

      this.dummy.position.set(h.position.x, h.position.y + hopHeight, h.position.z);
      this.dummy.rotation.set(pitch, h.heading, 0);
      this.dummy.scale.setScalar(1.0);
      this.dummy.updateMatrix();
      this.hareInstancedMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.hareInstancedMesh.instanceMatrix.needsUpdate = true;

    // 3. Update Instanced River Trout
    this.troutTimeUniform.value = elapsed;
    for (let i = 0; i < this.trout.length; i++) {
      const f = this.trout[i];
      const dirSign = f.heading > 0 ? 1 : -1;
      f.position.x += dirSign * f.speed * dt;
      if (f.position.x > 78) {
        f.position.x = 78;
        f.heading = -Math.PI / 2;
      } else if (f.position.x < -78) {
        f.position.x = -78;
        f.heading = Math.PI / 2;
      }

      const riverCenterZ = Math.sin(f.position.x * 0.032) * 14.0 + Math.cos(f.position.x * 0.015) * 6.0 - 12.0;
      const offsetZ = Math.sin(elapsed * 1.4 + f.phase) * 2.8;
      f.position.z = riverCenterZ + offsetZ;
      f.position.y = this.terrain.waterLevel - 0.24 + Math.sin(elapsed * 2.2 + f.phase) * 0.06;

      // Tangent heading along meandering river
      const dZdx = 0.032 * Math.cos(f.position.x * 0.032) * 14.0 - 0.015 * Math.sin(f.position.x * 0.015) * 6.0;
      const flowYaw = Math.atan2(dirSign, dirSign * dZdx);

      this.dummy.position.copy(f.position);
      this.dummy.rotation.set(0, flowYaw, 0);
      this.dummy.scale.setScalar(1.0);
      this.dummy.updateMatrix();
      this.troutInstancedMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.troutInstancedMesh.instanceMatrix.needsUpdate = true;
  }
}
