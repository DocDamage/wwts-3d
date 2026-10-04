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
  retry: 0
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
    if (state.room) send({ t: 'aud-join', room: state.room, deviceId: state.deviceId });
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
}

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
