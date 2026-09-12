/**
 * Announcer Manager — Real Battle Voice System
 * Uses the authentic Announcer Voice Pack assets
 */

class AnnouncerManager {
  constructor() {
    this.basePath = '/sounds/announcer/Announcer Pack/';
    this.volume = 0.9;
    this.enabled = true;
    this.currentAudio = null;

    this.clips = {
      round1: 'round1.wav',
      round2: 'round2.wav',
      round3: 'round3.wav',
      finalRound: 'finalround.wav',
      ready: 'ready.wav',
      fight: 'fight.wav',
      letsrock: 'letsrock.wav',
      showtime: 'showtime.wav',
      countdown10: 'countdownfrom10.wav',
      timesup: 'timesup.wav',
      winner: 'winner.wav',
      knockout: 'knockout.wav',
      ko: 'ko.wav',
      battleofthecentury: 'battleofthecentury.wav',
      versus: 'versus.wav',
      theyreonfire: 'theyreonfire.wav',
      itsallontheline: 'itsallontheline.wav',
      godlike: 'godlike.wav',
      amazing: 'amazing.wav',
      excellent: 'excellent.wav',
      firstblood: 'firstblood.wav'
    };

    this.cache = {};
  }

  init() {
    // Pre-cache primary clips for instant response
    ['ready', 'fight', 'round1', 'round2', 'round3', 'finalRound', 'timesup', 'winner', 'knockout'].forEach(key => {
      if (this.clips[key]) {
        const audio = new Audio(this.basePath + this.clips[key]);
        audio.preload = 'auto';
        audio.volume = this.volume;
        this.cache[key] = audio;
      }
    });
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    Object.values(this.cache).forEach(a => { a.volume = this.volume; });
  }

  play(clipKey, callback) {
    if (!this.enabled || !this.clips[clipKey]) return;

    try {
      let audio = this.cache[clipKey];
      if (!audio) {
        audio = new Audio(this.basePath + this.clips[clipKey]);
        audio.volume = this.volume;
        this.cache[clipKey] = audio;
      }

      audio.currentTime = 0;
      audio.volume = this.volume;
      this.currentAudio = audio;

      if (callback) {
        audio.onended = () => callback();
      }

      const p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {});
      }
    } catch {
      // Audio playback blocked or failed
    }
  }

  stop() {
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
      } catch {}
      this.currentAudio = null;
    }
  }

  /**
   * Sequence: "Round [N]" -> 600ms -> "FIGHT!"
   */
  announceRoundStart(roundNum = 1, onComplete) {
    let roundKey = 'round1';
    if (roundNum === 2) roundKey = 'round2';
    else if (roundNum === 3) roundKey = 'round3';
    else if (roundNum >= 4) roundKey = 'finalRound';

    this.play(roundKey, () => {
      setTimeout(() => {
        const fightClips = ['fight', 'letsrock', 'showtime'];
        const pick = fightClips[Math.floor(Math.random() * fightClips.length)];
        this.play(pick, onComplete);
      }, 400);
    });
  }

  announceWinner(isKnockout = false) {
    if (isKnockout) {
      this.play('knockout', () => {
        setTimeout(() => this.play('winner'), 500);
      });
    } else {
      this.play('winner');
    }
  }

  announceTimesUp() {
    this.play('timesup');
  }

  announceHype() {
    const hypeClips = ['theyreonfire', 'itsallontheline', 'godlike', 'amazing', 'battleofthecentury'];
    const pick = hypeClips[Math.floor(Math.random() * hypeClips.length)];
    this.play(pick);
  }
}

export { AnnouncerManager };
