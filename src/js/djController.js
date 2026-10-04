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
import { loadModel } from './modelLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CharacterAnimator } from './characterAnimator.js';
import { StageArena } from './stageArena.js';
import { addRimLight } from './rimLight.js';
import { MocapLibrary, MocapRig } from './mocap.js';
import { FightDirector } from './fightDirector.js';
import { CAST_BY_KEY } from './fightCast.js';
import { StageBuildMixin } from './stageBuild.js';
import { RevealMixin } from './revealDirector.js';
import { STAGE_RADIUS, TABLE_HALF_X, TABLE_HALF_Z, CHAR_RADIUS, STATIONS, WALK_SPEED, RUN_SPEED, EMOTE_FADE_IN, EMOTE_FADE_OUT, wrapAngle, clampAngle, turnToward } from './stageLayout.js';
import {
  MOVES_BY_ID, TAUNT_REACTIONS, HYPE_REACTIONS, IDLE_FIDGETS, walkCycle, djStation, groove, registerMove
} from './characterMoves.js';

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
    this.mocap = new MocapLibrary();  // Mixamo clips (public/models/animations)
    this.rigs = { 1: null, 2: null };  // per-character MocapRig
    this.fight = new FightDirector(this);
    this.timeScale = 1;                // slow motion / hit-stop (fight director)
    this.cameraOverride = null;        // (camPos, target) => void — a director owns the camera
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
    this.scene.background = new THREE.Color(0x07070d);
    this.scene.fog = new THREE.FogExp2(0x0b0a14, 0.03);

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
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Soft studio reflections so the metal deck, speakers and stage floor read as metal
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.22;
    pmrem.dispose();

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

    // 10. Arena: truss + beams, lasers, LED floor, tiered crowd, haze — plus camera flashes
    this.arena = new StageArena(this.scene, { quality: this.qualityPreset });
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
     CONTESTANT 3D CHARACTERS (4 FBX MODELS WITH SKELETAL IDLE)
     ============================================================ */
  loadCharacters() {
    const basePath = '/models/characters/';
    const characterList = [
      { key: 'black_male', file: 'black_male.glb' },
      { key: 'black_female', file: 'black_female.glb' },
      { key: 'white_male', file: 'white_male.glb' },
      { key: 'white_female', file: 'white_female.glb' }
    ];

    let loadedCount = 0;
    characterList.forEach(({ key, file }) => {
      loadModel(basePath + file).then(
        (object) => {
          this.setupCharacterMaterials(object);
          this.loadedFbxCache[key] = object;
          loadedCount++;
          this.markLoaded(key);

          // If current selection matches this avatar, spawn immediately
          if (this.currentAvatars[1] === key) this.spawnContestant(1, key);
          if (this.currentAvatars[2] === key) this.spawnContestant(2, key);

          if (loadedCount === characterList.length) {
            this.checkAllLoaded();
          }
        },
        (err) => {
          console.warn(`Note on loading character ${key}:`, err);
          loadedCount++;
          this.markLoaded(key);
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

    // Own materials per contestant, with a rim glow in their colour so dark outfits stay visible
    const rimColor = this.playerColors?.[playerNum] || (playerNum === 1 ? 0xff4a4a : 0x2ee8ff);
    char.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const own = (m) => {
        const c = m.clone();
        addRimLight(c, { color: rimColor, strength: 0.9, power: 2.6 });
        return c;
      };
      child.material = Array.isArray(child.material) ? child.material.map(own) : own(child.material);
    });

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

    // Animation mixer (with the model's embedded idle as a fallback until mocap loads)
    const mixer = new THREE.AnimationMixer(char);
    this.mixers[playerNum] = mixer;
    this.idleActions[playerNum] = null;
    const embedded = (template.animations || []).find(c => c.tracks.length);
    if (embedded) {
      const action = mixer.clipAction(embedded);
      action.setEffectiveTimeScale(1.0);
      action.play();
      this.idleActions[playerNum] = action;
    }
    this.animators[playerNum] = new CharacterAnimator(char, this.mixers[playerNum]);
    char.updateMatrixWorld(true);
    this.rigs[playerNum] = new MocapRig(char, mixer, this.mocap, this.idleActions[playerNum]);
  }

  /** The playing deck's beat (from the track analysis), shared by the crowd and dancers */
  updateBeat() {
    const ap = this.audioPlayer;
    let bt = null;
    if (ap?.getBeat) {
      const playing = [1, 2].filter(n => ap.isPlaying(n));
      const n = playing.length === 1 ? playing[0] : playing.length ? (ap.crossfade < 0.5 ? 1 : 2) : null;
      if (n) bt = ap.getBeat(n);
    }
    this.beatNow = bt;
    if (bt) this.bpm = bt.bpm;
  }

  /** Dance clips follow the track: matched tempo, and the hip drop nudged onto the kick */
  syncDances() {
    const bt = this.beatNow;
    [1, 2].forEach(p => {
      const o = this.rigs[p]?.oneShot;
      if (!o || o.stopping) return;
      const cat = o.a.entry?.category;
      if (cat !== 'dance' && cat !== 'breaking') return;
      const clipBpm = o.a.rm.danceBpm;
      const action = o.a.action;
      if (!clipBpm) return;
      if (!bt) { action.timeScale += (1 - action.timeScale) * 0.05; return; }
      let r = bt.bpm / clipBpm;
      while (r > 1.45) r /= 2;
      while (r < 0.72) r *= 2;
      const k = (r * clipBpm) / bt.bpm;          // clip beats per track beat (≈ 0.5, 1 or 2)
      const clipBeats = (action.time * clipBpm) / 60 - (o.a.rm.danceOffset || 0);
      const want = bt.beats * k;
      let diff = (want - clipBeats) % 1;
      if (diff > 0.5) diff -= 1;
      if (diff < -0.5) diff += 1;
      action.timeScale = r * (1 + THREE.MathUtils.clamp(diff * 0.6, -0.1, 0.1));
    });
  }

  /** A contestant's signature colour on their rim light (null = the P1 red / P2 cyan default) */
  setPlayerColor(playerNum, color) {
    this.playerColors = this.playerColors || {};
    this.playerColors[playerNum] = color || null;
    const char = this.characters[playerNum];
    if (!char) return;
    const c = new THREE.Color(color || (playerNum === 1 ? 0xff4a4a : 0x2ee8ff));
    char.traverse(n => {
      if (!n.isMesh) return;
      (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => m?.userData?.rim?.uRimColor.value.copy(c));
    });
  }

  /**
   * Called by UI to switch avatar (any fighter in the cast)
   */
  setPlayerAvatar(playerNum, key) {
    if (key === 'male') key = 'white_male';
    if (key === 'female') key = 'black_female';
    if (!CAST_BY_KEY[key]) return Promise.resolve(false);

    this.currentAvatars[playerNum] = key;
    if (this.loadedFbxCache[key]) {
      this.spawnContestant(playerNum, key);
      return Promise.resolve(true);
    }
    return this.ensureAvatar(key).then(ok => {
      // Only spawn if this is still the wanted avatar (the user may have clicked on)
      if (ok && this.currentAvatars[playerNum] === key) this.spawnContestant(playerNum, key);
      return ok;
    });
  }

  /** Load a cast model on demand (the four originals load at startup) */
  ensureAvatar(key) {
    if (this.loadedFbxCache[key]) return Promise.resolve(true);
    this._avatarLoads = this._avatarLoads || {};
    if (this._avatarLoads[key]) return this._avatarLoads[key];
    const entry = CAST_BY_KEY[key];
    if (!entry) return Promise.resolve(false);
    this._avatarLoads[key] = new Promise(resolve => {
      loadModel(entry.file).then((object) => {
        this.setupCharacterMaterials(object);
        this.loadedFbxCache[key] = object;
        resolve(true);
      }, (err) => {
        console.warn('Could not load fighter', key, err);
        delete this._avatarLoads[key];
        resolve(false);
      });
    });
    return this._avatarLoads[key];
  }

  /**
   * Motion-capture library (public/models/animations/manifest.json). Locomotion
   * clips load first, then everything else in the background; every non-base clip
   * joins the move library so it shows up in the docks.
   */
  async loadMocapMoves() {
    const ok = await this.mocap.init();
    if (!ok) { this.markLoaded('mocap'); return; }
    const entries = this.mocap.entries;
    entries.filter(e => e.category !== 'base' && e.category !== 'paired').forEach(entry => {
      registerMove({
        id: entry.id,
        label: entry.label,
        icon: entry.icon,
        category: entry.category,
        loop: !!entry.loop,
        duration: 9999, // the rig ends it when the clip finishes
        mocap: true,
        fn() {}
      });
    });
    if (typeof this.onMovesChanged === 'function') this.onMovesChanged();
    const first = ['mx_idle', 'mx_walk', 'mx_run', 'mx_fight_idle', 'mx_turn_left_90', 'mx_turn_right_90',
      'mx_turn_left_180', 'mx_turn_right_180', 'mx_walk_turn_180', 'mx_run_turn_180', 'mx_walk_back',
      'mx_idle_weight_shift', 'mx_idle_look1'];
    await this.mocap.preload(first, 4);
    this.mocapReady = true;
    this.markLoaded('mocap');
    this.trackClipLoading();
    this.mocap.preload(entries.map(e => e.id), 3);
  }

  /** Start (or stop, with moveId null) a mocap move on a character's rig */
  setMocapAction(playerNum, moveId) {
    const rig = this.rigs[playerNum];
    if (!rig) return;
    if (!moveId) {
      rig.stop();
      return;
    }
    const entry = this.mocap.byId[moveId];
    const cState = this.characterStates[playerNum];
    cState.pendingChain = null;
    if (entry?.floor && !entry.loop) {
      // Stay down on the floor, then get back up (timed in game time)
      rig.play(moveId, {
        hold: true,
        onFinish: () => {
          if (entry.then && !cState.fighting) cState.pendingChain = { id: entry.then, at: this.clock.elapsedTime + 0.9 };
        }
      });
      return;
    }
    rig.play(moveId, {
      onEnd: () => {
        const cState = this.characterStates[playerNum];
        if (cState.emote?.move.id === moveId) {
          cState.emote = null;
          cState.fidgetTimer = 6 + Math.random() * 8;
          if (typeof this.onMoveChange === 'function') this.onMoveChange(playerNum, null);
          if (entry?.then && !cState.fighting) cState.pendingChain = { id: entry.then, at: this.clock.elapsedTime + 0.2 };
        }
      }
    });
  }

  /**
   * Startup progress: the overlay stays up (with a real progress bar) until the
   * deck, the four contestants and the core motion set are in.
   */
  markLoaded(key) {
    if (!this._loading) setTimeout(() => this.hideLoading(), 25000);   // never trap the app behind a stuck asset
    const L = (this._loading = this._loading || { need: ['deck', 'black_male', 'black_female', 'white_male', 'white_female', 'mocap'], done: new Set() });
    if (key) L.done.add(key);
    const n = L.need.filter(k => L.done.has(k)).length;
    const fill = document.getElementById('dj-loading-fill');
    const text = document.getElementById('dj-loading-text');
    if (fill) fill.style.transform = `scaleX(${n / L.need.length})`;
    const next = L.need.find(k => !L.done.has(k));
    const names = { deck: 'DJ deck', mocap: 'motion capture', black_male: 'contestants', black_female: 'contestants', white_male: 'contestants', white_female: 'contestants' };
    if (text && next) text.textContent = `Loading ${names[next] || next}… ${Math.round((n / L.need.length) * 100)}%`;
    if (n >= L.need.length) this.hideLoading();
  }

  hideLoading() {
    const loadingOverlay = document.getElementById('dj-loading');
    if (loadingOverlay && !loadingOverlay.classList.contains('hidden')) {
      loadingOverlay.classList.add('hidden');
      setTimeout(() => { loadingOverlay.style.display = 'none'; }, 400);
    }
  }

  checkAllLoaded() {
    // (kept for older call sites: the deck finishing counts as one step)
    this.markLoaded('deck');
  }

  /** Small corner pill while the rest of the move library streams in */
  trackClipLoading() {
    const total = this.mocap.entries.length;
    let pill = document.getElementById('asset-pill');
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'asset-pill';
      pill.className = 'asset-pill';
      pill.setAttribute('role', 'status');
      document.body.appendChild(pill);
    }
    const update = () => {
      const n = Object.keys(this.mocap.data).length;
      pill.textContent = `Loading moves ${n}/${total}`;
      pill.classList.toggle('done', n >= total);
      if (n >= total) setTimeout(() => pill.remove(), 1500);
    };
    this.mocap.onLoaded(update);
    update();
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
      this.arena?.cheer(2);
      this.pulse();
    } else if (soundKey === 'crowd_cheer') {
      this.triggerSmokeBlast(1.8, 0xffaa00);
      this.arena?.cheer(3);
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
    } else if (soundKey === 'crowd_react') {
      this.arena?.cheer(1.5);
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
      beat: this.beatNow ? this.beatNow.beats * Math.PI * 2 : elapsed * (this.bpm / 60) * Math.PI * 2,
      bpm: this.bpm,
      style: isP1 ? 0 : 1, // each contestant grooves a little differently
      playing,
      oppAngle,
      near,
      far: near === 'Left' ? 'Right' : 'Left'
    };

    // ---- 1. Movement ----
    const input = cState.fighting ? null : this.getDriveInput(p);
    const rig = this.rigs[p];
    const turning = elapsed < (cState.turnUntil || 0);
    if (cState.state !== 'WALKING' || input) cState.backpedal = false;
    let moveSpeed = 0;
    let runAmount = 0;
    if (cState.fighting) {
      // positions and moves come from the fight director
    } else if (input) {
      // Direct control overrides any walk target or station
      const speed = input.run ? RUN_SPEED : WALK_SPEED;
      const mag = Math.hypot(input.x, input.z);
      const step = speed * mag * delta;
      const next = this.constrainToStage(char.position.x + (input.x / mag) * step, char.position.z + (input.z / mag) * step);
      this.applyCharacterSeparation(p, next);
      char.position.x = next.x;
      char.position.z = next.z;
      cState.targetPos.set(next.x, 0, next.z);
      const want = Math.atan2(input.x, input.z);
      const diff = wrapAngle(want - cState.facing);
      if (!turning && !(Math.abs(diff) > 2.3 && this.startTurn(p, diff, true, input.run ? 1 : 0))) {
        cState.facing = turnToward(cState.facing, want, delta * 10);
      }
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
        const speed = cState.backpedal ? 1.1 : (cState.run ? RUN_SPEED : WALK_SPEED);
        const step = Math.min(dist, speed * delta);
        const next = { x: char.position.x + (dx / dist) * step, z: char.position.z + (dz / dist) * step };
        this.applyCharacterSeparation(p, next);
        char.position.x = next.x;
        char.position.z = next.z;
        const want = Math.atan2(dx, dz);
        const diff = wrapAngle(want - cState.facing);
        // A short step back: back-pedal, keep facing forward
        cState.backpedal = Math.abs(diff) > 2.4 && dist < 1.3 && !(cState.path && cState.path.length) && !!rig && rig.ready('mx_walk_back');
        if (cState.backpedal) {
          moveSpeed = Math.min(speed, 1.1);
        } else if (!turning && !(Math.abs(diff) > 2.3 && this.startTurn(p, diff, true, cState.run ? 1 : 0))) {
          cState.facing = turnToward(cState.facing, want, delta * 8);
        }
        if (!cState.backpedal) moveSpeed = speed;
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
    if (!cState.fighting && cState.state !== 'WALKING' && cState.targetFacingAngle !== null && cState.targetFacingAngle !== undefined && !turning) {
      const diff = wrapAngle(cState.targetFacingAngle - cState.facing);
      if (!(Math.abs(diff) > 0.8 && !cState.emote && this.startTurn(p, diff, false))) {
        cState.facing = turnToward(cState.facing, cState.targetFacingAngle, delta * 6);
      }
    }

    // ---- 2. Animation layers ----
    // Locomotion blend (walk ↔ run) eases in and out so starts/stops aren't snappy
    const targetMoveW = moveSpeed > 0 ? 1 : 0;
    cState.moveW = (cState.moveW || 0) + (targetMoveW - (cState.moveW || 0)) * Math.min(1, delta * 10);
    cState.runW = (cState.runW || 0) + (runAmount - (cState.runW || 0)) * Math.min(1, delta * 6);
    if (moveSpeed > 0) cState.walkPhase += delta * moveSpeed * 4.6;
    const mocapWalk = rig && rig.ready('mx_walk');
    if (cState.moveW > 0.01 && !mocapWalk) walkCycle(anim, cState.walkPhase, cState.runW, cState.moveW);
    if (rig && !cState.fighting) {
      rig.setLocomotion(moveSpeed * cState.moveW, cState.runW, { back: cState.backpedal && moveSpeed > 0 ? 1 : 0 });
      const moving = moveSpeed > 0;
      if (!cState.fighting && mocapWalk && !cState.emote && !turning && !cState.backpedal) {
        if (moving && !cState.wasMoving && cState.runW < 0.5 && rig.ready('mx_walk_start')) {
          // First steps: lean in and push off, then the walk cycle takes over
          rig.play('mx_walk_start', { from: 0.15, to: 0.95, rootMotion: false, fadeIn: 0.1, fadeOut: 0.3, timeScale: 1.25 });
        } else if (!moving && cState.wasMoving && cState.lastMoveSpeed > 0.5) {
          const fromRun = cState.lastRunW > 0.5;
          const id = fromRun ? 'mx_run_stop' : 'mx_walk_stop';
          if (rig.ready(id)) rig.play(id, fromRun ? { from: 0.25, rootMotion: false, fadeIn: 0.1, fadeOut: 0.35 } : { from: 1.75, rootMotion: false, fadeIn: 0.12, fadeOut: 0.4 });
        }
      }
      cState.wasMoving = moving;
      if (moving) { cState.lastMoveSpeed = moveSpeed; cState.lastRunW = cState.runW; }
    }

    const stationW = cState.state === 'DJ_SCRATCHING' ? 1 : 0;
    cState.stationW = (cState.stationW || 0) + (stationW - (cState.stationW || 0)) * Math.min(1, delta * 5);
    if (cState.stationW > 0.01) djStation(anim, elapsed, ctx, cState.stationW, isP1, !!this.audioState[p]);

    // Active / fading moves
    const emoteW = this.updateEmote(p, cState, anim, ctx, delta);
    const idleFree = !cState.fighting && cState.state === 'IDLE_STATION' && cState.moveW < 0.05;

    if (playing && idleFree) groove(anim, ctx, 1 - emoteW);

    // Idle life: an occasional fidget when nothing else is going on
    if (idleFree && !playing && !cState.emote && !(rig && rig.ready('mx_idle'))) {
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

    if (cState.pendingChain && elapsed >= cState.pendingChain.at && !cState.fighting) {
      const next = cState.pendingChain.id;
      cState.pendingChain = null;
      this.playMove(p, next, { fromUser: false });
    }

    // Root motion: falls, steps and turns in the clips really move/turn the character
    if (rig) {
      const rm = rig.postUpdate(cState.facing);
      if (rm.dx || rm.dz) {
        const next = cState.fighting
          ? this.constrainToFightArea(char.position.x + rm.dx, char.position.z + rm.dz)
          : this.constrainToStage(char.position.x + rm.dx, char.position.z + rm.dz);
        char.position.x = next.x;
        char.position.z = next.z;
        if (!cState.fighting && cState.state !== 'WALKING') cState.targetPos.set(next.x, 0, next.z);
      }
      cState.facing += rm.dyaw;
    }

    // ---- 3. Root transform ----
    char.rotation.y = cState.facing + anim.rootYaw;
    char.position.y = baseY + anim.rootLift + (cState.fightLift || 0);
    // Weight shifts slide the body a few cm; undo last frame's slide so it never accumulates
    const f = cState.facing;
    const sx = anim.rootShiftX * Math.cos(f) + anim.rootShiftZ * Math.sin(f);
    const sz = -anim.rootShiftX * Math.sin(f) + anim.rootShiftZ * Math.cos(f);
    const prevShift = cState.rootShift || { x: 0, z: 0 };
    char.position.x += sx - prevShift.x;
    char.position.z += sz - prevShift.z;
    cState.rootShift = { x: sx, z: sz };

    // Selection ring follows the feet
    const ring = this.selectionRings[p];
    if (ring && ring.visible) {
      ring.position.set(char.position.x, 0.02, char.position.z);
      ring.material.opacity = 0.55 + 0.25 * Math.sin(elapsed * 5);
    }
  }

  /**
   * Turn with a real turning clip: on the spot (90 / 180) or a U-turn while moving.
   * The clip's own rotation is scaled so the character ends exactly on `diff`.
   */
  startTurn(p, diff, moving, run = 0) {
    const rig = this.rigs[p];
    const cState = this.characterStates[p];
    if (!rig || cState.fighting) return false;
    const id = moving
      ? (run > 0.5 ? 'mx_run_turn_180' : 'mx_walk_turn_180')
      : Math.abs(diff) > 2.2 ? (diff > 0 ? 'mx_turn_left_180' : 'mx_turn_right_180')
        : (diff > 0 ? 'mx_turn_left_90' : 'mx_turn_right_90');
    if (!rig.ready(id)) return false;
    const clipTurn = this.mocap.get(id).rm.turn;
    if (Math.abs(clipTurn) < 0.3) return false;
    // Turn the same way the clip does (a U-turn can go either way round)
    let target = diff;
    if (Math.sign(target) !== Math.sign(clipTurn)) target -= Math.sign(target) * Math.PI * 2;
    const yawScale = target / clipTurn;
    if (yawScale < 0.25 || yawScale > 2.2) return false;
    const dur = this.mocap.get(id).clip.duration;
    cState.turnUntil = this.clock.elapsedTime + dur * 0.92;
    rig.play(id, { rootMotion: true, rmScale: moving ? 0 : 1, yawScale, fadeIn: 0.12, fadeOut: 0.25, timeScale: moving ? 1.15 : 1.1 });
    return true;
  }

  /** Keep fighters on the stage floor (no table avoidance: the fight is downstage) */
  constrainToFightArea(x, z) {
    const r = Math.hypot(x, z);
    const max = STAGE_RADIUS + 1.2;
    if (r > max) return { x: (x / r) * max, z: (z / r) * max };
    return { x, z: Math.max(z, 0.85) };
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

    const realDelta = this.clock.getDelta();
    this.fight?.update(realDelta);
    this.fightGame?.update(realDelta);
    const delta = realDelta * (this.timeScale ?? 1);
    this.updateBeat();
    this.syncDances();
    const elapsed = this.clock.getElapsedTime();

    // 1. Update Skeletal Animation Mixers (Breathing Idle)
    [1, 2].forEach(p => {
      this.rigs[p]?.preUpdate(delta);
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
    const bt = this.beatNow;
    const beatPhase = bt ? bt.beats * Math.PI * 2 : elapsed * (this.bpm / 60) * Math.PI * 2;

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
    this.arena?.update(delta, elapsed, {
      playing: !!isAnyPlaying,
      active1: this.audioState[1],
      active2: this.audioState[2],
      bass: realBass ?? (isAnyPlaying ? Math.pow(Math.max(0, Math.sin(beatPhase)), 4) * 0.6 : 0),
      highs: (analysis && analysis.isPlaying) ? analysis.highEnergy : (isAnyPlaying ? 0.3 : 0),
      beat: beatPhase,
      chars: [null, this.characters[1]?.position || null, this.characters[2]?.position || null],
      reducedMotion: this.reducedMotion,
      noFlash: this.noFlash
    });
    this.updateFollowLights();

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

    // Directed cameras get down among the pit crowd: keep fans out of the lens
    if (this.arena) this.arena.clearZone = this.cameraOverride ? this.camera.position : null;
    if (this.cameraOverride && !this.isDragging) {
      this._overrideTarget = this._overrideTarget || new THREE.Vector3();
      this.cameraOverride(this.desiredCamPos, this._overrideTarget);
      this.currentCamPos.lerp(this.desiredCamPos, 0.08);
      this.camera.position.copy(this.currentCamPos);
      this.cameraTarget.lerp(this._overrideTarget, 0.12);
      this.camera.lookAt(this.cameraTarget);
    } else {
      // Smooth camera damping
      this.currentCamPos.lerp(this.desiredCamPos, 0.06);
      this.camera.position.copy(this.currentCamPos);

      // Look target follows active contestant slightly
      const desiredTargetX = this.cameraMode === 'decks' ? 0 : (this.audioState[1] && !this.audioState[2])
        ? -0.6
        : ((this.audioState[2] && !this.audioState[1]) ? 0.6 : 0);
      this.cameraTarget.x += (desiredTargetX - this.cameraTarget.x) * 0.05;
      this.camera.lookAt(this.cameraTarget);
    }

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

  setJumbotronData(data) {
    const clean = Object.fromEntries(Object.entries(data || {}).filter(([, v]) => v !== undefined));
    this.jumbotronData = { ...(this.jumbotronData || {}), ...clean };
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
    this.arena?.setQuality(preset);
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

Object.assign(DJControllerRenderer.prototype, StageBuildMixin, RevealMixin);

export { DJControllerRenderer };
