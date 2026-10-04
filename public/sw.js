/**
 * Offline mode for the built app (npm start). Everything runs on the host
 * computer, so the only things a venue without internet would miss are the
 * web fonts and anything not yet loaded — this keeps all of it cached:
 *  - pages: network first (fresh when the server is up), cache when not
 *  - built assets, 3D models, sounds, icons: cache first, filled on first use
 *  - Google Fonts: served from cache, refreshed in the background
 * Live data (/api, the judge hub socket, /league, /judge-info) is never cached.
 */
const VERSION = 'wwts-v1';
const SHELL = ['/', '/index.html', '/judge.html', '/vote.html', '/entry.html', '/cohost.html', '/overlay.html', '/broadcast.html', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL).catch(() => { /* some pages may be missing */ })).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const LIVE = /^\/(api\/|judge-ws|judge-info|league)/;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && LIVE.test(url.pathname)) return;
  if (req.headers.has('range')) return;   // audio seeking: straight to the network

  // pages: network first
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('/index.html'))));
    return;
  }

  // fonts from Google: stale-while-revalidate
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(res => { c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  // our own static files: cache first
  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok && res.status === 200) {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
      }
      return res;
    })));
  }
});
