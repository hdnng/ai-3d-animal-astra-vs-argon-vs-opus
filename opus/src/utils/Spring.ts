/**
 * Critically-damped / under-damped spring helpers used for secondary motion
 * (tail, ears, spine lag) and camera smoothing. Integration uses a stable
 * semi-implicit Euler step with sub-stepping for large dt.
 */
export class Spring {
  value: number;
  velocity = 0;
  target: number;

  /**
   * @param stiffness angular frequency^2 (k)
   * @param damping   damping coefficient (c). Critical damping = 2*sqrt(k).
   */
  constructor(
    initial = 0,
    public stiffness = 120,
    public damping = 14,
  ) {
    this.value = initial;
    this.target = initial;
  }

  /** Adds an impulse (instant velocity change). */
  impulse(v: number): void {
    this.velocity += v;
  }

  update(dt: number, externalAccel = 0): number {
    const steps = dt > 1 / 60 ? Math.ceil(dt / (1 / 60)) : 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = (this.target - this.value) * this.stiffness - this.velocity * this.damping + externalAccel;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }

  reset(v: number): void {
    this.value = v;
    this.target = v;
    this.velocity = 0;
  }
}

/** Two-axis spring (e.g. pitch/yaw of a tail segment). */
export class Spring2 {
  x: Spring;
  y: Spring;
  constructor(stiffness = 120, damping = 14) {
    this.x = new Spring(0, stiffness, damping);
    this.y = new Spring(0, stiffness, damping);
  }
  update(dt: number, ax = 0, ay = 0): void {
    this.x.update(dt, ax);
    this.y.update(dt, ay);
  }
  reset(): void {
    this.x.reset(0);
    this.y.reset(0);
  }
}
