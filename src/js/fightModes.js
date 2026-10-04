/**
 * Fight Club ladders: Arcade, Survival, Time Attack and Tournament.
 *
 *  Arcade       6 opponents, CPU gets tougher, a monster boss at the end; lose and
 *               you can continue against the same opponent
 *  Survival     one round per opponent, your health carries over (+25 between
 *               fights) — how far can you go?
 *  Time Attack  4 opponents, single rounds, against the clock
 *  Tournament   8-fighter knockout bracket; your matches are played, the CPU vs CPU
 *               matches are decided off-screen (style strength + luck)
 */
import { CAST } from './fightCast.js';
import { styleFor } from './fightStyles.js';

const BOSSES = ['warrok', 'mutant'];

function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

function pickOpponents(player, n, { boss = false } = {}) {
  const pool = shuffle(CAST.map(c => c.key).filter(k => k !== player && !BOSSES.includes(k)));
  const list = pool.slice(0, boss ? n - 1 : n);
  if (boss) list.push(BOSSES[Math.floor(Math.random() * BOSSES.length)]);
  return list;
}

/** CPU vs CPU result for the tournament (stronger styles win a bit more often) */
function simulate(a, b) {
  const sa = styleFor(CAST.find(c => c.key === a));
  const sb = styleFor(CAST.find(c => c.key === b));
  const pa = (sa.power || 1) * (sa.toughness || 1) * (sa.speed || 1);
  const pb = (sb.power || 1) * (sb.toughness || 1) * (sb.speed || 1);
  return Math.random() < pa / (pa + pb) ? a : b;
}

class LadderRunner {
  constructor(screen) {
    this.screen = screen;
    this.game = screen.game;
  }

  nameOf(key) {
    return CAST.find(c => c.key === key)?.name || key;
  }

  /** VS card between fights */
  async vsCard(step, opp, sub, ladderHtml = '') {
    const $ = (id) => document.getElementById(id);
    $('fs-vs-step').textContent = step;
    $('fs-vs-1').textContent = this.nameOf(this.player);
    $('fs-vs-2').textContent = this.nameOf(opp);
    $('fs-vs-sub').textContent = sub || '';
    $('fs-ladder').innerHTML = ladderHtml;
    $('fs-vs').hidden = false;
    window.announcer?.playFile?.(Math.random() < 0.5 ? 'herecomesanewchallenger.wav' : 'getreadyforthenextfight.wav');
    await new Promise(r => setTimeout(r, 2600));
    $('fs-vs').hidden = true;
  }

  ladderList(opps, at) {
    return opps.map((k, i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}">${this.nameOf(k)}</li>`).join('');
  }

  async fight(opp, extra = {}) {
    await this.screen.loadFighters(this.player, opp);
    if (this.cancelled) return null;
    const res = await this.game.startMatch({ p1: this.player, p2: opp, mode: 'cpu', ladder: true, arena: this.screen.arena(), ...extra });
    return res;
  }

  async run(type, player) {
    this.player = player;
    this.cancelled = false;
    const s = this.screen;
    if (type === 'arcade') return this.arcade();
    if (type === 'survival') return this.survival();
    if (type === 'timeattack') return this.timeAttack();
    if (type === 'tournament') return this.tournament();
    return s.showSelect();
  }

  async arcade() {
    const opps = pickOpponents(this.player, 6, { boss: true });
    const diffs = ['easy', 'easy', 'normal', 'normal', 'hard', 'hard'];
    for (let i = 0; i < opps.length; i++) {
      let won = false;
      while (!won) {
        await this.vsCard(i === opps.length - 1 ? 'FINAL BOSS' : `STAGE ${i + 1} / ${opps.length}`, opps[i], `CPU: ${diffs[i]}`, this.ladderList(opps, i));
        const res = await this.fight(opps[i], { difficulty: diffs[i], rounds: 3, roundTime: 99 });
        if (!res || this.cancelled) return;
        won = res.winner === 1;
        if (!won) {
          const again = await this.screen.ask('YOU LOSE', `Beaten by ${this.nameOf(opps[i])} on stage ${i + 1}.`, ['Continue', 'Quit']);
          if (again !== 0) return this.screen.showSelect();
        }
      }
    }
    window.announcer?.playFile?.('youreincredible.wav');
    await this.screen.ask('ARCADE CLEAR!', `${this.nameOf(this.player)} beat all ${opps.length} opponents.`, ['Done']);
    this.screen.showSelect();
  }

  async survival() {
    let hp = 100;
    let beaten = 0;
    const order = shuffle(CAST.map(c => c.key).filter(k => k !== this.player));
    for (let i = 0; ; i++) {
      const opp = order[i % order.length];
      const diff = beaten < 3 ? 'easy' : beaten < 7 ? 'normal' : 'hard';
      await this.vsCard(`SURVIVAL · FIGHT ${i + 1}`, opp, `Health ${Math.round(hp)} · ${beaten} beaten`);
      const res = await this.fight(opp, { difficulty: diff, rounds: 1, roundTime: 99, hp1: hp });
      if (!res || this.cancelled) return;
      if (res.winner !== 1) break;
      beaten++;
      hp = Math.min(100, res.hp[1] + 25);
    }
    this.saveRecord('survival', beaten, (a, b) => b > a);
    await this.screen.ask('SURVIVAL OVER', `${this.nameOf(this.player)} beat ${beaten} opponent${beaten === 1 ? '' : 's'}. Best: ${this.record('survival') ?? beaten}.`, ['Done']);
    this.screen.showSelect();
  }

  async timeAttack() {
    const opps = pickOpponents(this.player, 4);
    const t0 = performance.now();
    for (let i = 0; i < opps.length; i++) {
      await this.vsCard(`TIME ATTACK · ${i + 1} / ${opps.length}`, opps[i], `Clock: ${((performance.now() - t0) / 1000).toFixed(1)} s`, this.ladderList(opps, i));
      const res = await this.fight(opps[i], { difficulty: 'normal', rounds: 1, roundTime: 99 });
      if (!res || this.cancelled) return;
      if (res.winner !== 1) {
        await this.screen.ask('TIME ATTACK FAILED', `Lost to ${this.nameOf(opps[i])}. The run doesn't count.`, ['Done']);
        return this.screen.showSelect();
      }
    }
    const secs = (performance.now() - t0) / 1000;
    this.saveRecord('timeattack', secs, (a, b) => b < a);
    await this.screen.ask('TIME ATTACK CLEAR', `${secs.toFixed(1)} seconds. Best: ${(this.record('timeattack') ?? secs).toFixed(1)} s.`, ['Done']);
    this.screen.showSelect();
  }

  async tournament() {
    let field = shuffle([this.player, ...pickOpponents(this.player, 7)]);
    const rounds = ['QUARTER-FINALS', 'SEMI-FINALS', 'FINAL'];
    for (let r = 0; r < rounds.length; r++) {
      const next = [];
      const html = (pairs, done) => pairs.map((p, i) => `<li class="${done[i] ? 'done' : ''}">${this.nameOf(p[0])} vs ${this.nameOf(p[1])}${done[i] ? ` → <b>${this.nameOf(done[i])}</b>` : ''}</li>`).join('');
      const pairs = [];
      for (let i = 0; i < field.length; i += 2) pairs.push([field[i], field[i + 1]]);
      const done = pairs.map(() => null);
      for (let i = 0; i < pairs.length; i++) {
        const [a, b] = pairs[i];
        if (a !== this.player && b !== this.player) { done[i] = simulate(a, b); next.push(done[i]); continue; }
        const opp = a === this.player ? b : a;
        await this.vsCard(rounds[r], opp, 'Tournament', html(pairs, done));
        const res = await this.fight(opp, { difficulty: r === 2 ? 'hard' : 'normal', rounds: 3, roundTime: 99 });
        if (!res || this.cancelled) return;
        if (res.winner !== 1) {
          await this.screen.ask('KNOCKED OUT', `${this.nameOf(opp)} eliminated you in the ${rounds[r].toLowerCase()}.`, ['Done']);
          return this.screen.showSelect();
        }
        done[i] = this.player;
        next.push(this.player);
      }
      field = next;
    }
    window.announcer?.playFile?.('youreinfirstplace.wav');
    await this.screen.ask('TOURNAMENT CHAMPION!', `${this.nameOf(this.player)} won the 8-fighter bracket.`, ['Done']);
    this.screen.showSelect();
  }

  record(key) {
    try { return JSON.parse(localStorage.getItem('wwts_fight_records_v1') || '{}')[key] ?? null; } catch { return null; }
  }

  saveRecord(key, value, better) {
    try {
      const all = JSON.parse(localStorage.getItem('wwts_fight_records_v1') || '{}');
      if (all[key] === undefined || better(all[key], value)) all[key] = value;
      localStorage.setItem('wwts_fight_records_v1', JSON.stringify(all));
    } catch { /* storage blocked */ }
  }
}

const MODE_INFO = {
  cpu: 'One match against the computer.',
  '2p': 'Two players on one machine (keyboard halves or two gamepads).',
  training: 'Practise freely: set the dummy, see damage and frame data, health refills.',
  arcade: '6 opponents getting tougher, then a boss. Continue if you lose.',
  survival: 'One round each, health carries over (+25 between). How far can you go?',
  timeattack: 'Beat 4 opponents as fast as you can.',
  tournament: '8-fighter knockout bracket — win three matches to take the title.'
};

export { LadderRunner, MODE_INFO, simulate, pickOpponents };
