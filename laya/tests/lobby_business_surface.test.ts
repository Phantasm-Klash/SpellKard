import {
  LobbyClient,
  type LobbyRpcRequest,
  type LobbyRpcResponse,
  type LobbyTransport,
} from '../src/core/net/lobby_client';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

class ScriptedTransport implements LobbyTransport {
  readonly calls: LobbyRpcRequest[] = [];

  async call(request: LobbyRpcRequest): Promise<LobbyRpcResponse> {
    this.calls.push(request);
    if (request.id === 'decks.list') {
      return {
        ok: true,
        status: 200,
        payload: {
          user_id: 'u-1',
          active_deck_id: 'starter',
          ruleset_version: 'ruleset-local-s0',
          decks: [
            {
              deck_id: 'starter',
              name: 'Starter',
              format: 'standard',
              ruleset_version: 'ruleset-local-s0',
              card_ids: ['focus_lens', 'wide_arc'],
              active: true,
              client_result_authoritative: true,
            },
          ],
          server_authoritative: true,
        },
      };
    }
    return {
      ok: true,
      status: 200,
      payload: {
        ok: true,
        user_id: 'u-1',
        ruleset_version: 'ruleset-local-s0',
        items: [
          { card_id: 'focus_lens', copies: 3, level: 2, client_result_authoritative: true },
          { card_id: 'wide_arc', copies: 1, level: 1 },
        ],
        server_authoritative: true,
      },
    };
  }

  close(): void {
    // nothing to release
  }
}

suite('lobby business surface');

test('fetchInventory projects server-owned inventory and ignores client authority fields', async () => {
  const transport = new ScriptedTransport();
  const client = new LobbyClient({ transport });
  const inventory = await client.fetchInventory();

  expect(inventory !== null, 'inventory should be returned');
  expectEqual(transport.calls[0]?.id, 'inventory.get');
  expectDeepEqual(transport.calls[0]?.payload, {});
  expectEqual(inventory?.userId, 'u-1');
  expectEqual(inventory?.rulesetVersion, 'ruleset-local-s0');
  expectEqual(inventory?.items[0]?.cardId, 'focus_lens');
  expectEqual(inventory?.items[0]?.copies, 3);
  expectEqual(inventory?.items[0]?.level, 2);
  expectEqual(inventory?.serverAuthoritative, true);
  expect(!('clientResultAuthoritative' in (inventory?.items[0] ?? {})), 'client authority must not enter inventory view');
});

test('fetchDecks projects the active server deck without accepting client-owned fields', async () => {
  const transport = new ScriptedTransport();
  const client = new LobbyClient({ transport });
  const decks = await client.fetchDecks();

  expect(decks !== null, 'decks should be returned');
  expectEqual(transport.calls[0]?.id, 'decks.list');
  expectEqual(decks?.activeDeckId, 'starter');
  expectEqual(decks?.decks[0]?.deckId, 'starter');
  expectEqual(decks?.decks[0]?.cardIds[1], 'wide_arc');
  expectEqual(decks?.decks[0]?.active, true);
  expectEqual(decks?.serverAuthoritative, true);
  expect(!('clientResultAuthoritative' in (decks?.decks[0] ?? {})), 'client authority must not enter deck view');
});
