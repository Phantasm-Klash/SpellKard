/**
 * 合作模式视角数学与帧构建（引擎无关、零依赖、可 Node 直测）。
 *
 * 规则（COOP_MODE_CONTRACT.md §3.2）：
 *  - 视野旋转：把**本地座位**旋到屏幕底部、朝向向上。2 人房座位旋转
 *    0°/180°，4 人房 0°/90°/180°/270°（y 轴向下的顺时针正角）。
 *  - 其他玩家与其弹幕半透明：他机 alpha 0.45、他弹 alpha 0.40；
 *    本地玩家/本地弹幕/Boss/公共旋转弹幕保持 1.0。
 *  - 输入逆变换：客户端把「视图方向」的 8 向 bitmask 旋回战场空间再上行，
 *    服务端协议零改动。
 *
 * 坐标系：战场 milli（y 向下），屏幕像素（y 向下）。旋转公式
 *   x' = x·cosθ − y·sinθ，y' = x·sinθ + y·cosθ。
 */

import {
  COOP_ARENA_HALF_MILLI,
  CoopBossState,
  type CoopBossBullet,
  type CoopBossPlayerSnapshot,
  type CoopBossSnapshot,
} from '../sim/coop_boss';

export const COOP_ALLY_ALPHA = 0.45;
export const COOP_ALLY_BULLET_ALPHA = 0.4;

/** 与 `battle_layout.ts` 的 playfield 形状兼容。 */
export interface CoopPlayfield {
  width: number;
  height: number;
}

export interface CoopRenderPoint {
  x: number;
  y: number;
}

export interface CoopPlayerItem {
  playerId: string;
  seat: number;
  x: number;
  y: number;
  /** 视图中朝向（弧度，0 = 向上，顺时针为正）。 */
  facingRad: number;
  alpha: number;
  isLocal: boolean;
  connected: boolean;
  locked: boolean;
  shielded: boolean;
  damageDealt: number;
}

export interface CoopBulletItem {
  bulletId: string;
  x: number;
  y: number;
  radius: number;
  kind: number;
  alpha: number;
  patternId: string;
  /** 公共弹幕（spiral，owner = "boss"）。 */
  isPublic: boolean;
}

export interface CoopShieldArcItem {
  seat: number;
  /** 视图中该方向相对 Boss 的方位角（弧度，0 = 向右）。 */
  bearingRad: number;
  isLocalDir: boolean;
}

export interface CoopFrame {
  tick: number;
  state: CoopBossState;
  bossHp: number;
  bossMaxHp: number;
  seatCount: number;
  localSeat: number;
  /** 视野旋转角（弧度，顺时针正）。 */
  rotationRad: number;
  players: CoopPlayerItem[];
  bullets: CoopBulletItem[];
  shieldArcs: CoopShieldArcItem[];
  lockDir: number;
  /** 巨炮目标方向在视图中的方位角；-1 = 无。 */
  lockBearingRad: number;
  spiralActive: boolean;
  playfield: CoopPlayfield;
  stateHash: string;
}

/** 视野旋转角（弧度）：2 人房 seat*180°，4 人房 seat*90°。 */
export function coopViewRotationRad(seat: number, seatCount: number): number {
  const step = seatCount <= 2 ? 180 : 90;
  return ((seat % 4) * step * Math.PI) / 180;
}

/** 把战场坐标旋到视图坐标。 */
export function coopRotatePoint(x: number, y: number, rotationRad: number): CoopRenderPoint {
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

/**
 * 视图 8 向 bitmask → 战场 bitmask（bit0=上 1=右 2=下 3=左）。
 * 视图 = 战场顺时针转 θ，所以视图方向要逆时针转 θ 才回到战场：
 * 2 人房 seat1 为 k=2；4 人房 seat1/2/3 为 k=3/2/1。
 */
export function coopArenaDirectionBits(viewBits: number, seat: number, seatCount: number): number {
  const k = coopRotationSteps(seat, seatCount);
  let out = 0;
  for (let bit = 0; bit < 4; bit += 1) {
    if ((viewBits & (1 << bit)) !== 0) {
      out |= 1 << ((bit + k) % 4);
    }
  }
  return out & 0x0f;
}

/** 视图→战场需要逆时针旋转的 90° 步数。 */
export function coopRotationSteps(seat: number, seatCount: number): number {
  if (seatCount <= 2) {
    return seat === 0 ? 0 : 2;
  }
  switch (((seat % 4) + 4) % 4) {
    case 0:
      return 0;
    case 1:
      return 3;
    case 2:
      return 2;
    default:
      return 1;
  }
}

/** 座位在战场中的方位角（弧度，0 = +x 向右，y 向下）。 */
export function coopSeatBearingRad(seatCount: number, seat: number): number {
  // seat0 在下方（+y → π/2），顺时针编号：seat1 右(0)、seat2 上(−π/2)、seat3 左(π)。
  const step = seatCount <= 2 ? Math.PI : Math.PI / 2;
  return Math.PI / 2 - ((seat % 4) * step);
}

export interface CoopFrameOptions {
  layout: CoopPlayfield;
  localPlayerId: string;
  bossMaxHp?: number;
}

/**
 * 构建可渲染帧：把战场 milli 映射到 playfield 像素，并把整场旋到本地座位
 * 朝上的视角。缩放 = min(playfield.w, playfield.h) / (2 × 90 px)。
 */
export function buildCoopFrame(snapshot: CoopBossSnapshot, options: CoopFrameOptions): CoopFrame {
  const playfield = options.layout;
  const halfPx = COOP_ARENA_HALF_MILLI / 1000;
  const side = Math.min(playfield.width, playfield.height);
  const scale = side > 0 ? side / (2 * halfPx) : 0;
  const cx = playfield.width / 2;
  const cy = playfield.height / 2;
  const localPlayer = snapshot.players.find((player) => player.playerId === options.localPlayerId) ?? null;
  const localSeat = localPlayer?.seat ?? 0;
  const rotationRad = coopViewRotationRad(localSeat, snapshot.seatCount);

  const toScreen = (xMilli: number, yMilli: number): CoopRenderPoint => {
    const rotated = coopRotatePoint(xMilli / 1000, yMilli / 1000, rotationRad);
    return { x: cx + rotated.x * scale, y: cy + rotated.y * scale };
  };

  const players: CoopPlayerItem[] = snapshot.players.map((player) => {
    const point = toScreen(player.xMilli, player.yMilli);
    const isLocal = player.playerId === options.localPlayerId;
    return {
      playerId: player.playerId,
      seat: player.seat,
      x: point.x,
      y: point.y,
      // 注意：wire 字段名是 facing_millideg，但取值是 0.01 度（9000 = 90°），
      // 即实际为「厘度」；换算按 /100 度再转弧度。
      facingRad: (player.facingMilliDeg / 100) * (Math.PI / 180) + rotationRad,
      alpha: isLocal ? 1 : COOP_ALLY_ALPHA,
      isLocal,
      connected: player.connected,
      locked: player.locked,
      shielded: player.shielded,
      damageDealt: player.damageDealt,
    };
  });

  const bullets: CoopBulletItem[] = snapshot.bullets.map((bullet: CoopBossBullet) => {
    const point = toScreen(bullet.xMilli, bullet.yMilli);
    const isPublic = bullet.ownerPlayerId === 'boss';
    const ownedByLocal = bullet.ownerPlayerId === options.localPlayerId;
    return {
      bulletId: bullet.bulletId,
      x: point.x,
      y: point.y,
      radius: Math.max(1, (bullet.radiusMilli / 1000) * scale),
      kind: bullet.kind,
      alpha: isPublic || ownedByLocal ? 1 : COOP_ALLY_BULLET_ALPHA,
      patternId: bullet.patternId,
      isPublic,
    };
  });

  const shieldArcs: CoopShieldArcItem[] = [];
  for (let seat = 0; seat < snapshot.seatCount; seat += 1) {
    if ((snapshot.shieldDirMask & (1 << seat)) === 0) {
      continue;
    }
    shieldArcs.push({
      seat,
      bearingRad: coopSeatBearingRad(snapshot.seatCount, seat) + rotationRad,
      isLocalDir: seat === localSeat,
    });
  }

  const lockBearingRad =
    snapshot.lockDir >= 0 ? coopSeatBearingRad(snapshot.seatCount, snapshot.lockDir) + rotationRad : -1;

  return {
    tick: snapshot.tick,
    state: snapshot.state,
    bossHp: snapshot.bossHp,
    bossMaxHp: options.bossMaxHp !== undefined && options.bossMaxHp > 0 ? options.bossMaxHp : snapshot.bossMaxHp,
    seatCount: snapshot.seatCount,
    localSeat,
    rotationRad,
    players,
    bullets,
    shieldArcs,
    lockDir: snapshot.lockDir,
    lockBearingRad,
    spiralActive: snapshot.spiralActive,
    playfield,
    stateHash: snapshot.stateHash,
  };
}

/** 本地玩家座位（无快照时回落 0）。 */
export function coopLocalSeat(snapshot: CoopBossSnapshot | null, localPlayerId: string): number {
  if (snapshot === null) {
    return 0;
  }
  const player = snapshot.players.find((entry: CoopBossPlayerSnapshot) => entry.playerId === localPlayerId);
  return player?.seat ?? 0;
}
