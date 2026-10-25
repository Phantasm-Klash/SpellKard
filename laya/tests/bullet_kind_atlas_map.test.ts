/**
 * P5 客户端美术一致性：`kEnemyBullet` → TNA 图集帧 的映射与判定 HUD 状态。
 *
 * 三件事在这里钉死：
 *
 *  1. **映射完整性**（216 个 kind 全覆盖、无 undefined、无重复）；
 *  2. **三源一致**：`bullet_kind.ts`（TS 镜像）↔
 *     `layaide/assets/resources/tna/index.json`（`tools/import_tna_atlas.py` 从
 *     APK 切图产出）↔ `docs/apk-reverse-notes/patterns/bullet_kind_table.md`
 *     （`EnemyBullet::spriteWithFile` 分派表逆向，抽查代表 kind 硬编码在下方）。
 *     逆向 md 在仓库外，所以测试只硬编码**每个物种的代表 kind**——它是
 *     「物种划分」这一层契约的最小可执行副本。
 *  3. **不静默回退**：`animatedFrameFor` 在任意 tick 上都必须给出图集里真实存在
 *     的帧，否则渲染会悄悄退回矢量弹（用户可见的美术不一致）。
 *
 * 另附判定 HUD（残机/炸弹/擦弹/无敌）的状态映射，保证「侧栏/战场读数」与
 * 场上自机闪烁同相。
 */

import { BULLET_KINDS, BULLET_SPECIES, bulletKindInfo } from '../src/core/sim/danmaku/bullet_kind';
import {
  animatedFrameFor,
  describeBulletKind,
  isKnownBulletKind,
  speciesFrames,
} from '../src/core/game/bullet_visual';
import {
  buildJudgmentHud,
  buildBossRaceFrame,
  invulnerableBlinkOn,
  INVULNERABLE_BLINK_TICKS,
  PlayfieldTransform,
  type PlayfieldLayout,
} from '../src/core/game/boss_race_view_model';
import { battleLayout } from '../src/core/game/battle_layout';
import {
  SNAPSHOT_DEFAULT_BOMBS,
  SNAPSHOT_DEFAULT_LIVES,
  type BossRacePlayerSnapshot,
  type BossRaceSnapshot,
} from '../src/core/sim/boss_race';
import { expect, expectClose, expectEqual, suite, test } from './harness';

declare const require: (id: string) => unknown;
declare const __dirname: string;

interface AtlasIndex {
  frames: Record<string, { atlas: string; frame: string; w: number; h: number }>;
  kinds: Record<string, { atlas: string; frame: string }>;
}

const index = require(`${__dirname}/../../layaide/assets/resources/tna/index.json`) as AtlasIndex;

/** 640×960 参考布局（美术原生尺寸，transform scale = 1）。 */
const LAYOUT_640_960: PlayfieldLayout = { width: 640, height: 960 };

/**
 * 43 物种 × 代表 kind → 物种名。
 *
 * 来源：`docs/apk-reverse-notes/patterns/bullet_kind_table.md`（216 条逐 type
 * 明细，每 9 个连续 type 共享物种，帧号 01–09）。这里每个物种取**首帧**
 * （`_01` 或该物种在表里的第一个帧），用来钉住「物种边界」而不是逐个 type
 * 抄 216 行。
 */
const SPECIES_REPRESENTATIVE: ReadonlyArray<readonly [number, string]> = [
  [9, 'kusabi'],
  [18, 'fuda'],
  [27, 'ring'],
  [36, 'stama'],
  [45, 'kome'],
  [54, 'dkome'],
  [63, 'shoshi'],
  [72, 'sstama'],
  [81, 'dsstama'],
  [90, 'arrow'],
  [99, 'sizuku'],
  [108, 'hyou'],
  [117, 'dangan'],
  [126, 'kunai'],
  [135, 'zeni'],
  [138, 'mhoshi'],
  [147, 'mtama'],
  [156, 'chou'],
  [165, 'bean'],
  [174, 'heart'],
  [183, 'knife'],
  [192, 'ltama'],
  [197, 'kou'],
  [204, 'sun'],
  [205, 'delay'],
  [206, 'en_01'],
  [207, 'en_02'],
  [208, 'en_04'],
  [209, 'en_05'],
  [210, 'en_07'],
  [211, 'en_08'],
  [212, 'onpu_02'],
  [213, 'onpu_04'],
  [214, 'onpu_05'],
  [215, 'onpu_07'],
  [216, 'onpu_08'],
  [217, 'bird'],
  [218, 'human'],
  [219, 'dark'],
  [220, 'poison'],
  [221, 'anchor'],
  [222, 'spark'],
  [224, 'unzan'],
];

function snapshotWithPlayers(players: BossRacePlayerSnapshot[]): BossRaceSnapshot {
  return {
    tick: 100,
    state: 1,
    players,
    bullets: [],
    winnerPlayerId: '',
  } as unknown as BossRaceSnapshot;
}

function player(overrides: Partial<BossRacePlayerSnapshot>): BossRacePlayerSnapshot {
  return {
    playerId: 'p1',
    xMilli: 0,
    yMilli: 0,
    bossCurrentHp: 6000,
    damageDealt: 0,
    connected: true,
    ...overrides,
  };
}

suite('bullet kind → atlas frame map');

test('216 kinds cover 9..224 with no gap and no duplicate', () => {
  expectEqual(BULLET_KINDS.length, 216, 'BULLET_KINDS holds every kEnemyBullet value');
  expectEqual(BULLET_KINDS[0].type, 9, 'first kind');
  expectEqual(BULLET_KINDS[BULLET_KINDS.length - 1].type, 224, 'last kind');
  const seen = new Set<number>();
  for (let type = 9; type <= 224; type += 1) {
    const info = bulletKindInfo(type);
    expect(info !== undefined, `kind ${type} must be defined (no hole in the enum mirror)`);
    expect(!seen.has(type), `kind ${type} must appear once`);
    seen.add(type);
    expect(isKnownBulletKind(type), `isKnownBulletKind(${type})`);
    expect(info!.frame.endsWith('.png'), `kind ${type} frame is a .png name`);
    expect(info!.atlas.startsWith('bulletlist'), `kind ${type} atlas is a bulletlist atlas`);
  }
  expectEqual(seen.size, 216, 'every kind seen exactly once');
});

test('out-of-range kinds are unknown (the only legitimate vector fallback)', () => {
  for (const type of [0, 1, 8, 225, 226, -1, 1000]) {
    expectEqual(bulletKindInfo(type), undefined, `kind ${type} has no atlas mapping`);
    expectEqual(describeBulletKind(type), null, `describeBulletKind(${type}) is null`);
    expect(!isKnownBulletKind(type), `isKnownBulletKind(${type}) is false`);
  }
});

test('the TS mirror agrees with the generated atlas index (independent source)', () => {
  const indexKinds = Object.keys(index.kinds);
  expectEqual(indexKinds.length, 216, 'index.json lists 216 kinds');
  for (const info of BULLET_KINDS) {
    const entry = index.kinds[String(info.type)];
    expect(entry !== undefined, `index.json has kind ${info.type}`);
    expectEqual(entry!.atlas, info.atlas, `kind ${info.type} atlas`);
    expectEqual(entry!.frame, info.frame, `kind ${info.type} frame`);
  }
});

test('every kind resolves to a frame that really exists in its atlas', () => {
  for (const info of BULLET_KINDS) {
    const frame = index.frames[`${info.atlas}/${info.frame}`];
    expect(frame !== undefined, `kind ${info.type} frame ${info.atlas}/${info.frame} exists`);
    expect(frame!.w > 0 && frame!.h > 0, `kind ${info.type} frame has a non-empty rect`);
  }
});

test('43 species, each with a representative kind mapping to its species', () => {
  expectEqual(BULLET_SPECIES.length, 43, '43 bullet species');
  expectEqual(SPECIES_REPRESENTATIVE.length, 43, 'the spot-check table covers every species');
  for (const [type, species] of SPECIES_REPRESENTATIVE) {
    const descriptor = describeBulletKind(type);
    expect(descriptor !== null, `kind ${type} describes`);
    expectEqual(descriptor!.species, species, `kind ${type} species`);
  }
  // The spot-check table's species set must equal BULLET_SPECIES' set.
  const declared = BULLET_SPECIES.map((entry) => entry.species).sort();
  const checked = SPECIES_REPRESENTATIVE.map(([, species]) => species).sort();
  expectEqual(declared.join(','), checked.join(','), 'species names match one-for-one');
});

test('species partition: every kind belongs to exactly one species, frames share its prefix', () => {
  const owner = new Map<number, string>();
  for (const entry of BULLET_SPECIES) {
    expect(entry.types.length > 0, `species ${entry.species} has at least one kind`);
    for (const type of entry.types) {
      expect(!owner.has(type), `kind ${type} listed by a single species`);
      owner.set(type, entry.species);
    }
  }
  expectEqual(owner.size, 216, 'the species partition covers all 216 kinds');
  for (const info of BULLET_KINDS) {
    const species = owner.get(info.type);
    expect(species !== undefined, `kind ${info.type} is owned by a species`);
    expectEqual(describeBulletKind(info.type)!.species, species, `kind ${info.type} species derives from its frame`);
    const frames = speciesFrames(species!);
    expect(frames.includes(info.frame), `kind ${info.type} frame belongs to species ${species}`);
  }
});

test('local frame animation never asks for a frame the atlas does not have', () => {
  // 缺帧 = 静默回退到矢量弹（美术不一致）。逐 kind × 若干 tick 全量扫一遍。
  for (const info of BULLET_KINDS) {
    for (const tick of [0, 1, 7, 8, 15, 16, 31, 60, 119]) {
      const frame = animatedFrameFor(info.type, tick);
      expect(frame !== '', `kind ${info.type} tick ${tick} animates to a frame`);
      const found = index.frames[`${info.atlas}/${frame}`];
      expect(
        found !== undefined,
        `kind ${info.type} tick ${tick} → ${info.atlas}/${frame} must exist in the atlas`,
      );
    }
  }
});

test('a species with fewer than 9 frames only cycles through the frames it has', () => {
  // kou 只用了 01/02/04/05/06/07/08（缺 03/09），ltama 只有 02/04/05/07/08。
  expectEqual(speciesFrames('kou').length, 7, 'kou has 7 frames');
  expectEqual(speciesFrames('ltama').length, 5, 'ltama has 5 frames');
  expect(!speciesFrames('kou').includes('kou_03.png'), 'kou_03 is not a kind frame');
  for (const species of ['kou', 'ltama', 'zeni', 'spark', 'sun', 'delay']) {
    for (const frame of speciesFrames(species)) {
      const atlas = describeBulletKind(BULLET_KINDS.find((k) => k.frame === frame)!.type)!.atlas;
      expect(index.frames[`${atlas}/${frame}`] !== undefined, `${atlas}/${frame} exists`);
    }
  }
});

test('bullet art scale and the playfield transform use the same ratio', () => {
  // 美术按 640 宽排版（`battle_scene.ts` artScale = playfield.width / 640），
  // 位置按 `PlayfieldTransform`（屏幕盒 640×960 等比缩放 + 居中）。两者必须是
  // 同一个比例，否则子弹的**大小**与**间距**会互相错位。
  const stages = [
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 768, height: 1024 },
    { width: 480, height: 800 },
    { width: 1280, height: 720 },
    { width: 640, height: 960 },
  ];
  for (const stage of stages) {
    const geometry = battleLayout(stage.width, stage.height);
    const transform = new PlayfieldTransform(geometry.playfield);
    const artScale = geometry.playfield.width / 640;
    // `transform.scale` 是「像素 / milli」，`artScale` 是「像素 / 美术像素」；
    // 原版 1 个美术像素 = 1000 milli（640px 宽 = 640000 milli 屏盒），所以
    // `radiusToPixels(1000)` 必须正好等于 artScale。
    expectClose(
      transform.radiusToPixels(1000),
      artScale,
      1e-12,
      `stage ${stage.width}x${stage.height}: one art pixel == 1000 milli`,
    );
  }
  // 640×960 参考布局：1 个美术像素 = 1 个屏幕像素（1 milli = 1/1000 px）。
  const reference = new PlayfieldTransform(LAYOUT_640_960);
  expectEqual(reference.scale, 1 / 1000, 'reference layout scales 1000 milli per pixel');
  expectEqual(reference.radiusToPixels(1000), 1, 'reference layout draws art at 1:1');
  expectEqual(reference.offsetX, 0, 'reference layout has no letterbox x');
  expectEqual(reference.offsetY, 0, 'reference layout has no letterbox y');
});

suite('judgment HUD state');

test('no judgment HUD without the server fields (default ruleset)', () => {
  const frame = buildBossRaceFrame(
    snapshotWithPlayers([player({ lives: undefined, bombs: undefined, graze: undefined })]),
    { layout: LAYOUT_640_960, localPlayerId: 'p1', bossMaxHp: 6000 },
  );
  expectEqual(frame.players[0].judgmentActive, false, 'default ruleset has no judgment fields');
  expectEqual(buildJudgmentHud(frame), null, 'nothing is drawn instead of placeholder icons');
});

test('lives / bombs / graze pass through to the HUD state', () => {
  const frame = buildBossRaceFrame(
    snapshotWithPlayers([player({ lives: 2, bombs: 1, graze: 37 })]),
    { layout: LAYOUT_640_960, localPlayerId: 'p1', bossMaxHp: 6000 },
  );
  const hud = buildJudgmentHud(frame);
  expect(hud !== null, 'judgment HUD exists');
  expectEqual(hud!.lives, 2, 'lives');
  expectEqual(hud!.bombs, 1, 'bombs');
  expectEqual(hud!.graze, 37, 'graze');
  expectEqual(hud!.exhausted, false, 'still alive');
  expectEqual(hud!.invulnerable, false, 'not invulnerable');
  expectEqual(hud!.invulnerableTicksRemaining, 0, 'no invulnerable countdown');
  expectEqual(hud!.blinkOn, true, 'no blink outside the invulnerable window');
});

test('lives at zero flags the exhausted state without hiding the readout', () => {
  const frame = buildBossRaceFrame(
    snapshotWithPlayers([player({ lives: 0, bombs: 0, graze: 120 })]),
    { layout: LAYOUT_640_960, localPlayerId: 'p1', bossMaxHp: 6000 },
  );
  const hud = buildJudgmentHud(frame)!;
  expectEqual(hud.lives, 0, 'lives 0');
  expectEqual(hud.bombs, 0, 'bombs 0');
  expectEqual(hud.graze, 120, 'graze still reported');
  expectEqual(hud.exhausted, true, 'exhausted');
});

test('negative counters clamp to zero instead of drawing a negative row', () => {
  const frame = buildBossRaceFrame(
    snapshotWithPlayers([player({ lives: -1, bombs: -2, graze: -3 })]),
    { layout: LAYOUT_640_960, localPlayerId: 'p1', bossMaxHp: 6000 },
  );
  const hud = buildJudgmentHud(frame)!;
  expectEqual(hud.lives, 0, 'lives clamped');
  expectEqual(hud.bombs, 0, 'bombs clamped');
  expectEqual(hud.graze, 0, 'graze clamped');
  expectEqual(hud.exhausted, true, 'clamped lives 0 is exhausted');
});

test('the invulnerable window reports the remaining ticks and blinks in phase', () => {
  const frame = buildBossRaceFrame(
    snapshotWithPlayers([player({ lives: 3, bombs: 3, graze: 5, invulnerableUntilTick: 140 })]),
    { layout: LAYOUT_640_960, localPlayerId: 'p1', bossMaxHp: 6000 },
  );
  const hud = buildJudgmentHud(frame)!;
  expectEqual(hud.invulnerable, true, 'tick 100 <= 140');
  expectEqual(hud.invulnerableTicksRemaining, 40, '140 - 100 remaining');
  expectEqual(hud.blinkOn, invulnerableBlinkOn(frame.tick, true), 'HUD uses the shared phase');
});

test('the blink phase is 4 on / 4 off and matches the actor blink', () => {
  expectEqual(INVULNERABLE_BLINK_TICKS, 8, '8 tick period ≈ 8Hz at 60Hz');
  const phases: boolean[] = [];
  for (let tick = 0; tick < 16; tick += 1) {
    phases.push(invulnerableBlinkOn(tick, true));
  }
  expectEqual(
    phases.map((on) => (on ? '1' : '0')).join(''),
    '1111000011110000',
    'four ticks lit, four dark',
  );
  // 不在无敌期 → 永远亮（不闪）。
  for (let tick = 0; tick < 16; tick += 1) {
    expectEqual(invulnerableBlinkOn(tick, false), true, 'no blink outside invulnerability');
  }
});

test('the HUD reads the local player only', () => {
  const frame = buildBossRaceFrame(
    snapshotWithPlayers([
      player({ playerId: 'p1', lives: 1, bombs: 2, graze: 10 }),
      player({ playerId: 'p2', lives: 3, bombs: 0, graze: 99 }),
    ]),
    { layout: LAYOUT_640_960, localPlayerId: 'p1', bossMaxHp: 6000 },
  );
  const hud = buildJudgmentHud(frame)!;
  expectEqual(hud.lives, 1, 'local lives, not the rival’s');
  expectEqual(hud.bombs, 2, 'local bombs');
  expectEqual(hud.graze, 10, 'local graze');
});

test('a missing local player degrades to no judgment HUD', () => {
  const frame = buildBossRaceFrame(
    snapshotWithPlayers([player({ playerId: 'p2', lives: 2, bombs: 2, graze: 2 })]),
    { layout: LAYOUT_640_960, localPlayerId: 'p1', bossMaxHp: 6000 },
  );
  expectEqual(buildJudgmentHud(frame), null, 'no local player → no judgment HUD');
});

test('the wire placeholders stay distinguishable from real values', () => {
  const frame = buildBossRaceFrame(
    snapshotWithPlayers([player({})]),
    { layout: LAYOUT_640_960, localPlayerId: 'p1', bossMaxHp: 6000 },
  );
  const local = frame.players[0];
  expectEqual(local.judgmentActive, false, 'no judgment fields → inactive');
  expectEqual(local.lives, SNAPSHOT_DEFAULT_LIVES, 'wire placeholder lives');
  expectEqual(local.bombs, SNAPSHOT_DEFAULT_BOMBS, 'wire placeholder bombs');
  expectEqual(local.grazeRadiusPx, 0, 'no graze ring');
});
