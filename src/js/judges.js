/**
 * Judge Panel Manager — solo judging or a panel of 1–5 judges.
 *
 * Each seat is scored either on the host screen (the host switches between
 * scorecards) or from a judge's own phone over the local Wi-Fi (see judgeLink.js).
 * Consensus works for any panel size: unanimous, split, majority, or draw.
 */

const MAX_JUDGES = 5;
const ROUNDS = [1, 2, 3, 4];

const emptyCard = () => ({ scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0 });

class JudgeManager {
  constructor(scoringEngine, announcerManager) {
    this.scoring = scoringEngine;
    this.announcer = announcerManager;

    this.mode = 'solo'; // 'solo' | 'panel'
    this.activeJudge = 1;
    this.totalJudges = 3;

    this.judgeNames = {};
    // Seat → phone assignment: { deviceId, connected } (absent = scored on the host screen)
    this.remote = {};
    // { [judgeId]: { [round]: { scores1, scores2, total1, total2, submitted? } } }
    this.judgeScores = {};
    for (let j = 1; j <= MAX_JUDGES; j++) this.ensureSeat(j);

    this.currentRound = 1;
    this.isDemoMode = false;
    this.onJudgeChange = null;
    this.onPanelChange = null; // seats/mode changed (judgeLink re-syncs phones)
    this.onRequestPhones = null; // "Phones" button → open the connect-judges dialog
    this.penaltyProvider = null; // (round) => { 1: points, 2: points } — time-limit overrun
    this.normalizer = null;      // (judgeName, scores[]) => scores[] — calibration scaling (or null)
  }

  /** A judge's card as it counts: calibration scaling applied when it's on */
  countedCard(j, card) {
    if (!card || typeof this.normalizer !== 'function') return card;
    const name = this.judgeNames[j];
    const s1 = this.normalizer(name, card.scores1);
    const s2 = this.normalizer(name, card.scores2);
    if (!s1 || !s2) return card;
    return { ...card, scores1: s1, scores2: s2, total1: this.scoring.totalFor(s1), total2: this.scoring.totalFor(s2), normalized: true };
  }

  ensureSeat(j) {
    if (!this.judgeNames[j]) this.judgeNames[j] = `Judge ${j}`;
    if (!this.judgeScores[j]) {
      this.judgeScores[j] = {};
      ROUNDS.forEach(r => { this.judgeScores[j][r] = emptyCard(); });
    }
  }

  init() {
    document.querySelectorAll('.judge-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => this.setMode(btn.dataset.mode));
    });

    // Judge tabs are rendered dynamically; delegate clicks
    document.getElementById('judge-selector-group')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.judge-tab-btn');
      if (!btn) return;
      if (btn.dataset.judge === 'consensus') this.openConsensusModal();
      else this.switchJudge(parseInt(btn.dataset.judge, 10));
    });

    document.getElementById('judge-count-select')?.addEventListener('change', (e) => {
      this.setJudgeCount(parseInt(e.target.value, 10));
    });
    document.getElementById('btn-connect-judges')?.addEventListener('click', () => this.onRequestPhones?.());

    document.getElementById('btn-auto-vary-judges')?.addEventListener('click', () => this.autoVaryJudges());

    document.querySelector('[data-close="consensus-modal"]')?.addEventListener('click', () => this.closeConsensusModal());
    const modal = document.getElementById('consensus-modal');
    modal?.addEventListener('click', (e) => { if (e.target === modal) this.closeConsensusModal(); });

    this.renderUI();
  }

  setMode(newMode) {
    if (this.mode === newMode) return;
    this.mode = newMode;
    if (this.mode === 'panel') this.saveCurrentJudgeScores();
    else {
      this.activeJudge = 1;
      this.scoring?.setReadOnly(false);
    }
    this.renderUI();
    this.onPanelChange?.();
  }

  setJudgeCount(n) {
    const count = Math.max(1, Math.min(MAX_JUDGES, n || 1));
    if (count === this.totalJudges) return;
    for (let j = count + 1; j <= this.totalJudges; j++) delete this.remote[j];
    this.totalJudges = count;
    for (let j = 1; j <= count; j++) this.ensureSeat(j);
    if (this.activeJudge > count) this.switchJudge(1);
    this.renderUI();
    this.onPanelChange?.();
  }

  setCurrentRound(roundNum) {
    this.currentRound = roundNum;
  }

  isRemote(judgeId) {
    return !!this.remote[judgeId];
  }

  /** Copy the host's sliders into the active seat (host-screen seats only) */
  saveCurrentJudgeScores() {
    if (!this.scoring) return;
    const j = this.activeJudge || 1;
    if (this.isRemote(j)) return; // phones own their cards
    const snap = this.scoring.getSnapshot();
    const r = this.currentRound || 1;
    this.ensureSeat(j);
    const prev = this.judgeScores[j][r];
    this.judgeScores[j][r] = {
      scores1: [...snap.scores1],
      scores2: [...snap.scores2],
      total1: snap.total1,
      total2: snap.total2,
      comments1: [...(snap.comments1 || [])],
      comments2: [...(snap.comments2 || [])],
      overall: prev?.overall || ''
    };
    this.updateConsensusBadge();
  }

  switchJudge(judgeIndex) {
    if (judgeIndex < 1 || judgeIndex > this.totalJudges) return;
    if (this.activeJudge === judgeIndex) return;

    this.saveCurrentJudgeScores();
    this.activeJudge = judgeIndex;
    this.loadActiveCard();
    this.renderUI();
    this.onJudgeChange?.(this.activeJudge);
  }

  /** Put the active seat's card on the host sliders (read-only for phone judges) */
  loadActiveCard() {
    const r = this.currentRound || 1;
    const card = this.judgeScores[this.activeJudge]?.[r];
    this.scoring.setReadOnly(false);
    this.scoring.setScores(1, card ? card.scores1 : new Array(10).fill(0));
    this.scoring.setScores(2, card ? card.scores2 : new Array(10).fill(0));
    this.scoring.setComments?.(1, card?.comments1 || []);
    this.scoring.setComments?.(2, card?.comments2 || []);
    this.scoring.setReadOnly(this.mode === 'panel' && this.isRemote(this.activeJudge));
  }

  cycleJudge() {
    if (this.mode !== 'panel') return;
    this.switchJudge(this.activeJudge >= this.totalJudges ? 1 : this.activeJudge + 1);
  }

  /* ---------------- Phone judges ---------------- */

  /** Seat a phone: returns the seat number (or null when every seat is taken) */
  assignPhone(deviceId, name, preferredSeat = null) {
    const existing = this.seatForDevice(deviceId);
    if (existing) {
      this.remote[existing].connected = true;
      if (name) this.judgeNames[existing] = name;
      this.renderUI();
      this.onPanelChange?.();
      return existing;
    }
    if (this.mode !== 'panel') this.setMode('panel');

    let seat = preferredSeat && preferredSeat <= MAX_JUDGES && !this.remote[preferredSeat] ? preferredSeat : null;
    // Seat 1 stays with the host screen unless the host gives it away
    if (!seat) {
      for (let j = 2; j <= this.totalJudges; j++) if (!this.remote[j]) { seat = j; break; }
    }
    if (!seat && this.totalJudges < MAX_JUDGES) {
      this.setJudgeCount(this.totalJudges + 1);
      seat = this.totalJudges;
    }
    if (!seat) return null;
    if (seat > this.totalJudges) this.setJudgeCount(seat);
    this.remote[seat] = { deviceId, connected: true };
    if (name) this.judgeNames[seat] = name;
    if (seat === this.activeJudge) this.loadActiveCard();
    this.renderUI();
    this.onPanelChange?.();
    return seat;
  }

  seatForDevice(deviceId) {
    const hit = Object.entries(this.remote).find(([, r]) => r.deviceId === deviceId);
    return hit ? parseInt(hit[0], 10) : null;
  }

  setPhoneConnected(deviceId, connected) {
    const seat = this.seatForDevice(deviceId);
    if (!seat) return;
    this.remote[seat].connected = connected;
    this.renderUI();
  }

  /** Give a seat back to the host screen */
  releaseSeat(seat) {
    if (!this.remote[seat]) return;
    delete this.remote[seat];
    this.judgeNames[seat] = `Judge ${seat}`;
    if (seat === this.activeJudge) this.loadActiveCard();
    this.renderUI();
    this.onPanelChange?.();
  }

  /** Scores arriving from a phone */
  receiveRemoteScores(seat, round, scores1, scores2, submitted, extra = {}) {
    if (!seat || !this.judgeScores[seat]) return;
    const r = round || this.currentRound || 1;
    const prev = this.judgeScores[seat][r];
    this.judgeScores[seat][r] = {
      scores1: [...scores1],
      scores2: [...scores2],
      total1: this.scoring.totalFor(scores1),
      total2: this.scoring.totalFor(scores2),
      submitted: !!submitted || !!prev?.submitted,
      comments1: extra.comments1 || prev?.comments1 || [],
      comments2: extra.comments2 || prev?.comments2 || [],
      overall: extra.overall ?? prev?.overall ?? ''
    };
    if (seat === this.activeJudge && r === this.currentRound) this.loadActiveCard();
    this.updateConsensusBadge();
    this.renderUI();
  }

  /** Rules changed (preset/weights): recompute every stored total */
  recomputeTotals() {
    Object.values(this.judgeScores).forEach(rounds => {
      Object.values(rounds).forEach(card => {
        card.total1 = this.scoring.totalFor(card.scores1);
        card.total2 = this.scoring.totalFor(card.scores2);
      });
    });
    this.updateConsensusBadge();
  }

  /**
   * Demo helper: varies the host's Judge 1 card (±0.6) onto every other
   * host-screen seat so a panel decision can be previewed.
   */
  autoVaryJudges() {
    this.isDemoMode = true;
    this.saveCurrentJudgeScores();
    const r = this.currentRound || 1;
    const base = this.judgeScores[1][r];
    if (!base || (base.total1 === 0 && base.total2 === 0)) return;

    const vary = (val) => (val === 0 ? 0 : Math.max(0, Math.min(10, Math.round((val + (Math.random() - 0.48) * 1.2) * 10) / 10)));
    for (let j = 2; j <= this.totalJudges; j++) {
      if (this.isRemote(j)) continue;
      const scores1 = base.scores1.map(vary);
      const scores2 = base.scores2.map(vary);
      this.judgeScores[j][r] = { scores1, scores2, total1: this.scoring.totalFor(scores1), total2: this.scoring.totalFor(scores2) };
    }
    const badge = typeof document !== 'undefined' ? document.getElementById('judge-consensus-badge') : null;
    if (badge) {
      badge.classList.add('pulse-glow');
      setTimeout(() => badge.classList.remove('pulse-glow'), 600);
    }
    this.updateConsensusBadge();
  }

  /** Has this seat turned in a card for the round? */
  isScored(judgeId, round) {
    const card = this.judgeScores[judgeId]?.[round];
    if (!card) return false;
    if (this.isRemote(judgeId)) return !!card.submitted;
    return card.total1 > 0 || card.total2 > 0;
  }

  /** Average card of every seat that has scored this round (panel mode), or null */
  getPanelCard(round) {
    if (this.mode !== 'panel') return null;
    const r = round || this.currentRound || 1;
    const cards = [];
    for (let j = 1; j <= this.totalJudges; j++) {
      if (this.isScored(j, r)) cards.push(this.countedCard(j, this.judgeScores[j][r]));
    }
    if (!cards.length) return null;
    const avg = (key) => cards[0][key].map((_, i) => Number((cards.reduce((sum, c) => sum + (c[key][i] || 0), 0) / cards.length).toFixed(3)));
    const scores1 = avg('scores1');
    const scores2 = avg('scores2');
    return { scores1, scores2, total1: this.scoring.totalFor(scores1), total2: this.scoring.totalFor(scores2) };
  }

  /** Consensus across the panel for a round */
  getConsensus(roundNum = null) {
    const r = roundNum || this.currentRound || 1;
    const n = this.totalJudges;
    const judges = [];
    let sumTotal1 = 0;
    let sumTotal2 = 0;
    let votes1 = 0;
    let votes2 = 0;
    let draws = 0;
    let scoredCount = 0;

    const pen = typeof this.penaltyProvider === 'function' ? (this.penaltyProvider(r) || {}) : {};
    for (let j = 1; j <= n; j++) {
      const raw = this.judgeScores[j]?.[r] || { total1: 0, total2: 0 };
      const data = this.countedCard(j, raw) || raw;
      const scored = this.isScored(j, r);
      // time-limit penalties come off every judge's card for that producer
      const t1 = Math.max(0, (data.total1 || 0) - (scored ? pen[1] || 0 : 0));
      const t2 = Math.max(0, (data.total2 || 0) - (scored ? pen[2] || 0 : 0));
      let winner = 'draw';
      if (scored) {
        scoredCount++;
        sumTotal1 += t1;
        sumTotal2 += t2;
        if (t1 > t2) { winner = 1; votes1++; } else if (t2 > t1) { winner = 2; votes2++; } else { draws++; }
      }
      judges.push({
        judgeId: j, judgeName: this.judgeNames[j], total1: t1, total2: t2, winner, scored, remote: this.isRemote(j),
        comments1: raw.comments1 || [], comments2: raw.comments2 || [], overall: raw.overall || '', normalized: !!data.normalized
      });
    }

    const isComplete = scoredCount === n;
    const avgTotal1 = isComplete ? Number((sumTotal1 / n).toFixed(2)) : 0;
    const avgTotal2 = isComplete ? Number((sumTotal2 / n).toFixed(2)) : 0;

    let consensusWinner = null;
    let decisionType = 'PENDING';
    let decisionTally = `${votes1} - ${votes2} (${scoredCount}/${n} Scored)`;

    if (isComplete) {
      const lead = votes1 === votes2 ? null : votes1 > votes2 ? 1 : 2;
      const w = Math.max(votes1, votes2);
      const l = Math.min(votes1, votes2);
      if (!lead) {
        decisionType = 'DRAW';
        decisionTally = draws ? `${votes1} - ${votes2} (${draws} Draw${draws > 1 ? 's' : ''})` : `${votes1} - ${votes2}`;
      } else if (w === n) {
        consensusWinner = lead;
        decisionType = 'UNANIMOUS';
        decisionTally = `${n} - 0`;
      } else if (l > 0) {
        consensusWinner = lead;
        decisionType = 'SPLIT';
        decisionTally = draws ? `${w} - ${l} (${draws} Draw${draws > 1 ? 's' : ''})` : `${w} - ${l}`;
      } else {
        consensusWinner = lead;
        decisionType = 'MAJORITY';
        decisionTally = `${w} - 0 (${draws} Draw${draws > 1 ? 's' : ''})`;
      }
    }

    return { round: r, judges, avgTotal1, avgTotal2, votes1, votes2, draws, consensusWinner, decisionType, decisionTally, isComplete };
  }

  setJudgeName(judgeId, name) {
    if (judgeId >= 1 && judgeId <= MAX_JUDGES && name) {
      this.judgeNames[judgeId] = name.trim().slice(0, 24);
      this.renderUI();
    }
  }

  updateConsensusBadge() {
    if (typeof document === 'undefined') return;
    const badge = document.getElementById('judge-consensus-badge');
    if (!badge || this.mode !== 'panel') return;
    const consensus = this.getConsensus();
    const typeEl = badge.querySelector('.consensus-type');
    const tallyEl = badge.querySelector('.consensus-tally');
    if (typeEl && tallyEl) {
      typeEl.textContent = `${consensus.decisionType} DECISION`;
      tallyEl.textContent = consensus.decisionTally;
      badge.className = 'judge-consensus-badge';
      badge.classList.add(consensus.decisionType === 'UNANIMOUS' ? 'unanimous' : consensus.decisionType === 'SPLIT' ? 'split' : 'draw');
    }
  }

  openConsensusModal() {
    const modal = document.getElementById('consensus-modal');
    if (!modal) return;
    this.saveCurrentJudgeScores();
    const consensus = this.getConsensus();
    const esc = (s) => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const p1Name = esc(document.getElementById('contestant-1-display')?.textContent || 'Contestant 1');
    const p2Name = esc(document.getElementById('contestant-2-display')?.textContent || 'Contestant 2');

    const cardsHtml = consensus.judges.map(j => {
      const verdict = !j.scored ? 'Waiting…' : j.winner === 1 ? p1Name : j.winner === 2 ? p2Name : 'DRAW';
      const winColor = !j.scored ? '#5a5a6e' : j.winner === 1 ? '#ff2d2d' : j.winner === 2 ? '#00e5ff' : '#ffaa00';
      return `
        <div class="judge-scorecard-row">
          <div class="judge-card-header">
            <span class="j-title">${j.remote ? '📱 ' : ''}${esc(j.judgeName)}</span>
            <span class="j-verdict" style="color: ${winColor}">➔ ${verdict}</span>
          </div>
          <div class="judge-card-scores">
            <span class="j-score p1">${p1Name}: <strong>${j.total1.toFixed(2)}</strong></span>
            <span class="j-score p2">${p2Name}: <strong>${j.total2.toFixed(2)}</strong></span>
          </div>
        </div>`;
    }).join('');

    const bodyEl = document.getElementById('consensus-modal-body');
    if (bodyEl) {
      bodyEl.innerHTML = `
        <div class="consensus-banner ${consensus.decisionType.toLowerCase()}">
          <span class="banner-title">${consensus.decisionType} DECISION (${consensus.decisionTally})</span>
          <span class="banner-subtitle">Consensus Winner: ${consensus.consensusWinner === 1 ? p1Name : consensus.consensusWinner === 2 ? p2Name : consensus.isComplete ? 'DRAW' : 'Waiting on judges'}</span>
        </div>
        <div class="consensus-judges-list">${cardsHtml}</div>
        <div class="consensus-averages">
          <div class="avg-box p1"><span>${p1Name} Avg</span><strong>${consensus.avgTotal1.toFixed(2)}</strong></div>
          <div class="avg-box p2"><span>${p2Name} Avg</span><strong>${consensus.avgTotal2.toFixed(2)}</strong></div>
        </div>`;
    }
    modal.style.display = '';
  }

  closeConsensusModal() {
    const modal = document.getElementById('consensus-modal');
    if (modal) modal.style.display = 'none';
  }

  renderUI() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.judge-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === this.mode);
    });

    const selectorGroup = document.getElementById('judge-selector-group');
    const consensusBadge = document.getElementById('judge-consensus-badge');
    const autoVaryBtn = document.getElementById('btn-auto-vary-judges');
    const countSelect = document.getElementById('judge-count-select');
    const panel = this.mode === 'panel';

    if (selectorGroup) {
      selectorGroup.style.display = panel ? 'flex' : 'none';
      if (panel) {
        const r = this.currentRound || 1;
        let html = '';
        for (let j = 1; j <= this.totalJudges; j++) {
          const remote = this.remote[j];
          const status = remote ? (remote.connected ? 'phone' : 'phone-off') : 'local';
          const done = this.isScored(j, r);
          const title = remote
            ? `${this.judgeNames[j]} — scoring on their phone${remote.connected ? '' : ' (disconnected)'}${done ? ' · submitted' : ''}`
            : `${this.judgeNames[j]} — scored on this screen`;
          html += `<button type="button" class="judge-tab-btn ${j === this.activeJudge ? 'active' : ''} ${status}" data-judge="${j}" title="${title}">
            <span class="judge-indicator j${((j - 1) % 5) + 1}"></span>${remote ? '📱 ' : ''}${this.escape(this.judgeNames[j])}${done ? ' ✓' : ''}
          </button>`;
        }
        html += '<button type="button" class="judge-tab-btn consensus" data-judge="consensus" title="All scorecards &amp; the decision">📊 Consensus</button>';
        selectorGroup.innerHTML = html;
      }
    }
    if (countSelect) {
      countSelect.style.display = panel ? '' : 'none';
      countSelect.value = String(this.totalJudges);
    }
    if (consensusBadge) consensusBadge.style.display = panel ? 'flex' : 'none';
    if (autoVaryBtn) autoVaryBtn.style.display = panel && Object.keys(this.remote).length < this.totalJudges - 1 ? 'inline-flex' : 'none';
    if (panel) this.updateConsensusBadge();
  }

  escape(s) {
    return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  /** Everything needed to rebuild the panel after a host-screen reload */
  exportState() {
    const remote = {};
    Object.entries(this.remote).forEach(([seat, r]) => { remote[seat] = { deviceId: r.deviceId }; });
    return {
      mode: this.mode,
      totalJudges: this.totalJudges,
      activeJudge: this.activeJudge,
      judgeNames: { ...this.judgeNames },
      judgeScores: JSON.parse(JSON.stringify(this.judgeScores)),
      remote,
      isDemoMode: this.isDemoMode
    };
  }

  importState(saved) {
    if (!saved) return;
    this.mode = saved.mode === 'panel' ? 'panel' : 'solo';
    this.totalJudges = Math.max(1, Math.min(MAX_JUDGES, saved.totalJudges || 3));
    Object.assign(this.judgeNames, saved.judgeNames || {});
    if (saved.judgeScores) this.judgeScores = saved.judgeScores;
    for (let j = 1; j <= MAX_JUDGES; j++) this.ensureSeat(j);
    this.remote = {};
    // Phones are offline until they reconnect and the hub replays them
    Object.entries(saved.remote || {}).forEach(([seat, r]) => { this.remote[seat] = { deviceId: r.deviceId, connected: false }; });
    this.activeJudge = Math.min(saved.activeJudge || 1, this.totalJudges);
    this.isDemoMode = !!saved.isDemoMode;
    if (this.mode === 'panel') this.loadActiveCard();
    this.renderUI();
    this.onPanelChange?.();
  }

  reset() {
    for (let j = 1; j <= MAX_JUDGES; j++) {
      ROUNDS.forEach(r => { this.judgeScores[j][r] = emptyCard(); });
    }
    this.activeJudge = 1;
    this.isDemoMode = false;
    this.scoring?.setReadOnly(false);
    this.renderUI();
    this.onPanelChange?.();
  }
}

export { JudgeManager, MAX_JUDGES };
