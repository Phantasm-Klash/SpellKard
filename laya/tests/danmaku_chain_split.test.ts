/**
 * 链式分裂（H 族 `bulletFunc31`）客户端镜像测试。
 *
 * 服务端在 `src/danmaku/chain_split.cpp` 把「子子弹生成」真正做了出来；在它
 * 落地前 `func31()` 只置 `p2 = 1`，没有任何宿主消费，于是一颗子弹永远不会
 * 产生第二颗。这里守四件事：
 *   1. 判据只认 `bullet_func_no === 31`（`bulletFunc42/55` 同样写 p2，会误触发）；
 *   2. 同种子两次运行逐字节一致、换种子必变（否则 .dem 重放会分叉）；
 *   3. 子子弹几何/字段按契约推导（角度步进、速度带、spawn_index、字段继承）；
 *   4. 通过真实 simulation 验证「链真的发生」并且到叶子代停止。
 */

import {
  CHAIN_SPLIT_CHILDREN_PER_HOST,
  CHAIN_SPLIT_SPAWN_INDEX_BASE,
  chainSplitRequested,
  computeChainSplitChildren,
  makeChainSplitChildMotion,
} from '../src/core/sim/danmaku/chain_split';
import { createBulletMotion } from '../src/core/sim/danmaku/bullet_motion';
import { BossRaceSimulation, defaultBossRaceConfig } from '../src/core/sim/boss_race';
import { bossRaceSeedFromHex } from '../src/core/math/boss_race_seed';
import { expect, expectClose, expectEqual, suite, test } from './harness';

const SEED = bossRaceSeedFromHex('0011223344556677');

function hostBullet(): ReturnType<typeof createBulletMotion> {
  const b = createBulletMotion();
  b.bullet_kind = 45; // kome_01
  b.bullet_func_no = 31; // H 族：分裂/召唤
  b.p1 = 1; // 第 1 帧请求分裂
  b.life = 0;
  b.speed = 3;
  b.angle = 10;
  b.x = 320;
  b.y = 96;
  return b;
}

suite('danmaku chain split mirror');
  test('the predicate only answers for bulletFunc31', () => {
    const split = hostBullet();
    split.p2 = 1;
    expect(chainSplitRequested(split), 'func31 with p2 set must request a split');

    split.p2 = 0;
    expect(!chainSplitRequested(split), 'p2 clear must not request');

    // bulletFunc42 (transform) and 55 (charge) also write p2 = 1, and 42 even
    // writes rotate_flg = 2 -- neither is a split family.
    const transform = hostBullet();
    transform.bullet_func_no = 42;
    transform.p2 = 1;
    transform.rotate_flg = 2;
    expect(!chainSplitRequested(transform), 'func42 must not be treated as a split');

    const charge = hostBullet();
    charge.bullet_func_no = 55;
    charge.p2 = 1;
    expect(!chainSplitRequested(charge), 'func55 must not be treated as a split');
  });

  test('children are derived from the seed, so a replay is reproducible', () => {
    const host = hostBullet();
    const first = computeChainSplitChildren(host, SEED, 7, 0, 5, CHAIN_SPLIT_CHILDREN_PER_HOST);
    const again = computeChainSplitChildren(host, SEED, 7, 0, 5, CHAIN_SPLIT_CHILDREN_PER_HOST);
    expectEqual(first.length, CHAIN_SPLIT_CHILDREN_PER_HOST, 'a full volley is eight');
    for (let i = 0; i < first.length; i += 1) {
      expectEqual(first[i].angleDeg, again[i].angleDeg, `child ${i} angle`);
      expectEqual(first[i].speed, again[i].speed, `child ${i} speed`);
      expectEqual(first[i].spawnIndex, again[i].spawnIndex, `child ${i} spawn index`);
    }

    // A different seed must move the angles; identical output would mean the
    // seed never reached the RNG.
    const other = computeChainSplitChildren(host, bossRaceSeedFromHex('ffeeddccbbaa9988'), 7, 0, 5, CHAIN_SPLIT_CHILDREN_PER_HOST);
    let moved = 0;
    for (let i = 0; i < first.length; i += 1) {
      if (first[i].angleDeg !== other[i].angleDeg) moved += 1;
    }
    expect(moved > 0, 'a different seed must change the child angles');
  });

  test('child geometry follows the contract', () => {
    const host = hostBullet();
    host.angle = 0;
    host.speed = 4;
    const children = computeChainSplitChildren(host, SEED, 3, 0, 0, CHAIN_SPLIT_CHILDREN_PER_HOST);
    expectEqual(children.length, CHAIN_SPLIT_CHILDREN_PER_HOST, 'eight children');

    for (let i = 0; i < children.length; i += 1) {
      // spawn_index = host_spawn_index + 0x10000 + ordinal
      expectEqual(children[i].spawnIndex, CHAIN_SPLIT_SPAWN_INDEX_BASE + i, `child ${i} spawn index`);
      // speed = host.speed * [0.6, 1.0]
      expect(children[i].speed >= 4 * 0.6 - 1e-9 && children[i].speed <= 4 + 1e-9, `child ${i} speed band`);
      // angle = normalize(0 + i*45 + jitter), so it sits within ±4° of the spoke
      const spoke = (i * 45) % 360;
      const delta = Math.abs(((children[i].angleDeg - spoke + 540) % 360) - 180);
      expect(180 - delta <= 4 + 1e-9, `child ${i} angle is on its spoke (got ${children[i].angleDeg})`);
    }
  });

  test('a truncated budget still produces a prefix, in the same order', () => {
    const host = hostBullet();
    const full = computeChainSplitChildren(host, SEED, 11, 2, 9, CHAIN_SPLIT_CHILDREN_PER_HOST);
    const short = computeChainSplitChildren(host, SEED, 11, 2, 9, 3);
    expectEqual(short.length, 3, 'budget truncates the count');
    for (let i = 0; i < short.length; i += 1) {
      expectEqual(short[i].angleDeg, full[i].angleDeg, `prefix ${i} angle matches the full run`);
      expectEqual(short[i].spawnIndex, full[i].spawnIndex, `prefix ${i} spawn index matches`);
    }
    expectEqual(computeChainSplitChildren(host, SEED, 11, 2, 9, 0).length, 0, 'no budget means no children');
  });

  test('child motion inherits the host and starts from rest', () => {
    const host = hostBullet();
    host.hit_dis = 7;
    const children = computeChainSplitChildren(host, SEED, 5, 0, 0, CHAIN_SPLIT_CHILDREN_PER_HOST);
    const child = makeChainSplitChildMotion(host, children[0]);

    // Position is the host's current position (the split happens after the host
    // moved this tick).
    expectEqual(child.x, host.x, 'child x = host x');
    expectEqual(child.y, host.y, 'child y = host y');
    // Identity carries over, so the child splits again on its own t === p1 tick.
    expectEqual(child.bullet_kind, 45, 'child keeps the bullet kind');
    expectEqual(child.bullet_func_no, 31, 'child keeps func31, which is what chains');
    expectEqual(child.p1, host.p1, 'child keeps the trigger frame');
    // Hit radius inherits when the host has one.
    expectEqual(child.hit_dis, 7, 'child inherits the host hit radius');
    // Timers are zeroed: the child starts moving on the *next* tick.
    expectEqual(child.t, 0, 'child t starts at 0');
    expectEqual(child.life, 0, 'child life starts at 0');
    expectEqual(child.p2, 0, 'child p2 starts clear');
    expectEqual(child.delay, 0, 'child delay starts at 0');
    expectEqual(child.rotate_flg, 0, 'child rotate_flg starts at 0');
    // Straight flight: the acceleration family is zeroed.
    expectEqual(child.accel, 0, 'child accel zeroed');
    expectEqual(child.speed_cap, 0, 'child speed_cap zeroed');
    expectEqual(child.angle_acc, 0, 'child angle_acc zeroed');
    // Speed is written to all three slots and integrated into vx/vy.
    expectEqual(child.speed, children[0].speed, 'child speed is the derived one');
    expectEqual(child.speed_init, children[0].speed, 'speed_init matches');
    expectEqual(child.spd_init2, children[0].speed, 'spd_init2 matches');
    expect(child.vx !== 0 || child.vy !== 0, 'velocity was integrated from the angle');

    // A host with no hit radius gets the default.
    const bare = hostBullet();
    bare.hit_dis = 0;
    const bareChild = makeChainSplitChildMotion(bare, computeChainSplitChildren(bare, SEED, 5, 0, 0, 1)[0]);
    expectClose(bareChild.hit_dis, 4, 1e-12, 'a host without a hit radius falls back to the default');
  });

  test('a chain really happens through the simulation and stops at the leaf', () => {
    const sim = new BossRaceSimulation(defaultBossRaceConfig('match-chain-001', SEED));
    sim.addPlayer('p1', 0, 0);

    const host = hostBullet();
    expect(sim.injectLiveBulletForTest('p1', host, 0), 'host injected');
    sim.tick(); // t becomes 1 === p1, so func31 requests a split
    const afterFirst = sim.snapshot().bullets.length;
    expectEqual(afterFirst, 1 + CHAIN_SPLIT_CHILDREN_PER_HOST, 'one host splits into eight');

    sim.tick(); // each child now reaches its own t === p1 and splits
    const afterSecond = sim.snapshot().bullets.length;
    expectEqual(
      afterSecond,
      1 + CHAIN_SPLIT_CHILDREN_PER_HOST + CHAIN_SPLIT_CHILDREN_PER_HOST * CHAIN_SPLIT_CHILDREN_PER_HOST,
      'second generation multiplies out',
    );

    // The grandchildren are at CHAIN_SPLIT_MAX_GENERATION, so they must not
    // split again even though they carry the same trigger.
    for (let i = 0; i < 5; i += 1) {
      sim.tick();
    }
    expectEqual(sim.snapshot().bullets.length, afterSecond, 'the leaf generation stops the chain');
  });

  test('the same seed replays identically through the simulation', () => {
    const runOnce = () => {
      const sim = new BossRaceSimulation(defaultBossRaceConfig('match-chain-replay', SEED));
      sim.addPlayer('p1', 0, 0);
      expect(sim.injectLiveBulletForTest('p1', hostBullet(), 0), 'host injected');
      for (let i = 0; i < 6; i += 1) {
        sim.tick();
      }
      return sim.canonicalStateHash();
    };
    expectEqual(runOnce(), runOnce(), 'two runs of the same seed must hash identically');
  });
