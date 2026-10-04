/**
 * 3- and 4-way battles ("cyphers"). Three or four producers, played in a
 * shuffled order on deck 1, scored by every judge (phones get one tab per
 * producer; seats on the host screen score here). The placing is by the
 * panel's average total, ties broken by first-place votes. The result goes into
 * history as one record with the placings; ratings move pairwise between
 * everyone (higher placing wins each pair).
 */
import { eloUpdate } from './roster.js';
import { guideText } from './rubrics.js';

const LETTERS = ['A', 'B', 'C', 'D'];

/**
 * Rank producers from judges' cards.
 * cards: [{ judge, totals: [t0, t1, …] }] (only judges who scored)
 * Returns [{ index, total, firsts }] best first.
 */
function rankCypher(cards, n) {
  const sums = new Array(n).fill(0);
  const firsts = new Array(n).fill(0);
  cards.forEach(c => {
    c.totals.forEach((t, i) => { sums[i] += t; });
    const best = Math.max(...c.totals);
    const winners = c.totals.map((t, i) => (t === best ? i : -1)).filter(i => i >= 0);
    if (winners.length === 1) firsts[winners[0]]++;
  });
  return sums
    .map((s, i) => ({ index: i, total: cards.length ? Number((s / cards.length).toFixed(2)) : 0, firsts: firsts[i] }))
    .sort((a, b) => b.total - a.total || b.firsts - a.firsts || a.index - b.index);
}

/** Pairwise Elo for a placing (ids best first): each pair is a game, K split over the field */
function pairwiseElo(ids, ratings, k = 32) {
  const n = ids.length;
  const delta = Object.fromEntries(ids.map(id => [id, 0]));
  const kk = k / Math.max(1, n - 1);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = ids[i];
      const b = ids[j];
      const { newA } = eloUpdate(ratings[a], ratings[b], 1, kk);
      const d = newA - ratings[a];
      delta[a] += d;
      delta[b] -= d;
    }
  }
  return Object.fromEntries(ids.map(id => [id, Math.round(ratings[id] + delta[id])]));
}

class Cypher {
  constructor({ roster, leagues, scoring, judges, judgeLink, audio, history, timer, toast, settings, seasonId, inbox, announcer, soundboard, onFinish }) {
    Object.assign(this, { roster, leagues, scoring, judges, link: judgeLink, audio, history, timer, toast: toast || (() => {}), settings, seasonId, inbox, announcer, soundboard, onFinish });
    this.active = false;
    this.s = null;
  }

  init() {
    this.modal = document.getElementById('cypher-modal');
    if (!this.modal) return;
    document.getElementById('btn-cypher')?.addEventListener('click', () => this.open());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal || e.target.closest('[data-close="cypher-modal"]')) this.modal.style.display = 'none';
      const b = e.target.closest('[data-cy]');
      if (!b) return;
      const i = Number(b.dataset.i);
      if (b.dataset.cy === 'play') this.play(i);
      if (b.dataset.cy === 'tab') { this.tab = i; this.renderScoring(); }
      if (b.dataset.cy === 'inbox') this.loadInbox(i);
    });
    this.modal.addEventListener('change', (e) => {
      const f = e.target.closest('[data-cy-file]');
      if (f && f.files[0]) {
        const i = Number(f.dataset.cyFile);
        this.s.beats[i] = { url: URL.createObjectURL(f.files[0]), name: f.files[0].name.replace(/\.[^/.]+$/, '') };
        this.renderPlay();
      }
      if (e.target.id === 'cy-seat') { this.seat = Number(e.target.value); this.renderScoring(); }
    });
    document.getElementById('cy-start')?.addEventListener('click', () => this.start());
    document.getElementById('cy-finish')?.addEventListener('click', () => this.finish());
    document.getElementById('cy-cancel')?.addEventListener('click', () => { if (confirm('Cancel this battle? Nothing is recorded.')) this.stop(); });
    document.getElementById('cy-count')?.addEventListener('change', () => this.renderSetup());
    this.link.onCypherCard = (seat, msg) => this.receive(seat, msg);
  }

  open() {
    if (!this.active) this.renderSetup();
    else { this.renderPlay(); this.renderScoring(); }
    this.modal.style.display = '';
  }

  renderSetup() {
    const n = Number(document.getElementById('cy-count').value) || 3;
    const list = this.roster.getForLeague(this.leagues.activeLeagueId);
    const opts = `<option value="">— Producer —</option>${list.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}`;
    const host = document.getElementById('cy-pickers');
    const prev = [...host.querySelectorAll('select')].map(s => s.value);
    host.innerHTML = Array.from({ length: n }, (_, i) => `<select class="form-input" aria-label="Producer ${i + 1}">${opts}</select>`).join('');
    host.querySelectorAll('select').forEach((s, i) => { s.value = prev[i] || ''; });
    document.getElementById('cy-setup').hidden = false;
    document.getElementById('cy-live').hidden = true;
  }

  start() {
    const ids = [...document.querySelectorAll('#cy-pickers select')].map(s => s.value).filter(Boolean);
    if (ids.length < 3 || new Set(ids).size !== ids.length) return this.toast('Pick 3 or 4 different producers');
    // shuffled play order
    const order = [...ids];
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    this.s = {
      id: `cy_${Date.now().toString(36)}`,
      ids: order,
      beats: order.map(() => null),
      cards: {},     // seat -> { s: [[]…], c: [[]…], overall, submitted }
      played: new Set()
    };
    this.active = true;
    this.tab = 0;
    this.seat = 1;
    order.forEach((id, i) => { const b = this.inbox?.beatFor(id, 1); if (b) this.s.beats[i] = { url: b.url, name: b.originalName?.replace(/\.[^/.]+$/, '') || 'Uploaded beat' }; });
    document.getElementById('cy-setup').hidden = true;
    document.getElementById('cy-live').hidden = false;
    this.link.pushState(true);
    this.toast(`⚔ ${ids.length}-way battle: ${order.map(id => this.name(id)).join(' → ')}`);
    this.renderPlay();
    this.renderScoring();
  }

  stop() {
    this.audio.pauseAll();
    this.active = false;
    this.s = null;
    this.link.pushState(true);
    this.renderSetup();
  }

  name(id) { return this.roster.getById(id)?.name || 'Producer'; }

  /** What judges and the stage see (letters by play order when beats are anonymous) */
  label(i) {
    return this.settings.get('anonymizeBeats') ? `Beat ${LETTERS[i]}` : this.name(this.s.ids[i]);
  }

  /** Judge-phone state while the battle runs */
  phoneState() {
    if (!this.active) return null;
    return {
      battleId: this.s.id,
      mode: 'cypher',
      contestants: this.s.ids.map((_, i) => this.label(i)),
      round: 1,
      roundLabel: `${this.s.ids.length}-Way Battle`
    };
  }

  loadInbox(i) {
    const b = this.inbox?.beatFor(this.s.ids[i], 1);
    if (!b) return this.toast('No uploaded beat from this producer');
    this.s.beats[i] = { url: b.url, name: b.originalName?.replace(/\.[^/.]+$/, '') || 'Uploaded beat' };
    this.renderPlay();
  }

  async play(i) {
    const beat = this.s.beats[i];
    if (!beat) return this.toast('Choose a beat file for this producer first');
    const p = this.audio.players[1];
    if (p.playing && this.playing === i) { this.audio.pause(1); this.renderPlay(); return; }
    if (this.loaded !== i) {
      this.audio.loadAudio(1, beat.url, beat.name);
      this.loaded = i;
      await new Promise(res => { const t0 = Date.now(); const iv = setInterval(() => { if (p.loaded || Date.now() - t0 > 8000) { clearInterval(iv); res(); } }, 100); });
      p.title = this.label(i);
    }
    this.timer.stop();
    this.audio.play(1);
    this.timer.play();
    this.playing = i;
    this.s.played.add(i);
    this.renderPlay();
  }

  receive(seat, msg) {
    if (!this.active || msg.battleId !== this.s.id || !Array.isArray(msg.cards)) return;
    this.s.cards[seat] = { s: msg.cards.slice(0, this.s.ids.length), c: msg.commentsN || [], overall: msg.overall || '', submitted: !!msg.submitted || !!this.s.cards[seat]?.submitted };
    this.renderStatus();
  }

  /** Host-screen seat's card */
  hostCard(seat = this.seat) {
    const len = this.scoring.categories.length;
    if (!this.s.cards[seat]) this.s.cards[seat] = { s: this.s.ids.map(() => new Array(len).fill(null)), c: this.s.ids.map(() => new Array(len).fill('')), overall: '', submitted: false, local: true };
    return this.s.cards[seat];
  }

  renderPlay() {
    const host = document.getElementById('cy-order');
    if (!host || !this.s) return;
    host.innerHTML = this.s.ids.map((id, i) => {
      const b = this.s.beats[i];
      const playing = this.audio.players[1].playing && this.playing === i;
      return `<li class="${playing ? 'live' : ''}">
        <span class="cy-letter">${LETTERS[i]}</span>
        <span class="cy-name"><b>${esc(this.name(id))}</b> <small>${b ? esc(b.name) : 'no beat yet'}</small></span>
        <label class="fs-small">📂<input type="file" accept="audio/*" data-cy-file="${i}" hidden /></label>
        ${this.inbox?.beatFor(id, 1) ? `<button type="button" class="fs-small" data-cy="inbox" data-i="${i}">📥</button>` : ''}
        <button type="button" class="control-btn ${playing ? 'secondary' : 'primary'}" data-cy="play" data-i="${i}" ${b ? '' : 'disabled'}>${playing ? '⏸' : this.s.played.has(i) ? '↻ Replay' : '▶ Play'}</button>
      </li>`;
    }).join('');
    this.renderStatus();
  }

  renderScoring() {
    if (!this.s) return;
    const tabs = document.getElementById('cy-tabs');
    tabs.innerHTML = this.s.ids.map((id, i) => `<button type="button" class="fs-small ${i === this.tab ? 'active' : ''}" data-cy="tab" data-i="${i}">${LETTERS[i]} · ${esc(this.name(id))}</button>`).join('');
    const seatSel = document.getElementById('cy-seat');
    const local = [];
    for (let j = 1; j <= (this.judges.mode === 'panel' ? this.judges.totalJudges : 1); j++) if (!this.judges.isRemote(j)) local.push(j);
    seatSel.innerHTML = local.map(j => `<option value="${j}">${esc(this.judges.judgeNames[j])}</option>`).join('');
    if (!local.includes(this.seat)) this.seat = local[0] || 1;
    seatSel.value = String(this.seat);
    seatSel.closest('label').hidden = local.length < 2;
    const card = this.hostCard();
    const scores = card.s[this.tab];
    const step = this.scoring.step || 0.1;
    const list = document.getElementById('cy-sliders');
    list.innerHTML = '';
    this.scoring.categories.forEach((cat, ci) => {
      if (!cat.enabled) return;
      const row = document.createElement('div');
      row.className = 'cy-slider-row';
      const v = scores[ci];
      row.innerHTML = `<span class="cy-cat">${esc(cat.name)}</span><input type="range" min="0" max="10" step="${step}" value="${v ?? 0}" aria-label="${esc(cat.name)} for ${esc(this.name(this.s.ids[this.tab]))}"><span class="cy-val">${v === null || v === undefined ? '—' : v.toFixed(1)}</span>`;
      const inp = row.querySelector('input');
      inp.addEventListener('input', () => {
        scores[ci] = Number(inp.value);
        row.querySelector('.cy-val').textContent = scores[ci].toFixed(1);
        document.getElementById('cy-guide').textContent = this.settings.get('showGuides') ? `${cat.name} · ${guideText(cat, scores[ci], this.scoring.customGuides)}` : '';
        card.submitted = true;
        this.renderStatus();
      });
      list.appendChild(row);
    });
    this.renderStatus();
  }

  /** Cards that count, as totals per producer (calibration scaling applied when on) */
  countedCards() {
    const out = [];
    Object.entries(this.s.cards).forEach(([seat, card]) => {
      if (!card.submitted) return;
      const j = Number(seat);
      if (j > (this.judges.mode === 'panel' ? this.judges.totalJudges : 1)) return;
      const name = this.judges.judgeNames[j];
      const totals = card.s.map(arr => {
        let scores = arr.map(v => v ?? 0);
        if (typeof this.judges.normalizer === 'function') scores = this.judges.normalizer(name, scores) || scores;
        return this.scoring.totalFor(scores);
      });
      out.push({ judge: name, seat: j, totals, card });
    });
    return out;
  }

  renderStatus() {
    const el = document.getElementById('cy-status');
    if (!el || !this.s) return;
    const n = this.judges.mode === 'panel' ? this.judges.totalJudges : 1;
    const cards = this.countedCards();
    const ranking = rankCypher(cards, this.s.ids.length);
    el.textContent = `${cards.length}/${n} judge${n === 1 ? '' : 's'} in · ${this.s.played.size}/${this.s.ids.length} beats played${cards.length ? ` · leading: ${this.name(this.s.ids[ranking[0].index])} (${ranking[0].total.toFixed(2)})` : ''}`;
  }

  finish() {
    if (!this.s) return;
    const n = this.judges.mode === 'panel' ? this.judges.totalJudges : 1;
    const cards = this.countedCards();
    if (!cards.length) return this.toast('No scorecards yet');
    if (cards.length < n && !confirm(`Only ${cards.length} of ${n} judges have scored. Finish anyway?`)) return;
    this.audio.pauseAll();
    this.timer.stop();
    const ranking = rankCypher(cards, this.s.ids.length);
    const placings = ranking.map(r => ({ id: this.s.ids[r.index], name: this.name(this.s.ids[r.index]), total: r.total, firsts: r.firsts, letter: LETTERS[r.index] }));
    const isDemo = false;
    const ids = placings.map(p => p.id);
    const before = Object.fromEntries(ids.map(id => [id, this.roster.ratingOf(this.roster.getById(id) || {})]));
    const after = pairwiseElo(ids, before);
    const categories = this.scoring.categories.map(c => c.name);
    const ratingChanges = {};
    placings.forEach((p, i) => {
      const c = this.roster.getById(p.id);
      ratingChanges[p.id] = { before: before[p.id], after: after[p.id], change: after[p.id] - before[p.id], peakBefore: c?.stats?.peakRating || before[p.id], outcome: i === 0 ? 'win' : 'loss' };
      // average category scores this producer got across the counted judges
      const idx = this.s.ids.indexOf(p.id);
      const catAvg = categories.map((_, ci) => cards.reduce((sum, c2) => sum + (c2.card.s[idx]?.[ci] || 0), 0) / cards.length);
      this.roster.recordBattle(p.id, p.total, i === 0 ? 'win' : 'loss', catAvg, categories, after[p.id]);
    });
    const leagueId = this.leagues.activeLeagueId;
    const result = {
      id: `b_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      kind: 'cypher',
      leagueId,
      seasonId: this.seasonId?.() || null,
      placings,
      contestant1: { id: placings[0].id, name: placings[0].name },
      contestant2: { id: placings[1].id, name: placings[1].name },
      winnerId: placings[0].id,
      winnerName: placings[0].name,
      decisionMethod: 'PLACING',
      decisionTally: `${placings.length}-way · ${placings[0].total.toFixed(2)} – ${placings[1].total.toFixed(2)}`,
      isDemo,
      seriesSummary: { avgRound1: placings[0].total, avgRound2: placings[1].total, roundsPlayed: 1 },
      roundResults: [],
      judgeCards: cards.map(c => ({ judge: c.judge, totals: c.totals, comments: c.card.c, overall: c.card.overall })),
      scoringRules: this.scoring.getRulesSnapshot(),
      ratingChanges
    };
    this.history.addFinalizedBattle(result);
    this.showResults(result);
    this.active = false;
    this.s = null;
    this.link.pushState(true);
    this.onFinish?.(result);
  }

  showResults(result) {
    document.getElementById('cy-live').hidden = true;
    const el = document.getElementById('cy-results');
    el.hidden = false;
    el.innerHTML = `<h3>🏆 ${esc(result.winnerName)} takes it</h3><ol class="cy-podium">${result.placings.map((p, i) => `
      <li class="place-${i + 1}"><span class="cy-place">${['🥇', '🥈', '🥉', '4th'][i]}</span><b>${esc(p.name)}</b><span>${p.total.toFixed(2)}</span><small>${p.firsts} first-place vote${p.firsts === 1 ? '' : 's'} · ${(result.ratingChanges[p.id].change >= 0 ? '+' : '') + result.ratingChanges[p.id].change} rating</small></li>`).join('')}</ol>
      <button type="button" class="control-btn primary" id="cy-again">New 3/4-way battle</button>`;
    el.querySelector('#cy-again').addEventListener('click', () => { el.hidden = true; this.renderSetup(); });
    this.announcer?.play('winner');
    this.soundboard?.play('crowd_cheer');
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export { Cypher, rankCypher, pairwiseElo };
