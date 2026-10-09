# Phantasm Klash — LayaAir 3 client (`laya/`)

TypeScript client for **Phantasm Klash / SpellKard**, replacing the Godot client
(`../godot/`, kept as a porting reference). It talks to two upstream services:

| Channel | Upstream | Transport |
| --- | --- | --- |
| Lobby / business | **Gensoulkyo** (Go) | HTTP REST + lobby WS (`runtime/lobbyws`, `{"type","seq","payload"}` envelopes) |
| Boss-race battle | **PhK-BattleServer** (C++) | KCP over UDP (standard skywind3000/ikcp wire format) — raw UDP on native, WS relay in the browser |

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
  src/platform/laya/main.ts  browser/native entry point loaded by index.html (`bootstrap`, `startClient`)
  src/platform/web/    browser adapters: WebSocket, fetch, timer, WS-relay datagram, WebCrypto AEAD/ECDH
  src/platform/native/ LayaNative adapters: raw-UDP datagram backed by the spk_udp extension
  native/udp_ext/      LayaNative C++ UDP extension (source, descriptor, CMake + MSVC project)
  layaide/             LayaAir IDE 3.4.1 project -> Windows native client (see layaide/README.md)
  types/laya.d.ts      hand-written LayaAir shim (see "Engine integration")
  engine/libs/*.js     vendored LayaAir 3.3.13 runtime
  tests/               zero-dependency test runner + suites
  tools/               gen_protocol.mjs, fetch_engine.mjs, fetch_windows_support.mjs,
                       assemble_windows_client.mjs, fix_esm_imports.mjs
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
npm run fetch:windows  # downloads the LayaAir Windows Build Support runtime (~159 MB)
npm run assemble:windows  # composes a runnable Windows client dir from the runtime + extension
npm run ide:check      # structural self-check of the LayaAir IDE project (layaide/)
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
| `lobbyNakamaHttpBase` | Nakama RPC base. Empty = reuse `lobbyHttpBase` when `lobbyTransport=nakama_rpc` |
| `lobbyTransport` | `legacy_http` (default) or `nakama_rpc`; ignored when `lobbyWsUrl` is set |
| `nakamaHttpKey` | Nakama runtime HTTP key from `window.PHANTASM_KLASH_CONFIG`; never put credentials in URL query strings |
| `sessionStore` | Optional host-provided `LobbySessionStore` backed by platform-secure storage; omitted = in-memory session only |
| `lobbyWsUrl` | Lobby WS url (e.g. `ws://host:7350/v1/lobby/ws`). Empty = use the selected HTTP transport |
| `relayUrl` | WebSocket relay that tunnels battle KCP datagrams (e.g. `ws://host:7350/v1/battle/relay`). Empty = offline battle |
| `battleTransport` | `auto` (default) / `relay` / `udp`. `udp` uses the native `spk_udp` extension |
| `backgroundColor` | Stage clear colour |

With the defaults (no server) the lobby still renders and sign-in simply
reports a transport error; point `lobbyHttpBase` at a running Gensoulkyo to sign
in for real. The battle channel only connects when `relayUrl` is set (web) or
`spk_udp` is loaded (native).

For a Nakama RPC deployment, set `lobbyTransport: "nakama_rpc"` and
`lobbyNakamaHttpBase` in `window.PHANTASM_KLASH_CONFIG`, plus the runtime HTTP
key. The transport posts JSON-string RPC payloads to
`/v2/rpc/<rpc_id>?unwrap=true`, uses Basic auth for anonymous login, and switches
to the returned Bearer session token. It does not manufacture the authenticated
business envelope; callers must provide that envelope until the shared client
envelope builder is enabled.

Session resume is opt-in through a host-provided `sessionStore` implementing
`load`, `save`, and `clear`. The client does not write bearer tokens to browser
`localStorage` or `sessionStorage`; without a secure host adapter, sessions stay
in memory and a page reload requires login again.

### Lobby WebSocket protocol

`WsLobbyTransport` speaks Gensoulkyo's lobby WS protocol
(`runtime/lobbyws/protocol.go`). Every frame is a JSON envelope:

```json
{"type": 1, "seq": 7, "payload": { ... }}
```

`type` is a `phk.v1.LobbyMessageType` (1 auth request … 12 match result, 100
error); payload field names follow `lobby.proto`. The server never echoes `seq`,
so responses are correlated by message type. `RoomState` / `MatchStart` /
`MatchResult` pushes are surfaced as `LobbyEvent`s. Operations the WS protocol
does not define (matchmaking, battle ticket, replay, `rooms.get`, `match.ready`)
are delegated to an HTTP fallback transport. The envelope codec lives in
`src/core/net/lobby_protocol.ts`.

`src/platform/laya/main.ts` resolves this config, awaits `Laya.init(...)` (it is
asynchronous in LayaAir 3) and then instantiates `SpellKardApp` from
`src/platform/laya/app.ts`. A LayaAir IDE project can still be generated later
to replace `index.html`, but nothing in the build depends on it.

## Windows native client (LayaNative)

The same LayaAir project ships to Windows through **LayaNative**, LayaAir's
official native runtime — no Electron/Node shell. The client code is unchanged:
`main.ts` picks the raw-UDP battle channel when the `spk_udp` extension is
loaded (`battleTransport: auto`), and keeps the WS relay otherwise.

The Windows client is produced from the LayaAir IDE project in **`layaide/`** —
open it in the IDE and *发布 → Windows*. See `layaide/README.md` for the
step-by-step walkthrough. The short version:

```bash
npm install
npm run fetch:windows     # LayaAir Windows Build Support runtime + SDK (~159 MB)
npm run ide:check         # verify the layaide/ project wiring
# then, in the IDE: open layaide/, build the extension, 发布 → Windows
```

### Where the Windows runtime comes from

LayaNative's Windows runtime is **not** an npm package and **not** on GitHub
releases. It ships as the LayaAir **Windows Build Support** module, a public
Tencent-COS download whose URL the IDE/CLI read from its own module manifest
(`<layaair-cli>/Resources/modules.json`, entry `id: "windows"`):

```
https://ldc-1251285021.file.myqcloud.com/layaair-modules/windows-support-for-3.4.1.zip
```

| | |
| --- | --- |
| Size | 158,950,350 bytes (~159 MB download, ~476 MB extracted) |
| Player | `x64/Release/LayaBox.exe` (the thin `wWinMain` -> `conchMain` launcher) |
| Runtime | `project/Runtime/x64/release/bin/*.dll` (`conch.dll`, `v8.dll`, `libGLESv2.dll`, `OpenAL32.dll`, `layax_ffi.dll`, …) |
| SDK headers | `project/Runtime/x64/release/include/{extension/LayaExtension.h, jsvm/JSVM.h}` |
| Import lib | `project/Runtime/x64/release/lib/conch.lib` |
| MSVC templates | `project/LayaBox.{vcxproj,slnx}`, `project/extension/extension.vcxproj` |

`npm run fetch:windows` downloads it into `native/windows/sdk/` (gitignored) and
verifies the required files. **A Linux host cannot compile the Windows client**
(MSVC + `v145` toolset); the IDE/VS build must run on Windows.

`npm run assemble:windows` composes a runnable directory from that runtime plus
this project's `layaide/build-templates/windows/release/` payload (config.ini
with `LoadExtension=true`, the `spk_udp` descriptor, `spk_udp.dll` when built):

```bash
npm run assemble:windows                          # runtime shell (boots the LayaAir demo)
npm run assemble:windows -- --app <published-dir> # + the IDE-published SpellKard app
```

The application payload itself (compiled scripts, `resources/`, the runtime's
`scripts/index.js`) is produced by the IDE's Windows publish — `--app` copies it
on top of the assembled runtime.

Two other sources were probed and ruled out:

* `layanative3` (npm, latest `1.0.8`) — its SDK archives
  (`https://www.layabox.com/layanative3.0/layanativeRes/release-v3.1.6.zip`)
  contain **only** `android_studio/` and `ios/`; `createapp` has no Windows
  target.
* `github.com/layabox` releases — no Windows runtime assets; `LayaAir-Steam` is
  the official *example* of the extension API (it is where the `.layaext.json`
  v1 format and the `build-templates/windows/release/` merge convention were
  confirmed from).

### Why 3.4.1 is the floor

The cross-platform extension mechanism (JSVM API + `extension/LayaExtension.h`
+ `.layaext.json` + `LayaExtensionInterface.get_env()/get_exports()`) was
introduced in **LayaAir 3.4.1**. Older runtimes only have the deprecated
Windows-only extension API. `npm run ide:check` fails if the project descriptor
drops below 3.4.1.

### Extension source layout

```
native/udp_ext/
  src/udp_socket.{h,cpp}   portable non-blocking UDP core (no Laya dependency)
  src/main.cpp             LayaNative entry + JSVM glue -> global `spk_udp`
  src/udp_selftest.cpp     loopback smoke test for the UDP core
  include/extension/LayaExtension.h   compile-verification shim (mirrors the real header)
  include/jsvm/JSVM.h                 compile-verification shim (mirrors the real header)
  windows/extension.vcxproj           MSVC project -> layaide/build-templates/windows/release/spk_udp.dll
  spk_udp.layaext.json     extension descriptor
  CMakeLists.txt           Linux/CI build (shim) + selftest
  README.md                build & wiring instructions
```

The `include/` shim is a byte-level mirror of the **real** 3.4.1 headers at the
API level (verified against `Runtime/x64/release/include/…` from the support
package), so `main.cpp` is genuinely syntax-checked on Linux CI. It is never
used for the Windows build — the SDK header wins.

The extension is **poll-based**: JS calls `spk_udp.recvFrom(handle, buffer)` on a
timer and the extension writes the datagram into the caller's `ArrayBuffer`. That
avoids cross-thread `post_to_js` marshalling and keeps the JSVM surface to
ints + ArrayBuffers. `src/platform/native/native_udp_datagram.ts` wraps it as a
core `DatagramLike`, so `KcpSession` is unchanged.

The lobby talks to `lobbyWsUrl`; the battle channel opens a raw UDP socket to the
endpoint from `MatchStartMessage` (`host:<port>`). Because the deployment sits
behind NAT, keep `battleTransport: auto`/`relay` as a fallback — if the battle
server's UDP port is not reachable from outside, the client tunnels KCP over
`ws://host:7350/v1/battle/relay` (Gensoulkyo's relay, `runtime/lobbyws`) instead.

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

`npm test` runs a zero-dependency runner (`tests/harness.ts`) over 69 tests:
deterministic math parity, protobuf round-trips, the battle wire codec,
boss-race simulation parity, a KCP loopback harness that delivers ordered
messages under 20 % packet loss, the matchmaking queue (RPC payload mapping,
REST routes and the `LobbyFlow` queue actions), the lobby WS envelope
codec/transport (`lobby_ws_protocol.test.ts`), and the native UDP datagram
adapter (`native_udp_datagram.test.ts`).

## Not yet wired

* **Battle AEAD / key agreement.** `battle_crypto.ts` defines the
  `BattleCipher` / `KeyAgreement` interfaces plus a `PlaintextCipher` dev
  implementation, and `src/platform/web/web_crypto_cipher.ts` provides a
  WebCrypto X25519 + HKDF-SHA256 agreement and ChaCha20-Poly1305 AEAD. The
  server currently accepts plaintext dev sessions
  (`MatchServer::HandleSessionPayload`), so the handshake is not yet enforced
  end-to-end. XChaCha20 is not available in Web Crypto, so only
  ChaCha20-Poly1305 is advertised.
* **Battle transport.** Native builds open a raw UDP socket through the
  `spk_udp` LayaNative extension (`src/platform/native/native_udp_datagram.ts`).
  The browser cannot open UDP, so it tunnels KCP datagrams through
  `ws://host:7350/v1/battle/relay`; `src/platform/web/ws_relay_datagram.ts`
  implements the client side and Gensoulkyo's `lobbyws.HandleRelay` implements
  the server side. `battleTransport` selects the channel (`auto` prefers UDP
  when `spk_udp` is present).
* **Matchmaking queue.** `LobbyClient.joinMatchmaking` / `fetchMatchmakingTicket`
  / `cancelMatchmaking` wrap the `matchmaking.join` / `.ticket` / `.cancel` RPCs,
  and `LobbyScene` exposes join / refresh / cancel buttons plus a live queue
  status line. There is no automatic poll loop yet: the player refreshes the
  ticket manually, and a `match_start` push clears the ticket.
* **Card / bomb / focus mechanics.** `card_slot`, `bomb` and `slow` are encoded
  and transmitted, and `slow` is captured by `LayaInput`; the boss-race
  simulation currently only consumes movement + shoot.
