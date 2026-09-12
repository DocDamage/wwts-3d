import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BattleTimer } from '../src/js/timer.js';

describe('BattleTimer Engine & Explicit Interface', () => {
  let timer;

  beforeEach(() => {
    vi.useFakeTimers();
    timer = new BattleTimer(180);
  });

  afterEach(() => {
    timer.stop();
    vi.useRealTimers();
  });

  it('provides explicit duration interface', () => {
    expect(timer.getDuration()).toBe(180);
    expect(timer.remaining).toBe(180);

    timer.setDuration(60, true);
    expect(timer.getDuration()).toBe(60);
    expect(timer.remaining).toBe(60);
  });

  it('supports toggle, start, and isRunning aliases', () => {
    expect(timer.isRunning).toBe(false);

    timer.start();
    expect(timer.isRunning).toBe(true);

    timer.toggle();
    expect(timer.isRunning).toBe(false);

    timer.toggle();
    expect(timer.isRunning).toBe(true);
  });

  it('handles overtime duration, tick callbacks, and clean reset', () => {
    let tickCount = 0;
    timer.onTick = (rem) => { tickCount++; };

    // Overtime set to 60s
    timer.setDuration(60, true);
    expect(timer.remaining).toBe(60);

    timer.play();
    expect(timer.isRunning).toBe(true);

    // Advance 3 seconds
    vi.advanceTimersByTime(3000);
    expect(timer.remaining).toBeLessThanOrEqual(57);

    // Pause and verify it doesn't drift
    timer.pause();
    expect(timer.isRunning).toBe(false);
    const savedRemaining = timer.remaining;

    vi.advanceTimersByTime(5000);
    expect(timer.remaining).toBe(savedRemaining); // Paused!

    // Reset restores duration
    timer.reset(180);
    expect(timer.remaining).toBe(180);
    expect(timer.isRunning).toBe(false);
  });

  it('triggers onWarning10 and onComplete', () => {
    let warningFired = false;
    let completeFired = false;

    timer.onWarning10 = () => { warningFired = true; };
    timer.onComplete = () => { completeFired = true; };

    timer.setDuration(12, true);
    timer.play();

    // Advance 3 seconds (to 9s remaining)
    vi.advanceTimersByTime(3000);
    expect(warningFired).toBe(true);

    // Advance to 0s
    vi.advanceTimersByTime(10000);
    expect(completeFired).toBe(true);
    expect(timer.remaining).toBe(0);
    expect(timer.isRunning).toBe(false);
  });
});
