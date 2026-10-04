/**
 * Battle-night server: serves the built app (dist/) plus the judge hub.
 *   npm start   → builds, then runs this on port 3000 (or $PORT)
 * Judges join from their phones on the same Wi-Fi via the QR code on the host screen.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { attachJudgeHub, judgeInfoMiddleware, lanAddresses } from './judgeHub.js';
import { dataApiMiddleware } from './dataApi.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT) || 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.fbx': 'application/octet-stream',
  '.obj': 'text/plain', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.webm': 'video/webm'
};

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('dist/ is missing — run "npm run build" first (npm start does this for you).');
  process.exit(1);
}

const info = judgeInfoMiddleware(() => port);
const dataApi = dataApiMiddleware(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data'));

const server = http.createServer((req, res) => {
  dataApi(req, res, () => info(req, res, () => {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    const file = path.normalize(path.join(root, urlPath));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      return res.end();
    }
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
  }));
});

attachJudgeHub(server);

server.listen(port, '0.0.0.0', () => {
  console.log(`\n  WWTS Beat Battle running`);
  console.log(`  Host screen:  http://localhost:${port}/`);
  lanAddresses().filter(a => !a.virtual).forEach(a => console.log(`  On your Wi-Fi: http://${a.address}:${port}/   (judges scan the QR code in the app)`));
  console.log('\n  Press Ctrl+C to stop.\n');
});
