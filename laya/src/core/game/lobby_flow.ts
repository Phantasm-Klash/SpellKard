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
  CheckinView,
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

export enum LobbyScreen {
  Login = 'login',
  Lobby = 'lobby',
  Room = 'room',
  Matching = 'matching',
  Battle = 'battle',
  Result = 'result',
  Checkin = 'checkin',
  Shop = 'shop',
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
    return 'Matchmaking queue: idle';
  }
  const match = ticket.matchId === '' ? '' : ` → match ${ticket.matchId}`;
  const room = ticket.roomCode === '' ? '' : ` · room ${ticket.roomCode}`;
  return (
    `Matchmaking queue: ${ticket.queueStatus}\n` +
    `ticket ${ticket.ticketId || '-'} · ${ticket.modeId || '-'}${match}${room}`
  );
}

export class LobbyFlow {
  private screen = LobbyScreen.Login;
  private statusText = 'Not connected';
  private match: MatchStartInfo | null = null;
  private result: MatchResultInfo | null = null;
  private checkin: CheckinView | null = null;
  private shop: ShopView | null = null;
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
          this.statusText = `Room ${event.room.roomCode}: ${event.room.players.length} player(s)`;
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
          this.statusText = `Match ${event.matchId} starting`;
          this.setScreen(LobbyScreen.Battle);
          break;
        case 'match_result':
          this.result = event.result;
          this.statusText = `Winner: ${event.result.winnerPlayerId}`;
          this.setScreen(LobbyScreen.Result);
          break;
        case 'transport_closed':
          this.statusText = `Lobby transport closed: ${event.reason}`;
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
    this.statusText = 'Signing in…';
    this.notify();
    const session = this.client.session ?? (await this.client.loginAnonymous(displayName));
    if (session === null) {
      this.authErrorCode = '';
      this.fail(`Login failed: ${this.client.lastError}`);
      return false;
    }
    this.statusText = 'Loading profile…';
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
      this.fail(`Bootstrap failed: ${this.client.lastError || 'bootstrap_invalid_payload'}`);
      return false;
    }
    if (this.sessionLost) {
      // The session ended while the profile was loading: the event handler has
      // already cleared it and returned to the login screen — do not land on
      // the lobby.
      return false;
    }
    this.statusText = `Signed in as ${this.client.session?.displayName ?? displayName}`;
    this.authErrorCode = '';
    this.sessionLost = false;
    this.setScreen(LobbyScreen.Lobby);
    return true;
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
      this.fail('Enter your e-mail and password');
      return false;
    }
    // Echo the address back so the form keeps it after a failed attempt.
    this.authEmail = address;
    this.statusText = 'Signing in…';
    this.notify();
    const session = await this.client.loginAccount(address, password);
    if (session === null) {
      // Keep `client.lastError` as the raw code; only the player-facing text is
      // translated, so callers that inspect the code still see it verbatim.
      const code = this.client.lastError;
      this.authErrorCode = code;
      this.fail(code !== '' ? describeAuthError(code) : 'Sign-in failed');
      return false;
    }
    this.statusText = 'Loading profile…';
    this.notify();
    await this.client.bootstrap(session.rulesetVersion);
    if (this.sessionLost) {
      // The session ended while the profile was loading — stay on the login
      // screen.
      return false;
    }
    this.statusText = `Signed in as ${this.client.session?.displayName || address}`;
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
      this.fail('Enter your e-mail address');
      return { ok: false, resendInSeconds: 0 };
    }
    this.authEmail = address;
    this.statusText = 'Sending verification code…';
    this.notify();
    const receipt = await this.client.requestEmailCode(address);
    if (receipt === null) {
      const code = this.client.lastError;
      this.authErrorCode = code;
      this.fail(code !== '' ? describeAuthError(code) : 'Could not send the code');
      return { ok: false, resendInSeconds: 0 };
    }
    this.lastError = '';
    this.authErrorCode = '';
    this.statusText = `Verification code sent to ${receipt.email}`;
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
      this.fail('Enter a username, e-mail and password');
      return false;
    }
    if (code.trim() === '') {
      this.authErrorCode = 'verification_code_required';
      this.fail(describeAuthError('verification_code_required'));
      return false;
    }
    this.authUsername = user;
    this.authEmail = address;
    this.statusText = 'Creating account…';
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
      this.fail(failure !== '' ? describeAuthError(failure) : 'Sign-up failed');
      return false;
    }
    this.statusText = 'Loading profile…';
    this.notify();
    await this.client.bootstrap(session.rulesetVersion);
    if (this.sessionLost) {
      // The session ended while the profile was loading — stay on the login
      // screen.
      return false;
    }
    this.statusText = `Account created — signed in as ${this.client.session?.displayName || user}`;
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
    this.statusText = 'Signed out';
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
    this.statusText = `Creating room ${roomCode}…`;
    this.notify();
    const room = await this.client.createRoom(roomCode, modeId, options);
    if (room === null) {
      this.fail(`Create room failed: ${this.client.lastError}`);
      return false;
    }
    this.setScreen(LobbyScreen.Room);
    return true;
  }

  async joinRoom(roomCode: string, options: RoomJoinOptions = {}): Promise<boolean> {
    this.statusText = `Joining room ${roomCode}…`;
    this.notify();
    const room = await this.client.joinRoom(roomCode, options);
    if (room === null) {
      this.fail(`Join room failed: ${this.client.lastError}`);
      return false;
    }
    this.setScreen(LobbyScreen.Room);
    return true;
  }

  async leaveRoom(): Promise<void> {
    await this.client.leaveRoom();
    this.statusText = 'Left room';
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
      this.fail('No room to reconfigure');
      return false;
    }
    if (room.players.length > 1) {
      this.fail('Boss/loadout can only change while you are alone in the room');
      return false;
    }
    const code = room.roomCode;
    const modeId = room.modeId || DEFAULT_MODE_ID;
    this.statusText = 'Reconfiguring room…';
    this.notify();
    await this.client.leaveRoom('reconfigure');
    const recreated = await this.client.createRoom(code, modeId, options);
    if (recreated === null) {
      this.fail(`Reconfigure failed: ${this.client.lastError}`);
      return false;
    }
    this.statusText = `Room ${recreated.roomCode} ready`;
    this.setScreen(LobbyScreen.Room);
    return true;
  }

  /**
   * Enqueue for a mode (`matchmaking.join`). The queue lives on the lobby
   * screen — the server, not the client, decides when a match is found, so the
   * status text shows the ticket until a `match_start` event arrives.
   */
  async joinMatchmaking(modeId = DEFAULT_MODE_ID): Promise<boolean> {
    this.statusText = 'Joining matchmaking queue…';
    this.notify();
    const ticket = await this.client.joinMatchmaking(modeId);
    if (ticket === null) {
      this.fail(`Matchmaking join failed: ${this.client.lastError}`);
      return false;
    }
    this.statusText = `In queue ${ticket.ticketId} (${ticket.queueStatus})`;
    this.notify();
    return true;
  }

  /** Re-poll the active queue ticket for a found match. */
  async refreshMatchmakingTicket(): Promise<boolean> {
    if (this.client.matchmakingTicket === null) {
      this.fail('Not in a matchmaking queue');
      return false;
    }
    const updated = await this.client.fetchMatchmakingTicket();
    if (updated === null) {
      this.fail(`Queue poll failed: ${this.client.lastError}`);
      return false;
    }
    const suffix = updated.matchId === '' ? '' : ` → match ${updated.matchId}`;
    this.statusText = `Queue ${updated.ticketId}: ${updated.queueStatus}${suffix}`;
    this.notify();
    return true;
  }

  /** Leave the matchmaking queue (`matchmaking.cancel`). */
  async cancelMatchmaking(): Promise<boolean> {
    if (this.client.matchmakingTicket === null) {
      this.statusText = 'Not in a matchmaking queue';
      this.notify();
      return false;
    }
    const ok = await this.client.cancelMatchmaking();
    if (!ok) {
      this.fail(`Queue cancel failed: ${this.client.lastError}`);
      return false;
    }
    this.statusText = 'Left matchmaking queue';
    this.notify();
    return true;
  }

  /** Ready up and start polling for the allocation + signed battle ticket. */
  async ready(): Promise<boolean> {
    this.statusText = 'Ready — waiting for match…';
    this.setScreen(LobbyScreen.Matching);
    const matchId = this.match?.matchId ?? '';
    if (matchId === '') {
      // No match exists yet: the lobby creates it (and pushes `match_start`)
      // once the room fills, so there is nothing to acknowledge here. Ready is
      // purely a local "I'm set" signal at this point.
      this.statusText = 'Ready — waiting for players…';
      this.notify();
      return true;
    }
    const ok = await this.client.readyMatch(matchId);
    if (!ok) {
      this.fail(`Ready failed: ${this.client.lastError}`);
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
    this.statusText = 'Back in lobby';
    this.setScreen(LobbyScreen.Lobby);
  }

  /** Convenience for demos/tests: drive the flow straight to the battle screen. */
  enterBattle(info: MatchStartInfo): void {
    this.match = info;
    this.statusText = `Match ${info.matchId}`;
    this.setScreen(LobbyScreen.Battle);
  }

  /** Apply a result received outside `LobbyClient` (e.g. from the battle server). */
  applyResult(info: MatchResultInfo): void {
    this.result = info;
    this.statusText = `Winner: ${info.winnerPlayerId}`;
    this.setScreen(LobbyScreen.Result);
  }

  // --- check-in / shop / inventory -----------------------------------------

  /** Opens the check-in screen and loads the 7-day cycle. */
  async openCheckin(): Promise<boolean> {
    this.statusText = 'Loading check-in…';
    this.setScreen(LobbyScreen.Checkin);
    const view = await this.client.fetchCheckin();
    if (view === null) {
      this.fail(`Check-in load failed: ${this.client.lastError}`);
      return false;
    }
    this.checkin = view;
    this.lastError = '';
    this.statusText = `Check-in: ${view.streak}-day streak`;
    this.notify();
    return true;
  }

  /** Claims today's check-in reward and refreshes the cycle. */
  async claimCheckin(): Promise<boolean> {
    const claim = await this.client.claimCheckin();
    if (claim === null) {
      this.fail(`Check-in claim failed: ${this.client.lastError}`);
      return false;
    }
    this.lastError = '';
    this.statusText = `Claimed day ${claim.day} · streak ${claim.streak}`;
    this.notify();
    // Re-read the cycle so the claimed day flips to `claimed` and the next day
    // becomes `claimable` — the claim response does not carry the day list.
    await this.openCheckin();
    return true;
  }

  /** Opens the shop and loads the listings plus the wallet. */
  async openShop(): Promise<boolean> {
    this.statusText = 'Loading shop…';
    this.setScreen(LobbyScreen.Shop);
    const view = await this.client.fetchShop();
    if (view === null) {
      this.fail(`Shop load failed: ${this.client.lastError}`);
      return false;
    }
    this.shop = view;
    this.lastError = '';
    this.statusText = `Shop: ${view.items.length} item(s)`;
    this.notify();
    return true;
  }

  /** Buys `count` of an item and refreshes the shop. */
  async purchaseItem(itemId: string, count = 1): Promise<boolean> {
    const purchase = await this.client.purchaseShopItem(itemId, count);
    if (purchase === null) {
      this.fail(`Purchase failed: ${this.client.lastError}`);
      return false;
    }
    this.lastError = '';
    this.statusText = `Bought ${purchase.count}× ${purchase.itemId}`;
    this.notify();
    await this.openShop();
    return true;
  }

  /** Opens the inventory screen and loads the owned card stacks. */
  async openInventory(): Promise<boolean> {
    this.statusText = 'Loading inventory…';
    this.setScreen(LobbyScreen.Inventory);
    const view = await this.client.fetchInventory();
    if (view === null) {
      this.fail(`Inventory load failed: ${this.client.lastError}`);
      return false;
    }
    this.inventory = view;
    this.lastError = '';
    this.statusText = `Inventory: ${view.items.length} stack(s)`;
    this.notify();
    return true;
  }

  /** Opens the records screen and loads the personal record dashboard. */
  async openRecords(): Promise<boolean> {
    this.statusText = 'Loading records…';
    this.setScreen(LobbyScreen.Records);
    const view = await this.client.fetchRecords();
    if (view === null) {
      this.fail(`Records load failed: ${this.client.lastError}`);
      return false;
    }
    this.records = view;
    this.lastError = '';
    this.statusText = `Records: ${view.wins}W-${view.losses}L-${view.draws}D`;
    this.notify();
    return true;
  }
}
