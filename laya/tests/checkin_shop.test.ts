/**
 * Check-in / shop coverage: `LobbyClient.fetchCheckin` / `.claimCheckin` /
 * `.fetchShop` / `.purchaseShopItem` payload mapping, the new REST routes, the
 * `LobbyFlow` business screens, and the inventory/chests/decks/activity reads
 * against the server's existing Gensoulkyo shapes.
 *
 * The field names asserted here mirror the server's live contracts
 * (`runtime/core/shop.go`'s `ShopCatalogResponse` / `ShopPurchaseRequest`,
 * `runtime/core/service.go`'s check-in and activity handlers) as verified by
 * the lobby E2E against the real Nakama; the legacy
 * `docs/checkin_shop_contract.md` shape is still accepted where noted. If
 * either drifts, these tests break first.
 */

import {
  HttpLobbyTransport,
  LobbyClient,
  type HttpClient,
  type HttpResponseLike,
  type LobbyRpcRequest,
  type LobbyRpcResponse,
  type LobbyTransport,
} from '../src/core/net/lobby_client';
import { LobbyFlow, LobbyScreen } from '../src/core/game/lobby_flow';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

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

function ok(payload: unknown): LobbyRpcResponse {
  return { ok: true, status: 200, payload };
}

/** The contract's `GET /v1/checkin` body. */
const CHECKIN_BODY = {
  ok: true,
  user_id: 'u-1',
  cycle_id: '2026-10',
  days: [
    { day: 1, reward: { gold: 100 }, claimed: true, claimable: false },
    { day: 2, reward: { gold: 150 }, claimed: true, claimable: false },
    { day: 3, reward: { gold: 200, ticket: 1 }, claimed: false, claimable: true },
    { day: 4, reward: { gold: 250 }, claimed: false, claimable: false },
  ],
  streak: 2,
  next_claimable_day: 3,
  server_time_ms: 1700000000000,
};

/**
 * The server's real `GET /v1/shop` body (`ShopCatalogResponse`,
 * `runtime/core/shop.go`): listings under `products[]` priced in
 * `cost_kind`/`cost_amount` and granting `payload` × `quantity`. The legacy
 * `docs/checkin_shop_contract.md` shape (`items[]`/`item_id`/`price`) is kept
 * as a second fixture because the client still accepts it.
 */
const SHOP_BODY = {
  ok: true,
  wallet: { gold: 2000, gems: 300, card_dust: 0, chest_keys: 1, faith: 0, points: 0 },
  products: [
    {
      product_id: 'card.focus_lens.single',
      kind: 'card',
      cost_kind: 'gold',
      cost_amount: 200,
      payload: 'focus_lens',
      quantity: 1,
      rarity: 'common',
      season: 's1',
      daily_limit: 0,
      purchasable: true,
    },
    {
      product_id: 'chest.standard.pull',
      kind: 'chest',
      cost_kind: 'gold',
      cost_amount: 800,
      payload: 'local_basic',
      quantity: 1,
      rarity: 'common',
      season: 's1',
      daily_limit: 2,
      purchasable: true,
    },
  ],
  season: 's1',
  server_time: '2026-10-24T00:00:00Z',
};

/** The legacy documented `GET /v1/shop` body, still accepted as a fallback. */
const SHOP_BODY_LEGACY = {
  ok: true,
  currency: 'gold',
  wallet: { gold: 700, ticket: 1 },
  items: [
    {
      item_id: 'stamina_potion',
      name: 'Stamina Potion',
      description: 'Restores one ranked attempt.',
      price: { gold: 300 },
      grants: { item: 'stamina_potion', count: 1 },
      stock: -1,
      purchased: 0,
      purchasable: true,
    },
  ],
  server_time_ms: 1700000000000,
};

suite('check-in client');

test('fetchCheckin maps the 7-day cycle and surfaces the claimable day', async () => {
  const transport = new ScriptedTransport(() => ok(CHECKIN_BODY));
  const client = new LobbyClient({ transport });
  const view = await client.fetchCheckin();
  expect(view !== null, 'fetchCheckin should return a view');
  expectEqual(view?.userId, 'u-1');
  expectEqual(view?.cycleId, '2026-10');
  expectEqual(view?.streak, 2);
  expectEqual(view?.nextClaimableDay, 3);
  expectEqual(view?.serverTimeMs, 1700000000000);
  expectEqual(view?.days.length, 4);
  expectDeepEqual(view?.days[2], { day: 3, reward: { gold: 200, ticket: 1 }, claimed: false, claimable: true });
  expectEqual(view?.days[0]?.claimed, true);
  expectEqual(transport.calls[0]?.id, 'checkin.get');
});

test('fetchCheckin returns null and records lastError on a rejection', async () => {
  const client = new LobbyClient({
    transport: new ScriptedTransport(() => ({ ok: false, status: 401, error_code: 'unauthorized' })),
  });
  expectEqual(await client.fetchCheckin(), null);
  expectEqual(client.lastError, 'unauthorized');
});

test('claimCheckin posts an empty body and maps reward + wallet', async () => {
  const transport = new ScriptedTransport(() =>
    ok({
      ok: true,
      day: 3,
      reward: { gold: 200, ticket: 1 },
      wallet: { gold: 700, ticket: 1 },
      streak: 3,
      next_claimable_day: 4,
      server_time_ms: 1700000000001,
    }),
  );
  const client = new LobbyClient({ transport });
  const claim = await client.claimCheckin();
  expectEqual(claim?.day, 3);
  expectEqual(claim?.streak, 3);
  expectDeepEqual(claim?.reward, { gold: 200, ticket: 1 });
  expectDeepEqual(claim?.wallet, { gold: 700, ticket: 1 });
  expectEqual(claim?.nextClaimableDay, 4);
  expectEqual(transport.calls[0]?.id, 'checkin.claim');
  expectDeepEqual(transport.calls[0]?.payload, {});
});

test('claimCheckin surfaces already_claimed from the server', async () => {
  const client = new LobbyClient({
    transport: new ScriptedTransport(() => ({ ok: false, status: 409, error_code: 'already_claimed' })),
  });
  expectEqual(await client.claimCheckin(), null);
  expectEqual(client.lastError, 'already_claimed');
});

suite('shop client');

test('fetchShop maps the server products[] catalog (product_id / cost_kind / cost_amount)', async () => {
  const transport = new ScriptedTransport(() => ok(SHOP_BODY));
  const client = new LobbyClient({ transport });
  const view = await client.fetchShop();

  expect(view !== null, 'fetchShop should return a view');
  expectEqual(view?.currency, 'gold');
  expectDeepEqual(view?.wallet, { gold: 2000, gems: 300, card_dust: 0, chest_keys: 1, faith: 0, points: 0 });
  expectEqual(view?.items.length, 2);
  const first = view?.items[0];
  expectEqual(first?.itemId, 'card.focus_lens.single');
  expectDeepEqual(first?.price, { gold: 200 });
  expectDeepEqual(first?.grants, { item: 'focus_lens', count: 1 });
  // `daily_limit: 0` means unlimited, spelled `-1` in the view.
  expectEqual(first?.stock, -1);
  expectEqual(first?.purchasable, true);
  const limited = view?.items[1];
  expectEqual(limited?.itemId, 'chest.standard.pull');
  expectEqual(limited?.stock, 2);
  expectEqual(view?.serverTimeMs, Date.parse('2026-10-24T00:00:00Z'));
  expectEqual(transport.calls[0]?.id, 'shop.get');
});

test('fetchShop still accepts the legacy items[] shape', async () => {
  const transport = new ScriptedTransport(() => ok(SHOP_BODY_LEGACY));
  const client = new LobbyClient({ transport });
  const view = await client.fetchShop();

  expect(view !== null, 'fetchShop should return a view');
  expectEqual(view?.items.length, 1);
  const item = view?.items[0];
  expectEqual(item?.itemId, 'stamina_potion');
  expectEqual(item?.name, 'Stamina Potion');
  expectDeepEqual(item?.price, { gold: 300 });
  expectEqual(item?.stock, -1);
  expectEqual(item?.purchasable, true);
  expectDeepEqual(item?.grants, { item: 'stamina_potion', count: 1 });
});

test('purchaseShopItem sends product_id + quantity + nonce and maps the receipt', async () => {
  const transport = new ScriptedTransport(() =>
    ok({
      ok: true,
      wallet: { gold: 1800 },
      inventory: {
        items: [
          { card_id: 'focus_lens', copies: 4, level: 1 },
          { card_id: 'wide_arc', copies: 1, level: 1 },
        ],
      },
      granted: [{ type: 'card', item_id: 'focus_lens', amount: 1 }],
      receipt: {
        receipt_id: 'rcpt-1',
        product_id: 'card.focus_lens.single',
        quantity: 2,
        cost_kind: 'gold',
        cost_amount: 400,
      },
      server_authoritative: true,
      server_time: '2026-10-24T00:00:02Z',
    }),
  );
  const client = new LobbyClient({ transport });
  const purchase = await client.purchaseShopItem('card.focus_lens.single', 2);

  expectEqual(purchase?.itemId, 'card.focus_lens.single');
  expectEqual(purchase?.count, 2);
  // `spent` comes from the receipt, not from a client-supplied price.
  expectDeepEqual(purchase?.spent, { gold: 400 });
  expectDeepEqual(purchase?.wallet, { gold: 1800 });
  expectDeepEqual(purchase?.inventory, { focus_lens: 4, wide_arc: 1 });
  expectEqual(purchase?.serverTimeMs, Date.parse('2026-10-24T00:00:02Z'));
  expectEqual(transport.calls[0]?.id, 'shop.purchase');
  const payload = transport.calls[0]?.payload ?? {};
  expectEqual(payload.product_id, 'card.focus_lens.single');
  expectEqual(payload.quantity, 2);
  // The nonce is the server's idempotency key: required, and never reused.
  expect(typeof payload.nonce === 'string' && payload.nonce !== '', 'purchase must carry a nonce');
});

test('purchaseShopItem mints a fresh nonce per call', async () => {
  const transport = new ScriptedTransport(() =>
    ok({
      ok: true,
      wallet: { gold: 100 },
      receipt: { product_id: 'x', quantity: 1, cost_kind: 'gold', cost_amount: 10 },
      server_time: '2026-10-24T00:00:03Z',
    }),
  );
  const client = new LobbyClient({ transport });
  await client.purchaseShopItem('x');
  await client.purchaseShopItem('x');
  const first = transport.calls[0]?.payload ?? {};
  const second = transport.calls[1]?.payload ?? {};
  expect(first.nonce !== second.nonce, 'each purchase must use a distinct nonce');
});

test('purchaseShopItem defaults count to 1 and refuses an empty item id', async () => {
  const transport = new ScriptedTransport(() =>
    ok({
      ok: true,
      wallet: { gold: 100 },
      receipt: { product_id: 'x', quantity: 1, cost_kind: 'gold', cost_amount: 10 },
      server_time: '2026-10-24T00:00:04Z',
    }),
  );
  const client = new LobbyClient({ transport });
  await client.purchaseShopItem('x');
  const payload = transport.calls[0]?.payload ?? {};
  expectEqual(payload.product_id, 'x');
  expectEqual(payload.quantity, 1);
  expect(typeof payload.nonce === 'string' && payload.nonce !== '', 'purchase must carry a nonce');

  expectEqual(await client.purchaseShopItem(''), null);
  expectEqual(client.lastError, 'shop_purchase_missing_item');
  expectEqual(transport.calls.length, 1, 'an empty id must not reach the transport');
});

test('purchaseShopItem surfaces insufficient_funds', async () => {
  const client = new LobbyClient({
    transport: new ScriptedTransport(() => ({ ok: false, status: 409, error_code: 'insufficient_funds' })),
  });
  expectEqual(await client.purchaseShopItem('stamina_potion'), null);
  expectEqual(client.lastError, 'insufficient_funds');
});

suite('inventory / chests / decks / activity client');

test('fetchInventory maps the server card stacks and keeps raw', async () => {
  const transport = new ScriptedTransport(() =>
    ok({
      ok: true,
      user_id: 'u-1',
      ruleset_version: 'ruleset-local-s0',
      items: [
        { card_id: 'spell_reimu_a', copies: 2, level: 3, first_obtained_at: '2026-10-01T00:00:00Z' },
      ],
      server_authoritative: true,
      server_time: '2026-10-07T00:00:00Z',
    }),
  );
  const client = new LobbyClient({ transport });
  const view = await client.fetchInventory();
  expectEqual(view?.userId, 'u-1');
  expectEqual(view?.items.length, 1);
  expectEqual(view?.items[0]?.cardId, 'spell_reimu_a');
  expectEqual(view?.items[0]?.copies, 2);
  expectEqual(view?.items[0]?.level, 3);
  expectEqual(view?.items[0]?.firstObtainedAtMs, Date.parse('2026-10-01T00:00:00Z'));
  expectEqual(view?.serverTimeMs, Date.parse('2026-10-07T00:00:00Z'));
  expectEqual(transport.calls[0]?.id, 'inventory.get');
});

test('fetchChests maps owned chests and pools', async () => {
  const transport = new ScriptedTransport(() =>
    ok({
      ok: true,
      user_id: 'u-1',
      wallet: { gold: 700 },
      owned_chests: { standard: 2 },
      pools: [{ pool_id: 'standard', name: 'Standard', cost: { gold: 300 }, enabled: true }],
      server_time: '2026-10-07T00:00:00Z',
    }),
  );
  const client = new LobbyClient({ transport });
  const view = await client.fetchChests();
  expectDeepEqual(view?.ownedChests, { standard: 2 });
  expectEqual(view?.pools.length, 1);
  expectEqual(view?.pools[0]?.poolId, 'standard');
  expectEqual(view?.pools[0]?.enabled, true);
  expectDeepEqual(view?.pools[0]?.cost, { gold: 300 });
  expectEqual(transport.calls[0]?.id, 'chests.get');
});

test('openChest only sends pool_id + count and maps the reward list', async () => {
  const transport = new ScriptedTransport(() =>
    ok({
      ok: true,
      pool_id: 'standard',
      count: 1,
      wallet: { gold: 400 },
      owned_chests: { standard: 1 },
      results: [{ id: 'r-1', card_id: 'spell_reimu_a', rarity: 'rare' }],
      server_time: '2026-10-07T00:00:00Z',
    }),
  );
  const client = new LobbyClient({ transport });
  const result = await client.openChest('standard', 1);
  expectEqual(result?.poolId, 'standard');
  expectEqual(result?.results.length, 1);
  expectEqual(result?.results[0]?.card_id, 'spell_reimu_a');
  expectEqual(transport.calls[0]?.id, 'chests.open');
  expectDeepEqual(transport.calls[0]?.payload, { pool_id: 'standard', count: 1 });

  expectEqual(await client.openChest(''), null);
  expectEqual(client.lastError, 'chest_open_missing_pool');
});

test('fetchDecks maps the deck list and saveDeck refreshes it', async () => {
  const transport = new ScriptedTransport((request) =>
    request.id === 'decks.save'
      ? ok({ ok: true, deck: { deck_id: 'd-1' }, active_deck_id: 'd-1' })
      : ok({
          ok: true,
          user_id: 'u-1',
          active_deck_id: 'd-1',
          ruleset_version: 'ruleset-local-s0',
          decks: [{ deck_id: 'd-1', name: 'Main', card_ids: ['a', 'b'] }],
          server_time: '2026-10-07T00:00:00Z',
        }),
  );
  const client = new LobbyClient({ transport });
  const decks = await client.fetchDecks();
  expectEqual(decks?.activeDeckId, 'd-1');
  expectEqual(decks?.decks.length, 1);

  const saved = await client.saveDeck({ deckId: 'd-1', name: 'Main', cardIds: ['a', 'b'], active: true });
  expectEqual(saved?.activeDeckId, 'd-1');
  expectEqual(transport.calls[1]?.id, 'decks.save');
  expectDeepEqual(transport.calls[1]?.payload, {
    deck_id: 'd-1',
    name: 'Main',
    format: '',
    card_ids: ['a', 'b'],
    active: true,
  });
  expectEqual(transport.calls[2]?.id, 'decks.list', 'saveDeck re-reads the list');
});

test('claimActivity maps the claim result and refuses an empty id', async () => {
  const transport = new ScriptedTransport(() =>
    ok({
      ok: true,
      duplicate: false,
      claim_kind: 'task',
      claim_id: 'daily-win',
      user_id: 'u-1',
      claimed: true,
      reward_status: 'credited',
      settlement_key: 'settle-1',
    }),
  );
  const client = new LobbyClient({ transport });
  const claim = await client.claimActivity('daily-win');
  expectEqual(claim?.claimed, true);
  expectEqual(claim?.claimId, 'daily-win');
  expectEqual(claim?.rewardStatus, 'credited');
  // The server only validates `task` / `event` / `leaderboard`
  // (`isValidClaimKind`); `task` is the default for the activity centre.
  expectDeepEqual(transport.calls[0]?.payload, { claim_kind: 'task', claim_id: 'daily-win' });

  const eventClaim = await client.claimActivity('season-1', 'event');
  expectEqual(eventClaim !== null, true);
  expectDeepEqual(transport.calls[1]?.payload, { claim_kind: 'event', claim_id: 'season-1' });

  expectEqual(await client.claimActivity(''), null);
  expectEqual(client.lastError, 'activity_claim_missing_id');
});

suite('check-in / shop REST routes');

test('the HTTP transport maps the new business routes onto /v1 paths', async () => {
  const seen: Array<{ method: string; path: string }> = [];
  const http: HttpClient = {
    async request(method, path): Promise<HttpResponseLike> {
      seen.push({ method, path });
      return { status: 200, body: { ok: true, days: [], items: [] } };
    },
  };
  const transport = new HttpLobbyTransport(http);
  await transport.call({ id: 'checkin.get' });
  await transport.call({ id: 'checkin.claim' });
  await transport.call({ id: 'shop.get' });
  await transport.call({ id: 'shop.purchase' });
  await transport.call({ id: 'inventory.get' });
  await transport.call({ id: 'chests.get' });
  await transport.call({ id: 'chests.open' });
  await transport.call({ id: 'decks.list' });
  await transport.call({ id: 'decks.save' });
  await transport.call({ id: 'activity.claim' });

  expectDeepEqual(seen, [
    { method: 'GET', path: '/v1/checkin' },
    { method: 'POST', path: '/v1/checkin/claim' },
    { method: 'GET', path: '/v1/shop' },
    { method: 'POST', path: '/v1/shop/purchase' },
    { method: 'GET', path: '/v1/inventory' },
    { method: 'GET', path: '/v1/chests' },
    { method: 'POST', path: '/v1/chests/open' },
    { method: 'GET', path: '/v1/decks' },
    { method: 'POST', path: '/v1/decks/save' },
    { method: 'POST', path: '/v1/activity/claim' },
  ]);
});

suite('LobbyFlow business screens');

test('openCheckin switches to the check-in screen and loads the cycle', async () => {
  const transport = new ScriptedTransport(() => ok(CHECKIN_BODY));
  const flow = new LobbyFlow(new LobbyClient({ transport }));
  expectEqual(await flow.openCheckin(), true);
  expectEqual(flow.currentScreen, LobbyScreen.Checkin);
  const snapshot = flow.snapshot();
  expectEqual(snapshot.checkin?.streak, 2);
  expectEqual(snapshot.checkin?.days.length, 4);
});

test('claimCheckin refreshes the cycle after a successful claim', async () => {
  const transport = new ScriptedTransport((request) =>
    request.id === 'checkin.claim'
      ? ok({ ok: true, day: 3, reward: { gold: 200 }, wallet: { gold: 700 }, streak: 3, next_claimable_day: 4 })
      : ok(CHECKIN_BODY),
  );
  const flow = new LobbyFlow(new LobbyClient({ transport }));
  expectEqual(await flow.claimCheckin(), true);
  // The claim posts, then the flow re-reads the cycle.
  expectDeepEqual(transport.calls.map((call) => call.id), ['checkin.claim', 'checkin.get']);
});

test('claimCheckin reports a failure without switching screens', async () => {
  const transport = new ScriptedTransport(() => ({ ok: false, status: 409, error_code: 'already_claimed' }));
  const flow = new LobbyFlow(new LobbyClient({ transport }));
  expectEqual(await flow.claimCheckin(), false);
  expectEqual(flow.snapshot().lastError, 'Check-in claim failed: already_claimed');
});

test('openShop + purchaseItem switch screens and refresh the wallet', async () => {
  const transport = new ScriptedTransport((request) =>
    request.id === 'shop.purchase'
      ? ok({
          ok: true,
          wallet: { gold: 400 },
          receipt: { product_id: 'card.focus_lens.single', quantity: 1, cost_kind: 'gold', cost_amount: 200 },
          server_time: '2026-10-24T00:00:05Z',
        })
      : ok(SHOP_BODY),
  );
  const flow = new LobbyFlow(new LobbyClient({ transport }));
  expectEqual(await flow.openShop(), true);
  expectEqual(flow.currentScreen, LobbyScreen.Shop);
  expectEqual(flow.snapshot().shop?.items.length, 2);

  expectEqual(await flow.purchaseItem('card.focus_lens.single', 1), true);
  expectDeepEqual(
    transport.calls.map((call) => call.id),
    ['shop.get', 'shop.purchase', 'shop.get'],
  );
  expectEqual(flow.snapshot().lastError, '');
});

test('purchaseItem reports insufficient_funds on the shop screen', async () => {
  const transport = new ScriptedTransport((request) =>
    request.id === 'shop.purchase' ? { ok: false, status: 409, error_code: 'insufficient_funds' } : ok(SHOP_BODY),
  );
  const flow = new LobbyFlow(new LobbyClient({ transport }));
  expectEqual(await flow.purchaseItem('card.focus_lens.single'), false);
  expectEqual(flow.snapshot().lastError, 'Purchase failed: insufficient_funds');
});

test('openInventory switches to the inventory screen and loads the stacks', async () => {
  const transport = new ScriptedTransport(() =>
    ok({
      ok: true,
      user_id: 'u-1',
      items: [{ card_id: 'c-1', copies: 1, level: 1 }],
      server_time: '2026-10-07T00:00:00Z',
    }),
  );
  const flow = new LobbyFlow(new LobbyClient({ transport }));
  expectEqual(await flow.openInventory(), true);
  expectEqual(flow.currentScreen, LobbyScreen.Inventory);
  expectEqual(flow.snapshot().inventory?.items.length, 1);
});
