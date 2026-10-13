/**
 * The match-event cursor plumbing: `LobbyClient.fetchMatchEvents` must expose
 * the server's `oldest_cursor` (plus the optional `latest_cursor` /
 * `snapshot_tick`), so `BattleEventPoller`'s `after < oldestCursor` test can
 * raise `onGap` for real.
 *
 * The two halves are exercised together — a real `LobbyClient` behind a
 * scripted transport, feeding a real `BattleEventPoller` — because the bug this
 * covers was the *adapter* discarding the cursor, not the poller mis-testing it.
 */

import {
  LobbyClient,
  type LobbyRpcRequest,
  type LobbyRpcResponse,
  type LobbyTransport,
} from '../src/core/net/lobby_client';
import { BattleEventPoller, type TimerLike } from '../src/core/net/battle_event_poller';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

/** Transport that answers every RPC with a scripted response. */
class ScriptedTransport implements LobbyTransport {
  readonly calls: LobbyRpcRequest[] = [];

  constructor(private readonly handler: (request: LobbyRpcRequest) => LobbyRpcResponse) {}

  async call(request: LobbyRpcRequest): Promise<LobbyRpcResponse> {
    this.calls.push(request);
    return this.handler(request);
  }

  close(): void {
    // nothing to release
  }
}

function ok(payload: unknown): LobbyRpcResponse {
  return { ok: true, status: 200, payload };
}

/** Manual interval timer: nothing fires until `tick()` is called. */
class FakeTimer implements TimerLike {
  private nextHandle = 1;
  private readonly live = new Map<number, () => void>();

  setInterval(fn: () => void, _ms: number): unknown {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.live.set(handle, fn);
    return handle;
  }

  clearInterval(handle: unknown): void {
    this.live.delete(handle as number);
  }

  tick(): void {
    for (const fn of [...this.live.values()]) {
      fn();
    }
  }
}

/** The `after` the client put on the wire, or `-1` when it is missing. */
function afterOf(request: LobbyRpcRequest): number {
  const value = (request.payload ?? {}).after;
  return typeof value === 'number' ? value : -1;
}

/** Lets the poller's async loop settle (each `await` needs a microtask turn). */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    await Promise.resolve();
  }
}

/** Wires a `LobbyClient` behind a scripted transport into a real poller. */
function pollerFor(transport: ScriptedTransport): { poller: BattleEventPoller; timer: FakeTimer; gaps: () => number } {
  const client = new LobbyClient({ transport });
  const timer = new FakeTimer();
  let gaps = 0;
  const poller = new BattleEventPoller(
    { fetchEvents: (matchId, after, limit) => client.fetchMatchEvents(matchId, after, limit) },
    timer,
    { onGap: () => (gaps += 1) },
  );
  return { poller, timer, gaps: () => gaps };
}

suite('match event cursor');

test('fetchMatchEvents parses oldest_cursor and the optional cursor fields', async () => {
  const transport = new ScriptedTransport(() =>
    ok({
      events: [],
      cursor: 100,
      has_more: true,
      oldest_cursor: 80,
      latest_cursor: 120,
      snapshot_tick: 900,
    }),
  );
  const client = new LobbyClient({ transport });
  const view = await client.fetchMatchEvents('m-1', 50, 64);

  expect(view !== null, 'fetchMatchEvents should return a view');
  expectEqual(view?.cursor, 100);
  expectEqual(view?.hasMore, true);
  expectEqual(view?.oldestCursor, 80, 'oldest_cursor is surfaced verbatim');
  expectEqual(view?.latestCursor, 120, 'latest_cursor is surfaced when reported');
  expectEqual(view?.snapshotTick, 900, 'snapshot_tick is surfaced when reported');
  // Signature semantics unchanged: the same after/limit still go on the wire.
  expectEqual(transport.calls[0]?.id, 'match.events');
  expectDeepEqual(transport.calls[0]?.payload, { match_id: 'm-1', after: 50, limit: 64 });
});

test('an omitted oldest_cursor reads as 0 and leaves the optionals absent', async () => {
  const transport = new ScriptedTransport(() => ok({ events: [], cursor: 7, has_more: false }));
  const client = new LobbyClient({ transport });
  const view = await client.fetchMatchEvents('m-2', 0, 64);

  expectEqual(view?.oldestCursor, 0, 'absent oldest_cursor suppresses gaps instead of inventing one');
  expect(view?.latestCursor === undefined, 'latestCursor stays absent when the server omits it');
  expect(view?.snapshotTick === undefined, 'snapshotTick stays absent when the server omits it');
});

test('a real oldest_cursor drives onGap once through the LobbyClient adapter', async () => {
  // after=0 → the retained range starts at 0 (no gap); after=50 → the server
  // has dropped everything below 80, so the poller must report the gap once and
  // resync to the page cursor (100).
  const transport = new ScriptedTransport((request) => {
    const after = afterOf(request);
    if (after === 0) return ok({ events: [], cursor: 50, has_more: false, oldest_cursor: 0 });
    if (after === 50) return ok({ events: [], cursor: 100, has_more: false, oldest_cursor: 80 });
    return ok({ events: [], cursor: after, has_more: false, oldest_cursor: after });
  });
  const { poller, timer, gaps } = pollerFor(transport);

  poller.start('m-3');
  await flush();
  expectEqual(gaps(), 0, 'the first page is inside the retained range');

  timer.tick();
  await flush();
  expectEqual(gaps(), 1, 'after=50 behind oldest_cursor=80 fires onGap exactly once');

  timer.tick();
  await flush();
  expectEqual(gaps(), 1, 'resynced to 100, the next page is not another gap');

  poller.stop();
});

test('oldest_cursor at or below the requested cursor never fires onGap', async () => {
  const transport = new ScriptedTransport((request) => {
    const after = afterOf(request);
    // First page retains from 0; then `oldest == after`, then `oldest < after`.
    if (after === 0) return ok({ events: [], cursor: 40, has_more: false, oldest_cursor: 0 });
    if (after === 40) return ok({ events: [], cursor: 70, has_more: false, oldest_cursor: 40 });
    return ok({ events: [], cursor: after, has_more: false, oldest_cursor: 10 });
  });
  const { poller, timer, gaps } = pollerFor(transport);

  poller.start('m-4');
  await flush();
  timer.tick();
  await flush();
  timer.tick();
  await flush();

  expectEqual(gaps(), 0, 'oldest_cursor <= after is never a gap');

  poller.stop();
});
