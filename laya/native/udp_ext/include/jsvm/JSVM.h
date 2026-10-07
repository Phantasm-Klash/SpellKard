/*
 * COMPILE-VERIFICATION SHIM — NOT THE REAL HEADER.
 *
 * LayaNative ships the real `jsvm/JSVM.h` (and `extension/LayaExtension.h`)
 * inside its **Windows / Android / iOS / Linux / OHOS Build Support** module:
 *
 *   <support-package>/project/Runtime/<arch>/release/include/jsvm/JSVM.h
 *
 * That package is a public download (see ../../README.md and
 * ../../../README.md). This shim reproduces only the symbols the SpellKard UDP
 * extension touches, with the exact signatures taken from the real header
 * (`LayaAir 3.4.1`, `Runtime/x64/release/include/jsvm/JSVM.h`), so the JSVM glue
 * can be syntax-checked on Linux CI without the runtime.
 *
 * When you build the real Windows DLL from the IDE-exported Native project,
 * DELETE this file / do not put this `include/` directory on the include path —
 * the runtime header must win. See ../README.md.
 *
 * Real definitions this shim mirrors:
 *   enum jsvm_status { jsvm_ok, ... };
 *   #define JSVM_AUTO_LENGTH SIZE_MAX
 *   typedef napi_env          jsvm_env;            // opaque pointer
 *   typedef napi_value        jsvm_value;          // opaque pointer
 *   typedef napi_callback_info jsvm_callback_info; // opaque pointer
 *   typedef napi_value (NAPI_CDECL *jsvm_callback)(napi_env, napi_callback_info);
 *   jsvm_status jsvm_create_int32(jsvm_env, int32_t, jsvm_value *);
 *   ...
 */
#ifndef SPELLKARD_LAYANATIVE_SHIM_JSVM_H
#define SPELLKARD_LAYANATIVE_SHIM_JSVM_H

#include <cstddef>
#include <cstdint>

#ifdef __cplusplus
extern "C" {
#endif

/* jsvm_status — only the members the extension can observe. The real enum has
 * more values after jsvm_ok; the numeric values below match the real header. */
enum jsvm_status {
  jsvm_ok = 0,
  jsvm_invalid_arg = 1,
  jsvm_object_expected = 2,
  jsvm_string_expected = 3,
  jsvm_name_expected = 4,
  jsvm_function_expected = 5,
  jsvm_number_expected = 6,
  jsvm_boolean_expected = 7,
  jsvm_array_expected = 8,
  jsvm_generic_failure = 9,
  jsvm_pending_exception = 10,
};

/* Real header: #define JSVM_AUTO_LENGTH SIZE_MAX */
#define JSVM_AUTO_LENGTH static_cast<size_t>(-1)

/* Opaque handles (real header: napi_env / napi_value / napi_callback_info). */
typedef struct jsvm_env__* jsvm_env;
typedef struct jsvm_value__* jsvm_value;
typedef struct jsvm_callback_info__* jsvm_callback_info;

typedef jsvm_value (*jsvm_callback)(jsvm_env env, jsvm_callback_info info);

/* --- argument / return-value helpers --------------------------------------- */
int jsvm_get_cb_info(jsvm_env env, jsvm_callback_info cbinfo, size_t* argc, jsvm_value* argv,
                     jsvm_value* thisArg, void** data);

int jsvm_get_value_int32(jsvm_env env, jsvm_value value, int32_t* result);
int jsvm_get_value_uint32(jsvm_env env, jsvm_value value, uint32_t* result);
int jsvm_get_value_bool(jsvm_env env, jsvm_value value, bool* result);
int jsvm_get_value_string_utf8(jsvm_env env, jsvm_value value, char* buf, size_t bufsize,
                               size_t* result);

int jsvm_create_int32(jsvm_env env, int32_t value, jsvm_value* result);
int jsvm_create_string_utf8(jsvm_env env, const char* value, size_t length, jsvm_value* result);
int jsvm_create_object(jsvm_env env, jsvm_value* result);
int jsvm_create_array_with_length(jsvm_env env, size_t length, jsvm_value* result);
int jsvm_create_function(jsvm_env env, const char* utf8name, size_t length, jsvm_callback cb,
                         void* data, jsvm_value* result);

int jsvm_get_boolean(jsvm_env env, bool value, jsvm_value* result);
int jsvm_get_undefined(jsvm_env env, jsvm_value* result);

int jsvm_set_named_property(jsvm_env env, jsvm_value object, const char* utf8name,
                            jsvm_value value);
int jsvm_set_element(jsvm_env env, jsvm_value object, uint32_t index, jsvm_value value);

int jsvm_get_arraybuffer_info(jsvm_env env, jsvm_value arraybuffer, void** data,
                              size_t* byteLength);

#ifdef __cplusplus
}  // extern "C"
#endif

#endif  // SPELLKARD_LAYANATIVE_SHIM_JSVM_H
