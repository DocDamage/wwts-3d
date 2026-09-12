/**
 * DJ Soundboard Manager — Instant battle sound FX playback
 * Features:
 * - Pre-buffered audio for zero-latency playback
 * - Multi-voice polyphony (rapid repeat hits e.g. spamming air horn)
 * - Volume control & keyboard shortcuts (1-6)
 * - Visual pad flash feedback & 3D stage event callbacks
 */

class SoundboardManager {
  constructor() {
    this.sounds = {
      airhorn: '/sounds/airhorn.mp3',
      bell: '/sounds/bell.wav',
      crowd_react: '/sounds/crowd_react.wav',
      crowd_cheer: '/sounds/crowd_cheer.wav',
      needle_drop: '/sounds/needle_drop.mp3',
      needle_stop: '/sounds/needle_stop.mp3',
      timer_alarm: '/sounds/timer_alarm.wav'
    };

    this.audioPool = {};
    this.volume = 0.85;
    this.onPlayCallback = null;
  }

  init() {
    // Pre-cache audio objects for zero-latency trigger
    Object.keys(this.sounds).forEach((key) => {
      const audio = new Audio(this.sounds[key]);
      audio.preload = 'auto';
      audio.volume = this.volume;
      this.audioPool[key] = [audio];
    });

    // Wire UI pads
    document.querySelectorAll('.soundboard-pad').forEach((pad) => {
      const soundKey = pad.dataset.sound;
      pad.addEventListener('click', () => {
        this.play(soundKey);
        this.flashPad(pad);
      });
    });

    // Volume slider
    const volSlider = document.getElementById('soundboard-volume');
    if (volSlider) {
      volSlider.addEventListener('input', (e) => {
        this.setVolume(parseFloat(e.target.value));
      });
      this.setVolume(parseFloat(volSlider.value));
    }

    // Keyboard Hotkeys: 1-6 for instant DJ battle sound triggers
    window.addEventListener('keydown', (e) => {
      // Don't trigger if user is typing in an input or textarea
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

      const keyMap = {
        '1': 'airhorn',
        '2': 'bell',
        '3': 'crowd_react',
        '4': 'crowd_cheer',
        '5': 'needle_drop',
        '6': 'needle_stop'
      };

      if (keyMap[e.key]) {
        e.preventDefault();
        const soundKey = keyMap[e.key];
        this.play(soundKey);

        const pad = document.querySelector(`.soundboard-pad[data-sound="${soundKey}"]`);
        if (pad) this.flashPad(pad);
      }
    });
  }

  onPlay(callback) {
    this.onPlayCallback = callback;
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    Object.values(this.audioPool).forEach((pool) => {
      pool.forEach((audio) => { audio.volume = this.volume; });
    });
  }

  play(soundKey) {
    if (!this.sounds[soundKey]) return;

    // Find available audio element in pool or create clone for overlapping hits
    let pool = this.audioPool[soundKey];
    if (!pool) pool = this.audioPool[soundKey] = [];

    let audio = pool.find((a) => a.paused || a.ended);
    if (!audio) {
      audio = new Audio(this.sounds[soundKey]);
      audio.volume = this.volume;
      pool.push(audio);
    }

    audio.volume = this.volume;
    audio.currentTime = 0;
    audio.play().catch(() => {});

    // Notify stage reaction (lights flash, subwoofers punch)
    if (typeof this.onPlayCallback === 'function') {
      this.onPlayCallback(soundKey);
    }
  }

  flashPad(pad) {
    pad.classList.add('hit');
    setTimeout(() => {
      pad.classList.remove('hit');
    }, 180);
  }
}

export { SoundboardManager };
