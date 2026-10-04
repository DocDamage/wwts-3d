/**
 * Event settings (⚙ Tools → Event settings): the fairness and format switches
 * for tonight's battles, saved per browser and carried by event templates.
 *
 *   roundSeconds     how long each beat gets per round
 *   timeLimit        'stop' (hard stop at 0:00) · 'fade' (3 s fade-out) · 'overrun' (keeps playing,
 *                    penalty points per started 10 s over)
 *   penaltyPer10s    points off that producer's round total per started 10 s over
 *   loudness         match playback loudness (target LUFS) so the louder master doesn't win
 *   anonymizeBeats   decks show "Beat A / Beat B", never file names
 *   coinFlip         flip for who plays first; the order alternates each round
 *   normalizeJudges  scale each judge's scores using the calibration round
 *   judgeComments    judges can leave a note per category
 *   closeMargin      judges are asked for a reason when their margin is under this
 *   showGuides       show what each score range means while scoring
 */

const STORE = 'wwts_event_settings_v1';

const DEFAULTS = {
  roundSeconds: 180,
  timeLimit: 'stop',
  penaltyPer10s: 1,
  loudness: true,
  loudnessTarget: -14,
  anonymizeBeats: true,
  coinFlip: true,
  normalizeJudges: false,
  judgeComments: true,
  closeMargin: 2,
  showGuides: true
};

class EventSettings {
  constructor() {
    this.s = { ...DEFAULTS };
    try { Object.assign(this.s, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch { /* defaults */ }
    this.listeners = new Set();
  }

  get(key) { return this.s[key]; }

  all() { return { ...this.s }; }

  set(key, value) {
    if (!(key in DEFAULTS)) return;
    this.s[key] = value;
    this.save();
    this.listeners.forEach(fn => fn(key, value));
  }

  /** Apply many at once (templates) */
  apply(values = {}) {
    Object.entries(values).forEach(([k, v]) => { if (k in DEFAULTS) this.s[k] = v; });
    this.save();
    Object.keys(values).forEach(k => { if (k in DEFAULTS) this.listeners.forEach(fn => fn(k, this.s[k])); });
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  save() {
    try { localStorage.setItem(STORE, JSON.stringify(this.s)); } catch { /* storage blocked */ }
  }
}

/** The settings modal */
class EventSettingsPanel {
  constructor(settings) {
    this.settings = settings;
  }

  init() {
    this.modal = document.getElementById('event-settings-modal');
    if (!this.modal) return;
    this.modal.addEventListener('tool-open', () => this.render());
    this.modal.addEventListener('change', (e) => {
      const el = e.target;
      const key = el.dataset.setting;
      if (!key) return;
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.type === 'number' || el.dataset.num) v = Number(v);
      if (key === 'roundSeconds') v = Math.max(15, Math.min(900, v || 180));
      this.settings.set(key, v);
      this.render();
    });
    this.render();
  }

  render() {
    if (!this.modal) return;
    this.modal.querySelectorAll('[data-setting]').forEach(el => {
      const v = this.settings.get(el.dataset.setting);
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = String(v);
    });
    const pen = this.modal.querySelector('.es-penalty');
    if (pen) pen.hidden = this.settings.get('timeLimit') !== 'overrun';
  }
}

export { EventSettings, EventSettingsPanel, DEFAULTS as EVENT_DEFAULTS };
