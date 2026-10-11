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

/**
 * Server error code for "the same account signed in on another device".
 *
 * Frozen contract shared with the lobby (`runtime/lobbyws`): the server drops
 * the older session, pushes an `Error` frame with exactly this code to the
 * superseded connection and then closes it.
 */
export const SESSION_REPLACED_CODE = 'session_replaced';

/**
 * Client-minted code for "the lobby no longer accepts our session".
 *
 * No server code maps onto this. When the superseded token is used over REST the
 * lobby answers a bare `401`/`unauthorized` — and a lobby restart or a token
 * that simply aged out produces the very same response, because
 * `userBySessionLocked` only knows that the token is not in its index. The cases
 * are indistinguishable on the wire, so the client must not claim the alarming
 * one: a player whose session merely expired would otherwise be told their
 * account had been signed in elsewhere, which reads as "you have been hacked".
 *
 * Both cases end the session and return to the login screen; only the wording
 * differs.
 */
export const SESSION_EXPIRED_CODE = 'session_expired';

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

/**
 * Answer to `auth.emailCode`: how long the mailed code stays valid, and how long
 * the same address must wait before another one can be requested. Both are
 * seconds and both come from the server, so the form's countdown matches the
 * server's own rate limit instead of guessing.
 */
export interface EmailCodeReceipt {
  email: string;
  expiresInSeconds: number;
  resendInSeconds: number;
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

// ---------------------------------------------------------------------------
// Check-in / shop / inventory views
//
// Field names mirror `docs/checkin_shop_contract.md` (check-in + shop) and the
// Gensoulkyo handlers `runtime/httpapi/handler.go` (inventory / decks / chests /
// activity). They are kept snake-agnostic here: the client exposes camelCase
// names while the payload accessors accept both spellings, same as the rest of
// this file.
// ---------------------------------------------------------------------------

/**
 * One day cell of the 7-day check-in cycle.
 *
 * `reward` is an open currency bag (`gold`, `ticket`, …); both it and the
 * wallet are `Record<string, number>` because the server decides the currency
 * set and the client only renders it.
 */
export interface CheckinDayView {
  /** 1..7 within the cycle. */
  day: number;
  reward: Record<string, number>;
  claimed: boolean;
  /** True for exactly one day: the next claimable day when today is unclaimed. */
  claimable: boolean;
}

/** `GET /v1/checkin`. */
export interface CheckinView {
  userId: string;
  /** Natural-month cycle id, `YYYY-MM`. */
  cycleId: string;
  days: CheckinDayView[];
  /** Consecutive check-in days; resets to 0 when a day is missed. */
  streak: number;
  /** 0 when everything in the cycle has been claimed. */
  nextClaimableDay: number;
  serverTimeMs: number;
}

/** `POST /v1/checkin/claim`. */
export interface CheckinClaimView {
  day: number;
  reward: Record<string, number>;
  wallet: Record<string, number>;
  streak: number;
  nextClaimableDay: number;
  serverTimeMs: number;
}

/** One shop listing. */
export interface ShopItemView {
  itemId: string;
  name: string;
  description: string;
  price: Record<string, number>;
  /** What a purchase grants, e.g. `{ item: 'stamina_potion', count: 1 }`. */
  grants: Record<string, unknown>;
  /** `-1` means unlimited stock. */
  stock: number;
  /** Purchases already made this cycle (for the limit display). */
  purchased: number;
  /** Stock > 0 and the wallet covers the price. */
  purchasable: boolean;
}

/** `GET /v1/shop`. */
export interface ShopView {
  /** Primary currency id the listings are priced in, e.g. `gold`. */
  currency: string;
  wallet: Record<string, number>;
  items: ShopItemView[];
  serverTimeMs: number;
}

/** `POST /v1/shop/purchase`. */
export interface ShopPurchaseView {
  itemId: string;
  count: number;
  spent: Record<string, number>;
  wallet: Record<string, number>;
  /** Full inventory level map after the purchase. */
  inventory: Record<string, number>;
  serverTimeMs: number;
}

/** One owned card stack (`CardInventoryEntry` in `runtime/core/types.go`). */
export interface InventoryEntryView {
  cardId: string;
  copies: number;
  level: number;
  firstObtainedAtMs: number;
}

/**
 * `GET /v1/inventory`.
 *
 * Shape follows the server's `core.InventorySnapshot`; extra fields are kept
 * verbatim in `raw` so a server-side schema extension cannot break the client.
 */
export interface InventoryView {
  userId: string;
  rulesetVersion: string;
  items: InventoryEntryView[];
  wallet: Record<string, number>;
  serverTimeMs: number;
  raw: Record<string, unknown>;
}

/** A chest pool available to open (`core.ChestPool`). */
export interface ChestPoolView {
  poolId: string;
  name: string;
  cost: Record<string, number>;
  enabled: boolean;
}

/**
 * `GET /v1/chests`.
 *
 * `ownedChests` maps pool id → owned count. The server also returns pity
 * counters and the opening log; those are left in `raw` since nothing in the
 * UI reads them yet.
 */
export interface ChestsView {
  userId: string;
  rulesetVersion: string;
  wallet: Record<string, number>;
  ownedChests: Record<string, number>;
  pools: ChestPoolView[];
  serverTimeMs: number;
  raw: Record<string, unknown>;
}

/** `POST /v1/chests/open` result. */
export interface ChestOpenResultView {
  poolId: string;
  count: number;
  wallet: Record<string, number>;
  ownedChests: Record<string, number>;
  /** Card rewards: `cardId` → copies granted. */
  results: Array<Record<string, unknown>>;
  serverTimeMs: number;
  raw: Record<string, unknown>;
}

/**
 * `GET /v1/decks` / `POST /v1/decks/save`.
 *
 * Kept as the server's `DeckRecord` shape; the UI currently only needs the
 * active deck id and the deck list.
 */
export interface DecksView {
  userId: string;
  activeDeckId: string;
  rulesetVersion: string;
  decks: Array<Record<string, unknown>>;
  serverTimeMs: number;
  raw: Record<string, unknown>;
}

/**
 * `POST /v1/activity/claim`.
 *
 * Shape follows the server's `core.ActivityClaimResult`. Kept as a loose
 * record because the activity centre is not wired to any UI yet.
 */
export interface ActivityClaimView {
  duplicate: boolean;
  reason: string;
  claimKind: string;
  claimId: string;
  userId: string;
  claimed: boolean;
  rewardStatus: string;
  settlementKey: string;
  raw: Record<string, unknown>;
}

export type LobbyEvent =
  | { kind: 'room_state'; room: RoomView }
  | {
      kind: 'match_start';
      matchId: string;
      serverSeedHex: string;
      endpoint: string;
      playerIds: string[];
      /**
       * This client's own roster id (`p-<hash>`) for the match, taken from the
       * signed battle ticket. The battle server only accepts `BattleInput`
       * payloads whose `player_id` is on its roster, and the roster uses
       * `player_id` values — never the lobby `user_id` — so this must be sent
       * verbatim. Empty when the lobby omitted the ticket.
       */
      playerId: string;
    }
  | { kind: 'match_result'; result: MatchResultView }
  | { kind: 'transport_closed'; reason: string }
  /**
   * The lobby ended this session because the account signed in elsewhere. The
   * server pushes this (an `Error` frame carrying {@link SESSION_REPLACED_CODE})
   * and then closes the connection, so the listener must drop the local session
   * and return to the login screen.
   */
  | { kind: 'session_replaced' }
  /**
   * The lobby stopped accepting our session without saying why: an
   * authenticated REST call came back `401` with no
   * {@link SESSION_REPLACED_CODE}. That is what an aged-out token, a restarted
   * lobby and a superseded token all look like, so it is reported as an expiry
   * rather than a takeover. Same recovery as {@link SESSION_REPLACED_CODE}.
   */
  | { kind: 'session_expired' };

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
    // Whether this request goes out authenticated. A `401` only means "session
    // lost" when we *were* authenticated — the login endpoints answer a wrong
    // password with the same status, and that must stay a plain failure.
    const hadSession = this.session !== null;
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
        const loss = sessionLossKind(response, hadSession);
        if (loss !== null) {
          // Symmetric with the WS push path: a REST call that used a token the
          // server has since dropped lands in the same handling. An explicit
          // `session_replaced` is trusted; a bare `401` is reported as an
          // expiry because the wire cannot separate an aged-out token from a
          // takeover.
          this.emit({ kind: loss });
        }
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

  /**
   * Maps an auth response payload onto `SessionState` and installs it as the
   * active session.
   *
   * Shared by every auth flow (`auth.anonymous`, `auth.register`,
   * `auth.login`) because they all answer with the same session envelope; the
   * only per-flow difference is the display name to fall back on. Returns `null`
   * (and sets `lastError`) when the payload is missing the session token or the
   * user id, so a malformed response can never half-authenticate the client.
   */
  private sessionFromPayload(
    payload: Record<string, unknown>,
    fallbackDisplayName: string,
  ): SessionState | null {
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
      displayName: stringField(payload, 'display_name', 'displayName') || fallbackDisplayName,
      characterId: stringField(payload, 'character_id', 'characterId'),
      rulesetVersion: stringField(payload, 'ruleset_version', 'rulesetVersion'),
      unlockedCharacterIds: stringArrayField(payload, 'unlocked_character_ids', 'unlockedCharacterIds'),
    };
    return this.session;
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
    return this.sessionFromPayload(response.payload, displayName);
  }

  /**
   * `auth.register` / `POST /v1/auth/register`.
   *
   * Creates an e-mail/password account and signs it in: the server returns a
   * session exactly like `auth.anonymous`, so the response mapping is shared.
   * `code` is the e-mail verification code the server mailed after
   * {@link requestEmailCode} — registration is refused without a valid one.
   * `displayName` defaults to the username when the caller leaves it empty.
   */
  async registerAccount(
    username: string,
    email: string,
    password: string,
    code: string,
    displayName = '',
  ): Promise<SessionState | null> {
    const user = username.trim();
    const address = email.trim();
    // Reject locally before spending a round-trip: the server would answer the
    // same way, but the form can react without waiting for the network.
    if (user === '') {
      this.lastError = 'account_username_required';
      return null;
    }
    if (address === '') {
      this.lastError = 'account_email_required';
      return null;
    }
    if (password === '') {
      this.lastError = 'account_password_required';
      return null;
    }
    if (code.trim() === '') {
      this.lastError = 'verification_code_required';
      return null;
    }
    const response = await this.call('auth.register', {
      username: user,
      email: address,
      password,
      code: code.trim(),
      display_name: displayName,
      platform: this.platform,
      client_build: this.clientBuild,
    });
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    return this.sessionFromPayload(response.payload, displayName || user);
  }

  /**
   * `auth.emailCode` / `POST /v1/auth/email/code`.
   *
   * Asks the lobby to mail a registration verification code to `email`. The
   * response carries the code's lifetime and the delay before the same address
   * may ask again, so the form can run its countdown without guessing.
   */
  async requestEmailCode(email: string): Promise<EmailCodeReceipt | null> {
    const address = email.trim();
    if (address === '') {
      this.lastError = 'account_email_required';
      return null;
    }
    const response = await this.call('auth.emailCode', { email: address });
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    return {
      email: stringField(payload, 'email') || address,
      expiresInSeconds: numberField(payload, 'expires_in_seconds', 'expiresInSeconds'),
      resendInSeconds: numberField(payload, 'resend_in_seconds', 'resendInSeconds'),
    };
  }

  /**
   * `auth.login` / `POST /v1/auth/login`.
   *
   * Verifies an existing account's password and issues a fresh session token.
   * The e-mail address is the sign-in identifier.
   */
  async loginAccount(email: string, password: string): Promise<SessionState | null> {
    const address = email.trim();
    if (address === '') {
      this.lastError = 'account_email_required';
      return null;
    }
    if (password === '') {
      this.lastError = 'account_password_required';
      return null;
    }
    const response = await this.call('auth.login', {
      email: address,
      password,
      platform: this.platform,
      client_build: this.clientBuild,
    });
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    return this.sessionFromPayload(response.payload, address);
  }

  /**
   * Local sign-out. There is no server round-trip: dropping the session token is
   * enough because every lobby call is authorised per-request. Clears the session
   * plus every piece of per-session state so a following sign-in starts clean.
   */
  logout(): void {
    this.session = null;
    this.room = null;
    this.allocation = null;
    this.ticket = null;
    this.matchmakingTicket = null;
    this.lastError = '';
    this.lastResponse = null;
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
   * `GET /v1/checkin` — the 7-day check-in cycle.
   *
   * The response carries its own `ok` flag but no envelope, so the raw payload
   * *is* the view. `days` may repeat; the array is taken verbatim in server
   * order (the server guarantees day 1..7).
   */
  async fetchCheckin(): Promise<CheckinView | null> {
    const response = await this.call('checkin.get');
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    return {
      userId: stringField(payload, 'user_id', 'userId'),
      cycleId: stringField(payload, 'cycle_id', 'cycleId'),
      days: Array.isArray(payload.days) ? payload.days.filter(isRecord).map((day) => checkinDayFromPayload(day)) : [],
      streak: numberField(payload, 'streak'),
      nextClaimableDay: numberField(payload, 'next_claimable_day', 'nextClaimableDay'),
      serverTimeMs: numberField(payload, 'server_time_ms', 'serverTimeMs'),
    };
  }

  /** `POST /v1/checkin/claim` — claim today's reward. */
  async claimCheckin(): Promise<CheckinClaimView | null> {
    const response = await this.call('checkin.claim');
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    return {
      day: numberField(payload, 'day'),
      reward: numberRecordField(payload, 'reward'),
      wallet: numberRecordField(payload, 'wallet'),
      streak: numberField(payload, 'streak'),
      nextClaimableDay: numberField(payload, 'next_claimable_day', 'nextClaimableDay'),
      serverTimeMs: numberField(payload, 'server_time_ms', 'serverTimeMs'),
    };
  }

  /** `GET /v1/shop` — the shop listings plus the current wallet. */
  async fetchShop(): Promise<ShopView | null> {
    const response = await this.call('shop.get');
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    return {
      currency: stringField(payload, 'currency') || 'gold',
      wallet: numberRecordField(payload, 'wallet'),
      items: Array.isArray(payload.items) ? payload.items.filter(isRecord).map((item) => shopItemFromPayload(item)) : [],
      serverTimeMs: numberField(payload, 'server_time_ms', 'serverTimeMs'),
    };
  }

  /** `POST /v1/shop/purchase` — buy `count` of an item. */
  async purchaseShopItem(itemId: string, count = 1): Promise<ShopPurchaseView | null> {
    if (itemId === '') {
      this.lastError = 'shop_purchase_missing_item';
      return null;
    }
    const response = await this.call('shop.purchase', { item_id: itemId, count });
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    return {
      itemId: stringField(payload, 'item_id', 'itemId') || itemId,
      count: numberField(payload, 'count') || count,
      spent: numberRecordField(payload, 'spent'),
      wallet: numberRecordField(payload, 'wallet'),
      inventory: numberRecordField(payload, 'inventory'),
      serverTimeMs: numberField(payload, 'server_time_ms', 'serverTimeMs'),
    };
  }

  /** `GET /v1/inventory` — owned card stacks (`core.InventorySnapshot`). */
  async fetchInventory(): Promise<InventoryView | null> {
    const response = await this.call('inventory.get');
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    return {
      userId: stringField(payload, 'user_id', 'userId'),
      rulesetVersion: stringField(payload, 'ruleset_version', 'rulesetVersion'),
      items: Array.isArray(payload.items)
        ? payload.items.filter(isRecord).map((item) => ({
            cardId: stringField(item, 'card_id', 'cardId'),
            copies: numberField(item, 'copies'),
            level: numberField(item, 'level'),
            firstObtainedAtMs: timeFieldMs(item, 'first_obtained_at', 'firstObtainedAt'),
          }))
        : [],
      wallet: numberRecordField(payload, 'wallet'),
      serverTimeMs: timeFieldMs(payload, 'server_time', 'serverTime'),
      raw: payload,
    };
  }

  /** `GET /v1/chests` — owned chests, pools and the wallet. */
  async fetchChests(): Promise<ChestsView | null> {
    const response = await this.call('chests.get');
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    return {
      userId: stringField(payload, 'user_id', 'userId'),
      rulesetVersion: stringField(payload, 'ruleset_version', 'rulesetVersion'),
      wallet: numberRecordField(payload, 'wallet'),
      ownedChests: numberRecordField(payload, 'owned_chests', 'ownedChests'),
      pools: Array.isArray(payload.pools)
        ? payload.pools.filter(isRecord).map((pool) => ({
            poolId: stringField(pool, 'pool_id', 'poolId'),
            name: stringField(pool, 'name'),
            cost: numberRecordField(pool, 'cost'),
            enabled: booleanField(pool, 'enabled'),
          }))
        : [],
      serverTimeMs: timeFieldMs(payload, 'server_time', 'serverTime'),
      raw: payload,
    };
  }

  /**
   * `POST /v1/chests/open` — open `count` of a pool.
   *
   * The server owns the roll: the client only sends `pool_id` and `count` and
   * projects the returned rewards.
   */
  async openChest(poolId: string, count = 1): Promise<ChestOpenResultView | null> {
    if (poolId === '') {
      this.lastError = 'chest_open_missing_pool';
      return null;
    }
    const response = await this.call('chests.open', { pool_id: poolId, count });
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    return {
      poolId: stringField(payload, 'pool_id', 'poolId') || poolId,
      count: numberField(payload, 'count') || count,
      wallet: numberRecordField(payload, 'wallet'),
      ownedChests: numberRecordField(payload, 'owned_chests', 'ownedChests'),
      results: Array.isArray(payload.results) ? payload.results.filter(isRecord) : [],
      serverTimeMs: timeFieldMs(payload, 'server_time', 'serverTime'),
      raw: payload,
    };
  }

  /** `GET /v1/decks` — saved decks and the active deck id. */
  async fetchDecks(): Promise<DecksView | null> {
    const response = await this.call('decks.list');
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    return {
      userId: stringField(payload, 'user_id', 'userId'),
      activeDeckId: stringField(payload, 'active_deck_id', 'activeDeckId'),
      rulesetVersion: stringField(payload, 'ruleset_version', 'rulesetVersion'),
      decks: Array.isArray(payload.decks) ? payload.decks.filter(isRecord) : [],
      serverTimeMs: timeFieldMs(payload, 'server_time', 'serverTime'),
      raw: payload,
    };
  }

  /** `POST /v1/decks/save` — create or update a deck. */
  async saveDeck(deck: {
    deckId?: string;
    deck_id?: string;
    name?: string;
    format?: string;
    cardIds?: string[];
    card_ids?: string[];
    active?: boolean;
  }): Promise<DecksView | null> {
    const response = await this.call('decks.save', {
      deck_id: deck.deckId ?? deck.deck_id ?? '',
      name: deck.name ?? '',
      format: deck.format ?? '',
      card_ids: deck.cardIds ?? deck.card_ids ?? [],
      active: deck.active ?? false,
    });
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    // `SaveDeckResponse` has no deck *list*, so refresh it explicitly; the save
    // response only confirms the one deck plus the new active id.
    const refreshed = await this.fetchDecks();
    return refreshed;
  }

  /**
   * `POST /v1/activity/claim` — claim an activity-centre reward.
   *
   * The server answers `{ ok: false, error_code: 'already_claimed' }` for a
   * duplicate, so a claimed reward and a rejection are distinguishable through
   * `lastError`.
   */
  async claimActivity(activityId: string): Promise<ActivityClaimView | null> {
    if (activityId === '') {
      this.lastError = 'activity_claim_missing_id';
      return null;
    }
    const response = await this.call('activity.claim', { claim_kind: 'activity', claim_id: activityId });
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    return {
      duplicate: booleanField(payload, 'duplicate'),
      reason: stringField(payload, 'reason'),
      claimKind: stringField(payload, 'claim_kind', 'claimKind'),
      claimId: stringField(payload, 'claim_id', 'claimId'),
      userId: stringField(payload, 'user_id', 'userId'),
      claimed: booleanField(payload, 'claimed'),
      rewardStatus: stringField(payload, 'reward_status', 'rewardStatus'),
      settlementKey: stringField(payload, 'settlement_key', 'settlementKey'),
      raw: payload,
    };
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
    playerId?: string;
    player_id?: string;
    signed_battle_ticket?: unknown;
    signedBattleTicket?: unknown;
  }): boolean {
    const matchId = message.matchId ?? message.match_id ?? '';
    if (matchId === '') {
      this.lastError = 'match_start_missing_match_id';
      return false;
    }
    const seedHex = message.serverSeedHex ?? bytesToHex(message.serverSeed ?? message.server_seed ?? new Uint8Array(0));
    const endpoint = message.endpoint ?? '';
    const playerIds = message.playerIds ?? message.player_ids ?? [];
    const playerId =
      message.playerId ??
      message.player_id ??
      localPlayerIdFromMatchStart(message as Record<string, unknown>);
    this.matchmakingTicket = null;
    this.emit({ kind: 'match_start', matchId, serverSeedHex: seedHex, endpoint, playerIds, playerId });
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

/**
 * Classifies a failed response as a lost session, or `null` for an ordinary
 * failure.
 *
 * An explicit {@link SESSION_REPLACED_CODE} is authoritative on any transport:
 * the lobby only ever emits it when it really did supersede the session. A bare
 * `401` is only a session loss when the request carried a session — the login
 * endpoints answer bad credentials with `401` too, and that must not be mistaken
 * for a lost session — and even then it cannot be attributed to a takeover,
 * because a superseded token, an expired token and a restarted lobby all answer
 * `401`/`unauthorized`.
 */
function sessionLossKind(
  response: LobbyRpcResponse,
  hadSession: boolean,
): 'session_replaced' | 'session_expired' | null {
  if (response.error_code === SESSION_REPLACED_CODE) {
    return 'session_replaced';
  }
  if (response.status === 401 && hadSession) {
    return 'session_expired';
  }
  return null;
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
    // The session is established at runtime (`auth.anonymous`), so the token is
    // only known after the first call. `LobbyClient` stamps every request with
    // the current `session_id`, so prefer it over the (usually empty) bearer the
    // transport was constructed with — REST routes authenticate through the
    // `Authorization: Bearer` header and otherwise fail with
    // `unauthorized: missing session token`.
    const bearer = request.session_id ?? this.bearer;
    if (bearer !== undefined && bearer !== '') {
      headers.Authorization = `Bearer ${bearer}`;
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
  'auth.register': { method: 'POST', path: () => '/v1/auth/register' },
  'auth.login': { method: 'POST', path: () => '/v1/auth/login' },
  'auth.logout': { method: 'POST', path: () => '/v1/auth/logout' },
  'auth.emailCode': { method: 'POST', path: () => '/v1/auth/email/code' },
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
  // The battle allocation/ticket live under `/v1/matches/{id}/...` in
  // `runtime/httpapi/handler.go` — there is no `/v1/battles/...` namespace, and
  // `battle-ticket` is a POST. The older `/v1/battles/...` paths silently 404'd
  // with `not_found: route not found`.
  'battle.allocation': {
    method: 'GET',
    path: (r) => `/v1/matches/${payloadString(r, 'match_id', 'matchId')}/battle-allocation`,
  },
  'battle.ticket': {
    method: 'POST',
    path: (r) => `/v1/matches/${payloadString(r, 'match_id', 'matchId')}/battle-ticket`,
  },
  'replay.get': { method: 'GET', path: (r) => `/v1/replays/${payloadString(r, 'replay_id', 'replayId')}` },
  // --- check-in / shop / inventory ---
  'checkin.get': { method: 'GET', path: () => '/v1/checkin' },
  'checkin.claim': { method: 'POST', path: () => '/v1/checkin/claim' },
  'shop.get': { method: 'GET', path: () => '/v1/shop' },
  'shop.purchase': { method: 'POST', path: () => '/v1/shop/purchase' },
  'inventory.get': { method: 'GET', path: () => '/v1/inventory' },
  'chests.get': { method: 'GET', path: () => '/v1/chests' },
  'chests.open': { method: 'POST', path: () => '/v1/chests/open' },
  'decks.list': { method: 'GET', path: () => '/v1/decks' },
  'decks.save': { method: 'POST', path: () => '/v1/decks/save' },
  'activity.claim': { method: 'POST', path: () => '/v1/activity/claim' },
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
  /**
   * Builds a **fresh**, already-connecting socket so the transport can recover
   * from a server/network drop. `Laya.Socket` cannot be revived once closed, so
   * a real reconnect means a brand-new socket. When omitted the transport keeps
   * its single-shot behaviour: a dropped connection is never retried.
   */
  reconnect?: () => SocketLike;
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
  private readonly reconnect: (() => SocketLike) | null;
  private sequence = 0;
  /** Set when the connection is known to be down (server close / network drop). */
  private closed = false;
  /**
   * Set by `close()`: an application-initiated shutdown is final. A disposed
   * transport never reconnects, so signing out (or tearing the app down) cannot
   * resurrect a dead lobby channel.
   */
  private disposed = false;
  /** Resolver for the in-flight `reconnectSocket()`, cleared on open/error/close. */
  private openResolver: ((ok: boolean) => void) | null = null;
  /**
   * The in-flight reconnect, shared by concurrent callers so two `call()`s that
   * race a drop do not each build a socket (which would overwrite the first
   * attempt's resolver and hang it).
   */
  private reconnectPromise: Promise<boolean> | null = null;

  constructor(private socket: SocketLike, config: WsLobbyTransportConfig = {}) {
    this.logger = config.logger ?? nullLogger;
    this.version = config.version ?? DEFAULT_VERSION_STAMP;
    this.platform = config.platform ?? 'web';
    this.clientBuild = config.clientBuild ?? '0.1.0-draft';
    this.fallback = config.fallback ?? null;
    this.userId = config.userId ?? '';
    this.reconnect = config.reconnect ?? null;
    if (config.onEvent !== undefined) {
      this.listeners.push(config.onEvent);
    }
    this.bindSocket(socket);
  }

  /**
   * Wires the transport's handlers onto `socket`. Called once at construction
   * and again for every reconnected socket, so a fresh socket behaves exactly
   * like the original (same message routing, same close/error handling).
   */
  private bindSocket(socket: SocketLike): void {
    this.socket = socket;
    socket.setHandlers({
      onOpen: () => this.handleOpen(),
      onMessage: (data) => this.handleMessage(data),
      onClose: (code, reason) => this.handleClose(code, reason),
      onError: (error) => this.handleError(error),
    });
  }

  private handleOpen(): void {
    if (!this.disposed) {
      this.closed = false;
    }
    const resolve = this.openResolver;
    this.openResolver = null;
    resolve?.(true);
  }

  private handleError(error: Error): void {
    this.logger.error(`lobby ws error: ${error.message}`);
    // A socket that errors before opening fails the pending reconnect attempt.
    const resolve = this.openResolver;
    this.openResolver = null;
    resolve?.(false);
  }

  /**
   * Builds a fresh socket through the configured factory and waits for it to
   * open. Resolves `true` once connected, `false` if it errors or closes first
   * (or no factory is configured). No timers: open/error/close are enough.
   */
  private reconnectSocket(): Promise<boolean> {
    if (this.reconnect === null || this.disposed) {
      return Promise.resolve(false);
    }
    if (this.reconnectPromise !== null) {
      return this.reconnectPromise;
    }
    const factory = this.reconnect;
    const attempt = new Promise<boolean>((resolve) => {
      let socket: SocketLike;
      try {
        socket = factory();
      } catch (error) {
        this.logger.error(`lobby ws reconnect failed: ${error instanceof Error ? error.message : String(error)}`);
        resolve(false);
        return;
      }
      this.openResolver = resolve;
      this.bindSocket(socket);
    });
    this.reconnectPromise = attempt;
    void attempt.then(() => {
      if (this.reconnectPromise === attempt) {
        this.reconnectPromise = null;
      }
    });
    return attempt;
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

  async call(request: LobbyRpcRequest): Promise<LobbyRpcResponse> {
    const route = LOBBY_WS_ROUTES[request.id];
    if (route === undefined) {
      if (this.fallback !== null) {
        return this.fallback.call(request);
      }
      return { ok: false, status: 0, error_code: `lobby_ws_unsupported_op:${request.id}` };
    }
    if (this.disposed) {
      // `close()` was called: the channel is intentionally shut and stays shut.
      return { ok: false, status: 0, error_code: 'lobby_ws_not_connected' };
    }
    if (this.closed || !this.socket.connected) {
      // The connection dropped (server close / network). Try exactly one fresh
      // socket before giving up — no retry loop.
      const recovered = await this.reconnectSocket();
      if (!recovered) {
        return { ok: false, status: 0, error_code: 'lobby_ws_not_connected' };
      }
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
    this.disposed = true;
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
        // A proactive push (no call in flight) would otherwise be swallowed:
        // surface it so a listener can react. `session_replaced` is the only
        // one the app acts on today.
        this.logger.warn(`lobby ws error: ${status.code} ${status.message}`);
      }
      if (status.code === SESSION_REPLACED_CODE) {
        this.emit({ kind: 'session_replaced' });
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
    // A socket that closes before opening fails the pending reconnect attempt.
    const resolve = this.openResolver;
    this.openResolver = null;
    resolve?.(false);
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

/** One check-in day cell; `reward` is an open currency bag. */
function checkinDayFromPayload(payload: Record<string, unknown>): CheckinDayView {
  return {
    day: numberField(payload, 'day'),
    reward: numberRecordField(payload, 'reward'),
    claimed: booleanField(payload, 'claimed'),
    claimable: booleanField(payload, 'claimable'),
  };
}

/** One shop listing. */
function shopItemFromPayload(payload: Record<string, unknown>): ShopItemView {
  return {
    itemId: stringField(payload, 'item_id', 'itemId'),
    name: stringField(payload, 'name'),
    description: stringField(payload, 'description'),
    price: numberRecordField(payload, 'price'),
    grants: isRecord(payload.grants) ? payload.grants : {},
    stock: numberField(payload, 'stock'),
    purchased: numberField(payload, 'purchased'),
    purchasable: booleanField(payload, 'purchasable'),
  };
}

/**
 * Reads a Go `time.Time` JSON field as epoch milliseconds. Accepts either a
 * pre-computed `*_ms` number or an RFC3339 string; returns 0 when absent or
 * unparseable so callers can treat "unknown" uniformly.
 */
function timeFieldMs(source: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string' && value !== '') {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }
  return 0;
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
    playerId: localPlayerIdFromMatchStart(source),
  };
}

/**
 * Extracts this client's own roster id from a `MatchStartMessage`.
 *
 * The lobby attaches the signed battle ticket it minted for *this* connection,
 * so `signed_battle_ticket.ticket.player_id` is authoritative. There is no other
 * field on the message that maps the lobby `user_id` to the battle roster id.
 */
function localPlayerIdFromMatchStart(source: Record<string, unknown>): string {
  const signed = isRecord(source.signed_battle_ticket)
    ? source.signed_battle_ticket
    : isRecord(source.signedBattleTicket)
      ? source.signedBattleTicket
      : null;
  if (signed === null) {
    return '';
  }
  const ticket = isRecord(signed.ticket) ? signed.ticket : null;
  return ticket === null ? '' : stringField(ticket, 'player_id', 'playerId');
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

function decodeUtf8Loose(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}
