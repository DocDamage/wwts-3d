/**
 * Training mode: dummy behaviours, damage and frame-data readout, input log, refills.
 *
 * Mixed into FightGame.prototype (see fightGame.js); `this` is the game.
 */
import { ARENA, MAX_HP, MIN_GAP, MOVES } from './fightData.js';

const TrainingMixin = {
  /* ================= training ================= */

  buildTrainingHud() {
    const box = document.createElement('div');
    box.className = 'fight-training';
    box.innerHTML = `
      <div class="ft-row"><label>Dummy <select id="ft-dummy">
        <option value="stand">Stand</option><option value="crouch">Crouch</option><option value="guard">Guard all</option>
        <option value="guardlow">Crouch guard</option><option value="random">Guard randomly</option><option value="sidestep">Sidestep</option>
        <option value="jump">Jump</option><option value="parry">Parry</option><option value="cpu-easy">CPU (easy)</option><option value="cpu-normal">CPU (normal)</option><option value="cpu-hard">CPU (hard)</option>
      </select></label><label class="ft-check"><input type="checkbox" id="ft-meter" checked /> Full meter</label></div>
      <div class="ft-stats" id="ft-stats">Land a hit to see damage and frame data</div>
      <div class="ft-inputs" id="ft-inputs" aria-label="Your recent inputs"></div>`;
    this.hud.appendChild(box);
    const sel = box.querySelector('#ft-dummy');
    sel.value = this.opts.dummy || 'stand';
    sel.addEventListener('change', () => { this.opts.dummy = sel.value; });
    box.querySelector('#ft-meter').addEventListener('change', (e) => { this.trainMeter = e.target.checked; });
    this.trainMeter = true;
    this.inputLog = [];
  },

  /** Training dummy behaviour (unless set to a CPU level) */
  dummyInput(p) {
    const d = this.opts.dummy || 'stand';
    const f = this.f[p];
    const o = this.other(f);
    const inp = { x: 0, up: false, down: false, guard: false, pressed: new Set(), upTap: false, downTap: false, upHold: false, downHold: false };
    if (!this.roundLive) return inp;
    const threat = this.threatened(f, o);
    if (d === 'crouch') { inp.down = inp.downHold = true; }
    else if (d === 'guard') { inp.guard = true; if (threat && o.mv?.level === 'low') inp.down = inp.downHold = true; }
    else if (d === 'guardlow') { inp.guard = true; inp.down = inp.downHold = true; }
    else if (d === 'random') {
      if (threat) { if (f._rg === undefined) f._rg = Math.random() < 0.5; inp.guard = f._rg; if (inp.guard && o.mv?.level === 'low') inp.down = inp.downHold = true; }
      else f._rg = undefined;
    }
    else if (d === 'sidestep') { if (threat && this.isFree(f) && this.time > (f._ssT || 0)) { f._ssT = this.time + 0.8; inp.upPress = true; } }
    else if (d === 'jump') { if (this.isFree(f) && this.time > (f._jT || 0)) { f._jT = this.time + 1.4; inp.up = inp.upHold = true; } }
    else if (d === 'parry') { if (threat && this.isFree(f) && this.time > (f._pT || 0)) { f._pT = this.time + 0.7; inp.pressed.add('parry'); } }
    return inp;
  },

  /** Damage + frame data readout after each hit */
  noteTraining(f, o, mv, dmg, counter) {
    if (f.p !== 1) return;
    const el = document.getElementById('ft-stats');
    if (!el) return;
    const first = mv.hits?.[0];
    const startup = first ? Math.round(((first.t - mv.from) / mv.ts) * 60) : 0;
    const adv = Math.round(((o.until || this.time) - (f.until || this.time)) * 60);
    el.innerHTML = `<b>${MOVES[mv.key]?.name || mv.key}</b> · ${mv.level} · ${dmg} dmg${counter ? ' · <span class="ft-ch">COUNTER</span>' : ''}<br>
      Combo <b>${f.combo}</b> hits · <b>${f.comboDmg}</b> dmg · startup ${startup}f · ${adv >= 0 ? '+' : ''}${adv}f on hit`;
  },

  /** Training: refill health / meter once things calm down; log P1's inputs */
  tickTraining(inp1) {
    const f1 = this.f[1];
    const f2 = this.f[2];
    if (this.isFree(f1) && this.isFree(f2)) {
      this._calm = (this._calm || 0) + 1;
      if (this._calm > 50 && (f1.hp < MAX_HP || f2.hp < MAX_HP)) { f1.hp = f2.hp = MAX_HP; this.syncHp(); }
    } else this._calm = 0;
    if (this.trainMeter) f1.meter = 100;
    const dirs = { n: '•', f: '→', b: '←', d: '↓', u: '↑', df: '↘', db: '↙', uf: '↗', ub: '↖' };
    const btn = [...(inp1?.pressed || [])].map(b => b.toUpperCase()).join('+');
    const dir = f1.lastDir;
    const key = `${dir}|${btn}`;
    if (btn || key !== this._lastInputKey) {
      this._lastInputKey = key;
      if (btn || dir !== 'n') {
        this.inputLog.unshift(`${dirs[dir] || dir}${btn ? ' ' + btn : ''}`);
        this.inputLog = this.inputLog.slice(0, 14);
        const el = document.getElementById('ft-inputs');
        if (el) el.innerHTML = this.inputLog.map(t => `<span>${t}</span>`).join('');
      }
    }
  },

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
  },

  /** Which strafe clip shows moving `vert` (+1 toward camera) for this fighter */
  strafeSign(f, vert) {
    const opp = this.toOpp(f);
    const left = { x: opp.y, z: -opp.x };    // the fighter's left
    let px = -opp.y;
    let pz = opp.x;
    if (px * this.camN.x + pz * this.camN.y < 0) { px = -px; pz = -pz; }
    const side = (px * left.x + pz * left.z) * vert;
    return side > 0 ? -1 : 1;   // strafe: -1 left, +1 right
  },

  toIdle(f) {
    const rig = this.dj.rigs[f.p];
    if (['crouch', 'guard', 'attack', 'airattack', 'hitstun', 'blockstun', 'stun', 'parry', 'land', 'getup'].includes(f.state)) rig.stop(0.2);
    this.setState(f, 'idle');
    f.mv = null;
    f.lockAim = false;
    f.crouching = false;
    f.guardPose = false;
    f.yawTarget = f.idleYaw ?? this.idleYaw;
    f.airAttacked = false;
    f.wallSplat = false;
    // the opponent's combo ends once we're free again
    const o = this.other(f);
    if (o.combo) { o.combo = 0; o.comboDmg = 0; }
    f.juggle = 0;
  },

  /** Is the opponent swinging at us right now? (holding back then shows a guard) */
  threatened(f, o) {
    const d = this.dist();
    if (['attack', 'airattack'].includes(o.state) && o.mv && d < (o.mv.reach || 1.3) + 0.9) return true;
    return this.shots.some(s => s.owner === o.p && s.pos.distanceTo(this.pos(f.p)) < 2.5);
  },

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
  },

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
    // re-centre only on an open stage (walls and ring-outs are where the edge matters)
    if (this.opts.arena === 'open' && Math.hypot(ex, ez) > 0.9) {
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
};

export { TrainingMixin };
