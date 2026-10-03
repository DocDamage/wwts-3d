/**
 * Judge phone app — joins the host's room on the local judge hub, renders the
 * battle's scoring categories, and sends scorecards back to the host screen.
 * Drafts stream live (the host sees progress); only "Submit" counts toward the decision.
 */

const DEVICE_KEY = 'wwts_judge_device';
const NAME_KEY = 'wwts_judge_name';
const CARD_KEY = 'wwts_judge_cards';

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
  active: 1,      // contestant tab
  cards: storage(CARD_KEY, {}), // `${battleId}:${round}` -> { s1: [], s2: [], submitted }
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
      const prevBattle = state.battle?.battleId;
      state.battle = msg.state;
      if (prevBattle && prevBattle !== msg.state.battleId) state.active = 1; // new battle
      if (state.seat) renderScore();
      break;
    }
    default:
      break;
  }
}

/* ---------------- Scorecard ---------------- */

function cardKey() {
  return `${state.battle?.battleId || 'none'}:${state.battle?.round || 1}`;
}

function currentCard() {
  const key = cardKey();
  const len = state.battle?.categories.length || 10;
  if (!state.cards[key]) state.cards[key] = { s1: new Array(len).fill(null), s2: new Array(len).fill(null), submitted: false };
  return state.cards[key];
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
    if (card.s1[i] === null || card.s1[i] === undefined) n++;
    if (card.s2[i] === null || card.s2[i] === undefined) n++;
  });
  return n;
}

function renderScore() {
  const b = state.battle;
  if (!b) return;
  show('score');
  const card = currentCard();
  $('j-round').textContent = b.roundLabel.toUpperCase();
  $('j-lock').hidden = !b.locked;
  $('j-name-1').textContent = b.contestants[0];
  $('j-name-2').textContent = b.contestants[1];
  document.querySelectorAll('.j-tab').forEach(t => t.classList.toggle('active', Number(t.dataset.c) === state.active));
  document.body.classList.toggle('locked', !!b.locked);
  document.body.dataset.active = state.active;

  const scores = state.active === 1 ? card.s1 : card.s2;
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
        <span class="j-cat-val ${v === null || v === undefined ? 'unscored' : ''}">${v === null || v === undefined ? '—' : v.toFixed(decimals)}</span>
      </div>
      <p class="j-cat-desc" hidden>${escape(cat.desc)}</p>
      <div class="j-cat-ctrl">
        <button type="button" class="j-step" data-d="-1" aria-label="Lower ${escape(cat.name)}">−</button>
        <input type="range" min="0" max="10" step="${step}" value="${v ?? 0}" aria-label="${escape(cat.name)} score" ${b.locked ? 'disabled' : ''} />
        <button type="button" class="j-step" data-d="1" aria-label="Raise ${escape(cat.name)}">+</button>
      </div>`;
    const slider = row.querySelector('input');
    const valEl = row.querySelector('.j-cat-val');
    const setVal = (val) => {
      if (state.battle.locked) return;
      const clean = Math.max(0, Math.min(10, Math.round(val / step) * step));
      scores[i] = Number(clean.toFixed(2));
      slider.value = scores[i];
      valEl.textContent = scores[i].toFixed(decimals);
      valEl.classList.remove('unscored');
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
    paintSlider(slider, v ?? 0);
    list.appendChild(row);
  });
  renderTotals();
}

function paintSlider(slider, v) {
  const pct = (v / 10) * 100;
  const color = state.active === 1 ? '#ff2d2d' : '#00e5ff';
  slider.style.background = `linear-gradient(to right, ${color} 0%, ${color} ${pct}%, #23232c ${pct}%, #23232c 100%)`;
}

function renderTotals() {
  const card = currentCard();
  $('j-total-1').textContent = totalFor(card.s1).toFixed(2);
  $('j-total-2').textContent = totalFor(card.s2).toFixed(2);
  const missing = unscoredCount(card);
  const b = state.battle;
  const submit = $('j-submit');
  submit.disabled = !!b.locked;
  submit.textContent = b.locked ? 'Round Locked' : card.submitted ? `Update ${b.roundLabel} Scores` : `Submit ${b.roundLabel}`;
  $('j-footer-note').textContent = b.locked
    ? (card.submitted ? '✓ Your card is in. The host locked this round.' : 'The host locked this round before you submitted.')
    : card.submitted
      ? '✓ Submitted — you can still adjust until the host locks the round.'
      : missing ? `${missing} categor${missing === 1 ? 'y' : 'ies'} still unscored` : 'All categories scored — ready to submit.';
}

function changed() {
  const card = currentCard();
  save(CARD_KEY, pruneCards());
  renderTotals();
  // Stream a draft so the host can see progress (drafts don't count until submitted)
  clearTimeout(state.draftTimer);
  state.draftTimer = setTimeout(() => sendCard(card.submitted), 350);
}

function sendCard(submitted) {
  const card = currentCard();
  send({
    t: 'scores',
    battleId: state.battle.battleId,
    round: state.battle.round,
    scores1: card.s1.map(v => v ?? 0),
    scores2: card.s2.map(v => v ?? 0),
    submitted
  });
}

/** Keep only the last few battles' cards on the phone */
function pruneCards() {
  const keys = Object.keys(state.cards);
  if (keys.length > 24) keys.slice(0, keys.length - 24).forEach(k => delete state.cards[k]);
  return state.cards;
}

function submit() {
  const card = currentCard();
  const missing = unscoredCount(card);
  if (missing && !confirm(`${missing} categor${missing === 1 ? 'y is' : 'ies are'} unscored and will count as 0. Submit anyway?`)) return;
  card.submitted = true;
  save(CARD_KEY, pruneCards());
  sendCard(true);
  navigator.vibrate?.(60);
  renderTotals();
}

/* ---------------- Notes to the host's notepad ---------------- */

const noteState = { who: 1, vis: 'private' };

function openNoteSheet() {
  if (!state.battle) return;
  $('j-note-who-1').textContent = state.battle.contestants[0];
  $('j-note-who-2').textContent = state.battle.contestants[1];
  noteState.who = state.active;
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
  document.querySelectorAll('.j-tab').forEach(tab => tab.addEventListener('click', () => {
    state.active = Number(tab.dataset.c);
    renderScore();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
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
