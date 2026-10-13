/**
 * `core/game/stage_art` — the stage/character/boss → asset-name table.
 *
 * The expected values are hand-derived from the reference contract (the four
 * lobby stage ids in declaration order, the four character portraits and the
 * `bg_XX_01/02.png` / `boss_XX_YY.png` / `bgm_stage_0X_11.mp3` layouts), not
 * read back out of the implementation, so a wrong mapping fails the test.
 */

import {
  STAGE_IDS,
  backgroundNames,
  bossPortrait,
  characterPortrait,
  stageBgmUrl,
  stageIndex,
} from '../src/core/game/stage_art';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

suite('stage art mapping');

test('the four lobby stage ids resolve to reference stages 1..4 in order', () => {
  expectEqual(STAGE_IDS.length, 4);
  expectEqual(stageIndex('starlit_lanes'), 1);
  expectEqual(stageIndex('misty_crossfire'), 2);
  expectEqual(stageIndex('clockwork_bloom'), 3);
  expectEqual(stageIndex('lunar_maze'), 4);
});

test('every known stage id round-trips into its own background pair', () => {
  const expected: Record<string, [string, string]> = {
    starlit_lanes: ['bg_01_01.png', 'bg_01_02.png'],
    misty_crossfire: ['bg_02_01.png', 'bg_02_02.png'],
    clockwork_bloom: ['bg_03_01.png', 'bg_03_02.png'],
    lunar_maze: ['bg_04_01.png', 'bg_04_02.png'],
  };
  for (const stageId of STAGE_IDS) {
    const stage = stageIndex(stageId);
    const names = backgroundNames(stage);
    expectEqual(names.length, 2, 'a stage always ships exactly two background layers');
    expectDeepEqual(names, expected[stageId], `background pair for ${stageId}`);
  }
});

test('backgroundNames always returns two `bg_XX_01/02.png` names', () => {
  for (const stage of [1, 2, 3, 4]) {
    const names = backgroundNames(stage);
    expectEqual(names.length, 2);
    expect(/^bg_\d{2}_01\.png$/.test(names[0]), `far layer: ${names[0]}`);
    expect(/^bg_\d{2}_02\.png$/.test(names[1]), `near layer: ${names[1]}`);
    expectEqual(names[0].slice(3, 5), names[1].slice(3, 5), 'both layers share the stage number');
  }
});

test('unknown stages fall back to stage 1 without throwing', () => {
  const fallback: [string, string] = ['bg_01_01.png', 'bg_01_02.png'];
  expectDeepEqual(backgroundNames(0), fallback);
  expectDeepEqual(backgroundNames(-7), fallback);
  expectDeepEqual(backgroundNames(99), fallback);
  expectDeepEqual(backgroundNames(Number.NaN), fallback);
  expectDeepEqual(backgroundNames(2.9), ['bg_02_01.png', 'bg_02_02.png'], 'a fractional stage truncates');
});

test('characterPortrait maps the four lobby characters and falls back to player_01', () => {
  expectEqual(characterPortrait('balanced'), 'player/player_01.png');
  expectEqual(characterPortrait('precision'), 'player/player_02.png');
  expectEqual(characterPortrait('wide'), 'player/player_03.png');
  expectEqual(characterPortrait('spell_power'), 'player/player_04.png');
  expectEqual(characterPortrait(''), 'player/player_01.png');
  expectEqual(characterPortrait('nonexistent'), 'player/player_01.png');
});

test('bossPortrait names the stage/phase art and clamps the phase to 1', () => {
  expectEqual(bossPortrait(1, 1), 'boss/boss_01_01.png');
  expectEqual(bossPortrait(2, 2), 'boss/boss_02_02.png');
  expectEqual(bossPortrait(4, 3), 'boss/boss_04_03.png');
  expectEqual(bossPortrait(3, 0), 'boss/boss_03_01.png', 'a missing phase clamps to 1');
  expectEqual(bossPortrait(3, -2), 'boss/boss_03_01.png');
});

test('unknown bosses fall back to stage 1 phase 1 without throwing', () => {
  expectEqual(bossPortrait(0, 1), 'boss/boss_01_01.png');
  expectEqual(bossPortrait(99, 2), 'boss/boss_01_02.png');
  expectEqual(bossPortrait(Number.NaN, 1), 'boss/boss_01_01.png');
});

test('stageBgmUrl builds the per-stage track under the tna audio root', () => {
  const expected: Record<string, string> = {
    starlit_lanes: 'bgm_stage_01_11.mp3',
    misty_crossfire: 'bgm_stage_02_11.mp3',
    clockwork_bloom: 'bgm_stage_03_11.mp3',
    lunar_maze: 'bgm_stage_04_11.mp3',
  };
  const seen = new Set<string>();
  for (const stageId of STAGE_IDS) {
    const url = stageBgmUrl(stageId);
    expect(url !== '', `stage ${stageId} must have a BGM url`);
    expect(url.includes('tna'), `url must carry the tna root segment: ${url}`);
    expect(url.includes('/audio/'), `url must sit under the audio directory: ${url}`);
    expect(url.endsWith(`/audio/${expected[stageId]}`), `track for ${stageId}: ${url}`);
    expect(!seen.has(url), `stage ${stageId} must not reuse another stage's track`);
    seen.add(url);
  }
});

test('stageBgmUrl is empty for an unknown stage id', () => {
  expectEqual(stageBgmUrl(''), '');
  expectEqual(stageBgmUrl('not_a_stage'), '');
  expectEqual(stageBgmUrl('STARLIT_LANES'), '', 'the id is case-sensitive');
});
