// Shared helpers for the automation scripts: start a Vite server, launch
// headless Chromium with GPU acceleration enabled, and collect console output.
import { createServer, preview, build } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Starts a dev server (default) or a preview server for the production build. */
export async function startServer({ mode = 'dev', port = 5190 } = {}) {
  if (mode === 'preview') {
    const server = await preview({ root: ROOT, preview: { port, strictPort: false, open: false }, logLevel: 'error' });
    const url = server.resolvedUrls.local[0];
    return { url, close: () => new Promise((r) => server.httpServer.close(r)) };
  }
  const server = await createServer({ root: ROOT, server: { port, strictPort: false, open: false }, logLevel: 'error' });
  await server.listen();
  const url = server.resolvedUrls.local[0];
  return { url, close: () => server.close() };
}

export async function buildProd() {
  await build({ root: ROOT, logLevel: 'warn' });
}

/** GPU-friendly Chromium flags. Uncapped frame rate lets the benchmark show headroom. */
export function chromiumArgs({ uncapped = false } = {}) {
  const args = ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'];
  if (uncapped) args.push('--disable-frame-rate-limit', '--disable-gpu-vsync');
  return args;
}

export async function launch({ uncapped = false, headless = true } = {}) {
  return chromium.launch({ headless, args: chromiumArgs({ uncapped }) });
}

/** Opens the app and records console errors/warnings and page errors. */
export async function openApp(browser, url, { width = 1280, height = 720, query = '' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const logs = { errors: [], warnings: [], all: [] };
  page.on('console', (msg) => {
    const t = msg.type();
    const text = msg.text();
    logs.all.push(`[${t}] ${text}`);
    if (t === 'error') logs.errors.push(text);
    if (t === 'warning') logs.warnings.push(text);
  });
  page.on('pageerror', (err) => logs.errors.push(`pageerror: ${err.message}`));
  await page.goto(url + (query ? (url.includes('?') ? '&' : '?') + query : ''), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__lupus && window.__lupus.ready === true, null, { timeout: 60000 });
  return { page, context, logs };
}

export async function gpuInfo(page) {
  return page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return 'no webgl2';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
}
