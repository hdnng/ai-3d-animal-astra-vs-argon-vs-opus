import * as T from "three";
import { Fox, AnimalState } from "../animal/Fox";
import { World } from "../world/World";
import { heightAt } from "../world/terrain";
import { clamp, random, angleDelta } from "../utils/math";
import { Navigation } from "./Navigation";
export class Brain {
  needs = { hunger: 26, thirst: 33, energy: 84 };
  target = new T.Vector3(-7, 0, -3);
  thought = "A familiar scent on the breeze";
  intent = "explore";
  path: T.Vector3[] = [];
  timer = 0;
  actionTimer = 4;
  private rnd = random(823);
  decisions = 0;
  manual = false;
  distance = 0;
  navigation: Navigation;
  constructor(
    public fox: Fox,
    public world: World,
  ) {
    this.navigation = new Navigation(world);
  }
  reset() {
    this.needs = { hunger: 26, thirst: 33, energy: 84 };
    this.target.set(-7, 0, -3);
    this.path = [];
    this.timer = 0;
    this.actionTimer = 0;
    this.intent = "explore";
    this.thought = "A familiar scent on the breeze";
    this.distance = 0;
    this.manual = false;
    this.decisions = 0;
    this.rnd = random(823);
    this.fox.root.position.set(-3, 0, 3);
    this.fox.heading = 0.7;
    this.fox.setState("idle");
    this.fox.weights = { idle: 1 };
    this.fox.speed = 0;
    this.fox.phase = 0;
    this.fox.time = 0;
    this.fox.legs.forEach((l) => (l.plantValid = false));
  }
  action(s: AnimalState) {
    this.fox.setState(s);
    this.actionTimer =
      s === "jump"
        ? 0.9
        : s === "howl"
          ? 3
          : s === "shake"
            ? 1.8
            : s === "sleep"
              ? 12
              : 5;
  }
  update(dt: number) {
    const f = this.fox,
      n = this.needs;
    n.hunger = clamp(n.hunger + dt * 0.18, 0, 100);
    n.thirst = clamp(n.thirst + dt * 0.27, 0, 100);
    n.energy = clamp(n.energy - dt * (f.speed > 0.2 ? 0.24 : 0.035), 0, 100);
    if (f.state === "eat") n.hunger = clamp(n.hunger - dt * 10, 0, 100);
    if (f.state === "drink") n.thirst = clamp(n.thirst - dt * 15, 0, 100);
    if (f.state === "sleep") n.energy = clamp(n.energy + dt * 5, 0, 100);
    if (this.actionTimer > 0) {
      this.actionTimer -= dt;
      if (this.actionTimer <= 0) {
        f.setState("idle");
        this.timer = 0;
      }
      return 0;
    }
    if (this.manual) return 0;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.decide();
      this.timer = 4;
    }
    let target = this.path[0] || this.target;
    const dist = Math.hypot(
      target.x - f.root.position.x,
      target.z - f.root.position.z,
    );
    if (dist < 0.55) {
      if (this.path.length > 1) {
        this.path.shift();
        target = this.path[0];
      } else {
        this.path = [];
        if (
          this.intent === "eat" ||
          this.intent === "drink" ||
          this.intent === "sleep"
        ) {
          this.action(this.intent);
          this.thought =
            this.intent === "eat"
              ? "Sweet berries. Just what I needed."
              : this.intent === "drink"
                ? "A quiet drink at the water’s edge."
                : "Safe in the shade. Time to rest.";
        } else {
          this.action(this.rnd() < 0.16 ? "howl" : "idle");
          this.actionTimer = 2 + this.rnd() * 3;
          this.thought = "Listening to the woodland";
        }
        return 0;
      }
    }
    const desired = Math.atan2(
      target.x - f.root.position.x,
      target.z - f.root.position.z,
    );
    const turn = angleDelta(f.heading, desired);
    const delta = clamp(turn, -dt * 2.5, dt * 2.5);
    f.heading += delta;
    f.turnRate = delta / Math.max(dt, 0.001);
    let speed =
      Math.abs(turn) > 1.1 ? 0.15 : this.intent === "chase" ? 3.9 : 1.15;
    f.setState(Math.abs(turn) > 1.1 ? "turn" : speed > 2 ? "run" : "walk");
    return speed;
  }
  decide() {
    this.decisions++;
    const n = this.needs,
      f = this.fox;
    const choices = [
      { id: "eat", score: n.hunger / 100 },
      { id: "drink", score: n.thirst / 100 },
      { id: "sleep", score: (100 - n.energy) / 100 },
      { id: "explore", score: 0.32 + this.rnd() * 0.12 },
      { id: "chase", score: 0.22 + this.rnd() * 0.23 },
    ].sort((a, b) => b.score - a.score);
    this.intent = choices[0].id;
    if (this.intent === "eat") {
      this.target.copy(
        this.world.food.reduce((a, b) =>
          a.distanceToSquared(f.root.position) <
          b.distanceToSquared(f.root.position)
            ? a
            : b,
        ),
      );
      this.thought = "Following the scent of ripe berries";
    } else if (this.intent === "drink") {
      this.target.set(-1.15, 0, 3);
      this.thought = "Looking for a quiet place to drink";
    } else if (this.intent === "sleep") {
      this.target.copy(f.root.position);
      this.thought = "Finding a sheltered place to curl up";
    } else if (this.intent === "chase") {
      const r =
        this.world.rabbits[Math.floor(this.rnd() * this.world.rabbits.length)];
      this.target.set(r.x, 0, r.z);
      this.thought = "Something is moving in the grass";
    } else {
      for (let tries = 0; tries < 30; tries++) {
        const a = this.rnd() * 6.28,
          r = 3 + this.rnd() * 13;
        this.target.set(
          f.root.position.x + Math.sin(a) * r,
          0,
          f.root.position.z + Math.cos(a) * r,
        );
        if (!this.world.blocked(this.target.x, this.target.z)) break;
      }
      this.thought = [
        "A familiar scent on the breeze",
        "Exploring beyond the clearing",
        "Following a trail through the ferns",
      ][Math.floor(this.rnd() * 3)];
    }
    this.target.y = heightAt(this.target.x, this.target.z);
    this.path = this.navigation.path(f.root.position, this.target);
    if (this.path.length === 0 && this.target.distanceTo(f.root.position) > 1) {
      this.intent = "explore";
      this.target.copy(f.root.position);
      this.thought = "Pausing to find another trail";
    }
  }
  move(speed: number, dt: number) {
    const f = this.fox,
      x = f.root.position.x + Math.sin(f.heading) * speed * dt,
      z = f.root.position.z + Math.cos(f.heading) * speed * dt;
    if (!this.world.blocked(x, z, 0.31)) {
      f.root.position.x = x;
      f.root.position.z = z;
      this.distance += Math.abs(speed) * dt;
      return speed;
    }
    if (!this.manual) {
      this.timer = Math.min(this.timer, 0.5);
      f.heading += dt * 3;
    }
    return 0;
  }
}
