import { describe, it, expect } from 'vitest';
import { DJControllerRenderer } from '../src/js/djController.js';
import { MOVES, MOVES_BY_ID, TAUNT_REACTIONS, HYPE_REACTIONS, IDLE_FIDGETS, walkCycle, djStation, groove } from '../src/js/characterMoves.js';

// Records every helper call so moves can be checked without a real skeleton
function fakeAnimator() {
  const calls = [];
  const rec = (name) => (...args) => calls.push([name, args]);
  return {
    calls,
    arm: rec('arm'), leg: rec('leg'), spine: rec('spine'), head: rec('head'), lift: rec('lift'), yaw: rec('yaw')
  };
}

const ctx = { beat: 1.3, bpm: 96, playing: true, oppAngle: 0.8, near: 'Left', far: 'Right' };

function allNumbersFinite(calls) {
  return calls.every(([, args]) => args.every(arg => {
    if (typeof arg === 'number') return Number.isFinite(arg);
    if (arg && typeof arg === 'object') return Object.values(arg).every(v => typeof v !== 'number' || Number.isFinite(v));
    return true;
  }));
}

describe('Character move library', () => {
  it('every move produces finite pose values across its whole duration', () => {
    MOVES.forEach(move => {
      const span = move.loop ? 4 : move.duration;
      for (let t = 0; t <= span; t += 0.25) {
        const a = fakeAnimator();
        move.fn(a, t, ctx, 1);
        expect(a.calls.length, `${move.id} should pose something`).toBeGreaterThan(0);
        expect(allNumbersFinite(a.calls), `${move.id} at t=${t}`).toBe(true);
      }
    });
  });

  it('has unique ids and every one-shot has a duration', () => {
    expect(new Set(MOVES.map(m => m.id)).size).toBe(MOVES.length);
    MOVES.filter(m => !m.loop).forEach(m => expect(m.duration).toBeGreaterThan(0));
  });

  it('offers plenty of user-facing moves', () => {
    expect(MOVES.filter(m => !m.hidden).length).toBeGreaterThanOrEqual(30);
  });

  it('reaction pools only reference real moves', () => {
    [...TAUNT_REACTIONS, ...HYPE_REACTIONS, ...IDLE_FIDGETS].forEach(id => expect(MOVES_BY_ID[id]).toBeDefined());
  });

  it('base layers produce finite values', () => {
    const a = fakeAnimator();
    walkCycle(a, 2.1, 0.5, 1);
    djStation(a, 3.3, ctx, 1, true, true);
    groove(a, ctx, 1);
    expect(allNumbersFinite(a.calls)).toBe(true);
  });
});

describe('Stage navigation', () => {
  const dj = new DJControllerRenderer();

  it('keeps destinations on the stage and off the DJ table', () => {
    const far = dj.constrainToStage(10, 0);
    expect(Math.hypot(far.x, far.z)).toBeLessThanOrEqual(3.5001);

    const onTable = dj.constrainToStage(0.2, 0.1);
    const insideTable = Math.abs(onTable.x) < 1.8 && Math.abs(onTable.z) < 0.7;
    expect(insideTable).toBe(false);
  });

  it('routes around the table instead of through it', () => {
    const from = { x: -2.15, z: 0.3 }; // beside the booth
    const to = { x: -0.88, z: -1.0 };   // behind the left deck
    expect(dj.segmentHitsTable(from, to)).toBe(true);

    const waypoints = dj.routeAroundTable(from, to);
    expect(waypoints.length).toBeGreaterThan(0);
    const legs = [from, ...waypoints, to];
    for (let i = 1; i < legs.length; i++) {
      expect(dj.segmentHitsTable(legs[i - 1], legs[i])).toBe(false);
    }
  });

  it('walks straight when the path is already clear', () => {
    expect(dj.routeAroundTable({ x: -2, z: 1.5 }, { x: 2, z: 1.5 })).toEqual([]);
  });
});
