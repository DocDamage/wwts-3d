/**
 * Fight Director — a choreographed, fighting-game style brawl between the two
 * contestants after the result is announced. The battle winner always wins the
 * fight; the loser lands some shots, blocks a few, gets knocked down, and is
 * finished with a K.O. Everything is driven by the motion-capture clips:
 * attacks fire hit reactions at their measured impact frames, falls hold on the
 * floor, fighters step in/out to keep range, and the camera follows the action.
 *
 * Same seed => same fight, so the OBS popout can replay it in sync.
 */
import * as THREE from 'three';

const FACEOFF = { x: 0.55, z: 1.95 };
const MAX_HP = 100;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGlowTexture() {
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

class FightDirector {
  constructor(dj) {
    this.dj = dj;
    this.active = false;
    this.time = 0;
    this.waiters = [];
    this.sparks = [];
    this.projectiles = [];
    this.shake = 0;
    this.slowmo = 1;
    this.slowUntil = 0;
    this.hitstopUntil = 0;
    this.hud = null;
    this.audio = null;
    this.glowTex = null;
    this.onEnd = null;
    this.runId = 0;
  }

  /* ---------------- public ---------------- */

  /** winner: 1 | 2 | null (draw). names: {1: 'A', 2: 'B'}. Resolves when the fight is over. */
  async start({ winner = 1, names = {}, seed = Date.now() } = {}) {
    if (!this.dj.mocapReady) return false;
    this.stop(true);
    const runId = ++this.runId;
    this.active = true;
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.winner = winner;
    this.names = { 1: names[1] || 'Contestant 1', 2: names[2] || 'Contestant 2' };
    this.hp = { 1: MAX_HP, 2: MAX_HP };
    this.combo = { 1: 0, 2: 0 };
    this.knockedDown = { 1: false, 2: false };
    this.over = false;
    this.attacks = this.dj.mocap.entries.filter(e => e.category === 'fight' && e.hits?.length);
    this.lastAttack = { 1: null, 2: null };
    this.glowTex = this.glowTex || makeGlowTexture();
    this.buildHud();
    this.ensureAudio();

    await this.walkIn(runId);
    if (runId !== this.runId) return false;
    this.takeControl();

    this.banner('ROUND 1', 1.1);
    this.sound('bell');
    await this.wait(1.2);
    this.banner('FIGHT!', 0.9, 'fight');
    this.sound('fight');
    await this.wait(0.7);

    try {
      await this.brawl(runId);
    } catch (e) {
      if (e !== 'stopped') console.warn('Fight error', e);
    }
    if (runId !== this.runId) return false;
    await this.wait(5.5);
    if (runId !== this.runId) return false;
    this.finish();
    return true;
  }

  stop(silent = false) {
    if (!this.active && !this.hud) return;
    this.runId++;
    this.waiters.forEach(w => w.reject?.('stopped'));
    this.waiters = [];
    this.releaseControl();
    this.active = false;
    this.removeHud();
    this.dj.cameraOverride = null;
    this.slowmo = 1;
    if (!silent) this.onEnd?.();
  }

  /** Called every frame by the stage renderer (dt is real time) */
  update(dt) {
    if (!this.active) return;
    // Slow motion / hit-stop scale game time; the mixers follow via dj.timeScale
    // (hit-stop is measured in real time: game time barely moves during it)
    this.realTime = (this.realTime || 0) + dt;
    let scale = this.slowmo;
    if (this.realTime < this.hitstopUntil) scale = 0.04;
    if (this.slowUntil && this.time > this.slowUntil) { this.slowmo = 1; this.slowUntil = 0; }
    this.dj.timeScale = scale;
    const gdt = dt * scale;
    this.time += gdt;

    // Resolve waits
    const due = this.waiters.filter(w => this.time >= w.at);
    this.waiters = this.waiters.filter(w => this.time < w.at);
    due.forEach(w => w.resolve());

    // Fighters keep squaring up to each other unless a move is turning them
    [1, 2].forEach(p => {
      const st = this.dj.characterStates[p];
      if (!st.fighting || st.noFace) return;
      const me = this.dj.characters[p].position;
      const them = this.dj.characters[p === 1 ? 2 : 1].position;
      const want = Math.atan2(them.x - me.x, them.z - me.z);
      const d = Math.atan2(Math.sin(want - st.facing), Math.cos(want - st.facing));
      st.facing += d * Math.min(1, gdt * 5);
    });

    // Slide the pair back toward centre stage when the action drifts (keeps it on camera)
    const st1 = this.dj.characterStates[1];
    const st2 = this.dj.characterStates[2];
    if (st1.fighting && st2.fighting && !st1.noFace && !st2.noFace) {
      const A = this.dj.characters[1].position;
      const B = this.dj.characters[2].position;
      const mx = (A.x + B.x) / 2;
      const mz = (A.z + B.z) / 2;
      const ex = 0 - mx;
      const ez = FACEOFF.z - mz;
      if (Math.hypot(ex, ez) > 0.35) {
        const k = Math.min(1, gdt * 0.9);
        A.x += ex * k; B.x += ex * k;
        A.z += ez * k; B.z += ez * k;
      }
    }

    this.updateEffects(gdt, dt);
    this.updateCamera(dt);
    this.updateHud();
  }

  /* ---------------- flow ---------------- */

  async walkIn(runId) {
    const dj = this.dj;
    [1, 2].forEach(p => {
      dj.stopMove(p);
      const side = p === 1 ? -1 : 1;
      dj.walkCharacterTo(p, side * FACEOFF.x, FACEOFF.z, 'IDLE_STATION', side < 0 ? Math.PI / 2 : -Math.PI / 2);
    });
    this.setCamera();
    const t0 = this.time;
    while (runId === this.runId && this.time - t0 < 6) {
      const walking = [1, 2].some(p => dj.characterStates[p].state === 'WALKING');
      if (!walking) break;
      await this.wait(0.1);
    }
  }

  takeControl() {
    const dj = this.dj;
    [1, 2].forEach(p => {
      const st = dj.characterStates[p];
      st.fighting = true;
      st.noFace = false;
      st.emote = null;
      st.pendingChain = null;
      st.state = 'IDLE_STATION';
      st.targetFacingAngle = null;
      dj.rigs[p]?.setFightMode(true);
      dj.rigs[p]?.setLocomotion(0);
      dj.rigs[p]?.stop(0.2);
    });
    if (dj.drivenPlayer) dj.setDrivenPlayer(null);
  }

  releaseControl() {
    const dj = this.dj;
    dj.timeScale = 1;
    [1, 2].forEach(p => {
      const st = dj.characterStates[p];
      if (!st) return;
      st.fighting = false;
      st.noFace = false;
      dj.rigs[p]?.setFightMode(false);
      const pos = dj.characters[p]?.position;
      if (pos) st.targetPos.set(pos.x, 0, pos.z);
    });
  }

  finish() {
    this.releaseControl();
    this.active = false;
    this.removeHud();
    this.dj.cameraOverride = null;
    this.onEnd?.();
  }

  /** The whole fight: exchanges until the loser is finished */
  async brawl(runId) {
    const W = this.winner || (this.rng() < 0.5 ? 1 : 2);
    const L = W === 1 ? 2 : 1;
    const draw = !this.winner;
    let exchanges = 0;
    let throwDone = false;
    let fireballDone = false;
    const t0 = this.time;

    while (runId === this.runId) {
      exchanges++;
      const elapsed = this.time - t0;
      const lowHp = this.hp[L] <= 30;
      if (!draw && (lowHp && exchanges >= 6 || elapsed > 36)) break;
      if (draw && (this.hp[1] <= 35 && this.hp[2] <= 35 || elapsed > 34)) break;

      // Mix in a special now and then
      const r = this.rng();
      if (!throwDone && exchanges >= 4 && r < 0.18 && !draw) {
        throwDone = true;
        await this.pairedThrow(W, L);
      } else if (!fireballDone && exchanges >= 3 && r < 0.32) {
        fireballDone = true;
        const atk = draw ? (this.rng() < 0.5 ? 1 : 2) : (this.rng() < 0.75 ? W : L);
        await this.fireball(atk, atk === 1 ? 2 : 1, draw);
      } else {
        const winnerBias = draw ? 0.5 : 0.6 + Math.min(0.2, exchanges * 0.015);
        const atk = this.rng() < winnerBias ? W : L;
        await this.exchange(atk, atk === W ? L : W, { W, L, draw });
      }
      if (this.rng() < 0.3) await this.reposition();
      await this.wait(0.08 + this.rng() * 0.22);
    }
    if (runId !== this.runId) return;
    if (draw) await this.doubleKO();
    else await this.finisher(W, L);
  }

  pickAttack(p, { maxPower = 3, minPower = 1, filter } = {}) {
    const pool = this.attacks.filter(a => !a.noFight && (a.power || 1) <= maxPower && (a.power || 1) >= minPower && !a.projectile && a.id !== this.lastAttack[p] && (!filter || filter(a)));
    const weights = pool.map(a => (a.power === 3 ? 0.6 : a.power === 2 ? 1.1 : 1.3) * (a.hits.length > 2 ? 0.7 : 1));
    let x = this.rng() * weights.reduce((s, w) => s + w, 0);
    for (let i = 0; i < pool.length; i++) {
      x -= weights[i];
      if (x <= 0) { this.lastAttack[p] = pool[i].id; return pool[i]; }
    }
    return pool[0];
  }

  /** One attack and the response to it */
  async exchange(atk, def, { W, L, draw }) {
    const attack = this.pickAttack(atk, { maxPower: atk === L && this.hp[W] < 50 ? 2 : 3 });
    if (!attack) return;
    // Who gets through: the winner usually defends, the loser usually eats it
    let outcome;
    const r = this.rng();
    if (draw) outcome = r < 0.6 ? 'hit' : r < 0.8 ? 'block' : 'dodge';
    else if (def === W) outcome = r < 0.5 ? 'hit' : r < 0.78 ? 'block' : 'dodge';
    else outcome = r < 0.8 ? 'hit' : r < 0.9 ? 'block' : 'dodge';
    await this.strike(atk, def, attack, outcome);
  }

  /** Close/open the distance so the attack lands */
  async setRange(atk, def, want) {
    const A = this.dj.characters[atk].position;
    const B = this.dj.characters[def].position;
    const dist = Math.hypot(B.x - A.x, B.z - A.z);
    const rig = this.dj.rigs[atk];
    if (dist > want + 0.22) {
      const need = dist - want;
      const step = Math.abs(this.travel('mx_fight_step_forward', atk).dz) || 1.1;
      rig.play('mx_fight_step_forward', { rootMotion: true, rmScale: THREE.MathUtils.clamp(need / step, 0.2, 1.6), fadeIn: 0.1, fadeOut: 0.2 });
      await this.wait(Math.max(0.45, rig.remaining() - 0.15));
    } else if (dist < want - 0.22) {
      const need = want - dist;
      const step = Math.abs(this.travel('mx_fight_step_back', atk).dz) || 0.7;
      rig.play('mx_fight_step_back', { rootMotion: true, rmScale: THREE.MathUtils.clamp(need / step, 0.2, 1.6), fadeIn: 0.1, fadeOut: 0.2 });
      await this.wait(Math.max(0.4, rig.remaining() - 0.15));
    }
  }

  travel(id, p) {
    const d = this.dj.mocap.get(id);
    const rig = this.dj.rigs[p];
    if (!d || !rig) return { dx: 0, dz: 0 };
    const s = rig.hipScale * rig.unitToWorld;
    const n = d.rm.pz.length;
    return { dx: n ? d.rm.px[n - 1] * s : 0, dz: n ? d.rm.pz[n - 1] * s : 0 };
  }

  async strike(atk, def, attack, outcome, { finisher = false } = {}) {
    const rigA = this.dj.rigs[atk];
    const rigD = this.dj.rigs[def];
    const tr = this.travel(attack.id, atk);
    const travelLen = Math.hypot(tr.dx, tr.dz);
    const rmScale = travelLen > 0.45 ? 0.45 / travelLen : 1;
    const want = (attack.reach || 0.95) + Math.min(travelLen, 0.45) * 0.6;
    await this.setRange(atk, def, want);
    if (!this.active) return;

    const hits = attack.hits;
    const firstHit = hits[0];
    // Defensive reaction starts just before the first impact
    const defTimers = [];
    if (outcome === 'block') {
      const block = attack.body ? 'mx_fight_block' : (this.rng() < 0.5 ? 'mx_fight_block_high' : 'mx_fight_block');
      defTimers.push({ t: Math.max(0, firstHit - 0.3), fn: () => rigD.play(block, { rootMotion: false, fadeIn: 0.08, fadeOut: 0.25, from: block === 'mx_fight_block' ? 0.35 : 0.1 }) });
    } else if (outcome === 'dodge') {
      const dodge = ['mx_fdodge_retreat', 'mx_fdodge_right', 'mx_fdodge_duck', 'mx_fdodge_jump_back'][Math.floor(this.rng() * 4)];
      defTimers.push({ t: Math.max(0, firstHit - 0.38), fn: () => rigD.play(dodge, { rootMotion: true, rmScale: 0.6, fadeIn: 0.08, fadeOut: 0.25 }) });
    }
    const onTime = hits.map((t, i) => ({ t, fn: () => this.impact(atk, def, attack, i, outcome, { finisher }) }));
    defTimers.forEach(d => onTime.push(d));
    this.sound(attack.hits.length > 2 ? 'whoosh' : 'whoosh');
    rigA.play(attack.id, { rootMotion: true, rmScale, fadeIn: 0.1, fadeOut: 0.25, onTime });
    // Wait for the attack to play out (but not every last frame)
    await this.wait(Math.max(0.6, hits[hits.length - 1] + 0.35));
    if (!finisher) await this.wait(Math.min(0.7, Math.max(0, rigA.remaining() - 0.35)));
  }

  impact(atk, def, attack, i, outcome, { finisher = false } = {}) {
    if (!this.active) return;
    const rigD = this.dj.rigs[def];
    const last = i === attack.hits.length - 1;
    const power = attack.power || 1;
    const headPos = this.bonePos(def, attack.body ? 'Spine2' : 'Head');
    if (outcome === 'block') {
      this.spark(headPos, 0x66ccff, 0.6);
      this.sound('block');
      this.damage(def, 1);
      this.popText(def, 'BLOCK', '#66ccff');
      return;
    }
    if (outcome === 'dodge') {
      if (i === 0) this.popText(def, 'DODGE', '#9cff8a');
      return;
    }
    // Clean hit
    this.combo[atk] = (this.combo[atk] || 0) + 1;
    const base = power === 3 ? 17 : power === 2 ? 12 : 8;
    const dmg = base * (attack.hits.length > 1 && !last ? 0.6 : 1);
    this.damage(def, dmg, atk);
    this.spark(headPos, power === 3 ? 0xffd04a : 0xfff2c0, 0.6 + power * 0.25);
    this.sound(power === 3 ? 'heavy' : 'punch');
    this.shake = Math.max(this.shake, 0.03 + power * 0.025);
    if (power >= 2 && last) this.hitstopUntil = (this.realTime || 0) + (power === 3 ? 0.09 : 0.05);
    if (this.combo[atk] >= 3 && last) this.popText(atk, `${this.combo[atk]} HIT COMBO!`, '#ffcf3a', true);

    if (finisher) return; // the finisher's knockout is played by the caller

    // Knockdown: the loser goes down once when hurt by a heavy shot
    if (def !== this.winner && this.winner && last && power === 3 && !this.knockedDown[def] && this.hp[def] < 60) {
      this.knockedDown[def] = true;
      this.knockdown(def);
      return;
    }
    // Sweeps take the legs out
    if (attack.sweep && last) {
      this.sweepDown(def);
      return;
    }
    // Hit reaction scaled to the shot
    let react;
    if (attack.body) react = power === 3 ? 'mx_fhit_stomach_big' : last ? 'mx_fhit_stomach' : 'mx_fhit_body_straight';
    else {
      const size = !last ? 'light' : power === 3 ? 'big' : power === 2 ? 'med' : 'light';
      const side = ['l', 'r', 'c'][Math.floor(this.rng() * 3)];
      react = `mx_fhit_head_${size}_${side}`;
      if (last && power === 3 && this.rng() < 0.4) react = this.rng() < 0.5 ? 'mx_fight_hit_front' : 'mx_fight_recv_uppercut';
    }
    rigD.play(react, { rootMotion: true, rmScale: 0.8, fadeIn: 0.05, fadeOut: 0.3 });
  }

  damage(p, amount, from) {
    if (this.over) return;
    const W = this.winner;
    let hp = this.hp[p] - amount;
    if (W) {
      if (p === W) hp = Math.max(hp, 32);     // the winner never gets close to losing
      else hp = Math.max(hp, 6);              // the loser is only finished by the finisher
    } else {
      hp = Math.max(hp, 22);
    }
    this.hp[p] = hp;
    if (from) this.combo[p] = 0;
  }

  async knockdown(p) {
    const st = this.dj.characterStates[p];
    const rig = this.dj.rigs[p];
    st.noFace = true;
    const fall = this.rng() < 0.5 ? 'mx_fight_knockdown' : 'mx_knocked_down';
    rig.play(fall, { rootMotion: true, rmScale: 0.8, hold: true, fadeIn: 0.05 });
    this.shake = 0.12;
    this.sound('thud', 0.6);
    this.popText(p, 'KNOCKDOWN!', '#ff5a3a', true);
    this.dj.arena?.cheer(2.5);
    const opp = p === 1 ? 2 : 1;
    await this.wait(1.4);
    if (!this.active) return;
    this.dj.rigs[opp].play(this.rng() < 0.5 ? 'mx_fight_taunt' : 'mx_fight_threaten', { rootMotion: false, fadeIn: 0.2, fadeOut: 0.3 });
    await this.wait(1.6);
    if (!this.active) return;
    const getup = fall === 'mx_fight_knockdown' ? 'mx_getup_knockdown' : 'mx_getup_stomach';
    rig.play(getup, { rootMotion: true, fadeIn: 0.25, fadeOut: 0.35, timeScale: getup === 'mx_getup_stomach' ? 1.6 : 1.2 });
    await this.wait(rig.remaining() + 0.1);
    st.noFace = false;
  }

  async sweepDown(p) {
    const st = this.dj.characterStates[p];
    const rig = this.dj.rigs[p];
    st.noFace = true;
    rig.play('mx_sweep_fall', { rootMotion: true, rmScale: 0.6, hold: true, fadeIn: 0.05 });
    this.sound('thud', 0.5);
    this.popText(p, 'SWEPT!', '#ffb03a', true);
    await this.wait(2.3);
    if (!this.active) return;
    rig.play('mx_getup_back', { rootMotion: true, fadeIn: 0.25, fadeOut: 0.35, timeScale: 1.9 });
    await this.wait(rig.remaining() + 0.1);
    st.noFace = false;
  }

  async reposition() {
    // Someone shuffles: side step or step back to reset
    const p = this.rng() < 0.5 ? 1 : 2;
    const move = ['mx_fight_sidestep_left', 'mx_fight_sidestep_right', 'mx_fight_step_back'][Math.floor(this.rng() * 3)];
    const rig = this.dj.rigs[p];
    rig.play(move, { rootMotion: true, rmScale: 0.7, fadeIn: 0.1, fadeOut: 0.2 });
    if (this.rng() < 0.4) {
      const o = p === 1 ? 2 : 1;
      this.dj.rigs[o].play(this.rng() < 0.5 ? 'mx_fight_taunt' : 'mx_fight_flex', { rootMotion: false, fadeIn: 0.2, fadeOut: 0.3, timeScale: 1.2 });
      await this.wait(1.3);
    } else {
      await this.wait(0.6);
    }
  }

  /** Paired shoulder throw / takedown: both clips share an origin, so align them */
  async pairedThrow(W, L) {
    const pairs = [['mx_fight_throw_attacker', 'mx_fight_throw_victim'], ['mx_fight_surprise_uppercut_attacker', 'mx_fight_surprise_uppercut_victim']];
    const [aId, vId] = pairs[Math.floor(this.rng() * pairs.length)];
    const a = this.dj.mocap.get(aId);
    const v = this.dj.mocap.get(vId);
    const rigA = this.dj.rigs[W];
    const rigV = this.dj.rigs[L];
    if (!a || !v || !rigA || !rigV) return;
    await this.setRange(W, L, 1.0);
    const stA = this.dj.characterStates[W];
    const stV = this.dj.characterStates[L];
    const A = this.dj.characters[W].position;
    const s = rigA.hipScale * rigA.unitToWorld;
    // Raw clip-space start positions and headings
    const rawA = this.rawStart(a.rm);
    const rawV = this.rawStart(v.rm);
    const theta = stA.facing - a.rm.h0;
    const dx = (rawV.x - rawA.x) * s;
    const dz = (rawV.z - rawA.z) * s;
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    const V = this.dj.characters[L].position;
    V.x = A.x + dx * c + dz * sn;
    V.z = A.z - dx * sn + dz * c;
    stV.facing = v.rm.h0 + theta;
    stA.noFace = true;
    stV.noFace = true;
    this.popText(W, 'THROW!', '#ff9a3a', true);
    rigA.play(aId, { rootMotion: true, fadeIn: 0.15, fadeOut: 0.4 });
    rigV.play(vId, {
      rootMotion: true, hold: true, fadeIn: 0.15,
      onTime: [{ t: v.clip.duration * 0.62, fn: () => { this.shake = 0.14; this.sound('thud', 0.8); this.damage(L, 16, W); this.dj.arena?.cheer(2); } }]
    });
    await this.wait(v.clip.duration + 0.4);
    if (!this.active) return;
    rigV.play('mx_getup_back', { rootMotion: true, fadeIn: 0.25, fadeOut: 0.35, timeScale: 1.8 });
    await this.wait(rigV.remaining() + 0.1);
    stA.noFace = false;
    stV.noFace = false;
  }

  rawStart(rm) {
    // processClip stored the start offset in the clip's facing frame; rotate it back
    const c = Math.cos(rm.h0);
    const s = Math.sin(rm.h0);
    return { x: rm.x0 * c + rm.z0 * s, z: -rm.x0 * s + rm.z0 * c };
  }

  /** Hadouken from range: the defender eats it or jumps it */
  async fireball(atk, def, draw) {
    await this.setRange(atk, def, 2.3);
    const rigA = this.dj.rigs[atk];
    const rigD = this.dj.rigs[def];
    const entry = this.dj.mocap.byId.mx_fight_hadouken;
    const release = entry?.hits?.[0] ?? 2.2;
    const evade = draw ? this.rng() < 0.5 : def === this.winner ? this.rng() < 0.7 : this.rng() < 0.2;
    this.popText(atk, 'HADOUKEN!', '#5ad8ff', true);
    rigA.play('mx_fight_hadouken', {
      rootMotion: false, fadeIn: 0.15, fadeOut: 0.3,
      onTime: [{ t: release, fn: () => this.launchProjectile(atk, def, evade) }]
    });
    if (evade) {
      const dist = this.distance();
      const travelTime = dist / 4.2;
      await this.wait(release + travelTime - 0.45);
      rigD.play(this.rng() < 0.5 ? 'mx_fdodge_aerial' : 'mx_fdodge_jump_back', { rootMotion: true, rmScale: 0.35, fadeIn: 0.08, fadeOut: 0.3 });
      await this.wait(1.6);
    } else {
      await this.wait(release + 1.4);
    }
  }

  launchProjectile(atk, def, evade) {
    const from = this.bonePos(atk, 'RightHand');
    const mat = new THREE.SpriteMaterial({ map: this.glowTex, color: 0x5ad8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(0.55);
    sprite.position.copy(from);
    this.dj.scene.add(sprite);
    const light = new THREE.PointLight(0x5ad8ff, 8, 4, 2);
    sprite.add(light);
    this.sound('fireball');
    this.projectiles.push({ sprite, mat, atk, def, evade, speed: 4.2, life: 0 });
  }

  async finisher(W, L) {
    const finishers = ['mx_fight_uppercut_back', 'mx_fight_kick_spin_back', 'mx_fight_flip_kick', 'mx_fight_hurricane_kick', 'mx_fight_armada', 'mx_fight_kick_high', 'mx_fight_uppercut_lead'];
    const id = finishers[Math.floor(this.rng() * finishers.length)];
    const attack = this.dj.mocap.byId[id];
    const rigL = this.dj.rigs[L];
    const lastHit = attack.hits[attack.hits.length - 1];
    // The finisher: everything goes in slow motion at the moment of impact
    const strikePromise = this.strike(W, L, attack, 'hit', { finisher: true });
    await this.wait(0.05);
    // Wait for the final impact (strike() may first step into range)
    const t0 = this.time;
    await new Promise(resolve => {
      const check = () => {
        if (!this.active) return resolve();
        const cur = this.dj.rigs[W].oneShot;
        if (cur?.id === id && cur.a.action.time >= lastHit - 0.02) return resolve();
        if (this.time - t0 > 6) return resolve();
        this.wait(0.02).then(check, resolve);
      };
      check();
    });
    if (!this.active) return;
    this.hp[L] = 0;
    this.over = true;
    this.slowmo = 0.3;
    this.slowUntil = this.time + 0.55;
    this.shake = 0.22;
    this.sound('ko');
    const ko = attack.id.includes('kick') || attack.id.includes('armada') ? 'mx_fko_flying_back' : (this.rng() < 0.5 ? 'mx_fko_fall_back' : 'mx_fko_flying_back');
    this.dj.characterStates[L].noFace = true;
    rigL.play(ko, { rootMotion: true, hold: true, fadeIn: 0.05 });
    this.banner('K.O.', 2.2, 'ko');
    this.dj.arena?.cheer(6);
    this.dj.triggerCameraFlashes?.(10);
    await strikePromise;
    await this.wait(1.6);
    if (!this.active) return;
    this.dj.characterStates[W].noFace = true;
    this.dj.rigs[W].play(this.rng() < 0.5 ? 'mx_fight_victory_boxing' : 'mx_fight_victory', { rootMotion: false, fadeIn: 0.3, fadeOut: 0.4 });
    this.banner(`${this.names[W].toUpperCase()} WINS`, 3.2, 'win');
    this.dj.triggerSmokeBlast?.(3, W === 1 ? 0xff2d2d : 0x00e5ff);
    this.dj.burstConfetti?.(W === 1 ? [0xff2d2d, 0xffd21a, 0xffffff] : [0x00e5ff, 0xffd21a, 0xffffff]);
    await this.wait(2.8);
    if (!this.active) return;
    // The loser picks himself up and owns it
    rigL.play('mx_getup_back', { rootMotion: true, fadeIn: 0.3, fadeOut: 0.4, timeScale: 1.4 });
    await this.wait(rigL.remaining());
    if (!this.active) return;
    // Give the winner some room, then take the loss
    const gap = this.distance();
    if (gap < 1.1) {
      const step = Math.abs(this.travel('mx_fight_step_back', L).dz) || 0.7;
      rigL.play('mx_fight_step_back', { rootMotion: true, rmScale: THREE.MathUtils.clamp((1.3 - gap) / step, 0.3, 1.8), fadeIn: 0.15, fadeOut: 0.2 });
      await this.wait(rigL.remaining() - 0.1);
      if (!this.active) return;
    }
    rigL.play('mx_fight_defeat', { rootMotion: false, fadeIn: 0.3, fadeOut: 0.5 });
  }

  async doubleKO() {
    // Both throw a big shot at the same time and both go down
    const atk = this.dj.mocap.byId.mx_fight_cross;
    await this.setRange(1, 2, atk.reach || 0.95);
    [1, 2].forEach(p => this.dj.rigs[p].play('mx_fight_cross', { rootMotion: false, fadeIn: 0.1 }));
    await this.wait(atk.hits[0]);
    if (!this.active) return;
    this.slowmo = 0.3;
    this.slowUntil = this.time + 0.5;
    this.shake = 0.2;
    this.sound('ko');
    this.over = true;
    [1, 2].forEach(p => {
      this.hp[p] = 0;
      this.spark(this.bonePos(p, 'Head'), 0xffd04a, 1.3);
      this.dj.characterStates[p].noFace = true;
      this.dj.rigs[p].play('mx_fko_fall_back', { rootMotion: true, hold: true, fadeIn: 0.05 });
    });
    this.banner('DOUBLE K.O.', 3, 'ko');
    this.dj.arena?.cheer(5);
    await this.wait(3.6);
    if (!this.active) return;
    [1, 2].forEach(p => this.dj.rigs[p].play('mx_getup_back', { rootMotion: true, fadeIn: 0.3, fadeOut: 0.4, timeScale: 1.4 }));
  }

  /* ---------------- helpers ---------------- */

  distance() {
    const A = this.dj.characters[1].position;
    const B = this.dj.characters[2].position;
    return Math.hypot(B.x - A.x, B.z - A.z);
  }

  wait(sec) {
    return new Promise((resolve, reject) => {
      if (!this.active) return reject('stopped');
      this.waiters.push({ at: this.time + Math.max(0, sec), resolve, reject });
    });
  }

  bonePos(p, name) {
    const char = this.dj.characters[p];
    const rig = this.dj.rigs[p];
    const out = new THREE.Vector3();
    if (!char) return out;
    this._bones = this._bones || {};
    const key = p + name + (rig?.prefix || '') + char.uuid;
    let b = this._bones[key];
    if (!b) {
      char.traverse(n => { if (!b && n.isBone && n.name === (rig?.prefix || '') + name) b = n; });
      this._bones[key] = b;
    }
    if (b) b.getWorldPosition(out);
    else out.copy(char.position).setY(1.4);
    return out;
  }

  /* ---------------- effects ---------------- */

  spark(pos, color, size = 1) {
    const scene = this.dj.scene;
    const n = 14;
    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
      const s = new THREE.Sprite(mat);
      s.position.copy(pos);
      const k = (0.05 + Math.random() * 0.08) * size;
      s.scale.setScalar(k);
      scene.add(s);
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 - 0.2, Math.random() - 0.5).normalize().multiplyScalar(1.5 + Math.random() * 2.5 * size);
      this.sparks.push({ s, mat, v: dir, life: 0, max: 0.25 + Math.random() * 0.25, k });
    }
    // Flash core
    const mat = new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
    const core = new THREE.Sprite(mat);
    core.position.copy(pos);
    core.scale.setScalar(0.35 * size);
    scene.add(core);
    this.sparks.push({ s: core, mat, v: new THREE.Vector3(), life: 0, max: 0.14, k: 0.35 * size, grow: 2.6 });
  }

  updateEffects(gdt, dt) {
    const scene = this.dj.scene;
    this.sparks = this.sparks.filter(p => {
      p.life += dt;
      const u = p.life / p.max;
      if (u >= 1) {
        scene.remove(p.s);
        p.mat.dispose();
        return false;
      }
      p.s.position.addScaledVector(p.v, dt);
      p.v.y -= 6 * dt;
      p.mat.opacity = 1 - u;
      if (p.grow) p.s.scale.setScalar(p.k * (1 + u * p.grow));
      return true;
    });
    this.projectiles = this.projectiles.filter(pr => {
      pr.life += gdt;
      const target = this.bonePos(pr.def, 'Spine2');
      const dir = target.clone().sub(pr.sprite.position);
      const d = dir.length();
      pr.sprite.material.rotation += gdt * 8;
      pr.sprite.scale.setScalar(0.5 + Math.sin(pr.life * 30) * 0.06);
      if (d < 0.25 || pr.life > 3) {
        if (!pr.evade && pr.life <= 3) {
          this.spark(target, 0x5ad8ff, 1.6);
          this.sound('heavy');
          this.shake = 0.15;
          this.damage(pr.def, 14, pr.atk);
          this.dj.rigs[pr.def].play('mx_fight_hit_front', { rootMotion: true, rmScale: 0.9, fadeIn: 0.05, fadeOut: 0.3 });
        }
        scene.remove(pr.sprite);
        pr.mat.dispose();
        return false;
      }
      // Fly straight at chest height (evaded ones keep going past)
      const step = pr.speed * gdt;
      if (pr.evade && pr.dir) pr.sprite.position.addScaledVector(pr.dir, step);
      else {
        pr.dir = dir.normalize();
        pr.sprite.position.addScaledVector(pr.dir, Math.min(step, d));
      }
      return true;
    });
    this.shake *= Math.exp(-dt * 7);
  }

  setCamera() {
    this.dj.cameraOverride = (camPos, target) => {
      const A = this.dj.characters[1].position;
      const B = this.dj.characters[2].position;
      const mid = new THREE.Vector3((A.x + B.x) / 2, 1.0, (A.z + B.z) / 2);
      const span = Math.max(1.2, Math.hypot(B.x - A.x, B.z - A.z));
      const t = this.time * 0.15;
      const radius = 2.6 + span * 0.8;
      // Side-on to the line between the fighters, from the audience side
      let px = -(B.z - A.z);
      let pz = B.x - A.x;
      const pl = Math.hypot(px, pz) || 1;
      px /= pl; pz /= pl;
      if (pz < 0) { px = -px; pz = -pz; }
      // Drift a little around that angle for life
      const sway = Math.sin(t) * 0.35;
      const cx = px * Math.cos(sway) + pz * Math.sin(sway);
      const cz = -px * Math.sin(sway) + pz * Math.cos(sway);
      camPos.set(mid.x + cx * radius, 1.3 + Math.sin(t * 0.7) * 0.12, mid.z + Math.max(0.6, cz) * radius);
      // Stay inside the pit (the crowd starts at ~6 m)
      const cr = Math.hypot(camPos.x, camPos.z);
      if (cr > 5.4) { camPos.x *= 5.4 / cr; camPos.z *= 5.4 / cr; }
      target.copy(mid);
      if (this.shake > 0.002) {
        camPos.x += (Math.random() - 0.5) * this.shake;
        camPos.y += (Math.random() - 0.5) * this.shake;
        target.x += (Math.random() - 0.5) * this.shake * 0.5;
      }
    };
  }

  updateCamera() {}

  /* ---------------- HUD ---------------- */

  buildHud() {
    this.removeHud();
    const hud = document.createElement('div');
    hud.className = 'fight-hud';
    hud.innerHTML = `
      <div class="fight-bars">
        <div class="fight-side p1">
          <div class="fight-name">${this.esc(this.names[1])}</div>
          <div class="fight-bar"><div class="fight-bar-lag"></div><div class="fight-bar-fill"></div></div>
        </div>
        <div class="fight-vs">VS</div>
        <div class="fight-side p2">
          <div class="fight-name">${this.esc(this.names[2])}</div>
          <div class="fight-bar"><div class="fight-bar-lag"></div><div class="fight-bar-fill"></div></div>
        </div>
      </div>
      <div class="fight-banner"></div>
      <button type="button" class="fight-skip">Skip fight ⏭</button>`;
    document.body.appendChild(hud);
    document.documentElement.classList.add('fight-active');
    hud.querySelector('.fight-skip').addEventListener('click', () => this.stop());
    this.hud = hud;
    this.lag = { 1: MAX_HP, 2: MAX_HP };
  }

  removeHud() {
    this.hud?.remove();
    this.hud = null;
    document.documentElement.classList.remove('fight-active');
  }

  updateHud() {
    if (!this.hud) return;
    [1, 2].forEach(p => {
      const side = this.hud.querySelector(`.fight-side.p${p}`);
      const pct = Math.max(0, this.hp[p]) / MAX_HP;
      side.querySelector('.fight-bar-fill').style.transform = `scaleX(${pct})`;
      this.lag[p] += (this.hp[p] - this.lag[p]) * 0.04;
      side.querySelector('.fight-bar-lag').style.transform = `scaleX(${Math.max(0, this.lag[p]) / MAX_HP})`;
      side.classList.toggle('danger', pct < 0.3);
    });
  }

  banner(text, secs = 1.2, kind = '') {
    if (!this.hud) return;
    const b = this.hud.querySelector('.fight-banner');
    b.textContent = text;
    b.className = `fight-banner show ${kind}`;
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => { if (b) b.className = 'fight-banner'; }, secs * 1000 / Math.max(0.3, this.slowmo));
  }

  popText(p, text, color, big = false) {
    if (!this.hud) return;
    const el = document.createElement('div');
    el.className = `fight-pop p${p}${big ? ' big' : ''}`;
    el.textContent = text;
    el.style.color = color;
    this.hud.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /* ---------------- sound (synthesised, no files needed) ---------------- */

  ensureAudio() {
    try {
      this.audio = this.audio || new (window.AudioContext || window.webkitAudioContext)();
      if (this.audio.state === 'suspended') this.audio.resume();
    } catch {
      this.audio = null;
    }
  }

  sound(kind, vol = 1) {
    const ctx = this.audio;
    if (!ctx) return;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.5 * vol;
    out.connect(ctx.destination);
    const noise = (dur, freq, q = 1, type = 'lowpass') => {
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      src.connect(f).connect(out);
      src.start(now);
      return f;
    };
    const tone = (freq, dur, endFreq, type = 'sine', gain = 1) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, now);
      if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, now + dur);
      g.gain.setValueAtTime(gain, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur);
      o.connect(g).connect(out);
      o.start(now);
      o.stop(now + dur + 0.02);
    };
    switch (kind) {
      case 'punch': noise(0.09, 1800); tone(140, 0.12, 60, 'sine', 0.9); break;
      case 'heavy': noise(0.16, 1200); tone(110, 0.25, 40, 'sine', 1.2); break;
      case 'block': noise(0.06, 3200, 3, 'bandpass'); tone(420, 0.08, 300, 'triangle', 0.3); break;
      case 'whoosh': { const f = noise(0.22, 600, 2, 'bandpass'); f.frequency.exponentialRampToValueAtTime(2400, now + 0.2); out.gain.value = 0.18 * vol; break; }
      case 'thud': noise(0.3, 400); tone(70, 0.4, 35, 'sine', 1.4); break;
      case 'ko': noise(0.5, 900); tone(90, 0.9, 30, 'sine', 1.6); tone(55, 1.2, 28, 'triangle', 0.8); break;
      case 'fireball': { const f = noise(0.6, 300, 4, 'bandpass'); f.frequency.exponentialRampToValueAtTime(1800, now + 0.5); tone(220, 0.5, 660, 'sawtooth', 0.15); break; }
      case 'bell': tone(880, 1.4, null, 'sine', 0.6); tone(1320, 1.0, null, 'sine', 0.3); tone(660, 1.6, null, 'triangle', 0.2); break;
      case 'fight': tone(330, 0.35, 660, 'square', 0.15); break;
      default: break;
    }
  }
}

export { FightDirector, mulberry32 };
