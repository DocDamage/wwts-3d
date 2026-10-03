/**
 * DJ Battle Stage Renderer — Three.js 3D Soundstage Arena
 * Features:
 * - Center DJ Controller (FBX + PBR textures) made playable by DeckControls
 * - Audio Speaker & Subwoofer System (Left & Right front subwoofers + rear towers with real bass excursion)
 * - Contestant 3D Characters (Male & Female FBX models with real Breathing Idle animation)
 * - Dynamic DJ beat-dropping animation when music plays
 * - Live audio sync (vinyl spins with the track, subwoofers punch, characters vibe to the tempo)
 * - Interactive camera orbit with smooth focus transitions
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CharacterAnimator } from './characterAnimator.js';
import {
  MOVES_BY_ID, TAUNT_REACTIONS, HYPE_REACTIONS, IDLE_FIDGETS, walkCycle, djStation, groove, registerMove
} from './characterMoves.js';

// Stage layout (metres). The DJ table top is 3.6 x 1.4, centred on the origin.
const STAGE_RADIUS = 3.5;
const TABLE_HALF_X = 1.8;
const TABLE_HALF_Z = 0.7;
const CHAR_RADIUS = 0.24;
const STATIONS = { deckZ: -1.0, hypeX: 1.45, hypeZ: 1.3, faceoffZ: 1.75 };
const WALK_SPEED = 1.5;
const RUN_SPEED = 3.4;
const EMOTE_FADE_IN = 0.18;
const EMOTE_FADE_OUT = 0.3;
const DECK_LEVEL_TILT = -0.097; // radians; cancels the controller model's sloped top

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clampAngle = (a, max) => Math.max(-max, Math.min(max, a));
const turnToward = (from, to, rate) => from + wrapAngle(to - from) * Math.min(1, rate);

class DJControllerRenderer {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.clock = new THREE.Clock();
    this.animFrameId = null;

    // Models & Components
    this.djDeck = null;
    this.deckControls = null; // DeckControls — set by the app before init()
    this.speakers = { 1: [], 2: [] }; // Subwoofers & towers with cones
    this.cones = []; // All vibrating cones { mesh, initialPos, playerNum, power }

    // Characters (4 Avatars: Black Male, Black Female, White Male, White Female)
    this.characters = { 1: null, 2: null };
    this.mixers = { 1: null, 2: null };
    this.animators = { 1: null, 2: null };
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

    // Direct control & moves
    this.drivenPlayer = null; // which contestant the arrow keys / stick drive
    this.driveKeys = {};
    this.padInput = { 1: null, 2: null };
    this.selectionRings = { 1: null, 2: null };
    this._reactionTimers = {};
    this.onMoveChange = null;     // (playerNum, moveId|null)
    this.onDrivenChange = null;   // (playerNum|null)
    this.onCharacterContext = null; // (playerNum, clientX, clientY) — right-click on a character
    this.onMovesChanged = null;   // fired when mocap moves finish loading
    this.mocapClips = {};         // moveId -> AnimationClip with prefix-free track names
    this.mocapActions = { 1: {}, 2: {} };
    this.idleActions = { 1: null, 2: null };

    // Audio Playback State
    this.audioState = { 1: false, 2: false };
    this.bpm = 96; // Standard hip-hop beat battle BPM
    this.audioPlayer = null; // Real Web Audio Analyser source
    this.reducedMotion = false;
    this.noFlash = false;
    this.qualityPreset = 'high';

    // Camera Orbit & Controls
    this.cameraTarget = new THREE.Vector3(0, 1.25, 0);
    this.desiredCamPos = new THREE.Vector3(0, 2.8, 5.0);
    this.currentCamPos = new THREE.Vector3(0, 2.8, 5.0);
    this.isDragging = false;
    this.previousMousePosition = { x: 0, y: 0 };
    // Pulled back so characters stay visible between the full-screen overlay panels
    this.orbitAngles = { theta: 0, phi: 0.3, radius: 7.4 };
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

    // 11. Contestant Characters (+ optional Mixamo motion-capture moves)
    this.loadCharacters();
    this.loadMocapMoves();

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
    this.ambientLight = ambient;

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
    const c1Score = document.getElementById('contestant-1-total')?.textContent || '0.00';
    const c2Score = document.getElementById('contestant-2-total')?.textContent || '0.00';
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
    this.deckControls?.build(deckGroup);
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

    // Remove existing character if any (its position is reused for the new avatar)
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

    // Positioning & Grounding feet on stage floor (y = 0)
    box.setFromObject(char);
    const footOffset = box.min.y;
    const baseY = footOffset < 0 ? -footOffset : 0;
    char.userData.baseY = baseY;

    // Flank the DJ booth on left and right initially (or keep the spot when swapping avatars)
    const cState = this.characterStates[playerNum];
    const prev = this.characters[playerNum];
    const side = playerNum === 1 ? -1 : 1;
    const startX = prev ? prev.position.x : side * STATIONS.hypeX;
    const startZ = prev ? prev.position.z : STATIONS.hypeZ;
    char.position.set(startX, baseY, startZ);
    if (!prev) {
      cState.facing = -side * 0.35;
      cState.targetPos.set(startX, 0, startZ);
      cState.currentStation = 'hype';
      cState.state = 'IDLE_STATION';
      cState.targetFacingAngle = cState.facing;
    }
    char.rotation.y = cState.facing;
    cState.emote = null;
    cState.fadingEmote = null;

    if (!this.selectionRings[playerNum]) {
      const ringMat = new THREE.MeshBasicMaterial({
        color: playerNum === 1 ? 0xff2d2d : 0x00e5ff,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.42, 40), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = this.drivenPlayer === playerNum;
      this.scene.add(ring);
      this.selectionRings[playerNum] = ring;
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
      this.idleActions[playerNum] = action;
      this.mocapActions[playerNum] = {};
    } else {
      this.mixers[playerNum] = null;
    }
    this.animators[playerNum] = new CharacterAnimator(char, this.mixers[playerNum]);
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

  /**
   * Optional real motion capture: list Mixamo FBX clips (exported "Without Skin")
   * in /models/animations/manifest.json and they join the move library:
   *   [{ "id": "hiphop", "label": "Hip Hop", "icon": "🔥", "category": "dance",
   *      "file": "Hip Hop Dancing.fbx", "loop": true }]
   */
  async loadMocapMoves() {
    let manifest;
    try {
      const res = await fetch('/models/animations/manifest.json');
      if (!res.ok) return;
      manifest = await res.json();
    } catch {
      return; // No manifest — procedural moves only
    }
    if (!Array.isArray(manifest)) return;

    const loader = new FBXLoader();
    const loaded = await Promise.all(manifest.map(entry => new Promise(resolve => {
      loader.load(`/models/animations/${entry.file}`, (obj) => resolve({ entry, clip: obj.animations?.[0] }), undefined, () => resolve(null));
    })));

    loaded.filter(item => item && item.clip).forEach(({ entry, clip }) => {
      const generic = clip.clone();
      generic.tracks.forEach(track => { track.name = track.name.replace(/^mixamorig\d*:?/, ''); });
      // Strip horizontal root travel so dances stay on their spot (the controller owns position)
      generic.tracks = generic.tracks.filter(track => !(track.name === 'Hips.position'));
      this.mocapClips[entry.id] = generic;
      registerMove({
        id: entry.id,
        label: entry.label || entry.id,
        icon: entry.icon || '🎬',
        category: entry.category || 'dance',
        loop: entry.loop !== false,
        duration: generic.duration,
        mocap: true,
        fn() {} // the clip itself drives the body
      });
    });
    if (typeof this.onMovesChanged === 'function') this.onMovesChanged();
  }

  /** Cross-fade a character from idle into a mocap clip (or back when moveId is null) */
  setMocapAction(playerNum, moveId) {
    const mixer = this.mixers[playerNum];
    const idle = this.idleActions[playerNum];
    const char = this.characters[playerNum];
    if (!mixer || !idle || !char) return;

    const current = Object.values(this.mocapActions[playerNum]).find(a => a.isRunning() && a.getEffectiveWeight() > 0);
    if (!moveId) {
      if (current) {
        idle.reset().play();
        current.crossFadeTo(idle, EMOTE_FADE_OUT, false);
      }
      return;
    }
    const generic = this.mocapClips[moveId];
    if (!generic) return;

    let action = this.mocapActions[playerNum][moveId];
    if (!action) {
      // Re-prefix track names for this rig (e.g. "mixamorig10" vs "mixamorig")
      let prefix = '';
      char.traverse(n => { if (!prefix && n.isBone && /Hips$/.test(n.name)) prefix = n.name.replace(/Hips$/, ''); });
      const clip = generic.clone();
      clip.tracks.forEach(track => { track.name = prefix + track.name; });
      action = mixer.clipAction(clip);
      this.mocapActions[playerNum][moveId] = action;
    }
    const move = MOVES_BY_ID[moveId];
    action.setLoop(move?.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.reset().play();
    (current || idle).crossFadeTo(action, EMOTE_FADE_IN + 0.1, false);
  }

  checkAllLoaded() {
    const loadingOverlay = document.getElementById('dj-loading');
    if (loadingOverlay && !loadingOverlay.classList.contains('hidden')) {
      loadingOverlay.classList.add('hidden');
      setTimeout(() => { loadingOverlay.style.display = 'none'; }, 400);
    }
  }

  /* ============================================================
     CHARACTER NAVIGATION, CONTROL & MOVES
     ============================================================ */
  walkCharacterTo(playerNum, targetX, targetZ, nextState = 'IDLE_STATION', targetFacing = null) {
    const cState = this.characterStates[playerNum];
    if (!cState) return;

    // Constrain destination to the stage platform and keep it off the DJ table
    const clamped = this.constrainToStage(targetX, targetZ);
    const char = this.characters[playerNum];
    const from = char ? { x: char.position.x, z: char.position.z } : clamped;
    // Route around the DJ table instead of walking through it
    cState.path = [...this.routeAroundTable(from, clamped), clamped];
    const first = cState.path.shift();
    cState.targetPos.set(first.x, 0, first.z);
    cState.finalTarget = clamped;
    cState.nextState = nextState;
    cState.targetFacingAngle = targetFacing;
    cState.state = 'WALKING';
    cState.directControl = false;
    cState.run = Math.hypot(clamped.x - from.x, clamped.z - from.z) > 2.6;
  }

  /** Does the straight segment a→b cross the (padded) table footprint? */
  segmentHitsTable(a, b) {
    const hx = TABLE_HALF_X + CHAR_RADIUS - 0.02;
    const hz = TABLE_HALF_Z + CHAR_RADIUS - 0.02;
    for (let i = 1; i < 24; i++) {
      const u = i / 24;
      const x = a.x + (b.x - a.x) * u;
      const z = a.z + (b.z - a.z) * u;
      if (Math.abs(x) < hx && Math.abs(z) < hz) return true;
    }
    return false;
  }

  /** Corner waypoints (0, 1 or 2) that get from a to b without crossing the table */
  routeAroundTable(a, b) {
    if (!this.segmentHitsTable(a, b)) return [];
    const cx = TABLE_HALF_X + CHAR_RADIUS + 0.12;
    const cz = TABLE_HALF_Z + CHAR_RADIUS + 0.12;
    const corners = [[-cx, -cz], [cx, -cz], [-cx, cz], [cx, cz]].map(([x, z]) => ({ x, z }));
    const len = (pts) => pts.reduce((sum, p, i) => i ? sum + Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) : 0, 0);
    let best = null;
    corners.forEach(c => {
      if (this.segmentHitsTable(a, c) || this.segmentHitsTable(c, b)) return;
      const d = len([a, c, b]);
      if (!best || d < best.d) best = { d, pts: [c] };
    });
    if (best) return best.pts;
    corners.forEach(c1 => corners.forEach(c2 => {
      if (c1 === c2 || this.segmentHitsTable(a, c1) || this.segmentHitsTable(c1, c2) || this.segmentHitsTable(c2, b)) return;
      const d = len([a, c1, c2, b]);
      if (!best || d < best.d) best = { d, pts: [c1, c2] };
    }));
    return best ? best.pts : [];
  }

  /** Keep a point on the round stage and outside the DJ table footprint */
  constrainToStage(x, z) {
    const dist = Math.hypot(x, z);
    if (dist > STAGE_RADIUS) {
      x = (x / dist) * STAGE_RADIUS;
      z = (z / dist) * STAGE_RADIUS;
    }
    const hx = TABLE_HALF_X + CHAR_RADIUS;
    const hz = TABLE_HALF_Z + CHAR_RADIUS;
    if (Math.abs(x) < hx && Math.abs(z) < hz) {
      // Push out along the shallowest axis
      const pushX = hx - Math.abs(x);
      const pushZ = hz - Math.abs(z);
      if (pushX < pushZ) x = Math.sign(x || 1) * hx;
      else z = Math.sign(z || 1) * hz;
    }
    return { x, z };
  }

  sendCharacterToDeck(playerNum) {
    const isP1 = playerNum === 1;
    this.characterStates[playerNum].currentStation = 'deck';
    this.walkCharacterTo(playerNum, isP1 ? -0.88 : 0.88, STATIONS.deckZ, 'DJ_SCRATCHING', 0.0);
    this.updateStageActionButtons(playerNum, 'deck');
  }

  sendCharacterToHype(playerNum) {
    const isP1 = playerNum === 1;
    this.characterStates[playerNum].currentStation = 'hype';
    this.walkCharacterTo(playerNum, isP1 ? -STATIONS.hypeX : STATIONS.hypeX, STATIONS.hypeZ, 'IDLE_STATION', isP1 ? 0.35 : -0.35);
    this.updateStageActionButtons(playerNum, 'hype');
  }

  sendCharacterToCenter(playerNum) {
    const isP1 = playerNum === 1;
    // Face-off happens downstage, in front of the booth, so the audience sees it
    this.characterStates[playerNum].currentStation = 'center';
    this.walkCharacterTo(playerNum, isP1 ? -0.5 : 0.5, STATIONS.faceoffZ, 'IDLE_STATION', isP1 ? Math.PI / 2 : -Math.PI / 2);
    this.updateStageActionButtons(playerNum, 'center');
  }

  /** Start a move from the library on a character. Returns false if unknown. */
  playMove(playerNum, moveId, { fromUser = true } = {}) {
    const move = MOVES_BY_ID[moveId];
    const cState = this.characterStates[playerNum];
    if (!move || !cState || !this.characters[playerNum]) return false;

    // Full-body moves need the character planted
    if (!move.upper && cState.state === 'WALKING') {
      cState.state = 'IDLE_STATION';
      cState.targetPos.copy(this.characters[playerNum].position);
    }
    if (cState.state === 'DJ_SCRATCHING' && !move.upper) {
      cState.state = 'IDLE_STATION';
    }

    const prev = cState.emote;
    if (prev && prev.move.id !== moveId) {
      cState.fadingEmote = { ...prev, stopping: true, stopT: 0 };
    }
    cState.emote = { move, t: 0, stopping: false, stopT: 0, fromUser };
    if (move.mocap || prev?.move.mocap) this.setMocapAction(playerNum, move.mocap ? move.id : null);
    cState.fidgetTimer = 6 + Math.random() * 8;
    if (typeof this.onMoveChange === 'function') this.onMoveChange(playerNum, moveId);

    // The opponent answers taunts on their own
    if (move.category === 'taunt' && fromUser) {
      const opp = playerNum === 1 ? 2 : 1;
      clearTimeout(this._reactionTimers[opp]);
      this._reactionTimers[opp] = setTimeout(() => this.autoReact(opp, TAUNT_REACTIONS), 700 + Math.random() * 500);
    }
    return true;
  }

  stopMove(playerNum) {
    const cState = this.characterStates[playerNum];
    if (!cState?.emote) return;
    cState.emote.stopping = true;
    if (cState.emote.move.mocap) this.setMocapAction(playerNum, null);
    if (typeof this.onMoveChange === 'function') this.onMoveChange(playerNum, null);
  }

  getActiveMove(playerNum) {
    const e = this.characterStates[playerNum]?.emote;
    return e && !e.stopping ? e.move.id : null;
  }

  /** Let a character answer on its own if it isn't busy and the user isn't driving it */
  autoReact(playerNum, pool) {
    const cState = this.characterStates[playerNum];
    if (!cState || cState.state === 'WALKING' || this.drivenPlayer === playerNum) return;
    if (cState.emote && !cState.emote.stopping && cState.emote.fromUser) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    this.playMove(playerNum, pick, { fromUser: false });
  }

  /** Celebrate/defeat hooks for the result reveal */
  playResultReaction(winnerNum) {
    [1, 2].forEach(p => {
      if (p === winnerNum) this.playMove(p, Math.random() < 0.5 ? 'celebrate' : 'victory_spin', { fromUser: false });
      else if (winnerNum) this.playMove(p, 'defeated', { fromUser: false });
    });
  }

  /** Which contestant the arrow keys / left stick drive (null = none) */
  setDrivenPlayer(playerNum) {
    this.drivenPlayer = playerNum || null;
    [1, 2].forEach(p => {
      if (this.selectionRings[p]) this.selectionRings[p].visible = this.drivenPlayer === p;
    });
    if (typeof this.onDrivenChange === 'function') this.onDrivenChange(this.drivenPlayer);
  }

  /** Gamepad left stick: world-space direction already resolved by the caller */
  moveCharacterDirect(playerNum, moveX, moveZ) {
    this.padInput[playerNum] = { x: moveX, z: moveZ, run: Math.hypot(moveX, moveZ) > 0.85 };
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

  /* ============================================================
     INTERACTIONS & CAMERA ORBIT CONTROLS
     ============================================================ */
  setupInteractions(canvas, container) {
    let pointerDownPos = { x: 0, y: 0 };
    let didMoveDrag = false;

    const onMouseDown = (e) => {
      if (this.deckControls?.consumedClick) return; // a deck control has the pointer
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
      if (this.deckControls?.consumedClick) {
        this.deckControls.consumedClick = false;
        return;
      }

      // If user clicked without dragging, treat as Click-to-Walk command
      if (!didMoveDrag && this.camera && this.scene) {
        const rect = canvas.getBoundingClientRect();
        mouseCoord.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouseCoord.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouseCoord, this.camera);
        const stageFloorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const hitPoint = new THREE.Vector3();

        // Clicking a contestant takes (or releases) control of them
        const picked = this.pickCharacter(raycaster);
        if (picked) {
          this.setDrivenPlayer(this.drivenPlayer === picked ? null : picked);
          return;
        }

        if (raycaster.ray.intersectPlane(stageFloorPlane, hitPoint)) {
          if (Math.hypot(hitPoint.x, hitPoint.z) < 3.7) {
            // Floor click walks the driven contestant, otherwise whoever's side was clicked
            const p = this.drivenPlayer || (hitPoint.x < 0 ? 1 : 2);
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
      this.orbitAngles.radius = Math.max(3.2, Math.min(11, this.orbitAngles.radius + e.deltaY * 0.004));
    };

    const rayFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouseCoord.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseCoord.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouseCoord, this.camera);
      return raycaster;
    };

    // Deck controls get first claim on the pointer (pointer events fire before mouse events)
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.deckControls || !this.camera) return;
      if (this.deckControls.pointerDown(rayFromEvent(e), e)) {
        canvas.setPointerCapture?.(e.pointerId);
        e.preventDefault();
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.deckControls || !this.camera) return;
      if (this.deckControls.dragging || !this.isDragging) this.deckControls.pointerMove(rayFromEvent(e), e);
    });
    canvas.addEventListener('pointerup', (e) => {
      canvas.releasePointerCapture?.(e.pointerId);
      if (this.deckControls?.dragging) this.deckControls.pointerUp();
    });
    canvas.addEventListener('pointerleave', () => {
      if (!this.deckControls?.dragging) this.deckControls?.hideTooltip();
    });

    // Right-click a contestant for the move wheel
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!this.camera) return;
      rayFromEvent(e);
      if (this.deckControls?.pick(raycaster)) return; // right-click on a pad opens its editor instead
      const picked = this.pickCharacter(raycaster) || this.drivenPlayer;
      if (picked && typeof this.onCharacterContext === 'function') {
        this.onCharacterContext(picked, e.clientX, e.clientY);
      }
    });

    // Arrow keys drive the selected contestant (Shift = run)
    const isTyping = (e) => ['input', 'textarea', 'select'].includes(e.target?.tagName?.toLowerCase());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Shift') this.driveKeys.Shift = true;
      if (!e.key.startsWith('Arrow') || isTyping(e) || !this.drivenPlayer) return;
      this.driveKeys[e.key] = true;
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') this.driveKeys.Shift = false;
      if (e.key.startsWith('Arrow')) this.driveKeys[e.key] = false;
    });
    window.addEventListener('blur', () => { this.driveKeys = {}; });

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // Touch support for mobile / tablets
    canvas.addEventListener('touchstart', (e) => {
      if (this.deckControls?.consumedClick) return;
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      if (!this.isDragging || e.touches.length !== 1 || this.deckControls?.dragging) return;
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
    // The stage flexes to fill the screen, so watch the container itself too
    const resizeTarget = document.getElementById('dj-canvas-container');
    if (resizeTarget && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.onResize());
      this.resizeObserver.observe(resizeTarget);
    }

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
  }

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
  }

  endReveal() {
    if (!this.revealActive) return;
    this.revealActive = false;
    const prev = this.preRevealLights || {};
    if (this.ambientLight && prev.ambient !== undefined) this.ambientLight.intensity = prev.ambient;
    if (this.stageLights.spotP1 && prev.p1 !== undefined) this.stageLights.spotP1.intensity = prev.p1;
    if (this.stageLights.spotP2 && prev.p2 !== undefined) this.stageLights.spotP2.intensity = prev.p2;
    if (this.stageLights.deckLight && prev.deck !== undefined) this.stageLights.deckLight.intensity = prev.deck;
    this.setCameraView('front');
  }

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
  }

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
  }

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

  /* ============================================================
     AUDIO STATE & REACTIVITY
     ============================================================ */
  setAudioPlaying(playerNum, isPlaying) {
    this.audioState[playerNum] = !!isPlaying;

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

      [1, 2].forEach(p => this.autoReact(p, HYPE_REACTIONS));
      this.pulse();
    } else if (soundKey === 'crowd_cheer') {
      this.triggerSmokeBlast(1.8, 0xffaa00);
      [1, 2].forEach(p => this.autoReact(p, HYPE_REACTIONS));
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
      // Contestants react to the crowd
      [1, 2].forEach(p => this.autoReact(p, ['shocked', 'nod_yes', 'laugh', 'clap']));
      // Flash stage spotlights
      if (this.stageLights.spotP1) this.stageLights.spotP1.intensity = 6.5;
      if (this.stageLights.spotP2) this.stageLights.spotP2.intensity = 6.5;
      setTimeout(() => {
        if (this.stageLights.spotP1) this.stageLights.spotP1.intensity = this.audioState[1] ? 8.0 : 3.0;
        if (this.stageLights.spotP2) this.stageLights.spotP2.intensity = this.audioState[2] ? 8.0 : 3.0;
      }, 500);
    } else if (soundKey === 'needle_drop' || soundKey === 'needle_stop') {
      this.pulse();
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
     CHARACTER UPDATE — movement, then animation layers
     (idle clip → locomotion / station → groove → move → look-at)
     ============================================================ */

  /** Arrow keys / left stick → world-space move vector, relative to the camera */
  getDriveInput(p) {
    let sx = 0;
    let sy = 0;
    let run = false;
    if (this.drivenPlayer === p) {
      const k = this.driveKeys;
      sx = (k.ArrowRight ? 1 : 0) - (k.ArrowLeft ? 1 : 0);
      sy = (k.ArrowDown ? 1 : 0) - (k.ArrowUp ? 1 : 0);
      run = !!k.Shift;
    }
    const pad = this.padInput[p];
    if (pad) {
      sx += pad.x;
      sy += pad.z;
      run = run || pad.run;
      this.padInput[p] = null;
    }
    const mag = Math.hypot(sx, sy);
    if (mag < 0.1) return null;
    if (mag > 1) { sx /= mag; sy /= mag; }

    // Camera basis on the floor plane
    const fwd = new THREE.Vector3().subVectors(this.cameraTarget, this.camera.position);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    return {
      x: right.x * sx - fwd.x * sy,
      z: right.z * sx - fwd.z * sy,
      run
    };
  }

  updateCharacterLocomotion(p, delta, elapsed) {
    const char = this.characters[p];
    const cState = this.characterStates[p];
    const anim = this.animators[p];
    if (!char || !cState || !anim) return;

    const isP1 = p === 1;
    const baseY = char.userData.baseY || 0;
    const playing = !!this.audioState[p] || !!this.audioState[isP1 ? 2 : 1];
    const opp = this.characters[isP1 ? 2 : 1];
    if (cState.facing === undefined) cState.facing = char.rotation.y;

    // Opponent direction relative to where we face (+ = on our left)
    let oppAngle = 0;
    if (opp) {
      const toOpp = Math.atan2(opp.position.x - char.position.x, opp.position.z - char.position.z);
      oppAngle = wrapAngle(toOpp - cState.facing);
    }
    const near = oppAngle >= 0 ? 'Left' : 'Right';
    const ctx = {
      beat: elapsed * (this.bpm / 60) * Math.PI * 2,
      bpm: this.bpm,
      playing,
      oppAngle,
      near,
      far: near === 'Left' ? 'Right' : 'Left'
    };

    // ---- 1. Movement ----
    const input = this.getDriveInput(p);
    let moveSpeed = 0;
    let runAmount = 0;
    if (input) {
      // Direct control overrides any walk target or station
      const speed = input.run ? RUN_SPEED : WALK_SPEED;
      const mag = Math.hypot(input.x, input.z);
      const step = speed * mag * delta;
      const next = this.constrainToStage(char.position.x + (input.x / mag) * step, char.position.z + (input.z / mag) * step);
      this.applyCharacterSeparation(p, next);
      char.position.x = next.x;
      char.position.z = next.z;
      cState.targetPos.set(next.x, 0, next.z);
      cState.facing = turnToward(cState.facing, Math.atan2(input.x, input.z), delta * 10);
      if (cState.state !== 'WALKING') {
        cState.state = 'WALKING';
        cState.currentStation = 'free';
        this.updateStageActionButtons(p, null);
      }
      cState.nextState = 'IDLE_STATION';
      cState.targetFacingAngle = null;
      cState.directControl = true;
      moveSpeed = speed * mag;
      runAmount = input.run ? 1 : 0;
      if (cState.emote && !cState.emote.move.upper) this.stopMove(p);
    } else if (cState.state === 'WALKING' && cState.directControl) {
      // Released the keys: stop where we are (snap into the deck if standing at it)
      cState.directControl = false;
      const deckX = isP1 ? -0.88 : 0.88;
      const atDeck = Math.hypot(char.position.x - deckX, char.position.z - STATIONS.deckZ) < 0.5;
      cState.state = atDeck ? 'DJ_SCRATCHING' : 'IDLE_STATION';
      if (atDeck) {
        cState.currentStation = 'deck';
        cState.targetFacingAngle = 0;
        this.updateStageActionButtons(p, 'deck');
      }
    } else if (cState.state === 'WALKING') {
      const dx = cState.targetPos.x - char.position.x;
      const dz = cState.targetPos.z - char.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.06) {
        const speed = cState.run ? RUN_SPEED : WALK_SPEED;
        const step = Math.min(dist, speed * delta);
        const next = { x: char.position.x + (dx / dist) * step, z: char.position.z + (dz / dist) * step };
        this.applyCharacterSeparation(p, next);
        char.position.x = next.x;
        char.position.z = next.z;
        cState.facing = turnToward(cState.facing, Math.atan2(dx, dz), delta * 8);
        moveSpeed = speed;
        runAmount = cState.run ? 1 : 0;
      } else if (cState.path && cState.path.length) {
        const next = cState.path.shift();
        cState.targetPos.set(next.x, 0, next.z);
      } else {
        cState.state = cState.nextState || 'IDLE_STATION';
        cState.run = false;
      }
    }

    // Settle into the station's facing when standing still
    if (cState.state !== 'WALKING' && cState.targetFacingAngle !== null && cState.targetFacingAngle !== undefined) {
      cState.facing = turnToward(cState.facing, cState.targetFacingAngle, delta * 6);
    }

    // ---- 2. Animation layers ----
    // Locomotion blend (walk ↔ run) eases in and out so starts/stops aren't snappy
    const targetMoveW = moveSpeed > 0 ? 1 : 0;
    cState.moveW = (cState.moveW || 0) + (targetMoveW - (cState.moveW || 0)) * Math.min(1, delta * 10);
    cState.runW = (cState.runW || 0) + (runAmount - (cState.runW || 0)) * Math.min(1, delta * 6);
    if (moveSpeed > 0) cState.walkPhase += delta * moveSpeed * 4.6;
    if (cState.moveW > 0.01) walkCycle(anim, cState.walkPhase, cState.runW, cState.moveW);

    const stationW = cState.state === 'DJ_SCRATCHING' ? 1 : 0;
    cState.stationW = (cState.stationW || 0) + (stationW - (cState.stationW || 0)) * Math.min(1, delta * 5);
    if (cState.stationW > 0.01) djStation(anim, elapsed, ctx, cState.stationW, isP1, !!this.audioState[p]);

    // Active / fading moves
    const emoteW = this.updateEmote(p, cState, anim, ctx, delta);
    const idleFree = cState.state === 'IDLE_STATION' && cState.moveW < 0.05;

    if (playing && idleFree) groove(anim, ctx, 1 - emoteW);

    // Idle life: an occasional fidget when nothing else is going on
    if (idleFree && !playing && !cState.emote) {
      cState.fidgetTimer = (cState.fidgetTimer ?? 5 + Math.random() * 6) - delta;
      if (cState.fidgetTimer <= 0) {
        this.playMove(p, IDLE_FIDGETS[Math.floor(Math.random() * IDLE_FIDGETS.length)], { fromUser: false });
      }
    }

    // Look-at: glance at the opponent while standing around (or the camera when selected)
    if (idleFree) {
      let look = clampAngle(oppAngle, 0.9) * 0.55;
      if (this.drivenPlayer === p) {
        const toCam = Math.atan2(this.camera.position.x - char.position.x, this.camera.position.z - char.position.z);
        look = clampAngle(wrapAngle(toCam - cState.facing), 0.9) * 0.6;
      }
      cState.look = (cState.look || 0) + (look - (cState.look || 0)) * Math.min(1, delta * 3);
      anim.head({ turn: cState.look }, 1 - emoteW);
    } else {
      cState.look = (cState.look || 0) * (1 - Math.min(1, delta * 4));
    }

    // ---- 3. Root transform ----
    char.rotation.y = cState.facing + anim.rootYaw;
    char.position.y = baseY + anim.rootLift;

    // Selection ring follows the feet
    const ring = this.selectionRings[p];
    if (ring && ring.visible) {
      ring.position.set(char.position.x, 0.02, char.position.z);
      ring.material.opacity = 0.55 + 0.25 * Math.sin(elapsed * 5);
    }
  }

  /** Advance the active and fading moves; returns the active move's weight */
  updateEmote(p, cState, anim, ctx, delta) {
    let activeW = 0;
    const fade = cState.fadingEmote;
    if (fade) {
      fade.t += delta;
      fade.stopT += delta;
      const w = fade.w0 !== undefined ? fade.w0 * (1 - fade.stopT / EMOTE_FADE_OUT) : 1 - fade.stopT / EMOTE_FADE_OUT;
      if (w <= 0) cState.fadingEmote = null;
      else fade.move.fn(anim, fade.t, ctx, w);
    }

    const e = cState.emote;
    if (!e) return 0;
    e.t += delta;
    let w = Math.min(1, e.t / EMOTE_FADE_IN);
    if (!e.move.loop && e.t >= e.move.duration - EMOTE_FADE_OUT) e.stopping = true;
    if (e.stopping) {
      e.stopT += delta;
      w *= Math.max(0, 1 - e.stopT / EMOTE_FADE_OUT);
      if (w <= 0) {
        if (e.move.mocap) this.setMocapAction(p, null);
        cState.emote = null;
        cState.fidgetTimer = 6 + Math.random() * 8;
        if (typeof this.onMoveChange === 'function') this.onMoveChange(p, null);
        return 0;
      }
    }
    e.move.fn(anim, e.t, ctx, w);
    activeW = w;
    return activeW;
  }

  /** Keep the two contestants from walking through each other */
  applyCharacterSeparation(p, next) {
    const other = this.characters[p === 1 ? 2 : 1];
    if (!other) return;
    const dx = next.x - other.position.x;
    const dz = next.z - other.position.z;
    const d = Math.hypot(dx, dz);
    const min = CHAR_RADIUS * 2.2;
    if (d < min && d > 0.0001) {
      next.x = other.position.x + (dx / d) * min;
      next.z = other.position.z + (dz / d) * min;
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
      this.animators[p]?.beginFrame(delta);
    });

    // 2. Playable DJ controller (vinyl, pads, knobs, faders follow the audio)
    this.deckControls?.update(delta, elapsed);

    // 3. Character Locomotion & DJ Console Interaction
    [1, 2].forEach(p => {
      this.updateCharacterLocomotion(p, delta, elapsed);
      this.animators[p]?.endFrame();
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

    // 5. Cryogenic Smoke Cannons Update + reveal confetti
    this.updateSmoke(delta);
    this.updateConfetti(delta);

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
    if (!this.isDragging && this.cameraMode !== 'decks') {
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
    const desiredTargetX = this.cameraMode === 'decks' ? 0 : (this.audioState[1] && !this.audioState[2])
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
    this.resizeObserver?.disconnect();
    if (this.renderer) this.renderer.dispose();
  }
}

export { DJControllerRenderer };
