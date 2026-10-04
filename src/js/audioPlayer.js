import { BeatGenerator } from './beatGenerator.js';

/**
 * Audio Player — the two battle decks.
 *
 * Each deck runs a DJ channel strip in Web Audio:
 *   media → trim → low/mid/high EQ → low-pass → high-pass → channel fader → crossfader → master
 *                                         └→ echo send → delay (feedback) ┘
 * Decks play one at a time (battle rule), support cue points, pitch, and
 * vinyl scratching using the real beat (decoded into forward/reversed grains).
 *
 * Links without CORS headers can't go through Web Audio, so they fall back to a
 * plain <audio> element: it plays, but EQ/FX/scratch audio are unavailable.
 */

const SCRATCH_RATE = 22050;
const ROTATION_SECONDS = 1.8; // 33⅓ RPM: one platter turn = 1.8 s of audio
const STREAMING_HOSTS = /(^|\.)(youtube\.com|youtu\.be|soundcloud\.com|spotify\.com|music\.apple\.com|tidal\.com|audiomack\.com|beatstars\.com)$/i;

const DEFAULT_MIX = () => ({ trim: 0, high: 0, mid: 0, low: 0, filter: 0, echo: 0, tempo: 0, channel: 0.85 });

/** Turn common share links into direct-download links */
function normalizeAudioLink(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { url: raw };
  }
  const host = url.hostname.replace(/^www\./, '');
  if (STREAMING_HOSTS.test(host)) {
    return {
      error: 'Streaming links (YouTube, SoundCloud, Spotify…) can’t play in the browser. Ask for the MP3/WAV file, or a Dropbox / Google Drive link.'
    };
  }
  if (host.endsWith('dropbox.com')) {
    url.searchParams.delete('dl');
    url.searchParams.set('raw', '1');
    return { url: url.toString() };
  }
  if (host === 'drive.google.com') {
    const m = url.pathname.match(/\/file\/d\/([^/]+)/);
    const id = m ? m[1] : url.searchParams.get('id');
    if (id) return { url: `https://drive.google.com/uc?export=download&id=${id}` };
  }
  return { url: url.toString() };
}

class AudioPlayerManager {
  constructor() {
    const makePlayer = (n) => ({
      graphAudio: typeof Audio !== 'undefined' ? new Audio() : null,
      plainAudio: typeof Audio !== 'undefined' ? new Audio() : null,
      audio: null,
      loaded: false,
      playing: false,
      scratching: false,
      wasPlayingBeforeScratch: false,
      directMode: false,
      title: `Contestant ${n} Beat`,
      duration: 0,
      sourceNode: null,
      cuePoint: 0,
      loadToken: 0,
      scratchBuffers: null,
      mix: DEFAULT_MIX(),
      nodes: null
    });
    this.players = { 1: makePlayer(1), 2: makePlayer(2) };
    [1, 2].forEach(n => { this.players[n].audio = this.players[n].graphAudio; });

    this.baseVolumes = { 1: 0.85, 2: 0.85 };
    this.crossfade = 0.5; // 0.0 (Deck 1) to 1.0 (Deck 2)
    this.masterVolume = 0.9;
    this.exclusive = true;      // battle rule: one deck at a time
    this.autoCrossfade = true;  // slide the crossfader to whichever deck starts
    this.animFrameIds = {};
    this.beatGen = new BeatGenerator();

    this.audioContext = null;
    this.analyser = null;
    this.analyserData = null;
    this.masterGain = null;
    this.masterIn = null;

    this._stateChangeCallback = null;
    this._errorCallback = null;
    this.onMixChange = null; // (playerNum|null, param, value) — keeps 2D + 3D controls in sync
    this._lastGrainAt = { 1: 0, 2: 0 };
    this._xfadeAnim = null;
  }

  init() {
    if (typeof document === 'undefined') return;

    // Crossfader
    const crossfader = document.getElementById('dj-crossfader');
    crossfader?.addEventListener('input', (e) => this.setCrossfade(parseFloat(e.target.value)));

    document.querySelectorAll('.crossfader-cut-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = parseFloat(btn.dataset.val);
        if (!isNaN(val)) this.setCrossfade(val);
      });
    });

    [1, 2].forEach(num => {
      const player = this.players[num];
      [player.graphAudio, player.plainAudio].forEach(el => {
        el.preload = 'auto';
        el.preservesPitch = false; // pitch fader behaves like vinyl
        el.addEventListener('ended', () => {
          if (el !== player.audio || el.loop) return;
          player.playing = false;
          this.updatePlayButtonIcon(num);
          cancelAnimationFrame(this.animFrameIds[num]);
          this._notifyState(num, false);
        });
      });
      player.graphAudio.crossOrigin = 'anonymous';

      document.querySelector(`.audio-file-input[data-player="${num}"]`)?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) this.loadFile(num, file);
      });

      const urlInput = document.querySelector(`.audio-url-input[data-player="${num}"]`);
      document.querySelector(`.audio-load-btn[data-player="${num}"]`)?.addEventListener('click', () => {
        if (urlInput?.value.trim()) this.loadLink(num, urlInput.value.trim());
      });
      urlInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && urlInput.value.trim()) this.loadLink(num, urlInput.value.trim());
      });

      document.querySelector(`.audio-play-btn[data-player="${num}"]`)?.addEventListener('click', () => this.togglePlay(num));

      const volInput = document.querySelector(`.audio-volume[data-player="${num}"]`);
      if (volInput) {
        volInput.value = this.baseVolumes[num];
        volInput.addEventListener('input', (e) => this.setChannelVolume(num, parseFloat(e.target.value)));
      }

      document.querySelector(`.preset-beat-select[data-player="${num}"]`)?.addEventListener('change', (e) => {
        if (e.target.value) this.loadPresetBeat(num, e.target.value);
      });

      document.querySelector(`.audio-scratch-btn[data-player="${num}"]`)?.addEventListener('click', () => this.playScratchSound(num));

      const progressBar = document.querySelector(`.audio-progress-bar[data-player="${num}"]`);
      progressBar?.addEventListener('click', (e) => {
        if (!player.loaded || !player.audio.duration) return;
        const rect = progressBar.getBoundingClientRect();
        this.seek(num, ((e.clientX - rect.left) / rect.width) * player.audio.duration);
      });

      // Drop an audio file onto a deck slot to load it
      const slot = document.getElementById(`audio-slot-${num}`);
      slot?.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('drop-hover'); });
      slot?.addEventListener('dragleave', () => slot.classList.remove('drop-hover'));
      slot?.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('drop-hover');
        const file = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name));
        if (file) this.loadFile(num, file);
      });
    });

    this.applyEffectiveVolumes();
  }

  /* ---------------- Audio graph ---------------- */

  ensureAudioContext() {
    if (!this.audioContext && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        this.audioContext = ctx;
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 128;
        this.analyser.smoothingTimeConstant = 0.75;
        this.analyserData = new Uint8Array(this.analyser.frequencyBinCount);

        this.masterIn = ctx.createGain();
        this.masterGain = ctx.createGain();
        this.masterGain.gain.value = this.masterVolume;
        this.masterIn.connect(this.masterGain);
        this.masterGain.connect(this.analyser);
        this.analyser.connect(ctx.destination);

        [1, 2].forEach(num => this.buildChannel(num));
        this.applyEffectiveVolumes();
      }
    }
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
  }

  buildChannel(num) {
    const ctx = this.audioContext;
    const player = this.players[num];
    const n = {};
    n.trim = ctx.createGain();
    n.low = ctx.createBiquadFilter();
    n.low.type = 'lowshelf';
    n.low.frequency.value = 250;
    n.mid = ctx.createBiquadFilter();
    n.mid.type = 'peaking';
    n.mid.frequency.value = 1000;
    n.mid.Q.value = 0.9;
    n.high = ctx.createBiquadFilter();
    n.high.type = 'highshelf';
    n.high.frequency.value = 4000;
    n.lp = ctx.createBiquadFilter();
    n.lp.type = 'lowpass';
    n.lp.frequency.value = 20000;
    n.lp.Q.value = 0.9;
    n.hp = ctx.createBiquadFilter();
    n.hp.type = 'highpass';
    n.hp.frequency.value = 20;
    n.hp.Q.value = 0.9;
    n.channel = ctx.createGain();
    n.xfade = ctx.createGain();

    n.trim.connect(n.low);
    n.low.connect(n.mid);
    n.mid.connect(n.high);
    n.high.connect(n.lp);
    n.lp.connect(n.hp);
    n.hp.connect(n.channel);
    n.channel.connect(n.xfade);
    n.xfade.connect(this.masterIn);

    // Echo send (post-filter, pre-fader so it tails off naturally)
    n.echoSend = ctx.createGain();
    n.echoSend.gain.value = 0;
    n.delay = ctx.createDelay(2);
    n.delay.delayTime.value = 0.375;
    n.feedback = ctx.createGain();
    n.feedback.gain.value = 0.45;
    n.echoWet = ctx.createGain();
    n.echoWet.gain.value = 0.8;
    n.hp.connect(n.echoSend);
    n.echoSend.connect(n.delay);
    n.delay.connect(n.feedback);
    n.feedback.connect(n.delay);
    n.delay.connect(n.echoWet);
    n.echoWet.connect(n.xfade);

    player.nodes = n;
    try {
      player.sourceNode = ctx.createMediaElementSource(player.graphAudio);
      player.sourceNode.connect(n.trim);
    } catch (e) {
      console.warn(`Deck ${num}: could not attach to audio graph`, e);
    }
    Object.entries(player.mix).forEach(([param, value]) => this.applyMixParam(num, param, value));
  }

  /* ---------------- Mixer parameters ---------------- */

  /** param: trim/high/mid/low (-1..1), filter (-1..1), echo (0..1), tempo (-1..1 → ±8%), channel (0..1) */
  setMixParam(num, param, value) {
    const player = this.players[num];
    if (!player || !(param in player.mix)) return;
    const range = param === 'echo' || param === 'channel' ? [0, 1] : [-1, 1];
    const v = Math.max(range[0], Math.min(range[1], value));
    player.mix[param] = v;
    if (param === 'channel') this.baseVolumes[num] = v;
    this.applyMixParam(num, param, v);
    if (typeof this.onMixChange === 'function') this.onMixChange(num, param, v);
  }

  getMixParam(num, param) {
    return this.players[num]?.mix[param];
  }

  applyMixParam(num, param, v) {
    const player = this.players[num];
    if (param === 'tempo') {
      const rate = 1 + v * 0.08;
      player.graphAudio.playbackRate = rate;
      player.plainAudio.playbackRate = rate;
      return;
    }
    if (param === 'channel') {
      this.applyEffectiveVolumes();
      return;
    }
    const n = player.nodes;
    if (!n) return;
    const t = this.audioContext.currentTime;
    const ramp = (audioParam, target) => audioParam.setTargetAtTime(target, t, 0.015);
    const eqDb = (x) => (x < 0 ? x * 26 : x * 6); // full-left kills the band
    switch (param) {
      case 'trim': ramp(n.trim.gain, Math.pow(10, (v * 12) / 20)); break;
      case 'high': ramp(n.high.gain, eqDb(v)); break;
      case 'mid': ramp(n.mid.gain, eqDb(v)); break;
      case 'low': ramp(n.low.gain, eqDb(v)); break;
      case 'filter':
        // Left of centre sweeps a low-pass down, right sweeps a high-pass up
        ramp(n.lp.frequency, v < 0 ? 20000 * Math.pow(0.01, -v) : 20000);
        ramp(n.hp.frequency, v > 0 ? 20 * Math.pow(500, v) : 20);
        break;
      case 'echo': ramp(n.echoSend.gain, v * 0.9); break;
      default: break;
    }
  }

  setChannelVolume(num, v) {
    this.setMixParam(num, 'channel', v);
  }

  setMasterVolume(v) {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.masterGain) this.masterGain.gain.setTargetAtTime(this.masterVolume, this.audioContext.currentTime, 0.02);
    this.applyEffectiveVolumes();
    if (typeof this.onMixChange === 'function') this.onMixChange(null, 'master', this.masterVolume);
  }

  setCrossfade(val, { fromAuto = false } = {}) {
    if (!fromAuto) this.stopCrossfadeGlide();
    this.crossfade = Math.max(0, Math.min(1, val));
    this.applyEffectiveVolumes();
    const slider = typeof document !== 'undefined' ? document.getElementById('dj-crossfader') : null;
    if (slider && document.activeElement !== slider) slider.value = this.crossfade;
    if (typeof this.onMixChange === 'function') this.onMixChange(null, 'crossfade', this.crossfade);
  }

  /**
   * Glide the crossfader to a deck's side. Uses timers, not animation frames,
   * so it still finishes when the browser is in the background (e.g. behind OBS).
   */
  glideCrossfade(target) {
    this.stopCrossfadeGlide();
    const start = this.crossfade;
    const t0 = performance.now();
    this._xfadeAnim = setInterval(() => {
      const u = Math.min(1, (performance.now() - t0) / 350);
      this.setCrossfade(start + (target - start) * (u * u * (3 - 2 * u)), { fromAuto: true });
      if (u >= 1) this.stopCrossfadeGlide();
    }, 16);
  }

  stopCrossfadeGlide() {
    if (this._xfadeAnim) clearInterval(this._xfadeAnim);
    this._xfadeAnim = null;
  }

  applyEffectiveVolumes() {
    const g = { 1: Math.cos(this.crossfade * Math.PI * 0.5), 2: Math.sin(this.crossfade * Math.PI * 0.5) };
    [1, 2].forEach(num => {
      const player = this.players[num];
      const channel = player.mix.channel;
      if (player.nodes) {
        const t = this.audioContext.currentTime;
        player.nodes.channel.gain.setTargetAtTime(channel, t, 0.015);
        player.nodes.xfade.gain.setTargetAtTime(g[num], t, 0.015);
        player.graphAudio.volume = 1;
      } else {
        player.graphAudio.volume = Math.max(0, Math.min(1, channel * g[num] * this.masterVolume));
      }
      // Direct-link fallback bypasses Web Audio entirely
      player.plainAudio.volume = Math.max(0, Math.min(1, channel * g[num] * this.masterVolume));
    });
  }

  /* ---------------- Analysis ---------------- */

  getAudioAnalysis() {
    const isPlaying = this.isPlaying(1) || this.isPlaying(2);
    if (!this.analyser || !isPlaying) {
      return { isPlaying: false, bassEnergy: 0.05, midEnergy: 0.05, highEnergy: 0.05, frequencyBins: new Array(36).fill(0.05) };
    }
    this.analyser.getByteFrequencyData(this.analyserData);
    const avg = (from, to) => {
      let sum = 0;
      for (let i = from; i < to; i++) sum += this.analyserData[i];
      return Math.min(1, sum / (to - from) / 255);
    };
    const frequencyBins = [];
    const step = this.analyser.frequencyBinCount / 36;
    for (let i = 0; i < 36; i++) {
      const idx = Math.min(this.analyser.frequencyBinCount - 1, Math.floor(i * step));
      frequencyBins.push(Math.max(0.06, this.analyserData[idx] / 255));
    }
    return { isPlaying: true, bassEnergy: avg(0, 5), midEnergy: avg(5, 20), highEnergy: avg(20, 45), frequencyBins };
  }

  onStateChange(callback) { this._stateChangeCallback = callback; }
  onError(callback) { this._errorCallback = callback; }

  _notifyState(playerNum, isPlaying) {
    if (typeof this._stateChangeCallback === 'function') this._stateChangeCallback(playerNum, isPlaying);
  }

  isPlaying(playerNum) {
    return !!this.players[playerNum]?.playing;
  }

  /** Position, length and status for the 3D deck */
  getDeckState(num) {
    const p = this.players[num];
    return {
      loaded: p.loaded,
      playing: p.playing,
      scratching: p.scratching,
      time: p.audio?.currentTime || 0,
      duration: p.audio?.duration || 0,
      cuePoint: p.cuePoint,
      directMode: p.directMode,
      title: p.title
    };
  }

  /* ---------------- Loading ---------------- */

  loadFile(num, file) {
    const title = file.name.replace(/\.[^/.]+$/, '');
    this.loadAudio(num, URL.createObjectURL(file), title);
  }

  loadLink(num, raw) {
    const { url, error } = normalizeAudioLink(raw);
    if (error) {
      this.showAudioError(num, error);
      return;
    }
    let title;
    try {
      title = decodeURIComponent(new URL(url).pathname.split('/').pop() || '').replace(/\.[^/.]+$/, '') || null;
    } catch {
      title = null;
    }
    this.loadAudio(num, url, title);
  }

  loadAudio(playerNum, src, title = null) {
    const player = this.players[playerNum];
    if (player.playing) {
      player.audio.pause();
      player.playing = false;
      cancelAnimationFrame(this.animFrameIds[playerNum]);
      this._notifyState(playerNum, false);
    }
    this.clearAudioError(playerNum);

    const token = ++player.loadToken;
    const isLocal = /^(blob:|data:)/.test(src) || src.startsWith('/') || (typeof location !== 'undefined' && src.startsWith(location.origin));
    player.title = title || `Contestant ${playerNum} Track`;
    player.loaded = false;
    player.cuePoint = 0;
    player.scratchBuffers = null;
    player.plainAudio.pause();
    player.graphAudio.pause();

    const tryElement = (el, direct) => {
      player.audio = el;
      player.directMode = direct;
      el.loop = false;
      el.src = src;
      el.load();
      const onReady = () => {
        if (token !== player.loadToken) return;
        cleanup();
        player.loaded = true;
        player.duration = el.duration;
        this.setPlayEnabled(playerNum, true);
        this.updateProgress(playerNum);
        this.checkTrackDuration(playerNum);
        if (direct) {
          this.showAudioWarning(playerNum, 'Playing straight from the link — this host blocks EQ, FX and scratch audio. Download the file for full deck control.');
        } else {
          this.prepareScratchBuffers(playerNum, src, token);
        }
        if (typeof this.onMixChange === 'function') this.onMixChange(playerNum, 'loaded', true);
      };
      const onFail = () => {
        if (token !== player.loadToken) return;
        cleanup();
        if (!direct && !isLocal) {
          tryElement(player.plainAudio, true); // retry without CORS
          return;
        }
        player.loaded = false;
        this.setPlayEnabled(playerNum, false);
        this.showAudioError(playerNum, isLocal
          ? 'That file couldn’t be decoded. Try an MP3 or WAV.'
          : 'Couldn’t load that link. Make sure it points straight to an audio file (MP3/WAV) and is shared publicly.');
        this._notifyState(playerNum, false);
      };
      const cleanup = () => {
        el.removeEventListener('canplay', onReady);
        el.removeEventListener('error', onFail);
      };
      el.addEventListener('canplay', onReady);
      el.addEventListener('error', onFail);
    };
    tryElement(player.graphAudio, false);
  }

  /** Decode a low-rate mono copy (plus a reversed one) so scratches use the real beat */
  async prepareScratchBuffers(num, src, token) {
    try {
      this.ensureAudioContext();
      const res = await fetch(src);
      const bytes = await res.arrayBuffer();
      const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const decoder = new OfflineCtx(1, 1, SCRATCH_RATE);
      const decoded = await decoder.decodeAudioData(bytes);
      if (token !== this.players[num].loadToken) return;
      const len = decoded.length;
      const mono = new Float32Array(len);
      for (let c = 0; c < decoded.numberOfChannels; c++) {
        const data = decoded.getChannelData(c);
        for (let i = 0; i < len; i++) mono[i] += data[i] / decoded.numberOfChannels;
      }
      this.analyzeTrack(num, mono.slice(), decoded.sampleRate, token);
      const fwd = this.audioContext.createBuffer(1, len, decoded.sampleRate);
      const rev = this.audioContext.createBuffer(1, len, decoded.sampleRate);
      fwd.copyToChannel(mono, 0);
      mono.reverse();
      rev.copyToChannel(mono, 0);
      this.players[num].scratchBuffers = { fwd, rev, duration: decoded.duration };
    } catch (e) {
      // Not fatal — scratching falls back to the synthesized scratch sound
      console.info(`Deck ${num}: scratch buffer unavailable`, e?.message || e);
    }
  }

  /** BPM / key / waveform in a worker (doesn't block the stage) */
  analyzeTrack(num, samples, rate, token) {
    try {
      if (!this.beatWorker) {
        this.beatWorker = new Worker(new URL('./beatWorker.js', import.meta.url), { type: 'module' });
        this.beatJobs = {};
        this.beatWorker.onmessage = (e) => {
          const job = this.beatJobs[e.data.id];
          delete this.beatJobs[e.data.id];
          if (!job || job.token !== this.players[job.num]?.loadToken || e.data.error) return;
          this.players[job.num].analysis = e.data;
          this.onTrackAnalyzed?.(job.num, e.data);
        };
      }
      const id = `${num}_${token}`;
      this.beatJobs[id] = { num, token };
      this.players[num].analysis = null;
      this.beatWorker.postMessage({ id, samples, rate }, [samples.buffer]);
    } catch (e) {
      console.info('Beat analysis unavailable', e?.message || e);
    }
  }

  /** Where the deck is in the beat: { bpm, beats (since the first beat), phase 0..1 } or null */
  getBeat(num) {
    const p = this.players[num];
    const a = p?.analysis;
    if (!a || !a.bpm || !p.audio) return null;
    const beats = ((p.audio.currentTime - (a.firstBeat || 0)) * a.bpm) / 60;
    return { bpm: a.bpm, beats, phase: beats - Math.floor(beats) };
  }

  checkTrackDuration(playerNum) {
    const audio = this.players[playerNum]?.audio;
    if (!audio || !audio.duration || audio.loop) return;
    if (audio.duration < 60) {
      this.showAudioWarning(playerNum, `⚠️ Short track (${this.formatTime(audio.duration)}). Will end before 1:00.`);
    } else if (!this.players[playerNum].directMode) {
      this.clearAudioError(playerNum);
    }
  }

  /* ---------------- Transport ---------------- */

  async togglePlay(playerNum) {
    const player = this.players[playerNum];
    if (!player.loaded) return;
    if (player.playing) this.pause(playerNum);
    else await this.play(playerNum);
    this.updatePlayButtonIcon(playerNum);
  }

  async play(playerNum) {
    const player = this.players[playerNum];
    if (!player.loaded) return false;
    this.ensureAudioContext();

    // Battle rule: only one contestant's beat plays at a time
    const other = playerNum === 1 ? 2 : 1;
    if (this.exclusive && this.players[other].playing) this.pause(other);
    if (this.autoCrossfade) this.glideCrossfade(playerNum === 1 ? 0 : 1);

    try {
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
      this.showAudioError(playerNum, 'Playback blocked. Click the page once, then press play again.');
      this._notifyState(playerNum, false);
      if (typeof this._errorCallback === 'function') this._errorCallback(playerNum, err);
      return false;
    }
  }

  pause(playerNum) {
    const player = this.players[playerNum];
    if (player && player.playing) {
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

  /** CDJ-style cue: paused → set cue here; playing → jump back to cue and stop */
  cue(playerNum) {
    const player = this.players[playerNum];
    if (!player.loaded) return;
    if (player.playing) {
      this.pause(playerNum);
      this.seek(playerNum, player.cuePoint);
    } else {
      player.cuePoint = player.audio.currentTime;
      if (typeof this.onMixChange === 'function') this.onMixChange(playerNum, 'cue', player.cuePoint);
    }
  }

  seek(playerNum, seconds) {
    const player = this.players[playerNum];
    const audio = player.audio;
    if (!audio || !audio.duration) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration - 0.05, seconds));
    this.updateProgress(playerNum);
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

  /* ---------------- Scratching ---------------- */

  /** Hand on the platter: hold the track (without telling the battle flow it stopped) */
  scratchStart(num) {
    const player = this.players[num];
    if (!player.loaded || player.scratching) return;
    this.ensureAudioContext();
    player.scratching = true;
    player.wasPlayingBeforeScratch = player.playing;
    player.audio.pause();
  }

  /** Platter moved by `deltaAngle` radians over `dt` seconds */
  scratchMove(num, deltaAngle, dt) {
    const player = this.players[num];
    if (!player.scratching) return;
    const audio = player.audio;
    const deltaSeconds = (deltaAngle / (Math.PI * 2)) * ROTATION_SECONDS;
    const from = audio.currentTime;
    const to = Math.max(0, Math.min((audio.duration || 0) - 0.05, from + deltaSeconds));
    audio.currentTime = to;
    this.updateProgress(num);
    const speed = Math.abs(deltaSeconds) / Math.max(dt, 1 / 240);
    if (speed > 0.05) this.playScratchGrain(num, from, to, speed);
  }

  scratchEnd(num) {
    const player = this.players[num];
    if (!player.scratching) return;
    player.scratching = false;
    if (player.wasPlayingBeforeScratch && player.playing) {
      player.audio.play().catch(() => {});
    }
  }

  /** One short grain of the real beat, forwards or backwards, at the hand's speed */
  playScratchGrain(num, from, to, speed) {
    const ctx = this.audioContext;
    const player = this.players[num];
    const buffers = player.scratchBuffers;
    const now = performance.now();
    if (!ctx || now - this._lastGrainAt[num] < 14) return;
    this._lastGrainAt[num] = now;
    if (!buffers || !player.nodes) {
      if (speed > 0.6) this.playScratchSound(num);
      return;
    }
    const forward = to >= from;
    const src = ctx.createBufferSource();
    src.buffer = forward ? buffers.fwd : buffers.rev;
    src.playbackRate.value = Math.max(0.15, Math.min(4, speed));
    const grain = ctx.createGain();
    const t = ctx.currentTime;
    const len = 0.045;
    grain.gain.setValueAtTime(0, t);
    grain.gain.linearRampToValueAtTime(0.9, t + 0.006);
    grain.gain.linearRampToValueAtTime(0, t + len);
    src.connect(grain);
    grain.connect(player.nodes.trim); // through the deck's EQ/filter/faders
    const offset = forward ? from : buffers.duration - from;
    src.start(t, Math.max(0, Math.min(buffers.duration - 0.01, offset)), len * 4);
    src.stop(t + len + 0.01);
  }

  /* ---------------- UI helpers ---------------- */

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
      if (this.players[playerNum]?.playing) this.animFrameIds[playerNum] = requestAnimationFrame(update);
    };
    this.animFrameIds[playerNum] = requestAnimationFrame(update);
  }

  updateProgress(playerNum) {
    const audio = this.players[playerNum]?.audio;
    if (!audio || typeof document === 'undefined') return;
    const fill = document.querySelector(`.audio-progress-fill[data-player="${playerNum}"]`);
    const time = document.querySelector(`.audio-time[data-player="${playerNum}"]`);
    if (!audio.duration || isNaN(audio.duration)) {
      if (fill) fill.style.width = '0%';
      if (time) time.textContent = '0:00 / 0:00';
      return;
    }
    if (fill) fill.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
    if (time) time.textContent = `${this.formatTime(audio.currentTime)} / ${this.formatTime(audio.duration)}`;
  }

  setPlayEnabled(playerNum, enabled) {
    const btn = typeof document !== 'undefined' ? document.querySelector(`.audio-play-btn[data-player="${playerNum}"]`) : null;
    if (btn) btn.disabled = !enabled;
  }

  updatePlayButtonIcon(playerNum) {
    const btn = typeof document !== 'undefined' ? document.querySelector(`.audio-play-btn[data-player="${playerNum}"]`) : null;
    if (!btn) return;
    btn.innerHTML = this.players[playerNum].playing
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
  }

  formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  loadPresetBeat(playerNum, presetKey = 'boombap') {
    const url = this.beatGen.generateBeat(presetKey);
    const config = this.beatGen.getPresetConfig(presetKey);
    const title = `⚡ ${config.name} (${config.bpm} BPM)`;
    this.loadAudio(playerNum, url, title);
    this.players[playerNum].audio.loop = true;
    const input = document.querySelector(`.audio-url-input[data-player="${playerNum}"]`);
    if (input) input.value = title;
  }

  /** Snare roll that speeds up and swells for `seconds`, ending on a crash (winner reveal) */
  playDrumroll(seconds = 2.6) {
    this.ensureAudioContext();
    const ctx = this.audioContext;
    if (!ctx) return;
    const out = this.masterIn || ctx.destination;
    const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.06), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.018));
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.7;
    bp.connect(out);

    const t0 = ctx.currentTime + 0.05;
    let t = 0;
    while (t < seconds) {
      const u = t / seconds;
      const hit = ctx.createBufferSource();
      hit.buffer = noise;
      const g = ctx.createGain();
      g.gain.value = 0.12 + 0.5 * u * u;
      hit.connect(g);
      g.connect(bp);
      hit.start(t0 + t);
      t += 1 / (9 + 22 * u); // 9 → 31 hits per second
    }

    // Crash on the reveal
    const crashLen = 2.2;
    const crashBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * crashLen), ctx.sampleRate);
    const cd = crashBuf.getChannelData(0);
    for (let i = 0; i < cd.length; i++) cd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.55));
    const crash = ctx.createBufferSource();
    crash.buffer = crashBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3500;
    const cg = ctx.createGain();
    cg.gain.value = 0.55;
    crash.connect(hp);
    hp.connect(cg);
    cg.connect(out);
    crash.start(t0 + seconds);
  }

  /** Synthesized scratch — used when the real-beat buffer isn't available */
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
      osc.frequency.setValueAtTime(380 + Math.random() * 450, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(120 + Math.random() * 160, ctx.currentTime + duration);
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1200, ctx.currentTime);
      filter.Q.value = 3.2;
      const bufSize = Math.floor(ctx.sampleRate * duration);
      const noiseBuf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const out = noiseBuf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) out[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.07));
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuf;
      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(filter);
      filter.connect(gain);
      noise.connect(gain);
      gain.connect(this.players[playerNum]?.nodes?.trim || this.masterIn || ctx.destination);
      osc.start();
      noise.start();
      osc.stop(ctx.currentTime + duration);
      noise.stop(ctx.currentTime + duration);
    } catch {
      // Audio context unavailable — silently skip the effect
    }
  }
}

export { AudioPlayerManager, normalizeAudioLink, ROTATION_SECONDS };
