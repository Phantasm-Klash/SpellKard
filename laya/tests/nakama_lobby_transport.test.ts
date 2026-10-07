import {
  NakamaLobbyTransport,
  type HttpClient,
  type HttpResponseLike,
  type LobbyRpcRequest,
} from '../src/core/net/lobby_client';
import { expect, expectEqual, suite, test } from './harness';

interface SeenRequest {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

function response(body: unknown, status = 200): HttpResponseLike {
  return { status, body };
}

suite('nakama lobby rpc transport');

test('sends double-encoded RPC payload with Basic auth and unwrap query', async () => {
  const seen: SeenRequest[] = [];
  const http: HttpClient = {
    async request(method, path, body, headers): Promise<HttpResponseLike> {
      seen.push({ method, path, body, headers: headers ?? {} });
      return response({ session_token: 'nakama-session', user_id: 'u-1' });
    },
  };
  const transport = new NakamaLobbyTransport(http, { httpKey: 'defaultkey' });
  const request: LobbyRpcRequest = {
    id: 'auth.anonymous',
    payload: { device_id: 'device-1', display_name: 'Player' },
  };

  const result = await transport.call(request);
  expectEqual(result.ok, true);
  expectEqual(seen[0]?.method, 'POST');
  expectEqual(seen[0]?.path, '/v2/rpc/auth.anonymous?unwrap=true');
  expectEqual(seen[0]?.body, '{"device_id":"device-1","display_name":"Player"}');
  expectEqual(seen[0]?.headers.Authorization, 'Basic ZGVmYXVsdGtleTo=');
  expectEqual(seen[0]?.headers['Content-Type'], 'application/json');
});

test('switches from Basic auth to Bearer after anonymous auth', async () => {
  const authHeaders: string[] = [];
  let callCount = 0;
  const http: HttpClient = {
    async request(_method, _path, _body, headers): Promise<HttpResponseLike> {
      authHeaders.push(headers?.Authorization ?? '');
      callCount += 1;
      return callCount === 1
        ? response({ session_token: 'nakama-session', user_id: 'u-1' })
        : response({ ok: true, profile: { user_id: 'u-1' } });
    },
  };
  const transport = new NakamaLobbyTransport(http, { httpKey: 'defaultkey' });
  await transport.call({ id: 'auth.anonymous', payload: { device_id: 'device-1' } });
  const result = await transport.call({ id: 'bootstrap', payload: { known_ruleset_version: '' } });

  expectEqual(result.ok, true);
  expectEqual(authHeaders[0], 'Basic ZGVmYXVsdGtleTo=');
  expectEqual(authHeaders[1], 'Bearer nakama-session');
  expectEqual(result.payload !== undefined, true);
});

test('maps direct Nakama errors without treating them as client success', async () => {
  const http: HttpClient = {
    async request(): Promise<HttpResponseLike> {
      return response({ error_code: 'business_envelope_required', message: 'envelope required' }, 400);
    },
  };
  const result = await new NakamaLobbyTransport(http, { sessionToken: 'nakama-session' }).call({
    id: 'bootstrap',
    payload: {},
  });

  expectEqual(result.ok, false);
  expectEqual(result.status, 400);
  expectEqual(result.error_code, 'business_envelope_required');
  expectEqual(result.message, 'envelope required');
});

test('uses Nakama RPC routes for business operations instead of legacy REST paths', async () => {
  const paths: string[] = [];
  const http: HttpClient = {
    async request(_method, path): Promise<HttpResponseLike> {
      paths.push(path);
      return response({ ok: true });
    },
  };
  const transport = new NakamaLobbyTransport(http, { sessionToken: 'nakama-session' });
  for (const id of ['inventory.get', 'decks.list', 'decks.save', 'chests.list', 'chests.open', 'rooms.create', 'matchmaking.join', 'replay.get']) {
    await transport.call({ id, payload: {} });
  }
  expectEqual(paths.length, 8);
  for (const path of paths) {
    expect(path.startsWith('/v2/rpc/'), `unexpected Nakama path ${path}`);
    expect(path.endsWith('?unwrap=true'), `missing unwrap query ${path}`);
  }
});
