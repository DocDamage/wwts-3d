/**
 * Fight Club data: arena size, tuning constants, the move table, normals, specials,
 * throws, CPU difficulty and the command list, plus small geometry helpers.
 */
import * as THREE from 'three';
import { getKeys } from './fightControls.js';
import { STYLE_MOVES } from './fightStyles.js';

const ARENA = { cx: 0, cz: 2.45, rx: 3.3, rz: 1.45 };
const MAX_HP = 100;
const BODY_R = 0.15;        // torso radius around the spine
const LIMB_R = 0.06;        // fist / foot
const GRAV = 13;
const WALK_FWD = 1.3;
const WALK_BACK = 1.0;
const SIDEWALK = 1.25;
const MIN_GAP = 0.55;
const DMG = { 1: 5, 2: 8, 3: 12 };

/* ------------------------------------------------------------------ */
/* Moves. id = clip (without mx_); power 1-3; level overrides the measured one.
 * homing: tracks sidesteps; launch / knockdown / crumple / stun on hit; ch* only on
 * counter hit; chains: follow-ups (press during the move); lunge: max step-in (m). */
const MOVES = {
  // jabs, strings
  jab: { id: 'fight_jab', name: 'Jab', power: 1, chains: { lp: 'jab2', hp: 'cross' } },
  jab2: { id: 'fight_jab2', name: 'Snap Jab', power: 1, chains: { hp: 'cross2' } },
  cross: { id: 'fight_cross', name: 'Cross', power: 2, chains: { hk: 'roundhouse', hp: 'hook_lead2' } },
  cross2: { id: 'fight_cross2', name: 'Straight', power: 2, chains: { lp: 'hook_lead2', hk: 'roundhouse' } },
  hook_lead2: { id: 'fight_hook_lead2', name: 'Lead Hook', power: 2, homing: true, chains: { hp: 'right_hook' } },
  right_hook: { id: 'fight_right_hook', name: 'Haymaker', power: 3, homing: true, chCrumple: true },
  low_kick: { id: 'fight_kick_low', name: 'Low Kick', power: 1, level: 'low' },
  roundhouse: { id: 'fight_kick_roundhouse', name: 'Roundhouse', power: 2, homing: true, chKnockdown: true },
  // forward
  jab_cross: { id: 'fight_jab_cross', name: 'One-Two', power: 2, chains: { hk: 'high_kick' } },
  hook_head: { id: 'fight_hook_head_mid', name: 'Hook', power: 2, homing: true, chains: { hp: 'uppercut' } },
  side_kick: { id: 'fight_kick_side', name: 'Side Kick', power: 2, level: 'mid', push: 0.55 },
  high_kick: { id: 'fight_kick_high', name: 'High Kick', power: 3, chKnockdown: true },
  // back
  hook_short: { id: 'fight_hook_rear2', name: 'Rear Hook', power: 2, homing: true },
  uppercut_back: { id: 'fight_uppercut_back', name: 'Rear Uppercut', power: 3, level: 'mid', chLaunch: true },
  knee: { id: 'fight_knee', name: 'Knee', power: 2, level: 'mid', chLaunch: true },
  spin_kick: { id: 'fight_kick_spin_back', name: 'Spinning Back Kick', power: 3, homing: true, knockdown: true },
  // down (crouching)
  body_hook: { id: 'fight_hook_body_short', name: 'Body Hook', power: 1, level: 'mid' },
  rising_elbow: { id: 'fight_elbow_rising', name: 'Rising Elbow', power: 3, level: 'mid', launch: true },
  sweep_front: { id: 'fight_sweep_front', name: 'Front Sweep', power: 2, level: 'low', knockdown: true },
  sweep_360: { id: 'fight_sweep_360', name: '360 Sweep', power: 2, level: 'low', homing: true, knockdown: true },
  // down-forward
  body_blow: { id: 'fight_hook_body_mid', name: 'Liver Blow', power: 2, level: 'mid', chCrumple: true },
  launcher: { id: 'fight_uppercut', name: 'Launcher', power: 3, level: 'mid', launch: true },
  mid_kick: { id: 'fight_kick_mid', name: 'Mid Kick', power: 2, level: 'mid' },
  rib_kick: { id: 'fight_roundhouse_side', name: 'Rib Kick', power: 2, level: 'mid', homing: true },
  // down-back
  cross_elbow: { id: 'fight_elbow_cross', name: 'Cross Elbow', power: 2, level: 'mid' },
  elbow_uppercut: { id: 'fight_elbow_uppercut', name: 'Elbow Uppercut', power: 3, level: 'mid', launch: true },
  ground_spin: { id: 'fight_ground_spin_kick', name: 'Ground Spin Kick', power: 2, level: 'low', homing: true, knockdown: true, ground: true },
  back_sweep: { id: 'fight_sweep_back', name: 'Back Sweep', power: 2, level: 'low', knockdown: true, ground: true },
  // two buttons
  quad_punch: { id: 'fight_quad_punch', name: 'Quad Punch', power: 2 },
  snap_kicks: { id: 'fight_double_snap_kick', name: 'Double Snap Kick', power: 2 },
  leap_smash: { id: 'air_mutant_slam', name: 'Leaping Smash', power: 3, level: 'mid', knockdown: true, lunge: 0.9, startup: 0.5 },
  // sidestep attacks (track the way you stepped)
  ss_hook: { id: 'fight_hook_punch', name: 'Stepping Hook', power: 2, homing: true },
  ss_armada: { id: 'fight_armada', name: 'Armada', power: 2, homing: true, chKnockdown: true },
  ss_meia_lua: { id: 'fight_meia_lua', name: 'Meia Lua', power: 2, homing: true, knockdown: true },
  // dash attacks
  dash_elbow: { id: 'fight_elbow_step', name: 'Stepping Elbow', power: 3, level: 'mid', knockdown: true, lunge: 0.7 },
  dash_overhead: { id: 'fight_elbow_head', name: 'Overhead Elbow', power: 3, level: 'mid', crumple: true, lunge: 0.6 },
  dash_sidekick: { id: 'fight_flying_sidekick', name: 'Flying Side Kick', power: 3, level: 'mid', knockdown: true, lunge: 0.9 },
  dash_knee: { id: 'fight_flying_knee', name: 'Flying Knee', power: 3, level: 'mid', launch: true, lunge: 0.9, travel: 1.4 },
  // specials
  palm_blast: { id: 'spec_1h_blast', name: 'Palm Blast', power: 2, special: true, projectile: 'blast', level: 'high' },
  energy_blast: { id: 'spec_2h_blast1', name: 'Energy Blast', power: 3, special: true, projectile: 'blast', level: 'mid' },
  rising_palm: { id: 'fight_uppercut_palm', name: 'Rising Palm', power: 2, special: true, level: 'mid', launch: true },
  shoryu_elbow: { id: 'fight_elbow_uppercut', name: 'Dragon Elbow', power: 3, special: true, level: 'mid', launch: true, invuln: 0.3 },
  hurricane: { id: 'fight_hurricane_kick', name: 'Hurricane Kick', power: 2, special: true, homing: true, knockdown: true, lunge: 0.7 },
  martelo: { id: 'fight_martelo2', name: 'Martelo', power: 3, special: true, chKnockdown: true },
  thrust_kick: { id: 'fight_bencao', name: 'Thrust Kick', power: 3, special: true, level: 'mid', knockdown: true, push: 0.9 },
  chapa: { id: 'fight_chapa', name: 'Chapa', power: 3, special: true, level: 'mid', knockdown: true },
  flying_knee: { id: 'fight_flying_knee', name: 'Flying Knee', power: 3, special: true, level: 'mid', launch: true, lunge: 1.0, travel: 1.4 },
  flip_kick: { id: 'fight_flip_kick', name: 'Flip Kick', power: 3, special: true, level: 'mid', launch: true, invuln: 0.25 },
  ground_slam: { id: 'spec_ground_blast', name: 'Ground Slam', power: 3, special: true, projectile: 'shockwave', level: 'low' },
  thunder_clap: { id: 'spec_2h_clap', name: 'Thunder Clap', power: 3, special: true, level: 'mid', stun: true, reach: 1.3 },
  spin_kick_adv: { id: 'fight_spin_back_kick_adv', name: 'Tornado Kick', power: 3, special: true, homing: true, knockdown: true, lunge: 0.8 },
  // aerials (pressed during a jump)
  air_lp: { id: 'air_butterfly_kick', name: 'Butterfly Kick', power: 2, air: true, level: 'mid' },
  air_hp: { id: 'fight_crescent_kick', name: 'Crescent Kick', power: 3, air: true, level: 'mid', chKnockdown: true },
  air_lk: { id: 'fight_flying_sidekick', name: 'Jump Side Kick', power: 2, air: true, level: 'mid' },
  air_hk: { id: 'fight_bicycle_kick', name: 'Bicycle Kick', power: 3, air: true, level: 'mid', knockdown: true },
  // supers
  super_rush: { id: 'fight_combo8', name: 'Rush Combo', power: 3, super: true, knockdown: true, lunge: 0.8 },
  super_knees: { id: 'fight_knees_uppercut', name: 'Knee Barrage', power: 3, super: true, launch: true, lunge: 0.8 },
  super_beam: { id: 'spec_2h_beam1', name: 'Energy Beam', power: 3, super: true, projectile: 'beam', level: 'mid' },
  // reversal counter (after a parry)
  reversal: { id: 'fight_elbow_uppercut', name: 'Reversal', power: 3, level: 'mid', launch: true }
};

// Style-specific moves share the same table
Object.assign(MOVES, STYLE_MOVES);

// Normal moves by button and held direction
const NORMALS = {
  lp: { n: 'jab', f: 'jab_cross', b: 'hook_short', d: 'body_hook', df: 'body_blow', db: 'cross_elbow' },
  hp: { n: 'cross2', f: 'hook_head', b: 'uppercut_back', d: 'rising_elbow', df: 'launcher', db: 'elbow_uppercut' },
  lk: { n: 'low_kick', f: 'side_kick', b: 'knee', d: 'sweep_front', df: 'mid_kick', db: 'ground_spin' },
  hk: { n: 'roundhouse', f: 'high_kick', b: 'spin_kick', d: 'sweep_360', df: 'rib_kick', db: 'back_sweep' }
};
const SS_MOVES = { lp: 'ss_hook', hp: 'ss_hook', lk: 'ss_armada', hk: 'ss_meia_lua' };
const DASH_MOVES = { lp: 'dash_elbow', hp: 'dash_overhead', lk: 'dash_sidekick', hk: 'dash_knee' };

// Motion specials (directions relative to the opponent; longest first)
const SPECIALS = [
  { motion: ['f', 'df', 'd', 'db', 'b'], button: 'p', move: 'ground_slam', label: '→↘↓↙← + P' },
  { motion: ['b', 'db', 'd', 'df', 'f'], button: 'k', move: 'spin_kick_adv', label: '←↙↓↘→ + K' },
  { motion: ['d', 'df', 'f'], button: 'lp', move: 'palm_blast', label: '↓↘→ + LP' },
  { motion: ['d', 'df', 'f'], button: 'hp', move: 'energy_blast', label: '↓↘→ + HP' },
  { motion: ['f', 'd', 'df'], button: 'lp', move: 'rising_palm', label: '→↓↘ + LP' },
  { motion: ['f', 'd', 'df'], button: 'hp', move: 'shoryu_elbow', label: '→↓↘ + HP' },
  { motion: ['d', 'db', 'b'], button: 'lk', move: 'hurricane', label: '↓↙← + LK' },
  { motion: ['d', 'db', 'b'], button: 'hk', move: 'martelo', label: '↓↙← + HK' },
  { motion: ['d', 'df', 'f'], button: 'lk', move: 'thrust_kick', label: '↓↘→ + LK' },
  { motion: ['d', 'df', 'f'], button: 'hk', move: 'chapa', label: '↓↘→ + HK' },
  { motion: ['b', 'f'], button: 'k', move: 'flying_knee', label: '← → + K' },
  { motion: ['d', 'u'], button: 'k', move: 'flip_kick', label: '↓ ↑ + K' },
  { motion: ['d', 'n', 'd'], button: 'p', move: 'thunder_clap', label: '↓ ↓ + P' }
];

const THROWS = [
  ['fight_throw_attacker', 'fight_throw_victim'],
  ['fight_hellslam_attacker', 'fight_hellslam_victim'],
  ['fight_takedown_attacker', 'fight_takedown_victim']
];

const DIFFICULTY = {
  easy: { react: 0.55, block: 0.25, read: 0.15, step: 0.08, parry: 0, punish: 0.2, combo: 0.25, aggression: 0.35, tech: 0.15, breakThrow: 0.15, juggle: 0.25, special: 0.06 },
  normal: { react: 0.32, block: 0.5, read: 0.45, step: 0.16, parry: 0.06, punish: 0.55, combo: 0.5, aggression: 0.5, tech: 0.45, breakThrow: 0.4, juggle: 0.6, special: 0.1 },
  hard: { react: 0.17, block: 0.72, read: 0.75, step: 0.22, parry: 0.14, punish: 0.9, combo: 0.8, aggression: 0.62, tech: 0.8, breakThrow: 0.7, juggle: 0.9, special: 0.14 }
};

// Keyboard / gamepad bindings live in fightControls.js (rebindable)
const KEYS = getKeys();
const BUTTONS = ['lp', 'hp', 'lk', 'hk', 'throw', 'super', 'parry'];

/** Move list for the help panel */
const COMMAND_HELP = [
  { group: 'Movement', items: [['Tap ↑ / ↓', 'Sidestep in / out (hold to sidewalk)'], ['Hold ↑', 'Jump (with ← / → for back / forward)'], ['Hold ↓', 'Crouch'], ['→ → / ← ←', 'Dash / back-dash'], ['Hold ← or Guard', 'Standing guard (highs + mids)'], ['↓← or ↓ + Guard', 'Crouching guard (lows)'], ['Parry', 'Reverse a strike (↓ + Parry for lows)'], ['LP + LK or Throw', 'Throw — tap Throw when grabbed to break'], ['Guard on landing', 'Tech roll']] },
  { group: 'Strings', items: [['LP, LP, HP', 'Jab, jab, straight'], ['LP, HP, HK', 'Jab, cross, roundhouse'], ['→LP, HK', 'One-two, high kick'], ['→HP, HP', 'Hook into uppercut'], ['HP, LP, HP', 'Straight, hook, haymaker']] },
  { group: 'Launchers & key moves', items: [['↘ + HP', 'Launcher (juggle!)'], ['↓ + HP', 'Rising elbow (launch)'], ['↙ + HP', 'Elbow uppercut (launch)'], ['↓ + LK / HK', 'Sweeps (low)'], ['↙ + LK', 'Ground spin kick (hits downed)'], ['← + HK', 'Spinning back kick'], ['LP + HP', 'Quad punch'], ['LK + HK', 'Double snap kick'], ['↑ + LP + HP', 'Leaping smash']] },
  { group: 'Sidestep & dash attacks', items: [['Sidestep + P', 'Stepping hook (tracks)'], ['Sidestep + LK / HK', 'Armada / Meia lua'], ['Dash + LP', 'Stepping elbow'], ['Dash + HP', 'Overhead elbow (crumple)'], ['Dash + LK', 'Flying side kick'], ['Dash + HK', 'Flying knee (launch)']] },
  { group: 'In the air', items: [['Jump + LP', 'Butterfly kick'], ['Jump + HP', 'Crescent kick'], ['Jump + LK', 'Jump side kick'], ['Jump + HK', 'Bicycle kick']] },
  { group: 'Specials (→ = toward opponent)', items: SPECIALS.map(s => [s.label, MOVES[s.move].name]) },
  { group: 'Super (full meter)', items: [['Super button', 'Close: rush combo · Far: energy beam'], ['LP + HP + LK + HK', 'Same']] }
];

/* ------------------------------------------------------------------ */

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

function segDist(p, a, b) {
  _v.subVectors(b, a);
  const len2 = _v.lengthSq();
  let t = len2 > 1e-6 ? _w.subVectors(p, a).dot(_v) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return _w.copy(a).addScaledVector(_v, t).distanceTo(p);
}
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export { ARENA, MAX_HP, BODY_R, LIMB_R, GRAV, WALK_FWD, WALK_BACK, SIDEWALK, MIN_GAP, DMG, MOVES, NORMALS, SS_MOVES, DASH_MOVES, SPECIALS, THROWS, DIFFICULTY, KEYS, BUTTONS, COMMAND_HELP, segDist, angDiff };
