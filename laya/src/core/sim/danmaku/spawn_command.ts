/**
 * `Enemy::CreateBulletCommand`（96 字节 POD）的 TS 镜像。
 *
 * 布局与发射算法来自 `rev/patterns/create_bullet_command.md`（实测）：
 * 一次齐射 = 一个 Command；敌机在正确 tick 下发 Command，弹幕时间线 = Command 列表。
 *
 * 字段语义见结构体注释；角度单位一律为**度**。
 *
 * 说明：`spawnX/spawnY == -1.0` 为「跟随发射者」哨兵；`count == 0` 直接不发射。
 */

/** 结构体字节大小（AArch64 `sizeof`，含对齐填充）。 */
export const SPAWN_COMMAND_SIZE_BYTES = 96;

/** 跟随发射者坐标的哨兵值。 */
export const SPAWN_FOLLOW_EMITTER = -1.0;

/**
 * `Enemy::CreateBulletCommand` 的 TS 结构（字段名后缀 = 原版字节偏移）。
 */
export interface SpawnCommand {
  /** +0 `kEnemyBullet` 枚举值。 */
  bulletType: number;
  /** +4 图集帧号（动画帧）。 */
  frameIndex: number;
  /** +8 生成点 X；`-1` = 用敌机当前 X。 */
  spawnX: number;
  /** +12 生成点 Y；`-1` = 用敌机当前 Y。 */
  spawnY: number;
  /** +16 bool（传给 `spriteWithFile` 第 5 参）。 */
  flag16: boolean;
  /** +20 基础角度（度）。 */
  baseAngleDeg: number;
  /** +24 → `spriteWithFile` p6。 */
  f24: number;
  /** +28 → p7。 */
  f28: number;
  /** +32 → p8。 */
  f32: number;
  /** +36 → p9。 */
  f36: number;
  /** +40 → p10。 */
  f40: number;
  /** +44 本次发射子弹数量（0 → 直接返回）。 */
  count: number;
  /** +48 张角/速度（参与起始角计算）。 */
  spreadOrSpeed: number;
  /** +52 → p11。 */
  s52: number;
  /** +54 → p12。 */
  s54: number;
  /** +56 → p13。 */
  s56: number;
  /** +60 → p14。 */
  f60: number;
  /** +64 → p15。 */
  f64: number;
  /** +68 → p16。 */
  f68: number;
  /** +72 → p17。 */
  f72: number;
  /** +76 → p18。 */
  f76: number;
  /** +80 → p19。 */
  f80: number;
  /** +84 → p20。 */
  s84: number;
  /** +86 → p21。 */
  s86: number;
  /** +88 → p22。 */
  s88: number;
  /** +90 → p23。 */
  s90: number;
  /** +92 → p24。 */
  s92: number;
  /** +94 → p25。 */
  s94: number;
}

/** 创建一份默认 Command（全部字段置 0，`spawn` 跟随发射者）。 */
export function createSpawnCommand(overrides: Partial<SpawnCommand> = {}): SpawnCommand {
  return {
    bulletType: 0,
    frameIndex: 0,
    spawnX: SPAWN_FOLLOW_EMITTER,
    spawnY: SPAWN_FOLLOW_EMITTER,
    flag16: false,
    baseAngleDeg: 0,
    f24: 0,
    f28: 0,
    f32: 0,
    f36: 0,
    f40: 0,
    count: 0,
    spreadOrSpeed: 0,
    s52: 0,
    s54: 0,
    s56: 0,
    f60: 0,
    f64: 0,
    f68: 0,
    f72: 0,
    f76: 0,
    f80: 0,
    s84: 0,
    s86: 0,
    s88: 0,
    s90: 0,
    s92: 0,
    s94: 0,
    ...overrides,
  };
}

/** 把小端序 96 字节缓冲编码进 `view`（默认从 0 开始）。 */
export function encodeSpawnCommand(command: SpawnCommand, view?: DataView, offset = 0): DataView {
  const target = view ?? new DataView(new ArrayBuffer(SPAWN_COMMAND_SIZE_BYTES));
  const o = offset;
  target.setInt32(o + 0, command.bulletType, true);
  target.setInt32(o + 4, command.frameIndex, true);
  target.setFloat32(o + 8, command.spawnX, true);
  target.setFloat32(o + 12, command.spawnY, true);
  target.setUint8(o + 16, command.flag16 ? 1 : 0);
  // +17..19 填充
  target.setFloat32(o + 20, command.baseAngleDeg, true);
  target.setFloat32(o + 24, command.f24, true);
  target.setFloat32(o + 28, command.f28, true);
  target.setFloat32(o + 32, command.f32, true);
  target.setFloat32(o + 36, command.f36, true);
  target.setFloat32(o + 40, command.f40, true);
  target.setInt16(o + 44, command.count, true);
  // +46 填充
  target.setFloat32(o + 48, command.spreadOrSpeed, true);
  target.setInt16(o + 52, command.s52, true);
  target.setInt16(o + 54, command.s54, true);
  target.setInt16(o + 56, command.s56, true);
  // +58..59 填充
  target.setFloat32(o + 60, command.f60, true);
  target.setFloat32(o + 64, command.f64, true);
  target.setFloat32(o + 68, command.f68, true);
  target.setFloat32(o + 72, command.f72, true);
  target.setFloat32(o + 76, command.f76, true);
  target.setFloat32(o + 80, command.f80, true);
  target.setInt16(o + 84, command.s84, true);
  target.setInt16(o + 86, command.s86, true);
  target.setInt16(o + 88, command.s88, true);
  target.setInt16(o + 90, command.s90, true);
  target.setInt16(o + 92, command.s92, true);
  target.setInt16(o + 94, command.s94, true);
  return target;
}

/** 从小端序缓冲解码（默认从 0 开始）。 */
export function decodeSpawnCommand(view: DataView, offset = 0): SpawnCommand {
  const o = offset;
  return {
    bulletType: view.getInt32(o + 0, true),
    frameIndex: view.getInt32(o + 4, true),
    spawnX: view.getFloat32(o + 8, true),
    spawnY: view.getFloat32(o + 12, true),
    flag16: view.getUint8(o + 16) !== 0,
    baseAngleDeg: view.getFloat32(o + 20, true),
    f24: view.getFloat32(o + 24, true),
    f28: view.getFloat32(o + 28, true),
    f32: view.getFloat32(o + 32, true),
    f36: view.getFloat32(o + 36, true),
    f40: view.getFloat32(o + 40, true),
    count: view.getInt16(o + 44, true),
    spreadOrSpeed: view.getFloat32(o + 48, true),
    s52: view.getInt16(o + 52, true),
    s54: view.getInt16(o + 54, true),
    s56: view.getInt16(o + 56, true),
    f60: view.getFloat32(o + 60, true),
    f64: view.getFloat32(o + 64, true),
    f68: view.getFloat32(o + 68, true),
    f72: view.getFloat32(o + 72, true),
    f76: view.getFloat32(o + 76, true),
    f80: view.getFloat32(o + 80, true),
    s84: view.getInt16(o + 84, true),
    s86: view.getInt16(o + 86, true),
    s88: view.getInt16(o + 88, true),
    s90: view.getInt16(o + 90, true),
    s92: view.getInt16(o + 92, true),
    s94: view.getInt16(o + 94, true),
  };
}

/*
 * NOTE: the radial emitter that used to live here (`emitRadial` + its
 * `EmittedBullet` output type + a `f24`-driven fan variant) has been **removed**.
 * It was a client-local approximation of `Enemy::createBullets1` — 20 of the
 * struct's 28 fields were passed through untouched and the speed was guessed from
 * `spreadOrSpeed`. The authoritative emitter now lives in `pattern_timeline.ts`
 * (`emitRadial(cmd, tmpl, ctx)` / `emitPatternTick`), mirroring the C++
 * `src/danmaku/emitter.cpp` + `src/danmaku/pattern_timeline.cpp` field for field.
 * Keeping two emitters was exactly how the client and server drifted apart.
 */
