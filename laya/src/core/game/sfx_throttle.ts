/**
 * Per-category sound-effect rate limiter.
 *
 * The lobby's match-event stream can carry a `hit`/`graze` row at up to the
 * simulation's tick rate (60 Hz), and `match.events` pages cap at 64 rows, so a
 * drained backlog would otherwise fire a burst of identical SEs in one frame.
 * The performance layer throttles each channel independently to at most one
 * play per window.
 *
 * ★ Window from the reverse-engineering spec §2.0: `GameLayer::ExeSoundEffect`
 * gates its first leaf on `[GameLayer+0x504]` (a per-frame counter) and refuses
 * a repeat while fewer than **5 frames** have elapsed since the last play
 * (`w8 = [0x5d4] + 5; if ([0x504] <= w8) return`). At the engine's 60 fps
 * default that is ~83.3 ms.
 *
 * Pure and clock-injected: the caller passes `nowMs`, so the limiter is
 * testable with a fake clock and carries no wall-clock dependency of its own.
 *
 * NOTE: `core/` only — never import Laya or platform code from here.
 */

/** Reference frame rate the spec quotes the SE window at (spec global). */
export const SFX_REFERENCE_FPS = 60;

/** Minimum spacing between two plays of one SE category, in reference frames. Spec §2.0: 5. */
export const SFX_THROTTLE_FRAMES = 5;

/** Default minimum spacing between two plays of the same SE category (ms) ≈ 83.3 ms. */
export const SFX_THROTTLE_MS = (SFX_THROTTLE_FRAMES * 1000) / SFX_REFERENCE_FPS;

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
