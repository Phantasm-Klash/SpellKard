/**
 * Atlas-index integrity test.
 *
 * Reads the runtime index produced by `tools/import_tna_atlas.py`
 * (`layaide/assets/resources/tna/index.json`) and checks that every one of the
 * 216 `kEnemyBullet` frames the client can ask for is actually present, and that
 * the recorded coordinates fit inside their atlas textures.
 *
 * The file is loaded with `require` so the test needs no Node type packages;
 * `__dirname` resolves from `.test-build/tests/` back to the project root.
 */

import { BULLET_KINDS } from '../src/core/sim/danmaku/bullet_kind';
import { TNA_BACKGROUND_IMAGE, allActorFrames } from '../src/core/game/tna_actor_frames';
import { allCoopArtFrames } from '../src/core/game/coop_art';
import { allUiAssets } from '../src/core/game/ui_assets';
import { expect, expectEqual, suite, test } from './harness';

declare const require: (id: string) => unknown;
declare const __dirname: string;

interface AtlasIndexFrame {
  atlas: string;
  frame: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sourceW: number;
  sourceH: number;
  offsetX: number;
  offsetY: number;
  rotated: boolean;
  clamped: boolean;
}

interface AtlasIndex {
  meta: {
    frame_count: number;
    atlas_count: number;
    kind_count: number;
    player_count: number;
    clamped_count: number;
  };
  atlases: Record<string, { texture: string; size: { w: number; h: number }; frames: number }>;
  frames: Record<string, AtlasIndexFrame>;
  kinds: Record<string, { atlas: string; frame: string }>;
  players: string[];
  backgrounds?: string[];
  ui?: string[];
}

const index = require(`${__dirname}/../../layaide/assets/resources/tna/index.json`) as AtlasIndex;

suite('tna atlas index');

test('the index describes 25 atlases / 570 frames / 216 kinds', () => {
  expectEqual(index.meta.atlas_count, 25);
  expectEqual(index.meta.frame_count, 570);
  expectEqual(index.meta.kind_count, 216);
  expectEqual(Object.keys(index.atlases).length, 25);
  expectEqual(Object.keys(index.frames).length, 570);
});

test('all 13 player portraits plus the extra variant are listed', () => {
  expect(index.meta.player_count >= 13, `expected >= 13 players, got ${index.meta.player_count}`);
  for (let i = 1; i <= 13; i += 1) {
    const name = `player/player_${String(i).padStart(2, '0')}.png`;
    expect(index.players.includes(name), `missing ${name}`);
  }
});

test('every kEnemyBullet frame resolves to an indexed atlas frame', () => {
  const missing: string[] = [];
  for (const kind of BULLET_KINDS) {
    const key = `${kind.atlas}/${kind.frame}`;
    if (index.frames[key] === undefined) {
      missing.push(`${kind.type}:${key}`);
    }
  }
  expect(missing.length === 0, `unindexed kind frames: ${missing.slice(0, 10).join(', ')}`);
});

test('the kind → frame table in the index matches the TS mirror', () => {
  for (const kind of BULLET_KINDS) {
    const entry = index.kinds[String(kind.type)];
    expect(entry !== undefined, `index has no kind ${kind.type}`);
    expectEqual(entry!.atlas, kind.atlas, `atlas for kind ${kind.type}`);
    expectEqual(entry!.frame, kind.frame, `frame for kind ${kind.type}`);
  }
});

test('every indexed frame lies inside its atlas texture bounds', () => {
  for (const [key, frame] of Object.entries(index.frames)) {
    const atlas = index.atlases[frame.atlas];
    expect(atlas !== undefined, `frame ${key} references unknown atlas ${frame.atlas}`);
    expect(frame.x >= 0 && frame.y >= 0, `frame ${key} has negative origin`);
    expect(
      frame.x + frame.w <= atlas!.size.w && frame.y + frame.h <= atlas!.size.h,
      `frame ${key} exceeds atlas ${frame.atlas} (${atlas!.size.w}x${atlas!.size.h})`,
    );
  }
});

test('the four stale out-of-bounds frames were clamped, not dropped', () => {
  // ply_shot_04/06 ship a few frames whose plist rect escapes the texture
  // (see rev/docs/porting_plan.md §7). The importer crops them so the atlas
  // stays loadable; they are not part of the 216 bullet kinds.
  expectEqual(index.meta.clamped_count, 4);
  const clamped = Object.entries(index.frames).filter(([, frame]) => frame.clamped);
  expectEqual(clamped.length, 4);
  for (const [key, frame] of clamped) {
    expect(frame.w > 0 && frame.h > 0, `clamped frame ${key} collapsed to zero size`);
  }
});

test('the frame count per atlas adds up to 570', () => {
  const total = Object.values(index.atlases).reduce((sum, atlas) => sum + atlas.frames, 0);
  expectEqual(total, 570);
});

test('every Boss / player actor frame the view requests exists in the atlas', () => {
  // Pins `core/game/tna_actor_frames.ts` to the imported index: a re-import that
  // renames a boss or player frame would otherwise silently fall back to vector.
  for (const actor of allActorFrames()) {
    const key = `${actor.atlas}/${actor.frame}`;
    expect(index.frames[key] !== undefined, `missing actor frame ${key}`);
  }
});

test('every coop art frame (boss / ships / bullets) exists in the atlas', () => {
  // Pins `core/game/coop_art.ts` to the imported index. The coop view draws real
  // TNA sprites only, so a missing frame would leave a blank actor instead of a
  // vector fallback — fail the build rather than ship a hole.
  for (const art of allCoopArtFrames()) {
    const key = `${art.atlas}/${art.frame}`;
    expect(index.frames[key] !== undefined, `missing coop art frame ${key}`);
  }
});

test('the playfield backdrop image is listed in the index', () => {
  expect(index.backgrounds !== undefined, 'index has no backgrounds list');
  expect(index.backgrounds!.includes(TNA_BACKGROUND_IMAGE), `missing backdrop ${TNA_BACKGROUND_IMAGE}`);
});

test('every UI asset is listed in the index and exists on disk', () => {
  // Pins `core/game/ui_assets.ts` to the imported tree: the UI art is imported
  // as standalone PNGs under `tna/ui/` (plus the menu backdrop, which lives at
  // the tree root and is registered in `backgrounds`), so a missing file means
  // a blank widget. Both lists count as "listed".
  expect(index.ui !== undefined, 'index has no ui list');
  const listed = new Set([...index.ui!, ...(index.backgrounds ?? [])]);
  const fs = require('fs') as { existsSync(path: string): boolean };
  for (const asset of allUiAssets()) {
    expect(listed.has(asset), `ui asset ${asset} is not listed in index.ui / index.backgrounds`);
    const file = `${__dirname}/../../layaide/assets/resources/tna/${asset}`;
    expect(fs.existsSync(file), `missing ui file ${asset}`);
  }
});

test('the imported UI set keeps the menu backdrop and the pause icon', () => {
  expect(index.ui!.includes('ui/btn_pause.png'), 'missing pause icon');
  expect(index.ui!.includes('ui/e_life_bar_2.png'), 'missing boss life ring');
  expect(index.backgrounds!.includes('bg_menu.png'), 'missing menu backdrop');
});
