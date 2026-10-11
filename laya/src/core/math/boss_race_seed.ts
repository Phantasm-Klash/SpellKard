/**
 * The battle seed, kept at the width the server actually uses.
 *
 * The lobby mints a match seed with `seedFrom(matchID)`
 * (`Gensoulkyo/runtime/core/service.go`) — the first eight bytes of
 * `sha256("gensoulkyo:" + matchID)` read as a signed big-endian `int64`, negated
 * when negative — and publishes it as `server_seed_hex`
 * (`fmt.Sprintf("%016x", uint64(seed))`, sixteen hex digits).
 *
 * The C++ battle server receives the same number as a decimal `--seed` and keeps
 * it in `std::uint64_t match_seed`. Two consumers print it **in full**:
 *
 *  - the deterministic RNG material is `"<seed>:<tick>:<pattern>:<spawn>"`, built
 *    from `std::to_string(match_seed)` (`boss_race.cpp` `BossRaceDeterministicU32`
 *    / `danmaku::DeterministicRng`), and
 *  - `CanonicalStateHash` folds `std::to_string(config_.match_seed)` in.
 *
 * Only the RNG's final XOR narrows it (`static_cast<std::uint32_t>`).
 *
 * A JS `number` is exact only up to `2 ** 53`, and the seed spans the whole
 * uint64 range, so the exact value is carried as decimal text with the low 32
 * bits alongside for the XOR. Folding the seed to 32 bits — which this client
 * used to do in `seedFromHex` — changes both the RNG material and the hashed
 * material, so no client hash could ever equal the server's.
 */

export interface BossRaceSeed {
  /**
   * The exact unsigned 64-bit value, printed the way C++ prints it
   * (`std::to_string(uint64_t)`), i.e. plain decimal with no padding.
   */
  readonly decimal: string;
  /** `seed & 0xffffffff` — the fold the RNG applies before its final mix. */
  readonly low32: number;
  /**
   * `seed >> 32` — bits 32..63.
   *
   * The material-based RNG (`BossRaceDeterministicU32`) only needs `low32`, but
   * `danmaku::DeterministicRng::NextU32` feeds **all eight bytes** of the seed
   * into its FNV-1a accumulator, so the high half has to survive too.
   */
  readonly hi32: number;
}

export const ZERO_BOSS_RACE_SEED: BossRaceSeed = { decimal: '0', low32: 0, hi32: 0 };

/**
 * Wraps a value already known to fit in 32 bits.
 *
 * For tests, offline practice and any seed that is genuinely narrow. A
 * production match seed must come from {@link bossRaceSeedFromHex} — anything
 * wider than 32 bits is silently narrowed here, exactly like `>>> 0`.
 */
export function bossRaceSeedFromU32(value: number): BossRaceSeed {
  const low32 = value >>> 0;
  return { decimal: String(low32), low32, hi32: 0 };
}

/** Accepts an already-built seed or a narrow number, for call-site convenience. */
export function normalizeBossRaceSeed(seed: BossRaceSeed | number): BossRaceSeed {
  return typeof seed === 'number' ? bossRaceSeedFromU32(seed) : seed;
}

/**
 * Builds a seed from the lobby's `server_seed_hex` (big-endian, up to 16 hex
 * digits).
 *
 * The decimal text is produced by repeated multiply-by-16 over a little-endian
 * digit array, so the full 64-bit width survives — `Number.parseInt` would round
 * anything above `2 ** 53`.
 */
export function bossRaceSeedFromHex(hex: string): BossRaceSeed {
  const clean = (hex.startsWith('0x') ? hex.slice(2) : hex).replace(/[^0-9a-fA-F]/g, '');
  if (clean === '') {
    return ZERO_BOSS_RACE_SEED;
  }
  // Little-endian decimal digits of the accumulating value.
  const digits: number[] = [0];
  for (let i = 0; i < clean.length; i += 1) {
    const nibble = Number.parseInt(clean[i], 16);
    if (Number.isNaN(nibble)) {
      continue;
    }
    let carry = nibble;
    for (let d = 0; d < digits.length; d += 1) {
      const value = digits[d] * 16 + carry;
      digits[d] = value % 10;
      carry = Math.floor(value / 10);
    }
    while (carry > 0) {
      digits.push(carry % 10);
      carry = Math.floor(carry / 10);
    }
  }
  while (digits.length > 1 && digits[digits.length - 1] === 0) {
    digits.pop();
  }
  const decimal = digits.reverse().join('');
  const padded = clean.slice(-16).padStart(16, '0');
  return {
    decimal,
    low32: Number.parseInt(padded.slice(8, 16), 16) >>> 0,
    hi32: Number.parseInt(padded.slice(0, 8), 16) >>> 0,
  };
}
