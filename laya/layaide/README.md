# `layaide/` — LayaAir IDE project (Windows native client)

This is the **LayaAir IDE 3.4.1 project** for Phantasm Klash. Opening this
directory in the IDE and hitting *发布 → Windows* produces a standalone
`LayaBox.exe` client — the Windows player of LayaNative, no Electron, no browser
shell.

The client code is **not duplicated here**: `src/SpellKardBoot.ts` is the only
file the IDE knows about, and it imports the real client from `../src/`
(`../../src/platform/laya/main`), so the IDE bundles the exact same sources that
`npm run build` compiles for the browser. There is a single source of truth.

```
layaide/
  SpellKard.laya                        project descriptor ({"version":"3.4.1"})
  assets/Scene.ls (+ .ls.meta)          startup scene; attaches SpellKardBoot
  src/SpellKardBoot.ts (+ .ts.meta)     IDE entry script -> startClient(config)
  settings/BuildSettings.json           name + startupScene + windows.renderMode
  settings/EditorSettings.json          layers
  settings/PlayerSettings.json          enabled engine modules (laya.ui)
  tsconfig.json                         IDE TS config (es2020 + decorators)
  engine/types/                         LayaAir.d.ts, populated by the IDE
  build-templates/windows/release/      merged into the published Windows dir
    config.ini                          LoadExtension=true, 960x720 desktop window
    spk_udp.layaext.json                spk_udp extension descriptor
    spk_udp.dll                         produced by the MSVC project below
  tools/check_project.mjs               structural self-check (`npm run ide:check`)
```

> **Why `target: es2020` in `tsconfig.json`?** The client's deterministic math
> uses `BigInt` (`src/core/math/hash64.ts`), which is ES2020. The stock LayaAir
> template ships `target: es6`; leaving it would make the IDE's TypeScript
> service reject the client.

> **Why does `SpellKardBoot.ts` import from outside the project directory?**
> esbuild (the IDE's bundler) resolves relative imports from the importing file,
> not from the project root, so `../../src/...` resolves to the real client
> source and is bundled normally. If a future IDE version starts restricting the
> asset database to the project root, copy `../src/` to `src/client/` and change
> the one import — nothing else changes.

---

## 1. Install the IDE and the Windows Build Support module

1. Install the LayaAir IDE 3.4.1+ for Windows
   (<https://layaair.com/3.x/doc/basics/developmentEnvironment/download/readme.html>),
   or the CLI (`layabox/layaair-cli`, Node 20+):
   ```powershell
   iwr https://raw.githubusercontent.com/layabox/layaair-cli/master/install.ps1 | iex
   layaair install 3.4.1
   ```
2. In the IDE open **项目设置 → 模块 / Module Manager** and install
   **Windows 构建支持 / Windows Build Support**.
   The module is a public download (the IDE fetches it automatically):
   ```
   https://ldc-1251285021.file.myqcloud.com/layaair-modules/windows-support-for-3.4.1.zip
   ```
   It contains the Windows `LayaBox.exe` player, the MSVC project templates, and
   the real `extension/LayaExtension.h` + `jsvm/JSVM.h` + `conch.lib`.
   To keep a copy outside the IDE (for the C++ build) run:
   ```bash
   npm run fetch:windows        # -> native/windows/sdk/  (gitignored)
   ```

## 2. Open the project

1. IDE → **打开项目 / Open Project** → select this `layaide/` directory (the
   descriptor is `SpellKard.laya`).
2. The IDE creates `library/`, `local/`, `temp/` and copies `LayaAir.d.ts` into
   `engine/types/`. All four are gitignored.
3. Check **项目设置 → 启动场景 / Startup scene**: it must be
   `res://a1f3c2d4-5b6e-4a70-8c91-2d3e4f506172` (`assets/Scene.ls`), which already
   has `SpellKardBoot` attached. `npm run ide:check` verifies this wiring.

## 3. Build the `spk_udp` extension (raw UDP for the battle channel)

The battle channel speaks KCP over raw UDP. LayaNative's JS has no UDP socket,
so `spk_udp.dll` provides one (sources in `../native/udp_ext/`).

1. Set the SDK root to the Windows Build Support runtime directory:
   ```powershell
   $env:LAYANATIVE_SDK_ROOT = "D:\path\to\windows-support-for-3.4.1\project\Runtime\x64\release"
   # or, if you ran `npm run fetch:windows`:
   # $env:LAYANATIVE_SDK_ROOT = "$PWD\native\windows\sdk\project\Runtime\x64\release"
   ```
   It must contain `include\jsvm\JSVM.h`, `include\extension\LayaExtension.h` and
   `lib\conch.lib`.
2. Open `../native/udp_ext/windows/extension.vcxproj` in Visual Studio
   (toolset **v145**, `Release|x64`) and build. The output lands directly in
   `layaide/build-templates/windows/release/spk_udp.dll`, next to the descriptor.
   The project's `ValidateDependencies` target fails fast with a readable message
   if `LAYANATIVE_SDK_ROOT` is wrong.
3. `build-templates/windows/release/config.ini` already sets
   `LoadExtension=true`; without it the runtime never scans for `.layaext.json`.

> The C++ sources are shared with the Linux/CI build (`../native/udp_ext/CMakeLists.txt`),
> which compiles them against `../native/udp_ext/include/` — a shim that mirrors
> the real headers byte-for-byte at the API level so `main.cpp` is syntax-checked
> on Linux. **The shim is never used for the Windows build.**

## 4. Publish for Windows

1. IDE → **发布 / Build & Publish** → platform **Windows** → **构建 / Build**.
2. Output directory: the IDE's build settings (default `release/windows/`). It
   contains `LayaBox.exe`, the runtime DLLs, `scripts/`, `resources/`, plus
   everything merged from `build-templates/windows/release/`
   (`config.ini`, `spk_udp.layaext.json`, `spk_udp.dll`).
3. Run `LayaBox.exe`. The lobby connects to `lobbyWsUrl`; the battle channel
   opens a raw UDP socket through `spk_udp` when the server is reachable, and
   falls back to the WS relay (`relayUrl`) otherwise.

**Assembling the directory by hand.** If you would rather compose the runnable
directory yourself (or verify what the IDE produced), use:

```bash
npm run assemble:windows -- --app "<IDE release dir>"
```

It copies the Windows runtime from `native/windows/sdk/x64/Release/`, strips the
support package's sample `my_extension.*`, merges
`layaide/build-templates/windows/release/` on top, and (with `--app`) the
IDE-published payload. Output defaults to `dist-windows/` (gitignored).

**Endpoints** live in `src/SpellKardBoot.ts` (`DEFAULT_CONFIG`). Override them
without a rebuild by assigning `window.PHANTASM_KLASH_CONFIG` before the boot
script runs — e.g. drop a `scripts/preconfig.js` into
`build-templates/windows/release/` and reference it from the IDE's script list.

## 5. Verify the project structure

```bash
npm run ide:check        # from laya/, zero dependencies
```

It checks that the descriptor/engine version is >= 3.4.1, that every JSON file
parses, that `BuildSettings.startupScene` resolves to `assets/Scene.ls`, that the
scene's `_$comp` references `src/SpellKardBoot.ts`, and that the Windows payload
(`config.ini` with `LoadExtension=true`, `spk_udp.layaext.json`) is intact.
