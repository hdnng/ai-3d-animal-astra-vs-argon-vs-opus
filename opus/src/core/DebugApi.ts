/**
 * Debug / automation API exposed on window.__lupus. Used by the Playwright
 * smoke test, screenshot capture, benchmark and long-run scripts.
 */
import * as THREE from 'three';
import type { App } from './App';
import type { CameraMode } from '../render/CameraRig';

export interface LupusApi {
  app: App;
  ready: boolean;
  snapshot(): Record<string, unknown>;
  setTime(h: number): void;
  setCamera(mode: CameraMode): void;
  setView(px: number, py: number, pz: number, tx: number, ty: number, tz: number): void;
  viewWolf(distance: number, yawOffset: number, height: number): void;
  step(seconds: number, dt?: number): void;
  press(code: string): void;
  hold(code: string, down: boolean): void;
  pause(p: boolean): void;
}

declare global {
  interface Window {
    __lupus?: LupusApi;
  }
}

export function installDebugApi(app: App): void {
  const api: LupusApi = {
    app,
    ready: true,
    snapshot() {
      const w = app.wolf;
      const r = app.renderer.renderer;
      const b = app.eco.alphaBrain;
      return {
        frame: app.frame,
        fps: app.fps,
        cpuMs: app.cpuMs,
        time: app.world.dayNight.time,
        state: w.state,
        motion: w.describeMotion(),
        action: b.currentId(),
        thought: b.thought,
        needs: { hunger: b.needs.hunger, thirst: b.needs.thirst, fatigue: b.needs.fatigue, social: b.needs.social, curiosity: b.needs.curiosity },
        counts: app.eco.counts(),
        weather: app.weather.describe(),
        quality: app.adaptive.describe(),
        qualityLevel: app.adaptive.level,
        hud: (document.querySelector('.wolf-state')?.textContent ?? '') + ' | ' + (document.querySelector('.wolf-action')?.textContent ?? ''),
        speed: w.speed,
        pos: [w.pos.x, w.pos.y, w.pos.z],
        yaw: w.yaw,
        manual: app.manual,
        camera: app.cameraRig.mode,
        drawCalls: r.info.render.calls,
        triangles: r.info.render.triangles,
        geometries: r.info.memory.geometries,
        textures: r.info.memory.textures,
      };
    },
    setTime(h) {
      app.world.dayNight.setTime(h);
    },
    setCamera(mode) {
      app.setCameraMode(mode);
    },
    setView(px, py, pz, tx, ty, tz) {
      app.cameraRig.setFixedView(new THREE.Vector3(px, py, pz), new THREE.Vector3(tx, ty, tz));
    },
    viewWolf(distance, yawOffset, height) {
      const w = app.wolf;
      const a = w.yaw + yawOffset;
      const p = w.root.position;
      app.cameraRig.setFixedView(
        new THREE.Vector3(p.x + Math.sin(a) * distance, p.y + height, p.z + Math.cos(a) * distance),
        new THREE.Vector3(p.x, p.y + 0.55, p.z),
      );
    },
    step(seconds, dt = 1 / 60) {
      const n = Math.round(seconds / dt);
      for (let i = 0; i < n; i++) {
        app.step(dt);
        app.input.endFrame();
      }
    },
    press(code) {
      app.input.inject(code);
    },
    pause(p) {
      app.paused = p;
    },
    hold(code, down) {
      if (down) app.input.inject(code, true);
      else app.input.release(code);
    },
  };
  window.__lupus = api;
}
