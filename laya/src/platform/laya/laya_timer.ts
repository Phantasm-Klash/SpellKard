/**
 * `Laya.timer` / `Laya.Browser.now` adapter for the core `TimerLike` contract.
 */

import type { TimerLike } from '../../core/net/transport';

interface TimerEntry {
  caller: { fn: () => void };
  method: () => void;
}

export class LayaTimer implements TimerLike {
  private readonly origin = Laya.Browser.now();
  private nextHandle = 1;
  private readonly entries = new Map<number, TimerEntry>();

  now(): number {
    return Math.floor(Laya.Browser.now() - this.origin);
  }

  setInterval(callback: () => void, intervalMs: number): number {
    const handle = this.nextHandle++;
    const caller = { fn: callback };
    this.entries.set(handle, { caller, method: callback });
    Laya.timer.loop(intervalMs, caller, callback);
    return handle;
  }

  clearInterval(handle: number): void {
    const entry = this.entries.get(handle);
    if (entry === undefined) {
      return;
    }
    Laya.timer.clear(entry.caller, entry.method);
    this.entries.delete(handle);
  }

  setTimeout(callback: () => void, delayMs: number): number {
    const handle = this.nextHandle++;
    const caller = { fn: callback };
    Laya.timer.once(delayMs, caller, callback);
    return handle;
  }

  clearTimeout(handle: number): void {
    this.clearInterval(handle);
  }
}
