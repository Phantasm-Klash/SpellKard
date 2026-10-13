/**
 * Stage-entrance cutscene timing.
 *
 * The battle scene runs its tick loop independently of the cutscene overlay
 * (stage title → boss intro → player intro → BGM cue), so this module is the
 * pure timing half: it answers "which step is on screen right now" from the
 * accumulated delta time and nothing else. No RNG, no timers, no Laya — the
 * platform overlay (`platform/laya/view/cutscene.ts`) owns the drawing.
 *
 * Windows are half-open `[start, start + durationMs)`, so a step's end
 * instant belongs to the next step and step boundaries never double-render.
 * A non-positive `durationMs` yields an empty window, i.e. that step is
 * skipped. Once the elapsed time passes the final window `done` reads `true`
 * and `current` reads `null`.
 *
 * NOTE: `core/` only — never import Laya or platform code from here.
 */

/** One beat of the entrance cutscene. */
export interface CutsceneStep {
  kind: 'stage_title' | 'boss_intro' | 'player_intro' | 'bgm_cue' | 'wait';
  /** Window length in milliseconds; non-positive skips the step. */
  durationMs: number;
  /** Banner text for `stage_title` / `boss_intro` / `player_intro`. */
  text?: string;
}

export class CutsceneSequencer {
  private steps: readonly CutsceneStep[] = [];
  private elapsedMs = 0;
  private started = false;

  /** Begins (or restarts) the sequence; `elapsedMs` resets to 0. */
  start(steps: readonly CutsceneStep[]): void {
    this.steps = steps.slice();
    this.elapsedMs = 0;
    this.started = true;
  }

  /** Returns to the never-started state: `done` is `true`, `current` is `null`. */
  reset(): void {
    this.steps = [];
    this.elapsedMs = 0;
    this.started = false;
  }

  /**
   * Advances the clock. `dtMs <= 0` (and non-finite input) is a no-op, so a
   * paused frame or a garbage delta can never rewind or poison the sequence.
   */
  update(dtMs: number): void {
    if (!this.started || !Number.isFinite(dtMs) || dtMs <= 0) {
      return;
    }
    this.elapsedMs += dtMs;
  }

  /** The step whose window contains the elapsed time, or `null`. */
  get current(): CutsceneStep | null {
    if (!this.started) {
      return null;
    }
    let windowStart = 0;
    for (const step of this.steps) {
      const windowEnd = windowStart + Math.max(0, step.durationMs);
      if (this.elapsedMs >= windowStart && this.elapsedMs < windowEnd) {
        return step;
      }
      windowStart = windowEnd;
    }
    return null;
  }

  /** True before the first {@link start} and once every step has elapsed. */
  get done(): boolean {
    if (!this.started) {
      return true;
    }
    let totalMs = 0;
    for (const step of this.steps) {
      totalMs += Math.max(0, step.durationMs);
    }
    return this.elapsedMs >= totalMs;
  }
}
