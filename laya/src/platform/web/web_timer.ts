/**
 * Browser timer/clock adapter for the core `TimerLike` contract.
 *
 * KCP's update loop and the battle client's fixed tick both need a monotonic
 * millisecond clock plus interval timers; this maps them onto
 * `performance.now()` / `setInterval`.
 */

import type { TimerLike } from '../../core/net/transport';

export class BrowserTimer implements TimerLike {
  private readonly origin: number;

  constructor() {
    this.origin = typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  now(): number {
    const current = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return Math.floor(current - this.origin);
  }

  setInterval(callback: () => void, intervalMs: number): number {
    return setInterval(callback, intervalMs) as unknown as number;
  }

  clearInterval(handle: number): void {
    clearInterval(handle as unknown as ReturnType<typeof setInterval>);
  }

  setTimeout(callback: () => void, delayMs: number): number {
    return setTimeout(callback, delayMs) as unknown as number;
  }

  clearTimeout(handle: number): void {
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  }
}
