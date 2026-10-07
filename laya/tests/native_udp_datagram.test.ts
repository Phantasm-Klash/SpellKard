/**
 * Native (LayaNative) UDP datagram adapter coverage: endpoint parsing, native
 * module discovery, and the `DatagramLike` send/poll/close behaviour that KCP
 * relies on. Uses a fake `spk_udp` module and a manual timer, so no native
 * runtime is needed.
 */

import {
  NativeUdpDatagramFactory,
  parseUdpEndpoint,
  resolveNativeUdpModule,
  type NativeUdpModule,
} from '../src/platform/native/native_udp_datagram';
import { OfflineDatagram, type TimerLike } from '../src/core/net/transport';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

class FakeUdpModule implements NativeUdpModule {
  created = 0;
  readonly closed: number[] = [];
  readonly sent: Array<{ handle: number; host: string; port: number; bytes: number[] }> = [];
  readonly incoming: number[][] = [];
  readonly bound: Array<{ handle: number; address: string; port: number }> = [];

  version(): string {
    return 'fake-1.0.0';
  }

  create(): number {
    this.created += 1;
    return 7;
  }

  bind(handle: number, address: string, port: number): number {
    this.bound.push({ handle, address, port });
    return 1;
  }

  setNonBlocking(): number {
    return 1;
  }

  sendTo(handle: number, host: string, port: number, data: ArrayBuffer): number {
    this.sent.push({ handle, host, port, bytes: Array.from(new Uint8Array(data)) });
    return data.byteLength;
  }

  recvFrom(_handle: number, buffer: ArrayBuffer): number {
    const next = this.incoming.shift();
    if (next === undefined) {
      return 0;
    }
    new Uint8Array(buffer).set(next);
    return next.length;
  }

  lastRecvAddress(): string {
    return '127.0.0.1:9000';
  }

  localPort(): number {
    return 50000;
  }

  close(handle: number): number {
    this.closed.push(handle);
    return 1;
  }
}

class ManualTimer implements TimerLike {
  private readonly intervals = new Map<number, () => void>();
  private nextId = 1;

  now(): number {
    return 0;
  }

  setInterval(callback: () => void): number {
    const id = this.nextId;
    this.nextId += 1;
    this.intervals.set(id, callback);
    return id;
  }

  clearInterval(handle: number): void {
    this.intervals.delete(handle);
  }

  setTimeout(): number {
    return 0;
  }

  clearTimeout(): void {
    // not used
  }

  tick(): void {
    for (const callback of Array.from(this.intervals.values())) {
      callback();
    }
  }

  get activeCount(): number {
    return this.intervals.size;
  }
}

suite('native udp endpoint parsing');

test('parseUdpEndpoint accepts host:port and [ipv6]:port', () => {
  expectDeepEqual(parseUdpEndpoint('127.0.0.1:9000'), { host: '127.0.0.1', port: 9000 });
  expectDeepEqual(parseUdpEndpoint('battle.example.com:6122'), { host: 'battle.example.com', port: 6122 });
  expectDeepEqual(parseUdpEndpoint('[::1]:9000'), { host: '::1', port: 9000 });
});

test('parseUdpEndpoint rejects malformed endpoints', () => {
  expectEqual(parseUdpEndpoint(''), null);
  expectEqual(parseUdpEndpoint('nohost'), null);
  expectEqual(parseUdpEndpoint('host:0'), null);
  expectEqual(parseUdpEndpoint('host:70000'), null);
  expectEqual(parseUdpEndpoint('host:abc'), null);
  expectEqual(parseUdpEndpoint('[::1:9000'), null);
});

suite('native udp module discovery');

test('resolveNativeUdpModule finds spk_udp on the scope or its window', () => {
  const module = new FakeUdpModule();
  expectEqual(resolveNativeUdpModule({ spk_udp: module }), module);
  expectEqual(resolveNativeUdpModule({ window: { spk_udp: module } }), module);
  expectEqual(resolveNativeUdpModule({}), null);
  expectEqual(resolveNativeUdpModule(null), null);
  expectEqual(resolveNativeUdpModule({ spk_udp: { create: () => 1 } }), null, 'incomplete module is ignored');
});

suite('native udp datagram');

test('open binds a non-blocking socket and polls datagrams into onMessage', () => {
  const module = new FakeUdpModule();
  const timer = new ManualTimer();
  const factory = new NativeUdpDatagramFactory(module, timer);
  const datagram = factory.open('127.0.0.1:9000');

  expectEqual(module.created, 1);
  expectDeepEqual(module.bound[0], { handle: 7, address: '0.0.0.0', port: 0 });

  const received: number[][] = [];
  datagram.setHandlers({ onMessage: (data) => received.push(Array.from(data)) });

  module.incoming.push([1, 2, 3]);
  timer.tick();
  expectDeepEqual(received, [[1, 2, 3]]);

  // An empty queue must not emit anything.
  timer.tick();
  expectDeepEqual(received, [[1, 2, 3]]);

  datagram.send(new Uint8Array([9, 8, 7]));
  expectDeepEqual(module.sent[0], { handle: 7, host: '127.0.0.1', port: 9000, bytes: [9, 8, 7] });
});

test('send copies out of the caller buffer so subarray offsets never leak', () => {
  const module = new FakeUdpModule();
  const timer = new ManualTimer();
  const datagram = new NativeUdpDatagramFactory(module, timer).open('10.0.0.1:6000');
  const backing = new Uint8Array([0, 1, 2, 3, 4]);
  datagram.send(backing.subarray(2, 4));
  expectDeepEqual(module.sent[0]?.bytes, [2, 3]);
});

test('close clears the poll timer, closes the handle and fires onClose', () => {
  const module = new FakeUdpModule();
  const timer = new ManualTimer();
  const datagram = new NativeUdpDatagramFactory(module, timer).open('127.0.0.1:9000');
  expectEqual(timer.activeCount, 1);

  let closed = false;
  datagram.setHandlers({ onClose: () => (closed = true) });
  datagram.close();

  expectEqual(datagram.closed, true);
  expectEqual(timer.activeCount, 0);
  expectDeepEqual(module.closed, [7]);
  expectEqual(closed, true);

  // A closed datagram ignores further sends.
  datagram.send(new Uint8Array([1]));
  expectEqual(module.sent.length, 0);
});

test('open falls back to an offline channel on a bad endpoint or socket failure', () => {
  const module = new FakeUdpModule();
  const factory = new NativeUdpDatagramFactory(module, new ManualTimer());
  expect(factory.open('garbage') instanceof OfflineDatagram, 'bad endpoint degrades to offline');

  const failing: NativeUdpModule = {
    version: () => 'fake',
    create: () => -1,
    bind: () => 1,
    setNonBlocking: () => 1,
    sendTo: () => -1,
    recvFrom: () => 0,
    lastRecvAddress: () => '',
    localPort: () => 0,
    close: () => 1,
  };
  expect(new NativeUdpDatagramFactory(failing, new ManualTimer()).open('127.0.0.1:1') instanceof OfflineDatagram, 'create failure degrades to offline');
});
