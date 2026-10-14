/**
 * Utility AI for the alpha wolf. Every decision tick each action scores
 * itself from the current needs and world context; the best one runs
 * (with hysteresis so behaviour does not flicker). Actions drive the
 * creature through moveDir/moveSpeed, look targets and animation states.
 */
import * as THREE from 'three';
import type { Animal } from '../animal/Animal';
import { Needs } from './Needs';
import { PathFollower, avoidObstacles, flatDist, pursuitPoint, separate } from './Steering';
import type { NavGrid } from './NavGrid';
import type { Ecosystem, PreyRef } from '../eco/Ecosystem';
import { angleDiff, clamp01 } from '../utils/math';
import { Random } from '../utils/Random';
import { events } from '../core/Events';

export type Status = 'running' | 'done' | 'failed';

export interface ScoreEntry {
  id: string;
  score: number;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export abstract class WolfAction {
  abstract readonly id: string;
  abstract readonly icon: string;
  /** Minimum time before a voluntary switch away from this action. */
  minTime = 2;
  t = 0;
  abstract score(b: WolfBrain): number;
  abstract label(b: WolfBrain): string;
  start(_b: WolfBrain): boolean {
    return true;
  }
  abstract update(b: WolfBrain, dt: number): Status;
  stop(b: WolfBrain): void {
    b.wolf.moveDir.set(0, 0);
    b.wolf.moveSpeed = 0;
    b.wolf.faceYaw = null;
  }
  interruptible(_b: WolfBrain): boolean {
    return true;
  }
}

// ---------------------------------------------------------------- actions

class Idle extends WolfAction {
  readonly id = 'idle';
  readonly icon = '👀';
  private dur = 6;
  private lookT = 0;
  private sat = false;
  score(): number {
    return 0.16;
  }
  label(): string {
    return this.sat ? 'Sitting, watching the valley' : 'Watching the surroundings';
  }
  override start(b: WolfBrain): boolean {
    this.dur = 5 + b.rnd.next() * 6;
    this.sat = false;
    return true;
  }
  update(b: WolfBrain, dt: number): Status {
    const w = b.wolf;
    w.moveSpeed = 0;
    this.lookT -= dt;
    if (this.lookT <= 0) {
      this.lookT = 1.5 + b.rnd.next() * 2.5;
      b.lookAtRandom();
    }
    if (!this.sat && this.t > 2.5 && b.rnd.next() < dt * 0.15 && w.canAct()) {
      w.play('sit');
      this.sat = true;
    }
    return this.t > this.dur ? 'done' : 'running';
  }
  override stop(b: WolfBrain): void {
    super.stop(b);
    if (b.wolf.state === 'sit') b.wolf.play('locomotion');
  }
}

class Explore extends WolfAction {
  readonly id = 'explore';
  readonly icon = '🧭';
  private sniffT = 0;
  private arrivedT = -1;
  private speed = 1.25;
  override minTime = 4;
  score(b: WolfBrain): number {
    return 0.22 + b.needs.curiosity * 0.45 - b.night * 0.15;
  }
  label(): string {
    return this.sniffT > 0 ? 'Following a scent' : this.arrivedT >= 0 ? 'Looking around' : 'Exploring the valley';
  }
  override start(b: WolfBrain): boolean {
    const w = b.wolf;
    const ok = b.nav.randomPointNear(w.pos.x, w.pos.z, 14, 48, () => b.rnd.next(), b.target);
    if (!ok || !b.follower.setGoal(w.pos, b.target)) return false;
    this.speed = flatDist(w.pos, b.target) > 30 && b.rnd.chance(0.5) ? w.spec.gait.trotSpeed : w.spec.gait.walkSpeed;
    this.arrivedT = -1;
    this.sniffT = 0;
    b.hasTarget = true;
    return true;
  }
  update(b: WolfBrain, dt: number): Status {
    const w = b.wolf;
    if (this.arrivedT >= 0) {
      this.arrivedT += dt;
      w.moveSpeed = 0;
      if (this.arrivedT > 3) {
        b.needs.curiosity = Math.max(0, b.needs.curiosity - 0.45);
        return 'done';
      }
      return 'running';
    }
    if (this.sniffT > 0) {
      this.sniffT -= dt;
      if (this.sniffT <= 0 && w.state === 'sniff') w.play('locomotion');
    } else if (b.rnd.next() < dt * 0.05 && w.canAct()) {
      this.sniffT = 2 + b.rnd.next() * 2;
      w.play('sniff');
    }
    if (b.follower.update(w, this.sniffT > 0 ? 0.8 : this.speed, dt)) {
      if (b.follower.failed) return 'failed';
      this.arrivedT = 0;
      if (w.state === 'sniff') w.play('locomotion');
      b.lookAtRandom();
    }
    b.steerExtras();
    return 'running';
  }
  override stop(b: WolfBrain): void {
    super.stop(b);
    if (b.wolf.state === 'sniff') b.wolf.play('locomotion');
  }
}

/** Go somewhere sheltered, then lie down (rest) or curl up (sleep). */
class Rest extends WolfAction {
  readonly id: string = 'rest';
  readonly icon: string = '🛌';
  protected arrived = false;
  protected lieT = 0;
  override minTime = 6;
  constructor(protected sleep: boolean) {
    super();
    if (sleep) {
      this.id = 'sleep';
      this.icon = '💤';
    }
  }
  score(b: WolfBrain): number {
    const f = b.needs.fatigue;
    if (this.sleep) return b.night > 0.6 ? (0.15 + f * 1.15) * b.night : 0;
    return Math.pow(f, 1.3) * 1.25 * (1 - b.night * 0.4);
  }
  label(): string {
    if (!this.arrived) return this.sleep ? 'Looking for a place to sleep' : 'Looking for shade to rest';
    return this.sleep ? 'Sleeping…' : 'Resting';
  }
  override start(b: WolfBrain): boolean {
    const w = b.wolf;
    this.arrived = false;
    this.lieT = 0;
    const tree = b.eco.nearestTree(w.pos, 26);
    if (tree) {
      const a = Math.atan2(w.pos.z - tree.z, w.pos.x - tree.x);
      b.target.set(tree.x + Math.cos(a) * 1.6, 0, tree.z + Math.sin(a) * 1.6);
      if (b.follower.setGoal(w.pos, b.target)) {
        b.hasTarget = true;
        return true;
      }
    }
    b.target.copy(w.pos);
    this.arrived = true;
    return true;
  }
  update(b: WolfBrain, dt: number): Status {
    const w = b.wolf;
    if (!this.arrived) {
      if (b.follower.update(w, w.spec.gait.walkSpeed, dt, 1.0)) this.arrived = true;
      b.steerExtras();
      return 'running';
    }
    w.moveSpeed = 0;
    this.lieT += dt;
    if (w.state !== 'lie' && w.state !== 'sleep' && w.canAct()) w.play('lie');
    if (this.sleep && this.lieT > 3 && w.state === 'lie') w.play('sleep');
    b.resting = true;
    b.sleeping = w.state === 'sleep';
    if (this.sleep) return b.needs.fatigue < 0.03 || (b.night < 0.25 && b.needs.fatigue < 0.25) ? 'done' : 'running';
    return b.needs.fatigue < 0.05 || this.lieT > 50 ? 'done' : 'running';
  }
  override interruptible(b: WolfBrain): boolean {
    if (!this.sleep) return true;
    return b.needs.thirst > 0.85 || b.needs.hunger > 0.9;
  }
  override stop(b: WolfBrain): void {
    super.stop(b);
    if (b.wolf.state === 'lie' || b.wolf.state === 'sleep') b.wolf.play('locomotion');
  }
}

class Drink extends WolfAction {
  readonly id = 'drink';
  readonly icon = '💧';
  private phase: 'go' | 'face' | 'drink' = 'go';
  private sipT = 0;
  override minTime = 3;
  score(b: WolfBrain): number {
    return Math.pow(b.needs.thirst, 1.3) * 1.4;
  }
  label(): string {
    return this.phase === 'drink' ? 'Drinking' : 'Thirsty — heading to the water';
  }
  override start(b: WolfBrain): boolean {
    const w = b.wolf;
    if (!b.nav.nearestShore(w.pos.x, w.pos.z, b.target)) return false;
    this.phase = 'go';
    if (!b.follower.setGoal(w.pos, b.target)) return false;
    b.hasTarget = true;
    return true;
  }
  update(b: WolfBrain, dt: number): Status {
    const w = b.wolf;
    if (this.phase === 'go') {
      const far = flatDist(w.pos, b.target) > 22;
      if (b.follower.update(w, far ? w.spec.gait.trotSpeed : w.spec.gait.walkSpeed, dt, 1.0)) {
        this.phase = 'face';
        w.faceYaw = b.eco.waterDirection(w.pos);
      }
      b.steerExtras();
      return 'running';
    }
    w.moveSpeed = 0;
    if (this.phase === 'face') {
      if (w.faceYaw === null || Math.abs(angleDiff(w.yaw, w.faceYaw)) < 0.25 || this.t > 12) {
        this.phase = 'drink';
        w.play('drink');
      }
      return 'running';
    }
    b.needs.thirst = Math.max(0, b.needs.thirst - dt / 5);
    this.sipT -= dt;
    if (this.sipT <= 0) {
      this.sipT = 0.45;
      w.mouthPosition(_v);
      events.emit('drink', { x: _v.x, y: _v.y, z: _v.z });
    }
    return b.needs.thirst <= 0.02 ? 'done' : 'running';
  }
  override interruptible(): boolean {
    return this.phase === 'go';
  }
  override stop(b: WolfBrain): void {
    super.stop(b);
    if (b.wolf.state === 'drink') b.wolf.play('locomotion');
  }
}

class Hunt extends WolfAction {
  readonly id = 'hunt';
  readonly icon = '🐾';
  phase: 'approach' | 'stalk' | 'chase' | 'pounce' = 'approach';
  prey: PreyRef | null = null;
  private repathT = 0;
  private chaseT = 0;
  override minTime = 5;
  score(b: WolfBrain): number {
    if (b.eco.nearestCarcass(b.wolf.pos, 100)) return 0;
    if (!b.eco.preyAvailable(b.wolf.pos, 110)) return 0;
    return Math.pow(b.needs.hunger, 1.2) * 1.55;
  }
  label(): string {
    const what = this.prey?.kind === 'rabbit' ? 'a hare' : 'a deer';
    switch (this.phase) {
      case 'approach':
        return `Hungry — tracking ${what}`;
      case 'stalk':
        return `Stalking ${what}`;
      case 'chase':
        return `Chasing ${what}!`;
      case 'pounce':
        return 'Pounce!';
    }
  }
  override start(b: WolfBrain): boolean {
    this.prey = b.eco.choosePrey(b.wolf.pos, b.needs.hunger);
    if (!this.prey) return false;
    this.phase = 'approach';
    this.chaseT = 0;
    this.repathT = 0;
    b.huntTarget = this.prey;
    return true;
  }
  update(b: WolfBrain, dt: number): Status {
    const w = b.wolf;
    const prey = this.prey;
    if (!prey || !b.eco.preyAlive(prey)) {
      b.huntTarget = null;
      return prey && b.eco.lastKillBy === w ? 'done' : 'failed';
    }
    const pp = b.eco.preyPosition(prey, _w);
    b.target.copy(pp);
    b.hasTarget = true;
    w.lookTarget = _v.copy(pp).setY(pp.y + 0.4);
    const d = flatDist(w.pos, pp);
    const isRabbit = prey.kind === 'rabbit';
    const fleeing = b.eco.preyFleeing(prey);
    switch (this.phase) {
      case 'approach': {
        this.repathT -= dt;
        if (this.repathT <= 0) {
          this.repathT = 2.5;
          b.follower.setGoal(w.pos, pp);
        }
        b.follower.update(w, w.spec.gait.trotSpeed, dt, 0.5);
        b.steerExtras();
        if (d < (isRabbit ? 16 : 30) || fleeing) {
          this.phase = fleeing ? 'chase' : 'stalk';
          if (this.phase === 'stalk') w.play('stalk');
        }
        break;
      }
      case 'stalk': {
        w.moveDir.set(pp.x - w.pos.x, pp.z - w.pos.z);
        w.moveSpeed = 1.3;
        avoidObstacles(w, b.eco.world.obstacles, 3);
        if (d < (isRabbit ? 7 : 13) || fleeing || this.t > 30) {
          this.phase = 'chase';
          w.play('locomotion');
        }
        break;
      }
      case 'chase': {
        this.chaseT += dt;
        if (prey.kind === 'deer') pursuitPoint(w, prey.animal!, _v);
        else _v.copy(pp);
        w.moveDir.set(_v.x - w.pos.x, _v.z - w.pos.z);
        w.moveSpeed = w.spec.gait.maxSpeed;
        avoidObstacles(w, b.eco.world.obstacles, 5);
        separate(w, b.eco.wolves, 1.5, 0.6);
        if (isRabbit && d < 3.4 && w.canAct()) {
          this.phase = 'pounce';
          w.pounce(pp);
        }
        if (this.chaseT > 17 || w.exertion > 0.97) {
          b.needs.fatigue = clamp01(b.needs.fatigue + 0.2);
          b.huntTarget = null;
          events.emit('notify', { text: 'The prey escaped…' });
          return 'failed';
        }
        break;
      }
      case 'pounce': {
        w.moveSpeed = 0;
        if (!w.airborne && w.state !== 'pounce') this.phase = 'chase';
        if (!w.airborne && w.timeSinceLanded > 0.5) this.phase = 'chase';
        break;
      }
    }
    return 'running';
  }
  override stop(b: WolfBrain): void {
    super.stop(b);
    b.wolf.lookTarget = null;
    b.huntTarget = null;
    if (b.wolf.state === 'stalk') b.wolf.play('locomotion');
  }
  override interruptible(): boolean {
    return this.phase !== 'chase' && this.phase !== 'pounce';
  }
}

class Eat extends WolfAction {
  readonly id = 'eat';
  readonly icon = '🍖';
  private arrived = false;
  private biteT = 0;
  override minTime = 4;
  score(b: WolfBrain): number {
    const c = b.eco.nearestCarcass(b.wolf.pos, 100);
    if (!c) return 0;
    return 0.25 + b.needs.hunger * 1.7;
  }
  label(): string {
    return this.arrived ? 'Feeding' : 'Heading to the kill';
  }
  override start(b: WolfBrain): boolean {
    const c = b.eco.nearestCarcass(b.wolf.pos, 100);
    if (!c) return false;
    this.arrived = false;
    b.eco.feedingSpot(c, b.wolf, b.target);
    b.follower.setGoal(b.wolf.pos, b.target);
    b.hasTarget = true;
    return true;
  }
  update(b: WolfBrain, dt: number): Status {
    const w = b.wolf;
    const c = b.eco.nearestCarcass(w.pos, 100);
    if (!c) return 'done';
    if (!this.arrived) {
      if (b.follower.update(w, flatDist(w.pos, b.target) > 15 ? w.spec.gait.trotSpeed : w.spec.gait.walkSpeed, dt, 0.5) || flatDist(w.pos, b.target) < 0.6) {
        this.arrived = true;
        w.faceYaw = Math.atan2(c.pos.x - w.pos.x, c.pos.z - w.pos.z);
      }
      return 'running';
    }
    w.moveSpeed = 0;
    if (w.faceYaw !== null && Math.abs(angleDiff(w.yaw, w.faceYaw)) > 0.3 && this.t < 8) return 'running';
    if (w.state !== 'eat' && w.canAct()) w.play('eat');
    const bite = Math.min(c.food, dt / 22);
    c.food -= bite;
    b.needs.hunger = Math.max(0, b.needs.hunger - dt / 7);
    this.biteT -= dt;
    if (this.biteT <= 0) {
      this.biteT = 0.8 + b.rnd.next() * 0.6;
      w.mouthPosition(_v);
      events.emit('eat', { x: _v.x, y: _v.y, z: _v.z });
    }
    return b.needs.hunger < 0.03 || c.food <= 0 ? 'done' : 'running';
  }
  override interruptible(b: WolfBrain): boolean {
    return !this.arrived || b.needs.thirst > 0.92;
  }
  override stop(b: WolfBrain): void {
    super.stop(b);
    if (b.wolf.state === 'eat') b.wolf.play('locomotion');
  }
}

class Howl extends WolfAction {
  readonly id = 'howl';
  readonly icon = '🌕';
  private started = false;
  override minTime = 5;
  score(b: WolfBrain): number {
    const dusk = b.night > 0.3 ? 1 : 0.3;
    return Math.pow(b.needs.social, 1.2) * (0.6 + b.night * 1.1) * dusk;
  }
  label(): string {
    return 'Howling to the pack';
  }
  override start(b: WolfBrain): boolean {
    this.started = false;
    return b.wolf.canAct();
  }
  update(b: WolfBrain): Status {
    const w = b.wolf;
    w.moveSpeed = 0;
    if (!this.started) {
      if (!w.canAct()) return 'failed';
      w.play('howl', { restart: true });
      this.started = true;
      return 'running';
    }
    if (w.state !== 'howl' && this.t > 1) {
      b.needs.social = Math.max(0, b.needs.social - 0.7);
      return 'done';
    }
    return 'running';
  }
  override interruptible(): boolean {
    return false;
  }
}

class Socialize extends WolfAction {
  readonly id = 'social';
  readonly icon = '🐺';
  private buddy: Animal | null = null;
  private bowed = false;
  override minTime = 3;
  score(b: WolfBrain): number {
    return b.eco.wolves.length > 1 ? b.needs.social * 0.65 * (1 - b.night * 0.6) : 0;
  }
  label(): string {
    return this.bowed ? 'Playing with the pack' : 'Greeting a packmate';
  }
  override start(b: WolfBrain): boolean {
    const others = b.eco.wolves.filter((o) => o !== b.wolf);
    if (!others.length) return false;
    this.buddy = others[Math.floor(b.rnd.next() * others.length)];
    this.bowed = false;
    return true;
  }
  update(b: WolfBrain, dt: number): Status {
    const w = b.wolf;
    const o = this.buddy!;
    const d = flatDist(w.pos, o.pos);
    w.lookTarget = _v.copy(o.pos).setY(o.pos.y + 0.7);
    b.target.copy(o.pos);
    b.hasTarget = true;
    if (!this.bowed) {
      if (d > 2.2) {
        w.moveDir.set(o.pos.x - w.pos.x, o.pos.z - w.pos.z);
        w.moveSpeed = d > 8 ? w.spec.gait.trotSpeed : w.spec.gait.walkSpeed;
        avoidObstacles(w, b.eco.world.obstacles, 3);
        return this.t > 25 ? 'failed' : 'running';
      }
      w.moveSpeed = 0;
      w.faceYaw = Math.atan2(o.pos.x - w.pos.x, o.pos.z - w.pos.z);
      if (w.canAct()) {
        w.play('playbow', { restart: true });
        this.bowed = true;
        b.eco.invitePlay(o, w);
        events.emit('bark', { x: w.pos.x, y: w.pos.y + 0.8, z: w.pos.z, pitch: 1.1 });
      }
      return 'running';
    }
    w.moveSpeed = 0;
    void dt;
    if (w.state !== 'playbow') {
      b.needs.social = Math.max(0, b.needs.social - 0.4);
      return 'done';
    }
    return 'running';
  }
  override stop(b: WolfBrain): void {
    super.stop(b);
    b.wolf.lookTarget = null;
  }
}

class Shake extends WolfAction {
  readonly id = 'shake';
  readonly icon = '💦';
  private started = false;
  override minTime = 0;
  score(b: WolfBrain): number {
    const w = b.wolf;
    return w.wetness > 0.45 && !w.swimming && w.waterDepth < 0.03 ? 2.5 : 0;
  }
  label(): string {
    return 'Shaking off the water';
  }
  override start(): boolean {
    this.started = false;
    return true;
  }
  update(b: WolfBrain): Status {
    const w = b.wolf;
    w.moveSpeed = 0;
    if (!this.started) {
      if (!w.canAct()) return 'running';
      w.play('shake', { restart: true });
      this.started = true;
      events.emit('shake', { x: w.pos.x, y: w.pos.y + 0.6, z: w.pos.z });
      return 'running';
    }
    if (w.state !== 'shake') {
      w.wetness = 0;
      return 'done';
    }
    return 'running';
  }
  override interruptible(): boolean {
    return false;
  }
}

class Investigate extends WolfAction {
  readonly id = 'investigate';
  readonly icon = '❓';
  private sniffing = 0;
  override minTime = 3;
  score(b: WolfBrain): number {
    const p = b.eco.pointOfInterest;
    if (!p) return 0;
    const d = flatDist(b.wolf.pos, p);
    return d < 45 ? 0.35 + b.needs.curiosity * 0.55 : 0;
  }
  label(): string {
    return this.sniffing > 0 ? 'Sniffing something interesting' : 'Something caught its attention';
  }
  override start(b: WolfBrain): boolean {
    const p = b.eco.pointOfInterest;
    if (!p) return false;
    b.target.copy(p);
    b.eco.pointOfInterest = null;
    this.sniffing = 0;
    b.hasTarget = true;
    return b.follower.setGoal(b.wolf.pos, b.target);
  }
  update(b: WolfBrain, dt: number): Status {
    const w = b.wolf;
    if (this.sniffing > 0) {
      this.sniffing -= dt;
      w.moveSpeed = 0;
      if (this.sniffing <= 0) {
        b.needs.curiosity = Math.max(0, b.needs.curiosity - 0.5);
        if (w.state === 'sniff') w.play('locomotion');
        return 'done';
      }
      return 'running';
    }
    if (b.follower.update(w, w.spec.gait.trotSpeed, dt, 1.5)) {
      this.sniffing = 3;
      if (w.canAct()) w.play('sniff');
    }
    b.steerExtras();
    return 'running';
  }
  override stop(b: WolfBrain): void {
    super.stop(b);
    if (b.wolf.state === 'sniff') b.wolf.play('locomotion');
  }
}

// ------------------------------------------------------------------ brain

export class WolfBrain {
  readonly needs = new Needs();
  readonly follower: PathFollower;
  readonly target = new THREE.Vector3();
  hasTarget = false;
  huntTarget: PreyRef | null = null;
  readonly rnd: Random;
  readonly actions: WolfAction[];
  current: WolfAction | null = null;
  scores: ScoreEntry[] = [];
  thought = 'Waking up';
  icon = '🐺';
  night = 0;
  resting = false;
  sleeping = false;
  private decideT = 0;
  private lookTmp = new THREE.Vector3();
  enabled = true;

  constructor(
    readonly wolf: Animal,
    readonly nav: NavGrid,
    readonly eco: Ecosystem,
    seed: number,
  ) {
    this.follower = new PathFollower(nav);
    this.rnd = new Random(seed);
    this.actions = [new Idle(), new Explore(), new Rest(false), new Rest(true), new Drink(), new Hunt(), new Eat(), new Howl(), new Socialize(), new Shake(), new Investigate()];
  }

  /** Makes the wolf glance at a random nearby point or animal. */
  lookAtRandom(): void {
    const w = this.wolf;
    const near = this.eco.interestingNear(w.pos, 25);
    if (near && this.rnd.chance(0.6)) {
      w.lookTarget = this.lookTmp.copy(near);
      return;
    }
    const a = w.yaw + (this.rnd.next() - 0.5) * 2.2;
    this.lookTmp.set(w.pos.x + Math.sin(a) * 8, w.pos.y + 0.6 + this.rnd.next() * 0.8, w.pos.z + Math.cos(a) * 8);
    w.lookTarget = this.lookTmp;
  }

  /** Obstacle + pack separation applied on top of path following. */
  steerExtras(): void {
    avoidObstacles(this.wolf, this.eco.world.obstacles, 2.5);
    separate(this.wolf, this.eco.wolves, 1.4, 0.5);
  }

  /** Context-only update used while the player is in control. */
  updateNeeds(dt: number): void {
    const w = this.wolf;
    this.needs.update(dt, {
      exertion: w.exertion,
      speed: w.speed,
      resting: this.resting || w.state === 'lie' || w.state === 'sit',
      sleeping: w.state === 'sleep',
      night: this.night,
      nearPack: this.eco.packNearby(w, 9),
    });
  }

  stopCurrent(): void {
    if (this.current) this.current.stop(this);
    this.current = null;
    this.hasTarget = false;
    this.follower.clear();
  }

  update(dt: number, manual: boolean): void {
    this.resting = false;
    this.sleeping = false;
    if (manual || !this.enabled) {
      if (this.current) this.stopCurrent();
      this.updateNeeds(dt);
      this.thought = manual ? this.manualHint() : this.wolf.state === 'howl' ? 'Howling at the moon' : 'Taking in the view';
      this.icon = manual ? '🎮' : '🐺';
      return;
    }
    if (this.current) this.current.t += dt;
    this.decideT -= dt;
    if (this.decideT <= 0 || !this.current) {
      this.decideT = 0.5;
      this.decide();
    }
    if (this.current) {
      const st = this.current.update(this, dt);
      if (st !== 'running') {
        this.current.stop(this);
        this.current = null;
        this.hasTarget = false;
        this.decideT = 0;
      }
    }
    this.updateNeeds(dt);
    if (this.current) {
      this.thought = this.current.label(this);
      this.icon = this.current.icon;
    }
  }

  private decide(): void {
    const scores: ScoreEntry[] = [];
    let best: WolfAction | null = null;
    let bestScore = -Infinity;
    for (const a of this.actions) {
      let s = a.score(this);
      if (a === this.current) s += 0.15;
      scores.push({ id: a.id, score: s });
      if (s > bestScore) {
        bestScore = s;
        best = a;
      }
    }
    scores.sort((a, b) => b.score - a.score);
    this.scores = scores;
    if (!best || best === this.current) return;
    if (this.current) {
      if (!this.current.interruptible(this)) return;
      if (this.current.t < this.current.minTime && bestScore < 1.5) return;
      this.current.stop(this);
    }
    best.t = 0;
    this.follower.clear();
    this.hasTarget = false;
    if (best.start(this)) {
      this.current = best;
    } else {
      this.current = null;
    }
  }

  private manualHint(): string {
    const n = this.needs;
    if (n.thirst > 0.75) return 'Player control — very thirsty (find water, press E)';
    if (n.hunger > 0.75) return 'Player control — starving (hunt deer or hares)';
    if (n.fatigue > 0.8) return 'Player control — exhausted (press X to rest)';
    return 'Player control';
  }

  currentId(): string {
    return this.current?.id ?? 'none';
  }

  reset(): void {
    this.stopCurrent();
    this.needs.reset();
    this.thought = 'Waking up';
  }
}
