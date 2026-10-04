/**
 * Recorded sound effects (Kenney CC0 packs in public/sounds/sfx): punches,
 * body hits, blocks, thuds and footsteps for the fights, clicks and toggles
 * for the interface. Each name maps to a few takes; a random one plays with a
 * slight pitch wobble so repeats don't sound robotic.
 */

const BASE = '/sounds/sfx/';
const takes = (stem, n = 5, start = 0) => Array.from({ length: n }, (_, i) => `${stem}_${String(start + i).padStart(3, '0')}.mp3`);

const BANK = {
  punch: takes('impactPunch_medium'),
  heavy: takes('impactPunch_heavy'),
  body: takes('impactSoft_medium'),
  bodyHeavy: takes('impactSoft_heavy'),
  light: takes('impactGeneric_light'),
  block: takes('impactPlate_light'),
  thud: takes('impactWood_heavy'),
  step: takes('footstep_concrete'),
  click: takes('click', 3, 1),
  select: takes('select', 3, 1),
  confirm: takes('confirmation', 2, 1),
  toggle: takes('toggle', 2, 1),
  open: ['open_001.mp3'],
  close: ['close_001.mp3'],
  error: ['error_001.mp3'],
  drop: ['drop_002.mp3']
};

class Sfx {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.loading = null;
    this.volume = 0.8;
    this.ui = true;
  }

  ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.out = this.ctx.createGain();
        this.out.gain.value = this.volume;
        this.out.connect(this.ctx.destination);
      } catch {
        return false;
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (!this.loading) this.loading = this.load();
    return true;
  }

  async load() {
    const files = [...new Set(Object.values(BANK).flat())];
    await Promise.all(files.map(async f => {
      try {
        const res = await fetch(BASE + f);
        this.buffers[f] = await this.ctx.decodeAudioData(await res.arrayBuffer());
      } catch { /* missing take: skipped */ }
    }));
  }

  /** Play a named effect; returns false if it isn't loaded (callers can fall back to synth) */
  play(name, { volume = 1, rate = 1, wobble = 0.06 } = {}) {
    if (!this.ensure()) return false;
    const list = (BANK[name] || []).filter(f => this.buffers[f]);
    if (!list.length) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[list[Math.floor(Math.random() * list.length)]];
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * wobble);
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.out);
    src.start();
    return true;
  }

  uiSound(name) {
    if (this.ui) this.play(name, { volume: 0.25, wobble: 0.02 });
  }

  setVolume(v) {
    this.volume = v;
    if (this.out) this.out.gain.value = v;
  }
}

const sfx = new Sfx();
export { sfx, BANK };
