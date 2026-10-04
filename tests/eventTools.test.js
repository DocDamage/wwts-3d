import { describe, it, expect, beforeEach } from 'vitest';
import { RunOfShow, fmtDelay } from '../src/js/runOfShow.js';
import { assignStatuses, drawPairs } from '../src/js/signups.js';
import { rankCypher, pairwiseElo } from '../src/js/cypher.js';
import { seasonStandings } from '../src/js/seasons.js';
import { computeLeagueStats, radarSvg } from '../src/js/leagueStats.js';
import { parseCsv, rosterFromCsv, historyToCsv, filterHistory, toCsv } from '../src/js/dataIO.js';
import { buildPublicData, renderPublicPage } from '../src/js/publicPage.js';
import { JudgeRooms } from '../server/judgeHub.js';

// Node test env: a tiny localStorage
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};

const inbox = () => {
  const msgs = [];
  const send = (m) => msgs.push(m);
  send.msgs = msgs;
  return send;
};

describe('run of show', () => {
  beforeEach(() => { Object.keys(store).forEach(k => delete store[k]); });

  it('plans start times and tracks behind / ahead', () => {
    const r = new RunOfShow();
    const t0 = Date.UTC(2026, 9, 4, 20, 0);
    r.data.startAt = t0;
    r.add({ c1Id: 'a', c2Id: 'b', c1Name: 'A', c2Name: 'B', est: 10 });
    r.add({ c1Id: 'c', c2Id: 'd', c1Name: 'C', c2Name: 'D', est: 15 });
    expect(r.plan()).toEqual([t0, t0 + 600000]);
    // waiting for the first battle 4 minutes after the start
    expect(r.delayMinutes(t0 + 4 * 60000)).toBe(4);
    // first battle starts 5 late and runs 3 over
    r.setLive(r.items[0].id, t0 + 5 * 60000);
    expect(r.delayMinutes(t0 + 18 * 60000)).toBe(8);
    r.complete({ c1Id: 'b', c2Id: 'a', winnerId: 'a', winnerName: 'A' }, t0 + 18 * 60000);
    expect(r.items[0].status).toBe('done');
    expect(r.next().c1Name).toBe('C');
    expect(fmtDelay(8)).toBe('8 min behind');
    expect(fmtDelay(-3)).toBe('3 min ahead');
    expect(fmtDelay(1)).toBe('on time');
  });

  it('King of the Hill: winner stays on, defenses count, a new king resets', () => {
    const r = new RunOfShow();
    r.setMode('koth');
    const name = (id) => id.toUpperCase();
    r.complete({ c1Id: 'a', c2Id: 'b', winnerId: 'a', winnerName: 'A' });
    expect(r.data.koth.kingId).toBe('a');
    ['c', 'd'].forEach(id => r.addChallenger(id));
    const m1 = r.nextChallenge(name);
    expect([m1.c1Id, m1.c2Id]).toEqual(['a', 'c']);
    r.setLive(m1.id);
    r.complete({ c1Id: 'a', c2Id: 'c', winnerId: 'a', winnerName: 'A' });
    expect(r.data.koth.defenses).toBe(1);
    const m2 = r.nextChallenge(name);
    r.setLive(m2.id);
    r.complete({ c1Id: 'a', c2Id: 'd', winnerId: 'd', winnerName: 'D' });
    expect(r.data.koth.kingId).toBe('d');
    expect(r.data.koth.defenses).toBe(0);
    expect(r.data.koth.reigns.map(x => `${x.name}:${x.defenses}`)).toEqual(['A:1', 'D:0']);
  });
});

describe('sign-ups and the draw', () => {
  it('waitlists past capacity by sign-up time and promotes when someone leaves', () => {
    const list = [1, 2, 3, 4].map(i => ({ deviceId: `d${i}`, at: i, status: 'registered' }));
    assignStatuses(list, 3);
    expect(list.map(e => e.status)).toEqual(['registered', 'registered', 'registered', 'waitlist']);
    list[0].status = 'out';
    assignStatuses(list, 3);
    expect(list[3].status).toBe('registered');
  });

  it('pairs everyone, with a bye for an odd number', () => {
    let seed = 0.37;
    const rand = () => { seed = (seed * 9301 + 0.49297) % 1; return seed; };
    const { pairs, bye } = drawPairs(['a', 'b', 'c', 'd', 'e'], rand);
    expect(pairs).toHaveLength(2);
    expect(bye).toBeTruthy();
    expect(new Set([...pairs.flat(), bye]).size).toBe(5);
  });
});

describe('3/4-way battles', () => {
  it('ranks by panel average, first-place votes break ties', () => {
    const r = rankCypher([{ totals: [80, 75, 70] }, { totals: [70, 85, 72] }], 3);
    expect(r.map(x => x.index)).toEqual([1, 0, 2]);
    const tie = rankCypher([{ totals: [80, 70, 75] }, { totals: [70, 80, 75] }, { totals: [76, 74, 75] }], 3);
    expect(tie[0].index).toBe(0);    // 75.33 each for 0 and 1? → 0 has 2 firsts
    expect(tie[0].firsts).toBe(2);
  });

  it('pairwise ratings: winner up, last place down, total kept', () => {
    const after = pairwiseElo(['a', 'b', 'c'], { a: 1500, b: 1500, c: 1500 });
    expect(after.a).toBeGreaterThan(1500);
    expect(after.c).toBeLessThan(1500);
    expect(after.a + after.b + after.c).toBe(4500);
  });
});

const B = (id, a, b, w, s1, s2, extra = {}) => ({
  id, leagueId: 'L', timestamp: `2026-10-0${id}T20:00:00Z`, contestant1Id: a, contestant1Name: a.toUpperCase(), contestant2Id: b, contestant2Name: b.toUpperCase(),
  winnerId: w, total1: s1, total2: s2, ...extra
});

describe('seasons', () => {
  const battles = [
    B(1, 'a', 'b', 'a', 82, 78, { seasonId: 's1' }),
    B(2, 'a', 'c', 'c', 70, 80, { seasonId: 's1' }),
    B(3, 'b', 'c', null, 75, 75, { seasonId: 's1' }),
    B(4, 'a', 'b', 'a', 90, 60, { seasonId: 's2' }),
    { id: 'x', leagueId: 'L', timestamp: '2026-10-05T20:00:00Z', kind: 'cypher', seasonId: 's1', placings: [{ id: 'c', name: 'C', total: 88 }, { id: 'a', name: 'A', total: 80 }, { id: 'b', name: 'B', total: 70 }] }
  ];

  it('3 points a win, 1 a draw, per season, with a playoff line', () => {
    const rows = seasonStandings(battles, { leagueId: 'L', seasonId: 's1', playoffSpots: 2 });
    expect(rows[0]).toMatchObject({ id: 'c', points: 7, wins: 2, draws: 1 });
    expect(rows.filter(r => r.qualified).map(r => r.id)).toEqual(['c', 'a']);
    const all = seasonStandings(battles, { leagueId: 'L' });
    expect(all.find(r => r.id === 'a').wins).toBe(2);
  });

  it('battles from before seasons count for the first season when asked', () => {
    const old = [B(1, 'a', 'b', 'b', 70, 80)];
    expect(seasonStandings(old, { leagueId: 'L', seasonId: 's1' })).toHaveLength(0);
    expect(seasonStandings(old, { leagueId: 'L', seasonId: 's1', includeUntagged: true })[0].id).toBe('b');
  });
});

describe('league stats', () => {
  const cats = { categories: [{ name: 'Drums' }, { name: 'Mix' }, { name: 'Melody' }] };
  const panel = (t1a, t2a, t1b, t2b) => ({ judges: [{ name: 'J1', scored: true, total1: t1a, total2: t2a }, { name: 'J2', scored: true, total1: t1b, total2: t2b }] });
  const battles = [
    B(1, 'a', 'b', 'b', 70, 80, { scoringRules: cats, ratingChanges: { a: { before: 1600 }, b: { before: 1450 } }, roundResults: [{ scores1: [7, 6, 8], scores2: [9, 8, 7], panel: panel(72, 78, 68, 82) }] }),
    B(2, 'a', 'b', 'a', 85, 75, { scoringRules: cats, roundResults: [{ scores1: [9, 8, 8], scores2: [7, 7, 7] }] })
  ];
  it('head-to-head, strengths, upsets and judge lean', () => {
    const s = computeLeagueStats(battles, { leagueId: 'L' });
    expect(s.h2h[0]).toMatchObject({ a: 'a', b: 'b', winsA: 1, winsB: 1 });
    expect(s.strengths.a.Drums).toBe(8);
    expect(s.upsets[0]).toMatchObject({ winner: 'B', loser: 'A', gap: 150 });
    const j1 = s.judges.find(j => j.judge === 'J1');
    expect(j1.producers.find(p => p.id === 'a').lean).toBe(4);
    expect(radarSvg([8, 7, 9], ['Drums', 'Mix', 'Melody'])).toContain('<svg');
  });
});

describe('CSV in / out and history filters', () => {
  it('parses quotes, commas and newlines', () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
    expect(parseCsv('name;bio\nAnn;Hi\n')).toEqual([['name', 'bio'], ['Ann', 'Hi']]);
    expect(toCsv(['a'], [['x,y']])).toBe('a\r\n"x,y"');
  });

  it('reads a roster file and reports bad rows', () => {
    const { people, errors } = rosterFromCsv('Name,Instagram,Color\nAnn,@ann,#ff0000\n,@nobody,\nBo,,nope\n');
    expect(people.map(p => p.name)).toEqual(['Ann', 'Bo']);
    expect(people[0]).toMatchObject({ socialLinks: '@ann', color: '#ff0000' });
    expect(people[1].color).toBe('');
    expect(errors).toHaveLength(1);
    expect(rosterFromCsv('bio\nx').errors[0]).toMatch(/name/);
  });

  it('filters by producer, judge, date and margin; exports a row per battle', () => {
    const list = [
      B(1, 'ann', 'bo', 'ann', 80, 79, { roundResults: [{ panel: { judges: [{ name: 'Premier' }] } }] }),
      B(3, 'cy', 'bo', 'bo', 60, 75)
    ];
    expect(filterHistory(list, { text: 'cy' })).toHaveLength(1);
    expect(filterHistory(list, { judge: 'prem' })).toHaveLength(1);
    expect(filterHistory(list, { maxMargin: 2 })).toHaveLength(1);
    expect(filterHistory(list, { from: '2026-10-02' })).toHaveLength(1);
    const csv = historyToCsv(list, 'L');
    expect(csv.split('\r\n')).toHaveLength(3);
    expect(csv).toContain('Premier');
  });
});

describe('public league page', () => {
  it('renders standings, results and next up, escaping names', () => {
    const data = buildPublicData({
      league: { name: 'Smoke <League>', color: '#ff2d2d' },
      season: { name: 'Season 2' },
      standings: [{ rank: 1, name: 'Ann', wins: 2, losses: 0, draws: 0, points: 6, winRate: 1, avgScore: 81.5, qualified: true }],
      battles: [B(1, 'ann', 'bo', 'ann', 80, 70), { ...B(2, 'x', 'y', null, 1, 1), isDemo: true }],
      queue: [{ c1Name: 'Cy', c2Name: 'Di', status: 'queued' }]
    });
    expect(data.results).toHaveLength(1);
    const html = renderPublicPage(data);
    expect(html).toContain('Smoke &lt;League&gt;');
    expect(html).toContain('Season 2');
    expect(html).toContain('Cy');
    expect(html).not.toContain('<script>');
    expect(renderPublicPage(data, { live: true })).toContain('/api/public/data');
  });
});

describe('hub: producers, co-host, predictions, N-way cards', () => {
  it('sign-up needs an open list; status is replayed on reconnect', () => {
    const rooms = new JudgeRooms();
    const host = inbox();
    rooms.claimHost('ROOM', 't', host);
    const phone = inbox();
    rooms.joinEntrant('ROOM', 'dev-entrant-1', phone);
    expect(rooms.registerEntrant('ROOM', 'dev-entrant-1', { name: 'Ann' }).code).toBe('closed');
    rooms.setSignup('ROOM', { open: true, capacity: 8, uploads: true });
    expect(rooms.registerEntrant('ROOM', 'dev-entrant-1', { name: 'Ann', social: '@ann' }).ok).toBe(true);
    expect(host.msgs.find(m => m.t === 'signup')).toMatchObject({ name: 'Ann', social: '@ann' });
    expect(rooms.entrant('room', 'dev-entrant-1').name).toBe('Ann');
    rooms.toEntrant('ROOM', 'dev-entrant-1', { t: 'ent-status', status: 'drawn' });
    rooms.leaveEntrant('ROOM', 'dev-entrant-1');
    const again = inbox();
    rooms.joinEntrant('ROOM', 'dev-entrant-1', again);
    expect(again.msgs.map(m => m.t)).toEqual(['ent-joined', 'ent-status']);
    expect(again.msgs[0].me.name).toBe('Ann');
  });

  it('co-host commands only flow after the host accepts the tablet', () => {
    const rooms = new JudgeRooms();
    const host = inbox();
    rooms.claimHost('ROOM', 't', host);
    const tab = inbox();
    rooms.joinCohost('ROOM', 'tab-1-device', '12a34', tab);
    expect(host.msgs.at(-1)).toEqual({ t: 'cohost-join', deviceId: 'tab-1-device', pin: '1234' });
    expect(rooms.cohostCommand('ROOM', 'tab-1-device', 'deck1.play')).toBe(false);
    rooms.toCohost('ROOM', 'tab-1-device', { t: 'co-ok' });
    expect(rooms.cohostCommand('ROOM', 'tab-1-device', 'deck1.play')).toBe(true);
    expect(rooms.cohostCommand('ROOM', 'tab-1-device', 'bad action!')).toBe(false);
    expect(host.msgs.at(-1)).toMatchObject({ t: 'cohost-cmd', action: 'deck1.play' });
    expect(rooms.setCohostState('ROOM', { x: 1 })).toBe(1);
  });

  it('predictions: one pick per phone, points for the right call, leaderboard', () => {
    const rooms = new JudgeRooms();
    const host = inbox();
    rooms.claimHost('ROOM', 't', host);
    const a = inbox();
    const b = inbox();
    rooms.joinAudience('ROOM', 'pa', a);
    rooms.joinAudience('ROOM', 'pb', b);
    rooms.setNick('ROOM', 'pa', '  Ann   Lee ');
    rooms.setPrediction('ROOM', { id: 'p1', open: true, options: ['X', 'Y'] });
    rooms.predict('ROOM', 'pa', 'p1', 1);
    rooms.predict('ROOM', 'pb', 'p1', 2);
    rooms.predict('ROOM', 'pb', 'p1', 1);   // changed their mind
    expect(host.msgs.filter(m => m.t === 'pred-tally').at(-1).counts).toEqual([2, 0]);
    const board = rooms.resolvePrediction('ROOM', 'p1', 1);
    expect(board[0]).toEqual({ name: 'Ann Lee', points: 1 });
    expect(rooms.predict('ROOM', 'pa', 'p1', 2)).toBe(false);   // closed
    rooms.setPrediction('ROOM', { id: 'p2', open: true, options: ['X', 'Z'] });
    rooms.predict('ROOM', 'pa', 'p2', 2);
    rooms.resolvePrediction('ROOM', 'p2', 0);   // draw: nobody scores
    expect(rooms.board(rooms.rooms.get('ROOM'))[0].points).toBe(1);
  });

  it('N-way cards, comments and calibration cards reach the host cleaned', () => {
    const rooms = new JudgeRooms();
    const host = inbox();
    rooms.claimHost('ROOM', 't', host);
    rooms.joinJudge('ROOM', 'j1', 'Judge', inbox());
    rooms.judgeScores('ROOM', 'j1', { round: 1, cards: [[11, 5], [3, -2], [7]], commentsN: [['x'.repeat(200)]], overall: 'close one', comments1: ['nice'], comments2: [] });
    const m = host.msgs.find(x => x.t === 'judge-scores');
    expect(m.cards).toEqual([[10, 5], [3, 0], [7]]);
    expect(m.commentsN[0][0]).toHaveLength(140);
    expect(m.overall).toBe('close one');
    expect(m.comments1).toEqual(['nice']);
    rooms.judgeCalibration('ROOM', 'j1', { calId: 'cal1', scores: [8, 12] });
    expect(host.msgs.at(-1)).toEqual({ t: 'judge-cal', deviceId: 'j1', calId: 'cal1', scores: [8, 10] });
  });
});
