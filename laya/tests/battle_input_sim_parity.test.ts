/**
 * Battle input ↔ simulation parity — the two halves of one contract.
 *
 * The product path is: `BattleClient.sendInput` builds a `BattleInput`,
 * `encodeBattleInput` puts it on the KCP wire, the battle server's
 * `ReadBattleInputBody` (`PhK-BattleServer/src/match_lifecycle.cpp:515-551`)
 * reads it back, and `BossRaceSimulation::ApplyPlayerTick`
 * (`boss_race.cpp:339-423`) consumes it. This file pins both seams offline:
 *
 *  1. **Round-trip**: `decodeBattleInput(encodeBattleInput(x))` must be
 *     protocol-equivalent to `x` for every field combination the wire carries,
 *     and re-encoding the decode must reproduce the same bytes. The C++
 *     encoder (`match_lifecycle.cpp:480-505`) is the reference: same field
 *     order, same flag bits, same i8 truncations, same "card block only when a
 *     field is non-default" rule (`:498`).
 *
 *  2. **Simulation consumption**: the *decoded* input — never the original
 *     object — is what gets fed to `BossRaceSimulation`, and the sim must then
 *     behave exactly like the C++ race simulation for every ruleset the lobby
 *     can actually mint: movement 3000 milli/tick with the server bit layout
 *     (`boss_race.cpp:356-369`), the synthetic per-tick damage rule
 *     (`:395-414`), `card_slot` inert by default (no occurrence of `card_slot`
 *     anywhere in `boss_race.cpp`), and the `-1` sentinel semantics of
 *     `ValidateCast` (`card_hand.cpp:66-77`).
 *
 * Everything runs offline: no sockets, no servers, no C++ compilation.
 */

import {
  decodeBattleInput,
  encodeBattleInput,
  encodeBattleInputWithTicket,
} from '../src/core/net/battle_codec';
import { emptyVersionStamp, type BattleInput } from '../src/core/protocol/types';
import {
  ARENA_HALF_WIDTH_MILLI,
  BOSS_RACE_DAMAGE_PER_SHOT_TICK,
  BossRaceSimulation,
  BossRaceState,
  defaultBossRaceConfig,
  DIR_DOWN,
  DIR_LEFT,
  DIR_RIGHT,
  DIR_UP,
  MOVE_MILLI_PER_TICK,
  usesRealDanmaku,
  type BossRaceConfig,
} from '../src/core/sim/boss_race';
import { Lcg, expect, expectDeepEqual, expectEqual, suite, test } from './harness';

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

/** A full BattleInput with the product's usual values. */
function makeInput(overrides: Partial<BattleInput> = {}): BattleInput {
  return {
    version: { ...emptyVersionStamp(), protocolVersion: 1 },
    matchId: 'm1',
    playerId: 'p1',
    tick: 7,
    seq: 3,
    directionBits: 0,
    slow: false,
    shoot: false,
    bomb: false,
    cardSlot: -1,
    modeActionId: '',
    ...overrides,
  };
}

/**
 * The comparable form of a BattleInput: exactly the fields the wire carries,
 * with the C++ struct defaults (`protocol.hpp:42-59`) filling the absent
 * optionals. `cardDraw: undefined` and `cardDraw: false` are the same message —
 * the encoder omits the block for both (`match_lifecycle.cpp:498`) — so the
 * decoder's `undefined` is the protocol default, not a loss.
 */
function wireForm(value: BattleInput): string {
  return JSON.stringify({
    protocolVersion: value.version?.protocolVersion ?? 1,
    matchId: value.matchId,
    playerId: value.playerId,
    tick: value.tick,
    seq: value.seq,
    directionBits: value.directionBits >>> 0,
    slow: value.slow === true,
    shoot: value.shoot === true,
    bomb: value.bomb === true,
    cardSlot: value.cardSlot,
    modeActionId: value.modeActionId,
    cardDraw: value.cardDraw === true,
    cardSelect: value.cardSelect ?? -1,
    cardUse: value.cardUse === true,
  });
}

/**
 * The round-trip contract: the decode is protocol-equivalent to the input, and
 * the wire is canonical (re-encoding the decode reproduces the same bytes, so
 * no information is created or destroyed by a second hop).
 */
function assertRoundTrip(value: BattleInput, label: string): void {
  const frame = encodeBattleInput(value);
  const decoded = decodeBattleInput(frame);
  expect(decoded !== null, `${label}: the frame must decode`);
  expectEqual(wireForm(decoded!), wireForm(value), `${label}: the decoded input must be equivalent`);
  expectDeepEqual(
    [...encodeBattleInput(decoded!)],
    [...frame],
    `${label}: re-encoding the decode must be byte-identical`,
  );
}

/** A two-player race simulation, the shape the battle server runs. */
function raceSim(config: Partial<BossRaceConfig> = {}): BossRaceSimulation {
  const sim = new BossRaceSimulation({ ...defaultBossRaceConfig('match-1', 12345), ...config });
  sim.addPlayer('p1', -20000, 60000);
  sim.addPlayer('p2', 20000, 60000);
  return sim;
}

function bossHp(sim: BossRaceSimulation, playerId: string): number {
  const player = sim.snapshot().players.find((entry) => entry.playerId === playerId);
  if (player === undefined) {
    throw new Error(`no player ${playerId}`);
  }
  return player.bossCurrentHp;
}

function damageDealt(sim: BossRaceSimulation, playerId: string): number {
  const player = sim.snapshot().players.find((entry) => entry.playerId === playerId);
  if (player === undefined) {
    throw new Error(`no player ${playerId}`);
  }
  return player.damageDealt;
}

/**
 * Encodes an input, pushes it through the real wire decoder, and submits what
 * the server would have received — the exact composition the product runs, so
 * a codec regression cannot pass by only testing the objects directly.
 */
function feedDecoded(
  sim: BossRaceSimulation,
  playerId: string,
  tick: number,
  seq: number,
  fields: Partial<BattleInput> = {},
): boolean {
  const decoded = decodeBattleInput(encodeBattleInput(makeInput({ playerId, tick, seq, ...fields })));
  expect(decoded !== null, 'the encoded frame must decode');
  return sim.submitInput({
    playerId: decoded!.playerId,
    tick: decoded!.tick,
    seq: decoded!.seq,
    directionBits: decoded!.directionBits,
    slow: decoded!.slow,
    shoot: decoded!.shoot,
    bomb: decoded!.bomb,
    cardSlot: decoded!.cardSlot,
    modeActionId: decoded!.modeActionId,
  });
}

// ---------------------------------------------------------------------------
// 1. codec round-trip (encode → decode equivalence)
// ---------------------------------------------------------------------------

suite('battle input round-trip: encode → decode equivalence');

test('every slow/shoot/bomb combination and direction mask round-trips', () => {
  for (let flags = 0; flags < 8; flags += 1) {
    for (let direction = 0; direction < 16; direction += 1) {
      assertRoundTrip(
        makeInput({
          slow: (flags & 0x01) !== 0,
          shoot: (flags & 0x02) !== 0,
          bomb: (flags & 0x04) !== 0,
          directionBits: direction,
        }),
        `flags ${flags} direction ${direction}`,
      );
    }
  }
});

test('every card-block field combination round-trips', () => {
  // The block is written when any field is non-default; every combination of
  // present/absent/default must come back equivalent (match_lifecycle.cpp:498).
  const draws: Array<boolean | undefined> = [undefined, false, true];
  const selects: Array<number | undefined> = [undefined, -1, 0, 3];
  const uses: Array<boolean | undefined> = [undefined, false, true];
  for (const cardDraw of draws) {
    for (const cardSelect of selects) {
      for (const cardUse of uses) {
        assertRoundTrip(
          makeInput({ cardDraw, cardSelect, cardUse }),
          `draw=${String(cardDraw)} select=${String(cardSelect)} use=${String(cardUse)}`,
        );
      }
    }
  }
});

test('explicit default card fields are equivalent to their absence on the wire', () => {
  // The C++ encoder writes the block only for a non-default field, so a caller
  // that passes the struct defaults explicitly produces exactly the legacy
  // frame — and the decoder reports the absent fields as `undefined`, which
  // every consumer already treats as the default (protocol.hpp:57-59).
  const explicit = makeInput({ cardDraw: false, cardSelect: -1, cardUse: false });
  expectDeepEqual(
    [...encodeBattleInput(explicit)],
    [...encodeBattleInput(makeInput())],
    'the explicit-default frame is the legacy frame, byte for byte',
  );
  const decoded = decodeBattleInput(encodeBattleInput(explicit));
  expect(decoded !== null, 'the frame decodes');
  expectEqual(decoded!.cardDraw, undefined, 'an absent draw is undefined');
  expectEqual(decoded!.cardSelect, undefined, 'an absent select is undefined');
  expectEqual(decoded!.cardUse, undefined, 'an absent use is undefined');
  expectEqual(wireForm(decoded!), wireForm(explicit), 'and the two are protocol-equivalent');
});

test('the cardSlot -1 sentinel and the whole i8 domain survive the wire', () => {
  assertRoundTrip(makeInput({ cardSlot: -1 }), 'the -1 sentinel');
  for (let slot = -128; slot <= 127; slot += 1) {
    const decoded = decodeBattleInput(encodeBattleInput(makeInput({ cardSlot: slot })));
    expect(decoded !== null, `cardSlot ${slot} must decode`);
    expectEqual(decoded!.cardSlot, slot, `cardSlot ${slot} must round-trip`);
  }
});

test('cardSelect round-trips across the i8 domain when the block is present', () => {
  for (let select = -128; select <= 127; select += 1) {
    const decoded = decodeBattleInput(
      encodeBattleInput(makeInput({ cardUse: true, cardSelect: select })),
    );
    expect(decoded !== null, `cardSelect ${select} must decode`);
    expectEqual(decoded!.cardSelect, select, `cardSelect ${select} must round-trip`);
  }
});

test('an out-of-range cardSlot truncates exactly like the C++ int8 cast', () => {
  // The C++ encoder casts to std::int8_t (match_lifecycle.cpp:494) and the
  // decoder reads one back (:536); the client's i8 writer/reader performs the
  // same two's-complement truncation, so an out-of-domain slot lands on the
  // value the server would have reconstructed.
  const cases: Array<[number, number]> = [
    [128, -128],
    [-129, 127],
    [256, 0],
    [255, -1],
    [-256, 0],
  ];
  for (const [raw, expected] of cases) {
    const decoded = decodeBattleInput(encodeBattleInput(makeInput({ cardSlot: raw })));
    expect(decoded !== null, `cardSlot ${raw} must still decode`);
    expectEqual(decoded!.cardSlot, expected, `cardSlot ${raw} truncates to ${expected}`);
  }
});

test('tick and seq are exact up to 2^53', () => {
  // Ticks and seqs are far below 2^53; pin exactness there. Beyond it a JS
  // number cannot hold a u64 — the frame must degrade, not corrupt (pinned by
  // the battle_e2e suite); here the usable range is what matters.
  for (const value of [0, 1, 45, 100000, 2 ** 31, 2 ** 53 - 1]) {
    const decoded = decodeBattleInput(encodeBattleInput(makeInput({ tick: value, seq: value })));
    expect(decoded !== null, `tick ${value} must decode`);
    expectEqual(decoded!.tick, value, `tick ${value}`);
    expectEqual(decoded!.seq, value, `seq ${value}`);
  }
});

test('strings round-trip: empty, ascii, CJK, surrogate pairs and lone surrogates', () => {
  const texts = ['', 'a', 'match-1', '玩家一', '🎯boom', '𝔘𝔫𝔦𝔠𝔬𝔡𝔢', '\ud800', 'a\udfffb'];
  for (const text of texts) {
    const decoded = decodeBattleInput(encodeBattleInput(makeInput({ modeActionId: text })));
    expect(decoded !== null, `modeActionId ${JSON.stringify(text)} must decode`);
    expectEqual(decoded!.modeActionId, text, `modeActionId ${JSON.stringify(text)}`);
    const ids = decodeBattleInput(
      encodeBattleInput(makeInput({ matchId: text, playerId: text })),
    );
    expect(ids !== null, `ids ${JSON.stringify(text)} must decode`);
    expectEqual(ids!.matchId, text, `matchId ${JSON.stringify(text)}`);
    expectEqual(ids!.playerId, text, `playerId ${JSON.stringify(text)}`);
  }
});

test('only protocolVersion rides the wire on the version stamp', () => {
  // The BattleInput wire carries protocol_version alone
  // (match_lifecycle.cpp:483); the other VersionStamp fields belong to the
  // ticket block, not the input body.
  const decoded = decodeBattleInput(
    encodeBattleInput(
      makeInput({
        version: {
          ...emptyVersionStamp(),
          protocolVersion: 9,
          businessApiVersion: 'v9',
          battleApiVersion: 'b9',
          rulesetVersion: 'r9',
          rulesetHash: 'h9',
        },
      }),
    ),
  );
  expect(decoded !== null, 'the frame decodes');
  expectEqual(decoded!.version?.protocolVersion, 9, 'the protocol version survives');
  expectEqual(decoded!.version?.businessApiVersion, '', 'the other stamp fields are not on the wire');

  // An absent version encodes as 1 (the encoder's default) and decodes as a
  // full stamp with that protocol version.
  const noVersion = decodeBattleInput(
    encodeBattleInput({ ...makeInput(), version: undefined }),
  );
  expect(noVersion !== null, 'the version-less frame decodes');
  expectEqual(noVersion!.version?.protocolVersion, 1, 'an absent version is protocol version 1');
});

test('a legacy frame without a card block decodes to the server struct defaults', () => {
  // A pre-§2.3 frame ends right after mode_action_id; the decoder must report
  // the C++ struct defaults (protocol.hpp:52 / :57-59) as `undefined`
  // optionals rather than inventing values, and card_slot keeps -1.
  const decoded = decodeBattleInput(encodeBattleInput(makeInput()));
  expect(decoded !== null, 'the legacy frame decodes');
  expectEqual(decoded!.cardSlot, -1, 'card_slot keeps its struct default');
  expectEqual(decoded!.cardDraw, undefined, 'no card block → undefined draw');
  expectEqual(decoded!.cardSelect, undefined, 'no card block → undefined select');
  expectEqual(decoded!.cardUse, undefined, 'no card block → undefined use');
});

test('the production ticket frame still round-trips its input body', () => {
  // Every frame the product sends carries the signed ticket
  // (`encodeBattleInputWithTicket`); the body must survive the tail unchanged,
  // and the ticket's presence byte must never be read as a card block.
  const raw: Record<string, unknown> = {
    signature_alg: 'ED25519',
    key_id: 'lobby-key-1',
    signature: 'aabb',
    public_key_hex: 'ccdd',
    server_authoritative: true,
    ticket: {
      version: { protocol_version: 1 },
      ticket_id: 'tk-1',
      match_id: 'm1',
      user_id: 'u-42',
      player_id: 'p1',
      mode_id: 'mvp_boss_race',
      server_seed: '12345678901234567890',
    },
  };
  const value = makeInput({
    shoot: true,
    slow: true,
    directionBits: 0x5,
    cardSlot: 2,
    cardDraw: true,
    cardSelect: 1,
    cardUse: true,
  });
  const decoded = decodeBattleInput(encodeBattleInputWithTicket(value, raw));
  expect(decoded !== null, 'the ticket frame decodes as an input');
  expectEqual(wireForm(decoded!), wireForm(value), 'the body is protocol-equivalent');
  expectDeepEqual(
    [...encodeBattleInput(decoded!)],
    [...encodeBattleInput(value)],
    'and re-encodes byte-identically',
  );
});

test('randomized inputs round-trip across the wire (fuzz)', () => {
  const rng = new Lcg(20261025);
  const alphabet = ['a', 'Z', '0', '-', '_', '玩', '🎯', '\ud800'];
  const randomString = (): string => {
    const length = Math.floor(rng.next() * 6);
    let out = '';
    for (let i = 0; i < length; i += 1) {
      out += alphabet[Math.floor(rng.next() * alphabet.length)];
    }
    return out;
  };
  for (let i = 0; i < 300; i += 1) {
    const value = makeInput({
      matchId: randomString(),
      playerId: randomString(),
      modeActionId: randomString(),
      tick: Math.floor(rng.next() * 2 ** 40),
      seq: Math.floor(rng.next() * 2 ** 40),
      directionBits: Math.floor(rng.next() * 16),
      slow: rng.next() < 0.5,
      shoot: rng.next() < 0.5,
      bomb: rng.next() < 0.5,
      cardSlot: Math.floor(rng.next() * 256) - 128,
      cardDraw: rng.next() < 0.5 ? true : undefined,
      cardSelect: rng.next() < 0.5 ? Math.floor(rng.next() * 256) - 128 : undefined,
      cardUse: rng.next() < 0.5 ? true : undefined,
    });
    assertRoundTrip(value, `fuzz ${i}`);
  }
});

// ---------------------------------------------------------------------------
// 2. decoded inputs driving the simulation (C++ ApplyPlayerTick parity)
// ---------------------------------------------------------------------------

suite('decoded inputs drive the boss-race simulation like the C++ ApplyPlayerTick');

test('a decoded movement input moves the ship by the server step', () => {
  // 8-direction bitmask 0=up,1=right,2=down,3=left at 3000 milli/tick
  // (boss_race.cpp:356-369) — the server convention, not the Godot one.
  const sim = raceSim();
  feedDecoded(sim, 'p1', 1, 1, { directionBits: DIR_RIGHT | DIR_DOWN });
  sim.tick();
  let p1 = sim.snapshot().players.find((player) => player.playerId === 'p1')!;
  expectEqual(p1.xMilli, -20000 + MOVE_MILLI_PER_TICK, 'right steps +3000');
  expectEqual(p1.yMilli, 60000 + MOVE_MILLI_PER_TICK, 'down steps +3000');

  feedDecoded(sim, 'p1', 2, 2, { directionBits: DIR_UP | DIR_LEFT });
  sim.tick();
  p1 = sim.snapshot().players.find((player) => player.playerId === 'p1')!;
  expectEqual(p1.xMilli, -20000, 'left steps back -3000');
  expectEqual(p1.yMilli, 60000, 'up steps back -3000');
});

test('a decoded movement input clamps to the arena box, like the server', () => {
  const sim = raceSim();
  for (let tick = 1; tick <= 45; tick += 1) {
    feedDecoded(sim, 'p1', tick, tick, { directionBits: DIR_LEFT });
    sim.tick();
  }
  const p1 = sim.snapshot().players.find((player) => player.playerId === 'p1')!;
  expectEqual(p1.xMilli, -ARENA_HALF_WIDTH_MILLI, 'the ship stops at the arena edge');
});

test('decoded shoot and bomb deal exactly the server per-tick damage (no loadout)', () => {
  // boss_race.cpp:395-414: shoot adds 10 (or the loadout's shot damage), bomb
  // adds the loadout's bomb damage — and without a loadout the server's bomb
  // spec is nullptr, so the bomb adds nothing at all.
  const sim = raceSim();
  feedDecoded(sim, 'p1', 1, 1, { shoot: true });
  sim.tick();
  expectEqual(bossHp(sim, 'p1'), 6000 - BOSS_RACE_DAMAGE_PER_SHOT_TICK, 'a plain shot deals 10');
  expectEqual(damageDealt(sim, 'p1'), 10);

  feedDecoded(sim, 'p1', 2, 2, { shoot: false, bomb: true });
  sim.tick();
  expectEqual(damageDealt(sim, 'p1'), 10, 'a bomb without a loadout adds nothing');

  feedDecoded(sim, 'p1', 3, 3, { shoot: true, bomb: true });
  sim.tick();
  expectEqual(damageDealt(sim, 'p1'), 20, 'shoot + bomb is still just the shot');
});

test('decoded shoot and bomb with a loadout replace and add like the server table', () => {
  // ReimuA1 shot = 50 (replaces the default 10), Reimu bomb = 45 (adds on top)
  // — the loadout tables mirrored in danmaku/player_loadout_damage.ts.
  const sim = raceSim({
    loadouts: [{ playerId: 'p1', characterId: 'reimu', shotType: 'ReimuA1', bombType: 'Reimu' }],
  });
  feedDecoded(sim, 'p1', 1, 1, { shoot: true });
  sim.tick();
  expectEqual(damageDealt(sim, 'p1'), 50, 'the loadout shot replaces the default 10');

  feedDecoded(sim, 'p1', 2, 2, { shoot: true, bomb: true });
  sim.tick();
  expectEqual(damageDealt(sim, 'p1'), 145, 'the second tick adds 50 + 45 on top of the first 50');

  feedDecoded(sim, 'p1', 3, 3, { shoot: false, bomb: true });
  sim.tick();
  expectEqual(damageDealt(sim, 'p1'), 190, 'a bomb alone still deals its table damage (45)');
});

test('an unknown loadout name behaves like no loadout, like the server lookup', () => {
  // The C++ resolves the name against PlayerShotTable/PlayerBombTable and keeps
  // nullptr for an unknown one (boss_race.cpp:181-196); the client's -1
  // sentinel from playerShotDamage/playerBombDamage has the same effect.
  const sim = raceSim({
    loadouts: [{ playerId: 'p1', characterId: '', shotType: 'NoSuchShot', bombType: 'NoSuchBomb' }],
  });
  feedDecoded(sim, 'p1', 1, 1, { shoot: true, bomb: true });
  sim.tick();
  expectEqual(damageDealt(sim, 'p1'), 10, 'unknown names resolve to no spec → the default shot only');
});

test('per-tick damage is clamped to the remaining boss HP', () => {
  const sim = raceSim({ bossMaxHp: 15 });
  feedDecoded(sim, 'p1', 1, 1, { shoot: true });
  sim.tick();
  expectEqual(bossHp(sim, 'p1'), 5, 'the first shot lands whole');
  expectEqual(damageDealt(sim, 'p1'), 10);

  feedDecoded(sim, 'p1', 2, 2, { shoot: true });
  sim.tick();
  expectEqual(bossHp(sim, 'p1'), 0, 'the boss is broken');
  expectEqual(damageDealt(sim, 'p1'), 15, 'the final tick is clamped, never overkill');
  expectEqual(sim.getState(), BossRaceState.Finished, 'and the race is over');
});

test('the slow flag does not change race movement, matching boss_race.cpp:356-369', () => {
  // The race moves a flat 3000 milli/tick whatever `slow` says; the focus
  // half-speed rule belongs to the shared simulation (simulation.cpp:2181),
  // not here.
  const plain = raceSim();
  const focused = raceSim();
  feedDecoded(plain, 'p1', 1, 1, { directionBits: DIR_UP, slow: false });
  feedDecoded(focused, 'p1', 1, 1, { directionBits: DIR_UP, slow: true });
  plain.tick();
  focused.tick();
  const plainY = plain.snapshot().players.find((player) => player.playerId === 'p1')!.yMilli;
  const focusedY = focused.snapshot().players.find((player) => player.playerId === 'p1')!.yMilli;
  expectEqual(focusedY, plainY, 'focus changes nothing in the race model');
  expectEqual(focusedY, 60000 - MOVE_MILLI_PER_TICK, 'the step is the flat server step');
});

test('the race simulation consumes a decoded card_slot only when cardMechanics is on', () => {
  // Default off — the server-parity decision: `boss_race.cpp` never reads
  // card_slot (grep: zero occurrences), so a card frame must be
  // indistinguishable from an idle one, hash included.
  const plain = raceSim();
  const carded = raceSim();
  for (let tick = 1; tick <= 5; tick += 1) {
    feedDecoded(plain, 'p1', tick, tick, { shoot: true, cardSlot: -1 });
    feedDecoded(carded, 'p1', tick, tick, { shoot: true, cardSlot: 2 });
    plain.tick();
    carded.tick();
    expectEqual(
      carded.canonicalStateHash(),
      plain.canonicalStateHash(),
      `tick ${tick}: card_slot is inert by default`,
    );
  }
  expectEqual(carded.snapshot().events, undefined, 'and no card events are produced');
});

test('under cardMechanics a decoded -1 sentinel plays no card and emits no row', () => {
  // The sentinel is accepted + playsNoCard (card_hand.cpp:72-77): no
  // card_rejected, no ledger change, no state change.
  const sim = raceSim({ cardMechanics: true });
  sim.seedPlayerHand('p1', ['focus_lens'], 10, '12345');
  feedDecoded(sim, 'p1', 1, 1, { cardSlot: -1 });
  const snapshot = sim.tick();
  expectEqual(snapshot.events, undefined, 'the sentinel is not a rejection');
  expectEqual(bossHp(sim, 'p1'), 6000, 'the boss is untouched');
  expectDeepEqual(
    sim.handCardsFor('p1'),
    [{ cardId: 'focus_lens', slot: 0, selected: false }],
    'the hand is intact',
  );
});

test('under cardMechanics a decoded slot cast resolves once and the held fallback never replays it', () => {
  const sim = raceSim({ cardMechanics: true });
  sim.seedPlayerHand('p1', ['focus_lens'], 10, '12345');
  feedDecoded(sim, 'p1', 1, 1, { cardSlot: 0 });
  const snapshot = sim.tick();
  const events = snapshot.events ?? [];
  expectEqual(events.length, 1, 'exactly one row');
  expectEqual(events[0].type, 'card_accepted', 'the acceptance row');
  expectEqual(events[0].data.card_id, 'focus_lens', 'the card id');
  expectEqual(bossHp(sim, 'p1'), 5988, 'focus_lens deals 12 to the caster own boss copy');

  // Ticks 2 and 3 carry no fresh input: the held fallback must not re-cast.
  sim.tick();
  sim.tick();
  expectEqual(bossHp(sim, 'p1'), 5988, 'the cast happened exactly once');
  expectEqual(sim.snapshot().events, undefined, 'and produced no further rows');
});

test('the simulation window guard still refuses stale and malformed decoded inputs', () => {
  // The composition must not weaken SubmitInput's validation
  // (boss_race.cpp:301-328): a decoded frame is still subject to the tick
  // window, the seq monotonicity and the direction mask.
  const sim = raceSim();
  expectEqual(feedDecoded(sim, 'p1', 1, 1), true, 'the first tick is accepted');
  sim.tick();
  expectEqual(feedDecoded(sim, 'p1', 1, 2), false, 'a stale tick is refused');
  expectEqual(feedDecoded(sim, 'p1', 2, 2, { directionBits: 0x10 }), false, 'a bad direction mask is refused');
  expectEqual(feedDecoded(sim, 'p1', 10, 3), false, 'a tick beyond the +8 window is refused');
  expectEqual(feedDecoded(sim, 'p1', 2, 1), false, 'a non-monotonic seq is refused');
});

test('the wire is transparent: decoded inputs drive a simulation identical to the original', () => {
  // Two simulations of the same match: one is fed the inputs directly, the
  // other only ever sees what decodeBattleInput(encodeBattleInput(x)) returns.
  // Every tick's canonical hash must agree — the codec cannot move the sim.
  const direct = raceSim();
  const wired = raceSim();
  const script: Array<Partial<BattleInput>> = [
    { directionBits: DIR_RIGHT, shoot: true },
    { directionBits: DIR_UP, shoot: true, bomb: true },
    { directionBits: 0, slow: true },
    { directionBits: DIR_LEFT | DIR_DOWN, cardSlot: 3 },
    { directionBits: DIR_UP, shoot: true, cardDraw: true, cardSelect: 1, cardUse: true },
  ];
  for (let tick = 1; tick <= 50; tick += 1) {
    const fields = script[(tick - 1) % script.length];
    direct.submitInput({
      playerId: 'p1',
      tick,
      seq: tick,
      directionBits: fields.directionBits ?? 0,
      slow: fields.slow ?? false,
      shoot: fields.shoot ?? false,
      bomb: fields.bomb ?? false,
      cardSlot: fields.cardSlot ?? -1,
      modeActionId: '',
    });
    feedDecoded(wired, 'p1', tick, tick, fields);
    direct.tick();
    wired.tick();
    expectEqual(wired.canonicalStateHash(), direct.canonicalStateHash(), `tick ${tick} hash`);
  }
});

// ---------------------------------------------------------------------------
// 3. ruleset branch notes — what the client does and does not model
// ---------------------------------------------------------------------------

suite('ruleset branch notes (C++ boss_race.cpp:371-386 / :395-418)');

test('every non-synthetic ruleset shares the real-danmaku bullet path', () => {
  // The bullet-path predicate (boss_race.cpp:437-440) and the mechanics
  // predicate (boss_race.hpp:44, :161-163) are different switches on the
  // server; this is only the first one.
  expectEqual(usesRealDanmaku('mvp-boss-race-s0'), false, 'the legacy synthetic scheduler');
  expectEqual(usesRealDanmaku('ruleset-local-s0'), true, 'the ruleset the lobby mints');
  expectEqual(usesRealDanmaku('tna-1.40-phase'), true, 'the ported production timeline');
  expectEqual(usesRealDanmaku('tna-1.40-danmaku'), true, 'the mechanics ruleset also takes the real path');
  expectEqual(usesRealDanmaku(''), true, 'an empty ruleset is "not the legacy one", like the server');
});

test('the tna-1.40-danmaku mechanics branch is implemented (P2 port)', () => {
  // C++ boss_race.cpp:373-386 / :395-418: under ruleset "tna-1.40-danmaku"
  // (kRulesetDanmakuMechanics, boss_race.hpp:44) the server *consumes* a bomb,
  // grants 120 invulnerable ticks (kDanmakuInvulnerableTicks), emits a
  // `bomb_used` row and settles the bomb damage directly, and turns `shoot`
  // into my-bullet entities instead of the synthetic per-tick damage.
  //
  // This used to pin the unimplemented gap (the client kept the synthetic
  // damage and emitted nothing). The P2 port (route C2) closed it: the client
  // now mirrors the server's branch — no synthetic damage under this ruleset,
  // the bomb is consumed locally and the invulnerable window is granted. The
  // full rule set (hit / graze / lives / dead) lives in
  // `boss_race_danmaku_mechanics.test.ts`; this seam only checks that a
  // *decoded wire input* drives the branch.
  const sim = raceSim({ rulesetVersion: 'tna-1.40-danmaku' });
  feedDecoded(sim, 'p1', 1, 1, { shoot: true, bomb: true });
  const snapshot = sim.tick();
  const p1 = snapshot.players.find((player) => player.playerId === 'p1');
  expectEqual(p1?.damageDealt, 0, 'no synthetic shot damage under the mechanics ruleset (server parity)');
  expectEqual(p1?.bombs, 2, 'the decoded bomb press consumed one bomb');
  expectEqual(p1?.invulnerableUntilTick, 121, 'and granted the 120-tick window');
  expectEqual(snapshot.events?.length, 1, 'one bomb_used row');
  expectEqual(snapshot.events?.[0].type, 'bomb_used');
  expectEqual(snapshot.events?.[0].playerId, 'p1');
});
