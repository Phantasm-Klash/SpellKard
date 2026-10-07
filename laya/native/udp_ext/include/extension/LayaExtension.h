/*
 * COMPILE-VERIFICATION SHIM — NOT THE REAL HEADER.
 *
 * The real `extension/LayaExtension.h` is the stable C ABI contract for
 * LayaNative extensions. It ships inside the **Windows / Android / iOS / Linux /
 * OHOS Build Support** module:
 *
 *   <support-package>/project/Runtime/<arch>/release/include/extension/LayaExtension.h
 *
 * That package is a public download (see ../README.md). This shim reproduces the
 * real header 1:1 (verified against LayaAir 3.4.1
 * `Runtime/x64/release/include/extension/LayaExtension.h`, 8870 bytes) so the
 * SpellKard UDP extension can be syntax-checked on Linux CI without the runtime.
 *
 * When you build the real Windows DLL from the IDE-exported Native project,
 * DELETE this file / do not put this `include/` directory on the include path —
 * the runtime header must win. See ../README.md.
 */
#ifndef SPELLKARD_LAYANATIVE_SHIM_LAYAEXTENSION_H
#define SPELLKARD_LAYANATIVE_SHIM_LAYAEXTENSION_H

#include <stdint.h>
#include <stddef.h>

/* Real header: #include <jsvm/JSVM.h> */
#include <jsvm/JSVM.h>

#ifdef __cplusplus
extern "C" {
#endif

/* -------------------------------------------------------------------------- */
/*  Platform export macro                                                     */
/* -------------------------------------------------------------------------- */
#if defined(_WIN32)
#define LAYA_EXT_EXPORT __declspec(dllexport)
#elif defined(__GNUC__) || defined(__clang__)
#define LAYA_EXT_EXPORT __attribute__((visibility("default")))
#else
#define LAYA_EXT_EXPORT
#endif

/* -------------------------------------------------------------------------- */
/*  Version                                                                   */
/* -------------------------------------------------------------------------- */
#define LAYA_EXTENSION_API_VERSION 1

/* -------------------------------------------------------------------------- */
/*  Lifecycle event types                                                     */
/* -------------------------------------------------------------------------- */
typedef enum {
  LAYA_EXT_EVENT_INIT = 0,   /** Called during extension loading (register JS classes here) */
  LAYA_EXT_EVENT_DEINIT = 1, /** Called during extension unloading */
} LayaExtEventType;

/* -------------------------------------------------------------------------- */
/*  Callback signatures                                                       */
/* -------------------------------------------------------------------------- */
typedef void (*LayaExtFrameCallback)(float dt, void* user_data);
typedef void (*LayaExtVoidCallback)(void* user_data);

/* -------------------------------------------------------------------------- */
/*  Engine-provided interface (function pointer table)                        */
/* -------------------------------------------------------------------------- */
typedef struct {
  uint32_t api_version;

  /* --- JS Environment --- */
  jsvm_env (*get_env)();
  jsvm_value (*get_exports)();

  /* --- Threading --- */
  void (*post_to_js)(LayaExtVoidCallback callback, void* user_data);

  /* --- Logging --- */
  void (*log_info)(const char* msg);
  void (*log_warn)(const char* msg);
  void (*log_error)(const char* msg);
} LayaExtensionInterface;

/* -------------------------------------------------------------------------- */
/*  Extension initialization info (filled by extension entry point)           */
/* -------------------------------------------------------------------------- */
typedef struct {
  uint32_t api_version;
  const char* name;
  const char* version;
  int (*on_event)(LayaExtEventType event, const LayaExtensionInterface* iface, void* user_data);
  void* user_data;
} LayaExtensionInitInfo;

/* -------------------------------------------------------------------------- */
/*  Entry point                                                               */
/* -------------------------------------------------------------------------- */
typedef int (*LayaExtensionEntryFunc)(const LayaExtensionInterface* engine_interface,
                                      LayaExtensionInitInfo* out_info);

#define LAYA_EXTENSION_ENTRY_SYMBOL "laya_extension_init"

#ifdef __cplusplus
#define LAYA_EXTENSION_ENTRY(init_func)                       \
  extern "C" LAYA_EXT_EXPORT int laya_extension_init(         \
      const LayaExtensionInterface* engine_interface,         \
      LayaExtensionInitInfo* out_info) {                      \
    return init_func(engine_interface, out_info);             \
  }
#else
#define LAYA_EXTENSION_ENTRY(init_func)                       \
  LAYA_EXT_EXPORT int laya_extension_init(                    \
      const LayaExtensionInterface* engine_interface,         \
      LayaExtensionInitInfo* out_info) {                      \
    return init_func(engine_interface, out_info);             \
  }
#endif

#if defined(__GNUC__) || defined(__clang__)
#define _LAYA_EXT_USED __attribute__((used))
#else
#define _LAYA_EXT_USED
#endif

#ifdef __cplusplus
#define LAYA_EXTENSION_ENTRY_NAMED(ext_name, init_func)       \
  extern "C" LAYA_EXT_EXPORT _LAYA_EXT_USED                   \
  int laya_extension_init_##ext_name(                         \
      const LayaExtensionInterface* engine_interface,         \
      LayaExtensionInitInfo* out_info) {                      \
    return init_func(engine_interface, out_info);             \
  }
#else
#define LAYA_EXTENSION_ENTRY_NAMED(ext_name, init_func)       \
  LAYA_EXT_EXPORT _LAYA_EXT_USED                              \
  int laya_extension_init_##ext_name(                         \
      const LayaExtensionInterface* engine_interface,         \
      LayaExtensionInitInfo* out_info) {                      \
    return init_func(engine_interface, out_info);             \
  }
#endif

#ifdef __cplusplus
}  // extern "C"
#endif

#endif  // SPELLKARD_LAYANATIVE_SHIM_LAYAEXTENSION_H
