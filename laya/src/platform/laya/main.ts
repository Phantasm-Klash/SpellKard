/**
 * Browser bootstrap for the LayaAir build.
 *
 * This is the module `index.html` loads. It does **not** depend on the LayaAir
 * IDE: it waits for the vendored runtime (`engine/libs/*.js`, loaded with plain
 * `<script>` tags) to expose the `Laya` global, calls `Laya.init` and then
 * wires `SpellKardApp` with the browser platform adapters.
 *
 * Runtime configuration is read from `window.PHANTASM_KLASH_CONFIG` (set in
 * `index.html`) and can be overridden per-URL with query parameters, so the same
 * build can point at any Gensoulkyo / battle-server deployment:
 *
 *   index.html?lobbyHttpBase=https://lobby.example&lobbyWsUrl=wss://lobby.example/ws
 */

import { OfflineDatagramFactory, type DatagramFactory, type Logger, type SocketFactory, type TimerLike } from '../../core/net/transport';
import { SettingsStore, createStoragePersistence, type StorageLike } from '../../core/settings';
import { NativeUdpDatagramFactory, resolveNativeUdpModule } from '../native/native_udp_datagram';
import { RelayDatagramFactory } from '../web/ws_relay_datagram';
import { SpellKardApp } from './app';
import { LayaSocketFactory } from './laya_socket';
import { LayaTimer } from './laya_timer';

export interface BrowserRuntimeConfig {
  stageWidth: number;
  stageHeight: number;
  /** Gensoulkyo REST base, e.g. `https://lobby.example`. Empty = same origin. */
  lobbyHttpBase: string;
  /** Nakama-style lobby WSS url. Empty = use the REST transport. */
  lobbyWsUrl: string;
  /** WebSocket relay that tunnels battle KCP datagrams. Empty = offline battle. */
  relayUrl: string;
  /**
   * Battle channel: `relay` tunnels KCP over the lobby WebSocket (web), `udp`
   * uses the native `spk_udp` extension (LayaNative). `auto` picks `udp` when
   * the extension is loaded, otherwise `relay`.
   */
  battleTransport: 'auto' | 'relay' | 'udp';
  backgroundColor: string;
}

declare global {
  interface Window {
    PHANTASM_KLASH_CONFIG?: Partial<BrowserRuntimeConfig>;
    /** Set only when the page is opened with `?debug=1`, for local inspection. */
    __PK_APP__?: SpellKardApp;
    __PK_SCENES__?: unknown;
  }
}

const DEFAULT_CONFIG: BrowserRuntimeConfig = {
  // Stage is 3:4 (900x1200). The battle playfield is a 3:2 portrait block on
  // the left; the status panel is a vertical strip to its right, as tall as the
  // stage. See `BattleScene` for the split.
  stageWidth: 900,
  stageHeight: 1200,
  lobbyHttpBase: '',
  lobbyWsUrl: '',
  relayUrl: '',
  battleTransport: 'auto',
  backgroundColor: '#0b0716',
};

function pickNumber(value: string | null, fallback: number): number {
  if (value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function pickString(value: string | null, fallback: string): string {
  return value === null ? fallback : value;
}

function pickBattleTransport(value: string | null, fallback: BrowserRuntimeConfig['battleTransport']): BrowserRuntimeConfig['battleTransport'] {
  if (value === 'relay' || value === 'udp' || value === 'auto') {
    return value;
  }
  return fallback;
}

/** Merges `index.html` globals with URL query overrides. */
export function resolveRuntimeConfig(search = window.location.search): BrowserRuntimeConfig {
  const fromWindow = window.PHANTASM_KLASH_CONFIG ?? {};
  const params = new URLSearchParams(search);
  return {
    stageWidth: pickNumber(params.get('stageWidth'), fromWindow.stageWidth ?? DEFAULT_CONFIG.stageWidth),
    stageHeight: pickNumber(params.get('stageHeight'), fromWindow.stageHeight ?? DEFAULT_CONFIG.stageHeight),
    lobbyHttpBase: pickString(params.get('lobbyHttpBase'), fromWindow.lobbyHttpBase ?? DEFAULT_CONFIG.lobbyHttpBase),
    lobbyWsUrl: pickString(params.get('lobbyWsUrl'), fromWindow.lobbyWsUrl ?? DEFAULT_CONFIG.lobbyWsUrl),
    relayUrl: pickString(params.get('relayUrl'), fromWindow.relayUrl ?? DEFAULT_CONFIG.relayUrl),
    battleTransport: pickBattleTransport(
      params.get('battleTransport'),
      fromWindow.battleTransport ?? DEFAULT_CONFIG.battleTransport,
    ),
    backgroundColor: pickString(params.get('backgroundColor'), fromWindow.backgroundColor ?? DEFAULT_CONFIG.backgroundColor),
  };
}

/**
 * Chooses the battle datagram channel. Native builds prefer the `spk_udp`
 * extension; web builds tunnel KCP through the lobby WebSocket relay. When the
 * relay is not configured either way, the battle channel stays offline.
 */
function datagramFactoryFor(
  config: BrowserRuntimeConfig,
  sockets: SocketFactory,
  timer: TimerLike,
): DatagramFactory {
  const nativeModule = resolveNativeUdpModule();
  const wantsUdp = config.battleTransport === 'udp' || (config.battleTransport === 'auto' && nativeModule !== null);
  if (wantsUdp && nativeModule !== null) {
    return new NativeUdpDatagramFactory(nativeModule, timer);
  }
  if (config.relayUrl === '') {
    // No relay configured: the lobby still runs, the battle channel stays offline.
    return new OfflineDatagramFactory();
  }
  return new RelayDatagramFactory(sockets, config.relayUrl);
}

const DEVICE_ID_STORAGE_KEY = 'spellkard.device_id';

/**
 * Stable anonymous identity for `auth.anonymous`.
 *
 * The lobby rejects an anonymous auth that carries neither a `session_token`
 * nor a `user_id` ("unauthorized"), so the client must always present a
 * `user_id`. We persist one per device/browser profile so a returning player
 * keeps the same account instead of minting a new one on every launch.
 * Native builds or privacy modes without `localStorage` fall back to a
 * per-session id (sign-in still works, the identity just is not sticky).
 */
function resolveDeviceId(): string {
  const generated = (): string => `dev-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  try {
    const storage = window.localStorage;
    if (storage !== undefined && storage !== null) {
      const existing = storage.getItem(DEVICE_ID_STORAGE_KEY);
      if (existing !== null && existing !== '') {
        return existing;
      }
      const fresh = generated();
      storage.setItem(DEVICE_ID_STORAGE_KEY, fresh);
      return fresh;
    }
  } catch {
    // localStorage unavailable (privacy mode / some native runtimes).
  }
  return generated();
}

/**
 * `localStorage` when the runtime allows touching it, otherwise `null`.
 *
 * Merely *reading* `window.localStorage` throws in some privacy modes and in a
 * few native runtimes, so the access itself is what has to be guarded — not
 * just the calls on it.
 */
function resolveStorage(): StorageLike | null {
  try {
    const storage = window.localStorage;
    return storage === undefined || storage === null ? null : storage;
  } catch {
    return null;
  }
}

/** Console logger so a plain static server shows what the client is doing. */
const consoleLogger: Logger = {
  debug: (message) => console.debug('[spellkard]', message),
  info: (message) => console.info('[spellkard]', message),
  warn: (message) => console.warn('[spellkard]', message),
  error: (message) => console.error('[spellkard]', message),
};

/**
 * Builds the platform adapters and starts the client against an **already
 * initialised** LayaAir engine. This is the entry the LayaAir IDE project uses
 * (`laya/layaide/src/SpellKardBoot.ts`): the IDE owns `Laya.init` and the
 * startup scene, so the client must not call `Laya.init` a second time.
 */
export function startClient(config: BrowserRuntimeConfig): SpellKardApp {
  // NOTE: `Laya.stage.frameRate` only understands the strings
  // `'slow' | 'mouse' | 'sleep'` in this engine version — every number,
  // including 60, is coerced to `throttleMode = 0` ("fast"). The numeric frame
  // cap therefore lives in the settings store and is installed onto
  // `Render.predicate` by `applyDisplaySettings` (see `platform/laya/display.ts`).
  // The stage's design size, `scaleMode` and alignment are owned by whoever
  // called `Laya.init`, and the two callers differ on purpose:
  //   * web  -> `bootstrap()` below: 900x1200, `showall`, centred (letterboxed);
  //   * native -> the IDE-generated runtime `js/index.js`: 1334x750,
  //     `fixedheight`, top-left, so the *logical* stage is
  //     `(750 * windowAspect) x 750` and its width changes with the window.
  // Nothing here overrides that. `BattleScene` instead derives its geometry from
  // `Laya.stage.width/height` and re-tiles on `Laya.Event.RESIZE`, so the
  // playfield and status panel fill whichever logical stage the runtime picks.

  const sockets = new LayaSocketFactory();
  const timer = new LayaTimer();
  // One store for the whole session: the settings modal writes it, the app
  // applies it, and it survives a reload through `localStorage`.
  const settings = new SettingsStore({ persistence: createStoragePersistence(resolveStorage()) });
  const app = new SpellKardApp({
    stageWidth: config.stageWidth,
    stageHeight: config.stageHeight,
    lobbyHttpBase: config.lobbyHttpBase,
    lobbyWsUrl: config.lobbyWsUrl,
    relayUrl: config.relayUrl,
    // Required: the lobby rejects `auth.anonymous` without a user_id/session.
    deviceId: resolveDeviceId(),
    socketFactory: sockets,
    datagramFactory: datagramFactoryFor(config, sockets, timer),
    timer,
    logger: consoleLogger,
    settings,
  });
  app.start();
  return app;
}

/**
 * Boots the engine and the client. Safe to call once, after the LayaAir
 * `<script>` tags have run.
 */
export async function bootstrap(config: BrowserRuntimeConfig = resolveRuntimeConfig()): Promise<SpellKardApp> {
  await Laya.init({
    designWidth: config.stageWidth,
    designHeight: config.stageHeight,
    scaleMode: 'showall',
    screenMode: 'none',
    alignH: 'center',
    alignV: 'middle',
    backgroundColor: config.backgroundColor,
  });
  const app = startClient(config);
  // Local inspection hook: only present when the page is opened with `?debug=1`.
  if (new URLSearchParams(window.location.search).get('debug') === '1') {
    window.__PK_APP__ = app;
    window.__PK_SCENES__ = app.debugScenes();
  }
  return app;
}
