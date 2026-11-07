/**
 * 弹幕差量 wire（docs/danmaku-delta-wire.md §4）客户端骨架测试。
 *
 * 覆盖：legacy 缺省逐字段 undefined、delta 字段透传、重建 == 全量、
 * 异常静默回落、wire_cap 位含义。全量 bullets[] 本轮仍保留兜底。
 */
import { decodeBossRaceSnapshot } from '../src/core/net/battle_codec';
import { bulletsEqual, rebuildBulletsFromDelta } from '../src/core/net/bullet_delta';
import { BattlePayloadType } from '../src/core/protocol/types';
import type {
  BossRaceBullet,
  BossRaceBulletDeviation,
  BossRaceGroupMotion,
} from '../src/core/sim/boss_race';
import { expect, expectEqual, test } from './harness';

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

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function snapshotPayload(obj: Record<string, unknown>): Uint8Array {
  return concat(new Uint8Array([BattlePayloadType.SNAPSHOT]), utf8(JSON.stringify(obj)));
}

const FULL_BULLET: Record<string, unknown> = {
  bullet_id: 'b1',
  owner_player_id: 'p1',
  x_milli: 1000,
  y_milli: -2000,
  vx_milli: 300,
  vy_milli: -400,
  radius_milli: 4000,
  pattern_id: 'gap_ring',
};

function baseSnapshot(): Record<string, unknown> {
  return {
    tick: 45,
    state: 'running',
    winner_player_id: '',
    winner_tick: 0,
    state_hash: 'cafebabe',
    players: [],
    bullets: [FULL_BULLET],
  };
}

function makeBullet(overrides: Partial<BossRaceBullet> & Pick<BossRaceBullet, 'bulletId'>): BossRaceBullet {
  return {
    bulletId: overrides.bulletId,
    ownerPlayerId: overrides.ownerPlayerId ?? 'p1',
    xMilli: overrides.xMilli ?? 0,
    yMilli: overrides.yMilli ?? 0,
    vxMilli: overrides.vxMilli ?? 0,
    vyMilli: overrides.vyMilli ?? 0,
    radiusMilli: overrides.radiusMilli ?? 4000,
    patternId: overrides.patternId ?? 'ring',
    bulletKind: overrides.bulletKind,
    motionFunc: overrides.motionFunc,
    chainId: overrides.chainId,
    generation: overrides.generation,
    hidden: overrides.hidden,
  };
}

// 1) legacy：老服务端一个 delta 字段都不发 → 全部 undefined，绝不抛；
//    渲染用的全量 bullets[] 不受影响。
test('legacy snapshot leaves every delta field undefined', () => {
  const snapshot = decodeBossRaceSnapshot(snapshotPayload(baseSnapshot()));
  expect(snapshot !== null, 'legacy snapshot decodes');
  expectEqual(snapshot!.wireCap, undefined);
  expectEqual(snapshot!.bulletSpawns, undefined);
  expectEqual(snapshot!.bulletDeviations, undefined);
  expectEqual(snapshot!.bulletDespawns, undefined);
  expectEqual(snapshot!.groupMotion, undefined);
  expectEqual(snapshot!.deltaRebuildMismatch, undefined);
  expectEqual(snapshot!.bullets.length, 1);
  expectEqual(snapshot!.bullets[0].xMilli, 1000);
});

// 2) delta 字段透传 + wire_cap 位含义（1=SPAWN 2=DEVIATION 4=GROUP）。
test('delta fields are parsed optionally and wire_cap bits are meaningful', () => {
  const obj = {
    ...baseSnapshot(),
    wire_cap: 7,
    bullet_spawns: [{
      bullet_id: 'b2', owner_player_id: 'p1', t0: 45, p: 3, q: 7, group_id: 0,
      template: { x: 320, y: 120, angle: 90, speed: 3, bullet_kind: 12,
                   bullet_func_no: 7, hit_dis: 4, hit_hantei: true },
    }],
    bullet_deviations: [{ bullet_id: 'b1', dx: 120, dy: -40, dvx: 0, dvy: 0 }],
    bullet_despawns: [{ bullet_id: 'b9', reason: 'spell_clear' }],
    group_motion: [{ group_id: 1, tx: 0, ty: 0, phi: 0 }],
  };
  const snapshot = decodeBossRaceSnapshot(snapshotPayload(obj));
  expect(snapshot !== null, 'delta snapshot decodes');
  expectEqual(snapshot!.wireCap, 7);
  expect((snapshot!.wireCap! & 1) !== 0, 'SPAWN bit (1) is set');
  expect((snapshot!.wireCap! & 2) !== 0, 'DEVIATION bit (2) is set');
  expect((snapshot!.wireCap! & 4) !== 0, 'GROUP bit (4) is set');
  expectEqual(snapshot!.bulletSpawns!.length, 1);
  expectEqual(snapshot!.bulletSpawns![0].bulletId, 'b2');
  expectEqual(snapshot!.bulletSpawns![0].p, 3);
  expectEqual(snapshot!.bulletSpawns![0].q, 7);
  expectEqual(snapshot!.bulletSpawns![0].template.speed, 3);
  expectEqual(snapshot!.bulletSpawns![0].template.hit_hantei, true);
  expectEqual(snapshot!.bulletDeviations![0].dx, 120);
  expectEqual(snapshot!.bulletDeviations![0].dy, -40);
  expectEqual(snapshot!.bulletDespawns![0].reason, 'spell_clear');
  expectEqual(snapshot!.groupMotion![0].groupId, 1);
  // 全量 bullets[] 仍是兜底，渲染值不被 Δ 覆盖。
  expectEqual(snapshot!.bullets.length, 1);
  expectEqual(snapshot!.bullets[0].xMilli, 1000);
  // Δ≠0 时以「本快照全量」作骨架基线必然不一致 → 静默回落到全量。
  expectEqual(snapshot!.deltaRebuildMismatch, true);
});

// 3) 重建 == 全量：空 delta 逐位相等；「上一 tick 全量 + Δ」== 当前全量。
test('rebuildBulletsFromDelta matches the full snapshot', () => {
  const previous: BossRaceBullet[] = [
    makeBullet({ bulletId: 'b1', xMilli: 1000, yMilli: 2000, vxMilli: 100, vyMilli: -50 }),
    makeBullet({ bulletId: 'b2', xMilli: 500, yMilli: 600, vxMilli: 0, vyMilli: 10 }),
  ];
  // 空 delta：重建 == 基线（逐位）。
  const same = rebuildBulletsFromDelta(undefined, undefined, undefined, undefined, previous);
  expect(same !== null, 'empty-delta rebuild succeeds');
  expect(bulletsEqual(same!, previous), 'empty delta rebuild equals previous bullets');

  // 上一 tick 全量 + Δ(b1) == 当前 tick 权威全量。
  const current: BossRaceBullet[] = [
    makeBullet({ bulletId: 'b1', xMilli: 1120, yMilli: 1960, vxMilli: 100, vyMilli: -50 }),
    makeBullet({ bulletId: 'b2', xMilli: 500, yMilli: 600, vxMilli: 0, vyMilli: 10 }),
  ];
  const deviations: BossRaceBulletDeviation[] = [
    { bulletId: 'b1', dx: 120, dy: -40, dvx: 0, dvy: 0 },
  ];
  const rebuilt = rebuildBulletsFromDelta(undefined, deviations, undefined, undefined, previous);
  expect(rebuilt !== null, 'incremental rebuild succeeds');
  expect(bulletsEqual(rebuilt!, current), 'previous + delta equals full current snapshot');
});

// 4) 任一输入异常 → null（调用方据此回落全量）。
test('rebuildBulletsFromDelta returns null on any malformed input', () => {
  const previous: BossRaceBullet[] = [
    makeBullet({ bulletId: 'b1', xMilli: 1000 }),
  ];
  // deviation 引用不存在的弹。
  const ghost: BossRaceBulletDeviation[] = [
    { bulletId: 'ghost', dx: 1, dy: 0, dvx: 0, dvy: 0 },
  ];
  expectEqual(rebuildBulletsFromDelta(undefined, ghost, undefined, undefined, previous), null);
  // deviation 非有限数。
  const nan: BossRaceBulletDeviation[] = [
    { bulletId: 'b1', dx: Number.NaN, dy: 0, dvx: 0, dvy: 0 },
  ];
  expectEqual(rebuildBulletsFromDelta(undefined, nan, undefined, undefined, previous), null);
  // group 非恒等变换（本版 G_g ≡ I，超出范围）。
  const nonIdentity: BossRaceGroupMotion[] = [
    { groupId: 1, tx: 5, ty: 0, phi: 0 },
  ];
  expectEqual(rebuildBulletsFromDelta(undefined, undefined, undefined, nonIdentity, previous), null);
  // spawn 与基线 id 重复（发号权归服务端，不得各自造号）。
  const duplicate = [{
    bulletId: 'b1', ownerPlayerId: 'p1', t0: 0, p: 0, q: 0, groupId: 0,
    template: { x: 1, y: 2 },
  }];
  expectEqual(rebuildBulletsFromDelta(duplicate, undefined, undefined, undefined, previous), null);
  // previousBullets 非数组。
  expectEqual(
    rebuildBulletsFromDelta(undefined, undefined, undefined, undefined,
                            null as unknown as BossRaceBullet[]),
    null,
  );
});

// 5) decode 对照校验：wire_cap≠0 但重建失败 → 静默回落全量，只打标记。
test('decode falls back to full bullets on rebuild failure', () => {
  const obj = {
    ...baseSnapshot(),
    wire_cap: 7,
    bullet_deviations: [{ bullet_id: 'ghost', dx: 1, dy: 0, dvx: 0, dvy: 0 }],
  };
  const snapshot = decodeBossRaceSnapshot(snapshotPayload(obj));
  expect(snapshot !== null, 'malformed-delta snapshot still decodes');
  expectEqual(snapshot!.deltaRebuildMismatch, true);
  expectEqual(snapshot!.bullets.length, 1);
  expectEqual(snapshot!.bullets[0].xMilli, 1000);
});

// 6) wire_cap=0 / 缺省 → 全量路径，不触发对照校验。
test('wire_cap 0 keeps the legacy full path', () => {
  const obj = {
    ...baseSnapshot(),
    wire_cap: 0,
    bullet_deviations: [{ bullet_id: 'ghost', dx: 1, dy: 0, dvx: 0, dvy: 0 }],
  };
  const snapshot = decodeBossRaceSnapshot(snapshotPayload(obj));
  expect(snapshot !== null, 'wire_cap=0 snapshot decodes');
  expectEqual(snapshot!.wireCap, 0);
  expectEqual(snapshot!.deltaRebuildMismatch, undefined);
  expectEqual(snapshot!.bullets[0].xMilli, 1000);
});
