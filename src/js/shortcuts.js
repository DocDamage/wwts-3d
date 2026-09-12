/**
 * Keyboard Shortcuts Manager — Pro Hotkeys for Live Beat Battle Production
 * Gives the operator rapid-fire control over timer, rounds, smoke blasts,
 * soundboard hits, announcer calls, and judge switching.
 */

class KeyboardShortcutsManager {
  constructor(handlers = {}) {
    this.handlers = handlers; // { onTimerToggle, onSubmit, onReset, onSmoke, onHype, onRound, onJudgeCycle, onStreamMode, onScratch, onDjAction }
    this.modalOpen = false;
  }

  init() {
    window.addEventListener('keydown', (e) => this.handleKeyDown(e));

    // Shortcut button in header
    const shortcutsBtn = document.getElementById('btn-shortcuts-guide');
    if (shortcutsBtn) {
      shortcutsBtn.addEventListener('click', () => this.toggleModal());
    }

    // Modal close buttons
    const closeBtn = document.querySelector('[data-close="shortcuts-modal"]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeModal());
    }

    const modal = document.getElementById('shortcuts-modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeModal();
      });
    }
  }

  handleKeyDown(e) {
    // Ignore hotkeys when typing in form inputs, textareas, or selects
    const tag = e.target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (e.key === 'Escape') {
        e.target.blur();
      }
      return;
    }

    // Modal toggle with '?'
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      this.toggleModal();
      return;
    }

    if (e.key === 'Escape') {
      this.closeModal();
      return;
    }

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (typeof this.handlers.onTimerToggle === 'function') {
          this.handlers.onTimerToggle();
        }
        break;

      case 'Enter':
        e.preventDefault();
        if (typeof this.handlers.onSubmit === 'function') {
          this.handlers.onSubmit();
        }
        break;

      case 'KeyR':
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          if (typeof this.handlers.onReset === 'function') {
            this.handlers.onReset();
          }
        }
        break;

      case 'KeyC':
        e.preventDefault();
        if (typeof this.handlers.onSmoke === 'function') {
          this.handlers.onSmoke();
        }
        break;

      case 'KeyH':
        e.preventDefault();
        if (typeof this.handlers.onHype === 'function') {
          this.handlers.onHype();
        }
        break;

      case 'Digit1':
      case 'Numpad1':
        if (e.altKey || e.ctrlKey) return;
        if (typeof this.handlers.onRound === 'function') {
          this.handlers.onRound(1);
        }
        break;

      case 'Digit2':
      case 'Numpad2':
        if (e.altKey || e.ctrlKey) return;
        if (typeof this.handlers.onRound === 'function') {
          this.handlers.onRound(2);
        }
        break;

      case 'Digit3':
      case 'Numpad3':
        if (e.altKey || e.ctrlKey) return;
        if (typeof this.handlers.onRound === 'function') {
          this.handlers.onRound(3);
        }
        break;

      case 'Digit4':
      case 'Numpad4':
        if (e.altKey || e.ctrlKey) return;
        if (typeof this.handlers.onRound === 'function') {
          this.handlers.onRound(4);
        }
        break;

      case 'KeyJ':
        e.preventDefault();
        if (typeof this.handlers.onJudgeCycle === 'function') {
          this.handlers.onJudgeCycle();
        }
        break;

      case 'KeyM':
        e.preventDefault();
        if (typeof this.handlers.onStreamMode === 'function') {
          this.handlers.onStreamMode();
        }
        break;

      case 'KeyS':
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          if (typeof this.handlers.onScratch === 'function') {
            this.handlers.onScratch();
          }
        }
        break;

      case 'KeyD':
        e.preventDefault();
        if (typeof this.handlers.onDjAction === 'function') {
          this.handlers.onDjAction();
        }
        break;
    }
  }

  toggleModal() {
    const modal = document.getElementById('shortcuts-modal');
    if (!modal) return;
    if (modal.style.display === 'none' || !modal.style.display) {
      this.openModal();
    } else {
      this.closeModal();
    }
  }

  openModal() {
    const modal = document.getElementById('shortcuts-modal');
    if (modal) modal.style.display = '';
    this.modalOpen = true;
  }

  closeModal() {
    const modal = document.getElementById('shortcuts-modal');
    if (modal) modal.style.display = 'none';
    this.modalOpen = false;
  }
}

export { KeyboardShortcutsManager };
