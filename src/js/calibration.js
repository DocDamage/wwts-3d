/**
 * Judge calibration: before the event every judge scores the same reference
 * beat. From those cards we learn each judge's centre (mean category score) and
 * spread (how far apart they put categories). With "normalise judges" on, each
 * judge's scores are mapped onto the panel's common scale:
 *
 *   s' = panelMean + (s − judgeMean) × clamp(panelSpread / judgeSpread, 0.5, 2)
 *
 * so a harsh judge and a generous one count the same, and a judge who spreads
 * scores wide doesn't drown out one who scores tight. Judges who didn't
 * calibrate are left as they are.
 */

const STORE = 'wwts_calibration_v1';

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const sd = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map(v => (v - m) ** 2)));
};

/** Stats for one card over the enabled categories */
function cardStats(scores, enabled = null) {
  const vals = (scores || []).filter((v, i) => typeof v === 'number' && !isNaN(v) && (!enabled || enabled[i]));
  return { mean: Number(mean(vals).toFixed(3)), sd: Number(sd(vals).toFixed(3)), n: vals.length };
}

/** Panel centre/spread from every calibrated judge */
function panelStats(judges) {
  const list = Object.values(judges || {}).filter(j => j && j.n > 0);
  return { mean: mean(list.map(j => j.mean)), sd: mean(list.map(j => j.sd)), count: list.length };
}

/** Scale factor for a judge (1 when their spread is too small to measure) */
function scaleFor(judge, panel) {
  if (!judge || !panel || judge.sd < 0.25 || panel.sd <= 0) return 1;
  return Math.max(0.5, Math.min(2, panel.sd / judge.sd));
}

/** Map one judge's card onto the panel scale; null when this judge isn't calibrated */
function normalizeScores(scores, judge, panel) {
  if (!judge || !panel || panel.count < 2) return null;
  const k = scaleFor(judge, panel);
  return (scores || []).map(v => {
    if (typeof v !== 'number' || isNaN(v)) return v;
    const s = panel.mean + (v - judge.mean) * k;
    return Number(Math.max(0, Math.min(10, s)).toFixed(2));
  });
}

class Calibration {
  constructor() {
    this.data = null;      // { id, at, beat, judges: { name: { scores, mean, sd, n } } }
    this.active = null;    // { id, beat } while judges are scoring the reference
    try { this.data = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { this.data = null; }
  }

  save() {
    try { localStorage.setItem(STORE, JSON.stringify(this.data)); } catch { /* storage blocked */ }
  }

  start(beatName = 'Reference beat') {
    this.active = { id: `cal_${Date.now().toString(36)}`, beat: beatName, judges: {} };
    return this.active;
  }

  /** A judge's reference card (phone or typed in on the host screen) */
  record(judgeName, scores, enabled = null) {
    if (!this.active || !judgeName) return null;
    const st = cardStats(scores, enabled);
    this.active.judges[judgeName] = { scores: [...scores], ...st };
    return st;
  }

  finish() {
    if (!this.active) return this.data;
    const judges = { ...(this.data?.judges || {}), ...this.active.judges };
    this.data = { id: this.active.id, at: new Date().toISOString(), beat: this.active.beat, judges };
    this.active = null;
    this.save();
    return this.data;
  }

  cancel() { this.active = null; }

  clear() {
    this.data = null;
    this.active = null;
    this.save();
  }

  panel() { return panelStats(this.data?.judges); }

  /** (judgeName, scores) → scaled scores, or null to leave the judge as is */
  normalizer() {
    const panel = this.panel();
    if (panel.count < 2) return null;
    return (name, scores) => normalizeScores(scores, this.data.judges[name], panel);
  }

  summary() {
    const panel = this.panel();
    return Object.entries(this.data?.judges || {}).map(([name, j]) => ({
      name, mean: j.mean, sd: j.sd, factor: Number(scaleFor(j, panel).toFixed(2)), shift: Number((panel.mean - j.mean).toFixed(2))
    }));
  }
}

/** Host panel: start the reference round, collect cards, show each judge's scale */
class CalibrationPanel {
  constructor({ calibration, judges, judgeLink, scoring, audio, settings, toast }) {
    Object.assign(this, { calibration, judges, judgeLink, scoring, audio, settings, toast: toast || (() => {}) });
  }

  init() {
    this.modal = document.getElementById('calibration-modal');
    if (!this.modal) return;
    this.modal.addEventListener('tool-open', () => this.render());
    this.modal.querySelector('#cal-start')?.addEventListener('click', () => this.start());
    this.modal.querySelector('#cal-finish')?.addEventListener('click', () => this.finish());
    this.modal.querySelector('#cal-cancel')?.addEventListener('click', () => { this.calibration.cancel(); this.judgeLink.pushState(true); this.render(); });
    this.modal.querySelector('#cal-clear')?.addEventListener('click', () => {
      if (!confirm('Forget every judge\'s calibration?')) return;
      this.calibration.clear();
      this.onChange?.();
      this.render();
    });
    this.modal.querySelector('#cal-play')?.addEventListener('click', () => this.audio.togglePlay(1));
    this.modal.querySelector('#cal-normalize')?.addEventListener('change', (e) => this.settings.set('normalizeJudges', e.target.checked));
    this.settings.onChange((k) => { if (k === 'normalizeJudges') this.render(); });
  }

  start() {
    const beat = this.audio.players[1]?.loaded ? (this.audio.players[1].realTitle || 'Deck 1 beat') : 'Reference beat';
    this.calibration.start(beat);
    this.judgeLink.pushState(true);
    this.toast('🎯 Calibration round: judges score the reference beat');
    this.render();
  }

  /** A phone card arrived */
  receive(deviceId, calId, scores) {
    const a = this.calibration.active;
    if (!a || a.id !== calId) return;
    const seat = this.judges.seatForDevice(deviceId);
    if (!seat) return;
    this.calibration.record(this.judges.judgeNames[seat], scores, this.enabledMask());
    this.toast(`🎯 ${this.judges.judgeNames[seat]} scored the reference beat`);
    this.render();
  }

  enabledMask() { return this.scoring.categories.map(c => c.enabled); }

  finish() {
    // host-screen seats typed their cards into the form
    this.modal.querySelectorAll('.cal-local').forEach(row => {
      const vals = [...row.querySelectorAll('input')].map(i => (i.value === '' ? null : Number(i.value)));
      if (vals.some(v => typeof v === 'number')) {
        const scores = this.scoring.categories.map((c, i) => (c.enabled ? vals[row.dataset.map.split(',').indexOf(String(i))] ?? null : null));
        this.calibration.record(row.dataset.name, scores, this.enabledMask());
      }
    });
    const got = Object.keys(this.calibration.active?.judges || {}).length;
    this.calibration.finish();
    this.judgeLink.pushState(true);
    this.onChange?.();
    this.toast(got ? `Calibration saved for ${got} judge${got === 1 ? '' : 's'}` : 'No reference cards came in');
    this.render();
  }

  render() {
    if (!this.modal) return;
    const a = this.calibration.active;
    const $ = (sel) => this.modal.querySelector(sel);
    $('#cal-normalize').checked = !!this.settings.get('normalizeJudges');
    $('#cal-start').hidden = !!a;
    $('#cal-finish').hidden = !a;
    $('#cal-cancel').hidden = !a;
    $('#cal-status').textContent = a
      ? `Judges are scoring “${a.beat}”. ${Object.keys(a.judges).length} card${Object.keys(a.judges).length === 1 ? '' : 's'} in.`
      : (this.calibration.data ? `Last calibrated ${new Date(this.calibration.data.at).toLocaleString()} on “${this.calibration.data.beat}”.` : 'Not calibrated yet.');
    // host-screen seats type in their card
    const local = $('#cal-local');
    const cats = this.scoring.categories.map((c, i) => ({ c, i })).filter(x => x.c.enabled);
    const seats = [];
    if (a) for (let j = 1; j <= this.judges.totalJudges; j++) if (!this.judges.isRemote(j)) seats.push(j);
    local.hidden = !seats.length;
    local.innerHTML = seats.length ? `<p class="profile-muted">Seats scored on this screen: type their reference scores (0–10).</p>
      <div class="cal-grid" style="--cols:${cats.length}"><span></span>${cats.map(x => `<span class="cal-cat" title="${esc(x.c.name)}">${esc(x.c.name.slice(0, 4))}</span>`).join('')}
      ${seats.map(j => `<div class="cal-local" data-name="${esc(this.judges.judgeNames[j])}" data-map="${cats.map(x => x.i).join(',')}" style="display:contents"><span class="cal-name">${esc(this.judges.judgeNames[j])}</span>${cats.map(x => `<input type="number" min="0" max="10" step="0.5" aria-label="${esc(this.judges.judgeNames[j])} ${esc(x.c.name)}" value="${a.judges[this.judges.judgeNames[j]]?.scores?.[x.i] ?? ''}">`).join('')}</div>`).join('')}</div>` : '';
    const rows = this.calibration.summary();
    $('#cal-table').innerHTML = rows.length
      ? `<table><thead><tr><th>Judge</th><th>Centre</th><th>Spread</th><th>Shift</th><th>Scale</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.mean.toFixed(2)}</td><td>${r.sd.toFixed(2)}</td><td>${r.shift >= 0 ? '+' : ''}${r.shift.toFixed(2)}</td><td>×${r.factor.toFixed(2)}</td></tr>`).join('')}</tbody></table>
        <p class="profile-muted">${rows.length < 2 ? 'Calibrate at least two judges to normalise.' : 'Shift and scale are applied to each judge\'s category scores when normalising is on.'}</p>`
      : '';
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export { Calibration, CalibrationPanel, cardStats, panelStats, scaleFor, normalizeScores };
