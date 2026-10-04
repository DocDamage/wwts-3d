/**
 * Fight Club screen: character select (live preview on the 3D stage),
 * mode / difficulty / rounds / timer, then hands off to FightGame.
 */
import { CAST, CAST_BY_KEY } from './fightCast.js';
import { FightGame, COMMAND_HELP, ARENA } from './fightGame.js';
import { styleFor } from './fightStyles.js';
import { LadderRunner, MODE_INFO } from './fightModes.js';
import { ACTIONS, LABELS, getKeys, getPad, bindKey, bindPad, resetBindings, keyName, padName } from './fightControls.js';

const LADDERS = ['arcade', 'survival', 'timeattack', 'tournament'];

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
      difficulty: $('fs-difficulty'), rounds: $('fs-rounds'), time: $('fs-time'), arena: $('fs-arena'), mode: $('fs-mode')
    };
    this.ladder = new LadderRunner(this);
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
        if (saved.arena && this.el.arena) this.el.arena.value = saved.arena;
      }
    } catch {}
    [1, 2].forEach(p => this.buildGrid(p));
    if (this.el.mode) {
      this.el.mode.value = this.mode;
      this.el.mode.addEventListener('change', () => { this.mode = this.el.mode.value; this.updateLabels(); this.save(); });
    }
    [this.el.difficulty, this.el.rounds, this.el.time, this.el.arena].forEach(s => s?.addEventListener('change', () => this.save()));
    $('fs-controls')?.addEventListener('click', () => this.openControls());
    $('fs-controls-close')?.addEventListener('click', () => this.closeControls());
    $('fs-controls-reset')?.addEventListener('click', () => { resetBindings(); this.renderControls(); });
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
    const ladder = LADDERS.includes(this.mode);
    if (tag2) tag2.textContent = this.mode === '2p' ? 'P2' : this.mode === 'training' ? 'DUMMY' : ladder ? 'FIRST' : 'CPU';
    this.el.difficulty.closest('label').style.opacity = this.mode === 'cpu' ? '1' : '0.4';
    [this.el.rounds, this.el.time].forEach(el => { el.closest('label').style.opacity = ladder || this.mode === 'training' ? '0.4' : '1'; });
    document.querySelector('.fs-side.p2')?.classList.toggle('dim', ladder);
    const desc = document.getElementById('fs-mode-desc');
    if (desc) desc.textContent = MODE_INFO[this.mode] || '';
    const start = document.getElementById('fs-start');
    if (start) start.textContent = this.mode === 'training' ? 'TRAIN!' : ladder ? 'START!' : 'FIGHT!';
  }

  save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ p1: this.sel[1], p2: this.sel[2], mode: this.mode, difficulty: this.el.difficulty.value, rounds: +this.el.rounds.value, time: +this.el.time.value, arena: this.arena() }));
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

  arena() {
    return this.el.arena?.value || 'walls';
  }

  leave() {
    if (!this.open) return;
    this.open = false;
    this.ladder.cancelled = true;
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
    this.ladder.cancelled = true;
    const vs = document.getElementById('fs-vs');
    if (vs) vs.hidden = true;
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
      const idle = dj.mocap.get('mx_fight_idle');
      const ch = idle?.rm.chestAvg ?? idle?.rm.chest0 ?? 0;
      st.facing = (p === 1 ? Math.PI / 2 : -Math.PI / 2) - ch * 0.9;
      dj.rigs[p]?.setFightMode(true);
      dj.rigs[p]?.setLocomotion(0);
    });
    dj.cameraOverride = (camPos, target) => {
      camPos.set(0, 1.45, LINE_Z + 4.6);
      target.set(0, 1.0, LINE_Z);
    };
  }

  /** Make sure both fighters' models are loaded (progress on the loading card) */
  async loadFighters(a, b) {
    this.el.loading.hidden = false;
    await Promise.all([this.dj.ensureAvatar(a), this.dj.ensureAvatar(b)]);
    this.el.loading.hidden = true;
  }

  /** Modal question on the result card: resolves with the chosen button's index */
  ask(title, sub, buttons) {
    const $ = (id) => document.getElementById(id);
    const actions = this.el.result.querySelector('.fs-result-actions');
    const original = actions.innerHTML;
    $('fs-result-title').textContent = title;
    $('fs-result-sub').textContent = sub;
    actions.innerHTML = buttons.map((b, i) => `<button type="button" class="${i === 0 ? 'fs-start' : 'fs-small'}" data-i="${i}">${b}</button>`).join('');
    this.el.result.hidden = false;
    return new Promise(resolve => {
      actions.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
        this.el.result.hidden = true;
        actions.innerHTML = original;
        // re-wire the normal buttons
        document.getElementById('fs-rematch')?.addEventListener('click', () => this.start());
        document.getElementById('fs-change')?.addEventListener('click', () => this.showSelect());
        resolve(Number(btn.dataset.i));
      }));
      actions.querySelector('button')?.focus();
    });
  }

  async start() {
    this.el.select.hidden = true;
    this.el.result.hidden = true;
    if (LADDERS.includes(this.mode)) {
      this.ladder.cancelled = false;
      this.ladder.run(this.mode, this.sel[1]);
      return;
    }
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
      roundTime: +this.el.time.value,
      arena: this.arena()
    });
  }

  /* -------- controls (rebinding) -------- */

  openControls() {
    this.renderControls();
    document.getElementById('fs-controls-modal').hidden = false;
    this._keyCatcher = (e) => {
      if (!this.listening) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const L = this.listening;
      this.listening = null;
      if (e.code !== 'Escape' && L.kind === 'key') bindKey(L.p, L.action, e.code);
      this.renderControls();
    };
    window.addEventListener('keydown', this._keyCatcher, true);
  }

  closeControls() {
    this.listening = null;
    document.getElementById('fs-controls-modal').hidden = true;
    window.removeEventListener('keydown', this._keyCatcher, true);
    cancelAnimationFrame(this._padRaf);
  }

  renderControls() {
    const body = document.getElementById('fs-controls-body');
    if (!body) return;
    const K = getKeys();
    body.innerHTML = ACTIONS.map(a => `<tr><td>${LABELS[a]}</td>
      ${[1, 2].map(p => `<td><button type="button" class="fs-bind" data-kind="key" data-p="${p}" data-a="${a}">${keyName(K[p][a]?.[0])}${K[p][a]?.length > 1 ? ` <small>+${K[p][a].length - 1}</small>` : ''}</button></td>`).join('')}
      ${[1, 2].map(p => `<td><button type="button" class="fs-bind" data-kind="pad" data-p="${p}" data-a="${a}">${padName(getPad(p)[a])}</button></td>`).join('')}</tr>`).join('');
    body.querySelectorAll('.fs-bind').forEach(b => b.addEventListener('click', () => {
      this.listening = { kind: b.dataset.kind, p: Number(b.dataset.p), action: b.dataset.a };
      b.textContent = b.dataset.kind === 'key' ? 'Press a key…' : 'Press a button…';
      b.classList.add('listening');
      if (b.dataset.kind === 'pad') this.listenPad();
    }));
  }

  /** Wait for the next gamepad button press */
  listenPad() {
    const pressedNow = () => {
      const pads = (navigator.getGamepads ? [...navigator.getGamepads()] : []).filter(Boolean);
      const out = new Set();
      pads.forEach(pad => pad.buttons.forEach((btn, i) => { if (btn.pressed) out.add(i); }));
      return out;
    };
    const held = pressedNow();     // ignore anything already held (e.g. a resting trigger)
    const tick = () => {
      if (!this.listening || this.listening.kind !== 'pad') return;
      const now = pressedNow();
      const fresh = [...now].find(i => !held.has(i));
      if (fresh !== undefined) {
        const L = this.listening;
        this.listening = null;
        bindPad(L.p, L.action, fresh);
        this.renderControls();
        return;
      }
      this._padRaf = requestAnimationFrame(tick);
    };
    this._padRaf = requestAnimationFrame(tick);
  }
}

export { FightScreen };
