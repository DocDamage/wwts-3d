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
    const snap = this.scoring.getSnapshot();
    this.rounds[this.currentRound] = {
      scores1: [...snap.scores1],
      scores2: [...snap.scores2],
      total1: snap.total1,
      total2: snap.total2,
      completed: snap.total1 > 0 || snap.total2 > 0,
      isOvertime: this.currentRound === 4
    };
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

  nextRound() {
    if (this.currentRound < this.totalRounds) {
      this.switchRound(this.currentRound + 1);
    } else if (this.isSeriesTied() && !this.hasOvertime) {
      this.triggerOvertime();
    }
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

    // Set high-intensity 60s timer if available
    if (this.timer) {
      this.timer.duration = 60;
      this.timer.remaining = 60;
      this.timer.updateDisplay();
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
    let won1 = 0;
    let won2 = 0;
    for (let r = 1; r <= 3; r++) {
      const t1 = this.rounds[r].total1;
      const t2 = this.rounds[r].total2;
      if (t1 > 0 || t2 > 0) {
        if (t1 > t2) won1++;
        else if (t2 > t1) won2++;
      }
    }
    return (won1 === won2 && (won1 > 0 || won2 > 0));
  }

  renderTabs() {
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
    let roundsWon1 = 0;
    let roundsWon2 = 0;

    for (let r = 1; r <= this.totalRounds; r++) {
      const t1 = this.rounds[r].total1;
      const t2 = this.rounds[r].total2;
      grandTotal1 += t1;
      grandTotal2 += t2;

      if (t1 > 0 || t2 > 0) {
        if (t1 > t2) roundsWon1++;
        else if (t2 > t1) roundsWon2++;
      }
    }

    // Update cumulative series score displays
    const series1El = document.getElementById('series-total-1');
    const series2El = document.getElementById('series-total-2');
    const seriesRounds1El = document.getElementById('series-rounds-1');
    const seriesRounds2El = document.getElementById('series-rounds-2');

    if (series1El) series1El.textContent = grandTotal1.toFixed(1);
    if (series2El) series2El.textContent = grandTotal2.toFixed(1);
    if (seriesRounds1El) seriesRounds1El.textContent = `${roundsWon1} W`;
    if (seriesRounds2El) seriesRounds2El.textContent = `${roundsWon2} W`;
  }

  getSeriesSummary() {
    this.saveCurrentRoundState();
    let total1 = 0;
    let total2 = 0;
    let won1 = 0;
    let won2 = 0;

    for (let r = 1; r <= this.totalRounds; r++) {
      total1 += this.rounds[r].total1;
      total2 += this.rounds[r].total2;
      if (this.rounds[r].total1 > this.rounds[r].total2) won1++;
      else if (this.rounds[r].total2 > this.rounds[r].total1) won2++;
    }

    return {
      grandTotal1: total1,
      grandTotal2: total2,
      roundsWon1: won1,
      roundsWon2: won2,
      hasOvertime: this.hasOvertime,
      totalRounds: this.totalRounds,
      rounds: this.rounds
    };
  }

  reset() {
    this.currentRound = 1;
    this.totalRounds = 3;
    this.hasOvertime = false;
    this.rounds = {
      1: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0, completed: false },
      2: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0, completed: false },
      3: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0, completed: false },
      4: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0, completed: false, isOvertime: true }
    };

    const otTab = document.getElementById('btn-ot-round');
    if (otTab) {
      otTab.style.display = 'none';
    }

    this.renderTabs();
    this.updateSeriesTotals();
  }
}

export { RoundManager };
