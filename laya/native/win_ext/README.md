# `spk_win` — LayaNative Win32 window extension

LayaNative exposes no API to read the desktop size and no borderless-window API.
Worse, `conch.setResolution(w, h, true)` uses SDL **exclusive** fullscreen
(`ChangeDisplaySettingsEx`), which **switches the display mode** — observed to
take the desktop from 2560x1600@165Hz down to 2560x1440. The product requires
fullscreen that **never changes the display mode**.

This extension exposes *borderless windowed fullscreen* to JS as the global
object **`spk_win`**: it finds the process's main window, strips its decoration
(`WS_POPUP`) and resizes it to the whole monitor rect — leaving the monitor's
resolution and refresh rate untouched. It also reports the desktop size that
conch cannot.

It uses the cross-platform extension mechanism introduced in **LayaAir 3.4.1**
(JSVM API + `extension/LayaExtension.h` + `.layaext.json`), mirroring the sibling
`native/udp_ext` (`spk_udp`) project. See
<https://layaair.com/3.x/doc/released/native/extension/>.

## Hard constraint

**No display-mode changes.** There is no `ChangeDisplaySettings`,
`ChangeDisplaySettingsEx` or `EnumDisplaySettings` call anywhere in this
extension. Exclusive fullscreen is deliberately never used.

## DPI note

The client process is **DPI-unaware**, so the Win32 coordinates it sees match
conch's: `GetSystemMetrics(SM_CXSCREEN)` reports `2048x1280` on a 2560x1600
(125%) panel, exactly like `Laya.Browser.clientWidth`. This extension therefore
uses `GetSystemMetrics` / `GetMonitorInfo` directly and **never** calls
`SetProcessDpiAwareness` / `SetThreadDpiAwarenessContext` (that would desync the
coordinate systems).

## JS API

`spk_win` is a namespace object on the global, so all methods are reached as
`spk_win.<method>()`.

| Method | Returns | Notes |
| --- | --- | --- |
| `version(): string` | `"spellkard-win/1.0.0"` | |
| `getDesktopSize(): string` | `"2048x1280"` | primary monitor, same coordinate space as conch; `""` on failure |
| `isFullscreen(): number` | `1` / `0` | whether *this* extension holds windowed fullscreen |
| `getState(): string` | JSON | see below |
| `setFullscreen(enable): number` | `1` ok, `0` fail | `1` = enter, `0` = restore; idempotent |

`getState()` returns:

```json
{"fullscreen":0,"desktopW":2048,"desktopH":1280,"workW":2048,"workH":1232,
 "windowW":960,"windowH":720,"x":100,"y":100,"style":349110272}
```

`desktopW/H` come from `GetSystemMetrics`; `workW/H` from `GetMonitorInfo`
(`rcWork`) for the window's monitor; `windowW/H/x/y` from `GetWindowRect`
(outer rect); `style` is the raw `GWL_STYLE` value.

### `setFullscreen(1)` steps

1. Find the process's main visible top-level window with `EnumWindows` +
   `GetWindowThreadProcessId` == `GetCurrentProcessId()` + `IsWindowVisible` +
   non-empty client area (preferring an owner-less window). `GetForegroundWindow`
   is **not** used — the game window is not necessarily foreground.
2. Save the current `GWL_STYLE` and `GetWindowRect` for restore.
3. `MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST)` + `GetMonitorInfo` → use
   the whole **`rcMonitor`** rect (not `rcWork`, so the taskbar is covered).
4. `SetWindowLongPtrW(hwnd, GWL_STYLE, (style & ~(WS_CAPTION | WS_THICKFRAME |
   WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU | WS_BORDER | WS_DLGFRAME)) |
   WS_POPUP | WS_VISIBLE)`.
5. `SetWindowPos(hwnd, HWND_TOP, rcMonitor.left, rcMonitor.top, w, h,
   SWP_FRAMECHANGED | SWP_SHOWWINDOW | SWP_NOOWNERZORDER)`.

`setFullscreen(0)` restores the saved style + rect via `SetWindowLongPtrW` +
`SetWindowPos`. Repeating the same direction is a no-op that still returns `1`.
On `LAYA_EXT_EVENT_DEINIT` the window is restored so the app never exits
chrome-less. Every Win32 failure returns `0`; no exception crosses the JSVM
`extern "C"` boundary.

## Files

```
src/window_control.{h,cpp}  portable window core — NO Laya dependency
src/main.cpp                LayaNative entry + JSVM glue (registers `spk_win`)
include/extension/LayaExtension.h   compile-verification SHIM (mirrors the real header)
include/jsvm/JSVM.h                 compile-verification SHIM (mirrors the real header)
windows/extension.vcxproj           MSVC Release|x64 project -> spk_win.dll
windows/build_spk_win.bat           one-command cl build (no VS IDE needed)
spk_win.layaext.json        extension descriptor (name must stay `spk_win`)
CMakeLists.txt              Linux/CI syntax check + shim headers
```

`window_control.cpp` compiles on non-Windows as well (the Win32 calls collapse to
failure-returning stubs under `#ifdef _WIN32`), so `cmake --build` genuinely
syntax-checks the whole extension on Linux — including the window logic — and not
just `main.cpp`.

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

## Windows build (MSVC)

### One command (recommended)

```bash
cmd //c D:\\gotouhou-work\\SpellKard\\laya\\native\\win_ext\\windows\\build_spk_win.bat
```

`build_spk_win.bat` runs `vcvars64.bat`, then adds the Windows SDK `INCLUDE`/`LIB`
paths explicitly (the sandbox blocks `reg.exe`, so vcvars cannot auto-discover the
SDK), compiles `main.cpp` + `window_control.cpp` with `cl /LD`, links `conch.lib`
and `user32.lib`, and writes `spk_win.dll` + `spk_win.layaext.json` straight into
`layaide/build-templates/windows/release/`. A successful run prints `EXIT=0`.

### Visual Studio

`windows/extension.vcxproj` builds `spk_win.dll` into
`layaide/build-templates/windows/release/` next to the descriptor. Point
`LAYANATIVE_SDK_ROOT` at `<support-package>\project\Runtime\x64\release` (the
project also falls back to `native/windows/sdk/project/Runtime/x64/release`),
select **Release|x64** and build. `ValidateDependencies` fails fast with a
readable message when the SDK root is wrong.

### Publish requirements

The published client directory must contain `spk_win.dll`, `spk_win.layaext.json`
and a `config.ini` with:

```ini
[common]
LoadExtension=true
```

(`layaide/build-templates/windows/release/config.ini` already sets it.)

`extension.name` in `spk_win.layaext.json` **must** equal `info->name` in
`main.cpp` (`"spk_win"`), and the `libraries` value must equal the built DLL name
(`spk_win.dll`).

## CI / syntax check (CMake + shim headers)

```bash
cmake -S native/win_ext -B /tmp/win_ext_ci -DSPK_USE_SHIM_HEADER=ON
cmake --build /tmp/win_ext_ci
```

This compiles `main.cpp` (JSVM glue) and `window_control.cpp` against the shim
headers and produces the extension shared library. It is a **syntax/link check
only** — on a non-Windows host the Win32 code paths collapse to stubs, and the
JSVM symbols are resolved by the runtime at load time (GNU ld allows undefined
symbols in a shared object; MSVC needs `/FORCE:UNRESOLVED`, which this project
adds automatically for the shim+MSVC configuration).

### Running it on Windows (verified)

On Windows the same check was run with the NMake generator inside a `vcvars64`
shell, because the sandbox blocks `reg.exe`, so CMake's Visual Studio generator
cannot locate `cl.exe` on its own:

```bat
call vcvars64.bat
set "PATH=%WINSDK%\bin\10.0.26100.0\x64;%PATH%"   rem rc.exe / mt.exe
set "INCLUDE=%INCLUDE%;%WINSDK%\Include\10.0.26100.0\{ucrt,um,shared}"
set "LIB=%LIB%;%WINSDK%\Lib\10.0.26100.0\{ucrt,um}\x64"
cmake -S native\win_ext -B D:\gotouhou-work\tmp\win_ext_ci -G "NMake Makefiles" -DSPK_USE_SHIM_HEADER=ON -DCMAKE_BUILD_TYPE=Release
cmake --build D:\gotouhou-work\tmp\win_ext_ci
```

Result: configure `EXIT=0`, build `EXIT=0`, output `spk_win.dll`. On a normal
(unblocked) machine the plain command above works with the default VS generator.

## ⚠️ About `include/`

`include/extension/LayaExtension.h` and `include/jsvm/JSVM.h` are
**compile-verification shims**, not the real headers. They reproduce the real
3.4.1 API symbol-for-symbol (copied from `native/udp_ext/include/`, which was
verified against the Windows Build Support package), so the extension is
syntax-checked on Linux CI without the runtime.

* For CI, `-DSPK_USE_SHIM_HEADER=ON` puts `include/` on the include path.
* For a real build, **use the runtime's headers** — the `windows/` vcxproj and the
  real-build CMake path both do this; do not put this `include/` directory on the
  include path.

If the real headers ever drift, only `main.cpp` (the thin glue) may need a
signature tweak — `window_control.cpp` is pure Win32 and unaffected.

## Window sizing

`spk_win.setWindowSize(width, height)` resizes the window's **client area** -
the surface the game draws into - and re-centres it on its monitor, clamped to
the work area so the title bar cannot end up off-screen. It is how the client's
window-size setting (1x / 2x / 4x / auto, multiples of the 900x1200 design
stage) reaches the desktop.

It uses `SetWindowPos`, like the fullscreen path, so it never touches the
display mode. The client area is converted to the outer window size with
`AdjustWindowRectEx`, so the caller does not have to know whether the window
carries a border.

The JS side treats this method as **optional**: a build of the DLL that predates
it simply does not resize, and `platform/native/native_window.ts` reports that
instead of throwing.

## Building

The extension is a Visual Studio project (`CMakeLists.txt` is also provided):

```
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
```

The output `spk_win.dll` is staged next to the client by
`laya/tools/publish_windows.mjs`. **The DLL has to be rebuilt for
`setWindowSize` to exist** - the one shipped in the repository was built before
this method was added.
