/**
 * Physiological / psychological needs. Each value is 0 (satisfied) .. 1
 * (urgent). Rates are tuned so a full cycle of behaviours plays out over a
 * few in-game hours.
 */
import { clamp01 } from '../utils/math';

export interface NeedContext {
  exertion: number;
  speed: number;
  resting: boolean;
  sleeping: boolean;
  night: number;
  nearPack: number;
}

export class Needs {
  hunger = 0.3;
  thirst = 0.25;
  fatigue = 0.15;
  social = 0.25;
  curiosity = 0.5;
  /** Global multiplier (debug / time acceleration). */
  rate = 1;

  update(dt: number, c: NeedContext): void {
    const r = dt * this.rate;
    const run = 1 + c.exertion * 1.5;
    this.hunger = clamp01(this.hunger + (r / 400) * run);
    this.thirst = clamp01(this.thirst + (r / 300) * (1 + c.exertion * 1.8));
    if (c.sleeping) this.fatigue = clamp01(this.fatigue - r / 70);
    else if (c.resting) this.fatigue = clamp01(this.fatigue - r / 110);
    else this.fatigue = clamp01(this.fatigue + r / 700 + (r * c.exertion) / 160 + (r * c.night) / 900);
    // Loneliness grows faster after dark (howling is a dusk/night behaviour).
    this.social = clamp01(this.social + (r / 380) * (1 + c.night * 2.2) - (r * c.nearPack) / 420);
    this.curiosity = clamp01(this.curiosity + r / 160);
  }

  reset(): void {
    this.hunger = 0.3;
    this.thirst = 0.25;
    this.fatigue = 0.15;
    this.social = 0.25;
    this.curiosity = 0.5;
  }
}
