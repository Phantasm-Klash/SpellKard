/**
 * Match countdown formatting for the battle HUD.
 *
 * Lives in `core/` (not in the Laya HUD module) for two reasons:
 *  1. It is pure arithmetic with no engine dependency, so it is unit-testable
 *     under `tsconfig.test.json`, which does not include `platform/`.
 *  2. The "unknown limit" rule is a real behaviour, not a formatting detail: a
 *     caller that does not know the server's tick cap must render **nothing**
 *     rather than a plausible-looking `0:00`.
 *
 * NOTE: `core/` only — never import Laya or platform code from here.
 */

import { BOSS_RACE_TICK_RATE_HZ } from '../sim/boss_race';

/**
 * Formats the remaining match time as `M:SS`.
 *
 * Returns `''` when the tick limit is unknown (`0` or negative), which the HUD
 * renders as "no countdown row" instead of a fake time.
 *
 * @param tick          current simulation tick
 * @param tickLimit     server tick cap; `0` means unknown
 * @param tickRateHz    tick rate; defaults to the simulation's 60Hz
 */
export function formatMatchCountdown(
  tick: number,
  tickLimit: number,
  tickRateHz: number = BOSS_RACE_TICK_RATE_HZ,
): string {
  if (tickLimit <= 0) {
    return '';
  }
  const rate = tickRateHz > 0 ? tickRateHz : BOSS_RACE_TICK_RATE_HZ;
  const remainingTicks = Math.max(0, tickLimit - Math.max(0, tick));
  // Round up so the clock only reads 0:00 once the match is actually over.
  const totalSeconds = Math.ceil(remainingTicks / rate);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
