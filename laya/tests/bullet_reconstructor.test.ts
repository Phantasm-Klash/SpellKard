/**
 * 弹幕基线重建器（docs/danmaku-delta-wire.md §10.3）单元测试。
 *
 * 本轮不依赖尚未生成的 delta trace fixture。核心「逐 tick 与 BossRaceSimulation
 * 本地模拟同参输出一致」用 `defaultBossRaceConfig` + `injectLiveBulletForTest`
 * 在 TS 内部构造对照（TS 内部一致性验证）；其余用例覆盖 spawn 建弹 / despawn /
 * deviation / 出界 / 异常回落 / reset / 跨 tick 状态 / codec 接入。
 */
import { decodeBossRaceSnapshot } from '../src/core/net/battle_codec';
import { BulletReconstructor } from '../src/core/net/bullet_reconstructor';
import { BattlePayloadType } from '../src/core/protocol/types';
import type { BossRaceSeed } from '../src/core/math/boss_race_seed';
import { bossRaceSeedFromU32 } from '../src/core/math/boss_race_seed';
import {
  BossRaceSimulation,
  BossRaceState,
  defaultBossRaceConfig,
} from '../src/core/sim/boss_race';
import type {
  BossRaceBullet,
  BossRaceBulletSpawn,
  BossRaceSnapshot,
} from '../src/core/sim/boss_race';
import { createBulletMotion } from '../src/core/sim/danmaku/bullet_motion';
import { expect, expectDeepEqual, expectEqual, test } from './harness';

const SEED: BossRaceSeed = bossRaceSeedFromU32(0x12345678);

/** 一颗确定性直线弹的 BulletMotion 静态模板（像素浮点）。 */
function baseTemplate(): Record<string, number> {
  return {
    x: 320, y: 120, angle: 90, speed: 2,
    bullet_kind: 12, bullet_func_no: 0, hit_dis: 4,
  };
}

function makeSpawn(overrides: Partial<BossRaceBulletSpawn> = {}): BossRaceBulletSpawn {
  return {
    bulletId: 'b1',
    ownerPlayerId: 'p1',
    t0: 1,
    p: 0,
    q: 0,
    groupId: 0,
    template: baseTemplate(),
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<BossRaceSnapshot> = {}): BossRaceSnapshot {
  return {
    tick: 1,
    state: BossRaceState.Running,
    winnerPlayerId: '',
    winnerTick: 0,
    stateHash: '',
    players: [{
      playerId: 'p1', xMilli: 0, yMilli: 0,
      bossCurrentHp: 100, damageDealt: 0, connected: true,
    }],
    bullets: [],
    ...overrides,
  };
}

function newReconstructor(): BulletReconstructor {
  return new BulletReconstructor({ matchSeed: SEED });
}

/** 只取「位置换算」字段做逐位比较（kind/func/patternId 不参与几何对照）。 */
function positionKey(bullets: BossRaceBullet[]): unknown {
  return bullets.map((b) => ({
    bulletId: b.bulletId,
    ownerPlayerId: b.ownerPlayerId,
    xMilli: b.xMilli,
    yMilli: b.yMilli,
    vxMilli: b.vxMilli,
    vyMilli: b.vyMilli,
    radiusMilli: b.radiusMilli,
  }));
}

// --- codec 测试用的最小 wire 工具 --------------------------------------------

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

function snapshotPayload(obj: Record<string, unknown>): Uint8Array {
  const body = utf8(JSON.stringify(obj));
  const out = new Uint8Array(1 + body.length);
  out[0] = BattlePayloadType.SNAPSHOT;
  out.set(body, 1);
  return out;
}

function wireBase(): Record<string, unknown> {
  return {
    tick: 1,
    state: 'running',
    winner_player_id: '',
    winner_tick: 0,
    state_hash: '',
    players: [{
      player_id: 'p1', x_milli: 0, y_milli: 0,
      boss_current_hp: 100, damage_dealt: 0, connected: true,
    }],
  };
}

// --- 用例 --------------------------------------------------------------------

// 1) spawn → createBulletMotion(template)，缺失字段按默认补齐，输出换算复用 snapshot 一套。
test('spawn template builds a bullet with createBulletMotion defaults', () => {
  const rec = newReconstructor();
  // 模板只给静态参数，speed/angle/vx/vy 等交给 createBulletMotion 默认补齐。
  const spawn = makeSpawn({
    template: { x: 320, y: 120, bullet_kind: 12, bullet_func_no: 0, hit_dis: 4, hit_hantei: false },
  });
  const out = rec.applyTick(makeSnapshot({ bulletSpawns: [spawn] }));
  expect(out !== null, 'spawn rebuild succeeds');
  expectEqual(out!.length, 1, 'one live bullet');
  expectEqual(out![0].bulletId, 'b1');
  expectEqual(out![0].ownerPlayerId, 'p1');
  expectEqual(out![0].bulletKind, 12, 'bullet_kind from template');
  expectEqual(out![0].motionFunc, 0, 'bullet_func_no from template');
  expectEqual(out![0].radiusMilli, 4000, 'radiusMilli = llround(hit_dis * 1000)');
  expectEqual(out![0].patternId, '', 'patternId is not in the static template');
  expectEqual(rec.size, 1);
});

// 2) 核心：逐 tick F_i 递推与 BossRaceSimulation 本地模拟同参输出逐位一致。
//    C(t) 直接取 sim.tick() 的 players/boss，天然与 advanceBullets 同步。
test('per-tick F_i matches BossRaceSimulation local simulation', () => {
  // allFeaturesEnabled:false 关闭受击/卡牌判定，聚焦运动学；hashComparable 仍 true，
  // synthetic scheduler 在 tick 1..8 不发射（period 45），场上只有注入弹。
  const config = { ...defaultBossRaceConfig('m1', SEED), allFeaturesEnabled: false };
  const sim = new BossRaceSimulation(config);
  sim.addPlayer('p1', 0, 0);
  sim.addPlayer('p2', 5000, 5000);

  const template = baseTemplate();
  const spawn = makeSpawn({ template });
  // 注入弹的 patternIndex/spawnIndex = 0/0，id = b1，与 spawn 事件 (p,q,id) 对齐。
  expect(sim.injectLiveBulletForTest('p1', createBulletMotion(template)), 'injection succeeds');

  const rec = newReconstructor();
  for (let t = 1; t <= 8; t += 1) {
    const snap = sim.tick();
    const deltaSnap: BossRaceSnapshot = {
      ...snap,
      wireCap: 1,
      bulletSpawns: t === 1 ? [spawn] : [],
      bulletDeviations: [],
      bulletDespawns: [],
      groupMotion: [],
    };
    const rebuilt = rec.applyTick(deltaSnap);
    expect(rebuilt !== null, `tick ${t} rebuild succeeds`);
    expectDeepEqual(
      positionKey(rebuilt!), positionKey(snap.bullets),
      `tick ${t} positions match local simulation`,
    );
  }
  expectEqual(rec.size, 1, 'bullet stays alive across ticks');
});

// 3) despawn 删除（权威删除，引用存在）。
test('despawn removes the referenced bullet', () => {
  const rec = newReconstructor();
  const first = rec.applyTick(makeSnapshot({ tick: 1, bulletSpawns: [makeSpawn()] }));
  expect(first !== null && first!.length === 1, 'spawn tick has one bullet');
  const out = rec.applyTick(makeSnapshot({
    tick: 2,
    bulletDespawns: [{ bulletId: 'b1', reason: 'spell_clear' }],
  }));
  expect(out !== null, 'despawn tick rebuild succeeds');
  expectEqual(out!.length, 0, 'bullet removed');
  expectEqual(rec.size, 0);
});

// 4) deviation 叠加到 milli 派生值（先换算再加，避免单位混用）。
test('deviation is added to milli-derived values after conversion', () => {
  const base = newReconstructor();
  base.applyTick(makeSnapshot({ tick: 1, bulletSpawns: [makeSpawn()] }));
  const baseline = base.applyTick(makeSnapshot({ tick: 2 }));

  const withDelta = newReconstructor();
  withDelta.applyTick(makeSnapshot({ tick: 1, bulletSpawns: [makeSpawn()] }));
  const shifted = withDelta.applyTick(makeSnapshot({
    tick: 2,
    bulletDeviations: [{ bulletId: 'b1', dx: 120, dy: -40, dvx: 5, dvy: -5 }],
  }));
  expect(baseline !== null && shifted !== null, 'both rebuilds succeed');
  expectEqual(shifted![0].xMilli, baseline![0].xMilli + 120, 'dx added after toMilli');
  expectEqual(shifted![0].yMilli, baseline![0].yMilli - 40, 'dy added after toMilli');
  expectEqual(shifted![0].vxMilli, baseline![0].vxMilli + 5, 'dvx added after toMilli');
  expectEqual(shifted![0].vyMilli, baseline![0].vyMilli - 5, 'dvy added after toMilli');
});

// 5) 出界回收：与 keepsBullet 同款像素盒谓词（x > SCREEN_W_PX + 20）。
test('out-of-bounds bullets are culled', () => {
  const rec = newReconstructor();
  // x = 700 > 640 + 20，speed=0 不再移动 → 推进后仍在界外 → 剔除。
  const spawn = makeSpawn({ template: { x: 700, y: 120, angle: 0, speed: 0, hit_dis: 4 } });
  const out = rec.applyTick(makeSnapshot({ bulletSpawns: [spawn] }));
  expect(out !== null, 'rebuild succeeds');
  expectEqual(out!.length, 0, 'out-of-bounds bullet culled');
  expectEqual(rec.size, 0);
});

// 6) 任一输入异常 → null（返回 null 时不修改内部状态）。
test('applyTick returns null on any malformed input', () => {
  // a) 模板字段非有限数。
  expectEqual(
    newReconstructor().applyTick(makeSnapshot({
      bulletSpawns: [makeSpawn({ template: { ...baseTemplate(), x: Number.NaN } })],
    })),
    null,
  );
  // b) 同批 spawn id 重复。
  expectEqual(
    newReconstructor().applyTick(makeSnapshot({
      bulletSpawns: [makeSpawn(), makeSpawn({ bulletId: 'b1' })],
    })),
    null,
  );
  // c) 悬空 despawn 是幂等 no-op（2026-11-08 实机修正）：客户端可能中途接入、
  //    或出界剔除比服务端早一帧，删除一个没见过的 id 不该让整帧回落。
  expect(
    newReconstructor().applyTick(makeSnapshot({
      bulletDespawns: [{ bulletId: 'ghost', reason: 'erase' }],
    })) !== null,
    'dangling despawn is ignored instead of failing the tick',
  );
  // d) deviation 非有限数。
  expectEqual(
    newReconstructor().applyTick(makeSnapshot({
      bulletSpawns: [makeSpawn()],
      bulletDeviations: [{ bulletId: 'b1', dx: Number.NaN, dy: 0, dvx: 0, dvy: 0 }],
    })),
    null,
  );
  // d2) deviation 引用不存在。
  expectEqual(
    newReconstructor().applyTick(makeSnapshot({
      bulletSpawns: [makeSpawn()],
      bulletDeviations: [{ bulletId: 'ghost', dx: 1, dy: 0, dvx: 0, dvy: 0 }],
    })),
    null,
  );
  // e) players 缺该弹 owner。
  expectEqual(
    newReconstructor().applyTick(makeSnapshot({
      bulletSpawns: [makeSpawn({ ownerPlayerId: 'pX' })],
    })),
    null,
  );
  // f) group 非恒等变换（本版 G_g ≡ I）。
  expectEqual(
    newReconstructor().applyTick(makeSnapshot({
      bulletSpawns: [makeSpawn()],
      groupMotion: [{ groupId: 1, tx: 5, ty: 0, phi: 0 }],
    })),
    null,
  );
  // g) tick 非有限数。
  expectEqual(
    newReconstructor().applyTick(makeSnapshot({
      tick: Number.NaN, bulletSpawns: [makeSpawn()],
    })),
    null,
  );
  // h) boss 坐标非有限数。
  expectEqual(
    newReconstructor().applyTick(makeSnapshot({
      bulletSpawns: [makeSpawn()],
      boss: { xMilli: Number.NaN, yMilli: 0, hp: 100, maxHp: 100, phase: 0, effects: [] },
    })),
    null,
  );
  // i) spawn 与已存活弹 id 重复（跨 tick）。
  const dup = newReconstructor();
  dup.applyTick(makeSnapshot({ tick: 1, bulletSpawns: [makeSpawn()] }));
  expectEqual(
    dup.applyTick(makeSnapshot({ tick: 2, bulletSpawns: [makeSpawn()] })),
    null,
  );
  // j) deviation 同 id 重复。
  expectEqual(
    newReconstructor().applyTick(makeSnapshot({
      bulletSpawns: [makeSpawn()],
      bulletDeviations: [
        { bulletId: 'b1', dx: 1, dy: 0, dvx: 0, dvy: 0 },
        { bulletId: 'b1', dx: 2, dy: 0, dvx: 0, dvy: 0 },
      ],
    })),
    null,
  );
});

// 7) reset 清空跨局状态。
test('reset clears all live bullets', () => {
  const rec = newReconstructor();
  rec.applyTick(makeSnapshot({ bulletSpawns: [makeSpawn()] }));
  expectEqual(rec.size, 1);
  rec.reset();
  expectEqual(rec.size, 0);
  const out = rec.applyTick(makeSnapshot({ tick: 2 }));
  expect(out !== null, 'post-reset tick rebuild succeeds');
  expectEqual(out!.length, 0, 'no stale bullet after reset');
});

// 8) 跨 tick 状态保持：同一实例连续推进，位置累积，且不依赖每帧重新 spawn。
test('state is preserved across ticks', () => {
  const rec = newReconstructor();
  const r1 = rec.applyTick(makeSnapshot({ tick: 1, bulletSpawns: [makeSpawn()] }));
  const r2 = rec.applyTick(makeSnapshot({ tick: 2 }));
  const r3 = rec.applyTick(makeSnapshot({ tick: 3 }));
  expect(r1 !== null && r2 !== null && r3 !== null, 'all ticks rebuild');
  expectEqual(rec.size, 1, 'bullet persists without re-spawn');
  expect(r1![0].yMilli !== r2![0].yMilli, 'tick 2 advanced position');
  expect(r2![0].yMilli !== r3![0].yMilli, 'tick 3 advanced position');
  // 与「只在 tick 3 一次性 spawn」不同 → 证明前两 tick 的运动被累积保留。
  const fresh = newReconstructor();
  const f3 = fresh.applyTick(makeSnapshot({ tick: 3, bulletSpawns: [makeSpawn()] }));
  expect(r3![0].yMilli !== f3![0].yMilli, 'accumulated state differs from single-tick spawn');
});

// 9) codec：wire_cap≠0 且 bullets[] 缺席 → 用传入实例重建并填入 bullets（跨帧）。
test('decode reconstructs bullets when bullets[] is absent', () => {
  const rec = newReconstructor();
  const spawnWire = {
    bullet_id: 'b1', owner_player_id: 'p1', t0: 1, p: 0, q: 0, group_id: 0,
    template: baseTemplate(),
  };
  const frame1 = { ...wireBase(), wire_cap: 1, bullet_spawns: [spawnWire] };
  const snap1 = decodeBossRaceSnapshot(snapshotPayload(frame1), rec);
  expect(snap1 !== null, 'delta frame decodes');
  expectEqual(snap1!.bullets.length, 1, 'bullets reconstructed from spawn');
  expectEqual(snap1!.bullets[0].bulletId, 'b1');
  expectEqual(snap1!.deltaRebuildMismatch, undefined, 'no mismatch on success');
  expectEqual(rec.size, 1);

  const frame2 = { ...wireBase(), tick: 2, wire_cap: 1, bullet_spawns: [] };
  const snap2 = decodeBossRaceSnapshot(snapshotPayload(frame2), rec);
  expect(snap2 !== null, 'second delta frame decodes');
  expectEqual(snap2!.bullets.length, 1, 'bullet carried across frames');
  expect(snap2!.bullets[0].yMilli !== snap1!.bullets[0].yMilli, 'position advanced');
});

// 10) codec：无实例 / 重建失败 → bullets=[] + deltaRebuildMismatch=true，绝不抛。
test('decode falls back safely with no instance or failed rebuild', () => {
  const spawnWire = {
    bullet_id: 'b1', owner_player_id: 'p1', t0: 1, p: 0, q: 0, group_id: 0,
    template: baseTemplate(),
  };
  // 显式传 null = 禁用重建（不依赖模块级默认实例的全局状态）。
  const noInstance = { ...wireBase(), wire_cap: 1, bullet_spawns: [spawnWire] };
  const snapA = decodeBossRaceSnapshot(snapshotPayload(noInstance), null);
  expect(snapA !== null, 'frame still decodes');
  expectEqual(snapA!.bullets.length, 0, 'empty bullets on no instance');
  expectEqual(snapA!.deltaRebuildMismatch, true, 'mismatch flag set');

  // 悬空 despawn 幂等忽略，不触发回落；真正的形状异常（id 非字符串）才回落。
  const rec = newReconstructor();
  const dangling = { ...wireBase(), wire_cap: 1, bullet_despawns: [{ bullet_id: 'ghost', reason: 'erase' }] };
  const snapOk = decodeBossRaceSnapshot(snapshotPayload(dangling), rec);
  expect(snapOk !== null, 'dangling despawn frame decodes');
  expect(snapOk!.deltaRebuildMismatch !== true, 'dangling despawn does not force a fallback');

  // deviation 仍要求引用已知弹（它改的是位置，不能静默丢弃）。
  const bad = { ...wireBase(), wire_cap: 1, bullet_deviations: [{ bullet_id: 'ghost', dx: 0, dy: 0, dvx: 0, dvy: 0 }] };
  const snapB = decodeBossRaceSnapshot(snapshotPayload(bad), rec);
  expect(snapB !== null, 'malformed frame still decodes');
  expectEqual(snapB!.bullets.length, 0, 'empty bullets on rebuild failure');
  expectEqual(snapB!.deltaRebuildMismatch, true, 'mismatch flag set');
});

// 11) codec：bullets[] 存在时保留既有「上一 tick 全量 + Δ」对照校验，不触发重建。
test('decode keeps legacy cross-check when bullets[] is present', () => {
  const rec = newReconstructor();
  const fullBullet = {
    bullet_id: 'b1', owner_player_id: 'p1',
    x_milli: 1000, y_milli: -2000, vx_milli: 300, vy_milli: -400,
    radius_milli: 4000, pattern_id: 'ring',
  };
  const obj = {
    ...wireBase(),
    bullets: [fullBullet],
    wire_cap: 1,
    // 悬空 deviation → 骨架对照必然不一致 → mismatch=true，但渲染用全量。
    bullet_deviations: [{ bullet_id: 'ghost', dx: 1, dy: 0, dvx: 0, dvy: 0 }],
  };
  const snap = decodeBossRaceSnapshot(snapshotPayload(obj), rec);
  expect(snap !== null, 'full frame decodes');
  expectEqual(snap!.bullets.length, 1, 'authoritative full bullets preserved');
  expectEqual(snap!.bullets[0].xMilli, 1000, 'full bullet untouched');
  expectEqual(snap!.deltaRebuildMismatch, true, 'legacy cross-check flag unchanged');
  expectEqual(rec.size, 0, 'reconstructor not driven on the full path');
});
