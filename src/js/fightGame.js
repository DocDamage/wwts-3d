/**
 * Fight Game — a playable, Street-Fighter style fighting game on the 3D stage.
 *
 *  - Vs CPU (easy / normal / hard) or 2 players on one machine
 *  - Keyboard + gamepads; hold back to block, down to duck, up to jump
 *  - Four attack buttons (LP / HP / LK / HK) with direction variants, chain
 *    combos on hit, motion-input specials, a throw, a meter-powered super
 *  - Best-of rounds with a timer, knockdowns, K.O. slow-motion
 *
 * Fighters move on a line across the stage (2.5D). Animation comes from the
 * Mixamo clips; hits are resolved at each attack's measured impact frames.
 * Effects / HUD / sound come from FightDirector.
 */
import * as THREE from 'three';
import { FightDirector } from './fightDirector.js';
import { CAST_BY_KEY } from './fightCast.js';

const LINE_Z = 2.0;
const MIN_X = -2.9;
const MAX_X = 2.9;
const MIN_GAP = 0.62;
const WALK_FWD = 1.35;
const WALK_BACK = 1.05;
const MAX_HP = 100;
const BASE_DMG = { 1: 6, 2: 9, 3: 13 };

// Normal attacks: button -> held direction (n / f / b / d)
const MOVESET = {
  lp: { n: 'mx_fight_jab', f: 'mx_fight_jab_cross', b: 'mx_fight_hook_short', d: 'mx_fight_hook_body_short' },
  hp: { n: 'mx_fight_cross', f: 'mx_fight_hook_lead', b: 'mx_fight_uppercut_back', d: 'mx_fight_uppercut' },
  lk: { n: 'mx_fight_kick_low', f: 'mx_fight_kick_side', b: 'mx_fight_knee', d: 'mx_fight_sweep_front' },
  hk: { n: 'mx_fight_kick_roundhouse', f: 'mx_fight_kick_high', b: 'mx_fight_kick_spin_back', d: 'mx_fight_sweep_360' }
};

// Motion-input specials (directions relative to the opponent)
const SPECIALS = [
  { name: 'FIREBALL', motion: ['d', 'df', 'f'], button: 'p', move: 'mx_fight_hadouken', projectile: true },
  { name: 'RISING UPPERCUT', motion: ['f', 'd', 'df'], button: 'p', move: 'mx_fight_uppercut_lead', knockdown: true, invuln: 0.35 },
  { name: 'HURRICANE KICK', motion: ['d', 'db', 'b'], button: 'k', move: 'mx_fight_hurricane_kick' },
  { name: 'FLYING KNEE', motion: ['b', 'f'], button: 'k', move: 'mx_fight_flying_knee', knockdown: true },
  { name: 'FLIP KICK', motion: ['d', 'u'], button: 'k', move: 'mx_fight_flip_kick', knockdown: true },
  { name: 'MEIA LUA', motion: ['b', 'db', 'd'], button: 'k', move: 'mx_fight_meia_lua' }
];

const SUPERS = ['mx_fight_combo8', 'mx_fight_spin_flip_kick', 'mx_fight_knees_uppercut'];

const DIFFICULTY = {
  // rest: breather after each attack string, so the player gets a turn
  easy: { react: 0.6, block: 0.15, combo: 0.15, aggression: 0.3, special: 0.05, rest: 1.0 },
  normal: { react: 0.36, block: 0.4, combo: 0.4, aggression: 0.45, special: 0.1, rest: 0.6 },
  hard: { react: 0.18, block: 0.72, combo: 0.75, aggression: 0.68, special: 0.16, rest: 0.25 }
};

// Keyboard layouts (KeyboardEvent.code)
const KEYS = {
  1: { left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'], lp: ['KeyF'], hp: ['KeyG'], lk: ['KeyV'], hk: ['KeyB'], throw: ['KeyH'], super: ['KeyT'] },
  2: {
    left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'],
    lp: ['KeyK', 'Numpad4'], hp: ['KeyL', 'Numpad5'], lk: ['Comma', 'Numpad1'], hk: ['Period', 'Numpad2'],
    throw: ['Semicolon', 'Numpad6'], super: ['KeyO', 'Numpad3']
  }
};
// Standard gamepad buttons
const PAD = { lp: 2, hp: 3, lk: 0, hk: 1, throw: 4, super: 5, start: 9, up: 12, down: 13, left: 14, right: 15 };

class FightGame extends FightDirector {
  constructor(dj) {
    super(dj);
    this.keys = new Set();
    this.pressed = new Set();     // key codes pressed since last frame
    this.padPrev = {};
    this.paused = false;
    this.matchActive = false;
    this.onMatchEnd = null;
    this.onPauseChange = null;
    this.shots = [];
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

    // Load the chosen fighters into the two slots
    await Promise.all([this.dj.setPlayerAvatar(1, this.opts.p1), this.dj.setPlayerAvatar(2, this.opts.p2)]);
    if (runId !== this.runId) return false;
    const names = { 1: CAST_BY_KEY[this.opts.p1]?.name || 'P1', 2: CAST_BY_KEY[this.opts.p2]?.name || (this.opts.mode === 'cpu' ? 'CPU' : 'P2') };
    this.names = names;
    this.wins = { 1: 0, 2: 0 };
    this.f = { 1: this.makeFighter(1), 2: this.makeFighter(2) };
    this.f[2].cpu = this.opts.mode === 'cpu';
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
    this.shots.forEach(s => { this.dj.scene.remove(s.sprite); s.mat.dispose(); });
    this.shots = [];
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
      until: 0,
      buf: [],
      lastDir: 'n',
      lastTap: { f: -9, b: -9 },
      combo: 0,
      hitConnected: false,
      move: null,
      invulnUntil: 0,
      cpu: false,
      ai: { next: 0, hold: null, holdUntil: 0, input: { x: 0, up: false, down: false, pressed: new Set() } },
      holdBack: false,
      holdDown: false
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
      dj.rigs[p]?.setFightMode(true);
      dj.rigs[p]?.setLocomotion(0);
    });
    if (dj.drivenPlayer) dj.setDrivenPlayer(null);
  }

  resetRound() {
    [1, 2].forEach(p => {
      const f = this.f[p];
      Object.assign(f, { hp: MAX_HP, state: 'intro', until: 0, buf: [], combo: 0, hitConnected: false, move: null, invulnUntil: 0 });
      f.ai.hold = null;
      const char = this.dj.characters[p];
      char.position.set(p === 1 ? -1.25 : 1.25, char.position.y, LINE_Z);
      const st = this.dj.characterStates[p];
      st.facing = p === 1 ? Math.PI / 2 : -Math.PI / 2;
      st.targetPos.set(char.position.x, 0, LINE_Z);
      this.dj.rigs[p]?.stop(0.1);
      this.dj.rigs[p]?.setLocomotion(0);
    });
    this.hp = { 1: MAX_HP, 2: MAX_HP };
    this.lag = { 1: MAX_HP, 2: MAX_HP };
    this.over = false;
  }

  async playRound(round, runId) {
    this.resetRound();
    this.clockLeft = this.opts.roundTime;
    this.roundLive = false;
    this.banner(`ROUND ${round}`, 1.2);
    this.sound('bell');
    // Walk-on attitude
    [1, 2].forEach(p => this.dj.rigs[p].play(round === 1 ? 'mx_fight_ready_jump' : (this.rng() < 0.5 ? 'mx_fight_taunt' : 'mx_fight_taunt_arms'), { rootMotion: false, fadeIn: 0.15, fadeOut: 0.3, timeScale: 1.3 }));
    await this.wait(1.6);
    if (runId !== this.runId) return;
    [1, 2].forEach(p => { this.dj.rigs[p].stop(0.2); this.f[p].state = 'idle'; });
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
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    } else {
      this.keys.delete(e.code);
    }
  }

  /** Input for player p this frame: { x (-1..1 screen), up, down, pressed: Set<'lp'|'hp'|'lk'|'hk'|'throw'|'super'> } */
  readInput(p) {
    const layouts = this.opts.mode === 'cpu' ? [KEYS[1], KEYS[2]] : [KEYS[p]];
    const held = (act) => layouts.some(L => L[act].some(c => this.keys.has(c)));
    const hit = (act) => layouts.some(L => L[act].some(c => this.pressed.has(c)));
    const inp = { x: 0, up: held('up'), down: held('down'), pressed: new Set() };
    if (held('left')) inp.x -= 1;
    if (held('right')) inp.x += 1;
    ['lp', 'hp', 'lk', 'hk', 'throw', 'super'].forEach(a => { if (hit(a)) inp.pressed.add(a); });

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
      if (b(PAD.up) || ay < -0.6) inp.up = true;
      if (b(PAD.down) || ay > 0.6) inp.down = true;
      ['lp', 'hp', 'lk', 'hk', 'throw', 'super', 'start'].forEach(a => {
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
      // still read the pads for the start button
      if (this.f) [1, 2].forEach(p => { if (!this.f[p].cpu) this.readInput(p); });
      return;
    }
    super.update(dt);
    if (!this.matchActive || !this.f) return;
    const gdt = dt * this.dj.timeScale;

    if (this.roundLive) {
      this.clockLeft -= gdt;
      if (this.clockLeft <= 0) this.timeOver();
    }
    const inputs = {
      1: this.f[1].cpu ? this.aiInput(1, gdt) : this.readInput(1),
      2: this.f[2].cpu ? this.aiInput(2, gdt) : this.readInput(2)
    };
    this.pressed.clear();
    [1, 2].forEach(p => this.tickFighter(this.f[p], this.f[p === 1 ? 2 : 1], inputs[p], gdt));
    this.keepApart();
    this.updateShots(gdt);
  }

  pos(p) { return this.dj.characters[p].position; }

  fwdSign(f) {
    const d = this.pos(f.p === 1 ? 2 : 1).x - this.pos(f.p).x;
    return Math.abs(d) < 1e-3 ? (f.p === 1 ? 1 : -1) : Math.sign(d);
  }

  tickFighter(f, o, inp, gdt) {
    const rig = this.dj.rigs[f.p];
    const st = this.dj.characterStates[f.p];
    const P = this.pos(f.p);
    const sign = this.fwdSign(f);
    const rel = Math.sign(inp.x) * sign;          // +1 toward the opponent, -1 away
    const dir = (inp.down ? 'd' : inp.up ? 'u' : '') + (rel > 0 ? 'f' : rel < 0 ? 'b' : '') || 'n';
    if (dir !== f.lastDir) {
      // Double taps -> dashes
      if ((dir === 'f' || dir === 'b') && f.lastDir === 'n') {
        if (this.time - f.lastTap[dir] < 0.26 && this.roundLive && this.isFree(f)) this.dash(f, dir);
        f.lastTap[dir] = this.time;
      }
      f.buf.push({ dir, t: this.time });
      if (f.buf.length > 12) f.buf.shift();
      f.lastDir = dir;
    }
    f.holdBack = rel < 0;
    f.holdDown = !!inp.down;

    // Face the opponent (instant turn when sides swap, except mid-move)
    if (!['down', 'getup', 'ko', 'throw', 'thrown'].includes(f.state)) {
      const want = sign > 0 ? Math.PI / 2 : -Math.PI / 2;
      const d = Math.atan2(Math.sin(want - st.facing), Math.cos(want - st.facing));
      st.facing += d * Math.min(1, gdt * (f.state === 'attack' ? 4 : 14));
    }
    // Stay on the fight line
    P.z += (LINE_Z - P.z) * Math.min(1, gdt * 8);

    if (!this.roundLive) {
      rig.setLocomotion(0);
      return;
    }

    let speed = 0;
    let back = 0;
    switch (f.state) {
      case 'idle':
      case 'walk':
      case 'duck':
      case 'block': {
        if (inp.pressed.size && this.tryAction(f, o, inp.pressed, dir)) break;
        const threatened = this.threatened(f, o);
        if (inp.up && f.state !== 'duck') { this.jump(f, rel); break; }
        if (f.holdBack && threatened && !inp.down) {
          if (f.state !== 'block') this.enterBlock(f);
          break;
        }
        if (inp.down) {
          if (f.state !== 'duck') this.enterDuck(f);
          break;
        }
        if (f.state === 'duck' || f.state === 'block') { rig.stop(0.15); f.state = 'idle'; }
        if (rel !== 0) {
          speed = rel > 0 ? WALK_FWD : WALK_BACK;
          back = rel < 0 ? 1 : 0;
          P.x += rel * sign * speed * gdt;
          f.state = 'walk';
        } else {
          f.state = 'idle';
        }
        break;
      }
      case 'attack':
        if (f.hitConnected && this.time >= f.cancelFrom && inp.pressed.size && this.tryAction(f, o, inp.pressed, dir)) break;
        if (this.time >= f.until) this.toIdle(f);
        break;
      case 'dash':
        if (this.time >= f.until) this.toIdle(f);
        break;
      case 'jump':
        P.x += (f.jumpDrift || 0) * gdt;
        if (this.time >= f.until) this.toIdle(f);
        break;
      case 'hitstun':
      case 'blockstun':
        if (this.time >= f.until) this.toIdle(f);
        break;
      case 'down':
        if (this.time >= f.until) this.getUp(f);
        break;
      case 'getup':
      case 'throw':
      case 'thrown':
        if (this.time >= f.until) this.toIdle(f);
        break;
      default:
        break;
    }
    rig.setLocomotion(speed, 0, { back });
    P.x = THREE.MathUtils.clamp(P.x, MIN_X, MAX_X);
  }

  isFree(f) {
    return ['idle', 'walk', 'duck', 'block'].includes(f.state);
  }

  toIdle(f) {
    if (f.state === 'duck' || f.state === 'block') this.dj.rigs[f.p].stop(0.15);
    else if (f.state === 'attack') this.dj.rigs[f.p].stop(0.22);
    f.state = 'idle';
    f.move = null;
    // the opponent's combo ends when we're free again
    const o = this.f[f.p === 1 ? 2 : 1];
    if (f.p && o) o.combo = 0;
  }

  /** Is the opponent swinging at us right now (so holding back shows a block)? */
  threatened(f, o) {
    const dist = Math.abs(this.pos(o.p).x - this.pos(f.p).x);
    if (o.state === 'attack' && o.move && dist < (o.move.reach || 1) + 0.6) return true;
    return this.shots.some(s => s.owner === o.p && Math.abs(s.x - this.pos(f.p).x) < 2.2);
  }

  keepApart() {
    const A = this.pos(1);
    const B = this.pos(2);
    const d = B.x - A.x;
    if (Math.abs(d) < MIN_GAP && this.f[1].state !== 'jump' && this.f[2].state !== 'jump') {
      const push = (MIN_GAP - Math.abs(d)) / 2;
      const s = d === 0 ? 1 : Math.sign(d);
      A.x -= push * s;
      B.x += push * s;
      // pinned against the edge: the other one gets pushed
      if (A.x < MIN_X) { B.x += MIN_X - A.x; A.x = MIN_X; }
      if (B.x > MAX_X) { A.x -= B.x - MAX_X; B.x = MAX_X; }
    }
  }

  /* ================= actions ================= */

  tryAction(f, o, pressed, dir) {
    const dist = Math.abs(this.pos(o.p).x - this.pos(f.p).x);
    const has = (b) => pressed.has(b);
    // Throw (LP+LK or the throw button) when close
    if ((has('throw') || (has('lp') && has('lk'))) && dist < 1.05 && ['idle', 'walk', 'block', 'duck'].includes(o.state)) {
      return this.doThrow(f, o);
    }
    // Super (HP+HK or the super button) with a full meter
    if ((has('super') || (has('hp') && has('hk'))) && f.meter >= 100) return this.doSuper(f, o);
    // Specials: motion + button
    const punch = has('lp') || has('hp');
    const kick = has('lk') || has('hk');
    for (const sp of SPECIALS) {
      if ((sp.button === 'p' && punch) || (sp.button === 'k' && kick)) {
        if (this.matchMotion(f, sp.motion)) {
          f.buf = [];
          this.popText(f.p, sp.name + '!', '#7fe0ff', true);
          return this.doAttack(f, o, sp.move, { special: true, knockdown: sp.knockdown, invuln: sp.invuln, projectile: sp.projectile, speed: 1.15 });
        }
      }
    }
    const btn = ['hp', 'hk', 'lp', 'lk'].find(b => has(b));
    if (!btn) return false;
    const v = dir.includes('d') ? 'd' : dir.includes('f') ? 'f' : dir.includes('b') ? 'b' : 'n';
    return this.doAttack(f, o, MOVESET[btn][v], { speed: btn[0] === 'l' ? 1.3 : 1.15 });
  }

  matchMotion(f, motion) {
    const recent = f.buf.filter(b => this.time - b.t < 0.7);
    let j = 0;
    let lastT = -9;
    for (const b of recent) {
      if (b.dir === motion[j]) { j++; lastT = b.t; if (j === motion.length) break; }
    }
    return j === motion.length && this.time - lastT < 0.3;
  }

  doAttack(f, o, moveId, opts = {}) {
    const rig = this.dj.rigs[f.p];
    const e = this.dj.mocap.byId[moveId];
    if (!e || !rig.ready(moveId)) return false;
    const ts = opts.speed || 1.15;
    const tr = this.travel(moveId, f.p);
    const travelLen = Math.hypot(tr.dx, tr.dz);
    const rmScale = travelLen > 0.5 ? 0.5 / travelLen : 1;
    f.state = 'attack';
    f.move = e;
    f.hitConnected = false;
    f.attackOpts = opts;
    const hits = e.hits || [0.5];
    const onTime = opts.projectile
      ? [{ t: hits[0], fn: () => this.fireShot(f) }]
      : hits.map((t, i) => ({ t, fn: () => this.resolveHit(f, o, e, i, opts) }));
    // Mocap clips have long wind-ups: start just before the first impact so
    // buttons feel responsive (heavier moves keep a little more anticipation)
    const startup = opts.super ? 0.5 : opts.special ? 0.42 : [0.24, 0.2, 0.28, 0.36][e.power || 2];
    const from = Math.max(0, hits[0] - startup);
    const last = hits[hits.length - 1];
    const recover = opts.special || opts.super ? 0.55 : 0.32;
    const dur = this.dj.mocap.get(moveId)?.clip.duration || last + 1;
    rig.play(moveId, { rootMotion: true, rmScale, from, to: Math.min(dur, last + recover + 0.3), fadeIn: 0.06, fadeOut: 0.2, timeScale: ts, onTime });
    f.cancelFrom = this.time + (hits[0] - from) / ts;
    f.until = this.time + (last - from + recover) / ts;
    if (opts.invuln) f.invulnUntil = this.time + opts.invuln;
    this.sound('whoosh', 0.7);
    return true;
  }

  dash(f, dir) {
    const rig = this.dj.rigs[f.p];
    const id = dir === 'f' ? 'mx_fight_step_forward' : 'mx_fight_step_back';
    if (!rig.ready(id)) return;
    rig.play(id, { rootMotion: true, rmScale: dir === 'f' ? 0.75 : 1.1, fadeIn: 0.06, fadeOut: 0.15, timeScale: 1.5 });
    f.state = 'dash';
    f.until = this.time + 0.42;
    if (dir === 'b') f.invulnUntil = this.time + 0.2;
  }

  jump(f, rel) {
    const rig = this.dj.rigs[f.p];
    rig.play('mx_jump', { from: 0.3, to: 1.55, rootMotion: false, fadeIn: 0.06, fadeOut: 0.2, timeScale: 1.35 });
    f.state = 'jump';
    f.airFrom = this.time + 0.12;
    f.airTo = this.time + 0.7;
    f.until = this.time + 0.92;
    f.jumpDrift = rel * this.fwdSign(f) * 1.3;
  }

  enterDuck(f) {
    this.dj.rigs[f.p].play('mx_fdodge_duck', { from: 0.1, to: 0.55, hold: true, rootMotion: false, fadeIn: 0.06, timeScale: 1.5 });
    f.state = 'duck';
  }

  enterBlock(f) {
    this.dj.rigs[f.p].play('mx_fight_block_high', { from: 0.05, to: 0.45, hold: true, rootMotion: false, fadeIn: 0.05, timeScale: 1.6 });
    f.state = 'block';
  }

  airborne(f) {
    return f.state === 'jump' && this.time >= f.airFrom && this.time <= f.airTo;
  }

  /* ================= hits ================= */

  resolveHit(f, o, e, i, opts = {}) {
    if (!this.roundLive || o.state === 'ko') return;
    const last = i === (e.hits?.length || 1) - 1;
    const dist = Math.abs(this.pos(o.p).x - this.pos(f.p).x);
    if (dist > (e.reach || 0.95) + 0.22) return;                       // whiff
    if (this.time < o.invulnUntil || ['down', 'getup', 'thrown'].includes(o.state)) return;
    if (this.airborne(o) && e.low) return;                              // jumped the sweep
    if (o.state === 'duck' && !e.low && !e.body && !opts.super) return; // ducked under the high shot
    const blocking = o.holdBack && ['idle', 'walk', 'block', 'blockstun', 'duck'].includes(o.state) && !(e.low && !o.holdDown);
    const power = opts.super ? 3 : (e.power || 1);
    const headPos = this.bonePos(o.p, e.body || e.low ? 'Spine' : 'Head');
    const sign = this.fwdSign(f);

    if (blocking) {
      o.hp = Math.max(1, o.hp - (opts.special || opts.super ? 3 : 1));
      if (o.state !== 'block') this.enterBlock(o);
      o.state = 'blockstun';
      o.until = this.time + 0.22 + power * 0.06;
      this.pos(o.p).x += sign * 0.06 * power;
      this.spark(headPos, 0x66ccff, 0.6);
      this.sound('block');
      f.meter = Math.min(100, f.meter + 3);
      o.meter = Math.min(100, o.meter + 5);
      this.syncHp();
      return;
    }

    // Clean hit
    const scaling = Math.pow(0.86, f.combo);
    const dmg = BASE_DMG[power] * scaling * (opts.special ? 1.25 : 1) * (opts.super ? 1.4 : 1) * (e.hits?.length > 1 && !last ? 0.6 : 1);
    o.hp = Math.max(0, o.hp - dmg);
    f.combo++;
    f.hitConnected = true;
    f.meter = Math.min(100, f.meter + 5 + power * 3);
    o.meter = Math.min(100, o.meter + 4);
    this.syncHp();
    this.spark(headPos, power === 3 ? 0xffd04a : 0xfff2c0, 0.6 + power * 0.25);
    this.sound(power === 3 ? 'heavy' : 'punch');
    this.shake = Math.max(this.shake, 0.03 + power * 0.025);
    if (power >= 2) this.hitstopUntil = (this.realTime || 0) + (power === 3 ? 0.08 : 0.045);
    if (f.combo >= 2) this.popText(f.p, `${f.combo} HITS`, '#ffcf3a', f.combo >= 4);

    if (o.hp <= 0) {
      this.knockOut(o, f, e);
      return;
    }
    const knockdown = (e.sweep && last) || (opts.knockdown && last) || (opts.super && last) || (power === 3 && f.combo >= 4) || (this.airborne(o) && power >= 2);
    if (knockdown) {
      this.knockDown(o, e.sweep ? 'mx_sweep_fall' : (this.rng() < 0.5 ? 'mx_fight_knockdown' : 'mx_knocked_down'));
      return;
    }
    // Hit stun with a reaction to match
    let react;
    if (e.body) react = power === 3 ? 'mx_fhit_stomach_big' : 'mx_fhit_stomach';
    else {
      const size = !last ? 'light' : power === 3 ? 'big' : power === 2 ? 'med' : 'light';
      react = `mx_fhit_head_${size}_${['l', 'r', 'c'][Math.floor(this.rng() * 3)]}`;
    }
    this.dj.rigs[o.p].play(react, { rootMotion: true, rmScale: 0.5, fadeIn: 0.04, fadeOut: 0.25, timeScale: 1.25 });
    o.state = 'hitstun';
    o.until = this.time + 0.3 + power * 0.1;
    this.pos(o.p).x += sign * (0.05 + power * 0.05);
  }

  knockDown(o, clip) {
    const rig = this.dj.rigs[o.p];
    rig.play(clip, { rootMotion: true, rmScale: 0.5, hold: true, fadeIn: 0.04, timeScale: 1.2 });
    o.state = 'down';
    o.downClip = clip;
    const dur = this.dj.mocap.get(clip)?.clip.duration || 2;
    o.until = this.time + dur / 1.2 + 0.35;
    o.invulnUntil = o.until + 1.2;
    this.shake = 0.12;
    this.sound('thud', 0.7);
    this.popText(o.p, 'DOWN!', '#ff7b3a', true);
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
    const tr = d?.clip.tracks.find(t => t.name.endsWith('Hips.position'));
    let res = null;
    if (tr) {
      const { times, values } = tr;
      const y = (i) => values[i * 3 + 1];
      let mn = Infinity, mx = -Infinity;
      for (let i = 0; i < times.length; i++) { mn = Math.min(mn, y(i)); mx = Math.max(mx, y(i)); }
      const low = mn + 0.18 * (mx - mn);
      let land = times.findIndex((t, i) => t >= after && y(i) <= low);
      if (land < 0) land = 0;
      let rise = land;
      while (rise < times.length - 1 && y(rise) <= low) rise++;
      res = { land: times[land], rise: times[rise], duration: d.clip.duration };
    }
    this._hip[key] = res;
    return res;
  }

  getUp(f) {
    const rig = this.dj.rigs[f.p];
    const getup = f.downClip === 'mx_fight_knockdown' ? 'mx_getup_knockdown' : f.downClip === 'mx_knocked_down' ? 'mx_getup_stomach' : 'mx_getup_back';
    const ts = getup === 'mx_getup_knockdown' ? 1.5 : getup === 'mx_getup_stomach' ? 2.2 : 1.6;
    const prof = this.hipProfile(getup);
    const from = prof ? Math.max(0, prof.rise - 0.4) : 0;
    rig.play(getup, { rootMotion: true, rmScale: 0.4, from, fadeIn: 0.2, fadeOut: 0.3, timeScale: ts });
    f.state = 'getup';
    const dur = this.dj.mocap.get(getup)?.clip.duration || 3;
    f.until = this.time + (dur - from) / ts - 0.2;
    f.invulnUntil = f.until + 0.25;
  }

  knockOut(o, f, e) {
    this.roundLive = false;
    o.state = 'ko';
    o.hp = 0;
    this.syncHp();
    const kick = /kick|armada|meia|knee|martelo|chapa/.test(e.id);
    const clip = kick ? 'mx_fko_flying_back' : (this.rng() < 0.5 ? 'mx_fko_fall_back' : 'mx_fko_flying_back');
    this.dj.rigs[o.p].play(clip, { rootMotion: true, rmScale: 0.7, hold: true, fadeIn: 0.04 });
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

  /* ================= specials ================= */

  doThrow(f, o) {
    const pairs = [['mx_fight_throw_attacker', 'mx_fight_throw_victim'], ['mx_fight_surprise_uppercut_attacker', 'mx_fight_surprise_uppercut_victim']];
    const [aId, vId] = pairs[Math.floor(this.rng() * pairs.length)];
    const a = this.dj.mocap.get(aId);
    const v = this.dj.mocap.get(vId);
    const rigA = this.dj.rigs[f.p];
    const rigV = this.dj.rigs[o.p];
    if (!a || !v) return false;
    const stA = this.dj.characterStates[f.p];
    const stV = this.dj.characterStates[o.p];
    const A = this.pos(f.p);
    const s = rigA.hipScale * rigA.unitToWorld;
    const rawA = this.rawStart(a.rm);
    const rawV = this.rawStart(v.rm);
    const theta = stA.facing - a.rm.h0;
    const dx = (rawV.x - rawA.x) * s;
    const dz = (rawV.z - rawA.z) * s;
    const V = this.pos(o.p);
    V.x = A.x + dx * Math.cos(theta) + dz * Math.sin(theta);
    stV.facing = v.rm.h0 + theta;
    f.state = 'throw';
    o.state = 'thrown';
    const TS = 1.35; // the mocap throws are cinematic; keep them snappy
    f.until = this.time + a.clip.duration * 0.85 / TS;
    o.until = this.time + v.clip.duration / TS + 0.2;
    o.invulnUntil = o.until + 1.5;
    this.popText(f.p, 'THROW!', '#ff9a3a', true);
    const vp = this.hipProfile(vId, v.clip.duration * 0.5);
    const impactT = vp ? Math.min(vp.land, v.clip.duration * 0.62) : v.clip.duration * 0.62;
    rigA.play(aId, { rootMotion: true, rmScale: 0.6, fadeIn: 0.1, fadeOut: 0.35, timeScale: TS });
    rigV.play(vId, {
      rootMotion: true, rmScale: 0.6, hold: true, fadeIn: 0.1, timeScale: TS,
      onTime: [{
        t: impactT,
        fn: () => {
          this.shake = 0.14;
          this.sound('thud', 0.8);
          o.hp = Math.max(0, o.hp - 15);
          f.meter = Math.min(100, f.meter + 15);
          this.syncHp();
          if (o.hp <= 0) this.knockOut(o, f, { id: 'throw' });
        }
      }]
    });
    // Once the victim has landed (and taken a beat on the floor), get up
    const cut = Math.min(v.clip.duration, (vp ? vp.land : v.clip.duration) + 0.6) / TS;
    o.until = this.time + cut + 1;
    this.wait(cut).then(() => {
      if (!this.matchActive || o.state === 'ko') return;
      o.downClip = 'mx_fko_fall_back';
      this.getUp(o);
    }, () => {});
    return true;
  }

  doSuper(f, o) {
    f.meter = 0;
    const id = SUPERS.filter(m => this.dj.rigs[f.p].ready(m))[Math.floor(this.rng() * SUPERS.length) % Math.max(1, SUPERS.length)] || SUPERS[0];
    this.banner('SUPER!', 1.1, 'fight');
    this.slowmo = 0.35;
    this.slowUntil = this.time + 0.35;
    this.flash();
    this.sound('fireball');
    return this.doAttack(f, o, id, { super: true, speed: 1.2, invuln: 0.4 });
  }

  flash() {
    const el = document.createElement('div');
    el.className = 'fight-flash';
    this.hud?.appendChild(el);
    setTimeout(() => el.remove(), 450);
  }

  fireShot(f) {
    const from = this.bonePos(f.p, 'RightHand');
    const mat = new THREE.SpriteMaterial({ map: this.glowTex, color: f.p === 1 ? 0xff6a3a : 0x5ad8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(0.55);
    sprite.position.set(from.x, 1.25, LINE_Z);
    sprite.add(new THREE.PointLight(f.p === 1 ? 0xff6a3a : 0x5ad8ff, 6, 4, 2));
    this.dj.scene.add(sprite);
    this.sound('fireball');
    this.shots.push({ sprite, mat, owner: f.p, x: from.x, vx: this.fwdSign(f) * 4.2, life: 0 });
  }

  updateShots(gdt) {
    this.shots = this.shots.filter(s => {
      s.life += gdt;
      s.x += s.vx * gdt;
      s.sprite.position.x = s.x;
      s.mat.rotation += gdt * 8;
      s.sprite.scale.setScalar(0.5 + Math.sin(s.life * 30) * 0.06);
      // Fireballs cancel each other out
      const clash = this.shots.find(t => t !== s && t.owner !== s.owner && Math.abs(t.x - s.x) < 0.3);
      if (clash) {
        this.spark(s.sprite.position.clone(), 0xffffff, 1.2);
        clash.life = 99;
        return this.killShot(s);
      }
      const tp = s.owner === 1 ? 2 : 1;
      const target = this.f[tp];
      const tx = this.pos(tp).x;
      if (Math.abs(tx - s.x) < 0.3 && this.roundLive && !['down', 'getup', 'ko', 'thrown'].includes(target.state) && !this.airborne(target) && this.time >= target.invulnUntil) {
        const fake = { id: 'fireball', power: 3, reach: 9, hits: [0] };
        const attacker = this.f[s.owner];
        // make the projectile count from wherever the shooter is
        this.resolveHit(attacker, target, fake, 0, { special: true });
        return this.killShot(s);
      }
      if (s.life > 3 || s.x < MIN_X - 1 || s.x > MAX_X + 1) return this.killShot(s);
      return true;
    });
  }

  killShot(s) {
    this.dj.scene.remove(s.sprite);
    s.mat.dispose();
    return false;
  }

  /* ================= CPU ================= */

  aiInput(p, gdt) {
    const f = this.f[p];
    const o = this.f[p === 1 ? 2 : 1];
    const D = DIFFICULTY[this.opts.difficulty] || DIFFICULTY.normal;
    const inp = f.ai.input;
    inp.pressed = new Set();
    if (!this.roundLive) { inp.x = 0; inp.up = false; inp.down = false; return inp; }
    const sign = this.fwdSign(f);
    const dist = Math.abs(this.pos(o.p).x - this.pos(p).x);

    // Keep doing the current plan until it expires
    if (f.ai.hold && this.time < f.ai.holdUntil) {
      inp.x = f.ai.hold.rel * sign;
      inp.down = !!f.ai.hold.down;
      inp.up = false;
    } else {
      f.ai.hold = null;
      inp.x = 0; inp.down = false; inp.up = false;
    }

    // Combos: press on after a connected hit
    if (f.state === 'attack' && f.hitConnected && this.time >= f.cancelFrom && !f.ai.comboDone) {
      f.ai.comboDone = true;
      if (this.rng() < D.combo) inp.pressed.add(['lp', 'hp', 'hk'][Math.floor(this.rng() * 3)]);
      return inp;
    }
    if (f.state !== 'attack') f.ai.comboDone = false;
    // Just finished a string: give ground for a moment
    if (f.ai.wasAttacking && f.state !== 'attack') {
      f.ai.next = Math.max(f.ai.next, this.time + D.rest * (0.6 + this.rng() * 0.8));
      if (this.rng() < 0.5) { f.ai.hold = { rel: -1 }; f.ai.holdUntil = this.time + 0.25 + this.rng() * 0.25; }
    }
    f.ai.wasAttacking = f.state === 'attack';

    if (this.time < f.ai.next) return inp;
    f.ai.next = this.time + D.react * (0.7 + this.rng() * 0.6);
    if (!this.isFree(f)) return inp;

    const threat = this.threatened(f, o);
    if (threat && this.rng() < D.block) {
      const low = o.move?.low;
      const incomingShot = this.shots.some(s => s.owner === o.p);
      if (incomingShot && this.rng() < 0.5) { inp.up = true; inp.x = sign * 1; return inp; }
      f.ai.hold = { rel: -1, down: !!low };
      f.ai.holdUntil = this.time + 0.55;
      inp.x = -sign;
      inp.down = !!low;
      return inp;
    }
    if (['down', 'getup'].includes(o.state)) {
      f.ai.hold = { rel: dist < 1.6 ? -1 : 0 };
      f.ai.holdUntil = this.time + 0.4;
      return inp;
    }
    if (f.meter >= 100 && dist < 1.2 && this.rng() < 0.6) { inp.pressed.add('super'); return inp; }
    if (dist > 2.3) {
      if (this.rng() < D.special * 2.5) { this.doAttack(f, o, 'mx_fight_hadouken', { special: true, projectile: true, speed: 1.15 }); this.popText(p, 'FIREBALL!', '#7fe0ff', true); return inp; }
      f.ai.hold = { rel: 1 };
      f.ai.holdUntil = this.time + 0.5 + this.rng() * 0.4;
      return inp;
    }
    if (dist > 1.25) {
      if (this.rng() < 0.15) { this.dash(f, 'f'); return inp; }
      if (this.rng() < D.special) {
        const sp = SPECIALS[1 + Math.floor(this.rng() * (SPECIALS.length - 1))];
        this.popText(p, sp.name + '!', '#7fe0ff', true);
        this.doAttack(f, o, sp.move, { special: true, knockdown: sp.knockdown, invuln: sp.invuln, speed: 1.15 });
        return inp;
      }
      // long kicks reach from here
      if (this.rng() < D.aggression * 0.5) { inp.pressed.add(this.rng() < 0.5 ? 'hk' : 'lk'); if (this.rng() < 0.5) inp.x = sign; return inp; }
      f.ai.hold = { rel: 1 };
      f.ai.holdUntil = this.time + 0.35;
      return inp;
    }
    // In range
    if (dist < 0.95 && this.rng() < 0.08) { inp.pressed.add('throw'); return inp; }
    if (this.rng() < D.aggression) {
      const btn = ['lp', 'lp', 'hp', 'lk', 'hk'][Math.floor(this.rng() * 5)];
      inp.pressed.add(btn);
      const r = this.rng();
      if (r < 0.25) inp.x = sign; else if (r < 0.4) inp.x = -sign; else if (r < 0.55) inp.down = true;
      return inp;
    }
    // Back off / bait
    f.ai.hold = { rel: this.rng() < 0.5 ? -1 : 0, down: this.rng() < 0.2 };
    f.ai.holdUntil = this.time + 0.3 + this.rng() * 0.3;
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

  setFightCamera() {
    this.dj.cameraOverride = (camPos, target) => {
      const A = this.pos(1);
      const B = this.pos(2);
      const mid = (A.x + B.x) / 2;
      const span = Math.abs(B.x - A.x);
      const radius = 3.0 + span * 0.7;
      camPos.set(mid * 0.85, 1.35, LINE_Z + radius);
      target.set(mid, 1.05, LINE_Z);
      if (this.shake > 0.002) {
        camPos.x += (Math.random() - 0.5) * this.shake;
        camPos.y += (Math.random() - 0.5) * this.shake;
      }
    };
  }
}

export { FightGame, MOVESET, SPECIALS, KEYS };
