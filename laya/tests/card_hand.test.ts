/**
 * Card / bomb / focus rules — the client port of the battle server's
 * `phk/battle/card_hand.hpp`, `phk/battle/card_effects.hpp` and the input
 * semantics of `boss_race.cpp` / `simulation.cpp`.
 *
 * Every expectation below is transcribed from the C++ server:
 *
 *  - the catalog: `card_hand.cpp:22-43` (`kCatalog`);
 *  - the validation order: `card_hand.cpp:66-111` (`ValidateCast`);
 *  - the draw rule: `card_hand.cpp:113-124` (`DrawServerCard`);
 *  - the ledger: `card_hand.cpp:126-138` (`ApplyCast`);
 *  - the effect geometry: `card_effects.cpp:94-181`;
 *  - the cast pipeline: `simulation.cpp:2395-2447` / `:2467-2534`;
 *  - the bomb damage rule: `boss_race.cpp:395-414`;
 *  - the focus speed rule: `simulation.cpp:2181`.
 */

import {
  CARD_DECK_LIMIT,
  CARD_ENERGY_PER_TICK,
  CARD_HAND_LIMIT,
  CARD_MAX_ENERGY,
  accrueCardEnergy,
  applyCast,
  buildCardActivation,
  createHandState,
  findCardDefinition,
  trimCardId,
  validateCast,
  type CardDefinition,
  type HandState,
} from '../src/core/sim/card_hand';
import {
  CARD_MAX_BULLETS,
  CARD_OPPONENT_PATTERN_COLOR,
  CARD_OPPONENT_PATTERN_COUNT,
  CARD_OPPONENT_PATTERN_RADIUS,
  CARD_OPPONENT_PATTERN_SPREAD,
  CARD_OPPONENT_PATTERN_SPEED,
  applyBulletPurge,
  applyFinisher,
  applyInvulnerable,
  applyOpponentPattern,
  cardEffectDefinition,
  cardPatternGeometryFor,
  opponentTargetId,
  purgeRadiusMilli,
  roundTo,
  selectPurgeTargets,
  sortedBulletIds,
  type CardBulletSnapshot,
} from '../src/core/sim/card_effects';
import {
  BOSS_RACE_DAMAGE_PER_SHOT_TICK,
  BossRaceSimulation,
  bossRaceTickDamage,
  defaultBossRaceConfig,
  FOCUS_MOVE_SPEED_MILLI,
  focusMoveSpeed,
  MOVE_MILLI_PER_TICK,
  NORMAL_MOVE_SPEED_MILLI,
} from '../src/core/sim/boss_race';
import { expect, expectClose, expectDeepEqual, expectEqual, suite, test } from './harness';

/**
 * The C++ catalog, transcribed from `card_hand.cpp:22-43`.
 *
 * `card_id / effect_kind / cost / cooldown / duration / damage / score_bonus /
 * energy_gain / draw_cards / pattern_id / purge_radius / purge_count`.
 */
const CPP_CATALOG: ReadonlyArray<
  [string, string, number, number, number, number, number, number, number, string, number, number]
> = [
  ['focus_lens', 'self', 2, 240, 360, 12, 18, 0, 0, '', 0, 0],
  ['hitbox_charm', 'self', 3, 420, 300, 14, 20, 0, 0, '', 0, 0],
  ['density_surge', 'pattern', 4, 540, 420, 30, 32, 0, 0, '', 0, 0],
  ['tempo_break', 'pattern', 3, 480, 300, 22, 26, 0, 0, '', 0, 0],
  ['bomb_amplifier', 'self', 2, 360, 480, 16, 18, 0, 0, '', 0, 0],
  ['guard_seal', 'self', 5, 720, 900, 18, 30, 0, 0, '', 0, 0],
  ['graze_engine', 'economy', 2, 300, 360, 10, 20, 0, 0, '', 0, 0],
  ['draw_sigil', 'economy', 1, 420, 1, 0, 12, 0.75, 1, '', 0, 0],
  ['aim_baffle', 'pattern', 4, 600, 360, 28, 32, 0, 0, '', 0, 0],
  ['purge_charm', 'self', 3, 540, 480, 18, 24, 0, 0, '', 0, 0],
  ['curve_prism', 'pattern', 3, 500, 360, 24, 28, 0, 0, '', 0, 0],
  ['last_arc', 'finisher', 6, 900, 420, 48, 60, 0, 0, '', 0, 0],
  ['mirror_lance', 'opponent_pattern', 4, 540, 360, 26, 30, 0, 0, 'mirror_lance', 0, 0],
  ['purge_bell', 'bullet_purge', 3, 480, 1, 0, 22, 0, 0, '', 120, 24],
  ['aegis_ward', 'invulnerable', 5, 720, 180, 0, 20, 0, 0, '', 0, 0],
  ['finale_arc', 'finisher', 6, 900, 1, 60, 80, 0, 0, '', 0, 0],
  ['frost_arc', 'bullet_purge', 2, 360, 1, 0, 18, 0, 0, '', 100, 12],
  ['ember_lance', 'opponent_pattern', 3, 300, 240, 20, 24, 0, 0, 'ember_lance', 0, 0],
  ['iron_veil', 'invulnerable', 4, 480, 120, 0, 16, 0, 0, '', 0, 0],
  ['thunder_fall', 'finisher', 4, 420, 1, 30, 40, 0, 0, '', 0, 0],
];

function makeHand(cardIds: string[], energy = 10, deck: string[] = []): HandState {
  const hand = createHandState();
  hand.cardIds = cardIds.slice();
  hand.energy = energy;
  hand.deck = deck.slice();
  hand.drawCursor = deck.length === 0 ? 0 : cardIds.length;
  return hand;
}

suite('card hand: the -1 sentinel');

test('slot -1 is "no card this tick", not a rejection', () => {
  const hand = makeHand(['mirror_lens', 'focus_lens'], 10);
  const result = validateCast(hand, -1, 100);
  expectEqual(result.accepted, true, 'the sentinel is accepted');
  expectEqual(result.playsNoCard, true, 'the sentinel plays no card');
  expectEqual(result.reason, '', 'the sentinel carries no rejection code');
  expectEqual(result.definition, null, 'the sentinel has no definition');
  expectEqual(result.energyAfter, 10, 'the sentinel does not touch the energy');
});

test('slot -1 leaves the whole hand untouched', () => {
  const hand = makeHand(['mirror_lens', 'focus_lens'], 10, ['aegis_ward']);
  const before = JSON.stringify({
    cardIds: hand.cardIds,
    energy: hand.energy,
    cursor: hand.drawCursor,
    cooldowns: [...hand.cooldowns.entries()],
  });
  const result = applyCast(hand, -1, 100);
  expectEqual(result.playsNoCard, true, 'the sentinel plays no card');
  expectDeepEqual(
    {
      cardIds: hand.cardIds,
      energy: hand.energy,
      cursor: hand.drawCursor,
      cooldowns: [...hand.cooldowns.entries()],
    },
    JSON.parse(before),
    'the hand state changed',
  );
});

suite('card hand: the catalog');

test('all twenty cards match the server catalog field for field', () => {
  expectEqual(CPP_CATALOG.length, 20, 'the server catalog has 20 cards');
  for (const row of CPP_CATALOG) {
    const definition = findCardDefinition(row[0]);
    expect(definition !== null, `${row[0]} must be in the catalog`);
    if (definition === null) {
      continue;
    }
    expectEqual(definition.effectKind, row[1], `${row[0]} effect kind differs`);
    expectEqual(definition.cost, row[2], `${row[0]} cost differs`);
    expectEqual(definition.cooldownTicks, row[3], `${row[0]} cooldown differs`);
    expectEqual(definition.durationTicks, row[4], `${row[0]} duration differs`);
    expectEqual(definition.damage, row[5], `${row[0]} damage differs`);
    expectEqual(definition.scoreBonus, row[6], `${row[0]} score bonus differs`);
    expectEqual(definition.energyGain, row[7], `${row[0]} energy gain differs`);
    expectEqual(definition.drawCards, row[8], `${row[0]} draw cards differs`);
    expectEqual(definition.patternId, row[9], `${row[0]} pattern id differs`);
    expectEqual(definition.purgeRadius, row[10], `${row[0]} purge radius differs`);
    expectEqual(definition.purgeCount, row[11], `${row[0]} purge count differs`);
  }
});

test('an unknown card id has no definition', () => {
  expectEqual(findCardDefinition('no_such_card'), null, 'unknown cards must not resolve');
  expectEqual(cardEffectDefinition('no_such_card'), null, 'the effect table agrees');
});

test('the hand / deck / energy limits are the server constants', () => {
  expectEqual(CARD_HAND_LIMIT, 4, 'hand limit differs');
  expectEqual(CARD_DECK_LIMIT, 20, 'deck limit differs');
  expectEqual(CARD_MAX_ENERGY, 10, 'energy cap differs');
  expectEqual(CARD_ENERGY_PER_TICK, 0.0025, 'energy regen differs');
});

suite('card hand: cast validation');

test('a slot beyond the hand is out of range', () => {
  const hand = makeHand(['mirror_lens', 'focus_lens'], 10);
  const result = validateCast(hand, 2, 0);
  expectEqual(result.accepted, false, 'the cast must be refused');
  expectEqual(result.reason, 'cast_card_slot_out_of_range', 'the reason differs');
  expectEqual(result.playsNoCard, false, 'a rejection is not the sentinel');
});

test('a negative slot other than -1 is out of range', () => {
  const hand = makeHand(['mirror_lens'], 10);
  const result = validateCast(hand, -2, 0);
  expectEqual(result.accepted, false, 'the cast must be refused');
  expectEqual(result.reason, 'cast_card_slot_out_of_range', 'the reason differs');
});

test('an unknown card id is refused', () => {
  const hand = makeHand(['no_such_card'], 10);
  const result = validateCast(hand, 0, 0);
  expectEqual(result.accepted, false, 'the cast must be refused');
  expectEqual(result.reason, 'cast_card_unknown_card', 'the reason differs');
});

test('a card on cooldown is refused', () => {
  const hand = makeHand(['focus_lens'], 10);
  hand.cooldowns.set('focus_lens', 500);
  const result = validateCast(hand, 0, 100);
  expectEqual(result.accepted, false, 'the cast must be refused');
  expectEqual(result.reason, 'cast_card_on_cooldown', 'the reason differs');
});

test('the cooldown boundary tick is castable again', () => {
  const hand = makeHand(['focus_lens'], 10);
  hand.cooldowns.set('focus_lens', 500);
  const result = validateCast(hand, 0, 500);
  expectEqual(result.accepted, true, 'the cooldown expires at its tick');
  expectEqual(result.reason, '', 'no rejection code');
});

test('an unaffordable card is refused', () => {
  const hand = makeHand(['guard_seal'], 1);
  const result = validateCast(hand, 0, 0);
  expectEqual(result.accepted, false, 'the cast must be refused');
  expectEqual(result.reason, 'cast_card_insufficient_energy', 'the reason differs');
});

test('the server energy epsilon lets a cast through at the boundary', () => {
  // guard_seal costs 5; the ledger's epsilon is 0.0001 (card_hand.cpp:100).
  const hand = makeHand(['guard_seal'], 5 - 0.00005);
  const result = validateCast(hand, 0, 0);
  expectEqual(result.accepted, true, 'the epsilon covers the rounding dust');
});

test('the validation order is slot, card, cooldown, energy', () => {
  // An unknown card that is also on cooldown and unaffordable must report the
  // *card* error: the C++ checks the slot, then the card, then the cooldown,
  // then the energy (card_hand.cpp:85-103).
  const hand = makeHand(['no_such_card'], 0);
  hand.cooldowns.set('no_such_card', 500);
  expectEqual(validateCast(hand, 0, 0).reason, 'cast_card_unknown_card', 'card error wins');

  const known = makeHand(['guard_seal'], 0);
  known.cooldowns.set('guard_seal', 500);
  expectEqual(validateCast(known, 0, 0).reason, 'cast_card_on_cooldown', 'cooldown wins over energy');

  const outOfRange = makeHand(['no_such_card'], 0);
  expectEqual(validateCast(outOfRange, 9, 0).reason, 'cast_card_slot_out_of_range', 'slot wins');
});

suite('card hand: applying a cast');

test('a legal cast charges the energy, writes the cooldown and drops the slot', () => {
  const hand = makeHand(['focus_lens', 'aegis_ward'], 10);
  const result = applyCast(hand, 0, 100);
  expectEqual(result.accepted, true, 'the cast is accepted');
  expectEqual(result.cardId, 'focus_lens', 'the card id differs');
  expectEqual(result.removedSlot, 0, 'the removed slot differs');
  expectEqual(hand.energy, 8, 'focus_lens costs 2');
  expectEqual(hand.cooldowns.get('focus_lens'), 340, 'the cooldown is tick + 240');
  expectDeepEqual(hand.cardIds, ['aegis_ward'], 'the played slot is gone');
});

test('a cast draws one replacement card from the deck', () => {
  // The hand is the deck's prefix and the cursor continues past it
  // (C++ `simulation.cpp:2276-2277`), so the next card is deck[1].
  const hand = makeHand(['focus_lens'], 10, ['focus_lens', 'aegis_ward']);
  applyCast(hand, 0, 0);
  expectDeepEqual(hand.cardIds, ['aegis_ward'], 'the replacement is drawn');
  expectEqual(hand.drawCursor, 2, 'the cursor advanced');
});

test('an empty deck leaves the hand short', () => {
  const hand = makeHand(['focus_lens', 'aegis_ward', 'guard_seal', 'last_arc'], 10, []);
  applyCast(hand, 0, 0);
  expectEqual(hand.cardIds.length, 3, 'the hand shrinks but is not refilled');
});

test('a blank card id is consumed by the cursor but never enters the hand', () => {
  const hand = makeHand(['focus_lens'], 10, ['', 'aegis_ward']);
  hand.drawCursor = 0;
  applyCast(hand, 0, 0);
  expectDeepEqual(hand.cardIds, [], 'the blank card is not added');
  expectEqual(hand.drawCursor, 1, 'the cursor still advanced');
});

test('a rejected cast changes nothing', () => {
  const hand = makeHand(['guard_seal'], 0);
  const result = applyCast(hand, 0, 0);
  expectEqual(result.accepted, false, 'the cast is refused');
  expectEqual(hand.energy, 0, 'the energy is untouched');
  expectDeepEqual(hand.cardIds, ['guard_seal'], 'the hand is untouched');
  expectEqual(hand.cooldowns.size, 0, 'no cooldown was written');
});

test('the per-tick energy regen is capped at the maximum', () => {
  const hand = makeHand([], CARD_MAX_ENERGY);
  accrueCardEnergy(hand);
  expectEqual(hand.energy, CARD_MAX_ENERGY, 'the cap holds');
  const poor = makeHand([], 0);
  accrueCardEnergy(poor);
  expectEqual(poor.energy, CARD_ENERGY_PER_TICK, 'one tick of regen');
});

test('the card id is trimmed like the server trims it', () => {
  const hand = makeHand(['  focus_lens\t'], 10);
  const result = validateCast(hand, 0, 0);
  expectEqual(result.accepted, true, 'a padded id still resolves');
  expectEqual(result.cardId, 'focus_lens', 'the id is trimmed');
  expectEqual(trimCardId('\n\r\v\f a \t'), 'a', 'the ASCII whitespace set is trimmed');
});

suite('card effects: the opponent-pattern fan');

test('mirror_lance fires a seven-shot fan at the lowest other player id', () => {
  const activation = buildCardActivation(findCardDefinition('mirror_lance') as CardDefinition, 42);
  const effect = applyOpponentPattern(
    [
      { playerId: 'p1', xMilli: 0, yMilli: 0 },
      { playerId: 'p2', xMilli: 10000, yMilli: 0 },
      { playerId: 'p3', xMilli: 20000, yMilli: 0 },
    ],
    'p1',
    activation,
    42,
    'match-card-001',
    1,
    0,
  );
  expectEqual(effect.hasTarget, true, 'a target was found');
  expectEqual(effect.targetUserId, 'p2', 'the lowest other id is the target');
  expectEqual(effect.eventValue, CARD_OPPONENT_PATTERN_COUNT, 'seven shots');
  expectEqual(effect.bulletDeltas.length, 7, 'seven deltas');
  expectEqual(effect.bulletDeltas[0].op, 'spawn', 'the deltas are spawns');
  expectEqual(effect.bulletDeltas[0].bulletId, 'match-card-001_b000001', 'the bullet id differs');
  expectEqual(effect.bulletDeltas[0].patternId, 'mirror_lance', 'the pattern id differs');
  expectEqual(effect.bulletDeltas[0].kind, 'nway', 'the bullet kind differs');
  expectEqual(effect.bulletDeltas[0].color, CARD_OPPONENT_PATTERN_COLOR, 'the colour differs');
  expectEqual(effect.bulletDeltas[0].radiusMilli, 4500, 'the radius is 4.5 px');
  // The fan is centred on the aim line (atan2) and spans ±spread/2.
  const start = -CARD_OPPONENT_PATTERN_SPREAD / 2;
  const step = CARD_OPPONENT_PATTERN_SPREAD / (CARD_OPPONENT_PATTERN_COUNT - 1);
  const first = -CARD_OPPONENT_PATTERN_SPREAD / 2;
  const last = start + step * (CARD_OPPONENT_PATTERN_COUNT - 1);
  expectClose(
    effect.bulletDeltas[0].vxMilli,
    Math.round(Math.cos(first) * CARD_OPPONENT_PATTERN_SPEED * 1000),
    1,
    'the first shot aims at the fan start',
  );
  expectClose(
    effect.bulletDeltas[6].vyMilli,
    Math.round(Math.sin(last) * CARD_OPPONENT_PATTERN_SPEED * 1000),
    1,
    'the last shot aims at the fan end',
  );
});

test('ember_lance brings its own fan geometry', () => {
  const geometry = cardPatternGeometryFor('ember_lance');
  expectEqual(geometry.count, 5, 'ember_lance fires five shots');
  expectEqual(geometry.speed, 6.5, 'ember_lance speed differs');
  expectEqual(geometry.radius, 4.0, 'ember_lance radius differs');
  expectEqual(geometry.color, 'amber', 'ember_lance colour differs');
  const fallback = cardPatternGeometryFor('mirror_lance');
  expectEqual(fallback.count, CARD_OPPONENT_PATTERN_COUNT, 'mirror_lance keeps the default fan');
  expectEqual(fallback.speed, CARD_OPPONENT_PATTERN_SPEED, 'mirror_lance keeps the default speed');
  expectEqual(fallback.radius, CARD_OPPONENT_PATTERN_RADIUS, 'mirror_lance keeps the default radius');
  expectEqual(fallback.spread, CARD_OPPONENT_PATTERN_SPREAD, 'the spread is unchanged');
});

test('without an opponent the fan produces nothing', () => {
  const activation = buildCardActivation(findCardDefinition('mirror_lance') as CardDefinition, 0);
  const effect = applyOpponentPattern([{ playerId: 'p1', xMilli: 0, yMilli: 0 }], 'p1', activation, 0, 'm', 1, 0);
  expectEqual(effect.hasTarget, false, 'there is no target');
  expectEqual(effect.bulletDeltas.length, 0, 'no bullets');
  expectEqual(effect.eventValue, 0, 'the event value is zero');
  expectEqual(opponentTargetId(['p1'], 'p1'), '', 'no opponent id');
});

test('the field cap stops the fan', () => {
  const activation = buildCardActivation(findCardDefinition('mirror_lance') as CardDefinition, 0);
  const effect = applyOpponentPattern(
    [
      { playerId: 'p1', xMilli: 0, yMilli: 0 },
      { playerId: 'p2', xMilli: 10000, yMilli: 0 },
    ],
    'p1',
    activation,
    0,
    'm',
    1,
    CARD_MAX_BULLETS,
  );
  expectEqual(effect.bulletDeltas.length, 0, 'a full field spawns nothing');
});

suite('card effects: purge, invulnerability and finisher');

function bullet(id: string, xMilli: number, yMilli: number): CardBulletSnapshot {
  return {
    bulletId: id,
    patternId: 'ring',
    kind: 'nway',
    spawnTick: 0,
    xMilli,
    yMilli,
    vxMilli: 0,
    vyMilli: 0,
    radiusMilli: 4000,
    damage: 1,
    color: 'red',
  };
}

test('the purge removes the in-radius bullets by the canonical selection', () => {
  const activation = buildCardActivation(findCardDefinition('purge_bell') as CardDefinition, 7);
  const bullets = [bullet('b1', 1000, 0), bullet('b2', 2000, 0), bullet('b3', 900000, 0)];
  const effect = applyBulletPurge(bullets, { playerId: 'p1', xMilli: 0, yMilli: 0 }, activation, '12345', 7);
  const expected = selectPurgeTargets(
    bullets.map((entry) => ({ bulletId: entry.bulletId, xMilli: entry.xMilli, yMilli: entry.yMilli })),
    0,
    0,
    purgeRadiusMilli(activation.purgeRadius),
    activation.purgeCount,
    '12345',
    7,
    'purge_bell',
  );
  expectDeepEqual(
    effect.bulletDeltas.map((delta) => delta.bulletId),
    expected,
    'the purge selection differs',
  );
  expectEqual(effect.eventValue, effect.bulletDeltas.length, 'the event value counts the removals');
  for (const delta of effect.bulletDeltas) {
    expectEqual(delta.op, 'despawn', 'the purge despawns');
  }
});

test('the finisher clears the whole field in bullet-id order', () => {
  const bullets = [bullet('b3', 0, 0), bullet('b1', 0, 0), bullet('b2', 0, 0)];
  expectDeepEqual(sortedBulletIds(bullets), ['b1', 'b2', 'b3'], 'the ids sort byte-wise');
  const effect = applyFinisher(bullets, 3);
  expectDeepEqual(
    effect.bulletDeltas.map((delta) => delta.bulletId),
    ['b1', 'b2', 'b3'],
    'the finisher clears in id order',
  );
  expectEqual(effect.eventValue, 3, 'the event value counts the removals');
});

test('the invulnerability window is tick + duration', () => {
  const activation = buildCardActivation(findCardDefinition('aegis_ward') as CardDefinition, 100);
  expectEqual(activation.expiresTick, 280, 'the window is tick + 180');
  const effect = applyInvulnerable(activation);
  expectEqual(effect.invulnerableUntil, 280, 'the effect carries the deadline');
  expectEqual(effect.eventValue, 0, 'the event value is zero');
});

test('the rounding helper rounds half away from zero', () => {
  expectEqual(roundTo(1.23456, 3), 1.235, 'the value rounds up');
  expectEqual(roundTo(-1.23456, 3), -1.235, 'the value rounds away from zero');
  expectEqual(roundTo(0.5, 0), 1, 'a positive half rounds up');
  expectEqual(roundTo(-0.5, 0), -1, 'a negative half rounds away from zero');
});

suite('boss race: the card pipeline');

interface SimOptions {
  cardMechanics?: boolean;
}

function makeSim(options: SimOptions = {}): BossRaceSimulation {
  const sim = new BossRaceSimulation({
    ...defaultBossRaceConfig('match-card-001', 0x00010203),
    cardMechanics: options.cardMechanics ?? false,
  });
  sim.addPlayer('p1');
  sim.addPlayer('p2');
  return sim;
}

function cast(
  sim: BossRaceSimulation,
  playerId: string,
  seq: number,
  cardSlot: number,
  options: { shoot?: boolean; bomb?: boolean; slow?: boolean } = {},
): void {
  const tick = sim.getCurrentTick() + 1;
  sim.submitInput({
    playerId,
    tick,
    seq,
    directionBits: 0,
    slow: options.slow ?? false,
    shoot: options.shoot ?? false,
    bomb: options.bomb ?? false,
    cardSlot,
    modeActionId: '',
  });
}

test('the card pipeline is off by default, matching the boss-race server', () => {
  const sim = makeSim();
  sim.seedPlayerHand('p1', ['focus_lens'], 10, '12345');
  cast(sim, 'p1', 1, 0);
  sim.tick();
  const snapshot = sim.snapshot();
  expectEqual(snapshot.events, undefined, 'no events are produced');
  expectEqual(snapshot.players[0].bossCurrentHp, 6000, 'the boss is untouched');
  expectEqual(sim.playerEnergy('p1'), 10, 'the energy does not accrue');
  expectDeepEqual(sim.handCardsFor('p1'), [{ cardId: 'focus_lens', slot: 0, selected: false }], 'the hand is intact');
});

test('the -1 sentinel produces no event and no ledger change', () => {
  const sim = makeSim({ cardMechanics: true });
  sim.seedPlayerHand('p1', ['focus_lens'], 10, '12345');
  cast(sim, 'p1', 1, -1);
  const snapshot = sim.tick();
  expectEqual(snapshot.events, undefined, 'no event row is produced');
  expectEqual(snapshot.players[0].bossCurrentHp, 6000, 'the boss is untouched');
  expectDeepEqual(sim.handCardsFor('p1'), [{ cardId: 'focus_lens', slot: 0, selected: false }], 'the hand is intact');
});

test('an illegal slot is rejected with the server reason code', () => {
  const sim = makeSim({ cardMechanics: true });
  sim.seedPlayerHand('p1', ['focus_lens'], 10, '12345');
  cast(sim, 'p1', 1, 3);
  const snapshot = sim.tick();
  expect(snapshot.events !== undefined, 'a rejection row is produced');
  expectEqual(snapshot.events?.length, 1, 'exactly one row');
  expectEqual(snapshot.events?.[0].type, 'card_rejected', 'the row type differs');
  expectEqual(snapshot.events?.[0].playerId, 'p1', 'the row belongs to the caster');
  expectEqual(snapshot.events?.[0].data.reason, 'cast_card_slot_out_of_range', 'the reason differs');
  expectEqual(snapshot.players[0].bossCurrentHp, 6000, 'the boss is untouched');
});

test('a legal cast resolves the effect and damages the boss', () => {
  const sim = makeSim({ cardMechanics: true });
  sim.seedPlayerHand('p1', ['focus_lens'], 5, '12345');
  cast(sim, 'p1', 1, 0);
  const snapshot = sim.tick();
  const events = snapshot.events ?? [];
  expectEqual(events.length, 1, 'the self card emits only the acceptance row');
  expectEqual(events[0].type, 'card_accepted', 'the row type differs');
  expectEqual(events[0].data.card_id, 'focus_lens', 'the card id differs');
  expectEqual(events[0].data.value, 12, 'the event value is the card damage');
  // focus_lens deals 12 damage to the caster's own boss copy.
  expectEqual(snapshot.players[0].bossCurrentHp, 5988, 'the boss took the card damage');
  expectEqual(snapshot.players[0].damageDealt, 12, 'the damage is attributed');
  // The energy regens first and the cast is charged after it
  // (C++ simulation.cpp:1162-1177): 5 + 0.0025 - 2.
  expectClose(sim.playerEnergy('p1'), 3.0025, 1e-12, 'the energy was charged and regened');
  expectDeepEqual(sim.handCardsFor('p1'), [], 'the played slot is gone');
});

test('an opponent-pattern card fires the fan into the field', () => {
  const sim = makeSim({ cardMechanics: true });
  sim.seedPlayerHand('p1', ['mirror_lance'], 10, '12345');
  cast(sim, 'p1', 1, 0);
  const snapshot = sim.tick();
  const events = snapshot.events ?? [];
  expectEqual(events.length, 2, 'the acceptance and the effect rows');
  expectEqual(events[1].type, 'card_effect_applied', 'the second row is the effect');
  expectEqual(events[1].data.value, 7, 'seven bullets were fired');
  expectEqual(events[1].data.target_user_id, 'p2', 'the opponent is the target');
  expectEqual(snapshot.bullets.length, 7, 'the fan is in the field');
  // mirror_lance deals 26 damage to the caster's own boss copy.
  expectEqual(snapshot.players[0].bossCurrentHp, 5974, 'the boss took the card damage');
});

test('an invulnerable card opens the immunity window', () => {
  const sim = makeSim({ cardMechanics: true });
  sim.seedPlayerHand('p1', ['aegis_ward'], 10, '12345');
  cast(sim, 'p1', 1, 0);
  const snapshot = sim.tick();
  expectEqual(snapshot.players[0].invulnerableUntilTick, 181, 'the window is tick + 180');
});

test('the card energy regens every tick', () => {
  const sim = makeSim({ cardMechanics: true });
  sim.seedPlayerHand('p1', ['focus_lens'], 0, '12345');
  cast(sim, 'p1', 1, -1);
  sim.tick();
  expectClose(sim.playerEnergy('p1'), CARD_ENERGY_PER_TICK, 1e-12, 'one tick of regen');
  cast(sim, 'p1', 2, -1);
  sim.tick();
  expectClose(sim.playerEnergy('p1'), CARD_ENERGY_PER_TICK * 2, 1e-12, 'two ticks of regen');
});

test('the held fallback never re-casts a card', () => {
  const sim = makeSim({ cardMechanics: true });
  sim.seedPlayerHand('p1', ['focus_lens'], 10, '12345');
  cast(sim, 'p1', 1, 0);
  sim.tick();
  // The next ticks carry no fresh input, so the fallback must not replay the
  // cast (C++ simulation.cpp:1171-1177 only consumes real inputs).
  sim.tick();
  sim.tick();
  const snapshot = sim.snapshot();
  expectEqual(snapshot.players[0].bossCurrentHp, 5988, 'the card was cast exactly once');
});

suite('bomb and focus judgement');

test('the bomb damage rule matches the server', () => {
  expectEqual(bossRaceTickDamage(true, false, undefined, undefined), BOSS_RACE_DAMAGE_PER_SHOT_TICK, 'a plain shot');
  expectEqual(bossRaceTickDamage(false, false, undefined, undefined), 0, 'no input, no damage');
  // A configured loadout *replaces* the default shot damage.
  expectEqual(bossRaceTickDamage(true, false, 7, undefined), 7, 'the loadout replaces the shot damage');
  expectEqual(bossRaceTickDamage(true, false, 0, undefined), 0, 'a zero-damage loadout zeroes the shot');
  // A bomb *adds* the loadout's bomb damage on top of the shot.
  expectEqual(bossRaceTickDamage(true, true, 7, 30), 37, 'the bomb adds on top');
  expectEqual(bossRaceTickDamage(false, true, undefined, 30), 30, 'a bomb alone still damages');
  // Without a loadout the server's bomb spec is null, so the bomb adds nothing.
  expectEqual(bossRaceTickDamage(false, true, undefined, undefined), 0, 'no loadout, no bomb damage');
  expectEqual(bossRaceTickDamage(true, true, undefined, undefined), BOSS_RACE_DAMAGE_PER_SHOT_TICK, 'the shot still lands');
});

test('the focus rule halves the movement speed', () => {
  expectEqual(focusMoveSpeed(NORMAL_MOVE_SPEED_MILLI, false), 5000, 'the normal speed differs');
  expectEqual(focusMoveSpeed(NORMAL_MOVE_SPEED_MILLI, true), FOCUS_MOVE_SPEED_MILLI, 'the focus speed differs');
  expectEqual(FOCUS_MOVE_SPEED_MILLI, 2500, 'the server focus speed differs');
  expectEqual(NORMAL_MOVE_SPEED_MILLI, 5000, 'the server normal speed differs');
});

test('the boss-race simulation ignores the focus key, like the server', () => {
  const normal = makeSim();
  const focused = makeSim();
  const tick = normal.getCurrentTick() + 1;
  normal.submitInput({
    playerId: 'p1',
    tick,
    seq: 1,
    directionBits: 0x1,
    slow: false,
    shoot: false,
    bomb: false,
    cardSlot: -1,
    modeActionId: '',
  });
  focused.submitInput({
    playerId: 'p1',
    tick,
    seq: 1,
    directionBits: 0x1,
    slow: true,
    shoot: false,
    bomb: false,
    cardSlot: -1,
    modeActionId: '',
  });
  normal.tick();
  focused.tick();
  const normalY = normal.snapshot().players[0].yMilli;
  const focusedY = focused.snapshot().players[0].yMilli;
  expectEqual(normalY, -MOVE_MILLI_PER_TICK, 'the normal move differs');
  expectEqual(focusedY, normalY, 'the focus key must not change the race movement');
});
