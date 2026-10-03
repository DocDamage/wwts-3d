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
 *   hub   → host  { t:'judge-join' | 'judge-left' | 'judge-scores', deviceId, ... }
 *   hub   → judge { t:'joined' } then { t:'state', state }, or { t:'error', code }
 */

import os from 'os';
import { WebSocketServer } from 'ws';

const PATH = '/judge-ws';

/** Room bookkeeping, independent of sockets so it can be unit-tested */
class JudgeRooms {
  constructor() {
    this.rooms = new Map(); // code -> { token, host, state, judges: Map(deviceId -> { send, name }) }
  }

  claimHost(room, token, send) {
    const code = String(room || '').toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(code) || !token) return { ok: false, code: 'bad-room' };
    let r = this.rooms.get(code);
    if (r && r.token !== token) return { ok: false, code: 'room-taken' };
    if (!r) {
      r = { token, host: null, state: null, judges: new Map() };
      this.rooms.set(code, r);
    }
    r.host = send;
    // Tell the (re)connected host who is already here
    r.judges.forEach((j, deviceId) => send({ t: 'judge-join', deviceId, name: j.name }));
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
    const clean = (arr) => (Array.isArray(arr) ? arr.slice(0, 20).map(v => (v === null ? null : Math.max(0, Math.min(10, Number(v) || 0)))) : []);
    r.host?.({
      t: 'judge-scores',
      deviceId,
      round: Number(payload.round) || 1,
      battleId: payload.battleId || null,
      scores1: clean(payload.scores1),
      scores2: clean(payload.scores2),
      submitted: !!payload.submitted
    });
    return true;
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
      } else if (role === 'host' && msg.t === 'state') {
        rooms.setState(room, msg.state);
      } else if (role === 'host' && msg.t === 'to-judge') {
        rooms.toJudge(room, msg.deviceId, msg.msg);
      } else if (role === 'judge' && msg.t === 'scores') {
        rooms.judgeScores(room, deviceId, msg);
      } else if (msg.t === 'ping') {
        send({ t: 'pong' });
      }
    });

    ws.on('close', () => {
      if (role === 'judge') rooms.leave(room, deviceId);
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
