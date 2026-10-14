/**
 * Owns every living creature and the interactions between them: the wolf
 * pack (alpha + followers), the deer herd, hares, birds, fish, butterflies,
 * kills, carcasses and respawns. Provides world queries for the AI.
 */
import { hyp } from '../utils/math';
import * as THREE from 'three';
import { Animal } from '../animal/Animal';
import { WOLF } from '../animal/species/Wolf';
import { DEER } from '../animal/species/Deer';
import { WolfBrain } from '../ai/WolfBrain';
import { PackBrain } from '../ai/PackBrain';
import { DeerBrain } from '../ai/DeerBrain';
import { NavGrid } from '../ai/NavGrid';
import { Birds, Butterflies, FishSchool, Hares } from './Critters';
import type { World } from '../world/World';
import { globalUniforms } from '../render/Uniforms';
import { events } from '../core/Events';
import { Random } from '../utils/Random';
import { flatDist } from '../ai/Steering';
import { SPAWN } from '../world/WorldGen';
import type { PlayerAction } from '../ai/PlayerController';

export interface PreyRef {
  kind: 'deer' | 'rabbit';
  animal?: Animal;
  index?: number;
  gen?: number;
}

export interface Carcass {
  animal: Animal;
  brain: DeerBrain;
  food: number;
  age: number;
  pos: THREE.Vector3;
  sink: number;
}

const _v = new THREE.Vector3();

export class Ecosystem {
  readonly group = new THREE.Group();
  readonly nav: NavGrid;
  readonly wolves: Animal[] = [];
  readonly alpha: Animal;
  readonly alphaBrain: WolfBrain;
  readonly packBrains: PackBrain[] = [];
  readonly deer: Animal[] = [];
  readonly deerBrains: DeerBrain[] = [];
  readonly carcasses: Carcass[] = [];
  readonly hares: Hares;
  readonly birds: Birds;
  readonly fish: FishSchool;
  readonly butterflies: Butterflies;
  readonly herdCenter = new THREE.Vector3();
  pointOfInterest: THREE.Vector3 | null = null;
  lastKillBy: Animal | null = null;
  kills = 0;
  private rnd: Random;
  private respawnQueue: { brain: DeerBrain; t: number }[] = [];
  private poiCooldown = 0;
  onRipple: ((x: number, z: number, s: number) => void) | null = null;

  constructor(
    readonly world: World,
    seed: number,
  ) {
    this.group.name = 'ecosystem';
    this.rnd = new Random(seed ^ 0xec0);
    this.nav = new NavGrid(world.data, world.obstacles);

    // Wolves: alpha + three pack members with individual coat tints.
    const tints = [new THREE.Color(1, 1, 1), new THREE.Color(0.62, 0.6, 0.58), new THREE.Color(1.2, 1.15, 1.05), new THREE.Color(1.05, 0.88, 0.72)];
    const names = ['Alpha', 'Shadow', 'Frost', 'Rust'];
    for (let i = 0; i < 4; i++) {
      const w = new Animal(WOLF, world, 'wolf', tints[i], i);
      w.name = names[i];
      this.wolves.push(w);
      this.group.add(w.root);
    }
    this.alpha = this.wolves[0];
    this.alpha.isLeader = true;
    this.wolves.forEach((w, i) => (w.voicePitch = [1.0, 0.86, 1.18, 1.06][i]));
    this.alphaBrain = new WolfBrain(this.alpha, this.nav, this, seed + 1);
    for (let i = 1; i < this.wolves.length; i++) this.packBrains.push(new PackBrain(this.wolves[i], i, this.nav, this, seed + 10 + i));

    // Deer herd.
    for (let i = 0; i < 7; i++) {
      const d = new Animal(DEER, world, 'deer', new THREE.Color(1, 1, 1).multiplyScalar(0.92 + this.rnd.next() * 0.16), i);
      d.name = i % 2 === 0 ? 'Stag' : 'Doe';
      this.deer.push(d);
      this.deerBrains.push(new DeerBrain(d, this.nav, this, seed + 100 + i));
      this.group.add(d.root);
    }

    this.hares = new Hares(world, this.nav, 26, seed + 200);
    this.birds = new Birds(world, 46, seed + 300);
    this.fish = new FishSchool(world, 22, seed + 400, (x, z, s) => {
      this.onRipple?.(x, z, s);
      events.emit('splash', { x, y: 0, z, strength: s });
      this.poi(x, z);
    });
    this.butterflies = new Butterflies(world, world.vegetation.flowerSpots, 28, seed + 500);
    this.group.add(this.hares.mesh, this.birds.mesh, this.fish.mesh, this.butterflies.mesh);

    events.on('howl', (e) => {
      if (e.leader) for (const p of this.packBrains) p.onHowl();
    });
    this.reset();
  }

  /** Places every creature at its starting spot. */
  reset(): void {
    const s = SPAWN;
    this.alpha.place(s.x, s.z, 0.6);
    const offs = [
      [-2.5, -2.2],
      [2.4, -2.8],
      [0.4, -4.5],
    ];
    for (let i = 1; i < this.wolves.length; i++) {
      const [ox, oz] = offs[i - 1];
      this.wolves[i].place(s.x + ox, s.z + oz, 0.6 + (this.rnd.next() - 0.5));
    }
    this.alphaBrain.reset();
    this.packBrains.forEach((p) => p.reset());
    // Herd starts in open meadow 30-45 m from the wolves (visible, not yet alarmed).
    let hx = 22;
    let hz = -38;
    for (let t = 0; t < 200; t++) {
      const a = this.rnd.next() * Math.PI * 2;
      const r = 30 + this.rnd.next() * 15;
      const x = s.x + Math.cos(a) * r;
      const z = s.z + Math.sin(a) * r;
      const d = this.world.data;
      if (d.meadowAt(x, z) > 0.35 && d.forestAt(x, z) < 0.15 && d.waterDepth(x, z) === 0 && d.heightAt(x, z) > 0.8 && this.nav.walkable(x, z)) {
        hx = x;
        hz = z;
        break;
      }
    }
    for (let i = 0; i < this.deer.length; i++) {
      this.nav.randomPointNear(hx, hz, 0, 9, () => this.rnd.next(), _v);
      this.deer[i].place(_v.x, _v.z, this.rnd.next() * 6.28);
      this.deer[i].play('locomotion', { fade: 0.01 });
      this.deerBrains[i].reset();
    }
    this.carcasses.length = 0;
    this.respawnQueue.length = 0;
    this.kills = 0;
    this.lastKillBy = null;
    this.pointOfInterest = null;
  }

  private _all: Animal[] = [];
  /** Wolves + deer (cached array, no per-call allocation). */
  get allAnimals(): Animal[] {
    if (this._all.length !== this.wolves.length + this.deer.length) this._all = [...this.wolves, ...this.deer];
    return this._all;
  }

  // ---------------------------------------------------------------- queries

  nearestTree(p: THREE.Vector3, maxD: number): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null;
    let bd = maxD;
    for (const o of this.world.obstacles.query(p.x, p.z, maxD)) {
      if (o.kind !== 'tree') continue;
      const d = hyp(o.x - p.x, o.z - p.z);
      if (d < bd && this.nav.walkable(o.x + 1.6, o.z)) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  /** Heading (yaw) from p toward the deepest nearby water. */
  waterDirection(p: THREE.Vector3): number {
    let best = 0;
    let bd = -1;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const d = this.world.waterDepth(p.x + Math.sin(a) * 2.5, p.z + Math.cos(a) * 2.5);
      if (d > bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  nearestCarcass(p: THREE.Vector3, maxD: number): Carcass | null {
    let best: Carcass | null = null;
    let bd = maxD;
    for (const c of this.carcasses) {
      if (c.food <= 0.02 || c.sink > 0) continue;
      const d = flatDist(p, c.pos);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /** A spot around the carcass for `w` to feed from (distributed by wolf id). */
  feedingSpot(c: Carcass, w: Animal, out: THREE.Vector3): THREE.Vector3 {
    const i = this.wolves.indexOf(w);
    const a = c.animal.yaw + Math.PI / 2 + i * 1.6;
    out.set(c.pos.x + Math.sin(a) * 1.25, 0, c.pos.z + Math.cos(a) * 1.25);
    out.y = this.world.heightAt(out.x, out.z);
    return out;
  }

  preyAvailable(p: THREE.Vector3, maxD: number): boolean {
    return this.nearestDeer(p, maxD) !== null || this.hares.nearest(p, maxD * 0.4) >= 0;
  }

  nearestDeer(p: THREE.Vector3, maxD: number): Animal | null {
    let best: Animal | null = null;
    let bd = maxD;
    for (let i = 0; i < this.deer.length; i++) {
      if (this.deerBrains[i].mode === 'dead') continue;
      const d = flatDist(p, this.deer[i].pos);
      if (d < bd) {
        bd = d;
        best = this.deer[i];
      }
    }
    return best;
  }

  choosePrey(p: THREE.Vector3, hunger: number): PreyRef | null {
    const deer = this.nearestDeer(p, 110);
    const hi = this.hares.nearest(p, 45);
    if (deer && (hunger > 0.55 || hi < 0)) return { kind: 'deer', animal: deer };
    if (hi >= 0) return { kind: 'rabbit', index: hi, gen: this.hares.generation(hi) };
    if (deer) return { kind: 'deer', animal: deer };
    return null;
  }

  preyAlive(r: PreyRef): boolean {
    if (r.kind === 'deer') return !!r.animal && this.deerBrains[this.deer.indexOf(r.animal)].mode !== 'dead';
    return this.hares.isAvailable(r.index!, r.gen!);
  }

  preyPosition(r: PreyRef, out: THREE.Vector3): THREE.Vector3 {
    if (r.kind === 'deer') return out.copy(r.animal!.pos);
    return this.hares.position(r.index!, out);
  }

  preyFleeing(r: PreyRef): boolean {
    if (r.kind === 'deer') return this.deerBrains[this.deer.indexOf(r.animal!)].fleeing;
    return this.hares.isFleeing(r.index!);
  }

  alphaHuntTarget(): PreyRef | null {
    return this.alphaBrain.huntTarget;
  }

  packNearby(w: Animal, r: number): number {
    let n = 0;
    for (const o of this.wolves) if (o !== w && flatDist(o.pos, w.pos) < r) n++;
    return Math.min(1, n / 2);
  }

  invitePlay(target: Animal, from: Animal): void {
    const pb = this.packBrains.find((p) => p.wolf === target);
    pb?.invitePlay(from);
  }

  interestingNear(p: THREE.Vector3, r: number): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bd = r;
    for (const d of this.deer) {
      const dist = flatDist(p, d.pos);
      if (dist < bd) {
        bd = dist;
        best = _v.copy(d.pos).setY(d.pos.y + 1);
      }
    }
    if (best) return best;
    const hi = this.hares.nearest(p, r);
    if (hi >= 0) return this.hares.position(hi, _v);
    return null;
  }

  alarmHerd(from: Animal): void {
    for (let i = 0; i < this.deer.length; i++) {
      const b = this.deerBrains[i];
      if (b.mode === 'dead' || this.deer[i] === from) continue;
      if (flatDist(this.deer[i].pos, from.pos) < 40) b.awareness = Math.max(b.awareness, 0.8);
    }
  }

  private poi(x: number, z: number): void {
    if (this.poiCooldown > 0) return;
    this.poiCooldown = 20;
    this.pointOfInterest = new THREE.Vector3(x, this.world.heightAt(x, z), z);
    if (this.world.waterDepth(x, z) > 0.3) {
      this.nav.nearestShore(x, z, this.pointOfInterest);
    }
    events.emit('pointOfInterest', { pos: this.pointOfInterest });
  }

  // --------------------------------------------------------------- kills

  private killDeer(i: number, killer: Animal): void {
    const d = this.deer[i];
    const b = this.deerBrains[i];
    b.kill();
    d.play('dead');
    this.carcasses.push({ animal: d, brain: b, food: 1, age: 0, pos: d.pos.clone(), sink: 0 });
    this.lastKillBy = killer;
    this.kills++;
    events.emit('kill', { x: d.pos.x, y: d.pos.y, z: d.pos.z, prey: 'deer' });
    events.emit('growl', { x: killer.pos.x, y: killer.pos.y + 0.7, z: killer.pos.z });
    events.emit('notify', { text: killer === this.alpha ? 'The alpha brought down a deer!' : `${killer.name} brought down a deer!` });
  }

  private checkCatches(): void {
    for (const w of this.wolves) {
      const pouncing = w.airborne && w.state === 'pounce';
      // deer
      for (let i = 0; i < this.deer.length; i++) {
        if (this.deerBrains[i].mode === 'dead') continue;
        const d = this.deer[i];
        const dist = flatDist(w.pos, d.pos);
        if (dist < 1.8 && (w.speed > 4.5 || pouncing)) this.killDeer(i, w);
      }
      // hares (caught with the mouth / paws)
      w.mouthPosition(_v);
      const hi = this.hares.nearest(_v, pouncing || w.speed > 3 ? 1.1 : 0.6);
      if (hi >= 0 && (w.speed > 2.5 || pouncing || (w.timeSinceLanded < 0.3 && w.state === 'pounce'))) {
        this.hares.catch(hi);
        this.lastKillBy = w;
        this.kills++;
        events.emit('kill', { x: _v.x, y: _v.y, z: _v.z, prey: 'hare' });
        if (w === this.alpha) {
          this.alphaBrain.needs.hunger = Math.max(0, this.alphaBrain.needs.hunger - 0.35);
          events.emit('notify', { text: 'Caught a hare!' });
        }
      }
    }
  }

  // ---------------------------------------------------------------- player

  /** Context action for manual control (E key). */
  playerInteract(): string {
    const w = this.alpha;
    if (!w.canAct()) return '';
    if (w.state === 'eat' || w.state === 'drink') {
      w.play('locomotion');
      return '';
    }
    const c = this.nearestCarcass(w.pos, 2.6);
    if (c) {
      w.faceYaw = Math.atan2(c.pos.x - w.pos.x, c.pos.z - w.pos.z);
      w.play('eat');
      return 'eat';
    }
    w.mouthPosition(_v);
    for (const [dx, dz] of [[0, 0], [0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]]) {
      if (this.world.waterDepth(_v.x + dx, _v.z + dz) > 0.04) {
        w.play('drink');
        return 'drink';
      }
    }
    w.play('sniff');
    return 'sniff';
  }

  handlePlayerAction(a: PlayerAction): void {
    const w = this.alpha;
    switch (a) {
      case 'howl':
        if (w.canAct()) w.play('howl', { restart: true });
        break;
      case 'shake':
        if (w.canAct()) {
          w.play('shake', { restart: true });
          events.emit('shake', { x: w.pos.x, y: w.pos.y + 0.6, z: w.pos.z });
          w.wetness = 0;
        }
        break;
      case 'pounce': {
        const hi = this.hares.nearest(w.pos, 5);
        w.pounce(hi >= 0 ? this.hares.position(hi, _v) : null);
        break;
      }
      case 'sit':
        if (w.canAct()) w.play(w.state === 'sit' ? 'locomotion' : 'sit');
        break;
      case 'lie':
        if (w.canAct()) w.play(w.state === 'lie' ? 'sleep' : w.state === 'sleep' ? 'locomotion' : 'lie');
        break;
      case 'sniff':
        if (w.canAct()) w.play(w.state === 'sniff' ? 'locomotion' : 'sniff');
        break;
      case 'playbow':
        if (w.canAct()) {
          w.play('playbow', { restart: true });
          const near = this.wolves.find((o) => o !== w && flatDist(o.pos, w.pos) < 8);
          if (near) this.invitePlay(near, w);
          events.emit('bark', { x: w.pos.x, y: w.pos.y + 0.8, z: w.pos.z, pitch: 1.1 });
        }
        break;
      case 'interact':
        this.playerInteract();
        break;
    }
  }

  // ---------------------------------------------------------------- update

  update(dt: number, time: number, night: number, manual: boolean): void {
    this.poiCooldown -= dt;
    this.alphaBrain.night = night;
    this.alphaBrain.update(dt, manual);
    if (manual) {
      // Player-driven feeding/drinking still satisfies needs.
      const n = this.alphaBrain.needs;
      if (this.alpha.state === 'drink') n.thirst = Math.max(0, n.thirst - dt / 5);
      if (this.alpha.state === 'eat') {
        const c = this.nearestCarcass(this.alpha.pos, 2.8);
        if (c) {
          n.hunger = Math.max(0, n.hunger - dt / 7);
          c.food = Math.max(0, c.food - dt / 22);
        }
      }
    }
    for (const p of this.packBrains) p.update(dt);
    // Herd centre for cohesion.
    this.herdCenter.set(0, 0, 0);
    let alive = 0;
    for (let i = 0; i < this.deer.length; i++) {
      if (this.deerBrains[i].mode === 'dead') continue;
      this.herdCenter.add(this.deer[i].pos);
      alive++;
    }
    if (alive) this.herdCenter.multiplyScalar(1 / alive);
    for (const b of this.deerBrains) b.update(dt, night);

    for (const a of this.wolves) a.update(dt, time);
    for (const a of this.deer) a.update(dt, time);
    this.checkCatches();

    // Carcasses decay; respawn deer later.
    for (let i = this.carcasses.length - 1; i >= 0; i--) {
      const c = this.carcasses[i];
      c.age += dt;
      if ((c.food <= 0.02 || c.age > 200) && c.sink === 0) c.sink = 0.0001;
      if (c.sink > 0) {
        c.sink += dt;
        c.animal.root.position.y -= c.sink * 0.02;
        if (c.sink > 5) {
          this.carcasses.splice(i, 1);
          c.animal.root.visible = false;
          this.respawnQueue.push({ brain: c.brain, t: 25 + this.rnd.next() * 25 });
        }
      }
    }
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      const r = this.respawnQueue[i];
      r.t -= dt;
      if (r.t > 0) continue;
      this.respawnQueue.splice(i, 1);
      const d = r.brain.deer;
      // enter from the far side of the valley, away from the wolves
      const a = Math.atan2(-this.alpha.pos.z, -this.alpha.pos.x) + (this.rnd.next() - 0.5);
      this.nav.randomPointNear(Math.cos(a) * 70, Math.sin(a) * 70, 0, 15, () => this.rnd.next(), _v);
      d.place(_v.x, _v.z, this.rnd.next() * 6.28);
      d.root.visible = true;
      r.brain.reset();
    }

    this.hares.update(dt, this.wolves);
    this.birds.update(dt, time, night, this.wolves, (p) => this.poi(p.x, p.z));
    this.fish.update(dt);
    this.butterflies.update(dt, night);

    // Grass interaction: the animals push blades aside.
    const inter = globalUniforms.uInteractors.value;
    const all = this.allAnimals;
    for (let i = 0; i < inter.length; i++) {
      const a = all[i];
      if (a && a.root.visible && !a.airborne) inter[i].set(a.pos.x, a.pos.z, a.kind === 'deer' ? 0.75 : 0.65, a.state === 'lie' || a.state === 'sleep' || a.state === 'dead' ? 1.6 : 1);
      else inter[i].set(0, 0, -1, 0);
    }
  }

  /** Distance-based mesh / fur / IK level of detail for all large animals. */
  updateLOD(camera: THREE.Camera, furQuality: number): void {
    const q = Math.max(0, Math.min(2, furQuality)) / 2;
    const cp = camera.position;
    for (const a of this.allAnimals) {
      const d = a.root.position.distanceTo(cp);
      let level = 0;
      let shells = 0;
      if (a.kind === 'wolf') {
        const isAlpha = a === this.alpha;
        const maxS = a.mesh.maxShells * q * (isAlpha ? 1 : 0.5);
        if (d < (isAlpha ? 12 : 7)) shells = maxS * (d < 6 ? 1 : 0.75);
        else if (d < 20) {
          level = 1;
          shells = maxS * 0.35;
        } else level = d < 70 ? 1 : 2;
      } else {
        level = d < 16 ? 0 : d < 60 ? 1 : 2;
      }
      a.setLOD(level, shells);
    }
  }

  /** Entity counts for the HUD. */
  counts(): Record<string, number> {
    return {
      wolves: this.wolves.length,
      deer: this.deerBrains.filter((b) => b.mode !== 'dead').length,
      hares: this.hares.aliveCount,
      birds: this.birds.visibleCount,
      fish: this.fish.list.length,
      butterflies: this.butterflies.list.length,
      carcasses: this.carcasses.length,
    };
  }

  dispose(): void {
    for (const a of this.allAnimals) a.dispose();
    this.hares.dispose();
    this.birds.dispose();
    this.fish.dispose();
    this.butterflies.dispose();
    this.group.clear();
  }
}
