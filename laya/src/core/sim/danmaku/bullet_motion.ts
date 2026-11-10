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
 *    `llround` 半值远离零。三角用 `sinDeg/cosDeg`（原版 `MyMathUtil::sin/cos`），
 *    少数单精度路径（`Func3/36`）走 `f32` + `sinDegF/cosDegF`。
 *  - **分工对齐原版（最新版整帧口径）**：`updateBulletMotion` 做
 *    「delay 倒计时 → 角积分 → `bulletFunc` early 分派 → **共用出口 accel 应用** →
 *    `bulletFunc` mid 分派（仅 func29）→ 默认 `IntegrateVelocity`（func3/29/47 跳过）→
 *    `bulletFunc` late 分派（8 个二次分派编号）→ 对 setPosition 族预减位移 →
 *    帧末 `bullet_life--`」。
 *    宿主（BossRaceSimulation）紧接着固定做 `pos += (vx,vy)` 与 `t += 1`；
 *    对 `SkipsPositionIntegration` 的 9 个编号，这里先 `x -= vx; y -= vy`，
 *    使积分后正好回到 func 用 setPosition 钉下的绝对位置。
 *  - ★ 服务端**从不递增 `life`**（只递增 `t`）；`bullet_life` 由 `updateBulletMotion`
 *    在帧末（`>0` 时）自减，决定下一帧是否做角积分夹持。
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
import type { BossRaceSeed } from '../../math/boss_race_seed';
import {
  angleToPoint,
  cosDeg,
  f32,
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
  /** +0x588 `bulletLife` `N`（≠0 才做角积分；帧末 `>0` 时自减）。 */
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
  /** +0x554 贴图半宽（`Func6/8/62` 的环绕边界），C++ 默认 0.0。 */
  half_w: number;
  /** +0x558 贴图半高，C++ 默认 0.0。 */
  half_h: number;
  /** 原版 `Node::setOpacity(uint8)`，C++ 默认 255。 */
  opacity: number;
  /** 原版 `Sprite::setScale(float)`，C++ 默认 1.0。 */
  scale: number;
}

/**
 * 构造一份默认运动状态 —— 逐字段对齐 C++ 结构体的默认成员初始化。
 *
 * ★ 注意 `xacc` / `xacc_cap` 默认 **0.0**（不是 `-1`），`pf1` 默认 **1.0**、
 * `pf2` 默认 **0.0**、`hit_dis` 默认 **0.0**，`half_w/half_h` 默认 **0.0**、
 * `opacity` 默认 **255**、`scale` 默认 **1.0**。抄错默认值会让整族子弹走错分支。
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
    half_w: 0,
    half_h: 0,
    opacity: 255,
    scale: 1,
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

// --- 原版 .rodata 常量 / 共用辅助 -------------------------------------------

const kHalfW = HALF_W_PX; // 320
const kHalfH = HALF_H_PX; // 480
const kTop = TOP_MARGIN_PX; // 40
const kDeg180 = 180;
const kDeg360 = 360;

/** 原版边界反弹的指令序列：`d = C - angle; d<0 时 d += 360`。 */
function mirrorAngle(angle: number, c: number): number {
  let d = c - angle;
  if (d < 0) {
    d += kDeg360;
  }
  return d;
}

// 原版 `MyMathUtil::sin/cos` 走**单精度**：`sinf(deg * π(f) / 180(f))`，
// 两步都是 float 运算；仅 Func3 / Func36 使用。
const PI_F = f32(3.14159265358979323846);
function cosDegF(deg: number): number {
  const arg = f32(f32(f32(deg) * PI_F) / 180);
  return f32(Math.cos(arg));
}
function sinDegF(deg: number): number {
  const arg = f32(f32(f32(deg) * PI_F) / 180);
  return f32(Math.sin(arg));
}

// C++ `constexpr double kDrift = 0x1.0B9AF72015D87p-6`（位模式
// 0x3F90B9AF72015D87）。JS 无 C99 十六进制浮点字面量，用 DataView 按位构造。
const K_DRIFT_VIEW = new DataView(new ArrayBuffer(8));
K_DRIFT_VIEW.setUint32(0, 0x3f90b9af);
K_DRIFT_VIEW.setUint32(4, 0x72015d87);
const K_DRIFT = K_DRIFT_VIEW.getFloat64(0);

// ===========================================================================
// A 初始化 / 直线
// ===========================================================================

/** `bulletFunc0` —— 完全 no-op：funcNo=0 在 update 跳转表里越界，独立符号是 spawn 初始化。 */
function func0(): void {}

/** `bulletFunc4` —— no-op：update 分派入口由 +0x541 标志门控，生产端恒 0。 */
function func4(): void {}

/** `bulletFunc29` @0x511384 —— 分段重置 + 合成 vx/vy（mid 阶段执行）。[实测] */
function func29(b: BulletMotion): void {
  const t = Math.trunc(b.t);
  if (t < b.life) {
    b.vx = b.prev_angle * cosDeg(b.angle);
    b.vy = b.prev_angle * sinDeg(b.angle);
    return;
  }
  const resetAt = b.life + b.p1;
  if (t < resetAt) {
    // 5113f4：只有 t === life+1 才写 A0；这一段 vx/vy 恒为 0。
    if (t === b.life + 1) {
      b.angle = b.angle_init;
    }
    b.vx = 0;
    b.vy = 0;
    return;
  }
  if (t === resetAt) {
    // 51140c：整块复位（angle=A0、{speed,accel}={V1,X}、angleAcc=F98、speedCap=XC）。
    b.angle = b.angle_init;
    b.speed = b.spd_init2;
    b.accel = b.xacc;
    b.angle_acc = b.f598;
    b.speed_cap = b.xacc_cap;
  }
  b.vx = b.speed * cosDeg(b.angle);
  b.vy = b.speed * sinDeg(b.angle);
}

/** `bulletFunc47` @0x50c9f8 —— 节拍门控制是否合成速度。[实测] */
function func47(b: BulletMotion): void {
  const d = Math.trunc(b.t) - b.life;
  const rem = b.p1 !== 0 ? d % b.p1 : d; // ARM sdiv 0 → 0
  if (d < 0 || rem !== 0) {
    b.vx = 0;
    b.vy = 0;
    return;
  }
  b.vx = b.speed * cosDeg(b.angle);
  b.vy = b.speed * sinDeg(b.angle);
}

// ===========================================================================
// B 加速 / 减速
// ===========================================================================

/** `bulletFunc5` —— no-op：update 分派入口由 +0x541 标志门控，生产端恒 0。 */
function func5(): void {}

/** `bulletFunc35` @0x50ec24 —— 接近自机 → 指数减速 + 朝自机。[实测/推断阈值] */
function func35(b: BulletMotion, tg: MotionTargets): void {
  const p2 = b.p2;
  if (p2 === 0) {
    if (distSqToMyShip(b, tg) <= b.life) {
      b.p2 = 1;
    }
    return;
  }
  if (p2 === 1) {
    b.speed_cap = 0;
    b.accel = b.speed * -0.1;
    b.p2 = 2;
    return;
  }
  if (p2 === b.p1) {
    b.speed = b.spd_init2;
    b.accel = b.xacc;
    b.speed_cap = b.xacc_cap;
    if (b.angle_init > 1) {
      b.angle = angleToMyShip(b, tg);
    }
  }
  b.p2 = p2 + 1;
}

/** `bulletFunc39` @0x50ef00 —— p2 状态机。[unicorn 逐指令实测] */
function func39(b: BulletMotion): void {
  let decel = false;
  let reset = false;
  if (b.p2 === 0) {
    let mirror = -1;
    if (b.x > kHalfW || b.x < 0) {
      mirror = kDeg180;
    } else if (b.y > kHalfH) {
      mirror = kDeg360;
    }
    if (mirror >= 0) {
      b.angle = mirrorAngle(b.angle, mirror);
      b.p2 = 1;
      decel = true;
    } else if (b.p2 === b.life) {
      reset = true;
    }
  } else if (b.p2 === 1) {
    decel = true;
  } else if (b.p2 === b.life) {
    reset = true;
  }

  if (decel) {
    b.speed_cap = 0;
    // 原版 fdiv speed/life，life==0 得到 IEEE ±inf；**不要**加 life!=0 保护。
    b.accel = -(b.speed / b.life);
  } else if (reset) {
    b.angle = b.angle_init;
    b.angle_acc = b.f598;
    b.f56c = b.prev_angle;
    b.speed = b.spd_init2;
    b.accel = b.xacc;
    b.speed_cap = b.xacc_cap;
    if (b.p1 === 4) {
      b.bullet_kind = 30;
    } else if (b.p1 === 3) {
      b.bullet_kind = 37;
    } else if (b.p1 === 2) {
      b.bullet_kind = 42;
    }
  }
  if (b.p2 >= 1) {
    b.p2 += 1;
  }
}

/** `bulletFunc43` @0x50f500 —— v = V1 + X·sin(XC·(P2−L))；scale=v；hitDis=f32(pf2·v)。[实测] */
function func43(b: BulletMotion): void {
  if (b.p2 >= b.life) {
    const v = b.spd_init2 + b.xacc * sinDeg(b.xacc_cap * (b.p2 - b.life));
    b.scale = v;
    b.hit_dis = f32(b.pf2 * v);
  }
  b.p2 += 1;
}

// ===========================================================================
// C 正弦调速 / 正弦角
// ===========================================================================

/** `bulletFunc25` @0x50e194 —— v = V1 + XC·sin(A0 + X·T)。[实测] */
function func25(b: BulletMotion): void {
  const arg = b.angle_init + b.xacc * b.t;
  b.speed = b.spd_init2 + b.xacc_cap * sinDeg(arg);
}

/** `bulletFunc40` @0x50f08c —— aa = A0 + F98·sin(V1 + PA·T)。[实测] */
function func40(b: BulletMotion): void {
  if (Math.trunc(b.t) < b.life) {
    const arg = b.spd_init2 + b.prev_angle * b.t;
    b.angle_acc = b.angle_init + b.f598 * sinDeg(arg);
  }
}

/** `bulletFunc73` @0x510bbc —— pf1 = A0 + F98·sin(V1 + PA·P2)；scale=pf1；hitDis=pf2·pf1。[实测] */
function func73(b: BulletMotion): void {
  // 0x510bcc 全程 s 寄存器（float），末尾 p2++。double 中间量会放大 hit_dis 误差。
  const arg = f32(f32(b.spd_init2) + f32(f32(b.prev_angle) * f32(b.p2)));
  const s = sinDegF(arg);
  const pf1 = f32(f32(b.angle_init) + f32(f32(b.f598) * s));
  b.pf1 = pf1;
  b.scale = pf1;
  b.hit_dis = f32(f32(b.pf2) * pf1);
  b.p2 += 1;
}

/** `bulletFunc81` @0x511d48 —— 极坐标**绝对定位** setPosition；不写 angle/speed/hitDis。[实测] */
function func81(b: BulletMotion): void {
  const p2 = b.p2;
  b.pf1 = b.angle_init + b.f598 * sinDeg(b.prev_angle * p2);
  const r = b.xacc_cap * p2;
  b.x = b.spd_init2 + r * cosDeg(b.pf1);
  b.y = b.xacc + r * sinDeg(b.pf1);
  b.p2 += 1;
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

/** `bulletFunc2` @0x50d16c —— 朝自机限速转向，单帧增量 ≤ aa；末尾 life--。[实测/推断条件] */
function func2(b: BulletMotion, tg: MotionTargets): void {
  if (b.life < 1) {
    return;
  }
  rateLimitedTurn(b, angleToMyShip(b, tg), b.angle_acc);
  b.life -= 1;
}

/** `bulletFunc17` @0x50db94 —— 限速追踪（单帧 ≤ A0）。[实测] */
function func17(b: BulletMotion, tg: MotionTargets): void {
  const target = angleToMyShip(b, tg);
  if (Math.trunc(b.t) === b.life) {
    b.prev_angle = target;
    return;
  }
  if (Math.trunc(b.t) > b.life) {
    let out = target;
    const d = out - b.prev_angle;
    if (d > b.angle_init) {
      out = b.prev_angle + b.angle_init;
    } else if (d < b.angle_init) {
      out = b.prev_angle - b.angle_init;
    }
    b.angle = out;
    b.prev_angle = out;
  }
}

/** `bulletFunc18` @0x50dc4c —— 状态机：P2 保存上次瞄准角。[unicorn 逐指令实测] */
function func18(b: BulletMotion, tg: MotionTargets): void {
  const t = Math.trunc(b.t);
  if (t === b.life) {
    b.p2 = Math.trunc(angleToEnemy(b, tg));
  }
  if (t > b.life) {
    const aim = angleToMyShip(b, tg);
    b.angle = aim;
    const lim = b.p1;
    const d = aim - b.p2;
    if (d > lim) {
      b.angle = lim + b.p2;
    } else if (d < lim) {
      b.angle = b.p2 - lim;
    }
    b.p2 = Math.trunc(b.angle);
  }
}

/** `bulletFunc48` @0x50f6c4 —— 蓄力 30 帧后一次性复位。[unicorn 逐指令实测] */
function func48(b: BulletMotion, tg: MotionTargets): void {
  const t = Math.trunc(b.t);
  if (t < b.life) {
    return;
  }
  if (t < b.life + 30) {
    b.speed = 0;
    return;
  }
  if (t !== b.life + 30) {
    return;
  }
  if (b.p2 === 1) {
    b.angle = b.angle_init;
  } else if (b.p2 === 0) {
    b.angle = angleToMyShip(b, tg);
  }
  b.angle_acc = b.f598;
  b.f56c = b.prev_angle;
  b.speed = b.spd_init2;
  b.accel = b.xacc;
  b.speed_cap = b.xacc_cap;
  if (b.p1 === 1) {
    b.bullet_kind = 206;
  } else if (b.p1 === 0) {
    b.bullet_kind = 37;
  }
}

// ===========================================================================
// E 周期瞄准 / 出屏转向
// ===========================================================================

/** `bulletFunc11` @0x50bc4c —— 屏内 angle=90；出屏且 p1==1/2 才瞄准并 life--。[实测] */
function func11(b: BulletMotion, tg: MotionTargets): void {
  if (b.life < 1) {
    return;
  }
  const out = b.x > kHalfW || b.x < 0 || b.y > kHalfH;
  if (out && b.p1 === 1) {
    b.angle = angleToMyShip(b, tg);
    b.life -= 1;
    return;
  }
  if (out && b.p1 === 2) {
    b.angle = angleToEnemy(b, tg);
    b.life -= 1;
    return;
  }
  b.angle = 90;
}

/** `bulletFunc12` @0x50d7a8 —— 出屏（含 y<40）后重新瞄准；p1==1/2 时同时 life--。[实测] */
function func12(b: BulletMotion, tg: MotionTargets): void {
  // update 分派入口 0x50bc68：`life < 1` 整段跳过。
  if (b.life < 1) {
    return;
  }
  if (b.x > kHalfW || b.x < 0 || b.y > kHalfH || b.y < kTop) {
    if (b.p1 === 2) {
      b.angle = angleToEnemy(b, tg);
      b.life -= 1;
    } else if (b.p1 === 1) {
      b.angle = angleToMyShip(b, tg);
      b.life -= 1;
    }
  }
}

/** `bulletFunc13` @0x50d860 —— 近距限速追踪。[unicorn 逐指令实测] */
function func13(b: BulletMotion, tg: MotionTargets): void {
  if (Math.trunc(b.t) === 0) {
    b.p1 = Math.trunc(b.angle);
  }
  if (!tg.has_my_ship) {
    return;
  }
  const dx = tg.my_ship_x - b.x;
  const dy = tg.my_ship_y - b.y;
  const dist2 = dx * dx + dy * dy;
  const radius2 = b.life * b.life;
  if (dist2 >= radius2) {
    return;
  }
  const aim = angleToMyShip(b, tg);
  const d = aim - (b.p1 % 360);
  b.angle = f32(b.p1 + (d < 2 ? -2 : 2));
  b.p1 = Math.trunc(b.angle);
}

/** `bulletFunc14` @0x50d950 —— pf1 随 life 线性变化；scale=pf1；hitDis=f32(pf2·pf1)。[实测] */
function func14(b: BulletMotion): void {
  const t = Math.trunc(b.t);
  if (t === 0) {
    b.pf1 = f32(b.life * 0.1);
  } else if (t >= 1 && b.p2 !== 0) {
    b.pf1 = f32(b.pf1 + ((b.p2 - b.life) * 0.1) / b.p1);
  }
  if (b.p2 !== 0) {
    const target = b.p2 * 0.1;
    if (b.life < b.p2 && target < b.pf1) {
      b.pf1 = f32(target);
    }
    if (b.life > b.p2 && target > b.pf1) {
      b.pf1 = f32(target);
    }
  }
  b.scale = b.pf1;
  b.hit_dis = f32(b.pf2 * b.pf1);
}

/** `bulletFunc70` @0x51079c —— 三段独立出屏反射（x>320 / x<0 / y>480）。[unicorn 逐指令实测] */
function func70(b: BulletMotion, tg: MotionTargets, rng: DeterministicRng): void {
  if (b.life < 1) {
    return;
  }
  const hit = [b.x > kHalfW, b.x < 0, b.y > kHalfH];
  for (let seg = 0; seg < 3; seg += 1) {
    if (!hit[seg]) {
      continue;
    }
    const c = seg === 2 ? kDeg360 : kDeg180;
    let a = c - b.angle + rng.randomInt(-b.p2, b.p2);
    if (seg !== 2 && a < 0) {
      a += kDeg360;
    }
    b.angle = a;
    switch (b.p1) {
      case 0: b.bullet_kind = 160; break;
      case 1: b.bullet_kind = 161; break;
      case 2: b.bullet_kind = 150; b.scale = b.angle_init; break;
      case 3: b.bullet_kind = 17; break;
      case 4: b.bullet_kind = 214; b.angle = angleToMyShip(b, tg); break;
      default: break;
    }
    b.speed = b.spd_init2;
    b.accel = b.xacc;
    b.speed_cap = b.xacc_cap;
    b.life -= 1;
  }
}

/** `bulletFunc76` @0x510d30 —— y>480 → 瞄准 + 换皮。[实测] */
function func76(b: BulletMotion, rng: DeterministicRng): void {
  // 分派入口 0x50c0fc：`life < 1` 整段跳过。
  if (b.life < 1) {
    return;
  }
  if (b.y > kHalfH) {
    // 0x510d78 `s8 = 360-angle`，`s0 = float(random) + s8`，**不归一**。
    b.angle = kDeg360 - b.angle + rng.randomInt(-b.p2, b.p2);
    // 0x510d80 8B 拷贝 {spdInit2,xacc}→{speed,accel} + speedCap=XC。
    b.speed = b.spd_init2;
    b.accel = b.xacc;
    b.speed_cap = b.xacc_cap;
    if (b.p1 === 0) {
      b.bullet_kind = 17;
    }
    b.life -= 1;
  }
}

// ===========================================================================
// F 边界反弹 / 镜像
// ===========================================================================

/** `bulletFunc1` @0x50ce78 —— 三段独立边界反弹；不写 speed/speedCap。[unicorn 逐指令实测] */
function func1(b: BulletMotion): void {
  if (b.life < 1) {
    return;
  }
  let hits = 0;
  if (b.x > kHalfW) { b.angle = mirrorAngle(b.angle, kDeg180); hits += 1; }
  if (b.x < 0) { b.angle = mirrorAngle(b.angle, kDeg180); hits += 1; }
  if (b.y > kHalfH) { b.angle = mirrorAngle(b.angle, kDeg360); hits += 1; }
  b.life -= hits;
  if (hits > 0 && b.p1 >= 1 && b.p1 <= 4) {
    const kKindByP1 = [30, 19, 109, 168];
    b.bullet_kind = kKindByP1[b.p1 - 1];
    // 表项 idx1(50cf60) 还会把 spdInit2 写进 speed；
    // idx3(50cf20) 是 8B 拷贝 {spdInit2,xacc}→{speed,accel} 并 speedCap=XC。
    if (b.p1 === 2 || b.p1 === 4) {
      b.speed = b.spd_init2;
    }
    if (b.p1 === 4) {
      b.accel = b.xacc;
      b.speed_cap = b.xacc_cap;
    }
  }
}

/** `bulletFunc7` @0x50d3b8 —— 四段独立边界反弹，每段 life--；每段命中各叠加一次 random(-p1,p1)。[实测] */
function func7(b: BulletMotion, rng: DeterministicRng): void {
  if (b.life < 1) {
    return;
  }
  // 原版四段各自 `bl MyMathUtil::random(-p1,p1)`，不是四段命中后统一加一次；
  // 调用次数不同会让整条 RNG 流错位。
  let hits = 0;
  const bounce = (hit: boolean, c: number): void => {
    if (!hit) {
      return;
    }
    b.angle = mirrorAngle(b.angle, c);
    if (b.p1 >= 1) {
      b.angle += rng.randomInt(-b.p1, b.p1);
    }
    hits += 1;
  };
  bounce(b.x > kHalfW, kDeg180);
  bounce(b.x < 0, kDeg180);
  bounce(b.y > kHalfH, kDeg360);
  bounce(b.y < kTop, kDeg360);
  b.life -= hits;
}

/** `bulletFunc20` @0x50dde0 —— 直接改写位置的四档折返链。[unicorn 逐指令实测] */
function func20(b: BulletMotion): void {
  if (b.life < 0) {
    return;
  }
  if (b.life === 0) {
    if (b.x > 240) {
      b.x = 320;
      b.life = 1;
      b.angle += kDeg180;
    } else if (b.x < 80) {
      b.x = 0;
      b.life = 2;
      b.angle += kDeg180;
    }
    if (b.y > 340) {
      b.y = 420;
      b.life = 3;
      b.angle += kDeg180;
    } else if (b.y < 180) {
      b.y = 100;
      b.life = 4;
      b.angle += kDeg180;
    }
    return;
  }
  if (b.x <= 80 || b.x >= 240 || b.y <= 180 || b.y >= 340) {
    return;
  }
  const idx = b.life - 1;
  if (idx > 3) {
    return;
  }
  // 原版四档跳转表是级联 fallthrough；noFallthroughCasesInSwitch 下用顺序 if 复刻。
  if (idx <= 0) { b.x = 320; b.life = 2; b.angle += kDeg180; }
  if (idx <= 1) { b.x = 0; b.life = 3; b.angle += kDeg180; }
  if (idx <= 2) { b.y = 420; b.life = 4; b.angle += kDeg180; }
  if (idx <= 3) { b.y = 100; b.life = 5; b.angle += kDeg180; }
}

/** `bulletFunc32` @0x50ea08 —— 节拍门 t%life==0；按 P1 奇偶镜像角。[实测] */
function func32(b: BulletMotion): void {
  const t = Math.trunc(b.t);
  if (t < 0) {
    return;
  }
  const rem = b.life !== 0 ? t % b.life : t;
  if (rem !== 0) {
    return;
  }
  const s = b.p2;
  const a0 = b.angle_init;
  b.speed = b.spd_init2;
  b.accel = b.xacc;
  b.speed_cap = b.xacc_cap;
  b.angle = (b.p1 & 1) ? a0 + s : s - a0;
  b.p1 += 1;
}

/** `bulletFunc38` @0x50edcc —— 节拍折返。[unicorn 逐指令实测] */
function func38(b: BulletMotion): void {
  const p2 = b.p2;
  if (p2 < 1) {
    return;
  }
  const dt = Math.trunc(b.t) - b.life;
  const onBeat = dt > 0 && b.life !== 0 && dt % b.life === 0;
  if (!onBeat) {
    if (p2 === 1 && b.p1 === 1) {
      b.p1 += 1;
    }
    return;
  }
  b.p2 = p2 - 1;
  b.angle = b.angle_init + b.angle;
  if (p2 - 1 === 1) {
    b.p1 += 1;
  }
}

/** `bulletFunc57` @0x50fd84 —— 在 A0±PA 之间三角波。[实测] */
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

/** `bulletFunc58` @0x50bfa8 —— 节拍门：p1 偶 → 90+A0；奇 → 90−A0；末尾 p1++。[实测] */
function func58(b: BulletMotion): void {
  const t = Math.trunc(b.t);
  if (t < 0) {
    return;
  }
  const rem = b.life !== 0 ? t % b.life : t;
  if (rem !== 0) {
    return;
  }
  b.angle = (b.p1 & 1) === 0 ? 90 + b.angle_init : 90 - b.angle_init;
  b.p1 += 1;
}

/** `bulletFunc59` @0x50c768 —— t<life 每帧 angle+1；否则 prevAngle 与 f598 反号时叠加。[实测] */
function func59(b: BulletMotion): void {
  if (Math.trunc(b.t) < b.life) {
    b.angle += 1;
    return;
  }
  if ((b.prev_angle < 0 && b.f598 > 0) || (b.prev_angle > 0 && b.f598 < 0)) {
    b.f598 += b.prev_angle;
    b.angle += b.f598;
  }
}

/** `bulletFunc62` @0x510088 —— 直接改写位置的四段边界折返。[unicorn 逐指令实测] */
function func62(b: BulletMotion, rng: DeterministicRng): void {
  if (b.life < 0) {
    return;
  }
  const cw = 2 * b.half_w;
  const ch = 2 * b.half_h;
  if (b.life >= 1) {
    let nx = b.x;
    let ny = b.y;
    if (b.half_w + cw < b.x) {
      nx = -cw; b.life -= 1; b.bullet_kind = 47;
    } else if (nx < -cw) {
      nx = b.half_w + cw; b.life -= 1; b.bullet_kind = 47;
    }
    if (b.half_h + ch < b.y) {
      ny = kTop - ch; b.life -= 1; b.bullet_kind = 47;
    } else if (ny < kTop - ch) {
      ny = b.half_h + ch; b.life -= 1; b.bullet_kind = 47;
    }
    b.x = nx;
    b.y = ny;
    return;
  }
  if (b.half_w + cw < b.x) {
    b.bullet_kind = 45;
    b.angle = kDeg180 + rng.randomInt(-80, 80);
    b.speed = b.xacc; b.life -= 1;
  }
  if (-cw > b.x) {
    b.bullet_kind = 45;
    b.angle = rng.randomInt(-80, 80);
    b.speed = b.xacc; b.life -= 1;
  }
  if (b.half_h + ch < b.y) {
    b.bullet_kind = 45;
    b.angle = 270 + rng.randomInt(-80, 80);
    b.speed = b.xacc; b.life -= 1;
  }
  if (kTop - ch > b.y) {
    b.bullet_kind = 45;
    b.angle = 90 + rng.randomInt(-80, 80);
    b.speed = b.xacc; b.life -= 1;
  }
}

/** `bulletFunc67` @0x510544 —— 四段独立反弹 + 尾段换皮复位。[unicorn 逐指令实测] */
function func67(b: BulletMotion): void {
  if (b.life >= 1) {
    let hits = 0;
    if (b.x > kHalfW) { b.angle = mirrorAngle(b.angle, kDeg180); hits += 1; }
    if (b.x < 0) { b.angle = mirrorAngle(b.angle, kDeg180); hits += 1; }
    if (b.y > kHalfH) { b.angle = mirrorAngle(b.angle, kDeg360); hits += 1; }
    if (b.y < kTop) { b.angle = mirrorAngle(b.angle, kDeg360); hits += 1; }
    b.life -= hits;
    b.p1 += hits;
  }
  if (b.p1 === 1) {
    if (b.p2 === 10) {
      b.bullet_kind = 198;
      b.angle_acc = b.f598;
      b.f56c = b.prev_angle;
      b.speed = b.spd_init2;
      b.accel = b.xacc;
      b.speed_cap = b.xacc_cap;
    }
    b.p2 += 1;
  }
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

/** `bulletFunc78` @0x510e88 —— `y<40` → 镜像角（360-angle）+ life--。[实测] */
function func78(b: BulletMotion): void {
  // 分派入口 0x50c180：`life < 1` 整段跳过。
  if (b.life < 1) {
    return;
  }
  if (b.y < kTop) {
    b.angle = mirrorAngle(b.angle, kDeg360);
    b.life -= 1;
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

/** `bulletFunc24` @0x50e100 —— 十字带触发 → 重置角/上限。[实测] */
function func24(b: BulletMotion, tg: MotionTargets): void {
  const lim = b.life * b.life;
  const dx = b.x - tg.my_ship_x;
  const dy = b.y - tg.my_ship_y;
  const hit = dx * dx < lim || dy * dy < lim;
  if (!hit || b.p2 !== 0) {
    return;
  }
  b.angle = b.angle_init;
  b.angle_acc = b.f598;
  b.f56c = b.prev_angle;
  b.speed = b.spd_init2;
  b.speed_cap = b.xacc_cap;
  b.p2 = 1;
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

/** `bulletFunc44` @0x50f580 —— L==1 且 y<P1 → 16B 复位。[实测] */
function func44(b: BulletMotion): void {
  if (b.p2 !== 0) {
    return;
  }
  if (b.life !== 1) {
    return;
  }
  if (!(b.y < b.p1)) {
    return;
  }
  b.angle = b.angle_init;
  b.angle_acc = b.f598;
  b.f56c = b.prev_angle;
  b.speed = b.spd_init2;
  b.accel = b.xacc;
  b.speed_cap = b.xacc_cap;
  b.p2 += 1;
}

/** `bulletFunc45` @0x50f600 —— 首帧 setOpacity(life)+setScale(V1)。[实测] */
function func45(b: BulletMotion): void {
  if (b.p2 !== 0) {
    return;
  }
  b.opacity = b.life;
  b.scale = b.spd_init2;
  b.p2 = 1;
}

/** `bulletFunc53` @0x50fa34 —— 两阶段接近触发。[推断：常量存疑] */
function func53(b: BulletMotion, tg: MotionTargets): void {
  if (b.p1 === 0) {
    if (!(b.y < tg.my_ship_y)) {
      return;
    }
    b.p1 = 1;
    return;
  }
  if (b.p1 !== 1) {
    return;
  }
  if (b.p2 === 0) {
    b.bullet_kind = 210;
    b.accel = -0.1;
    b.speed_cap = 0;
  } else if (b.p2 === b.life) {
    b.angle = b.angle_init;
    b.angle_acc = b.f598;
    b.f56c = b.prev_angle;
    b.speed = b.spd_init2;
    b.accel = b.xacc;
    b.speed_cap = b.xacc_cap;
  }
  b.p2 += 1;
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
  if (b.bullet_loop === 0 && Math.trunc(b.t) === 11) {
    b.opacity = b.life;
  }
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
function func84(b: BulletMotion): void {
  if (b.p2 === 0) {
    b.opacity = 0;
    const dx = b.x - b.spd_init2;
    const dy = b.y - b.xacc;
    if (dx * dx + dy * dy > b.life) {
      b.p2 = 1;
    }
  } else if (b.p2 === 1) {
    let a = b.p1 << 4;
    if (a >= 255) {
      a = 255;
    }
    b.opacity = a;
    b.p1 += 1;
  }
}

/** `bulletFunc85` @0x5110a4 —— 无条件 hitDis=4.0；距离门命中且 kind==0x25 时 20.0。[实测] */
function func85(b: BulletMotion, tg: MotionTargets): void {
  b.hit_dis = 4;
  if (distSqToMyShip(b, tg) < b.life && b.bullet_kind === 0x25) {
    b.hit_dis = 20;
  }
}

// ===========================================================================
// H 分裂 / 召唤（Boss）—— 子子弹生成交宿主，这里只做状态标记
// ===========================================================================

/** `bulletFunc31` @0x50e498 —— t==p1 时按 (life-1) 走 31 档跳转表换皮 + 设半径。[实测] */
function func31(b: BulletMotion): void {
  const t = Math.trunc(b.t);
  // 本项目扩展：链式分裂标记与原版 life>=1 门解耦。
  if (t === b.p1 && b.life <= 0x1e) {
    b.rotate_flg = 2;
    b.p2 = 1;
  }
  if (t !== b.p1) {
    return;
  }
  const idx = b.life - 1;
  if (idx < 0 || idx > 30) {
    return;
  }
  const kHitDis = [
    f32(2.4), 3, 3, 43, f32(2.4), f32(2.4),
    4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
    4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
    4, 4, 4, 4, 4,
  ];
  const kKind = [
    45, 45, 45, 45, 45, 45,
    207, 210, 135, 206, 10, 186, 91, 184, 187, 189,
    184, 189, 189, 175, 150, 169, 217, 218, 199, 211,
    213, 215, 64, 69, 70,
  ];
  b.hit_dis = kHitDis[idx];
  b.bullet_kind = kKind[idx];
}

/** `bulletFunc50` @0x50f800 —— 三阶段蓄力状态机。[unicorn 逐指令实测] */
function func50(b: BulletMotion, rng: DeterministicRng): void {
  if (b.life === 0) {
    if (b.x > 280 || b.x < 40 || b.y > 440 || b.y < 80) {
      b.life = 1;
      b.speed = 0;
      b.accel = 0;
      b.speed_cap = 0;
    }
    return;
  }
  if (b.life === 1) {
    if (b.p1 <= 12 && (b.p1 & 1) === 0) {
      if (b.p1 === 12) {
        b.life = 2;
      } else {
        rng.randomInt(-5, 5);
        rng.randomInt(-5, 5);
      }
    }
    b.p1 += 1;
    return;
  }
  if (b.life === 2) {
    if (b.p2 === 30) {
      b.angle = b.angle_init;
      b.angle_acc = b.f598;
      b.f56c = b.prev_angle;
      b.speed = b.spd_init2;
      b.accel = b.xacc;
      b.speed_cap = b.xacc_cap;
    }
    b.p2 += 1;
  }
}

/** `bulletFunc55` @0x50fca0 —— 接近敌机 → 蓄力特效。[推断：事件仅] */
function func55(b: BulletMotion, tg: MotionTargets): void {
  if (distSqToEnemy(b, tg) <= b.life) {
    b.p2 = 1; // 请求蓄力特效（宿主处理）
  }
}

/** `bulletFunc83` @0x511fcc —— 双谐波参数方程，**绝对定位**；不写 angle/speed。[实测] */
function func83(b: BulletMotion): void {
  const d = b.t - b.p2;
  if (d < 0) {
    return;
  }
  const r = Math.min(f32(0.2 * d), 60);
  const a = 30 * sinDeg(d);
  const life = b.life;
  const p1 = b.p1;
  b.x = r * cosDeg(d) + 160 + cosDeg(a) * life - sinDeg(a) * p1;
  b.y = r * sinDeg(d) + 260 + sinDeg(a) * life + cosDeg(a) * p1;
}

// ===========================================================================
// I 换皮 / 半径
// ===========================================================================

/** `bulletFunc30` @0x50e224 —— 按 (t-life)%p1 分档换 hitDis（20.0 / 4.0）。[实测] */
function func30(b: BulletMotion): void {
  // 0x50e248 逐指令：d = t-life；d<0 → 只做 setRotation（不改状态）。
  //   rem = d % p1（p1==0 时 ARM sdiv 0 → rem = d）；
  //   rem==0 → hitDis=20.0；rem==p2-1 → hitDis=4.0；其余只 setRotation。
  const d = Math.trunc(b.t) - b.life;
  if (d < 0) {
    return;
  }
  const rem = b.p1 !== 0 ? d % b.p1 : d;
  if (rem === 0) {
    b.hit_dis = 20;
  } else if (rem === b.p2 - 1) {
    b.hit_dis = 4;
  }
}

/** `bulletFunc54` @0x50faf4 —— 节拍门 t%p1；按 life 阶段换皮。[实测] */
function func54(b: BulletMotion): void {
  const t = Math.trunc(b.t);
  const rem = b.p1 !== 0 ? t % b.p1 : t;
  if (rem !== 0) {
    return;
  }
  if (b.life === 0) {
    if (b.p2 === 0) {
      b.bullet_kind = 0x94;
    } else if (b.p2 === 1) {
      b.bullet_kind = 0xcc;
    }
  } else if (b.life === 1) {
    // 字节表 @0xb0a9c7 → kind 163,157,158,159,160,161,162（旧实现写成了逆序）。
    const kTypeByP2Mod7 = [0xa3, 0x9d, 0x9e, 0x9f, 0xa0, 0xa1, 0xa2];
    b.bullet_kind = kTypeByP2Mod7[((b.p2 % 7) + 7) % 7];
  } else if (b.life === 2) {
    if (b.p2 === 0) {
      b.bullet_kind = 0x4a;
    } else if (b.p2 === 1) {
      b.bullet_kind = 0x26;
    } else if (b.p2 === 2) {
      b.bullet_kind = 0x95;
    } else {
      b.p2 += 1;
      return;
    }
    b.speed = b.spd_init2;
    b.speed_cap = b.xacc_cap;
  }
  b.p2 += 1;
}

/** `bulletFunc65` @0x510498 —— 节拍门 t%p1；按 life/P2 换皮并重置速度，末尾 life--。[实测] */
function func65(b: BulletMotion): void {
  const t = Math.trunc(b.t);
  if (t < 0) {
    return;
  }
  const rem = b.p1 !== 0 ? t % b.p1 : t;
  if (rem !== 0) {
    return;
  }
  if (b.life === 0) {
    if (b.p2 === 0) {
      b.bullet_kind = 0x37;
    } else if (b.p2 === 1) {
      b.bullet_kind = 0x3c;
    }
    b.speed = b.xacc;
  } else if (b.life === 1) {
    if (b.p2 === 0) {
      b.bullet_kind = 0x2e;
    } else if (b.p2 === 1) {
      b.bullet_kind = 0x33;
    }
    b.speed = b.spd_init2;
  }
  b.life -= 1;
}

// ===========================================================================
// J 参数方程 / 摆线
// ===========================================================================

/** `bulletFunc26` @0x511524 —— 参数方程 setPosition（绝对坐标）。[推断] */
function func26(b: BulletMotion): void {
  const t = b.t;
  const r = b.p2 * sinDeg(b.xacc * t + b.xacc_cap);
  const a = b.angle + b.speed * t;
  b.x = b.life + r * cosDeg(a);
  b.y = b.p1 + r * sinDeg(a);
}

/** `bulletFunc33` @0x51160c —— 双正弦目标坐标写入 xacc/xaccCap（不写 angle）。[推断] */
function func33(b: BulletMotion): void {
  // 独立符号 0x51160c 逐指令：只把两个「目标坐标」写进 xacc / xaccCap，
  // 尾部 atan2f 只用于 setRotation。★ 原版完全不写 angle。
  const t = b.t;
  const x = b.angle_init + b.speed * t * cosDeg(b.angle)
    + b.spd_init2 * cosDeg(b.f598 * t);
  const y = b.prev_angle + b.speed * t * sinDeg(b.angle)
    + b.spd_init2 * sinDeg(b.f598 * t);
  b.xacc = x;
  b.xacc_cap = y;
}

/** `bulletFunc66` @0x511ab4 —— 参数方程 setPosition（绝对坐标）；末尾 p2++。[推断] */
function func66(b: BulletMotion): void {
  const u = b.angle_init * b.p2;
  const a = b.xacc * b.p2 + b.speed_cap;
  b.x = b.prev_angle + u * cosDeg(b.f598) + b.spd_init2 * cosDeg(a);
  b.y = b.xacc_cap + u * sinDeg(b.f598) + b.spd_init2 * sinDeg(a);
  b.p2 += 1;
}

/** `bulletFunc75` @0x511c08 —— 极坐标 setPosition（绝对定位）；末尾 p2++。[推断] */
function func75(b: BulletMotion): void {
  const p2 = b.p2;
  const r = b.spd_init2 + b.xacc * p2;
  const a = b.angle_init + b.f598 * p2;
  b.x = b.prev_angle + r * cosDeg(a);
  b.y = b.xacc_cap + r * sinDeg(a);
  b.p2 += 1;
}

/** `bulletFunc82` @0x511e48 —— 以自机坐标为基点的极坐标绝对定位；不写 angle/speed。[实测] */
function func82(b: BulletMotion, tg: MotionTargets): void {
  const d = b.t - b.p2;
  let r = b.spd_init2;
  if (d >= 0) {
    r += b.xacc * d;
  }
  r = Math.max(r, b.xacc_cap);
  const ang = b.angle_init + b.f598 * b.t;
  const ox = tg.has_my_ship ? tg.my_ship_x : 320;
  const oy = tg.has_my_ship ? tg.my_ship_y : 600;
  b.x = ox + r * cosDeg(ang);
  b.y = oy + r * sinDeg(ang);
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

/** `bulletFunc23` @0x50e078 —— 状态 `==5` → `v = L·0.1`。[实测] */
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
// L 辅助（透明度 / 环绕 / 折角 / 节拍）
// ===========================================================================

/** `bulletFunc3` @0x51130c —— vx/vy 叠加 0.01633334·(cos life, sin life)（单精度）。[实测] */
function func3(b: BulletMotion): void {
  const c = cosDegF(b.life);
  const s = sinDegF(b.life);
  b.vx += f32(K_DRIFT * c);
  b.vy += f32(K_DRIFT * s);
}

/** `bulletFunc6` @0x50d2e8 —— X 轴环绕：越界换边并 life--。[实测] */
function func6(b: BulletMotion): void {
  if (b.life < 1) {
    return;
  }
  const w = b.half_w * 2;
  if (b.x > b.half_w + w) {
    b.x = -w;
    b.life -= 1;
  }
  if (b.x < -w) {
    b.x = b.half_w + w;
    b.life -= 1;
  }
}

/** `bulletFunc8` @0x50d574 —— X/Y 双轴环绕（Y 下界 40-h）。[实测] */
function func8(b: BulletMotion): void {
  if (b.life < 1) {
    return;
  }
  const w = b.half_w * 2;
  const h = b.half_h * 2;
  if (b.x > b.half_w + w) {
    b.x = -w;
    b.life -= 1;
  }
  if (b.x < -w) {
    b.x = b.half_w + w;
    b.life -= 1;
  }
  if (b.y > b.half_h + h) {
    b.y = kTop - h;
    b.life -= 1;
  }
  if (b.y < kTop - h) {
    b.y = b.half_h + h;
    b.life -= 1;
  }
}

/** `bulletFunc28` @0x50e1e8 —— alpha = max(255 - p2·(t-p1), life)，淡出。[实测] */
function func28(b: BulletMotion): void {
  const d = Math.trunc(b.t) - b.p1;
  let a = 0;
  if (d >= 0) {
    a = 255 - b.p2 * d;
    if (a < b.life) {
      a = b.life;
    }
  }
  b.opacity = a;
}

/** `bulletFunc79` @0x510ef0 —— alpha = min(p2·(t-p1), life)，淡入。[实测] */
function func79(b: BulletMotion): void {
  const d = Math.trunc(b.t) - b.p1;
  let a = 0;
  if (d >= 0) {
    a = b.p2 * d;
    if (a > b.life) {
      a = b.life;
    }
  }
  b.opacity = a;
}

/** `bulletFunc36` @0x50ed50 —— alpha = 128 + 128·sin(p1·(t-life)+90)；hitHantei=alpha>127。[实测] */
function func36(b: BulletMotion): void {
  const d = Math.trunc(b.t) - b.life;
  if (d < 0) {
    b.opacity = 255;
    return;
  }
  const s = Math.trunc(f32(sinDegF(b.p1 * d + 90) * 128));
  let a = s + 128;
  if (a >= 255) {
    a = 255;
  }
  const c = a < 0 ? 0 : a;
  b.hit_hantei = c > 127;
  b.opacity = c < 128 ? c : a;
}

/** `bulletFunc27` —— no-op：update 分派落在共用出口，独立符号不是逐帧路径。 */
function func27(): void {}

/** `bulletFunc46` @0x50f654 —— 每 N 帧把角赋成 180/0（不是累加）。[实测] */
function func46(b: BulletMotion): void {
  const t = Math.trunc(b.t);
  if (t === 0) {
    b.bullet_life = b.p1;
    if (t !== b.p1) {
      return;
    }
  } else if (t !== b.bullet_life) {
    return;
  }
  b.angle = 90 + (b.life === 0 ? -90 : 90);
  b.bullet_loop += 1;
  b.bullet_life = b.p2 * b.bullet_loop + (b.p1 + t);
}

/** `bulletFunc52` @0x50f9e4 —— 节拍门 + `angle = p1 · random(-p2,p2)`。[实测] */
function func52(b: BulletMotion, rng: DeterministicRng): void {
  // 0x50f9f0 逐指令：t>=0 且 t%life==0（life==0 时退化为 t==0）；
  //   `neg w0,w1` → random(-p2,p2)，结果再乘 p1 写进 angle。
  const t = Math.trunc(b.t);
  if (t < 0) {
    return;
  }
  const rem = b.life !== 0 ? t % b.life : t;
  if (rem !== 0) {
    return;
  }
  b.angle = b.p1 * rng.randomInt(-b.p2, b.p2);
}

/** `bulletFunc61` @0x50ff78 —— 节拍门 (t-life)%p1==0；X/Y 轴四方向。[实测] */
function func61(b: BulletMotion, tg: MotionTargets): void {
  const d = Math.trunc(b.t) - b.life;
  if (d < 0) {
    return;
  }
  const rem = b.p1 !== 0 ? d % b.p1 : d;
  if (rem !== 0) {
    return;
  }
  if ((b.p2 & 1) === 0) {
    b.angle = b.x < tg.my_ship_x ? 0 : 180;
  } else {
    b.angle = b.y < tg.my_ship_y ? 90 : 270;
  }
  // 0x510034 是 8B 拷贝 {spdInit2,xacc}→{speed,accel}，漏写 accel 会让同帧共用出口少加一次 xacc。
  b.speed = b.spd_init2;
  b.accel = b.xacc;
  b.speed_cap = b.xacc_cap;
  b.p2 += 1;
}

/** `bulletFunc63` @0x510394 —— 节拍门；a=A0; aa=-F98; f56c=-PA。[实测] */
function func63(b: BulletMotion): void {
  const d = Math.trunc(b.t) - b.life;
  if (d < 0) {
    return;
  }
  const rem = b.p1 !== 0 ? d % b.p1 : d;
  if (rem !== 0) {
    return;
  }
  b.angle = b.angle_init;
  b.angle_acc = -b.f598;
  b.f56c = -b.prev_angle;
}

/** `bulletFunc64` @0x5103d0 —— 节拍门 t%p1；按 life 分阶段；末尾 life--。[实测] */
function func64(b: BulletMotion, tg: MotionTargets): void {
  const t = Math.trunc(b.t);
  const rem = b.p1 !== 0 ? t % b.p1 : t;
  if (rem !== 0) {
    return;
  }
  if (b.life === 0) {
    b.angle = b.angle_init;
    b.speed = b.spd_init2;
    b.accel = 0;
    b.speed_cap = 0;
  } else if (b.life === 1) {
    b.angle = angleToMyShip(b, tg);
    b.speed = b.spd_init2;
    b.accel = b.xacc;
    b.speed_cap = b.xacc_cap;
  }
  b.life -= 1;
}

/** `bulletFunc37` @0x51172c —— setOpacity + setPosition 绝对坐标 + hitHantei。[推断] */
function func37(b: BulletMotion): void {
  const t = b.t;
  const arg = b.xacc * t + b.life;
  const s = sinDeg(arg - 90);
  b.opacity = Math.trunc(75 * s + 180);
  b.x = b.angle_init + b.xacc_cap * sinDeg(arg);
  b.y = b.f598 + b.spd_init2 * t;
  b.hit_hantei = s >= 0;
}

// --- 分派 -------------------------------------------------------------------

/** `IsKnownBulletFunc`：该编号是否在已知 `bulletFunc` 集合内。 */
export function isKnownBulletFunc(funcNo: number): boolean {
  return KNOWN_BULLET_FUNCS.has(funcNo);
}

const KNOWN_BULLET_FUNCS: ReadonlySet<number> = new Set([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
  24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43,
  44, 45, 46, 47, 48, 50, 51, 52, 53, 54, 55, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66,
  67, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85,
]);

/**
 * `BulletFuncStage` —— 原版 update 的三段调用时机：
 *   0 early = 分派入口 / 共用出口内联；
 *   1 mid   = 仅 func29（共用出口 accel 应用之后、速度合成之前）；
 *   2 late  = 二次分派的 8 个独立符号（速度合成之后）。
 */
function bulletFuncStage(funcNo: number): number {
  switch (funcNo) {
    case 29:
      return 1;
    case 33: case 37: case 51: case 66:
    case 75: case 81: case 82: case 83:
      return 2;
    default:
      return 0;
  }
}

/**
 * `ApplyBulletFuncStage` —— `bulletFunc` 的逐帧分派（对应 `EnemyBullet::update`
 * 的间接跳转表），按 `stage` 拆成 early(0) / mid(1) / late(2) 三个阶段。
 *
 * 阶段不匹配的编号不执行但仍视为已知（返回 `true`）；只有匹配阶段的编号才走
 * switch。未知编号在 early 阶段由 `default` 返回 `false`。
 */
function applyBulletFuncStage(
  b: BulletMotion,
  targets: MotionTargets,
  rng: DeterministicRng,
  stage: number,
): boolean {
  if (bulletFuncStage(b.bullet_func_no) !== stage) {
    return true;
  }
  switch (b.bullet_func_no) {
    case 0: func0(); break;
    case 1: func1(b); break;
    case 2: func2(b, targets); break;
    case 3: func3(b); break;
    case 4: func4(); break;
    case 5: func5(); break;
    case 6: func6(b); break;
    case 7: func7(b, rng); break;
    case 8: func8(b); break;
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
    case 27: func27(); break;
    case 28: func28(b); break;
    case 29: func29(b); break;
    case 30: func30(b); break;
    case 31: func31(b); break;
    case 32: func32(b); break;
    case 33: func33(b); break;
    case 34: func34(b, targets); break;
    case 35: func35(b, targets); break;
    case 36: func36(b); break;
    case 37: func37(b); break;
    case 38: func38(b); break;
    case 39: func39(b); break;
    case 40: func40(b); break;
    case 41: func41(b, targets); break;
    case 42: func42(b, targets); break;
    case 43: func43(b); break;
    case 44: func44(b); break;
    case 45: func45(b); break;
    case 46: func46(b); break;
    case 47: func47(b); break;
    case 48: func48(b, targets); break;
    case 50: func50(b, rng); break;
    case 51: func51(b, targets); break;
    case 52: func52(b, rng); break;
    case 53: func53(b, targets); break;
    case 54: func54(b); break;
    case 55: func55(b, targets); break;
    case 57: func57(b, targets); break;
    case 58: func58(b); break;
    case 59: func59(b); break;
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
    case 79: func79(b); break;
    case 80: func80(b); break;
    case 81: func81(b); break;
    case 82: func82(b, targets); break;
    case 83: func83(b); break;
    case 84: func84(b); break;
    case 85: func85(b, targets); break;
    default: return false;
  }
  return true;
}

/**
 * `ApplyBulletFunc` —— 兼容外部调用（`tests/danmaku_motion.test.ts` 的确定性
 * 覆盖）：一次跑完 early / mid / late 三个阶段，等价于原版 `ApplyBulletFunc`。
 *
 * @returns `true` 表示该编号已实现，`false` 表示未实现（调用者应记录）。
 */
export function applyBulletFunc(
  b: BulletMotion,
  targets: MotionTargets,
  rng: DeterministicRng,
): boolean {
  const known = applyBulletFuncStage(b, targets, rng, 0);
  applyBulletFuncStage(b, targets, rng, 1);
  applyBulletFuncStage(b, targets, rng, 2);
  return known;
}

/** `SkipsVelocitySynthesis`：func3/29/47 自己合成 vx/vy，跳过默认尾段。 */
function skipsVelocitySynthesis(funcNo: number): boolean {
  return funcNo === 3 || funcNo === 29 || funcNo === 47;
}

/** `SkipsPositionIntegration`：这 9 个编号用 setPosition 绝对定位，宿主固定积分要预减。 */
function skipsPositionIntegration(funcNo: number): boolean {
  switch (funcNo) {
    case 26: case 33: case 37: case 51: case 66:
    case 75: case 81: case 82: case 83:
      return true;
    default:
      return false;
  }
}

/**
 * 完整单帧更新 —— `UpdateBulletMotion`（unicorn 整帧实测口径）。
 *
 * 1. `delay` 倒计时（`>0` 则本帧不运动）；
 * 2. 若 `bullet_life != 0`：`angle += angle_acc`，并按 `f56c` 夹持；
 * 3. `bulletFunc` early 阶段分派（stage 0）；
 * 4. 共用出口 accel 应用：`accel>0 && speed<speed_cap` → `speed=min(speed+accel, speed_cap)`，
 *    `accel<0 && speed>speed_cap` → `speed=max(speed+accel, speed_cap)`；
 * 4b. `bulletFunc` mid 阶段分派（stage 1，仅 func29，在 accel 应用之后）；
 * 5. 默认 `IntegrateVelocity()`（func3/29/47 跳过）；
 * 5b. `bulletFunc` late 阶段分派（stage 2，8 个二次分派编号，在速度合成之后）；
 * 6. 对 setPosition 族预减 `x -= vx; y -= vy`（宿主随后固定 `pos += (vx,vy)`）；
 * 7. 帧末 `bullet_life > 0` 时自减（决定下一帧开头是否做角积分夹持）。
 *
 * ★ 不递增 `t`（由宿主完成）、不递增 `life`；`bullet_life` 由本函数帧末自减。
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
  // 3) early 阶段：分派入口 / 共用出口内联。
  applyBulletFuncStage(b, targets, rng, 0);
  // 4) 共用出口 0x50c8f0：spdAcc != 0 时 speed += accel 并夹到 speedCap。
  if (b.accel > 0 && b.speed < b.speed_cap) {
    b.speed = Math.min(b.speed + b.accel, b.speed_cap);
  } else if (b.accel < 0 && b.speed > b.speed_cap) {
    b.speed = Math.max(b.speed + b.accel, b.speed_cap);
  }
  // 4b) mid 阶段：func29（0x50c9ec）。必须在 accel 应用之后，否则它写入的
  //     accel 会在同帧被应用，speed 多出一个 xacc。
  applyBulletFuncStage(b, targets, rng, 1);
  // 5) 默认速度合成；func3/29/47 自己合成 vx/vy，跳过默认段。
  const fn = b.bullet_func_no;
  if (!skipsVelocitySynthesis(fn)) {
    integrateVelocity(b);
  }
  // 5b) late 阶段：0x50cafc 二次分派的 8 个 func（速度合成之后）。
  applyBulletFuncStage(b, targets, rng, 2);
  // 6) 宿主固定做 pos += (vx,vy)；这 9 个编号原版跳过该积分，预减使积分后回到 setPosition 位置。
  if (skipsPositionIntegration(fn)) {
    b.x -= b.vx;
    b.y -= b.vy;
  }
  // 7) 原版 0x50cc84：帧末 bulletLife--（>0 时）。它决定下一帧开头是否做
  //    angle 累加/夹持；漏掉会让每帧都夹持（p1 档大批发散的根因）。
  if (b.bullet_life > 0) {
    b.bullet_life -= 1;
  }
}
