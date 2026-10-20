/**
 * 合作模式（coop_boss）快照镜像。
 *
 * 字段与服务端 C++ `EncodeCoopBossSnapshotPayload`（COOP_MODE_CONTRACT.md §2.4）
 * 逐字段对应，解码后统一转成 camelCase（与 `BossRaceSnapshot` 的既有约定一致）。
 *
 * 坐标单位：整数 milli（1/1000 px），战场为以 Boss 为原点的方形
 * ±90000 milli；座位按 sorted(player_ids) 下标，2 人=上下相对、4 人=四向。
 * 这里只放纯数据与常量，渲染/旋转在 `core/game/coop_view_model.ts`。
 */

export const COOP_ARENA_HALF_MILLI = 90000;
export const COOP_PLAYER_SPAWN_MILLI = 70200;
export const COOP_MIN_PLAYERS = 2;
export const COOP_MAX_PLAYERS = 4;
export const COOP_MODE_ID = 'coop_boss';

export enum CoopBossState {
  Waiting = 'waiting',
  Running = 'running',
  Finished = 'finished',
}

export interface CoopBossPlayerSnapshot {
  playerId: string;
  seat: number;
  xMilli: number;
  yMilli: number;
  /** 毫度：0=上，9000=右，18000=下，27000=左。 */
  facingMilliDeg: number;
  damageDealt: number;
  connected: boolean;
  /** 巨炮封锁中（位移/射击被冻结）。 */
  locked: boolean;
  /** 本方向被格挡（伤害归零）。 */
  shielded: boolean;
}

export interface CoopBossBullet {
  bulletId: string;
  /** fan/cannon = 目标座位玩家；spiral = "boss"（全场公共）。 */
  ownerPlayerId: string;
  xMilli: number;
  yMilli: number;
  vxMilli: number;
  vyMilli: number;
  radiusMilli: number;
  /** 0=fan 1=cannon 2=spiral。 */
  kind: number;
  patternId: string;
}

export interface CoopBossSnapshot {
  tick: number;
  state: CoopBossState;
  bossHp: number;
  bossMaxHp: number;
  seatCount: number;
  /** bit i = 座位 i 被格挡。 */
  shieldDirMask: number;
  /** 巨炮目标座位；-1 = 无。 */
  lockDir: number;
  lockUntilTick: number;
  spiralActive: boolean;
  players: CoopBossPlayerSnapshot[];
  bullets: CoopBossBullet[];
  stateHash: string;
}

/** 座位出生点（与服务端 `CoopSeatSpawnMilli` 同值）。 */
export function coopSeatSpawnMilli(seatCount: number, seat: number): { xMilli: number; yMilli: number } {
  const r = COOP_PLAYER_SPAWN_MILLI;
  if (seatCount <= 2) {
    return { xMilli: 0, yMilli: seat === 0 ? r : -r };
  }
  switch (((seat % 4) + 4) % 4) {
    case 0:
      return { xMilli: 0, yMilli: r };
    case 1:
      return { xMilli: r, yMilli: 0 };
    case 2:
      return { xMilli: 0, yMilli: -r };
    default:
      return { xMilli: -r, yMilli: 0 };
  }
}

/** 座位朝向（毫度，与服务端 `CoopSeatFacingMilliDeg` 同值）。 */
export function coopSeatFacingMilliDeg(seatCount: number, seat: number): number {
  if (seatCount <= 2) {
    return seat === 0 ? 0 : 18000;
  }
  switch (((seat % 4) + 4) % 4) {
    case 0:
      return 0;
    case 1:
      return 27000;
    case 2:
      return 18000;
    default:
      return 9000;
  }
}
