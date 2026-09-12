/**
 * Battle Notes — free-text notepad saved alongside battle history
 */

class NotesManager {
  constructor() {
    this.currentNote = '';
  }

  init() {
    const textarea = document.getElementById('notes-textarea');
    if (textarea) {
      textarea.addEventListener('input', (e) => {
        this.currentNote = e.target.value;
      });
    }
  }

  getCurrentNote() {
    return this.currentNote;
  }

  clear() {
    this.currentNote = '';
    const textarea = document.getElementById('notes-textarea');
    if (textarea) textarea.value = '';
  }

  /**
   * Render saved notes from history
   */
  renderSavedNotes(containerId, battles) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    const battlesWithNotes = battles.filter(b => b.notes && b.notes.trim());
    if (battlesWithNotes.length === 0) return;

    battlesWithNotes.forEach(battle => {
      const note = document.createElement('div');
      note.className = 'saved-note';
      note.innerHTML = `
        <div class="note-header">
          <span>${battle.contestant1Name} vs ${battle.contestant2Name}</span>
          <span>${new Date(battle.timestamp).toLocaleDateString()}</span>
        </div>
        <div class="note-body">${this.escapeHtml(battle.notes)}</div>
      `;
      container.appendChild(note);
    });
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

export { NotesManager };
