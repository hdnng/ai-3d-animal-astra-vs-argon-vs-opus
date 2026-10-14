// Benchmark: builds the production bundle, serves it, runs the simulator for
// 30 s in headless Chromium and records average FPS, 1% low FPS, frame-time
// percentiles and memory. Results are written to bench-results.json.
// Usage: npm run bench [-- --seconds 30]
import { buildProd, startServer, launch, openApp, gpuInfo, ROOT } from './lib/harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const argSeconds = process.argv.indexOf('--seconds');
const SECONDS = argSeconds > 0 ? Number(process.argv[argSeconds + 1]) : 30;
const WARMUP = 8;

const CONFIGS = [
  { name: 'adaptive (default)', query: 'autostart', note: 'Default settings with adaptive quality enabled (what users get).' },
  { name: 'fixed high quality', query: 'autostart&fixed', note: 'All effects on, adaptive quality disabled (worst case).' },
];

/**
 * Windows only: total 3D-engine GPU utilisation (%) of all processes, sampled
 * for 3 s while no benchmark page is open (the counter query itself takes ~30 s). On a shared integrated GPU, other
 * apps (GPU-rendered terminals, browsers, screen sharing) compete for the same
 * engine, so this documents the conditions each measurement ran under.
 */
function backgroundGpuLoad() {
  if (os.platform() !== 'win32') return null;
  try {
    const ps =
      "$c = Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -SampleInterval 3 -MaxSamples 1; " +
      '[math]::Round(($c.CounterSamples | Measure-Object CookedValue -Sum).Sum, 1)';
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 60000 });
    const v = parseFloat(out.trim());
    return Number.isFinite(v) ? v : null;
  } catch {
    return null; // counters unavailable (e.g. localized counter names)
  }
}

async function runConfig(browser, url, cfg) {
  const backgroundGpu = backgroundGpuLoad();
  const { page, logs } = await openApp(browser, url, { width: 1280, height: 720, query: cfg.query });
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  // Warm-up: shader caches, adaptive quality settling.
  await page.waitForTimeout(WARMUP * 1000);
  const heapStart = (await client.send('Performance.getMetrics')).metrics.find((m) => m.name === 'JSHeapUsedSize').value;
  const result = await page.evaluate(async (seconds) => {
    const app = window.__lupus.app;
    const frames = [];
    const heap = [];
    let last = performance.now();
    let running = true;
    const tick = (t) => {
      if (!running) return;
      frames.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame((t) => {
      last = t;
      requestAnimationFrame(tick);
    });
    const qualityLevels = [];
    const cpu = [];
    const t0 = performance.now();
    while (performance.now() - t0 < seconds * 1000) {
      await new Promise((r) => setTimeout(r, 1000));
      if (performance.memory) heap.push(performance.memory.usedJSHeapSize);
      qualityLevels.push(app.adaptive.level);
      cpu.push(app.cpuMs);
    }
    running = false;
    const info = app.renderer.renderer.info;
    return {
      frames,
      heap,
      qualityLevels,
      cpu,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs.length,
      quality: app.adaptive.describe(),
      effective: app.effectiveSettings,
      canvas: [app.renderer.width, app.renderer.height, app.renderer.pixelRatio],
      counts: app.eco.counts(),
    };
  }, SECONDS);
  const heapEnd = (await client.send('Performance.getMetrics')).metrics.find((m) => m.name === 'JSHeapUsedSize').value;
  await page.context().close();

  const ft = result.frames.filter((f) => f > 0 && f < 2000);
  const total = ft.reduce((a, b) => a + b, 0);
  const sorted = [...ft].sort((a, b) => b - a);
  const worst1 = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.01)));
  const pct = (p) => [...ft].sort((a, b) => a - b)[Math.min(ft.length - 1, Math.floor(ft.length * p))];
  const mb = (b) => Math.round((b / 1048576) * 10) / 10;
  return {
    config: cfg.name,
    note: cfg.note,
    seconds: SECONDS,
    frames: ft.length,
    avgFps: Math.round((ft.length / (total / 1000)) * 10) / 10,
    low1PercentFps: Math.round((1000 / (worst1.reduce((a, b) => a + b, 0) / worst1.length)) * 10) / 10,
    frameTimeMs: {
      avg: Math.round((total / ft.length) * 100) / 100,
      p50: Math.round(pct(0.5) * 100) / 100,
      p95: Math.round(pct(0.95) * 100) / 100,
      p99: Math.round(pct(0.99) * 100) / 100,
      max: Math.round(sorted[0] * 100) / 100,
    },
    cpuMsPerFrameAvg: Math.round((result.cpu.reduce((a, b) => a + b, 0) / Math.max(result.cpu.length, 1)) * 100) / 100,
    memory: {
      jsHeapStartMB: mb(heapStart),
      jsHeapEndMB: mb(heapEnd),
      jsHeapPeakMB: result.heap.length ? mb(Math.max(...result.heap)) : null,
      gpuGeometries: result.geometries,
      gpuTextures: result.textures,
      shaderPrograms: result.programs,
    },
    render: { drawCalls: result.drawCalls, triangles: result.triangles, canvas: result.canvas },
    adaptiveQuality: { finalLevel: result.qualityLevels.at(-1), finalStep: result.quality, levelsOverTime: result.qualityLevels },
    effectiveSettings: result.effective,
    entities: result.counts,
    backgroundGpu3DPercent: backgroundGpu,
    consoleErrors: logs.errors.length,
    consoleWarnings: logs.warnings.length,
  };
}

console.log('[bench] building production bundle…');
await buildProd();
const server = await startServer({ mode: 'preview', port: 4180 });
const browser = await launch({ uncapped: process.argv.includes('--uncapped') });
const results = [];
let gpu = 'unknown';
try {
  const probe = await openApp(browser, server.url, { query: 'autostart' });
  gpu = await gpuInfo(probe.page);
  await probe.context.close();
  for (const cfg of CONFIGS) {
    console.log(`[bench] ${cfg.name}: ${WARMUP}s warm-up + ${SECONDS}s measurement…`);
    const r = await runConfig(browser, server.url, cfg);
    console.log(`[bench]   avg ${r.avgFps} fps · 1% low ${r.low1PercentFps} fps · frame ${r.frameTimeMs.avg} ms (p99 ${r.frameTimeMs.p99}) · heap ${r.memory.jsHeapEndMB} MB · quality ${r.adaptiveQuality.finalStep} · background GPU load ${r.backgroundGpu3DPercent ?? 'n/a'}%`);
    results.push(r);
  }
} finally {
  await browser.close();
  await server.close();
}
const out = {
  date: new Date().toISOString(),
  machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, ramGB: Math.round(os.totalmem() / 1073741824), platform: `${os.platform()} ${os.release()}`, gpu },
  browser: 'Playwright Chromium (headless), ANGLE/D3D11, vsync-limited (60 Hz cap)',
  viewport: '1280x720 @ devicePixelRatio 1',
  backgroundGpuNote: 'backgroundGpu3DPercent = 3D-engine utilisation by other processes measured just before each run (Windows only).',
  results,
};
fs.writeFileSync(path.join(ROOT, 'bench-results.json'), JSON.stringify(out, null, 2));
console.log('[bench] wrote bench-results.json');
