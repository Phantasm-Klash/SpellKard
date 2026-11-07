/**
 * 弹幕差量重建（docs/danmaku-delta-wire.md §2 / §3 / §4，骨架阶段）。
 *
 * 本轮以「上一 tick 全量 bullets[] + Δ」为基线验证重建与全量逐位相等；
 * 完整的 `F_i` 基线递推（种子 + 共享上下文 C(t) + 事件流 E(t)）属下一轮，
 * 这里不硬做。`G_g(t) ≡ I`：group 变换是恒等 no-op，不编造编队机制。
 *
 * 纯函数、无任何外部状态。**任一输入异常返回 `null`**，调用方据此静默回落
 * 到全量 `bullets[]`，绝不把半重建的状态混进权威渲染（§4 回退铁律 2）。
 */
import type {
  BossRaceBullet,
  BossRaceBulletDeviation,
  BossRaceBulletDespawn,
  BossRaceBulletSpawn,
  BossRaceGroupMotion,
} from '../sim/boss_race';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 缺省（undefined）= 空数组；非数组 = 异常（null）。 */
function normalizeList<T>(value: T[] | undefined): T[] | null {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }
  return value;
}

/** 模板里存在但取值异常的字段 → null；缺省字段按 0 兜底。 */
function templateField(
  template: Record<string, unknown>,
  key: string,
  toMilli: boolean,
): number | null {
  const value = template[key];
  if (value === undefined) {
    return 0;
  }
  if (!isFiniteNumber(value)) {
    return null;
  }
  return toMilli ? Math.round(value * 1000) : Math.trunc(value);
}

interface DeviationValues {
  dx: number;
  dy: number;
  dvx: number;
  dvy: number;
}

/**
 * 以 spawn 模板为起点、应用 group 变换（恒等）、叠加 Δ（milli 整数）、
 * 移除 despawn，重建权威弹幕数组。
 *
 * @param previousBullets 基线（本轮 = 上一 tick 全量 bullets[]；下一轮换成 F_i 递推）
 * @returns 重建结果，或 `null` 表示任一输入异常需回落全量
 */
export function rebuildBulletsFromDelta(
  spawns: BossRaceBulletSpawn[] | undefined,
  deviations: BossRaceBulletDeviation[] | undefined,
  despawns: BossRaceBulletDespawn[] | undefined,
  groupMotion: BossRaceGroupMotion[] | undefined,
  previousBullets: BossRaceBullet[],
): BossRaceBullet[] | null {
  const spawnList = normalizeList(spawns);
  const deviationList = normalizeList(deviations);
  const despawnList = normalizeList(despawns);
  const groupList = normalizeList(groupMotion);
  if (spawnList === null || deviationList === null || despawnList === null ||
      groupList === null || !Array.isArray(previousBullets)) {
    return null;
  }

  // 本版 G_g ≡ I：group 变换恒等。任何非恒等参数都超出本版范围 → null，
  // 让调用方回落全量（§8 明确不在本版范围）。
  for (const entry of groupList) {
    const g = entry as unknown as Record<string, unknown>;
    if (!isFiniteNumber(g.groupId) || !isFiniteNumber(g.tx) ||
        !isFiniteNumber(g.ty) || !isFiniteNumber(g.phi)) {
      return null;
    }
    if (g.tx !== 0 || g.ty !== 0 || g.phi !== 0) {
      return null;
    }
  }

  // 基线：逐项浅拷贝，建立 id → 索引；重复 id 视为异常。
  const rebuilt: BossRaceBullet[] = [];
  const indexById = new Map<string, number>();
  for (const bullet of previousBullets) {
    const b = bullet as unknown as Record<string, unknown>;
    if (typeof b.bulletId !== 'string' || indexById.has(b.bulletId)) {
      return null;
    }
    indexById.set(b.bulletId, rebuilt.length);
    rebuilt.push({ ...bullet });
  }

  // despawns：校验引用存在（引用不存在的弹 = 异常），收集待删 id。
  const despawnIds = new Set<string>();
  for (const entry of despawnList) {
    const d = entry as unknown as Record<string, unknown>;
    if (typeof d.bulletId !== 'string' || !indexById.has(d.bulletId)) {
      return null;
    }
    despawnIds.add(d.bulletId);
  }

  // deviations：Δ 为 milli 整数；引用不存在 / 重复 Δ 视为异常。
  const deviationById = new Map<string, DeviationValues>();
  for (const entry of deviationList) {
    const d = entry as unknown as Record<string, unknown>;
    if (typeof d.bulletId !== 'string' || !indexById.has(d.bulletId)) {
      return null;
    }
    if (!isFiniteNumber(d.dx) || !isFiniteNumber(d.dy) ||
        !isFiniteNumber(d.dvx) || !isFiniteNumber(d.dvy)) {
      return null;
    }
    if (deviationById.has(d.bulletId)) {
      return null;
    }
    deviationById.set(d.bulletId, { dx: d.dx, dy: d.dy, dvx: d.dvx, dvy: d.dvy });
  }

  // spawns：从模板构造新弹；Template 像素浮点在边界按 ToMilli 转 milli。
  // id 不得与基线或其他 spawn 重复（发号权归服务端，双端不得各自发号）。
  const newBullets: BossRaceBullet[] = [];
  const seenSpawnIds = new Set<string>();
  for (const entry of spawnList) {
    const s = entry as unknown as Record<string, unknown>;
    if (typeof s.bulletId !== 'string' || typeof s.ownerPlayerId !== 'string') {
      return null;
    }
    if (!isFiniteNumber(s.t0) || !isFiniteNumber(s.p) ||
        !isFiniteNumber(s.q) || !isFiniteNumber(s.groupId)) {
      return null;
    }
    if (!isRecord(s.template)) {
      return null;
    }
    if (indexById.has(s.bulletId) || seenSpawnIds.has(s.bulletId)) {
      return null;
    }
    const xMilli = templateField(s.template, 'x', true);
    const yMilli = templateField(s.template, 'y', true);
    const vxMilli = templateField(s.template, 'vx', true);
    const vyMilli = templateField(s.template, 'vy', true);
    const radiusMilli = templateField(s.template, 'hit_dis', true);
    const bulletKind = templateField(s.template, 'bullet_kind', false);
    const motionFunc = templateField(s.template, 'bullet_func_no', false);
    if (xMilli === null || yMilli === null || vxMilli === null || vyMilli === null ||
        radiusMilli === null || bulletKind === null || motionFunc === null) {
      return null;
    }
    seenSpawnIds.add(s.bulletId);
    newBullets.push({
      bulletId: s.bulletId,
      ownerPlayerId: s.ownerPlayerId,
      xMilli,
      yMilli,
      vxMilli,
      vyMilli,
      radiusMilli,
      // §4 template 是 BulletMotion 静态参数集，不含 pattern_id；骨架留空。
      patternId: '',
      bulletKind,
      motionFunc,
    });
  }

  // 应用 despawn（跳过）+ deviation（叠加 Δ），保持基线相对顺序；group 恒等 no-op。
  const result: BossRaceBullet[] = [];
  for (const bullet of rebuilt) {
    if (despawnIds.has(bullet.bulletId)) {
      continue;
    }
    const delta = deviationById.get(bullet.bulletId);
    if (delta !== undefined) {
      result.push({
        ...bullet,
        xMilli: bullet.xMilli + delta.dx,
        yMilli: bullet.yMilli + delta.dy,
        vxMilli: bullet.vxMilli + delta.dvx,
        vyMilli: bullet.vyMilli + delta.dvy,
      });
    } else {
      result.push(bullet);
    }
  }
  result.push(...newBullets);
  return result;
}

/** 重建结果与全量逐位比较（不依赖属性顺序，含可选扩展字段）。 */
const BULLET_COMPARE_KEYS: ReadonlyArray<keyof BossRaceBullet> = [
  'bulletId', 'ownerPlayerId', 'xMilli', 'yMilli', 'vxMilli', 'vyMilli',
  'radiusMilli', 'patternId', 'bulletKind', 'motionFunc', 'angleDeg',
  'chainId', 'generation', 'hidden',
];

export function bulletsEqual(a: BossRaceBullet[], b: BossRaceBullet[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    for (const key of BULLET_COMPARE_KEYS) {
      if (a[i][key] !== b[i][key]) {
        return false;
      }
    }
  }
  return true;
}
