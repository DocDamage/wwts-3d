/**
 * Judge consistency: how each judge scores compared with the rest of the panel,
 * from every finished panel battle in the history.
 *
 *  - Deviation    average distance from the other judges' median score (points / 100)
 *  - Lean         harsher (−) or kinder (+) than the panel on average
 *  - Agreement    how often their pick matched the panel's round winner
 *  - Slot pick    how often they picked whoever was in slot 1 (≈50% is neutral)
 *  - Favourites   producers they consistently score above / below the panel
 */

function judgeStats(battles, { leagueId = null } = {}) {
  const judges = {};
  battles.filter(b => !b.isDemo && (!leagueId || b.leagueId === leagueId)).forEach(b => {
    (b.roundResults || []).forEach(rr => {
      const panel = rr.panel?.judges?.filter(j => j.scored);
      if (!panel || panel.length < 2) return;
      const median = (xs) => { const a = [...xs].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
      const panelWinner = rr.panel.winner ?? rr.winner;
      panel.forEach(j => {
        // compare with the median of the rest of the panel, so one wild card doesn't drag everyone
        const others = panel.filter(x => x !== j);
        const mean1 = median(others.map(x => x.total1));
        const mean2 = median(others.map(x => x.total2));
        const row = (judges[j.name] = judges[j.name] || { name: j.name, rounds: 0, dev: 0, lean: 0, agree: 0, decided: 0, slot1: 0, picks: 0, fav: {} });
        row.rounds++;
        row.dev += (Math.abs(j.total1 - mean1) + Math.abs(j.total2 - mean2)) / 2;
        row.lean += ((j.total1 - mean1) + (j.total2 - mean2)) / 2;
        if (panelWinner === 1 || panelWinner === 2) {
          row.decided++;
          if (j.winner === panelWinner) row.agree++;
        }
        if (j.winner === 1 || j.winner === 2) {
          row.picks++;
          if (j.winner === 1) row.slot1++;
        }
        [[b.contestant1Id, b.contestant1Name, j.total1 - mean1], [b.contestant2Id, b.contestant2Name, j.total2 - mean2]].forEach(([id, name, d]) => {
          const f = (row.fav[id] = row.fav[id] || { name, sum: 0, n: 0 });
          f.sum += d;
          f.n++;
        });
      });
    });
  });
  // flags are relative to how much this panel usually differs
  const devs = Object.values(judges).map(r => r.dev / r.rounds).sort((x, y) => x - y);
  const typical = devs.length ? devs[devs.length >> 1] : 0;
  return Object.values(judges).map(r => {
    const favs = Object.values(r.fav).filter(f => f.n >= 2).map(f => ({ name: f.name, avg: f.sum / f.n })).sort((a, b) => b.avg - a.avg);
    const dev = r.dev / r.rounds;
    return {
      name: r.name,
      rounds: r.rounds,
      deviation: dev,
      lean: r.lean / r.rounds,
      agreement: r.decided ? r.agree / r.decided : null,
      slot1: r.picks ? r.slot1 / r.picks : null,
      likes: favs.filter(f => f.avg > 1.5).slice(0, 2),
      dislikes: favs.filter(f => f.avg < -1.5).slice(-2).reverse(),
      flag: r.rounds < 3 ? 'few' : dev > Math.max(6, typical * 2.2) ? 'outlier' : dev > Math.max(3.5, typical * 1.5) ? 'watch' : 'steady'
    };
  }).sort((a, b) => b.rounds - a.rounds);
}

class JudgeStatsPanel {
  constructor({ history, leagues }) {
    this.history = history;
    this.leagues = leagues;
  }

  init() {
    this.modal = document.getElementById('judge-stats-modal');
    if (!this.modal) return;
    this.modal.addEventListener('tool-open', () => this.render());
    document.getElementById('judge-stats-scope')?.addEventListener('change', () => this.render());
  }

  render() {
    const scope = document.getElementById('judge-stats-scope')?.value || 'league';
    const leagueId = scope === 'league' ? this.leagues.activeLeagueId : null;
    const rows = judgeStats(this.history.history, { leagueId });
    const body = document.getElementById('judge-stats-body');
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<p class="profile-muted">No panel battles yet. Stats appear once two or more judges have scored rounds.</p>';
      return;
    }
    const pct = (v) => (v === null ? '—' : `${Math.round(v * 100)}%`);
    const flagText = { steady: 'Steady', watch: 'Worth a look', outlier: 'Outlier', few: 'Too few rounds' };
    body.innerHTML = `<table class="profile-table judge-stats-table">
      <thead><tr><th>Judge</th><th>Rounds</th><th title="Average distance from the panel's mean score">Deviation</th><th title="Harsher (−) or kinder (+) than the panel">Lean</th><th title="Picked the same round winner as the panel">Agreement</th><th title="How often they picked slot 1 (≈50% is neutral)">Slot 1</th><th>Scores high / low</th><th>Status</th></tr></thead>
      <tbody>${rows.map(r => `<tr class="js-${r.flag}">
        <td><b>${this.esc(r.name)}</b></td><td>${r.rounds}</td><td>${r.deviation.toFixed(1)}</td>
        <td>${r.lean >= 0 ? '+' : ''}${r.lean.toFixed(1)}</td><td>${pct(r.agreement)}</td>
        <td class="${r.slot1 !== null && Math.abs(r.slot1 - 0.5) > 0.2 && r.rounds >= 5 ? 'js-bias' : ''}">${pct(r.slot1)}</td>
        <td>${r.likes.map(f => `<span class="js-like">▲ ${this.esc(f.name)}</span>`).join(' ')} ${r.dislikes.map(f => `<span class="js-dislike">▼ ${this.esc(f.name)}</span>`).join(' ')}</td>
        <td><span class="js-flag ${r.flag}">${flagText[r.flag]}</span></td></tr>`).join('')}</tbody></table>
      <p class="profile-muted">Deviation and lean are in points out of 100 per round. "Scores high / low" lists producers a judge has scored at least 1.5 points above or below the panel across two or more rounds.</p>`;
  }

  esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
}

export { judgeStats, JudgeStatsPanel };
