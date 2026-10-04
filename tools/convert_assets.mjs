/**
 * Converts the source FBX models / clips (assets-src/) into the compressed GLBs
 * the app serves (public/models/), and the DJ deck's PNG textures into WebP.
 *
 *   node tools/convert_assets.mjs          (only what changed)
 *   node tools/convert_assets.mjs --force  (everything)
 *
 * Characters: FBX2glTF -> meshopt geometry + WebP textures (max 1024px)
 * Clips:      FBX2glTF (30 fps) -> resampled keys -> meshopt-compressed animation
 * Typical savings: characters ~15x, clips ~15x.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { resample, prune, dedup, meshopt, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets-src');
const OUT = path.join(ROOT, 'public', 'models');
const FORCE = process.argv.includes('--force');
const FBX2GLTF = path.join(ROOT, 'node_modules', 'fbx2gltf', 'bin', os.platform() === 'win32' ? 'Windows_NT' : os.platform() === 'darwin' ? 'Darwin' : 'Linux', os.platform() === 'win32' ? 'FBX2glTF.exe' : 'FBX2glTF');

const JOBS = [
  { dir: 'characters', kind: 'character' },
  { dir: 'characters/cast', kind: 'character' },
  { dir: 'animations', kind: 'clip' }
];

function stale(src, out) {
  if (FORCE || !fs.existsSync(out)) return true;
  return fs.statSync(src).mtimeMs > fs.statSync(out).mtimeMs;
}

async function main() {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wwts-conv-'));

  const tasks = [];
  for (const job of JOBS) {
    const srcDir = path.join(SRC, job.dir);
    if (!fs.existsSync(srcDir)) continue;
    const outDir = path.join(OUT, job.dir);
    fs.mkdirSync(outDir, { recursive: true });
    for (const f of fs.readdirSync(srcDir)) {
      if (!f.toLowerCase().endsWith('.fbx')) continue;
      const src = path.join(srcDir, f);
      const out = path.join(outDir, f.replace(/\.fbx$/i, '.glb'));
      if (stale(src, out)) tasks.push({ ...job, src, out, name: f });
    }
  }
  console.log(`${tasks.length} model(s) to convert`);

  let done = 0;
  let bytesIn = 0;
  let bytesOut = 0;
  const worker = async () => {
    while (tasks.length) {
      const t = tasks.shift();
      const raw = path.join(tmp, path.basename(t.out, '.glb') + '_' + Math.random().toString(36).slice(2));
      try {
        await run(FBX2GLTF, ['--binary', '--anim-framerate', 'bake30', '-i', t.src, '-o', raw], { maxBuffer: 1 << 24 });
        const doc = await io.read(raw + '.glb');
        if (t.kind === 'clip') {
          await doc.transform(resample(), prune({ keepLeaves: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
        } else {
          await doc.transform(
            dedup(), prune(), weld(),
            textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }),
            resample(),
            meshopt({ encoder: MeshoptEncoder, level: 'medium' })
          );
        }
        await io.write(t.out, doc);
        bytesIn += fs.statSync(t.src).size;
        bytesOut += fs.statSync(t.out).size;
      } catch (e) {
        console.error('FAILED', t.name, e.message?.split('\n')[0]);
      } finally {
        fs.rmSync(raw + '.glb', { force: true });
      }
      done++;
      if (done % 20 === 0) console.log(`  ${done} done`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(2, Math.min(6, os.cpus().length - 1)) }, worker));

  // DJ deck textures -> WebP
  const deckSrc = path.join(SRC, 'dj_controller');
  const deckOut = path.join(OUT, 'dj_controller');
  if (fs.existsSync(deckSrc)) {
    for (const f of fs.readdirSync(deckSrc)) {
      if (!/\.png$/i.test(f)) continue;
      const src = path.join(deckSrc, f);
      const out = path.join(deckOut, f.replace(/\.png$/i, '.webp'));
      if (!stale(src, out)) continue;
      await sharp(src).resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toFile(out);
      bytesIn += fs.statSync(src).size;
      bytesOut += fs.statSync(out).size;
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
  console.log(`converted ${done}: ${mb(bytesIn)} -> ${mb(bytesOut)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
