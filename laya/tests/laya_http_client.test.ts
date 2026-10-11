/**
 * `LayaHttpClient` coverage.
 *
 * The Windows/LayaNative exe has no `fetch`, so the REST-only lobby calls
 * (`match.ready`, `battle.allocation`, `battle.ticket`, …) went through the
 * browser `FetchHttpClient` and threw `ReferenceError: fetch is not defined`,
 * surfacing to the player as `lobby_transport_error:match.ready`. These tests pin
 * the `XMLHttpRequest`-based replacement: request shaping, JSON decoding, the
 * non-JSON fallback and the network-error path.
 */

import { LayaHttpClient } from '../src/platform/laya/laya_http_client';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

interface FakeXhrRecord {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  timeout: number;
}

/** Installs a scriptable `XMLHttpRequest` double and returns a restore hook. */
function installFakeXhr(
  respond: (record: FakeXhrRecord) => { status: number; text: string } | 'network_error',
): { records: FakeXhrRecord[]; restore: () => void } {
  const records: FakeXhrRecord[] = [];
  const scope = globalThis as unknown as Record<string, unknown>;
  const previous = scope.XMLHttpRequest;

  class FakeXhr {
    readyState = 0;
    status = 0;
    responseText = '';
    timeout = 0;
    onreadystatechange: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    private record: FakeXhrRecord = { method: '', url: '', headers: {}, body: null, timeout: 0 };

    open(method: string, url: string): void {
      this.record.method = method;
      this.record.url = url;
      this.readyState = 1;
    }

    setRequestHeader(key: string, value: string): void {
      this.record.headers[key] = value;
    }

    send(body: string | null): void {
      this.record.body = body;
      this.record.timeout = this.timeout;
      records.push(this.record);
      const outcome = respond(this.record);
      if (outcome === 'network_error') {
        this.onerror?.();
        return;
      }
      this.status = outcome.status;
      this.responseText = outcome.text;
      this.readyState = 4;
      this.onreadystatechange?.();
    }
  }

  scope.XMLHttpRequest = FakeXhr;
  return {
    records,
    restore: () => {
      scope.XMLHttpRequest = previous;
    },
  };
}

suite('laya http client');

test('POSTs JSON with the base URL, bearer token and custom headers', async () => {
  const fake = installFakeXhr(() => ({ status: 200, text: '{"ok":true,"payload":{"match_id":"M-1"}}' }));
  try {
    const client = new LayaHttpClient('http://121.225.78.211:7350', 'ws-token-1');
    const response = await client.request('POST', '/v1/matches/M-1/ready', { match_id: 'M-1' }, {
      'X-PhK-Business-Envelope': 'deadbeef',
    });
    expectEqual(response.status, 200);
    expectDeepEqual(response.body, { ok: true, payload: { match_id: 'M-1' } });

    const record = fake.records[0];
    expect(record !== undefined, 'one request was issued');
    expectEqual(record?.method, 'POST');
    expectEqual(record?.url, 'http://121.225.78.211:7350/v1/matches/M-1/ready');
    expectEqual(record?.headers['Content-Type'], 'application/json');
    expectEqual(record?.headers.Authorization, 'Bearer ws-token-1');
    expectEqual(record?.headers['X-PhK-Business-Envelope'], 'deadbeef');
    expectEqual(record?.body, '{"match_id":"M-1"}');
    expectEqual(record?.timeout, 15000);
  } finally {
    fake.restore();
  }
});

test('GET sends no body and tolerates a non-JSON response', async () => {
  const fake = installFakeXhr(() => ({ status: 502, text: '<html>bad gateway</html>' }));
  try {
    const client = new LayaHttpClient('http://lobby.test');
    const response = await client.request('GET', '/v1/bootstrap');
    expectEqual(response.status, 502);
    expectEqual(response.body, '<html>bad gateway</html>');
    expectEqual(fake.records[0]?.body, null);
  } finally {
    fake.restore();
  }
});

test('an empty body decodes to null instead of throwing', async () => {
  const fake = installFakeXhr(() => ({ status: 204, text: '' }));
  try {
    const response = await new LayaHttpClient('').request('GET', '/v1/rooms');
    expectEqual(response.status, 204);
    expectEqual(response.body, null);
  } finally {
    fake.restore();
  }
});

test('a network failure rejects so LobbyClient can surface lobby_transport_error', async () => {
  const fake = installFakeXhr(() => 'network_error');
  try {
    let message = '';
    try {
      await new LayaHttpClient('http://lobby.test').request('POST', '/v1/matches/M-1/ready');
    } catch (error) {
      message = String(error);
    }
    expect(message.includes('laya_http_network_error'), `unexpected rejection: ${message}`);
  } finally {
    fake.restore();
  }
});
