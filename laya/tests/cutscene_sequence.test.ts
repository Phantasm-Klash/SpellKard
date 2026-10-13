/**
 * `core/game/cutscene_sequence` — the pure timing half of the stage-entrance
 * cutscene. Windows are half-open `[start, start + durationMs)`, so the
 * boundary instant belongs to the next step; a non-positive step is skipped and
 * the sequence is `done` once the elapsed time reaches the total.
 */

import { CutsceneSequencer, type CutsceneStep } from '../src/core/game/cutscene_sequence';
import { expectEqual, suite, test } from './harness';

const STEPS: CutsceneStep[] = [
  { kind: 'stage_title', durationMs: 100, text: 'Stage 1' },
  { kind: 'boss_intro', durationMs: 200, text: 'Boss' },
  { kind: 'player_intro', durationMs: 50, text: 'Player' },
];

suite('cutscene sequencer');

test('current is null and done is true before the first start', () => {
  const sequencer = new CutsceneSequencer();
  expectEqual(sequencer.current, null);
  expectEqual(sequencer.done, true);
});

test('three steps advance through their half-open windows and then finish', () => {
  const sequencer = new CutsceneSequencer();
  sequencer.start(STEPS);

  expectEqual(sequencer.current?.kind, 'stage_title');
  expectEqual(sequencer.done, false);

  // 0..99 belongs to step 1; the instant 100 opens step 2.
  sequencer.update(99);
  expectEqual(sequencer.current?.kind, 'stage_title');
  sequencer.update(1);
  expectEqual(sequencer.current?.kind, 'boss_intro', 'the boundary instant belongs to the next step');

  // Step 2 spans 100..299; step 3 spans 300..349.
  sequencer.update(199);
  expectEqual(sequencer.current?.kind, 'boss_intro');
  sequencer.update(1);
  expectEqual(sequencer.current?.kind, 'player_intro');
  expectEqual(sequencer.current?.text, 'Player');

  // Total is 350; reaching it ends the sequence.
  sequencer.update(49);
  expectEqual(sequencer.done, false);
  sequencer.update(1);
  expectEqual(sequencer.done, true);
  expectEqual(sequencer.current, null);
});

test('zero steps are done immediately', () => {
  const sequencer = new CutsceneSequencer();
  sequencer.start([]);
  expectEqual(sequencer.done, true);
  expectEqual(sequencer.current, null);
  sequencer.update(500);
  expectEqual(sequencer.done, true);
});

test('a non-positive step duration is skipped', () => {
  const sequencer = new CutsceneSequencer();
  sequencer.start([
    { kind: 'wait', durationMs: 0 },
    { kind: 'stage_title', durationMs: 100, text: 'Go' },
  ]);
  expectEqual(sequencer.current?.kind, 'stage_title', 'the empty window is never current');
  sequencer.update(100);
  expectEqual(sequencer.done, true);
});

test('dtMs = 0 does not advance the clock', () => {
  const sequencer = new CutsceneSequencer();
  sequencer.start(STEPS);
  sequencer.update(0);
  expectEqual(sequencer.current?.kind, 'stage_title');
  expectEqual(sequencer.done, false);

  sequencer.update(50);
  sequencer.update(0);
  expectEqual(sequencer.current?.kind, 'stage_title', 'a paused frame keeps the same step');
});

test('a negative dtMs is clamped, not rewound', () => {
  const sequencer = new CutsceneSequencer();
  sequencer.start(STEPS);
  sequencer.update(150); // inside step 2
  expectEqual(sequencer.current?.kind, 'boss_intro');
  sequencer.update(-100);
  expectEqual(sequencer.current?.kind, 'boss_intro', 'a negative delta must not rewind');
  sequencer.update(200); // 150 + 200 = 350 -> done
  expectEqual(sequencer.done, true);
  expectEqual(sequencer.current, null);
});

test('update before start is a no-op and reset returns to the never-started state', () => {
  const sequencer = new CutsceneSequencer();
  sequencer.update(999);
  expectEqual(sequencer.current, null);
  expectEqual(sequencer.done, true);

  sequencer.start(STEPS);
  sequencer.update(10);
  sequencer.reset();
  expectEqual(sequencer.current, null);
  expectEqual(sequencer.done, true);

  // A fresh start after reset begins from zero again.
  sequencer.start(STEPS);
  expectEqual(sequencer.current?.kind, 'stage_title');
  expectEqual(sequencer.done, false);
});
