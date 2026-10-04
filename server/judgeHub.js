/**
 * Judge Hub — tiny local relay so judges can score from their own phones.
 *
 * Runs inside the Vite dev/preview server (see vite.config.js) or server/start.js.
 * Nothing leaves the local network: the host screen and the judges' phones all
 * talk to this process over WebSockets at /judge-ws.
 *
 * Protocol (JSON messages, field `t` = type):
 *   host  → hub   { t:'host', room, token }               claim a room (token lets a reload reclaim it)
 *   host  → hub   { t:'state', state }                     battle state, relayed to every judge
 *   host  → hub   { t:'to-judge', deviceId, msg }          message for one judge (seat, kick…)
 *   judge → hub   { t:'join', room, deviceId, name }
 *   judge → hub   { t:'scores', round, scores1, scores2, submitted }
 *   judge → hub   { t:'note', text, contestant, visibility }      (lands in the host's notepad)
 *   hub   → host  { t:'judge-join' | 'judge-left' | 'judge-scores', deviceId, ... }
 *   hub   → judge { t:'joined' } then { t:'state', state }, or { t:'error', code }
 *
 * Audience (vote.html — anyone on the Wi-Fi with the room code):
 *   aud   → hub   { t:'aud-join', room, deviceId }
 *   aud   → hub   { t:'vote', pollId, choice }            one vote per phone per poll (can change it)
 *   aud   → hub   { t:'aud-hype' }                         🔥 taps (throttled), feed the crowd meter
 *   host  → hub   { t:'poll', poll }                       { id, open, options:[a,b], title, showResults }
 *   hub   → host  { t:'vote-tally', pollId, counts:[a,b], voters } · { t:'aud-count', n } · { t:'aud-hype', n }
 *   hub   → aud   { t:'aud-joined' } · { t:'poll', poll, myVote, counts? }
 *
 * Stream overlays (overlay.html in OBS browser sources):
 *   ov    → hub   { t:'ov-join', room }
 *   host  → hub   { t:'overlay', state }                  relayed to every overlay in the room
 *   hub   → ov    { t:'overlay', state }
 *
 * Producers (entry.html — sign up for an open battle, see their draw, upload beats):
 *   ent   → hub   { t:'ent-join', room, deviceId } · { t:'ent-register', name, social }
 *   host  → hub   { t:'signup-config', config } · { t:'to-entrant', deviceId, msg }
 *   hub   → host  { t:'signup', deviceId, name, social, at } · { t:'beat-uploaded', deviceId, beat }
 *   hub   → ent   { t:'ent-joined', config, me } · whatever the host sends (status, draw…)
 *
 * Co-host tablet (cohost.html): joins with the PIN shown on the host screen
 *   co    → hub   { t:'co-join', room, deviceId, pin } · { t:'co-cmd', action, arg }
 *   host  → hub   { t:'to-cohost', deviceId, msg } · { t:'cohost-state', state }
 *   hub   → host  { t:'cohost-join', deviceId, pin } · { t:'cohost-cmd', deviceId, action, arg }
 *
 * Prediction game (vote.html): audience predicts the winner before the reveal
 *   host  → hub   { t:'pred', pred } · { t:'pred-resolve', predId, winner }
 *   aud   → hub   { t:'aud-name', name } · { t:'predict', predId, choice }
 *   hub   → host  { t:'pred-tally', predId, counts } · { t:'pred-board', board }
 *   hub   → aud   { t:'pred', pred, myPick } · { t:'pred-board', board, me }
 */

import os from 'os';
import { WebSocketServer } from 'ws';

const PATH = '/judge-ws';

const cleanScores = (arr) => (Array.isArray(arr) ? arr.slice(0, 20).map(v => (v === null ? null : Math.max(0, Math.min(10, Number(v) || 0)))) : []);
const cleanComments = (arr) => (Array.isArray(arr) ? arr.slice(0, 20).map(v => String(v ?? '').trim().slice(0, 140)) : []);

/** Room bookkeeping, independent of sockets so it can be unit-tested */
class JudgeRooms {
  constructor() {
    this.rooms = new Map(); // code -> { token, host, state, judges: Map(deviceId -> { send, name }), audience, poll }
  }

  claimHost(room, token, send) {
    const code = String(room || '').toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(code) || !token) return { ok: false, code: 'bad-room' };
    let r = this.rooms.get(code);
    if (r && r.token !== token) return { ok: false, code: 'room-taken' };
    if (!r) {
      r = {
        token, host: null, state: null, judges: new Map(), audience: new Map(), poll: null, overlays: new Set(), overlay: null,
        signup: { open: false, capacity: 0, eventName: '' }, entrants: new Map(),
        cohosts: new Map(), cohostState: null,
        pred: null, predPicks: new Map(), nicks: new Map(), points: new Map()
      };
      this.rooms.set(code, r);
    }
    r.host = send;
    if (r.audience.size) send({ t: 'aud-count', n: r.audience.size });
    if (r.poll) send({ t: 'vote-tally', pollId: r.poll.id, counts: this.tally(r), voters: r.poll.votes.size });
    // Tell the (re)connected host who is already here
    r.judges.forEach((j, deviceId) => send({ t: 'judge-join', deviceId, name: j.name }));
    r.entrants.forEach((e, deviceId) => { if (e.name) send({ t: 'signup', deviceId, name: e.name, social: e.social, at: e.at }); });
    r.cohosts.forEach((c, deviceId) => send({ t: 'cohost-join', deviceId, pin: c.pin }));
    return { ok: true, room: code };
  }

  setState(room, state) {
    const r = this.rooms.get(room);
    if (!r) return 0;
    r.state = state;
    r.judges.forEach(j => j.send({ t: 'state', state }));
    return r.judges.size;
  }

  toJudge(room, deviceId, msg) {
    const j = this.rooms.get(room)?.judges.get(deviceId);
    if (j) j.send(msg);
    return !!j;
  }

  joinJudge(room, deviceId, name, send) {
    const code = String(room || '').toUpperCase();
    const r = this.rooms.get(code);
    if (!r) return { ok: false, code: 'no-room' };
    if (!deviceId) return { ok: false, code: 'bad-device' };
    const cleanName = String(name || 'Judge').trim().slice(0, 24) || 'Judge';
    r.judges.set(deviceId, { send, name: cleanName });
    send({ t: 'joined', room: code });
    if (r.state) send({ t: 'state', state: r.state });
    r.host?.({ t: 'judge-join', deviceId, name: cleanName });
    return { ok: true, room: code };
  }

  judgeScores(room, deviceId, payload) {
    const r = this.rooms.get(room);
    if (!r || !r.judges.has(deviceId)) return false;
    const out = {
      t: 'judge-scores',
      deviceId,
      round: Number(payload.round) || 1,
      battleId: payload.battleId || null,
      scores1: cleanScores(payload.scores1),
      scores2: cleanScores(payload.scores2),
      submitted: !!payload.submitted
    };
    if (Array.isArray(payload.cards)) out.cards = payload.cards.slice(0, 6).map(cleanScores);   // 3/4-way battles
    if (payload.comments1 || payload.comments2) {
      out.comments1 = cleanComments(payload.comments1);
      out.comments2 = cleanComments(payload.comments2);
    }
    if (Array.isArray(payload.commentsN)) out.commentsN = payload.commentsN.slice(0, 6).map(cleanComments);
    if (payload.overall) out.overall = String(payload.overall).trim().slice(0, 280);
    r.host?.(out);
    return true;
  }

  /** Calibration card: one reference beat, every judge scores it */
  judgeCalibration(room, deviceId, payload) {
    const r = this.rooms.get(room);
    if (!r || !r.judges.has(deviceId)) return false;
    r.host?.({ t: 'judge-cal', deviceId, calId: String(payload.calId || '').slice(0, 40), scores: cleanScores(payload.scores) });
    return true;
  }

  judgeNote(room, deviceId, payload) {
    const r = this.rooms.get(room);
    if (!r || !r.judges.has(deviceId)) return false;
    const text = String(payload.text || '').trim().slice(0, 280);
    if (!text) return false;
    r.host?.({
      t: 'judge-note',
      deviceId,
      text,
      contestant: payload.contestant === 1 || payload.contestant === 2 ? payload.contestant : null,
      visibility: payload.visibility === 'public' ? 'public' : 'private'
    });
    return true;
  }

  /* ---- audience ---- */

  tally(r) {
    const counts = [0, 0];
    r.poll?.votes.forEach(c => { if (c === 1 || c === 2) counts[c - 1]++; });
    return counts;
  }

  pollFor(r, deviceId) {
    if (!r.poll) return { t: 'poll', poll: null };
    const { id, open, options, title, showResults } = r.poll;
    const msg = { t: 'poll', poll: { id, open, options, title, showResults }, myVote: r.poll.votes.get(deviceId) || null };
    if (showResults || !open) msg.counts = this.tally(r);
    return msg;
  }

  joinAudience(room, deviceId, send) {
    const code = String(room || '').toUpperCase();
    const r = this.rooms.get(code);
    if (!r) return { ok: false, code: 'no-room' };
    if (!deviceId || String(deviceId).length > 64) return { ok: false, code: 'bad-device' };
    r.audience.set(deviceId, { send, lastHype: 0 });
    send({ t: 'aud-joined', room: code });
    send(this.pollFor(r, deviceId));
    if (r.pred) send(this.predFor(r, deviceId));
    if (r.points.size) send({ t: 'pred-board', board: this.board(r), me: r.points.get(deviceId) || 0 });
    r.host?.({ t: 'aud-count', n: r.audience.size });
    return { ok: true, room: code };
  }

  setPoll(room, poll) {
    const r = this.rooms.get(room);
    if (!r || !poll) return;
    const id = String(poll.id || '').slice(0, 40);
    const fresh = !r.poll || r.poll.id !== id;
    r.poll = {
      id,
      open: !!poll.open,
      options: (poll.options || []).slice(0, 2).map(o => String(o).slice(0, 30)),
      title: String(poll.title || 'Who won?').slice(0, 60),
      showResults: !!poll.showResults,
      votes: fresh ? new Map() : r.poll.votes
    };
    r.audience.forEach((a, deviceId) => a.send(this.pollFor(r, deviceId)));
    r.host?.({ t: 'vote-tally', pollId: id, counts: this.tally(r), voters: r.poll.votes.size });
  }

  vote(room, deviceId, pollId, choice) {
    const r = this.rooms.get(room);
    if (!r?.poll || !r.poll.open || r.poll.id !== pollId || !r.audience.has(deviceId)) return false;
    if (choice !== 1 && choice !== 2) return false;
    r.poll.votes.set(deviceId, choice);
    const counts = this.tally(r);
    r.host?.({ t: 'vote-tally', pollId, counts, voters: r.poll.votes.size });
    if (r.poll.showResults) r.audience.forEach((a, id) => a.send(this.pollFor(r, id)));
    else r.audience.get(deviceId)?.send(this.pollFor(r, deviceId));
    return true;
  }

  hype(room, deviceId) {
    const r = this.rooms.get(room);
    const a = r?.audience.get(deviceId);
    if (!a) return false;
    const now = Date.now();
    if (now - a.lastHype < 700) return false;   // one tap counts per 0.7 s per phone
    a.lastHype = now;
    r.host?.({ t: 'aud-hype', n: 1 });
    return true;
  }

  /* ---- producers: sign-up, check-in, beat uploads ---- */

  setSignup(room, config) {
    const r = this.rooms.get(room);
    if (!r || !config) return;
    r.signup = {
      open: !!config.open,
      capacity: Math.max(0, Math.min(512, Number(config.capacity) || 0)),
      eventName: String(config.eventName || '').slice(0, 60),
      uploads: !!config.uploads,
      rounds: Math.max(1, Math.min(4, Number(config.rounds) || 3))
    };
    r.entrants.forEach(e => e.send?.({ t: 'signup-config', config: r.signup }));
  }

  joinEntrant(room, deviceId, send) {
    const code = String(room || '').toUpperCase();
    const r = this.rooms.get(code);
    if (!r) return { ok: false, code: 'no-room' };
    if (!deviceId || String(deviceId).length > 64) return { ok: false, code: 'bad-device' };
    const e = r.entrants.get(deviceId) || { name: '', social: '', at: null, last: null };
    e.send = send;
    r.entrants.set(deviceId, e);
    send({ t: 'ent-joined', room: code, config: r.signup, me: e.name ? { name: e.name, social: e.social } : null });
    if (e.last) send(e.last);   // their latest status from the host
    return { ok: true, room: code };
  }

  registerEntrant(room, deviceId, payload) {
    const r = this.rooms.get(room);
    const e = r?.entrants.get(deviceId);
    if (!e) return { ok: false, code: 'not-joined' };
    const name = String(payload?.name || '').trim().slice(0, 32);
    if (!name) return { ok: false, code: 'name' };
    if (!e.name && !r.signup.open) return { ok: false, code: 'closed' };
    e.name = name;
    e.social = String(payload?.social || '').trim().slice(0, 60);
    e.at = e.at || Date.now();
    r.host?.({ t: 'signup', deviceId, name: e.name, social: e.social, at: e.at });
    e.send?.({ t: 'ent-registered', me: { name: e.name, social: e.social } });
    return { ok: true };
  }

  toEntrant(room, deviceId, msg) {
    const e = this.rooms.get(room)?.entrants.get(deviceId);
    if (!e) return false;
    if (msg && typeof msg === 'object' && msg.t === 'ent-status') e.last = msg;   // replayed on reconnect
    e.send?.(msg);
    return true;
  }

  /** A registered producer of this room (beat uploads check this) */
  entrant(room, deviceId) {
    const e = this.rooms.get(String(room || '').toUpperCase())?.entrants.get(deviceId);
    return e && e.name ? e : null;
  }

  notifyHost(room, msg) {
    const r = this.rooms.get(String(room || '').toUpperCase());
    if (!r?.host) return false;
    r.host(msg);
    return true;
  }

  leaveEntrant(room, deviceId) {
    const e = this.rooms.get(room)?.entrants.get(deviceId);
    if (e) e.send = null;
  }

  /* ---- co-host tablet ---- */

  joinCohost(room, deviceId, pin, send) {
    const code = String(room || '').toUpperCase();
    const r = this.rooms.get(code);
    if (!r) return { ok: false, code: 'no-room' };
    if (!deviceId || String(deviceId).length > 64) return { ok: false, code: 'bad-device' };
    const cleanPin = String(pin || '').replace(/\D/g, '').slice(0, 8);
    r.cohosts.set(deviceId, { send, pin: cleanPin, ok: false });
    send({ t: 'co-waiting', room: code });
    r.host?.({ t: 'cohost-join', deviceId, pin: cleanPin });
    return { ok: true, room: code };
  }

  toCohost(room, deviceId, msg) {
    const c = this.rooms.get(room)?.cohosts.get(deviceId);
    if (!c) return false;
    if (msg?.t === 'co-ok') c.ok = true;
    if (msg?.t === 'co-denied') c.ok = false;
    c.send(msg);
    if (c.ok && msg?.t === 'co-ok' && this.rooms.get(room).cohostState) c.send({ t: 'co-state', state: this.rooms.get(room).cohostState });
    return true;
  }

  setCohostState(room, state) {
    const r = this.rooms.get(room);
    if (!r) return 0;
    r.cohostState = state;
    let n = 0;
    r.cohosts.forEach(c => { if (c.ok) { c.send({ t: 'co-state', state }); n++; } });
    return n;
  }

  cohostCommand(room, deviceId, action, arg) {
    const r = this.rooms.get(room);
    const c = r?.cohosts.get(deviceId);
    if (!c?.ok) return false;   // only tablets the host accepted
    if (!/^[a-z0-9_.:-]{1,40}$/i.test(String(action || ''))) return false;
    r.host?.({ t: 'cohost-cmd', deviceId, action: String(action), arg: arg === undefined || arg === null ? null : String(arg).slice(0, 80) });
    return true;
  }

  leaveCohost(room, deviceId) {
    const r = this.rooms.get(room);
    if (r?.cohosts.delete(deviceId)) r.host?.({ t: 'cohost-left', deviceId });
  }

  /* ---- audience prediction game ---- */

  board(r) {
    return [...r.points.entries()]
      .map(([id, pts]) => ({ name: r.nicks.get(id) || 'Anon', points: pts, id }))
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
      .slice(0, 10)
      .map(({ name, points }) => ({ name, points }));
  }

  predFor(r, deviceId) {
    if (!r.pred) return { t: 'pred', pred: null };
    return { t: 'pred', pred: r.pred, myPick: r.predPicks.get(deviceId) || null, points: r.points.get(deviceId) || 0 };
  }

  setPrediction(room, pred) {
    const r = this.rooms.get(room);
    if (!r || !pred) return;
    const id = String(pred.id || '').slice(0, 40);
    if (!r.pred || r.pred.id !== id) r.predPicks = new Map();
    r.pred = {
      id,
      open: !!pred.open,
      title: String(pred.title || 'Who takes it?').slice(0, 60),
      options: (pred.options || []).slice(0, 2).map(o => String(o).slice(0, 30)),
      result: null
    };
    r.audience.forEach((a, devId) => a.send(this.predFor(r, devId)));
    r.host?.({ t: 'pred-tally', predId: id, counts: this.predCounts(r) });
  }

  predCounts(r) {
    const c = [0, 0];
    r.predPicks.forEach(v => { if (v === 1 || v === 2) c[v - 1]++; });
    return c;
  }

  predict(room, deviceId, predId, choice) {
    const r = this.rooms.get(room);
    if (!r?.pred || !r.pred.open || r.pred.id !== predId || !r.audience.has(deviceId)) return false;
    if (choice !== 1 && choice !== 2) return false;
    r.predPicks.set(deviceId, choice);
    if (!r.points.has(deviceId)) r.points.set(deviceId, 0);
    r.audience.get(deviceId)?.send(this.predFor(r, deviceId));
    r.host?.({ t: 'pred-tally', predId, counts: this.predCounts(r) });
    return true;
  }

  setNick(room, deviceId, name) {
    const r = this.rooms.get(room);
    if (!r || !r.audience.has(deviceId)) return false;
    const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 20);
    if (!clean) return false;
    r.nicks.set(deviceId, clean);
    return true;
  }

  /** The reveal happened: a point to everyone who called it (winner 0 = draw, nobody scores) */
  resolvePrediction(room, predId, winner) {
    const r = this.rooms.get(room);
    if (!r?.pred || r.pred.id !== predId) return null;
    r.pred.open = false;
    r.pred.result = winner === 1 || winner === 2 ? winner : 0;
    r.predPicks.forEach((pick, id) => { if (pick === r.pred.result) r.points.set(id, (r.points.get(id) || 0) + 1); });
    const board = this.board(r);
    r.audience.forEach((a, id) => {
      a.send(this.predFor(r, id));
      a.send({ t: 'pred-board', board, me: r.points.get(id) || 0 });
    });
    r.host?.({ t: 'pred-board', board });
    return board;
  }

  /* ---- stream overlays ---- */

  joinOverlay(room, send) {
    const code = String(room || '').toUpperCase();
    const r = this.rooms.get(code);
    if (!r) return { ok: false, code: 'no-room' };
    r.overlays.add(send);
    send({ t: 'ov-joined', room: code });
    if (r.overlay) send({ t: 'overlay', state: r.overlay });
    return { ok: true, room: code };
  }

  setOverlay(room, state) {
    const r = this.rooms.get(room);
    if (!r) return 0;
    r.overlay = state;
    r.overlays.forEach(send => send({ t: 'overlay', state }));
    return r.overlays.size;
  }

  leaveOverlay(room, send) {
    this.rooms.get(room)?.overlays.delete(send);
  }

  leaveAudience(room, deviceId) {
    const r = this.rooms.get(room);
    if (r?.audience.delete(deviceId)) r.host?.({ t: 'aud-count', n: r.audience.size });
  }

  leave(room, deviceId) {
    const r = this.rooms.get(room);
    if (!r) return;
    if (r.judges.delete(deviceId)) r.host?.({ t: 'judge-left', deviceId });
  }

  hostGone(room, send) {
    const r = this.rooms.get(room);
    if (r && r.host === send) r.host = null;
  }
}

/** Attach the hub to an existing Node HTTP server */
function attachJudgeHub(httpServer) {
  const rooms = new JudgeRooms();
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith(PATH)) return; // leave Vite's HMR socket alone
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    const send = (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    let role = null;
    let room = null;
    let deviceId = null;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.t === 'host') {
        const res = rooms.claimHost(msg.room, msg.token, send);
        if (!res.ok) return send({ t: 'error', code: res.code });
        role = 'host';
        room = res.room;
        send({ t: 'hosting', room });
      } else if (msg.t === 'join') {
        const res = rooms.joinJudge(msg.room, msg.deviceId, msg.name, send);
        if (!res.ok) return send({ t: 'error', code: res.code });
        role = 'judge';
        room = res.room;
        deviceId = msg.deviceId;
      } else if (msg.t === 'aud-join') {
        const res = rooms.joinAudience(msg.room, msg.deviceId, send);
        if (!res.ok) return send({ t: 'error', code: res.code });
        role = 'audience';
        room = res.room;
        deviceId = msg.deviceId;
      } else if (msg.t === 'ent-join') {
        const res = rooms.joinEntrant(msg.room, msg.deviceId, send);
        if (!res.ok) return send({ t: 'error', code: res.code });
        role = 'entrant';
        room = res.room;
        deviceId = msg.deviceId;
      } else if (role === 'entrant' && msg.t === 'ent-register') {
        const res = rooms.registerEntrant(room, deviceId, msg);
        if (!res.ok) send({ t: 'error', code: res.code });
      } else if (msg.t === 'co-join') {
        const res = rooms.joinCohost(msg.room, msg.deviceId, msg.pin, send);
        if (!res.ok) return send({ t: 'error', code: res.code });
        role = 'cohost';
        room = res.room;
        deviceId = msg.deviceId;
      } else if (role === 'cohost' && msg.t === 'co-cmd') {
        rooms.cohostCommand(room, deviceId, msg.action, msg.arg);
      } else if (role === 'audience' && msg.t === 'predict') {
        rooms.predict(room, deviceId, msg.predId, Number(msg.choice));
      } else if (role === 'audience' && msg.t === 'aud-name') {
        rooms.setNick(room, deviceId, msg.name);
      } else if (role === 'audience' && msg.t === 'vote') {
        rooms.vote(room, deviceId, msg.pollId, Number(msg.choice));
      } else if (role === 'audience' && msg.t === 'aud-hype') {
        rooms.hype(room, deviceId);
      } else if (msg.t === 'ov-join') {
        const res = rooms.joinOverlay(msg.room, send);
        if (!res.ok) return send({ t: 'error', code: res.code });
        role = 'overlay';
        room = res.room;
      } else if (role === 'host' && msg.t === 'overlay') {
        rooms.setOverlay(room, msg.state);
      } else if (role === 'host' && msg.t === 'poll') {
        rooms.setPoll(room, msg.poll);
      } else if (role === 'host' && msg.t === 'signup-config') {
        rooms.setSignup(room, msg.config);
      } else if (role === 'host' && msg.t === 'to-entrant') {
        rooms.toEntrant(room, msg.deviceId, msg.msg);
      } else if (role === 'host' && msg.t === 'to-cohost') {
        rooms.toCohost(room, msg.deviceId, msg.msg);
      } else if (role === 'host' && msg.t === 'cohost-state') {
        rooms.setCohostState(room, msg.state);
      } else if (role === 'host' && msg.t === 'pred') {
        rooms.setPrediction(room, msg.pred);
      } else if (role === 'host' && msg.t === 'pred-resolve') {
        rooms.resolvePrediction(room, msg.predId, Number(msg.winner));
      } else if (role === 'host' && msg.t === 'state') {
        rooms.setState(room, msg.state);
      } else if (role === 'host' && msg.t === 'to-judge') {
        rooms.toJudge(room, msg.deviceId, msg.msg);
      } else if (role === 'judge' && msg.t === 'scores') {
        rooms.judgeScores(room, deviceId, msg);
      } else if (role === 'judge' && msg.t === 'note') {
        rooms.judgeNote(room, deviceId, msg);
      } else if (role === 'judge' && msg.t === 'cal-scores') {
        rooms.judgeCalibration(room, deviceId, msg);
      } else if (msg.t === 'ping') {
        send({ t: 'pong' });
      }
    });

    ws.on('close', () => {
      if (role === 'judge') rooms.leave(room, deviceId);
      if (role === 'audience') rooms.leaveAudience(room, deviceId);
      if (role === 'overlay') rooms.leaveOverlay(room, send);
      if (role === 'entrant') rooms.leaveEntrant(room, deviceId);
      if (role === 'cohost') rooms.leaveCohost(room, deviceId);
      if (role === 'host') rooms.hostGone(room, send);
    });
  });

  // Drop dead connections (phones that went to sleep without closing)
  const heartbeat = setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 20000);
  httpServer.on('close', () => clearInterval(heartbeat));

  return { wss, rooms };
}

/** IPv4 LAN addresses phones can reach (skips loopback and link-local) */
function lanAddresses() {
  const out = [];
  Object.entries(os.networkInterfaces()).forEach(([name, list]) => {
    (list || []).forEach(addr => {
      if (addr.family !== 'IPv4' || addr.internal || addr.address.startsWith('169.254.')) return;
      // Virtual adapters (WSL/Hyper-V/VirtualBox) are rarely what a phone can reach
      const virtual = /vethernet|wsl|hyper-v|virtualbox|vmware|docker|loopback/i.test(name);
      out.push({ address: addr.address, name, virtual });
    });
  });
  return out.sort((a, b) => Number(a.virtual) - Number(b.virtual));
}

/** Connect middleware for GET /judge-info → { addresses, port } */
function judgeInfoMiddleware(getPort) {
  return (req, res, next) => {
    if (!req.url || !req.url.startsWith('/judge-info')) return next();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ addresses: lanAddresses(), port: getPort() }));
  };
}

export { JudgeRooms, attachJudgeHub, lanAddresses, judgeInfoMiddleware, PATH as JUDGE_WS_PATH };
