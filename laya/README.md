# Phantasm Klash — LayaAir 3 client (`laya/`)

TypeScript client for **Phantasm Klash / SpellKard**, replacing the Godot client
(`../godot/`, kept as a porting reference). It talks to two upstream services:

| Channel | Upstream | Transport |
| --- | --- | --- |
| Lobby / business | **Gensoulkyo** (Go) | HTTP REST + Nakama-style WSS (`runtime/httpapi`, `runtime/nakamaapi`) |
| Boss-race battle | **PhK-BattleServer** (C++) | KCP over UDP (standard skywind3000/ikcp wire format) |

## Layout

```
laya/
  index.html           runnable bootstrap: loads engine/libs/*.js then dist/ (no IDE needed)
  dev/serve.mjs        zero-dependency static server used by `npm run dev`
  src/core/            engine-agnostic layer — NO LayaAir imports, checked by tsconfig.json
    math/              deterministic math: FNV-1a/mix32 (Godot + boss-race conventions), 64-bit FNV/BigInt
    protocol/          hand-rolled dependency-free protobuf codec + phk.v1 message types
    net/               lobby client (WS/HTTP), KCP port (ikcp.ts), battle wire codec, battle client
    sim/               authoritative boss-race simulation mirroring PhK-BattleServer/src/boss_race.cpp
    game/              input encoding, view model, lobby screen flow
  src/platform/laya/   LayaAir adapters: Socket, Timer, input, BossRaceView, 4 scenes, app wiring
  src/platform/laya/main.ts  browser entry point loaded by index.html
  src/platform/web/    browser adapters: WebSocket, fetch, timer, WS-relay datagram, WebCrypto AEAD/ECDH
  types/laya.d.ts      hand-written LayaAir shim (see "Engine integration")
  engine/libs/*.js     vendored LayaAir 3.3.13 runtime
  tests/               zero-dependency test runner + suites
  tools/               gen_protocol.mjs, fetch_engine.mjs, fix_esm_imports.mjs
```

The **core layer is the deliverable that must type-check on its own**. Everything
under `src/core/` compiles with `lib: ["ES2020"]`, `types: []` and no DOM — it
depends only on injected interfaces (`SocketLike`, `DatagramLike`, `TimerLike`,
`HttpClient`, `BattleCipher`, `KeyAgreement`) declared in `src/core/net/`.

## Commands

```bash
npm install            # only devDependency: typescript
npm run typecheck      # tsc -p tsconfig.json      --noEmit  (core layer only)
npm run typecheck:full # tsc -p tsconfig.full.json --noEmit  (core + adapters + laya.d.ts)
npm test               # compiles tests and runs them on node (no test framework)
npm run check          # typecheck + test
npm run build          # compiles the whole client to dist/ as loadable ES modules
npm run dev            # build, then serve index.html at http://127.0.0.1:8080
npm run serve          # static server only (assumes dist/ is already built)
npm run build:core     # emits dist/ with .d.ts for the core layer
```

## Engine integration

**How the engine was obtained.** LayaAir 3 is not distributed as a usable npm
package — the registry entry `layaair@1.0.1` is a stale, unrelated artifact. The
runtime is published as a GitHub release archive:

```
https://github.com/layabox/LayaAir/releases/download/v3.3.13/LayaAir_3.3.13_libs.zip
```

`tools/fetch_engine.mjs` downloads and flattens that archive into `engine/libs/`
and is the supported way to bump the version:

```bash
node tools/fetch_engine.mjs 3.3.13     # or LAYA_ENGINE_VERSION=... npm run ...
```

The six resulting `engine/libs/*.js` files are **committed** so the scaffold is
runnable offline; the release zip itself is cached under `engine/.cache/`
(gitignored).

**Why `types/laya.d.ts` is hand-written.** The official `.d.ts` bundle is produced
by the LayaAir IDE, which is not part of this repository. `types/laya.d.ts` declares
only the surface this client touches (`Sprite`, `Text`, `Stage`, `Socket`, `Timer`,
`Browser`, `Event`, …) so `npm run typecheck:full` is honest without vendoring a
~10 MB declaration set. When the IDE is wired into CI, replace it with the
engine-generated `laya.d.ts` and drop the shim.

## Running locally

The client runs from a plain static server — **no LayaAir IDE project is
required**. `index.html` loads the vendored runtime with ordinary `<script>`
tags and then loads the compiled client as one ES module:

```bash
cd laya
npm install          # typescript only, offline-cacheable
npm run dev          # builds dist/ and serves http://127.0.0.1:8080/
```

Open <http://127.0.0.1:8080/> and the lobby screen renders. `npm run build`
alone produces the browser bundle; `npm run serve` serves an existing build
(`PORT=9000 npm run serve` to change the port).

**How the build works.** `tsconfig.browser.json` emits the whole client
(`src/core` + `src/platform` + the `src/platform/laya/main.ts` entry) to `dist/`
as ES modules. TypeScript keeps relative specifiers verbatim, so
`tools/fix_esm_imports.mjs` appends the missing `.js` extension afterwards —
that is the entire "bundler". `dist/` is gitignored; rebuild after editing
`src/`.

**Configuring the upstreams.** `index.html` sets
`window.PHANTASM_KLASH_CONFIG` and every field can be overridden per-URL:

```
http://127.0.0.1:8080/?lobbyHttpBase=https://lobby.example&lobbyWsUrl=wss://lobby.example/ws
```

| Field | Meaning |
| --- | --- |
| `stageWidth` / `stageHeight` | Design resolution passed to `Laya.init` |
| `lobbyHttpBase` | Gensoulkyo REST base. Empty = same origin |
| `lobbyWsUrl` | Nakama-style lobby WSS url. Empty = use the REST transport |
| `relayUrl` | WebSocket relay that tunnels battle KCP datagrams. Empty = offline battle |
| `backgroundColor` | Stage clear colour |

With the defaults (no server) the lobby still renders and sign-in simply
reports a transport error; point `lobbyHttpBase` at a running Gensoulkyo to sign
in for real. The battle channel only connects when `relayUrl` is set.

`src/platform/laya/main.ts` resolves this config, awaits `Laya.init(...)` (it is
asynchronous in LayaAir 3) and then instantiates `SpellKardApp` from
`src/platform/laya/app.ts`. A LayaAir IDE project can still be generated later
to replace `index.html`, but nothing in the build depends on it.

## Protocol

`src/core/protocol/` mirrors the `phk.v1` protobuf contract with a small
hand-rolled codec (varint + length-delimited, proto3 defaults applied on decode).
The message/field tables in `codec.ts` carry the exact field numbers.

`tools/gen_protocol.mjs` regenerates `src/core/protocol/descriptor.generated.ts`
from `../PhK-Protocol/descriptors/phk_v1_descriptor.json`:

```bash
node tools/gen_protocol.mjs
node tools/gen_protocol.mjs ../PhK-Protocol/descriptors/phk_v1_descriptor.json
```

**Important divergence.** The KCP battle channel does **not** use protobuf. The
authoritative implementation is `PhK-BattleServer/src/match_lifecycle.cpp`:

* `BattleInput` is a hand-rolled **little-endian** struct (payload type byte,
  protocol version `u32`, length-prefixed `match_id`/`player_id`, `tick`/`seq`
  `u64`, `direction_bits` `u32`, flags byte, `card_slot` `i8`, `mode_action_id`).
* Snapshots and results are `[0x04] + JSON` and `[0x08] + JSON`.
* `MatchServer::HandleSessionPayload` decodes inputs with **no handshake** and
  binds the session to `player_by_conv_` from the KCP `conv`.

`src/core/net/battle_codec.ts` implements exactly this wire format, and
`src/core/net/battle_client.ts` derives the `conv` locally with
`deriveDevKcpConv(match_id, player_id)` (`src/core/math/hash64.ts`). The protobuf
`battle.proto` messages remain mirrored as the long-term contract.

Two conventions worth calling out because they are easy to get wrong:

* **Input bits differ between the Godot client and the server.** Server /
  `boss_race.cpp`: `up=0x1, right=0x2, down=0x4, left=0x8`. Godot
  (`input_codec.gd`): `left=1, right=2, up=4, down=8`. The TS core uses the
  **server** layout.
* **64-bit FNV-1a uses a non-canonical offset basis** (`1469598103934665603`, not
  `14695981039346656037`) in `handshake.cpp`. `hash64.ts` reproduces it with
  `BigInt`, which is why the tsconfig targets ES2020.

## Deterministic parity

`src/core/sim/boss_race.ts` mirrors `PhK-BattleServer/src/boss_race.cpp`:
60 Hz ticks, Boss HP 6000, 10 damage per shooting tick, a new pattern every 45
ticks, 10 patterns, arena `±120000 × ±90000` milli-units, `3000` milli-units of
movement per tick, and the boss-race RNG convention
`Mix32(Fnv1a32("seed:tick:pattern_index:spawn_index") ^ seed)`.

`canonicalStateHash()` produces the `%08x%08x` pair used for
snapshot reconciliation. `tests/deterministic.test.ts` pins the hash inputs to
independently computed values, and `tests/boss_race_sim.test.ts` pins the tick
schedule, bullet counts, damage and winner behaviour.

## Reconciliation

`BattleClient` keeps a local prediction of the authoritative simulation and
classifies each incoming server snapshot:

| Position error | Action |
| --- | --- |
| `< 3000` milli | smooth (blend) |
| `< 24000` milli | interpolate toward the server state |
| otherwise | hard snap |

Metrics (`snapshotsReceived`, `averagePositionErrorMilli`, `hashMatches`,
`hashMismatches`, `hardSnaps`) are surfaced on the battle HUD.

## Test suite

`npm test` runs a zero-dependency runner (`tests/harness.ts`) over 44 tests:
deterministic math parity, protobuf round-trips, the battle wire codec,
boss-race simulation parity, a KCP loopback harness that delivers ordered
messages under 20 % packet loss, and the matchmaking queue (RPC payload mapping,
REST routes and the `LobbyFlow` queue actions).

## Not yet wired

* **Battle AEAD / key agreement.** `battle_crypto.ts` defines the
  `BattleCipher` / `KeyAgreement` interfaces plus a `PlaintextCipher` dev
  implementation, and `src/platform/web/web_crypto_cipher.ts` provides a
  WebCrypto X25519 + HKDF-SHA256 agreement and ChaCha20-Poly1305 AEAD. The
  server currently accepts plaintext dev sessions
  (`MatchServer::HandleSessionPayload`), so the handshake is not yet enforced
  end-to-end. XChaCha20 is not available in Web Crypto, so only
  ChaCha20-Poly1305 is advertised.
* **Web battle transport.** Native builds use UDP directly. The browser needs the
  lobby WebSocket to relay KCP datagrams; `src/platform/web/ws_relay_datagram.ts`
  implements the client side but **Gensoulkyo does not expose that relay endpoint
  yet** (`WsRelayDatagramFactory` documents the expected frame shape).
* **Matchmaking queue.** `LobbyClient.joinMatchmaking` / `fetchMatchmakingTicket`
  / `cancelMatchmaking` wrap the `matchmaking.join` / `.ticket` / `.cancel` RPCs,
  and `LobbyScene` exposes join / refresh / cancel buttons plus a live queue
  status line. There is no automatic poll loop yet: the player refreshes the
  ticket manually, and a `match_start` push clears the ticket.
* **Card / bomb / focus mechanics.** `card_slot`, `bomb` and `slow` are encoded
  and transmitted, and `slow` is captured by `LayaInput`; the boss-race
  simulation currently only consumes movement + shoot.
