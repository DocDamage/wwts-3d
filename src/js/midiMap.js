/**
 * MIDI controller mapping with "learn": pick an action, move a knob or hit a
 * pad on the controller, done. Notes / pads fire 'press' actions; CC knobs and
 * faders drive 'range' actions (or fire presses when they cross the middle).
 * Mappings are saved per browser.
 */

const MAP_KEY = 'wwts_midi_map_v1';

class MidiMapper {
  constructor(actions, { toast } = {}) {
    this.actions = actions;
    this.toast = toast || (() => {});
    this.map = this.load();       // "type:channel:number" -> actionId
    this.learning = null;         // actionId waiting for a control
    this.access = null;
    this.ccState = {};
  }

  load() {
    try { return JSON.parse(localStorage.getItem(MAP_KEY) || '{}') || {}; } catch { return {}; }
  }

  save() {
    try { localStorage.setItem(MAP_KEY, JSON.stringify(this.map)); } catch { /* storage blocked */ }
  }

  async connect() {
    if (!navigator.requestMIDIAccess) { this.status = 'This browser has no Web MIDI (use Chrome or Edge).'; return false; }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      this.status = 'MIDI access was blocked.';
      return false;
    }
    const wire = () => {
      this.access.inputs.forEach(input => { input.onmidimessage = (e) => this.onMessage(e); });
      this.render?.();
    };
    this.access.onstatechange = wire;
    wire();
    this.status = null;
    return true;
  }

  devices() {
    return this.access ? [...this.access.inputs.values()].map(i => i.name) : [];
  }

  onMessage(e) {
    const [st, d1, d2] = e.data;
    const type = st & 0xf0;
    const ch = st & 0x0f;
    let key;
    let value = null;
    let pressed = false;
    if (type === 0x90 && d2 > 0) { key = `note:${ch}:${d1}`; pressed = true; value = d2 / 127; }
    else if (type === 0x80 || (type === 0x90 && d2 === 0)) return;
    else if (type === 0xb0) { key = `cc:${ch}:${d1}`; value = d2 / 127; }
    else return;
    if (this.learning) {
      // one control -> one action
      Object.keys(this.map).forEach(k => { if (this.map[k] === this.learning) delete this.map[k]; });
      this.map[key] = this.learning;
      this.save();
      this.toast(`Mapped ${this.describe(key)} → ${this.actions.byId[this.learning]?.label}`);
      this.learning = null;
      this.render?.();
      return;
    }
    const id = this.map[key];
    const a = id && this.actions.byId[id];
    if (!a) return;
    if (a.kind === 'range') a.fn(value);
    else if (pressed) a.fn();
    else if (key.startsWith('cc:')) {
      // buttons sending CC: fire on the press edge
      const prev = this.ccState[key] || 0;
      this.ccState[key] = value;
      if (value >= 0.5 && prev < 0.5) a.fn();
    }
  }

  describe(key) {
    const [type, ch, num] = key.split(':');
    return `${type === 'note' ? 'Pad/key' : 'Knob/fader'} ${num} (ch ${Number(ch) + 1})`;
  }

  keyFor(actionId) {
    return Object.keys(this.map).find(k => this.map[k] === actionId) || null;
  }

  learn(actionId) {
    this.learning = this.learning === actionId ? null : actionId;
    this.render?.();
  }

  unmap(actionId) {
    const k = this.keyFor(actionId);
    if (k) { delete this.map[k]; this.save(); this.render?.(); }
  }
}

class MidiPanel {
  constructor(mapper, actions) {
    this.mapper = mapper;
    this.actions = actions;
    mapper.render = () => this.render();
  }

  init() {
    this.modal = document.getElementById('midi-modal');
    if (!this.modal) return;
    this.modal.addEventListener('tool-open', async () => {
      if (!this.mapper.access) await this.mapper.connect();
      this.render();
    });
    document.getElementById('midi-filter')?.addEventListener('input', () => this.render());
  }

  render() {
    if (!this.modal || this.modal.style.display === 'none') return;
    const devs = this.mapper.devices();
    document.getElementById('midi-status').textContent = this.mapper.status || (devs.length ? `Connected: ${devs.join(', ')}` : 'No MIDI controller found — plug one in (it appears here automatically).');
    const f = (document.getElementById('midi-filter')?.value || '').toLowerCase();
    const list = document.getElementById('midi-list');
    const groups = {};
    this.actions.list.filter(a => !f || a.label.toLowerCase().includes(f) || a.group.toLowerCase().includes(f)).forEach(a => { (groups[a.group] = groups[a.group] || []).push(a); });
    list.innerHTML = Object.entries(groups).map(([g, items]) => `<li class="midi-group">${g}</li>` + items.map(a => {
      const key = this.mapper.keyFor(a.id);
      const learning = this.mapper.learning === a.id;
      return `<li class="midi-row ${learning ? 'learning' : ''}">
        <span class="midi-label">${a.label}${a.kind === 'range' ? ' <small>(knob/fader)</small>' : ''}</span>
        <code class="midi-id" title="Stream Deck / Companion: GET /api/cmd?action=${a.id}${a.kind === 'range' ? '&arg=0..1' : ''}">${a.id}</code>
        <span class="midi-bind">${learning ? 'Move a control…' : key ? this.mapper.describe(key) : '—'}</span>
        <button type="button" class="fs-small" data-learn="${a.id}">${learning ? 'Cancel' : 'Learn'}</button>
        ${key ? `<button type="button" class="fs-small" data-unmap="${a.id}" aria-label="Remove mapping">✕</button>` : ''}
      </li>`;
    }).join('')).join('');
    list.querySelectorAll('[data-learn]').forEach(b => b.addEventListener('click', () => this.mapper.learn(b.dataset.learn)));
    list.querySelectorAll('[data-unmap]').forEach(b => b.addEventListener('click', () => this.mapper.unmap(b.dataset.unmap)));
    const base = `${location.protocol}//localhost${location.port ? ':' + location.port : ''}`;
    document.getElementById('midi-http').textContent = `${base}/api/cmd?action=fx.smoke`;
  }
}

export { MidiMapper, MidiPanel };
