import { describe, it, expect } from 'vitest';
import {
  TournamentManager, standardSeedOrder, seedEntrants, createTournament, applyResult,
  roundRobinTable, playableMatches, BYE
} from '../src/js/tournament.js';

const entrants = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, seed: i + 1, rating: 1600 - i * 20 }));
const result = (m, winnerId, s1 = 85, s2 = 80) => ({
  id: `battle-${m.id}`,
  contestant1: { id: m.p1 },
  contestant2: { id: m.p2 },
  winnerId,
  decisionMethod: winnerId ? 'TOTAL_POINTS' : 'DRAW',
  seriesSummary: { avgRound1: s1, avgRound2: s2, roundsWon1: winnerId === m.p1 ? 1 : 0, roundsWon2: winnerId === m.p2 ? 1 : 0 }
});

/** Play every playable match with `pick` choosing the winner; returns battles played */
function playOut(t, pick) {
  let played = 0;
  for (let guard = 0; guard < 200; guard++) {
    const m = playableMatches(t)[0];
    if (!m) break;
    const w = pick(m);
    applyResult(t, m.id, result(m, w, w === m.p1 ? 88 : 80, w === m.p1 ? 80 : 88));
    played++;
  }
  return played;
}
const seedOf = (t, id) => t.entrants.find(e => e.id === id).seed;
const higherSeed = (t) => (m) => (seedOf(t, m.p1) < seedOf(t, m.p2) ? m.p1 : m.p2);

function lossesBy(t) {
  const losses = {};
  t.matches.filter(m => m.completed && !m.isBye && !m.skipped && m.loserId).forEach(m => { losses[m.loserId] = (losses[m.loserId] || 0) + 1; });
  return losses;
}

describe('Seeding', () => {
  it('uses standard bracket placement so 1 and 2 are in opposite halves', () => {
    expect(standardSeedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    const o16 = standardSeedOrder(16);
    expect(o16.slice(0, 2)).toEqual([1, 16]);
    expect(o16.indexOf(2)).toBeGreaterThanOrEqual(8);
  });

  it('seeds rated producers by rating (avg breaks ties), unrated last', () => {
    const list = seedEntrants([
      { id: 'a', stats: { rating: 1500, avgScore: 80, totalBattles: 3 } },
      { id: 'b', stats: { rating: 1600, avgScore: 70, totalBattles: 3 } },
      { id: 'c', stats: { rating: 1500, avgScore: 90, totalBattles: 3 } },
      { id: 'new', stats: { totalBattles: 0 } }
    ], () => 0.5);
    expect(list.map(e => e.id)).toEqual(['b', 'c', 'a', 'new']);
    expect(list[3].unrated).toBe(true);
  });
});

describe('Single elimination', () => {
  it('gives byes to the top seeds and crowns the favourite when seeds hold', () => {
    const t = createTournament({ name: 'T', format: 'single', entrants: entrants(5) });
    const byes = t.matches.filter(m => m.isBye).map(m => m.winnerId);
    expect(byes.sort()).toEqual(['p1', 'p2', 'p3']);
    const played = playOut(t, higherSeed(t));
    expect(played).toBe(4); // n - 1 real battles
    expect(t.championId).toBe('p1');
    const final = t.matches.find(m => m.id === 'W3-0');
    expect([final.p1, final.p2].sort()).toEqual(['p1', 'p2']);
  });

  it('advances the higher average on a draw, then the higher seed', () => {
    const t = createTournament({ name: 'T', format: 'single', entrants: entrants(2) });
    const m = playableMatches(t)[0];
    applyResult(t, m.id, result(m, null, 84, 84));
    expect(m.winnerId).toBe('p1');
    expect(m.advancedOnSeed).toBe(true);
  });

  it('records the result the right way round if the battle loaded players swapped', () => {
    const t = createTournament({ name: 'T', format: 'single', entrants: entrants(2) });
    const m = playableMatches(t)[0];
    applyResult(t, m.id, { contestant1: { id: m.p2 }, contestant2: { id: m.p1 }, winnerId: m.p2, seriesSummary: { avgRound1: 90, avgRound2: 70 } });
    expect(m.score1).toBe(70);
    expect(m.score2).toBe(90);
  });
});

describe('Double elimination', () => {
  it('runs a 4-producer bracket; nobody but the champion has two losses only at the end', () => {
    const t = createTournament({ name: 'T', format: 'double', entrants: entrants(4) });
    const played = playOut(t, higherSeed(t));
    expect(t.championId).toBe('p1');
    expect(played).toBe(6); // seed 1 never loses → no bracket reset
    const losses = lossesBy(t);
    expect(losses.p1 || 0).toBe(0);
    ['p2', 'p3', 'p4'].forEach(p => expect(losses[p]).toBe(2));
  });

  it('plays the grand-final reset when the losers-bracket champion wins', () => {
    const t = createTournament({ name: 'T', format: 'double', entrants: entrants(4) });
    // p4 loses early, then wins everything
    playOut(t, (m) => {
      if (m.id === 'W1-0') return 'p1';
      if (m.p1 === 'p4' || m.p2 === 'p4') return 'p4';
      return higherSeed(t)(m);
    });
    const gf2 = t.matches.find(m => m.id === 'GF-2');
    expect(gf2.skipped).toBeFalsy();
    expect(t.championId).toBe('p4');
  });

  it('completes with byes and random results without getting stuck', () => {
    for (const n of [3, 5, 6, 7, 9, 12]) {
      let seedRng = n * 7;
      const rng = () => ((seedRng = (seedRng * 9301 + 49297) % 233280) / 233280);
      const t = createTournament({ name: 'T', format: 'double', entrants: entrants(n) });
      playOut(t, (m) => (rng() < 0.5 ? m.p1 : m.p2));
      expect(t.championId, `n=${n}`).toBeTruthy();
      expect(playableMatches(t)).toHaveLength(0);
      const losses = lossesBy(t);
      Object.entries(losses).forEach(([id, l]) => {
        expect(l, `${id} n=${n}`).toBeLessThanOrEqual(2);
      });
      expect(t.entrants.filter(e => e.id !== t.championId).every(e => losses[e.id] === 2), `n=${n}`).toBe(true);
    }
  });
});

describe('Round robin', () => {
  it('schedules every pairing once and ranks by points', () => {
    const t = createTournament({ name: 'T', format: 'roundrobin', entrants: entrants(5) });
    const real = t.matches.filter(m => m.bracket === 'RR');
    expect(real).toHaveLength(10);
    const pairs = new Set(real.map(m => [m.src1.seed, m.src2.seed].sort().join('-')));
    expect(pairs.size).toBe(10);
    playOut(t, higherSeed(t));
    const table = roundRobinTable(t);
    expect(table[0].id).toBe('p1');
    expect(table[0].points).toBe(4);
    expect(t.championId).toBe('p1');
  });

  it('adds a top-two final when asked', () => {
    const t = createTournament({ name: 'T', format: 'roundrobin', entrants: entrants(4), rrFinal: true });
    playOut(t, higherSeed(t));
    const fin = t.matches.find(m => m.id === 'F-1');
    expect([fin.p1, fin.p2].sort()).toEqual(['p1', 'p2']);
    expect(t.championId).toBe('p1');
  });

  it('counts draws as half a point', () => {
    const t = createTournament({ name: 'T', format: 'roundrobin', entrants: entrants(2) });
    const m = playableMatches(t)[0];
    applyResult(t, m.id, result(m, null, 80, 80));
    expect(roundRobinTable(t).map(r => r.points)).toEqual([0.5, 0.5]);
  });
});

describe('Tournament manager', () => {
  it('only records the battle that matches the loaded match', () => {
    const roster = { getById: (id) => ({ id, name: id, stats: { totalBattles: 1, rating: 1500 } }), getForLeague: () => [] };
    const tm = new TournamentManager(roster, null);
    tm.start({ name: 'Cup', format: 'single', entrants: entrants(2) });
    const next = tm.getNextPlayableMatch();
    expect(tm.selectMatch(next.matchId)).toBe(true);
    expect(tm.isTournamentActive()).toBe(true);
    expect(tm.recordFinalizedResult({ contestant1: { id: 'x' }, contestant2: { id: 'y' }, winnerId: 'x' })).toBe(false);
    expect(tm.recordFinalizedResult(result({ id: next.matchId, p1: next.player1Id, p2: next.player2Id }, next.player1Id))).toBe(true);
    expect(tm.isTournamentComplete()).toBe(true);
    expect(tm.bracket.championId).toBe(next.player1Id);
    expect(BYE).toBe('BYE');
  });
});
