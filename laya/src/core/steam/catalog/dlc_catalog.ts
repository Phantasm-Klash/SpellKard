import {
  assertSafeRelativePath,
  CatalogError,
  DLC_CATALOG_VERSION,
  isNonEmptyString,
  isPositiveInt,
  isPort,
  type CatalogAchievement,
  type DlcAssetKind,
  type DlcAssetPack,
  type DlcCatalog,
  type DlcEntry,
  type DlcLevel,
  type DlcServerDef,
} from '../types';
import { isHex } from '../util/hex';

const ASSET_KINDS: readonly DlcAssetKind[] = ['icons', 'audio', 'theme', 'background'];

/**
 * Parse and strictly validate a DLC catalog. Unknown keys are rejected at
 * every level — the catalog is a machine-checked contract between the store
 * tooling and the client/Nakama reference service.
 */
export function parseDlcCatalog(raw: unknown): DlcCatalog {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CatalogError('catalog: root must be an object');
  }
  const obj = raw as Record<string, unknown>;
  requireExactKeys(
    obj,
    ['base_game', 'catalog_version', 'dlcs', 'free_p2p'],
    ['base_levels', 'achievements'],
    'catalog',
  );

  if (obj.catalog_version !== DLC_CATALOG_VERSION) {
    throw new CatalogError(`catalog: catalog_version must be ${DLC_CATALOG_VERSION}`);
  }

  const baseRaw = obj.base_game as Record<string, unknown>;
  if (baseRaw === null || typeof baseRaw !== 'object') {
    throw new CatalogError('catalog: base_game must be an object');
  }
  requireExactKeys(baseRaw, ['appid', 'free'], [], 'base_game');
  if (!isPositiveInt(baseRaw.appid)) {
    throw new CatalogError('catalog: base_game.appid must be a positive integer');
  }
  if (baseRaw.free !== true) {
    throw new CatalogError('catalog: base_game.free must be true (base content is free)');
  }

  const p2pRaw = obj.free_p2p as Record<string, unknown>;
  if (p2pRaw === null || typeof p2pRaw !== 'object') {
    throw new CatalogError('catalog: free_p2p must be an object');
  }
  requireExactKeys(p2pRaw, ['enabled'], [], 'free_p2p');
  if (p2pRaw.enabled !== true) {
    throw new CatalogError('catalog: free_p2p.enabled must be true (P2P battles are free)');
  }

  if (!Array.isArray(obj.dlcs) || obj.dlcs.length === 0) {
    throw new CatalogError('catalog: dlcs must be a non-empty array');
  }

  const dlcs = obj.dlcs.map((d, i) => parseDlcEntry(d, i, baseRaw.appid as number));
  const seenAppIds = new Set<number>();
  const seenDlcIds = new Set<string>();
  for (const d of dlcs) {
    if (seenAppIds.has(d.steam_appid)) {
      throw new CatalogError(`catalog: duplicate steam_appid ${d.steam_appid}`);
    }
    if (seenDlcIds.has(d.dlc_id)) {
      throw new CatalogError(`catalog: duplicate dlc_id ${d.dlc_id}`);
    }
    seenAppIds.add(d.steam_appid);
    seenDlcIds.add(d.dlc_id);
  }

  const baseLevels = parseLevels(obj.base_levels ?? [], 'base_levels');
  const achievements = parseAchievements(
    obj.achievements ?? [],
    baseLevels,
    dlcs,
    baseRaw.appid as number,
  );

  return {
    catalog_version: DLC_CATALOG_VERSION,
    base_game: { appid: baseRaw.appid as number, free: true },
    free_p2p: { enabled: true },
    dlcs,
    base_levels: baseLevels,
    achievements,
  };
}

/** Steam achievement ids are portal identifiers: stable, no spaces. */
const ACHIEVEMENT_ID_RE = /^[A-Za-z0-9_]{3,64}$/;

function parseAchievements(
  raw: unknown,
  baseLevels: DlcLevel[],
  dlcs: DlcEntry[],
  baseAppId: number,
): CatalogAchievement[] {
  if (!Array.isArray(raw)) {
    throw new CatalogError('catalog.achievements: must be an array');
  }
  const levelToAppId = new Map<string, number>();
  for (const l of baseLevels) levelToAppId.set(l.level_id, baseAppId);
  for (const d of dlcs) for (const l of d.levels) levelToAppId.set(l.level_id, d.steam_appid);

  const out: CatalogAchievement[] = [];
  const seenIds = new Set<string>();
  const seenLevelIds = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i] as Record<string, unknown> | null;
    const where = `achievements[${i}]`;
    if (a === null || typeof a !== 'object' || Array.isArray(a)) {
      throw new CatalogError(`${where}: must be an object`);
    }
    requireExactKeys(a, ['dlc_appid', 'id', 'level_id', 'name'], [], where);
    if (typeof a.id !== 'string' || !ACHIEVEMENT_ID_RE.test(a.id)) {
      throw new CatalogError(
        `${where}.id: must match ${ACHIEVEMENT_ID_RE} (Steam achievement identifier)`,
      );
    }
    if (!isNonEmptyString(a.name) || (a.name as string).length > 256) {
      throw new CatalogError(`${where}.name: non-empty string ≤256 chars required`);
    }
    if (!isNonEmptyString(a.level_id)) {
      throw new CatalogError(`${where}.level_id: non-empty string required`);
    }
    if (!isPositiveInt(a.dlc_appid)) {
      throw new CatalogError(`${where}.dlc_appid: positive integer required`);
    }
    const owner = levelToAppId.get(a.level_id as string);
    if (owner === undefined) {
      throw new CatalogError(`${where}.level_id: unknown level "${a.level_id}"`);
    }
    if (owner !== (a.dlc_appid as number)) {
      throw new CatalogError(
        `${where}.dlc_appid: level ${a.level_id} belongs to appid ${owner}, not ${a.dlc_appid}`,
      );
    }
    if (seenIds.has(a.id)) {
      throw new CatalogError(`${where}.id: duplicate achievement id ${a.id}`);
    }
    if (seenLevelIds.has(a.level_id)) {
      throw new CatalogError(`${where}.level_id: level ${a.level_id} has more than one achievement`);
    }
    seenIds.add(a.id);
    seenLevelIds.add(a.level_id as string);
    out.push({
      id: a.id,
      name: a.name,
      level_id: a.level_id as string,
      dlc_appid: a.dlc_appid as number,
    });
  }
  return out;
}

function parseDlcEntry(raw: unknown, index: number, baseAppId: number): DlcEntry {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CatalogError(`dlcs[${index}]: must be an object`);
  }
  const obj = raw as Record<string, unknown>;
  requireExactKeys(
    obj,
    ['asset_packs', 'dlc_id', 'levels', 'name', 'servers', 'steam_appid'],
    [],
    `dlcs[${index}]`,
  );
  if (!isNonEmptyString(obj.dlc_id)) {
    throw new CatalogError(`dlcs[${index}].dlc_id: non-empty string required`);
  }
  if (!isPositiveInt(obj.steam_appid)) {
    throw new CatalogError(`dlcs[${index}].steam_appid: positive integer required`);
  }
  if (obj.steam_appid === baseAppId) {
    throw new CatalogError(`dlcs[${index}].steam_appid: must differ from base game appid`);
  }
  if (!isNonEmptyString(obj.name)) {
    throw new CatalogError(`dlcs[${index}].name: non-empty string required`);
  }

  const assetPacks = parseAssetPacks(obj.asset_packs, index);
  const levels = parseLevels(obj.levels, `dlcs[${index}].levels`);
  const servers = parseServers(obj.servers, index, levels.map((l) => l.level_id));

  if (assetPacks.length === 0 && levels.length === 0) {
    throw new CatalogError(`dlcs[${index}]: must define at least one asset pack or level`);
  }

  return {
    dlc_id: obj.dlc_id,
    steam_appid: obj.steam_appid,
    name: obj.name,
    asset_packs: assetPacks,
    levels,
    servers,
  };
}

function parseAssetPacks(raw: unknown, index: number): DlcAssetPack[] {
  if (!Array.isArray(raw)) {
    throw new CatalogError(`dlcs[${index}].asset_packs: must be an array`);
  }
  const seen = new Set<string>();
  return raw.map((a, i) => {
    if (a === null || typeof a !== 'object') {
      throw new CatalogError(`dlcs[${index}].asset_packs[${i}]: must be an object`);
    }
    const obj = a as Record<string, unknown>;
    requireExactKeys(obj, ['asset_id', 'kind', 'source', 'target_path'], [], `dlcs[${index}].asset_packs[${i}]`);
    if (!isNonEmptyString(obj.asset_id) || seen.has(obj.asset_id)) {
      throw new CatalogError(`dlcs[${index}].asset_packs[${i}].asset_id: unique non-empty string required`);
    }
    seen.add(obj.asset_id);
    if (!ASSET_KINDS.includes(obj.kind as DlcAssetKind)) {
      throw new CatalogError(`dlcs[${index}].asset_packs[${i}].kind: one of ${ASSET_KINDS.join(', ')}`);
    }
    const src = obj.source as Record<string, unknown>;
    if (src === null || typeof src !== 'object') {
      throw new CatalogError(`dlcs[${index}].asset_packs[${i}].source: must be an object`);
    }
    requireExactKeys(src, ['sha256', 'size_bytes', 'url'], [], `dlcs[${index}].asset_packs[${i}].source`);
    if (typeof src.url !== 'string' || !(src.url.startsWith('https://') || src.url.startsWith('steamcdn://'))) {
      throw new CatalogError(`dlcs[${index}].asset_packs[${i}].source.url: must be https:// or steamcdn://`);
    }
    if (!isHex(src.sha256 as string, 64)) {
      throw new CatalogError(`dlcs[${index}].asset_packs[${i}].source.sha256: 64 hex chars required`);
    }
    if (!isPositiveInt(src.size_bytes)) {
      throw new CatalogError(`dlcs[${index}].asset_packs[${i}].source.size_bytes: positive integer required`);
    }
    assertSafeRelativePath(obj.target_path as string, `dlcs[${index}].asset_packs[${i}].target_path`);
    return {
      kind: obj.kind as DlcAssetKind,
      asset_id: obj.asset_id,
      source: {
        url: src.url as string,
        sha256: src.sha256 as string,
        size_bytes: src.size_bytes as number,
      },
      target_path: obj.target_path as string,
    };
  });
}

function parseLevels(raw: unknown, where: string): DlcLevel[] {
  if (!Array.isArray(raw)) {
    throw new CatalogError(`${where}: must be an array`);
  }
  const seen = new Set<string>();
  return raw.map((l, i) => {
    if (l === null || typeof l !== 'object') {
      throw new CatalogError(`${where}[${i}]: must be an object`);
    }
    const obj = l as Record<string, unknown>;
    requireExactKeys(obj, ['level_id', 'mode_id'], ['boss_id', 'ruleset'], `${where}[${i}]`);
    if (!isNonEmptyString(obj.level_id) || seen.has(obj.level_id)) {
      throw new CatalogError(`${where}[${i}].level_id: unique non-empty string required`);
    }
    seen.add(obj.level_id);
    if (!isNonEmptyString(obj.mode_id)) {
      throw new CatalogError(`${where}[${i}].mode_id: non-empty string required`);
    }
    if (obj.boss_id !== undefined && !isNonEmptyString(obj.boss_id)) {
      throw new CatalogError(`${where}[${i}].boss_id: non-empty string required when present`);
    }
    if (obj.ruleset !== undefined && !isNonEmptyString(obj.ruleset)) {
      throw new CatalogError(`${where}[${i}].ruleset: non-empty string required when present`);
    }
    const level: DlcLevel = { level_id: obj.level_id, mode_id: obj.mode_id };
    if (obj.boss_id !== undefined) level.boss_id = obj.boss_id;
    if (obj.ruleset !== undefined) level.ruleset = obj.ruleset;
    return level;
  });
}

function parseServers(raw: unknown, index: number, levelIds: string[]): DlcServerDef[] {
  if (!Array.isArray(raw)) {
    throw new CatalogError(`dlcs[${index}].servers: must be an array`);
  }
  const levelSet = new Set(levelIds);
  const seen = new Set<string>();
  return raw.map((s, i) => {
    if (s === null || typeof s !== 'object') {
      throw new CatalogError(`dlcs[${index}].servers[${i}]: must be an object`);
    }
    const obj = s as Record<string, unknown>;
    requireExactKeys(obj, ['host', 'level_ids', 'port', 'server_id'], [], `dlcs[${index}].servers[${i}]`);
    if (!isNonEmptyString(obj.server_id)) {
      throw new CatalogError(`dlcs[${index}].servers[${i}].server_id: non-empty string required`);
    }
    if (seen.has(obj.server_id)) {
      throw new CatalogError(`dlcs[${index}].servers[${i}].server_id: duplicate server_id ${obj.server_id}`);
    }
    seen.add(obj.server_id);
    if (typeof obj.host !== 'string' || obj.host.length === 0 || /\s/.test(obj.host)) {
      throw new CatalogError(`dlcs[${index}].servers[${i}].host: non-empty string without whitespace required`);
    }
    if (!isPort(obj.port)) {
      throw new CatalogError(`dlcs[${index}].servers[${i}].port: integer 1..65535 required`);
    }
    if (!Array.isArray(obj.level_ids) || obj.level_ids.length === 0) {
      throw new CatalogError(`dlcs[${index}].servers[${i}].level_ids: non-empty array required`);
    }
    for (const lid of obj.level_ids) {
      if (typeof lid !== 'string' || !levelSet.has(lid)) {
        throw new CatalogError(`dlcs[${index}].servers[${i}].level_ids: unknown level id "${String(lid)}"`);
      }
    }
    return {
      server_id: obj.server_id,
      host: obj.host as string,
      port: obj.port as number,
      level_ids: obj.level_ids as string[],
    };
  });
}

function requireExactKeys(
  obj: Record<string, unknown>,
  required: string[],
  optional: string[],
  what: string,
): void {
  const allowed = required.concat(optional);
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k)).sort();
  if (extra.length > 0) {
    throw new CatalogError(`${what}: unknown key(s) ${extra.join(', ')}`);
  }
  for (const key of required) {
    if (!(key in obj)) {
      throw new CatalogError(`${what}: missing key "${key}"`);
    }
  }
}
