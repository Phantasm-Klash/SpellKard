/**
 * `core/net/battle_event_poller` — the REST poller that feeds the battle scene.
 *
 * The loop is driven with a scripted source and a manual timer so every
 * contract (cursor advance, `hasMore` draining, gap detection, error
 * resilience, idempotent stop) is pinned without a wall clock.
 */

import { BattleEventPoller, type MatchEventsPage, type MatchEventsSource, type TimerLike } from '../src/core/net/battle_event_poller';
import type { MatchEventView } from '../src/core/game/battle_events';
import { expectEqual, suite, test } from './harness';

/** Manual interval timer: nothing fires until `tick()` is called. */
class FakeTimer implements TimerLike {
  private nextHandle = 1;
  private readonly live = new Map<number, { fn: () => void; ms: number }>();

  setInterval(fn: () => void, ms: number): unknown {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.live.set(handle, { fn, ms });
    return handle;
  }

  clearInterval(handle: unknown): void {
    this.live.delete(handle as number);
  }

  get count(): number {
    return this.live.size;
  }

  /** Interval in ms of the single registered timer (tests register at most one). */
  get intervalMs(): number {
    return [...this.live.values()][0]?.ms ?? -1;
  }

  tick(): void {
    for (const { fn } of [...this.live.values()]) {
      fn();
    }
  }
}

/** Scripted source: records every call and answers through the handler. */
class StubSource implements MatchEventsSource {
  readonly calls: { matchId: string; after: number; limit: number }[] = [];

  constructor(private readonly handler: (after: number, limit: number) => MatchEventsPage | null | Promise<MatchEventsPage | null>) {}

  async fetchEvents(matchId: string, after: number, limit: number): Promise<MatchEventsPage | null> {
    this.calls.push({ matchId, after, limit });
    return this.handler(after, limit);
  }
}

function page(partial: Partial<MatchEventsPage>): MatchEventsPage {
  return { events: [], cursor: 0, hasMore: false, oldestCursor: 0, ...partial };
}

function event(seq: number): MatchEventView {
  return { seq, type: 'hit', tick: seq };
}

/** Lets the poller's async loop settle (each `await` needs a microtask turn). */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    await Promise.resolve();
  }
}

suite('battle event poller');

test('the cursor advances to each page cursor and the default limit is 64', async () => {
  const source = new StubSource((after) => page({ events: [event(after + 1)], cursor: after + 5, oldestCursor: 0 }));
  const timer = new FakeTimer();
  const delivered: number[] = [];
  const poller = new BattleEventPoller(source, timer, {
    onEvents: (events) => {
      for (const item of events) {
        delivered.push(item.seq);
      }
    },
  });

  poller.start('m-1');
  expectEqual(poller.running, true);
  expectEqual(poller.matchId, 'm-1');
  await flush();

  expectEqual(source.calls.length, 1);
  expectEqual(source.calls[0]?.matchId, 'm-1');
  expectEqual(source.calls[0]?.after, 0, 'the cursor starts at the oldest event');
  expectEqual(source.calls[0]?.limit, 64, 'the default page size is 64');
  expectEqual(delivered[0], 1);

  timer.tick();
  await flush();
  expectEqual(source.calls.length, 2);
  expectEqual(source.calls[1]?.after, 5, 'the next fetch resumes from the page cursor');

  timer.tick();
  await flush();
  expectEqual(source.calls[2]?.after, 10);

  poller.stop();
});

test('hasMore pages are drained within a single start()', async () => {
  const source = new StubSource((after) => {
    if (after === 0) return page({ events: [event(1)], cursor: 1, hasMore: true });
    if (after === 1) return page({ events: [event(2)], cursor: 2, hasMore: true });
    return page({ events: [event(3)], cursor: 3, hasMore: false });
  });
  const timer = new FakeTimer();
  const batches: number[] = [];
  const poller = new BattleEventPoller(source, timer, {
    onEvents: (events) => batches.push(events.length),
  });

  poller.start('m-2');
  await flush();

  expectEqual(source.calls.length, 3, 'the whole backlog is fetched without waiting for the interval');
  expectEqual(source.calls[0]?.after, 0);
  expectEqual(source.calls[1]?.after, 1);
  expectEqual(source.calls[2]?.after, 2);
  expectEqual(batches.length, 3);

  // The timer never fired (FakeTimer is manual), so all three pages came from
  // the single start(): the cursor is now at the drained tail.
  expectEqual(timer.count, 1, 'the interval is still armed for the next poll');

  poller.stop();
});

test('a cursor behind oldestCursor fires onGap once and resyncs to the page cursor', async () => {
  const source = new StubSource((after) => {
    if (after === 0) return page({ cursor: 10, hasMore: true, oldestCursor: 7 });
    return page({ cursor: 12, hasMore: false, oldestCursor: 7 });
  });
  const timer = new FakeTimer();
  let gaps = 0;
  let gapMatchId = '';
  const poller = new BattleEventPoller(source, timer, {
    onGap: (matchId) => {
      gaps += 1;
      gapMatchId = matchId;
    },
  });

  poller.start('m-3');
  await flush();

  expectEqual(gaps, 1, 'the gap is reported exactly once');
  expectEqual(gapMatchId, 'm-3');
  expectEqual(source.calls[0]?.after, 0);
  expectEqual(source.calls[1]?.after, 10, 'the cursor resyncs to what the server still retains');

  poller.stop();
});

test('no gap is reported while the cursor is within the retained range', async () => {
  const source = new StubSource((after) => page({ cursor: after + 1, oldestCursor: 0 }));
  const timer = new FakeTimer();
  let gaps = 0;
  const poller = new BattleEventPoller(source, timer, { onGap: () => (gaps += 1) });

  poller.start('m-4');
  await flush();
  timer.tick();
  await flush();

  expectEqual(gaps, 0);
  poller.stop();
});

test('a rejected fetch fires onError and the poller keeps polling', async () => {
  let attempt = 0;
  const source = new StubSource((after) => {
    attempt += 1;
    if (attempt === 1) {
      throw new Error('rest down');
    }
    return page({ events: [event(after + 1)], cursor: after + 1, oldestCursor: 0 });
  });
  const timer = new FakeTimer();
  const errors: string[] = [];
  let delivered = 0;
  const poller = new BattleEventPoller(source, timer, {
    onError: (message) => errors.push(message),
    onEvents: () => (delivered += 1),
  });

  poller.start('m-5');
  await flush();

  expectEqual(errors.length, 1);
  expectEqual(errors[0], 'rest down');
  expectEqual(poller.running, true, 'a transport failure must not stop the poller');
  expectEqual(timer.count, 1, 'the interval stays armed for the retry');

  timer.tick();
  await flush();
  expectEqual(delivered, 1, 'the retry delivers the page');
  expectEqual(errors.length, 1);

  poller.stop();
});

test('stop() is idempotent and clears the interval', async () => {
  const source = new StubSource(() => page({}));
  const timer = new FakeTimer();
  const poller = new BattleEventPoller(source, timer, {});

  poller.start('m-6');
  expectEqual(timer.count, 1);
  await flush();

  poller.stop();
  expectEqual(poller.running, false);
  expectEqual(poller.matchId, '');
  expectEqual(timer.count, 0);

  poller.stop();
  expectEqual(poller.running, false, 'a second stop is a no-op');

  // Never-started stop is safe too.
  const idle = new BattleEventPoller(source, timer, {});
  idle.stop();
  expectEqual(idle.running, false);
});

test('a custom interval and page size are honoured', async () => {
  const source = new StubSource(() => page({}));
  const timer = new FakeTimer();
  const poller = new BattleEventPoller(source, timer, { intervalMs: 250, limit: 10 });

  poller.start('m-7');
  await flush();

  expectEqual(timer.intervalMs, 250);
  expectEqual(source.calls[0]?.limit, 10);

  poller.stop();
});

test('a null page leaves the cursor untouched and retries later', async () => {
  let attempt = 0;
  const source = new StubSource((after) => {
    attempt += 1;
    if (attempt === 1) return null;
    return page({ cursor: after + 1, oldestCursor: 0 });
  });
  const timer = new FakeTimer();
  const poller = new BattleEventPoller(source, timer, {});

  poller.start('m-8');
  await flush();
  expectEqual(source.calls.length, 1);

  timer.tick();
  await flush();
  expectEqual(source.calls.length, 2);
  expectEqual(source.calls[1]?.after, 0, 'a missing page does not advance the cursor');

  poller.stop();
});
