/**
 * BattleSessionEngine — Central Authority for Beat Battle State,
 * Unified Official Result Calculation, Duplicate Submission Prevention,
 * and Cross-Input Command Dispatching.
 *
 * All result displays, brackets, statistics, history, exports, and broadcast views
 * consume the single FinalizedBattleResult produced here.
 */

class BattleSessionEngine {
  constructor(dependencies = {}) {
    this.scoring = dependencies.scoring || null;
    this.rounds = dependencies.rounds || null;
    this.judges = dependencies.judges || null;
    this.timer = dependencies.timer || null;
    this.audio = dependencies.audio || null;
    this.notes = dependencies.notes || null;
    this.roster = dependencies.roster || null;
    this.history = dependencies.history || null;
    this.tournament = dependencies.tournament || null;
    this.leagues = dependencies.leagues || null;

    // Session workflow phases:
    // 'setup' -> 'soundcheck' -> 'play_a' -> 'review_a' -> 'play_b' -> 'review_b' -> 'round_locked' -> 'finalized'
    this.phase = 'setup';
    this.isFinalized = false;
    this.finalizedResult = null;
    this.activeContestant = 1; // 1 or 2
    this.isDemoMode = false;
    this.timestampedNotes = [];
    this.sessionId = BattleSessionEngine.newSessionId(); // changes on every reset

    this.onPhaseChange = null;
    this.onFinalize = null;
    this.onReset = null;
  }

  static newSessionId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  setDependencies(deps) {
    Object.assign(this, deps);
  }

  setDemoMode(enabled) {
    this.isDemoMode = !!enabled;
  }

  setPhase(newPhase) {
    this.phase = newPhase;
    if (typeof this.onPhaseChange === 'function') {
      this.onPhaseChange(this.phase, {
        activeContestant: this.activeContestant,
        isFinalized: this.isFinalized
      });
    }
  }

  setActiveContestant(contestantNum) {
    this.activeContestant = contestantNum === 2 ? 2 : 1;
  }

  addTimestampedNote(text, contestantNum = null, trackTime = null) {
    const note = {
      id: 'tn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      time: trackTime || (this.timer ? this.timer.getFormattedTime() : '0:00'),
      round: this.rounds ? this.rounds.currentRound : 1,
      contestant: contestantNum || this.activeContestant,
      text: text.trim(),
      timestamp: new Date().toISOString()
    };
    this.timestampedNotes.push(note);
    return note;
  }

  getTimestampedNotes() {
    return [...this.timestampedNotes];
  }

  /**
   * Pure calculation of official battle result from snapshot data.
   * Can be run on live state or imported snapshot.
   */
  calculateOfficialResult(context) {
    const {
      c1,
      c2,
      leagueId,
      judgeMode = 'solo',
      judgeData = null,
      seriesData = null,
      scoringSnapshot = null,
      scoringRules = null,
      notesText = '',
      timestampedNotes = []
    } = context;

    const contestant1 = {
      id: c1?.id || 'c1',
      name: c1?.name || 'Contestant 1',
      photo: c1?.photo || ''
    };
    const contestant2 = {
      id: c2?.id || 'c2',
      name: c2?.name || 'Contestant 2',
      photo: c2?.photo || ''
    };

    // A series only exists once more than one round has actually been scored
    const playedRounds = seriesData?.rounds
      ? Object.entries(seriesData.rounds).filter(([, d]) => d && (d.total1 > 0 || d.total2 > 0))
      : [];
    const roundsPlayed = seriesData?.roundsPlayed ?? playedRounds.length;
    const hasSeries = !!seriesData && roundsPlayed > 1;
    const avgOf = (key) => (playedRounds.length ? playedRounds.reduce((sum, [, d]) => sum + (d[key] || 0), 0) / playedRounds.length : 0);
    const avgRound1 = avgOf('total1');
    const avgRound2 = avgOf('total2');
    // Single-round battles score off that round (not whatever card is on screen)
    const singleRound = !hasSeries && playedRounds.length === 1 ? playedRounds[0][1] : null;
    const roundSnap = singleRound ? { ...scoringSnapshot, total1: singleRound.total1, total2: singleRound.total2 } : scoringSnapshot;
    const roundsWon1 = seriesData ? (seriesData.roundsWon1 || 0) : 0;
    const roundsWon2 = seriesData ? (seriesData.roundsWon2 || 0) : 0;
    const grandTotal1 = seriesData ? (seriesData.grandTotal1 || 0) : (scoringSnapshot ? scoringSnapshot.total1 : 0);
    const grandTotal2 = seriesData ? (seriesData.grandTotal2 || 0) : (scoringSnapshot ? scoringSnapshot.total2 : 0);
    const hasOvertime = !!(seriesData && seriesData.hasOvertime);

    let winnerId = null;
    let winnerName = 'DRAW';
    let winnerScore = 0;
    let decisionMethod = 'TOTAL_POINTS';
    let decisionTally = '0 - 0';
    let isClinch = false;

    // 1. Panel consensus decides a single-round battle (in a series the panel already decided each round)
    if (judgeMode === 'panel' && judgeData && !hasSeries) {
      const {
        votes1 = 0,
        votes2 = 0,
        draws = 0,
        consensusWinner = null,
        decisionType = 'DRAW',
        decisionTally: tally = '0 - 0',
        avgTotal1 = 0,
        avgTotal2 = 0,
        isComplete = true
      } = judgeData;

      decisionTally = tally;

      if (!isComplete) {
        // Panel incomplete: do not declare a 2-1 or 3-0 final consensus!
        decisionMethod = 'INCOMPLETE_PANEL';
      } else if (consensusWinner === 1) {
        winnerId = contestant1.id;
        winnerName = contestant1.name;
        winnerScore = avgTotal1;
        decisionMethod = decisionType; // 'UNANIMOUS' or 'SPLIT'
      } else if (consensusWinner === 2) {
        winnerId = contestant2.id;
        winnerName = contestant2.name;
        winnerScore = avgTotal2;
        decisionMethod = decisionType;
      } else {
        // Judge panel is tied / draw
        decisionMethod = 'DRAW';
      }
    }

    // 2. Best-of-3 Series Resolution (if not decided by Panel or if Solo mode)
    if (!winnerId && hasSeries) {
      // Check 2-0 Clinch (First to two wins)
      if (roundsWon1 >= 2 && roundsWon2 === 0) {
        winnerId = contestant1.id;
        winnerName = contestant1.name;
        winnerScore = avgRound1;
        decisionMethod = 'ROUNDS_WON';
        decisionTally = `${roundsWon1} - ${roundsWon2} (Clinch)`;
        isClinch = true;
      } else if (roundsWon2 >= 2 && roundsWon1 === 0) {
        winnerId = contestant2.id;
        winnerName = contestant2.name;
        winnerScore = avgRound2;
        decisionMethod = 'ROUNDS_WON';
        decisionTally = `${roundsWon2} - ${roundsWon1} (Clinch)`;
        isClinch = true;
      } else if (roundsWon1 > roundsWon2) {
        winnerId = contestant1.id;
        winnerName = contestant1.name;
        winnerScore = avgRound1;
        decisionMethod = hasOvertime ? 'SUDDEN_DEATH' : 'ROUNDS_WON';
        decisionTally = `${roundsWon1} - ${roundsWon2}`;
      } else if (roundsWon2 > roundsWon1) {
        winnerId = contestant2.id;
        winnerName = contestant2.name;
        winnerScore = avgRound2;
        decisionMethod = hasOvertime ? 'SUDDEN_DEATH' : 'ROUNDS_WON';
        decisionTally = `${roundsWon2} - ${roundsWon1}`;
      } else if (typeof this.tieBreaker === 'function') {
        // Tied rounds: the league's tie-break chain decides (below)
        decisionMethod = 'DRAW';
        decisionTally = `${roundsWon1} - ${roundsWon2}`;
      } else {
        // Tied rounds: Fallback to cumulative grand total
        if (grandTotal1 > grandTotal2) {
          winnerId = contestant1.id;
          winnerName = contestant1.name;
          winnerScore = avgRound1;
          decisionMethod = 'TOTAL_POINTS';
          decisionTally = `${grandTotal1.toFixed(2)} - ${grandTotal2.toFixed(2)}`;
        } else if (grandTotal2 > grandTotal1) {
          winnerId = contestant2.id;
          winnerName = contestant2.name;
          winnerScore = avgRound2;
          decisionMethod = 'TOTAL_POINTS';
          decisionTally = `${grandTotal2.toFixed(2)} - ${grandTotal1.toFixed(2)}`;
        } else {
          winnerId = null;
          winnerName = 'DRAW';
          winnerScore = avgRound1;
          decisionMethod = 'DRAW';
          decisionTally = `${grandTotal1.toFixed(2)} - ${grandTotal2.toFixed(2)}`;
        }
      }
    }

    // 3. Single Round Resolution (if neither panel nor series resolved)
    if (!winnerId && !hasSeries && roundSnap && decisionMethod !== 'INCOMPLETE_PANEL' && !(judgeMode === 'panel' && judgeData)) {
      if (roundSnap.total1 > roundSnap.total2) {
        winnerId = contestant1.id;
        winnerName = contestant1.name;
        winnerScore = roundSnap.total1;
        decisionMethod = 'TOTAL_POINTS';
        decisionTally = `${roundSnap.total1.toFixed(2)} - ${roundSnap.total2.toFixed(2)}`;
      } else if (roundSnap.total2 > roundSnap.total1) {
        winnerId = contestant2.id;
        winnerName = contestant2.name;
        winnerScore = roundSnap.total2;
        decisionMethod = 'TOTAL_POINTS';
        decisionTally = `${roundSnap.total2.toFixed(2)} - ${roundSnap.total1.toFixed(2)}`;
      } else {
        winnerId = null;
        winnerName = 'DRAW';
        winnerScore = roundSnap.total1;
        decisionMethod = 'DRAW';
        decisionTally = `${roundSnap.total1.toFixed(2)} - ${roundSnap.total2.toFixed(2)}`;
      }
    }

    // 4. Still level? The league's tie-break chain (total → category → audience → head judge → draw)
    let tieBreak = null;
    if (!winnerId && decisionMethod !== 'INCOMPLETE_PANEL' && typeof this.tieBreaker === 'function') {
      tieBreak = this.tieBreaker({ grandTotal1, grandTotal2, seriesData, scoringSnapshot, contestant1, contestant2 });
      if (tieBreak?.winner === 1 || tieBreak?.winner === 2) {
        const w = tieBreak.winner === 1 ? contestant1 : contestant2;
        winnerId = w.id;
        winnerName = w.name;
        winnerScore = tieBreak.winner === 1 ? (avgRound1 || grandTotal1) : (avgRound2 || grandTotal2);
        decisionMethod = 'TIEBREAK';
        decisionTally = tieBreak.label;
      } else {
        decisionMethod = 'DRAW';
      }
    }

    // Build normalized round results
    const roundResults = [];
    if (seriesData && seriesData.rounds) {
      Object.keys(seriesData.rounds).forEach(rKey => {
        const rNum = parseInt(rKey);
        const rData = seriesData.rounds[rKey];
        if (rData && (rData.total1 > 0 || rData.total2 > 0 || rData.completed)) {
          let rWinner = 'draw';
          if (rData.total1 > rData.total2) rWinner = 1;
          else if (rData.total2 > rData.total1) rWinner = 2;

          const rr = {
            round: rNum,
            isOvertime: !!rData.isOvertime,
            total1: rData.total1 || 0,
            total2: rData.total2 || 0,
            winner: rWinner,
            scores1: [...(rData.scores1 || [])],
            scores2: [...(rData.scores2 || [])]
          };
          if (rData.isFlip) rr.isFlip = true;
          if (rData.comments1 || rData.comments2) {
            rr.comments1 = [...(rData.comments1 || [])];
            rr.comments2 = [...(rData.comments2 || [])];
          }
          if (rData.penalty1 || rData.penalty2) {
            rr.penalty1 = rData.penalty1 || 0;
            rr.penalty2 = rData.penalty2 || 0;
          }
          roundResults.push(rr);
        }
      });
    } else if (scoringSnapshot) {
      roundResults.push({
        round: 1,
        isOvertime: false,
        total1: scoringSnapshot.total1 || 0,
        total2: scoringSnapshot.total2 || 0,
        winner: scoringSnapshot.total1 > scoringSnapshot.total2 ? 1 : (scoringSnapshot.total2 > scoringSnapshot.total1 ? 2 : 'draw'),
        scores1: [...(scoringSnapshot.scores1 || [])],
        scores2: [...(scoringSnapshot.scores2 || [])]
      });
    }

    return {
      id: 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      timestamp: new Date().toISOString(),
      leagueId: leagueId || null,
      contestant1,
      contestant2,
      winnerId,
      winnerName,
      winnerScore: parseFloat(winnerScore.toFixed(2)),
      decisionMethod,
      decisionTally,
      isClinch,
      isDemo: !!context.isDemo,
      seriesSummary: {
        hasSeries,
        roundsWon1,
        roundsWon2,
        grandTotal1: parseFloat(grandTotal1.toFixed(2)),
        grandTotal2: parseFloat(grandTotal2.toFixed(2)),
        avgRound1: parseFloat(avgRound1.toFixed(2)),
        avgRound2: parseFloat(avgRound2.toFixed(2)),
        roundsPlayed,
        totalRounds: seriesData ? seriesData.totalRounds : 1,
        hasOvertime,
        format: hasSeries ? 'best_of_3' : 'single_round'
      },
      roundResults,
      judgeScorecards: judgeData?.judgeCards || [],
      scoringRules: scoringRules || {
        preset: 'classic10',
        normalized: true,
        step: 0.1
      },
      tiebreaker: {
        occurred: hasOvertime || !!tieBreak,
        round: hasOvertime ? 4 : null,
        winnerId: hasOvertime || tieBreak?.winner ? winnerId : null,
        method: tieBreak?.method || (hasOvertime ? 'overtime' : null),
        label: tieBreak?.label || null
      },
      notes: notesText || '',
      timestampedNotes: timestampedNotes || []
    };
  }

  /**
   * Finalize the current active battle.
   * GUARANTEED IDEMPOTENT: runs exactly once per battle.
   * Duplicate calls return the existing finalized result.
   */
  finalizeCurrentBattle(c1Id, c2Id) {
    if (this.isFinalized && this.finalizedResult) {
      console.warn('BattleSessionEngine: Battle already finalized. Ignoring duplicate submission.');
      return {
        success: true,
        isDuplicate: true,
        result: this.finalizedResult
      };
    }

    if (!c1Id || !c2Id) {
      return {
        success: false,
        error: 'Missing contestants'
      };
    }

    const c1 = this.roster?.getById(c1Id) || { id: c1Id, name: 'Contestant 1' };
    const c2 = this.roster?.getById(c2Id) || { id: c2Id, name: 'Contestant 2' };

    // Freeze scoring and timers
    if (this.scoring) this.scoring.lock();
    if (this.audio) this.audio.pauseAll();
    if (this.timer) this.timer.stop();

    // Gather snapshots
    const scoringSnap = this.scoring ? this.scoring.getSnapshot() : null;
    const seriesData = this.rounds ? this.rounds.getSeriesSummary() : null;
    const panelMode = !!(this.judges && this.judges.mode === 'panel');
    const scoredRounds = seriesData?.rounds
      ? Object.keys(seriesData.rounds).map(Number).filter(r => seriesData.rounds[r].total1 > 0 || seriesData.rounds[r].total2 > 0)
      : [];
    const judgeData = panelMode ? this.judges.getConsensus(scoredRounds.length ? scoredRounds[scoredRounds.length - 1] : undefined) : null;
    const scoringRules = this.scoring?.getRulesSnapshot ? this.scoring.getRulesSnapshot() : null;
    const notesText = this.notes ? this.notes.getCurrentNote() : '';

    const officialResult = this.calculateOfficialResult({
      c1,
      c2,
      leagueId: this.leagues?.activeLeagueId,
      judgeMode: this.judges?.mode || 'solo',
      judgeData,
      seriesData,
      scoringSnapshot: scoringSnap,
      scoringRules,
      notesText,
      timestampedNotes: this.timestampedNotes,
      isDemo: this.isDemoMode
    });

    // Keep every judge's card per round with the official result
    if (panelMode) {
      officialResult.roundResults.forEach(rr => {
        const c = this.judges.getConsensus(rr.round);
        rr.panel = {
          decisionType: c.decisionType,
          decisionTally: c.decisionTally,
          winner: c.consensusWinner,
          judges: c.judges.map(j => {
            const out = { name: j.judgeName, total1: j.total1, total2: j.total2, winner: j.winner, scored: j.scored, phone: j.remote };
            if (j.comments1?.some(Boolean) || j.comments2?.some(Boolean)) { out.comments1 = j.comments1; out.comments2 = j.comments2; }
            if (j.overall) out.overall = j.overall;
            if (j.normalized) out.normalized = true;
            return out;
          })
        };
      });
    }

    // The battle's timeline (for replays)
    if (typeof this.timelineProvider === 'function') {
      try { officialResult.timeline = this.timelineProvider() || null; } catch { officialResult.timeline = null; }
    }
    // Anything else the app wants kept with the record (corrections log, season, order, judge comments…)
    if (typeof this.extrasProvider === 'function') {
      try { Object.assign(officialResult, this.extrasProvider(officialResult) || {}); } catch (e) { console.warn('extras', e); }
    }

    // Mark finalized
    this.isFinalized = true;
    this.finalizedResult = officialResult;
    this.setPhase('finalized');

    // Feed the single official result into all downstream consumers:
    // 1. Roster stats + ratings first (official matches only) so history keeps the rating swing
    if (this.roster && !this.isDemoMode) {
      officialResult.ratingChanges = this.roster.recordFinalizedBattle(officialResult) || null;
    }

    // 2. History (demo battles are flagged there)
    if (this.history) {
      this.history.addFinalizedBattle(officialResult);
    }

    // 3. Tournament match advancement
    if (this.tournament && this.tournament.isTournamentActive()) {
      this.tournament.recordFinalizedResult(officialResult);
    }

    if (typeof this.onFinalize === 'function') {
      this.onFinalize(officialResult);
    }

    return {
      success: true,
      isDuplicate: false,
      result: officialResult
    };
  }

  /**
   * Complete, coordinated battle session reset.
   * Ensures no previous match state carries forward.
   */
  resetBattleSession() {
    this.sessionId = BattleSessionEngine.newSessionId();
    this.isFinalized = false;
    this.finalizedResult = null;
    this.timestampedNotes = [];
    this.setPhase('setup');

    if (this.scoring) this.scoring.reset();
    if (this.rounds) this.rounds.reset();
    if (this.judges) this.judges.reset();
    if (this.timer) {
      this.timer.stop();
      this.timer.reset(this.roundSeconds || 180);
    }
    if (this.audio) this.audio.pauseAll();
    if (this.notes) this.notes.clear();

    // Clear winner visual styles
    if (typeof document !== 'undefined') {
      document.querySelectorAll('.winner-glow').forEach(el => el.classList.remove('winner-glow'));
    }

    if (typeof this.onReset === 'function') {
      this.onReset();
    }
  }
}

export { BattleSessionEngine };
