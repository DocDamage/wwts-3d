import { BeatGenerator } from './beatGenerator.js';

/**
 * Audio Player — dual-slot player supporting local files + web URLs + synthesized battle beats
 */

class AudioPlayerManager {
  constructor() {
    this.players = {
      1: { audio: new Audio(), loaded: false, playing: false },
      2: { audio: new Audio(), loaded: false, playing: false }
    };
    this.baseVolumes = { 1: 1.0, 2: 1.0 };
    this.crossfade = 0.5; // 0.0 (Deck 1) to 1.0 (Deck 2)
    this.animFrameIds = {};
    this.beatGen = new BeatGenerator();
    this.audioContext = null;
  }

  init() {
    // DJ Crossfader Slider
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

      // File upload
      const fileInput = document.querySelector(`.audio-file-input[data-player="${num}"]`);
      if (fileInput) {
        fileInput.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) {
            const url = URL.createObjectURL(file);
            this.loadAudio(num, url);
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
        cancelAnimationFrame(this.animFrameIds[num]);
        this._notifyState(num, false);
      });

      audio.addEventListener('error', () => {
        console.warn(`Audio player ${num}: failed to load`);
        player.loaded = false;
        this.setPlayEnabled(num, false);
        this._notifyState(num, false);
      });
    });
  }

  onStateChange(callback) {
    this._stateChangeCallback = callback;
  }

  _notifyState(playerNum, isPlaying) {
    if (typeof this._stateChangeCallback === 'function') {
      this._stateChangeCallback(playerNum, isPlaying);
    }
  }

  isPlaying(playerNum) {
    return !!this.players[playerNum]?.playing;
  }

  loadAudio(playerNum, src) {
    const player = this.players[playerNum];

    // Stop current
    if (player.playing) {
      player.audio.pause();
      player.playing = false;
      cancelAnimationFrame(this.animFrameIds[playerNum]);
      this._notifyState(playerNum, false);
    }

    player.audio.src = src;
    player.audio.load();

    player.audio.addEventListener('canplay', () => {
      player.loaded = true;
      this.setPlayEnabled(playerNum, true);
      this.updateProgress(playerNum);
    }, { once: true });
  }

  togglePlay(playerNum) {
    const player = this.players[playerNum];
    if (!player.loaded) return;

    if (player.playing) {
      player.audio.pause();
      player.playing = false;
      cancelAnimationFrame(this.animFrameIds[playerNum]);
      this._notifyState(playerNum, false);
    } else {
      player.audio.play().catch(() => {});
      player.playing = true;
      this.startProgressLoop(playerNum);
      this._notifyState(playerNum, true);
    }

    this.updatePlayButtonIcon(playerNum);
  }

  pause(playerNum) {
    const player = this.players[playerNum];
    if (player.playing) {
      player.audio.pause();
      player.playing = false;
      cancelAnimationFrame(this.animFrameIds[playerNum]);
      this.updatePlayButtonIcon(playerNum);
      this._notifyState(playerNum, false);
    }
  }

  pauseAll() {
    this.pause(1);
    this.pause(2);
  }

  startProgressLoop(playerNum) {
    const update = () => {
      this.updateProgress(playerNum);
      if (this.players[playerNum].playing) {
        this.animFrameIds[playerNum] = requestAnimationFrame(update);
      }
    };
    this.animFrameIds[playerNum] = requestAnimationFrame(update);
  }

  updateProgress(playerNum) {
    const audio = this.players[playerNum].audio;
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

    if (this.players[1].audio) {
      this.players[1].audio.volume = Math.max(0, Math.min(1, baseVol1 * g1));
    }
    if (this.players[2].audio) {
      this.players[2].audio.volume = Math.max(0, Math.min(1, baseVol2 * g2));
    }
  }

  formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Generates and loads a procedural hip-hop battle beat
   */
  loadPresetBeat(playerNum, presetKey = 'boombap') {
    const player = this.players[playerNum];
    const url = this.beatGen.generateBeat(presetKey);
    this.loadAudio(playerNum, url);
    player.audio.loop = true;

    // Show beat title in input placeholder
    const input = document.querySelector(`.audio-url-input[data-player="${playerNum}"]`);
    if (input) {
      const config = this.beatGen.getPresetConfig(presetKey);
      input.value = `⚡ ${config.name} (${config.bpm} BPM)`;
    }
  }

  /**
   * Real-time vinyl scratching sound synthesis via Web Audio API
   */
  playScratchSound(playerNum = 1) {
    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = this.audioContext;
      if (ctx.state === 'suspended') ctx.resume();

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

      // Noise layer
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
