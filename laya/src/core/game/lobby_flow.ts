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
  LobbyClient,
  MatchmakingTicketView,
  RoomView,
  SessionState,
} from '../net/lobby_client';

export enum LobbyScreen {
  Login = 'login',
  Lobby = 'lobby',
  Room = 'room',
  Matching = 'matching',
  Battle = 'battle',
  Result = 'result',
  Error = 'error',
}

export interface MatchStartInfo {
  matchId: string;
  serverSeedHex: string;
  endpoint: string;
  playerIds: string[];
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
  lastError: string;
}

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
  private lastError = '';
  private readonly listeners: LobbyFlowListener[] = [];

  constructor(private readonly client: LobbyClient) {
    this.client.onEvent((event) => {
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
            modeId: this.client.room?.modeId ?? 'mvp_boss_race',
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
      lastError: this.lastError,
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
    const session = await this.client.loginAnonymous(displayName);
    if (session === null) {
      this.fail(`Login failed: ${this.client.lastError}`);
      return false;
    }
    this.statusText = 'Loading profile…';
    this.notify();
    await this.client.bootstrap(session.rulesetVersion);
    this.statusText = `Signed in as ${this.client.session?.displayName ?? displayName}`;
    this.setScreen(LobbyScreen.Lobby);
    return true;
  }

  async createRoom(roomCode: string, modeId = 'mvp_boss_race'): Promise<boolean> {
    this.statusText = `Creating room ${roomCode}…`;
    this.notify();
    const room = await this.client.createRoom(roomCode, modeId);
    if (room === null) {
      this.fail(`Create room failed: ${this.client.lastError}`);
      return false;
    }
    this.setScreen(LobbyScreen.Room);
    return true;
  }

  async joinRoom(roomCode: string): Promise<boolean> {
    this.statusText = `Joining room ${roomCode}…`;
    this.notify();
    const room = await this.client.joinRoom(roomCode);
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
   * Enqueue for a mode (`matchmaking.join`). The queue lives on the lobby
   * screen — the server, not the client, decides when a match is found, so the
   * status text shows the ticket until a `match_start` event arrives.
   */
  async joinMatchmaking(modeId = 'mvp_boss_race'): Promise<boolean> {
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
    const ok = await this.client.readyMatch(this.match?.matchId ?? '');
    if (!ok) {
      this.fail(`Ready failed: ${this.client.lastError}`);
      return false;
    }
    await this.client.fetchBattleAllocation();
    await this.client.fetchBattleTicket();
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
}
