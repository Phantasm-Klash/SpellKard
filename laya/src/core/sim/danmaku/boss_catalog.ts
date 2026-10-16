/**
 * Boss 目录 —— C++ `PhK-BattleServer/src/danmaku/boss_catalog.cpp` 的逐行镜像。
 *
 * 归属与组合理由见 C++ 侧注释（boss_catalog.hpp）：`hui`（辉）= 1.40 舞台表
 * 第 5 项「輝」（libMyGame.so .rodata 0xac595f，7 项：妖永風地輝紺怪）；
 * `tian`（天）名称串不在 1.40 二进制（成就「通关［紅〜天］」与开发者注释证实
 * 「天」关卡存在），按任务书回退路径从已移植的 10 个 TNA pattern 库组合。
 * 数值（HP / 幅度 / 周期 / 波次数）三引擎必须完全一致。
 *
 * ★ 顺序即目录顺序，新增 boss 只允许追加，不得重排。
 */

export enum BossMovement {
  Static = 0,
  SwayX = 1,
  BobY = 2,
}

export interface BossMovementSpec {
  kind: BossMovement;
  /** 幅度（milli，> 0 时生效）。 */
  amplitudeMilli: number;
  /** 往复周期（tick）。 */
  periodTicks: number;
  /** = periodTicks / 2（预算值，与 C++ 一致避免重复除）。 */
  halfTicks: number;
}

/** 一个阶段：连续重复某个 pattern 若干波（每波 = 该 pattern 的 period_ticks）。 */
export interface BossPatternPhase {
  /** 库内模式 id（见 pattern_timeline.ts 的 10 个模式）。 */
  patternId: string;
  /** 连续波次数（>= 1）。 */
  waves: number;
}

export interface BossCatalogEntry {
  id: string;
  display: string;
  bossMaxHp: number;
  movement: BossMovementSpec;
  /** 有序阶段组（循环）。 */
  phases: readonly BossPatternPhase[];
}

/**
 * 权威目录（顺序即目录顺序）。
 *
 * 阶段组的 pattern 全部取自已移植库（kome_ring / kusabi_gap_ring /
 * arrow_aimed_fan / ring_spiral / kome_homing / heart_sine_speed / kunai_bounce /
 * sizuku_sine_radius / stama_mirror / chou_four_dir）。
 */
export const BOSS_CATALOG: readonly BossCatalogEntry[] = [
  {
    // tian（天）—— 天 stage 在原作处于流程后段，「天」意象 = 高天原式的整圆
    // 齐射与追踪压迫；水平往复移动（「天」的横向广袒）。
    id: 'tian',
    display: '天',
    bossMaxHp: 20000,
    movement: { kind: BossMovement.SwayX, amplitudeMilli: 60000, periodTicks: 600, halfTicks: 300 },
    phases: [
      { patternId: 'kome_ring', waves: 4 },
      { patternId: 'arrow_aimed_fan', waves: 3 },
      { patternId: 'ring_spiral', waves: 4 },
      { patternId: 'kome_homing', waves: 3 },
      { patternId: 'chou_four_dir', waves: 4 },
    ],
  },
  {
    // hui（辉）—— 輝 stage 对应永远亭/月都阵营，符券以「规律中的变化」为主；
    // 垂直往复移动（月之都的「升降」意象）。
    id: 'hui',
    display: '辉',
    bossMaxHp: 24000,
    movement: { kind: BossMovement.BobY, amplitudeMilli: 30000, periodTicks: 480, halfTicks: 240 },
    phases: [
      { patternId: 'kusabi_gap_ring', waves: 3 },
      { patternId: 'sizuku_sine_radius', waves: 4 },
      { patternId: 'kunai_bounce', waves: 3 },
      { patternId: 'heart_sine_speed', waves: 4 },
      { patternId: 'stama_mirror', waves: 3 },
    ],
  },
];

/** 按 id 查目录项；找不到返回 null（调用方回退默认 timeline）。 */
export function findBossCatalogEntry(bossId: string): BossCatalogEntry | null {
  if (bossId === '') {
    return null;
  }
  for (const entry of BOSS_CATALOG) {
    if (entry.id === bossId) {
      return entry;
    }
  }
  return null;
}

/** boss 是否存在（协议校验/UI 用）。 */
export function isKnownBossId(bossId: string): boolean {
  return findBossCatalogEntry(bossId) !== null;
}

/** 该 boss 展开后的波数总和。 */
export function bossTimelineLength(entry: BossCatalogEntry): number {
  let total = 0;
  for (const phase of entry.phases) {
    total += phase.waves;
  }
  return total;
}

/**
 * 把阶段组的 pattern id 解析为库内 index（库顺序固定，见 pattern_timeline.ts）。
 * 找不到回退 0（库首项 kome_ring）。
 */
export function patternIndexById(patternId: string, libraryIds: readonly string[]): number {
  for (let i = 0; i < libraryIds.length; i += 1) {
    if (libraryIds[i] === patternId) {
      return i;
    }
  }
  return 0;
}

/** 该 boss 第 waveIndex 波（0-based，循环）使用的库内 pattern index。 */
export function bossTimelinePatternIndexAt(
  entry: BossCatalogEntry,
  waveIndex: number,
  libraryIds: readonly string[],
): number {
  const length = bossTimelineLength(entry);
  if (length === 0) {
    return 0;
  }
  let cursor = waveIndex % length;
  for (const phase of entry.phases) {
    if (cursor < phase.waves) {
      return patternIndexById(phase.patternId, libraryIds);
    }
    cursor -= phase.waves;
  }
  return 0;
}

/**
 * 某 tick 的发射点偏移（milli，整数三角波，与 C++ 逐位一致）。
 *
 * offset(tick) = -amplitude + floor(2*amplitude/half) * tri(tick)
 * tri(tick)    = tick % period; if (tri > half) tri = period - tri;  // 0..half
 */
export function bossEmitterOffsetMilli(
  movement: BossMovementSpec,
  tick: number,
): { xMilli: number; yMilli: number } {
  let x = 0;
  let y = 0;
  if (
    movement.kind !== BossMovement.Static &&
    movement.amplitudeMilli > 0 &&
    movement.periodTicks > 0 &&
    movement.halfTicks > 0
  ) {
    const period = movement.periodTicks;
    let tri = tick % period;
    if (tri > movement.halfTicks) {
      tri = period - tri;
    }
    const step = Math.floor((2 * movement.amplitudeMilli) / movement.halfTicks);
    const offset = -movement.amplitudeMilli + step * tri;
    if (movement.kind === BossMovement.SwayX) {
      x = offset;
    } else {
      y = offset;
    }
  }
  return { xMilli: x, yMilli: y };
}
