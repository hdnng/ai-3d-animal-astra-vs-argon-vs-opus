/**
 * Pure Procedural Web Audio API Soundscape & Foley Synthesizer
 * Synthesizes footsteps, water splashes, mountain wind, river stream ambience,
 * expressive multi-harmonic wolf howls, and generative ambient pads with zero external files.
 */
export class ProceduralAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private waterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  public muted = false;
  private initialized = false;
  private padTimer = 0;

  constructor() {
    const unlock = () => {
      this.ensureInitialized();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  private ensureInitialized(): boolean {
    if (this.initialized) return true;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return false;

      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.45;
      this.masterGain.connect(this.ctx.destination);

      // Generate 2-second white/pink noise buffer for foley & wind
      const sr = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, sr * 2, sr);
      const data = this.noiseBuffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + white * 0.029;
        b1 = 0.985 * b1 + white * 0.032;
        b2 = 0.950 * b2 + white * 0.048;
        data[i] = (b0 + b1 + b2 + white * 0.18) * 0.35;
      }

      this.setupContinuousAmbience();
      this.initialized = true;
      return true;
    } catch {
      return false;
    }
  }

  private setupContinuousAmbience(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;

    // 1. Mountain Wind Loop
    const windSource = this.ctx.createBufferSource();
    windSource.buffer = this.noiseBuffer;
    windSource.loop = true;

    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 340;
    windFilter.Q.value = 2.2;

    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.14;

    windSource.connect(windFilter);
    windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);
    windSource.start();

    // 2. River Stream Babble Loop
    const waterSource = this.ctx.createBufferSource();
    waterSource.buffer = this.noiseBuffer;
    waterSource.loop = true;

    const waterFilter = this.ctx.createBiquadFilter();
    waterFilter.type = 'bandpass';
    waterFilter.frequency.value = 920;
    waterFilter.Q.value = 1.4;

    this.waterGain = this.ctx.createGain();
    this.waterGain.gain.value = 0.08;

    waterSource.connect(waterFilter);
    waterFilter.connect(this.waterGain);
    this.waterGain.connect(this.masterGain);
    waterSource.start();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.ensureInitialized();
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 0.45, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  }

  playFootstep(inWater: boolean, speed: number): void {
    if (this.muted || !this.ensureInitialized() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    if (this.ctx.state !== 'running') return;

    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    const env = this.ctx.createGain();
    const vol = Math.min(0.22, (0.05 + (speed / 10) * 0.15));

    if (inWater) {
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(650 + Math.random() * 450, now);
      filter.Q.value = 2.5;
      env.gain.setValueAtTime(vol * 1.2, now);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      src.connect(filter);
      filter.connect(env);
      env.connect(this.masterGain);
      src.start(now, Math.random() * 1.2, 0.19);
    } else {
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(220 + Math.random() * 120, now);
      env.gain.setValueAtTime(vol, now);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
      src.connect(filter);
      filter.connect(env);
      env.connect(this.masterGain);
      src.start(now, Math.random() * 1.5, 0.09);
    }
  }

  playWolfHowl(): void {
    if (this.muted || !this.ensureInitialized() || !this.ctx || !this.masterGain) return;
    if (this.ctx.state !== 'running') return;

    const now = this.ctx.currentTime;

    // Synthesize resonant timber wolf howl using fundamental + 2nd harmonic + formant filter
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const formant = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc1.type = 'sawtooth';
    osc2.type = 'triangle';

    // Pitch contour of a wolf howl: 240Hz -> 430Hz -> 395Hz -> 270Hz
    osc1.frequency.setValueAtTime(240, now);
    osc1.frequency.exponentialRampToValueAtTime(430, now + 0.65);
    osc1.frequency.setValueAtTime(425, now + 1.8);
    osc1.frequency.exponentialRampToValueAtTime(275, now + 3.0);

    osc2.frequency.setValueAtTime(480, now);
    osc2.frequency.exponentialRampToValueAtTime(860, now + 0.65);
    osc2.frequency.exponentialRampToValueAtTime(550, now + 3.0);

    formant.type = 'lowpass';
    formant.frequency.setValueAtTime(620, now);
    formant.frequency.linearRampToValueAtTime(980, now + 0.7);
    formant.frequency.linearRampToValueAtTime(480, now + 3.0);
    formant.Q.value = 3.2;

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.45);
    gain.gain.setValueAtTime(0.16, now + 1.9);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 3.1);

    osc1.connect(formant);
    osc2.connect(formant);
    formant.connect(gain);
    gain.connect(this.masterGain);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 3.15);
    osc2.stop(now + 3.15);
  }

  playActionCue(action: 'howl' | 'pounce' | 'bark' | 'drink' | 'eat'): void {
    if (action === 'howl') {
      this.playWolfHowl();
    } else if (action === 'pounce') {
      this.playFootstep(false, 9.0);
    }
  }

  update(dt: number, wolfPos: { x: number; y: number; z: number }, waterLevel: number): void {
    if (this.muted || !this.initialized || !this.ctx || !this.masterGain) return;
    if (this.ctx.state !== 'running') return;

    // Modulate river audio volume based on proximity to water level
    const heightAboveWater = Math.max(0, wolfPos.y - waterLevel);
    const waterProximity = Math.max(0.03, Math.min(0.22, 0.22 / (1 + heightAboveWater * 0.45)));
    if (this.waterGain) {
      this.waterGain.gain.setTargetAtTime(waterProximity, this.ctx.currentTime, 0.2);
    }

    // Play gentle ambient harmonic pad chord every 7.5 seconds
    this.padTimer -= dt;
    if (this.padTimer <= 0) {
      this.padTimer = 7.5;
      this.triggerAmbientPadNote();
    }
  }

  private triggerAmbientPadNote(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const notes = [146.83, 196.0, 220.0, 261.63, 293.66, 329.63]; // D minor / pentatonic alpine voicings
    const freq = notes[Math.floor(Math.random() * notes.length)];

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.035, now + 2.2);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 6.8);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 7.0);
  }
}
