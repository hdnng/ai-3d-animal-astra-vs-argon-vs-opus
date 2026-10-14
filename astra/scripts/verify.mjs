import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import os from "node:os";
const mode = process.argv[2] || "smoke";
const url = process.env.TEST_URL || "http://127.0.0.1:4173";
let server;
let browser;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  if (!process.env.TEST_URL) {
    server = spawn(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        "4173",
        "--strictPort",
      ],
      { stdio: "pipe", windowsHide: true },
    );
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try {
        ready = (await fetch(url)).ok;
        if (ready) break;
      } catch {}
      await delay(250);
    }
    assert(ready, "Preview server started");
  }
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chromium",
    headless: true,
    args: [
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--enable-precise-memory-info",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      ...(process.platform === "win32" ? ["--use-angle=d3d11"] : []),
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const errors = [],
    warnings = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
    if (m.type() === "warning") warnings.push(m.text());
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__sim?.ready);
  await page.waitForTimeout(5000);
  await mkdir("screenshots", { recursive: true });
  const stats = () => page.evaluate(() => window.__sim.getStats());
  if (mode === "isolate") {
    await page.evaluate(() => {
      const s = window.__sim;
      s.view.adaptive = false;
      s.view.post = false;
      s.view.setScale(0.6);
      s.view.setShadows("off");
      const original = s.step.bind(s);
      window.stepCosts = [];
      s.step = (dt) => {
        const t = performance.now();
        original(dt);
        window.stepCosts.push(performance.now() - t);
      };
    });
    for (const variant of ["full", "frozen", "empty"]) {
      await page.evaluate((v) => {
        const s = window.__sim;
        s.paused = v !== "full";
        if (v === "empty")
          s.view.scene.children.forEach((o) => (o.visible = false));
        s.frames = [];
        s.recording = true;
      }, variant);
      await page.waitForTimeout(6000);
      console.log(
        variant,
        await page.evaluate(() => {
          const s = window.__sim;
          s.recording = false;
          return {
            fps: 1000 / (s.frames.reduce((a, b) => a + b) / s.frames.length),
            stepMs:
              window.stepCosts.reduce((a, b) => a + b, 0) /
              Math.max(1, window.stepCosts.length),
          };
        }),
      );
    }
  }
  if (mode === "features") {
    const report = await page.evaluate(() => {
      const s = window.__sim;
      s.paused = true;
      const scenarios = [];
      for (const [need, state] of [
        ["hunger", "eat"],
        ["thirst", "drink"],
        ["energy", "sleep"],
      ]) {
        s.reset();
        s.brain.needs = { hunger: 5, thirst: 5, energy: 95 };
        s.brain.needs[need] = need === "energy" ? 5 : 95;
        let seen = false,
          maxFootError = 0;
        for (let i = 0; i < 3600; i++) {
          s.step(1 / 60);
          if (s.fox.state === state) seen = true;
          maxFootError = Math.max(maxFootError, s.fox.footError);
        }
        scenarios.push({
          need,
          state,
          seen,
          maxFootError,
          needs: { ...s.brain.needs },
        });
      }
      s.reset();
      const end = s.fox.root.position.clone().set(9, 0, 12);
      const path = s.brain.navigation.path(s.fox.root.position, end);
      const routeValid =
        path.length > 0 && path.every((p) => !s.world.blocked(p.x, p.z, 0.4));
      s.paused = false;
      return { scenarios, routeValid, pathNodes: path.length };
    });
    console.log(JSON.stringify(report, null, 2));
    await writeFile("feature-results.json", JSON.stringify(report, null, 2));
    assert(report.routeValid, "A* routes around pond and obstacles");
    for (const s of report.scenarios) {
      assert(s.seen, `${s.need} triggers ${s.state}`);
      assert(s.maxFootError < 0.005, `${s.state} max IK error below 5 mm`);
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  }
  if (mode === "profile") {
    for (const [name, scale, post, shadows] of [
      ["high", 1, true, "high"],
      ["balanced", 0.7, true, "medium"],
      ["low", 0.6, false, "off"],
    ]) {
      await page.evaluate(
        ([scale, post, shadows]) => {
          const s = window.__sim;
          s.snapshot(16, 0.9, 7);
          s.view.adaptive = false;
          s.view.setScale(scale);
          s.view.post = post;
          s.view.setShadows(shadows);
        },
        [scale, post, shadows],
      );
      await page.waitForTimeout(2000);
      await page.evaluate(() => {
        window.__sim.frames = [];
        window.__sim.recording = true;
      });
      await page.waitForTimeout(8000);
      const result = await page.evaluate(() => {
        const s = window.__sim;
        s.recording = false;
        return {
          stats: s.getStats(),
          fps: 1000 / (s.frames.reduce((a, b) => a + b) / s.frames.length),
        };
      });
      console.log(name, JSON.stringify(result));
    }
  }
  if (mode === "diagnose") {
    console.log(
      JSON.stringify(
        await page.evaluate(() => ({
          stats: window.__sim.getStats(),
          canvas: [...document.querySelectorAll("canvas")].map((c) => ({
            rect: c.getBoundingClientRect().toJSON(),
            css: getComputedStyle(c).display,
            parent: c.parentElement.id,
          })),
          camera: window.__sim.view.camera.position.toArray(),
          target: window.__sim.view.controls.target.toArray(),
        })),
      ),
    );
    await page.screenshot({ path: "screenshots/diagnose.png" });
    await page.evaluate(() => {
      window.__sim.view.adaptive = false;
      window.__sim.view.post = true;
      document.querySelector("#hud").style.display = "none";
    });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: "screenshots/diagnose-post.png" });
    await page.evaluate(() => {
      window.__sim.view.post = false;
      document.querySelector("#hud").style.display = "block";
    });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: "screenshots/diagnose-hud.png" });
    console.log({ errors, warnings });
  }
  if (mode === "smoke") {
    const initial = await stats();
    assert(initial.bones >= 26);
    assert(initial.entities >= 39);
    assert(initial.vegetation > 10000);
    await page.keyboard.press("m");
    await page.waitForTimeout(300);
    assert.match(await page.locator("#mode").innerText(), /Manual/);
    await page.evaluate(() => {
      const s = window.__sim;
      s.fox.root.position.set(-3, 0, 3);
      s.fox.heading = 0;
    });
    const start = await stats();
    await page.keyboard.down("w");
    await page.waitForTimeout(600);
    assert.equal((await stats()).state, "walk");
    await page.keyboard.down("Shift");
    await page.waitForTimeout(400);
    assert.equal((await stats()).state, "run");
    await page.keyboard.up("Shift");
    await page.keyboard.up("w");
    assert.notDeepEqual((await stats()).position, start.position);
    for (const [key, state] of [
      ["Space", "jump"],
      ["h", "howl"],
      ["q", "shake"],
      ["r", "sleep"],
    ]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(250);
      assert.equal((await stats()).state, state);
      assert.equal(
        await page.locator("#state").getAttribute("data-state"),
        state,
      );
    }
    await page.keyboard.press("r");
    await page.getByRole("button", { name: "Orbit", exact: true }).click();
    await page.waitForTimeout(200);
    assert.equal((await stats()).camera, "orbit");
    await page.getByRole("button", { name: "Cinematic", exact: true }).click();
    await page.waitForTimeout(200);
    assert.equal((await stats()).camera, "cinematic");
    await page.getByRole("button", { name: "Enable procedural audio" }).click();
    assert.equal(
      await page.evaluate(() => window.__sim.audio.context.state),
      "running",
    );
    await page.getByRole("button", { name: "Mute audio", exact: true }).click();
    await page.getByRole("button", { name: "Open settings" }).click();
    await page.locator("input[name=weather]").check();
    await page.locator("input[name=skeleton]").check();
    await page.locator("input[name=target]").check();
    await page.locator("input[name=wireframe]").check();
    await page.waitForTimeout(500);
    assert(
      await page.evaluate(
        () => window.__sim.world.weather && window.__sim.fox.skeleton.visible,
      ),
    );
    await page.locator("input[name=post]").uncheck();
    await page.waitForTimeout(500);
    await page.locator("input[name=post]").check();
    await page.locator("select[name=shadows]").selectOption("medium");
    await page.locator("input[name=wireframe]").uncheck();
    await page.getByRole("button", { name: "Reset the woodland" }).click();
    await page.waitForTimeout(300);
    assert((await stats()).time < 1);
    await page.getByRole("button", { name: "Close settings" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      390,
    );
    await page.screenshot({ path: "screenshots/mobile.png" });
    await page.setViewportSize({ width: 1440, height: 900 });
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
    const result = {
      passed: true,
      checks: 24,
      consoleErrors: errors,
      consoleWarnings: warnings,
      stats: await stats(),
    };
    await writeFile("smoke-results.json", JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  }
  if (mode === "screenshots") {
    await page.evaluate(() => {
      window.__sim.view.adaptive = false;
      window.__sim.view.setScale(1);
    });
    for (const [name, hour, angle, distance] of [
      ["01-afternoon", 16, 0.9, 6.5],
      ["02-dawn", 7, -0.8, 8],
      ["03-moonlight", 22, 2.4, 7],
      ["04-rain", 13, -2, 9],
    ]) {
      await page.evaluate(
        ([hour, angle, distance, name]) => {
          window.__sim.snapshot(hour, angle, distance);
          window.__sim.world.weather = name === "04-rain";
        },
        [hour, angle, distance, name],
      );
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `screenshots/${name}.png` });
    }
    await page.evaluate(() => {
      window.__sim.snapshot(18, -0.8, 6);
      window.__sim.action("sleep");
      window.__sim.world.weather = false;
    });
    await page.waitForTimeout(1700);
    await page.screenshot({ path: "screenshots/05-rest.png" });
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
    console.log("Five camera/time/weather/rest screenshots captured.");
  }
  if (mode === "bench") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await page.waitForTimeout(7000);
    const before = await cdp.send("Runtime.getHeapUsage");
    const gpu = await page.evaluate(() => {
      const gl = window.__sim.view.renderer.getContext(),
        e = gl.getExtension("WEBGL_debug_renderer_info");
      return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : "unavailable";
    });
    await page.evaluate(() => {
      window.__sim.frames = [];
      window.__sim.recording = true;
    });
    const started = Date.now();
    await page.waitForTimeout(30000);
    const frames = await page.evaluate(() => {
      window.__sim.recording = false;
      return window.__sim.frames;
    });
    const after = await cdp.send("Runtime.getHeapUsage");
    const sorted = [...frames].sort((a, b) => b - a),
      worst = sorted.slice(0, Math.max(1, Math.ceil(frames.length * 0.01)));
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
    const result = {
      date: new Date().toISOString(),
      durationSeconds: (Date.now() - started) / 1000,
      viewport: { width: 1440, height: 900 },
      browser: browser.version(),
      cpu: os.cpus()[0].model,
      gpu,
      platform: os.platform(),
      frameCount: frames.length,
      averageFPS: 1000 / avg,
      onePercentLowFPS:
        1000 / (worst.reduce((a, b) => a + b, 0) / worst.length),
      averageFrameTimeMs: avg,
      p99FrameTimeMs: sorted[Math.floor(frames.length * 0.01)],
      memory: {
        beforeMB: before.usedSize / 1048576,
        afterMB: after.usedSize / 1048576,
        deltaMB: (after.usedSize - before.usedSize) / 1048576,
      },
      stats: await stats(),
      errors,
      warnings,
    };
    await writeFile("bench-results.json", JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  }
  if (mode === "long") {
    // Keep quality fixed: freeing a shadow map during adaptation is not a leak.
    await page.evaluate(() => {
      window.__sim.view.adaptive = false;
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.collectGarbage");
    const before = await cdp.send("Runtime.getHeapUsage");
    const first = await stats();
    const samples = [];
    for (let minute = 1; minute <= 5; minute++) {
      await page.evaluate(() => {
        const s = window.__sim;
        s.paused = true;
        for (let i = 0; i < 3600; i++) s.step(1 / 60);
        s.paused = false;
      });
      await page.waitForTimeout(500);
      await cdp.send("HeapProfiler.collectGarbage");
      samples.push({
        minute,
        heapMB: (await cdp.send("Runtime.getHeapUsage")).usedSize / 1048576,
        stats: await stats(),
      });
      console.log(`Simulated ${minute} minute(s)`);
    }
    const last = samples.at(-1);
    assert(last.stats.time - first.time >= 300);
    assert(last.stats.position.every(Number.isFinite));
    assert.equal(last.stats.geometries, first.geometries);
    assert.equal(last.stats.textures, first.textures);
    assert(
      last.heapMB - before.usedSize / 1048576 < 12,
      "Retained JS heap growth below 12 MB",
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
    const result = {
      passed: true,
      simulatedSeconds: last.stats.time - first.time,
      initialHeapMB: before.usedSize / 1048576,
      finalHeapMB: last.heapMB,
      heapGrowthMB: last.heapMB - before.usedSize / 1048576,
      samples,
      errors,
      warnings,
    };
    await writeFile("long-run-results.json", JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  }
} finally {
  await browser?.close();
  server?.kill();
}
