/**
 * Engine-agnostic visual classification of bullets.
 *
 * Two layers live here:
 *
 * 1. **Legacy pattern layer** (10 synthetic patterns): the original `mvp_boss_race`
 *    simulation exposes only a `patternId` string, so the renderer picks a
 *    trajectory family (`linear` / `curve` / `orbit` / `homing` / `spread`).
 *    Retained for parity with the un-migrated server ruleset
 *    (`mvp-boss-race-s0`).
 *
 * 2. **Real danmaku layer** (`bulletKind`): the ported 千夜追忆 simulation
 *    exposes a `kEnemyBullet` value (9..224) plus a motion-func number, so the
 *    renderer looks up a real atlas frame. This is the triple mapping
 *    `bulletKind → { atlas, frame, motionFamily }`, with `atlas`/`frame` coming
 *    from the shared contract (`PhK-Protocol/data/tna_contract.json`) and the
 *    family from `core/sim/danmaku/bullet_motion`.
 *
 * NOTE: `core/` only — never import Laya or platform code from here.
 */

import { BOSS_RACE_PATTERN_IDS } from '../sim/boss_race';
import {
  BULLET_KINDS,
  bulletKindInfo,
  isBulletKind,
  type BulletKindInfo,
} from '../sim/danmaku/bullet_kind';
import { bulletMotionFamily, type BulletMotionFamily } from '../sim/danmaku/bullet_motion';

/** The movement/trajectory families a bullet can travel along. */
export type BulletVisualClass = 'linear' | 'curve' | 'orbit' | 'homing' | 'spread';

/**
 * Real-danmaku visual descriptor: the triple the renderer needs to blit a bullet.
 */
export interface BulletVisualDescriptor {
  /** `kEnemyBullet` value (9..224). */
  bulletKind: number;
  /** Atlas name, e.g. `bulletlist01`. */
  atlas: string;
  /** Frame name inside the atlas, e.g. `kusabi_01.png`. */
  frame: string;
  /** Species name derived from the atlas frame prefix, e.g. `kusabi`. */
  species: string;
  /** Motion family (from the motion-func mirror, or `unknown`). */
  motionFamily: BulletMotionFamily;
}

/** Species name is the frame prefix before the first `_NN` group (e.g. `en_01_01` → `en_01`). */
function speciesOfFrame(frame: string): string {
  const stem = frame.replace(/\.png$/i, '');
  const trimmed = stem.replace(/_\d+$/, '');
  return trimmed === '' ? stem : trimmed;
}

/**
 * Describes a bullet by its `kEnemyBullet` value.
 *
 * @param bulletKind  `kEnemyBullet` value (9..224)
 * @param motionFunc  optional `bulletFunc` number; when given, the motion family
 *                    is resolved from the mirror, otherwise `'unknown'`.
 * @returns the descriptor, or `null` for an out-of-range kind.
 */
export function describeBulletKind(
  bulletKind: number,
  motionFunc?: number,
): BulletVisualDescriptor | null {
  const info: BulletKindInfo | undefined = bulletKindInfo(bulletKind);
  if (info === undefined) {
    return null;
  }
  return {
    bulletKind,
    atlas: info.atlas,
    frame: info.frame,
    species: speciesOfFrame(info.frame),
    motionFamily: motionFunc === undefined ? 'unknown' : bulletMotionFamily(motionFunc),
  };
}

/** Every valid `kEnemyBullet` value, ascending (216 entries). */
export function knownBulletKinds(): readonly number[] {
  return BULLET_KINDS.map((k) => k.type);
}

/** True when `kind` is a valid `kEnemyBullet` value. */
export function isKnownBulletKind(kind: number): boolean {
  return isBulletKind(kind);
}

/** All frame names belonging to a species, in kind order (e.g. `kusabi` → 9 frames). */
export function speciesFrames(species: string): readonly string[] {
  return BULLET_KINDS.filter((k) => speciesOfFrame(k.frame) === species).map((k) => k.frame);
}

/**
 * Frames the art of `bulletKind` forward for local-only animation (e.g. hit
 * flashes) without waiting for a server frame index. The frame cycles through
 * the species' available frames; `fps` defaults to 8.
 *
 * Server-authoritative rendering should use `describeBulletKind(kind).frame`
 * directly (the server sends the frame index), so this helper is opt-in.
 */
export function animatedFrameFor(bulletKind: number, tick: number, fps = 8): string {
  const info = bulletKindInfo(bulletKind);
  if (info === undefined) {
    return '';
  }
  const frames = speciesFrames(speciesOfFrame(info.frame));
  if (frames.length <= 1) {
    return info.frame;
  }
  const step = Math.max(0, Math.floor((tick * fps) / 60));
  return frames[step % frames.length];
}

/**
 * Species whose art is **directional** and should be rotated to face its
 * heading (推断：由切分图集的外观判断——箭头/刀/苦无/札/冰锥等细长形状；
 * 圆形弹（ring/stama/kome/heart…）旋转后无视觉差异，故不列出）。
 *
 * Server-authoritative rotation flags (`rotateFlg`/`rotateAngle`) are not yet
 * decoded, so this is a client-side rendering approximation.
 */
const ROTATING_SPECIES: ReadonlySet<string> = new Set([
  'kusabi',
  'fuda',
  'arrow',
  'sizuku',
  'hyou',
  'kunai',
  'knife',
  'ltama',
  'bird',
]);

/** True when a species' art should rotate to face its travel direction. */
export function isRotatingSpecies(species: string): boolean {
  return ROTATING_SPECIES.has(species);
}

/** Sprite rotation (degrees) for a travel heading, matching `360 - angle + 90`. */
export function spriteRotationDeg(angleDeg: number): number {
  return 360 - angleDeg + 90;
}

// --- legacy pattern layer ---------------------------------------------------

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
 * Classifies a legacy pattern id into its trajectory family. Unknown ids →
 * `'linear'`.
 */
export function classifyPattern(patternId: string): BulletVisualClass {
  return PATTERN_TRAJECTORY_CLASS[patternId] ?? 'linear';
}

/**
 * Every legacy pattern id the classifier knows about. Derived from the
 * simulation's authoritative list so a newly-added pattern shows up here
 * automatically.
 */
export function knownPatternIds(): readonly string[] {
  return BOSS_RACE_PATTERN_IDS;
}
