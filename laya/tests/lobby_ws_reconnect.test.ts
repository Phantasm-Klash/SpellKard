/**
 * `WsLobbyTransport` reconnect coverage.
 *
 * A lobby WebSocket drop (server restart, network blip, or the server kicking a
 * replaced session) must not leave the client permanently unable to call the
 * lobby. `Laya.Socket` cannot be revived once closed, so recovery means a
 * brand-new socket built through the injected `reconnect` factory. These tests
 * drive the transport with a manually controlled socket: exactly one reconnect
 * attempt per call, gated on `open`, and never after an explicit `close()`.
 */

import { WsLobbyTransport } from '../src/core/net/lobby_client';
import { LOBBY_MESSAGE } from '../src/core/net/lobby_protocol';
import type { SocketHandlers, SocketLike } from '../src/core/net/transport';
import { expectEqual, suite, test } from './harness';

/** Socket with manual open/error/close control and outbound frame capture. */
class ControlledSocket implements SocketLike {
  connected = false;
  readonly sent: string[] = [];
  private handlers: SocketHandlers = {};

  send(data: string | Uint8Array): void {
    this.sent.push(typeof data === 'string' ? data : '');
  }

  close(): void {
    this.connected = false;
  }

  setHandlers(handlers: SocketHandlers): void {
    this.handlers = handlers;
  }

  open(): void {
    this.connected = true;
    this.handlers.onOpen?.();
  }

  fail(message = 'boom'): void {
    this.handlers.onError?.(new Error(message));
  }

  drop(code = 1006, reason = 'gone'): void {
    this.connected = false;
    this.handlers.onClose?.(code, reason);
  }

  deliver(type: number, payload: unknown): void {
    this.handlers.onMessage?.(JSON.stringify({ type, payload }));
  }
}

/** Lets the async `call()` continuation run after a reconnect resolves. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

/** A transport wired to a fresh socket per reconnect, tracking every socket. */
function reconnectable(): {
  initial: ControlledSocket;
  created: ControlledSocket[];
  transport: WsLobbyTransport;
} {
  const initial = new ControlledSocket();
  initial.connected = true;
  const created: ControlledSocket[] = [];
  const transport = new WsLobbyTransport(initial, {
    reconnect: () => {
      const socket = new ControlledSocket();
      created.push(socket);
      return socket;
    },
  });
  return { initial, created, transport };
}

suite('lobby ws reconnect');

test('a dropped connection reconnects once and sends the request only after open', async () => {
  const { initial, created, transport } = reconnectable();
  initial.drop(1006, 'gone');

  const pending = transport.call({ id: 'bootstrap', payload: {} });
  await flush();
  expectEqual(created.length, 1, 'exactly one fresh socket is built');
  expectEqual(created[0]?.sent.length, 0, 'nothing is sent before the socket opens');

  created[0]?.open();
  await flush();
  expectEqual(created[0]?.sent.length, 1, 'the request goes out once the socket opens');

  created[0]?.deliver(LOBBY_MESSAGE.BootstrapResponse, { ruleset_version: 'rs-1' });
  const response = await pending;
  expectEqual(response.ok, true);
});

test('a reconnect that errors fails the call without throwing', async () => {
  const { initial, created, transport } = reconnectable();
  initial.drop(1006, 'gone');

  const pending = transport.call({ id: 'bootstrap' });
  await flush();
  created[0]?.fail('refused');

  const response = await pending;
  expectEqual(response.ok, false);
  expectEqual(response.error_code, 'lobby_ws_not_connected');
});

test('a reconnect that closes before opening also fails the call', async () => {
  const { initial, created, transport } = reconnectable();
  initial.drop(1006, 'gone');

  const pending = transport.call({ id: 'bootstrap' });
  await flush();
  created[0]?.drop(1006, 'refused');

  const response = await pending;
  expectEqual(response.ok, false);
  expectEqual(response.error_code, 'lobby_ws_not_connected');
});

test('close() disables reconnect for good', async () => {
  const { created, transport } = reconnectable();
  transport.close();

  const response = await transport.call({ id: 'bootstrap' });
  expectEqual(response.error_code, 'lobby_ws_not_connected');
  expectEqual(created.length, 0, 'a disposed transport must not reconnect');
});

test('a socket drop still rejects the in-flight call', async () => {
  const initial = new ControlledSocket();
  initial.connected = true;
  const transport = new WsLobbyTransport(initial); // no reconnect factory

  const pending = transport.call({ id: 'bootstrap' });
  initial.drop(1006, 'gone');

  const response = await pending;
  expectEqual(response.error_code, 'lobby_ws_closed:1006:gone');
});

test('without a reconnect factory a dropped connection stays failed', async () => {
  const initial = new ControlledSocket();
  initial.connected = true;
  const transport = new WsLobbyTransport(initial);
  initial.drop(1006, 'gone');

  const response = await transport.call({ id: 'bootstrap' });
  expectEqual(response.error_code, 'lobby_ws_not_connected');
});

test('each call attempts at most one reconnect', async () => {
  const { initial, created, transport } = reconnectable();
  initial.drop(1006, 'gone');

  const first = transport.call({ id: 'bootstrap' });
  await flush();
  expectEqual(created.length, 1, 'one attempt for the first call');
  created[0]?.fail(); // the reconnect fails
  expectEqual((await first).error_code, 'lobby_ws_not_connected');

  const second = transport.call({ id: 'bootstrap' });
  await flush();
  expectEqual(created.length, 2, 'one attempt for the second call');
  created[1]?.open();
  await flush();
  created[1]?.deliver(LOBBY_MESSAGE.BootstrapResponse, { ruleset_version: 'rs-1' });
  expectEqual((await second).ok, true);
});

test('two concurrent calls share a single reconnect attempt', async () => {
  const { initial, created, transport } = reconnectable();
  initial.drop(1006, 'gone');

  const first = transport.call({ id: 'bootstrap' });
  const second = transport.call({ id: 'bootstrap' });
  await flush();
  expectEqual(created.length, 1, 'both calls share one fresh socket');

  created[0]?.open();
  await flush();
  expectEqual(created[0]?.sent.length, 2, 'both requests go out once open');

  created[0]?.deliver(LOBBY_MESSAGE.BootstrapResponse, { ruleset_version: 'rs-1' });
  created[0]?.deliver(LOBBY_MESSAGE.BootstrapResponse, { ruleset_version: 'rs-1' });
  expectEqual((await first).ok, true);
  expectEqual((await second).ok, true);
});
