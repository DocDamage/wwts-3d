/**
 * One registry of app actions that hardware can trigger: MIDI controllers (via
 * MIDI learn), Stream Deck / Bitfocus Companion (HTTP: /api/cmd?action=<id>),
 * and anything else that wants to drive the show.
 *
 * kind 'press' fires on a button / note; kind 'range' takes a 0..1 value
 * (knobs, faders, the crossfader).
 */

function buildActions(h) {
  const A = [];
  const add = (id, label, group, fn, kind = 'press') => A.push({ id, label, group, fn, kind });
  // decks
  add('deck.toggle', 'Play / pause the active deck', 'Decks', () => h.toggleActiveDeck());
  [1, 2].forEach(n => {
    add(`deck${n}.play`, `Deck ${n} play / pause`, 'Decks', () => h.audio.togglePlay(n));
    add(`deck${n}.cue`, `Deck ${n} back to cue`, 'Decks', () => h.audio.cue(n));
    add(`deck${n}.volume`, `Deck ${n} volume`, 'Decks', (v) => h.audio.setChannelVolume(n, v), 'range');
    [0, 1, 2, 3].forEach(i => add(`deck${n}.hotcue${i + 1}`, `Deck ${n} hot cue ${i + 1}`, 'Decks', () => h.deckWaves?.jumpCue(n, i)));
  });
  add('mix.crossfade', 'Crossfader', 'Decks', (v) => h.audio.setCrossfade(v), 'range');
  add('mix.master', 'Master volume', 'Decks', (v) => h.audio.setMasterVolume(v), 'range');
  // pads
  for (let i = 0; i < 20; i++) add(`pad.${i + 1}`, `Pad ${i + 1}`, 'Pads', () => h.padBank.trigger(i));
  // battle flow
  add('timer.toggle', 'Timer start / pause', 'Battle', () => h.timer.toggle());
  add('timer.reset', 'Timer reset', 'Battle', () => h.timer.reset());
  add('round.next', 'Next round', 'Battle', () => h.rounds.nextRound());
  [1, 2, 3].forEach(r => add(`round.${r}`, `Go to round ${r}`, 'Battle', () => h.rounds.switchRound(r)));
  add('round.lock', 'Lock the round', 'Battle', () => h.lockCurrentRound());
  add('battle.submit', 'Submit / reveal the result', 'Battle', () => h.submit());
  add('reveal.close', 'Close the reveal', 'Battle', () => h.closeReveal());
  add('blind.toggle', 'Blind judging on / off', 'Battle', () => h.toggleBlind());
  add('crowd.open', 'Open crowd vote', 'Battle', () => h.crowdVote?.openPoll());
  add('crowd.close', 'Close crowd vote', 'Battle', () => h.crowdVote?.closePoll());
  if (h.primaryFlow) add('flow.primary', 'Battle flow: next step', 'Battle', () => h.primaryFlow());
  if (h.nextMatchup) add('ros.next', 'Load the next matchup', 'Battle', () => h.nextMatchup());
  if (h.recordToggle) add('rec.toggle', 'Start / stop recording', 'Stage', () => h.recordToggle());
  // stage
  add('fx.smoke', 'Smoke blast', 'Stage', () => h.smoke());
  add('fx.hype', 'Hype the crowd', 'Stage', () => h.hype());
  add('fx.airhorn', 'Air horn', 'Stage', () => h.soundboard.play('airhorn'));
  add('fx.scratch', 'Scratch', 'Stage', () => h.audio.playScratchSound?.(1));
  ['front', 'dj_pov', 'decks', 'drone', 'staredown', 'auto'].forEach(v => add(`cam.${v}`, `Camera: ${v.replace('_', ' ')}`, 'Stage', () => h.camera(v)));
  add('stage.view', 'Stage view (hide panels)', 'Stage', () => h.stageView());
  // announcer
  ['ready', 'fight', 'letsrock', 'showtime', 'theyreonfire', 'itsallontheline', 'whowillwin', 'winner', 'godlike', 'amazing'].forEach(k => add(`ann.${k}`, `Announcer: ${k}`, 'Announcer', () => h.announcer.play(k)));
  const byId = Object.fromEntries(A.map(a => [a.id, a]));
  return { list: A, byId, run: (id, value) => { const a = byId[id]; if (!a) return false; a.fn(value); return true; } };
}

/** Poll the local server's command queue (Stream Deck / Companion HTTP buttons) */
function startCommandRelay(actions, { onRun } = {}) {
  let failures = 0;
  const poll = async () => {
    try {
      const res = await fetch('/api/cmd/poll', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      failures = 0;
      const cmds = await res.json();
      cmds.forEach(c => { if (actions.run(c.action, c.arg !== null ? Number(c.arg) : undefined)) onRun?.(c.action); });
    } catch {
      failures++;
    }
    setTimeout(poll, failures > 5 ? 5000 : 400);
  };
  poll();
}

export { buildActions, startCommandRelay };
