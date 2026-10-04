/**
 * Judge phone app — joins the host's room on the local judge hub, renders the
 * battle's scoring categories, and sends scorecards back to the host screen.
 * Drafts stream live (the host sees progress); only "Submit" counts toward the decision.
 *
 * Also: scoring guides under each slider, a comment per category, a "why?" prompt
 * when the margin is close, the calibration round (one reference beat), flip
 * rounds, and 3/4-way battles (one tab per producer).
 */

const DEVICE_KEY = 'wwts_judge_device';
const NAME_KEY = 'wwts_judge_name';
const CARD_KEY = 'wwts_judge_cards_v2';
const BANDS = [[0, 3.9, '0–3'], [4, 5.9, '4–5'], [6, 7.9, '6–7'], [8, 9.4, '8–9'], [9.5, 10, '10']];

const $ = (id) => document.getElementById(id);

function storage(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

const state = {
  deviceId: storage(DEVICE_KEY, null) || (() => {
    const id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`).slice(0, 36);
    save(DEVICE_KEY, id);
    return id;
  })(),
  name: storage(NAME_KEY, ''),
  room: (new URLSearchParams(location.search).get('room') || '').toUpperCase(),
  ws: null,
  joined: false,
  wantJoin: false,
  seat: null,
  battle: null,   // last state from the host
  active: 0,      // producer tab (0-based)
  cards: storage(CARD_KEY, {}), // key -> { s: [[]…], c: [[]…], overall, submitted }
  retries: 0,
  draftTimer: null,
  wakeLock: null
};

/* ---------------- Screens ---------------- */

function show(screen) {
  ['join', 'wait', 'score'].forEach(s => { $(`screen-${s}`).hidden = s !== screen; });
  if (screen === 'score') requestWakeLock();
}

function setConn(status) {
  $('j-conn').dataset.status = status;
}

function waitText(text) {
  $('j-wait-text').textContent = text;
  show('wait');
}

/* ---------------- Connection ---------------- */

function connect() {
  setConn('connecting');
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/judge-ws`);
  state.ws = ws;
  ws.onopen = () => {
    state.retries = 0;
    setConn('online');
    if (state.wantJoin) ws.send(JSON.stringify({ t: 'join', room: state.room, deviceId: state.deviceId, name: state.name }));
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handle(msg);
  };
  ws.onclose = () => {
    state.ws = null;
    state.joined = false;
    setConn('offline');
    state.retries++;
    setTimeout(connect, Math.min(8000, 600 * state.retries));
  };
}

function send(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
}

function handle(msg) {
  switch (msg.t) {
    case 'joined':
      state.joined = true;
      if (!state.seat) waitText('Joined! Waiting for the host to give you a seat…');
      break;
    case 'error':
      if (msg.code === 'no-room') {
        state.wantJoin = false;
        show('join');
        showJoinError(`Room "${state.room}" isn't open. Check the code on the host screen.`);
      }
      break;
    case 'seat':
      state.seat = msg.seat;
      $('j-seat').textContent = `JUDGE ${msg.seat} · ${msg.name || state.name}`;
      if (state.battle) renderScore();
      else waitText('Seated! Waiting for the battle…');
      break;
    case 'full':
      waitText('All judge seats are taken. Ask the host to add a seat.');
      break;
    case 'released':
      state.seat = null;
      waitText('The host moved your seat back to the main screen. Thanks for judging!');
      break;
    case 'state': {
      const prevKey = state.battle ? modeKey(state.battle) : null;
      state.battle = msg.state;
      if (prevKey && prevKey !== modeKey(msg.state)) state.active = 0; // new battle / calibration
      if (state.seat) renderScore();
      break;
    }
    default:
      break;
  }
}

/* ---------------- What's being scored ---------------- */

const isCal = (b = state.battle) => !!b?.calibration;
const modeKey = (b) => (b.calibration ? `cal:${b.calibration.id}` : `${b.battleId || 'none'}`);

/** Producer names on the card: the reference beat in calibration, else the battle's contestants */
function names() {
  const b = state.battle;
  if (isCal(b)) return [`Reference: ${b.calibration.beat || 'beat'}`];
  return b.contestants || ['Contestant 1', 'Contestant 2'];
}

function cardKey() {
  const b = state.battle;
  return isCal(b) ? `cal:${b.calibration.id}` : `${b?.battleId || 'none'}:${b?.round || 1}`;
}

function currentCard() {
  const key = cardKey();
  const len = state.battle?.categories.length || 10;
  const n = names().length;
  let card = state.cards[key];
  if (!card) card = state.cards[key] = { s: [], c: [], overall: '', submitted: false };
  for (let i = 0; i < n; i++) {
    if (!card.s[i]) card.s[i] = new Array(len).fill(null);
    if (!card.c[i]) card.c[i] = new Array(len).fill('');
  }
  return card;
}

function totalFor(scores) {
  let sum = 0;
  let weight = 0;
  state.battle.categories.forEach((cat, i) => {
    if (!cat.enabled) return;
    const w = cat.weight ?? 1;
    sum += (scores[i] ?? 0) * w;
    weight += w;
  });
  return weight ? (10 * sum) / weight : 0;
}

function unscoredCount(card) {
  let n = 0;
  state.battle.categories.forEach((cat, i) => {
    if (!cat.enabled) return;
    card.s.forEach(arr => { if (arr[i] === null || arr[i] === undefined) n++; });
  });
  return n;
}

function guideFor(cat, v) {
  if (!cat.guides) return '';
  const val = Number(v) || 0;
  const bi = Math.max(0, BANDS.findIndex(([a, b]) => val >= a && val <= b));
  return `${BANDS[bi][2]}: ${cat.guides[bi] || ''}`;
}

/* ---------------- Rendering ---------------- */

function renderTabs() {
  const host = $('j-tabs');
  const list = names();
  host.innerHTML = list.map((nm, i) => `<button type="button" class="j-tab p${i + 1} ${i === state.active ? 'active' : ''}" data-c="${i}" role="tab" aria-selected="${i === state.active}">
      <span class="j-tab-name">${escape(nm)}</span><span class="j-tab-total" id="j-total-${i}">0.00</span></button>`).join('');
  host.dataset.n = String(list.length);
  host.querySelectorAll('.j-tab').forEach(tab => tab.addEventListener('click', () => {
    state.active = Number(tab.dataset.c);
    renderScore();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
}

function renderScore() {
  const b = state.battle;
  if (!b) return;
  show('score');
  if (state.active >= names().length) state.active = 0;
  const card = currentCard();
  const cal = isCal(b);
  $('j-round').textContent = cal ? 'CALIBRATION' : (b.roundLabel || '').toUpperCase();
  $('j-flip').hidden = cal || !b.flip;
  $('j-flip').textContent = b.flip ? `🎼 FLIP${b.flipSample ? ` · ${b.flipSample}` : ''}` : '';
  const locked = !cal && !!b.locked;
  $('j-lock').hidden = !locked;
  $('j-cal-note').hidden = !cal;
  document.body.classList.toggle('locked', locked);
  document.body.dataset.active = String(state.active + 1);
  renderTabs();

  const scores = card.s[state.active];
  const comments = card.c[state.active];
  const step = b.step || 0.1;
  const decimals = step < 0.25 ? 1 : 2;
  const list = $('j-cats');
  list.innerHTML = '';
  b.categories.forEach((cat, i) => {
    if (!cat.enabled) return;
    const v = scores[i];
    const row = document.createElement('div');
    row.className = 'j-cat';
    row.innerHTML = `
      <div class="j-cat-head">
        <button type="button" class="j-cat-name" aria-expanded="false">${escape(cat.name)}${cat.weight !== 1 ? ` <span class="j-weight">${cat.weight}×</span>` : ''}</button>
        ${b.commentsOn && !cal ? `<button type="button" class="j-comment-btn ${comments[i] ? 'has' : ''}" aria-label="Comment on ${escape(cat.name)}">💬</button>` : ''}
        <span class="j-cat-val ${v === null || v === undefined ? 'unscored' : ''}">${v === null || v === undefined ? '—' : v.toFixed(decimals)}</span>
      </div>
      <p class="j-cat-desc" hidden>${escape(cat.desc)}</p>
      <div class="j-cat-ctrl">
        <button type="button" class="j-step" data-d="-1" aria-label="Lower ${escape(cat.name)}">−</button>
        <input type="range" min="0" max="10" step="${step}" value="${v ?? 0}" aria-label="${escape(cat.name)} score" ${locked ? 'disabled' : ''} />
        <button type="button" class="j-step" data-d="1" aria-label="Raise ${escape(cat.name)}">+</button>
      </div>
      ${cat.guides ? `<p class="j-guide">${escape(v === null || v === undefined ? 'Slide to see what each range means' : guideFor(cat, v))}</p>` : ''}
      ${b.commentsOn && !cal ? `<input type="text" class="j-comment" maxlength="140" placeholder="Why this score? (optional)" value="${escape(comments[i] || '')}" ${comments[i] ? '' : 'hidden'} ${locked ? 'disabled' : ''} />` : ''}`;
    const slider = row.querySelector('input[type=range]');
    const valEl = row.querySelector('.j-cat-val');
    const guideEl = row.querySelector('.j-guide');
    const setVal = (val) => {
      if (locked) return;
      const clean = Math.max(0, Math.min(10, Math.round(val / step) * step));
      scores[i] = Number(clean.toFixed(2));
      slider.value = scores[i];
      valEl.textContent = scores[i].toFixed(decimals);
      valEl.classList.remove('unscored');
      if (guideEl) guideEl.textContent = guideFor(cat, scores[i]);
      paintSlider(slider, scores[i]);
      changed();
    };
    slider.addEventListener('input', () => setVal(parseFloat(slider.value)));
    row.querySelectorAll('.j-step').forEach(btn => btn.addEventListener('click', () => {
      setVal((scores[i] ?? 0) + Number(btn.dataset.d) * step);
    }));
    row.querySelector('.j-cat-name').addEventListener('click', (e) => {
      const desc = row.querySelector('.j-cat-desc');
      desc.hidden = !desc.hidden;
      e.currentTarget.setAttribute('aria-expanded', String(!desc.hidden));
    });
    const cBtn = row.querySelector('.j-comment-btn');
    const cInp = row.querySelector('.j-comment');
    cBtn?.addEventListener('click', () => { cInp.hidden = !cInp.hidden; if (!cInp.hidden) cInp.focus(); });
    cInp?.addEventListener('input', () => {
      comments[i] = cInp.value.slice(0, 140);
      cBtn.classList.toggle('has', !!comments[i].trim());
      changed();
    });
    paintSlider(slider, v ?? 0);
    list.appendChild(row);
  });
  renderTotals();
}

const COLORS = ['#ff2d2d', '#00e5ff', '#ffaa00', '#b84dff'];

function paintSlider(slider, v) {
  const pct = (v / 10) * 100;
  const color = isCal() ? '#ffd21a' : COLORS[state.active % COLORS.length];
  slider.style.background = `linear-gradient(to right, ${color} 0%, ${color} ${pct}%, #23232c ${pct}%, #23232c 100%)`;
}

function renderTotals() {
  const card = currentCard();
  card.s.forEach((arr, i) => { const el = $(`j-total-${i}`); if (el) el.textContent = totalFor(arr).toFixed(2); });
  const missing = unscoredCount(card);
  const b = state.battle;
  const cal = isCal(b);
  const locked = !cal && !!b.locked;
  const submit = $('j-submit');
  const label = cal ? 'Reference Card' : b.roundLabel;
  submit.disabled = locked;
  submit.textContent = locked ? 'Round Locked' : card.submitted ? `Update ${label}` : `Submit ${label}`;
  $('j-footer-note').textContent = locked
    ? (card.submitted ? '✓ Your card is in. The host locked this round.' : 'The host locked this round before you submitted.')
    : card.submitted
      ? (cal ? '✓ Reference card in — thanks!' : '✓ Submitted — you can still adjust until the host locks the round.')
      : missing ? `${missing} categor${missing === 1 ? 'y' : 'ies'} still unscored` : 'All categories scored — ready to submit.';
}

function changed() {
  const card = currentCard();
  save(CARD_KEY, pruneCards());
  renderTotals();
  if (isCal()) return;   // reference cards only go in on submit
  // Stream a draft so the host can see progress (drafts don't count until submitted)
  clearTimeout(state.draftTimer);
  state.draftTimer = setTimeout(() => sendCard(card.submitted), 350);
}

function sendCard(submitted) {
  const card = currentCard();
  const b = state.battle;
  if (isCal(b)) {
    send({ t: 'cal-scores', calId: b.calibration.id, scores: card.s[0].map(v => v ?? null) });
    return;
  }
  const msg = {
    t: 'scores',
    battleId: b.battleId,
    round: b.round,
    scores1: (card.s[0] || []).map(v => v ?? 0),
    scores2: (card.s[1] || []).map(v => v ?? 0),
    submitted
  };
  if (b.commentsOn) {
    msg.comments1 = card.c[0] || [];
    msg.comments2 = card.c[1] || [];
    if (card.overall) msg.overall = card.overall;
  }
  if (names().length > 2) {
    msg.cards = card.s.map(arr => arr.map(v => v ?? 0));
    if (b.commentsOn) msg.commentsN = card.c;
  }
  send(msg);
}

/** Keep only the last few battles' cards on the phone */
function pruneCards() {
  const keys = Object.keys(state.cards);
  if (keys.length > 24) keys.slice(0, keys.length - 24).forEach(k => delete state.cards[k]);
  return state.cards;
}

async function submit() {
  const card = currentCard();
  const b = state.battle;
  const missing = unscoredCount(card);
  if (missing && !confirm(`${missing} categor${missing === 1 ? 'y is' : 'ies are'} unscored and will count as 0. Submit anyway?`)) return;
  // Close call? Ask for a quick reason (optional)
  if (!isCal(b) && b.commentsOn && b.closeMargin > 0 && card.s.length >= 2) {
    const totals = card.s.map(totalFor).sort((x, y) => y - x);
    const margin = totals[0] - totals[1];
    if (margin < b.closeMargin && !card.overall) {
      const reason = await askOverall(margin);
      if (reason === null) return;
      card.overall = reason;
    }
  }
  card.submitted = true;
  save(CARD_KEY, pruneCards());
  sendCard(true);
  navigator.vibrate?.(60);
  renderTotals();
}

/** "It's close — why?" sheet. Resolves with text ('' to skip) or null to go back */
function askOverall(margin) {
  return new Promise(resolve => {
    const sheet = $('j-why-sheet');
    $('j-why-margin').textContent = margin.toFixed(2);
    $('j-why-text').value = '';
    sheet.hidden = false;
    $('j-why-text').focus();
    const done = (v) => {
      sheet.hidden = true;
      $('j-why-send').onclick = $('j-why-skip').onclick = $('j-why-back').onclick = null;
      resolve(v);
    };
    $('j-why-send').onclick = () => done($('j-why-text').value.trim().slice(0, 280));
    $('j-why-skip').onclick = () => done('');
    $('j-why-back').onclick = () => done(null);
  });
}

/* ---------------- Notes to the host's notepad ---------------- */

const noteState = { who: 1, vis: 'private' };

function openNoteSheet() {
  if (!state.battle) return;
  const list = names();
  $('j-note-who-1').textContent = list[0] || 'C1';
  $('j-note-who-2').textContent = list[1] || 'C2';
  noteState.who = state.active < 2 ? state.active + 1 : 0;
  syncSeg('j-note-who', String(noteState.who));
  $('j-note-sheet').hidden = false;
  $('j-note-text').focus();
}

function syncSeg(id, value) {
  document.querySelectorAll(`#${id} button`).forEach(b => b.classList.toggle('active', b.dataset.v === value));
}

function sendNote() {
  const text = $('j-note-text').value.trim();
  if (!text) return;
  send({ t: 'note', text, contestant: noteState.who || null, visibility: noteState.vis });
  $('j-note-text').value = '';
  $('j-note-sheet').hidden = true;
  navigator.vibrate?.(30);
}

function escape(s) {
  return String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !state.wakeLock) {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
    }
  } catch {
    // Not supported or denied — the screen may dim, scores are still saved
  }
}

/* ---------------- Join ---------------- */

function showJoinError(text) {
  const el = $('j-join-error');
  el.textContent = text;
  el.hidden = !text;
}

function join() {
  const name = $('j-name').value.trim();
  const room = $('j-room').value.trim().toUpperCase();
  if (!name) return showJoinError('Enter your name so the host knows who you are.');
  if (!/^[A-Z0-9]{4,8}$/.test(room)) return showJoinError('Enter the room code shown on the host screen.');
  showJoinError('');
  state.name = name;
  state.room = room;
  state.wantJoin = true;
  save(NAME_KEY, name);
  history.replaceState(null, '', `?room=${room}`);
  waitText('Joining the panel…');
  send({ t: 'join', room, deviceId: state.deviceId, name });
}

document.addEventListener('DOMContentLoaded', () => {
  $('j-name').value = state.name;
  $('j-room').value = state.room;
  $('j-join').addEventListener('click', join);
  [$('j-name'), $('j-room')].forEach(inp => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); }));
  $('j-submit').addEventListener('click', submit);
  $('j-note-open').addEventListener('click', openNoteSheet);
  $('j-note-close').addEventListener('click', () => { $('j-note-sheet').hidden = true; });
  $('j-note-send').addEventListener('click', sendNote);
  document.querySelectorAll('#j-note-who button').forEach(b => b.addEventListener('click', () => {
    noteState.who = Number(b.dataset.v);
    syncSeg('j-note-who', b.dataset.v);
  }));
  document.querySelectorAll('#j-note-vis button').forEach(b => b.addEventListener('click', () => {
    noteState.vis = b.dataset.v;
    syncSeg('j-note-vis', b.dataset.v);
  }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !$('screen-score').hidden) requestWakeLock();
  });

  // Returning judge on the same phone: rejoin automatically
  if (state.name && state.room) {
    state.wantJoin = true;
    waitText('Rejoining the panel…');
  }
  connect();
});
