/**
 * BeatBattle Scoring App — Main Entry
 * Wires all modules together, handles screen navigation and battle flow
 */

import { LeagueManager } from './leagues.js';
import { RosterManager } from './roster.js';
import { ScoringEngine, CATEGORIES } from './scoring.js';
import { BattleTimer } from './timer.js';
import { AudioPlayerManager } from './audioPlayer.js';
import { TournamentManager } from './tournament.js';
import { HistoryManager } from './history.js';
import { NotesManager } from './notes.js';
import { DJControllerRenderer } from './djController.js';
import { SoundboardManager } from './soundboard.js';
import { GamepadManager } from './gamepad.js';
import { AnnouncerManager } from './announcer.js';
import { ScoreRadarChart } from './radarChart.js';
import { BattleCardExporter } from './exporter.js';
import { RoundManager } from './rounds.js';
import { JudgeManager } from './judges.js';
import { KeyboardShortcutsManager } from './shortcuts.js';

// ============================================================
// Initialize all modules
// ============================================================
const leagues = new LeagueManager();
const roster = new RosterManager(leagues);
const scoring = new ScoringEngine();
const timer = new BattleTimer();
const audio = new AudioPlayerManager();
const tournament = new TournamentManager(roster, leagues);
const history = new HistoryManager();
const notes = new NotesManager();
const djController = new DJControllerRenderer();
const soundboard = new SoundboardManager();
const gamepad = new GamepadManager();
const announcer = new AnnouncerManager();
const exporter = new BattleCardExporter();
const rounds = new RoundManager(scoring, announcer, djController, timer);
const judges = new JudgeManager(scoring, announcer);
let shortcuts = null;
let radar = null;

// Expose on window for easy dev/test console inspection
window.gamepadManager = gamepad;
window.announcer = announcer;
window.judges = judges;
window.rounds = rounds;

// Current battle state
let selectedContestant1Id = null;
let selectedContestant2Id = null;

// ============================================================
// Screen Navigation
// ============================================================
function switchScreen(screenId) {
  document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.main-nav-btn').forEach(b => b.classList.remove('active'));

  const screen = document.getElementById(`screen-${screenId}`);
  if (screen) screen.classList.add('active');

  const btn = document.querySelector(`.main-nav-btn[data-screen="${screenId}"]`);
  if (btn) btn.classList.add('active');

  // Refresh content for the screen
  if (screenId === 'leagues') refreshLeagues();
  if (screenId === 'roster') refreshRoster();
  if (screenId === 'battle') {
    refreshBattle();
    setTimeout(() => djController.onResize(), 80);
  }
}

document.querySelectorAll('.main-nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchScreen(btn.dataset.screen));
});

// ============================================================
// League Selector (header dropdown)
// ============================================================
const leagueSelect = document.getElementById('active-league-select');

leagues.onLeagueChange = (league) => {
  if (leagueSelect && league) leagueSelect.value = league.id;
  refreshRoster();
  refreshBattle();
};

leagueSelect?.addEventListener('change', (e) => {
  leagues.setActive(e.target.value || null);
});

// ============================================================
// LEAGUE HUB
// ============================================================
function refreshLeagues() {
  leagues.renderLeagueCards('leagues-grid', 'leagues-empty');
  leagues.updateLeagueSelector();
}

// Create league form
const createLeagueBtn = document.getElementById('btn-create-league');
const createLeagueForm = document.getElementById('create-league-form');
const saveLeagueBtn = document.getElementById('btn-save-league');
const cancelLeagueBtn = document.getElementById('btn-cancel-league');

createLeagueBtn?.addEventListener('click', () => {
  createLeagueForm.style.display = '';
  document.getElementById('league-name-input').focus();
});

cancelLeagueBtn?.addEventListener('click', () => {
  createLeagueForm.style.display = 'none';
  clearLeagueForm();
});

saveLeagueBtn?.addEventListener('click', () => {
  const name = document.getElementById('league-name-input')?.value?.trim();
  if (!name) {
    document.getElementById('league-name-input')?.focus();
    return;
  }

  leagues.create({
    name,
    description: document.getElementById('league-desc-input')?.value || '',
    color: document.getElementById('league-color-input')?.value || '#ff2d2d'
  });

  clearLeagueForm();
  createLeagueForm.style.display = 'none';
  refreshLeagues();
});

function clearLeagueForm() {
  const nameInput = document.getElementById('league-name-input');
  const descInput = document.getElementById('league-desc-input');
  const colorInput = document.getElementById('league-color-input');
  if (nameInput) nameInput.value = '';
  if (descInput) descInput.value = '';
  if (colorInput) colorInput.value = '#ff2d2d';
}

// ============================================================
// ROSTER
// ============================================================
function refreshRoster() {
  const leagueId = leagues.activeLeagueId;
  const league = leagues.getActive();

  const sub = document.getElementById('roster-league-name');
  if (sub) sub.textContent = league ? `— ${league.name}` : '';

  roster.renderRosterCards('roster-grid', 'roster-empty', 'roster-no-league', leagueId, (contestantId) => {
    openProfileModal(contestantId);
  });
}

// Add contestant modal
const addContestantBtn = document.getElementById('btn-add-contestant');
const contestantModal = document.getElementById('contestant-modal');
let editingContestantId = null;

addContestantBtn?.addEventListener('click', () => {
  if (!leagues.activeLeagueId) {
    alert('Please select a league first.');
    return;
  }
  editingContestantId = null;
  document.getElementById('contestant-modal-title').textContent = 'Add Contestant';
  clearContestantForm();
  contestantModal.style.display = '';
});

// Close modals
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => {
    const modalId = btn.dataset.close;
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
  });
});

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.style.display = 'none';
  });
});

// Photo upload preview
const photoFile = document.getElementById('contestant-photo-file');
const photoUrl = document.getElementById('contestant-photo-url');
const photoPreview = document.getElementById('contestant-photo-preview');

photoFile?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPhotoPreview(ev.target.result);
    };
    reader.readAsDataURL(file);
  }
});

photoUrl?.addEventListener('blur', () => {
  if (photoUrl.value.trim()) {
    setPhotoPreview(photoUrl.value.trim());
  }
});

function setPhotoPreview(src) {
  if (!photoPreview) return;
  photoPreview.innerHTML = `<img src="${src}" alt="Preview" />`;
}

function clearContestantForm() {
  document.getElementById('contestant-name-input').value = '';
  document.getElementById('contestant-bio-input').value = '';
  document.getElementById('contestant-social-input').value = '';
  document.getElementById('contestant-photo-url').value = '';
  document.getElementById('contestant-edit-id').value = '';
  if (photoPreview) {
    photoPreview.innerHTML = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  }
  if (photoFile) photoFile.value = '';
}

// Save contestant
const saveContestantBtn = document.getElementById('btn-save-contestant');
saveContestantBtn?.addEventListener('click', () => {
  const name = document.getElementById('contestant-name-input')?.value?.trim();
  if (!name) {
    document.getElementById('contestant-name-input')?.focus();
    return;
  }

  // Get photo — either from preview img or URL input
  let photo = '';
  const previewImg = photoPreview?.querySelector('img');
  if (previewImg) {
    photo = previewImg.src;
  } else if (photoUrl?.value?.trim()) {
    photo = photoUrl.value.trim();
  }

  const bio = document.getElementById('contestant-bio-input')?.value || '';
  const socialLinks = document.getElementById('contestant-social-input')?.value || '';

  if (editingContestantId) {
    roster.update(editingContestantId, { name, photo, bio, socialLinks });
  } else {
    roster.add({
      name,
      photo,
      bio,
      socialLinks,
      leagueId: leagues.activeLeagueId
    });
  }

  contestantModal.style.display = 'none';
  clearContestantForm();
  refreshRoster();
  refreshBattle();
  leagues.renderLeagueCards('leagues-grid', 'leagues-empty');
  leagues.updateLeagueSelector();
});

// Profile modal
function openProfileModal(contestantId) {
  const c = roster.getById(contestantId);
  if (!c) return;

  const modal = document.getElementById('profile-modal');
  if (!modal) return;

  // Photo
  const photoEl = document.getElementById('profile-photo');
  if (photoEl) {
    photoEl.innerHTML = c.photo
      ? `<img src="${c.photo}" alt="${c.name}" />`
      : `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  }

  document.getElementById('profile-name').textContent = c.name;
  document.getElementById('profile-bio').textContent = c.bio || 'No bio yet.';
  document.getElementById('profile-social').textContent = c.socialLinks || '';

  // Stats
  document.getElementById('profile-wins').textContent = c.stats.wins;
  document.getElementById('profile-losses').textContent = c.stats.losses;
  document.getElementById('profile-avg').textContent = c.stats.avgScore.toFixed(1);
  document.getElementById('profile-best').textContent = c.stats.bestCategory;

  // Battle history
  const battles = history.getForContestant(contestantId);
  const histList = document.getElementById('profile-history');
  if (histList) {
    if (battles.length === 0) {
      histList.innerHTML = '<p class="empty-state" style="padding:10px">No battles yet.</p>';
    } else {
      histList.innerHTML = '';
      battles.slice(0, 10).forEach(b => {
        const entry = document.createElement('div');
        entry.className = 'history-entry';
        const isC1 = b.contestant1Id === contestantId;
        const opponentName = isC1 ? b.contestant2Name : b.contestant1Name;
        const myScore = isC1 ? b.total1 : b.total2;
        const theirScore = isC1 ? b.total2 : b.total1;
        const won = b.winnerId === contestantId;

        entry.innerHTML = `
          <div>
            <div class="he-name ${won ? 'winner' : ''}">${c.name}</div>
            <div class="he-score">${myScore.toFixed(1)}</div>
          </div>
          <div class="he-vs">VS</div>
          <div class="he-right">
            <div class="he-name ${!won && b.winnerId ? 'winner' : ''}">${opponentName}</div>
            <div class="he-score">${theirScore.toFixed(1)}</div>
          </div>
        `;
        histList.appendChild(entry);
      });
    }
  }

  // Edit/Delete buttons
  const editBtn = document.getElementById('btn-edit-from-profile');
  const deleteBtn = document.getElementById('btn-delete-contestant');

  editBtn.onclick = () => {
    modal.style.display = 'none';
    editingContestantId = contestantId;
    document.getElementById('contestant-modal-title').textContent = 'Edit Contestant';
    document.getElementById('contestant-name-input').value = c.name;
    document.getElementById('contestant-bio-input').value = c.bio;
    document.getElementById('contestant-social-input').value = c.socialLinks;
    if (c.photo) {
      document.getElementById('contestant-photo-url').value = c.photo.startsWith('data:') ? '' : c.photo;
      setPhotoPreview(c.photo);
    }
    contestantModal.style.display = '';
  };

  deleteBtn.onclick = () => {
    if (confirm(`Delete ${c.name}? This cannot be undone.`)) {
      roster.delete(contestantId);
      modal.style.display = 'none';
      refreshRoster();
      refreshBattle();
    }
  };

  modal.style.display = '';
}

// ============================================================
// BATTLE ARENA
// ============================================================
function refreshBattle() {
  const leagueId = leagues.activeLeagueId;
  const league = leagues.getActive();

  const title = document.getElementById('battle-league-title');
  if (title) title.textContent = league ? `Battle Arena — ${league.name}` : 'Battle Arena';

  // Populate contestant pickers
  roster.populateSelect('pick-contestant-1', leagueId, selectedContestant2Id);
  roster.populateSelect('pick-contestant-2', leagueId, selectedContestant1Id);

  // Restore selections
  if (selectedContestant1Id) {
    const sel1 = document.getElementById('pick-contestant-1');
    if (sel1) sel1.value = selectedContestant1Id;
  }
  if (selectedContestant2Id) {
    const sel2 = document.getElementById('pick-contestant-2');
    if (sel2) sel2.value = selectedContestant2Id;
  }

  updatePickerPreviews();

  // History & achievements
  history.renderAchievements('achievements-list', leagueId);
  history.renderHistory('history-list', 'history-empty', leagueId);

  // Notes
  const battles = history.getForLeague(leagueId);
  notes.renderSavedNotes('saved-notes', battles);
}

// Contestant pickers
const pick1 = document.getElementById('pick-contestant-1');
const pick2 = document.getElementById('pick-contestant-2');

pick1?.addEventListener('change', (e) => {
  selectedContestant1Id = e.target.value || null;
  updateContestantDisplay(1);
  updatePickerPreviews();
  // Refresh picker 2 to exclude selected
  roster.populateSelect('pick-contestant-2', leagues.activeLeagueId, selectedContestant1Id);
  if (selectedContestant2Id) pick2.value = selectedContestant2Id;
});

pick2?.addEventListener('change', (e) => {
  selectedContestant2Id = e.target.value || null;
  updateContestantDisplay(2);
  updatePickerPreviews();
  roster.populateSelect('pick-contestant-1', leagues.activeLeagueId, selectedContestant2Id);
  if (selectedContestant1Id) pick1.value = selectedContestant1Id;
});

function updateContestantDisplay(num) {
  const id = num === 1 ? selectedContestant1Id : selectedContestant2Id;
  const c = id ? roster.getById(id) : null;
  const name = c ? c.name : `Contestant ${num}`;
  const displayEl = document.getElementById(`contestant-${num}-display`);
  if (displayEl) {
    displayEl.textContent = name;
  }
  const seriesNameEl = document.getElementById(`series-name-${num}`);
  if (seriesNameEl) {
    seriesNameEl.textContent = name.slice(0, 12);
  }
  djController.setContestantName(num, name);
}

function updatePickerPreviews() {
  [1, 2].forEach(num => {
    const id = num === 1 ? selectedContestant1Id : selectedContestant2Id;
    const c = id ? roster.getById(id) : null;
    const preview = document.getElementById(`picker-preview-${num}`);
    if (!preview) return;

    if (c && c.photo) {
      preview.innerHTML = `<img src="${c.photo}" alt="${c.name}" />`;
      preview.classList.add('has-photo');
    } else {
      preview.innerHTML = '';
      preview.classList.remove('has-photo');
    }
  });
}

// ============================================================
// Submit & Reset
// ============================================================
const submitBtn = document.getElementById('btn-submit');
const resetBtn = document.getElementById('btn-reset');

submitBtn?.addEventListener('click', () => {
  if (!selectedContestant1Id || !selectedContestant2Id) {
    alert('Please select both contestants before submitting.');
    return;
  }

  const c1 = roster.getById(selectedContestant1Id);
  const c2 = roster.getById(selectedContestant2Id);
  if (!c1 || !c2) return;

  const snapshot = scoring.getSnapshot();
  scoring.lock();
  audio.pauseAll();
  timer.stop();

  // Check multi-round series & judge consensus
  const seriesSummary = rounds.getSeriesSummary();
  const hasSeries = seriesSummary.roundsWon1 > 0 || seriesSummary.roundsWon2 > 0;

  let overallWinnerId = null;
  let winnerScore = snapshot.total1;

  if (judges.mode === 'panel') {
    const consensus = judges.getConsensus();
    if (consensus.consensusWinner === 1) {
      overallWinnerId = c1.id;
      winnerScore = consensus.avgTotal1;
    } else if (consensus.consensusWinner === 2) {
      overallWinnerId = c2.id;
      winnerScore = consensus.avgTotal2;
    }
  }

  if (!overallWinnerId) {
    if (hasSeries) {
      if (seriesSummary.roundsWon1 > seriesSummary.roundsWon2) {
        overallWinnerId = c1.id;
        winnerScore = seriesSummary.grandTotal1;
      } else if (seriesSummary.roundsWon2 > seriesSummary.roundsWon1) {
        overallWinnerId = c2.id;
        winnerScore = seriesSummary.grandTotal2;
      } else {
        overallWinnerId = seriesSummary.grandTotal1 > seriesSummary.grandTotal2 ? c1.id : (seriesSummary.grandTotal2 > seriesSummary.grandTotal1 ? c2.id : null);
        winnerScore = seriesSummary.grandTotal1;
      }
    } else {
      overallWinnerId = snapshot.total1 > snapshot.total2 ? c1.id : (snapshot.total2 > snapshot.total1 ? c2.id : null);
      winnerScore = overallWinnerId === c1.id ? snapshot.total1 : snapshot.total2;
    }
  }

  // Record battle in history
  const battle = history.addBattle({
    leagueId: leagues.activeLeagueId,
    contestant1Id: c1.id,
    contestant1Name: c1.name,
    scores1: snapshot.scores1,
    total1: hasSeries ? seriesSummary.grandTotal1 : snapshot.total1,
    contestant2Id: c2.id,
    contestant2Name: c2.name,
    scores2: snapshot.scores2,
    total2: hasSeries ? seriesSummary.grandTotal2 : snapshot.total2,
    notes: notes.getCurrentNote()
  });

  // Update contestant stats
  const c1Won = overallWinnerId === c1.id;
  const c2Won = overallWinnerId === c2.id;
  roster.recordBattle(c1.id, hasSeries ? seriesSummary.grandTotal1 : snapshot.total1, c1Won, snapshot.scores1, CATEGORIES);
  roster.recordBattle(c2.id, hasSeries ? seriesSummary.grandTotal2 : snapshot.total2, c2Won, snapshot.scores2, CATEGORIES);

  // Tournament match recording
  if (tournament.isTournamentActive()) {
    tournament.recordResult(
      c1.id,
      c2.id,
      hasSeries ? seriesSummary.grandTotal1 : snapshot.total1,
      hasSeries ? seriesSummary.grandTotal2 : snapshot.total2,
      hasSeries ? { roundsWon1: seriesSummary.roundsWon1, roundsWon2: seriesSummary.roundsWon2 } : null
    );

    const nextMatch = tournament.getNextPlayableMatch();
    if (nextMatch) {
      showTournamentAdvanceToast(nextMatch);
    }
  }

  // DJ Controller pulse & smoke blast
  djController.pulse();
  djController.triggerSmokeBlast(3.2, 0xffaa00);

  // Soundboard winner bell and crowd cheering
  soundboard.play('bell');
  setTimeout(() => soundboard.play('crowd_cheer'), 400);

  // Announcer winner call tailored to decision
  setTimeout(() => {
    if (judges.mode === 'panel') {
      const consensus = judges.getConsensus();
      if (consensus.decisionType === 'UNANIMOUS') {
        announcer.play('winner', () => {
          setTimeout(() => announcer.play('excellent'), 400);
        });
      } else if (consensus.decisionType === 'SPLIT') {
        announcer.play('winner', () => {
          setTimeout(() => announcer.play('thatwasclose'), 400);
        });
      } else {
        announcer.announceWinner(false);
      }
    } else {
      announcer.announceWinner(false);
    }
  }, 1200);

  // Show winner overlay
  const winner = overallWinnerId ? roster.getById(overallWinnerId) : null;
  if (winner) {
    showWinner(winner.name, winnerScore);
    const winNum = overallWinnerId === c1.id ? 1 : 2;
    const totalEl = document.getElementById(`contestant-${winNum}-total`);
    if (totalEl) totalEl.classList.add('winner-glow');
  } else {
    showWinner('TIE', snapshot.total1);
  }

  // Refresh history/achievements
  refreshBattle();
});

resetBtn?.addEventListener('click', () => {
  scoring.reset();
  rounds.reset();
  judges.reset();
  notes.clear();
  audio.pauseAll();
  timer.stop();
  if (radar) radar.update(scoring.scores[1], scoring.scores[2]);
});

function showTournamentAdvanceToast(nextMatch) {
  let toast = document.getElementById('tournament-advance-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'tournament-advance-toast';
    toast.className = 'tournament-advance-toast';
    document.body.appendChild(toast);
  }

  toast.innerHTML = `
    <div>
      <strong style="font-family:'Orbitron',monospace; font-size:0.82rem; color:#ffaa00;">🏆 MATCH RECORDED</strong>
      <div style="font-size:0.75rem; color:#eaeef8; margin-top:2px;">Next: <strong>${nextMatch.p1Name}</strong> vs <strong>${nextMatch.p2Name}</strong></div>
    </div>
    <div class="toast-actions">
      <button class="toast-btn" id="btn-toast-load-next">Load Match ⏩</button>
      <button class="toast-btn secondary" id="btn-toast-view-bracket">Bracket</button>
      <button class="toast-btn secondary" id="btn-toast-dismiss">✕</button>
    </div>
  `;

  document.getElementById('btn-toast-load-next')?.addEventListener('click', () => {
    toast.remove();
    tournament.selectMatch(nextMatch.round, nextMatch.match);
  });

  document.getElementById('btn-toast-view-bracket')?.addEventListener('click', () => {
    toast.remove();
    tournament.openModal();
  });

  document.getElementById('btn-toast-dismiss')?.addEventListener('click', () => {
    toast.remove();
  });
}

// ============================================================
// Winner Overlay
// ============================================================
function showWinner(name, score) {
  const overlay = document.getElementById('winner-overlay');
  document.getElementById('winner-name').textContent = name;
  document.getElementById('winner-score').textContent = score.toFixed(1) + ' pts';
  overlay.style.display = '';
}

document.getElementById('btn-dismiss-winner')?.addEventListener('click', () => {
  document.getElementById('winner-overlay').style.display = 'none';

  // If tournament, show bracket
  if (tournament.bracket) {
    if (tournament.isTournamentComplete()) {
      const champ = tournament.getTournamentWinner();
      if (champ) {
        setTimeout(() => showWinner('🏆 CHAMPION: ' + champ.name, 0), 300);
        setTimeout(() => tournament.resetTournament(), 5000);
      }
    } else {
      tournament.openModal();
      tournament.renderBracket();
    }
  }

  // Reset for next battle
  scoring.reset();
  notes.clear();
});

// ============================================================
// Bottom Tabs
// ============================================================
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

    tab.classList.add('active');
    const panel = document.getElementById(`tab-${tab.dataset.tab}`);
    if (panel) panel.classList.add('active');
  });
});

// ============================================================
// Tournament integration
// ============================================================
tournament.onMatchSelect = (player1Id, player2Id) => {
  selectedContestant1Id = player1Id;
  selectedContestant2Id = player2Id;

  // Switch to battle screen
  switchScreen('battle');

  // Set pickers
  const sel1 = document.getElementById('pick-contestant-1');
  const sel2 = document.getElementById('pick-contestant-2');
  if (sel1) sel1.value = player1Id;
  if (sel2) sel2.value = player2Id;

  updateContestantDisplay(1);
  updateContestantDisplay(2);
  updatePickerPreviews();

  // Reset scoring for new match
  scoring.reset();
  notes.clear();
};

// ============================================================
// Timer integration
// ============================================================
timer.onStart = () => {
  announcer.announceRoundStart(1);
  djController.triggerSmokeBlast(2.2, 0x00e5ff);
};

timer.onWarning10 = () => {
  announcer.play('countdown10');
};

timer.onComplete = () => {
  audio.pauseAll();
  const speaker = document.getElementById('speaker-icon');
  speaker?.classList.remove('active');
  soundboard.play('timer_alarm');
  announcer.announceTimesUp();
  djController.triggerSmokeBlast(2.2, 0xff2d2d);
};

// ============================================================
// Modern Gamepad & Controller Setup
// ============================================================
function setupGamepadUI() {
  const modal = document.getElementById('controller-guide-modal');
  const badge = document.getElementById('gamepad-status-badge');
  if (!modal || !badge) return;

  // Open modal on badge click
  badge.addEventListener('click', () => {
    modal.style.display = 'flex';
  });

  // Close modal
  modal.querySelectorAll('.modal-close, [data-close="controller-guide-modal"]').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  });

  // Tab switching between console brands
  const tabs = modal.querySelectorAll('.gp-tab');
  const tabPanels = modal.querySelectorAll('.gp-tab-content');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const targetBrand = tab.dataset.brand;
      tabPanels.forEach(p => {
        if (p.dataset.brandPanel === targetBrand) {
          p.classList.add('active');
        } else {
          p.classList.remove('active');
        }
      });
    });
  });

  // Test Rumble button
  const rumbleBtn = document.getElementById('btn-test-rumble');
  rumbleBtn?.addEventListener('click', () => {
    gamepad.rumble(500, 0.9, 0.9);
    const liveMonitor = document.getElementById('gamepad-live-monitor');
    if (liveMonitor) {
      liveMonitor.textContent = 'Rumble Pulse Triggered (Dual-Motor)!';
      liveMonitor.classList.add('active');
      setTimeout(() => {
        liveMonitor.textContent = 'Waiting for input...';
        liveMonitor.classList.remove('active');
      }, 1000);
    }
  });

  // Interactive Test Simulation buttons
  modal.querySelectorAll('.gp-test-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const bIdx = parseInt(btn.dataset.btn);
      if (!isNaN(bIdx)) {
        gamepad.simulateButton(bIdx);
      }
    });
  });

  // Update badge and modal state on connection/disconnection
  gamepad.onStatusChange = (info) => {
    const modalDeviceName = document.getElementById('modal-controller-name');
    const modalDeviceStatus = document.getElementById('modal-controller-status');
    const modalHaptics = document.getElementById('modal-controller-haptics');
    if (info.connected) {
      if (modalDeviceName) modalDeviceName.textContent = info.name;
      if (modalDeviceStatus) {
        modalDeviceStatus.textContent = 'CONNECTED';
        modalDeviceStatus.className = 'status-tag connected';
      }
      if (modalHaptics) {
        modalHaptics.textContent = gamepad.hasHaptics ? 'Dual-Motor Active' : 'Standard';
      }
      // Auto-activate the matching tab
      const matchingTab = modal.querySelector(`.gp-tab[data-brand="${info.type}"]`);
      if (matchingTab) matchingTab.click();
    } else {
      if (modalDeviceName) modalDeviceName.textContent = 'No Controller Detected';
      if (modalDeviceStatus) {
        modalDeviceStatus.textContent = 'STANDBY';
        modalDeviceStatus.className = 'status-tag standby';
      }
      if (modalHaptics) modalHaptics.textContent = 'Unavailable';
    }
  };
}

// ============================================================
// Initialize everything on DOM ready
// ============================================================
function init() {
  // Build scoring sliders
  scoring.buildSliders('contestant-1-sliders', 1);
  scoring.buildSliders('contestant-2-sliders', 2);

  // Timer
  timer.init();

  // Audio
  audio.init();

  // DJ Soundboard
  soundboard.init();
  soundboard.onPlay((soundKey) => {
    djController.triggerSoundReaction(soundKey);
  });

  // Notes
  notes.init();

  // Tournament
  tournament.init();

  // DJ Controller 3D
  djController.init();

  // Connect Audio Player state changes to 3D DJ Stage
  audio.onStateChange((playerNum, isPlaying) => {
    djController.setAudioPlaying(playerNum, isPlaying);
  });

  // Avatar selector buttons (Male / Female)
  document.querySelectorAll('.avatar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const playerNum = parseInt(btn.dataset.player);
      const gender = btn.dataset.avatar;
      document.querySelectorAll(`.avatar-btn[data-player="${playerNum}"]`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      djController.setPlayerAvatar(playerNum, gender);
    });
  });

  // Initialize Announcer
  announcer.init();

  // Stage Camera Director Buttons
  document.querySelectorAll('.cam-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cam-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const viewMode = btn.dataset.camView;
      djController.setCameraView(viewMode);
    });
  });

  // Manual Smoke Blast Button
  const smokeBtn = document.getElementById('btn-manual-smoke');
  smokeBtn?.addEventListener('click', () => {
    djController.triggerSmokeBlast(2.8, 0xffffff);
    smokeBtn.classList.add('active');
    setTimeout(() => smokeBtn.classList.remove('active'), 600);
  });

  // Announcer Hype Call Button
  const hypeBtn = document.getElementById('btn-announcer-hype');
  hypeBtn?.addEventListener('click', () => {
    announcer.announceHype();
    djController.triggerSmokeBlast(1.6, 0xff2d2d);
    hypeBtn.classList.add('active');
    setTimeout(() => hypeBtn.classList.remove('active'), 600);
  });

  // Multi-Round Battle Series
  rounds.init();

  // 3-Judge Panel Manager
  judges.init();

  rounds.onRoundChange = (roundNum, isOvertime) => {
    judges.setCurrentRound(roundNum);
    if (judges.mode === 'panel') {
      const jData = judges.judgeScores[judges.activeJudge]?.[roundNum];
      if (jData) {
        scoring.setScores(1, jData.scores1);
        scoring.setScores(2, jData.scores2);
      }
    }
    if (radar) radar.update(scoring.scores[1], scoring.scores[2]);
  };

  judges.onJudgeChange = (judgeId) => {
    if (radar) radar.update(scoring.scores[1], scoring.scores[2]);
  };

  // Live Head-to-Head Score Radar Chart
  radar = new ScoreRadarChart('score-radar-canvas');
  scoring.onScoreChange = () => {
    if (radar) radar.update(scoring.scores[1], scoring.scores[2]);
    rounds.updateSeriesTotals();
    if (judges.mode === 'panel') {
      judges.saveCurrentJudgeScores();
    }
  };

  // Keyboard Shortcuts & Pro Hotkeys Manager
  shortcuts = new KeyboardShortcutsManager({
    onTimerToggle: () => timer.toggle(),
    onSubmit: () => submitBtn?.click(),
    onReset: () => resetBtn?.click(),
    onSmoke: () => {
      djController.triggerSmokeBlast(2.8, 0x00e5ff);
      soundboard.play('airhorn');
    },
    onHype: () => {
      announcer.announceHype();
      djController.triggerSmokeBlast(1.6, 0xff2d2d);
    },
    onRound: (r) => rounds.switchRound(r),
    onJudgeCycle: () => judges.cycleJudge(),
    onStreamMode: () => {
      document.body.classList.toggle('broadcast-mode-active');
      const active = document.body.classList.contains('broadcast-mode-active');
      const bBtn = document.getElementById('btn-broadcast-mode');
      if (bBtn) {
        bBtn.classList.toggle('active', active);
        bBtn.textContent = active ? '📺 Exit Stream' : '🎥 Stream Mode';
      }
      setTimeout(() => djController.onResize(), 100);
    },
    onScratch: () => {
      audio.triggerVinylScratch(1);
      soundboard.play('needle_stop');
    },
    onDjAction: () => {
      djController.triggerContestantAction(1, 'deck');
    }
  });
  shortcuts.init();

  // OBS Studio / Streamer Broadcast Mode
  const broadcastBtn = document.getElementById('btn-broadcast-mode');
  broadcastBtn?.addEventListener('click', () => {
    document.body.classList.toggle('broadcast-mode-active');
    const active = document.body.classList.contains('broadcast-mode-active');
    broadcastBtn.classList.toggle('active', active);
    broadcastBtn.textContent = active ? '📺 Exit Stream' : '🎥 Stream Mode';
    setTimeout(() => djController.onResize(), 100);
  });

  // Export Official Battle Scorecard PNG
  document.getElementById('btn-export-card')?.addEventListener('click', () => {
    const c1 = selectedContestant1Id ? roster.getById(selectedContestant1Id) : null;
    const c2 = selectedContestant2Id ? roster.getById(selectedContestant2Id) : null;
    const activeLeague = leagues.getActive();
    const snapshot = scoring.getSnapshot();
    const seriesSummary = rounds.getSeriesSummary();

    let decisionBadge = null;
    if (judges.mode === 'panel') {
      const consensus = judges.getConsensus();
      decisionBadge = `${consensus.decisionType} DECISION (${consensus.decisionTally})`;
    }

    let seriesBadge = null;
    if (seriesSummary && (seriesSummary.roundsWon1 > 0 || seriesSummary.roundsWon2 > 0)) {
      seriesBadge = `BEST OF ${seriesSummary.totalRounds}: ${seriesSummary.roundsWon1}W - ${seriesSummary.roundsWon2}W`;
    }

    const c1Won = snapshot.total1 > snapshot.total2;
    const winner = c1Won ? (c1 ? c1.name : 'Contestant 1') : (snapshot.total2 > snapshot.total1 ? (c2 ? c2.name : 'Contestant 2') : 'TIE');

    exporter.exportCard({
      c1Name: c1 ? c1.name : 'Contestant 1',
      c1Score: seriesSummary && seriesSummary.grandTotal1 > 0 ? seriesSummary.grandTotal1 : snapshot.total1,
      c1Scores: snapshot.scores1,
      c2Name: c2 ? c2.name : 'Contestant 2',
      c2Score: seriesSummary && seriesSummary.grandTotal2 > 0 ? seriesSummary.grandTotal2 : snapshot.total2,
      c2Scores: snapshot.scores2,
      winnerName: winner,
      leagueName: activeLeague ? activeLeague.name : 'Who Want That Smoke',
      decisionBadge,
      seriesBadge
    });
  });

  // Gamepad & Modern Controller Support
  gamepad.init({ djController, soundboard, audio, timer });
  setupGamepadUI();

  // Set default league
  if (leagues.getAll().length > 0) {
    leagues.setActive(leagues.getAll()[0].id);
  }

  // Render initial screen
  refreshLeagues();
  switchScreen('leagues');
}

// Start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
