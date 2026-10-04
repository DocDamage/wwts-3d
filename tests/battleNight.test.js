import { describe, it, expect } from 'vitest';
import { integratedLoudness, matchGainDb } from '../src/js/loudness.js';
import { PlayOrder } from '../src/js/playOrder.js';
import { CorrectionsLog, describeCorrection } from '../src/js/corrections.js';
import { cardStats, panelStats, scaleFor, normalizeScores } from '../src/js/calibration.js';
import { RoundManager } from '../src/js/rounds.js';
import { JudgeManager } from '../src/js/judges.js';
import { ScoringEngine } from '../src/js/scoring.js';
import { guideText, bandIndex } from '../src/js/rubrics.js';

const sine = (rate, seconds, amp, freq = 1000) => {
  const n = Math.round(rate * seconds);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
  return x;
};

describe('loudness (BS.1770)', () => {
  it('a full-scale 1 kHz sine reads about −3 LUFS (mono reference)', () => {
    const l = integratedLoudness(sine(48000, 3, 1), 48000);
    expect(l).toBeGreaterThan(-4);
    expect(l).toBeLessThan(-2);
  });

  it('halving the level drops ~6 LU, at any sample rate', () => {
    const a = integratedLoudness(sine(22050, 3, 0.5), 22050);
    const b = integratedLoudness(sine(22050, 3, 0.25), 22050);
    expect(a - b).toBeCloseTo(6.02, 0);
  });

  it('silence is gated out; the match gain is clamped', () => {
    expect(integratedLoudness(new Float32Array(48000), 48000)).toBe(-70);
    expect(matchGainDb(-20, -14)).toBe(6);
    expect(matchGainDb(-40, -14)).toBe(12);
    expect(matchGainDb(-70)).toBe(0);
  });
});

describe('play order', () => {
  it('alternates every round after the flip', () => {
    const o = new PlayOrder();
    o.flip(() => 0.9);   // slot 2 wins the flip
    expect(o.first).toBe(2);
    expect(o.orderFor(1)).toEqual([2, 1]);
    expect(o.orderFor(2)).toEqual([1, 2]);
    expect(o.orderFor(3)).toEqual([2, 1]);
    expect(o.orderFor(4)).toEqual([1, 2]);
    o.reset();
    expect(o.flipped).toBe(false);
    expect(o.orderFor(1)).toEqual([1, 2]);
  });
});

describe('corrections log', () => {
  it('pairs a relock with the open reopen and describes entries', () => {
    const c = new CorrectionsLog();
    c.add({ action: 'reopen', round: 2, reason: 'wrong producer', before: { total1: 80, total2: 70 } });
    expect(c.openReopen(2)?.reason).toBe('wrong producer');
    c.add({ action: 'relock', round: 2, before: { total1: 80, total2: 70 }, after: { total1: 80, total2: 85 } });
    expect(c.openReopen(2)).toBeNull();
    expect(describeCorrection(c.log[0], { 1: 'A', 2: 'B' })).toContain('“wrong producer”');
    expect(describeCorrection({ at: new Date().toISOString(), action: 'penalty', round: 1, slot: 2, points: 2, seconds: 14 }, { 1: 'A', 2: 'B' })).toContain('B −2.0');
  });
});

describe('judge calibration', () => {
  const harsh = [4, 5, 4, 5, 4, 5, 4, 5, 4, 5];       // centre 4.5, tight
  const generous = [8, 9, 7, 9, 8, 9, 7, 9, 8, 9];    // centre 8.3
  const wide = [2, 10, 3, 9, 2, 10, 3, 9, 2, 10];     // centre 6, very wide
  const judges = { H: cardStats(harsh), G: cardStats(generous), W: cardStats(wide) };
  const panel = panelStats(judges);

  it('measures centre and spread, and scales wide judges down', () => {
    expect(judges.H.mean).toBeCloseTo(4.5, 2);
    expect(scaleFor(judges.W, panel)).toBeLessThan(1);
    expect(scaleFor(judges.H, panel)).toBeGreaterThan(1);
  });

  it('maps a harsh and a generous judge onto the same centre', () => {
    const h = normalizeScores(harsh, judges.H, panel);
    const g = normalizeScores(generous, judges.G, panel);
    const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(Math.abs(avg(h) - avg(g))).toBeLessThan(0.05);
    expect(Math.abs(avg(h) - panel.mean)).toBeLessThan(0.05);
  });

  it('leaves judges alone without enough calibration', () => {
    expect(normalizeScores(harsh, judges.H, { mean: 5, sd: 1, count: 1 })).toBeNull();
    expect(normalizeScores(harsh, null, panel)).toBeNull();
  });
});

describe('rounds: locks, penalties, flip rounds', () => {
  const make = () => {
    const scoring = new ScoringEngine();
    const rounds = new RoundManager(scoring, null, null, null);
    scoring.setScores(1, new Array(10).fill(8));
    scoring.setScores(2, new Array(10).fill(7));
    return { scoring, rounds };
  };

  it('time penalties come off the round total and survive export/import', () => {
    const { rounds } = make();
    rounds.addPenalty(1, 1, 2, 14);
    rounds.saveCurrentRoundState();
    expect(rounds.rounds[1].total1).toBe(78);
    expect(rounds.rounds[1].rawTotal1).toBe(80);
    expect(rounds.rounds[1].penalty1).toBe(2);
    rounds.lock(1);
    rounds.setFlip(1, { name: 'Soul loop', url: '/s.mp3' });
    const saved = rounds.exportState();
    const { rounds: r2 } = make();
    r2.importState(saved);
    expect(r2.isLocked(1)).toBe(true);
    expect(r2.penaltyFor(1, 1)).toBe(2);
    expect(r2.flipFor(1).name).toBe('Soul loop');
    r2.reset();
    expect(r2.isLocked(1)).toBe(false);
    expect(r2.penaltyFor(1, 1)).toBe(0);
  });

  it('a big enough penalty flips the round', () => {
    const { rounds } = make();
    rounds.addPenalty(1, 1, 12, 110);
    rounds.saveCurrentRoundState();
    expect(rounds.roundWinner(1)).toBe(2);
  });
});

describe('judges: penalties per card, calibration normaliser, comments', () => {
  it('penalties count against every judge and can change votes', () => {
    const scoring = new ScoringEngine();
    const jm = new JudgeManager(scoring, null);
    jm.setMode('panel');
    jm.judgeScores[1][1] = { scores1: [], scores2: [], total1: 82, total2: 80 };
    jm.judgeScores[2][1] = { scores1: [], scores2: [], total1: 81, total2: 80 };
    jm.judgeScores[3][1] = { scores1: [], scores2: [], total1: 85, total2: 80 };
    expect(jm.getConsensus(1).consensusWinner).toBe(1);
    jm.penaltyProvider = () => ({ 1: 3, 2: 0 });
    const c = jm.getConsensus(1);
    expect(c.decisionTally).toBe('2 - 1');
    expect(c.consensusWinner).toBe(2);
  });

  it('remote comments ride along with the card', () => {
    const scoring = new ScoringEngine();
    const jm = new JudgeManager(scoring, null);
    jm.setMode('panel');
    jm.remote[2] = { deviceId: 'd', connected: true };
    jm.receiveRemoteScores(2, 1, new Array(10).fill(8), new Array(10).fill(7), true, { comments1: ['great flip'], overall: 'drums won it' });
    const j = jm.getConsensus(1).judges[1];
    expect(j.comments1[0]).toBe('great flip');
    expect(j.overall).toBe('drums won it');
  });

  it('applies the calibration normaliser to counted cards', () => {
    const scoring = new ScoringEngine();
    const jm = new JudgeManager(scoring, null);
    jm.setMode('panel');
    jm.setJudgeCount(2);
    jm.judgeScores[1][1] = { scores1: new Array(10).fill(9), scores2: new Array(10).fill(8), total1: 90, total2: 80 };
    jm.judgeScores[2][1] = { scores1: new Array(10).fill(6), scores2: new Array(10).fill(5), total1: 60, total2: 50 };
    jm.normalizer = (name, scores) => (name === 'Judge 2' ? scores.map(v => v + 3) : null);
    const card = jm.getPanelCard(1);
    expect(card.total1).toBe(90);
    expect(jm.getConsensus(1).judges[1].normalized).toBe(true);
  });
});

describe('scoring guides', () => {
  it('maps a value onto its band', () => {
    expect(bandIndex(3.9)).toBe(0);
    expect(bandIndex(8.5)).toBe(3);
    expect(bandIndex(10)).toBe(4);
    expect(guideText({ key: 'drums' }, 8.6)).toMatch(/^8–9: /);
    expect(guideText({ key: 'unknown' }, 5)).toBe('4–5: Below average');
  });
});
