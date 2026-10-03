import { describe, it, expect } from 'vitest';
import { BattleNotepad } from '../src/js/notepad.js';

function setup({ playing = null, time = 42.7 } = {}) {
  const engine = { timestampedNotes: [], activeContestant: 2 };
  const audio = {
    players: { 1: { loaded: true }, 2: { loaded: true } },
    isPlaying: (n) => n === playing,
    getDeckState: () => ({ loaded: true, time }),
    seeks: [],
    seek(n, t) { this.seeks.push([n, t]); }
  };
  const rounds = { currentRound: 2 };
  let changes = 0;
  const pad = new BattleNotepad({ battleEngine: engine, audio, rounds, getNames: () => ['A', 'B'], onChange: () => { changes++; } });
  return { pad, engine, audio, changes: () => changes };
}

describe('Battle notepad', () => {
  it('stamps notes with round, contestant and the beat time', () => {
    const { pad, engine, changes } = setup({ playing: 1, time: 102.4 });
    const note = pad.add({ text: '  crazy flip at the drop  ', contestant: 1 });
    expect(note.text).toBe('crazy flip at the drop');
    expect(note.round).toBe(2);
    expect(note.time).toBe('1:42');
    expect(note.visibility).toBe('private');
    expect(engine.timestampedNotes).toHaveLength(1);
    expect(changes()).toBe(1);
  });

  it('captures the live deck when typing starts', () => {
    const { pad } = setup({ playing: 2, time: 61 });
    pad.el = { stamp: { textContent: '', className: '' } };
    pad.captureStamp();
    expect(pad.stamp).toMatchObject({ contestant: 2, round: 2, trackTime: 61 });
  });

  it('keeps private and public sides separate and can move notes', () => {
    const { pad } = setup();
    const a = pad.add({ text: 'mix is muddy', contestant: 1 });
    pad.add({ text: 'great energy', contestant: 2, visibility: 'public' });
    pad.side = 'private';
    expect(pad.visibleNotes().map(n => n.text)).toEqual(['mix is muddy']);
    pad.el = null; // no DOM in this test
    pad.move(a.id);
    pad.side = 'public';
    expect(pad.visibleNotes()).toHaveLength(2);
    pad.filter = '2';
    expect(pad.visibleNotes().map(n => n.text)).toEqual(['great energy']);
  });

  it('treats older notes without a side as private and ignores empty text', () => {
    const { pad, engine } = setup();
    engine.timestampedNotes.push({ id: 'old', text: 'legacy', round: 1, contestant: 1, time: '0:10' });
    expect(pad.add({ text: '   ' })).toBeNull();
    pad.side = 'public';
    expect(pad.visibleNotes()).toHaveLength(0);
    pad.side = 'private';
    expect(pad.visibleNotes()).toHaveLength(1);
  });

  it('jumps a deck back to a note and removes notes', () => {
    const { pad, audio, engine } = setup({ time: 30 });
    const n = pad.add({ text: 'snare too loud', contestant: 2 });
    pad.seekTo(n);
    expect(audio.seeks).toEqual([[2, 30]]);
    pad.remove(n.id);
    expect(engine.timestampedNotes).toHaveLength(0);
  });
});
