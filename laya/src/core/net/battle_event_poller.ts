/**
 * REST poller that feeds the lobby's match-event stream to the battle scene.
 *
 * ★ Why REST and not the lobby transport the client already has: `match.events`
 * is a **forbidden operation on the Nakama RPC path** — a client session that
 * asks for it over that transport gets `403 client_operation_disallowed`
 * (server: `runtime/nakamaapi/handler_test.go`, `match.events` sits in the same
 * forbidden list as `match.input` / `battle.*`). The deployed transport may be
 * `nakama_rpc`, so every fetch must go through a REST transport; the source
 * injected here is expected to be backed by
 * `LobbyClient.fetchMatchEvents` running on the REST transport. A silent 403
 * would only manifest as "the performance is out of sync", which is why the
 * wiring layer passes the REST transport explicitly.
 *
 * The poller is deliberately transport-free: `MatchEventsSource` is the one
 * method it needs, `TimerLike` the only ambient service, so the loop is
 * unit-testable with stubs and no wall clock.
 *
 * Loop contract:
 *  - the cursor starts at 0 (the server reads `after=0` as "from the oldest
 *    event it still retains") and advances to each page's `cursor`;
 *  - a page with `hasMore` is drained immediately — the next fetch happens in
 *    the same tick, not after the interval — but at most {@link MAX_DRAIN_PAGES}
 *    pages per tick, so a huge backlog cannot hot-loop;
 *  - a response whose `oldestCursor` is ahead of the cursor we asked with means
 *    the server dropped events while we were behind: `onGap` fires once and
 *    the cursor resyncs to the page's cursor (the app layer then rebuilds
 *    state from `match.snapshot`);
 *  - a source rejection never escapes: `onError` fires and the timer stays
 *    alive so the next interval retries.
 *
 * NOTE: `core/` only — never import Laya or platform code from here.
 */

import type { MatchEventView } from '../game/battle_events';

/** One page of the event stream, as `GET /v1/matches/{id}/events` returns it. */
export interface MatchEventsPage {
  events: MatchEventView[];
  /** Cursor to resume from (seq of the last event in the page). */
  cursor: number;
  /** True while the server still holds events past `cursor`. */
  hasMore: boolean;
  /** Oldest seq the server still retains; ahead of our cursor means a gap. */
  oldestCursor: number;
}

/** The single fetch the poller needs — normally backed by the REST transport. */
export interface MatchEventsSource {
  fetchEvents(matchId: string, after: number, limit: number): Promise<MatchEventsPage | null>;
}

/**
 * Minimal timer surface. Structurally satisfied by `window` (or a richer
 * `TimerLike` from `core/net/transport.ts`); `unknown` handles/returns keep
 * both assignable.
 */
export interface TimerLike {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface BattleEventPollerOptions {
  /** Poll interval in milliseconds; defaults to 500. */
  intervalMs?: number;
  /** Page size; the server clamps it to 64 anyway. Defaults to 64. */
  limit?: number;
  /** Fired per fetched page, in arrival order. */
  onEvents?: (events: MatchEventView[]) => void;
  /** Fired when the server dropped events (cursor fell behind `oldestCursor`). */
  onGap?: (matchId: string) => void;
  /** Fired when the source rejects; the poller keeps running either way. */
  onError?: (message: string) => void;
}

const DEFAULT_INTERVAL_MS = 500;
const DEFAULT_LIMIT = 64;
/** Backlog pages drained per interval before waiting for the next tick. */
const MAX_DRAIN_PAGES = 8;

export class BattleEventPoller {
  private readonly source: MatchEventsSource;
  private readonly timer: TimerLike;
  private readonly intervalMs: number;
  private readonly limit: number;
  private readonly onEvents?: (events: MatchEventView[]) => void;
  private readonly onGap?: (matchId: string) => void;
  private readonly onError?: (message: string) => void;

  private timerHandle: unknown = null;
  private active = false;
  private polling = false;
  private matchIdValue = '';
  private cursor = 0;

  constructor(source: MatchEventsSource, timer: TimerLike, opts: BattleEventPollerOptions = {}) {
    this.source = source;
    this.timer = timer;
    const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.intervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_INTERVAL_MS;
    const limit = opts.limit ?? DEFAULT_LIMIT;
    this.limit = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : DEFAULT_LIMIT;
    this.onEvents = opts.onEvents;
    this.onGap = opts.onGap;
    this.onError = opts.onError;
  }

  /** The match being polled, or `''` when stopped. */
  get matchId(): string {
    return this.matchIdValue;
  }

  /** True between {@link start} and {@link stop}. */
  get running(): boolean {
    return this.active;
  }

  /**
   * Starts polling `matchId` from the oldest event the server retains. The
   * first fetch is immediate; calling this while running restarts cleanly.
   */
  start(matchId: string): void {
    if (this.active) {
      this.stop();
    }
    this.matchIdValue = matchId;
    this.cursor = 0;
    this.active = true;
    this.timerHandle = this.timer.setInterval(() => {
      void this.poll();
    }, this.intervalMs);
    void this.poll();
  }

  /** Stops polling; idempotent, and safe to call when never started. */
  stop(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.timer.clearInterval(this.timerHandle);
    this.timerHandle = null;
    this.matchIdValue = '';
  }

  /**
   * One poll tick: fetch a page, then drain `hasMore` pages back-to-back (at
   * most {@link MAX_DRAIN_PAGES} per tick). Never rejects — a source failure
   * is reported through `onError` and retried on the next interval.
   */
  private async poll(): Promise<void> {
    if (!this.active || this.polling) {
      return;
    }
    this.polling = true;
    try {
      for (let page = 0; page < MAX_DRAIN_PAGES; page += 1) {
        if (!this.active) {
          return;
        }
        const after = this.cursor;
        const response = await this.source.fetchEvents(this.matchIdValue, after, this.limit);
        if (!this.active) {
          return;
        }
        if (response === null) {
          // No page this tick (unauthorized, unknown match, transport down):
          // leave the cursor where it is and let the interval retry.
          return;
        }
        if (after < response.oldestCursor) {
          // The server dropped events between our cursor and what it still
          // retains — the scene's active-effect state is now stale, so the app
          // layer gets told once to rebuild from a snapshot.
          this.onGap?.(this.matchIdValue);
        }
        this.cursor = response.cursor;
        this.onEvents?.(response.events);
        if (!response.hasMore) {
          return;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.onError?.(message);
    } finally {
      this.polling = false;
    }
  }
}
