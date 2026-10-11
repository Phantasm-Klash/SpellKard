/**
 * 千夜追忆 1.40 `EnemyBullet` 运动学 —— **逐函数**移植
 * `PhK-BattleServer/src/danmaku/bullet_motion.cpp`（79 个 `bulletFunc`）。
 *
 * 这个文件是「客户端不再自己写弹幕」的核心：以前这里是一套按「行为族」近似的
 * 运动学（`stepHoming`/`stepSine`/…），只覆盖 5 个族、常量自拟，因此客户端弹幕
 * 与服务端**逐字节不同**。现在改为与服务端同一份实现逐行对应 —— 同名函数、同名
 * 字段、同样的条件极性、同样的常量、同样的分派表。任何一处偏差都会直接落进
 * `CanonicalStateHash`。
 *
 * 移植规则
 * --------
 *  - **字段名与服务端 `struct BulletMotion` 一一对应**（`angle_init` / `spd_init2` /
 *    `xacc_cap`…），便于逐行核对。
 *  - **算术全部走 `core/math/float_lib`**：角度单位=度、`fmod` 归一化、
 *    `llround` 半值远离零。三角用 `sinDeg/cosDeg`（原版 `MyMathUtil::sin/cos`）。
 *  - **分工对齐原版**：`updateBulletMotion` 只做「delay 倒计时 → 角积分 →
 *    `bulletFunc` 分派 → `IntegrateVelocity`」，**不移动位置、不递增 `life`**；
 *    位置积分 `pos += (vx, vy)` 与 `t += 1` 由宿主（`BossRaceSimulation`）完成，
 *    与原版 `EnemyBullet::update` / 服务端 `AdvanceBullets` 的分工一致。
 *    ★ 服务端**从不递增 `life`**（只递增 `t`），客户端以前递增过 —— 这是必须消掉的
 *    差异，否则 `Func14/16/21/22/23/34/35/39/41/42/44/53/74/80/85` 全部走错分支。
 *  - **确定性**：`bulletFunc` 本身不含 RNG；只有「分裂/随机角」族经
 *    `DeterministicRng` 引入随机，输入为 `(match_seed, tick, pattern_index,
 *    spawn_index)`，与服务端 `DeterministicRng` 同构，禁用系统时间/帧率。
 *
 * 未确定项（`rev/patterns/bullet_funcs_disasm.md` §8）在服务端同样只是近似，
 * 这里**照抄服务端的近似**——客户端的目标是与服务端一致，不是比服务端更准。
 */

import {
  BULLET_MOTIONS,
  BULLET_MOTION_COUNT,
  bulletMotionInfo,
  type BulletMotionInfo,
} from './bullet_motion_table';
import { BULLET_KIND_MAX, BULLET_KIND_MIN } from './bullet_kind';
import type { BossRaceSeed } from '../../math/boss_race_seed';
import {
  angleToPoint,
  cosDeg,
  HALF_H_PX,
  HALF_W_PX,
  normalizeDeg,
  sinDeg,
  TOP_MARGIN_PX,
} from '../../math/float_lib';

export type { BulletMotionInfo };
export { BULLET_MOTIONS, BULLET_MOTION_COUNT, bulletMotionInfo };

/** 度三角与归一化从统一浮点库转出，调用方只需 import 本模块。 */
export { cosDeg, normalizeDeg, sinDeg };

// --- 行为族（仅供渲染层选择画法，不参与模拟） -------------------------------

/** 运动学族（英文稳定标识，供渲染/判定使用）。 */
export type BulletMotionFamily =
  | 'init_linear' // A 初始化/直线
  | 'accelerate' // B 加速/减速
  | 'sine' // C 正弦调速/正弦角
  | 'homing' // D 追踪/限速转向
  | 'aimed' // E 周期瞄准/出屏转向
  | 'bounce' // F 边界反弹/镜像
  | 'proximity' // G 接近触发
  | 'split' // H 分裂/召唤（Boss）
  | 'reskin' // I 换皮/半径
  | 'parametric' // J 参数方程/摆线
  | 'state_machine' // K 状态机（全局状态）
  | 'auxiliary' // L 辅助（无字段写入）
  | 'unknown'; // M 未确定

/** 族分组前缀字母 → 族。 */
const GROUP_PREFIX_FAMILY: Readonly<Record<string, BulletMotionFamily>> = {
  A: 'init_linear',
  B: 'accelerate',
  C: 'sine',
  D: 'homing',
  E: 'aimed',
  F: 'bounce',
  G: 'proximity',
  H: 'split',
  I: 'reskin',
  J: 'parametric',
  K: 'state_machine',
  L: 'auxiliary',
  M: 'unknown',
};

/**
 * 分组为空串的 7 个函数（`rev/patterns/bullet_funcs_disasm.md` 中 family_group 未归类），
 * 按其在文档里的 `family` 语义手工归族。
 */
const FUNC_FAMILY_OVERRIDE: Readonly<Record<number, BulletMotionFamily>> = {
  14: 'reskin', // 半径插值：写 hitDis
  37: 'sine', // 正弦角
  46: 'bounce', // 折角（±90）
  52: 'auxiliary', // 随机角（随机由服务端提供）
  61: 'aimed', // 四方向瞄准
  63: 'init_linear', // 重置 a=A0
  64: 'state_machine', // 分阶段（按 L 分支）
};

/** 取某运动函数的族；未知 func 返回 `'unknown'`。 */
export function bulletMotionFamily(func: number): BulletMotionFamily {
  const override = FUNC_FAMILY_OVERRIDE[func];
  if (override !== undefined) {
    return override;
  }
  const info = bulletMotionInfo(func);
  if (info === undefined) {
    return 'unknown';
  }
  const prefix = info.group.charAt(0);
  return GROUP_PREFIX_FAMILY[prefix] ?? 'unknown';
}

/** 契约里登记的全部 func 编号（79 个）。 */
export function knownBulletMotionFuncs(): readonly number[] {
  return BULLET_MOTIONS.map((m) => m.func);
}

// --- 运动状态（对齐服务端 struct BulletMotion） ------------------------------

/**
 * `EnemyBullet` 运动状态，字段名与 `bullet_motion.hpp` 的 `struct BulletMotion`
 * 完全一致。坐标单位 = **像素浮点**（原版场地 640×960），由宿主在快照/哈希边界
 * 转成 milli。
 */
export interface BulletMotion {
  /** 位置（px）。 */
  x: number;
  y: number;
  /** 每帧位移 X（+0x57c）。 */
  vx: number;
  /** 每帧位移 Y（+0x580）。 */
  vy: number;
  /** 当前角度（度）（+0x560）。 */
  angle: number;
  /** 当前速度（+0x570）。 */
  speed: number;
  /** 速度加速度 `spdAcc`（+0x574）。 */
  accel: number;
  /** 帧计时器 `t1`（+0x5dc），每帧自增。 */
  t: number;
  /** 生命帧计数/阈值（+0x5b8）。★ 服务端从不递增它。 */
  life: number;

  /** +0x564 角度步长/容差 `w`。 */
  angle_spd: number;
  /** +0x568 角加速度 `aa`。 */
  angle_acc: number;
  /** +0x56c 角度夹持参考 `f56c`。 */
  f56c: number;
  /** +0x578 速度上限 `vc`。 */
  speed_cap: number;
  /** +0x590 初始角快照 `A0`。 */
  angle_init: number;
  /** +0x594 初始速快照 `V0`。 */
  speed_init: number;
  /** +0x598 正弦幅度 `F98`。 */
  f598: number;
  /** +0x59c 上一帧角/瞄准参考 `PA`。 */
  prev_angle: number;
  /** +0x5a0 速度快照 2 `V1`。 */
  spd_init2: number;
  /** +0x5a4 加速度 `X`。 */
  xacc: number;
  /** +0x5a8 加速度上限 `XC`。 */
  xacc_cap: number;
  /** +0x5c4 浮点参数（默认 1.0）。 */
  pf1: number;
  /** +0x5c8 浮点参数 2（默认 0.0）。 */
  pf2: number;

  /** +0x538 `kEnemyBullet`。 */
  bullet_kind: number;
  /** +0x530 旋转标志。 */
  rotate_flg: number;
  /** +0x588 `bulletLife` `N`（≠0 才做角积分）。 */
  bullet_life: number;
  /** +0x58c `bulletLoop` `LP`。 */
  bullet_loop: number;
  /** +0x5ac 延迟帧数（>0 本帧不动）。 */
  delay: number;
  /** +0x5b0 消失延迟。 */
  vanish_delay: number;
  /** +0x5bc 通用参数 1 `P1`。 */
  p1: number;
  /** +0x5c0 通用参数 2 `P2`。 */
  p2: number;
  /** +0x5b4 运动函数编号 `bulletFuncNo`。 */
  bullet_func_no: number;
  /** +0x54c 命中半径。 */
  hit_dis: number;
  /** +0x548 碰撞判定开关。 */
  hit_hantei: boolean;
}

/**
 * 构造一份默认运动状态 —— 逐字段对齐 C++ 结构体的默认成员初始化。
 *
 * ★ 注意 `xacc` / `xacc_cap` 默认 **0.0**（不是 `-1`），`pf1` 默认 **1.0**、
 * `pf2` 默认 **0.0**、`hit_dis` 默认 **0.0**。`Func0` 的 `!= -1` 判定正是靠这些
 * 默认值决定是否覆写，抄错默认值会让整族子弹走错分支。
 */
export function createBulletMotion(overrides: Partial<BulletMotion> = {}): BulletMotion {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    speed: 0,
    accel: 0,
    t: 0,
    life: 0,
    angle_spd: 0,
    angle_acc: 0,
    f56c: 0,
    speed_cap: 0,
    angle_init: -1,
    speed_init: -1,
    f598: 0,
    prev_angle: 0,
    spd_init2: -1,
    xacc: 0,
    xacc_cap: 0,
    pf1: 1,
    pf2: 0,
    bullet_kind: 0,
    rotate_flg: 0,
    bullet_life: 0,
    bullet_loop: 0,
    delay: 0,
    vanish_delay: 0,
    p1: 0,
    p2: 0,
    bullet_func_no: 0,
    hit_dis: 0,
    hit_hantei: true,
    ...overrides,
  };
}

/** 以 `(angle, speed)` 合成 `vx/vy` —— `BulletMotion::IntegrateVelocity`。 */
export function integrateVelocity(b: BulletMotion): void {
  b.vx = b.speed * cosDeg(b.angle);
  b.vy = b.speed * sinDeg(b.angle);
}

/**
 * 目标查询钩子 —— 替代原版 `GameLayer::getMyShipPos / getEnemyPos /
 * getAngleToMyShip`。坐标是**像素**（屏幕系）。
 */
export interface MotionTargets {
  my_ship_x: number;
  my_ship_y: number;
  has_my_ship: boolean;
  /** Boss / 发射者位置。 */
  enemy_x: number;
  enemy_y: number;
  has_enemy: boolean;
  /** `GameLayer` 状态码；-1 = 未提供（状态机族退化为默认分支）。 */
  global_state: number;
}

/** 默认目标（无自机、无敌机、状态未知）。 */
export function createMotionTargets(overrides: Partial<MotionTargets> = {}): MotionTargets {
  return {
    my_ship_x: 0,
    my_ship_y: 0,
    has_my_ship: false,
    enemy_x: 0,
    enemy_y: 0,
    has_enemy: false,
    global_state: -1,
    ...overrides,
  };
}

// --- 确定性 RNG -------------------------------------------------------------

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/**
 * 确定性 RNG —— 与 `DeterministicRng`（`bullet_motion.cpp`）同构。
 *
 * 输入 `(seed, tick, pattern_index, spawn_index)`；`NextU32` 每次调用把自增的
 * `counter` 也混进材料，因此同一颗子弹的多次 `RandomInt` 消耗同一个序列。
 */
export class DeterministicRng {
  private readonly seedLo: number;
  private readonly seedHi: number;
  private readonly tick: number;
  private readonly patternIndex: number;
  private readonly spawnIndex: number;
  private counter = 0;

  /**
   * @param seed  完整 64 位种子。服务端按 uint64 逐字节混入材料，因此这里要拿到
   *              低/高 32 位两段；既接受 `BossRaceSeed`，也接受 `{ lo, hi }` 或
   *              一个 ≤ 2^53 的 `number`（测试用）。
   * @param tick  当前 tick
   * @param patternIndex 模式下标
   * @param spawnIndex   本 tick 内该玩家第几颗子弹
   */
  constructor(
    seed: BossRaceSeed | { lo: number; hi: number } | number,
    tick: number,
    patternIndex: number,
    spawnIndex: number,
  ) {
    if (typeof seed === 'number') {
      this.seedLo = seed >>> 0;
      this.seedHi = Math.floor(seed / 4294967296) >>> 0;
    } else if ('low32' in seed) {
      this.seedLo = seed.low32 >>> 0;
      this.seedHi = seed.hi32 >>> 0;
    } else {
      this.seedLo = seed.lo >>> 0;
      this.seedHi = seed.hi >>> 0;
    }
    this.tick = tick;
    this.patternIndex = patternIndex;
    this.spawnIndex = spawnIndex;
  }

  /**
   * 与服务端 `DeterministicRng::NextU32` 逐位一致：
   * 以 FNV-1a 把 `seed(8B) tick(8B) pattern(4B) spawn(4B) counter(4B)` 全部混入，
   * 再做一次 Mix32 雪崩。`mixIn` 对每个 uint64 按小端逐字节喂入。
   */
  nextU32(): number {
    let h = FNV_OFFSET;
    const mixIn = (lo: number, hi: number): void => {
      for (let i = 0; i < 4; i += 1) {
        h = Math.imul(h ^ ((lo >>> (i * 8)) & 0xff), FNV_PRIME) >>> 0;
      }
      for (let i = 0; i < 4; i += 1) {
        h = Math.imul(h ^ ((hi >>> (i * 8)) & 0xff), FNV_PRIME) >>> 0;
      }
    };
    mixIn(this.seedLo, this.seedHi);
    mixIn(this.tick >>> 0, Math.floor(this.tick / 4294967296) >>> 0);
    mixIn(this.patternIndex >>> 0, 0);
    mixIn(this.spawnIndex >>> 0, 0);
    mixIn(this.counter++ >>> 0, 0);
    h = (h ^ (h >>> 16)) >>> 0;
    h = Math.imul(h, 0x7feb352d) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0;
    h = Math.imul(h, 0x846ca68b) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h >>> 0;
  }

  /** `[a, b]` 内整数（`a > b` 自动交换），语义同 `MyMathUtil::random`。 */
  randomInt(a: number, b: number): number {
    let lo = Math.trunc(a);
    let hi = Math.trunc(b);
    if (hi < lo) {
      const swap = lo;
      lo = hi;
      hi = swap;
    }
    const span = hi - lo + 1;
    return lo + (this.nextU32() % span);
  }
}

// --- 目标查询（与服务端同名同语义） -----------------------------------------

/** `AngleToMyShip`：无自机时返回当前角（原样）。 */
function angleToMyShip(b: BulletMotion, tg: MotionTargets): number {
  if (!tg.has_my_ship) {
    return b.angle;
  }
  return angleToPoint(b.x, b.y, tg.my_ship_x, tg.my_ship_y);
}

/** `AngleToEnemy`：无敌机时返回当前角（原样）。 */
function angleToEnemy(b: BulletMotion, tg: MotionTargets): number {
  if (!tg.has_enemy) {
    return b.angle;
  }
  return angleToPoint(b.x, b.y, tg.enemy_x, tg.enemy_y);
}

/** `DistSqToMyShip`：无自机时返回 `1.0e18`。 */
function distSqToMyShip(b: BulletMotion, tg: MotionTargets): number {
  if (!tg.has_my_ship) {
    return 1.0e18;
  }
  const dx = b.x - tg.my_ship_x;
  const dy = b.y - tg.my_ship_y;
  return dx * dx + dy * dy;
}

/** `DistSqToEnemy`：无敌机时返回 `1.0e18`。 */
function distSqToEnemy(b: BulletMotion, tg: MotionTargets): number {
  if (!tg.has_enemy) {
    return 1.0e18;
  }
  const dx = b.x - tg.enemy_x;
  const dy = b.y - tg.enemy_y;
  return dx * dx + dy * dy;
}

// --- 原版 .rodata 常量 ------------------------------------------------------

const kHalfW = HALF_W_PX; // 320
const kHalfH = HALF_H_PX; // 480
const kTop = TOP_MARGIN_PX; // 40
const kDeg180 = 180;
const kDeg360 = 360;
const kNeg1 = -1;

// ===========================================================================
// A 初始化 / 直线
// ===========================================================================

/** `bulletFunc0` @0x50cdcc —— 基础初始化 + 直线。[实测] */
function func0(b: BulletMotion): void {
  if (b.angle_init !== kNeg1) {
    b.angle = b.angle_init;
  }
  if (b.speed_init !== kNeg1) {
    b.angle_spd = b.speed_init;
    b.angle_acc = b.f598;
    b.f56c = b.prev_angle;
  }
  if (b.spd_init2 !== kNeg1) {
    b.speed = b.spd_init2;
  }
  if (b.xacc !== kNeg1) {
    b.accel = b.xacc;
  }
  if (b.xacc_cap !== kNeg1) {
    b.speed_cap = b.xacc_cap;
  }
}

/** `bulletFunc4` @0x50d238 —— `v = V1`（速度重置）。[实测] */
function func4(b: BulletMotion): void {
  b.speed = b.spd_init2;
}

/** `bulletFunc29` @0x511384 —— 分段重置 + 合成 vx/vy。[实测] */
function func29(b: BulletMotion): void {
  const t = Math.trunc(b.t);
  if (t < b.life) {
    b.vx = b.prev_angle * cosDeg(b.angle);
    b.vy = b.prev_angle * sinDeg(b.angle);
  }
  if (t === b.life) {
    b.angle = b.angle_init;
    b.vx = 0;
  }
  if (t >= b.life) {
    b.angle = b.angle_init;
    b.speed = b.spd_init2;
    b.angle_acc = b.f598;
    b.speed_cap = b.xacc_cap;
  }
}

/** `bulletFunc47` @0x5114a8 —— 每帧重算 vx/vy（直线）。[实测] */
function func47(b: BulletMotion): void {
  if (Math.trunc(b.t) === 0) {
    b.vx = 0;
  }
}

// ===========================================================================
// B 加速 / 减速
// ===========================================================================

/** `bulletFunc5` @0x50d250 —— `v += X`，夹到 `XC`。[实测] */
function func5(b: BulletMotion): void {
  const a = b.xacc;
  if (a === 0) {
    return;
  }
  if (a > 0) {
    if (b.speed < b.xacc_cap) {
      b.speed += a;
      if (b.speed > b.xacc_cap) {
        b.speed = b.xacc_cap;
      }
    }
  } else {
    if (b.speed > b.xacc_cap) {
      b.speed += a;
      if (b.speed < b.xacc_cap) {
        b.speed = b.xacc_cap;
      }
    }
  }
}

/** `bulletFunc35` @0x50ec24 —— 接近自机 → 指数减速 + 朝自机。[实测/推断阈值] */
function func35(b: BulletMotion, tg: MotionTargets): void {
  if (b.p2 !== 1) {
    if (distSqToMyShip(b, tg) <= b.life) {
      b.p2 = 1;
    }
  }
  if (b.p2 === 1) {
    b.speed_cap = 0;
    b.accel = b.speed * -0.1;
  }
  if (Math.trunc(b.t) === b.p1) {
    if (b.angle_init > 1) {
      b.angle = angleToMyShip(b, tg);
    }
    b.speed = b.spd_init2;
    b.speed_cap = b.xacc_cap;
  }
}

/** `bulletFunc39` @0x50ef00 —— 状态机：线性减速 `va = -v/L`。[实测] */
function func39(b: BulletMotion): void {
  if (b.p2 === 0) {
    return;
  }
  if (b.p2 === 1) {
    b.speed_cap = 0;
    b.accel = -(b.speed / b.life);
    b.angle = b.angle_init;
  }
}

/** `bulletFunc43` @0x50f500 —— `v = V1 + X·sin(XC·T)`；`hitDis = pf2·v`。[实测] */
function func43(b: BulletMotion): void {
  if (b.p2 >= b.life) {
    const s = b.spd_init2 + b.xacc * sinDeg(b.xacc_cap * b.t);
    b.speed = s;
    b.hit_dis = b.pf2 * s;
  }
}

// ===========================================================================
// C 正弦调速 / 正弦角
// ===========================================================================

/** `bulletFunc25` @0x50e194 —— `v = V1 + XC·sin(A0 + X·T)`。[实测] */
function func25(b: BulletMotion): void {
  const arg = b.angle_init + b.xacc * b.t;
  b.speed = b.spd_init2 + b.xacc_cap * sinDeg(arg);
}

/** `bulletFunc40` @0x50f08c —— `aa = A0 + F98·sin(V1 + PA·T)`。[实测] */
function func40(b: BulletMotion): void {
  if (Math.trunc(b.t) < b.life) {
    const arg = b.spd_init2 + b.prev_angle * b.t;
    b.angle_acc = b.angle_init + b.f598 * sinDeg(arg);
  }
}

/** `bulletFunc73` @0x510bbc —— `pf1 = A0 + F98·sin(V1 + PA·P2)`；`hitDis = pf2·pf1`。[实测] */
function func73(b: BulletMotion): void {
  const arg = b.spd_init2 + b.prev_angle * b.p2;
  b.pf1 = b.angle_init + b.f598 * sinDeg(arg);
  b.hit_dis = b.pf2 * b.pf1;
}

/** `bulletFunc81` @0x511d48 —— `pf1 = A0 + F98·sin(PA·P2)`；`v = V1 + XC·s`。[实测] */
function func81(b: BulletMotion): void {
  const s = sinDeg(b.prev_angle * b.p2);
  b.pf1 = b.angle_init + b.f598 * s;
  b.speed = b.spd_init2 + b.xacc_cap * s;
  b.hit_dis = b.pf2 * b.pf1;
}

// ===========================================================================
// D 追踪 / 限速转向
// ===========================================================================

/**
 * 限速转向共用逻辑：朝 `target` 转，单帧增量受 `max_step` 限制。
 *
 * ★ 注意读的是 `b.angle_init`（而非 `b.angle`）作为「当前角」，并把结果写回
 * `angle_init` —— 这是服务端移植的既有行为，客户端必须一致。
 */
function rateLimitedTurn(b: BulletMotion, target: number, maxStep: number): void {
  let d = target - b.angle_init;
  while (d > 180) {
    d -= 360;
  }
  while (d < -180) {
    d += 360;
  }
  if (d > maxStep) {
    b.angle = b.angle_init + maxStep;
  } else if (d < -maxStep) {
    b.angle = b.angle_init - maxStep;
  } else {
    b.angle = target;
  }
  b.angle_init = b.angle;
}

/** `bulletFunc2` @0x50d16c —— 朝自机限速转向，单帧增量 ≤ `aa`。[实测/推断条件] */
function func2(b: BulletMotion, tg: MotionTargets): void {
  if (b.life < 1) {
    return;
  }
  rateLimitedTurn(b, angleToMyShip(b, tg), b.angle_acc);
}

/** `bulletFunc17` @0x50db94 —— 限速追踪（单帧 ≤ `A0`）。[实测] */
function func17(b: BulletMotion, tg: MotionTargets): void {
  const target = angleToMyShip(b, tg);
  if (Math.trunc(b.t) === b.life) {
    b.prev_angle = target;
    return;
  }
  if (Math.trunc(b.t) > b.life) {
    let t = target;
    const d = t - b.prev_angle;
    if (d > b.angle_init) {
      t = b.prev_angle + b.angle_init;
    }
    if (d < -b.angle_init) {
      t = b.prev_angle - b.angle_init;
    }
    b.angle = t;
    b.prev_angle = b.angle;
  }
}

/** `bulletFunc18` @0x50dc4c —— 同 17，`P2` 作目标选择标记。[推断] */
function func18(b: BulletMotion, tg: MotionTargets): void {
  const target = b.p2 === 2 ? angleToEnemy(b, tg) : angleToMyShip(b, tg);
  if (Math.trunc(b.t) < b.life) {
    return;
  }
  rateLimitedTurn(b, target, b.angle_init > 0 ? b.angle_init : b.angle_acc);
}

/** `bulletFunc48` @0x50f6c4 —— `T==L` 时瞄准。[实测] */
function func48(b: BulletMotion, tg: MotionTargets): void {
  if (Math.trunc(b.t) < b.life) {
    return;
  }
  if (Math.trunc(b.t) === b.life) {
    if (b.p2 === 1) {
      b.angle = b.angle_init;
    } else {
      b.angle = angleToMyShip(b, tg);
    }
    b.speed_cap = b.xacc_cap;
  }
}

// ===========================================================================
// E 周期瞄准 / 出屏转向
// ===========================================================================

/** `bulletFunc11` @0x50d6e4 —— 出屏后重新瞄准。[实测] */
function func11(b: BulletMotion, tg: MotionTargets): void {
  if (b.x > kHalfW || b.x < 0 || b.y > kHalfH) {
    if (b.p1 === 2) {
      b.angle = angleToEnemy(b, tg);
    } else if (b.p1 === 1) {
      b.angle = angleToMyShip(b, tg);
    }
  }
}

/** `bulletFunc12` @0x50d7a8 —— 出屏（含 `y<40`）后重新瞄准。[实测] */
function func12(b: BulletMotion, tg: MotionTargets): void {
  if (b.x > kHalfW || b.x < 0 || b.y > kHalfH || b.y < kTop) {
    if (b.p1 === 2) {
      b.angle = angleToEnemy(b, tg);
    } else if (b.p1 === 1) {
      b.angle = angleToMyShip(b, tg);
    }
  }
}

/** `bulletFunc13` @0x50d860 —— 每帧朝自机瞄准；`P1 ← 0x168`。[推断] */
function func13(b: BulletMotion, tg: MotionTargets): void {
  b.angle = angleToMyShip(b, tg);
  b.p1 = 0x168;
}

/** `bulletFunc14` @0x50d950 —— `pf1` 随 `life` 线性变化；`hitDis = pf2·pf1`。[实测] */
function func14(b: BulletMotion): void {
  const kK = 0.1;
  if (Math.trunc(b.t) >= 1 && b.p2 !== 0) {
    const d = (b.life * kK) / b.p1;
    b.pf1 = (b.pf1 + d) * kK;
  }
  if (b.p2 !== 0) {
    if (b.life < b.p2) {
      const n = b.pf1 * kK;
      if (n < b.pf1) {
        b.pf1 = n;
      }
    }
    if (b.life > b.p2) {
      const n = b.pf1 * kK;
      if (n > b.pf1) {
        b.pf1 = n;
      }
    }
  }
  b.hit_dis = b.pf2 * b.pf1;
}

/** `bulletFunc70` @0x51079c —— 出屏 → 瞄准 + 随机角 + 换皮。[实测/推断] */
function func70(b: BulletMotion, tg: MotionTargets, rng: DeterministicRng): void {
  if (b.x > kHalfW || b.y < 0 || b.y > kHalfH) {
    const d = kDeg180 - b.angle;
    b.angle = d + rng.randomInt(0, b.p2);
    if (b.p1 <= 4) {
      b.angle = angleToMyShip(b, tg);
    }
    b.speed = b.spd_init2;
    b.speed_cap = b.xacc_cap;
  }
}

/** `bulletFunc76` @0x510d30 —— `y>480` → 瞄准 + 换皮。[实测] */
function func76(b: BulletMotion, rng: DeterministicRng): void {
  if (b.y > kHalfH) {
    b.angle = kDeg360 - b.angle;
    b.angle += rng.randomInt(0, b.p2);
    b.speed = b.spd_init2;
    b.speed_cap = b.xacc_cap;
  }
}

// ===========================================================================
// F 边界反弹 / 镜像
// ===========================================================================

/** `bulletFunc1` @0x50ce78 —— 三段边界反弹。[实测] */
function func1(b: BulletMotion): void {
  let bounce = false;
  if (b.x > kHalfW || b.x < 0 || b.y > kHalfH) {
    bounce = true;
  }
  if (bounce) {
    b.angle = kDeg180 - b.angle;
    if (b.angle < 0) {
      b.angle += kDeg360;
    }
  }
  b.speed = b.spd_init2;
  b.speed_cap = b.xacc_cap;
}

/** `bulletFunc7` @0x50d3b8 —— 同 1，`P1>=1` 叠加随机角。[实测] */
function func7(b: BulletMotion, rng: DeterministicRng): void {
  let bounce = false;
  if (b.x > kHalfW || b.x < 0 || b.y > kHalfH || b.y < kTop) {
    bounce = true;
  }
  if (bounce) {
    b.angle = kDeg180 - b.angle;
    if (b.angle < 0) {
      b.angle += kDeg360;
    }
    if (b.p1 >= 1) {
      b.angle += rng.randomInt(0, 360);
    }
  }
}

/** `bulletFunc20` @0x50dde0 —— 边界分段（80/240/340/320 带）。[推断] */
function func20(b: BulletMotion): void {
  if (b.y < kTop) {
    b.life = 1;
    b.angle = kDeg180 - b.angle;
    if (b.angle < 0) {
      b.angle += kDeg360;
    }
  } else if (b.y > kHalfH) {
    b.life = 2;
    b.angle = kDeg180 - b.angle;
    if (b.angle < 0) {
      b.angle += kDeg360;
    }
  } else if (b.x > kHalfW) {
    b.life = 3;
    b.angle += 90;
  } else if (b.x < 0) {
    b.life = 4;
    b.angle -= 90;
  }
}

/** `bulletFunc32` @0x50ea08 —— 按 `P1` 奇偶镜像角。[实测] */
function func32(b: BulletMotion): void {
  if (Math.trunc(b.t) !== 0) {
    return;
  }
  const a0 = b.angle_init;
  b.speed = b.spd_init2;
  b.speed_cap = b.xacc_cap;
  if ((b.p1 & 1) !== 0) {
    b.angle = kDeg360 - (a0 - b.p2) + 90;
  } else {
    b.angle = a0 - b.p2;
  }
}

/** `bulletFunc38` @0x50edcc —— 条件单次反弹；`a = A0 + a`。[推断] */
function func38(b: BulletMotion): void {
  let bounce = false;
  if (b.y > kHalfH || b.y < kTop || b.x > kHalfW || b.x < 0) {
    bounce = true;
  }
  if (bounce) {
    b.angle = kDeg180 - b.angle;
    if (b.angle < 0) {
      b.angle += kDeg360;
    }
  }
  b.angle = b.angle_init + b.angle;
}

/** `bulletFunc57` @0x50fd84 —— 在 `A0±PA` 之间三角波。[实测] */
function func57(b: BulletMotion, tg: MotionTargets): void {
  if (tg.global_state === 0x17) {
    b.angle += b.f598;
    if (b.angle > b.angle_init + b.prev_angle) {
      b.angle = b.angle_init + b.prev_angle;
    }
  } else {
    b.angle -= b.f598;
    if (b.angle < b.angle_init - b.prev_angle) {
      b.angle = b.angle_init - b.prev_angle;
    }
  }
}

/** `bulletFunc58` @0x50fe00 —— 折返角。[实测] */
function func58(b: BulletMotion): void {
  if (Math.trunc(b.t) !== 0) {
    return;
  }
  if ((b.p1 & 1) !== 0) {
    b.angle += b.f598;
  } else {
    b.angle -= b.f598;
    b.angle_acc = b.angle_acc - b.f598;
  }
  b.angle = kDeg360 - b.angle + 90;
}

/** `bulletFunc62` @0x510088 —— 边界反弹 + 随机角。[推断] */
function func62(b: BulletMotion, rng: DeterministicRng): void {
  if (b.x > kHalfW || b.x < 0 || b.y > kHalfH || b.y < kTop) {
    b.angle = kDeg180 - b.angle;
    if (b.angle < 0) {
      b.angle += kDeg360;
    }
    b.angle += rng.randomInt(-0x50, 0x50);
  }
}

/** `bulletFunc67` @0x510544 —— 边界反弹（320/480/40）+ 换皮。[推断：忽略特效] */
function func67(b: BulletMotion): void {
  if (b.x > kHalfW || b.y > kHalfH || b.y < kTop) {
    b.angle = kDeg180 - b.angle;
    if (b.angle < 0) {
      b.angle += kDeg360;
    }
  }
  b.speed_cap = b.xacc_cap;
}

/** `bulletFunc77` @0x510dcc —— 状态 `0x21/0x22` → 镜像角。[实测] */
function func77(b: BulletMotion, tg: MotionTargets): void {
  if (tg.global_state === 0x21 || tg.global_state === 0x22) {
    b.angle = kDeg180 - b.angle;
    if (b.angle < 0) {
      b.angle += kDeg360;
    }
  }
}

/** `bulletFunc78` @0x510e88 —— `y<40` → 镜像角。[实测] */
function func78(b: BulletMotion): void {
  if (b.y < kTop) {
    b.angle = kDeg180 - b.angle;
    if (b.angle < 0) {
      b.angle += kDeg360;
    }
  }
}

// ===========================================================================
// G 接近触发
// ===========================================================================

/** `bulletFunc15` @0x50da6c —— 接近自机 → 加速。[实测/推断阈值] */
function func15(b: BulletMotion, tg: MotionTargets): void {
  if (b.p2 !== 0) {
    return;
  }
  if (distSqToMyShip(b, tg) <= b.life) {
    b.p2 = 1;
    b.speed = b.spd_init2;
    b.speed_cap = b.xacc_cap;
  }
}

/** `bulletFunc16` @0x50daf8 —— 接近敌机 → 触发。[实测/推断阈值] */
function func16(b: BulletMotion, tg: MotionTargets): void {
  if (b.p2 !== 0) {
    return;
  }
  if (Math.trunc(b.t) <= b.bullet_life) {
    return;
  }
  if (distSqToEnemy(b, tg) < b.life) {
    b.p2 = 1;
  }
}

/** `bulletFunc24` @0x50e100 —— 接近自机 → 重置角/上限。[推断阈值] */
function func24(b: BulletMotion, tg: MotionTargets): void {
  if (distSqToMyShip(b, tg) < b.xacc && b.p2 === 0) {
    b.angle = b.angle_init;
    b.p2 = 1;
    b.speed_cap = b.xacc_cap;
  }
}

/** `bulletFunc34` @0x50eaa4 —— 全局状态 `==7` → 悬停。[实测] */
function func34(b: BulletMotion, tg: MotionTargets): void {
  if (tg.global_state === 7) {
    b.p2 = 1;
    b.speed = 0;
    b.hit_dis = 4;
  }
  if (b.p2 === 1) {
    if (b.p1 < b.life) {
      b.speed = 0;
    }
    if (b.p1 === b.life) {
      b.angle = b.angle_init;
    }
  }
}

/** `bulletFunc41` @0x50f0f8 —— 接近自机 → 变身/发射。[实测] */
function func41(b: BulletMotion, tg: MotionTargets): void {
  if (b.p2 !== 0) {
    return;
  }
  if (distSqToMyShip(b, tg) > b.life) {
    return;
  }
  if (b.p1 > 6) {
    return;
  }
  b.p2 = 1;
  b.angle = angleToMyShip(b, tg);
  b.speed = b.spd_init2;
  b.speed_cap = b.xacc_cap;
  b.hit_dis = 7;
  b.pf2 = 3;
  b.rotate_flg = 0;
}

/** `bulletFunc42` @0x50f3a0 —— 接近敌机 → 变身。[实测] */
function func42(b: BulletMotion, tg: MotionTargets): void {
  if (b.p2 !== 0) {
    return;
  }
  if (distSqToEnemy(b, tg) >= b.life) {
    return;
  }
  b.p2 = 1;
  if (b.p1 === 1) {
    b.hit_dis = 2;
    b.rotate_flg = 2;
  }
  b.angle = b.angle_init;
  b.speed_cap = b.xacc_cap;
}

/** `bulletFunc44` @0x50f580 —— `L==1` 且 `dist≤P1` → 重置。[实测] */
function func44(b: BulletMotion, tg: MotionTargets): void {
  if (b.p2 === 0 && b.life === 1 && distSqToMyShip(b, tg) <= b.p1) {
    b.angle = b.angle_init;
    b.speed_cap = b.xacc_cap;
    b.p2 = 1;
  }
}

/** `bulletFunc45` @0x50f600 —— 触发重置。[推断：调用语义未知] */
function func45(b: BulletMotion): void {
  if (b.p2 === 0) {
    b.speed = b.spd_init2;
    b.p2 = 1;
  }
}

/** `bulletFunc53` @0x50fa34 —— 两阶段接近触发。[推断：常量存疑] */
function func53(b: BulletMotion, tg: MotionTargets): void {
  if (b.p1 === 0 && distSqToMyShip(b, tg) <= b.life) {
    b.p1 = 1;
  }
  if (b.p1 === 1 && b.p2 === b.life) {
    b.angle = b.angle_init;
    b.speed_cap = b.xacc_cap;
  }
}

/** `bulletFunc60` @0x50fea8 —— 接近敌机 → 反向角加速。[实测] */
function func60(b: BulletMotion, tg: MotionTargets): void {
  if (b.p2 === 0 && Math.trunc(b.t) > b.bullet_life && distSqToEnemy(b, tg) <= b.life) {
    b.angle = b.angle_init;
    b.angle_acc = -b.f598;
    b.f56c = -b.prev_angle;
    b.p2 = 1;
  }
}

/** `bulletFunc74` @0x510c3c —— `LP` 状态机。[推断] */
function func74(b: BulletMotion, tg: MotionTargets): void {
  if (Math.trunc(b.t) === 0xb) {
    b.bullet_loop = 1;
  }
  if (distSqToMyShip(b, tg) <= b.life) {
    b.bullet_loop = 1;
  }
}

/** `bulletFunc80` @0x510f28 —— `x` 落在 `[XC-V1, XC+V1]` → `P2=1`。[推断] */
function func80(b: BulletMotion): void {
  if (b.p2 !== 0 || Math.trunc(b.t) !== 0 || b.life > 3) {
    return;
  }
  const lo = b.xacc_cap - b.spd_init2;
  const hi = b.xacc_cap + b.spd_init2;
  if (b.x > lo && b.x < hi) {
    b.p2 = 1;
  }
}

/** `bulletFunc84` @0x510ff4 —— 换皮 / 触发。[实测] */
function func84(b: BulletMotion, tg: MotionTargets): void {
  if (b.p2 === 1) {
    let t = b.p1;
    if (t > 255) {
      t = 255;
    }
    if (t >= BULLET_KIND_MIN && t <= BULLET_KIND_MAX) {
      b.bullet_kind = t;
    }
    if (distSqToMyShip(b, tg) <= b.spd_init2) {
      b.p2 = 1;
    }
  }
}

/** `bulletFunc85` @0x5110a4 —— 接近自机 → 换 `hitDis`。[实测] */
function func85(b: BulletMotion, tg: MotionTargets): void {
  if (distSqToMyShip(b, tg) < b.life) {
    if (b.bullet_kind === 0x25) {
      b.hit_dis = 20;
    } else if (b.bullet_kind === 0x2a) {
      b.hit_dis = 4;
    }
  }
}

// ===========================================================================
// H 分裂 / 召唤（Boss）—— 子子弹生成交宿主，这里只做状态标记
// ===========================================================================

/** `bulletFunc31` @0x50e498 —— Boss 分裂/召唤。[推断：子子弹生成交宿主] */
function func31(b: BulletMotion): void {
  if (Math.trunc(b.t) === b.p1 && b.life <= 0x1e) {
    b.rotate_flg = 2;
    b.p2 = 1; // 标记「本帧请求分裂」
  }
}

/** `bulletFunc50` @0x50f800 —— Boss 蓄力/阶段。[推断：忽略音效/特效] */
function func50(b: BulletMotion): void {
  if (b.life === 0 && (b.x > 280 || b.y < kTop || b.y > 440 || b.x < 80)) {
    b.life = 1;
    b.speed = 0;
    b.speed_cap = 0;
  } else if (b.life === 1) {
    b.p1 += 1;
  } else if (b.life === 2 && b.p2 === 0x1e) {
    b.angle = b.angle_init;
    b.speed_cap = b.xacc_cap;
  }
}

/** `bulletFunc55` @0x50fca0 —— 接近敌机 → 蓄力特效。[推断：事件仅] */
function func55(b: BulletMotion, tg: MotionTargets): void {
  if (distSqToEnemy(b, tg) <= b.life) {
    b.p2 = 1; // 请求蓄力特效（宿主处理）
  }
}

/** `bulletFunc83` @0x511fcc —— Boss 摆线。[推断：常量 160/260/30/90/40] */
function func83(b: BulletMotion): void {
  const n = Math.min(60, b.t);
  b.angle = 160 + 260 * sinDeg(30 * n + 90) + 40;
}

// ===========================================================================
// I 换皮 / 半径
// ===========================================================================

/** `bulletFunc30` @0x50e224 —— 按 `bulletType` 换贴图 + `hitDis`。[实测] */
function func30(b: BulletMotion): void {
  if (Math.trunc(b.t) !== b.p2) {
    return;
  }
  b.hit_dis = 4;
}

/** `bulletFunc54` @0x50faf4 —— 按 `life` 阶段换皮。[实测：贴图交宿主] */
function func54(b: BulletMotion): void {
  if (Math.trunc(b.t) !== 0) {
    return;
  }
  b.speed = b.spd_init2;
  b.speed_cap = b.xacc_cap;
}

/** `bulletFunc65` @0x510498 —— 按 `life`/`P2` 换皮。[实测：贴图交宿主] */
function func65(b: BulletMotion): void {
  if (Math.trunc(b.t) !== 0) {
    return;
  }
  b.speed = b.spd_init2;
  b.speed_cap = b.xacc_cap;
}

// ===========================================================================
// J 参数方程 / 摆线
// ===========================================================================

/** `bulletFunc26` @0x511524 —— `a += XC·sin(XC + X·L)`。[推断] */
function func26(b: BulletMotion): void {
  b.angle = b.angle + b.xacc_cap * sinDeg(b.xacc_cap + b.xacc * b.life);
}

/** `bulletFunc33` @0x51160c —— 双正弦参数轨迹。[推断] */
function func33(b: BulletMotion): void {
  const a = b.angle + b.f598 * b.t;
  const px = b.speed * b.t * cosDeg(a);
  const py = b.speed * b.t * sinDeg(a);
  b.xacc = px;
  b.xacc_cap = py;
  b.angle = angleToPoint(0, 0, px, py);
}

/** `bulletFunc66` @0x511ab4 —— 参数方程。[推断] */
function func66(b: BulletMotion): void {
  const c = cosDeg(b.angle_init * b.p2 + b.f598);
  const s = sinDeg(b.xacc * b.p2 + b.speed_cap);
  b.angle = kDeg360 - (c + s) + 90;
}

/** `bulletFunc75` @0x511c08 —— 双正弦参数轨迹。[推断] */
function func75(b: BulletMotion): void {
  const c = cosDeg(b.angle_init + b.f598 * b.p2);
  const s = sinDeg(b.spd_init2 + b.xacc * b.p2);
  b.angle = kDeg360 - (c + s) + 90;
}

/** `bulletFunc82` @0x511e48 —— 敌机/自机参数方程。[推断] */
function func82(b: BulletMotion, tg: MotionTargets): void {
  const base = b.p1 === 0 ? angleToMyShip(b, tg) : angleToEnemy(b, tg);
  b.angle = base + b.f598 * sinDeg(b.spd_init2 + b.xacc * b.t);
}

// ===========================================================================
// K 状态机（全局状态）
// ===========================================================================

/** `bulletFunc19` @0x50dd24 —— 全局条件成立 → `v *= 0.6`。[推断：魔数 0x66666667] */
function func19(b: BulletMotion, tg: MotionTargets): void {
  if (b.p2 === 0 && tg.global_state >= 0) {
    b.speed *= 0.6;
    b.p2 = 1;
  }
}

/** `bulletFunc21` @0x50dfb8 —— 状态 `==3` → `v = L·0.03`。[实测] */
function func21(b: BulletMotion, tg: MotionTargets): void {
  if (tg.global_state === 3) {
    b.speed = b.life * 0.03;
  } else {
    b.speed = b.spd_init2;
  }
}

/** `bulletFunc22` @0x50e018 —— 状态 `==4` → `v = L·0.1`。[实测] */
function func22(b: BulletMotion, tg: MotionTargets): void {
  if (tg.global_state === 4) {
    b.speed = b.life * 0.1;
  } else {
    b.speed = b.spd_init2;
  }
}

/** `bulletFunc23` @0x50e078 —— 状态 `==5` → `v = L·0.1`（+换皮）。[实测] */
function func23(b: BulletMotion, tg: MotionTargets): void {
  if (tg.global_state === 5) {
    b.speed = b.life * 0.1;
  } else {
    b.speed = b.spd_init2;
  }
}

/** `bulletFunc51` @0x511874 —— 状态 `==0x15` 位移。[推断] */
function func51(b: BulletMotion, tg: MotionTargets): void {
  if (tg.global_state !== 0x15) {
    return;
  }
  const sign = b.p1 === 0 ? 1 : -1;
  b.x += sign * b.speed * cosDeg(b.angle);
  b.y += sign * b.speed * sinDeg(b.angle);
}

/** `bulletFunc71` @0x510ac8 —— 状态 `==0x1e` 随机化初角/幅度。[实测] */
function func71(b: BulletMotion, tg: MotionTargets, rng: DeterministicRng): void {
  if (tg.global_state !== 0x1e || Math.trunc(b.t) !== 0) {
    return;
  }
  b.angle_init = rng.randomInt(0, b.p1);
  b.f598 = rng.randomInt(0, b.p1) + rng.randomInt(0, b.p1);
}

/** `bulletFunc72` @0x510b78 —— 状态 `==0x1c` → 速度重置。[实测] */
function func72(b: BulletMotion, tg: MotionTargets): void {
  if (tg.global_state === 0x1c) {
    b.speed = b.spd_init2;
    b.speed_cap = b.xacc_cap;
  }
}

// ===========================================================================
// L 辅助（无字段写入）
// ===========================================================================

/** `bulletFunc3/6/8/28/36/79` —— 边界/着色/取值辅助，无运动字段写入。[实测] */
function funcNoop(): void {
  // 空实现：与原版「无字段写入」等价。
}

/** `bulletFunc27` @0x50cd54 —— `P1==1` → `hitHantei=0`；否则时间缩放。[推断] */
function func27(b: BulletMotion): void {
  if (b.p1 === 1) {
    b.hit_hantei = false;
  }
}

/** `bulletFunc46` @0x50f654 —— 每 N 帧把角 ±90。[实测] */
function func46(b: BulletMotion): void {
  if (Math.trunc(b.t) === 0) {
    return;
  }
  if (Math.trunc(b.t) === b.bullet_life) {
    b.angle += b.life === 0 ? 90 : -90;
    b.bullet_life = Math.trunc(b.t);
  }
}

/** `bulletFunc52` @0x50f9e4 —— 随机角。[实测] */
function func52(b: BulletMotion, rng: DeterministicRng): void {
  if (Math.trunc(b.t) !== 0) {
    return;
  }
  b.angle = rng.randomInt(0, b.p2);
}

/** `bulletFunc61` @0x50ff78 —— 四方向（0/90/180/270）。[实测] */
function func61(b: BulletMotion, tg: MotionTargets): void {
  if (Math.trunc(b.t) !== 0) {
    return;
  }
  const dx = tg.has_my_ship ? b.x - tg.my_ship_x : 0;
  const dy = tg.has_my_ship ? b.y - tg.my_ship_y : 0;
  if (dx < 0 && dy < 0) {
    b.angle = 90;
  } else if (dx < 0 && dy >= 0) {
    b.angle = 180;
  } else if (dx >= 0 && dy >= 0) {
    b.angle = 270;
  } else {
    b.angle = 0;
  }
  b.speed = b.spd_init2;
  b.speed_cap = b.xacc_cap;
}

/** `bulletFunc63` @0x510394 —— `a=A0; aa=-F98`。[实测] */
function func63(b: BulletMotion): void {
  if (Math.trunc(b.t) === 0) {
    b.angle = b.angle_init;
    b.angle_acc = -b.f598;
  }
}

/** `bulletFunc64` @0x5103d0 —— 分阶段。[实测] */
function func64(b: BulletMotion, tg: MotionTargets): void {
  if (b.life === 0) {
    b.angle = b.angle_init;
    b.speed = b.spd_init2;
  } else if (b.life === 1) {
    b.angle = angleToMyShip(b, tg);
    b.speed = b.spd_init2;
    b.speed_cap = b.xacc_cap;
  }
}

/** `bulletFunc37` @0x51172c —— 正弦角 `a = 75·sin(L + X·T − 90) + 180`。[推断] */
function func37(b: BulletMotion): void {
  b.angle = 75 * sinDeg(b.life + b.xacc * b.t - 90) + 180;
}

// --- 分派 -------------------------------------------------------------------

/** `IsKnownBulletFunc`：该编号是否在 79 个已知 `bulletFunc` 集合内。 */
export function isKnownBulletFunc(funcNo: number): boolean {
  return KNOWN_BULLET_FUNCS.has(funcNo);
}

const KNOWN_BULLET_FUNCS: ReadonlySet<number> = new Set([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
  24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43,
  44, 45, 46, 47, 48, 50, 51, 52, 53, 54, 55, 57, 58, 60, 61, 62, 63, 64, 65, 66,
  67, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85,
]);

/**
 * `ApplyBulletFunc` —— 79 个 `bulletFunc` 的逐帧分派（对应 `EnemyBullet::update`
 * 的间接跳转表）。
 *
 * @returns `true` 表示该编号已实现，`false` 表示未实现（调用者应记录）。
 */
export function applyBulletFunc(
  b: BulletMotion,
  targets: MotionTargets,
  rng: DeterministicRng,
): boolean {
  switch (b.bullet_func_no) {
    case 0: func0(b); break;
    case 1: func1(b); break;
    case 2: func2(b, targets); break;
    case 3: funcNoop(); break;
    case 4: func4(b); break;
    case 5: func5(b); break;
    case 6: funcNoop(); break;
    case 7: func7(b, rng); break;
    case 8: funcNoop(); break;
    case 11: func11(b, targets); break;
    case 12: func12(b, targets); break;
    case 13: func13(b, targets); break;
    case 14: func14(b); break;
    case 15: func15(b, targets); break;
    case 16: func16(b, targets); break;
    case 17: func17(b, targets); break;
    case 18: func18(b, targets); break;
    case 19: func19(b, targets); break;
    case 20: func20(b); break;
    case 21: func21(b, targets); break;
    case 22: func22(b, targets); break;
    case 23: func23(b, targets); break;
    case 24: func24(b, targets); break;
    case 25: func25(b); break;
    case 26: func26(b); break;
    case 27: func27(b); break;
    case 28: funcNoop(); break;
    case 29: func29(b); break;
    case 30: func30(b); break;
    case 31: func31(b); break;
    case 32: func32(b); break;
    case 33: func33(b); break;
    case 34: func34(b, targets); break;
    case 35: func35(b, targets); break;
    case 36: funcNoop(); break;
    case 37: func37(b); break;
    case 38: func38(b); break;
    case 39: func39(b); break;
    case 40: func40(b); break;
    case 41: func41(b, targets); break;
    case 42: func42(b, targets); break;
    case 43: func43(b); break;
    case 44: func44(b, targets); break;
    case 45: func45(b); break;
    case 46: func46(b); break;
    case 47: func47(b); break;
    case 48: func48(b, targets); break;
    case 50: func50(b); break;
    case 51: func51(b, targets); break;
    case 52: func52(b, rng); break;
    case 53: func53(b, targets); break;
    case 54: func54(b); break;
    case 55: func55(b, targets); break;
    case 57: func57(b, targets); break;
    case 58: func58(b); break;
    case 60: func60(b, targets); break;
    case 61: func61(b, targets); break;
    case 62: func62(b, rng); break;
    case 63: func63(b); break;
    case 64: func64(b, targets); break;
    case 65: func65(b); break;
    case 66: func66(b); break;
    case 67: func67(b); break;
    case 70: func70(b, targets, rng); break;
    case 71: func71(b, targets, rng); break;
    case 72: func72(b, targets); break;
    case 73: func73(b); break;
    case 74: func74(b, targets); break;
    case 75: func75(b); break;
    case 76: func76(b, rng); break;
    case 77: func77(b, targets); break;
    case 78: func78(b); break;
    case 79: funcNoop(); break;
    case 80: func80(b); break;
    case 81: func81(b); break;
    case 82: func82(b, targets); break;
    case 83: func83(b); break;
    case 84: func84(b, targets); break;
    case 85: func85(b, targets); break;
    default: return false;
  }
  return true;
}

/**
 * 完整单帧更新 —— `UpdateBulletMotion`。
 *
 * 1. `delay` 倒计时（`>0` 则本帧不运动）；
 * 2. 若 `bullet_life != 0`：`angle += angle_acc`，并按 `f56c` 夹持；
 * 3. `bulletFunc` 分派；
 * 4. `IntegrateVelocity()`。
 *
 * ★ **不移动位置、不递增 `life`**：位置积分与 `t += 1` 由宿主完成。
 */
export function updateBulletMotion(
  b: BulletMotion,
  targets: MotionTargets,
  rng: DeterministicRng,
): void {
  if (b.delay > 0) {
    b.delay -= 1;
    return;
  }
  if (b.bullet_life !== 0) {
    b.angle += b.angle_acc;
    if (b.f56c > 0) {
      const lim = b.f56c + b.angle_spd;
      if (b.angle > lim) {
        b.angle = lim;
      }
    }
    if (b.f56c < 0) {
      const lim = b.f56c + b.angle_spd;
      if (b.angle < lim) {
        b.angle = lim;
      }
    }
  }
  applyBulletFunc(b, targets, rng);
  integrateVelocity(b);
}
