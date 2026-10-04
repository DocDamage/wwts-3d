/**
 * Stream overlays for OBS browser sources (transparent background).
 *   overlay.html?room=ABCD&w=scoreboard   names, scores, rounds won, round, timer
 *                         &w=lower        lower third: names + who's beat is playing
 *                         &w=timer        big round timer
 *                         &w=bracket      current tournament bracket
 *                         &w=fight        fight HUD (health, timer, round pips, combo)
 *                         &w=crowd        live crowd-vote bars
 *                         &w=result       winner card after the reveal (auto-hides)
 *                         &w=chat         latest live-chat messages
 * Optional: &scale=1.5  &align=left|right|center  &demo=1 (sample data for layout)
 *
 * State arrives over the local hub (works in OBS, which is a separate browser),
 * or over BroadcastChannel when opened in the same browser as the host.
 */
const q = new URLSearchParams(location.search);
const room = (q.get('room') || '').toUpperCase();
const widget = q.get('w') || 'scoreboard';
const root = document.getElementById('ov-root');
const statusEl = document.getElementById('ov-status');
document.documentElement.style.setProperty('--ov-scale', q.get('scale') || '1');
document.body.dataset.align = q.get('align') || 'center';
document.body.dataset.w = widget;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let state = null;
let lastResultAt = 0;

function status(text) {
  if (!text) { statusEl.hidden = true; return; }
  statusEl.hidden = false;
  statusEl.textContent = text;
}

/* ---------------- widgets ---------------- */

const W = {
  scoreboard(s) {
    return `<div class="ov-score">
      <div class="ov-side p1"><span class="ov-name">${esc(s.c1Name)}</span><span class="ov-pts">${(s.score1 || 0).toFixed(1)}</span><span class="ov-pips">${pips(s.roundsWon1, 2)}</span></div>
      <div class="ov-mid"><span class="ov-round">${esc(s.roundTitle || '')}</span><span class="ov-timer ${s.timerCritical ? 'crit' : ''}">${esc(s.timerFormatted || '')}</span></div>
      <div class="ov-side p2"><span class="ov-pips">${pips(s.roundsWon2, 2)}</span><span class="ov-pts">${(s.score2 || 0).toFixed(1)}</span><span class="ov-name">${esc(s.c2Name)}</span></div>
    </div>`;
  },
  lower(s) {
    const playing = s.audioState1 ? s.c1Name : s.audioState2 ? s.c2Name : null;
    return `<div class="ov-lower">
      <div class="ov-lower-tag">${esc(s.league || 'WHO WANT THAT SMOKE')}</div>
      <div class="ov-lower-main"><span class="p1">${esc(s.c1Name)}</span><span class="ov-vs">VS</span><span class="p2">${esc(s.c2Name)}</span></div>
      <div class="ov-lower-sub">${playing ? `🎵 Now playing: <b>${esc(playing)}</b>` : esc(s.roundTitle || '')}${s.bpm ? ` · ${s.bpm.toFixed(0)} BPM` : ''}</div>
    </div>`;
  },
  timer(s) {
    return `<div class="ov-bigtimer ${s.timerCritical ? 'crit' : ''}"><span>${esc(s.roundTitle || '')}</span><b>${esc(s.timerFormatted || '0:00')}</b></div>`;
  },
  bracket(s) {
    const b = s.bracket;
    if (!b || !b.rounds?.length) return '<div class="ov-card">No tournament running</div>';
    return `<div class="ov-bracket"><div class="ov-bracket-title">${esc(b.name || 'Tournament')}</div><div class="ov-bracket-cols">${b.rounds.map(r => `
      <div class="ov-col"><div class="ov-col-title">${esc(r.title)}</div>${r.matches.map(m => `
        <div class="ov-match ${m.current ? 'current' : ''}">
          <div class="${m.winner === 1 ? 'won' : m.winner === 2 ? 'lost' : ''}">${esc(m.p1 || '—')}</div>
          <div class="${m.winner === 2 ? 'won' : m.winner === 1 ? 'lost' : ''}">${esc(m.p2 || '—')}</div>
        </div>`).join('')}</div>`).join('')}</div></div>`;
  },
  fight(s) {
    const f = s.fight;
    if (!f) return '';
    const bar = (p) => `<div class="ov-hp p${p}"><i style="width:${Math.max(0, f.hp[p])}%"></i></div>`;
    return `<div class="ov-fight">
      <div class="ov-fside p1"><span class="ov-name">${esc(f.names[1])}</span>${bar(1)}<span class="ov-pips">${pips(f.wins?.[1], f.need || 2)}</span>${f.combo?.[1] > 1 ? `<span class="ov-combo">${f.combo[1]} HITS</span>` : ''}</div>
      <div class="ov-ftimer">${f.clock ?? ''}</div>
      <div class="ov-fside p2"><span class="ov-name">${esc(f.names[2])}</span>${bar(2)}<span class="ov-pips">${pips(f.wins?.[2], f.need || 2)}</span>${f.combo?.[2] > 1 ? `<span class="ov-combo">${f.combo[2]} HITS</span>` : ''}</div>
    </div>`;
  },
  crowd(s) {
    const c = s.crowd;
    if (!c || !c.options) return '';
    const total = (c.counts?.[0] || 0) + (c.counts?.[1] || 0);
    const pct = (i) => (total ? Math.round(((c.counts[i] || 0) / total) * 100) : 50);
    return `<div class="ov-crowd"><div class="ov-crowd-title">📣 ${esc(c.title || 'Crowd vote')} ${c.open ? '<span class="live">LIVE</span>' : ''}</div>
      <div class="ov-crowd-bar"><i class="p1" style="width:${pct(0)}%"><span>${esc(c.options[0])} ${total ? pct(0) + '%' : ''}</span></i><i class="p2" style="width:${pct(1)}%"><span>${total ? pct(1) + '% ' : ''}${esc(c.options[1])}</span></i></div>
      <div class="ov-crowd-sub">${total} vote${total === 1 ? '' : 's'}${c.url ? ` · vote at ${esc(c.url)}` : ''}</div></div>`;
  },
  chat(s) {
    const c = s.chat;
    if (!c || !c.recent?.length) return '';
    return `<div class="ov-chat">${c.recent.map(m => `<div class="ov-chat-msg"><b class="${m.platform}">${esc(m.user)}</b> ${esc(m.text)}</div>`).join('')}</div>`;
  },
  result(s) {
    const r = s.result;
    if (!r || Date.now() - lastResultAt > 15000) return '';
    return `<div class="ov-result"><div class="ov-result-kicker">${r.winnerName === 'DRAW' ? "IT'S A" : 'THE WINNER IS'}</div><div class="ov-result-name">${esc(r.winnerName)}</div><div class="ov-result-sub">${esc(r.decision || '')}</div></div>`;
  }
};

function pips(n, of) {
  return Array.from({ length: of || 2 }, (_, i) => `<i class="${i < (n || 0) ? 'on' : ''}"></i>`).join('');
}

function render() {
  if (!state) return;
  if (demo) lastResultAt = Date.now();
  const fn = W[widget] || W.scoreboard;
  const html = fn(state);
  if (root._html !== html) { root.innerHTML = html; root._html = html; }
}

function apply(next) {
  if (next.result && next.result.at !== state?.result?.at) lastResultAt = Date.now();
  state = next;
  render();
}

/* ---------------- transport ---------------- */

let retry = 0;
function connect() {
  if (!room) { status('Add ?room=CODE to the overlay URL (copy it from the app: Tools → OBS overlays)'); return; }
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/judge-ws`);
  ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ t: 'ov-join', room })); };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.t === 'ov-joined') status(null);
    if (msg.t === 'overlay') { status(null); apply(msg.state); }
    if (msg.t === 'error') { status(`Waiting for the host screen (room ${room})…`); setTimeout(() => ws.close(), 3000); }
  };
  ws.onclose = () => { retry++; setTimeout(connect, Math.min(8000, 1000 * retry)); };
}

const demo = !!q.get('demo');
// Same-browser fallback (popouts / window capture)
if (!demo) {
  try {
    const bc = new BroadcastChannel('wwts_overlay');
    bc.onmessage = (e) => { if (e.data?.t === 'overlay' && (!room || e.data.room === room)) apply(e.data.state); };
  } catch { /* not supported */ }
}

if (demo) {
  apply({
    c1Name: '808 Smoke', c2Name: 'Vinyl Vixen', score1: 86.4, score2: 84.9, roundsWon1: 1, roundsWon2: 1, roundTitle: 'Final Round',
    timerFormatted: '1:42', audioState1: true, league: 'Who Want That Smoke', bpm: 92,
    bracket: { name: 'Summer Smoke', rounds: [{ title: 'Semis', matches: [{ p1: '808 Smoke', p2: 'Kick Master', winner: 1 }, { p1: 'Vinyl Vixen', p2: 'Queen Poly', winner: 1 }] }, { title: 'Final', matches: [{ p1: '808 Smoke', p2: 'Vinyl Vixen', current: true }] }] },
    fight: { names: { 1: 'Marcus', 2: 'Ninja' }, hp: { 1: 64, 2: 38 }, wins: { 1: 1, 2: 0 }, need: 2, clock: 47, combo: { 1: 4, 2: 0 } },
    crowd: { title: 'Who won round 3?', open: true, options: ['808 Smoke', 'Vinyl Vixen'], counts: [23, 31] },
    result: { winnerName: 'Vinyl Vixen', decision: 'Split Decision · 2-1', at: 1 },
    chat: { recent: [{ user: 'beatnerd', text: 'that flip was crazy 🔥', platform: 'twitch' }, { user: 'kickqueen', text: '2 all day', platform: 'youtube' }, { user: 'sp1200', text: 'W', platform: 'twitch' }], votes: [12, 19], rate: 80 }
  });
} else {
  status(room ? `Connecting to room ${room}…` : null);
}
setInterval(render, 1000);   // result card auto-hide
if (!demo) connect();
