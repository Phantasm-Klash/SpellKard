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
import { matchEventViewFromPayload, type MatchEventView } from '../game/battle_events';
import { sha256Bytes } from '../math/lobby_rng';

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
  device_id?: string;
  display_name?: string;
  payload?: Record<string, unknown>;
}

export interface LobbyTransport {
  call(request: LobbyRpcRequest): Promise<LobbyRpcResponse>;
  close(): void;
  /** Synchronizes an already-authenticated session with transports that use headers. */
  setSessionToken?(token: string): void;
}

export interface HttpResponseLike {
  status: number;
  body: unknown;
}

/** Raw-bytes response for the binary endpoints (the `.dem` download). */
export interface BinaryHttpResponseLike {
  status: number;
  bytes: Uint8Array;
}

export interface HttpClient {
  request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<HttpResponseLike>;
  /**
   * Optional raw-bytes GET. Implemented by the Laya/browser adapters to fetch
   * `GET /v1/replays/{id}/dem` (octet-stream) without mangling binary through a
   * JSON/text path. Absent on transports that cannot serve binary.
   */
  requestBytes?(
    method: 'GET',
    path: string,
    headers?: Record<string, string>,
  ): Promise<BinaryHttpResponseLike>;
}

export interface LobbyClientConfig {
  transport: LobbyTransport;
  logger?: Logger;
  clientBuild?: string;
  platform?: string;
  deviceId?: string;
  /**
   * Host-owned session storage. Implementations should use platform-secure
   * storage; the client never serializes request sequence or business state.
   */
  sessionStore?: LobbySessionStore;
  /**
   * Dedicated REST transport for the operations that are forbidden on the
   * lobby's other transports — today `match.events` / `match.snapshot`, which
   * answer `403 client_operation_disallowed` to a client session on the Nakama
   * RPC path (`runtime/nakamaapi`'s forbidden-op list). Falls back to
   * `transport` when omitted: correct for REST and WS-fallback deployments,
   * silently broken for Nakama RPC.
   */
  restTransport?: LobbyTransport;
  /**
   * Plain HTTP client for binary endpoints (the `.dem` replay download). The
   * transport layer is JSON-only, so the dem bytes are fetched through this
   * directly when present.
   */
  http?: HttpClient;
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

/**
 * Host-owned session storage. Implementations back this with platform-secure
 * storage; the client persists the session so a relaunch can resume it without
 * re-authenticating.
 */
export interface LobbySessionStore {
  load(): SessionState | null;
  save(session: SessionState): void;
  clear(): void;
}

export interface RoomPlayerView {
  userId: string;
  playerId: string;
  displayName: string;
  ready: boolean;
  host: boolean;
  connected: boolean;
  characterId: string;
  /** 自机 shot 名（如 "ReimuA1"）；空 = 默认自机（复现现状）。 */
  shotType: string;
  /** 自机 bomb 名（如 "Reimu"）；空 = 默认自机。 */
  bombType: string;
}

export interface RoomView {
  roomCode: string;
  hostUserId: string;
  modeId: string;
  allReady: boolean;
  rulesetVersion: string;
  players: RoomPlayerView[];
  /** 房间级 boss 选择（`tian`/`hui`）；空 = 默认 timeline。仅房主可设。 */
  bossId: string;
  /** 房间舞台 id（自机/关卡选择的一部分）。 */
  stageId: string;
  /** 合作人数（coop_boss 房主选项：2/4；其他模式 undefined）。 */
  coopPlayers?: number;
}

/** `rooms.create` 的可选房间配置（boss + 自机 loadout）。 */
export interface RoomCreateOptions {
  /** 房间 boss（仅房主可设）。空 = 不指定。 */
  bossId?: string;
  /** 合作人数（coop_boss 房主可设：2/4；服务端缺省 2）。 */
  coopPlayers?: number;
  stageId?: string;
  characterId?: string;
  shotType?: string;
  bombType?: string;
}

/** `rooms.join` 的可选自机 loadout（guest 不能改 boss）。 */
export interface RoomJoinOptions {
  stageId?: string;
  characterId?: string;
  shotType?: string;
  bombType?: string;
}

/** 把房间选项编成服务端 `mode_params`（snake_case，字符串值；空值省略）。 */
function roomModeParams(options: RoomCreateOptions | RoomJoinOptions | undefined): Record<string, string> {
  const params: Record<string, string> = {};
  if (options === undefined) {
    return params;
  }
  const fields: Array<[string, string | undefined]> = [
    ['stage_id', options.stageId],
    ['character_id', options.characterId],
    ['shot_type', options.shotType],
    ['bomb_type', options.bombType],
    ['coop_players', 'coopPlayers' in options && options.coopPlayers !== undefined ? String(options.coopPlayers) : undefined],
  ];
  for (const [key, value] of fields) {
    if (value !== undefined && value !== '') {
      params[key] = value;
    }
  }
  return params;
}

/** 从房间载荷的 `mode_params.coop_players` 读出合作人数（无/非法 = undefined）。 */
function coopPlayersFromRoomPayload(payload: Record<string, unknown>): number | undefined {
  const params = stringRecordField(payload, 'mode_params', 'modeParams');
  const raw = params['coop_players'];
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
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
  /**
   * W-1 opening loadout decoded from the same signed ticket: the hand the lobby
   * dealt, the opening energy and the authoritative lobby seed as decimal text.
   * `null` when the payload carries no hand at all (an older server).
   */
  opening?: BattleOpeningState | null;
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
  serverAuthoritative: boolean;
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

/** One gacha pool (`core.GachaPool` in `runtime/core/gacha.go`). */
export interface GachaPoolView {
  poolId: string;
  /** `card` (draws from the 20-card catalog) or `character` (52 player shots). */
  kind: string;
  name: string;
  nameKey: string;
  costGems: number;
  costTenGems: number;
  weights: Record<string, number>;
  pity: { rareEvery: number; epicEvery: number };
  featured: string[];
  enabled: boolean;
}

/** One unlocked shot (`core.CharacterOwnership`). */
export interface CharacterOwnershipView {
  shotId: string;
  chara: string;
  /** `default` | `gacha` | `faith_exchange`. */
  source: string;
  dupes: number;
  obtainedAtMs: number;
}

/** `core.CharacterRosterSnapshot`. */
export interface CharacterRosterView {
  userId: string;
  shots: CharacterOwnershipView[];
  bombs: string[];
  faith: number;
  pityCounters: Record<string, { rareCounter: number; epicCounter: number }>;
  lockedShotIds: string[];
  exchangeCostFaith: number;
  serverAuthoritative: boolean;
  serverTimeMs: number;
}

/** `GET /v1/gacha/pools` (`core.GachaPoolsResponse`). */
export interface GachaPoolsView {
  pools: GachaPoolView[];
  wallet: Record<string, number>;
  faith: number;
  pityCounters: Record<string, { rareCounter: number; epicCounter: number }>;
  serverTimeMs: number;
  raw: Record<string, unknown>;
}

/** One draw inside a pull response (`core.GachaPullResult`). */
export interface GachaPullResultView {
  id: string;
  kind: string;
  cardId: string;
  shotId: string;
  chara: string;
  nameKey: string;
  rarity: string;
  isNew: boolean;
  dust: number;
  faithGained: number;
}

/** `POST /v1/gacha/pull` (`core.GachaPullResponse`). */
export interface GachaPullView {
  poolId: string;
  count: number;
  results: GachaPullResultView[];
  wallet: Record<string, number>;
  faith: number;
  characters: CharacterRosterView;
  serverTimeMs: number;
  raw: Record<string, unknown>;
}

/** `POST /v1/gacha/faith-exchange` (`core.FaithExchangeResponse`). */
export interface FaithExchangeView {
  itemId: string;
  faith: number;
  faithSpent: number;
  characters: CharacterRosterView;
  wallet: Record<string, number>;
  serverTimeMs: number;
  raw: Record<string, unknown>;
}

export interface DeckRecordView {
  deckId: string;
  name: string;
  format: string;
  rulesetVersion: string;
  cardIds: string[];
  active: boolean;
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
  decks: DeckRecordView[];
  serverAuthoritative: boolean;
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

// ---------------------------------------------------------------------------
// Card effects + personal records
//
// Field names mirror `card_records_spec.md` §1.3 (card snapshots) and §2.3
// (`RecordsView`). The client exposes camelCase names while the payload
// accessors accept both spellings, same as the rest of this file.
// ---------------------------------------------------------------------------

/**
 * One live card effect on the field, mirroring the lobby's `ActiveCardSnapshot`.
 *
 * The wire carries the effect's window as two absolute ticks (`started_tick` /
 * `expires_tick`) rather than a remaining/duration pair, so those are what this
 * mirrors. Derive the rest with {@link activeCardDurationTicks} and
 * {@link activeCardRemainingTicks} — the latter needs "now", which a payload
 * parser cannot know.
 *
 * The four extra fields are optional and only meaningful for their own effect:
 * `patternId` for `opponent_pattern`, `purgeRadius`/`purgeCount` for
 * `bullet_purge`, and `targetUserId` for an effect aimed at another player.
 */
export interface ActiveCardSnapshot {
  cardId: string;
  effectKind: string;
  /** Server tick the effect was activated on. */
  startedTick: number;
  /** Server tick the effect expires on. */
  expiresTick: number;
  /** Curtain pattern id (`opponent_pattern`). */
  patternId?: string;
  /** Clear radius in playfield pixels (`bullet_purge`). */
  purgeRadius?: number;
  /** Bullets removed by the purge (`bullet_purge`). */
  purgeCount?: number;
  /** The player an effect is aimed at (`opponent_pattern`). */
  targetUserId?: string;
}

/**
 * `GET /v1/matches/{id}/events` — one page of the match-event stream.
 *
 * ★ Fetch this through a REST transport ({@link LobbyClientConfig.restTransport}
 * → {@link LobbyClient.fetchMatchEvents}): `match.events` is a forbidden op on
 * the Nakama RPC path (`403 client_operation_disallowed` for client sessions),
 * so a `nakama_rpc` deployment would silently starve every event consumer.
 */
export interface MatchEventsView {
  events: MatchEventView[];
  /** Cursor to resume from (seq of the last event in the page). */
  cursor: number;
  /** True while the server still holds events past `cursor`. */
  hasMore: boolean;
  /**
   * Oldest seq the server still retains (`oldest_cursor`).
   *
   * A caller that fetched with `after < oldestCursor` has missed events the
   * server has since dropped; `BattleEventPoller` compares the two to raise
   * `onGap` (and the app rebuilds from `match.snapshot`). Defaults to `0` when
   * the server omits the field, which can only *suppress* a gap — never invent
   * one — so a deployment that does not report it keeps the previous
   * behaviour instead of firing spurious snapshot rebuilds.
   */
  oldestCursor: number;
  /** Newest seq the server has produced (`latest_cursor`), when reported. */
  latestCursor?: number;
  /** Server tick the page was built at (`snapshot_tick`), when reported. */
  snapshotTick?: number;
}

/**
 * `GET /v1/matches/{id}/snapshot` — what the battle scene needs to enter a
 * match: the stage, the local player's character and the live card effects.
 * REST-only for the same forbidden-op reason as {@link MatchEventsView}.
 */
export interface MatchSnapshotView {
  matchId: string;
  stageId: string;
  /** The local player's `character_id`, from their in-match loadout. */
  characterId: string;
  activeCards: ActiveCardSnapshot[];
  /**
   * The local player's connection state, when the lobby reports it. Absent
   * means "the server did not say", which the caller must not read as
   * "connected" — hence optional rather than defaulted.
   */
  localConnected?: boolean;
}

/** One finished match, mirroring the lobby's `MatchHistoryEntry`. */
export interface MatchHistoryEntryView {
  matchId: string;
  modeId: string;
  stageId: string;
  /** `win` | `loss` | `draw`. */
  result: string;
  score: number;
  rankDelta: number;
  opponentId: string;
  grazeCount: number;
  hitCount: number;
  damageDealt: number;
  cardPlays: number;
  durationTicks: number;
  endedAtMs: number;
  /** Whether a downloadable `.dem` replay exists for this match (thread B). */
  hasDem: boolean;
  /** `.dem` container size in bytes (0 when absent). */
  demSize: number;
}

/**
 * `GET /v1/records` — the player's personal record dashboard, mirroring the
 * lobby's `RecordsView`. `recent` is newest-first and capped at 20 server-side.
 */
export interface RecordsView {
  ok: boolean;
  userId: string;
  displayName: string;
  gold: number;
  tickets: number;
  /** Ranked points, i.e. `Certification.RankScore`. */
  points: number;
  ratingCode: string;
  seasonId: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  bestScore: number;
  averageScore: number;
  totalGraze: number;
  totalHits: number;
  totalDamageDealt: number;
  totalCardPlays: number;
  deckCount: number;
  cardCount: number;
  recent: MatchHistoryEntryView[];
  serverTimeMs: number;
  serverAuthoritative: boolean;
  clientResultAuthoritative: boolean;
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
  private readonly restTransport: LobbyTransport | null;
  private readonly http: HttpClient | null;
  private readonly logger: Logger;
  private readonly clientBuild: string;
  private readonly platform: string;
  private readonly deviceId: string;
  private readonly sessionStore?: LobbySessionStore;
  private readonly listeners: LobbyEventListener[] = [];
  private sequence = 0;
  /** The Nakama account session behind `session`, when Nakama auth is in use. */
  private nakamaAccount: NakamaAccountSession | null = null;
  /** The credential of the current Nakama session, kept so it can be replayed. */
  private nakamaCredential: NakamaAuthRequest | null = null;
  private generatedDeviceId = '';

  session: SessionState | null = null;
  room: RoomView | null = null;
  allocation: BattleAllocationView | null = null;
  ticket: BattleTicketView | null = null;
  matchmakingTicket: MatchmakingTicketView | null = null;
  lastError = '';
  lastResponse: LobbyRpcResponse | null = null;

  constructor(config: LobbyClientConfig) {
    this.transport = config.transport;
    this.restTransport = config.restTransport ?? null;
    this.http = config.http ?? null;
    this.logger = config.logger ?? nullLogger;
    this.clientBuild = config.clientBuild ?? '0.1.0-draft';
    this.platform = config.platform ?? 'web';
    this.deviceId = config.deviceId ?? '';
    this.sessionStore = config.sessionStore;
    this.session = this.restoreSession();
    if (this.session !== null) {
      this.setTransportSessionToken(this.session.sessionToken);
    }
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

  /** Clears local session and all server-derived lobby state. */
  clearSession(): void {
    this.session = null;
    this.room = null;
    this.allocation = null;
    this.ticket = null;
    this.matchmakingTicket = null;
    this.sequence = 0;
    this.lastResponse = null;
    this.setTransportSessionToken('');
    try {
      this.sessionStore?.clear();
    } catch {
      // A storage failure must not leave an in-memory bearer active.
    }
  }

  private nextCid(): string {
    this.sequence += 1;
    return `c${this.sequence}`;
  }

  private async call(
    id: string,
    payload: Record<string, unknown> = {},
  ): Promise<LobbyRpcResponse> {
    return this.callOn(this.transport, this.buildRequest(id, payload));
  }

  /**
   * Builds the stamped request shared by every op on every transport: the
   * client-minted `cid`, the device id and — for authenticated ops — the
   * session envelope fields the server correlates and authorizes on.
   */
  private buildRequest(id: string, payload: Record<string, unknown> = {}): LobbyRpcRequest {
    const request: LobbyRpcRequest = {
      id,
      cid: this.nextCid(),
      payload,
    };
    if (this.deviceId !== '') {
      request.device_id = this.deviceId;
    }
    if (this.session !== null && id !== 'auth.anonymous') {
      request.session_id = this.session.sessionToken;
      request.user_id = this.session.userId;
    }
    return request;
  }

  /**
   * Runs an already-stamped request on an explicit transport, with exactly
   * {@link call}'s behaviour (bookkeeping, session-loss detection, non-throwing
   * failure). The split exists for the handful of operations that must NOT
   * use the main transport — see {@link LobbyClientConfig.restTransport} and
   * the warnings on {@link LobbyClient.fetchMatchEvents} / the snapshot fetch.
   */
  private async callOn(
    transport: LobbyTransport,
    request: LobbyRpcRequest,
    allowNakamaRetry = true,
  ): Promise<LobbyRpcResponse> {
    const id = request.id;
    // Whether this request goes out authenticated. A `401` only means "session
    // lost" when we *were* authenticated — the login endpoints answer a wrong
    // password with the same status, and that must stay a plain failure.
    const hadSession = this.session !== null;
    try {
      let response = await transport.call(request);
      // Nakama: an expired JWT, or an envelope `seq` the lobby guard no
      // longer shares, is recoverable by re-authenticating the same
      // identity — the fresh session id is a fresh `seq` bucket server-side.
      if (allowNakamaRetry && !response.ok && nakamaRecoverable(response)) {
        if (await this.recoverNakamaSession()) {
          response = await this.callOn(transport, { ...request, cid: this.nextCid() }, false);
          this.lastResponse = response;
          this.lastError = response.ok ? '' : (response.error_code ?? `lobby_call_failed:${id}`);
          return response;
        }
      }
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
    this.setTransportSessionToken(token);
    this.persistSession();
    return this.session;
  }

  /**
   * Nakama-native sign-in.
   *
   * The lobby's Nakama plugin derives the business identity from the Nakama
   * session in the request context (`LoginExternal`), so there is no
   * `auth.*` round-trip here: authenticating against Nakama's own account
   * API both opens the account and yields the only credential the RPC
   * gateway accepts. `bootstrap` (which `LobbyFlow` runs next) fills in the
   * profile fields the account API does not carry.
   */
  private nakamaTransport(): NakamaAccountTransport | null {
    return isNakamaAccountTransport(this.transport) ? this.transport : null;
  }

  /** The Nakama account session behind the current lobby session, if any. */
  nakamaSession(): NakamaAccountSession | null {
    return this.nakamaAccount;
  }

  private async authenticateNakama(
    request: NakamaAuthRequest,
  ): Promise<NakamaAccountSession | null> {
    const transport = this.nakamaTransport();
    if (transport === null) {
      return null;
    }
    let account: NakamaAccountSession | null;
    try {
      account = await transport.authenticateAccount(request);
    } catch (error) {
      this.lastError = 'nakama_authenticate_failed';
      this.logger.error(`nakama ${request.kind} authenticate threw: ${String(error)}`);
      return null;
    }
    if (account === null) {
      return null;
    }
    this.nakamaAccount = account;
    this.nakamaCredential = request;
    return account;
  }

  private sessionFromNakamaAccount(
    account: NakamaAccountSession,
    fallbackDisplayName: string,
  ): SessionState {
    this.session = {
      sessionToken: account.token,
      userId: account.userId,
      playerId: '',
      displayName: account.username !== '' ? account.username : fallbackDisplayName,
      characterId: '',
      rulesetVersion: '',
      unlockedCharacterIds: [],
    };
    this.setTransportSessionToken(account.token);
    this.persistSession();
    return this.session;
  }

  /** Re-authenticates the stored Nakama identity, refreshing `sessionToken`. */
  private async recoverNakamaSession(): Promise<boolean> {
    const credential = this.nakamaCredential;
    if (credential === null || this.nakamaTransport() === null) {
      return false;
    }
    const account = await this.authenticateNakama(credential);
    if (account === null) {
      return false;
    }
    if (this.session !== null) {
      const next = cloneSession(this.session);
      next.sessionToken = account.token;
      next.userId = account.userId;
      this.session = next;
      this.setTransportSessionToken(account.token);
      this.persistSession();
    }
    return true;
  }

  /** Sign-in identity for device authentication, generated when the host omits one. */
  private resolvedDeviceId(): string {
    if (this.deviceId !== '') {
      return this.deviceId;
    }
    if (this.generatedDeviceId === '') {
      this.generatedDeviceId = `dev-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    }
    return this.generatedDeviceId;
  }

  /**
   * `auth.anonymous` / `POST /v1/auth/anonymous` on the legacy transports,
   * Nakama `/v2/account/authenticate/device` on the Nakama transport.
   */
  async loginAnonymous(displayName = 'Player'): Promise<SessionState | null> {
    // Explicit re-authentication must not reuse a stale restored identity.
    this.clearSession();
    if (this.nakamaTransport() !== null) {
      const account = await this.authenticateNakama({
        kind: 'device',
        id: this.resolvedDeviceId(),
        username: displayName,
      });
      if (account === null) {
        this.lastError = 'nakama_authenticate_failed';
        return null;
      }
      return this.sessionFromNakamaAccount(account, displayName);
    }
    const response = await this.call('auth.anonymous', {
      device_id: this.deviceId,
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
    if (this.nakamaTransport() !== null) {
      // Nakama's native e-mail authentication has no mailed verification
      // step, so `code` cannot be honoured on this path.
      const account = await this.authenticateNakama({
        kind: 'email',
        email: address,
        password,
        username: user,
        create: true,
      });
      if (account === null) {
        this.lastError = 'nakama_authenticate_failed';
        return null;
      }
      return this.sessionFromNakamaAccount(account, displayName || user);
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
    if (this.nakamaTransport() !== null) {
      // Nakama's native e-mail authentication mails nothing: the address is
      // verified outside the lobby. Reported instead of faking a receipt.
      this.lastError = 'nakama_email_code_unsupported';
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
    if (this.nakamaTransport() !== null) {
      const account = await this.authenticateNakama({
        kind: 'email',
        email: address,
        password,
        create: false,
      });
      if (account === null) {
        this.lastError = 'nakama_authenticate_failed';
        return null;
      }
      return this.sessionFromNakamaAccount(account, address);
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
    this.nakamaAccount = null;
    this.nakamaCredential = null;
    this.room = null;
    this.allocation = null;
    this.ticket = null;
    this.matchmakingTicket = null;
    this.lastError = '';
    this.lastResponse = null;
    this.setTransportSessionToken('');
    try {
      this.sessionStore?.clear();
    } catch {
      // A storage failure must not leave a stale session behind.
    }
  }

  /** `bootstrap` / `GET /v1/bootstrap`. */
  async bootstrap(knownRulesetVersion = ''): Promise<SessionState | null> {
    const response = await this.call('bootstrap', { known_ruleset_version: knownRulesetVersion });
    if (!response.ok) {
      return null;
    }
    if (!isRecord(response.payload)) {
      this.lastError = 'bootstrap_invalid_payload';
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
      // The Nakama bootstrap carries the identity at the top level instead
      // of under `profile`, so both shapes are read.
      userId:
        stringField(profile, 'user_id', 'userId') ||
        stringField(payload, 'user_id', 'userId') ||
        base.userId,
      playerId:
        stringField(profile, 'player_id', 'playerId') ||
        stringField(payload, 'player_id', 'playerId') ||
        base.playerId,
      displayName:
        stringField(profile, 'display_name', 'displayName') ||
        stringField(payload, 'display_name', 'displayName') ||
        base.displayName,
      characterId: stringField(profile, 'character_id', 'characterId') || base.characterId,
      rulesetVersion: stringField(payload, 'ruleset_version', 'rulesetVersion') || base.rulesetVersion,
      unlockedCharacterIds:
        stringArrayField(payload, 'unlocked_character_ids', 'unlockedCharacterIds').length > 0
          ? stringArrayField(payload, 'unlocked_character_ids', 'unlockedCharacterIds')
          : base.unlockedCharacterIds,
    };
    this.setTransportSessionToken(this.session.sessionToken);
    this.persistSession();
    return this.session;
  }

  private setTransportSessionToken(token: string): void {
    this.transport.setSessionToken?.(token);
  }

  private persistSession(): void {
    if (this.sessionStore === undefined || this.session === null) {
      return;
    }
    try {
      this.sessionStore.save(cloneSession(this.session));
    } catch {
      this.logger.warn('lobby session persistence failed');
    }
  }

  private restoreSession(): SessionState | null {
    if (this.sessionStore === undefined) {
      return null;
    }
    try {
      const stored = this.sessionStore.load();
      if (stored === null) {
        return null;
      }
      if (!isSessionState(stored)) {
        this.sessionStore.clear();
        return null;
      }
      return cloneSession(stored);
    } catch {
      return null;
    }
  }

  /** `rooms.create` / `POST /v1/rooms/create`. */
  async createRoom(
    roomCode: string,
    modeId = 'mvp_boss_race',
    options: RoomCreateOptions = {},
  ): Promise<RoomView | null> {
    const response = await this.call('rooms.create', {
      room_code: roomCode,
      mode_id: modeId,
      host_user_id: this.session?.userId ?? '',
      boss_id: options.bossId ?? '',
      mode_params: roomModeParams(options),
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
  async joinRoom(roomCode: string, options: RoomJoinOptions = {}): Promise<RoomView | null> {
    const response = await this.call('rooms.join', {
      room_code: roomCode,
      user_id: this.session?.userId ?? '',
      player_id: this.session?.playerId ?? '',
      mode_params: roomModeParams(options),
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

  /**
   * `match.events` / `GET /v1/matches/{id}/events?after&limit` — one page of
   * the match-event stream, projected through {@link matchEventViewFromPayload}.
   *
   * ★★ MUST run on the REST transport. `match.events` is a FORBIDDEN op on the
   * Nakama RPC path: a client session asking for it gets `403
   * client_operation_disallowed` (server `runtime/nakamaapi`, same forbidden
   * list as `match.input` / `battle.*`), and the deployed transport may be
   * `nakama_rpc`. Without `LobbyClientConfig.restTransport` the symptom is a
   * battle performance layer that never syncs — not an obvious error — so the
   * REST transport is the default-on-REST deployments and mandatory on Nakama.
   */
  // T10: the player's own choice to leave (`abandon`) ends the match at once
  // with no score; anything else is a passive drop that stays reconnectable.
  // The client only supplies the intent — the lobby decides the outcome.
  async disconnectMatch(
    matchId: string,
    intent: 'abandon' | 'drop' = 'drop',
  ): Promise<{ status: string; connected: boolean; tick: number } | null> {
    const response = await this.callOn(
      this.restTransport ?? this.transport,
      this.buildRequest('match.disconnect', { match_id: matchId, intent }),
    );
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    return matchConnectionViewFromPayload(response.payload);
  }

  // T10 rule 4: the response carries the match tick, which the battle scene
  // uses to resync and respawn after a passive drop.
  async reconnectMatch(
    matchId: string,
  ): Promise<{ status: string; connected: boolean; tick: number; secondsLeft?: number } | null> {
    const response = await this.callOn(
      this.restTransport ?? this.transport,
      this.buildRequest('match.reconnect', { match_id: matchId }),
    );
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    return matchConnectionViewFromPayload(response.payload);
  }

  async fetchMatchEvents(matchId: string, after: number, limit: number): Promise<MatchEventsView | null> {
    const response = await this.callOn(
      this.restTransport ?? this.transport,
      this.buildRequest('match.events', { match_id: matchId, after, limit }),
    );
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    const events: MatchEventView[] = [];
    if (Array.isArray(payload.events)) {
      for (const raw of payload.events) {
        if (!isRecord(raw)) {
          continue;
        }
        const view = matchEventViewFromPayload(raw);
        if (view !== null) {
          events.push(view);
        }
      }
    }
    const view: MatchEventsView = {
      events,
      cursor: numberField(payload, 'cursor'),
      hasMore: booleanField(payload, 'has_more', 'hasMore'),
      oldestCursor: numberField(payload, 'oldest_cursor', 'oldestCursor'),
    };
    // Optional fields are attached only when the server reports them, so a
    // caller can tell "absent" from "0" (the server may not emit either yet).
    const latestCursor = optionalNumberField(payload, 'latest_cursor', 'latestCursor');
    if (latestCursor !== undefined) {
      view.latestCursor = latestCursor;
    }
    const snapshotTick = optionalNumberField(payload, 'snapshot_tick', 'snapshotTick');
    if (snapshotTick !== undefined) {
      view.snapshotTick = snapshotTick;
    }
    return view;
  }

  /**
   * `match.snapshot` / `GET /v1/matches/{id}/snapshot` — the stage, the local
   * player's character and the live card effects the scene enters with.
   * REST-only, for the same forbidden-op reason as {@link fetchMatchEvents}.
   */
  async fetchMatchSnapshot(matchId: string): Promise<MatchSnapshotView | null> {
    const response = await this.callOn(
      this.restTransport ?? this.transport,
      this.buildRequest('match.snapshot', { match_id: matchId }),
    );
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    const players = Array.isArray(payload.players) ? payload.players.filter(isRecord) : [];
    // The local player is identified by the session's user id: the snapshot
    // lists every participant and `players[].user_id` is the only mapping back
    // to this client. With no session there is nothing to match on, so the
    // first entry is used (the server emits players in roster order).
    const localUserId = this.session?.userId ?? '';
    const local = localUserId === ''
      ? players[0]
      : players.find((player) => stringField(player, 'user_id', 'userId') === localUserId) ?? players[0];
    const loadout = local !== undefined && isRecord(local.loadout) ? local.loadout : {};
    const modeState = isRecord(payload.mode_state)
      ? payload.mode_state
      : isRecord(payload.modeState)
        ? payload.modeState
        : {};
    const activeCards = Array.isArray(payload.active_cards)
      ? payload.active_cards
      : Array.isArray(payload.activeCards)
        ? payload.activeCards
        : [];
    return {
      matchId: stringField(payload, 'match_id', 'matchId'),
      stageId: stringField(payload, 'stage_id', 'stageId') || stringField(modeState, 'stage_id', 'stageId'),
      characterId: stringField(loadout, 'character_id', 'characterId'),
      activeCards: activeCards.filter(isRecord).map((card) => activeCardSnapshotFromPayload(card)),
      localConnected:
        typeof payload.local_connected === 'boolean'
          ? payload.local_connected
          : typeof payload.localConnected === 'boolean'
            ? payload.localConnected
            : undefined,
    };
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
      opening: openingStateFromPayload(ticket),
      raw: payload,
    };
    return this.ticket;
  }

  /**
   * `match.mode_action` — submit one draft pick.
   *
   * The lobby accepts `candidate_index` (0..2) or `card_id`; the index form is
   * preferred (see {@link roundCardPickPayload}). A rejection returns as an
   * ordinary response with `accepted === false` plus a reason, so the caller
   * shows the reason instead of guessing.
   */
  async selectRoundCard(matchId: string, candidateIndex: number, modeId = ''): Promise<LobbyRpcResponse> {
    return this.call('match.mode_action', roundCardPickPayload(matchId, candidateIndex, modeId));
  }

  /**
   * `match.mode_action` with a `gift` action: hand one interactive gift to the
   * other player mid-match. The lobby echoes it back to both players as a
   * `gift_sent` match event, which is what the battle scene draws.
   *
   * A gift is social only — it never touches the deterministic simulation, so a
   * rejection (unknown gift, not enough energy, match over) is shown as text and
   * changes nothing about the race.
   */
  async sendMatchGift(matchId: string, giftId: string, modeId = ''): Promise<LobbyRpcResponse> {
    return this.call('match.mode_action', matchGiftPayload(matchId, giftId, modeId));
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
   * `GET /v1/replays/{id}/dem` — download a finished match's `.dem` v1 replay
   * container (octet-stream). `id` may be a `replay_id` or a `match_id` (the
   * records view only carries the latter). Returns `null` when no `.dem` exists
   * or the caller is not a participant.
   */
  async downloadDem(id: string): Promise<Uint8Array | null> {
    const http = this.http;
    if (http === null || typeof http.requestBytes !== 'function') {
      return null;
    }
    const headers: Record<string, string> = {};
    const token = this.session?.sessionToken ?? '';
    if (token !== '') {
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await http.requestBytes('GET', `/v1/replays/${pathSegment(id)}/dem`, headers);
    if (response.status < 200 || response.status >= 300) {
      return null;
    }
    return response.bytes;
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
      serverAuthoritative: booleanField(payload, 'server_authoritative', 'serverAuthoritative'),
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

  /**
   * `GET /v1/gacha/pools` — the dual gacha pools plus wallet and pity state.
   *
   * Lookup-only: the server owns every roll, this is the catalog view.
   */
  async fetchGachaPools(): Promise<GachaPoolsView | null> {
    const response = await this.call('gacha.pools');
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    return {
      pools: Array.isArray(payload.pools) ? payload.pools.filter(isRecord).map((pool) => gachaPoolFromPayload(pool)) : [],
      wallet: numberRecordField(payload, 'wallet'),
      faith: numberField(payload, 'faith'),
      pityCounters: pityCounterRecordField(payload, 'pity_counters', 'pityCounters'),
      serverTimeMs: timeFieldMs(payload, 'server_time', 'serverTime'),
      raw: payload,
    };
  }

  /**
   * `POST /v1/gacha/pull` — pull once or ten times from a pool.
   *
   * The client only selects `pool_id` and `count` (1 or 10); every result in
   * the response was rolled server-side.
   */
  async pullGacha(poolId: string, count: number): Promise<GachaPullView | null> {
    if (poolId === '') {
      this.lastError = 'gacha_pull_missing_pool';
      return null;
    }
    if (count !== 1 && count !== 10) {
      this.lastError = 'gacha_pull_invalid_count';
      return null;
    }
    const response = await this.call('gacha.pull', { pool_id: poolId, count });
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    return {
      poolId: stringField(payload, 'pool_id', 'poolId') || poolId,
      count: numberField(payload, 'count') || count,
      results: Array.isArray(payload.results)
        ? payload.results.filter(isRecord).map((result) => gachaPullResultFromPayload(result))
        : [],
      wallet: numberRecordField(payload, 'wallet'),
      faith: numberField(payload, 'faith'),
      characters: characterRosterFromPayload(isRecord(payload.characters) ? payload.characters : {}),
      serverTimeMs: timeFieldMs(payload, 'server_time', 'serverTime'),
      raw: payload,
    };
  }

  /** `GET /v1/gacha/roster` — owned shots, bombs, faith and locked ids. */
  async fetchGachaRoster(): Promise<CharacterRosterView | null> {
    const response = await this.call('gacha.roster');
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    return characterRosterFromPayload(response.payload);
  }

  /** `POST /v1/gacha/faith-exchange` — unlock one locked shot with faith. */
  async exchangeGachaFaith(itemId: string): Promise<FaithExchangeView | null> {
    if (itemId === '') {
      this.lastError = 'gacha_exchange_missing_item';
      return null;
    }
    const response = await this.call('gacha.faith.exchange', { item_id: itemId });
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    return {
      itemId: stringField(payload, 'item_id', 'itemId') || itemId,
      faith: numberField(payload, 'faith'),
      faithSpent: numberField(payload, 'faith_spent', 'faithSpent'),
      characters: characterRosterFromPayload(isRecord(payload.characters) ? payload.characters : {}),
      wallet: numberRecordField(payload, 'wallet'),
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
      decks: Array.isArray(payload.decks)
        ? payload.decks.filter(isRecord).map((deck) => ({
            deckId: stringField(deck, 'deck_id', 'deckId'),
            name: stringField(deck, 'name'),
            format: stringField(deck, 'format'),
            rulesetVersion: stringField(deck, 'ruleset_version', 'rulesetVersion'),
            cardIds: stringArrayField(deck, 'card_ids', 'cardIds'),
            active: booleanField(deck, 'active'),
          }))
        : [],
      serverAuthoritative: booleanField(payload, 'server_authoritative', 'serverAuthoritative'),
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
   * `records.get` / `GET /v1/records` — the player's personal record dashboard.
   *
   * The response is the `RecordsView` itself (`ok` included), so the raw payload
   * *is* the view; `recent` is taken verbatim in server order (newest first).
   */
  async fetchRecords(): Promise<RecordsView | null> {
    const response = await this.call('records.get');
    if (!response.ok || !isRecord(response.payload)) {
      return null;
    }
    const payload = response.payload;
    return {
      ok: booleanField(payload, 'ok'),
      userId: stringField(payload, 'user_id', 'userId'),
      displayName: stringField(payload, 'display_name', 'displayName'),
      gold: numberField(payload, 'gold'),
      tickets: numberField(payload, 'tickets'),
      points: numberField(payload, 'points'),
      ratingCode: stringField(payload, 'rating_code', 'ratingCode'),
      seasonId: stringField(payload, 'season_id', 'seasonId'),
      matchesPlayed: numberField(payload, 'matches_played', 'matchesPlayed'),
      wins: numberField(payload, 'wins'),
      losses: numberField(payload, 'losses'),
      draws: numberField(payload, 'draws'),
      winRate: numberField(payload, 'win_rate', 'winRate'),
      bestScore: numberField(payload, 'best_score', 'bestScore'),
      averageScore: numberField(payload, 'average_score', 'averageScore'),
      totalGraze: numberField(payload, 'total_graze', 'totalGraze'),
      totalHits: numberField(payload, 'total_hits', 'totalHits'),
      totalDamageDealt: numberField(payload, 'total_damage_dealt', 'totalDamageDealt'),
      totalCardPlays: numberField(payload, 'total_card_plays', 'totalCardPlays'),
      deckCount: numberField(payload, 'deck_count', 'deckCount'),
      cardCount: numberField(payload, 'card_count', 'cardCount'),
      recent: Array.isArray(payload.recent)
        ? payload.recent.filter(isRecord).map((entry) => matchHistoryEntryFromPayload(entry))
        : [],
      serverTimeMs: timeFieldMs(payload, 'server_time', 'serverTime', 'server_time_ms', 'serverTimeMs'),
      serverAuthoritative: booleanField(payload, 'server_authoritative', 'serverAuthoritative'),
      clientResultAuthoritative: booleanField(payload, 'client_result_authoritative', 'clientResultAuthoritative'),
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
    this.emit({
      kind: 'match_start',
      matchId,
      serverSeedHex: seedHex,
      endpoint,
      playerIds,
      playerId,
    });
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
      bossId: stringField(payload, 'boss_id', 'bossId'),
      stageId: stringField(payload, 'stage_id', 'stageId'),
      coopPlayers: coopPlayersFromRoomPayload(payload),
      players: Array.isArray(payload.players)
        ? payload.players.filter(isRecord).map((player) => this.playerFromPayload(player))
        : [],
    };
  }

  private playerFromPayload(payload: Record<string, unknown>): RoomPlayerView {
    // 服务端可能把自机字段放在嵌套 `loadout` 里（core.PlayerLoadout），也可能平铺。
    const loadout = isRecord(payload.loadout) ? payload.loadout : payload;
    return {
      userId: stringField(payload, 'user_id', 'userId'),
      playerId: stringField(payload, 'player_id', 'playerId'),
      displayName: stringField(payload, 'display_name', 'displayName'),
      ready: booleanField(payload, 'ready'),
      host: booleanField(payload, 'host'),
      connected: booleanField(payload, 'connected'),
      characterId: stringField(loadout, 'character_id', 'characterId'),
      shotType: stringField(loadout, 'shot_type', 'shotType'),
      bombType: stringField(loadout, 'bomb_type', 'bombType'),
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
  constructor(private readonly http: HttpClient, private bearer = '') {}

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

  setSessionToken(token: string): void {
    this.bearer = token;
  }
}

/**
 * Nakama HTTP RPC transport.
 *
 * Nakama's `/v2/rpc/<id>` endpoint expects the RPC payload as a **JSON
 * string** on the wire, not as a bare object. `HttpClient` implementations
 * serialize the request body themselves (`LayaHttpClient` calls
 * `JSON.stringify(body)`), so this transport hands the adapter an
 * already-serialized string; a bare object is rejected by Nakama with
 * `400 json: cannot unmarshal object into Go value of type string`. Auth uses
 * the HTTP key until an account session exists, after which the Nakama token
 * is sent as a Bearer credential.
 *
 * This class does not create or alter the business envelope. Authenticated
 * callers must provide the envelope fields in the request payload so the
 * server-side replay and authority guard remains the single source of truth.
 */
/**
 * Business-envelope version the lobby accepts today.
 *
 * `runtime/security` pins `business-v0-scaffold`; a mismatch is answered
 * `business_envelope_invalid` before the operation is dispatched.
 */
export const NAKAMA_BUSINESS_ENVELOPE_VERSION = 'business-v0-scaffold';

/**
 * Operations the lobby dispatches **before** an account session exists.
 *
 * `runtime/nakamaapi.rpcSkipsEnvelope` names exactly these four. They must be
 * sent without a `business_envelope`, otherwise the envelope guard rejects them
 * for want of a session id.
 */
const NAKAMA_UNAUTHENTICATED_OPS = new Set([
  'auth.anonymous',
  'auth.emailcode',
  'auth.register',
  'auth.login',
]);

/**
 * A Nakama account session.
 *
 * Nakama only accepts credentials it minted itself: the Gensoulkyo session
 * token that `auth.anonymous` returns answers `401 Auth token invalid` on
 * `/v2/rpc/*`, so it cannot be reused as the RPC bearer. The client therefore
 * authenticates against Nakama's own account API first and carries the JWT.
 */
export interface NakamaAccountSession {
  /** Nakama session token (JWT) — the bearer credential for `/v2/rpc/*`. */
  token: string;
  refreshToken: string;
  /** Nakama user id (a UUID), *not* the Gensoulkyo `user_*` id. */
  userId: string;
  username: string;
  /** JWT `exp` in milliseconds; `0` when the token could not be decoded. */
  expiresAtMs: number;
  /** Nakama session id; the lobby's replay guard buckets `seq` by it. */
  sessionId: string;
}

/** Nakama-native authentication request. */
export type NakamaAuthRequest =
  | { kind: 'device'; id: string; username?: string }
  | { kind: 'email'; email: string; password: string; username?: string; create?: boolean }
  | { kind: 'custom'; id: string; username?: string };

/**
 * Transport capability for Nakama-native authentication. `LobbyClient` uses it
 * when present and keeps the legacy `auth.*` operation flow otherwise, so REST
 * and lobby-WS deployments are unaffected by the Nakama switch.
 */
export interface NakamaAccountTransport extends LobbyTransport {
  authenticateAccount(request: NakamaAuthRequest): Promise<NakamaAccountSession | null>;
}

/**
 * Nakama HTTP RPC transport.
 *
 * Two Nakama surfaces are involved and they take **different** keys:
 *
 * - `/v2/account/authenticate/*` is authenticated with the Nakama *server* key
 *   (`socket.server_key`). It answers the session token (JWT) that is the only
 *   credential the RPC gateway accepts.
 * - `/v2/rpc/<op>` takes that JWT as `Bearer`. Until an account session exists
 *   the runtime HTTP key is used instead, which is only enough to reach the
 *   pre-authentication operations.
 *
 * Nakama's RPC endpoint takes the RPC payload as a **JSON string** and answers
 * `{"payload": "<envelope JSON string>"}`. Nakama unmarshals the HTTP body
 * into a Go `string` before it hands it to the RPC handler, so a bare JSON
 * object is rejected with `400 json: cannot unmarshal object into Go value of
 * type string`. `HttpClient` implementations serialize the request body
 * themselves (`LayaHttpClient` and `FetchHttpClient` both call
 * `JSON.stringify(body)`), so this transport passes the payload as an
 * **already serialized string** and lets the adapter add the single JSON
 * layer. Responses are therefore unwrapped twice: once by the HTTP layer and
 * once here.
 *
 * HTTP status is not the verdict: a dispatched operation always answers `200`
 * and the business verdict lives in the envelope inside `payload`.
 */
export class NakamaLobbyTransport implements NakamaAccountTransport {
  private sessionToken: string;
  private account: NakamaAccountSession | null = null;
  /**
   * Envelope `seq`: strictly increasing, and never reset.
   *
   * The lobby's replay guard buckets `seq` by the **business** session id,
   * which the server derives from the Nakama user id
   * (`nakama-http-session:<uid>`). That bucket therefore survives both a
   * re-authentication and a client restart for the same device, so a counter
   * that restarts at `1` would be answered `business_envelope_replay` for
   * every later call. See {@link nextEnvelopeSeq}.
   */
  private envelopeSeq = 0;
  /** Bumped on every (re)authentication so nonces stay unique across sessions. */
  private envelopeEpoch = 0;
  private readonly nonceSeed: string;

  constructor(
    private readonly http: HttpClient,
    private readonly options: NakamaLobbyTransportOptions = {},
  ) {
    this.sessionToken = options.sessionToken ?? '';
    this.nonceSeed = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * Mints (or resumes) a Nakama account session and installs its token as the
   * bearer for every later call.
   *
   * The envelope `seq` is deliberately **not** reset here: the lobby's replay
   * guard buckets `seq` by the business session id, which is derived from the
   * Nakama user id and therefore identical before and after a
   * re-authentication. Restarting the counter would make every later call be
   * answered `business_envelope_replay`.
   */
  async authenticateAccount(request: NakamaAuthRequest): Promise<NakamaAccountSession | null> {
    const path =
      request.kind === 'device'
        ? '/v2/account/authenticate/device'
        : request.kind === 'email'
          ? '/v2/account/authenticate/email'
          : '/v2/account/authenticate/custom';
    const body: Record<string, unknown> =
      request.kind === 'email'
        ? { email: request.email, password: request.password }
        : { id: request.id };
    const create = request.kind === 'email' ? request.create !== false : true;
    const wanted = nakamaUsername(request.username);
    const attempt = async (username: string | undefined): Promise<NakamaAccountSession | null> => {
      const params = [`create=${create ? 'true' : 'false'}`];
      if (username !== undefined && username !== '') {
        params.push(`username=${encodeURIComponent(username)}`);
      }
      const response = await this.http.request('POST', `${path}?${params.join('&')}`, body, this.serverHeaders());
      return nakamaAccountFromResponse(response);
    };
    let account = await attempt(wanted);
    if (account === null && wanted !== undefined) {
      // A taken or rejected username must not block sign-in: Nakama answers the
      // whole request with an error, so retry without it and keep the generated
      // name. Only the *first* authentication of a device can set a username
      // anyway, so this branch is cheap.
      account = await attempt(undefined);
    }
    if (account === null) {
      return null;
    }
    this.account = account;
    this.sessionToken = account.token;
    this.envelopeEpoch += 1;
    return account;
  }

  /** The account session established by {@link authenticateAccount}. */
  currentAccount(): NakamaAccountSession | null {
    return this.account;
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
    const envelope = this.businessEnvelopeFor(request, body);
    const wirePayload = envelope === null ? body : { business_envelope: envelope, body };
    // Nakama unmarshals the HTTP body into a Go `string` before the RPC
    // handler sees it, so the payload has to travel as a JSON string. The
    // `HttpClient` adapters serialize the body once (`JSON.stringify(body)`),
    // which turns the string below into the quoted JSON string Nakama wants.
    const response = await this.http.request(
      'POST',
      `/v2/rpc/${encodeURIComponent(rpcId)}`,
      JSON.stringify(wirePayload),
      headers,
    );
    return nakamaResponse(response);
  }

  close(): void {
    // HTTP is stateless; nothing to release.
  }

  setSessionToken(token: string): void {
    this.sessionToken = token;
  }

  private serverHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    const serverKey = this.options.serverKey ?? this.options.httpKey ?? '';
    if (serverKey !== '') {
      headers.Authorization = `Basic ${encodeBasicAuth(`${serverKey}:`)}`;
    }
    return headers;
  }

  private businessEnvelopeFor(
    request: LobbyRpcRequest,
    body: Record<string, unknown>,
  ): Record<string, unknown> | null {
    if (NAKAMA_UNAUTHENTICATED_OPS.has(request.id.trim().toLowerCase())) {
      return null;
    }
    const supplied = this.options.businessEnvelope?.(request, body);
    if (supplied !== undefined) {
      return supplied;
    }
    return this.scaffoldEnvelope(request, body);
  }

  /**
   * The built-in `business-v0-scaffold` envelope.
   *
   * The lobby guard is the authority and it does check the fields this fills:
   * a missing envelope is `business_envelope_required`, a `seq` that does not
   * strictly advance within one session (or a repeated `nonce`) is
   * `business_envelope_replay`, and the tag must be 64 hex characters. It does
   * **not** verify `auth_tag` cryptographically — at this protocol version the
   * envelope is a scaffold, not a signature. The tag is therefore a
   * deterministic digest of the request: stable and auditable, without
   * pretending to be a client-side HMAC the server could trust.
   */
  private scaffoldEnvelope(
    request: LobbyRpcRequest,
    body: Record<string, unknown>,
  ): Record<string, unknown> {
    const op = request.id.trim();
    const seq = this.nextEnvelopeSeq();
    const bodyHash = sha256Hex(JSON.stringify(body));
    const nonce = sha256Hex(`${this.nonceSeed}:${this.envelopeEpoch}:${op}:${seq}`).slice(0, 32);
    return {
      version: NAKAMA_BUSINESS_ENVELOPE_VERSION,
      seq,
      timestamp_ms: Date.now(),
      nonce,
      op_code: op,
      key_id: 'client-nakama-rpc',
      auth_tag: sha256Hex(`${this.envelopeEpoch}:${seq}:${nonce}:${op}:${bodyHash}`),
      ciphertext_mode: 'plain-scaffold',
      body_hash: bodyHash,
    };
  }

  /**
   * The next envelope `seq`.
   *
   * The guard only compares `seq` against the highest value it has seen for
   * the business session id, and that id is derived from the Nakama user id —
   * so the bucket outlives both a re-authentication and a client restart of
   * the same device. A `1, 2, 3…` counter therefore breaks the second time
   * the player opens the game. Seeding the counter with the wall clock makes
   * every restart start above whatever the server still remembers, while
   * `last + 1` keeps the sequence strictly increasing inside one process.
   */
  private nextEnvelopeSeq(): number {
    const next = Math.max(this.envelopeSeq + 1, Date.now());
    this.envelopeSeq = next;
    return next;
  }
}

export interface NakamaLobbyTransportOptions {
  /** Nakama runtime HTTP key used before an authenticated session exists. */
  httpKey?: string;
  /**
   * Nakama server key (`socket.server_key`), required by
   * `/v2/account/authenticate/*`. Falls back to `httpKey` so a single-key
   * deployment keeps working.
   */
  serverKey?: string;
  /** Optional existing Nakama session token, useful after a cold restart. */
  sessionToken?: string;
  /**
   * Optional business-envelope producer. Returning `null` leaves the payload
   * unwrapped; omitting it falls back to the transport's built-in scaffold,
   * which the lobby requires for every authenticated operation.
   */
  businessEnvelope?: NakamaBusinessEnvelopeFactory;
}

export type NakamaBusinessEnvelopeFactory = (
  request: LobbyRpcRequest,
  body: Record<string, unknown>,
) => Record<string, unknown> | null;

/**
 * Maps a Nakama RPC response onto the Gensoulkyo envelope.
 *
 * Every dispatched operation answers HTTP `200`, so `ok` comes from the
 * envelope Nakama carries in `payload` **as a JSON string**. Failures Nakama
 * itself raises (expired token, unknown RPC id) have no `payload` and report
 * through `error` instead.
 */
function nakamaResponse(response: HttpResponseLike): LobbyRpcResponse {
  const statusOk = response.status >= 200 && response.status < 300;
  if (!isRecord(response.body)) {
    return {
      ok: statusOk,
      status: response.status,
      error_code: statusOk ? undefined : `nakama_http_${response.status}`,
      payload: undefined,
    };
  }
  const body = response.body;
  const envelope = nakamaEnvelope(body);
  if (envelope === null) {
    return {
      ok: false,
      status: response.status,
      error_code:
        stringField(body, 'error_code', 'errorCode', 'error', 'code') || `nakama_http_${response.status}`,
      message: stringField(body, 'message'),
    };
  }
  return {
    ok: envelope.ok !== false && statusOk,
    status: typeof envelope.status === 'number' ? envelope.status : response.status,
    error_code: stringField(envelope, 'error_code', 'errorCode') || undefined,
    message: stringField(envelope, 'message') || undefined,
    payload: envelope.payload ?? envelope,
  };
}

/** Unwraps the second response layer: `{"payload": "<envelope JSON string>"}`. */
function nakamaEnvelope(body: Record<string, unknown>): Record<string, unknown> | null {
  const raw = body.payload;
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  if (isRecord(raw)) {
    return raw;
  }
  // Nakama's own failures (`{"error": …, "code": …}`) carry no `payload` and
  // must not be mistaken for a business envelope — otherwise a `2xx` direct
  // error would be read as a success.
  if (isNakamaDirectError(body)) {
    return null;
  }
  return body;
}

/**
 * Whether a body is one of Nakama's own failure answers.
 *
 * Nakama reports its own errors as `{"error": "<reason>", "message": "…",
 * "code": <grpc code>}` — a shape the business envelope never uses (it speaks
 * `error_code` / `message` and carries the verdict in `ok`).
 */
function isNakamaDirectError(body: Record<string, unknown>): boolean {
  if (stringField(body, 'error', 'error_code', 'errorCode') !== '') {
    return true;
  }
  return numberField(body, 'code') !== 0;
}

function nakamaAccountFromResponse(response: HttpResponseLike): NakamaAccountSession | null {
  const body = response.body;
  if (response.status < 200 || response.status >= 300 || !isRecord(body)) {
    return null;
  }
  const token = stringField(body, 'token');
  if (token === '') {
    return null;
  }
  const claims = jwtClaims(token) ?? {};
  return {
    token,
    refreshToken: stringField(body, 'refresh_token', 'refreshToken'),
    userId: stringField(body, 'user_id', 'userId') || stringField(claims, 'uid'),
    username: stringField(claims, 'usn'),
    expiresAtMs: numberField(claims, 'exp') * 1000,
    sessionId: stringField(claims, 'tid'),
  };
}

const NAKAMA_USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,20}$/;

/**
 * Nakama usernames are a separate namespace with their own charset and
 * uniqueness rule, so a display name is only forwarded when it fits; anything
 * else falls back to the name Nakama generates.
 */
function nakamaUsername(displayName: string | undefined): string | undefined {
  const trimmed = (displayName ?? '').trim();
  return NAKAMA_USERNAME_PATTERN.test(trimmed) ? trimmed : undefined;
}

/** Decodes the middle segment of a JWT. Not a verifier — the server does that. */
function jwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }
  const bytes = decodeBase64Url(parts[1]);
  if (bytes.length === 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(decodeUtf8Loose(bytes));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '=') {
      continue;
    }
    const six = char === '-' ? 62 : char === '_' ? 63 : alphabet.indexOf(char);
    if (six < 0) {
      return new Uint8Array(0);
    }
    buffer = (buffer << 6) | six;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

function sha256Hex(value: string): string {
  return bytesToHex(new Uint8Array(sha256Bytes(value)));
}

/**
 * Whether a failed call can be rescued by re-authenticating the same identity.
 *
 * A Nakama session id is the key the lobby's replay guard buckets `seq` by, so
 * minting a fresh session is also the only client-side way to recover a
 * sequence that drifted ahead of the server (for example a lobby restart that
 * cleared the guard while the client kept counting).
 */
function nakamaRecoverable(response: LobbyRpcResponse): boolean {
  if (response.status === 401) {
    return true;
  }
  return response.error_code === 'business_envelope_replay' || response.error_code === 'business_envelope_invalid';
}

function isNakamaAccountTransport(value: LobbyTransport): value is NakamaAccountTransport {
  return typeof (value as { authenticateAccount?: unknown }).authenticateAccount === 'function';
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
  'auth.register': { method: 'POST', path: () => '/v1/auth/register' },
  'auth.login': { method: 'POST', path: () => '/v1/auth/login' },
  'auth.logout': { method: 'POST', path: () => '/v1/auth/logout' },
  'auth.emailCode': { method: 'POST', path: () => '/v1/auth/email/code' },
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
  // The battle allocation/ticket live under `/v1/matches/{id}/...` in
  // `runtime/httpapi/handler.go` — there is no `/v1/battles/...` namespace, and
  // `battle-ticket` is a POST. The older `/v1/battles/...` paths silently 404'd
  // with `not_found: route not found`.
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
  // --- check-in / shop / inventory ---
  'checkin.get': { method: 'GET', path: () => '/v1/checkin' },
  'checkin.claim': { method: 'POST', path: () => '/v1/checkin/claim' },
  'shop.get': { method: 'GET', path: () => '/v1/shop' },
  'shop.purchase': { method: 'POST', path: () => '/v1/shop/purchase' },
  'chests.get': { method: 'GET', path: () => '/v1/chests' },
  'records.get': { method: 'GET', path: () => '/v1/records' },
  // --- gacha totems (cards + characters) ---
  'gacha.pools': { method: 'GET', path: () => '/v1/gacha/pools' },
  'gacha.pull': { method: 'POST', path: () => '/v1/gacha/pull' },
  'gacha.roster': { method: 'GET', path: () => '/v1/gacha/roster' },
  'gacha.faith.exchange': { method: 'POST', path: () => '/v1/gacha/faith-exchange' },
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
  /**
   * The session this connection is (or should be) authenticated as. Kept so a
   * socket that opens *after* the session was installed can still be bound to
   * it — see {@link authenticateConnection}.
   */
  private sessionToken = '';
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
    // A session installed before the socket finished connecting still has to
    // bind: `setSessionToken` could not send anything while it was closed.
    if (this.sessionToken !== '' && !this.disposed) {
      void this.authenticateConnection(this.sessionToken);
    }
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

  /**
   * Binds this connection to a session.
   *
   * The lobby WS authenticates the **connection**, not each message:
   * `handleAuth` stores the token on the client and every connection-scoped
   * handler (`rooms.create`, `rooms.join`, `bootstrap`, `presence.heartbeat`)
   * starts with `requireAuth()`, which fails on an unauthenticated socket.
   *
   * Anonymous sign-in never exposed this because `LobbyClient.loginAnonymous`
   * routes `auth.anonymous` — which the server treats as the `AuthRequest` —
   * through this very socket. An account sign-in (`auth.login` /
   * `auth.register`) has no WS route and falls back to HTTP, so the socket was
   * left unauthenticated: the REST session was perfectly valid while every room
   * operation answered `unauthorized`. Re-sending the auth frame with the
   * account's session token is what closes that gap.
   *
   * Failures are deliberately not surfaced here: the caller is
   * `LobbyClient.sessionFromPayload`, which cannot await, and a rejected
   * re-authentication is reported by the next connection-scoped call anyway.
   */
  setSessionToken(token: string): void {
    const previous = this.sessionToken;
    this.sessionToken = token;
    this.fallback?.setSessionToken?.(token);
    if (this.disposed) {
      return;
    }
    if (token === '') {
      // Signing out must also release the SERVER-side binding. The lobby keeps
      // the connection registered under the old session, so signing back into
      // the same account would supersede it — and the server answers that by
      // pushing `session_replaced` and closing the socket the client is still
      // using, which reads to the player as "signed in on another device".
      // Abandoning the connection here makes the next call build a fresh one.
      if (previous !== '') {
        this.closed = true;
        this.dropSocket();
      }
      return;
    }
    if (!this.closed && this.socket.connected) {
      void this.authenticateConnection(token);
    }
  }

  /**
   * Abandons the connection without disposing the transport.
   *
   * `close()` is final — an application-initiated shutdown never reconnects —
   * whereas this only drops the socket, so the next call goes through the
   * normal one-shot reconnect path.
   */
  private dropSocket(): void {
    try {
      this.socket.close();
    } catch {
      // A socket that is already gone needs nothing.
    }
  }

  /** Sends the `AuthRequest` that binds this connection to a session. */
  private authenticateConnection(token: string): Promise<LobbyRpcResponse> {
    this.sequence += 1;
    const frame = encodeLobbyEnvelope(
      LOBBY_MESSAGE.AuthRequest,
      {
        version: this.version,
        session_token: token,
        user_id: this.userId,
        platform: this.platform,
        client_build: this.clientBuild,
      },
      this.sequence,
    );
    return new Promise<LobbyRpcResponse>((resolve) => {
      this.pending.push({ types: [LOBBY_MESSAGE.AuthResponse], resolve });
      this.socket.send(frame);
    });
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
          // 房间 boss 选择：lobbyws.RoomCreateRequest 有 boss_id 字段，此前漏传
          // ⇒ WS 建房路径下 boss 永远是默认 timeline（REST 路径正常）。
          boss_id: stringField(payload, 'boss_id', 'bossId'),
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

/** Pity counters keyed by pool id (`core.ChestPityState`). */
function pityCounterRecordField(
  source: Record<string, unknown>,
  ...keys: string[]
): Record<string, { rareCounter: number; epicCounter: number }> {
  for (const key of keys) {
    const value = source[key];
    if (!isRecord(value)) {
      continue;
    }
    const out: Record<string, { rareCounter: number; epicCounter: number }> = {};
    for (const [poolId, counter] of Object.entries(value)) {
      if (!isRecord(counter)) {
        continue;
      }
      out[poolId] = {
        rareCounter: numberField(counter, 'rare_counter', 'rareCounter'),
        epicCounter: numberField(counter, 'epic_counter', 'epicCounter'),
      };
    }
    return out;
  }
  return {};
}

/** One gacha pool (`core.GachaPool`). */
function gachaPoolFromPayload(payload: Record<string, unknown>): GachaPoolView {
  return {
    poolId: stringField(payload, 'pool_id', 'poolId'),
    kind: stringField(payload, 'kind'),
    name: stringField(payload, 'name'),
    nameKey: stringField(payload, 'name_key', 'nameKey'),
    costGems: numberField(payload, 'cost_gems', 'costGems'),
    costTenGems: numberField(payload, 'cost_ten_gems', 'costTenGems'),
    weights: numberRecordField(payload, 'weights'),
    pity: {
      rareEvery: numberField(isRecord(payload.pity) ? payload.pity : {}, 'rare_every', 'rareEvery'),
      epicEvery: numberField(isRecord(payload.pity) ? payload.pity : {}, 'epic_every', 'epicEvery'),
    },
    featured: stringArrayField(payload, 'featured'),
    enabled: booleanField(payload, 'enabled'),
  };
}

/** One draw inside a pull response (`core.GachaPullResult`). */
function gachaPullResultFromPayload(payload: Record<string, unknown>): GachaPullResultView {
  return {
    id: stringField(payload, 'id'),
    kind: stringField(payload, 'kind'),
    cardId: stringField(payload, 'card_id', 'cardId'),
    shotId: stringField(payload, 'shot_id', 'shotId'),
    chara: stringField(payload, 'chara'),
    nameKey: stringField(payload, 'name_key', 'nameKey'),
    rarity: stringField(payload, 'rarity'),
    isNew: booleanField(payload, 'is_new', 'isNew'),
    dust: numberField(payload, 'dust'),
    faithGained: numberField(payload, 'faith_gained', 'faithGained'),
  };
}

/** The character roster projection (`core.CharacterRosterSnapshot`). */
function characterRosterFromPayload(payload: Record<string, unknown>): CharacterRosterView {
  return {
    userId: stringField(payload, 'user_id', 'userId'),
    shots: Array.isArray(payload.shots)
      ? payload.shots.filter(isRecord).map((shot) => ({
          shotId: stringField(shot, 'shot_id', 'shotId'),
          chara: stringField(shot, 'chara'),
          source: stringField(shot, 'source'),
          dupes: numberField(shot, 'dupes'),
          obtainedAtMs: timeFieldMs(shot, 'obtained_at', 'obtainedAt'),
        }))
      : [],
    bombs: stringArrayField(payload, 'bombs'),
    faith: numberField(payload, 'faith'),
    pityCounters: pityCounterRecordField(payload, 'pity_counters', 'pityCounters'),
    lockedShotIds: stringArrayField(payload, 'locked_shot_ids', 'lockedShotIds'),
    exchangeCostFaith: numberField(payload, 'exchange_cost_faith', 'exchangeCostFaith'),
    serverAuthoritative: booleanField(payload, 'server_authoritative', 'serverAuthoritative'),
    serverTimeMs: timeFieldMs(payload, 'server_time', 'serverTime'),
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

/** One finished match, newest-first in `RecordsView.recent`. */
function matchHistoryEntryFromPayload(payload: Record<string, unknown>): MatchHistoryEntryView {
  return {
    matchId: stringField(payload, 'match_id', 'matchId'),
    modeId: stringField(payload, 'mode_id', 'modeId'),
    stageId: stringField(payload, 'stage_id', 'stageId'),
    result: stringField(payload, 'result'),
    score: numberField(payload, 'score'),
    rankDelta: numberField(payload, 'rank_delta', 'rankDelta'),
    opponentId: stringField(payload, 'opponent_id', 'opponentId'),
    grazeCount: numberField(payload, 'graze_count', 'grazeCount'),
    hitCount: numberField(payload, 'hit_count', 'hitCount'),
    damageDealt: numberField(payload, 'damage_dealt', 'damageDealt'),
    cardPlays: numberField(payload, 'card_plays', 'cardPlays'),
    durationTicks: numberField(payload, 'duration_ticks', 'durationTicks'),
    endedAtMs: timeFieldMs(payload, 'ended_at', 'endedAt', 'ended_at_ms', 'endedAtMs'),
    hasDem: payload['has_dem'] === true || payload['hasDem'] === true,
    demSize: numberField(payload, 'dem_size', 'demSize'),
  };
}

/** One live card effect; extra fields are only set when the wire carries them. */
export function activeCardSnapshotFromPayload(payload: Record<string, unknown>): ActiveCardSnapshot {
  const snapshot: ActiveCardSnapshot = {
    cardId: stringField(payload, 'card_id', 'cardId'),
    effectKind: stringField(payload, 'effect_kind', 'effectKind'),
    startedTick: numberField(payload, 'started_tick', 'startedTick'),
    expiresTick: numberField(payload, 'expires_tick', 'expiresTick'),
  };
  const patternId = stringField(payload, 'pattern_id', 'patternId');
  if (patternId !== '') {
    snapshot.patternId = patternId;
  }
  const targetUserId = stringField(payload, 'target_user_id', 'targetUserId');
  if (targetUserId !== '') {
    snapshot.targetUserId = targetUserId;
  }
  if ('purge_radius' in payload || 'purgeRadius' in payload) {
    snapshot.purgeRadius = numberField(payload, 'purge_radius', 'purgeRadius');
  }
  if ('purge_count' in payload || 'purgeCount' in payload) {
    snapshot.purgeCount = numberField(payload, 'purge_count', 'purgeCount');
  }
  return snapshot;
}

/**
 * Ticks the effect was granted for. The wire only sends the start and expiry
 * ticks, so the duration is derived here instead of being read off the payload.
 */
export function activeCardDurationTicks(snapshot: ActiveCardSnapshot): number {
  return Math.max(0, snapshot.expiresTick - snapshot.startedTick);
}

/**
 * Ticks left at `currentTick`, floored at zero so an expired effect reads `0`.
 * Lives outside the parser because a payload has no notion of "now".
 */
export function activeCardRemainingTicks(snapshot: ActiveCardSnapshot, currentTick: number): number {
  return Math.max(0, snapshot.expiresTick - currentTick);
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
    bossId: stringField(source, 'boss_id', 'bossId'),
    stageId: stringField(source, 'stage_id', 'stageId'),
    players: Array.isArray(source.players)
      ? source.players.filter(isRecord).map((player) => {
          const loadout = isRecord(player.loadout) ? player.loadout : player;
          return {
            userId: stringField(player, 'user_id', 'userId'),
            playerId: stringField(player, 'player_id', 'playerId'),
            displayName: stringField(player, 'display_name', 'displayName'),
            ready: booleanField(player, 'ready'),
            host: booleanField(player, 'host'),
            connected: booleanField(player, 'connected'),
            characterId: stringField(loadout, 'character_id', 'characterId'),
            shotType: stringField(loadout, 'shot_type', 'shotType'),
            bombType: stringField(loadout, 'bomb_type', 'bombType'),
          };
        })
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

function connectionStringField(payload: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) {
    const value = payload[name];
    if (typeof value === 'string') {
      return value;
    }
  }
  return '';
}

function matchConnectionViewFromPayload(
  payload: Record<string, unknown>,
): { status: string; connected: boolean; tick: number; secondsLeft?: number } {
  const view: { status: string; connected: boolean; tick: number; secondsLeft?: number } = {
    status: connectionStringField(payload, 'reconnect_status', 'reconnectStatus'),
    connected: booleanField(payload, 'connected'),
    tick: numberField(payload, 'tick'),
  };
  const secondsLeft = optionalNumberField(payload, 'seconds_left', 'secondsLeft');
  if (secondsLeft !== undefined) {
    view.secondsLeft = secondsLeft;
  }
  return view;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSessionState(value: unknown): value is SessionState {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.sessionToken === 'string' &&
    value.sessionToken !== '' &&
    typeof value.userId === 'string' &&
    value.userId !== '' &&
    typeof value.playerId === 'string' &&
    typeof value.displayName === 'string' &&
    typeof value.characterId === 'string' &&
    typeof value.rulesetVersion === 'string' &&
    Array.isArray(value.unlockedCharacterIds) &&
    value.unlockedCharacterIds.every((id) => typeof id === 'string')
  );
}

function cloneSession(session: SessionState): SessionState {
  return { ...session, unlockedCharacterIds: [...session.unlockedCharacterIds] };
}

/** Opening state the lobby deals into the signed ticket (W-1). */
export interface BattleOpeningState {
  /** Catalog card ids in server order, deduplicated, capped at the hand limit. */
  handCardIds: string[];
  /** Opening energy; `0` when the ticket omits or malforms it. */
  initialEnergy: number;
  /**
   * The authoritative lobby seed as DECIMAL TEXT (`seedFrom`, SHA-256 based).
   * Never a number: a JSON number above 2^53 has already narrowed on the wire,
   * so a numeric value is treated as absent rather than silently coerced.
   */
  serverSeed: string;
}

/** Hand cap the lobby enforces (`cardHandLimit`); mirrored here for display. */
export const MAX_OPENING_HAND = 4;

/**
 * Projects the signed ticket's opening loadout onto {@link BattleOpeningState}.
 *
 * Returns `null` when the payload is not an object or carries no hand at all,
 * so callers can tell "no opening state" (an older server) apart from "an empty
 * hand". Never throws: a malformed row is dropped rather than fatal.
 */
/**
 * The `match.mode_action` payload for a draft pick.
 *
 * `candidate_index` is preferred over `card_id`: an index cannot name a card
 * outside the round's candidates, so a stale UI cannot smuggle one in. The
 * result is never client-authoritative — the lobby owns the outcome.
 */
export function roundCardPickPayload(
  matchId: string,
  candidateIndex: number,
  modeId = '',
): Record<string, unknown> {
  return {
    match_id: matchId,
    mode_id: modeId,
    action_type: 'select_round_card',
    payload: { candidate_index: candidateIndex },
    client_result_authoritative: false,
  };
}

/**
 * `match.mode_action` payload for a gift. `action_type` is the lobby's own
 * discriminator (the same channel the card picks use), and `gift_id` must be a
 * catalog id — the server rejects anything it does not know rather than
 * guessing.
 */
export function matchGiftPayload(
  matchId: string,
  giftId: string,
  modeId = '',
): Record<string, unknown> {
  return {
    match_id: matchId,
    mode_id: modeId,
    action_type: 'gift',
    payload: { gift_id: giftId },
    client_result_authoritative: false,
  };
}

export function openingStateFromPayload(payload: Record<string, unknown>): BattleOpeningState | null {
  if (!isRecord(payload)) {
    return null;
  }
  const handRaw = payload['hand_card_ids'] ?? payload['handCardIds'];
  if (!Array.isArray(handRaw)) {
    return null;
  }
  const handCardIds: string[] = [];
  for (const item of handRaw) {
    if (typeof item !== 'string') {
      continue;
    }
    const cardId = item.trim();
    if (cardId === '' || handCardIds.includes(cardId)) {
      continue;
    }
    if (handCardIds.length >= MAX_OPENING_HAND) {
      break;
    }
    handCardIds.push(cardId);
  }
  const energyRaw = payload['initial_energy'] ?? payload['initialEnergy'];
  let initialEnergy = 0;
  if (typeof energyRaw === 'number' && Number.isFinite(energyRaw) && energyRaw >= 0) {
    initialEnergy = energyRaw;
  } else if (typeof energyRaw === 'string' && energyRaw !== '') {
    const parsed = Number(energyRaw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      initialEnergy = parsed;
    }
  }
  const seedRaw = payload['server_seed'] ?? payload['serverSeed'];
  const serverSeed = typeof seedRaw === 'string' ? seedRaw.trim() : '';
  return { handCardIds, initialEnergy, serverSeed };
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

/**
 * Reads a numeric field, or `undefined` when neither spelling is present.
 *
 * The counterpart to {@link numberField} for *optional* wire fields:
 * `numberField` collapses "absent" and "0" into `0`, which is right for a
 * required field but loses the distinction for an optional one.
 */
export function optionalNumberField(source: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string' && value !== '' && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
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
