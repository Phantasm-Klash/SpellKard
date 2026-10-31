/**
 * `spk_steam` — LayaNative JSVM bridge over the Steamworks client (see
 * `laya/native/steam_ext/` for the C++ side).
 *
 * The extension exposes a plain object at `window.spk_steam`; {@link spkSteam}
 * validates the shape and {@link nativeSteamAvailable} reports availability,
 * so every capability degrades to `null`/`false` instead of throwing — the
 * same contract as `spk_win` (see `native_window.ts`). The free tier never
 * touches any of these functions.
 *
 * `init` is synchronous on the C++ side (the Steamworks client API is), but
 * the JS interface mirrors `SteamBridge.init` (a Promise) so the mock and
 * native bridges are interchangeable.
 *
 * NOTE: `platform/native/` only.
 */

import type {
  SteamBridge,
  SteamInitResult,
  WorkshopItemRef,
} from '../../../core/steam/steam/steam_bridge';

/** The `spk_steam` global exported by the LayaNative Steamworks extension. */
export interface SpkSteamApi {
  version(): string;
  /** `{ ok, steamId, detail }`; `steamId` is null when not initialized. */
  init(appId: number): SteamInitResult;
  getSteamId(): string | null;
  hasDlcInstalled(appId: number): boolean;
  /** Installed DLC appids (Steam reports only what is currently installed). */
  listOwnedDlc(): number[];
  subscribeWorkshopItem(publishedFileId: string): boolean;
  unsubscribeWorkshopItem(publishedFileId: string): boolean;
  /**
   * Subscribed items with install state. `localPath` is null while the item
   * is still downloading; `sizeBytes` comes across the JSVM boundary as a
   * number (int64) and is informational only.
   */
  getSubscribedWorkshopItems(): WorkshopItemRef[];
  isWorkshopItemInstalled(publishedFileId: string): boolean;
  setAchievement(achievementId: string): boolean;
  getAchievements(): Record<string, boolean>;
  shutdown(): void;
}

function isNumberArray(v: unknown): boolean {
  return Array.isArray(v) && v.every((x) => typeof x === 'number');
}

function isSteamInitResult(v: unknown): v is SteamInitResult {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as SteamInitResult).ok === 'boolean' &&
    typeof (v as SteamInitResult).detail === 'string'
  );
}

/** True when `v` has the full `spk_steam` shape (all required methods). */
function isSpkSteamApi(v: unknown): v is SpkSteamApi {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.version === 'function' &&
    typeof o.init === 'function' &&
    typeof o.getSteamId === 'function' &&
    typeof o.hasDlcInstalled === 'function' &&
    typeof o.listOwnedDlc === 'function' &&
    typeof o.subscribeWorkshopItem === 'function' &&
    typeof o.unsubscribeWorkshopItem === 'function' &&
    typeof o.getSubscribedWorkshopItems === 'function' &&
    typeof o.isWorkshopItemInstalled === 'function' &&
    typeof o.setAchievement === 'function' &&
    typeof o.getAchievements === 'function' &&
    typeof o.shutdown === 'function'
  );
}

/**
 * Returns the `spk_steam` extension when it is loaded, or `null` otherwise.
 * The `scope` parameter defaults to `globalThis` and exists so tests can
 * inject a fake (mirrors `spkWin`).
 */
export function spkSteam(scope: unknown = globalThis): SpkSteamApi | null {
  if (typeof scope !== 'object' || scope === null) {
    return null;
  }
  const direct = (scope as Record<string, unknown>).spk_steam;
  if (isSpkSteamApi(direct)) {
    return direct;
  }
  const nested = (scope as Record<string, unknown>).window;
  if (typeof nested === 'object' && nested !== null) {
    const fromWindow = (nested as Record<string, unknown>).spk_steam;
    if (isSpkSteamApi(fromWindow)) {
      return fromWindow;
    }
  }
  return null;
}

/** True when the `spk_steam` extension is loaded and usable. */
export function nativeSteamAvailable(scope: unknown = globalThis): boolean {
  return spkSteam(scope) !== null;
}

/**
 * `SteamBridge` implementation over the native extension. All native calls
 * are synchronous; they are wrapped in resolved Promises to match the
 * interface. Every failure maps to `false` / an empty value — never a throw
 * (the Steam layer must never take the UI down).
 */
export class NativeSpkSteamBridge implements SteamBridge {
  private readonly api: SpkSteamApi;
  private steamId: string | null = null;

  constructor(api: SpkSteamApi | null | undefined = undefined) {
    const resolved = api !== undefined ? api : spkSteam();
    if (resolved === null) {
      throw new Error('spk_steam extension is not available on this platform');
    }
    this.api = resolved;
  }

  async init(appId: number): Promise<SteamInitResult> {
    let result: SteamInitResult;
    try {
      result = this.api.init(appId);
    } catch {
      return { ok: false, steamId: null, detail: 'spk_steam init threw' };
    }
    if (!isSteamInitResult(result)) {
      return { ok: false, steamId: null, detail: 'spk_steam init returned an unexpected shape' };
    }
    if (result.ok) {
      this.steamId = result.steamId;
    }
    return result;
  }

  getSteamId(): Promise<string | null> {
    try {
      return Promise.resolve(this.api.getSteamId());
    } catch {
      return Promise.resolve(this.steamId);
    }
  }

  async hasDlcInstalled(appId: number): Promise<boolean> {
    try {
      return this.api.hasDlcInstalled(appId) === true;
    } catch {
      return false;
    }
  }

  async listOwnedDlc(): Promise<number[]> {
    try {
      const v = this.api.listOwnedDlc();
      return isNumberArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  async subscribeWorkshopItem(publishedFileId: string): Promise<void> {
    try {
      this.api.subscribeWorkshopItem(publishedFileId);
    } catch {
      // best-effort: ignore
    }
  }

  async unsubscribeWorkshopItem(publishedFileId: string): Promise<void> {
    try {
      this.api.unsubscribeWorkshopItem(publishedFileId);
    } catch {
      // best-effort: ignore
    }
  }

  async getSubscribedWorkshopItems(): Promise<WorkshopItemRef[]> {
    try {
      const v = this.api.getSubscribedWorkshopItems();
      if (!Array.isArray(v)) return [];
      return v
        .filter(
          (it): it is WorkshopItemRef =>
            typeof it === 'object' &&
            it !== null &&
            typeof (it as WorkshopItemRef).publishedFileId === 'string',
        )
        .map((it) => ({
          publishedFileId: it.publishedFileId,
          localPath: typeof it.localPath === 'string' ? it.localPath : null,
          sizeBytes: typeof it.sizeBytes === 'number' ? it.sizeBytes : 0,
        }));
    } catch {
      return [];
    }
  }

  async isWorkshopItemInstalled(publishedFileId: string): Promise<boolean> {
    try {
      return this.api.isWorkshopItemInstalled(publishedFileId) === true;
    } catch {
      return false;
    }
  }

  async setAchievement(achievementId: string): Promise<boolean> {
    try {
      return this.api.setAchievement(achievementId) === true;
    } catch {
      return false;
    }
  }

  async getAchievements(): Promise<Record<string, boolean>> {
    try {
      const v = this.api.getAchievements();
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
      const out: Record<string, boolean> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (typeof val === 'boolean') out[k] = val;
      }
      return out;
    } catch {
      return {};
    }
  }

  async shutdown(): Promise<void> {
    try {
      this.api.shutdown();
    } catch {
      // best-effort: ignore
    }
  }
}
