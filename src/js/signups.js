/**
 * Open-battle sign-ups (host side). Producers scan a QR code (entry.html), put
 * their name in, and land on the list; past the capacity they're waitlisted.
 * The host checks people in as they arrive, then draws: checked-in producers
 * are shuffled into pairs, added to the roster (matched by name) and to the
 * run of show. Every producer's phone shows their status and draw.
 */
import QRCode from 'qrcode';

const STORE = 'wwts_signups_v1';

/** registered | waitlist by sign-up time and capacity (checked-in / drawn / out stay as they are) */
function assignStatuses(entrants, capacity) {
  const cap = Number(capacity) || 0;
  let inCount = 0;
  [...entrants].sort((a, b) => a.at - b.at).forEach(e => {
    if (e.status === 'out') return;
    if (['checked-in', 'drawn'].includes(e.status)) { inCount++; return; }
    if (!cap || inCount < cap) { e.status = 'registered'; inCount++; } else e.status = 'waitlist';
  });
  return entrants;
}

/** Shuffle into pairs; an odd one out gets a bye. rand is injectable for tests */
function drawPairs(list, rand = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  const pairs = [];
  for (let i = 0; i + 1 < a.length; i += 2) pairs.push([a[i], a[i + 1]]);
  return { pairs, bye: a.length % 2 ? a[a.length - 1] : null };
}

class Signups {
  constructor() {
    this.data = { open: false, capacity: 16, eventName: '', uploads: true, entrants: [] };
    try { Object.assign(this.data, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch { /* defaults */ }
  }

  save() {
    try { localStorage.setItem(STORE, JSON.stringify(this.data)); } catch { /* storage blocked */ }
  }

  /** A phone signed up (or changed its name) */
  upsert({ deviceId, name, social, at }) {
    let e = this.data.entrants.find(x => x.deviceId === deviceId);
    if (!e) {
      e = { deviceId, name, social: social || '', at: at || Date.now(), status: 'registered', contestantId: null };
      this.data.entrants.push(e);
    } else {
      e.name = name;
      e.social = social || e.social;
      if (e.status === 'out') e.status = 'registered';
    }
    assignStatuses(this.data.entrants, this.data.capacity);
    this.save();
    return e;
  }

  byDevice(deviceId) { return this.data.entrants.find(e => e.deviceId === deviceId) || null; }

  byContestant(id) { return this.data.entrants.find(e => e.contestantId === id) || null; }

  setStatus(deviceId, status) {
    const e = this.byDevice(deviceId);
    if (!e) return null;
    e.status = status;
    assignStatuses(this.data.entrants, this.data.capacity);
    this.save();
    return e;
  }

  setCapacity(n) {
    this.data.capacity = Math.max(0, Number(n) || 0);
    assignStatuses(this.data.entrants, this.data.capacity);
    this.save();
  }

  checkedIn() { return this.data.entrants.filter(e => e.status === 'checked-in'); }

  clear() {
    this.data.entrants = [];
    this.save();
  }
}

class SignupsPanel {
  constructor({ signups, judgeLink, roster, leagues, ros, toast, onDraw }) {
    Object.assign(this, { signups, link: judgeLink, roster, leagues, ros, toast: toast || (() => {}), onDraw });
  }

  init() {
    this.modal = document.getElementById('signup-modal');
    if (!this.modal) return;
    const prev = this.link.onExtra;
    this.link.onExtra = (msg) => { prev?.(msg); this.handle(msg); };
    // whenever the hub (re)connects, push the config and everyone's status again
    const prevOnline = this.link.onOnline;
    this.link.onOnline = () => { prevOnline?.(); this.pushConfig(); this.signups.data.entrants.forEach(e => this.notify(e)); };
    this.modal.addEventListener('tool-open', () => this.open());
    document.getElementById('btn-open-signups')?.addEventListener('click', () => window.toolsMenu?.openModal('signup-modal'));
    const $ = (id) => document.getElementById(id);
    $('su-open').addEventListener('change', (e) => { this.signups.data.open = e.target.checked; this.signups.save(); this.pushConfig(); this.render(); });
    $('su-uploads').addEventListener('change', (e) => { this.signups.data.uploads = e.target.checked; this.signups.save(); this.pushConfig(); });
    $('su-capacity').addEventListener('change', (e) => { this.signups.setCapacity(e.target.value); this.signups.data.entrants.forEach(x => this.notify(x)); this.pushConfig(); this.render(); });
    $('su-event').addEventListener('change', (e) => { this.signups.data.eventName = e.target.value.slice(0, 60); this.signups.save(); this.pushConfig(); });
    $('su-draw').addEventListener('click', () => this.draw());
    $('su-checkin-all').addEventListener('click', () => {
      this.signups.data.entrants.filter(e => e.status === 'registered').forEach(e => { e.status = 'checked-in'; this.notify(e); });
      this.signups.save();
      this.render();
    });
    $('su-clear').addEventListener('click', () => { if (confirm('Clear the sign-up list?')) { this.signups.clear(); this.render(); } });
    $('su-copy').addEventListener('click', () => navigator.clipboard?.writeText(this.url()).then(() => this.toast('Sign-up link copied')));
    this.modal.addEventListener('click', (e) => {
      const b = e.target.closest('[data-su]');
      if (!b) return;
      const id = b.closest('[data-dev]').dataset.dev;
      const act = b.dataset.su;
      const e2 = this.signups.setStatus(id, act === 'in' ? 'checked-in' : act === 'undo' ? 'registered' : 'out');
      if (e2) this.notify(e2);
      this.signups.data.entrants.forEach(x => this.notify(x));   // waitlist may have moved up
      this.render();
    });
  }

  url() { return `${this.link.baseUrl()}/entry.html?room=${this.link.room}`; }

  async open() {
    await this.link.ensureAddress?.();
    const url = this.url();
    document.getElementById('su-url').textContent = url;
    document.getElementById('su-room').textContent = this.link.room;
    try { await QRCode.toCanvas(document.getElementById('su-qr'), url, { width: 190, margin: 1, color: { dark: '#0a0a0e', light: '#ffffff' } }); } catch { /* no canvas */ }
    this.pushConfig();
    this.render();
  }

  pushConfig() {
    const d = this.signups.data;
    this.link.send({ t: 'signup-config', config: { open: d.open, capacity: d.capacity, eventName: d.eventName || this.leagues.getActive()?.name || '', uploads: d.uploads, rounds: 3 } });
  }

  handle(msg) {
    if (msg.t === 'signup') {
      const before = this.signups.byDevice(msg.deviceId);
      const e = this.signups.upsert(msg);
      if (!before) this.toast(`📝 ${e.name} signed up${e.status === 'waitlist' ? ' (waitlist)' : ''}`);
      this.notify(e);
      this.render();
    }
  }

  /** Tell a producer's phone where they stand */
  notify(e) {
    if (!e) return;
    const text = {
      registered: 'You\'re on the list. Check in with the host when you arrive.',
      waitlist: 'The battle is full — you\'re on the waitlist. You\'ll move up if a spot opens.',
      'checked-in': 'Checked in! Waiting for the draw.',
      drawn: e.opponentName ? `You battle ${e.opponentName}${e.slot ? ` (match #${e.slot})` : ''}.` : 'You\'re in the draw.',
      out: 'You\'re off the list for tonight. Ask the host if that\'s a mistake.'
    }[e.status] || '';
    const waitPos = e.status === 'waitlist' ? this.signups.data.entrants.filter(x => x.status === 'waitlist').sort((a, b) => a.at - b.at).findIndex(x => x.deviceId === e.deviceId) + 1 : null;
    this.link.send({ t: 'to-entrant', deviceId: e.deviceId, msg: { t: 'ent-status', status: e.status, text, opponent: e.opponentName || null, slot: e.slot || null, waitPos } });
  }

  /** Find the producer in the league by name, or add them */
  contestantFor(e) {
    const leagueId = this.leagues.activeLeagueId;
    const existing = e.contestantId && this.roster.getById(e.contestantId);
    if (existing) return existing;
    const match = this.roster.getForLeague(leagueId).find(c => c.name.trim().toLowerCase() === e.name.trim().toLowerCase())
      || this.roster.getAll().find(c => c.name.trim().toLowerCase() === e.name.trim().toLowerCase());
    if (match) {
      if (leagueId) this.leagues.addContestant(leagueId, match.id);
      return match;
    }
    return this.roster.add({ name: e.name, socialLinks: e.social, leagueId });
  }

  draw() {
    const pool = this.signups.checkedIn();
    if (pool.length < 2) return this.toast('Check in at least two producers first');
    if (!confirm(`Draw ${pool.length} checked-in producers into ${Math.floor(pool.length / 2)} battle${pool.length >= 4 ? 's' : ''}?`)) return;
    const { pairs, bye } = drawPairs(pool);
    const start = this.ros.items.length;
    pairs.forEach(([a, b], i) => {
      const ca = this.contestantFor(a);
      const cb = this.contestantFor(b);
      a.contestantId = ca.id;
      b.contestantId = cb.id;
      a.status = b.status = 'drawn';
      a.opponentName = cb.name;
      b.opponentName = ca.name;
      a.slot = b.slot = start + i + 1;
      this.ros.add({ c1Id: ca.id, c2Id: cb.id, c1Name: ca.name, c2Name: cb.name, label: `Draw #${i + 1}` });
    });
    if (bye) {
      const cb = this.contestantFor(bye);
      bye.contestantId = cb.id;
      bye.status = 'checked-in';
      bye.opponentName = null;
      this.toast(`${bye.name} has a bye (odd number) — still checked in for the next draw`);
    }
    this.signups.save();
    this.signups.data.entrants.forEach(e => this.notify(e));
    this.onDraw?.(pairs);
    this.toast(`🎲 Drawn: ${pairs.length} battle${pairs.length === 1 ? '' : 's'} added to the run of show`);
    this.render();
  }

  render() {
    if (!this.modal) return;
    const d = this.signups.data;
    const $ = (id) => document.getElementById(id);
    $('su-open').checked = !!d.open;
    $('su-uploads').checked = !!d.uploads;
    $('su-capacity').value = d.capacity;
    $('su-event').value = d.eventName || '';
    const order = { 'checked-in': 0, registered: 1, drawn: 2, waitlist: 3, out: 4 };
    const list = [...d.entrants].sort((a, b) => order[a.status] - order[b.status] || a.at - b.at);
    const counts = d.entrants.reduce((m, e) => { m[e.status] = (m[e.status] || 0) + 1; return m; }, {});
    $('su-counts').textContent = `${d.entrants.length} signed up · ${counts['checked-in'] || 0} checked in · ${counts.drawn || 0} drawn · ${counts.waitlist || 0} waitlisted${d.open ? ' · sign-ups OPEN' : ' · sign-ups closed'}`;
    $('su-list').innerHTML = list.length ? list.map(e => `
      <li data-dev="${esc(e.deviceId)}" class="su-${e.status}">
        <span class="su-name"><b>${esc(e.name)}</b>${e.social ? ` <small>${esc(e.social)}</small>` : ''}</span>
        <span class="su-status">${{ registered: 'Signed up', waitlist: 'Waitlist', 'checked-in': '✓ Checked in', drawn: `🎲 vs ${esc(e.opponentName || '')}`, out: 'Removed' }[e.status]}</span>
        <span class="su-actions">
          ${e.status === 'registered' || e.status === 'waitlist' ? '<button type="button" class="fs-small" data-su="in">Check in</button>' : ''}
          ${e.status === 'checked-in' ? '<button type="button" class="fs-small" data-su="undo">Undo</button>' : ''}
          ${e.status !== 'out' && e.status !== 'drawn' ? '<button type="button" class="fs-small" data-su="out" aria-label="Remove">✕</button>' : ''}
        </span>
      </li>`).join('') : '<li class="profile-muted">Nobody yet. Open sign-ups and put the QR code on screen.</li>';
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export { Signups, SignupsPanel, assignStatuses, drawPairs };
