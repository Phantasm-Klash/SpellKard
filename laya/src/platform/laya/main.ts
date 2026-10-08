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
  Laya.stage.frameRate = 60;

  const sockets = new LayaSocketFactory();
  const timer = new LayaTimer();
  const app = new SpellKardApp({
    stageWidth: config.stageWidth,
    stageHeight: config.stageHeight,
    lobbyHttpBase: config.lobbyHttpBase,
    lobbyWsUrl: config.lobbyWsUrl,
    relayUrl: config.relayUrl,
    socketFactory: sockets,
    datagramFactory: datagramFactoryFor(config, sockets, timer),
    timer,
    logger: consoleLogger,
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
