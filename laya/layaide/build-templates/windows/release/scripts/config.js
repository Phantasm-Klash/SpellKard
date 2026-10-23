/**
 * Native runtime configuration override.
 *
 * LayaNative loads this file (`require("config")` in `scripts/index.js`)
 * **before** the application bundle runs, so anything assigned to
 * `window.PHANTASM_KLASH_CONFIG` here is in place by the time
 * `SpellKardBoot.onStart` reads it. That makes this file the place to point a
 * published build at a deployment without rebuilding it.
 *
 * The values below mirror the defaults in `layaide/src/SpellKardBoot.ts`; the
 * lobby is Nakama, so the business calls go through `/v2/rpc/<op>` and the
 * native battle channel is `spk_udp` (UDP/KCP straight to the battle server).
 * Nakama does not serve Gensoulkyo's own lobby WebSocket (`/v1/lobby/ws`), so
 * `lobbyWsUrl` stays empty — a non-empty value would make the client pick the
 * dead WebSocket transport over the Nakama RPC one.
 */
window.PHANTASM_KLASH_CONFIG = {
  lobbyHttpBase: 'http://121.225.78.211:7350',
  lobbyNakamaHttpBase: 'http://121.225.78.211:7350',
  lobbyTransport: 'nakama_rpc',
  nakamaHttpKey: 'defaulthttpkey',
  nakamaServerKey: 'defaultkey',
  lobbyWsUrl: '',
  relayUrl: '',
  battleTransport: 'auto',
};
