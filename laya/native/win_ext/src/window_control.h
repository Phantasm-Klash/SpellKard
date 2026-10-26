// Pure Win32 window control for the SpellKard LayaNative extension (`spk_win`).
//
// This header and its .cpp have NO dependency on LayaNative or the JSVM API, so
// the window logic can be unit-tested / syntax-checked on its own. main.cpp only
// wraps these functions in JSVM glue.
//
// HARD CONSTRAINT - this code MUST NOT change the display mode. It never calls
// ChangeDisplaySettings / ChangeDisplaySettingsEx / EnumDisplaySettings. The
// fullscreen path is *borderless windowed fullscreen*: the window is stripped of
// all decoration (WS_POPUP) and resized to cover the whole monitor rect, while
// the monitor keeps its current resolution and refresh rate. Exclusive
// fullscreen (which would flip the display mode) is deliberately NOT used - the
// conch `setResolution(w, h, true)` path does exactly that and is banned.
#ifndef SPELLKARD_WIN_EXT_WINDOW_CONTROL_H
#define SPELLKARD_WIN_EXT_WINDOW_CONTROL_H

namespace spellkard {

// Snapshot of the window / monitor state, mirroring the JS `getState()` object.
struct WindowState {
  int fullscreen = 0;   // 1 while this extension holds windowed fullscreen
  int desktopW = 0;     // primary monitor width  (GetSystemMetrics(SM_CXSCREEN))
  int desktopH = 0;     // primary monitor height (GetSystemMetrics(SM_CYSCREEN))
  int workW = 0;        // work-area width  of the window's monitor (rcWork)
  int workH = 0;        // work-area height of the window's monitor (rcWork)
  int windowW = 0;      // current window width  (GetWindowRect, outer)
  int windowH = 0;      // current window height (GetWindowRect, outer)
  int x = 0;            // current window top-left x
  int y = 0;            // current window top-left y
  long long style = 0;  // current GWL_STYLE bits
};

// Primary monitor size, in the same (DPI-unaware) coordinate space conch uses.
// Returns false when the metrics are unavailable.
bool getDesktopSize(int& width, int& height);

// Fills `out` from the process's main window. Returns false when no main window
// is found; `out` is zero-filled first so callers always get a valid struct.
bool getState(WindowState& out);

// Enters / leaves borderless windowed fullscreen. Idempotent: repeating the same
// direction is a no-op that still reports success. Returns false on failure.
bool setFullscreen(bool enable);

// True while the extension currently holds windowed fullscreen.
bool isFullscreen();

// Resizes the window's *client area* to `width` x `height` and keeps it on the
// monitor. Returns false when the size is invalid, no main window is found, or
// the resize is refused.
//
// `width`/`height` are the client area, i.e. what the game actually draws into
// - the caller does not have to know whether the window carries a border. The
// window is then re-centred on its monitor and clamped to the work area, so it
// cannot end up partly off-screen.
//
// Like everything else here, this never touches the display mode.
bool setWindowSize(int width, int height);

}  // namespace spellkard

#endif  // SPELLKARD_WIN_EXT_WINDOW_CONTROL_H
