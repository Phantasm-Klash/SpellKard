/**
 * 弹幕引擎重构（P1 客户端）契约测试。
 *
 * 覆盖设计计划 §2.1 / §2.3 / §2.8 / §2.9 里**机器可判**的部分：
 *  1. tick 基准 = 64，且镜像层周期常量**原样未缩放**（45/90/600 钉帧）；
 *  2. 插值数学：`p_n + v_n * frac`、差分插值、角度最短弧；
 *  3. 输入 wire：新字段往返，且缺省时字节串与旧版逐字节一致；
 *  4. 快照新字段：有/无都不炸，缺省值正确；
 *  5. 渲染帧：`hidden` 子弹不渲染、插值不改写 tick 边界值。
 */

import {
  BOSS_RACE_DEFAULT_MAX_TICKS,
  BOSS_RACE_PATTERN_PERIOD_TICKS,
  BOSS_RACE_TICK_RATE_HZ,
  BossRaceState,
  type BossRaceBullet,
  type BossRaceSnapshot,
} from '../src/core/sim/boss_race';
import { bossRacePatternLibraryCached } from '../src/core/sim/danmaku/pattern_timeline';
import {
  CHAIN_SPLIT_CHILDREN_PER_HOST,
  CHAIN_SPLIT_MAX_GENERATION,
} from '../src/core/sim/danmaku/chain_split';
import {
  interpolateAngleDeg,
  interpolateBetween,
  interpolatePos,
  normalizeAngleDeg,
  normalizeFrac,
} from '../src/core/game/interpolation';
import { buildBossRaceFrame, PlayfieldTransform } from '../src/core/game/boss_race_view_model';
import {
  buildHandBar,
  CardActionController,
  HAND_DECK_UNKNOWN,
  snapshotHandBar,
} from '../src/core/game/card_hand_view';
import { MAX_CARD_SLOTS } from '../src/core/game/input';
import { ByteWriter, decodeBattleInput, decodeBossRaceSnapshot, encodeBattleInput, encodeUtf8 } from '../src/core/net/battle_codec';
import { BattlePayloadType, emptyVersionStamp, type BattleInput } from '../src/core/protocol/types';
import { expectClose, expectDeepEqual, expectEqual, expect, suite, test } from './harness';

suite('danmaku engine: 64 tick baseline');

test('the client tick rate is 64 Hz', () => {
  expectEqual(BOSS_RACE_TICK_RATE_HZ, 64, '§2.1: the whole simulation runs at 64 ticks/s');
});

test('per-frame constants stay unscaled (45/90 periods, 7200 tick cap)', () => {
  // ★ 64 tick 是「每秒多跑 4 tick」的真实加速：所有「每帧」常量原样当每 tick
  // 用。若有人把它们乘 60/64，这条断言会立刻失败。
  expectEqual(BOSS_RACE_PATTERN_PERIOD_TICKS, 45, 'scheduler period must stay 45 ticks');
  expectEqual(BOSS_RACE_DEFAULT_MAX_TICKS, 7200, 'the server tick cap is untouched');
  expectEqual(CHAIN_SPLIT_MAX_GENERATION, 2, 'chain generation cap is untouched');
  expectEqual(CHAIN_SPLIT_CHILDREN_PER_HOST, 8, 'chain fan-out is untouched');
  for (const pattern of bossRacePatternLibraryCached()) {
    expect(
      pattern.period_ticks === 45 || pattern.period_ticks === 90,
      `pattern ${pattern.id}: period_ticks ${pattern.period_ticks} must stay 45 or 90`,
    );
  }
});

suite('danmaku engine: interpolation');

test('frac is normalised to [0,1)', () => {
  expectEqual(normalizeFrac(0), 0);
  expectEqual(normalizeFrac(0.25), 0.25);
  expectEqual(normalizeFrac(1), 0, 'a whole tick belongs to the next tick');
  expectEqual(normalizeFrac(2.5), 0.5);
  expectEqual(normalizeFrac(-3), 0);
  expectEqual(normalizeFrac(Number.NaN), 0);
});

test('velocity entities extrapolate as p_n + v_n * frac', () => {
  const at0 = interpolatePos({ x: 100, y: -50 }, { x: 40, y: 20 }, 0);
  expectDeepEqual(at0, { x: 100, y: -50 }, 'frac 0 must not move the bullet');
  const at1 = interpolatePos({ x: 100, y: -50 }, { x: 40, y: 20 }, 1);
  expectDeepEqual(at1, { x: 140, y: -30 }, 'frac 1 is exactly one tick of integration');
  const half = interpolatePos({ x: 100, y: -50 }, { x: 40, y: 20 }, 0.5);
  expectDeepEqual(half, { x: 120, y: -40 }, 'frac 0.5 is half a tick of integration');
});

test('velocity extrapolation agrees with the per-tick difference', () => {
  // 服务端下一 tick 的位置就是 `p_n + v_n`；外推的 frac=1 端点必须等于它。
  const p0 = { x: -1200, y: 800 };
  const v = { x: 37, y: -11 };
  const next = { x: p0.x + v.x, y: p0.y + v.y };
  const extrapolated = interpolatePos(p0, v, 1);
  expectClose(extrapolated.x, next.x, 1e-9, 'x endpoint');
  expectClose(extrapolated.y, next.y, 1e-9, 'y endpoint');
});

test('entities without velocity interpolate between two snapshots', () => {
  const previous = { x: 0, y: 0 };
  const current = { x: 1000, y: -400 };
  expectDeepEqual(interpolateBetween(previous, current, 0), { x: 0, y: 0 });
  expectDeepEqual(interpolateBetween(previous, current, 1), { x: 1000, y: -400 });
  expectDeepEqual(interpolateBetween(previous, current, 0.25), { x: 250, y: -100 });
});

test('angles interpolate along the shortest arc', () => {
  // 350° → 10° 是 +20°，不是 −340°。
  expectClose(interpolateAngleDeg(350, 10, 0.5), 0, 1e-9, '350→10 midpoint is 0/360');
  expectClose(interpolateAngleDeg(350, 10, 0.25), 355, 1e-9, 'a quarter of +20°');
  expectClose(interpolateAngleDeg(10, 350, 0.5), 0, 1e-9, 'the reverse direction is symmetric');
  expectClose(interpolateAngleDeg(0, 90, 0.5), 45, 1e-9, 'ordinary quarter turn');
  expectClose(interpolateAngleDeg(-10, 10, 0.5), 0, 1e-9, 'negative inputs are normalised');
  expectEqual(normalizeAngleDeg(-90), 270);
  expectEqual(normalizeAngleDeg(720), 0);
});

suite('danmaku engine: input wire (§2.3)');

function legacyInput(): BattleInput {
  return {
    version: { ...emptyVersionStamp(), protocolVersion: 1 },
    matchId: 'match-64',
    playerId: 'p1',
    tick: 64,
    seq: 7,
    directionBits: 0x05,
    slow: true,
    shoot: false,
    bomb: true,
    cardSlot: -1,
    modeActionId: '',
  };
}

test('an input without card fields is byte-identical to the legacy frame', () => {
  const expected = new ByteWriter();
  expected.u8(BattlePayloadType.INPUT);
  expected.u32(1);
  expected.string('match-64');
  expected.string('p1');
  expected.u64(64);
  expected.u64(7);
  expected.u32(0x05);
  expected.u8(0x05); // slow + bomb
  expected.i8(-1);
  expected.string('');
  const encoded = encodeBattleInput(legacyInput());
  expectDeepEqual(
    Array.from(encoded),
    Array.from(expected.finish()),
    'defaults must not append the card block',
  );
});

test('absent card fields decode as undefined, not as zero', () => {
  const decoded = decodeBattleInput(encodeBattleInput(legacyInput()));
  expect(decoded !== null, 'payload should decode');
  expectEqual(decoded!.cardDraw, undefined, 'absent card_draw stays undefined');
  expectEqual(decoded!.cardSelect, undefined, 'absent card_select stays undefined');
  expectEqual(decoded!.cardUse, undefined, 'absent card_use stays undefined');
});

test('card fields round-trip through the magic block', () => {
  const bytes = encodeBattleInput(legacyInput());
  const withCards = encodeBattleInput({ ...legacyInput(), cardDraw: true, cardSelect: 2, cardUse: true });
  expectEqual(withCards.length, bytes.length + 4, 'magic + 3 bytes');
  expectEqual(withCards[bytes.length], 0x43, "the block opens with 'C' (0x43)");
  const decoded = decodeBattleInput(withCards);
  expect(decoded !== null, 'payload should decode');
  expectEqual(decoded!.cardDraw, true);
  expectEqual(decoded!.cardSelect, 2);
  expectEqual(decoded!.cardUse, true);
  // 老字段必须一字不差。
  expectEqual(decoded!.matchId, 'match-64');
  expectEqual(decoded!.tick, 64);
  expectEqual(decoded!.directionBits, 0x05);
  expectEqual(decoded!.slow, true);
  expectEqual(decoded!.bomb, true);
});

test('selecting slot 0 alone still writes the block', () => {
  const bytes = encodeBattleInput({ ...legacyInput(), cardSelect: 0 });
  const decoded = decodeBattleInput(bytes);
  expect(decoded !== null, 'payload should decode');
  expectEqual(decoded!.cardSelect, 0, 'slot 0 is a real selection, not "absent"');
  expectEqual(decoded!.cardDraw, false);
  expectEqual(decoded!.cardUse, false);
});

test('an explicit -1 selection is treated as default', () => {
  const bytes = encodeBattleInput({ ...legacyInput(), cardSelect: -1 });
  const legacy = encodeBattleInput(legacyInput());
  expectEqual(bytes.length, legacy.length, 'no block for the default -1');
});

suite('danmaku engine: snapshot extensions (§2.8)');

function snapshotPayload(body: unknown): Uint8Array {
  const json = encodeUtf8(JSON.stringify(body));
  const out = new Uint8Array(json.length + 1);
  out[0] = BattlePayloadType.SNAPSHOT;
  out.set(json, 1);
  return out;
}

test('a legacy snapshot decodes with the new fields absent', () => {
  const decoded = decodeBossRaceSnapshot(
    snapshotPayload({
      tick: 64,
      state: 'running',
      winner_player_id: '',
      winner_tick: 0,
      state_hash: 'abc',
      players: [{ player_id: 'p1', x_milli: 1000, y_milli: -2000, boss_current_hp: 5000, damage_dealt: 1000 }],
      bullets: [{ bullet_id: 'b1', owner_player_id: 'p1', x_milli: 0, y_milli: 0, vx_milli: 100, vy_milli: 0, radius_milli: 4000, pattern_id: 'pat' }],
    }),
  );
  expect(decoded !== null, 'legacy snapshot must still decode');
  expectEqual(decoded!.boss, undefined, 'no boss block → undefined');
  expectEqual(decoded!.chains, undefined, 'no chains → undefined');
  expectEqual(decoded!.hand, undefined, 'no hand → undefined');
  expectEqual(decoded!.deckRemaining, undefined, 'no deck_remaining → undefined');
  expectEqual(decoded!.drawCooldownTicks, undefined, 'no draw_cooldown_ticks → undefined');
  expectEqual(decoded!.events, undefined, 'no events → undefined');
  expectEqual(decoded!.eventCursor, undefined, 'no event_cursor → undefined');
  expectEqual(decoded!.players[0].vxMilli, undefined, 'no vx → undefined');
  expectEqual(decoded!.players[0].graze, undefined, 'no graze → undefined');
  expectEqual(decoded!.bullets[0].hidden, undefined, 'no hidden flag → undefined');
  expectEqual(decoded!.bullets[0].chainId, undefined, 'no chain id → undefined');
  // 老字段照旧。
  expectEqual(decoded!.players[0].xMilli, 1000);
  expectEqual(decoded!.bullets[0].vxMilli ?? 0, 100);
});

test('a full snapshot carries boss/players/bullets/chains/hand/events through', () => {
  const decoded = decodeBossRaceSnapshot(
    snapshotPayload({
      tick: 128,
      state: 'running',
      state_hash: 'def',
      boss: {
        x_milli: 0,
        y_milli: -60000,
        hp: 4200,
        max_hp: 6000,
        phase: 2,
        movement: { type: 'sine', phase_t: 33 },
        effects: [
          { type: 'iron_fist', state: 'windup', t_remaining: 12, x0_milli: 0, y0_milli: -60000, dx_milli: 1000, dy_milli: 0, length_milli: 90000 },
          { type: 'black_curtain', state: 'hold', t_remaining: 30, edge_y_milli: -30000 },
        ],
      },
      players: [
        {
          player_id: 'p1',
          x_milli: 1000,
          y_milli: -2000,
          boss_current_hp: 4200,
          damage_dealt: 1800,
          vx_milli: 3000,
          vy_milli: -1000,
          facing_millideg: 9000,
          lives: 3,
          bombs: 2,
          invulnerable_until_tick: 200,
          graze: 41,
        },
      ],
      bullets: [
        {
          bullet_id: 'b1',
          owner_player_id: 'p1',
          x_milli: 0,
          y_milli: 0,
          vx_milli: 100,
          vy_milli: 0,
          radius_milli: 4000,
          pattern_id: 'pat',
          chain_id: 'chain-3',
          generation: 1,
          hidden: true,
        },
      ],
      chains: [{ chain_id: 'chain-3', pattern_index: 2, node_id: 7, generation: 1, rng_cursor: 19 }],
      hand: [
        { card_id: 'card-a', slot: 0, selected: true },
        { card_id: 'card-b', slot: 1, selected: false },
      ],
      deck_remaining: 12,
      draw_cooldown_ticks: 24,
      events: [{ tick: 126, type: 'hit', player_id: 'p1', damage: 120 }],
      event_cursor: 9,
    }),
  );
  expect(decoded !== null, 'full snapshot must decode');
  const boss = decoded!.boss!;
  expectEqual(boss.hp, 4200);
  expectEqual(boss.maxHp, 6000);
  expectEqual(boss.phase, 2);
  expectEqual(boss.movement?.type, 'sine');
  expectEqual(boss.movement?.phaseT, 33);
  expectEqual(boss.effects.length, 2);
  expectEqual(boss.effects[0].type, 'iron_fist');
  expectEqual(boss.effects[0].state, 'windup');
  expectEqual(boss.effects[0].tRemaining, 12);
  expectEqual(boss.effects[0].lengthMilli, 90000);
  expectEqual(boss.effects[1].type, 'black_curtain');
  expectEqual(boss.effects[1].edgeYMilli, -30000);

  const player = decoded!.players[0];
  expectEqual(player.vxMilli, 3000);
  expectEqual(player.vyMilli, -1000);
  expectEqual(player.facingMillideg, 9000);
  expectEqual(player.lives, 3);
  expectEqual(player.bombs, 2);
  expectEqual(player.invulnerableUntilTick, 200);
  expectEqual(player.graze, 41);

  const bullet = decoded!.bullets[0];
  expectEqual(bullet.chainId, 'chain-3');
  expectEqual(bullet.generation, 1);
  expectEqual(bullet.hidden, true);

  expectEqual(decoded!.chains?.length, 1);
  expectEqual(decoded!.chains?.[0].rngCursor, 19);
  expectEqual(decoded!.hand?.length, 2);
  expectEqual(decoded!.hand?.[0].selected, true);
  expectEqual(decoded!.deckRemaining, 12);
  expectEqual(decoded!.drawCooldownTicks, 24);
  expectEqual(decoded!.events?.length, 1);
  expectEqual(decoded!.events?.[0].type, 'hit');
  expectEqual(decoded!.events?.[0].data.damage, 120);
  expectEqual(decoded!.eventCursor, 9);
});

suite('danmaku engine: render frame');

const LAYOUT = { width: 480, height: 720 };

function bullet(overrides: Partial<BossRaceBullet>): BossRaceBullet {
  return {
    bulletId: 'b',
    ownerPlayerId: 'p1',
    xMilli: 0,
    yMilli: 0,
    vxMilli: 0,
    vyMilli: 0,
    radiusMilli: 4000,
    patternId: 'pat',
    ...overrides,
  };
}

function snapshotWith(bullets: BossRaceBullet[], extra: Partial<BossRaceSnapshot> = {}): BossRaceSnapshot {
  return {
    tick: 64,
    state: BossRaceState.Running,
    winnerPlayerId: '',
    winnerTick: 0,
    stateHash: '',
    players: [
      { playerId: 'p1', xMilli: 0, yMilli: 0, bossCurrentHp: 6000, damageDealt: 0, connected: true },
      { playerId: 'p2', xMilli: 0, yMilli: 0, bossCurrentHp: 6000, damageDealt: 0, connected: true },
    ],
    bullets,
    ...extra,
  };
}

test('hidden bullets are not rendered (black curtain hold)', () => {
  const frame = buildBossRaceFrame(
    snapshotWith([
      bullet({ bulletId: 'visible' }),
      bullet({ bulletId: 'hidden', hidden: true }),
    ]),
    { layout: LAYOUT, localPlayerId: 'p1', bossMaxHp: 6000 },
  );
  expectEqual(frame.bullets.length, 1, 'hidden bullets must not reach the renderer');
  expectEqual(frame.bullets[0].bulletId, 'visible');
});

test('frac 0 renders the authoritative tick unchanged', () => {
  const frame = buildBossRaceFrame(snapshotWith([bullet({ xMilli: 1000, vxMilli: 2000 })]), {
    layout: LAYOUT,
    localPlayerId: 'p1',
    bossMaxHp: 6000,
  });
  // E1: 屏幕盒变换。scale = min(480/640000, 720/960000) = 0.00075；
  // x=1000 → (1000+320000)*0.00075 = 240.75
  expectClose(frame.bullets[0].position.x, 240.75, 1e-9, 'authoritative x');
});

test('frac extrapolates bullets with their snapshot velocity', () => {
  const frame = buildBossRaceFrame(snapshotWith([bullet({ xMilli: 1000, vxMilli: 2000 })]), {
    layout: LAYOUT,
    localPlayerId: 'p1',
    bossMaxHp: 6000,
    frac: 0.5,
  });
  // 1000 + 2000*0.5 = 2000 milli → (2000+320000)*0.00075 = 241.5 px
  expectClose(frame.bullets[0].position.x, 241.5, 1e-9, 'half a tick of extrapolation');
});

test('frac extrapolates players forward from the authoritative tick', () => {
  const previous = snapshotWith([]);
  const current = snapshotWith([]);
  current.players[0] = { ...current.players[0], xMilli: 1000 };
  const frame = buildBossRaceFrame(current, {
    layout: LAYOUT,
    localPlayerId: 'p1',
    bossMaxHp: 6000,
    previous,
    frac: 0.5,
  });
  // 基准是当前 tick（1000），外推「上一 tick 位移」(+1000) 的一半 → 1500 milli
  // → (1500+320000)*0.00075 = 241.125 px
  expectClose(frame.players[0].position.x, 241.125, 1e-9, 'forward extrapolation from the current tick');
  const atZero = buildBossRaceFrame(current, {
    layout: LAYOUT,
    localPlayerId: 'p1',
    bossMaxHp: 6000,
    previous,
    frac: 0,
  });
  // §4.1：frac = 0 必须逐像素等于权威 tick → (1000+320000)*0.00075 = 240.75。
  expectClose(atZero.players[0].position.x, 240.75, 1e-9, 'frac 0 equals the authoritative position');
});

test('boss effects are mapped to playfield pixels', () => {
  const frame = buildBossRaceFrame(
    snapshotWith([], {
      boss: {
        xMilli: 0,
        yMilli: -60000,
        hp: 6000,
        maxHp: 6000,
        phase: 1,
        effects: [
          { type: 'iron_fist', state: 'windup', tRemaining: 10, x0Milli: 0, y0Milli: 0, dxMilli: 1000, dyMilli: 0, lengthMilli: 10000 },
          { type: 'black_curtain', state: 'sweep', tRemaining: 5, edgeYMilli: 0 },
        ],
      },
    }),
    { layout: LAYOUT, localPlayerId: 'p1', bossMaxHp: 6000 },
  );
  expectEqual(frame.bossEffects.length, 2);
  const fist = frame.bossEffects[0];
  expectEqual(fist.type, 'iron_fist');
  // (0,0) → (240,360)（屏幕盒中心 = 2:3 画面中心）；方向 +x，长度 10000 milli
  // = 10 屏幕 px → to.x = (10000+320000)*0.00075 = 247.5
  expectClose(fist.from!.x, 240, 1e-9);
  expectClose(fist.from!.y, 360, 1e-9);
  expectClose(fist.to!.x, 247.5, 1e-9);
  expectClose(fist.to!.y, fist.from!.y, 1e-9, 'a +x fist line stays horizontal');
  expectClose(frame.bossEffects[1].edgeY!, 360, 1e-9, 'edge_y_milli 0 maps to the screen centre row');
});

test('the transform maps the 640x960 screen box, not the player-clamp arena (E1)', () => {
  const t = new PlayfieldTransform(LAYOUT);
  // 2:3 画面恰好装满：scale = 480/640000 = 720/960000 = 0.00075（milli → 画面 px）。
  expectClose(t.scale, 0.00075, 1e-15, 'uniform scale from the screen box');
  expectClose(t.offsetX, 0, 1e-12, 'no letterbox on a 2:3 playfield');
  expectClose(t.offsetY, 0, 1e-12, 'no letterbox on a 2:3 playfield');
  // 屏幕盒四角 → 画面四角。
  const corners: Array<[number, number, number, number]> = [
    [-320000, -480000, 0, 0],
    [320000, -480000, 480, 0],
    [-320000, 480000, 0, 720],
    [320000, 480000, 480, 720],
  ];
  for (const [mx, my, px, py] of corners) {
    const point = t.toPixels(mx, my);
    expectClose(point.x, px, 1e-9, `screen x ${mx}`);
    expectClose(point.y, py, 1e-9, `screen y ${my}`);
  }
  // 竞技场钳制盒（玩家活动区）→ 画面中央 180x135（240x180 屏 px × 0.75）。
  const arena = t.toPixels(120000, 90000);
  expectClose(arena.x, 330, 1e-9, 'arena right edge');
  expectClose(arena.y, 427.5, 1e-9, 'arena bottom edge');
  // Boss 在 (0,-60000) → 画面中央偏上。
  const boss = t.toPixels(0, -60000);
  expectClose(boss.x, 240, 1e-9, 'boss centred');
  expectClose(boss.y, 315, 1e-9, 'boss a quarter down from the top');
});

test('an off-aspect playfield letterboxes instead of stretching', () => {
  // 宽扁画面（960x480）：高度是瓶颈，scale=480/960000=0.0005 → 屏盒占 320px 宽，
  // 左右各留 320px 边。
  const t = new PlayfieldTransform({ width: 960, height: 480 });
  expectClose(t.scale, 0.0005, 1e-15, 'height-bound scale');
  expectClose(t.offsetX, 320, 1e-12, 'centred horizontally');
  expectClose(t.offsetY, 0, 1e-12, 'fills the height');
  const point = t.toPixels(320000, 480000);
  expectClose(point.x, 640, 1e-9, 'right screen edge inside the letterbox');
  expectClose(point.y, 480, 1e-9, 'bottom screen edge flush');
});

suite('danmaku engine: in-match card actions (§2.3/§2.8)');

test('the snapshot hand drives slots, deck and cooldown', () => {
  const bar = snapshotHandBar(
    [
      { cardId: 'purge_bell', slot: 0, selected: false },
      { cardId: 'mirror_lance', slot: 1, selected: true },
    ],
    12,
    0,
    3,
  );
  expectEqual(bar.visible, true);
  expectEqual(bar.slots.length, 2);
  expectEqual(bar.slots[0].index, 0);
  expectEqual(bar.slots[1].index, 1);
  expectEqual(bar.slots[1].selected, true, 'selection comes from the server hand');
  expectEqual(bar.selectedSlot, 1);
  expectEqual(bar.deckRemaining, 12);
  expectEqual(bar.canDraw, true, 'deck left + no cooldown');
  expectEqual(bar.canUse, true, 'something is selected');
  expectEqual(bar.showActions, true, 'snapshot hands expose the draw/use buttons');
});

test('the draw button is gated by the cooldown and by an empty deck', () => {
  const cooling = snapshotHandBar([{ cardId: 'a', slot: 0, selected: false }], 5, 32, 0);
  expectEqual(cooling.canDraw, false, 'a live cooldown greys the button');
  expectEqual(cooling.drawCooldownTicks, 32);

  const empty = snapshotHandBar([{ cardId: 'a', slot: 0, selected: false }], 0, 0, 0);
  expectEqual(empty.canDraw, false, 'an empty deck greys the button');

  const unknown = snapshotHandBar([{ cardId: 'a', slot: 0, selected: false }], undefined, undefined, 0);
  expectEqual(unknown.deckRemaining, HAND_DECK_UNKNOWN, 'absent deck_remaining stays unknown');
  expectEqual(unknown.canDraw, true, 'unknown deck is not treated as empty');
  expectEqual(unknown.showActions, true);
});

test('an empty snapshot hand hides the bar but keeps the deck readout', () => {
  const bar = snapshotHandBar([], 9, 0, 0);
  expectEqual(bar.visible, false);
  expectEqual(bar.canUse, false, 'nothing to use');
  expectEqual(bar.deckRemaining, 9);
});

test('the ticket path never shows the draw/use buttons', () => {
  const bar = buildHandBar(['mirror_lance'], 2);
  expectEqual(bar.showActions, false, 'legacy hands keep the old strip');
  expectEqual(bar.canDraw, false);
  expectEqual(bar.selectedSlot, -1);
});

test('draw and use are one-shot pulses; selection persists', () => {
  const actions = new CardActionController();
  expectEqual(actions.select(1), true, 'selecting slot 1');
  expectEqual(actions.selectedSlot, 1);

  actions.requestDraw();
  const first = actions.take();
  expectDeepEqual(first, { cardDraw: true, cardSelect: 1, cardUse: false }, 'draw pulses once');
  const second = actions.take();
  expectDeepEqual(second, { cardDraw: false, cardSelect: 1, cardUse: false }, 'the pulse clears');

  expectEqual(actions.requestUse(), true, 'use needs a selection');
  const third = actions.take();
  expectDeepEqual(third, { cardDraw: false, cardSelect: 1, cardUse: true });
  expectDeepEqual(actions.take(), { cardDraw: false, cardSelect: 1, cardUse: false }, 'use clears too');
});

test('use without a selection never pulses', () => {
  const actions = new CardActionController();
  expectEqual(actions.requestUse(), false, 'nothing selected');
  expectDeepEqual(actions.take(), { cardDraw: false, cardSelect: -1, cardUse: false });
});

test('clicking the selected slot again deselects it', () => {
  const actions = new CardActionController();
  expectEqual(actions.select(0), true);
  expectEqual(actions.select(0), false, 'second click toggles off');
  expectEqual(actions.selectedSlot, -1);
  expectEqual(actions.select(-1), false, 'the sentinel is not a selection');
  expectEqual(actions.select(MAX_CARD_SLOTS), false, 'past the hand limit');
});

test('a stale snapshot echo cannot override a local selection', () => {
  const actions = new CardActionController();
  actions.syncFromSnapshot(0);
  expectEqual(actions.selectedSlot, 0, 'the first echo is adopted');
  actions.select(2);
  actions.syncFromSnapshot(0);
  expectEqual(actions.selectedSlot, 2, 'the player wins until the card is used');
  // 用卡之后交还给服务端回显。
  expectEqual(actions.requestUse(), true);
  actions.syncFromSnapshot(-1);
  expectEqual(actions.selectedSlot, -1, 'after use the server echo takes over');
});

test('reset clears selection and pending pulses', () => {
  const actions = new CardActionController();
  actions.select(1);
  actions.requestDraw();
  actions.reset();
  expectEqual(actions.selectedSlot, -1);
  expectDeepEqual(actions.take(), { cardDraw: false, cardSelect: -1, cardUse: false });
});
