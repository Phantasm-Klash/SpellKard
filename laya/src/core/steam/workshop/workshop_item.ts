// Workshop item manifest (format `pk-workshop-item-v0`).
//
// A Workshop item is a folder (downloaded by Steam under the subscribed
// items root) containing a `manifest.json` plus the referenced asset files.
// Kinds:
//   - portrait: specific character artwork
//   - theme:    UI theme (colors + optional skins)
//   - audio:    audio packs
//   - server:   third-party FREE battle server (no DLC entitlement required;
//               the server section is signed by the server owner's key so
//               the client can authenticate the endpoint)

import type { CryptoProvider } from '../crypto/provider';
import { assertSafeRelativePath, CatalogError, WORKSHOP_ITEM_FORMAT } from '../types';
import { canonicalJson, isHex, utf8Encode } from '../util/hex';

export type WorkshopItemKind = 'portrait' | 'theme' | 'audio' | 'server';

export interface WorkshopAsset {
  path: string;
  sha256: string;
  size_bytes: number;
}

export interface WorkshopServerSection {
  endpoint: { host: string; port: number };
  level_ids: string[];
  /** Ed25519 public key (64 hex) of the third-party server owner. */
  manifest_public_key: string;
  sign_off: {
    issued_at: number;
    expires_at: number;
    nonce: string;
    /** Ed25519 signature (128 hex) over the canonical sign-off payload. */
    signature: string;
  };
}

export interface WorkshopItemManifest {
  format: string;
  item_kind: WorkshopItemKind;
  item_id: string;
  version: string;
  creator: string;
  assets: WorkshopAsset[];
  server?: WorkshopServerSection;
}

const ITEM_KINDS: readonly WorkshopItemKind[] = ['portrait', 'theme', 'audio', 'server'];

export function parseWorkshopItemManifest(raw: unknown): WorkshopItemManifest {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CatalogError('workshop item: root must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const allowed = ['assets', 'creator', 'format', 'item_id', 'item_kind', 'server', 'version'];
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new CatalogError(`workshop item: unknown key "${key}"`);
    }
  }
  for (const key of ['assets', 'creator', 'format', 'item_id', 'item_kind', 'version']) {
    if (!(key in obj)) {
      throw new CatalogError(`workshop item: missing key "${key}"`);
    }
  }
  if (obj.format !== WORKSHOP_ITEM_FORMAT) {
    throw new CatalogError(`workshop item: format must be ${WORKSHOP_ITEM_FORMAT}`);
  }
  if (typeof obj.item_kind !== 'string' || !ITEM_KINDS.includes(obj.item_kind as WorkshopItemKind)) {
    throw new CatalogError(`workshop item: item_kind must be one of ${ITEM_KINDS.join(', ')}`);
  }
  for (const key of ['creator', 'item_id', 'version']) {
    if (typeof obj[key] !== 'string' || (obj[key] as string).length === 0) {
      throw new CatalogError(`workshop item: ${key} must be a non-empty string`);
    }
  }
  if (!Array.isArray(obj.assets) || obj.assets.length === 0) {
    throw new CatalogError('workshop item: assets must be a non-empty array');
  }
  const assets = obj.assets.map((a, i) => {
    if (a === null || typeof a !== 'object') {
      throw new CatalogError(`workshop item: assets[${i}] must be an object`);
    }
    const ao = a as Record<string, unknown>;
    for (const key of ['path', 'sha256', 'size_bytes']) {
      if (!(key in ao)) throw new CatalogError(`workshop item: assets[${i}] missing "${key}"`);
    }
    for (const key of Object.keys(ao)) {
      if (!['path', 'sha256', 'size_bytes'].includes(key)) {
        throw new CatalogError(`workshop item: assets[${i}] unknown key "${key}"`);
      }
    }
    assertSafeRelativePath(ao.path as string, `workshop item assets[${i}].path`);
    if (!isHex(ao.sha256 as string, 64)) {
      throw new CatalogError(`workshop item: assets[${i}].sha256 must be 64 hex chars`);
    }
    if (typeof ao.size_bytes !== 'number' || !(ao.size_bytes > 0)) {
      throw new CatalogError(`workshop item: assets[${i}].size_bytes must be a positive integer`);
    }
    return { path: ao.path as string, sha256: ao.sha256 as string, size_bytes: ao.size_bytes as number };
  });

  let server: WorkshopServerSection | undefined;
  if ('server' in obj) {
    if (obj.item_kind !== 'server') {
      throw new CatalogError('workshop item: only item_kind=server may carry a server section');
    }
    server = parseWorkshopServerSection(obj.server);
  } else if (obj.item_kind === 'server') {
    throw new CatalogError('workshop item: item_kind=server requires a server section');
  }

  return {
    format: WORKSHOP_ITEM_FORMAT,
    item_kind: obj.item_kind as WorkshopItemKind,
    item_id: obj.item_id as string,
    version: obj.version as string,
    creator: obj.creator as string,
    assets,
    ...(server !== undefined ? { server } : {}),
  };
}

function parseWorkshopServerSection(raw: unknown): WorkshopServerSection {
  if (raw === null || typeof raw !== 'object') {
    throw new CatalogError('workshop item: server section must be an object');
  }
  const obj = raw as Record<string, unknown>;
  for (const key of ['endpoint', 'level_ids', 'manifest_public_key', 'sign_off']) {
    if (!(key in obj)) throw new CatalogError(`workshop item server: missing "${key}"`);
  }
  for (const key of Object.keys(obj)) {
    if (!['endpoint', 'level_ids', 'manifest_public_key', 'sign_off'].includes(key)) {
      throw new CatalogError(`workshop item server: unknown key "${key}"`);
    }
  }
  const ep = obj.endpoint as Record<string, unknown>;
  if (ep === null || typeof ep !== 'object' || typeof ep.host !== 'string' || ep.host.length === 0 ||
      /\s/.test(ep.host) || typeof ep.port !== 'number' || !(ep.port >= 1 && ep.port <= 65535)) {
    throw new CatalogError('workshop item server: invalid endpoint');
  }
  if (!Array.isArray(obj.level_ids) || obj.level_ids.length === 0 ||
      (obj.level_ids as unknown[]).some((x) => typeof x !== 'string' || x.length === 0)) {
    throw new CatalogError('workshop item server: level_ids must be a non-empty string array');
  }
  if (!isHex(obj.manifest_public_key as string, 64)) {
    throw new CatalogError('workshop item server: manifest_public_key must be 64 hex chars');
  }
  const so = obj.sign_off as Record<string, unknown>;
  if (so === null || typeof so !== 'object') {
    throw new CatalogError('workshop item server: sign_off must be an object');
  }
  for (const key of ['expires_at', 'issued_at', 'nonce', 'signature']) {
    if (!(key in so)) throw new CatalogError(`workshop item server sign_off: missing "${key}"`);
  }
  for (const key of Object.keys(so)) {
    if (!['expires_at', 'issued_at', 'nonce', 'signature'].includes(key)) {
      throw new CatalogError(`workshop item server sign_off: unknown key "${key}"`);
    }
  }
  if (typeof so.issued_at !== 'number' || typeof so.expires_at !== 'number' || so.expires_at <= so.issued_at) {
    throw new CatalogError('workshop item server sign_off: expires_at must be after issued_at');
  }
  if (!isHex(so.nonce as string, 32) || !isHex(so.signature as string, 128)) {
    throw new CatalogError('workshop item server sign_off: nonce (32 hex) and signature (128 hex) required');
  }
  return {
    endpoint: { host: ep.host as string, port: ep.port as number },
    level_ids: obj.level_ids as string[],
    manifest_public_key: obj.manifest_public_key as string,
    sign_off: {
      issued_at: so.issued_at as number,
      expires_at: so.expires_at as number,
      nonce: so.nonce as string,
      signature: so.signature as string,
    },
  };
}

/**
 * Canonical payload the server owner signs: endpoint + levels + validity
 * window. Verification with the owner's public key authenticates that this
 * endpoint claim actually comes from the key the client was shown.
 */
export function workshopServerSignOffBytes(item: WorkshopItemManifest): Uint8Array {
  const s = item.server;
  if (s === undefined) throw new CatalogError('workshop item: not a server item');
  return utf8Encode(
    canonicalJson({
      endpoint: s.endpoint,
      expires_at: s.sign_off.expires_at,
      issued_at: s.sign_off.issued_at,
      level_ids: s.level_ids,
      nonce: s.sign_off.nonce,
    }),
  );
}

export async function verifyWorkshopServerSignOff(
  item: WorkshopItemManifest,
  crypto: CryptoProvider,
): Promise<boolean> {
  const s = item.server;
  if (s === undefined) return false;
  return crypto.verify(
    s.manifest_public_key,
    workshopServerSignOffBytes(item),
    hexToBytesSafe(s.sign_off.signature),
  );
}

function hexToBytesSafe(hex: string): Uint8Array {
  if (!isHex(hex)) return new Uint8Array(0);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function workshopServerFresh(item: WorkshopItemManifest, nowMs: number): boolean {
  const s = item.server;
  if (s === undefined) return false;
  return nowMs >= s.sign_off.issued_at - 5 * 60 * 1000 && nowMs < s.sign_off.expires_at;
}
