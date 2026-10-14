/**
 * Smoke test: loads the simulator in headless Chromium, lets it run, checks
 * the console stays clean, drives the wolf with simulated key presses and
 * verifies that the HUD / state react.
 */
import { expect, test, type Page } from '@playwright/test';

interface Snapshot {
  state: string;
  motion: string;
  manual: boolean;
  camera: string;
  pos: number[];
  fps: number;
  drawCalls: number;
  action: string;
}

const snap = (page: Page): Promise<Snapshot> => page.evaluate(() => window.__lupus!.snapshot() as unknown as Snapshot);

test('simulator loads, runs without console errors and reacts to input', async ({ page }) => {
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
    if (msg.type() === 'warning') warnings.push(msg.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto('/');
  await page.waitForFunction(() => window.__lupus?.ready === true, null, { timeout: 120_000 });

  // Start screen is shown; clicking it enters the valley (and unlocks audio).
  await expect(page.locator('.start')).toBeVisible();
  await page.mouse.click(640, 400);
  await expect(page.locator('.start')).toHaveCount(0, { timeout: 5000 });

  // Let the world run for a few seconds.
  await page.waitForTimeout(5000);
  const s0 = await snap(page);
  expect(s0.drawCalls).toBeGreaterThan(20);
  expect(s0.fps).toBeGreaterThan(0);
  await expect(page.locator('.stats .fps')).toContainText('FPS');
  await expect(page.locator('.wolf-state')).toContainText('State');
  expect(s0.manual).toBe(false);
  await expect(page.locator('.badge')).toHaveText('AI');

  // The rendered frame is not blank: sample the canvas through a screenshot.
  const shot = await page.screenshot();
  expect(shot.byteLength).toBeGreaterThan(50_000);

  // T toggles manual control.
  await page.keyboard.press('KeyT');
  await expect(page.locator('.badge')).toHaveText('MANUAL');
  expect((await snap(page)).manual).toBe(true);

  // Face away from the lake so the run stays on dry land (deterministic test).
  await page.evaluate(() => window.__lupus!.app.wolf.place(-10, -12, Math.PI + 0.87));
  await page.waitForTimeout(300);

  // Hold W: the wolf moves and the state text changes to a gait.
  const before = await snap(page);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1800);
  const moving = await snap(page);
  await expect(page.locator('.wolf-state')).toContainText(/Walking|Trotting|Galloping|Turning/);
  // Shift = gallop
  await page.keyboard.down('ShiftLeft');
  await page.waitForTimeout(1800);
  const running = await snap(page);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  const moved = Math.hypot(moving.pos[0] - before.pos[0], moving.pos[2] - before.pos[2]);
  expect(moved).toBeGreaterThan(1);
  expect(running.motion).toMatch(/Galloping|Trotting|Swimming/);

  // Space = jump.
  await page.waitForTimeout(800);
  await page.keyboard.press('Space');
  await page.waitForTimeout(250);
  expect(['jump']).toContain((await snap(page)).state);
  // Wait for the landing to finish.
  await page.waitForFunction(() => window.__lupus!.app.wolf.state === 'locomotion' && window.__lupus!.app.wolf.canAct(), null, { timeout: 5000 });

  // Q = howl (sit + howl state, the HUD shows it).
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(400);
  expect((await snap(page)).state).toBe('howl');
  await expect(page.locator('.wolf-state')).toContainText('Howl');

  // C cycles the camera mode, M mutes, O opens settings, F3 debug panel.
  const cam0 = (await snap(page)).camera;
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(300);
  expect((await snap(page)).camera).not.toBe(cam0);
  await page.keyboard.press('KeyM');
  await expect(page.locator('#btn-mute')).toHaveText('🔇');
  await page.keyboard.press('KeyO');
  await expect(page.locator('.settings')).toHaveClass(/open/);
  await page.keyboard.press('F3');
  await expect(page.locator('.debug')).toHaveClass(/open/);

  // Toggle back to AI and let it decide something.
  await page.keyboard.press('KeyT');
  await expect(page.locator('.badge')).toHaveText('AI');
  await page.waitForTimeout(3000);
  const ai = await snap(page);
  expect(ai.action).not.toBe('none');

  // Reset button restores the simulation.
  await page.click('#btn-reset');
  await page.waitForTimeout(1500);

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  expect(warnings, `console warnings:\n${warnings.join('\n')}`).toEqual([]);
});
