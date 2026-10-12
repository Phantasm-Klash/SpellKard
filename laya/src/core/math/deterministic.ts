/**
 * Deterministic math shared by the client simulation and the server.
 *
 * Two RNG conventions exist upstream and they are NOT interchangeable:
 *
 *  - `fnv1a32` / `mix32` / `deterministicU32` mirror the Godot prototype
 *    (`godot/scripts/bullet_math.gd`) used by the local practice/spellbook
 *    bullet library.
 *  - `bossRaceDeterministicU32` / `bossRaceDeterministicUnit` mirror the
 *    authoritative C++ `mvp_boss_race` simulation
 *    (`PhK-BattleServer/src/boss_race.cpp`). The battle client MUST use this
 *    one so client-side prediction matches the server exactly.
 *
 * ★ A third, **unrelated** function is also called `deterministicUnit`:
 * `Gensoulkyo/runtime/core/simulation.go`'s SHA-256-based one, used by the Go
 * lobby (card effects, synthetic danmaku). It shares the name and argument shape
 * with {@link deterministicUnit} here but produces different output for the same
 * input. Do not substitute one for the other — the lobby mirror lives in
 * `core/math/lobby_rng.ts` (`lobbyDeterministicUnit`).
 *
 * All arithmetic is done with 32-bit unsigned semantics via `Math.imul` and
 * `>>> 0`, matching the C++/GDScript `& 0xffffffff` masking.
 */

import { normalizeBossRaceSeed, type BossRaceSeed } from './boss_race_seed';
import { lerpF64, llround as llroundF64 } from './float_lib';

/**
 * Re-exported so there is exactly one `llround` in the codebase — see
 * `core/math/float_lib`, the single source of the client's float semantics.
 */
export const llround = llroundF64;

export const MASK_32 = 0xffffffff;
export const TWO_PI = Math.PI * 2;

export interface Vec2 {
  x: number;
  y: number;
}

export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

/** UTF-8 encode without depending on DOM `TextEncoder` (keeps the core portable). */
export function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return out;
}

/** FNV-1a 32-bit hash, byte-compatible with the Godot and C++ implementations. */
export function fnv1a32(text: string): number {
  let hash = 2166136261;
  const bytes = utf8Bytes(text);
  for (let i = 0; i < bytes.length; i += 1) {
    hash = (hash ^ bytes[i]) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/** 32-bit integer mix (MurmurHash3-style finalizer), identical to `mix32` upstream. */
export function mix32(value: number): number {
  let x = value >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x >>> 0;
}

/**
 * Godot-convention deterministic u32: hashes a pattern id string together with
 * seed/tick/spawn-index/stream.
 */
export function deterministicU32(
  seed: number,
  tick: number,
  patternId: string,
  spawnIndex: number,
  stream = 0,
): number {
  const idHash = fnv1a32(patternId);
  let value = seed >>> 0;
  value = (value ^ Math.imul(tick, 0x9e3779b1)) >>> 0;
  value = (value ^ idHash) >>> 0;
  value = (value ^ Math.imul(spawnIndex, 0x85ebca6b)) >>> 0;
  value = (value ^ Math.imul(stream, 0xc2b2ae35)) >>> 0;
  return mix32(value);
}

export function deterministicUnit(
  seed: number,
  tick: number,
  patternId: string,
  spawnIndex: number,
  stream = 0,
): number {
  return deterministicU32(seed, tick, patternId, spawnIndex, stream) / MASK_32;
}

export function deterministicRange(
  seed: number,
  tick: number,
  patternId: string,
  spawnIndex: number,
  stream: number,
  minValue: number,
  maxValue: number,
): number {
  return minValue + (maxValue - minValue) * deterministicUnit(seed, tick, patternId, spawnIndex, stream);
}

/**
 * Authoritative `mvp_boss_race` RNG, ported from
 * `BossRaceDeterministicU32` in `PhK-BattleServer/src/boss_race.cpp`:
 *
 *   material = seed ":" tick ":" pattern_index ":" spawn_index
 *   result   = Mix32(Fnv1a32(material) ^ seed)
 *
 * `seed` and `tick` are treated as unsigned 64-bit upstream. `tick` stays exact
 * as a JS number well past the practical range, but `seed` spans the whole uint64
 * range, so it is carried as a {@link BossRaceSeed}: the **full decimal text**
 * feeds the material (exactly like `std::to_string(match_seed)`) while only the
 * final XOR narrows to the low 32 bits, matching the C++ cast.
 */
export function bossRaceDeterministicU32(
  seed: BossRaceSeed | number,
  tick: number,
  patternIndex: number,
  spawnIndex: number,
): number {
  const resolved = normalizeBossRaceSeed(seed);
  const material = `${resolved.decimal}:${Math.trunc(tick)}:${Math.trunc(patternIndex)}:${Math.trunc(spawnIndex)}`;
  return mix32((fnv1a32(material) ^ resolved.low32) >>> 0);
}

export function bossRaceDeterministicUnit(
  seed: BossRaceSeed | number,
  tick: number,
  patternIndex: number,
  spawnIndex: number,
): number {
  return (bossRaceDeterministicU32(seed, tick, patternIndex, spawnIndex) % 10000) / 10000;
}

/** Unit vector for an angle in radians (screen space: +x right, +y down). */
export function direction(angle: number): Vec2 {
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

export function angleToTarget(origin: Vec2, target: Vec2): number {
  return Math.atan2(target.y - origin.y, target.x - origin.x);
}

export function polar(origin: Vec2, angle: number, distance: number): Vec2 {
  const dir = direction(angle);
  return { x: origin.x + dir.x * distance, y: origin.y + dir.y * distance };
}

export function addVec(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subVec(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scaleVec(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

export function lengthVec(a: Vec2): number {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}

export function distance(a: Vec2, b: Vec2): number {
  return lengthVec(subVec(a, b));
}

export function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) {
    return lo;
  }
  if (value > hi) {
    return hi;
  }
  return value;
}

export function clampInt(value: number, lo: number, hi: number): number {
  return clamp(Math.trunc(value), lo, hi);
}

/** Wrap an angle difference into [-PI, PI). */
export function shortestAngleDelta(fromAngle: number, toAngle: number): number {
  let delta = (toAngle - fromAngle) % TWO_PI;
  if (delta < -Math.PI) {
    delta += TWO_PI;
  } else if (delta >= Math.PI) {
    delta -= TWO_PI;
  }
  return delta;
}

export function rotateToward(fromAngle: number, toAngle: number, maxStep: number): number {
  return fromAngle + clamp(shortestAngleDelta(fromAngle, toAngle), -maxStep, maxStep);
}

/** Linear interpolation — delegates to the unified float library. */
export function lerp(a: number, b: number, t: number): number {
  return lerpF64(a, b, t);
}

/**
 * Port of `BossRaceSimulation::CanonicalStateHash`'s FNV/Mix pair. Used for
 * client/server state-hash comparison.
 */
export function canonicalHashPair(material: string): string {
  const a = fnv1a32(material);
  const b = mix32((a ^ 0x9e3779b9) >>> 0);
  return `${hex8(a)}${hex8(b)}`;
}

function hex8(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}
