/**
 * Parametric pose description. Every animation state writes a full PoseParams;
 * the animator blends them with crossfade weights (linear blend of the
 * parameters), and the pose applier turns the result into bone rotations + IK.
 *
 * All values live in one Float64Array exposed through named accessors, so the
 * per-frame blending is a tight loop over a typed array (no boxed numbers,
 * no garbage) while state code still reads like `out.bodyPitch = 0.3`.
 */

const SCALAR_KEYS = [
  'bodyY',
  'bodyPitch',
  'bodyRoll',
  'bodyZ',
  'spinePitch',
  'spineYaw',
  'spineRoll',
  'neckPitch',
  'neckYaw',
  'headPitch',
  'headYaw',
  'headRoll',
  'jaw',
  'earPitch',
  'earYaw',
  'tailLift',
  'tailCurl',
  'tailYaw',
  'tailWag',
  'tailWagFreq',
  'breath',
  'eyeClose',
  'lookW',
  'gaitW',
  'groundAlign',
  'tongue',
] as const;

const LEG_KEYS = ['poseW', 'tx', 'tz', 'ty', 'metaAngle', 'toeCurl', 'ik', 'fkRoot', 'fkUpper', 'fkLower', 'fkMeta', 'fkToe'] as const;

export type PoseScalarKey = (typeof SCALAR_KEYS)[number];
type LegKey = (typeof LEG_KEYS)[number];

const NS = SCALAR_KEYS.length;
const NL = LEG_KEYS.length;
const TOTAL = NS + NL * 4;

/** View of one leg's parameters inside the pose buffer. */
export class LegPose {
  declare poseW: number;
  declare tx: number;
  declare tz: number;
  declare ty: number;
  declare metaAngle: number;
  declare toeCurl: number;
  declare ik: number;
  declare fkRoot: number;
  declare fkUpper: number;
  declare fkLower: number;
  declare fkMeta: number;
  declare fkToe: number;
  constructor(
    readonly v: Float64Array,
    readonly o: number,
  ) {}
}
LEG_KEYS.forEach((k: LegKey, i) => {
  Object.defineProperty(LegPose.prototype, k, {
    get(this: LegPose) {
      return this.v[this.o + i];
    },
    set(this: LegPose, x: number) {
      this.v[this.o + i] = x;
    },
  });
});

export class PoseParams {
  readonly v = new Float64Array(TOTAL);
  readonly legs: LegPose[] = [0, 1, 2, 3].map((i) => new LegPose(this.v, NS + i * NL));
  declare bodyY: number;
  declare bodyPitch: number;
  declare bodyRoll: number;
  declare bodyZ: number;
  declare spinePitch: number;
  declare spineYaw: number;
  declare spineRoll: number;
  declare neckPitch: number;
  declare neckYaw: number;
  declare headPitch: number;
  declare headYaw: number;
  declare headRoll: number;
  declare jaw: number;
  declare earPitch: number;
  declare earYaw: number;
  declare tailLift: number;
  declare tailCurl: number;
  declare tailYaw: number;
  declare tailWag: number;
  declare tailWagFreq: number;
  declare breath: number;
  declare eyeClose: number;
  declare lookW: number;
  declare gaitW: number;
  declare groundAlign: number;
  declare tongue: number;

  constructor() {
    this.reset();
  }

  /** Resets to the neutral standing pose. */
  reset(): this {
    this.v.fill(0);
    this.breath = 1;
    this.lookW = 1;
    this.gaitW = 1;
    this.groundAlign = 1;
    for (let i = 0; i < 4; i++) this.v[NS + i * NL + 6] = 1; // ik
    return this;
  }

  zero(): this {
    this.v.fill(0);
    return this;
  }

  /** this += other * w */
  addWeighted(o: PoseParams, w: number): void {
    const a = this.v;
    const b = o.v;
    for (let i = 0; i < TOTAL; i++) a[i] += b[i] * w;
  }

  scale(s: number): void {
    const a = this.v;
    for (let i = 0; i < TOTAL; i++) a[i] *= s;
  }

  copy(o: PoseParams): this {
    this.v.set(o.v);
    return this;
  }
}
SCALAR_KEYS.forEach((k: PoseScalarKey, i) => {
  Object.defineProperty(PoseParams.prototype, k, {
    get(this: PoseParams) {
      return this.v[i];
    },
    set(this: PoseParams, x: number) {
      this.v[i] = x;
    },
  });
});

/** Standalone leg pose (not backed by a PoseParams). */
export function makeLegPose(): LegPose {
  const v = new Float64Array(NL);
  const l = new LegPose(v, 0);
  l.ik = 1;
  return l;
}
