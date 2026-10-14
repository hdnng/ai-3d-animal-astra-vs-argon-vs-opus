/**
 * Procedural animation states shared by all quadrupeds. Lengths are scaled by
 * ctx.scale (1 = wolf proportions). Angles are radians.
 *
 * Sign conventions (see PoseApplier):
 *  bodyPitch + = nose up, spinePitch + = back arched up, neckPitch + = raise,
 *  headPitch + = nose up, earPitch + = forward, tailLift + = raise,
 *  leg FK + = segment tip swings backward.
 */
import type { AnimContext, AnimStateDef } from './Animator';
import type { LegPose, PoseParams } from './Pose';
import { clamp, smoothstep } from '../utils/math';

const TAU = Math.PI * 2;
const FL = 0, FR = 1, HL = 2, HR = 3;

function legPoseTarget(l: LegPose, x: number, z: number, meta: number, y = 0.03): void {
  l.poseW = 1;
  l.tx = x;
  l.tz = z;
  l.ty = y;
  l.metaAngle = meta;
  l.toeCurl = 0;
  l.ik = 1;
}

function legFK(l: LegPose, root: number, upper: number, lower: number, meta: number, toe = 0): void {
  l.ik = 0;
  l.fkRoot = root;
  l.fkUpper = upper;
  l.fkLower = lower;
  l.fkMeta = meta;
  l.fkToe = toe;
}

/** Envelope that rises over `a` seconds and falls over the last `b` seconds of `d`. */
function env(t: number, d: number, a: number, b: number): number {
  return smoothstep(0, a, t) * (1 - smoothstep(d - b, d, t));
}

function breathingTail(ctx: AnimContext, out: PoseParams): void {
  out.tailWag = 0.05 + ctx.happy * 0.35;
  out.tailWagFreq = 1.2 + ctx.happy * 2.2;
}

export const locomotion: AnimStateDef = {
  name: 'locomotion',
  duration: null,
  fadeIn: 0.35,
  moveScale: 1,
  evaluate(ctx, _t, out) {
    const p = ctx.planner;
    const w = p.walkW * p.cyclic;
    const tr = p.trotW * p.cyclic;
    const g = p.gallopW * p.cyclic;
    const ph = p.phase;
    const s = ctx.scale;
    // Body bob per gait.
    const bobWalk = -Math.cos(TAU * 2 * (ph - 0.12)) * 0.007;
    const bobTrot = -Math.cos(TAU * 2 * (ph - 0.22)) * 0.014;
    const bobGallop = Math.sin(TAU * (ph - 0.3)) * 0.04;
    out.bodyY = (w * bobWalk + tr * (bobTrot - 0.012) + g * (bobGallop - 0.055)) * s;
    out.bodyPitch = g * 0.11 * Math.sin(TAU * (ph - 0.05)) + tr * 0.012 * Math.sin(TAU * 2 * ph);
    out.bodyRoll = w * 0.025 * Math.sin(TAU * ph) - clamp(ctx.yawRate * ctx.speed * 0.012, -0.18, 0.18);
    out.spinePitch = g * 0.2 * Math.sin(TAU * (ph + 0.15));
    out.spineYaw = w * 0.05 * Math.sin(TAU * ph) + clamp(ctx.yawRate * 0.13, -0.35, 0.35);
    // Head carriage: low at trot, extended at gallop; stabilised against body pitch.
    out.neckPitch = -0.06 * w - 0.2 * tr - 0.32 * g + w * 0.03 * Math.sin(TAU * 2 * ph);
    out.headPitch = -out.bodyPitch * 0.8 + 0.08 * tr + 0.22 * g;
    out.headYaw = clamp(ctx.yawRate * 0.09, -0.3, 0.3);
    out.neckYaw = clamp(ctx.yawRate * 0.1, -0.3, 0.3);
    // Ears and tail.
    out.earPitch = 0.12 - 0.1 * tr - 0.45 * g + ctx.alert * 0.25;
    out.earYaw = 0.05 + g * 0.1;
    out.tailLift = 0.08 + 0.15 * w + 0.32 * tr + 0.62 * g;
    out.tailCurl = 0.02 + g * 0.05;
    breathingTail(ctx, out);
    // Panting.
    out.jaw = clamp((ctx.exertion - 0.35) * 0.5, 0, 0.28) * (1 - g * 0.5) + g * 0.12;
    out.tongue = smoothstep(0.35, 0.7, ctx.exertion);
    out.breath = 1 + ctx.exertion * 2.2;
    out.lookW = 1 - g * 0.6;
  },
};

function sitBase(ctx: AnimContext, out: PoseParams): void {
  const s = ctx.scale;
  out.bodyPitch = 0.6;
  out.bodyY = -0.27 * s;
  out.bodyZ = -0.05 * s;
  out.spinePitch = -0.06;
  out.neckPitch = -0.12;
  out.headPitch = -0.42;
  out.tailLift = -0.75;
  out.tailCurl = 0.1;
  out.tailYaw = 0.25;
  out.groundAlign = 0.4;
  out.earPitch = 0.1;
  for (const i of [HL, HR]) {
    const side = i === HL ? 1 : -1;
    legPoseTarget(out.legs[i], 0.13 * side * s, -0.06 * s, 1.42, 0.03 * s);
  }
  // Front paws planted under the shoulders (straight forelegs).
  legPoseTarget(out.legs[FL], 0.095 * s, 0.31 * s, 0.3, 0.03 * s);
  legPoseTarget(out.legs[FR], -0.095 * s, 0.31 * s, 0.3, 0.03 * s);
}

export const sit: AnimStateDef = {
  name: 'sit',
  duration: null,
  fadeIn: 0.7,
  moveScale: 0,
  evaluate(ctx, _t, out) {
    sitBase(ctx, out);
    breathingTail(ctx, out);
    out.tailWag *= 0.5;
    out.breath = 0.9 + ctx.exertion;
  },
};

function lieBase(ctx: AnimContext, out: PoseParams): void {
  const s = ctx.scale;
  out.bodyY = -0.42 * s;
  out.bodyPitch = 0.04;
  out.spinePitch = 0.04;
  out.neckPitch = 0.2;
  out.headPitch = -0.25;
  out.tailLift = -0.35;
  out.tailYaw = 0.6;
  out.tailCurl = 0.12;
  out.groundAlign = 1;
  out.breath = 0.7;
  legPoseTarget(out.legs[FL], 0.08 * s, 0.68 * s, 1.5, 0.02 * s);
  legPoseTarget(out.legs[FR], -0.08 * s, 0.64 * s, 1.5, 0.02 * s);
  legPoseTarget(out.legs[HL], 0.24 * s, -0.12 * s, 1.52, 0.03 * s);
  legPoseTarget(out.legs[HR], -0.22 * s, -0.16 * s, 1.52, 0.03 * s);
  out.legs[FL].toeCurl = -0.2;
  out.legs[FR].toeCurl = -0.2;
}

export const lie: AnimStateDef = {
  name: 'lie',
  duration: null,
  fadeIn: 1.1,
  moveScale: 0,
  evaluate(ctx, t, out) {
    lieBase(ctx, out);
    out.headYaw = 0.15 * Math.sin(t * 0.3);
    out.earPitch = 0.05 + ctx.alert * 0.3;
  },
};

export const sleep: AnimStateDef = {
  name: 'sleep',
  duration: null,
  fadeIn: 1.6,
  moveScale: 0,
  evaluate(ctx, t, out) {
    lieBase(ctx, out);
    out.bodyRoll = 0.22;
    out.spineYaw = 0.55;
    out.neckYaw = 0.75;
    out.neckPitch = -0.25;
    out.headPitch = 0.05;
    out.headYaw = 0.45;
    out.headRoll = 0.25;
    out.tailYaw = 1.1;
    out.tailCurl = 0.28;
    out.tailLift = -0.2;
    out.eyeClose = 1;
    out.earPitch = -0.45;
    out.breath = 0.45;
    out.lookW = 0;
    out.tailWag = 0;
    // Occasional dream twitch of the paws.
    const tw = Math.max(0, Math.sin(t * 0.7) - 0.92) * 6;
    out.legs[FL].tz += tw * 0.04;
    out.jaw = 0;
  },
};

export const eat: AnimStateDef = {
  name: 'eat',
  duration: null,
  fadeIn: 0.55,
  moveScale: 0,
  evaluate(ctx, t, out) {
    const s = ctx.scale;
    out.bodyY = -0.1 * s;
    out.bodyPitch = -0.2;
    out.spinePitch = 0.1;
    out.neckPitch = -1.3;
    out.headPitch = -0.45 + 0.12 * Math.sin(t * 2.1);
    out.headRoll = 0.18 * Math.sin(t * 1.7);
    out.headYaw = 0.12 * Math.sin(t * 1.3);
    out.jaw = 0.18 + 0.16 * Math.max(0, Math.sin(t * 8.5));
    out.earPitch = 0.05;
    out.tailLift = 0.05;
    out.tailWag = 0.12;
    out.tailWagFreq = 1.5;
    out.lookW = 0;
    legPoseTarget(out.legs[FL], 0.13 * s, 0.42 * s, 0.35, 0.03 * s);
    legPoseTarget(out.legs[FR], -0.13 * s, 0.4 * s, 0.35, 0.03 * s);
    out.legs[FL].poseW = 0.6;
    out.legs[FR].poseW = 0.6;
  },
};

export const drink: AnimStateDef = {
  name: 'drink',
  duration: null,
  fadeIn: 0.6,
  moveScale: 0,
  evaluate(ctx, t, out) {
    const s = ctx.scale;
    out.bodyY = -0.13 * s;
    out.bodyPitch = -0.22;
    out.neckPitch = -1.32;
    out.headPitch = -0.35;
    out.jaw = 0.1 + 0.1 * Math.max(0, Math.sin(t * 13));
    out.tongue = 1;
    out.earPitch = -0.05;
    out.tailLift = 0.0;
    out.lookW = 0;
    legPoseTarget(out.legs[FL], 0.15 * s, 0.46 * s, 0.4, 0.03 * s);
    legPoseTarget(out.legs[FR], -0.15 * s, 0.44 * s, 0.4, 0.03 * s);
    out.legs[FL].poseW = 0.7;
    out.legs[FR].poseW = 0.7;
  },
};

export const HOWL_DURATION = 5.2;
export const howl: AnimStateDef = {
  name: 'howl',
  duration: HOWL_DURATION,
  fadeIn: 0.6,
  moveScale: 0,
  evaluate(ctx, t, out) {
    sitBase(ctx, out);
    const e = env(t, HOWL_DURATION, 0.9, 0.8);
    out.neckPitch = -0.12 + 0.55 * e;
    out.headPitch = -0.42 + 0.95 * e;
    const voice = env(t, HOWL_DURATION - 0.4, 1.0, 0.6);
    out.jaw = 0.62 * voice * (0.85 + 0.15 * Math.sin(t * 3.1));
    out.earPitch = 0.1 - 0.4 * e;
    out.eyeClose = 0.55 * voice;
    out.breath = 0.3;
    out.lookW = 0;
    out.tailWag = 0;
    out.spinePitch = -0.06 - 0.06 * e;
    // Deep inhale before the howl.
    out.bodyY += 0.012 * ctx.scale * smoothstep(0.2, 0.8, t) * (1 - smoothstep(0.8, 1.3, t));
  },
};

export const SHAKE_DURATION = 1.7;
export const shake: AnimStateDef = {
  name: 'shake',
  duration: SHAKE_DURATION,
  fadeIn: 0.2,
  moveScale: 0,
  evaluate(ctx, t, out) {
    const a = env(t, SHAKE_DURATION, 0.25, 0.45);
    const w = TAU * 4.3;
    out.spineRoll = 0.55 * a * Math.sin(w * t);
    out.bodyRoll = 0.12 * a * Math.sin(w * t - 0.5);
    out.headRoll = 0.85 * a * Math.sin(w * t + 0.9);
    out.neckYaw = 0.25 * a * Math.sin(w * t + 0.6);
    out.headYaw = 0.2 * a * Math.sin(w * t + 1.2);
    out.neckPitch = 0.05 * a;
    out.earPitch = -0.2 + 0.6 * a * Math.sin(w * t + 1.5);
    out.earYaw = 0.4 * a;
    out.tailWag = 0.8 * a;
    out.tailWagFreq = 4.3;
    out.tailLift = 0.25;
    out.eyeClose = 0.6 * a;
    out.bodyY = -0.03 * a * ctx.scale;
    out.lookW = 0;
  },
};

export const jump: AnimStateDef = {
  name: 'jump',
  duration: null,
  fadeIn: 0.12,
  moveScale: 1,
  evaluate(ctx, t, out) {
    const s = ctx.scale;
    if (!ctx.airborne && ctx.timeSinceLanded > 5) {
      // Anticipation crouch before take-off.
      const c = smoothstep(0, ctx.crouchT, t);
      out.bodyY = -0.13 * s * c;
      out.bodyPitch = -0.06 * c;
      out.neckPitch = -0.1 * c;
      out.tailLift = 0.3;
      out.earPitch = -0.2;
      return;
    }
    if (ctx.airborne) {
      const up = clamp(ctx.vy / 4, -1, 1);
      out.bodyPitch = 0.22 * up;
      out.spinePitch = -0.15 * up + 0.1;
      out.neckPitch = 0.1 - 0.15 * up;
      out.headPitch = -out.bodyPitch * 0.7;
      out.tailLift = 0.6;
      out.earPitch = -0.45;
      out.lookW = 0.2;
      out.gaitW = 0;
      // Front: tucked on the way up, reaching on the way down.
      const reach = smoothstep(0.3, -0.6, up);
      legFK(out.legs[FL], -0.25, -0.6 - 0.5 * reach, 1.4 - 1.1 * reach, 1.2 - 0.8 * reach);
      legFK(out.legs[FR], -0.2, -0.55 - 0.5 * reach, 1.3 - 1.0 * reach, 1.1 - 0.8 * reach);
      // Hind: extended back after push-off, tucking forward later.
      const tuck = smoothstep(0.6, -0.3, up);
      legFK(out.legs[HL], 0, 0.75 - 1.3 * tuck, -0.5 + 0.9 * tuck, 0.6 - 0.4 * tuck);
      legFK(out.legs[HR], 0, 0.8 - 1.3 * tuck, -0.55 + 0.9 * tuck, 0.6 - 0.4 * tuck);
      return;
    }
    // Landing absorption.
    const l = 1 - smoothstep(0, 0.3, ctx.timeSinceLanded);
    out.bodyY = -0.1 * s * l;
    out.bodyPitch = -0.08 * l;
    out.neckPitch = -0.08 * l;
    out.tailLift = 0.3;
  },
};

export const pounce: AnimStateDef = {
  name: 'pounce',
  duration: null,
  fadeIn: 0.25,
  moveScale: 1,
  evaluate(ctx, t, out) {
    const s = ctx.scale;
    if (!ctx.airborne && ctx.timeSinceLanded > 5) {
      // Stalking crouch with a hip wiggle before springing.
      const c = smoothstep(0, ctx.crouchT * 0.6, t);
      out.bodyY = -0.16 * s * c;
      out.bodyPitch = -0.1 * c;
      out.bodyRoll = 0.06 * c * Math.sin(t * 16);
      out.spineYaw = 0.08 * c * Math.sin(t * 16);
      out.neckPitch = -0.35 * c;
      out.headPitch = 0.2 * c;
      out.earPitch = 0.45;
      out.tailLift = -0.05;
      out.tailWag = 0.25 * c;
      out.tailWagFreq = 3;
      out.lookW = 1;
      return;
    }
    if (ctx.airborne) {
      const up = clamp(ctx.vy / 5, -1, 1);
      out.bodyPitch = 0.3 * up - 0.15 * (1 - up);
      out.spinePitch = 0.15 - 0.2 * up;
      out.neckPitch = -0.2 - 0.3 * (1 - up);
      out.headPitch = -0.3 * (1 - up);
      out.earPitch = 0.3;
      out.tailLift = 0.5;
      out.gaitW = 0;
      out.lookW = 1;
      const down = smoothstep(0.2, -0.5, up);
      legFK(out.legs[FL], -0.3, -0.5 - 0.7 * down, 1.2 - 1.15 * down, 1.0 - 0.9 * down);
      legFK(out.legs[FR], -0.3, -0.5 - 0.7 * down, 1.2 - 1.15 * down, 1.0 - 0.9 * down);
      legFK(out.legs[HL], 0, 0.9 - 0.9 * down, -0.6 + 0.7 * down, 0.7);
      legFK(out.legs[HR], 0, 0.9 - 0.9 * down, -0.6 + 0.7 * down, 0.7);
      return;
    }
    const l = 1 - smoothstep(0, 0.45, ctx.timeSinceLanded);
    out.bodyY = -0.15 * s * l;
    out.bodyPitch = -0.18 * l;
    out.neckPitch = -0.7 * l;
    out.headPitch = -0.2 * l;
    out.earPitch = 0.3;
    out.tailLift = 0.35;
    out.jaw = 0.3 * l;
  },
};

export const swim: AnimStateDef = {
  name: 'swim',
  duration: null,
  fadeIn: 0.45,
  moveScale: 0.42,
  evaluate(_ctx, t, out) {
    const w = t * TAU * 1.5;
    out.gaitW = 0;
    out.groundAlign = 0;
    out.bodyPitch = 0.08;
    out.neckPitch = 0.42;
    out.headPitch = -0.38;
    out.earPitch = 0.2;
    out.tailLift = 0.42;
    out.tailWag = 0.18;
    out.tailWagFreq = 1.5;
    out.lookW = 0.6;
    out.breath = 1.6;
    // Dog paddle: diagonal pairs.
    legFK(out.legs[FL], -0.15, -0.55 + 0.75 * Math.sin(w), 0.9 + 0.6 * Math.cos(w), 0.4);
    legFK(out.legs[FR], -0.15, -0.55 + 0.75 * Math.sin(w + Math.PI), 0.9 + 0.6 * Math.cos(w + Math.PI), 0.4);
    legFK(out.legs[HL], 0, 0.3 + 0.55 * Math.sin(w + Math.PI), -0.4 + 0.4 * Math.cos(w + Math.PI), 0.5);
    legFK(out.legs[HR], 0, 0.3 + 0.55 * Math.sin(w), -0.4 + 0.4 * Math.cos(w), 0.5);
  },
};

export const sniff: AnimStateDef = {
  name: 'sniff',
  duration: null,
  fadeIn: 0.45,
  moveScale: 0.35,
  evaluate(ctx, t, out) {
    locomotion.evaluate(ctx, t, out);
    out.neckPitch = -0.78;
    out.headPitch = -0.15;
    out.headYaw = 0.35 * Math.sin(t * 1.9);
    out.neckYaw = 0.2 * Math.sin(t * 1.9 - 0.4);
    out.jaw = 0.02 + 0.02 * Math.sin(t * 31);
    out.earPitch = 0.3;
    out.tailLift = 0.25;
    out.lookW = 0;
  },
};

export const stalk: AnimStateDef = {
  name: 'stalk',
  duration: null,
  fadeIn: 0.5,
  moveScale: 0.32,
  evaluate(ctx, t, out) {
    locomotion.evaluate(ctx, t, out);
    out.bodyY += -0.12 * ctx.scale;
    out.neckPitch = -0.42;
    out.headPitch = 0.3;
    out.earPitch = 0.45;
    out.earYaw = -0.1;
    out.tailLift = -0.12;
    out.tailWag = 0.02;
    out.jaw = 0;
    out.lookW = 1;
  },
};

export const alert: AnimStateDef = {
  name: 'alert',
  duration: null,
  fadeIn: 0.3,
  moveScale: 0.2,
  evaluate(ctx, t, out) {
    locomotion.evaluate(ctx, t, out);
    out.neckPitch = 0.3;
    out.headPitch = 0.05;
    out.earPitch = 0.5;
    out.earYaw = -0.15 + 0.1 * Math.sin(t * 2.3);
    out.tailLift = 0.7;
    out.bodyY += 0.01 * ctx.scale;
    out.lookW = 1;
  },
};

export const PLAYBOW_DURATION = 1.8;
export const playbow: AnimStateDef = {
  name: 'playbow',
  duration: PLAYBOW_DURATION,
  fadeIn: 0.3,
  moveScale: 0,
  evaluate(ctx, t, out) {
    const s = ctx.scale;
    const e = env(t, PLAYBOW_DURATION, 0.35, 0.5);
    out.bodyPitch = -0.38 * e;
    out.bodyY = -0.1 * s * e;
    out.neckPitch = 0.25 * e;
    out.headPitch = 0.3 * e;
    out.tailLift = 0.9 * e;
    out.tailWag = 0.6;
    out.tailWagFreq = 3.5;
    out.earPitch = 0.3;
    out.jaw = 0.2 * e;
    out.tongue = e;
    legPoseTarget(out.legs[FL], 0.11 * s, 0.62 * s, 1.45, 0.02 * s);
    legPoseTarget(out.legs[FR], -0.11 * s, 0.62 * s, 1.45, 0.02 * s);
    out.legs[FL].poseW = e;
    out.legs[FR].poseW = e;
  },
};

export const dead: AnimStateDef = {
  name: 'dead',
  duration: null,
  fadeIn: 0.7,
  moveScale: 0,
  evaluate(ctx, _t, out) {
    const s = ctx.scale;
    out.bodyY = -0.62 * s;
    out.bodyRoll = 1.45;
    out.groundAlign = 1;
    out.gaitW = 0;
    out.neckPitch = -0.15;
    out.headPitch = -0.1;
    out.headRoll = 0.2;
    out.eyeClose = 1;
    out.tailLift = -0.2;
    out.earPitch = -0.3;
    out.breath = 0;
    out.lookW = 0;
    legFK(out.legs[FL], -0.3, -0.3, 0.3, 0.2);
    legFK(out.legs[FR], -0.4, -0.2, 0.2, 0.2);
    legFK(out.legs[HL], 0, 0.3, -0.2, 0.3);
    legFK(out.legs[HR], 0, 0.4, -0.3, 0.3);
  },
};

export const ALL_STATES: AnimStateDef[] = [locomotion, sit, lie, sleep, eat, drink, howl, shake, jump, pounce, swim, sniff, stalk, alert, playbow, dead];
