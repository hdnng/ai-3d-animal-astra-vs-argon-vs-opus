/** Runtime-tunable settings. Changes are broadcast to subscribers. */

export type ShadowQuality = 0 | 1 | 2 | 3; // off, low, medium, high
export type WeatherMode = 'auto' | 'clear' | 'rain';

export interface SettingsData {
  shadowQuality: ShadowQuality;
  resolutionScale: number; // multiplier on devicePixelRatio (0.5..1)
  postProcessing: boolean;
  ambientOcclusion: boolean;
  bloom: boolean;
  weatherEnabled: boolean;
  weatherMode: WeatherMode;
  timeSpeed: number; // multiplier on the base day length
  grassDensity: number; // 0..1
  furQuality: number; // 0 (no shells) .. 2 (full shells)
  adaptiveQuality: boolean;
  showHud: boolean;
}

export const DEFAULT_SETTINGS: SettingsData = {
  shadowQuality: 2,
  resolutionScale: 1,
  postProcessing: true,
  ambientOcclusion: true,
  bloom: true,
  weatherEnabled: true,
  weatherMode: 'auto',
  timeSpeed: 1,
  grassDensity: 1,
  furQuality: 2,
  adaptiveQuality: true,
  showHud: true,
};

type Listener = (s: SettingsData, changed: keyof SettingsData) => void;

export class Settings {
  data: SettingsData;
  private listeners = new Set<Listener>();

  constructor(overrides: Partial<SettingsData> = {}) {
    this.data = { ...DEFAULT_SETTINGS, ...overrides };
  }

  get<K extends keyof SettingsData>(key: K): SettingsData[K] {
    return this.data[key];
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]): void {
    if (this.data[key] === value) return;
    this.data[key] = value;
    for (const l of this.listeners) l(this.data, key);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
