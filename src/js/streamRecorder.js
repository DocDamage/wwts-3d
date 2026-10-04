/**
 * Built-in recording: the 3D stage plus the master audio (decks, pads, flip
 * samples) to a WebM file, straight from the browser. With "auto highlights"
 * on, every time a producer's beat starts a 30-second clip is cut from just
 * after the intro — ready for socials.
 *
 * Recordings live in memory until downloaded (the panel lists them); the
 * announcer and soundboard voices play outside the mix and aren't captured.
 */

const HIGHLIGHT_SKIP = 15;     // seconds into the beat before the highlight starts
const HIGHLIGHT_LEN = 30;

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  return ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)) || '';
}

class StreamRecorder {
  constructor({ djController, audio, getRound, getName, toast, download }) {
    Object.assign(this, { dj: djController, audio, getRound, getName, toast: toast || (() => {}), download });
    this.rec = null;
    this.chunks = [];
    this.startedAt = 0;
    this.items = [];          // { name, url, size, kind: 'full'|'highlight', at }
    this.highlights = true;
    this.pending = {};        // deck -> { timer, rec }
    try { this.highlights = localStorage.getItem('wwts_rec_highlights') !== 'off'; } catch { /* default on */ }
  }

  get supported() { return pickMime() !== null && !!this.dj?.renderer?.domElement?.captureStream; }

  init() {
    this.btn = document.getElementById('btn-record');
    this.btn?.addEventListener('click', () => this.toggle());
    this.modal = document.getElementById('rec-modal');
    document.getElementById('btn-recordings')?.addEventListener('click', () => this.open());
    this.modal?.addEventListener('click', (e) => {
      if (e.target === this.modal || e.target.closest('[data-close="rec-modal"]')) this.modal.style.display = 'none';
      const dl = e.target.closest('[data-dl]');
      if (dl) { const it = this.items[Number(dl.dataset.dl)]; if (it) this.save(it); }
      const del = e.target.closest('[data-del]');
      if (del) { const [it] = this.items.splice(Number(del.dataset.del), 1); if (it) URL.revokeObjectURL(it.url); this.render(); document.getElementById('btn-recordings').dataset.count = this.items.length ? String(this.items.length) : ''; }
    });
    document.getElementById('rec-highlights')?.addEventListener('change', (e) => {
      this.highlights = e.target.checked;
      try { localStorage.setItem('wwts_rec_highlights', this.highlights ? 'on' : 'off'); } catch { /* ignore */ }
    });
    document.getElementById('rec-all')?.addEventListener('click', () => this.items.forEach((it, i) => setTimeout(() => this.save(it), i * 400)));
    if (!this.supported && this.btn) { this.btn.disabled = true; this.btn.title = 'Recording needs a Chromium-based browser (Chrome / Edge)'; }
    // don't lose a recording to a stray reload
    window.addEventListener('beforeunload', (e) => { if (this.rec || this.items.some(i => !i.saved)) { e.preventDefault(); e.returnValue = ''; } });
  }

  /** Stage video + master audio as one stream */
  stream() {
    const canvas = this.dj.renderer.domElement;
    const video = canvas.captureStream(30);
    const audioStream = this.audio.getRecordStream();
    const tracks = [...video.getVideoTracks(), ...(audioStream ? audioStream.getAudioTracks() : [])];
    return new MediaStream(tracks);
  }

  toggle() {
    if (this.rec) this.stop();
    else this.start();
  }

  start() {
    if (!this.supported) return this.toast('Recording needs Chrome or Edge');
    if (this.rec) return;
    const mime = pickMime();
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream(), { mimeType: mime || undefined, videoBitsPerSecond: 6_000_000 });
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.onstop = () => {
      const blob = new Blob(this.chunks, { type: 'video/webm' });
      this.add(`WWTS-${new Date(this.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.webm`, blob, 'full');
      this.chunks = [];
    };
    this.rec.start(1000);
    this.startedAt = Date.now();
    this.tick = setInterval(() => this.renderButton(), 1000);
    this.renderButton();
    this.toast('⏺ Recording the show');
  }

  stop() {
    if (!this.rec) return;
    this.rec.stop();
    this.rec = null;
    clearInterval(this.tick);
    this.renderButton();
    this.toast('⏹ Recording saved — open 🎞 Recordings to download');
  }

  /** A deck started / stopped (battle beats) — cut a highlight */
  onDeck(num, playing) {
    if (!this.supported || !this.highlights) return;
    const p = this.pending[num];
    if (!playing) {
      if (p?.timer) { clearTimeout(p.timer); delete this.pending[num]; }
      if (p?.rec && p.rec.state === 'recording') p.rec.stop();
      return;
    }
    if (p) return;   // already counting / recording for this deck
    const round = this.getRound();
    const name = this.getName(num);
    const entry = { timer: null, rec: null };
    this.pending[num] = entry;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      const chunks = [];
      const rec = new MediaRecorder(this.stream(), { mimeType: pickMime() || undefined, videoBitsPerSecond: 5_000_000 });
      entry.rec = rec;
      const t0 = Date.now();
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        delete this.pending[num];
        if (Date.now() - t0 < 5000) return;   // too short to keep
        const safe = String(name).replace(/[^a-z0-9]+/gi, '_').slice(0, 30);
        this.add(`${round === 4 ? 'OT' : `R${round}`}-${safe}-highlight.webm`, new Blob(chunks, { type: 'video/webm' }), 'highlight');
      };
      rec.start(1000);
      setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, HIGHLIGHT_LEN * 1000);
    }, HIGHLIGHT_SKIP * 1000);
  }

  add(name, blob, kind) {
    this.items.push({ name, url: URL.createObjectURL(blob), size: blob.size, kind, at: Date.now() });
    this.render();
    const btn = document.getElementById('btn-recordings');
    if (btn) btn.dataset.count = String(this.items.length);
  }

  save(it) {
    it.saved = true;
    const a = document.createElement('a');
    a.href = it.url;
    a.download = it.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  open() {
    this.render();
    if (this.modal) this.modal.style.display = '';
  }

  renderButton() {
    if (!this.btn) return;
    this.btn.classList.toggle('recording', !!this.rec);
    if (this.rec) {
      const s = Math.floor((Date.now() - this.startedAt) / 1000);
      this.btn.textContent = `⏹ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    } else this.btn.textContent = '⏺ Rec';
  }

  render() {
    const hl = document.getElementById('rec-highlights');
    if (hl) hl.checked = this.highlights;
    const list = document.getElementById('rec-list');
    if (!list) return;
    list.innerHTML = this.items.length ? this.items.map((it, i) => `<li><span>${it.kind === 'highlight' ? '✂️' : '🎞'} ${esc(it.name)} <small>${(it.size / 1048576).toFixed(1)} MB</small></span>
      <span><button type="button" class="fs-small" data-dl="${i}">⬇ Download</button><button type="button" class="fs-small" data-del="${i}" aria-label="Discard">✕</button></span></li>`).join('')
      : '<li class="profile-muted">Nothing recorded yet. Press ⏺ Rec on the host desk.</li>';
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export { StreamRecorder };
