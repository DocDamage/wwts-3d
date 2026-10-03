import { describe, it, expect } from 'vitest';
import {
  TournamentManager, standardSeedOrder, seedEntrants, createTournament, applyResult,
  roundRobinTable, playableMatches, BYE, editSwap, editPlace, editAdd, editRemove
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

describe('Bracket editing', () => {
  const slotOfPlayer = (t, id) => {
    const m = t.matches.find(x => !x.completed && (x.p1 === id || x.p2 === id));
    return { matchId: m.id, side: m.p1 === id ? 1 : 2 };
  };

  it('swaps two first-round producers by swapping their seeds', () => {
    const t = createTournament({ name: 'T', format: 'single', entrants: entrants(4) });
    expect(editSwap(t, slotOfPlayer(t, 'p4'), slotOfPlayer(t, 'p3')).ok).toBe(true);
    const m = t.matches.find(x => x.id === 'W1-0');
    expect([m.p1, m.p2].sort()).toEqual(['p1', 'p3']);
  });

  it('moves a producer into a bye slot', () => {
    const t = createTournament({ name: 'T', format: 'single', entrants: entrants(3) }); // seed 4 is a bye vs p1
    const byeSlot = { matchId: 'W1-0', side: 2 };
    expect(editSwap(t, slotOfPlayer(t, 'p3'), byeSlot).ok).toBe(true);
    const w10 = t.matches.find(x => x.id === 'W1-0');
    expect([w10.p1, w10.p2].sort()).toEqual(['p1', 'p3']);
    const w11 = t.matches.find(x => x.id === 'W1-1');
    expect(w11.isBye).toBe(true);
  });

  it('fills a bye from the bench and substitutes a producer who has not battled', () => {
    const t = createTournament({ name: 'T', format: 'single', entrants: entrants(3) });
    expect(editPlace(t, { matchId: 'W1-0', side: 2 }, 'newbie').ok).toBe(true);
    expect(t.entrants).toHaveLength(4);
    expect(playableMatches(t)).toHaveLength(2);
    expect(editPlace(t, slotOfPlayer(t, 'p2'), 'sub').ok).toBe(true);
    expect(t.entrants.map(e => e.id)).toContain('sub');
    expect(editPlace(t, slotOfPlayer(t, 'sub'), 'p1').code).toBe('already-in');
  });

  it('refuses edits that would undo a played battle', () => {
    const t = createTournament({ name: 'T', format: 'single', entrants: entrants(4) });
    const m = t.matches.find(x => x.id === 'W1-0');
    applyResult(t, m.id, result(m, 'p1'));
    expect(editRemove(t, 'p4').code).toBe('has-results');
    expect(editSwap(t, { matchId: 'W1-0', side: 2 }, slotOfPlayer(t, 'p3')).code).toBe('locked');
    // Swapping the two unplayed producers is fine, and the played result survives the rebuild
    expect(editSwap(t, slotOfPlayer(t, 'p2'), slotOfPlayer(t, 'p3')).ok).toBe(true);
    expect(t.matches.find(x => x.id === 'W1-0').winnerId).toBe('p1');
    expect(t.results).toHaveLength(1);
  });

  it('swaps players in later rounds with manual placements', () => {
    const t = createTournament({ name: 'T', format: 'double', entrants: entrants(4) });
    ['W1-0', 'W1-1'].forEach(id => { const m = t.matches.find(x => x.id === id); applyResult(t, id, result(m, m.p1)); });
    const before = t.matches.find(x => x.id === 'W2-0');
    expect([before.p1, before.p2].sort()).toEqual(['p1', 'p2']);
    const loserSlot = slotOfPlayer(t, 'p4'); // losers bracket
    expect(editSwap(t, { matchId: 'W2-0', side: 2 }, loserSlot).ok).toBe(true);
    const w2 = t.matches.find(x => x.id === 'W2-0');
    expect([w2.p1, w2.p2].sort()).toEqual(['p1', 'p4']);
  });

  it('adds and removes producers, resizing the bracket and closing seeds', () => {
    const t = createTournament({ name: 'T', format: 'single', entrants: entrants(4) });
    expect(editAdd(t, 'late').ok).toBe(true);
    expect(t.meta.size).toBe(8);
    expect(editRemove(t, 'p2').ok).toBe(true);
    expect(t.meta.size).toBe(4);
    expect(t.entrants.map(e => e.seed).sort()).toEqual([1, 2, 3, 4]);
    const two = createTournament({ name: 'T', format: 'single', entrants: entrants(2) });
    expect(editRemove(two, 'p1').code).toBe('too-few');
  });

  it('round robin substitutes and re-schedules on add', () => {
    const t = createTournament({ name: 'T', format: 'roundrobin', entrants: entrants(3) });
    expect(editAdd(t, 'p9').ok).toBe(true);
    expect(t.matches.filter(m => m.bracket === 'RR')).toHaveLength(6);
  });
});
