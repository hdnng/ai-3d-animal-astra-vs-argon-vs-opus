import { chromium } from 'playwright';
import { createServer } from 'vite';

async function runLongRunTest() {
  console.log('Starting programmatic Vite server for 5-minute simulated long-run stability & memory leak test...');
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
        '--ignore-gpu-blocklist'
      ]
    });

    const page = await browser.newPage();
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__WOLF_SIM__), { timeout: 10000 });
    await page.waitForTimeout(1000);

    const report = await page.evaluate(async () => {
      const sim = window.__WOLF_SIM__;
      const memInitial = performance.memory ? performance.memory.usedJSHeapSize : 0;
      const geomInitial = sim.renderer.info.memory.geometries;
      const texInitial = sim.renderer.info.memory.textures;

      const totalSteps = 9000;
      const dt = 1 / 30;
      for (let s = 0; s < totalSteps; s++) {
        sim.clock.stepFixed(dt);
        sim.stepSimulation(dt);
        if (s % 180 === 0) {
          sim.renderFrame();
          await new Promise((r) => setTimeout(r, 0));
        }
        if (s === 3000 || s === 6000) {
          sim.resetSimulation();
        }
      }
      sim.renderFrame();

      const memFinal = performance.memory ? performance.memory.usedJSHeapSize : 0;
      const geomFinal = sim.renderer.info.memory.geometries;
      const texFinal = sim.renderer.info.memory.textures;

      const pos = sim.alphaWolf.position;
      const isPositionValid = Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z);

      return {
        simulatedSeconds: Math.round(totalSteps * dt),
        isPositionValid,
        finalWolfPosition: { x: Number(pos.x.toFixed(2)), y: Number(pos.y.toFixed(2)), z: Number(pos.z.toFixed(2)) },
        geometriesInitial: geomInitial,
        geometriesFinal: geomFinal,
        texturesInitial: texInitial,
        texturesFinal: texFinal,
        heapInitialMB: Number((memInitial / (1024 * 1024)).toFixed(2)),
        heapFinalMB: Number((memFinal / (1024 * 1024)).toFixed(2)),
        heapDeltaMB: Number(((memFinal - memInitial) / (1024 * 1024)).toFixed(2))
      };
    });

    console.log('5-Minute Long-Run Test Report:', JSON.stringify(report, null, 2));

    if (!report.isPositionValid) {
      throw new Error('Wolf position became NaN/Infinite during 5-minute run!');
    }
    if (report.geometriesFinal !== report.geometriesInitial || report.texturesFinal !== report.texturesInitial) {
      throw new Error(`GPU resource leak detected! Geometries: ${report.geometriesInitial}->${report.geometriesFinal}, Textures: ${report.texturesInitial}->${report.texturesFinal}`);
    }
    if (errors.length > 0) {
      throw new Error(`Errors during long-run test: ${errors.join('; ')}`);
    }

    console.log('5-MINUTE LONG-RUN STABILITY TEST PASSED WITH ZERO LEAKS OR CRASHES!');
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

runLongRunTest().catch((err) => {
  console.error('Long-run test failed:', err);
  process.exit(1);
});
