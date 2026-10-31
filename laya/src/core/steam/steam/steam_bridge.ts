// SteamWorks integration surface.
//
// In the Windows native build the transport is the `spk_steam` LayaAir native
// extension (same bridging pattern as `spk_udp` / `spk_crypto`, see
// SpellKard/laya/native/udp_ext/README.md): the extension wraps the Steamworks
// SDK (steam_api64) and exposes synchronous methods through the JSVM. In web
// and test builds no transport is available; use MockSteamBridge or run
// offline (base + P2P remain fully functional without Steam).

export interface SteamInitResult {
  ok: boolean;
  steamId: string | null;
  detail: string | null;
}

export interface WorkshopItemRef {
  publishedFileId: string;
  /** Local install path of the item root, or null while downloading. */
  localPath: string | null;
  sizeBytes: number;
}

export class SteamBridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SteamBridgeError';
  }
}

/** Minimal invoke-based transport implemented by the spk_steam extension. */
export interface SteamTransport {
  readonly available: boolean;
  invoke<T>(method: SteamMethod, args: Record<string, unknown>): Promise<T>;
}

export type SteamMethod =
  | 'init'
  | 'getSteamId'
  | 'hasDlcInstalled'
  | 'listOwnedDlc'
  | 'subscribeWorkshopItem'
  | 'unsubscribeWorkshopItem'
  | 'getSubscribedWorkshopItems'
  | 'isWorkshopItemInstalled'
  | 'setAchievement'
  | 'getAchievements'
  | 'shutdown';

export interface SteamBridge {
  init(appId: number): Promise<SteamInitResult>;
  getSteamId(): Promise<string | null>;
  hasDlcInstalled(dlcAppId: number): Promise<boolean>;
  listOwnedDlc(): Promise<number[]>;
  subscribeWorkshopItem(publishedFileId: string): Promise<void>;
  unsubscribeWorkshopItem(publishedFileId: string): Promise<void>;
  getSubscribedWorkshopItems(): Promise<WorkshopItemRef[]>;
  isWorkshopItemInstalled(publishedFileId: string): Promise<boolean>;
  /** Grant an achievement by its Steamworks identifier (idempotent server-side). */
  setAchievement(achievementId: string): Promise<boolean>;
  /** Current achievement states for the local player (id -> unlocked). */
  getAchievements(): Promise<Record<string, boolean>>;
  shutdown(): Promise<void>;
}

export class NativeSteamBridge implements SteamBridge {
  constructor(private readonly transport: SteamTransport) {}

  private async call<T>(method: SteamMethod, args: Record<string, unknown> = {}): Promise<T> {
    if (!this.transport.available) {
      throw new SteamBridgeError(`steam transport unavailable for ${method}`);
    }
    return this.transport.invoke<T>(method, args);
  }

  init(appId: number): Promise<SteamInitResult> {
    return this.call<SteamInitResult>('init', { appId });
  }

  getSteamId(): Promise<string | null> {
    return this.call<string | null>('getSteamId');
  }

  hasDlcInstalled(dlcAppId: number): Promise<boolean> {
    return this.call<boolean>('hasDlcInstalled', { dlcAppId });
  }

  listOwnedDlc(): Promise<number[]> {
    return this.call<number[]>('listOwnedDlc');
  }

  subscribeWorkshopItem(publishedFileId: string): Promise<void> {
    return this.call<void>('subscribeWorkshopItem', { publishedFileId });
  }

  unsubscribeWorkshopItem(publishedFileId: string): Promise<void> {
    return this.call<void>('unsubscribeWorkshopItem', { publishedFileId });
  }

  getSubscribedWorkshopItems(): Promise<WorkshopItemRef[]> {
    return this.call<WorkshopItemRef[]>('getSubscribedWorkshopItems');
  }

  isWorkshopItemInstalled(publishedFileId: string): Promise<boolean> {
    return this.call<boolean>('isWorkshopItemInstalled', { publishedFileId });
  }

  setAchievement(achievementId: string): Promise<boolean> {
    return this.call<boolean>('setAchievement', { achievementId });
  }

  getAchievements(): Promise<Record<string, boolean>> {
    return this.call<Record<string, boolean>>('getAchievements');
  }

  shutdown(): Promise<void> {
    return this.call<void>('shutdown');
  }
}
