/**
 * Who plays first: a visible coin flip at the start of a battle, then the order
 * alternates every round (round 1: winner of the flip, round 2: the other one,
 * final: flip winner again, overtime: the other one).
 */

class PlayOrder {
  constructor() {
    this.first = 1;        // slot that plays first in round 1
    this.flipped = false;  // has tonight's flip for this battle happened?
  }

  /** [first, second] slot numbers for a round */
  orderFor(round) {
    const a = this.first;
    const b = a === 1 ? 2 : 1;
    return (Number(round) || 1) % 2 === 1 ? [a, b] : [b, a];
  }

  /** Random flip; `rand` is injectable for tests */
  flip(rand = Math.random) {
    this.first = rand() < 0.5 ? 1 : 2;
    this.flipped = true;
    return this.first;
  }

  set(first) {
    this.first = first === 2 ? 2 : 1;
    this.flipped = true;
  }

  reset() {
    this.first = 1;
    this.flipped = false;
  }

  exportState() { return { first: this.first, flipped: this.flipped }; }

  importState(s) {
    if (!s) return;
    this.first = s.first === 2 ? 2 : 1;
    this.flipped = !!s.flipped;
  }
}

/**
 * The coin on the host screen: spins, lands on the producer who goes first.
 * Resolves when the animation is done. Reduced motion skips the spin.
 */
function showCoinFlip(firstName, secondName, firstSlot, { reduced = false } = {}) {
  return new Promise(resolve => {
    document.querySelector('.coin-flip')?.remove();
    const el = document.createElement('div');
    el.className = 'coin-flip';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    const heads = firstSlot === 1;
    el.innerHTML = `
      <div class="coin-stage">
        <div class="coin ${reduced ? 'still' : ''} ${heads ? 'land-heads' : 'land-tails'}">
          <div class="coin-face heads p1"><span>${escapeHtml(heads ? firstName : secondName)}</span></div>
          <div class="coin-face tails p2"><span>${escapeHtml(heads ? secondName : firstName)}</span></div>
        </div>
      </div>
      <div class="coin-caption">🪙 Coin flip for the order…</div>`;
    document.body.appendChild(el);
    const caption = el.querySelector('.coin-caption');
    const land = reduced ? 300 : 2300;
    setTimeout(() => {
      caption.innerHTML = `<b>${escapeHtml(firstName)}</b> plays first`;
      el.classList.add('landed');
    }, land);
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => { el.remove(); resolve(firstSlot); }, 400);
    }, land + 1700);
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export { PlayOrder, showCoinFlip };
