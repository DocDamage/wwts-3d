/**
 * Battle replay: records what happened during a battle (rounds, beats playing,
 * score swings, judges turning in cards, locks, notes, crowd votes) on a
 * timeline, then lets you scrub back through a finished battle.
 *
 * The recorder samples the live state twice a second and keeps only changes,
 * so it needs no hooks inside the other modules.
 */

const SAMPLE_MS = 500;
const MAX_POINTS = 1500;

class BattleRecorder {
  /** probe() -> { round, total1, total2, deck1, deck2, phase, judgesIn, locked } */
  constructor(probe) {
    this.probe = probe;
    this.reset();
  }

  reset() {
    this.t0 = null;
    this.points = [];   // [t, total1, total2]
    this.events = [];   // { t, type, text, data }
    this.last = null;
  }

  now() {
    return this.t0 === null ? 0 : (performance.now() - this.t0) / 1000;
  }

  start() {
    if (this._iv) return;
    this._iv = setInterval(() => this.tick(), SAMPLE_MS);
  }

  stop() {
    clearInterval(this._iv);
    this._iv = null;
  }

  event(type, text, data = null) {
    if (this.t0 === null) return;
    this.events.push({ t: +this.now().toFixed(1), type, text, data });
  }

  tick() {
    let s;
    try { s = this.probe(); } catch { return; }
    if (!s) return;
    const prev = this.last;
    // the clock starts with the battle's first sign of life
    if (this.t0 === null) {
      if (!(s.deck1 || s.deck2 || s.total1 > 0 || s.total2 > 0)) return;
      this.t0 = performance.now();
      this.event('start', 'Battle underway');
      [1, 2].forEach(p => { if (s[`deck${p}`]) this.event('deck', `${s.names?.[p] || 'P' + p}'s beat playing`, { p, playing: true }); });
    }
    const t = +this.now().toFixed(1);
    if (!prev || prev.total1 !== s.total1 || prev.total2 !== s.total2) {
      if (this.points.length < MAX_POINTS) this.points.push([t, +s.total1.toFixed(2), +s.total2.toFixed(2)]);
    }
    if (prev) {
      if (s.round !== prev.round) this.event('round', s.round === 4 ? 'Overtime' : s.round === 3 ? 'Final round' : `Round ${s.round}`, { round: s.round });
      [1, 2].forEach(p => {
        const k = `deck${p}`;
        if (s[k] !== prev[k]) this.event('deck', `${s.names?.[p] || 'P' + p}'s beat ${s[k] ? 'playing' : 'stopped'}`, { p, playing: s[k] });
      });
      if (s.judgesIn > prev.judgesIn) this.event('judge', `${s.judgesIn} judge card${s.judgesIn === 1 ? '' : 's'} in`, { n: s.judgesIn });
      if (s.locked && !prev.locked) this.event('lock', `Round ${s.round} locked`, { round: s.round });
      if ((s.notes || 0) > (prev.notes || 0) && s.lastNote) this.event('note', String(s.lastNote).slice(0, 120));
      // big score swings get a marker
      const lead = (x) => Math.sign((x.total1 || 0) - (x.total2 || 0));
      if (lead(s) !== lead(prev) && (s.total1 > 0 || s.total2 > 0)) {
        this.event('lead', lead(s) === 0 ? 'Level' : `${s.names?.[lead(s) > 0 ? 1 : 2] || 'P'} takes the lead`, { lead: lead(s) });
      }
    }
    this.last = s;
  }

  /** Compact timeline to store with the battle */
  export({ crowd = [] } = {}) {
    if (this.t0 === null) return null;
    const events = [...this.events];
    (crowd || []).forEach(c => events.push({ t: +this.now().toFixed(1), type: 'crowd', text: `Crowd ${c.round === 4 ? 'OT' : 'R' + c.round}: ${c.counts[0]}–${c.counts[1]}` }));
    events.sort((a, b) => a.t - b.t);
    return { duration: +this.now().toFixed(1), points: this.points, events };
  }
}

/* ------------------------------------------------------------------ */

const ICONS = { start: '▶', round: '🔔', deck: '🎵', judge: '🧑‍⚖️', lock: '🔒', lead: '⚡', note: '📝', crowd: '📣' };

class ReplayViewer {
  init() {
    this.modal = document.getElementById('replay-modal');
    if (!this.modal) return;
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal || e.target.closest('[data-close="replay-modal"]')) this.close();
    });
    this.range = document.getElementById('replay-range');
    this.range.addEventListener('input', () => this.seek(Number(this.range.value)));
    document.getElementById('replay-play').addEventListener('click', () => this.toggle());
  }

  open(battle) {
    const tl = battle.timeline;
    if (!tl || !this.modal) return;
    this.battle = battle;
    this.tl = tl;
    document.getElementById('replay-title').textContent = `${battle.contestant1Name} vs ${battle.contestant2Name}`;
    document.getElementById('replay-n1').textContent = battle.contestant1Name;
    document.getElementById('replay-n2').textContent = battle.contestant2Name;
    this.range.max = String(Math.max(1, tl.duration));
    this.range.step = '0.1';
    this.drawChart();
    this.renderEvents();
    this.modal.style.display = '';
    this.seek(0);
  }

  close() {
    this.pause();
    this.modal.style.display = 'none';
  }

  valueAt(t) {
    let v = [0, 0];
    for (const p of this.tl.points) {
      if (p[0] > t) break;
      v = [p[1], p[2]];
    }
    return v;
  }

  seek(t) {
    this.t = Math.max(0, Math.min(this.tl.duration, t));
    this.range.value = String(this.t);
    const [a, b] = this.valueAt(this.t);
    document.getElementById('replay-s1').textContent = a.toFixed(2);
    document.getElementById('replay-s2').textContent = b.toFixed(2);
    const m = Math.floor(this.t / 60);
    const s = Math.floor(this.t % 60);
    document.getElementById('replay-time').textContent = `${m}:${String(s).padStart(2, '0')} / ${Math.floor(this.tl.duration / 60)}:${String(Math.floor(this.tl.duration % 60)).padStart(2, '0')}`;
    const cursor = document.getElementById('replay-cursor');
    if (cursor) cursor.setAttribute('x1', this.x(this.t)), cursor.setAttribute('x2', this.x(this.t));
    this.modal.querySelectorAll('.replay-events li').forEach(li => li.classList.toggle('past', Number(li.dataset.t) <= this.t));
  }

  toggle() {
    if (this._raf) this.pause(); else this.play();
  }

  play() {
    if (this.t >= this.tl.duration) this.seek(0);
    const btn = document.getElementById('replay-play');
    btn.textContent = '⏸ Pause';
    let last = performance.now();
    const speed = Math.max(4, this.tl.duration / 30);   // a whole battle in ~30 s
    const step = (now) => {
      this.seek(this.t + ((now - last) / 1000) * speed);
      last = now;
      if (this.t >= this.tl.duration) { this.pause(); return; }
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  pause() {
    cancelAnimationFrame(this._raf);
    this._raf = null;
    const btn = document.getElementById('replay-play');
    if (btn) btn.textContent = '▶ Play';
  }

  x(t) {
    return 30 + (t / Math.max(1, this.tl.duration)) * (this.W - 40);
  }

  drawChart() {
    const svg = document.getElementById('replay-chart');
    this.W = 640;
    const H = 180;
    const pts = this.tl.points;
    const maxV = Math.max(10, ...pts.map(p => Math.max(p[1], p[2])));
    const y = (v) => H - 20 - (v / maxV) * (H - 40);
    const path = (i) => {
      if (!pts.length) return '';
      let d = `M${this.x(0)},${y(0)}`;
      let prev = 0;
      pts.forEach(p => { d += ` L${this.x(p[0])},${y(prev)} L${this.x(p[0])},${y(p[i])}`; prev = p[i]; });
      d += ` L${this.x(this.tl.duration)},${y(prev)}`;
      return d;
    };
    const marks = this.tl.events.filter(e => ['round', 'lock', 'lead'].includes(e.type)).map(e =>
      `<line x1="${this.x(e.t)}" x2="${this.x(e.t)}" y1="10" y2="${H - 20}" class="rp-mark ${e.type}"><title>${e.text}</title></line>`).join('');
    svg.setAttribute('viewBox', `0 0 ${this.W} ${H}`);
    svg.innerHTML = `${marks}
      <path d="${path(1)}" class="rp-line p1"/><path d="${path(2)}" class="rp-line p2"/>
      <line id="replay-cursor" x1="30" x2="30" y1="6" y2="${H - 16}" class="rp-cursor"/>
      <text x="4" y="${y(maxV) + 4}" class="rp-axis">${maxV.toFixed(0)}</text><text x="4" y="${y(0)}" class="rp-axis">0</text>`;
    svg.onclick = (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * this.W;
      this.seek(((px - 30) / (this.W - 40)) * this.tl.duration);
    };
  }

  renderEvents() {
    const list = document.getElementById('replay-events');
    const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    list.innerHTML = this.tl.events.map(e => `<li data-t="${e.t}"><button type="button"><span class="rp-t">${fmt(e.t)}</span> ${ICONS[e.type] || '•'} ${this.esc(e.text)}</button></li>`).join('') || '<li>No events recorded.</li>';
    list.querySelectorAll('li[data-t] button').forEach(b => b.addEventListener('click', () => this.seek(Number(b.parentElement.dataset.t))));
  }

  esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
}

export { BattleRecorder, ReplayViewer };
