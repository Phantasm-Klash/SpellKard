/**
 * Presentation model for `BossRaceView`.
 *
 * Converts authoritative/predicted milli-unit simulation state into
 * pixel-space render items plus HUD values, so the LayaAir layer only has to
 * blit sprites and draw text. Keeping this engine-agnostic means the same
 * mapping is unit-testable and reusable by any renderer.
 *
 * Coordinate systems:
 *  - Simulation: milli-units, x ∈ [-120000, 120000], y ∈ [-90000, 90000],
 *    origin at the arena centre, Boss at (0, -60000), +y points down.
 *  - Render: pixels inside a portrait playfield, origin top-left, +y down.
 */

import type { BossRaceSnapshot } from '../sim/boss_race';
import {
  ARENA_HALF_HEIGHT_MILLI,
  ARENA_HALF_WIDTH_MILLI,
  BOSS_ORIGIN_X_MILLI,
  BOSS_ORIGIN_Y_MILLI,
} from '../sim/boss_race';

export interface PlayfieldLayout {
  /** Playfield width in pixels. */
  width: number;
  /** Playfield height in pixels. */
  height: number;
}

export interface RenderPoint {
  x: number;
  y: number;
}

export interface BulletRenderItem {
  bulletId: string;
  patternId: string;
  position: RenderPoint;
  radius: number;
  /** Bullets owned by the local player's Boss copy vs. the opponent's. */
  ownerIsLocal: boolean;
}

export interface PlayerRenderItem {
  playerId: string;
  position: RenderPoint;
  isLocal: boolean;
}

export interface BossRenderItem {
  playerId: string;
  position: RenderPoint;
  currentHp: number;
  maxHp: number;
  hpRatio: number;
  defeated: boolean;
  isLocal: boolean;
}

export interface BossRaceFrame {
  tick: number;
  state: number;
  boss: BossRenderItem | null;
  opponentBoss: BossRenderItem | null;
  players: PlayerRenderItem[];
  bullets: BulletRenderItem[];
  winnerPlayerId: string;
  matchOver: boolean;
  /** Local Boss HP as a 0..1 ratio, for the primary HUD bar. */
  localHpRatio: number;
  /** Damage dealt to the local Boss copy, for the HUD counter. */
  localDamageDealt: number;
}

export interface BossRaceFrameOptions {
  layout: PlayfieldLayout;
  localPlayerId: string;
  bossMaxHp: number;
  /** Radius multiplier for the "focus"/slow mode hitbox highlight. */
  bulletRadiusScale?: number;
}

/**
 * Maps simulation milli-units onto playfield pixels. The arena keeps its aspect
 * ratio, so both axes use the same scale.
 */
export class PlayfieldTransform {
  readonly scale: number;

  constructor(readonly layout: PlayfieldLayout) {
    this.scale = layout.width / (ARENA_HALF_WIDTH_MILLI * 2);
  }

  toPixels(xMilli: number, yMilli: number): RenderPoint {
    return {
      x: (xMilli + ARENA_HALF_WIDTH_MILLI) * this.scale,
      y: (yMilli + ARENA_HALF_HEIGHT_MILLI) * this.scale,
    };
  }

  /** Milli-unit radius → pixel radius. */
  radiusToPixels(radiusMilli: number): number {
    return radiusMilli * this.scale;
  }
}

export function bossOriginPixels(transform: PlayfieldTransform): RenderPoint {
  return transform.toPixels(BOSS_ORIGIN_X_MILLI, BOSS_ORIGIN_Y_MILLI);
}

/**
 * Builds one render frame from a snapshot. `localPlayerId` decides which Boss
 * copy and player are drawn as "mine" so the view can highlight them.
 */
export function buildBossRaceFrame(
  snapshot: BossRaceSnapshot,
  options: BossRaceFrameOptions,
): BossRaceFrame {
  const transform = new PlayfieldTransform(options.layout);
  const bulletRadiusScale = options.bulletRadiusScale ?? 1;
  const maxHp = options.bossMaxHp > 0 ? options.bossMaxHp : 1;

  const players: PlayerRenderItem[] = [];
  let boss: BossRenderItem | null = null;
  let opponentBoss: BossRenderItem | null = null;
  let localHpRatio = 0;
  let localDamageDealt = 0;

  for (const player of snapshot.players) {
    const isLocal = player.playerId === options.localPlayerId;
    players.push({
      playerId: player.playerId,
      position: transform.toPixels(player.xMilli, player.yMilli),
      isLocal,
    });
    const bossItem: BossRenderItem = {
      playerId: player.playerId,
      position: bossOriginPixels(transform),
      currentHp: player.bossCurrentHp,
      maxHp,
      hpRatio: Math.max(0, Math.min(1, player.bossCurrentHp / maxHp)),
      defeated: player.bossCurrentHp <= 0,
      isLocal,
    };
    if (isLocal) {
      boss = bossItem;
      localHpRatio = bossItem.hpRatio;
      localDamageDealt = player.damageDealt;
    } else if (opponentBoss === null) {
      opponentBoss = bossItem;
    }
  }

  const bullets: BulletRenderItem[] = snapshot.bullets.map((bullet) => ({
    bulletId: bullet.bulletId,
    patternId: bullet.patternId,
    position: transform.toPixels(bullet.xMilli, bullet.yMilli),
    radius: Math.max(1, transform.radiusToPixels(bullet.radiusMilli) * bulletRadiusScale),
    ownerIsLocal: bullet.ownerPlayerId === options.localPlayerId,
  }));

  return {
    tick: snapshot.tick,
    state: snapshot.state as number,
    boss,
    opponentBoss,
    players,
    bullets,
    winnerPlayerId: snapshot.winnerPlayerId,
    matchOver: snapshot.winnerPlayerId !== '',
    localHpRatio,
    localDamageDealt,
  };
}

/**
 * Applies snapshot interpolation for smooth rendering between server ticks.
 * `alpha` is the 0..1 fraction between `previous` and `current`.
 */
export function interpolateFrames(
  previous: BossRaceFrame,
  current: BossRaceFrame,
  alpha: number,
): BossRaceFrame {
  const t = Math.max(0, Math.min(1, alpha));
  if (t >= 1 || previous.players.length !== current.players.length) {
    return current;
  }
  const lerpPoint = (a: RenderPoint, b: RenderPoint): RenderPoint => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  const players: PlayerRenderItem[] = current.players.map((player, index) => {
    const before = previous.players[index];
    if (before === undefined || before.playerId !== player.playerId) {
      return player;
    }
    return { ...player, position: lerpPoint(before.position, player.position) };
  });
  return {
    ...current,
    players,
    bullets: current.bullets.map((bullet) => {
      const before = previous.bullets.find((candidate) => candidate.bulletId === bullet.bulletId);
      if (before === undefined) {
        return bullet;
      }
      return { ...bullet, position: lerpPoint(before.position, bullet.position) };
    }),
  };
}
