/**
 * DJ Battle Stage Renderer — Three.js 3D Soundstage Arena
 * Features:
 * - Center DJ Controller (FBX + PBR textures) with interactive spinning turntables
 * - Audio Speaker & Subwoofer System (Left & Right front subwoofers + rear towers with real bass excursion)
 * - Contestant 3D Characters (Male & Female FBX models with real Breathing Idle animation)
 * - Dynamic DJ beat-dropping animation when music plays
 * - Live audio sync (turntables spin, subwoofers punch, characters vibe to the tempo)
 * - Interactive camera orbit with smooth focus transitions
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

class DJControllerRenderer {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.clock = new THREE.Clock();
    this.animFrameId = null;

    // Models & Components
    this.djDeck = null;
    this.turntables = { 1: null, 2: null };
    this.tonearms = { 1: null, 2: null };
    this.tonearmTargets = { 1: 0, 2: 0 };
    this.tonearmProgress = { 1: 0, 2: 0 };
    this.speakers = { 1: [], 2: [] }; // Subwoofers & towers with cones
    this.cones = []; // All vibrating cones { mesh, initialPos, playerNum, power }

    // Characters (4 Avatars: Black Male, Black Female, White Male, White Female)
    this.characters = { 1: null, 2: null };
    this.mixers = { 1: null, 2: null };
    this.characterBones = { 1: {}, 2: {} };
    this.characterRestBones = { 1: {}, 2: {} };
    this.currentAvatars = { 1: 'black_male', 2: 'black_female' };
    this.loadedFbxCache = {
      black_male: null,
      black_female: null,
      white_male: null,
      white_female: null
    };

    // Character Locomotion & DJ Console Interaction State Machine
    this.characterStates = {
      1: {
        state: 'IDLE_STATION', // 'WALKING', 'DJ_SCRATCHING', 'IDLE_STATION'
        targetPos: new THREE.Vector3(-1.7, 0, 0.2),
        currentStation: 'hype',
        walkPhase: 0,
        speed: 1.6,
        targetFacingAngle: 0.38,
        nextState: 'IDLE_STATION'
      },
      2: {
        state: 'IDLE_STATION',
        targetPos: new THREE.Vector3(1.7, 0, 0.2),
        currentStation: 'hype',
        walkPhase: 0,
        speed: 1.6,
        targetFacingAngle: -0.38,
        nextState: 'IDLE_STATION'
      }
    };
    this.clickRipples = [];

    // Audio Playback State
    this.audioState = { 1: false, 2: false };
    this.turntableSpeeds = { 1: 0, 2: 0 };
    this.bpm = 96; // Standard hip-hop beat battle BPM
    this.audioPlayer = null; // Real Web Audio Analyser source
    this.reducedMotion = false;
    this.noFlash = false;
    this.qualityPreset = 'high';

    // Camera Orbit & Controls
    this.cameraTarget = new THREE.Vector3(0, 0.9, 0);
    this.desiredCamPos = new THREE.Vector3(0, 2.8, 5.0);
    this.currentCamPos = new THREE.Vector3(0, 2.8, 5.0);
    this.isDragging = false;
    this.previousMousePosition = { x: 0, y: 0 };
    this.orbitAngles = { theta: 0, phi: 0.45, radius: 4.8 };
    this.cameraMode = 'front'; // 'front', 'dj_pov', 'drone', 'staredown', 'auto'
    this.autoCamTimer = 0;
    this.autoCamIndex = 0;

    // Stage Lights & Moving Lasers
    this.stageLights = { spotP1: null, spotP2: null, deckLight: null };
    this.movingSpots = [];

    // Cryogenic Smoke Cannons ("Who Want That Smoke")
    this.cannons = [];
    this.smokeParticles = [];
    this.smokeEmitterActive = false;
    this.smokeBlastTimer = 0;
    this.smokeColorHex = null;
    this.smokeTexture = null;

    // Curved LED Jumbotron Screen
    this.jumbotronCanvas = null;
    this.jumbotronCtx = null;
    this.jumbotronTexture = null;
    this.jumbotronMesh = null;

    // Stadium Crowd & Flashbulbs
    this.crowdMembers = [];
    this.crowdFlashes = [];
    this.flashTimer = 0;
  }

  init() {
    const canvas = document.getElementById('dj-canvas');
    const container = document.getElementById('dj-canvas-container');
    if (!canvas || !container) return;

    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0b10);
    this.scene.fog = new THREE.FogExp2(0x0a0b10, 0.045);

    // 2. Camera
    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(38, aspect, 0.1, 100);
    this.camera.position.copy(this.currentCamPos);
    this.camera.lookAt(this.cameraTarget);

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // 4. Lighting
    this.setupLighting();

    // 5. Stage Environment
    this.buildStagePlatform();

    // 6. Audio Speaker Subwoofer System
    this.buildSpeakerSubwooferSystem();

    // 7. Stage LED Jumbotron Video Screen
    this.buildStageJumbotron();

    // 8. Cryogenic Smoke Cannons
    this.buildSmokeCannons();

    // 9. Moving Head Lasers / Spotlights
    this.buildArenaLasers();

    // 10. Stadium Crowd Atmosphere & Camera Flashes
    this.buildArenaCrowd();

    // 11. DJ Deck Model
    this.loadDJDeck();

    // 11. Contestant Characters
    this.loadCharacters();

    // 12. Input & Resize Listeners
    this.setupInteractions(canvas, container);

    // 13. Animation Loop
    this.animate();
  }

  /* ============================================================
     LIGHTING
     ============================================================ */
  setupLighting() {
    // Soft atmospheric ambient
    const ambient = new THREE.AmbientLight(0x454b60, 1.4);
    this.scene.add(ambient);

    // Front Stage Fill Light (illuminates faces, clothing, and speaker cones)
    const frontFill = new THREE.DirectionalLight(0xfff2e6, 2.0);
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

    // Player 1 (Red / Left) Spotlight
    const spotP1 = new THREE.SpotLight(0xff2222, 5.0, 16, Math.PI / 4, 0.4);
    spotP1.position.set(-3.5, 4.5, 2.0);
    spotP1.target.position.set(-1.6, 0.8, 0);
    this.scene.add(spotP1);
    this.scene.add(spotP1.target);
    this.stageLights.spotP1 = spotP1;

    // Player 2 (Cyan / Right) Spotlight
    const spotP2 = new THREE.SpotLight(0x00e5ff, 5.0, 16, Math.PI / 4, 0.4);
    spotP2.position.set(3.5, 4.5, 2.0);
    spotP2.target.position.set(1.6, 0.8, 0);
    this.scene.add(spotP2);
    this.scene.add(spotP2.target);
    this.stageLights.spotP2 = spotP2;

    // Rim backlights for dramatic stage silhouette
    const rimP1 = new THREE.PointLight(0xff3344, 3.0, 10);
    rimP1.position.set(-2.5, 2.0, -2.5);
    this.scene.add(rimP1);

    const rimP2 = new THREE.PointLight(0x00d4ff, 3.0, 10);
    rimP2.position.set(2.5, 2.0, -2.5);
    this.scene.add(rimP2);
  }

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
  }

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
  }

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
      const fbxLoader = new FBXLoader();
      fbxLoader.load('/models/stage/stage+led+screen.fbx', (fbx) => {
        fbx.scale.set(0.012, 0.012, 0.012);
        fbx.position.set(0, 0, -2.4);
        fbx.rotation.y = Math.PI;
        this.scene.add(fbx);
      }, undefined, () => {});
    } catch {}
  }

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

    // Contestant Data
    const c1Name = document.querySelector('#contestant-1-panel .contestant-name')?.textContent || 'CONTESTANT 1';
    const c2Name = document.querySelector('#contestant-2-panel .contestant-name')?.textContent || 'CONTESTANT 2';
    const c1Score = document.getElementById('contestant-1-total')?.textContent || '0.0';
    const c2Score = document.getElementById('contestant-2-total')?.textContent || '0.0';
    const timerDisplay = document.getElementById('timer-display')?.textContent || '00:00';

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
  }

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
  }

  triggerSmokeBlast(duration = 2.4, colorHex = null) {
    this.smokeEmitterActive = true;
    this.smokeBlastTimer = duration;
    this.smokeColorHex = colorHex;
  }

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
            opacity: 0.85,
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
      p.mat.opacity = Math.max(0, 0.85 * (1 - Math.pow(progress, 1.4)));
      p.mat.rotation += p.rotSpeed * delta;
    }
  }

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
  }

  updateMovingLights(elapsed) {
    this.movingSpots.forEach((item, idx) => {
      const speed = 1.6;
      const sweep = Math.sin(elapsed * speed + idx * Math.PI) * 2.2;
      item.target.position.x = sweep;
      item.target.position.z = Math.cos(elapsed * speed * 0.5) * 1.5;
    });
  }

  /* ============================================================
     STADIUM CROWD ATMOSPHERE & CAMERA FLASHBULBS
     ============================================================ */
  buildArenaCrowd() {
    this.crowdMembers = [];
    this.crowdFlashes = [];

    const crowdMat = new THREE.MeshBasicMaterial({ color: 0x07080f });
    const headGeo = new THREE.SphereGeometry(0.14, 8, 8);
    const bodyGeo = new THREE.CylinderGeometry(0.16, 0.22, 0.65, 8);
    const armGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.45, 6);

    const numSpectators = 18;
    for (let i = 0; i < numSpectators; i++) {
      const group = new THREE.Group();
      const angle = -0.72 + (i / (numSpectators - 1)) * 1.44; // Fan arc across front stage
      const radius = 3.9 + (i % 2) * 0.4;

      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      group.position.set(x, -0.3, z);
      group.rotation.y = angle + Math.PI; // Face towards the center DJ stage

      const body = new THREE.Mesh(bodyGeo, crowdMat);
      body.position.y = 0.32;
      group.add(body);

      const head = new THREE.Mesh(headGeo, crowdMat);
      head.position.y = 0.72;
      group.add(head);

      // Some spectators wave their arms in the air
      if (i % 3 === 0) {
        const armLeft = new THREE.Mesh(armGeo, crowdMat);
        armLeft.position.set(-0.2, 0.65, 0.05);
        armLeft.rotation.z = 0.8;
        group.add(armLeft);

        const armRight = new THREE.Mesh(armGeo, crowdMat);
        armRight.position.set(0.2, 0.65, 0.05);
        armRight.rotation.z = -0.8;
        group.add(armRight);
      }

      this.scene.add(group);
      this.crowdMembers.push({
        group,
        baseY: -0.3,
        phaseOffset: i * 0.45,
        bouncePower: 0.02 + (i % 3) * 0.015
      });
    }

    // 4 Camera Flashbulbs in the audience
    for (let f = 0; f < 4; f++) {
      const flash = new THREE.PointLight(0xffffff, 0, 7.0);
      const angle = -0.6 + (f / 3) * 1.2;
      flash.position.set(Math.sin(angle) * 4.1, 0.5, Math.cos(angle) * 4.1);
      this.scene.add(flash);
      this.crowdFlashes.push(flash);
    }
  }

  updateCrowd(delta, elapsed) {
    const isPlaying = this.audioState[1] || this.audioState[2];
    const tempo = this.bpm / 60;
    const beatTime = elapsed * tempo * Math.PI * 2;

    this.crowdMembers.forEach(m => {
      const bob = Math.sin(beatTime + m.phaseOffset) * (isPlaying ? m.bouncePower : 0.008);
      m.group.position.y = m.baseY + Math.max(0, bob);
    });

    // Random occasional stadium camera flash during active music
    if (isPlaying) {
      this.flashTimer += delta;
      if (this.flashTimer > 1.8 + Math.random() * 2.5) {
        this.flashTimer = 0;
        this.triggerCameraFlashes(1);
      }
    }
  }

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
  }

  /* ============================================================
     CINEMATIC CAMERA DIRECTOR
     ============================================================ */
  setCameraView(mode) {
    this.cameraMode = mode;
    this.isDragging = false;
    if (mode === 'front') {
      this.orbitAngles.theta = 0;
      this.orbitAngles.phi = 0.45;
      this.orbitAngles.radius = 4.8;
      this.cameraTarget.set(0, 0.9, 0);
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
    } else if (mode === 'staredown') {
      this.orbitAngles.theta = -0.65;
      this.orbitAngles.phi = 0.22;
      this.orbitAngles.radius = 3.2;
      this.cameraTarget.set(0, 0.85, -0.6);
    }
  }

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
  }

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
  }

  /* ============================================================
     DJ CONTROLLER FBX & INTERACTIVE TURNTABLES
     ============================================================ */
  loadDJDeck() {
    const loader = new FBXLoader();
    const textureLoader = new THREE.TextureLoader();
    const basePath = '/models/dj_controller/';

    const baseColor = textureLoader.load(basePath + 'T_DJ_Controller_BaseColor.png');
    baseColor.colorSpace = THREE.SRGBColorSpace;
    const normalMap = textureLoader.load(basePath + 'T_DJ_Controller_Normal.png');
    const ormMap = textureLoader.load(basePath + 'T_DJ_Controller_OcclusionRoughnessMetallic.png');
    const emissiveMap = textureLoader.load(basePath + 'T_DJ_Controller_Emissive.png');
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
        object.updateMatrixWorld(true);

        // Scale to fit on DJ stand table perfectly (3.1m wide across X)
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const targetWidth = 3.1;
        const scale = targetWidth / Math.max(size.x, size.z);
        object.scale.setScalar(scale);

        // Center on top of table
        box.setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        object.position.x = -center.x;
        object.position.y = 0.88 - box.min.y;
        object.position.z = -center.z;

        this.djDeck = object;
        this.scene.add(object);

        // Build interactive spinning turntables on top of jog wheels
        this.buildInteractiveTurntables();
        this.checkAllLoaded();
      },
      undefined,
      (err) => {
        console.warn('Fallback: DJ Controller model load note:', err);
        this.buildProceduralDJDeckFallback();
        this.checkAllLoaded();
      }
    );
  }

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
    this.buildInteractiveTurntables();
  }

  /**
   * Creates spinning vinyl disc slipmats over Player 1 (Left) and Player 2 (Right) jog wheels
   */
  buildInteractiveTurntables() {
    // Platter Disc Geometry
    const discGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.02, 36);

    // Left Platter (Player 1 - Red vinyl accents)
    const matP1 = new THREE.MeshStandardMaterial({
      color: 0x0f1015,
      metalness: 0.85,
      roughness: 0.25
    });
    const platter1 = new THREE.Mesh(discGeo, matP1);
    platter1.position.set(-0.88, 0.94, -0.05);

    // Platter center label (Red slipmat)
    const labelGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.025, 24);
    const labelMat1 = new THREE.MeshStandardMaterial({ color: 0xdd2222, roughness: 0.4 });
    const label1 = new THREE.Mesh(labelGeo, labelMat1);
    platter1.add(label1);

    // Spindle
    const spindleGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.06, 12);
    const spindleMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9 });
    const spindle1 = new THREE.Mesh(spindleGeo, spindleMat);
    platter1.add(spindle1);

    // Strobe Marker on platter rim (so rotation is clearly visible)
    const strobeGeo = new THREE.BoxGeometry(0.04, 0.03, 0.1);
    const strobeMat1 = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
    const strobe1 = new THREE.Mesh(strobeGeo, strobeMat1);
    strobe1.position.set(0.38, 0.01, 0);
    platter1.add(strobe1);

    this.scene.add(platter1);
    this.turntables[1] = platter1;

    // Right Platter (Player 2 - Cyan vinyl accents)
    const matP2 = new THREE.MeshStandardMaterial({
      color: 0x0f1015,
      metalness: 0.85,
      roughness: 0.25
    });
    const platter2 = new THREE.Mesh(discGeo, matP2);
    platter2.position.set(0.88, 0.94, -0.05);

    const labelMat2 = new THREE.MeshStandardMaterial({ color: 0x00a8cc, roughness: 0.4 });
    const label2 = new THREE.Mesh(labelGeo, labelMat2);
    platter2.add(label2);

    const spindle2 = new THREE.Mesh(spindleGeo, spindleMat);
    platter2.add(spindle2);

    const strobeMat2 = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    const strobe2 = new THREE.Mesh(strobeGeo, strobeMat2);
    strobe2.position.set(0.38, 0.01, 0);
    platter2.add(strobe2);

    this.scene.add(platter2);
    this.turntables[2] = platter2;

    // Build DJ Tonearms with needles that pivot onto vinyl when playing
    this.buildTonearm(1);
    this.buildTonearm(2);
  }

  /**
   * Builds realistic club DJ tonearms with gimbal pivot, counterweight,
   * S-rod chrome arm, headshell, and stylus needle
   */
  buildTonearm(playerNum) {
    const isP1 = playerNum === 1;
    // Position tonearm base at rear corner of player platter
    const baseX = isP1 ? -1.36 : 1.36;
    const baseZ = -0.34;
    const baseY = 0.94;

    const baseGroup = new THREE.Group();
    baseGroup.position.set(baseX, baseY, baseZ);

    // Gimbal Base / Anti-skate cylinder
    const baseGeo = new THREE.CylinderGeometry(0.055, 0.06, 0.035, 20);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x20222a, metalness: 0.85, roughness: 0.25 });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseGroup.add(baseMesh);

    // Tonearm Rest Cradle Post
    const cradleGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.05, 10);
    const cradle = new THREE.Mesh(cradleGeo, baseMat);
    cradle.position.set(isP1 ? 0.04 : -0.04, 0.025, 0.24);
    baseGroup.add(cradle);

    // Pivot Assembly (Rotates horizontally onto the record)
    const pivotGroup = new THREE.Group();
    pivotGroup.position.set(0, 0.035, 0);

    // Chrome Gimbal Ring
    const gimbalGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.035, 16);
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f5, metalness: 0.95, roughness: 0.1 });
    const gimbal = new THREE.Mesh(gimbalGeo, chromeMat);
    pivotGroup.add(gimbal);

    // Counterweight
    const weightGeo = new THREE.CylinderGeometry(0.036, 0.036, 0.055, 18);
    const weightMat = new THREE.MeshStandardMaterial({ color: 0x111216, metalness: 0.6, roughness: 0.35 });
    const weight = new THREE.Mesh(weightGeo, weightMat);
    weight.rotation.x = Math.PI / 2;
    weight.position.set(0, 0.015, -0.055);
    pivotGroup.add(weight);

    // Chrome Tonearm Tube
    const armGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.44, 12);
    const arm = new THREE.Mesh(armGeo, chromeMat);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(isP1 ? 0.04 : -0.04, 0.015, 0.21);
    pivotGroup.add(arm);

    // Headshell Cartridge
    const headshellGeo = new THREE.BoxGeometry(0.028, 0.018, 0.06);
    const headshellMat = new THREE.MeshStandardMaterial({
      color: isP1 ? 0xff2d2d : 0x00e5ff,
      metalness: 0.7,
      roughness: 0.3
    });
    const headshell = new THREE.Mesh(headshellGeo, headshellMat);
    headshell.position.set(isP1 ? 0.04 : -0.04, 0.008, 0.44);
    headshell.rotation.y = isP1 ? 0.25 : -0.25;
    pivotGroup.add(headshell);

    // Stylus Needle
    const stylusGeo = new THREE.ConeGeometry(0.005, 0.016, 8);
    const stylusMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const stylus = new THREE.Mesh(stylusGeo, stylusMat);
    stylus.rotation.x = Math.PI;
    stylus.position.set(isP1 ? 0.04 : -0.04, -0.008, 0.46);
    pivotGroup.add(stylus);

    baseGroup.add(pivotGroup);
    this.scene.add(baseGroup);

    this.tonearms[playerNum] = pivotGroup;
    this.tonearmTargets[playerNum] = 0;
    this.tonearmProgress[playerNum] = 0;
  }

  /* ============================================================
     CONTESTANT 3D CHARACTERS (4 FBX MODELS WITH SKELETAL IDLE)
     ============================================================ */
  loadCharacters() {
    const loader = new FBXLoader();
    const basePath = '/models/characters/';
    const characterList = [
      { key: 'black_male', file: 'black_male.fbx' },
      { key: 'black_female', file: 'black_female.fbx' },
      { key: 'white_male', file: 'white_male.fbx' },
      { key: 'white_female', file: 'white_female.fbx' }
    ];

    let loadedCount = 0;
    characterList.forEach(({ key, file }) => {
      loader.load(
        basePath + file,
        (object) => {
          this.setupCharacterMaterials(object);
          this.loadedFbxCache[key] = object;
          loadedCount++;

          // If current selection matches this avatar, spawn immediately
          if (this.currentAvatars[1] === key) this.spawnContestant(1, key);
          if (this.currentAvatars[2] === key) this.spawnContestant(2, key);

          if (loadedCount === characterList.length) {
            this.checkAllLoaded();
          }
        },
        undefined,
        (err) => {
          console.warn(`Note on loading character ${key}:`, err);
          loadedCount++;
          if (loadedCount === characterList.length) {
            this.checkAllLoaded();
          }
        }
      );
    });
  }

  setupCharacterMaterials(object) {
    object.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          child.material.side = THREE.DoubleSide;
          if (child.material.map) {
            child.material.map.colorSpace = THREE.SRGBColorSpace;
          }
        }
      }
    });
  }

  /**
   * Spawns or swaps character for Player 1 or Player 2
   */
  spawnContestant(playerNum, gender) {
    const template = this.loadedFbxCache[gender];
    if (!template) return;

    // Remove existing character if any
    if (this.characters[playerNum]) {
      this.scene.remove(this.characters[playerNum]);
      if (this.mixers[playerNum]) {
        this.mixers[playerNum].stopAllAction();
      }
    }

    // Clone the FBX object with bones and skeleton intact
    const char = SkeletonUtils.clone(template);

    // Standardize character height to ~1.75 world units
    const box = new THREE.Box3().setFromObject(char);
    const size = box.getSize(new THREE.Vector3());
    let scaleFactor = 0.01;
    if (size.y > 10) {
      scaleFactor = 1.75 / size.y;
    } else if (size.y > 0.1) {
      scaleFactor = 1.75 / size.y;
    }
    char.scale.setScalar(scaleFactor);

    // Find bones for locomotion, walking, and DJ console scratching/mixing
    const bones = {};
    char.traverse((child) => {
      if (child.isBone) {
        const name = child.name.toLowerCase();
        if (name.includes('hips')) bones.hips = child;
        if (name.includes('spine2') || name.includes('spine1') || (name.includes('spine') && !bones.spine)) bones.spine = child;
        if (name.includes('neck')) bones.neck = child;
        if (name.includes('head')) bones.head = child;

        // Arms & Hands
        if (name.includes('leftshoulder')) bones.lShoulder = child;
        if (name.includes('leftarm') && !name.includes('fore')) bones.lArm = child;
        if (name.includes('leftforearm')) bones.lForeArm = child;
        if (name.includes('lefthand')) bones.lHand = child;

        if (name.includes('rightshoulder')) bones.rShoulder = child;
        if (name.includes('rightarm') && !name.includes('fore')) bones.rArm = child;
        if (name.includes('rightforearm')) bones.rForeArm = child;
        if (name.includes('righthand')) bones.rHand = child;

        // Legs & Feet
        if (name.includes('leftupleg')) bones.lUpLeg = child;
        if (name.includes('leftleg') && !name.includes('up')) bones.lLeg = child;
        if (name.includes('leftfoot')) bones.lFoot = child;

        if (name.includes('rightupleg')) bones.rUpLeg = child;
        if (name.includes('rightleg') && !name.includes('up')) bones.rLeg = child;
        if (name.includes('rightfoot')) bones.rFoot = child;
      }
    });
    this.characterBones[playerNum] = bones;

    // Store rest rotations for procedural animation blending
    const rest = {};
    Object.entries(bones).forEach(([k, b]) => {
      rest[k] = { x: b.rotation.x, y: b.rotation.y, z: b.rotation.z };
    });
    this.characterRestBones[playerNum] = rest;

    // Positioning & Grounding feet on stage floor (y = 0)
    box.setFromObject(char);
    const footOffset = box.min.y;
    const baseY = footOffset < 0 ? -footOffset : 0;
    char.userData.baseY = baseY;

    // Flank the DJ booth on left and right initially
    if (playerNum === 1) {
      char.position.set(-1.7, baseY, 0.2);
      char.rotation.y = 0.38;
      this.characterStates[1].targetPos.set(-1.7, baseY, 0.2);
      this.characterStates[1].currentStation = 'hype';
      this.characterStates[1].state = 'IDLE_STATION';
    } else {
      char.position.set(1.7, baseY, 0.2);
      char.rotation.y = -0.38;
      this.characterStates[2].targetPos.set(1.7, baseY, 0.2);
      this.characterStates[2].currentStation = 'hype';
      this.characterStates[2].state = 'IDLE_STATION';
    }

    this.scene.add(char);
    this.characters[playerNum] = char;

    // Setup Animation Mixer with the embedded Breathing Idle clip
    if (template.animations && template.animations.length > 0) {
      const mixer = new THREE.AnimationMixer(char);
      const clip = template.animations[0];
      const action = mixer.clipAction(clip);
      action.setEffectiveTimeScale(1.0);
      action.play();
      this.mixers[playerNum] = mixer;
    }
  }

  /**
   * Called by UI to switch avatar between the 4 available models
   */
  setPlayerAvatar(playerNum, key) {
    if (key === 'male') key = 'white_male';
    if (key === 'female') key = 'black_female';
    const valid = ['black_male', 'black_female', 'white_male', 'white_female'];
    if (!valid.includes(key)) return;

    this.currentAvatars[playerNum] = key;
    this.spawnContestant(playerNum, key);
  }

  checkAllLoaded() {
    const loadingOverlay = document.getElementById('dj-loading');
    if (loadingOverlay && !loadingOverlay.classList.contains('hidden')) {
      loadingOverlay.classList.add('hidden');
      setTimeout(() => { loadingOverlay.style.display = 'none'; }, 400);
    }
  }

  /* ============================================================
     CHARACTER NAVIGATION & DJ CONSOLE INTERACTION
     ============================================================ */
  walkCharacterTo(playerNum, targetX, targetZ, nextState = 'IDLE_STATION', targetFacing = null) {
    const cState = this.characterStates[playerNum];
    if (!cState) return;

    // Constrain destination coordinates to stage platform (radius 3.6m)
    const distFromOrigin = Math.hypot(targetX, targetZ);
    if (distFromOrigin > 3.6) {
      const angle = Math.atan2(targetZ, targetX);
      targetX = Math.cos(angle) * 3.5;
      targetZ = Math.sin(angle) * 3.5;
    }

    cState.targetPos.set(targetX, 0, targetZ);
    cState.nextState = nextState;
    cState.targetFacingAngle = targetFacing;
    cState.state = 'WALKING';
  }

  sendCharacterToDeck(playerNum) {
    const isP1 = playerNum === 1;
    // Step directly behind their turntable deck on the table
    const deckX = isP1 ? -0.88 : 0.88;
    const deckZ = -0.92;
    this.characterStates[playerNum].currentStation = 'deck';
    this.walkCharacterTo(playerNum, deckX, deckZ, 'DJ_SCRATCHING', 0.0);
    this.updateStageActionButtons(playerNum, 'deck');
  }

  sendCharacterToHype(playerNum) {
    const isP1 = playerNum === 1;
    const hypeX = isP1 ? -1.7 : 1.7;
    const hypeZ = 0.2;
    const facing = isP1 ? 0.38 : -0.38;
    this.characterStates[playerNum].currentStation = 'hype';
    this.walkCharacterTo(playerNum, hypeX, hypeZ, 'IDLE_STATION', facing);
    this.updateStageActionButtons(playerNum, 'hype');
  }

  sendCharacterToCenter(playerNum) {
    const isP1 = playerNum === 1;
    const faceX = isP1 ? -0.4 : 0.4;
    const faceZ = -1.35;
    const facing = isP1 ? Math.PI / 2 : -Math.PI / 2; // Stare down opponent
    this.characterStates[playerNum].currentStation = 'center';
    this.walkCharacterTo(playerNum, faceX, faceZ, 'IDLE_STATION', facing);
    this.updateStageActionButtons(playerNum, 'center');
  }

  updateStageActionButtons(playerNum, activeAction) {
    const container = document.getElementById(`controls-p${playerNum}`);
    if (!container) return;
    container.querySelectorAll('.stage-action-btn').forEach(btn => {
      if (btn.dataset.action === activeAction) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  showClickRipple(x, z, playerNum) {
    const ringGeo = new THREE.RingGeometry(0.08, 0.2, 24);
    const color = playerNum === 1 ? 0xff2d2d : 0x00e5ff;
    const ringMat = new THREE.MeshBasicMaterial({
      color: color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.015, z);
    this.scene.add(ring);
    this.clickRipples.push({ mesh: ring, progress: 0, mat: ringMat });
  }

  /**
   * Gamepad Camera Orbit Control (Right Analog Stick)
   */
  orbitCameraDelta(deltaTheta, deltaPhi) {
    this.orbitAngles.theta += deltaTheta;
    this.orbitAngles.phi = Math.max(0.12, Math.min(1.42, this.orbitAngles.phi + deltaPhi));
    this.isDragging = true;
    clearTimeout(this._orbitTimer);
    this._orbitTimer = setTimeout(() => {
      this.isDragging = false;
    }, 1200);
  }

  /**
   * Gamepad Direct Character Locomotion (Left Analog Stick)
   */
  moveCharacterDirect(playerNum, moveX, moveZ, delta) {
    const char = this.characters[playerNum];
    const cState = this.characterStates[playerNum];
    const bones = this.characterBones[playerNum];
    if (!char || !cState) return;

    const moveMag = Math.hypot(moveX, moveZ);
    if (moveMag > 0.08) {
      cState.state = 'WALKING';
      cState.nextState = 'IDLE_STATION';
      const speed = 2.4;
      let newX = char.position.x + moveX * speed * delta;
      let newZ = char.position.z + moveZ * speed * delta;

      // Constrain to stage perimeter (radius 3.5m)
      const dist = Math.hypot(newX, newZ);
      if (dist > 3.5) {
        const ang = Math.atan2(newZ, newX);
        newX = Math.cos(ang) * 3.5;
        newZ = Math.sin(ang) * 3.5;
      }

      char.position.x = newX;
      char.position.z = newZ;
      cState.targetPos.set(newX, 0, newZ);

      // Smoothly turn character towards walking heading
      const moveAngle = Math.atan2(moveX, moveZ);
      let angleDiff = (moveAngle - char.rotation.y) % (Math.PI * 2);
      if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      char.rotation.y += angleDiff * 0.22;
      cState.targetFacingAngle = moveAngle;

      // Stride animation
      cState.walkPhase += delta * 9.0;
      const wp = cState.walkPhase;
      const baseY = char.userData.baseY || 0;

      if (bones) {
        if (bones.lUpLeg) bones.lUpLeg.rotation.x = Math.sin(wp) * 0.55;
        if (bones.rUpLeg) bones.rUpLeg.rotation.x = -Math.sin(wp) * 0.55;
        if (bones.lLeg) bones.lLeg.rotation.x = Math.max(0, -Math.sin(wp)) * 0.65;
        if (bones.rLeg) bones.rLeg.rotation.x = Math.max(0, Math.sin(wp)) * 0.65;
        if (bones.lArm) bones.lArm.rotation.x = -Math.sin(wp) * 0.45;
        if (bones.rArm) bones.rArm.rotation.x = Math.sin(wp) * 0.45;
        if (bones.spine) bones.spine.rotation.x = 0.08;
      }
      char.position.y = baseY + Math.abs(Math.sin(wp * 2)) * 0.035;
    } else {
      // Stopped moving: check proximity to DJ deck
      const isP1 = playerNum === 1;
      const deckX = isP1 ? -0.88 : 0.88;
      const deckZ = -0.92;
      const distToDeck = Math.hypot(char.position.x - deckX, char.position.z - deckZ);

      if (distToDeck < 0.48 && cState.state === 'WALKING') {
        cState.state = 'DJ_SCRATCHING';
        cState.targetFacingAngle = 0.0;
        this.updateStageActionButtons(playerNum, 'deck');
      } else if (cState.state === 'WALKING') {
        cState.state = 'IDLE_STATION';
        if (bones) {
          if (bones.lUpLeg) bones.lUpLeg.rotation.x = 0;
          if (bones.rUpLeg) bones.rUpLeg.rotation.x = 0;
          if (bones.lLeg) bones.lLeg.rotation.x = 0;
          if (bones.rLeg) bones.rLeg.rotation.x = 0;
        }
        char.position.y = char.userData.baseY || 0;
      }
    }
  }

  /* ============================================================
     INTERACTIONS & CAMERA ORBIT CONTROLS
     ============================================================ */
  setupInteractions(canvas, container) {
    let pointerDownPos = { x: 0, y: 0 };
    let didMoveDrag = false;

    const onMouseDown = (e) => {
      this.isDragging = true;
      this.previousMousePosition = { x: e.clientX, y: e.clientY };
      pointerDownPos = { x: e.clientX, y: e.clientY };
      didMoveDrag = false;
    };

    const onMouseMove = (e) => {
      if (this.isDragging) {
        if (Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y) > 6) {
          didMoveDrag = true;
        }
        const deltaX = e.clientX - this.previousMousePosition.x;
        const deltaY = e.clientY - this.previousMousePosition.y;

        this.orbitAngles.theta -= deltaX * 0.007;
        this.orbitAngles.phi = Math.max(0.1, Math.min(Math.PI / 2.2, this.orbitAngles.phi - deltaY * 0.007));

        this.previousMousePosition = { x: e.clientX, y: e.clientY };
      }
    };

    // Raycaster for click-to-walk navigation on stage floor
    const raycaster = new THREE.Raycaster();
    const mouseCoord = new THREE.Vector2();

    const onMouseUp = (e) => {
      this.isDragging = false;

      // If user clicked without dragging, treat as Click-to-Walk command
      if (!didMoveDrag && this.camera && this.scene) {
        const rect = canvas.getBoundingClientRect();
        mouseCoord.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouseCoord.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouseCoord, this.camera);
        const stageFloorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const hitPoint = new THREE.Vector3();

        if (raycaster.ray.intersectPlane(stageFloorPlane, hitPoint)) {
          if (Math.hypot(hitPoint.x, hitPoint.z) < 3.7) {
            // Left click side controls Player 1, Right side controls Player 2
            const p = hitPoint.x < 0 ? 1 : 2;
            const isAtDeck = Math.abs(hitPoint.x) < 1.4 && hitPoint.z > -1.25 && hitPoint.z < -0.6;
            const nextState = isAtDeck ? 'DJ_SCRATCHING' : 'IDLE_STATION';
            const facing = isAtDeck ? 0.0 : null;

            this.walkCharacterTo(p, hitPoint.x, hitPoint.z, nextState, facing);
            this.showClickRipple(hitPoint.x, hitPoint.z, p);
          }
        }
      }
    };

    const onWheel = (e) => {
      e.preventDefault();
      this.orbitAngles.radius = Math.max(3.2, Math.min(8.5, this.orbitAngles.radius + e.deltaY * 0.004));
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // Touch support for mobile / tablets
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      if (!this.isDragging || e.touches.length !== 1) return;
      const deltaX = e.touches[0].clientX - this.previousMousePosition.x;
      const deltaY = e.touches[0].clientY - this.previousMousePosition.y;

      this.orbitAngles.theta -= deltaX * 0.008;
      this.orbitAngles.phi = Math.max(0.1, Math.min(Math.PI / 2.2, this.orbitAngles.phi - deltaY * 0.008));

      this.previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: true });

    canvas.addEventListener('touchend', () => { this.isDragging = false; });

    // Window resize
    this.resizeHandler = () => this.onResize();
    window.addEventListener('resize', this.resizeHandler);

    // Wire Stage Action Buttons (Deck & Mix, Side Stage, Face-off)
    document.querySelectorAll('.stage-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = parseInt(btn.dataset.player);
        const action = btn.dataset.action;
        if (action === 'deck') this.sendCharacterToDeck(p);
        else if (action === 'hype') this.sendCharacterToHype(p);
        else if (action === 'center') this.sendCharacterToCenter(p);
      });
    });
  }

  /* ============================================================
     AUDIO STATE & REACTIVITY
     ============================================================ */
  setAudioPlaying(playerNum, isPlaying) {
    this.audioState[playerNum] = !!isPlaying;

    if (this.tonearmTargets) {
      this.tonearmTargets[playerNum] = isPlaying ? 1 : 0;
    }

    // Automatically send active DJ to the deck to scratch & mix when audio plays!
    if (isPlaying) {
      this.sendCharacterToDeck(playerNum);
    } else {
      if (this.characterStates[playerNum].currentStation === 'deck') {
        this.sendCharacterToHype(playerNum);
      }
    }

    // Update HUD indicator badges
    const hudBox = document.getElementById(`hud-p${playerNum}`);
    const hudStatus = document.getElementById(`hud-status-${playerNum}`);
    if (hudBox && hudStatus) {
      if (isPlaying) {
        hudBox.classList.add('active');
        hudStatus.textContent = 'DROPPING BEATS';
      } else {
        hudBox.classList.remove('active');
        hudStatus.textContent = 'STANDBY';
      }
    }

    // Spotlights focus on active contestant
    if (this.stageLights.spotP1) {
      this.stageLights.spotP1.intensity = this.audioState[1] ? 8.0 : (this.audioState[2] ? 2.0 : 4.0);
    }
    if (this.stageLights.spotP2) {
      this.stageLights.spotP2.intensity = this.audioState[2] ? 8.0 : (this.audioState[1] ? 2.0 : 4.0);
    }
  }

  /**
   * Soundboard Effect Reactions: Air Horn subwoofer punch & strobes,
   * boxing bell flash, needle drop/scratch, and crowd cheering
   */
  triggerSoundReaction(soundKey) {
    if (soundKey === 'airhorn') {
      // 1. Violent subwoofer cone kick excursion on both stacks
      this.cones.forEach(item => {
        item.group.position.z = item.initialZ + 0.085;
        if (item.coneMat && item.type === 'subwoofer') {
          item.coneMat.emissiveIntensity = 2.0;
        }
      });

      // 2. Cryogenic Stage Smoke Plumes ("Who Want That Smoke")
      this.triggerSmokeBlast(2.6, 0xffffff);

      // 3. High-energy stage strobe lighting sequence
      let count = 0;
      const strobe = setInterval(() => {
        const on = count % 2 === 0;
        if (this.stageLights.spotP1) this.stageLights.spotP1.intensity = on ? 9.0 : 1.2;
        if (this.stageLights.spotP2) this.stageLights.spotP2.intensity = on ? 9.0 : 1.2;
        if (this.stageLights.deckLight) this.stageLights.deckLight.intensity = on ? 5.0 : 1.0;
        count++;
        if (count >= 10) {
          clearInterval(strobe);
          if (this.stageLights.spotP1) this.stageLights.spotP1.intensity = this.audioState[1] ? 8.0 : 3.0;
          if (this.stageLights.spotP2) this.stageLights.spotP2.intensity = this.audioState[2] ? 8.0 : 3.0;
          if (this.stageLights.deckLight) this.stageLights.deckLight.intensity = 1.8;
        }
      }, 65);

      this.pulse();
    } else if (soundKey === 'crowd_cheer') {
      this.triggerSmokeBlast(1.8, 0xffaa00);
      this.pulse();
    } else if (soundKey === 'bell') {
      this.triggerSmokeBlast(1.0, 0x00e5ff);
      // White arena championship bell flash
      if (this.stageLights.deckLight) {
        this.stageLights.deckLight.color.setHex(0xfffae0);
        this.stageLights.deckLight.intensity = 5.5;
        setTimeout(() => {
          this.stageLights.deckLight.color.setHex(0xffffff);
          this.stageLights.deckLight.intensity = 1.8;
        }, 600);
      }
      this.pulse();
    } else if (soundKey === 'crowd_react' || soundKey === 'crowd_cheer') {
      // Contestants react to crowd hype
      [1, 2].forEach(p => {
        const bones = this.characterBones[p];
        if (bones && bones.head) {
          bones.head.rotation.x = -0.22;
          setTimeout(() => { bones.head.rotation.x = 0; }, 750);
        }
      });
      // Flash stage spotlights
      if (this.stageLights.spotP1) this.stageLights.spotP1.intensity = 6.5;
      if (this.stageLights.spotP2) this.stageLights.spotP2.intensity = 6.5;
      setTimeout(() => {
        if (this.stageLights.spotP1) this.stageLights.spotP1.intensity = this.audioState[1] ? 8.0 : 3.0;
        if (this.stageLights.spotP2) this.stageLights.spotP2.intensity = this.audioState[2] ? 8.0 : 3.0;
      }, 500);
    } else if (soundKey === 'needle_drop') {
      // Force tonearms to drop onto records and kickstart platter
      [1, 2].forEach(p => {
        this.tonearmTargets[p] = 1;
        this.turntableSpeeds[p] = 4.8;
      });
    } else if (soundKey === 'needle_stop') {
      // Vinyl scratch brake stop: reverse platter briefly then halt
      [1, 2].forEach(p => {
        this.turntableSpeeds[p] = -2.0;
        this.tonearmTargets[p] = 0;
        setTimeout(() => { this.turntableSpeeds[p] = 0; }, 220);
      });
    }
  }

  setContestantName(playerNum, name) {
    const el = document.getElementById(`hud-name-${playerNum}`);
    if (el) el.textContent = name || `Contestant ${playerNum}`;
  }

  /**
   * Emissive lighting pulse across stage on score submit or battle win
   */
  pulse() {
    if (this.tableNeon) {
      const orig = this.tableNeon.color.getHex();
      this.tableNeon.color.setHex(0xffffff);
      setTimeout(() => { this.tableNeon.color.setHex(orig); }, 400);
    }

    if (this.djDeck) {
      this.djDeck.traverse((child) => {
        if (child.isMesh && child.material && child.material.emissiveIntensity !== undefined) {
          child.material.emissiveIntensity = 4.5;
          const decay = () => {
            child.material.emissiveIntensity *= 0.93;
            if (child.material.emissiveIntensity > 1.7) {
              requestAnimationFrame(decay);
            } else {
              child.material.emissiveIntensity = 1.6;
            }
          };
          requestAnimationFrame(decay);
        }
      });
    }
  }

  /* ============================================================
     CHARACTER LOCOMOTION & DJ CONSOLE INTERACTION ENGINE
     ============================================================ */
  updateCharacterLocomotion(p, delta, elapsed) {
    const char = this.characters[p];
    const cState = this.characterStates[p];
    const bones = this.characterBones[p];
    if (!char || !cState || !bones) return;

    const isP1 = p === 1;
    const baseY = char.userData.baseY || 0;
    const beatTime = elapsed * (this.bpm / 60) * Math.PI * 2;

    if (cState.state === 'WALKING') {
      const dx = cState.targetPos.x - char.position.x;
      const dz = cState.targetPos.z - char.position.z;
      const dist = Math.hypot(dx, dz);

      if (dist > 0.08) {
        // Move towards target position
        const dirX = dx / dist;
        const dirZ = dz / dist;
        const moveStep = Math.min(dist, cState.speed * delta);
        char.position.x += dirX * moveStep;
        char.position.z += dirZ * moveStep;

        // Smoothly rotate character towards movement heading
        const moveAngle = Math.atan2(dirX, dirZ);
        let angleDiff = (moveAngle - char.rotation.y) % (Math.PI * 2);
        if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        char.rotation.y += angleDiff * 0.18;

        // Walk cycle stride
        cState.walkPhase += delta * 8.5;
        const wp = cState.walkPhase;

        // Alternating leg swing
        if (bones.lUpLeg) bones.lUpLeg.rotation.x = Math.sin(wp) * 0.55;
        if (bones.rUpLeg) bones.rUpLeg.rotation.x = -Math.sin(wp) * 0.55;

        // Knee bend on recovery swing
        if (bones.lLeg) bones.lLeg.rotation.x = Math.max(0, -Math.sin(wp)) * 0.65;
        if (bones.rLeg) bones.rLeg.rotation.x = Math.max(0, Math.sin(wp)) * 0.65;

        // Hip vertical bounce
        char.position.y = baseY + Math.abs(Math.sin(wp * 2)) * 0.035;

        // Arm counter-swing
        if (bones.lArm) bones.lArm.rotation.x = -Math.sin(wp) * 0.45;
        if (bones.rArm) bones.rArm.rotation.x = Math.sin(wp) * 0.45;
        if (bones.spine) bones.spine.rotation.x = 0.08;
      } else {
        // Arrived at target destination!
        cState.state = cState.nextState || 'IDLE_STATION';
        if (cState.targetFacingAngle !== null && cState.targetFacingAngle !== undefined) {
          char.rotation.y = cState.targetFacingAngle;
        }

        // Reset legs to standing
        if (bones.lUpLeg) bones.lUpLeg.rotation.x = 0;
        if (bones.rUpLeg) bones.rUpLeg.rotation.x = 0;
        if (bones.lLeg) bones.lLeg.rotation.x = 0;
        if (bones.rLeg) bones.rLeg.rotation.x = 0;
        char.position.y = baseY;
      }
    } else if (cState.state === 'DJ_SCRATCHING') {
      // Character is at the DJ console actively scratching and mixing
      // Turn to face the table (+Z, 0 rad)
      char.rotation.y += (0.0 - char.rotation.y) * 0.1;
      char.position.y = baseY;

      // Upper torso leans in over the deck
      if (bones.spine) {
        bones.spine.rotation.x = 0.22 + Math.sin(beatTime) * 0.06;
      }

      // Head nodding to the beat
      if (bones.head) {
        bones.head.rotation.x = Math.sin(beatTime) * 0.32 + 0.15;
        bones.head.rotation.y = Math.cos(beatTime * 0.5) * 0.08;
      }

      // SCRATCHING ARM:
      // Left arm for Player 1, Right arm for Player 2
      const scratchArm = isP1 ? bones.lArm : bones.rArm;
      const scratchForeArm = isP1 ? bones.lForeArm : bones.rForeArm;
      const scratchHand = isP1 ? bones.lHand : bones.rHand;

      if (scratchArm && scratchForeArm) {
        // Extend arm forward onto the vinyl platter
        scratchArm.rotation.x = 0.85;
        scratchArm.rotation.y = isP1 ? -0.1 : 0.1;
        scratchArm.rotation.z = isP1 ? 0.22 : -0.22;

        scratchForeArm.rotation.x = 0.75;
        scratchForeArm.rotation.y = isP1 ? 0.25 : -0.25;

        // Rhythmic vinyl baby scratching motion
        const isPlaying = this.audioState[p];
        const scratchSpeed = isPlaying ? 10 : 4;
        const scratchCycle = Math.sin(elapsed * scratchSpeed);

        scratchForeArm.rotation.z = scratchCycle * 0.18;
        if (scratchHand) {
          scratchHand.rotation.x = 0.25 + scratchCycle * 0.35;
        }

        // Real-time micro-scratch rotation on vinyl platter
        if (this.turntables[p] && isPlaying) {
          this.turntables[p].rotation.y += scratchCycle * delta * 2.5;
        }
      }

      // MIXER / EQ TWEAKING ARM:
      // Right arm for Player 1, Left arm for Player 2
      const mixArm = isP1 ? bones.rArm : bones.lArm;
      const mixForeArm = isP1 ? bones.rForeArm : bones.lForeArm;
      const mixHand = isP1 ? bones.rHand : bones.lHand;

      if (mixArm && mixForeArm) {
        // Reaching inward towards center mixer knobs
        mixArm.rotation.x = 0.68;
        mixArm.rotation.y = isP1 ? 0.38 : -0.38;
        mixArm.rotation.z = isP1 ? -0.15 : 0.15;

        mixForeArm.rotation.x = 0.55;
        mixForeArm.rotation.y = isP1 ? -0.2 : 0.2;

        // Wrist flick adjusting EQ knobs / sliding crossfader
        if (mixHand) {
          mixHand.rotation.y = Math.sin(elapsed * 4) * 0.4;
        }
      }

      // Stand legs relaxed
      if (bones.lUpLeg) bones.lUpLeg.rotation.x = 0.05;
      if (bones.rUpLeg) bones.rUpLeg.rotation.x = -0.05;
    } else {
      // IDLE_STATION:
      // Smoothly relax arms and legs back to idle
      const isPlaying = this.audioState[p];
      if (isPlaying) {
        // Hype bobbing and swaying
        const bob = Math.sin(beatTime) * 0.035;
        char.position.y = baseY + Math.max(0, bob);
        if (bones.head) bones.head.rotation.x = Math.sin(beatTime) * 0.25 + 0.1;
        if (bones.spine) bones.spine.rotation.x = 0.08 + Math.sin(beatTime) * 0.04;
      } else {
        char.position.y += (baseY - char.position.y) * 0.1;
        if (bones.lUpLeg) bones.lUpLeg.rotation.x += (0 - bones.lUpLeg.rotation.x) * 0.1;
        if (bones.rUpLeg) bones.rUpLeg.rotation.x += (0 - bones.rUpLeg.rotation.x) * 0.1;
        if (bones.lLeg) bones.lLeg.rotation.x += (0 - bones.lLeg.rotation.x) * 0.1;
        if (bones.rLeg) bones.rLeg.rotation.x += (0 - bones.rLeg.rotation.x) * 0.1;
      }
    }
  }

  /* ============================================================
     RENDER & ANIMATION LOOP
     ============================================================ */
  animate() {
    this.animFrameId = requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();

    // 1. Update Skeletal Animation Mixers (Breathing Idle)
    [1, 2].forEach(p => {
      if (this.mixers[p]) {
        this.mixers[p].update(delta);
      }
    });

    // 2. Turntables Rotation & Tonearm Groove Tracking
    [1, 2].forEach(p => {
      const isPlaying = this.audioState[p];
      const targetSpeed = isPlaying ? 3.5 : 0; // 33 RPM simulated angular speed
      this.turntableSpeeds[p] += (targetSpeed - this.turntableSpeeds[p]) * 0.08;

      if (this.turntables[p] && Math.abs(this.turntableSpeeds[p]) > 0.01) {
        this.turntables[p].rotation.y += this.turntableSpeeds[p] * delta;
      }

      // Tonearm tracking
      if (this.tonearms[p]) {
        const target = this.tonearmTargets[p] ? 1 : 0;
        this.tonearmProgress[p] += (target - this.tonearmProgress[p]) * 0.08;

        const prog = this.tonearmProgress[p];
        const sign = p === 1 ? 1 : -1;
        // Swing from cradle (0) to outer vinyl groove (~0.38 rad)
        this.tonearms[p].rotation.y = sign * prog * 0.38;
        // Slight vertical lift off record when in cradle
        this.tonearms[p].rotation.x = (1 - prog) * -0.04;
      }
    });

    // 3. Character Locomotion & DJ Console Interaction
    [1, 2].forEach(p => {
      this.updateCharacterLocomotion(p, delta, elapsed);
    });

    // 4. Update Click-to-Walk Ripple Rings
    for (let i = this.clickRipples.length - 1; i >= 0; i--) {
      const rip = this.clickRipples[i];
      rip.progress += delta * 2.2;
      const s = 1 + rip.progress * 3.2;
      rip.mesh.scale.set(s, s, 1);
      rip.mat.opacity = Math.max(0, 0.85 * (1 - rip.progress));
      if (rip.progress >= 1) {
        this.scene.remove(rip.mesh);
        rip.mesh.geometry.dispose();
        rip.mat.dispose();
        this.clickRipples.splice(i, 1);
      }
    }

    // 4. Real-time Subwoofer Bass Excursions & Tower Vibrations
    const analysis = this.audioPlayer?.getAudioAnalysis ? this.audioPlayer.getAudioAnalysis() : null;
    const isAnyPlaying = analysis ? analysis.isPlaying : (this.audioState[1] || this.audioState[2]);
    const realBass = (analysis && analysis.isPlaying) ? analysis.bassEnergy : null;
    const beatPhase = elapsed * (this.bpm / 60) * Math.PI * 2;

    this.cones.forEach(item => {
      const isPlaying = this.audioState[item.playerNum] || (isAnyPlaying && realBass !== null);
      if (isPlaying && !this.reducedMotion) {
        const kickPulse = realBass !== null ? (realBass * 1.6) : Math.pow(Math.max(0, Math.sin(beatPhase)), 4);
        const subVibe = Math.sin(elapsed * 45) * 0.006;
        const excursion = (kickPulse * 0.05) + subVibe;

        item.group.position.z = item.initialZ + excursion;

        // Dynamic emissive flash on kick hits (suppressed if noFlash is active)
        if (item.coneMat && item.type === 'subwoofer') {
          item.coneMat.emissiveIntensity = this.noFlash ? 0.2 : (0.15 + kickPulse * 0.6);
        }
      } else {
        // Rest position
        item.group.position.z += (item.initialZ - item.group.position.z) * 0.15;
        if (item.coneMat && item.type === 'subwoofer') {
          item.coneMat.emissiveIntensity = 0.15;
        }
      }
    });

    // 5. Cryogenic Smoke Cannons Update
    this.updateSmoke(delta);

    // 6. Stage Jumbotron Screen Update
    this.updateJumbotron(elapsed);

    // 7. Arena Moving Lasers & Spotlights
    this.updateMovingLights(elapsed);

    // 8. Arena Crowd Spectators & Camera Flashes
    this.updateCrowd(delta, elapsed);

    // 8. Camera Director Auto-Rotation
    if (this.cameraMode === 'auto') {
      this.autoCamTimer += delta;
      if (this.autoCamTimer > 10.0) {
        this.autoCamTimer = 0;
        const modes = ['front', 'dj_pov', 'staredown', 'drone'];
        this.autoCamIndex = (this.autoCamIndex + 1) % modes.length;
        this.setCameraView(modes[this.autoCamIndex]);
        this.cameraMode = 'auto';
      }
    }

    // 9. Camera Management (Smooth Orbit + Focus on Active Contestant)
    if (!this.isDragging) {
      // Gentle cinematic sway
      const baseTheta = (this.audioState[1] && !this.audioState[2])
        ? -0.25 // Frame contestant 1
        : ((this.audioState[2] && !this.audioState[1])
          ? 0.25 // Frame contestant 2
          : Math.sin(elapsed * 0.2) * 0.12);

      const targetX = Math.sin(this.orbitAngles.theta + baseTheta) * (this.orbitAngles.radius * Math.cos(this.orbitAngles.phi));
      const targetY = Math.max(1.5, Math.sin(this.orbitAngles.phi) * this.orbitAngles.radius);
      const targetZ = Math.cos(this.orbitAngles.theta + baseTheta) * (this.orbitAngles.radius * Math.cos(this.orbitAngles.phi));

      this.desiredCamPos.set(targetX, targetY, targetZ);
    } else {
      const targetX = Math.sin(this.orbitAngles.theta) * (this.orbitAngles.radius * Math.cos(this.orbitAngles.phi));
      const targetY = Math.sin(this.orbitAngles.phi) * this.orbitAngles.radius;
      const targetZ = Math.cos(this.orbitAngles.theta) * (this.orbitAngles.radius * Math.cos(this.orbitAngles.phi));

      this.desiredCamPos.set(targetX, targetY, targetZ);
    }

    // Smooth camera damping
    this.currentCamPos.lerp(this.desiredCamPos, 0.06);
    this.camera.position.copy(this.currentCamPos);

    // Look target follows active contestant slightly
    const desiredTargetX = (this.audioState[1] && !this.audioState[2])
      ? -0.6
      : ((this.audioState[2] && !this.audioState[1]) ? 0.6 : 0);
    this.cameraTarget.x += (desiredTargetX - this.cameraTarget.x) * 0.05;
    this.camera.lookAt(this.cameraTarget);

    // 10. Render Scene
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  onResize() {
    const container = document.getElementById('dj-canvas-container');
    if (!container || !this.camera || !this.renderer) return;

    this.camera.aspect = container.clientWidth / container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(container.clientWidth, container.clientHeight);
  }

  setAudioPlayer(audioPlayer) {
    this.audioPlayer = audioPlayer;
  }

  setReducedMotion(enabled) {
    this.reducedMotion = !!enabled;
  }

  setNoFlash(enabled) {
    this.noFlash = !!enabled;
  }

  setQualityPreset(preset = 'high') {
    this.qualityPreset = preset;
    if (!this.renderer) return;

    if (preset === 'low') {
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = false;
    } else if (preset === 'medium') {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
      this.renderer.shadowMap.enabled = true;
    } else {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = true;
    }
  }

  destroy() {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    window.removeEventListener('resize', this.resizeHandler);
    if (this.renderer) this.renderer.dispose();
  }
}

export { DJControllerRenderer };
