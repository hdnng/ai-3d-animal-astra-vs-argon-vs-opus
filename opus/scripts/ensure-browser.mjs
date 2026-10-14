// Installs Playwright's Chromium if it is not present yet (used by test/bench scripts).
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

let ok = false;
try {
  ok = existsSync(chromium.executablePath());
} catch {
  ok = false;
}
if (!ok) {
  console.log('[ensure-browser] Installing Playwright Chromium (one-time download)...');
  execSync('npx playwright install chromium', { stdio: 'inherit' });
} else {
  console.log('[ensure-browser] Chromium present.');
}
