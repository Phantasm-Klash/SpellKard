/**
 * 「弹幕机制全开」客户端改动回归测试。
 *
 * 覆盖四块：
 *  1. `BossRaceConfig.allFeaturesEnabled` 总开关（默认开 / 显式关回退 / `??`
 *     优先级），并确认回退时判定不触发、与改动前逐字节一致；
 *  2. `buildInterpolatedBossRaceFrame` 把 `interpolateFrames` 接进渲染路径
 *     （相邻两快照补帧、缺帧/不相邻回退、`frac=0` 逐像素等价）；
 *  3. 独立显示帧渲染循环（`Laya.timer.frameLoop/clear` 既有模式 + `RenderLoop` 生命周期）；
 *  4. `chains[]` 从 wire 解码一路透传到 `BossRaceFrame.chains`。
 */

import {
  BossRaceSimulation,
  BossRaceState,
  BOSS_RACE_DAMAGE_PER_SHOT_TICK,
  BOSS_RACE_DEFAULT_BOSS_HP,
  DANMAKU_DEFAULT_BOMBS,
  DANMAKU_DEFAULT_LIVES,
  SNAPSHOT_DEFAULT_LIVES,
  defaultBossRaceConfig,
  type BossRaceBullet,
  type BossRaceInput,
  type BossRaceSnapshot,
} from '../src/core/sim/boss_race';
import {
  buildBossRaceFrame,
  buildInterpolatedBossRaceFrame,
  buildJudgmentHud,
  type PlayfieldLayout,
} from '../src/core/game/boss_race_view_model';
import { RenderLoop, type FrameTimerLike } from '../src/core/game/render_loop';
import { decodeBossRaceSnapshot } from '../src/core/net/battle_codec';
import { BattlePayloadType } from '../src/core/protocol/types';
import { expect, expectClose, expectDeepEqual, expectEqual, suite, test } from './harness';

const LAYOUT: PlayfieldLayout = { width: 640, height: 960 };
const FRAME_OPTS = { layout: LAYOUT, localPlayerId: 'p1', bossMaxHp: 6000 };
/** 线上票据下发的 ruleset：改动前判定/卡牌默认全关，现在默认全开。 */
const LIVE_RULESET = 'ruleset-local-s0';

function submit(sim: BossRaceSimulation, overrides: Partial<BossRaceInput> = {}): void {
  const next = sim.getCurrentTick() + 1;
  expect(
    sim.submitInput({
      playerId: 'p1',
      tick: next,
      seq: next,
      directionBits: 0,
      slow: false,
      shoot: false,
      bomb: false,
      cardSlot: -1,
      modeActionId: '',
      ...overrides,
    }),
    'input accepted',
  );
}

function snap(tick: number, playerXMilli: number, bulletXMilli: number): BossRaceSnapshot {
  const bullet: BossRaceBullet = {
    bulletId: 'b1',
    ownerPlayerId: 'p1',
    xMilli: bulletXMilli,
    yMilli: 0,
    vxMilli: 1000,
    vyMilli: 0,
    radiusMilli: 4000,
    patternId: 'pat',
  };
  return {
    tick,
    state: BossRaceState.Running,
    winnerPlayerId: '',
    winnerTick: 0,
    stateHash: '',
    players: [
      { playerId: 'p1', xMilli: playerXMilli, yMilli: 0, bossCurrentHp: 6000, damageDealt: 0, connected: true },
    ],
    bullets: [bullet],
  };
}

function playerOf(snapshot: BossRaceSnapshot): BossRaceSnapshot['players'][number] {
  const player = snapshot.players.find((entry) => entry.playerId === 'p1');
  expect(player !== undefined, 'snapshot carries p1');
  return player!;
}

// ---------------------------------------------------------------------------
// 1. 统一「全开」开关
// ---------------------------------------------------------------------------

suite('danmaku all-features master switch');

test('the default enables every mechanic on the live ticket ruleset', () => {
  const sim = new BossRaceSimulation({
    ...defaultBossRaceConfig('m', 1),
    rulesetVersion: LIVE_RULESET,
  });
  expect(sim.usesDanmakuMechanics(), 'allFeaturesEnabled defaults to true → judgment on');
  sim.addPlayer('p1');
  sim.addPlayer('p2');
  const p = playerOf(sim.tick());
  expectEqual(p.lives, DANMAKU_DEFAULT_LIVES, 'lives now emitted');
  expectEqual(p.bombs, DANMAKU_DEFAULT_BOMBS, 'bombs now emitted');
  expectEqual(p.graze, 0, 'graze now emitted');
  expect(p.invulnerableUntilTick !== undefined, 'invulnerable field now emitted');
});

test('allFeaturesEnabled:false reverts byte-for-byte to the pre-change behaviour', () => {
  const sim = new BossRaceSimulation({
    ...defaultBossRaceConfig('m', 1),
    rulesetVersion: LIVE_RULESET,
    allFeaturesEnabled: false,
  });
  expectEqual(sim.usesDanmakuMechanics(), false, 'judgment off');
  sim.addPlayer('p1');
  sim.addPlayer('p2');
  // 判定不触发：射击仍按改动前的合成伤害逐 tick 扣 Boss HP，且快照不带任何
  // 判定字段 / 判定事件。
  submit(sim, { shoot: true });
  const snapshot = sim.tick();
  const p = playerOf(snapshot);
  expectEqual(
    p.bossCurrentHp,
    BOSS_RACE_DEFAULT_BOSS_HP - BOSS_RACE_DAMAGE_PER_SHOT_TICK,
    'legacy synthetic damage still applies',
  );
  expectEqual(p.damageDealt, BOSS_RACE_DAMAGE_PER_SHOT_TICK, 'legacy damage counter');
  expectEqual(p.lives, undefined, 'no lives field');
  expectEqual(p.bombs, undefined, 'no bombs field');
  expectEqual(p.graze, undefined, 'no graze field');
  expectEqual(p.invulnerableUntilTick, undefined, 'no invulnerable field');
  expectEqual(snapshot.events, undefined, 'no judgment / card events');
});

test('an explicit cardMechanics value wins over the master switch (?? precedence)', () => {
  // 总开关关闭、卡牌显式开：snapshot 走 `danmakuMechanics || cardMechanics`
  // 分支下发 invulnerableUntilTick，但判定字段（lives/bombs/graze）仍不下发。
  const forcedOn = new BossRaceSimulation({
    ...defaultBossRaceConfig('m', 1),
    rulesetVersion: LIVE_RULESET,
    allFeaturesEnabled: false,
    cardMechanics: true,
  });
  forcedOn.addPlayer('p1');
  forcedOn.addPlayer('p2');
  const onPlayer = playerOf(forcedOn.tick());
  expect(onPlayer.invulnerableUntilTick !== undefined, 'explicit cardMechanics:true is honoured');
  expectEqual(onPlayer.lives, undefined, 'danmaku judgment stays off');

  // 总开关开启（默认）、卡牌显式关：出牌输入不得产生任何卡牌事件。
  const forcedOff = new BossRaceSimulation({
    ...defaultBossRaceConfig('m', 1),
    rulesetVersion: LIVE_RULESET,
    cardMechanics: false,
  });
  forcedOff.addPlayer('p1');
  forcedOff.addPlayer('p2');
  forcedOff.seedPlayerHand('p1', ['focus_lens'], 10, '12345');
  submit(forcedOff, { cardSlot: 0 });
  const offSnapshot = forcedOff.tick();
  expect(
    !(offSnapshot.events ?? []).some((event) => event.type.startsWith('card_')),
    'explicit cardMechanics:false disables the pipeline even with master on',
  );
});

test('with all features on the judgment HUD reports real values, not wire placeholders', () => {
  const sim = new BossRaceSimulation({
    ...defaultBossRaceConfig('m', 1),
    rulesetVersion: LIVE_RULESET,
  });
  sim.addPlayer('p1');
  sim.addPlayer('p2');
  const hud = buildJudgmentHud(buildBossRaceFrame(sim.tick(), FRAME_OPTS));
  expect(hud !== null, 'judgment HUD is active once the sim emits the real fields');
  expectEqual(hud!.lives, DANMAKU_DEFAULT_LIVES, 'real lives, not SNAPSHOT_DEFAULT_LIVES');
  expectEqual(hud!.bombs, DANMAKU_DEFAULT_BOMBS, 'real bombs, not SNAPSHOT_DEFAULT_BOMBS');
  expect(
    DANMAKU_DEFAULT_LIVES !== SNAPSHOT_DEFAULT_LIVES,
    'the placeholder differs from the real value, so the assertion is meaningful',
  );
  // 反向：显式回退时判定字段不下发 → 整块 HUD 不画，占位值不会被当成真实残机。
  const legacy = new BossRaceSimulation({
    ...defaultBossRaceConfig('m', 1),
    rulesetVersion: LIVE_RULESET,
    allFeaturesEnabled: false,
  });
  legacy.addPlayer('p1');
  legacy.addPlayer('p2');
  expectEqual(
    buildJudgmentHud(buildBossRaceFrame(legacy.tick(), FRAME_OPTS)),
    null,
    'legacy fallback keeps the HUD hidden',
  );
});

// ---------------------------------------------------------------------------
// 2. 两快照插值补帧
// ---------------------------------------------------------------------------

suite('interpolated render frames');

test('frac=0 is pixel-identical to the legacy single-frame path', () => {
  const previous = snap(10, 1000, 2000);
  const current = snap(11, 5000, 6000);
  const interpolated = buildInterpolatedBossRaceFrame(current, { ...FRAME_OPTS, previous, frac: 0 });
  const legacy = buildBossRaceFrame(current, { ...FRAME_OPTS, previous, frac: 0 });
  expectDeepEqual(interpolated, legacy, 'frac 0 must not change a single pixel');
});

test('a missing previous snapshot falls back to single-frame extrapolation', () => {
  const current = snap(11, 5000, 6000);
  const noPrevious = buildInterpolatedBossRaceFrame(current, { ...FRAME_OPTS, previous: null, frac: 0.5 });
  const single = buildBossRaceFrame(current, { ...FRAME_OPTS, frac: 0.5 });
  expectDeepEqual(noPrevious, single, 'no previous → the old extrapolation path');
});

test('non-adjacent snapshot ticks fall back to single-frame extrapolation', () => {
  const previous = snap(10, 1000, 2000);
  const current = snap(13, 5000, 6000); // 13 ≠ 10 + 1
  const fallback = buildInterpolatedBossRaceFrame(current, { ...FRAME_OPTS, previous, frac: 0.5 });
  const single = buildBossRaceFrame(current, { ...FRAME_OPTS, previous, frac: 0.5 });
  expectDeepEqual(fallback, single, 'a tick gap must not be interpolated');
});

test('adjacent snapshots interpolate players and bullets at a mid frac', () => {
  const previous = snap(10, 1000, 2000);
  const current = snap(11, 5000, 6000);
  const prevFrame = buildBossRaceFrame(previous, { ...FRAME_OPTS, frac: 0 });
  const currFrame = buildBossRaceFrame(current, { ...FRAME_OPTS, frac: 0 });
  const mid = buildInterpolatedBossRaceFrame(current, { ...FRAME_OPTS, previous, frac: 0.5 });
  expectClose(
    mid.players[0].position.x,
    (prevFrame.players[0].position.x + currFrame.players[0].position.x) / 2,
    1e-9,
    'player is the midpoint of the two authoritative frames',
  );
  expectClose(
    mid.bullets[0].position.x,
    (prevFrame.bullets[0].position.x + currFrame.bullets[0].position.x) / 2,
    1e-9,
    'bullet is the midpoint of the two authoritative frames',
  );
  // 必须与「单帧前向外推」不同，才能证明补帧真的接进来了（而不是换皮直显）。
  const extrapolated = buildBossRaceFrame(current, { ...FRAME_OPTS, previous, frac: 0.5 });
  expect(
    Math.abs(mid.players[0].position.x - extrapolated.players[0].position.x) > 1e-6,
    'two-snapshot interpolation differs from single-frame extrapolation',
  );
});

// ---------------------------------------------------------------------------
// 3. 独立显示帧渲染循环
// ---------------------------------------------------------------------------

/** 假 Laya.timer：照 `display.ts:191/:204` 的 frameLoop/clear 形状。 */
class FakeLayaTimer implements FrameTimerLike {
  registrations: { caller: unknown; method: (...args: unknown[]) => void }[] = [];
  clears = 0;

  frameLoop(delay: number, caller: unknown, method: (...args: unknown[]) => void): void {
    expectEqual(delay, 1, 'frameLoop delay is 1 (display.ts:191 pattern)');
    this.registrations.push({ caller, method });
  }

  clear(caller: unknown, method: (...args: unknown[]) => void): void {
    this.clears += 1;
    this.registrations = this.registrations.filter(
      (entry) => !(entry.caller === caller && entry.method === method),
    );
  }

  fire(): void {
    for (const entry of [...this.registrations]) {
      entry.method();
    }
  }
}

suite('decoupled render clock');

test('RenderLoop uses the Laya.timer.frameLoop/clear pattern and stops cleanly', () => {
  const timer = new FakeLayaTimer();
  const caller = {};
  // 与 BattleScene 一致：timer 通过 provider 延迟注入（start() 时才取值）。
  let providerCalls = 0;
  const loop = new RenderLoop(() => {
    providerCalls += 1;
    return timer;
  }, caller);
  let renders = 0;
  expectEqual(loop.running, false, 'idle before start');
  expectEqual(providerCalls, 0, 'timer is not touched before start');

  loop.start(() => {
    renders += 1;
  });
  expectEqual(loop.running, true, 'running after start');
  expectEqual(timer.registrations.length, 1, 'one frameLoop registration');
  expect(timer.registrations[0].caller === caller, 'caller is the scene (display.ts:191)');
  expectEqual(providerCalls, 1, 'timer resolved exactly once at start');

  // 显示帧独立于逻辑 tick：驱动几帧就渲染几次。
  timer.fire();
  timer.fire();
  timer.fire();
  expectEqual(renders, 3, 'one render per display frame');

  // start 幂等，不重复注册 → 不会留下双重回调。
  loop.start(() => {
    renders += 100;
  });
  expectEqual(timer.registrations.length, 1, 'start is idempotent — no double callback');

  loop.stop();
  expectEqual(loop.running, false, 'stopped');
  expectEqual(timer.clears, 1, 'one clear (display.ts:204 pattern)');
  expectEqual(timer.registrations.length, 0, 'registration removed');
  // 清理后即使误派发也不渲染（onExit 不残留）。
  timer.fire();
  expectEqual(renders, 3, 'no residual callback after stop');

  // 重复 stop 安全；之后仍可再 start（setPaused/onExit 后的恢复路径）。
  loop.stop();
  expectEqual(timer.clears, 1, 'stop is idempotent');
  loop.start(() => {
    renders += 1;
  });
  expectEqual(timer.registrations.length, 1, 'a fresh start registers again');
  timer.fire();
  expectEqual(renders, 4, 'the restarted loop renders again');
  loop.stop();
});

// ---------------------------------------------------------------------------
// 4. chains[] 透传
// ---------------------------------------------------------------------------

suite('chain readout');

test('chains decoded from the wire reach BossRaceFrame unchanged', () => {
  const json = JSON.stringify({
    tick: 77,
    state: 'running',
    winner_player_id: '',
    winner_tick: 0,
    state_hash: 'aabbccdd',
    players: [],
    bullets: [],
    chains: [
      { chain_id: '7', pattern_index: 3, node_id: 11, generation: 2, rng_cursor: 91 },
      { chain_id: '8', pattern_index: 4, node_id: 12, generation: 0, rng_cursor: 5 },
    ],
  });
  const body = new TextEncoder().encode(json);
  const payload = new Uint8Array(body.length + 1);
  payload[0] = BattlePayloadType.SNAPSHOT;
  payload.set(body, 1);
  const snapshot = decodeBossRaceSnapshot(payload);
  expect(snapshot !== null, 'snapshot decodes');
  expectEqual(snapshot!.chains?.length, 2, 'battle_codec parsed the wire chains');

  const frame = buildBossRaceFrame(snapshot!, FRAME_OPTS);
  expectDeepEqual(
    frame.chains,
    [
      { chainId: '7', patternIndex: 3, nodeId: 11, generation: 2, rngCursor: 91 },
      { chainId: '8', patternIndex: 4, nodeId: 12, generation: 0, rngCursor: 5 },
    ],
    'chains are exposed to the view layer field for field',
  );
});

test('a snapshot without chains renders an empty chain list', () => {
  expectDeepEqual(buildBossRaceFrame(snap(1, 0, 0), FRAME_OPTS).chains, [], 'no chains → []');
});

test('chains survive the interpolated render path as an authoritative readout', () => {
  const previous = snap(10, 1000, 2000);
  const current = {
    ...snap(11, 5000, 6000),
    chains: [{ chainId: 'c1', patternIndex: 1, nodeId: 2, generation: 0, rngCursor: 9 }],
  };
  const frame = buildInterpolatedBossRaceFrame(current, { ...FRAME_OPTS, previous, frac: 0.5 });
  expectDeepEqual(
    frame.chains,
    [{ chainId: 'c1', patternIndex: 1, nodeId: 2, generation: 0, rngCursor: 9 }],
    'interpolation does not drop the chain readout',
  );
});
