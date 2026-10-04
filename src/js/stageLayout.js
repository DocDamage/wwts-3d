/** Stage layout shared by the renderer and its mixins (metres, radians) */
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

export { STAGE_RADIUS, TABLE_HALF_X, TABLE_HALF_Z, CHAR_RADIUS, STATIONS, WALK_SPEED, RUN_SPEED, EMOTE_FADE_IN, EMOTE_FADE_OUT, DECK_LEVEL_TILT, wrapAngle, clampAngle, turnToward };
