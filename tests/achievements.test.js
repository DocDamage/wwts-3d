import { describe, it, expect } from 'vitest';
import { AchievementEngine } from '../src/js/achievements.js';

globalThis.localStorage = globalThis.localStorage || {
  _s: {},
  getItem(k) { return k in this._s ? this._s[k] : null; },
  setItem(k, v) { this._s[k] = String(v); },
  removeItem(k) { delete this._s[k]; }
};

let t = 0;
function battle(winner, { r1 = [85, 80], r2 = null, method = 'TOTAL_POINTS', ratings = null, scores1 = null, notes = [], demo = false } = {}) {
  t += 1000;
  const rounds = [{ round: 1, total1: r1[0], total2: r1[1], winner: r1[0] > r1[1] ? 1 : 2, scores1: scores1 || new Array(10).fill(r1[0] / 10), scores2: new Array(10).fill(r1[1] / 10) }];
  if (r2) rounds.push({ round: 2, total1: r2[0], total2: r2[1], winner: r2[0] > r2[1] ? 1 : 2, scores1: new Array(10).fill(r2[0] / 10), scores2: new Array(10).fill(r2[1] / 10) });
  const won1 = rounds.filter(r => r.winner === 1).length;
  return {
    id: `b${t}`, timestamp: new Date(t).toISOString(), contestant1Id: 'a', contestant2Id: 'b',
    winnerId: winner, decisionMethod: method, total1: r1[0], total2: r1[1], isDemo: demo,
    seriesSummary: { roundsWon1: won1, roundsWon2: rounds.length - won1, roundsPlayed: rounds.length },
    roundResults: rounds, ratingChanges: ratings, timestampedNotes: notes
  };
}

function engineWith(battles, stats = {}) {
  const history = { history: battles, getForLeague: () => battles };
  const people = {
    a: { id: 'a', name: 'Alpha', stats: { wins: 0, totalBattles: 0, rating: 1500, ...stats.a } },
    b: { id: 'b', name: 'Bravo', stats: { wins: 0, totalBattles: 0, rating: 1500, ...stats.b } }
  };
  const roster = { getById: (id) => people[id], getForLeague: () => Object.values(people) };
  const e = new AchievementEngine(history, roster);
  e.titles = {};
  return e;
}

const badge = (e, id, key) => e.evaluate(id).find(b => b.id === key);

describe('Achievements', () => {
  it('tiers a win streak and reports progress to the next tier', () => {
    const e = engineWith([battle('a'), battle('a'), battle('a'), battle('a')], { a: { wins: 4, totalBattles: 4 } });
    const s = badge(e, 'a', 'streak');
    expect(s.tier).toBe(1);
    expect(s.tierLabel).toBe('Heating Up');
    expect(s.next).toBe(5);
    expect(badge(e, 'b', 'streak').tier).toBe(0);
  });

  it('counts perfect 10s, golden ears and blowouts from round cards', () => {
    const e = engineWith([battle('a', { r1: [92, 70], scores1: [10, 10, 9, 9, 9, 9, 9, 9, 9, 9] })], { a: { wins: 1, totalBattles: 1 } });
    expect(badge(e, 'a', 'perfect10').value).toBe(2);
    expect(badge(e, 'a', 'golden_ears').unlocked).toBe(true);
    expect(badge(e, 'a', 'blowout').unlocked).toBe(true);
  });

  it('spots comebacks and clean sweeps', () => {
    const e = engineWith([
      battle('b', { r1: [85, 80], r2: [78, 86] }),          // b lost round 1, won
      battle('a', { r1: [88, 80], r2: [87, 82] })           // a 2-0
    ]);
    expect(badge(e, 'b', 'comeback').unlocked).toBe(true);
    expect(badge(e, 'a', 'clean_sweep').unlocked).toBe(true);
    expect(badge(e, 'b', 'clean_sweep').unlocked).toBe(false);
  });

  it('awards Giant Slayer for beating a much higher rating', () => {
    const e = engineWith([battle('a', { ratings: { a: { before: 1450 }, b: { before: 1580 } } })]);
    expect(badge(e, 'a', 'giant_slayer').unlocked).toBe(true);
  });

  it('ignores demo battles', () => {
    const e = engineWith([battle('a', { demo: true })]);
    expect(badge(e, 'a', 'first_win').unlocked).toBe(false);
  });

  it('counts records carried in from before history (sample producers)', () => {
    const e = engineWith([], { a: { wins: 6, totalBattles: 8, bestStreak: 3 } });
    expect(badge(e, 'a', 'wins').tier).toBe(1);
    expect(badge(e, 'a', 'battles').tier).toBe(1);
    expect(badge(e, 'a', 'streak').tier).toBe(1);
  });

  it('diffs what the latest battle unlocked', () => {
    const bs = [battle('a'), battle('a')];
    const e = engineWith(bs, { a: { wins: 2, totalBattles: 2 } });
    expect(e.newlyUnlocked('a').map(b => b.id)).not.toContain('first_win');
    bs.push(battle('a'));
    e.roster.getById('a').stats = { wins: 3, totalBattles: 3, rating: 1500 };
    expect(e.newlyUnlocked('a').map(b => b.id)).toContain('streak');
  });

  it('builds league records and keeps tournament titles unique', () => {
    const e = engineWith([battle('a', { r1: [96, 70] }), battle('b', { r1: [80, 82] })], { a: { wins: 1 }, b: { wins: 1 } });
    const recs = e.records('x');
    expect(recs.find(r => r.label === 'Highest Round Score')).toMatchObject({ value: '96.00', holder: 'Alpha' });
    expect(e.addTitle('a', { tournamentId: 't1', name: 'Spring Cup' })).toBe(true);
    expect(e.addTitle('a', { tournamentId: 't1', name: 'Spring Cup' })).toBe(false);
    expect(badge(e, 'a', 'champion').unlocked).toBe(true);
  });
});
