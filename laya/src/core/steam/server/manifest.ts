// DLC server connection manifest — issued by the Nakama reference service,
// signed with the account's personal key (bound at Steam-account binding
// time), verified by the client against the bound personal public key.
//
// Flow (docs/02-authorization.md §4):
//   client (owns DLC per Steam) -> RPC `dlc.servers`
//   Nakama: verify JWT -> bound steam_id -> Steam partner-API ownership
//           -> sign manifest covering ALL owned DLCs -> return
//   client: verify signature with bound personal public key -> refresh local
//           game content -> connect to bundled servers only for owned DLCs.

import type { CryptoProvider } from '../crypto/provider';
import { DLC_MANIFEST_VERSION } from '../types';
import { bytesToHex, canonicalJson, hexToBytes, isHex, utf8Encode } from '../util/hex';

export interface DlcManifestServer {
  server_id: string;
  dlc_appid: number;
  host: string;
  port: number;
  level_ids: string[];
  /**
   * Out-of-band session key material for the battle transport
   * (hex, 64 = 32-byte key), same pattern as the `battle.ticket` AEAD
   * key distribution (docs/battle-wire-scheme P2).
   */
  battle_session_key: string;
  /** Epoch ms after which the entry must be re-fetched. */
  expires_at: number;
}

export interface DlcAssetUpdate {
  asset_id: string;
  dlc_appid: number;
  url: string;
  sha256: string;
  size_bytes: number;
  target_path: string;
}

export interface DlcServerManifest {
  manifest_version: string;
  steam_id: string;
  issued_at: number;
  /** 32-hex replay nonce, per-account per-fetch. */
  nonce: string;
  servers: DlcManifestServer[];
  asset_updates: DlcAssetUpdate[];
  /** Ed25519 signature over the canonical form of the manifest minus this field. */
  signature: string;
}

export type ManifestErrorCode =
  | 'ok'
  | 'manifest_bad_version'
  | 'manifest_bad_shape'
  | 'manifest_signature_invalid'
  | 'manifest_account_mismatch'
  | 'manifest_clock_skew'
  | 'server_expired'
  | 'dlc_not_owned'
  | 'server_bad_endpoint'
  | 'asset_bad_source';

export interface ManifestCheck {
  ok: boolean;
  code: ManifestErrorCode;
  reason: string;
  servers: DlcManifestServer[];
}

/** Canonical signing/verification payload: manifest minus `signature`. */
export function manifestCanonicalBytes(manifest: DlcServerManifest): Uint8Array {
  const { signature, ...rest } = manifest;
  void signature;
  return utf8Encode(canonicalJson(rest));
}

export async function signManifest(
  manifest: DlcServerManifest,
  privateKeyHex: string,
  crypto: CryptoProvider,
): Promise<DlcServerManifest> {
  const sig = await crypto.sign(privateKeyHex, manifestCanonicalBytes({ ...manifest, signature: '' }));
  return { ...manifest, signature: bytesToHex(sig) };
}

export async function verifyManifestSignature(
  manifest: DlcServerManifest,
  personalPublicKeyHex: string,
  crypto: CryptoProvider,
): Promise<boolean> {
  if (!isHex(manifest.signature, 128)) return false;
  return crypto.verify(
    personalPublicKeyHex,
    manifestCanonicalBytes(manifest),
    hexToBytes(manifest.signature),
  );
}

export interface ManifestUsage {
  /** The Steam ID the client is connected with. */
  steamId: string;
  /** DLC appids the client actually owns (Steam-side list). */
  ownedDlcAppIds: readonly number[];
  nowMs: number;
  /** Clock-skew tolerance for issued_at / expires_at. */
  skewMs?: number;
}

/**
 * Verify the manifest is usable for this account right now: signature,
 * account binding, freshness, per-server expiry and ownership.
 */
export async function checkManifestUsable(
  manifest: DlcServerManifest,
  usage: ManifestUsage,
  personalPublicKeyHex: string,
  crypto: CryptoProvider,
): Promise<ManifestCheck> {
  const skew = usage.skewMs ?? 5 * 60 * 1000;

  if (manifest.manifest_version !== DLC_MANIFEST_VERSION) {
    return fail('manifest_bad_version', `expected ${DLC_MANIFEST_VERSION}`);
  }
  if (!isHex(manifest.nonce, 32)) {
    return fail('manifest_bad_shape', 'nonce must be 32 hex chars');
  }
  if (manifest.steam_id !== usage.steamId) {
    return fail('manifest_account_mismatch', `manifest issued for ${manifest.steam_id}`);
  }
  if (manifest.issued_at > usage.nowMs + skew) {
    return fail('manifest_clock_skew', 'manifest issued in the future');
  }
  if (!(await verifyManifestSignature(manifest, personalPublicKeyHex, crypto))) {
    return fail('manifest_signature_invalid', 'personal key signature did not verify');
  }

  const servers: DlcManifestServer[] = [];
  const seen = new Set<string>();
  for (const s of manifest.servers) {
    if (!isHex(s.battle_session_key, 64) || typeof s.host !== 'string' || s.host.length === 0 ||
        typeof s.port !== 'number' || s.port < 1 || s.port > 65535 ||
        !Array.isArray(s.level_ids) || s.level_ids.length === 0) {
      return fail('server_bad_endpoint', `server ${s.server_id} has an invalid endpoint`);
    }
    if (seen.has(s.server_id)) {
      return fail('manifest_bad_shape', `duplicate server_id ${s.server_id}`);
    }
    seen.add(s.server_id);
    if (s.expires_at <= usage.nowMs) {
      return fail('server_expired', `server ${s.server_id} expired at ${s.expires_at}`);
    }
    if (!usage.ownedDlcAppIds.includes(s.dlc_appid)) {
      return fail('dlc_not_owned', `server ${s.server_id} is bundled with DLC ${s.dlc_appid}, not owned`);
    }
    servers.push(s);
  }
  for (const a of manifest.asset_updates) {
    if (
      typeof a.url !== 'string' ||
      !(a.url.startsWith('https://') || a.url.startsWith('steamcdn://')) ||
      !isHex(a.sha256, 64) ||
      typeof a.target_path !== 'string' ||
      a.target_path.length === 0 ||
      a.target_path.startsWith('/') ||
      a.target_path.includes('..')
    ) {
      return fail('asset_bad_source', `asset ${a.asset_id} has an invalid source`);
    }
  }
  return { ok: true, code: 'ok', reason: 'manifest verified', servers };
}

function fail(code: ManifestErrorCode, reason: string): ManifestCheck {
  return { ok: false, code, reason, servers: [] };
}
