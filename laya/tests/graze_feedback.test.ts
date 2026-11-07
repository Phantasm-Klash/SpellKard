/**
 * `graze_feedback.ts` 的单元覆盖 —— 客户端补帧擦弹**即时音效反馈**（非权威）。
 *
 * ★ 只验证「即时反馈」的几何 / 去重 / 限流 / 纯度，**不复刻权威计数**：
 *   不计 graze、不扣 lives、不发事件、不改快照、不上报（danmaku-delta-wire.md
 *   §5 / §8）。权威判定另见 `core/sim/boss_race.ts` 与
 *   `tests/boss_race_danmaku_mechanics.test.ts`。
 *
 * 单位：`BossRaceFrame` 的 `position` / `radius` / `grazeRadiusPx` 都是像素。
 * 这里用**整数像素**构造精确边界：`dist²` 与 `(弹半径+擦弹圈)²` 都是精确整数，
 * 不存在浮点误差，正好能把 `<=` 边界与「超出 1」区分开。
 */
import {
  computeInterpolatedGrazes,
  type GrazeFeedbackOptions,
} from '../src/core/game/graze_feedback';
import type {
  BossRaceFrame,
  BulletRenderItem,
  PlayerRenderItem,
} from '../src/core/game/boss_race_view_model';
import { expect, expectEqual, expectDeepEqual, suite, test } from './harness';

const LOCAL_ID = 'p1';
/** 判定点固定在 (100,100)；弹半径 3px、擦弹圈 20px → 擦弹半径 R=23, R²=529。 */
const PX = 100;
const PY = 100;
const BULLET_RADIUS = 3;
const GRAZE_RADIUS_PX = 20;

function makePlayer(overrides: Partial<PlayerRenderItem> = {}): PlayerRenderItem {
  return {
    playerId: LOCAL_ID,
    position: { x: PX, y: PY },
    isLocal: true,
    hitboxRadiusPx: 3,
    grazeRadiusPx: GRAZE_RADIUS_PX,
    invulnerable: false,
    invulnerableUntilTick: 0,
    lives: 3,
    bombs: 3,
    graze: 0,
    score: 0,
    hitCount: 0,
    spellGet: 0,
    spellTotal: 0,
    judgmentActive: true,
    ...overrides,
  };
}

/** `dx/dy` 是相对判定点的像素偏移。 */
function makeBullet(
  bulletId: string,
  dx: number,
  dy: number,
  overrides: Partial<BulletRenderItem> = {},
): BulletRenderItem {
  return {
    bulletId,
    patternId: 'test_ring',
    position: { x: PX + dx, y: PY + dy },
    radius: BULLET_RADIUS,
    angleRad: 0,
    ownerIsLocal: true,
    bulletKind: -1,
    motionFamily: 'unknown',
    angleDeg: 0,
    ...overrides,
  };
}

function makeFrame(
  bullets: BulletRenderItem[],
  player: PlayerRenderItem = makePlayer(),
): BossRaceFrame {
  return {
    tick: 100,
    state: 2,
    boss: null,
    opponentBoss: null,
    players: [player],
    bullets,
    bossEffects: [],
    chains: [],
    winnerPlayerId: '',
    matchOver: false,
    localHpRatio: 1,
    localDamageDealt: 0,
  };
}

function opts(overrides: Partial<GrazeFeedbackOptions> = {}): GrazeFeedbackOptions {
  return { localPlayerId: LOCAL_ID, ...overrides };
}

/** 深拷贝一份 frame，用于验证纯函数没有任何写入。 */
function cloneFrame<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

suite('graze_feedback: 补帧擦弹即时反馈（非权威）');

test('几何边界：dist² 正好等于 (弹半径+擦弹圈)² 算擦弹，超出 1 不算', () => {
  // R = 3 + 20 = 23, R² = 529。
  // eq:   dx=23,dy=0 → 529 = 529 → `<=` 边界命中。
  // over: dx=23,dy=1 → 530 = 529+1 → 超出 1，不算。
  // in:   dx=10,dy=0 → 100，明显在圈内。
  // out:  dx=30,dy=0 → 900，明显在圈外。
  const frame = makeFrame([
    makeBullet('eq', 23, 0),
    makeBullet('over', 23, 1),
    makeBullet('in', 10, 0),
    makeBullet('out', 30, 0),
  ]);
  const { ids } = computeInterpolatedGrazes(frame, opts());
  expect(ids.includes('eq'), 'dist² == R² 必须算擦弹（<= 边界）');
  expect(ids.includes('in'), '明显在圈内必须算擦弹');
  expect(!ids.includes('over'), 'dist² 只超出 1 就必须不算擦弹');
  expect(!ids.includes('out'), '明显在圈外不算擦弹');
  expectEqual(ids.length, 2, '恰好 eq + in 两颗');
});

test('去重：同一颗弹连续两帧都只在第一帧报一次', () => {
  const frame = makeFrame([makeBullet('b1', 10, 0)]);
  const first = computeInterpolatedGrazes(frame, opts());
  expectEqual(first.ids.length, 1, '第一帧报一次');
  expectEqual(first.ids[0], 'b1', '报的是 b1');
  expect(first.seen.has('b1'), 'b1 进入 seen');

  const second = computeInterpolatedGrazes(frame, opts({ seen: first.seen }));
  expectEqual(second.ids.length, 0, '第二帧不重复报');
  expect(second.seen.has('b1'), 'b1 仍留在 seen（去重链不断）');
});

test('弹消失后重新出现可以再报', () => {
  const present = makeFrame([makeBullet('b1', 10, 0)]);
  const gone = makeFrame([]); // b1 本帧消失（被权威 despawn / 出屏）
  const first = computeInterpolatedGrazes(present, opts());
  expectEqual(first.ids.length, 1, '首次出现报一次');

  const afterGone = computeInterpolatedGrazes(gone, opts({ seen: first.seen }));
  expectEqual(afterGone.ids.length, 0, '消失帧无弹可报');
  expect(!afterGone.seen.has('b1'), '消失的 b1 必须从 seen 剔除');

  const again = computeInterpolatedGrazes(present, opts({ seen: afterGone.seen }));
  expectEqual(again.ids.length, 1, '重新出现可以再报（当作新的一颗弹）');
  expectEqual(again.ids[0], 'b1', '再报的是 b1');
});

test('hidden 弹已被上游过滤：不在 frame.bullets 就不会被报，也不留在 seen', () => {
  // buildBossRaceFrame:332 过滤 `bullet.hidden === true`，hidden 弹根本不进
  // frame.bullets。这里模拟过滤结果：只有一颗可见弹，另把一个 hidden 的 id
  // 塞进旧 seen，验证纯函数只认 frame.bullets、不臆造弹、并把死 id 剔除。
  const frame = makeFrame([makeBullet('visible', 10, 0)]);
  const result = computeInterpolatedGrazes(
    frame,
    opts({ seen: new Set<string>(['hidden_b', 'stale_b']) }),
  );
  expectEqual(result.ids.length, 1, '只报可见弹');
  expectEqual(result.ids[0], 'visible', '报的是可见弹');
  expect(!result.ids.includes('hidden_b'), 'hidden 弹不在 frame.bullets，绝不报');
  expect(!result.seen.has('hidden_b'), '不在 frame.bullets 的 hidden id 从 seen 剔除');
  expect(!result.seen.has('stale_b'), '不在 frame.bullets 的过期 id 从 seen 剔除');
});

test('invulnerable：options 显式抑制与 frame 玩家无敌态都抑制', () => {
  const frame = makeFrame([makeBullet('b1', 10, 0)]);
  const explicit = computeInterpolatedGrazes(frame, opts({ invulnerable: true }));
  expectEqual(explicit.ids.length, 0, 'options.invulnerable=true 不返回');

  const invulnFrame = makeFrame(
    [makeBullet('b1', 10, 0)],
    makePlayer({ invulnerable: true, invulnerableUntilTick: 180 }),
  );
  const fromFrame = computeInterpolatedGrazes(invulnFrame, opts());
  expectEqual(fromFrame.ids.length, 0, 'frame 里 local.invulnerable=true 也不返回（自动与服务端同步）');

  // 抑制只影响本次返回，seen 的裁剪依然正确。
  expect(!explicit.seen.has('b1'), '抑制时未报的弹不进 seen');
});

test('maxPerFrame：默认 4、可显式调小、0 表示本帧不报', () => {
  const six = makeFrame([
    makeBullet('b1', 5, 0),
    makeBullet('b2', 6, 0),
    makeBullet('b3', 7, 0),
    makeBullet('b4', 8, 0),
    makeBullet('b5', 9, 0),
    makeBullet('b6', 10, 0),
  ]);
  const defaulted = computeInterpolatedGrazes(six, opts());
  expectEqual(defaulted.ids.length, 4, '默认上限 4');
  expectEqual(defaulted.seen.size, 4, '被上限抑制的弹不进 seen（仍是「新进入」）');

  const two = computeInterpolatedGrazes(six, opts({ maxPerFrame: 2 }));
  expectEqual(two.ids.length, 2, '显式上限 2');

  const zero = computeInterpolatedGrazes(six, opts({ maxPerFrame: 0 }));
  expectEqual(zero.ids.length, 0, 'maxPerFrame=0 本帧不返回');
});

test('seen 不无限增长：滚动 60 帧始终只保留当前帧相关 id', () => {
  let seen: ReadonlySet<string> = new Set<string>();
  for (let i = 0; i < 60; i += 1) {
    // 每帧换一颗唯一新弹，上一颗随即消失。
    const id = `b${i}`;
    const frame = makeFrame([makeBullet(id, 10, 0)]);
    const result = computeInterpolatedGrazes(frame, opts({ seen }));
    expect(result.seen.size <= 1, `第 ${i} 帧 seen 必须有界（<=1）`);
    seen = result.seen;
  }
  expectEqual(seen.size, 1, '60 帧后 seen 仍只有 1 个 id');
  expect(seen.has('b59'), 'seen 只保留最后一帧的弹');
  expect(!seen.has('b0'), '最早的弹已被剔除');
});

test('不修改 frame / options.seen / 任何权威字段（深拷贝对比）', () => {
  const frame = makeFrame([
    makeBullet('b1', 10, 0),
    makeBullet('b2', 23, 0),
  ]);
  const before = cloneFrame(frame);
  const inputSeen = new Set<string>(['b1']);
  const inputSeenBefore = new Set(inputSeen);

  const result = computeInterpolatedGrazes(frame, opts({ seen: inputSeen }));

  expectDeepEqual(frame, before, 'frame 逐字段未被修改');
  expectDeepEqual([...inputSeen], [...inputSeenBefore], '传入的 seen 未被修改');
  expect(result.seen !== inputSeen, '返回的是新的 seen 对象，不是入参引用');
  // 权威读数原样透传、不被当作擦弹计数写回。
  expectEqual(frame.players[0].graze, 0, 'graze 计数不变');
  expectEqual(frame.players[0].lives, 3, 'lives 不变');
  expectEqual(frame.players[0].bombs, 3, 'bombs 不变');
  expectEqual(frame.tick, 100, 'tick 不变');
});

test('判定 HUD 关闭（judgmentActive=false）时零擦弹，即使擦弹圈半径仍非零', () => {
  // boss_race_view_model.ts:298 在 judgmentActive===false 时把 grazeRadiusPx
  // 置 0；这里故意保留非零半径制造矛盾数据，锁住卫兵必须**显式**判
  // judgmentActive，不能只靠 grazeRadiusPx>0 —— 否则会退化成
  // (bullet.radius+0)² 把命中圈误判成擦弹。弹压在判定点上（dist²=0），
  // 没有卫兵时必然误报。
  const frame = makeFrame(
    [makeBullet('b1', 0, 0)],
    makePlayer({ judgmentActive: false, grazeRadiusPx: GRAZE_RADIUS_PX }),
  );
  const result = computeInterpolatedGrazes(frame, opts({ seen: new Set<string>(['stale']) }));
  expectEqual(result.ids.length, 0, '判定 HUD 关闭时零擦弹');
  expect(!result.ids.includes('b1'), '压在判定点上的弹也不报');
  expect(!result.seen.has('stale'), '抑制路径仍清理 seen（剔除已消失弹）');
});

test('加固：只判归属本地玩家的弹、判定系统未启用时不报、无本地玩家不报', () => {
  const foreign = computeInterpolatedGrazes(
    makeFrame([makeBullet('b1', 10, 0, { ownerIsLocal: false })]),
    opts(),
  );
  expectEqual(foreign.ids.length, 0, 'ownerIsLocal=false（对手副本的弹）不报');

  const zeroRing = computeInterpolatedGrazes(
    // judgmentActive 仍为 true、只把半径置 0，单独锁住卫兵的第二个条件。
    makeFrame([makeBullet('b1', 0, 0)], makePlayer({ grazeRadiusPx: 0 })),
    opts(),
  );
  expectEqual(zeroRing.ids.length, 0, 'grazeRadiusPx<=0 零擦弹，避免把命中圈误当擦弹圈');

  const noLocal = computeInterpolatedGrazes(
    makeFrame([makeBullet('b1', 10, 0)], makePlayer({ playerId: 'someone_else', isLocal: false })),
    opts(),
  );
  expectEqual(noLocal.ids.length, 0, 'frame 里没有 localPlayerId 对应的玩家时不报');
});
