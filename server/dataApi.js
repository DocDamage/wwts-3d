/**
 * Local data API (host machine only): backups saved as JSON files on disk, so a
 * league's data outlives the browser's storage, plus a command relay that lets
 * Stream Deck / Bitfocus Companion trigger app actions over plain HTTP.
 *
 *   GET  /api/backups              list saved backups (newest first)
 *   POST /api/backups              save one (JSON body)
 *   GET  /api/backups/<name>       fetch one
 *   GET  /api/cmd?action=<id>[&arg=]  queue a command for the host page
 *   GET  /api/cmd/poll             (host page) take queued commands
 *
 * Everything is refused unless the request comes from this machine.
 */
import fs from 'fs';
import path from 'path';

const MAX_BODY = 25 * 1024 * 1024;
const KEEP = 60;

function isLocal(req) {
  const a = req.socket?.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function dataApiMiddleware(dataDir) {
  const dir = path.join(dataDir, 'backups');
  const commands = [];
  return async (req, res, next) => {
    const url = (req.url || '').split('?')[0];
    if (!url.startsWith('/api/backups') && !url.startsWith('/api/cmd')) return next();
    if (!isLocal(req)) return send(res, 403, { error: 'host machine only' });
    try {
      if (url === '/api/cmd') {
        const q = new URLSearchParams((req.url || '').split('?')[1] || '');
        const action = q.get('action');
        if (!action || !/^[a-z0-9_.:-]{1,40}$/i.test(action)) return send(res, 400, { error: 'action?' });
        commands.push({ action, arg: q.get('arg') || null, at: Date.now() });
        if (commands.length > 50) commands.shift();
        return send(res, 200, { ok: true });
      }
      if (url === '/api/cmd/poll') {
        const out = commands.splice(0, commands.length).filter(c => Date.now() - c.at < 10000);
        return send(res, 200, out);
      }
      fs.mkdirSync(dir, { recursive: true });
      if (url === '/api/backups' && req.method === 'GET') {
        const list = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
          const st = fs.statSync(path.join(dir, f));
          return { name: f, size: st.size, savedAt: st.mtime.toISOString() };
        }).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
        return send(res, 200, list);
      }
      if (url === '/api/backups' && req.method === 'POST') {
        const body = await readBody(req);
        const parsed = JSON.parse(body);
        if (parsed?.app !== 'wwts' || typeof parsed.data !== 'object') return send(res, 400, { error: 'not a WWTS backup' });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reason = String(parsed.reason || 'manual').replace(/[^a-z0-9-]/gi, '-').slice(0, 24);
        const name = `wwts-${stamp}-${reason}.json`;
        fs.writeFileSync(path.join(dir, name), body);
        // keep the newest KEEP files
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
        files.slice(0, Math.max(0, files.length - KEEP)).forEach(f => fs.rmSync(path.join(dir, f), { force: true }));
        return send(res, 200, { ok: true, name });
      }
      const m = url.match(/^\/api\/backups\/([\w.-]+\.json)$/);
      if (m && req.method === 'GET') {
        const file = path.join(dir, m[1]);
        if (!fs.existsSync(file)) return send(res, 404, { error: 'not found' });
        return send(res, 200, fs.readFileSync(file, 'utf8'));
      }
      return send(res, 404, { error: 'unknown' });
    } catch (e) {
      return send(res, 500, { error: String(e.message || e) });
    }
  };
}

export { dataApiMiddleware };
