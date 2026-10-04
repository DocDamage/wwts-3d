/**
 * Round Manager — Best-of-3 Multi-Round Battle System
 * Tracks independent scores, category breakdowns, and cumulative series tallies
 * across Round 1, Round 2, Final Round, and Sudden Death Overtime (OT).
 */

class RoundManager {
  constructor(scoringEngine, announcerManager, djController, timerEngine = null) {
    this.scoring = scoringEngine;
    this.announcer = announcerManager;
    this.djController = djController;
    this.timer = timerEngine;

    this.totalRounds = 3;
    this.currentRound = 1;
    this.hasOvertime = false;

    this.rounds = {
      1: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0, completed: false },
      2: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0, completed: false },
      3: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0, completed: false },
      4: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0, completed: false, isOvertime: true }
    };

    this.onRoundChange = null;
    this.scoreProvider = null;  // (round) => { scores1, scores2, total1, total2 } | null
    this.winnerProvider = null; // (round) => 1 | 2 | 'draw' | null  (panel vote decides rounds)

    this.locked = new Set();    // rounds whose scorecards are locked (reopening needs a reason)
    this.penalties = {};        // { round: { 1: { points, seconds }, 2: … } } — running over time
    this.flips = {};            // { round: { name, url } } — flip rounds (both flip this sample)
  }

  /* ---------------- locks, penalties, flip rounds ---------------- */

  lock(r = this.currentRound) { this.locked.add(r); this.renderTabs(); }

  unlock(r = this.currentRound) { this.locked.delete(r); this.renderTabs(); }

  isLocked(r = this.currentRound) { return this.locked.has(r); }

  /** Points taken off a producer's round total (time-limit overrun) */
  penaltyFor(r, slot) { return this.penalties[r]?.[slot]?.points || 0; }

  addPenalty(r, slot, points, seconds) {
    this.penalties[r] = this.penalties[r] || {};
    const prev = this.penalties[r][slot] || { points: 0, seconds: 0 };
    this.penalties[r][slot] = { points: Number((prev.points + points).toFixed(2)), seconds: prev.seconds + seconds };
    this.updateSeriesTotals();
  }

  clearPenalty(r, slot) {
    if (this.penalties[r]) delete this.penalties[r][slot];
    this.updateSeriesTotals();
  }

  setFlip(r, flip) {
    if (flip) this.flips[r] = { name: flip.name || 'Sample', url: flip.url };
    else delete this.flips[r];
    this.renderTabs();
  }

  flipFor(r = this.currentRound) { return this.flips[r] || null; }

  /** Who took a round: the judges' vote when a panel decides it, otherwise the higher total */
  roundWinner(r) {
    const data = this.rounds[r];
    if (!data || !(data.total1 > 0 || data.total2 > 0)) return null;
    const voted = typeof this.winnerProvider === 'function' ? this.winnerProvider(r) : undefined;
    if (voted === 1 || voted === 2 || voted === 'draw') return voted;
    if (data.total1 > data.total2) return 1;
    if (data.total2 > data.total1) return 2;
    return 'draw';
  }

  /** Rounds won by each side across rounds 1..upTo */
  countWins(upTo = this.totalRounds) {
    let won1 = 0;
    let won2 = 0;
    for (let r = 1; r <= upTo; r++) {
      const w = this.roundWinner(r);
      if (w === 1) won1++;
      else if (w === 2) won2++;
    }
    return { won1, won2 };
  }

  init() {
    // Wire round tab buttons in the UI
    document.querySelectorAll('.round-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const roundNum = parseInt(btn.dataset.round);
        if (roundNum && roundNum !== this.currentRound) {
          this.switchRound(roundNum);
        }
      });
    });

    // Wire Next Round button
    const nextBtn = document.getElementById('btn-next-round');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        this.nextRound();
      });
    }

    // Wire Sudden Death OT trigger button
    const otBtn = document.getElementById('btn-trigger-ot');
    if (otBtn) {
      otBtn.addEventListener('click', () => {
        this.triggerOvertime();
      });
    }

    this.renderTabs();
  }

  saveCurrentRoundState() {
    // In panel mode the round score is the judges' average, not whichever card is on screen
    const provided = typeof this.scoreProvider === 'function' ? this.scoreProvider(this.currentRound) : null;
    const snap = provided || this.scoring.getSnapshot();
    const r = this.currentRound;
    const pen1 = this.penaltyFor(r, 1);
    const pen2 = this.penaltyFor(r, 2);
    const scored = snap.total1 > 0 || snap.total2 > 0;
    this.rounds[r] = {
      scores1: [...snap.scores1],
      scores2: [...snap.scores2],
      // overtime penalties come off the round total (never below zero)
      total1: scored ? Math.max(0, Number((snap.total1 - pen1).toFixed(2))) : 0,
      total2: scored ? Math.max(0, Number((snap.total2 - pen2).toFixed(2))) : 0,
      rawTotal1: snap.total1,
      rawTotal2: snap.total2,
      penalty1: pen1 || 0,
      penalty2: pen2 || 0,
      completed: scored,
      isOvertime: r === 4,
      isFlip: !!this.flips[r]
    };
    // solo judging: the host's category comments belong to the round (panels keep them per judge)
    if (!provided && (snap.comments1?.some(Boolean) || snap.comments2?.some(Boolean))) {
      this.rounds[r].comments1 = [...snap.comments1];
      this.rounds[r].comments2 = [...snap.comments2];
    }
  }

  switchRound(newRound) {
    if (newRound < 1 || newRound > this.totalRounds) return;

    // 1. Save current active round scores
    this.saveCurrentRoundState();

    // 2. Switch round index
    this.currentRound = newRound;

    // 3. Load target round scores into ScoringEngine
    const target = this.rounds[this.currentRound];
    this.scoring.setScores(1, target.scores1);
    this.scoring.setScores(2, target.scores2);
    this.scoring.setComments?.(1, target.comments1 || []);
    this.scoring.setComments?.(2, target.comments2 || []);

    // 4. Trigger Announcer & Stage Smoke
    if (this.announcer) {
      if (this.currentRound === 4) {
        this.announcer.play('round4', () => {
          setTimeout(() => this.announcer.play('fight'), 400);
        });
      } else {
        this.announcer.announceRoundStart(this.currentRound);
      }
    }
    if (this.djController) {
      const smokeColor = this.currentRound === 4 ? 0xff0055 : (this.currentRound === 3 ? 0xffaa00 : 0x00e5ff);
      this.djController.triggerSmokeBlast(2.2, smokeColor);
    }

    // 5. Update UI
    this.renderTabs();
    this.updateSeriesTotals();

    if (typeof this.onRoundChange === 'function') {
      this.onRoundChange(this.currentRound, this.currentRound === 4);
    }
  }

  isSeriesClinched() {
    this.saveCurrentRoundState();
    const { won1, won2 } = this.countWins(3);
    return won1 >= 2 || won2 >= 2;
  }

  nextRound() {
    if (this.isSeriesClinched() && this.currentRound >= 2) {
      this.showClinchToast();
      return;
    }
    if (this.currentRound < this.totalRounds) {
      this.switchRound(this.currentRound + 1);
    } else if (this.isSeriesTied() && !this.hasOvertime && this.overtimeEnabled !== false) {
      this.triggerOvertime();
    }
  }

  showClinchToast() {
    let toast = document.getElementById('clinch-banner-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'clinch-banner-toast';
      toast.className = 'ot-banner-toast clinch-banner';
      document.body.appendChild(toast);
    }

    toast.innerHTML = `
      <div class="ot-toast-content">
        <span class="ot-icon">🏆</span>
        <div class="ot-text">
          <strong>MATCH CLINCHED (2-0)!</strong>
          <span>Series decided by first to two round wins. Ready to lock & finalize!</span>
        </div>
      </div>
    `;

    toast.classList.add('visible');
    setTimeout(() => {
      toast.classList.remove('visible');
    }, 4000);
  }

  /**
   * Triggers a Sudden Death Overtime round
   */
  triggerOvertime() {
    this.hasOvertime = true;
    this.totalRounds = 4;

    const otTab = document.getElementById('btn-ot-round');
    if (otTab) {
      otTab.style.display = 'inline-flex';
    }

    // Switch to round 4
    this.switchRound(4);

    // Set high-intensity 60s timer via duration interface
    if (this.timer) {
      this.timer.setDuration(this.overtimeSeconds || 60, true);
    }

    // Show Sudden Death Banner Notification
    this.showOtToast();
  }

  showOtToast() {
    let toast = document.getElementById('ot-banner-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'ot-banner-toast';
      toast.className = 'ot-banner-toast';
      document.body.appendChild(toast);
    }

    toast.innerHTML = `
      <div class="ot-toast-content">
        <span class="ot-icon">⚡</span>
        <div class="ot-text">
          <strong>SUDDEN DEATH OVERTIME!</strong>
          <span>Final 60-Second Clash to Break the Series Tie</span>
        </div>
      </div>
    `;

    toast.classList.add('visible');
    setTimeout(() => {
      toast.classList.remove('visible');
    }, 4500);
  }

  isSeriesTied() {
    this.saveCurrentRoundState();
    const { won1, won2 } = this.countWins(3);
    const played = [1, 2, 3].filter(r => this.roundWinner(r)).length;
    // Level after the regulation rounds (including all-draw series) → overtime decides it
    return won1 === won2 && played > 0 && (played === 3 || won1 > 0);
  }

  renderTabs() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.round-tab-btn').forEach(btn => {
      const r = parseInt(btn.dataset.round);
      if (r === this.currentRound) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }

      // Show completed checkmark if round has scores
      const data = this.rounds[r];
      const hasScores = data && (data.total1 > 0 || data.total2 > 0);
      if (hasScores) {
        btn.classList.add('has-scores');
      } else {
        btn.classList.remove('has-scores');
      }
      btn.classList.toggle('is-locked', this.locked.has(r));
      btn.classList.toggle('is-flip', !!this.flips[r]);
    });

    const roundTitleEl = document.getElementById('current-round-title');
    if (roundTitleEl) {
      if (this.currentRound === 4) {
        roundTitleEl.textContent = '⚡ SUDDEN DEATH OT';
      } else if (this.currentRound === 3) {
        roundTitleEl.textContent = 'FINAL ROUND';
      } else {
        roundTitleEl.textContent = `ROUND ${this.currentRound}`;
      }
    }
  }

  updateSeriesTotals() {
    this.saveCurrentRoundState();

    let grandTotal1 = 0;
    let grandTotal2 = 0;
    for (let r = 1; r <= this.totalRounds; r++) {
      grandTotal1 += this.rounds[r].total1;
      grandTotal2 += this.rounds[r].total2;
    }
    const { won1: roundsWon1, won2: roundsWon2 } = this.countWins();

    // Update cumulative series score displays
    if (typeof document !== 'undefined') {
      const series1El = document.getElementById('series-total-1');
      const series2El = document.getElementById('series-total-2');
      const seriesRounds1El = document.getElementById('series-rounds-1');
      const seriesRounds2El = document.getElementById('series-rounds-2');

      if (series1El) series1El.textContent = grandTotal1.toFixed(2);
      if (series2El) series2El.textContent = grandTotal2.toFixed(2);
      if (seriesRounds1El) seriesRounds1El.textContent = `${roundsWon1} W`;
      if (seriesRounds2El) seriesRounds2El.textContent = `${roundsWon2} W`;
    }
  }

  getSeriesSummary() {
    this.saveCurrentRoundState();
    let total1 = 0;
    let total2 = 0;
    let played = 0;
    const winners = {};
    for (let r = 1; r <= this.totalRounds; r++) {
      total1 += this.rounds[r].total1;
      total2 += this.rounds[r].total2;
      winners[r] = this.roundWinner(r);
      if (winners[r]) played++;
    }
    const { won1, won2 } = this.countWins();

    return {
      grandTotal1: total1,
      grandTotal2: total2,
      roundsWon1: won1,
      roundsWon2: won2,
      roundsPlayed: played,
      roundWinners: winners,
      hasOvertime: this.hasOvertime,
      totalRounds: this.totalRounds,
      rounds: this.rounds
    };
  }

  exportState() {
    this.saveCurrentRoundState();
    const flips = {};
    // object URLs don't survive a reload; keep the sample name so the host knows to reload it
    Object.entries(this.flips).forEach(([r, f]) => { flips[r] = { name: f.name, url: /^blob:/.test(f.url) ? null : f.url }; });
    return {
      rounds: JSON.parse(JSON.stringify(this.rounds)), totalRounds: this.totalRounds, hasOvertime: this.hasOvertime,
      locked: [...this.locked], penalties: JSON.parse(JSON.stringify(this.penalties)), flips
    };
  }

  importState(saved) {
    if (!saved?.rounds) return;
    this.rounds = saved.rounds;
    this.totalRounds = saved.totalRounds || 3;
    this.hasOvertime = !!saved.hasOvertime;
    this.locked = new Set(saved.locked || []);
    this.penalties = saved.penalties || {};
    this.flips = {};
    Object.entries(saved.flips || {}).forEach(([r, f]) => { if (f?.url) this.flips[r] = f; });
    this.renderTabs();
    this.updateSeriesTotals();
  }

  reset() {
    this.currentRound = 1;
    this.totalRounds = 3;
    this.hasOvertime = false;
    this.locked = new Set();
    this.penalties = {};
    this.flips = {};
    this.rounds = {
      1: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0, completed: false },
      2: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0, completed: false },
      3: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0, completed: false },
      4: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0, completed: false, isOvertime: true }
    };

    const otTab = typeof document !== 'undefined' ? document.getElementById('btn-ot-round') : null;
    if (otTab) {
      otTab.style.display = 'none';
    }

    if (this.timer) {
      this.timer.setDuration(this.roundSeconds || 180, true);
    }

    this.renderTabs();
    this.updateSeriesTotals();
  }
}

export { RoundManager };
