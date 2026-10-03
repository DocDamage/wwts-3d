/**
 * Roster Manager — contestant profiles with photos, bios, stats
 */

const STORAGE_KEY = 'beatbattle_contestants';
const DEFAULT_CATEGORIES = [
  'Creativity', 'Versatility', 'Mix', 'Drums', 'Melody',
  'Bassline', 'Energy', 'Battle Ability', 'Arrangement', 'Sound Selection'
];
const ELO_K = 32;

/** Standard Elo: scoreA is 1 (A won), 0 (A lost) or 0.5 (draw). Ratings stay whole numbers. */
function eloUpdate(ratingA, ratingB, scoreA, k = ELO_K) {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const delta = Math.round(k * (scoreA - expectedA));
  return { newA: ratingA + delta, newB: ratingB - delta };
}

class RosterManager {
  constructor(leagueManager) {
    this.leagueManager = leagueManager;
    this.contestants = [];
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.contestants = raw ? JSON.parse(raw) : [];
    } catch {
      this.contestants = [];
    }
    // Older saves kept averages out of 10; battle scores are out of 100 now
    let migrated = false;
    this.contestants.forEach(c => {
      if (!c.stats) return;
      if (c.stats.totalBattles > 0 && c.stats.avgScore > 0 && c.stats.avgScore <= 10 && !c.stats.scale100) {
        c.stats.avgScore = parseFloat((c.stats.avgScore * 10).toFixed(2));
        c.stats.totalScoreSum = parseFloat((c.stats.totalScoreSum * 10).toFixed(2));
        migrated = true;
      }
      c.stats.scale100 = true;
    });
    if (migrated) this.save();

    // Seed default contestants for instant battle testing if empty
    if (this.contestants.length === 0) {
      const defaultProducers = [
        {
          id: 'prod_smoke',
          name: '808 Smoke',
          photo: '',
          bio: 'Premier trap architect known for trunk-rattling 808 glides and intricate hi-hat rolls.',
          socialLinks: '@808smoke',
          stats: { wins: 4, losses: 1, draws: 0, totalBattles: 5, avgScore: 88.0, bestCategory: 'Bassline', totalScoreSum: 440.0, rating: 1548, peakRating: 1560, streak: 2, bestStreak: 3, scale100: true },
          createdAt: new Date().toISOString()
        },
        {
          id: 'prod_vixen',
          name: 'Vinyl Vixen',
          photo: '',
          bio: 'Dusty vinyl crate digger chopping rare 70s soul and jazz into hypnotic battle heat.',
          socialLinks: '@vinylvixen',
          stats: { wins: 3, losses: 1, draws: 0, totalBattles: 4, avgScore: 86.0, bestCategory: 'Creativity', totalScoreSum: 344.0, rating: 1532, peakRating: 1532, streak: 1, bestStreak: 2, scale100: true },
          createdAt: new Date().toISOString()
        },
        {
          id: 'prod_kick',
          name: 'Kick Master',
          photo: '',
          bio: 'Boom-bap purist delivering punchy kicks, cracking snares, and gritty SP-1200 grit.',
          socialLinks: '@kickmaster',
          stats: { wins: 2, losses: 2, draws: 0, totalBattles: 4, avgScore: 82.0, bestCategory: 'Drums', totalScoreSum: 328.0, rating: 1496, peakRating: 1516, streak: -1, bestStreak: 2, scale100: true },
          createdAt: new Date().toISOString()
        },
        {
          id: 'prod_poly',
          name: 'Queen Poly',
          photo: '',
          bio: 'Polyphonic synth virtuoso layering analog saw leads, sidechain pads, and cinematic drops.',
          socialLinks: '@queenpoly',
          stats: { wins: 3, losses: 0, draws: 0, totalBattles: 3, avgScore: 91.0, bestCategory: 'Melody', totalScoreSum: 273.0, rating: 1545, peakRating: 1545, streak: 3, bestStreak: 3, scale100: true },
          createdAt: new Date().toISOString()
        }
      ];

      this.contestants = defaultProducers;
      this.save();

      // Attach to default league 'wwts'
      defaultProducers.forEach(p => {
        this.leagueManager.addContestant('wwts', p.id);
      });
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.contestants));
    } catch {
      // storage blocked — roster still works for this session
    }
  }

  getAll() {
    return this.contestants;
  }

  getById(id) {
    return this.contestants.find(c => c.id === id);
  }

  /**
   * Get contestants for the active league
   */
  getForLeague(leagueId) {
    if (!leagueId) return [];
    const league = this.leagueManager.getById(leagueId);
    if (!league) return [];
    return league.contestantIds
      .map(id => this.getById(id))
      .filter(Boolean);
  }

  /**
   * Add a new contestant
   */
  add({ name, photo, bio, socialLinks, leagueId }) {
    const contestant = {
      id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      name: name.trim(),
      photo: photo || '',
      bio: (bio || '').trim(),
      socialLinks: (socialLinks || '').trim(),
      stats: {
        wins: 0,
        losses: 0,
        draws: 0,
        totalBattles: 0,
        avgScore: 0,
        bestCategory: '—',
        totalScoreSum: 0,
        rating: 1500,
        peakRating: 1500,
        streak: 0,
        bestStreak: 0,
        scale100: true
      },
      createdAt: new Date().toISOString()
    };

    this.contestants.push(contestant);
    this.save();

    // Add to league if specified
    if (leagueId) {
      this.leagueManager.addContestant(leagueId, contestant.id);
    }

    return contestant;
  }

  /**
   * Update a contestant
   */
  update(id, updates) {
    const contestant = this.getById(id);
    if (!contestant) return null;

    if (updates.name !== undefined) contestant.name = updates.name.trim();
    if (updates.photo !== undefined) contestant.photo = updates.photo;
    if (updates.bio !== undefined) contestant.bio = updates.bio.trim();
    if (updates.socialLinks !== undefined) contestant.socialLinks = updates.socialLinks.trim();

    this.save();
    return contestant;
  }

  /**
   * Delete a contestant and remove from all leagues
   */
  delete(id) {
    this.contestants = this.contestants.filter(c => c.id !== id);
    this.save();

    // Remove from all leagues
    this.leagueManager.getAll().forEach(league => {
      this.leagueManager.removeContestant(league.id, id);
    });
  }

  /**
   * Record battle results directly from an official FinalizedBattleResult
   */
  recordFinalizedBattle(finalResult) {
    if (!finalResult || finalResult.isDemo) return null;

    const c1Id = finalResult.contestant1?.id;
    const c2Id = finalResult.contestant2?.id;
    if (!c1Id || !c2Id) return null;

    const categories = finalResult.scoringRules?.categories?.map(c => c.name || c) || DEFAULT_CATEGORIES;
    const played = finalResult.roundResults || [];
    // Each producer's battle score is their average round score (out of 100)
    const avg = (key) => (played.length ? played.reduce((s, r) => s + (r[key] || 0), 0) / played.length : 0);
    const score1 = finalResult.seriesSummary?.avgRound1 ?? avg('total1');
    const score2 = finalResult.seriesSummary?.avgRound2 ?? avg('total2');
    const sumCats = (key) => categories.map((_, i) => played.reduce((s, r) => s + (r[key]?.[i] || 0), 0));

    const outcome1 = finalResult.winnerId === c1Id ? 'win' : finalResult.winnerId === c2Id ? 'loss' : 'draw';
    const outcome2 = outcome1 === 'win' ? 'loss' : outcome1 === 'loss' ? 'win' : 'draw';

    // Elo update (both ratings computed from the pre-battle values)
    const a = this.getById(c1Id);
    const b = this.getById(c2Id);
    const ra = a ? this.ratingOf(a) : 1500;
    const rb = b ? this.ratingOf(b) : 1500;
    const { newA, newB } = eloUpdate(ra, rb, outcome1 === 'win' ? 1 : outcome1 === 'loss' ? 0 : 0.5);

    this.recordBattle(c1Id, score1, outcome1, sumCats('scores1'), categories, newA);
    this.recordBattle(c2Id, score2, outcome2, sumCats('scores2'), categories, newB);

    return {
      [c1Id]: { before: ra, after: newA, change: newA - ra, outcome: outcome1 },
      [c2Id]: { before: rb, after: newB, change: newB - rb, outcome: outcome2 }
    };
  }

  ratingOf(c) {
    return typeof c.stats?.rating === 'number' ? c.stats.rating : 1500;
  }

  /**
   * Record a battle result for a contestant
   */
  recordBattle(contestantId, score, outcome, categoryScores, categories, newRating = null) {
    const c = this.getById(contestantId);
    if (!c) return;
    // Older callers pass a boolean "won"
    if (outcome === true) outcome = 'win';
    if (outcome === false) outcome = 'loss';

    c.stats.totalBattles++;
    if (outcome === 'win') c.stats.wins++;
    else if (outcome === 'loss') c.stats.losses++;
    else c.stats.draws = (c.stats.draws || 0) + 1;

    c.stats.totalScoreSum += score;
    c.stats.avgScore = parseFloat((c.stats.totalScoreSum / c.stats.totalBattles).toFixed(2));
    c.stats.bestScore = Math.max(c.stats.bestScore || 0, parseFloat(score.toFixed(2)));

    // Streaks
    if (outcome === 'win') c.stats.streak = (c.stats.streak > 0 ? c.stats.streak : 0) + 1;
    else if (outcome === 'loss') c.stats.streak = (c.stats.streak < 0 ? c.stats.streak : 0) - 1;
    else c.stats.streak = 0;
    c.stats.bestStreak = Math.max(c.stats.bestStreak || 0, c.stats.streak);

    if (newRating !== null) {
      c.stats.rating = newRating;
      c.stats.peakRating = Math.max(c.stats.peakRating || 1500, newRating);
    }

    // Best category across their career (running per-category totals)
    if (categoryScores && categories) {
      c.stats.categoryTotals = c.stats.categoryTotals || {};
      categories.forEach((name, idx) => {
        c.stats.categoryTotals[name] = (c.stats.categoryTotals[name] || 0) + (categoryScores[idx] || 0);
      });
      const best = Object.entries(c.stats.categoryTotals).sort((x, y) => y[1] - x[1])[0];
      if (best && best[1] > 0) c.stats.bestCategory = best[0];
    }

    this.save();
  }

  /**
   * League table: wins, then win rate, then rating, then average score
   */
  getStandings(leagueId) {
    const list = this.getForLeague(leagueId);
    return list
      .map(c => {
        const s = c.stats || {};
        const games = s.totalBattles || 0;
        const draws = s.draws || 0;
        return {
          id: c.id,
          name: c.name,
          photo: c.photo,
          wins: s.wins || 0,
          losses: s.losses || 0,
          draws,
          battles: games,
          winRate: games ? ((s.wins || 0) + draws * 0.5) / games : 0,
          rating: this.ratingOf(c),
          avgScore: s.avgScore || 0,
          streak: s.streak || 0
        };
      })
      .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.rating - a.rating || b.avgScore - a.avgScore)
      .map((row, i) => ({ ...row, rank: i + 1 }));
  }

  /**
   * Render roster cards
   */
  renderRosterCards(containerId, emptyId, noLeagueId, leagueId, onCardClick) {
    const container = document.getElementById(containerId);
    const emptyEl = document.getElementById(emptyId);
    const noLeagueEl = document.getElementById(noLeagueId);
    if (!container) return;

    container.innerHTML = '';

    if (!leagueId) {
      if (emptyEl) emptyEl.style.display = 'none';
      if (noLeagueEl) noLeagueEl.style.display = '';
      return;
    }

    if (noLeagueEl) noLeagueEl.style.display = 'none';

    const contestants = this.getForLeague(leagueId);

    if (contestants.length === 0) {
      if (emptyEl) emptyEl.style.display = '';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    contestants.forEach(c => {
      const card = document.createElement('div');
      card.className = 'roster-card';
      card.dataset.id = c.id;

      const photoHtml = c.photo
        ? `<img src="${this.escapeAttr(c.photo)}" alt="${this.escapeAttr(c.name)}" />`
        : `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

      card.innerHTML = `
        <div class="roster-card-photo">${photoHtml}</div>
        <div class="roster-card-name">${this.escapeHtml(c.name)}</div>
        <div class="roster-card-record">
          <span class="wins">${c.stats.wins}W</span> - <span class="losses">${c.stats.losses}L</span>
        </div>
      `;

      card.addEventListener('click', () => {
        if (onCardClick) onCardClick(c.id);
      });

      container.appendChild(card);
    });
  }

  /**
   * Populate a <select> with contestants from a league
   */
  populateSelect(selectId, leagueId, excludeId) {
    const select = document.getElementById(selectId);
    if (!select) return;

    const currentVal = select.value;
    select.innerHTML = '<option value="">— Select —</option>';

    const contestants = this.getForLeague(leagueId);
    contestants.forEach(c => {
      if (c.id === excludeId) return;
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      select.appendChild(opt);
    });

    // Restore value if still valid
    if (currentVal && contestants.find(c => c.id === currentVal)) {
      select.value = currentVal;
    }
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
}

export { RosterManager, eloUpdate };
