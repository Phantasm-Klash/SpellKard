/**
 * LayaAir-backed loader for the in-match gift icons.
 *
 * The six 64x64 PNGs under the gift asset root (see
 * {@link ../core/game/gift_assets}) are fetched once through `Laya.loader`
 * and memoised. Exactly like the TNA atlas source and the login art, the URL
 * root differs between the web build and the LayaNative publish, so `load()`
 * probes the candidate roots in order and keeps the first one that resolves
 * at least one icon.
 *
 * Failure is a first-class outcome, not an error: every miss falls through to
 * the caller, which keeps drawing the gift's vector glyph. A load that throws,
 * a 404, or a loader-less headless runtime all leave `texture()` returning
 * `null` — the gift bar never blanks and the render loop never sees an
 * exception.
 */

import { giftAssetRootCandidates, giftIconUrlAt } from '../../../core/game/gift_assets';
import { AssetLookupCache } from '../../../core/game/asset_lookup_cache';
import { giftCatalog } from '../../../core/game/gift_catalog';
import { isNativeAssetRuntime } from '../../../core/game/tna_assets';

/** File names of every icon the catalog asks for, in catalog order. */
const ICON_FILES: readonly string[] = giftCatalog()
  .map((definition) => definition.icon)
  .filter((icon): icon is string => icon !== undefined);

export class GiftIconSource {
  private readonly cache = new AssetLookupCache<Laya.Texture>(() => this.loaded);
  private readonly textures = new Map<string, Laya.Texture>();
  private roots: readonly string[];
  private root: string;
  private loaded = false;
  /** Shared promise so concurrent `load()` callers probe the roots only once. */
  private loadPromise: Promise<void> | null = null;

  constructor() {
    this.roots = giftAssetRootCandidates(isNativeAssetRuntime());
    this.root = this.roots[0];
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  /** Root actually in use (updated to the first candidate that resolved). */
  get resolvedRoot(): string {
    return this.root;
  }

  /**
   * Loads every catalog icon once, probing each candidate root until one
   * resolves at least one icon. Resolves even when the loader is unavailable
   * (headless / offline), in which case the caller keeps its vector fallback.
   * Never rejects.
   */
  load(): Promise<void> {
    if (this.loadPromise === null) {
      this.loadPromise = this.loadOnce();
    }
    return this.loadPromise;
  }

  private async loadOnce(): Promise<void> {
    for (const root of this.roots) {
      // eslint-disable-next-line no-await-in-loop -- roots are probed in order.
      const resolved = await this.tryLoadRoot(root);
      if (resolved > 0) {
        this.root = root;
        break;
      }
    }
    this.loaded = true;
  }

  /**
   * Loads every icon under `root`. Returns how many resolved; a per-icon
   * failure is skipped so one missing file cannot sink the others.
   */
  private async tryLoadRoot(root: string): Promise<number> {
    let resolved = 0;
    for (const icon of ICON_FILES) {
      // eslint-disable-next-line no-await-in-loop -- icons load sequentially.
      const texture = await this.loadTexture(giftIconUrlAt(root, icon));
      if (texture !== null) {
        this.textures.set(icon, texture);
        resolved += 1;
      }
    }
    return resolved;
  }

  /** The catalog icon texture, or `null` when it is not (yet) available. */
  texture(icon: string): Laya.Texture | null {
    return this.cache.resolve(icon, (name) => this.textures.get(name) ?? null);
  }

  /** Loads one image URL as a texture; returns `null` on any failure. */
  private async loadTexture(url: string): Promise<Laya.Texture | null> {
    let res: unknown;
    try {
      res = await Laya.loader.load(url, 'image');
    } catch {
      res = null;
    }
    let texture = unwrapTexture(res);
    if (texture === null || texture === undefined) {
      try {
        texture = unwrapTexture(Laya.loader.getRes(url));
      } catch {
        texture = null;
      }
    }
    return texture;
  }
}

/**
 * `Laya.loader.load(url, 'image')` normally resolves with the `Texture`, but
 * some engine builds resolve with a wrapper object whose texture lives under
 * `.data` / `.source`. A candidate without a `width` is rejected so the caller
 * keeps its fallback. Mirrors the login scene's unwrapping.
 */
function unwrapTexture(res: unknown): Laya.Texture | null {
  if (typeof res !== 'object' || res === null) {
    return null;
  }
  const record = res as Record<string, unknown>;
  if (typeof record.width === 'number') {
    return res as Laya.Texture;
  }
  for (const key of ['data', 'source', 'texture']) {
    const inner = record[key];
    if (typeof inner === 'object' && inner !== null) {
      const innerRecord = inner as Record<string, unknown>;
      if (typeof innerRecord.width === 'number') {
        return inner as unknown as Laya.Texture;
      }
    }
  }
  return null;
}

let sharedIcons: GiftIconSource | null = null;

/**
 * Process-wide icon source. The battle scene is the only consumer today, but
 * sharing the instance means the six files are fetched exactly once even if a
 * second scene (or a re-entered battle) asks for them.
 */
export function sharedGiftIconSource(): GiftIconSource {
  if (sharedIcons === null) {
    sharedIcons = new GiftIconSource();
  }
  return sharedIcons;
}
