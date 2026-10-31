// Workshop loading pipeline: enumerate subscribed items -> validate
// manifest + verify every referenced asset's hash -> activate into the
// session registry. Third-party servers go through the same pipeline and
// require NO DLC entitlement (only the owner-key sign-off).

import type { CryptoProvider } from '../crypto/provider';
import type { WorkshopItemRef } from '../steam/steam_bridge';
import {
  parseWorkshopItemManifest,
  verifyWorkshopServerSignOff,
  workshopServerFresh,
  type WorkshopItemManifest,
  type WorkshopServerSection,
} from './workshop_item';
import { utf8Decode } from '../util/hex';

export interface WorkshopItemSource {
  listItems(): Promise<WorkshopItemRef[]>;
  /** Read a file (utf-8 json or binary) from an installed item root. */
  readItemFile(item: WorkshopItemRef, relPath: string): Promise<Uint8Array | null>;
}

export type ActivationStatus = 'activated' | 'skipped' | 'failed';

export interface ActivatedWorkshopItem {
  publishedFileId: string;
  status: ActivationStatus;
  detail: string | null;
  manifest: WorkshopItemManifest | null;
}

export interface WorkshopRegistry {
  /** item_id -> item root path, grouped per kind. */
  portraits: Map<string, string>;
  themes: Map<string, string>;
  audio: Map<string, string>;
  /** server_id (host:port) -> validated third-party server. */
  servers: Map<string, { endpoint: { host: string; port: number }; level_ids: string[]; manifest: WorkshopItemManifest }>;
}

export function emptyWorkshopRegistry(): WorkshopRegistry {
  return { portraits: new Map(), themes: new Map(), audio: new Map(), servers: new Map() };
}

const MANIFEST_FILENAME = 'manifest.json';

export async function loadWorkshopItems(
  source: WorkshopItemSource,
  crypto: CryptoProvider,
  nowMs: number,
): Promise<{ items: ActivatedWorkshopItem[]; registry: WorkshopRegistry }> {
  const registry = emptyWorkshopRegistry();
  const items: ActivatedWorkshopItem[] = [];
  const refs = await source.listItems();

  for (const ref of refs) {
    if (ref.localPath === null) {
      items.push({ publishedFileId: ref.publishedFileId, status: 'skipped', detail: 'item not installed yet', manifest: null });
      continue;
    }
    const manifestBytes = await source.readItemFile(ref, MANIFEST_FILENAME);
    if (manifestBytes === null) {
      items.push({ publishedFileId: ref.publishedFileId, status: 'failed', detail: `${MANIFEST_FILENAME} missing`, manifest: null });
      continue;
    }
    let manifest: WorkshopItemManifest;
    try {
      manifest = parseWorkshopItemManifest(JSON.parse(utf8Decode(manifestBytes)));
    } catch (err) {
      items.push({
        publishedFileId: ref.publishedFileId,
        status: 'failed',
        detail: err instanceof Error ? err.message : String(err),
        manifest: null,
      });
      continue;
    }

    // Verify every referenced asset exists and matches its hash.
    let assetError: string | null = null;
    for (const asset of manifest.assets) {
      const bytes = await source.readItemFile(ref, asset.path);
      if (bytes === null) {
        assetError = `asset ${asset.path} missing`;
        break;
      }
      const hash = await crypto.sha256Hex(bytes);
      if (hash !== asset.sha256) {
        assetError = `asset ${asset.path} hash mismatch`;
        break;
      }
      if (bytes.length !== asset.size_bytes) {
        assetError = `asset ${asset.path} size mismatch`;
        break;
      }
    }
    if (assetError !== null) {
      items.push({ publishedFileId: ref.publishedFileId, status: 'failed', detail: assetError, manifest });
      continue;
    }

    if (manifest.item_kind === 'server') {
      const okSignOff = await verifyWorkshopServerSignOff(manifest, crypto);
      const fresh = workshopServerFresh(manifest, nowMs);
      if (!okSignOff || !fresh) {
        items.push({
          publishedFileId: ref.publishedFileId,
          status: 'failed',
          detail: okSignOff ? 'server sign-off expired' : 'server sign-off invalid',
          manifest,
        });
        continue;
      }
      const s = manifest.server as WorkshopServerSection;
      registry.servers.set(`${s.endpoint.host}:${s.endpoint.port}`, {
        endpoint: s.endpoint,
        level_ids: s.level_ids,
        manifest,
      });
    } else if (manifest.item_kind === 'portrait') {
      registry.portraits.set(manifest.item_id, ref.localPath);
    } else if (manifest.item_kind === 'theme') {
      registry.themes.set(manifest.item_id, ref.localPath);
    } else {
      registry.audio.set(manifest.item_id, ref.localPath);
    }
    items.push({ publishedFileId: ref.publishedFileId, status: 'activated', detail: null, manifest });
  }
  return { items, registry };
}
