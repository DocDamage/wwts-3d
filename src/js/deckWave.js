/**
 * Deck waveforms: the loaded beat's waveform with a beat grid, playhead and
 * click-to-seek, its detected BPM and key (with Camelot code), and four hot
 * cues per track (saved per track title).
 *
 * Hot cues: click to jump · Shift+click or long-press to set · right-click to clear
 */

const CUE_KEY = 'wwts_hot_cues_v1';
const CUE_COLORS = ['#ff3b30', '#ffd21a', '#2ecc71', '#26d4ff'];

class DeckWaveforms {
  constructor(audio) {
    this.audio = audio;
    this.cues = this.loadCues();
  }

  loadCues() {
    try { return JSON.parse(localStorage.getItem(CUE_KEY) || '{}') || {}; } catch { return {}; }
  }

  saveCues() {
    try { localStorage.setItem(CUE_KEY, JSON.stringify(this.cues)); } catch { /* storage blocked */ }
  }

  trackId(num) {
    return this.audio.players[num]?.title || `deck${num}`;
  }

  init() {
    [1, 2].forEach(num => this.build(num));
    this.audio.onTrackAnalyzed = (num) => this.renderInfo(num);
    const loop = () => {
      if (!document.hidden) [1, 2].forEach(n => this.draw(n));
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  build(num) {
    const controls = document.querySelector(`.audio-controls[data-player="${num}"]`);
    if (!controls || document.getElementById(`deck-wave-${num}`)) return;
    const wrap = document.createElement('div');
    wrap.className = 'deck-wave';
    wrap.id = `deck-wave-${num}`;
    wrap.innerHTML = `
      <canvas class="deck-wave-canvas" width="600" height="56" role="slider" tabindex="0" aria-label="Deck ${num} position — click to jump" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></canvas>
      <div class="deck-wave-row">
        <span class="deck-bpm" title="Detected tempo">— BPM</span>
        <span class="deck-key" title="Detected key (Camelot code for harmonic mixing)">—</span>
        <span class="deck-cues" role="group" aria-label="Hot cues">${[0, 1, 2, 3].map(i => `<button type="button" class="deck-cue" data-cue="${i}" style="--cue:${CUE_COLORS[i]}" title="Hot cue ${i + 1}: click to jump · Shift+click to set · right-click to clear">${i + 1}</button>`).join('')}</span>
      </div>`;
    controls.insertAdjacentElement('afterend', wrap);
    const canvas = wrap.querySelector('canvas');
    canvas.addEventListener('click', (e) => {
      const p = this.audio.players[num];
      const d = p?.audio?.duration;
      if (!d) return;
      const r = canvas.getBoundingClientRect();
      this.audio.seek(num, ((e.clientX - r.left) / r.width) * d);
    });
    canvas.addEventListener('keydown', (e) => {
      const p = this.audio.players[num];
      if (!p?.audio?.duration) return;
      const step = e.shiftKey ? 10 : 2;
      if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); this.audio.seek(num, p.audio.currentTime + step); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); this.audio.seek(num, Math.max(0, p.audio.currentTime - step)); }
    });
    wrap.querySelectorAll('.deck-cue').forEach(btn => {
      const i = Number(btn.dataset.cue);
      let pressT = 0;
      let longFired = false;
      btn.addEventListener('pointerdown', () => {
        longFired = false;
        pressT = setTimeout(() => { longFired = true; this.setCue(num, i); }, 550);
      });
      btn.addEventListener('pointerup', () => clearTimeout(pressT));
      btn.addEventListener('pointerleave', () => clearTimeout(pressT));
      btn.addEventListener('click', (e) => {
        if (longFired) return;
        if (e.shiftKey) this.setCue(num, i);
        else this.jumpCue(num, i);
      });
      btn.addEventListener('contextmenu', (e) => { e.preventDefault(); this.clearCue(num, i); });
    });
  }

  cueList(num) {
    return this.cues[this.trackId(num)] || [null, null, null, null];
  }

  setCue(num, i) {
    const p = this.audio.players[num];
    if (!p?.audio?.duration) return;
    const list = [...this.cueList(num)];
    // snap to the nearest beat when we know the grid
    let t = p.audio.currentTime;
    const a = p.analysis;
    if (a?.bpm) {
      const per = 60 / a.bpm;
      t = Math.max(0, (a.firstBeat || 0) + Math.round((t - (a.firstBeat || 0)) / per) * per);
    }
    list[i] = +t.toFixed(3);
    this.cues[this.trackId(num)] = list;
    this.saveCues();
    this.renderInfo(num);
  }

  jumpCue(num, i) {
    const t = this.cueList(num)[i];
    if (t === null || t === undefined) { this.setCue(num, i); return; }
    this.audio.seek(num, t);
  }

  clearCue(num, i) {
    const list = [...this.cueList(num)];
    list[i] = null;
    this.cues[this.trackId(num)] = list;
    this.saveCues();
    this.renderInfo(num);
  }

  renderInfo(num) {
    const wrap = document.getElementById(`deck-wave-${num}`);
    if (!wrap) return;
    const a = this.audio.players[num]?.analysis;
    wrap.querySelector('.deck-bpm').textContent = a?.bpm ? `${a.bpm.toFixed(1)} BPM` : '— BPM';
    wrap.querySelector('.deck-key').textContent = a?.key ? `${a.key} · ${a.camelot}` : '—';
    const list = this.cueList(num);
    wrap.querySelectorAll('.deck-cue').forEach((b, i) => b.classList.toggle('set', list[i] !== null && list[i] !== undefined));
  }

  draw(num) {
    const wrap = document.getElementById(`deck-wave-${num}`);
    if (!wrap || wrap.offsetParent === null) return;
    const canvas = wrap.querySelector('canvas');
    const p = this.audio.players[num];
    const a = p?.analysis;
    const dur = p?.audio?.duration || a?.duration || 0;
    const now = p?.audio?.currentTime || 0;
    const key = `${a ? 1 : 0}_${Math.round(now * 20)}_${dur}`;
    if (key === wrap._last) return;
    wrap._last = key;
    const g = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.04)';
    g.fillRect(0, 0, W, H);
    if (!a?.peaks || !dur) {
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.font = '12px Inter, sans-serif';
      g.fillText(p?.loaded ? 'Analysing beat…' : 'Load a beat to see its waveform', 10, H / 2 + 4);
      return;
    }
    const peaks = a.peaks;
    const playX = (now / dur) * W;
    const base = num === 1 ? [255, 90, 74] : [38, 212, 255];
    for (let x = 0; x < W; x++) {
      const v = peaks[Math.floor((x / W) * peaks.length)] || 0;
      const h = Math.max(1, v * (H - 8));
      g.fillStyle = x < playX ? `rgba(${base.join(',')},0.95)` : `rgba(${base.join(',')},0.38)`;
      g.fillRect(x, (H - h) / 2, 1, h);
    }
    // beat grid (bars brighter)
    if (a.bpm) {
      const per = 60 / a.bpm;
      if (W / (dur / per) > 3) {
        for (let b = 0, t = a.firstBeat || 0; t < dur; t += per, b++) {
          const x = (t / dur) * W;
          g.fillStyle = b % 4 === 0 ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.08)';
          g.fillRect(x, 0, 1, b % 4 === 0 ? H : 6);
        }
      }
    }
    // hot cues
    this.cueList(num).forEach((t, i) => {
      if (t === null || t === undefined) return;
      const x = (t / dur) * W;
      g.fillStyle = CUE_COLORS[i];
      g.fillRect(x - 1, 0, 2, H);
      g.beginPath();
      g.moveTo(x - 5, 0); g.lineTo(x + 5, 0); g.lineTo(x, 7);
      g.fill();
    });
    g.fillStyle = '#ffffff';
    g.fillRect(playX - 1, 0, 2, H);
    canvas.setAttribute('aria-valuenow', String(Math.round((now / dur) * 100)));
  }
}

export { DeckWaveforms };
