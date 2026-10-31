// In-memory Steam bridge for tests, web dev and offline runs. Mirrors the
// behavior of the SteamWorks surface: init can fail (Steam not running),
// DLC ownership and Workshop subscriptions are plain state.

import type {
  SteamBridge,
  SteamInitResult,
  WorkshopItemRef,
} from './steam_bridge';

export class MockSteamBridge implements SteamBridge {
  private steamRunning: boolean;
  private steamId: string | null = null;
  private initialized = false;
  private ownedDlc: Set<number>;
  private workshopItems = new Map<string, WorkshopItemRef>();
  private achievements = new Map<string, boolean>();

  constructor(opts: {
    steamRunning?: boolean;
    steamId?: string;
    ownedDlcAppIds?: number[];
    workshopItems?: WorkshopItemRef[];
    achievements?: Record<string, boolean>;
  } = {}) {
    this.steamRunning = opts.steamRunning ?? true;
    if (opts.steamId !== undefined) this.steamId = opts.steamId;
    this.ownedDlc = new Set(opts.ownedDlcAppIds ?? []);
    for (const [id, state] of Object.entries(opts.achievements ?? {})) {
      this.achievements.set(id, state);
    }
    for (const item of opts.workshopItems ?? []) {
      this.workshopItems.set(item.publishedFileId, item);
    }
  }

  setSteamRunning(value: boolean): void {
    this.steamRunning = value;
  }

  giveDlc(dlcAppId: number): void {
    this.ownedDlc.add(dlcAppId);
  }

  revokeDlc(dlcAppId: number): void {
    this.ownedDlc.delete(dlcAppId);
  }

  async init(appId: number): Promise<SteamInitResult> {
    void appId;
    if (!this.steamRunning) {
      this.initialized = false;
      this.steamId = null;
      return { ok: false, steamId: null, detail: 'steam client not running' };
    }
    this.initialized = true;
    if (this.steamId === null) this.steamId = '76561198000000001';
    return { ok: true, steamId: this.steamId, detail: null };
  }

  async getSteamId(): Promise<string | null> {
    return this.initialized ? this.steamId : null;
  }

  async hasDlcInstalled(dlcAppId: number): Promise<boolean> {
    return this.initialized && this.ownedDlc.has(dlcAppId);
  }

  async listOwnedDlc(): Promise<number[]> {
    return this.initialized ? [...this.ownedDlc].sort((a, b) => a - b) : [];
  }

  async subscribeWorkshopItem(publishedFileId: string): Promise<void> {
    if (!this.initialized) throw new Error('steam not initialized');
    if (!this.workshopItems.has(publishedFileId)) {
      this.workshopItems.set(publishedFileId, {
        publishedFileId,
        localPath: `workshop/${publishedFileId}`,
        sizeBytes: 0,
      });
    }
  }

  async unsubscribeWorkshopItem(publishedFileId: string): Promise<void> {
    this.workshopItems.delete(publishedFileId);
  }

  async getSubscribedWorkshopItems(): Promise<WorkshopItemRef[]> {
    return [...this.workshopItems.values()].sort((a, b) =>
      a.publishedFileId < b.publishedFileId ? -1 : 1,
    );
  }

  async isWorkshopItemInstalled(publishedFileId: string): Promise<boolean> {
    const item = this.workshopItems.get(publishedFileId);
    return item !== undefined && item.localPath !== null;
  }

  async setAchievement(achievementId: string): Promise<boolean> {
    if (!this.initialized) return false;
    // Steam SetAchievement is idempotent: re-granting an unlocked
    // achievement still succeeds (it only re-fires the overlay toast
    // when the state changes).
    this.achievements.set(achievementId, true);
    return true;
  }

  async getAchievements(): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const [id, state] of this.achievements) out[id] = state;
    return out;
  }

  /** Test helper: force an achievement state without going through setAchievement. */
  setAchievementState(achievementId: string, unlocked: boolean): void {
    this.achievements.set(achievementId, unlocked);
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }
}
