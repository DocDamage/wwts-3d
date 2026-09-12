/**
 * BattleTimer — Competition-grade Countdown Clock with Drift-Free Elapsed Timing,
 * Play/Pause/Stop/Reset, Overtime Support, and Unified Command Interface.
 */

class BattleTimer {
  constructor(defaultSeconds = 180) {
    this.defaultSeconds = defaultSeconds; // Default 3 minutes (180s)
    this.duration = defaultSeconds;
    this.remaining = defaultSeconds;
    this.running = false;
    this.intervalId = null;

    // High-precision timing tracking
    this.startTime = 0;
    this.elapsedBeforePause = 0;

    // Callbacks
    this.onTick = null;
    this.onStart = null;
    this.onPause = null;
    this.onStop = null;
    this.onWarning10 = null;
    this.onComplete = null;

    // Cached DOM Elements
    this.displayEl = typeof document !== 'undefined' ? document.getElementById('timer-value') : null;
    this.playBtn = typeof document !== 'undefined' ? document.getElementById('btn-timer-play') : null;
    this.stopBtn = typeof document !== 'undefined' ? document.getElementById('btn-timer-stop') : null;
    this.iconPlay = typeof document !== 'undefined' ? document.getElementById('icon-play') : null;
    this.iconPause = typeof document !== 'undefined' ? document.getElementById('icon-pause') : null;
    this.speakerVisual = typeof document !== 'undefined' ? document.getElementById('speaker-icon') : null;
  }

  get isRunning() {
    return this.running;
  }

  init() {
    if (typeof document !== 'undefined') {
      this.displayEl = document.getElementById('timer-value');
      this.playBtn = document.getElementById('btn-timer-play');
      this.stopBtn = document.getElementById('btn-timer-stop');
      this.iconPlay = document.getElementById('icon-play');
      this.iconPause = document.getElementById('icon-pause');
      this.speakerVisual = document.getElementById('speaker-icon');

      this.playBtn?.addEventListener('click', () => this.togglePlayPause());
      this.stopBtn?.addEventListener('click', () => this.stop());
    }
    this.render();
  }

  setDuration(seconds, resetToNewDuration = true) {
    const sec = Math.max(1, parseInt(seconds, 10) || 180);
    this.duration = sec;
    this.defaultSeconds = sec;
    if (resetToNewDuration) {
      this.remaining = sec;
      this.elapsedBeforePause = 0;
    }
    this.render();
  }

  getDuration() {
    return this.duration;
  }

  toggle() {
    this.togglePlayPause();
  }

  togglePlayPause() {
    if (this.running) {
      this.pause();
    } else {
      this.play();
    }
  }

  start() {
    this.play();
  }

  play() {
    if (this.running) return;

    if (this.remaining <= 0) {
      this.remaining = this.duration;
      this.elapsedBeforePause = 0;
    }

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.startTime = now;
    this.running = true;

    this.updateIcons();
    this.speakerVisual?.classList.add('active');

    if (typeof this.onStart === 'function') {
      this.onStart();
    }

    // High precision tick loop (checks every 250ms, computes real elapsed seconds)
    this.intervalId = setInterval(() => {
      const currentNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const currentElapsedMs = this.elapsedBeforePause + (currentNow - this.startTime);
      const remainingSec = Math.max(0, Math.ceil((this.duration * 1000 - currentElapsedMs) / 1000));

      if (remainingSec !== this.remaining) {
        const prevRemaining = this.remaining;
        this.remaining = remainingSec;
        this.render();

        if (typeof this.onTick === 'function') {
          this.onTick(this.remaining);
        }

        if (this.remaining === 10 && prevRemaining > 10 && typeof this.onWarning10 === 'function') {
          this.onWarning10();
        }

        if (this.remaining <= 0) {
          this.complete();
        }
      }
    }, 200);
  }

  pause() {
    if (!this.running) return;

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.elapsedBeforePause += (now - this.startTime);
    this.running = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.updateIcons();
    this.speakerVisual?.classList.remove('active');

    if (typeof this.onPause === 'function') {
      this.onPause();
    }
  }

  stop() {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.remaining = this.duration;
    this.elapsedBeforePause = 0;
    this.render();
    this.updateIcons();
    this.displayEl?.classList.remove('warning', 'critical');
    this.speakerVisual?.classList.remove('active');

    if (typeof this.onStop === 'function') {
      this.onStop();
    }
  }

  reset(newSeconds = null) {
    if (newSeconds !== null) {
      this.setDuration(newSeconds, true);
    } else {
      this.stop();
    }
  }

  complete() {
    this.pause();
    this.remaining = 0;
    this.render();

    if (this.displayEl) {
      this.displayEl.classList.add('critical');
      setTimeout(() => {
        this.displayEl?.classList.remove('critical');
      }, 3000);
    }

    if (typeof this.onComplete === 'function') {
      this.onComplete();
    }
  }

  updateDisplay() {
    this.render();
  }

  getFormattedTime() {
    const mins = Math.floor(this.remaining / 60);
    const secs = this.remaining % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  render() {
    if (!this.displayEl) return;

    this.displayEl.textContent = this.getFormattedTime();

    // Warning states
    this.displayEl.classList.remove('warning', 'critical');
    if (this.remaining <= 10 && this.remaining > 0) {
      this.displayEl.classList.add('critical');
    } else if (this.remaining <= 30 && this.remaining > 0) {
      this.displayEl.classList.add('warning');
    }
  }

  updateIcons() {
    if (this.iconPlay && this.iconPause) {
      this.iconPlay.style.display = this.running ? 'none' : 'block';
      this.iconPause.style.display = this.running ? 'block' : 'none';
    }
  }
}

export { BattleTimer };
