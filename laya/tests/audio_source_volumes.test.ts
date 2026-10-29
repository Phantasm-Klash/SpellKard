/**
 * 每个自机 / Boss 的独立音量。
 *
 * 这些映射要走 JSON 往返，也可能被手改，所以归一化的规则要钉住：
 * 值钳到 0..1、非数字丢掉、键一个不动。
 */

import { expectDeepEqual, expectEqual, suite, test } from './harness';
import { defaultSettings, type AudioSettings } from '../src/core/settings/schema';
import { normalizeSettings, resolveVolumes } from '../src/core/settings/normalize';

suite('audio: one volume per character and per boss');

test('the defaults start empty, so nothing is pre-seeded', () => {
  expectDeepEqual(Object.keys(defaultSettings().audio.characterVolumes), []);
  expectDeepEqual(Object.keys(defaultSettings().audio.bossVolumes), []);
});

test('a saved per-id volume survives a round-trip', () => {
  const settings = normalizeSettings({
    audio: { characterVolumes: { reimu: 0.4 }, bossVolumes: { tian: 0.25 } },
  });
  expectEqual(settings.audio.characterVolumes.reimu, 0.4, 'the character volume');
  expectEqual(settings.audio.bossVolumes.tian, 0.25, 'the boss volume');
});

test('out-of-range values are clamped, not rejected', () => {
  const settings = normalizeSettings({
    audio: { characterVolumes: { a: 5, b: -2 }, bossVolumes: { c: 1.4, d: -0.1 } },
  });
  expectEqual(settings.audio.characterVolumes.a, 1, 'above 1 becomes 1');
  expectEqual(settings.audio.characterVolumes.b, 0, 'below 0 becomes 0');
  expectEqual(settings.audio.bossVolumes.c, 1, 'above 1 becomes 1');
  expectEqual(settings.audio.bossVolumes.d, 0, 'below 0 becomes 0');
});

test('entries that are not numbers are dropped', () => {
  const settings = normalizeSettings({
    audio: {
      characterVolumes: { good: 0.5, bad: 'loud', worse: null, nan: Number.NaN },
      bossVolumes: { ok: 0.5, nope: 'quiet' },
    },
  });
  expectDeepEqual(Object.keys(settings.audio.characterVolumes).sort(), ['good']);
  expectDeepEqual(Object.keys(settings.audio.bossVolumes).sort(), ['ok']);
  expectEqual(settings.audio.characterVolumes.good, 0.5, 'the good one is kept');
});

test('a missing map becomes an empty one, never undefined', () => {
  const settings = normalizeSettings({ audio: { masterVolume: 0.5 } });
  expectDeepEqual(Object.keys(settings.audio.characterVolumes), []);
  expectDeepEqual(Object.keys(settings.audio.bossVolumes), []);
});

test('the per-id maps are left alone by the channel mix', () => {
  // The channel volumes are what `resolveVolumes` returns; the per-id ones are
  // read at play time, so they must not leak into the resolved mix.
  const audio: AudioSettings = {
    ...defaultSettings().audio,
    masterVolume: 1,
    skillVolume: 0.5,
    characterVolumes: { reimu: 0.25 },
  };
  const resolved = resolveVolumes(audio);
  expectEqual(resolved.skill, 0.5, 'the channel gain is unaffected');
  expectEqual(audio.characterVolumes.reimu, 0.25, 'and the map is untouched');
});

test('muting still zeroes the channels with per-id volumes set', () => {
  const audio: AudioSettings = {
    ...defaultSettings().audio,
    muted: true,
    characterVolumes: { reimu: 1 },
    bossVolumes: { tian: 1 },
  };
  const resolved = resolveVolumes(audio);
  expectEqual(resolved.playerShot, 0, 'mute wins over a full slider');
  expectEqual(resolved.skill, 0, 'for every channel');
});
