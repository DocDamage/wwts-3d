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
import { BackupManager, BackupPanel } from './backup.js';
import { ToolsMenu } from './toolsMenu.js';
import { Accessibility } from './accessibility.js';
import { Tour } from './tour.js';
import { CAST, CAST_BY_KEY } from './fightCast.js';
import { renderProfileExtras, makeProfileCard, downloadBlob } from './profiles.js';
import { RulesPanel, rulesFor, resolveTie } from './battleRules.js';
import { JudgeStatsPanel } from './judgeStats.js';
import { AudienceVote } from './audienceVote.js';
import { BattleRecorder, ReplayViewer } from './replay.js';
import { DeckWaveforms } from './deckWave.js';
import { OverlayFeed, OverlaysPanel, bracketSummary } from './overlayFeed.js';
import { buildActions, startCommandRelay } from './controlActions.js';
import { MidiMapper, MidiPanel } from './midiMap.js';
import { ChatHype, ChatPanel } from './chatHype.js';
import { sfx } from './sfx.js';
import { EventSettings, EventSettingsPanel } from './eventSettings.js';
import { PlayOrder, showCoinFlip } from './playOrder.js';
import { CorrectionsLog, askReason } from './corrections.js';
import { Calibration, CalibrationPanel } from './calibration.js';
import { guidesFor } from './rubrics.js';
import { RunOfShow, RunOfShowPanel, fmtDelay } from './runOfShow.js';
import { EventTemplates, EventTemplatesPanel } from './eventTemplates.js';
import { Signups, SignupsPanel } from './signups.js';
import { BeatInbox } from './beatInbox.js';
import { CohostLink } from './cohostLink.js';
import { Seasons, SeasonsPanel } from './seasons.js';
import { Cypher } from './cypher.js';
import { Predictions } from './predictions.js';
import { StreamRecorder } from './streamRecorder.js';
import { LeagueStatsPanel } from './leagueStats.js';
import { rosterFromCsv, rosterToCsv, historyToCsv, filterHistory } from './dataIO.js';
import { buildPublicData, renderPublicPage } from './publicPage.js';
import QRCode from 'qrcode';

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
const backup = new BackupManager();
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

// Fairness & format: event settings, coin-flip order, corrections log, judge calibration
const settings = new EventSettings();
const playOrder = new PlayOrder();
const corrections = new CorrectionsLog();
const calibration = new Calibration();
const flipPlayed = new Set();      // flip rounds whose original sample has been played
const battleExtras = [];           // (result) => fields kept with the official record
battleEngine.extrasProvider = (result) => Object.assign({}, ...battleExtras.map(fn => fn(result) || {}));
battleExtras.push(() => ({
  corrections: corrections.log.length ? corrections.export() : undefined,
  playOrder: playOrder.flipped ? playOrder.exportState() : undefined
}));
window.eventSettings = settings;
const ros = new RunOfShow();
const seasons = new Seasons({ leagues });
let seasonsPanel = null;
let cypher = null;
battleExtras.push(() => ({ seasonId: seasons.current()?.id || undefined }));
const signups = new Signups();
window.ros = ros;
window.playOrder = playOrder;
window.corrections = corrections;

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
    c1Name: shownName(1),
    c2Name: shownName(2),
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

// Blind judging: judges, stage and stream see "Beat A / Beat B" (coin-flipped order) until the reveal
const blind = { on: false, swap: false };
function realName(num) {
  const id = num === 1 ? selectedContestant1Id : selectedContestant2Id;
  const c = id ? roster.getById(id) : null;
  return c ? c.name : `Contestant ${num}`;
}
/** The name everyone but the host sees */
function shownName(num) {
  if (!blind.on) return realName(num);
  const isA = (num === 1) !== blind.swap;
  return isA ? 'Beat A' : 'Beat B';
}
function setBlind(on, { silent = false } = {}) {
  blind.on = !!on;
  if (blind.on) {
    blind.swap = playOrder.flipped ? playOrder.first === 2 : Math.random() < 0.5;
    const first = blind.swap ? 2 : 1;
    if (!silent) showToast(`🙈 Blind judging on — Beat A (plays first) is ${realName(first)}. Only you can see this.`);
  } else if (!silent) showToast('Identities revealed');
  document.body.classList.toggle('blind-on', blind.on);
  const chk = document.getElementById('chk-blind');
  if (chk) chk.checked = blind.on;
  updateContestantDisplay(1);
  updateContestantDisplay(2);
  broadcastContestants();
  judgeLink.pushState(true);
  scheduleBroadcastState();
  audio.refreshTitles();
}

/** What a deck shows instead of the file name: "Beat A" (plays first) / "Beat B", names after the reveal */
function deckLabel(num) {
  if (battleEngine.isFinalized) return realName(num);
  if (blind.on) return shownName(num);
  const firstSlot = playOrder.flipped ? playOrder.first : 1;
  return num === firstSlot ? 'Beat A' : 'Beat B';
}

/** [first, second] slots for the current round (coin flip, alternating) */
function roundOrder(r = rounds.currentRound) {
  return playOrder.orderFor(r || 1);
}

/** Coin flip on stage for who plays first */
async function runCoinFlip() {
  const first = playOrder.flip();
  const second = first === 1 ? 2 : 1;
  corrections.add({ action: 'order', round: 1, first });
  if (blind.on) {
    blind.swap = first === 2;
    updateContestantDisplay(1);
    updateContestantDisplay(2);
    broadcastContestants();
  }
  postBroadcast('COIN_FLIP', { first, firstName: shownName(first), secondName: shownName(second) });
  window.lastOverlayCoin = { first: shownName(first), at: Date.now() };
  soundboard.play('needle_drop');
  await showCoinFlip(shownName(first), shownName(second), first, { reduced: document.body.classList.contains('reduced-motion') });
  audio.refreshTitles();
  judgeLink.pushState(true);
  autosaveActiveSession();
  return first;
}

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
    loadFightClub().then(fs => { if (document.querySelector('.main-nav-btn[data-screen="fight"]')?.classList.contains('active')) fs.enter(); });
    setTimeout(() => djController.onResize(), 80);
  } else if (fightScreen?.open) {
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

// Fight Club (player-controlled fighting game): its code loads the first time it's opened
let fightScreen = null;
let fightLoading = null;
function loadFightClub() {
  if (fightScreen) return Promise.resolve(fightScreen);
  fightLoading = fightLoading || import('./fightScreen.js').then(({ FightScreen }) => {
    fightScreen = new FightScreen(djController);
    fightScreen.init();
    fightScreen.onExit = () => switchScreen('battle');
    window.fightScreen = fightScreen;
    return fightScreen;
  });
  return fightLoading;
}
// warm it up once the page is idle so the first visit is instant
(window.requestIdleCallback || ((fn) => setTimeout(fn, 4000)))(() => loadFightClub());

// ============================================================
// League Selector (header dropdown)
// ============================================================
const leagueSelect = document.getElementById('active-league-select');

leagues.onLeagueChange = (league) => {
  if (leagueSelect && league) leagueSelect.value = league.id;
  window.rulesPanel?.apply();
  refreshRoster();
  refreshBattle();
};

leagueSelect?.addEventListener('change', (e) => {
  leagues.setActive(e.target.value || null);
  if (leagues.activeLeagueId) seasons.ensure();
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
  const av = document.getElementById('contestant-avatar-input');
  if (av) av.value = '';
  const colOn = document.getElementById('contestant-color-on');
  if (colOn) colOn.checked = false;
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
  const avatar = document.getElementById('contestant-avatar-input')?.value || '';
  const color = document.getElementById('contestant-color-on')?.checked ? document.getElementById('contestant-color-input').value : '';

  if (editingContestantId) {
    roster.update(editingContestantId, { name, photo, bio, socialLinks, avatar, color });
  } else {
    roster.add({
      name,
      photo,
      bio,
      socialLinks,
      avatar,
      color,
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
  const pStats = renderProfileExtras(document.getElementById('profile-extra'), c, history.history, leagues.getAll());
  const shareBtn = document.getElementById('btn-share-profile');
  if (shareBtn) shareBtn.onclick = async () => {
    shareBtn.disabled = true;
    try {
      const badgeCount = document.querySelectorAll('#profile-badges .badge, #profile-badges [class*=badge]').length;
      const blob = await makeProfileCard(c, pStats, { badges: badgeCount, league: leagues.getActive()?.name });
      downloadBlob(blob, `${c.name.replace(/[^a-z0-9]+/gi, '_')}_card.png`);
      showToast('Profile card saved');
    } finally {
      shareBtn.disabled = false;
    }
  };

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
    document.getElementById('contestant-avatar-input').value = c.avatar || '';
    document.getElementById('contestant-color-on').checked = !!c.color;
    if (c.color) document.getElementById('contestant-color-input').value = c.color;
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
  seasonsPanel?.renderSelector();
  const seasonId = seasonsPanel?.viewSeasonId();
  if (seasonsPanel && seasonId) {
    const rows = seasonsPanel.standings(seasonId);
    const season = seasons.list().find(x => x.id === seasonId);
    if (!rows.length) { el.innerHTML = `<p class="empty-state">No battles in ${esc(season?.name || 'this season')} yet.</p>`; return; }
    const streakTxt = (n) => (n > 0 ? `W${n}` : n < 0 ? `L${-n}` : '—');
    el.innerHTML = `<table>
      <thead><tr><th>#</th><th>Producer</th><th>W</th><th>L</th><th>D</th><th>Pts</th><th>Win %</th><th>Avg</th><th>Form</th><th>Streak</th></tr></thead>
      <tbody>${rows.map(r => `<tr class="${r.qualified ? 'st-qualified' : ''}">
        <td class="st-rank">${r.rank}</td><td class="st-name">${esc(r.name)}</td>
        <td>${r.wins}</td><td>${r.losses}</td><td>${r.draws}</td><td class="st-rating">${r.points}</td>
        <td>${r.battles ? Math.round(r.winRate * 100) + '%' : '—'}</td><td>${r.avgScore ? r.avgScore.toFixed(2) : '—'}</td>
        <td class="st-form">${r.form.map(f => `<i class="f-${f}">${f}</i>`).join('')}</td>
        <td class="${r.streak > 0 ? 'st-hot' : r.streak < 0 ? 'st-cold' : ''}">${streakTxt(r.streak)}</td>
      </tr>`).join('')}</tbody></table>${season?.playoffSpots ? `<p class="st-note">Top ${season.playoffSpots} qualify for the playoffs.</p>` : ''}`;
    return;
  }
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
  applyContestantLook(1);
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
  applyContestantLook(2);
  updatePickerPreviews();
  roster.populateSelect('pick-contestant-1', leagues.activeLeagueId, selectedContestant2Id);
  if (selectedContestant1Id) pick1.value = selectedContestant1Id;
  broadcastContestants();
  updateBattleFlowUI();
  autosaveActiveSession();
});

/** Fill an avatar <select> with the fight cast */
function fillAvatarSelect(sel, keepFirst = false) {
  if (!sel) return;
  const first = keepFirst ? sel.querySelector('option') : null;
  sel.innerHTML = '';
  if (first) sel.appendChild(first);
  CAST.forEach(c => sel.appendChild(new Option(`${c.name} · ${c.style}`, c.key)));
}

/** A contestant's saved stage avatar and colour follow them into the battle */
function applyContestantLook(num) {
  const id = num === 1 ? selectedContestant1Id : selectedContestant2Id;
  const c = id ? roster.getById(id) : null;
  if (c?.avatar && CAST_BY_KEY[c.avatar]) {
    djController.setPlayerAvatar(num, c.avatar).then(() => djController.setPlayerColor(num, c.color || null));
    const sel = document.getElementById(`avatar-select-${num}`);
    if (sel) sel.value = c.avatar;
  } else {
    djController.setPlayerColor(num, c?.color || null);
  }
}

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
  djController.setContestantName(num, shownName(num));
  if (blind.on && displayEl) { displayEl.textContent = `🙈 ${shownName(num)}`; displayEl.title = name; }
  else if (displayEl) displayEl.title = '';
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
    c1Name: shownName(1),
    c1Photo: c1 && !blind.on ? c1.photo : '',
    c2Name: shownName(2),
    c2Photo: c2 && !blind.on ? c2.photo : ''
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

  const reopenBtn = document.getElementById('btn-reopen-round');
  if (reopenBtn) reopenBtn.hidden = !(rounds.isLocked(rounds.currentRound) && !battleEngine.isFinalized);
  renderPenalties();

  if (!flowBtn || !flowLabel) return;

  const phase = battleEngine.phase;
  const isClinched = rounds.isSeriesClinched ? rounds.isSeriesClinched() : false;
  const [firstSlot, secondSlot] = roundOrder();
  const flip = rounds.flipFor();

  switch (phase) {
    case 'setup':
      flowLabel.textContent = !hasContestants ? 'Select Both Contestants'
        : settings.get('coinFlip') && !playOrder.flipped ? '🪙 Flip for Order & Soundcheck' : '▶ Start Soundcheck';
      flowBtn.disabled = !hasContestants;
      break;
    case 'soundcheck':
      flowLabel.textContent = flip && !flipPlayed.has(rounds.currentRound) ? '🎼 Play the Original Sample' : `▶ Play ${shownName(firstSlot)}`;
      flowBtn.disabled = false;
      break;
    case 'sample':
      flowLabel.textContent = '⏭ Sample playing — on to the beats';
      flowBtn.disabled = false;
      break;
    case 'play_a':
      flowLabel.textContent = audio.players[firstSlot]?.playing ? `⏸ Pause ${shownName(firstSlot)}` : `▶ Play ${shownName(firstSlot)}`;
      flowBtn.disabled = false;
      break;
    case 'review_a':
      flowLabel.textContent = `▶ Play ${shownName(secondSlot)}`;
      flowBtn.disabled = false;
      break;
    case 'play_b':
      flowLabel.textContent = audio.players[secondSlot]?.playing ? `⏸ Pause ${shownName(secondSlot)}` : `▶ Play ${shownName(secondSlot)}`;
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

let flowBusy = false;
async function handlePrimaryFlowAction() {
  if (flowBusy) return;
  const phase = battleEngine.phase;
  const isClinched = rounds.isSeriesClinched ? rounds.isSeriesClinched() : false;
  const [firstSlot, secondSlot] = roundOrder();
  const flip = rounds.flipFor();

  if (phase === 'setup') {
    if (!selectedContestant1Id || !selectedContestant2Id) {
      alert('Please select both contestants to begin battle flow.');
      return;
    }
    if (settings.get('coinFlip') && !playOrder.flipped) {
      flowBusy = true;
      try { await runCoinFlip(); } finally { flowBusy = false; }
    } else {
      soundboard.play('needle_drop');
    }
    djController.sendCharacterToDeck(roundOrder()[0]);
    battleEngine.setPhase('soundcheck');
  } else if (phase === 'soundcheck' && flip && !flipPlayed.has(rounds.currentRound)) {
    // Flip round: everyone hears the original sample first
    if (await audio.playSample(flip.url)) {
      battleEngine.setPhase('sample');
      showToast(`🎼 Original sample: ${flip.name}`);
    } else {
      showToast('Couldn\'t play the sample — check the file in 🎼 Flip');
    }
  } else if (phase === 'sample') {
    audio.stopSample();
    flipPlayed.add(rounds.currentRound);
    battleEngine.setPhase('soundcheck');
  } else if (phase === 'soundcheck' || phase === 'play_a') {
    // The round timer follows the deck (see syncTimerToDeck)
    audio.togglePlay(firstSlot);
    if (phase === 'soundcheck') djController.setCameraView('dj_pov');
  } else if (phase === 'review_a' || phase === 'play_b') {
    audio.togglePlay(secondSlot);
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
  finishOverrun();
  timer.pause();
  if (judges.mode === 'panel') judges.saveCurrentJudgeScores();
  rounds.saveCurrentRoundState();
  rounds.updateSeriesTotals();
  const r = rounds.currentRound;
  const reopened = corrections.openReopen(r);
  rounds.lock(r);
  scoring.setRoundLocked(true);
  if (reopened) {
    const now = rounds.rounds[r];
    corrections.add({ action: 'relock', round: r, before: reopened.before, after: { total1: now.total1, total2: now.total2 } });
  }
  battleEngine.setPhase('round_locked');
  soundboard.play('bell');
  updateBattleFlowUI();
  autosaveActiveSession();
}

/** Reopen a locked round — only with a reason, which goes in the record */
async function reopenCurrentRound() {
  const r = rounds.currentRound;
  if (!rounds.isLocked(r) || battleEngine.isFinalized) return;
  const label = r === 4 ? 'overtime' : r === 3 ? 'the final round' : `round ${r}`;
  const reason = await askReason({
    title: `Reopen ${label}?`,
    message: 'Judges and the host can change their scores again. The reason is kept with the battle record and shows in the producer report.',
    placeholder: 'e.g. Judge 2 scored the wrong producer',
    confirmLabel: 'Reopen round'
  });
  if (!reason) return;
  const data = rounds.rounds[r];
  corrections.add({ action: 'reopen', round: r, reason, before: { total1: data.total1, total2: data.total2 } });
  rounds.unlock(r);
  scoring.setRoundLocked(false);
  if (battleEngine.phase === 'round_locked') battleEngine.setPhase('review_b');
  judgeLink.pushState(true);
  showToast(`🔓 ${label[0].toUpperCase() + label.slice(1)} reopened — “${reason}”`);
  updateBattleFlowUI();
  autosaveActiveSession();
}

// ============================================================
// Data in and out: roster CSV, history CSV / JSON, history filters
// ============================================================
function initDataIO() {
  document.getElementById('roster-import')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!leagues.activeLeagueId) { showToast('Pick a league first'); return; }
    const { people, errors } = rosterFromCsv(await file.text());
    let added = 0;
    let updated = 0;
    people.forEach(p => {
      const existing = roster.getAll().find(c => c.name.trim().toLowerCase() === p.name.toLowerCase());
      if (existing) {
        roster.update(existing.id, Object.fromEntries(Object.entries(p).filter(([k, v]) => v && k !== 'name')));
        leagues.addContestant(leagues.activeLeagueId, existing.id);
        updated++;
      } else {
        roster.add({ ...p, leagueId: leagues.activeLeagueId });
        added++;
      }
    });
    showToast(`Roster import: ${added} added, ${updated} updated${errors.length ? ` · ${errors.length} skipped` : ''}`);
    refreshRoster();
    refreshBattle();
  });
  document.getElementById('roster-export')?.addEventListener('click', () => {
    const league = leagues.getActive();
    const list = league ? roster.getForLeague(league.id) : roster.getAll();
    downloadBlob(new Blob([rosterToCsv(list)], { type: 'text/csv' }), `${(league?.name || 'roster').replace(/[^a-z0-9]+/gi, '_')}_roster.csv`);
  });
  const filtered = () => (history.filter ? history.filter(history.getForLeague(leagues.activeLeagueId)) : history.getForLeague(leagues.activeLeagueId));
  document.getElementById('hist-export-csv')?.addEventListener('click', () => {
    const league = leagues.getActive();
    downloadBlob(new Blob([historyToCsv(filtered(), league?.name || '')], { type: 'text/csv' }), `${(league?.name || 'battles').replace(/[^a-z0-9]+/gi, '_')}_results.csv`);
  });
  document.getElementById('hist-export-json')?.addEventListener('click', () => {
    const league = leagues.getActive();
    const data = { app: 'wwts', kind: 'battle-history', league: league?.name, exportedAt: new Date().toISOString(), battles: filtered().map(b => ({ ...b, timeline: undefined })) };
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${(league?.name || 'battles').replace(/[^a-z0-9]+/gi, '_')}_history.json`);
  });
  const ids = ['hf-text', 'hf-judge', 'hf-from', 'hf-to', 'hf-min', 'hf-max'];
  const apply = () => {
    const v = Object.fromEntries(ids.map(id => [id, document.getElementById(id)?.value || '']));
    const any = Object.values(v).some(Boolean);
    history.filter = any ? (list) => filterHistory(list, { text: v['hf-text'], judge: v['hf-judge'], from: v['hf-from'], to: v['hf-to'], minMargin: v['hf-min'], maxMargin: v['hf-max'] }) : null;
    history.renderHistory('history-list', 'history-empty', leagues.activeLeagueId);
  };
  ids.forEach(id => document.getElementById(id)?.addEventListener('input', apply));
}

// ============================================================
// Public league page (Wi-Fi + downloadable) and offline / install
// ============================================================
function initPublicPage() {
  const modal = document.getElementById('public-modal');
  let auto = false;
  try { auto = localStorage.getItem('wwts_public_auto') === 'on'; } catch { /* default off */ }
  const data = () => {
    const league = leagues.getActive();
    const season = seasons.current();
    const standings = seasonsPanel ? seasonsPanel.standings(season?.id || null) : roster.getStandings(league?.id);
    const sum = window.rosPanel?.summary();
    return buildPublicData({
      league, season, standings,
      battles: history.getForLeague(league?.id),
      queue: ros.items,
      nextUp: sum?.nextUp || null
    });
  };
  const status = (t) => { const el = document.getElementById('pub-status'); if (el) el.textContent = t; };
  const publish = async (quiet = false) => {
    try {
      const res = await fetch('/api/public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data()) });
      if (!res.ok) throw new Error(res.status);
      status(`Published ${new Date().toLocaleTimeString()}`);
      if (!quiet) showToast('🌐 League page updated on the Wi-Fi');
      return true;
    } catch {
      status('Couldn\'t publish — the live page needs the app served by "npm run dev" or "npm start".');
      return false;
    }
  };
  modal?.addEventListener('tool-open', async () => {
    await judgeLink.ensureAddress?.();
    const url = `${judgeLink.baseUrl()}/league`;
    document.getElementById('pub-url').textContent = url;
    try { await QRCode.toCanvas(document.getElementById('pub-qr'), url, { width: 170, margin: 1, color: { dark: '#0a0a0e', light: '#ffffff' } }); } catch { /* no canvas */ }
    document.getElementById('pub-auto').checked = auto;
  });
  document.getElementById('pub-auto')?.addEventListener('change', (e) => {
    auto = e.target.checked;
    try { localStorage.setItem('wwts_public_auto', auto ? 'on' : 'off'); } catch { /* ignore */ }
    if (auto) publish();
  });
  document.getElementById('pub-publish')?.addEventListener('click', () => publish());
  document.getElementById('pub-download')?.addEventListener('click', () => {
    const d = data();
    downloadBlob(new Blob([renderPublicPage(d)], { type: 'text/html' }), `${d.league.name.replace(/[^a-z0-9]+/gi, '_')}_standings.html`);
  });
  document.getElementById('pub-preview')?.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([renderPublicPage(data())], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });

  // Install / offline: the service worker only runs in the built app (npm start)
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    const b = document.getElementById('pwa-install');
    if (b) b.hidden = false;
  });
  document.getElementById('pwa-install')?.addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    document.getElementById('pwa-install').hidden = true;
  });
  if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('/sw.js').then(() => {
      const el = document.getElementById('pwa-status');
      if (el) el.textContent = '✓ Offline mode is on: the app, models and sounds are cached on this computer and keep working without internet.';
    }).catch(() => { /* not available */ });
  }
  return { autoPublish: () => { if (auto) publish(true); }, publish, data };
}

// ============================================================
// Flip rounds: one sample, both producers flip it; the original plays first
// ============================================================
function initFlipRounds() {
  const modal = document.getElementById('flip-modal');
  const btn = document.getElementById('btn-flip-round');
  if (!modal || !btn) return;
  let pending = null;   // { name, url } picked in the dialog
  const render = () => {
    const r = rounds.currentRound;
    const f = rounds.flipFor(r);
    document.getElementById('flip-round-label').textContent = r === 4 ? 'overtime' : r === 3 ? 'the final round' : `round ${r}`;
    document.getElementById('flip-current').textContent = f ? `🎼 ${f.name}` : 'Not a flip round';
    document.getElementById('flip-clear').hidden = !f;
    document.getElementById('flip-save').disabled = !pending && !f;
    btn.classList.toggle('active', !!f);
  };
  btn.addEventListener('click', () => { pending = null; render(); modal.style.display = ''; });
  modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-close="flip-modal"]')) modal.style.display = 'none'; });
  document.getElementById('flip-file')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pending = { name: file.name.replace(/\.[^/.]+$/, ''), url: URL.createObjectURL(file) };
    document.getElementById('flip-current').textContent = `🎼 ${pending.name} (not saved yet)`;
    document.getElementById('flip-save').disabled = false;
  });
  document.getElementById('flip-url-go')?.addEventListener('click', () => {
    const url = document.getElementById('flip-url').value.trim();
    if (!url) return;
    pending = { name: decodeURIComponent(url.split('/').pop() || 'Sample').replace(/\.[^/.]+$/, '').slice(0, 40), url };
    document.getElementById('flip-current').textContent = `🎼 ${pending.name} (not saved yet)`;
    document.getElementById('flip-save').disabled = false;
  });
  document.getElementById('flip-preview')?.addEventListener('click', () => {
    const f = pending || rounds.flipFor();
    if (!f) return;
    if (audio.isSamplePlaying()) audio.stopSample(); else audio.playSample(f.url);
  });
  document.getElementById('flip-save')?.addEventListener('click', () => {
    if (pending) rounds.setFlip(rounds.currentRound, pending);
    flipPlayed.delete(rounds.currentRound);
    modal.style.display = 'none';
    judgeLink.pushState(true);
    updateBattleFlowUI();
    showToast(`🎼 Flip round: ${rounds.flipFor().name}`);
    autosaveActiveSession();
  });
  document.getElementById('flip-clear')?.addEventListener('click', () => {
    rounds.setFlip(rounds.currentRound, null);
    audio.stopSample();
    render();
    judgeLink.pushState(true);
    updateBattleFlowUI();
  });
  const prev = rounds.onRoundChange;
  rounds.onRoundChange = (...a) => { prev?.(...a); render(); };
  render();
}

// ============================================================
// Round timer follows the deck: play starts it, pause pauses it,
// switching to the other contestant's beat resets it to the full round time.
// ============================================================
let timerOwner = null; // contestant whose beat the timer is currently tracking

function syncTimerToDeck(playerNum, isPlaying) {
  if (cypher?.active) {   // 3/4-way battle: the clock follows the deck, the 1-v-1 flow stays put
    if (!isPlaying) timer.pause();
    return;
  }
  const phase = battleEngine.phase;
  const roundOpen = !['round_locked', 'finalized'].includes(phase);
  const [firstSlot, secondSlot] = roundOrder();
  if (isPlaying) {
    if (audio.isSamplePlaying()) { audio.stopSample(); flipPlayed.add(rounds.currentRound); }
    if (timerOwner !== playerNum) {
      finishOverrun();
      timer.stop(); // back to the full round time for the new contestant
      timerOwner = playerNum;
      fading = false;
    }
    battleEngine.setActiveContestant(playerNum);
    if (roundOpen && timer.remaining > 0) timer.play();
    if (roundOpen) battleEngine.setPhase(playerNum === firstSlot ? 'play_a' : 'play_b');
  } else if (playerNum === timerOwner) {
    timer.pause();
    finishOverrun();
    if (phase === 'play_a' && playerNum === firstSlot) battleEngine.setPhase('review_a');
    if (phase === 'play_b' && playerNum === secondSlot) battleEngine.setPhase('review_b');
  }
}

// ---- Round time limits: hard stop, 3 s fade, or overrun with penalty points ----
let fading = false;
let overrun = null;   // { slot, round, start, iv }

function startOverrun(slot) {
  overrun = { slot, round: rounds.currentRound, start: performance.now(), iv: null };
  const el = document.getElementById('timer-value');
  el?.classList.add('overrun');
  const tick = () => {
    const secs = Math.floor((performance.now() - overrun.start) / 1000);
    const txt = `+${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    if (el) el.textContent = txt;
    postBroadcast('TIMER_UPDATE', { seconds: 0, formatted: txt, isRunning: true, isOvertime: rounds.currentRound === 4 });
  };
  tick();
  overrun.iv = setInterval(tick, 500);
  showToast(`⏱ ${shownName(slot)} is over time — penalty: ${settings.get('penaltyPer10s')} pt per 10 s`);
}

function finishOverrun() {
  if (!overrun) return;
  clearInterval(overrun.iv);
  document.getElementById('timer-value')?.classList.remove('overrun');
  const seconds = Math.round((performance.now() - overrun.start) / 1000);
  const { slot, round } = overrun;
  overrun = null;
  timer.updateDisplay?.();
  if (seconds < 1) return;
  const points = Math.ceil(seconds / 10) * (Number(settings.get('penaltyPer10s')) || 0);
  if (points <= 0) return;
  rounds.addPenalty(round, slot, points, seconds);
  corrections.add({ action: 'penalty', round, slot, points, seconds });
  showToast(`⏱ ${shownName(slot)} ran ${seconds}s over: −${points.toFixed(1)} on the round`);
  renderPenalties();
  updateBattleFlowUI();
}

function renderPenalties() {
  const r = rounds.currentRound;
  [1, 2].forEach(n => {
    const el = document.getElementById(`penalty-chip-${n}`);
    if (!el) return;
    const p = rounds.penaltyFor(r, n);
    el.hidden = !p;
    el.textContent = p ? `⏱ −${p.toFixed(1)}` : '';
    el.title = p ? `Time-limit penalty this round (${rounds.penalties[r][n].seconds}s over)` : '';
  });
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
  TIEBREAK: 'Wins on Tie-break',
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
  audio.refreshTitles();   // decks show the producers' names now
  ros.complete({ c1Id: finalResult.contestant1.id, c2Id: finalResult.contestant2.id, winnerId: finalResult.winnerId, winnerName: finalResult.winnerName, resultId: finalResult.id });
  window.predictions?.resolve(finalResult.winnerId === selectedContestant1Id ? 1 : finalResult.winnerId === selectedContestant2Id ? 2 : 0);
  setTimeout(() => window.publicPage?.autoPublish(), 1500);
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

  backup.snapshot('battle');
  await runWinnerReveal(finalResult, unlocks);
  hallOfFame.celebrate(unlocks, 2600);
  if (championId) setTimeout(() => showToast(`👑 ${roster.getById(championId)?.name} is the tournament champion!`), 1200);
  refreshBattle();
}

/** Lights down, face-off, drumroll… then the winner */
async function runWinnerReveal(finalResult, unlocks = []) {
  const winNum = finalResult.winnerId === selectedContestant1Id ? 1 : finalResult.winnerId === selectedContestant2Id ? 2 : null;
  window.predictions?.close();
  if (blind.on) setBlind(false);   // the reveal shows who's who
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
  const crowd = window.audienceVotes ? window.audienceVotes() : null;
  window.lastOverlayResult = { winnerName: finalResult.winnerName, decision: `${DECISION_LABELS[finalResult.decisionMethod] || finalResult.decisionMethod}${finalResult.decisionTally ? ` · ${finalResult.decisionTally}` : ''}`, at: Date.now() };
  const crowdLine = crowd ? ` · 📣 People's Choice: ${crowd[1] === crowd[2] ? 'tied' : (crowd[1] > crowd[2] ? finalResult.contestant1?.name : finalResult.contestant2?.name)} (${Math.max(crowd[1], crowd[2])}-${Math.min(crowd[1], crowd[2])})` : '';
  document.getElementById('winner-decision').textContent =
    `${DECISION_LABELS[finalResult.decisionMethod] || finalResult.decisionMethod}${finalResult.decisionTally ? ` · ${finalResult.decisionTally}` : ''}${crowdLine}${finalResult.isDemo ? ' · DEMO (not recorded)' : ''}`;

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
  const rosNext = !next ? ros.next() : null;
  const kothNext = !next && !rosNext && ros.data.mode === 'koth' && ros.data.koth.kingId && ros.data.koth.challengers.length
    ? { c1Name: roster.getById(ros.data.koth.kingId)?.name, c2Name: roster.getById(ros.data.koth.challengers[0])?.name } : null;
  const nextBtn = document.getElementById('btn-winner-next-match');
  if (nextBtn) {
    const n = next ? { a: next.p1Name, b: next.p2Name } : rosNext ? { a: rosNext.c1Name, b: rosNext.c2Name } : kothNext ? { a: kothNext.c1Name, b: kothNext.c2Name } : null;
    nextBtn.style.display = n ? '' : 'none';
    nextBtn.textContent = n ? `⏩ Next: ${n.a} vs ${n.b}` : '⏩ Next Match';
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
  finishOverrun();
  battleEngine.resetBattleSession();
  window.crowdVote?.reset();
  window.recorder?.reset();
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
  else loadNextMatchup();
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
  loadMatchup(player1Id, player2Id);
};

/** Put two producers on the decks for a fresh battle (bracket, run of show, draw) */
function loadMatchup(player1Id, player2Id, { label = '' } = {}) {
  // Complete battle session reset so prior match state cannot carry forward
  battleEngine.resetBattleSession();
  window.crowdVote?.reset();
  window.recorder?.reset();
  closeReveal();

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
  applyContestantLook(1);
  applyContestantLook(2);
  updatePickerPreviews();
  broadcastContestants();
  updateBattleFlowUI();
  if (label) showToast(`📋 ${label}: ${realName(1)} vs ${realName(2)}`);
  window.beatInbox?.autoLoadFor(player1Id, player2Id, 1);
  window.predictions?.openFor?.();
  autosaveActiveSession();
}

/** The run of show's next matchup (or the next King of the Hill challenge) */
function loadNextMatchup() {
  let next = ros.next();
  if (!next && ros.data.mode === 'koth') next = ros.nextChallenge(id => roster.getById(id)?.name || 'Producer');
  if (!next) { showToast('No matchups left in the run of show'); return false; }
  ros.setLive(next.id);
  loadMatchup(next.c1Id, next.c2Id, { label: next.label || 'Run of show' });
  return true;
}

// ============================================================
// Timer integration
// ============================================================
let roundAnnounced = false;

timer.onTick = (remaining) => {
  if (settings.get('timeLimit') === 'fade' && remaining <= 3 && remaining > 0 && !fading && timerOwner && audio.isPlaying(timerOwner)) {
    fading = true;
    audio.fadeOutAndPause(timerOwner, remaining);
  }
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
  fading = false;
  if (settings.get('timeLimit') === 'overrun' && timerOwner && audio.isPlaying(timerOwner)) {
    // the beat keeps going; every started 10 s over costs points
    soundboard.play('timer_alarm');
    startOverrun(timerOwner);
    return;
  }
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
        if (saved.playOrder) playOrder.importState(saved.playOrder);
        if (saved.corrections) corrections.importState(saved.corrections);
        scoring.setRoundLocked(rounds.isLocked(rounds.currentRound));
        renderPenalties();
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
    playOrder: playOrder.exportState(),
    corrections: corrections.export(),
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
    if ((param === 'loaded' || param === 'title') && num) deckControls.onTrackLoaded(num);
    if (param === 'loaded' && num) {
      const lbl = document.getElementById(`deck-file-${num}`);
      if (lbl) { lbl.textContent = audio.players[num].realTitle || ''; lbl.title = 'Only you see the file name — the stage and stream show the anonymous label'; }
    }
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
    window.streamRecorder?.onDeck(playerNum, isPlaying);
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

  // Stage avatar dropdowns (the whole fight cast)
  fillAvatarSelect(document.getElementById('contestant-avatar-input'), true);
  [1, 2].forEach(num => {
    const sel = document.getElementById(`avatar-select-${num}`);
    fillAvatarSelect(sel);
    if (sel) sel.value = djController.currentAvatars?.[num] || sel.value;
    sel?.addEventListener('change', () => {
      djController.setPlayerAvatar(num, sel.value);
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
      contestants: [shownName(1), shownName(2)],
      round,
      roundLabel: round === 4 ? 'Sudden Death OT' : round === 3 ? 'Final Round' : `Round ${round}`,
      locked: scoring.locked || ['round_locked', 'finalized'].includes(battleEngine.phase) || rounds.isLocked(round),
      league: leagues.getActive()?.name,
      calibration: calibration.active ? { id: calibration.active.id, beat: calibration.active.beat } : null,
      flip: !!rounds.flipFor(round),
      flipSample: rounds.flipFor(round)?.name || '',
      commentsOn: !!settings.get('judgeComments'),
      closeMargin: Number(settings.get('closeMargin')) || 0,
      guides: settings.get('showGuides') ? (c) => guidesFor(c, scoring.customGuides) : null,
      ...(cypher?.phoneState() || {})
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
    finishOverrun();
    if (selectedContestant1Id && selectedContestant2Id) window.beatInbox?.autoLoadFor(selectedContestant1Id, selectedContestant2Id, roundNum);
    scoring.setRoundLocked(rounds.isLocked(roundNum));
    renderPenalties();
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

  // Reduced motion / no-flash buttons: owned by the accessibility settings (accessibility.js)

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

  // Event settings: round length, time limits, loudness, anonymous decks, guides, comments, calibration
  const applySetting = (key) => {
    const v = settings.get(key);
    if (key === 'roundSeconds') {
      rounds.roundSeconds = v;
      battleEngine.roundSeconds = v;
      if (!timer.running && rounds.currentRound !== 4) timer.setDuration(v, true);
    }
    if (key === 'loudness' || key === 'loudnessTarget') audio.setLoudness(settings.get('loudness'), settings.get('loudnessTarget'));
    if (key === 'anonymizeBeats') audio.refreshTitles();
    if (key === 'normalizeJudges') {
      judges.normalizer = v ? calibration.normalizer() : null;
      judges.updateConsensusBadge();
      rounds.updateSeriesTotals();
    }
    if (key === 'judgeComments') { scoring.commentsOn = !!v; scoring.rebuildAllSliders(); }
    if (key === 'showGuides') { scoring.showGuides = !!v; scoring.showGuide(1, null); scoring.showGuide(2, null); }
    if (['judgeComments', 'showGuides', 'closeMargin'].includes(key)) judgeLink.pushState();
    if (key === 'coinFlip') updateBattleFlowUI();
  };
  Object.keys(settings.all()).forEach(applySetting);
  settings.onChange(applySetting);
  new EventSettingsPanel(settings).init();
  audio.titleProvider = (num) => (settings.get('anonymizeBeats') ? deckLabel(num) : null);
  audio.onLoudness = (num, info) => {
    const el = document.getElementById(`deck-loud-${num}`);
    if (!el) return;
    if (info.lufs === null || info.lufs === undefined) { el.textContent = ''; el.hidden = true; return; }
    el.hidden = false;
    el.textContent = info.applied ? `${info.lufs.toFixed(1)} LUFS → ${info.gainDb >= 0 ? '+' : ''}${info.gainDb.toFixed(1)} dB` : `${info.lufs.toFixed(1)} LUFS`;
    el.title = info.applied ? `Loudness matched to ${settings.get('loudnessTarget')} LUFS` : 'Loudness matching is off (or this deck plays a direct link)';
  };
  audio.onSampleEnded = () => {
    if (battleEngine.phase !== 'sample') return;
    flipPlayed.add(rounds.currentRound);
    battleEngine.setPhase('soundcheck');
    updateBattleFlowUI();
  };
  judges.penaltyProvider = (r) => ({ 1: rounds.penaltyFor(r, 1), 2: rounds.penaltyFor(r, 2) });
  document.getElementById('btn-reopen-round')?.addEventListener('click', reopenCurrentRound);
  battleEngine.onReset = () => {
    playOrder.reset();
    corrections.reset();
    flipPlayed.clear();
    audio.stopSample();
    scoring.setRoundLocked(false);
    renderPenalties();
    audio.refreshTitles();
  };

  // Run of show, sign-ups + draw, beat inbox, templates
  const rosPanel = new RunOfShowPanel({ ros, roster, leagues, loadMatchup, toast: showToast, tournament });
  rosPanel.init();
  window.rosPanel = rosPanel;
  const signupsPanel = new SignupsPanel({ signups, judgeLink, roster, leagues, ros, toast: showToast, onDraw: () => { refreshRoster(); refreshBattle(); } });
  signupsPanel.init();
  const beatInbox = new BeatInbox({ judgeLink, signups, audio, roster, toast: showToast });
  beatInbox.init();
  window.beatInbox = beatInbox;
  const templates = new EventTemplates({
    settings, scoring, judges, leagues, rulesFor,
    onApplied: () => { window.rulesPanel?.apply?.(); judges.recomputeTotals(); judgeLink.pushState(); updateBattleFlowUI(); }
  });
  new EventTemplatesPanel(templates, { toast: showToast, download: downloadBlob }).init();

  // Seasons (standings per season, playoff line, champions) and 3/4-way battles
  seasons.ensure();
  seasonsPanel = new SeasonsPanel({ seasons, history, roster, leagues, tournament, achievements, toast: showToast, onChange: () => refreshBattle() });
  seasonsPanel.init();
  cypher = new Cypher({
    roster, leagues, scoring, judges, judgeLink, audio, history, timer, settings, announcer, soundboard,
    toast: showToast,
    inbox: beatInbox,
    seasonId: () => seasons.current()?.id || null,
    onFinish: (result) => {
      window.lastOverlayResult = { winnerName: result.winnerName, decision: `${result.placings.length}-way battle · ${result.decisionTally}`, at: Date.now() };
      postBroadcast('BATTLE_FINALIZED', result);
      backup.snapshot('battle');
      refreshBattle();
      refreshRoster();
    }
  });
  cypher.init();
  window.cypher = cypher;
  window.seasons = seasons;

  // Prediction game, recording, league stats, data in/out, public page, offline mode
  const predictions = new Predictions({ judgeLink, getOptions: () => [shownName(1), shownName(2)], toast: showToast });
  predictions.init();
  window.predictions = predictions;
  const streamRecorder = new StreamRecorder({
    djController, audio, toast: showToast,
    getRound: () => rounds.currentRound || 1,
    getName: (n) => (cypher?.active ? cypher.label(cypher.playing ?? 0) : (battleEngine.isFinalized ? realName(n) : shownName(n)))
  });
  streamRecorder.init();
  window.streamRecorder = streamRecorder;
  new LeagueStatsPanel({ history, leagues, roster, seasonsPanel }).init();
  initDataIO();
  window.publicPage = initPublicPage();

  // Judge calibration (reference beat → common scale)
  const calPanel = new CalibrationPanel({ calibration, judges, judgeLink, scoring, audio, settings, toast: showToast });
  calPanel.init();
  calPanel.onChange = () => applySetting('normalizeJudges');
  judgeLink.onCalibrationCard = (deviceId, calId, scores) => calPanel.receive(deviceId, calId, scores);

  // Flip rounds: both producers flip the same sample, which plays first
  initFlipRounds();

  // Battle rules (overtime + tie-break chain) and blind judging
  const rulesPanel = new RulesPanel({ leagues, scoring, rounds, toast: showToast });
  rulesPanel.init();
  window.rulesPanel = rulesPanel;
  battleEngine.tieBreaker = (ctx) => resolveTie(rulesFor(leagues.getActive()), {
    ...ctx,
    rounds: ctx.seriesData?.rounds || null,
    categories: scoring.categories.map(c => c.name),
    audience: window.audienceVotes ? window.audienceVotes() : null,
    names: { 1: ctx.contestant1.name, 2: ctx.contestant2.name },
    askJudge: (names) => (window.confirm(`Still level after the tie-breaks.

Head judge's call — OK for ${names[1]}, Cancel for ${names[2]}.`) ? 1 : 2)
  });
  document.getElementById('chk-blind')?.addEventListener('change', (e) => setBlind(e.target.checked));

  // Crowd vote from phones (+ 🔥 taps hype the stage crowd)
  const crowdVote = new AudienceVote({
    judgeLink,
    getOptions: () => [shownName(1), shownName(2)],
    getRound: () => rounds.currentRound,
    onHype: () => djController.arena?.boost(0.06),
    toast: showToast
  });
  crowdVote.init();
  window.crowdVote = crowdVote;

  // Live chat hype (Twitch / YouTube)
  const chatHype = new ChatHype({ onHype: (v) => djController.arena?.boost(v), getNames: () => [shownName(1), shownName(2)], toast: showToast });
  new ChatPanel(chatHype).init();
  window.chatHype = chatHype;
  if (chatHype.settings.twitch && chatHype.settings.autoConnect) chatHype.connectTwitch(chatHype.settings.twitch);

  // Stream overlays (OBS browser sources) fed through the hub
  const fightSummary = () => {
    const g = fightScreen?.game;
    if (g?.matchActive && g.f) {
      return { names: g.names, hp: { 1: g.f[1].hp, 2: g.f[2].hp }, wins: g.wins, need: g.need, clock: g.opts?.roundTime >= 999 ? '∞' : Math.max(0, Math.ceil(g.clockLeft ?? 0)), combo: { 1: g.f[1].combo, 2: g.f[2].combo } };
    }
    const d = djController.fight;
    if (d?.active && d.hp) return { names: d.names || { 1: 'P1', 2: 'P2' }, hp: d.hp, wins: null, need: 0, clock: '', combo: {} };
    return null;
  };
  const overlayFeed = new OverlayFeed({
    judgeLink,
    build: () => ({
      ...buildBroadcastState(),
      league: leagues.getActive()?.name || '',
      bpm: djController.beatNow?.bpm || null,
      bracket: bracketSummary(tournament, roster),
      crowd: crowdVote.poll ? { title: crowdVote.poll.title, open: crowdVote.poll.open, options: crowdVote.poll.options, counts: crowdVote.counts, url: crowdVote.link.selectedAddress ? `${crowdVote.link.selectedAddress}${crowdVote.link.port ? ':' + crowdVote.link.port : ''}/vote.html` : null } : null,
      fight: fightSummary(),
      chat: chatHype.overlayState(),
      result: window.lastOverlayResult || null,
      show: rosPanel.summary(),
      coin: window.lastOverlayCoin || null,
      predictions: window.predictions?.overlayState?.() || null
    })
  });
  overlayFeed.start();
  new OverlaysPanel({ judgeLink, toast: showToast }).init();

  // Hardware control: one action registry for MIDI learn and Stream Deck / Companion HTTP buttons
  const actions = buildActions({
    audio, timer, rounds, padBank, soundboard, announcer, crowdVote,
    get deckWaves() { return window.deckWaves; },
    toggleActiveDeck,
    lockCurrentRound,
    submit: () => submitBtn?.click(),
    closeReveal,
    toggleBlind: () => setBlind(!blind.on),
    smoke: () => { djController.triggerSmokeBlast(2.8, 0x00e5ff); soundboard.play('airhorn'); },
    hype: () => { announcer.announceHype?.(); djController.arena?.boost(0.4); djController.triggerSmokeBlast(1.6, 0xff2d2d); },
    camera: (v) => document.querySelector(`.cam-btn[data-cam-view="${v}"]`)?.click() || djController.setCameraView(v),
    stageView: () => document.getElementById('btn-stage-view')?.click(),
    primaryFlow: () => handlePrimaryFlowAction(),
    nextMatchup: () => loadNextMatchup(),
    recordToggle: () => window.streamRecorder?.toggle()
  });
  window.controlActions = actions;
  const midi = new MidiMapper(actions, { toast: showToast });
  new MidiPanel(midi, actions).init();
  // reconnect saved mappings silently when MIDI was used before
  if (Object.keys(midi.map).length && navigator.requestMIDIAccess) midi.connect();
  startCommandRelay(actions);

  // Co-host tablet: decks, timer, flow and crowd from a second device (PIN-protected)
  const cohost = new CohostLink({
    judgeLink,
    actions,
    toast: showToast,
    getState: () => {
      const deck = (n) => {
        const st = audio.getDeckState(n);
        return { loaded: st.loaded, playing: st.playing, title: st.title, time: Math.round(st.time), duration: Math.round(st.duration || 0), volume: audio.players[n].mix.channel };
      };
      const r = rounds.currentRound || 1;
      const sum = rosPanel.summary();
      return {
        names: { 1: shownName(1), 2: shownName(2) },
        roundTitle: r === 4 ? 'Overtime' : r === 3 ? 'Final Round' : `Round ${r}`,
        phase: battleEngine.phase,
        flowLabel: document.getElementById('flow-primary-label')?.textContent || '',
        flowDisabled: !!document.getElementById('btn-primary-flow')?.disabled,
        timer: document.getElementById('timer-value')?.textContent || timer.getFormattedTime(),
        timerCritical: timer.running && timer.remaining <= 10,
        decks: { 1: deck(1), 2: deck(2) },
        crossfade: audio.crossfade,
        nextUp: sum.nextUp,
        delay: sum.delay !== null ? fmtDelay(sum.delay) : ''
      };
    }
  });
  cohost.init();

  // Deck waveforms, BPM / key, hot cues
  const deckWaves = new DeckWaveforms(audio);
  deckWaves.init();
  window.deckWaves = deckWaves;

  // Battle timeline recorder + replay viewer
  const recorder = new BattleRecorder(() => {
    const r = rounds.currentRound;
    let judgesIn = 0;
    if (judges.mode === 'panel') { try { judgesIn = judges.getConsensus(r).judges.filter(j => j.scored).length; } catch { /* no panel */ } }
    const tn = battleEngine.timestampedNotes || [];
    return {
      round: r,
      total1: scoring.getTotal(1),
      total2: scoring.getTotal(2),
      deck1: audio.isPlaying(1),
      deck2: audio.isPlaying(2),
      judgesIn,
      locked: !!scoring.locked,
      notes: tn.length,
      lastNote: tn[tn.length - 1]?.text,
      names: { 1: shownName(1), 2: shownName(2) }
    };
  });
  recorder.start();
  window.recorder = recorder;
  battleEngine.timelineProvider = () => recorder.export({ crowd: crowdVote.history });
  const replayViewer = new ReplayViewer();
  replayViewer.init();
  history.onReplay = (battle) => replayViewer.open(battle);

  // Interface sounds (recorded clicks / toggles; off in Accessibility)
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button, [role=menuitem]');
    if (b && !b.disabled && !window.__fightInputActive) sfx.uiSound(b.closest('.modal-close, [data-close]') ? 'close' : 'click');
  }, true);
  document.addEventListener('change', (e) => { if (e.target.matches('input[type=checkbox]')) sfx.uiSound('toggle'); }, true);
  window.sfx = sfx;

  // Tools menu, backups
  const tools = new ToolsMenu({ onAction: (act) => document.dispatchEvent(new CustomEvent('wwts-tool-action', { detail: act })) });
  tools.init();
  const a11y = new Accessibility({ djController });
  a11y.init();
  window.a11y = a11y;
  const tour = new Tour();
  document.addEventListener('wwts-tool-action', (e) => { if (e.detail === 'tour') tour.start(); });
  tour.maybeAutoStart();
  window.toolsMenu = tools;
  new BackupPanel(backup, { toast: showToast }).init();
  new JudgeStatsPanel({ history, leagues }).init();
  backup.startAuto();
  window.backup = backup;

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
