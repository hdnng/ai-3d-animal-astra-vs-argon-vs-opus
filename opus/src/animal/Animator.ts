/**
 * Animation state machine with smooth crossfades. Each state is a procedural
 * pose generator; active states (fading in or out) are evaluated every frame
 * and their PoseParams blended by eased weights.
 */
import { PoseParams } from './Pose';
import type { FootPlanner } from './FootPlanner';
import { smootherstep } from '../utils/math';

export type StateName =
  | 'locomotion'
  | 'sit'
  | 'lie'
  | 'sleep'
  | 'eat'
  | 'drink'
  | 'howl'
  | 'shake'
  | 'jump'
  | 'pounce'
  | 'swim'
  | 'sniff'
  | 'stalk'
  | 'alert'
  | 'playbow'
  | 'dead';

export interface AnimContext {
  readonly speed: number;
  readonly yawRate: number;
  readonly planner: FootPlanner;
  readonly time: number;
  readonly scale: number;
  readonly airborne: boolean;
  readonly vy: number;
  readonly timeSinceLanded: number;
  readonly exertion: number;
  readonly happy: number;
  readonly alert: number;
  readonly crouchT: number;
  readonly random: number;
}

export interface AnimStateDef {
  name: StateName;
  /** null = loops until another state is played */
  duration: number | null;
  fadeIn: number;
  /** Max-speed multiplier while this state is dominant (0 = stand still). */
  moveScale: number;
  /** Look-at allowed */
  evaluate(ctx: AnimContext, t: number, out: PoseParams): void;
}

interface Layer {
  def: AnimStateDef;
  time: number;
  /** linear fade param 0..1 */
  fade: number;
  target: number;
  rate: number;
}

export class Animator {
  private layers: Layer[] = [];
  private tmp = new PoseParams();
  readonly pose = new PoseParams();
  private defs = new Map<StateName, AnimStateDef>();
  onFinish: ((name: StateName) => void) | null = null;

  constructor(defs: AnimStateDef[], initial: StateName = 'locomotion') {
    for (const d of defs) this.defs.set(d.name, d);
    const d = this.defs.get(initial)!;
    this.layers.push({ def: d, time: 0, fade: 1, target: 1, rate: 1 });
  }

  get current(): StateName {
    return this.layers[this.layers.length - 1].def.name;
  }

  get currentTime(): number {
    return this.layers[this.layers.length - 1].time;
  }

  get currentDef(): AnimStateDef {
    return this.layers[this.layers.length - 1].def;
  }

  /** Movement multiplier blended across layers. */
  get moveScale(): number {
    let s = 0;
    let w = 0;
    for (const l of this.layers) {
      const lw = smootherstep(l.fade);
      s += l.def.moveScale * lw;
      w += lw;
    }
    return w > 0 ? s / w : 1;
  }

  has(name: StateName): boolean {
    return this.defs.has(name);
  }

  play(name: StateName, opts: { fade?: number; restart?: boolean } = {}): boolean {
    const def = this.defs.get(name);
    if (!def) return false;
    const top = this.layers[this.layers.length - 1];
    if (top.def.name === name && !opts.restart) return false;
    const fade = opts.fade ?? def.fadeIn;
    for (const l of this.layers) {
      l.target = 0;
      l.rate = 1 / Math.max(fade, 0.01);
    }
    // Reuse a fading-out layer of the same state to avoid pops.
    const idx = this.layers.findIndex((l) => l.def.name === name);
    if (idx >= 0 && !opts.restart) {
      const [l] = this.layers.splice(idx, 1);
      l.target = 1;
      l.rate = 1 / Math.max(fade, 0.01);
      this.layers.push(l);
    } else {
      this.layers.push({ def, time: 0, fade: 0, target: 1, rate: 1 / Math.max(fade, 0.01) });
    }
    return true;
  }

  update(dt: number, ctx: AnimContext): PoseParams {
    for (const l of this.layers) {
      l.time += dt;
      l.fade += Math.sign(l.target - l.fade) * l.rate * dt;
      l.fade = Math.min(1, Math.max(0, l.fade));
    }
    let w = 0;
    for (const l of this.layers) if (l.fade > 0 || l.target > 0) this.layers[w++] = l;
    this.layers.length = w;
    const top = this.layers[this.layers.length - 1];
    if (top.def.duration !== null && top.time >= top.def.duration) {
      const finished = top.def.name;
      if (this.onFinish) this.onFinish(finished);
      if (this.current === finished) this.play('locomotion');
    }
    // Blend.
    const out = this.pose.zero();
    let total = 0;
    for (const l of this.layers) {
      const w = smootherstep(l.fade);
      if (w <= 1e-4) continue;
      this.tmp.reset();
      l.def.evaluate(ctx, l.time, this.tmp);
      out.addWeighted(this.tmp, w);
      total += w;
    }
    if (total > 0) out.scale(1 / total);
    else out.reset();
    return out;
  }

  /** Debug: active layer names with weights. */
  describe(): string {
    return this.layers.map((l) => `${l.def.name}:${smootherstep(l.fade).toFixed(2)}`).join(' ');
  }
}
