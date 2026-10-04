/**
 * Co-host tablet (host side). A second device opens cohost.html, enters the
 * room code and the 4-digit PIN shown here, and gets the decks, timer, battle
 * flow and crowd controls while the main host runs the mic and scoring.
 * Commands go through the same action registry as MIDI / Stream Deck.
 */
import QRCode from 'qrcode';

const PIN_KEY = 'wwts_cohost_pin_v1';

class CohostLink {
  constructor({ judgeLink, actions, getState, toast }) {
    Object.assign(this, { link: judgeLink, actions, getState, toast: toast || (() => {}) });
    this.tablets = new Map();   // deviceId -> { accepted, at }
    this.pin = null;
    try { this.pin = localStorage.getItem(PIN_KEY); } catch { /* ignore */ }
    if (!this.pin) this.newPin();
  }

  newPin() {
    const b = new Uint32Array(1);
    crypto.getRandomValues(b);
    this.pin = String(1000 + (b[0] % 9000));
    try { localStorage.setItem(PIN_KEY, this.pin); } catch { /* ignore */ }
    // a new PIN signs every tablet out
    this.tablets.forEach((t, id) => this.link.send({ t: 'to-cohost', deviceId: id, msg: { t: 'co-denied', reason: 'The host changed the PIN' } }));
    this.tablets.clear();
    return this.pin;
  }

  init() {
    const prev = this.link.onExtra;
    this.link.onExtra = (msg) => { prev?.(msg); this.handle(msg); };
    this.modal = document.getElementById('cohost-modal');
    this.modal?.addEventListener('tool-open', () => this.open());
    document.getElementById('co-new-pin')?.addEventListener('click', () => { this.newPin(); this.render(); });
    document.getElementById('co-copy')?.addEventListener('click', () => navigator.clipboard?.writeText(this.url()).then(() => this.toast('Co-host link copied')));
    this.modal?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-revoke]');
      if (!b) return;
      this.link.send({ t: 'to-cohost', deviceId: b.dataset.revoke, msg: { t: 'co-denied', reason: 'The host signed this tablet out' } });
      this.tablets.delete(b.dataset.revoke);
      this.render();
    });
    setInterval(() => this.push(), 500);
  }

  url() { return `${this.link.baseUrl()}/cohost.html?room=${this.link.room}`; }

  async open() {
    await this.link.ensureAddress?.();
    try { await QRCode.toCanvas(document.getElementById('co-qr'), this.url(), { width: 180, margin: 1, color: { dark: '#0a0a0e', light: '#ffffff' } }); } catch { /* no canvas */ }
    this.render();
  }

  handle(msg) {
    if (msg.t === 'cohost-join') {
      const ok = msg.pin && msg.pin === this.pin;
      this.link.send({ t: 'to-cohost', deviceId: msg.deviceId, msg: ok ? { t: 'co-ok' } : { t: 'co-denied', reason: 'Wrong PIN' } });
      if (ok) {
        this.tablets.set(msg.deviceId, { at: Date.now() });
        this.toast('📱 Co-host tablet connected');
        this.push(true);
      }
      this.render();
    } else if (msg.t === 'cohost-left') {
      this.tablets.delete(msg.deviceId);
      this.render();
    } else if (msg.t === 'cohost-cmd') {
      if (!this.tablets.has(msg.deviceId)) return;
      const value = msg.arg !== null && msg.arg !== undefined && msg.arg !== '' && !isNaN(Number(msg.arg)) ? Number(msg.arg) : msg.arg;
      this.actions.run(msg.action, value);
      this.push(true);
    }
  }

  push(force = false) {
    if (!this.tablets.size) return;
    const state = this.getState();
    const json = JSON.stringify(state);
    if (!force && json === this._last) return;
    this._last = json;
    this.link.send({ t: 'cohost-state', state });
  }

  render() {
    if (!this.modal) return;
    const pinEl = document.getElementById('co-pin');
    if (pinEl) pinEl.textContent = this.pin;
    const url = document.getElementById('co-url');
    if (url) url.textContent = this.url();
    const list = document.getElementById('co-list');
    if (list) {
      list.innerHTML = this.tablets.size
        ? [...this.tablets.entries()].map(([id, t]) => `<li>📱 Tablet · since ${new Date(t.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} <button type="button" class="fs-small" data-revoke="${id}">Sign out</button></li>`).join('')
        : '<li class="profile-muted">No tablet connected</li>';
    }
  }
}

export { CohostLink };
