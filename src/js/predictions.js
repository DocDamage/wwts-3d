/**
 * Audience prediction game (host side). When a battle loads, phones on the vote
 * page can call the winner; predictions close when the reveal starts, and
 * everyone who called it gets a point. A "best ear in the room" leaderboard
 * runs across the night (kept by the hub), shown on phones, here and in the
 * overlay.
 */

class Predictions {
  constructor({ judgeLink, getOptions, toast }) {
    Object.assign(this, { link: judgeLink, getOptions, toast: toast || (() => {}) });
    this.pred = null;
    this.counts = [0, 0];
    this.board = [];
    this.auto = true;
    try { this.auto = localStorage.getItem('wwts_pred_auto') !== 'off'; } catch { /* default on */ }
  }

  init() {
    const prev = this.link.onExtra;
    this.link.onExtra = (msg) => { prev?.(msg); this.handle(msg); };
    document.getElementById('pred-open')?.addEventListener('click', () => this.open());
    document.getElementById('pred-close')?.addEventListener('click', () => this.close());
    document.getElementById('pred-auto')?.addEventListener('change', (e) => {
      this.auto = e.target.checked;
      try { localStorage.setItem('wwts_pred_auto', this.auto ? 'on' : 'off'); } catch { /* ignore */ }
    });
    this.render();
  }

  handle(msg) {
    if (msg.t === 'pred-tally' && this.pred && msg.predId === this.pred.id) { this.counts = msg.counts; this.render(); }
    if (msg.t === 'pred-board') { this.board = msg.board || []; this.render(); }
  }

  /** A new battle loaded: open predictions automatically (if on) */
  openFor() {
    if (this.auto) this.open(true);
  }

  open(quiet = false) {
    const options = this.getOptions();
    this.pred = { id: `pr_${Date.now().toString(36)}`, open: true, title: 'Who takes this battle?', options };
    this.counts = [0, 0];
    this.link.send({ t: 'pred', pred: this.pred });
    if (!quiet) this.toast('🔮 Predictions are open on the vote page');
    this.render();
  }

  /** Reveal starting: no more predictions */
  close() {
    if (!this.pred?.open) return;
    this.pred.open = false;
    this.link.send({ t: 'pred', pred: this.pred });
    this.render();
  }

  /** The result is in: winner 1 / 2, or 0 for a draw */
  resolve(winner) {
    if (!this.pred) return;
    this.close();
    this.link.send({ t: 'pred-resolve', predId: this.pred.id, winner: winner || 0 });
    const right = winner ? this.counts[winner - 1] : 0;
    const total = this.counts[0] + this.counts[1];
    if (total) this.toast(`🔮 ${right} of ${total} called it`);
    this.pred = { ...this.pred, result: winner || 0 };
    this.render();
  }

  overlayState() {
    if (!this.pred && !this.board.length) return null;
    return { open: !!this.pred?.open, title: this.pred?.title, options: this.pred?.options, counts: this.counts, board: this.board.slice(0, 5) };
  }

  render() {
    const auto = document.getElementById('pred-auto');
    if (auto) auto.checked = this.auto;
    const st = document.getElementById('pred-status');
    if (st) {
      const total = this.counts[0] + this.counts[1];
      st.textContent = this.pred
        ? `${this.pred.open ? 'OPEN' : 'closed'} · ${this.pred.options?.[0]} ${this.counts[0]} – ${this.counts[1]} ${this.pred.options?.[1]} (${total} prediction${total === 1 ? '' : 's'})`
        : 'Not open';
    }
    const ob = document.getElementById('pred-open');
    const cb = document.getElementById('pred-close');
    if (ob) ob.disabled = !!this.pred?.open;
    if (cb) cb.disabled = !this.pred?.open;
    const list = document.getElementById('pred-board');
    if (list) list.innerHTML = this.board.length ? this.board.map((b, i) => `<li><b>${i + 1}.</b> ${esc(b.name)} <span>${b.points} pt${b.points === 1 ? '' : 's'}</span></li>`).join('') : '<li class="profile-muted">No points yet tonight</li>';
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export { Predictions };
