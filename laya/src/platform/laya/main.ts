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

import { OfflineDatagramFactory, type DatagramFactory, type Logger, type SocketFactory } from '../../core/net/transport';
import { RelayDatagramFactory } from '../web/ws_relay_datagram';
import { SpellKardApp } from './app';
import { LayaSocketFactory } from './laya_socket';

export interface BrowserRuntimeConfig {
  stageWidth: number;
  stageHeight: number;
  /** Gensoulkyo REST base, e.g. `https://lobby.example`. Empty = same origin. */
  lobbyHttpBase: string;
  /** Nakama-style lobby WSS url. Empty = use the REST transport. */
  lobbyWsUrl: string;
  /** WebSocket relay that tunnels battle KCP datagrams. Empty = offline battle. */
  relayUrl: string;
  backgroundColor: string;
}

declare global {
  interface Window {
    PHANTASM_KLASH_CONFIG?: Partial<BrowserRuntimeConfig>;
  }
}

const DEFAULT_CONFIG: BrowserRuntimeConfig = {
  stageWidth: 960,
  stageHeight: 720,
  lobbyHttpBase: '',
  lobbyWsUrl: '',
  relayUrl: '',
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
    backgroundColor: pickString(params.get('backgroundColor'), fromWindow.backgroundColor ?? DEFAULT_CONFIG.backgroundColor),
  };
}

/** A `DatagramFactory` that opens the WS-relay KCP tunnel used by web builds. */
function datagramFactoryFor(config: BrowserRuntimeConfig, sockets: SocketFactory): DatagramFactory {
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
  Laya.stage.frameRate = 60;

  const sockets = new LayaSocketFactory();
  const app = new SpellKardApp({
    stageWidth: config.stageWidth,
    stageHeight: config.stageHeight,
    lobbyHttpBase: config.lobbyHttpBase,
    lobbyWsUrl: config.lobbyWsUrl,
    relayUrl: config.relayUrl,
    socketFactory: sockets,
    datagramFactory: datagramFactoryFor(config, sockets),
    logger: consoleLogger,
  });
  app.start();
  return app;
}
