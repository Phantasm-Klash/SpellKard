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
include/extension/LayaExtension.h   compile-verification SHIM (see below)
spk_udp.layaext.json     extension descriptor (name must stay `spk_udp`)
CMakeLists.txt           Linux/CI build + selftest
```

## Windows build (MSVC)

The extension only builds **inside the Native project exported by the LayaAir
IDE** (the IDE generates the `.vcxproj` and copies the DLL to the runtime's load
path). Steps:

1. In the LayaAir IDE (3.4.1+), export the Native project for Windows
   (**发布 → 导出 Native 工程**). You get `windows/…`, `LayaBox.slnx`, and
   `windows/extension/extension.vcxproj`.
2. Copy `src/main.cpp`, `src/udp_socket.h`, `src/udp_socket.cpp` into
   `windows/extension/`, and add both `.cpp` files to `extension.vcxproj`.
3. Copy `spk_udp.layaext.json` next to the project (or into the extension
   folder) so the build copies it to the runtime's extension directory.
4. Build `x64` / Release. The build emits `spk_udp.dll` and copies it + the
   descriptor next to the runtime. `ws2_32.lib` is linked via `#pragma comment`.
5. Enable loading in `windows/resource/config.ini`:
   ```ini
   [common]
   LoadExtension=true
   ```
6. `spk_udp.version()` should now be callable from the project's JS.

`extension.name` in `spk_udp.layaext.json` **must** equal `info->name` in
`main.cpp` (`"spk_udp"`), and the `libraries` value must equal the built DLL
name.

## Linux build (CI / reference)

```bash
cmake -S . -B build -DSPK_USE_SHIM_HEADER=ON
cmake --build build
./build/spk_udp_selftest     # loopback UDP smoke test, exits 0 on success
```

For a real Linux runtime build, point the extension at the runtime's headers:

```bash
cmake -S . -B build-real -DSPK_USE_SHIM_HEADER=OFF -DSPK_LAYANATIVE_INCLUDE=/path/to/layanative/include
cmake --build build-real      # produces libspk_udp.so
```

## ⚠️ About `include/extension/LayaExtension.h`

The real `LayaExtension.h` and the `jsvm_*` C API ship **with the LayaNative
runtime** (inside the IDE-exported Native project). They are not a standalone
public download, so this repository cannot vendor them. `include/extension/
LayaExtension.h` is a **compile-verification shim** that reproduces only the
symbols `main.cpp` uses, with the signatures from the official docs.

* For CI, `-DSPK_USE_SHIM_HEADER=ON` lets `main.cpp` be syntax-checked and
  `udp_selftest` run.
* For a real build, **use the runtime's header** (do not put this `include/`
  directory on the include path). The documented symbols are exact; the
  `jsvm_*` string/ArrayBuffer helpers (`jsvm_get_value_string_utf8`,
  `jsvm_create_string_utf8`, `jsvm_get_arraybuffer_info`) follow the JSVM
  naming convention and may need a signature tweak against the real header.

If a symbol mismatch appears at real-build time, only `main.cpp` (the thin glue)
changes — `udp_socket.cpp` is pure C++ and unaffected.
