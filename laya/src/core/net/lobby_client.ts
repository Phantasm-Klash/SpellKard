/**
 * Lobby / business-server client (Gensoulkyo).
 *
 * Gensoulkyo exposes the same operations over three transports: REST
 * (`runtime/httpapi`), Nakama-style RPC, and Nakama-style WSS dispatch
 * (`runtime/nakamaapi`). The client models the operation layer once and swaps
 * the transport, so web builds can use the WebSocket relay while native builds
 * use HTTP without duplicating business logic.
 *
 * Wire-format note: the WS transport speaks Gensoulkyo's lobby WS protocol
 * (`runtime/lobbyws/protocol.go`): a `{"type", "seq", "payload"}` envelope whose
 * payload field names follow `lobby.proto` (see `lobby_protocol.ts`). The server
 * does not echo `seq`, so responses are correlated by message type. Operations
 * that the WS protocol does not define (matchmaking, battle ticket, replay, …)
 * are delegated to an optional fallback transport.
 */

import type { Logger, SocketLike } from './transport';
import { nullLogger } from './transport';
import {
  LOBBY_MESSAGE,
  LOBBY_WS_ROUTES,
  DEFAULT_VERSION_STAMP,
  decodeLobbyEnvelope,
  encodeLobbyEnvelope,
  errorStatusFromPayload,
  errorStatusOf,
  type VersionStamp,
} from './lobby_protocol';

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
  device_id?: string;
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
  deviceId?: string;
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

export interface CardInventoryEntryView {
  cardId: string;
  copies: number;
  level: number;
}

export interface InventoryView {
  userId: string;
  rulesetVersion: string;
  items: CardInventoryEntryView[];
  serverAuthoritative: boolean;
}

export interface DeckRecordView {
  deckId: string;
  name: string;
  format: string;
  rulesetVersion: string;
  cardIds: string[];
  active: boolean;
}

export interface DeckListView {
  userId: string;
  activeDeckId: string;
  rulesetVersion: string;
  decks: DeckRecordView[];
  serverAuthoritative: boolean;
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
  private readonly deviceId: string;
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
    this.deviceId = config.deviceId ?? '';
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
    if (this.deviceId !== '') {
      request.device_id = this.deviceId;
    }
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
      device_id: this.deviceId,
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

  /** `inventory.get` — server-owned card inventory projection. */
  async fetchInventory(): Promise<InventoryView | null> {
    const response = await this.call('inventory.get');
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    const items = Array.isArray(payload.items)
      ? payload.items.filter(isRecord).map((item) => ({
          cardId: stringField(item, 'card_id', 'cardId'),
          copies: numberField(item, 'copies'),
          level: numberField(item, 'level'),
        }))
      : [];
    return {
      userId: stringField(payload, 'user_id', 'userId'),
      rulesetVersion: stringField(payload, 'ruleset_version', 'rulesetVersion'),
      items,
      serverAuthoritative: booleanField(payload, 'server_authoritative', 'serverAuthoritative'),
    };
  }

  /** `decks.list` — server-owned saved deck projection. */
  async fetchDecks(): Promise<DeckListView | null> {
    const response = await this.call('decks.list');
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    const decks = Array.isArray(payload.decks)
      ? payload.decks.filter(isRecord).map((deck) => ({
          deckId: stringField(deck, 'deck_id', 'deckId'),
          name: stringField(deck, 'name'),
          format: stringField(deck, 'format'),
          rulesetVersion: stringField(deck, 'ruleset_version', 'rulesetVersion'),
          cardIds: stringArrayField(deck, 'card_ids', 'cardIds'),
          active: booleanField(deck, 'active'),
        }))
      : [];
    return {
      userId: stringField(payload, 'user_id', 'userId'),
      activeDeckId: stringField(payload, 'active_deck_id', 'activeDeckId'),
      rulesetVersion: stringField(payload, 'ruleset_version', 'rulesetVersion'),
      decks,
      serverAuthoritative: booleanField(payload, 'server_authoritative', 'serverAuthoritative'),
    };
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

/**
 * Nakama HTTP RPC transport.
 *
 * Nakama's `/v2/rpc/<id>?unwrap=true` endpoint accepts a JSON string as its
 * RPC payload. `HttpClient` implementations serialize their request body, so
 * this transport deliberately passes `JSON.stringify(payload)` as the body;
 * the platform adapter then performs the outer JSON serialization required on
 * the wire. Auth uses the HTTP key until `auth.anonymous` returns a session
 * token, after which the token is sent as a Bearer credential.
 *
 * This class does not create or alter the business envelope. Authenticated
 * callers must provide the envelope fields in the request payload so the
 * server-side replay and authority guard remains the single source of truth.
 */
export class NakamaLobbyTransport implements LobbyTransport {
  private sessionToken: string;

  constructor(
    private readonly http: HttpClient,
    private readonly options: NakamaLobbyTransportOptions = {},
  ) {
    this.sessionToken = options.sessionToken ?? '';
  }

  async call(request: LobbyRpcRequest): Promise<LobbyRpcResponse> {
    const rpcId = request.id.trim();
    if (rpcId === '') {
      return { ok: false, status: 400, error_code: 'nakama_rpc_id_missing' };
    }
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (this.sessionToken !== '') {
      headers.Authorization = `Bearer ${this.sessionToken}`;
    } else if ((this.options.httpKey ?? '') !== '') {
      headers.Authorization = `Basic ${encodeBasicAuth(`${this.options.httpKey ?? ''}:`)}`;
    }
    const body = request.payload ?? {};
    const envelope = this.options.businessEnvelope?.(request, body) ?? null;
    const wirePayload =
      envelope === null
        ? body
        : {
            business_envelope: envelope,
            body,
          };
    const response = await this.http.request(
      'POST',
      `/v2/rpc/${encodeURIComponent(rpcId)}?unwrap=true`,
      JSON.stringify(wirePayload),
      headers,
    );
    const result = nakamaResponse(response);
    if (result.ok && rpcId === 'auth.anonymous' && isRecord(result.payload)) {
      const token = stringField(result.payload, 'session_token', 'sessionToken');
      if (token !== '') {
        this.sessionToken = token;
      }
    }
    return result;
  }

  close(): void {
    // HTTP is stateless; nothing to release.
  }
}

export interface NakamaLobbyTransportOptions {
  /** Nakama runtime HTTP key used before an authenticated session exists. */
  httpKey?: string;
  /** Optional existing Nakama session token, useful after a cold restart. */
  sessionToken?: string;
  /**
   * Optional business-envelope producer. The producer owns versioning, nonce,
   * body hashing and authentication-tag policy; returning null leaves the
   * payload unwrapped. This is intentionally an injection point rather than a
   * client-side fake signer.
   */
  businessEnvelope?: NakamaBusinessEnvelopeFactory;
}

export type NakamaBusinessEnvelopeFactory = (
  request: LobbyRpcRequest,
  body: Record<string, unknown>,
) => Record<string, unknown> | null;

function nakamaResponse(response: HttpResponseLike): LobbyRpcResponse {
  const body = response.body;
  const statusOk = response.status >= 200 && response.status < 300;
  if (!isRecord(body)) {
    return {
      ok: statusOk,
      status: response.status,
      error_code: statusOk ? undefined : `nakama_http_${response.status}`,
      payload: statusOk ? body : undefined,
    };
  }
  if (body.ok === false || !statusOk) {
    return {
      ok: false,
      status: response.status,
      error_code: stringField(body, 'error_code', 'errorCode', 'code') || `nakama_http_${response.status}`,
      message: stringField(body, 'message'),
      payload: body.payload,
    };
  }
  return {
    ok: statusOk,
    status: response.status,
    error_code: stringField(body, 'error_code', 'errorCode') || undefined,
    message: stringField(body, 'message') || undefined,
    // `unwrap=true` returns the operation payload directly. The fallback also
    // accepts a wrapped response so local proxies remain compatible.
    payload: body.payload ?? body,
  };
}

function encodeBasicAuth(value: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  let buffer = 0;
  let bits = 0;
  for (let index = 0; index < value.length; index += 1) {
    buffer = (buffer << 8) | value.charCodeAt(index);
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      result += alphabet[(buffer >> bits) & 0x3f];
    }
  }
  if (bits > 0) {
    result += alphabet[(buffer << (6 - bits)) & 0x3f];
  }
  while (result.length % 4 !== 0) {
    result += '=';
  }
  return result;
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

function pathSegment(value: string): string {
  return encodeURIComponent(value);
}

function queryString(request: LobbyRpcRequest, ...keys: string[]): string {
  const payload = request.payload ?? {};
  const params: string[] = [];
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' || typeof value === 'number') {
      params.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return params.length === 0 ? '' : `?${params.join('&')}`;
}

const REST_ROUTES: Record<string, RestRoute> = {
  'auth.anonymous': { method: 'POST', path: () => '/v1/auth/anonymous' },
  bootstrap: { method: 'GET', path: () => '/v1/bootstrap' },
  'inventory.get': { method: 'GET', path: () => '/v1/inventory' },
  inventory: { method: 'GET', path: () => '/v1/inventory' },
  'cards.upgrade': { method: 'POST', path: () => '/v1/cards/upgrade' },
  'decks.list': { method: 'GET', path: () => '/v1/decks' },
  decks: { method: 'GET', path: () => '/v1/decks' },
  'decks.save': { method: 'POST', path: () => '/v1/decks/save' },
  'chests.list': { method: 'GET', path: () => '/v1/chests' },
  chests: { method: 'GET', path: () => '/v1/chests' },
  'chests.open': { method: 'POST', path: () => '/v1/chests/open' },
  'presence.heartbeat': { method: 'POST', path: () => '/v1/presence/heartbeat' },
  'rooms.create': { method: 'POST', path: () => '/v1/rooms/create' },
  'rooms.list': { method: 'GET', path: () => '/v1/rooms' },
  'rooms.get': { method: 'GET', path: (r) => `/v1/rooms/${pathSegment(payloadString(r, 'room_code', 'roomCode'))}` },
  'rooms.rules': {
    method: 'GET',
    path: (r) => `/v1/rooms/${pathSegment(payloadString(r, 'room_code', 'roomCode'))}/rules`,
  },
  'rooms.join': {
    method: 'POST',
    path: (r) => `/v1/rooms/${pathSegment(payloadString(r, 'room_code', 'roomCode'))}/join`,
  },
  'rooms.leave': {
    method: 'POST',
    path: (r) => `/v1/rooms/${pathSegment(payloadString(r, 'room_code', 'roomCode'))}/leave`,
  },
  'rooms.messages': {
    method: 'POST',
    path: (r) => `/v1/rooms/${pathSegment(payloadString(r, 'room_code', 'roomCode'))}/messages`,
  },
  'rooms.chat': {
    method: 'POST',
    path: (r) => `/v1/rooms/${pathSegment(payloadString(r, 'room_code', 'roomCode'))}/messages`,
  },
  'rooms.announcement': {
    method: 'POST',
    path: (r) => `/v1/rooms/${pathSegment(payloadString(r, 'room_code', 'roomCode'))}/messages`,
  },
  'activity.claim': { method: 'POST', path: () => '/v1/activity/claim' },
  'matchmaking.join': { method: 'POST', path: () => '/v1/matchmaking/join' },
  'matchmaking.ticket': {
    method: 'GET',
    path: (r) => `/v1/matchmaking/tickets/${pathSegment(payloadString(r, 'ticket_id', 'ticketId'))}`,
  },
  'matchmaking.cancel': {
    method: 'POST',
    path: (r) => `/v1/matchmaking/tickets/${pathSegment(payloadString(r, 'ticket_id', 'ticketId'))}/cancel`,
  },
  'match.ready': {
    method: 'POST',
    path: (r) => `/v1/matches/${pathSegment(payloadString(r, 'match_id', 'matchId'))}/ready`,
  },
  'battle.allocation': {
    method: 'GET',
    path: (r) => `/v1/matches/${pathSegment(payloadString(r, 'match_id', 'matchId'))}/battle-allocation`,
  },
  'battle.ticket': {
    method: 'POST',
    path: (r) => `/v1/matches/${pathSegment(payloadString(r, 'match_id', 'matchId'))}/battle-ticket`,
  },
  'match.input': {
    method: 'POST',
    path: (r) => `/v1/matches/${pathSegment(payloadString(r, 'match_id', 'matchId'))}/input`,
  },
  'match.snapshot': {
    method: 'GET',
    path: (r) => `/v1/matches/${pathSegment(payloadString(r, 'match_id', 'matchId'))}/snapshot`,
  },
  'match.events': {
    method: 'GET',
    path: (r) =>
      `/v1/matches/${pathSegment(payloadString(r, 'match_id', 'matchId'))}/events` +
      queryString(r, 'after', 'limit'),
  },
  'match.mode_action': {
    method: 'POST',
    path: (r) => `/v1/matches/${pathSegment(payloadString(r, 'match_id', 'matchId'))}/mode-action`,
  },
  'match.disconnect': {
    method: 'POST',
    path: (r) => `/v1/matches/${pathSegment(payloadString(r, 'match_id', 'matchId'))}/disconnect`,
  },
  'match.reconnect': {
    method: 'POST',
    path: (r) => `/v1/matches/${pathSegment(payloadString(r, 'match_id', 'matchId'))}/reconnect`,
  },
  'match.settle': {
    method: 'POST',
    path: (r) => `/v1/matches/${pathSegment(payloadString(r, 'match_id', 'matchId'))}/settle`,
  },
  'match.rematch': {
    method: 'POST',
    path: (r) => `/v1/matches/${pathSegment(payloadString(r, 'match_id', 'matchId'))}/rematch`,
  },
  'replay.get': { method: 'GET', path: (r) => `/v1/replays/${pathSegment(payloadString(r, 'replay_id', 'replayId'))}` },
};

/** Configuration for {@link WsLobbyTransport}. */
export interface WsLobbyTransportConfig {
  logger?: Logger;
  /** Version stamp echoed in every request; defaults to the vendored descriptor. */
  version?: VersionStamp;
  platform?: string;
  clientBuild?: string;
  /**
   * Stable anonymous identity used when no session token is available yet. The
   * lobby WS `AuthRequest` needs a `session_token` or a `user_id`.
   */
  userId?: string;
  /**
   * Transport used for operations the lobby WS protocol does not define
   * (matchmaking, battle ticket, replay, …). When omitted those calls fail with
   * `lobby_ws_unsupported_op`.
   */
  fallback?: LobbyTransport;
  /** Receives pushed `room_state` / `match_start` / `match_result` events. */
  onEvent?: (event: LobbyEvent) => void;
}

interface PendingLobbyCall {
  readonly types: readonly number[];
  readonly resolve: (response: LobbyRpcResponse) => void;
}

/**
 * Lobby WebSocket transport. Speaks the `{"type","seq","payload"}` envelope from
 * `runtime/lobbyws/protocol.go`; the server does not echo `seq`, so responses
 * are correlated by message type. Pushed `RoomState` / `MatchStart` /
 * `MatchResult` envelopes are surfaced through `onEvent`.
 */
export class WsLobbyTransport implements LobbyTransport {
  private readonly pending: PendingLobbyCall[] = [];
  private readonly listeners: LobbyEventListener[] = [];
  private readonly logger: Logger;
  private readonly version: VersionStamp;
  private readonly platform: string;
  private readonly clientBuild: string;
  private readonly fallback: LobbyTransport | null;
  private readonly userId: string;
  private sequence = 0;
  private closed = false;

  constructor(private readonly socket: SocketLike, config: WsLobbyTransportConfig = {}) {
    this.logger = config.logger ?? nullLogger;
    this.version = config.version ?? DEFAULT_VERSION_STAMP;
    this.platform = config.platform ?? 'web';
    this.clientBuild = config.clientBuild ?? '0.1.0-draft';
    this.fallback = config.fallback ?? null;
    this.userId = config.userId ?? '';
    if (config.onEvent !== undefined) {
      this.listeners.push(config.onEvent);
    }
    this.socket.setHandlers({
      onMessage: (data) => this.handleMessage(data),
      onClose: (code, reason) => this.handleClose(code, reason),
      onError: (error) => this.logger.error(`lobby ws error: ${error.message}`),
    });
  }

  /** Subscribe to pushed lobby events; returns an unsubscribe function. */
  onEvent(listener: LobbyEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  call(request: LobbyRpcRequest): Promise<LobbyRpcResponse> {
    const route = LOBBY_WS_ROUTES[request.id];
    if (route === undefined) {
      if (this.fallback !== null) {
        return this.fallback.call(request);
      }
      return Promise.resolve({ ok: false, status: 0, error_code: `lobby_ws_unsupported_op:${request.id}` });
    }
    if (this.closed || !this.socket.connected) {
      return Promise.resolve({ ok: false, status: 0, error_code: 'lobby_ws_not_connected' });
    }
    const payload = this.buildRequestPayload(request.id, request);
    this.sequence += 1;
    const frame = encodeLobbyEnvelope(route.requestType, payload, this.sequence);
    return new Promise<LobbyRpcResponse>((resolve) => {
      this.pending.push({ types: route.responseTypes, resolve });
      this.socket.send(frame);
    });
  }

  close(): void {
    this.closed = true;
    this.socket.close();
    this.rejectAll('lobby_ws_closed');
  }

  /** Builds the `lobby.proto` payload for a routed operation. */
  private buildRequestPayload(id: string, request: LobbyRpcRequest): Record<string, unknown> {
    const payload = request.payload ?? {};
    const sessionToken = request.session_id ?? stringField(payload, 'session_token', 'sessionToken');
    const userId =
      (request.user_id ?? stringField(payload, 'user_id', 'userId', 'device_id', 'deviceId')) || this.userId;
    const playerId = stringField(payload, 'player_id', 'playerId');
    const roomCode = stringField(payload, 'room_code', 'roomCode');
    switch (id) {
      case 'auth.anonymous':
        return {
          version: this.version,
          session_token: sessionToken,
          user_id: userId,
          platform: this.platform,
          client_build: this.clientBuild,
        };
      case 'bootstrap':
        return {
          version: this.version,
          session_token: sessionToken,
          user_id: userId,
          known_ruleset_version: stringField(payload, 'known_ruleset_version', 'knownRulesetVersion'),
        };
      case 'rooms.create':
        return {
          version: this.version,
          room_code: roomCode,
          mode_id: stringField(payload, 'mode_id', 'modeId'),
          host_user_id: stringField(payload, 'host_user_id', 'hostUserId') || userId,
          loadout: loadoutPayload(userId, playerId, payload),
          mode_params: stringRecordField(payload, 'mode_params', 'modeParams'),
        };
      case 'rooms.join':
        return {
          version: this.version,
          room_code: roomCode,
          user_id: userId,
          player_id: playerId,
          loadout: loadoutPayload(userId, playerId, payload),
        };
      case 'rooms.leave':
        return {
          version: this.version,
          room_code: roomCode,
          user_id: userId,
          player_id: playerId,
          reason: stringField(payload, 'reason') || 'client_left',
        };
      default:
        return {};
    }
  }

  private handleMessage(data: string | Uint8Array): void {
    const text = typeof data === 'string' ? data : decodeUtf8Loose(data);
    const envelope = decodeLobbyEnvelope(text);
    if (envelope === null) {
      this.logger.warn('lobby ws: dropped non-envelope frame');
      return;
    }
    const type = envelope.type;
    if (type === LOBBY_MESSAGE.Error) {
      const status = errorStatusFromPayload(envelope.payload);
      const pending = this.pending.shift();
      if (pending !== undefined) {
        pending.resolve({ ok: false, status: 0, error_code: status.code, message: status.message });
      } else {
        this.logger.warn(`lobby ws error: ${status.code} ${status.message}`);
      }
      return;
    }
    const index = this.pending.findIndex((entry) => entry.types.includes(type));
    if (index >= 0) {
      const [pending] = this.pending.splice(index, 1);
      const error = errorStatusOf(envelope.payload);
      if (error !== null) {
        pending.resolve({ ok: false, status: 0, error_code: error.code, message: error.message });
      } else {
        pending.resolve({ ok: true, status: 200, payload: envelope.payload });
      }
    }
    this.handlePush(type, envelope.payload);
  }

  private handlePush(type: number, payload: unknown): void {
    switch (type) {
      case LOBBY_MESSAGE.RoomState:
        this.emit({ kind: 'room_state', room: roomViewFromState(payload) });
        break;
      case LOBBY_MESSAGE.MatchStart:
        this.emit(matchStartEvent(payload));
        break;
      case LOBBY_MESSAGE.MatchResult:
        this.emit({ kind: 'match_result', result: matchResultView(payload) });
        break;
      default:
        break;
    }
  }

  private handleClose(code: number, reason: string): void {
    this.closed = true;
    this.rejectAll(`lobby_ws_closed:${code}:${reason}`);
    this.emit({ kind: 'transport_closed', reason: `${code}:${reason}` });
  }

  private rejectAll(errorCode: string): void {
    for (const pending of this.pending) {
      pending.resolve({ ok: false, status: 0, error_code: errorCode });
    }
    this.pending.length = 0;
  }

  private emit(event: LobbyEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function loadoutPayload(userId: string, playerId: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    user_id: stringField(payload, 'user_id', 'userId') || userId,
    player_id: stringField(payload, 'player_id', 'playerId') || playerId,
    character_id: stringField(payload, 'character_id', 'characterId'),
    stage_id: stringField(payload, 'stage_id', 'stageId'),
    rating_code: stringField(payload, 'rating_code', 'ratingCode'),
  };
}

function stringRecordField(source: Record<string, unknown>, ...keys: string[]): Record<string, string> {
  for (const key of keys) {
    const value = source[key];
    if (isRecord(value)) {
      const out: Record<string, string> = {};
      for (const [entryKey, entryValue] of Object.entries(value)) {
        if (typeof entryValue === 'string') {
          out[entryKey] = entryValue;
        }
      }
      return out;
    }
  }
  return {};
}

function numberRecordField(source: Record<string, unknown>, ...keys: string[]): Record<string, number> {
  for (const key of keys) {
    const value = source[key];
    if (isRecord(value)) {
      const out: Record<string, number> = {};
      for (const [entryKey, entryValue] of Object.entries(value)) {
        if (typeof entryValue === 'number') {
          out[entryKey] = entryValue;
        }
      }
      return out;
    }
  }
  return {};
}

/** `RoomStateMessage` payload → the client-facing room view. */
export function roomViewFromState(payload: unknown): RoomView {
  const source = isRecord(payload) ? payload : {};
  return {
    roomCode: stringField(source, 'room_code', 'roomCode'),
    hostUserId: stringField(source, 'host_user_id', 'hostUserId'),
    modeId: stringField(source, 'mode_id', 'modeId'),
    allReady: booleanField(source, 'all_ready', 'allReady'),
    rulesetVersion: stringField(source, 'ruleset_version', 'rulesetVersion'),
    players: Array.isArray(source.players)
      ? source.players.filter(isRecord).map((player) => ({
          userId: stringField(player, 'user_id', 'userId'),
          playerId: stringField(player, 'player_id', 'playerId'),
          displayName: stringField(player, 'display_name', 'displayName'),
          ready: booleanField(player, 'ready'),
          host: booleanField(player, 'host'),
          connected: booleanField(player, 'connected'),
          characterId: stringField(player, 'character_id', 'characterId'),
        }))
      : [],
  };
}

/** `MatchStartMessage` payload → a `match_start` event. */
export function matchStartEvent(payload: unknown): LobbyEvent {
  const source = isRecord(payload) ? payload : {};
  return {
    kind: 'match_start',
    matchId: stringField(source, 'match_id', 'matchId'),
    serverSeedHex: stringField(source, 'server_seed_hex', 'serverSeedHex') || hexField(source, 'server_seed', 'serverSeed'),
    endpoint: stringField(source, 'endpoint'),
    playerIds: stringArrayField(source, 'player_ids', 'playerIds'),
  };
}

/** `MatchResultMessage` payload → the client-facing result view. */
export function matchResultView(payload: unknown): MatchResultView {
  const source = isRecord(payload) ? payload : {};
  return {
    matchId: stringField(source, 'match_id', 'matchId'),
    winnerPlayerId: stringField(source, 'winner_player_id', 'winnerPlayerId'),
    points: numberRecordField(source, 'points'),
    replayId: stringField(source, 'replay_id', 'replayId'),
    serverAuthoritative: booleanField(source, 'server_authoritative', 'serverAuthoritative'),
    modeId: stringField(source, 'mode_id', 'modeId'),
    settledAtMs: numberField(source, 'settled_at_ms', 'settledAtMs'),
  };
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
