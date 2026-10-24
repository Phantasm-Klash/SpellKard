/**
 * LayaNative glue for `spk_crypto`.
 *
 * Exposes one function to JavaScript:
 *
 *   spk_crypto.randomBytes(n) -> Uint8Array | null
 *
 * `null` means the platform had no working generator, so the JS layer can fall
 * back to its own DRBG instead of trusting empty bytes.
 *
 * Deliberately minimal — no registry, no handles, no callbacks — because the
 * only thing this extension does is hand the engine's JavaScript some bytes.
 *
 * NOTE: `native/crypto_ext/` only.
 */

#include <cstddef>
#include <cstdint>
#include <string>

#include <extension/LayaExtension.h>
#include <jsvm/JSVM.h>

namespace {

/** The platform random filler, defined in `random.cpp`. */
extern "C" size_t spk_crypto_random_bytes(uint8_t* out, size_t length);

/** A length this extension refuses to even attempt, to catch JS-side bugs. */
constexpr int32_t kMaxRequestBytes = 1 << 20;  // 1 MiB

jsvm_value makeNull(jsvm_env env) {
  jsvm_value result;
  jsvm_get_null(env, &result);
  return result;
}

jsvm_value makeString(jsvm_env env, const char* text) {
  jsvm_value result;
  jsvm_create_string_utf8(env, text, JSVM_AUTO_LENGTH, &result);
  return result;
}

/**
 * `randomBytes(length)` — fills a fresh `Uint8Array` with OS randomness.
 *
 * A non-integer, negative, or absurd length returns `null` rather than
 * throwing, so the JS caller decides how to react.
 */
jsvm_value jsRandomBytes(jsvm_env env, jsvm_callback_info info) {
  size_t argc = 1;
  jsvm_value argv[1];
  jsvm_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1) {
    return makeNull(env);
  }

  int32_t requested = 0;
  if (jsvm_get_value_int32(env, argv[0], &requested) != jsvm_ok || requested <= 0 ||
      requested > kMaxRequestBytes) {
    return makeNull(env);
  }
  const size_t length = static_cast<size_t>(requested);

  void* data = nullptr;
  jsvm_value buffer;
  if (jsvm_create_arraybuffer(env, length, &data, &buffer) != jsvm_ok || data == nullptr) {
    return makeNull(env);
  }

  const size_t written = spk_crypto_random_bytes(static_cast<uint8_t*>(data), length);
  if (written != length) {
    // A short read means the platform call failed: report it instead of
    // handing back partially random bytes the caller would trust.
    return makeNull(env);
  }

  jsvm_value typedArray;
  if (jsvm_create_typedarray(env, jsvm_uint8_array, length, buffer, 0, &typedArray) != jsvm_ok) {
    return makeNull(env);
  }
  return typedArray;
}

jsvm_value jsVersion(jsvm_env env, jsvm_callback_info info) {
  (void)info;
  return makeString(env, "spellkard-crypto/1.0.0");
}

/** Reports which platform API this build uses, for diagnostics. */
jsvm_value jsSource(jsvm_env env, jsvm_callback_info info) {
  (void)info;
#if defined(_WIN32)
  return makeString(env, "windows-cng-bcryptgenrandom");
#elif defined(__ANDROID__)
  return makeString(env, "android-getrandom");
#elif defined(__linux__)
  return makeString(env, "linux-getrandom");
#elif defined(__OHOS__)
  return makeString(env, "ohos-getrandom");
#else
  return makeString(env, "unsupported");
#endif
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
  if (event != LAYA_EXT_EVENT_INIT || iface == nullptr) {
    return 0;
  }
  // The engine hands the env and this extension's exports object through
  // accessors; the struct holds no such members directly.
  jsvm_env env = iface->get_env();
  jsvm_value exports = iface->get_exports();
  if (env == nullptr || exports == nullptr) {
    return -1;
  }
  registerFunction(env, exports, "version", jsVersion);
  registerFunction(env, exports, "source", jsSource);
  registerFunction(env, exports, "randomBytes", jsRandomBytes);
  return 0;
}

}  // namespace

/**
 * The single entry point the engine looks for. Mirrors `spk_udp`'s `onEvent`
 * wiring so both extensions load the same way.
 */
extern "C" int LayaExtensionMain(LayaExtEventType event, const LayaExtensionInterface* iface,
                                 void* userData) {
  return onEvent(event, iface, userData);
}
