/**
 * Simple pack-member AI: keeps formation around the alpha, mirrors its
 * activities (rest, sleep, howl, feed, drink, hunt) with individual delays,
 * and fills idle time with sniffing, sitting and play.
 */
import { hyp } from '../utils/math';
import * as THREE from 'three';
import type { Animal } from '../animal/Animal';
import type { Ecosystem } from '../eco/Ecosystem';
import { PathFollower, avoidObstacles, flatDist, pursuitPoint, separate } from './Steering';
import type { NavGrid } from './NavGrid';
import { Random } from '../utils/Random';
import { angleDiff } from '../utils/math';
import { events } from '../core/Events';

const _v = new THREE.Vector3();

export class PackBrain {
  mode = 'follow';
  thought = 'Following the alpha';
  private follower: PathFollower;
  private rnd: Random;
  private delay = 0;
  private howlCooldown = 0;
  private idleT = 0;
  private repathT = 0;
  private playT = 0;
  readonly target = new THREE.Vector3();
  hasTarget = false;
  private offsetAngle: number;
  private offsetDist: number;

  constructor(
    readonly wolf: Animal,
    readonly index: number,
    private nav: NavGrid,
    private eco: Ecosystem,
    seed: number,
  ) {
    this.follower = new PathFollower(nav);
    this.rnd = new Random(seed);
    this.offsetAngle = Math.PI + (index - 1) * 0.75 + (this.rnd.next() - 0.5) * 0.3;
    this.offsetDist = 2.6 + index * 0.9;
  }

  /** Called when another wolf invites this one to play. */
  invitePlay(from: Animal): void {
    if (!this.wolf.canAct()) return;
    this.wolf.faceYaw = Math.atan2(from.pos.x - this.wolf.pos.x, from.pos.z - this.wolf.pos.z);
    this.playT = 0.5 + this.rnd.next() * 0.5;
  }

  onHowl(): void {
    if (this.howlCooldown > 0) return;
    this.delay = 0.6 + this.index * 0.55 + this.rnd.next() * 0.6;
    this.mode = 'joinHowl';
    this.howlCooldown = 12;
  }

  update(dt: number): void {
    const w = this.wolf;
    const alpha = this.eco.alpha;
    this.howlCooldown -= dt;
    this.hasTarget = false;
    const aState = alpha.state;
    const dAlpha = flatDist(w.pos, alpha.pos);

    if (this.playT > 0) {
      this.playT -= dt;
      w.moveSpeed = 0;
      if (this.playT <= 0 && w.canAct()) {
        w.play('playbow', { restart: true });
        events.emit('bark', { x: w.pos.x, y: w.pos.y + 0.8, z: w.pos.z, pitch: 1.2 + this.index * 0.1 });
      }
      this.thought = 'Playing';
      return;
    }
    if (w.state === 'playbow' || w.state === 'shake' || w.state === 'howl' || w.airborne) {
      w.moveSpeed = 0;
      return;
    }

    // Join howls.
    if (this.mode === 'joinHowl') {
      this.delay -= dt;
      w.moveSpeed = 0;
      this.thought = 'Joining the howl';
      if (this.delay <= 0) {
        if (w.canAct()) w.play('howl', { restart: true });
        this.mode = 'follow';
      }
      return;
    }

    // Shake off water.
    if (w.wetness > 0.5 && !w.swimming && w.waterDepth < 0.03 && w.canAct()) {
      w.play('shake', { restart: true });
      events.emit('shake', { x: w.pos.x, y: w.pos.y + 0.6, z: w.pos.z });
      w.wetness = 0;
      return;
    }

    // Join the hunt when the alpha is chasing.
    const hunt = this.eco.alphaHuntTarget();
    if (hunt && hunt.kind === 'deer' && hunt.animal && this.eco.preyAlive(hunt) && (alpha.speed > 5 || this.eco.preyFleeing(hunt))) {
      this.mode = 'hunt';
      pursuitPoint(w, hunt.animal, _v);
      // flank: offset sideways a little per pack member
      const side = (this.index % 2 === 0 ? 1 : -1) * 2.5;
      const dx = hunt.animal.pos.x - w.pos.x;
      const dz = hunt.animal.pos.z - w.pos.z;
      const len = hyp(dx, dz) || 1;
      if (len > 8) {
        _v.x += (-dz / len) * side;
        _v.z += (dx / len) * side;
      }
      w.moveDir.set(_v.x - w.pos.x, _v.z - w.pos.z);
      w.moveSpeed = w.spec.gait.maxSpeed * 0.97;
      avoidObstacles(w, this.eco.world.obstacles, 5);
      separate(w, this.eco.wolves, 1.6, 0.6);
      if (w.state !== 'locomotion' && w.canAct()) w.play('locomotion');
      this.target.copy(hunt.animal.pos);
      this.hasTarget = true;
      this.thought = 'Hunting with the pack';
      return;
    }

    // Share the kill.
    const carcass = this.eco.nearestCarcass(w.pos, 70);
    if (carcass && (aState === 'eat' || flatDist(alpha.pos, carcass.pos) < 10 || carcass.food > 0.4)) {
      this.mode = 'eat';
      this.eco.feedingSpot(carcass, w, this.target);
      this.hasTarget = true;
      const d = flatDist(w.pos, this.target);
      if (d > 0.7) {
        if (w.state === 'eat') w.play('locomotion');
        this.goTo(this.target, d > 12 ? w.spec.gait.trotSpeed : w.spec.gait.walkSpeed, dt);
        this.thought = 'Going to the kill';
      } else {
        w.moveSpeed = 0;
        w.faceYaw = Math.atan2(carcass.pos.x - w.pos.x, carcass.pos.z - w.pos.z);
        if (Math.abs(angleDiff(w.yaw, w.faceYaw)) < 0.35 && w.state !== 'eat' && w.canAct()) w.play('eat');
        if (w.state === 'eat') carcass.food = Math.max(0, carcass.food - dt / 40);
        this.thought = 'Feeding';
      }
      return;
    }
    if (w.state === 'eat') w.play('locomotion');

    // Rest / sleep near the alpha.
    if (aState === 'lie' || aState === 'sleep') {
      this.mode = 'rest';
      this.formationPoint(alpha, this.target, 0.8);
      const d = flatDist(w.pos, this.target);
      if (d > 1.2 && w.state !== 'lie' && w.state !== 'sleep') {
        this.goTo(this.target, w.spec.gait.walkSpeed, dt);
        this.thought = 'Settling down near the alpha';
      } else {
        w.moveSpeed = 0;
        if (w.state !== aState && w.canAct()) {
          this.delay -= dt;
          if (this.delay <= 0) {
            w.play(aState);
            this.delay = 1 + this.rnd.next() * 2;
          }
        }
        this.thought = aState === 'sleep' ? 'Sleeping' : 'Resting';
      }
      return;
    }
    if ((w.state === 'lie' || w.state === 'sleep') && this.rnd.next() < dt * 1.5) w.play('locomotion');

    // Drink alongside the alpha.
    if (aState === 'drink' && dAlpha < 20) {
      this.mode = 'drink';
      if (this.nav.nearestShore(w.pos.x, w.pos.z, this.target)) {
        const d = flatDist(w.pos, this.target);
        if (d > 1.0 && w.state !== 'drink') this.goTo(this.target, w.spec.gait.walkSpeed, dt);
        else {
          w.moveSpeed = 0;
          w.faceYaw = this.eco.waterDirection(w.pos);
          if (w.state !== 'drink' && Math.abs(angleDiff(w.yaw, w.faceYaw)) < 0.3 && w.canAct()) w.play('drink');
        }
        this.thought = 'Drinking';
        return;
      }
    }
    if (w.state === 'drink' && aState !== 'drink') w.play('locomotion');

    // Follow in formation.
    this.mode = 'follow';
    this.formationPoint(alpha, this.target, 1);
    const d = flatDist(w.pos, this.target);
    this.hasTarget = d > 2;
    if (d > 2.0) {
      if (w.state === 'sit' || w.state === 'sniff') w.play('locomotion');
      const want = Math.min(w.spec.gait.maxSpeed, Math.max(alpha.speed * (d > 6 ? 1.25 : 1.0), d > 10 ? w.spec.gait.trotSpeed * 1.4 : w.spec.gait.walkSpeed));
      this.goTo(this.target, want, dt);
      this.idleT = 0;
      this.thought = alpha.speed > 5 ? 'Running with the pack' : 'Following the alpha';
    } else {
      w.moveSpeed = 0;
      w.faceYaw = null;
      this.idleT += dt;
      if (this.idleT > 4 && w.canAct()) {
        const r = this.rnd.next();
        if (r < dt * 0.25 && w.state === 'locomotion') w.play('sit');
        else if (r > 1 - dt * 0.12 && w.state === 'locomotion') w.play('sniff');
        else if (w.state === 'sniff' && this.rnd.next() < dt * 0.4) w.play('locomotion');
      }
      w.lookTarget = this.rnd.next() < 0.5 ? alpha.root.position : null;
      this.thought = w.state === 'sit' ? 'Sitting' : 'Watching';
    }
  }

  private formationPoint(alpha: Animal, out: THREE.Vector3, scale: number): void {
    const a = alpha.yaw + this.offsetAngle;
    out.set(alpha.pos.x + Math.sin(a) * this.offsetDist * scale, 0, alpha.pos.z + Math.cos(a) * this.offsetDist * scale);
    if (!this.nav.walkable(out.x, out.z)) this.nav.nearestWalkable(out.x, out.z, out, 3);
    out.y = alpha.pos.y;
  }

  private goTo(p: THREE.Vector3, speed: number, dt: number): void {
    const w = this.wolf;
    const d = flatDist(w.pos, p);
    if (d > 18 && !this.nav.lineOfSight(w.pos.x, w.pos.z, p.x, p.z)) {
      this.repathT -= dt;
      if (this.repathT <= 0 || !this.follower.hasGoal) {
        this.repathT = 2;
        this.follower.setGoal(w.pos, p);
      }
      this.follower.update(w, speed, dt, 1);
    } else {
      w.moveDir.set(p.x - w.pos.x, p.z - w.pos.z);
      w.moveSpeed = speed * Math.min(1, Math.max(0.4, d / 3));
    }
    avoidObstacles(w, this.eco.world.obstacles, 2.5);
    separate(w, this.eco.wolves, 1.6, 0.7);
  }

  reset(): void {
    this.mode = 'follow';
    this.follower.clear();
    this.playT = 0;
  }
}
