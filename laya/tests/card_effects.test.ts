/**
 * Card-effect mirror coverage: the four new `EffectKind` cards' static values
 * (from `card_records_spec.md` §1.2), the targeting helpers, the deterministic
 * `bullet_purge` selection and the `opponent_pattern` aim line.
 *
 * These pin the client half of the shared contract; if the spec's numbers move,
 * this file breaks before the battle view renders something wrong.
 */

import {
  CARD_EFFECT_KINDS,
  NEW_CARD_EFFECTS,
  NEW_CARD_IDS,
  cardEffectDefinition,
  describeCardEffect,
  effectTarget,
  invulnerableRemainingTicks,
  isCardEffectKind,
  isGlobalEffect,
  isNewCard,
  isOpponentTargeted,
  isSelfTargeted,
  opponentPatternWarning,
  purgeRadiusMilli,
  purgeSpecFor,
  rarityLabel,
  selectPurgeTargets,
  type PurgeCandidate,
} from '../src/core/sim/card_effects';
import { lobbyDeterministicUnit } from '../src/core/math/lobby_rng';
import { expect, expectClose, expectDeepEqual, expectEqual, suite, test } from './harness';

/** Byte-wise id order, matching the server's `sort.Strings`. */
function byId(left: { bulletId: string }, right: { bulletId: string }): number {
  return left.bulletId < right.bulletId ? -1 : left.bulletId > right.bulletId ? 1 : 0;
}

/**
 * Reference for the canonical purge pick: score every bullet by its index in the
 * `bulletId`-sorted order, keep the in-radius ones, take the `count` smallest
 * units.
 *
 * Scope, stated honestly: this is independent of the implementation in the
 * **index basis** (it re-derives the canonical order and re-applies the filter)
 * but it deliberately calls the same `lobbyDeterministicUnit`. It therefore
 * catches index/ordering/filter regressions, not RNG regressions. RNG
 * independence is covered separately by the Go-pinned picks below.
 */
function referencePurge(
  bullets: readonly PurgeCandidate[],
  radiusMilli: number,
  count: number,
  seedDecimal: string,
  tick: number,
): string[] {
  const radiusSq = radiusMilli * radiusMilli;
  const scored = bullets
    .slice()
    .sort(byId)
    .map((bullet, index) => ({
      bulletId: bullet.bulletId,
      unit: lobbyDeterministicUnit(seedDecimal, tick, 'purge_bell', index),
      dx: bullet.xMilli,
      dy: bullet.yMilli,
    }));
  return scored
    .filter((entry) => entry.dx * entry.dx + entry.dy * entry.dy <= radiusSq)
    .sort((left, right) => (left.unit !== right.unit ? left.unit - right.unit : left.bulletId < right.bulletId ? -1 : 1))
    .slice(0, count)
    .map((entry) => entry.bulletId);
}

suite('card effects: effect-kind vocabulary');

test('the vocabulary keeps the legacy kinds and adds the four new ones', () => {
  for (const kind of ['self', 'pattern', 'economy', 'finisher']) {
    expect(isCardEffectKind(kind), `legacy kind '${kind}' must stay known`);
  }
  for (const kind of ['opponent_pattern', 'bullet_purge', 'invulnerable']) {
    expect(isCardEffectKind(kind), `new kind '${kind}' must be known`);
  }
  expectEqual(CARD_EFFECT_KINDS.length, 7);
  expect(!isCardEffectKind('made_up'), 'an unknown kind must be rejected');
});

test('targeting helpers classify each kind', () => {
  expect(isOpponentTargeted('opponent_pattern'), 'opponent_pattern targets the opponent');
  expect(!isOpponentTargeted('bullet_purge'), 'bullet_purge is not opponent-targeted');
  expect(isSelfTargeted('bullet_purge') && isSelfTargeted('invulnerable') && isSelfTargeted('self'), 'self kinds');
  expect(isGlobalEffect('finisher') && isGlobalEffect('pattern'), 'global kinds');
  expectEqual(effectTarget('opponent_pattern'), 'opponent');
  expectEqual(effectTarget('finisher'), 'global');
  expectEqual(effectTarget('invulnerable'), 'self');
});

suite('card effects: static definitions');

test('the four new cards match the contract values exactly', () => {
  expectDeepEqual(NEW_CARD_IDS, ['mirror_lance', 'purge_bell', 'aegis_ward', 'finale_arc']);
  expectDeepEqual(NEW_CARD_EFFECTS.mirror_lance, {
    cardId: 'mirror_lance',
    effectKind: 'opponent_pattern',
    cost: 4,
    cooldownTicks: 540,
    durationTicks: 360,
    damage: 26,
    scoreBonus: 30,
    rarity: 'rare',
  });
  expectDeepEqual(NEW_CARD_EFFECTS.purge_bell, {
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
  });
  expectDeepEqual(NEW_CARD_EFFECTS.aegis_ward, {
    cardId: 'aegis_ward',
    effectKind: 'invulnerable',
    cost: 5,
    cooldownTicks: 720,
    durationTicks: 180,
    damage: 0,
    scoreBonus: 20,
    rarity: 'rare',
  });
  expectDeepEqual(NEW_CARD_EFFECTS.finale_arc, {
    cardId: 'finale_arc',
    effectKind: 'finisher',
    cost: 6,
    cooldownTicks: 900,
    durationTicks: 1,
    damage: 60,
    scoreBonus: 80,
    rarity: 'epic',
  });
});

test('lookups and purge specs are keyed by card id', () => {
  expectEqual(isNewCard('mirror_lance'), true);
  expectEqual(isNewCard('ring_of_fire'), false);
  expectEqual(cardEffectDefinition('aegis_ward')?.effectKind, 'invulnerable');
  expectEqual(cardEffectDefinition('unknown'), null);
  expectDeepEqual(purgeSpecFor('purge_bell'), { radius: 120, count: 24 });
  expectEqual(purgeSpecFor('mirror_lance'), null, 'a non-purge card has no purge spec');
  expectEqual(purgeSpecFor('unknown'), null);
});

test('rarity and effect descriptions are player-facing strings', () => {
  expectEqual(rarityLabel('epic'), 'Epic');
  expectEqual(rarityLabel('uncommon'), 'Uncommon');
  expectEqual(describeCardEffect('purge_bell'), 'Clears 24 bullets within 120px');
  expectEqual(describeCardEffect('aegis_ward'), 'Immune to damage for 3.0s');
  expectEqual(describeCardEffect('unknown'), '');
  expect(purgeRadiusMilli(120) === 120000, 'purge radius converts px → milli');
});

suite('card effects: purge selection');

test('only in-radius bullets are eligible and the count caps the result', () => {
  const bullets: PurgeCandidate[] = [
    { bulletId: 'near-1', xMilli: 1000, yMilli: 0 },
    { bulletId: 'near-2', xMilli: 0, yMilli: 2000 },
    { bulletId: 'near-3', xMilli: -3000, yMilli: -1000 },
    { bulletId: 'far', xMilli: 999999, yMilli: 0 },
  ];
  const picked = selectPurgeTargets(bullets, 0, 0, 120000, 2, '7', 100, 'purge_bell');
  expectEqual(picked.length, 2, 'count caps the selection');
  expect(!picked.includes('far'), 'a bullet outside the radius is never picked');
  for (const id of picked) {
    expect(id.startsWith('near-'), `picked '${id}' must be in radius`);
  }
});

test('the selection is deterministic and stable across calls', () => {
  const bullets: PurgeCandidate[] = Array.from({ length: 10 }, (_, index) => ({
    bulletId: `b-${index}`,
    xMilli: index * 1000,
    yMilli: 0,
  }));
  const first = selectPurgeTargets(bullets, 0, 0, 120000, 4, '42', 900, 'purge_bell');
  const second = selectPurgeTargets(bullets, 0, 0, 120000, 4, '42', 900, 'purge_bell');
  expectDeepEqual(first, second, 'same seed/tick/stream must pick the same bullets');
  expectEqual(first.length, 4);
  const other = selectPurgeTargets(bullets, 0, 0, 120000, 4, '42', 901, 'purge_bell');
  expect(JSON.stringify(first) !== JSON.stringify(other), 'a different tick changes the draw');
});

test('a count above the eligible population returns every eligible bullet', () => {
  const bullets: PurgeCandidate[] = [
    { bulletId: 'a', xMilli: 0, yMilli: 0 },
    { bulletId: 'b', xMilli: 50000, yMilli: 0 },
    { bulletId: 'c', xMilli: 500000, yMilli: 0 },
  ];
  const picked = selectPurgeTargets(bullets, 0, 0, 120000, 99, '1', 1, 'purge_bell');
  expectDeepEqual(picked.slice().sort(), ['a', 'b']);
});

test('the index basis is the bulletId-sorted canonical order, not the input order', () => {
  const bullets: PurgeCandidate[] = [
    { bulletId: 'c', xMilli: 1000, yMilli: 0 },
    { bulletId: 'a', xMilli: 2000, yMilli: 0 },
    { bulletId: 'd', xMilli: 3000, yMilli: 0 },
    { bulletId: 'b', xMilli: 4000, yMilli: 0 },
  ];
  const scrambled = selectPurgeTargets(bullets, 0, 0, 120000, 2, '11', 500, 'purge_bell');
  const preSorted = selectPurgeTargets(
    bullets.slice().sort(byId),
    0,
    0,
    120000,
    2,
    '11',
    500,
    'purge_bell',
  );
  expectDeepEqual(scrambled, preSorted, 'input order must not change the pick');
  expectDeepEqual(
    scrambled,
    referencePurge(bullets, 120000, 2, '11', 500),
    'the pick must match a recompute over the same canonical-index basis and RNG',
  );
  expectEqual(scrambled.length, 2);
});

test('the deterministic stream is the card id, not the effect kind', () => {
  const bullets: PurgeCandidate[] = Array.from({ length: 8 }, (_, index) => ({
    bulletId: `b-${index}`,
    xMilli: index * 1000,
    yMilli: 0,
  }));
  const byCardId = selectPurgeTargets(bullets, 0, 0, 120000, 3, '5', 700, 'purge_bell');
  const byKind = selectPurgeTargets(bullets, 0, 0, 120000, 3, '5', 700, 'bullet_purge');
  expectDeepEqual(byCardId, referencePurge(bullets, 120000, 3, '5', 700), 'card-id stream is authoritative');
  expect(
    JSON.stringify(byCardId) !== JSON.stringify(byKind),
    'scoring with the effect kind instead of the card id would change the pick',
  );
});

test('the full purge pick matches the Go lobby output end to end', () => {
  // `/root/gotouhou/tmp/purge_picks_ref.go` scored these exact fields with the
  // lobby's own `shortHash` / `deterministicUnit` and printed the picks pinned
  // below. Hard-coding the literals — instead of recomputing with the client's
  // own RNG — is what makes this an independent check of the RNG and not just
  // of the index basis.
  const f1: PurgeCandidate[] = [
    { bulletId: 'b-3', xMilli: 10000, yMilli: 0 },
    { bulletId: 'b-1', xMilli: 20000, yMilli: 0 },
    { bulletId: 'b-7', xMilli: -30000, yMilli: 0 },
    { bulletId: 'b-2', xMilli: 50000, yMilli: 50000 },
    { bulletId: 'b-5', xMilli: 200000, yMilli: 200000 },
    { bulletId: 'b-0', xMilli: 0, yMilli: 0 },
    { bulletId: 'b-4', xMilli: -10000, yMilli: 5000 },
    { bulletId: 'b-6', xMilli: 130000, yMilli: 0 },
  ];
  // `f2` keeps ids where byte order and numeric order disagree (`b-10` < `b-2`),
  // so a `localeCompare`-style sort would pick a different set.
  const f2: PurgeCandidate[] = [
    { bulletId: 'b-10', xMilli: 5000, yMilli: 0 },
    { bulletId: 'b-2', xMilli: 40000, yMilli: 0 },
    { bulletId: 'b-1', xMilli: 90000, yMilli: 0 },
    { bulletId: 'b-0', xMilli: -60000, yMilli: 0 },
    { bulletId: 'b-20', xMilli: 15000, yMilli: 15000 },
    { bulletId: 'b-3', xMilli: -20000, yMilli: 0 },
    { bulletId: 'b-11', xMilli: 100000, yMilli: 0 },
    { bulletId: 'b-4', xMilli: 0, yMilli: 30000 },
  ];

  // S1: the whole in-radius field, ordered by the lowest units.
  expectDeepEqual(selectPurgeTargets(f1, 0, 0, 120000, 24, '123456789', 900, 'purge_bell'), [
    'b-0',
    'b-2',
    'b-3',
    'b-4',
    'b-7',
    'b-1',
  ]);
  // S2: same field at tick 0, three slots — a different draw, not a prefix.
  expectDeepEqual(selectPurgeTargets(f1, 0, 0, 120000, 3, '123456789', 0, 'purge_bell'), [
    'b-4',
    'b-2',
    'b-0',
  ]);
  // S3: a seed above 2^53 must survive the decimal-string trip intact.
  expectDeepEqual(
    selectPurgeTargets(f1, 0, 0, 120000, 4, '9007199254740993', 100, 'purge_bell'),
    ['b-3', 'b-0', 'b-2', 'b-7'],
  );
  // S4/S5: byte-wise id order over `f2`.
  expectDeepEqual(selectPurgeTargets(f2, 0, 0, 120000, 5, '123456789', 900, 'purge_bell'), [
    'b-0',
    'b-3',
    'b-10',
    'b-11',
    'b-2',
  ]);
  expectDeepEqual(selectPurgeTargets(f2, 0, 0, 120000, 3, '42', 7, 'purge_bell'), [
    'b-1',
    'b-3',
    'b-20',
  ]);

  // The units themselves (Go printed 0.1112, 0.2308, 0.6279 … for indices 0,2,3).
  expectClose(lobbyDeterministicUnit('123456789', 900, 'purge_bell', 0), 0.1112, 1e-9);
  expectClose(lobbyDeterministicUnit('123456789', 900, 'purge_bell', 2), 0.2308, 1e-9);
});

suite('card effects: opponent aim + invulnerability window');

test('the aimed curtain points at the opponent via atan2', () => {
  const warning = opponentPatternWarning(0, -60000, 30000, 0, 'mirror_lance');
  expectEqual(warning.patternId, 'mirror_lance');
  expect(warning.angleRad > 0, 'a target down-right aims into the first quadrant');
  const straightUp = opponentPatternWarning(0, 0, 0, -100, 'mirror_lance');
  expectEqual(straightUp.angleRad, -Math.PI / 2, 'straight up is -π/2');
});

test('the invulnerability window counts down and floors at zero', () => {
  expectEqual(invulnerableRemainingTicks(180, 60), 120);
  expectEqual(invulnerableRemainingTicks(180, 180), 0);
  expectEqual(invulnerableRemainingTicks(180, 400), 0);
});
