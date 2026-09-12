/**
 * Tournament — Single-Elimination Bracket with Arbitrary Entrant Support,
 * Automatic Byes, Persistent Recovery, Seeding, and Official Result Consumption.
 */

const STORAGE_KEY = 'beatbattle_tournament_state';

class TournamentManager {
  constructor(rosterManager, leagueManager) {
    this.roster = rosterManager;
    this.leagues = leagueManager;
    this.bracket = null;
    this.currentMatchIndex = null;
    this.onMatchSelect = null; // callback(contestant1Id, contestant2Id)

    this.loadState();
  }

  loadState() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.bracket) {
            this.bracket = parsed.bracket;
            this.currentMatchIndex = parsed.currentMatchIndex || null;
          }
        }
      }
    } catch {
      this.bracket = null;
    }
  }

  saveState() {
    try {
      if (typeof localStorage !== 'undefined') {
        if (this.bracket) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({
            bracket: this.bracket,
            currentMatchIndex: this.currentMatchIndex
          }));
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch {
      // Storage unavailable
    }
  }

  init() {
    if (typeof document === 'undefined') return;

    const modal = document.getElementById('tournament-modal');
    const openBtn = document.getElementById('btn-tournament');
    const closeBtn = modal?.querySelector('[data-close="tournament-modal"]');
    const startBtn = document.getElementById('btn-start-tournament');

    openBtn?.addEventListener('click', () => this.openModal());
    closeBtn?.addEventListener('click', () => this.closeModal());
    startBtn?.addEventListener('click', () => this.startTournament());

    modal?.addEventListener('click', (e) => {
      if (e.target === modal) this.closeModal();
    });

    if (this.bracket) {
      const setupEl = document.getElementById('tournament-setup');
      const bracketEl = document.getElementById('tournament-bracket');
      if (setupEl) setupEl.style.display = 'none';
      if (bracketEl) {
        bracketEl.style.display = '';
        this.renderBracket();
      }
    }
  }

  openModal() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('tournament-modal');
    if (!modal) return;

    modal.style.display = '';
    if (!this.bracket) {
      this.renderContestantPicks();
    } else {
      this.renderBracket();
    }
  }

  closeModal() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('tournament-modal');
    if (modal) modal.style.display = 'none';
  }

  renderContestantPicks() {
    const container = document.getElementById('tournament-contestant-picks');
    const startBtn = document.getElementById('btn-start-tournament');
    if (!container) return;

    const leagueId = this.leagues?.activeLeagueId;
    const contestants = this.roster ? this.roster.getForLeague(leagueId) : [];

    container.innerHTML = '';

    if (contestants.length < 2) {
      container.innerHTML = '<p class="empty-state">Need at least 2 contestants in the roster to start a tournament.</p>';
      if (startBtn) {
        startBtn.disabled = true;
        startBtn.textContent = 'Need at least 2 contestants';
      }
      return;
    }

    contestants.forEach((c, idx) => {
      const card = document.createElement('div');
      card.className = 'tournament-pick-card selected';
      card.dataset.id = c.id;

      const photoHtml = c.photo ? `<img src="${c.photo}" alt="${c.name}" />` : '';

      card.innerHTML = `
        <div class="tournament-pick-photo">${photoHtml}</div>
        <span class="t-pick-name">${c.name}</span>
        <span class="t-seed-badge">Seed #${idx + 1}</span>
      `;

      card.addEventListener('click', () => {
        card.classList.toggle('selected');
        this.validateTournamentSize();
      });

      container.appendChild(card);
    });

    this.validateTournamentSize();
  }

  validateTournamentSize() {
    const selected = document.querySelectorAll('.tournament-pick-card.selected');
    const startBtn = document.getElementById('btn-start-tournament');
    const count = selected.length;

    if (startBtn) {
      if (count < 2) {
        startBtn.disabled = true;
        startBtn.textContent = 'Select at least 2 contestants';
      } else {
        startBtn.disabled = false;
        const targetPower = Math.pow(2, Math.ceil(Math.log2(count)));
        const byes = targetPower - count;
        if (byes > 0) {
          startBtn.textContent = `Start Tournament (${count} Contestants, ${byes} Byes)`;
        } else {
          startBtn.textContent = `Start Tournament (${count} Contestants)`;
        }
      }
    }
  }

  startTournament(customContestantIds = null) {
    let contestantIds = customContestantIds;

    if (!contestantIds && typeof document !== 'undefined') {
      const selectedCards = document.querySelectorAll('.tournament-pick-card.selected');
      contestantIds = Array.from(selectedCards).map(c => c.dataset.id);
    }

    if (!contestantIds || contestantIds.length < 2) return false;

    const count = contestantIds.length;
    const targetSize = Math.pow(2, Math.ceil(Math.log2(count)));
    const totalRounds = Math.log2(targetSize);
    const byesCount = targetSize - count;
    const numMatchesR1 = targetSize / 2;
    const numPlayable = count - numMatchesR1;

    this.bracket = {
      rounds: [],
      contestantIds: [...contestantIds],
      totalRounds,
      targetSize,
      byesCount
    };

    // Build Round 1 matches:
    // byesCount matches get 1 player + bye
    // numPlayable matches get 2 competing players
    const firstRound = [];
    let playerIdx = 0;

    for (let m = 0; m < byesCount; m++) {
      const p1 = contestantIds[playerIdx++];
      firstRound.push({
        player1Id: p1,
        player2Id: null,
        player1Score: 0,
        player2Score: 0,
        winnerId: p1,
        completed: true,
        isBye: true
      });
    }

    for (let m = 0; m < numPlayable; m++) {
      const p1 = contestantIds[playerIdx++];
      const p2 = contestantIds[playerIdx++];
      firstRound.push({
        player1Id: p1,
        player2Id: p2,
        player1Score: null,
        player2Score: null,
        winnerId: null,
        completed: false,
        isBye: false
      });
    }
    this.bracket.rounds.push(firstRound);

    // Subsequent rounds
    let matchesInRound = firstRound.length / 2;
    for (let r = 1; r < totalRounds; r++) {
      const round = [];
      for (let m = 0; m < matchesInRound; m++) {
        round.push({
          player1Id: null,
          player2Id: null,
          player1Score: null,
          player2Score: null,
          winnerId: null,
          completed: false,
          isBye: false
        });
      }
      this.bracket.rounds.push(round);
      matchesInRound = Math.max(1, matchesInRound / 2);
    }

    // Auto-advance byes to Round 2
    if (byesCount > 0 && totalRounds > 1) {
      firstRound.forEach((m, idx) => {
        if (m.isBye && m.winnerId) {
          const nextMatchIdx = Math.floor(idx / 2);
          const nextMatch = this.bracket.rounds[1][nextMatchIdx];
          if (nextMatch) {
            if (idx % 2 === 0) {
              nextMatch.player1Id = m.winnerId;
            } else {
              nextMatch.player2Id = m.winnerId;
            }
          }
        }
      });
    }

    this.saveState();

    if (typeof document !== 'undefined') {
      const setup = document.getElementById('tournament-setup');
      const bracketContainer = document.getElementById('tournament-bracket');
      if (setup) setup.style.display = 'none';
      if (bracketContainer) {
        bracketContainer.style.display = '';
        this.renderBracket();
      }
    }

    // Auto-select first playable match
    const firstPlayable = this.getNextPlayableMatch();
    if (firstPlayable) {
      this.selectMatch(firstPlayable.round, firstPlayable.matchIndex);
    }

    return true;
  }

  renderBracket() {
    if (typeof document === 'undefined') return;
    const container = document.getElementById('tournament-bracket');
    if (!container || !this.bracket) return;

    container.innerHTML = '';

    const roundNames = this.getRoundNames(this.bracket.totalRounds);

    this.bracket.rounds.forEach((round, roundIdx) => {
      const roundEl = document.createElement('div');
      roundEl.className = 'bracket-round';

      const title = document.createElement('div');
      title.className = 'bracket-round-title';
      title.textContent = roundNames[roundIdx] || `Round ${roundIdx + 1}`;
      roundEl.appendChild(title);

      round.forEach((match, matchIdx) => {
        const matchEl = document.createElement('div');
        matchEl.className = 'bracket-match';
        if (match.completed) matchEl.classList.add('completed');
        if (match.isBye) matchEl.classList.add('bye-match');

        const isCurrent = this.currentMatchIndex &&
          this.currentMatchIndex.round === roundIdx &&
          this.currentMatchIndex.match === matchIdx;
        if (isCurrent) matchEl.classList.add('active-battling');

        const p1 = this.roster ? this.roster.getById(match.player1Id) : null;
        const p2 = this.roster ? this.roster.getById(match.player2Id) : null;

        const p1Name = p1 ? p1.name : (match.player1Id ? 'Contestant' : 'TBD');
        const p2Name = match.isBye ? 'BYE (Advances)' : (p2 ? p2.name : (match.player2Id ? 'Contestant' : 'TBD'));

        let p1Score = match.player1Score !== null ? Number(match.player1Score).toFixed(1) : '';
        let p2Score = match.player2Score !== null ? Number(match.player2Score).toFixed(1) : '';

        if (match.seriesDetails) {
          p1Score = `${match.seriesDetails.roundsWon1}W (${p1Score})`;
          p2Score = `${match.seriesDetails.roundsWon2}W (${p2Score})`;
        }

        matchEl.innerHTML = `
          <div class="bracket-player ${match.winnerId && match.winnerId === match.player1Id ? 'winner' : ''}">
            <span class="bp-name">${p1Name}</span>
            <span class="bp-score">${p1Score}</span>
          </div>
          <div class="bracket-player ${match.winnerId && match.winnerId === match.player2Id ? 'winner' : ''}">
            <span class="bp-name">${p2Name}</span>
            <span class="bp-score">${p2Score}</span>
          </div>
        `;

        if (match.player1Id && match.player2Id && !match.completed && !match.isBye) {
          matchEl.classList.add('playable');
          matchEl.title = 'Click to load match into Battle Arena';
          matchEl.addEventListener('click', () => this.selectMatch(roundIdx, matchIdx));
        }

        roundEl.appendChild(matchEl);
      });

      container.appendChild(roundEl);
    });
  }

  selectMatch(roundIdx, matchIdx) {
    const match = this.bracket?.rounds[roundIdx]?.[matchIdx];
    if (!match || !match.player1Id || !match.player2Id || match.completed) return false;

    this.currentMatchIndex = { round: roundIdx, match: matchIdx };
    this.saveState();

    if (typeof this.onMatchSelect === 'function') {
      this.onMatchSelect(match.player1Id, match.player2Id);
    }

    this.closeModal();
    return true;
  }

  /**
   * Consume official FinalizedBattleResult directly
   */
  recordFinalizedResult(finalResult) {
    if (!this.bracket || !this.currentMatchIndex || !finalResult) return false;

    const { round, match: matchIdx } = this.currentMatchIndex;
    const m = this.bracket.rounds[round]?.[matchIdx];
    if (!m) return false;

    const c1Id = finalResult.contestant1?.id;
    const c2Id = finalResult.contestant2?.id;

    if (m.player1Id !== c1Id || m.player2Id !== c2Id) {
      console.warn('TournamentManager: Match contestant mismatch on finalization.');
    }

    m.player1Score = finalResult.seriesSummary?.grandTotal1 ?? (finalResult.roundResults?.[0]?.total1 || 0);
    m.player2Score = finalResult.seriesSummary?.grandTotal2 ?? (finalResult.roundResults?.[0]?.total2 || 0);
    m.seriesDetails = finalResult.seriesSummary ? {
      roundsWon1: finalResult.seriesSummary.roundsWon1,
      roundsWon2: finalResult.seriesSummary.roundsWon2
    } : null;

    // DIRECT FROM OFFICIAL RESULT!
    m.winnerId = finalResult.winnerId;
    m.completed = true;

    // Advance winner to next round
    const nextRound = round + 1;
    if (nextRound < this.bracket.rounds.length) {
      const nextMatchIdx = Math.floor(matchIdx / 2);
      const nextMatch = this.bracket.rounds[nextRound][nextMatchIdx];
      if (nextMatch && m.winnerId) {
        if (matchIdx % 2 === 0) {
          nextMatch.player1Id = m.winnerId;
        } else {
          nextMatch.player2Id = m.winnerId;
        }
      }
    }

    this.currentMatchIndex = null;
    this.saveState();
    this.renderBracket();
    return true;
  }

  /**
   * Legacy adapter for direct scoring results
   */
  recordResult(contestant1Id, contestant2Id, score1, score2, seriesDetails = null) {
    let winnerId = null;
    if (seriesDetails && seriesDetails.roundsWon1 !== seriesDetails.roundsWon2) {
      winnerId = seriesDetails.roundsWon1 > seriesDetails.roundsWon2 ? contestant1Id : contestant2Id;
    } else {
      winnerId = score1 >= score2 ? contestant1Id : contestant2Id;
    }

    return this.recordFinalizedResult({
      contestant1: { id: contestant1Id },
      contestant2: { id: contestant2Id },
      winnerId,
      seriesSummary: seriesDetails ? {
        roundsWon1: seriesDetails.roundsWon1,
        roundsWon2: seriesDetails.roundsWon2,
        grandTotal1: score1,
        grandTotal2: score2
      } : null,
      roundResults: [{ total1: score1, total2: score2 }]
    });
  }

  getNextPlayableMatch() {
    if (!this.bracket) return null;
    for (let r = 0; r < this.bracket.rounds.length; r++) {
      for (let m = 0; m < this.bracket.rounds[r].length; m++) {
        const match = this.bracket.rounds[r][m];
        if (match.player1Id && match.player2Id && !match.completed && !match.isBye) {
          const p1 = this.roster?.getById(match.player1Id);
          const p2 = this.roster?.getById(match.player2Id);
          return {
            round: r,
            match: m,
            matchIndex: m,
            player1Id: match.player1Id,
            player2Id: match.player2Id,
            p1Name: p1?.name || 'Contestant 1',
            p2Name: p2?.name || 'Contestant 2'
          };
        }
      }
    }
    return null;
  }

  isTournamentActive() {
    return this.bracket !== null && this.currentMatchIndex !== null;
  }

  isTournamentComplete() {
    if (!this.bracket) return false;
    const finalRound = this.bracket.rounds[this.bracket.rounds.length - 1];
    return finalRound.every(m => m.completed);
  }

  getTournamentWinner() {
    if (!this.isTournamentComplete()) return null;
    const finalMatch = this.bracket.rounds[this.bracket.rounds.length - 1][0];
    return this.roster?.getById(finalMatch.winnerId);
  }

  resetTournament() {
    this.bracket = null;
    this.currentMatchIndex = null;
    this.saveState();

    if (typeof document !== 'undefined') {
      const setup = document.getElementById('tournament-setup');
      const bracketContainer = document.getElementById('tournament-bracket');
      if (setup) setup.style.display = '';
      if (bracketContainer) {
        bracketContainer.style.display = 'none';
        bracketContainer.innerHTML = '';
      }
    }
  }

  getRoundNames(totalRounds) {
    if (totalRounds === 1) return ['Finals'];
    if (totalRounds === 2) return ['Semifinals', 'Finals'];
    if (totalRounds === 3) return ['Quarterfinals', 'Semifinals', 'Finals'];
    if (totalRounds === 4) return ['Round of 16', 'Quarterfinals', 'Semifinals', 'Finals'];
    const names = [];
    for (let i = 0; i < totalRounds; i++) {
      const remaining = totalRounds - i;
      if (remaining === 1) names.push('Finals');
      else if (remaining === 2) names.push('Semifinals');
      else if (remaining === 3) names.push('Quarterfinals');
      else names.push(`Round ${i + 1}`);
    }
    return names;
  }
}

export { TournamentManager };
