# BeatBattle 3D Scoring App — "Who Want That Smoke" League

[![Vite](https://img.shields.io/badge/Vite-6.x-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Three.js](https://img.shields.io/badge/Three.js-0.160+-black?logo=three.js)](https://threejs.org/)
[![Web Audio API](https://img.shields.io/badge/Web_Audio-Synthesizer-orange)](#procedural-battle-beats)
[![Gamepad API](https://img.shields.io/badge/Controller-PS5_%7C_Xbox_%7C_Switch-green)](#gamepad--controller-support)

A high-octane 3D esports and competitive music production battle arena scoring application built for **Who Want That Smoke (WWTS)** league championships. Features real-time 3D soundstages, interactive DJ decks with spinning vinyl and scratching avatars, procedural battle beats, live 5-axis head-to-head radar charts, a 3-Judge panel scoring system with split/unanimous decision detection, Best-of-3 multi-round tournaments, and clean broadcast mode for OBS Studio streamers.

---

## 🌟 Key Features

### 🎧 3D Soundstage Arena & DJ Console
- **Horizontal 3D DJ Console (`SM_DJ_Controller.fbx`)**: Positioned flat and wide across the DJ booth with dual spinning vinyl platters, tracking tonearms, and an interactive mixer console.
- **Procedural Character Locomotion**: 4 selectable rigged avatars (Black Male/Female, White Male/Female) with natural walk cycles (knee flex, hip bounce, arm counter-swing, and shortest-path orientation).
- **Interactive DJ Scratching & Dance**: Send contestants to the DJ booth via `🎛️ Scratch & Mix` to scrub vinyl and tweak knobs, or click anywhere on the 3D stage floor to walk.
- **Arena Atmosphere**: 18 animated front-row crowd silhouettes bobbing in tempo, 4 random stadium camera flashbulbs, subwoofers with kick drum excursion, and cryogenic CO2 smoke blast cannons.
- **Cinematic Director Camera**: Instant angle switching between Spectator, DJ POV, Drone Overhead, Face-Off, and Auto-Cut.

### 👥 3-Judge Panel & Sudden Death Overtime
- **3-Judge Panel Mode**: Toggle between Solo judging and an official 3-Judge panel with independent scorecards for **Judge 1 (Red)**, **Judge 2 (Cyan)**, and **Judge 3 (Gold)**.
- **One-Click Auto-Vary (`🎲 Auto-Vary`)**: Generates realistic, nuanced score variations (±0.3 to ±0.8) for Judges 2 & 3 based on Judge 1.
- **Consensus Decision Engine**: Real-time evaluation of judge verdicts:
  - 🏆 **UNANIMOUS DECISION (3 - 0)**
  - ⚖️ **SPLIT DECISION (2 - 1)**
  - 🤝 **MAJORITY DRAW / TIE**
- **Sudden Death Overtime (`⚡ OT`)**: Automatic or manual tie-breaker round with 60-second countdown, warning sirens, and neon crimson strobe smoke blasts.
- **Best-of-3 Battle Series**: Per-round scoring for Round 1, Round 2, Final Round, and OT with series scoreboards and win tallies.

### 🎙️ Studio Announcer & DJ Soundboard
- **134-Clip Announcer Voice Pack**: Authentic fighting-game style announcements (*"Round 1... FIGHT!"*, *"TIME'S UP!"*, *"WINNER!"*, *"KNOCKOUT!"*, and hype lines like *"THEY'RE ON FIRE!"* and *"IT'S ALL ON THE LINE!"*).
- **DJ Battle Soundboard**: Instant pad triggers for Airhorns, Boxing Bells, Crowd Oohs/Aahhs, Crowd Cheers, Needle Drops, and Stop Scratches.

### 📊 Live Radar Chart & 1080×1080 Scorecard Exporter
- **5-Axis Head-to-Head Radar Chart**: Real-time cyber spider chart morphing live as sliders adjust (Originality, Rhythm/Flow, Sound Design, Mix Quality, Crowd Impact).
- **One-Click 1080×1080 Broadcast PNG Exporter**: Downloads crisp, social-media ready scorecards with verified league watermarks, bilateral category bars, decision badges, and winner graphics.

### 🎮 Modern Controller Support (PlayStation, Xbox, Nintendo Switch)
- Plug-and-play controller support via HTML5 Gamepad API with low-latency polling and dual-motor haptic rumble feedback.
- Interactive mapping guide and live diagnostic overlay accessible via the header badge.

### ⌨️ Universal Keyboard Shortcuts
- `Space`: Timer Play / Pause
- `Enter`: Submit Battle & Lock Scores
- `R`: Reset Scores & Round
- `1` – `4`: Switch between Round 1, 2, 3, or Sudden Death OT
- `J`: Cycle Judges (1 ➔ 2 ➔ 3)
- `M`: Toggle OBS Clean Stream Broadcast Mode
- `C`: Blast Cryogenic Stage Smoke Cannons
- `H`: Announcer Fight Hype Call
- `S`: Vinyl Scratch Audio FX
- `D`: Send DJs to Console to Mix
- `?`: Toggle Keyboard Shortcuts Cheat Sheet Modal

---

## 🚀 Quickstart

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- npm or yarn

### Installation
```bash
# Clone the repository
git clone https://github.com/DocDamage/wwts-3d.git
cd wwts-3d

# Install dependencies
npm install

# Start local development server
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🛠️ Tech Stack
- **Engine**: Three.js (WebGL 3D rendering)
- **Tooling**: Vite (fast HMR dev server)
- **Audio**: Web Audio API (procedural synthesis & vinyl scratching)
- **Input**: Gamepad API & Keyboard Event Manager
- **Styling**: Vanilla CSS (Cyberpunk neon dark mode design system)

---

## 📄 License
MIT License. Created for the **Who Want That Smoke (WWTS)** BeatBattle League.
