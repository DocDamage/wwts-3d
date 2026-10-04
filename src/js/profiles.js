/**
 * Player profile extras: rating history, recent form, head-to-head records,
 * category strengths, season (league) breakdown — plus a shareable image card.
 * Everything is derived from the battle history and roster stats.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function outcomeOf(b, id) {
  if (!b.winnerId) return 'D';
  return b.winnerId === id ? 'W' : 'L';
}

/** Everything the profile shows, computed once */
function profileStats(contestant, battles, leagues = []) {
  const id = contestant.id;
  const mine = battles.filter(b => !b.isDemo && (b.contestant1Id === id || b.contestant2Id === id))
    .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
  // rating over time (oldest first)
  const ratings = [];
  mine.forEach(b => {
    const rc = b.ratingChanges?.[id];
    if (rc) {
      if (!ratings.length) ratings.push({ t: b.timestamp, r: rc.before });
      ratings.push({ t: b.timestamp, r: rc.after });
    }
  });
  const form = mine.slice(-5).map(b => outcomeOf(b, id));
  // head to head
  const h2h = {};
  mine.forEach(b => {
    const isC1 = b.contestant1Id === id;
    const oppId = isC1 ? b.contestant2Id : b.contestant1Id;
    const oppName = isC1 ? b.contestant2Name : b.contestant1Name;
    const row = (h2h[oppId] = h2h[oppId] || { id: oppId, name: oppName, w: 0, l: 0, d: 0, margin: 0, n: 0 });
    const o = outcomeOf(b, id);
    if (o === 'W') row.w++; else if (o === 'L') row.l++; else row.d++;
    row.margin += (isC1 ? b.total1 - b.total2 : b.total2 - b.total1) || 0;
    row.n++;
  });
  // seasons (by league)
  const seasons = {};
  mine.forEach(b => {
    const key = b.leagueId || 'none';
    const row = (seasons[key] = seasons[key] || { id: key, name: leagues.find(l => l.id === key)?.name || 'Unassigned', w: 0, l: 0, d: 0, n: 0, sum: 0 });
    const o = outcomeOf(b, id);
    if (o === 'W') row.w++; else if (o === 'L') row.l++; else row.d++;
    row.n++;
    row.sum += (b.contestant1Id === id ? b.total1 : b.total2) || 0;
  });
  // category strengths: average per battle from career totals
  const totals = contestant.stats?.categoryTotals || {};
  const nb = Math.max(1, contestant.stats?.totalBattles || 1);
  const cats = Object.entries(totals).map(([name, v]) => ({ name, avg: v / nb })).sort((a, b) => b.avg - a.avg);
  return {
    battles: mine,
    ratings,
    form,
    h2h: Object.values(h2h).sort((a, b) => b.n - a.n),
    seasons: Object.values(seasons).sort((a, b) => b.n - a.n),
    cats,
    rating: contestant.stats?.rating ?? 1500,
    peak: contestant.stats?.peakRating ?? 1500,
    streak: contestant.stats?.streak || 0,
    best: contestant.stats?.bestScore || 0
  };
}

function sparkline(points, w = 300, h = 70) {
  if (points.length < 2) return '<p class="profile-muted">Rating history appears after their first rated battle.</p>';
  const rs = points.map(p => p.r);
  const lo = Math.min(...rs) - 10;
  const hi = Math.max(...rs) + 10;
  const x = (i) => (i / (points.length - 1)) * (w - 8) + 4;
  const y = (r) => h - 6 - ((r - lo) / (hi - lo || 1)) * (h - 14);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.r).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return `<svg class="profile-spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="Rating history from ${points[0].r} to ${last.r}">
    <path d="${d}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(points.length - 1)}" cy="${y(last.r)}" r="4" fill="currentColor"/>
    <text x="4" y="12" class="spark-label">${hi - 10}</text><text x="4" y="${h - 2}" class="spark-label">${lo + 10}</text>
  </svg>`;
}

function renderProfileExtras(el, contestant, battles, leagues) {
  if (!el) return null;
  const s = profileStats(contestant, battles, leagues);
  const streak = s.streak > 0 ? `🔥 ${s.streak} win streak` : s.streak < 0 ? `${-s.streak} loss streak` : 'No streak';
  const maxCat = s.cats[0]?.avg || 1;
  el.innerHTML = `
    <div class="profile-extra-grid">
      <div class="profile-card-box">
        <h4>Rating</h4>
        <div class="profile-rating"><b>${s.rating}</b><span>peak ${s.peak}</span></div>
        <div class="profile-rating-chart" style="color:${esc(contestant.color || '#ffd21a')}">${sparkline(s.ratings)}</div>
        <div class="profile-muted">${streak}${s.best ? ` · best score ${s.best.toFixed(2)}` : ''}</div>
      </div>
      <div class="profile-card-box">
        <h4>Form (last 5)</h4>
        <div class="profile-form">${s.form.length ? s.form.map(o => `<span class="form-pill ${o}" title="${o === 'W' ? 'Win' : o === 'L' ? 'Loss' : 'Draw'}">${o}</span>`).join('') : '<span class="profile-muted">No battles yet</span>'}</div>
        <h4>Seasons</h4>
        ${s.seasons.length ? `<table class="profile-table"><thead><tr><th>League</th><th>W-L-D</th><th>Avg</th></tr></thead><tbody>${s.seasons.map(r => `<tr><td>${esc(r.name)}</td><td>${r.w}-${r.l}-${r.d}</td><td>${(r.sum / r.n).toFixed(1)}</td></tr>`).join('')}</tbody></table>` : '<p class="profile-muted">—</p>'}
      </div>
      <div class="profile-card-box">
        <h4>Head to head</h4>
        ${s.h2h.length ? `<table class="profile-table"><thead><tr><th>Opponent</th><th>W-L-D</th><th>Margin</th></tr></thead><tbody>${s.h2h.slice(0, 8).map(r => `<tr><td>${esc(r.name)}</td><td>${r.w}-${r.l}-${r.d}</td><td>${(r.margin / r.n >= 0 ? '+' : '') + (r.margin / r.n).toFixed(1)}</td></tr>`).join('')}</tbody></table>` : '<p class="profile-muted">No rivals yet.</p>'}
      </div>
      <div class="profile-card-box">
        <h4>Strengths</h4>
        ${s.cats.length ? s.cats.slice(0, 6).map(c => `<div class="cat-bar"><span>${esc(c.name)}</span><i style="--w:${Math.max(4, (c.avg / maxCat) * 100)}%"></i></div>`).join('') : '<p class="profile-muted">Category strengths build up as they battle.</p>'}
      </div>
    </div>`;
  return s;
}

/** 1080×1350 share card (PNG) */
async function makeProfileCard(contestant, stats, { badges = 0, league = '' } = {}) {
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const accent = contestant.color || '#ff2d2d';
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b0c14');
  bg.addColorStop(1, '#181022');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = accent;
  g.globalAlpha = 0.18;
  g.beginPath();
  g.arc(W * 0.85, 140, 420, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  // photo
  const drawInitials = () => {
    g.fillStyle = accent;
    g.beginPath();
    g.arc(W / 2, 330, 190, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0b0c14';
    g.font = 'bold 150px "Bebas Neue", Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(contestant.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase(), W / 2, 340);
  };
  if (contestant.photo) {
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.crossOrigin = 'anonymous';
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = contestant.photo;
      });
      g.save();
      g.beginPath();
      g.arc(W / 2, 330, 190, 0, Math.PI * 2);
      g.clip();
      const s = Math.max(380 / img.width, 380 / img.height);
      g.drawImage(img, W / 2 - (img.width * s) / 2, 330 - (img.height * s) / 2, img.width * s, img.height * s);
      g.restore();
      g.strokeStyle = accent;
      g.lineWidth = 10;
      g.beginPath();
      g.arc(W / 2, 330, 195, 0, Math.PI * 2);
      g.stroke();
    } catch {
      drawInitials();
    }
  } else drawInitials();
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff';
  g.font = 'bold 110px "Bebas Neue", Impact, sans-serif';
  g.fillText(contestant.name.toUpperCase(), W / 2, 650);
  g.fillStyle = '#cfd3e0';
  g.font = '500 38px Inter, sans-serif';
  g.fillText(league || 'Who Want That Smoke', W / 2, 705);
  // stat tiles
  const st = contestant.stats || {};
  const tiles = [
    ['RATING', String(stats.rating)],
    ['RECORD', `${st.wins || 0}-${st.losses || 0}-${st.draws || 0}`],
    ['AVG', (st.avgScore || 0).toFixed(1)],
    ['BADGES', String(badges)]
  ];
  tiles.forEach(([label, val], i) => {
    const x = 90 + i * 235;
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(x, 770, 210, 170);
    g.fillStyle = accent;
    g.font = 'bold 30px Inter, sans-serif';
    g.fillText(label, x + 105, 820);
    g.fillStyle = '#fff';
    g.font = 'bold 72px "Bebas Neue", Impact, sans-serif';
    g.fillText(val, x + 105, 905);
  });
  // form pills
  g.font = 'bold 30px Inter, sans-serif';
  g.fillStyle = '#9aa3b8';
  g.fillText('LAST 5', W / 2, 1010);
  const form = stats.form.length ? stats.form : ['—'];
  form.forEach((o, i) => {
    const x = W / 2 + (i - (form.length - 1) / 2) * 110;
    g.fillStyle = o === 'W' ? '#2ecc71' : o === 'L' ? '#ff4a4a' : '#9aa3b8';
    g.beginPath();
    g.arc(x, 1075, 42, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0b0c14';
    g.font = 'bold 44px Inter, sans-serif';
    g.fillText(o, x, 1091);
  });
  // strengths
  g.fillStyle = '#cfd3e0';
  g.font = '500 34px Inter, sans-serif';
  const top = stats.cats.slice(0, 3).map(c => c.name).join(' · ');
  if (top) g.fillText(`Strengths: ${top}`, W / 2, 1195);
  g.fillStyle = accent;
  g.fillRect(0, H - 18, W, 18);
  g.fillStyle = '#ffffff';
  g.font = 'bold 32px "Bebas Neue", Impact, sans-serif';
  g.fillText('BEATBATTLE · WHO WANT THAT SMOKE', W / 2, H - 50);
  return new Promise(resolve => c.toBlob(resolve, 'image/png'));
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export { profileStats, renderProfileExtras, makeProfileCard, downloadBlob };
