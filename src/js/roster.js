/**
 * Roster Manager — contestant profiles with photos, bios, stats
 */

const STORAGE_KEY = 'beatbattle_contestants';

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

    // Seed default contestants for instant battle testing if empty
    if (this.contestants.length === 0) {
      const defaultProducers = [
        {
          id: 'prod_smoke',
          name: '808 Smoke',
          photo: '',
          bio: 'Premier trap architect known for trunk-rattling 808 glides and intricate hi-hat rolls.',
          socialLinks: '@808smoke',
          stats: { wins: 4, losses: 1, totalBattles: 5, avgScore: 8.8, bestCategory: 'Bass / 808', totalScoreSum: 44.0 },
          createdAt: new Date().toISOString()
        },
        {
          id: 'prod_vixen',
          name: 'Vinyl Vixen',
          photo: '',
          bio: 'Dusty vinyl crate digger chopping rare 70s soul and jazz into hypnotic battle heat.',
          socialLinks: '@vinylvixen',
          stats: { wins: 3, losses: 1, totalBattles: 4, avgScore: 8.6, bestCategory: 'Creativity', totalScoreSum: 34.4 },
          createdAt: new Date().toISOString()
        },
        {
          id: 'prod_kick',
          name: 'Kick Master',
          photo: '',
          bio: 'Boom-bap purist delivering punchy kicks, cracking snares, and gritty SP-1200 grit.',
          socialLinks: '@kickmaster',
          stats: { wins: 2, losses: 2, totalBattles: 4, avgScore: 8.2, bestCategory: 'Drums', totalScoreSum: 32.8 },
          createdAt: new Date().toISOString()
        },
        {
          id: 'prod_poly',
          name: 'Queen Poly',
          photo: '',
          bio: 'Polyphonic synth virtuoso layering analog saw leads, sidechain pads, and cinematic drops.',
          socialLinks: '@queenpoly',
          stats: { wins: 3, losses: 0, totalBattles: 3, avgScore: 9.1, bestCategory: 'Melody', totalScoreSum: 27.3 },
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.contestants));
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
        totalBattles: 0,
        avgScore: 0,
        bestCategory: '—',
        totalScoreSum: 0
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
   * Record a battle result for a contestant
   */
  recordBattle(contestantId, score, won, categoryScores, categories) {
    const c = this.getById(contestantId);
    if (!c) return;

    c.stats.totalBattles++;
    if (won) c.stats.wins++;
    else c.stats.losses++;

    c.stats.totalScoreSum += score;
    c.stats.avgScore = parseFloat((c.stats.totalScoreSum / c.stats.totalBattles).toFixed(1));

    // Find best category
    if (categoryScores && categories) {
      let bestIdx = 0;
      let bestVal = 0;
      categoryScores.forEach((val, idx) => {
        if (val > bestVal) {
          bestVal = val;
          bestIdx = idx;
        }
      });
      c.stats.bestCategory = categories[bestIdx];
    }

    this.save();
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

export { RosterManager };
