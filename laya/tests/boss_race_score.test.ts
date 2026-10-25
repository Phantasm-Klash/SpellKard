/**
 * P7 客户端计分：**解析 / 透传 / 展示**（计分权威在服务端，客户端不重算）。
 *
 * 钉死四件事：
 *
 *  1. **解析**：快照 `players[]` 的 `score` / `hit_count` / `spell_get` /
 *     `spell_total` 能读出来；缺字段默认 0；uint64 超过 `2^53` 时与
 *     `damage_dealt` 同法退化（有限、整数、非负）。
 *  2. **本地 sim 不重算**：`tick()` 一个字节都不改这些读数，
 *     `adoptAuthoritativeSnapshot` 才用服务端值覆盖。
 *  3. **HUD 映射**：`buildJudgmentHud` 把本地玩家的四个读数原样带出来。
 *  4. **分数格式**：千分位、纯数字、不依赖 locale。
 */

import { decodeBossRaceSnapshot } from '../src/core/net/battle_codec';
import { BattlePayloadType } from '../src/core/protocol/types';
import {
  BossRaceSimulation,
  BossRaceState,
  defaultBossRaceConfig,
  type BossRacePlayerSnapshot,
  type BossRaceSnapshot,
} from '../src/core/sim/boss_race';
import {
  buildBossRaceFrame,
  buildJudgmentHud,
  formatScoreDigits,
  type PlayfieldLayout,
} from '../src/core/game/boss_race_view_model';
import { expect, expectEqual, suite, test } from './harness';

/** 640×960 参考布局（transform scale = 1，几何不影响本文件的断言）。 */
const LAYOUT_640_960: PlayfieldLayout = { width: 640, height: 960 };

/** `[payload_type][JSON utf-8]` —— 服务端快照帧的线上形状。 */
function snapshotPayload(json: string): Uint8Array {
  const body = utf8(json);
  const out = new Uint8Array(body.length + 1);
  out[0] = BattlePayloadType.SNAPSHOT;
  out.set(body, 1);
  return out;
}

function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(out);
}

function decodePlayer(player: Record<string, unknown>): BossRacePlayerSnapshot {
  const snapshot = decodeBossRaceSnapshot(
    snapshotPayload(JSON.stringify({ tick: 12, state: 1, players: [player], bullets: [] })),
  );
  expect(snapshot !== null, 'snapshot should decode');
  expectEqual(snapshot!.players.length, 1, 'one player');
  return snapshot!.players[0];
}

suite('P7 score parsing');

test('players[] carries score / hit_count / spell_get / spell_total', () => {
  const player = decodePlayer({
    player_id: 'p1',
    x_milli: 0,
    y_milli: 0,
    boss_current_hp: 6000,
    damage_dealt: 1200,
    connected: true,
    score: 1234567,
    hit_count: 3,
    spell_get: 2,
    spell_total: 7,
  });
  expectEqual(player.score, 1234567, 'score');
  expectEqual(player.hitCount, 3, 'hit_count');
  expectEqual(player.spellGet, 2, 'spell_get');
  expectEqual(player.spellTotal, 7, 'spell_total');
});

test('a server that never sends the score fields decodes them as 0', () => {
  const player = decodePlayer({ player_id: 'p1', boss_current_hp: 6000, damage_dealt: 0 });
  expectEqual(player.score, 0, 'absent score defaults to 0');
  expectEqual(player.hitCount, 0, 'absent hit_count defaults to 0');
  expectEqual(player.spellGet, 0, 'absent spell_get defaults to 0');
  expectEqual(player.spellTotal, 0, 'absent spell_total defaults to 0');
});

test('score beyond 2^53 degrades to the nearest double, like damage_dealt', () => {
  // 服务端把 uint64 写成裸 JSON 数字（`match_lifecycle.cpp:713`），所以精度在
  // `JSON.parse` 之前就已经丢了。这里钉的是**退化行为**而不是精确值：
  // 客户端必须拿到一个有限、非负的整数，绝不能是 NaN 或被截成负数。
  const fromNumber = decodePlayer({ player_id: 'p1', score: 9007199254740993 });
  expect(Number.isFinite(fromNumber.score), 'score stays finite above 2^53');
  expectEqual(fromNumber.score, 9007199254740992, 'rounded to the nearest representable double');
  expect(Number.isInteger(fromNumber.score), 'score stays an integer');
  expectEqual(fromNumber.score! > Number.MAX_SAFE_INTEGER, true, 'still above the safe range');

  // 十进制字符串走同一条 `Number()` 路径，退化结果一致。
  const fromString = decodePlayer({ player_id: 'p1', score: '9007199254740993' });
  expectEqual(fromString.score, 9007199254740992, 'a decimal string degrades the same way');
});

test('a negative or non-numeric score readout is clamped to 0', () => {
  expectEqual(decodePlayer({ player_id: 'p1', score: -5 }).score, 0, 'negative → 0');
  expectEqual(decodePlayer({ player_id: 'p1', score: 'abc' }).score, 0, 'garbage → 0');
  expectEqual(decodePlayer({ player_id: 'p1', hit_count: 2.9 }).hitCount, 2, 'fractional → floor');
});

suite('P7 local simulation passthrough');

function makeSim(): BossRaceSimulation {
  const sim = new BossRaceSimulation(defaultBossRaceConfig('match-score', 0x00010203));
  sim.addPlayer('p1');
  sim.addPlayer('p2');
  return sim;
}

function localPlayer(sim: BossRaceSimulation): BossRacePlayerSnapshot {
  const player = sim.snapshot().players.find((candidate) => candidate.playerId === 'p1');
  expect(player !== undefined, 'p1 is in the snapshot');
  return player!;
}

function serverSnapshot(overrides: Partial<BossRacePlayerSnapshot>): BossRaceSnapshot {
  return {
    tick: 30,
    state: BossRaceState.Running,
    winnerPlayerId: '',
    winnerTick: 0,
    players: [
      {
        playerId: 'p1',
        xMilli: 0,
        yMilli: 0,
        bossCurrentHp: 6000,
        damageDealt: 0,
        connected: true,
        ...overrides,
      },
    ],
    bullets: [],
    stateHash: '',
  };
}

test('local ticks never invent a score', () => {
  const sim = makeSim();
  for (let i = 0; i < 20; i += 1) {
    sim.tick();
  }
  const player = localPlayer(sim);
  expectEqual(player.score, 0, 'score stays 0 — the client does not score');
  expectEqual(player.hitCount, 0, 'hit_count stays 0');
  expectEqual(player.spellGet, 0, 'spell_get stays 0');
  expectEqual(player.spellTotal, 0, 'spell_total stays 0');
});

test('adopting a snapshot overwrites the score readouts, later ticks keep them', () => {
  const sim = makeSim();
  sim.adoptAuthoritativeSnapshot(
    serverSnapshot({ score: 42000, hitCount: 2, spellGet: 1, spellTotal: 5 }),
  );
  let player = localPlayer(sim);
  expectEqual(player.score, 42000, 'server score adopted');
  expectEqual(player.hitCount, 2, 'server hit_count adopted');
  expectEqual(player.spellGet, 1, 'server spell_get adopted');
  expectEqual(player.spellTotal, 5, 'server spell_total adopted');

  // 本地继续预测：读数原样保留，不涨也不掉（客户端没有加分逻辑）。
  for (let i = 0; i < 10; i += 1) {
    sim.tick();
  }
  player = localPlayer(sim);
  expectEqual(player.score, 42000, 'local ticks leave the score untouched');
  expectEqual(player.hitCount, 2, 'local ticks leave hit_count untouched');
  expectEqual(player.spellGet, 1, 'local ticks leave spell_get untouched');
});

test('an older server snapshot without score fields keeps the last adopted value', () => {
  const sim = makeSim();
  sim.adoptAuthoritativeSnapshot(serverSnapshot({ score: 777, hitCount: 1, spellGet: 0, spellTotal: 3 }));
  // 老服务端（或字段被裁掉）→ 解码结果里根本没有这些键，不能把它们清零。
  sim.adoptAuthoritativeSnapshot(serverSnapshot({}));
  const player = localPlayer(sim);
  expectEqual(player.score, 777, 'absent score does not reset the readout');
  expectEqual(player.spellTotal, 3, 'absent spell_total does not reset the readout');
});

suite('P7 judgment HUD');

test('the judgment HUD carries the local player readouts', () => {
  const snapshot = {
    tick: 100,
    state: BossRaceState.Running,
    winnerPlayerId: '',
    winnerTick: 0,
    players: [
      {
        playerId: 'p1',
        xMilli: 0,
        yMilli: 0,
        bossCurrentHp: 5000,
        damageDealt: 1000,
        connected: true,
        // 判定字段存在 = 该 ruleset 下发判定数据（卡片才会画）。
        lives: 3,
        bombs: 2,
        graze: 41,
        score: 1234567,
        hitCount: 4,
        spellGet: 2,
        spellTotal: 6,
      },
    ],
    bullets: [],
    stateHash: '',
  } as unknown as BossRaceSnapshot;
  const frame = buildBossRaceFrame(snapshot, {
    layout: LAYOUT_640_960,
    localPlayerId: 'p1',
    bossMaxHp: 6000,
  });
  const local = frame.players[0];
  expectEqual(local.score, 1234567, 'the frame carries the score');
  expectEqual(local.hitCount, 4, 'the frame carries hit_count');
  expectEqual(local.spellGet, 2, 'the frame carries spell_get');
  expectEqual(local.spellTotal, 6, 'the frame carries spell_total');

  const hud = buildJudgmentHud(frame);
  expect(hud !== null, 'judgment data present → the card is drawn');
  expectEqual(hud!.score, 1234567, 'HUD score');
  expectEqual(hud!.scoreText, '1,234,567', 'HUD score text is grouped');
  expectEqual(hud!.hitCount, 4, 'HUD hit_count');
  expectEqual(hud!.spellGet, 2, 'HUD spell_get');
  expectEqual(hud!.spellTotal, 6, 'HUD spell_total');
  expectEqual(hud!.graze, 41, 'HUD graze is unchanged by P7');
});

test('the score text groups thousands without a locale', () => {
  expectEqual(formatScoreDigits(0), '0', 'zero');
  expectEqual(formatScoreDigits(7), '7', 'single digit');
  expectEqual(formatScoreDigits(999), '999', 'three digits');
  expectEqual(formatScoreDigits(1000), '1,000', 'first group');
  expectEqual(formatScoreDigits(1234567), '1,234,567', 'two groups');
  expectEqual(formatScoreDigits(9007199254740992), '9,007,199,254,740,992', 'beyond 2^53 still groups');
  expectEqual(formatScoreDigits(-1), '0', 'negative clamps to 0');
  expectEqual(formatScoreDigits(Number.NaN), '0', 'NaN clamps to 0');
});
