/**
 * Card-effect mirror of the lobby's authoritative card catalogue.
 *
 * The Go lobby (`Gensoulkyo/runtime/core`) is the original source of truth for
 * the card set and its effects; the C++ battle server ports the same rules
 * (`phk/battle/card_hand.hpp` + `phk/battle/card_effects.hpp`) and drives them
 * from `BattleSimulation::ExecuteCastCard`. This module is the client side of
 * that contract: the effect-kind vocabulary, the static definition of **all 20
 * catalog cards** (base 12 + contract 4 + expansion 4) and the effect
 * execution layer, so the battle view and the inventory screen can talk about a
 * card without guessing at server-only constants.
 *
 * ★ 字段名 / 取值必须与 `card_records_spec.md` §1.1–§1.3 一致：服务端在并行
 * 实现同一份契约，改这里的 `cardId` / `effectKind` / 数值就等于改 wire 契约。
 *
 * The helpers below are deliberately pure (no LayaAir, no DOM) so they are
 * unit-testable and reusable by any renderer.
 */

import { lobbyDeterministicUnit } from '../math/lobby_rng';
import { MILLI_PER_PIXEL } from '../math/float_lib';
import { BOSS_RACE_TICK_RATE_HZ } from './boss_race';

/**
 * Every `EffectKind` the lobby knows.
 *
 * `self` / `pattern` / `economy` / `finisher` already existed; the last three
 * (`opponent_pattern` / `bullet_purge` / `invulnerable`) are new with this
 * contract. `finisher` is listed once even though `last_arc` predates it —
 * the spec folds `last_arc` into the same behaviour.
 */
export const CARD_EFFECT_KINDS = [
  'self',
  'pattern',
  'economy',
  'opponent_pattern',
  'bullet_purge',
  'invulnerable',
  'finisher',
] as const;

export type CardEffectKind = (typeof CARD_EFFECT_KINDS)[number];

/** Rarity tier, mirroring the lobby's `serverCardRarities`. */
export type CardRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

/** Who an effect acts on, derived from its {@link CardEffectKind}. */
export type CardEffectTarget = 'self' | 'opponent' | 'global';

/**
 * Static definition of one card, mirroring the lobby's `serverCardDefinition`
 * plus the fields this client needs (`rarity`, `purgeRadius`, `purgeCount`).
 *
 * `purgeRadius` is carried in the **server's own unit** (pixels of the 640×960
 * playfield, exactly as the wire sends it); use {@link purgeRadiusMilli} to get
 * the milli-unit radius the client simulation works in.
 */
export interface CardEffectDefinition {
  cardId: string;
  effectKind: CardEffectKind;
  cost: number;
  cooldownTicks: number;
  durationTicks: number;
  damage: number;
  scoreBonus: number;
  rarity: CardRarity;
  /** Clear radius in playfield pixels (`bullet_purge` only). */
  purgeRadius?: number;
  /** How many bullets are removed (`bullet_purge` only). */
  purgeCount?: number;
  /**
   * The opponent-pattern curtain's pattern id (`pattern_id` in the server's
   * catalog). Empty = fall back to the card's own id, exactly like the C++
   * `CardActivation::pattern_id` default (`card_hand.cpp:145`).
   *
   * ★ The catalog does not set it: every `opponent_pattern` card in the server's
   * 20-card table names **itself** as its pattern (`mirror_lance` →
   * `mirror_lance`, `ember_lance` → `ember_lance`, `card_hand.cpp:35`/`:40`), so
   * `core/sim/card_hand.ts` derives it from the card id instead of repeating it
   * here — the resulting value is identical.
   */
  patternId?: string;
  /**
   * `energy_gain` — the lobby grants this much extra energy when the card is
   * played (`draw_sigil`: 0.75, `card_hand.cpp:30`). The battle server's
   * ledger ignores it; the field is carried so the client can describe it.
   */
  energyGain?: number;
  /** `draw_cards` — extra cards drawn (`draw_sigil`: 1, `card_hand.cpp:30`). */
  drawCards?: number;
}

/**
 * The twelve base-catalog cards, values verbatim from the lobby's
 * `serverCardCatalog` (`Gensoulkyo/runtime/core/service.go`, same numbers as
 * C++ `kCatalog` in `card_hand.cpp`). Every id in the 20-card catalog must
 * resolve here or in {@link NEW_CARD_EFFECTS} / {@link EXPANSION_CARD_EFFECTS},
 * otherwise battle events and the hand view silently drop the card.
 *
 * `draw_sigil`'s `energy_gain` (0.75) and `draw_cards` (1) are simulation-side
 * only; the lobby owns that math, this mirror only renders.
 */
export const BASE_CARD_EFFECTS: Readonly<Record<string, CardEffectDefinition>> = {
  focus_lens: {
    cardId: 'focus_lens',
    effectKind: 'self',
    cost: 2,
    cooldownTicks: 240,
    durationTicks: 360,
    damage: 12,
    scoreBonus: 18,
    rarity: 'common',
  },
  hitbox_charm: {
    cardId: 'hitbox_charm',
    effectKind: 'self',
    cost: 3,
    cooldownTicks: 420,
    durationTicks: 300,
    damage: 14,
    scoreBonus: 20,
    rarity: 'uncommon',
  },
  density_surge: {
    cardId: 'density_surge',
    effectKind: 'pattern',
    cost: 4,
    cooldownTicks: 540,
    durationTicks: 420,
    damage: 30,
    scoreBonus: 32,
    rarity: 'rare',
  },
  tempo_break: {
    cardId: 'tempo_break',
    effectKind: 'pattern',
    cost: 3,
    cooldownTicks: 480,
    durationTicks: 300,
    damage: 22,
    scoreBonus: 26,
    rarity: 'uncommon',
  },
  bomb_amplifier: {
    cardId: 'bomb_amplifier',
    effectKind: 'self',
    cost: 2,
    cooldownTicks: 360,
    durationTicks: 480,
    damage: 16,
    scoreBonus: 18,
    rarity: 'common',
  },
  guard_seal: {
    cardId: 'guard_seal',
    effectKind: 'self',
    cost: 5,
    cooldownTicks: 720,
    durationTicks: 900,
    damage: 18,
    scoreBonus: 30,
    rarity: 'rare',
  },
  graze_engine: {
    cardId: 'graze_engine',
    effectKind: 'economy',
    cost: 2,
    cooldownTicks: 300,
    durationTicks: 360,
    damage: 10,
    scoreBonus: 20,
    rarity: 'common',
  },
  draw_sigil: {
    cardId: 'draw_sigil',
    effectKind: 'economy',
    cost: 1,
    cooldownTicks: 420,
    durationTicks: 1,
    damage: 0,
    scoreBonus: 12,
    rarity: 'common',
    energyGain: 0.75,
    drawCards: 1,
  },
  aim_baffle: {
    cardId: 'aim_baffle',
    effectKind: 'pattern',
    cost: 4,
    cooldownTicks: 600,
    durationTicks: 360,
    damage: 28,
    scoreBonus: 32,
    rarity: 'rare',
  },
  purge_charm: {
    cardId: 'purge_charm',
    effectKind: 'self',
    cost: 3,
    cooldownTicks: 540,
    durationTicks: 480,
    damage: 18,
    scoreBonus: 24,
    rarity: 'uncommon',
  },
  curve_prism: {
    cardId: 'curve_prism',
    effectKind: 'pattern',
    cost: 3,
    cooldownTicks: 500,
    durationTicks: 360,
    damage: 24,
    scoreBonus: 28,
    rarity: 'uncommon',
  },
  last_arc: {
    cardId: 'last_arc',
    effectKind: 'finisher',
    cost: 6,
    cooldownTicks: 900,
    durationTicks: 420,
    damage: 48,
    scoreBonus: 60,
    rarity: 'epic',
  },
};

/** The four cards added by the card-records contract. */
export const NEW_CARD_IDS = ['mirror_lance', 'purge_bell', 'aegis_ward', 'finale_arc'] as const;
export type NewCardId = (typeof NEW_CARD_IDS)[number];

/**
 * The four new cards, values verbatim from `card_records_spec.md` §1.2.
 *
 * | cardId | effectKind | cost | cooldown | duration | damage | score | extra |
 * | --- | --- | --- | --- | --- | --- | --- | --- |
 * | mirror_lance | opponent_pattern | 4 | 540 | 360 | 26 | 30 | — |
 * | purge_bell | bullet_purge | 3 | 480 | 1 | 0 | 22 | radius 120 / count 24 |
 * | aegis_ward | invulnerable | 5 | 720 | 180 | 0 | 20 | — |
 * | finale_arc | finisher | 6 | 900 | 1 | 60 | 80 | — |
 */
export const NEW_CARD_EFFECTS: Readonly<Record<NewCardId, CardEffectDefinition>> = {
  mirror_lance: {
    cardId: 'mirror_lance',
    effectKind: 'opponent_pattern',
    cost: 4,
    cooldownTicks: 540,
    durationTicks: 360,
    damage: 26,
    scoreBonus: 30,
    rarity: 'rare',
  },
  purge_bell: {
    cardId: 'purge_bell',
    effectKind: 'bullet_purge',
    cost: 3,
    cooldownTicks: 480,
    durationTicks: 1,
    damage: 0,
    scoreBonus: 22,
    rarity: 'uncommon',
    purgeRadius: 120,
    purgeCount: 24,
  },
  aegis_ward: {
    cardId: 'aegis_ward',
    effectKind: 'invulnerable',
    cost: 5,
    cooldownTicks: 720,
    durationTicks: 180,
    damage: 0,
    scoreBonus: 20,
    rarity: 'rare',
  },
  finale_arc: {
    cardId: 'finale_arc',
    effectKind: 'finisher',
    cost: 6,
    cooldownTicks: 900,
    durationTicks: 1,
    damage: 60,
    scoreBonus: 80,
    rarity: 'epic',
  },
};

/**
 * The four cards of the 16 -> 20 pool expansion (2026-10-17), values verbatim
 * from the lobby's authoritative catalog (`Gensoulkyo/runtime/core/service.go`).
 *
 * | cardId | effectKind | cost | cooldown | duration | damage | score | extra |
 * | --- | --- | --- | --- | --- | --- | --- | --- |
 * | frost_arc | bullet_purge | 2 | 360 | 1 | 0 | 18 | radius 100 / count 12 |
 * | ember_lance | opponent_pattern | 3 | 300 | 240 | 20 | 24 | — |
 * | iron_veil | invulnerable | 4 | 480 | 120 | 0 | 16 | — |
 * | thunder_fall | finisher | 4 | 420 | 1 | 30 | 40 | — |
 *
 * Rarities mirror the lobby's `serverCardRarities`: uncommon siblings of
 * existing cards (deck-legal: only thunder_fall counts against the six
 * high-rarity cap) and one epic finisher. ember_lance's fan geometry
 * (5 x speed 6.5 / radius 4.0 / amber) is server-side compile-time data — the
 * client renders the server's bullet deltas, so it carries no pattern table.
 */
export const EXPANSION_CARD_IDS = ['frost_arc', 'ember_lance', 'iron_veil', 'thunder_fall'] as const;
export type ExpansionCardId = (typeof EXPANSION_CARD_IDS)[number];

export const EXPANSION_CARD_EFFECTS: Readonly<Record<ExpansionCardId, CardEffectDefinition>> = {
  frost_arc: {
    cardId: 'frost_arc',
    effectKind: 'bullet_purge',
    cost: 2,
    cooldownTicks: 360,
    durationTicks: 1,
    damage: 0,
    scoreBonus: 18,
    rarity: 'uncommon',
    purgeRadius: 100,
    purgeCount: 12,
  },
  ember_lance: {
    cardId: 'ember_lance',
    effectKind: 'opponent_pattern',
    cost: 3,
    cooldownTicks: 300,
    durationTicks: 240,
    damage: 20,
    scoreBonus: 24,
    rarity: 'uncommon',
  },
  iron_veil: {
    cardId: 'iron_veil',
    effectKind: 'invulnerable',
    cost: 4,
    cooldownTicks: 480,
    durationTicks: 120,
    damage: 0,
    scoreBonus: 16,
    rarity: 'uncommon',
  },
  thunder_fall: {
    cardId: 'thunder_fall',
    effectKind: 'finisher',
    cost: 4,
    cooldownTicks: 420,
    durationTicks: 1,
    damage: 30,
    scoreBonus: 40,
    rarity: 'epic',
  },
};

/** True when `kind` is one of the contract's `EffectKind` values. */
export function isCardEffectKind(kind: string): kind is CardEffectKind {
  return (CARD_EFFECT_KINDS as readonly string[]).includes(kind);
}

/**
 * True for effects aimed at the **opponent** — the only one today is
 * `opponent_pattern`, which fires a directional curtain at the opponent's
 * current position (`atan2`-aimed, `PatternID` = the card's own id).
 */
export function isOpponentTargeted(kind: string): boolean {
  return kind === 'opponent_pattern';
}

/** True for effects the caster applies to themselves. */
export function isSelfTargeted(kind: string): boolean {
  return kind === 'self' || kind === 'bullet_purge' || kind === 'invulnerable';
}

/** True for effects that touch the whole field. */
export function isGlobalEffect(kind: string): boolean {
  return kind === 'finisher' || kind === 'pattern';
}

/** Maps an effect kind onto its target bucket. */
export function effectTarget(kind: string): CardEffectTarget {
  if (isOpponentTargeted(kind)) {
    return 'opponent';
  }
  if (isGlobalEffect(kind)) {
    return 'global';
  }
  return 'self';
}

/** The static definition for a card id, or `null` when the card is unknown. */
export function cardEffectDefinition(cardId: string): CardEffectDefinition | null {
  const tables = [BASE_CARD_EFFECTS, NEW_CARD_EFFECTS, EXPANSION_CARD_EFFECTS] as Readonly<Record<string, CardEffectDefinition>>[];
  for (const table of tables) {
    const definition = table[cardId];
    if (definition !== undefined) {
      return definition;
    }
  }
  return null;
}

/** True when `cardId` is one of the four cards added by this contract. */
export function isNewCard(cardId: string): cardId is NewCardId {
  return (NEW_CARD_IDS as readonly string[]).includes(cardId);
}

/**
 * The clear radius/count of a `bullet_purge` card, or `null` when the card is
 * not a purge card. Radius is in playfield pixels (wire unit); convert with
 * {@link purgeRadiusMilli} before comparing against client milli positions.
 */
export function purgeSpecFor(cardId: string): { radius: number; count: number } | null {
  const definition = cardEffectDefinition(cardId);
  if (definition === null || definition.effectKind !== 'bullet_purge') {
    return null;
  }
  return { radius: definition.purgeRadius ?? 0, count: definition.purgeCount ?? 0 };
}

/** Playfield pixels → the client simulation's milli-unit radius. */
export function purgeRadiusMilli(radiusPx: number): number {
  return radiusPx * MILLI_PER_PIXEL;
}

/** Rarity → a short, player-facing label for the inventory screen. */
export function rarityLabel(rarity: CardRarity): string {
  switch (rarity) {
    case 'common':
      return 'Common';
    case 'uncommon':
      return 'Uncommon';
    case 'rare':
      return 'Rare';
    case 'epic':
      return 'Epic';
    case 'legendary':
      return 'Legendary';
    default:
      return String(rarity);
  }
}

/** One-line, player-facing effect summary for a known card; `''` when unknown. */
export function describeCardEffect(cardId: string): string {
  const definition = cardEffectDefinition(cardId);
  if (definition === null) {
    return '';
  }
  switch (definition.effectKind) {
    case 'opponent_pattern':
      return `Fires an aimed curtain at the opponent (dmg ${definition.damage})`;
    case 'bullet_purge':
      return `Clears ${definition.purgeCount ?? 0} bullets within ${definition.purgeRadius ?? 0}px`;
    case 'invulnerable':
      return `Immune to damage for ${(definition.durationTicks / BOSS_RACE_TICK_RATE_HZ).toFixed(1)}s`;
    case 'finisher':
      return `Clears the field and deals ${definition.damage} damage`;
    default:
      return `${definition.effectKind} · dmg ${definition.damage}`;
  }
}

// ---------------------------------------------------------------------------
// Pure view helpers (shared by the battle renderer and its tests)
// ---------------------------------------------------------------------------

/** A bullet position, in the simulation's milli units. */
export interface PurgeCandidate {
  bulletId: string;
  xMilli: number;
  yMilli: number;
}

/**
 * Deterministically picks which in-radius bullets a `bullet_purge` removes.
 *
 * Mirrors the server's canonical rule (agreed with the lobby's card-effects
 * implementation):
 *
 *  1. Order **every** bullet by `bulletId` ascending (byte-wise, i.e. the
 *     server's `sortedBulletIDs`). The full snapshot's `bullets` already come in
 *     this order, but this sorts defensively so the caller's input order never
 *     changes the result.
 *  2. Score each bullet by its index `p` in that canonical order:
 *     `deterministicUnit(seed, tick, cardID, p)`. ★ That is the **lobby's**
 *     SHA-256 function (`core/math/lobby_rng.ts`), NOT the battle server's
 *     same-named Godot mixer (`core/math/deterministic.ts`) — the two agree on
 *     neither argument meaning nor output. The third argument is the **card id**
 *     (`'purge_bell'`), not the effect kind.
 *  3. Keep the candidates within `radiusMilli` of the origin.
 *  4. Sort the survivors by `(unit asc, bulletId asc)` and take the first
 *     `count`.
 *
 * Because the index is taken over the canonical full-bullet order, the caller
 * must pass the **full** bullet set for the two sides to agree; a subset shifts
 * every later index.
 *
 * @param radiusMilli clear radius, already converted to milli units
 * @param seedDecimal the lobby match seed as decimal text
 *                    (`bossRaceSeedFromHex(hex).decimal`)
 * @param cardId the purge card's id, used as the deterministic stream
 */
export function selectPurgeTargets(
  bullets: readonly PurgeCandidate[],
  originXMilli: number,
  originYMilli: number,
  radiusMilli: number,
  count: number,
  seedDecimal: string,
  tick: number,
  cardId: string,
): string[] {
  const radiusSq = radiusMilli * radiusMilli;
  const canonical = bullets.slice().sort((left, right) => compareIds(left.bulletId, right.bulletId));
  const eligible: { bulletId: string; unit: number }[] = [];
  for (let index = 0; index < canonical.length; index += 1) {
    const bullet = canonical[index];
    const dx = bullet.xMilli - originXMilli;
    const dy = bullet.yMilli - originYMilli;
    if (dx * dx + dy * dy > radiusSq) {
      continue;
    }
    eligible.push({ bulletId: bullet.bulletId, unit: lobbyDeterministicUnit(seedDecimal, tick, cardId, index) });
  }
  eligible.sort((left, right) => (left.unit !== right.unit ? left.unit - right.unit : compareIds(left.bulletId, right.bulletId)));
  const limit = Math.max(0, Math.trunc(count));
  return eligible.slice(0, limit).map((entry) => entry.bulletId);
}

/**
 * Byte-wise string order for bullet ids, matching Go's `sort.Strings`.
 *
 * JS compares UTF-16 code units, which is the same order as UTF-8 bytes for the
 * ASCII ids the server mints; `localeCompare` is deliberately avoided because a
 * locale-aware collation would disagree on punctuation (`-`, `_`) and case.
 */
function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The aim vector of an `opponent_pattern` curtain, in radians (`atan2`). */
export interface OpponentPatternWarning {
  originXMilli: number;
  originYMilli: number;
  targetXMilli: number;
  targetYMilli: number;
  /** Direction from origin to target: `Math.atan2(dy, dx)`. */
  angleRad: number;
  /** The pattern the curtain fires under — the card's own id. */
  patternId: string;
}

/** Builds the aim line for an `opponent_pattern`, aimed at the opponent. */
export function opponentPatternWarning(
  originXMilli: number,
  originYMilli: number,
  targetXMilli: number,
  targetYMilli: number,
  patternId: string,
): OpponentPatternWarning {
  return {
    originXMilli,
    originYMilli,
    targetXMilli,
    targetYMilli,
    angleRad: Math.atan2(targetYMilli - originYMilli, targetXMilli - originXMilli),
    patternId,
  };
}

/**
 * Ticks of invulnerability still owed, clamped at 0.
 *
 * Mirrors the server's `InvulnerableUntil = tick + DurationTicks`: the HUD ring
 * only has to know how much of that window is left.
 */
export function invulnerableRemainingTicks(invulnerableUntilTick: number, nowTick: number): number {
  return Math.max(0, Math.trunc(invulnerableUntilTick) - Math.trunc(nowTick));
}

// ---------------------------------------------------------------------------
// Effect execution layer — the TypeScript port of the battle server's
// `phk/battle/card_effects.hpp` / `card_effects.cpp`.
//
// The catalogue above answers "what does this card do"; this section answers
// "what does the field look like after the card fired". Every rule below is
// transcribed from the C++ server, which is the port of the lobby's
// `Gensoulkyo/runtime/core/card_effects.go`:
//
// | rule | C++ |
// | --- | --- |
// | opponent-pattern fan geometry | `card_effects.cpp:94-102` |
// | opponent-pattern spawn | `card_effects.cpp:104-181` |
// | bullet purge | `card_effects.cpp:183-260` |
// | invulnerable window | `card_effects.cpp:262-268` |
// | finisher (clear the field) | `card_effects.cpp:270-301` |
// | opponent pick (lowest id) | `card_effects.cpp:74-87` |
// | bullet id order | `card_effects.cpp:64-72` |
//
// ★ Unit note: the C++ deltas are **pixels** with Go-style rounding (x/y/radius
// 3 decimals, vx/vy 4 — `card_effects.cpp:45-50`) because the shared
// simulation stores integer-milli bullets and re-multiplies by 1000 in
// `ApplyBulletDeltas` (`simulation.cpp:2546-2551`). This port keeps **milli**
// end to end — the client simulation's native unit — so the values agree with
// the server to the milli and no second rounding step is needed.
// ---------------------------------------------------------------------------

/** `kCardOpponentPatternCount` — `card_effects.hpp:28`. */
export const CARD_OPPONENT_PATTERN_COUNT = 7;
/** `kCardOpponentPatternSpread` — `card_effects.hpp:29` (π/3). */
export const CARD_OPPONENT_PATTERN_SPREAD = Math.PI / 3;
/** `kCardOpponentPatternSpeed` — `card_effects.hpp:30` (px/tick). */
export const CARD_OPPONENT_PATTERN_SPEED = 5.0;
/** `kCardOpponentPatternRadius` — `card_effects.hpp:31` (px). */
export const CARD_OPPONENT_PATTERN_RADIUS = 4.5;
/** `kCardOpponentPatternColor` — `card_effects.hpp:32`. */
export const CARD_OPPONENT_PATTERN_COLOR = 'violet';
/** `kMaxBullets` — `card_effects.hpp:50` (the field cap `addBulletLocked` enforces). */
export const CARD_MAX_BULLETS = 384;

/**
 * The boss origin the opponent-pattern curtain is fired from.
 *
 * C++ `kBossOriginX` / `kBossOriginY` (`card_effects.hpp:46-47`) are `(0, 0)`
 * in **arena** coordinates — the shared boss sits at the arena centre. A mode
 * whose boss sits elsewhere (the boss race puts it at `(0, -60000)` milli)
 * passes its own origin; the geometry itself is unchanged.
 */
export const CARD_BOSS_ORIGIN_X_MILLI = 0;
export const CARD_BOSS_ORIGIN_Y_MILLI = 0;

/** The fan geometry of an opponent-pattern card — C++ `CardPatternGeometry`. */
export interface CardPatternGeometry {
  count: number;
  spread: number;
  speed: number;
  radius: number;
  color: string;
}

/**
 * `CardPatternGeometryFor` — C++ `card_effects.cpp:94-102`.
 *
 * `ember_lance` brings its own fan (5 shots / speed 6.5 / radius 4.0 /
 * amber); every other id — including `mirror_lance` and anything unregistered
 * — falls back to the original constants, so the behaviour is bit-for-bit
 * unchanged for the cards that existed first.
 */
export function cardPatternGeometryFor(patternId: string): CardPatternGeometry {
  if (patternId === 'ember_lance') {
    return {
      count: 5,
      spread: CARD_OPPONENT_PATTERN_SPREAD,
      speed: 6.5,
      radius: 4.0,
      color: 'amber',
    };
  }
  return {
    count: CARD_OPPONENT_PATTERN_COUNT,
    spread: CARD_OPPONENT_PATTERN_SPREAD,
    speed: CARD_OPPONENT_PATTERN_SPEED,
    radius: CARD_OPPONENT_PATTERN_RADIUS,
    color: CARD_OPPONENT_PATTERN_COLOR,
  };
}

/** The activation parameters — C++ `CardActivation` (`card_effects.hpp:95-102`). */
export interface CardActivation {
  cardId: string;
  /** `opponent_pattern` | `bullet_purge` | `invulnerable` | `finisher` | … */
  effectKind: string;
  /** Only used by `opponent_pattern`; empty falls back to the card's own id. */
  patternId: string;
  /** `tick + duration_ticks`. */
  expiresTick: number;
  /** Only used by `bullet_purge` (playfield pixels). */
  purgeRadius: number;
  /** Only used by `bullet_purge`. */
  purgeCount: number;
}

/** A read-only bullet snapshot — C++ `CardBulletSnapshot` (`card_effects.hpp:73-85`). */
export interface CardBulletSnapshot {
  bulletId: string;
  patternId: string;
  kind: string;
  spawnTick: number;
  xMilli: number;
  yMilli: number;
  vxMilli: number;
  vyMilli: number;
  radiusMilli: number;
  damage: number;
  color: string;
}

/** A read-only player snapshot — C++ `CardPlayerSnapshot` (`card_effects.hpp:88-92`). */
export interface CardPlayerSnapshot {
  playerId: string;
  xMilli: number;
  yMilli: number;
}

/** A bullet delta — C++ `CardBulletDelta` (`card_effects.hpp:108-121`). */
export interface CardBulletDelta {
  op: 'spawn' | 'despawn';
  bulletId: string;
  patternId: string;
  kind: string;
  tick: number;
  xMilli: number;
  yMilli: number;
  vxMilli: number;
  vyMilli: number;
  radiusMilli: number;
  damage: number;
  color: string;
}

/** The result of one effect — C++ `CardEffectResult` (`card_effects.hpp:123-132`). */
export interface CardEffectResult {
  bulletDeltas: CardBulletDelta[];
  /** The opponent the curtain was aimed at (the lowest other player id). */
  targetUserId: string;
  hasTarget: boolean;
  /** The new invulnerability deadline (`invulnerable` only). */
  invulnerableUntil: number;
  /** The event's value: how many bullets were spawned / removed / cleared. */
  eventValue: number;
}

function emptyCardEffectResult(): CardEffectResult {
  return {
    bulletDeltas: [],
    targetUserId: '',
    hasTarget: false,
    invulnerableUntil: 0,
    eventValue: 0,
  };
}

/**
 * `OpponentTargetId` — C++ `card_effects.cpp:74-87`.
 *
 * The opponent is the **lowest** player id other than the caster; no opponent
 * means an empty string (and the effect produces nothing).
 */
export function opponentTargetId(playerIds: readonly string[], selfId: string): string {
  const candidates = playerIds.filter((id) => id !== selfId).sort();
  return candidates.length === 0 ? '' : candidates[0];
}

/**
 * `RoundTo` — C++ `card_effects.cpp:89-92` (Go's `round(value, precision)`).
 *
 * Half **away from zero**, which `Math.round` is not (it rounds -0.5 up to -0).
 */
export function roundTo(value: number, precision: number): number {
  const scale = Math.pow(10, precision);
  const rounded = Math.round(Math.abs(value) * scale) / scale;
  return value < 0 ? -rounded : rounded;
}

/**
 * `ApplyOpponentPattern` — C++ `card_effects.cpp:104-181`.
 *
 * Fires a fan of `count` bullets from the boss origin towards the opponent's
 * current position: the fan is centred on `atan2(target - origin)` and spans
 * `±spread/2` (evenly divided into `count` slots). The field cap
 * ({@link CARD_MAX_BULLETS}) stops the spawn, exactly like `addBulletLocked`.
 *
 * @param players the players' arena positions (milli)
 * @param originXMilli the boss origin in arena milli (defaults to the C++ constant)
 * @param originYMilli the boss origin in arena milli (defaults to the C++ constant)
 */
export function applyOpponentPattern(
  players: readonly CardPlayerSnapshot[],
  casterId: string,
  activation: CardActivation,
  tick: number,
  matchId: string,
  nextBulletSeq: number,
  existingBulletCount: number,
  originXMilli: number = CARD_BOSS_ORIGIN_X_MILLI,
  originYMilli: number = CARD_BOSS_ORIGIN_Y_MILLI,
): CardEffectResult {
  const result = emptyCardEffectResult();
  const targetId = opponentTargetId(
    players.map((player) => player.playerId),
    casterId,
  );
  if (targetId === '') {
    // No opponent: only a zero-valued event, no bullets, no target.
    return result;
  }
  const target = players.find((player) => player.playerId === targetId);
  if (target === undefined) {
    return result;
  }
  const patternId = activation.patternId === '' ? activation.cardId : activation.patternId;
  const geometry = cardPatternGeometryFor(patternId);
  const base = Math.atan2(target.yMilli - originYMilli, target.xMilli - originXMilli);
  const start = base - geometry.spread * 0.5;
  const step = geometry.count > 1 ? geometry.spread / (geometry.count - 1) : 0;

  let seq = nextBulletSeq;
  let fieldCount = existingBulletCount;
  for (let i = 0; i < geometry.count; i += 1) {
    if (fieldCount >= CARD_MAX_BULLETS) {
      break;
    }
    const angle = start + step * i;
    result.bulletDeltas.push({
      op: 'spawn',
      bulletId: `${matchId}_b${String(seq).padStart(6, '0')}`,
      patternId,
      kind: 'nway',
      tick,
      xMilli: originXMilli,
      yMilli: originYMilli,
      vxMilli: Math.round(Math.cos(angle) * geometry.speed * MILLI_PER_PIXEL),
      vyMilli: Math.round(Math.sin(angle) * geometry.speed * MILLI_PER_PIXEL),
      radiusMilli: Math.round(geometry.radius * MILLI_PER_PIXEL),
      damage: 1,
      color: geometry.color,
    });
    seq += 1;
    fieldCount += 1;
  }
  result.targetUserId = targetId;
  result.hasTarget = true;
  result.eventValue = result.bulletDeltas.length;
  return result;
}

/**
 * `ApplyBulletPurge` — C++ `card_effects.cpp:183-260`.
 *
 * Removes up to `purgeCount` bullets within `purgeRadius` of the caster. The
 * selection is the canonical one (see {@link selectPurgeTargets}): the index is
 * taken over the **whole** field ordered by bullet id, the in-radius bullets
 * are scored with the lobby's deterministic unit, and the smallest scores win.
 *
 * @param seedDecimal the lobby's server seed as decimal text — the **ticket's**
 *   `server_seed`, never the derived match seed (C++ `simulation.cpp:2494-2495`)
 */
export function applyBulletPurge(
  bullets: readonly CardBulletSnapshot[],
  caster: CardPlayerSnapshot,
  activation: CardActivation,
  seedDecimal: string,
  tick: number,
): CardEffectResult {
  const result = emptyCardEffectResult();
  const radius = activation.purgeRadius;
  const count = activation.purgeCount;
  if (radius > 0 && count > 0) {
    const candidates: PurgeCandidate[] = bullets.map((bullet) => ({
      bulletId: bullet.bulletId,
      xMilli: bullet.xMilli,
      yMilli: bullet.yMilli,
    }));
    const picked = selectPurgeTargets(
      candidates,
      caster.xMilli,
      caster.yMilli,
      purgeRadiusMilli(radius),
      count,
      seedDecimal,
      tick,
      activation.cardId,
    );
    for (const bulletId of picked) {
      const bullet = bullets.find((entry) => entry.bulletId === bulletId);
      if (bullet === undefined) {
        continue;
      }
      result.bulletDeltas.push({
        op: 'despawn',
        bulletId: bullet.bulletId,
        patternId: bullet.patternId,
        kind: bullet.kind,
        tick,
        xMilli: bullet.xMilli,
        yMilli: bullet.yMilli,
        vxMilli: bullet.vxMilli,
        vyMilli: bullet.vyMilli,
        radiusMilli: bullet.radiusMilli,
        damage: bullet.damage,
        color: bullet.color,
      });
    }
  }
  result.eventValue = result.bulletDeltas.length;
  return result;
}

/**
 * `ApplyInvulnerable` — C++ `card_effects.cpp:262-268`.
 *
 * The window is `tick + duration_ticks`, already computed by the caller; the
 * guard covers `[tick, expires_tick]` and lapses one tick later.
 */
export function applyInvulnerable(activation: CardActivation): CardEffectResult {
  const result = emptyCardEffectResult();
  result.invulnerableUntil = activation.expiresTick;
  result.eventValue = 0;
  return result;
}

/**
 * `ApplyFinisher` — C++ `card_effects.cpp:270-301`.
 *
 * Clears the whole field, one despawn per bullet in bullet-id order.
 */
export function applyFinisher(bullets: readonly CardBulletSnapshot[], tick: number): CardEffectResult {
  const result = emptyCardEffectResult();
  for (const bulletId of sortedBulletIds(bullets)) {
    const bullet = bullets.find((entry) => entry.bulletId === bulletId);
    if (bullet === undefined) {
      continue;
    }
    result.bulletDeltas.push({
      op: 'despawn',
      bulletId: bullet.bulletId,
      patternId: bullet.patternId,
      kind: bullet.kind,
      tick,
      xMilli: bullet.xMilli,
      yMilli: bullet.yMilli,
      vxMilli: bullet.vxMilli,
      vyMilli: bullet.vyMilli,
      radiusMilli: bullet.radiusMilli,
      damage: bullet.damage,
      color: bullet.color,
    });
  }
  result.eventValue = result.bulletDeltas.length;
  return result;
}

/**
 * `SortedBulletIds` — C++ `card_effects.cpp:64-72`: every bullet id in
 * byte-wise (UTF-8) order, which is the canonical order the purge selection
 * indexes into.
 */
export function sortedBulletIds(bullets: readonly CardBulletSnapshot[]): string[] {
  return bullets.map((bullet) => bullet.bulletId).sort(compareIds);
}
