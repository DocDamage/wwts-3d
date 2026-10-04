/**
 * Stage edges: the glowing boundary, walls that stop and splat, ring-outs.
 *
 * Mixed into FightGame.prototype (see fightGame.js); `this` is the game.
 */
import * as THREE from 'three';
import { ARENA } from './fightData.js';

const ArenaMixin = {
  /* ================= arena edges ================= */

  /** Glowing line where the stage ends (cyan walls / red ring-out) */
  buildArenaRing() {
    this.removeArenaRing();
    if (this.opts.arena === 'open') return;
    const ringout = this.opts.arena === 'ringout';
    const geo = new THREE.RingGeometry(0.985, 1.0, 96);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: ringout ? 0xff3b30 : 0x22e6ff, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false });
    const ring = new THREE.Mesh(geo, mat);
    ring.scale.set(ARENA.rx + 0.25, 1, ARENA.rz + 0.25);
    ring.position.set(ARENA.cx, 0.02, ARENA.cz);
    this.dj.scene.add(ring);
    this.arenaRing = ring;
    if (!ringout) {
      // a faint wall of light above the line
      const wallGeo = new THREE.CylinderGeometry(1, 1, 0.6, 96, 1, true);
      const wallMat = new THREE.MeshBasicMaterial({ color: 0x22e6ff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.scale.set(ARENA.rx + 0.25, 1, ARENA.rz + 0.25);
      wall.position.set(ARENA.cx, 0.3, ARENA.cz);
      this.dj.scene.add(wall);
      this.arenaWall = wall;
    }
  },

  removeArenaRing() {
    [this.arenaRing, this.arenaWall].forEach(m => { if (m) { this.dj.scene.remove(m); m.geometry.dispose(); m.material.dispose(); } });
    this.arenaRing = this.arenaWall = null;
  },

  /** Keep fighters on stage: walls stop (and splat) them, ring-out lets them fall */
  edgeCheck(f, o, P) {
    const dx = (P.x - ARENA.cx) / ARENA.rx;
    const dz = (P.z - ARENA.cz) / ARENA.rz;
    const r = Math.hypot(dx, dz);
    if (r <= 1) return;
    const knocked = ['hitstun', 'falling', 'air', 'stun', 'crumple', 'down'].includes(f.state);
    const outward = f.vel.x * dx + f.vel.y * dz;
    if (this.roundLive && knocked && this.opts.arena === 'ringout' && f.hp > 0) return this.ringOut(f, o);
    this.clampArena(P);
    if (this.roundLive && this.opts.arena === 'walls' && knocked && outward > 0.6 && !f.wallSplat && f.state !== 'down') this.wallSplat(f, o);
  },

  wallSplat(f, o) {
    f.wallSplat = true;
    f.vel.set(0, 0);
    f.air = null;
    this.dj.characterStates[f.p].fightLift = 0;
    const data = this.dj.mocap.get('mx_fhit_large_left');
    this.play(f, 'fhit_large_left', { from: data?.rm.onset || 0, rootMotion: false, fadeIn: 0.03, fadeOut: 0.3, timeScale: 0.9 });
    this.setState(f, 'stun', this.time + 0.85);
    f.mv = null;
    this.shake = 0.18;
    this.hitstopUntil = (this.realTime || 0) + 0.12;
    this.sound('thud', 1);
    this.spark(this.bonePos(f.p, 'Spine2'), 0x22e6ff, 1.4);
    this.popText(o.p, 'WALL SPLAT!', '#22e6ff', true);
    f.hp = Math.max(this.training ? 1 : 0, f.hp - 4);
    this.syncHp();
    if (f.hp <= 0) this.knockOut(f, o, { id: 'wall', power: 3 }, this.toOpp(o));
  },

  ringOut(f, o) {
    this.roundLive = false;
    f.state = 'ko';
    f.mv = null;
    const st = this.dj.characterStates[f.p];
    const dir = this.toOpp(o);
    this.play(f, 'fall_stumble_back', { from: this.dj.mocap.get('mx_fall_stumble_back')?.rm.onset || 0, rootMotion: false, hold: true, fadeIn: 0.05, timeScale: 1.1 });
    // tumble off the edge
    let t = 0;
    const fall = setInterval(() => {
      t += 0.03;
      const P = this.pos(f.p);
      P.x += dir.x * 0.05;
      P.z += dir.y * 0.05;
      st.fightLift = -Math.min(1.6, t * t * 4);
      if (t > 0.8) clearInterval(fall);
    }, 30);
    this.banner('RING OUT!', 2.2, 'ko');
    this.say('ko.wav', true);
    this.sound('thud', 1);
    this.dj.arena?.cheer(4);
    if (this.training) {
      setTimeout(() => { st.fightLift = 0; this.resetRound(); this.roundLive = true; this.setState(this.f[1], 'idle'); this.setState(this.f[2], 'idle'); }, 1600);
      return;
    }
    this.wins[o.p]++;
    this.updatePips();
    this._roundResolve?.('ringout');
  }
};

export { ArenaMixin };
