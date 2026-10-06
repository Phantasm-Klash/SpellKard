# `spk_udp` — LayaNative raw UDP extension

LayaNative has no raw UDP socket in JS. This extension exposes one as the global
object **`spk_udp`** so the battle KCP channel can run over real UDP on native
builds (Windows / Linux / Android / OHOS). The JS wrapper is
`../../src/platform/native/native_udp_datagram.ts`.

It uses the cross-platform extension mechanism introduced in **LayaAir 3.4.1**
(JSVM API + `extension/LayaExtension.h` + `.layaext.json`). See
<https://layaair.com/3.x/doc/released/native/extension/>.

## JS API

`spk_udp` is poll-based: `recvFrom` writes into a caller-owned `ArrayBuffer` and
returns the byte count. The sender address is read back with `lastRecvAddress`.
This keeps the JSVM surface to ints + ArrayBuffers and needs no cross-thread
`post_to_js`.

| Method | Returns | Notes |
| --- | --- | --- |
| `version(): string` | `"spellkard-udp/1.0.0"` | |
| `create(): number` | handle, or `-1` | |
| `bind(handle, address, port): number` | `1` ok, `0` fail | `"0.0.0.0"` + port `0` = ephemeral |
| `setNonBlocking(handle, flag): number` | `1` ok, `0` fail | always enable for the poll loop |
| `sendTo(handle, address, port, data): number` | bytes sent, or `-1` | `data` is an `ArrayBuffer` |
| `recvFrom(handle, buffer): number` | bytes, `0` none, `-1` error | writes into `buffer` |
| `lastRecvAddress(handle): string` | `"ip:port"` | sender of the last datagram |
| `localPort(handle): number` | bound port | |
| `close(handle): number` | `1` | |

## Files

```
src/udp_socket.{h,cpp}   portable non-blocking UDP core — NO Laya dependency
src/main.cpp             LayaNative entry + JSVM glue (registers `spk_udp`)
src/udp_selftest.cpp     loopback smoke test for the core
include/extension/LayaExtension.h   compile-verification SHIM (mirrors the real header)
include/jsvm/JSVM.h                 compile-verification SHIM (mirrors the real header)
windows/extension.vcxproj           MSVC Release|x64 project -> spk_udp.dll
spk_udp.layaext.json     extension descriptor (name must stay `spk_udp`)
CMakeLists.txt           Linux/CI build + selftest
```

## Where the real headers live

The real `extension/LayaExtension.h` and `jsvm/JSVM.h` ship inside the LayaAir
**Windows / Android / iOS / Linux / OHOS Build Support** module:

```
<support-package>/project/Runtime/<arch>/release/include/{extension/LayaExtension.h, jsvm/JSVM.h}
<support-package>/project/Runtime/<arch>/release/lib/conch.lib
```

For Windows, get the module with:

```bash
npm run fetch:windows      # from laya/ — downloads + extracts into native/windows/sdk/
```

or install **Windows 构建支持** from the LayaAir IDE's module manager. The
download is public:
`https://ldc-1251285021.file.myqcloud.com/layaair-modules/windows-support-for-3.4.1.zip`.

## Windows build (MSVC)

`windows/extension.vcxproj` builds `spk_udp.dll` and writes it straight into
`layaide/build-templates/windows/release/`, next to the descriptor, so the
LayaAir IDE merges both into the published Windows client directory.

1. Set the SDK root (the project also falls back to
   `native/windows/sdk/project/Runtime/x64/release` if you ran
   `npm run fetch:windows`):

   ```powershell
   $env:LAYANATIVE_SDK_ROOT = "D:\path\to\windows-support-for-3.4.1\project\Runtime\x64\release"
   ```

2. Open `windows/extension.vcxproj` in Visual Studio, select **Release|x64**
   (toolset `v145`, C++20, static CRT — matching the official LayaAir templates)
   and build. The `ValidateDependencies` target fails fast with a readable
   message when `LAYANATIVE_SDK_ROOT` is wrong or incomplete.

3. The build emits `spk_udp.dll` next to `spk_udp.layaext.json`. The published
   client must also have `config.ini` with:

   ```ini
   [common]
   LoadExtension=true
   ```

   (`layaide/build-templates/windows/release/config.ini` already sets it.)

4. `spk_udp.version()` should now be callable from the project's JS.

`extension.name` in `spk_udp.layaext.json` **must** equal `info->name` in
`main.cpp` (`"spk_udp"`), and the `libraries` value must equal the built DLL name.

## Linux build (CI / reference)

```bash
cmake -S . -B build -DSPK_USE_SHIM_HEADER=ON
cmake --build build
./build/spk_udp_selftest     # loopback UDP smoke test, exits 0 on success
```

For a real Linux runtime build, point the extension at the runtime's headers
(the Linux Build Support module ships the same layout as Windows):

```bash
cmake -S . -B build-real -DSPK_USE_SHIM_HEADER=OFF -DSPK_LAYANATIVE_INCLUDE=/path/to/runtime/include
cmake --build build-real      # produces libspk_udp.so
```

## ⚠️ About `include/`

`include/extension/LayaExtension.h` and `include/jsvm/JSVM.h` are
**compile-verification shims**, not the real headers. They reproduce the real
3.4.1 API exactly — verified symbol-for-symbol against
`Runtime/x64/release/include/…` from the Windows Build Support package and
against the official `layabox/LayaAir-Steam` extension sample — so `main.cpp`
is genuinely syntax-checked on Linux CI without the runtime.

* For CI, `-DSPK_USE_SHIM_HEADER=ON` puts `include/` on the include path.
* For a real build, **use the runtime's headers** — do not put this `include/`
  directory on the include path; the SDK header must win. The `windows/`
  vcxproj and the real-build CMake path both do this.

If the real headers ever drift, only `main.cpp` (the thin glue) may need a
signature tweak — `udp_socket.cpp` is pure C++ and unaffected.
