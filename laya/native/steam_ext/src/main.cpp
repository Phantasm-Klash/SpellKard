/**
 * LayaNative glue for `spk_steam`.
 *
 * Registers `window.spk_steam` with the Steamworks bridge (see
 * steam_bridge.h for the exact surface). Every function returns a JS
 * value the client module can consume directly; failures are reported as
 * `null` / `false` / `{ ok: false, detail }` — never exceptions — so the
 * free tier can ignore the object entirely.
 *
 * NOTE: `native/steam_ext/` only.
 */

#include <cstddef>
#include <cstdint>
#include <cstring>

#include <extension/LayaExtension.h>
#include <jsvm/JSVM.h>

#include "steam_bridge.h"

namespace {

jsvm_value makeNull(jsvm_env env) {
  jsvm_value result;
  jsvm_get_null(env, &result);
  return result;
}

jsvm_value makeUndefined(jsvm_env env) {
  jsvm_value result;
  jsvm_get_undefined(env, &result);
  return result;
}

jsvm_value makeString(jsvm_env env, const char* text) {
  jsvm_value result;
  jsvm_create_string_utf8(env, text, JSVM_AUTO_LENGTH, &result);
  return result;
}

jsvm_value makeBool(jsvm_env env, bool v) {
  jsvm_value result;
  jsvm_get_boolean(env, v, &result);
  return result;
}

jsvm_value makeInt(jsvm_env env, int32_t v) {
  jsvm_value result;
  jsvm_create_int32(env, v, &result);
  return result;
}

void setProp(jsvm_env env, jsvm_value obj, const char* name, jsvm_value v) {
  jsvm_set_named_property(env, obj, name, v);
}

/** Read a string argument into a stack buffer; -1 on missing/invalid. */
int readStringArg(jsvm_env env, jsvm_callback_info info, char* buf, size_t cap) {
  size_t argc = 1;
  jsvm_value argv[1];
  jsvm_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1) return -1;
  size_t len = 0;
  if (jsvm_get_value_string_utf8(env, argv[0], buf, cap, &len) != jsvm_ok) return -1;
  return 0;
}

int readIntArg(jsvm_env env, jsvm_callback_info info, int32_t* out) {
  size_t argc = 1;
  jsvm_value argv[1];
  jsvm_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1) return -1;
  if (jsvm_get_value_int32(env, argv[0], out) != jsvm_ok) return -1;
  return 0;
}

jsvm_value jsVersion(jsvm_env env, jsvm_callback_info info) {
  (void)info;
  return makeString(env, spk_steam::Version());
}

/** init(appId) -> { ok, steamId, detail } */
jsvm_value jsInit(jsvm_env env, jsvm_callback_info info) {
  int32_t appId = 0;
  if (readIntArg(env, info, &appId) != 0 || appId <= 0) {
    jsvm_value obj;
    jsvm_create_object(env, &obj);
    setProp(env, obj, "ok", makeBool(env, false));
    setProp(env, obj, "steamId", makeNull(env));
    setProp(env, obj, "detail", makeString(env, "bad appId argument"));
    return obj;
  }
  char steamId[64] = {0};
  char detail[128] = {0};
  const int rc = spk_steam::Init(static_cast<uint32_t>(appId), steamId, sizeof(steamId),
                                 detail, sizeof(detail));
  jsvm_value obj;
  jsvm_create_object(env, &obj);
  const bool ok = rc == spk_steam::kOk;
  setProp(env, obj, "ok", makeBool(env, ok));
  if (ok) {
    setProp(env, obj, "steamId", makeString(env, steamId));
    setProp(env, obj, "detail", makeString(env, detail));
  } else {
    setProp(env, obj, "steamId", makeNull(env));
    // Map the stable codes to readable details for the JS layer.
    const char* d = detail;
    if (rc == spk_steam::kSteamRestartPending) d = "steam restart pending";
    if (rc == spk_steam::kUnsupportedPlatform) d = "steam unavailable on this platform";
    setProp(env, obj, "detail", makeString(env, d));
  }
  return obj;
}

/** getSteamId() -> string | null */
jsvm_value jsGetSteamId(jsvm_env env, jsvm_callback_info info) {
  (void)info;
  char steamId[64] = {0};
  if (spk_steam::GetSteamId64(steamId, sizeof(steamId)) != spk_steam::kOk) {
    return makeNull(env);
  }
  return makeString(env, steamId);
}

/** hasDlcInstalled(appId) -> boolean */
jsvm_value jsHasDlc(jsvm_env env, jsvm_callback_info info) {
  int32_t appId = 0;
  int installed = 0;
  if (readIntArg(env, info, &appId) != 0) return makeBool(env, false);
  spk_steam::HasDlc(static_cast<uint32_t>(appId), &installed);
  return makeBool(env, installed != 0);
}

/** listOwnedDlc() -> number[] */
jsvm_value jsListOwnedDlc(jsvm_env env, jsvm_callback_info info) {
  (void)info;
  jsvm_value arr;
  jsvm_create_array_with_length(env, 0, &arr);
  int count = 0;
  if (spk_steam::DlcCount(&count) != spk_steam::kOk || count <= 0) return arr;
  jsvm_value sized;
  jsvm_create_array_with_length(env, static_cast<size_t>(count), &sized);
  for (int i = 0; i < count; i++) {
    uint32_t appid = 0;
    if (spk_steam::DlcAppId(i, &appid) != spk_steam::kOk) continue;
    jsvm_set_element(env, sized, static_cast<uint32_t>(i), makeInt(env, appid));
  }
  return sized;
}

/** subscribeWorkshopItem(id) -> boolean */
jsvm_value jsSubscribe(jsvm_env env, jsvm_callback_info info) {
  char id[64] = {0};
  if (readStringArg(env, info, id, sizeof(id)) != 0) return makeBool(env, false);
  int ok = 0;
  spk_steam::SubscribeWorkshopItem(id, &ok);
  return makeBool(env, ok != 0);
}

/** unsubscribeWorkshopItem(id) -> boolean */
jsvm_value jsUnsubscribe(jsvm_env env, jsvm_callback_info info) {
  char id[64] = {0};
  if (readStringArg(env, info, id, sizeof(id)) != 0) return makeBool(env, false);
  int ok = 0;
  spk_steam::UnsubscribeWorkshopItem(id, &ok);
  return makeBool(env, ok != 0);
}

/** getSubscribedWorkshopItems() -> [{ publishedFileId, localPath, sizeBytes, installed }] */
jsvm_value jsGetSubscribedItems(jsvm_env env, jsvm_callback_info info) {
  (void)info;
  jsvm_value arr;
  jsvm_create_array_with_length(env, 0, &arr);
  int count = 0;
  if (spk_steam::SubscribedCount(&count) != spk_steam::kOk || count <= 0) return arr;
  jsvm_value sized;
  jsvm_create_array_with_length(env, static_cast<size_t>(count), &sized);
  for (int i = 0; i < count; i++) {
    char id[32] = {0};
    if (spk_steam::SubscribedId(i, id, sizeof(id)) != spk_steam::kOk) continue;
    char path[512] = {0};
    int64_t size = 0;
    int installed = 0;
    spk_steam::WorkshopInstallInfo(id, path, sizeof(path), &size, &installed);

    jsvm_value obj;
    jsvm_create_object(env, &obj);
    setProp(env, obj, "publishedFileId", makeString(env, id));
    if (path[0] == '\0') {
      setProp(env, obj, "localPath", makeNull(env));
    } else {
      setProp(env, obj, "localPath", makeString(env, path));
    }
    jsvm_value sizeVal;
    jsvm_create_int64(env, size, &sizeVal);
    setProp(env, obj, "sizeBytes", sizeVal);
    setProp(env, obj, "installed", makeBool(env, installed != 0));
    jsvm_set_element(env, sized, static_cast<uint32_t>(i), obj);
  }
  return sized;
}

/** isWorkshopItemInstalled(id) -> boolean */
jsvm_value jsIsItemInstalled(jsvm_env env, jsvm_callback_info info) {
  char id[64] = {0};
  if (readStringArg(env, info, id, sizeof(id)) != 0) return makeBool(env, false);
  char path[512] = {0};
  int64_t size = 0;
  int installed = 0;
  const int rc = spk_steam::WorkshopInstallInfo(id, path, sizeof(path), &size, &installed);
  return makeBool(env, rc == spk_steam::kOk && installed != 0);
}

/** setAchievement(id) -> boolean */
jsvm_value jsSetAchievement(jsvm_env env, jsvm_callback_info info) {
  char id[128] = {0};
  if (readStringArg(env, info, id, sizeof(id)) != 0) return makeBool(env, false);
  int ok = 0;
  spk_steam::SetAchievement(id, &ok);
  return makeBool(env, ok != 0);
}

/** getAchievements() -> { [id]: boolean } */
jsvm_value jsGetAchievements(jsvm_env env, jsvm_callback_info info) {
  (void)info;
  jsvm_value obj;
  jsvm_create_object(env, &obj);
  int count = 0;
  if (spk_steam::AchievementCount(&count) != spk_steam::kOk) return obj;
  for (int i = 0; i < count; i++) {
    char id[128] = {0};
    int unlocked = 0;
    if (spk_steam::AchievementId(i, id, sizeof(id)) != spk_steam::kOk) continue;
    spk_steam::AchievementUnlocked(i, &unlocked);
    setProp(env, obj, id, makeBool(env, unlocked != 0));
  }
  return obj;
}

/** shutdown() -> undefined */
jsvm_value jsShutdown(jsvm_env env, jsvm_callback_info info) {
  (void)info;
  spk_steam::Shutdown();
  return makeUndefined(env);
}

void registerFunction(jsvm_env env, jsvm_value exports, const char* name, jsvm_callback cb) {
  jsvm_value fn;
  if (jsvm_create_function(env, name, JSVM_AUTO_LENGTH, cb, nullptr, &fn) != jsvm_ok) {
    return;
  }
  jsvm_set_named_property(env, exports, name, fn);
}

int onEvent(LayaExtEventType event, const LayaExtensionInterface* iface, void* userData) {
  (void)userData;
  if (event != LAYA_EXT_EVENT_INIT || iface == nullptr) {
    return 0;
  }
  jsvm_env env = iface->get_env();
  jsvm_value exports = iface->get_exports();
  if (env == nullptr || exports == nullptr) {
    return -1;
  }
  registerFunction(env, exports, "version", jsVersion);
  registerFunction(env, exports, "init", jsInit);
  registerFunction(env, exports, "getSteamId", jsGetSteamId);
  registerFunction(env, exports, "hasDlcInstalled", jsHasDlc);
  registerFunction(env, exports, "listOwnedDlc", jsListOwnedDlc);
  registerFunction(env, exports, "subscribeWorkshopItem", jsSubscribe);
  registerFunction(env, exports, "unsubscribeWorkshopItem", jsUnsubscribe);
  registerFunction(env, exports, "getSubscribedWorkshopItems", jsGetSubscribedItems);
  registerFunction(env, exports, "isWorkshopItemInstalled", jsIsItemInstalled);
  registerFunction(env, exports, "setAchievement", jsSetAchievement);
  registerFunction(env, exports, "getAchievements", jsGetAchievements);
  registerFunction(env, exports, "shutdown", jsShutdown);
  return 0;
}

}  // namespace

/**
 * Fills in the extension descriptor. The engine loads the DLL by looking for
 * the exported `laya_extension_init` symbol; getting this wrong is silent —
 * the DLL loads, nothing is registered, and `window.spk_steam` is simply
 * undefined.
 */
int extInit(const LayaExtensionInterface* engine, LayaExtensionInitInfo* info) {
  (void)engine;
  info->api_version = LAYA_EXTENSION_API_VERSION;
  info->name = "spk_steam";
  info->version = "1.0.0";
  info->on_event = onEvent;
  info->user_data = nullptr;
  return 0;
}

// The engine looks for exactly this symbol (see LayaExtension.h).
LAYA_EXTENSION_ENTRY(extInit)
// iOS static linking uses a per-extension symbol instead.
LAYA_EXTENSION_ENTRY_NAMED(spk_steam, extInit)
