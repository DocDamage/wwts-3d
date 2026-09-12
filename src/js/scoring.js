/**
 * Scoring Engine — manages dual contestant scoring with 10 categories
 * Decimal precision (0.1 step), max 100.0 per contestant
 */

const CATEGORIES = [
  'Creativity',
  'Versatility',
  'Mix',
  'Drums',
  'Melody',
  'Bassline',
  'Energy',
  'Battle Ability',
  'Arrangement',
  'Sound Selection'
];

const MAX_SCORE_PER_CATEGORY = 10;

class ScoringEngine {
  constructor() {
    this.scores = {
      1: new Array(CATEGORIES.length).fill(0),
      2: new Array(CATEGORIES.length).fill(0)
    };
    this.locked = false;
    this.onScoreChange = null;
  }

  /**
   * Build slider DOM for a contestant panel
   */
  buildSliders(containerId, contestantNum) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    CATEGORIES.forEach((cat, idx) => {
      const row = document.createElement('div');
      row.className = 'slider-row';

      const label = document.createElement('span');
      label.className = 'slider-label';
      label.textContent = cat;

      const track = document.createElement('div');
      track.className = 'slider-track';

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'score-slider';
      slider.id = `slider-${contestantNum}-${idx}`;
      slider.min = '0';
      slider.max = '10';
      slider.step = '0.1';
      slider.value = '0';
      slider.setAttribute('aria-label', `${cat} score for Contestant ${contestantNum}`);

      const valueDisplay = document.createElement('span');
      valueDisplay.className = 'slider-value';
      valueDisplay.id = `value-${contestantNum}-${idx}`;
      valueDisplay.textContent = '0.0';

      slider.addEventListener('input', (e) => {
        if (this.locked) {
          e.target.value = this.scores[contestantNum][idx];
          return;
        }
        const val = parseFloat(e.target.value);
        this.scores[contestantNum][idx] = val;
        valueDisplay.textContent = val.toFixed(1);

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

      this.updateSliderTrack(slider, 0);

      track.appendChild(slider);
      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(valueDisplay);
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
    const total = this.scores[contestantNum].reduce((sum, s) => sum + s, 0);
    const el = document.getElementById(`contestant-${contestantNum}-total`);
    if (el) {
      el.textContent = total.toFixed(1);
    }
    return total;
  }

  getTotal(contestantNum) {
    return this.scores[contestantNum].reduce((sum, s) => sum + s, 0);
  }

  getScores(contestantNum) {
    return [...this.scores[contestantNum]];
  }

  setScores(contestantNum, scoreArray) {
    if (!scoreArray || !scoreArray.length) return;
    this.scores[contestantNum] = [...scoreArray];
    CATEGORIES.forEach((_, idx) => {
      const val = scoreArray[idx] || 0;
      const slider = document.getElementById(`slider-${contestantNum}-${idx}`);
      const value = document.getElementById(`value-${contestantNum}-${idx}`);
      if (slider) {
        slider.value = val.toString();
        this.updateSliderTrack(slider, val);
      }
      if (value) {
        value.textContent = val.toFixed(1);
        if (val >= 8) value.classList.add('hot');
        else value.classList.remove('hot');
      }
    });
    this.updateTotal(contestantNum);
    if (this.onScoreChange) {
      this.onScoreChange(contestantNum, 0, this.getTotal(contestantNum));
    }
  }

  getSnapshot() {
    return {
      scores1: [...this.scores[1]],
      scores2: [...this.scores[2]],
      total1: this.getTotal(1),
      total2: this.getTotal(2),
      categories: [...CATEGORIES],
      timestamp: new Date().toISOString()
    };
  }

  lock() {
    this.locked = true;
    document.querySelectorAll('.score-slider').forEach(s => {
      s.style.opacity = '0.6';
      s.style.pointerEvents = 'none';
    });
  }

  reset() {
    this.locked = false;
    for (const num of [1, 2]) {
      this.scores[num].fill(0);
      CATEGORIES.forEach((_, idx) => {
        const slider = document.getElementById(`slider-${num}-${idx}`);
        const value = document.getElementById(`value-${num}-${idx}`);
        if (slider) {
          slider.value = '0';
          slider.style.opacity = '1';
          slider.style.pointerEvents = 'auto';
          this.updateSliderTrack(slider, 0);
        }
        if (value) {
          value.textContent = '0.0';
          value.classList.remove('hot');
        }
      });
      this.updateTotal(num);
    }
  }
}

export { ScoringEngine, CATEGORIES, MAX_SCORE_PER_CATEGORY };
