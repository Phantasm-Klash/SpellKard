import {
  LobbyClient,
  NakamaLobbyTransport,
  NAKAMA_BUSINESS_ENVELOPE_VERSION,
  type HttpClient,
  type HttpResponseLike,
  type LobbyRpcRequest,
} from '../src/core/net/lobby_client';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

interface SeenRequest {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

function response(body: unknown, status = 200): HttpResponseLike {
  return { status, body };
}

/** Wraps an envelope the way Nakama does: the envelope JSON as a string. */
function rpcResponse(envelope: unknown, status = 200): HttpResponseLike {
  return response({ payload: JSON.stringify(envelope) }, status);
}

/** Builds an unverified JWT so the transport can read `uid` / `usn` / `exp`. */
function fakeJwt(claims: Record<string, unknown>): string {
  const encode = (value: string): string =>
    btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode('{"alg":"HS256","typ":"JWT"}')}.${encode(JSON.stringify(claims))}.signature`;
}

/**
 * The body the `HttpClient` adapters put on the wire.
 *
 * Both `LayaHttpClient` and `FetchHttpClient` serialize the body exactly once
 * (`JSON.stringify(body)`), so a body that is already a string reaches Nakama
 * as a **JSON string** — which is what `/v2/rpc/<id>` requires.
 */
function wireBody(body: unknown): string {
  return JSON.stringify(body);
}

/** The payload the transport handed to the adapter, parsed back. */
function sentPayload(body: unknown): Record<string, unknown> {
  expectEqual(typeof body, 'string', 'the Nakama transport must hand the adapter a serialized string');
  return JSON.parse(String(body)) as Record<string, unknown>;
}

function recordingHttp(handler: (path: string) => HttpResponseLike): { http: HttpClient; seen: SeenRequest[] } {
  const seen: SeenRequest[] = [];
  const http: HttpClient = {
    async request(method, path, body, headers): Promise<HttpResponseLike> {
      seen.push({ method, path, body, headers: headers ?? {} });
      return handler(path);
    },
  };
  return { http, seen };
}

suite('nakama lobby rpc transport');

test('sends the RPC payload as a JSON string with Basic auth', async () => {
  const { http, seen } = recordingHttp(() => response({ session_token: 'nakama-session', user_id: 'u-1' }));
  const transport = new NakamaLobbyTransport(http, { httpKey: 'defaultkey' });
  const request: LobbyRpcRequest = {
    id: 'auth.anonymous',
    payload: { device_id: 'device-1', display_name: 'Player' },
  };

  const result = await transport.call(request);
  expectEqual(result.ok, true);
  expectEqual(seen[0]?.method, 'POST');
  expectEqual(seen[0]?.path, '/v2/rpc/auth.anonymous');
  expectDeepEqual(sentPayload(seen[0]?.body), { device_id: 'device-1', display_name: 'Player' });
  // The wire carries a JSON string: Nakama unmarshals the body into a Go
  // `string` and rejects a bare object with
  // `400 json: cannot unmarshal object into Go value of type string`.
  expectEqual(typeof JSON.parse(wireBody(seen[0]?.body)), 'string');
  expectEqual(seen[0]?.headers.Authorization, 'Basic ZGVmYXVsdGtleTo=');
  expectEqual(seen[0]?.headers['Content-Type'], 'application/json');
});

test('switches from Basic auth to Bearer after a Nakama account authentication', async () => {
  const authHeaders: string[] = [];
  const { http } = recordingHttp((path) => {
    return path.startsWith('/v2/account/authenticate')
      ? response({ created: true, token: 'nakama-session', refresh_token: 'refresh-1' })
      : response({ ok: true, profile: { user_id: 'u-1' } });
  });
  const wrapped: HttpClient = {
    async request(method, path, body, headers): Promise<HttpResponseLike> {
      authHeaders.push(headers?.Authorization ?? '');
      return http.request(method, path, body, headers);
    },
  };
  const transport = new NakamaLobbyTransport(wrapped, { httpKey: 'defaultkey', serverKey: 'server-key' });
  const account = await transport.authenticateAccount({ kind: 'device', id: 'device-1' });

  expectEqual(account === null, false);
  expectEqual(account?.token, 'nakama-session');
  await transport.call({ id: 'bootstrap', payload: { known_ruleset_version: '' } });

  expectEqual(authHeaders[0], 'Basic c2VydmVyLWtleTo=');
  expectEqual(authHeaders[1], 'Bearer nakama-session');
});

test('maps direct Nakama errors without treating them as client success', async () => {
  const { http } = recordingHttp(() => response({ error_code: 'business_envelope_required', message: 'envelope required' }, 400));
  const result = await new NakamaLobbyTransport(http, { sessionToken: 'nakama-session' }).call({
    id: 'bootstrap',
    payload: {},
  });

  expectEqual(result.ok, false);
  expectEqual(result.status, 400);
  expectEqual(result.error_code, 'business_envelope_required');
  expectEqual(result.message, 'envelope required');
});

test("Nakama's own failure shape is a failure even on a 2xx answer", async () => {
  const { http } = recordingHttp(() =>
    response({ error: 'HTTP key invalid', message: 'HTTP key invalid', code: 16 }, 200),
  );
  const result = await new NakamaLobbyTransport(http, { sessionToken: 'nakama-session' }).call({
    id: 'bootstrap',
    payload: {},
  });

  expectEqual(result.ok, false);
  expectEqual(result.error_code, 'HTTP key invalid');
  expectEqual(result.message, 'HTTP key invalid');
});

test('unwraps the second response layer and takes the verdict from the envelope', async () => {
  const { http } = recordingHttp(() => rpcResponse({ ok: true, status: 200, payload: { cards: 3 } }));
  const result = await new NakamaLobbyTransport(http, { sessionToken: 'nakama-session' }).call({
    id: 'inventory.get',
    payload: {},
  });

  expectEqual(result.ok, true);
  expectEqual(result.status, 200);
  expectDeepEqual(result.payload, { cards: 3 });
});

test('HTTP 200 is not success: the envelope status decides', async () => {
  const { http } = recordingHttp(() =>
    rpcResponse({ ok: false, status: 409, error_code: 'business_envelope_replay', message: 'seq was already used' }),
  );
  const result = await new NakamaLobbyTransport(http, { sessionToken: 'nakama-session' }).call({
    id: 'inventory.get',
    payload: {},
  });

  expectEqual(result.ok, false);
  expectEqual(result.status, 409);
  expectEqual(result.error_code, 'business_envelope_replay');
});

test('wraps authenticated business bodies only when an envelope producer is supplied', async () => {
  const bodies: unknown[] = [];
  const { http } = recordingHttp(() => response({ ok: true }));
  const wrapped: HttpClient = {
    async request(method, path, body, headers): Promise<HttpResponseLike> {
      bodies.push(body);
      return http.request(method, path, body, headers);
    },
  };
  const transport = new NakamaLobbyTransport(wrapped, {
    sessionToken: 'nakama-session',
    businessEnvelope: (request, body) => ({
      version: 'business-v0-scaffold',
      seq: 1,
      timestamp_ms: 1_791_341_000_000,
      nonce: `nonce-${request.id}`,
      op_code: request.id,
      key_id: 'caller-owned-key',
      auth_tag: 'caller-owned-tag',
      ciphertext_mode: 'caller-owned-mode',
      body_hash: JSON.stringify(body),
    }),
  });
  await transport.call({ id: 'inventory.get', payload: { page: 1 } });

  expectDeepEqual(sentPayload(bodies[0]), {
    business_envelope: {
      version: 'business-v0-scaffold',
      seq: 1,
      timestamp_ms: 1_791_341_000_000,
      nonce: 'nonce-inventory.get',
      op_code: 'inventory.get',
      key_id: 'caller-owned-key',
      auth_tag: 'caller-owned-tag',
      ciphertext_mode: 'caller-owned-mode',
      body_hash: '{"page":1}',
    },
    body: { page: 1 },
  });
});

test('a producer that returns null still opts out of the envelope', async () => {
  const bodies: unknown[] = [];
  const { http } = recordingHttp(() => response({ ok: true }));
  const wrapped: HttpClient = {
    async request(method, path, body, headers): Promise<HttpResponseLike> {
      bodies.push(body);
      return http.request(method, path, body, headers);
    },
  };
  const transport = new NakamaLobbyTransport(wrapped, {
    sessionToken: 'nakama-session',
    businessEnvelope: () => null,
  });
  await transport.call({ id: 'inventory.get', payload: { page: 1 } });

  expectDeepEqual(sentPayload(bodies[0]), { page: 1 });
});

test('builds a scaffold envelope with a strictly increasing seq and a 64-hex tag', async () => {
  const bodies: unknown[] = [];
  const { http } = recordingHttp(() => response({ ok: true }));
  const wrapped: HttpClient = {
    async request(method, path, body, headers): Promise<HttpResponseLike> {
      bodies.push(body);
      return http.request(method, path, body, headers);
    },
  };
  const transport = new NakamaLobbyTransport(wrapped, { sessionToken: 'nakama-session' });
  await transport.call({ id: 'inventory.get', payload: { page: 1 } });
  await transport.call({ id: 'inventory.get', payload: { page: 2 } });

  const first = sentPayload(bodies[0]) as {
    business_envelope: Record<string, unknown>;
    body: Record<string, unknown>;
  };
  const second = sentPayload(bodies[1]) as { business_envelope: Record<string, unknown> };

  expectEqual(first.business_envelope.version, NAKAMA_BUSINESS_ENVELOPE_VERSION);
  expectEqual(Number(second.business_envelope.seq) > Number(first.business_envelope.seq), true);
  expectEqual(first.business_envelope.op_code, 'inventory.get');
  expectEqual(first.business_envelope.key_id !== '', true);
  expectEqual(first.business_envelope.ciphertext_mode, 'plain-scaffold');
  expectEqual(/^[0-9a-f]{64}$/.test(String(first.business_envelope.auth_tag)), true);
  expectEqual(/^[0-9a-f]{64}$/.test(String(second.business_envelope.auth_tag)), true);
  expectEqual(String(first.business_envelope.nonce) !== String(second.business_envelope.nonce), true);
  expectDeepEqual(first.body, { page: 1 });
  expectEqual(typeof first.business_envelope.timestamp_ms === 'number', true);
});

test('the envelope sequence keeps rising across a re-authentication', async () => {
  const bodies: unknown[] = [];
  const { http } = recordingHttp((path) => {
    if (path.startsWith('/v2/account/authenticate')) {
      return response({ created: true, token: 'tok', refresh_token: 'r' });
    }
    return response({ ok: true });
  });
  const wrapped: HttpClient = {
    async request(method, path, body, headers): Promise<HttpResponseLike> {
      bodies.push(body);
      return http.request(method, path, body, headers);
    },
  };
  const transport = new NakamaLobbyTransport(wrapped, { serverKey: 'server-key' });

  await transport.call({ id: 'inventory.get', payload: { page: 1 } });
  await transport.authenticateAccount({ kind: 'device', id: 'device-1' });
  await transport.call({ id: 'inventory.get', payload: { page: 2 } });

  const first = sentPayload(bodies[0]) as { business_envelope: Record<string, unknown> };
  const third = sentPayload(bodies[2]) as { business_envelope: Record<string, unknown> };
  // The lobby buckets the replay guard by the business session id, which is
  // derived from the Nakama user id: a re-authentication does **not** open a
  // fresh bucket, so restarting the counter would be answered
  // `business_envelope_replay` for every later call.
  expectEqual(Number(third.business_envelope.seq) > Number(first.business_envelope.seq), true);
});

test('a fresh transport starts above the wall clock so a restart cannot replay', async () => {
  const bodies: unknown[] = [];
  const { http } = recordingHttp(() => response({ ok: true }));
  const wrapped: HttpClient = {
    async request(method, path, body, headers): Promise<HttpResponseLike> {
      bodies.push(body);
      return http.request(method, path, body, headers);
    },
  };
  const before = Date.now();
  const transport = new NakamaLobbyTransport(wrapped, { sessionToken: 'nakama-session' });
  await transport.call({ id: 'inventory.get', payload: { page: 1 } });

  const first = sentPayload(bodies[0]) as { business_envelope: Record<string, unknown> };
  expectEqual(Number(first.business_envelope.seq) >= before, true);
});

test('leaves pre-authentication operations unwrapped', async () => {
  const bodies: unknown[] = [];
  const { http } = recordingHttp(() => response({ ok: true }));
  const wrapped: HttpClient = {
    async request(method, path, body, headers): Promise<HttpResponseLike> {
      bodies.push(body);
      return http.request(method, path, body, headers);
    },
  };
  const transport = new NakamaLobbyTransport(wrapped, { httpKey: 'defaultkey' });
  for (const id of ['auth.anonymous', 'auth.emailCode', 'auth.register', 'auth.login']) {
    await transport.call({ id, payload: { email: 'a@b.c' } });
  }
  for (const body of bodies) {
    expectDeepEqual(sentPayload(body), { email: 'a@b.c' });
  }
});

test('uses Nakama RPC routes for business operations instead of legacy REST paths', async () => {
  const paths: string[] = [];
  const { http } = recordingHttp(() => response({ ok: true }));
  const wrapped: HttpClient = {
    async request(method, path, body, headers): Promise<HttpResponseLike> {
      paths.push(path);
      return http.request(method, path, body, headers);
    },
  };
  const transport = new NakamaLobbyTransport(wrapped, { sessionToken: 'nakama-session' });
  for (const id of ['inventory.get', 'decks.list', 'decks.save', 'chests.list', 'chests.open', 'rooms.create', 'matchmaking.join', 'replay.get']) {
    await transport.call({ id, payload: {} });
  }
  expectEqual(paths.length, 8);
  for (const path of paths) {
    expect(path.startsWith('/v2/rpc/'), `unexpected Nakama path ${path}`);
  }
});

test('device authentication posts the server key and retries without a rejected username', async () => {
  const paths: string[] = [];
  const { http } = recordingHttp((path) => {
    paths.push(path);
    // Nakama rejects the *whole* request when the username is taken, which is
    // why the transport retries it without one.
    return path.includes('username=')
      ? response({ error: 'username is already in use' }, 409)
      : response({ created: true, token: fakeJwt({ uid: 'u-9', usn: 'NakamaName', exp: 1_792_535_107 }), refresh_token: 'r' });
  });
  const transport = new NakamaLobbyTransport(http, { httpKey: 'defaultkey', serverKey: 'server-key' });
  const account = await transport.authenticateAccount({ kind: 'device', id: 'device-9', username: 'TakenName' });

  expectEqual(paths.length, 2);
  expectEqual(paths[0], '/v2/account/authenticate/device?create=true&username=TakenName');
  expectEqual(paths[1], '/v2/account/authenticate/device?create=true');
  expectEqual(account?.userId, 'u-9');
  expectEqual(account?.username, 'NakamaName');
  expectEqual(account?.expiresAtMs, 1_792_535_107_000);
  expectEqual(account?.refreshToken, 'r');
  expectEqual(transport.currentAccount()?.token, account?.token);
});

test('e-mail authentication asks Nakama to create or resume the account', async () => {
  const paths: string[] = [];
  const bodies: unknown[] = [];
  const { http } = recordingHttp((path) => {
    paths.push(path);
    return response({ created: true, token: 'tok', refresh_token: 'r', user_id: 'from-body' });
  });
  const wrapped: HttpClient = {
    async request(method, path, body, headers): Promise<HttpResponseLike> {
      bodies.push(body);
      return http.request(method, path, body, headers);
    },
  };
  const transport = new NakamaLobbyTransport(wrapped, { serverKey: 'server-key' });
  await transport.authenticateAccount({ kind: 'email', email: 'a@b.c', password: 'pw', create: true });
  await transport.authenticateAccount({ kind: 'email', email: 'a@b.c', password: 'pw', create: false });

  expectEqual(paths[0], '/v2/account/authenticate/email?create=true');
  expectEqual(paths[1], '/v2/account/authenticate/email?create=false');
  expectDeepEqual(bodies[0], { email: 'a@b.c', password: 'pw' });
  expectEqual(transport.currentAccount()?.userId, 'from-body');
});

test('a failed authentication leaves the transport on the pre-auth credential', async () => {
  const { http } = recordingHttp(() => response({ error: 'server key invalid' }, 401));
  const transport = new NakamaLobbyTransport(http, { httpKey: 'defaultkey' });
  const account = await transport.authenticateAccount({ kind: 'device', id: 'device-1' });

  expectEqual(account, null);
  expectEqual(transport.currentAccount(), null);
});

suite('nakama client session');

test('loginAnonymous authenticates against Nakama and never calls auth.anonymous', async () => {
  const paths: string[] = [];
  const { http } = recordingHttp((path) => {
    paths.push(path);
    return path.startsWith('/v2/account/authenticate')
      ? response({ created: true, token: fakeJwt({ uid: 'nakama-uuid', usn: 'Player', exp: 1_792_535_107 }), refresh_token: 'r' })
      : rpcResponse({ ok: true, status: 200, payload: { user_id: 'nakama-uuid', ruleset_version: 'ruleset-local-s0' } });
  });
  const client = new LobbyClient({
    transport: new NakamaLobbyTransport(http, { serverKey: 'server-key' }),
    deviceId: 'device-login',
  });
  const session = await client.loginAnonymous('Player');

  expectEqual(session === null, false);
  expectEqual(session?.userId, 'nakama-uuid');
  expectEqual(session?.displayName, 'Player');
  expectEqual(paths.some((path) => path.startsWith('/v2/rpc/auth.anonymous')), false);
  expectEqual(paths[0], '/v2/account/authenticate/device?create=true&username=Player');
  expectEqual(client.nakamaSession()?.token !== '', true);
});

test('an e-mail sign-in goes through Nakama and reports the missing verification channel', async () => {
  const paths: string[] = [];
  const { http } = recordingHttp((path) => {
    paths.push(path);
    return response({ created: true, token: fakeJwt({ uid: 'mail-uuid', usn: 'mailname', exp: 1 }), refresh_token: 'r' });
  });
  const client = new LobbyClient({
    transport: new NakamaLobbyTransport(http, { serverKey: 'server-key' }),
  });

  expectEqual(await client.requestEmailCode('a@b.c'), null);
  expectEqual(client.lastError, 'nakama_email_code_unsupported');

  const session = await client.loginAccount('a@b.c', 'pw');
  expectEqual(session?.userId, 'mail-uuid');
  expectEqual(paths[0], '/v2/account/authenticate/email?create=false');
});

test('a replayed envelope sequence is recovered by re-authenticating once', async () => {
  let businessCalls = 0;
  const paths: string[] = [];
  const { http } = recordingHttp((path) => {
    paths.push(path);
    if (path.startsWith('/v2/account/authenticate')) {
      return response({ created: true, token: fakeJwt({ uid: 'u-1', usn: 'P', exp: 1 }), refresh_token: 'r' });
    }
    businessCalls += 1;
    return businessCalls === 1
      ? rpcResponse({ ok: false, status: 409, error_code: 'business_envelope_replay', message: 'seq was already used' })
      : rpcResponse({ ok: true, status: 200, payload: { ok: true } });
  });
  const client = new LobbyClient({
    transport: new NakamaLobbyTransport(http, { serverKey: 'server-key' }),
    deviceId: 'device-replay',
  });
  await client.loginAnonymous('Player');
  const inventory = await client.fetchInventory();

  expectEqual(inventory === null, false);
  expectEqual(paths.filter((path) => path.startsWith('/v2/account/authenticate')).length, 2);
  expectEqual(businessCalls, 2);
});

test('a display name that is not a legal Nakama username is not forwarded', async () => {
  const paths: string[] = [];
  const { http } = recordingHttp((path) => {
    paths.push(path);
    return response({ created: true, token: fakeJwt({ uid: 'u-10', usn: 'generated', exp: 1_792_535_107 }), refresh_token: 'r' });
  });
  const transport = new NakamaLobbyTransport(http, { serverKey: 'server-key' });

  const account = await transport.authenticateAccount({ kind: 'device', id: 'device-10', username: 'Player One' });

  expectEqual(paths.length, 1);
  expectEqual(paths[0], '/v2/account/authenticate/device?create=true');
  expectEqual(account?.username, 'generated');
});
