/**
 * Character Controls UI — move docks, the right-click move wheel, and the
 * "Control" toggle that hands the arrow keys / left stick to a contestant.
 */

import { MOVES, MOVES_BY_ID, MOVE_CATEGORIES } from './characterMoves.js';

// Quick picks shown on the right-click wheel
const WHEEL_MOVES = ['smoke', 'point_opponent', 'dust_off', 'raise_roof', 'celebrate', 'two_step', 'laugh', 'flex'];

class CharacterControls {
  constructor(djController) {
    this.dj = djController;
    this.wheel = null;
    this.wheelPlayer = null;
  }

  init() {
    [1, 2].forEach(p => this.buildDock(p));

    document.querySelectorAll('.dock-control-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = parseInt(btn.dataset.player, 10);
        this.dj.setDrivenPlayer(this.dj.drivenPlayer === p ? null : p);
      });
    });

    this.dj.onMoveChange = (p, moveId) => this.highlightMove(p, moveId);
    this.dj.onDrivenChange = (p) => {
      document.querySelectorAll('.character-dock').forEach(dock => {
        dock.classList.toggle('is-driving', dock.classList.contains(`p${p}`));
      });
    };
    this.dj.onCharacterContext = (p, x, y) => this.openWheel(p, x, y);
    this.dj.onMovesChanged = () => [1, 2].forEach(p => this.buildDock(p));

    this.buildWheel();
  }

  buildDock(p) {
    const grid = document.getElementById(`emote-grid-${p}`);
    if (!grid) return;
    grid.innerHTML = '';
    MOVE_CATEGORIES.forEach(cat => {
      const moves = MOVES.filter(m => m.category === cat.id && !m.hidden);
      if (!moves.length) return;
      const head = document.createElement('div');
      head.className = 'emote-category';
      head.textContent = cat.label;
      grid.appendChild(head);
      moves.forEach(move => grid.appendChild(this.makeMoveButton(p, move)));
    });
  }

  makeMoveButton(p, move) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'emote-btn';
    btn.dataset.move = move.id;
    btn.title = move.loop ? `${move.label} (click again to stop)` : move.label;
    btn.innerHTML = `<span class="emote-icon">${move.icon}</span><span>${move.label}</span>`;
    btn.addEventListener('click', () => this.toggleMove(p, move.id));
    return btn;
  }

  toggleMove(p, moveId) {
    if (this.dj.getActiveMove(p) === moveId) this.dj.stopMove(p);
    else this.dj.playMove(p, moveId);
  }

  highlightMove(p, moveId) {
    document.querySelectorAll(`#emote-grid-${p} .emote-btn`).forEach(btn => {
      btn.classList.toggle('playing', btn.dataset.move === moveId);
    });
  }

  buildWheel() {
    const wheel = document.createElement('div');
    wheel.className = 'emote-wheel';
    wheel.hidden = true;
    wheel.innerHTML = '<div class="emote-wheel-center"></div>';
    const radius = 96;
    WHEEL_MOVES.forEach((id, i) => {
      const move = MOVES_BY_ID[id];
      if (!move) return;
      const angle = (i / WHEEL_MOVES.length) * Math.PI * 2 - Math.PI / 2;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'emote-wheel-item';
      item.style.left = `${130 + Math.cos(angle) * radius}px`;
      item.style.top = `${130 + Math.sin(angle) * radius}px`;
      item.innerHTML = `<span>${move.icon}</span><span>${move.label}</span>`;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.wheelPlayer) this.dj.playMove(this.wheelPlayer, id);
        this.closeWheel();
      });
      wheel.appendChild(item);
    });
    document.body.appendChild(wheel);
    this.wheel = wheel;

    document.addEventListener('mousedown', (e) => {
      if (!wheel.hidden && !wheel.contains(e.target)) this.closeWheel();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeWheel();
    });
  }

  openWheel(p, x, y) {
    if (!this.wheel) return;
    this.wheelPlayer = p;
    const name = document.getElementById(`contestant-${p}-display`)?.textContent || `Contestant ${p}`;
    this.wheel.querySelector('.emote-wheel-center').textContent = name;
    this.wheel.style.left = `${Math.min(window.innerWidth - 140, Math.max(140, x))}px`;
    this.wheel.style.top = `${Math.min(window.innerHeight - 140, Math.max(140, y))}px`;
    this.wheel.hidden = false;
  }

  closeWheel() {
    if (this.wheel) this.wheel.hidden = true;
    this.wheelPlayer = null;
  }
}

export { CharacterControls };
