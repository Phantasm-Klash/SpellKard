/**
 * Lobby / business-server client (Gensoulkyo).
 *
 * Gensoulkyo exposes the same operations over three transports: REST
 * (`runtime/httpapi`), Nakama-style RPC, and Nakama-style WSS dispatch
 * (`runtime/nakamaapi`). The client models the operation layer once and swaps
 * the transport, so web builds can use the WebSocket relay while native builds
 * use HTTP without duplicating business logic.
 *
 * Wire-format note: the exact WS envelope is not frozen server-side yet
 * (`HandleWSSMessage` takes a `WSSMessage` value, but no `Upgrader` is wired
 * up in `runtime/httpapi`). `WsLobbyTransport` therefore uses the documented
 * request/response JSON shape below and is marked as the integration seam.
 */

import type { Logger, SocketLike } from './transport';
import { nullLogger } from './transport';

/** Gensoulkyo `nakamaapi.Response`. */
export interface LobbyRpcResponse {
  ok: boolean;
  status: number;
  error_code?: string;
  message?: string;
  payload?: unknown;
}

export interface LobbyRpcRequest {
  /** Operation id, e.g. `auth.anonymous`, `rooms.create`, `battle.ticket`. */
  id: string;
  cid?: string;
  session_id?: string;
  user_id?: string;
  display_name?: string;
  payload?: Record<string, unknown>;
}

export interface LobbyTransport {
  call(request: LobbyRpcRequest): Promise<LobbyRpcResponse>;
  close(): void;
}

export interface HttpResponseLike {
  status: number;
  body: unknown;
}

export interface HttpClient {
  request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<HttpResponseLike>;
}

export interface LobbyClientConfig {
  transport: LobbyTransport;
  logger?: Logger;
  clientBuild?: string;
  platform?: string;
}

export interface SessionState {
  sessionToken: string;
  userId: string;
  playerId: string;
  displayName: string;
  characterId: string;
  rulesetVersion: string;
  unlockedCharacterIds: string[];
}

export interface RoomPlayerView {
  userId: string;
  playerId: string;
  displayName: string;
  ready: boolean;
  host: boolean;
  connected: boolean;
  characterId: string;
}

export interface RoomView {
  roomCode: string;
  hostUserId: string;
  modeId: string;
  allReady: boolean;
  rulesetVersion: string;
  players: RoomPlayerView[];
}

export interface BattleAllocationView {
  matchId: string;
  modeId: string;
  battleServerId: string;
  endpoint: string;
  serverSeedHex: string;
}

export interface BattleTicketView {
  ticketId: string;
  matchId: string;
  playerId: string;
  modeId: string;
  battleServerId: string;
  endpoint: string;
  rulesetVersion: string;
  expiresAtMs: number;
  signatureAlg: string;
  keyId: string;
  signatureHex: string;
  /** Raw signed-ticket payload as returned by the server (kept for the handshake). */
  raw: Record<string, unknown>;
}

export interface MatchResultView {
  matchId: string;
  winnerPlayerId: string;
  points: Record<string, number>;
  replayId: string;
  serverAuthoritative: boolean;
  modeId: string;
  settledAtMs: number;
}

/** Gensoulkyo matchmaking queue ticket (`matchmaking.join` / `.ticket` / `.cancel`). */
export interface MatchmakingTicketView {
  ticketId: string;
  modeId: string;
  /** Server-defined queue status: `queued`, `matched`, `cancelled`, … */
  queueStatus: string;
  /** Set once the queue finds a match for this ticket. */
  matchId: string;
  /** Set when the match is a room-code match instead of a queue match. */
  roomCode: string;
}

export type LobbyEvent =
  | { kind: 'room_state'; room: RoomView }
  | { kind: 'match_start'; matchId: string; serverSeedHex: string; endpoint: string; playerIds: string[] }
  | { kind: 'match_result'; result: MatchResultView }
  | { kind: 'transport_closed'; reason: string };

export type LobbyEventListener = (event: LobbyEvent) => void;

/**
 * High-level lobby client. All methods return `null` on failure and surface the
 * reason through `lastError`, mirroring the Godot prototype's non-throwing
 * adapter style while staying idiomatic for TypeScript callers.
 */
export class LobbyClient {
  private readonly transport: LobbyTransport;
  private readonly logger: Logger;
  private readonly clientBuild: string;
  private readonly platform: string;
  private readonly listeners: LobbyEventListener[] = [];
  private sequence = 0;

  session: SessionState | null = null;
  room: RoomView | null = null;
  allocation: BattleAllocationView | null = null;
  ticket: BattleTicketView | null = null;
  matchmakingTicket: MatchmakingTicketView | null = null;
  lastError = '';
  lastResponse: LobbyRpcResponse | null = null;

  constructor(config: LobbyClientConfig) {
    this.transport = config.transport;
    this.logger = config.logger ?? nullLogger;
    this.clientBuild = config.clientBuild ?? '0.1.0-draft';
    this.platform = config.platform ?? 'web';
  }

  onEvent(listener: LobbyEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  private emit(event: LobbyEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /** Dispatch a lobby event received out-of-band (e.g. from the WS push stream). */
  dispatchEvent(event: LobbyEvent): void {
    if (event.kind === 'room_state') {
      this.room = event.room;
    }
    this.emit(event);
  }

  private nextCid(): string {
    this.sequence += 1;
    return `c${this.sequence}`;
  }

  private async call(
    id: string,
    payload: Record<string, unknown> = {},
  ): Promise<LobbyRpcResponse> {
    const request: LobbyRpcRequest = {
      id,
      cid: this.nextCid(),
      payload,
    };
    if (this.session !== null) {
      request.session_id = this.session.sessionToken;
      request.user_id = this.session.userId;
    }
    try {
      const response = await this.transport.call(request);
      this.lastResponse = response;
      if (!response.ok) {
        this.lastError = response.error_code ?? `lobby_call_failed:${id}`;
        this.logger.warn(`lobby ${id} failed: ${this.lastError} (${response.message ?? ''})`);
      } else {
        this.lastError = '';
      }
      return response;
    } catch (error) {
      this.lastError = `lobby_transport_error:${id}`;
      this.logger.error(`lobby ${id} threw: ${String(error)}`);
      return { ok: false, status: 0, error_code: this.lastError };
    }
  }

  /** `auth.anonymous` / `POST /v1/auth/anonymous`. */
  async loginAnonymous(displayName = 'Player'): Promise<SessionState | null> {
    const response = await this.call('auth.anonymous', {
      display_name: displayName,
      platform: this.platform,
      client_build: this.clientBuild,
    });
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    const token = stringField(payload, 'session_token', 'sessionToken');
    const userId = stringField(payload, 'user_id', 'userId');
    if (token === '' || userId === '') {
      this.lastError = 'login_missing_session';
      return null;
    }
    this.session = {
      sessionToken: token,
      userId,
      playerId: stringField(payload, 'player_id', 'playerId'),
      displayName: stringField(payload, 'display_name', 'displayName') || displayName,
      characterId: stringField(payload, 'character_id', 'characterId'),
      rulesetVersion: stringField(payload, 'ruleset_version', 'rulesetVersion'),
      unlockedCharacterIds: stringArrayField(payload, 'unlocked_character_ids', 'unlockedCharacterIds'),
    };
    return this.session;
  }

  /** `bootstrap` / `GET /v1/bootstrap`. */
  async bootstrap(knownRulesetVersion = ''): Promise<SessionState | null> {
    const response = await this.call('bootstrap', { known_ruleset_version: knownRulesetVersion });
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    const profile = isRecord(payload.profile) ? payload.profile : {};
    const base = this.session ?? {
      sessionToken: '',
      userId: '',
      playerId: '',
      displayName: '',
      characterId: '',
      rulesetVersion: '',
      unlockedCharacterIds: [],
    };
    this.session = {
      sessionToken: base.sessionToken,
      userId: stringField(profile, 'user_id', 'userId') || base.userId,
      playerId: stringField(profile, 'player_id', 'playerId') || base.playerId,
      displayName: stringField(profile, 'display_name', 'displayName') || base.displayName,
      characterId: stringField(profile, 'character_id', 'characterId') || base.characterId,
      rulesetVersion: stringField(payload, 'ruleset_version', 'rulesetVersion') || base.rulesetVersion,
      unlockedCharacterIds:
        stringArrayField(payload, 'unlocked_character_ids', 'unlockedCharacterIds').length > 0
          ? stringArrayField(payload, 'unlocked_character_ids', 'unlockedCharacterIds')
          : base.unlockedCharacterIds,
    };
    return this.session;
  }

  /** `rooms.create` / `POST /v1/rooms/create`. */
  async createRoom(roomCode: string, modeId = 'mvp_boss_race'): Promise<RoomView | null> {
    const response = await this.call('rooms.create', {
      room_code: roomCode,
      mode_id: modeId,
      host_user_id: this.session?.userId ?? '',
    });
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    const room = isRecord(payload.room) ? payload.room : payload;
    this.room = this.roomFromPayload(room, roomCode, modeId);
    this.emit({ kind: 'room_state', room: this.room });
    return this.room;
  }

  /** `rooms.join` / `POST /v1/rooms/{code}/join`. */
  async joinRoom(roomCode: string): Promise<RoomView | null> {
    const response = await this.call('rooms.join', {
      room_code: roomCode,
      user_id: this.session?.userId ?? '',
      player_id: this.session?.playerId ?? '',
    });
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    const room = isRecord(payload.room) ? payload.room : payload;
    this.room = this.roomFromPayload(room, roomCode, stringField(payload, 'mode_id', 'modeId'));
    if (Array.isArray(payload.players)) {
      this.room.players = payload.players.filter(isRecord).map((player) => this.playerFromPayload(player));
    }
    this.emit({ kind: 'room_state', room: this.room });
    return this.room;
  }

  /** `rooms.leave` / `POST /v1/rooms/{code}/leave`. */
  async leaveRoom(reason = 'client_left'): Promise<boolean> {
    const roomCode = this.room?.roomCode ?? '';
    const response = await this.call('rooms.leave', { room_code: roomCode, reason });
    if (response.ok) {
      this.room = null;
    }
    return response.ok;
  }

  /** `rooms.get` / `GET /v1/rooms/{code}`. */
  async refreshRoom(): Promise<RoomView | null> {
    const roomCode = this.room?.roomCode ?? '';
    const response = await this.call('rooms.get', { room_code: roomCode });
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    this.room = this.roomFromPayload(payload, roomCode, stringField(payload, 'mode_id', 'modeId'));
    this.emit({ kind: 'room_state', room: this.room });
    return this.room;
  }

  /** `match.ready` / `POST /v1/matches/{id}/ready`. */
  async readyMatch(matchId = ''): Promise<boolean> {
    const response = await this.call('match.ready', { match_id: matchId });
    return response.ok;
  }

  /**
   * `matchmaking.join` / `POST /v1/matchmaking/join`.
   *
   * Enqueues the player for a mode and stores the returned queue ticket. The
   * server owns match creation; the client only polls the ticket afterwards.
   */
  async joinMatchmaking(
    modeId = 'mvp_boss_race',
    modeParams: Record<string, unknown> = {},
  ): Promise<MatchmakingTicketView | null> {
    const response = await this.call('matchmaking.join', {
      mode_id: modeId,
      mode_params: modeParams,
    });
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    this.matchmakingTicket = this.matchmakingFromPayload(response.payload, modeId);
    return this.matchmakingTicket;
  }

  /** `matchmaking.ticket` / `GET /v1/matchmaking/tickets/{ticket_id}`. */
  async fetchMatchmakingTicket(ticketId = ''): Promise<MatchmakingTicketView | null> {
    const target = ticketId !== '' ? ticketId : this.matchmakingTicket?.ticketId ?? '';
    if (target === '') {
      this.lastError = 'matchmaking_ticket_missing_id';
      return null;
    }
    const response = await this.call('matchmaking.ticket', { ticket_id: target });
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    this.matchmakingTicket = this.matchmakingFromPayload(response.payload, this.matchmakingTicket?.modeId ?? '');
    return this.matchmakingTicket;
  }

  /** `matchmaking.cancel` / `POST /v1/matchmaking/tickets/{ticket_id}/cancel`. */
  async cancelMatchmaking(ticketId = ''): Promise<boolean> {
    const target = ticketId !== '' ? ticketId : this.matchmakingTicket?.ticketId ?? '';
    if (target === '') {
      this.lastError = 'matchmaking_cancel_missing_id';
      return false;
    }
    const response = await this.call('matchmaking.cancel', { ticket_id: target });
    if (response.ok) {
      this.matchmakingTicket = null;
    }
    return response.ok;
  }

  /** `battle.allocation` — the server-assigned battle server + seed. */
  async fetchBattleAllocation(matchId = ''): Promise<BattleAllocationView | null> {
    const response = await this.call('battle.allocation', { match_id: matchId });
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    this.allocation = {
      matchId: stringField(payload, 'match_id', 'matchId'),
      modeId: stringField(payload, 'mode_id', 'modeId'),
      battleServerId: stringField(payload, 'battle_server_id', 'battleServerId'),
      endpoint: stringField(payload, 'endpoint'),
      serverSeedHex: hexField(payload, 'server_seed', 'serverSeed'),
    };
    return this.allocation;
  }

  /** `battle.ticket` — the signed ticket used in the battle handshake. */
  async fetchBattleTicket(matchId = ''): Promise<BattleTicketView | null> {
    const response = await this.call('battle.ticket', { match_id: matchId });
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    const ticket = isRecord(payload.ticket) ? payload.ticket : payload;
    this.ticket = {
      ticketId: stringField(ticket, 'ticket_id', 'ticketId'),
      matchId: stringField(ticket, 'match_id', 'matchId'),
      playerId: stringField(ticket, 'player_id', 'playerId'),
      modeId: stringField(ticket, 'mode_id', 'modeId'),
      battleServerId: stringField(ticket, 'battle_server_id', 'battleServerId'),
      endpoint: stringField(ticket, 'endpoint'),
      rulesetVersion: stringField(ticket, 'ruleset_version', 'rulesetVersion'),
      expiresAtMs: numberField(ticket, 'expires_at_ms', 'expiresAtMs'),
      signatureAlg: stringField(payload, 'signature_alg', 'signatureAlg'),
      keyId: stringField(payload, 'key_id', 'keyId'),
      signatureHex: hexField(payload, 'signature'),
      raw: payload,
    };
    return this.ticket;
  }

  /** `replay.get` — server-owned replay audit record for a finished match. */
  async fetchReplay(replayId: string): Promise<Record<string, unknown> | null> {
    const response = await this.call('replay.get', { replay_id: replayId });
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    return response.payload;
  }

  /**
   * Applies a `MatchStartMessage` (proto or JSON-shaped) delivered over the lobby
   * transport, and notifies listeners so the app can switch to the battle scene.
   */
  applyMatchStart(message: {
    matchId?: string;
    match_id?: string;
    serverSeed?: Uint8Array;
    server_seed?: Uint8Array;
    serverSeedHex?: string;
    endpoint?: string;
    playerIds?: string[];
    player_ids?: string[];
  }): boolean {
    const matchId = message.matchId ?? message.match_id ?? '';
    if (matchId === '') {
      this.lastError = 'match_start_missing_match_id';
      return false;
    }
    const seedHex = message.serverSeedHex ?? bytesToHex(message.serverSeed ?? message.server_seed ?? new Uint8Array(0));
    const endpoint = message.endpoint ?? '';
    const playerIds = message.playerIds ?? message.player_ids ?? [];
    this.matchmakingTicket = null;
    this.emit({ kind: 'match_start', matchId, serverSeedHex: seedHex, endpoint, playerIds });
    return true;
  }

  /** Applies a `MatchResultMessage` and notifies listeners for the result scene. */
  applyMatchResult(message: MatchResultView): void {
    this.emit({ kind: 'match_result', result: message });
  }

  close(): void {
    this.transport.close();
  }

  private roomFromPayload(payload: Record<string, unknown>, roomCode: string, modeId: string): RoomView {
    return {
      roomCode: stringField(payload, 'room_code', 'roomCode') || roomCode,
      hostUserId: stringField(payload, 'host_user_id', 'hostUserId'),
      modeId: stringField(payload, 'mode_id', 'modeId') || modeId,
      allReady: booleanField(payload, 'all_ready', 'allReady'),
      rulesetVersion: stringField(payload, 'ruleset_version', 'rulesetVersion'),
      players: Array.isArray(payload.players)
        ? payload.players.filter(isRecord).map((player) => this.playerFromPayload(player))
        : [],
    };
  }

  private playerFromPayload(payload: Record<string, unknown>): RoomPlayerView {
    return {
      userId: stringField(payload, 'user_id', 'userId'),
      playerId: stringField(payload, 'player_id', 'playerId'),
      displayName: stringField(payload, 'display_name', 'displayName'),
      ready: booleanField(payload, 'ready'),
      host: booleanField(payload, 'host'),
      connected: booleanField(payload, 'connected'),
      characterId: stringField(payload, 'character_id', 'characterId'),
    };
  }

  private matchmakingFromPayload(payload: Record<string, unknown>, modeId: string): MatchmakingTicketView {
    const ticket = isRecord(payload.ticket) ? payload.ticket : payload;
    return {
      ticketId: stringField(ticket, 'ticket_id', 'ticketId'),
      modeId: stringField(ticket, 'mode_id', 'modeId') || modeId,
      queueStatus: stringField(ticket, 'queue_status', 'queueStatus') || 'queued',
      matchId: stringField(ticket, 'match_id', 'matchId'),
      roomCode: stringField(ticket, 'room_code', 'roomCode'),
    };
  }
}

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

/**
 * HTTP transport. Maps operation ids onto Gensoulkyo's REST routes.
 * Unknown operations fall back to `POST /v1/rpc/{id}` so the mapping can grow
 * without touching this class.
 */
export class HttpLobbyTransport implements LobbyTransport {
  constructor(private readonly http: HttpClient, private readonly bearer = '') {}

  async call(request: LobbyRpcRequest): Promise<LobbyRpcResponse> {
    const route = REST_ROUTES[request.id];
    const method = route?.method ?? 'POST';
    const path = route !== undefined ? route.path(request) : `/v1/rpc/${request.id}`;
    const headers: Record<string, string> = {};
    if (this.bearer !== '') {
      headers.Authorization = `Bearer ${this.bearer}`;
    }
    const response = await this.http.request(method, path, request.payload ?? {}, headers);
    const body = isRecord(response.body) ? response.body : {};
    return {
      ok: response.status >= 200 && response.status < 300 && body.ok !== false,
      status: response.status,
      error_code: stringField(body, 'error_code', 'errorCode') || undefined,
      message: stringField(body, 'message') || undefined,
      payload: body.payload ?? body,
    };
  }

  close(): void {
    // HTTP is stateless; nothing to release.
  }
}

interface RestRoute {
  method: 'GET' | 'POST';
  path: (request: LobbyRpcRequest) => string;
}

function payloadString(request: LobbyRpcRequest, ...keys: string[]): string {
  const payload = request.payload ?? {};
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return '';
}

const REST_ROUTES: Record<string, RestRoute> = {
  'auth.anonymous': { method: 'POST', path: () => '/v1/auth/anonymous' },
  bootstrap: { method: 'GET', path: () => '/v1/bootstrap' },
  'rooms.create': { method: 'POST', path: () => '/v1/rooms/create' },
  'rooms.list': { method: 'GET', path: () => '/v1/rooms' },
  'rooms.get': { method: 'GET', path: (r) => `/v1/rooms/${payloadString(r, 'room_code', 'roomCode')}` },
  'rooms.rules': { method: 'GET', path: (r) => `/v1/rooms/${payloadString(r, 'room_code', 'roomCode')}/rules` },
  'rooms.join': { method: 'POST', path: (r) => `/v1/rooms/${payloadString(r, 'room_code', 'roomCode')}/join` },
  'rooms.leave': { method: 'POST', path: (r) => `/v1/rooms/${payloadString(r, 'room_code', 'roomCode')}/leave` },
  'match.ready': { method: 'POST', path: (r) => `/v1/matches/${payloadString(r, 'match_id', 'matchId')}/ready` },
  'matchmaking.join': { method: 'POST', path: () => '/v1/matchmaking/join' },
  'matchmaking.ticket': {
    method: 'GET',
    path: (r) => `/v1/matchmaking/tickets/${payloadString(r, 'ticket_id', 'ticketId')}`,
  },
  'matchmaking.cancel': {
    method: 'POST',
    path: (r) => `/v1/matchmaking/tickets/${payloadString(r, 'ticket_id', 'ticketId')}/cancel`,
  },
  'battle.allocation': {
    method: 'GET',
    path: (r) => `/v1/battles/${payloadString(r, 'match_id', 'matchId')}/allocation`,
  },
  'battle.ticket': {
    method: 'GET',
    path: (r) => `/v1/battles/${payloadString(r, 'match_id', 'matchId')}/ticket`,
  },
  'replay.get': { method: 'GET', path: (r) => `/v1/replays/${payloadString(r, 'replay_id', 'replayId')}` },
};

/**
 * WebSocket transport. Sends `LobbyRpcRequest` JSON frames and correlates
 * `LobbyRpcResponse` frames by `cid`.
 *
 * This is the seam where the web build multiplexes lobby RPC and the battle
 * KCP relay over one socket once Gensoulkyo exposes a WS upgrader.
 */
export class WsLobbyTransport implements LobbyTransport {
  private readonly pending = new Map<string, (response: LobbyRpcResponse) => void>();
  private closed = false;

  constructor(private readonly socket: SocketLike, private readonly logger: Logger = nullLogger) {
    this.socket.setHandlers({
      onMessage: (data) => this.handleMessage(data),
      onClose: (code, reason) => this.handleClose(code, reason),
      onError: (error) => this.logger.error(`lobby ws error: ${error.message}`),
    });
  }

  call(request: LobbyRpcRequest): Promise<LobbyRpcResponse> {
    if (this.closed || !this.socket.connected) {
      return Promise.resolve({ ok: false, status: 0, error_code: 'lobby_ws_not_connected' });
    }
    const cid = request.cid ?? request.id;
    return new Promise<LobbyRpcResponse>((resolve) => {
      this.pending.set(cid, resolve);
      this.socket.send(JSON.stringify({ ...request, cid }));
    });
  }

  close(): void {
    this.closed = true;
    this.socket.close();
    for (const resolve of this.pending.values()) {
      resolve({ ok: false, status: 0, error_code: 'lobby_ws_closed' });
    }
    this.pending.clear();
  }

  private handleMessage(data: string | Uint8Array): void {
    const text = typeof data === 'string' ? data : decodeUtf8Loose(data);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.logger.warn('lobby ws: dropped non-JSON frame');
      return;
    }
    if (!isRecord(parsed)) {
      return;
    }
    const cid = stringField(parsed, 'cid');
    const resolve = this.pending.get(cid);
    if (resolve === undefined) {
      return;
    }
    this.pending.delete(cid);
    resolve({
      ok: booleanField(parsed, 'ok'),
      status: numberField(parsed, 'status'),
      error_code: stringField(parsed, 'error_code', 'errorCode') || undefined,
      message: stringField(parsed, 'message') || undefined,
      payload: parsed.payload,
    });
  }

  private handleClose(code: number, reason: string): void {
    this.closed = true;
    for (const resolve of this.pending.values()) {
      resolve({ ok: false, status: 0, error_code: `lobby_ws_closed:${code}:${reason}` });
    }
    this.pending.clear();
  }
}

// ---------------------------------------------------------------------------
// Small typed accessors shared by the payload mapping code
// ---------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stringField(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return '';
}

export function numberField(source: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string' && value !== '' && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return 0;
}

export function booleanField(source: Record<string, unknown>, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return false;
}

export function stringArrayField(source: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string');
    }
  }
  return [];
}

/** Accepts hex strings or `{type:'Buffer', data:[...]}` shapes. */
export function hexField(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string') {
      return value;
    }
    if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
      return bytesToHex(new Uint8Array(value as number[]));
    }
    if (isRecord(value) && Array.isArray(value.data)) {
      return bytesToHex(new Uint8Array(value.data as number[]));
    }
  }
  return '';
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.substr(i * 2, 2), 16) || 0;
  }
  return out;
}

/** Big-endian seed hex → the 32-bit seed the boss-race RNG consumes. */
export function seedFromHex(hex: string): number {
  const bytes = hexToBytes(hex);
  let value = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    value = (value * 256 + bytes[i]) % 2 ** 32;
  }
  return value >>> 0;
}

function decodeUtf8Loose(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}
