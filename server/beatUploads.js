/**
 * Beat uploads from producers' phones (entry.html), saved on the host machine.
 *
 *   POST /api/beats/upload?room=&device=&round=&name=   raw audio body (a registered producer of the room)
 *   GET  /api/beats/mine?room=&device=                  that producer's uploads (no file names leak back)
 *   GET  /api/beats/list?room=                          (host machine only) every upload in the room
 *   GET  /api/beats/file/<ROOM>/<device>/<file>         (host machine only) the audio, with Range support
 *
 * Files are stored as data/beats/<ROOM>/<device>/<round>.<ext> — the original
 * file name is kept only in the sidecar JSON the host sees, so beats stay anonymous.
 */
import fs from 'fs';
import path from 'path';

const MAX_BEAT = 80 * 1024 * 1024;
const EXT = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;
const TYPES = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac' };

function isLocal(req) {
  const a = req.socket?.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const safeRoom = (r) => (/^[A-Z0-9]{4,8}$/.test(String(r || '').toUpperCase()) ? String(r).toUpperCase() : null);
const safeDevice = (d) => (/^[\w-]{6,64}$/.test(String(d || '')) ? String(d) : null);

function listDevice(dir, deviceId, roomCode) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      return { ...meta, deviceId, url: `/api/beats/file/${roomCode}/${deviceId}/${meta.file}` };
    } catch {
      return null;
    }
  }).filter(Boolean).sort((a, b) => a.round - b.round);
}

function beatUploadsMiddleware(dataDir, rooms) {
  const base = path.join(dataDir, 'beats');
  return (req, res, next) => {
    const [url, qs] = (req.url || '').split('?');
    if (!url.startsWith('/api/beats/')) return next();
    const q = new URLSearchParams(qs || '');
    try {
      if (url === '/api/beats/upload' && req.method === 'POST') {
        const room = safeRoom(q.get('room'));
        const device = safeDevice(q.get('device'));
        const round = Math.max(1, Math.min(4, Number(q.get('round')) || 1));
        const original = String(q.get('name') || 'beat.mp3').slice(0, 120);
        const ext = (original.match(EXT)?.[1] || '').toLowerCase();
        if (!room || !device) return send(res, 400, { error: 'room / device?' });
        const entrant = rooms?.entrant(room, device);
        if (!entrant) return send(res, 403, { error: 'Sign up for the battle first' });
        if (!ext) return send(res, 415, { error: 'Send an MP3, WAV, M4A, AAC, OGG or FLAC file' });
        const len = Number(req.headers['content-length'] || 0);
        if (len > MAX_BEAT) return send(res, 413, { error: 'That file is over 80 MB' });
        const dir = path.join(base, room, device);
        fs.mkdirSync(dir, { recursive: true });
        // one beat per round: replace any earlier upload
        fs.readdirSync(dir).filter(f => f.startsWith(`${round}.`)).forEach(f => fs.rmSync(path.join(dir, f), { force: true }));
        const file = `${round}.${ext}`;
        const tmp = path.join(dir, `.${file}.part`);
        const out = fs.createWriteStream(tmp);
        let size = 0;
        let failed = false;
        req.on('data', (c) => {
          size += c.length;
          if (size > MAX_BEAT && !failed) {
            failed = true;
            out.destroy();
            fs.rmSync(tmp, { force: true });
            send(res, 413, { error: 'That file is over 80 MB' });
            req.destroy();
          }
        });
        req.pipe(out);
        out.on('finish', () => {
          if (failed) return;
          if (size < 1024) { fs.rmSync(tmp, { force: true }); return send(res, 400, { error: 'That file is empty' }); }
          fs.renameSync(tmp, path.join(dir, file));
          const meta = { round, file, size, originalName: original, producer: entrant.name, at: new Date().toISOString() };
          fs.writeFileSync(path.join(dir, `${round}.json`), JSON.stringify(meta));
          rooms.notifyHost(room, { t: 'beat-uploaded', deviceId: device, beat: { ...meta, deviceId: device, url: `/api/beats/file/${room}/${device}/${file}` } });
          send(res, 200, { ok: true, round, size });
        });
        out.on('error', () => { if (!failed) send(res, 500, { error: 'Could not save the file' }); });
        return undefined;
      }
      if (url === '/api/beats/mine') {
        const room = safeRoom(q.get('room'));
        const device = safeDevice(q.get('device'));
        if (!room || !device || !rooms?.entrant(room, device)) return send(res, 403, { error: 'not signed up' });
        return send(res, 200, listDevice(path.join(base, room, device), device, room).map(b => ({ round: b.round, size: b.size, at: b.at })));
      }
      if (!isLocal(req)) return send(res, 403, { error: 'host machine only' });
      if (url === '/api/beats/list') {
        const room = safeRoom(q.get('room'));
        if (!room) return send(res, 400, { error: 'room?' });
        const roomDir = path.join(base, room);
        if (!fs.existsSync(roomDir)) return send(res, 200, []);
        const all = fs.readdirSync(roomDir).flatMap(d => (safeDevice(d) ? listDevice(path.join(roomDir, d), d, room) : []));
        return send(res, 200, all);
      }
      const m = url.match(/^\/api\/beats\/file\/([A-Z0-9]{4,8})\/([\w-]{6,64})\/([1-4]\.(mp3|wav|m4a|aac|ogg|flac))$/i);
      if (m) {
        const file = path.join(base, m[1].toUpperCase(), m[2], m[3]);
        if (!fs.existsSync(file)) return send(res, 404, { error: 'not found' });
        const stat = fs.statSync(file);
        const type = TYPES[m[4].toLowerCase()] || 'application/octet-stream';
        const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
        if (range) {
          const start = range[1] ? Number(range[1]) : 0;
          const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
          res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
          fs.createReadStream(file, { start, end }).pipe(res);
        } else {
          res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
          fs.createReadStream(file).pipe(res);
        }
        return undefined;
      }
      return send(res, 404, { error: 'unknown' });
    } catch (e) {
      return send(res, 500, { error: String(e.message || e) });
    }
  };
}

export { beatUploadsMiddleware };
