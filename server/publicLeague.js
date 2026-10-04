/**
 * Live public league page on the venue Wi-Fi.
 *   POST /api/public        (host machine only) the latest page data from the host screen
 *   GET  /api/public/data   page data (anyone on the network)
 *   GET  /league            the page itself (refreshes every 15 s)
 * The data is kept in data/public.json so the page survives a server restart.
 */
import fs from 'fs';
import path from 'path';
import { renderPublicPage } from '../src/js/publicPage.js';

function isLocal(req) {
  const a = req.socket?.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function publicLeagueMiddleware(dataDir) {
  const file = path.join(dataDir, 'public.json');
  let cache = null;
  const load = () => {
    if (cache) return cache;
    try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { cache = null; }
    return cache;
  };
  return (req, res, next) => {
    const url = (req.url || '').split('?')[0];
    if (url === '/league' || url === '/league/') {
      const data = load();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(data ? renderPublicPage(data, { live: true }) : '<!doctype html><meta name="viewport" content="width=device-width"><p style="font-family:system-ui;padding:24px">The league page is not published yet. On the host screen: Tools → Public league page → Publish on Wi-Fi.</p>');
    }
    if (url === '/api/public/data') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(load() || {}));
    }
    if (url === '/api/public' && req.method === 'POST') {
      if (!isLocal(req)) { res.writeHead(403); return res.end(); }
      let body = '';
      req.on('data', c => { body += c; if (body.length > 4e6) req.destroy(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data?.league) throw new Error('no league');
          fs.mkdirSync(dataDir, { recursive: true });
          fs.writeFileSync(file, JSON.stringify(data));
          cache = data;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(e.message || e) }));
        }
      });
      return undefined;
    }
    return next();
  };
}

export { publicLeagueMiddleware };
