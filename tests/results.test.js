import { describe, it, expect, beforeEach } from 'vitest';
import { eloUpdate, RosterManager } from '../src/js/roster.js';
import { RoundManager } from '../src/js/rounds.js';
import { ScoringEngine } from '../src/js/scoring.js';
import { BattleSessionEngine } from '../src/js/battleEngine.js';

// Minimal localStorage for the roster in node
const store = {};
globalThis.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};

function rosterWith(...names) {
  const leagueManager = { addContestant() {}, getActive: () => null };
  const r = new RosterManager(leagueManager);
  r.contestants = names.map((name, i) => ({
    id: `p${i}`, name, stats: { wins: 0, losses: 0, draws: 0, totalBattles: 0, avgScore: 0, totalScoreSum: 0, rating: 1500, scale100: true }
  }));
  r.getForLeague = () => r.contestants;
  return r;
}

const result = (winnerId, avg1 = 85, avg2 = 80) => ({
  contestant1: { id: 'p0' }, contestant2: { id: 'p1' }, winnerId,
  seriesSummary: { avgRound1: avg1, avgRound2: avg2 },
  roundResults: [{ round: 1, total1: avg1, total2: avg2, scores1: new Array(10).fill(avg1 / 10), scores2: new Array(10).fill(avg2 / 10) }]
});

describe('Ratings & records', () => {
  it('Elo: equal ratings swing 16 points, upsets swing more', () => {
    expect(eloUpdate(1500, 1500, 1)).toEqual({ newA: 1516, newB: 1484 });
    const upset = eloUpdate(1400, 1600, 1);
    expect(upset.newA - 1400).toBeGreaterThan(16);
    expect(eloUpdate(1500, 1500, 0.5)).toEqual({ newA: 1500, newB: 1500 });
  });

  it('records wins, losses and draws (a draw is not a loss)', () => {
    const r = rosterWith('A', 'B');
    const changes = r.recordFinalizedBattle(result('p0'));
    expect(r.contestants[0].stats.wins).toBe(1);
    expect(r.contestants[1].stats.losses).toBe(1);
    expect(changes.p0.change).toBe(16);
    expect(r.contestants[0].stats.avgScore).toBe(85);

    r.recordFinalizedBattle(result(null, 80, 80));
    expect(r.contestants[0].stats.draws).toBe(1);
    expect(r.contestants[1].stats.losses).toBe(1);
    expect(r.contestants[0].stats.streak).toBe(0);
  });

  it('standings sort by wins, then win rate, then rating', () => {
    const r = rosterWith('A', 'B', 'C');
    Object.assign(r.contestants[0].stats, { wins: 2, losses: 2, totalBattles: 4, rating: 1510 });
    Object.assign(r.contestants[1].stats, { wins: 2, losses: 0, totalBattles: 2, rating: 1530 });
    Object.assign(r.contestants[2].stats, { wins: 3, losses: 3, totalBattles: 6, rating: 1490 });
    const table = r.getStandings('x');
    expect(table.map(t => t.name)).toEqual(['C', 'B', 'A']);
    expect(table[0].rank).toBe(1);
  });
});

describe('Rounds decided by the panel vote', () => {
  it('a split panel can take a round even when the losing side has the higher average', () => {
    const scoring = new ScoringEngine();
    const rounds = new RoundManager(scoring, null, null, null);
    rounds.rounds[1] = { scores1: [], scores2: [], total1: 80, total2: 82, completed: true };
    rounds.rounds[2] = { scores1: [], scores2: [], total1: 88, total2: 80, completed: true };
    rounds.saveCurrentRoundState = () => {};
    rounds.winnerProvider = (r) => (r === 1 ? 1 : undefined); // judges voted C1 in round 1
    const s = rounds.getSeriesSummary();
    expect(s.roundsWon1).toBe(2);
    expect(s.roundsPlayed).toBe(2);
    expect(rounds.isSeriesClinched()).toBe(true);
  });

  it('three drawn rounds count as a tied series (overtime)', () => {
    const rounds = new RoundManager(new ScoringEngine(), null, null, null);
    [1, 2, 3].forEach(r => { rounds.rounds[r] = { scores1: [], scores2: [], total1: 80, total2: 80, completed: true }; });
    rounds.saveCurrentRoundState = () => {};
    expect(rounds.isSeriesTied()).toBe(true);
  });
});

describe('Official result scores', () => {
  let engine;
  beforeEach(() => { engine = new BattleSessionEngine({}); });

  it('series winner score is the average round score, not the sum', () => {
    const res = engine.calculateOfficialResult({
      c1: { id: 'a', name: 'A' }, c2: { id: 'b', name: 'B' },
      seriesData: {
        roundsWon1: 2, roundsWon2: 0, grandTotal1: 170, grandTotal2: 160, totalRounds: 3,
        rounds: { 1: { total1: 86, total2: 80 }, 2: { total1: 84, total2: 80 } }
      }
    });
    expect(res.winnerScore).toBe(85);
    expect(res.seriesSummary.avgRound1).toBe(85);
  });

  it('a single scored round is judged on that round, not the sliders on screen', () => {
    const res = engine.calculateOfficialResult({
      c1: { id: 'a', name: 'A' }, c2: { id: 'b', name: 'B' },
      scoringSnapshot: { total1: 0, total2: 0, scores1: [], scores2: [] },
      seriesData: { roundsWon1: 0, roundsWon2: 1, totalRounds: 3, rounds: { 1: { total1: 70, total2: 77 }, 2: { total1: 0, total2: 0 } } }
    });
    expect(res.winnerId).toBe('b');
    expect(res.decisionMethod).toBe('TOTAL_POINTS');
    expect(res.winnerScore).toBe(77);
  });
});
