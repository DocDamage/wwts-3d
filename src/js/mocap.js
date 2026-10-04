/**
 * Motion-capture library + per-character rig.
 *
 * Clips come from Mixamo (exported "Without Skin" on a different character), so
 * each one is adapted before use:
 *   - track names lose their "mixamorigN:" prefix (and get the target rig's one back)
 *   - only the hips keep a position track; other bones' translations belong to the
 *     source skeleton's proportions and would stretch our limbs
 *   - hip height is scaled to the target rig, so lying-down poses stay on the floor
 *   - horizontal hip travel and heading are pulled out as "root motion" and moved
 *     onto the character object instead, so falls, steps and turns really move it
 *
 * MocapRig blends a base layer (idle / walk / run / strafe, weighted by speed) with
 * one-shot moves (dances, attacks, hits, falls, turns) using smooth weight fades.
 */
import * as THREE from 'three';
import { loadModel } from './modelLoader.js';

// Hip height (source units, cm) of the Mixamo character the clips were exported on
const SOURCE_STAND_HIP = 111;

const _q = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Heading from the hips' sideways axis (stays horizontal standing or lying down) */
function headingAt(values, i) {
  _q.fromArray(values, i * 4);
  _v.set(1, 0, 0).applyQuaternion(_q);
  return Math.atan2(-_v.z, _v.x);
}

/** Sample a 1-D curve at time t (linear) */
function sample(times, values, t) {
  const n = times.length;
  if (!n) return 0;
  if (t <= times[0]) return values[0];
  if (t >= times[n - 1]) return values[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid; else hi = mid;
  }
  const u = (t - times[lo]) / (times[hi] - times[lo] || 1);
  return values[lo] + (values[hi] - values[lo]) * u;
}

/* ---------- skeleton analysis (forward kinematics on the source skeleton) ---------- */

const PARENT = {
  Spine: 'Hips', Spine1: 'Spine', Spine2: 'Spine1', Neck: 'Spine2', Head: 'Neck', HeadTop_End: 'Head',
  LeftShoulder: 'Spine2', LeftArm: 'LeftShoulder', LeftForeArm: 'LeftArm', LeftHand: 'LeftForeArm', LeftHandMiddle1: 'LeftHand',
  RightShoulder: 'Spine2', RightArm: 'RightShoulder', RightForeArm: 'RightArm', RightHand: 'RightForeArm', RightHandMiddle1: 'RightHand',
  LeftUpLeg: 'Hips', LeftLeg: 'LeftUpLeg', LeftFoot: 'LeftLeg', LeftToeBase: 'LeftFoot',
  RightUpLeg: 'Hips', RightLeg: 'RightUpLeg', RightFoot: 'RightLeg', RightToeBase: 'RightFoot'
};
const FK_ORDER = ['Hips', ...Object.keys(PARENT)];
// Body parts that can land a blow (fist knuckles, elbows, balls of the feet, knees, head)
const STRIKERS = ['LeftHandMiddle1', 'RightHandMiddle1', 'LeftForeArm', 'RightForeArm', 'LeftToeBase', 'RightToeBase', 'LeftLeg', 'RightLeg', 'Head'];

/**
 * Posable view of a processed clip on the source skeleton. pose(t) returns world positions
 * (source units, root at the origin facing +Z, root travel included) of every tracked joint.
 */
function makeSkeletonSampler(clip, rm, bones) {
  const tracks = {};
  clip.tracks.forEach(t => {
    const [bone, prop] = t.name.split('.');
    (tracks[bone] = tracks[bone] || {})[prop] = t.createInterpolant();
  });
  const rest = {};
  bones.forEach(b => {
    const name = b.name.replace(/^mixamorig\d*:?/, '');
    if (name === 'Hips' || PARENT[name]) rest[name] = { p: b.position.clone(), q: b.quaternion.clone() };
  });
  if (!rest.Hips) return null;
  const wq = {};
  const wp = {};
  FK_ORDER.forEach(n => { wq[n] = new THREE.Quaternion(); wp[n] = new THREE.Vector3(); });
  const lq = new THREE.Quaternion();
  const lp = new THREE.Vector3();
  return (t) => {
    for (const n of FK_ORDER) {
      const r = rest[n];
      if (!r) continue;
      const tr = tracks[n];
      if (tr?.quaternion) lq.fromArray(tr.quaternion.evaluate(t)); else lq.copy(r.q);
      if (n === 'Hips') {
        if (tr?.position) lp.fromArray(tr.position.evaluate(t)); else lp.copy(r.p);
        lp.x = sample(rm.pt, rm.px, t);
        lp.z = sample(rm.pt, rm.pz, t);
        wq.Hips.copy(lq);
        wp.Hips.copy(lp);
        continue;
      }
      const par = PARENT[n];
      if (!rest[par]) continue;
      wp[n].copy(r.p).applyQuaternion(wq[par]).add(wp[par]);
      wq[n].copy(wq[par]).multiply(lq);
    }
    return wp;
  };
}

/** Heading of a left->right joint pair (0 = facing +Z), like headingAt */
function pairHeading(l, r) {
  return Math.atan2(-(l.z - r.z), l.x - r.x);
}

/**
 * Read a clip's body mechanics: chest heading, reaction onset, and for attacks which
 * body part lands each blow and where (relative to the start position).
 */
function analyzeClip(clip, rm, bones, entry) {
  const pose = makeSkeletonSampler(clip, rm, bones);
  if (!pose) return;
  const dur = clip.duration;
  const p0 = pose(0);
  const hip0 = p0.Hips.y;
  rm.hip0 = hip0;
  rm.chest0 = pairHeading(p0.LeftArm, p0.RightArm);
  // (pose() reuses one buffer: take what we need from the first frame now)
  const rest0 = {};
  STRIKERS.forEach(n => { rest0[n] = Math.hypot(p0[n].x - p0.Hips.x, p0[n].z - p0.Hips.z); });

  // Reaction onset: when the head starts to move (hit clips have a beat of idle first)
  const head0 = p0.Head.clone();
  rm.onset = 0;
  for (let t = 0; t < Math.min(dur, 1.2); t += 1 / 60) {
    if (pose(t).Head.distanceTo(head0) > hip0 * 0.035) { rm.onset = Math.max(0, t - 0.04); break; }
  }

  const cat = entry?.category;
  // Dances: the clip's own tempo from its motion energy (steps and hits pulse with the beat)
  if (cat === 'dance' || cat === 'breaking') {
    const fps = 30;
    const n = Math.floor(dur * fps);
    if (n > fps * 2) {
      const parts = ['Hips', 'LeftToeBase', 'RightToeBase', 'LeftHand', 'RightHand', 'Head'];
      const prevPos = {};
      const energy = new Float32Array(n);
      const hipY = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const p = pose(i / fps);
        let e = 0;
        parts.forEach(k => {
          if (!p[k]) return;
          if (prevPos[k]) e += p[k].distanceTo(prevPos[k]);
          prevPos[k] = (prevPos[k] || p[k].clone()).copy(p[k]);
        });
        energy[i] = e;
        hipY[i] = p.Hips.y;
      }
      energy[0] = energy[1];
      // detrend over ~1 s
      const w = fps >> 1;
      const ys = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0; let c = 0;
        for (let j = Math.max(0, i - w); j < Math.min(n, i + w); j++) { s += energy[j]; c++; }
        ys[i] = energy[i] - s / c;
      }
      const minLag = Math.floor(fps * 0.36);
      const maxLag = Math.min(Math.floor(fps * 1.6), Math.floor(n / 2));
      const ac = new Float32Array(maxLag + 2);
      for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
        let s = 0;
        for (let i = 0; i + lag < n; i++) s += ys[i] * ys[i + lag];
        ac[lag] = s / (n - lag);
      }
      let best = 0;
      let bestLag = 0;
      for (let lag = minLag; lag <= maxLag; lag++) {
        if (!(ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1]) || ac[lag] <= 0) continue;
        let bpm = (60 * fps) / lag;
        const score = ac[lag] * (bpm >= 75 && bpm <= 135 ? 1.2 : 1);
        if (score > best) { best = score; bestLag = lag; }
      }
      if (bestLag) {
        let bpm = (60 * fps) / bestLag;
        if (bpm < 60) bpm *= 2;      // a 2-beat cycle
        rm.danceBpm = Math.round(bpm);
        // where in its beat the hips bottom out (that should land on the kick)
        const per = (60 * fps) / bpm;
        let lo = 0;
        for (let i = 1; i < Math.min(n, per); i++) if (hipY[i] < hipY[lo]) lo = i;
        rm.danceOffset = lo / per;
      }
    }
  }
  if (!['fight', 'air', 'spec'].includes(cat)) return;

  // How far each striking part reaches out from the hips, beyond where it sits in guard.
  // (Speed misleads: a stepping foot moves fast but strikes nothing.)
  // Heads, knees and elbows only strike in moves built around them
  const name = entry.clip || '';
  const punch = /hook|jab|cross|uppercut|punch|elbow|palm|combo|hadouken|spec_|slam/.test(name);
  const kick = /kick|sweep|martelo|meia|armada|chapa|queshada|pontera|bencao|knee/.test(name);
  const strikers = STRIKERS.filter(n => {
    if (punch && !kick && /Toe|Leg$/.test(n)) return false;
    if (kick && !punch && /Hand|ForeArm/.test(n)) return false;
    if (n === 'Head') return /headbutt/.test(name);
    if (/Leg$/.test(n)) return /knee/.test(name);
    if (/ForeArm$/.test(n)) return /elbow/.test(name);
    return true;
  });
  const bias = (n) => (/ForeArm$/.test(n) && /elbow/.test(name)) || (/Leg$/.test(n) && /knee/.test(name)) || n === 'Head' ? hip0 * 0.25 : 0;
  const reachOf = (p, n) => {
    const q = p[n];
    const d = Math.hypot(q.x - p.Hips.x, q.z - p.Hips.z);
    let out = d - rest0[n] + bias(n);
    // a foot on the floor only counts when it sweeps far out (sweeps), not when stepping
    if (/Toe/.test(n) && q.y < hip0 * 0.15 && out < hip0 * 0.3) out -= hip0;
    return { d, out };
  };
  const ext = (t) => {
    const p = pose(t);
    let best = null;
    strikers.forEach(n => {
      const r = reachOf(p, n);
      if (!best || r.out > best.out) best = { n, out: r.out, d: r.d };
    });
    return best;
  };
  let hits = entry.hits;
  if (!hits || !hits.length) {
    // Auto-detect: moments a limb is thrown well out past its guard position
    const step = 1 / 30;
    const curve = [];
    for (let t = 0; t <= dur; t += step) curve.push({ t, out: ext(t).out });
    const thresh = hip0 * 0.3;
    hits = [];
    for (let i = 1; i < curve.length - 1; i++) {
      const c = curve[i];
      if (c.out > thresh && c.out >= curve[i - 1].out && c.out > curve[i + 1].out) {
        if (hits.length && c.t - hits[hits.length - 1] < 0.22) {
          const lastI = Math.round(hits[hits.length - 1] / step);
          if (c.out > curve[lastI].out) hits[hits.length - 1] = c.t;
        } else hits.push(c.t);
      }
    }
    if (!hits.length) hits = [curve.reduce((a, b) => (b.out > a.out ? b : a), curve[0]).t];
    hits = hits.map(t => Math.round(t * 100) / 100);
    rm.autoHits = hits;
  }
  rm.strikes = hits.map(t => {
    const e = ext(t);
    const p = pose(t);
    const s = p[e.n];
    return {
      t,
      bone: e.n,
      // strike point relative to the clip's start position (source units, +Z forward)
      x: s.x, y: s.y, z: s.z,
      // ...and relative to the hips at that moment
      hx: s.x - p.Hips.x, hz: s.z - p.Hips.z,
      side: e.n.startsWith('Left') ? 'l' : e.n.startsWith('Right') ? 'r' : 'c',
      height: s.y / hip0
    };
  });
}

/** Strip a raw clip down to a rig-independent form and extract its root motion */
function processClip(clip, { perFrameYaw = true, bones = null, entry = null } = {}) {
  clip.tracks.forEach(t => { t.name = t.name.replace(/^mixamorig\d*:?/, ''); });
  // Keep rotations everywhere, positions only on the hips, never scales
  clip.tracks = clip.tracks.filter(t => /\.quaternion$/.test(t.name) || t.name === 'Hips.position');

  const pos = clip.tracks.find(t => t.name === 'Hips.position');
  const rot = clip.tracks.find(t => t.name === 'Hips.quaternion');
  const rm = { pt: [], px: [], pz: [], rt: [], yaw: [], h0: 0, x0: 0, z0: 0 };

  if (rot) {
    const v = rot.values;
    const n = v.length / 4;
    rm.h0 = headingAt(v, 0);
    let prev = rm.h0;
    let unwrapped = 0;
    for (let i = 0; i < n; i++) {
      const h = headingAt(v, i);
      let d = h - prev;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      unwrapped += d;
      prev = h;
      rm.rt.push(rot.times[i]);
      // Fight clips keep their in-move body rotation (a spin kick spins the body, not
      // the character); everything else turns the character with the hips
      const turn = perFrameYaw ? unwrapped : 0;
      rm.yaw.push(turn);
      // Remove the absolute heading so every clip starts facing the character's forward
      _qy.setFromAxisAngle(_up, -(rm.h0 + turn));
      _q.fromArray(v, i * 4).premultiply(_qy).toArray(v, i * 4);
    }
  }
  if (pos) {
    const v = pos.values;
    const n = v.length / 3;
    const c = Math.cos(-rm.h0);
    const s = Math.sin(-rm.h0);
    const x0 = v[0];
    const z0 = v[2];
    // Start offset from the clip origin, expressed in the clip's own facing frame (paired moves use it)
    rm.x0 = x0 * c + z0 * s;
    rm.z0 = -x0 * s + z0 * c;
    for (let i = 0; i < n; i++) {
      const dx = v[i * 3] - x0;
      const dz = v[i * 3 + 2] - z0;
      rm.pt.push(pos.times[i]);
      rm.px.push(dx * c + dz * s);
      rm.pz.push(-dx * s + dz * c);
      v[i * 3] = 0;
      v[i * 3 + 2] = 0;
    }
  }
  rm.distance = rm.pt.length ? Math.hypot(rm.px[rm.px.length - 1], rm.pz[rm.pz.length - 1]) : 0;
  rm.turn = rm.yaw.length ? rm.yaw[rm.yaw.length - 1] : 0;
  if (pos) { rm.ht = pos.times; rm.hy = Array.from({ length: pos.times.length }, (_, i) => pos.values[i * 3 + 1]); }
  if (bones) {
    try { analyzeClip(clip, rm, bones, entry); } catch (e) { console.warn('analyzeClip', entry?.id, e); }
  }
  return rm;
}

// Clips whose hip rotation turns the whole character (locomotion turns, dances, falls, paired moves)
function turnsCharacter(entry) {
  if (!entry) return true;
  if (['fight', 'react', 'defend', 'jumps', 'air', 'spec', 'taunt'].includes(entry.category)) return false;
  if (entry.category === 'base' && /^fight_|^crouch/.test(entry.clip)) return false;
  return true;
}

class MocapLibrary {
  constructor(base = '/models/animations/') {
    this.base = base;
    this.entries = [];
    this.byId = {};
    this.data = {};      // id -> { clip, rm, entry }
    this.pending = {};   // id -> Promise
    this.sourceHip = null;   // standing hip height of the skeleton the clips were made on (clip units)
    this.listeners = new Set();
  }

  async init() {
    try {
      const res = await fetch(this.base + 'manifest.json');
      if (!res.ok) return false;
      this.entries = await res.json();
    } catch {
      return false;
    }
    this.entries.forEach(e => { this.byId[e.id] = e; });
    return true;
  }

  has(id) {
    return !!this.data[id];
  }

  get(id) {
    return this.data[id] || null;
  }

  load(id) {
    if (this.data[id]) return Promise.resolve(this.data[id]);
    if (this.pending[id]) return this.pending[id];
    const entry = this.byId[id];
    if (!entry) return Promise.resolve(null);
    this.pending[id] = new Promise(resolve => {
      loadModel(this.base + entry.file, { classic: false }).then((obj) => {
        const clip = obj.animations?.[0];
        if (!clip) return resolve(null);
        clip.name = id;
        // skeleton joints (animation-only GLBs have plain nodes, not Bones)
        const bones = [];
        obj.traverse(n => { if (n.isBone || /mixamorig/i.test(n.name)) bones.push(n); });
        if (this.sourceHip === null) {
          const hips = bones.find(b => /Hips$/.test(b.name));
          if (hips && hips.position.y > 0) this.sourceHip = hips.position.y;
        }
        const rm = processClip(clip, { perFrameYaw: turnsCharacter(entry), bones, entry });
        this.data[id] = { clip, rm, entry };
        this.listeners.forEach(fn => fn(id));
        resolve(this.data[id]);
      }).catch(() => resolve(null));
    });
    return this.pending[id];
  }

  /** Load a list in the background, a few at a time */
  async preload(ids, concurrency = 4, onProgress = null) {
    const queue = ids.filter(id => !this.data[id]);
    const total = queue.length;
    let done = 0;
    onProgress?.(0, total);
    const worker = async () => {
      while (queue.length) { await this.load(queue.shift()); onProgress?.(++done, total); }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
  }

  onLoaded(fn) {
    this.listeners.add(fn);
  }

  ofCategory(cat) {
    return this.entries.filter(e => e.category === cat);
  }
}

/* ------------------------------------------------------------------ */

const BASE_IDLES = ['mx_idle', 'mx_idle_weight_shift', 'mx_idle_look1', 'mx_idle_neutral', 'mx_idle_look2', 'mx_idle_happy'];

class MocapRig {
  /**
   * char: the character object (root); mixer: its AnimationMixer;
   * fallbackIdle: the character's own baked idle action (used until clips load)
   */
  constructor(char, mixer, lib, fallbackIdle) {
    this.char = char;
    this.mixer = mixer;
    this.lib = lib;
    this.fallbackIdle = fallbackIdle;
    this.actions = {};       // id -> { action, rm, entry, w }
    this.oneShot = null;     // current one-shot move
    this.fading = [];        // one-shots fading out
    this.baseIdle = 'mx_idle';
    this.idleTimer = 8 + Math.random() * 6;
    this.fightMode = false;
    this.loco = { speed: 0, run: 0, strafe: 0, back: 0 };

    let prefix = '';
    char.traverse(n => { if (!prefix && n.isBone && /Hips$/.test(n.name)) prefix = n.name.replace(/Hips$/, ''); });
    this.prefix = prefix;
    this.hips = null;
    char.traverse(n => { if (!this.hips && n.isBone && n.name === prefix + 'Hips') this.hips = n; });

    // Rest hip height of this rig, from its own idle clip (or the bind pose)
    let rest = null;
    const idleClip = fallbackIdle?.getClip();
    const t = idleClip?.tracks.find(tr => tr.name === prefix + 'Hips.position');
    if (t) rest = t.values[1];
    if (rest === null && this.hips) rest = this.hips.position.y;
    this.restHip = rest || SOURCE_STAND_HIP;

    // Rig units -> world metres (the root is scaled to make the character 1.75 m tall)
    const ws = new THREE.Vector3();
    (this.hips?.parent || char).getWorldScale(ws);
    this.unitToWorld = ws.x;
  }

  /** Rig hip height relative to the clips' source skeleton (units cancel out) */
  get hipScale() {
    return this.restHip / (this.lib.sourceHip || SOURCE_STAND_HIP);
  }

  /** Has the clip been loaded? (and build its action for this rig) */
  ready(id) {
    return !!this.getAction(id);
  }

  getAction(id) {
    if (this.actions[id]) return this.actions[id];
    const data = this.lib.get(id);
    if (!data) return null;
    const clip = data.clip.clone();
    clip.tracks.forEach(t => {
      t.name = this.prefix + t.name;
      if (t.name === this.prefix + 'Hips.position') {
        const v = t.values;
        for (let i = 1; i < v.length; i += 3) v[i] *= this.hipScale;
      }
    });
    const action = this.mixer.clipAction(clip);
    action.enabled = true;
    action.setEffectiveWeight(0);
    action.play();
    this.actions[id] = { action, rm: data.rm, entry: data.entry, w: 0 };
    return this.actions[id];
  }

  /** Base locomotion input: speed in m/s, run 0..1, plus optional strafe/back in -1..1 */
  setLocomotion(speed, run = 0, { strafe = 0, back = 0 } = {}) {
    this.loco.speed = speed;
    this.loco.run = run;
    this.loco.strafe = strafe;
    this.loco.back = back;
  }

  setFightMode(on) {
    this.fightMode = !!on;
  }

  /**
   * Play a one-shot (or looping) move.
   * opts: fadeIn, fadeOut, loop, timeScale, from (s), to (s), rootMotion (bool),
   *       rmScale (travel multiplier), yawScale, onEnd(cb), onTime: [{t, fn}]
   */
  play(id, opts = {}) {
    const a = this.getAction(id);
    if (!a) {
      // Not loaded yet: load, then start (skip if something else took over meanwhile)
      const token = (this._token = (this._token || 0) + 1);
      this.lib.load(id).then(() => { if (this._token === token) this.play(id, opts); });
      return false;
    }
    this._token = (this._token || 0) + 1;
    if (this.oneShot) this.fading.push({ ...this.oneShot, fadingOut: true });
    const entry = a.entry;
    const loop = opts.loop ?? entry.loop;
    const action = a.action;
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.timeScale = opts.timeScale ?? 1;
    const from = opts.from ?? 0;
    action.time = from;
    this.oneShot = {
      id,
      a,
      loop,
      fadeIn: opts.fadeIn ?? 0.2,
      fadeOut: opts.fadeOut ?? 0.3,
      end: opts.to ?? action.getClip().duration,
      t: 0,
      w: 0,
      rootMotion: opts.rootMotion ?? entry.rootMotion,
      rmScale: opts.rmScale ?? 1,
      yawScale: opts.yawScale ?? 1,
      lastT: from,
      onEnd: opts.onEnd || null,
      hold: !!opts.hold,          // stay on the last frame (e.g. lying on the floor) until replaced
      onFinish: opts.onFinish || null,
      finished: false,
      onTime: (opts.onTime || []).slice().sort((x, y) => x.t - y.t),
      stopping: false
    };
    return true;
  }

  /** Fade the current one-shot out (back to the base layer) */
  stop(fade) {
    if (!this.oneShot) return;
    if (fade !== undefined) this.oneShot.fadeOut = fade;
    this.oneShot.stopping = true;
  }

  current() {
    return this.oneShot && !this.oneShot.stopping ? this.oneShot.id : null;
  }

  /** Remaining time of the current one-shot (seconds) */
  remaining() {
    const o = this.oneShot;
    if (!o) return 0;
    return Math.max(0, (o.end - o.a.action.time) / Math.max(0.01, Math.abs(o.a.action.timeScale)));
  }

  baseTargets() {
    const t = {};
    const { speed, run, strafe, back } = this.loco;
    const pick = (id, fallback) => (this.ready(id) ? id : fallback);
    const idle = this.fightMode ? pick(this.fightIdle || 'mx_fight_idle', pick('mx_fight_idle', pick(this.baseIdle, null))) : pick(this.baseIdle, pick('mx_idle', null));
    const walkId = back > 0.5 ? pick('mx_walk_back', 'mx_walk') : strafe < -0.5 ? pick('mx_strafe_left', 'mx_walk') : strafe > 0.5 ? pick('mx_strafe_right', 'mx_walk') : 'mx_walk';
    const runId = back > 0.5 ? pick('mx_run_back', 'mx_run') : 'mx_run';
    const moving = Math.min(1, speed / 0.35);
    const walkW = this.ready(walkId) ? moving * (1 - run) : 0;
    const runW = this.ready(runId) ? moving * run : 0;
    const idleW = Math.max(0, 1 - walkW - runW);
    if (idle) t[idle] = idleW;
    else t.__fallback = idleW;
    if (walkW) t[walkId] = walkW;
    if (runW) t[runId] = runW;
    // Match the stride to the actual ground speed
    const walk = this.actions[walkId];
    const runA = this.actions[runId];
    if (walk) walk.action.timeScale = THREE.MathUtils.clamp(speed / (walk.entry.speed || 1.35), 0.6, 1.8);
    if (runA) runA.action.timeScale = THREE.MathUtils.clamp(speed / (runA.entry.speed || 3.6), 0.7, 1.5);
    return t;
  }

  /** Call before the mixer updates: advances fades and sets every action's weight */
  preUpdate(dt) {
    // Rotate through idle variations now and then
    if (!this.fightMode && this.loco.speed < 0.05) {
      this.idleTimer -= dt;
      if (this.idleTimer <= 0) {
        const options = BASE_IDLES.filter(id => id !== this.baseIdle && this.ready(id));
        this.baseIdle = Math.random() < 0.45 || !options.length ? 'mx_idle' : options[Math.floor(Math.random() * options.length)];
        if (this.actions[this.baseIdle]) this.actions[this.baseIdle].action.reset();
        this.idleTimer = this.baseIdle === 'mx_idle' ? 10 + Math.random() * 8 : (this.actions[this.baseIdle]?.action.getClip().duration || 8);
      }
    }

    // One-shot weight envelope
    const o = this.oneShot;
    let oneW = 0;
    if (o) {
      o.t += dt;
      const action = o.a.action;
      const left = (o.end - action.time) / Math.max(0.01, Math.abs(action.timeScale));
      if (o.hold && !o.loop) {
        if (!o.finished && action.time >= o.end - 1e-3) {
          o.finished = true;
          o.onFinish?.();
        }
      } else if (!o.loop && left <= o.fadeOut) o.stopping = true;
      if (o.stopping) o.w = Math.max(0, o.w - dt / Math.max(0.01, o.fadeOut));
      else o.w = Math.min(1, o.w + dt / Math.max(0.01, o.fadeIn));
      oneW = o.w;
      if (o.stopping && o.w <= 0) {
        this.oneShot = null;
        o.a.action.setEffectiveWeight(0);
        o.onEnd?.();
        oneW = 0;
      }
    }
    this.fading = this.fading.filter(f => {
      f.w = Math.max(0, f.w - dt / Math.max(0.05, f.fadeOut));
      return f.w > 0;
    });
    const fadeW = this.fading.reduce((s, f) => s + f.w, 0);

    const targets = this.baseTargets();
    const baseScale = Math.max(0, 1 - Math.min(1, oneW + fadeW));
    const k = 1 - Math.exp(-dt * 10);
    const touched = new Set();
    Object.entries(targets).forEach(([id, w]) => {
      if (id === '__fallback') return;
      const a = this.actions[id] || this.getAction(id);
      if (!a) return;
      a.w += (w - a.w) * k;
      touched.add(id);
    });
    Object.entries(this.actions).forEach(([id, a]) => {
      if (!touched.has(id)) a.w += (0 - a.w) * k;
      let w = a.w * baseScale;
      if (this.oneShot && this.oneShot.a === a) w = this.oneShot.w;
      const f = this.fading.find(x => x.a === a);
      if (f) w = Math.max(w, f.w);
      a.action.setEffectiveWeight(w < 0.001 ? 0 : w);
    });
    if (this.fallbackIdle) {
      const mocapIdle = Object.keys(targets).some(id => id !== '__fallback' && this.actions[id]);
      this.fallbackIdle.setEffectiveWeight(mocapIdle ? 0 : (targets.__fallback ?? 1) * baseScale);
    }
  }

  /**
   * Call after the mixer updated: fires timed callbacks and returns this frame's
   * root motion in world space { dx, dz, dyaw } (relative to `facing`).
   */
  postUpdate(facing) {
    const out = { dx: 0, dz: 0, dyaw: 0 };
    const apply = (o) => {
      const action = o.a.action;
      const t = Math.min(action.time, o.end);
      if (o.onTime.length) {
        while (o.onTime.length && t >= o.onTime[0].t) o.onTime.shift().fn();
      }
      if (!o.rootMotion) { o.lastT = t; return; }
      const rm = o.a.rm;
      let t0 = o.lastT;
      if (t < t0) t0 = t; // looped or reset
      const w = o.stopping ? o.w : 1;
      const lx = (sample(rm.pt, rm.px, t) - sample(rm.pt, rm.px, t0)) * this.hipScale * this.unitToWorld * o.rmScale * w;
      const lz = (sample(rm.pt, rm.pz, t) - sample(rm.pt, rm.pz, t0)) * this.hipScale * this.unitToWorld * o.rmScale * w;
      const dyaw = (sample(rm.rt, rm.yaw, t) - sample(rm.rt, rm.yaw, t0)) * o.yawScale * w;
      // Local (clip-forward = +Z) to world, using the facing before this frame's turn
      const c = Math.cos(facing + out.dyaw);
      const s = Math.sin(facing + out.dyaw);
      out.dx += lx * c + lz * s;
      out.dz += -lx * s + lz * c;
      out.dyaw += dyaw;
      o.lastT = t;
    };
    if (this.oneShot) apply(this.oneShot);
    this.fading.forEach(f => { if (f.rootMotion) apply(f); });
    return out;
  }
}

/** Root-motion summary of a clip (world metres for a given rig), for planning */
function clipTravel(lib, id, rig) {
  const d = lib.get(id);
  if (!d) return null;
  const s = rig ? rig.hipScale * rig.unitToWorld : 0.01;
  const rm = d.rm;
  const n = rm.px.length;
  return {
    dx: n ? rm.px[n - 1] * s : 0,
    dz: n ? rm.pz[n - 1] * s : 0,
    turn: rm.turn,
    x0: rm.x0 * s,
    z0: rm.z0 * s,
    duration: d.clip.duration
  };
}

export { MocapLibrary, MocapRig, clipTravel, processClip, sample, SOURCE_STAND_HIP };
