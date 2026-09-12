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
    this.djController.setCameraView('drone');

    // Wire Broadcast Channel
    if (this.channel) {
      this.channel.onmessage = (event) => {
        this.handleBroadcastMessage(event.data);
      };
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

    switch (data.type) {
      case 'STATE_UPDATE':
        this.updateState(data.payload);
        break;

      case 'REVEAL_WINNER':
        this.showWinner(data.payload);
        break;

      case 'DISMISS_WINNER':
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
      if (el) el.textContent = Number(payload.score1).toFixed(1);
    }
    if (payload.score2 !== undefined) {
      const el = document.getElementById('b-p2-score');
      if (el) el.textContent = Number(payload.score2).toFixed(1);
    }

    // Series Tallies
    if (payload.roundsWon1 !== undefined) {
      const el = document.getElementById('b-p1-tally');
      if (el) el.textContent = `${payload.roundsWon1} WINS`;
    }
    if (payload.roundsWon2 !== undefined) {
      const el = document.getElementById('b-p2-tally');
      if (el) el.textContent = `${payload.roundsWon2} WINS`;
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

    // Audio states & camera
    if (payload.audioState1 !== undefined || payload.audioState2 !== undefined) {
      this.djController.setAudioState(1, !!payload.audioState1);
      this.djController.setAudioState(2, !!payload.audioState2);
    }
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
      verdictEl.textContent = `${result.decisionMethod || 'OFFICIAL DECISION'} (${result.decisionTally || ''})`;
    }

    if (modal) modal.style.display = 'flex';

    // Trigger stage pyro
    this.djController.triggerSmokeBlast(4.0, 0xffaa00);
    this.djController.pulse();
  }

  resetView() {
    const modal = document.getElementById('b-winner-modal');
    if (modal) modal.style.display = 'none';

    const s1 = document.getElementById('b-p1-score');
    const s2 = document.getElementById('b-p2-score');
    if (s1) s1.textContent = '0.0';
    if (s2) s2.textContent = '0.0';
  }
}

const broadcast = new BroadcastController();
broadcast.init();
export { broadcast };
