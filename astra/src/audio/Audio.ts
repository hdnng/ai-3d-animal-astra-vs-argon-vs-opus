/** All sound is synthesized. AudioContext is created only after a user gesture. */
export class AudioEngine {
  context: AudioContext | null = null;
  master: GainNode | null = null;
  muted = true;
  private noise: AudioBuffer | null = null;
  private ambient: AudioBufferSourceNode[] = [];
  private lastStep = 0;
  async toggle() {
    if (!this.context) this.init();
    this.muted = !this.muted;
    await this.context!.resume();
    this.master!.gain.setTargetAtTime(
      this.muted ? 0 : 0.38,
      this.context!.currentTime,
      0.15,
    );
    return this.muted;
  }
  private init() {
    const a = (this.context = new AudioContext());
    this.master = a.createGain();
    this.master.gain.value = 0;
    this.master.connect(a.destination);
    this.noise = a.createBuffer(1, a.sampleRate * 4, a.sampleRate);
    const data = this.noise.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < data.length; i++) {
      brown = (brown + (Math.random() * 2 - 1) * 0.025) / 1.025;
      data[i] = brown * 6;
    }
    for (const [frequency, gain] of [
      [420, 0.2],
      [1600, 0.055],
    ]) {
      const s = a.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      const filter = a.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = frequency;
      const vol = a.createGain();
      vol.gain.value = gain;
      s.connect(filter).connect(vol).connect(this.master);
      s.start();
      this.ambient.push(s);
    }
  }
  step(water = false) {
    if (this.muted || !this.context || !this.noise) return;
    const a = this.context,
      t = a.currentTime;
    if (t - this.lastStep < 0.1) return;
    this.lastStep = t;
    const s = a.createBufferSource();
    s.buffer = this.noise;
    const f = a.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = water ? 2200 : 550;
    const g = a.createGain();
    g.gain.setValueAtTime(0.27, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    s.connect(f).connect(g).connect(this.master!);
    s.start(t);
    s.stop(t + 0.14);
    s.onended = () => {
      s.disconnect();
      f.disconnect();
      g.disconnect();
    };
  }
  call() {
    if (this.muted || !this.context) return;
    const a = this.context,
      t = a.currentTime;
    const o = a.createOscillator(),
      g = a.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(430, t);
    o.frequency.exponentialRampToValueAtTime(760, t + 0.3);
    o.frequency.exponentialRampToValueAtTime(390, t + 1.9);
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2);
    o.connect(g).connect(this.master!);
    o.start();
    o.stop(t + 2.1);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }
  chirp() {
    if (this.muted || !this.context) return;
    const a = this.context,
      t = a.currentTime;
    const o = a.createOscillator(),
      g = a.createGain();
    o.frequency.setValueAtTime(1800, t);
    o.frequency.exponentialRampToValueAtTime(2900, t + 0.08);
    g.gain.setValueAtTime(0.023, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g).connect(this.master!);
    o.start();
    o.stop(t + 0.17);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }
  dispose() {
    this.ambient.forEach((s) => s.stop());
    void this.context?.close();
    this.context = null;
  }
}
