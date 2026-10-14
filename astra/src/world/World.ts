import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createTerrain, heightAt, pondDistance, POND } from "./terrain";
import { random, clamp, angleDelta } from "../utils/math";
import { loft } from "../animal/geometry";
import { woodlandDetails, butterflyGeometry } from "./details";
export type Obstacle = { x: number; z: number; r: number };
type Rabbit = {
  x: number;
  z: number;
  heading: number;
  target: T.Vector2;
  timer: number;
  speed: number;
  phase: number;
};
export class World {
  group = new T.Group();
  obstacles: Obstacle[] = [];
  food: T.Vector3[] = [];
  rabbits: Rabbit[] = [];
  rabbitMesh: T.InstancedMesh;
  butterflies: T.InstancedMesh;
  butterflyAgents: { position: T.Vector3; target: T.Vector3; timer: number }[] =
    [];
  grass: T.InstancedMesh[] = [];
  leaves: T.InstancedMesh[] = [];
  timeUniform = { value: 0 };
  weather = false;
  water: T.Mesh;
  waterUniforms = { time: { value: 0 }, day: { value: 1 } };
  animalCount = 38;
  vegetationCount = 0;
  private rnd = random();
  private dummy = new T.Object3D();
  private color = new T.Color();
  private canopyNear!: T.InstancedMesh;
  private canopyFar!: T.InstancedMesh;
  private canopyMatrices!: Float32Array;
  private canopyColors!: Float32Array;
  private canopyCount = 0;
  private lodTimer = 0;
  private lodMatrix = new T.Matrix4();
  constructor() {
    const rnd = this.rnd,
      d = this.dummy;
    this.group.add(createTerrain());
    this.group.add(woodlandDetails());
    const wind = (m: T.MeshStandardMaterial, strength: number) => {
      m.onBeforeCompile = (s) => {
        s.uniforms.uTime = this.timeUniform;
        s.vertexShader = "uniform float uTime;\n" + s.vertexShader;
        s.vertexShader = s.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>\n#ifdef USE_INSTANCING\nfloat windPhase=instanceMatrix[3].x*.42+instanceMatrix[3].z*.3;transformed.x+=sin(uTime*1.6+windPhase+position.y)*${strength.toFixed(3)}*max(position.y,0.);\n#endif`,
        );
      };
      m.customProgramCacheKey = () => `wind-${strength}`;
    };
    const trunkMat = new T.MeshStandardMaterial({
      color: "#a18f72",
      roughness: 1,
    });
    const leafMat = new T.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 1,
    });
    wind(leafMat, 0.025);
    const trunk = new T.InstancedMesh(
      new T.CylinderGeometry(0.13, 0.29, 1, 7, 2),
      trunkMat,
      150,
    );
    const canopy = new T.InstancedMesh(
      new T.IcosahedronGeometry(1, 1),
      leafMat,
      750,
    );
    const branches = new T.InstancedMesh(
      new T.CylinderGeometry(0.025, 0.09, 1, 5),
      trunkMat,
      450,
    );
    let bi = 0;
    let ti = 0,
      li = 0;
    for (let i = 0; i < 150; i++) {
      const a = rnd() * Math.PI * 2,
        r = 11 + Math.sqrt(rnd()) * 31,
        x = Math.sin(a) * r,
        z = Math.cos(a) * r;
      if (pondDistance(x, z) < 1.5) continue;
      const h = heightAt(x, z),
        tall = 4 + rnd() * 4;
      this.obstacles.push({ x, z, r: 0.48 });
      d.position.set(x, h + tall * 0.5, z);
      d.rotation.set((rnd() - 0.5) * 0.1, rnd() * 6.28, (rnd() - 0.5) * 0.1);
      d.scale.set(1, tall, 1);
      d.updateMatrix();
      trunk.setMatrixAt(ti++, d.matrix);
      for (let branch = 0; branch < 3; branch++) {
        const a = branch * 2.094 + i;
        d.position.set(
          x + Math.sin(a) * 0.5,
          h + tall * 0.66 + branch * 0.28,
          z + Math.cos(a) * 0.5,
        );
        d.quaternion.setFromUnitVectors(
          new T.Vector3(0, 1, 0),
          new T.Vector3(Math.sin(a), 1.2, Math.cos(a)).normalize(),
        );
        d.scale.set(1, 1.8, 1);
        d.updateMatrix();
        branches.setMatrixAt(bi++, d.matrix);
      }
      for (let k = 0; k < 5; k++) {
        d.position.set(
          x + (rnd() - 0.5) * 2.9,
          h + tall - 0.5 + rnd() * 1.5,
          z + (rnd() - 0.5) * 2.9,
        );
        d.rotation.set(rnd(), rnd() * 6, rnd());
        const s = 1.3 + rnd() * 1.1;
        d.scale.set(s, s * (0.65 + rnd() * 0.4), s);
        d.updateMatrix();
        canopy.setMatrixAt(li, d.matrix);
        this.color.setHSL(
          0.19 + rnd() * 0.09,
          0.22 + rnd() * 0.18,
          0.27 + rnd() * 0.15,
        );
        canopy.setColorAt(li++, this.color);
      }
    }
    trunk.count = ti;
    branches.count = bi;
    canopy.count = li;
    trunk.castShadow = canopy.castShadow = true;
    trunk.receiveShadow = canopy.receiveShadow = true;
    trunk.computeBoundingSphere();
    canopy.computeBoundingSphere();
    this.group.add(trunk, canopy, branches);
    this.leaves.push(canopy);
    this.canopyNear = canopy;
    this.canopyCount = li;
    this.canopyMatrices = new Float32Array(canopy.instanceMatrix.array);
    this.canopyColors = new Float32Array(canopy.instanceColor!.array);
    this.canopyFar = new T.InstancedMesh(
      new T.IcosahedronGeometry(1, 0),
      leafMat,
      750,
    );
    this.canopyFar.count = 0;
    this.group.add(this.canopyFar);
    this.vegetationCount += ti;
    const rock = new T.InstancedMesh(
      new T.IcosahedronGeometry(1, 1),
      new T.MeshStandardMaterial({
        color: "#ffffff",
        roughness: 1,
        flatShading: true,
      }),
      70,
    );
    for (let i = 0; i < 70; i++) {
      const a = rnd() * 6.28,
        r = 4 + rnd() * 33,
        x = Math.sin(a) * r,
        z = Math.cos(a) * r;
      if (pondDistance(x, z) < 1.05) {
        d.scale.setScalar(0);
        d.updateMatrix();
        rock.setMatrixAt(i, d.matrix);
        continue;
      }
      const s = 0.28 + rnd() * 0.85;
      d.position.set(x, heightAt(x, z) + s * 0.23, z);
      d.rotation.set(rnd(), rnd() * 6, rnd());
      d.scale.set(s * 1.5, s * 0.8, s);
      d.updateMatrix();
      rock.setMatrixAt(i, d.matrix);
      this.obstacles.push({ x, z, r: s * 1.3 });
      this.color.setHSL(0.13, 0.06, 0.27 + rnd() * 0.18);
      rock.setColorAt(i, this.color);
    }
    rock.castShadow = rock.receiveShadow = true;
    this.group.add(rock);
    // Spatially tiled instances retain frustum culling, and distant grass uses distance LOD.
    const blade = new T.BufferGeometry();
    blade.setAttribute(
      "position",
      new T.Float32BufferAttribute(
        [
          -0.035, 0, 0, 0.035, 0, 0, -0.025, 0.3, 0.025, 0.025, 0.3, 0.025, 0,
          0.58, 0.11,
        ],
        3,
      ),
    );
    blade.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
    blade.computeVertexNormals();
    const gm = new T.MeshStandardMaterial({
      color: "#ffffff",
      side: T.DoubleSide,
      roughness: 1,
    });
    wind(gm, 0.18);
    for (let cx = -2; cx <= 2; cx++)
      for (let cz = -2; cz <= 2; cz++) {
        const g = new T.InstancedMesh(blade, gm, 850);
        let n = 0;
        for (let i = 0; i < 850; i++) {
          const x = cx * 16 + (rnd() - 0.5) * 16,
            z = cz * 16 + (rnd() - 0.5) * 16;
          if (pondDistance(x, z) < 1.2 || Math.hypot(x + 3, z - 3) < 1.8)
            continue;
          d.position.set(x, heightAt(x, z) - 0.025, z);
          d.rotation.set(0, rnd() * 6.28, 0);
          const s = 0.3 + rnd() * 0.55;
          d.scale.set(s, s, s);
          d.updateMatrix();
          g.setMatrixAt(n, d.matrix);
          this.color.setHSL(
            0.18 + rnd() * 0.07,
            0.25 + rnd() * 0.15,
            0.25 + rnd() * 0.12,
          );
          g.setColorAt(n++, this.color);
        }
        g.count = n;
        g.userData.fullCount = n;
        g.receiveShadow = true;
        g.computeBoundingSphere();
        this.grass.push(g);
        this.group.add(g);
        this.vegetationCount += n;
      }
    const bush = new T.InstancedMesh(
      new T.IcosahedronGeometry(1, 1),
      new T.MeshStandardMaterial({ color: "#4e6943", roughness: 1 }),
      70,
    );
    const berries = new T.InstancedMesh(
      new T.SphereGeometry(0.055, 5, 4),
      new T.MeshStandardMaterial({ color: "#c16558", roughness: 0.55 }),
      280,
    );
    for (let i = 0; i < 70; i++) {
      let x = (rnd() - 0.5) * 60,
        z = (rnd() - 0.5) * 60;
      if (i < 5) {
        x = -7 + i * 2;
        z = -3;
      }
      if (pondDistance(x, z) < 1.4) {
        x -= 10;
      }
      const y = heightAt(x, z),
        s = 0.3 + rnd() * 0.35;
      d.position.set(x, y + s * 0.6, z);
      d.rotation.set(rnd(), rnd(), rnd());
      d.scale.set(s * 1.3, s, s);
      d.updateMatrix();
      bush.setMatrixAt(i, d.matrix);
      if (i < 16) this.food.push(new T.Vector3(x, y, z));
      for (let j = 0; j < 4; j++) {
        d.position.set(
          x + (rnd() - 0.5) * s,
          y + s * (0.8 + rnd() * 0.4),
          z + s * 0.5,
        );
        d.scale.setScalar(1);
        d.updateMatrix();
        berries.setMatrixAt(i * 4 + j, d.matrix);
      }
    }
    bush.castShadow = true;
    this.group.add(bush, berries);
    this.vegetationCount += 70;
    const flowerG = mergeGeometries([
      new T.CylinderGeometry(0.012, 0.015, 0.22, 4).translate(0, 0.11, 0),
      new T.SphereGeometry(0.075, 5, 3).scale(1, 0.35, 1).translate(0, 0.25, 0),
    ])!;
    const flowers = new T.InstancedMesh(
      flowerG,
      new T.MeshStandardMaterial({ color: "#e3d7a5", roughness: 0.9 }),
      500,
    );
    for (let i = 0; i < 500; i++) {
      const x = (rnd() - 0.5) * 60,
        z = (rnd() - 0.5) * 60;
      d.position.set(x, heightAt(x, z), z);
      d.rotation.set(0, rnd() * 6, 0);
      d.scale.setScalar(pondDistance(x, z) > 1.25 ? 0.6 + rnd() : 0);
      d.updateMatrix();
      flowers.setMatrixAt(i, d.matrix);
      flowers.setColorAt(
        i,
        this.color.set(i % 3 === 0 ? "#b7a5c8" : "#e9d89c"),
      );
    }
    this.group.add(flowers);
    this.vegetationCount += 500;
    this.water = new T.Mesh(
      new T.CircleGeometry(1, 96),
      new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        uniforms: this.waterUniforms,
        vertexShader: `varying vec3 vP;varying vec3 vWorld;uniform float time;void main(){vP=position;vec3 p=position;p.z+=sin(p.x*34.+time)*cos(p.y*22.-time*.8)*.014;vec4 w=modelMatrix*vec4(p,1.);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
        fragmentShader:
          `varying vec3 vP;varying vec3 vWorld;uniform float time;uniform float day;void main(){vec2 p=vP.xy;float wave=sin(p.x*65.+p.y*27.+time*1.4)*sin(p.y*47.-time*.8);vec3 normal=normalize(vec3(cos(p.x*45.+time)*.12,1.,sin(p.y*36.-time)*.1));vec3 eye=normalize(cameraPosition-vWorld);float fresnel=pow(1.-max(dot(eye,normal),0.),3.);vec3 c=mix(vec3(.018,.055,.057),vec3(.035,.105,.10),day);c=mix(c,vec3(.12,.21,.22)*(.2+.8*day),fresnel*.7);float glint=pow(max(dot(reflect(normalize(vec3(-1.,-1.,.3)),normal),eye),0.),110.);c+=vec3(.6,.48,.3)*glint*day+pow(max(wave,0.),14.)*.018*day;gl_FragColor=vec4(c,1.-smoothstep(.965,1.,length(p)));#include <tonemapping_fragment>\n#include <colorspace_fragment>}`.replace(
            ";#include",
            ";\n#include",
          ),
      }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(POND.x, POND.level, POND.z);
    this.water.scale.set(POND.rx * 1.13, POND.rz * 1.13, 1);
    this.group.add(this.water);
    const rg = mergeGeometries([
      loft(
        [
          [-0.25, 0.15, 0.01, 0.01],
          [-0.12, 0.2, 0.17, 0.2],
          [0.12, 0.23, 0.14, 0.18],
          [0.27, 0.28, 0.1, 0.1],
          [0.33, 0.26, 0.01, 0.01],
        ],
        16,
        12,
      ),
      new T.ConeGeometry(0.047, 0.3, 5).translate(-0.065, 0.5, 0.17),
      new T.ConeGeometry(0.047, 0.3, 5).translate(0.065, 0.5, 0.17),
    ])!;
    const eyes = mergeGeometries([
      new T.SphereGeometry(0.023, 6, 5).translate(-0.103, 0.315, 0.24),
      new T.SphereGeometry(0.023, 6, 5).translate(0.103, 0.315, 0.24),
      new T.SphereGeometry(0.018, 6, 5).translate(0, 0.265, 0.327),
    ])!;
    const rabbitGeometry = mergeGeometries([rg, eyes], true)!;
    rg.dispose();
    eyes.dispose();
    this.rabbitMesh = new T.InstancedMesh(
      rabbitGeometry,
      [
        new T.MeshStandardMaterial({ color: "#c8b299", roughness: 1 }),
        new T.MeshStandardMaterial({ color: "#272622", roughness: 0.6 }),
      ],
      12,
    );
    this.rabbitMesh.castShadow = true;
    this.rabbitMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    for (let i = 0; i < 12; i++) {
      const x = -9 + rnd() * 18,
        z = -7 + rnd() * 18;
      this.rabbits.push({
        x,
        z,
        heading: rnd() * 6,
        target: new T.Vector2(x, z),
        timer: rnd() * 3,
        speed: 0,
        phase: rnd() * 6,
      });
    }
    this.group.add(this.rabbitMesh);
    const bg = butterflyGeometry();
    this.butterflies = new T.InstancedMesh(
      bg,
      new T.MeshStandardMaterial({
        color: "#efd795",
        side: T.DoubleSide,
        roughness: 1,
      }),
      26,
    );
    this.butterflies.instanceMatrix.setUsage(T.DynamicDrawUsage);
    for (let i = 0; i < 26; i++) {
      const x = (rnd() - 0.5) * 24,
        z = (rnd() - 0.5) * 24;
      this.butterflyAgents.push({
        position: new T.Vector3(x, heightAt(x, z) + 1, z),
        target: new T.Vector3(x, 1, z),
        timer: i * 0.1,
      });
    }
    this.group.add(this.butterflies);
  }
  resetWildlife() {
    const rnd = random(619);
    this.rabbits.forEach((r) => {
      let x = 0,
        z = 0;
      do {
        x = (rnd() - 0.5) * 24;
        z = (rnd() - 0.5) * 24;
      } while (this.blocked(x, z, 0.2));
      r.x = x;
      r.z = z;
      r.heading = rnd() * Math.PI * 2;
      r.target.set(x, z);
      r.timer = rnd() * 3;
      r.phase = 0;
      r.speed = 0;
    });
    this.butterflyAgents.forEach((a, i) => {
      a.timer = 0;
      a.position.set(Math.sin(i) * 10, 1, Math.cos(i) * 10);
    });
  }
  blocked(x: number, z: number, padding = 0.45) {
    return (
      Math.hypot(x, z) > 40 ||
      pondDistance(x, z) < 1.14 ||
      this.obstacles.some(
        (o) => (x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + padding) ** 2,
      )
    );
  }
  update(
    dt: number,
    time: number,
    fox: T.Vector3,
    camera: T.Vector3,
    hour: number,
  ) {
    this.timeUniform.value = time;
    this.waterUniforms.time.value = time;
    this.waterUniforms.day.value = clamp(
      Math.sin(((hour - 6) / 24) * Math.PI * 2) * 2 + 0.3,
    );
    const d = this.dummy;
    this.lodTimer -= dt;
    if (this.lodTimer <= 0) {
      this.lodTimer = 1;
      let near = 0,
        far = 0;
      for (let i = 0; i < this.canopyCount; i++) {
        const offset = i * 16;
        const close =
          Math.hypot(
            this.canopyMatrices[offset + 12] - camera.x,
            this.canopyMatrices[offset + 14] - camera.z,
          ) < 26;
        const mesh = close ? this.canopyNear : this.canopyFar;
        const n = close ? near++ : far++;
        this.lodMatrix.fromArray(this.canopyMatrices, offset);
        mesh.setMatrixAt(n, this.lodMatrix);
        this.color.fromArray(this.canopyColors, i * 3);
        mesh.setColorAt(n, this.color);
      }
      this.canopyNear.count = near;
      this.canopyFar.count = far;
      for (const mesh of [this.canopyNear, this.canopyFar]) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor!.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    }
    this.grass.forEach((g) => {
      const c = g.boundingSphere!.center;
      const dist = Math.hypot(c.x - camera.x, c.z - camera.z);
      g.visible = dist < 43;
      g.count = Math.floor(
        g.userData.fullCount * (dist > 30 ? 0.35 : dist > 20 ? 0.65 : 1),
      );
    });
    this.rabbits.forEach((r, i) => {
      r.timer -= dt;
      const threat = Math.hypot(r.x - fox.x, r.z - fox.z);
      if (threat < 4) {
        r.target.set(r.x + (r.x - fox.x) * 2, r.z + (r.z - fox.z) * 2);
        r.timer = 0.4;
      } else if (r.timer < 0) {
        r.target.set(
          clamp(r.x + (this.rnd() - 0.5) * 10, -27, 27),
          clamp(r.z + (this.rnd() - 0.5) * 10, -27, 27),
        );
        r.timer = 3 + this.rnd() * 6;
      }
      const dist = Math.hypot(r.target.x - r.x, r.target.y - r.z);
      r.speed = dist > 0.4 ? (threat < 5 ? 2.7 : 0.65) : 0;
      const angle = Math.atan2(r.target.x - r.x, r.target.y - r.z);
      r.heading += angleDelta(r.heading, angle) * Math.min(1, dt * 5);
      let x = r.x + Math.sin(r.heading) * r.speed * dt,
        z = r.z + Math.cos(r.heading) * r.speed * dt;
      if (this.blocked(x, z, 0.2)) {
        r.heading += dt * 6;
        r.target.set(
          r.x + Math.sin(r.heading) * 3,
          r.z + Math.cos(r.heading) * 3,
        );
      } else {
        r.x = x;
        r.z = z;
      }
      r.phase += dt * r.speed * 9;
      d.position.set(
        r.x,
        heightAt(r.x, r.z) +
          Math.abs(Math.sin(r.phase)) * 0.12 * clamp(r.speed),
        r.z,
      );
      d.rotation.set(Math.sin(r.phase) * 0.1, r.heading, 0);
      d.scale.setScalar(0.8 + (i % 3) * 0.12);
      d.updateMatrix();
      this.rabbitMesh.setMatrixAt(i, d.matrix);
    });
    this.rabbitMesh.instanceMatrix.needsUpdate = true;
    this.rabbitMesh.computeBoundingSphere();
    this.butterflies.visible = hour > 6 && hour < 20;
    for (let i = 0; i < 26; i++) {
      const agent = this.butterflyAgents[i];
      agent.timer -= dt;
      if (agent.timer < 0) {
        const x = (this.rnd() - 0.5) * 24,
          z = (this.rnd() - 0.5) * 24;
        agent.target.set(x, heightAt(x, z) + 0.7 + this.rnd() * 0.8, z);
        agent.timer = 4 + this.rnd() * 6;
      }
      if (agent.position.distanceToSquared(fox) < 2) {
        agent.target.x += dt * (agent.position.x - fox.x) * 5;
        agent.target.z += dt * (agent.position.z - fox.z) * 5;
        agent.target.y += dt;
      }
      agent.position.lerp(agent.target, 1 - Math.exp(-dt * 0.22));
      const a = Math.atan2(
        agent.target.x - agent.position.x,
        agent.target.z - agent.position.z,
      );
      d.position.copy(agent.position);
      d.position.y += Math.sin(time * 3 + i) * 0.09;
      d.rotation.set(
        Math.sin(time * 13 + i) * 1.2,
        a,
        Math.sin(time * 2 + i) * 0.2,
      );
      d.scale.setScalar(
        0.55 * clamp((d.position.distanceTo(camera) - 1) / 1.5),
      );
      d.updateMatrix();
      this.butterflies.setMatrixAt(i, d.matrix);
    }
    this.butterflies.instanceMatrix.needsUpdate = true;
    this.butterflies.computeBoundingSphere();
  }
}
