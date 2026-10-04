/**
 * Crowd vote page (vote.html): anyone on the venue Wi-Fi with the room code can
 * vote for the beat they think won and tap 🔥 to hype the stage crowd.
 */
const $ = (id) => document.getElementById(id);
const KEY = 'wwts_vote_device';

const state = {
  room: new URLSearchParams(location.search).get('room') || '',
  deviceId: (() => {
    try {
      let id = localStorage.getItem(KEY);
      if (!id) { id = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(KEY, id); }
      return id;
    } catch {
      return 'v_' + Math.random().toString(36).slice(2);
    }
  })(),
  ws: null,
  poll: null,
  myVote: null,
  joined: false,
  retry: 0,
  pred: null,
  myPick: null,
  points: 0,
  board: [],
  nick: (() => { try { return localStorage.getItem('wwts_vote_nick') || ''; } catch { return ''; } })()
};

function show(id) {
  ['v-join', 'v-wait', 'v-poll'].forEach(s => { $(s).hidden = s !== id; });
}

function setConn(status) {
  $('v-conn').dataset.status = status;
}

function send(msg) {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
}

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/judge-ws`);
  state.ws = ws;
  setConn('connecting');
  ws.onopen = () => {
    state.retry = 0;
    setConn('online');
    if (state.room) {
      send({ t: 'aud-join', room: state.room, deviceId: state.deviceId });
      if (state.nick) send({ t: 'aud-name', name: state.nick });
    }
  };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handle(msg);
  };
  ws.onclose = () => {
    setConn('offline');
    state.retry++;
    setTimeout(connect, Math.min(10000, 800 * state.retry));
  };
}

function handle(msg) {
  if (msg.t === 'error') {
    $('v-error').hidden = false;
    $('v-error').textContent = msg.code === 'no-room' ? 'No battle with that code right now — check the screen.' : 'Could not join.';
    show('v-join');
    return;
  }
  if (msg.t === 'aud-joined') {
    state.joined = true;
    $('v-error').hidden = true;
    history.replaceState(null, '', `?room=${state.room}`);
    show('v-wait');
  }
  if (msg.t === 'poll') {
    state.poll = msg.poll;
    state.myVote = msg.myVote;
    render(msg.counts || null);
  }
  if (msg.t === 'pred') {
    state.pred = msg.pred;
    state.myPick = msg.myPick ?? state.myPick;
    if (typeof msg.points === 'number') state.points = msg.points;
    if (state.pred && state.pred.id !== state._predId) { state._predId = state.pred.id; state.myPick = msg.myPick || null; }
    renderPred();
  }
  if (msg.t === 'pred-board') {
    state.board = msg.board || [];
    if (typeof msg.me === 'number') state.points = msg.me;
    renderPred();
  }
}

function renderPred() {
  const p = state.pred;
  $('v-pred').hidden = !p;
  if (p) {
    $('v-pred-title').textContent = p.open ? (p.title || 'Who takes it?') : (p.result !== null && p.result !== undefined ? 'Prediction result' : 'Predictions closed');
    [1, 2].forEach(n => {
      $(`v-pred-${n}`).textContent = p.options?.[n - 1] || `Beat ${n === 1 ? 'A' : 'B'}`;
      const b = document.querySelector(`.v-pred-opt[data-pick="${n}"]`);
      b.classList.toggle('picked', state.myPick === n);
      b.classList.toggle('right', p.result === n);
      b.disabled = !p.open;
      b.setAttribute('aria-pressed', state.myPick === n ? 'true' : 'false');
    });
    $('v-pred-status').textContent = p.open
      ? (state.myPick ? 'Locked in — you can switch until the reveal.' : 'Call it before the reveal for a point.')
      : p.result ? (state.myPick === p.result ? '✓ You called it! +1' : state.myPick ? 'Not this time.' : 'You didn’t predict this one.')
        : p.result === 0 ? 'It was a draw — no points.' : 'Waiting for the reveal…';
  }
  $('v-board').hidden = !p && !state.board.length;
  $('v-me-pts').textContent = `${state.points} pt${state.points === 1 ? '' : 's'}`;
  $('v-board-list').innerHTML = state.board.map(b => `<li>${escapeHtml(b.name)}<span>${b.points}</span></li>`).join('') || '<li>No points yet — be first!</li>';
  if (document.activeElement !== $('v-nick')) $('v-nick').value = state.nick;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

document.querySelectorAll('.v-pred-opt').forEach(btn => btn.addEventListener('click', () => {
  if (!state.pred?.open) return;
  state.myPick = Number(btn.dataset.pick);
  send({ t: 'predict', predId: state.pred.id, choice: state.myPick });
  renderPred();
  navigator.vibrate?.(25);
}));

$('v-nick-save').addEventListener('click', () => {
  const name = $('v-nick').value.trim().slice(0, 20);
  if (!name) return;
  state.nick = name;
  try { localStorage.setItem('wwts_vote_nick', name); } catch { /* ignore */ }
  send({ t: 'aud-name', name });
  $('v-nick-save').textContent = 'Saved ✓';
  setTimeout(() => { $('v-nick-save').textContent = 'Save'; }, 1500);
});

function render(counts) {
  const p = state.poll;
  if (!p) { show('v-wait'); $('v-wait-text').textContent = 'Waiting for the next vote…'; return; }
  show('v-poll');
  $('v-title').textContent = p.open ? p.title : `${p.title} — voting closed`;
  [1, 2].forEach(n => {
    $(`v-opt-${n}`).textContent = p.options[n - 1] || (n === 1 ? 'Beat A' : 'Beat B');
    const btn = document.querySelector(`.v-opt[data-choice="${n}"]`);
    btn.classList.toggle('chosen', state.myVote === n);
    btn.disabled = !p.open;
    btn.setAttribute('aria-pressed', state.myVote === n ? 'true' : 'false');
    const total = counts ? counts[0] + counts[1] : 0;
    const pct = counts && total ? Math.round((counts[n - 1] / total) * 100) : 0;
    $(`v-bar-${n}`).style.width = counts ? `${pct}%` : '0%';
    $(`v-count-${n}`).textContent = counts ? `${pct}%` : '';
  });
  $('v-status').textContent = !p.open
    ? (state.myVote ? 'Thanks for voting!' : 'Voting is closed.')
    : state.myVote ? 'Vote in! Tap the other one to change it.' : 'Tap the beat you think won.';
}

document.querySelectorAll('.v-opt').forEach(btn => btn.addEventListener('click', () => {
  if (!state.poll?.open) return;
  const choice = Number(btn.dataset.choice);
  state.myVote = choice;
  render(null);
  send({ t: 'vote', pollId: state.poll.id, choice });
  navigator.vibrate?.(30);
}));

$('v-join-btn').addEventListener('click', () => {
  const room = $('v-room').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(room)) { $('v-error').hidden = false; $('v-error').textContent = 'Enter the 4-letter code from the screen.'; return; }
  state.room = room;
  send({ t: 'aud-join', room, deviceId: state.deviceId });
});

let hypeCooldown = 0;
$('v-hype').addEventListener('click', () => {
  const now = Date.now();
  if (now < hypeCooldown) return;
  hypeCooldown = now + 700;
  send({ t: 'aud-hype' });
  const b = $('v-hype');
  b.classList.remove('pop');
  void b.offsetWidth;
  b.classList.add('pop');
  navigator.vibrate?.(15);
});

if (state.room) { $('v-room').value = state.room; show('v-wait'); $('v-wait-text').textContent = 'Joining…'; } else show('v-join');
connect();
