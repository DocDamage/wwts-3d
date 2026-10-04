/**
 * Backup & sync: keeps the league's data safe outside one browser's storage.
 *
 *  - Snapshot = every app key in localStorage (leagues, roster, history,
 *    tournament, judges' room, pads layout, settings) as one JSON document
 *  - Automatic versioned snapshots in IndexedDB: at startup, every 10 minutes when
 *    something changed, and after each finished battle (newest 30 kept)
 *  - Mirrored to disk through the local app server (data/backups/) when it's
 *    running on this machine, so nothing lives only in the browser
 *  - Export to a .json file / import one (with a safety snapshot first)
 */

const DB_NAME = 'wwts_backups';
const STORE = 'snapshots';
const KEEP = 30;
const KEY_RE = /^(beatbattle_|wwts_|judge)/;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out = fn(store);
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}

/** Quick content hash (to skip identical snapshots) */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

class BackupManager {
  constructor() {
    this.lastHash = null;
    this.diskOk = null;   // server API reachable?
    this.onChange = null;
  }

  /** Everything the app keeps in localStorage */
  collect(reason = 'manual') {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && KEY_RE.test(k)) data[k] = localStorage.getItem(k);
    }
    return { app: 'wwts', version: 1, reason, createdAt: new Date().toISOString(), data };
  }

  summarize(snap) {
    const parse = (k) => { try { return JSON.parse(snap.data[k] || 'null'); } catch { return null; } };
    return {
      leagues: (parse('beatbattle_leagues') || []).length,
      contestants: (parse('beatbattle_contestants') || []).length,
      battles: (parse('beatbattle_history') || []).length,
      keys: Object.keys(snap.data).length
    };
  }

  async snapshot(reason = 'auto', { force = false } = {}) {
    const snap = this.collect(reason);
    const json = JSON.stringify(snap.data);
    const h = hash(json);
    if (!force && h === this.lastHash) return null;
    this.lastHash = h;
    try {
      const db = await openDb();
      await tx(db, 'readwrite', s => s.add({ createdAt: snap.createdAt, reason, size: json.length, hash: h, payload: snap }));
      // prune to the newest KEEP
      const all = await this.list(db);
      const extra = all.slice(KEEP);
      if (extra.length) await tx(db, 'readwrite', s => extra.forEach(r => s.delete(r.id)));
    } catch (e) {
      console.warn('Backup snapshot failed', e);
    }
    this.saveToDisk(snap);
    this.onChange?.();
    return snap;
  }

  async list(db = null) {
    try {
      db = db || await openDb();
      const rows = await tx(db, 'readonly', s => s.getAll());
      return (rows || []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return [];
    }
  }

  async remove(id) {
    const db = await openDb();
    await tx(db, 'readwrite', s => s.delete(id));
    this.onChange?.();
  }

  /** Replace the app's data with a snapshot (takes a safety snapshot first) */
  async restore(snap) {
    if (!snap || snap.app !== 'wwts' || typeof snap.data !== 'object') throw new Error('Not a WWTS backup');
    await this.snapshot('before-restore', { force: true });
    const keep = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && KEY_RE.test(k)) keep.push(k); }
    keep.forEach(k => localStorage.removeItem(k));
    Object.entries(snap.data).forEach(([k, v]) => { if (KEY_RE.test(k) && typeof v === 'string') localStorage.setItem(k, v); });
  }

  download(snap = this.collect('export')) {
    const blob = new Blob([JSON.stringify(snap, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    const stamp = snap.createdAt.slice(0, 16).replace(/[T:]/g, '-');
    a.href = URL.createObjectURL(blob);
    a.download = `wwts-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async readFile(file) {
    const text = await file.text();
    const snap = JSON.parse(text);
    if (snap?.app !== 'wwts' || typeof snap.data !== 'object') throw new Error('That file is not a WWTS backup');
    return snap;
  }

  /* ---- disk mirror via the local server ---- */

  async saveToDisk(snap) {
    if (this.diskOk === false) return false;
    try {
      const res = await fetch('/api/backups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snap) });
      this.diskOk = res.ok;
      return res.ok;
    } catch {
      this.diskOk = false;
      return false;
    }
  }

  async listDisk() {
    try {
      const res = await fetch('/api/backups');
      if (!res.ok) { this.diskOk = false; return []; }
      this.diskOk = true;
      return await res.json();
    } catch {
      this.diskOk = false;
      return [];
    }
  }

  async loadDisk(name) {
    const res = await fetch('/api/backups/' + encodeURIComponent(name));
    if (!res.ok) throw new Error('Could not read ' + name);
    return res.json();
  }

  /** Startup snapshot + every 10 minutes when data changed */
  startAuto() {
    this.snapshot('startup');
    this._timer = setInterval(() => this.snapshot('auto'), 10 * 60 * 1000);
  }
}

/* ------------------------------------------------------------------ */
/* Modal UI */

class BackupPanel {
  constructor(backup, { toast } = {}) {
    this.backup = backup;
    this.toast = toast || ((m) => console.log(m));
  }

  init() {
    const modal = document.getElementById('backup-modal');
    if (!modal) return;
    this.modal = modal;
    modal.addEventListener('tool-open', () => this.render());
    modal.addEventListener('click', (e) => { if (e.target === modal) this.close(); });
    document.getElementById('backup-export')?.addEventListener('click', () => { this.backup.download(); this.toast('Backup file saved'); });
    document.getElementById('backup-now')?.addEventListener('click', async () => {
      await this.backup.snapshot('manual', { force: true });
      this.toast(this.backup.diskOk ? 'Snapshot saved (browser + disk)' : 'Snapshot saved in this browser');
      this.render();
    });
    const file = document.getElementById('backup-import-file');
    document.getElementById('backup-import')?.addEventListener('click', () => file?.click());
    file?.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      try {
        const snap = await this.backup.readFile(f);
        this.confirmRestore(snap, `the file "${f.name}"`);
      } catch (e) {
        this.toast(e.message);
      }
    });
    this.backup.onChange = () => { if (!this.modal.hidden && this.modal.style.display !== 'none') this.render(); };
  }

  open() {
    this.modal.style.display = '';
    this.render();
  }

  close() {
    this.modal.style.display = 'none';
  }

  fmt(iso) {
    try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; }
  }

  async render() {
    const list = document.getElementById('backup-list');
    const disk = document.getElementById('backup-disk-list');
    const now = this.backup.summarize(this.backup.collect());
    const cur = document.getElementById('backup-current');
    if (cur) cur.textContent = `${now.leagues} leagues · ${now.contestants} contestants · ${now.battles} battles`;
    const rows = await this.backup.list();
    if (list) {
      list.innerHTML = rows.length ? '' : '<li class="backup-empty">No snapshots yet.</li>';
      rows.forEach(r => {
        const s = this.backup.summarize(r.payload);
        const li = document.createElement('li');
        li.innerHTML = `<div><b>${this.fmt(r.createdAt)}</b> <span class="backup-reason">${r.reason}</span><small>${s.leagues} leagues · ${s.contestants} contestants · ${s.battles} battles</small></div>
          <div class="backup-actions"><button type="button" class="fs-small" data-act="restore">Restore</button><button type="button" class="fs-small" data-act="save">Save file</button><button type="button" class="fs-small" data-act="del" aria-label="Delete snapshot">✕</button></div>`;
        li.querySelector('[data-act=restore]').onclick = () => this.confirmRestore(r.payload, `the snapshot from ${this.fmt(r.createdAt)}`);
        li.querySelector('[data-act=save]').onclick = () => this.backup.download(r.payload);
        li.querySelector('[data-act=del]').onclick = () => this.backup.remove(r.id);
        list.appendChild(li);
      });
    }
    if (disk) {
      const files = await this.backup.listDisk();
      const note = document.getElementById('backup-disk-note');
      if (note) note.textContent = this.backup.diskOk ? 'Also saved to data/backups/ on this computer.' : 'Disk copies need the app server running on this computer (npm run dev / npm start).';
      disk.innerHTML = '';
      files.slice(0, 12).forEach(f => {
        const li = document.createElement('li');
        li.innerHTML = `<div><b>${this.fmt(f.savedAt)}</b><small>${f.name} · ${(f.size / 1024).toFixed(0)} KB</small></div><div class="backup-actions"><button type="button" class="fs-small">Restore</button></div>`;
        li.querySelector('button').onclick = async () => {
          try { this.confirmRestore(await this.backup.loadDisk(f.name), `the disk backup ${f.name}`); } catch (e) { this.toast(e.message); }
        };
        disk.appendChild(li);
      });
    }
  }

  confirmRestore(snap, label) {
    const s = this.backup.summarize(snap);
    const ok = window.confirm(`Restore ${label}?\n\nIt contains ${s.leagues} leagues, ${s.contestants} contestants and ${s.battles} battles.\nYour current data is snapshotted first, so you can undo this.`);
    if (!ok) return;
    this.backup.restore(snap).then(() => {
      this.toast('Restored — reloading…');
      setTimeout(() => location.reload(), 600);
    }).catch(e => this.toast(e.message));
  }
}

export { BackupManager, BackupPanel };
