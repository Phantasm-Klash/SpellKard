/**
 * Regression tests for `core/game/tna_atlas_frames`.
 *
 * These pin the JSON-slicing contract that replaced the engine's `AtlasLoader`
 * path: the shipped `.atlas` files record the trim offset under **`offset`**
 * (LayaAir's loader wants `spriteSourceSize` and throws without it), so the
 * slicer must accept both spellings and never throw on a malformed document.
 *
 * The last case reads a real atlas from the imported TNA tree so a re-import
 * that changes the on-disk shape fails the build instead of silently regressing
 * the battle to vector art.
 */

import { sliceAtlasFrames, type TnaAtlasJson } from '../src/core/game/tna_atlas_frames';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

interface NodeFs {
  readFileSync(path: string, encoding: string): string;
}
declare const require: (id: string) => NodeFs;
declare const __dirname: string;

suite('tna atlas frame slicing');

test('offset-only frames (the shipped atlas shape) keep their offsets', () => {
  const rects = sliceAtlasFrames({
    frames: {
      'a.png': {
        frame: { x: 5, y: 6, w: 30, h: 40 },
        sourceSize: { w: 32, h: 48 },
        offset: { x: 3, y: 4 },
      },
    },
  });
  expectEqual(rects.length, 1);
  expectEqual(rects[0].name, 'a.png');
  expectEqual(rects[0].x, 5);
  expectEqual(rects[0].y, 6);
  expectEqual(rects[0].w, 30);
  expectEqual(rects[0].h, 40);
  expectEqual(rects[0].offsetX, 3);
  expectEqual(rects[0].offsetY, 4);
  expectEqual(rects[0].sourceW, 32);
  expectEqual(rects[0].sourceH, 48);
});

test('spriteSourceSize frames resolve identically', () => {
  const rects = sliceAtlasFrames({
    frames: {
      'b.png': {
        frame: { x: 1, y: 2, w: 10, h: 20 },
        spriteSourceSize: { x: 7, y: 8 },
        sourceSize: { w: 12, h: 22 },
      },
    },
  });
  expectEqual(rects.length, 1);
  expectEqual(rects[0].offsetX, 7);
  expectEqual(rects[0].offsetY, 8);
  expectEqual(rects[0].sourceW, 12);
  expectEqual(rects[0].sourceH, 22);
});

test('spriteSourceSize wins when both spellings are present', () => {
  const rects = sliceAtlasFrames({
    frames: {
      'c.png': {
        frame: { x: 0, y: 0, w: 8, h: 8 },
        spriteSourceSize: { x: 9, y: 10 },
        offset: { x: 1, y: 2 },
      },
    },
  });
  expectEqual(rects[0].offsetX, 9);
  expectEqual(rects[0].offsetY, 10);
});

test('a missing sourceSize falls back to the trimmed frame size', () => {
  const rects = sliceAtlasFrames({
    frames: { 'd.png': { frame: { x: 0, y: 0, w: 16, h: 24 }, offset: { x: 0, y: 0 } } },
  });
  expectEqual(rects[0].sourceW, 16);
  expectEqual(rects[0].sourceH, 24);
});

test('a missing offset falls back to zero', () => {
  const rects = sliceAtlasFrames({
    frames: { 'e.png': { frame: { x: 0, y: 0, w: 4, h: 4 } } },
  });
  expectEqual(rects[0].offsetX, 0);
  expectEqual(rects[0].offsetY, 0);
});

test('a missing or empty frames map yields [] without throwing', () => {
  expectEqual(sliceAtlasFrames({}).length, 0);
  expectEqual(sliceAtlasFrames({ meta: { image: 'x.png' } }).length, 0);
  expectEqual(sliceAtlasFrames({ frames: {} }).length, 0);
  expectEqual(sliceAtlasFrames({ frames: undefined }).length, 0);
});

test('malformed frame entries are skipped, not fatal', () => {
  const rects = sliceAtlasFrames({
    frames: {
      'ok.png': { frame: { x: 0, y: 0, w: 2, h: 2 } },
      'bad.png': 42 as unknown,
      'no-frame.png': { offset: { x: 0, y: 0 } },
    },
  });
  expectEqual(rects.length, 1);
  expectEqual(rects[0].name, 'ok.png');
});

test('multi-frame order follows the JSON key order', () => {
  const rects = sliceAtlasFrames({
    frames: {
      'z.png': { frame: { x: 0, y: 0, w: 1, h: 1 } },
      'a.png': { frame: { x: 1, y: 1, w: 1, h: 1 } },
      'm.png': { frame: { x: 2, y: 2, w: 1, h: 1 } },
    },
  });
  expectDeepEqual(
    rects.map((rect) => rect.name),
    ['z.png', 'a.png', 'm.png'],
  );
});

test('the shipped enemylist01.atlas slices stage_boss_01_11.png', () => {
  const fs = require('node:fs');
  const path = `${__dirname}/../../layaide/assets/resources/tna/enemylist01.atlas`;
  const json = JSON.parse(fs.readFileSync(path, 'utf8')) as TnaAtlasJson;
  const rects = sliceAtlasFrames(json);
  const boss = rects.find((rect) => rect.name === 'stage_boss_01_11.png');
  expect(boss !== undefined, 'stage_boss_01_11.png missing from enemylist01.atlas');
  expect(boss!.w > 0 && boss!.h > 0, `frame has zero size: ${boss!.w}x${boss!.h}`);
});
