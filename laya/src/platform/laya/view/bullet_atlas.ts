/**
 * LayaAir-backed atlas frame source for the real-danmaku renderer.
 *
 * The imported 千夜追忆 art lives under `layaide/assets/resources/tna/` as 25
 * LayaAir `.atlas` files (6 bullet atlases + vanish + 4 enemy atlases + 13
 * player-shot atlases + effect), a standalone backdrop image, and the 13 player
 * portraits.
 *
 * Why we slice the atlas ourselves instead of handing it to `Laya.loader`:
 *
 *  - The engine dispatches `.atlas` to `AtlasLoader`, which dereferences
 *    `obj.spriteSourceSize.x` with no guard. Our imported files record the trim
 *    offset under **`offset`**, not `spriteSourceSize`, so the loader throws a
 *    `TypeError`, the load rejects, and the whole battle silently falls back to
 *    vector art. We therefore load the `.atlas` as plain **JSON** (`'json'`
 *    type, passed as the *second* argument — `load(url, null, null, 'json')`
 *    silently drops the type) and slice the texture with `Texture.create` via
 *    the engine-agnostic `core/game/tna_atlas_frames` helper.
 *  - `atlasUrl#frameName` is **not** a LayaAir 3 sub-texture convention (the
 *    engine has no such syntax), so we key our own `Map` by
 *    `${atlas}/${frameName}` instead of relying on the global loader cache.
 *
 * The root differs between the web build (served from `laya/`, so
 * `layaide/assets/resources/tna`) and the LayaNative / IDE publish (the assets
 * land under the packaged resource root as `resources/tna`). `load()` therefore
 * probes the ordered candidates from `core/game/tna_assets` and keeps the first
 * root that slices **at least one frame** — a wrong guess costs a couple of
 * failed loads instead of silently degrading the whole battle to vector art.
 *
 * NOTE: `platform/laya/` only. Never import from `core/` other than the
 *       engine-agnostic descriptor / path / cache helpers.
 */

import { describeBulletKind } from '../../../core/game/bullet_visual';
import { AssetLookupCache } from '../../../core/game/asset_lookup_cache';
import { TNA_BACKGROUND_IMAGE } from '../../../core/game/tna_actor_frames';
import { sliceAtlasFrames, type TnaAtlasJson } from '../../../core/game/tna_atlas_frames';
import {
  TNA_WEB_ROOT,
  isNativeAssetRuntime,
  tnaAtlasRootCandidates,
} from '../../../core/game/tna_assets';

/** Resolves an atlas frame to a texture; returns `null` when unavailable. */
export interface BulletFrameSource {
  frame(atlas: string, frameName: string): Laya.Texture | null;
}

/** Resolves a standalone (non-atlas) texture by file name. */
export interface AtlasImageSource {
  image(name: string): Laya.Texture | null;
}

/** Atlas file names imported by `tools/import_tna_atlas.py`. */
export const TNA_ATLAS_NAMES: readonly string[] = [
  'bulletlist01',
  'bulletlist02',
  'bulletlist03',
  'bulletlist04',
  'bulletlist05',
  'bulletlist06',
  'bulletvanish',
  'enemylist01',
  'enemylist02',
  'enemylist03',
  'enemylist04',
  'ply_effect_01',
  'ply_shot_01',
  'ply_shot_02',
  'ply_shot_03',
  'ply_shot_04',
  'ply_shot_05',
  'ply_shot_06',
  'ply_shot_07',
  'ply_shot_08',
  'ply_shot_09',
  'ply_shot_10',
  'ply_shot_11',
  'ply_shot_12',
  'ply_shot_13',
];

/** Standalone textures loaded alongside the atlases (playfield backdrop). */
export const TNA_STANDALONE_IMAGES: readonly string[] = [TNA_BACKGROUND_IMAGE];

/**
 * Default asset root. Kept for back-compat; the web build is the common case,
 * so this is the web path. Native callers get `resources/tna` via the probe.
 */
export const DEFAULT_TNA_ATLAS_ROOT = TNA_WEB_ROOT;

/**
 * LayaAir loader wrapper. Atlas frames are sliced once by `load()` into a local
 * `Map`; standalone image lookups are memoised. A miss is only cached once
 * `load()` has finished — before that a miss is transient and must not pin the
 * renderer to its fallback.
 */
export class LayaAtlasFrameSource implements BulletFrameSource, AtlasImageSource {
  private readonly imageCache = new AssetLookupCache<Laya.Texture>(() => this.loaded);
  private readonly frames = new Map<string, Laya.Texture>();
  private readonly roots: readonly string[];
  private root: string;
  private loaded = false;

  constructor(
    root?: string,
    private readonly atlases: readonly string[] = TNA_ATLAS_NAMES,
    private readonly images: readonly string[] = TNA_STANDALONE_IMAGES,
  ) {
    this.roots = root !== undefined ? [root] : tnaAtlasRootCandidates(isNativeAssetRuntime());
    this.root = this.roots[0];
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  /** Root actually in use (updated to the first candidate that resolved). */
  get resolvedRoot(): string {
    return this.root;
  }

  /** Candidate roots probed by `load()`, in order. */
  get candidateRoots(): readonly string[] {
    return this.roots;
  }

  /**
   * Loads every atlas + standalone image once, probing each candidate root
   * until one slices at least one frame. Resolves even when the loader is
   * unavailable (headless / offline), in which case the renderer keeps its
   * vector fallback.
   */
  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    for (const root of this.roots) {
      // eslint-disable-next-line no-await-in-loop -- roots are probed in order.
      const ok = await this.tryLoadRoot(root);
      if (ok) {
        this.root = root;
        break;
      }
    }
    this.loaded = true;
  }

  frame(atlas: string, frameName: string): Laya.Texture | null {
    return this.frames.get(`${atlas}/${frameName}`) ?? null;
  }

  image(name: string): Laya.Texture | null {
    return this.imageCache.resolve(name, () => this.readTexture(`${this.root}/${name}`));
  }

  /** Frame source that also resolves a `kEnemyBullet` value to its frame. */
  frameForKind(bulletKind: number): Laya.Texture | null {
    const descriptor = describeBulletKind(bulletKind);
    if (descriptor === null) {
      return null;
    }
    return this.frame(descriptor.atlas, descriptor.frame);
  }

  /** Attempts to load one root; returns whether any atlas sliced a frame. */
  private async tryLoadRoot(root: string): Promise<boolean> {
    const sliced = new Map<string, Laya.Texture>();
    let count = 0;
    for (const atlas of this.atlases) {
      // eslint-disable-next-line no-await-in-loop -- atlases load sequentially.
      count += await this.loadAtlasInto(root, atlas, sliced);
    }
    if (count === 0) {
      return false;
    }
    this.frames.clear();
    for (const [key, texture] of sliced) {
      this.frames.set(key, texture);
    }
    for (const name of this.images) {
      // eslint-disable-next-line no-await-in-loop -- standalone images load sequentially.
      await this.loadImage(`${root}/${name}`);
    }
    return true;
  }

  /**
   * Loads one atlas (`json` + its backing image) and slices each frame into
   * `into`. Returns the number of frames successfully sliced.
   */
  private async loadAtlasInto(root: string, atlas: string, into: Map<string, Laya.Texture>): Promise<number> {
    const json = await this.loadJson(`${root}/${atlas}.atlas`);
    if (json === null) {
      return 0;
    }
    const image = typeof json.meta?.image === 'string' ? json.meta.image : '';
    if (image === '') {
      return 0;
    }
    const texture = await this.loadImage(`${root}/${image}`);
    if (texture === null) {
      return 0;
    }
    let sliced = 0;
    for (const rect of sliceAtlasFrames(json)) {
      try {
        // Args 6/7 are the trim offset; args 8/9 are the untrimmed size.
        const sub = Laya.Texture.create(
          texture,
          rect.x,
          rect.y,
          rect.w,
          rect.h,
          rect.offsetX,
          rect.offsetY,
          rect.sourceW,
          rect.sourceH,
        );
        if (sub) {
          into.set(`${atlas}/${rect.name}`, sub);
          sliced += 1;
        }
      } catch {
        // One bad frame must not abort the whole atlas.
      }
    }
    return sliced;
  }

  /** Loads an `.atlas` as JSON. Returns `null` on any failure (never throws). */
  private async loadJson(url: string): Promise<TnaAtlasJson | null> {
    let res: unknown;
    try {
      res = await Laya.loader.load(url, 'json');
    } catch {
      res = null;
    }
    if (res === null || res === undefined) {
      res = this.readRes(url);
    }
    return unwrapAtlasJson(res);
  }

  /** Loads an image and returns the resulting texture, or `null` on failure. */
  private async loadImage(url: string): Promise<Laya.Texture | null> {
    try {
      await Laya.loader.load(url, 'image');
    } catch {
      // Fall through to a cache probe.
    }
    return this.readTexture(url);
  }

  private readTexture(url: string): Laya.Texture | null {
    return (this.readRes(url) as Laya.Texture | null | undefined) ?? null;
  }

  private readRes(url: string): unknown {
    try {
      return Laya.loader.getRes(url);
    } catch {
      return null;
    }
  }
}

let sharedSource: LayaAtlasFrameSource | null = null;

/**
 * Unwraps the value returned by LayaAir's JSON loader.
 *
 * The engine's `JsonAssetLoader` returns a `TextResource` whose parsed value
 * lives on `.data` (NOT the resource itself). A raw object (already-unwrapped
 * value, e.g. from a stub or a future engine) is passed through unchanged.
 */
function unwrapAtlasJson(res: unknown): TnaAtlasJson | null {
  if (typeof res !== 'object' || res === null) {
    return null;
  }
  const record = res as Record<string, unknown>;
  const data = record.data;
  if (typeof data === 'object' && data !== null) {
    return data as TnaAtlasJson;
  }
  return record as TnaAtlasJson;
}

/**
 * Process-wide frame source. `BossRaceView` and the bullet renderer share one
 * instance so the 25 atlases are sliced (and the root probed) exactly once.
 */
export function sharedTnaFrameSource(): LayaAtlasFrameSource {
  if (sharedSource === null) {
    sharedSource = new LayaAtlasFrameSource();
  }
  return sharedSource;
}
