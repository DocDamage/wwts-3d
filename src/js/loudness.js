/**
 * Integrated loudness (LUFS) of a mono signal, after ITU-R BS.1770:
 * K-weighting (high-shelf + high-pass, designed for the actual sample rate),
 * 400 ms blocks with 75 % overlap, absolute gate at −70 LUFS and a relative
 * gate 10 LU under the ungated level. Used to match the two beats' playback
 * loudness so a hotter master doesn't sway the judges.
 */

/** Biquad coefficients for the two K-weighting stages at sample rate fs */
function kWeightingFilters(fs) {
  // Stage 1: high shelf (+4 dB above ~1.7 kHz) — the head's acoustic effect
  const shelf = (() => {
    const f0 = 1681.974450955533;
    const G = 3.999843853973347;
    const Q = 0.7071752369554196;
    const K = Math.tan((Math.PI * f0) / fs);
    const Vh = Math.pow(10, G / 20);
    const Vb = Math.pow(Vh, 0.4996667741545416);
    const a0 = 1 + K / Q + K * K;
    return {
      b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
      a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0]
    };
  })();
  // Stage 2: high-pass (~38 Hz) — the RLB weighting
  const hp = (() => {
    const f0 = 38.13547087602444;
    const Q = 0.5003270373238773;
    const K = Math.tan((Math.PI * f0) / fs);
    const a0 = 1 + K / Q + K * K;
    return { b: [1, -2, 1], a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  })();
  return [shelf, hp];
}

function biquad(x, { b, a }) {
  const y = new Float32Array(x.length);
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = x[i];
    y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

/**
 * samples: mono Float32Array, rate: Hz. Returns LUFS (≈ −70 for silence).
 * A mono downmix of a stereo track reads a little lower than a stereo meter;
 * that offset cancels out when two beats are compared.
 */
function integratedLoudness(samples, rate) {
  if (!samples?.length || !rate) return -70;
  let y = samples;
  kWeightingFilters(rate).forEach(f => { y = biquad(y, f); });
  const block = Math.round(rate * 0.4);
  const hop = Math.round(block * 0.25);
  if (y.length < block) {
    let s = 0;
    for (let i = 0; i < y.length; i++) s += y[i] * y[i];
    const ms = s / y.length;
    return ms > 0 ? -0.691 + 10 * Math.log10(ms) : -70;
  }
  const powers = [];
  for (let start = 0; start + block <= y.length; start += hop) {
    let s = 0;
    for (let i = start; i < start + block; i++) s += y[i] * y[i];
    powers.push(s / block);
  }
  const lufs = (p) => -0.691 + 10 * Math.log10(p);
  const abs = powers.filter(p => p > 0 && lufs(p) > -70);
  if (!abs.length) return -70;
  const mean = (arr) => arr.reduce((s, p) => s + p, 0) / arr.length;
  const relGate = lufs(mean(abs)) - 10;
  const gated = abs.filter(p => lufs(p) > relGate);
  return Number(lufs(mean(gated.length ? gated : abs)).toFixed(2));
}

/** Gain (dB) to bring a track to the target, kept within ±maxDb */
function matchGainDb(lufs, target = -14, maxDb = 12) {
  if (!Number.isFinite(lufs) || lufs <= -69) return 0;
  return Math.max(-maxDb, Math.min(maxDb, Number((target - lufs).toFixed(2))));
}

export { integratedLoudness, matchGainDb, kWeightingFilters };
