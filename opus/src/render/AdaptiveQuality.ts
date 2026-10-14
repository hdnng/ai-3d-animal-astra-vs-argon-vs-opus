/**
 * Adaptive quality: watches frame times and walks a ladder of cheaper
 * settings when the GPU cannot keep up (and back up when there is headroom).
 * The user's settings are never overwritten; an "effective" copy is derived.
 *
 * Decisions use the trimmed mean frame time of 2 s windows (the slowest 3% of
 * frames are dropped so single hitches do not count). A median would be
 * misleading under vsync: frames snap to 16.7 / 33.3 ms, so a GPU that misses
 * every other deadline still shows a 60 FPS median. A downgrade needs two
 * consecutive slow windows (one if far too slow), and each change is followed
 * by a settle period: changing resolution reallocates render targets, which
 * itself causes a hitch that must not trigger another downgrade.
 *
 * The ladder is ordered by measured savings per visual loss on a fill-rate
 * bound iGPU: AO and resolution first, cosmetic extras later.
 */
import type { SettingsData, ShadowQuality } from '../core/Settings';

interface Step {
  name: string;
  apply(s: SettingsData): void;
}

const LADDER: Step[] = [
  { name: 'AO off', apply: (s) => (s.ambientOcclusion = false) },
  { name: 'res 85%', apply: (s) => (s.resolutionScale = Math.min(s.resolutionScale, 0.85)) },
  {
    name: 'shadows 1024, grass 70%, fur medium',
    apply: (s) => (
      (s.shadowQuality = Math.min(s.shadowQuality, 1) as ShadowQuality), (s.grassDensity = Math.min(s.grassDensity, 0.7)), (s.furQuality = Math.min(s.furQuality, 1))
    ),
  },
  { name: 'bloom off, grass 50%', apply: (s) => ((s.bloom = false), (s.grassDensity = Math.min(s.grassDensity, 0.5))) },
  { name: 'res 70%, fur off', apply: (s) => ((s.resolutionScale = Math.min(s.resolutionScale, 0.7)), (s.furQuality = 0)) },
  { name: 'no post-processing', apply: (s) => (s.postProcessing = false) },
  // (shadows stay on: toggling them would force every shader to recompile)
  { name: 'res 55%, grass 30%', apply: (s) => ((s.resolutionScale = Math.min(s.resolutionScale, 0.55)), (s.grassDensity = Math.min(s.grassDensity, 0.3))) },
];

const WINDOW = 2;

export class AdaptiveQuality {
  level = 0;
  private times: number[] = [];
  private acc = 0;
  /** Windows to ignore after a change (settling). */
  private settle = 1;
  private slowWindows = 0;
  private goodTime = 0;
  /** Target frame-rate band (median FPS). */
  low = 50;
  high = 58.5;
  enabled = true;
  /** Number of quality changes made (diagnostics). */
  changes = 0;
  onChange: (() => void) | null = null;

  get maxLevel(): number {
    return LADDER.length;
  }

  describe(): string {
    if (!this.enabled) return 'manual';
    return this.level === 0 ? 'full' : LADDER[this.level - 1].name;
  }

  effective(base: SettingsData): SettingsData {
    const s = { ...base };
    if (!this.enabled) return s;
    for (let i = 0; i < this.level; i++) LADDER[i].apply(s);
    return s;
  }

  /** Starts at a given level (GPU-tier based initial guess). */
  setInitialLevel(level: number): void {
    this.level = Math.max(0, Math.min(LADDER.length, level));
    this.settle = 1;
  }

  private change(delta: number): void {
    this.level += delta;
    this.changes++;
    this.settle = 2;
    this.slowWindows = 0;
    this.goodTime = 0;
    this.onChange?.();
  }

  /** Feed real frame durations (seconds). */
  sample(dt: number): void {
    if (!this.enabled || dt <= 0 || dt > 0.5) return;
    this.times.push(dt);
    this.acc += dt;
    if (this.acc < WINDOW) return;
    const sorted = this.times.sort((a, b) => a - b);
    const keep = Math.max(1, Math.floor(sorted.length * 0.97));
    let sum = 0;
    for (let i = 0; i < keep; i++) sum += sorted[i];
    const mean = sum / keep;
    const p80 = sorted[Math.floor(sorted.length * 0.8)];
    this.times.length = 0;
    this.acc = 0;
    if (this.settle > 0) {
      this.settle--;
      return;
    }
    const fps = 1 / mean;
    if (fps < this.low && this.level < LADDER.length) {
      this.goodTime = 0;
      if (++this.slowWindows >= (fps < this.low * 0.6 ? 1 : 2)) this.change(+1);
    } else if (1 / p80 > this.high) {
      this.slowWindows = 0;
      this.goodTime += WINDOW;
      if (this.goodTime >= 16 && this.level > 0) this.change(-1);
    } else {
      this.slowWindows = 0;
      this.goodTime = 0;
    }
  }

  /** Restarts measurement (e.g. after a user settings change). */
  reset(): void {
    this.times = [];
    this.acc = 0;
    this.settle = 1;
    this.slowWindows = 0;
    this.goodTime = 0;
  }
}
