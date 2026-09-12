/**
 * Modern Gamepad Manager — Full Controller Support
 * Supports:
 * - PlayStation (DualShock 4, DualSense PS5)
 * - Xbox (Xbox One, Series X|S, 360, Wireless)
 * - Nintendo Switch (Pro Controller, Joy-Cons)
 * - Generic USB/Bluetooth controllers (Standard Gamepad API)
 *
 * Capabilities:
 * - Dual-motor haptic rumble vibration feedback
 * - Analog right stick 3D stage camera orbiting
 * - Analog left stick real-time character walking locomotion
 * - Face buttons mapped to DJ Soundboard FX (Horn, Bell, React, Cheer)
 * - Shoulder bumpers & triggers for Deck Play/Pause, Needle Drop, and DJ Scratch
 * - D-Pad & Menu buttons for Timer Start/Pause and Stage Navigation
 * - Real-time connection detection and visual mapping HUD
 */

class GamepadManager {
  constructor() {
    this.controllers = {};
    this.activeGamepadIndex = null;
    this.pollInterval = null;
    this.previousButtonStates = {};
    this.controllerType = 'generic'; // 'playstation', 'xbox', 'nintendo', 'generic'
    this.controllerName = 'No Controller';
    this.hasHaptics = false;

    // External subsystem references
    this.djController = null;
    this.soundboard = null;
    this.audio = null;
    this.timer = null;

    // Deadzone for analog thumbsticks
    this.deadzone = 0.15;

    // Callbacks
    this.onStatusChange = null;
    this.onButtonPress = null;
  }

  init({ djController, soundboard, audio, timer }) {
    this.djController = djController;
    this.soundboard = soundboard;
    this.audio = audio;
    this.timer = timer;

    // Gamepad Connection Event Listeners
    window.addEventListener('gamepadconnected', (e) => {
      this.handleConnected(e.gamepad);
    });

    window.addEventListener('gamepaddisconnected', (e) => {
      this.handleDisconnected(e.gamepad);
    });

    // Check if a gamepad is already connected at load time
    this.checkInitialGamepads();

    // Start continuous polling loop for responsive low-latency input
    this.startPolling();
  }

  checkInitialGamepads() {
    if (typeof navigator.getGamepads === 'function') {
      const gamepads = navigator.getGamepads();
      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) {
          this.handleConnected(gamepads[i]);
          break;
        }
      }
    }
  }

  handleConnected(gamepad) {
    this.activeGamepadIndex = gamepad.index;
    this.identifyController(gamepad);
    this.hasHaptics = !!(gamepad.vibrationActuator && typeof gamepad.vibrationActuator.playEffect === 'function');

    // Welcome haptic greeting
    this.rumble(250, 0.4, 0.6);

    this.updateIndicatorUI(true);
    if (typeof this.onStatusChange === 'function') {
      this.onStatusChange({ connected: true, type: this.controllerType, name: this.controllerName });
    }
  }

  handleDisconnected(gamepad) {
    if (this.activeGamepadIndex === gamepad.index) {
      this.activeGamepadIndex = null;
      this.controllerName = 'Disconnected';
      this.updateIndicatorUI(false);

      if (typeof this.onStatusChange === 'function') {
        this.onStatusChange({ connected: false });
      }
    }
  }

  /**
   * Identifies brand/layout: PlayStation, Xbox, Nintendo Switch, or Generic
   */
  identifyController(gamepad) {
    const id = (gamepad.id || '').toLowerCase();

    if (id.includes('playstation') || id.includes('dualshock') || id.includes('dualsense') || id.includes('054c') || id.includes('sony')) {
      this.controllerType = 'playstation';
      this.controllerName = id.includes('dualsense') ? 'PS5 DualSense Controller' : 'PlayStation Controller';
    } else if (id.includes('xbox') || id.includes('x-box') || id.includes('045e') || id.includes('microsoft')) {
      this.controllerType = 'xbox';
      this.controllerName = 'Xbox Wireless Controller';
    } else if (id.includes('nintendo') || id.includes('switch') || id.includes('joy-con') || id.includes('pro controller') || id.includes('057e')) {
      this.controllerType = 'nintendo';
      this.controllerName = 'Nintendo Switch Controller';
    } else {
      this.controllerType = 'generic';
      this.controllerName = gamepad.id ? gamepad.id.split('(')[0].trim() : 'Standard Gamepad';
    }
  }

  startPolling() {
    let lastTime = performance.now();

    const poll = (time) => {
      const delta = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      this.update(delta);
      requestAnimationFrame(poll);
    };

    requestAnimationFrame(poll);
  }

  update(delta) {
    if (this.activeGamepadIndex === null) {
      // Periodic re-check for gamepads that connect after page load
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) {
          this.handleConnected(gamepads[i]);
          break;
        }
      }
      return;
    }

    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = gamepads[this.activeGamepadIndex];
    if (!pad) return;

    // 1. Process Analog Thumbsticks
    this.processAnalogSticks(pad, delta);

    // 2. Process Digital & Trigger Buttons
    this.processButtons(pad);
  }

  processAnalogSticks(pad, delta) {
    if (!pad.axes || pad.axes.length < 2) return;

    // LEFT STICK: Steer / Walk active contestant across the soundstage
    const lx = pad.axes[0];
    const ly = pad.axes[1];
    if (Math.hypot(lx, ly) > this.deadzone && this.djController) {
      const activePlayer = this.audio?.isPlaying(2) && !this.audio?.isPlaying(1) ? 2 : 1;
      this.djController.moveCharacterDirect(activePlayer, lx, ly, delta);
    }

    // RIGHT STICK: Orbit & Tilt 3D Stage Camera
    if (pad.axes.length >= 4) {
      const rx = pad.axes[2];
      const ry = pad.axes[3];
      if (Math.hypot(rx, ry) > this.deadzone && this.djController) {
        const orbitSpeed = 1.8;
        this.djController.orbitCameraDelta(-rx * orbitSpeed * delta, ry * orbitSpeed * delta);
      }
    }
  }

  processButtons(pad) {
    if (!pad.buttons) return;

    const currentButtons = {};

    pad.buttons.forEach((btn, index) => {
      const isPressed = typeof btn === 'object' ? btn.pressed : btn > 0.5;
      currentButtons[index] = isPressed;

      const wasPressed = !!this.previousButtonStates[index];

      // Just pressed (edge-triggered)
      if (isPressed && !wasPressed) {
        this.handleButtonDown(index);
      }

      // Just released
      if (!isPressed && wasPressed) {
        this.handleButtonUp(index);
      }
    });

    this.previousButtonStates = currentButtons;
  }

  handleButtonDown(btnIndex) {
    // Notify button visualizer in UI
    this.highlightGamepadButtonUI(btnIndex, true);

    switch (btnIndex) {
      // -------------------------------------------------------------
      // FACE BUTTONS -> DJ SOUNDBOARD FX
      // -------------------------------------------------------------
      case 0: // Face Bottom: PS: ✖ / Xbox: A / Switch: B
        this.soundboard?.play('airhorn');
        this.rumble(350, 0.85, 1.0); // Heavy bass vibration
        break;

      case 1: // Face Right: PS: ⭘ / Xbox: B / Switch: A
        this.soundboard?.play('bell');
        this.rumble(180, 0.2, 0.8);
        break;

      case 2: // Face Left: PS: ◼ / Xbox: X / Switch: Y
        this.soundboard?.play('crowd_react');
        this.rumble(160, 0.4, 0.3);
        break;

      case 3: // Face Top: PS: ▲ / Xbox: Y / Switch: X
        this.soundboard?.play('crowd_cheer');
        this.rumble(220, 0.5, 0.6);
        break;

      // -------------------------------------------------------------
      // SHOULDER BUMPERS -> AUDIO DECK PLAY / PAUSE
      // -------------------------------------------------------------
      case 4: // L1 / LB / L: Contestant 1 Audio Toggle
        this.toggleAudioPlayer(1);
        this.rumble(100, 0.3, 0.4);
        break;

      case 5: // R1 / RB / R: Contestant 2 Audio Toggle
        this.toggleAudioPlayer(2);
        this.rumble(100, 0.3, 0.4);
        break;

      // -------------------------------------------------------------
      // ANALOG TRIGGERS -> SCRATCH & MIX COMMANDS
      // -------------------------------------------------------------
      case 6: // L2 / LT: Contestant 1 to Deck & Needle Drop
        this.djController?.sendCharacterToDeck(1);
        this.soundboard?.play('needle_drop');
        this.rumble(140, 0.6, 0.2);
        break;

      case 7: // R2 / RT: Contestant 2 to Deck & Needle Drop
        this.djController?.sendCharacterToDeck(2);
        this.soundboard?.play('needle_drop');
        this.rumble(140, 0.6, 0.2);
        break;

      // -------------------------------------------------------------
      // D-PAD -> CHARACTER STAGE NAVIGATION
      // -------------------------------------------------------------
      case 12: // D-Pad Up: Both to DJ Console
        this.djController?.sendCharacterToDeck(1);
        this.djController?.sendCharacterToDeck(2);
        this.rumble(80, 0.2, 0.3);
        break;

      case 13: // D-Pad Down: Both to Side Stage
        this.djController?.sendCharacterToHype(1);
        this.djController?.sendCharacterToHype(2);
        this.rumble(80, 0.2, 0.3);
        break;

      case 14: // D-Pad Left: Needle Stop Scratch
        this.soundboard?.play('needle_stop');
        this.rumble(120, 0.7, 0.1);
        break;

      case 15: // D-Pad Right: Center Stage Battle Face-off!
        this.djController?.sendCharacterToCenter(1);
        this.djController?.sendCharacterToCenter(2);
        this.rumble(120, 0.5, 0.5);
        break;

      // -------------------------------------------------------------
      // MENU & SYSTEM BUTTONS -> TIMER & BATTLE
      // -------------------------------------------------------------
      case 9: // Start / Options / Menu / '+': Toggle Round Timer
        this.toggleBattleTimer();
        this.rumble(100, 0.3, 0.5);
        break;

      case 8: // Select / Share / Back / View / '-': Reset Round Timer
        this.timer?.reset();
        this.rumble(100, 0.2, 0.2);
        break;

      case 10: // L3 (Left Stick Press): Reset Camera View
        if (this.djController && this.djController.orbitAngles) {
          this.djController.orbitAngles.theta = 0;
          this.djController.orbitAngles.phi = 0.45;
        }
        this.rumble(80, 0.3, 0.3);
        break;

      case 11: // R3 (Right Stick Press): Stage Light Pulse & Scratch
        this.djController?.pulse();
        this.soundboard?.play('bell');
        this.rumble(200, 0.8, 0.8);
        break;
    }

    if (typeof this.onButtonPress === 'function') {
      this.onButtonPress(btnIndex);
    }
  }

  handleButtonUp(btnIndex) {
    this.highlightGamepadButtonUI(btnIndex, false);
  }

  toggleAudioPlayer(playerNum) {
    if (!this.audio) return;
    if (this.audio.isPlaying(playerNum)) {
      this.audio.pause(playerNum);
    } else {
      this.audio.play(playerNum);
    }
  }

  toggleBattleTimer() {
    if (!this.timer) return;
    if (typeof this.timer.toggle === 'function') {
      this.timer.toggle();
    } else if (this.timer.isRunning) {
      this.timer.stop();
    } else {
      this.timer.play ? this.timer.play() : this.timer.start?.();
    }
  }

  /**
   * Dual-Motor Haptic Feedback
   */
  rumble(duration = 200, strong = 0.5, weak = 0.5) {
    try {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      const pad = this.activeGamepadIndex !== null ? gamepads[this.activeGamepadIndex] : null;

      if (pad && pad.vibrationActuator && typeof pad.vibrationActuator.playEffect === 'function') {
        pad.vibrationActuator.playEffect('dual-rumble', {
          startDelay: 0,
          duration: Math.max(50, Math.min(1000, duration)),
          weakMagnitude: Math.max(0, Math.min(1, weak)),
          strongMagnitude: Math.max(0, Math.min(1, strong))
        }).catch(() => {});
      }
    } catch {
      // Vibration not permitted or supported on device
    }
  }

  updateIndicatorUI(connected) {
    const badge = document.getElementById('gamepad-status-badge');
    const label = document.getElementById('gamepad-status-label');
    const dot = document.getElementById('gamepad-status-dot');

    if (badge && label && dot) {
      if (connected) {
        badge.classList.add('connected');
        badge.title = `Connected: ${this.controllerName}. Click for Controller Button Guide.`;
        label.textContent = this.controllerName;
        dot.className = 'gamepad-dot active';
      } else {
        badge.classList.remove('connected');
        badge.title = 'Connect a PlayStation, Xbox, or Nintendo controller via USB or Bluetooth';
        label.textContent = 'Controller Ready';
        dot.className = 'gamepad-dot standby';
      }
    }
  }

  highlightGamepadButtonUI(btnIndex, active) {
    const els = document.querySelectorAll(`.gp-key[data-btn="${btnIndex}"]`);
    els.forEach(el => {
      if (active) el.classList.add('active');
      else el.classList.remove('active');
    });

    // Also update modal live button test indicator if open
    const liveMonitor = document.getElementById('gamepad-live-monitor');
    if (liveMonitor) {
      if (active) {
        liveMonitor.textContent = `Button [B${btnIndex}] Pressed`;
        liveMonitor.classList.add('active');
      } else {
        liveMonitor.textContent = 'Waiting for input...';
        liveMonitor.classList.remove('active');
      }
    }
  }

  /**
   * Diagnostic & Simulation Helpers (for in-browser testing)
   */
  simulateButton(btnIndex, duration = 250) {
    this.handleButtonDown(btnIndex);
    setTimeout(() => {
      this.handleButtonUp(btnIndex);
    }, duration);
  }

  simulateStick(axisIndex, value) {
    if (!this.djController) return;
    if (axisIndex === 0 || axisIndex === 1) {
      const lx = axisIndex === 0 ? value : 0;
      const ly = axisIndex === 1 ? value : 0;
      const activePlayer = this.audio?.isPlaying(2) && !this.audio?.isPlaying(1) ? 2 : 1;
      this.djController.moveCharacterDirect(activePlayer, lx, ly, 0.05);
    } else if (axisIndex === 2 || axisIndex === 3) {
      const rx = axisIndex === 2 ? value : 0;
      const ry = axisIndex === 3 ? value : 0;
      this.djController.orbitCameraDelta(-rx * 0.1, ry * 0.1);
    }
  }
}

export { GamepadManager };
