import { describe, it, expect } from 'vitest';
import { JudgeManager } from '../src/js/judges.js';
import { ScoringEngine } from '../src/js/scoring.js';
import { JudgeRooms } from '../server/judgeHub.js';

const card = (t1, t2) => ({ scores1: new Array(10).fill(t1 / 10), scores2: new Array(10).fill(t2 / 10), total1: t1, total2: t2 });

function panel(n) {
  const scoring = new ScoringEngine();
  const jm = new JudgeManager(scoring, null);
  jm.setMode('panel');
  jm.setJudgeCount(n);
  return jm;
}

describe('Judge panel of any size', () => {
  it('5-judge 4-1 is a split decision', () => {
    const jm = panel(5);
    [card(80, 70), card(81, 70), card(82, 70), card(83, 70), card(60, 90)].forEach((c, i) => { jm.judgeScores[i + 1][1] = c; });
    const c = jm.getConsensus(1);
    expect(c.decisionType).toBe('SPLIT');
    expect(c.decisionTally).toBe('4 - 1');
    expect(c.consensusWinner).toBe(1);
  });

  it('a single judge decides on their own', () => {
    const jm = panel(1);
    jm.judgeScores[1][1] = card(70, 75);
    const c = jm.getConsensus(1);
    expect(c.decisionType).toBe('UNANIMOUS');
    expect(c.decisionTally).toBe('1 - 0');
    expect(c.consensusWinner).toBe(2);
  });

  it('2-0 with a scoring draw is a majority decision', () => {
    const jm = panel(3);
    jm.judgeScores[1][1] = card(80, 70);
    jm.judgeScores[2][1] = card(82, 70);
    jm.judgeScores[3][1] = card(75, 75);
    const c = jm.getConsensus(1);
    expect(c.decisionType).toBe('MAJORITY');
    expect(c.consensusWinner).toBe(1);
  });

  it('even split of 4 judges is a draw', () => {
    const jm = panel(4);
    [card(80, 70), card(81, 70), card(60, 70), card(61, 70)].forEach((c, i) => { jm.judgeScores[i + 1][1] = c; });
    const c = jm.getConsensus(1);
    expect(c.decisionType).toBe('DRAW');
    expect(c.consensusWinner).toBeNull();
  });

  it('phone judges only count once they submit', () => {
    const jm = panel(2);
    jm.judgeScores[1][1] = card(80, 70);
    const seat = jm.assignPhone('phone-a', 'Alchemist');
    expect(seat).toBe(2);
    jm.receiveRemoteScores(seat, 1, new Array(10).fill(9), new Array(10).fill(6), false);
    expect(jm.getConsensus(1).isComplete).toBe(false);
    jm.receiveRemoteScores(seat, 1, new Array(10).fill(9), new Array(10).fill(6), true);
    const c = jm.getConsensus(1);
    expect(c.isComplete).toBe(true);
    expect(jm.judgeScores[2][1].total1).toBe(90);
    expect(c.decisionType).toBe('UNANIMOUS');
  });

  it('reconnecting phone keeps its seat; new phones add seats up to 5', () => {
    const jm = panel(1);
    expect(jm.assignPhone('a', 'A')).toBe(2);
    expect(jm.assignPhone('b', 'B')).toBe(3);
    expect(jm.assignPhone('a', 'A')).toBe(2);
    jm.assignPhone('c', 'C');
    jm.assignPhone('d', 'D');
    expect(jm.totalJudges).toBe(5);
    expect(jm.assignPhone('e', 'E')).toBeNull();
  });

  it('panel round card averages only the judges who scored', () => {
    const jm = panel(3);
    jm.judgeScores[1][1] = card(80, 60);
    jm.judgeScores[2][1] = card(90, 70);
    const avg = jm.getPanelCard(1);
    expect(avg.total1).toBe(85);
    expect(avg.total2).toBe(65);
  });
});

describe('Judge hub rooms', () => {
  const inbox = () => {
    const msgs = [];
    const send = (m) => msgs.push(m);
    send.msgs = msgs;
    return send;
  };

  it('relays joins, state and scores between host and judges', () => {
    const rooms = new JudgeRooms();
    const host = inbox();
    expect(rooms.claimHost('abcd', 'secret', host).ok).toBe(true);

    rooms.setState('ABCD', { round: 1 });
    const judge = inbox();
    expect(rooms.joinJudge('abcd', 'dev1', '  Pete Rock ', judge).ok).toBe(true);
    expect(judge.msgs.map(m => m.t)).toEqual(['joined', 'state']);
    expect(host.msgs[0]).toEqual({ t: 'judge-join', deviceId: 'dev1', name: 'Pete Rock' });

    rooms.judgeScores('ABCD', 'dev1', { round: 2, scores1: [11, -3, 'x'], scores2: [5], submitted: 1 });
    const scoreMsg = host.msgs.find(m => m.t === 'judge-scores');
    expect(scoreMsg.scores1).toEqual([10, 0, 0]); // clamped and sanitized
    expect(scoreMsg.submitted).toBe(true);

    rooms.leave('ABCD', 'dev1');
    expect(host.msgs.at(-1)).toEqual({ t: 'judge-left', deviceId: 'dev1' });
  });

  it('only the original host token can reclaim a room', () => {
    const rooms = new JudgeRooms();
    rooms.claimHost('WXYZ', 't1', inbox());
    expect(rooms.claimHost('WXYZ', 'other', inbox()).code).toBe('room-taken');
    expect(rooms.claimHost('WXYZ', 't1', inbox()).ok).toBe(true);
  });

  it('rejects judges for rooms that are not open', () => {
    const rooms = new JudgeRooms();
    expect(rooms.joinJudge('NOPE', 'd', 'x', inbox()).code).toBe('no-room');
  });
});
