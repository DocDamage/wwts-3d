import { describe, it, expect } from 'vitest';
import { ScoringEngine } from '../src/js/scoring.js';

describe('ScoringEngine & 100-Point Weighted Normalization', () => {
  it('normalizes equal-weight 10 categories correctly to 100 max', () => {
    const scoring = new ScoringEngine();
    // Set all 10 categories to 8.0
    const scores = new Array(10).fill(8.0);
    scoring.setScores(1, scores);

    expect(scoring.calculateNormalizedTotal(1)).toBe(80.0);
    expect(scoring.getTotal(1)).toBe(80.0);
  });

  it('normalizes when fewer categories are enabled', () => {
    // 5 categories enabled
    const customRules = {
      categories: [
        { name: 'Drums', weight: 1.0, enabled: true },
        { name: 'Bassline', weight: 1.0, enabled: true },
        { name: 'Melody', weight: 1.0, enabled: true },
        { name: 'Mix', weight: 1.0, enabled: true },
        { name: 'Arrangement', weight: 1.0, enabled: true }
      ],
      normalizeTo100: true
    };
    const scoring = new ScoringEngine(customRules);

    // Score all 5 categories as 7.5
    scoring.setScores(1, [7.5, 7.5, 7.5, 7.5, 7.5]);
    // Formula: 10 * (7.5 * 5) / 5 = 75.0
    expect(scoring.calculateNormalizedTotal(1)).toBe(75.0);
  });

  it('correctly computes weighted categories', () => {
    const customRules = {
      categories: [
        { name: 'Drums', weight: 2.0, enabled: true },
        { name: 'Bassline', weight: 1.0, enabled: true }
      ],
      normalizeTo100: true
    };
    const scoring = new ScoringEngine(customRules);

    // Drums = 10, Bassline = 5
    // Sum = (10*2) + (5*1) = 25
    // Total weight = 3
    // Normalized = 10 * 25 / 3 = 83.33
    scoring.setScores(1, [10, 5]);
    expect(scoring.calculateNormalizedTotal(1)).toBe(83.33);
  });

  it('distinguishes unscored from deliberate 0.0', () => {
    const scoring = new ScoringEngine();
    expect(scoring.hasUnscoredCategories(1)).toBe(true);
    expect(scoring.getUnscoredCount(1)).toBe(10);

    // Fill 9 categories
    const partial = [8, 8, 8, 8, 8, 8, 8, 8, 8, null];
    scoring.setScores(1, partial);
    expect(scoring.hasUnscoredCategories(1)).toBe(true);
    expect(scoring.getUnscoredCount(1)).toBe(1);

    // Explicitly set 10th category to 0.0
    partial[9] = 0.0;
    scoring.setScores(1, partial);
    expect(scoring.hasUnscoredCategories(1)).toBe(false);
    expect(scoring.getUnscoredCount(1)).toBe(0);
  });

  it('totals use two decimal places', () => {
    const scoring = new ScoringEngine();
    scoring.setScores(1, [7.25, 8.5, 9, 6.75, 8, 7.5, 9.25, 8, 7, 6.5]);
    // Sum = 77.75 → 10 * 77.75 / 10 = 77.75
    expect(scoring.getTotal(1)).toBe(77.75);
  });

  it('applies presets without losing entered scores', () => {
    const scoring = new ScoringEngine();
    scoring.setScores(1, new Array(10).fill(8));

    scoring.setPreset('core5');
    expect(scoring.categories.filter(c => c.enabled).length).toBe(5);
    expect(scoring.getTotal(1)).toBe(80);

    scoring.setPreset('trap808');
    const bass = scoring.categories.find(c => c.key === 'bassline');
    expect(bass.weight).toBe(1.5);
    expect(scoring.categories.every(c => c.enabled)).toBe(true);
    expect(scoring.getPresetName()).toBe('Trap / 808 Focus');
  });

  it('switches to Custom when a weight is edited by hand', () => {
    const scoring = new ScoringEngine();
    scoring.setCategoryWeight(0, 2);
    expect(scoring.presetId).toBe('custom');
    expect(scoring.categories[0].weight).toBe(2);
    scoring.setCategoryWeight(1, 99);
    expect(scoring.categories[1].weight).toBe(5);
  });

  it('generates immutable frozen rules snapshot', () => {
    const scoring = new ScoringEngine();
    const snap = scoring.getRulesSnapshot();

    expect(snap.step).toBe(0.1);
    expect(snap.normalizeTo100).toBe(true);
    expect(snap.categories.length).toBe(10);

    // Modifying original doesn't alter snapshot
    scoring.categories[0].weight = 5.0;
    expect(snap.categories[0].weight).toBe(1.0);
  });
});
