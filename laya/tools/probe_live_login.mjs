/**
 * Live probe: drives the *real* client core layer (dist/core, engine-agnostic)
 * against a running Gensoulkyo lobby, with a Node WebSocket adapter.
 *
 * Purpose: bisect "client can't sign in" into either
 *   - the protocol/core layer (WS envelope, auth, bootstrap), or
 *   - the UI/platform layer (Laya scenes, buttons, rendering).
 *
 * Usage:
 *   node tools/probe_live_login.mjs [wsUrl]
 *   node tools/probe_live_login.mjs ws://121.225.78.211:7350/v1/lobby/ws
 */

import { LobbyClient, WsLobbyTransport } from '../dist/core/net/lobby_client.js';

const url = process.argv[2] ?? 'ws://121.225.78.211:7350/v1/lobby/ws';

const logger = {
  debug: (m) => console.log('[dbg ]', m),
  info: (m) => console.log('[info]', m),
  warn: (m) => console.log('[warn]', m),
  error: (m) => console.log('[err ]', m),
};

/** Minimal SocketLike adapter over the Node built-in WebSocket. */
class NodeSocket {
  constructor(ws) {
    this.ws = ws;
    this.handlers = {};
    this._connected = false;
  }

  get connected() {
    return this._connected;
  }

  setHandlers(handlers) {
    this.handlers = handlers;
    this.ws.addEventListener('open', () => {
      this._connected = true;
      console.log('[probe] WS open');
      handlers.onOpen?.();
    });
    this.ws.addEventListener('message', (ev) => {
      const data = ev.data;
      if (typeof data === 'string') {
        // Frame size matters: LayaSocket parses each message event
        // independently with no reassembly buffer, so anything the runtime
        // delivers in fragments breaks JSON parsing.
        console.log('[probe] frame bytes=', data.length);
        handlers.onMessage?.(data);
        return;
      }
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer ?? data);
      handlers.onMessage?.(bytes);
    });
    this.ws.addEventListener('close', (ev) => {
      this._connected = false;
      console.log('[probe] WS close', ev.code, JSON.stringify(ev.reason));
      handlers.onClose?.(ev.code, ev.reason);
    });
    this.ws.addEventListener('error', (ev) => {
      console.log('[probe] WS error', ev.message ?? ev);
      handlers.onError?.(new Error('websocket error'));
    });
  }

  send(data) {
    this.ws.send(data);
  }

  close(code, reason) {
    this.ws.close(code, reason);
  }
}

function waitForOpen(ws, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`WS open timeout after ${timeoutMs}ms`)), timeoutMs);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('WS error before open'));
    });
  });
}

console.log('[probe] connecting to', url);
const ws = new WebSocket(url);
const socket = new NodeSocket(ws);
const transport = new WsLobbyTransport(socket, {
  logger,
  platform: 'node',
  clientBuild: 'probe',
  // The lobby rejects auth.anonymous without a user_id; the app supplies its
  // persisted deviceId here (see resolveDeviceId() in platform/laya/main.ts).
  userId: process.env.PROBE_DEVICE_ID ?? 'dev-probe-0001',
});
const client = new LobbyClient({ transport, logger });
// Pushed room state / match start / match result arrive out-of-band on the
// transport, exactly as `SpellKardApp` wires them.
transport.onEvent((event) => client.dispatchEvent(event));

try {
  await waitForOpen(ws);
} catch (error) {
  console.error('[probe] FAILED at transport layer:', error.message);
  process.exit(1);
}

console.log('[probe] socket.connected =', socket.connected);

const session = await client.loginAnonymous('NodeTester');
console.log('[probe] loginAnonymous =>', session === null ? 'null (FAILED)' : JSON.stringify(session));
console.log('[probe] client.lastError =', JSON.stringify(client.lastError));

if (session === null) {
  process.exit(2);
}

await client.bootstrap(session.rulesetVersion ?? '');
console.log('[probe] bootstrap ok, session =', JSON.stringify(client.session));

// --- full chain: create a room and wait for the bot to join and start a match ---
//
// Creating a room from the probe leaves a "zombie" room behind once the probe
// exits (the lobby keeps it until it expires), and the real bot will happily
// join *that* instead of the one the client under test creates. So room
// creation is opt-in: the probe only signs in and loads the profile by default.
if (process.env.PROBE_CREATE !== '1') {
  console.log('[probe] OK: sign-in + bootstrap succeeded (pass PROBE_CREATE=1 to also create a room)');
  process.exit(0);
}

const roomCode = process.env.PROBE_ROOM_CODE ?? 'RACE01';
let matchStarted = null;
client.onEvent((event) => {
  console.log('[probe] event:', event.kind, JSON.stringify(event).slice(0, 220));
  if (event.kind === 'match_start') {
    matchStarted = event;
  }
});

// NOTE: the lobby's ModeConfigs registry (runtime/core/types.go) has no
// "mvp_boss_race" entry, so rooms.create rejects it with mode_invalid. The
// registered 2-player mode is "pvp_duel".
const modeId = process.env.PROBE_MODE_ID ?? 'pvp_duel';
const room = await client.createRoom(roomCode, modeId);
console.log('[probe] createRoom =>', room === null ? 'FAILED ' + client.lastError : JSON.stringify(room));

if (room !== null) {
  const deadline = Date.now() + 40000;
  while (matchStarted === null && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
  }
}

if (matchStarted === null) {
  console.log('[probe] RESULT: room created but no match_start within 40s (no second player joined?)');
  process.exit(3);
}

console.log('[probe] RESULT: MATCH STARTED =>', JSON.stringify(matchStarted));
process.exit(0);
