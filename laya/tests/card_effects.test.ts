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
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

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
  const picked = selectPurgeTargets(bullets, 0, 0, 120000, 2, 7, 100, 'bullet_purge');
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
  const first = selectPurgeTargets(bullets, 0, 0, 120000, 4, 42, 900, 'bullet_purge');
  const second = selectPurgeTargets(bullets, 0, 0, 120000, 4, 42, 900, 'bullet_purge');
  expectDeepEqual(first, second, 'same seed/tick/stream must pick the same bullets');
  expectEqual(first.length, 4);
  const other = selectPurgeTargets(bullets, 0, 0, 120000, 4, 42, 901, 'bullet_purge');
  expect(JSON.stringify(first) !== JSON.stringify(other), 'a different tick changes the draw');
});

test('a count above the eligible population returns every eligible bullet', () => {
  const bullets: PurgeCandidate[] = [
    { bulletId: 'a', xMilli: 0, yMilli: 0 },
    { bulletId: 'b', xMilli: 50000, yMilli: 0 },
    { bulletId: 'c', xMilli: 500000, yMilli: 0 },
  ];
  const picked = selectPurgeTargets(bullets, 0, 0, 120000, 99, 1, 1, 'bullet_purge');
  expectDeepEqual(picked.slice().sort(), ['a', 'b']);
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
