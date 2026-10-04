/**
 * Corrections log: reopening a locked round (or changing a result) needs a
 * reason, and every change is kept with the battle record and in the report.
 *
 * Entries: { at, action: 'reopen' | 'relock' | 'penalty' | 'order', round, reason?, before?, after?, detail? }
 */

class CorrectionsLog {
  constructor() {
    this.log = [];
  }

  add(entry) {
    const e = { at: new Date().toISOString(), ...entry };
    this.log.push(e);
    return e;
  }

  /** The open reopen of a round, if any (relock closes it) */
  openReopen(round) {
    for (let i = this.log.length - 1; i >= 0; i--) {
      const e = this.log[i];
      if (e.round !== round) continue;
      if (e.action === 'relock') return null;
      if (e.action === 'reopen') return e;
    }
    return null;
  }

  export() { return this.log.map(e => ({ ...e })); }

  importState(list) { this.log = Array.isArray(list) ? list.map(e => ({ ...e })) : []; }

  reset() { this.log = []; }
}

/** Human line for the report / history */
function describeCorrection(e, names = { 1: 'Contestant 1', 2: 'Contestant 2' }) {
  const r = e.round === 4 ? 'OT' : e.round === 3 ? 'Final' : `Round ${e.round}`;
  const t = new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fmt = (x) => (x ? `${Number(x.total1 || 0).toFixed(2)} – ${Number(x.total2 || 0).toFixed(2)}` : '');
  switch (e.action) {
    case 'reopen': return `${t} · ${r} reopened — “${e.reason}” (was ${fmt(e.before)})`;
    case 'relock': return `${t} · ${r} locked again: ${fmt(e.before)} → ${fmt(e.after)}`;
    case 'penalty': return `${t} · ${r}: ${names[e.slot] || 'Producer'} −${Number(e.points).toFixed(1)} for running ${e.seconds}s over time`;
    case 'order': return `${t} · Coin flip: ${names[e.first] || 'Producer'} plays first`;
    default: return `${t} · ${e.action}${e.reason ? ` — ${e.reason}` : ''}`;
  }
}

/** Modal asking why; resolves with the reason (≥ 3 chars) or null */
function askReason({ title = 'Reason required', message = '', placeholder = 'Why is this being changed?', confirmLabel = 'Confirm' } = {}) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-overlay reason-modal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML = `
      <div class="modal-content reason-content">
        <div class="modal-header"><h2>${esc(title)}</h2><button class="modal-close" type="button" aria-label="Close">&times;</button></div>
        ${message ? `<p class="reason-msg">${esc(message)}</p>` : ''}
        <textarea class="form-input reason-text" rows="3" maxlength="240" placeholder="${esc(placeholder)}"></textarea>
        <div class="form-actions"><button type="button" class="control-btn primary reason-ok" disabled>${esc(confirmLabel)}</button><button type="button" class="control-btn secondary reason-cancel">Cancel</button></div>
      </div>`;
    document.body.appendChild(wrap);
    const text = wrap.querySelector('.reason-text');
    const ok = wrap.querySelector('.reason-ok');
    const done = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
    document.addEventListener('keydown', onKey, true);
    text.addEventListener('input', () => { ok.disabled = text.value.trim().length < 3; });
    ok.addEventListener('click', () => done(text.value.trim()));
    wrap.querySelector('.reason-cancel').addEventListener('click', () => done(null));
    wrap.querySelector('.modal-close').addEventListener('click', () => done(null));
    setTimeout(() => text.focus(), 30);
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export { CorrectionsLog, describeCorrection, askReason };
