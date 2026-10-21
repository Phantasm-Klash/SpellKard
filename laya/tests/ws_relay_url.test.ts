/**
 * 对局中继 URL 契约回归（2026-10-22 客户端收不到快照的根因修复）。
 *
 * 浏览器客户端从中介 REST 拿到的 allocation endpoint 必须作为 advisory 查询
 * 参数随中继 URL 下发。生产中大厅中继自行解析 match→endpoint 会忽略它；但
 * 本地 WS↔UDP 演示中继没有 session token、调不了 allocation REST，只能直拨
 * 该端点——否则回落到固化端口，连上残留对局（player_not_in_roster 拒绝循环，
 * 客户端永远等不到服务端快照）。
 */

import { buildRelayUrl, RelayDatagramFactory, type RelaySessionDescriptor } from '../src/platform/web/ws_relay_datagram';
import type { SocketFactory, SocketLike } from '../src/core/net/transport';
import { expect, expectEqual, suite, test } from './harness';

const BASE = 'ws://127.0.0.1:7399/v1/battle/relay';

class FakeSocket implements SocketLike {
  connected = true;
  sent: Array<string | Uint8Array> = [];
  closeCalls = 0;

  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls += 1;
  }

  setHandlers(): void {
    /* not needed for URL assertions */
  }
}

suite('ws relay url');

test('buildRelayUrl omits empty hints and keeps match_id mandatory', () => {
  const url = buildRelayUrl({ relayUrl: BASE, matchId: 'm1', playerId: 'p1', battleServerId: '', ticketId: '' });
  expectEqual(url, `${BASE}?match_id=m1&player_id=p1`, 'empty hints must be omitted');
});

test('buildRelayUrl forwards the allocation endpoint as an advisory hint', () => {
  const url = buildRelayUrl({
    relayUrl: BASE,
    matchId: 'm1',
    playerId: 'p1',
    battleServerId: 'bs-104-1',
    ticketId: 't1',
    endpoint: '104.233.217.232:7402',
  });
  expect(url.includes('match_id=m1'), 'match_id missing');
  expect(url.includes('endpoint=104.233.217.232%3A7402'), 'endpoint hint missing or mis-encoded');
});

test('buildRelayUrl without endpoint stays byte-identical to the legacy shape', () => {
  const descriptor: RelaySessionDescriptor = {
    relayUrl: BASE,
    matchId: 'm1',
    playerId: 'p1',
    battleServerId: 'bs-104-1',
    ticketId: 't1',
  };
  expectEqual(
    buildRelayUrl(descriptor),
    `${BASE}?match_id=m1&player_id=p1&battle_server_id=bs-104-1&ticket_id=t1`,
    'legacy URL shape must not change',
  );
});

test('RelayDatagramFactory passes the resolved endpoint through to the relay URL', () => {
  const seen: string[] = [];
  const sockets: SocketFactory = {
    connect: (url: string): SocketLike => {
      seen.push(url);
      return new FakeSocket();
    },
  };
  const factory = new RelayDatagramFactory(sockets, BASE);
  factory.open('104.233.217.232:7402', { matchId: 'm1', playerId: 'p1' });
  expectEqual(seen.length, 1, 'exactly one relay socket expected');
  expect(seen[0].includes('endpoint=104.233.217.232%3A7402'), `endpoint hint missing in ${seen[0]}`);
  expect(seen[0].includes('match_id=m1'), `match_id missing in ${seen[0]}`);
  expect(!seen[0].includes('battle_server_id'), 'unknown battle_server_id must stay omitted');
});
