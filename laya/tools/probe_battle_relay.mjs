/**
 * Live probe: drives the *real* client core layer (`dist/`) through the whole
 * MVP chain against a running Gensoulkyo lobby, then opens the battle channel
 * over the **lobby WebSocket relay** and reports whether KCP traffic flows.
 *
 * Purpose: the lobby host sits behind NAT with only TCP 7350 forwarded, so the
 * battle server's UDP port is unreachable from the internet. `match_start`
 * advertises the server's own loopback endpoint (`127.0.0.1:<port>`), which a
 * remote client can never dial. The relay (`/v1/battle/relay`, TCP/WS on the
 * lobby port) is the supported path. This probe proves that path end-to-end
 * before a Windows exe rebuild.
 *
 * Usage:
 *   node tools/probe_battle_relay.mjs
 *   PROBE_CREATE=1 PROBE_MODE_ID=mvp_boss_race node tools/probe_battle_relay.mjs
 *
 * Exit codes: 0 = relay delivered at least one battle datagram,
 *             2 = lobby sign-in failed,
 *             3 = room created but no match_start (no second player),
 *             4 = match started but the relay delivered nothing.
 */

import { bossRaceSeedFromHex } from '../dist/core/math/boss_race_seed.js';
import { LobbyClient, WsLobbyTransport, HttpLobbyTransport } from '../dist/core/net/lobby_client.js';
import { appendFileSync, writeFileSync } from 'node:fs';
import { BattleClient } from '../dist/core/net/battle_client.js';
import { RelayDatagramFactory } from '../dist/platform/web/ws_relay_datagram.js';
import { FetchHttpClient } from '../dist/platform/web/web_http_client.js';

try {
  writeFileSync('/tmp/relay_frames.txt', '');
} catch {
  // best effort only
}

const lobbyWsUrl = process.env.PROBE_LOBBY_WS ?? 'ws://121.225.78.211:7350/v1/lobby/ws';const relayUrl = process.env.PROBE_RELAY_URL ?? 'ws://121.225.78.211:7350/v1/battle/relay';
const deviceId = process.env.PROBE_DEVICE_ID ?? 'dev-probe-relay-0001';
const modeId = process.env.PROBE_MODE_ID ?? 'mvp_boss_race';

const logger = {
  debug: (m) => console.log('[dbg ]', m),
  info: (m) => console.log('[info]', m),
  warn: (m) => console.log('[warn]', m),
  error: (m) => console.log('[err ]', m),
};

/**
 * `SocketLike` over the Node built-in WebSocket.
 *
 * Sends issued before the handshake completes are queued: `KcpSession` starts
 * flushing on its 10 ms tick, which can beat the WS `open` event, and Node's
 * WebSocket throws when you `send()` while still CONNECTING.
 */
class NodeSocket {
  constructor(url) {
    this.ws = new WebSocket(url);
    // Node's WebSocket defaults to binaryType "blob", which would deliver battle
    // datagrams as Blob objects that a Uint8Array view cannot read (every frame
    // would decode to 0 bytes and KCP would never see an ACK). LayaAir's own
    // socket sets "arraybuffer"; mirror that here.
    this.ws.binaryType = 'arraybuffer';
    this.handlers = {};
    this._connected = false;
    this.pending = [];
    this.bytesIn = 0;
    this.bytesOut = 0;
    this.framesSent = 0;
    this.framesQueued = 0;
    this.textFrames = 0;
    this.textSamples = [];
    this.samples = [];
  }

  get connected() {
    return this._connected;
  }

  setHandlers(handlers) {
    this.handlers = handlers;
    this.ws.addEventListener('open', () => {
      this._connected = true;
      for (const frame of this.pending.splice(0)) {
        this.ws.send(frame);
        this.framesSent += 1;
      }
      handlers.onOpen?.();
    });
    this.ws.addEventListener('message', (ev) => {
      const data = ev.data;
      if (typeof data === 'string') {
        // The relay answers a non-binary frame with a TEXT error envelope; the
        // KCP layer silently ignores text, so surface it here.
        this.textFrames += 1;
        if (this.textSamples.length < 3) {
          this.textSamples.push(data.slice(0, 200));
        }
        handlers.onMessage?.(data);
        return;
      }
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer ?? data);
      this.bytesIn += bytes.length;
      handlers.onMessage?.(bytes);
    });
    this.ws.addEventListener('close', (ev) => {
      this._connected = false;
      handlers.onClose?.(ev.code, ev.reason);
    });
    this.ws.addEventListener('error', () => handlers.onError?.(new Error('websocket error')));
  }

  send(data) {
    const size = typeof data === 'string' ? data.length : data.byteLength;
    this.bytesOut += size;
    if (typeof data !== 'string' && this.framesSent + this.framesQueued < 3) {
      // Capture the exact bytes we put on the wire so they can be replayed
      // through a known-good channel to separate "bad bytes" from "bad WS".
      const view = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      try {
        appendFileSync('/tmp/relay_frames.txt', Buffer.from(view).toString('hex') + '\n');
      } catch {
        // best effort only
      }
    }
    if (!this._connected) {
      this.framesQueued += 1;
      this.pending.push(data);
      return;
    }
    this.framesSent += 1;
    this.ws.send(data);
  }

  close(code, reason) {
    this.ws.close(code, reason);
  }
}

class NodeSocketFactory {
  constructor() {
    this.sockets = [];
  }

  connect(url) {
    console.log('[probe] opening socket', url);
    const socket = new NodeSocket(url);
    this.sockets.push(socket);
    return socket;
  }
}

const realTimer = {
  now: () => Date.now(),
  setInterval: (cb, ms) => setInterval(cb, ms),
  clearInterval: (h) => clearInterval(h),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h),
};

function waitForOpen(socket, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`open timeout after ${timeoutMs}ms`)), timeoutMs);
    socket.ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('socket error before open'));
    });
  });
}

// --- 1. lobby sign-in + bootstrap -------------------------------------------

const lobbySocket = new NodeSocket(lobbyWsUrl);
const lobbyHttpBase = process.env.PROBE_LOBBY_HTTP ?? 'http://121.225.78.211:7350';
// Same wiring as SpellKardApp: WS for the routed ops, HTTP for the REST-only ones.
const httpTransport = new HttpLobbyTransport(new FetchHttpClient(lobbyHttpBase));
const transport = new WsLobbyTransport(lobbySocket, {
  logger,
  platform: 'node',
  clientBuild: 'probe-relay',
  userId: deviceId,
  fallback: httpTransport,
});
const client = new LobbyClient({ transport, logger });
transport.onEvent((event) => client.dispatchEvent(event));

try {
  await waitForOpen(lobbySocket);
} catch (error) {
  console.error('[probe] FAILED to reach the lobby:', error.message);
  process.exit(2);
}

const session = await client.loginAnonymous('RelayProbe');
console.log('[probe] loginAnonymous =>', session === null ? 'FAILED' : JSON.stringify(session));
if (session === null) {
  console.error('[probe] lastError =', client.lastError);
  process.exit(2);
}

await client.bootstrap(session.rulesetVersion ?? '');
console.log('[probe] bootstrap ok, playerId =', client.session?.playerId ?? '(none)');

// --- 2. create a room and wait for the bot to fill it -----------------------

let matchStart = null;
client.onEvent((event) => {
  console.log('[probe] event:', event.kind);
  if (event.kind === 'match_start') {
    matchStart = event;
  }
});

if (process.env.PROBE_CREATE === '1') {
  const room = await client.createRoom(process.env.PROBE_ROOM_CODE ?? 'RACE01', modeId);
  console.log('[probe] createRoom =>', room === null ? 'FAILED ' + client.lastError : JSON.stringify(room));
  if (room === null) {
    process.exit(3);
  }
}

const deadline = Date.now() + Number(process.env.PROBE_WAIT_MS ?? 45000);
while (matchStart === null && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 500));
}

if (matchStart === null) {
  console.error('[probe] no match_start within the wait window (did a second player join?)');
  process.exit(3);
}

console.log('[probe] MATCH STARTED =>', JSON.stringify(matchStart));

// --- 2b. mirror LobbyFlow.ready(): REST-only calls, then allocation + ticket --
//
// These go through the HTTP fallback transport (they have no WS route), which is
// exactly the path that used to throw `lobby_transport_error:match.ready` on the
// Windows exe because LayaNative has no `fetch`.
const readyOk = await client.readyMatch(matchStart.matchId);
console.log('[probe] readyMatch =>', readyOk, readyOk ? '' : client.lastError);
const allocation = await client.fetchBattleAllocation(matchStart.matchId);
console.log('[probe] battle.allocation =>', allocation === null ? 'FAILED ' + client.lastError : JSON.stringify(allocation));
const ticket = await client.fetchBattleTicket(matchStart.matchId);
console.log('[probe] battle.ticket =>', ticket === null ? 'FAILED ' + client.lastError : JSON.stringify({ ticketId: ticket.ticketId, playerId: ticket.playerId }));

// --- 3. battle channel over the lobby WebSocket relay -----------------------

const relaySockets = new NodeSocketFactory();
const relayFactory = new RelayDatagramFactory(relaySockets, relayUrl);
const battle = new BattleClient({ datagramFactory: relayFactory, timer: realTimer, logger });
const relaySocket = () => relaySockets.sockets[relaySockets.sockets.length - 1] ?? null;

let snapshots = 0;
battle.onSnapshot((snapshot) => {
  snapshots += 1;
  if (snapshots <= 3) {
    console.log('[probe] snapshot #' + snapshots, JSON.stringify(snapshot).slice(0, 240));
  }
});
battle.onResult((result) => console.log('[probe] battle result =>', JSON.stringify(result).slice(0, 240)));

const localPlayerId = matchStart.playerId || client.session?.playerId || '';
console.log('[probe] roster playerId =', JSON.stringify(localPlayerId));
const ok = battle.connect({
  matchId: matchStart.matchId,
  playerId: localPlayerId,
  playerIds: matchStart.playerIds?.length ? matchStart.playerIds : [localPlayerId],
  modeId: matchStart.modeId ?? modeId,
  rulesetVersion: matchStart.rulesetVersion ?? '',
  endpoint: matchStart.endpoint,
  serverSeed: bossRaceSeedFromHex(matchStart.serverSeedHex ?? ''),
});
console.log('[probe] battle.connect =>', ok, 'conv =', battle.conv, 'state =', battle.state);

// Control experiment: push one hand-crafted KCP PUSH straight down the relay
// socket, bypassing KcpSession/encodeBattleInput entirely. Any KCP receiver must
// ACK `sn=0`, so a reply proves the WS→UDP→WS path is healthy and isolates the
// failure to the client's own KCP/payload code.
function kcpPush(conv) {
  const buffer = new ArrayBuffer(25);
  const view = new DataView(buffer);
  view.setUint32(0, conv >>> 0, true); // conv
  view.setUint8(4, 81); // IKCP_CMD_PUSH
  view.setUint8(5, 1); // frg
  view.setUint16(6, 128, true); // wnd
  view.setUint32(8, 0, true); // ts
  view.setUint32(12, 0, true); // sn
  view.setUint32(16, 0, true); // una
  view.setUint32(20, 1, true); // len
  new Uint8Array(buffer)[24] = 0x41; // 'A'
  return buffer;
}
if (relaySocket() !== null) {
  try {
    relaySocket().ws.send(kcpPush(battle.conv));
    console.log('[probe] sent raw KCP PUSH control frame (connected=' + relaySocket().connected + ')');
  } catch (error) {
    console.log('[probe] raw control frame failed:', String(error));
  }
}

const battleDeadline = Date.now() + Number(process.env.PROBE_BATTLE_MS ?? 30000);
// The battle server only learns which KCP conv belongs to which roster player
// from the *first* `BattleInput` it receives (MatchServer::HandleSessionPayload
// binds `player_by_conv_`), and it broadcasts snapshots only to bound sessions.
// A silent client therefore never gets a snapshot back — the probe must drive
// inputs, exactly like BattleScene does every frame.
let tick = 0;
const inputTimer = setInterval(() => {
  tick += 1;
  battle.sendInput(tick, 0, false, true, false);
}, 16);

const relay = relaySocket();
console.log(
  '[probe] relay socket: connected=' +
    (relay?.connected ?? 'n/a') +
    ' framesSent=' +
    (relay?.framesSent ?? 0) +
    ' framesQueued=' +
    (relay?.framesQueued ?? 0) +
    ' pending=' +
    (relay?.pending.length ?? 0),
);

while (Date.now() < battleDeadline) {
  await new Promise((r) => setTimeout(r, 1000));
  console.log(
    `[probe] state=${battle.state} snapshots=${snapshots} ticks_sent=${tick} ` +
      `relay_out=${relay?.bytesOut ?? 0} relay_in=${relay?.bytesIn ?? 0} ` +
      `frames_sent=${relay?.framesSent ?? 0} pending=${relay?.pending.length ?? 0} ` +
      `text_in=${relay?.textFrames ?? 0} kcp_send_failures=${battle.session?.sendFailures ?? 'n/a'}`,
  );
  if (snapshots > 0) {
    break;
  }
}
clearInterval(inputTimer);

if ((relay?.textFrames ?? 0) > 0) {
  console.log('[probe] relay TEXT frames:', JSON.stringify(relay?.textSamples));
}

if (snapshots > 0) {
  console.log(`[probe] RESULT: relay OK — ${snapshots} snapshot(s) over the WS relay`);
  process.exit(0);
}

console.error('[probe] RESULT: match started but the relay delivered no snapshot');
console.error('[probe] battle.lastError =', battle.lastError);
process.exit(4);
