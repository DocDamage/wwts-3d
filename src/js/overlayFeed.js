/**
 * Feeds the stream overlays (overlay.html): builds one state object several
 * times a second and sends it through the local hub (for OBS browser sources)
 * and a BroadcastChannel (for windows in this browser). Only changes are sent,
 * plus a heartbeat so a freshly added overlay fills in quickly.
 */
class OverlayFeed {
  constructor({ judgeLink, build }) {
    this.link = judgeLink;
    this.build = build;
    this.last = '';
    this.lastSent = 0;
    try { this.bc = new BroadcastChannel('wwts_overlay'); } catch { this.bc = null; }
  }

  start() {
    this._iv = setInterval(() => this.tick(), 250);
  }

  tick(force = false) {
    let state;
    try { state = this.build(); } catch (e) { return; }
    const json = JSON.stringify(state);
    const now = Date.now();
    if (!force && json === this.last && now - this.lastSent < 2000) return;
    this.last = json;
    this.lastSent = now;
    this.link.send({ t: 'overlay', state });
    this.bc?.postMessage({ t: 'overlay', room: this.link.room, state });
  }
}

/** Tournament → compact columns of matches for the bracket overlay */
function bracketSummary(tournament, roster) {
  const t = tournament?.t;
  if (!t || !t.matches?.length) return null;
  const nameOf = (id) => (id ? roster.getById(id)?.name || '?' : null);
  const groups = new Map();
  t.matches.filter(m => !m.isBye && m.bracket !== 'L').forEach(m => {
    const key = `${m.bracket}:${m.round}`;
    if (!groups.has(key)) groups.set(key, { title: tournament.matchLabel ? tournament.matchLabel(m) : `Round ${m.round}`, order: (m.bracket === 'GF' ? 100 : m.bracket === 'F' ? 90 : 0) + m.round, matches: [] });
    groups.get(key).matches.push({
      p1: nameOf(m.p1),
      p2: nameOf(m.p2),
      winner: m.winnerId ? (m.winnerId === m.p1 ? 1 : 2) : 0,
      current: t.currentMatchId === m.id
    });
  });
  const rounds = [...groups.values()].sort((a, b) => a.order - b.order).slice(-4);
  return { name: t.name, rounds };
}


/** Tools → OBS overlays: one URL per widget, with sizes and copy / preview */
const OVERLAY_WIDGETS = [
  { w: 'scoreboard', name: 'Scoreboard', size: '1920 × 140', desc: 'Names, scores, rounds won, round and timer' },
  { w: 'lower', name: 'Lower third', size: '1920 × 220', desc: 'Matchup and whose beat is playing' },
  { w: 'timer', name: 'Round timer', size: '600 × 200', desc: 'Big timer (flashes in the last 10 s)' },
  { w: 'crowd', name: 'Crowd vote', size: '1920 × 200', desc: 'Live crowd-vote bars while voting is open' },
  { w: 'bracket', name: 'Bracket', size: '1920 × 600', desc: 'The current tournament bracket' },
  { w: 'fight', name: 'Fight HUD', size: '1920 × 160', desc: 'Health bars, timer, round pips and combos' },
  { w: 'result', name: 'Winner card', size: '1920 × 400', desc: 'Pops up after the reveal for 15 s' },
  { w: 'chat', name: 'Live chat', size: '600 × 400', desc: 'Latest Twitch / YouTube messages (needs Live Chat Hype connected)' }
];

class OverlaysPanel {
  constructor({ judgeLink, toast }) {
    this.link = judgeLink;
    this.toast = toast || (() => {});
  }

  init() {
    this.modal = document.getElementById('overlays-modal');
    if (!this.modal) return;
    this.modal.addEventListener('tool-open', () => this.render());
  }

  url(w, demo = false) {
    const port = location.port ? `:${location.port}` : '';
    return `${location.protocol}//localhost${port}/overlay.html?room=${this.link.room}&w=${w}${demo ? '&demo=1' : ''}`;
  }

  render() {
    const list = document.getElementById('overlays-list');
    document.getElementById('overlays-room').textContent = this.link.room;
    list.innerHTML = OVERLAY_WIDGETS.map(o => `<li>
      <div><b>${o.name}</b><small>${o.desc} · suggested source size ${o.size}</small><code>${this.url(o.w)}</code></div>
      <div class="backup-actions"><button type="button" class="fs-small" data-copy="${o.w}">Copy URL</button><a class="fs-small" href="${this.url(o.w, true)}" target="_blank" rel="noopener">Preview</a></div>
    </li>`).join('');
    list.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
      navigator.clipboard?.writeText(this.url(b.dataset.copy)).then(() => this.toast('Overlay URL copied — paste it into an OBS Browser Source'));
    }));
  }
}

export { OverlaysPanel, OVERLAY_WIDGETS };

export { OverlayFeed, bracketSummary };
