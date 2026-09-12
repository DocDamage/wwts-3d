import { describe, it, expect, beforeEach } from 'vitest';
import { BattleSessionEngine } from '../src/js/battleEngine.js';
import { BattleTimer } from '../src/js/timer.js';
import { ScoringEngine } from '../src/js/scoring.js';
import { RoundManager } from '../src/js/rounds.js';
import { JudgeManager } from '../src/js/judges.js';

describe('BattleSessionEngine & Unified Official Result', () => {
  let engine;
  let scoring;
  let rounds;
  let judges;
  let timer;

  beforeEach(() => {
    scoring = new ScoringEngine();
    timer = new BattleTimer();
    rounds = new RoundManager(scoring, null, null, timer);
    judges = new JudgeManager(scoring, null);
    engine = new BattleSessionEngine({ scoring, rounds, judges, timer });
  });

  describe('Official Result Calculation', () => {
    it('calculates unanimous 3-0 decision correctly', () => {
      const context = {
        c1: { id: 'c1', name: 'Producer A' },
        c2: { id: 'c2', name: 'Producer B' },
        judgeMode: 'panel',
        judgeData: {
          votes1: 3,
          votes2: 0,
          draws: 0,
          consensusWinner: 1,
          decisionType: 'UNANIMOUS',
          decisionTally: '3 - 0',
          avgTotal1: 88.5,
          avgTotal2: 81.0,
          isComplete: true
        }
      };

      const result = engine.calculateOfficialResult(context);
      expect(result.winnerId).toBe('c1');
      expect(result.winnerName).toBe('Producer A');
      expect(result.decisionMethod).toBe('UNANIMOUS');
      expect(result.decisionTally).toBe('3 - 0');
      expect(result.winnerScore).toBe(88.5);
    });

    it('calculates split 2-1 decision correctly', () => {
      const context = {
        c1: { id: 'c1', name: 'Producer A' },
        c2: { id: 'c2', name: 'Producer B' },
        judgeMode: 'panel',
        judgeData: {
          votes1: 2,
          votes2: 1,
          draws: 0,
          consensusWinner: 1,
          decisionType: 'SPLIT',
          decisionTally: '2 - 1',
          avgTotal1: 85.0,
          avgTotal2: 83.5,
          isComplete: true
        }
      };

      const result = engine.calculateOfficialResult(context);
      expect(result.winnerId).toBe('c1');
      expect(result.decisionMethod).toBe('SPLIT');
      expect(result.decisionTally).toBe('2 - 1');
    });

    it('flags incomplete panel rather than falsely declaring 2-1', () => {
      const context = {
        c1: { id: 'c1', name: 'Producer A' },
        c2: { id: 'c2', name: 'Producer B' },
        judgeMode: 'panel',
        judgeData: {
          votes1: 2,
          votes2: 0,
          draws: 0,
          consensusWinner: null,
          decisionType: 'PENDING',
          decisionTally: '2 - 0 (2/3 Scored)',
          isComplete: false
        }
      };

      const result = engine.calculateOfficialResult(context);
      expect(result.decisionMethod).toBe('INCOMPLETE_PANEL');
      expect(result.winnerId).toBeNull();
    });

    it('detects best-of-3 2-0 clinch without requiring round 3', () => {
      const context = {
        c1: { id: 'c1', name: 'Producer A' },
        c2: { id: 'c2', name: 'Producer B' },
        seriesData: {
          roundsWon1: 2,
          roundsWon2: 0,
          grandTotal1: 175.0,
          grandTotal2: 160.0,
          totalRounds: 3,
          hasOvertime: false,
          rounds: {
            1: { total1: 88, total2: 80, completed: true },
            2: { total1: 87, total2: 80, completed: true }
          }
        }
      };

      const result = engine.calculateOfficialResult(context);
      expect(result.winnerId).toBe('c1');
      expect(result.isClinch).toBe(true);
      expect(result.decisionMethod).toBe('ROUNDS_WON');
      expect(result.decisionTally).toContain('Clinch');
    });

    it('resolves Sudden Death Overtime tiebreaker', () => {
      const context = {
        c1: { id: 'c1', name: 'Producer A' },
        c2: { id: 'c2', name: 'Producer B' },
        seriesData: {
          roundsWon1: 2,
          roundsWon2: 1,
          grandTotal1: 340.0,
          grandTotal2: 335.0,
          totalRounds: 4,
          hasOvertime: true,
          rounds: {
            1: { total1: 85, total2: 80, completed: true },
            2: { total1: 80, total2: 85, completed: true },
            3: { total1: 82, total2: 82, completed: true },
            4: { total1: 93, total2: 88, completed: true, isOvertime: true }
          }
        }
      };

      const result = engine.calculateOfficialResult(context);
      expect(result.winnerId).toBe('c1');
      expect(result.decisionMethod).toBe('SUDDEN_DEATH');
      expect(result.tiebreaker.occurred).toBe(true);
      expect(result.tiebreaker.round).toBe(4);
    });
  });

  describe('Duplicate Submission Guard (Idempotency)', () => {
    it('only finalizes once even if called repeatedly', () => {
      let historyRecords = 0;
      let tournamentRecords = 0;

      engine.history = {
        addFinalizedBattle: () => { historyRecords++; }
      };
      engine.tournament = {
        isTournamentActive: () => true,
        recordFinalizedResult: () => { tournamentRecords++; }
      };

      // 1st call
      const res1 = engine.finalizeCurrentBattle('c1', 'c2');
      expect(res1.success).toBe(true);
      expect(res1.isDuplicate).toBe(false);
      expect(historyRecords).toBe(1);
      expect(tournamentRecords).toBe(1);

      // 2nd call (repeated Enter or Submit click)
      const res2 = engine.finalizeCurrentBattle('c1', 'c2');
      expect(res2.success).toBe(true);
      expect(res2.isDuplicate).toBe(true);
      expect(res2.result).toBe(res1.result);

      // 3rd call
      const res3 = engine.finalizeCurrentBattle('c1', 'c2');
      expect(res3.isDuplicate).toBe(true);

      // Verified: never duplicated downstream!
      expect(historyRecords).toBe(1);
      expect(tournamentRecords).toBe(1);
    });
  });

  describe('Complete Battle Session Reset', () => {
    it('resets all managers together without state leakage', () => {
      // Simulate dirty state
      scoring.scores[1] = [8, 9, 7];
      rounds.currentRound = 3;
      rounds.rounds[1].total1 = 80;
      judges.activeJudge = 3;
      timer.remaining = 42;
      engine.isFinalized = true;

      // Reset complete session
      engine.resetBattleSession();

      expect(engine.isFinalized).toBe(false);
      expect(engine.phase).toBe('setup');
      expect(rounds.currentRound).toBe(1);
      expect(judges.activeJudge).toBe(1);
      expect(timer.remaining).toBe(180);
      expect(scoring.scores[1].every(s => s === null)).toBe(true);
    });
  });
});
