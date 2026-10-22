/**
 * 链式分裂（H 族 `bulletFunc31`「Boss 分裂/召唤」）的客户端镜像。
 *
 * 服务端 `src/danmaku/chain_split.cpp` 把「子子弹生成」这件事真正做了出来——
 * 在它落地前 `bulletFunc31` 只置一个标记（`func31()` 里 `p2 = 1`），没有任何
 * 宿主消费它，于是一颗子弹永远不会产生第二颗。本文件是那件事的逐项镜像，
 * 用于客户端本地重推（.dem 重放）与预测；纯插帧路径不需要它。
 *
 * 三项硬约束与服务端一致，改这里必须同步改 C++：
 *
 * 1. **服务端权威**：分裂只发生在权威推进路径（客户端 `advanceBullets` 镜像）。
 *    客户端要么插帧服务端快照，要么用本文件同算法重推，不用自己的判断。
 * 2. **可由种子推导**：子子弹全部参数来自
 *    `DeterministicRng(match_seed, tick, pattern_index, host_spawn_index)`，
 *    无系统时间/帧率/无序容器参与。
 * 3. **密度可控**：代数、每宿主子数、单 tick 每玩家宿主预算三个上限，叠加
 *    已有的每玩家总量上限。
 *
 * ⚠ 触发条件只能判 `bullet_func_no === 31 && p2 !== 0`：`bulletFunc42`（变身）
 * 与 `bulletFunc55`（蓄力）同样会写 `p2 = 1`，`bulletFunc42` 甚至也写
 * `rotate_flg = 2`，但它们不是分裂族，用 `p2` 单独判定会误触发。
 */

import type { BossRaceSeed } from '../../math/boss_race_seed';
import {
  BulletMotion,
  DeterministicRng,
  createBulletMotion,
  integrateVelocity,
  normalizeDeg,
} from './bullet_motion';

/**
 * 代数上限：0 = pattern 波次直生（宿主），1 = 第一代子子弹，2 = 第二代（叶子）。
 *
 * 取 2 的理由（与服务端注释一致）：单宿主最坏产出 = 8^1 + 8^2 = 72 颗；放到
 * 3 代则最坏 8 + 64 + 512 = 584 颗/宿主，必然撞穿每玩家 384 的总量钳制，并把
 * 该玩家的主发射波次挤光。2 代下「一波 4 颗宿主」最坏 4×73 = 292 < 384。
 */
export const CHAIN_SPLIT_MAX_GENERATION = 2;

/** 每个宿主每次分裂的子子弹数（整环 45° 间隔）。 */
export const CHAIN_SPLIT_CHILDREN_PER_HOST = 8;

/** 单 tick 内每玩家允许分裂的宿主数上限。 */
export const CHAIN_SPLIT_HOSTS_PER_PLAYER_PER_TICK = 8;

/** 子子弹 `spawn_index = host_spawn_index + base + ordinal`。 */
export const CHAIN_SPLIT_SPAWN_INDEX_BASE = 0x10000;

/** 子子弹角度 = `NormalizeDeg(host.angle + ordinal×45° + (u-0.5)×jitter)`。 */
export const CHAIN_SPLIT_ANGLE_STEP_DEG = 45.0; // 360 / CHAIN_SPLIT_CHILDREN_PER_HOST
export const CHAIN_SPLIT_ANGLE_JITTER_DEG = 8.0; // ±(jitter/2)

/** 子子弹速度 = `host.speed × (lo + (hi-lo)×u)`，即 0.6×~1.0×宿主速度。 */
export const CHAIN_SPLIT_CHILD_SPEED_LO = 0.6;
export const CHAIN_SPLIT_CHILD_SPEED_HI = 1.0;

/** 子子弹命中半径：宿主 `hit_dis` ≤ 0（未初始化路径）时兜底。 */
export const CHAIN_SPLIT_CHILD_HIT_DIS = 4.0;

/**
 * 分裂请求判定：`bulletFunc31` 的「本帧请求分裂」标记。
 *
 * 只认 `bullet_func_no === 31`，理由见文件头。代数钳制**不在**本函数内——由
 * 调用方按 `generation < CHAIN_SPLIT_MAX_GENERATION` 另行判断，本函数只回答
 * 「子弹本帧是否请求了分裂」。
 */
export function chainSplitRequested(b: BulletMotion): boolean {
  return b.bullet_func_no === 31 && b.p2 !== 0;
}

/** 单个宿主本帧分裂出的子子弹参数（纯数据，尚未组装成 `BulletMotion`）。 */
export interface ChainSplitChild {
  /** 绝对角度（度，`[0, 360)`）。 */
  angleDeg: number;
  /** 像素/帧。 */
  speed: number;
  /** 派生 spawn_index（子子弹终身携带）。 */
  spawnIndex: number;
}

/**
 * 计算一个宿主的分裂子子弹参数。
 *
 * 确定性契约（必须与 `ComputeChainSplitChildren` 逐项一致）：
 * - RNG = `DeterministicRng(seed, tick, pattern_index, host_spawn_index)`，
 *   每颗粒子按序消耗 2 次 `randomInt(0, 9999)`：先角度抖动 `u_a`，再速度因子
 *   `u_s`；`unit = value / 10000`。
 * - `angle_i = normalizeDeg(host.angle + i×45 + (u_a-0.5)×8)`
 * - `speed_i = host.speed × (0.6 + 0.4×u_s)`
 * - `spawn_index_i = host_spawn_index + 0x10000 + i`
 * - `max_children` 钳制只改变循环次数（RNG 按颗粒序号取用，不预滚），因此
 *   「预算不足只生成前 n 颗」在两端一致。
 *
 * 请求判定不在此函数内：调用方必须先用 {@link chainSplitRequested} 判定。
 * `host` 只读；`maxChildren <= 0` 时返回空数组。
 */
export function computeChainSplitChildren(
  host: BulletMotion,
  seed: BossRaceSeed,
  tick: number,
  patternIndex: number,
  hostSpawnIndex: number,
  maxChildren: number,
): ChainSplitChild[] {
  const children: ChainSplitChild[] = [];
  if (maxChildren <= 0) {
    return children;
  }
  const count = Math.min(CHAIN_SPLIT_CHILDREN_PER_HOST, maxChildren);
  const rng = new DeterministicRng(seed, tick, patternIndex, hostSpawnIndex);
  for (let i = 0; i < count; i += 1) {
    const uAngle = rng.randomInt(0, 9999) / 10000;
    const uSpeed = rng.randomInt(0, 9999) / 10000;
    children.push({
      angleDeg: normalizeDeg(
        host.angle +
          i * CHAIN_SPLIT_ANGLE_STEP_DEG +
          (uAngle - 0.5) * CHAIN_SPLIT_ANGLE_JITTER_DEG,
      ),
      speed:
        host.speed *
        (CHAIN_SPLIT_CHILD_SPEED_LO +
          (CHAIN_SPLIT_CHILD_SPEED_HI - CHAIN_SPLIT_CHILD_SPEED_LO) * uSpeed),
      spawnIndex: hostSpawnIndex + CHAIN_SPLIT_SPAWN_INDEX_BASE + i,
    });
  }
  return children;
}

/**
 * 组装一颗子子弹的完整 {@link BulletMotion}。
 *
 * 与服务端 `MakeChainSplitChildMotion` 逐字段对应：
 * - 位置 = 宿主当前位置（分裂发生在宿主本帧 update 之后）；
 * - `bullet_kind` / `bullet_func_no`(31) / `p1` 继承宿主 ⇒ 子子弹到自己的
 *   `t === p1` 帧会再次请求分裂，这就是「链式」；到叶子代由代数钳制停止；
 * - `t` / `life` / `p2` / `delay` / `vanish_delay` / `rotate_flg` 归零；
 * - `angle_init = -1`、`speed_cap` / `accel` / `angle_acc` / `angle_spd` /
 *   `f56c` / `f598` / `prev_angle` / `xacc` / `xacc_cap` 归零（直线飞出）；
 * - `speed` / `speed_init` / `spd_init2` 取 `child.speed`，并 `integrateVelocity`；
 * - `hit_dis`：宿主已带（> 0）则继承，否则兜底 {@link CHAIN_SPLIT_CHILD_HIT_DIS}。
 */
export function makeChainSplitChildMotion(
  host: BulletMotion,
  child: ChainSplitChild,
): BulletMotion {
  const b = createBulletMotion();
  b.x = host.x;
  b.y = host.y;
  b.bullet_kind = host.bullet_kind;
  b.bullet_func_no = host.bullet_func_no;
  b.p1 = host.p1;
  b.angle = child.angleDeg;
  b.speed = child.speed;
  b.speed_init = child.speed;
  b.spd_init2 = child.speed;
  b.angle_init = -1;
  b.speed_cap = 0;
  b.accel = 0;
  b.angle_acc = 0;
  b.angle_spd = 0;
  b.f56c = 0;
  b.f598 = 0;
  b.prev_angle = 0;
  b.xacc = 0;
  b.xacc_cap = 0;
  b.pf1 = 1;
  b.pf2 = 0;
  b.bullet_life = 0;
  b.life = 0;
  b.p2 = 0;
  b.delay = 0;
  b.vanish_delay = 0;
  b.rotate_flg = 0;
  b.hit_dis = host.hit_dis > 0 ? host.hit_dis : CHAIN_SPLIT_CHILD_HIT_DIS;
  b.hit_hantei = true;
  integrateVelocity(b);
  return b;
}
