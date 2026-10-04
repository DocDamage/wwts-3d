/**
 * History & Achievements — battle records and unlockable achievements
 */

const STORAGE_KEY = 'beatbattle_history';


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
      // Battle score = average round score (out of 100), not the sum of rounds
      total1: finalResult.seriesSummary?.avgRound1 ?? (finalResult.roundResults?.[0]?.total1 || 0),
      contestant2Id: finalResult.contestant2?.id || 'c2',
      contestant2Name: finalResult.contestant2?.name || 'Contestant 2',
      scores2: finalResult.roundResults?.[0]?.scores2 || [],
      total2: finalResult.seriesSummary?.avgRound2 ?? (finalResult.roundResults?.[0]?.total2 || 0),
      winnerId: finalResult.winnerId, // Strictly official! Never recalculated!
      winnerName: finalResult.winnerName,
      decisionMethod: finalResult.decisionMethod || 'TOTAL_POINTS',
      decisionTally: finalResult.decisionTally || '',
      isDemo: !!finalResult.isDemo,
      seriesSummary: finalResult.seriesSummary || null,
      roundResults: finalResult.roundResults || [],
      scoringRules: finalResult.scoringRules || null,
      notes: finalResult.notes || '',
      timestampedNotes: finalResult.timestampedNotes || [],
      ratingChanges: finalResult.ratingChanges || null,
      isClinch: !!finalResult.isClinch,
      timeline: finalResult.timeline || null,
      timestamp: finalResult.timestamp || new Date().toISOString()
    };
    // Extras kept with the record when present
    ['corrections', 'seasonId', 'kind', 'placings', 'playOrder', 'judgeComments', 'kingOfTheHill', 'eventId'].forEach(k => {
      if (finalResult[k] !== undefined && finalResult[k] !== null) battle[k] = finalResult[k];
    });

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
      if (battle.kind === 'cypher' && Array.isArray(battle.placings)) {
        entry.classList.add('history-cypher');
        entry.innerHTML = `<div class="he-cypher"><span class="he-badge">${battle.placings.length}-WAY</span>${battle.placings.map((p, i) => `<span class="${i === 0 ? 'he-name winner' : 'he-name'}">${i + 1}. ${this.escapeHtml(p.name)} <small>${Number(p.total).toFixed(2)}</small></span>`).join('')}${battle.isDemo ? '<span class="he-badge demo">DEMO</span>' : ''}</div>`;
        container.appendChild(entry);
        return;
      }

      const c1IsWinner = battle.winnerId === battle.contestant1Id;
      const c2IsWinner = battle.winnerId === battle.contestant2Id;
      const decisionBadge = battle.decisionMethod && battle.decisionMethod !== 'TOTAL_POINTS'
        ? `<span class="he-badge ${battle.decisionMethod.toLowerCase()}">${battle.decisionMethod} ${battle.decisionTally || ''}</span>`
        : (battle.decisionTally ? `<span class="he-badge">${battle.decisionTally}</span>` : '');
      const demoBadge = battle.isDemo ? `<span class="he-badge demo">DEMO</span>` : '';

      entry.innerHTML = `
        <div>
          <div class="he-name ${c1IsWinner ? 'winner' : ''}">${this.escapeHtml(battle.contestant1Name)}</div>
          <div class="he-score">${battle.total1.toFixed(2)}</div>
        </div>
        <div class="he-center">
          <div class="he-vs">VS</div>
          ${decisionBadge}
          ${demoBadge}
          ${battle.timeline ? '<button type="button" class="he-replay" aria-label="Replay this battle">▶ Replay</button>' : ''}
        </div>
        <div class="he-right">
          <div class="he-name ${c2IsWinner ? 'winner' : ''}">${this.escapeHtml(battle.contestant2Name)}</div>
          <div class="he-score">${battle.total2.toFixed(2)}</div>
        </div>
      `;

      entry.querySelector('.he-replay')?.addEventListener('click', () => this.onReplay?.(battle));
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
