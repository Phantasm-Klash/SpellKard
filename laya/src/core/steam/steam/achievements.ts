// Steam achievement service.
//
// Model (see docs/06-achievements.md):
//   - each level in the catalog (base + DLC) can have exactly one achievement
//   - an achievement unlocks when the player completes its level
//   - completion is decided by the game result flow (win in competitive
//     modes; party wins the encounter in co-op)
//   - unlocking is best-effort: a Steam hiccup must never block the result
//     screen, and the free tier does not depend on Steam at all
//
// The service caches the unlocked state fetched from Steam at login, so
// the same level is not re-granted on every win (SetAchievement is
// idempotent anyway, but we avoid the overlay toast spam).

import type { DlcCatalog } from '../types';
import type { SteamBridge } from './steam_bridge';

/**
 * Resolve the level id a finished battle maps to, or null when the
 * (app, mode, boss) combination is not a catalog level (e.g. casual P2P).
 * `dlcAppId` is the appid of the server the battle ran on: the base game
 * appid for base servers, the DLC appid for DLC servers — base and DLC
 * levels may share the same (mode, boss) pair, so the appid is part of the
 * identity.
 */
export function resolveLevelId(
  catalog: DlcCatalog,
  ctx: { dlcAppId: number; modeId: string; bossId?: string | null },
): string | null {
  const baseAppId = catalog.base_game.appid;
  const levels =
    ctx.dlcAppId === baseAppId
      ? catalog.base_levels
      : catalog.dlcs.find((d) => d.steam_appid === ctx.dlcAppId)?.levels ?? [];
  for (const level of levels) {
    if (level.mode_id !== ctx.modeId) continue;
    if ((level.boss_id ?? null) !== (ctx.bossId ?? null)) continue;
    return level.level_id;
  }
  return null;
}

export class AchievementService {
  private unlocked = new Map<string, boolean>();
  private refreshed = false;

  constructor(
    private readonly catalog: DlcCatalog,
    private readonly steam: SteamBridge | null,
  ) {}

  /** Pull the current achievement states from Steam (best-effort). */
  async refreshState(): Promise<void> {
    if (this.steam === null) return;
    try {
      const states = await this.steam.getAchievements();
      this.unlocked = new Map(Object.entries(states));
      this.refreshed = true;
    } catch {
      // Steam overlay/stats unavailable: treat everything as unknown and
      // let setAchievement attempts be idempotent no-ops at worst.
    }
  }

  /**
   * Unlock the achievement for a completed level (if any).
   * Returns the achievement ids that were (attempted to be) granted.
   */
  async unlockForLevel(levelId: string): Promise<string[]> {
    const achievement = this.catalog.achievements.find((a) => a.level_id === levelId);
    if (achievement === undefined) return [];
    if (this.unlocked.get(achievement.id) === true) return [];
    if (this.steam !== null) {
      try {
        const ok = await this.steam.setAchievement(achievement.id);
        if (ok) this.unlocked.set(achievement.id, true);
        else return [];
      } catch {
        return []; // best-effort: never break the result flow
      }
    }
    // No Steam (web/offline build): track the unlock locally only so the
    // UI can still show progress; nothing is ever gated on it.
    this.unlocked.set(achievement.id, true);
    return [achievement.id];
  }

  /** Whether an achievement is known-unlocked (or locally granted). */
  isUnlocked(achievementId: string): boolean {
    return this.unlocked.get(achievementId) === true;
  }

  /** All catalog achievements with their current state. */
  list(): { id: string; name: string; levelId: string; unlocked: boolean }[] {
    return this.catalog.achievements.map((a) => ({
      id: a.id,
      name: a.name,
      levelId: a.level_id,
      unlocked: this.unlocked.get(a.id) === true,
    }));
  }

  get stateRefreshed(): boolean {
    return this.refreshed;
  }
}
