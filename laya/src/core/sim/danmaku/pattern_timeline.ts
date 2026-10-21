/**
 * 真实弹幕波次库 —— **逐行**移植
 * `PhK-BattleServer/src/danmaku/pattern_timeline.cpp` + `src/danmaku/emitter.cpp`。
 *
 * 这是「用 APK 的弹幕函数和弹幕图案、用 APK 的弹幕同步」的落地处：
 *
 *  - **弹种**（`kEnemyBullet`）与**运动函数**（`bulletFuncN`）都是逆向实测值
 *    （`rev/patterns/bullet_kind_table.md` / `bullet_funcs_disasm.md`），并已随
 *    `PhK-Protocol` 契约冻结；渲染层据此取图集帧（`core/game/bullet_visual.ts`）。
 *  - **调度**不再是自拟样板。以前这里是 `SAMPLE_TNA_PHASES` —— 四个阶段、
 *    逐 tick 时间是示例值，与服务端**按构造**产生不同弹幕集合（实测线上
 *    `match_000048`：客户端 360 颗 vs 服务端 2 颗）。现在这里是服务端权威库的
 *    同一份 10 个 `PatternDef`，配合 `EmitPatternTick` / `EmitRadial` 的同一套
 *    整圆发射语义，客户端才能与服务端逐字节同步。
 *
 * 精度：`SpawnCommand` 是 96 字节 POD，字段类型 `float`。服务端写字段时经历
 * `static_cast<float>`，客户端必须用 {@link f32}（`Math.fround`）复刻，否则
 * `EmitRadial` 读回的 `base_angle_deg` 会多出 double 尾数，角度→`cos/sin`→位置
 * 逐 tick 漂移。见 `core/math/float_lib`。
 */

import { angleToPoint, f32, normalizeDeg } from '../../math/float_lib';
import { createBulletMotion, type BulletMotion, type MotionTargets } from './bullet_motion';
import { createSpawnCommand, SPAWN_FOLLOW_EMITTER, type SpawnCommand } from './spawn_command';

/** 新弹幕规则集版本号（服务端与客户端需一致）。 */
export const TNA_RULESET_VERSION = 'tna-1.40-phase';

/**
 * 本文件里的时间线**就是**逆向出的生产时间线。
 *
 * 曾经是 `false`：那时 `SAMPLE_TNA_PHASES` 只是样板，客户端在真实弹幕规则集下的
 * 弹幕集合与权威服务端逐字节不同，`CanonicalStateHash` 不相等**不能**当成
 * 「预测失同步」，`BossRaceSimulation.hashComparable()` 因此返回 `false`、干脆不建
 * 弹幕集合。现在弹幕库与服务端同源，哈希比对重新有意义 ⇒ 置 `true`。
 */
export const TNA_TIMELINE_IS_PRODUCTION = true;

/** 瞄准模式 —— 对应服务端 `enum class AimMode`。 */
export enum AimMode {
  /** 使用 `command.base_angle_deg`。 */
  None = 0,
  /** 每 tick 朝自机。 */
  AtShip = 1,
  /** 每 tick 朝敌机（Boss）。 */
  AtEnemy = 2,
}

/**
 * 运动学模板 —— `spawn` 时写入子弹的快照字段（`A0/V0/F98/PA/V1/X/XC`）。
 *
 * 字段名与服务端 `struct BulletTemplate` 一致；默认值与 C++ 成员初始化一致
 * （`angle_init = -1`，其余 0）。
 */
export interface BulletTemplate {
  /** 覆盖 `cmd.bullet_type`（0 = 用 `cmd` 的）。 */
  bullet_kind: number;
  /** 运动函数编号（0 = 直线初始化）。 */
  bullet_func_no: number;
  /** 初始速度。 */
  speed: number;
  /** `A0`（-1 = 使用计算出的角度）。 */
  angle_init: number;
  /** +0x564。 */
  angle_spd: number;
  /** +0x568。 */
  angle_acc: number;
  /** +0x56c。 */
  f56c: number;
  /** +0x578。 */
  speed_cap: number;
  /** +0x598 正弦幅度。 */
  f598: number;
  /** +0x59c。 */
  prev_angle: number;
  /** +0x5a4。 */
  xacc: number;
  /** +0x5a8。 */
  xacc_cap: number;
  /** +0x5c8。 */
  pf2: number;
  /** +0x588 `N`。 */
  bullet_life: number;
  /** +0x5b8 `L`。 */
  life: number;
  /** +0x5bc `P1`。 */
  p1: number;
  /** +0x5c0 `P2`。 */
  p2: number;
  /** +0x5ac 延迟。 */
  delay: number;
}

/** 构造一份默认模板（与服务端 `BulletTemplate` 的默认成员值一致）。 */
export function createBulletTemplate(overrides: Partial<BulletTemplate> = {}): BulletTemplate {
  return {
    bullet_kind: 0,
    bullet_func_no: 0,
    speed: 0,
    angle_init: -1,
    angle_spd: 0,
    angle_acc: 0,
    f56c: 0,
    speed_cap: 0,
    f598: 0,
    prev_angle: 0,
    xacc: 0,
    xacc_cap: 0,
    pf2: 0,
    bullet_life: 0,
    life: 0,
    p1: 0,
    p2: 0,
    delay: 0,
    ...overrides,
  };
}

/** 一个波次 = 一次 `createBullets1` 齐射 + 运动学模板。 */
export interface PatternWave {
  /** 相对 pattern 起始的 tick。 */
  tick_offset: number;
  command: SpawnCommand;
  tmpl: BulletTemplate;
  aim: AimMode;
  /** `base_angle += spin * tick`（螺旋）。 */
  spin_per_tick_deg: number;
}

/** 一个模式 = 若干波次 + 周期。 */
export interface PatternDef {
  /** 真实模式名。 */
  id: string;
  /** 运动学族（A..L）。 */
  family: string;
  period_ticks: number;
  waves: PatternWave[];
}

/** 发射者坐标（用于 `-1.0` 哨兵）。 */
export interface EmitContext {
  emitter_x: number;
  emitter_y: number;
}

// --- 构造辅助（对应服务端匿名命名空间的 MakeCommand / MakeTemplate） --------

/**
 * 构造一条发射指令 —— 服务端 `MakeCommand`。
 *
 * ★ `base_angle_deg` / `spread_or_speed` / `f24` 都是 `SpawnCommand` 的 `float`
 * 字段，写入时经历 `static_cast<float>`，因此这里显式 {@link f32}。
 */
function makeCommand(
  kind: number,
  baseAngleDeg: number,
  spreadDeg: number,
  count: number,
  speed: number,
): SpawnCommand {
  return createSpawnCommand({
    bulletType: kind,
    frameIndex: 0,
    spawnX: SPAWN_FOLLOW_EMITTER,
    spawnY: SPAWN_FOLLOW_EMITTER,
    baseAngleDeg: f32(baseAngleDeg),
    count,
    spreadOrSpeed: f32(spreadDeg),
    f24: f32(speed),
  });
}

/** 构造一份运动学模板 —— 服务端 `MakeTemplate`。 */
function makeTemplate(kind: number, funcNo: number, speed: number): BulletTemplate {
  return createBulletTemplate({ bullet_kind: kind, bullet_func_no: funcNo, speed });
}

// --- 10 个真实模式（顺序即 BossRace 调度顺序） ------------------------------

/**
 * 10 个真实模式 —— 服务端 `BuildLibrary()` 的逐项镜像。
 *
 * 顺序即 `BossRaceSimulation` 的调度顺序（`pattern_index = (tick/45) % 10`），
 * 因此**不得重排**：顺序变了 `pattern_id` 与 `pattern_index` 都会错位，
 * `DeterministicRng` 的输入随之改变，哈希必然不匹配。
 *
 * 节奏：调度每 45 tick 一次，传进来的 tick 恒为 45 的倍数。若 `period_ticks`
 * 也取 45，相位恒为 0，只有 `tick_offset === 0` 的波会发；每个模式都变成"每
 * 45 tick 齐射一次"。因此需要变化的模式取 `period_ticks = 90`
 * （45k % 90 ∈ {0, 45}），并备好 offset 0 与 45 两波：每个调度点仍有弹，
 * 但相邻两点是不同的一波。**必须与 PhK-BattleServer 的
 * src/danmaku/pattern_timeline.cpp 完全一致**，否则 state hash 不等。
 */
export function bossRacePatternLibrary(): readonly PatternDef[] {
  const lib: PatternDef[] = [];

  // 1. kome_ring —— A 族：16 向整圆，直线（kome 弹种）。
  lib.push({
    id: 'kome_ring',
    family: 'A 初始化/直线',
    period_ticks: 90,
    waves: [
      {
        tick_offset: 0,
        command: makeCommand(45 /* kome_01 */, 0, 0, 16, 3.0),
        tmpl: makeTemplate(45, 0, 3.0),
        aim: AimMode.None,
        spin_per_tick_deg: 0,
      },
      {
        // 半格错位环：45k % 90 == 45 时发。
        tick_offset: 45,
        command: makeCommand(45, 11.25, 0, 16, 3.0),
        tmpl: makeTemplate(45, 0, 3.0),
        aim: AimMode.None,
        spin_per_tick_deg: 0,
      },
    ],
  });

  // 2. kusabi_gap_ring —— A 族：两波错位环，形成缺口（kusabi 弹种）。
  lib.push({
    id: 'kusabi_gap_ring',
    family: 'A 初始化/直线',
    period_ticks: 90,
    waves: [
      {
        tick_offset: 0,
        command: makeCommand(9 /* kusabi_01 */, 0, 0, 12, 2.8),
        tmpl: makeTemplate(9, 0, 2.8),
        aim: AimMode.None,
        spin_per_tick_deg: 0,
      },
      {
        // 缺口真正错开：第二环在相位 45 发，而不是与第一环同一 tick 重叠。
        tick_offset: 45,
        command: makeCommand(9, 15, 0, 12, 2.8),
        tmpl: makeTemplate(9, 0, 2.8),
        aim: AimMode.None,
        spin_per_tick_deg: 0,
      },
    ],
  });

  // 3. arrow_aimed_fan —— A 族 + 自机瞄准：7 向扇形（arrow 弹种）。
  lib.push({
    id: 'arrow_aimed_fan',
    family: 'A 初始化/直线',
    period_ticks: 45,
    waves: [
      {
        tick_offset: 0,
        command: makeCommand(90 /* arrow_01 */, 90, 30, 7, 4.4),
        tmpl: makeTemplate(90, 0, 4.4),
        aim: AimMode.AtShip,
        spin_per_tick_deg: 0,
      },
    ],
  });

  // 4. ring_spiral —— A 族 + 螺旋：每 tick 旋转基础角（ring 弹种）。
  lib.push({
    id: 'ring_spiral',
    family: 'A 初始化/直线',
    period_ticks: 90,
    waves: [
      {
        tick_offset: 0,
        command: makeCommand(27 /* ring_01 */, 0, 0, 4, 3.4),
        tmpl: makeTemplate(27, 0, 3.4),
        aim: AimMode.None,
        spin_per_tick_deg: 13.0,
      },
      {
        tick_offset: 45,
        command: makeCommand(27, 180, 0, 4, 3.4),
        tmpl: makeTemplate(27, 0, 3.4),
        aim: AimMode.None,
        spin_per_tick_deg: 13.0,
      },
    ],
  });

  // 5. kome_homing —— D 族：朝自机限速转向（func2，kome 弹种）。
  {
    const tmpl = makeTemplate(45, 2, 2.6);
    tmpl.life = 1; // func2 需 life>=1 才转向
    tmpl.angle_init = 90.0; // A0：初始参考角
    tmpl.angle_acc = 3.0; // 单帧最大转角（度）
    lib.push({
      id: 'kome_homing',
      family: 'D 追踪/限速转向',
      period_ticks: 90,
      waves: [
        {
          tick_offset: 0,
          command: makeCommand(45, 90, 12, 2, 2.6),
          tmpl,
          aim: AimMode.None,
          spin_per_tick_deg: 0,
        },
        {
          // 紧扇形之后换一束 45° 外扩 30° 的宽扇形。
          tick_offset: 45,
          command: makeCommand(45, 45, 30, 2, 2.6),
          tmpl,
          aim: AimMode.None,
          spin_per_tick_deg: 0,
        },
      ],
    });
  }

  // 6. heart_sine_speed —— C 族：v = V1 + XC·sin(A0 + X·T)（func25，heart 弹种）。
  {
    const tmpl = makeTemplate(174 /* heart_01 */, 25, 3.0);
    tmpl.angle_init = 0.0;
    tmpl.xacc = 6.0; // X：正弦频率
    tmpl.xacc_cap = 1.5; // XC：正弦幅度
    // 第二波正弦起点推半周期（A0 = 180），并且发射角转 45°。
    const flipped = { ...tmpl, angle_init: 180.0 };
    lib.push({
      id: 'heart_sine_speed',
      family: 'C 正弦调速',
      period_ticks: 90,
      waves: [
        {
          tick_offset: 0,
          command: makeCommand(174, 90, 0, 8, 3.0),
          tmpl,
          aim: AimMode.None,
          spin_per_tick_deg: 0,
        },
        {
          tick_offset: 45,
          command: makeCommand(174, 135, 0, 8, 3.0),
          tmpl: flipped,
          aim: AimMode.None,
          spin_per_tick_deg: 0,
        },
      ],
    });
  }

  // 7. kunai_bounce —— F 族：边界反弹（func1，kunai 弹种）。
  lib.push({
    id: 'kunai_bounce',
    family: 'F 边界反弹',
    period_ticks: 90,
    waves: [
      {
        tick_offset: 0,
        command: makeCommand(126 /* kunai_01 */, 60, 20, 6, 3.2),
        tmpl: makeTemplate(126, 1, 3.2),
        aim: AimMode.None,
        spin_per_tick_deg: 0,
      },
      {
        tick_offset: 45,
        command: makeCommand(126, 120, 20, 6, 3.2),
        tmpl: makeTemplate(126, 1, 3.2),
        aim: AimMode.None,
        spin_per_tick_deg: 0,
      },
    ],
  });

  // 8. sizuku_sine_radius —— C 族：正弦半径（func81，sizuku 弹种）。
  {
    const tmpl = makeTemplate(99 /* sizuku_01 */, 81, 2.4);
    tmpl.angle_init = 0.5; // A0
    tmpl.f598 = 0.6; // F98
    tmpl.prev_angle = 4.0; // PA
    tmpl.xacc_cap = 1.2; // XC
    tmpl.p2 = 1;
    // 第二波半径正弦反向（A0 + pi），发射角转 45°。字面量与 C++ 一致。
    const mirrored = { ...tmpl, angle_init: 3.64159265358979 };
    lib.push({
      id: 'sizuku_sine_radius',
      family: 'C 正弦半径',
      period_ticks: 90,
      waves: [
        {
          tick_offset: 0,
          command: makeCommand(99, 90, 8, 5, 2.4),
          tmpl,
          aim: AimMode.None,
          spin_per_tick_deg: 0,
        },
        {
          tick_offset: 45,
          command: makeCommand(99, 135, 8, 5, 2.4),
          tmpl: mirrored,
          aim: AimMode.None,
          spin_per_tick_deg: 0,
        },
      ],
    });
  }

  // 9. stama_mirror —— F 族：按 P1 奇偶镜像（func32，stama 弹种）。
  {
    const tmpl = makeTemplate(36 /* stama_01 */, 32, 3.0);
    tmpl.angle_init = 45.0; // A0
    tmpl.p1 = 1; // 奇 → 镜像
    tmpl.p2 = 30; // 偏移
    // 第二波镜轴转四分之一圈（A0 = 135），发射角同时转 90°。
    const rotated = { ...tmpl, angle_init: 135.0 };
    lib.push({
      id: 'stama_mirror',
      family: 'F 镜像',
      period_ticks: 90,
      waves: [
        {
          tick_offset: 0,
          command: makeCommand(36, 0, 0, 10, 3.0),
          tmpl,
          aim: AimMode.None,
          spin_per_tick_deg: 0,
        },
        {
          tick_offset: 45,
          command: makeCommand(36, 90, 0, 10, 3.0),
          tmpl: rotated,
          aim: AimMode.None,
          spin_per_tick_deg: 0,
        },
      ],
    });
  }

  // 10. chou_four_dir —— E/L 族：四方向（func61，chou 弹种）。
  lib.push({
    id: 'chou_four_dir',
    family: 'E 周期瞄准',
    period_ticks: 45,
    waves: [
      {
        tick_offset: 0,
        command: makeCommand(156 /* chou_01 */, 0, 0, 4, 3.0),
        tmpl: makeTemplate(156, 61, 3.0),
        aim: AimMode.None,
        spin_per_tick_deg: 0,
      },
    ],
  });

  return lib;
}

/** 惰性单例（对应服务端 `BossRacePatternLibrary()` 的 `static`）。 */
let cachedLibrary: readonly PatternDef[] | null = null;

/** 10 个真实模式（只构造一次）。 */
export function bossRacePatternLibraryCached(): readonly PatternDef[] {
  if (cachedLibrary === null) {
    cachedLibrary = bossRacePatternLibrary();
  }
  return cachedLibrary;
}

/** 模式 id 列表，顺序即调度顺序（对应 `BossRacePatternIds()`）。 */
export function bossRacePatternIds(): readonly string[] {
  return bossRacePatternLibraryCached().map((def) => def.id);
}

// --- 发射器 -----------------------------------------------------------------

/**
 * 均匀铺满一圈、以 `base_angle_deg` 为中心对称分布的角序列（度，`[0,360)`）。
 * 对应服务端 `RadialAngles`。
 */
export function radialAngles(baseAngleDeg: number, spreadDeg: number, count: number): number[] {
  const angles: number[] = [];
  if (count <= 0) {
    return angles;
  }
  const step = 360 / count;
  let start = baseAngleDeg - spreadDeg;
  while (start < 0) {
    start += 360;
  }
  for (let i = 0; i < count; i += 1) {
    angles.push(normalizeDeg(start + step * i));
  }
  return angles;
}

/**
 * 执行一次齐射 —— 服务端 `EmitRadial`。
 *
 * 已解出（实测）：
 *  - `count <= 0` → 不发射；
 *  - `spawn_x/spawn_y == -1.0f`（哨兵）→ 用发射者坐标；
 *  - `step = 360.0 / count`；起始角 = `base_angle - spread`，向上补到 `>= 0`；
 *  - 每颗子弹的 `angle = NormalizeDeg(start + step * i)`。
 *
 * 返回的子弹**尚未做首帧 update**（`vx/vy` 仍为 0），与服务端一致。
 */
export function emitRadial(
  cmd: SpawnCommand,
  tmpl: BulletTemplate,
  ctx: EmitContext,
): BulletMotion[] {
  const bullets: BulletMotion[] = [];
  if (cmd.count <= 0) {
    return bullets;
  }

  // -1.0 哨兵 → 发射者坐标。
  const spawnX = cmd.spawnX === SPAWN_FOLLOW_EMITTER ? ctx.emitter_x : cmd.spawnX;
  const spawnY = cmd.spawnY === SPAWN_FOLLOW_EMITTER ? ctx.emitter_y : cmd.spawnY;

  const count = cmd.count;
  const step = 360 / count;
  let start = cmd.baseAngleDeg - cmd.spreadOrSpeed;
  while (start < 0) {
    start += 360;
  }

  const kind = tmpl.bullet_kind !== 0 ? tmpl.bullet_kind : cmd.bulletType;

  for (let i = 0; i < count; i += 1) {
    const b = createBulletMotion();
    b.x = spawnX;
    b.y = spawnY;
    b.bullet_kind = kind;
    b.bullet_func_no = tmpl.bullet_func_no;
    b.angle = normalizeDeg(start + step * i);

    // 构造快照（对应 EnemyBullet ctor 参数）。
    b.angle_init = tmpl.angle_init;
    b.speed_init = tmpl.speed !== 0 ? tmpl.speed : 0;
    b.angle_spd = tmpl.angle_spd;
    b.angle_acc = tmpl.angle_acc;
    b.f56c = tmpl.f56c;
    b.speed = tmpl.speed;
    b.accel = 0;
    b.speed_cap = tmpl.speed_cap;
    b.f598 = tmpl.f598;
    b.prev_angle = tmpl.prev_angle;
    b.spd_init2 = tmpl.speed;
    b.xacc = tmpl.xacc;
    b.xacc_cap = tmpl.xacc_cap;
    b.pf1 = 1;
    b.pf2 = tmpl.pf2;
    b.bullet_life = tmpl.bullet_life;
    b.life = tmpl.life;
    b.p1 = tmpl.p1;
    b.p2 = tmpl.p2;
    b.delay = tmpl.delay;
    b.rotate_flg = 0;
    b.hit_hantei = true;

    bullets.push(b);
  }
  return bullets;
}

/**
 * 计算某 tick 该模式应发射的全部子弹 —— 服务端 `EmitPatternTick`。
 *
 * 已应用角度 / 瞄准 / 螺旋，未做首帧 update。
 */
export function emitPatternTick(
  def: PatternDef,
  tick: number,
  ctx: EmitContext,
  targets: MotionTargets,
): BulletMotion[] {
  const out: BulletMotion[] = [];
  const period = def.period_ticks !== 0 ? def.period_ticks : 45;
  const phase = tick % period;

  for (const wave of def.waves) {
    if (wave.tick_offset !== phase) {
      continue;
    }
    const cmd: SpawnCommand = { ...wave.command };

    // 瞄准 / 螺旋：覆盖 base_angle_deg。
    if (wave.aim === AimMode.AtShip && targets.has_my_ship) {
      cmd.baseAngleDeg = f32(angleToPoint(ctx.emitter_x, ctx.emitter_y, targets.my_ship_x, targets.my_ship_y));
    } else if (wave.aim === AimMode.AtEnemy && targets.has_enemy) {
      cmd.baseAngleDeg = f32(angleToPoint(ctx.emitter_x, ctx.emitter_y, targets.enemy_x, targets.enemy_y));
    }
    if (wave.spin_per_tick_deg !== 0) {
      cmd.baseAngleDeg = f32(normalizeDeg(cmd.baseAngleDeg + wave.spin_per_tick_deg * tick));
    }

    const emitted = emitRadial(cmd, wave.tmpl, ctx);
    for (const bullet of emitted) {
      out.push(bullet);
    }
  }
  return out;
}
