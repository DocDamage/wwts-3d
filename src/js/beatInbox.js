/**
 * Beat inbox (host side): beats producers uploaded from their phones, saved on
 * this machine (server/beatUploads.js). When a matchup loads (or the round
 * changes) each producer's beat for that round goes straight onto their deck.
 */

class BeatInbox {
  constructor({ judgeLink, signups, audio, roster, toast }) {
    Object.assign(this, { link: judgeLink, signups, audio, roster, toast: toast || (() => {}) });
    this.beats = [];          // { deviceId, round, url, size, originalName, producer, at }
    this.autoLoad = true;
    try { this.autoLoad = localStorage.getItem('wwts_inbox_autoload') !== 'off'; } catch { /* default on */ }
  }

  init() {
    const prev = this.link.onExtra;
    this.link.onExtra = (msg) => { prev?.(msg); if (msg.t === 'beat-uploaded') this.onUploaded(msg.beat); };
    this.modal = document.getElementById('inbox-modal');
    document.getElementById('btn-beat-inbox')?.addEventListener('click', () => this.open());
    this.modal?.addEventListener('click', (e) => {
      if (e.target === this.modal || e.target.closest('[data-close="inbox-modal"]')) this.modal.style.display = 'none';
      const b = e.target.closest('[data-load]');
      if (b) this.loadToDeck(Number(b.dataset.load), this.beats.find(x => x.url === b.dataset.url));
    });
    document.getElementById('inbox-auto')?.addEventListener('change', (e) => {
      this.autoLoad = e.target.checked;
      try { localStorage.setItem('wwts_inbox_autoload', this.autoLoad ? 'on' : 'off'); } catch { /* ignore */ }
    });
    document.getElementById('inbox-refresh')?.addEventListener('click', () => this.refresh().then(() => this.render()));
    this.refresh();
  }

  async refresh() {
    try {
      const res = await fetch(`/api/beats/list?room=${encodeURIComponent(this.link.room)}`, { cache: 'no-store' });
      if (res.ok) this.beats = await res.json();
    } catch { /* hub not running */ }
    this.renderBadge();
  }

  onUploaded(beat) {
    if (!beat) return;
    this.beats = this.beats.filter(b => !(b.deviceId === beat.deviceId && b.round === beat.round)).concat(beat);
    const who = this.signups.byDevice(beat.deviceId)?.name || beat.producer || 'A producer';
    this.toast(`📥 ${who} uploaded their round ${beat.round} beat`);
    this.renderBadge();
    if (this.modal?.style.display !== 'none') this.render();
    this.onChange?.();
  }

  /** The beat a contestant uploaded for a round (exact round, else their round-1 beat for overtime) */
  beatFor(contestantId, round) {
    const e = this.signups.byContestant(contestantId);
    if (!e) return null;
    const mine = this.beats.filter(b => b.deviceId === e.deviceId);
    return mine.find(b => b.round === round) || (round === 4 ? mine.find(b => b.round === 3) || mine.find(b => b.round === 1) : null) || null;
  }

  /** Put each producer's beat for this round on their deck (if they uploaded one) */
  autoLoadFor(c1Id, c2Id, round) {
    if (!this.autoLoad) return 0;
    let n = 0;
    [[1, c1Id], [2, c2Id]].forEach(([slot, id]) => {
      const b = id ? this.beatFor(id, round) : null;
      if (b && this.audio.players[slot].loadedUrl !== b.url) { this.loadToDeck(slot, b, true); n++; }
    });
    if (n) this.toast(`📥 Loaded ${n} uploaded beat${n === 1 ? '' : 's'} for round ${round === 4 ? 'OT' : round}`);
    return n;
  }

  loadToDeck(slot, beat, quiet = false) {
    if (!beat) return;
    this.audio.loadAudio(slot, beat.url, beat.originalName?.replace(/\.[^/.]+$/, '') || `${beat.producer} R${beat.round}`);
    this.audio.players[slot].loadedUrl = beat.url;
    if (!quiet) this.toast(`Deck ${slot}: ${beat.producer || 'producer'} · round ${beat.round}`);
  }

  open() {
    this.refresh().then(() => this.render());
    if (this.modal) this.modal.style.display = '';
  }

  renderBadge() {
    const btn = document.getElementById('btn-beat-inbox');
    if (btn) btn.dataset.count = this.beats.length ? String(this.beats.length) : '';
  }

  render() {
    const el = document.getElementById('inbox-list');
    if (!el) return;
    const auto = document.getElementById('inbox-auto');
    if (auto) auto.checked = this.autoLoad;
    const byDev = {};
    this.beats.forEach(b => { (byDev[b.deviceId] = byDev[b.deviceId] || []).push(b); });
    const rows = Object.entries(byDev).map(([dev, list]) => {
      const e = this.signups.byDevice(dev);
      const name = e?.name || list[0]?.producer || 'Producer';
      return `<li><div class="inbox-who"><b>${esc(name)}</b>${e?.contestantId ? '' : ' <small>(not drawn yet)</small>'}</div>
        <div class="inbox-beats">${list.sort((a, b) => a.round - b.round).map(b => `
          <span class="inbox-beat" title="${esc(b.originalName || '')} · ${(b.size / 1048576).toFixed(1)} MB">R${b.round === 4 ? 'OT' : b.round}
            <button type="button" class="fs-small" data-load="1" data-url="${esc(b.url)}">→ Deck 1</button><button type="button" class="fs-small" data-load="2" data-url="${esc(b.url)}">→ Deck 2</button></span>`).join('')}</div></li>`;
    });
    el.innerHTML = rows.join('') || '<li class="profile-muted">No uploads yet. Producers upload from the sign-up page on their phone (turn on "beat uploads" in Sign-ups).</li>';
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export { BeatInbox };
