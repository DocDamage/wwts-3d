/**
 * Per-league battle rules: overtime and the tie-break chain.
 *
 * When a battle is still level (rounds tied after any overtime, or a drawn
 * single round / panel), the chain is tried in order until one step separates
 * the two producers:
 *   total          higher combined points across every round
 *   category:<n>   higher combined score in one category (e.g. Creativity)
 *   audience       more audience votes (phones)
 *   judge          the head judge makes the call (host is asked)
 *   draw           stop here: it's a draw
 */

const DEFAULT_RULES = {
  overtime: true,
  overtimeSeconds: 60,
  tieBreaks: ['total', 'draw']
};

const TIE_BREAK_LABELS = {
  total: 'Total points',
  audience: 'Audience vote',
  judge: 'Head judge decides',
  draw: 'Allow a draw'
};

function rulesFor(league) {
  const r = { ...DEFAULT_RULES, ...(league?.rules || {}) };
  if (!Array.isArray(r.tieBreaks) || !r.tieBreaks.length) r.tieBreaks = [...DEFAULT_RULES.tieBreaks];
  return r;
}

function labelOf(step) {
  if (step.startsWith('category:')) return `Higher ${step.slice(9)} score`;
  return TIE_BREAK_LABELS[step] || step;
}

/**
 * Walk the chain. ctx: { grandTotal1, grandTotal2, rounds (seriesData.rounds or null),
 *   scoringSnapshot, categories: [names], audience: {1,2} | null, names: {1,2},
 *   askJudge(names) -> 1 | 2 | null }
 * Returns { winner: 1|2|null, method, label }
 */
function resolveTie(rules, ctx) {
  const rounds = ctx.rounds ? Object.values(ctx.rounds).filter(r => r && (r.total1 > 0 || r.total2 > 0)) : [];
  const fmt = (a, b) => `${a.toFixed(2)} - ${b.toFixed(2)}`;
  for (const step of rules.tieBreaks) {
    if (step === 'draw') return { winner: null, method: 'draw', label: 'Draw' };
    if (step === 'total') {
      const a = ctx.grandTotal1 || 0;
      const b = ctx.grandTotal2 || 0;
      if (Math.abs(a - b) > 1e-6) return { winner: a > b ? 1 : 2, method: 'total', label: `Total points ${fmt(Math.max(a, b), Math.min(a, b))}` };
      continue;
    }
    if (step.startsWith('category:')) {
      const name = step.slice(9);
      const idx = (ctx.categories || []).indexOf(name);
      if (idx < 0) continue;
      const sum = (key) => (rounds.length ? rounds.reduce((s, r) => s + (r[key]?.[idx] || 0), 0) : (ctx.scoringSnapshot?.[key]?.[idx] || 0));
      const a = sum('scores1');
      const b = sum('scores2');
      if (Math.abs(a - b) > 1e-6) return { winner: a > b ? 1 : 2, method: 'category', label: `${name} ${fmt(Math.max(a, b), Math.min(a, b))}` };
      continue;
    }
    if (step === 'audience') {
      const v = ctx.audience;
      if (v && v[1] !== v[2]) return { winner: v[1] > v[2] ? 1 : 2, method: 'audience', label: `Audience ${Math.max(v[1], v[2])} - ${Math.min(v[1], v[2])}` };
      continue;
    }
    if (step === 'judge') {
      const w = ctx.askJudge?.(ctx.names);
      if (w === 1 || w === 2) return { winner: w, method: 'judge', label: "Head judge's call" };
      continue;
    }
  }
  return { winner: null, method: 'draw', label: 'Draw' };
}

/* ------------------------------------------------------------------ */
/* Rules editor */

class RulesPanel {
  constructor({ leagues, scoring, rounds, toast }) {
    this.leagues = leagues;
    this.scoring = scoring;
    this.rounds = rounds;
    this.toast = toast || (() => {});
  }

  init() {
    this.modal = document.getElementById('rules-modal');
    if (!this.modal) return;
    document.getElementById('btn-battle-rules')?.addEventListener('click', () => this.open());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal || e.target.closest('[data-close="rules-modal"]')) this.modal.style.display = 'none';
    });
    document.getElementById('rules-add-step')?.addEventListener('click', () => {
      const sel = document.getElementById('rules-step-picker');
      if (sel?.value) { this.chain.push(sel.value); this.renderChain(); }
    });
    document.getElementById('rules-save')?.addEventListener('click', () => this.save());
    this.apply();
  }

  /** Push the active league's overtime settings into the round manager */
  apply() {
    const r = rulesFor(this.leagues.getActive());
    if (this.rounds) {
      this.rounds.overtimeEnabled = r.overtime;
      this.rounds.overtimeSeconds = r.overtimeSeconds;
    }
    return r;
  }

  open() {
    const league = this.leagues.getActive();
    if (!league) { this.toast('Pick a league first'); return; }
    const r = rulesFor(league);
    this.chain = [...r.tieBreaks];
    document.getElementById('rules-league-name').textContent = league.name;
    document.getElementById('rules-overtime').checked = r.overtime;
    document.getElementById('rules-ot-seconds').value = r.overtimeSeconds;
    const picker = document.getElementById('rules-step-picker');
    const cats = (this.scoring?.categories || []).filter(c => c.enabled !== false).map(c => c.name);
    picker.innerHTML = '';
    ['total', 'audience', 'judge', ...cats.map(c => 'category:' + c), 'draw'].forEach(step => picker.appendChild(new Option(labelOf(step), step)));
    this.renderChain();
    this.modal.style.display = '';
  }

  renderChain() {
    const list = document.getElementById('rules-chain');
    list.innerHTML = '';
    this.chain.forEach((step, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="rules-num">${i + 1}</span><span class="rules-step">${labelOf(step)}</span>
        <button type="button" class="fs-small" data-act="up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="fs-small" data-act="down" aria-label="Move down" ${i === this.chain.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="fs-small" data-act="del" aria-label="Remove">✕</button>`;
      li.querySelector('[data-act=up]').onclick = () => { [this.chain[i - 1], this.chain[i]] = [this.chain[i], this.chain[i - 1]]; this.renderChain(); };
      li.querySelector('[data-act=down]').onclick = () => { [this.chain[i + 1], this.chain[i]] = [this.chain[i], this.chain[i + 1]]; this.renderChain(); };
      li.querySelector('[data-act=del]').onclick = () => { this.chain.splice(i, 1); this.renderChain(); };
      list.appendChild(li);
    });
    if (!this.chain.includes('draw')) {
      const li = document.createElement('li');
      li.className = 'rules-hint';
      li.textContent = 'If every step is still level, the battle is a draw.';
      list.appendChild(li);
    }
  }

  save() {
    const league = this.leagues.getActive();
    if (!league) return;
    const rules = {
      overtime: document.getElementById('rules-overtime').checked,
      overtimeSeconds: Math.max(15, Math.min(300, parseInt(document.getElementById('rules-ot-seconds').value, 10) || 60)),
      tieBreaks: [...this.chain]
    };
    this.leagues.update(league.id, { rules });
    this.apply();
    this.modal.style.display = 'none';
    this.toast(`Battle rules saved for ${league.name}`);
  }
}

export { DEFAULT_RULES, rulesFor, resolveTie, labelOf, RulesPanel };
