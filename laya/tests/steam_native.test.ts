/**
 * Steam layer (client) tests: native bridge shape validation and the
 * battle-result -> achievement unlock path with the embedded catalog.
 *
 * Runs in the zero-dependency harness (node). No real Steam is involved:
 * `spkSteam` takes an injectable scope (mirrors `spkWin`), and the session
 * module degrades to local-only tracking when the extension is absent —
 * which is exactly the case under node.
 */

import { NativeSpkSteamBridge, nativeSteamAvailable, spkSteam } from '../src/platform/native/steam/native_steam_bridge';
import {
  appidForEndpoint,
  handleBattleResult,
  initSteamSession,
  isSteamActive,
} from '../src/platform/native/steam/steam_session';
import { parseDlcCatalog } from '../src/core/steam/catalog/dlc_catalog';
import { DLC_CATALOG_DATA } from '../src/core/steam/dlc_catalog_data';
import type { SteamInitResult } from '../src/core/steam/steam/steam_bridge';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

function makeScope(): Record<string, unknown> {
  const granted: Record<string, boolean> = {};
  const api = {
    version: () => 'fake/1.0.0',
    init: (appId: number): SteamInitResult =>
      appId === 2280001
        ? { ok: true, steamId: 'steam:123', detail: '' }
        : { ok: false, steamId: null, detail: 'bad appid' },
    getSteamId: () => 'steam:123',
    hasDlcInstalled: (appId: number) => appId === 1002001,
    listOwnedDlc: () => [1002001],
    subscribeWorkshopItem: () => true,
    unsubscribeWorkshopItem: () => true,
    getSubscribedWorkshopItems: () => [
      { publishedFileId: '456', localPath: 'C:\\items\\456', sizeBytes: 12 },
      { publishedFileId: '789', localPath: null, sizeBytes: 0 },
    ],
    isWorkshopItemInstalled: (id: string) => id === '456',
    setAchievement: (id: string): boolean => {
      granted[id] = true;
      return true;
    },
    getAchievements: () => ({ ...granted }),
    shutdown: () => undefined,
  };
  return { spk_steam: api };
}

suite('steam native bridge');

test('spkSteam: missing and partial shapes are rejected', () => {
  expectEqual(spkSteam({}), null, 'no spk_steam -> null');
  expectEqual(nativeSteamAvailable({}), false, 'not available');
  expectEqual(spkSteam({ spk_steam: { version: () => 'x' } }), null, 'partial shape rejected');
  expect(spkSteam({ window: makeScope() }) !== null, 'window nested scope found');
});

test('bridge: full surface over the fake extension', async () => {
  const scope = makeScope();
  const bridge = new NativeSpkSteamBridge(scope.spk_steam as never);
  const initRes = await bridge.init(2280001);
  expect(initRes.ok, 'init ok');
  expectEqual(await bridge.getSteamId(), 'steam:123', 'steam id');
  expectEqual(await bridge.hasDlcInstalled(1002001), true, 'dlc installed');
  expectEqual(await bridge.hasDlcInstalled(9999999), false, 'dlc missing');
  expectDeepEqual(await bridge.listOwnedDlc(), [1002001], 'owned dlc');
  const items = await bridge.getSubscribedWorkshopItems();
  expectEqual(items.length, 2, 'subscribed count');
  expectEqual(items[0].publishedFileId, '456', 'item 0 id');
  expectEqual(items[1].localPath, null, 'item 1 not installed');
  expectEqual(await bridge.isWorkshopItemInstalled('456'), true, 'installed flag');
  expectEqual(await bridge.setAchievement('phk_clear_skyhold_01'), true, 'set achievement');
  const states = await bridge.getAchievements();
  expectEqual(states['phk_clear_skyhold_01'], true, 'achievement state');
});

suite('steam session (local-only without the extension)');

test('init + local unlock on a base-level win', async () => {
  // Under node there is no `spk_steam` global: the session must still come
  // up and grant local-only unlocks.
  await initSteamSession();
  expectEqual(isSteamActive(), false, 'not active without the extension');

  const granted = await handleBattleResult({
    modeId: 'mvp_boss_race',
    bossId: 'tian',
    won: true,
    endpoint: 'base.example.com:9000',
  });
  expectEqual(granted.length, 1, 'local unlock granted');

  expectDeepEqual(
    await handleBattleResult({ modeId: 'mvp_boss_race', bossId: 'tian', won: false, endpoint: null }),
    [],
    'no unlock on loss',
  );
  // (mode, boss) pair with no catalog level grants nothing.
  expectDeepEqual(
    await handleBattleResult({ modeId: 'coop_boss', bossId: 'hui', won: true, endpoint: 'base.example.com:9000' }),
    [],
    'no level for combo',
  );
});

test('endpoint -> appid mapping and DLC level unlock', async () => {
  const catalog = parseDlcCatalog(DLC_CATALOG_DATA);
  const base = catalog.base_game.appid;
  const dlc = catalog.dlcs[0];

  expectEqual(appidForEndpoint(catalog, null), base, 'null endpoint -> base appid');
  expectEqual(appidForEndpoint(catalog, 'unknown.example.com:9000'), base, 'unknown host -> base appid');
  const host = dlc.servers[0].host;
  expectEqual(appidForEndpoint(catalog, `${host}:9000`), dlc.steam_appid, 'dlc host -> dlc appid');

  // A win on the DLC server resolves the DLC level (base levels with the
  // same (mode, boss) pair must not be picked).
  const granted = await handleBattleResult({
    modeId: dlc.levels[0].mode_id,
    bossId: dlc.levels[0].boss_id ?? null,
    won: true,
    endpoint: `${host}:9000`,
  });
  expectEqual(granted.length, 1, 'dlc level unlock granted');
});
