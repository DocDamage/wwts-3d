import { BeatGenerator } from './beatGenerator.js';

/**
 * Audio Player — Dual-slot Competition Player with Web Audio AnalyserNode,
 * Promise-guarded Playback, Duration Validation, Track Metadata, and DJ Performance Tools.
 */

class AudioPlayerManager {
  constructor() {
    this.players = {
      1: {
        audio: new Audio(),
        loaded: false,
        playing: false,
        title: 'Contestant 1 Beat',
        duration: 0,
        sourceNode: null
      },
      2: {
        audio: new Audio(),
        loaded: false,
        playing: false,
        title: 'Contestant 2 Beat',
        duration: 0,
        sourceNode: null
      }
    };

    this.baseVolumes = { 1: 1.0, 2: 1.0 };
    this.crossfade = 0.5; // 0.0 (Deck 1) to 1.0 (Deck 2)
    this.animFrameIds = {};
    this.beatGen = new BeatGenerator();

    // Web Audio Real-Time Analyzer
    this.audioContext = null;
    this.analyser = null;
    this.analyserData = null;
    this.masterGain = null;

    this._stateChangeCallback = null;
    this._errorCallback = null;
  }

  init() {
    if (typeof document === 'undefined') return;

    // Crossfader
    const crossfader = document.getElementById('dj-crossfader');
    if (crossfader) {
      crossfader.addEventListener('input', (e) => {
        this.setCrossfade(parseFloat(e.target.value));
      });
    }

    // Quick Cut Buttons
    document.querySelectorAll('.crossfader-cut-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = parseFloat(btn.dataset.val);
        if (!isNaN(val)) {
          if (crossfader) crossfader.value = val;
          this.setCrossfade(val);
        }
      });
    });

    [1, 2].forEach(num => {
      const player = this.players[num];
      const audio = player.audio;
      audio.crossOrigin = 'anonymous';

      // File upload
      const fileInput = document.querySelector(`.audio-file-input[data-player="${num}"]`);
      if (fileInput) {
        fileInput.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) {
            player.title = file.name.replace(/\.[^/.]+$/, '');
            const url = URL.createObjectURL(file);
            this.loadAudio(num, url, player.title);
          }
        });
      }

      // URL load
      const loadBtn = document.querySelector(`.audio-load-btn[data-player="${num}"]`);
      if (loadBtn) {
        loadBtn.addEventListener('click', () => {
          const urlInput = document.querySelector(`.audio-url-input[data-player="${num}"]`);
          if (urlInput && urlInput.value.trim()) {
            this.loadAudio(num, urlInput.value.trim());
          }
        });
      }

      // URL input enter key
      const urlInput = document.querySelector(`.audio-url-input[data-player="${num}"]`);
      if (urlInput) {
        urlInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && urlInput.value.trim()) {
            this.loadAudio(num, urlInput.value.trim());
          }
        });
      }

      // Play/pause button
      const playBtn = document.querySelector(`.audio-play-btn[data-player="${num}"]`);
      if (playBtn) {
        playBtn.addEventListener('click', () => this.togglePlay(num));
      }

      // Volume
      const volInput = document.querySelector(`.audio-volume[data-player="${num}"]`);
      if (volInput) {
        volInput.addEventListener('input', (e) => {
          this.baseVolumes[num] = parseFloat(e.target.value);
          this.applyEffectiveVolumes();
        });
        this.baseVolumes[num] = parseFloat(volInput.value);
        this.applyEffectiveVolumes();
      }

      // Preset Battle Beat dropdown
      const presetSelect = document.querySelector(`.preset-beat-select[data-player="${num}"]`);
      if (presetSelect) {
        presetSelect.addEventListener('change', (e) => {
          const val = e.target.value;
          if (val) {
            this.loadPresetBeat(num, val);
          }
        });
      }

      // Quick scratch button
      const scratchBtn = document.querySelector(`.audio-scratch-btn[data-player="${num}"]`);
      if (scratchBtn) {
        scratchBtn.addEventListener('click', () => {
          this.playScratchSound(num);
        });
      }

      // Progress bar click to seek
      const progressBar = document.querySelector(`.audio-progress-bar[data-player="${num}"]`);
      if (progressBar) {
        progressBar.addEventListener('click', (e) => {
          if (!player.loaded || !audio.duration) return;
          const rect = progressBar.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          audio.currentTime = pct * audio.duration;
        });
      }

      // Audio events
      audio.addEventListener('ended', () => {
        player.playing = false;
        this.updatePlayButtonIcon(num);
        if (typeof cancelAnimationFrame !== 'undefined') {
          cancelAnimationFrame(this.animFrameIds[num]);
        }
        this._notifyState(num, false);
      });

      audio.addEventListener('error', (e) => {
        console.warn(`Audio player ${num}: failed to load/decode`, e);
        player.loaded = false;
        player.playing = false;
        this.setPlayEnabled(num, false);
        this.showAudioError(num, 'Audio failed to decode or load from URL.');
        this._notifyState(num, false);
      });
    });
  }

  ensureAudioContext() {
    if (!this.audioContext && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.audioContext = new AudioCtx();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 128; // 64 frequency bins
        this.analyser.smoothingTimeConstant = 0.75;
        this.analyserData = new Uint8Array(this.analyser.frequencyBinCount);

        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = 1.0;

        this.analyser.connect(this.masterGain);
        this.masterGain.connect(this.audioContext.destination);

        // Connect media elements once
        [1, 2].forEach(num => {
          try {
            if (!this.players[num].sourceNode && this.players[num].audio) {
              const src = this.audioContext.createMediaElementSource(this.players[num].audio);
              src.connect(this.analyser);
              this.players[num].sourceNode = src;
            }
          } catch (e) {
            // Already connected or CORS restriction
          }
        });
      }
    }

    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
  }

  /**
   * Real-time audio spectrum & energy measurements for 3D stage
   */
  getAudioAnalysis() {
    const isPlaying = this.isPlaying(1) || this.isPlaying(2);
    if (!this.analyser || !isPlaying) {
      return {
        isPlaying: false,
        bassEnergy: 0.05,
        midEnergy: 0.05,
        highEnergy: 0.05,
        frequencyBins: new Array(36).fill(0.05)
      };
    }

    this.analyser.getByteFrequencyData(this.analyserData);

    // Bin averages (64 total bins)
    // Sub/bass: bins 0-4 (approx 20-300Hz)
    // Mid: bins 5-20 (approx 300-2500Hz)
    // High: bins 21-45 (approx 2500-10000Hz)
    let bassSum = 0;
    for (let i = 0; i < 5; i++) bassSum += this.analyserData[i];
    const bassEnergy = Math.min(1.0, (bassSum / 5) / 255);

    let midSum = 0;
    for (let i = 5; i < 20; i++) midSum += this.analyserData[i];
    const midEnergy = Math.min(1.0, (midSum / 15) / 255);

    let highSum = 0;
    for (let i = 20; i < 45; i++) highSum += this.analyserData[i];
    const highEnergy = Math.min(1.0, (highSum / 25) / 255);

    // Normalize 36 bins for Jumbotron
    const frequencyBins = [];
    const step = this.analyser.frequencyBinCount / 36;
    for (let i = 0; i < 36; i++) {
      const idx = Math.min(this.analyser.frequencyBinCount - 1, Math.floor(i * step));
      frequencyBins.push(Math.max(0.06, (this.analyserData[idx] / 255)));
    }

    return {
      isPlaying: true,
      bassEnergy,
      midEnergy,
      highEnergy,
      frequencyBins
    };
  }

  onStateChange(callback) {
    this._stateChangeCallback = callback;
  }

  onError(callback) {
    this._errorCallback = callback;
  }

  _notifyState(playerNum, isPlaying) {
    if (typeof this._stateChangeCallback === 'function') {
      this._stateChangeCallback(playerNum, isPlaying);
    }
  }

  isPlaying(playerNum) {
    return !!this.players[playerNum]?.playing;
  }

  loadAudio(playerNum, src, title = null) {
    const player = this.players[playerNum];

    // Stop current
    if (player.playing) {
      player.audio.pause();
      player.playing = false;
      if (typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(this.animFrameIds[playerNum]);
      }
      this._notifyState(playerNum, false);
    }

    this.clearAudioError(playerNum);

    player.audio.src = src;
    player.title = title || `Contestant ${playerNum} Track`;
    player.loaded = false;
    player.audio.load();

    player.audio.addEventListener('canplay', () => {
      player.loaded = true;
      player.duration = player.audio.duration;
      this.setPlayEnabled(playerNum, true);
      this.updateProgress(playerNum);
      this.checkTrackDuration(playerNum);
    }, { once: true });
  }

  checkTrackDuration(playerNum) {
    const audio = this.players[playerNum]?.audio;
    if (!audio || !audio.duration) return;

    // Standard round is 180s (or 60s for OT)
    if (audio.duration < 60) {
      this.showAudioWarning(playerNum, `⚠️ Short track (${this.formatTime(audio.duration)}). Will end before 1:00.`);
    } else {
      this.clearAudioError(playerNum);
    }
  }

  async togglePlay(playerNum) {
    const player = this.players[playerNum];
    if (!player.loaded) return;

    if (player.playing) {
      this.pause(playerNum);
    } else {
      await this.play(playerNum);
    }

    this.updatePlayButtonIcon(playerNum);
  }

  async play(playerNum) {
    const player = this.players[playerNum];
    if (!player.loaded) return false;

    this.ensureAudioContext();

    try {
      // Browser Playback Promise Verification
      await player.audio.play();
      player.playing = true;
      this.clearAudioError(playerNum);
      this.startProgressLoop(playerNum);
      this._notifyState(playerNum, true);
      this.updatePlayButtonIcon(playerNum);
      return true;
    } catch (err) {
      console.warn(`Audio Player ${playerNum} play rejected:`, err);
      player.playing = false;
      this.updatePlayButtonIcon(playerNum);
      this.showAudioError(playerNum, `Playback blocked. Click screen or check browser audio settings.`);
      this._notifyState(playerNum, false);
      if (typeof this._errorCallback === 'function') {
        this._errorCallback(playerNum, err);
      }
      return false;
    }
  }

  pause(playerNum) {
    const player = this.players[playerNum];
    if (player && player.playing) {
      player.audio.pause();
      player.playing = false;
      if (typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(this.animFrameIds[playerNum]);
      }
      this.updatePlayButtonIcon(playerNum);
      this._notifyState(playerNum, false);
    }
  }

  pauseAll() {
    this.pause(1);
    this.pause(2);
  }

  resetTrack(playerNum) {
    const player = this.players[playerNum];
    if (player && player.audio) {
      player.audio.pause();
      player.audio.currentTime = 0;
      player.playing = false;
      this.updatePlayButtonIcon(playerNum);
      this.updateProgress(playerNum);
      this._notifyState(playerNum, false);
    }
  }

  showAudioError(playerNum, message) {
    const slot = document.getElementById(`audio-slot-${playerNum}`);
    if (!slot) return;

    let errEl = slot.querySelector('.audio-error-banner');
    if (!errEl) {
      errEl = document.createElement('div');
      errEl.className = 'audio-error-banner';
      slot.appendChild(errEl);
    }
    errEl.textContent = message;
    errEl.style.display = 'block';
  }

  showAudioWarning(playerNum, message) {
    const slot = document.getElementById(`audio-slot-${playerNum}`);
    if (!slot) return;

    let warnEl = slot.querySelector('.audio-warn-banner');
    if (!warnEl) {
      warnEl = document.createElement('div');
      warnEl.className = 'audio-warn-banner';
      slot.appendChild(warnEl);
    }
    warnEl.textContent = message;
    warnEl.style.display = 'block';
  }

  clearAudioError(playerNum) {
    const slot = document.getElementById(`audio-slot-${playerNum}`);
    if (!slot) return;
    const errEl = slot.querySelector('.audio-error-banner');
    if (errEl) errEl.style.display = 'none';
    const warnEl = slot.querySelector('.audio-warn-banner');
    if (warnEl) warnEl.style.display = 'none';
  }

  startProgressLoop(playerNum) {
    const update = () => {
      this.updateProgress(playerNum);
      if (this.players[playerNum]?.playing && typeof requestAnimationFrame !== 'undefined') {
        this.animFrameIds[playerNum] = requestAnimationFrame(update);
      }
    };
    if (typeof requestAnimationFrame !== 'undefined') {
      this.animFrameIds[playerNum] = requestAnimationFrame(update);
    }
  }

  updateProgress(playerNum) {
    const audio = this.players[playerNum]?.audio;
    if (!audio) return;

    const fill = document.querySelector(`.audio-progress-fill[data-player="${playerNum}"]`);
    const time = document.querySelector(`.audio-time[data-player="${playerNum}"]`);

    if (!audio.duration || isNaN(audio.duration)) {
      if (fill) fill.style.width = '0%';
      if (time) time.textContent = '0:00 / 0:00';
      return;
    }

    const pct = (audio.currentTime / audio.duration) * 100;
    if (fill) fill.style.width = `${pct}%`;
    if (time) {
      time.textContent = `${this.formatTime(audio.currentTime)} / ${this.formatTime(audio.duration)}`;
    }
  }

  setPlayEnabled(playerNum, enabled) {
    const btn = document.querySelector(`.audio-play-btn[data-player="${playerNum}"]`);
    if (btn) {
      btn.disabled = !enabled;
    }
  }

  updatePlayButtonIcon(playerNum) {
    const btn = document.querySelector(`.audio-play-btn[data-player="${playerNum}"]`);
    if (!btn) return;

    const playing = this.players[playerNum].playing;
    btn.innerHTML = playing
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
  }

  setCrossfade(val) {
    this.crossfade = Math.max(0, Math.min(1, val));
    this.applyEffectiveVolumes();
  }

  applyEffectiveVolumes() {
    const g1 = Math.cos(this.crossfade * Math.PI * 0.5);
    const g2 = Math.sin(this.crossfade * Math.PI * 0.5);

    const baseVol1 = this.baseVolumes[1] ?? 1.0;
    const baseVol2 = this.baseVolumes[2] ?? 1.0;

    if (this.players[1]?.audio) {
      this.players[1].audio.volume = Math.max(0, Math.min(1, baseVol1 * g1));
    }
    if (this.players[2]?.audio) {
      this.players[2].audio.volume = Math.max(0, Math.min(1, baseVol2 * g2));
    }
  }

  formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  loadPresetBeat(playerNum, presetKey = 'boombap') {
    const player = this.players[playerNum];
    const url = this.beatGen.generateBeat(presetKey);
    const config = this.beatGen.getPresetConfig(presetKey);
    const title = `⚡ ${config.name} (${config.bpm} BPM)`;

    this.loadAudio(playerNum, url, title);
    player.audio.loop = true;

    const input = document.querySelector(`.audio-url-input[data-player="${playerNum}"]`);
    if (input) {
      input.value = title;
    }
  }

  playScratchSound(playerNum = 1) {
    try {
      this.ensureAudioContext();
      const ctx = this.audioContext;
      if (!ctx) return;

      const duration = 0.16 + Math.random() * 0.08;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = 'sawtooth';
      const startF = 380 + Math.random() * 450;
      const endF = 120 + Math.random() * 160;
      osc.frequency.setValueAtTime(startF, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(endF, ctx.currentTime + duration);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1200, ctx.currentTime);
      filter.Q.value = 3.2;

      const bufSize = Math.floor(ctx.sampleRate * duration);
      const noiseBuf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const out = noiseBuf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) {
        out[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.07));
      }
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuf;

      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

      osc.connect(filter);
      filter.connect(gain);
      noise.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      noise.start();
      osc.stop(ctx.currentTime + duration);
      noise.stop(ctx.currentTime + duration);
    } catch {}
  }
}

export { AudioPlayerManager };
