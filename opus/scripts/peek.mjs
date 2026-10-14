// Developer helper: renders a few views to /screenshots-dev for quick inspection.
import { startServer, launch, openApp, gpuInfo, ROOT } from './lib/harness.mjs';
import path from 'node:path';
import fs from 'node:fs';

const outDir = process.argv[2] || path.join(ROOT, 'screenshots-dev');
fs.mkdirSync(outDir, { recursive: true });
const views = JSON.parse(process.argv[3] || '[]');
const query = process.argv[4] || '';
const server = await startServer();
const browser = await launch();
try {
  const { page, logs } = await openApp(browser, server.url, { query });
  console.log('GPU:', await gpuInfo(page));
  await page.waitForTimeout(2500);
  for (const v of views) {
    await page.evaluate((v) => {
      const api = window.__lupus;
      if (v.time !== undefined) api.setTime(v.time);
      if (v.keys) for (const k of v.keys) api.hold(k, true);
      if (v.step) api.step(v.step);
      if (v.keys) for (const k of v.keys) api.hold(k, false);
      if (v.eval) new Function('api', v.eval)(api);
      if (v.wolf) api.viewWolf(v.wolf[0], v.wolf[1], v.wolf[2]);
      if (v.view) api.setView(...v.view);
      if (v.camera) api.setCamera(v.camera);
    }, v);
    await page.waitForTimeout(v.wait ?? 600);
    await page.screenshot({ path: path.join(outDir, `${v.name}.png`) });
    console.log('snap', v.name, JSON.stringify(await page.evaluate(() => window.__lupus.snapshot())));
  }
  console.log('errors:', JSON.stringify(logs.errors.slice(0, 20)));
  console.log('warnings:', JSON.stringify(logs.warnings.slice(0, 20)));
} finally {
  await browser.close();
  await server.close();
}
