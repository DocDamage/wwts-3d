/**
 * Guided tour (⚙ Tools → Guided tour, or the first-visit prompt): a spotlight
 * walks through the main parts of the app. Steps whose target isn't on screen
 * are skipped. Keyboard: → / Enter next, ← back, Esc ends.
 */

const DONE = 'wwts_tour_done_v1';

const STEPS = [
  { title: 'Welcome to WWTS', text: 'A quick walk through the beat-battle app: leagues, producers, the battle stage, judging and Fight Club. About a minute.' },
  { screen: 'leagues', target: '.main-nav-btn[data-screen="leagues"]', title: 'Leagues', text: 'Every battle belongs to a league. A league keeps its own standings, rules and history.' },
  { screen: 'leagues', target: '#btn-create-league', title: 'Create a league', text: 'Start here: name the league, then add the producers who compete in it.' },
  { screen: 'roster', target: '#btn-add-contestant', title: 'Producers', text: 'Add producers with a photo, colour and avatar. Their profile collects stats, badges and titles.' },
  { screen: 'battle', target: '#btn-primary-flow', title: 'Run the battle', text: 'This one button steps through the battle: load the beats, start each round, lock the scores.' },
  { screen: 'battle', target: '#btn-connect-judges', title: 'Judges on their phones', text: 'Judges scan a code and score from their phones. Their scores arrive here live.' },
  { screen: 'battle', target: '#btn-crowd-vote', title: 'Crowd vote', text: 'Let the audience vote from their phones too. The crowd result can count as a judge or as a tie-breaker.' },
  { screen: 'battle', target: '#btn-battle-rules', title: 'Rules', text: 'Overtime and tie-break rules for this league: what happens when the rounds are level.' },
  { screen: 'battle', target: '#btn-submit', title: 'Score the round', text: 'Your own scores go in here. Blind judging hides the names until the reveal.' },
  { screen: 'battle', target: '#btn-open-broadcast-popout', title: 'Stream it', text: 'Open the broadcast view on a second screen, or add the OBS overlays from the Tools menu.' },
  { target: '.main-nav-btn[data-screen="fight"]', title: 'Fight Club', text: 'Settle it in the ring: a 3D fighter with every producer\'s avatar, story ladders and training.' },
  { target: '#btn-tools', title: 'Tools', text: 'Backups, judge consistency, OBS overlays, MIDI and Stream Deck, live chat, accessibility and this tour.' },
  { target: '#btn-shortcuts-guide', title: 'Keyboard shortcuts', text: 'Press ? at any time for the shortcut sheet. That\'s it, enjoy the battle!' }
];

class Tour {
  constructor() {
    this.i = 0;
    this.el = null;
  }

  maybeAutoStart() {
    try { if (localStorage.getItem(DONE)) return; } catch { return; }
    const prompt = document.createElement('div');
    prompt.className = 'tour-prompt';
    prompt.setAttribute('role', 'dialog');
    prompt.setAttribute('aria-label', 'Guided tour');
    prompt.innerHTML = `<span>👋 New here? Take the one-minute tour.</span>
      <button type="button" class="control-btn primary" data-go>Show me</button>
      <button type="button" class="fs-small" data-no>Not now</button>`;
    document.body.appendChild(prompt);
    prompt.querySelector('[data-go]').addEventListener('click', () => { prompt.remove(); this.start(); });
    prompt.querySelector('[data-no]').addEventListener('click', () => { prompt.remove(); this.markDone(); });
  }

  markDone() {
    try { localStorage.setItem(DONE, '1'); } catch { /* storage blocked */ }
  }

  start() {
    document.querySelector('.tour-prompt')?.remove();
    this.end(false);
    this.returnFocus = document.activeElement;
    this.el = document.createElement('div');
    this.el.className = 'tour';
    this.el.innerHTML = `<div class="tour-spot"></div>
      <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text">
        <div class="tour-step" id="tour-step"></div>
        <h3 id="tour-title"></h3>
        <p id="tour-text"></p>
        <div class="tour-btns">
          <button type="button" class="fs-small" data-skip>Skip tour</button>
          <span class="tour-gap"></span>
          <button type="button" class="fs-small" data-back>Back</button>
          <button type="button" class="control-btn primary" data-next>Next</button>
        </div>
      </div>`;
    document.body.appendChild(this.el);
    this.el.querySelector('[data-skip]').addEventListener('click', () => this.end());
    this.el.querySelector('[data-back]').addEventListener('click', () => this.go(-1));
    this.el.querySelector('[data-next]').addEventListener('click', () => this.go(1));
    this.onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.end(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); this.go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.go(-1); }
      else if (e.key === 'Tab') this.trapFocus(e);
    };
    window.addEventListener('keydown', this.onKey, true);
    this.onResize = () => this.place();
    window.addEventListener('resize', this.onResize);
    this.i = 0;
    this.show();
  }

  trapFocus(e) {
    const items = [...this.el.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    e.preventDefault();
    items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
  }

  go(d) {
    let i = this.i + d;
    // skip steps whose target isn't available right now
    while (i >= 0 && i < STEPS.length && !this.available(STEPS[i])) i += d;
    if (i >= STEPS.length) return this.end();
    if (i < 0) return;
    this.i = i;
    this.show();
  }

  available(step) {
    if (!step.target) return true;
    if (step.screen) this.switchTo(step.screen);
    const t = document.querySelector(step.target);
    return !!(t && t.getClientRects().length);
  }

  switchTo(screen) {
    const btn = document.querySelector(`.main-nav-btn[data-screen="${screen}"]`);
    if (btn && !btn.classList.contains('active')) btn.click();
  }

  show() {
    const step = STEPS[this.i];
    if (step.screen) this.switchTo(step.screen);
    this.el.querySelector('#tour-step').textContent = `${this.i + 1} / ${STEPS.length}`;
    this.el.querySelector('#tour-title').textContent = step.title;
    this.el.querySelector('#tour-text').textContent = step.text;
    this.el.querySelector('[data-back]').disabled = this.i === 0;
    this.el.querySelector('[data-next]').textContent = this.i === STEPS.length - 1 ? 'Done' : 'Next';
    const t = step.target && document.querySelector(step.target);
    t?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    // let a screen switch lay out before measuring
    requestAnimationFrame(() => this.place());
    this.el.querySelector('[data-next]').focus();
  }

  place() {
    if (!this.el) return;
    const step = STEPS[this.i];
    const spot = this.el.querySelector('.tour-spot');
    const card = this.el.querySelector('.tour-card');
    const t = step.target && document.querySelector(step.target);
    const r = t?.getBoundingClientRect();
    if (!r || !r.width) {
      spot.classList.add('none');
      card.style.left = `${Math.max(16, (innerWidth - card.offsetWidth) / 2)}px`;
      card.style.top = `${Math.max(16, (innerHeight - card.offsetHeight) / 2)}px`;
      return;
    }
    spot.classList.remove('none');
    const pad = 6;
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const below = r.bottom + 12 + card.offsetHeight < innerHeight;
    const top = below ? r.bottom + 12 : Math.max(16, r.top - 12 - card.offsetHeight);
    const left = Math.min(Math.max(16, r.left + r.width / 2 - card.offsetWidth / 2), innerWidth - card.offsetWidth - 16);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  end(done = true) {
    if (!this.el) return;
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('resize', this.onResize);
    this.el.remove();
    this.el = null;
    if (done) {
      this.markDone();
      this.returnFocus?.focus?.();
    }
  }
}

export { Tour, STEPS };
