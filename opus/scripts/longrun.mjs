// Long-run stability test: simulates 5 minutes of game time (fixed 60 Hz
// steps) with periodic rendering, weather changes, camera switches, manual
// driving, AI and a mid-run reset. Samples JS heap and GPU resource counts
// and fails on console errors, crashes or unbounded growth.
// Usage: npm run longrun
import { startServer, launch, openApp, ROOT } from './lib/harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const SIM_SECONDS = 300;
const server = await startServer({ port: 5193 });
const browser = await launch();
let failed = false;
try {
  const { page, logs } = await openApp(browser, server.url, { query: 'autostart&fixed' });
  await page.waitForTimeout(2000);
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  await client.send('HeapProfiler.enable');
  // Live heap after a forced GC (otherwise the number mostly reflects GC timing).
  const heap = async () => {
    await client.send('HeapProfiler.collectGarbage');
    return (await client.send('Performance.getMetrics')).metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1048576;
  };
  await page.evaluate(() => window.__lupus.app.stop());
  const samples = [];
  const t0 = Date.now();
  for (let s = 0; s < SIM_SECONDS; s += 10) {
    // 10 simulated seconds per chunk; render 4 frames per simulated second.
    await page.evaluate((s) => {
      const api = window.__lupus;
      const app = api.app;
      const phase = Math.floor(s / 10);
      // Scripted variety.
      if (phase === 2) app.settings.set('weatherMode', 'rain');
      if (phase === 6) app.settings.set('weatherMode', 'clear');
      if (phase === 8) app.settings.set('timeSpeed', 6);
      if (phase === 9) api.setCamera('orbit');
      if (phase === 11) api.setCamera('cinematic');
      if (phase === 12) app.setManual(true);
      if (phase === 14) app.setManual(false);
      if (phase === 15) app.resetSimulation();
      if (phase === 18) app.settings.set('postProcessing', false);
      if (phase === 19) app.settings.set('postProcessing', true);
      if (phase === 20) app.settings.set('weatherMode', 'auto');
      if (phase === 22) app.debug.showSkeleton = true;
      if (phase === 24) app.debug.showSkeleton = false;
      for (let i = 0; i < 600; i++) {
        if (app.manual) {
          app.input.inject('KeyW', true);
          if (i % 120 === 0) app.input.inject(i % 240 === 0 ? 'ShiftLeft' : 'KeyA', true);
          if (i % 120 === 60) {
            app.input.release('ShiftLeft');
            app.input.release('KeyA');
          }
          if (i % 200 === 100) app.input.inject('Space');
        } else {
          app.input.release('KeyW');
          app.input.release('ShiftLeft');
          app.input.release('KeyA');
        }
        app.step(1 / 60);
        if (i % 15 === 0) app.render(1 / 60);
        app.input.endFrame();
      }
    }, s);
    if (s % 30 === 0 || s === SIM_SECONDS - 10) {
      const info = await page.evaluate(() => {
        const app = window.__lupus.app;
        const r = app.renderer.renderer.info;
        // Unique geometries/materials reachable from the scene graph (runtime-created objects would show up here).
        const geos = new Set();
        const mats = new Set();
        app.scene.traverse((o) => {
          if (o.geometry) geos.add(o.geometry);
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
        });
        return {
          simTime: app.simTime,
          sceneGeometries: geos.size,
          sceneMaterials: mats.size,
          geometries: r.memory.geometries,
          textures: r.memory.textures,
          programs: r.programs.length,
          particles: app.effects.particleCount,
          counts: app.eco.counts(),
          action: app.eco.alphaBrain.currentId(),
          time: app.world.dayNight.clock(),
          weather: app.weather.describe(),
        };
      });
      const h = await heap();
      samples.push({ ...info, heapMB: Math.round(h * 10) / 10 });
      console.log(`[longrun] t=${info.simTime.toFixed(0)}s heap=${h.toFixed(1)}MB sceneGeo=${info.sceneGeometries} sceneMat=${info.sceneMaterials} gpuGeo=${info.geometries} tex=${info.textures} prog=${info.programs} fx=${info.particles} ${info.time} ${info.weather} action=${info.action}`);
    }
  }
  const wall = (Date.now() - t0) / 1000;
  const warm = samples.find((x) => x.simTime >= 60) ?? samples[0];
  const last = samples[samples.length - 1];
  const heapGrowth = last.heapMB - warm.heapMB;
  // GPU geometry uploads are lazy (terrain/vegetation LODs upload when first seen), so the
  // leak check uses objects reachable from the scene graph plus bounded GPU counts.
  const geoGrowth = last.sceneGeometries - warm.sceneGeometries;
  const matGrowth = last.sceneMaterials - warm.sceneMaterials;
  const texGrowth = last.textures - warm.textures;
  const gpuGeoBounded = last.geometries <= last.sceneGeometries + 40;
  const ok = logs.errors.length === 0 && logs.warnings.length === 0 && heapGrowth < 8 && geoGrowth <= 0 && matGrowth <= 0 && texGrowth <= 4 && gpuGeoBounded;
  failed = !ok;
  const out = {
    date: new Date().toISOString(),
    simulatedSeconds: SIM_SECONDS,
    wallSeconds: Math.round(wall),
    heapGrowthMB_after60s: Math.round(heapGrowth * 10) / 10,
    sceneGeometryGrowth: geoGrowth,
    sceneMaterialGrowth: matGrowth,
    gpuGeometriesBounded: gpuGeoBounded,
    textureGrowth: texGrowth,
    consoleErrors: logs.errors,
    consoleWarnings: logs.warnings,
    passed: ok,
    samples,
  };
  fs.writeFileSync(path.join(ROOT, 'longrun-results.json'), JSON.stringify(out, null, 2));
  console.log(`[longrun] ${ok ? 'PASSED' : 'FAILED'}: ${SIM_SECONDS}s simulated in ${wall.toFixed(0)}s wall, heap growth ${heapGrowth.toFixed(1)} MB, scene geometries +${geoGrowth}, materials +${matGrowth}, textures +${texGrowth}, errors ${logs.errors.length}, warnings ${logs.warnings.length}`);
} catch (e) {
  failed = true;
  console.error('[longrun] crashed:', e);
} finally {
  await browser.close();
  await server.close();
}
process.exitCode = failed ? 1 : 0;
