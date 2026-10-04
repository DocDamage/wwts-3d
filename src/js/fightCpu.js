/**
 * The computer opponent: reads, reactions, spacing and combos per difficulty.
 *
 * Mixed into FightGame.prototype (see fightGame.js); `this` is the game.
 */
import { DIFFICULTY } from './fightData.js';

const CpuMixin = {
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
};

export { CpuMixin };
