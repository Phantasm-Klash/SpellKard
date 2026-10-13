/**
 * `core/game/tna_stage_tuning` + the `tnaAssetUrl` join.
 *
 * The invariants are hand-derived from the documented tuning contract (positive
 * scales/speeds/periods, `layer1Scale < layer2Scale`, the 480 px reference
 * height, every number finite) and the join is checked against the two
 * deployment roots, so a wrong value or a doubled `tna` segment fails the test
 * instead of being read back out of the code.
 */

import { TNA_NATIVE_ROOT, TNA_WEB_ROOT, tnaAssetUrl } from '../src/core/game/tna_assets';
import { stageBgmUrl } from '../src/core/game/stage_art';
import {
  DEFAULT_CUTSCENE_TUNING,
  DEFAULT_STAGE_BACKGROUND_TUNING,
  DEFAULT_WATERMARK_TUNING,
} from '../src/core/game/tna_stage_tuning';
import { expect, expectEqual, suite, test } from './harness';

suite('tna stage tuning');

test('background scale/scroll constants are positive, finite and ordered', () => {
  const tuning = DEFAULT_STAGE_BACKGROUND_TUNING;
  expect(tuning.layer1Scale > 0, 'layer-1 scale must be positive');
  expect(tuning.layer2Scale > 0, 'layer-2 scale must be positive');
  expect(tuning.layer2Scale > tuning.layer1Scale, 'layer 2 is drawn larger than layer 1 (spec 2.4 > 2.0)');
  expect(tuning.referenceStageHeight > 0, 'the reference stage height must be positive');
  expect(tuning.layer1SpacingPx > 0, 'the layer-1 tile spacing must be positive');
  expect(tuning.layer1ScrollPxPerFrame > 0, 'the layer-1 scroll speed must be positive');
  expect(tuning.layer2RotationDegPerFrame > 0, 'the layer-2 rotation speed must be positive');
  expect(tuning.framesPerSecond > 0, 'the reference frame rate must be positive');
  for (const value of [
    tuning.layer1Scale,
    tuning.layer2Scale,
    tuning.referenceStageHeight,
    tuning.layer1SpacingPx,
    tuning.layer1ScrollPxPerFrame,
    tuning.layer2RotationDegPerFrame,
    tuning.framesPerSecond,
  ]) {
    expect(Number.isFinite(value), `every background constant must be finite, got ${value}`);
  }
});

test('the spec figures are carried verbatim', () => {
  const tuning = DEFAULT_STAGE_BACKGROUND_TUNING;
  // Spec §1.2 / §1.3 / §1.4: scale 2.0 and 2.4, 512 px spacing, 1 px/frame
  // (60 px/s), 0.25 deg/frame (+-15 deg/s), 480 px design stage, 60 fps.
  expectEqual(tuning.layer1Scale, 2.0);
  expectEqual(tuning.layer2Scale, 2.4);
  expectEqual(tuning.referenceStageHeight, 480);
  expectEqual(tuning.layer1SpacingPx, 512);
  expectEqual(tuning.layer1ScrollPxPerFrame, 1);
  expectEqual(tuning.layer2RotationDegPerFrame, 0.25);
  expectEqual(tuning.framesPerSecond, 60);
});

test('watermark constants are positive, finite and in range', () => {
  const tuning = DEFAULT_WATERMARK_TUNING;
  expect(tuning.idleScaleAmplitude > 0 && tuning.idleScaleAmplitude < 1, 'idle amplitude must be a small positive swing');
  expect(tuning.idlePeriodMs > 0, 'idle period must be positive');
  expect(tuning.opacity > 0 && tuning.opacity <= 1, 'opacity must be in (0, 1]');
  expect(tuning.flashMs > 0, 'flash duration must be positive');
  for (const value of [tuning.idleScaleAmplitude, tuning.idlePeriodMs, tuning.opacity, tuning.flashMs]) {
    expect(Number.isFinite(value), `every watermark constant must be finite, got ${value}`);
  }
});

test('cutscene durations are positive and finite; the title is the spec 6.0 s', () => {
  const tuning = DEFAULT_CUTSCENE_TUNING;
  expect(tuning.stageTitleMs > 0, 'stage title must last a positive time');
  expect(tuning.bossIntroMs > 0, 'boss intro must last a positive time');
  expect(tuning.playerIntroMs > 0, 'player intro must last a positive time');
  // Spec §3.1: FadeIn 1.0 + Delay 4.0 + FadeOut 1.0.
  expectEqual(tuning.stageTitleMs, 6000);
  for (const value of [tuning.stageTitleMs, tuning.bossIntroMs, tuning.playerIntroMs]) {
    expect(Number.isFinite(value), `every cutscene duration must be finite, got ${value}`);
  }
});

test('tnaAssetUrl joins both deployment roots without doubling the tna segment', () => {
  expectEqual(tnaAssetUrl('audio/se_graze.mp3', false), `${TNA_WEB_ROOT}/audio/se_graze.mp3`);
  expectEqual(tnaAssetUrl('audio/se_graze.mp3', true), `${TNA_NATIVE_ROOT}/audio/se_graze.mp3`);

  // The web root is `layaide/assets/resources/tna`, so a naive join of an
  // already-prefixed name would double `tna`; the helper must not.
  const joined = tnaAssetUrl(stageBgmUrl('starlit_lanes'), false);
  expectEqual(joined, `${TNA_WEB_ROOT}/audio/bgm_stage_01_11.mp3`);
  expectEqual(joined.split('tna').length - 1, 1, `the tna segment must appear exactly once: ${joined}`);

  const nativeJoin = tnaAssetUrl(stageBgmUrl('lunar_maze'), true);
  expectEqual(nativeJoin, 'resources/tna/audio/bgm_stage_04_11.mp3');
  expectEqual(nativeJoin.split('tna').length - 1, 1, `the tna segment must appear exactly once: ${nativeJoin}`);
});

test('tnaAssetUrl tolerates a leading slash and an already-relative subpath', () => {
  expectEqual(tnaAssetUrl('/player/player_01.png', false), `${TNA_WEB_ROOT}/player/player_01.png`);
  expectEqual(tnaAssetUrl('bg_01_01.png', true), `${TNA_NATIVE_ROOT}/bg_01_01.png`);
});
