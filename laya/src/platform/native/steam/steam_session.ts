/**
 * Platform lifecycle for the Steam side of the game.
 *
 * Responsibilities:
 *   - detect the `spk_steam` native extension (Windows native only)
 *   - build the `AchievementService` from the embedded DLC catalog
 *   - hand the settled battle result to the achievement service
 *
 * The whole module is optional and silent: without the extension (web,
 * offline, non-Steam launches) every function is a no-op and the game is
 * exactly as it was before Steam existed. Nothing here may throw into the
 * UI flow — the free tier never depends on any of it.
 *
 * NOTE: `platform/native/steam/` only.
 */

import { parseDlcCatalog } from '../../../core/steam/catalog/dlc_catalog';
import { DLC_CATALOG_DATA } from '../../../core/steam/dlc_catalog_data';
import {
  AchievementService,
  resolveLevelId,
} from '../../../core/steam/steam/achievements';
import type { SteamBridge } from '../../../core/steam/steam/steam_bridge';
import type { DlcCatalog } from '../../../core/steam/types';
import { NativeSpkSteamBridge, spkSteam } from './native_steam_bridge';

interface SteamSessionState {
  catalog: DlcCatalog;
  /** Native bridge when the extension is available, else null (local-only). */
  bridge: SteamBridge | null;
  service: AchievementService;
}

let state: SteamSessionState | null = null;
let initStarted = false;

/**
 * Initialize the Steam session. Idempotent; call once from app bootstrap.
 * Safe to call on any platform: without the native extension the session
 * still works (local-only achievement tracking, no Steam calls at all).
 */
export function initSteamSession(): Promise<void> {
  if (initStarted) {
    return state !== null ? state.service.refreshState() : Promise.resolve();
  }
  initStarted = true;

  let catalog: DlcCatalog;
  try {
    catalog = parseDlcCatalog(DLC_CATALOG_DATA);
  } catch {
    // Embedded catalog is broken: keep Steam disabled entirely rather than
    // run with a half-validated catalog.
    return Promise.resolve();
  }

  let bridge: SteamBridge | null = null;
  const api = spkSteam();
  if (api !== null) {
    bridge = new NativeSpkSteamBridge(api);
  }

  const service = new AchievementService(catalog, bridge);
  state = { catalog, bridge, service };

  const kickoff = async (): Promise<void> => {
    if (bridge === null) return;
    try {
      const res = await bridge.init(catalog.base_game.appid);
      if (!res.ok) {
        // Steam client not running / not the Steam appid: fall back to
        // local-only tracking. The game itself is unaffected.
        state = { catalog, bridge: null, service: new AchievementService(catalog, null) };
        return;
      }
    } catch {
      state = { catalog, bridge: null, service: new AchievementService(catalog, null) };
      return;
    }
    await service.refreshState();
  };

  return kickoff();
}

/** The achievement service, or null when Steam is unavailable/disabled. */
export function getSteamAchievementService(): AchievementService | null {
  return state !== null ? state.service : null;
}

/** The embedded catalog, or null when Steam is disabled. */
export function getSteamCatalog(): DlcCatalog | null {
  return state !== null ? state.catalog : null;
}

/** True when the native extension initialized a real Steam session. */
export function isSteamActive(): boolean {
  return state !== null && state.bridge !== null;
}

export interface BattleResultCtx {
  /** Room mode id (e.g. `mvp_boss_race`, `coop_boss`). */
  modeId: string;
  /** Room boss id; empty string or null when the default timeline was used. */
  bossId: string | null;
  /** Whether the local player won (as shown on the result screen). */
  won: boolean;
  /** Battle server endpoint (`host:port`) the match ran on, or null. */
  endpoint: string | null;
}

/** Map a battle endpoint host to the appid owning it (base when unmatched). */
export function appidForEndpoint(catalog: DlcCatalog, endpoint: string | null): number {
  if (endpoint !== null) {
    const host = endpoint.split(':')[0];
    for (const dlc of catalog.dlcs) {
      if (dlc.servers.some((s) => s.host === host)) {
        return dlc.steam_appid;
      }
    }
  }
  return catalog.base_game.appid;
}

/**
 * Hand a settled battle result to the achievement service.
 * Best-effort: never throws, resolves with the granted achievement ids
 * (empty array when there is nothing to grant). Fire and forget from the
 * result screen.
 */
export function handleBattleResult(ctx: BattleResultCtx): Promise<string[]> {
  if (state === null || !ctx.won) return Promise.resolve([]);
  const dlcAppId = appidForEndpoint(state.catalog, ctx.endpoint);
  const levelId = resolveLevelId(state.catalog, {
    dlcAppId,
    modeId: ctx.modeId,
    bossId: ctx.bossId,
  });
  if (levelId === null) return Promise.resolve([]);
  return state.service
    .unlockForLevel(levelId)
    .catch(() => [] as string[]);
}
