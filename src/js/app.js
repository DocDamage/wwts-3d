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
import { FightScreen } from './fightScreen.js';
import { DJControllerRenderer } from './djController.js';
import { SoundboardManager } from './soundboard.js';
import { GamepadManager } from './gamepad.js';
import { AnnouncerManager } from './announcer.js';
import { ScoreRadarChart } from './radarChart.js';
import { BattleCardExporter } from './exporter.js';
import { RoundManager } from './rounds.js';
import { JudgeManager } from './judges.js';
import { KeyboardShortcutsManager } from './shortcuts.js';
import { BattleSessionEngine } from './battleEngine.js';
import { BattleStorageManager } from './storage.js';
import { ProducerReportModal } from './producerReport.js';
import { OverlayPanelManager } from './overlayPanels.js';
import { CharacterControls } from './characterControls.js';
import { PadBank } from './padBank.js';
import { DeckControls } from './deckControls.js';
import { JudgeLink } from './judgeLink.js';
import { BattleNotepad } from './notepad.js';
import { AchievementEngine } from './achievements.js';
import { HallOfFame } from './hallOfFame.js';

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
const overlayPanels = new OverlayPanelManager();
const characterControls = new CharacterControls(djController);
const soundboard = new SoundboardManager();
const padBank = new PadBank(soundboard, audio);
const deckControls = new DeckControls(djController, audio, padBank);
djController.deckControls = deckControls;
const gamepad = new GamepadManager();
const announcer = new AnnouncerManager();
const exporter = new BattleCardExporter();
const rounds = new RoundManager(scoring, announcer, djController, timer);
const judges = new JudgeManager(scoring, announcer);
const judgeLink = new JudgeLink(judges, scoring);
const storage = new BattleStorageManager();
const producerReport = new ProducerReportModal();
const battleEngine = new BattleSessionEngine({
  scoring,
  rounds,
  judges,
  timer,
  audio,
  notes,
  roster,
  history,
  tournament,
  leagues
});

// Achievements: badges derived from history, league records, tournament titles
const achievements = new AchievementEngine(history, roster);
const hallOfFame = new HallOfFame({
  engine: achievements,
  roster,
  leagues,
  djController,
  announcer,
  getStageSide: (id) => (id === selectedContestant1Id ? 1 : id === selectedContestant2Id ? 2 : null)
});

// 3D notepad for private / public battle notes
const notepad = new BattleNotepad({
  battleEngine,
  audio,
  rounds,
  getNames: () => [1, 2].map(n => {
    const id = n === 1 ? selectedContestant1Id : selectedContestant2Id;
    return (id && roster.getById(id)?.name) || `Contestant ${n}`;
  }),
  onChange: () => autosaveActiveSession()
});

let shortcuts = null;
let radar = null;

// Standalone BroadcastChannel for OBS / 2nd Monitor Screen
let broadcastChannel = null;
try {
  broadcastChannel = new BroadcastChannel('wwts_broadcast');
} catch (e) {
  console.warn('BroadcastChannel not supported in this browser', e);
}

function postBroadcast(type, data) {
  if (!broadcastChannel) return;
  try {
    broadcastChannel.postMessage({ type, data });
  } catch (e) {
    console.warn('BroadcastChannel message error:', e);
  }
  // Every change also refreshes the popout's full picture (names, scores, clock, decks)
  if (type !== 'STATE_UPDATE') scheduleBroadcastState();
}

let broadcastStateQueued = false;
function scheduleBroadcastState() {
  if (broadcastStateQueued || !broadcastChannel) return;
  broadcastStateQueued = true;
  setTimeout(() => {
    broadcastStateQueued = false;
    try { postBroadcast('STATE_UPDATE', buildBroadcastState()); } catch (e) { console.warn('Broadcast state error:', e); }
  }, 0);
}

function buildBroadcastState() {
  const c1 = selectedContestant1Id ? roster.getById(selectedContestant1Id) : null;
  const c2 = selectedContestant2Id ? roster.getById(selectedContestant2Id) : null;
  const ss = rounds.getSeriesSummary();
  const r = rounds.currentRound || 1;
  return {
    c1Name: c1 ? c1.name : 'Contestant 1',
    c2Name: c2 ? c2.name : 'Contestant 2',
    score1: scoring.getTotal(1),
    score2: scoring.getTotal(2),
    roundsWon1: ss.roundsWon1 || 0,
    roundsWon2: ss.roundsWon2 || 0,
    roundTitle: r === 4 ? 'Overtime' : r === 3 ? 'Final Round' : `Round ${r}`,
    timerFormatted: timer.getFormattedTime(),
    timerCritical: timer.running && timer.remaining <= 10,
    audioState1: audio.isPlaying(1),
    audioState2: audio.isPlaying(2),
    avatar1: djController.currentAvatars?.[1],
    avatar2: djController.currentAvatars?.[2]
  };
}

// A popout opened mid-battle asks for the current state
if (broadcastChannel) {
  broadcastChannel.onmessage = (e) => {
    if (e.data?.type === 'HELLO') scheduleBroadcastState();
  };
}

// Expose on window for easy dev/test console inspection
window.gamepadManager = gamepad;
window.announcer = announcer;
window.judges = judges;
window.rounds = rounds;
window.battleEngine = battleEngine;
window.storage = storage;
window.producerReport = producerReport;
window.djController = djController;
window.padBank = padBank;
window.audioPlayer = audio;

// Current battle state
let selectedContestant1Id = null;
let selectedContestant2Id = null;

// ============================================================
// Screen Navigation
// ============================================================
function switchScreen(screenId) {
  document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.main-nav-btn').forEach(b => b.classList.remove('active'));

  // Fight Club runs on top of the battle stage
  const screen = document.getElementById(`screen-${screenId === 'fight' ? 'battle' : screenId}`);
  if (screen) screen.classList.add('active');
  if (screenId !== 'battle') overlayPanels.setStageView(false);
  if (screenId === 'fight') {
    fightScreen.enter();
    setTimeout(() => djController.onResize(), 80);
  } else if (fightScreen.open) {
    fightScreen.leave();
  }

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

// Fight Club (player-controlled fighting game)
const fightScreen = new FightScreen(djController);
fightScreen.init();
fightScreen.onExit = () => switchScreen('battle');
window.fightScreen = fightScreen;

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
      ? `<img src="${esc(c.photo)}" alt="${esc(c.name)}" />`
      : `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  }

  document.getElementById('profile-name').textContent = c.name;
  document.getElementById('profile-bio').textContent = c.bio || 'No bio yet.';
  document.getElementById('profile-social').textContent = c.socialLinks || '';

  // Stats
  document.getElementById('profile-wins').textContent = c.stats.wins;
  document.getElementById('profile-losses').textContent = c.stats.losses;
  document.getElementById('profile-avg').textContent = c.stats.avgScore.toFixed(2);
  document.getElementById('profile-best').textContent = c.stats.bestCategory;
  hallOfFame.renderProfile(contestantId);

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
            <div class="he-score">${myScore.toFixed(2)}</div>
          </div>
          <div class="he-vs">VS</div>
          <div class="he-right">
            <div class="he-name ${!won && b.winnerId ? 'winner' : ''}">${opponentName}</div>
            <div class="he-score">${theirScore.toFixed(2)}</div>
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
  if (title) title.textContent = league ? league.name : 'Who Want That Smoke';

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

  // Standings, history & achievements
  renderStandings(leagueId);
  hallOfFame.render(leagueId);
  history.renderHistory('history-list', 'history-empty', leagueId);

  // Notes from earlier battles
  notepad.renderArchive(history.getForLeague(leagueId));
  notepad.render();
}

function renderStandings(leagueId) {
  const el = document.getElementById('standings-table');
  if (!el) return;
  const rows = leagueId ? roster.getStandings(leagueId) : [];
  if (!rows.length) {
    el.innerHTML = '<p class="empty-state">No contestants in this league yet.</p>';
    return;
  }
  const streak = (n) => (n > 0 ? `W${n}` : n < 0 ? `L${-n}` : '—');
  el.innerHTML = `<table>
    <thead><tr><th>#</th><th>Producer</th><th>W</th><th>L</th><th>D</th><th>Win %</th><th>Rating</th><th>Avg</th><th>Streak</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td class="st-rank">${r.rank}</td>
      <td class="st-name">${esc(r.name)}</td>
      <td>${r.wins}</td><td>${r.losses}</td><td>${r.draws}</td>
      <td>${r.battles ? Math.round(r.winRate * 100) + '%' : '—'}</td>
      <td class="st-rating">${r.rating}</td>
      <td>${r.avgScore ? r.avgScore.toFixed(2) : '—'}</td>
      <td class="${r.streak > 0 ? 'st-hot' : r.streak < 0 ? 'st-cold' : ''}">${streak(r.streak)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
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
  broadcastContestants();
  updateBattleFlowUI();
  autosaveActiveSession();
});

pick2?.addEventListener('change', (e) => {
  selectedContestant2Id = e.target.value || null;
  updateContestantDisplay(2);
  updatePickerPreviews();
  roster.populateSelect('pick-contestant-1', leagues.activeLeagueId, selectedContestant2Id);
  if (selectedContestant1Id) pick1.value = selectedContestant1Id;
  broadcastContestants();
  updateBattleFlowUI();
  autosaveActiveSession();
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
  notepad.render();
  const dockTitle = document.getElementById(`dock-title-${num}`);
  if (dockTitle) dockTitle.textContent = `${name} · Moves`;
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

/** Small transient notice in the corner (judge joins, submissions…) */
function showToast(message) {
  let host = document.getElementById('app-toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'app-toasts';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'app-toast';
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.classList.add('leaving'), 3200);
  setTimeout(() => el.remove(), 3700);
}

function broadcastContestants() {
  const c1 = selectedContestant1Id ? roster.getById(selectedContestant1Id) : null;
  const c2 = selectedContestant2Id ? roster.getById(selectedContestant2Id) : null;
  postBroadcast('CONTESTANTS_UPDATE', {
    c1Name: c1 ? c1.name : 'Contestant 1',
    c1Photo: c1 ? c1.photo : '',
    c2Name: c2 ? c2.name : 'Contestant 2',
    c2Photo: c2 ? c2.photo : ''
  });
}

// ============================================================
// Host Battle Sequence & Readiness Desk
// Set up → Soundcheck → Play A → Review A → Play B → Review B → Lock round → Reveal result → Next round or match
// ============================================================
function updateBattleFlowUI() {
  judgeLink.pushState();
  const chipContestants = document.getElementById('ready-contestants');
  const chipAudio = document.getElementById('ready-audio');
  const chipJudges = document.getElementById('ready-judges');
  const chipPreset = document.getElementById('ready-preset');
  const presetNameEl = document.getElementById('ready-preset-name');
  const flowBtn = document.getElementById('btn-primary-flow');
  const flowLabel = document.getElementById('flow-primary-label');

  const hasContestants = !!(selectedContestant1Id && selectedContestant2Id);
  const hasAudio = !!(audio.players[1]?.loaded || audio.players[2]?.loaded);
  const judgesReady = judges.mode === 'solo' ? true : (judges.getConsensus()?.isComplete ?? false);

  if (chipContestants) chipContestants.classList.toggle('ready', hasContestants);
  if (chipAudio) chipAudio.classList.toggle('ready', hasAudio);
  if (chipJudges) chipJudges.classList.toggle('ready', judgesReady);
  if (chipPreset) chipPreset.classList.add('ready');
  if (presetNameEl) presetNameEl.textContent = scoring.getPresetName();

  if (!flowBtn || !flowLabel) return;

  const phase = battleEngine.phase;
  const isClinched = rounds.isSeriesClinched ? rounds.isSeriesClinched() : false;

  switch (phase) {
    case 'setup':
      flowLabel.textContent = hasContestants ? '▶ Start Soundcheck' : 'Select Both Contestants';
      flowBtn.disabled = !hasContestants;
      break;
    case 'soundcheck':
      flowLabel.textContent = '▶ Play Contestant A';
      flowBtn.disabled = false;
      break;
    case 'play_a':
      flowLabel.textContent = audio.players[1]?.playing ? '⏸ Pause Contestant A' : '▶ Play Contestant A';
      flowBtn.disabled = false;
      break;
    case 'review_a':
      flowLabel.textContent = '▶ Play Contestant B';
      flowBtn.disabled = false;
      break;
    case 'play_b':
      flowLabel.textContent = audio.players[2]?.playing ? '⏸ Pause Contestant B' : '▶ Play Contestant B';
      flowBtn.disabled = false;
      break;
    case 'review_b':
      flowLabel.textContent = '🔒 Lock Round Scorecard';
      flowBtn.disabled = false;
      break;
    case 'round_locked':
      if (isClinched || rounds.currentRound >= 3) {
        flowLabel.textContent = '🏆 Finalize & Reveal Result';
      } else {
        flowLabel.textContent = '⏩ Advance to Next Round';
      }
      flowBtn.disabled = false;
      break;
    case 'finalized':
      flowLabel.textContent = '📊 View Producer Report';
      flowBtn.disabled = false;
      break;
    default:
      flowLabel.textContent = '▶ Start Battle';
      flowBtn.disabled = false;
  }
}

function handlePrimaryFlowAction() {
  const phase = battleEngine.phase;
  const isClinched = rounds.isSeriesClinched ? rounds.isSeriesClinched() : false;

  if (phase === 'setup') {
    if (!selectedContestant1Id || !selectedContestant2Id) {
      alert('Please select both contestants to begin battle flow.');
      return;
    }
    soundboard.play('needle_drop');
    djController.sendCharacterToDeck(1);
    battleEngine.setPhase('soundcheck');
  } else if (phase === 'soundcheck' || phase === 'play_a') {
    // The round timer follows the deck (see syncTimerToDeck)
    audio.togglePlay(1);
    if (phase === 'soundcheck') djController.setCameraView('dj_pov');
  } else if (phase === 'review_a' || phase === 'play_b') {
    audio.togglePlay(2);
    if (phase === 'review_a') djController.setCameraView('dj_pov');
  } else if (phase === 'review_b') {
    lockCurrentRound();
  } else if (phase === 'round_locked') {
    if (isClinched || (rounds.currentRound >= 3 && !rounds.isSeriesTied()) || rounds.currentRound === 4) {
      handleFinalizeBattle();
    } else {
      rounds.nextRound();
      battleEngine.setActiveContestant(1);
      battleEngine.setPhase('soundcheck');
    }
  } else if (phase === 'finalized') {
    if (battleEngine.finalizedResult) {
      producerReport.open(battleEngine.finalizedResult);
    }
  }
  updateBattleFlowUI();
}

// Flow Quick Controls
document.getElementById('btn-primary-flow')?.addEventListener('click', handlePrimaryFlowAction);

document.getElementById('btn-flow-pause-all')?.addEventListener('click', () => {
  audio.pauseAll(); // the timer pauses with the deck
  updateBattleFlowUI();
});

document.getElementById('btn-flow-stop-all')?.addEventListener('click', () => {
  audio.pauseAll();
  const live = timerOwner;
  if (live) audio.seek(live, audio.players[live].cuePoint || 0);
  timer.stop();
  updateBattleFlowUI();
});

document.getElementById('btn-flow-lock-round')?.addEventListener('click', lockCurrentRound);

/** Freeze the round: stop the beat and timer, store the round, lock phones */
function lockCurrentRound() {
  audio.pauseAll();
  timer.pause();
  if (judges.mode === 'panel') judges.saveCurrentJudgeScores();
  rounds.saveCurrentRoundState();
  rounds.updateSeriesTotals();
  battleEngine.setPhase('round_locked');
  soundboard.play('bell');
  updateBattleFlowUI();
}

// ============================================================
// Round timer follows the deck: play starts it, pause pauses it,
// switching to the other contestant's beat resets it to the full round time.
// ============================================================
let timerOwner = null; // contestant whose beat the timer is currently tracking

function syncTimerToDeck(playerNum, isPlaying) {
  const phase = battleEngine.phase;
  const roundOpen = !['round_locked', 'finalized'].includes(phase);
  if (isPlaying) {
    if (timerOwner !== playerNum) {
      timer.stop(); // back to the full round time for the new contestant
      timerOwner = playerNum;
    }
    battleEngine.setActiveContestant(playerNum);
    if (roundOpen && timer.remaining > 0) timer.play();
    if (roundOpen) battleEngine.setPhase(playerNum === 1 ? 'play_a' : 'play_b');
  } else if (playerNum === timerOwner) {
    timer.pause();
    if (phase === 'play_a' && playerNum === 1) battleEngine.setPhase('review_a');
    if (phase === 'play_b' && playerNum === 2) battleEngine.setPhase('review_b');
  }
}

/** Space / gamepad: play-pause whichever contestant's beat is up */
function toggleActiveDeck() {
  const deck = timerOwner || battleEngine.activeContestant || 1;
  if (!audio.players[deck]?.loaded) {
    showToast(`Load Contestant ${deck}'s beat first`);
    return;
  }
  audio.togglePlay(deck);
}

// ============================================================
// Submit & Reset (Central Authority via BattleSessionEngine)
// ============================================================
const submitBtn = document.getElementById('btn-submit');
const resetBtn = document.getElementById('btn-reset');

const DECISION_LABELS = {
  UNANIMOUS: 'Unanimous Decision',
  SPLIT: 'Split Decision',
  MAJORITY: 'Majority Decision',
  ROUNDS_WON: 'Wins the Series',
  SUDDEN_DEATH: 'Sudden Death Victory',
  TOTAL_POINTS: 'Wins on Points',
  DRAW: 'Draw',
  INCOMPLETE_PANEL: 'Panel Incomplete — No Decision'
};
const roundLabel = (r) => (r === 4 ? 'OT' : r === 3 ? 'Final' : `R${r}`);
const wait = (ms) => new Promise(res => setTimeout(res, ms));
function esc(v) {
  return String(v ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

/** Submit: checks, official result, then the on-stage reveal */
async function handleFinalizeBattle() {
  if (!selectedContestant1Id || !selectedContestant2Id) {
    alert('Please select both contestants before submitting.');
    return;
  }
  if (battleEngine.isFinalized && battleEngine.finalizedResult) {
    showWinner(battleEngine.finalizedResult);
    return;
  }

  // Bank the card on screen and the current round before deciding anything
  if (judges.mode === 'panel') judges.saveCurrentJudgeScores();
  rounds.saveCurrentRoundState();
  const summary = rounds.getSeriesSummary();
  if (!summary.roundsPlayed) {
    showToast('Score at least one round before submitting.');
    return;
  }

  if (judges.mode === 'panel') {
    const pending = [1, 2, 3, 4]
      .filter(r => summary.roundWinners[r])
      .map(r => ({ r, c: judges.getConsensus(r) }))
      .filter(x => !x.c.isComplete);
    if (pending.length) {
      const lines = pending.map(x => `${roundLabel(x.r)}: waiting on ${x.c.judges.filter(j => !j.scored).map(j => j.judgeName).join(', ')}`).join('\n');
      if (!confirm(`Not every judge has turned in a card:\n\n${lines}\n\nSubmit anyway? Rounds without a full panel are decided by the judges who scored.`)) return;
    }
  } else if (scoring.hasUnscoredCategories(1) || scoring.hasUnscoredCategories(2)) {
    const missing = scoring.getUnscoredCount(1) + scoring.getUnscoredCount(2);
    if (!confirm(`${missing} categor${missing === 1 ? 'y is' : 'ies are'} still unscored and will count as 0. Submit anyway?`)) return;
  }

  const res = battleEngine.finalizeCurrentBattle(selectedContestant1Id, selectedContestant2Id);
  if (!res || !res.success) {
    alert(res?.error || 'Unable to finalize battle.');
    return;
  }
  const finalResult = res.result;
  storage.clearActiveSession();
  postBroadcast('BATTLE_FINALIZED', finalResult);
  updateBattleFlowUI();
  // Tournament complete → crown the champion
  let championId = null;
  if (!finalResult.isDemo && tournament.bracket && tournament.isTournamentComplete()) {
    const champ = tournament.getTournamentWinner();
    if (champ && achievements.addTitle(champ.id, { tournamentId: tournament.bracket.id, name: tournament.bracket.name || 'Tournament Champion' })) {
      championId = champ.id;
    }
  }
  const unlocks = finalResult.isDemo ? [] : hallOfFame.collectUnlocks([finalResult.contestant1.id, finalResult.contestant2.id]);
  finalResult.unlocks = unlocks.map(u => ({ contestantId: u.contestantId, id: u.badge.id, tier: u.badge.tier }));

  await runWinnerReveal(finalResult, unlocks);
  hallOfFame.celebrate(unlocks, 2600);
  if (championId) setTimeout(() => showToast(`👑 ${roster.getById(championId)?.name} is the tournament champion!`), 1200);
  refreshBattle();
}

/** Lights down, face-off, drumroll… then the winner */
async function runWinnerReveal(finalResult, unlocks = []) {
  const winNum = finalResult.winnerId === selectedContestant1Id ? 1 : finalResult.winnerId === selectedContestant2Id ? 2 : null;
  document.body.classList.add('reveal-mode');
  closeTabDrawer();
  audio.pauseAll();
  timer.pause();
  djController.startReveal();
  postBroadcast('REVEAL_START', {});
  setTimeout(() => announcer.play('whowillwin'), 350);
  audio.playDrumroll(2.8);
  await wait(2950);

  djController.revealWinner(winNum);
  postBroadcast('REVEAL_WINNER', {
    winnerNum: winNum,
    winnerName: winNum ? finalResult.winnerName : 'DRAW',
    decisionMethod: DECISION_LABELS[finalResult.decisionMethod] || finalResult.decisionMethod,
    decisionTally: finalResult.decisionTally || ''
  });
  soundboard.play('crowd_cheer');
  const method = finalResult.decisionMethod;
  setTimeout(() => {
    if (!winNum) {
      announcer.play('thatwasclose');
    } else {
      const follow = method === 'UNANIMOUS' ? 'untouchable'
        : method === 'SPLIT' ? 'thatwasclose'
        : method === 'SUDDEN_DEATH' ? 'itsallontheline'
        : 'excellent';
      announcer.play('winner', () => setTimeout(() => announcer.play(follow), 350));
    }
  }, 300);

  if (winNum) document.getElementById(`contestant-${winNum}-total`)?.classList.add('winner-glow');
  lastFightResult = { winNum, names: { 1: finalResult.contestant1?.name, 2: finalResult.contestant2?.name } };
  clearTimeout(fightTimer);
  if (autoFightEnabled()) fightTimer = setTimeout(() => startResultFight(), 3400);
  const reportBtn = document.getElementById('btn-view-report');
  if (reportBtn) reportBtn.style.display = 'inline-flex';
  showWinner(finalResult, unlocks);
}

// ============================================================
// Post-battle fight: the winner of the battle wins the brawl
// ============================================================
let lastFightResult = null;
let fightTimer = null;
const autoFightEnabled = () => {
  try { return localStorage.getItem('wwts_auto_fight') !== 'off'; } catch { return true; }
};

function startResultFight() {
  if (!lastFightResult || !document.body.classList.contains('reveal-mode')) return;
  const seed = Math.floor(Math.random() * 1e9);
  document.body.classList.add('fight-mode');
  djController.startFight(lastFightResult.winNum || null, lastFightResult.names, seed);
  postBroadcast('FIGHT_START', { winner: lastFightResult.winNum || null, names: lastFightResult.names, seed });
}

djController.fight.onEnd = () => {
  document.body.classList.remove('fight-mode');
  postBroadcast('FIGHT_STOP', {});
};

document.getElementById('btn-winner-fight')?.addEventListener('click', () => startResultFight());
const autoFightBox = document.getElementById('chk-auto-fight');
if (autoFightBox) {
  autoFightBox.checked = autoFightEnabled();
  autoFightBox.addEventListener('change', () => {
    try { localStorage.setItem('wwts_auto_fight', autoFightBox.checked ? 'on' : 'off'); } catch {}
  });
}

/** Fill the results card (lower third, the stage stays visible above it) */
function showWinner(finalResult, unlocks = []) {
  const overlay = document.getElementById('winner-overlay');
  if (!overlay || !finalResult) return;
  const c1 = finalResult.contestant1;
  const c2 = finalResult.contestant2;
  const winNum = finalResult.winnerId === c1.id ? 1 : finalResult.winnerId === c2.id ? 2 : null;
  const ss = finalResult.seriesSummary || {};
  const rr = finalResult.roundResults || [];
  const avg1 = ss.avgRound1 ?? rr[0]?.total1 ?? 0;
  const avg2 = ss.avgRound2 ?? rr[0]?.total2 ?? 0;

  document.getElementById('winner-kicker').textContent = winNum ? 'THE WINNER IS' : finalResult.decisionMethod === 'INCOMPLETE_PANEL' ? 'NO DECISION' : "IT'S A";
  document.getElementById('winner-name').textContent = winNum ? finalResult.winnerName : finalResult.decisionMethod === 'INCOMPLETE_PANEL' ? 'Judges Still Scoring' : 'DRAW';
  overlay.dataset.winner = winNum || 'draw';
  document.getElementById('winner-decision').textContent =
    `${DECISION_LABELS[finalResult.decisionMethod] || finalResult.decisionMethod}${finalResult.decisionTally ? ` · ${finalResult.decisionTally}` : ''}${finalResult.isDemo ? ' · DEMO (not recorded)' : ''}`;

  const side = (n, name, score) => `
    <div class="ws-side p${n} ${winNum === n ? 'won' : ''}">
      <span class="ws-name">${esc(name)}</span>
      <span class="ws-score">${Number(score).toFixed(2)}</span>
    </div>`;
  document.getElementById('winner-scoreline').innerHTML =
    `${side(1, c1.name, avg1)}<span class="ws-vs">${rr.length > 1 ? 'AVG / 100' : 'OUT OF 100'}</span>${side(2, c2.name, avg2)}`;

  document.getElementById('winner-rounds').innerHTML = `<h4>Rounds</h4>` + rr.map(r => {
    const w = r.panel?.winner ?? r.winner;
    const tag = w === 1 ? esc(c1.name) : w === 2 ? esc(c2.name) : 'Draw';
    return `<div class="wr-row">
      <span class="wr-label">${roundLabel(r.round)}</span>
      <span class="wr-score ${w === 1 ? 'won' : ''}">${r.total1.toFixed(2)}</span>
      <span class="wr-score p2 ${w === 2 ? 'won' : ''}">${r.total2.toFixed(2)}</span>
      <span class="wr-tag">${tag}${r.panel ? ` <small>${esc(r.panel.decisionTally)}</small>` : ''}</span>
    </div>`;
  }).join('');

  const lastPanel = [...rr].reverse().find(r => r.panel)?.panel;
  const judgesEl = document.getElementById('winner-judges');
  judgesEl.hidden = !lastPanel;
  if (lastPanel) {
    judgesEl.innerHTML = `<h4>Judges${rr.length > 1 ? ` · ${roundLabel([...rr].reverse().find(r => r.panel).round)}` : ''}</h4>` + lastPanel.judges.map(j => `
      <div class="wj-row">
        <span class="wj-name">${j.phone ? '📱 ' : ''}${esc(j.name)}</span>
        <span class="wj-pick ${j.winner === 1 ? 'p1' : j.winner === 2 ? 'p2' : ''}">${!j.scored ? '—' : j.winner === 1 ? esc(c1.name) : j.winner === 2 ? esc(c2.name) : 'Draw'}</span>
        <span class="wj-cards">${j.total1.toFixed(2)} – ${j.total2.toFixed(2)}</span>
      </div>`).join('');
  }

  const statsEl = document.getElementById('winner-stats');
  const standings = roster.getStandings(finalResult.leagueId || leagues.activeLeagueId);
  const statLine = (c, n) => {
    const p = roster.getById(c.id);
    const st = p?.stats || {};
    const row = standings.find(x => x.id === c.id);
    const rc = finalResult.ratingChanges?.[c.id];
    const change = rc ? `<span class="wst-delta ${rc.change >= 0 ? 'up' : 'down'}">${rc.change >= 0 ? '+' : ''}${rc.change}</span>` : '';
    return `<div class="wst-row p${n}">
      <span class="wst-name">${esc(c.name)}</span>
      <span>${st.wins || 0}-${st.losses || 0}${st.draws ? `-${st.draws}` : ''}</span>
      <span>${rc ? rc.after : roster.ratingOf(p || {})} ${change}</span>
      <span>${row ? `#${row.rank}` : '—'}</span>
    </div>`;
  };
  statsEl.innerHTML = finalResult.isDemo
    ? '<h4>Standings</h4><p class="wst-demo">Demo battle — records and ratings unchanged.</p>'
    : `<h4>Standings</h4><div class="wst-row wst-head"><span></span><span>Record</span><span>Rating</span><span>Rank</span></div>${statLine(c1, 1)}${statLine(c2, 2)}`
      + (unlocks.length ? `<div class="wst-badges">${unlocks.map(u => `<span class="wst-badge" title="${esc(u.name)}: ${esc(u.badge.desc)}">${u.badge.icon} ${esc(u.badge.name)}${u.badge.tierLabel ? ` · ${esc(u.badge.tierLabel)}` : ''}</span>`).join('')}</div>` : '');

  const next = tournament.bracket && !tournament.isTournamentComplete() ? tournament.getNextPlayableMatch() : null;
  const nextBtn = document.getElementById('btn-winner-next-match');
  if (nextBtn) {
    nextBtn.style.display = next ? '' : 'none';
    nextBtn.textContent = next ? `⏩ Next: ${next.p1Name} vs ${next.p2Name}` : '⏩ Next Match';
  }
  overlay.style.display = 'flex';
}

function closeReveal() {
  clearTimeout(fightTimer);
  document.body.classList.remove('fight-mode');
  const overlay = document.getElementById('winner-overlay');
  if (overlay) overlay.style.display = 'none';
  document.body.classList.remove('reveal-mode');
  djController.endReveal();
  postBroadcast('DISMISS_WINNER', {});
}

function handleResetBattle() {
  battleEngine.resetBattleSession();
  storage.clearActiveSession();
  updateContestantDisplay(1);
  updateContestantDisplay(2);
  if (radar) radar.update(scoring.scores[1], scoring.scores[2]);
  const reportBtn = document.getElementById('btn-view-report');
  if (reportBtn) reportBtn.style.display = 'none';
  renderTimestampedNotesList();
  updateBattleFlowUI();
  postBroadcast('BATTLE_RESET', {});
}

submitBtn?.addEventListener('click', handleFinalizeBattle);
resetBtn?.addEventListener('click', handleResetBattle);

// ============================================================
// Results card buttons
// ============================================================
document.getElementById('btn-close-winner')?.addEventListener('click', closeReveal);

document.getElementById('btn-dismiss-winner')?.addEventListener('click', () => {
  closeReveal();
  // Tournament: crown a champion or show the updated bracket
  if (tournament.bracket) {
    if (!tournament.isTournamentComplete()) {
      tournament.openModal();
      tournament.renderBracket();
    }
  }
  handleResetBattle();
});

document.getElementById('btn-winner-next-match')?.addEventListener('click', () => {
  const next = tournament.bracket && !tournament.isTournamentComplete() ? tournament.getNextPlayableMatch() : null;
  closeReveal();
  if (next) tournament.selectMatch(next.matchId);
});

document.getElementById('btn-winner-report')?.addEventListener('click', () => {
  if (battleEngine.finalizedResult) producerReport.open(battleEngine.finalizedResult);
});

document.getElementById('btn-winner-export')?.addEventListener('click', () => {
  document.getElementById('btn-export-card')?.click();
});

// ============================================================
// Bottom Tabs
// ============================================================
// Tabs open a drawer over the 3D stage; clicking the active tab again closes it
const tabDrawer = document.getElementById('tab-content');

function closeTabDrawer() {
  tabDrawer?.classList.remove('open');
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
}

document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    // The bracket lives in its own (bigger) window
    if (tab.dataset.tab === 'bracket') {
      tournament.openModal();
      return;
    }
    const wasActive = tab.classList.contains('active');
    closeTabDrawer();
    if (wasActive) return;

    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const panel = document.getElementById(`tab-${tab.dataset.tab}`);
    if (panel) panel.classList.add('active');
    tabDrawer?.classList.add('open');
    if (tab.dataset.tab === 'h2h') radar?.update(scoring.scores[1], scoring.scores[2]);
  });
});

document.getElementById('btn-tab-drawer-close')?.addEventListener('click', closeTabDrawer);

function openNotesTab() {
  const tab = document.querySelector('.nav-tab[data-tab="notes"]');
  if (tab && !tab.classList.contains('active')) tab.click();
  setTimeout(() => notepad.focusInput(), 60);
}

// ============================================================
// Tournament integration
// ============================================================
tournament.onShowProfile = (id) => openProfileModal(id);
tournament.onChange = updateTournamentButton;

/** Tournament button doubles as "View Bracket" while one is running */
function updateTournamentButton() {
  const btn = document.getElementById('btn-tournament');
  if (!btn) return;
  const label = tournament.bracket ? (tournament.isTournamentComplete() ? '🏆 Final Bracket' : '🏆 View Bracket') : 'Tournament';
  const textNode = [...btn.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
  if (textNode) textNode.textContent = ` ${label} `;
  btn.classList.toggle('has-tournament', !!tournament.bracket);
}

tournament.onMatchSelect = (player1Id, player2Id, match) => {
  if (match) setTimeout(() => showToast(`🏆 ${tournament.bracket?.name} · ${tournament.matchLabel(match)}`), 300);
  // Complete battle session reset so prior match state cannot carry forward
  battleEngine.resetBattleSession();

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
  broadcastContestants();
  updateBattleFlowUI();
};

// ============================================================
// Timer integration
// ============================================================
let roundAnnounced = false;

timer.onTick = (remaining) => {
  postBroadcast('TIMER_UPDATE', {
    seconds: remaining,
    formatted: timer.getFormattedTime(),
    isRunning: timer.running,
    isOvertime: rounds.currentRound === 4
  });
};

timer.onStart = (fresh) => {
  // Hype only on a fresh start; resuming a paused beat stays quiet
  if (fresh) {
    if (!roundAnnounced) announcer.announceRoundStart(rounds.currentRound || 1);
    else announcer.play('fight');
    roundAnnounced = true;
    djController.triggerSmokeBlast(2.2, timerOwner === 2 ? 0x00e5ff : 0xff2d2d);
  }
  postBroadcast('TIMER_UPDATE', {
    seconds: timer.remaining,
    formatted: timer.getFormattedTime(),
    isRunning: true,
    isOvertime: rounds.currentRound === 4
  });
  updateBattleFlowUI();
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
  postBroadcast('TIMER_UPDATE', {
    seconds: 0,
    formatted: '0:00',
    isRunning: false,
    isOvertime: rounds.currentRound === 4
  });
  if (battleEngine.phase === 'play_a') {
    battleEngine.setPhase('review_a');
  } else if (battleEngine.phase === 'play_b') {
    battleEngine.setPhase('review_b');
  }
  updateBattleFlowUI();
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
// ============================================================
// Crash Recovery & Continuous Autosave
// ============================================================
function checkCrashRecovery() {
  const banner = document.getElementById('session-recovery-banner');
  if (!banner) return;

  if (storage.hasActiveSession()) {
    const saved = storage.loadActiveSession();
    const desc = document.getElementById('recovery-desc');
    if (desc && saved) {
      const c1Name = saved.c1Id ? (roster.getById(saved.c1Id)?.name || 'Contestant 1') : 'Contestant 1';
      const c2Name = saved.c2Id ? (roster.getById(saved.c2Id)?.name || 'Contestant 2') : 'Contestant 2';
      desc.textContent = `Resume active match: ${c1Name} vs ${c2Name} (Round ${saved.currentRound || 1})?`;
    }
    banner.style.display = 'flex';

    document.getElementById('btn-resume-battle')?.addEventListener('click', () => {
      if (saved) {
        if (saved.c1Id) {
          selectedContestant1Id = saved.c1Id;
          const sel1 = document.getElementById('pick-contestant-1');
          if (sel1) sel1.value = saved.c1Id;
          updateContestantDisplay(1);
        }
        if (saved.c2Id) {
          selectedContestant2Id = saved.c2Id;
          const sel2 = document.getElementById('pick-contestant-2');
          if (sel2) sel2.value = saved.c2Id;
          updateContestantDisplay(2);
        }
        // Same session id → phones pick their saved cards back up
        if (saved.sessionId) battleEngine.sessionId = saved.sessionId;
        if (saved.rounds) rounds.importState(saved.rounds);
        if (saved.currentRound && saved.currentRound !== rounds.currentRound) {
          rounds.switchRound(saved.currentRound);
        }
        if (saved.judges) {
          judges.importState(saved.judges);
          judgeLink.resyncSeats();
        }
        if (saved.scores1 && saved.scores2 && judges.mode !== 'panel') {
          scoring.setScores(1, saved.scores1);
          scoring.setScores(2, saved.scores2);
        }
        if (saved.phase && saved.phase !== 'finalized') battleEngine.setPhase(saved.phase);
        if (saved.timestampedNotes) {
          battleEngine.timestampedNotes = saved.timestampedNotes;
          renderTimestampedNotesList();
        }
        updatePickerPreviews();
        banner.style.display = 'none';
        switchScreen('battle');
        updateBattleFlowUI();
        broadcastContestants();
      }
    });

    document.getElementById('btn-discard-battle')?.addEventListener('click', () => {
      storage.clearActiveSession();
      banner.style.display = 'none';
    });
  }
}

function autosaveActiveSession() {
  if (battleEngine.isFinalized || !selectedContestant1Id || !selectedContestant2Id) return;
  storage.saveActiveSession({
    c1Id: selectedContestant1Id,
    c2Id: selectedContestant2Id,
    scores1: scoring.scores[1],
    scores2: scoring.scores[2],
    currentRound: rounds.currentRound,
    rounds: rounds.exportState(),
    judges: judges.exportState(),
    sessionId: battleEngine.sessionId,
    phase: battleEngine.phase,
    timestampedNotes: battleEngine.getTimestampedNotes(),
    isFinalized: false
  });
}

function renderTimestampedNotesList() {
  notepad.render();
}

// ============================================================
// Initialize everything on DOM ready
// ============================================================
function init() {
  // Initialize Producer Report Modal
  producerReport.init();

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
    postBroadcast('SOUND', { soundKey });
  });

  // Performance pads (20, mirrored on the 3D controller)
  padBank.onTrigger = (index) => deckControls.flashPad(index);
  padBank.onChange = () => deckControls.refreshPadColors();
  padBank.init();
  document.getElementById('soundboard-volume')?.addEventListener('input', (e) => padBank.setVolume(parseFloat(e.target.value)));

  // Keep the 2D strip and the 3D controller in sync with the mixer
  audio.onMixChange = (num, param, value) => {
    if (param === 'loaded' && num) deckControls.onTrackLoaded(num);
    if (param === 'channel' && num) {
      const vol = document.querySelector(`.audio-volume[data-player="${num}"]`);
      if (vol && document.activeElement !== vol) vol.value = value;
    }
  };

  // Notes
  notes.init();

  // Tournament
  tournament.init();
  updateTournamentButton();

  // DJ Controller 3D & Real Audio Reactivity
  djController.init();
  overlayPanels.init();
  characterControls.init();
  djController.setAudioPlayer(audio);

  // Connect Audio Player state changes to 3D DJ Stage
  audio.onStateChange((playerNum, isPlaying) => {
    syncTimerToDeck(playerNum, isPlaying);
    djController.setAudioPlaying(playerNum, isPlaying);
    // Center record spins while either deck plays, tinted to the deck that's live
    const record = document.getElementById('speaker-icon');
    if (record) {
      const anyPlaying = audio.isPlaying(1) || audio.isPlaying(2);
      record.classList.toggle('active', anyPlaying);
      if (isPlaying) {
        record.classList.remove('deck-1', 'deck-2');
        record.classList.add(`deck-${playerNum}`);
      }
    }
    postBroadcast('AUDIO_UPDATE', { playerNum, isPlaying });
    updateBattleFlowUI();
  });

  // Avatar selector buttons (Male / Female)
  document.querySelectorAll('.avatar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const playerNum = parseInt(btn.dataset.player);
      const gender = btn.dataset.avatar;
      document.querySelectorAll(`.avatar-btn[data-player="${playerNum}"]`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      djController.setPlayerAvatar(playerNum, gender);
      scheduleBroadcastState();
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

  // Judge panel (host-screen seats + phone judges over local Wi-Fi)
  judges.init();
  rounds.scoreProvider = (round) => judges.getPanelCard(round);
  judgeLink.stateProvider = () => {
    const c1 = selectedContestant1Id ? roster.getById(selectedContestant1Id) : null;
    const c2 = selectedContestant2Id ? roster.getById(selectedContestant2Id) : null;
    const round = rounds.currentRound;
    return {
      battleId: battleEngine.sessionId,
      contestants: [c1 ? c1.name : 'Contestant 1', c2 ? c2.name : 'Contestant 2'],
      round,
      roundLabel: round === 4 ? 'Sudden Death OT' : round === 3 ? 'Final Round' : `Round ${round}`,
      locked: scoring.locked || ['round_locked', 'finalized'].includes(battleEngine.phase),
      league: leagues.getActive()?.name
    };
  };
  judgeLink.onScoresUpdated = () => {
    rounds.updateSeriesTotals();
    if (radar) radar.update(scoring.scores[1], scoring.scores[2]);
    updateBattleFlowUI();
    autosaveActiveSession();
  };
  judgeLink.onToast = showToast;
  judgeLink.onJudgeNote = (seat, payload) => {
    const note = notepad.add({
      text: payload.text,
      contestant: payload.contestant === 1 || payload.contestant === 2 ? payload.contestant : null,
      visibility: payload.visibility,
      author: judges.judgeNames[seat] || `Judge ${seat}`
    });
    if (note) showToast(`📝 ${judges.judgeNames[seat]}: “${note.text.slice(0, 40)}${note.text.length > 40 ? '…' : ''}”`);
  };
  // Any phase change (lock, reset, finalize) reaches the phones, however it was triggered
  const prevPhaseHandler = battleEngine.onPhaseChange;
  battleEngine.onPhaseChange = (...args) => {
    prevPhaseHandler?.(...args);
    judgeLink.pushState();
  };
  judgeLink.init();

  // Demo Mode Auto-Vary Button
  const autoVaryBtn = document.getElementById('btn-auto-vary-judges');
  autoVaryBtn?.addEventListener('click', () => {
    // judges.init() wires the actual variation; here we only flag the battle as a demo
    battleEngine.setDemoMode(true);
    autoVaryBtn.innerHTML = '🎲 Auto-Vary <span style="font-size:0.68rem; color:#ffaa00;">[DEMO]</span>';
  });

  rounds.onRoundChange = (roundNum, isOvertime) => {
    judges.setCurrentRound(roundNum);
    if (judges.mode === 'panel') judges.loadActiveCard();
    audio.pauseAll();
    timer.stop();
    timerOwner = null;
    roundAnnounced = false;
    judges.renderUI();
    judgeLink.pushState();
    if (radar) radar.update(scoring.scores[1], scoring.scores[2]);
    const seriesSummary = rounds.getSeriesSummary();
    postBroadcast('ROUND_UPDATE', {
      currentRound: roundNum,
      isOvertime,
      roundsWon1: seriesSummary.roundsWon1,
      roundsWon2: seriesSummary.roundsWon2,
      totalRounds: seriesSummary.totalRounds
    });
    updateBattleFlowUI();
    autosaveActiveSession();
  };

  judges.onJudgeChange = (judgeId) => {
    if (radar) radar.update(scoring.scores[1], scoring.scores[2]);
    updateBattleFlowUI();
  };

  // Live Head-to-Head Score Radar Chart
  radar = new ScoreRadarChart('score-radar-canvas');
  scoring.onScoreChange = () => {
    if (radar) radar.update(scoring.scores[1], scoring.scores[2]);
    rounds.updateSeriesTotals();
    if (judges.mode === 'panel') {
      judges.saveCurrentJudgeScores();
    }
    postBroadcast('SCORES_UPDATE', {
      total1: scoring.getTotal(1),
      total2: scoring.getTotal(2)
    });
    autosaveActiveSession();
  };

  // Scoring Engine Preset and Step Selectors
  const presetSelect = document.getElementById('scoring-preset-select');
  const onRulesChanged = () => {
    if (presetSelect) presetSelect.value = scoring.presetId;
    judges.recomputeTotals();
    judgeLink.pushState();
    if (radar) radar.update(scoring.scores[1], scoring.scores[2]);
    rounds.updateSeriesTotals();
    updateBattleFlowUI();
    autosaveActiveSession();
  };
  presetSelect?.addEventListener('change', (e) => {
    if (e.target.value === 'custom') return;
    scoring.setPreset(e.target.value);
    scoring.buildWeightsEditor('weights-editor-list', onRulesChanged);
    onRulesChanged();
  });

  // Weights popover: toggle categories and adjust weights live
  const weightsBtn = document.getElementById('btn-edit-weights');
  const weightsPopover = document.getElementById('weights-popover');
  weightsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = weightsPopover.hidden;
    if (opening) scoring.buildWeightsEditor('weights-editor-list', onRulesChanged);
    weightsPopover.hidden = !opening;
  });
  document.getElementById('btn-weights-reset')?.addEventListener('click', () => {
    scoring.setPreset('classic10');
    scoring.buildWeightsEditor('weights-editor-list', onRulesChanged);
    onRulesChanged();
  });
  document.addEventListener('click', (e) => {
    if (weightsPopover && !weightsPopover.hidden && !weightsPopover.contains(e.target) && e.target !== weightsBtn) {
      weightsPopover.hidden = true;
    }
  });

  const stepSelect = document.getElementById('scoring-step-select');
  stepSelect?.addEventListener('change', (e) => {
    scoring.setStep(parseFloat(e.target.value));
    scoring.buildSliders('contestant-1-sliders', 1);
    scoring.buildSliders('contestant-2-sliders', 2);
    judgeLink.pushState();
  });

  // Battle notepad (+ N opens it and focuses the pen)
  notepad.init();
  window.addEventListener('keydown', (e) => {
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code !== 'KeyN' || !document.getElementById('screen-battle')?.classList.contains('active')) return;
    e.preventDefault();
    openNotesTab();
  });

  // Post-Battle Producer Report Button
  document.getElementById('btn-view-report')?.addEventListener('click', () => {
    if (battleEngine.finalizedResult) {
      producerReport.open(battleEngine.finalizedResult);
    }
  });

  // Standalone Popout Stream View Button
  document.getElementById('btn-open-broadcast-popout')?.addEventListener('click', () => {
    window.open('broadcast.html', 'WWTS_Broadcast_Screen', 'width=1920,height=1080');
  });

  // Reduced Motion & No-Flash Accessibility Toggles
  const motionBtn = document.getElementById('btn-toggle-motion');
  let reducedMotion = false;
  motionBtn?.addEventListener('click', () => {
    reducedMotion = !reducedMotion;
    document.body.classList.toggle('reduced-motion', reducedMotion);
    djController.setReducedMotion(reducedMotion);
    motionBtn.classList.toggle('active', reducedMotion);
  });

  const flashBtn = document.getElementById('btn-toggle-flash');
  let noFlash = false;
  flashBtn?.addEventListener('click', () => {
    noFlash = !noFlash;
    document.body.classList.toggle('no-flash', noFlash);
    djController.setNoFlash(noFlash);
    flashBtn.classList.toggle('active', noFlash);
  });

  // Keyboard Shortcuts & Pro Hotkeys Manager
  shortcuts = new KeyboardShortcutsManager({
    onTimerToggle: () => toggleActiveDeck(),
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
      audio.playScratchSound?.(1);
      soundboard.play('needle_stop');
    },
    onDjAction: () => {
      djController.sendCharacterToDeck(1);
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
    const activeLeague = leagues.getActive();
    const leagueName = activeLeague ? activeLeague.name : 'Who Want That Smoke';

    if (battleEngine.isFinalized && battleEngine.finalizedResult) {
      exporter.exportFinalizedCard(battleEngine.finalizedResult, leagueName);
      return;
    }

    // Draft export fallback
    const c1 = selectedContestant1Id ? roster.getById(selectedContestant1Id) : null;
    const c2 = selectedContestant2Id ? roster.getById(selectedContestant2Id) : null;
    const snapshot = scoring.getSnapshot();
    const seriesSummary = rounds.getSeriesSummary();

    let decisionBadge = 'DRAFT CARD';
    if (judges.mode === 'panel') {
      const consensus = judges.getConsensus();
      decisionBadge = `DRAFT (${consensus.decisionType})`;
    }

    exporter.exportCard({
      c1Name: c1 ? c1.name : 'Contestant 1',
      c1Score: seriesSummary && seriesSummary.grandTotal1 > 0 ? seriesSummary.grandTotal1 : snapshot.total1,
      c1Scores: snapshot.scores1,
      c2Name: c2 ? c2.name : 'Contestant 2',
      c2Score: seriesSummary && seriesSummary.grandTotal2 > 0 ? seriesSummary.grandTotal2 : snapshot.total2,
      c2Scores: snapshot.scores2,
      winnerName: 'IN PROGRESS',
      leagueName,
      decisionBadge,
      seriesBadge: null,
      isDemo: battleEngine.isDemoMode
    });
  });

  // Gamepad & Modern Controller Support
  gamepad.init({ djController, soundboard, audio, timer });
  gamepad.onToggleBeat = toggleActiveDeck;
  setupGamepadUI();

  // Check Crash Recovery
  checkCrashRecovery();

  // Update initial battle flow status
  updateBattleFlowUI();

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
