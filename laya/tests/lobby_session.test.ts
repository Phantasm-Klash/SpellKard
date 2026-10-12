import {
  LobbyClient,
  NakamaLobbyTransport,
  type HttpClient,
  type HttpResponseLike,
  type LobbyRpcRequest,
  type LobbySessionStore,
  type LobbyTransport,
  type SessionState,
} from '../src/core/net/lobby_client';
import { LobbyFlow, LobbyScreen } from '../src/core/game/lobby_flow';
import { expectEqual, suite, test } from './harness';

class MemorySessionStore implements LobbySessionStore {
  value: SessionState | null;
  saveCount = 0;

  constructor(value: SessionState | null = null) {
    this.value = value;
  }

  load(): SessionState | null {
    return this.value;
  }

  save(session: SessionState): void {
    this.value = { ...session, unlockedCharacterIds: [...session.unlockedCharacterIds] };
    this.saveCount += 1;
  }

  clear(): void {
    this.value = null;
  }
}

function response(body: unknown, status = 200): HttpResponseLike {
  return { status, body };
}

const restoredSession: SessionState = {
  sessionToken: 'saved-session',
  userId: 'u-1',
  playerId: 'p-1',
  displayName: 'Player',
  characterId: 'balanced',
  rulesetVersion: 'ruleset-local-s0',
  unlockedCharacterIds: ['balanced'],
};

suite('lobby session lifecycle');

test('restores through bootstrap with Bearer auth and never reuses a persisted request sequence', async () => {
  const seen: Array<{ path: string; body: unknown; authorization: string }> = [];
  const http: HttpClient = {
    async request(_method, path, body, headers): Promise<HttpResponseLike> {
      seen.push({ path, body, authorization: headers?.Authorization ?? '' });
      return response({
        profile: { user_id: 'u-1', player_id: 'p-1', display_name: 'Player' },
        ruleset_version: 'ruleset-local-s0',
      });
    },
  };
  const store = new MemorySessionStore(restoredSession);
  const client = new LobbyClient({
    transport: new NakamaLobbyTransport(http, { httpKey: 'runtime-key' }),
    sessionStore: store,
  });
  const flow = new LobbyFlow(client);

  expectEqual(await flow.signIn(), true);
  expectEqual(flow.currentScreen, LobbyScreen.Lobby);
  expectEqual(seen.length, 1);
  expectEqual(seen[0]?.path, '/v2/rpc/bootstrap?unwrap=true');
  expectEqual(seen[0]?.authorization, 'Bearer saved-session');
  expectEqual(seen[0]?.body, '{"known_ruleset_version":"ruleset-local-s0"}');
  expectEqual(store.saveCount, 1);
});

test('login persists the server-issued session and clearSession removes it and resets transport auth', async () => {
  const authHeaders: string[] = [];
  const http: HttpClient = {
    async request(_method, path, _body, headers): Promise<HttpResponseLike> {
      authHeaders.push(headers?.Authorization ?? '');
      return path.includes('auth.anonymous')
        ? response({
            session_token: 'new-session',
            user_id: 'u-2',
            player_id: 'p-2',
            display_name: 'New Player',
            ruleset_version: 'ruleset-local-s0',
          })
        : response({
            profile: { user_id: 'u-2', player_id: 'p-2', display_name: 'New Player' },
            ruleset_version: 'ruleset-local-s0',
          });
    },
  };
  const store = new MemorySessionStore();
  const transport = new NakamaLobbyTransport(http, { httpKey: 'runtime-key' });
  const client = new LobbyClient({ transport, sessionStore: store });
  const flow = new LobbyFlow(client);

  expectEqual(await flow.signIn('New Player'), true);
  expectEqual(store.value?.sessionToken, 'new-session');
  expectEqual(store.saveCount, 2);

  client.clearSession();
  expectEqual(store.value, null);
  await client.loginAnonymous('Replacement');
  expectEqual(authHeaders[0], 'Basic cnVudGltZS1rZXk6');
  expectEqual(authHeaders[1], 'Bearer new-session');
  expectEqual(authHeaders[2], 'Basic cnVudGltZS1rZXk6');
});

test('expired restored sessions are cleared and remain on the login screen', async () => {
  const store = new MemorySessionStore(restoredSession);
  const http: HttpClient = {
    async request(): Promise<HttpResponseLike> {
      return response({ error_code: 'unauthorized' }, 401);
    },
  };
  const flow = new LobbyFlow(
    new LobbyClient({
      transport: new NakamaLobbyTransport(http, { httpKey: 'runtime-key' }),
      sessionStore: store,
    }),
  );

  expectEqual(await flow.signIn(), false);
  expectEqual(flow.currentScreen, LobbyScreen.Login);
  expectEqual(store.value, null);
  expectEqual(flow.snapshot().session, null);
});

test('explicit re-authentication starts a fresh request without the restored identity fields', async () => {
  const requests: LobbyRpcRequest[] = [];
  const transport: LobbyTransport = {
    async call(request): Promise<{ ok: boolean; status: number; payload: unknown }> {
      requests.push(request);
      return {
        ok: true,
        status: 200,
        payload: {
          session_token: 'replacement-session',
          user_id: 'u-2',
          player_id: 'p-2',
          ruleset_version: 'ruleset-local-s0',
        },
      };
    },
    close(): void {},
  };
  const client = new LobbyClient({
    transport,
    sessionStore: new MemorySessionStore(restoredSession),
  });

  expectEqual((await client.loginAnonymous('Replacement'))?.sessionToken, 'replacement-session');
  expectEqual(requests[0]?.cid, 'c1');
  expectEqual(requests[0]?.session_id, undefined);
  expectEqual(requests[0]?.user_id, undefined);
});
