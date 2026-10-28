/**
 * 注册流程与邮箱验证码。
 *
 * 关键回归：Nakama 的原生邮箱认证**不发邮件**，所以那条路径上拿不到验证码。
 * 以前客户端先要求"code 不能为空"、再进 Nakama 分支（而那个分支根本不用 code），
 * 于是 Nakama 上永远注册不了 —— 玩家被要求填一个客户端刚刚拒绝发送的码。
 */

import { expect, expectEqual, suite, test } from './harness';
import {
  LobbyClient,
  type LobbyRpcRequest,
  type LobbyRpcResponse,
  type LobbyTransport,
} from '../src/core/net/lobby_client';

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

/**
 * A transport that also speaks Nakama's account API — which is exactly what
 * marks it as the Nakama path (`isNakamaAccountTransport` looks for the
 * method, nothing more).
 */
class NakamaTransport extends ScriptedTransport {
  /** Records what the client asked the account API to do. */
  readonly authRequests: { email: string; create: boolean }[] = [];

  async authenticateAccount(request: {
    kind: string;
    email?: string;
    password?: string;
    username?: string;
    create?: boolean;
  }): Promise<null> {
    this.authRequests.push({ email: request.email ?? '', create: request.create === true });
    return null;
  }
}

function ok(payload: unknown): LobbyRpcResponse {
  return { ok: true, status: 200, payload };
}

suite('registration: the code is only demanded where a code can arrive');

test('a lobby-managed account can mail a code', () => {
  const transport = new ScriptedTransport(() =>
    ok({ email: 'alice@example.com', expires_in_seconds: 600, resend_in_seconds: 60 }),
  );
  const client = new LobbyClient({ transport });
  expect(client.supportsEmailCode(), 'the lobby mails codes');
});

test('nakama cannot, and says so', () => {
  const transport = new NakamaTransport(() => ok({}));
  const client = new LobbyClient({ transport });
  expect(!client.supportsEmailCode(), 'nakama mails nothing');
});

test('an empty code still blocks registration on the lobby path', () => {
  const transport = new ScriptedTransport(() => ok({}));
  const client = new LobbyClient({ transport });
  void client.registerAccount('alice', 'alice@example.com', 'secret', '');
  expectEqual(client.lastError, 'verification_code_required');
  expectEqual(transport.calls.length, 0, 'and no round-trip is spent');
});

test('an empty code does NOT block registration on the nakama path', () => {
  // The regression: this used to fail with `verification_code_required`
  // before the Nakama branch was ever reached, so registering on Nakama was
  // impossible.
  const transport = new NakamaTransport(() => ok({}));
  const client = new LobbyClient({ transport });
  void client.registerAccount('alice', 'alice@example.com', 'secret', '');
  expect(client.lastError !== 'verification_code_required', 'the code is not demanded here');
  // It did reach the account API, which is what actually creates the account.
  expect(transport.authRequests.length === 1, 'and the account API was asked');
  expectEqual(transport.authRequests[0]?.create, true, 'to create it');
});
