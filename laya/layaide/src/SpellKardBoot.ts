/**
 * LayaAir IDE entry script for Phantasm Klash.
 *
 * This is the **only** TypeScript file the IDE needs to know about: the startup
 * scene (`assets/Scene.ls`) attaches it as a component, so the IDE's bundler
 * pulls it in, follows its imports and bundles the whole client from
 * `../../src/` (the real client source — single source of truth, no copy).
 *
 * It deliberately does **not** call `Laya.init`: the IDE already initialised the
 * engine and loaded the startup scene before a `Laya.Script`'s `onStart` runs.
 * `startClient()` therefore only wires the platform adapters and the scenes.
 *
 * Runtime endpoints can be overridden without a rebuild by assigning
 * `window.PHANTASM_KLASH_CONFIG` before this script runs (e.g. from a
 * `build-templates/windows/release/scripts/*.js` file).
 */

const { regClass } = Laya;

import { startClient, type BrowserRuntimeConfig } from '../../src/platform/laya/main';

declare global {
  interface Window {
    PHANTASM_KLASH_CONFIG?: Partial<BrowserRuntimeConfig>;
  }
}

/**
 * Default deployment. Keep this in sync with the server deployment.
 *
 * The lobby is Nakama: the business calls go through `/v2/rpc/<op>` and the
 * native battle channel is `spk_udp` (UDP/KCP straight to the battle server).
 * Nakama does not serve Gensoulkyo's own lobby WebSocket (`/v1/lobby/ws`), so
 * no lobby socket is configured — leaving `lobbyWsUrl` set would make the
 * client pick the (dead) WebSocket transport over the Nakama RPC one.
 */
const DEFAULT_CONFIG: BrowserRuntimeConfig = {
  stageWidth: 960,
  stageHeight: 720,
  // `lobbyHttpBase` serves the `/v1` REST surface the lobby still bridges
  // (`match.events` / `match.snapshot` are refused on the RPC path).
  lobbyHttpBase: 'http://121.225.78.211:7350',
  lobbyNakamaHttpBase: 'http://121.225.78.211:7350',
  lobbyTransport: 'nakama_rpc',
  // Nakama's `runtime.http_key` (Basic auth for `/v2/rpc/*` before an account
  // session exists) and `socket.server_key` (Basic auth for
  // `/v2/account/authenticate/*`). Both are the deployment defaults — rotate
  // them before the gateway is exposed.
  nakamaHttpKey: 'defaulthttpkey',
  nakamaServerKey: 'defaultkey',
  lobbyWsUrl: '',
  relayUrl: '',
  battleTransport: 'auto',
  backgroundColor: '#0b0716',
  language: '',
};

@regClass()
export class SpellKardBoot extends Laya.Script {
  onStart(): void {
    const overrides = window.PHANTASM_KLASH_CONFIG ?? {};
    const config: BrowserRuntimeConfig = { ...DEFAULT_CONFIG, ...overrides };
    try {
      startClient(config);
      console.info('[spellkard] client started (lobby=%s, relay=%s)', config.lobbyWsUrl, config.relayUrl);
    } catch (error) {
      console.error('[spellkard] client failed to start', error);
    }
  }
}
