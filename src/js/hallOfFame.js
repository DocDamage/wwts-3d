/**
 * Hall of Fame UI — league records, every producer's badges with progress,
 * profile badge rows, and the on-stage "achievement unlocked" moments.
 */

import { BADGES } from './achievements.js';

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

class HallOfFame {
  constructor({ engine, roster, leagues, djController, announcer, getStageSide }) {
    this.engine = engine;
    this.roster = roster;
    this.leagues = leagues;
    this.dj = djController;
    this.announcer = announcer;
    this.getStageSide = getStageSide; // (contestantId) => 1 | 2 | null (who's on stage)
    this.selected = null;
    this.queue = [];
    this.showing = false;
  }

  render(leagueId) {
    this.renderRecords(leagueId);
    this.renderProducers(leagueId);
  }

  renderRecords(leagueId) {
    const el = document.getElementById('hof-records');
    if (!el) return;
    const records = leagueId ? this.engine.records(leagueId) : [];
    el.innerHTML = records.length
      ? records.map(r => `
        <div class="hof-record">
          <span class="hof-icon">${r.icon}</span>
          <span class="hof-label">${escapeHtml(r.label)}</span>
          <span class="hof-value">${escapeHtml(r.value)}</span>
          <span class="hof-holder">${escapeHtml(r.holder)}</span>
        </div>`).join('')
      : '<p class="empty-state">Records appear after the first official battle.</p>';
  }

  renderProducers(leagueId) {
    const chips = document.getElementById('badge-producer-chips');
    const grid = document.getElementById('badge-grid');
    if (!chips || !grid) return;
    const list = leagueId ? this.roster.getForLeague(leagueId) : [];
    if (!list.length) {
      chips.innerHTML = '';
      grid.innerHTML = '<p class="empty-state">Add producers to this league to start earning badges.</p>';
      return;
    }
    if (!this.selected || !list.some(c => c.id === this.selected)) this.selected = list[0].id;
    chips.innerHTML = list.map(c => {
      const count = this.engine.earnedCount(c.id);
      return `<button type="button" class="badge-chip ${c.id === this.selected ? 'active' : ''}" data-id="${c.id}">
        ${escapeHtml(c.name)} <span class="badge-chip-count">${count}</span>
      </button>`;
    }).join('');
    chips.querySelectorAll('.badge-chip').forEach(btn => btn.addEventListener('click', () => {
      this.selected = btn.dataset.id;
      this.renderProducers(leagueId);
    }));
    grid.innerHTML = this.badgeGridHtml(this.selected);
  }

  badgeGridHtml(id, { compact = false } = {}) {
    const badges = this.engine.evaluate(id);
    const titles = this.engine.titles[id] || [];
    const groups = [...new Set(BADGES.map(b => b.group))];
    const titleHtml = titles.length
      ? `<div class="badge-titles">${titles.map(t => `<span class="badge-title">👑 ${escapeHtml(t.name)} <small>${new Date(t.date).toLocaleDateString()}</small></span>`).join('')}</div>`
      : '';
    const card = (b) => {
      const tierClass = b.unlocked ? `tier-${Math.min(b.tier, 4)}${b.maxTier === 1 ? ' single' : ''}` : 'locked';
      const progress = b.next === null ? '' : `
        <div class="badge-progress"><span style="width:${Math.round(b.progress * 100)}%"></span></div>
        <span class="badge-next">${b.value} / ${b.next}</span>`;
      return `<div class="badge-card ${tierClass}" title="${escapeHtml(b.desc)}">
        <span class="badge-icon">${b.icon}</span>
        <div class="badge-info">
          <span class="badge-name">${escapeHtml(b.name)}${b.tierLabel ? ` <em>${escapeHtml(b.tierLabel)}</em>` : ''}</span>
          <span class="badge-desc">${escapeHtml(b.desc)}</span>
          ${compact ? '' : progress}
        </div>
      </div>`;
    };
    if (compact) {
      const earned = badges.filter(b => b.unlocked);
      return titleHtml + (earned.length ? `<div class="badge-grid compact">${earned.map(card).join('')}</div>` : '<p class="empty-state">No badges yet — go win some battles.</p>');
    }
    return titleHtml + groups.map(g => `
      <div class="badge-group">
        <h4>${g}</h4>
        <div class="badge-grid-inner">${badges.filter(b => b.group === g).map(card).join('')}</div>
      </div>`).join('');
  }

  /** Badges inside the roster profile modal */
  renderProfile(id) {
    const el = document.getElementById('profile-badges');
    if (el) el.innerHTML = this.badgeGridHtml(id, { compact: true });
  }

  /* ---------------- Unlock moments ---------------- */

  /** Check both producers after a battle; returns [{ contestantId, name, badge }] */
  collectUnlocks(contestantIds) {
    const out = [];
    contestantIds.forEach(id => {
      const name = this.roster.getById(id)?.name || 'Producer';
      this.engine.newlyUnlocked(id).forEach(badge => out.push({ contestantId: id, name, badge }));
    });
    return out;
  }

  /** Queue the big "achievement unlocked" banners (with a stage reaction for each) */
  celebrate(unlocks, delay = 0) {
    if (!unlocks.length) return;
    setTimeout(() => {
      this.queue.push(...unlocks);
      if (!this.showing) this.next();
    }, delay);
  }

  next() {
    const item = this.queue.shift();
    if (!item) {
      this.showing = false;
      return;
    }
    this.showing = true;
    const { badge, name, contestantId } = item;
    let pop = document.getElementById('achievement-pop');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'achievement-pop';
      pop.className = 'achievement-pop';
      pop.setAttribute('role', 'status');
      document.body.appendChild(pop);
    }
    const tierClass = badge.maxTier === 1 ? 'tier-single' : `tier-${Math.min(badge.tier, 4)}`;
    pop.className = `achievement-pop ${tierClass}`;
    pop.innerHTML = `
      <span class="ap-icon">${badge.icon}</span>
      <div class="ap-text">
        <span class="ap-kicker">ACHIEVEMENT UNLOCKED</span>
        <span class="ap-name">${escapeHtml(badge.name)}${badge.tierLabel ? ` · ${escapeHtml(badge.tierLabel)}` : ''}</span>
        <span class="ap-who">${escapeHtml(name)} — ${escapeHtml(badge.desc)}${badge.next === null && badge.maxTier > 1 ? ' (max tier!)' : ''}</span>
      </div>`;
    void pop.offsetWidth;
    pop.classList.add('show');

    // Stage reaction
    const sideNum = this.getStageSide?.(contestantId);
    if (sideNum) this.dj?.playMove(sideNum, badge.tier >= 3 || badge.id === 'perfect10' ? 'flex' : 'hands_up', { fromUser: false });
    this.dj?.triggerCameraFlashes?.(4);
    const line = badge.id === 'perfect10' ? 'perfect' : badge.tier >= 3 ? 'godlike' : badge.id === 'streak' ? 'theyreonfire' : 'amazing';
    this.announcer?.play(line);

    setTimeout(() => {
      pop.classList.remove('show');
      setTimeout(() => this.next(), 450);
    }, 3200);
  }
}

export { HallOfFame };
