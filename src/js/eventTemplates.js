/**
 * Event templates (⚙ Tools → Event templates): save the whole setup of a night
 * — scoring preset and weights, step, league rules, judge panel size, event
 * settings (time limits, fairness switches) — as "Monthly Smoke", and start the
 * next event in one click. Templates can be exported / imported as JSON.
 */

const STORE = 'wwts_templates_v1';

class EventTemplates {
  constructor({ settings, scoring, judges, leagues, rulesFor, onApplied }) {
    Object.assign(this, { settings, scoring, judges, leagues, rulesFor, onApplied });
    this.list = [];
    try { this.list = JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { this.list = []; }
  }

  save() {
    try { localStorage.setItem(STORE, JSON.stringify(this.list)); } catch { /* storage blocked */ }
  }

  /** Everything a template carries, from the current setup */
  capture() {
    return {
      settings: this.settings.all(),
      scoring: {
        presetId: this.scoring.presetId,
        step: this.scoring.step,
        categories: this.scoring.categories.map(c => ({ key: c.key, weight: c.weight, enabled: c.enabled })),
        guides: this.scoring.customGuides || null
      },
      rules: this.rulesFor(this.leagues.getActive()),
      judges: { mode: this.judges.mode, count: this.judges.totalJudges }
    };
  }

  saveAs(name) {
    const clean = String(name || '').trim().slice(0, 40);
    if (!clean) return null;
    const existing = this.list.find(t => t.name.toLowerCase() === clean.toLowerCase());
    const tpl = { id: existing?.id || `tpl_${Date.now().toString(36)}`, name: clean, savedAt: new Date().toISOString(), data: this.capture() };
    if (existing) Object.assign(existing, tpl);
    else this.list.push(tpl);
    this.save();
    return tpl;
  }

  remove(id) {
    this.list = this.list.filter(t => t.id !== id);
    this.save();
  }

  apply(id) {
    const tpl = this.list.find(t => t.id === id);
    if (!tpl) return false;
    const d = tpl.data || {};
    if (d.settings) this.settings.apply(d.settings);
    if (d.scoring) {
      const sc = this.scoring;
      if (d.scoring.presetId && d.scoring.presetId !== 'custom') sc.setPreset(d.scoring.presetId);
      if (Array.isArray(d.scoring.categories)) {
        d.scoring.categories.forEach(c => {
          const cat = sc.categories.find(x => x.key === c.key);
          if (cat) { cat.weight = c.weight; cat.enabled = c.enabled; }
        });
        sc.presetId = d.scoring.presetId || 'custom';
      }
      if (d.scoring.step) sc.step = d.scoring.step;
      sc.customGuides = d.scoring.guides || null;
      sc.rebuildAllSliders();
      sc.updateTotal(1);
      sc.updateTotal(2);
    }
    const league = this.leagues.getActive();
    if (d.rules && league) this.leagues.update(league.id, { rules: d.rules });
    if (d.judges) {
      this.judges.setMode(d.judges.mode === 'panel' ? 'panel' : 'solo');
      if (d.judges.count) this.judges.setJudgeCount(d.judges.count);
    }
    this.onApplied?.(tpl);
    return true;
  }

  exportJson(id) {
    const tpl = this.list.find(t => t.id === id);
    return tpl ? JSON.stringify({ app: 'wwts', kind: 'event-template', template: tpl }, null, 2) : null;
  }

  importJson(text) {
    const parsed = JSON.parse(text);
    const tpl = parsed?.kind === 'event-template' ? parsed.template : parsed;
    if (!tpl?.name || !tpl?.data) throw new Error('Not an event template');
    const copy = { ...tpl, id: `tpl_${Date.now().toString(36)}`, savedAt: new Date().toISOString() };
    this.list.push(copy);
    this.save();
    return copy;
  }
}

class EventTemplatesPanel {
  constructor(templates, { toast, download } = {}) {
    this.t = templates;
    this.toast = toast || (() => {});
    this.download = download;
  }

  init() {
    this.modal = document.getElementById('templates-modal');
    if (!this.modal) return;
    this.modal.addEventListener('tool-open', () => this.render());
    document.getElementById('tpl-save')?.addEventListener('click', () => {
      const name = document.getElementById('tpl-name').value;
      const tpl = this.t.saveAs(name);
      if (!tpl) return this.toast('Give the template a name');
      document.getElementById('tpl-name').value = '';
      this.toast(`🗂 Saved “${tpl.name}”`);
      this.render();
    });
    document.getElementById('tpl-import')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const tpl = this.t.importJson(await file.text());
        this.toast(`Imported “${tpl.name}”`);
      } catch (err) {
        this.toast(`Couldn't import: ${err.message}`);
      }
      e.target.value = '';
      this.render();
    });
    this.modal.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tpl]');
      if (!b) return;
      const id = b.closest('[data-id]').dataset.id;
      const tpl = this.t.list.find(x => x.id === id);
      if (b.dataset.tpl === 'apply' && this.t.apply(id)) this.toast(`🗂 “${tpl.name}” applied`);
      if (b.dataset.tpl === 'del' && confirm(`Delete the template “${tpl.name}”?`)) this.t.remove(id);
      if (b.dataset.tpl === 'export') this.download?.(new Blob([this.t.exportJson(id)], { type: 'application/json' }), `${tpl.name.replace(/[^a-z0-9]+/gi, '_')}.wwts-template.json`);
      this.render();
    });
  }

  render() {
    const el = document.getElementById('tpl-list');
    if (!el) return;
    el.innerHTML = this.t.list.length ? this.t.list.map(t => {
      const d = t.data || {};
      const bits = [
        d.scoring?.presetId ? `scoring: ${d.scoring.presetId}` : null,
        d.judges ? (d.judges.mode === 'panel' ? `${d.judges.count} judges` : 'solo judge') : null,
        d.settings ? `${d.settings.roundSeconds}s · ${d.settings.timeLimit}` : null,
        d.rules ? `OT ${d.rules.overtime ? 'on' : 'off'}` : null
      ].filter(Boolean).join(' · ');
      return `<li data-id="${t.id}"><div><b>${esc(t.name)}</b><small>${esc(bits)}</small></div>
        <span><button type="button" class="control-btn primary" data-tpl="apply">Apply</button><button type="button" class="fs-small" data-tpl="export">Export</button><button type="button" class="fs-small" data-tpl="del" aria-label="Delete">✕</button></span></li>`;
    }).join('') : '<li class="profile-muted">No templates yet. Set the night up the way you like it, then save it here.</li>';
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export { EventTemplates, EventTemplatesPanel };
