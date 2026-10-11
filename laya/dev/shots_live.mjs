/**
 * Portrait shots driven by *real server payloads* captured from a live
 * Gensoulkyo run (see the e2e curl transcript). Instead of a network hop, the
 * page's `fetch` is stubbed to return those exact JSON bodies, so the shots
 * prove the client's field mapping renders server data — no tunnel flakiness.
 *
 * Usage: node dev/shots_live.mjs [outDir]
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/wjcwqc/.workbuddy-ai/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] ?? resolve(HERE, 'shots-live'));
const PORT = process.env.PORT ?? '8123';

mkdirSync(OUT, { recursive: true });

// --- verbatim payloads captured from the running server -------------------
const CHECKIN = {
  ok: true,
  user_id: 'user_000001',
  cycle_id: '2026-10',
  days: [
    { day: 1, reward: { gold: 100 }, claimed: true, claimable: false },
    { day: 2, reward: { gold: 150 }, claimed: false, claimable: true },
    { day: 3, reward: { gold: 200, ticket: 1 }, claimed: false, claimable: false },
    { day: 4, reward: { gold: 250 }, claimed: false, claimable: false },
    { day: 5, reward: { gold: 300 }, claimed: false, claimable: false },
    { day: 6, reward: { gold: 400 }, claimed: false, claimable: false },
    { day: 7, reward: { gold: 500, ticket: 2 }, claimed: false, claimable: false },
  ],
  streak: 1,
  next_claimable_day: 2,
  server_time_ms: 1791348363612,
};

const SHOP = {
  ok: true,
  currency: 'gold',
  wallet: { card_dust: 0, chest_keys: 1, gold: 1100, points: 0 },
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
    {
      item_id: 'gacha_ticket',
      name: 'Gacha Ticket',
      description: 'One pull on the standard banner.',
      price: { gold: 500 },
      grants: { item: 'gacha_ticket', count: 1 },
      stock: -1,
      purchased: 0,
      purchasable: true,
    },
    {
      item_id: 'card_dust_bundle',
      name: 'Card Dust Bundle',
      description: 'A bundle of card dust for upgrades.',
      price: { gold: 200 },
      grants: { item: 'card_dust', count: 50 },
      stock: -1,
      purchased: 0,
      purchasable: true,
    },
  ],
  server_time_ms: 1791348363720,
};

const INVENTORY = {
  ok: true,
  user_id: 'user_000001',
  ruleset_version: 'mvp_boss_race',
  items: [
    { card_id: 'card_pierce', copies: 3, level: 2, first_obtained_at: '2026-10-01T00:00:00Z' },
    { card_id: 'card_guard', copies: 1, level: 1, first_obtained_at: '2026-10-02T00:00:00Z' },
    { card_id: 'card_focus', copies: 5, level: 3, first_obtained_at: '2026-10-03T00:00:00Z' },
  ],
  wallet: { card_dust: 0, chest_keys: 1, gold: 1100, points: 0 },
  server_time: '2026-10-07T04:46:03Z',
};

const CHESTS = {
  ok: true,
  user_id: 'user_000001',
  ruleset_version: 'mvp_boss_race',
  wallet: { card_dust: 0, chest_keys: 1, gold: 1100, points: 0 },
  owned_chests: { standard: 1 },
  pools: [
    { pool_id: 'standard', name: 'Standard Chest', cost: { chest_keys: 1 }, enabled: true },
  ],
  server_time: '2026-10-07T04:46:03Z',
};

const LOGIN = {
  ok: true,
  user_id: 'user_000001',
  session_token: 'session_000002',
  display_name: 'e2e',
  created_at: '2026-10-07T04:45:57Z',
};

const SCENES = ['checkin', 'shop', 'inventory'];

const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

// Stub fetch *before* any app code runs, keyed on the URL suffix.
await page.addInitScript(
  ({ checkin, shop, inventory, chests, login }) => {
    const routes = [
      ['/v1/auth/anonymous', login],
      ['/v1/checkin', checkin],
      ['/v1/shop', shop],
      ['/v1/inventory', inventory],
      ['/v1/chests', chests],
    ];
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      for (const [suffix, body] of routes) {
        if (url.endsWith(suffix)) {
          return Promise.resolve(
            new Response(JSON.stringify(body), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
      }
      return realFetch(input, init);
    };
  },
  { checkin: CHECKIN, shop: SHOP, inventory: INVENTORY, chests: CHESTS, login: LOGIN },
);

await page.goto(`http://127.0.0.1:${PORT}/index.html?debug=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 20000 });
await page.waitForTimeout(400);

const loginResult = await page.evaluate(async () => {
  const app = window.__PK_APP__;
  try {
    await app.flow.signIn('e2e');
    return app.lobbyClient.session ? 'session ok' : 'no session';
  } catch (err) {
    return String(err);
  }
});
console.log('signIn ->', loginResult);
await page.waitForTimeout(600);

for (const name of SCENES) {
  const r = await page.evaluate(async (n) => {
    const app = window.__PK_APP__;
    try {
      if (n === 'checkin') await app.flow.openCheckin();
      else if (n === 'shop') await app.flow.openShop();
      else if (n === 'inventory') await app.flow.openInventory();
      return 'ok';
    } catch (err) {
      return String(err);
    }
  }, name);
  await page.waitForTimeout(700);
  const file = resolve(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  const snap = await page.evaluate(() => {
    const s = window.__PK_APP__?.flow.snapshot();
    return {
      screen: s?.screen,
      checkin: s?.checkin ? `${s.checkin.days?.length ?? 0} days, streak ${s.checkin.streak}, next ${s.checkin.nextClaimableDay}` : null,
      shop: s?.shop ? `${s.shop.items?.length ?? 0} items @ ${s.shop.currency}` : null,
      inventory: s?.inventory ? `${s.inventory.items?.length ?? 0} stacks` : null,
    };
  });
  console.log(`${r === 'ok' ? 'OK ' : 'ERR'} ${name} -> ${file}`);
  console.log('   snapshot:', JSON.stringify(snap));
}

await browser.close();
console.log('done');
