/**
 * Simulation Clock & Telemetry Tracker
 * Manages frame delta, elapsed simulation time, day/night cycle time (0..24h),
 * and rolling frame-time buffers for FPS and 1% low calculations.
 */
export class SimulationClock {
  public elapsed = 0;
  public delta = 0.016;
  public rawDelta = 0.016;
  public timeOfDay = 10.5; // Hours in [0, 24)
  public timeSpeed = 1.0; // Multiplier for day/night progression
  public fps = 60;
  public frameTimeMs = 16.6;

  private lastNow = performance.now();
  private frameSamples: Float32Array = new Float32Array(60);
  private sampleIndex = 0;
  private sampleCount = 0;

  private readonly hoursPerSecond = 0.08;

  constructor() {
    this.frameSamples.fill(16.6);
  }

  reset(): void {
    this.elapsed = 0;
    this.timeOfDay = 10.5;
    this.lastNow = performance.now();
  }

  tick(now = performance.now()): number {
    const rawMs = Math.max(0.1, now - this.lastNow);
    this.lastNow = now;

    this.rawDelta = rawMs / 1000;
    this.delta = Math.min(this.rawDelta, 0.05);
    this.elapsed += this.delta;

    // Advance day/night clock
    this.timeOfDay = (this.timeOfDay + this.delta * this.hoursPerSecond * this.timeSpeed) % 24;
    if (this.timeOfDay < 0) this.timeOfDay += 24;

    // Ignore one-time tab-switch or initial shader-compile stalls (>120ms) in HUD rolling average
    if (rawMs < 120) {
      this.frameSamples[this.sampleIndex] = rawMs;
      this.sampleIndex = (this.sampleIndex + 1) % this.frameSamples.length;
      if (this.sampleCount < this.frameSamples.length) this.sampleCount++;
    }

    if (this.sampleCount > 0) {
      let sumMs = 0;
      for (let i = 0; i < this.sampleCount; i++) {
        sumMs += this.frameSamples[i];
      }
      this.frameTimeMs = sumMs / this.sampleCount;
      this.fps = Math.min(240, 1000 / Math.max(1, this.frameTimeMs));
    }

    return this.delta;
  }

  /**
   * Deterministic step for automated fast-forward / 5-minute stress tests
   */
  stepFixed(dtSeconds: number): void {
    this.rawDelta = dtSeconds;
    this.delta = Math.min(dtSeconds, 0.05);
    this.elapsed += this.delta;
    this.timeOfDay = (this.timeOfDay + this.delta * this.hoursPerSecond * this.timeSpeed) % 24;
    if (this.timeOfDay < 0) this.timeOfDay += 24;
  }

  getFormattedTime(): string {
    const totalMinutes = Math.floor(this.timeOfDay * 60);
    const hours24 = Math.floor(totalMinutes / 60) % 24;
    const mins = totalMinutes % 60;
    const period = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
    return `${hours12}:${mins.toString().padStart(2, '0')} ${period}`;
  }

  getDayPhaseLabel(): string {
    const h = this.timeOfDay;
    if (h >= 5.5 && h < 7.5) return 'Dawn / Sunrise';
    if (h >= 7.5 && h < 17.5) return 'Daylight';
    if (h >= 17.5 && h < 19.8) return 'Golden Dusk';
    return 'Starlight Night';
  }
}
