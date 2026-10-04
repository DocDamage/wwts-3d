import { describe, it, expect, vi } from 'vitest';
import { rulesFor, resolveTie, labelOf, DEFAULT_RULES } from '../src/js/battleRules.js';
import { judgeStats } from '../src/js/judgeStats.js';
import { ChatHype } from '../src/js/chatHype.js';

describe('battle rules: tie-break chain', () => {
  it('fills in defaults and repairs an empty chain', () => {
    expect(rulesFor(null)).toEqual(DEFAULT_RULES);
    expect(rulesFor({ rules: { tieBreaks: [] } }).tieBreaks).toEqual(DEFAULT_RULES.tieBreaks);
    expect(rulesFor({ rules: { overtimeSeconds: 90 } }).overtimeSeconds).toBe(90);
  });

  it('total points decide when they differ', () => {
    const r = resolveTie({ tieBreaks: ['total', 'draw'] }, { grandTotal1: 171.5, grandTotal2: 170 });
    expect(r.winner).toBe(1);
    expect(r.method).toBe('total');
  });

  it('falls through level steps to the next one', () => {
    const rounds = { 1: { total1: 80, total2: 80, scores1: [8, 7], scores2: [7, 8] }, 2: { total1: 90, total2: 90, scores1: [9, 9], scores2: [8, 9] } };
    const r = resolveTie({ tieBreaks: ['total', 'category:Creativity', 'draw'] }, {
      grandTotal1: 170, grandTotal2: 170, rounds, categories: ['Creativity', 'Mix']
    });
    expect(r).toMatchObject({ winner: 1, method: 'category' });
  });

  it('unknown categories are skipped; audience and head judge break ties', () => {
    const ctx = { grandTotal1: 1, grandTotal2: 1, categories: ['Mix'], audience: { 1: 12, 2: 30 } };
    expect(resolveTie({ tieBreaks: ['category:Nope', 'audience'] }, ctx).winner).toBe(2);
    const askJudge = vi.fn(() => 1);
    const r = resolveTie({ tieBreaks: ['audience', 'judge'] }, { ...ctx, audience: { 1: 5, 2: 5 }, askJudge, names: { 1: 'A', 2: 'B' } });
    expect(askJudge).toHaveBeenCalledWith({ 1: 'A', 2: 'B' });
    expect(r).toMatchObject({ winner: 1, method: 'judge' });
  });

  it('ends in a draw when nothing separates them', () => {
    expect(resolveTie({ tieBreaks: ['total'] }, { grandTotal1: 5, grandTotal2: 5 }).winner).toBeNull();
    expect(resolveTie({ tieBreaks: ['draw', 'total'] }, { grandTotal1: 9, grandTotal2: 5 }).method).toBe('draw');
  });

  it('labels steps for the editor', () => {
    expect(labelOf('category:Mix')).toBe('Higher Mix score');
    expect(labelOf('audience')).toBe('Audience vote');
  });
});

describe('judge consistency stats', () => {
  // four judges: three agree closely, one is wildly off and always picks slot 1
  const battle = (i) => ({
    leagueId: 'L', contestant1Id: 'a', contestant1Name: 'Ann', contestant2Id: 'b', contestant2Name: 'Ben',
    roundResults: [{
      winner: 2,
      panel: {
        winner: 2,
        judges: [
          { name: 'Steady', scored: true, total1: 70 + i, total2: 80 + i, winner: 2 },
          { name: 'Calm', scored: true, total1: 71 + i, total2: 81 + i, winner: 2 },
          { name: 'Even', scored: true, total1: 72 + i, total2: 79 + i, winner: 2 },
          { name: 'Wild', scored: true, total1: 95, total2: 60, winner: 1 }
        ]
      }
    }]
  });
  const stats = judgeStats([0, 1, 2, 3].map(battle));
  const by = Object.fromEntries(stats.map(s => [s.name, s]));

  it('flags the outlier, not the judges who agree', () => {
    expect(by.Wild.flag).toBe('outlier');
    expect(by.Steady.flag).toBe('steady');
    expect(by.Calm.flag).toBe('steady');
    expect(by.Wild.deviation).toBeGreaterThan(by.Steady.deviation * 5);
  });

  it('measures agreement, slot bias and favourites', () => {
    expect(by.Steady.agreement).toBe(1);
    expect(by.Wild.agreement).toBe(0);
    expect(by.Wild.slot1).toBe(1);
    expect(by.Wild.likes[0].name).toBe('Ann');
    expect(by.Wild.dislikes[0].name).toBe('Ben');
  });

  it('ignores demos, other leagues and solo rounds', () => {
    expect(judgeStats([{ ...battle(0), isDemo: true }])).toEqual([]);
    expect(judgeStats([battle(0)], { leagueId: 'other' })).toEqual([]);
    const solo = battle(0);
    solo.roundResults[0].panel.judges = solo.roundResults[0].panel.judges.slice(0, 1);
    expect(judgeStats([solo])).toEqual([]);
  });

  it('needs a few rounds before judging a judge', () => {
    expect(judgeStats([battle(0)])[0].flag).toBe('few');
  });

  it('with only three judges a wild one still stands out', () => {
    const three = [0, 1, 2, 3].map(battle).map(b => {
      b.roundResults[0].panel.judges = b.roundResults[0].panel.judges.filter(j => j.name !== 'Even');
      return b;
    });
    const s3 = Object.fromEntries(judgeStats(three).map(s => [s.name, s]));
    expect(['watch', 'outlier']).toContain(s3.Wild.flag);
    expect(s3.Steady.flag).toBe('steady');
  });
});

describe('live chat votes and hype', () => {
  const make = () => {
    const onHype = vi.fn();
    const chat = new ChatHype({ onHype, getNames: () => ['Metro', 'Alchemist'] });
    chat.settings = { hype: true, votes: true };
    return { chat, onHype };
  };

  it('counts one vote per viewer and lets them change it', () => {
    const { chat } = make();
    chat.message('twitch', 'u1', '1');
    chat.message('twitch', 'u2', '2 all day');
    chat.message('twitch', 'u1', '1 again');
    expect(chat.votes).toEqual([1, 1]);
    chat.message('twitch', 'u1', 'nah 2');          // doesn't start with a number: not a vote
    chat.message('twitch', 'u1', 'alchemist cooked');  // the producer's name counts
    expect(chat.votes).toEqual([0, 2]);
  });

  it('hype words lift the crowd more than chatter', () => {
    const { chat, onHype } = make();
    chat.message('twitch', 'u1', 'ok');
    chat.message('twitch', 'u2', 'this is FIRE 🔥');
    const [quiet, hot] = onHype.mock.calls.map(c => c[0]);
    expect(hot).toBeGreaterThan(quiet);
  });
});
