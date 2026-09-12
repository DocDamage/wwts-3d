/**
 * Battle Scorecard Exporter — High-Res Broadcast PNG Generator
 * Generates an official 1080x1080 social media battle card ready for
 * Instagram, Discord, Twitter, or Twitch broadcast streams.
 */

class BattleCardExporter {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1080;
    this.canvas.height = 1080;
    this.ctx = this.canvas.getContext('2d');
  }

  /**
   * Generates and downloads card directly from an official FinalizedBattleResult
   */
  async exportFinalizedCard(finalResult, leagueName = 'WHO WANT THAT SMOKE') {
    if (!finalResult) return null;
    const c1Name = finalResult.contestant1?.name || 'Contestant 1';
    const c2Name = finalResult.contestant2?.name || 'Contestant 2';
    const c1Score = finalResult.seriesSummary?.grandTotal1 ?? (finalResult.roundResults?.[0]?.total1 || 0);
    const c2Score = finalResult.seriesSummary?.grandTotal2 ?? (finalResult.roundResults?.[0]?.total2 || 0);
    const c1Scores = finalResult.roundResults?.[0]?.scores1 || [];
    const c2Scores = finalResult.roundResults?.[0]?.scores2 || [];
    const winnerName = finalResult.winnerName || 'CHAMPION';
    const decisionBadge = `${finalResult.decisionMethod || 'OFFICIAL'} ${finalResult.decisionTally || ''}`.trim();
    const seriesBadge = finalResult.seriesSummary?.hasSeries
      ? `${finalResult.seriesSummary.roundsWon1} - ${finalResult.seriesSummary.roundsWon2} Series`
      : null;

    return this.exportCard({
      c1Name,
      c1Score,
      c1Scores,
      c2Name,
      c2Score,
      c2Scores,
      winnerName,
      leagueName,
      decisionBadge,
      seriesBadge,
      isDemo: !!finalResult.isDemo
    });
  }

  /**
   * Generates and downloads the official battle card
   */
  async exportCard({ c1Name, c1Score, c1Scores, c2Name, c2Score, c2Scores, winnerName, leagueName, decisionBadge, seriesBadge, isDemo }) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // 1. Deep Arena Gradient Background
    const bgGrad = ctx.createRadialGradient(w / 2, h * 0.35, 100, w / 2, h / 2, 800);
    bgGrad.addColorStop(0, '#151928');
    bgGrad.addColorStop(0.5, '#0c0e17');
    bgGrad.addColorStop(1, '#05060a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Subtle Hex / Grid pattern
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Outer Neon Double Border
    ctx.strokeStyle = 'rgba(255, 45, 45, 0.6)';
    ctx.lineWidth = 4;
    ctx.strokeRect(24, 24, w - 48, h - 48);

    ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(32, 32, w - 64, h - 64);

    // 2. Header
    ctx.save();
    ctx.font = 'bold 22px "Orbitron", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffaa00';
    ctx.letterSpacing = '4px';
    ctx.fillText((leagueName || 'WHO WANT THAT SMOKE').toUpperCase(), w / 2, 85);

    ctx.font = 'bold 54px "Bebas Neue", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ff2d2d';
    ctx.shadowBlur = 18;
    ctx.fillText('OFFICIAL BATTLE SCORECARD', w / 2, 145);
    ctx.restore();

    // Series or Decision Badge if present
    const subBadge = decisionBadge || seriesBadge;
    if (subBadge) {
      ctx.save();
      ctx.font = 'bold 16px "Orbitron", monospace';
      ctx.fillStyle = '#ffaa00';
      ctx.textAlign = 'center';
      ctx.fillText(`★  ${subBadge.toUpperCase()}  ★`, w / 2, 175);
      ctx.restore();
    }

    // 3. Contestant Head-to-Head Cards
    // Left Box (Contestant 1 - Red)
    ctx.save();
    ctx.fillStyle = 'rgba(255, 45, 45, 0.08)';
    ctx.strokeStyle = '#ff2d2d';
    ctx.lineWidth = 3;
    ctx.fillRect(60, 200, 420, 220);
    ctx.strokeRect(60, 200, 420, 220);

    ctx.font = 'bold 36px "Bebas Neue", sans-serif';
    ctx.fillStyle = '#ff4d4d';
    ctx.textAlign = 'center';
    ctx.fillText((c1Name || 'CONTESTANT 1').toUpperCase().slice(0, 18), 270, 260);

    ctx.font = 'bold 84px "Orbitron", monospace';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ff2d2d';
    ctx.shadowBlur = 20;
    ctx.fillText(Number(c1Score || 0).toFixed(1), 270, 360);

    ctx.font = 'bold 16px "Orbitron", monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText('TOTAL POINTS', 270, 395);
    ctx.restore();

    // VS Center Badge
    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, 310, 45, 0, Math.PI * 2);
    ctx.fillStyle = '#111420';
    ctx.fill();
    ctx.strokeStyle = '#ffaa00';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.font = 'bold 36px "Bebas Neue", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffaa00';
    ctx.fillText('VS', w / 2, 312);
    ctx.restore();

    // Right Box (Contestant 2 - Cyan)
    ctx.save();
    ctx.fillStyle = 'rgba(0, 229, 255, 0.08)';
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 3;
    ctx.fillRect(w - 480, 200, 420, 220);
    ctx.strokeRect(w - 480, 200, 420, 220);

    ctx.font = 'bold 36px "Bebas Neue", sans-serif';
    ctx.fillStyle = '#00e5ff';
    ctx.textAlign = 'center';
    ctx.fillText((c2Name || 'CONTESTANT 2').toUpperCase().slice(0, 18), w - 270, 260);

    ctx.font = 'bold 84px "Orbitron", monospace';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 20;
    ctx.fillText(Number(c2Score || 0).toFixed(1), w - 270, 360);

    ctx.font = 'bold 16px "Orbitron", monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText('TOTAL POINTS', w - 270, 395);
    ctx.restore();

    // 4. Winner Banner
    ctx.save();
    ctx.translate(w / 2, 490);
    ctx.rotate(-0.02);

    const bannerW = 680;
    const bannerH = 65;
    const bannerGrad = ctx.createLinearGradient(-bannerW / 2, 0, bannerW / 2, 0);
    bannerGrad.addColorStop(0, '#ff2d2d');
    bannerGrad.addColorStop(0.5, '#ffaa00');
    bannerGrad.addColorStop(1, '#00e5ff');

    ctx.fillStyle = bannerGrad;
    ctx.fillRect(-bannerW / 2, -bannerH / 2, bannerW, bannerH);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(-bannerW / 2, -bannerH / 2, bannerW, bannerH);

    ctx.font = 'bold 34px "Bebas Neue", sans-serif';
    ctx.fillStyle = '#0a0c12';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`🏆 WINNER: ${(winnerName || 'CHAMPION').toUpperCase()}`, 0, 2);
    ctx.restore();

    // 5. Category Breakdown Bars
    const categories = [
      { key: 'originality', label: 'ORIGINALITY' },
      { key: 'rhythm',      label: 'RHYTHM & FLOW' },
      { key: 'soundDesign', label: 'SOUND DESIGN' },
      { key: 'mixQuality',  label: 'MIX QUALITY' },
      { key: 'crowdImpact', label: 'CROWD IMPACT' }
    ];

    const startY = 580;
    const rowHeight = 72;
    const barMaxW = 340;

    const getCatScore = (scores, key, idx) => {
      if (Array.isArray(scores)) {
        if (idx === 0) return scores[0] || 0;
        if (idx === 1) return ((scores[1] || 0) + (scores[3] || 0)) / 2;
        if (idx === 2) return ((scores[4] || 0) + (scores[9] || 0)) / 2;
        if (idx === 3) return ((scores[2] || 0) + (scores[8] || 0)) / 2;
        if (idx === 4) return ((scores[6] || 0) + (scores[7] || 0)) / 2;
      } else if (scores && typeof scores === 'object') {
        return scores[key] || 0;
      }
      return 0;
    };

    categories.forEach((cat, idx) => {
      const y = startY + idx * rowHeight;
      const s1 = getCatScore(c1Scores, cat.key, idx);
      const s2 = getCatScore(c2Scores, cat.key, idx);

      // Label Center
      ctx.font = 'bold 18px "Orbitron", monospace';
      ctx.fillStyle = '#eaeef8';
      ctx.textAlign = 'center';
      ctx.fillText(cat.label, w / 2, y + 8);

      // Contestant 1 Score (Left)
      ctx.font = 'bold 20px "Orbitron", monospace';
      ctx.fillStyle = '#ff4d4d';
      ctx.textAlign = 'right';
      ctx.fillText(s1.toFixed(1), w / 2 - 130, y + 8);

      // Contestant 1 Bar (Extends left from center)
      const w1 = (s1 / 10) * barMaxW;
      ctx.fillStyle = 'rgba(255, 45, 45, 0.18)';
      ctx.fillRect(w / 2 - 150 - barMaxW, y - 6, barMaxW, 18);
      ctx.fillStyle = '#ff2d2d';
      ctx.fillRect(w / 2 - 150 - w1, y - 6, w1, 18);

      // Contestant 2 Score (Right)
      ctx.font = 'bold 20px "Orbitron", monospace';
      ctx.fillStyle = '#00e5ff';
      ctx.textAlign = 'left';
      ctx.fillText(s2.toFixed(1), w / 2 + 130, y + 8);

      // Contestant 2 Bar (Extends right from center)
      const w2 = (s2 / 10) * barMaxW;
      ctx.fillStyle = 'rgba(0, 229, 255, 0.18)';
      ctx.fillRect(w / 2 + 150, y - 6, barMaxW, 18);
      ctx.fillStyle = '#00e5ff';
      ctx.fillRect(w / 2 + 150, y - 6, w2, 18);
    });

    // 6. Footer Stamp
    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    ctx.font = '14px "Orbitron", monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.textAlign = 'center';
    ctx.fillText(`BEATBATTLE ARENA • CERTIFIED RESULTS • ${dateStr.toUpperCase()}`, w / 2, 1020);

    // 7. Trigger download
    const dataUrl = this.canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    const cleanC1 = (c1Name || 'C1').replace(/[^a-zA-Z0-9]/g, '_');
    const cleanC2 = (c2Name || 'C2').replace(/[^a-zA-Z0-9]/g, '_');
    a.download = `WWTS_BattleCard_${cleanC1}_vs_${cleanC2}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    return dataUrl;
  }
}

export { BattleCardExporter };
