/**
 * Regression tests for the two battle-art loading bugs:
 *
 *  1. The atlas root was a web-only relative path, so the LayaNative `.exe`
 *     resolved every frame to `null` and stayed on vector art. These tests pin
 *     the per-deployment root resolution (`core/game/tna_assets`).
 *
 *  2. The frame cache stored a `null` miss even before the atlas finished
 *     loading, pinning the renderer to the fallback forever. These tests pin the
 *     "do not cache a miss until ready" policy (`core/game/asset_lookup_cache`).
 */

import { AssetLookupCache } from '../src/core/game/asset_lookup_cache';
import {
  TNA_NATIVE_ROOT,
  TNA_WEB_ROOT,
  isNativeAssetRuntime,
  resolveTnaAtlasRoot,
  tnaAtlasRootCandidates,
} from '../src/core/game/tna_assets';
import { expect, expectEqual, suite, test } from './harness';

suite('tna atlas root resolution');

test('the native root points at the packaged resource directory', () => {
  expectEqual(resolveTnaAtlasRoot(true), TNA_NATIVE_ROOT);
  expectEqual(TNA_NATIVE_ROOT, 'resources/tna');
});

test('the web root is the path relative to index.html', () => {
  expectEqual(resolveTnaAtlasRoot(false), TNA_WEB_ROOT);
  expectEqual(TNA_WEB_ROOT, 'layaide/assets/resources/tna');
});

test('candidates lead with the deployment-specific root and fall back to the other', () => {
  const native = tnaAtlasRootCandidates(true);
  expectEqual(native[0], TNA_NATIVE_ROOT);
  expect(native.includes(TNA_WEB_ROOT), 'native candidates must include the web root');

  const web = tnaAtlasRootCandidates(false);
  expectEqual(web[0], TNA_WEB_ROOT);
  expect(web.includes(TNA_NATIVE_ROOT), 'web candidates must include the native root');

  // A non-web deployment must not resolve to the web-only path first.
  expect(native[0] !== web[0], 'web and native must not share the preferred root');
});

test('isNativeAssetRuntime detects the LayaNative `conch` global', () => {
  expectEqual(isNativeAssetRuntime({}), false);
  expectEqual(isNativeAssetRuntime({ window: {} }), false);
  expectEqual(isNativeAssetRuntime({ conch: {} }), true);
  expectEqual(isNativeAssetRuntime({ window: { conch: {} } }), true);
  expectEqual(isNativeAssetRuntime({ window: { conch: null } }), false);
  expectEqual(isNativeAssetRuntime(null), false);
});

suite('asset lookup cache');

test('a miss is not cached before the source is ready', () => {
  let ready = false;
  const cache = new AssetLookupCache<string>(() => ready);
  let calls = 0;
  const load = (): string | null => {
    calls += 1;
    return ready ? 'frame' : null;
  };

  expectEqual(cache.resolve('k', load), null);
  expectEqual(calls, 1);
  expectEqual(cache.size, 0, 'transient miss must not be memoised');

  // Once the source is ready the very same key must be re-queried and succeed.
  ready = true;
  expectEqual(cache.resolve('k', load), 'frame');
  expectEqual(calls, 2);
  expectEqual(cache.size, 1);
});

test('hits are cached even before the source is ready', () => {
  const cache = new AssetLookupCache<string>(() => false);
  let calls = 0;
  const load = (): string | null => {
    calls += 1;
    return 'frame';
  };
  expectEqual(cache.resolve('k', load), 'frame');
  expectEqual(cache.resolve('k', load), 'frame');
  expectEqual(calls, 1);
});

test('a miss is cached once the source is ready', () => {
  const cache = new AssetLookupCache<string>(() => true);
  let calls = 0;
  const load = (): string | null => {
    calls += 1;
    return null;
  };
  expectEqual(cache.resolve('k', load), null);
  expectEqual(cache.resolve('k', load), null);
  expectEqual(calls, 1);
});

test('clear drops memoised entries', () => {
  const cache = new AssetLookupCache<string>(() => true);
  cache.resolve('k', () => 'frame');
  expectEqual(cache.size, 1);
  cache.clear();
  expectEqual(cache.size, 0);
});
