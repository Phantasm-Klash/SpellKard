/**
 * Lookup cache for asynchronously-loaded assets.
 *
 * The bug it fixes: the old frame cache stored a `null` miss the very first
 * time a frame was asked for — even while the atlas was still downloading — and
 * then served that `null` forever, pinning the renderer to its vector fallback.
 *
 * Rule: a **miss is only cached once the source reports itself ready**. Before
 * that, a miss is returned but not stored, so a later call (after loading
 * completes) re-queries the real loader and can succeed. Hits are always cached.
 *
 * The cache is deliberately generic and holds no platform types so it can live
 * in `core/` and be unit-tested without a Laya runtime.
 */
export class AssetLookupCache<T> {
  private readonly entries = new Map<string, T | null>();

  /**
   * @param isReady reports whether the underlying source finished loading. A
   *                `false` result suppresses negative caching.
   */
  constructor(private readonly isReady: () => boolean) {}

  /** Number of memoised entries (hits + settled misses). */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Returns the cached value for `key`, or asks `load` for it. A `null` result
   * is only memoised when `isReady()` is true.
   */
  resolve(key: string, load: (key: string) => T | null): T | null {
    const cached = this.entries.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const value = load(key);
    if (value !== null || this.isReady()) {
      this.entries.set(key, value);
    }
    return value;
  }

  /** Drops every memoised entry (used when the source root changes). */
  clear(): void {
    this.entries.clear();
  }
}
