/**
 * `core/game/stage_visual` — the cutscene step → visual mapping and the default
 * entrance sequence.
 *
 * The mapping must be total (every `CutsceneStep['kind']` resolves to a visual)
 * and match the documented table, and the default sequence must carry the
 * cutscene tuning durations. Values are hand-derived from the tuning contract.
 */

import type { CutsceneStep } from '../src/core/game/cutscene_sequence';
import { cutsceneVisualFor, defaultCutsceneSteps, type CutsceneVisual } from '../src/core/game/stage_visual';
import { DEFAULT_CUTSCENE_TUNING } from '../src/core/game/tna_stage_tuning';
import { expect, expectEqual, suite, test } from './harness';

const KINDS: readonly CutsceneStep['kind'][] = [
  'stage_title',
  'boss_intro',
  'player_intro',
  'bgm_cue',
  'wait',
];

const VISUALS: readonly CutsceneVisual[] = ['banner', 'boss_slide', 'player_slide', 'none'];

suite('cutscene overlay steps');

test('every step kind maps to a known visual (the mapping is total)', () => {
  for (const kind of KINDS) {
    const visual = cutsceneVisualFor(kind);
    expect(VISUALS.includes(visual), `kind ${kind} produced an unknown visual ${String(visual)}`);
  }
});

test('the mapping is exactly the documented table', () => {
  expectEqual(cutsceneVisualFor('stage_title'), 'banner');
  expectEqual(cutsceneVisualFor('boss_intro'), 'boss_slide');
  expectEqual(cutsceneVisualFor('player_intro'), 'player_slide');
  expectEqual(cutsceneVisualFor('bgm_cue'), 'none', 'the BGM cue is audio-only');
  expectEqual(cutsceneVisualFor('wait'), 'none', 'a wait draws nothing');
});

test('the default sequence carries the tuning durations in order', () => {
  const steps = defaultCutsceneSteps('STAGE 1');
  expectEqual(steps.length, 3);
  expectEqual(steps[0].kind, 'stage_title');
  expectEqual(steps[0].durationMs, DEFAULT_CUTSCENE_TUNING.stageTitleMs);
  expectEqual(steps[0].text, 'STAGE 1');
  expectEqual(steps[1].kind, 'boss_intro');
  expectEqual(steps[1].durationMs, DEFAULT_CUTSCENE_TUNING.bossIntroMs);
  expectEqual(steps[2].kind, 'player_intro');
  expectEqual(steps[2].durationMs, DEFAULT_CUTSCENE_TUNING.playerIntroMs);
});

test('every step in the default sequence actually draws', () => {
  for (const step of defaultCutsceneSteps('X')) {
    expect(cutsceneVisualFor(step.kind) !== 'none', `default step ${step.kind} must draw`);
    expect(step.durationMs > 0, `default step ${step.kind} must have a positive window`);
  }
});
