// Local game content refresh driven by the DLC server manifest.
//
// After the client fetches and verifies the manifest, every owned DLC's
// asset updates (icons / audio / themes / backgrounds) are reconciled into
// the local content store:
//   - already present with matching sha256  -> skipped
//   - missing or different                  -> downloaded, hash-verified, written
//   - hash mismatch after download          -> failed (nothing written)

import type { CryptoProvider } from '../crypto/provider';
import type { DlcAssetUpdate } from './manifest';

export interface ContentStore {
  read(targetPath: string): Promise<Uint8Array | null>;
  write(targetPath: string, bytes: Uint8Array): Promise<void>;
}

export interface AssetFetcher {
  fetchBytes(url: string): Promise<Uint8Array>;
}

export type ContentStatus = 'installed' | 'updated' | 'skipped' | 'failed';

export interface ContentUpdateResult {
  assetId: string;
  status: ContentStatus;
  detail: string | null;
}

export async function applyAssetUpdates(
  updates: readonly DlcAssetUpdate[],
  store: ContentStore,
  fetcher: AssetFetcher,
  crypto: CryptoProvider,
): Promise<ContentUpdateResult[]> {
  const results: ContentUpdateResult[] = [];
  for (const update of updates) {
    try {
      const existing = await store.read(update.target_path);
      if (existing !== null) {
        const existingHash = await crypto.sha256Hex(existing);
        if (existingHash === update.sha256) {
          results.push({ assetId: update.asset_id, status: 'skipped', detail: 'already current' });
          continue;
        }
        const bytes = await fetcher.fetchBytes(update.url);
        const hash = await crypto.sha256Hex(bytes);
        if (hash !== update.sha256) {
          results.push({
            assetId: update.asset_id,
            status: 'failed',
            detail: `download hash ${hash} != expected ${update.sha256}`,
          });
          continue;
        }
        await store.write(update.target_path, bytes);
        results.push({ assetId: update.asset_id, status: 'updated', detail: null });
      } else {
        const bytes = await fetcher.fetchBytes(update.url);
        const hash = await crypto.sha256Hex(bytes);
        if (hash !== update.sha256) {
          results.push({
            assetId: update.asset_id,
            status: 'failed',
            detail: `download hash ${hash} != expected ${update.sha256}`,
          });
          continue;
        }
        await store.write(update.target_path, bytes);
        results.push({ assetId: update.asset_id, status: 'installed', detail: null });
      }
    } catch (err) {
      results.push({
        assetId: update.asset_id,
        status: 'failed',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
