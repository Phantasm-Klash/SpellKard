// Win32 implementation of borderless windowed fullscreen for `spk_win`.
//
// Design notes:
//   * The window handle is located with EnumWindows + GetWindowThreadProcessId
//     matched against GetCurrentProcessId(), filtered by IsWindowVisible and a
//     non-empty client area. GetForegroundWindow is deliberately NOT used: the
//     game window is not necessarily foreground (alt-tab, IDE focus) and the
//     foreground window can belong to another process.
//   * The monitor rect (GetMonitorInfo rcMonitor) - not the work area - is used
//     as the target rectangle so the window covers the taskbar.
//   * Everything needed to restore the window is saved in a single static
//     struct, so both directions are idempotent.
//
// The file compiles everywhere: on non-Windows the functions collapse to
// failure-returning stubs so the extension can be syntax-checked on Linux CI.
//
// HARD CONSTRAINT - no display-mode changes. There is no ChangeDisplaySettings /
// ChangeDisplaySettingsEx / EnumDisplaySettings call anywhere in this file.
#include "window_control.h"

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif

namespace spellkard {
namespace {

#ifdef _WIN32

// State captured when entering windowed fullscreen, needed to restore exactly.
struct SavedWindow {
  bool active = false;
  HWND hwnd = nullptr;
  LONG_PTR style = 0;
  RECT rect{};
};

SavedWindow& savedState() {
  static SavedWindow state;
  return state;
}

struct FindWindowContext {
  DWORD pid = 0;
  HWND first = nullptr;    // first visible top-level window of the process
  HWND unowned = nullptr;  // ... that also has no owner (the real app window)
};

BOOL CALLBACK enumWindowsProc(HWND hwnd, LPARAM lparam) {
  auto* ctx = reinterpret_cast<FindWindowContext*>(lparam);
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  if (pid != ctx->pid || !IsWindowVisible(hwnd)) {
    return TRUE;
  }
  // Message-only / hidden helper windows have an empty client area.
  RECT client{};
  if (!GetClientRect(hwnd, &client) || client.right - client.left <= 0 ||
      client.bottom - client.top <= 0) {
    return TRUE;
  }
  if (ctx->first == nullptr) {
    ctx->first = hwnd;
  }
  // A top-level window without an owner is the real app window; prefer it and
  // stop the enumeration early.
  if (GetWindow(hwnd, GW_OWNER) == nullptr) {
    ctx->unowned = hwnd;
    return FALSE;
  }
  return TRUE;
}

// Finds this process's main visible top-level window, or nullptr.
HWND findMainWindow() {
  FindWindowContext ctx;
  ctx.pid = GetCurrentProcessId();
  EnumWindows(&enumWindowsProc, reinterpret_cast<LPARAM>(&ctx));
  return ctx.unowned != nullptr ? ctx.unowned : ctx.first;
}

// Fills the work-area size of the monitor nearest to `hwnd`.
void fillWorkArea(HWND hwnd, WindowState& state) {
  HMONITOR monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
  if (monitor == nullptr) {
    return;
  }
  MONITORINFO info{};
  info.cbSize = sizeof(MONITORINFO);
  if (GetMonitorInfoW(monitor, &info)) {
    state.workW = info.rcWork.right - info.rcWork.left;
    state.workH = info.rcWork.bottom - info.rcWork.top;
  }
}

#endif  // _WIN32

}  // namespace

bool getDesktopSize(int& width, int& height) {
#ifdef _WIN32
  width = GetSystemMetrics(SM_CXSCREEN);
  height = GetSystemMetrics(SM_CYSCREEN);
  return width > 0 && height > 0;
#else
  (void)width;
  (void)height;
  return false;
#endif
}

bool getState(WindowState& out) {
  out = WindowState{};

  int desktopWidth = 0;
  int desktopHeight = 0;
  if (getDesktopSize(desktopWidth, desktopHeight)) {
    out.desktopW = desktopWidth;
    out.desktopH = desktopHeight;
  }

#ifdef _WIN32
  HWND hwnd = findMainWindow();
  if (hwnd == nullptr) {
    return false;
  }
  out.fullscreen = savedState().active ? 1 : 0;
  fillWorkArea(hwnd, out);

  RECT rect{};
  if (GetWindowRect(hwnd, &rect)) {
    out.x = rect.left;
    out.y = rect.top;
    out.windowW = rect.right - rect.left;
    out.windowH = rect.bottom - rect.top;
  }
  out.style = static_cast<long long>(GetWindowLongPtrW(hwnd, GWL_STYLE));
  return true;
#else
  return false;
#endif
}

bool isFullscreen() {
#ifdef _WIN32
  return savedState().active;
#else
  return false;
#endif
}

bool setWindowSize(int width, int height) {
#ifdef _WIN32
  if (width <= 0 || height <= 0) {
    return false;
  }
  HWND hwnd = findMainWindow();
  if (hwnd == nullptr) {
    return false;
  }
  const LONG_PTR style = GetWindowLongPtrW(hwnd, GWL_STYLE);
  if (style == 0) {
    return false;  // a real top-level window always has WS_VISIBLE set
  }

  // The caller asks for a *client area*; the window frame adds to that. For a
  // WS_POPUP window (which is what fullscreen turns the window into) the two
  // are the same, and AdjustWindowRectEx handles that without a special case.
  RECT client{0, 0, width, height};
  if (!AdjustWindowRectEx(&client, style, FALSE, 0)) {
    return false;
  }
  const int outerW = client.right - client.left;
  const int outerH = client.bottom - client.top;
  if (outerW <= 0 || outerH <= 0) {
    return false;
  }

  // Keep it on the monitor: centre on the current monitor, then clamp into the
  // work area so the title bar never ends up off-screen.
  HMONITOR monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
  MONITORINFO info{};
  info.cbSize = sizeof(MONITORINFO);
  if (monitor == nullptr || !GetMonitorInfoW(monitor, &info)) {
    return false;
  }
  const RECT& area = info.rcWork;
  int x = area.left + (area.right - area.left - outerW) / 2;
  int y = area.top + (area.bottom - area.top - outerH) / 2;
  if (x < area.left) {
    x = area.left;
  }
  if (y < area.top) {
    y = area.top;
  }

  // SetWindowPos only moves and resizes the window; it does not touch the
  // display mode. SWP_NOZORDER keeps the window from jumping to the front.
  return SetWindowPos(hwnd, nullptr, x, y, outerW, outerH,
                      SWP_NOZORDER | SWP_NOOWNERZORDER) != FALSE;
#else
  return false;
#endif
}

bool setFullscreen(bool enable) {
#ifdef _WIN32
  SavedWindow& state = savedState();

  if (enable) {
    if (state.active) {
      return true;  // already fullscreen - idempotent
    }
    HWND hwnd = findMainWindow();
    if (hwnd == nullptr) {
      return false;
    }
    HMONITOR monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
    if (monitor == nullptr) {
      return false;
    }
    MONITORINFO info{};
    info.cbSize = sizeof(MONITORINFO);
    if (!GetMonitorInfoW(monitor, &info)) {
      return false;
    }
    RECT rect{};
    if (!GetWindowRect(hwnd, &rect)) {
      return false;
    }
    const LONG_PTR style = GetWindowLongPtrW(hwnd, GWL_STYLE);
    if (style == 0) {
      return false;  // a real top-level window always has WS_VISIBLE set
    }

    // Save for restore, then strip every piece of window decoration. WS_POPUP +
    // WS_VISIBLE gives a chrome-less, taskbar-covering window; the monitor rect
    // (not the work area) is used on purpose so the taskbar is covered too.
    state.hwnd = hwnd;
    state.style = style;
    state.rect = rect;

    const LONG_PTR decoration = WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX |
                                WS_MAXIMIZEBOX | WS_SYSMENU | WS_BORDER | WS_DLGFRAME;
    const LONG_PTR newStyle = (style & ~decoration) | WS_POPUP | WS_VISIBLE;

    SetWindowLongPtrW(hwnd, GWL_STYLE, newStyle);
    const RECT& target = info.rcMonitor;
    SetWindowPos(hwnd, HWND_TOP, target.left, target.top, target.right - target.left,
                 target.bottom - target.top,
                 SWP_FRAMECHANGED | SWP_SHOWWINDOW | SWP_NOOWNERZORDER);

    state.active = true;
    return true;
  }

  // Leaving fullscreen.
  if (!state.active || state.hwnd == nullptr) {
    return true;  // nothing to restore - idempotent
  }

  SetWindowLongPtrW(state.hwnd, GWL_STYLE, state.style);
  SetWindowPos(state.hwnd, nullptr, state.rect.left, state.rect.top,
               state.rect.right - state.rect.left, state.rect.bottom - state.rect.top,
               SWP_FRAMECHANGED | SWP_SHOWWINDOW | SWP_NOZORDER | SWP_NOOWNERZORDER);

  state.active = false;
  state.hwnd = nullptr;
  return true;
#else
  (void)enable;
  return false;
#endif
}

}  // namespace spellkard
