/**
 * Beat analysis worker: BPM + first-beat offset, musical key, waveform peaks.
 *   in:  { id, samples: Float32Array (mono), rate }
 *   out: { id, bpm, confidence, firstBeat, key, camelot, peaks: Float32Array }
 *
 * BPM: spectral-flux onset envelope → autocorrelation over 70–180 BPM with a
 * mild preference for 85–140, octave errors checked, phase from comb sums.
 * Key: chroma from FFT magnitudes, matched against Krumhansl–Kessler profiles.
 */

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

function onsetEnvelope(x, rate, size = 1024, hop = 256) {
  const win = hann(size);
  const frames = Math.max(0, Math.floor((x.length - size) / hop));
  const env = new Float32Array(frames);
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  let prev = new Float32Array(size / 2);
  const maxBin = Math.min(size / 2, Math.floor((8000 / rate) * size));
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < size; i++) { re[i] = x[off + i] * win[i]; im[i] = 0; }
    fft(re, im);
    const mag = new Float32Array(size / 2);
    let flux = 0;
    for (let k = 1; k < maxBin; k++) {
      mag[k] = Math.log1p(Math.hypot(re[k], im[k]) * 10);
      const d = mag[k] - prev[k];
      if (d > 0) flux += d;
    }
    env[f] = flux;
    prev = mag;
  }
  // remove the slow trend so only the hits stand out
  const out = new Float32Array(frames);
  const w = 16;
  for (let i = 0; i < frames; i++) {
    let s = 0; let c = 0;
    for (let j = Math.max(0, i - w); j < Math.min(frames, i + w); j++) { s += env[j]; c++; }
    out[i] = Math.max(0, env[i] - s / c);
  }
  return { env: out, fps: rate / hop };
}

function detectTempo(env, fps) {
  const n = env.length;
  if (n < fps * 4) return { bpm: 0, confidence: 0, firstBeat: 0 };
  const minLag = Math.floor((60 / 180) * fps);
  const maxLag = Math.ceil((60 / 70) * fps);
  const ac = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
    ac[lag] = s / (n - lag);
  }
  let best = minLag;
  let bestScore = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 112) / 0.55, 2));
    const score = ac[lag] * (0.6 + 0.4 * prior);
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  // parabolic refinement
  const y0 = ac[best - 1] || 0;
  const y1 = ac[best];
  const y2 = ac[best + 1] || 0;
  const denom = y0 - 2 * y1 + y2;
  const refined = denom ? best + (0.5 * (y0 - y2)) / denom : best;
  let bpm = (60 * fps) / refined;
  if (bpm < 80) {
    const half = Math.round(refined / 2);
    if (ac[half] > ac[best] * 0.75) bpm *= 2;
  }
  const mean = ac.slice(minLag, maxLag).reduce((a, b) => a + b, 0) / (maxLag - minLag);
  const confidence = Math.max(0, Math.min(1, (y1 - mean) / (y1 || 1)));
  // fine search: comb filter around the estimate (0.05 BPM steps)
  const comb = (b) => {
    const per = (60 * fps) / b;
    let top = 0;
    for (let p = 0; p < 16; p++) {
      const off = (p / 16) * per;
      let s = 0;
      for (let t = off; t < n; t += per) {
        const i = Math.floor(t);
        const u = t - i;
        s += (env[i] || 0) * (1 - u) + (env[i + 1] || 0) * u;
      }
      if (s > top) top = s;
    }
    return top / (n / per);
  };
  let fine = bpm;
  let fineScore = -1;
  for (let b = bpm - 3; b <= bpm + 3; b += 0.05) {
    const sc = comb(b);
    if (sc > fineScore) { fineScore = sc; fine = b; }
  }
  bpm = fine;
  // phase: comb sum over offsets within one period
  const period = (60 * fps) / bpm;
  let bestOff = 0;
  let bestSum = -1;
  for (let off = 0; off < period; off++) {
    let s = 0;
    for (let t = off; t < n; t += period) s += env[Math.round(t)] || 0;
    if (s > bestSum) { bestSum = s; bestOff = off; }
  }
  return { bpm: Math.round(bpm * 10) / 10, confidence, firstBeat: bestOff / fps };
}

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const CAMELOT_MAJ = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B'];
const CAMELOT_MIN = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A'];

function corr(a, b) {
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let n = 0; let da = 0; let db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db || 1);
}

function detectKey(x, rate) {
  const size = 8192;
  const hop = 8192;
  const win = hann(size);
  const chroma = new Float64Array(12);
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const frames = Math.floor((x.length - size) / hop);
  const step = Math.max(1, Math.floor(frames / 400));   // at most ~400 frames
  for (let f = 0; f < frames; f += step) {
    const off = f * hop;
    for (let i = 0; i < size; i++) { re[i] = x[off + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 1; k < size / 2; k++) {
      const freq = (k * rate) / size;
      if (freq < 55 || freq > 2000) continue;
      const pitch = 12 * Math.log2(freq / 440) + 69;
      const pc = ((Math.round(pitch) % 12) + 12) % 12;
      chroma[pc] += Math.hypot(re[k], im[k]);
    }
  }
  let best = { r: -2, tonic: 0, minor: false };
  for (let t = 0; t < 12; t++) {
    const rot = Array.from({ length: 12 }, (_, i) => chroma[(i + t) % 12]);
    const rMaj = corr(rot, MAJOR);
    const rMin = corr(rot, MINOR);
    if (rMaj > best.r) best = { r: rMaj, tonic: t, minor: false };
    if (rMin > best.r) best = { r: rMin, tonic: t, minor: true };
  }
  return {
    key: `${NOTES[best.tonic]}${best.minor ? 'm' : ''}`,
    camelot: best.minor ? CAMELOT_MIN[best.tonic] : CAMELOT_MAJ[best.tonic],
    keyConfidence: Math.max(0, best.r)
  };
}

function waveformPeaks(x, buckets = 1200) {
  const peaks = new Float32Array(buckets);
  const per = Math.max(1, Math.floor(x.length / buckets));
  for (let b = 0; b < buckets; b++) {
    let m = 0;
    const end = Math.min(x.length, (b + 1) * per);
    for (let i = b * per; i < end; i += 4) { const v = Math.abs(x[i]); if (v > m) m = v; }
    peaks[b] = m;
  }
  let max = 0;
  peaks.forEach(v => { if (v > max) max = v; });
  if (max > 0) for (let b = 0; b < buckets; b++) peaks[b] /= max;
  return peaks;
}

self.onmessage = (e) => {
  const { id, samples, rate } = e.data;
  try {
    // tempo on at most ~4 minutes, key on the whole thing (sparsely)
    const tempoPart = samples.length > rate * 240 ? samples.subarray(0, rate * 240) : samples;
    const { env, fps } = onsetEnvelope(tempoPart, rate);
    const tempo = detectTempo(env, fps);
    const key = detectKey(samples, rate);
    const peaks = waveformPeaks(samples);
    self.postMessage({ id, ...tempo, ...key, peaks, duration: samples.length / rate }, [peaks.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
