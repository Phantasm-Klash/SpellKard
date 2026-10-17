/**
 * Card-effect mirror of the lobby's authoritative card catalogue.
 *
 * The Go lobby (`Gensoulkyo/runtime/core`) is the single source of truth for the
 * card set and its effects; the C++ battle server does not implement card
 * effects at all (it only forwards `deck_card_ids`). This module is the client
 * side of that contract: the effect-kind vocabulary plus the static definition
 * of the four new cards, so the battle view and the inventory screen can talk
 * about a card without guessing at server-only constants.
 *
 * ★ 字段名 / 取值必须与 `card_records_spec.md` §1.1–§1.3 一致：服务端在并行
 * 实现同一份契约，改这里的 `cardId` / `effectKind` / 数值就等于改 wire 契约。
 *
 * The helpers below are deliberately pure (no LayaAir, no DOM) so they are
 * unit-testable and reusable by any renderer.
 */

import { lobbyDeterministicUnit } from '../math/lobby_rng';
import { MILLI_PER_PIXEL } from '../math/float_lib';

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
}

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
  const tables = [NEW_CARD_EFFECTS, EXPANSION_CARD_EFFECTS] as Readonly<Record<string, CardEffectDefinition>>[];
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
      return `Immune to damage for ${(definition.durationTicks / 60).toFixed(1)}s`;
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
