/**
 * 弹幕基线重建器 —— docs/danmaku-delta-wire.md §10.3 / §10.4。
 *
 * 与上一轮的 `rebuildBulletsFromDelta`（骨架：上一 tick 全量 + Δ）不同，本模块
 * **真正从 `spawn` 事件递推 `F_i`**：每颗弹在其出生 tick 由 `createBulletMotion`
 * 建完整 `BulletMotion`，之后每 tick 用与 `BossRaceSimulation.advanceBullets`
 * 逐位镜像的顺序推进（RNG → updateBulletMotion → pos += v → t += 1），直到
 * despawn / 出界。稳态下 `Δ ≡ 0`（§10.1），权威轨迹就是这条 `Update` 链。
 *
 * 纯 TS：零 Laya / 网络依赖，只依赖 `core/math/*` 与 `core/sim/*` 的纯函数与常量。
 * 换算（`toMilli` / `llround` / `toPixels`）全部复用 `float_lib`，与
 * `BossRaceSimulation.snapshot()` / `canonicalStateHash()` 同一套，禁止另写一套。
 *
 * 任一输入异常（非有限数、id 重复 / 悬空、players 缺 owner、boss 坐标异常、
 * group 非恒等……）→ `applyTick` 返回 `null`，由调用方静默回落全量 / 空数组
 * （§4 回退铁律 2）。校验全部在「提交」前完成，返回 `null` 时不修改内部状态。
 */
import type { BossRaceSeed } from '../math/boss_race_seed';
import {
  llround,
  MILLI_PER_PIXEL,
  SCREEN_CENTER_X_PX,
  SCREEN_CENTER_Y_PX,
  SCREEN_H_PX,
  SCREEN_W_PX,
  toMilli,
  toPixels,
} from '../math/float_lib';
import {
  createBulletMotion,
  createMotionTargets,
  DeterministicRng,
  updateBulletMotion,
  type BulletMotion,
} from '../sim/danmaku/bullet_motion';
import { BOSS_ORIGIN_X_MILLI, BOSS_ORIGIN_Y_MILLI } from '../sim/boss_race';
import type {
  BossRaceBullet,
  BossRaceBulletDeviation,
  BossRaceBulletDespawn,
  BossRaceBulletSpawn,
  BossRaceGroupMotion,
  BossRaceSnapshot,
} from '../sim/boss_race';

// --- 校验小工具 -------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 缺省（undefined/null）= 空数组；非数组 = 异常（null）。 */
function normalizeList<T>(value: readonly T[] | undefined | null): readonly T[] | null {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }
  return value;
}

/**
 * `BulletMotion` 的 32 个数值字段（与 `bullet_motion.ts:130-198` 逐字段对齐）。
 * 模板里这些键以外的字段按「前向兼容」忽略；缺失字段由 `createBulletMotion`
 * 默认补齐（指令①）。
 */
const MOTION_NUMERIC_KEYS = [
  'x', 'y', 'vx', 'vy', 'angle', 'speed', 'accel', 't', 'life',
  'angle_spd', 'angle_acc', 'f56c', 'speed_cap', 'angle_init', 'speed_init',
  'f598', 'prev_angle', 'spd_init2', 'xacc', 'xacc_cap', 'pf1', 'pf2',
  'bullet_kind', 'rotate_flg', 'bullet_life', 'bullet_loop', 'delay',
  'vanish_delay', 'p1', 'p2', 'bullet_func_no', 'hit_dis',
] as const;

/**
 * 由 spawn.template 建 `BulletMotion`。
 * - 所有 number 值必须有限（`NaN` / `±Infinity` → null）；
 * - 只接受 number / boolean 值，其它类型 → null；
 * - `hit_hantei`（C++ bool）额外接受 0/1 数字；
 * - 缺失字段交给 `createBulletMotion` 补齐，绝不在这里编默认值。
 */
function motionFromTemplate(template: unknown): BulletMotion | null {
  if (!isRecord(template)) {
    return null;
  }
  for (const value of Object.values(template)) {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return null;
      }
    } else if (typeof value !== 'boolean') {
      return null;
    }
  }
  const overrides: Record<string, number | boolean> = {};
  for (const key of MOTION_NUMERIC_KEYS) {
    const value = template[key];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }
    overrides[key] = value;
  }
  const hitHantei = template.hit_hantei;
  if (hitHantei !== undefined) {
    if (typeof hitHantei === 'boolean') {
      overrides.hit_hantei = hitHantei;
    } else if (typeof hitHantei === 'number' && Number.isFinite(hitHantei)) {
      overrides.hit_hantei = hitHantei !== 0;
    } else {
      return null;
    }
  }
  return createBulletMotion(overrides as Partial<BulletMotion>);
}

/**
 * 出界剔除谓词 —— 与 `BossRaceSimulation.keepsBullet`（`boss_race.ts:1883-1886`）
 * 逐字镜像（该方法是 private，无法直接复用）：在**像素**屏幕盒上判定，
 * 不是 milli、不是玩家 arena。
 */
function keepsBullet(m: BulletMotion): boolean {
  return !(m.x < -20 || m.x > SCREEN_W_PX + 20 || m.y < -20 || m.y > SCREEN_H_PX + 20);
}

// --- 内部状态 ---------------------------------------------------------------

interface LiveEntry {
  bulletId: string;
  ownerPlayerId: string;
  /** pattern_index，RNG 第三参。 */
  p: number;
  /** spawn_index，RNG 第四参。 */
  q: number;
  motion: BulletMotion;
}

interface DeviationValues {
  dx: number;
  dy: number;
  dvx: number;
  dvy: number;
}

/** 本 tick 由 `C(t)` 派生的共享上下文（像素坐标）。 */
interface TargetsContext {
  enemyX: number;
  enemyY: number;
  /** playerId → 像素自机坐标。 */
  shipByPlayer: Map<string, { x: number; y: number }>;
}

export interface BulletReconstructorConfig {
  matchSeed: BossRaceSeed;
  /** 屏幕中心 X（px），默认 `SCREEN_CENTER_X_PX`；换算与出界都用它。 */
  screenCenterX?: number;
  /** 屏幕中心 Y（px），默认 `SCREEN_CENTER_Y_PX`。 */
  screenCenterY?: number;
}

// --- 重建器 -----------------------------------------------------------------

/**
 * 从 spawn 事件流递推 `F_i` 的**有状态**重建器。
 *
 * ★ MotionTargets 来源与对齐依据（§10.3）：
 *  - `enemy_x/y`（Boss 发射点）：优先取快照 `boss.xMilli/yMilli`（服务端下发的
 *    权威发射点 = `BOSS_ORIGIN + bossOffsetForTick(tick)`），经
 *    `screenCenter + toPixels(bossXMilli)` 折回像素；快照不带 `boss`（老服务端 /
 *    `defaultBossRaceConfig` 本地对照）时退回静态发射点
 *    `screenCenter + toPixels(BOSS_ORIGIN_*)`，即 `bossOffset = 0`。
 *    与 `BossRaceSimulation.advanceBullets`（`boss_race.ts:1903-1905`）的
 *    `SCREEN_CENTER + toPixels(BOSS_ORIGIN + bossOffset)` 逐位一致。
 *  - `my_ship_x/y`：取该弹 `ownerPlayerId` 在 `players[]` 里的像素坐标
 *    `screenCenter + toPixels(player.xMilli)`，与 `advanceBullets`
 *    （`boss_race.ts:1927-1932` `shipXpx(owner.xMilli)`）逐位一致。owner 缺失
 *    → 输入异常返回 `null`（服务端按玩家发射，正常数据里 owner 必在 players 中）。
 *  - `has_enemy` 恒 true、`global_state` 保持 `createMotionTargets` 默认 -1，
 *    与 `advanceBullets` 的 `createMotionTargets({ has_enemy, enemy_x, enemy_y })`
 *    一致。
 *
 * ★ 链式分裂（func31）：真实子代由宿主（服务端）生成，本重建器**不自行分裂**，
 *   子代以 `bullet_spawns` 事件下发（§10.2 在 `AdvanceBullets` 登记），
 *   与普通出生弹走同一条 `createBulletMotion` 路径。
 */
export class BulletReconstructor {
  private readonly matchSeed: BossRaceSeed;
  private readonly screenCenterX: number;
  private readonly screenCenterY: number;
  /** 插入顺序 = 服务端发号顺序（`b<N>` 递增），与 `snapshot().bullets` 顺序一致。 */
  private readonly live = new Map<string, LiveEntry>();

  constructor(config: BulletReconstructorConfig) {
    this.matchSeed = config.matchSeed;
    this.screenCenterX = config.screenCenterX ?? SCREEN_CENTER_X_PX;
    this.screenCenterY = config.screenCenterY ?? SCREEN_CENTER_Y_PX;
  }

  /** 当前存活弹数（测试 / 跨局清理用）。 */
  get size(): number {
    return this.live.size;
  }

  /** 清空全部存活弹（重连 / 新局 / 重建失败后丢弃半状态）。 */
  reset(): void {
    this.live.clear();
  }

  /**
   * 消费一帧快照的 spawn / deviation / despawn / group_motion，把内部 `F_i`
   * 推进到该 tick 并输出 `BossRaceBullet[]`。
   *
   * 顺序（与 `BossRaceSimulation.tick()` → `spawnBulletsForTick` →
   * `advanceBullets` 一致）：consume spawns → 组 `C(t)` → 逐弹推进 →
   * despawn 删除 → 出界剔除 → 输出换算（含 Δ 叠加）。
   *
   * @returns 重建结果；`null` = 任一输入异常需回落（绝不抛）。
   */
  applyTick(snapshot: BossRaceSnapshot): BossRaceBullet[] | null {
    const tick = snapshot.tick;
    if (!isFiniteNumber(tick)) {
      return null;
    }
    const ctx = this.buildTargetsContext(snapshot);
    if (ctx === null) {
      return null;
    }

    const spawns = normalizeList(snapshot.bulletSpawns);
    const deviations = normalizeList(snapshot.bulletDeviations);
    const despawns = normalizeList(snapshot.bulletDespawns);
    const groupMotion = normalizeList(snapshot.groupMotion);
    if (spawns === null || deviations === null || despawns === null || groupMotion === null) {
      return null;
    }

    // 本版 G_g ≡ I（§8）：任何非恒等 group 变换超出范围 → null 回落。
    for (const g of groupMotion as readonly BossRaceGroupMotion[]) {
      if (!isFiniteNumber(g.groupId) || !isFiniteNumber(g.tx) ||
          !isFiniteNumber(g.ty) || !isFiniteNumber(g.phi)) {
        return null;
      }
      if (g.tx !== 0 || g.ty !== 0 || g.phi !== 0) {
        return null;
      }
    }

    // ---- 阶段 A：纯校验 + 构造待提交对象（不修改 this.live） ----------------
    const newEntries: LiveEntry[] = [];
    const seenSpawnIds = new Set<string>();
    for (const raw of spawns as readonly BossRaceBulletSpawn[]) {
      const s = raw as unknown as Record<string, unknown>;
      if (typeof s.bulletId !== 'string' || typeof s.ownerPlayerId !== 'string') {
        return null;
      }
      if (!isFiniteNumber(s.t0) || !isFiniteNumber(s.p) ||
          !isFiniteNumber(s.q) || !isFiniteNumber(s.groupId)) {
        return null;
      }
      const motion = motionFromTemplate(s.template);
      if (motion === null) {
        return null;
      }
      // id 重复（发号权归服务端，双端不得各自发号）→ null。
      if (this.live.has(s.bulletId) || seenSpawnIds.has(s.bulletId)) {
        return null;
      }
      // players 缺该弹 owner → null（§10.3 输入异常）。
      if (!ctx.shipByPlayer.has(s.ownerPlayerId)) {
        return null;
      }
      seenSpawnIds.add(s.bulletId);
      newEntries.push({
        bulletId: s.bulletId,
        ownerPlayerId: s.ownerPlayerId,
        p: s.p,
        q: s.q,
        motion,
      });
    }

    // deviation / despawn 的合法引用集合 = 已有存活弹 + 本 tick 新生弹。
    const knownIds = new Set<string>(this.live.keys());
    for (const id of seenSpawnIds) {
      knownIds.add(id);
    }

    const deviationById = new Map<string, DeviationValues>();
    for (const raw of deviations as readonly BossRaceBulletDeviation[]) {
      const d = raw as unknown as Record<string, unknown>;
      if (typeof d.bulletId !== 'string' || !knownIds.has(d.bulletId)) {
        return null;
      }
      if (!isFiniteNumber(d.dx) || !isFiniteNumber(d.dy) ||
          !isFiniteNumber(d.dvx) || !isFiniteNumber(d.dvy)) {
        return null;
      }
      if (deviationById.has(d.bulletId)) {
        return null;
      }
      deviationById.set(d.bulletId, {
        dx: d.dx, dy: d.dy, dvx: d.dvx, dvy: d.dvy,
      });
    }

    const despawnIds = new Set<string>();
    for (const raw of despawns as readonly BossRaceBulletDespawn[]) {
      const d = raw as unknown as Record<string, unknown>;
      if (typeof d.bulletId !== 'string') {
        return null;  // 形状异常（id 不是字符串）仍拒
      }
      // ★ 悬空 despawn 必须**幂等忽略**，不能判异常。实机链路里它必然出现：
      //   - 客户端可能从对局中途接入 / 丢首包，没见过那颗弹；
      //   - 客户端 `keepsBullet` 与服务端出界剔除可能差一帧，本地已先删掉；
      //   - 上一次重建失败被 reset 后，服务端仍会补发之前 tick 的删除。
      //   旧实现在这里 return null → 调用方 reset() → live 恒空 → 下一帧继续
      //   悬空 → 永久卡死（实机 `authBullets:0 / rebuildMismatch:true`）。
      //   「删除一个不存在的 id」本就是 no-op，不影响任何权威状态。
      if (!knownIds.has(d.bulletId)) {
        continue;
      }
      despawnIds.add(d.bulletId);
    }

    // ---- 阶段 B：提交（此后不再返回 null） --------------------------------
    for (const entry of newEntries) {
      this.live.set(entry.bulletId, entry);
    }

    // 逐弹推进：RNG(seed, tick, p, q) → updateBulletMotion → pos += v → t += 1。
    // updateBulletMotion 内部顺序（delay → 角积分 → bulletFunc → integrateVelocity）
    // 不移动位置、不递增 t，宿主补齐这两步，与 `boss_race.ts:1934-1938` 一致。
    for (const entry of this.live.values()) {
      const targets = createMotionTargets({
        has_enemy: true,
        enemy_x: ctx.enemyX,
        enemy_y: ctx.enemyY,
      });
      const ship = ctx.shipByPlayer.get(entry.ownerPlayerId);
      if (ship !== undefined) {
        targets.has_my_ship = true;
        targets.my_ship_x = ship.x;
        targets.my_ship_y = ship.y;
      }
      const rng = new DeterministicRng(this.matchSeed, tick, entry.p, entry.q);
      updateBulletMotion(entry.motion, targets, rng);
      entry.motion.x += entry.motion.vx;
      entry.motion.y += entry.motion.vy;
      entry.motion.t += 1;
    }

    // despawn 删除（权威删除，与运动学无关）。
    for (const id of despawnIds) {
      this.live.delete(id);
    }
    // 出界剔除（与 `advanceBullets` 第三趟同款谓词，像素盒）。
    const culled: string[] = [];
    for (const [id, entry] of this.live) {
      if (!keepsBullet(entry.motion)) {
        culled.push(id);
      }
    }
    for (const id of culled) {
      this.live.delete(id);
    }

    // 输出：复用 `snapshot()` 同一套 toMilli / llround；Δ 是 milli 整数，
    // 「先换算再加」避免像素浮点与 milli 整数混用（§10.3 步骤③）。
    const result: BossRaceBullet[] = [];
    for (const entry of this.live.values()) {
      const m = entry.motion;
      const delta = deviationById.get(entry.bulletId);
      result.push({
        bulletId: entry.bulletId,
        ownerPlayerId: entry.ownerPlayerId,
        xMilli: toMilli(m.x - this.screenCenterX) + (delta?.dx ?? 0),
        yMilli: toMilli(m.y - this.screenCenterY) + (delta?.dy ?? 0),
        vxMilli: toMilli(m.vx) + (delta?.dvx ?? 0),
        vyMilli: toMilli(m.vy) + (delta?.dvy ?? 0),
        radiusMilli: llround(m.hit_dis * MILLI_PER_PIXEL),
        patternId: '',
        bulletKind: m.bullet_kind,
        motionFunc: m.bullet_func_no,
        angleDeg: m.angle,
      });
    }
    return result;
  }

  /** 由 `players[]` / `boss` 重建本 tick 的 `C(t)`（像素）。 */
  private buildTargetsContext(snapshot: BossRaceSnapshot): TargetsContext | null {
    const players = snapshot.players;
    if (!Array.isArray(players)) {
      return null;
    }
    const shipByPlayer = new Map<string, { x: number; y: number }>();
    for (const raw of players) {
      const p = raw as unknown as Record<string, unknown>;
      if (typeof p.playerId !== 'string' || !isFiniteNumber(p.xMilli) || !isFiniteNumber(p.yMilli)) {
        return null;
      }
      if (shipByPlayer.has(p.playerId)) {
        return null;
      }
      shipByPlayer.set(p.playerId, {
        x: this.screenCenterX + toPixels(p.xMilli),
        y: this.screenCenterY + toPixels(p.yMilli),
      });
    }

    let bossXMilli = BOSS_ORIGIN_X_MILLI;
    let bossYMilli = BOSS_ORIGIN_Y_MILLI;
    const boss = snapshot.boss;
    if (boss !== undefined && boss !== null) {
      const b = boss as unknown as Record<string, unknown>;
      if (!isFiniteNumber(b.xMilli) || !isFiniteNumber(b.yMilli)) {
        return null;
      }
      bossXMilli = b.xMilli;
      bossYMilli = b.yMilli;
    }
    return {
      enemyX: this.screenCenterX + toPixels(bossXMilli),
      enemyY: this.screenCenterY + toPixels(bossYMilli),
      shipByPlayer,
    };
  }
}

// --- 模块级默认实例（无参 decode 的便利路径 / 跨 tick 状态宿主） --------------

/**
 * 模块级默认实例。`decodeBossRaceSnapshot` 未显式传入实例时使用。
 * 未配置（null）→ delta wire 且 bullets[] 缺席时安全回落到 `bullets=[]` +
 * `deltaRebuildMismatch=true`，绝不拿错误种子重建后混进渲染。
 *
 * 生命周期：调用方拿到票据 `matchSeed` 后 `configureDefaultBulletReconstructor`
 * （构造新实例 = 隐含 reset）；重连 / 新局再次 configure 或 `reset...()`。
 * 跨 tick 状态在「连续 delta 帧」间由同一实例自然保持。
 */
let defaultReconstructor: BulletReconstructor | null = null;

export function getDefaultBulletReconstructor(): BulletReconstructor | null {
  return defaultReconstructor;
}

export function configureDefaultBulletReconstructor(
  config: BulletReconstructorConfig | null,
): void {
  defaultReconstructor = config === null ? null : new BulletReconstructor(config);
}

export function resetDefaultBulletReconstructor(): void {
  defaultReconstructor?.reset();
}
