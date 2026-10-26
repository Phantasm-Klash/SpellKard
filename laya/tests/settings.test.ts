/**
 * Settings core tests.
 *
 * The settings model is what every screen reads and what gets written to disk,
 * so these pin the three things that would hurt most if they broke:
 *  - a corrupt / partial / hostile stored payload must never break boot;
 *  - writes must be clamped and merged, never trusted;
 *  - the derived values (endpoints, volumes) must be exactly what the platform
 *    layer applies.
 */

import {
  LAN_RELAY_PATH,
  LAN_WS_PATH,
  SettingsStore,
  createStoragePersistence,
  defaultSettings,
  lanEndpoints,
  normalizeSettings,
  resolveNetworkEndpoints,
  resolveVolumes,
  type GameSettings,
  type StorageLike,
} from '../src/core/settings';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

/** In-memory `StorageLike` that records writes. */
function memoryStorage(seed: Record<string, string> = {}): StorageLike & { readonly writes: string[] } {
  const map = new Map(Object.entries(seed));
  const writes: string[] = [];
  return {
    writes,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      writes.push(`${key}=${value}`);
      map.set(key, value);
    },
  };
}

suite('settings: defaults');

test('defaults are a complete, self-consistent tree', () => {
  const s = defaultSettings();
  expectEqual(s.display.effectLevel, 'high');
  expectEqual(s.display.frameCap, 60);
  expectEqual(s.display.windowScale, 'auto');
  expectEqual(s.audio.muted, false);
  expectEqual(s.hud.showOpponentHud, true);
  expectEqual(s.network.mode, 'official');
  expectEqual(s.mods.workshopEnabled, false);
  expectDeepEqual(s.mods.enabledModIds, []);
});

test('every call hands out a fresh copy (no shared mutable state)', () => {
  const a = defaultSettings();
  a.audio.masterVolume = 0.1;
  a.mods.enabledModIds.push('x');
  const b = defaultSettings();
  expectEqual(b.audio.masterVolume, 0.8);
  expectDeepEqual(b.mods.enabledModIds, []);
});

suite('settings: normalisation');

test('garbage input collapses to the defaults', () => {
  for (const bad of [null, undefined, 42, 'nope', [], true]) {
    expectDeepEqual(normalizeSettings(bad), defaultSettings());
  }
});

test('wrong types fall back per field instead of poisoning the group', () => {
  const s = normalizeSettings({ display: { windowScale: 'huge', showFps: 'yes' } });
  expectEqual(s.display.windowScale, 'auto');
  expectEqual(s.display.showFps, false);
});

test('unknown enum members fall back to the default', () => {
  const s = normalizeSettings({
    display: { effectLevel: 'ultra', frameCap: 144 },
    network: { mode: 'sneakernet' },
  });
  expectEqual(s.display.effectLevel, 'high');
  expectEqual(s.display.frameCap, 60);
  expectEqual(s.network.mode, 'official');
});

test('volumes are clamped into 0..1', () => {
  const s = normalizeSettings({
    audio: { masterVolume: 5, bgmVolume: -3, grazeVolume: Number.NaN, skillVolume: 0.25 },
  });
  expectEqual(s.audio.masterVolume, 1);
  expectEqual(s.audio.bgmVolume, 0);
  expectEqual(s.audio.grazeVolume, 0.6);
  expectEqual(s.audio.skillVolume, 0.25);
});

test('mod ids are trimmed, de-duplicated and order-preserving', () => {
  const s = normalizeSettings({ mods: { enabledModIds: [' b ', 'a', 'b', '', 7, 'a'] } });
  expectDeepEqual(s.mods.enabledModIds, ['b', 'a']);
});

test('unknown keys are dropped rather than carried along', () => {
  const s = normalizeSettings({ display: { windowScale: 3, bogus: 1 }, extra: true });
  expectDeepEqual(Object.keys(s.display).sort(), [
    'effectLevel',
    'frameCap',
    'showFps',
    'upscaler',
    'upscalerSharpness',
    'windowScale',
  ]);
  expect(!('extra' in s), 'top-level unknown key must not survive');
});

test('the upscaler slot and the DLC module list survive normalisation', () => {
  const s = normalizeSettings({
    display: { upscaler: 'software', upscalerSharpness: 0.75 },
    plugins: { moduleUrls: ['https://cdn.example/dlss.js', ' /mods/fsr.js '], autoLoad: true },
  });
  expectEqual(s.display.upscaler, 'software');
  expectEqual(s.display.upscalerSharpness, 0.75);
  expectDeepEqual(s.plugins.moduleUrls, ['https://cdn.example/dlss.js', '/mods/fsr.js']);
  expect(s.plugins.autoLoad, 'autoLoad is read');

  // An unknown backend id must fall back rather than reach the renderer, and a
  // stored payload must never be able to make the client import local code.
  const dirty = normalizeSettings({
    display: { upscaler: 'cuda', upscalerSharpness: 9 },
    plugins: { moduleUrls: ['file:///etc/passwd', 'data:text/javascript,alert(1)', 'javascript:x'] },
  });
  expectEqual(dirty.display.upscaler, 'off', 'unknown backend falls back to off');
  expectEqual(dirty.display.upscalerSharpness, 1, 'sharpness is clamped into range');
  expectDeepEqual(dirty.plugins.moduleUrls, [], 'only http(s) and root-relative URLs are loadable');
});

test('a partial payload overlays the supplied fallback', () => {
  const base: GameSettings = defaultSettings();
  base.audio.masterVolume = 0.2;
  const s = normalizeSettings({ audio: { bgmVolume: 0.9 } }, base);
  expectEqual(s.audio.masterVolume, 0.2, 'untouched field keeps the fallback');
  expectEqual(s.audio.bgmVolume, 0.9, 'patched field wins');
});

suite('settings: store');

test('update merges, persists and notifies exactly once', () => {
  const storage = memoryStorage();
  const store = new SettingsStore({ persistence: createStoragePersistence(storage) });
  const seen: GameSettings[] = [];
  store.subscribe((s) => seen.push(s));

  store.update({ display: { frameCap: 30 } });

  expectEqual(store.get().display.frameCap, 30);
  expectEqual(store.get().display.effectLevel, 'high', 'sibling field is untouched');
  expectEqual(seen.length, 1);
  expectEqual(storage.writes.length, 1, 'one write per change');
});

test('a no-op patch neither persists nor notifies', () => {
  const storage = memoryStorage();
  const store = new SettingsStore({ persistence: createStoragePersistence(storage) });
  let calls = 0;
  store.subscribe(() => {
    calls += 1;
  });

  store.update({ display: { frameCap: 60 } }); // already the default

  expectEqual(calls, 0);
  expectEqual(storage.writes.length, 0);
});

test('out-of-range writes are clamped before they reach the state', () => {
  const store = new SettingsStore();
  store.update({ audio: { masterVolume: 99 } });
  expectEqual(store.get().audio.masterVolume, 1);
});

test('unsubscribe stops delivery', () => {
  const store = new SettingsStore();
  let calls = 0;
  const off = store.subscribe(() => {
    calls += 1;
  });
  store.update({ display: { showFps: true } });
  off();
  store.update({ display: { showFps: false } });
  expectEqual(calls, 1);
});

test('a stored payload is loaded and normalised on construction', () => {
  const storage = memoryStorage({
    'spellkard.settings': JSON.stringify({ display: { frameCap: 30 }, audio: { muted: true } }),
  });
  const store = new SettingsStore({ persistence: createStoragePersistence(storage) });
  expectEqual(store.get().display.frameCap, 30);
  expectEqual(store.get().audio.muted, true);
  expectEqual(store.get().hud.showOpponentHud, true, 'missing groups fall back to defaults');
});

test('a corrupt stored payload boots on defaults instead of throwing', () => {
  const storage = memoryStorage({ 'spellkard.settings': '{ not json' });
  const store = new SettingsStore({ persistence: createStoragePersistence(storage) });
  expectDeepEqual(store.get(), defaultSettings());
});

test('a storage that throws on read/write does not break the store', () => {
  const hostile: StorageLike = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
  };
  const store = new SettingsStore({ persistence: createStoragePersistence(hostile) });
  store.update({ display: { frameCap: 120 } });
  expectEqual(store.get().display.frameCap, 120, 'the session still honours the change');
});

test('reset restores the shipped defaults', () => {
  const store = new SettingsStore();
  store.update({ display: { frameCap: 30 }, audio: { muted: true } });
  store.reset();
  expectDeepEqual(store.get(), defaultSettings());
});

test('toJSON round-trips through the normaliser unchanged', () => {
  const store = new SettingsStore();
  store.update({ hud: { showOpponentHud: false }, network: { mode: 'lan', lanHost: '10.0.0.5' } });
  const round = normalizeSettings(JSON.parse(store.toJSON()));
  expectDeepEqual(round, store.get());
});

suite('settings: network endpoints');

test('official mode passes the build endpoints through untouched', () => {
  const official = { httpBase: 'https://lobby.example', wsUrl: 'wss://lobby.example/ws', relayUrl: 'wss://lobby.example/relay' };
  const out = resolveNetworkEndpoints(defaultSettings().network, official);
  expectDeepEqual(out, official);
  expect(out !== official, 'a copy is returned, not the caller’s object');
});

test('lan mode derives http + ws + relay from a bare host', () => {
  const out = lanEndpoints('192.168.1.10:7350');
  expectEqual(out.httpBase, 'http://192.168.1.10:7350');
  expectEqual(out.wsUrl, `ws://192.168.1.10:7350${LAN_WS_PATH}`);
  expectEqual(out.relayUrl, `ws://192.168.1.10:7350${LAN_RELAY_PATH}`);
});

test('lan mode tolerates a scheme and trailing slashes', () => {
  expectDeepEqual(lanEndpoints('https://lobby.lan:7350/'), lanEndpoints('lobby.lan:7350'));
  expectDeepEqual(lanEndpoints('ws://lobby.lan/'), lanEndpoints('lobby.lan'));
});

test('an empty lan host yields empty endpoints (nothing to connect to)', () => {
  expectDeepEqual(lanEndpoints('   '), { httpBase: '', wsUrl: '', relayUrl: '' });
  const out = resolveNetworkEndpoints({ ...defaultSettings().network, mode: 'lan', lanHost: '' }, {
    httpBase: 'https://official',
    wsUrl: 'wss://official/ws',
    relayUrl: '',
  });
  expectEqual(out.httpBase, '', 'lan mode must not silently fall back to the official host');
});

test('custom mode trims the entered endpoints', () => {
  const out = resolveNetworkEndpoints(
    {
      mode: 'custom',
      lanHost: '',
      customHttpBase: '  https://third.party  ',
      customWsUrl: ' wss://third.party/ws ',
      customRelayUrl: '  ',
    },
    { httpBase: 'https://official', wsUrl: '', relayUrl: '' },
  );
  expectEqual(out.httpBase, 'https://third.party');
  expectEqual(out.wsUrl, 'wss://third.party/ws');
  expectEqual(out.relayUrl, '');
});

suite('settings: volumes');

test('master volume scales every channel', () => {
  const v = resolveVolumes({ ...defaultSettings().audio, masterVolume: 0.5, bgmVolume: 1, grazeVolume: 0.4 });
  expectEqual(v.bgm, 0.5);
  expectEqual(v.graze, 0.2);
  expectEqual(v.sfxMaster, 0.5);
});

test('muting zeroes every channel without touching the sliders', () => {
  const audio = { ...defaultSettings().audio, muted: true };
  const v = resolveVolumes(audio);
  expectEqual(v.bgm, 0);
  expectEqual(v.sfxMaster, 0);
  expectEqual(audio.bgmVolume, 0.7, 'the stored slider is preserved for un-mute');
});
