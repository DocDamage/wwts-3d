/**
 * Building the arena: lighting, stage and booth, speakers, LED jumbotron, smoke cannons,
 * moving heads and lasers, the crowd and flashbulbs, the camera director and the DJ deck.
 *
 * Mixed into DJControllerRenderer.prototype (see djController.js); `this` is the renderer.
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { loadModel } from './modelLoader.js';
import { StageArena } from './stageArena.js';
import { DECK_LEVEL_TILT } from './stageLayout.js';

const StageBuildMixin = {
  /* ============================================================
     LIGHTING
     ============================================================ */
  setupLighting() {
    // Atmospheric sky/ground fill (cool from above, warm bounce from the stage)
    const ambient = new THREE.HemisphereLight(0x8a93b8, 0x2a1c1c, 1.5);
    this.scene.add(ambient);
    this.ambientLight = ambient;

    // Front Stage Fill Light (illuminates faces, clothing, and speaker cones)
    const frontFill = new THREE.DirectionalLight(0xfff2e6, 1.6);
    frontFill.position.set(0, 4.5, 5.0);
    this.scene.add(frontFill);

    // Main central key spotlight on the DJ booth
    const deckSpot = new THREE.SpotLight(0xfffaed, 4.0);
    deckSpot.position.set(0, 6.0, 2.5);
    deckSpot.angle = Math.PI / 4.2;
    deckSpot.penumbra = 0.5;
    deckSpot.castShadow = true;
    deckSpot.shadow.mapSize.width = 1024;
    deckSpot.shadow.mapSize.height = 1024;
    this.scene.add(deckSpot);
    this.stageLights.deckLight = deckSpot;

    // Player colour spotlights (red stage-left, cyan stage-right) — they track their contestant
    const spotP1 = new THREE.SpotLight(0xff2222, 5.0, 18, Math.PI / 7, 0.5, 1.2);
    spotP1.position.set(-3.5, 5.0, 2.0);
    spotP1.target.position.set(-1.6, 0.8, 0);
    this.scene.add(spotP1);
    this.scene.add(spotP1.target);
    this.stageLights.spotP1 = spotP1;

    const spotP2 = new THREE.SpotLight(0x00e5ff, 5.0, 18, Math.PI / 7, 0.5, 1.2);
    spotP2.position.set(3.5, 5.0, 2.0);
    spotP2.target.position.set(1.6, 0.8, 0);
    this.scene.add(spotP2);
    this.scene.add(spotP2.target);
    this.stageLights.spotP2 = spotP2;

    // Per-contestant follow spot (warm white key from the front truss) and a
    // coloured back light behind each one, so even an all-black outfit reads
    this.followLights = {};
    [1, 2].forEach(p => {
      const color = p === 1 ? 0xff3344 : 0x00d4ff;
      const key = new THREE.SpotLight(0xfff1e0, 55, 20, 0.2, 0.65, 2);
      key.position.set(p === 1 ? -1.2 : 1.2, 5.2, 5.5);
      const back = new THREE.SpotLight(color, 40, 12, 0.35, 0.6, 2);
      back.position.set(p === 1 ? -2.2 : 2.2, 4.2, -2.6);
      [key, back].forEach(l => { this.scene.add(l); this.scene.add(l.target); });
      this.followLights[p] = { key, back, keyBase: 55, backBase: 40 };
    });
  },

  /** Follow spots and player spots track their contestant every frame */
  updateFollowLights() {
    [1, 2].forEach(p => {
      const char = this.characters[p];
      const f = this.followLights?.[p];
      if (!char || !f) return;
      const pos = char.position;
      const spot = p === 1 ? this.stageLights.spotP1 : this.stageLights.spotP2;
      f.key.target.position.lerp(new THREE.Vector3(pos.x, 1.0, pos.z), 0.15);
      f.back.target.position.lerp(new THREE.Vector3(pos.x, 1.1, pos.z), 0.15);
      f.back.position.x += ((pos.x * 1.2) - f.back.position.x) * 0.05;
      f.back.position.z += ((pos.z - 3.2) - f.back.position.z) * 0.05;
      f.key.position.x += ((pos.x * 0.8) - f.key.position.x) * 0.05;
      if (spot) spot.target.position.lerp(new THREE.Vector3(pos.x, 0.9, pos.z), 0.15);

      // During the reveal the loser's follow spot fades out
      const dim = this.revealActive && this.revealWinnerNum && this.revealWinnerNum !== p ? 0.15 : 1;
      f.key.intensity += (f.keyBase * dim - f.key.intensity) * 0.1;
      f.back.intensity += (f.backBase * (this.revealActive ? Math.max(dim, 0.6) * 1.5 : 1) - f.back.intensity) * 0.1;
    });
  },

  /* ============================================================
     STAGE PLATFORM & BOOTH
     ============================================================ */
  buildStagePlatform() {
    // Stage Floor (Circular reflective platform)
    const stageGeo = new THREE.CylinderGeometry(5.2, 5.4, 0.35, 48);
    const stageMat = new THREE.MeshStandardMaterial({
      color: 0x11131a,
      roughness: 0.3,
      metalness: 0.8
    });
    const stageMesh = new THREE.Mesh(stageGeo, stageMat);
    stageMesh.position.y = -0.175;
    stageMesh.receiveShadow = true;
    this.scene.add(stageMesh);

    // Outer stage neon rim
    const rimGeo = new THREE.TorusGeometry(5.22, 0.04, 16, 64);
    const rimMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    rimMesh.rotation.x = Math.PI / 2;
    rimMesh.position.y = 0.01;
    this.scene.add(rimMesh);

    // Ground plane beyond stage
    const floorGeo = new THREE.PlaneGeometry(35, 35);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x060709,
      roughness: 0.85,
      metalness: 0.2
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -0.36;
    floorMesh.receiveShadow = true;
    this.scene.add(floorMesh);

    // DJ Table / Stand
    const tableGroup = new THREE.Group();

    // Table Top
    const tableTopGeo = new THREE.BoxGeometry(3.6, 0.08, 1.4);
    const tableTopMat = new THREE.MeshStandardMaterial({
      color: 0x181a24,
      metalness: 0.7,
      roughness: 0.3
    });
    const tableTop = new THREE.Mesh(tableTopGeo, tableTopMat);
    tableTop.position.y = 0.84;
    tableTop.castShadow = true;
    tableTop.receiveShadow = true;
    tableGroup.add(tableTop);

    // Front DJ Booth Facade Panel
    const panelGeo = new THREE.BoxGeometry(3.5, 0.82, 0.06);
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x10121a,
      metalness: 0.6,
      roughness: 0.4
    });
    const panelMesh = new THREE.Mesh(panelGeo, panelMat);
    panelMesh.position.set(0, 0.41, 0.65);
    panelMesh.castShadow = true;
    tableGroup.add(panelMesh);

    // LED Neon Stripe across DJ Table
    const neonGeo = new THREE.BoxGeometry(3.52, 0.025, 0.02);
    const neonMat = new THREE.MeshBasicMaterial({ color: 0xff2d2d });
    const neonMesh = new THREE.Mesh(neonGeo, neonMat);
    neonMesh.position.set(0, 0.83, 0.68);
    tableGroup.add(neonMesh);
    this.tableNeon = neonMat;

    // Table Legs (Metallic Pillars)
    const legGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.84, 16);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x282c3c, metalness: 0.9, roughness: 0.2 });
    [-1.65, 1.65].forEach(x => {
      [-0.55, 0.55].forEach(z => {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(x, 0.42, z);
        leg.castShadow = true;
        tableGroup.add(leg);
      });
    });

    this.scene.add(tableGroup);

    // Center Stage Backdrop Arc
    const archGeo = new THREE.TorusGeometry(3.8, 0.06, 16, 48, Math.PI);
    const archMat = new THREE.MeshBasicMaterial({ color: 0x222736 });
    const arch = new THREE.Mesh(archGeo, archMat);
    arch.position.set(0, 0, -1.8);
    arch.rotation.z = Math.PI;
    this.scene.add(arch);
  },

  /* ============================================================
     AUDIO SPEAKER & SUBWOOFER SYSTEM
     Modeled after the Fab "Audio Speaker Subwoofer System" pack
     ============================================================ */
  buildSpeakerSubwooferSystem() {
    // 1. Heavy Front Subwoofers (Left = Red, Right = Cyan)
    const subLeft = this.createSubwooferCabinet({
      color: 0xcc1111, // Crimson Red Cone
      accentColor: 0xff2d2d,
      playerNum: 1
    });
    subLeft.position.set(-2.8, 0, 0.5);
    subLeft.rotation.y = 0.28;
    this.scene.add(subLeft);
    this.speakers[1].push(subLeft);

    const subRight = this.createSubwooferCabinet({
      color: 0x0099cc, // Electric Blue Cone
      accentColor: 0x00e5ff,
      playerNum: 2
    });
    subRight.position.set(2.8, 0, 0.5);
    subRight.rotation.y = -0.28;
    this.scene.add(subRight);
    this.speakers[2].push(subRight);

    // 2. High Stage Speaker Towers (Flanking rear stage)
    const towerLeft = this.createSpeakerTower({
      accentColor: 0xff2d2d,
      coneColor: 0xcc1111,
      playerNum: 1
    });
    towerLeft.position.set(-3.2, 0, -0.9);
    towerLeft.rotation.y = 0.35;
    this.scene.add(towerLeft);
    this.speakers[1].push(towerLeft);

    const towerRight = this.createSpeakerTower({
      accentColor: 0x00e5ff,
      coneColor: 0x0099cc,
      playerNum: 2
    });
    towerRight.position.set(3.2, 0, -0.9);
    towerRight.rotation.y = -0.35;
    this.scene.add(towerRight);
    this.speakers[2].push(towerRight);
  },

  /* ============================================================
     STAGE LED JUMBOTRON VIDEO SCREEN
     Dynamic curved screen with live battle status & EQ visualizer
     ============================================================ */
  buildStageJumbotron() {
    this.jumbotronCanvas = document.createElement('canvas');
    this.jumbotronCanvas.width = 1024;
    this.jumbotronCanvas.height = 512;
    this.jumbotronCtx = this.jumbotronCanvas.getContext('2d');

    this.jumbotronTexture = new THREE.CanvasTexture(this.jumbotronCanvas);
    this.jumbotronTexture.colorSpace = THREE.SRGBColorSpace;
    this.jumbotronTexture.repeat.set(-1, 1);
    this.jumbotronTexture.offset.set(1, 0);

    // Curved screen cylinder positioned behind the DJs (radius 4.4m, height 2.2m)
    const screenGeo = new THREE.CylinderGeometry(
      4.4, 4.4, 2.2, 48, 1, true,
      Math.PI - 0.72, 1.44
    );
    const screenMat = new THREE.MeshBasicMaterial({
      map: this.jumbotronTexture,
      side: THREE.BackSide
    });

    this.jumbotronMesh = new THREE.Mesh(screenGeo, screenMat);
    this.jumbotronMesh.position.set(0, 2.25, 0);
    this.scene.add(this.jumbotronMesh);

    // Sleek border arch
    const topArchGeo = new THREE.TorusGeometry(4.4, 0.035, 12, 36, 1.44);
    const archMat = new THREE.MeshBasicMaterial({ color: 0xff2d2d });
    const topArch = new THREE.Mesh(topArchGeo, archMat);
    topArch.rotation.x = Math.PI / 2;
    topArch.rotation.z = Math.PI / 2 - 0.72;
    topArch.position.set(0, 3.35, 0);
    this.scene.add(topArch);

    // Also attempt loading stage+led+screen.fbx if available in public
    try {
      loadModel('/models/stage/stage+led+screen.fbx', { classic: false }).then((fbx) => {
        fbx.scale.set(0.012, 0.012, 0.012);
        fbx.position.set(0, 0, -2.4);
        fbx.rotation.y = Math.PI;
        this.scene.add(fbx);
      }, () => {});
    } catch {}
  },

  updateJumbotron(elapsed) {
    if (!this.jumbotronCtx) return;
    const ctx = this.jumbotronCtx;
    const w = this.jumbotronCanvas.width;
    const h = this.jumbotronCanvas.height;

    // Cyber background
    ctx.fillStyle = '#06070c';
    ctx.fillRect(0, 0, w, h);

    // Subtle neon grid
    ctx.strokeStyle = 'rgba(255, 45, 45, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Top Header: WHO WANT THAT SMOKE
    ctx.save();
    ctx.font = 'bold 36px "Bebas Neue", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const glow = 0.5 + Math.sin(elapsed * 4) * 0.5;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ff2d2d';
    ctx.shadowBlur = 15 + glow * 15;
    ctx.fillText('WHO WANT THAT SMOKE', w / 2, 55);
    ctx.restore();

    // Contestant Data (the OBS popout feeds it in; the host page reads its own panels)
    const jd = this.jumbotronData || {};
    const c1Name = jd.c1Name || document.querySelector('#contestant-1-panel .contestant-name')?.textContent || 'CONTESTANT 1';
    const c2Name = jd.c2Name || document.querySelector('#contestant-2-panel .contestant-name')?.textContent || 'CONTESTANT 2';
    const c1Score = jd.score1 || document.getElementById('contestant-1-total')?.textContent || '0.00';
    const c2Score = jd.score2 || document.getElementById('contestant-2-total')?.textContent || '0.00';
    const timerDisplay = jd.timer || document.getElementById('timer-display')?.textContent || '00:00';

    // Left Box (Contestant 1 - Red)
    ctx.fillStyle = 'rgba(255, 45, 45, 0.15)';
    ctx.strokeStyle = '#ff2d2d';
    ctx.lineWidth = 3;
    ctx.strokeRect(60, 110, 260, 200);
    ctx.fillRect(60, 110, 260, 200);

    ctx.fillStyle = '#ff4d4d';
    ctx.font = 'bold 24px "Bebas Neue", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(c1Name.toUpperCase().slice(0, 16), 190, 150);

    ctx.font = 'bold 64px "Orbitron", monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(c1Score, 190, 240);

    // Right Box (Contestant 2 - Cyan)
    ctx.fillStyle = 'rgba(0, 229, 255, 0.15)';
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 3;
    ctx.strokeRect(w - 320, 110, 260, 200);
    ctx.fillRect(w - 320, 110, 260, 200);

    ctx.fillStyle = '#00e5ff';
    ctx.font = 'bold 24px "Bebas Neue", sans-serif';
    ctx.fillText(c2Name.toUpperCase().slice(0, 16), w - 190, 150);

    ctx.font = 'bold 64px "Orbitron", monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(c2Score, w - 190, 240);

    // Center Timer & VS
    ctx.fillStyle = '#ffaa00';
    ctx.font = 'bold 30px "Bebas Neue", sans-serif';
    ctx.fillText('VS', w / 2, 165);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 44px "Orbitron", monospace';
    ctx.fillText(timerDisplay, w / 2, 235);

    // Bottom: 36 Animated Audio Spectrum Bars
    const numBars = 36;
    const barWidth = 18;
    const startX = (w - (numBars * 24)) / 2;
    const analysis = this.audioPlayer?.getAudioAnalysis ? this.audioPlayer.getAudioAnalysis() : null;
    const isAudioPlaying = analysis ? analysis.isPlaying : (this.audioState[1] || this.audioState[2]);
    const realBins = analysis && analysis.isPlaying ? analysis.frequencyBins : null;

    for (let i = 0; i < numBars; i++) {
      let intensity = 0.08;
      if (realBins && realBins.length > i) {
        intensity = Math.max(0.08, realBins[i]);
      } else if (isAudioPlaying) {
        const freq = (i / numBars) * Math.PI * 4;
        const wave = Math.sin(freq + elapsed * 8) * Math.cos(i * 0.4 + elapsed * 5);
        intensity = Math.max(0.1, Math.abs(wave));
      }

      const barH = intensity * 135;

      const grad = ctx.createLinearGradient(0, h - 30 - barH, 0, h - 30);
      grad.addColorStop(0, i < numBars / 2 ? '#ff2d2d' : '#00e5ff');
      grad.addColorStop(1, '#ffaa00');

      ctx.fillStyle = grad;
      ctx.fillRect(startX + i * 24, h - 30 - barH, barWidth, barH);
    }

    this.jumbotronTexture.needsUpdate = true;
  },

  /* ============================================================
     CRYOGENIC SMOKE CANNONS ("Who Want That Smoke")
     Volumetric particle plumes with turbulence & spotlight illumination
     ============================================================ */
  buildSmokeCannons() {
    const cannonGeo = new THREE.CylinderGeometry(0.12, 0.16, 0.42, 16);
    const cannonMat = new THREE.MeshStandardMaterial({
      color: 0x161822,
      metalness: 0.9,
      roughness: 0.2
    });

    const nozzleRingGeo = new THREE.TorusGeometry(0.12, 0.02, 12, 24);
    const nozzleRingMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });

    this.cannons = [
      { x: -2.0, y: 0.12, z: 0.85, angleX: -0.22, angleZ: 0.18, colorHex: 0xff3333 },
      { x: 2.0, y: 0.12, z: 0.85, angleX: -0.22, angleZ: -0.18, colorHex: 0x00e5ff }
    ];

    this.cannons.forEach(c => {
      const group = new THREE.Group();
      group.position.set(c.x, c.y, c.z);
      group.rotation.x = c.angleX;
      group.rotation.z = c.angleZ;

      const barrel = new THREE.Mesh(cannonGeo, cannonMat);
      barrel.position.y = 0.21;
      barrel.castShadow = true;
      group.add(barrel);

      const nozzle = new THREE.Mesh(nozzleRingGeo, nozzleRingMat);
      nozzle.position.y = 0.42;
      nozzle.rotation.x = Math.PI / 2;
      group.add(nozzle);

      this.scene.add(group);
      c.group = group;
    });

    const loader = new THREE.TextureLoader();
    this.smokeTexture = loader.load('/textures/particles/PNG/White puff/whitePuff00.png');

    this.smokeParticles = [];
    this.smokeEmitterActive = false;
    this.smokeBlastTimer = 0;
  },

  triggerSmokeBlast(duration = 2.4, colorHex = null) {
    this.smokeEmitterActive = true;
    this.smokeBlastTimer = duration;
    this.smokeColorHex = colorHex;
  },

  updateSmoke(delta) {
    if (this.smokeEmitterActive) {
      this.smokeBlastTimer -= delta;
      if (this.smokeBlastTimer <= 0) {
        this.smokeEmitterActive = false;
      }

      const puffsPerCannon = 2;
      this.cannons.forEach(c => {
        for (let i = 0; i < puffsPerCannon; i++) {
          if (this.smokeParticles.length >= 80) break;

          const mat = new THREE.SpriteMaterial({
            map: this.smokeTexture,
            color: this.smokeColorHex || c.colorHex || 0xffffff,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
            blending: THREE.AdditiveBlending
          });
          const sprite = new THREE.Sprite(mat);

          const jitterX = (Math.random() - 0.5) * 0.12;
          const jitterZ = (Math.random() - 0.5) * 0.12;
          sprite.position.set(c.x + jitterX, c.y + 0.45, c.z + jitterZ);

          const s = 0.35 + Math.random() * 0.15;
          sprite.scale.set(s, s, 1);
          this.scene.add(sprite);

          const speed = 5.2 + Math.random() * 3.5;
          const spreadX = (c.x > 0 ? -1 : 1) * (0.25 + Math.random() * 0.45);
          const spreadZ = -0.3 - Math.random() * 0.5;

          this.smokeParticles.push({
            sprite,
            mat,
            vx: spreadX,
            vy: speed,
            vz: spreadZ,
            life: 0,
            maxLife: 1.3 + Math.random() * 0.5,
            scaleSpeed: 2.2 + Math.random() * 1.2,
            rotSpeed: (Math.random() - 0.5) * 2.5
          });
        }
      });
    }

    for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
      const p = this.smokeParticles[i];
      p.life += delta;
      const progress = p.life / p.maxLife;

      if (progress >= 1) {
        this.scene.remove(p.sprite);
        p.mat.dispose();
        this.smokeParticles.splice(i, 1);
        continue;
      }

      p.vy *= 0.94; // upward aerodynamic drag
      p.vx += (Math.random() - 0.5) * 0.15;
      p.sprite.position.x += p.vx * delta;
      p.sprite.position.y += Math.max(0.6, p.vy) * delta;
      p.sprite.position.z += p.vz * delta;

      const curScale = 0.35 + progress * p.scaleSpeed;
      p.sprite.scale.set(curScale, curScale, 1);
      p.mat.opacity = Math.max(0, 0.5 * (1 - Math.pow(progress, 1.4)));
      p.mat.rotation += p.rotSpeed * delta;
    }
  },

  /* ============================================================
     MOVING HEAD LASER & SPOTLIGHT SYSTEM
     ============================================================ */
  buildArenaLasers() {
    this.movingSpots = [];
    const colors = [0xff2d2d, 0x00e5ff];
    [-3.2, 3.2].forEach((x, idx) => {
      const spot = new THREE.SpotLight(colors[idx], 6.0, 15, Math.PI / 6, 0.5, 1.2);
      spot.position.set(x, 4.2, -1.8);
      spot.castShadow = true;
      const target = new THREE.Object3D();
      target.position.set(x * 0.2, 0.5, 0);
      this.scene.add(target);
      spot.target = target;
      this.scene.add(spot);
      this.movingSpots.push({ spot, target, baseX: x, colorIdx: idx });
    });
  },

  updateMovingLights(elapsed) {
    this.movingSpots.forEach((item, idx) => {
      const speed = 1.6;
      const sweep = Math.sin(elapsed * speed + idx * Math.PI) * 2.2;
      item.target.position.x = sweep;
      item.target.position.z = Math.cos(elapsed * speed * 0.5) * 1.5;
    });
  },

  /* ============================================================
     STADIUM CROWD ATMOSPHERE & CAMERA FLASHBULBS
     ============================================================ */
  buildArenaCrowd() {
    // The crowd itself lives in StageArena; this adds the camera flashbulbs in the pit
    this.crowdMembers = [];
    this.crowdFlashes = [];

    // 4 Camera Flashbulbs in the audience
    for (let f = 0; f < 4; f++) {
      const flash = new THREE.PointLight(0xffffff, 0, 7.0);
      const angle = -0.6 + (f / 3) * 1.2;
      flash.position.set(Math.sin(angle) * 6.6, 1.6, Math.cos(angle) * 6.6);
      this.scene.add(flash);
      this.crowdFlashes.push(flash);
    }
  },

  updateCrowd(delta, elapsed) {
    const isPlaying = this.audioState[1] || this.audioState[2];
    // Random occasional stadium camera flash during active music
    if (isPlaying && !this.noFlash) {
      this.flashTimer += delta;
      if (this.flashTimer > 1.8 + Math.random() * 2.5) {
        this.flashTimer = 0;
        this.triggerCameraFlashes(1);
      }
    }
  },

  triggerCameraFlashes(count = 6) {
    let triggered = 0;
    const interval = setInterval(() => {
      const pick = this.crowdFlashes[Math.floor(Math.random() * this.crowdFlashes.length)];
      if (pick) {
        pick.intensity = 18.0;
        setTimeout(() => { pick.intensity = 0; }, 55);
      }
      triggered++;
      if (triggered >= count) clearInterval(interval);
    }, 90);
  },

  /* ============================================================
     CINEMATIC CAMERA DIRECTOR
     ============================================================ */
  setCameraView(mode) {
    this.cameraMode = mode;
    this.isDragging = false;
    if (mode === 'front') {
      this.orbitAngles.theta = 0;
      this.orbitAngles.phi = 0.3;
      this.orbitAngles.radius = 7.4;
      this.cameraTarget.set(0, 1.25, 0);
    } else if (mode === 'dj_pov') {
      this.orbitAngles.theta = Math.PI;
      this.orbitAngles.phi = 0.38;
      this.orbitAngles.radius = 2.6;
      this.cameraTarget.set(0, 0.95, 0.4);
    } else if (mode === 'drone') {
      this.orbitAngles.theta = 0.3;
      this.orbitAngles.phi = 1.32;
      this.orbitAngles.radius = 5.2;
      this.cameraTarget.set(0, 0.6, 0);
    } else if (mode === 'decks') {
      // Over the DJs' shoulders, close on the controller for hands-on mixing
      this.orbitAngles.theta = Math.PI;
      this.orbitAngles.phi = 1.0;
      this.orbitAngles.radius = 3.1;
      this.cameraTarget.set(0, 1.05, 0);
    } else if (mode === 'reveal') {
      // Low, close and centred on the face-off spot for the winner announcement
      this.orbitAngles.theta = 0;
      this.orbitAngles.phi = 0.2;
      this.orbitAngles.radius = 5.4;
      this.cameraTarget.set(0, 1.15, 1.4);
    } else if (mode === 'staredown') {
      this.orbitAngles.theta = -0.65;
      this.orbitAngles.phi = 0.22;
      this.orbitAngles.radius = 3.2;
      this.cameraTarget.set(0, 0.85, -0.6);
    }
  },

  /**
   * Builds a massive 15-inch club subwoofer cabinet with beveled enclosure,
   * glossy metallic cone, rubber surround, and dual bass reflex ports
   */
  createSubwooferCabinet({ color, accentColor, playerNum }) {
    const group = new THREE.Group();

    // Heavy MDF Cabinet (Matte Charcoal with beveled aesthetic)
    const boxGeo = new THREE.BoxGeometry(1.15, 0.95, 0.9);
    const boxMat = new THREE.MeshStandardMaterial({
      color: 0x121318,
      roughness: 0.7,
      metalness: 0.25
    });
    const boxMesh = new THREE.Mesh(boxGeo, boxMat);
    boxMesh.position.y = 0.475;
    boxMesh.castShadow = true;
    boxMesh.receiveShadow = true;
    group.add(boxMesh);

    // Front Baffle Bevel Frame
    const frameGeo = new THREE.BoxGeometry(1.08, 0.88, 0.04);
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x181a20,
      roughness: 0.5,
      metalness: 0.3
    });
    const frameMesh = new THREE.Mesh(frameGeo, frameMat);
    frameMesh.position.set(0, 0.475, 0.45);
    group.add(frameMesh);

    // Outer Rubber Surround Ring (Torus)
    const surroundGeo = new THREE.TorusGeometry(0.35, 0.045, 16, 40);
    const surroundMat = new THREE.MeshStandardMaterial({
      color: 0x1a1c22,
      roughness: 0.5,
      metalness: 0.3
    });
    const surround = new THREE.Mesh(surroundGeo, surroundMat);
    surround.position.set(0, 0.53, 0.47);
    group.add(surround);

    // Subwoofer Vibrating Assembly (Cone + Dustcap)
    const coneAssembly = new THREE.Group();
    coneAssembly.position.set(0, 0.53, 0.45);

    // Deep Inverted Bass Cone (High Gloss Automotive Metallic Finish)
    const coneGeo = new THREE.ConeGeometry(0.35, 0.14, 36, 1, true);
    const coneMat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.15,
      metalness: 0.8,
      emissive: new THREE.Color(accentColor),
      emissiveIntensity: 0.45
    });
    const coneMesh = new THREE.Mesh(coneGeo, coneMat);
    coneMesh.rotation.x = -Math.PI / 2;
    coneAssembly.add(coneMesh);

    // Center Metallic Dust Cap
    const capGeo = new THREE.SphereGeometry(0.11, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const capMat = new THREE.MeshStandardMaterial({
      color: 0x22242e,
      roughness: 0.15,
      metalness: 0.95
    });
    const capMesh = new THREE.Mesh(capGeo, capMat);
    capMesh.rotation.x = Math.PI / 2;
    capMesh.position.z = 0.02;
    coneAssembly.add(capMesh);

    group.add(coneAssembly);

    // Dual Bottom Bass Reflex Ports
    const portGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.08, 20);
    const portMat = new THREE.MeshBasicMaterial({ color: 0x040406 });
    [-0.26, 0.26].forEach(px => {
      const port = new THREE.Mesh(portGeo, portMat);
      port.rotation.x = Math.PI / 2;
      port.position.set(px, 0.18, 0.46);
      group.add(port);
    });

    // Register cone for real-time excursion vibration
    this.cones.push({
      group: coneAssembly,
      initialZ: 0.45,
      playerNum,
      type: 'subwoofer',
      coneMat
    });

    return group;
  },

  /**
   * Builds a tall vertical loudspeaker tower with dual mid drivers & compression horn
   */
  createSpeakerTower({ accentColor, coneColor, playerNum }) {
    const group = new THREE.Group();

    // Tower Body
    const towerGeo = new THREE.BoxGeometry(0.65, 1.8, 0.55);
    const towerMat = new THREE.MeshStandardMaterial({
      color: 0x14161d,
      roughness: 0.6,
      metalness: 0.3
    });
    const towerMesh = new THREE.Mesh(towerGeo, towerMat);
    towerMesh.position.y = 0.9;
    towerMesh.castShadow = true;
    towerMesh.receiveShadow = true;
    group.add(towerMesh);

    // Dual 8-inch Mid Drivers
    [0.72, 1.25].forEach((my, idx) => {
      const midSurroundGeo = new THREE.TorusGeometry(0.18, 0.025, 16, 32);
      const midSurroundMat = new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.9 });
      const surround = new THREE.Mesh(midSurroundGeo, midSurroundMat);
      surround.position.set(0, my, 0.28);
      group.add(surround);

      const midConeGroup = new THREE.Group();
      midConeGroup.position.set(0, my, 0.27);

      const midConeGeo = new THREE.ConeGeometry(0.17, 0.08, 24, 1, true);
      const midConeMat = new THREE.MeshStandardMaterial({
        color: coneColor,
        roughness: 0.2,
        metalness: 0.8
      });
      const cone = new THREE.Mesh(midConeGeo, midConeMat);
      cone.rotation.x = Math.PI / 2;
      midConeGroup.add(cone);

      const capGeo = new THREE.SphereGeometry(0.06, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      const capMat = new THREE.MeshStandardMaterial({ color: 0x111, metalness: 0.9, roughness: 0.2 });
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.rotation.x = Math.PI / 2;
      cap.position.z = 0.015;
      midConeGroup.add(cap);

      group.add(midConeGroup);

      this.cones.push({
        group: midConeGroup,
        initialZ: 0.27,
        playerNum,
        type: 'mid',
        coneMat: midConeMat
      });
    });

    // Compression Horn Tweeter at the top
    const hornGeo = new THREE.BoxGeometry(0.38, 0.18, 0.06);
    const hornMat = new THREE.MeshStandardMaterial({ color: 0x1e2028, metalness: 0.8, roughness: 0.2 });
    const horn = new THREE.Mesh(hornGeo, hornMat);
    horn.position.set(0, 1.62, 0.28);
    group.add(horn);

    // Glowing Tweeter Phase Plug
    const plugGeo = new THREE.SphereGeometry(0.035, 16, 16);
    const plugMat = new THREE.MeshBasicMaterial({ color: accentColor });
    const plug = new THREE.Mesh(plugGeo, plugMat);
    plug.position.set(0, 1.62, 0.31);
    group.add(plug);

    // LED Accent Strip on Tower Side
    const ledGeo = new THREE.BoxGeometry(0.02, 1.76, 0.02);
    const ledMat = new THREE.MeshBasicMaterial({ color: accentColor });
    const led = new THREE.Mesh(ledGeo, ledMat);
    led.position.set(0.33, 0.9, 0.27);
    group.add(led);

    return group;
  },

  /* ============================================================
     DJ CONTROLLER FBX & INTERACTIVE TURNTABLES
     ============================================================ */
  loadDJDeck() {
    const loader = new FBXLoader();
    const textureLoader = new THREE.TextureLoader();
    const basePath = '/models/dj_controller/';

    const baseColor = textureLoader.load(basePath + 'T_DJ_Controller_BaseColor.webp');
    baseColor.colorSpace = THREE.SRGBColorSpace;
    const normalMap = textureLoader.load(basePath + 'T_DJ_Controller_Normal.webp');
    const ormMap = textureLoader.load(basePath + 'T_DJ_Controller_OcclusionRoughnessMetallic.webp');
    const emissiveMap = textureLoader.load(basePath + 'T_DJ_Controller_Emissive.webp');
    emissiveMap.colorSpace = THREE.SRGBColorSpace;

    loader.load(
      basePath + 'SM_DJ_Controller.fbx',
      (object) => {
        object.traverse((child) => {
          if (child.isMesh) {
            child.material = new THREE.MeshStandardMaterial({
              map: baseColor,
              normalMap: normalMap,
              aoMap: ormMap,
              roughnessMap: ormMap,
              metalnessMap: ormMap,
              emissiveMap: emissiveMap,
              emissive: new THREE.Color(0xffffff),
              emissiveIntensity: 1.6,
              roughness: 0.65,
              metalness: 0.6
            });
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        // Rotate flat so controls face up and horizontally stretch across the DJ table
        object.rotation.set(-Math.PI / 2, 0, Math.PI / 2);

        // Scale to fit on DJ stand table perfectly (3.1m wide across X)
        object.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const targetWidth = 3.1;
        object.scale.setScalar(targetWidth / Math.max(size.x, size.z));

        // Face the controls toward the DJs behind the table (play/cue nearest them)
        // and level the model's ~5.5° baked-in tilt
        const deckRoot = new THREE.Group();
        deckRoot.add(object);
        deckRoot.rotation.set(DECK_LEVEL_TILT, Math.PI, 0);
        deckRoot.updateMatrixWorld(true);

        // Center on top of table
        box.setFromObject(deckRoot);
        const center = box.getCenter(new THREE.Vector3());
        deckRoot.position.set(-center.x, 0.88 - box.min.y, -center.z);
        deckRoot.updateMatrixWorld(true);

        this.djDeck = deckRoot;
        this.scene.add(deckRoot);

        // Lay working controls (vinyl, pads, knobs, faders, buttons) over the model
        this.deckControls?.build(deckRoot);
        this.checkAllLoaded();
      },
      undefined,
      (err) => {
        console.warn('Fallback: DJ Controller model load note:', err);
        this.buildProceduralDJDeckFallback();
        this.checkAllLoaded();
      }
    );
  },

  buildProceduralDJDeckFallback() {
    const deckGroup = new THREE.Group();
    deckGroup.position.set(0, 0.88, 0);

    const bodyGeo = new THREE.BoxGeometry(3.2, 0.12, 1.3);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x181a22, metalness: 0.7, roughness: 0.3 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.castShadow = true;
    deckGroup.add(body);

    this.djDeck = deckGroup;
    this.scene.add(deckGroup);
    this.deckControls?.build(deckGroup);
  }
};

export { StageBuildMixin };
