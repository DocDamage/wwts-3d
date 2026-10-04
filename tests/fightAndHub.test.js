import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { JudgeRooms } from '../server/judgeHub.js';
import { CAST } from '../src/js/fightCast.js';
import { STYLE_MOVES, STYLE_OF, styleFor } from '../src/js/fightStyles.js';
import { pickOpponents, simulate } from '../src/js/fightModes.js';
import { getKeys, getPad, bindKey, bindPad, resetBindings, ACTIONS } from '../src/js/fightControls.js';
import { ANNOUNCER_LINES } from '../src/js/announcerLines.js';
import { STEPS } from '../src/js/tour.js';

const inbox = () => {
  const msgs = [];
  const send = (m) => msgs.push(m);
  send.msgs = msgs;
  return send;
};

describe('hub: audience votes and overlays', () => {
  it('one vote per phone per poll, changeable, tallied to the host', () => {
    const rooms = new JudgeRooms();
    const host = inbox();
    rooms.claimHost('ROOM', 't', host);
    const a = inbox();
    const b = inbox();
    rooms.joinAudience('ROOM', 'pa', a);
    rooms.joinAudience('ROOM', 'pb', b);
    expect(host.msgs.filter(m => m.t === 'aud-count').at(-1).n).toBe(2);

    rooms.setPoll('ROOM', { id: 'r1', open: true, options: ['Ann', 'Ben'] });
    expect(rooms.vote('ROOM', 'pa', 'r1', 1)).toBe(true);
    expect(rooms.vote('ROOM', 'pb', 'r1', 2)).toBe(true);
    expect(rooms.vote('ROOM', 'pa', 'r1', 2)).toBe(true);     // changed their mind
    expect(host.msgs.filter(m => m.t === 'vote-tally').at(-1).counts).toEqual([0, 2]);

    expect(rooms.vote('ROOM', 'pa', 'old-poll', 1)).toBe(false);
    expect(rooms.vote('ROOM', 'stranger', 'r1', 1)).toBe(false);
    expect(rooms.vote('ROOM', 'pa', 'r1', 3)).toBe(false);
    rooms.setPoll('ROOM', { id: 'r1', open: false, options: ['Ann', 'Ben'] });
    expect(rooms.vote('ROOM', 'pb', 'r1', 1)).toBe(false);    // closed
  });

  it('a new poll starts from zero; hype taps are throttled per phone', () => {
    const rooms = new JudgeRooms();
    const host = inbox();
    rooms.claimHost('ROOM', 't', host);
    rooms.joinAudience('ROOM', 'pa', inbox());
    rooms.setPoll('ROOM', { id: 'r1', open: true, options: ['A', 'B'] });
    rooms.vote('ROOM', 'pa', 'r1', 1);
    rooms.setPoll('ROOM', { id: 'r2', open: true, options: ['A', 'B'] });
    expect(host.msgs.filter(m => m.t === 'vote-tally').at(-1)).toMatchObject({ pollId: 'r2', counts: [0, 0] });
    expect(rooms.hype('ROOM', 'pa')).toBe(true);
    expect(rooms.hype('ROOM', 'pa')).toBe(false);
  });

  it('overlays get the latest state on join and every update after', () => {
    const rooms = new JudgeRooms();
    rooms.claimHost('ROOM', 't', inbox());
    rooms.setOverlay('ROOM', { timer: 60 });
    const ov = inbox();
    rooms.joinOverlay('ROOM', ov);
    expect(ov.msgs.map(m => m.t)).toEqual(['ov-joined', 'overlay']);
    expect(ov.msgs[1].state).toEqual({ timer: 60 });
    expect(rooms.setOverlay('ROOM', { timer: 59 })).toBe(1);
    rooms.leaveOverlay('ROOM', ov);
    expect(rooms.setOverlay('ROOM', { timer: 58 })).toBe(0);
    expect(ov.msgs).toHaveLength(3);
  });
});

describe('fight club data', () => {
  const manifest = JSON.parse(readFileSync('public/models/animations/manifest.json', 'utf8'));
  const ids = new Set(manifest.map(e => e.id));

  it('every fighter has a model file and a real style', () => {
    CAST.forEach(c => {
      expect(existsSync('public' + c.file), c.file).toBe(true);
      expect(STYLE_OF[c.style], `${c.name}: ${c.style}`).toBeTruthy();
      expect(styleFor(c).key).not.toBe('allround');
    });
    expect(new Set(CAST.map(c => c.key)).size).toBe(CAST.length);
  });

  it('every style move has its animation', () => {
    Object.values(STYLE_MOVES).forEach(m => expect(ids.has('mx_' + m.id), m.id).toBe(true));
  });

  it('ladders: opponents are unique, never yourself, boss last', () => {
    for (let n = 0; n < 20; n++) {
      const opps = pickOpponents('ninja', 6, { boss: true });
      expect(opps).toHaveLength(6);
      expect(opps).not.toContain('ninja');
      expect(new Set(opps).size).toBe(6);
      expect(['warrok', 'mutant']).toContain(opps[5]);
      expect(opps.slice(0, 5).some(k => ['warrok', 'mutant'].includes(k))).toBe(false);
    }
    const w = simulate('ninja', 'kachujin');
    expect(['ninja', 'kachujin']).toContain(w);
  });
});

describe('fight controls', () => {
  it('rebinding a key moves it off any other action', () => {
    resetBindings();
    bindKey(1, 'lp', 'KeyG');           // G was heavy punch
    expect(getKeys()[1].lp[0]).toBe('KeyG');
    expect(getKeys()[1].hp).not.toContain('KeyG');
    ACTIONS.forEach(a => { if (a !== 'lp') expect(getKeys()[1][a]).not.toContain('KeyG'); });
    // player 2 is untouched
    expect(getKeys()[2].lp).toContain('KeyK');
  });

  it('rebinding a pad button unbinds its old action', () => {
    resetBindings();
    bindPad(1, 'super', 0);             // A was light kick
    expect(getPad(1).super).toBe(0);
    expect(getPad(1).lk).toBe(-1);
    expect(getPad(2).lk).toBe(0);
    resetBindings();
    expect(getPad(1).lk).toBe(0);
  });
});

describe('announcer captions and tour', () => {
  it('every announcer clip has a caption', () => {
    readdirSync('public/sounds/announcer/Announcer Pack').filter(f => f.endsWith('.wav')).forEach(f => {
      expect(ANNOUNCER_LINES[f.slice(0, -4)], f).toBeTruthy();
    });
  });

  it('every tour target exists in the page', () => {
    const html = readFileSync('index.html', 'utf8');
    STEPS.filter(s => s.target).forEach(s => {
      const id = s.target.match(/^#([\w-]+)$/)?.[1];
      const screen = s.target.match(/data-screen="(\w+)"/)?.[1];
      if (id) expect(html.includes(`id="${id}"`), s.target).toBe(true);
      if (screen) expect(html.includes(`data-screen="${screen}"`), s.target).toBe(true);
    });
  });
});
