/**
 * Fully procedural sound (Web Audio API, no samples):
 *  - ambience: wind (brown noise), lake water, rain, night crickets
 *  - creatures: footsteps by surface, wolf howls (formant-filtered voices),
 *    growls, barks, panting, deer snorts, birds chirping/scattering, owls
 *  - events: splashes, shake-off, landings, thunder
 *  - music: slow generative pad with occasional plucked notes
 * The context is created lazily on the first user gesture (autoplay policy).
 */
import * as THREE from 'three';
import { events } from '../core/Events';
import { clamp, clamp01, lerp } from '../utils/math';
import { fxRandom } from '../utils/Random';

interface Listener {
  pos: THREE.Vector3;
  right: THREE.Vector3;
}

export interface AudioWorldState {
  night: number;
  wind: number;
  rain: number;
  lakeDistance: number;
  exertion: number;
  alphaPos: THREE.Vector3;
  timeOfDay: number;
}

const _d = new THREE.Vector3();

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private music!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private white!: AudioBuffer;
  private pink!: AudioBuffer;
  private brown!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private leafGain!: GainNode;
  private waterGain!: GainNode;
  private rainGain!: GainNode;
  private cricketGain!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private listener: Listener = { pos: new THREE.Vector3(), right: new THREE.Vector3(1, 0, 0) };
  private state: AudioWorldState | null = null;
  muted = false;
  musicEnabled = true;
  private activeSteps = 0;
  private birdT = 3;
  private owlT = 20;
  private pantT = 0;
  private chordT = 0;
  private chordIdx = 0;
  private pluckT = 4;
  private padVoices: { osc: OscillatorNode[]; gain: GainNode }[] = [];
  private unsub: (() => void)[] = [];
  private dripT = 0;

  /** Must be called from a user gesture handler. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(comp);
    this.sfx = this.bus(0.9);
    this.amb = this.bus(0.7);
    this.music = this.bus(this.musicEnabled ? 0.32 : 0);
    // Reverb with a synthetic impulse response (exponentially decaying noise).
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.2, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.5;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.master);
    this.white = this.noiseBuffer('white', 2);
    this.pink = this.noiseBuffer('pink', 3);
    this.brown = this.noiseBuffer('brown', 4);
    this.startAmbience();
    this.subscribe();
  }

  private bus(g: number): GainNode {
    const n = this.ctx!.createGain();
    n.gain.value = g;
    n.connect(this.master);
    return n;
  }

  private noiseBuffer(kind: 'white' | 'pink' | 'brown', seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    // Crossfade the loop seam.
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      d[i] = d[i] * t + d[len - fade + i] * (1 - t);
    }
    return buf;
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  private loop(buf: AudioBuffer): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.loopStart = Math.random() * 0.5;
    s.start(0, Math.random() * buf.duration);
    return s;
  }

  private startAmbience(): void {
    const ctx = this.ctx!;
    // Wind: brown noise through a moving band-pass.
    const w = this.loop(this.brown);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    w.connect(this.windFilter).connect(this.windGain).connect(this.amb);
    // Leaf rustle: high band of pink noise.
    const l = this.loop(this.pink);
    const lf = ctx.createBiquadFilter();
    lf.type = 'highpass';
    lf.frequency.value = 2500;
    this.leafGain = ctx.createGain();
    this.leafGain.gain.value = 0;
    l.connect(lf).connect(this.leafGain).connect(this.amb);
    // Lake water lapping: modulated band-passed pink noise.
    const wt = this.loop(this.pink);
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 700;
    wf.Q.value = 1.2;
    const lap = ctx.createGain();
    lap.gain.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.35;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 0.4;
    lfo.connect(lfoAmt).connect(lap.gain);
    lfo.start();
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    wt.connect(wf).connect(lap).connect(this.waterGain).connect(this.amb);
    // Rain.
    const r = this.loop(this.white);
    const rh = ctx.createBiquadFilter();
    rh.type = 'highpass';
    rh.frequency.value = 900;
    const rl = ctx.createBiquadFilter();
    rl.type = 'lowpass';
    rl.frequency.value = 7000;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    r.connect(rh).connect(rl).connect(this.rainGain).connect(this.amb);
    // Crickets: high sine gated by fast and slow pulses.
    const co = ctx.createOscillator();
    co.frequency.value = 4400;
    const gate = ctx.createGain();
    gate.gain.value = 0;
    const pulse = ctx.createOscillator();
    pulse.type = 'square';
    pulse.frequency.value = 26;
    const pulseAmt = ctx.createGain();
    pulseAmt.gain.value = 0.5;
    pulse.connect(pulseAmt).connect(gate.gain);
    const chirp = ctx.createOscillator();
    chirp.type = 'square';
    chirp.frequency.value = 2.7;
    const chirpGain = ctx.createGain();
    chirpGain.gain.value = 0;
    const chirpAmt = ctx.createGain();
    chirpAmt.gain.value = 0.5;
    chirp.connect(chirpAmt).connect(chirpGain.gain);
    this.cricketGain = ctx.createGain();
    this.cricketGain.gain.value = 0;
    co.connect(gate).connect(chirpGain).connect(this.cricketGain).connect(this.amb);
    co.start();
    pulse.start();
    chirp.start();
    // Music bus filter.
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 1400;
    this.musicFilter.Q.value = 0.5;
    this.musicFilter.connect(this.music);
    const mSend = ctx.createGain();
    mSend.gain.value = 0.6;
    this.musicFilter.connect(mSend).connect(this.reverbSend);
  }

  // ------------------------------------------------------------- helpers

  /** Stereo pan + distance gain for a world position. */
  private spatial(x: number, y: number, z: number, ref = 4): { pan: number; gain: number; dist: number } {
    _d.set(x - this.listener.pos.x, y - this.listener.pos.y, z - this.listener.pos.z);
    const dist = _d.length();
    const pan = dist > 0.01 ? clamp(_d.dot(this.listener.right) / dist, -1, 1) * 0.85 : 0;
    const gain = 1 / (1 + Math.max(0, dist - 1.5) / ref);
    return { pan, gain, dist };
  }

  private voiceOut(x: number, y: number, z: number, ref: number, reverb = 0.15): { input: GainNode; gain: number; dist: number } | null {
    const ctx = this.ctx;
    if (!ctx || this.muted) return null;
    const sp = this.spatial(x, y, z, ref);
    if (sp.gain < 0.02) return null;
    const input = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = sp.pan;
    input.connect(panner).connect(this.sfx);
    if (reverb > 0) {
      const send = ctx.createGain();
      send.gain.value = reverb * (0.5 + 0.5 * clamp01(sp.dist / 40));
      panner.connect(send).connect(this.reverbSend);
    }
    return { input, gain: sp.gain, dist: sp.dist };
  }

  private noiseBurst(out: AudioNode, buf: AudioBuffer, t0: number, dur: number, gain: number, type: BiquadFilterType, freq: number, q = 1, attack = 0.003, freqEnd?: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t0, Math.random() * Math.max(0, buf.duration - dur - 0.1));
    src.stop(t0 + dur + 0.05);
  }

  // ------------------------------------------------------------- sounds

  footstep(x: number, y: number, z: number, strength: number, surface: string, animal: string): void {
    if (this.activeSteps > 10) return;
    const v = this.voiceOut(x, y, z, 3, 0.05);
    if (!v) return;
    const t = this.ctx!.currentTime;
    const g = v.gain * strength * (animal === 'deer' ? 0.6 : 0.45);
    this.activeSteps++;
    setTimeout(() => this.activeSteps--, 120);
    switch (surface) {
      case 'water':
        this.noiseBurst(v.input, this.white, t, 0.22, g * 0.9, 'bandpass', 900, 0.8, 0.005, 400);
        break;
      case 'rock':
        this.noiseBurst(v.input, this.white, t, 0.05, g * 0.8, 'bandpass', 2600, 2);
        break;
      case 'grass':
        this.noiseBurst(v.input, this.white, t, 0.11, g * 0.7, 'bandpass', 2200, 0.7, 0.008);
        this.noiseBurst(v.input, this.brown, t, 0.08, g * 0.8, 'lowpass', 300);
        break;
      default:
        this.noiseBurst(v.input, this.brown, t, 0.09, g * 1.1, 'lowpass', 500);
        this.noiseBurst(v.input, this.white, t, 0.04, g * 0.3, 'bandpass', 1500, 1);
    }
    if (animal === 'deer') this.noiseBurst(v.input, this.white, t, 0.03, g * 0.5, 'bandpass', 1200, 4);
  }

  /** Wolf howl: glottal saw/triangle through vowel formants with pitch glide + vibrato. */
  howl(x: number, y: number, z: number, pitch: number, delay = 0): void {
    const v = this.voiceOut(x, y, z, 30, 0.7);
    if (!v) return;
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + delay;
    const dur = 4.2 + fxRandom.next() * 0.8;
    const f0 = 380 * pitch;
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    const tri = ctx.createOscillator();
    tri.type = 'triangle';
    for (const o of [src, tri]) {
      o.frequency.setValueAtTime(f0 * 0.72, t0);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.12, t0 + 0.9);
      o.frequency.setValueAtTime(f0 * 1.12, t0 + dur * 0.6);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.04, t0 + dur * 0.8);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.62, t0 + dur);
    }
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2 + fxRandom.next();
    const vibAmt = ctx.createGain();
    vibAmt.gain.setValueAtTime(0, t0);
    vibAmt.gain.linearRampToValueAtTime(f0 * 0.018, t0 + 1.5);
    vib.connect(vibAmt);
    vibAmt.connect(src.frequency);
    vibAmt.connect(tri.frequency);
    const mix = ctx.createGain();
    const sg = ctx.createGain();
    sg.gain.value = 0.25;
    const tg = ctx.createGain();
    tg.gain.value = 0.9;
    src.connect(sg).connect(mix);
    tri.connect(tg).connect(mix);
    // "oo" -> "ow" formants
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(0.5 * v.gain, t0 + 0.6);
    env.gain.setValueAtTime(0.5 * v.gain, t0 + dur * 0.75);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    for (const [f, q, g] of [
      [f0 * 1.05, 6, 1.0],
      [820, 5, 0.5],
      [1150, 6, 0.25],
      [2600, 8, 0.08],
    ]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const gg = ctx.createGain();
      gg.gain.value = g;
      mix.connect(bp).connect(gg).connect(env);
    }
    // breath
    const breath = ctx.createBufferSource();
    breath.buffer = this.pink;
    const bf = ctx.createBiquadFilter();
    bf.type = 'bandpass';
    bf.frequency.value = 1400;
    const bg = ctx.createGain();
    bg.gain.value = 0.04;
    breath.connect(bf).connect(bg).connect(env);
    env.connect(v.input);
    for (const o of [src, tri, vib]) {
      o.start(t0);
      o.stop(t0 + dur + 0.1);
    }
    breath.start(t0);
    breath.stop(t0 + dur + 0.1);
  }

  growl(x: number, y: number, z: number): void {
    const v = this.voiceOut(x, y, z, 6, 0.1);
    if (!v) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(95, t);
    o.frequency.linearRampToValueAtTime(80, t + 0.9);
    const am = ctx.createOscillator();
    am.frequency.value = 32;
    const amg = ctx.createGain();
    amg.gain.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    am.connect(amg).connect(g.gain);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 650;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.5 * v.gain, t + 0.08);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    o.connect(g).connect(lp).connect(env).connect(v.input);
    this.noiseBurst(env, this.brown, t, 0.9, 0.4, 'lowpass', 400);
    o.start(t);
    am.start(t);
    o.stop(t + 1.05);
    am.stop(t + 1.05);
  }

  bark(x: number, y: number, z: number, pitch: number): void {
    const v = this.voiceOut(x, y, z, 10, 0.25);
    if (!v) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    for (let k = 0; k < 2; k++) {
      const tk = t + k * 0.22;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(950 * pitch, tk);
      o.frequency.exponentialRampToValueAtTime(480 * pitch, tk + 0.12);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1100;
      bp.Q.value = 1.2;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, tk);
      env.gain.exponentialRampToValueAtTime(0.35 * v.gain, tk + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, tk + 0.14);
      o.connect(bp).connect(env).connect(v.input);
      o.start(tk);
      o.stop(tk + 0.16);
    }
  }

  splash(x: number, y: number, z: number, strength: number): void {
    const v = this.voiceOut(x, y, z, 8, 0.15);
    if (!v) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(v.input, this.white, t, 0.35 + strength * 0.3, 0.5 * v.gain * clamp01(strength + 0.2), 'bandpass', 1800, 0.6, 0.005, 500);
    this.noiseBurst(v.input, this.brown, t, 0.3, 0.4 * v.gain * strength, 'lowpass', 300);
  }

  shake(x: number, y: number, z: number): void {
    const v = this.voiceOut(x, y, z, 5, 0.05);
    if (!v) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 12; i++) this.noiseBurst(v.input, this.brown, t + i * 0.11, 0.1, 0.35 * v.gain, 'bandpass', 700 + (i % 2) * 300, 0.8);
    for (let i = 0; i < 18; i++) this.noiseBurst(v.input, this.white, t + 0.3 + fxRandom.next() * 1.0, 0.03, 0.15 * v.gain, 'bandpass', 3000 + fxRandom.next() * 2000, 3);
  }

  thump(x: number, y: number, z: number, strength: number): void {
    const v = this.voiceOut(x, y, z, 5, 0.05);
    if (!v) return;
    this.noiseBurst(v.input, this.brown, this.ctx!.currentTime, 0.18, 0.6 * v.gain * (0.4 + strength), 'lowpass', 220);
  }

  chew(x: number, y: number, z: number): void {
    const v = this.voiceOut(x, y, z, 4, 0.02);
    if (!v) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 3; i++) this.noiseBurst(v.input, this.white, t + i * 0.13, 0.05, 0.25 * v.gain, 'bandpass', 1500 + fxRandom.next() * 1500, 2);
  }

  lap(x: number, y: number, z: number): void {
    const v = this.voiceOut(x, y, z, 4, 0.02);
    if (!v) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 2; i++) this.noiseBurst(v.input, this.white, t + i * 0.2, 0.07, 0.3 * v.gain, 'bandpass', 1100, 3, 0.005, 700);
  }

  snort(x: number, y: number, z: number): void {
    const v = this.voiceOut(x, y, z, 14, 0.3);
    if (!v) return;
    this.noiseBurst(v.input, this.pink, this.ctx!.currentTime, 0.32, 0.6 * v.gain, 'bandpass', 520, 1.4, 0.01, 300);
  }

  chirp(x: number, y: number, z: number, n = 4): void {
    const v = this.voiceOut(x, y, z, 25, 0.35);
    if (!v) return;
    const ctx = this.ctx!;
    let t = ctx.currentTime;
    const base = 2600 + fxRandom.next() * 1800;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f = base * (0.85 + fxRandom.next() * 0.4);
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * (fxRandom.next() < 0.5 ? 1.6 : 0.6), t + 0.07);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.12 * v.gain, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(env).connect(v.input);
      o.start(t);
      o.stop(t + 0.1);
      t += 0.09 + fxRandom.next() * 0.08;
    }
  }

  flutter(x: number, y: number, z: number): void {
    const v = this.voiceOut(x, y, z, 10, 0.1);
    if (!v) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 26; i++) this.noiseBurst(v.input, this.white, t + i * 0.035 + fxRandom.next() * 0.02, 0.04, 0.22 * v.gain, 'bandpass', 1800 + fxRandom.next() * 900, 1.2);
    this.chirp(x, y, z, 6);
  }

  owl(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const out = ctx.createGain();
    const pan = ctx.createStereoPanner();
    pan.pan.value = fxRandom.next() * 1.6 - 0.8;
    out.connect(pan).connect(this.amb);
    const send = ctx.createGain();
    send.gain.value = 0.6;
    pan.connect(send).connect(this.reverbSend);
    let t = ctx.currentTime;
    for (const d of [0.35, 0.18, 0.55]) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(390, t);
      o.frequency.linearRampToValueAtTime(360, t + d);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.12, t + 0.06);
      env.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(env).connect(out);
      o.start(t);
      o.stop(t + d + 0.05);
      t += d + 0.12;
    }
  }

  thunder(intensity: number, delay: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + delay;
    const out = ctx.createGain();
    out.gain.value = 0.9 * intensity;
    out.connect(this.amb);
    out.connect(this.reverbSend);
    this.noiseBurst(out, this.brown, t, 3.5, 0.9, 'lowpass', 900, 0.7, 0.02, 90);
    this.noiseBurst(out, this.brown, t + 0.3, 2.5, 0.6, 'lowpass', 300, 0.7, 0.2, 60);
    this.noiseBurst(out, this.white, t, 0.25, 0.25 * intensity, 'bandpass', 2500, 0.5);
  }

  private pant(x: number, y: number, z: number, amount: number): void {
    const v = this.voiceOut(x, y, z, 3, 0);
    if (!v) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(v.input, this.pink, t, 0.12, 0.18 * amount * v.gain, 'bandpass', 900, 1.5, 0.02);
    this.noiseBurst(v.input, this.pink, t + 0.16, 0.12, 0.13 * amount * v.gain, 'bandpass', 1300, 1.5, 0.02);
  }

  // -------------------------------------------------------------- music

  private static CHORDS = [
    [50, 57, 60, 64, 69], // Dm9
    [46, 53, 57, 62, 65], // Bbmaj7
    [53, 57, 60, 64, 67], // Fmaj7
    [48, 55, 59, 62, 64], // Cmaj7/9
    [45, 52, 57, 60, 64], // Am7
  ];
  private static SCALE = [62, 65, 67, 69, 72, 74, 76, 79];

  private midi(n: number): number {
    return 440 * Math.pow(2, (n - 69) / 12);
  }

  private playChord(night: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    // release previous
    for (const v of this.padVoices) {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0.0001, t, 2.5);
      for (const o of v.osc) o.stop(t + 10);
    }
    this.padVoices = [];
    const chord = AudioEngine.CHORDS[this.chordIdx % AudioEngine.CHORDS.length];
    this.chordIdx += fxRandom.next() < 0.7 ? 1 : 2;
    for (const note of chord) {
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.setTargetAtTime(lerp(0.05, 0.035, night) / chord.length * 3, t, 2.2);
      const oscs: OscillatorNode[] = [];
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = this.midi(note - (night > 0.5 ? 12 : 0));
        o.detune.value = det;
        o.connect(g);
        o.start(t);
        oscs.push(o);
      }
      g.connect(this.musicFilter);
      this.padVoices.push({ osc: oscs, gain: g });
    }
  }

  private pluck(night: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const n = AudioEngine.SCALE[Math.floor(fxRandom.next() * AudioEngine.SCALE.length)] - (night > 0.5 ? 12 : 0);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = this.midi(n);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    o.connect(env);
    env.connect(this.music);
    env.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(this.music);
    env.connect(this.reverbSend);
    o.start(t);
    o.stop(t + 2.5);
    setTimeout(() => {
      delay.disconnect();
      fb.disconnect();
    }, 6000);
  }

  // ------------------------------------------------------------- update

  private subscribe(): void {
    this.unsub.push(
      events.on('footstep', (e) => this.footstep(e.x, e.y, e.z, e.strength, e.surface, e.animal)),
      events.on('howl', (e) => this.howl(e.x, e.y, e.z, e.pitch, 0.5)),
      events.on('growl', (e) => this.growl(e.x, e.y, e.z)),
      events.on('bark', (e) => this.bark(e.x, e.y, e.z, e.pitch)),
      events.on('splash', (e) => this.splash(e.x, e.y, e.z, e.strength)),
      events.on('shake', (e) => this.shake(e.x, e.y, e.z)),
      events.on('land', (e) => this.thump(e.x, e.y, e.z, e.strength)),
      events.on('jump', (e) => this.thump(e.x, e.y, e.z, 0.3)),
      events.on('eat', (e) => this.chew(e.x, e.y, e.z)),
      events.on('drink', (e) => this.lap(e.x, e.y, e.z)),
      events.on('deerAlarm', (e) => this.snort(e.x, e.y, e.z)),
      events.on('birdScatter', (e) => this.flutter(e.x, e.y, e.z)),
      events.on('fishJump', (e) => this.splash(e.x, e.y, e.z, 0.3)),
      events.on('lightning', (e) => this.thunder(e.intensity, e.delay)),
    );
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  setMusic(on: boolean): void {
    this.musicEnabled = on;
    if (this.ctx) this.music.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.3);
  }

  update(dt: number, camera: THREE.Camera, s: AudioWorldState): void {
    this.state = s;
    camera.getWorldPosition(this.listener.pos);
    this.listener.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const day = 1 - s.night;
    this.windGain.gain.setTargetAtTime(0.06 + s.wind * 0.22, t, 0.5);
    this.windFilter.frequency.setTargetAtTime(250 + s.wind * 500, t, 0.8);
    this.leafGain.gain.setTargetAtTime(0.01 + s.wind * 0.05, t, 0.6);
    this.waterGain.gain.setTargetAtTime(0.35 * clamp01(1 - s.lakeDistance / 45), t, 0.5);
    this.rainGain.gain.setTargetAtTime(s.rain * 0.3, t, 0.6);
    this.cricketGain.gain.setTargetAtTime(clamp01((s.night - 0.5) * 2) * 0.035 * (1 - s.rain), t, 1.5);
    this.musicFilter.frequency.setTargetAtTime(lerp(700, 1800, day) * (1 - s.rain * 0.3), t, 2);
    // Generative music.
    this.chordT -= dt;
    if (this.chordT <= 0 && this.musicEnabled) {
      this.chordT = 11 + fxRandom.next() * 5;
      this.playChord(s.night);
    }
    this.pluckT -= dt;
    if (this.pluckT <= 0 && this.musicEnabled) {
      this.pluckT = 2.5 + fxRandom.next() * 6;
      this.pluck(s.night);
    }
    // Daytime birdsong / night owls.
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = 1.5 + fxRandom.next() * 5;
      if (day > 0.5 && s.rain < 0.3) {
        const a = fxRandom.next() * Math.PI * 2;
        this.chirp(this.listener.pos.x + Math.cos(a) * 25, this.listener.pos.y + 6, this.listener.pos.z + Math.sin(a) * 25, 3 + Math.floor(fxRandom.next() * 5));
      }
    }
    this.owlT -= dt;
    if (this.owlT <= 0) {
      this.owlT = 18 + fxRandom.next() * 30;
      if (s.night > 0.7) this.owl();
    }
    // Rain drips on leaves.
    this.dripT -= dt;
    if (s.rain > 0.3 && this.dripT <= 0) {
      this.dripT = 0.05 + fxRandom.next() * 0.2 / s.rain;
      const out = this.voiceOut(this.listener.pos.x + (fxRandom.next() - 0.5) * 10, this.listener.pos.y, this.listener.pos.z + (fxRandom.next() - 0.5) * 10, 6, 0.05);
      if (out) this.noiseBurst(out.input, this.white, t, 0.02, 0.15 * out.gain, 'bandpass', 3000 + fxRandom.next() * 3000, 4);
    }
    // Panting after exertion.
    this.pantT -= dt;
    if (s.exertion > 0.4 && this.pantT <= 0) {
      this.pantT = 0.38;
      this.pant(s.alphaPos.x, s.alphaPos.y + 0.8, s.alphaPos.z, s.exertion);
    }
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  dispose(): void {
    this.unsub.forEach((u) => u());
    this.unsub = [];
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    void this.state;
  }
}
