/**
 * 3-Judge Panel Manager — Pro Beat Battle Judging System
 * Supports Solo Judge vs 3-Judge Panel with independent scorecards,
 * Judge 1/2/3 switching, Quick-Simulate/Auto-Vary, and Unanimous vs Split Decision detection.
 */

class JudgeManager {
  constructor(scoringEngine, announcerManager) {
    this.scoring = scoringEngine;
    this.announcer = announcerManager;

    this.mode = 'solo'; // 'solo' | 'panel'
    this.activeJudge = 1; // 1 | 2 | 3
    this.totalJudges = 3;

    // Names for each judge
    this.judgeNames = {
      1: 'Judge 1',
      2: 'Judge 2',
      3: 'Judge 3'
    };

    // Store per-judge, per-round scores
    // structure: { [judgeId]: { [roundId]: { scores1: number[], scores2: number[], total1: number, total2: number } } }
    this.judgeScores = {
      1: {
        1: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0 },
        2: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0 },
        3: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0 },
        4: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0 }
      },
      2: {
        1: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0 },
        2: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0 },
        3: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0 },
        4: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0 }
      },
      3: {
        1: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0 },
        2: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0 },
        3: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0 },
        4: { scores1: new Array(10).fill(0), scores2: new Array(10).fill(0), total1: 0, total2: 0 }
      }
    };

    this.currentRound = 1;
    this.isDemoMode = false;
    this.onJudgeChange = null;
  }

  init() {
    // Mode toggles
    document.querySelectorAll('.judge-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetMode = btn.dataset.mode;
        this.setMode(targetMode);
      });
    });

    // Judge tabs
    document.querySelectorAll('.judge-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const jId = btn.dataset.judge;
        if (jId === 'consensus') {
          this.openConsensusModal();
        } else {
          this.switchJudge(parseInt(jId));
        }
      });
    });

    // Auto-vary button
    const autoVaryBtn = document.getElementById('btn-auto-vary-judges');
    if (autoVaryBtn) {
      autoVaryBtn.addEventListener('click', () => {
        this.autoVaryJudges();
      });
    }

    // Close consensus modal
    const closeConsensusBtn = document.querySelector('[data-close="consensus-modal"]');
    if (closeConsensusBtn) {
      closeConsensusBtn.addEventListener('click', () => {
        this.closeConsensusModal();
      });
    }

    const modal = document.getElementById('consensus-modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeConsensusModal();
      });
    }

    this.renderUI();
  }

  setMode(newMode) {
    if (this.mode === newMode) return;
    this.mode = newMode;

    // If switching to panel, sync current scoring sliders into Judge 1
    if (this.mode === 'panel') {
      this.saveCurrentJudgeScores();
    }

    this.renderUI();
  }

  setCurrentRound(roundNum) {
    this.currentRound = roundNum;
  }

  saveCurrentJudgeScores() {
    if (!this.scoring) return;
    const snap = this.scoring.getSnapshot();
    const r = this.currentRound || 1;
    const j = this.activeJudge || 1;

    if (!this.judgeScores[j]) this.judgeScores[j] = {};
    this.judgeScores[j][r] = {
      scores1: [...snap.scores1],
      scores2: [...snap.scores2],
      total1: snap.total1,
      total2: snap.total2
    };

    this.updateConsensusBadge();
  }

  switchJudge(judgeIndex) {
    if (judgeIndex < 1 || judgeIndex > this.totalJudges) return;
    if (this.activeJudge === judgeIndex) return;

    // 1. Save currently active judge's sliders
    this.saveCurrentJudgeScores();

    // 2. Switch judge pointer
    this.activeJudge = judgeIndex;

    // 3. Load target judge's scores into ScoringEngine
    const r = this.currentRound || 1;
    const targetData = this.judgeScores[this.activeJudge]?.[r];

    if (targetData) {
      this.scoring.setScores(1, targetData.scores1);
      this.scoring.setScores(2, targetData.scores2);
    } else {
      this.scoring.setScores(1, new Array(10).fill(0));
      this.scoring.setScores(2, new Array(10).fill(0));
    }

    // 4. Update UI
    this.renderUI();

    if (typeof this.onJudgeChange === 'function') {
      this.onJudgeChange(this.activeJudge);
    }
  }

  cycleJudge() {
    if (this.mode !== 'panel') return;
    const nextJudge = this.activeJudge === 3 ? 1 : this.activeJudge + 1;
    this.switchJudge(nextJudge);
  }

  /**
   * Helper for realistic judging: takes Judge 1's scores and simulates
   * nuanced, realistic variations (±0.3 to ±0.8) for Judge 2 and Judge 3.
   */
  autoVaryJudges() {
    this.isDemoMode = true;
    this.saveCurrentJudgeScores();
    const r = this.currentRound || 1;
    const base = this.judgeScores[1][r];

    if (base.total1 === 0 && base.total2 === 0) {
      // Nothing scored on Judge 1 yet
      return;
    }

    for (const j of [2, 3]) {
      const varied1 = base.scores1.map(val => {
        if (val === 0) return 0;
        const delta = (Math.random() - 0.48) * 1.2; // slight shift
        return Math.max(0, Math.min(10, Math.round((val + delta) * 10) / 10));
      });
      const varied2 = base.scores2.map(val => {
        if (val === 0) return 0;
        const delta = (Math.random() - 0.48) * 1.2;
        return Math.max(0, Math.min(10, Math.round((val + delta) * 10) / 10));
      });

      const total1 = varied1.reduce((sum, s) => sum + s, 0);
      const total2 = varied2.reduce((sum, s) => sum + s, 0);

      this.judgeScores[j][r] = {
        scores1: varied1,
        scores2: varied2,
        total1,
        total2
      };
    }

    // Flash feedback
    if (typeof document !== 'undefined') {
      const badge = document.getElementById('judge-consensus-badge');
      if (badge) {
        badge.classList.add('pulse-glow');
        setTimeout(() => badge.classList.remove('pulse-glow'), 600);
      }
    }

    this.updateConsensusBadge();
  }

  /**
   * Calculates consensus across all 3 judges for the current round or series
   */
  getConsensus(roundNum = null) {
    const r = roundNum || this.currentRound || 1;

    const results = [];
    let sumTotal1 = 0;
    let sumTotal2 = 0;
    let votes1 = 0;
    let votes2 = 0;
    let draws = 0;

    for (let j = 1; j <= this.totalJudges; j++) {
      const data = this.judgeScores[j][r] || { total1: 0, total2: 0 };
      const t1 = data.total1;
      const t2 = data.total2;
      sumTotal1 += t1;
      sumTotal2 += t2;

      let winner = 'draw';
      if (t1 > t2) {
        winner = 1;
        votes1++;
      } else if (t2 > t1) {
        winner = 2;
        votes2++;
      } else if (t1 > 0 || t2 > 0) {
        draws++;
      }

      results.push({
        judgeId: j,
        judgeName: this.judgeNames[j],
        total1: t1,
        total2: t2,
        winner
      });
    }

    const scoredJudges = results.filter(j => j.total1 > 0 || j.total2 > 0);
    const isComplete = scoredJudges.length === this.totalJudges;

    const avgTotal1 = isComplete ? Number((sumTotal1 / this.totalJudges).toFixed(1)) : 0;
    const avgTotal2 = isComplete ? Number((sumTotal2 / this.totalJudges).toFixed(1)) : 0;

    let consensusWinner = null;
    let decisionType = 'PENDING';
    let decisionTally = `${votes1} - ${votes2} (${scoredJudges.length}/${this.totalJudges} Scored)`;

    if (!isComplete) {
      decisionType = 'PENDING';
      consensusWinner = null;
    } else if (votes1 === 3) {
      consensusWinner = 1;
      decisionType = 'UNANIMOUS';
      decisionTally = '3 - 0';
    } else if (votes2 === 3) {
      consensusWinner = 2;
      decisionType = 'UNANIMOUS';
      decisionTally = '3 - 0';
    } else if (votes1 === 2 && votes2 === 1) {
      consensusWinner = 1;
      decisionType = 'SPLIT';
      decisionTally = '2 - 1';
    } else if (votes2 === 2 && votes1 === 1) {
      consensusWinner = 2;
      decisionType = 'SPLIT';
      decisionTally = '2 - 1';
    } else if (votes1 === 2 && draws === 1) {
      consensusWinner = 1;
      decisionType = 'MAJORITY';
      decisionTally = '2 - 0 (1 Draw)';
    } else if (votes2 === 2 && draws === 1) {
      consensusWinner = 2;
      decisionType = 'MAJORITY';
      decisionTally = '2 - 0 (1 Draw)';
    } else if (votes1 === 1 && votes2 === 1) {
      consensusWinner = null;
      decisionType = 'DRAW';
      decisionTally = '1 - 1 (1 Draw)';
    } else {
      consensusWinner = null;
      decisionType = 'DRAW';
      decisionTally = `${votes1} - ${votes2}`;
    }

    return {
      round: r,
      judges: results,
      avgTotal1,
      avgTotal2,
      votes1,
      votes2,
      draws,
      consensusWinner,
      decisionType,
      decisionTally,
      isComplete
    };
  }

  setJudgeName(judgeId, name) {
    if (this.judgeNames[judgeId] && name) {
      this.judgeNames[judgeId] = name.trim();
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
      typeEl.textContent = consensus.decisionType + ' DECISION';
      tallyEl.textContent = consensus.decisionTally;

      badge.className = 'judge-consensus-badge';
      if (consensus.decisionType === 'UNANIMOUS') {
        badge.classList.add('unanimous');
      } else if (consensus.decisionType === 'SPLIT') {
        badge.classList.add('split');
      } else {
        badge.classList.add('draw');
      }
    }
  }

  openConsensusModal() {
    const modal = document.getElementById('consensus-modal');
    if (!modal) return;

    const consensus = this.getConsensus();
    const p1Name = document.getElementById('contestant-1-display')?.textContent || 'Contestant 1';
    const p2Name = document.getElementById('contestant-2-display')?.textContent || 'Contestant 2';

    // Populate modal body
    const bodyEl = document.getElementById('consensus-modal-body');
    if (bodyEl) {
      let cardsHtml = '';
      consensus.judges.forEach(j => {
        const jWinnerName = j.winner === 1 ? p1Name : j.winner === 2 ? p2Name : 'DRAW';
        const winColor = j.winner === 1 ? '#ff2d2d' : j.winner === 2 ? '#00e5ff' : '#ffaa00';

        cardsHtml += `
          <div class="judge-scorecard-row">
            <div class="judge-card-header">
              <span class="j-title">${j.judgeName}</span>
              <span class="j-verdict" style="color: ${winColor}">➔ ${jWinnerName}</span>
            </div>
            <div class="judge-card-scores">
              <span class="j-score p1">${p1Name}: <strong>${j.total1.toFixed(1)}</strong></span>
              <span class="j-score p2">${p2Name}: <strong>${j.total2.toFixed(1)}</strong></span>
            </div>
          </div>
        `;
      });

      bodyEl.innerHTML = `
        <div class="consensus-banner ${consensus.decisionType.toLowerCase()}">
          <span class="banner-title">${consensus.decisionType} DECISION (${consensus.decisionTally})</span>
          <span class="banner-subtitle">Consensus Winner: ${consensus.consensusWinner === 1 ? p1Name : consensus.consensusWinner === 2 ? p2Name : 'MAJORITY DRAW'}</span>
        </div>
        <div class="consensus-judges-list">
          ${cardsHtml}
        </div>
        <div class="consensus-averages">
          <div class="avg-box p1">
            <span>${p1Name} Avg</span>
            <strong>${consensus.avgTotal1}</strong>
          </div>
          <div class="avg-box p2">
            <span>${p2Name} Avg</span>
            <strong>${consensus.avgTotal2}</strong>
          </div>
        </div>
      `;
    }

    modal.style.display = '';
  }

  closeConsensusModal() {
    const modal = document.getElementById('consensus-modal');
    if (modal) modal.style.display = 'none';
  }

  renderUI() {
    if (typeof document === 'undefined') return;
    // Mode Buttons
    document.querySelectorAll('.judge-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === this.mode);
    });

    const selectorGroup = document.getElementById('judge-selector-group');
    const consensusBadge = document.getElementById('judge-consensus-badge');
    const autoVaryBtn = document.getElementById('btn-auto-vary-judges');

    if (this.mode === 'panel') {
      if (selectorGroup) selectorGroup.style.display = 'flex';
      if (consensusBadge) consensusBadge.style.display = 'flex';
      if (autoVaryBtn) autoVaryBtn.style.display = 'inline-flex';

      // Judge tabs active state
      document.querySelectorAll('.judge-tab-btn').forEach(btn => {
        const jId = parseInt(btn.dataset.judge);
        btn.classList.toggle('active', jId === this.activeJudge);
      });

      this.updateConsensusBadge();
    } else {
      if (selectorGroup) selectorGroup.style.display = 'none';
      if (consensusBadge) consensusBadge.style.display = 'none';
      if (autoVaryBtn) autoVaryBtn.style.display = 'none';
    }
  }

  reset() {
    for (let j = 1; j <= this.totalJudges; j++) {
      for (let r = 1; r <= 4; r++) {
        this.judgeScores[j][r] = {
          scores1: new Array(10).fill(0),
          scores2: new Array(10).fill(0),
          total1: 0,
          total2: 0
        };
      }
    }
    this.activeJudge = 1;
    this.isDemoMode = false;
    this.renderUI();
  }
}

export { JudgeManager };
