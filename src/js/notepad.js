/**
 * Battle Notepad — a 3D reporter-style notepad for notes during the battle.
 *
 * Two sides: Private (judges only, yellow legal paper) and Public (shared with the
 * producers in their report, white paper). Each note is stamped with the round, the
 * contestant, and the beat's position at the moment you START typing, so the stamp
 * points at the moment you heard it. Clicking a stamp jumps that deck back there.
 * Notes live in battleEngine.timestampedNotes, so they autosave and go into history.
 */

const TAGS = [
  { id: 'fire', label: '🔥 Fire' },
  { id: 'drums', label: '🥁 Drums' },
  { id: 'melody', label: '🎹 Melody' },
  { id: 'bass', label: '🔊 Bass' },
  { id: 'mix', label: '🎚️ Mix' },
  { id: 'switch', label: '🔀 Switch-up' },
  { id: 'issue', label: '⚠️ Issue' }
];
const LINES_PER_PAGE = 8;

const fmt = (sec) => {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

class BattleNotepad {
  constructor({ battleEngine, audio, rounds, getNames, onChange }) {
    this.engine = battleEngine;
    this.audio = audio;
    this.rounds = rounds;
    this.getNames = getNames;   // () => [name1, name2]
    this.onChange = onChange;   // notes changed (autosave)
    this.side = 'private';
    this.filter = 'all';        // all | 1 | 2
    this.page = 0;
    this.stamp = null;          // { round, contestant, trackTime } captured when typing starts
    this.tags = new Set();
    this.editingId = null;
  }

  init() {
    this.root = document.getElementById('notepad-root');
    if (!this.root) return;
    this.root.innerHTML = this.template();
    this.cache();
    this.bind();
    this.render();
  }

  template() {
    return `
      <div class="notepad-scene">
        <div class="notepad" id="notepad" data-side="private">
          <div class="notepad-dividers" role="tablist">
            <button type="button" class="np-divider private active" data-side="private" role="tab" title="Only you and the judges see these">🔒 Private</button>
            <button type="button" class="np-divider public" data-side="public" role="tab" title="Shared with the producers in their report">📢 Public</button>
          </div>
          <div class="notepad-binding" aria-hidden="true"></div>
          <div class="notepad-stack" aria-hidden="true"></div>
          <div class="notepad-page" id="np-page">
            <header class="np-head">
              <div class="np-title">
                <span class="np-title-main" id="np-title">BATTLE NOTES</span>
                <span class="np-title-sub" id="np-sub"></span>
              </div>
              <div class="np-filters" role="group" aria-label="Show notes for">
                <button type="button" class="np-filter active" data-filter="all">All</button>
                <button type="button" class="np-filter c1" data-filter="1">C1</button>
                <button type="button" class="np-filter c2" data-filter="2">C2</button>
              </div>
            </header>
            <ol class="np-lines" id="np-lines"></ol>
            <div class="np-pager">
              <button type="button" class="np-page-btn" id="np-prev" title="Previous page">◀</button>
              <span id="np-page-label">Page 1</span>
              <button type="button" class="np-page-btn" id="np-next" title="Next page">▶</button>
            </div>
          </div>
          <div class="np-compose">
            <div class="np-compose-row">
              <button type="button" class="np-stamp" id="np-stamp" title="Click to switch contestant · the time is captured when you start typing">⏱ —</button>
              <input type="text" id="np-input" class="np-input" maxlength="280" placeholder="Write a note… (Enter to pin it)" autocomplete="off" />
              <button type="button" class="np-add" id="np-add" title="Pin note (Enter)">Pin</button>
            </div>
            <div class="np-tags" id="np-tags">
              ${TAGS.map(t => `<button type="button" class="np-tag" data-tag="${t.id}">${t.label}</button>`).join('')}
            </div>
          </div>
        </div>
      </div>
      <details class="np-archive" id="np-archive">
        <summary>Notes from earlier battles</summary>
        <div id="np-archive-list"></div>
      </details>`;
  }

  cache() {
    this.el = {
      pad: this.root.querySelector('#notepad'),
      page: this.root.querySelector('#np-page'),
      lines: this.root.querySelector('#np-lines'),
      title: this.root.querySelector('#np-title'),
      sub: this.root.querySelector('#np-sub'),
      input: this.root.querySelector('#np-input'),
      stamp: this.root.querySelector('#np-stamp'),
      pageLabel: this.root.querySelector('#np-page-label'),
      prev: this.root.querySelector('#np-prev'),
      next: this.root.querySelector('#np-next'),
      scene: this.root.querySelector('.notepad-scene')
    };
  }

  bind() {
    this.root.querySelectorAll('.np-divider').forEach(btn => btn.addEventListener('click', () => this.setSide(btn.dataset.side)));
    this.root.querySelectorAll('.np-filter').forEach(btn => btn.addEventListener('click', () => {
      this.filter = btn.dataset.filter;
      this.root.querySelectorAll('.np-filter').forEach(b => b.classList.toggle('active', b === btn));
      this.page = Infinity;
      this.render();
    }));
    this.root.querySelectorAll('.np-tag').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.tag;
      if (this.tags.has(id)) this.tags.delete(id);
      else this.tags.add(id);
      btn.classList.toggle('active', this.tags.has(id));
      if (!this.stamp) this.captureStamp();
    }));

    // Capture the moment as soon as typing starts
    this.el.input.addEventListener('input', () => {
      if (this.el.input.value.trim() && !this.stamp) this.captureStamp();
      if (!this.el.input.value.trim() && !this.tags.size && !this.editingId) this.clearStamp();
    });
    this.el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.commit();
      } else if (e.key === 'Escape') {
        this.cancelEdit();
        this.el.input.blur();
      }
    });
    this.root.querySelector('#np-add').addEventListener('click', () => this.commit());
    this.el.stamp.addEventListener('click', () => {
      if (!this.stamp) this.captureStamp();
      // Cycle who the note is about: C1 → C2 → general
      const order = [1, 2, null];
      this.stamp.contestant = order[(order.indexOf(this.stamp.contestant) + 1) % order.length];
      this.renderStamp();
    });

    this.el.prev.addEventListener('click', () => this.flip(-1));
    this.el.next.addEventListener('click', () => this.flip(1));

    // Line actions (delegated)
    this.el.lines.addEventListener('click', (e) => {
      const li = e.target.closest('.np-line');
      if (!li) return;
      const note = this.notes().find(n => n.id === li.dataset.id);
      if (!note) return;
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'seek') this.seekTo(note);
      else if (action === 'delete') this.remove(note.id);
      else if (action === 'move') this.move(note.id);
      else if (action === 'edit') this.startEdit(note);
    });

    // A little parallax so the pad feels physical
    this.el.scene.addEventListener('pointermove', (e) => {
      if (document.body.classList.contains('reduced-motion')) return;
      const r = this.el.scene.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      this.el.pad.style.setProperty('--tilt-x', `${(10 - y * 6).toFixed(2)}deg`);
      this.el.pad.style.setProperty('--tilt-y', `${(x * 8).toFixed(2)}deg`);
    });
    this.el.scene.addEventListener('pointerleave', () => {
      this.el.pad.style.removeProperty('--tilt-x');
      this.el.pad.style.removeProperty('--tilt-y');
    });
  }

  /* ---------------- Data ---------------- */

  notes() {
    // Older notes (before private/public existed) stay private
    return this.engine.timestampedNotes.map(n => {
      if (!n.visibility) n.visibility = 'private';
      return n;
    });
  }

  visibleNotes() {
    return this.notes().filter(n => n.visibility === this.side && (this.filter === 'all' || String(n.contestant) === this.filter));
  }

  liveDeck() {
    if (this.audio.isPlaying(1)) return 1;
    if (this.audio.isPlaying(2)) return 2;
    return this.engine.activeContestant || 1;
  }

  captureStamp() {
    const deck = this.liveDeck();
    const st = this.audio.getDeckState(deck);
    this.stamp = { round: this.rounds.currentRound || 1, contestant: deck, trackTime: st.loaded ? st.time : 0, hasTrack: st.loaded };
    this.renderStamp();
  }

  clearStamp() {
    this.stamp = null;
    this.renderStamp();
  }

  /** Add a note (also used for notes arriving from judges' phones) */
  add({ text, contestant = null, visibility = 'private', tags = [], author = 'Host', trackTime = null, round = null }) {
    const clean = String(text || '').trim().slice(0, 280);
    if (!clean) return null;
    const deck = contestant || this.liveDeck();
    const time = trackTime ?? (this.audio.getDeckState(deck).time || 0);
    const note = {
      id: `tn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text: clean,
      round: round || this.rounds.currentRound || 1,
      contestant,
      trackTime: time,
      time: fmt(time),
      visibility: visibility === 'public' ? 'public' : 'private',
      tags,
      author,
      timestamp: new Date().toISOString()
    };
    this.engine.timestampedNotes.push(note);
    this.changed();
    return note;
  }

  commit() {
    const text = this.el.input.value.trim();
    if (!text) return;
    if (this.editingId) {
      const note = this.notes().find(n => n.id === this.editingId);
      if (note) {
        note.text = text.slice(0, 280);
        note.tags = [...this.tags];
        if (this.stamp) note.contestant = this.stamp.contestant;
      }
      this.cancelEdit();
      this.changed();
      return;
    }
    if (!this.stamp) this.captureStamp();
    this.add({
      text,
      contestant: this.stamp.contestant,
      visibility: this.side,
      tags: [...this.tags],
      trackTime: this.stamp.trackTime,
      round: this.stamp.round
    });
    this.resetCompose();
    this.page = Infinity; // jump to the newest page
    this.render(true);
  }

  remove(id) {
    const i = this.engine.timestampedNotes.findIndex(n => n.id === id);
    if (i >= 0) this.engine.timestampedNotes.splice(i, 1);
    this.changed();
  }

  move(id) {
    const note = this.notes().find(n => n.id === id);
    if (!note) return;
    note.visibility = note.visibility === 'public' ? 'private' : 'public';
    this.changed();
  }

  startEdit(note) {
    this.editingId = note.id;
    this.el.input.value = note.text;
    this.tags = new Set(note.tags || []);
    this.root.querySelectorAll('.np-tag').forEach(b => b.classList.toggle('active', this.tags.has(b.dataset.tag)));
    this.stamp = { round: note.round, contestant: note.contestant, trackTime: note.trackTime ?? 0, hasTrack: true };
    this.renderStamp();
    this.el.pad.classList.add('editing');
    this.el.input.focus();
  }

  cancelEdit() {
    this.editingId = null;
    this.el.pad.classList.remove('editing');
    this.resetCompose();
  }

  resetCompose() {
    this.el.input.value = '';
    this.tags.clear();
    this.root.querySelectorAll('.np-tag').forEach(b => b.classList.remove('active'));
    this.clearStamp();
  }

  seekTo(note) {
    const deck = note.contestant;
    if (!deck || !this.audio.players[deck]?.loaded || note.trackTime == null) return;
    this.audio.seek(deck, note.trackTime);
  }

  changed() {
    this.render();
    this.onChange?.();
  }

  setSide(side) {
    if (side === this.side) return;
    this.side = side;
    this.el.pad.dataset.side = side;
    this.root.querySelectorAll('.np-divider').forEach(b => b.classList.toggle('active', b.dataset.side === side));
    this.page = Infinity;
    this.render(true);
  }

  flip(dir) {
    const pages = Math.max(1, Math.ceil(this.visibleNotes().length / LINES_PER_PAGE));
    const next = Math.max(0, Math.min(pages - 1, this.page + dir));
    if (next === this.page) return;
    this.el.page.classList.remove('flip-up', 'flip-down');
    void this.el.page.offsetWidth; // restart the animation
    this.el.page.classList.add(dir > 0 ? 'flip-up' : 'flip-down');
    this.page = next;
    setTimeout(() => this.render(), 180);
  }

  focusInput() {
    this.el?.input.focus();
  }

  /* ---------------- Rendering ---------------- */

  renderStamp() {
    const [n1, n2] = this.getNames();
    if (!this.stamp) {
      this.el.stamp.textContent = '⏱ —';
      this.el.stamp.className = 'np-stamp';
      return;
    }
    const who = this.stamp.contestant === 1 ? n1 : this.stamp.contestant === 2 ? n2 : 'General';
    const r = this.stamp.round === 4 ? 'OT' : `R${this.stamp.round}`;
    this.el.stamp.textContent = `⏱ ${r} · ${who}${this.stamp.hasTrack && this.stamp.contestant ? ` · ${fmt(this.stamp.trackTime)}` : ''}`;
    this.el.stamp.className = `np-stamp c${this.stamp.contestant || 0}`;
  }

  render(animate = false) {
    if (!this.el) return;
    const [n1, n2] = this.getNames();
    const list = this.visibleNotes();
    const pages = Math.max(1, Math.ceil(list.length / LINES_PER_PAGE));
    if (this.page === Infinity || this.page >= pages) this.page = pages - 1;
    const slice = list.slice(this.page * LINES_PER_PAGE, (this.page + 1) * LINES_PER_PAGE);

    this.el.title.textContent = this.side === 'private' ? 'PRIVATE NOTES' : 'PUBLIC NOTES';
    const total = this.notes().filter(n => n.visibility === this.side).length;
    this.el.sub.textContent = `${n1} vs ${n2} · ${total} note${total === 1 ? '' : 's'}${this.side === 'public' ? ' · shared in the producer report' : ' · judges only'}`;
    this.root.querySelector('.np-filter.c1').textContent = n1.length > 12 ? `${n1.slice(0, 11)}…` : n1;
    this.root.querySelector('.np-filter.c2').textContent = n2.length > 12 ? `${n2.slice(0, 11)}…` : n2;

    const tagLabel = (id) => TAGS.find(t => t.id === id)?.label || id;
    this.el.lines.innerHTML = slice.map(n => {
      const who = n.contestant === 1 ? n1 : n.contestant === 2 ? n2 : 'General';
      const r = n.round === 4 ? 'OT' : `R${n.round}`;
      const canSeek = n.contestant && this.audio.players[n.contestant]?.loaded;
      return `<li class="np-line c${n.contestant || 0}" data-id="${n.id}">
        <button type="button" class="np-line-stamp" data-action="seek" ${canSeek ? `title="Jump ${escapeHtml(who)}'s beat to ${n.time}"` : 'disabled'}>${r} · ${n.contestant ? n.time : '—'}</button>
        <span class="np-line-who">${escapeHtml(who)}</span>
        <span class="np-line-text">${escapeHtml(n.text)}${(n.tags || []).map(t => ` <span class="np-line-tag">${tagLabel(t)}</span>`).join('')}${n.author && n.author !== 'Host' ? ` <span class="np-line-author">— 📱 ${escapeHtml(n.author)}</span>` : ''}</span>
        <span class="np-line-actions">
          <button type="button" data-action="edit" title="Edit">✎</button>
          <button type="button" data-action="move" title="${n.visibility === 'public' ? 'Make private' : 'Make public'}">${n.visibility === 'public' ? '🔒' : '📢'}</button>
          <button type="button" data-action="delete" title="Delete">✕</button>
        </span>
      </li>`;
    }).join('') + (slice.length ? '' : `<li class="np-empty">${this.side === 'private' ? 'Your private scratchpad — only the judges see this side.' : 'Feedback for the producers — it goes into their post-battle report.'}<br>Start typing below; the beat's time is stamped automatically.</li>`);

    this.el.pageLabel.textContent = `Page ${this.page + 1} of ${pages}`;
    this.el.prev.disabled = this.page === 0;
    this.el.next.disabled = this.page >= pages - 1;
    if (animate) {
      this.el.page.classList.remove('settle');
      void this.el.page.offsetWidth;
      this.el.page.classList.add('settle');
    }
    this.renderStamp();
  }

  /** Earlier battles' notes (from history), newest first */
  renderArchive(battles) {
    const list = this.root?.querySelector('#np-archive-list');
    if (!list) return;
    const withNotes = (battles || []).filter(b => (b.timestampedNotes && b.timestampedNotes.length) || (b.notes && b.notes.trim())).slice(0, 8);
    list.innerHTML = withNotes.length ? withNotes.map(b => `
      <div class="np-archive-item">
        <div class="np-archive-head"><b>${escapeHtml(b.contestant1Name)}</b> vs <b>${escapeHtml(b.contestant2Name)}</b> · ${new Date(b.timestamp).toLocaleDateString()}</div>
        ${(b.timestampedNotes || []).map(n => `<div class="np-archive-note">${n.visibility === 'public' ? '📢' : '🔒'} <span>${n.round === 4 ? 'OT' : `R${n.round}`} · ${escapeHtml(n.time || '')}</span> ${escapeHtml(n.text)}</div>`).join('')}
        ${b.notes ? `<div class="np-archive-note">📝 ${escapeHtml(b.notes)}</div>` : ''}
      </div>`).join('') : '<p class="np-archive-empty">No notes saved with earlier battles yet.</p>';
  }
}

export { BattleNotepad, TAGS as NOTE_TAGS };
