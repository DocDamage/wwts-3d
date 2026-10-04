/**
 * Seasons inside a league. Every battle is tagged with the league's current
 * season; standings can be shown per season or all-time. A season has a
 * playoff line (top N qualify); "Start playoffs" seeds a bracket from the
 * qualifiers, and ending the season crowns a champion (the playoff winner, or
 * the top of the table) with a title in the Hall of Fame.
 */

const uid = () => `season_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/**
 * Standings from the battle history: 3 points a win, 1 a draw.
 * 3/4-way battles count the winner as a win and everyone else as a loss.
 */
function seasonStandings(battles, { leagueId, seasonId = null, playoffSpots = 0, nameOf = null, includeUntagged = false } = {}) {
  const rows = {};
  const row = (id, name) => (rows[id] = rows[id] || { id, name: nameOf?.(id) || name, wins: 0, losses: 0, draws: 0, battles: 0, scoreSum: 0, points: 0, streak: 0, form: [] });
  battles
    .filter(b => !b.isDemo && b.leagueId === leagueId && (!seasonId || b.seasonId === seasonId || (includeUntagged && !b.seasonId)))
    .slice()
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .forEach(b => {
      if (b.kind === 'cypher' && Array.isArray(b.placings)) {
        b.placings.forEach((p, i) => {
          const r = row(p.id, p.name);
          r.battles++;
          r.scoreSum += Number(p.total) || 0;
          if (i === 0) { r.wins++; r.points += 3; r.form.push('W'); } else { r.losses++; r.form.push('L'); }
        });
        return;
      }
      const a = row(b.contestant1Id, b.contestant1Name);
      const c = row(b.contestant2Id, b.contestant2Name);
      a.battles++; c.battles++;
      a.scoreSum += Number(b.total1) || 0;
      c.scoreSum += Number(b.total2) || 0;
      if (b.winnerId === b.contestant1Id) { a.wins++; a.points += 3; c.losses++; a.form.push('W'); c.form.push('L'); }
      else if (b.winnerId === b.contestant2Id) { c.wins++; c.points += 3; a.losses++; c.form.push('W'); a.form.push('L'); }
      else { a.draws++; c.draws++; a.points++; c.points++; a.form.push('D'); c.form.push('D'); }
    });
  return Object.values(rows)
    .map(r => {
      // current streak from the form guide
      let streak = 0;
      for (let i = r.form.length - 1; i >= 0; i--) {
        const f = r.form[i];
        if (f === 'D') break;
        if (streak === 0) streak = f === 'W' ? 1 : -1;
        else if ((streak > 0 && f === 'W') || (streak < 0 && f === 'L')) streak += streak > 0 ? 1 : -1;
        else break;
      }
      return {
        ...r,
        winRate: r.battles ? (r.wins + r.draws * 0.5) / r.battles : 0,
        avgScore: r.battles ? Number((r.scoreSum / r.battles).toFixed(2)) : 0,
        streak,
        form: r.form.slice(-5)
      };
    })
    .sort((x, y) => y.points - x.points || y.winRate - x.winRate || y.avgScore - x.avgScore || x.name.localeCompare(y.name))
    .map((r, i) => ({ ...r, rank: i + 1, qualified: playoffSpots > 0 && i < playoffSpots }));
}

class Seasons {
  constructor({ leagues }) {
    this.leagues = leagues;
  }

  /** The league's season list (an implicit first season is created on demand) */
  list(league = this.leagues.getActive()) {
    return league?.seasons || [];
  }

  current(league = this.leagues.getActive()) {
    if (!league) return null;
    return (league.seasons || []).find(s => s.id === league.currentSeasonId && !s.endedAt) || null;
  }

  /** Make sure the active league has a running season (Season 1 the first time) */
  ensure(league = this.leagues.getActive()) {
    if (!league) return null;
    const cur = this.current(league);
    if (cur) return cur;
    const n = (league.seasons || []).length + 1;
    return this.start(`Season ${n}`, { league });
  }

  start(name, { league = this.leagues.getActive(), playoffSpots = 4 } = {}) {
    if (!league) return null;
    const seasons = [...(league.seasons || [])];
    const now = new Date().toISOString();
    seasons.forEach(s => { if (!s.endedAt && s.id === league.currentSeasonId) s.endedAt = now; });
    const season = { id: uid(), name: String(name || `Season ${seasons.length + 1}`).slice(0, 40), startedAt: now, endedAt: null, playoffSpots, championId: null, championName: null };
    seasons.push(season);
    this.leagues.update(league.id, { seasons, currentSeasonId: season.id });
    return season;
  }

  update(seasonId, fields, league = this.leagues.getActive()) {
    const seasons = (league?.seasons || []).map(s => (s.id === seasonId ? { ...s, ...fields } : s));
    this.leagues.update(league.id, { seasons });
  }

  /** End the current season with a champion; returns the closed season */
  end(championId, championName, league = this.leagues.getActive()) {
    const cur = this.current(league);
    if (!cur) return null;
    this.update(cur.id, { endedAt: new Date().toISOString(), championId: championId || null, championName: championName || null }, league);
    this.leagues.update(league.id, { currentSeasonId: null });
    return { ...cur, championId, championName };
  }
}

class SeasonsPanel {
  constructor({ seasons, history, roster, leagues, tournament, achievements, toast, onChange }) {
    Object.assign(this, { seasons, history, roster, leagues, tournament, achievements, toast: toast || (() => {}), onChange });
    this.view = 'current';   // 'current' | seasonId | 'all'
  }

  init() {
    this.modal = document.getElementById('season-modal');
    document.getElementById('standings-season')?.addEventListener('change', (e) => { this.view = e.target.value; this.onChange?.(); });
    document.getElementById('btn-seasons')?.addEventListener('click', () => this.open());
    this.modal?.addEventListener('click', (e) => { if (e.target === this.modal || e.target.closest('[data-close="season-modal"]')) this.modal.style.display = 'none'; });
    const $ = (id) => document.getElementById(id);
    $('season-spots')?.addEventListener('change', (e) => {
      const cur = this.seasons.ensure();
      this.seasons.update(cur.id, { playoffSpots: Math.max(0, Math.min(32, Number(e.target.value) || 0)) });
      this.render();
      this.onChange?.();
    });
    $('season-name')?.addEventListener('change', (e) => {
      const cur = this.seasons.ensure();
      this.seasons.update(cur.id, { name: e.target.value.slice(0, 40) || cur.name });
      this.render();
      this.onChange?.();
    });
    $('season-playoffs')?.addEventListener('click', () => this.startPlayoffs());
    $('season-end')?.addEventListener('click', () => this.endSeason());
    $('season-new')?.addEventListener('click', () => {
      const name = prompt('Name of the new season', `Season ${this.seasons.list().length + 1}`);
      if (!name) return;
      this.seasons.start(name);
      this.toast(`🗓 ${name} started`);
      this.render();
      this.onChange?.();
    });
  }

  open() {
    this.seasons.ensure();
    this.render();
    if (this.modal) this.modal.style.display = '';
  }

  /** The season the standings show (null = all-time) */
  viewSeasonId() {
    if (this.view === 'all') return null;
    if (this.view === 'current') return this.seasons.current()?.id || null;
    return this.view;
  }

  standings(seasonId = this.viewSeasonId()) {
    const league = this.leagues.getActive();
    const season = seasonId ? this.seasons.list().find(s => s.id === seasonId) : null;
    // battles from before seasons existed belong to the league's first season
    const first = this.seasons.list()[0];
    return seasonStandings(this.history.history, { leagueId: league?.id, seasonId, playoffSpots: season?.playoffSpots || 0, nameOf: (id) => this.roster.getById(id)?.name, includeUntagged: !!seasonId && first?.id === seasonId });
  }

  startPlayoffs() {
    const cur = this.seasons.ensure();
    const rows = this.standings(cur.id).filter(r => r.qualified);
    if (rows.length < 2) return this.toast('Set a playoff line with at least two qualifiers (and play some battles)');
    if (this.tournament.bracket && !this.tournament.isTournamentComplete() && !confirm('A bracket is already running. Replace it with the playoffs?')) return;
    this.tournament.start({ name: `${cur.name} Playoffs`, format: 'single', entrants: rows.map((r, i) => ({ id: r.id, seed: i + 1, rating: this.roster.ratingOf(this.roster.getById(r.id) || {}) })) });
    this.seasons.update(cur.id, { playoffTournamentId: this.tournament.bracket?.id || null });
    this.toast(`🏆 ${cur.name} playoffs: ${rows.length} qualifiers`);
    this.modal.style.display = 'none';
    this.tournament.openModal();
  }

  endSeason() {
    const cur = this.seasons.current();
    if (!cur) return this.toast('No season running');
    let champ = null;
    const t = this.tournament;
    if (cur.playoffTournamentId && t.bracket?.id === cur.playoffTournamentId && t.isTournamentComplete()) {
      const w = t.getTournamentWinner();
      if (w) champ = { id: w.id, name: w.name };
    }
    if (!champ) {
      const top = this.standings(cur.id)[0];
      if (top) champ = { id: top.id, name: top.name };
    }
    if (!confirm(`End ${cur.name}${champ ? ` with ${champ.name} as champion` : ''}?`)) return;
    this.seasons.end(champ?.id, champ?.name);
    if (champ) this.achievements?.addTitle(champ.id, { tournamentId: cur.id, name: `${cur.name} Champion` });
    this.toast(champ ? `👑 ${champ.name} is the ${cur.name} champion` : `${cur.name} ended`);
    this.view = 'current';
    this.render();
    this.onChange?.();
  }

  /** The season selector above the standings */
  renderSelector() {
    const sel = document.getElementById('standings-season');
    if (!sel) return;
    const list = this.seasons.list();
    const cur = this.seasons.current();
    sel.innerHTML = `<option value="current">${cur ? `${esc(cur.name)} (current)` : 'Current season'}</option>`
      + list.filter(s => s.endedAt).reverse().map(s => `<option value="${s.id}">${esc(s.name)}${s.championName ? ` · 👑 ${esc(s.championName)}` : ''}</option>`).join('')
      + '<option value="all">All-time (career)</option>';
    sel.value = [...sel.options].some(o => o.value === this.view) ? this.view : 'current';
  }

  render() {
    if (!this.modal) return;
    const cur = this.seasons.current();
    const $ = (id) => document.getElementById(id);
    $('season-name').value = cur?.name || '';
    $('season-spots').value = cur?.playoffSpots ?? 4;
    $('season-started').textContent = cur ? `Started ${new Date(cur.startedAt).toLocaleDateString()}` : 'No season running';
    const past = this.seasons.list().filter(s => s.endedAt).reverse();
    $('season-past').innerHTML = past.length
      ? past.map(s => `<li><b>${esc(s.name)}</b> <small>${new Date(s.startedAt).toLocaleDateString()} – ${new Date(s.endedAt).toLocaleDateString()}</small>${s.championName ? ` · 👑 ${esc(s.championName)}` : ''}</li>`).join('')
      : '<li class="profile-muted">No finished seasons yet.</li>';
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export { Seasons, SeasonsPanel, seasonStandings };
