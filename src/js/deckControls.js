/**
 * Deck Controls — makes the 3D DJ controller playable.
 *
 * The controller FBX is one static mesh, so working parts are laid over its
 * printed controls (positions measured on the model after it is flipped to
 * face the DJs and levelled):
 *   • vinyl on each jog wheel — drag to scratch/seek, spins with the track
 *   • 20 performance pads (10 per deck) → PadBank
 *   • per-deck knobs: TRIM / HI / MID / LOW / FILTER, plus ECHO and PITCH
 *   • channel faders on the deck sliders, a crossfader, PLAY and CUE buttons
 *   • progress ring around each jog
 * Static handles that would be duplicated by moving caps are carved out of the mesh.
 */

import * as THREE from 'three';
import { ROTATION_SECONDS } from './audioPlayer.js';

const DECK_X = { 1: -0.995, 2: 0.995 };
const JOG_Z = -0.29;
const JOG_RADIUS = 0.3;
const PAD_X = [1.301, 1.150, 0.998, 0.847, 0.695]; // outer → inner (mirrored per deck)
const PAD_Z = [0.35, 0.49];                         // near row, far row (from the DJ)
const PAD_SIZE = 0.118;
const KNOB_ROWS_Z = [0.48, 0.22, -0.04, -0.30, -0.56]; // far → near
const KNOB_COL_X = { outer: 0.36, inner: 0.12 };
const KNOB_RADIUS = 0.043;
const SLIDER_Z = 0.18;
const SLIDER_TRAVEL = [1.23, 0.79]; // |x| at value 0 → value 1
const STATIC_SLIDER_HANDLES = [{ x: -1.20, z: 0.18 }, { x: 1.12, z: 0.18 }];
const XFADER = { z: -0.68, half: 0.2 };
const TRANSPORT_Z = -0.62;
const DECK_COLORS = { 1: 0xff2d2d, 2: 0x00e5ff };
const RING_SEGMENTS = 48;

const KNOB_LAYOUT = {
  outer: [
    { param: 'trim', label: 'TRIM' },
    { param: 'high', label: 'HI EQ' },
    { param: 'mid', label: 'MID EQ' },
    { param: 'low', label: 'LOW EQ' },
    { param: 'filter', label: 'FILTER' }
  ],
  inner: [
    { param: 'master', label: 'MASTER', side: 1 },
    { param: 'echo', label: 'ECHO' },
    { param: 'tempo', label: 'PITCH' },
    { param: 'booth', label: 'BOOTH', visual: true },
    { param: 'headphones', label: 'PHONES', visual: true }
  ]
};

class DeckControls {
  constructor(dj, audio, padBank) {
    this.dj = dj;
    this.audio = audio;
    this.padBank = padBank;
    this.group = new THREE.Group();
    this.group.name = 'DeckControls';
    this.pickables = [];
    this.vinyl = {};
    this.vinylAngle = { 1: 0, 2: 0 };
    this.rings = {};
    this.pads = [];
    this.knobs = [];
    this.faders = {};
    this.buttons = {};
    this.drag = null;
    this.hover = null;
    this.consumedClick = false;
    this.visualKnobValues = {};
    this.tooltip = null;
    this.built = false;
  }

  get dragging() {
    return !!this.drag;
  }

  /* ============================================================
     BUILD
     ============================================================ */
  build(deckObject) {
    if (this.built) return;
    this.deckMeshes = [];
    deckObject.traverse(c => { if (c.isMesh) this.deckMeshes.push(c); });
    deckObject.updateMatrixWorld(true);
    this.raycaster = new THREE.Raycaster();

    STATIC_SLIDER_HANDLES.forEach(h => this.carveStatic(h.x, h.z, 0.035, 0.07, 1.214));

    [1, 2].forEach(p => {
      this.buildVinyl(p);
      this.buildProgressRing(p);
      this.buildTransport(p);
      this.buildChannelFader(p);
    });
    this.buildPads();
    this.buildKnobs();
    this.buildCrossfader();

    this.dj.scene.add(this.group);
    this.createTooltip();
    this.built = true;
    this.syncAll();
  }

  /** Height of the deck surface under (x, z) */
  surfaceY(x, z, fallback = 1.2) {
    this.raycaster.set(new THREE.Vector3(x, 3, z), new THREE.Vector3(0, -1, 0));
    const hit = this.raycaster.intersectObjects(this.deckMeshes, false)[0];
    return hit ? hit.point.y : fallback;
  }

  /** Flatten static mesh bumps inside a box (for handles our moving caps replace) */
  carveStatic(cx, cz, halfX, halfZ, floorY) {
    const v = new THREE.Vector3();
    this.deckMeshes.forEach(mesh => {
      const pos = mesh.geometry.attributes.position;
      const toLocal = mesh.matrixWorld.clone().invert();
      let changed = false;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        if (Math.abs(v.x - cx) < halfX && Math.abs(v.z - cz) < halfZ && v.y > floorY) {
          v.y = floorY;
          v.applyMatrix4(toLocal);
          pos.setXYZ(i, v.x, v.y, v.z);
          changed = true;
        }
      }
      if (changed) {
        pos.needsUpdate = true;
        mesh.geometry.computeBoundingSphere();
        mesh.geometry.computeBoundingBox();
      }
    });
  }

  pickable(mesh, control) {
    mesh.userData.control = control;
    this.pickables.push(mesh);
    return mesh;
  }

  /* ---------------- Vinyl ---------------- */
  makeVinylTexture(p, title = '') {
    const size = 512;
    const canvas = this.vinyl[p]?.canvas || document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const c = size / 2;
    ctx.clearRect(0, 0, size, size);

    // Grooves
    const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, '#111');
    grad.addColorStop(1, '#050505');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.fill();
    for (let r = c * 0.36; r < c * 0.97; r += 2.2) {
      ctx.strokeStyle = `rgba(255,255,255,${0.025 + 0.03 * Math.random()})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Sheen wedges so rotation is readable
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    [0, Math.PI].forEach(a0 => {
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, c * 0.96, a0, a0 + 0.35);
      ctx.closePath();
      ctx.fill();
    });

    // Label
    const hex = `#${DECK_COLORS[p].toString(16).padStart(6, '0')}`;
    ctx.fillStyle = hex;
    ctx.beginPath();
    ctx.arc(c, c, c * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.arc(c, c, c * 0.34, -0.5, 0.9);
    ctx.lineTo(c, c);
    ctx.fill();
    ctx.fillStyle = '#0a0a0a';
    ctx.textAlign = 'center';
    ctx.font = 'bold 38px "Bebas Neue", Impact, sans-serif';
    ctx.fillText('WWTS', c, c - 22);
    ctx.font = 'bold 22px "Inter", sans-serif';
    ctx.fillText(`DECK ${p}`, c, c + 34);
    if (title) {
      ctx.font = '600 15px "Inter", sans-serif';
      const short = title.length > 22 ? `${title.slice(0, 21)}…` : title;
      ctx.fillText(short, c, c + 58);
    }
    // Spindle + cue marker
    ctx.fillStyle = '#ddd';
    ctx.beginPath();
    ctx.arc(c, c, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(c - 3, size * 0.035, 6, size * 0.09);

    if (this.vinyl[p]?.texture) this.vinyl[p].texture.needsUpdate = true;
    return canvas;
  }

  buildVinyl(p) {
    const x = DECK_X[p];
    const top = this.surfaceY(x + 0.15, JOG_Z, 1.288);
    const canvas = this.makeVinylTexture(p);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const topMat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.32, metalness: 0.25 });
    const sideMat = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.5 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(JOG_RADIUS, JOG_RADIUS, 0.008, 64), [sideMat, topMat, sideMat]);
    disc.position.set(x, top + 0.005, JOG_Z);
    disc.castShadow = true;
    this.group.add(disc);
    this.pickable(disc, { type: 'vinyl', deck: p, label: `Deck ${p} platter — drag to scratch / seek` });
    this.vinyl[p] = { mesh: disc, canvas, texture, top: top + 0.009 };
  }

  buildProgressRing(p) {
    const seg = new THREE.BoxGeometry(0.018, 0.004, 0.01);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const ring = new THREE.InstancedMesh(seg, mat, RING_SEGMENTS);
    const x = DECK_X[p];
    const y = this.vinyl[p].top - 0.004;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2;
      // Start at 12 o'clock from the DJ's view (toward the audience) and run clockwise
      const px = x + Math.sin(a) * (JOG_RADIUS + 0.018) * -1;
      const pz = JOG_Z + Math.cos(a) * (JOG_RADIUS + 0.018);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      m.compose(new THREE.Vector3(px, y, pz), q, new THREE.Vector3(1, 1, 1));
      ring.setMatrixAt(i, m);
      ring.setColorAt(i, new THREE.Color(0x222222));
    }
    this.group.add(ring);
    this.rings[p] = ring;
  }

  /* ---------------- Transport ---------------- */
  makeButton(x, z, radius, color, control) {
    const y = this.surfaceY(x, z, 1.21);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a1a1f, emissive: color, emissiveIntensity: 0.15, roughness: 0.4 });
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.018, 32), mat);
    btn.position.set(x, y + 0.012, z);
    this.group.add(btn);
    this.pickable(btn, control);
    return { mesh: btn, mat, baseY: btn.position.y };
  }

  buildTransport(p) {
    const s = p === 1 ? -1 : 1;
    this.buttons[`play${p}`] = this.makeButton(s * 0.555, TRANSPORT_Z, 0.058, 0x22ff77, { type: 'play', deck: p, label: `Deck ${p} PLAY / PAUSE` });
    this.buttons[`cue${p}`] = this.makeButton(s * 0.69, TRANSPORT_Z, 0.045, 0xffaa00, { type: 'cue', deck: p, label: `Deck ${p} CUE (set when paused, jump back when playing)` });
  }

  /* ---------------- Pads ---------------- */
  buildPads() {
    [1, 2].forEach(p => {
      const s = p === 1 ? -1 : 1;
      PAD_Z.forEach((z, row) => {
        PAD_X.forEach((ax, col) => {
          const index = (p - 1) * 10 + row * 5 + col;
          const x = s * ax;
          const y = this.surfaceY(x, z, 1.22);
          const mat = new THREE.MeshStandardMaterial({ color: 0x1c1c22, emissive: 0xffffff, emissiveIntensity: 0.18, roughness: 0.55 });
          const pad = new THREE.Mesh(new THREE.BoxGeometry(PAD_SIZE, 0.012, PAD_SIZE), mat);
          pad.position.set(x, y + 0.004, z);
          this.group.add(pad);
          this.pickable(pad, { type: 'pad', index, label: '' });
          this.pads[index] = { mesh: pad, mat, glow: 0, baseY: pad.position.y };
        });
      });
    });
    this.refreshPadColors();
  }

  refreshPadColors() {
    this.pads.forEach((pad, i) => {
      const cfg = this.padBank?.pads[i];
      if (!pad || !cfg) return;
      pad.mat.emissive.set(cfg.color);
      pad.mesh.userData.control.label = `Pad ${i + 1}: ${cfg.label} — right-click to change`;
    });
  }

  flashPad(index) {
    const pad = this.pads[index];
    if (pad) pad.glow = 1;
  }

  /* ---------------- Knobs ---------------- */
  buildKnobs() {
    const bodyGeo = new THREE.CylinderGeometry(KNOB_RADIUS, KNOB_RADIUS * 1.06, 1, 28);
    const markGeo = new THREE.BoxGeometry(0.008, 0.006, KNOB_RADIUS * 0.85);
    [1, 2].forEach(p => {
      const s = p === 1 ? -1 : 1;
      ['outer', 'inner'].forEach(col => {
        KNOB_LAYOUT[col].forEach((def, row) => {
          if (def.side && def.side !== p) {
            // The other deck's inner MASTER slot controls the pad volume instead
            def = { param: 'pads', label: 'PAD VOL' };
          }
          const x = s * KNOB_COL_X[col];
          const z = KNOB_ROWS_Z[row];
          const base = this.surfaceY(x + KNOB_RADIUS * 1.6, z, 1.2);
          const top = this.surfaceY(x, z, base + 0.18) + 0.006;
          const height = Math.max(0.03, top - base);
          const group = new THREE.Group();
          group.position.set(x, base, z);
          const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0x15161b, roughness: 0.45, metalness: 0.4 }));
          body.scale.y = height;
          body.position.y = height / 2;
          const mark = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ color: DECK_COLORS[p], toneMapped: false }));
          mark.position.set(0, height + 0.003, KNOB_RADIUS * 0.45);
          group.add(body, mark);
          this.group.add(group);
          const knob = {
            group, deck: p, param: def.param, label: def.label, visual: !!def.visual,
            min: ['echo', 'master', 'pads', 'booth', 'headphones'].includes(def.param) ? 0 : -1,
            max: 1
          };
          knob.default = knob.min === 0 ? (def.param === 'echo' ? 0 : 0.85) : 0;
          if (def.param === 'master') knob.default = this.audio.masterVolume;
          if (def.param === 'pads') knob.default = this.padBank?.volume ?? 0.85;
          this.pickable(body, { type: 'knob', knob, label: def.label });
          this.knobs.push(knob);
        });
      });
    });
  }

  getKnobValue(knob) {
    switch (knob.param) {
      case 'master': return this.audio.masterVolume;
      case 'pads': return this.padBank?.volume ?? 0.85;
      default:
        if (knob.visual) return this.visualKnobValues[`${knob.deck}-${knob.param}`] ?? knob.default;
        return this.audio.getMixParam(knob.deck, knob.param) ?? 0;
    }
  }

  setKnobValue(knob, value) {
    const v = Math.max(knob.min, Math.min(knob.max, value));
    switch (knob.param) {
      case 'master': this.audio.setMasterVolume(v); break;
      case 'pads': this.padBank?.setVolume(v); this.syncPadVolumeSlider(v); break;
      default:
        if (knob.visual) this.visualKnobValues[`${knob.deck}-${knob.param}`] = v;
        else this.audio.setMixParam(knob.deck, knob.param, v);
    }
  }

  syncPadVolumeSlider(v) {
    const slider = document.getElementById('soundboard-volume');
    if (slider) slider.value = v;
  }

  describeKnob(knob) {
    const v = this.getKnobValue(knob);
    switch (knob.param) {
      case 'trim': return `${(v * 12).toFixed(1)} dB`;
      case 'high': case 'mid': case 'low': {
        const db = v < 0 ? v * 26 : v * 6;
        return v <= -0.98 ? 'KILL' : `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
      }
      case 'filter': return Math.abs(v) < 0.03 ? 'OFF' : v < 0 ? `LOW-PASS ${Math.round(-v * 100)}%` : `HIGH-PASS ${Math.round(v * 100)}%`;
      case 'tempo': return `${v >= 0 ? '+' : ''}${(v * 8).toFixed(2)}%`;
      case 'booth': case 'headphones': return `${Math.round(v * 100)}% (visual only)`;
      default: return `${Math.round(v * 100)}%`;
    }
  }

  /* ---------------- Faders ---------------- */
  buildChannelFader(p) {
    const s = p === 1 ? -1 : 1;
    const y = this.surfaceY(s * 1.0, SLIDER_Z, 1.211);
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.035, 0.085),
      new THREE.MeshStandardMaterial({ color: 0xe8e8ee, emissive: DECK_COLORS[p], emissiveIntensity: 0.25, roughness: 0.35 })
    );
    cap.position.set(0, y + 0.018, SLIDER_Z);
    this.group.add(cap);
    this.pickable(cap, { type: 'channel', deck: p, label: `Deck ${p} volume fader` });
    this.faders[`ch${p}`] = { mesh: cap, axis: [s * SLIDER_TRAVEL[0], s * SLIDER_TRAVEL[1]], y: y + 0.018 };
  }

  buildCrossfader() {
    const y = this.surfaceY(0, XFADER.z, 1.202);
    const slot = new THREE.Mesh(
      new THREE.BoxGeometry(XFADER.half * 2 + 0.04, 0.004, 0.022),
      new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.8 })
    );
    slot.position.set(0, y + 0.002, XFADER.z);
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.04, 0.075),
      new THREE.MeshStandardMaterial({ color: 0xf2f2f5, emissive: 0xffaa00, emissiveIntensity: 0.3, roughness: 0.35 })
    );
    cap.position.set(0, y + 0.022, XFADER.z);
    this.group.add(slot, cap);
    this.pickable(cap, { type: 'xfade', label: 'Crossfader' });
    this.pickable(slot, { type: 'xfade', label: 'Crossfader' });
    // Deck 1 is on the audience's left (x < 0)
    this.faders.xfade = { mesh: cap, axis: [-XFADER.half, XFADER.half], y: y + 0.022 };
  }

  setFaderFromPoint(fader, x) {
    const [a, b] = fader.axis;
    return Math.max(0, Math.min(1, (x - a) / (b - a)));
  }

  /* ============================================================
     INTERACTION
     ============================================================ */
  pick(raycaster) {
    const hit = raycaster.intersectObjects(this.pickables, false)[0];
    return hit ? { control: hit.object.userData.control, point: hit.point } : null;
  }

  planePoint(raycaster, y) {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const out = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, out) ? out : null;
  }

  /** Returns true if a deck control took the pointer */
  pointerDown(raycaster, e) {
    if (!this.built) return false;
    const hit = this.pick(raycaster);
    this.consumedClick = !!hit;
    if (!hit) return false;
    const c = hit.control;

    if (e.button === 2) {
      if (c.type === 'pad') this.padBank?.openEditor(c.index);
      return true;
    }

    switch (c.type) {
      case 'vinyl': {
        const p = c.deck;
        const pt = this.planePoint(raycaster, this.vinyl[p].top) || hit.point;
        this.audio.scratchStart(p);
        this.drag = { type: 'vinyl', deck: p, lastAngle: this.angleOn(p, pt), lastT: performance.now() };
        this.dj.onDeckScratch?.(p, true);
        break;
      }
      case 'knob':
        if (e.detail === 2) {
          this.setKnobValue(c.knob, c.knob.default); // double-click resets
        } else {
          this.drag = { type: 'knob', knob: c.knob, startY: e.clientY, startValue: this.getKnobValue(c.knob) };
        }
        break;
      case 'channel':
      case 'xfade': {
        const fader = c.type === 'xfade' ? this.faders.xfade : this.faders[`ch${c.deck}`];
        this.drag = { type: c.type, deck: c.deck, fader };
        this.pointerMove(raycaster, e);
        break;
      }
      case 'pad':
        this.padBank?.trigger(c.index);
        this.pressButton(this.pads[c.index]);
        break;
      case 'play':
        this.audio.togglePlay(c.deck);
        this.pressButton(this.buttons[`play${c.deck}`]);
        break;
      case 'cue':
        this.audio.cue(c.deck);
        this.pressButton(this.buttons[`cue${c.deck}`]);
        break;
      default:
        break;
    }
    this.showTooltip(c, e);
    return true;
  }

  pointerMove(raycaster, e) {
    if (!this.drag) {
      this.updateHover(raycaster, e);
      return;
    }
    const d = this.drag;
    if (d.type === 'vinyl') {
      const pt = this.planePoint(raycaster, this.vinyl[d.deck].top);
      if (!pt) return;
      const now = performance.now();
      const ang = this.angleOn(d.deck, pt);
      let delta = Math.atan2(Math.sin(ang - d.lastAngle), Math.cos(ang - d.lastAngle));
      // Pointer moving clockwise (seen from above) = playing direction = forward
      this.audio.scratchMove(d.deck, delta, (now - d.lastT) / 1000);
      d.lastAngle = ang;
      d.lastT = now;
    } else if (d.type === 'knob') {
      const range = d.knob.max - d.knob.min;
      this.setKnobValue(d.knob, d.startValue + ((d.startY - e.clientY) / 180) * range);
    } else if (d.type === 'channel' || d.type === 'xfade') {
      const pt = this.planePoint(raycaster, d.fader.y);
      if (!pt) return;
      const v = this.setFaderFromPoint(d.fader, pt.x);
      if (d.type === 'xfade') this.audio.setCrossfade(v);
      else this.audio.setChannelVolume(d.deck, v);
    }
    this.showTooltip(this.dragControl(), e);
  }

  pointerUp() {
    if (this.drag?.type === 'vinyl') {
      this.audio.scratchEnd(this.drag.deck);
      this.dj.onDeckScratch?.(this.drag.deck, false);
    }
    this.drag = null;
    this.hideTooltip();
  }

  dragControl() {
    const d = this.drag;
    if (!d) return null;
    if (d.type === 'knob') return { type: 'knob', knob: d.knob, label: d.knob.label };
    if (d.type === 'vinyl') return { type: 'vinyl', deck: d.deck, label: `Deck ${d.deck} platter` };
    if (d.type === 'xfade') return { type: 'xfade', label: 'Crossfader' };
    return { type: 'channel', deck: d.deck, label: `Deck ${d.deck} volume fader` };
  }

  /** Angle of a point around a platter, increasing clockwise when seen from above */
  angleOn(p, pt) {
    return Math.atan2(pt.x - DECK_X[p], pt.z - JOG_Z);
  }

  updateHover(raycaster, e) {
    const hit = this.built ? this.pick(raycaster) : null;
    const canvas = this.dj.renderer?.domElement;
    if (canvas) canvas.style.cursor = hit ? (hit.control.type === 'vinyl' || hit.control.type === 'knob' ? 'grab' : 'pointer') : '';
    if (hit) this.showTooltip(hit.control, e);
    else this.hideTooltip();
    this.hover = hit?.control || null;
  }

  pressButton(btn) {
    if (!btn) return;
    btn.mesh.position.y = btn.baseY - 0.006;
    setTimeout(() => { btn.mesh.position.y = btn.baseY; }, 110);
  }

  /* ---------------- Tooltip ---------------- */
  createTooltip() {
    const el = document.createElement('div');
    el.className = 'deck-tooltip';
    el.hidden = true;
    document.body.appendChild(el);
    this.tooltip = el;
  }

  describeControl(c) {
    if (!c) return '';
    switch (c.type) {
      case 'knob': return `${c.knob.label} · Deck ${c.knob.deck}: <b>${this.describeKnob(c.knob)}</b><br><small>Drag up/down · double-click resets</small>`;
      case 'channel': return `Deck ${c.deck} volume: <b>${Math.round(this.audio.getMixParam(c.deck, 'channel') * 100)}%</b>`;
      case 'xfade': {
        const v = this.audio.crossfade;
        return `Crossfader: <b>${v < 0.05 ? 'DECK 1' : v > 0.95 ? 'DECK 2' : `${Math.round((1 - v) * 100)} / ${Math.round(v * 100)}`}</b>`;
      }
      case 'vinyl': {
        const st = this.audio.getDeckState(c.deck);
        const t = this.audio.formatTime(st.time);
        return st.loaded
          ? `Deck ${c.deck} · ${this.escape(st.title)}<br><b>${t} / ${this.audio.formatTime(st.duration)}</b> · drag to scratch`
          : `Deck ${c.deck} is empty — load a beat below`;
      }
      default: return this.escape(c.label || '');
    }
  }

  escape(s) {
    return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  showTooltip(c, e) {
    if (!this.tooltip || !c || !e) return;
    this.tooltip.innerHTML = this.describeControl(c);
    this.tooltip.style.left = `${e.clientX + 14}px`;
    this.tooltip.style.top = `${e.clientY + 14}px`;
    this.tooltip.hidden = false;
  }

  hideTooltip() {
    if (this.tooltip) this.tooltip.hidden = true;
  }

  /* ============================================================
     PER-FRAME SYNC
     ============================================================ */
  syncAll() {
    [1, 2].forEach(p => {
      const st = this.audio.getDeckState(p);
      this.makeVinylTexture(p, st.loaded ? st.title : '');
    });
    this.refreshPadColors();
  }

  onTrackLoaded(p) {
    const st = this.audio.getDeckState(p);
    this.makeVinylTexture(p, st.title);
  }

  update(delta, elapsed) {
    if (!this.built) return;
    const blink = (Math.sin(elapsed * 6) + 1) / 2;
    [1, 2].forEach(p => {
      const st = this.audio.getDeckState(p);

      // Platter angle follows the track position (1 turn = 1.8 s), smoothed between updates
      const target = -(st.time / ROTATION_SECONDS) * Math.PI * 2;
      if (st.playing && !st.scratching) {
        const rate = 1 + (this.audio.getMixParam(p, 'tempo') || 0) * 0.08;
        this.vinylAngle[p] -= (delta / ROTATION_SECONDS) * Math.PI * 2 * rate;
        const drift = Math.atan2(Math.sin(target - this.vinylAngle[p]), Math.cos(target - this.vinylAngle[p]));
        this.vinylAngle[p] += drift * Math.min(1, delta * 4);
      } else {
        this.vinylAngle[p] = target;
      }
      this.vinyl[p].mesh.rotation.y = this.vinylAngle[p];

      // Progress ring
      const ring = this.rings[p];
      const progress = st.duration ? st.time / st.duration : 0;
      const lit = Math.floor(progress * RING_SEGMENTS);
      const deckColor = new THREE.Color(DECK_COLORS[p]);
      const nearEnd = st.duration && st.duration - st.time < 20 && !this.audio.players[p].audio.loop;
      for (let i = 0; i < RING_SEGMENTS; i++) {
        let col;
        if (!st.loaded) col = new THREE.Color(0x1a1a1a);
        else if (i < lit) col = nearEnd && blink > 0.5 ? new THREE.Color(0xff3030) : deckColor.clone().multiplyScalar(0.9);
        else if (i === lit) col = new THREE.Color(0xffffff);
        else col = new THREE.Color(0x2a2a2e);
        ring.setColorAt(i, col);
      }
      ring.instanceColor.needsUpdate = true;

      // Buttons
      const play = this.buttons[`play${p}`];
      play.mat.emissiveIntensity = st.playing ? 1.4 : st.loaded ? 0.25 + 0.6 * blink : 0.08;
      const cue = this.buttons[`cue${p}`];
      const atCue = st.loaded && !st.playing && Math.abs(st.time - st.cuePoint) < 0.05;
      cue.mat.emissiveIntensity = atCue ? 1.2 : st.loaded && !st.playing ? 0.3 + 0.5 * blink : 0.12;

      // Channel fader position
      const ch = this.faders[`ch${p}`];
      const v = this.audio.getMixParam(p, 'channel');
      ch.mesh.position.x = ch.axis[0] + (ch.axis[1] - ch.axis[0]) * v;
    });

    // Crossfader
    const xf = this.faders.xfade;
    xf.mesh.position.x = xf.axis[0] + (xf.axis[1] - xf.axis[0]) * this.audio.crossfade;

    // Knobs: ±135° sweep
    this.knobs.forEach(knob => {
      const v = this.getKnobValue(knob);
      const u = (v - knob.min) / (knob.max - knob.min);
      knob.group.rotation.y = -(u - 0.5) * Math.PI * 1.5;
    });

    // Pad glow decay
    this.pads.forEach(pad => {
      if (!pad) return;
      pad.glow = Math.max(0, pad.glow - delta * 3.5);
      pad.mat.emissiveIntensity = 0.18 + pad.glow * 2.4;
    });
  }
}

export { DeckControls };
