/**
 * Fight Club control bindings (keyboard per player + gamepad per player),
 * rebindable from the Controls screen and saved per browser.
 */

const STORE = 'wwts_fight_bindings_v1';
const ACTIONS = ['left', 'right', 'up', 'down', 'lp', 'hp', 'lk', 'hk', 'throw', 'super', 'guard', 'parry'];
const LABELS = { left: 'Left', right: 'Right', up: 'Up (sidestep / jump)', down: 'Down (crouch)', lp: 'Light punch (LP)', hp: 'Heavy punch (HP)', lk: 'Light kick (LK)', hk: 'Heavy kick (HK)', throw: 'Throw', super: 'Super', guard: 'Guard', parry: 'Parry' };

const DEFAULT_KEYS = {
  1: {
    left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'],
    lp: ['KeyF'], hp: ['KeyG'], lk: ['KeyV'], hk: ['KeyB'], throw: ['KeyH'], super: ['KeyT'], guard: ['KeyC'], parry: ['KeyX']
  },
  2: {
    left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'],
    lp: ['KeyK', 'Numpad4'], hp: ['KeyL', 'Numpad5'], lk: ['Comma', 'Numpad1'], hk: ['Period', 'Numpad2'],
    throw: ['Semicolon', 'Numpad6'], super: ['KeyO', 'Numpad3'], guard: ['KeyM', 'Numpad0'], parry: ['KeyN', 'NumpadDecimal']
  }
};
// Standard gamepad button indices
const DEFAULT_PAD = { lp: 2, hp: 3, lk: 0, hk: 1, throw: 4, super: 5, guard: 6, parry: 7, start: 9, up: 12, down: 13, left: 14, right: 15 };

const clone = (o) => JSON.parse(JSON.stringify(o));

let bindings = load();

function load() {
  const base = { keys: clone(DEFAULT_KEYS), pad: { 1: { ...DEFAULT_PAD }, 2: { ...DEFAULT_PAD } } };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved?.keys) [1, 2].forEach(p => Object.assign(base.keys[p], saved.keys[p] || {}));
    if (saved?.pad) [1, 2].forEach(p => Object.assign(base.pad[p], saved.pad[p] || {}));
  } catch { /* defaults */ }
  return base;
}

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(bindings)); } catch { /* storage blocked */ }
}

const getKeys = () => bindings.keys;
const getPad = (p) => bindings.pad[p] || DEFAULT_PAD;

/** Bind a key (replaces that action's primary key; removes it from anything else for that player) */
function bindKey(p, action, code) {
  ACTIONS.forEach(a => { bindings.keys[p][a] = (bindings.keys[p][a] || []).filter(c => c !== code); });
  const rest = (bindings.keys[p][action] || []).slice(1).filter(c => c !== code);
  bindings.keys[p][action] = [code, ...rest];
  save();
}

function bindPad(p, action, index) {
  Object.keys(bindings.pad[p]).forEach(a => { if (bindings.pad[p][a] === index && a !== action) bindings.pad[p][a] = -1; });
  bindings.pad[p][action] = index;
  save();
}

function resetBindings() {
  bindings = { keys: clone(DEFAULT_KEYS), pad: { 1: { ...DEFAULT_PAD }, 2: { ...DEFAULT_PAD } } };
  save();
}

const keyName = (code) => (code || '—').replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '').replace('Numpad', 'Num ').replace('Period', '.').replace('Comma', ',').replace('Semicolon', ';');
const padName = (i) => (i < 0 || i === undefined ? '—' : ({ 0: 'A / ✕', 1: 'B / ○', 2: 'X / □', 3: 'Y / △', 4: 'LB / L1', 5: 'RB / R1', 6: 'LT / L2', 7: 'RT / R2', 8: 'Back', 9: 'Start', 10: 'L3', 11: 'R3', 12: 'D-pad ↑', 13: 'D-pad ↓', 14: 'D-pad ←', 15: 'D-pad →' }[i] || `Button ${i}`));

export { ACTIONS, LABELS, DEFAULT_KEYS, DEFAULT_PAD, getKeys, getPad, bindKey, bindPad, resetBindings, keyName, padName };
