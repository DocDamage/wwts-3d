/**
 * Crowd vote (host side): a QR code for vote.html, open/close a poll per round,
 * live bars, and phone 🔥 taps feeding the stage crowd. The latest poll's tally
 * is the "People's Choice" (shown at the reveal, usable as a tie-break step).
 */
import QRCode from 'qrcode';

class AudienceVote {
  constructor({ judgeLink, getOptions, getRound, onHype, toast }) {
    this.link = judgeLink;
    this.getOptions = getOptions;
    this.getRound = getRound || (() => 1);
    this.onHype = onHype || (() => {});
    this.toast = toast || (() => {});
    this.poll = null;          // current poll (host copy)
    this.counts = [0, 0];
    this.voters = 0;
    this.audience = 0;
    this.history = [];         // closed polls this battle: { round, options, counts }
  }

  init() {
    this.modal = document.getElementById('crowd-modal');
    if (!this.modal) return;
    const prev = this.link.onExtra;
    this.link.onExtra = (msg) => { prev?.(msg); this.handle(msg); };
    document.getElementById('btn-crowd-vote')?.addEventListener('click', () => this.open());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal || e.target.closest('[data-close="crowd-modal"]')) this.modal.style.display = 'none';
    });
    document.getElementById('crowd-open')?.addEventListener('click', () => this.openPoll());
    document.getElementById('crowd-close')?.addEventListener('click', () => this.closePoll());
    document.getElementById('crowd-live')?.addEventListener('change', () => { if (this.poll) this.sendPoll(); });
    document.getElementById('crowd-copy')?.addEventListener('click', () => navigator.clipboard?.writeText(this.url()).then(() => this.toast('Vote link copied')));
    window.audienceVotes = () => this.result();
    this.renderBadge();
  }

  url() {
    return `${this.link.baseUrl()}/vote.html?room=${this.link.room}`;
  }

  async open() {
    this.modal.style.display = '';
    await this.link.ensureAddress?.();
    const canvas = document.getElementById('crowd-qr');
    const url = this.url();
    document.getElementById('crowd-url').textContent = url;
    document.getElementById('crowd-room').textContent = this.link.room;
    try { await QRCode.toCanvas(canvas, url, { width: 200, margin: 1, color: { dark: '#0a0a0e', light: '#ffffff' } }); } catch { /* canvas missing */ }
    this.render();
  }

  handle(msg) {
    if (msg.t === 'vote-tally' && this.poll && msg.pollId === this.poll.id) {
      this.counts = msg.counts;
      this.voters = msg.voters;
      this.render();
    } else if (msg.t === 'aud-count') {
      this.audience = msg.n;
      this.render();
    } else if (msg.t === 'aud-hype') {
      this.onHype(msg.n || 1);
    }
  }

  sendPoll() {
    if (!this.poll) return;
    this.poll.showResults = !!document.getElementById('crowd-live')?.checked || !this.poll.open;
    this.link.send({ t: 'poll', poll: this.poll });
  }

  openPoll() {
    const options = this.getOptions();
    const round = this.getRound();
    this.poll = { id: `p_${Date.now().toString(36)}`, open: true, options, title: round === 4 ? 'Who won overtime?' : `Who won round ${round}?`, round, showResults: false };
    this.counts = [0, 0];
    this.voters = 0;
    this.sendPoll();
    this.render();
    this.toast('📣 Crowd vote is open');
  }

  closePoll() {
    if (!this.poll || !this.poll.open) return;
    this.poll.open = false;
    this.sendPoll();
    this.history = this.history.filter(h => h.round !== this.poll.round);
    this.history.push({ round: this.poll.round, options: this.poll.options, counts: [...this.counts] });
    this.render();
    const [a, b] = this.counts;
    this.toast(a === b ? `Crowd vote: tied ${a}-${b}` : `Crowd picks ${this.poll.options[a > b ? 0 : 1]} (${Math.max(a, b)}-${Math.min(a, b)})`);
  }

  /** Total crowd votes for slot 1 / 2 across this battle's polls (or null) */
  result() {
    const all = [...this.history];
    if (this.poll?.open) all.push({ counts: this.counts });
    if (!all.length) return null;
    const r = { 1: 0, 2: 0 };
    all.forEach(h => { r[1] += h.counts[0]; r[2] += h.counts[1]; });
    return r[1] + r[2] ? r : null;
  }

  /** New battle: forget old polls */
  reset() {
    if (this.poll?.open) { this.poll.open = false; this.sendPoll(); }
    this.poll = null;
    this.history = [];
    this.counts = [0, 0];
    this.voters = 0;
    this.render();
  }

  renderBadge() {
    const b = document.getElementById('btn-crowd-vote');
    if (b) b.dataset.count = this.audience ? String(this.audience) : '';
  }

  render() {
    this.renderBadge();
    if (!this.modal) return;
    const opts = this.poll?.options || this.getOptions();
    const total = this.counts[0] + this.counts[1];
    [1, 2].forEach(n => {
      document.getElementById(`crowd-name-${n}`).textContent = opts[n - 1];
      const pct = total ? Math.round((this.counts[n - 1] / total) * 100) : 0;
      document.getElementById(`crowd-bar-${n}`).style.width = `${pct}%`;
      document.getElementById(`crowd-num-${n}`).textContent = total ? `${this.counts[n - 1]} · ${pct}%` : '0';
    });
    document.getElementById('crowd-meta').textContent = `${this.audience} phone${this.audience === 1 ? '' : 's'} connected · ${this.voters} voted${this.poll ? (this.poll.open ? ' · voting OPEN' : ' · closed') : ''}`;
    document.getElementById('crowd-open').disabled = !!this.poll?.open;
    document.getElementById('crowd-close').disabled = !this.poll?.open;
    const hist = document.getElementById('crowd-history');
    hist.innerHTML = this.history.map(h => `<li>${h.round === 4 ? 'OT' : 'R' + h.round}: ${h.options[0]} ${h.counts[0]} – ${h.counts[1]} ${h.options[1]}</li>`).join('');
  }
}

export { AudienceVote };
