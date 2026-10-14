import * as T from "three";
import { Fox, AnimalState } from "../animal/Fox";
import { Renderer, CameraMode } from "../render/Renderer";
import { World } from "../world/World";
import { Particles } from "../world/Particles";
import { pondDistance, heightAt } from "../world/terrain";
import { Brain } from "../ai/Brain";
import { Input } from "./Input";
import { AudioEngine } from "../audio/Audio";
import { HUD } from "../ui/HUD";
import { ContactShadows } from "../render/ContactShadows";
export class Simulation {
  view: Renderer;
  world = new World();
  fox = new Fox();
  brain = new Brain(this.fox, this.world);
  particles = new Particles();
  input = new Input();
  audio = new AudioEngine();
  contactShadows = new ContactShadows();
  hud: HUD;
  time = 0;
  hour = 16;
  timeSpeed = 1;
  fps = 60;
  frameMs = 16.67;
  paused = false;
  ready = false;
  frames: number[] = [];
  recording = false;
  private last = 0;
  private raf = 0;
  private uiTimer = 0;
  private qualityTimer = 0;
  private chirpTimer = 0;
  private line: T.Line;
  private linePositions = new Float32Array(256 * 3);
  private destroyed = false;
  private accumulator = 0;
  private lookTarget = new T.Vector3();
  constructor(container: HTMLElement) {
    this.view = new Renderer(container);
    this.view.scene.add(
      this.world.group,
      this.fox.root,
      this.fox.skeleton,
      this.particles.group,
      this.contactShadows.group,
    );
    this.view.camera.position.set(2, 3.3, 9.7);
    this.view.controls.target.set(-3, 0.75, 3);
    const g = new T.BufferGeometry();
    g.setAttribute(
      "position",
      new T.BufferAttribute(this.linePositions, 3).setUsage(T.DynamicDrawUsage),
    );
    g.setDrawRange(0, 0);
    this.line = new T.Line(
      g,
      new T.LineBasicMaterial({ color: "#f2c87f", depthTest: false }),
    );
    this.line.visible = false;
    this.line.frustumCulled = false;
    this.view.scene.add(this.line);
    this.hud = new HUD({
      manual: () => this.toggleManual(),
      camera: (mode) => this.camera(mode as CameraMode),
      action: (s) => this.action(s as AnimalState),
      audio: () =>
        void this.audio
          .toggle()
          .then((m) => this.hud.setMuted(m))
          .catch(() => this.hud.toast("Audio is unavailable in this browser")),
      reset: () => this.reset(),
      setting: (n, v) => this.setting(n, v),
    });
    this.input.onAction = (k) => {
      if (k === "m") this.toggleManual();
      else if (k === " ") this.action("jump");
      else if (k === "h") this.action("howl");
      else if (k === "q") this.action("shake");
      else if (k === "r") this.action("sleep");
      else if (k === "e") {
        const p = this.fox.root.position;
        if (pondDistance(p.x, p.z) < 1.4) this.action("drink");
        else if (this.world.food.some((f) => f.distanceTo(p) < 1.5))
          this.action("eat");
        else this.hud.toast("Find a berry bush or the water’s edge to forage");
      } else if (k === "c") {
        const modes: CameraMode[] = ["follow", "orbit", "cinematic"];
        this.camera(modes[(modes.indexOf(this.view.mode) + 1) % 3]);
      }
    };
    void this.begin();
  }
  private async begin() {
    try {
      await this.view.warmup();
      if (this.destroyed) return;
      this.ready = true;
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
      document.querySelector("#loading")?.remove();
    } catch {
      if (this.destroyed) return;
      const loading = document.querySelector("#loading");
      if (loading)
        loading.textContent =
          "The woodland needs WebGL2. Please enable hardware acceleration and reload.";
    }
  }
  toggleManual() {
    this.brain.manual = !this.brain.manual;
    this.brain.actionTimer = 0;
    this.fox.setState("idle");
    this.hud.toast(
      this.brain.manual
        ? "You’re in control · WASD to move, Shift to run"
        : "Ember is following her instincts",
    );
  }
  camera(mode: CameraMode) {
    this.view.mode = mode;
    this.view.autoAngle = Math.atan2(
      this.view.camera.position.x - this.fox.root.position.x,
      this.view.camera.position.z - this.fox.root.position.z,
    );
  }
  action(s: AnimalState) {
    if (this.fox.state === s && s === "sleep") {
      this.brain.actionTimer = 0;
      this.fox.setState("idle");
      return;
    }
    this.brain.action(s);
    if (s === "howl") this.audio.call();
    this.hud.toast(
      (
        {
          jump: "A little leap into the unknown",
          howl: "A call across the clearing",
          shake: "Shake the woodland dust away",
          sleep: "A quiet moment beneath the trees",
          eat: "Foraging in the undergrowth",
          drink: "Cool water, slow moments",
        } as Partial<Record<AnimalState, string>>
      )[s] || s,
    );
  }
  setting(name: string, value: string | boolean) {
    switch (name) {
      case "shadows":
        this.view.setShadows(value as string);
        break;
      case "resolution":
        this.view.setScale(+value);
        break;
      case "post":
        this.view.post = !!value;
        break;
      case "weather":
        this.world.weather = !!value;
        break;
      case "adaptive":
        this.view.adaptive = !!value;
        break;
      case "timeSpeed":
        this.timeSpeed = +value;
        break;
      case "hour":
        this.hour = +value;
        break;
      case "skeleton":
        this.fox.skeleton.visible = !!value;
        break;
      case "target":
        this.line.visible = !!value;
        break;
      case "wireframe":
        this.fox.root.traverse((o) => {
          const m = o as T.Mesh;
          if (m.material) {
            (Array.isArray(m.material) ? m.material : [m.material]).forEach(
              (mat) => {
                if (mat instanceof T.MeshStandardMaterial)
                  mat.wireframe = !!value;
              },
            );
          }
        });
        break;
    }
  }
  reset() {
    this.brain.reset();
    this.time = 0;
    this.hour = 16;
    this.timeSpeed = 1;
    this.world.weather = false;
    this.camera("follow");
    this.fox.skeleton.visible = false;
    this.line.visible = false;
    this.setting("wireframe", false);
    this.particles.clear();
    this.world.resetWildlife();
    this.hud.resetControls();
    this.input.keys.clear();
    this.hud.toast("A new day in the clearing");
  }
  step(dt: number) {
    this.time += dt;
    this.hour = (this.hour + (dt * this.timeSpeed) / 30) % 24;
    let speed = this.brain.update(dt);
    const f = this.fox;
    if (this.brain.manual) {
      const moving = this.input.has("w", "arrowup", "s", "arrowdown");
      if (moving && this.brain.actionTimer > 0 && f.state !== "jump") {
        this.brain.actionTimer = 0;
        f.setState("idle");
      }
      if (this.brain.actionTimer <= 0 || f.state === "jump") {
        speed = moving ? (this.input.has("shift") ? 4.4 : 1.65) : 0;
        if (this.input.has("s", "arrowdown")) speed *= -0.65;
        const turn =
          (this.input.has("a", "arrowleft") ? 1 : 0) -
          (this.input.has("d", "arrowright") ? 1 : 0);
        f.heading += turn * dt * 2.1;
        f.turnRate = turn * 2.1;
        if (this.brain.actionTimer <= 0)
          f.setState(
            Math.abs(speed) > 2
              ? "run"
              : speed
                ? "walk"
                : turn
                  ? "turn"
                  : "idle",
          );
      }
    }
    speed = this.brain.move(speed, dt);
    f.update(
      dt,
      Math.abs(speed),
      this.brain.manual
        ? this.lookTarget
            .set(Math.sin(f.heading) * 4, 0, Math.cos(f.heading) * 4)
            .add(f.root.position)
        : this.brain.target,
    );
    for (const p of f.footfalls) {
      const water = pondDistance(p.x, p.z) < 1.35;
      this.particles.emit(p, water);
      this.audio.step(water);
    }
    this.world.update(
      dt,
      this.time,
      f.root.position,
      this.view.camera.position,
      this.hour,
    );
    this.particles.update(
      dt,
      this.time,
      f.root.position,
      this.world.weather,
      this.hour,
    );
    this.view.update(dt, f.root.position, this.hour, this.time);
    this.contactShadows.update(f);
    this.chirpTimer += dt;
    if (this.chirpTimer > 8) {
      this.chirpTimer = 0;
      this.audio.chirp();
    }
    if (this.line.visible) {
      const pts = [f.root.position, ...this.brain.path];
      const n = Math.min(pts.length, 256);
      for (let i = 0; i < n; i++)
        this.linePositions.set([pts[i].x, pts[i].y + 0.14, pts[i].z], i * 3);
      this.line.geometry.attributes.position.needsUpdate = true;
      this.line.geometry.setDrawRange(0, n);
    }
  }
  private frame = (now: number) => {
    if (this.destroyed) return;
    const raw = Math.max(1, now - this.last);
    this.last = now;
    if (this.recording && this.frames.length < 120000) this.frames.push(raw);
    this.frameMs = this.frameMs * 0.95 + raw * 0.05;
    this.fps = 1000 / this.frameMs;
    if (!this.paused) {
      this.accumulator += Math.min(raw / 1000, 0.1);
      while (this.accumulator >= 1 / 60) {
        this.step(1 / 60);
        this.accumulator -= 1 / 60;
      }
    }
    this.view.render();
    this.uiTimer += raw / 1000;
    if (this.uiTimer > 0.2) {
      this.hud.update(
        this.brain,
        this.view,
        this.world,
        this.fps,
        this.frameMs,
        this.hour,
      );
      this.uiTimer = 0;
    }
    this.qualityTimer += raw / 1000;
    if (this.qualityTimer > 4 && this.view.adaptive) {
      if (this.fps < 54) {
        if (this.view.scale > 0.65) {
          this.view.setScale(
            Math.max(0.6, Math.round((this.view.scale - 0.1) * 10) / 10),
          );
        } else if (this.view.quality === "high") this.view.setShadows("medium");
        else if (this.view.post) this.view.post = false;
        else if (this.fps < 40 && this.view.quality !== "off")
          this.view.setShadows("off");
      }
      this.qualityTimer = 0;
    }
    this.raf = requestAnimationFrame(this.frame);
  };
  getStats() {
    return {
      ready: this.ready,
      state: this.fox.state,
      manual: this.brain.manual,
      position: this.fox.root.position.toArray(),
      needs: { ...this.brain.needs },
      hour: this.hour,
      time: this.time,
      fps: this.fps,
      frameMs: this.frameMs,
      footError: this.fox.footError,
      bones: this.fox.bones.length,
      entities: this.world.animalCount + 1,
      vegetation: this.world.vegetationCount,
      decisions: this.brain.decisions,
      drawCalls: this.view.renderer.info.render.calls,
      triangles: this.view.renderer.info.render.triangles,
      geometries: this.view.renderer.info.memory.geometries,
      textures: this.view.renderer.info.memory.textures,
      quality: {
        shadows: this.view.quality,
        scale: this.view.scale,
        post: this.view.post,
      },
      camera: this.view.mode,
    };
  }
  snapshot(hour: number, angle: number, distance = 7) {
    this.brain.manual = true;
    this.brain.actionTimer = 0;
    this.fox.root.position.set(-3, 0, 3);
    this.fox.heading = 0.65;
    this.fox.setState("idle");
    this.hour = hour;
    this.timeSpeed = 0;
    this.view.mode = "orbit";
    this.view.controls.target.set(-3, heightAt(-3, 3) + 0.85, 3);
    this.view.camera.position.set(
      -3 + Math.sin(angle) * distance,
      heightAt(-3, 3) + distance * 0.36,
      3 + Math.cos(angle) * distance,
    );
    this.view.controls.update();
  }
  dispose() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.input.dispose();
    this.audio.dispose();
    this.hud.dispose();
    this.view.dispose();
  }
}
