/**
 * Co-host tablet (cohost.html): decks, timer, battle flow, crowd vote and stage
 * effects, driving the host screen through the local hub. Needs the room code
 * and the host's PIN; the host can sign a tablet out at any time.
 */
const $ = (id) => document.getElementById(id);
const KEY = 'wwts_cohost_device';
const SAVED = 'wwts_cohost_join';

const state = {
  room: (new URLSearchParams(location.search).get('room') || '').toUpperCase(),
  pin: '',
  deviceId: (() => {
    try {
      let id = localStorage.getItem(KEY);
      if (!id) { id = `co-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`; localStorage.setItem(KEY, id); }
      return id;
    } catch {
      return `co-${Math.random().toString(36).slice(2)}`;
    }
  })(),
  ws: null,
  ok: false,
  want: false,
  retry: 0,
  st: null
};

try {
  const saved = JSON.parse(localStorage.getItem(SAVED) || 'null');
  if (saved && (!state.room || saved.room === state.room)) { state.room = saved.room; state.pin = saved.pin; }
} catch { /* ignore */ }

function show(id) { ['c-join', 'c-wait', 'c-panel'].forEach(s => { $(s).hidden = s !== id; }); }

function send(msg) { if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg)); }

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/judge-ws`);
  state.ws = ws;
  $('c-conn').dataset.status = 'connecting';
  ws.onopen = () => {
    state.retry = 0;
    $('c-conn').dataset.status = 'online';
    if (state.want) join();
  };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handle(msg);
  };
  ws.onclose = () => {
    state.ok = false;
    $('c-conn').dataset.status = 'offline';
    state.retry++;
    setTimeout(connect, Math.min(8000, 700 * state.retry));
  };
}

function join() {
  send({ t: 'co-join', room: state.room, deviceId: state.deviceId, pin: state.pin });
  show('c-wait');
  $('c-wait-text').textContent = 'Asking the host screen…';
}

function handle(msg) {
  if (msg.t === 'error') {
    show('c-join');
    $('c-error').hidden = false;
    $('c-error').textContent = msg.code === 'no-room' ? 'That room isn\'t open — check the host screen.' : 'Could not connect.';
  } else if (msg.t === 'co-ok') {
    state.ok = true;
    try { localStorage.setItem(SAVED, JSON.stringify({ room: state.room, pin: state.pin })); } catch { /* ignore */ }
    history.replaceState(null, '', `?room=${state.room}`);
    show('c-panel');
  } else if (msg.t === 'co-denied') {
    state.ok = false;
    state.want = false;
    try { localStorage.removeItem(SAVED); } catch { /* ignore */ }
    show('c-join');
    $('c-error').hidden = false;
    $('c-error').textContent = msg.reason || 'The host said no.';
  } else if (msg.t === 'co-state') {
    state.st = msg.state;
    render();
  }
}

function render() {
  const s = state.st;
  if (!s || !state.ok) return;
  $('c-round').textContent = s.roundTitle || '';
  $('c-n1').textContent = s.names?.[1] || '—';
  $('c-n2').textContent = s.names?.[2] || '—';
  $('c-flow').textContent = s.flowLabel || '▶';
  $('c-flow').disabled = !!s.flowDisabled;
  $('c-time').textContent = s.timer || '';
  $('c-time').classList.toggle('crit', !!s.timerCritical);
  [1, 2].forEach(n => {
    const d = s.decks?.[n] || {};
    $(`c-t${n}`).textContent = d.loaded ? d.title : 'Nothing loaded';
    $(`c-p${n}`).style.width = d.duration ? `${Math.min(100, (d.time / d.duration) * 100)}%` : '0%';
    $(`c-play${n}`).textContent = d.playing ? '⏸ Pause' : '▶ Play';
    $(`c-play${n}`).classList.toggle('on', !!d.playing);
    $(`c-play${n}`).disabled = !d.loaded;
    const vol = document.querySelector(`[data-range="deck${n}.volume"]`);
    if (vol && document.activeElement !== vol && typeof d.volume === 'number') vol.value = d.volume;
  });
  const xf = document.querySelector('[data-range="mix.crossfade"]');
  if (xf && document.activeElement !== xf && typeof s.crossfade === 'number') xf.value = s.crossfade;
  $('c-next').textContent = s.nextUp ? `Next up: ${s.nextUp.c1} vs ${s.nextUp.c2}${s.delay ? ` · ${s.delay}` : ''}` : '';
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || !state.ok) return;
  send({ t: 'co-cmd', action: b.dataset.act });
  navigator.vibrate?.(15);
});

let rangeTimer = null;
document.addEventListener('input', (e) => {
  const r = e.target.closest('[data-range]');
  if (!r || !state.ok) return;
  clearTimeout(rangeTimer);
  rangeTimer = setTimeout(() => send({ t: 'co-cmd', action: r.dataset.range, arg: r.value }), 40);
});

$('c-go').addEventListener('click', () => {
  const room = $('c-room').value.trim().toUpperCase();
  const pin = $('c-pin').value.trim();
  if (!/^[A-Z0-9]{4,8}$/.test(room)) { $('c-error').hidden = false; $('c-error').textContent = 'Enter the room code.'; return; }
  if (!/^\d{4}$/.test(pin)) { $('c-error').hidden = false; $('c-error').textContent = 'Enter the 4-digit PIN.'; return; }
  $('c-error').hidden = true;
  state.room = room;
  state.pin = pin;
  state.want = true;
  join();
});

$('c-room').value = state.room;
$('c-pin').value = state.pin;
if (state.room && state.pin) state.want = true;
show(state.want ? 'c-wait' : 'c-join');
connect();
