/**
 * Engine-agnostic classification of the ten Boss-race bullet patterns into the
 * few *movement / trajectory families* the renderer knows how to draw.
 *
 * A bullet pattern is defined by **how its shots move**, not by what they look
 * like: a `ring` is a burst of straight rays, a `spiral` carves a helix, a
 * `homing` shot bends toward its target. The simulation only exposes a
 * `patternId` string, so the LayaAir layer needs to pick a trajectory family
 * (straight / curving / orbiting / homing / spreading) without hard-coding a
 * `switch` that can silently drift when a pattern is added. This module is the
 * single source of truth for that mapping and lives in `core/` precisely so it
 * can be unit-tested without a rendering engine.
 *
 * The five families, by kinematics:
 *
 *  - `linear`  constant heading, constant speed — a straight ray. The shots of
 *              a ring/gap-ring fan out along fixed spokes, `n_way` and `aimed`
 *              are straight darts at/around the aim line.
 *  - `curve`   heading changes continuously over the bullet's life, so the path
 *              bows into an arc or oscillates (a sine wobble). `seeded_arc`
 *              spreads its bursts by a seeded heading offset and `sine_stream`
 *              adds a sinusoidal heading term per tick.
 *  - `orbit`   the emitter itself rotates, laying shots along a helix: `spiral`
 *              fires from a rotating base angle and `blossom` returns two
 *              counter-rotating rings, so successive bursts walk around a rose
 *              curve rather than repeating the same rays.
 *  - `homing`  the heading keeps re-aiming at a target, so the path turns to
 *              chase: only `homing`, whose shots are fired off-axis and then
 *              bend back in.
 *  - `spread`  shots fan out from one origin and open up (often accelerating),
 *              not travelling as parallel rays: `laser_curtain` — see the note
 *              below.
 *
 * `laser_curtain` note: the *name* says "laser", but in the simulation it is
 * three long beams emitted from three offset origins (`i * 40000` milli) all
 * pointed straight down, so the curtain visibly **opens out from the boss**
 * rather than flying as a coherent ray bundle — that is the `spread`
 * signature. It is also rendered as an elongated beam so it still reads as a
 * laser curtain on screen.
 *
 * Unknown ids fall back to `'linear'`, the most neutral trajectory.
 *
 * NOTE: `core/` only — never import Laya or platform code from here.
 */

import { BOSS_RACE_PATTERN_IDS } from '../sim/boss_race';

/** The movement/trajectory families a bullet can travel along. */
export type BulletVisualClass = 'linear' | 'curve' | 'orbit' | 'homing' | 'spread';

/**
 * Pattern id → trajectory family.
 *
 *  - `linear` straight, constant-heading rays (`ring`, `gap_ring`, `n_way`,
 *    `aimed`).
 *  - `curve`  continuously bending / oscillating paths (`seeded_arc`,
 *    `sine_stream`).
 *  - `orbit`  rotating emitters tracing helices / rose curves (`spiral`,
 *    `blossom`).
 *  - `homing` heading re-aims at a target and turns to chase (`homing`).
 *  - `spread` expanding fan of shots from one origin (`laser_curtain`).
 */
const PATTERN_TRAJECTORY_CLASS: Record<string, BulletVisualClass> = {
  ring: 'linear',
  gap_ring: 'linear',
  n_way: 'linear',
  aimed: 'linear',
  seeded_arc: 'curve',
  sine_stream: 'curve',
  spiral: 'orbit',
  blossom: 'orbit',
  homing: 'homing',
  laser_curtain: 'spread',
};

/**
 * Classifies a pattern id into its trajectory family. Unknown ids → `'linear'`.
 *
 * The name is kept for compatibility with `bullets.ts` and the tests; despite
 * the "pattern" wording it returns a *movement* family, not a shape family.
 */
export function classifyPattern(patternId: string): BulletVisualClass {
  return PATTERN_TRAJECTORY_CLASS[patternId] ?? 'linear';
}

/**
 * Every pattern id the classifier knows about. Derived from the simulation's
 * authoritative list so a newly-added pattern shows up here automatically and
 * `classifyPattern` can be asserted to cover it (rather than silently falling
 * through to the `linear` default).
 */
export function knownPatternIds(): readonly string[] {
  return BOSS_RACE_PATTERN_IDS;
}
