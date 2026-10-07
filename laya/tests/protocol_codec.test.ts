/**
 * Protobuf codec tests for the `phk.v1` contract.
 *
 * Covers encode/decode round-trips plus a byte-level check that field numbers
 * match the `.proto` definitions (a wrong field number would still round-trip
 * but would be rejected by the Go/C++ servers).
 */

import { codec } from '../src/core/protocol/codec';
import type { MatchResultMessage, MatchStartMessage, RoomStateMessage } from '../src/core/protocol/types';
import { BattlePayloadType } from '../src/core/protocol/types';
import { expectDeepEqual, expectEqual, suite, test } from './harness';

suite('protobuf codec');

test('VersionStamp encodes field 1 as a varint', () => {
  const bytes = codec.versionStamp.encode({
    protocolVersion: 1,
    businessApiVersion: '',
    battleApiVersion: '',
    rulesetVersion: '',
    rulesetHash: '',
  });
  // field 1, wire type 0 => key 0x08, value 0x01
  expectDeepEqual(Array.from(bytes), [0x08, 0x01]);
});

test('RoomStateMessage round-trips players, repeated fields and maps', () => {
  const message: RoomStateMessage = {
    roomCode: 'RACE01',
    hostUserId: 'user-alice',
    modeId: 'mvp_boss_race',
    allReady: true,
    rulesetVersion: 'ruleset-local-s0',
    modeParams: { stage: 'stage_mvp_01', character: 'char_reimu' },
    players: [
      {
        userId: 'user-alice',
        playerId: 'p1',
        displayName: 'Alice',
        ready: true,
        host: true,
        connected: true,
        characterId: 'char_reimu',
      },
      {
        userId: 'user-bob',
        playerId: 'p2',
        displayName: 'Bob',
        ready: false,
        host: false,
        connected: true,
        characterId: 'char_marisa',
      },
    ],
  };
  const decoded = codec.roomState.decode(codec.roomState.encode(message));
  expectEqual(decoded.roomCode, 'RACE01');
  expectEqual(decoded.allReady, true);
  expectEqual(decoded.players.length, 2);
  expectEqual(decoded.players[1].displayName, 'Bob');
  expectEqual(decoded.players[1].ready, false);
  expectEqual(decoded.modeParams.stage, 'stage_mvp_01');
  expectEqual(decoded.modeParams.character, 'char_reimu');
});

test('MatchStartMessage round-trips nested ticket and byte fields', () => {
  const message: MatchStartMessage = {
    matchId: 'match-mvp-001',
    serverSeed: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
    battleServerId: 'battle-local-1',
    endpoint: '127.0.0.1:7901',
    rulesetVersion: 'ruleset-local-s0',
    modeId: 'mvp_boss_race',
    playerIds: ['p1', 'p2'],
    startedAtMs: 1782489600000,
    signedBattleTicket: {
      signatureAlg: 'ed25519',
      keyId: 'client-dev-key',
      signature: new Uint8Array([9, 9, 9]),
      ticket: {
        ticketId: 'ticket-1',
        matchId: 'match-mvp-001',
        userId: 'user-alice',
        playerId: 'p1',
        modeId: 'mvp_boss_race',
        battleServerId: 'battle-local-1',
        endpoint: '127.0.0.1:7901',
        deckSnapshotHash: 'sha256:abc',
        rulesetVersion: 'ruleset-local-s0',
        ticketNonce: new Uint8Array([1, 2]),
        issuedAtMs: 1782489500000,
        expiresAtMs: 1782493100000,
        businessSessionId: 'session-dev-alice',
      },
    },
  };
  const decoded = codec.matchStart.decode(codec.matchStart.encode(message));
  expectEqual(decoded.matchId, 'match-mvp-001');
  expectEqual(decoded.endpoint, '127.0.0.1:7901');
  expectEqual(decoded.startedAtMs, 1782489600000);
  expectEqual(decoded.playerIds.length, 2);
  expectEqual(decoded.serverSeed.length, 16);
  expectEqual(decoded.serverSeed[15], 15);
  expectEqual(decoded.signedBattleTicket?.keyId, 'client-dev-key');
  expectEqual(decoded.signedBattleTicket?.ticket?.ticketId, 'ticket-1');
  expectEqual(decoded.signedBattleTicket?.ticket?.expiresAtMs, 1782493100000);
  expectEqual(decoded.signedBattleTicket?.signature.length, 3);
});

test('MatchResultMessage round-trips the int32 points map', () => {
  const message: MatchResultMessage = {
    matchId: 'match-mvp-001',
    winnerPlayerId: 'p1',
    points: { p1: 3, p2: 0 },
    replayId: 'replay-mvp-001',
    serverAuthoritative: true,
    modeId: 'mvp_boss_race',
    settledAtMs: 1782489720000,
  };
  const decoded = codec.matchResult.decode(codec.matchResult.encode(message));
  expectEqual(decoded.winnerPlayerId, 'p1');
  expectEqual(decoded.points.p1, 3);
  expectEqual(decoded.points.p2, 0);
  expectEqual(decoded.serverAuthoritative, true);
  expectEqual(decoded.replayId, 'replay-mvp-001');
});

test('BattleInput round-trips every client-authored field', () => {
  const decoded = codec.battleInput.decode(
    codec.battleInput.encode({
      matchId: 'match-mvp-001',
      playerId: 'p1',
      tick: 5400,
      seq: 42,
      directionBits: 0x5,
      slow: true,
      shoot: true,
      bomb: false,
      cardSlot: 2,
      modeActionId: 'act-1',
    }),
  );
  expectEqual(decoded.matchId, 'match-mvp-001');
  expectEqual(decoded.tick, 5400);
  expectEqual(decoded.seq, 42);
  expectEqual(decoded.directionBits, 0x5);
  expectEqual(decoded.slow, true);
  expectEqual(decoded.shoot, true);
  expectEqual(decoded.bomb, false);
  expectEqual(decoded.cardSlot, 2);
  expectEqual(decoded.modeActionId, 'act-1');
});

test('BossRaceModeState round-trips the new battle.proto messages', () => {
  const decoded = codec.bossRaceModeState.decode(
    codec.bossRaceModeState.encode({
      matchId: 'match-mvp-001',
      modeId: 'mvp_boss_race',
      tick: 5400,
      winnerPlayerId: 'p1',
      matchOver: true,
      rulesetVersion: 'ruleset-local-s0',
      players: [
        {
          playerId: 'p1',
          bossCurrentHp: 0,
          bossMaxHp: 100000,
          damageDealt: 100000,
          defeated: true,
          defeatTick: 5400,
          pointsAwarded: 3,
        },
        {
          playerId: 'p2',
          bossCurrentHp: 24000,
          bossMaxHp: 100000,
          damageDealt: 76000,
          defeated: false,
          defeatTick: 0,
          pointsAwarded: 0,
        },
      ],
    }),
  );
  expectEqual(decoded.players.length, 2);
  expectEqual(decoded.players[0].defeated, true);
  expectEqual(decoded.players[0].pointsAwarded, 3);
  expectEqual(decoded.players[1].bossCurrentHp, 24000);
  expectEqual(decoded.matchOver, true);
});

test('BattlePayloadType numbering matches battle.proto', () => {
  expectEqual(BattlePayloadType.BOSS_RACE_STATE, 10);
  expectEqual(BattlePayloadType.HANDSHAKE_HELLO, 1);
  expectEqual(BattlePayloadType.INPUT, 3);
});
