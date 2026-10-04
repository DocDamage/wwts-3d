/**
 * Accessibility settings (⚙ Tools → Accessibility), saved per browser:
 *  - reduced motion and no-flash (also the stage buttons; first visit follows the
 *    system "reduce motion" setting)
 *  - interface sounds on/off and effects volume
 *  - announcer captions (every line the announcer says, on screen)
 *  - colour palettes: default red/cyan, colour-blind safe orange/blue, high contrast
 *  - always-visible focus outlines for keyboard users
 *  - a screen-reader live region other modules can talk through (a11y.say)
 */
import { sfx } from './sfx.js';

const STORE = 'wwts_a11y_v1';

const DEFAULTS = {
  reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  noFlash: false,
  uiSounds: true,
  sfxVolume: 0.8,
  captions: false,
  palette: 'default',
  focusRings: false
};

class Accessibility {
  constructor({ djController } = {}) {
    this.dj = djController;
    this.s = { ...DEFAULTS };
    try { Object.assign(this.s, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch { /* defaults */ }
    this.captionTimer = null;
  }

  init() {
    this.live = document.createElement('div');
    this.live.className = 'sr-only';
    this.live.setAttribute('aria-live', 'polite');
    this.live.id = 'a11y-live';
    document.body.appendChild(this.live);

    this.captionEl = document.createElement('div');
    this.captionEl.className = 'a11y-caption';
    this.captionEl.setAttribute('aria-hidden', 'true');   // the live region speaks it
    this.captionEl.hidden = true;
    document.body.appendChild(this.captionEl);
    window.addEventListener('wwts-announce', (e) => this.onAnnounce(e.detail));

    // the stage's own motion / flash buttons stay in sync with these settings
    document.getElementById('btn-toggle-motion')?.addEventListener('click', () => this.set('reducedMotion', !this.s.reducedMotion), true);
    document.getElementById('btn-toggle-flash')?.addEventListener('click', () => this.set('noFlash', !this.s.noFlash), true);

    const modal = document.getElementById('a11y-modal');
    modal?.addEventListener('tool-open', () => this.render());
    modal?.addEventListener('change', (e) => {
      const el = e.target;
      if (!el.dataset.a11y) return;
      const v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) / 100 : el.value;
      this.set(el.dataset.a11y, v);
    });
    modal?.querySelector('#a11y-test-caption')?.addEventListener('click', () => this.onAnnounce({ text: 'Here comes a new challenger!' }, true));
    this.applyAll();
  }

  set(key, value) {
    this.s[key] = value;
    try { localStorage.setItem(STORE, JSON.stringify(this.s)); } catch { /* storage blocked */ }
    this.apply(key);
  }

  applyAll() {
    Object.keys(DEFAULTS).forEach(k => this.apply(k));
  }

  apply(key) {
    const v = this.s[key];
    const body = document.body;
    if (key === 'reducedMotion') {
      body.classList.toggle('reduced-motion', !!v);
      this.dj?.setReducedMotion?.(!!v);
      document.getElementById('btn-toggle-motion')?.classList.toggle('active', !!v);
    } else if (key === 'noFlash') {
      body.classList.toggle('no-flash', !!v);
      this.dj?.setNoFlash?.(!!v);
      document.getElementById('btn-toggle-flash')?.classList.toggle('active', !!v);
    } else if (key === 'uiSounds') {
      sfx.ui = !!v;
    } else if (key === 'sfxVolume') {
      sfx.volume = Math.max(0, Math.min(1, Number(v) || 0));
    } else if (key === 'palette') {
      body.dataset.palette = v || 'default';
    } else if (key === 'focusRings') {
      body.classList.toggle('focus-rings', !!v);
    } else if (key === 'captions' && !v && this.captionEl) {
      this.captionEl.hidden = true;
    }
  }

  render() {
    const modal = document.getElementById('a11y-modal');
    if (!modal) return;
    modal.querySelectorAll('[data-a11y]').forEach(el => {
      const v = this.s[el.dataset.a11y];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'range') el.value = String(Math.round(v * 100));
      else el.value = v;
    });
  }

  onAnnounce({ text } = {}, force = false) {
    if (!text) return;
    this.say(text);
    if (!this.s.captions && !force) return;
    this.captionEl.textContent = text;
    this.captionEl.hidden = false;
    clearTimeout(this.captionTimer);
    this.captionTimer = setTimeout(() => { this.captionEl.hidden = true; }, 2600);
  }

  /** Read something out to screen-reader users */
  say(text) {
    if (!this.live) return;
    this.live.textContent = '';
    // a fresh node each time so repeated lines are still announced
    requestAnimationFrame(() => { this.live.textContent = text; });
  }
}

export { Accessibility };
