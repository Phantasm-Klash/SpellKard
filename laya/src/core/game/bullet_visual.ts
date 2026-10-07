/**
 * Engine-agnostic classification of the ten Boss-race bullet patterns into the
 * few *visual families* the renderer knows how to draw.
 *
 * The simulation only exposes a `patternId` string; the LayaAir layer needs to
 * pick a shape family (circle, arrowhead, laser capsule, streaking orb) without
 * hard-coding a `switch` that can silently drift when a pattern is added. This
 * module is the single source of truth for that mapping and lives in `core/`
 * precisely so it can be unit-tested without a rendering engine.
 *
 * Unknown ids fall back to `'orb'`, which is the safest neutral look.
 *
 * NOTE: `core/` only — never import Laya or platform code from here.
 */

import { BOSS_RACE_PATTERN_IDS } from '../sim/boss_race';

/** The visual families a bullet can be drawn as. */
export type BulletVisualClass = 'orb' | 'arrow' | 'capsule' | 'stream';

/**
 * Pattern id → visual family.
 *
 *  - `orb`     round bullets that just sit in the curtain (rings, n-way,
 *              blossom).
 *  - `arrow`   bullets whose silhouette points where they fly (aimed, homing).
 *  - `capsule` long lasers stretched along their travel axis (laser curtain).
 *  - `stream`  fast, faint bullets that read as a streak/trail (spirals, sine
 *              streams, seeded arcs).
 */
const PATTERN_VISUAL_CLASS: Record<string, BulletVisualClass> = {
  ring: 'orb',
  gap_ring: 'orb',
  n_way: 'orb',
  blossom: 'orb',
  aimed: 'arrow',
  homing: 'arrow',
  laser_curtain: 'capsule',
  spiral: 'stream',
  sine_stream: 'stream',
  seeded_arc: 'stream',
};

/** Classifies a pattern id into its visual family. Unknown ids → `'orb'`. */
export function classifyPattern(patternId: string): BulletVisualClass {
  return PATTERN_VISUAL_CLASS[patternId] ?? 'orb';
}

/**
 * Every pattern id the classifier knows about. Derived from the simulation's
 * authoritative list so a newly-added pattern shows up here automatically and
 * `classifyPattern` can be asserted to cover it (rather than silently falling
 * through to the `orb` default).
 */
export function knownPatternIds(): readonly string[] {
  return BOSS_RACE_PATTERN_IDS;
}
