/**
 * Arena around the battle stage: lighting truss with moving-head beams,
 * floor uplights, laser fan, LED floor, tiered crowd with phone lights,
 * and low haze. Everything reacts to the music and to battle moments.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addRimLight } from './rimLight.js';

const RED = 0xff2d2d;
const CYAN = 0x00e5ff;
const AMBER = 0xffaa00;
const FLOOR_Y = -0.36;

const BEAM_VERT = `
varying vec3 vN;
varying vec3 vView;
varying float vT;
void main() {
  vT = uv.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}`;
const BEAM_FRAG = `
uniform vec3 uColor;
uniform float uIntensity;
varying vec3 vN;
varying vec3 vView;
varying float vT;
void main() {
  float edge = pow(abs(dot(normalize(vN), normalize(vView))), 1.8);
  float a = uIntensity * edge * pow(vT, 1.6);
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

const FLOOR_VERT = `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FLOOR_FRAG = `
uniform float uTime;
uniform float uBass;
uniform float uLeft;
uniform float uRight;
uniform vec3 uFocus;
uniform float uFocusAmt;
varying vec2 vP;
void main() {
  float r = length(vP);
  float rings = smoothstep(0.86, 1.0, sin(r * 5.0 - uTime * 2.6) * 0.5 + 0.5);
  float rim = smoothstep(4.55, 5.05, r) * (1.0 - smoothstep(5.05, 5.15, r));
  float spokes = smoothstep(0.96, 1.0, sin(atan(vP.y, vP.x) * 12.0 + uTime * 0.6) * 0.5 + 0.5) * smoothstep(1.2, 4.8, r);
  float side = smoothstep(-1.2, 1.2, vP.x);
  vec3 col = mix(vec3(1.0, 0.16, 0.16) * (0.35 + uLeft), vec3(0.0, 0.85, 1.0) * (0.35 + uRight), side);
  col = mix(col, uFocus, uFocusAmt);
  float a = rings * (0.05 + uBass * 0.45) + rim * (0.3 + uBass * 0.5) + spokes * 0.05;
  gl_FragColor = vec4(col * a, 1.0);
}`;

function makeGlowTexture(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeTrussTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff';
  g.lineWidth = 7;
  g.strokeRect(3, 3, 58, 58);
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(64, 64);
  g.moveTo(64, 0); g.lineTo(0, 64);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

class StageArena {
  constructor(scene, { quality = 'high' } = {}) {
    this.scene = scene;
    this.quality = quality;
    this.hype = 0;          // 0..1, crowd energy
    this.cheerTimer = 0;    // seconds of full-on cheering left
    this.focus = null;      // { pos: Vector3, color: Color } — beams converge on a winner
    this.bass = 0;
    this.highs = 0;
    this.glowTex = makeGlowTexture();

    this.group = new THREE.Group();
    this.group.name = 'arena';
    scene.add(this.group);

    this.buildTruss();
    this.buildBeams();
    this.buildLasers();
    this.buildFloorFx();
    this.buildBleachers();
    this.buildCrowd();
    this.buildHaze();
    this.setQuality(quality);
  }

  /* ---------------- Lighting truss ---------------- */
  buildTruss() {
    const base = makeTrussTexture();
    const mat = (len) => {
      const tex = base.clone();
      tex.needsUpdate = true;
      tex.repeat.set(1, Math.max(1, Math.round(len / 0.32)));
      return new THREE.MeshStandardMaterial({
        color: 0xb8bec9, metalness: 0.85, roughness: 0.35,
        alphaMap: tex, alphaTest: 0.5, side: THREE.DoubleSide
      });
    };
    const beam = (len, from, axis) => {
      const geo = new THREE.BoxGeometry(0.32, len, 0.32);
      const m = new THREE.Mesh(geo, mat(len));
      m.position.copy(from);
      if (axis === 'x') m.rotation.z = Math.PI / 2;
      if (axis === 'z') m.rotation.x = Math.PI / 2;
      this.group.add(m);
      return m;
    };

    this.trussY = 5.2;
    const X = 5.0;
    const ZF = 3.0;
    const ZB = -3.8;
    const H = this.trussY - FLOOR_Y;
    // Towers
    [[-X, ZF], [X, ZF], [-X, ZB], [X, ZB]].forEach(([x, z]) => {
      beam(H, new THREE.Vector3(x, FLOOR_Y + H / 2, z), 'y');
      const foot = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.06, 0.7),
        new THREE.MeshStandardMaterial({ color: 0x22252e, metalness: 0.7, roughness: 0.4 })
      );
      foot.position.set(x, FLOOR_Y + 0.03, z);
      this.group.add(foot);
    });
    // Top frame
    beam(2 * X, new THREE.Vector3(0, this.trussY, ZF), 'x');
    beam(2 * X, new THREE.Vector3(0, this.trussY, ZB), 'x');
    beam(ZF - ZB, new THREE.Vector3(-X, this.trussY, (ZF + ZB) / 2), 'z');
    beam(ZF - ZB, new THREE.Vector3(X, this.trussY, (ZF + ZB) / 2), 'z');

    // LED strips running up the towers
    this.towerStrips = [];
    [[-X, ZF, RED], [X, ZF, CYAN], [-X, ZB, RED], [X, ZB, CYAN]].forEach(([x, z, color]) => {
      const m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.04, H - 0.4, 0.04), m);
      strip.position.set(x + (x > 0 ? -0.19 : 0.19), FLOOR_Y + H / 2, z + (z > 0 ? -0.19 : 0.19));
      this.group.add(strip);
      this.towerStrips.push({ mat: m, base: new THREE.Color(color) });
    });

    this.trussFrame = { X, ZF, ZB };
  }

  /* ---------------- Moving-head beams ---------------- */
  makeFixture(pos, color, { length = 9, radius = 1.0, floor = false } = {}) {
    const fixture = new THREE.Group();
    fixture.position.copy(pos);

    const yoke = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.12, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x1a1c22, metalness: 0.6, roughness: 0.4 })
    );
    yoke.position.y = floor ? -0.12 : 0.12;
    fixture.add(yoke);

    const head = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.1, 0.32, 16),
      new THREE.MeshStandardMaterial({ color: 0x15171c, metalness: 0.7, roughness: 0.35 })
    );
    body.position.y = -0.08;
    head.add(body);
    const lensMat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.11, 20), lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.y = -0.245;
    head.add(lens);

    const geo = new THREE.ConeGeometry(radius, length, 32, 1, true);
    geo.translate(0, -length / 2, 0); // apex at the lens, cone points down -Y
    const uniforms = { uColor: { value: new THREE.Color(color) }, uIntensity: { value: 0.35 } };
    const cone = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms,
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    }));
    cone.position.y = -0.24;
    cone.frustumCulled = false;
    head.add(cone);
    fixture.add(head);
    this.group.add(fixture);

    return {
      fixture, head, cone, uniforms, lensMat,
      base: new THREE.Color(color),
      aim: new THREE.Vector3(),
      dir: new THREE.Vector3(0, -1, 0)
    };
  }

  buildBeams() {
    this.beams = [];
    const { X, ZF, ZB } = this.trussFrame;
    const y = this.trussY - 0.3;
    // Truss heads: front and back rows, red stage-left, cyan stage-right
    [-3.6, -1.2, 1.2, 3.6].forEach((x, i) => {
      const color = x < 0 ? RED : CYAN;
      this.beams.push({ ...this.makeFixture(new THREE.Vector3(x, y, ZF), color), kind: 'front', idx: i });
      this.beams.push({ ...this.makeFixture(new THREE.Vector3(x * 1.1, y, ZB), color), kind: 'back', idx: i });
    });
    // Floor uplights behind the screen, crossing beams over the stage
    [-4.4, -2.6, 2.6, 4.4].forEach((x, i) => {
      const color = i % 2 === 0 ? AMBER : (x < 0 ? RED : CYAN);
      const b = this.makeFixture(new THREE.Vector3(x, FLOOR_Y + 0.25, -5.4), color, { length: 14, radius: 1.1, floor: true });
      this.beams.push({ ...b, kind: 'floor', idx: i });
    });
    this._up = new THREE.Vector3(0, -1, 0);
    this._tmp = new THREE.Vector3();
  }

  aimBeam(b, target, lerp = 0.08) {
    this._tmp.copy(target).sub(b.fixture.position).normalize();
    b.dir.lerp(this._tmp, lerp).normalize();
    b.head.quaternion.setFromUnitVectors(this._up, b.dir);
  }

  /* ---------------- Laser fan ---------------- */
  buildLasers() {
    this.lasers = new THREE.Group();
    this.lasers.position.set(0, 3.55, -4.7);
    const geo = new THREE.CylinderGeometry(0.01, 0.01, 30, 5, 1, true);
    geo.translate(0, 15, 0);
    geo.rotateX(Math.PI / 2); // points along +Z, out over the crowd
    this.laserBeams = [];
    for (let i = 0; i < 12; i++) {
      const color = i % 3 === 0 ? 0x22ff66 : (i % 3 === 1 ? RED : CYAN);
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.7,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
      });
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      this.lasers.add(m);
      this.laserBeams.push({ mesh: m, mat, i });
    }
    const emitter = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.18, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x15171c, metalness: 0.7, roughness: 0.3 })
    );
    this.lasers.add(emitter);
    this.lasers.visible = false;
    this.group.add(this.lasers);
  }

  /* ---------------- LED floor ---------------- */
  buildFloorFx() {
    this.floorUniforms = {
      uTime: { value: 0 },
      uBass: { value: 0 },
      uLeft: { value: 0.3 },
      uRight: { value: 0.3 },
      uFocus: { value: new THREE.Color(AMBER) },
      uFocusAmt: { value: 0 }
    };
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(5.15, 128),
      new THREE.ShaderMaterial({
        uniforms: this.floorUniforms,
        vertexShader: FLOOR_VERT,
        fragmentShader: FLOOR_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.004;
    disc.renderOrder = 1;
    this.group.add(disc);
  }

  /* ---------------- Bleachers ---------------- */
  buildBleachers() {
    this.rows = [];
    const pts = [new THREE.Vector2(10.4, FLOOR_Y)];
    let r = 10.4;
    let y = FLOOR_Y;
    for (let k = 0; k < 7; k++) {
      y += 0.5;
      pts.push(new THREE.Vector2(r, y));
      r += 0.85;
      pts.push(new THREE.Vector2(r, y));
      this.rows.push({ r: r - 0.42, y });
    }
    pts.push(new THREE.Vector2(r, FLOOR_Y));
    const stands = new THREE.Mesh(
      new THREE.LatheGeometry(pts, 120),
      new THREE.MeshStandardMaterial({ color: 0x14151c, roughness: 0.9, metalness: 0.1, side: THREE.DoubleSide })
    );
    stands.receiveShadow = true;
    this.group.add(stands);

    // Glowing rail along the front of the stands
    this.railMat = new THREE.MeshBasicMaterial({ color: 0x7a3cff, toneMapped: false });
    const rail = new THREE.Mesh(new THREE.TorusGeometry(10.4, 0.03, 8, 160), this.railMat);
    rail.rotation.x = Math.PI / 2;
    rail.position.y = FLOOR_Y + 0.5;
    this.group.add(rail);
  }

  /* ---------------- Crowd ---------------- */
  buildCrowd() {
    const torso = new THREE.CapsuleGeometry(0.19, 0.95, 2, 8);
    torso.scale(1.25, 1, 0.75); // shoulders wider than deep
    torso.translate(0, 0.665, 0);
    const head = new THREE.SphereGeometry(0.12, 8, 6);
    head.translate(0, 1.47, 0);
    const bodyGeo = mergeGeometries([torso, head]);

    const armL = new THREE.CapsuleGeometry(0.045, 0.5, 1, 4);
    armL.translate(0, 0.25, 0);
    armL.rotateZ(0.35);
    armL.translate(-0.2, 1.22, 0);
    const armR = new THREE.CapsuleGeometry(0.045, 0.5, 1, 4);
    armR.translate(0, 0.25, 0);
    armR.rotateZ(-0.35);
    armR.translate(0.2, 1.22, 0);
    const armsGeo = mergeGeometries([armL, armR]);

    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    addRimLight(mat, { color: 0x7a5cff, strength: 0.28, power: 3.2 });

    // Seats: a standing pit around the stage plus the tiered stands
    const spots = [];
    [6.1, 6.75, 7.4, 8.05, 8.7].forEach((rad, row) => {
      const step = 0.62 / rad;
      for (let a = -2.15 + (row % 2) * step / 2; a <= 2.15; a += step) {
        spots.push({ a: a + (Math.random() - 0.5) * step * 0.5, r: rad + (Math.random() - 0.5) * 0.25, y: FLOOR_Y, pit: true });
      }
    });
    this.rows.forEach((row, k) => {
      const step = 0.64 / row.r;
      for (let a = (k % 2) * step / 2; a < Math.PI * 2; a += step) {
        if (Math.random() < 0.12) continue; // a few empty seats
        spots.push({ a: a + (Math.random() - 0.5) * step * 0.3, r: row.r, y: row.y, pit: false });
      }
    });

    const n = spots.length;
    this.crowdBody = new THREE.InstancedMesh(bodyGeo, mat, n);
    this.crowdArms = new THREE.InstancedMesh(armsGeo, mat, n);
    [this.crowdBody, this.crowdArms].forEach(m => {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      this.group.add(m);
    });

    const color = new THREE.Color();
    const tints = [0x1d1e26, 0x26222b, 0x191b21, 0x2b2630, 0x1f2329, 0x2e2722];
    this.fans = spots.map((s, i) => {
      const x = Math.sin(s.a) * s.r;
      const z = Math.cos(s.a) * s.r;
      color.setHex(tints[i % tints.length]);
      // Light spill from the coloured side of the stage
      if (x < -2) color.lerp(new THREE.Color(0x5a1820), 0.35);
      else if (x > 2) color.lerp(new THREE.Color(0x103e4a), 0.35);
      this.crowdBody.setColorAt(i, color);
      this.crowdArms.setColorAt(i, color);
      return {
        x, z, y: s.y,
        face: Math.atan2(-x, -z), // look at the stage
        scale: 0.86 + Math.random() * 0.24,
        phase: Math.random() * Math.PI * 2,
        energy: s.pit ? 0.7 + Math.random() * 0.5 : 0.3 + Math.random() * 0.6,
        armsAt: Math.random(),   // raises arms once hype passes this
        phone: Math.random() < (s.pit ? 0.16 : 0.1),
        pit: s.pit
      };
    });
    this.crowdBody.instanceColor.needsUpdate = true;
    this.crowdArms.instanceColor.needsUpdate = true;

    // Phone screens/flashlights held up in the crowd
    const phones = this.fans.filter(f => f.phone);
    this.phoneFans = phones;
    this.phonePositions = new Float32Array(phones.length * 3);
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute('position', new THREE.BufferAttribute(this.phonePositions, 3));
    this.phonePoints = new THREE.Points(pgeo, new THREE.PointsMaterial({
      size: 0.16, map: this.glowTex, color: 0xdfe8ff, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false
    }));
    this.phonePoints.frustumCulled = false;
    this.group.add(this.phonePoints);

    this._dummy = new THREE.Object3D();
    this._hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  /* ---------------- Haze ---------------- */
  buildHaze() {
    const tex = new THREE.TextureLoader().load('/textures/particles/PNG/White puff/whitePuff00.png');
    this.haze = [];
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex, color: 0x5a6078, transparent: true, opacity: 0.05 + Math.random() * 0.04,
        depthWrite: false, blending: THREE.AdditiveBlending
      });
      const s = new THREE.Sprite(mat);
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 6;
      s.position.set(Math.sin(a) * r, 0.4 + Math.random() * 1.6, Math.cos(a) * r - 1);
      const size = 5 + Math.random() * 5;
      s.scale.set(size, size * 0.6, 1);
      this.group.add(s);
      this.haze.push({ s, mat, vx: (Math.random() - 0.5) * 0.12, spin: (Math.random() - 0.5) * 0.05 });
    }
  }

  /* ---------------- Battle moments ---------------- */
  /** Crowd erupts: jumps, arms up, beams go wild */
  /** Add outside hype (0..1); a big burst also sets off a cheer */
  boost(amount = 0.05) {
    this.externalHype = Math.min(1, (this.externalHype || 0) + amount);
    if (this.externalHype > 0.85 && !(this.cheerTimer > 0)) this.cheer(1.6);
  }

  cheer(seconds = 2.5) {
    this.cheerTimer = Math.max(this.cheerTimer, seconds);
  }

  /** All beams converge on a point (the winner) in one colour */
  focusOn(pos, color = AMBER) {
    this.focus = { pos: pos.clone(), color: new THREE.Color(color) };
  }

  clearFocus() {
    this.focus = null;
  }

  setQuality(preset = 'high') {
    this.quality = preset;
    const low = preset === 'low';
    this.haze.forEach(h => { h.s.visible = !low; });
    this.phonePoints.visible = true;
    // Low quality keeps every other fan
    this.crowdStride = low ? 2 : 1;
  }

  /* ---------------- Per-frame ---------------- */
  /**
   * s: { playing, active1, active2, bass, highs, beat, chars: [null, Vector3|null, Vector3|null],
   *      reducedMotion, noFlash }
   */
  update(delta, elapsed, s) {
    const smooth = 1 - Math.exp(-delta * 12);
    this.bass += ((s.playing ? s.bass : 0) - this.bass) * smooth;
    this.highs += ((s.playing ? s.highs : 0) - this.highs) * smooth;
    this.cheerTimer = Math.max(0, this.cheerTimer - delta);
    const cheering = this.cheerTimer > 0;
    // outside energy (crowd phones, live chat) lifts the floor and slowly fades
    this.externalHype = Math.max(0, (this.externalHype || 0) - delta * 0.05);
    const targetHype = cheering ? 1 : Math.max(this.externalHype, s.playing ? 0.35 + Math.min(0.45, this.bass * 0.9) : 0.08);
    this.hype += (targetHype - this.hype) * (1 - Math.exp(-delta * (cheering ? 6 : 1.5)));

    const motion = s.reducedMotion ? 0.15 : 1;
    const pulse = s.noFlash ? 0 : this.bass;

    this.updateBeams(delta, elapsed, s, motion, pulse, cheering);
    this.updateLasers(elapsed, s, motion);
    this.updateFloor(elapsed, s);
    this.updateCrowd(delta, elapsed, s, motion, cheering);

    this.towerStrips.forEach((t, i) => {
      const k = s.noFlash ? 0.6 : 0.35 + 0.65 * Math.max(0, Math.sin(elapsed * 3 + i * 1.3)) * (s.playing ? 1 : 0.4) + pulse * 0.4;
      t.mat.color.copy(t.base).multiplyScalar(Math.min(1.4, k));
    });
    this.railMat.color.setHSL(0.74 + Math.sin(elapsed * 0.3) * 0.04, 1, 0.3 + this.hype * 0.25);

    if (!s.reducedMotion) {
      this.haze.forEach(h => {
        h.s.position.x += h.vx * delta;
        if (Math.abs(h.s.position.x) > 8) h.vx *= -1;
        h.mat.rotation += h.spin * delta;
      });
    }
  }

  updateBeams(delta, t, s, motion, pulse, cheering) {
    const speed = (s.playing ? 0.9 : 0.25) * motion * (cheering ? 2.2 : 1);
    this.beamClock = (this.beamClock || 0) + delta * speed;
    const bt = this.beamClock;
    const tgt = new THREE.Vector3();

    this.beams.forEach((b, i) => {
      const side = b.fixture.position.x < 0 ? -1 : 1;
      if (this.focus) {
        tgt.copy(this.focus.pos);
        tgt.x += Math.sin(t * 2 + i) * 0.15;
        tgt.y = b.kind === 'floor' ? 6 : 0;
      } else if (b.kind === 'front') {
        // Sweep across the stage and out over the pit
        tgt.set(Math.sin(bt * 1.3 + b.idx * 0.9) * 4.2, 0, 2 + Math.cos(bt * 0.9 + b.idx) * 4.5);
      } else if (b.kind === 'back') {
        // Back row tracks the contestants, drifting when idle
        const ch = s.chars[side < 0 ? 1 : 2];
        if (ch && !cheering) tgt.set(ch.x + Math.sin(bt * 2 + i) * 0.4, 0, ch.z + Math.cos(bt * 1.7 + i) * 0.4);
        else tgt.set(Math.sin(bt + b.idx * 1.6) * 3.5, 0, Math.cos(bt * 1.2 + b.idx) * 2.5);
      } else {
        // Floor uplights fan out and cross over the stage
        tgt.set(Math.sin(bt * 0.8 + b.idx * 1.4) * 6 - side * 1.5, 9, -1 + Math.cos(bt * 0.6 + b.idx) * 4);
      }
      this.aimBeam(b, tgt, this.focus ? 0.06 : 0.12);

      let color = b.base;
      if (this.focus) color = this.focus.color;
      else if (cheering && i % 2 === 0) color = new THREE.Color(AMBER);
      b.uniforms.uColor.value.lerp(color, 0.1);
      b.lensMat.color.copy(b.uniforms.uColor.value);

      // Active player's side burns brighter
      const active = side < 0 ? s.active1 : s.active2;
      let k = s.playing ? (active ? 0.55 : 0.28) : 0.22;
      if (this.focus) k = 0.75;
      if (cheering) k = 0.8;
      k += pulse * 0.45;
      if (b.kind === 'floor') k *= 0.8;
      b.uniforms.uIntensity.value += (k - b.uniforms.uIntensity.value) * 0.2;
    });
  }

  updateLasers(t, s, motion) {
    const on = (s.playing || this.cheerTimer > 0) && !s.noFlash && this.quality !== 'low';
    this.lasers.visible = on;
    if (!on) return;
    const n = this.laserBeams.length;
    const spread = 0.9 + Math.sin(t * 0.7 * motion) * 0.4;
    this.laserBeams.forEach(({ mesh, mat, i }) => {
      const f = (i / (n - 1)) - 0.5;
      mesh.rotation.y = f * spread * 2 + Math.sin(t * 1.1 * motion) * 0.3;
      mesh.rotation.x = -0.05 + Math.sin(t * 0.9 * motion + i * 0.4) * 0.12 - this.bass * 0.15;
      mat.opacity = 0.25 + this.highs * 0.6 + (this.cheerTimer > 0 ? 0.3 : 0);
    });
  }

  updateFloor(t, s) {
    const u = this.floorUniforms;
    u.uTime.value = s.reducedMotion ? 0 : t;
    u.uBass.value = s.noFlash ? 0.1 : this.bass;
    u.uLeft.value += ((s.active1 ? 1 : 0.25) - u.uLeft.value) * 0.05;
    u.uRight.value += ((s.active2 ? 1 : 0.25) - u.uRight.value) * 0.05;
    if (this.focus) u.uFocus.value.copy(this.focus.color);
    u.uFocusAmt.value += ((this.focus ? 0.8 : 0) - u.uFocusAmt.value) * 0.05;
  }

  updateCrowd(delta, t, s, motion, cheering) {
    const d = this._dummy;
    const beat = s.beat;
    const stride = this.crowdStride || 1;
    let p = 0;
    this.fans.forEach((f, i) => {
      const cz = this.clearZone;
      if (i % stride !== 0 || (cz && f.pit && (f.x - cz.x) ** 2 + (f.z - cz.z) ** 2 < 6.25)) {
        this.crowdBody.setMatrixAt(i, this._hidden);
        this.crowdArms.setMatrixAt(i, this._hidden);
        if (f.phone) this.phonePositions[p++ * 3 + 1] = -100;
        return;
      }
      let lift = 0;
      if (cheering) {
        lift = Math.abs(Math.sin(t * 7 + f.phase)) * 0.22 * f.energy;
      } else if (s.playing) {
        lift = Math.max(0, Math.sin(beat + f.phase * 0.3)) * 0.07 * f.energy * (0.6 + this.hype);
      } else {
        lift = (Math.sin(t * 0.9 + f.phase) * 0.5 + 0.5) * 0.012;
      }
      lift *= motion;
      const sway = Math.sin(t * 1.3 + f.phase) * 0.05 * motion * (s.playing ? 1 : 0.4);

      d.position.set(f.x, f.y + lift, f.z);
      d.rotation.set(0, f.face + sway * 0.6, sway * 0.4);
      d.scale.setScalar(f.scale);
      d.updateMatrix();
      this.crowdBody.setMatrixAt(i, d.matrix);

      if (this.hype > f.armsAt) {
        // Fist pumps on the beat
        d.position.y += Math.max(0, Math.sin(beat * (f.pit ? 1 : 0.5) + f.phase)) * 0.08 * motion;
        d.updateMatrix();
        this.crowdArms.setMatrixAt(i, d.matrix);
      } else {
        this.crowdArms.setMatrixAt(i, this._hidden);
      }

      if (f.phone) {
        const up = this.hype > f.armsAt ? 1.95 : 1.55;
        this.phonePositions[p * 3] = f.x + Math.sin(f.face) * 0.25 + Math.sin(t * 0.8 + f.phase) * 0.05 * motion;
        this.phonePositions[p * 3 + 1] = f.y + (up + lift) * f.scale;
        this.phonePositions[p * 3 + 2] = f.z + Math.cos(f.face) * 0.25;
        p++;
      }
    });
    this.crowdBody.instanceMatrix.needsUpdate = true;
    this.crowdArms.instanceMatrix.needsUpdate = true;
    this.phonePoints.geometry.attributes.position.needsUpdate = true;
  }
}

export { StageArena };
