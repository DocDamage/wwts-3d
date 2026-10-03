/**
 * Selectable fighters: the four original avatars plus the Mixamo cast
 * (public/models/characters/cast). Cast models load on demand.
 */
const CAST = [
  { key: 'black_male', name: 'Marcus', file: '/models/characters/black_male.fbx', color: '#ff5a4a', style: 'Boxer' },
  { key: 'black_female', name: 'Nia', file: '/models/characters/black_female.fbx', color: '#26d4ff', style: 'Street' },
  { key: 'white_male', name: 'Jake', file: '/models/characters/white_male.fbx', color: '#ffb03a', style: 'Brawler' },
  { key: 'white_female', name: 'Riley', file: '/models/characters/white_female.fbx', color: '#c77dff', style: 'Kickboxer' },
  { key: 'ninja', name: 'Ninja', file: '/models/characters/cast/ninja.fbx', color: '#9aa4b2', style: 'Shadow' },
  { key: 'kachujin', name: 'Kachujin', file: '/models/characters/cast/kachujin.fbx', color: '#ff7b54', style: 'Martial Artist' },
  { key: 'the_boss', name: 'The Boss', file: '/models/characters/cast/the_boss.fbx', color: '#e3c565', style: 'Heavyweight' },
  { key: 'remy', name: 'Remy', file: '/models/characters/cast/remy.fbx', color: '#7fd1ff', style: 'Hustler' },
  { key: 'vanguard', name: 'Vanguard', file: '/models/characters/cast/vanguard.fbx', color: '#5a8dff', style: 'Soldier' },
  { key: 'ely', name: 'Ely', file: '/models/characters/cast/ely.fbx', color: '#ff6fae', style: 'Capoeira' },
  { key: 'mremireh', name: 'Mremireh', file: '/models/characters/cast/mremireh.fbx', color: '#b48cff', style: 'Mystic' },
  { key: 'brute', name: 'Brute', file: '/models/characters/cast/brute.fbx', color: '#c0583a', style: 'Bruiser' },
  { key: 'erika', name: 'Erika', file: '/models/characters/cast/erika.fbx', color: '#7ad67a', style: 'Ranger' },
  { key: 'jolleen', name: 'Jolleen', file: '/models/characters/cast/jolleen.fbx', color: '#ff9f43', style: 'Dancer' },
  { key: 'big_vegas', name: 'Big Vegas', file: '/models/characters/cast/big_vegas.fbx', color: '#ffd23a', style: 'Showman' },
  { key: 'arissa', name: 'Arissa', file: '/models/characters/cast/arissa.fbx', color: '#e05a8a', style: 'Duelist' },
  { key: 'exo_red', name: 'Exo Red', file: '/models/characters/cast/exo_red.fbx', color: '#ff3b3b', style: 'Cyborg' },
  { key: 'kaya', name: 'Kaya', file: '/models/characters/cast/kaya.fbx', color: '#3ddbb1', style: 'Agile' }
];

const CAST_BY_KEY = Object.fromEntries(CAST.map(c => [c.key, c]));

export { CAST, CAST_BY_KEY };
