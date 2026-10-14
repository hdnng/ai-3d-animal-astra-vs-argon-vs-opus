export type ShadowQuality = 'high' | 'medium' | 'low' | 'off';
export type WeatherMode = 'clear' | 'rain' | 'mist';

export interface QualitySettings {
  shadowQuality: ShadowQuality;
  resolutionScale: number;
  postProcessing: boolean;
  weather: WeatherMode;
  adaptiveQuality: boolean;
}

/**
 * Adaptive Quality & Graphics Settings Manager
 * Monitors rolling FPS and automatically adjusts resolution scale or shadow map tier
 * if performance drops below threshold on constrained hardware.
 */
export class QualityManager {
  public settings: QualitySettings = {
    shadowQuality: 'high',
    resolutionScale: 1.0,
    postProcessing: true,
    weather: 'clear',
    adaptiveQuality: true
  };

  private lowFpsTimer = 0;
  private highFpsTimer = 0;
  private onChangeCallbacks: Array<(s: QualitySettings) => void> = [];

  onChange(cb: (s: QualitySettings) => void): void {
    this.onChangeCallbacks.push(cb);
  }

  notifyChange(): void {
    for (const cb of this.onChangeCallbacks) {
      cb(this.settings);
    }
  }

  updateAdaptive(fps: number, dt: number): boolean {
    if (!this.settings.adaptiveQuality) return false;

    if (fps < 42) {
      this.lowFpsTimer += dt;
      this.highFpsTimer = 0;
      if (this.lowFpsTimer > 2.5) {
        this.lowFpsTimer = 0;
        return this.stepDownQuality();
      }
    } else if (fps > 57) {
      this.highFpsTimer += dt;
      this.lowFpsTimer = 0;
    } else {
      this.lowFpsTimer = Math.max(0, this.lowFpsTimer - dt * 0.5);
    }
    return false;
  }

  private stepDownQuality(): boolean {
    if (this.settings.resolutionScale > 0.75) {
      this.settings.resolutionScale = Math.max(0.7, Math.round((this.settings.resolutionScale - 0.15) * 10) / 10);
      this.notifyChange();
      return true;
    }
    if (this.settings.shadowQuality === 'high') {
      this.settings.shadowQuality = 'medium';
      this.notifyChange();
      return true;
    }
    if (this.settings.postProcessing) {
      this.settings.postProcessing = false;
      this.notifyChange();
      return true;
    }
    if (this.settings.shadowQuality === 'medium') {
      this.settings.shadowQuality = 'low';
      this.notifyChange();
      return true;
    }
    return false;
  }
}
