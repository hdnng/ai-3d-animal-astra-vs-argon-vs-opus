import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const SCREENSHOT_DIR = path.resolve('screenshots');

async function runSmokeAndScreenshots() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  console.log('Starting programmatic Vite server for smoke test & screenshot verification...');
  const server = await createServer({
    server: { port: 0, host: '127.0.0.1' },
    logLevel: 'warn'
  });
  await server.listen();
  const url = server.resolvedUrls.local[0];
  console.log(`Vite listening at ${url}`);

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

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1
    });
    const page = await context.newPage();

    const consoleErrors = [];
    const pageErrors = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error('[Browser Console Error]:', msg.text());
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      console.error('[Browser Page Error]:', err.message);
      pageErrors.push(err.message);
    });

    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#hud-mode', { timeout: 10000 });
    await page.waitForFunction(() => Boolean(window.__WOLF_SIM__), { timeout: 10000 });
    await page.waitForTimeout(1200);

    // 1. Verify initial HUD & AI state
    const initialHud = await page.evaluate(() => {
      const sim = window.__WOLF_SIM__;
      return {
        hasSim: Boolean(sim),
        modeText: document.getElementById('hud-mode')?.textContent?.trim(),
        stateText: document.getElementById('hud-state')?.textContent?.trim(),
        entitiesText: document.getElementById('hud-entities')?.textContent?.trim(),
        boneCount: sim?.alphaWolf?.rig?.boneList?.length ?? 0,
        fpsText: document.getElementById('hud-fps')?.textContent?.trim()
      };
    });
    console.log('Initial HUD Telemetry:', initialHud);

    if (!initialHud.hasSim || initialHud.boneCount < 30) {
      throw new Error(`Invalid simulation or skeleton rig: ${JSON.stringify(initialHud)}`);
    }

    // Screenshot 1: Daylight ¾ Profile Follow View (10:45 AM)
    await page.evaluate(() => {
      const sim = window.__WOLF_SIM__;
      sim.clock.timeOfDay = 10.75;
      sim.quality.settings.weather = 'clear';
      sim.cameraRig.setMode('orbit', sim.alphaWolf.heading + 1.05, 0.20, 3.3);
      for (let i = 0; i < 20; i++) sim.stepSimulation(0.033);
      sim.cameraRig.snapToTarget(sim.alphaWolf, (x, z) => sim.terrain.getHeightAt(x, z));
      sim.renderFrame();
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-daylight-follow.png') });
    console.log('Saved screenshots/01-daylight-follow.png');

    // 2. Simulate Key Presses: Toggle Manual Control (Tab), Sprint Forward (Shift+W)
    await page.keyboard.press('Tab');
    await page.waitForTimeout(150);
    const modeAfterTab = await page.evaluate(() => document.getElementById('hud-mode')?.textContent?.trim());
    console.log('Mode after pressing Tab:', modeAfterTab);
    if (modeAfterTab !== 'Manual Control') {
      throw new Error(`Expected Manual Control after Tab, got ${modeAfterTab}`);
    }

    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(600);
    const sprintState = await page.evaluate(() => ({
      state: document.getElementById('hud-state')?.textContent?.trim(),
      speed: window.__WOLF_SIM__.alphaWolf.speed
    }));
    await page.keyboard.up('KeyW');
    await page.keyboard.up('ShiftLeft');
    console.log('Sprint state during Shift+W:', sprintState);
    if (sprintState.speed < 2.0) {
      throw new Error(`Expected wolf speed > 2.0 during Shift+W sprint, got ${sprintState.speed}`);
    }

    // 3. Trigger Howl at Golden Dusk (6:15 PM) & Capture Screenshot 2
    await page.evaluate(() => {
      const sim = window.__WOLF_SIM__;
      sim.clock.timeOfDay = 18.25;
      sim.alphaWolf.triggerSpecialAction('howl');
      sim.cameraRig.setMode('orbit', sim.alphaWolf.heading + 0.85, 0.14, 3.1);
      for (let i = 0; i < 20; i++) sim.stepSimulation(0.033);
      sim.renderFrame();
    });
    await page.waitForTimeout(150);
    const howlState = await page.evaluate(() => document.getElementById('hud-state')?.textContent?.trim());
    console.log('State after Howl trigger:', howlState);
    if (howlState !== 'HOWL') {
      throw new Error(`Expected HOWL state, got ${howlState}`);
    }
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-golden-dusk-howl.png') });
    console.log('Saved screenshots/02-golden-dusk-howl.png');

    // 4. Starlight Night + Fireflies + Pack View (11:30 PM) & Capture Screenshot 3
    await page.keyboard.press('Tab');
    await page.evaluate(() => {
      const sim = window.__WOLF_SIM__;
      sim.clock.timeOfDay = 23.5;
      sim.alphaWolf.actionLockTimer = 0;
      sim.alphaWolf.animator.setState('walk');
      sim.cameraRig.setMode('orbit', sim.alphaWolf.heading + 0.95, 0.24, 3.8);
      for (let i = 0; i < 25; i++) sim.stepSimulation(0.033);
      sim.cameraRig.snapToTarget(sim.alphaWolf, (x, z) => sim.terrain.getHeightAt(x, z));
      sim.renderFrame();
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-starlight-night-pack.png') });
    console.log('Saved screenshots/03-starlight-night-pack.png');

    // 5. Dawn River Shoreline + Rainstorm + Drinking Action + Cinematic Camera (6:40 AM) & Capture Screenshot 4
    await page.evaluate(() => {
      const sim = window.__WOLF_SIM__;
      sim.clock.timeOfDay = 6.65;
      const selWeather = document.getElementById('sel-weather');
      if (selWeather) {
        selWeather.value = 'rain';
        selWeather.dispatchEvent(new Event('change'));
      }
      const shore = sim.terrain.getNearestShoreline(sim.alphaWolf.position);
      sim.alphaWolf.position.set(shore.x, shore.y, shore.z);
      sim.alphaWolf.heading = Math.PI; // Face directly toward the river channel
      sim.alphaWolf.needs.thirst = 22;
      sim.aiController.decisionTimer = 0;
      sim.cameraRig.setMode('orbit', sim.alphaWolf.heading + 1.15, 0.24, 3.5);
      for (let i = 0; i < 18; i++) sim.stepSimulation(0.033);
      sim.cameraRig.snapToTarget(sim.alphaWolf, (x, z) => sim.terrain.getHeightAt(x, z));
      sim.renderFrame();
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-dawn-river-cinematic.png') });
    console.log('Saved screenshots/04-dawn-river-cinematic.png');

    // 6. Debug Skeleton & AI Vectors View & Capture Screenshot 5
    await page.evaluate(() => {
      const sim = window.__WOLF_SIM__;
      sim.clock.timeOfDay = 14.0;
      const selWeather = document.getElementById('sel-weather');
      if (selWeather) {
        selWeather.value = 'clear';
        selWeather.dispatchEvent(new Event('change'));
      }
      sim.alphaWolf.reset(0, 8, (x, z) => sim.terrain.getHeightAt(x, z));
      sim.hud.toggleSkeletonDebug();
      document.getElementById('btn-dbg-ai')?.click();
      sim.alphaWolf.triggerSpecialAction('pounce');
      sim.cameraRig.setMode('orbit', sim.alphaWolf.heading + 1.35, 0.18, 3.1);
      for (let i = 0; i < 6; i++) sim.stepSimulation(0.033);
      sim.cameraRig.snapToTarget(sim.alphaWolf, (x, z) => sim.terrain.getHeightAt(x, z));
      sim.renderFrame();
    });
    await page.waitForTimeout(150);
    const pounceState = await page.evaluate(() => document.getElementById('hud-state')?.textContent?.trim());
    console.log('State in Screenshot 5 (Skeleton Debug):', pounceState);
    if (pounceState !== 'POUNCE') {
      throw new Error(`Expected POUNCE state in Screenshot 5, got ${pounceState}`);
    }
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-skeleton-debug-ik.png') });
    console.log('Saved screenshots/05-skeleton-debug-ik.png');

    if (consoleErrors.length > 0 || pageErrors.length > 0) {
      throw new Error(`Console/Page errors detected:\nConsole: ${consoleErrors.join('\n')}\nPage: ${pageErrors.join('\n')}`);
    }

    console.log('ALL SMOKE TESTS & SCREENSHOT CAPTURES PASSED WITH ZERO ERRORS!');
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

runSmokeAndScreenshots().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
