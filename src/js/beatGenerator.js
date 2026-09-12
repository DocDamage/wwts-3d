/**
 * Battle Beat Generator — Procedural Web Audio API Beats
 * Generates authentic hip-hop battle instrumental loops directly in the browser
 * as playable WAV Blob URLs with zero external dependencies.
 */

class BeatGenerator {
  constructor() {
    this.sampleRate = 44100;
  }

  /**
   * Generates a loopable battle beat as an audio Blob URL
   * @param {string} preset 'boombap' | 'trap808' | 'gfunk' | 'drill'
   * @returns {string} Object URL for HTMLAudioElement
   */
  generateBeat(preset = 'boombap') {
    const config = this.getPresetConfig(preset);
    const bpm = config.bpm;
    const secondsPerBeat = 60 / bpm;
    const numBars = 4;
    const totalBeats = numBars * 4;
    const totalDuration = totalBeats * secondsPerBeat;
    const totalSamples = Math.floor(totalDuration * this.sampleRate);

    // Audio buffers for stereo rendering
    const left = new Float32Array(totalSamples);
    const right = new Float32Array(totalSamples);

    // Generate patterns
    for (let bar = 0; bar < numBars; bar++) {
      const barStartBeat = bar * 4;

      for (let step = 0; step < 16; step++) {
        const beatInBar = step / 4;
        const currentBeat = barStartBeat + beatInBar;
        const sampleIndex = Math.floor(currentBeat * secondsPerBeat * this.sampleRate);
        if (sampleIndex >= totalSamples) break;

        // 1. Kicks & 808s
        if (config.kickPattern[step]) {
          this.renderKick(left, right, sampleIndex, config.kickType, config.kickPitch);
        }

        // 2. Snares / Claps
        if (config.snarePattern[step]) {
          this.renderSnare(left, right, sampleIndex, config.snareType);
        }

        // 3. Hi-Hats
        if (config.hatPattern[step]) {
          const open = step % 4 === 2 && config.hasOpenHats;
          this.renderHat(left, right, sampleIndex, open, config.hatPattern[step]);
        }

        // 4. Bassline / Synth notes
        if (config.bassPattern[step]) {
          this.renderBassNote(left, right, sampleIndex, secondsPerBeat * 0.5, config.bassNotes[step % config.bassNotes.length]);
        }
      }
    }

    // Soft master limiter & normalize
    this.masterNormalize(left, right);

    // Encode to WAV Blob URL
    return this.encodeWav(left, right, this.sampleRate);
  }

  getPresetConfig(preset) {
    if (preset === 'trap808') {
      return {
        name: 'Trap 808 Heat',
        bpm: 140,
        kickType: '808',
        kickPitch: 45,
        kickPattern:  [1,0,0,0, 0,0,1,0, 0,1,0,0, 0,0,1,0],
        snareType: 'clap',
        snarePattern: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
        hatPattern:   [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
        hasOpenHats: true,
        bassPattern:  [1,0,0,0, 0,0,1,0, 0,1,0,0, 0,0,1,0],
        bassNotes:    [46.25, 46.25, 41.20, 51.91] // F#1, E1, G#1
      };
    } else if (preset === 'gfunk') {
      return {
        name: 'West Coast Funk',
        bpm: 98,
        kickType: 'punch',
        kickPitch: 58,
        kickPattern:  [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,1,0],
        snareType: 'tight',
        snarePattern: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
        hatPattern:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
        hasOpenHats: true,
        bassPattern:  [1,0,0,1, 0,1,0,0, 1,0,0,1, 0,1,0,0],
        bassNotes:    [55.0, 55.0, 65.41, 73.42, 65.41] // A1, C2, D2
      };
    } else if (preset === 'drill') {
      return {
        name: 'Drill Pressure',
        bpm: 142,
        kickType: 'slide808',
        kickPitch: 50,
        kickPattern:  [1,0,0,0, 0,0,0,1, 0,0,1,0, 0,0,0,0],
        snareType: 'drill_snare',
        snarePattern: [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
        hatPattern:   [1,0,1,1, 1,0,1,1, 1,0,1,1, 1,0,1,1],
        hasOpenHats: false,
        bassPattern:  [1,0,0,0, 0,0,0,1, 0,0,1,0, 0,0,0,0],
        bassNotes:    [43.65, 43.65, 38.89, 49.0]
      };
    } else {
      // Default: Boombap Golden Era (92 BPM)
      return {
        name: 'Boombap Golden Era',
        bpm: 92,
        kickType: 'acoustic',
        kickPitch: 52,
        kickPattern:  [1,0,0,0, 0,0,1,0, 0,1,0,0, 0,0,0,0],
        snareType: 'fat',
        snarePattern: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
        hatPattern:   [1,0.6,1,0.6, 1,0.6,1,0.6, 1,0.6,1,0.6, 1,0.6,1,0.6],
        hasOpenHats: true,
        bassPattern:  [1,0,0,0, 0,0,1,0, 0,1,0,0, 0,0,1,0],
        bassNotes:    [43.65, 43.65, 48.99, 36.71] // F1, G1, D1
      };
    }
  }

  renderKick(left, right, startSample, type, baseFreq) {
    const durSamples = Math.floor(this.sampleRate * (type === '808' || type === 'slide808' ? 0.65 : 0.28));
    for (let i = 0; i < durSamples; i++) {
      const idx = startSample + i;
      if (idx >= left.length) break;

      const t = i / this.sampleRate;
      // Exponential pitch drop
      const freq = baseFreq * (1 + 3.8 * Math.exp(-t * 28));
      const phase = 2 * Math.PI * freq * t;
      const amp = Math.exp(-t * (type === '808' ? 4.2 : 14.0));
      // Subtle tape saturation distortion
      let sample = Math.sin(phase) * amp * 1.35;
      sample = Math.tanh(sample);

      left[idx] += sample * 0.95;
      right[idx] += sample * 0.95;
    }
  }

  renderSnare(left, right, startSample, type) {
    const durSamples = Math.floor(this.sampleRate * (type === 'clap' ? 0.22 : 0.26));
    for (let i = 0; i < durSamples; i++) {
      const idx = startSample + i;
      if (idx >= left.length) break;

      const t = i / this.sampleRate;
      // Tone part (body punch)
      const toneFreq = 185 * Math.exp(-t * 18);
      const tone = Math.sin(2 * Math.PI * toneFreq * t) * Math.exp(-t * 22) * 0.6;
      // Noise part (snare rattle / clap burst)
      const noise = (Math.random() * 2 - 1) * Math.exp(-t * (type === 'clap' ? 14 : 16)) * 0.75;

      const sample = (tone + noise) * 0.9;
      left[idx] += sample;
      right[idx] += sample * 0.92;
    }
  }

  renderHat(left, right, startSample, open, velocity = 1.0) {
    const durSamples = Math.floor(this.sampleRate * (open ? 0.18 : 0.045));
    for (let i = 0; i < durSamples; i++) {
      const idx = startSample + i;
      if (idx >= left.length) break;

      const t = i / this.sampleRate;
      // Metallic ringing noise
      const n = (Math.random() * 2 - 1);
      const metalRing = Math.sin(t * 8000 * 2 * Math.PI) * 0.3;
      const decay = open ? 24 : 75;
      const sample = (n + metalRing) * Math.exp(-t * decay) * 0.32 * velocity;

      left[idx] += sample * 0.85;
      right[idx] += sample * 1.0;
    }
  }

  renderBassNote(left, right, startSample, durationSec, freq) {
    const durSamples = Math.floor(this.sampleRate * durationSec);
    for (let i = 0; i < durSamples; i++) {
      const idx = startSample + i;
      if (idx >= left.length) break;

      const t = i / this.sampleRate;
      const phase = 2 * Math.PI * freq * t;
      // Sub-sine + subtle harmonic triangle
      const fundamental = Math.sin(phase);
      const sub = Math.sin(phase * 0.5) * 0.4;
      const harm = Math.sin(phase * 2) * 0.15;
      const amp = Math.exp(-t * 2.8);

      const sample = (fundamental + sub + harm) * amp * 0.55;
      left[idx] += sample;
      right[idx] += sample;
    }
  }

  masterNormalize(left, right) {
    let peak = 0;
    for (let i = 0; i < left.length; i++) {
      peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    }
    if (peak > 0) {
      const gain = 0.92 / peak;
      for (let i = 0; i < left.length; i++) {
        left[i] = Math.tanh(left[i] * gain);
        right[i] = Math.tanh(right[i] * gain);
      }
    }
  }

  /**
   * 16-bit Stereo PCM WAV Encoder
   */
  encodeWav(left, right, sampleRate) {
    const numChannels = 2;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const numSamples = left.length;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // RIFF chunk
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    this.writeString(view, 8, 'WAVE');

    // fmt sub-chunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // SubChunk1Size (16 for PCM)
    view.setUint16(20, 1, true);  // AudioFormat (1 for PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // BitsPerSample (16)

    // data sub-chunk
    this.writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Interleave left and right samples
    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      let l = Math.max(-1, Math.min(1, left[i]));
      let r = Math.max(-1, Math.min(1, right[i]));
      view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7FFF, true);
      offset += 2;
      view.setInt16(offset, r < 0 ? r * 0x8000 : r * 0x7FFF, true);
      offset += 2;
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
  }

  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
}

export { BeatGenerator };
