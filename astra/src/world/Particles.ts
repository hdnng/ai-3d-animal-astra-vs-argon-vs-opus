import * as T from "three";
import { random } from "../utils/math";
import { heightAt } from "./terrain";
export class Particles {
  group = new T.Group();
  points: T.Points;
  rain: T.LineSegments;
  flies: T.Points;
  private positions = new Float32Array(768 * 3);
  private colors = new Float32Array(768 * 3);
  private velocities = new Float32Array(768 * 3);
  private lives = new Float32Array(768);
  private cursor = 0;
  private rnd = random(42);
  private rainPos = new Float32Array(420 * 6);
  private fliesPos = new Float32Array(90 * 3);
  constructor() {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const c = canvas.getContext("2d")!,
      g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,.6)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
    const map = new T.CanvasTexture(canvas);
    const geo = new T.BufferGeometry();
    this.positions.fill(-999);
    geo.setAttribute(
      "position",
      new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage),
    );
    geo.setAttribute(
      "color",
      new T.BufferAttribute(this.colors, 3).setUsage(T.DynamicDrawUsage),
    );
    this.points = new T.Points(
      geo,
      new T.PointsMaterial({
        size: 0.12,
        map,
        transparent: true,
        depthWrite: false,
        vertexColors: true,
      }),
    );
    this.points.frustumCulled = false;
    this.group.add(this.points);
    const rg = new T.BufferGeometry();
    rg.setAttribute(
      "position",
      new T.BufferAttribute(this.rainPos, 3).setUsage(T.DynamicDrawUsage),
    );
    this.rain = new T.LineSegments(
      rg,
      new T.LineBasicMaterial({
        color: "#c3dddb",
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      }),
    );
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.group.add(this.rain);
    const fg = new T.BufferGeometry();
    fg.setAttribute(
      "position",
      new T.BufferAttribute(this.fliesPos, 3).setUsage(T.DynamicDrawUsage),
    );
    this.flies = new T.Points(
      fg,
      new T.PointsMaterial({
        size: 0.09,
        color: "#e6ed9c",
        map,
        transparent: true,
        opacity: 0.75,
        blending: T.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.flies.frustumCulled = false;
    this.group.add(this.flies);
  }
  clear() {
    this.lives.fill(0);
    this.positions.fill(-999);
    this.cursor = 0;
    this.points.geometry.attributes.position.needsUpdate = true;
  }
  emit(p: T.Vector3, water = false, count = 5) {
    for (let k = 0; k < count; k++) {
      const i = this.cursor++ % 768,
        n = i * 3;
      this.positions[n] = p.x;
      this.positions[n + 1] = p.y + 0.04;
      this.positions[n + 2] = p.z;
      this.velocities[n] = (this.rnd() - 0.5) * 0.45;
      this.velocities[n + 1] = 0.2 + this.rnd() * 0.4;
      this.velocities[n + 2] = (this.rnd() - 0.5) * 0.45;
      this.lives[i] = 0.4 + this.rnd() * 0.5;
      this.colors[n] = water ? 0.5 : 0.65;
      this.colors[n + 1] = water ? 0.8 : 0.55;
      this.colors[n + 2] = water ? 0.85 : 0.36;
    }
    this.points.geometry.attributes.color.needsUpdate = true;
  }
  update(dt: number, t: number, p: T.Vector3, rain: boolean, hour: number) {
    for (let i = 0; i < 768; i++) {
      if (this.lives[i] > 0) {
        this.lives[i] -= dt;
        const n = i * 3;
        for (let a = 0; a < 3; a++)
          this.positions[n + a] += this.velocities[n + a] * dt;
        this.velocities[n + 1] -= dt * 0.45;
        if (this.lives[i] <= 0) this.positions[n + 1] = -999;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.rain.visible = rain;
    if (rain) {
      for (let i = 0; i < 420; i++) {
        const x = p.x + Math.sin(i * 127.1) * 14,
          z = p.z + Math.sin(i * 77.3) * 14,
          y = ((((i * 0.618 - t * 7) % 12) + 12) % 12) + p.y;
        this.rainPos.set([x, y, z, x - 0.07, y + 0.3, z], i * 6);
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    this.flies.visible = hour < 7 || hour > 18;
    for (let i = 0; i < 90; i++) {
      const x = p.x + Math.sin(i * 22.1 + t * 0.08) * 12,
        z = p.z + Math.cos(i * 12.8 + t * 0.06) * 12;
      this.fliesPos.set(
        [x, heightAt(x, z) + 0.6 + Math.sin(t + i) * 0.3, z],
        i * 3,
      );
    }
    this.flies.geometry.attributes.position.needsUpdate = true;
  }
}
