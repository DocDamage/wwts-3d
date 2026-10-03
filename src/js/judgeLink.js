/**
 * Judge Link (host side) — lets judges score from their own phones.
 *
 * The host screen claims a room on the local judge hub (server/judgeHub.js),
 * shows a QR code with the phone URL, seats judges as they join, keeps every
 * phone in sync (contestants, categories, round, lock), and feeds incoming
 * scorecards into the JudgeManager. Everything stays on the local network.
 */

import QRCode from 'qrcode';

const ROOM_KEY = 'wwts_judge_room_v1';
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion

function randomCode(len) {
  let out = '';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  bytes.forEach(b => { out += ROOM_ALPHABET[b % ROOM_ALPHABET.length]; });
  return out;
}

class JudgeLink {
  constructor(judges, scoring) {
    this.judges = judges;
    this.scoring = scoring;
    this.ws = null;
    this.status = 'offline'; // connecting | online | offline | unavailable
    this.failures = 0;
    this.stateProvider = null;   // () => { battleId, contestants, round, roundLabel, locked }
    this.onScoresUpdated = null; // (seat, round) — host refreshes totals/flow
    this.onToast = null;         // (message)
    this.addresses = [];
    this.port = location.port;
    this.selectedAddress = null;
    this._pushTimer = null;
    this.connected = new Map(); // deviceId -> name, phones currently in the room
    const saved = this.loadRoom();
    this.room = saved.room;
    this.token = saved.token;
  }

  loadRoom() {
    try {
      const saved = JSON.parse(localStorage.getItem(ROOM_KEY) || 'null');
      if (saved?.room && saved?.token) return saved;
    } catch {
      // fall through to a fresh room
    }
    const fresh = { room: randomCode(4), token: randomCode(16) };
    try { localStorage.setItem(ROOM_KEY, JSON.stringify(fresh)); } catch { /* storage blocked */ }
    return fresh;
  }

  init() {
    this.judges.onRequestPhones = () => this.openModal();
    this.judges.onPanelChange = () => {
      this.pushState();
      this.renderSeatList();
    };

    const modal = document.getElementById('judges-connect-modal');
    modal?.addEventListener('click', (e) => { if (e.target === modal) this.closeModal(); });
    modal?.querySelectorAll('[data-close="judges-connect-modal"]').forEach(b => b.addEventListener('click', () => this.closeModal()));
    document.getElementById('judge-address-select')?.addEventListener('change', (e) => {
      this.selectedAddress = e.target.value;
      this.renderQr();
    });
    document.getElementById('btn-copy-judge-link')?.addEventListener('click', () => {
      navigator.clipboard?.writeText(this.judgeUrl()).then(() => this.toast('Judge link copied'));
    });
    document.getElementById('modal-judge-count')?.addEventListener('change', (e) => this.judges.setJudgeCount(parseInt(e.target.value, 10)));

    if (location.protocol.startsWith('http')) this.connect();
    else this.setStatus('unavailable');
  }

  /* ---------------- Connection ---------------- */

  connect() {
    this.setStatus('connecting');
    let ws;
    try {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/judge-ws`);
    } catch {
      this.setStatus('unavailable');
      return;
    }
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'host', room: this.room, token: this.token }));
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.handle(msg);
    };
    ws.onclose = () => {
      this.ws = null;
      this.failures++;
      // A few quick retries, then back off — the hub only exists when served by Vite or server/start.js
      this.connected.clear();
      this.setStatus(this.failures > 3 && this.status !== 'online' ? 'unavailable' : 'offline');
      Object.values(this.judges.remote).forEach(r => { r.connected = false; });
      this.judges.renderUI();
      setTimeout(() => this.connect(), Math.min(15000, 1000 * this.failures));
    };
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  handle(msg) {
    switch (msg.t) {
      case 'hosting':
        this.failures = 0;
        this.setStatus('online');
        this.pushState(true);
        break;
      case 'error':
        if (msg.code === 'room-taken') {
          // Another host tab owns this code — take a new one
          const fresh = { room: randomCode(4), token: randomCode(16) };
          this.room = fresh.room;
          this.token = fresh.token;
          try { localStorage.setItem(ROOM_KEY, JSON.stringify(fresh)); } catch { /* storage blocked */ }
          this.send({ t: 'host', room: this.room, token: this.token });
        }
        break;
      case 'judge-join': {
        this.connected.set(msg.deviceId, msg.name);
        const seat = this.judges.assignPhone(msg.deviceId, msg.name);
        if (seat) {
          this.send({ t: 'to-judge', deviceId: msg.deviceId, msg: { t: 'seat', seat, name: this.judges.judgeNames[seat] } });
          this.toast(`📱 ${msg.name} joined as Judge ${seat}`);
        } else {
          this.send({ t: 'to-judge', deviceId: msg.deviceId, msg: { t: 'full' } });
          this.toast(`📱 ${msg.name} tried to join, but all 5 judge seats are taken`);
        }
        this.pushState();
        this.renderSeatList();
        break;
      }
      case 'judge-left':
        this.connected.delete(msg.deviceId);
        this.judges.setPhoneConnected(msg.deviceId, false);
        this.renderSeatList();
        break;
      case 'judge-scores': {
        const seat = this.judges.seatForDevice(msg.deviceId);
        if (!seat) return;
        const state = this.currentState();
        if (msg.battleId && state.battleId && msg.battleId !== state.battleId) return; // card from an earlier battle
        if (state.locked && msg.round === state.round) return; // round already locked
        this.judges.receiveRemoteScores(seat, msg.round, msg.scores1, msg.scores2, msg.submitted);
        if (msg.submitted) this.toast(`✓ ${this.judges.judgeNames[seat]} submitted Round ${msg.round}`);
        this.onScoresUpdated?.(seat, msg.round);
        this.renderSeatList();
        break;
      }
      default:
        break;
    }
  }

  /** After restoring a saved panel, re-seat phones that are still connected */
  resyncSeats() {
    this.connected.forEach((name, deviceId) => {
      const seat = this.judges.assignPhone(deviceId, name);
      if (seat) this.send({ t: 'to-judge', deviceId, msg: { t: 'seat', seat, name: this.judges.judgeNames[seat] } });
    });
    this.pushState();
    this.renderSeatList();
  }

  setStatus(status) {
    this.status = status;
    const btn = document.getElementById('btn-connect-judges');
    if (btn) {
      btn.dataset.status = status;
      btn.title = {
        online: `Judges join from their phones — room ${this.room}`,
        connecting: 'Connecting to the local judge hub…',
        offline: 'Judge hub offline — retrying…',
        unavailable: 'Phone judging needs the app served by "npm run dev" or "npm start"'
      }[status];
    }
    this.renderModalStatus();
  }

  /* ---------------- State sync ---------------- */

  currentState() {
    const base = typeof this.stateProvider === 'function' ? this.stateProvider() : {};
    return {
      battleId: base.battleId || null,
      contestants: base.contestants || ['Contestant 1', 'Contestant 2'],
      round: base.round || 1,
      roundLabel: base.roundLabel || `Round ${base.round || 1}`,
      locked: !!base.locked,
      league: base.league || 'Who Want That Smoke',
      categories: this.scoring.categories.map(c => ({ name: c.name, desc: c.desc || '', weight: c.weight, enabled: c.enabled })),
      step: this.scoring.step,
      seats: Array.from({ length: this.judges.totalJudges }, (_, i) => {
        const seat = i + 1;
        return { seat, name: this.judges.judgeNames[seat], deviceId: this.judges.remote[seat]?.deviceId || null };
      })
    };
  }

  /** Send the battle state to every phone (debounced; `now` skips the wait) */
  pushState(now = false) {
    clearTimeout(this._pushTimer);
    const run = () => this.send({ t: 'state', state: this.currentState() });
    if (now) run();
    else this._pushTimer = setTimeout(run, 60);
  }

  /* ---------------- Connect-judges dialog ---------------- */

  async openModal() {
    const modal = document.getElementById('judges-connect-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.getElementById('judge-room-code').textContent = this.room;
    this.renderModalStatus();
    this.renderSeatList();
    try {
      const info = await (await fetch('/judge-info', { cache: 'no-store' })).json();
      this.addresses = info.addresses || [];
      this.port = info.port || location.port;
    } catch {
      this.addresses = [];
    }
    const select = document.getElementById('judge-address-select');
    if (select) {
      select.innerHTML = '';
      this.addresses.forEach(a => select.appendChild(new Option(`${a.address}${a.virtual ? ' (virtual adapter)' : ''} — ${a.name}`, a.address)));
      if (!this.addresses.length) select.appendChild(new Option(location.hostname, location.hostname));
      if (!this.selectedAddress || !this.addresses.some(a => a.address === this.selectedAddress)) {
        this.selectedAddress = this.addresses[0]?.address || location.hostname;
      }
      select.value = this.selectedAddress;
      select.closest('.judge-address-row').style.display = this.addresses.length > 1 ? '' : 'none';
    }
    this.renderQr();
  }

  closeModal() {
    const modal = document.getElementById('judges-connect-modal');
    if (modal) modal.style.display = 'none';
  }

  judgeUrl() {
    const host = this.selectedAddress || location.hostname;
    return `${location.protocol}//${host}${this.port ? `:${this.port}` : ''}/judge.html?room=${this.room}`;
  }

  async renderQr() {
    const canvas = document.getElementById('judge-qr-canvas');
    const urlEl = document.getElementById('judge-link-url');
    const warn = document.getElementById('judge-lan-warning');
    const url = this.judgeUrl();
    if (urlEl) urlEl.textContent = url;
    const localOnly = ['localhost', '127.0.0.1', '::1'].includes(this.selectedAddress || location.hostname);
    if (warn) {
      warn.hidden = !localOnly;
      warn.textContent = 'No Wi-Fi address found — connect this computer to the same Wi-Fi as the judges\' phones, then reopen this window.';
    }
    if (canvas) {
      try {
        await QRCode.toCanvas(canvas, url, { width: 220, margin: 1, color: { dark: '#0a0a0e', light: '#ffffff' } });
      } catch (e) {
        console.warn('QR render failed', e);
      }
    }
  }

  renderModalStatus() {
    const el = document.getElementById('judge-hub-status');
    if (!el) return;
    const text = {
      online: `● Live — room ${this.room}`,
      connecting: '● Connecting…',
      offline: '● Reconnecting…',
      unavailable: '● Phone judging is off: start the app with "npm run dev" or "npm start" on this computer.'
    }[this.status];
    el.textContent = text;
    el.dataset.status = this.status;
  }

  renderSeatList() {
    const list = document.getElementById('judge-seat-list');
    const countSel = document.getElementById('modal-judge-count');
    if (countSel) countSel.value = String(this.judges.totalJudges);
    if (!list) return;
    const round = this.currentState().round;
    list.innerHTML = '';
    for (let seat = 1; seat <= this.judges.totalJudges; seat++) {
      const remote = this.judges.remote[seat];
      const row = document.createElement('div');
      row.className = 'judge-seat-row';
      const scored = this.judges.isScored(seat, round);
      const kind = remote
        ? `<span class="seat-kind ${remote.connected ? 'on' : 'off'}">📱 ${remote.connected ? 'Phone connected' : 'Phone offline'}${scored ? ' · ✓ submitted' : ''}</span>`
        : '<span class="seat-kind local">🖥️ Scored on this screen</span>';
      row.innerHTML = `
        <span class="seat-num">J${seat}</span>
        <input class="form-input seat-name" maxlength="24" value="${this.escape(this.judges.judgeNames[seat])}" aria-label="Judge ${seat} name" />
        ${kind}
        ${remote ? '<button type="button" class="control-btn secondary seat-release">Release</button>' : ''}`;
      row.querySelector('.seat-name').addEventListener('change', (e) => {
        this.judges.setJudgeName(seat, e.target.value);
        if (remote) this.send({ t: 'to-judge', deviceId: remote.deviceId, msg: { t: 'seat', seat, name: this.judges.judgeNames[seat] } });
        this.pushState();
      });
      row.querySelector('.seat-release')?.addEventListener('click', () => {
        this.send({ t: 'to-judge', deviceId: remote.deviceId, msg: { t: 'released' } });
        this.judges.releaseSeat(seat);
      });
      list.appendChild(row);
    }
  }

  escape(s) {
    return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  toast(message) {
    if (typeof this.onToast === 'function') this.onToast(message);
  }
}

export { JudgeLink };
