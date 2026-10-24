/**
 * Randomness for the battle handshake, from the **platform's own** CSPRNG.
 *
 * LayaNative exposes `crypto.getRandomValues` as a shim whose every method
 * throws `"not implemented"` (measured on the shipped Windows runtime: see
 * `laya/src/platform/native/crypto/random.ts`). The engine therefore offers no
 * OS-backed randomness to JavaScript, and a native extension is the only way to
 * reach the operating system's own generator.
 *
 * Each platform uses its own official API — nothing is re-implemented here:
 *
 *   Windows  `BCryptGenRandom`  (CNG, bcrypt.h)
 *   Linux    `getrandom(2)`     (glibc 2.25+, sys/random.h)
 *   Android  `getrandom()`      (NDK API 28+, sys/random.h)
 *   OHOS     `getrandom(2)`     (same syscall as Linux)
 *
 * If the engine later implements `crypto.getRandomValues`, the JS layer prefers
 * that instead and stops calling this extension — no code change required.
 *
 * This is deliberately tiny: one function, no state, no allocation on the
 * engine side. It fills a caller-supplied `ArrayBuffer` and reports how many
 * bytes it actually wrote.
 *
 * NOTE: `native/crypto_ext/` only. This is a client extension — it does not
 * touch the battle server.
 */

#include <cstddef>
#include <cstdint>

#if defined(_WIN32)
#include <windows.h>
#include <bcrypt.h>
#pragma comment(lib, "bcrypt.lib")
#elif defined(__linux__) || defined(__OHOS__)
#include <sys/random.h>
#include <errno.h>
#elif defined(__ANDROID__)
#include <sys/random.h>
#endif

namespace {

/**
 * Fills `out` with OS-random bytes.
 *
 * @returns the number of bytes written, or 0 when the platform call failed.
 */
size_t osRandomBytes(uint8_t* out, size_t length) {
  if (out == nullptr || length == 0) {
    return 0;
  }

#if defined(_WIN32)
  // BCRYPT_USE_SYSTEM_PREFERRED_RNG is the documented, always-available
  // algorithm handle for CNG; it needs no provider to be opened first.
  const NTSTATUS status =
      BCryptGenRandom(nullptr, reinterpret_cast<PUCHAR>(out), static_cast<ULONG>(length),
                      BCRYPT_USE_SYSTEM_PREFERRED_RNG);
  return BCRYPT_SUCCESS(status) ? length : 0;

#elif defined(__linux__) || defined(__OHOS__) || defined(__ANDROID__)
  // `getrandom` can return short, and it can be interrupted before any bytes
  // are produced, so keep asking until the buffer is full or the call fails
  // for a reason other than EINTR.
  size_t written = 0;
  while (written < length) {
    const ssize_t n = ::getrandom(out + written, length - written, 0);
    if (n > 0) {
      written += static_cast<size_t>(n);
      continue;
    }
    if (n < 0 && errno == EINTR) {
      continue;
    }
    return written;
  }
  return written;

#else
  // Unknown platform: no official source, so report failure honestly rather
  // than silently producing weak bytes.
  (void)out;
  (void)length;
  return 0;
#endif
}

}  // namespace

/** C linkage so the JSVM glue can find it without name mangling. */
extern "C" size_t spk_crypto_random_bytes(uint8_t* out, size_t length) {
  return osRandomBytes(out, length);
}
