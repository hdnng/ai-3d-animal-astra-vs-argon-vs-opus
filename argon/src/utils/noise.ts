/**
 * Deterministic PRNG and Multi-Octave 2D/3D Simplex-like Gradient Noise
 * Pure procedural implementation with zero external dependencies.
 */
export class SeededRandom {
  private state: number;

  constructor(seed = 1337) {
    this.state = seed >>> 0;
    if (this.state === 0) this.state = 1;
  }

  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return (this.state & 0x0fffffff) / 0x10000000;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }
}

export class NoiseGenerator {
  private perm: Uint8Array;
  private gradP: Float32Array;

  private static readonly GRAD3 = [
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
    1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
    0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
  ];

  constructor(seed = 424242) {
    const rng = new SeededRandom(seed);
    this.perm = new Uint8Array(512);
    this.gradP = new Float32Array(512 * 3);

    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }

    for (let i = 0; i < 512; i++) {
      const v = p[i & 255];
      this.perm[i] = v;
      const gIdx = (v % 12) * 3;
      this.gradP[i * 3] = NoiseGenerator.GRAD3[gIdx];
      this.gradP[i * 3 + 1] = NoiseGenerator.GRAD3[gIdx + 1];
      this.gradP[i * 3 + 2] = NoiseGenerator.GRAD3[gIdx + 2];
    }
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  /**
   * 2D Perlin noise in range [-1, 1]
   */
  noise2D(x: number, y: number): number {
    let X = Math.floor(x);
    let Y = Math.floor(y);
    x = x - X;
    y = y - Y;
    X = X & 255;
    Y = Y & 255;

    const gi00 = (X + this.perm[Y]) & 511;
    const gi01 = (X + this.perm[Y + 1]) & 511;
    const gi10 = (X + 1 + this.perm[Y]) & 511;
    const gi11 = (X + 1 + this.perm[Y + 1]) & 511;

    const n00 = this.gradP[gi00 * 3] * x + this.gradP[gi00 * 3 + 1] * y;
    const n10 = this.gradP[gi10 * 3] * (x - 1) + this.gradP[gi10 * 3 + 1] * y;
    const n01 = this.gradP[gi01 * 3] * x + this.gradP[gi01 * 3 + 1] * (y - 1);
    const n11 = this.gradP[gi11 * 3] * (x - 1) + this.gradP[gi11 * 3 + 1] * (y - 1);

    const u = this.fade(x);
    const v = this.fade(y);

    const nx0 = this.lerp(n00, n10, u);
    const nx1 = this.lerp(n01, n11, u);
    return this.lerp(nx0, nx1, v) * 1.4142;
  }

  /**
   * Fractional Brownian Motion (multi-octave 2D noise)
   */
  fbm2D(
    x: number,
    y: number,
    octaves = 5,
    lacunarity = 2.02,
    gain = 0.5
  ): number {
    let total = 0;
    let frequency = 1;
    let amplitude = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      total += this.noise2D(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }

    return total / maxValue;
  }

  /**
   * Ridged multifractal noise for mountain crests and rock formations
   */
  ridged2D(x: number, y: number, octaves = 4, lacunarity = 2.1, gain = 0.5): number {
    let sum = 0;
    let freq = 1.0;
    let amp = 0.5;
    let prev = 1.0;

    for (let i = 0; i < octaves; i++) {
      const n = 1.0 - Math.abs(this.noise2D(x * freq, y * freq));
      const sq = n * n;
      sum += sq * amp * prev;
      prev = sq;
      freq *= lacunarity;
      amp *= gain;
    }
    return sum;
  }
}
