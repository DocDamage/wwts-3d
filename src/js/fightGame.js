/**
 * Fight Game — a playable 3D fighter on the stage, built on what makes Tekken,
 * Dead or Alive and Soulcalibur feel the way they do:
 *
 *  - Real 3D movement: tap up/down to sidestep (hold to sidewalk), double-tap to
 *    dash / back-dash, forward / neutral / back jumps with aerial attacks
 *  - Hits are physical: an attack only lands if the striking fist / foot / knee /
 *    elbow actually reaches the opponent's body at its impact frames (measured from
 *    the mocap skeleton). Strikes are aimed so the limb lands on the opponent, and
 *    the attacker steps in to the distance the move actually reaches
 *  - High / mid / low: standing guard stops highs and mids, crouching guard stops
 *    lows, highs whiff over crouchers, jumps clear lows
 *  - Linear moves can be sidestepped; hooks, roundhouses and spins track
 *  - Counter hits, launchers and juggles, crumples and stuns (critical state),
 *    knockdowns, tech rolls, ground hits
 *  - Breakable throws (beat guard, lose to strikes), a parry / hold that reverses
 *    strikes (loses to throws) — DOA's triangle
 *  - Motion-input specials (projectiles you can sidestep), a meter super
 *  - Every hit plays a reaction chosen by where it landed and from which side,
 *    started at the reaction's moment of impact, with hit-stop and push-back
 *
 * Effects / HUD / sound come from FightDirector.
 */
import * as THREE from 'three';
import { FightDirector } from './fightDirector.js';
import { CAST_BY_KEY } from './fightCast.js';
import { sample } from './mocap.js';

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

// Keyboard layouts (KeyboardEvent.code)
const KEYS = {
  1: {
    left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'],
    lp: ['KeyF'], hp: ['KeyG'], lk: ['KeyV'], hk: ['KeyB'], throw: ['KeyH'], super: ['KeyT'], guard: ['KeyC'], parry: ['KeyX']
  },
  2: {
    left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'],
    lp: ['KeyK', 'Numpad4'], hp: ['KeyL', 'Numpad5'], lk: ['Comma', 'Numpad1'], hk: ['Period', 'Numpad2'],
    throw: ['Semicolon', 'Numpad6'], super: ['KeyO', 'Numpad3'], guard: ['KeyM', 'Numpad0'], parry: ['KeyN', 'NumpadDecimal']
  }
};
// Standard gamepad buttons
const PAD = { lp: 2, hp: 3, lk: 0, hk: 1, throw: 4, super: 5, guard: 6, parry: 7, start: 9, up: 12, down: 13, left: 14, right: 15 };
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

class FightGame extends FightDirector {
  constructor(dj) {
    super(dj);
    this.keys = new Set();
    this.keyDownAt = {};
    this.pressed = new Set();     // key codes pressed since last frame
    this.released = new Set();
    this.padPrev = {};
    this.paused = false;
    this.matchActive = false;
    this.onMatchEnd = null;
    this.onPauseChange = null;
    this.shots = [];
    this.camSide = 1;
    this._kd = (e) => this.onKey(e, true);
    this._ku = (e) => this.onKey(e, false);
  }

  /* ================= public ================= */

  /**
   * opts: { p1, p2 (cast keys), mode: 'cpu' | '2p', difficulty, rounds (wins needed = ceil(rounds/2)), roundTime }
   */
  async startMatch(opts) {
    if (!this.dj.mocapReady) return false;
    this.stop(true);
    this.opts = { mode: 'cpu', difficulty: 'normal', rounds: 3, roundTime: 99, ...opts };
    this.need = Math.ceil(this.opts.rounds / 2);
    this.runId++;
    const runId = this.runId;
    this.active = true;
    this.matchActive = true;
    this.paused = false;
    this.rng = Math.random;
    this.winner = null;
    this.glowTex = this.glowTex || this.makeTex();
    this.ensureAudio();
    window.__fightInputActive = true;
    document.body.classList.add('fight-match-on');
    window.addEventListener('keydown', this._kd, true);
    window.addEventListener('keyup', this._ku, true);

    // Load the chosen fighters into the two slots, and every clip the fight uses
    await Promise.all([this.dj.setPlayerAvatar(1, this.opts.p1), this.dj.setPlayerAvatar(2, this.opts.p2)]);
    await this.dj.mocap.preload(this.clipList(), 6);
    if (runId !== this.runId) return false;
    const names = { 1: CAST_BY_KEY[this.opts.p1]?.name || 'P1', 2: CAST_BY_KEY[this.opts.p2]?.name || (this.opts.mode === 'cpu' ? 'CPU' : 'P2') };
    this.names = names;
    this.wins = { 1: 0, 2: 0 };
    this.f = { 1: this.makeFighter(1), 2: this.makeFighter(2) };
    this.f[2].cpu = this.opts.mode === 'cpu';
    // Fight stances are bladed: turn the idle so the chest faces the opponent
    const idle = this.dj.mocap.get('mx_fight_idle');
    this.idleYaw = idle?.rm.chest0 !== undefined ? -idle.rm.chest0 * 0.75 : 0;
    this.takeControlGame();
    this.buildHud();
    this.setFightCamera();

    try {
      for (let round = 1; runId === this.runId; round++) {
        await this.playRound(round, runId);
        if (runId !== this.runId) return false;
        if (this.wins[1] >= this.need || this.wins[2] >= this.need) break;
      }
      if (runId !== this.runId) return false;
      const champ = this.wins[1] >= this.need ? 1 : 2;
      this.banner(`${names[champ].toUpperCase()} WINS!`, 4, 'win');
      this.dj.arena?.cheer(6);
      this.dj.burstConfetti?.(champ === 1 ? [0xff2d2d, 0xffd21a, 0xffffff] : [0x00e5ff, 0xffd21a, 0xffffff]);
      await this.wait(3.5);
      if (runId !== this.runId) return false;
      this.onMatchEnd?.({ winner: champ, names, wins: { ...this.wins } });
    } catch (e) {
      if (e !== 'stopped') console.warn('Fight game error', e);
    }
    return true;
  }

  clipList() {
    const ids = new Set(Object.values(MOVES).map(m => 'mx_' + m.id));
    THROWS.flat().forEach(id => ids.add('mx_' + id));
    ['fight_idle', 'fight_step_forward', 'fight_step_back', 'fight_sidestep_left', 'fight_sidestep_right', 'strafe_left', 'strafe_right',
      'walk', 'walk_back', 'crouch_idle', 'crouch_down', 'fblock_center', 'fblock_low', 'fblock_react', 'fight_block_high', 'fight_block_inward',
      'jump_stand', 'jump_forward', 'jump_backward', 'jump', 'falling_landing', 'roll_land', 'getup_kip', 'getup_back', 'getup_stomach', 'getup_knockdown',
      'fhit_head_light_l', 'fhit_head_light_r', 'fhit_head_light_c', 'fhit_head_med_l', 'fhit_head_med_r', 'fhit_head_med_c', 'fhit_head_big_l', 'fhit_head_big_r', 'fhit_head_big_c',
      'fhit_small_left', 'fhit_small_right', 'fhit_large_left', 'fhit_large_right', 'fhit_taking_punch', 'fhit_body_straight', 'fhit_rib', 'fhit_kidney', 'fhit_stomach', 'fhit_side',
      'fhit_body_punch', 'fhit_stomach_big', 'fhit_rib_big', 'fhit_kidney_big', 'fhit_side_big', 'fhit_body_blow', 'fhit_small_front', 'fhit_shove', 'fhit_shove_spin', 'fight_dizzy',
      'fhit_face_uppercut', 'fight_recv_uppercut', 'sweep_fall', 'fight_knockdown', 'knocked_down', 'fall_stumble_back', 'fall_shoulder', 'fall_liver', 'fall_knocked_stomach',
      'fhit_flip_back', 'fko_flying_back', 'fko_dying_back', 'fko_out_back', 'fko_falling_back', 'fhit_launch', 'fight_victory', 'fight_victory_boxing', 'fight_defeat',
      'fight_ready_jump', 'fight_taunt', 'fight_taunt_arms'
    ].forEach(id => ids.add('mx_' + id));
    return [...ids];
  }

  /** Leave the match entirely */
  endMatch() {
    this.stop(true);
  }

  stop(silent = false) {
    this.matchActive = false;
    this.roundLive = false;
    this.paused = false;
    window.__fightInputActive = false;
    document.body.classList.remove('fight-match-on');
    window.removeEventListener('keydown', this._kd, true);
    window.removeEventListener('keyup', this._ku, true);
    this.keys.clear();
    this.shots.forEach(s => this.killShot(s));
    this.shots = [];
    [1, 2].forEach(p => { const st = this.dj.characterStates[p]; if (st) st.fightLift = 0; });
    super.stop(silent);
  }

  setPaused(on) {
    if (!this.matchActive) return;
    this.paused = !!on;
    this.dj.timeScale = this.paused ? 0 : 1;
    this.onPauseChange?.(this.paused);
  }

  /* ================= setup ================= */

  makeTex() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,240,200,0.8)');
    grad.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  makeFighter(p) {
    return {
      p,
      hp: MAX_HP,
      meter: 0,
      state: 'idle',
      t0: 0,
      until: 0,
      buf: [],
      lastDir: 'n',
      lastTap: { f: -9, b: -9 },
      dashUntil: 0,
      ssUntil: 0,
      combo: 0,
      comboDmg: 0,
      juggle: 0,
      mv: null,
      invulnUntil: 0,
      yawOff: 0,
      yawTarget: 0,
      aim: new THREE.Vector2(p === 1 ? 1 : -1, 0),
      lockAim: false,
      vel: new THREE.Vector2(),     // code-driven slide (push-back, dashes, step-ins)
      velUntil: 0,
      air: null,                    // { y, vy } while airborne
      cpu: false,
      ai: { next: 0, hold: null, holdUntil: 0, plan: null },
      guardHeld: false,
      holdBack: false,
      holdDown: false,
      crouching: false
    };
  }

  takeControlGame() {
    const dj = this.dj;
    [1, 2].forEach(p => {
      const st = dj.characterStates[p];
      dj.stopMove(p);
      st.fighting = true;
      st.noFace = true;     // facing is handled here
      st.emote = null;
      st.pendingChain = null;
      st.state = 'IDLE_STATION';
      st.targetFacingAngle = null;
      st.fightLift = 0;
      dj.rigs[p]?.setFightMode(true);
      dj.rigs[p]?.setLocomotion(0);
    });
    if (dj.drivenPlayer) dj.setDrivenPlayer(null);
  }

  resetRound() {
    [1, 2].forEach(p => {
      const f = this.f[p];
      Object.assign(f, {
        hp: MAX_HP, state: 'intro', until: 0, buf: [], combo: 0, comboDmg: 0, juggle: 0, mv: null, invulnUntil: 0,
        air: null, yawOff: this.idleYaw, yawTarget: this.idleYaw, lockAim: false, crouching: false, grabbedBy: null
      });
      f.vel.set(0, 0);
      f.ai.hold = null;
      f.ai.plan = null;
      const char = this.dj.characters[p];
      char.position.set(ARENA.cx + (p === 1 ? -1.25 : 1.25), char.position.y, ARENA.cz);
      const st = this.dj.characterStates[p];
      st.fightLift = 0;
      f.aim.set(p === 1 ? 1 : -1, 0);
      st.facing = Math.atan2(f.aim.x, f.aim.y) + f.yawOff;
      st.targetPos.set(char.position.x, 0, char.position.z);
      this.dj.rigs[p]?.stop(0.1);
      this.dj.rigs[p]?.setLocomotion(0);
    });
    this.hp = { 1: MAX_HP, 2: MAX_HP };
    this.lag = { 1: MAX_HP, 2: MAX_HP };
    this.over = false;
    this.camSide = 1;
  }

  async playRound(round, runId) {
    this.resetRound();
    this.clockLeft = this.opts.roundTime;
    this.roundLive = false;
    this.banner(`ROUND ${round}`, 1.2);
    this.sound('bell');
    [1, 2].forEach(p => this.dj.rigs[p].play(round === 1 ? 'mx_fight_ready_jump' : (this.rng() < 0.5 ? 'mx_fight_taunt' : 'mx_fight_taunt_arms'), { rootMotion: false, fadeIn: 0.15, fadeOut: 0.3, timeScale: 1.3 }));
    await this.wait(1.6);
    if (runId !== this.runId) return;
    [1, 2].forEach(p => { this.dj.rigs[p].stop(0.2); this.setState(this.f[p], 'idle'); });
    this.banner('FIGHT!', 0.9, 'fight');
    this.sound('fight');
    this.roundLive = true;
    const result = await new Promise(resolve => { this._roundResolve = resolve; });
    this.roundLive = false;
    if (runId !== this.runId) return;
    await this.wait(result === 'time' ? 2.6 : 3.4);
  }

  /* ================= input ================= */

  onKey(e, down) {
    if (!this.matchActive) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (down && e.code === 'Escape') {
      this.setPaused(!this.paused);
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    // While a match runs the keyboard belongs to the fight
    e.preventDefault();
    e.stopImmediatePropagation();
    if (down) {
      if (!e.repeat) { this.pressed.add(e.code); this.keyDownAt[e.code] = this.time; }
      this.keys.add(e.code);
    } else {
      this.keys.delete(e.code);
      this.released.add(e.code);
    }
  }

  /**
   * Input for player p this frame:
   * { x (-1..1 screen), up, down (held), upTap, downTap, upHold (held long enough to jump),
   *   guard (held), pressed: Set<'lp'|'hp'|'lk'|'hk'|'throw'|'super'|'parry'> }
   */
  readInput(p) {
    const layouts = this.opts.mode === 'cpu' ? [KEYS[1], KEYS[2]] : [KEYS[p]];
    const codes = (act) => layouts.flatMap(L => L[act]);
    const held = (act) => codes(act).some(c => this.keys.has(c));
    const hit = (act) => codes(act).some(c => this.pressed.has(c));
    const rel = (act) => codes(act).some(c => this.released.has(c));
    const downFor = (act) => Math.max(...codes(act).map(c => (this.keys.has(c) ? this.time - (this.keyDownAt[c] ?? this.time) : -1)));
    const relAge = (act) => Math.min(...codes(act).map(c => (this.released.has(c) ? this.time - (this.keyDownAt[c] ?? -9) : 9)));
    const inp = { x: 0, up: held('up'), down: held('down'), guard: held('guard'), pressed: new Set(), upTap: false, downTap: false, upHold: false };
    if (held('left')) inp.x -= 1;
    if (held('right')) inp.x += 1;
    BUTTONS.forEach(a => { if (hit(a)) inp.pressed.add(a); });
    if (hit('up')) inp.upPress = true;
    if (rel('up') && relAge('up') < 0.16) inp.upTap = true;
    if (rel('down') && relAge('down') < 0.16) inp.downTap = true;
    inp.upHold = inp.up && downFor('up') >= 0.12;
    inp.downHold = inp.down && downFor('down') >= 0.09;

    // Gamepads: first pad -> P1, second -> P2 (in vs CPU any pad drives P1)
    const pads = (navigator.getGamepads ? [...navigator.getGamepads()] : []).filter(Boolean);
    const pad = this.opts.mode === 'cpu' ? (p === 1 ? pads[0] : null) : pads[p - 1];
    if (pad) {
      const b = (i) => !!pad.buttons[i]?.pressed;
      const prev = this.padPrev[pad.index] || {};
      const now = {};
      const ax = pad.axes[0] || 0;
      const ay = pad.axes[1] || 0;
      if (b(PAD.left) || ax < -0.45) inp.x = -1;
      if (b(PAD.right) || ax > 0.45) inp.x = 1;
      now.up = b(PAD.up) || ay < -0.6;
      now.down = b(PAD.down) || ay > 0.6;
      ['up', 'down'].forEach(d => {
        if (now[d] && !prev[d]) { prev[d + 'At'] = this.time; if (d === 'up') inp.upPress = true; }
        now[d + 'At'] = now[d] ? (prev[d + 'At'] ?? this.time) : prev[d + 'At'];
        if (now[d]) inp[d] = true;
        if (!now[d] && prev[d] && this.time - (prev[d + 'At'] ?? 0) < 0.16) inp[d + 'Tap'] = true;
      });
      if (now.up && this.time - now.upAt >= 0.12) inp.upHold = true;
      if (now.down && this.time - now.downAt >= 0.09) inp.downHold = true;
      if (b(PAD.guard)) inp.guard = true;
      [...BUTTONS, 'start'].forEach(a => {
        now[a] = b(PAD[a]);
        if (now[a] && !prev[a]) {
          if (a === 'start') this.setPaused(!this.paused);
          else inp.pressed.add(a);
        }
      });
      this.padPrev[pad.index] = now;
    }
    return inp;
  }

  /* ================= per frame ================= */

  update(dt) {
    if (!this.active) return;
    if (this.paused) {
      this.dj.timeScale = 0;
      if (this.f) [1, 2].forEach(p => { if (!this.f[p].cpu) this.readInput(p); });
      this.pressed.clear();
      this.released.clear();
      return;
    }
    super.update(dt);
    if (!this.matchActive || !this.f) return;
    const gdt = dt * this.dj.timeScale;

    if (this.roundLive) {
      this.clockLeft -= gdt;
      if (this.clockLeft <= 0) this.timeOver();
    }
    this.updateCamBasis();
    const inputs = {
      1: this.f[1].cpu ? this.aiInput(1, gdt) : this.readInput(1),
      2: this.f[2].cpu ? this.aiInput(2, gdt) : this.readInput(2)
    };
    this.pressed.clear();
    this.released.clear();
    [1, 2].forEach(p => this.tickFighter(this.f[p], this.f[p === 1 ? 2 : 1], inputs[p], gdt));
    [1, 2].forEach(p => this.checkContacts(this.f[p], this.f[p === 1 ? 2 : 1]));
    this.keepApart();
    this.driftAxis(gdt);
    this.updateShots(gdt);
    this.updateComboHud();
  }

  pos(p) { return this.dj.characters[p].position; }
  other(f) { return this.f[f.p === 1 ? 2 : 1]; }
  dist() { const A = this.pos(1); const B = this.pos(2); return Math.hypot(B.x - A.x, B.z - A.z); }

  /** Unit vector from f toward its opponent (xz) */
  toOpp(f, out = new THREE.Vector2()) {
    const A = this.pos(f.p);
    const B = this.pos(f.p === 1 ? 2 : 1);
    out.set(B.x - A.x, B.z - A.z);
    const l = out.length();
    if (l < 1e-4) out.copy(f.aim); else out.divideScalar(l);
    return out;
  }

  /** Camera basis: n = toward the camera (xz), right = screen right */
  updateCamBasis() {
    const A = this.pos(1);
    const B = this.pos(2);
    let ux = B.x - A.x;
    let uz = B.z - A.z;
    const l = Math.hypot(ux, uz) || 1;
    ux /= l; uz /= l;
    let nx = -uz;
    let nz = ux;
    // Stay on the audience side; flip only when clearly past side-on
    if (nz * this.camSide < -0.25) this.camSide = -this.camSide;
    nx *= this.camSide; nz *= this.camSide;
    if (nz < 0 && Math.abs(nz) > 0.25) { nx = -nx; nz = -nz; }
    this.camN = this.camN || new THREE.Vector2(0, 1);
    this.camN.set(nx, nz);
    this.camRight = this.camRight || new THREE.Vector2(1, 0);
    // camera looks along -n; screen right = (-fz, fx) with f = -n
    this.camRight.set(nz, -nx);
  }

  setState(f, state, until = 0) {
    f.state = state;
    f.t0 = this.time;
    f.until = until;
  }

  isFree(f) {
    return ['idle', 'walk', 'crouch', 'guard', 'sidewalk'].includes(f.state);
  }

  grounded(f) {
    return !['jump', 'airattack', 'air', 'down', 'thrown', 'grabbed', 'throwing', 'ko'].includes(f.state);
  }

  tickFighter(f, o, inp, gdt) {
    const rig = this.dj.rigs[f.p];
    const st = this.dj.characterStates[f.p];
    const P = this.pos(f.p);
    const opp = this.toOpp(f);
    // Screen-relative left/right -> toward / away from the opponent
    const screenSide = Math.sign(this.camRight.x * opp.x + this.camRight.y * opp.y) || (f.p === 1 ? 1 : -1);
    const rel = Math.sign(inp.x) * screenSide;
    const down = inp.downHold || (inp.down && (inp.pressed.size > 0 || f.state === 'crouch'));
    const dir = (down ? 'd' : inp.up ? 'u' : '') + (rel > 0 ? 'f' : rel < 0 ? 'b' : '') || 'n';
    if (dir !== f.lastDir) {
      if ((dir === 'f' || dir === 'b') && f.lastDir === 'n') {
        if (this.time - f.lastTap[dir] < 0.26 && this.roundLive && this.isFree(f)) this.dash(f, dir);
        f.lastTap[dir] = this.time;
      }
      f.buf.push({ dir, t: this.time });
      if (f.buf.length > 14) f.buf.shift();
      f.lastDir = dir;
    }
    f.holdBack = rel < 0;
    f.holdDown = !!inp.down;
    f.guardHeld = !!inp.guard;
    f.inp = inp;

    // Aim at the opponent unless a move has locked its direction
    if (!f.lockAim && !['down', 'thrown', 'throwing', 'grabbed', 'ko', 'air', 'falling'].includes(f.state)) f.aim.copy(opp);
    // Slide toward this move's yaw offset (aim for attacks, chest-forward otherwise)
    f.yawOff += angDiff(f.yawTarget, f.yawOff) * Math.min(1, gdt * 18);
    if (!['thrown', 'throwing', 'ko'].includes(f.state) && !(f.state === 'down' && !f.air)) st.facing = Math.atan2(f.aim.x, f.aim.y) + f.yawOff;

    // Code-driven slides (push-back, dashes, step-ins) — never through the opponent
    if (this.time < f.velUntil) {
      const into = f.vel.x * opp.x + f.vel.y * opp.y;
      if (into > 0 && this.dist() < 0.62) {
        // remove the part heading into them
        f.vel.x -= opp.x * into;
        f.vel.y -= opp.y * into;
      }
      P.x += f.vel.x * gdt;
      P.z += f.vel.y * gdt;
    }

    // Airborne physics (jumps and juggles)
    if (f.air) this.tickAir(f, o, gdt);
    st.fightLift = f.air ? f.liftOut || 0 : 0;

    if (!this.roundLive) {
      rig.setLocomotion(0);
      this.clampArena(P);
      return;
    }

    let speed = 0;
    let back = 0;
    let strafe = 0;
    switch (f.state) {
      case 'idle':
      case 'walk':
      case 'crouch':
      case 'guard':
      case 'sidewalk': {
        if (this.tryCommand(f, o, inp, dir)) break;
        // Up: with a direction = jump that way; alone = sidestep in (hold to turn it into a jump)
        if (inp.upPress && rel !== 0) { this.jump(f, rel); break; }
        if (inp.upPress && f.state !== 'crouch' && f.state !== 'sidewalk') { this.sidestep(f, -1); break; }
        if (inp.downTap && !inp.pressed.size && (this.time - f.t0 < 0.2 || f.state !== 'crouch')) { this.sidestep(f, 1); break; }
        if (inp.upHold && f.state !== 'sidewalk') { this.jump(f, rel); break; }
        // Guard: hold back (or the guard button); crouch with down
        const threatened = this.threatened(f, o);
        const guarding = f.guardHeld || (f.holdBack && threatened);
        if (inp.downHold || (f.state === 'crouch' && inp.down)) {
          if (f.state !== 'crouch') this.enterCrouch(f);
          f.crouching = true;
          f.crouchGuard = f.guardHeld || f.holdBack;
          if (f.crouchGuard && threatened && !f.guardPose) { this.dj.rigs[f.p].play('mx_fblock_low', { hold: true, rootMotion: false, fadeIn: 0.06, timeScale: 1.6 }); f.guardPose = true; }
          break;
        }
        if (f.state === 'crouch') { this.standUp(f); }
        f.crouching = false;
        if (guarding) {
          if (f.state !== 'guard') { this.enterGuard(f); }
          if (f.guardHeld) break;     // the guard button stands you still
        } else if (f.state === 'guard') { rig.stop(0.15); this.setState(f, 'idle'); f.guardPose = false; }
        // Sidewalk while the second tap is held
        if (f.state === 'sidewalk') {
          const vert = inp.up ? -1 : inp.down ? 1 : 0;
          if (!vert || vert !== f.ssDir) { this.setState(f, 'idle'); break; }
          this.orbit(f, f.ssDir * SIDEWALK * gdt);
          strafe = this.strafeSign(f, f.ssDir);
          speed = SIDEWALK;
          break;
        }
        if (rel !== 0) {
          speed = rel > 0 ? WALK_FWD : WALK_BACK;
          back = rel < 0 ? 1 : 0;
          P.x += opp.x * rel * speed * gdt;
          P.z += opp.y * rel * speed * gdt;
          if (f.state !== 'guard') this.setState(f, 'walk');
        } else if (f.state === 'walk') {
          this.setState(f, 'idle');
        }
        break;
      }
      case 'sidestep':
        if (f.ssDir < 0 && inp.upHold && this.time - f.t0 < 0.2) { this.jump(f, rel); break; }
        // circle round the opponent: ~0.8 m in 0.28 s
        if (this.time - f.t0 < 0.28) { this.orbit(f, f.ssDir * (0.8 / 0.28) * gdt); strafe = this.strafeSign(f, f.ssDir); }
        if (this.time >= f.until) {
          const vert = inp.up ? -1 : inp.down ? 1 : 0;
          if (vert && vert === f.ssDir) this.setState(f, 'sidewalk');
          else this.setState(f, 'idle');
          f.lockAim = false;
        } else if (inp.pressed.size && this.time - f.t0 > 0.08) {
          this.tryCommand(f, o, inp, dir);
        }
        break;
      case 'attack':
      case 'airattack':
        this.tickAttack(f, o, inp, gdt);
        break;
      case 'dash':
      case 'backdash':
        if (this.time >= f.until) this.toIdle(f);
        else if (inp.pressed.size && f.state === 'dash') this.tryCommand(f, o, inp, dir);
        break;
      case 'jump':
        if (inp.pressed.size && f.air && !f.airAttacked) {
          const b = ['hk', 'lk', 'hp', 'lp'].find(x => inp.pressed.has(x));
          if (b) this.airAttack(f, o, b);
        }
        break;
      case 'land':
      case 'hitstun':
      case 'blockstun':
      case 'stun':
      case 'getup':
      case 'parry':
        if (this.time >= f.until) this.toIdle(f);
        break;
      case 'down':
        this.tickDown(f, o, inp);
        break;
      case 'grabbed':
        if (BUTTONS.some(b => inp.pressed.has(b)) && this.time < f.breakUntil && (inp.pressed.has('throw') || inp.pressed.has('lp') || inp.pressed.has('lk'))) this.breakThrow(o, f);
        break;
      case 'throwing':
      case 'thrown':
        if (this.time >= f.until) this.toIdle(f);
        break;
      default:
        break;
    }
    rig.setLocomotion(speed, 0, { back, strafe });
    this.clampArena(P);
  }

  clampArena(P) {
    const dx = (P.x - ARENA.cx) / ARENA.rx;
    const dz = (P.z - ARENA.cz) / ARENA.rz;
    const r = Math.hypot(dx, dz);
    if (r > 1) {
      P.x = ARENA.cx + (dx / r) * ARENA.rx;
      P.z = ARENA.cz + (dz / r) * ARENA.rz;
    }
  }

  /** Move around the opponent (sidestep / sidewalk): + = toward the camera */
  orbit(f, amount) {
    const P = this.pos(f.p);
    const Q = this.pos(this.other(f).p);
    const n = this.camN;
    // perpendicular to the fight axis, on the camera side
    const opp = this.toOpp(f);
    let px = -opp.y;
    let pz = opp.x;
    if (px * n.x + pz * n.y < 0) { px = -px; pz = -pz; }
    const r = Math.hypot(P.x - Q.x, P.z - Q.z);
    P.x += px * amount;
    P.z += pz * amount;
    // keep the same distance (circle round them)
    const r2 = Math.hypot(P.x - Q.x, P.z - Q.z) || 1;
    P.x = Q.x + (P.x - Q.x) * (r / r2);
    P.z = Q.z + (P.z - Q.z) * (r / r2);
  }

  /** Which strafe clip shows moving `vert` (+1 toward camera) for this fighter */
  strafeSign(f, vert) {
    const opp = this.toOpp(f);
    const left = { x: opp.y, z: -opp.x };    // the fighter's left
    let px = -opp.y;
    let pz = opp.x;
    if (px * this.camN.x + pz * this.camN.y < 0) { px = -px; pz = -pz; }
    const side = (px * left.x + pz * left.z) * vert;
    return side > 0 ? -1 : 1;   // strafe: -1 left, +1 right
  }

  toIdle(f) {
    const rig = this.dj.rigs[f.p];
    if (['crouch', 'guard', 'attack', 'airattack', 'hitstun', 'blockstun', 'stun', 'parry', 'land', 'getup'].includes(f.state)) rig.stop(0.2);
    this.setState(f, 'idle');
    f.mv = null;
    f.lockAim = false;
    f.crouching = false;
    f.guardPose = false;
    f.yawTarget = this.idleYaw;
    f.airAttacked = false;
    // the opponent's combo ends once we're free again
    const o = this.other(f);
    if (o.combo) { o.combo = 0; o.comboDmg = 0; }
    f.juggle = 0;
  }

  /** Is the opponent swinging at us right now? (holding back then shows a guard) */
  threatened(f, o) {
    const d = this.dist();
    if (['attack', 'airattack'].includes(o.state) && o.mv && d < (o.mv.reach || 1.3) + 0.9) return true;
    return this.shots.some(s => s.owner === o.p && s.pos.distanceTo(this.pos(f.p)) < 2.5);
  }

  keepApart() {
    const A = this.pos(1);
    const B = this.pos(2);
    const f1 = this.f[1];
    const f2 = this.f[2];
    if (!this.grounded(f1) || !this.grounded(f2)) return;
    const dx = B.x - A.x;
    const dz = B.z - A.z;
    const d = Math.hypot(dx, dz);
    if (d < MIN_GAP && d > 1e-4) {
      const push = (MIN_GAP - d) / 2;
      A.x -= (dx / d) * push; A.z -= (dz / d) * push;
      B.x += (dx / d) * push; B.z += (dz / d) * push;
    }
  }

  /** Gently keep the fight on camera: re-centre, and ease the axis back toward side-on */
  driftAxis(gdt) {
    const busy = (f) => ['throwing', 'thrown', 'grabbed', 'sidestep', 'sidewalk'].includes(f.state);
    if (busy(this.f[1]) || busy(this.f[2])) return;
    const A = this.pos(1);
    const B = this.pos(2);
    const mx = (A.x + B.x) / 2;
    const mz = (A.z + B.z) / 2;
    const ex = ARENA.cx - mx;
    const ez = ARENA.cz - mz;
    if (Math.hypot(ex, ez) > 0.9) {
      const k = Math.min(1, gdt * 0.5);
      A.x += ex * k; B.x += ex * k; A.z += ez * k; B.z += ez * k;
    }
    // axis angle from the x axis (as a line)
    let a = Math.atan2(B.z - A.z, B.x - A.x);
    if (a > Math.PI / 2) a -= Math.PI;
    if (a < -Math.PI / 2) a += Math.PI;
    if (Math.abs(a) > 0.9) {
      const turn = -Math.sign(a) * Math.min(Math.abs(a) - 0.9, 0.45 * gdt);
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      [A, B].forEach(P => {
        const x = P.x - mx;
        const z = P.z - mz;
        P.x = mx + x * c - z * s;
        P.z = mz + x * s + z * c;
      });
    }
  }

  /* ================= movement actions ================= */

  play(f, id, opts) {
    return this.dj.rigs[f.p].play('mx_' + id, opts);
  }

  dash(f, dir) {
    const fwd = dir === 'f';
    this.play(f, fwd ? 'fight_step_forward' : 'fight_step_back', { rootMotion: false, fadeIn: 0.05, fadeOut: 0.15, timeScale: 1.6 });
    this.setState(f, fwd ? 'dash' : 'backdash', this.time + (fwd ? 0.34 : 0.36));
    const opp = this.toOpp(f);
    const s = fwd ? 3.0 : -2.7;
    f.vel.set(opp.x * s, opp.y * s);
    f.velUntil = this.time + (fwd ? 0.3 : 0.32);
    f.dashUntil = this.time + 0.5;
  }

  sidestep(f, vert) {
    f.ssDir = vert;
    const clip = this.strafeSign(f, vert) < 0 ? 'fight_sidestep_left' : 'fight_sidestep_right';
    this.play(f, clip, { rootMotion: false, fadeIn: 0.05, fadeOut: 0.15, timeScale: 1.5 });
    this.setState(f, 'sidestep', this.time + 0.3);
    f.ssUntil = this.time + 0.55;
    // the step itself: circle round the opponent
    f.lockAim = false;
  }

  jump(f, rel) {
    const id = rel > 0 ? 'jump_forward' : rel < 0 ? 'jump_backward' : 'jump_stand';
    const air = this.airProfile('mx_' + id);
    const airtime = 0.66;
    const pre = 0.08;
    let ts = 1;
    let from = 0.3;
    if (air) {
      ts = THREE.MathUtils.clamp((air.land - air.takeoff) / airtime, 0.5, 2.2);
      from = Math.max(0, air.takeoff - pre * ts);
    }
    this.play(f, id, { from, rootMotion: false, fadeIn: 0.05, fadeOut: 0.2, timeScale: ts });
    this.setState(f, 'jump');
    f.airAttacked = false;
    f.jumpRel = rel;
    // take off after a short crouch
    f.air = { y: 0, vy: 0, pre: this.time + pre, vjump: (GRAV * airtime) / 2, clip: 'mx_' + id };
    const opp = this.toOpp(f);
    const h = rel > 0 ? 2.0 : rel < 0 ? -1.6 : 0;
    f.vel.set(opp.x * h, opp.y * h);
    f.velUntil = this.time + pre + airtime;
  }

  /** Takeoff / landing times of a jump clip, from its hip height */
  airProfile(id) {
    this._air = this._air || {};
    if (id in this._air) return this._air[id];
    const d = this.dj.mocap.get(id);
    let res = null;
    if (d?.rm.hy) {
      const { ht, hy } = d.rm;
      const rest = hy[0];
      let pk = 0;
      hy.forEach((y, i) => { if (y > hy[pk]) pk = i; });
      const thr = rest + 0.22 * (hy[pk] - rest);
      if (hy[pk] - rest > 8) {
        let a = 0;
        while (a < pk && hy[a] < thr) a++;
        let b = pk;
        while (b < hy.length - 1 && hy[b] > thr) b++;
        res = { takeoff: ht[a], land: ht[b], peak: ht[pk] };
      }
    }
    this._air[id] = res;
    return res;
  }

  /** Clip's own hip lift (world m) right now, so the jump arc stays in charge of height */
  clipLift(f) {
    const rig = this.dj.rigs[f.p];
    const o = rig.oneShot;
    if (!o || !o.a.rm.hy) return 0;
    const rm = o.a.rm;
    const y = sample(rm.ht, rm.hy, o.a.action.time);
    return (y - rm.hy[0]) * rig.hipScale * rig.unitToWorld * o.w;
  }

  tickAir(f, o, gdt) {
    const a = f.air;
    if (a.pre && this.time < a.pre) { f.liftOut = 0; return; }
    if (a.pre) { a.vy = a.vjump; a.pre = 0; }
    a.y += a.vy * gdt;
    a.vy -= GRAV * gdt;
    const lift = this.clipLift(f);
    f.liftOut = a.y - Math.max(0, lift);
    if (a.y <= 0 && a.vy < 0) {
      f.air = null;
      f.liftOut = 0;
      this.dj.characterStates[f.p].fightLift = 0;
      this.land(f, o);
    }
  }

  land(f, o) {
    if (f.state === 'air') return this.juggleLand(f, o);
    if (f.state === 'ko') return;
    // landing recovery
    f.vel.set(0, 0);
    if (f.state === 'airattack') this.dj.rigs[f.p].stop(0.15);
    this.setState(f, 'land', this.time + (f.state === 'airattack' ? 0.22 : 0.1));
    f.mv = null;
    f.lockAim = false;
    f.yawTarget = this.idleYaw;
    this.sound('thud', 0.25);
  }

  enterCrouch(f) {
    this.play(f, 'crouch_idle', { loop: true, rootMotion: false, fadeIn: 0.1 });
    this.setState(f, 'crouch');
    f.guardPose = false;
  }

  standUp(f) {
    this.dj.rigs[f.p].stop(0.15);
    this.setState(f, 'idle');
    f.crouching = false;
    f.guardPose = false;
  }

  enterGuard(f) {
    this.play(f, 'fblock_center', { hold: true, rootMotion: false, fadeIn: 0.06, timeScale: 1.6 });
    this.setState(f, 'guard');
    f.guardPose = true;
  }

  /* ================= commands ================= */

  tryCommand(f, o, inp, dir) {
    const has = (b) => inp.pressed.has(b);
    if (!inp.pressed.size) return false;
    const dist = this.dist();
    // Super: meter + button (or all four)
    if ((has('super') || (has('lp') && has('hp') && has('lk') && has('hk'))) && f.meter >= 100) return this.doSuper(f, o);
    // Parry / hold
    if (has('parry')) return this.doParry(f, !!inp.down);
    // Throw: LP+LK or the throw button
    if (has('throw') || (has('lp') && has('lk'))) return this.tryThrow(f, o);
    // Two-button moves
    if (has('lp') && has('hp')) return this.doMove(f, o, inp.up ? 'leap_smash' : 'quad_punch');
    if (has('lk') && has('hk')) return this.doMove(f, o, 'snap_kicks');
    // Motion specials
    const punch = has('lp') || has('hp');
    const kick = has('lk') || has('hk');
    for (const sp of SPECIALS) {
      const ok = sp.button === 'p' ? punch : sp.button === 'k' ? kick : has(sp.button);
      if (ok && this.matchMotion(f, sp.motion)) {
        f.buf = [];
        return this.doMove(f, o, sp.move);
      }
    }
    const btn = ['hp', 'hk', 'lp', 'lk'].find(b => has(b));
    if (!btn) return false;
    // Sidestep and dash attacks
    if (this.time < f.ssUntil && (f.state === 'sidestep' || f.state === 'sidewalk' || this.time - f.t0 < 0.3)) return this.doMove(f, o, SS_MOVES[btn], { ssDir: f.ssDir });
    if (this.time < f.dashUntil && dir.includes('f')) return this.doMove(f, o, DASH_MOVES[btn]);
    if (f.state === 'dash') return this.doMove(f, o, DASH_MOVES[btn]);
    const v = dir.replace('u', '') || 'n';
    const key = NORMALS[btn][v] || NORMALS[btn][v.includes('d') ? 'd' : 'n'];
    return this.doMove(f, o, key);
  }

  matchMotion(f, motion) {
    const recent = f.buf.filter(b => this.time - b.t < 0.75);
    let j = 0;
    let lastT = -9;
    for (const b of recent) {
      const d = b.dir === 'u' || b.dir === 'uf' || b.dir === 'ub' ? 'u' : b.dir;
      if (d === motion[j]) { j++; lastT = b.t; if (j === motion.length) break; }
    }
    return j === motion.length && this.time - lastT < 0.3;
  }

  /**
   * Start an attack. Works out (from the mocap skeleton) where the striking limb
   * lands, aims the body so it lands on the opponent, and steps in or out so the
   * strike reaches exactly — then checks real contact at the impact frames.
   */
  doMove(f, o, key, opts = {}) {
    const def = MOVES[key];
    if (!def) return false;
    const id = 'mx_' + def.id;
    const rig = this.dj.rigs[f.p];
    const data = this.dj.mocap.get(id);
    const e = this.dj.mocap.byId[id];
    if (!data || !e || !rig.ready(id)) return false;
    const strikes = data.rm.strikes?.length ? data.rm.strikes : (e.hits || [0.5]).map(t => ({ t, x: 0, z: 90, hx: 0, hz: 90, y: 120, bone: 'RightHandMiddle1', side: 'c', height: 1.2 }));
    const S = rig.hipScale * rig.unitToWorld;
    const power = def.power || e.power || 2;
    const ts = def.speed || (def.super ? 1.1 : def.special ? 1.1 : [1, 1.25, 1.15, 1.05][power]);
    const startup = def.startup ?? (def.super ? 0.45 : def.special ? 0.36 : [0.2, 0.18, 0.24, 0.3][power]);
    const t0 = strikes[0].t;
    const from = Math.max(0, t0 - startup);
    const last = strikes[strikes.length - 1].t;
    const recover = def.recover ?? (def.super ? 0.5 : def.special ? 0.45 : [0.25, 0.22, 0.3, 0.4][power]);
    const dur = data.clip.duration;

    // Root travel: keep the clip's own steps, but cap marathon lunges
    const travelLen = data.rm.distance * S;
    const cap = def.travel ?? 0.9;
    const rmScale = travelLen > cap ? cap / travelLen : 1;

    // Where the first strike lands relative to where we start (world m, +Z forward).
    // Only the travel after `from` happens — the wind-up before it is skipped.
    const s0 = strikes[0];
    const rm = data.rm;
    const tfx = rm.pt?.length ? sample(rm.pt, rm.px, from) : 0;
    const tfz = rm.pt?.length ? sample(rm.pt, rm.pz, from) : 0;
    const px = (s0.hx + (s0.x - s0.hx - tfx) * rmScale) * S;
    const pz = (s0.hz + (s0.z - s0.hz - tfz) * rmScale) * S;
    const reach = Math.hypot(px, pz);
    // turn the body so that limb lands on the opponent (even if the clip throws it sideways)
    const aimOff = reach > 0.25 ? -Math.atan2(px, pz) : 0;

    // Step in / out so the strike meets the body
    const opp = this.toOpp(f);
    const d = this.dist();
    const want = reach + BODY_R * 0.4;
    const lunge = def.lunge ?? 0.45;
    const adjust = def.projectile ? 0 : THREE.MathUtils.clamp(d - want, -0.35, lunge);
    const tHit = (t0 - from) / ts;

    rig.play(id, { rootMotion: !def.air, rmScale, from, to: Math.min(dur, last + recover + 0.35), fadeIn: 0.05, fadeOut: 0.2, timeScale: ts });
    this.setState(f, def.air ? 'airattack' : 'attack', this.time + (last - from + recover) / ts);
    f.mv = {
      key, def, id, e, power, ts, from, strikes,
      hits: strikes.map(s => ({ t: s.t, s, done: false })),
      reach, start: this.time,
      ch: this.time + (t0 + 0.05 - from) / ts,           // counter-hit window ends
      lastHitAt: this.time + (last - from) / ts,
      level: def.level || this.levelOf(s0),
      queued: null,
      connected: false,
      whiffed: false
    };
    f.yawTarget = aimOff;
    // linear moves only track briefly; homing ones until impact
    f.lockAim = false;
    f.trackUntil = this.time + tHit * (def.homing ? 1 : 0.3);
    if (!def.air && Math.abs(adjust) > 0.02 && tHit > 0.01) {
      f.vel.set(opp.x * adjust / tHit, opp.y * adjust / tHit);
      f.velUntil = this.time + tHit;
    }
    if (def.invuln) f.invulnUntil = this.time + def.invuln;
    if (def.super) f.invulnUntil = this.time + tHit;   // armoured start-up
    this.sound('whoosh', 0.6 + power * 0.15);
    if (def.special || def.super) this.popText(f.p, def.name.toUpperCase() + '!', def.super ? '#ffd23a' : '#7fe0ff', true);
    return true;
  }

  levelOf(s) {
    if (!s) return 'mid';
    if (s.height < 0.6) return 'low';
    if (s.height > 1.38) return 'high';
    return 'mid';
  }

  airAttack(f, o, btn) {
    const key = { lp: 'air_lp', hp: 'air_hp', lk: 'air_lk', hk: 'air_hk' }[btn];
    const def = MOVES[key];
    const id = 'mx_' + def.id;
    const data = this.dj.mocap.get(id);
    const rig = this.dj.rigs[f.p];
    if (!data || !rig.ready(id)) return false;
    const strikes = data.rm.strikes?.length ? data.rm.strikes : [{ t: (data.entry.hits || [0.4])[0], hx: 0, hz: 90, x: 0, z: 90, bone: 'RightToeBase', side: 'c', height: 1.2 }];
    const t0 = strikes[0].t;
    const from = Math.max(0, t0 - 0.2);
    const ts = 1.2;
    const S = rig.hipScale * rig.unitToWorld;
    rig.play(id, { rootMotion: false, from, to: Math.min(data.clip.duration, strikes[strikes.length - 1].t + 0.45), fadeIn: 0.05, fadeOut: 0.15, timeScale: ts });
    this.setState(f, 'airattack', this.time + 2);
    f.airAttacked = true;
    f.mv = {
      key, def, id, e: data.entry, power: def.power, ts, from, strikes,
      hits: strikes.map(s => ({ t: s.t, s, done: false })),
      reach: Math.hypot(strikes[0].hx, strikes[0].hz) * S,
      start: this.time, ch: this.time + 0.2, lastHitAt: this.time + (strikes[strikes.length - 1].t - from) / ts,
      level: 'mid', queued: null, connected: false
    };
    f.yawTarget = THREE.MathUtils.clamp(-Math.atan2(strikes[0].hx, strikes[0].hz), -1.3, 1.3);
    f.trackUntil = this.time + 0.1;
    this.sound('whoosh', 0.8);
    return true;
  }

  tickAttack(f, o, inp) {
    const mv = f.mv;
    if (!mv) { this.toIdle(f); return; }
    if (this.time > f.trackUntil) f.lockAim = true;
    // Strings: buffer the next button, fire it once this move's last hit has gone out
    if (inp.pressed.size && mv.def.chains && !mv.queued) {
      const b = ['lp', 'hp', 'lk', 'hk'].find(x => inp.pressed.has(x));
      if (b && mv.def.chains[b] && this.time > mv.start + 0.05) mv.queued = mv.def.chains[b];
    }
    if (mv.queued && this.time >= mv.lastHitAt + 0.04) {
      const next = mv.queued;
      mv.queued = null;
      f.lockAim = false;
      if (this.doMove(f, o, next)) return;
    }
    if (f.state === 'airattack') return;   // ends on landing
    if (this.time >= f.until + (mv.whiffed && !mv.connected ? 0.12 : 0)) this.toIdle(f);
  }

  /** Current clip time of f's attack (or -1 if it isn't playing) */
  clipTime(f) {
    const o = this.dj.rigs[f.p].oneShot;
    if (!o || !f.mv || o.id !== f.mv.id) return -1;
    return o.a.action.time;
  }

  /* ================= contact ================= */

  checkContacts(f, o) {
    const mv = f.mv;
    if (!mv || !['attack', 'airattack'].includes(f.state)) return;
    const ct = this.clipTime(f);
    if (ct < 0) return;
    for (let i = 0; i < mv.hits.length; i++) {
      const h = mv.hits[i];
      if (h.done) continue;
      if (mv.def.projectile) {
        if (ct >= h.t) { h.done = true; this.fireShot(f, o, mv, i); }
        continue;
      }
      const start = h.t - 0.09;
      const end = h.t + 0.06;
      if (ct < start) break;
      if (ct > end) { h.done = true; mv.whiffed = true; continue; }
      const point = this.strikeContact(f, o, h.s, mv);
      if (point) {
        h.done = true;
        this.resolveContact(f, o, mv, i, point);
      }
    }
  }

  /**
   * Does the striking body part touch the opponent's body right now?
   * Returns the contact point or null.
   */
  strikeContact(f, o, s, mv) {
    if (['thrown', 'grabbed', 'ko', 'falling'].includes(o.state)) return null;
    if (o.state === 'down' && !mv.def.ground && mv.level !== 'low') return null;
    const eff = this.bonePos(f.p, s.bone);
    const B = this.body(o.p);
    // touching means the fist / foot meets the body surface (a little leeway for big
    // swings and for airborne bodies, which tumble fast)
    const reachPad = LIMB_R + 0.03 + (mv.power >= 3 ? 0.03 : 0) + (o.state === 'air' ? 0.1 : 0) + (mv.level === 'low' ? 0.06 : 0) + (mv.def.reach ? mv.def.reach - 1 : 0);
    const segs = [
      [B.head, B.chest, 0.11], [B.chest, B.hips, BODY_R], [B.hips, B.lk, 0.1], [B.lk, B.lf, 0.08], [B.hips, B.rk, 0.1], [B.rk, B.rf, 0.08],
      [B.lf, B.lt, 0.06], [B.rf, B.rt, 0.06]
    ];
    for (const [a, b, r] of segs) {
      if (segDist(eff, a, b) < r + reachPad) return eff.clone();
    }
    return null;
  }

  body(p) {
    return {
      head: this.bonePos(p, 'Head'),
      chest: this.bonePos(p, 'Spine2'),
      hips: this.bonePos(p, 'Hips'),
      lk: this.bonePos(p, 'LeftLeg'),
      rk: this.bonePos(p, 'RightLeg'),
      lf: this.bonePos(p, 'LeftFoot'),
      rf: this.bonePos(p, 'RightFoot'),
      lt: this.bonePos(p, 'LeftToeBase'),
      rt: this.bonePos(p, 'RightToeBase')
    };
  }

  /** A strike reached the body: parry, guard, or hit */
  resolveContact(f, o, mv, i, point, shot = null) {
    if (!this.roundLive || o.state === 'ko') return;
    const def = mv.def;
    const level = shot ? shot.level : mv.level;
    const power = def.super ? 3 : mv.power;
    const last = shot ? true : i === mv.hits.length - 1;
    if (this.time < o.invulnUntil) return;
    // highs sail over crouchers, lows under jumpers
    if (level === 'high' && o.crouching) return;
    if (level === 'low' && ['jump', 'airattack'].includes(o.state) && o.air && o.air.y > 0.15) return;

    // ---- Parry / hold (beats strikes; loses to throws)
    if (o.state === 'parry' && this.time - o.t0 < 0.34 && this.time - o.t0 > 0.02 && ((level === 'low') === !!o.parryLow)) {
      return this.reversal(o, f, point, shot);
    }

    // ---- Guard
    const canGuard = ['idle', 'walk', 'guard', 'crouch', 'blockstun', 'sidewalk'].includes(o.state);
    const standGuard = canGuard && !o.crouching && (o.guardHeld || o.holdBack || o.state === 'guard' || (o.state === 'blockstun' && !o.blockLow));
    const crouchGuard = canGuard && o.crouching && (o.guardHeld || o.holdBack || o.state === 'blockstun');
    const blocked = !def.unblockable && ((standGuard && level !== 'low') || (crouchGuard && level === 'low'));
    const away = this.toOpp(f);
    if (blocked) {
      this.setState(o, 'blockstun', this.time + 0.16 + power * 0.07);
      o.blockLow = level === 'low';
      this.play(o, o.blockLow ? 'fblock_low' : (power >= 2 ? 'fblock_react' : 'fblock_center'), { from: o.blockLow ? 0.05 : 0, rootMotion: false, fadeIn: 0.03, fadeOut: 0.2, timeScale: 1.5, hold: o.blockLow });
      this.push(o, away, 0.12 + power * 0.07, 0.14);
      this.push(f, away, -0.05 * power, 0.1);
      this.hitstopUntil = (this.realTime || 0) + 0.04 + power * 0.01;
      this.spark(point, 0x66ccff, 0.5 + power * 0.15);
      this.sound('block', 0.8 + power * 0.1);
      this.shake = Math.max(this.shake, 0.015 * power);
      f.meter = Math.min(100, f.meter + 1);
      o.meter = Math.min(100, o.meter + 2);
      mv.blocked = true;
      if (shot && power >= 3) o.hp = Math.max(1, o.hp - 2);   // energy attacks chip
      this.syncHp();
      return;
    }

    // ---- Clean hit
    const counter = ['attack', 'airattack'].includes(o.state) && o.mv && this.time < o.mv.ch;
    const whiffPunish = o.state === 'attack' && o.mv && this.time > o.mv.lastHitAt;
    const juggled = o.state === 'air';
    const onGround = o.state === 'down';
    let dmg = (def.dmg ?? DMG[power]) * (def.special ? 1.2 : 1) * (def.super ? 0.75 : 1) * (mv.hits.length > 1 && !last ? 0.7 : 1);
    if (counter) dmg *= 1.3;
    if (juggled) dmg *= 0.75 * Math.pow(0.88, o.juggle);
    if (onGround) dmg *= 0.5;
    if (f.combo > 0 && !juggled) dmg *= Math.pow(0.9, f.combo);
    dmg = Math.max(1, Math.round(dmg));
    o.hp = Math.max(0, o.hp - dmg);
    f.combo++;
    f.comboDmg += dmg;
    mv.connected = true;
    f.meter = Math.min(100, f.meter + 2 + power * 2);
    o.meter = Math.min(100, o.meter + 2);
    this.syncHp();

    // impact feel
    const big = power >= 3 || counter;
    this.spark(point, counter ? 0xff4a3a : power >= 3 ? 0xffd04a : 0xfff2c0, 0.55 + power * 0.25 + (counter ? 0.4 : 0));
    this.sound(big ? 'heavy' : 'punch', 0.8 + power * 0.15);
    this.shake = Math.max(this.shake, 0.03 + power * 0.03 + (counter ? 0.04 : 0));
    this.hitstopUntil = (this.realTime || 0) + 0.045 + power * 0.025 + (counter ? 0.04 : 0);
    if (counter) this.popText(f.p, 'COUNTER HIT', '#ff5a4a', true);
    else if (whiffPunish && power >= 2) this.popText(f.p, 'PUNISH', '#ffb03a');

    if (o.hp <= 0) return this.knockOut(o, f, mv, away);

    // ---- what the hit does
    if (onGround) {
      // ground hit: a bounce, stay down a little longer
      o.until = Math.max(o.until, this.time + 0.5);
      o.downBounce = 0.12;
      this.popText(f.p, 'GROUND HIT', '#ffcf3a');
      return;
    }
    const launch = (def.launch && last) || (def.chLaunch && counter && last);
    if (juggled || launch) return this.launch(o, f, away, juggled ? Math.max(2.2, 3.8 - o.juggle * 0.45) : (def.super ? 5 : 4.6), !juggled);
    if ((def.crumple && last) || (def.chCrumple && counter && last)) return this.crumple(o, f);
    if ((def.stun && last) || (counter && power >= 3 && !def.knockdown)) return this.stun(o, f, away);
    const knockdown = (def.knockdown && last) || (def.chKnockdown && counter && last) || (def.super && last);
    if (knockdown) return this.knockDown(o, f, mv, away);
    this.hitReact(o, f, mv, i, away, level, power, counter);
  }

  /** Code-driven slide along `dir` (world), total `dist` m over `secs` */
  push(f, dir, dist, secs) {
    f.vel.set(dir.x * dist / secs, dir.y * dist / secs);
    f.velUntil = this.time + secs;
  }

  hitReact(o, f, mv, i, away, level, power, counter) {
    const s = mv.hits[i]?.s;
    const side = s?.side || 'c';
    const pick = (arr) => arr[Math.floor(this.rng() * arr.length)];
    let clip;
    if (level === 'high') {
      if (power <= 1) clip = pick([`fhit_head_light_${side}`, side === 'l' ? 'fhit_small_left' : side === 'r' ? 'fhit_small_right' : 'fhit_head_light_c']);
      else if (power === 2) clip = `fhit_head_med_${side}`;
      else clip = pick([`fhit_head_big_${side}`, side === 'l' ? 'fhit_large_left' : side === 'r' ? 'fhit_large_right' : 'fhit_taking_punch']);
    } else if (level === 'mid') {
      if (power <= 1) clip = pick(['fhit_body_straight', side === 'r' ? 'fhit_kidney' : 'fhit_rib']);
      else if (power === 2) clip = pick(['fhit_stomach', 'fhit_side', 'fhit_body_punch']);
      else clip = pick(['fhit_stomach_big', side === 'r' ? 'fhit_kidney_big' : 'fhit_rib_big', 'fhit_side_big', 'fhit_body_blow']);
    } else {
      clip = power >= 2 ? 'fhit_shove' : 'fhit_small_front';
    }
    const data = this.dj.mocap.get('mx_' + clip);
    const onset = data?.rm.onset || 0;
    this.play(o, clip, { from: onset, rootMotion: true, rmScale: 0.5, fadeIn: 0.03, fadeOut: 0.25, timeScale: power >= 3 ? 1.05 : 1.2 });
    const stun = 0.3 + power * 0.1 + (counter ? 0.15 : 0);
    this.setState(o, 'hitstun', this.time + stun);
    o.mv = null;
    o.yawTarget = 0;
    o.crouching = false;
    // multi-hit moves keep them close until the last blow
    const lastHit = !mv.hits || i >= mv.hits.length - 1;
    if (lastHit) this.push(o, away, (mv.def.push ?? 0) + 0.1 + power * 0.08, 0.16);
    else { o.vel.set(0, 0); o.until = Math.max(o.until, this.time + 0.45); }
  }

  stun(o, f, away) {
    this.play(o, this.rng() < 0.5 ? 'fhit_shove_spin' : 'fight_dizzy', { from: 0, rootMotion: false, fadeIn: 0.05, fadeOut: 0.3, timeScale: 1.1 });
    this.setState(o, 'stun', this.time + 0.95);
    o.mv = null;
    this.push(o, away, 0.2, 0.2);
    this.popText(o.p, 'STUNNED', '#c77dff', true);
  }

  crumple(o, f) {
    // slow fold to the floor; hittable on the way down (follow up or launch)
    const data = this.dj.mocap.get('mx_fall_liver');
    this.play(o, 'fall_liver', { from: data?.rm.onset || 0, rootMotion: true, rmScale: 0.4, hold: true, fadeIn: 0.05, timeScale: 1.0 });
    this.setState(o, 'crumple', this.time + 1.0);
    o.mv = null;
    o.crumpled = true;
    this.popText(o.p, 'CRUMPLE', '#ff9a3a', true);
    this.wait(1.0).then(() => {
      if (!this.matchActive || o.state !== 'crumple' || !o.crumpled) return;
      o.crumpled = false;
      this.goDown(o, 'fall_liver', 'stomach');
    }, () => {});
  }

  knockDown(o, f, mv, away) {
    const lowHit = mv.level === 'low';
    const clip = lowHit ? 'sweep_fall' : mv.level === 'mid' ? (this.rng() < 0.5 ? 'fall_knocked_stomach' : 'fight_knockdown') : (this.rng() < 0.5 ? 'fall_stumble_back' : 'fhit_flip_back');
    const data = this.dj.mocap.get('mx_' + clip);
    this.play(o, clip, { from: data?.rm.onset || 0, rootMotion: true, rmScale: 0.6, hold: true, fadeIn: 0.04, timeScale: 1.25 });
    this.setState(o, 'falling');
    o.mv = null;
    this.push(o, away, 0.5, 0.35);
    this.shake = 0.12;
    this.sound('thud', 0.7);
    this.popText(f.p, 'DOWN!', '#ff7b3a', true);
    const face = /stomach|knocked_down|flip_back/.test(clip) ? 'stomach' : 'back';
    const prof = this.hipProfile('mx_' + clip, data?.rm.onset || 0);
    const t = prof ? Math.max(0.3, (prof.land - (data?.rm.onset || 0)) / 1.25) : 0.9;
    o.until = this.time + t;
    this.wait(t).then(() => { if (this.matchActive && o.state === 'falling') this.goDown(o, clip, face); }, () => {});
  }

  /** Lying on the floor */
  goDown(o, clip, face) {
    this.setState(o, 'down', 0);
    o.downFace = face;
    o.downAt = this.time;
    o.downClip = clip;
    o.crouching = false;
    o.lockAim = true;
    this.sound('thud', 0.6);
    this.shake = Math.max(this.shake, 0.08);
  }

  tickDown(o, f, inp) {
    const t = this.time - o.downAt;
    if (o.downBounce) { o.downBounce = 0; }
    const wantsUp = inp.pressed.size || inp.x || inp.up || inp.down;
    if ((t > 0.45 && wantsUp) || t > 1.5) this.getUp(o, inp);
  }

  getUp(f, inp = {}) {
    const rig = this.dj.rigs[f.p];
    const fwd = inp.x && this.f && (Math.sign(inp.x) * Math.sign(this.camRight.x * this.toOpp(f).x + this.camRight.y * this.toOpp(f).y)) > 0;
    let id;
    if (fwd && f.downFace === 'back') id = 'mx_getup_kip';
    else id = f.downFace === 'stomach' ? 'mx_getup_stomach' : 'mx_getup_back';
    if (!rig.ready(id)) id = 'mx_getup_knockdown';
    const ts = id === 'mx_getup_kip' ? 1.3 : id === 'mx_getup_stomach' ? 2.2 : 1.7;
    const prof = this.hipProfile(id);
    const from = prof ? Math.max(0, prof.rise - 0.35) : 0;
    rig.play(id, { rootMotion: true, rmScale: 0.4, from, fadeIn: 0.15, fadeOut: 0.3, timeScale: ts });
    const dur = this.dj.mocap.get(id)?.clip.duration || 3;
    this.setState(f, 'getup', this.time + Math.max(0.35, (dur - from) / ts - 0.25));
    f.invulnUntil = f.until + 0.1;
    f.lockAim = false;
  }

  /** Airborne victim (launch / juggle) */
  launch(o, f, away, vy, fresh) {
    const clip = 'fko_flying_back';
    const data = this.dj.mocap.get('mx_' + clip);
    const airtime = (2 * vy) / GRAV;
    if (fresh || o.state !== 'air') {
      // time the clip so it lands when the arc does
      const prof = this.hipProfile('mx_' + clip, 0.3);
      const onset = data?.rm.onset || 0;
      const landT = prof ? prof.land : (data?.clip.duration || 2) * 0.6;
      const ts = THREE.MathUtils.clamp((landT - onset) / (airtime + (o.air?.y || 0) / 4), 0.5, 2.5);
      this.play(o, clip, { from: onset, rootMotion: false, hold: true, fadeIn: 0.04, timeScale: ts });
      o.juggle = 0;
      this.popText(f.p, 'LAUNCH!', '#ffd23a', true);
    } else {
      o.juggle++;
    }
    this.setState(o, 'air');
    o.mv = null;
    o.crouching = false;
    o.air = { y: Math.max(0.05, o.air?.y || 0.05), vy, pre: 0 };
    const kb = fresh ? 0.45 : 0.3;
    o.vel.set(away.x * kb, away.y * kb);
    o.velUntil = this.time + airtime;
    o.lockAim = true;
    this.hitstopUntil = (this.realTime || 0) + 0.11;
  }

  juggleLand(o, f) {
    o.vel.set(0, 0);
    // tech roll: guard / parry pressed right as you land
    const techWin = o.inp && (o.inp.guard || o.inp.pressed?.has('parry'));
    const cpuTech = o.cpu && this.rng() < (DIFFICULTY[this.opts.difficulty] || DIFFICULTY.normal).tech;
    if ((techWin || cpuTech) && o.hp > 0) {
      const id = 'mx_roll_land';
      const data = this.dj.mocap.get(id);
      const prof = this.hipProfile(id, 0);
      const from = prof ? Math.max(0, prof.land - 0.1) : 0.5;
      this.dj.rigs[o.p].play(id, { from, rootMotion: true, rmScale: 0.5, fadeIn: 0.08, fadeOut: 0.25, timeScale: 1.4 });
      this.setState(o, 'getup', this.time + Math.max(0.4, ((data?.clip.duration || 1.5) - from) / 1.4 - 0.2));
      o.invulnUntil = o.until;
      o.lockAim = false;
      this.popText(o.p, 'TECH!', '#7fe0ff', true);
      this.sound('whoosh', 0.6);
      return;
    }
    this.goDown(o, 'fko_flying_back', 'back');
  }

  knockOut(o, f, mv, away) {
    this.roundLive = false;
    o.state = 'ko';
    o.hp = 0;
    o.mv = null;
    this.syncHp();
    const kick = /kick|armada|meia|knee|martelo|chapa|sweep/.test(mv?.id || '');
    const clip = kick || (mv?.power >= 3) ? (this.rng() < 0.5 ? 'fko_flying_back' : 'fko_dying_back') : (this.rng() < 0.5 ? 'fko_falling_back' : 'fko_out_back');
    const data = this.dj.mocap.get('mx_' + clip);
    this.dj.rigs[o.p].play('mx_' + clip, { from: data?.rm.onset || 0, rootMotion: true, rmScale: 0.8, hold: true, fadeIn: 0.04 });
    this.push(o, away || this.toOpp(f), 0.6, 0.5);
    this.slowmo = 0.3;
    this.slowUntil = this.time + 0.6;
    this.shake = 0.22;
    this.sound('ko');
    this.banner('K.O.', 2.2, 'ko');
    this.dj.arena?.cheer(5);
    this.dj.triggerCameraFlashes?.(8);
    this.wins[f.p]++;
    this.updatePips();
    this.wait(1.4).then(() => {
      if (!this.matchActive) return;
      f.state = 'victory';
      f.mv = null;
      this.dj.rigs[f.p].play(this.rng() < 0.5 ? 'mx_fight_victory_boxing' : 'mx_fight_victory', { rootMotion: false, fadeIn: 0.3, fadeOut: 0.4 });
    }, () => {});
    this._roundResolve?.('ko');
  }

  timeOver() {
    if (!this.roundLive) return;
    this.roundLive = false;
    this.clockLeft = 0;
    const a = this.f[1].hp;
    const b = this.f[2].hp;
    this.banner('TIME!', 1.8, 'ko');
    this.sound('bell');
    if (a !== b) {
      const w = a > b ? 1 : 2;
      this.wins[w]++;
      this.updatePips();
      this.dj.rigs[w].play('mx_fight_victory_boxing', { rootMotion: false, fadeIn: 0.3, fadeOut: 0.4 });
      this.dj.rigs[w === 1 ? 2 : 1].play('mx_fight_defeat', { rootMotion: false, fadeIn: 0.3, fadeOut: 0.4 });
    }
    this._roundResolve?.('time');
  }

  /**
   * When a clip's hips hit the floor and when they start to rise again, read
   * from its hip-height track (the get-up clips spend seconds lying around first)
   */
  hipProfile(id, after = 0) {
    const key = `${id}@${after}`;
    this._hip = this._hip || {};
    if (key in this._hip) return this._hip[key];
    const d = this.dj.mocap.get(id);
    let res = null;
    if (d?.rm.hy) {
      const { ht: times, hy } = d.rm;
      let mn = Infinity;
      let mx = -Infinity;
      hy.forEach(y => { mn = Math.min(mn, y); mx = Math.max(mx, y); });
      const low = mn + 0.18 * (mx - mn);
      let land = times.findIndex((t, i) => t >= after && hy[i] <= low);
      if (land < 0) land = 0;
      let rise = land;
      while (rise < times.length - 1 && hy[rise] <= low) rise++;
      res = { land: times[land], rise: times[rise], duration: d.clip.duration };
    }
    this._hip[key] = res;
    return res;
  }

  /* ================= throws, parries, supers ================= */

  tryThrow(f, o) {
    const [aId, vId] = THROWS[Math.floor(this.rng() * THROWS.length)];
    const a = this.dj.mocap.get('mx_' + aId);
    if (!a) return false;
    // reach for them
    this.play(f, aId, { rootMotion: false, fadeIn: 0.05, fadeOut: 0.2, timeScale: 1.3, to: Math.min(a.clip.duration, 0.6) });
    this.setState(f, 'throwing', this.time + 0.55);
    f.mv = null;
    f.lockAim = false;
    this.wait(0.12).then(() => {
      if (!this.matchActive || f.state !== 'throwing' || !this.roundLive) return;
      const grabbable = ['idle', 'walk', 'guard', 'blockstun', 'sidewalk', 'hitstun', 'land', 'parry', 'dash', 'backdash'].includes(o.state) && !o.crouching;
      if (this.dist() < 1.05 && grabbable && this.time >= o.invulnUntil) this.grab(f, o, aId, vId);
      else { this.popText(f.p, 'MISS', '#9aa3b8'); f.until = this.time + 0.45; }   // whiffed: open to punishment
    }, () => {});
    return true;
  }

  grab(f, o, aId, vId) {
    this.setState(o, 'grabbed');
    o.breakUntil = this.time + 0.4;
    o.mv = null;
    o.crouching = false;
    this.setState(f, 'throwing', this.time + 0.5);
    this.dj.rigs[o.p].play('mx_fhit_shove', { rootMotion: false, fadeIn: 0.05, timeScale: 0.6, hold: true });
    this.popText(o.p, '!', '#ffffff', true);
    this.sound('block', 0.6);
    // CPU might break it
    if (o.cpu && this.rng() < (DIFFICULTY[this.opts.difficulty] || DIFFICULTY.normal).breakThrow) {
      this.wait(0.15 + this.rng() * 0.15).then(() => { if (o.state === 'grabbed') this.breakThrow(f, o); }, () => {});
    }
    this.wait(0.4).then(() => {
      if (!this.matchActive || o.state !== 'grabbed' || f.state !== 'throwing') return;
      this.doThrow(f, o, aId, vId);
    }, () => {});
  }

  breakThrow(f, o) {
    if (o.state !== 'grabbed') return;
    const away = this.toOpp(f);
    this.setState(o, 'hitstun', this.time + 0.35);
    this.setState(f, 'hitstun', this.time + 0.35);
    this.play(o, 'fhit_shove', { from: this.dj.mocap.get('mx_fhit_shove')?.rm.onset || 0, rootMotion: false, fadeIn: 0.04, fadeOut: 0.2 });
    this.play(f, 'fhit_shove', { from: this.dj.mocap.get('mx_fhit_shove')?.rm.onset || 0, rootMotion: false, fadeIn: 0.04, fadeOut: 0.2 });
    this.push(o, away, 0.45, 0.2);
    this.push(f, away, -0.45, 0.2);
    this.popText(o.p, 'BREAK!', '#7fe0ff', true);
    this.sound('block', 1);
  }

  doThrow(f, o, aId, vId) {
    const a = this.dj.mocap.get('mx_' + aId);
    const v = this.dj.mocap.get('mx_' + vId);
    const rigA = this.dj.rigs[f.p];
    const rigV = this.dj.rigs[o.p];
    if (!a || !v) return false;
    const stA = this.dj.characterStates[f.p];
    const stV = this.dj.characterStates[o.p];
    const A = this.pos(f.p);
    const s = rigA.hipScale * rigA.unitToWorld;
    // Skip the clips' long lead-in: start both a beat before the slam, aligned as they are then
    const vp = this.hipProfile('mx_' + vId, v.clip.duration * 0.5);
    const impactT = vp ? Math.min(vp.land, v.clip.duration * 0.62) : v.clip.duration * 0.62;
    const from = Math.max(0, impactT - 1.1);
    const rawAt = (rm, t) => {
      const x0 = rm.x0 + (rm.pt.length ? sample(rm.pt, rm.px, t) : 0);
      const z0 = rm.z0 + (rm.pt.length ? sample(rm.pt, rm.pz, t) : 0);
      const c = Math.cos(rm.h0);
      const sn = Math.sin(rm.h0);
      return { x: x0 * c + z0 * sn, z: -x0 * sn + z0 * c };
    };
    const yawAt = (rm, t) => (rm.rt.length ? sample(rm.rt, rm.yaw, t) : 0);
    const rawA = rawAt(a.rm, from);
    const rawV = rawAt(v.rm, from);
    const opp = this.toOpp(f);
    stA.facing = Math.atan2(opp.x, opp.y);
    const theta = stA.facing - (a.rm.h0 + yawAt(a.rm, from));
    const dx = (rawV.x - rawA.x) * s;
    const dz = (rawV.z - rawA.z) * s;
    const V = this.pos(o.p);
    V.x = A.x + dx * Math.cos(theta) + dz * Math.sin(theta);
    V.z = A.z - dx * Math.sin(theta) + dz * Math.cos(theta);
    stV.facing = theta + v.rm.h0 + yawAt(v.rm, from);
    const TS = 1.6;
    this.setState(f, 'throwing', this.time + (a.clip.duration * 0.85 - from) / TS);
    this.setState(o, 'thrown', this.time + 99);
    o.invulnUntil = this.time + 99;
    this.popText(f.p, 'THROW!', '#ff9a3a', true);
    rigA.play('mx_' + aId, { from, rootMotion: true, rmScale: 0.6, fadeIn: 0.1, fadeOut: 0.35, timeScale: TS });
    rigV.play('mx_' + vId, {
      from, rootMotion: true, rmScale: 0.6, hold: true, fadeIn: 0.1, timeScale: TS,
      onTime: [{
        t: impactT,
        fn: () => {
          this.shake = 0.16;
          this.hitstopUntil = (this.realTime || 0) + 0.1;
          this.sound('thud', 0.9);
          this.spark(this.bonePos(o.p, 'Hips'), 0xffd04a, 1.2);
          o.hp = Math.max(0, o.hp - 15);
          f.meter = Math.min(100, f.meter + 12);
          this.syncHp();
          if (o.hp <= 0) this.knockOut(o, f, { id: 'throw', power: 3 }, this.toOpp(f));
        }
      }]
    });
    const cut = (Math.min(v.clip.duration, (vp ? vp.land : v.clip.duration) + 0.45) - from) / TS;
    this.wait(cut).then(() => {
      if (!this.matchActive || o.state === 'ko') return;
      o.invulnUntil = 0;
      this.goDown(o, vId, 'back');
      o.downAt = this.time - 0.2;
    }, () => {});
    return true;
  }

  doParry(f, low) {
    this.play(f, low ? 'fblock_low' : 'fight_block_inward', { from: 0, rootMotion: false, fadeIn: 0.04, fadeOut: 0.2, timeScale: 1.7 });
    this.setState(f, 'parry', this.time + 0.55);
    f.parryLow = low;
    f.mv = null;
    return true;
  }

  /** Parried: the attacker is thrown off balance and eats an automatic counter */
  reversal(defender, attacker, point, shot) {
    this.spark(point || this.bonePos(defender.p, 'Spine2'), 0xffffff, 1.6);
    this.sound('block', 1.2);
    this.sound('heavy', 0.6);
    this.hitstopUntil = (this.realTime || 0) + 0.15;
    this.shake = 0.1;
    this.banner('REVERSAL!', 0.9, 'fight');
    defender.meter = Math.min(100, defender.meter + 10);
    if (shot) { shot.life = 99; this.toIdle(defender); return; }
    this.play(attacker, 'fhit_large_left', { from: this.dj.mocap.get('mx_fhit_large_left')?.rm.onset || 0, rootMotion: false, fadeIn: 0.04, fadeOut: 0.3 });
    this.setState(attacker, 'stun', this.time + 0.9);
    attacker.mv = null;
    attacker.lockAim = false;
    this.push(attacker, this.toOpp(defender), 0.2, 0.15);
    this.setState(defender, 'idle');
    this.wait(0.1).then(() => {
      if (this.matchActive && defender.state === 'idle' && this.roundLive) this.doMove(defender, attacker, 'reversal');
    }, () => {});
  }

  doSuper(f, o) {
    f.meter = 0;
    const far = this.dist() > 1.8;
    const key = far ? 'super_beam' : (this.rng() < 0.5 ? 'super_rush' : 'super_knees');
    this.banner('SUPER!', 1.1, 'fight');
    this.slowmo = 0.35;
    this.slowUntil = this.time + 0.3;
    this.flash();
    this.sound('fireball');
    this.superCam = { p: f.p, until: this.time + 0.55 };
    return this.doMove(f, o, key);
  }

  flash() {
    const el = document.createElement('div');
    el.className = 'fight-flash';
    this.hud?.appendChild(el);
    setTimeout(() => el.remove(), 450);
  }

  /* ================= projectiles ================= */

  fireShot(f, o, mv, i) {
    const kind = mv.def.projectile;
    const s = mv.hits[i].s;
    const from = this.bonePos(f.p, s?.bone || 'RightHand');
    const color = f.p === 1 ? 0xff6a3a : 0x5ad8ff;
    const mat = new THREE.SpriteMaterial({ map: this.glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
    const sprite = new THREE.Sprite(mat);
    const dir = this.toOpp(f).clone();
    const shot = { sprite, mat, owner: f.p, kind, life: 0, dir, mv, level: mv.def.level || 'mid', pos: new THREE.Vector3() };
    if (kind === 'shockwave') {
      // a ring along the floor
      shot.pos.set(this.pos(f.p).x, 0.15, this.pos(f.p).z);
      shot.radius = 0.2;
      sprite.scale.set(0.6, 0.25, 1);
    } else {
      shot.pos.set(from.x, Math.max(0.9, from.y), from.z);
      sprite.scale.setScalar(kind === 'beam' ? 0.7 : 0.5);
      sprite.add(new THREE.PointLight(color, 6, 4, 2));
    }
    sprite.position.copy(shot.pos);
    this.dj.scene.add(sprite);
    this.sound('fireball');
    this.shots.push(shot);
  }

  updateShots(gdt) {
    this.shots = this.shots.filter(s => {
      s.life += gdt;
      if (s.life > 2.6) return this.killShot(s);
      const tp = s.owner === 1 ? 2 : 1;
      const target = this.f[tp];
      if (s.kind === 'shockwave') {
        s.radius += gdt * 5;
        s.sprite.scale.set(s.radius * 2, 0.3, 1);
        s.mat.opacity = Math.max(0, 1 - s.radius / 3);
        const T = this.pos(tp);
        const C = this.pos(s.owner);
        const d = Math.hypot(T.x - s.pos.x, T.z - s.pos.z);
        if (!s.hitDone && Math.abs(d - s.radius) < 0.25 && this.roundLive && !(target.air && target.air.y > 0.1) && C) {
          s.hitDone = true;
          this.resolveContact(this.f[s.owner], target, s.mv, 0, this.bonePos(tp, 'LeftFoot'), s);
        }
        return s.radius < 3 || this.killShot(s);
      }
      const speed = s.kind === 'beam' ? 7 : 5;
      s.pos.x += s.dir.x * speed * gdt;
      s.pos.z += s.dir.y * speed * gdt;
      s.sprite.position.copy(s.pos);
      s.mat.rotation += gdt * 8;
      s.sprite.scale.setScalar((s.kind === 'beam' ? 0.7 : 0.5) + Math.sin(s.life * 30) * 0.06);
      // Clash with the other side's shots
      const clash = this.shots.find(t => t !== s && t.owner !== s.owner && t.kind !== 'shockwave' && t.pos.distanceTo(s.pos) < 0.35);
      if (clash) {
        this.spark(s.pos.clone(), 0xffffff, 1.2);
        clash.life = 99;
        return this.killShot(s);
      }
      // Real contact with the body
      const B = this.body(tp);
      const r = 0.32;
      if (this.roundLive && !['thrown', 'grabbed', 'ko', 'down'].includes(target.state) &&
          (segDist(s.pos, B.head, B.chest) < r || segDist(s.pos, B.chest, B.hips) < r + 0.05 || segDist(s.pos, B.hips, B.lk) < r - 0.05)) {
        if (s.level === 'high' && target.crouching) return true;
        this.resolveContact(this.f[s.owner], target, s.mv, 0, s.pos.clone(), s);
        if (s.kind !== 'beam' || s.life > 1.5) return this.killShot(s);
        s.pierce = (s.pierce || 0) + 1;
        if (s.pierce > 2) return this.killShot(s);
      }
      const P = s.pos;
      if (Math.hypot((P.x - ARENA.cx) / (ARENA.rx + 1.5), (P.z - ARENA.cz) / (ARENA.rz + 2.5)) > 1) return this.killShot(s);
      return true;
    });
  }

  killShot(s) {
    this.dj.scene.remove(s.sprite);
    s.mat.dispose();
    return false;
  }

  /* ================= CPU ================= */

  /** CPU input in the same shape as readInput (works in "toward / away" terms) */
  aiInput(p) {
    const f = this.f[p];
    const o = this.other(f);
    const D = DIFFICULTY[this.opts.difficulty] || DIFFICULTY.normal;
    const inp = { x: 0, up: false, down: false, guard: false, pressed: new Set(), upTap: false, downTap: false, upHold: false, downHold: false };
    if (!this.roundLive) return inp;
    const opp = this.toOpp(f);
    const screenSide = Math.sign(this.camRight.x * opp.x + this.camRight.y * opp.y) || 1;
    const toward = (rel) => rel * screenSide;
    const dist = this.dist();
    const R = (x) => this.rng() < x;

    // Continue a held plan (walk, guard, crouch...)
    if (f.ai.hold && this.time < f.ai.holdUntil) {
      const h = f.ai.hold;
      inp.x = toward(h.rel || 0);
      inp.down = inp.downHold = !!h.down;
      inp.guard = !!h.guard;
    } else f.ai.hold = null;

    // In a string: maybe continue it
    if (f.state === 'attack' && f.mv?.def.chains && !f.mv.queued && !f.ai.chainTried && this.time > f.mv.start + 0.08) {
      f.ai.chainTried = true;
      if (R(D.combo * (f.mv.connected || f.mv.blocked ? 1 : 0.4))) {
        const opts = Object.keys(f.mv.def.chains);
        inp.pressed.add(opts[Math.floor(this.rng() * opts.length)]);
      }
      return inp;
    }
    if (f.state !== 'attack') f.ai.chainTried = false;

    // Juggle: chase and hit them while they're in the air
    if (o.state === 'air' && f.state !== 'attack' && R(D.juggle)) {
      if (dist > 1.1 && this.isFree(f)) { inp.x = toward(1); if (!f.ai.dashed) { f.ai.dashed = true; this.dash(f, 'f'); } return inp; }
      if (this.isFree(f) || f.state === 'dash') { inp.pressed.add(this.rng() < 0.5 ? 'lp' : 'hp'); f.ai.dashed = false; return inp; }
    }

    // Down on the floor: get up with some variety
    if (f.state === 'down') { if (this.time - f.downAt > 0.5 + this.rng() * 0.8) inp.pressed.add('lk'); return inp; }

    if (this.time < f.ai.next) return inp;
    f.ai.next = this.time + D.react * (0.7 + this.rng() * 0.6);
    if (!this.isFree(f)) return inp;

    // Defence: they're swinging
    const threat = this.threatened(f, o);
    if (threat && o.mv && R(D.block)) {
      const lvl = o.mv.level;
      const read = R(D.read);
      const linear = !o.mv.def.homing;
      if (linear && R(D.step)) { if (R(0.5)) inp.upPress = true; else inp.downTap = true; return inp; }
      if (R(D.parry)) { inp.pressed.add('parry'); if (lvl === 'low' && read) inp.down = true; return inp; }
      const low = read ? lvl === 'low' : R(0.3);
      f.ai.hold = { rel: -1, down: low, guard: true };
      f.ai.holdUntil = this.time + 0.45;
      inp.guard = true;
      inp.x = toward(-1);
      inp.down = inp.downHold = low;
      return inp;
    }
    // Punish: they whiffed or got blocked and are recovering
    if (o.state === 'attack' && o.mv && this.time > o.mv.lastHitAt && dist < 1.4 && R(D.punish)) {
      inp.pressed.add(o.mv.power >= 3 ? 'hp' : 'lp');
      if (o.mv.power >= 3 && R(0.5)) { inp.down = inp.downHold = true; inp.x = toward(1); }   // launcher
      return inp;
    }
    // They're down: ground hit or back off
    if (o.state === 'down') {
      if (dist < 1.3 && R(0.35)) { inp.pressed.add('lk'); inp.down = inp.downHold = true; inp.x = toward(-1); return inp; }
      f.ai.hold = { rel: dist < 1.5 ? -1 : 0 };
      f.ai.holdUntil = this.time + 0.4;
      return inp;
    }
    if ((o.state === 'stun' || o.state === 'crumple') && dist < 1.5) { inp.pressed.add('hp'); inp.down = inp.downHold = true; inp.x = toward(1); return inp; }

    if (f.meter >= 100 && R(0.5)) { inp.pressed.add('super'); return inp; }

    // Neutral
    if (dist > 2.6) {
      if (R(D.special * 2)) { this.doMove(f, o, R(0.5) ? 'energy_blast' : 'palm_blast'); return inp; }
      if (R(0.25)) { this.dash(f, 'f'); return inp; }
      f.ai.hold = { rel: 1 };
      f.ai.holdUntil = this.time + 0.4 + this.rng() * 0.4;
      return inp;
    }
    if (R(D.step * 0.6)) { if (R(0.5)) inp.upPress = true; else inp.downTap = true; return inp; }
    if (dist > 1.45) {
      if (R(D.special)) { this.doMove(f, o, ['hurricane', 'thrust_kick', 'spin_kick_adv', 'flying_knee'][Math.floor(this.rng() * 4)]); return inp; }
      if (R(0.18)) { this.dash(f, 'f'); return inp; }
      if (R(D.aggression * 0.4)) { inp.pressed.add(R(0.5) ? 'hk' : 'lk'); if (R(0.5)) inp.x = toward(1); return inp; }
      f.ai.hold = { rel: 1 };
      f.ai.holdUntil = this.time + 0.3;
      return inp;
    }
    // In range
    if (dist < 1.0 && R(0.08)) { inp.pressed.add('throw'); return inp; }
    if (R(D.aggression)) {
      const btn = ['lp', 'lp', 'hp', 'lk', 'hk'][Math.floor(this.rng() * 5)];
      inp.pressed.add(btn);
      const r = this.rng();
      if (r < 0.22) inp.x = toward(1);
      else if (r < 0.34) inp.x = toward(-1);
      else if (r < 0.5) { inp.down = inp.downHold = true; }
      else if (r < 0.6) { inp.down = inp.downHold = true; inp.x = toward(1); }
      if (R(D.special * 0.5)) { this.doMove(f, o, ['shoryu_elbow', 'rising_palm', 'martelo', 'thunder_clap'][Math.floor(this.rng() * 4)]); return { ...inp, pressed: new Set() }; }
      return inp;
    }
    // Bait / space
    f.ai.hold = { rel: R(0.5) ? -1 : 0, down: R(0.15), guard: R(0.4) };
    f.ai.holdUntil = this.time + 0.25 + this.rng() * 0.35;
    return inp;
  }

  /* ================= HUD & camera ================= */

  syncHp() {
    this.hp = { 1: this.f[1].hp, 2: this.f[2].hp };
  }

  buildHud() {
    super.buildHud();
    const bars = this.hud.querySelector('.fight-bars');
    bars.querySelector('.fight-vs').outerHTML = '<div class="fight-timer">99</div>';
    [1, 2].forEach(p => {
      const side = bars.querySelector(`.fight-side.p${p}`);
      side.insertAdjacentHTML('beforeend', `<div class="fight-pips">${Array.from({ length: this.need }, () => '<span class="pip"></span>').join('')}</div>
        <div class="fight-meter"><div class="fight-meter-fill"></div><span>SUPER</span></div>`);
    });
    this.hud.querySelector('.fight-skip').remove();
    this.hud.insertAdjacentHTML('beforeend', '<div class="fight-combo p1"></div><div class="fight-combo p2"></div>');
    this.hud.insertAdjacentHTML('beforeend', '<div class="fight-pause" hidden><div class="fight-pause-box"><h3>PAUSED</h3><button type="button" data-act="resume">Resume</button><button type="button" data-act="restart">Restart match</button><button type="button" data-act="quit">Quit to character select</button></div></div>');
    this.hud.querySelector('.fight-pause').addEventListener('click', (e) => {
      const act = e.target.dataset?.act;
      if (act === 'resume') this.setPaused(false);
      if (act === 'restart') { const o = this.opts; this.stop(true); this.startMatch(o); }
      if (act === 'quit') { this.stop(true); this.onQuit?.(); }
    });
    this.onPauseChange = (on) => { const el = this.hud?.querySelector('.fight-pause'); if (el) el.hidden = !on; };
    this.updatePips();
  }

  updateComboHud() {
    if (!this.hud) return;
    [1, 2].forEach(p => {
      const el = this.hud.querySelector(`.fight-combo.p${p}`);
      if (!el) return;
      const f = this.f[p];
      const show = f.combo >= 2;
      const txt = show ? `<b>${f.combo}</b> HITS<small>${f.comboDmg} DMG</small>` : '';
      if (el._txt !== txt) { el.innerHTML = txt; el._txt = txt; el.classList.toggle('show', show); }
    });
  }

  updatePips() {
    if (!this.hud) return;
    [1, 2].forEach(p => {
      this.hud.querySelectorAll(`.fight-side.p${p} .pip`).forEach((el, i) => el.classList.toggle('won', i < this.wins[p]));
    });
  }

  updateHud() {
    super.updateHud();
    if (!this.hud || !this.f) return;
    const t = this.hud.querySelector('.fight-timer');
    if (t) t.textContent = this.opts.roundTime >= 999 ? '∞' : String(Math.max(0, Math.ceil(this.clockLeft ?? this.opts.roundTime)));
    [1, 2].forEach(p => {
      const m = this.hud.querySelector(`.fight-side.p${p} .fight-meter`);
      if (!m) return;
      m.querySelector('.fight-meter-fill').style.transform = `scaleX(${this.f[p].meter / 100})`;
      m.classList.toggle('full', this.f[p].meter >= 100);
    });
  }

  /** Side-on to the fight axis (follows sidesteps), pulled in for supers */
  setFightCamera() {
    this.dj.cameraOverride = (camPos, target) => {
      const A = this.pos(1);
      const B = this.pos(2);
      const mx = (A.x + B.x) / 2;
      const mz = (A.z + B.z) / 2;
      const span = Math.hypot(B.x - A.x, B.z - A.z);
      const n = this.camN || new THREE.Vector2(0, 1);
      let dist = THREE.MathUtils.clamp(2.6 + span * 0.85, 3.0, 5.4);
      let ty = 1.0;
      let cx = mx;
      let cz = mz;
      const airY = Math.max(this.f?.[1]?.air?.y || 0, this.f?.[2]?.air?.y || 0);
      ty += airY * 0.4;
      if (this.superCam && this.time < this.superCam.until) {
        const P = this.pos(this.superCam.p);
        cx = P.x * 0.7 + mx * 0.3;
        cz = P.z * 0.7 + mz * 0.3;
        dist = 2.7;
      }
      camPos.set(cx + n.x * dist, 1.3 + span * 0.05 + airY * 0.3, cz + n.y * dist);
      // never inside a fighter: back off along the view line if one is too close
      [A, B].forEach(P => {
        const dx = camPos.x - P.x;
        const dz = camPos.z - P.z;
        const along = dx * n.x + dz * n.y;
        if (Math.hypot(dx, dz) < 1.8) { camPos.x += n.x * (1.8 - along); camPos.z += n.y * (1.8 - along); }
      });
      target.set(cx, ty, cz);
      if (this.shake > 0.002) {
        camPos.x += (Math.random() - 0.5) * this.shake;
        camPos.y += (Math.random() - 0.5) * this.shake;
      }
    };
  }
}

export { FightGame, MOVES, SPECIALS, KEYS, COMMAND_HELP, ARENA };
