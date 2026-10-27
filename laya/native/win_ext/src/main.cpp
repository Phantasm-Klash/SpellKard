// SpellKard LayaNative window extension.
//
// Exposes borderless-windowed-fullscreen control to JS as the global object
// `spk_win` (the `extension.name` in spk_win.layaext.json). It exists because
// the conch runtime exposes no API to read the desktop size and no borderless
// window API, and because `conch.setResolution(w, h, true)` uses SDL exclusive
// fullscreen + ChangeDisplaySettingsEx - it switches the display mode, which the
// product explicitly forbids. `spk_win` instead makes the existing window
// chrome-less and covers the monitor without touching the display mode.
//
// JS API (all methods are on the `spk_win` global):
//
//   spk_win.version(): string              // "spellkard-win/1.0.0"
//   spk_win.getDesktopSize(): string       // "2048x1280" (primary monitor)
//   spk_win.isFullscreen(): number         // 1 while windowed fullscreen is held
//   spk_win.getState(): string             // JSON snapshot, see below
//   spk_win.setFullscreen(enable): number  // 1 ok, 0 fail
//   spk_win.setWindowSize(w, h): number    // 1 ok, 0 fail (client area size)
//   spk_win.fitWindowToWorkArea(): number   // 1 ok, 0 fail (fill the work area)
//
// getState() JSON shape:
//   {"fullscreen":0,"desktopW":2048,"desktopH":1280,"workW":2048,"workH":1232,
//    "windowW":960,"windowH":720,"x":100,"y":100,"style":349110272}
//
// setFullscreen(1) makes the process's main window borderless (WS_POPUP) and
// resizes it to the whole monitor rect (covering the taskbar) without ever
// touching the display mode. setFullscreen(0) restores the saved style + rect.
// Both directions are idempotent. All Win32 failures return 0; no exception is
// allowed to cross the extern "C" JSVM boundary.
//
// HARD CONSTRAINT - never change the display mode. All window logic lives in
// window_control.{h,cpp}, which contains no ChangeDisplaySettings* call.
//
// Built against the real LayaNative SDK headers
// (`<support-package>/project/Runtime/x64/release/include/{jsvm,extension}`).
// The `include/` shim in this directory reproduces those two headers for
// Linux/CI syntax checking only.

#include <extension/LayaExtension.h>

#include <string>

#include "window_control.h"

namespace {

// Engine interface table, kept so log_* is reachable from every callback.
const LayaExtensionInterface* g_engine = nullptr;

void logInfo(const char* message) {
  if (g_engine != nullptr && g_engine->log_info != nullptr) {
    g_engine->log_info(message);
  }
}

jsvm_value makeInt(jsvm_env env, int32_t value) {
  jsvm_value result;
  jsvm_create_int32(env, value, &result);
  return result;
}

jsvm_value makeString(jsvm_env env, const std::string& value) {
  jsvm_value result;
  jsvm_create_string_utf8(env, value.c_str(), value.size(), &result);
  return result;
}

bool argInt(jsvm_env env, jsvm_value* argv, size_t argc, size_t index, int32_t& out) {
  if (index >= argc) {
    return false;
  }
  int32_t value = 0;
  if (jsvm_get_value_int32(env, argv[index], &value) != jsvm_ok) {
    return false;
  }
  out = value;
  return true;
}

// --- registered functions --------------------------------------------------

jsvm_value jsVersion(jsvm_env env, jsvm_callback_info info) {
  (void)info;
  try {
    return makeString(env, "spellkard-win/1.0.0");
  } catch (...) {
    return makeString(env, "");
  }
}

jsvm_value jsGetDesktopSize(jsvm_env env, jsvm_callback_info info) {
  (void)info;
  try {
    int width = 0;
    int height = 0;
    if (!spellkard::getDesktopSize(width, height)) {
      return makeString(env, "");
    }
    return makeString(env, std::to_string(width) + "x" + std::to_string(height));
  } catch (...) {
    return makeString(env, "");
  }
}

jsvm_value jsIsFullscreen(jsvm_env env, jsvm_callback_info info) {
  (void)info;
  return makeInt(env, spellkard::isFullscreen() ? 1 : 0);
}

jsvm_value jsGetState(jsvm_env env, jsvm_callback_info info) {
  (void)info;
  try {
    spellkard::WindowState state;
    spellkard::getState(state);
    std::string json = "{";
    json += "\"fullscreen\":" + std::to_string(state.fullscreen);
    json += ",\"desktopW\":" + std::to_string(state.desktopW);
    json += ",\"desktopH\":" + std::to_string(state.desktopH);
    json += ",\"workW\":" + std::to_string(state.workW);
    json += ",\"workH\":" + std::to_string(state.workH);
    json += ",\"windowW\":" + std::to_string(state.windowW);
    json += ",\"windowH\":" + std::to_string(state.windowH);
    json += ",\"x\":" + std::to_string(state.x);
    json += ",\"y\":" + std::to_string(state.y);
    json += ",\"style\":" + std::to_string(state.style);
    json += "}";
    return makeString(env, json);
  } catch (...) {
    return makeString(env, "{}");
  }
}

jsvm_value jsSetFullscreen(jsvm_env env, jsvm_callback_info info) {
  size_t argc = 1;
  jsvm_value argv[1];
  jsvm_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  int32_t enable = 0;
  if (!argInt(env, argv, argc, 0, enable)) {
    return makeInt(env, 0);
  }
  return makeInt(env, spellkard::setFullscreen(enable != 0) ? 1 : 0);
}

// setWindowSize(width, height): number -> 1 ok, 0 fail.
//
// The size is the *client area* - what the game draws into - so the caller does
// not have to know whether the window carries a border.
jsvm_value jsSetWindowSize(jsvm_env env, jsvm_callback_info info) {
  size_t argc = 2;
  jsvm_value argv[2];
  jsvm_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  int32_t width = 0;
  int32_t height = 0;
  if (!argInt(env, argv, argc, 0, width) || !argInt(env, argv, argc, 1, height)) {
    return makeInt(env, 0);
  }
  return makeInt(env, spellkard::setWindowSize(width, height) ? 1 : 0);
}

// fitWindowToWorkArea(): number -> 1 ok, 0 fail.
//
// Sizes the window so its outer rectangle is exactly the work area, so the
// client area is the work area minus the frame - "fill the screen" without the
// taskbar or the border eating into it.
jsvm_value jsFitWindowToWorkArea(jsvm_env env, jsvm_callback_info info) {
  (void)info;
  return makeInt(env, spellkard::fitWindowToWorkArea() ? 1 : 0);
}

void registerFunction(jsvm_env env, jsvm_value exports, const char* name, jsvm_callback callback) {
  jsvm_value fn;
  if (jsvm_create_function(env, name, JSVM_AUTO_LENGTH, callback, nullptr, &fn) != jsvm_ok) {
    return;
  }
  jsvm_set_named_property(env, exports, name, fn);
}

int onEvent(LayaExtEventType event, const LayaExtensionInterface* iface, void* userData) {
  (void)userData;
  if (event == LAYA_EXT_EVENT_INIT && iface != nullptr) {
    g_engine = iface;
    jsvm_env env = iface->get_env();
    jsvm_value exports = iface->get_exports();
    if (env == nullptr || exports == nullptr) {
      return -1;
    }
    // `get_exports()` IS this extension's global object — the runtime names it
    // after `extension.name` in spk_win.layaext.json. The methods therefore go
    // directly on it, exactly like `spk_udp` does. Creating a child `spk_win`
    // property here would expose `window.spk_win.spk_win.<method>` instead of
    // `window.spk_win.<method>`.
    registerFunction(env, exports, "version", jsVersion);
    registerFunction(env, exports, "getDesktopSize", jsGetDesktopSize);
    registerFunction(env, exports, "isFullscreen", jsIsFullscreen);
    registerFunction(env, exports, "getState", jsGetState);
    registerFunction(env, exports, "setFullscreen", jsSetFullscreen);
    registerFunction(env, exports, "setWindowSize", jsSetWindowSize);
    registerFunction(env, exports, "fitWindowToWorkArea", jsFitWindowToWorkArea);
    logInfo("spk_win extension loaded");
  } else if (event == LAYA_EXT_EVENT_DEINIT) {
    // Leave windowed fullscreen so the app does not exit chrome-less.
    spellkard::setFullscreen(false);
    g_engine = nullptr;
  }
  return 0;
}

int extInit(const LayaExtensionInterface* engine, LayaExtensionInitInfo* info) {
  (void)engine;
  info->api_version = LAYA_EXTENSION_API_VERSION;
  info->name = "spk_win";
  info->version = "1.0.0";
  info->on_event = onEvent;
  info->user_data = nullptr;
  return 0;
}

}  // namespace

LAYA_EXTENSION_ENTRY(extInit)
LAYA_EXTENSION_ENTRY_NAMED(spk_win, extInit)
