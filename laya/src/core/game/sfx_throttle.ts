/**
 * Per-category sound-effect rate limiter.
 *
 * The lobby's match-event stream can carry a `hit`/`graze` row at up to the
 * simulation's tick rate (60 Hz), and `match.events` pages cap at 64 rows, so a
 * drained backlog would otherwise fire a burst of identical SEs in one frame.
 * The performance layer throttles each channel independently to at most one
 * play per window.
 *
 * Pure and clock-injected: the caller passes `nowMs`, so the limiter is
 * testable with a fake clock and carries no wall-clock dependency of its own.
 *
 * NOTE: `core/` only — never import Laya or platform code from here.
 */

/** Default minimum spacing between two plays of the same SE category (ms). */
export const SFX_THROTTLE_MS = 100;

export class SfxThrottle {
  private readonly lastMs = new Map<string, number>();

  /** @param windowMs minimum spacing; non-positive / non-finite disables throttling. */
  constructor(private readonly windowMs: number = SFX_THROTTLE_MS) {}

  /**
   * Returns whether `category` may play at `nowMs`, and records the play time.
   *
   * The first play of a category always passes. A play is refused while
   * `nowMs - last < windowMs`; a non-finite `nowMs` fails open (the caller
   * cannot be rate-limited without a clock) and is not recorded.
   */
  allow(category: string, nowMs: number): boolean {
    if (!Number.isFinite(nowMs)) {
      return true;
    }
    const window = Number.isFinite(this.windowMs) && this.windowMs > 0 ? this.windowMs : 0;
    const last = this.lastMs.get(category);
    if (last !== undefined && nowMs - last < window) {
      return false;
    }
    this.lastMs.set(category, nowMs);
    return true;
  }

  /** Forgets the throttle state for one category, or all categories when omitted. */
  reset(category?: string): void {
    if (category === undefined) {
      this.lastMs.clear();
    } else {
      this.lastMs.delete(category);
    }
  }
}
