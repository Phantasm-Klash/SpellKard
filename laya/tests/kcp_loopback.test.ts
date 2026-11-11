/**
 * KCP transport tests.
 *
 * Two `KcpSession`s are wired through an in-memory lossy datagram channel driven
 * by a fake clock. This exercises `ikcp_send/recv/input/update/flush`, retransmit
 * on loss, ACK handling and ordering — the parts that must interoperate with the
 * C++ server's unmodified `ikcp.c`.
 */

import { KcpSession } from '../src/core/net/kcp_transport';
import type { DatagramHandlers, DatagramLike, TimerLike } from '../src/core/net/transport';
import { Lcg, expect, expectEqual, suite, test } from './harness';

class FakeTimer implements TimerLike {
  private current = 0;
  private nextHandle = 1;
  private readonly handles = new Map<number, { cb: () => void; interval: number; next: number }>();

  now(): number {
    return this.current;
  }

  setInterval(callback: () => void, intervalMs: number): number {
    const handle = this.nextHandle++;
    this.handles.set(handle, { cb: callback, interval: intervalMs, next: this.current + intervalMs });
    return handle;
  }

  clearInterval(handle: number): void {
    this.handles.delete(handle);
  }

  setTimeout(callback: () => void, delayMs: number): number {
    return this.setInterval(callback, delayMs);
  }

  clearTimeout(handle: number): void {
    this.clearInterval(handle);
  }

  /** Advance time by `ms`, firing due timers, and let `onStep` pump the channel. */
  advance(ms: number, onStep: () => void): void {
    const target = this.current + ms;
    while (this.current < target) {
      this.current += 1;
      for (const entry of [...this.handles.values()]) {
        if (this.current >= entry.next) {
          entry.next = this.current + entry.interval;
          entry.cb();
        }
      }
      onStep();
    }
  }
}

class MemoryDatagram implements DatagramLike {
  closed = false;
  private handlers: DatagramHandlers = {};

  constructor(
    private readonly inbox: Uint8Array[],
    private readonly peerInbox: Uint8Array[],
    private readonly random: Lcg,
    private readonly lossRate: number,
  ) {}

  send(data: Uint8Array): void {
    if (this.random.next() < this.lossRate) {
      return;
    }
    this.peerInbox.push(data.slice());
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.handlers.onClose?.();
  }

  setHandlers(handlers: DatagramHandlers): void {
    this.handlers = handlers;
  }

  pump(): void {
    const pending = this.inbox.splice(0, this.inbox.length);
    for (const datagram of pending) {
      this.handlers.onMessage?.(datagram);
    }
  }
}

interface Harness {
  timer: FakeTimer;
  a: KcpSession;
  b: KcpSession;
  pump: () => void;
  advance: (ms: number) => void;
  bytesSentOverWire: () => number;
}

function makeHarness(lossRate: number, seed = 7): Harness {
  const timer = new FakeTimer();
  const inboxA: Uint8Array[] = [];
  const inboxB: Uint8Array[] = [];
  const random = new Lcg(seed);
  let wireBytes = 0;
  const track = (list: Uint8Array[]): Uint8Array[] => {
    const originalPush = list.push.bind(list);
    list.push = (...items: Uint8Array[]): number => {
      for (const item of items) {
        wireBytes += item.length;
      }
      return originalPush(...items);
    };
    return list;
  };
  track(inboxA);
  track(inboxB);

  const datagramA = new MemoryDatagram(inboxA, inboxB, random, lossRate);
  const datagramB = new MemoryDatagram(inboxB, inboxA, random, lossRate);
  const a = new KcpSession(datagramA, timer, { conv: 4233679959, intervalMs: 10 });
  const b = new KcpSession(datagramB, timer, { conv: 4233679959, intervalMs: 10 });

  const pump = (): void => {
    datagramA.pump();
    datagramB.pump();
  };

  return {
    timer,
    a,
    b,
    pump,
    advance: (ms: number) => timer.advance(ms, pump),
    bytesSentOverWire: () => wireBytes,
  };
}

suite('kcp transport');

test('delivers a single reliable message over a clean channel', () => {
  const h = makeHarness(0);
  const received: Uint8Array[] = [];
  h.b.onMessage((payload) => received.push(payload));
  h.a.send(new Uint8Array([1, 2, 3, 4]));
  h.advance(200);
  expectEqual(received.length, 1);
  expectEqual(received[0].length, 4);
  expectEqual(received[0][3], 4);
  h.a.close();
  h.b.close();
});

test('delivers many messages in order despite 20% packet loss', () => {
  const h = makeHarness(0.2, 99);
  const received: Uint8Array[] = [];
  h.b.onMessage((payload) => received.push(payload));
  const total = 25;
  for (let i = 0; i < total; i += 1) {
    const payload = new Uint8Array([i & 0xff, (i >> 8) & 0xff, 0xaa]);
    h.a.send(payload);
    h.advance(30);
  }
  h.advance(4000);

  expectEqual(received.length, total);
  let ordered = true;
  for (let i = 0; i < received.length; i += 1) {
    const value = received[i][0] | (received[i][1] << 8);
    if (value !== i) {
      ordered = false;
      break;
    }
  }
  expect(ordered, 'messages must arrive in send order');
  expect(h.bytesSentOverWire() > 0, 'some bytes should have crossed the wire');
  h.a.close();
  h.b.close();
});

test('reassembles a payload split across multiple segments', () => {
  const h = makeHarness(0);
  const received: Uint8Array[] = [];
  h.b.onMessage((payload) => received.push(payload));
  // Larger than one MSS (1400 - 24), so KCP fragments it.
  const big = new Uint8Array(5000);
  for (let i = 0; i < big.length; i += 1) {
    big[i] = i % 251;
  }
  h.a.send(big);
  h.advance(500);
  expectEqual(received.length, 1);
  expectEqual(received[0].length, 5000);
  let identical = true;
  for (let i = 0; i < big.length; i += 1) {
    if (received[0][i] !== big[i]) {
      identical = false;
      break;
    }
  }
  expect(identical, 'reassembled payload must be byte-identical');
  h.a.close();
  h.b.close();
});

test('delivers a boss21-sized snapshot (130KB) without stalling the receive path', () => {
  // ★ 回归：一次 boss21 的 delta 快照实测 ~130KB（单 tick 216 条 spawn，每条带
  //   完整 37 字段 BulletMotion 模板 ~518B，加上 chains[] ~12KB）。曾经的实现
  //   用 `recv(65536)` 取消息，超限时 Kcp.recv 返回 -3，而 drain 循环把 -3
  //   当成「没东西可读了」直接 break —— 队头那条超限消息永远取不出来，KCP
  //   接收队列（rcvWnd=128）被顶满，之后的快照全堵在服务端发送窗口后面。
  //   实机症状：客户端只收到开头两条快照，本地 tick 一路涨、权威 tick 卡死。
  const h = makeHarness(0);
  const received: Uint8Array[] = [];
  h.b.onMessage((payload) => received.push(payload));
  const big = new Uint8Array(130_436);
  for (let i = 0; i < big.length; i += 1) {
    big[i] = i % 251;
  }
  h.a.send(big);
  h.advance(3000);
  expectEqual(received.length, 1, 'the oversized message must be delivered, not stuck');
  expectEqual(received[0].length, 130_436);
  let identical = true;
  for (let i = 0; i < big.length; i += 1) {
    if (received[0][i] !== big[i]) {
      identical = false;
      break;
    }
  }
  expect(identical, 'the 130KB payload must be byte-identical after reassembly');
  h.a.close();
  h.b.close();
});

test('a message after an oversized one still arrives (the queue does not wedge)', () => {
  // 上一条的姊妹回归：超限消息卡在队头时，后面的消息也一起收不到。
  // 修好上限后，这条必须能收到。
  const h = makeHarness(0);
  const received: Uint8Array[] = [];
  h.b.onMessage((payload) => received.push(payload));
  const big = new Uint8Array(130_436);
  h.a.send(big);
  h.advance(3000);
  const small = new Uint8Array([9, 8, 7]);
  h.a.send(small);
  h.advance(500);
  expectEqual(received.length, 2, 'both messages must be delivered');
  expectEqual(received[1].length, 3);
  h.a.close();
  h.b.close();
});

test('close() stops the update loop and releases the channel', () => {
  const h = makeHarness(0);
  const received: Uint8Array[] = [];
  h.b.onMessage((payload) => received.push(payload));
  h.a.close();
  h.a.send(new Uint8Array([1]));
  h.advance(200);
  expectEqual(received.length, 0);
  h.b.close();
});
