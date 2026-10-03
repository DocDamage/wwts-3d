/**
 * Pad Bank — the 20 performance pads on the DJ controller (10 per deck).
 *
 * Each pad plays a built-in effect, an announcer line, or the user's own sound
 * (uploaded file or a voice line recorded from the mic). Custom audio is kept
 * in IndexedDB so it survives reloads; pad layout lives in localStorage.
 *
 * Keys: 1–0 fire pads 1–10 (Deck 1 side), Shift+1–0 fire pads 11–20 (Deck 2 side).
 */

import { ANNOUNCER_BASE, ANNOUNCER_LINES } from './announcerLibrary.js';

const PAD_COUNT = 20;
const CONFIG_KEY = 'wwts_pads_v1';
const DB_NAME = 'wwts-pads';
const STORE = 'blobs';

const BUILTIN_SOUNDS = {
  airhorn: { label: 'Air Horn', url: '/sounds/airhorn.mp3' },
  bell: { label: 'Boxing Bell', url: '/sounds/bell.wav' },
  crowd_react: { label: 'Crowd Ooh', url: '/sounds/crowd_react.wav' },
  crowd_cheer: { label: 'Crowd Cheer', url: '/sounds/crowd_cheer.wav' },
  needle_drop: { label: 'Needle Drop', url: '/sounds/needle_drop.mp3' },
  needle_stop: { label: 'Record Stop', url: '/sounds/needle_stop.mp3' },
  timer_alarm: { label: 'Timer Alarm', url: '/sounds/timer_alarm.wav' },
  scratch: { label: 'Scratch (synth)', synth: true }
};

const PAD_COLORS = ['#ff2d2d', '#ff8a1a', '#ffd21a', '#3ddc84', '#00e5ff', '#3d7bff', '#b84dff', '#ff4fa3', '#ffffff'];

const ann = (file) => ({ type: 'announcer', file });
const fx = (key) => ({ type: 'builtin', key });

const DEFAULT_PADS = [
  // Deck 1 side
  { label: 'Air Horn', color: '#ff2d2d', source: fx('airhorn') },
  { label: 'Bell', color: '#ff8a1a', source: fx('bell') },
  { label: 'Crowd Ooh', color: '#ffd21a', source: fx('crowd_react') },
  { label: 'Cheer', color: '#3ddc84', source: fx('crowd_cheer') },
  { label: 'Needle Drop', color: '#00e5ff', source: fx('needle_drop') },
  { label: 'Record Stop', color: '#3d7bff', source: fx('needle_stop') },
  { label: 'Scratch', color: '#b84dff', source: fx('scratch') },
  { label: 'Fight!', color: '#ff2d2d', source: ann('fight.wav') },
  { label: 'Round 1', color: '#ffffff', source: ann('round1.wav') },
  { label: 'Knockout!', color: '#ff4fa3', source: ann('knockout.wav') },
  // Deck 2 side
  { label: 'Who Will Win?', color: '#00e5ff', source: ann('whowillwin.wav') },
  { label: 'Amazing!', color: '#3ddc84', source: ann('amazing.wav') },
  { label: 'Excellent!', color: '#ffd21a', source: ann('excellent.wav') },
  { label: 'Combo Breaker', color: '#ff8a1a', source: ann('combobreaker.wav') },
  { label: 'On Fire!', color: '#ff2d2d', source: ann('theyreonfire.wav') },
  { label: 'All On The Line', color: '#b84dff', source: ann('itsallontheline.wav') },
  { label: 'Battle of the Century', color: '#3d7bff', source: ann('battleofthecentury.wav') },
  { label: 'Untouchable!', color: '#ff4fa3', source: ann('untouchable.wav') },
  { label: 'Winner!', color: '#ffffff', source: ann('winner.wav') },
  { label: "Time's Up!", color: '#ffd21a', source: ann('timesup.wav') }
];

/* ---------------- IndexedDB blob store ---------------- */

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbOp(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

const blobStore = {
  put: (key, blob) => dbOp('readwrite', s => s.put(blob, key)),
  get: (key) => dbOp('readonly', s => s.get(key)),
  delete: (key) => dbOp('readwrite', s => s.delete(key))
};

/* ---------------- Pad bank ---------------- */

class PadBank {
  constructor(soundboard, audioPlayer) {
    this.soundboard = soundboard;
    this.audioPlayer = audioPlayer;
    this.pads = this.loadConfig();
    this.customUrls = {}; // blobKey -> object URL
    this.voices = {};     // pad index -> pool of Audio elements
    this.volume = 0.85;
    this.onTrigger = null; // (index, pad)
    this.onChange = null;  // () — pad labels/colors changed
    this.editingIndex = null;
    this.recorder = null;
    this.pendingSource = null;
  }

  loadConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
      if (Array.isArray(saved) && saved.length === PAD_COUNT) return saved;
    } catch {
      // ignore corrupt or blocked storage
    }
    return JSON.parse(JSON.stringify(DEFAULT_PADS));
  }

  saveConfig() {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(this.pads));
    } catch {
      // storage blocked — pads still work for this session
    }
  }

  async init() {
    await Promise.all(this.pads.map(async (pad) => {
      if (pad.source.type === 'custom') await this.loadCustomUrl(pad.source.blobKey);
    }));

    window.addEventListener('keydown', (e) => {
      const tag = e.target.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.altKey || e.ctrlKey || e.metaKey) return;
      const m = e.code.match(/^Digit(\d)$/);
      if (!m) return;
      const n = m[1] === '0' ? 10 : parseInt(m[1], 10);
      e.preventDefault();
      this.trigger(n - 1 + (e.shiftKey ? 10 : 0));
    });

    this.buildGrid();
    this.buildEditor();
    document.getElementById('btn-pad-edit-mode')?.addEventListener('click', (e) => {
      const grid = document.getElementById('pad-grid');
      grid?.classList.toggle('editing');
      e.currentTarget.classList.toggle('active', !!grid?.classList.contains('editing'));
    });
  }

  async loadCustomUrl(blobKey) {
    if (!blobKey || this.customUrls[blobKey]) return this.customUrls[blobKey];
    try {
      const blob = await blobStore.get(blobKey);
      if (blob) this.customUrls[blobKey] = URL.createObjectURL(blob);
    } catch (e) {
      console.warn('Pad sound unavailable:', e);
    }
    return this.customUrls[blobKey];
  }

  urlFor(source) {
    if (source.type === 'builtin') return BUILTIN_SOUNDS[source.key]?.url || null;
    if (source.type === 'announcer') return ANNOUNCER_BASE + source.file;
    if (source.type === 'custom') return this.customUrls[source.blobKey] || null;
    if (source.type === 'preview') return source.url;
    return null;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    this.soundboard?.setVolume(this.volume);
    Object.values(this.voices).flat().forEach(a => { a.volume = this.volume; });
  }

  trigger(index) {
    const pad = this.pads[index];
    if (!pad) return;
    this.playSource(pad.source, index);
    if (typeof this.onTrigger === 'function') this.onTrigger(index, pad);
    const el = document.querySelector(`.pad-btn[data-pad="${index}"]`);
    if (el) {
      el.classList.add('hit');
      setTimeout(() => el.classList.remove('hit'), 160);
    }
  }

  playSource(source, voiceKey = 'preview') {
    if (source.type === 'builtin' && BUILTIN_SOUNDS[source.key]?.synth) {
      this.audioPlayer?.playScratchSound(1);
      return;
    }
    if (source.type === 'builtin' && this.soundboard?.sounds[source.key]) {
      this.soundboard.play(source.key); // also fires the stage reaction
      return;
    }
    const url = this.urlFor(source);
    if (!url) return;
    const pool = this.voices[voiceKey] || (this.voices[voiceKey] = []);
    let audio = pool.find(a => (a.paused || a.ended) && a.dataset.src === url);
    if (!audio) {
      audio = new Audio(url);
      audio.dataset.src = url;
      pool.push(audio);
      if (pool.length > 6) pool.shift();
    }
    audio.volume = this.volume;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }

  /* ---------------- 2D pad grid (deck strip) ---------------- */

  buildGrid() {
    const grid = document.getElementById('pad-grid');
    if (!grid) return;
    grid.innerHTML = '';
    this.pads.forEach((pad, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pad-btn';
      btn.dataset.pad = i;
      btn.style.setProperty('--pad-color', pad.color);
      const key = i < 10 ? String((i + 1) % 10) : `⇧${(i - 9) % 10}`;
      btn.title = `${pad.label} — key ${key} · right-click to change`;
      btn.innerHTML = `<span class="pad-label">${this.escape(pad.label)}</span><span class="pad-key">${key}</span>`;
      btn.addEventListener('click', () => {
        if (grid.classList.contains('editing')) this.openEditor(i);
        else this.trigger(i);
      });
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.openEditor(i);
      });
      grid.appendChild(btn);
    });
    if (typeof this.onChange === 'function') this.onChange();
  }

  escape(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  /* ---------------- Pad editor ---------------- */

  buildEditor() {
    const modal = document.getElementById('pad-editor-modal');
    if (!modal) return;

    const library = document.getElementById('pad-library-select');
    const fxGroup = document.createElement('optgroup');
    fxGroup.label = 'Sound FX';
    Object.entries(BUILTIN_SOUNDS).forEach(([key, s]) => {
      fxGroup.appendChild(new Option(s.label, `builtin:${key}`));
    });
    const annGroup = document.createElement('optgroup');
    annGroup.label = `Announcer (${ANNOUNCER_LINES.length})`;
    ANNOUNCER_LINES.forEach(line => annGroup.appendChild(new Option(line.label, `announcer:${line.file}`)));
    library.append(new Option('— Pick from the library —', ''), fxGroup, annGroup);

    library.addEventListener('change', () => {
      if (!library.value) return;
      const [type, value] = library.value.split(/:(.+)/);
      this.pendingSource = type === 'builtin' ? fx(value) : ann(value);
      const labelInput = document.getElementById('pad-label-input');
      labelInput.value = library.selectedOptions[0].textContent.replace(/ \(synth\)$/, '');
      this.setEditorStatus(`Selected: ${labelInput.value}`);
      this.playSource(this.pendingSource);
    });

    document.getElementById('pad-upload-input')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await this.stageCustomBlob(file, file.name.replace(/\.[^/.]+$/, ''));
      e.target.value = '';
    });

    document.getElementById('btn-pad-record')?.addEventListener('click', () => this.toggleRecording());
    document.getElementById('btn-pad-preview')?.addEventListener('click', () => {
      this.playSource(this.pendingSource || this.pads[this.editingIndex].source);
    });
    document.getElementById('btn-pad-save')?.addEventListener('click', () => this.saveEditor());
    document.getElementById('btn-pad-default')?.addEventListener('click', () => {
      const d = DEFAULT_PADS[this.editingIndex];
      this.pendingSource = JSON.parse(JSON.stringify(d.source));
      document.getElementById('pad-label-input').value = d.label;
      this.selectColor(d.color);
      this.setEditorStatus('Restored the default sound — press Save to keep it.');
    });
    modal.querySelectorAll('[data-close="pad-editor-modal"]').forEach(b => b.addEventListener('click', () => this.closeEditor()));
    modal.addEventListener('click', (e) => { if (e.target === modal) this.closeEditor(); });

    const swatches = document.getElementById('pad-color-swatches');
    PAD_COLORS.forEach(c => {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'pad-swatch';
      sw.style.background = c;
      sw.dataset.color = c;
      sw.title = c;
      sw.addEventListener('click', () => this.selectColor(c));
      swatches.appendChild(sw);
    });
  }

  selectColor(c) {
    this.pendingColor = c;
    document.querySelectorAll('.pad-swatch').forEach(sw => sw.classList.toggle('active', sw.dataset.color === c));
  }

  setEditorStatus(text) {
    const el = document.getElementById('pad-editor-status');
    if (el) el.textContent = text;
  }

  openEditor(index) {
    const modal = document.getElementById('pad-editor-modal');
    if (!modal) return;
    this.editingIndex = index;
    this.pendingSource = null;
    const pad = this.pads[index];
    document.getElementById('pad-editor-title').textContent = `Pad ${index + 1} · ${index < 10 ? 'Deck 1 side' : 'Deck 2 side'}`;
    document.getElementById('pad-label-input').value = pad.label;
    document.getElementById('pad-library-select').value = '';
    this.selectColor(pad.color);
    this.setEditorStatus(`Current sound: ${this.describeSource(pad.source)}`);
    modal.style.display = 'flex';
  }

  closeEditor() {
    if (this.recorder?.state === 'recording') this.recorder.stop();
    const modal = document.getElementById('pad-editor-modal');
    if (modal) modal.style.display = 'none';
    this.editingIndex = null;
  }

  describeSource(source) {
    if (source.type === 'builtin') return BUILTIN_SOUNDS[source.key]?.label || source.key;
    if (source.type === 'announcer') return `Announcer: ${ANNOUNCER_LINES.find(l => l.file === source.file)?.label || source.file}`;
    if (source.type === 'custom') return 'Your own sound';
    return 'Unknown';
  }

  /** Keep an uploaded/recorded blob as the pending sound (saved to IndexedDB on Save) */
  async stageCustomBlob(blob, label) {
    const blobKey = `pad-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.pendingBlob = { blobKey, blob };
    const url = URL.createObjectURL(blob);
    this.customUrls[blobKey] = url;
    this.pendingSource = { type: 'custom', blobKey };
    if (label) document.getElementById('pad-label-input').value = label.slice(0, 24);
    this.setEditorStatus('New sound ready — preview it, then press Save.');
    this.playSource({ type: 'preview', url });
  }

  async toggleRecording() {
    const btn = document.getElementById('btn-pad-record');
    if (this.recorder?.state === 'recording') {
      this.recorder.stop();
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.setEditorStatus('Microphone access was blocked — allow it in the browser to record voice lines.');
      return;
    }
    const chunks = [];
    this.recorder = new MediaRecorder(stream);
    this.recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    this.recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      clearInterval(this._recTimer);
      btn.classList.remove('recording');
      btn.textContent = '🎙️ Record Voice Line';
      if (!chunks.length) return;
      await this.stageCustomBlob(new Blob(chunks, { type: this.recorder.mimeType }), 'My Voice Line');
    };
    this.recorder.start();
    btn.classList.add('recording');
    const started = Date.now();
    btn.textContent = '⏹ Stop (0s)';
    this._recTimer = setInterval(() => {
      const secs = Math.floor((Date.now() - started) / 1000);
      btn.textContent = `⏹ Stop (${secs}s)`;
      if (secs >= 15) this.recorder.stop(); // keep voice lines short
    }, 250);
    this.setEditorStatus('Recording… speak your line, then press Stop.');
  }

  async saveEditor() {
    const i = this.editingIndex;
    if (i === null) return;
    const pad = this.pads[i];
    const oldSource = pad.source;
    if (this.pendingBlob && this.pendingSource?.blobKey === this.pendingBlob.blobKey) {
      try {
        await blobStore.put(this.pendingBlob.blobKey, this.pendingBlob.blob);
      } catch {
        this.setEditorStatus('Couldn’t save the sound to this browser’s storage — it will work until you reload.');
      }
    }
    if (this.pendingSource) pad.source = this.pendingSource;
    pad.label = document.getElementById('pad-label-input').value.trim().slice(0, 24) || pad.label;
    pad.color = this.pendingColor || pad.color;
    this.pendingBlob = null;

    // Drop the old custom blob if nothing else uses it
    if (oldSource.type === 'custom' && oldSource.blobKey !== pad.source.blobKey &&
        !this.pads.some(p => p.source.blobKey === oldSource.blobKey)) {
      blobStore.delete(oldSource.blobKey).catch(() => {});
    }
    this.saveConfig();
    this.buildGrid();
    this.closeEditor();
  }
}

export { PadBank, PAD_COUNT, DEFAULT_PADS, BUILTIN_SOUNDS, PAD_COLORS };
