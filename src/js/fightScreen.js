/**
 * Fight Club screen: character select (live preview on the 3D stage),
 * mode / difficulty / rounds / timer, then hands off to FightGame.
 */
import { CAST, CAST_BY_KEY } from './fightCast.js';
import { FightGame, COMMAND_HELP, ARENA } from './fightGame.js';
import { styleFor } from './fightStyles.js';

const LINE_Z = ARENA.cz;
const STORE = 'wwts_fight_setup_v1';

class FightScreen {
  constructor(dj) {
    this.dj = dj;
    this.game = new FightGame(dj);
    dj.fightGame = this.game;   // ticked from the render loop
    this.open = false;
    this.sel = { 1: 'black_male', 2: 'ninja' };
    this.mode = 'cpu';
    this.prevAvatars = null;
    this.el = {};
  }

  init() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      root: $('screen-fight'), select: document.querySelector('#screen-fight .fs-select'),
      result: $('fs-result'), loading: $('fs-loading'),
      difficulty: $('fs-difficulty'), rounds: $('fs-rounds'), time: $('fs-time')
    };
    if (!this.el.root) return;
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (saved) {
        if (CAST_BY_KEY[saved.p1]) this.sel[1] = saved.p1;
        if (CAST_BY_KEY[saved.p2]) this.sel[2] = saved.p2;
        if (saved.mode) this.mode = saved.mode;
        if (saved.difficulty) this.el.difficulty.value = saved.difficulty;
        if (saved.rounds) this.el.rounds.value = String(saved.rounds);
        if (saved.time) this.el.time.value = String(saved.time);
      }
    } catch {}
    [1, 2].forEach(p => this.buildGrid(p));
    document.querySelectorAll('#fs-mode button').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === this.mode);
      b.addEventListener('click', () => {
        this.mode = b.dataset.mode;
        document.querySelectorAll('#fs-mode button').forEach(x => x.classList.toggle('active', x === b));
        this.updateLabels();
        this.save();
      });
    });
    [this.el.difficulty, this.el.rounds, this.el.time].forEach(s => s.addEventListener('change', () => this.save()));
    $('fs-start').addEventListener('click', () => this.start());
    $('fs-random').addEventListener('click', () => {
      [1, 2].forEach(p => this.pick(p, CAST[Math.floor(Math.random() * CAST.length)].key));
    });
    $('fs-exit').addEventListener('click', () => this.onExit?.());
    $('fs-rematch').addEventListener('click', () => this.start());
    $('fs-change').addEventListener('click', () => this.showSelect());
    this.game.onMatchEnd = ({ winner, names, wins }) => {
      $('fs-result-title').textContent = `${names[winner].toUpperCase()} WINS`;
      $('fs-result-sub').textContent = `${wins[1]} – ${wins[2]}  ·  ${names[1]} vs ${names[2]}`;
      this.el.result.hidden = false;
    };
    this.game.onQuit = () => this.showSelect();
    this.buildHelp();
    this.updateLabels();
  }

  /** Move list straight from the game's command table */
  buildHelp() {
    const box = document.getElementById('fs-moves');
    if (!box) return;
    const esc = (t) => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const st = styleFor(CAST_BY_KEY[this.sel[1]]);
    const groups = [...COMMAND_HELP];
    if (st.specials?.length) groups.unshift({ group: `P1 style: ${st.name}`, items: st.specials.map(sp => [sp.label, this.game.moveName(sp.move)]) });
    box.innerHTML = groups.map(g => `<div class="fs-move-group"><h4>${esc(g.group)}</h4>${g.items.map(([k, v]) => `<p><b>${esc(k)}</b> ${esc(v)}</p>`).join('')}</div>`).join('');
  }

  buildGrid(p) {
    const grid = document.getElementById(`fs-grid-${p}`);
    grid.innerHTML = '';
    CAST.forEach(c => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fs-tile';
      b.dataset.key = c.key;
      b.style.setProperty('--tile', c.color);
      b.innerHTML = `<span class="fs-tile-init">${c.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</span><span class="fs-tile-name">${c.name}</span>`;
      b.title = `${c.name} — ${c.style}`;
      b.addEventListener('click', () => this.pick(p, c.key));
      grid.appendChild(b);
    });
  }

  updateLabels() {
    [1, 2].forEach(p => {
      const c = CAST_BY_KEY[this.sel[p]];
      document.getElementById(`fs-name-${p}`).textContent = c?.name || '—';
      const st = c ? styleFor(c) : null;
      const styleEl = document.getElementById(`fs-style-${p}`);
      styleEl.textContent = st ? `${st.name} · ${st.blurb}` : '';
      styleEl.title = c?.style || '';
      document.querySelectorAll(`#fs-grid-${p} .fs-tile`).forEach(t => t.classList.toggle('picked', t.dataset.key === this.sel[p]));
    });
    const tag2 = document.querySelector('.fs-side.p2 .fs-tag');
    if (tag2) tag2.textContent = this.mode === 'cpu' ? 'CPU' : 'P2';
    this.el.difficulty.closest('label').style.opacity = this.mode === 'cpu' ? '1' : '0.4';
  }

  save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ p1: this.sel[1], p2: this.sel[2], mode: this.mode, difficulty: this.el.difficulty.value, rounds: +this.el.rounds.value, time: +this.el.time.value }));
    } catch {}
  }

  pick(p, key) {
    this.sel[p] = key;
    this.updateLabels();
    if (p === 1) this.buildHelp();
    this.save();
    if (this.open && !this.game.matchActive) {
      this.el.loading.hidden = false;
      this.dj.setPlayerAvatar(p, key).then(() => {
        this.el.loading.hidden = true;
        this.preview();
      });
    }
  }

  /* -------- entering / leaving -------- */

  enter() {
    if (this.open) return;
    this.open = true;
    this.prevAvatars = { ...this.dj.currentAvatars };
    this.el.root.hidden = false;
    document.body.classList.add('fight-screen-on');
    // Start below the app header (its height changes as the nav wraps)
    requestAnimationFrame(() => {
      const h = document.getElementById('app-header')?.getBoundingClientRect().bottom || 64;
      this.el.root.style.setProperty('--fs-top', `${Math.round(h)}px`);
    });
    const help = this.el.root.querySelector('.fs-help');
    if (help) help.open = window.innerWidth > 900 && window.innerHeight > 700;
    this.showSelect();
    window.announcer?.playFile?.(Math.random() < 0.5 ? 'selectyourfighter.wav' : 'chooseyourcharacter.wav');
    this.el.loading.hidden = false;
    Promise.all([this.dj.setPlayerAvatar(1, this.sel[1]), this.dj.setPlayerAvatar(2, this.sel[2])]).then(() => {
      this.el.loading.hidden = true;
      if (this.open) this.preview();
    });
  }

  leave() {
    if (!this.open) return;
    this.open = false;
    this.game.stop(true);
    this.el.root.hidden = true;
    this.el.result.hidden = true;
    document.body.classList.remove('fight-screen-on');
    const dj = this.dj;
    dj.cameraOverride = null;
    [1, 2].forEach(p => {
      const st = dj.characterStates[p];
      st.fighting = false;
      st.noFace = false;
      dj.rigs[p]?.setFightMode(false);
      dj.rigs[p]?.stop(0.2);
    });
    // Put the battle's contestants back
    const prev = this.prevAvatars || {};
    Promise.all([1, 2].map(p => (prev[p] && prev[p] !== dj.currentAvatars[p] ? dj.setPlayerAvatar(p, prev[p]) : Promise.resolve()))).then(() => {
      [1, 2].forEach(p => dj.sendCharacterToHype(p));
    });
  }

  showSelect() {
    this.game.stop(true);
    this.el.result.hidden = true;
    this.el.select.hidden = false;
    if (this.open) this.preview();
  }

  /** Fighters stand on the fight line, squared up, while you pick */
  preview() {
    const dj = this.dj;
    [1, 2].forEach(p => {
      const char = dj.characters[p];
      if (!char) return;
      const st = dj.characterStates[p];
      st.fighting = true;
      st.noFace = true;
      st.emote = null;
      st.state = 'IDLE_STATION';
      char.position.set(ARENA.cx + (p === 1 ? -1.3 : 1.3), char.position.y, LINE_Z);
      st.fightLift = 0;
      st.facing = p === 1 ? Math.PI / 2 : -Math.PI / 2;
      dj.rigs[p]?.setFightMode(true);
      dj.rigs[p]?.setLocomotion(0);
    });
    dj.cameraOverride = (camPos, target) => {
      camPos.set(0, 1.45, LINE_Z + 4.6);
      target.set(0, 1.0, LINE_Z);
    };
  }

  async start() {
    this.el.select.hidden = true;
    this.el.result.hidden = true;
    this.el.loading.hidden = false;
    await Promise.all([this.dj.ensureAvatar(this.sel[1]), this.dj.ensureAvatar(this.sel[2])]);
    // moves still streaming in? show how far along
    this.game.onLoadProgress = (n, total) => {
      if (total && n < total) { this.el.loading.hidden = false; this.el.loading.textContent = `Loading moves ${n}/${total}…`; }
      else { this.el.loading.hidden = true; this.el.loading.textContent = 'Loading fighters…'; }
    };
    this.el.loading.hidden = true;
    this.game.startMatch({
      p1: this.sel[1],
      p2: this.sel[2],
      mode: this.mode,
      difficulty: this.el.difficulty.value,
      rounds: +this.el.rounds.value,
      roundTime: +this.el.time.value
    });
  }
}

export { FightScreen };
