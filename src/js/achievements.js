/**
 * Achievements & Hall of Fame
 *
 * Badges are derived from official battle history (demo battles never count),
 * so they always agree with the record. Tiered badges (bronze → silver → gold)
 * show progress toward the next tier. Tournament titles are stored separately.
 * After each battle, unlocks are diffed before/after so the stage can celebrate.
 */

const TITLES_KEY = 'wwts_titles_v1';

const TIER_NAMES = ['Bronze', 'Silver', 'Gold', 'Platinum'];

/* ---------- helpers over one producer's battles ---------- */

const side = (b, id) => (b.contestant1Id === id ? 1 : b.contestant2Id === id ? 2 : 0);
const won = (b, id) => b.winnerId === id;
const lost = (b, id) => b.winnerId && b.winnerId !== id;
const roundsOf = (b) => b.roundResults || [];
const roundWinner = (r) => (r.panel?.winner ?? r.winner);
const myRoundScores = (r, s) => (s === 1 ? r.scores1 : r.scores2) || [];
const myRoundTotal = (r, s) => (s === 1 ? r.total1 : r.total2) || 0;
const oppId = (b, id) => (side(b, id) === 1 ? b.contestant2Id : b.contestant1Id);

function streaks(battles, id) {
  let cur = 0;
  let best = 0;
  battles.forEach(b => {
    if (won(b, id)) cur++;
    else cur = 0;
    best = Math.max(best, cur);
  });
  return { cur, best };
}

/**
 * Each badge: value(battles, id, ctx) → number of progress; tiers = thresholds.
 * A single-threshold badge uses tiers: [1].
 */
const BADGES = [
  // --- Career ---
  { id: 'debut', icon: '🎤', name: 'Debut', desc: 'Step into the arena for a first battle', group: 'Career', tiers: [1],
    value: (bs, id, ctx) => bs.length + ctx.seedBattles },
  { id: 'battles', icon: '🎖️', name: 'Battle Tested', desc: 'Battles fought', group: 'Career', tiers: [5, 10, 25, 50],
    tierNames: ['Rookie', 'Veteran', 'War Machine', 'Legend'], value: (bs, id, ctx) => bs.length + ctx.seedBattles },
  { id: 'first_win', icon: '⚔️', name: 'First Blood', desc: 'Win a battle', group: 'Career', tiers: [1],
    value: (bs, id, ctx) => bs.filter(b => won(b, id)).length + ctx.seedWins },
  { id: 'wins', icon: '🏆', name: 'Winner', desc: 'Battles won', group: 'Career', tiers: [5, 10, 25, 50],
    tierNames: ['Contender', 'Headliner', 'Dynasty', 'Immortal'], value: (bs, id, ctx) => bs.filter(b => won(b, id)).length + ctx.seedWins },
  { id: 'rating', icon: '📈', name: 'Rated', desc: 'Peak rating', group: 'Career', tiers: [1550, 1600, 1700, 1800],
    tierNames: ['Rising', 'Elite', 'Legendary', 'GOAT'], unit: '', value: (bs, id, ctx) => ctx.peakRating || 1500 },

  // --- Streaks ---
  { id: 'streak', icon: '🔥', name: 'Win Streak', desc: 'Wins in a row', group: 'Streaks', tiers: [3, 5, 10],
    tierNames: ['Heating Up', 'On Fire', 'Untouchable'], value: (bs, id, ctx) => Math.max(streaks(bs, id).best, ctx.bestStreak) },

  // --- Performance ---
  { id: 'perfect10', icon: '💯', name: 'Perfect 10', desc: 'Score a perfect 10 in any category', group: 'Performance', tiers: [1, 5, 15],
    value: (bs, id) => bs.reduce((n, b) => n + roundsOf(b).reduce((m, r) => m + myRoundScores(r, side(b, id)).filter(v => v >= 9.95).length, 0), 0) },
  { id: 'flawless', icon: '💎', name: 'Flawless Round', desc: 'Score 95+ in a round', group: 'Performance', tiers: [1, 3, 10],
    value: (bs, id) => bs.reduce((n, b) => n + roundsOf(b).filter(r => myRoundTotal(r, side(b, id)) >= 95).length, 0) },
  { id: 'golden_ears', icon: '🎧', name: 'Golden Ears', desc: 'Win a round with every category at 8+', group: 'Performance', tiers: [1, 5],
    value: (bs, id) => bs.reduce((n, b) => {
      const s = side(b, id);
      return n + roundsOf(b).filter(r => roundWinner(r) === s && myRoundScores(r, s).length && myRoundScores(r, s).every(v => v >= 8)).length;
    }, 0) },
  { id: 'blowout', icon: '💥', name: 'Blowout', desc: 'Win a round by 15+ points', group: 'Performance', tiers: [1, 5],
    value: (bs, id) => bs.reduce((n, b) => {
      const s = side(b, id);
      return n + roundsOf(b).filter(r => roundWinner(r) === s && myRoundTotal(r, s) - myRoundTotal(r, 3 - s) >= 15).length;
    }, 0) },
  { id: 'photo_finish', icon: '📸', name: 'Photo Finish', desc: 'Win a battle by less than half a point', group: 'Performance', tiers: [1],
    value: (bs, id) => bs.filter(b => won(b, id) && Math.abs((b.total1 || 0) - (b.total2 || 0)) < 0.5).length },

  // --- Battle craft ---
  { id: 'clean_sweep', icon: '🧹', name: 'Clean Sweep', desc: 'Win a best-of-3 two rounds to none', group: 'Battle', tiers: [1, 5],
    value: (bs, id) => bs.filter(b => {
      const s = side(b, id);
      const ss = b.seriesSummary || {};
      return won(b, id) && (ss.roundsPlayed || roundsOf(b).length) >= 2 && (s === 1 ? ss.roundsWon2 : ss.roundsWon1) === 0;
    }).length },
  { id: 'unanimous', icon: '🤝', name: 'No Doubt', desc: 'Win a unanimous panel decision', group: 'Battle', tiers: [1, 5],
    value: (bs, id) => bs.filter(b => won(b, id) && (b.decisionMethod === 'UNANIMOUS' || roundsOf(b).some(r => r.panel?.decisionType === 'UNANIMOUS' && r.panel.winner === side(b, id)))).length },
  { id: 'comeback', icon: '🔄', name: 'Comeback Kid', desc: 'Lose round 1 and still win the battle', group: 'Battle', tiers: [1, 3],
    value: (bs, id) => bs.filter(b => {
      const r1 = roundsOf(b).find(r => r.round === 1);
      return won(b, id) && r1 && roundWinner(r1) === 3 - side(b, id);
    }).length },
  { id: 'overtime', icon: '⚡', name: 'Overtime Hero', desc: 'Win in sudden death', group: 'Battle', tiers: [1, 3],
    value: (bs, id) => bs.filter(b => won(b, id) && (b.decisionMethod === 'SUDDEN_DEATH' || b.seriesSummary?.hasOvertime)).length },
  { id: 'giant_slayer', icon: '🗡️', name: 'Giant Slayer', desc: 'Beat a producer rated 100+ higher', group: 'Battle', tiers: [1, 3],
    value: (bs, id) => bs.filter(b => {
      const rc = b.ratingChanges;
      const me = rc?.[id];
      const them = rc?.[oppId(b, id)];
      return won(b, id) && me && them && them.before - me.before >= 100;
    }).length },
  { id: 'nemesis', icon: '😈', name: 'Nemesis', desc: 'Beat the same producer 3 times', group: 'Battle', tiers: [1],
    value: (bs, id) => {
      const counts = {};
      bs.filter(b => won(b, id)).forEach(b => { counts[oppId(b, id)] = (counts[oppId(b, id)] || 0) + 1; });
      return Object.values(counts).some(n => n >= 3) ? 1 : 0;
    } },
  { id: 'rivalry', icon: '🥊', name: 'Rivalry', desc: 'Battle the same producer 5 times', group: 'Battle', tiers: [1],
    value: (bs, id) => {
      const counts = {};
      bs.forEach(b => { counts[oppId(b, id)] = (counts[oppId(b, id)] || 0) + 1; });
      return Object.values(counts).some(n => n >= 5) ? 1 : 0;
    } },

  // --- Crowd ---
  { id: 'fire_notes', icon: '🌶️', name: 'Judges Love It', desc: '🔥-tagged public notes from the judges', group: 'Crowd', tiers: [3, 10, 25],
    value: (bs, id) => bs.reduce((n, b) => n + (b.timestampedNotes || []).filter(nt => nt.visibility === 'public' && (nt.tags || []).includes('fire') && nt.contestant === side(b, id)).length, 0) },

  // --- Titles ---
  { id: 'champion', icon: '👑', name: 'Champion', desc: 'Tournament titles won', group: 'Titles', tiers: [1, 3, 5],
    tierNames: ['Champion', 'Multi-Champ', 'Dynasty'], value: (bs, id, ctx) => (ctx.titles || []).length }
];

const BADGES_BY_ID = Object.fromEntries(BADGES.map(b => [b.id, b]));

class AchievementEngine {
  constructor(history, roster) {
    this.history = history;
    this.roster = roster;
    this.titles = this.loadTitles();
  }

  loadTitles() {
    try {
      return JSON.parse(localStorage.getItem(TITLES_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  saveTitles() {
    try { localStorage.setItem(TITLES_KEY, JSON.stringify(this.titles)); } catch { /* storage blocked */ }
  }

  /** Record a tournament title (idempotent per tournament id) */
  addTitle(contestantId, { tournamentId, name }) {
    const list = this.titles[contestantId] || (this.titles[contestantId] = []);
    if (tournamentId && list.some(t => t.tournamentId === tournamentId)) return false;
    list.push({ tournamentId, name: name || 'Tournament Champion', date: new Date().toISOString() });
    this.saveTitles();
    return true;
  }

  /** Official battles for a producer, oldest first */
  battlesFor(id, battles = null) {
    const all = battles || this.history.history;
    return all.filter(b => !b.isDemo && side(b, id)).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  /**
   * Career numbers carried in from before the app kept history (e.g. the sample
   * producers' records) — the part of the record history can't explain.
   */
  carriedIn(id) {
    const st = this.roster?.getById(id)?.stats || {};
    const bs = this.battlesFor(id);
    const histWins = bs.filter(b => won(b, id)).length;
    return {
      seedBattles: Math.max(0, (st.totalBattles || 0) - bs.length),
      seedWins: Math.max(0, (st.wins || 0) - histWins),
      // The roster tracks the best streak across carried-in and recorded battles
      bestStreak: st.bestStreak || 0
    };
  }

  /** Every badge for a producer with tier reached and progress to the next */
  evaluate(id, battles = null, ctxOverride = null) {
    const bs = this.battlesFor(id, battles);
    const c = this.roster?.getById(id);
    const ctx = {
      ...this.carriedIn(id),
      peakRating: c?.stats?.peakRating || c?.stats?.rating || 1500,
      titles: this.titles[id] || [],
      ...(ctxOverride || {})
    };
    return BADGES.map(def => {
      const value = def.value(bs, id, ctx);
      let tier = 0;
      def.tiers.forEach((t, i) => { if (value >= t) tier = i + 1; });
      const next = def.tiers[tier] ?? null;
      const prev = tier ? def.tiers[tier - 1] : (def.id === 'rating' ? 1500 : 0);
      return {
        ...def,
        value,
        tier,
        maxTier: def.tiers.length,
        unlocked: tier > 0,
        next,
        progress: next === null ? 1 : Math.max(0, Math.min(1, (value - prev) / (next - prev))),
        tierLabel: tier ? (def.tierNames?.[tier - 1] || (def.tiers.length > 1 ? TIER_NAMES[tier - 1] : '')) : ''
      };
    });
  }

  /** Badges/tiers a producer gained in their most recent battle */
  newlyUnlocked(id) {
    const bs = this.battlesFor(id);
    if (!bs.length) return [];
    const last = bs[bs.length - 1];
    const c = this.roster?.getById(id);
    const peakAfter = c?.stats?.peakRating || c?.stats?.rating || 1500;
    const peakBefore = last.ratingChanges?.[id]?.peakBefore ?? peakAfter;
    const st = c?.stats || {};
    // If this battle extended the record streak, the record before it was one shorter
    const streakBefore = won(last, id) && st.streak === st.bestStreak ? Math.max(0, (st.bestStreak || 0) - 1) : (st.bestStreak || 0);
    const before = this.evaluate(id, bs.slice(0, -1), { peakRating: peakBefore, bestStreak: streakBefore });
    const after = this.evaluate(id, bs);
    return after.filter((a, i) => a.tier > before[i].tier);
  }

  earnedCount(id) {
    return this.evaluate(id).reduce((n, b) => n + b.tier, 0);
  }

  /** League records for the Hall of Fame */
  records(leagueId) {
    const battles = this.history.getForLeague(leagueId).filter(b => !b.isDemo);
    const contestants = this.roster.getForLeague(leagueId);
    const name = (id) => this.roster.getById(id)?.name || '—';
    const best = (rows) => rows.sort((a, b) => b.v - a.v)[0];
    const out = [];

    const roundRows = [];
    battles.forEach(b => roundsOf(b).forEach(r => {
      roundRows.push({ v: r.total1 || 0, who: b.contestant1Id, when: b.timestamp });
      roundRows.push({ v: r.total2 || 0, who: b.contestant2Id, when: b.timestamp });
    }));
    const hi = best(roundRows);
    if (hi && hi.v > 0) out.push({ icon: '🎯', label: 'Highest Round Score', value: hi.v.toFixed(2), holder: name(hi.who) });

    const margins = battles.filter(b => b.winnerId).map(b => ({ v: Math.abs((b.total1 || 0) - (b.total2 || 0)), who: b.winnerId }));
    const big = best(margins);
    if (big) out.push({ icon: '💥', label: 'Biggest Win', value: `+${big.v.toFixed(2)}`, holder: name(big.who) });

    const streakRows = contestants.map(c => ({ v: Math.max(streaks(this.battlesFor(c.id, battles), c.id).best, c.stats?.bestStreak || 0), who: c.id }));
    const st = best(streakRows);
    if (st && st.v > 0) out.push({ icon: '🔥', label: 'Longest Win Streak', value: `${st.v}`, holder: name(st.who) });

    const winRows = contestants.map(c => ({ v: c.stats?.wins || 0, who: c.id }));
    const w = best(winRows);
    if (w && w.v > 0) out.push({ icon: '🏆', label: 'Most Wins', value: `${w.v}`, holder: name(w.who) });

    const ratingRows = contestants.map(c => ({ v: c.stats?.peakRating || c.stats?.rating || 1500, who: c.id }));
    const r = best(ratingRows);
    if (r) out.push({ icon: '📈', label: 'Peak Rating', value: `${r.v}`, holder: name(r.who) });

    const badgeRows = contestants.map(c => ({ v: this.earnedCount(c.id), who: c.id }));
    const bd = best(badgeRows);
    if (bd && bd.v > 0) out.push({ icon: '🎖️', label: 'Most Decorated', value: `${bd.v} badges`, holder: name(bd.who) });

    const titleRows = contestants.map(c => ({ v: (this.titles[c.id] || []).length, who: c.id }));
    const tt = best(titleRows);
    if (tt && tt.v > 0) out.push({ icon: '👑', label: 'Most Titles', value: `${tt.v}`, holder: name(tt.who) });

    return out;
  }
}

export { AchievementEngine, BADGES, BADGES_BY_ID };
