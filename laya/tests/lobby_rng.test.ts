/**
 * Lobby RNG coverage: `lobbyDeterministicUnit` must reproduce the Go lobby's
 * SHA-256 `deterministicUnit` exactly (`Gensoulkyo/runtime/core/simulation.go`),
 * which is a **different** function from the battle server's same-named Godot
 * mixer in `core/math/deterministic.ts`.
 *
 * The expected values below are the printed output of a tiny Go program that
 * reproduces the Go function verbatim (run on the server from
 * `/root/gotouhou/tmp`, never inside the Gensoulkyo tree):
 *
 *   seed=123456789          ticks 0/100/900, index 0..7
 *   seed=9007199254740993   (2^53 + 1, above the exact `number` range)
 *   seed=1234567890123456789
 *
 * A tolerance of 1e-9 is decisive: the value has a granularity of 1e-4, so a
 * mismatched algorithm would differ by orders of magnitude more.
 */

import { lobbyDeterministicUnit, sha256Bytes, shortHashHex } from '../src/core/math/lobby_rng';
import { expect, expectClose, expectEqual, suite, test } from './harness';

/** `[seedDecimal, tick, [unit for index 0..7]]`, straight from the Go run. */
const GO_UNITS: ReadonlyArray<readonly [string, number, readonly number[]]> = [
  ['123456789', 0, [0.5451, 0.8983, 0.2081, 0.7889, 0.1209, 0.5441, 0.1284, 0.6252]],
  ['123456789', 100, [0.6626, 0.7711, 0.9823, 0.8838, 0.4991, 0.0193, 0.2548, 0.9272]],
  ['123456789', 900, [0.1112, 0.9845, 0.2308, 0.6279, 0.671, 0.6844, 0.1589, 0.745]],
  ['9007199254740993', 0, [0.0429, 0.0365, 0.4934, 0.0287, 0.9783, 0.3886, 0.19, 0.2158]],
  ['9007199254740993', 100, [0.3298, 0.7503, 0.7031, 0.2135, 0.8337, 0.7674, 0.9185, 0.7108]],
  ['9007199254740993', 900, [0.0389, 0.5507, 0.6215, 0.5266, 0.438, 0.1892, 0.5941, 0.505]],
  ['1234567890123456789', 0, [0.6164, 0.1351, 0.5015, 0.5688, 0.6793, 0.9966, 0.9018, 0.9816]],
  ['1234567890123456789', 100, [0.4458, 0.8304, 0.8827, 0.5806, 0.8606, 0.4725, 0.4684, 0.0428]],
  ['1234567890123456789', 900, [0.4027, 0.546, 0.1835, 0.1498, 0.487, 0.0268, 0.732, 0.2253]],
];

suite('lobby rng: sha-256 primitives');

test('sha256Bytes matches the published test vectors', () => {
  // NIST/FIPS 180-4 vectors, independent of the Go program.
  expectEqual(toHex(sha256Bytes('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expectEqual(
    toHex(sha256Bytes('')),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
});

test('shortHashHex is the first four bytes as eight lowercase hex chars', () => {
  // `shortHash` in service.go: hex.EncodeToString(sha256(v)[:4]).
  expectEqual(shortHashHex('abc'), 'ba7816bf');
  expectEqual(shortHashHex(''), 'e3b0c442');
  expectEqual(shortHashHex('abc').length, 8);
});

suite('lobby rng: deterministicUnit vs the Go lobby');

test('every unit matches the Go output, including a seed above 2^53', () => {
  for (const [seedDecimal, tick, units] of GO_UNITS) {
    for (let index = 0; index < units.length; index += 1) {
      const actual = lobbyDeterministicUnit(seedDecimal, tick, 'purge_bell', index);
      expectClose(actual, units[index], 1e-9, `unit(${seedDecimal}, ${tick}, ${index})`);
    }
  }
});

test('a seed above 2^53 is used at full width, not rounded to a double', () => {
  // 2^53 and 2^53 + 1 differ only in the last digit; a `number` seed would
  // collapse them to the same double and yield identical units.
  const exact = lobbyDeterministicUnit('9007199254740993', 0, 'purge_bell', 0);
  const rounded = lobbyDeterministicUnit('9007199254740992', 0, 'purge_bell', 0);
  expectClose(exact, 0.0429, 1e-9);
  expect(exact !== rounded, 'the seed must not be narrowed to a double');
});

test('the unit is bounded to [0, 1) and independent of the Godot mixer', () => {
  for (let index = 0; index < 16; index += 1) {
    const value = lobbyDeterministicUnit('123456789', 42, 'purge_bell', index);
    expect(value >= 0 && value < 1, `unit ${value} must be in [0, 1)`);
    // Granularity is 1e-4, so `value * 10000` is (near) an integer.
    expectClose(value * 10000, Math.round(value * 10000), 1e-6, 'unit must be a 1e-4 bucket');
  }
});

/** Byte array → lowercase hex. */
function toHex(bytes: readonly number[]): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}
