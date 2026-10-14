import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_FILE = path.resolve('bench-results.json');

async function runBenchmark() {
  console.log('Starting programmatic Vite server for 30-second headless benchmark...');
  const server = await createServer({
    server: { port: 0, host: '127.0.0.1' },
    logLevel: 'warn'
  });
  await server.listen();
  const url = server.resolvedUrls.local[0];

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--use-gl=angle',
        '--use-angle=d3d11',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        '--disable-frame-rate-limit',
        '--disable-gpu-vsync'
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1
    });
    const page = await context.newPage();

    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__WOLF_SIM__), { timeout: 10000 });
    await page.waitForTimeout(2500);

    console.log('Running 30-second benchmark in headless Chromium (D3D11 GPU)...');
    const results = await page.evaluate(async () => {
      const sim = window.__WOLF_SIM__;
      const gl = sim.renderer.getContext();
      const dbgInfo = gl.getExtension('WEBGL_debug_renderer_info');
      const gpuRenderer = dbgInfo ? gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);

      const frameTimes = [];
      const memStart = performance.memory ? performance.memory.usedJSHeapSize : 0;

      const durationMs = 30000;
      const startTime = performance.now();
      let lastFrame = startTime;

      await new Promise((resolve) => {
        function sample(now) {
          const dtMs = now - lastFrame;
          lastFrame = now;
          if (dtMs > 0.05 && dtMs < 500) {
            frameTimes.push(dtMs);
          }
          if (now - startTime < durationMs) {
            requestAnimationFrame(sample);
          } else {
            resolve();
          }
        }
        requestAnimationFrame(sample);
      });

      const memEnd = performance.memory ? performance.memory.usedJSHeapSize : 0;
      const sorted = [...frameTimes].sort((a, b) => a - b);
      const totalFrames = sorted.length;
      const sumMs = sorted.reduce((acc, v) => acc + v, 0);
      const avgFrameTimeMs = sumMs / Math.max(1, totalFrames);
      const avgFps = 1000 / Math.max(0.1, avgFrameTimeMs);

      const p99Index = Math.min(totalFrames - 1, Math.floor(totalFrames * 0.99));
      const worst1PercentMs = sorted[p99Index] || avgFrameTimeMs;
      const onePercentLowFps = 1000 / Math.max(0.1, worst1PercentMs);

      const renderInfo = sim.renderer.info;

      return {
        timestamp: new Date().toISOString(),
        gpuRenderer,
        durationSeconds: 30,
        totalFrames,
        averageFps: Number(avgFps.toFixed(2)),
        onePercentLowFps: Number(onePercentLowFps.toFixed(2)),
        averageFrameTimeMs: Number(avgFrameTimeMs.toFixed(2)),
        p99FrameTimeMs: Number(worst1PercentMs.toFixed(2)),
        memoryStartMB: Number((memStart / (1024 * 1024)).toFixed(2)),
        memoryEndMB: Number((memEnd / (1024 * 1024)).toFixed(2)),
        memoryDeltaMB: Number(((memEnd - memStart) / (1024 * 1024)).toFixed(2)),
        drawCalls: renderInfo.render.calls,
        triangles: renderInfo.render.triangles,
        geometriesInMemory: renderInfo.memory.geometries,
        texturesInMemory: renderInfo.memory.textures,
        entityCount: sim.ecosystem.getTotalEntityCount()
      };
    });

    results.consoleErrors = errors.length;
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    console.log('Benchmark Complete! Results saved to bench-results.json:');
    console.log(JSON.stringify(results, null, 2));

    if (errors.length > 0) {
      throw new Error(`Console errors during benchmark: ${errors.join('; ')}`);
    }
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
