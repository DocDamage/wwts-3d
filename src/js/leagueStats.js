/**
 * League stats dashboard (📊 next to the standings): head-to-head records,
 * category strengths per producer (radar), streaks, biggest upsets, and how
 * each judge scores each producer compared with the rest of the panel.
 * Everything is computed from the battle history (per season or all-time).
 */

/** All the numbers, from history entries of one league (and optionally one season) */
function computeLeagueStats(battles, { leagueId, seasonId = null, includeUntagged = false } = {}) {
  const list = battles
    .filter(b => !b.isDemo && b.leagueId === leagueId && (!seasonId || b.seasonId === seasonId || (includeUntagged && !b.seasonId)))
    .slice()
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const names = {};
  const h2h = {};          // "a|b" (a<b) -> { a, b, winsA, winsB, draws }
  const cat = {};          // id -> { name -> { sum, n } }
  const form = {};         // id -> ['W','L','D',…]
  const upsets = [];
  const judgeDev = {};     // judge -> id -> { sum, n }

  const addCat = (id, catNames, scores) => {
    if (!Array.isArray(scores)) return;
    cat[id] = cat[id] || {};
    catNames.forEach((nm, i) => {
      const v = scores[i];
      if (typeof v !== 'number' || !nm) return;
      const c = (cat[id][nm] = cat[id][nm] || { sum: 0, n: 0 });
      c.sum += v;
      c.n++;
    });
  };

  list.forEach(b => {
    if (b.kind === 'cypher') {
      (b.placings || []).forEach((p, i) => { names[p.id] = p.name; (form[p.id] = form[p.id] || []).push(i === 0 ? 'W' : 'L'); });
      return;
    }
    const A = b.contestant1Id;
    const B = b.contestant2Id;
    names[A] = b.contestant1Name;
    names[B] = b.contestant2Name;
    const [x, y] = A < B ? [A, B] : [B, A];
    const key = `${x}|${y}`;
    const rec = (h2h[key] = h2h[key] || { a: x, b: y, winsA: 0, winsB: 0, draws: 0 });
    const winner = b.winnerId;
    if (!winner) rec.draws++;
    else if (winner === x) rec.winsA++;
    else rec.winsB++;
    (form[A] = form[A] || []).push(winner === A ? 'W' : winner ? 'L' : 'D');
    (form[B] = form[B] || []).push(winner === B ? 'W' : winner ? 'L' : 'D');

    const catNames = (b.scoringRules?.categories || []).map(c => c.name || c);
    (b.roundResults || []).forEach(r => {
      addCat(A, catNames, r.scores1);
      addCat(B, catNames, r.scores2);
      // judge vs panel, per producer
      const js = (r.panel?.judges || []).filter(j => j.scored);
      if (js.length >= 2) {
        js.forEach(j => {
          const others = js.filter(o => o !== j);
          const m1 = others.reduce((s, o) => s + o.total1, 0) / others.length;
          const m2 = others.reduce((s, o) => s + o.total2, 0) / others.length;
          const jd = (judgeDev[j.name] = judgeDev[j.name] || {});
          (jd[A] = jd[A] || { sum: 0, n: 0 }).sum += j.total1 - m1; jd[A].n++;
          (jd[B] = jd[B] || { sum: 0, n: 0 }).sum += j.total2 - m2; jd[B].n++;
        });
      }
    });

    // upsets: the lower-rated producer won
    const rc = b.ratingChanges;
    if (winner && rc && rc[A] && rc[B]) {
      const loser = winner === A ? B : A;
      const gap = rc[loser].before - rc[winner].before;
      if (gap > 0) upsets.push({ winner: names[winner], loser: names[loser], gap, date: b.timestamp, score: `${Number(b.total1).toFixed(1)}–${Number(b.total2).toFixed(1)}` });
    }
  });

  const streaks = Object.entries(form).map(([id, f]) => {
    let best = 0;
    let run = 0;
    f.forEach(r => { run = r === 'W' ? run + 1 : 0; best = Math.max(best, run); });
    let cur = 0;
    for (let i = f.length - 1; i >= 0; i--) {
      if (f[i] === 'D') break;
      if (cur === 0) cur = f[i] === 'W' ? 1 : -1;
      else if ((cur > 0) === (f[i] === 'W')) cur += cur > 0 ? 1 : -1;
      else break;
    }
    return { id, name: names[id], current: cur, best, form: f.slice(-8) };
  }).sort((a, b) => b.current - a.current || b.best - a.best);

  const strengths = Object.fromEntries(Object.entries(cat).map(([id, c]) => [id, Object.fromEntries(Object.entries(c).map(([nm, v]) => [nm, Number((v.sum / v.n).toFixed(2))]))]));

  const judges = Object.entries(judgeDev).map(([judge, per]) => ({
    judge,
    producers: Object.entries(per).filter(([, v]) => v.n >= 1).map(([id, v]) => ({ id, name: names[id], lean: Number((v.sum / v.n).toFixed(2)), rounds: v.n })).sort((a, b) => b.lean - a.lean)
  }));

  return {
    battles: list.length,
    names,
    h2h: Object.values(h2h),
    strengths,
    streaks,
    upsets: upsets.sort((a, b) => b.gap - a.gap).slice(0, 8),
    judges
  };
}

/** Small SVG radar of a producer's category averages (0–10) */
function radarSvg(values, labels, color = '#ff2d2d', size = 220) {
  const n = labels.length;
  if (n < 3) return '';
  const c = size / 2;
  const R = c - 34;
  const pt = (i, v) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [c + Math.cos(a) * R * (v / 10), c + Math.sin(a) * R * (v / 10)];
  };
  const rings = [2.5, 5, 7.5, 10].map(v => `<polygon points="${labels.map((_, i) => pt(i, v).join(',')).join(' ')}" fill="none" stroke="currentColor" stroke-opacity="0.12"/>`).join('');
  const poly = labels.map((_, i) => pt(i, values[i] || 0).join(',')).join(' ');
  const text = labels.map((l, i) => {
    const [x, y] = pt(i, 12.2);
    return `<text x="${x}" y="${y}" font-size="9" text-anchor="middle" dominant-baseline="middle" fill="currentColor" fill-opacity="0.7">${esc(l.slice(0, 10))}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Category strengths">${rings}<polygon points="${poly}" fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="2"/>${text}</svg>`;
}

class LeagueStatsPanel {
  constructor({ history, leagues, roster, seasonsPanel }) {
    Object.assign(this, { history, leagues, roster, seasonsPanel });
    this.tab = 'h2h';
  }

  init() {
    this.modal = document.getElementById('stats-modal');
    if (!this.modal) return;
    document.getElementById('btn-league-stats')?.addEventListener('click', () => this.open());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal || e.target.closest('[data-close="stats-modal"]')) this.modal.style.display = 'none';
      const t = e.target.closest('[data-stab]');
      if (t) { this.tab = t.dataset.stab; this.render(); }
    });
    this.modal.addEventListener('change', (e) => { if (e.target.id === 'stats-producer' || e.target.id === 'stats-scope') this.render(); });
  }

  open() {
    this.render();
    this.modal.style.display = '';
  }

  stats() {
    const scope = document.getElementById('stats-scope')?.value || 'season';
    const seasonId = scope === 'season' ? this.seasonsPanel?.seasons.current()?.id || null : null;
    const first = this.seasonsPanel?.seasons.list()[0];
    return computeLeagueStats(this.history.history, { leagueId: this.leagues.activeLeagueId, seasonId, includeUntagged: !!seasonId && first?.id === seasonId });
  }

  render() {
    const s = this.stats();
    this.modal.querySelectorAll('[data-stab]').forEach(b => b.classList.toggle('active', b.dataset.stab === this.tab));
    const body = document.getElementById('stats-body');
    if (!s.battles) { body.innerHTML = '<p class="empty-state">No battles to analyse yet.</p>'; return; }
    const ids = Object.keys(s.names).sort((a, b) => (s.names[a] || '').localeCompare(s.names[b] || ''));
    if (this.tab === 'h2h') {
      const rec = (a, b) => {
        const [x, y] = a < b ? [a, b] : [b, a];
        const r = s.h2h.find(h => h.a === x && h.b === y);
        if (!r) return '';
        const w = a === x ? r.winsA : r.winsB;
        const l = a === x ? r.winsB : r.winsA;
        return `<span class="${w > l ? 'h-up' : w < l ? 'h-down' : ''}">${w}-${l}${r.draws ? `-${r.draws}` : ''}</span>`;
      };
      body.innerHTML = `<div class="standings-table"><table class="h2h-table"><thead><tr><th></th>${ids.map(id => `<th title="${esc(s.names[id])}">${esc((s.names[id] || '').slice(0, 8))}</th>`).join('')}</tr></thead>
        <tbody>${ids.map(a => `<tr><th>${esc(s.names[a])}</th>${ids.map(b => `<td>${a === b ? '—' : rec(a, b)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="st-note">Row producer's record against the column producer (W-L-D).</p>`;
    } else if (this.tab === 'strengths') {
      const sel = document.getElementById('stats-producer');
      const keep = sel?.value;
      const withData = ids.filter(id => s.strengths[id]);
      body.innerHTML = `<label>Producer <select id="stats-producer" class="form-input">${withData.map(id => `<option value="${id}">${esc(s.names[id])}</option>`).join('')}</select></label><div id="stats-radar" class="stats-radar"></div>`;
      const pick = body.querySelector('#stats-producer');
      if (keep && withData.includes(keep)) pick.value = keep;
      const drawRadar = () => {
        const st = s.strengths[pick.value] || {};
        const labels = Object.keys(st);
        const color = this.roster.getById(pick.value)?.color || '#ff2d2d';
        const best = Object.entries(st).sort((a, b) => b[1] - a[1]);
        body.querySelector('#stats-radar').innerHTML = labels.length >= 3
          ? `${radarSvg(labels.map(l => st[l]), labels, color)}<ul class="stats-cats">${best.map(([nm, v]) => `<li><span>${esc(nm)}</span><b>${v.toFixed(2)}</b></li>`).join('')}</ul>`
          : '<p class="profile-muted">Not enough category scores yet.</p>';
      };
      pick.addEventListener('change', drawRadar);
      drawRadar();
    } else if (this.tab === 'streaks') {
      body.innerHTML = `<div class="standings-table"><table><thead><tr><th>Producer</th><th>Current</th><th>Best win streak</th><th>Last results</th></tr></thead><tbody>
        ${s.streaks.map(r => `<tr><td>${esc(r.name)}</td><td class="${r.current > 0 ? 'st-hot' : r.current < 0 ? 'st-cold' : ''}">${r.current > 0 ? `W${r.current}` : r.current < 0 ? `L${-r.current}` : '—'}</td><td>${r.best}</td><td class="st-form">${r.form.map(f => `<i class="f-${f}">${f}</i>`).join('')}</td></tr>`).join('')}</tbody></table></div>`;
    } else if (this.tab === 'upsets') {
      body.innerHTML = s.upsets.length ? `<ol class="stats-upsets">${s.upsets.map(u => `<li><b>${esc(u.winner)}</b> beat <b>${esc(u.loser)}</b> <span>${u.score}</span> <small>rated ${u.gap} below · ${new Date(u.date).toLocaleDateString()}</small></li>`).join('')}</ol>` : '<p class="profile-muted">No upsets yet — the favourites keep winning.</p>';
    } else if (this.tab === 'judges') {
      body.innerHTML = s.judges.length ? s.judges.map(j => `<div class="stats-judge"><h4>${esc(j.judge)}</h4><ul>${j.producers.map(p => `<li><span>${esc(p.name)}</span><b class="${p.lean > 1.5 ? 'h-up' : p.lean < -1.5 ? 'h-down' : ''}">${p.lean >= 0 ? '+' : ''}${p.lean.toFixed(2)}</b><small>${p.rounds} round${p.rounds === 1 ? '' : 's'}</small></li>`).join('')}</ul></div>`).join('')
        + '<p class="st-note">How far each judge scores a producer above (+) or below (−) the rest of the panel, per round.</p>'
        : '<p class="profile-muted">Needs panel battles (2+ judges) in the history.</p>';
    }
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export { computeLeagueStats, radarSvg, LeagueStatsPanel };
