// Top-level Steam integration session, orchestrating the whole flow:
//
//   1. Steam init (optional — base + P2P keep working without it)
//   2. entitlement snapshot (owned DLC appids)
//   3. if Steam-connected AND at least one DLC owned: fetch the DLC server
//      manifest (Nakama RPC `dlc.servers`, personal-key bound), verify it,
//      and refresh local DLC content (icons/audio/themes/backgrounds)
//   4. access table: which servers/content are reachable
//
// Free tier guarantees enforced here:
//   - `base` and `p2p` access decisions never depend on Steam or DLC state
//   - a failed manifest fetch or content update only degrades DLC servers;
//     it must never break the free tier.

import type { AccessDecision, AccessTarget, EntitlementState } from '../catalog/entitlement';
import { decideAccess } from '../catalog/entitlement';
import type { CryptoProvider } from '../crypto/provider';
import type { DlcCatalog } from '../types';
import type { SteamBridge } from '../steam/steam_bridge';
import type { AssetFetcher, ContentStore, ContentUpdateResult } from '../server/content_updater';
import { applyAssetUpdates } from '../server/content_updater';
import {
  checkManifestUsable,
  type DlcManifestServer,
  type DlcServerManifest,
} from '../server/manifest';
import type { WorkshopRegistry } from '../workshop/workshop_loader';

/** Transport to the Nakama `dlc.servers` RPC (envelope handled by the adapter). */
export interface DlcServerTransport {
  fetchDlcServerManifest(args: { steamId: string }): Promise<DlcServerManifest>;
}

export interface SteamIntegrationOptions {
  catalog: DlcCatalog;
  steam: SteamBridge | null;
  /** Null in web/offline builds; DLC servers then stay locked. */
  transport: DlcServerTransport | null;
  /** Personal public key bound to this player's Nakama account (hex). Null when never bound. */
  personalPublicKeyHex: string | null;
  crypto: CryptoProvider;
  contentStore?: ContentStore;
  fetcher?: AssetFetcher;
  workshopRegistry?: WorkshopRegistry;
  now?: () => number;
}

export interface AccessibleServer {
  serverId: string;
  dlcAppId: number;
  endpoint: { host: string; port: number };
  levelIds: string[];
  /** 'dlc' for bundled servers, 'workshop' for third-party free servers. */
  source: 'dlc' | 'workshop';
  expiresAt: number;
}

export interface SteamIntegrationStatus {
  phase: 'base-only' | 'dlc-ready';
  entitlements: EntitlementState;
  manifest: DlcServerManifest | null;
  accessibleServers: AccessibleServer[];
  contentResults: ContentUpdateResult[];
  errors: string[];
}

export class SteamIntegrationSession {
  private readonly opts: SteamIntegrationOptions;
  private readonly now: () => number;
  private entitlements: EntitlementState = { steamConnected: false, steamId: null, ownedDlcAppIds: [] };
  private manifest: DlcServerManifest | null = null;
  private accessible: AccessibleServer[] = [];
  private contentResults: ContentUpdateResult[] = [];
  private errors: string[] = [];

  constructor(opts: SteamIntegrationOptions) {
    if (opts.catalog.base_game.free !== true) {
      throw new Error('catalog: base game must be free');
    }
    if (opts.catalog.free_p2p.enabled !== true) {
      throw new Error('catalog: free P2P must be enabled');
    }
    this.opts = opts;
    this.now = opts.now ?? (() => Date.now());
  }

  get status(): SteamIntegrationStatus {
    return {
      phase: this.manifest !== null ? 'dlc-ready' : 'base-only',
      entitlements: this.entitlements,
      manifest: this.manifest,
      accessibleServers: this.accessible,
      contentResults: this.contentResults,
      errors: this.errors,
    };
  }

  async initialize(): Promise<SteamIntegrationStatus> {
    this.errors = [];
    this.manifest = null;
    this.accessible = [];
    this.contentResults = [];

    const { steam } = this.opts;
    if (steam === null) {
      this.entitlements = { steamConnected: false, steamId: null, ownedDlcAppIds: [] };
    } else {
      const init = await steam.init(this.opts.catalog.base_game.appid);
      if (!init.ok || init.steamId === null) {
        this.entitlements = { steamConnected: false, steamId: null, ownedDlcAppIds: [] };
      } else {
        const owned = await steam.listOwnedDlc();
        this.entitlements = {
          steamConnected: true,
          steamId: init.steamId,
          ownedDlcAppIds: owned,
        };
      }
    }

    // Workshop third-party servers are always available (no DLC needed).
    this.accessible = this.workshopServers();

    const { steamConnected, steamId, ownedDlcAppIds } = this.entitlements;
    if (!steamConnected || steamId === null || ownedDlcAppIds.length === 0) {
      return this.status;
    }
    if (this.opts.transport === null || this.opts.personalPublicKeyHex === null) {
      this.errors.push('DLC owned but Steam transport or personal key binding is missing; DLC servers stay locked');
      return this.status;
    }

    try {
      const fetched = await this.opts.transport.fetchDlcServerManifest({ steamId });
      const check = await checkManifestUsable(
        fetched,
        { steamId, ownedDlcAppIds: ownedDlcAppIds, nowMs: this.now() },
        this.opts.personalPublicKeyHex,
        this.opts.crypto,
      );
      if (!check.ok) {
        this.errors.push(`dlc manifest rejected: ${check.reason}`);
        return this.status;
      }
      this.manifest = fetched;
      this.accessible.push(...check.servers.map(toAccessibleServer));

      if (this.opts.contentStore !== undefined && this.opts.fetcher !== undefined) {
        this.contentResults = await applyAssetUpdates(
          fetched.asset_updates,
          this.opts.contentStore,
          this.opts.fetcher,
          this.opts.crypto,
        );
      }
    } catch (err) {
      this.errors.push(`dlc manifest fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return this.status;
  }

  /** Re-fetch the manifest (e.g. when a server entry expires). */
  async refresh(): Promise<SteamIntegrationStatus> {
    if (!this.entitlements.steamConnected) return this.status;
    return this.initialize();
  }

  /**
   * Client-side access decision (layer 1). DLC servers additionally require
   * that the verified manifest actually grants that server (layer 1.5,
   * local); the Nakama service re-verifies ownership server-side (layer 2).
   */
  accessTarget(target: AccessTarget): AccessDecision {
    const decision = decideAccess(this.entitlements, target);
    if (!decision.allowed) return decision;
    if (target.kind === 'dlc-server') {
      const granted = this.accessible.some(
        (s) => s.source === 'dlc' && s.serverId === target.serverId && s.dlcAppId === target.dlcAppId,
      );
      if (!granted) {
        return {
          allowed: false,
          code: 'dlc_not_owned',
          reason: `server ${target.serverId} not present in the verified DLC manifest`,
        };
      }
    }
    return decision;
  }

  serversForLevel(levelId: string): AccessibleServer[] {
    return this.accessible.filter((s) => s.levelIds.includes(levelId));
  }

  private workshopServers(): AccessibleServer[] {
    const reg = this.opts.workshopRegistry;
    if (reg === undefined) return [];
    return [...reg.servers.entries()].map(([key, s]) => ({
      serverId: key,
      dlcAppId: 0,
      endpoint: { host: s.endpoint.host, port: s.endpoint.port },
      levelIds: s.level_ids,
      source: 'workshop' as const,
      expiresAt: s.manifest.server?.sign_off.expires_at ?? 0,
    }));
  }
}

function toAccessibleServer(s: DlcManifestServer): AccessibleServer {
  return {
    serverId: s.server_id,
    dlcAppId: s.dlc_appid,
    endpoint: { host: s.host, port: s.port },
    levelIds: s.level_ids,
    source: 'dlc',
    expiresAt: s.expires_at,
  };
}
