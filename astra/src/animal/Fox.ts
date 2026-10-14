import * as T from "three";
import { loft, furTexture, limbGeometry } from "./geometry";
import { heightAt } from "../world/terrain";
import { clamp, damp, Spring, angleDelta } from "../utils/math";
export type AnimalState =
  | "idle"
  | "walk"
  | "run"
  | "turn"
  | "sleep"
  | "eat"
  | "drink"
  | "jump"
  | "howl"
  | "shake";
type Leg = {
  hip: T.Bone;
  knee: T.Bone;
  foot: T.Bone;
  anchor: T.Vector3;
  contact: T.Vector3;
  lastPhase: number;
  side: number;
  front: boolean;
  planted: T.Vector3;
  plantValid: boolean;
};
export class Fox {
  root = new T.Group();
  rig = new T.Group();
  bones: T.Bone[] = [];
  spine: T.Bone[] = [];
  legs: Leg[] = [];
  tail: T.Bone[] = [];
  ears: T.Bone[] = [];
  neck!: T.Bone;
  head!: T.Bone;
  jaw!: T.Bone;
  eyes: T.Mesh[] = [];
  skeleton: T.SkeletonHelper;
  body: T.SkinnedMesh;
  state: AnimalState = "idle";
  requested: AnimalState = "idle";
  weights: Record<string, number> = { idle: 1 };
  speed = 0;
  heading = 0.7;
  phase = 0;
  time = 0;
  actionTime = 0;
  turnRate = 0;
  tailSpring = new Spring();
  earSpring = new Spring();
  pitch = new Spring();
  roll = new Spring();
  footError = 0;
  footfalls: T.Vector3[] = [];
  private temp = new T.Vector3();
  private q = new T.Quaternion();
  private down = new T.Vector3(0, -1, 0);
  private supportDrop = 0;
  private hipWorld = new T.Vector3();
  private targetLocal = new T.Vector3();
  private bendQ = new T.Quaternion();
  private bendAxis = new T.Vector3(1, 0, 0);
  constructor() {
    const fur = furTexture();
    const red = new T.MeshStandardMaterial({
      color: "#df793b",
      map: fur,
      roughness: 0.95,
    });
    const cream = new T.MeshStandardMaterial({
      color: "#ffe8bf",
      map: fur,
      roughness: 1,
    });
    const black = new T.MeshStandardMaterial({
      color: "#302b29",
      roughness: 0.96,
    });
    const earMat = new T.MeshStandardMaterial({
      color: "#703c32",
      roughness: 1,
      side: T.DoubleSide,
    });
    this.root.add(this.rig);
    this.root.position.set(-3, 0, 3);
    this.root.rotation.y = this.heading;
    const bone = (name: string, parent: T.Object3D, pos: number[]) => {
      const b = new T.Bone();
      b.name = name;
      b.position.fromArray(pos);
      parent.add(b);
      this.bones.push(b);
      return b;
    };
    this.spine.push(bone("pelvis", this.rig, [0, 1.02, -0.64]));
    this.spine.push(bone("lumbar", this.spine[0], [0, 0, 0.45]));
    this.spine.push(bone("thorax", this.spine[1], [0, 0.015, 0.52]));
    this.spine.push(bone("shoulders", this.spine[2], [0, 0.02, 0.32]));
    const g = loft([
      [-0.98, 1.04, 0.02, 0.03],
      [-0.78, 1.03, 0.25, 0.33],
      [-0.4, 1.04, 0.32, 0.35],
      [0, 1.05, 0.3, 0.32],
      [0.43, 1.08, 0.34, 0.42],
      [0.77, 1.14, 0.24, 0.33],
      [0.91, 1.19, 0.03, 0.04],
    ]);
    const skin = [],
      weights = [];
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i);
      const t = clamp((z + 0.64) / 1.29) * 3;
      const a = Math.min(2, Math.floor(t));
      skin.push(a, a + 1, 0, 0);
      weights.push(1 - (t - a), t - a, 0, 0);
    }
    g.setAttribute("skinIndex", new T.Uint16BufferAttribute(skin, 4));
    g.setAttribute("skinWeight", new T.Float32BufferAttribute(weights, 4));
    this.body = new T.SkinnedMesh(g, red);
    this.body.castShadow = true;
    this.body.frustumCulled = false;
    this.rig.add(this.body);
    this.root.updateMatrixWorld(true);
    this.body.bind(new T.Skeleton(this.spine));
    const mesh = (
      g: T.BufferGeometry,
      m: T.Material,
      parent: T.Object3D,
      pos = [0, 0, 0],
    ) => {
      const o = new T.Mesh(g, m);
      o.position.fromArray(pos);
      o.castShadow = true;
      o.receiveShadow = true;
      parent.add(o);
      return o;
    };
    this.neck = bone("neck", this.spine[3], [0, 0.1, 0.05]);
    mesh(
      loft(
        [
          [-0.2, -0.08, 0.15, 0.19],
          [0, 0.1, 0.27, 0.36],
          [0.22, 0.27, 0.24, 0.31],
          [0.37, 0.32, 0.12, 0.16],
        ],
        22,
      ),
      red,
      this.neck,
    );
    const bib = mesh(
      loft(
        [
          [-0.02, -0.17, 0.04, 0.07],
          [0.15, -0.08, 0.24, 0.24],
          [0.37, 0.1, 0.2, 0.24],
          [0.49, 0.23, 0.05, 0.12],
        ],
        18,
      ),
      cream,
      this.neck,
    );
    bib.position.y = 0.03;
    bib.position.z = -0.035;
    bib.scale.x = 0.86;
    this.head = bone("head", this.neck, [0, 0.43, 0.29]);
    mesh(
      loft(
        [
          [-0.28, 0, 0.04, 0.06],
          [-0.12, 0.02, 0.24, 0.25],
          [0.12, -0.015, 0.25, 0.22],
          [0.34, -0.105, 0.14, 0.12],
          [0.57, -0.15, 0.06, 0.06],
        ],
        30,
      ),
      red,
      this.head,
    );
    for (const side of [-1, 1]) {
      const cheek = mesh(
        loft(
          [
            [-0.1, -0.05, 0.01, 0.01],
            [0.12, -0.09, 0.115, 0.12],
            [0.35, -0.16, 0.06, 0.06],
            [0.55, -0.17, 0.01, 0.015],
          ],
          18,
          16,
        ),
        cream,
        this.head,
        [side * 0.14, 0, 0],
      );
      cheek.rotation.y = -side * 0.12;
      const ear = bone(side < 0 ? "ear.L" : "ear.R", this.head, [
        side * 0.16,
        0.17,
        -0.045,
      ]);
      ear.rotation.z = -side * 0.2;
      this.ears.push(ear);
      const eg = new T.ConeGeometry(0.135, 0.39, 3, 2);
      eg.rotateY(Math.PI / 2);
      mesh(eg, black, ear, [0, 0.155, 0]);
      const inner = mesh(
        new T.ConeGeometry(0.086, 0.27, 3),
        earMat,
        ear,
        [0, 0.15, 0.037],
      );
      inner.scale.z = 0.24;
      const eye = mesh(
        new T.SphereGeometry(0.04, 12, 10),
        new T.MeshStandardMaterial({ color: "#d9ac3e", roughness: 0.28 }),
        this.head,
        [side * 0.208, 0.037, 0.192],
      );
      eye.scale.set(0.6, 0.78, 1);
      this.eyes.push(eye);
      mesh(new T.SphereGeometry(0.027, 10, 8), black, eye, [
        side * 0.009,
        0,
        0.027,
      ]);
      mesh(
        new T.SphereGeometry(0.009, 8, 6),
        new T.MeshBasicMaterial({ color: "white" }),
        eye,
        [side * 0.012, 0.013, 0.045],
      );
    }
    this.jaw = bone("jaw", this.head, [0, -0.135, 0.16]);
    mesh(
      loft(
        [
          [-0.02, -0.02, 0.13, 0.055],
          [0.23, -0.036, 0.09, 0.04],
          [0.4, -0.024, 0.03, 0.025],
        ],
        16,
        16,
      ),
      cream,
      this.jaw,
    );
    mesh(
      new T.SphereGeometry(0.078, 16, 12),
      black,
      this.head,
      [0, -0.137, 0.567],
    ).scale.set(1, 0.7, 0.6);
    for (let i = 0; i < 5; i++) {
      const b = bone(
        "tail." + i,
        i ? this.tail[i - 1] : this.spine[0],
        i ? [0, 0, -0.32] : [0, 0.05, -0.14],
      );
      this.tail.push(b);
    }
    const tg = loft(
      [
        [-2.43, 1.07, 0.004, 0.005],
        [-2.22, 1.07, 0.13, 0.15],
        [-1.95, 1.07, 0.23, 0.25],
        [-1.6, 1.07, 0.26, 0.28],
        [-1.2, 1.07, 0.21, 0.23],
        [-0.78, 1.07, 0.1, 0.12],
      ],
      42,
      24,
    );
    const tp = tg.attributes.position,
      ti = [],
      tw = [],
      tc = [];
    const rc = new T.Color("#dc793e"),
      cc = new T.Color("#ffe6b9");
    for (let i = 0; i < tp.count; i++) {
      const t = clamp((-0.78 - tp.getZ(i)) / 0.32, 0, 4),
        a = Math.min(3, Math.floor(t));
      ti.push(a, a + 1, 0, 0);
      tw.push(1 - (t - a), t - a, 0, 0);
      const c = rc
        .clone()
        .lerp(cc, T.MathUtils.smoothstep(-tp.getZ(i), 1.88, 2.02));
      tc.push(c.r, c.g, c.b);
    }
    tg.setAttribute("skinIndex", new T.Uint16BufferAttribute(ti, 4));
    tg.setAttribute("skinWeight", new T.Float32BufferAttribute(tw, 4));
    tg.setAttribute("color", new T.Float32BufferAttribute(tc, 3));
    const tailSkin = new T.SkinnedMesh(
      tg,
      new T.MeshStandardMaterial({
        vertexColors: true,
        map: fur,
        roughness: 1,
      }),
    );
    tailSkin.castShadow = true;
    tailSkin.frustumCulled = false;
    this.rig.add(tailSkin);
    this.root.updateMatrixWorld(true);
    tailSkin.bind(new T.Skeleton(this.tail));
    for (const front of [true, false])
      for (const side of [-1, 1]) {
        const parent = front ? this.spine[3] : this.spine[0];
        const hip = bone(`${front ? "fore" : "hind"}.${side}.upper`, parent, [
          side * 0.235,
          -0.06,
          front ? -0.04 : 0.02,
        ]);
        const knee = bone("lower", hip, [0, -0.48, 0]);
        const foot = bone("paw", knee, [0, -0.48, 0]);
        mesh(limbGeometry(0.48, front ? 0.115 : 0.17, 0.075), red, hip);
        mesh(limbGeometry(0.48, 0.068, 0.044), black, knee);
        const paw = mesh(
          new T.SphereGeometry(1, 14, 10),
          black,
          foot,
          [0, 0.045, 0.06],
        );
        paw.scale.set(0.073, 0.069, 0.13);
        this.legs.push({
          hip,
          knee,
          foot,
          anchor: new T.Vector3(side * 0.235, 0, front ? 0.66 : -0.62),
          contact: new T.Vector3(),
          lastPhase: 0,
          side,
          front,
          planted: new T.Vector3(),
          plantValid: false,
        });
      }
    this.skeleton = new T.SkeletonHelper(this.rig);
    this.skeleton.visible = false;
    (this.skeleton.material as T.Material).depthTest = false;
    this.skeleton.renderOrder = 5;
    this.update(1 / 60, 0, new T.Vector3());
  }
  setState(state: AnimalState) {
    if (state !== this.requested) {
      this.requested = state;
      this.actionTime = 0;
    }
  }
  update(dt: number, speed: number, lookTarget: T.Vector3) {
    this.time += dt;
    this.actionTime += dt;
    this.speed = damp(this.speed, speed, 8, dt);
    this.state = this.requested;
    for (const s of [
      "idle",
      "walk",
      "run",
      "turn",
      "sleep",
      "eat",
      "drink",
      "jump",
      "howl",
      "shake",
    ])
      this.weights[s] = damp(
        this.weights[s] || 0,
        s === this.state ? 1 : 0,
        7,
        dt,
      );
    const w = this.weights;
    this.phase += dt * (this.speed > 0.1 ? 5 + this.speed * 4.2 : 0);
    const walk = clamp(this.speed / 1.4),
      run = clamp((this.speed - 2) / 3);
    const jump =
      w.jump * Math.sin(clamp(this.actionTime / 0.85) * Math.PI) * 1.35;
    const sx = Math.sin(this.heading),
      cz = Math.cos(this.heading);
    const x = this.root.position.x,
      z = this.root.position.z;
    this.root.rotation.y = this.heading;
    this.root.position.y = heightAt(x, z) + jump;
    const slopeF =
      (heightAt(x + sx * 0.7, z + cz * 0.7) -
        heightAt(x - sx * 0.7, z - cz * 0.7)) /
      1.4;
    const slopeS =
      (heightAt(x + cz * 0.35, z - sx * 0.35) -
        heightAt(x - cz * 0.35, z + sx * 0.35)) /
      0.7;
    this.rig.rotation.x = this.pitch.update(-Math.atan(slopeF), dt);
    this.rig.rotation.z = this.roll.update(Math.atan(slopeS) * 0.7, dt);
    this.rig.position.y =
      -0.12 -
      w.sleep * 0.59 +
      Math.sin(this.phase * 2) * 0.015 * walk +
      Math.sin(this.time * 2.6) * 0.008;
    this.spine[1].rotation.y = Math.sin(this.phase) * 0.027 * walk;
    this.spine[2].rotation.x = Math.sin(this.phase * 2) * 0.035 * run;
    this.spine[0].rotation.z = w.shake * Math.sin(this.time * 36) * 0.12;
    this.neck.rotation.x =
      -w.howl * 0.63 + (w.eat + w.drink) * 0.86 + w.sleep * 0.92;
    this.head.rotation.x =
      (w.eat + w.drink) * 0.43 + Math.sin(this.time * 1.2) * 0.035;
    const toTarget = Math.atan2(lookTarget.x - x, lookTarget.z - z);
    this.head.rotation.y = damp(
      this.head.rotation.y,
      clamp(angleDelta(this.heading, toTarget), -0.5, 0.5) * (1 - w.sleep),
      5,
      dt,
    );
    this.jaw.rotation.x =
      w.eat * (0.13 + Math.sin(this.time * 12) * 0.1) +
      w.drink * (0.06 + Math.sin(this.time * 8) * 0.05) +
      w.howl * 0.26;
    const lag = this.tailSpring.update(
      -this.turnRate * 0.16 + Math.sin(this.time * 1.8) * 0.16,
      dt,
    );
    this.tail.forEach((b, i) => {
      b.rotation.y = lag * (1 + i * 0.24) + w.sleep * 0.42;
      b.rotation.x =
        -0.18 + Math.sin(this.phase - i * 0.4) * 0.05 * walk + w.howl * 0.08;
    });
    const el = this.earSpring.update(
      Math.sin(this.time * 2) * 0.04 - this.turnRate * 0.07,
      dt,
    );
    this.ears.forEach(
      (b, i) => (b.rotation.x = el * (i ? 1 : -1) - w.sleep * 0.4),
    );
    const blink =
      this.time % 4.7 > 4.53
        ? Math.abs(Math.sin((((this.time % 4.7) - 4.53) / 0.17) * Math.PI))
        : 0;
    this.eyes.forEach(
      (e) => (e.scale.y = 0.78 * (1 - Math.max(blink, w.sleep) * 0.95)),
    );
    this.root.updateMatrixWorld(true);
    this.footError = 0;
    this.footfalls.length = 0;
    this.legs.forEach((leg, i) => {
      const ph =
        (this.phase / (Math.PI * 2) +
          (i === 0 || i === 3 ? 0 : 0.5) +
          (run && i > 1 ? 0.15 : 0)) %
        1;
      const swing = ph < 0.42;
      const stride = walk * (0.29 + run * 0.19);
      const local = this.temp.copy(leg.anchor);
      local.z += swing
        ? T.MathUtils.lerp(-stride, stride, ph / 0.42)
        : T.MathUtils.lerp(stride, -stride, (ph - 0.42) / 0.58);
      local.z = T.MathUtils.lerp(local.z, leg.front ? 0.43 : -0.38, w.sleep);
      local.applyMatrix4(this.root.matrixWorld);
      local.y =
        heightAt(local.x, local.z) +
        0.015 +
        (swing ? Math.sin((ph / 0.42) * Math.PI) : 0) *
          (0.15 + run * 0.16) *
          walk +
        jump;
      if (!swing && leg.lastPhase < 0.42 && walk > 0.15)
        this.footfalls.push(local.clone());
      if (!swing && walk > 0.2 && jump < 0.01 && w.sleep < 0.1) {
        if (
          leg.lastPhase < 0.42 ||
          !leg.plantValid ||
          leg.planted.distanceToSquared(local) > 0.2
        ) {
          leg.planted.copy(local);
          leg.plantValid = true;
        } else local.copy(leg.planted);
      } else leg.plantValid = false;
      leg.lastPhase = ph;
      leg.contact.copy(local);
    });
    // Lower the pelvis when a locked stance foot would otherwise exceed leg reach.
    // Solve all support constraints before any limb, so no leg inherits a stale body height.
    let drop = 0;
    for (const leg of this.legs) {
      leg.hip.getWorldPosition(this.hipWorld);
      const p = leg.contact;
      let dx = p.x - this.hipWorld.x,
        dz = p.z - this.hipWorld.z;
      const r = Math.hypot(dx, dz);
      if (r > 0.8) {
        const oldGround = heightAt(p.x, p.z);
        p.x = this.hipWorld.x + (dx * 0.8) / r;
        p.z = this.hipWorld.z + (dz * 0.8) / r;
        p.y += heightAt(p.x, p.z) - oldGround;
        leg.planted.copy(p);
        dx = p.x - this.hipWorld.x;
        dz = p.z - this.hipWorld.z;
      }
      const available = Math.sqrt(
        Math.max(0.01, 0.952 * 0.952 - dx * dx - dz * dz),
      );
      drop = Math.max(drop, this.hipWorld.y - p.y - available);
    }
    this.supportDrop =
      drop > this.supportDrop ? drop : damp(this.supportDrop, drop, 10, dt);
    this.rig.position.y -= this.supportDrop;
    this.root.updateMatrixWorld(true);
    this.legs.forEach((leg) => {
      // Analytic two-bone IK in the hip parent's coordinates, including slope and spine transforms.
      leg.hip.parent!.updateWorldMatrix(true, false);
      const target = this.targetLocal.copy(leg.contact);
      leg.hip.parent!.worldToLocal(target);
      target.sub(leg.hip.position);
      const distance = clamp(target.length(), 0.05, 0.958);
      const bend = Math.acos(clamp(distance / 0.96, -1, 1));
      this.q.setFromUnitVectors(this.down, target.normalize());
      leg.hip.quaternion
        .copy(this.q)
        .multiply(
          this.bendQ.setFromAxisAngle(this.bendAxis, leg.front ? -bend : bend),
        );
      leg.knee.rotation.x = leg.front ? 2 * bend : -2 * bend;
      leg.foot.rotation.x =
        -leg.hip.rotation.x - leg.knee.rotation.x - this.rig.rotation.x;
    });
    this.root.updateMatrixWorld(true);
    for (const leg of this.legs) {
      leg.foot.getWorldPosition(this.temp);
      this.footError = Math.max(
        this.footError,
        this.temp.distanceTo(leg.contact),
      );
    }
  }
}
