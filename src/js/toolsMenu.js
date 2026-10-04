/**
 * Header "⚙ Tools" menu: opens the tool modals (data-open="<modal id>") or fires
 * actions (data-action="tour" → onAction('tour')). Keyboard friendly: Enter /
 * Space opens, arrows move, Escape closes and returns focus.
 */
class ToolsMenu {
  constructor({ onAction } = {}) {
    this.onAction = onAction || (() => {});
  }

  init() {
    this.btn = document.getElementById('btn-tools');
    this.menu = document.getElementById('tools-menu');
    if (!this.btn || !this.menu) return;
    this.btn.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
    this.menu.addEventListener('click', (e) => {
      const item = e.target.closest('button');
      if (!item) return;
      this.close();
      if (item.dataset.open) this.openModal(item.dataset.open);
      if (item.dataset.action) this.onAction(item.dataset.action);
    });
    this.menu.addEventListener('keydown', (e) => {
      const items = [...this.menu.querySelectorAll('button')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      if (e.key === 'Escape') { e.preventDefault(); this.close(); this.btn.focus(); }
    });
    document.addEventListener('click', (e) => { if (!this.menu.hidden && !this.menu.contains(e.target)) this.close(); });
    // Close buttons inside any tool modal
    document.addEventListener('click', (e) => {
      const close = e.target.closest('[data-close]');
      if (close && close.dataset.close && document.getElementById(close.dataset.close)?.classList.contains('tool-modal')) this.closeModal(close.dataset.close);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.tool-modal').forEach(m => { if (m.style.display !== 'none') this.closeModal(m.id); });
    });
  }

  toggle() {
    if (this.menu.hidden) this.open(); else this.close();
  }

  open() {
    this.menu.hidden = false;
    this.btn.setAttribute('aria-expanded', 'true');
    this.menu.querySelector('button')?.focus();
  }

  close() {
    this.menu.hidden = true;
    this.btn.setAttribute('aria-expanded', 'false');
  }

  openModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    this._returnFocus = document.activeElement;
    m.style.display = '';
    m.dispatchEvent(new CustomEvent('tool-open'));
    m.querySelector('button, [href], input, select, textarea')?.focus();
  }

  closeModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.style.display = 'none';
    (this._returnFocus || this.btn)?.focus?.();
  }
}

export { ToolsMenu };
