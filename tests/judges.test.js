import { describe, it, expect } from 'vitest';
import { JudgeManager } from '../src/js/judges.js';
import { ScoringEngine } from '../src/js/scoring.js';

describe('JudgeManager & Accurate Consensus Logic', () => {
  it('correctly labels complete unanimous 3-0 panel', () => {
    const scoring = new ScoringEngine();
    const jm = new JudgeManager(scoring, null);
    jm.setMode('panel');

    // Simulate scores for all 3 judges in Round 1
    jm.judgeScores[1][1] = { total1: 85, total2: 80 };
    jm.judgeScores[2][1] = { total1: 88, total2: 81 };
    jm.judgeScores[3][1] = { total1: 90, total2: 82 };

    const consensus = jm.getConsensus(1);
    expect(consensus.isComplete).toBe(true);
    expect(consensus.decisionType).toBe('UNANIMOUS');
    expect(consensus.decisionTally).toBe('3 - 0');
    expect(consensus.consensusWinner).toBe(1);
  });

  it('correctly labels complete split 2-1 decision', () => {
    const scoring = new ScoringEngine();
    const jm = new JudgeManager(scoring, null);
    jm.setMode('panel');

    // Judges 1 & 2 vote for C1, Judge 3 votes for C2
    jm.judgeScores[1][1] = { total1: 85, total2: 80 };
    jm.judgeScores[2][1] = { total1: 86, total2: 82 };
    jm.judgeScores[3][1] = { total1: 80, total2: 89 };

    const consensus = jm.getConsensus(1);
    expect(consensus.isComplete).toBe(true);
    expect(consensus.decisionType).toBe('SPLIT');
    expect(consensus.decisionTally).toBe('2 - 1');
    expect(consensus.consensusWinner).toBe(1);
  });

  it('flags incomplete panel as PENDING when a judge has not scored yet', () => {
    const scoring = new ScoringEngine();
    const jm = new JudgeManager(scoring, null);
    jm.setMode('panel');

    // Judges 1 & 2 scored, but Judge 3 has not scored
    jm.judgeScores[1][1] = { total1: 85, total2: 80 };
    jm.judgeScores[2][1] = { total1: 86, total2: 80 };
    jm.judgeScores[3][1] = { total1: 0, total2: 0 }; // Not scored!

    const consensus = jm.getConsensus(1);
    expect(consensus.isComplete).toBe(false);
    expect(consensus.decisionType).toBe('PENDING');
    expect(consensus.consensusWinner).toBeNull();
    expect(consensus.decisionTally).toContain('2/3 Scored');
  });

  it('isolates Auto-Vary in Demo Mode', () => {
    const scoring = new ScoringEngine();
    const jm = new JudgeManager(scoring, null);
    expect(jm.isDemoMode).toBe(false);

    jm.judgeScores[1][1] = {
      scores1: [8, 8, 8, 8, 8, 8, 8, 8, 8, 8],
      scores2: [7, 7, 7, 7, 7, 7, 7, 7, 7, 7],
      total1: 80,
      total2: 70
    };

    jm.autoVaryJudges();
    expect(jm.isDemoMode).toBe(true);
  });
});
