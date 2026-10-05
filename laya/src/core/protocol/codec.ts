/**
 * Minimal, dependency-free protobuf (proto3) codec for the `phk.v1` messages the
 * client needs on the wire.
 *
 * This is deliberately a small hand-rolled implementation rather than a
 * `protobufjs` dependency: the client must run in the browser, in LayaAir
 * native builds and under plain `tsc`/`node` tests, and the message set is
 * small and stable. Message shapes are described by a declarative spec table so
 * encode/decode stay in sync with the `.proto` field numbers.
 *
 * Scope: varint / length-delimited wire types only (all `phk.v1` fields here are
 * scalars, strings, bytes, nested messages, repeated scalars/messages, or
 * `map<string,string|int32>`). Unknown fields are skipped, so the codec tolerates
 * newer server fields.
 */

// ---------------------------------------------------------------------------
// Wire primitives
// ---------------------------------------------------------------------------

const WIRE_VARINT = 0;
const WIRE_64BIT = 1;
const WIRE_LENGTH = 2;
const WIRE_32BIT = 5;

export class ProtoWriter {
  private buf: Uint8Array = new Uint8Array(64);
  private len = 0;

  private ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) {
      return;
    }
    let next = this.buf.length * 2;
    while (next < this.len + extra) {
      next *= 2;
    }
    const grown = new Uint8Array(next);
    grown.set(this.buf.subarray(0, this.len));
    this.buf = grown;
  }

  private pushByte(value: number): void {
    this.ensure(1);
    this.buf[this.len] = value & 0xff;
    this.len += 1;
  }

  varint(value: number): void {
    let v = value < 0 ? value + 0x10000000000000000 : value;
    // Values above 2^53 cannot occur in this protocol; guard anyway.
    if (v > Number.MAX_SAFE_INTEGER) {
      v = Math.trunc(v / 2 ** 32) * 2 ** 32 + (v % 2 ** 32);
    }
    let remaining = v;
    while (remaining >= 0x80) {
      this.pushByte((remaining % 128) | 0x80);
      remaining = Math.floor(remaining / 128);
    }
    this.pushByte(remaining);
  }

  private tag(fieldNo: number, wireType: number): void {
    this.varint(fieldNo * 8 + wireType);
  }

  private lengthDelimited(fieldNo: number, bytes: Uint8Array): void {
    this.tag(fieldNo, WIRE_LENGTH);
    this.varint(bytes.length);
    this.ensure(bytes.length);
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
  }

  uint32(fieldNo: number, value: number): void {
    this.tag(fieldNo, WIRE_VARINT);
    this.varint(value >>> 0);
  }

  int32(fieldNo: number, value: number): void {
    this.tag(fieldNo, WIRE_VARINT);
    this.varint(value | 0);
  }

  int64(fieldNo: number, value: number): void {
    this.tag(fieldNo, WIRE_VARINT);
    this.varint(Math.trunc(value));
  }

  bool(fieldNo: number, value: boolean): void {
    this.tag(fieldNo, WIRE_VARINT);
    this.varint(value ? 1 : 0);
  }

  string(fieldNo: number, value: string): void {
    this.lengthDelimited(fieldNo, encodeUtf8(value));
  }

  bytes(fieldNo: number, value: Uint8Array): void {
    this.lengthDelimited(fieldNo, value);
  }

  message(fieldNo: number, encoded: Uint8Array): void {
    this.lengthDelimited(fieldNo, encoded);
  }

  finish(): Uint8Array {
    return this.buf.subarray(0, this.len).slice();
  }
}

export class ProtoReader {
  private offset = 0;

  constructor(private readonly buf: Uint8Array) {}

  get done(): boolean {
    return this.offset >= this.buf.length;
  }

  varint(): number {
    let result = 0;
    let factor = 1;
    for (;;) {
      if (this.offset >= this.buf.length) {
        throw new Error('protobuf: truncated varint');
      }
      const byte = this.buf[this.offset];
      this.offset += 1;
      result += (byte & 0x7f) * factor;
      if ((byte & 0x80) === 0) {
        break;
      }
      factor *= 128;
      if (factor > 2 ** 63) {
        throw new Error('protobuf: varint too long');
      }
    }
    return result;
  }

  tag(): { fieldNo: number; wireType: number } {
    const key = this.varint();
    return { fieldNo: Math.floor(key / 8), wireType: key % 8 };
  }

  private take(count: number): Uint8Array {
    if (this.offset + count > this.buf.length) {
      throw new Error('protobuf: truncated length-delimited field');
    }
    const slice = this.buf.subarray(this.offset, this.offset + count);
    this.offset += count;
    return slice;
  }

  lengthDelimited(): Uint8Array {
    const length = this.varint();
    return this.take(length);
  }

  string(): string {
    return decodeUtf8(this.lengthDelimited());
  }

  bytes(): Uint8Array {
    return this.lengthDelimited().slice();
  }

  /** Skip a field of the given wire type (forward compatibility). */
  skip(wireType: number): void {
    switch (wireType) {
      case WIRE_VARINT:
        this.varint();
        break;
      case WIRE_64BIT:
        this.take(8);
        break;
      case WIRE_LENGTH:
        this.lengthDelimited();
        break;
      case WIRE_32BIT:
        this.take(4);
        break;
      default:
        throw new Error(`protobuf: unsupported wire type ${wireType}`);
    }
  }
}

export function encodeUtf8(text: string): Uint8Array {
  // Manual UTF-8 encoding keeps the codec free of DOM/Node globals.
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return new Uint8Array(out);
}

export function decodeUtf8(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const byte = bytes[i];
    let code: number;
    if (byte < 0x80) {
      code = byte;
      i += 1;
    } else if ((byte & 0xe0) === 0xc0) {
      code = ((byte & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      i += 2;
    } else if ((byte & 0xf0) === 0xe0) {
      code = ((byte & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      i += 3;
    } else {
      code =
        ((byte & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      i += 4;
    }
    if (code > 0xffff) {
      code -= 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else {
      out += String.fromCharCode(code);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Declarative message specs
// ---------------------------------------------------------------------------

type FieldKind =
  | 'string'
  | 'bytes'
  | 'uint32'
  | 'int32'
  | 'int64'
  | 'bool'
  | 'enum'
  | 'message'
  | 'string[]'
  | 'message[]'
  | 'mapStrStr'
  | 'mapStrInt32';

interface FieldSpec {
  no: number;
  name: string;
  kind: FieldKind;
  /** Nested message encoder, required for `message` / `message[]`. */
  sub?: () => MessageSpec;
}

export interface MessageSpec {
  name: string;
  fields: FieldSpec[];
}

const SPECS: Record<string, MessageSpec> = {};

function define(spec: MessageSpec): MessageSpec {
  SPECS[spec.name] = spec;
  return spec;
}

// common.proto
const VERSION_STAMP = define({
  name: 'VersionStamp',
  fields: [
    { no: 1, name: 'protocolVersion', kind: 'uint32' },
    { no: 2, name: 'businessApiVersion', kind: 'string' },
    { no: 3, name: 'battleApiVersion', kind: 'string' },
    { no: 4, name: 'rulesetVersion', kind: 'string' },
    { no: 5, name: 'rulesetHash', kind: 'string' },
  ],
});

const ERROR_STATUS = define({
  name: 'ErrorStatus',
  fields: [
    { no: 1, name: 'code', kind: 'string' },
    { no: 2, name: 'message', kind: 'string' },
    { no: 3, name: 'retryable', kind: 'bool' },
  ],
});

const DECK_SNAPSHOT_REF = define({
  name: 'DeckSnapshotRef',
  fields: [
    { no: 1, name: 'deckId', kind: 'string' },
    { no: 2, name: 'deckSnapshotHash', kind: 'string' },
    { no: 3, name: 'rulesetVersion', kind: 'string' },
    { no: 4, name: 'cardIds', kind: 'string[]' },
  ],
});

const LOADOUT_REF = define({
  name: 'LoadoutRef',
  fields: [
    { no: 1, name: 'userId', kind: 'string' },
    { no: 2, name: 'playerId', kind: 'string' },
    { no: 3, name: 'characterId', kind: 'string' },
    { no: 4, name: 'stageId', kind: 'string' },
    { no: 5, name: 'ratingCode', kind: 'string' },
    { no: 6, name: 'deck', kind: 'message', sub: () => DECK_SNAPSHOT_REF },
  ],
});

const SIGNED_BLOB = define({
  name: 'SignedBlob',
  fields: [
    { no: 1, name: 'payload', kind: 'bytes' },
    { no: 2, name: 'signatureAlg', kind: 'string' },
    { no: 3, name: 'keyId', kind: 'string' },
    { no: 4, name: 'signature', kind: 'bytes' },
  ],
});

// matchmaking.proto
const BATTLE_TICKET = define({
  name: 'BattleTicket',
  fields: [
    { no: 1, name: 'version', kind: 'message', sub: () => VERSION_STAMP },
    { no: 2, name: 'ticketId', kind: 'string' },
    { no: 3, name: 'matchId', kind: 'string' },
    { no: 4, name: 'userId', kind: 'string' },
    { no: 5, name: 'playerId', kind: 'string' },
    { no: 6, name: 'modeId', kind: 'string' },
    { no: 7, name: 'battleServerId', kind: 'string' },
    { no: 8, name: 'endpoint', kind: 'string' },
    { no: 9, name: 'deckSnapshotHash', kind: 'string' },
    { no: 10, name: 'rulesetVersion', kind: 'string' },
    { no: 11, name: 'ticketNonce', kind: 'bytes' },
    { no: 12, name: 'issuedAtMs', kind: 'int64' },
    { no: 13, name: 'expiresAtMs', kind: 'int64' },
    { no: 14, name: 'businessSessionId', kind: 'string' },
  ],
});

const SIGNED_BATTLE_TICKET = define({
  name: 'SignedBattleTicket',
  fields: [
    { no: 1, name: 'ticket', kind: 'message', sub: () => BATTLE_TICKET },
    { no: 2, name: 'signatureAlg', kind: 'string' },
    { no: 3, name: 'keyId', kind: 'string' },
    { no: 4, name: 'signature', kind: 'bytes' },
  ],
});

// lobby.proto
const LOBBY_PLAYER = define({
  name: 'LobbyPlayer',
  fields: [
    { no: 1, name: 'userId', kind: 'string' },
    { no: 2, name: 'playerId', kind: 'string' },
    { no: 3, name: 'displayName', kind: 'string' },
    { no: 4, name: 'ready', kind: 'bool' },
    { no: 5, name: 'host', kind: 'bool' },
    { no: 6, name: 'connected', kind: 'bool' },
    { no: 7, name: 'characterId', kind: 'string' },
    { no: 8, name: 'loadout', kind: 'message', sub: () => LOADOUT_REF },
  ],
});

const LOBBY_PLAYER_PROFILE = define({
  name: 'LobbyPlayerProfile',
  fields: [
    { no: 1, name: 'userId', kind: 'string' },
    { no: 2, name: 'playerId', kind: 'string' },
    { no: 3, name: 'displayName', kind: 'string' },
    { no: 4, name: 'characterId', kind: 'string' },
    { no: 5, name: 'level', kind: 'uint32' },
    { no: 6, name: 'ratingCode', kind: 'string' },
    { no: 7, name: 'loadout', kind: 'message', sub: () => LOADOUT_REF },
  ],
});

const LOBBY_AUTH_REQUEST = define({
  name: 'LobbyAuthRequest',
  fields: [
    { no: 1, name: 'version', kind: 'message', sub: () => VERSION_STAMP },
    { no: 2, name: 'sessionToken', kind: 'string' },
    { no: 3, name: 'userId', kind: 'string' },
    { no: 4, name: 'platform', kind: 'string' },
    { no: 5, name: 'clientBuild', kind: 'string' },
  ],
});

const LOBBY_AUTH_RESPONSE = define({
  name: 'LobbyAuthResponse',
  fields: [
    { no: 1, name: 'version', kind: 'message', sub: () => VERSION_STAMP },
    { no: 2, name: 'sessionToken', kind: 'string' },
    { no: 3, name: 'userId', kind: 'string' },
    { no: 4, name: 'playerId', kind: 'string' },
    { no: 5, name: 'issuedAtMs', kind: 'int64' },
    { no: 6, name: 'expiresAtMs', kind: 'int64' },
    { no: 7, name: 'error', kind: 'message', sub: () => ERROR_STATUS },
  ],
});

const LOBBY_BOOTSTRAP_REQUEST = define({
  name: 'LobbyBootstrapRequest',
  fields: [
    { no: 1, name: 'version', kind: 'message', sub: () => VERSION_STAMP },
    { no: 2, name: 'sessionToken', kind: 'string' },
    { no: 3, name: 'userId', kind: 'string' },
    { no: 4, name: 'knownRulesetVersion', kind: 'string' },
  ],
});

const LOBBY_BOOTSTRAP_RESPONSE = define({
  name: 'LobbyBootstrapResponse',
  fields: [
    { no: 1, name: 'version', kind: 'message', sub: () => VERSION_STAMP },
    { no: 2, name: 'profile', kind: 'message', sub: () => LOBBY_PLAYER_PROFILE },
    { no: 3, name: 'rulesetVersion', kind: 'string' },
    { no: 4, name: 'unlockedCharacterIds', kind: 'string[]' },
    { no: 5, name: 'serverFlags', kind: 'mapStrStr' },
    { no: 6, name: 'error', kind: 'message', sub: () => ERROR_STATUS },
  ],
});

const ROOM_STATE = define({
  name: 'RoomStateMessage',
  fields: [
    { no: 1, name: 'version', kind: 'message', sub: () => VERSION_STAMP },
    { no: 2, name: 'roomCode', kind: 'string' },
    { no: 3, name: 'hostUserId', kind: 'string' },
    { no: 4, name: 'players', kind: 'message[]', sub: () => LOBBY_PLAYER },
    { no: 5, name: 'modeId', kind: 'string' },
    { no: 6, name: 'allReady', kind: 'bool' },
    { no: 7, name: 'rulesetVersion', kind: 'string' },
    { no: 8, name: 'modeParams', kind: 'mapStrStr' },
  ],
});

const ROOM_CREATE_REQUEST = define({
  name: 'RoomCreateRequest',
  fields: [
    { no: 1, name: 'version', kind: 'message', sub: () => VERSION_STAMP },
    { no: 2, name: 'roomCode', kind: 'string' },
    { no: 3, name: 'modeId', kind: 'string' },
    { no: 4, name: 'hostUserId', kind: 'string' },
    { no: 5, name: 'loadout', kind: 'message', sub: () => LOADOUT_REF },
    { no: 6, name: 'modeParams', kind: 'mapStrStr' },
  ],
});

const ROOM_CREATE_RESPONSE = define({
  name: 'RoomCreateResponse',
  fields: [
    { no: 1, name: 'version', kind: 'message', sub: () => VERSION_STAMP },
    { no: 2, name: 'roomCode', kind: 'string' },
    { no: 3, name: 'modeId', kind: 'string' },
    { no: 4, name: 'hostUserId', kind: 'string' },
    { no: 5, name: 'room', kind: 'message', sub: () => ROOM_STATE },
    { no: 6, name: 'error', kind: 'message', sub: () => ERROR_STATUS },
  ],
});

const ROOM_JOIN_REQUEST = define({
  name: 'RoomJoinRequest',
  fields: [
    { no: 1, name: 'version', kind: 'message', sub: () => VERSION_STAMP },
    { no: 2, name: 'roomCode', kind: 'string' },
    { no: 3, name: 'userId', kind: 'string' },
    { no: 4, name: 'playerId', kind: 'string' },
    { no: 5, name: 'loadout', kind: 'message', sub: () => LOADOUT_REF },
  ],
});

const ROOM_JOIN_RESPONSE = define({
  name: 'RoomJoinResponse',
  fields: [
    { no: 1, name: 'version', kind: 'message', sub: () => VERSION_STAMP },
    { no: 2, name: 'roomCode', kind: 'string' },
    { no: 3, name: 'modeId', kind: 'string' },
    { no: 4, name: 'hostUserId', kind: 'string' },
    { no: 5, name: 'players', kind: 'message[]', sub: () => LOBBY_PLAYER },
    { no: 6, name: 'room', kind: 'message', sub: () => ROOM_STATE },
    { no: 7, name: 'error', kind: 'message', sub: () => ERROR_STATUS },
  ],
});

const ROOM_LEAVE_REQUEST = define({
  name: 'RoomLeaveRequest',
  fields: [
    { no: 1, name: 'version', kind: 'message', sub: () => VERSION_STAMP },
    { no: 2, name: 'roomCode', kind: 'string' },
    { no: 3, name: 'userId', kind: 'string' },
    { no: 4, name: 'playerId', kind: 'string' },
    { no: 5, name: 'reason', kind: 'string' },
  ],
});

const MATCH_START = define({
  name: 'MatchStartMessage',
  fields: [
    { no: 1, name: 'version', kind: 'message', sub: () => VERSION_STAMP },
    { no: 2, name: 'matchId', kind: 'string' },
    { no: 3, name: 'serverSeed', kind: 'bytes' },
    { no: 4, name: 'battleServerId', kind: 'string' },
    { no: 5, name: 'endpoint', kind: 'string' },
    { no: 6, name: 'signedBattleTicket', kind: 'message', sub: () => SIGNED_BATTLE_TICKET },
    { no: 7, name: 'rulesetVersion', kind: 'string' },
    { no: 8, name: 'modeId', kind: 'string' },
    { no: 9, name: 'playerIds', kind: 'string[]' },
    { no: 10, name: 'startedAtMs', kind: 'int64' },
  ],
});

const MATCH_RESULT = define({
  name: 'MatchResultMessage',
  fields: [
    { no: 1, name: 'version', kind: 'message', sub: () => VERSION_STAMP },
    { no: 2, name: 'matchId', kind: 'string' },
    { no: 3, name: 'winnerPlayerId', kind: 'string' },
    { no: 4, name: 'points', kind: 'mapStrInt32' },
    { no: 5, name: 'replayId', kind: 'string' },
    { no: 6, name: 'serverAuthoritative', kind: 'bool' },
    { no: 7, name: 'modeId', kind: 'string' },
    { no: 8, name: 'settledAtMs', kind: 'int64' },
  ],
});

// battle.proto
const BATTLE_PACKET_HEADER = define({
  name: 'BattlePacketHeader',
  fields: [
    { no: 1, name: 'version', kind: 'message', sub: () => VERSION_STAMP },
    { no: 2, name: 'matchId', kind: 'string' },
    { no: 3, name: 'playerId', kind: 'string' },
    { no: 4, name: 'tick', kind: 'uint32' },
    { no: 5, name: 'seq', kind: 'uint32' },
    { no: 6, name: 'ack', kind: 'uint32' },
    { no: 7, name: 'payloadType', kind: 'enum' },
    { no: 8, name: 'keyId', kind: 'string' },
    { no: 9, name: 'nonce', kind: 'bytes' },
  ],
});

const BATTLE_HANDSHAKE_HELLO = define({
  name: 'BattleHandshakeHello',
  fields: [
    { no: 1, name: 'version', kind: 'message', sub: () => VERSION_STAMP },
    { no: 2, name: 'battleTicket', kind: 'message', sub: () => SIGNED_BATTLE_TICKET },
    { no: 3, name: 'clientX25519Pub', kind: 'bytes' },
    { no: 4, name: 'clientRandom', kind: 'bytes' },
    { no: 5, name: 'supportedAead', kind: 'string[]' },
  ],
});

const BATTLE_HANDSHAKE_ACCEPT = define({
  name: 'BattleHandshakeAccept',
  fields: [
    { no: 1, name: 'version', kind: 'message', sub: () => VERSION_STAMP },
    { no: 2, name: 'matchId', kind: 'string' },
    { no: 3, name: 'playerId', kind: 'string' },
    { no: 4, name: 'serverX25519Pub', kind: 'bytes' },
    { no: 5, name: 'serverRandom', kind: 'bytes' },
    { no: 6, name: 'selectedAead', kind: 'string' },
    { no: 7, name: 'kcpConv', kind: 'uint32' },
    { no: 8, name: 'keyId', kind: 'string' },
    { no: 9, name: 'transcriptHash', kind: 'bytes' },
    { no: 10, name: 'serverSignature', kind: 'message', sub: () => SIGNED_BLOB },
  ],
});

const BATTLE_INPUT = define({
  name: 'BattleInput',
  fields: [
    { no: 1, name: 'version', kind: 'message', sub: () => VERSION_STAMP },
    { no: 2, name: 'matchId', kind: 'string' },
    { no: 3, name: 'playerId', kind: 'string' },
    { no: 4, name: 'tick', kind: 'uint32' },
    { no: 5, name: 'seq', kind: 'uint32' },
    { no: 6, name: 'directionBits', kind: 'uint32' },
    { no: 7, name: 'slow', kind: 'bool' },
    { no: 8, name: 'shoot', kind: 'bool' },
    { no: 9, name: 'bomb', kind: 'bool' },
    { no: 10, name: 'cardSlot', kind: 'int32' },
    { no: 11, name: 'modeActionId', kind: 'string' },
  ],
});

const BATTLE_MODE_ACTION = define({
  name: 'BattleModeAction',
  fields: [
    { no: 1, name: 'version', kind: 'message', sub: () => VERSION_STAMP },
    { no: 2, name: 'matchId', kind: 'string' },
    { no: 3, name: 'playerId', kind: 'string' },
    { no: 4, name: 'tick', kind: 'uint32' },
    { no: 5, name: 'seq', kind: 'uint32' },
    { no: 6, name: 'actionId', kind: 'string' },
    { no: 7, name: 'actionType', kind: 'string' },
    { no: 8, name: 'payloadJson', kind: 'bytes' },
    { no: 9, name: 'clientResultAuthoritative', kind: 'bool' },
  ],
});

const BATTLE_PLAYER_SNAPSHOT = define({
  name: 'BattlePlayerSnapshot',
  fields: [
    { no: 1, name: 'playerId', kind: 'string' },
    { no: 2, name: 'xMilli', kind: 'int32' },
    { no: 3, name: 'yMilli', kind: 'int32' },
    { no: 4, name: 'connected', kind: 'bool' },
    { no: 5, name: 'handSize', kind: 'uint32' },
  ],
});

const BATTLE_BULLET_DELTA = define({
  name: 'BattleBulletDelta',
  fields: [
    { no: 1, name: 'bulletId', kind: 'string' },
    { no: 2, name: 'op', kind: 'string' },
    { no: 3, name: 'xMilli', kind: 'int32' },
    { no: 4, name: 'yMilli', kind: 'int32' },
    { no: 5, name: 'vxMilli', kind: 'int32' },
    { no: 6, name: 'vyMilli', kind: 'int32' },
    { no: 7, name: 'radiusMilli', kind: 'uint32' },
    { no: 8, name: 'patternId', kind: 'string' },
    { no: 9, name: 'color', kind: 'string' },
  ],
});

const BATTLE_SNAPSHOT = define({
  name: 'BattleSnapshot',
  fields: [
    { no: 1, name: 'version', kind: 'message', sub: () => VERSION_STAMP },
    { no: 2, name: 'matchId', kind: 'string' },
    { no: 3, name: 'snapshotTick', kind: 'uint32' },
    { no: 4, name: 'snapshotKind', kind: 'string' },
    { no: 5, name: 'stateHash', kind: 'string' },
    { no: 6, name: 'players', kind: 'message[]', sub: () => BATTLE_PLAYER_SNAPSHOT },
    { no: 7, name: 'bulletsDelta', kind: 'message[]', sub: () => BATTLE_BULLET_DELTA },
    { no: 8, name: 'modeState', kind: 'mapStrStr' },
    { no: 9, name: 'eventCursor', kind: 'uint32' },
  ],
});

const BATTLE_EVENT = define({
  name: 'BattleEvent',
  fields: [
    { no: 1, name: 'version', kind: 'message', sub: () => VERSION_STAMP },
    { no: 2, name: 'matchId', kind: 'string' },
    { no: 3, name: 'cursor', kind: 'uint32' },
    { no: 4, name: 'tick', kind: 'uint32' },
    { no: 5, name: 'type', kind: 'string' },
    { no: 6, name: 'playerId', kind: 'string' },
    { no: 7, name: 'payloadJson', kind: 'bytes' },
    { no: 8, name: 'serverAuthoritative', kind: 'bool' },
  ],
});

const BOSS_RACE_PLAYER_STATE = define({
  name: 'BossRacePlayerState',
  fields: [
    { no: 1, name: 'playerId', kind: 'string' },
    { no: 2, name: 'bossCurrentHp', kind: 'int32' },
    { no: 3, name: 'bossMaxHp', kind: 'int32' },
    { no: 4, name: 'damageDealt', kind: 'int64' },
    { no: 5, name: 'defeated', kind: 'bool' },
    { no: 6, name: 'defeatTick', kind: 'uint32' },
    { no: 7, name: 'pointsAwarded', kind: 'int32' },
  ],
});

const BOSS_RACE_MODE_STATE = define({
  name: 'BossRaceModeState',
  fields: [
    { no: 1, name: 'version', kind: 'message', sub: () => VERSION_STAMP },
    { no: 2, name: 'matchId', kind: 'string' },
    { no: 3, name: 'modeId', kind: 'string' },
    { no: 4, name: 'tick', kind: 'uint32' },
    { no: 5, name: 'players', kind: 'message[]', sub: () => BOSS_RACE_PLAYER_STATE },
    { no: 6, name: 'winnerPlayerId', kind: 'string' },
    { no: 7, name: 'matchOver', kind: 'bool' },
    { no: 8, name: 'rulesetVersion', kind: 'string' },
  ],
});

// ---------------------------------------------------------------------------
// Generic encode / decode
// ---------------------------------------------------------------------------

type AnyMessage = Record<string, unknown>;

export function encodeMessage(spec: MessageSpec, message: AnyMessage): Uint8Array {
  const writer = new ProtoWriter();
  for (const field of spec.fields) {
    const value = message[field.name];
    if (value === undefined || value === null) {
      continue;
    }
    writeField(writer, field, value);
  }
  return writer.finish();
}

function writeField(writer: ProtoWriter, field: FieldSpec, value: unknown): void {
  switch (field.kind) {
    case 'string':
      if (value !== '') {
        writer.string(field.no, String(value));
      }
      break;
    case 'bytes':
      if ((value as Uint8Array).length > 0) {
        writer.bytes(field.no, value as Uint8Array);
      }
      break;
    case 'uint32':
    case 'enum':
      if (Number(value) !== 0) {
        writer.uint32(field.no, Number(value));
      }
      break;
    case 'int32':
      if (Number(value) !== 0) {
        writer.int32(field.no, Number(value));
      }
      break;
    case 'int64':
      if (Number(value) !== 0) {
        writer.int64(field.no, Number(value));
      }
      break;
    case 'bool':
      if (value === true) {
        writer.bool(field.no, true);
      }
      break;
    case 'message': {
      const sub = requireSub(field);
      writer.message(field.no, encodeMessage(sub, value as AnyMessage));
      break;
    }
    case 'string[]':
      for (const item of value as string[]) {
        writer.string(field.no, item);
      }
      break;
    case 'message[]': {
      const sub = requireSub(field);
      for (const item of value as AnyMessage[]) {
        writer.message(field.no, encodeMessage(sub, item));
      }
      break;
    }
    case 'mapStrStr': {
      const entries = Object.entries(value as Record<string, string>);
      for (const [key, entryValue] of entries) {
        const nested = new ProtoWriter();
        nested.string(1, key);
        nested.string(2, entryValue);
        writer.message(field.no, nested.finish());
      }
      break;
    }
    case 'mapStrInt32': {
      const entries = Object.entries(value as Record<string, number>);
      for (const [key, entryValue] of entries) {
        const nested = new ProtoWriter();
        nested.string(1, key);
        nested.int32(2, entryValue);
        writer.message(field.no, nested.finish());
      }
      break;
    }
    default:
      throw new Error(`protobuf: unsupported field kind ${String(field.kind)}`);
  }
}

export function decodeMessage<T extends AnyMessage>(spec: MessageSpec, data: Uint8Array): T {
  const reader = new ProtoReader(data);
  const out: AnyMessage = {};
  while (!reader.done) {
    const { fieldNo, wireType } = reader.tag();
    const field = spec.fields.find((candidate) => candidate.no === fieldNo);
    if (field === undefined) {
      reader.skip(wireType);
      continue;
    }
    readField(reader, field, out);
  }
  applyProto3Defaults(spec, out);
  return out as T;
}

/**
 * Fills proto3 scalar/collection defaults for absent fields.
 *
 * On the wire proto3 omits default values, so a decoded `ready: false` arrives
 * as "field absent". Populating the defaults here means callers get fully-typed
 * objects instead of `undefined`, while `message`/`bytes` stay optional because
 * their presence is meaningful.
 */
function applyProto3Defaults(spec: MessageSpec, out: AnyMessage): void {
  for (const field of spec.fields) {
    if (out[field.name] !== undefined) {
      continue;
    }
    switch (field.kind) {
      case 'string':
        out[field.name] = '';
        break;
      case 'uint32':
      case 'int32':
      case 'int64':
      case 'enum':
        out[field.name] = 0;
        break;
      case 'bool':
        out[field.name] = false;
        break;
      case 'string[]':
      case 'message[]':
        out[field.name] = [];
        break;
      case 'mapStrStr':
      case 'mapStrInt32':
        out[field.name] = {};
        break;
      default:
        // `message` and `bytes` remain absent when not present.
        break;
    }
  }
}

function readField(reader: ProtoReader, field: FieldSpec, out: AnyMessage): void {
  switch (field.kind) {
    case 'string':
      out[field.name] = reader.string();
      break;
    case 'bytes':
      out[field.name] = reader.bytes();
      break;
    case 'uint32':
    case 'enum':
    case 'int32':
    case 'int64':
      out[field.name] = reader.varint();
      break;
    case 'bool':
      out[field.name] = reader.varint() !== 0;
      break;
    case 'message': {
      const sub = requireSub(field);
      out[field.name] = decodeMessage(sub, reader.lengthDelimited());
      break;
    }
    case 'string[]': {
      const list = (out[field.name] as string[] | undefined) ?? [];
      list.push(reader.string());
      out[field.name] = list;
      break;
    }
    case 'message[]': {
      const sub = requireSub(field);
      const list = (out[field.name] as AnyMessage[] | undefined) ?? [];
      list.push(decodeMessage(sub, reader.lengthDelimited()));
      out[field.name] = list;
      break;
    }
    case 'mapStrStr': {
      const nested = decodeMessage({ name: 'map', fields: MAP_ENTRY_FIELDS }, reader.lengthDelimited());
      const map = (out[field.name] as Record<string, string> | undefined) ?? {};
      map[String(nested.key ?? '')] = String(nested.value ?? '');
      out[field.name] = map;
      break;
    }
    case 'mapStrInt32': {
      const nested = decodeMessage({ name: 'map', fields: MAP_ENTRY_INT_FIELDS }, reader.lengthDelimited());
      const map = (out[field.name] as Record<string, number> | undefined) ?? {};
      map[String(nested.key ?? '')] = Number(nested.value ?? 0);
      out[field.name] = map;
      break;
    }
    default:
      throw new Error(`protobuf: unsupported field kind ${String(field.kind)}`);
  }
}

const MAP_ENTRY_FIELDS: FieldSpec[] = [
  { no: 1, name: 'key', kind: 'string' },
  { no: 2, name: 'value', kind: 'string' },
];

const MAP_ENTRY_INT_FIELDS: FieldSpec[] = [
  { no: 1, name: 'key', kind: 'string' },
  { no: 2, name: 'value', kind: 'int32' },
];

function requireSub(field: FieldSpec): MessageSpec {
  if (field.sub === undefined) {
    throw new Error(`protobuf: field ${field.name} is missing a nested spec`);
  }
  return field.sub();
}

// ---------------------------------------------------------------------------
// Public per-message helpers
// ---------------------------------------------------------------------------

import type {
  BattleHandshakeAccept,
  BattleHandshakeHello,
  BattleInput,
  BattleModeAction,
  BattlePacketHeader,
  BattleSnapshot,
  BossRaceModeState,
  LobbyAuthRequest,
  LobbyAuthResponse,
  LobbyBootstrapRequest,
  LobbyBootstrapResponse,
  MatchResultMessage,
  MatchStartMessage,
  RoomCreateRequest,
  RoomCreateResponse,
  RoomJoinRequest,
  RoomJoinResponse,
  RoomLeaveRequest,
  RoomStateMessage,
  VersionStamp,
} from './types';

export const codec = {
  versionStamp: {
    encode: (message: VersionStamp) => encodeMessage(VERSION_STAMP, message as unknown as AnyMessage),
    decode: (data: Uint8Array) => decodeMessage<VersionStamp & AnyMessage>(VERSION_STAMP, data),
  },
  lobbyAuthRequest: {
    encode: (message: LobbyAuthRequest) => encodeMessage(LOBBY_AUTH_REQUEST, message as unknown as AnyMessage),
    decode: (data: Uint8Array) => decodeMessage<LobbyAuthRequest & AnyMessage>(LOBBY_AUTH_REQUEST, data),
  },
  lobbyAuthResponse: {
    encode: (message: LobbyAuthResponse) => encodeMessage(LOBBY_AUTH_RESPONSE, message as unknown as AnyMessage),
    decode: (data: Uint8Array) => decodeMessage<LobbyAuthResponse & AnyMessage>(LOBBY_AUTH_RESPONSE, data),
  },
  lobbyBootstrapRequest: {
    encode: (message: LobbyBootstrapRequest) =>
      encodeMessage(LOBBY_BOOTSTRAP_REQUEST, message as unknown as AnyMessage),
    decode: (data: Uint8Array) => decodeMessage<LobbyBootstrapRequest & AnyMessage>(LOBBY_BOOTSTRAP_REQUEST, data),
  },
  lobbyBootstrapResponse: {
    encode: (message: LobbyBootstrapResponse) =>
      encodeMessage(LOBBY_BOOTSTRAP_RESPONSE, message as unknown as AnyMessage),
    decode: (data: Uint8Array) => decodeMessage<LobbyBootstrapResponse & AnyMessage>(LOBBY_BOOTSTRAP_RESPONSE, data),
  },
  roomCreateRequest: {
    encode: (message: RoomCreateRequest) => encodeMessage(ROOM_CREATE_REQUEST, message as unknown as AnyMessage),
    decode: (data: Uint8Array) => decodeMessage<RoomCreateRequest & AnyMessage>(ROOM_CREATE_REQUEST, data),
  },
  roomCreateResponse: {
    encode: (message: RoomCreateResponse) => encodeMessage(ROOM_CREATE_RESPONSE, message as unknown as AnyMessage),
    decode: (data: Uint8Array) => decodeMessage<RoomCreateResponse & AnyMessage>(ROOM_CREATE_RESPONSE, data),
  },
  roomJoinRequest: {
    encode: (message: RoomJoinRequest) => encodeMessage(ROOM_JOIN_REQUEST, message as unknown as AnyMessage),
    decode: (data: Uint8Array) => decodeMessage<RoomJoinRequest & AnyMessage>(ROOM_JOIN_REQUEST, data),
  },
  roomJoinResponse: {
    encode: (message: RoomJoinResponse) => encodeMessage(ROOM_JOIN_RESPONSE, message as unknown as AnyMessage),
    decode: (data: Uint8Array) => decodeMessage<RoomJoinResponse & AnyMessage>(ROOM_JOIN_RESPONSE, data),
  },
  roomLeaveRequest: {
    encode: (message: RoomLeaveRequest) => encodeMessage(ROOM_LEAVE_REQUEST, message as unknown as AnyMessage),
    decode: (data: Uint8Array) => decodeMessage<RoomLeaveRequest & AnyMessage>(ROOM_LEAVE_REQUEST, data),
  },
  roomState: {
    encode: (message: RoomStateMessage) => encodeMessage(ROOM_STATE, message as unknown as AnyMessage),
    decode: (data: Uint8Array) => decodeMessage<RoomStateMessage & AnyMessage>(ROOM_STATE, data),
  },
  matchStart: {
    encode: (message: MatchStartMessage) => encodeMessage(MATCH_START, message as unknown as AnyMessage),
    decode: (data: Uint8Array) => decodeMessage<MatchStartMessage & AnyMessage>(MATCH_START, data),
  },
  matchResult: {
    encode: (message: MatchResultMessage) => encodeMessage(MATCH_RESULT, message as unknown as AnyMessage),
    decode: (data: Uint8Array) => decodeMessage<MatchResultMessage & AnyMessage>(MATCH_RESULT, data),
  },
  battlePacketHeader: {
    encode: (message: BattlePacketHeader) => encodeMessage(BATTLE_PACKET_HEADER, message as unknown as AnyMessage),
    decode: (data: Uint8Array) => decodeMessage<BattlePacketHeader & AnyMessage>(BATTLE_PACKET_HEADER, data),
  },
  battleHandshakeHello: {
    encode: (message: BattleHandshakeHello) => encodeMessage(BATTLE_HANDSHAKE_HELLO, message as unknown as AnyMessage),
    decode: (data: Uint8Array) => decodeMessage<BattleHandshakeHello & AnyMessage>(BATTLE_HANDSHAKE_HELLO, data),
  },
  battleHandshakeAccept: {
    encode: (message: BattleHandshakeAccept) =>
      encodeMessage(BATTLE_HANDSHAKE_ACCEPT, message as unknown as AnyMessage),
    decode: (data: Uint8Array) => decodeMessage<BattleHandshakeAccept & AnyMessage>(BATTLE_HANDSHAKE_ACCEPT, data),
  },
  battleInput: {
    encode: (message: BattleInput) => encodeMessage(BATTLE_INPUT, message as unknown as AnyMessage),
    decode: (data: Uint8Array) => decodeMessage<BattleInput & AnyMessage>(BATTLE_INPUT, data),
  },
  battleModeAction: {
    encode: (message: BattleModeAction) => encodeMessage(BATTLE_MODE_ACTION, message as unknown as AnyMessage),
    decode: (data: Uint8Array) => decodeMessage<BattleModeAction & AnyMessage>(BATTLE_MODE_ACTION, data),
  },
  battleSnapshot: {
    encode: (message: BattleSnapshot) => encodeMessage(BATTLE_SNAPSHOT, message as unknown as AnyMessage),
    decode: (data: Uint8Array) => decodeMessage<BattleSnapshot & AnyMessage>(BATTLE_SNAPSHOT, data),
  },
  bossRaceModeState: {
    encode: (message: BossRaceModeState) => encodeMessage(BOSS_RACE_MODE_STATE, message as unknown as AnyMessage),
    decode: (data: Uint8Array) => decodeMessage<BossRaceModeState & AnyMessage>(BOSS_RACE_MODE_STATE, data),
  },
};

export { BATTLE_EVENT };
