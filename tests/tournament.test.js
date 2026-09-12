import { describe, it, expect } from 'vitest';
import { TournamentManager } from '../src/js/tournament.js';

describe('TournamentManager & Arbitrary Entrant Support', () => {
  const mockRoster = {
    getById: (id) => ({ id, name: `Producer_${id}` }),
    getForLeague: () => [
      { id: '1', name: 'Producer 1' },
      { id: '2', name: 'Producer 2' },
      { id: '3', name: 'Producer 3' },
      { id: '4', name: 'Producer 4' },
      { id: '5', name: 'Producer 5' }
    ]
  };
  const mockLeagues = { activeLeagueId: 'l1' };

  it('supports arbitrary 5-entrant bracket with automatic byes to size 8', () => {
    const tm = new TournamentManager(mockRoster, mockLeagues);
    const contestants = ['1', '2', '3', '4', '5'];

    const started = tm.startTournament(contestants);
    expect(started).toBe(true);
    expect(tm.bracket.totalRounds).toBe(3); // 8-bracket has 3 rounds
    expect(tm.bracket.byesCount).toBe(3); // 8 - 5 = 3 byes

    // Round 1 matches
    const r1 = tm.bracket.rounds[0];
    expect(r1.length).toBe(4);

    // Matches with null player2 are marked completed as byes
    const byeMatches = r1.filter(m => m.isBye);
    expect(byeMatches.length).toBe(3);
    byeMatches.forEach(m => {
      expect(m.completed).toBe(true);
      expect(m.winnerId).toBe(m.player1Id);
    });

    // 1 playable match in Round 1 between Contestant 4 and Contestant 5
    const playable = tm.getNextPlayableMatch();
    expect(playable).not.toBeNull();
    expect(playable.round).toBe(0);
  });

  it('advances official FinalizedBattleResult without calculating its own winner', () => {
    const tm = new TournamentManager(mockRoster, mockLeagues);
    tm.startTournament(['1', '2', '3', '4']);

    // Play round 0, match 0: '1' vs '2'
    tm.selectMatch(0, 0);
    expect(tm.isTournamentActive()).toBe(true);

    const finalResult = {
      contestant1: { id: '1' },
      contestant2: { id: '2' },
      winnerId: '2', // Official winner is '2'!
      winnerName: 'Producer 2',
      decisionMethod: 'SPLIT',
      decisionTally: '2 - 1',
      seriesSummary: { grandTotal1: 85, grandTotal2: 86, roundsWon1: 1, roundsWon2: 2 }
    };

    const recorded = tm.recordFinalizedResult(finalResult);
    expect(recorded).toBe(true);

    // Verify round 1 match now has Producer 2
    const nextMatch = tm.bracket.rounds[1][0];
    expect(nextMatch.player1Id).toBe('2');
  });
});
