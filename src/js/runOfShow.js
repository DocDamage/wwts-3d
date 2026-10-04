/**
 * Run of show: tonight's matchups in order, with time estimates, a "next up"
 * card for the broadcast and overlays, and a running "we're 12 minutes behind"
 * tracker. Also runs King of the Hill nights (the winner stays on and the next
 * challenger steps up).
 *
 * Planned start of item i = event start + sum of the estimates before it.
 * Behind/ahead compares that plan with when the live item actually started
 * (plus any overrun), or with "now" while waiting for the next one.
 */

const STORE = 'wwts_run_of_show_v1';
const uid = () => `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

class RunOfShow {
  constructor() {
    this.data = { eventName: '', startAt: null, mode: 'list', items: [], koth: { kingId: null, defenses: 0, challengers: [], reigns: [] } };
    try { Object.assign(this.data, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch { /* defaults */ }
    this.data.koth = { kingId: null, defenses: 0, challengers: [], reigns: [], ...(this.data.koth || {}) };
    this.listeners = new Set();
  }

  save() {
    try { localStorage.setItem(STORE, JSON.stringify(this.data)); } catch { /* storage blocked */ }
    this.listeners.forEach(fn => fn());
  }

  onChange(fn) { this.listeners.add(fn); }

  get items() { return this.data.items; }

  add({ c1Id, c2Id, c1Name, c2Name, label = '', est = 12 }) {
    const item = { id: uid(), c1Id, c2Id, c1Name, c2Name, label: String(label).slice(0, 40), est: Math.max(1, Math.min(120, Number(est) || 12)), status: 'queued' };
    this.data.items.push(item);
    this.save();
    return item;
  }

  remove(id) {
    this.data.items = this.data.items.filter(i => i.id !== id);
    this.save();
  }

  move(id, dir) {
    const a = this.data.items;
    const i = a.findIndex(x => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    this.save();
  }

  update(id, fields) {
    const it = this.data.items.find(i => i.id === id);
    if (!it) return;
    Object.assign(it, fields);
    this.save();
  }

  live() { return this.data.items.find(i => i.status === 'live') || null; }

  next() { return this.data.items.find(i => i.status === 'queued') || null; }

  /** The matchup after the live one (for the "next up" card) */
  upNext() {
    const live = this.live();
    const queued = this.data.items.filter(i => i.status === 'queued');
    return live ? queued[0] || null : queued[1] || queued[0] || null;
  }

  setLive(id, now = Date.now()) {
    this.data.items.forEach(i => { if (i.status === 'live' && i.id !== id) { i.status = 'queued'; delete i.startedAt; } });
    const it = this.data.items.find(i => i.id === id);
    if (!it) return null;
    it.status = 'live';
    it.startedAt = now;
    if (!this.data.startAt) this.data.startAt = now;
    this.save();
    return it;
  }

  /** A battle finished: close the live item that matches these two producers */
  complete({ c1Id, c2Id, winnerId, winnerName, resultId }, now = Date.now()) {
    const it = this.data.items.find(i => i.status === 'live' && ((i.c1Id === c1Id && i.c2Id === c2Id) || (i.c1Id === c2Id && i.c2Id === c1Id)));
    if (it) {
      it.status = 'done';
      it.endedAt = now;
      it.winnerId = winnerId;
      it.winnerName = winnerName;
      it.resultId = resultId;
    }
    if (this.data.mode === 'koth') this.kothResult(c1Id, c2Id, winnerId, winnerName);
    this.save();
    return it;
  }

  /* ---------------- timing ---------------- */

  /** Planned start (ms) of each item */
  plan() {
    const start = this.data.startAt;
    if (!start) return [];
    let t = start;
    return this.data.items.map(i => {
      const p = t;
      t += i.est * 60000;
      return p;
    });
  }

  /** Minutes behind (+) or ahead (−) of the plan; null before the night starts */
  delayMinutes(now = Date.now()) {
    if (!this.data.startAt) return null;
    const plan = this.plan();
    const items = this.data.items;
    const liveIdx = items.findIndex(i => i.status === 'live');
    if (liveIdx >= 0) {
      const it = items[liveIdx];
      const startedLate = it.startedAt - plan[liveIdx];
      const overrun = Math.max(0, now - it.startedAt - it.est * 60000);
      return Math.round((startedLate + overrun) / 60000);
    }
    const nextIdx = items.findIndex(i => i.status === 'queued');
    if (nextIdx < 0) {
      // all done: how the night finished against the plan
      const last = items[items.length - 1];
      if (!last?.endedAt) return 0;
      return Math.round((last.endedAt - (plan[items.length - 1] + last.est * 60000)) / 60000);
    }
    return Math.round((now - plan[nextIdx]) / 60000);
  }

  /** Projected finish of the whole night (ms) */
  projectedFinish(now = Date.now()) {
    const remaining = this.data.items.filter(i => i.status !== 'done');
    const live = this.live();
    let t = now;
    remaining.forEach(i => {
      if (i === live) t += Math.max(0, i.est * 60000 - (now - i.startedAt));
      else t += i.est * 60000;
    });
    return t;
  }

  /* ---------------- King of the Hill ---------------- */

  setMode(mode) {
    this.data.mode = mode === 'koth' ? 'koth' : 'list';
    this.save();
  }

  setKing(id) {
    this.data.koth.kingId = id || null;
    this.data.koth.defenses = 0;
    this.save();
  }

  addChallenger(id) {
    if (!id || id === this.data.koth.kingId || this.data.koth.challengers.includes(id)) return;
    this.data.koth.challengers.push(id);
    this.save();
  }

  removeChallenger(id) {
    this.data.koth.challengers = this.data.koth.challengers.filter(c => c !== id);
    this.save();
  }

  /** Queue the king vs the next challenger; returns the new item */
  nextChallenge(nameOf) {
    const k = this.data.koth;
    if (!k.kingId || !k.challengers.length) return null;
    const challenger = k.challengers.shift();
    return this.add({ c1Id: k.kingId, c2Id: challenger, c1Name: nameOf(k.kingId), c2Name: nameOf(challenger), label: `👑 Defense #${k.defenses + 1}` });
  }

  kothResult(c1Id, c2Id, winnerId, winnerName) {
    const k = this.data.koth;
    if (!k.kingId || ![c1Id, c2Id].includes(k.kingId)) {
      // first battle of the night crowns the first king
      if (winnerId) { k.kingId = winnerId; k.defenses = 0; k.reigns.push({ id: winnerId, name: winnerName, defenses: 0, at: Date.now() }); }
      return;
    }
    if (!winnerId) return;   // a draw: the king keeps the crown, no defense counted
    if (winnerId === k.kingId) {
      k.defenses++;
      const reign = k.reigns[k.reigns.length - 1];
      if (reign && reign.id === k.kingId) reign.defenses = k.defenses;
    } else {
      k.kingId = winnerId;
      k.defenses = 0;
      k.reigns.push({ id: winnerId, name: winnerName, defenses: 0, at: Date.now() });
    }
  }

  clear() {
    this.data = { eventName: this.data.eventName, startAt: null, mode: this.data.mode, items: [], koth: { kingId: null, defenses: 0, challengers: [], reigns: [] } };
    this.save();
  }
}

function fmtDelay(min) {
  if (min === null || min === undefined) return '';
  if (Math.abs(min) < 2) return 'on time';
  return min > 0 ? `${min} min behind` : `${-min} min ahead`;
}

/** The run-of-show window */
class RunOfShowPanel {
  constructor({ ros, roster, leagues, loadMatchup, toast, tournament }) {
    Object.assign(this, { ros, roster, leagues, loadMatchup, toast: toast || (() => {}), tournament });
  }

  init() {
    this.modal = document.getElementById('ros-modal');
    if (!this.modal) return;
    const $ = (id) => document.getElementById(id);
    document.getElementById('btn-run-of-show')?.addEventListener('click', () => this.open());
    document.getElementById('ros-chip')?.addEventListener('click', () => this.open());
    this.modal.addEventListener('click', (e) => { if (e.target === this.modal || e.target.closest('[data-close="ros-modal"]')) this.modal.style.display = 'none'; });
    $('ros-add').addEventListener('click', () => {
      const c1 = $('ros-p1').value;
      const c2 = $('ros-p2').value;
      if (!c1 || !c2 || c1 === c2) return this.toast('Pick two different producers');
      this.ros.add({ c1Id: c1, c2Id: c2, c1Name: this.name(c1), c2Name: this.name(c2), label: $('ros-label').value, est: $('ros-est').value });
      $('ros-label').value = '';
    });
    $('ros-event-name').addEventListener('change', (e) => { this.ros.data.eventName = e.target.value.slice(0, 60); this.ros.save(); });
    $('ros-start').addEventListener('change', (e) => {
      const [h, m] = (e.target.value || '').split(':').map(Number);
      if (Number.isFinite(h)) { const d = new Date(); d.setHours(h, m || 0, 0, 0); this.ros.data.startAt = d.getTime(); } else this.ros.data.startAt = null;
      this.ros.save();
    });
    this.modal.querySelectorAll('[name=ros-mode]').forEach(r => r.addEventListener('change', () => this.ros.setMode(r.value)));
    $('ros-king').addEventListener('change', (e) => this.ros.setKing(e.target.value));
    $('ros-chal-add').addEventListener('click', () => this.ros.addChallenger($('ros-chal').value));
    $('ros-next-challenge').addEventListener('click', () => {
      const it = this.ros.nextChallenge(id => this.name(id));
      if (!it) return this.toast('Pick a king and add challengers first');
      this.load(it.id);
    });
    $('ros-bracket').addEventListener('click', () => {
      const m = this.tournament?.bracket && !this.tournament.isTournamentComplete() ? this.tournament.getNextPlayableMatch() : null;
      if (!m) return this.toast('No playable bracket match right now');
      this.ros.add({ c1Id: m.player1Id, c2Id: m.player2Id, c1Name: m.p1Name, c2Name: m.p2Name, label: m.label || 'Bracket' });
    });
    $('ros-clear').addEventListener('click', () => { if (confirm('Clear tonight\'s run of show?')) this.ros.clear(); });
    this.modal.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const id = b.closest('[data-id]')?.dataset.id;
      const act = b.dataset.act;
      if (act === 'up') this.ros.move(id, -1);
      if (act === 'down') this.ros.move(id, 1);
      if (act === 'del') this.ros.remove(id);
      if (act === 'load') this.load(id);
      if (act === 'chal-del') this.ros.removeChallenger(b.dataset.cid);
    });
    this.modal.addEventListener('change', (e) => {
      const row = e.target.closest('[data-id]');
      if (row && e.target.classList.contains('ros-est-in')) this.ros.update(row.dataset.id, { est: Math.max(1, Number(e.target.value) || 12) });
    });
    this.ros.onChange(() => this.render());
    setInterval(() => this.renderChip(), 15000);
    this.render();
  }

  name(id) { return this.roster.getById(id)?.name || 'Producer'; }

  open() {
    this.render();
    this.modal.style.display = '';
  }

  load(id) {
    const it = this.ros.items.find(i => i.id === id);
    if (!it) return;
    this.ros.setLive(id);
    this.loadMatchup(it.c1Id, it.c2Id, { label: it.label || 'Run of show' });
    this.modal.style.display = 'none';
  }

  render() {
    if (!this.modal) return;
    const $ = (id) => document.getElementById(id);
    const list = this.roster.getForLeague(this.leagues.activeLeagueId);
    const opts = list.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    ['ros-p1', 'ros-p2', 'ros-chal'].forEach(id => { const el = $(id); const v = el.value; el.innerHTML = `<option value="">— Producer —</option>${opts}`; el.value = v; });
    const king = $('ros-king');
    const kv = this.ros.data.koth.kingId || '';
    king.innerHTML = `<option value="">— Crown a king —</option>${opts}`;
    king.value = kv;
    $('ros-event-name').value = this.ros.data.eventName || '';
    const st = this.ros.data.startAt ? new Date(this.ros.data.startAt) : null;
    $('ros-start').value = st ? `${String(st.getHours()).padStart(2, '0')}:${String(st.getMinutes()).padStart(2, '0')}` : '';
    const koth = this.ros.data.mode === 'koth';
    this.modal.querySelectorAll('[name=ros-mode]').forEach(r => { r.checked = r.value === this.ros.data.mode; });
    $('ros-koth').hidden = !koth;
    const plan = this.ros.plan();
    const now = Date.now();
    $('ros-list').innerHTML = this.ros.items.length ? this.ros.items.map((it, i) => `
      <li data-id="${it.id}" class="ros-item ${it.status}">
        <span class="ros-time">${plan[i] ? new Date(plan[i]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : `#${i + 1}`}</span>
        <span class="ros-match"><b>${esc(it.c1Name)}</b> vs <b>${esc(it.c2Name)}</b>${it.label ? ` <small>${esc(it.label)}</small>` : ''}
          ${it.status === 'done' ? `<small class="ros-res">✓ ${esc(it.winnerName || 'Draw')} · ${Math.round((it.endedAt - it.startedAt) / 60000)} min</small>` : ''}
          ${it.status === 'live' ? `<small class="ros-res live">LIVE · ${Math.round((now - it.startedAt) / 60000)} / ${it.est} min</small>` : ''}</span>
        <label class="ros-est"><input type="number" class="ros-est-in" min="1" max="120" value="${it.est}" aria-label="Minutes" ${it.status === 'done' ? 'disabled' : ''}/> min</label>
        <span class="ros-actions">
          ${it.status !== 'done' ? `<button type="button" data-act="load" class="fs-small" title="Load this matchup">${it.status === 'live' ? '↻' : '▶'} Load</button>` : ''}
          <button type="button" data-act="up" aria-label="Move up">▲</button><button type="button" data-act="down" aria-label="Move down">▼</button><button type="button" data-act="del" aria-label="Remove">✕</button>
        </span>
      </li>`).join('') : '<li class="profile-muted">No matchups yet — add them below, or open sign-ups and draw.</li>';
    const d = this.ros.delayMinutes(now);
    const done = this.ros.items.filter(i => i.status === 'done').length;
    $('ros-status').textContent = this.ros.items.length
      ? `${done}/${this.ros.items.length} done${d !== null ? ` · ${fmtDelay(d)}` : ' · set a start time to track the schedule'}${this.ros.items.some(i => i.status !== 'done') ? ` · projected finish ${new Date(this.ros.projectedFinish(now)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`
      : '';
    // King of the Hill
    const k = this.ros.data.koth;
    $('ros-chal-list').innerHTML = k.challengers.map(c => `<li>${esc(this.name(c))} <button type="button" data-act="chal-del" data-cid="${c}" aria-label="Remove challenger">✕</button></li>`).join('') || '<li class="profile-muted">No challengers queued</li>';
    $('ros-reign').textContent = k.kingId ? `👑 ${this.name(k.kingId)} · ${k.defenses} defense${k.defenses === 1 ? '' : 's'}` : 'No king yet — the first battle crowns one';
    $('ros-reigns').innerHTML = k.reigns.slice(-6).reverse().map(r => `<li>${esc(r.name)} — ${r.defenses} defense${r.defenses === 1 ? '' : 's'}</li>`).join('');
    this.renderChip();
  }

  /** "Next: A vs B · 12 min behind" on the host desk */
  renderChip() {
    const chip = document.getElementById('ros-chip');
    if (!chip) return;
    const next = this.ros.upNext();
    const live = this.ros.live();
    const d = this.ros.delayMinutes();
    chip.hidden = !this.ros.items.length && !this.ros.data.koth.kingId;
    const k = this.ros.data.koth;
    const king = this.ros.data.mode === 'koth' && k.kingId ? `👑 ${this.name(k.kingId)} (${k.defenses}) · ` : '';
    chip.textContent = `📋 ${king}${next ? `Next: ${next.c1Name} vs ${next.c2Name}` : live ? 'Last battle of the night' : 'Run of show'}${d !== null ? ` · ${fmtDelay(d)}` : ''}`;
    chip.classList.toggle('behind', d !== null && d >= 5);
  }

  /** Data for the broadcast / overlays / public page */
  summary() {
    const next = this.ros.upNext();
    const k = this.ros.data.koth;
    return {
      eventName: this.ros.data.eventName || '',
      nextUp: next ? { c1: next.c1Name, c2: next.c2Name, label: next.label || '' } : null,
      delay: this.ros.delayMinutes(),
      king: this.ros.data.mode === 'koth' && k.kingId ? { name: this.name(k.kingId), defenses: k.defenses } : null
    };
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export { RunOfShow, RunOfShowPanel, fmtDelay };
