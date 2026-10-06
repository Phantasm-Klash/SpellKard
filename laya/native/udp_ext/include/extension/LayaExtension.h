/*
 * COMPILE-VERIFICATION SHIM — NOT THE REAL HEADER.
 *
 * LayaNative ships the real `extension/LayaExtension.h` (and the `jsvm_*` C API)
 * with the Native project exported by the LayaAir IDE. That runtime is not a
 * standalone download, so this shim reproduces only the symbols the SpellKard
 * UDP extension uses, using the signatures from the official docs:
 *
 *   https://layaair.com/3.x/doc/released/native/extension/
 *
 * It exists so `udp_ext` can be syntax-checked on CI without the runtime. When
 * you build the real Windows DLL from an exported Native project, DELETE this
 * file / do not put this `include/` directory on the include path — the runtime
 * header must win. See ../README.md.
 */
#ifndef SPELLKARD_LAYANATIVE_SHIM_LAYAEXTENSION_H
#define SPELLKARD_LAYANATIVE_SHIM_LAYAEXTENSION_H

#include <cstddef>
#include <cstdint>

#define LAYA_EXTENSION_API_VERSION 1
#define JSVM_AUTO_LENGTH static_cast<size_t>(-1)

typedef struct jsvm_env__* jsvm_env;
typedef struct jsvm_callback_info__* jsvm_callback_info;

typedef struct jsvm_value__ {
  void* opaque;
} jsvm_value;

typedef jsvm_value (*jsvm_callback)(jsvm_env env, jsvm_callback_info info);

typedef enum LayaExtEventType {
  LAYA_EXT_EVENT_INIT = 0,
  LAYA_EXT_EVENT_UPDATE = 1,
  LAYA_EXT_EVENT_PAUSE = 2,
  LAYA_EXT_EVENT_RESUME = 3,
  LAYA_EXT_EVENT_DESTROY = 4,
} LayaExtEventType;

#ifdef __cplusplus
extern "C" {
#endif

// --- JSVM callback/argument helpers (documented) ---------------------------
void jsvm_get_cb_info(jsvm_env env, jsvm_callback_info info, size_t* argc, jsvm_value* argv,
                      jsvm_value* this_arg, void** data);
int jsvm_get_value_int32(jsvm_env env, jsvm_value value, int32_t* result);
int jsvm_create_int32(jsvm_env env, int32_t value, jsvm_value* result);
int jsvm_create_function(jsvm_env env, const char* name, size_t length, jsvm_callback callback,
                         void* data, jsvm_value* result);
int jsvm_set_named_property(jsvm_env env, jsvm_value object, const char* name, jsvm_value value);

// --- string/arraybuffer helpers (names follow the JSVM C API convention) ----
int jsvm_get_value_string_utf8(jsvm_env env, jsvm_value value, char* buffer, size_t size,
                               size_t* result);
int jsvm_create_string_utf8(jsvm_env env, const char* value, size_t length, jsvm_value* result);
int jsvm_get_arraybuffer_info(jsvm_env env, jsvm_value value, void** data, size_t* length);

#ifdef __cplusplus
}  // extern "C"
#endif

struct LayaExtensionInterface {
  jsvm_env (*get_env)();
  jsvm_value (*get_exports)();
  void (*post_to_js)(void* data);
};

typedef struct LayaExtensionInitInfo {
  int api_version;
  const char* name;
  const char* version;
  int (*on_event)(LayaExtEventType event, const LayaExtensionInterface* iface, void* user_data);
  void* user_data;
} LayaExtensionInitInfo;

#ifdef _WIN32
#define LAYA_EXT_EXPORT __declspec(dllexport)
#else
#define LAYA_EXT_EXPORT __attribute__((visibility("default")))
#endif

#define LAYA_EXTENSION_ENTRY(fn)                                                        \
  extern "C" LAYA_EXT_EXPORT int laya_extension_init(const LayaExtensionInterface* engine, \
                                                     LayaExtensionInitInfo* info) {     \
    return fn(engine, info);                                                            \
  }

#define LAYA_EXTENSION_ENTRY_NAMED(name, fn)                                                       \
  extern "C" LAYA_EXT_EXPORT int laya_extension_init_##name(const LayaExtensionInterface* engine,   \
                                                            LayaExtensionInitInfo* info) {         \
    return fn(engine, info);                                                                       \
  }

#endif  // SPELLKARD_LAYANATIVE_SHIM_LAYAEXTENSION_H
