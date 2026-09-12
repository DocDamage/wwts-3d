/**
 * Producer Report Modal — Post-Battle Actionable Feedback & Performance Breakdown
 * Shows category comparisons, round tallies, judge notes, and timestamped track observations.
 */

class ProducerReportModal {
  constructor() {
    this.modalEl = null;
  }

  init() {
    if (typeof document === 'undefined') return;

    let modal = document.getElementById('producer-report-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'producer-report-modal';
      modal.className = 'modal-overlay producer-report-overlay';
      modal.style.display = 'none';
      document.body.appendChild(modal);
    }
    this.modalEl = modal;

    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.classList.contains('modal-close')) {
        this.close();
      }
    });
  }

  open(finalResult) {
    if (!this.modalEl || !finalResult) return;

    const c1 = finalResult.contestant1 || { name: 'Contestant 1' };
    const c2 = finalResult.contestant2 || { name: 'Contestant 2' };
    const p1Score = finalResult.seriesSummary?.grandTotal1 ?? (finalResult.roundResults?.[0]?.total1 || 0);
    const p2Score = finalResult.seriesSummary?.grandTotal2 ?? (finalResult.roundResults?.[0]?.total2 || 0);

    // Build Round by Round table
    let roundRows = '';
    (finalResult.roundResults || []).forEach(r => {
      const rTitle = r.isOvertime ? '⚡ Sudden Death OT' : `Round ${r.round}`;
      const winnerName = r.winner === 1 ? c1.name : (r.winner === 2 ? c2.name : 'Draw');
      const winClass = r.winner === 1 ? 'p1' : (r.winner === 2 ? 'p2' : 'draw');

      roundRows += `
        <tr>
          <td><strong>${rTitle}</strong></td>
          <td style="color:#ff4d4d;">${r.total1.toFixed(1)}</td>
          <td style="color:#00e5ff;">${r.total2.toFixed(1)}</td>
          <td class="verdict-col ${winClass}">➔ ${winnerName}</td>
        </tr>
      `;
    });

    // Build Category Comparison
    const categories = finalResult.scoringRules?.categories || [];
    let catBarsHtml = '';
    categories.forEach((cat, idx) => {
      if (cat.enabled === false) return;
      const s1 = finalResult.roundResults?.[0]?.scores1?.[idx] || 0;
      const s2 = finalResult.roundResults?.[0]?.scores2?.[idx] || 0;
      const w1 = (s1 / 10) * 100;
      const w2 = (s2 / 10) * 100;

      catBarsHtml += `
        <div class="report-cat-row">
          <div class="report-cat-label">
            <span>${cat.name}</span>
            <span class="report-cat-scores">${s1.toFixed(1)} vs ${s2.toFixed(1)}</span>
          </div>
          <div class="report-split-bar">
            <div class="split-left" style="width: ${w1}%;"></div>
            <div class="split-right" style="width: ${w2}%;"></div>
          </div>
        </div>
      `;
    });

    // Timestamped Notes
    let notesHtml = '';
    const tsNotes = finalResult.timestampedNotes || [];
    if (tsNotes.length > 0) {
      tsNotes.forEach(n => {
        const cName = n.contestant === 1 ? c1.name : c2.name;
        const color = n.contestant === 1 ? '#ff4d4d' : '#00e5ff';
        notesHtml += `
          <div class="report-timestamp-item">
            <span class="ts-time">${n.time}</span>
            <span class="ts-contestant" style="color:${color};">${cName}</span>
            <span class="ts-text">${this.escapeHtml(n.text)}</span>
          </div>
        `;
      });
    } else {
      notesHtml = '<p class="report-empty-notes">No timestamped producer notes recorded for this battle.</p>';
    }

    if (finalResult.notes) {
      notesHtml += `
        <div class="report-judge-notes">
          <strong>Overall Judge Notes:</strong>
          <p>${this.escapeHtml(finalResult.notes)}</p>
        </div>
      `;
    }

    this.modalEl.innerHTML = `
      <div class="modal-content producer-report-content">
        <div class="modal-header">
          <div>
            <h2>POST-BATTLE PRODUCER REPORT</h2>
            <span class="modal-sub">Certified Breakdown &amp; Performance Review</span>
          </div>
          <button class="modal-close">&times;</button>
        </div>

        <div class="producer-report-body">
          <!-- Banner -->
          <div class="report-verdict-banner">
            <div class="rv-left">
              <span class="rv-label">DECISION</span>
              <h3 class="rv-decision">${finalResult.decisionMethod} (${finalResult.decisionTally})</h3>
              <span class="rv-winner">Winner: <strong>${finalResult.winnerName}</strong></span>
            </div>
            <div class="rv-scores">
              <div class="rv-score-box p1">
                <span>${c1.name}</span>
                <strong>${p1Score.toFixed(1)}</strong>
              </div>
              <div class="rv-vs">VS</div>
              <div class="rv-score-box p2">
                <span>${c2.name}</span>
                <strong>${p2Score.toFixed(1)}</strong>
              </div>
            </div>
          </div>

          <!-- Round by Round Table -->
          <div class="report-section">
            <h4 class="report-sec-title">Round-by-Round Breakdown</h4>
            <table class="report-table">
              <thead>
                <tr>
                  <th>Round</th>
                  <th>${c1.name}</th>
                  <th>${c2.name}</th>
                  <th>Round Winner</th>
                </tr>
              </thead>
              <tbody>
                ${roundRows}
              </tbody>
            </table>
          </div>

          <!-- Category Comparison -->
          <div class="report-section">
            <h4 class="report-sec-title">Category Breakdown (Normalized 0-10)</h4>
            <div class="report-cats-wrap">
              ${catBarsHtml}
            </div>
          </div>

          <!-- Timestamped Notes -->
          <div class="report-section">
            <h4 class="report-sec-title">Timestamped Feedback &amp; Producer Notes</h4>
            <div class="report-notes-list">
              ${notesHtml}
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="control-btn secondary" id="btn-copy-report">📋 Copy Report</button>
          <button class="control-btn primary" id="btn-close-report">Close</button>
        </div>
      </div>
    `;

    document.getElementById('btn-close-report')?.addEventListener('click', () => this.close());
    document.getElementById('btn-copy-report')?.addEventListener('click', () => {
      this.copyReportText(finalResult);
    });

    this.modalEl.style.display = 'flex';
  }

  close() {
    if (this.modalEl) this.modalEl.style.display = 'none';
  }

  copyReportText(finalResult) {
    const c1 = finalResult.contestant1?.name || 'Contestant 1';
    const c2 = finalResult.contestant2?.name || 'Contestant 2';
    const s1 = finalResult.seriesSummary?.grandTotal1 ?? 0;
    const s2 = finalResult.seriesSummary?.grandTotal2 ?? 0;

    const summary = `
WWTS BEAT BATTLE REPORT
Match: ${c1} (${s1.toFixed(1)}) vs ${c2} (${s2.toFixed(1)})
Winner: ${finalResult.winnerName}
Decision: ${finalResult.decisionMethod} (${finalResult.decisionTally})
Date: ${new Date(finalResult.timestamp).toLocaleString()}
${finalResult.notes ? `Notes: ${finalResult.notes}` : ''}
    `.trim();

    navigator.clipboard?.writeText(summary).then(() => {
      alert('Report copied to clipboard!');
    }).catch(() => {});
  }

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

export { ProducerReportModal };
