/**
 * Public league page: standings, recent results and what's coming up, as one
 * self-contained HTML page. Used two ways:
 *  - "Download page": a single .html file to upload anywhere (no app needed)
 *  - live on the venue Wi-Fi at http://<host>:<port>/league (server/publicLeague.js),
 *    refreshing itself from /api/public/data
 * Pure string building (no DOM) so the server can render it too.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Gather what the page shows. Everything is plain data:
 *   league {name, description, color}, season {name}|null, standings rows,
 *   battles (history entries), queue (run of show items), names: id -> name
 */
function buildPublicData({ league, season = null, standings = [], battles = [], queue = [], nextUp = null, maxResults = 30 }) {
  return {
    league: { name: league?.name || 'Beat Battle League', description: league?.description || '', color: league?.color || '#ff2d2d' },
    season: season ? { name: season.name } : null,
    standings: standings.map(r => ({
      rank: r.rank, name: r.name, wins: r.wins, losses: r.losses, draws: r.draws || 0,
      points: r.points ?? (r.wins * 3 + (r.draws || 0)), winRate: r.winRate || 0, rating: r.rating ?? null,
      avg: r.avgScore || r.avg || 0, qualified: !!r.qualified
    })),
    results: battles.filter(b => !b.isDemo).slice(0, maxResults).map(b => ({
      date: b.timestamp,
      kind: b.kind || 'battle',
      c1: b.contestant1Name, c2: b.contestant2Name,
      s1: Number(b.total1 || 0), s2: Number(b.total2 || 0),
      winner: b.winnerId === b.contestant1Id ? 1 : b.winnerId === b.contestant2Id ? 2 : 0,
      decision: b.decisionTally || '',
      placings: b.placings || null
    })),
    upcoming: queue.filter(q => q.status !== 'done').slice(0, 12).map(q => ({ label: q.label || '', c1: q.c1Name, c2: q.c2Name, live: q.status === 'live' })),
    nextUp,
    generatedAt: new Date().toISOString()
  };
}

function standingsTable(rows) {
  if (!rows.length) return '<p class="muted">No battles yet this season.</p>';
  return `<table><thead><tr><th>#</th><th>Producer</th><th>W</th><th>L</th><th>D</th><th>Pts</th><th>Win %</th><th>Avg</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="${r.qualified ? 'q' : ''}"><td>${r.rank}</td><td class="name">${esc(r.name)}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.draws}</td><td><b>${r.points}</b></td><td>${Math.round(r.winRate * 100)}%</td><td>${r.avg ? r.avg.toFixed(1) : '—'}</td></tr>`).join('')}
  </tbody></table>`;
}

function resultsList(results) {
  if (!results.length) return '<p class="muted">No results yet.</p>';
  return `<ul class="results">${results.map(r => {
    if (r.placings) {
      return `<li><span class="date">${esc(new Date(r.date).toLocaleDateString())}</span><span class="multi">${r.placings.map((p, i) => `<span class="${i === 0 ? 'w' : ''}">${i + 1}. ${esc(p.name)} <small>${Number(p.total || 0).toFixed(1)}</small></span>`).join(' ')}</span></li>`;
    }
    return `<li><span class="date">${esc(new Date(r.date).toLocaleDateString())}</span>
      <span class="${r.winner === 1 ? 'w' : ''}">${esc(r.c1)} <small>${r.s1.toFixed(1)}</small></span>
      <span class="vs">vs</span>
      <span class="${r.winner === 2 ? 'w' : ''}">${esc(r.c2)} <small>${r.s2.toFixed(1)}</small></span>
      ${r.winner === 0 ? '<span class="tag">Draw</span>' : ''}${r.decision ? `<span class="dec">${esc(r.decision)}</span>` : ''}</li>`;
  }).join('')}</ul>`;
}

function upcomingList(items, nextUp) {
  if (!items.length && !nextUp) return '';
  return `<section><h2>Up next</h2><ul class="results">${items.map(u => `<li class="${u.live ? 'live' : ''}">${u.live ? '<span class="tag live">LIVE</span>' : ''}${u.label ? `<span class="date">${esc(u.label)}</span>` : ''}<span>${esc(u.c1)}</span><span class="vs">vs</span><span>${esc(u.c2)}</span></li>`).join('')}</ul></section>`;
}

function body(d) {
  return `<header><h1>${esc(d.league.name)}</h1>${d.season ? `<p class="season">${esc(d.season.name)}</p>` : ''}${d.league.description ? `<p class="muted">${esc(d.league.description)}</p>` : ''}</header>
    ${upcomingList(d.upcoming, d.nextUp)}
    <section><h2>Standings</h2>${standingsTable(d.standings)}</section>
    <section><h2>Results</h2>${resultsList(d.results)}</section>
    <footer class="muted">Updated ${esc(new Date(d.generatedAt).toLocaleString())}</footer>`;
}

/** Full HTML document. live=true adds a 15 s refresh from /api/public/data */
function renderPublicPage(data, { live = false } = {}) {
  const color = /^#[0-9a-f]{3,8}$/i.test(data.league.color) ? data.league.color : '#ff2d2d';
  const script = live ? `<script>
  const esc=${esc.toString()};
  ${standingsTable.toString()}
  ${resultsList.toString()}
  ${upcomingList.toString()}
  ${body.toString()}
  setInterval(async()=>{try{const r=await fetch('/api/public/data',{cache:'no-store'});if(r.ok){const d=await r.json();if(d&&d.league)document.getElementById('app').innerHTML=body(d);}}catch(e){}},15000);
  </script>` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.league.name)} — Standings</title>
<style>
:root{--accent:${color};--bg:#08080b;--card:#121218;--text:#f0f0f5;--muted:#9898a8;--line:rgba(255,255,255,.08)}
@media (prefers-color-scheme: light){:root{--bg:#f6f6f8;--card:#fff;--text:#16161c;--muted:#5d5d6c;--line:rgba(0,0,0,.08)}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
#app{max-width:860px;margin:0 auto;padding:24px 16px 48px}
header h1{margin:0;font-size:clamp(1.8rem,6vw,2.6rem);letter-spacing:.02em;color:var(--accent)}
.season{margin:.2em 0 0;font-weight:600}.muted{color:var(--muted)}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-top:16px;overflow-x:auto}
h2{margin:0 0 10px;font-size:1rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:.92rem}th{text-align:left;font-size:.72rem;color:var(--muted);text-transform:uppercase;padding:6px}
td{padding:7px 6px;border-top:1px solid var(--line)}td.name{font-weight:600}tr.q td:first-child{box-shadow:inset 3px 0 0 var(--accent)}
.results{list-style:none;margin:0;padding:0}.results li{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;padding:8px 0;border-top:1px solid var(--line)}
.results li:first-child{border-top:0}.date{color:var(--muted);font-size:.8rem;min-width:84px}.vs{color:var(--muted);font-size:.8rem}
.w{font-weight:700;color:var(--accent)}small{color:var(--muted);font-weight:400}.dec{color:var(--muted);font-size:.8rem;margin-left:auto}
.tag{font-size:.7rem;padding:1px 6px;border-radius:6px;background:var(--line)}.tag.live{background:var(--accent);color:#fff}
.multi{display:flex;flex-wrap:wrap;gap:10px}footer{margin-top:18px;font-size:.8rem}
</style></head>
<body><div id="app">${body(data)}</div>${script}</body></html>`;
}

export { buildPublicData, renderPublicPage };
