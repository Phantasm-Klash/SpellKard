/**
 * Standalone smoke test for `spk_crypto`'s platform random filler.
 *
 * No engine, no JSVM — it calls `spk_crypto_random_bytes` directly, so it runs
 * in CI on any platform and proves the *platform* half of the extension works.
 * The JSVM glue is syntax-checked by the extension target; the two halves meet
 * inside the runtime, which is covered by `tests/native_battle_crypto.test.ts`.
 *
 * Exit code is non-zero on any failure, so a broken platform build fails CI
 * rather than silently degrading the handshake to the weak DRBG.
 */

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <set>
#include <vector>

extern "C" size_t spk_crypto_random_bytes(uint8_t* out, size_t length);

namespace {

int failures = 0;

void check(bool condition, const char* what) {
  std::printf("%s  %s\n", condition ? "ok  " : "FAIL", what);
  if (!condition) {
    failures += 1;
  }
}

}  // namespace

int main() {
  std::printf("spk_crypto selftest\n");

  // 1. Fills the requested length.
  {
    std::vector<uint8_t> buf(32, 0);
    const size_t written = spk_crypto_random_bytes(buf.data(), buf.size());
    check(written == buf.size(), "fills the requested length");
  }

  // 2. Rejects an empty request without touching the pointer.
  {
    check(spk_crypto_random_bytes(nullptr, 0) == 0, "an empty request reports 0");
  }

  // 3. A null pointer is refused rather than dereferenced.
  {
    check(spk_crypto_random_bytes(nullptr, 16) == 0, "a null pointer reports 0");
  }

  // 4. Two draws differ — the obvious failure mode of a stub that always
  //    returns the same bytes would otherwise go unnoticed.
  {
    std::vector<uint8_t> a(32, 0);
    std::vector<uint8_t> b(32, 0);
    spk_crypto_random_bytes(a.data(), a.size());
    spk_crypto_random_bytes(b.data(), b.size());
    bool identical = true;
    for (size_t i = 0; i < a.size(); ++i) {
      if (a[i] != b[i]) {
        identical = false;
        break;
      }
    }
    check(!identical, "two draws differ");
  }

  // 5. A large draw still fills completely (short reads would show up here).
  {
    const size_t size = 1 << 16;  // 64 KiB
    std::vector<uint8_t> buf(size, 0);
    const size_t written = spk_crypto_random_bytes(buf.data(), buf.size());
    check(written == size, "a 64 KiB draw fills completely");
  }

  // 6. Byte coverage: a generator stuck on a narrow range would fail this.
  {
    const size_t size = 4096;
    std::vector<uint8_t> buf(size, 0);
    spk_crypto_random_bytes(buf.data(), buf.size());
    std::set<uint8_t> seen(buf.begin(), buf.end());
    // 4096 bytes from a uniform source should land near all 256 values; a
    // generator stuck in a handful of values is the thing being caught.
    check(seen.size() >= 200, "byte values are spread across the range");
  }

  std::printf("\n%s (%d failure%s)\n", failures == 0 ? "PASS" : "FAILED", failures,
              failures == 1 ? "" : "s");
  return failures == 0 ? 0 : 1;
}
