// Captures showcase screenshots from several camera angles and times of day
// into ./screenshots (headless Chromium, GPU accelerated).
// Usage: npm run screenshots
import { startServer, launch, openApp, gpuInfo, ROOT } from './lib/harness.mjs';
import path from 'node:path';
import fs from 'node:fs';

const outDir = path.join(ROOT, 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

/** Each shot runs a setup function in the page, waits, then captures. */
const SHOTS = [
  {
    name: '01_golden_hour_follow_hud',
    wait: 2500,
    setup: (api) => {
      api.app.settings.set('showHud', true);
      api.setTime(17.1);
      api.app.setManual(false);
      api.setCamera('follow');
    },
  },
  {
    name: '02_wolf_portrait',
    wait: 1200,
    setup: (api) => {
      api.app.settings.set('showHud', false);
      api.setTime(16.9);
      const w = api.app.wolf;
      w.place(-10, -12, 0.6);
      api.app.eco.alphaBrain.stopCurrent();
      api.app.eco.alphaBrain.enabled = false;
      w.play('sit');
      api.step(2.5);
      w.lookTarget = null;
      const p = w.root.position;
      const a = w.yaw + 0.75;
      api.setView(p.x + Math.sin(a) * 2.1, p.y + 1.05, p.z + Math.cos(a) * 2.1, p.x + Math.sin(w.yaw) * 0.35, p.y + 0.95, p.z + Math.cos(w.yaw) * 0.35);
    },
  },
  {
    name: '03_lake_noon_wide',
    wait: 2000,
    setup: (api) => {
      api.app.eco.alphaBrain.enabled = true;
      api.setTime(12.4);
      api.setView(-12, 16, -32, 38, 0, 26);
    },
  },
  {
    name: '04_night_moonlight',
    wait: 2500,
    setup: (api) => {
      api.setTime(22.4);
      const w = api.app.wolf;
      w.place(14, 2, -2.2);
      api.app.eco.alphaBrain.stopCurrent();
      api.app.eco.alphaBrain.enabled = false;
      w.play('howl', { restart: true });
      api.step(2.2);
      const p = w.root.position;
      const a = w.yaw + 2.2;
      api.setView(p.x + Math.sin(a) * 4.2, p.y + 0.5, p.z + Math.cos(a) * 4.2, p.x, p.y + 1.4, p.z);
    },
  },
  {
    name: '05_rainstorm',
    wait: 3000,
    setup: (api) => {
      api.app.eco.alphaBrain.enabled = true;
      api.setTime(14.5);
      const wth = api.app.weather;
      wth.setMode('rain');
      wth.rain = 1;
      wth.cloud = 0.95;
      wth.wetness = 0.85;
      api.step(0.5);
      api.setCamera('follow');
    },
  },
  {
    name: '06_hunt_gallop',
    wait: 150,
    setup: (api) => {
      const app = api.app;
      app.weather.setMode('clear');
      app.weather.rain = 0;
      app.weather.cloud = 0.3;
      app.weather.wetness = 0;
      api.setTime(15.8);
      const e = app.eco;
      // Fresh herd (deterministic start), then line the chase up so the deer
      // flees across the open meadow toward M.
      e.reset();
      api.step(0.5);
      const M = { x: 5, z: -5 };
      let d = null;
      let best = Infinity;
      e.deer.forEach((x, i) => {
        const dist = Math.hypot(x.pos.x - M.x, x.pos.z - M.z);
        if (e.deerBrains[i].mode !== 'dead' && x.root.visible && dist < best) {
          best = dist;
          d = x;
        }
      });
      const ux = (M.x - d.pos.x) / best;
      const uz = (M.z - d.pos.z) / best;
      const w = app.wolf;
      w.place(d.pos.x - ux * 12, d.pos.z - uz * 12, Math.atan2(ux, uz));
      e.alphaBrain.enabled = true;
      e.alphaBrain.needs.hunger = 1;
      e.alphaBrain.stopCurrent();
      // Advance until the chase reaches a full gallop (deterministic framing).
      for (let i = 0; i < 120 && w.speed < 9; i++) api.step(0.1);
      api.step(0.3);
      // Side-on tracking view: try several angles and distances and keep the
      // one with the fewest nearby trees inside the view cone (clutter score).
      const p = w.root.position;
      const target = p.clone();
      target.set(p.x + Math.sin(w.yaw) * 1.5, p.y + 0.6, p.z + Math.cos(w.yaw) * 1.5);
      let cam = null;
      let bestScore = Infinity;
      for (const off of [Math.PI / 2, -Math.PI / 2, Math.PI / 3, -Math.PI / 3, (2 * Math.PI) / 3, (-2 * Math.PI) / 3]) {
        for (const dist of [5, 6.5]) {
          const a = w.yaw + off;
          const c = target.clone();
          c.set(target.x + Math.sin(a) * dist, p.y + 1.0, target.z + Math.cos(a) * dist);
          const vx = target.x - c.x;
          const vz = target.z - c.z;
          let score = app.world.occluded(c, target) ? 100 : 0;
          for (const t of app.world.vegetation.trees) {
            const tx = t.x - c.x;
            const tz = t.z - c.z;
            const d = Math.hypot(tx, tz);
            if (d > 14) continue;
            const cos = (tx * vx + tz * vz) / (d * Math.hypot(vx, vz) + 1e-6);
            if (cos > 0.75 || d < 2) score += 6 / Math.max(d, 1);
          }
          if (score < bestScore) {
            bestScore = score;
            cam = c;
          }
        }
      }
      api.setView(cam.x, cam.y, cam.z, target.x, target.y, target.z);
      api.pause(true);
    },
  },
  {
    name: '07_pack_howl_dusk',
    wait: 2500,
    setup: (api) => {
      api.pause(false);
      const app = api.app;
      app.eco.reset();
      api.setTime(19.25);
      app.eco.alphaBrain.enabled = false;
      api.step(1);
      app.wolf.play('howl', { restart: true });
      api.step(2.4);
      const p = app.wolf.root.position;
      const a = app.wolf.yaw + 2.6;
      api.setView(p.x + Math.sin(a) * 7, p.y + 1.6, p.z + Math.cos(a) * 7, p.x - 0.5, p.y + 0.8, p.z - 1.5);
    },
  },
  {
    name: '08_debug_skeleton_ai',
    wait: 1500,
    setup: (api) => {
      const app = api.app;
      app.settings.set('showHud', true);
      app.eco.alphaBrain.enabled = true;
      api.setTime(11);
      app.debug.showSkeleton = true;
      app.debug.showAI = true;
      api.step(3);
      const p = app.wolf.root.position;
      const a = app.wolf.yaw + 1.2;
      api.setView(p.x + Math.sin(a) * 3.5, p.y + 1.6, p.z + Math.cos(a) * 3.5, p.x, p.y + 0.5, p.z);
    },
  },
  {
    name: '09_dawn_mist',
    wait: 2500,
    setup: (api) => {
      const app = api.app;
      app.settings.set('showHud', false);
      app.debug.showSkeleton = false;
      app.debug.showAI = false;
      api.setTime(6.6);
      api.setCamera('cinematic');
    },
  },
];

/** Windows can briefly lock files (thumbnailers, virus scanners): retry writes. */
async function writeWithRetry(file, data, attempts = 8) {
  for (let i = 1; ; i++) {
    try {
      fs.writeFileSync(file, data);
      return;
    } catch (e) {
      if (i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 250 * i));
    }
  }
}

const server = await startServer({ port: 5191 });
const browser = await launch();
try {
  const { page, logs } = await openApp(browser, server.url, { width: 1280, height: 720, query: 'autostart&fixed' });
  console.log('GPU:', await gpuInfo(page));
  await page.waitForTimeout(3000);
  for (const shot of SHOTS) {
    await page.evaluate(`(${shot.setup.toString()})(window.__lupus)`);
    await page.waitForTimeout(shot.wait);
    const file = path.join(outDir, `${shot.name}.png`);
    await writeWithRetry(file, await page.screenshot());
    const s = await page.evaluate(() => window.__lupus.snapshot());
    console.log(`saved ${shot.name}.png  time=${s.time.toFixed(2)} state=${s.state} fps=${s.fps.toFixed(1)}`);
  }
  if (logs.errors.length || logs.warnings.length) {
    console.log('console errors:', logs.errors);
    console.log('console warnings:', logs.warnings);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  await server.close();
}
