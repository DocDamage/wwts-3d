/**
 * League Management — CRUD for leagues, localStorage persistence
 */

const STORAGE_KEY = 'beatbattle_leagues';

class LeagueManager {
  constructor() {
    this.leagues = [];
    this.activeLeagueId = null;
    this.onLeagueChange = null; // callback when active league changes
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.leagues = raw ? JSON.parse(raw) : [];
    } catch {
      this.leagues = [];
    }

    // Seed default league if empty
    if (this.leagues.length === 0) {
      this.leagues.push({
        id: 'wwts',
        name: 'Who Want That Smoke',
        description: 'The premier beat battle league',
        color: '#ff2d2d',
        contestantIds: [],
        createdAt: new Date().toISOString()
      });
      this.save();
    }
  }

  save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.leagues));
  }

  getAll() {
    return this.leagues;
  }

  getById(id) {
    return this.leagues.find(l => l.id === id);
  }

  getActive() {
    return this.getById(this.activeLeagueId);
  }

  setActive(id) {
    this.activeLeagueId = id;
    if (this.onLeagueChange) {
      this.onLeagueChange(this.getActive());
    }
  }

  create({ name, description, color }) {
    const league = {
      id: 'league_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      name: name.trim(),
      description: (description || '').trim(),
      color: color || '#ff2d2d',
      contestantIds: [],
      createdAt: new Date().toISOString()
    };
    this.leagues.push(league);
    this.save();
    return league;
  }

  update(id, updates) {
    const league = this.getById(id);
    if (!league) return null;
    Object.assign(league, updates);
    this.save();
    return league;
  }

  delete(id) {
    this.leagues = this.leagues.filter(l => l.id !== id);
    if (this.activeLeagueId === id) {
      this.activeLeagueId = this.leagues.length > 0 ? this.leagues[0].id : null;
    }
    this.save();
  }

  addContestant(leagueId, contestantId) {
    const league = this.getById(leagueId);
    if (league && !league.contestantIds.includes(contestantId)) {
      league.contestantIds.push(contestantId);
      this.save();
    }
  }

  removeContestant(leagueId, contestantId) {
    const league = this.getById(leagueId);
    if (league) {
      league.contestantIds = league.contestantIds.filter(id => id !== contestantId);
      this.save();
    }
  }

  getContestantCount(leagueId) {
    const league = this.getById(leagueId);
    return league ? league.contestantIds.length : 0;
  }

  /**
   * Render league cards into the grid
   */
  renderLeagueCards(containerId, emptyId) {
    const container = document.getElementById(containerId);
    const emptyEl = document.getElementById(emptyId);
    if (!container) return;

    container.innerHTML = '';

    if (this.leagues.length === 0) {
      if (emptyEl) emptyEl.style.display = '';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    this.leagues.forEach(league => {
      const card = document.createElement('div');
      card.className = 'league-card';
      card.style.setProperty('--league-color', league.color);
      card.dataset.id = league.id;

      const contestantCount = league.contestantIds.length;

      card.innerHTML = `
        <div class="league-card-actions">
          <button class="league-delete-btn" data-id="${league.id}" title="Delete">🗑</button>
        </div>
        <div class="league-card-name">${this.escapeHtml(league.name)}</div>
        <div class="league-card-desc">${this.escapeHtml(league.description)}</div>
        <div class="league-card-meta">
          <span>👥 ${contestantCount} contestant${contestantCount !== 1 ? 's' : ''}</span>
          <span>📅 ${new Date(league.createdAt).toLocaleDateString()}</span>
        </div>
      `;

      // Click to select league
      card.addEventListener('click', (e) => {
        if (e.target.closest('.league-delete-btn')) return;
        this.setActive(league.id);
        this.updateLeagueSelector();
      });

      // Delete button
      const delBtn = card.querySelector('.league-delete-btn');
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete league "${league.name}"? This cannot be undone.`)) {
          this.delete(league.id);
          this.renderLeagueCards(containerId, emptyId);
          this.updateLeagueSelector();
        }
      });

      container.appendChild(card);
    });
  }

  /**
   * Update the header league selector dropdown
   */
  updateLeagueSelector() {
    const select = document.getElementById('active-league-select');
    if (!select) return;

    const currentVal = select.value;
    select.innerHTML = '<option value="">— Select League —</option>';

    this.leagues.forEach(league => {
      const opt = document.createElement('option');
      opt.value = league.id;
      opt.textContent = league.name;
      select.appendChild(opt);
    });

    // Restore or set active
    if (this.activeLeagueId) {
      select.value = this.activeLeagueId;
    } else if (currentVal) {
      select.value = currentVal;
    }
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

export { LeagueManager };
