/**
 * Scoring Engine — Configurable Multi-Category Battle Scoring System
 * Features:
 * - 10 Classic Categories with concise definitions & weights
 * - Weighted 100-Point Normalization:
 *   Score = 10 * (Sum(category score * weight) / Sum(enabled weights))
 * - Configurable step increments: 0.1, 0.25, 0.5
 * - Explicit distinction between Unscored ("—") and deliberate 0.0
 * - Frozen rules snapshot attached to official battle results
 */

const DEFAULT_CATEGORY_DEFS = [
  {
    key: 'creativity',
    name: 'Creativity',
    weight: 1.0,
    enabled: true,
    desc: 'Originality of concepts, sample flips, unexpected chord progressions, and unique beat identity.'
  },
  {
    key: 'versatility',
    name: 'Versatility',
    weight: 1.0,
    enabled: true,
    desc: 'Range of dynamic textures, switch-ups, genre fluidity, and creative flexibility.'
  },
  {
    key: 'mix',
    name: 'Mix',
    weight: 1.0,
    enabled: true,
    desc: 'Clarity, balance, headroom, frequency separation, and stereo imaging.'
  },
  {
    key: 'drums',
    name: 'Drums',
    weight: 1.0,
    enabled: true,
    desc: 'Punch, groove, swing, transient impact, and rhythm programming.'
  },
  {
    key: 'melody',
    name: 'Melody',
    weight: 1.0,
    enabled: true,
    desc: 'Catchiness, emotional resonance, harmonic structure, and top-line hook.'
  },
  {
    key: 'bassline',
    name: 'Bassline',
    weight: 1.0,
    enabled: true,
    desc: 'Low-end weight, 808 glide, sub presence, and harmonic cohesion with the kick.'
  },
  {
    key: 'energy',
    name: 'Energy',
    weight: 1.0,
    enabled: true,
    desc: 'Driving momentum, stage presence, bounce, and crowd hype.'
  },
  {
    key: 'battle_ability',
    name: 'Battle Ability',
    weight: 1.0,
    enabled: true,
    desc: 'Head-to-head competitiveness, aggression, response capability, and knockout power.'
  },
  {
    key: 'arrangement',
    name: 'Arrangement',
    weight: 1.0,
    enabled: true,
    desc: 'Song structure, intro/drop timing, transitions, build-ups, and pacing.'
  },
  {
    key: 'sound_selection',
    name: 'Sound Selection',
    weight: 1.0,
    enabled: true,
    desc: 'Choice of presets, Foley, one-shots, sample textures, and cohesive sonic aesthetic.'
  }
];

const CATEGORIES = DEFAULT_CATEGORY_DEFS.map(c => c.name);

// Presets reshape the same 10 categories (order never changes, so scores stay aligned).
// `only` limits which categories are enabled; `weights` overrides the default 1.0 weight.
const SCORING_PRESETS = {
  classic10: { name: 'Classic 10' },
  core5: { name: 'Core 5 (Quick)', only: ['creativity', 'mix', 'drums', 'melody', 'energy'] },
  boombap: { name: 'Boom-Bap Focus', weights: { drums: 1.5, sound_selection: 1.5, creativity: 1.25, arrangement: 1.25 } },
  trap808: { name: 'Trap / 808 Focus', weights: { bassline: 1.5, drums: 1.5, energy: 1.25, mix: 1.25 } },
  custom: { name: 'Custom' }
};
const MAX_SCORE_PER_CATEGORY = 10;

class ScoringEngine {
  constructor(customRules = null) {
    this.categories = JSON.parse(JSON.stringify(customRules?.categories || DEFAULT_CATEGORY_DEFS));
    this.step = customRules?.step || 0.1; // 0.1 | 0.25 | 0.5
    this.presetId = customRules?.presetId || 'classic10';
    this.normalizeTo100 = customRules?.normalizeTo100 !== false;

    // Scores: null = unscored, number = deliberate score
    this.scores = {
      1: new Array(this.categories.length).fill(null),
      2: new Array(this.categories.length).fill(null)
    };

    this.locked = false;
    this.onScoreChange = null;
  }

  getRulesSnapshot() {
    return {
      presetId: this.presetId,
      categories: JSON.parse(JSON.stringify(this.categories)),
      step: this.step,
      normalizeTo100: this.normalizeTo100
    };
  }

  setStep(newStep) {
    const valid = [0.1, 0.25, 0.5];
    if (valid.includes(newStep)) {
      this.step = newStep;
      this.rebuildAllSliders();
    }
  }

  setPreset(presetId) {
    const preset = SCORING_PRESETS[presetId];
    if (!preset || presetId === 'custom') return;
    this.presetId = presetId;
    this.categories = DEFAULT_CATEGORY_DEFS.map(def => ({
      ...def,
      weight: preset.weights?.[def.key] ?? 1.0,
      enabled: preset.only ? preset.only.includes(def.key) : true
    }));
    this.rebuildAllSliders();
    this.updateTotal(1);
    this.updateTotal(2);
  }

  getPresetName() {
    return SCORING_PRESETS[this.presetId]?.name || 'Custom';
  }

  setCategoryWeight(index, weight) {
    if (this.categories[index]) {
      this.categories[index].weight = Math.min(5, Math.max(0, parseFloat(weight) || 0));
      this.presetId = 'custom';
      this.rebuildAllSliders();
      this.updateTotal(1);
      this.updateTotal(2);
    }
  }

  setCategoryEnabled(index, enabled) {
    if (this.categories[index]) {
      this.categories[index].enabled = !!enabled;
      this.presetId = 'custom';
      this.rebuildAllSliders();
      this.updateTotal(1);
      this.updateTotal(2);
    }
  }

  rebuildAllSliders() {
    if (typeof document !== 'undefined') {
      this.buildSliders('contestant-1-sliders', 1);
      this.buildSliders('contestant-2-sliders', 2);
    }
  }

  /**
   * Calculate normalized score out of 100:
   * Score = 10 * Sum(score * weight) / Sum(enabled weights)
   */
  calculateNormalizedTotal(contestantNum) {
    let weightedSum = 0;
    let totalWeight = 0;

    this.categories.forEach((cat, idx) => {
      if (!cat.enabled) return;
      const scoreVal = this.scores[contestantNum][idx];
      const actualScore = scoreVal !== null ? scoreVal : 0;
      const w = cat.weight !== undefined ? cat.weight : 1.0;

      weightedSum += actualScore * w;
      totalWeight += w;
    });

    if (totalWeight <= 0) return 0;

    if (this.normalizeTo100) {
      const normalized = (10 * weightedSum) / totalWeight;
      return parseFloat(normalized.toFixed(2));
    } else {
      return parseFloat(weightedSum.toFixed(2));
    }
  }

  /** Weighted total (out of 100) for an arbitrary score list under the current rules */
  totalFor(scoreArray) {
    let weightedSum = 0;
    let totalWeight = 0;
    this.categories.forEach((cat, idx) => {
      if (!cat.enabled) return;
      const v = scoreArray?.[idx];
      const w = cat.weight !== undefined ? cat.weight : 1.0;
      weightedSum += (typeof v === 'number' && !isNaN(v) ? v : 0) * w;
      totalWeight += w;
    });
    if (totalWeight <= 0) return 0;
    const total = this.normalizeTo100 ? (10 * weightedSum) / totalWeight : weightedSum;
    return parseFloat(total.toFixed(2));
  }

  /** Show another judge's card without letting the host edit it (remote judges) */
  setReadOnly(readOnly) {
    this.readOnly = !!readOnly;
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.score-slider').forEach(s => { s.disabled = this.readOnly || this.locked; });
    document.querySelectorAll('.contestant-panel').forEach(p => p.classList.toggle('read-only', this.readOnly));
  }

  hasUnscoredCategories(contestantNum) {
    return this.categories.some((cat, idx) => {
      return cat.enabled && this.scores[contestantNum][idx] === null;
    });
  }

  getUnscoredCount(contestantNum) {
    return this.categories.filter((cat, idx) => {
      return cat.enabled && this.scores[contestantNum][idx] === null;
    }).length;
  }

  buildSliders(containerId, contestantNum) {
    const container = typeof document !== 'undefined' ? document.getElementById(containerId) : null;
    if (!container) return;

    container.innerHTML = '';

    this.categories.forEach((cat, idx) => {
      if (!cat.enabled) return;

      const row = document.createElement('div');
      row.className = 'slider-row';

      const labelWrap = document.createElement('div');
      labelWrap.className = 'slider-label-wrap';

      const label = document.createElement('span');
      label.className = 'slider-label';
      label.textContent = cat.name;

      // Category definition tooltip trigger
      if (cat.desc) {
        const infoBtn = document.createElement('button');
        infoBtn.type = 'button';
        infoBtn.className = 'cat-info-btn';
        infoBtn.innerHTML = 'ℹ️';
        infoBtn.title = `${cat.name}: ${cat.desc}`;
        labelWrap.appendChild(label);
        labelWrap.appendChild(infoBtn);
      } else {
        labelWrap.appendChild(label);
      }

      if (cat.weight !== 1.0) {
        const weightTag = document.createElement('span');
        weightTag.className = 'cat-weight-tag';
        weightTag.textContent = `${cat.weight}x`;
        labelWrap.appendChild(weightTag);
      }

      const track = document.createElement('div');
      track.className = 'slider-track';

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'score-slider';
      slider.id = `slider-${contestantNum}-${idx}`;
      slider.min = '0';
      slider.max = '10';
      slider.step = this.step.toString();

      const currentVal = this.scores[contestantNum][idx];
      slider.value = currentVal !== null ? currentVal.toString() : '0';
      slider.setAttribute('aria-label', `${cat.name} score for Contestant ${contestantNum}`);

      const valueDisplay = document.createElement('span');
      valueDisplay.className = 'slider-value';
      valueDisplay.id = `value-${contestantNum}-${idx}`;

      if (currentVal !== null) {
        valueDisplay.textContent = currentVal.toFixed(2);
        if (currentVal >= 8) valueDisplay.classList.add('hot');
      } else {
        valueDisplay.textContent = '—';
        valueDisplay.classList.add('unscored');
      }

      slider.disabled = !!(this.readOnly || this.locked);
      slider.addEventListener('input', (e) => {
        if (this.locked || this.readOnly) {
          e.target.value = (this.scores[contestantNum][idx] ?? 0).toString();
          return;
        }

        const val = parseFloat(e.target.value);
        this.scores[contestantNum][idx] = val;
        valueDisplay.textContent = val.toFixed(2);
        valueDisplay.classList.remove('unscored');

        if (val >= 8) {
          valueDisplay.classList.add('hot');
        } else {
          valueDisplay.classList.remove('hot');
        }

        this.updateSliderTrack(slider, val);
        this.updateTotal(contestantNum);

        if (this.onScoreChange) {
          this.onScoreChange(contestantNum, idx, val);
        }
      });

      this.updateSliderTrack(slider, currentVal !== null ? currentVal : 0);

      track.appendChild(slider);
      row.appendChild(labelWrap);
      row.appendChild(track);
      row.appendChild(valueDisplay);
      container.appendChild(row);
    });
  }

  /**
   * Weight editor: enable/disable each category and set its weight.
   * `onChange` fires after every edit so the host UI can resync.
   */
  buildWeightsEditor(containerId, onChange) {
    const container = typeof document !== 'undefined' ? document.getElementById(containerId) : null;
    if (!container) return;
    container.innerHTML = '';

    this.categories.forEach((cat, idx) => {
      const row = document.createElement('label');
      row.className = 'weight-row' + (cat.enabled ? '' : ' disabled');

      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = cat.enabled;
      toggle.setAttribute('aria-label', `Score ${cat.name}`);

      const name = document.createElement('span');
      name.className = 'weight-name';
      name.textContent = cat.name;

      const weight = document.createElement('input');
      weight.type = 'number';
      weight.min = '0';
      weight.max = '5';
      weight.step = '0.25';
      weight.value = cat.weight;
      weight.disabled = !cat.enabled;
      weight.setAttribute('aria-label', `${cat.name} weight`);

      toggle.addEventListener('change', () => {
        this.setCategoryEnabled(idx, toggle.checked);
        row.classList.toggle('disabled', !toggle.checked);
        weight.disabled = !toggle.checked;
        onChange?.();
      });
      weight.addEventListener('change', () => {
        this.setCategoryWeight(idx, weight.value);
        weight.value = this.categories[idx].weight;
        onChange?.();
      });

      row.append(toggle, name, weight);
      const unit = document.createElement('span');
      unit.className = 'weight-unit';
      unit.textContent = 'x';
      row.appendChild(unit);
      container.appendChild(row);
    });
  }

  updateSliderTrack(slider, value) {
    const pct = (value / MAX_SCORE_PER_CATEGORY) * 100;
    let color;
    if (value <= 3) {
      color = '#2563eb';
    } else if (value <= 6) {
      color = '#f59e0b';
    } else {
      color = '#ef4444';
    }
    slider.style.background = `linear-gradient(to right, ${color} 0%, ${color} ${pct}%, #1c1c24 ${pct}%, #1c1c24 100%)`;
  }

  updateTotal(contestantNum) {
    const total = this.calculateNormalizedTotal(contestantNum);
    const el = typeof document !== 'undefined' ? document.getElementById(`contestant-${contestantNum}-total`) : null;
    if (el) {
      el.textContent = total.toFixed(2);
    }
    return total;
  }

  getTotal(contestantNum) {
    return this.calculateNormalizedTotal(contestantNum);
  }

  getRawSum(contestantNum) {
    return this.scores[contestantNum].reduce((sum, s) => sum + (s !== null ? s : 0), 0);
  }

  getScores(contestantNum) {
    return this.scores[contestantNum].map(s => (s !== null ? s : 0));
  }

  setScores(contestantNum, scoreArray) {
    if (!scoreArray || !scoreArray.length) return;

    this.categories.forEach((cat, idx) => {
      const val = scoreArray[idx];
      const cleanVal = (val !== null && val !== undefined && !isNaN(val)) ? parseFloat(val) : null;
      this.scores[contestantNum][idx] = cleanVal;

      const slider = typeof document !== 'undefined' ? document.getElementById(`slider-${contestantNum}-${idx}`) : null;
      const valueEl = typeof document !== 'undefined' ? document.getElementById(`value-${contestantNum}-${idx}`) : null;

      if (slider) {
        slider.value = cleanVal !== null ? cleanVal.toString() : '0';
        this.updateSliderTrack(slider, cleanVal !== null ? cleanVal : 0);
      }
      if (valueEl) {
        if (cleanVal !== null) {
          valueEl.textContent = cleanVal.toFixed(2);
          valueEl.classList.remove('unscored');
          if (cleanVal >= 8) valueEl.classList.add('hot');
          else valueEl.classList.remove('hot');
        } else {
          valueEl.textContent = '—';
          valueEl.classList.add('unscored');
          valueEl.classList.remove('hot');
        }
      }
    });

    this.updateTotal(contestantNum);
    if (this.onScoreChange) {
      this.onScoreChange(contestantNum, 0, this.getTotal(contestantNum));
    }
  }

  getSnapshot() {
    return {
      scores1: this.getScores(1),
      scores2: this.getScores(2),
      total1: this.getTotal(1),
      total2: this.getTotal(2),
      rawSum1: this.getRawSum(1),
      rawSum2: this.getRawSum(2),
      unscored1: this.getUnscoredCount(1),
      unscored2: this.getUnscoredCount(2),
      rules: this.getRulesSnapshot(),
      categories: this.categories.map(c => c.name),
      timestamp: new Date().toISOString()
    };
  }

  lock() {
    this.locked = true;
    if (typeof document !== 'undefined') {
      document.querySelectorAll('.score-slider').forEach(s => {
        s.style.opacity = '0.6';
        s.style.pointerEvents = 'none';
      });
    }
  }

  reset() {
    this.locked = false;
    for (const num of [1, 2]) {
      this.scores[num] = new Array(this.categories.length).fill(null);
      this.categories.forEach((_, idx) => {
        const slider = typeof document !== 'undefined' ? document.getElementById(`slider-${num}-${idx}`) : null;
        const value = typeof document !== 'undefined' ? document.getElementById(`value-${num}-${idx}`) : null;
        if (slider) {
          slider.value = '0';
          slider.style.opacity = '1';
          slider.style.pointerEvents = 'auto';
          this.updateSliderTrack(slider, 0);
        }
        if (value) {
          value.textContent = '—';
          value.className = 'slider-value unscored';
        }
      });
      this.updateTotal(num);
    }
  }
}

export { ScoringEngine, CATEGORIES, DEFAULT_CATEGORY_DEFS, SCORING_PRESETS, MAX_SCORE_PER_CATEGORY };
