/**
 * Broadcast View Controller — Standalone Presentation View for OBS / 2nd Monitor
 * Receives real-time state synchronization via BroadcastChannel from the host console.
 */

import { DJControllerRenderer } from './djController.js';

class BroadcastController {
  constructor() {
    this.djController = new DJControllerRenderer();
    this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('wwts_broadcast') : null;
  }

  init() {
    // Initialize 3D Arena
    this.djController.init();
    this.djController.setCameraView('front');
    this.audio = { 1: false, 2: false };
    this.avatars = {};

    // Wire Broadcast Channel
    if (this.channel) {
      this.channel.onmessage = (event) => {
        this.handleBroadcastMessage(event.data);
      };
      // Ask the host console for the current state (popout opened mid-battle)
      this.channel.postMessage({ type: 'HELLO' });
    }

    // Also listen to storage events as fallback
    window.addEventListener('storage', (e) => {
      if (e.key === 'wwts_broadcast_event' && e.newValue) {
        try {
          const data = JSON.parse(e.newValue);
          this.handleBroadcastMessage(data);
        } catch {}
      }
    });
  }

  handleBroadcastMessage(data) {
    if (!data || !data.type) return;
    const payload = data.payload ?? data.data;

    switch (data.type) {
      case 'STATE_UPDATE':
        this.updateState(payload);
        break;

      case 'REVEAL_START':
        this.djController.startReveal();
        break;

      case 'REVEAL_WINNER':
        this.showWinner(payload);
        break;

      case 'SOUND':
        if (payload?.soundKey) this.djController.triggerSoundReaction(payload.soundKey);
        break;

      case 'DISMISS_WINNER':
        this.hideWinner();
        break;

      case 'BATTLE_RESET':
      case 'RESET':
        this.resetView();
        break;
    }
  }

  updateState(payload) {
    if (!payload) return;

    // Names
    if (payload.c1Name) {
      const el = document.getElementById('b-p1-name');
      if (el) el.textContent = payload.c1Name.toUpperCase();
      this.djController.setContestantName(1, payload.c1Name);
    }
    if (payload.c2Name) {
      const el = document.getElementById('b-p2-name');
      if (el) el.textContent = payload.c2Name.toUpperCase();
      this.djController.setContestantName(2, payload.c2Name);
    }

    // Scores
    if (payload.score1 !== undefined) {
      const el = document.getElementById('b-p1-score');
      if (el) el.textContent = Number(payload.score1).toFixed(2);
    }
    if (payload.score2 !== undefined) {
      const el = document.getElementById('b-p2-score');
      if (el) el.textContent = Number(payload.score2).toFixed(2);
    }

    // Series Tallies
    if (payload.roundsWon1 !== undefined) {
      const el = document.getElementById('b-p1-tally');
      if (el) el.textContent = `${payload.roundsWon1} ${payload.roundsWon1 === 1 ? "WIN" : "WINS"}`;
    }
    if (payload.roundsWon2 !== undefined) {
      const el = document.getElementById('b-p2-tally');
      if (el) el.textContent = `${payload.roundsWon2} ${payload.roundsWon2 === 1 ? "WIN" : "WINS"}`;
    }

    // Round title
    if (payload.roundTitle) {
      const el = document.getElementById('b-round-title');
      if (el) el.textContent = payload.roundTitle.toUpperCase();
    }

    // Timer
    if (payload.timerFormatted) {
      const el = document.getElementById('b-timer-value');
      if (el) {
        el.textContent = payload.timerFormatted;
        el.classList.toggle('critical', !!payload.timerCritical);
      }
    }

    // Same avatars as the host
    [1, 2].forEach(p => {
      const key = payload[`avatar${p}`];
      if (key && this.avatars[p] !== key) {
        this.avatars[p] = key;
        this.djController.setPlayerAvatar(p, key);
      }
    });

    // Jumbotron mirrors the host
    this.djController.setJumbotronData({
      c1Name: payload.c1Name, c2Name: payload.c2Name,
      score1: payload.score1 !== undefined ? Number(payload.score1).toFixed(2) : undefined,
      score2: payload.score2 !== undefined ? Number(payload.score2).toFixed(2) : undefined,
      timer: payload.timerFormatted
    });

    // Decks: the playing contestant walks to the controller (only on change)
    [1, 2].forEach(p => {
      const on = !!payload[`audioState${p}`];
      if (on !== this.audio[p]) {
        this.audio[p] = on;
        this.djController.setAudioPlaying(p, on);
      }
    });
    if (payload.smoke) {
      this.djController.triggerSmokeBlast(payload.smokeDuration || 2.5, payload.smokeColor || 0xffaa00);
    }
  }

  showWinner(result) {
    if (!result) return;
    const modal = document.getElementById('b-winner-modal');
    const nameEl = document.getElementById('b-winner-name');
    const verdictEl = document.getElementById('b-winner-verdict');

    if (nameEl) nameEl.textContent = (result.winnerName || 'CHAMPION').toUpperCase();
    if (verdictEl) {
      verdictEl.textContent = `${result.decisionMethod || 'OFFICIAL DECISION'}${result.decisionTally ? ` (${result.decisionTally})` : ''}`;
    }

    if (modal) modal.style.display = 'flex';

    // Same reveal as the host stage: face-off, beams on the winner, confetti
    this.djController.startReveal();
    this.djController.revealWinner(result.winnerNum || null);
  }

  hideWinner() {
    const modal = document.getElementById('b-winner-modal');
    if (modal) modal.style.display = 'none';
    this.djController.endReveal();
  }

  resetView() {
    this.hideWinner();

    const s1 = document.getElementById('b-p1-score');
    const s2 = document.getElementById('b-p2-score');
    if (s1) s1.textContent = '0.00';
    if (s2) s2.textContent = '0.00';
  }
}

const broadcast = new BroadcastController();
broadcast.init();
export { broadcast };
