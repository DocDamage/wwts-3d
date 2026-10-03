/**
 * Tournaments — single elimination, double elimination (winners + losers
 * brackets, grand final with bracket reset) and round robin (optional final).
 *
 * Every match pulls its two players from a source: a seed, or the winner/loser
 * of an earlier match. Resolving sources fills the bracket; byes advance on
 * their own. Seeding: Elo rating (average score breaks ties), unrated
 * producers drawn at random after them, standard placement (1 v 16, 8 v 9 …)
 * so byes go to the top seeds; the host can reorder before starting.
 */

const STORAGE_KEY = 'wwts_tournament_v2';
const LEGACY_KEY = 'beatbattle_tournament_state';
const BYE = 'BYE';

const FORMAT_LABELS = {
  single: 'Single Elimination',
  double: 'Double Elimination',
  roundrobin: 'Round Robin'
};

/* ============================================================
   PURE BRACKET LOGIC (exported for tests)
   ============================================================ */

/** Standard seed order for a power-of-two bracket: [1, 16, 8, 9, 5, 12, 4, 13, …] */
function standardSeedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap(s => [s, n + 1 - s]);
  }
  return order;
}

/** Rated producers by Elo (avg score breaks ties), then unrated ones in random order */
function seedEntrants(contestants, rng = Math.random) {
  const rated = [];
  const unrated = [];
  contestants.forEach(c => {
    const st = c.stats || {};
    const entry = { id: c.id, rating: typeof st.rating === 'number' ? st.rating : 1500, avg: st.avgScore || 0, battles: st.totalBattles || 0 };
    (entry.battles > 0 ? rated : unrated).push(entry);
  });
  rated.sort((a, b) => b.rating - a.rating || b.avg - a.avg);
  for (let i = unrated.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [unrated[i], unrated[j]] = [unrated[j], unrated[i]];
  }
  return [...rated, ...unrated].map((e, i) => ({ ...e, seed: i + 1, unrated: e.battles === 0 }));
}

const nextPow2 = (n) => Math.pow(2, Math.ceil(Math.log2(Math.max(2, n))));

function makeMatch(id, bracket, round, slot, src1, src2, extra = {}) {
  return { id, bracket, round, slot, src1, src2, p1: null, p2: null, winnerId: null, loserId: null, completed: false, isBye: false, ...extra };
}

/** Winners-bracket rounds (also the whole single-elimination bracket) */
function buildWinners(entrants, prefix = 'W') {
  const size = nextPow2(entrants.length);
  const order = standardSeedOrder(size);
  const rounds = Math.log2(size);
  const matches = [];
  for (let m = 0; m < size / 2; m++) {
    const s1 = order[2 * m];
    const s2 = order[2 * m + 1];
    matches.push(makeMatch(`${prefix}1-${m}`, prefix, 1, m, { seed: s1 }, { seed: s2 }));
  }
  for (let r = 2; r <= rounds; r++) {
    const count = size / Math.pow(2, r);
    for (let m = 0; m < count; m++) {
      matches.push(makeMatch(`${prefix}${r}-${m}`, prefix, r, m,
        { match: `${prefix}${r - 1}-${2 * m}`, take: 'winner' },
        { match: `${prefix}${r - 1}-${2 * m + 1}`, take: 'winner' }));
    }
  }
  return { matches, rounds, size };
}

function buildSingle(entrants) {
  const { matches, rounds, size } = buildWinners(entrants);
  return { matches, meta: { wbRounds: rounds, size } };
}

/**
 * Double elimination for a power-of-two field: losers bracket has
 * 2·(log2 N − 1) rounds alternating "drop-in" rounds (WB losers enter, in
 * reversed order to avoid instant rematches) and "consolidation" rounds.
 */
function buildDouble(entrants) {
  const { matches: wb, rounds: wbRounds, size } = buildWinners(entrants);
  const matches = [...wb];
  const lbRounds = 2 * (wbRounds - 1);
  let prevRound = [];

  for (let lr = 1; lr <= lbRounds; lr++) {
    const cur = [];
    if (lr === 1) {
      // Losers of WB round 1 pair up
      const n = size / 4;
      for (let m = 0; m < n; m++) {
        cur.push(makeMatch(`L1-${m}`, 'L', 1, m,
          { match: `W1-${2 * m}`, take: 'loser' },
          { match: `W1-${2 * m + 1}`, take: 'loser' }));
      }
    } else if (lr % 2 === 0) {
      // Drop-in: LB survivors meet WB round (lr/2 + 1) losers, reversed
      const wbRound = lr / 2 + 1;
      const n = prevRound.length;
      for (let m = 0; m < n; m++) {
        cur.push(makeMatch(`L${lr}-${m}`, 'L', lr, m,
          { match: prevRound[m].id, take: 'winner' },
          { match: `W${wbRound}-${n - 1 - m}`, take: 'loser' }));
      }
    } else {
      // Consolidation: LB survivors pair up
      const n = prevRound.length / 2;
      for (let m = 0; m < n; m++) {
        cur.push(makeMatch(`L${lr}-${m}`, 'L', lr, m,
          { match: prevRound[2 * m].id, take: 'winner' },
          { match: prevRound[2 * m + 1].id, take: 'winner' }));
      }
    }
    matches.push(...cur);
    prevRound = cur;
  }

  const wbFinal = `W${wbRounds}-0`;
  const lbFinal = prevRound.length ? prevRound[0].id : wbFinal;
  matches.push(makeMatch('GF-1', 'GF', 1, 0, { match: wbFinal, take: 'winner' }, { match: lbFinal, take: lbRounds ? 'winner' : 'loser' }));
  // Bracket reset: only played if the losers-bracket champion wins the first grand final
  matches.push(makeMatch('GF-2', 'GF', 2, 0, { match: 'GF-1', take: 'p1' }, { match: 'GF-1', take: 'p2' }, { conditional: true }));
  return { matches, meta: { wbRounds, lbRounds, size } };
}

/** Circle-method schedule: everyone meets everyone once */
function buildRoundRobin(entrants, withFinal = false) {
  const ids = entrants.map(e => e.seed);
  if (ids.length % 2) ids.push(null);
  const n = ids.length;
  const matches = [];
  const rounds = n - 1;
  let arr = [...ids];
  for (let r = 1; r <= rounds; r++) {
    for (let m = 0; m < n / 2; m++) {
      const a = arr[m];
      const b = arr[n - 1 - m];
      if (a !== null && b !== null) {
        matches.push(makeMatch(`R${r}-${m}`, 'RR', r, m, { seed: Math.min(a, b) }, { seed: Math.max(a, b) }));
      }
    }
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }
  if (withFinal && entrants.length >= 3) {
    matches.push(makeMatch('F-1', 'F', 1, 0, { table: 1 }, { table: 2 }));
  }
  return { matches, meta: { rrRounds: rounds, withFinal } };
}

/** Round-robin table: wins, draws (½), head-to-head, average score, rating */
function roundRobinTable(t) {
  const rows = Object.fromEntries(t.entrants.map(e => [e.id, { id: e.id, seed: e.seed, rating: e.rating, played: 0, wins: 0, losses: 0, draws: 0, points: 0, scoreFor: 0, scoreAgainst: 0 }]));
  const rr = t.matches.filter(m => m.bracket === 'RR' && m.completed && !m.isBye);
  rr.forEach(m => {
    const a = rows[m.p1];
    const b = rows[m.p2];
    if (!a || !b) return;
    a.played++; b.played++;
    a.scoreFor += m.score1 || 0; a.scoreAgainst += m.score2 || 0;
    b.scoreFor += m.score2 || 0; b.scoreAgainst += m.score1 || 0;
    if (!m.winnerId || m.draw) { a.draws++; b.draws++; a.points += 0.5; b.points += 0.5; }
    else if (m.winnerId === a.id) { a.wins++; b.losses++; a.points += 1; }
    else { b.wins++; a.losses++; b.points += 1; }
  });
  const h2h = (x, y) => {
    const m = rr.find(mm => (mm.p1 === x.id && mm.p2 === y.id) || (mm.p1 === y.id && mm.p2 === x.id));
    if (!m || !m.winnerId || m.draw) return 0;
    return m.winnerId === x.id ? -1 : 1;
  };
  return Object.values(rows)
    .map(r => ({ ...r, avg: r.played ? r.scoreFor / r.played : 0, diff: r.scoreFor - r.scoreAgainst }))
    .sort((x, y) => y.points - x.points || h2h(x, y) || y.diff - x.diff || y.rating - x.rating)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Fill participants from sources and auto-complete byes until nothing changes */
function resolveTournament(t) {
  const byId = Object.fromEntries(t.matches.map(m => [m.id, m]));
  const seedToId = Object.fromEntries(t.entrants.map(e => [e.seed, e.id]));
  const rrDone = () => t.matches.filter(m => m.bracket === 'RR').every(m => m.completed);

  const pull = (src) => {
    if (src.seed !== undefined) return seedToId[src.seed] || BYE;
    if (src.table !== undefined) {
      if (!rrDone()) return null;
      return roundRobinTable(t)[src.table - 1]?.id || BYE;
    }
    const from = byId[src.match];
    if (!from || !from.completed) return null;
    if (src.take === 'winner') return from.winnerId || BYE;
    if (src.take === 'loser') return from.loserId || BYE;
    if (src.take === 'p1') return from.p1;
    if (src.take === 'p2') return from.p2;
    return null;
  };

  let changed = true;
  let guard = 0;
  while (changed && guard++ < 500) {
    changed = false;
    t.matches.forEach(m => {
      if (m.completed) return;
      const p1 = pull(m.src1);
      const p2 = pull(m.src2);
      if (p1 !== m.p1 || p2 !== m.p2) {
        m.p1 = p1;
        m.p2 = p2;
        changed = true;
      }
      // Grand-final reset is only needed if the losers-bracket champion won GF-1
      if (m.conditional) {
        const gf1 = byId['GF-1'];
        if (gf1?.completed && gf1.winnerId === gf1.p1) {
          m.completed = true;
          m.skipped = true;
          m.winnerId = gf1.winnerId;
          m.loserId = gf1.loserId;
          changed = true;
        }
        return;
      }
      if (m.p1 && m.p2 && (m.p1 === BYE || m.p2 === BYE)) {
        m.isBye = true;
        m.completed = true;
        m.winnerId = m.p1 === BYE ? (m.p2 === BYE ? null : m.p2) : m.p1;
        m.loserId = null;
        changed = true;
      }
    });
  }

  // Champion
  let champ = null;
  if (t.format === 'roundrobin') {
    const fin = byId['F-1'];
    if (fin) champ = fin.completed ? fin.winnerId : null;
    else if (rrDone()) champ = roundRobinTable(t)[0]?.id || null;
  } else if (t.format === 'double') {
    const gf2 = byId['GF-2'];
    if (gf2?.completed) champ = gf2.winnerId;
  } else {
    const final = t.matches.filter(m => m.bracket === 'W').sort((a, b) => b.round - a.round)[0];
    if (final?.completed) champ = final.winnerId;
  }
  t.championId = champ;
  t.status = champ ? 'complete' : 'active';
  return t;
}

function createTournament({ name, format, entrants, rrFinal = false }) {
  const built = format === 'double' ? buildDouble(entrants)
    : format === 'roundrobin' ? buildRoundRobin(entrants, rrFinal)
    : buildSingle(entrants);
  const t = {
    id: `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name: name || 'Tournament',
    format: FORMAT_LABELS[format] ? format : 'single',
    createdAt: new Date().toISOString(),
    entrants,
    matches: built.matches,
    meta: built.meta,
    currentMatchId: null,
    championId: null,
    status: 'active'
  };
  return resolveTournament(t);
}

/** Apply an official battle result to a match */
function applyResult(t, matchId, finalResult) {
  const m = t.matches.find(x => x.id === matchId);
  if (!m || m.completed || !finalResult) return false;
  const c1 = finalResult.contestant1?.id;
  const ss = finalResult.seriesSummary || {};
  const flip = c1 === m.p2; // battle loaded the other way round
  const s1 = ss.avgRound1 ?? finalResult.roundResults?.[0]?.total1 ?? 0;
  const s2 = ss.avgRound2 ?? finalResult.roundResults?.[0]?.total2 ?? 0;
  m.score1 = flip ? s2 : s1;
  m.score2 = flip ? s1 : s2;
  m.roundsWon1 = flip ? ss.roundsWon2 : ss.roundsWon1;
  m.roundsWon2 = flip ? ss.roundsWon1 : ss.roundsWon2;
  m.decision = finalResult.decisionMethod;
  m.battleId = finalResult.id;

  let winner = finalResult.winnerId;
  if (!winner && m.bracket !== 'RR') {
    // Elimination needs a winner: higher average score, then higher seed
    if (m.score1 !== m.score2) winner = m.score1 > m.score2 ? m.p1 : m.p2;
    else {
      const seedOf = (id) => t.entrants.find(e => e.id === id)?.seed ?? 99;
      winner = seedOf(m.p1) <= seedOf(m.p2) ? m.p1 : m.p2;
      m.advancedOnSeed = true;
    }
    m.decision = 'DRAW_TIEBREAK';
  }
  m.draw = !winner;
  m.winnerId = winner || null;
  m.loserId = winner ? (winner === m.p1 ? m.p2 : m.p1) : null;
  m.completed = true;
  if (t.currentMatchId === matchId) t.currentMatchId = null;
  resolveTournament(t);
  return true;
}

function playableMatches(t) {
  return t.matches.filter(m => !m.completed && m.p1 && m.p2 && m.p1 !== BYE && m.p2 !== BYE);
}

/* ============================================================
   MANAGER (state, persistence, UI)
   ============================================================ */

class TournamentManager {
  constructor(rosterManager, leagueManager) {
    this.roster = rosterManager;
    this.leagues = leagueManager;
    this.t = null;
    this.setupOrder = [];   // seeded entrants on the setup screen (host can reorder)
    this.onMatchSelect = null;
    this.loadState();
  }

  /** Existing app code checks `tournament.bracket` for "is there a tournament" */
  get bracket() {
    return this.t;
  }

  loadState() {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(STORAGE_KEY);
      this.t = raw ? JSON.parse(raw) : null;
      localStorage.removeItem(LEGACY_KEY); // old single-elim format can't be resumed
    } catch {
      this.t = null;
    }
  }

  saveState() {
    try {
      if (typeof localStorage === 'undefined') return;
      if (this.t) localStorage.setItem(STORAGE_KEY, JSON.stringify(this.t));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // storage unavailable
    }
  }

  init() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('tournament-modal');
    document.getElementById('btn-tournament')?.addEventListener('click', () => this.openModal());
    modal?.querySelector('[data-close="tournament-modal"]')?.addEventListener('click', () => this.closeModal());
    modal?.addEventListener('click', (e) => { if (e.target === modal) this.closeModal(); });
    document.getElementById('btn-start-tournament')?.addEventListener('click', () => this.startFromSetup());
    document.getElementById('btn-seed-rating')?.addEventListener('click', () => this.reseed('rating'));
    document.getElementById('btn-seed-random')?.addEventListener('click', () => this.reseed('random'));
    document.getElementById('tournament-format')?.addEventListener('change', () => this.updateSetupSummary());
    document.getElementById('tournament-rr-final')?.addEventListener('change', () => this.updateSetupSummary());
  }

  openModal() {
    const modal = document.getElementById('tournament-modal');
    if (!modal) return;
    modal.style.display = '';
    if (this.t) this.showBracket();
    else this.showSetup();
  }

  closeModal() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('tournament-modal');
    if (modal) modal.style.display = 'none';
  }

  /* ---------------- Setup ---------------- */

  showSetup() {
    document.getElementById('tournament-setup').style.display = '';
    document.getElementById('tournament-bracket').style.display = 'none';
    const nameInput = document.getElementById('tournament-name');
    if (nameInput && !nameInput.value) nameInput.value = `${this.leagues?.getActive?.()?.name || 'WWTS'} Tournament`;
    this.reseed('rating');
  }

  leagueContestants() {
    return this.roster ? this.roster.getForLeague(this.leagues?.activeLeagueId) : [];
  }

  reseed(mode) {
    const included = new Set(this.setupOrder.length ? this.setupOrder.filter(e => !e.excluded).map(e => e.id) : this.leagueContestants().map(c => c.id));
    const all = this.leagueContestants();
    let seeded = seedEntrants(all);
    if (mode === 'random') {
      for (let i = seeded.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [seeded[i], seeded[j]] = [seeded[j], seeded[i]];
      }
    }
    this.setupOrder = seeded.map(e => ({ ...e, excluded: !included.has(e.id) }));
    this.renderSetupList();
  }

  renderSetupList() {
    const list = document.getElementById('tournament-seed-list');
    if (!list) return;
    if (this.setupOrder.length < 2) {
      list.innerHTML = '<p class="empty-state">Add at least 2 producers to this league to run a tournament.</p>';
      this.updateSetupSummary();
      return;
    }
    let seed = 0;
    list.innerHTML = this.setupOrder.map((e, i) => {
      const c = this.roster.getById(e.id);
      const label = e.excluded ? '—' : ++seed;
      return `<li class="seed-row ${e.excluded ? 'excluded' : ''}" draggable="${!e.excluded}" data-index="${i}">
        <span class="seed-grip" aria-hidden="true">⠿</span>
        <span class="seed-num">${label}</span>
        <span class="seed-name">${this.escape(c?.name || e.id)}</span>
        <span class="seed-rating">${e.unrated ? '<em>unrated</em>' : e.rating}</span>
        <span class="seed-moves">
          <button type="button" data-move="-1" title="Move up" ${e.excluded ? 'disabled' : ''}>▲</button>
          <button type="button" data-move="1" title="Move down" ${e.excluded ? 'disabled' : ''}>▼</button>
          <label class="seed-in"><input type="checkbox" ${e.excluded ? '' : 'checked'} data-toggle /> In</label>
        </span>
      </li>`;
    }).join('');

    list.querySelectorAll('.seed-row').forEach(row => {
      const i = Number(row.dataset.index);
      row.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', () => this.moveSeed(i, Number(b.dataset.move))));
      row.querySelector('[data-toggle]').addEventListener('change', (ev) => {
        this.setupOrder[i].excluded = !ev.target.checked;
        // Keep excluded producers at the bottom
        this.setupOrder.sort((a, b) => Number(a.excluded) - Number(b.excluded));
        this.renderSetupList();
      });
      row.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', String(i)); row.classList.add('dragging'); });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', (ev) => { ev.preventDefault(); row.classList.add('drop-target'); });
      row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
      row.addEventListener('drop', (ev) => {
        ev.preventDefault();
        const from = Number(ev.dataTransfer.getData('text/plain'));
        const [moved] = this.setupOrder.splice(from, 1);
        this.setupOrder.splice(i, 0, moved);
        this.setupOrder.sort((a, b) => Number(a.excluded) - Number(b.excluded));
        this.renderSetupList();
      });
    });
    this.updateSetupSummary();
  }

  moveSeed(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= this.setupOrder.length || this.setupOrder[j].excluded) return;
    [this.setupOrder[i], this.setupOrder[j]] = [this.setupOrder[j], this.setupOrder[i]];
    this.renderSetupList();
  }

  updateSetupSummary() {
    const format = document.getElementById('tournament-format')?.value || 'single';
    const rrFinalWrap = document.getElementById('tournament-rr-final-wrap');
    if (rrFinalWrap) rrFinalWrap.style.display = format === 'roundrobin' ? '' : 'none';
    const n = this.setupOrder.filter(e => !e.excluded).length;
    const summary = document.getElementById('tournament-summary');
    const startBtn = document.getElementById('btn-start-tournament');
    const min = format === 'double' ? 3 : 2;
    let text = '';
    if (n < min) text = `Pick at least ${min} producers.`;
    else if (format === 'roundrobin') {
      const games = (n * (n - 1)) / 2 + (document.getElementById('tournament-rr-final')?.checked && n >= 3 ? 1 : 0);
      text = `${n} producers · ${games} battles · everyone meets everyone once`;
    } else {
      const size = nextPow2(n);
      const byes = size - n;
      // Double elimination: everyone but the champion loses twice (+1 if the grand final resets)
      const games = format === 'double' ? 2 * n - 2 : n - 1;
      text = `${n} producers · ${size}-slot bracket${byes ? ` · ${byes} bye${byes > 1 ? 's' : ''} for the top seed${byes > 1 ? 's' : ''}` : ''} · ${format === 'double' ? `${games}–${games + 1}` : games} battles`;
    }
    if (summary) summary.textContent = text;
    if (startBtn) startBtn.disabled = n < min;
  }

  startFromSetup() {
    const format = document.getElementById('tournament-format')?.value || 'single';
    const name = document.getElementById('tournament-name')?.value.trim() || 'Tournament';
    const rrFinal = !!document.getElementById('tournament-rr-final')?.checked;
    const entrants = this.setupOrder.filter(e => !e.excluded).map((e, i) => ({ id: e.id, seed: i + 1, rating: e.rating, unrated: e.unrated }));
    this.start({ name, format, entrants, rrFinal });
  }

  start({ name, format, entrants, rrFinal = false }) {
    if (!entrants || entrants.length < 2) return false;
    this.t = createTournament({ name, format, entrants, rrFinal });
    this.saveState();
    this.showBracket();
    return true;
  }

  /** Back-compat: start single elimination from a list of ids, seeded by rating */
  startTournament(ids = null) {
    const contestants = (ids || this.leagueContestants().map(c => c.id)).map(id => this.roster.getById(id)).filter(Boolean);
    return this.start({ name: 'Tournament', format: 'single', entrants: seedEntrants(contestants) });
  }

  /* ---------------- Playing ---------------- */

  getNextPlayableMatch() {
    if (!this.t) return null;
    const m = playableMatches(this.t)[0];
    if (!m) return null;
    return {
      matchId: m.id,
      round: m.round,
      match: m.slot,
      player1Id: m.p1,
      player2Id: m.p2,
      p1Name: this.roster?.getById(m.p1)?.name || 'Contestant 1',
      p2Name: this.roster?.getById(m.p2)?.name || 'Contestant 2',
      label: this.matchLabel(m)
    };
  }

  /** Load a match into the battle arena (accepts a match id, or round/slot for older callers) */
  selectMatch(matchIdOrRound, slot = null) {
    if (!this.t) return false;
    const m = typeof matchIdOrRound === 'string'
      ? this.t.matches.find(x => x.id === matchIdOrRound)
      : playableMatches(this.t).find(x => x.round === matchIdOrRound && x.slot === slot);
    if (!m || m.completed || !m.p1 || !m.p2 || m.p1 === BYE || m.p2 === BYE) return false;
    this.t.currentMatchId = m.id;
    this.saveState();
    this.onMatchSelect?.(m.p1, m.p2, m);
    this.closeModal();
    return true;
  }

  /** A battle in progress belongs to the tournament */
  isTournamentActive() {
    return !!(this.t && this.t.currentMatchId);
  }

  isTournamentComplete() {
    return !!(this.t && this.t.championId);
  }

  getTournamentWinner() {
    return this.t?.championId ? this.roster?.getById(this.t.championId) : null;
  }

  /** Consume the official result of the current tournament battle */
  recordFinalizedResult(finalResult) {
    if (!this.t || !this.t.currentMatchId || !finalResult) return false;
    const m = this.t.matches.find(x => x.id === this.t.currentMatchId);
    const ids = [finalResult.contestant1?.id, finalResult.contestant2?.id];
    if (!m || !ids.includes(m.p1) || !ids.includes(m.p2)) {
      console.warn('Tournament: finished battle does not match the loaded tournament match; not recorded.');
      return false;
    }
    const ok = applyResult(this.t, m.id, finalResult);
    this.saveState();
    this.renderBracket();
    return ok;
  }

  resetTournament() {
    this.t = null;
    this.saveState();
    if (typeof document !== 'undefined' && document.getElementById('tournament-setup')) this.showSetup();
  }

  /* ---------------- Bracket view ---------------- */

  matchLabel(m) {
    if (m.bracket === 'GF') return m.round === 2 ? 'Grand Final (reset)' : 'Grand Final';
    if (m.bracket === 'F') return 'Final';
    if (m.bracket === 'RR') return `Round ${m.round}`;
    if (m.bracket === 'L') return `Losers R${m.round}`;
    return this.roundName(m.round, this.t.meta.wbRounds, this.t.format === 'double' ? 'Winners ' : '');
  }

  roundName(r, total, prefix = '') {
    const left = total - r;
    if (left === 0) return `${prefix}Final`;
    if (left === 1) return `${prefix}Semifinals`;
    if (left === 2) return `${prefix}Quarterfinals`;
    return `${prefix}Round of ${Math.pow(2, left + 1)}`;
  }

  showBracket() {
    if (typeof document === 'undefined') return;
    const setup = document.getElementById('tournament-setup');
    const container = document.getElementById('tournament-bracket');
    if (!setup || !container) return;
    setup.style.display = 'none';
    container.style.display = '';
    this.renderBracket();
  }

  renderBracket() {
    if (typeof document === 'undefined' || !this.t) return;
    const container = document.getElementById('tournament-bracket');
    if (!container || container.style.display === 'none') return;
    const t = this.t;
    const next = this.getNextPlayableMatch();
    const champ = this.getTournamentWinner();

    let body = '';
    if (t.format === 'roundrobin') body = this.renderRoundRobin();
    else {
      body += this.renderSection('W', t.format === 'double' ? 'Winners Bracket' : '');
      if (t.format === 'double') {
        body += this.renderSection('L', 'Losers Bracket');
        body += this.renderSection('GF', 'Grand Final');
      }
    }

    container.innerHTML = `
      <div class="tourney-head">
        <div>
          <h3 class="tourney-name">${this.escape(t.name)}</h3>
          <span class="tourney-format">${FORMAT_LABELS[t.format]} · ${t.entrants.length} producers</span>
        </div>
        <div class="tourney-actions">
          ${next ? `<button type="button" class="control-btn primary" id="btn-tourney-next">▶ Play next: ${this.escape(next.p1Name)} vs ${this.escape(next.p2Name)}</button>` : ''}
          <button type="button" class="control-btn secondary" id="btn-tourney-end">${champ ? 'New Tournament' : 'End Tournament'}</button>
        </div>
      </div>
      ${champ ? `<div class="tourney-champ">👑 <b>${this.escape(champ.name)}</b> wins ${this.escape(t.name)}!</div>` : ''}
      ${body}`;

    container.querySelector('#btn-tourney-next')?.addEventListener('click', () => this.selectMatch(next.matchId));
    container.querySelector('#btn-tourney-end')?.addEventListener('click', () => {
      if (champ || confirm(`End "${t.name}"? The bracket will be cleared (battles already played stay in history).`)) this.resetTournament();
    });
    container.querySelectorAll('.bmatch.playable').forEach(el => el.addEventListener('click', () => this.selectMatch(el.dataset.id)));
  }

  renderSection(bracket, title) {
    const matches = this.t.matches.filter(m => m.bracket === bracket && !(m.conditional && m.skipped));
    if (!matches.length) return '';
    const rounds = [...new Set(matches.map(m => m.round))].sort((a, b) => a - b);
    return `<div class="bracket-section ${bracket}">
      ${title ? `<h4 class="bracket-section-title">${title}</h4>` : ''}
      <div class="bracket-columns">
        ${rounds.map(r => {
          const inRound = matches.filter(m => m.round === r);
          const visible = inRound.filter(m => !(m.isBye && bracket !== 'W'));
          if (!visible.length) return '';
          return `<div class="bracket-col">
            <div class="bracket-col-title">${this.matchLabel(inRound[0])}</div>
            <div class="bracket-col-matches">${visible.map(m => this.matchCard(m)).join('')}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  renderRoundRobin() {
    const table = roundRobinTable(this.t);
    const name = (id) => this.escape(this.roster.getById(id)?.name || '—');
    const rounds = [...new Set(this.t.matches.filter(m => m.bracket === 'RR').map(m => m.round))];
    const fin = this.t.matches.find(m => m.bracket === 'F');
    return `
      <div class="rr-layout">
        <table class="rr-table">
          <thead><tr><th>#</th><th>Producer</th><th>P</th><th>W</th><th>D</th><th>L</th><th>Pts</th><th>Avg</th></tr></thead>
          <tbody>${table.map(r => `<tr class="${r.rank <= (fin ? 2 : 1) ? 'qualify' : ''}">
            <td>${r.rank}</td><td>${name(r.id)}</td><td>${r.played}</td><td>${r.wins}</td><td>${r.draws}</td><td>${r.losses}</td>
            <td><b>${r.points}</b></td><td>${r.played ? r.avg.toFixed(2) : '—'}</td></tr>`).join('')}</tbody>
        </table>
        <div class="rr-rounds">
          ${rounds.map(r => `<div class="rr-round"><div class="bracket-col-title">Round ${r}</div>
            ${this.t.matches.filter(m => m.bracket === 'RR' && m.round === r).map(m => this.matchCard(m)).join('')}</div>`).join('')}
          ${fin ? `<div class="rr-round"><div class="bracket-col-title">Final · top 2</div>${this.matchCard(fin)}</div>` : ''}
        </div>
      </div>`;
  }

  matchCard(m) {
    const seedOf = (id) => this.t.entrants.find(e => e.id === id)?.seed;
    const row = (id, score, rw, isWinner) => {
      let label;
      if (id === BYE) label = '<span class="bm-bye">BYE</span>';
      else if (!id) label = '<span class="bm-tbd">TBD</span>';
      else label = `<span class="bm-seed">${seedOf(id) ?? ''}</span>${this.escape(this.roster.getById(id)?.name || '—')}`;
      const sc = m.completed && !m.isBye && score !== undefined ? `${typeof rw === 'number' && (m.roundsWon1 + m.roundsWon2) > 1 ? `${rw}W · ` : ''}${Number(score).toFixed(2)}` : '';
      return `<div class="bm-player ${isWinner ? 'won' : ''} ${m.completed && !isWinner && id && id !== BYE ? 'out' : ''}"><span class="bm-name">${label}</span><span class="bm-score">${sc}</span></div>`;
    };
    const playable = !m.completed && m.p1 && m.p2 && m.p1 !== BYE && m.p2 !== BYE;
    const live = this.t.currentMatchId === m.id;
    const note = m.advancedOnSeed ? '<span class="bm-note">drew · higher seed advances</span>'
      : m.decision === 'DRAW_TIEBREAK' ? '<span class="bm-note">drew · advanced on points</span>'
      : m.draw ? '<span class="bm-note">draw</span>' : '';
    return `<div class="bmatch ${m.completed ? 'done' : ''} ${playable ? 'playable' : ''} ${live ? 'live' : ''} ${m.isBye ? 'bye' : ''}" data-id="${m.id}" ${playable ? 'title="Load this battle"' : ''}>
      ${live ? '<span class="bm-live">LIVE</span>' : ''}
      ${row(m.p1, m.score1, m.roundsWon1, m.winnerId && m.winnerId === m.p1)}
      ${row(m.p2, m.score2, m.roundsWon2, m.winnerId && m.winnerId === m.p2)}
      ${note}
    </div>`;
  }

  escape(s) {
    return String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }
}

export {
  TournamentManager, standardSeedOrder, seedEntrants, createTournament, applyResult,
  resolveTournament, roundRobinTable, playableMatches, BYE
};
