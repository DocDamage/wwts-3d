/**
 * The winner reveal: dim the stage, face-off, spotlight, confetti, the brawl hand-off
 * and the scripted reveal camera.
 *
 * Mixed into DJControllerRenderer.prototype (see djController.js); `this` is the renderer.
 */
import * as THREE from 'three';
import { STATIONS } from './stageLayout.js';

const RevealMixin = {
  /* ============================================================
     WINNER REVEAL — dim, face-off, spotlight, confetti
     ============================================================ */
  startReveal() {
    if (this.revealActive) return;
    this.revealActive = true;
    this.preRevealLights = {
      ambient: this.ambientLight?.intensity,
      p1: this.stageLights.spotP1?.intensity,
      p2: this.stageLights.spotP2?.intensity,
      deck: this.stageLights.deckLight?.intensity
    };
    if (this.ambientLight) this.ambientLight.intensity = 0.35;
    if (this.stageLights.deckLight) this.stageLights.deckLight.intensity = 0.4;
    if (this.stageLights.spotP1) this.stageLights.spotP1.intensity = 2.0;
    if (this.stageLights.spotP2) this.stageLights.spotP2.intensity = 2.0;
    [1, 2].forEach(p => {
      this.stopMove(p);
      this.sendCharacterToCenter(p);
    });
    this.setCameraView('reveal');
    this.revealAt = null;
    this.startRevealCamera();
  },

  /**
   * Directed reveal camera: crane down over the crowd, a tense side-on two-shot
   * pushing in, then (on the result) a whip round to orbit the winner close up
   * before pulling back wide for the confetti. Draws cut between the two.
   */
  startRevealCamera() {
    const t0 = this.clock.elapsedTime;
    const V = THREE.Vector3;
    const still = () => this.reducedMotion;
    const cam = (camPos, target) => {
      const now = this.clock.elapsedTime;
      const t = now - t0;
      const A = this.characters[1]?.position || new V(-1, 0, 2);
      const B = this.characters[2]?.position || new V(1, 0, 2);
      const mid = A.clone().add(B).multiplyScalar(0.5);
      const ax = new V(B.x - A.x, 0, B.z - A.z).normalize();
      let perp = new V(-ax.z, 0, ax.x);
      if (perp.z < 0) perp.negate();
      if (this.revealAt !== null && this.revealAt !== undefined) {
        const tw = now - this.revealAt;
        const w = this.revealWinnerNum;
        if (w) {
          const P = this.characters[w].position;
          const f = this.characterStates[w].facing;
          // three-quarter view from the audience side, so the loser isn't in the way
          const face = new V(Math.sin(f), 0, Math.cos(f));
          const base = face.clone().multiplyScalar(0.5).addScaledVector(perp, 0.9).normalize();
          const orbit = still() ? 0 : Math.min(0.6, tw * 0.15) - 0.25;
          const dir = base.applyAxisAngle(new V(0, 1, 0), orbit);
          const pull = Math.max(0, Math.min(1, (tw - 4.2) / 2));
          const r = 2.2 + pull * 3.3;
          camPos.set(P.x + dir.x * r, 1.5 + pull * 1.1, P.z + dir.z * r);
          target.set(P.x, 1.3 - pull * 0.2, P.z);
        } else {
          // draw: cut between the two, then the pair
          const which = tw < 1.6 ? 1 : tw < 3.2 ? 2 : 0;
          if (which) {
            const P = this.characters[which].position;
            const f = this.characterStates[which].facing;
            const dir = new V(Math.sin(f), 0, Math.cos(f)).multiplyScalar(0.5).addScaledVector(perp, 0.9).normalize();
            camPos.set(P.x + dir.x * 2.2, 1.5, P.z + dir.z * 2.2);
            target.set(P.x, 1.3, P.z);
          } else {
            camPos.copy(mid).addScaledVector(perp, 5).setY(2.2);
            target.copy(mid).setY(1.1);
          }
        }
        return;
      }
      if (t < 2.4 && !still()) {
        const u = t / 2.4;
        const e = u * u * (3 - 2 * u);
        const ang = -0.6 + e * 0.45;
        const r = 10 - e * 3;
        camPos.set(mid.x + Math.sin(ang) * r, 6.5 - e * 3.6, mid.z + Math.cos(ang) * r);
        target.set(mid.x, 1.2, mid.z);
      } else {
        const u = still() ? 0 : Math.min(1, (t - 2.4) / 5);
        camPos.copy(mid).addScaledVector(perp, 3.8 - u * 1.2).setY(1.35);
        target.copy(mid).setY(1.25);
      }
    };
    this._revealCam = cam;
    this.cameraOverride = cam;
  },

  /** winnerNum: 1, 2 or null for a draw */
  revealWinner(winnerNum) {
    const win = winnerNum === 1 ? this.stageLights.spotP1 : winnerNum === 2 ? this.stageLights.spotP2 : null;
    const lose = winnerNum === 1 ? this.stageLights.spotP2 : winnerNum === 2 ? this.stageLights.spotP1 : null;
    if (win) win.intensity = 12;
    if (lose) lose.intensity = 0.6;
    if (!winnerNum) {
      if (this.stageLights.spotP1) this.stageLights.spotP1.intensity = 7;
      if (this.stageLights.spotP2) this.stageLights.spotP2.intensity = 7;
    }
    if (this.ambientLight) this.ambientLight.intensity = 0.8;
    this.revealWinnerNum = winnerNum || null;
    this.revealAt = this.clock.elapsedTime;
    this.arena?.cheer(winnerNum ? 6 : 3);
    const champ = winnerNum ? this.characters[winnerNum] : null;
    if (champ) this.arena?.focusOn(champ.position, winnerNum === 1 ? 0xff3b3b : 0x22e6ff);
    else this.arena?.focusOn(new THREE.Vector3(0, 0, STATIONS.faceoffZ), 0xffc23a);

    if (winnerNum) {
      this.playResultReaction(winnerNum);
      this.burstConfetti(winnerNum === 1 ? [0xff2d2d, 0xffd21a, 0xffffff] : [0x00e5ff, 0xffd21a, 0xffffff]);
      this.triggerSmokeBlast(3.2, 0xffaa00);
    } else {
      [1, 2].forEach(p => this.playMove(p, Math.random() < 0.5 ? 'smoke' : 'shake_no', { fromUser: false }));
      this.burstConfetti([0xffd21a, 0xffffff]);
      this.triggerSmokeBlast(2.4, 0xffffff);
    }
    if (!this.noFlash) this.triggerCameraFlashes(10);
    this.pulse();
  },

  /** Fighting-game brawl after the result: winner 1|2|null(draw) */
  startFight(winner, names = {}, seed) {
    return this.fight.start({ winner, names, seed: seed ?? Math.floor(Math.random() * 1e9) });
  },

  stopFight() {
    this.fight.stop(true);
  },

  isFighting() {
    return this.fight.active;
  },

  endReveal() {
    this.fight?.stop(true);
    if (!this.revealActive) return;
    this.revealActive = false;
    this.revealWinnerNum = null;
    this.arena?.clearFocus();
    const prev = this.preRevealLights || {};
    if (this.ambientLight && prev.ambient !== undefined) this.ambientLight.intensity = prev.ambient;
    if (this.stageLights.spotP1 && prev.p1 !== undefined) this.stageLights.spotP1.intensity = prev.p1;
    if (this.stageLights.spotP2 && prev.p2 !== undefined) this.stageLights.spotP2.intensity = prev.p2;
    if (this.stageLights.deckLight && prev.deck !== undefined) this.stageLights.deckLight.intensity = prev.deck;
    if (this.cameraOverride === this._revealCam) this.cameraOverride = null;
    this._revealCam = null;
    this.setCameraView('front');
  },

  /** Paper confetti raining over the face-off (one instanced mesh, no per-piece objects) */
  burstConfetti(colors = [0xffd21a, 0xffffff]) {
    const COUNT = this.qualityPreset === 'low' ? 160 : 420;
    if (!this.confetti) {
      const geo = new THREE.PlaneGeometry(0.045, 0.028);
      const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false });
      const mesh = new THREE.InstancedMesh(geo, mat, 420);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.confetti = { mesh, pieces: [], dummy: new THREE.Object3D() };
    }
    const c = this.confetti;
    c.pieces = [];
    const color = new THREE.Color();
    for (let i = 0; i < 420; i++) {
      const live = i < COUNT;
      c.pieces.push({
        live,
        pos: new THREE.Vector3((Math.random() - 0.5) * 4.2, 3.4 + Math.random() * 2.2, 1.4 + (Math.random() - 0.5) * 2.2),
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.6, -(0.5 + Math.random() * 0.7), (Math.random() - 0.5) * 0.6),
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        spin: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9),
        phase: Math.random() * 6
      });
      color.setHex(colors[i % colors.length]);
      c.mesh.setColorAt(i, color);
    }
    c.mesh.instanceColor.needsUpdate = true;
    c.mesh.visible = true;
    c.age = 0;
  },

  updateConfetti(delta) {
    const c = this.confetti;
    if (!c || !c.mesh.visible) return;
    c.age += delta;
    let alive = 0;
    c.pieces.forEach((p, i) => {
      if (p.live && p.pos.y > 0.01) {
        alive++;
        p.phase += delta * 3;
        p.pos.x += (p.vel.x + Math.sin(p.phase) * 0.35) * delta;
        p.pos.y += p.vel.y * delta;
        p.pos.z += (p.vel.z + Math.cos(p.phase * 0.8) * 0.25) * delta;
        p.rot.x += p.spin.x * delta;
        p.rot.y += p.spin.y * delta;
        p.rot.z += p.spin.z * delta;
        c.dummy.position.copy(p.pos);
        c.dummy.rotation.copy(p.rot);
        c.dummy.scale.setScalar(1);
      } else {
        // Landed pieces stay on the floor a while, unused ones are hidden
        c.dummy.position.copy(p.pos);
        c.dummy.position.y = p.live ? 0.012 : -10;
        c.dummy.rotation.set(-Math.PI / 2, 0, p.rot.z);
        c.dummy.scale.setScalar(p.live ? 1 : 0);
      }
      c.dummy.updateMatrix();
      c.mesh.setMatrixAt(i, c.dummy.matrix);
    });
    c.mesh.instanceMatrix.needsUpdate = true;
    if (!alive && c.age > 14) c.mesh.visible = false;
  },

  /** Which contestant (if any) a ray hits */
  pickCharacter(raycaster) {
    const targets = [1, 2].map(p => this.characters[p]).filter(Boolean);
    const hits = raycaster.intersectObjects(targets, true);
    if (!hits.length) return null;
    let node = hits[0].object;
    while (node) {
      if (node === this.characters[1]) return 1;
      if (node === this.characters[2]) return 2;
      node = node.parent;
    }
    return null;
  }
};

export { RevealMixin };
