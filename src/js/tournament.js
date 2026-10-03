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
      const ov = t.overrides?.[m.id] || {};
      const p1 = ov.p1 ?? pull(m.src1);
      const p2 = ov.p2 ?? pull(m.src2);
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

function buildFor(format, entrants, options = {}) {
  return format === 'double' ? buildDouble(entrants)
    : format === 'roundrobin' ? buildRoundRobin(entrants, !!options.rrFinal)
    : buildSingle(entrants);
}

function createTournament({ name, format, entrants, rrFinal = false }) {
  const built = buildFor(format, entrants, { rrFinal });
  const t = {
    id: `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name: name || 'Tournament',
    format: FORMAT_LABELS[format] ? format : 'single',
    createdAt: new Date().toISOString(),
    entrants,
    matches: built.matches,
    meta: built.meta,
    options: { rrFinal },
    overrides: {}, // matchId -> { p1?, p2? } manual placements from bracket edits
    results: [],   // played battles, in order — replayed whenever the bracket is edited
    currentMatchId: null,
    championId: null,
    status: 'active'
  };
  return resolveTournament(t);
}

/** Apply an official battle result to a match */
function applyResult(t, matchId, finalResult, { replay = false } = {}) {
  const m = t.matches.find(x => x.id === matchId);
  if (!m || m.completed || !finalResult) return false;
  if (!replay) {
    const ss = finalResult.seriesSummary || {};
    (t.results || (t.results = [])).push({
      p1: m.p1,
      p2: m.p2,
      result: {
        id: finalResult.id,
        contestant1: { id: finalResult.contestant1?.id },
        contestant2: { id: finalResult.contestant2?.id },
        winnerId: finalResult.winnerId || null,
        decisionMethod: finalResult.decisionMethod,
        seriesSummary: { avgRound1: ss.avgRound1, avgRound2: ss.avgRound2, roundsWon1: ss.roundsWon1, roundsWon2: ss.roundsWon2 },
        roundResults: finalResult.roundResults ? finalResult.roundResults.map(r => ({ total1: r.total1, total2: r.total2 })) : undefined
      }
    });
  }
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

/* ---------------- Bracket editing ---------------- */

const samePair = (m, a, b) => (m.p1 === a && m.p2 === b) || (m.p1 === b && m.p2 === a);
const hasResults = (t, id) => (t.results || []).some(r => r.p1 === id || r.p2 === id);

/**
 * Rebuild matches from the entrants and replay every played battle.
 * Fails (without touching `t`'s caller copy) if a played pairing no longer exists.
 */
function rebuildTournament(t) {
  const live = t.currentMatchId ? t.matches.find(m => m.id === t.currentMatchId) : null;
  const livePair = live ? [live.p1, live.p2] : null;
  const built = buildFor(t.format, t.entrants, t.options || {});
  // Manual placements are tied to match ids, which change if the bracket resizes
  if (t.format === 'roundrobin' || t.meta?.size !== built.meta.size) t.overrides = {};
  t.matches = built.matches;
  t.meta = built.meta;
  t.championId = null;
  resolveTournament(t);
  for (const r of t.results || []) {
    const m = playableMatches(t).find(x => samePair(x, r.p1, r.p2));
    if (!m) return { ok: false, code: 'played', players: [r.p1, r.p2] };
    applyResult(t, m.id, r.result, { replay: true });
  }
  t.currentMatchId = livePair ? (playableMatches(t).find(x => samePair(x, livePair[0], livePair[1]))?.id || null) : null;
  return { ok: true };
}

/** Run an edit on a copy; commit only if every played battle still fits */
function tryEdit(t, mutate) {
  const copy = JSON.parse(JSON.stringify(t));
  copy.overrides = copy.overrides || {};
  copy.results = copy.results || [];
  const pre = mutate(copy);
  if (pre && pre.ok === false) return pre;
  const res = rebuildTournament(copy);
  if (!res.ok) return res;
  Object.keys(t).forEach(k => delete t[k]);
  Object.assign(t, copy);
  return { ok: true };
}

function slotOf(t, slot) {
  const m = t.matches.find(x => x.id === slot.matchId);
  if (!m) return null;
  return { m, src: slot.side === 1 ? m.src1 : m.src2, player: slot.side === 1 ? m.p1 : m.p2 };
}

/** A slot can be edited until its battle is played (first-round bye slots stay editable) */
function slotEditable(t, slot) {
  const info = slotOf(t, slot);
  if (!info) return false;
  if (info.src.seed !== undefined) return !info.m.completed || info.m.isBye;
  return !info.m.completed;
}

/** Swap the producers in two slots (drag one name onto another) */
function editSwap(t, a, b) {
  if (a.matchId === b.matchId && a.side === b.side) return { ok: true };
  const A = slotOf(t, a);
  const B = slotOf(t, b);
  if (!A || !B) return { ok: false, code: 'missing' };
  if (!slotEditable(t, a) || !slotEditable(t, b)) return { ok: false, code: 'locked' };
  return tryEdit(t, (c) => {
    if (A.src.seed !== undefined && B.src.seed !== undefined && !c.overrides[a.matchId] && !c.overrides[b.matchId]) {
      // Both first-round seed slots: swap the seeds (an empty slot is a bye)
      const ea = c.entrants.find(e => e.seed === A.src.seed);
      const eb = c.entrants.find(e => e.seed === B.src.seed);
      if (ea) ea.seed = B.src.seed;
      if (eb) eb.seed = A.src.seed;
      return null;
    }
    const pa = A.player;
    const pb = B.player;
    if (!pa || !pb || pa === BYE || pb === BYE) return { ok: false, code: 'needs-players' };
    const key = (side) => (side === 1 ? 'p1' : 'p2');
    (c.overrides[a.matchId] || (c.overrides[a.matchId] = {}))[key(a.side)] = pb;
    (c.overrides[b.matchId] || (c.overrides[b.matchId] = {}))[key(b.side)] = pa;
    return null;
  });
}

/** Drop a bench producer into a first-round slot (fills a bye or substitutes the producer there) */
function editPlace(t, slot, producerId) {
  if (t.entrants.some(e => e.id === producerId)) return { ok: false, code: 'already-in' };
  const S = slotOf(t, slot);
  if (!S) return { ok: false, code: 'missing' };
  if (t.format === 'roundrobin') {
    if (!S.player || S.player === BYE) return { ok: false, code: 'missing' };
    return editSubstitute(t, S.player, producerId);
  }
  if (S.src.seed === undefined || !slotEditable(t, slot)) return { ok: false, code: 'first-round-only' };
  return tryEdit(t, (c) => {
    const occupant = c.entrants.find(e => e.seed === S.src.seed);
    if (occupant) {
      if (hasResults(c, occupant.id)) return { ok: false, code: 'has-results', players: [occupant.id] };
      occupant.id = producerId;
      occupant.rating = undefined;
    } else {
      c.entrants.push({ id: producerId, seed: S.src.seed });
    }
    return null;
  });
}

function editSubstitute(t, outId, inId) {
  return tryEdit(t, (c) => {
    if (hasResults(c, outId)) return { ok: false, code: 'has-results', players: [outId] };
    const e = c.entrants.find(x => x.id === outId);
    if (!e) return { ok: false, code: 'missing' };
    e.id = inId;
    return null;
  });
}

/** Add a producer to the tournament (takes the next seed; the bracket grows if needed) */
function editAdd(t, producerId) {
  if (t.entrants.some(e => e.id === producerId)) return { ok: false, code: 'already-in' };
  return tryEdit(t, (c) => {
    c.entrants.push({ id: producerId, seed: c.entrants.length + 1 });
    return null;
  });
}

/** Take a producer out (only before they've battled); remaining seeds close ranks */
function editRemove(t, producerId) {
  const min = t.format === 'double' ? 3 : 2;
  if (hasResults(t, producerId)) return { ok: false, code: 'has-results', players: [producerId] };
  if (t.entrants.length - 1 < min) return { ok: false, code: 'too-few' };
  return tryEdit(t, (c) => {
    c.entrants = c.entrants.filter(e => e.id !== producerId).sort((x, y) => x.seed - y.seed).map((e, i) => ({ ...e, seed: i + 1 }));
    Object.values(c.overrides).forEach(ov => {
      if (ov.p1 === producerId) delete ov.p1;
      if (ov.p2 === producerId) delete ov.p2;
    });
    return null;
  });
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
    this.onShowProfile = null; // (contestantId) — click a name/photo for their bio
    this.onChange = null;      // tournament created / edited / ended
    this.pendingMove = null;   // tap-to-move: slot or bench producer waiting for a target
    this.editMessage = null;
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
        <button type="button" class="seed-name chip-face" data-profile="${e.id}" title="See bio">${this.avatar(e.id)}<span>${this.escape(c?.name || e.id)}</span></button>
        <span class="seed-rating">${e.unrated ? '<em>unrated</em>' : e.rating}</span>
        <span class="seed-moves">
          <button type="button" data-move="-1" title="Move up" ${e.excluded ? 'disabled' : ''}>▲</button>
          <button type="button" data-move="1" title="Move down" ${e.excluded ? 'disabled' : ''}>▼</button>
          <label class="seed-in"><input type="checkbox" ${e.excluded ? '' : 'checked'} data-toggle /> In</label>
        </span>
      </li>`;
    }).join('');

    list.querySelectorAll('[data-profile]').forEach(btn => btn.addEventListener('click', () => this.onShowProfile?.(btn.dataset.profile)));
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
    this.onChange?.();
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
    this.onChange?.();
    return ok;
  }

  resetTournament() {
    this.t = null;
    this.pendingMove = null;
    this.saveState();
    this.onChange?.();
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

  /** Profile photo if the producer has one, otherwise coloured initials */
  avatar(id, size = 'sm') {
    const c = this.roster?.getById(id);
    if (!c) return `<span class="t-avatar ${size} empty">?</span>`;
    if (c.photo) return `<span class="t-avatar ${size}"><img src="${this.escape(c.photo)}" alt="" loading="lazy" /></span>`;
    const initials = c.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    let hash = 0;
    for (const ch of c.id) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
    return `<span class="t-avatar ${size}" style="--hue:${hash}">${this.escape(initials)}</span>`;
  }

  nameOf(id) {
    return this.roster?.getById(id)?.name || 'that producer';
  }

  /** Run a bracket edit and report the outcome in the bracket view */
  applyEdit(kind, ...args) {
    if (!this.t) return;
    const fn = { swap: editSwap, place: editPlace, add: editAdd, remove: editRemove }[kind];
    const res = fn(this.t, ...args);
    if (res.ok) {
      this.saveState();
      this.editMessage = { ok: true, text: 'Bracket updated.' };
      this.onChange?.();
    } else {
      const who = (res.players || []).map(id => this.nameOf(id));
      const min = this.t.format === 'double' ? 3 : 2;
      this.editMessage = {
        ok: false,
        text: {
          locked: "That battle has already been played — its slots are locked.",
          played: `Can't do that — ${who[0]} vs ${who[1]} has already battled, and that pairing would disappear.`,
          'has-results': `${who[0]} has already battled in this tournament, so they can't be swapped out.`,
          'first-round-only': 'Bench producers can only go into first-round slots.',
          'needs-players': 'Both slots need a producer to swap.',
          'too-few': `A ${FORMAT_LABELS[this.t.format].toLowerCase()} tournament needs at least ${min} producers.`,
          'already-in': 'That producer is already in the tournament.'
        }[res.code] || "That move isn't possible."
      };
    }
    this.pendingMove = null;
    this.renderBracket();
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

    const inIds = new Set(t.entrants.map(e => e.id));
    const bench = this.leagueContestants().filter(c => !inIds.has(c.id));
    const msg = this.editMessage;
    this.editMessage = null;

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
      ${champ ? `<div class="tourney-champ">${this.avatar(champ.id, 'md')} <span>👑 <b>${this.escape(champ.name)}</b> wins ${this.escape(t.name)}!</span></div>` : ''}
      <p class="tourney-edit-hint">Drag a name onto another slot to swap them · drag from the bench to fill a slot · drag a name to the bench to take them out · ⇄ to move by tapping · click a name for their bio. Played battles are locked.</p>
      ${msg ? `<div class="tourney-msg ${msg.ok ? 'ok' : 'err'}" role="status">${this.escape(msg.text)}</div>` : ''}
      ${this.pendingMove ? `<div class="tourney-msg pending">Moving <b>${this.escape(this.nameOf(this.pendingMove.id))}</b> — tap the slot to put them in (or tap ⇄ again to cancel).</div>` : ''}
      <div class="tourney-edit-layout">
        <div class="tourney-main">${body}</div>
        <aside class="tourney-bench" id="tourney-bench" aria-label="Bench">
          <h4>Bench</h4>
          <p class="bench-hint">League producers not in this tournament.</p>
          <div class="bench-list">
            ${bench.length ? bench.map(c => `
              <div class="bm-chip bench-chip ${this.pendingMove?.id === c.id ? 'moving' : ''}" draggable="true" data-bench="${c.id}">
                <button type="button" class="chip-face" data-profile="${c.id}">${this.avatar(c.id)}<span class="chip-name">${this.escape(c.name)}</span></button>
                <button type="button" class="chip-move" data-move-bench="${c.id}" title="Tap, then tap a slot">⇄</button>
              </div>`).join('') : '<p class="bench-empty">Everyone in the league is entered.</p>'}
          </div>
          <div class="bench-add" id="tourney-bench-add">Drop a bench producer here to <b>add them</b> (they take the next seed)</div>
        </aside>
      </div>`;

    container.querySelector('#btn-tourney-next')?.addEventListener('click', () => this.selectMatch(next.matchId));
    container.querySelector('#btn-tourney-end')?.addEventListener('click', () => {
      if (champ || confirm(`End "${t.name}"? The bracket will be cleared (battles already played stay in history).`)) this.resetTournament();
    });
    this.bindEditor(container);
  }

  bindEditor(container) {
    const readDrag = (ev) => {
      try { return JSON.parse(ev.dataTransfer.getData('application/json') || ev.dataTransfer.getData('text/plain')); } catch { return null; }
    };
    const setDrag = (ev, payload) => {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('application/json', JSON.stringify(payload));
      ev.dataTransfer.setData('text/plain', JSON.stringify(payload));
      container.classList.add('is-dragging');
    };
    container.addEventListener('dragend', () => {
      container.classList.remove('is-dragging');
      container.querySelectorAll('.drop-over').forEach(el => el.classList.remove('drop-over'));
    });

    // Bio on click (chips are buttons; dragging doesn't fire click)
    container.querySelectorAll('[data-profile]').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onShowProfile?.(btn.dataset.profile);
    }));

    // Slot chips: drag source + tap-to-move
    container.querySelectorAll('.bm-chip[data-slot-match]').forEach(chip => {
      const slot = { matchId: chip.dataset.slotMatch, side: Number(chip.dataset.slotSide) };
      chip.addEventListener('dragstart', (ev) => setDrag(ev, { kind: 'slot', ...slot, id: chip.dataset.player }));
      chip.querySelector('.chip-move')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pendingMove = this.pendingMove?.matchId === slot.matchId && this.pendingMove?.side === slot.side ? null : { kind: 'slot', ...slot, id: chip.dataset.player };
        this.renderBracket();
      });
    });
    container.querySelectorAll('.bench-chip').forEach(chip => {
      chip.addEventListener('dragstart', (ev) => setDrag(ev, { kind: 'bench', id: chip.dataset.bench }));
      chip.querySelector('.chip-move')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pendingMove = this.pendingMove?.id === chip.dataset.bench ? null : { kind: 'bench', id: chip.dataset.bench };
        this.renderBracket();
      });
    });

    const dropOnSlot = (payload, slot) => {
      if (!payload) return;
      if (payload.kind === 'slot') this.applyEdit('swap', { matchId: payload.matchId, side: payload.side }, slot);
      else if (payload.kind === 'bench') this.applyEdit('place', slot, payload.id);
    };

    // Slot rows: drop targets (drag) and tap targets (tap-to-move)
    container.querySelectorAll('.bm-player[data-drop-match]').forEach(row => {
      const slot = { matchId: row.dataset.dropMatch, side: Number(row.dataset.dropSide) };
      row.addEventListener('dragover', (ev) => { ev.preventDefault(); row.classList.add('drop-over'); });
      row.addEventListener('dragleave', () => row.classList.remove('drop-over'));
      row.addEventListener('drop', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        dropOnSlot(readDrag(ev), slot);
      });
      row.addEventListener('click', (e) => {
        if (!this.pendingMove) return;
        e.stopPropagation();
        dropOnSlot(this.pendingMove, slot);
      });
    });

    // Bench: drop a slot chip to take that producer out; drop a bench chip on "add" to enter them
    const benchEl = container.querySelector('#tourney-bench');
    benchEl?.addEventListener('dragover', (ev) => { ev.preventDefault(); benchEl.classList.add('drop-over'); });
    benchEl?.addEventListener('dragleave', (ev) => { if (!benchEl.contains(ev.relatedTarget)) benchEl.classList.remove('drop-over'); });
    benchEl?.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const payload = readDrag(ev);
      if (payload?.kind === 'slot' && payload.id) this.applyEdit('remove', payload.id);
      else benchEl.classList.remove('drop-over');
    });
    benchEl?.addEventListener('click', (e) => {
      if (this.pendingMove?.kind === 'slot' && !e.target.closest('.bench-chip')) this.applyEdit('remove', this.pendingMove.id);
    });
    const addEl = container.querySelector('#tourney-bench-add');
    addEl?.addEventListener('dragover', (ev) => { ev.preventDefault(); addEl.classList.add('drop-over'); });
    addEl?.addEventListener('dragleave', () => addEl.classList.remove('drop-over'));
    addEl?.addEventListener('drop', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const payload = readDrag(ev);
      if (payload?.kind === 'bench') this.applyEdit('add', payload.id);
    });
    addEl?.addEventListener('click', (e) => {
      if (this.pendingMove?.kind !== 'bench') return;
      e.stopPropagation();
      this.applyEdit('add', this.pendingMove.id);
    });

    // Playable card → load the battle (but not when the click was on a name or during a move)
    container.querySelectorAll('.bmatch.playable').forEach(el => el.addEventListener('click', (e) => {
      if (this.pendingMove || e.target.closest('.bm-chip')) return;
      this.selectMatch(el.dataset.id);
    }));
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
    const name = (id) => `<button type="button" class="chip-face rr-name" data-profile="${id}">${this.avatar(id)}<span>${this.escape(this.roster.getById(id)?.name || '—')}</span></button>`;
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
    const row = (side, id, score, rw, isWinner) => {
      const slot = { matchId: m.id, side };
      const editable = slotEditable(this.t, slot) && !(m.conditional);
      const isReal = id && id !== BYE;
      const moving = this.pendingMove?.kind === 'slot' && this.pendingMove.matchId === m.id && this.pendingMove.side === side;
      let label;
      if (id === BYE) label = '<span class="bm-bye">BYE</span>';
      else if (!id) label = '<span class="bm-tbd">TBD</span>';
      else {
        label = `<span class="bm-chip ${moving ? 'moving' : ''}" ${editable ? `draggable="true" data-slot-match="${m.id}" data-slot-side="${side}"` : ''} data-player="${id}">
          <button type="button" class="chip-face" data-profile="${id}" title="See ${this.escape(this.nameOf(id))}'s bio">
            <span class="bm-seed">${seedOf(id) ?? ''}</span>${this.avatar(id)}<span class="chip-name">${this.escape(this.roster.getById(id)?.name || '—')}</span>
          </button>
          ${editable ? '<button type="button" class="chip-move" title="Move (tap, then tap a slot)">⇄</button>' : ''}
        </span>`;
      }
      const sc = m.completed && !m.isBye && score !== undefined ? `${typeof rw === 'number' && (m.roundsWon1 + m.roundsWon2) > 1 ? `${rw}W · ` : ''}${Number(score).toFixed(2)}` : '';
      const dropAttrs = editable ? `data-drop-match="${m.id}" data-drop-side="${side}"` : '';
      return `<div class="bm-player ${isWinner ? 'won' : ''} ${m.completed && !isWinner && isReal ? 'out' : ''} ${editable ? 'editable' : ''}" ${dropAttrs}>
        <span class="bm-name">${label}</span><span class="bm-score">${sc}</span></div>`;
    };
    const playable = !m.completed && m.p1 && m.p2 && m.p1 !== BYE && m.p2 !== BYE;
    const live = this.t.currentMatchId === m.id;
    const locked = m.completed && !m.isBye;
    const note = m.advancedOnSeed ? '<span class="bm-note">drew · higher seed advances</span>'
      : m.decision === 'DRAW_TIEBREAK' ? '<span class="bm-note">drew · advanced on points</span>'
      : m.draw ? '<span class="bm-note">draw</span>' : '';
    return `<div class="bmatch ${m.completed ? 'done' : ''} ${playable ? 'playable' : ''} ${live ? 'live' : ''} ${m.isBye ? 'bye' : ''}" data-id="${m.id}" ${playable ? 'title="Click the card to load this battle"' : ''}>
      ${live ? '<span class="bm-live">LIVE</span>' : locked ? '<span class="bm-lock" title="Played — locked">🔒</span>' : playable ? '<span class="bm-play">▶</span>' : ''}
      ${row(1, m.p1, m.score1, m.roundsWon1, m.winnerId && m.winnerId === m.p1)}
      ${row(2, m.p2, m.score2, m.roundsWon2, m.winnerId && m.winnerId === m.p2)}
      ${note}
    </div>`;
  }

  escape(s) {
    return String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }
}

export {
  TournamentManager, standardSeedOrder, seedEntrants, createTournament, applyResult,
  resolveTournament, roundRobinTable, playableMatches, BYE,
  rebuildTournament, editSwap, editPlace, editAdd, editRemove, slotEditable
};
