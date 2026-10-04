/**
 * Selectable fighters: the four original avatars plus the Mixamo cast
 * (public/models/characters/cast, converted from assets-src). Cast models load on demand.
 */
const CAST = [
  { key: 'black_male', name: 'Marcus', file: '/models/characters/black_male.glb', color: '#ff5a4a', style: 'Boxer' },
  { key: 'black_female', name: 'Nia', file: '/models/characters/black_female.glb', color: '#26d4ff', style: 'Street' },
  { key: 'white_male', name: 'Jake', file: '/models/characters/white_male.glb', color: '#ffb03a', style: 'Brawler' },
  { key: 'white_female', name: 'Riley', file: '/models/characters/white_female.glb', color: '#c77dff', style: 'Kickboxer' },
  { key: 'ninja', name: 'Ninja', file: '/models/characters/cast/ninja.glb', color: '#9aa4b2', style: 'Shadow' },
  { key: 'kachujin', name: 'Kachujin', file: '/models/characters/cast/kachujin.glb', color: '#ff7b54', style: 'Martial Artist' },
  { key: 'the_boss', name: 'The Boss', file: '/models/characters/cast/the_boss.glb', color: '#e3c565', style: 'Heavyweight' },
  { key: 'remy', name: 'Remy', file: '/models/characters/cast/remy.glb', color: '#7fd1ff', style: 'Hustler' },
  { key: 'vanguard', name: 'Vanguard', file: '/models/characters/cast/vanguard.glb', color: '#5a8dff', style: 'Soldier' },
  { key: 'ely', name: 'Ely', file: '/models/characters/cast/ely.glb', color: '#ff6fae', style: 'Capoeira' },
  { key: 'mremireh', name: 'Mremireh', file: '/models/characters/cast/mremireh.glb', color: '#b48cff', style: 'Mystic' },
  { key: 'brute', name: 'Brute', file: '/models/characters/cast/brute.glb', color: '#c0583a', style: 'Bruiser' },
  { key: 'erika', name: 'Erika', file: '/models/characters/cast/erika.glb', color: '#7ad67a', style: 'Ranger' },
  { key: 'jolleen', name: 'Jolleen', file: '/models/characters/cast/jolleen.glb', color: '#ff9f43', style: 'Dancer' },
  { key: 'big_vegas', name: 'Big Vegas', file: '/models/characters/cast/big_vegas.glb', color: '#ffd23a', style: 'Showman' },
  { key: 'arissa', name: 'Arissa', file: '/models/characters/cast/arissa.glb', color: '#e05a8a', style: 'Duelist' },
  { key: 'exo_red', name: 'Exo Red', file: '/models/characters/cast/exo_red.glb', color: '#ff3b3b', style: 'Cyborg' },
  { key: 'kaya', name: 'Kaya', file: '/models/characters/cast/kaya.glb', color: '#3ddbb1', style: 'Agile' }
];

const CAST_BY_KEY = Object.fromEntries(CAST.map(c => [c.key, c]));

export { CAST, CAST_BY_KEY };
