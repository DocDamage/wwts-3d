/**
 * History & Achievements — battle records and unlockable achievements
 */

const STORAGE_KEY = 'beatbattle_history';

const ACHIEVEMENT_DEFS = [
  { id: 'first_battle', name: 'First Blood', desc: 'Complete your first battle', icon: '⚔️', check: (h) => h.length >= 1 },
  { id: 'five_battles', name: 'Veteran', desc: 'Complete 5 battles', icon: '🎖️', check: (h) => h.length >= 5 },
  { id: 'ten_battles', name: 'War Machine', desc: 'Complete 10 battles', icon: '🏅', check: (h) => h.length >= 10 },
  { id: 'perfect_10', name: 'Perfect 10', desc: 'Score a 10.0 in any category', icon: '💯', check: (h) => h.some(b => [...b.scores1, ...b.scores2].some(s => s === 10)) },
  { id: 'sweep', name: 'Clean Sweep', desc: 'Win with all categories at 8+', icon: '🧹', check: (h) => h.some(b => {
    const winnerScores = b.total1 > b.total2 ? b.scores1 : b.scores2;
    return winnerScores.every(s => s >= 8);
  })},
  { id: 'close_call', name: 'Photo Finish', desc: 'Battle decided by less than 1 point', icon: '📸', check: (h) => h.some(b => Math.abs(b.total1 - b.total2) < 1 && Math.abs(b.total1 - b.total2) > 0) },
  { id: 'blowout', name: 'Blowout', desc: 'Win by 30+ points', icon: '💥', check: (h) => h.some(b => Math.abs(b.total1 - b.total2) >= 30) },
  { id: 'tie', name: 'Draw', desc: 'End a battle in a tie', icon: '🤝', check: (h) => h.some(b => b.total1 === b.total2) },
];

class HistoryManager {
  constructor() {
    this.history = [];
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.history = raw ? JSON.parse(raw) : [];
    } catch {
      this.history = [];
    }
  }

  save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.history));
  }

  /**
   * Add an official finalized battle result (Single Source of Truth)
   */
  addFinalizedBattle(finalResult) {
    if (!finalResult) return null;

    const battle = {
      id: finalResult.id || ('b_' + Date.now()),
      leagueId: finalResult.leagueId || null,
      contestant1Id: finalResult.contestant1?.id || 'c1',
      contestant1Name: finalResult.contestant1?.name || 'Contestant 1',
      scores1: finalResult.roundResults?.[0]?.scores1 || [],
      total1: finalResult.seriesSummary?.grandTotal1 ?? (finalResult.roundResults?.[0]?.total1 || 0),
      contestant2Id: finalResult.contestant2?.id || 'c2',
      contestant2Name: finalResult.contestant2?.name || 'Contestant 2',
      scores2: finalResult.roundResults?.[0]?.scores2 || [],
      total2: finalResult.seriesSummary?.grandTotal2 ?? (finalResult.roundResults?.[0]?.total2 || 0),
      winnerId: finalResult.winnerId, // Strictly official! Never recalculated!
      winnerName: finalResult.winnerName,
      decisionMethod: finalResult.decisionMethod || 'TOTAL_POINTS',
      decisionTally: finalResult.decisionTally || '',
      isDemo: !!finalResult.isDemo,
      seriesSummary: finalResult.seriesSummary || null,
      roundResults: finalResult.roundResults || [],
      scoringRules: finalResult.scoringRules || null,
      notes: finalResult.notes || '',
      timestamp: finalResult.timestamp || new Date().toISOString()
    };

    this.history.unshift(battle);
    this.save();
    return battle;
  }

  /**
   * Add a battle record (legacy compatibility)
   */
  addBattle({ leagueId, contestant1Id, contestant1Name, scores1, total1, contestant2Id, contestant2Name, scores2, total2, notes, winnerId, decisionMethod, decisionTally }) {
    const battle = {
      id: 'b_' + Date.now(),
      leagueId,
      contestant1Id,
      contestant1Name,
      scores1,
      total1,
      contestant2Id,
      contestant2Name,
      scores2,
      total2,
      winnerId: winnerId !== undefined ? winnerId : (total1 > total2 ? contestant1Id : (total2 > total1 ? contestant2Id : null)),
      decisionMethod: decisionMethod || 'TOTAL_POINTS',
      decisionTally: decisionTally || '',
      notes: notes || '',
      timestamp: new Date().toISOString()
    };

    this.history.unshift(battle); // newest first
    this.save();
    return battle;
  }

  /**
   * Get history for a specific league
   */
  getForLeague(leagueId) {
    if (!leagueId) return [];
    return this.history.filter(b => b.leagueId === leagueId);
  }

  /**
   * Get history for a specific contestant
   */
  getForContestant(contestantId) {
    return this.history.filter(b => b.contestant1Id === contestantId || b.contestant2Id === contestantId);
  }

  /**
   * Check which achievements are unlocked
   */
  getAchievements(leagueId) {
    const battles = leagueId ? this.getForLeague(leagueId) : this.history;
    return ACHIEVEMENT_DEFS.map(def => ({
      ...def,
      unlocked: def.check(battles)
    }));
  }

  /**
   * Render achievements
   */
  renderAchievements(containerId, leagueId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const achievements = this.getAchievements(leagueId);
    container.innerHTML = '';

    achievements.forEach(ach => {
      const card = document.createElement('div');
      card.className = `achievement-card ${ach.unlocked ? 'unlocked' : 'locked'}`;
      card.innerHTML = `
        <span class="ach-icon">${ach.icon}</span>
        <div class="ach-info">
          <div class="ach-name">${ach.name}</div>
          <div class="ach-desc">${ach.desc}</div>
        </div>
      `;
      container.appendChild(card);
    });
  }

  /**
   * Render battle history list
   */
  renderHistory(containerId, emptyId, leagueId) {
    const container = document.getElementById(containerId);
    const emptyEl = document.getElementById(emptyId);
    if (!container) return;

    const battles = this.getForLeague(leagueId);
    container.innerHTML = '';

    if (battles.length === 0) {
      if (emptyEl) emptyEl.style.display = '';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    battles.forEach(battle => {
      const entry = document.createElement('div');
      entry.className = 'history-entry';

      const c1IsWinner = battle.winnerId === battle.contestant1Id;
      const c2IsWinner = battle.winnerId === battle.contestant2Id;
      const decisionBadge = battle.decisionMethod && battle.decisionMethod !== 'TOTAL_POINTS'
        ? `<span class="he-badge ${battle.decisionMethod.toLowerCase()}">${battle.decisionMethod} ${battle.decisionTally || ''}</span>`
        : (battle.decisionTally ? `<span class="he-badge">${battle.decisionTally}</span>` : '');
      const demoBadge = battle.isDemo ? `<span class="he-badge demo">DEMO</span>` : '';

      entry.innerHTML = `
        <div>
          <div class="he-name ${c1IsWinner ? 'winner' : ''}">${this.escapeHtml(battle.contestant1Name)}</div>
          <div class="he-score">${battle.total1.toFixed(1)}</div>
        </div>
        <div class="he-center">
          <div class="he-vs">VS</div>
          ${decisionBadge}
          ${demoBadge}
        </div>
        <div class="he-right">
          <div class="he-name ${c2IsWinner ? 'winner' : ''}">${this.escapeHtml(battle.contestant2Name)}</div>
          <div class="he-score">${battle.total2.toFixed(1)}</div>
        </div>
      `;

      container.appendChild(entry);
    });
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

export { HistoryManager };
