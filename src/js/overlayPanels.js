/**
 * Overlay Panels — every [data-overlay-panel] floating over the full-screen
 * stage gets a minimize button; minimized state is remembered per panel.
 * Stage View (V) hides all panels at once so only the 3D stage shows.
 */

const STORAGE_KEY = 'wwts_overlay_panels_v1';

class OverlayPanelManager {
  constructor() {
    this.minimized = this.loadState();
    this.onStageViewChange = null;
  }

  loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.minimized));
    } catch {
      // Storage blocked (private window) — minimized state just won't persist
    }
  }

  init() {
    document.querySelectorAll('[data-overlay-panel]').forEach(panel => {
      const id = panel.dataset.overlayPanel;

      const label = document.createElement('span');
      label.className = 'panel-min-label';
      label.textContent = panel.dataset.minLabel || id;
      panel.prepend(label);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'panel-min-btn';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setMinimized(id, !panel.classList.contains('is-minimized'));
      });
      panel.appendChild(btn);

      this.applyPanel(panel, !!this.minimized[id]);
    });

    document.getElementById('btn-stage-view')?.addEventListener('click', () => this.toggleStageView());
    document.getElementById('btn-show-ui')?.addEventListener('click', () => this.setStageView(false));

    window.addEventListener('keydown', (e) => {
      const tag = e.target.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.code === 'KeyV' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!document.getElementById('screen-battle')?.classList.contains('active')) return;
        e.preventDefault();
        this.toggleStageView();
      }
    });
  }

  applyPanel(panel, minimized) {
    panel.classList.toggle('is-minimized', minimized);
    const btn = panel.querySelector(':scope > .panel-min-btn');
    if (btn) {
      btn.textContent = minimized ? '+' : '–';
      btn.title = minimized ? 'Expand panel' : 'Minimize panel';
      btn.setAttribute('aria-expanded', String(!minimized));
    }
  }

  setMinimized(id, minimized) {
    const panel = document.querySelector(`[data-overlay-panel="${id}"]`);
    if (!panel) return;
    this.applyPanel(panel, minimized);
    this.minimized[id] = minimized;
    this.saveState();
  }

  isStageView() {
    return document.body.classList.contains('stage-only');
  }

  setStageView(on) {
    document.body.classList.toggle('stage-only', !!on);
    const btn = document.getElementById('btn-stage-view');
    if (btn) btn.classList.toggle('active', !!on);
    if (typeof this.onStageViewChange === 'function') this.onStageViewChange(!!on);
  }

  toggleStageView() {
    this.setStageView(!this.isStageView());
  }
}

export { OverlayPanelManager };
