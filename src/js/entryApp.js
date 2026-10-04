/**
 * Producer sign-up page (entry.html): join tonight's open battle from your
 * phone, see whether you're on the list / waitlisted / checked in / drawn, and
 * upload a beat for each round. Talks to the host through the local hub.
 */
const $ = (id) => document.getElementById(id);
const KEY = 'wwts_entry_device';
const ROUND_NAMES = { 1: 'Round 1', 2: 'Round 2', 3: 'Final round' };

const state = {
  room: (new URLSearchParams(location.search).get('room') || '').toUpperCase(),
  deviceId: (() => {
    try {
      let id = localStorage.getItem(KEY);
      if (!id) { id = `e-${(crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 30)}`; localStorage.setItem(KEY, id); }
      return id;
    } catch {
      return `e-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    }
  })(),
  ws: null,
  config: null,
  me: null,
  status: null,
  editing: false,
  retry: 0,
  uploads: {}   // round -> { size, at }
};

function show(id) {
  ['e-room', 'e-wait', 'e-form', 'e-me'].forEach(s => { $(s).hidden = s !== id; });
}

function send(msg) {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
}

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/judge-ws`);
  state.ws = ws;
  $('v-conn').dataset.status = 'connecting';
  ws.onopen = () => {
    state.retry = 0;
    $('v-conn').dataset.status = 'online';
    if (state.room) send({ t: 'ent-join', room: state.room, deviceId: state.deviceId });
  };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handle(msg);
  };
  ws.onclose = () => {
    $('v-conn').dataset.status = 'offline';
    state.retry++;
    setTimeout(connect, Math.min(10000, 800 * state.retry));
  };
}

function handle(msg) {
  if (msg.t === 'error') {
    if (msg.code === 'no-room') {
      show('e-room');
      $('e-room-error').hidden = false;
      $('e-room-error').textContent = 'No battle with that code right now — check the screen.';
    } else if (msg.code === 'closed') {
      $('e-form-error').hidden = false;
      $('e-form-error').textContent = 'Sign-ups just closed. Ask the host.';
    } else if (msg.code === 'name') {
      $('e-form-error').hidden = false;
      $('e-form-error').textContent = 'Enter your producer name.';
    }
    return;
  }
  if (msg.t === 'ent-joined') {
    history.replaceState(null, '', `?room=${state.room}`);
    state.config = msg.config;
    state.me = msg.me;
    render();
  }
  if (msg.t === 'signup-config') { state.config = msg.config; render(); }
  if (msg.t === 'ent-registered') { state.me = msg.me; state.editing = false; render(); }
  if (msg.t === 'ent-status') { state.status = msg; render(); }
}

function render() {
  const c = state.config || {};
  $('e-event').textContent = c.eventName ? `${c.eventName}` : 'Tonight\'s battle';
  if (c.eventName) $('e-brand').textContent = c.eventName.toUpperCase();
  if (!state.me || state.editing) {
    show('e-form');
    const canSign = c.open || state.me;
    $('e-closed').hidden = !!canSign;
    $('e-form-fields').hidden = !canSign;
    if (state.me) { $('e-name').value = state.me.name; $('e-social').value = state.me.social || ''; }
    return;
  }
  show('e-me');
  $('e-me-name').textContent = state.me.name;
  const st = state.status?.status || 'registered';
  const label = { registered: 'Signed up', waitlist: `Waitlist${state.status?.waitPos ? ` #${state.status.waitPos}` : ''}`, 'checked-in': '✓ Checked in', drawn: '🎲 Drawn', out: 'Not on the list' }[st];
  $('e-status').textContent = label;
  $('e-status').dataset.status = st;
  $('e-status-text').textContent = state.status?.text || 'You\'re on the list. Check in with the host when you arrive.';
  $('e-uploads').hidden = !c.uploads || st === 'out';
  renderRounds();
}

function renderRounds() {
  const host = $('e-rounds');
  const rounds = state.config?.rounds || 3;
  host.innerHTML = Array.from({ length: rounds }, (_, i) => i + 1).map(r => {
    const up = state.uploads[r];
    return `<div class="e-round" data-round="${r}">
      <span class="e-round-label">${ROUND_NAMES[r] || `Round ${r}`}</span>
      <span class="e-round-state ${up ? 'done' : ''}">${up ? `✓ Sent (${(up.size / 1048576).toFixed(1)} MB)` : 'No beat yet'}</span>
      <label class="e-pick">${up ? 'Replace' : 'Upload'}<input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" hidden /></label>
      <div class="e-progress" hidden><i></i></div>
    </div>`;
  }).join('');
  host.querySelectorAll('input[type=file]').forEach(inp => inp.addEventListener('change', () => {
    const file = inp.files[0];
    if (file) upload(Number(inp.closest('[data-round]').dataset.round), file, inp.closest('.e-round'));
  }));
}

function upload(round, file, row) {
  if (file.size > 80 * 1024 * 1024) { alert('That file is over 80 MB.'); return; }
  const bar = row.querySelector('.e-progress');
  const fill = bar.querySelector('i');
  const stateEl = row.querySelector('.e-round-state');
  bar.hidden = false;
  stateEl.textContent = 'Uploading…';
  stateEl.classList.remove('done');
  const xhr = new XMLHttpRequest();
  const q = new URLSearchParams({ room: state.room, device: state.deviceId, round: String(round), name: file.name });
  xhr.open('POST', `/api/beats/upload?${q}`);
  xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) fill.style.width = `${Math.round((e.loaded / e.total) * 100)}%`; };
  xhr.onload = () => {
    let res = {};
    try { res = JSON.parse(xhr.responseText); } catch { /* ignore */ }
    if (xhr.status === 200) {
      state.uploads[round] = { size: file.size, at: Date.now() };
      navigator.vibrate?.(40);
      renderRounds();
    } else {
      bar.hidden = true;
      stateEl.textContent = res.error || 'Upload failed — try again';
    }
  };
  xhr.onerror = () => { bar.hidden = true; stateEl.textContent = 'Upload failed — check the Wi-Fi'; };
  xhr.send(file);
}

async function loadMine() {
  try {
    const res = await fetch(`/api/beats/mine?room=${state.room}&device=${encodeURIComponent(state.deviceId)}`, { cache: 'no-store' });
    if (!res.ok) return;
    (await res.json()).forEach(b => { state.uploads[b.round] = { size: b.size, at: b.at }; });
    if (!$('e-me').hidden) renderRounds();
  } catch { /* offline */ }
}

$('e-room-go').addEventListener('click', () => {
  const room = $('e-room-code').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(room)) { $('e-room-error').hidden = false; $('e-room-error').textContent = 'Enter the code from the screen.'; return; }
  state.room = room;
  show('e-wait');
  send({ t: 'ent-join', room, deviceId: state.deviceId });
});

$('e-register').addEventListener('click', () => {
  const name = $('e-name').value.trim();
  if (!name) { $('e-form-error').hidden = false; $('e-form-error').textContent = 'Enter your producer name.'; return; }
  $('e-form-error').hidden = true;
  send({ t: 'ent-register', name, social: $('e-social').value.trim() });
  setTimeout(loadMine, 600);
});

$('e-edit').addEventListener('click', () => { state.editing = true; render(); });

if (state.room) { show('e-wait'); setTimeout(loadMine, 1200); } else show('e-room');
connect();
