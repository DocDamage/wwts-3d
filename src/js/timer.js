/**
 * Timer — 3:00 countdown with play/pause/stop and visual warnings
 */

class BattleTimer {
  constructor() {
    this.defaultSeconds = 180; // 3 minutes
    this.remaining = this.defaultSeconds;
    this.intervalId = null;
    this.running = false;
    this.onTick = null;
    this.onComplete = null;

    this.displayEl = document.getElementById('timer-value');
    this.playBtn = document.getElementById('btn-timer-play');
    this.stopBtn = document.getElementById('btn-timer-stop');
    this.iconPlay = document.getElementById('icon-play');
    this.iconPause = document.getElementById('icon-pause');
    this.speakerVisual = document.getElementById('speaker-icon');
  }

  init() {
    this.playBtn?.addEventListener('click', () => this.togglePlayPause());
    this.stopBtn?.addEventListener('click', () => this.stop());
    this.render();
  }

  togglePlayPause() {
    if (this.running) {
      this.pause();
    } else {
      this.play();
    }
  }

  play() {
    if (this.remaining <= 0) {
      this.remaining = this.defaultSeconds;
    }

    this.running = true;
    this.updateIcons();
    this.speakerVisual?.classList.add('active');

    if (typeof this.onStart === 'function') {
      this.onStart();
    }

    this.intervalId = setInterval(() => {
      this.remaining--;
      this.render();

      if (this.onTick) this.onTick(this.remaining);

      if (this.remaining === 10 && typeof this.onWarning10 === 'function') {
        this.onWarning10();
      }

      if (this.remaining <= 0) {
        this.complete();
      }
    }, 1000);
  }

  pause() {
    this.running = false;
    clearInterval(this.intervalId);
    this.intervalId = null;
    this.updateIcons();
    this.speakerVisual?.classList.remove('active');
  }

  stop() {
    this.running = false;
    clearInterval(this.intervalId);
    this.intervalId = null;
    this.remaining = this.defaultSeconds;
    this.render();
    this.updateIcons();
    this.displayEl?.classList.remove('warning', 'critical');
    this.speakerVisual?.classList.remove('active');
  }

  complete() {
    this.pause();
    this.remaining = 0;
    this.render();

    // Flash effect
    if (this.displayEl) {
      this.displayEl.classList.add('critical');
      setTimeout(() => {
        this.displayEl.classList.remove('critical');
      }, 3000);
    }

    if (this.onComplete) this.onComplete();
  }

  render() {
    if (!this.displayEl) return;

    const mins = Math.floor(this.remaining / 60);
    const secs = this.remaining % 60;
    this.displayEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

    // Warning states
    this.displayEl.classList.remove('warning', 'critical');
    if (this.remaining <= 10 && this.remaining > 0) {
      this.displayEl.classList.add('critical');
    } else if (this.remaining <= 30) {
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
