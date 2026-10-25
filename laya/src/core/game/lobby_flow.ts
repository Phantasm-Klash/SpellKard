/**
 * Lobby → room → match → battle → result flow.
 *
 * This is a pure state machine: it owns which screen is active and what the
 * screen should render, and it delegates every network action to `LobbyClient`.
 * The LayaAir layer subscribes to `onChange` and rebuilds its scene from
 * `snapshot()`.
 */

import type {
  BattleAllocationView,
  BattleTicketView,
  CharacterRosterView,
  CheckinView,
  GachaPoolsView,
  GachaPullView,
  InventoryView,
  LobbyClient,
  MatchmakingTicketView,
  RecordsView,
  RoomCreateOptions,
  RoomJoinOptions,
  RoomView,
  SessionState,
  ShopView,
} from '../net/lobby_client';
import { SESSION_EXPIRED_CODE, SESSION_REPLACED_CODE } from '../net/lobby_client';
import { describeAuthError } from './auth_messages';
import { t } from './i18n';

export enum LobbyScreen {
  Login = 'login',
  Lobby = 'lobby',
  Room = 'room',
  Matching = 'matching',
  Battle = 'battle',
  Result = 'result',
  Checkin = 'checkin',
  Shop = 'shop',
  Gacha = 'gacha',
  Inventory = 'inventory',
  Records = 'records',
  Error = 'error',
}

/**
 * Default mode id used when creating a room or joining matchmaking.
 *
 * Must match an entry in the lobby's `ModeConfigs` registry
 * (`Gensoulkyo/runtime/core/types.go`), otherwise `rooms.create` fails with
 * `mode_invalid`. That registry ships: `certification` (2p), `pvp_duel` (2p),
 * `battle_royale` (5-10p), `world_boss` (4-8p), `instance_boss` and — since it
 * was added for the MVP — `mvp_boss_race` (2p, the mode this client plays).
 *
 * If you point the client at an *older* lobby binary that predates the
 * `mvp_boss_race` registration, rooms.create will fail with `mode_invalid`;
 * switch this to `pvp_duel` as a temporary fallback in that case.
 */
export const DEFAULT_MODE_ID = 'mvp_boss_race';

export interface MatchStartInfo {
  matchId: string;
  serverSeedHex: string;
  endpoint: string;
  playerIds: string[];
  /** This client's battle roster id (`p-<hash>`); empty if the lobby omitted it. */
  playerId: string;
  modeId: string;
  rulesetVersion: string;
}

export interface MatchResultInfo {
  matchId: string;
  winnerPlayerId: string;
  points: Record<string, number>;
  replayId: string;
  serverAuthoritative: boolean;
  modeId: string;
  settledAtMs: number;
}

export interface LobbyFlowSnapshot {
  screen: LobbyScreen;
  statusText: string;
  session: SessionState | null;
  room: RoomView | null;
  allocation: BattleAllocationView | null;
  ticket: BattleTicketView | null;
  /** Active matchmaking queue ticket, if the player is queued. */
  matchmaking: MatchmakingTicketView | null;
  match: MatchStartInfo | null;
  result: MatchResultInfo | null;
  /** 7-day check-in cycle, loaded while the check-in screen is open. */
  checkin: CheckinView | null;
  /** Shop listings + wallet, loaded while the shop screen is open. */
  shop: ShopView | null;
  /** Gacha pools + wallet + pity, loaded while the gacha screen is open. */
  gacha: GachaPoolsView | null;
  /** Character roster (owned shots/bombs/faith), refreshed by every pull. */
  gachaRoster: CharacterRosterView | null;
  /** Result of the most recent pull, rendered by the gacha screen. */
  gachaLastPull: GachaPullView | null;
  /** Owned card stacks, loaded while the inventory screen is open. */
  inventory: InventoryView | null;
  /** Personal records dashboard, loaded while the records screen is open. */
  records: RecordsView | null;
  /** Which form the login screen shows. */
  authMode: AuthMode;
  /** Username echoed back into the form after a failed attempt ('' initially). */
  authUsername: string;
  /**
   * E-mail address echoed back into the form. It is the sign-in identifier, so
   * the form keeps it after a failure just like the username.
   */
  authEmail: string;
  lastError: string;
  /** Raw lobby error code behind `lastError` (`''` when there is none). */
  authErrorCode: string;
  /**
   * True right after the lobby ended this session — either because the account
   * signed in on another device (`authErrorCode === 'session_replaced'`) or
   * because the session stopped being accepted without the server saying why
   * (`authErrorCode === 'session_expired'`). Cleared by any sign-in/out or
   * auth-mode change, exactly like `authErrorCode`. Lets the UI distinguish
   * "the session ended underneath us" from a generic failure without parsing
   * the error string.
   */
  sessionLost: boolean;
}

/** Which form the login screen renders. */
export type AuthMode = 'login' | 'register';

export type LobbyFlowListener = (snapshot: LobbyFlowSnapshot) => void;

/**
 * Human-readable matchmaking queue line for the lobby screen. Kept in the core
 * layer (no LayaAir types) so it can be unit-tested.
 */
export function describeMatchmakingQueue(snapshot: LobbyFlowSnapshot): string {
  const ticket = snapshot.matchmaking;
  if (ticket === null) {
    return t('flow.queueIdle');
  }
  const match = ticket.matchId === '' ? '' : ` → match ${ticket.matchId}`;
  const room = ticket.roomCode === '' ? '' : ` · room ${ticket.roomCode}`;
  return (
    t('flow.queueStatus', { status: ticket.queueStatus }) +
    `\nticket ${ticket.ticketId || '-'} · ${ticket.modeId || '-'}${match}${room}`
  );
}

export class LobbyFlow {
  private screen = LobbyScreen.Login;
  private statusText = t('flow.notConnected');
  private match: MatchStartInfo | null = null;
  private result: MatchResultInfo | null = null;
  private checkin: CheckinView | null = null;
  private shop: ShopView | null = null;
  private gacha: GachaPoolsView | null = null;
  private gachaRoster: CharacterRosterView | null = null;
  private gachaLastPull: GachaPullView | null = null;
  private inventory: InventoryView | null = null;
  private records: RecordsView | null = null;
  private authMode: AuthMode = 'login';
  private authUsername = '';
  private authEmail = '';
  private authErrorCode = '';
  private lastError = '';
  private sessionLost = false;
  private readonly listeners: LobbyFlowListener[] = [];

  /** The underlying client, exposed for secondary reads (decks, chests, …). */
  readonly client: LobbyClient;

  constructor(client: LobbyClient) {
    this.client = client;
    client.onEvent((event) => {
      switch (event.kind) {
        case 'room_state':
          this.statusText = t('flow.roomStatus', { code: event.room.roomCode, count: event.room.players.length });
          if (this.screen === LobbyScreen.Lobby || this.screen === LobbyScreen.Matching) {
            this.setScreen(LobbyScreen.Room);
          } else {
            this.notify();
          }
          break;
        case 'match_start':
          this.match = {
            matchId: event.matchId,
            serverSeedHex: event.serverSeedHex,
            endpoint: event.endpoint,
            playerIds: event.playerIds,
            playerId: event.playerId,
            modeId: this.client.room?.modeId ?? DEFAULT_MODE_ID,
            rulesetVersion: this.client.session?.rulesetVersion ?? '',
          };
          this.statusText = t('flow.matchStarting', { id: event.matchId });
          this.setScreen(LobbyScreen.Battle);
          break;
        case 'match_result':
          this.result = event.result;
          this.statusText = t('flow.matchResult', { winner: event.result.winnerPlayerId });
          this.setScreen(LobbyScreen.Result);
          break;
        case 'transport_closed':
          this.statusText = t('flow.transportClosed', { reason: event.reason });
          this.notify();
          break;
        case 'session_replaced':
          this.handleSessionLost(SESSION_REPLACED_CODE);
          break;
        case 'session_expired':
          this.handleSessionLost(SESSION_EXPIRED_CODE);
          break;
      }
    });
  }

  onChange(listener: LobbyFlowListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  snapshot(): LobbyFlowSnapshot {
    return {
      screen: this.screen,
      statusText: this.statusText,
      session: this.client.session,
      room: this.client.room,
      allocation: this.client.allocation,
      ticket: this.client.ticket,
      matchmaking: this.client.matchmakingTicket,
      match: this.match,
      result: this.result,
      checkin: this.checkin,
      shop: this.shop,
      gacha: this.gacha,
      gachaRoster: this.gachaRoster,
      gachaLastPull: this.gachaLastPull,
      inventory: this.inventory,
      records: this.records,
      authMode: this.authMode,
      authUsername: this.authUsername,
      authEmail: this.authEmail,
      lastError: this.lastError,
      authErrorCode: this.authErrorCode,
      sessionLost: this.sessionLost,
    };
  }

  get currentScreen(): LobbyScreen {
    return this.screen;
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private setScreen(screen: LobbyScreen): void {
    this.screen = screen;
    this.notify();
  }

  private fail(message: string): void {
    this.lastError = message;
    this.statusText = message;
    this.notify();
  }

  /** Login + bootstrap, then land on the lobby screen. */
  async signIn(displayName = 'Player'): Promise<boolean> {
    this.statusText = t('flow.signingIn');
    this.notify();
    const session = this.client.session ?? (await this.client.loginAnonymous(displayName));
    if (session === null) {
      this.authErrorCode = '';
      this.fail(t('flow.loginFailed', { reason: this.client.lastError }));
      return false;
    }
    this.statusText = t('flow.loadingProfile');
    this.notify();
    const bootstrapped = await this.client.bootstrap(session.rulesetVersion);
    if (bootstrapped === null) {
      this.client.clearSession();
      this.match = null;
      this.result = null;
      this.checkin = null;
      this.shop = null;
      this.inventory = null;
      this.records = null;
      this.setScreen(LobbyScreen.Login);
      this.fail(t('flow.bootstrapFailed', { reason: this.client.lastError || 'bootstrap_invalid_payload' }));
      return false;
    }
    if (this.sessionLost) {
      // The session ended while the profile was loading: the event handler has
      // already cleared it and returned to the login screen — do not land on
      // the lobby.
      return false;
    }
    this.statusText = t('flow.signedInAs', { name: this.client.session?.displayName ?? displayName });
    this.authErrorCode = '';
    this.sessionLost = false;
    this.setScreen(LobbyScreen.Lobby);
    return true;
  }

  /**
   * Re-composes the status line in the language that is active *now*.
   *
   * `statusText` is a finished string, composed when the event that produced it
   * happened — so a language switch leaves every line the player can see
   * stuck in the previous language, because replaying the snapshot only
   * re-reads the old text. The lobby calls this from its own language repaint,
   * before it re-reads the snapshot.
   *
   * Only the sign-in line is re-derived: it is the one whose text is stored
   * rather than re-derived on every read. Anything else (queue status, room
   * status, match results) is produced by an event the player triggers again,
   * and re-deriving those here would overwrite a fresher message.
   */
  refreshStatusLineLanguage(): void {
    if (this.client.session === null || this.screen !== LobbyScreen.Lobby) {
      return;
    }
    // Both sign-in paths compose this same key, so re-composing it is safe in
    // either case. Guarded by the screen so a status line set on the login
    // screen ("signing in…", a failure) is never overwritten.
    this.statusText = t('flow.signedInAs', { name: this.client.session.displayName });
    this.notify();
  }

  /** Flips the login screen between sign-in and sign-up. */
  setAuthMode(mode: AuthMode): void {
    this.authMode = mode;
    this.lastError = '';
    this.authErrorCode = '';
    this.sessionLost = false;
    this.notify();
  }

  /**
   * Account sign-in (`auth.login`). Loads the profile and lands on the lobby.
   * Rejects empty credentials locally so the form can show the reason without
   * a round-trip. The e-mail address is the sign-in identifier.
   */
  async signInWithAccount(email: string, password: string): Promise<boolean> {
    const address = email.trim();
    if (address === '' || password === '') {
      this.authErrorCode = '';
      this.fail(t('flow.enterEmailPassword'));
      return false;
    }
    // Echo the address back so the form keeps it after a failed attempt.
    this.authEmail = address;
    this.statusText = t('flow.signingIn');
    this.notify();
    const session = await this.client.loginAccount(address, password);
    if (session === null) {
      // Keep `client.lastError` as the raw code; only the player-facing text is
      // translated, so callers that inspect the code still see it verbatim.
      const code = this.client.lastError;
      this.authErrorCode = code;
      this.fail(code !== '' ? describeAuthError(code) : t('flow.signInFailed'));
      return false;
    }
    this.statusText = t('flow.loadingProfile');
    this.notify();
    await this.client.bootstrap(session.rulesetVersion);
    if (this.sessionLost) {
      // The session ended while the profile was loading — stay on the login
      // screen.
      return false;
    }
    this.statusText = t('flow.signedInAs', { name: this.client.session?.displayName || address });
    this.lastError = '';
    this.authErrorCode = '';
    this.sessionLost = false;
    this.setScreen(LobbyScreen.Lobby);
    return true;
  }

  /**
   * Asks the lobby to mail a registration verification code (`auth.emailCode`).
   *
   * Returns the delay the caller must observe before offering "send again"
   * (`resendInSeconds`, 0 when the send failed). The address is echoed back so a
   * failure does not clear what the player typed.
   */
  async requestEmailCode(email: string): Promise<{ ok: boolean; resendInSeconds: number }> {
    const address = email.trim();
    if (address === '') {
      this.authErrorCode = '';
      this.fail(t('flow.enterEmail'));
      return { ok: false, resendInSeconds: 0 };
    }
    this.authEmail = address;
    this.statusText = t('flow.sendingCode');
    this.notify();
    const receipt = await this.client.requestEmailCode(address);
    if (receipt === null) {
      const code = this.client.lastError;
      this.authErrorCode = code;
      this.fail(code !== '' ? describeAuthError(code) : t('flow.codeSendFailed'));
      return { ok: false, resendInSeconds: 0 };
    }
    this.lastError = '';
    this.authErrorCode = '';
    this.statusText = t('flow.codeSent', { email: receipt.email });
    this.notify();
    return { ok: true, resendInSeconds: receipt.resendInSeconds };
  }

  /**
   * Creates an account (`auth.register`) and signs it in. The server verifies
   * the e-mailed `code` before it creates anything, so a missing or stale code
   * comes back as a normal coded failure. The server returns a session
   * directly, so no separate sign-in step is needed.
   */
  async registerAccount(
    username: string,
    email: string,
    password: string,
    code: string,
    displayName = '',
  ): Promise<boolean> {
    const user = username.trim();
    const address = email.trim();
    if (user === '' || address === '' || password === '') {
      this.authErrorCode = '';
      this.fail(t('flow.enterUsernameEmailPassword'));
      return false;
    }
    if (code.trim() === '') {
      this.authErrorCode = 'verification_code_required';
      this.fail(describeAuthError('verification_code_required'));
      return false;
    }
    this.authUsername = user;
    this.authEmail = address;
    this.statusText = t('flow.creatingAccount');
    this.notify();
    // An empty display name falls back to the username so the account is never
    // nameless in the lobby.
    const session = await this.client.registerAccount(
      user,
      address,
      password,
      code.trim(),
      displayName.trim() || user,
    );
    if (session === null) {
      // As in `signInWithAccount`: translate only the player-facing text.
      const failure = this.client.lastError;
      this.authErrorCode = failure;
      this.fail(failure !== '' ? describeAuthError(failure) : t('flow.signUpFailed'));
      return false;
    }
    this.statusText = t('flow.loadingProfile');
    this.notify();
    await this.client.bootstrap(session.rulesetVersion);
    if (this.sessionLost) {
      // The session ended while the profile was loading — stay on the login
      // screen.
      return false;
    }
    this.statusText = t('flow.accountCreated', { name: this.client.session?.displayName || user });
    this.lastError = '';
    this.authErrorCode = '';
    this.sessionLost = false;
    this.setScreen(LobbyScreen.Lobby);
    return true;
  }

  /** Drops the local session and returns to the login screen. */
  signOut(): void {
    this.client.logout();
    this.match = null;
    this.result = null;
    this.checkin = null;
    this.shop = null;
    this.inventory = null;
    this.authMode = 'login';
    this.authUsername = '';
    this.lastError = '';
    this.authErrorCode = '';
    this.sessionLost = false;
    this.statusText = t('flow.signedOut');
    this.setScreen(LobbyScreen.Login);
  }

  /** Returns to the login screen without clearing the session. */
  showLogin(): void {
    this.authMode = 'login';
    this.lastError = '';
    this.authErrorCode = '';
    this.sessionLost = false;
    this.setScreen(LobbyScreen.Login);
  }

  /**
   * Handles the lobby ending this session. `code` is either
   * {@link SESSION_REPLACED_CODE} (the account signed in elsewhere and the
   * server said so explicitly) or {@link SESSION_EXPIRED_CODE} (the lobby
   * stopped accepting the session without saying why). Reuses the sign-out
   * teardown, then surfaces the reason on the login screen so the player knows
   * why they were sent back.
   *
   * Idempotent: the WS push and a REST `401` can both report the same loss, and
   * the flag is cleared by `signOut()`/`showLogin()`, so the second report is a
   * no-op.
   */
  private handleSessionLost(code: string): void {
    if (this.sessionLost) {
      return;
    }
    this.signOut();
    this.sessionLost = true;
    this.authErrorCode = code;
    this.lastError = describeAuthError(code);
    this.statusText = this.lastError;
    this.notify();
  }

  async createRoom(
    roomCode: string,
    modeId = DEFAULT_MODE_ID,
    options: RoomCreateOptions = {},
  ): Promise<boolean> {
    this.statusText = t('flow.creatingRoom', { code: roomCode });
    this.notify();
    const room = await this.client.createRoom(roomCode, modeId, options);
    if (room === null) {
      this.fail(t('flow.createRoomFailed', { error: this.client.lastError }));
      return false;
    }
    // `rooms.create` answers with a *queue* response: it carries the room code
    // the server minted, but no player list or host id. Fetching the room
    // state right away means the UI shows the real roster (and the server's
    // code) instead of an empty list, and it is also the only way the player
    // learns the code they have to share.
    await this.client.refreshRoom();
    this.setScreen(LobbyScreen.Room);
    return true;
  }

  async joinRoom(roomCode: string, options: RoomJoinOptions = {}): Promise<boolean> {
    this.statusText = t('flow.joiningRoom', { code: roomCode });
    this.notify();
    const room = await this.client.joinRoom(roomCode, options);
    if (room === null) {
      this.fail(t('flow.joinRoomFailed', { error: this.client.lastError }));
      return false;
    }
    // Same as `createRoom`: the join answer is a queue response, so the roster
    // only shows up after a `rooms.get`.
    await this.client.refreshRoom();
    this.setScreen(LobbyScreen.Room);
    return true;
  }

  async leaveRoom(): Promise<void> {
    await this.client.leaveRoom();
    this.statusText = t('flow.room.left');
    this.setScreen(LobbyScreen.Lobby);
  }

  /**
   * 房主在房间等待界面重配 boss / 自机（任务「boss 选择 + 自机机制」）。
   *
   * 服务端把 boss 固定在**建房**时刻（`rooms.create`），没有「改房间 boss」的
   * RPC，所以这里用「离房 → 以新配置重建」实现。为不打扰已加入的 guest，
   * **仅当房主独自一人时**允许；否则返回 false 并给出提示。
   */
  async reconfigureRoom(options: RoomCreateOptions): Promise<boolean> {
    const room = this.client.room;
    if (room === null) {
      this.fail(t('flow.room.noRoom'));
      return false;
    }
    if (room.players.length > 1) {
      this.fail(t('flow.room.bossLocked'));
      return false;
    }
    const code = room.roomCode;
    const modeId = room.modeId || DEFAULT_MODE_ID;
    this.statusText = t('flow.room.reconfiguring');
    this.notify();
    await this.client.leaveRoom('reconfigure');
    const recreated = await this.client.createRoom(code, modeId, options);
    if (recreated === null) {
      this.fail(t('flow.room.reconfigureFailed', { error: this.client.lastError }));
      return false;
    }
    this.statusText = t('flow.room.ready', { code: recreated.roomCode });
    this.setScreen(LobbyScreen.Room);
    return true;
  }

  /**
   * Enqueue for a mode (`matchmaking.join`). The queue lives on the lobby
   * screen — the server, not the client, decides when a match is found, so the
   * status text shows the ticket until a `match_start` event arrives.
   */
  async joinMatchmaking(modeId = DEFAULT_MODE_ID): Promise<boolean> {
    this.statusText = t('flow.queue.joining');
    this.notify();
    const ticket = await this.client.joinMatchmaking(modeId);
    if (ticket === null) {
      this.fail(t('flow.queue.joinFailed', { error: this.client.lastError }));
      return false;
    }
    this.statusText = t('flow.queue.queued', { id: ticket.ticketId, status: ticket.queueStatus });
    this.notify();
    return true;
  }

  /** Re-poll the active queue ticket for a found match. */
  async refreshMatchmakingTicket(): Promise<boolean> {
    if (this.client.matchmakingTicket === null) {
      this.fail(t('flow.queue.notQueued'));
      return false;
    }
    const updated = await this.client.fetchMatchmakingTicket();
    if (updated === null) {
      this.fail(t('flow.queue.pollFailed', { error: this.client.lastError }));
      return false;
    }
    const suffix = updated.matchId === '' ? '' : ` → match ${updated.matchId}`;
    this.statusText = t('flow.queue.status', { id: updated.ticketId, status: updated.queueStatus, suffix });
    this.notify();
    return true;
  }

  /** Leave the matchmaking queue (`matchmaking.cancel`). */
  async cancelMatchmaking(): Promise<boolean> {
    if (this.client.matchmakingTicket === null) {
      this.statusText = t('flow.queue.notQueued');
      this.notify();
      return false;
    }
    const ok = await this.client.cancelMatchmaking();
    if (!ok) {
      this.fail(t('flow.queue.cancelFailed', { error: this.client.lastError }));
      return false;
    }
    this.statusText = t('flow.queue.left');
    this.notify();
    return true;
  }

  /** Ready up and start polling for the allocation + signed battle ticket. */
  async ready(): Promise<boolean> {
    this.statusText = t('flow.match.readyWaitingMatch');
    this.setScreen(LobbyScreen.Matching);
    // A `match_start` push carries the match id on WS deployments; on Nakama
    // RPC there is no push, so the room snapshot's `match_id` (surfaced by
    // `refreshRoom` once the room filled) is the only source. Both are tried
    // before declaring "still waiting for players".
    const matchId = this.match?.matchId ?? this.client.room?.matchId ?? '';
    if (matchId === '') {
      // No match exists yet: the lobby creates it (and pushes `match_start`)
      // once the room fills, so there is nothing to acknowledge here. Ready is
      // purely a local "I'm set" signal at this point.
      this.statusText = t('flow.match.readyWaitingPlayers');
      this.notify();
      return true;
    }
    const ok = await this.client.readyMatch(matchId);
    if (!ok) {
      this.fail(t('flow.match.readyFailed', { error: this.client.lastError }));
      return false;
    }
    // Best effort: `match_start` already carries the endpoint and roster id, so
    // these only refine what we know. A failure must not abort the transition.
    await this.client.fetchBattleAllocation(matchId);
    await this.client.fetchBattleTicket(matchId);
    this.notify();
    return true;
  }

  /** Returns to the lobby after a settled match. */
  backToLobby(): void {
    this.match = null;
    this.result = null;
    this.statusText = t('flow.match.backInLobby');
    this.setScreen(LobbyScreen.Lobby);
  }

  /**
   * The player chose to disconnect from the in-match screen (T10 rule 3).
   *
   * Sends the explicit `abandon` intent so the lobby settles the match at once
   * with no score, then leaves the match through the existing navigation
   * ({@link backToLobby}). The client does not decide the winner or the score.
   * A failure surfaces on the battle screen and does NOT leave it, so the
   * player is never dropped out of a match the lobby still thinks is live.
   */
  async abandonMatch(): Promise<boolean> {
    const matchId = this.match?.matchId ?? '';
    if (matchId === '') {
      this.fail(t('flow.match.noMatchToAbandon'));
      return false;
    }
    this.statusText = t('flow.match.leaving');
    this.notify();
    const view = await this.client.disconnectMatch(matchId, 'abandon');
    if (view === null) {
      this.fail(t('flow.match.abandonFailed', { error: this.client.lastError }));
      return false;
    }
    this.statusText = t('flow.match.abandoned', { id: matchId });
    this.backToLobby();
    return true;
  }

  /**
   * Auto-reconnect on entering a match (T10 rule 4).
   *
   * Reads the lobby snapshot and, **only** when it reports the local player as
   * disconnected, asks the lobby to reconnect and returns the tick the battle
   * layer must resync to. A connected player (or a failed reconnect) returns
   * `null` — the caller must not invent a tick nor present the player as alive.
   */
  async resumeMatch(matchId = ''): Promise<number | null> {
    const id = matchId !== '' ? matchId : this.match?.matchId ?? '';
    if (id === '') {
      return null;
    }
    const snapshot = await this.client.fetchMatchSnapshot(id);
    if (snapshot === null || snapshot.localConnected) {
      // Connected, or the snapshot is unreadable: nothing to resume, and no
      // reconnect call is made.
      return null;
    }
    const view = await this.client.reconnectMatch(id);
    if (view === null || !view.connected) {
      // The lobby refused the reconnect: the player stays disconnected.
      return null;
    }
    return view.tick;
  }

  /** Convenience for demos/tests: drive the flow straight to the battle screen. */
  enterBattle(info: MatchStartInfo): void {
    this.match = info;
    this.statusText = t('flow.match.info', { id: info.matchId });
    this.setScreen(LobbyScreen.Battle);
  }

  /** Apply a result received outside `LobbyClient` (e.g. from the battle server). */
  applyResult(info: MatchResultInfo): void {
    this.result = info;
    this.statusText = t('flow.match.winner', { id: info.winnerPlayerId });
    this.setScreen(LobbyScreen.Result);
  }

  // --- check-in / shop / inventory -----------------------------------------

  /** Opens the check-in screen and loads the 7-day cycle. */
  async openCheckin(): Promise<boolean> {
    this.statusText = t('flow.checkin.loading');
    this.setScreen(LobbyScreen.Checkin);
    const view = await this.client.fetchCheckin();
    if (view === null) {
      this.fail(t('flow.checkin.loadFailed', { error: this.client.lastError }));
      return false;
    }
    this.checkin = view;
    this.lastError = '';
    this.statusText = t('flow.checkin.streak', { streak: view.streak });
    this.notify();
    return true;
  }

  /** Claims today's check-in reward and refreshes the cycle. */
  async claimCheckin(): Promise<boolean> {
    const claim = await this.client.claimCheckin();
    if (claim === null) {
      this.fail(t('flow.checkin.claimFailed', { error: this.client.lastError }));
      return false;
    }
    this.lastError = '';
    this.statusText = t('flow.checkin.claimed', { day: claim.day, streak: claim.streak });
    this.notify();
    // Re-read the cycle so the claimed day flips to `claimed` and the next day
    // becomes `claimable` — the claim response does not carry the day list.
    await this.openCheckin();
    return true;
  }

  /** Opens the shop and loads the listings plus the wallet. */
  async openShop(): Promise<boolean> {
    this.statusText = t('flow.shop.loading');
    this.setScreen(LobbyScreen.Shop);
    const view = await this.client.fetchShop();
    if (view === null) {
      this.fail(t('flow.shop.loadFailed', { error: this.client.lastError }));
      return false;
    }
    this.shop = view;
    this.lastError = '';
    this.statusText = t('flow.shop.summary', { count: view.items.length });
    this.notify();
    return true;
  }

  /** Buys `count` of an item and refreshes the shop. */
  async purchaseItem(itemId: string, count = 1): Promise<boolean> {
    const purchase = await this.client.purchaseShopItem(itemId, count);
    if (purchase === null) {
      this.fail(t('flow.shop.purchaseFailed', { error: this.client.lastError }));
      return false;
    }
    this.lastError = '';
    this.statusText = t('flow.shop.bought', { count: purchase.count, item: purchase.itemId });
    this.notify();
    await this.openShop();
    return true;
  }

  /**
   * Opens the gacha screen: loads both pools, the wallet, the pity counters
   * and the character roster.
   */
  async openGacha(): Promise<boolean> {
    this.statusText = t('flow.gacha.loading');
    this.setScreen(LobbyScreen.Gacha);
    const pools = await this.client.fetchGachaPools();
    if (pools === null) {
      this.fail(t('flow.gacha.loadFailed', { error: this.client.lastError }));
      return false;
    }
    const roster = await this.client.fetchGachaRoster();
    if (roster === null) {
      this.fail(t('flow.gacha.rosterFailed', { error: this.client.lastError }));
      return false;
    }
    this.gacha = pools;
    this.gachaRoster = roster;
    this.lastError = '';
    this.statusText = `Totems: ${pools.pools.length} pool(s) · ${roster.shots.length} shot(s) · faith ${roster.faith}`;
    this.notify();
    return true;
  }

  /**
   * Pulls from a gacha pool (1 or 10). The server rolls; the flow only keeps
   * the response so the scene can render it.
   */
  async pullGacha(poolId: string, count: number): Promise<boolean> {
    const pull = await this.client.pullGacha(poolId, count);
    if (pull === null) {
      this.fail(t('flow.gacha.pullFailed', { error: this.client.lastError }));
      return false;
    }
    this.gachaLastPull = pull;
    if (this.gacha !== null) {
      this.gacha = { ...this.gacha, wallet: pull.wallet, faith: pull.faith };
    }
    this.gachaRoster = pull.characters;
    this.lastError = '';
    this.statusText =
      count === 1
        ? t('flow.gacha.pulledOne', { pool: pull.poolId })
        : t('flow.gacha.pulledMany', { count: pull.count, pool: pull.poolId });
    this.notify();
    return true;
  }

  /** Unlocks one locked shot with faith and refreshes the roster. */
  async exchangeGachaFaith(itemId: string): Promise<boolean> {
    const exchange = await this.client.exchangeGachaFaith(itemId);
    if (exchange === null) {
      this.fail(t('flow.gacha.exchangeFailed', { error: this.client.lastError }));
      return false;
    }
    this.gachaRoster = exchange.characters;
    this.gachaLastPull = null;
    if (this.gacha !== null) {
      this.gacha = { ...this.gacha, wallet: exchange.wallet, faith: exchange.faith };
    }
    this.lastError = '';
    this.statusText = t('flow.gacha.unlocked', { item: exchange.itemId, faith: exchange.faithSpent });
    this.notify();
    return true;
  }

  /** Opens the inventory screen and loads the owned card stacks. */
  async openInventory(): Promise<boolean> {
    this.statusText = t('flow.inventory.loading');
    this.setScreen(LobbyScreen.Inventory);
    const view = await this.client.fetchInventory();
    if (view === null) {
      this.fail(t('flow.inventory.loadFailed', { error: this.client.lastError }));
      return false;
    }
    this.inventory = view;
    this.lastError = '';
    this.statusText = t('flow.inventory.summary', { count: view.items.length });
    this.notify();
    return true;
  }

  /** Opens the records screen and loads the personal record dashboard. */
  async openRecords(): Promise<boolean> {
    this.statusText = t('flow.records.loading');
    this.setScreen(LobbyScreen.Records);
    const view = await this.client.fetchRecords();
    if (view === null) {
      this.fail(t('flow.records.loadFailed', { error: this.client.lastError }));
      return false;
    }
    this.records = view;
    this.lastError = '';
    this.statusText = t('flow.records.summary', { wins: view.wins, losses: view.losses, draws: view.draws });
    this.notify();
    return true;
  }
}
