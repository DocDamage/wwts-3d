/**
 * Character Moves — the procedural move library for the contestants.
 *
 * Every move is fn(anim, t, ctx, w):
 *   anim — CharacterAnimator (semantic helpers: arm, leg, spine, head, lift, yaw)
 *   t    — seconds since the move started
 *   ctx  — { beat (radians, 1 cycle per beat), bpm, playing, near ('Left'|'Right' arm
 *            closest to the opponent), far, oppAngle (radians, + = opponent on our left) }
 *   w    — blend weight (envelope fade in/out)
 *
 * `loop: true` moves run until stopped; others last `duration` seconds.
 * `upper: true` moves only touch the upper body, so they keep playing while walking.
 */

const sin = Math.sin;
const cos = Math.cos;
const PI = Math.PI;
const pos = (v) => Math.max(0, v);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// 0→1→0 pulse once per beat, sharp attack
const pulse = (phase) => Math.pow(pos(sin(phase)), 2);
// smooth 0..1 ramp
const ease = (u) => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);

// Elbow out to the side, forearm twisted in so the hand rests on the hip
const HAND_ON_HIP = { raise: 0.55, fwd: -0.1, twist: 0.9, elbow: 1.5 };
// Elbow up at shoulder height, forearm rotated up so the palm cups the ear
const HAND_TO_EAR = { raise: 1.15, fwd: 0.25, twist: -1.3, elbow: 2.35 };

/** Knee-bounce used by most dances: k in 0..1 */
function bounce(a, k, w, depth = 0.35) {
  const d = k * depth;
  a.leg('Left', { lift: d * 0.55, knee: d, foot: -d * 0.45 }, w);
  a.leg('Right', { lift: d * 0.55, knee: d, foot: -d * 0.45 }, w);
  a.lift(-d * 0.11, w);
}

const MOVES = [
  // ---------------- DANCE ----------------
  {
    id: 'bounce', label: 'Bounce', icon: '🕺', category: 'dance', loop: true,
    fn(a, t, c, w) {
      const k = (1 - cos(c.beat)) / 2;
      bounce(a, k, w);
      a.spine({ bend: 0.1 + k * 0.12 }, w);
      a.head({ nod: 0.25 * sin(c.beat) }, w);
      a.arm('Left', { fwd: 0.35 + 0.15 * sin(c.beat), elbow: 1.1, raise: 0.15 }, w);
      a.arm('Right', { fwd: 0.35 - 0.15 * sin(c.beat), elbow: 1.1, raise: 0.15 }, w);
    }
  },
  {
    id: 'two_step', label: 'Two-Step', icon: '👟', category: 'dance', loop: true,
    fn(a, t, c, w) {
      const sway = sin(c.beat / 2);
      const k = (1 - cos(c.beat)) / 2;
      a.leg('Left', { lift: 0.35 * pos(sway), knee: 0.65 * pos(sway), out: 0.15 * pos(sway) }, w);
      a.leg('Right', { lift: 0.35 * pos(-sway), knee: 0.65 * pos(-sway), out: 0.15 * pos(-sway) }, w);
      a.lift(-0.03 * k, w);
      a.spine({ lean: -0.14 * sway, twist: 0.15 * sway, bend: 0.08 }, w);
      a.head({ nod: 0.2 * sin(c.beat), tilt: 0.08 * sway }, w);
      a.arm('Left', { fwd: 0.3 - 0.35 * sway, elbow: 1.3, raise: 0.2 }, w);
      a.arm('Right', { fwd: 0.3 + 0.35 * sway, elbow: 1.3, raise: 0.2 }, w);
    }
  },
  {
    id: 'running_man', label: 'Running Man', icon: '🏃', category: 'dance', loop: true,
    fn(a, t, c, w) {
      const p = c.beat;
      a.leg('Left', { lift: 0.95 * pos(sin(p)), knee: 1.5 * pos(sin(p)), foot: -0.3 * pos(sin(p)) }, w);
      a.leg('Right', { lift: 0.95 * pos(-sin(p)), knee: 1.5 * pos(-sin(p)), foot: -0.3 * pos(-sin(p)) }, w);
      a.lift(-0.05 * Math.abs(cos(p)), w);
      a.spine({ bend: 0.18 }, w);
      const push = Math.abs(sin(p)) * 0.4;
      a.arm('Left', { fwd: 1.0 - push, elbow: 1.7, raise: 0.25 }, w);
      a.arm('Right', { fwd: 1.0 - push, elbow: 1.7, raise: 0.25 }, w);
      a.head({ nod: 0.15 * sin(p * 2) }, w);
    }
  },
  {
    id: 'toprock', label: 'Top Rock', icon: '🤸', category: 'dance', loop: true,
    fn(a, t, c, w) {
      const p = c.beat / 2;
      const l = pos(sin(p));
      const r = pos(-sin(p));
      a.leg('Left', { lift: 0.65 * l, knee: 0.75 * l, out: -0.3 * l }, w);
      a.leg('Right', { lift: 0.65 * r, knee: 0.75 * r, out: -0.3 * r }, w);
      a.spine({ twist: 0.35 * sin(p), bend: 0.15 }, w);
      a.arm('Left', { raise: 1.1 + 0.35 * sin(p), elbow: 0.6, fwd: 0.4 }, w);
      a.arm('Right', { raise: 1.1 - 0.35 * sin(p), elbow: 0.6, fwd: 0.4 }, w);
      a.head({ turn: -0.25 * sin(p), nod: 0.1 }, w);
      a.lift(-0.03 * Math.abs(sin(p)), w);
    }
  },
  {
    id: 'shimmy', label: 'Shimmy', icon: '💃', category: 'dance', loop: true,
    fn(a, t, c, w) {
      const s = sin(c.beat * 4);
      a.arm('Left', { raise: 0.55, elbow: 1.3, fwd: 0.3, shrug: 0.25 * s }, w);
      a.arm('Right', { raise: 0.55, elbow: 1.3, fwd: 0.3, shrug: -0.25 * s }, w);
      a.spine({ twist: 0.28 * s, bend: 0.28 }, w);
      bounce(a, 0.6 + 0.4 * (1 - cos(c.beat)) / 2, w, 0.3);
      a.head({ nod: -0.1, tilt: 0.06 * s }, w);
    }
  },
  {
    id: 'milly_rock', label: 'Milly Rock', icon: '🌀', category: 'dance', loop: true,
    fn(a, t, c, w) {
      const p = c.beat;
      a.arm('Left', { fwd: 0.85 + 0.45 * sin(p), raise: 0.55 + 0.35 * cos(p), elbow: 1.5 }, w);
      a.arm('Right', { fwd: 0.85 + 0.45 * sin(p + PI), raise: 0.55 + 0.35 * cos(p + PI), elbow: 1.5 }, w);
      const sway = sin(p / 2);
      a.spine({ lean: 0.16 * sway, twist: 0.2 * sway, bend: 0.1 }, w);
      a.leg('Left', { lift: 0.25 * pos(sway), knee: 0.45 * pos(sway) }, w);
      a.leg('Right', { lift: 0.25 * pos(-sway), knee: 0.45 * pos(-sway) }, w);
      a.head({ nod: 0.15 * sin(p), turn: 0.2 * sway }, w);
    }
  },
  {
    id: 'arm_wave', label: 'Arm Wave', icon: '🌊', category: 'dance', loop: true,
    fn(a, t, c, w) {
      const p = c.beat;
      a.arm('Left', { raise: 1.45 + 0.25 * sin(p), elbow: 0.6 * sin(p - 0.9), wrist: 0.7 * sin(p - 1.8) }, w);
      a.arm('Right', { raise: 1.45 + 0.25 * sin(p - 2.7), elbow: 0.6 * sin(p - 3.6), wrist: 0.7 * sin(p - 4.5) }, w);
      a.spine({ lean: -0.12 * sin(p - 1.4) }, w);
      a.head({ tilt: -0.15 * sin(p - 1.4) }, w);
      bounce(a, (1 - cos(p)) / 2, w, 0.2);
    }
  },
  {
    id: 'woah', label: 'The Woah', icon: '😮‍💨', category: 'dance', loop: true,
    fn(a, t, c, w) {
      // Two-beat cycle: wind up, then snap into the freeze
      const u = ((c.beat / (2 * PI)) % 2) / 2;
      const snap = ease((u - 0.45) / 0.08);
      const wind = 1 - snap;
      a.arm('Left', { raise: 1.7 * wind + 0.35 * snap, fwd: 0.5 * snap, inward: 0.7 * snap, elbow: 1.1 * wind + 0.4 * snap }, w);
      a.arm('Right', { raise: 1.3 * wind + 0.9 * snap, fwd: 0.6 * wind - 0.2 * snap, elbow: 1.2 * wind + 0.3 * snap }, w);
      a.spine({ lean: 0.25 * snap - 0.15 * wind, bend: -0.12 * snap, twist: 0.25 * snap }, w);
      a.head({ turn: -0.35 * snap, nod: -0.12 * snap }, w);
      bounce(a, 0.4 * snap + 0.2 * wind, w, 0.5);
    }
  },
  {
    id: 'robot', label: 'Robot', icon: '🤖', category: 'dance', loop: true,
    fn(a, t, c, w) {
      const q = Math.floor(c.beat / (PI / 2)) % 4; // 4 snapped poses per beat cycle
      const L = [1.57, 0.4, 1.57, 1.2][q];
      const R = [0.4, 1.57, 1.2, 1.57][q];
      a.arm('Left', { raise: 0.25, fwd: q % 2 ? 0.2 : 0.9, elbow: L }, w);
      a.arm('Right', { raise: 0.25, fwd: q % 2 ? 0.9 : 0.2, elbow: R }, w);
      a.head({ turn: [0.45, 0, -0.45, 0][q] }, w);
      a.spine({ twist: [0.15, 0, -0.15, 0][q] }, w);
    }
  },
  {
    id: 'headbang', label: 'Head Bang', icon: '🤘', category: 'dance', loop: true,
    fn(a, t, c, w) {
      const k = pos(sin(c.beat));
      a.head({ nod: -0.2 + 0.7 * k }, w);
      a.spine({ bend: 0.2 + 0.25 * k }, w);
      bounce(a, k, w, 0.3);
      a.arm('Right', { raise: 2.2, elbow: 0.5, fwd: 0.3 }, w);
      a.arm('Left', { fwd: 0.4, elbow: 1.2 }, w);
    }
  },

  // ---------------- HYPE ----------------
  {
    id: 'raise_roof', label: 'Raise Roof', icon: '🙌', category: 'hype', loop: true,
    fn(a, t, c, w) {
      const k = pulse(c.beat);
      a.arm('Left', { raise: 1.9 + 0.5 * k, elbow: 1.4 - 0.7 * k, twist: -0.6 }, w);
      a.arm('Right', { raise: 1.9 + 0.5 * k, elbow: 1.4 - 0.7 * k, twist: -0.6 }, w);
      bounce(a, k, w, 0.3);
      a.head({ nod: -0.15 + 0.15 * k }, w);
      a.spine({ bend: -0.06 }, w);
    }
  },
  {
    id: 'hands_up', label: 'Hands Up', icon: '🙋', category: 'hype', loop: true,
    fn(a, t, c, w) {
      const sway = sin(c.beat / 2);
      a.arm('Left', { raise: 2.7 + 0.12 * sway, elbow: 0.15 }, w);
      a.arm('Right', { raise: 2.7 - 0.12 * sway, elbow: 0.15 }, w);
      a.spine({ lean: 0.18 * sway, bend: -0.08 }, w);
      a.head({ nod: -0.2, tilt: 0.1 * sway }, w);
      bounce(a, (1 - cos(c.beat)) / 2, w, 0.25);
    }
  },
  {
    id: 'fist_pump', label: 'Fist Pump', icon: '✊', category: 'hype', loop: true, upper: true,
    fn(a, t, c, w) {
      const k = pulse(c.beat);
      a.arm(c.far, { raise: 1.4 + 1.2 * k, elbow: 1.8 * (1 - k) + 0.2 }, w);
      a.arm(c.near, HAND_ON_HIP, w);
      a.head({ nod: -0.15 * k }, w);
      a.spine({ bend: -0.05 * k }, w);
    }
  },
  {
    id: 'chest_beat', label: 'Chest Beat', icon: '🦍', category: 'hype', loop: true, upper: true,
    fn(a, t, c, w) {
      const l = pulse(c.beat * 2);
      const r = pulse(c.beat * 2 + PI);
      a.arm('Left', { fwd: 0.45 + 0.25 * l, twist: 0.95, elbow: 1.6 - 0.3 * l }, w);
      a.arm('Right', { fwd: 0.45 + 0.25 * r, twist: 0.95, elbow: 1.6 - 0.3 * r }, w);
      a.spine({ bend: -0.12 }, w);
      a.head({ nod: -0.22 }, w);
    }
  },
  {
    id: 'point_crowd', label: 'Point Crowd', icon: '👉', category: 'hype', duration: 3.2, upper: true,
    fn(a, t, c, w) {
      const sweep = sin(t * 1.6);
      a.arm('Right', { fwd: 1.45, raise: 0.25, elbow: 0.05 }, w);
      a.spine({ twist: 0.55 * sweep }, w);
      a.head({ turn: 0.35 * sweep, nod: -0.1 }, w);
      a.arm('Left', { raise: 0.3, elbow: 0.6 }, w);
    }
  },
  {
    id: 'bring_it', label: 'Bring It', icon: '🫴', category: 'hype', duration: 2.4, upper: true,
    fn(a, t, c, w) {
      const k = pos(sin(t * 3 * PI));
      a.arm('Left', { fwd: 0.95, raise: 0.55, elbow: 0.4 + 1.0 * k, twist: -0.8 }, w);
      a.arm('Right', { fwd: 0.95, raise: 0.55, elbow: 0.4 + 1.0 * k, twist: -0.8 }, w);
      a.spine({ bend: -0.12 }, w);
      a.head({ nod: -0.12 }, w);
    }
  },

  // ---------------- TAUNT ----------------
  {
    id: 'point_opponent', label: 'Point At', icon: '🫵', category: 'taunt', duration: 2.6,
    fn(a, t, c, w) {
      const turn = clamp(c.oppAngle, -1.4, 1.4);
      a.yaw(turn * 0.8, w);
      a.arm('Right', { fwd: 1.45 + 0.08 * sin(t * 12), raise: 0.2, elbow: 0.05 }, w);
      a.arm('Left', HAND_ON_HIP, w);
      a.head({ turn: turn * 0.2, nod: -0.15 }, w);
      a.spine({ bend: 0.08 }, w);
    }
  },
  {
    id: 'talk_too_much', label: 'Yap Yap', icon: '🗣️', category: 'taunt', duration: 2.6, upper: true,
    fn(a, t, c, w) {
      const yap = sin(t * 16);
      a.arm(c.near, { fwd: 1.0, raise: 0.4, elbow: 1.5, wrist: 0.35 * yap, twist: 0.5 }, w);
      a.head({ tilt: 0.2, nod: -0.1, turn: clamp(c.oppAngle, -0.8, 0.8) * 0.6 }, w);
      a.spine({ lean: 0.1 }, w);
    }
  },
  {
    id: 'dust_off', label: 'Dust Off', icon: '🧹', category: 'taunt', duration: 2.6, upper: true,
    fn(a, t, c, w) {
      const firstHalf = t < 1.3;
      const brushSide = firstHalf ? 'Right' : 'Left';
      const lookSide = firstHalf ? 1 : -1;
      const brush = sin(t * 18) * 0.25;
      a.arm(brushSide, { fwd: 0.75, twist: 1.3 + brush, elbow: 2.0, raise: 0.25 }, w);
      a.head({ turn: 0.45 * lookSide, tilt: -0.15 * lookSide, nod: 0.1 }, w);
      a.spine({ lean: -0.08 * lookSide }, w);
    }
  },
  {
    id: 'cant_hear', label: "Can't Hear", icon: '👂', category: 'taunt', duration: 2.4, upper: true,
    fn(a, t, c, w) {
      a.arm(c.far, HAND_TO_EAR, w);
      const s = c.far === 'Left' ? -1 : 1;
      a.head({ tilt: 0.3 * s, turn: -0.2 * s }, w);
      a.spine({ lean: 0.18 * s, bend: 0.1 }, w);
    }
  },
  {
    id: 'wave_off', label: 'Wave Off', icon: '🙅', category: 'taunt', duration: 1.8, upper: true,
    fn(a, t, c, w) {
      const flick = sin(t * 9);
      a.arm(c.near, { fwd: 0.65, elbow: 0.9, inward: 0.15 + 0.45 * flick, wrist: 0.3 * flick }, w);
      a.head({ turn: -clamp(c.oppAngle, -0.7, 0.7) * 0.8, nod: -0.15 }, w);
      a.spine({ twist: -0.15 * Math.sign(c.oppAngle || 1) }, w);
    }
  },
  {
    id: 'smoke', label: 'Want Smoke?', icon: '💨', category: 'taunt', duration: 2.4,
    fn(a, t, c, w) {
      const open = ease(t / 0.35);
      a.arm('Left', { raise: 1.05 * open, fwd: 0.5 * open, elbow: 0.7, twist: -0.7 * open, shrug: 0.3 * open }, w);
      a.arm('Right', { raise: 1.05 * open, fwd: 0.5 * open, elbow: 0.7, twist: -0.7 * open, shrug: 0.3 * open }, w);
      a.spine({ bend: -0.12 * open }, w);
      a.head({ nod: -0.25 * open, turn: clamp(c.oppAngle, -0.8, 0.8) * 0.5 }, w);
      a.leg('Left', { lift: 0.25 * open, knee: 0.1 }, w);
    }
  },
  {
    id: 'arms_crossed', label: 'Arms Crossed', icon: '😤', category: 'taunt', loop: true, upper: true,
    fn(a, t, c, w) {
      a.arm('Left', { fwd: 0.5, twist: 1.15, elbow: 1.7 }, w);
      a.arm('Right', { fwd: 0.42, twist: 1.05, elbow: 1.65 }, w);
      a.head({ nod: -0.18, turn: clamp(c.oppAngle, -0.6, 0.6) * 0.5 }, w);
      a.spine({ bend: -0.06 }, w);
    }
  },

  // ---------------- REACT ----------------
  {
    id: 'celebrate', label: 'Celebrate', icon: '🏆', category: 'react', duration: 3.0,
    fn(a, t, c, w) {
      const hop = pos(sin(t * 2 * PI * 1.1));
      const crouch = pos(-sin(t * 2 * PI * 1.1));
      a.lift(0.22 * hop, w);
      a.leg('Left', { lift: 0.4 * crouch + 0.25 * hop, knee: 0.8 * crouch + 0.5 * hop }, w);
      a.leg('Right', { lift: 0.4 * crouch + 0.25 * hop, knee: 0.8 * crouch + 0.5 * hop }, w);
      a.arm('Left', { raise: 2.6, elbow: 0.35 + 0.4 * crouch }, w);
      a.arm('Right', { raise: 2.6, elbow: 0.35 + 0.4 * crouch }, w);
      a.head({ nod: -0.3 }, w);
      a.spine({ bend: -0.1 }, w);
    }
  },
  {
    id: 'victory_spin', label: 'Spin', icon: '🌪️', category: 'react', duration: 2.2,
    fn(a, t, c, w) {
      const spin = ease(t / 1.1) * 2 * PI;
      a.yaw(spin, 1);
      const up = ease((t - 1.1) / 0.3);
      a.arm('Left', { raise: 1.4 + 1.2 * up, elbow: 0.2 }, w);
      a.arm('Right', { raise: 1.4 + 1.2 * up, elbow: 0.2 }, w);
      a.head({ nod: -0.25 * up }, w);
      a.lift(0.04 * sin(Math.min(t, 1.1) / 1.1 * PI), w);
    }
  },
  {
    id: 'defeated', label: 'Defeated', icon: '😞', category: 'react', duration: 4.5,
    fn(a, t, c, w) {
      const breathe = sin(t * 2) * 0.03;
      a.spine({ bend: 0.55 + breathe }, w);
      a.head({ nod: 0.55, turn: 0.1 * sin(t * 0.8) }, w);
      a.arm('Left', { inward: 0.15, fwd: 0.15, elbow: 0.2, shrug: -0.15 }, w);
      a.arm('Right', { inward: 0.15, fwd: 0.15, elbow: 0.2, shrug: -0.15 }, w);
      bounce(a, 0.5, w, 0.3);
    }
  },
  {
    id: 'shocked', label: 'Shocked', icon: '😱', category: 'react', duration: 1.6,
    fn(a, t, c, w) {
      const hit = ease(t / 0.12);
      a.spine({ bend: -0.28 * hit }, w);
      a.arm('Left', { raise: 0.9 * hit, fwd: 1.0 * hit, elbow: 1.6 * hit, twist: -0.4 }, w);
      a.arm('Right', { raise: 0.9 * hit, fwd: 1.0 * hit, elbow: 1.6 * hit, twist: -0.4 }, w);
      a.head({ nod: -0.22 * hit }, w);
      a.leg(c.near === 'Left' ? 'Right' : 'Left', { lift: -0.2 * hit, knee: 0.15 * hit }, w);
    }
  },
  {
    id: 'laugh', label: 'Laugh', icon: '😂', category: 'react', duration: 2.4,
    fn(a, t, c, w) {
      const shake = sin(t * 26) * 0.06;
      const fold = ease((t - 0.4) / 0.4);
      a.spine({ bend: -0.15 + 0.5 * fold + shake }, w);
      a.head({ nod: -0.3 + 0.3 * fold + shake }, w);
      a.arm('Left', { fwd: 0.3, twist: 0.9, elbow: 1.3 }, w);
      a.arm('Right', { fwd: 0.4 + 0.5 * fold, elbow: 0.6, raise: 0.3 }, w);
      bounce(a, 0.3 * fold, w);
    }
  },
  {
    id: 'clap', label: 'Clap', icon: '👏', category: 'react', loop: true, upper: true,
    fn(a, t, c, w) {
      const k = pulse(c.beat * 2);
      a.arm('Left', { fwd: 0.95, twist: 0.45 + 0.35 * k, elbow: 1.1 }, w);
      a.arm('Right', { fwd: 0.95, twist: 0.45 + 0.35 * k, elbow: 1.1 }, w);
      a.head({ nod: 0.15 * sin(c.beat) }, w);
    }
  },
  {
    id: 'nod_yes', label: 'Nod Yes', icon: '👍', category: 'react', duration: 1.6, upper: true,
    fn(a, t, c, w) { a.head({ nod: 0.32 * sin(t * 7) }, w); }
  },
  {
    id: 'shake_no', label: 'Nah', icon: '👎', category: 'react', duration: 1.6, upper: true,
    fn(a, t, c, w) {
      a.head({ turn: 0.5 * sin(t * 8), nod: 0.05 }, w);
      a.arm(c.near, { fwd: 0.7, elbow: 1.2, inward: 0.3 * sin(t * 8) }, w);
    }
  },
  {
    id: 'bow', label: 'Bow', icon: '🙇', category: 'react', duration: 2.6,
    fn(a, t, c, w) {
      const down = ease(t / 0.6) * (1 - ease((t - 1.7) / 0.6));
      a.spine({ bend: 0.95 * down }, w);
      a.head({ nod: 0.3 * down }, w);
      a.arm('Right', { fwd: 0.35, twist: 1.0, elbow: 1.5 }, w);
      a.arm('Left', { fwd: -0.3 * down, raise: 0.2 }, w);
    }
  },
  {
    id: 'flex', label: 'Flex', icon: '💪', category: 'react', duration: 2.6, upper: true,
    fn(a, t, c, w) {
      const k = 0.85 + 0.15 * sin(t * 6);
      a.arm('Left', { raise: 1.45, elbow: 2.0 * k, twist: -1.4 }, w);
      a.arm('Right', { raise: 1.45, elbow: 2.0 * k, twist: -1.4 }, w);
      a.spine({ bend: -0.08 }, w);
      a.head({ nod: -0.2, turn: 0.3 * sin(t * 1.5) }, w);
    }
  },

  // ---------------- DJ ----------------
  {
    id: 'headphones', label: 'Headphones', icon: '🎧', category: 'dj', loop: true, upper: true,
    fn(a, t, c, w) {
      a.arm(c.far, HAND_TO_EAR, w);
      const s = c.far === 'Left' ? -1 : 1;
      a.head({ tilt: 0.22 * s, nod: 0.12 + 0.25 * sin(c.beat) }, w);
      a.spine({ bend: 0.12 }, w);
    }
  },
  {
    id: 'air_scratch', label: 'Air Scratch', icon: '💿', category: 'dj', loop: true, upper: true,
    fn(a, t, c, w) {
      const sc = sin(t * 14);
      a.arm(c.near, { fwd: 0.95, elbow: 1.25, inward: 0.3 + 0.35 * sc, wrist: 0.3 * sc }, w);
      const k = pulse(c.beat);
      a.arm(c.far, { raise: 1.6 + 0.8 * k, elbow: 0.8 * (1 - k) + 0.2 }, w);
      a.head({ nod: 0.3 * sin(c.beat) }, w);
      a.spine({ bend: 0.15 }, w);
    }
  },

  // ---------------- IDLE FIDGETS (not shown in the dock) ----------------
  {
    id: 'look_around', label: 'Look Around', category: 'idle', hidden: true, duration: 3.5, upper: true,
    fn(a, t, c, w) { a.head({ turn: 0.6 * sin(t * 1.8), nod: -0.05 }, w); }
  },
  {
    id: 'shoulder_roll', label: 'Shoulder Roll', category: 'idle', hidden: true, duration: 2.2, upper: true,
    fn(a, t, c, w) {
      a.arm('Left', { shrug: 0.25 * sin(t * 5), fwd: 0.1 * cos(t * 5) }, w);
      a.arm('Right', { shrug: 0.25 * sin(t * 5 + 1), fwd: 0.1 * cos(t * 5 + 1) }, w);
      a.head({ tilt: 0.1 * sin(t * 2.5) }, w);
    }
  },
  {
    id: 'neck_stretch', label: 'Neck Stretch', category: 'idle', hidden: true, duration: 2.6, upper: true,
    fn(a, t, c, w) { a.head({ tilt: 0.35 * sin(t * 2.4), nod: 0.1 }, w); }
  },
  {
    id: 'weight_shift', label: 'Weight Shift', category: 'idle', hidden: true, duration: 3.0,
    fn(a, t, c, w) {
      const s = sin(t * 2.1);
      a.spine({ lean: 0.08 * s }, w);
      a.leg('Left', { knee: 0.15 * pos(s), lift: 0.08 * pos(s) }, w);
      a.leg('Right', { knee: 0.15 * pos(-s), lift: 0.08 * pos(-s) }, w);
    }
  }
];

const MOVES_BY_ID = Object.fromEntries(MOVES.map(m => [m.id, m]));

/** Add (or replace) a move at runtime — used for Mixamo motion-capture clips */
function registerMove(move) {
  const existing = MOVES.findIndex(m => m.id === move.id);
  if (existing >= 0) MOVES[existing] = move;
  else MOVES.push(move);
  MOVES_BY_ID[move.id] = move;
}

const MOVE_CATEGORIES = [
  { id: 'dance', label: 'Dance' },
  { id: 'hype', label: 'Hype' },
  { id: 'taunt', label: 'Taunt' },
  { id: 'react', label: 'React' },
  { id: 'dj', label: 'DJ' }
];

// How the opponent answers a taunt, and what the crowd's energy triggers
const TAUNT_REACTIONS = ['wave_off', 'laugh', 'shocked', 'shake_no', 'arms_crossed', 'bring_it', 'dust_off'];
const HYPE_REACTIONS = ['hands_up', 'raise_roof', 'fist_pump', 'clap', 'chest_beat'];
const IDLE_FIDGETS = ['look_around', 'shoulder_roll', 'neck_stretch', 'weight_shift'];

/* ---------------- Base layers (not user-triggered) ---------------- */

/** Walk/run cycle. phase advances with distance; speed01 0 = walk, 1 = run */
function walkCycle(a, phase, speed01, w) {
  const stride = 0.45 + 0.35 * speed01;
  const s = sin(phase);
  a.leg('Left', { lift: stride * s + 0.1, knee: (0.25 + 0.6 * speed01) * pos(-s) + 0.55 * pos(-cos(phase)) * speed01 + 0.15 }, w);
  a.leg('Right', { lift: -stride * s + 0.1, knee: (0.25 + 0.6 * speed01) * pos(s) + 0.55 * pos(cos(phase)) * speed01 + 0.15 }, w);
  const armSwing = 0.35 + 0.45 * speed01;
  a.arm('Left', { fwd: -armSwing * s + 0.05, elbow: 0.25 + 1.1 * speed01, raise: 0.08 }, w);
  a.arm('Right', { fwd: armSwing * s + 0.05, elbow: 0.25 + 1.1 * speed01, raise: 0.08 }, w);
  a.spine({ bend: 0.06 + 0.18 * speed01, twist: -0.12 * s }, w);
  a.head({ nod: -0.04 - 0.08 * speed01 }, w);
  a.lift(Math.abs(cos(phase)) * (0.025 + 0.04 * speed01), w);
}

/** At the decks: lean in, scratch with the near-crowd hand, ride the mixer with the other */
function djStation(a, t, c, w, isP1, playing) {
  const scratchSide = isP1 ? 'Left' : 'Right';
  const mixSide = isP1 ? 'Right' : 'Left';
  const sc = sin(t * (playing ? 11 : 3.5));
  a.spine({ bend: 0.32 + 0.05 * sin(c.beat) }, w);
  a.head({ nod: 0.2 + (playing ? 0.22 : 0.08) * sin(c.beat) }, w);
  a.arm(scratchSide, { fwd: 1.05, elbow: 0.95, inward: 0.25 + 0.18 * sc, wrist: 0.25 * sc }, w);
  a.arm(mixSide, { fwd: 1.0, elbow: 1.05, inward: 0.55, wrist: 0.25 * sin(t * 4) }, w);
  if (playing) bounce(a, (1 - cos(c.beat)) / 2, w, 0.18);
}

/** Music groove while standing: nod and sway */
function groove(a, c, w) {
  const k = (1 - cos(c.beat)) / 2;
  a.head({ nod: 0.18 * sin(c.beat) }, w);
  a.spine({ bend: 0.04 * k, lean: 0.04 * sin(c.beat / 2) }, w);
  bounce(a, k, w, 0.12);
}

export {
  MOVES, MOVES_BY_ID, MOVE_CATEGORIES, TAUNT_REACTIONS, HYPE_REACTIONS, IDLE_FIDGETS,
  walkCycle, djStation, groove, registerMove
};
