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

/** Default deployment. Keep this in sync with the server deployment. */
const DEFAULT_CONFIG: BrowserRuntimeConfig = {
  stageWidth: 960,
  stageHeight: 720,
  lobbyHttpBase: 'http://121.225.78.211:7350',
  lobbyWsUrl: 'ws://121.225.78.211:7350/v1/lobby/ws',
  relayUrl: 'ws://121.225.78.211:7350/v1/battle/relay',
  battleTransport: 'auto',
  backgroundColor: '#0b0716',
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
