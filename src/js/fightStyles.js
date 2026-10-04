/**
 * Fighting styles: each archetype swaps in its own normals and specials, its
 * own stance, and its own feel (speed, power, toughness, armour on big swings).
 * Every fighter in the cast belongs to one style (fightCast.js `style`).
 *
 * normals: { button: { direction: moveKey } } overrides on top of the base set
 * specials: extra motion inputs (tried before the shared specials)
 * idle: stance clip; speed: move speed; power: damage dealt; toughness: damage taken ÷
 */

// Extra moves only some styles get (added to the engine's move table)
const STYLE_MOVES = {
  fistfight_a: { id: 'fight_fistfight_a', name: 'Fist Flurry', power: 2 },
  fistfight_b: { id: 'fight_fistfight_b', name: 'Street Combo', power: 2 },
  body_jab_cross: { id: 'fight_body_jab_cross', name: 'Body Jab Cross', power: 2, level: 'mid' },
  boxer_hook_body: { id: 'fight_hook_body', name: 'Liver Hooks', power: 2, level: 'mid', chCrumple: true },
  side_kick2: { id: 'fight_side_kick2', name: 'Snap Side Kick', power: 2, level: 'mid', push: 0.6 },
  knee_kick: { id: 'fight_knee_kick_lead', name: 'Lead Knee Kick', power: 1, level: 'mid' },
  roundhouse_adv: { id: 'fight_roundhouse_adv', name: 'Advancing Roundhouse', power: 2, homing: true, lunge: 0.7 },
  roundhouse_rear: { id: 'fight_roundhouse_rear', name: 'Rear Roundhouse', power: 3, homing: true, chKnockdown: true },
  double_snap: { id: 'fight_double_snap_kick', name: 'Double Snap Kick', power: 2 },
  armada: { id: 'fight_armada', name: 'Armada', power: 2, homing: true, chKnockdown: true },
  meia_lua: { id: 'fight_meia_lua', name: 'Meia Lua', power: 2, homing: true, knockdown: true },
  meia_lua_frente: { id: 'fight_meia_lua_frente', name: 'Meia Lua de Frente', power: 2, homing: true },
  queshada: { id: 'fight_queshada', name: 'Queshada', power: 2, homing: true },
  pontera: { id: 'fight_pontera', name: 'Pontera', power: 2, level: 'mid' },
  bencao: { id: 'fight_bencao', name: 'Bencao', power: 3, level: 'mid', knockdown: true, push: 0.9 },
  martelo_step: { id: 'fight_martelo_step', name: 'Stepping Martelo', power: 2, lunge: 0.6 },
  chapa_giratoria: { id: 'fight_chapa_giratoria', name: 'Spinning Chapa', power: 3, level: 'mid', homing: true, knockdown: true },
  cartwheel: { id: 'fight_cartwheel', name: 'Cartwheel', power: 1, evade: true, invuln: 0.45 },
  au_roll: { id: 'fight_au_roll', name: 'Au Escape', power: 1, evade: true, invuln: 0.5 },
  crescent: { id: 'fight_crescent_kick', name: 'Crescent Kick', power: 3, chKnockdown: true },
  flying_side: { id: 'fight_flying_sidekick', name: 'Flying Side Kick', power: 3, level: 'mid', knockdown: true, lunge: 0.9 },
  spin_flip: { id: 'fight_spin_flip_kick', name: 'Spin Flip Kick', power: 3, launch: true, invuln: 0.3 },
  backflip_upper: { id: 'fight_backflip_uppercut', name: 'Backflip Uppercut', power: 3, level: 'mid', launch: true },
  roll_kick: { id: 'fight_roll_kick', name: 'Rolling Kick', power: 2, level: 'low', knockdown: true, ground: true },
  headbutt: { id: 'fight_headbutt', name: 'Headbutt', power: 2, chCrumple: true },
  elbow: { id: 'fight_elbow', name: 'Elbow', power: 2 },
  stomp: { id: 'fight_stomp', name: 'Stomp', power: 2, level: 'low', ground: true },
  wild_swings: { id: 'fight_zombie_punch', name: 'Wild Swings', power: 2 },
  body_knee: { id: 'fight_body_punch_knee', name: 'Body Shot + Knee', power: 2, level: 'mid', chLaunch: true },
  grab_slam: { id: 'fight_grab_slam', name: 'Grab & Slam', power: 3, level: 'mid', knockdown: true, unblockable: true, reach: 1.1 },
  haymaker: { id: 'fight_right_hook', name: 'Haymaker', power: 3, homing: true, chCrumple: true },
  claw_swipes: { id: 'fight_mutant_swipe', name: 'Claw Swipes', power: 3, homing: true },
  monster_slam: { id: 'air_mutant_slam', name: 'Monster Slam', power: 3, level: 'mid', knockdown: true, lunge: 0.9, startup: 0.5 },
  vampire_bite: { id: 'fight_vampire_bite', name: 'Vampire Bite', power: 3, unblockable: true, drain: 0.5, reach: 1.0 },
  wave: { id: 'spec_1h_sweep', name: 'Sweeping Wave', power: 2, special: true, projectile: 'blast', level: 'mid' },
  rising_wave: { id: 'spec_1h_upsweep', name: 'Rising Wave', power: 3, special: true, level: 'mid', launch: true, reach: 1.4 },
  sky_call: { id: 'spec_cast_up', name: 'Sky Call', power: 3, special: true, projectile: 'shockwave', level: 'low' },
  aura_burst: { id: 'spec_wide_cast', name: 'Aura Burst', power: 3, special: true, level: 'mid', stun: true, reach: 1.5 },
  pull_blast: { id: 'spec_pull_blast', name: 'Pull & Blast', power: 3, special: true, projectile: 'beam', level: 'mid' },
  slide_tackle: { id: 'fight_slide_tackle', name: 'Slide Tackle', power: 2, level: 'low', knockdown: true, lunge: 1.0 }
};

const STYLES = {
  boxer: {
    name: 'Boxer', blurb: 'Fast hands, body shots, slips',
    idle: 'fight_idle_bounce', speed: 1.08, power: 1.0, toughness: 1.0,
    normals: { lk: { n: 'body_jab_cross', f: 'fistfight_a', b: 'boxer_hook_body' }, hk: { n: 'haymaker', f: 'fistfight_a' } },
    specials: [{ motion: ['d', 'df', 'f'], button: 'p', move: 'fistfight_a', label: '↓↘→ + P' }]
  },
  kickboxer: {
    name: 'Kickboxer', blurb: 'Long kicks, knees, pressure',
    idle: 'fight_mma_idle', speed: 1.04, power: 1.0, toughness: 1.0,
    normals: { lk: { n: 'knee_kick', f: 'side_kick2', b: 'double_snap' }, hk: { f: 'roundhouse_adv', b: 'roundhouse_rear' } },
    specials: [{ motion: ['d', 'df', 'f'], button: 'k', move: 'roundhouse_adv', label: '↓↘→ + K' }]
  },
  capoeira: {
    name: 'Capoeira', blurb: 'Ginga, cartwheels, spinning kicks',
    idle: 'fight_ginga', speed: 1.02, power: 1.0, toughness: 0.95,
    normals: { lk: { n: 'pontera', f: 'queshada', b: 'meia_lua_frente', df: 'martelo_step' }, hk: { n: 'armada', f: 'bencao', b: 'meia_lua', df: 'chapa_giratoria' } },
    specials: [
      { motion: ['b', 'db', 'd'], button: 'k', move: 'cartwheel', label: '←↙↓ + K (evade)' },
      { motion: ['d', 'db', 'b'], button: 'p', move: 'au_roll', label: '↓↙← + P (escape)' }
    ]
  },
  martial: {
    name: 'Martial Artist', blurb: 'Flips, flying kicks, quick feet',
    idle: 'fight_idle_ninja', speed: 1.1, power: 0.95, toughness: 0.95,
    normals: { hk: { f: 'flying_side', b: 'crescent' }, lk: { df: 'roll_kick' } },
    specials: [
      { motion: ['d', 'u'], button: 'p', move: 'backflip_upper', label: '↓ ↑ + P' },
      { motion: ['f', 'd', 'df'], button: 'k', move: 'spin_flip', label: '→↓↘ + K' }
    ]
  },
  brawler: {
    name: 'Brawler', blurb: 'Headbutts, elbows, stomps',
    idle: 'fight_stance', speed: 1.0, power: 1.08, toughness: 1.05,
    normals: { lp: { b: 'elbow' }, hp: { n: 'fistfight_b', b: 'headbutt' }, lk: { b: 'body_knee', d: 'stomp' } },
    specials: [{ motion: ['d', 'df', 'f'], button: 'p', move: 'wild_swings', label: '↓↘→ + P' }]
  },
  heavy: {
    name: 'Heavyweight', blurb: 'Slow, tough, armoured haymakers',
    idle: 'fight_stance', speed: 0.92, power: 1.15, toughness: 1.2, armor: true,
    normals: { hp: { n: 'haymaker', f: 'body_knee' }, hk: { b: 'stomp' } },
    specials: [{ motion: ['f', 'df', 'd', 'db', 'b'], button: 'p', move: 'grab_slam', label: '→↘↓↙← + P (unblockable)' }]
  },
  monster: {
    name: 'Monster', blurb: 'Claws, leaping slams, armour',
    idle: 'fight_stance', speed: 0.88, power: 1.2, toughness: 1.3, armor: true,
    normals: { hp: { n: 'claw_swipes', f: 'claw_swipes' }, hk: { f: 'monster_slam' }, lk: { d: 'stomp' } },
    specials: [{ motion: ['d', 'df', 'f'], button: 'p', move: 'monster_slam', label: '↓↘→ + P' }]
  },
  mystic: {
    name: 'Mystic', blurb: 'Energy waves and blasts at range',
    idle: 'fight_idle', speed: 1.0, power: 1.0, toughness: 0.92,
    normals: { hp: { b: 'aura_burst' } },
    specials: [
      { motion: ['d', 'db', 'b'], button: 'p', move: 'wave', label: '↓↙← + P' },
      { motion: ['f', 'd', 'df'], button: 'p', move: 'rising_wave', label: '→↓↘ + P' },
      { motion: ['d', 'n', 'd'], button: 'k', move: 'sky_call', label: '↓ ↓ + K' },
      { motion: ['b', 'f'], button: 'p', move: 'pull_blast', label: '← → + P' }
    ]
  },
  vampire: {
    name: 'Vampire', blurb: 'Bites to drain health, dark energy',
    idle: 'fight_idle_ninja', speed: 1.05, power: 1.0, toughness: 1.0,
    normals: { hp: { b: 'aura_burst' } },
    specials: [
      { motion: ['f', 'df', 'd', 'db', 'b'], button: 'p', move: 'vampire_bite', label: '→↘↓↙← + P (drains health)' },
      { motion: ['d', 'db', 'b'], button: 'p', move: 'wave', label: '↓↙← + P' }
    ]
  },
  granny: {
    name: 'Granny', blurb: 'Quick, fragile, utterly unpredictable',
    idle: 'fight_idle', speed: 1.15, power: 0.95, toughness: 0.85,
    normals: { hp: { n: 'wild_swings' }, lk: { d: 'slide_tackle' }, hk: { n: 'crescent' } },
    specials: [{ motion: ['d', 'df', 'f'], button: 'k', move: 'slide_tackle', label: '↓↘→ + K' }]
  },
  allround: {
    name: 'All-rounder', blurb: 'A bit of everything',
    idle: 'fight_idle', speed: 1.0, power: 1.0, toughness: 1.0,
    normals: {},
    specials: []
  }
};

/** Which archetype each fighter's style label belongs to */
const STYLE_OF = {
  Boxer: 'boxer', Hustler: 'boxer', Showman: 'boxer',
  Kickboxer: 'kickboxer', Duelist: 'kickboxer', Ranger: 'kickboxer',
  Capoeira: 'capoeira', Dancer: 'capoeira', Agile: 'capoeira',
  'Martial Artist': 'martial', Shadow: 'martial', Assassin: 'martial',
  Street: 'brawler', Brawler: 'brawler', Soldier: 'brawler', Pirate: 'brawler',
  Heavyweight: 'heavy', Bruiser: 'heavy', Gladiator: 'heavy',
  Monster: 'monster', Beast: 'monster',
  Mystic: 'mystic', Sorceress: 'mystic', Cyborg: 'mystic', Alien: 'mystic',
  Vampire: 'vampire',
  Granny: 'granny'
};

function styleFor(castEntry) {
  const key = STYLE_OF[castEntry?.style] || 'allround';
  return { key, ...STYLES[key] };
}

export { STYLES, STYLE_MOVES, STYLE_OF, styleFor };
