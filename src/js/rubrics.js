/**
 * Scoring guides: what each score range means for every category, so a 7 from
 * one judge means the same as a 7 from another. Shown on the judges' phones and
 * next to the host's sliders while scoring.
 */

const BANDS = [
  { min: 0, max: 3.9, label: '0–3' },
  { min: 4, max: 5.9, label: '4–5' },
  { min: 6, max: 7.9, label: '6–7' },
  { min: 8, max: 9.4, label: '8–9' },
  { min: 9.5, max: 10, label: '10' }
];

// [0–3, 4–5, 6–7, 8–9, 10] for each category key
const GUIDES = {
  creativity: ['Generic, nothing you haven\'t heard', 'One idea of its own, mostly familiar', 'Clear identity, a fresh touch or flip', 'Surprising choices that work, memorable flip', 'Nobody else would have made this'],
  versatility: ['One loop, no movement', 'A small change or two', 'Real switch-ups that keep it moving', 'Several textures and moods, all earned', 'A whole journey without losing the thread'],
  mix: ['Muddy or clipping, elements fight', 'Listenable but crowded or thin', 'Balanced, everything has its place', 'Clean, wide and punchy, translates on the system', 'Release-ready master, nothing to fix'],
  drums: ['Stiff or weak, no groove', 'Basic pattern, some punch', 'Solid groove and pocket', 'Hard-hitting with great swing and fills', 'Drums alone would win the round'],
  melody: ['Aimless or off-key', 'Simple idea, doesn\'t stick', 'Catchy, fits the beat', 'Strong hook with real emotion', 'Stuck in everyone\'s head after one listen'],
  bassline: ['Weak, missing or clashing low end', 'Present but doesn\'t move', 'Locks with the kick, solid weight', 'Moves the room, great glide and tone', 'Low end that makes the venue shake'],
  energy: ['Flat, the room stays still', 'Some heads nodding', 'Keeps the crowd with it', 'Big reactions at the right moments', 'The room erupts'],
  battle_ability: ['Plays safe, no answer to the opponent', 'Competes but doesn\'t land a blow', 'Clearly built to battle', 'Lands knockout moments on purpose', 'Ends the opponent\'s night'],
  arrangement: ['No structure, loops to the end', 'Basic intro / loop', 'Clear sections and transitions', 'Builds and drops land perfectly', 'Every second is placed with intent'],
  sound_selection: ['Stock or clashing sounds', 'Fine sounds, nothing special', 'Cohesive palette that fits the vibe', 'Distinctive sounds that make the beat', 'A sound world of its own']
};

const GENERIC = ['Weak', 'Below average', 'Good', 'Excellent', 'Perfect'];

function bandIndex(value) {
  const v = Number(value) || 0;
  const i = BANDS.findIndex(b => v >= b.min && v <= b.max);
  return i < 0 ? (v > 10 ? 4 : 0) : i;
}

/** Guide lines for a category (custom ones from a template win over the defaults) */
function guidesFor(category, custom = null) {
  const key = category?.key;
  return custom?.[key] || GUIDES[key] || GENERIC;
}

/** "8–9: Strong hook with real emotion" for a slider value */
function guideText(category, value, custom = null) {
  const i = bandIndex(value);
  return `${BANDS[i].label}: ${guidesFor(category, custom)[i]}`;
}

export { BANDS, GUIDES, bandIndex, guidesFor, guideText };
