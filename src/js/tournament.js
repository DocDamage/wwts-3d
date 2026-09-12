/**
 * Tournament — single-elimination bracket from league roster
 */

class TournamentManager {
  constructor(rosterManager, leagueManager) {
    this.roster = rosterManager;
    this.leagues = leagueManager;
    this.bracket = null;
    this.currentMatchIndex = -1;
    this.onMatchSelect = null; // callback(contestant1Id, contestant2Id)
  }

  init() {
    const modal = document.getElementById('tournament-modal');
    const openBtn = document.getElementById('btn-tournament');
    const closeBtn = modal?.querySelector('[data-close="tournament-modal"]');
    const startBtn = document.getElementById('btn-start-tournament');

    openBtn?.addEventListener('click', () => this.openModal());
    closeBtn?.addEventListener('click', () => this.closeModal());
    startBtn?.addEventListener('click', () => this.startTournament());

    // Close on overlay click
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) this.closeModal();
    });
  }

  openModal() {
    const modal = document.getElementById('tournament-modal');
    if (!modal) return;

    modal.style.display = '';
    this.renderContestantPicks();
  }

  closeModal() {
    const modal = document.getElementById('tournament-modal');
    if (modal) modal.style.display = 'none';
  }

  renderContestantPicks() {
    const container = document.getElementById('tournament-contestant-picks');
    const startBtn = document.getElementById('btn-start-tournament');
    if (!container) return;

    const leagueId = this.leagues.activeLeagueId;
    const contestants = this.roster.getForLeague(leagueId);

    container.innerHTML = '';

    if (contestants.length < 2) {
      container.innerHTML = '<p class="empty-state">Need at least 2 contestants in the league roster to start a tournament.</p>';
      if (startBtn) startBtn.disabled = true;
      return;
    }

    contestants.forEach(c => {
      const card = document.createElement('div');
      card.className = 'tournament-pick-card selected'; // all selected by default
      card.dataset.id = c.id;

      const photoHtml = c.photo
        ? `<img src="${c.photo}" alt="${c.name}" />`
        : '';

      card.innerHTML = `
        <div class="tournament-pick-photo">${photoHtml}</div>
        <span>${c.name}</span>
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

    // Need power of 2, minimum 2
    const count = selected.length;
    const validSizes = [2, 4, 8, 16, 32];
    const valid = validSizes.includes(count);

    if (startBtn) {
      startBtn.disabled = !valid;
      if (count < 2) {
        startBtn.textContent = 'Select at least 2 contestants';
      } else if (!valid) {
        // Find nearest valid size
        const nearest = validSizes.find(s => s >= count) || validSizes[validSizes.length - 1];
        startBtn.textContent = `Select ${nearest} contestants (need power of 2)`;
      } else {
        startBtn.textContent = `Start Tournament (${count} contestants)`;
      }
    }
  }

  startTournament() {
    const selectedCards = document.querySelectorAll('.tournament-pick-card.selected');
    const contestantIds = Array.from(selectedCards).map(c => c.dataset.id);

    // Shuffle
    for (let i = contestantIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [contestantIds[i], contestantIds[j]] = [contestantIds[j], contestantIds[i]];
    }

    // Build bracket
    const rounds = Math.log2(contestantIds.length);
    this.bracket = {
      rounds: [],
      contestantIds,
      totalRounds: rounds
    };

    // First round matches
    const firstRound = [];
    for (let i = 0; i < contestantIds.length; i += 2) {
      firstRound.push({
        player1Id: contestantIds[i],
        player2Id: contestantIds[i + 1],
        player1Score: null,
        player2Score: null,
        winnerId: null,
        completed: false
      });
    }
    this.bracket.rounds.push(firstRound);

    // Subsequent rounds (empty slots)
    let matchesInRound = firstRound.length / 2;
    for (let r = 1; r < rounds; r++) {
      const round = [];
      for (let m = 0; m < matchesInRound; m++) {
        round.push({
          player1Id: null,
          player2Id: null,
          player1Score: null,
          player2Score: null,
          winnerId: null,
          completed: false
        });
      }
      this.bracket.rounds.push(round);
      matchesInRound = Math.max(1, matchesInRound / 2);
    }

    // Show bracket
    document.getElementById('tournament-setup').style.display = 'none';
    const bracketContainer = document.getElementById('tournament-bracket');
    bracketContainer.style.display = '';
    this.renderBracket();

    // Auto-select first match
    this.selectMatch(0, 0);
  }

  renderBracket() {
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

        const p1 = this.roster.getById(match.player1Id);
        const p2 = this.roster.getById(match.player2Id);

        const p1Name = p1 ? p1.name : 'TBD';
        const p2Name = p2 ? p2.name : 'TBD';
        let p1Score = match.player1Score !== null ? match.player1Score.toFixed(1) : '';
        let p2Score = match.player2Score !== null ? match.player2Score.toFixed(1) : '';

        if (match.seriesDetails) {
          p1Score = `${match.seriesDetails.roundsWon1}W (${match.player1Score.toFixed(1)})`;
          p2Score = `${match.seriesDetails.roundsWon2}W (${match.player2Score.toFixed(1)})`;
        }

        matchEl.innerHTML = `
          <div class="bracket-player ${match.winnerId === match.player1Id ? 'winner' : ''}">
            <span>${p1Name}</span>
            <span class="bp-score">${p1Score}</span>
          </div>
          <div class="bracket-player ${match.winnerId === match.player2Id ? 'winner' : ''}">
            <span>${p2Name}</span>
            <span class="bp-score">${p2Score}</span>
          </div>
        `;

        // Clickable only if both players set and not completed
        if (match.player1Id && match.player2Id && !match.completed) {
          matchEl.classList.add('active');
          matchEl.addEventListener('click', () => this.selectMatch(roundIdx, matchIdx));
        }

        roundEl.appendChild(matchEl);
      });

      container.appendChild(roundEl);
    });
  }

  selectMatch(roundIdx, matchIdx) {
    const match = this.bracket.rounds[roundIdx]?.[matchIdx];
    if (!match || !match.player1Id || !match.player2Id) return;

    this.currentMatchIndex = { round: roundIdx, match: matchIdx };

    if (this.onMatchSelect) {
      this.onMatchSelect(match.player1Id, match.player2Id);
    }

    // Close modal to go score
    this.closeModal();
  }

  /**
   * Record a match result from scoring (supports Best-of-3 series details)
   */
  recordResult(contestant1Id, contestant2Id, score1, score2, seriesDetails = null) {
    if (!this.bracket || !this.currentMatchIndex) return false;

    const { round, match: matchIdx } = this.currentMatchIndex;
    const m = this.bracket.rounds[round]?.[matchIdx];
    if (!m) return false;

    // Verify correct players
    if (m.player1Id !== contestant1Id || m.player2Id !== contestant2Id) return false;

    m.player1Score = score1;
    m.player2Score = score2;
    m.seriesDetails = seriesDetails;
    m.winnerId = (seriesDetails && seriesDetails.roundsWon1 !== seriesDetails.roundsWon2)
      ? (seriesDetails.roundsWon1 > seriesDetails.roundsWon2 ? contestant1Id : contestant2Id)
      : (score1 >= score2 ? contestant1Id : contestant2Id);
    m.completed = true;

    // Advance winner to next round
    const nextRound = round + 1;
    if (nextRound < this.bracket.rounds.length) {
      const nextMatchIdx = Math.floor(matchIdx / 2);
      const nextMatch = this.bracket.rounds[nextRound][nextMatchIdx];
      if (nextMatch) {
        if (matchIdx % 2 === 0) {
          nextMatch.player1Id = m.winnerId;
        } else {
          nextMatch.player2Id = m.winnerId;
        }
      }
    }

    this.currentMatchIndex = null;
    this.renderBracket();
    return true;
  }

  getNextPlayableMatch() {
    if (!this.bracket) return null;
    for (let r = 0; r < this.bracket.rounds.length; r++) {
      for (let m = 0; m < this.bracket.rounds[r].length; m++) {
        const match = this.bracket.rounds[r][m];
        if (match.player1Id && match.player2Id && !match.completed) {
          const p1 = this.roster.getById(match.player1Id);
          const p2 = this.roster.getById(match.player2Id);
          return {
            round: r,
            match: m,
            player1Id: match.player1Id,
            player2Id: match.player2Id,
            p1Name: p1?.name || 'Player 1',
            p2Name: p2?.name || 'Player 2'
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
    return this.roster.getById(finalMatch.winnerId);
  }

  resetTournament() {
    this.bracket = null;
    this.currentMatchIndex = null;
    document.getElementById('tournament-setup').style.display = '';
    const bracketContainer = document.getElementById('tournament-bracket');
    if (bracketContainer) {
      bracketContainer.style.display = 'none';
      bracketContainer.innerHTML = '';
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
