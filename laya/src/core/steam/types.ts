// Wire types shared by the DLC catalog, entitlement gate, server manifest
// and Workshop loader. JSON shapes match the Go reference implementation in
// server/gensoulkyo-reference (see docs/01-dlc-model.md for the spec).

export const DLC_CATALOG_VERSION = 'dlc-catalog-v0';
export const DLC_MANIFEST_VERSION = 'dlc-manifest-v0';
export const WORKSHOP_ITEM_FORMAT = 'pk-workshop-item-v0';

/** Asset families a DLC may bundle (icons / audio / themes / backgrounds). */
export type DlcAssetKind = 'icons' | 'audio' | 'theme' | 'background';

export interface DlcAssetPack {
  kind: DlcAssetKind;
  asset_id: string;
  source: {
    /** https:// CDN URL or steamcdn:// URL. */
    url: string;
    sha256: string;
    size_bytes: number;
  };
  /**
   * Path of the unpacked asset, relative to the DLC content root.
   * No absolute paths, no backslashes, no `..` segments.
   */
  target_path: string;
}

/** A server-authoritative battle level distributed by Nakama. */
export interface DlcLevel {
  level_id: string;
  mode_id: string;
  boss_id?: string;
  ruleset?: string;
}

/**
 * One Steam achievement, bound to a level. `id` is the Steamworks
 * achievement identifier (created in the partner portal); it must be stable
 * forever — Steam achievements cannot be renamed or deleted once granted.
 */
export interface CatalogAchievement {
  id: string;
  /** Display name (shown in the Steam overlay / achievements list). */
  name: string;
  /** The level whose completion unlocks it. */
  level_id: string;
  /** Base game appid, or the appid of the DLC owning the level. */
  dlc_appid: number;
}

/** A server bundled inside a DLC. */
export interface DlcServerDef {
  server_id: string;
  host: string;
  port: number;
  level_ids: string[];
}

export interface DlcEntry {
  dlc_id: string;
  steam_appid: number;
  name: string;
  asset_packs: DlcAssetPack[];
  levels: DlcLevel[];
  servers: DlcServerDef[];
}

export interface DlcCatalog {
  catalog_version: string;
  base_game: { appid: number; free: true };
  free_p2p: { enabled: true };
  dlcs: DlcEntry[];
  /** Free levels shipped with the base game (not gated by any DLC). */
  base_levels: DlcLevel[];
  /** Steam achievements, one per level (base + DLC). */
  achievements: CatalogAchievement[];
}

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogError';
  }
}

/** Relative-path safety shared by catalog asset packs and Workshop items. */
export function assertSafeRelativePath(path: string, what: string): void {
  if (typeof path !== 'string' || path.length === 0 || path.length > 256) {
    throw new CatalogError(`${what}: path must be a non-empty string ≤256 chars`);
  }
  if (path.includes('\0')) {
    throw new CatalogError(`${what}: path contains NUL`);
  }
  if (path.includes('\\')) {
    throw new CatalogError(`${what}: backslashes are not allowed in ${path}`);
  }
  if (path.startsWith('/')) {
    throw new CatalogError(`${what}: absolute paths are not allowed: ${path}`);
  }
  const segments = path.split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw new CatalogError(`${what}: invalid segment "${seg}" in ${path}`);
    }
  }
}

export function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

export function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
