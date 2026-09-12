/**
 * Storage & Recovery Manager — Continuous Event Autosave, Crash Recovery,
 * and Full Offline Event Backup/Restore.
 *
 * Ensures refreshing halfway through judging a round loses nothing.
 */

const ACTIVE_SESSION_KEY = 'wwts_active_battle_session';
const EVENT_DATABASE_KEY = 'wwts_event_full_database';

class BattleStorageManager {
  constructor() {
    this.storageAvailable = this.checkStorageAvailable();
  }

  checkStorageAvailable() {
    try {
      if (typeof localStorage === 'undefined') return false;
      const testKey = '__wwts_test__';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Continuously save active session state
   */
  saveActiveSession(data) {
    if (!this.storageAvailable || !data) return;

    try {
      const payload = {
        ...data,
        savedAt: new Date().toISOString()
      };
      localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn('BattleStorageManager: Failed to autosave session', e);
    }
  }

  /**
   * Check if a recoverable in-progress battle exists
   */
  hasActiveSession() {
    if (!this.storageAvailable) return false;
    try {
      const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      return !!(data && (data.c1Id || data.c2Id) && !data.isFinalized);
    } catch {
      return false;
    }
  }

  /**
   * Load active in-progress battle session
   */
  loadActiveSession() {
    if (!this.storageAvailable) return null;
    try {
      const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Clear active session after completion or discard
   */
  clearActiveSession() {
    if (!this.storageAvailable) return;
    try {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
    } catch {}
  }

  /**
   * Export complete event backup as downloadable JSON
   */
  exportEventBackup(context = {}) {
    const backup = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      leagues: context.leagues || [],
      roster: context.roster || [],
      history: context.history || [],
      tournament: context.tournament || null,
      activeSession: this.loadActiveSession()
    };

    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(backup, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    const dateTag = new Date().toISOString().slice(0, 10);
    downloadAnchor.setAttribute('download', `WWTS_Event_Backup_${dateTag}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    return backup;
  }

  /**
   * Parse and validate an imported event backup
   */
  parseBackupJSON(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid backup file structure.');
      }
      return {
        valid: true,
        data
      };
    } catch (err) {
      return {
        valid: false,
        error: err.message
      };
    }
  }
}

export { BattleStorageManager, ACTIVE_SESSION_KEY };
