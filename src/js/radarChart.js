/**
 * Score Radar Chart — Live Head-to-Head 5-Axis Spider Chart
 * Visualizes Contestant 1 (Ember Red) vs Contestant 2 (Neon Cyan)
 * across Originality, Rhythm/Flow, Sound Design, Mix Quality, and Crowd Impact.
 */

class ScoreRadarChart {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;

    this.categories = [
      { key: 'originality', label: 'ORIGINALITY' },
      { key: 'rhythm',      label: 'RHYTHM/FLOW' },
      { key: 'soundDesign', label: 'SOUND DESIGN' },
      { key: 'mixQuality',  label: 'MIX QUALITY' },
      { key: 'crowdImpact', label: 'CROWD IMPACT' }
    ];

    this.scores1 = [0, 0, 0, 0, 0];
    this.scores2 = [0, 0, 0, 0, 0];
    this.targetScores1 = [0, 0, 0, 0, 0];
    this.targetScores2 = [0, 0, 0, 0, 0];

    this.animating = false;
    if (this.canvas) {
      this.render();
    }
  }

  update(scores1, scores2) {
    this.targetScores1 = this.extractSpokes(scores1);
    this.targetScores2 = this.extractSpokes(scores2);

    if (!this.animating) {
      this.animating = true;
      this.animateLoop();
    }
  }

  extractSpokes(input) {
    if (Array.isArray(input)) {
      // Input is 10-element array from ScoringEngine:
      // 0: Creativity, 1: Versatility, 2: Mix, 3: Drums, 4: Melody,
      // 5: Bassline, 6: Energy, 7: Battle, 8: Arrangement, 9: Sound Selection
      const s0 = input[0] || 0;
      const s1 = ((input[1] || 0) + (input[3] || 0)) / 2;
      const s2 = ((input[4] || 0) + (input[9] || 0)) / 2;
      const s3 = ((input[2] || 0) + (input[8] || 0)) / 2;
      const s4 = ((input[6] || 0) + (input[7] || 0)) / 2;
      return [s0, s1, s2, s3, s4];
    } else if (input && typeof input === 'object') {
      return this.categories.map(c => input[c.key] || 0);
    }
    return [0, 0, 0, 0, 0];
  }

  animateLoop() {
    let changed = false;
    for (let i = 0; i < 5; i++) {
      const diff1 = this.targetScores1[i] - this.scores1[i];
      const diff2 = this.targetScores2[i] - this.scores2[i];

      if (Math.abs(diff1) > 0.05) {
        this.scores1[i] += diff1 * 0.18;
        changed = true;
      } else {
        this.scores1[i] = this.targetScores1[i];
      }

      if (Math.abs(diff2) > 0.05) {
        this.scores2[i] += diff2 * 0.18;
        changed = true;
      } else {
        this.scores2[i] = this.targetScores2[i];
      }
    }

    this.render();

    if (changed) {
      requestAnimationFrame(() => this.animateLoop());
    } else {
      this.animating = false;
    }
  }

  render() {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const maxRadius = Math.min(cx, cy) - 34;

    ctx.clearRect(0, 0, w, h);

    const numAxes = this.categories.length;
    const angleStep = (Math.PI * 2) / numAxes;
    const startAngle = -Math.PI / 2; // top vertex

    // 1. Concentric Grid Polygons (levels 2, 4, 6, 8, 10)
    const levels = [0.2, 0.4, 0.6, 0.8, 1.0];
    levels.forEach(lvl => {
      ctx.beginPath();
      for (let i = 0; i < numAxes; i++) {
        const ang = startAngle + i * angleStep;
        const r = maxRadius * lvl;
        const x = cx + Math.cos(ang) * r;
        const y = cy + Math.sin(ang) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = lvl === 1.0 ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.07)';
      ctx.lineWidth = lvl === 1.0 ? 1.5 : 1;
      ctx.stroke();

      if (lvl === 1.0) {
        ctx.fillStyle = 'rgba(10, 12, 18, 0.55)';
        ctx.fill();
      }
    });

    // 2. Axis Spokes & Labels
    this.categories.forEach((cat, i) => {
      const ang = startAngle + i * angleStep;
      const x = cx + Math.cos(ang) * maxRadius;
      const y = cy + Math.sin(ang) * maxRadius;

      // Spoke line
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Axis Label
      const labelDist = maxRadius + 18;
      const lx = cx + Math.cos(ang) * labelDist;
      const ly = cy + Math.sin(ang) * labelDist;

      ctx.font = 'bold 9px "Orbitron", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.fillText(cat.label, lx, ly);
    });

    // 3. Draw Contestant Polygons
    this.drawDataPolygon(this.scores1, cx, cy, maxRadius, angleStep, startAngle, '#ff2d2d', 'rgba(255, 45, 45, 0.28)');
    this.drawDataPolygon(this.scores2, cx, cy, maxRadius, angleStep, startAngle, '#00e5ff', 'rgba(0, 229, 255, 0.28)');

    // 4. Center Dot
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fill();
  }

  drawDataPolygon(scores, cx, cy, maxRadius, angleStep, startAngle, strokeColor, fillColor) {
    const ctx = this.ctx;
    const numAxes = scores.length;
    const pts = [];

    for (let i = 0; i < numAxes; i++) {
      const score = Math.max(0, Math.min(10, scores[i] || 0));
      const r = (score / 10) * maxRadius;
      const ang = startAngle + i * angleStep;
      pts.push({
        x: cx + Math.cos(ang) * r,
        y: cy + Math.sin(ang) * r
      });
    }

    // Polygon Fill & Stroke
    ctx.save();
    ctx.beginPath();
    pts.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.closePath();

    ctx.fillStyle = fillColor;
    ctx.fill();

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.shadowColor = strokeColor;
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.restore();

    // Vertices circles
    pts.forEach(pt => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = strokeColor;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }
}

export { ScoreRadarChart };
