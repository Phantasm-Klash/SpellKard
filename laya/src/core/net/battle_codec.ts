/**
 * Battle-channel payload codec — the format PhK-BattleServer actually speaks.
 *
 * IMPORTANT: the dev battle server does not use protobuf on the KCP channel yet.
 * `PhK-BattleServer/src/match_lifecycle.cpp` implements a hand-rolled codec:
 *
 *   BattleInput payload (client → server)
 *     [payload_type u8 = 0x03]
 *     [protocol_version u32 LE]
 *     [match_id   u16 len + utf8]
 *     [player_id  u16 len + utf8]
 *     [tick       u64 LE]
 *     [seq        u64 LE]
 *     [direction_bits u32 LE]
 *     [flags      u8]        bit0 slow, bit1 shoot, bit2 bomb
 *     [card_slot  i8]
 *     [mode_action_id u16 len + utf8]
 *
 *   Snapshot payload (server → client)
 *     [payload_type u8 = 0x04][JSON utf-8 to end of payload]
 *
 *   Result payload (server → client)
 *     [payload_type u8 = 0x08][JSON utf-8 to end of payload]
 *
 * The protobuf `BattleEncryptedPacket` / `BattleSnapshot` messages in
 * `battle.proto` remain the long-term contract (and are mirrored in
 * `protocol/types.ts` + `protocol/codec.ts`); this module is the interim wire
 * format and is the one the client must use to interoperate today.
 *
 * Handshake: the dev server's `MatchServer::HandleSessionPayload` currently
 * decodes `BattleInput` directly and performs no handshake, so the client
 * computes the KCP conv itself (`DeriveDevKcpConv`) and starts sending inputs.
 * `encodeHandshakeHello` is provided for the proto handshake once the server
 * consumes it.
 */

import type {
  BattleHandshakeHello,
  BattleInput,
  BattlePayloadType as BattlePayloadTypeEnum,
} from '../protocol/types';
import { BattlePayloadType, emptyVersionStamp } from '../protocol/types';
import { codec } from '../protocol/codec';
import type { BossRaceBullet, BossRaceSnapshot, BossRaceState } from '../sim/boss_race';
import { BossRaceState as BossRaceStateEnum } from '../sim/boss_race';

const TEXT_ENCODER_LIMIT = 0xffff;

export class ByteWriter {
  private bytes: number[] = [];

  u8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  i8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  u16(value: number): void {
    this.bytes.push(value & 0xff, (value >> 8) & 0xff);
  }

  u32(value: number): void {
    const v = value >>> 0;
    this.bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  }

  u64(value: number): void {
    let v = Math.trunc(value);
    for (let i = 0; i < 8; i += 1) {
      this.bytes.push(v % 256);
      v = Math.floor(v / 256);
    }
  }

  string(value: string): void {
    const encoded = encodeUtf8(value);
    const length = Math.min(encoded.length, TEXT_ENCODER_LIMIT);
    this.u16(length);
    for (let i = 0; i < length; i += 1) {
      this.bytes.push(encoded[i]);
    }
  }

  raw(value: Uint8Array): void {
    for (let i = 0; i < value.length; i += 1) {
      this.bytes.push(value[i]);
    }
  }

  finish(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

export class ByteReader {
  private cursor = 0;

  constructor(private readonly data: Uint8Array) {}

  get remaining(): number {
    return this.data.length - this.cursor;
  }

  get offset(): number {
    return this.cursor;
  }

  u8(): number {
    this.require(1);
    return this.data[this.cursor++];
  }

  i8(): number {
    const value = this.u8();
    return value >= 0x80 ? value - 0x100 : value;
  }

  u16(): number {
    this.require(2);
    const value = this.data[this.cursor] | (this.data[this.cursor + 1] << 8);
    this.cursor += 2;
    return value;
  }

  u32(): number {
    this.require(4);
    const value =
      (this.data[this.cursor] |
        (this.data[this.cursor + 1] << 8) |
        (this.data[this.cursor + 2] << 16) |
        (this.data[this.cursor + 3] << 24)) >>>
      0;
    this.cursor += 4;
    return value;
  }

  u64(): number {
    this.require(8);
    let value = 0;
    let factor = 1;
    for (let i = 0; i < 8; i += 1) {
      value += this.data[this.cursor + i] * factor;
      factor *= 256;
    }
    this.cursor += 8;
    return value;
  }

  string(): string {
    const length = this.u16();
    this.require(length);
    const slice = this.data.subarray(this.cursor, this.cursor + length);
    this.cursor += length;
    return decodeUtf8(slice);
  }

  rest(): Uint8Array {
    const slice = this.data.subarray(this.cursor);
    this.cursor = this.data.length;
    return slice;
  }

  private require(count: number): void {
    if (this.cursor + count > this.data.length) {
      throw new Error('battle codec: truncated payload');
    }
  }
}

export function encodeUtf8(text: string): Uint8Array {
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
// Client → server: BattleInput
// ---------------------------------------------------------------------------

export function encodeBattleInput(input: BattleInput): Uint8Array {
  const writer = new ByteWriter();
  writer.u8(BattlePayloadType.INPUT);
  writer.u32(input.version?.protocolVersion ?? 1);
  writer.string(input.matchId);
  writer.string(input.playerId);
  writer.u64(input.tick);
  writer.u64(input.seq);
  writer.u32(input.directionBits);
  let flags = 0;
  if (input.slow) {
    flags |= 0x01;
  }
  if (input.shoot) {
    flags |= 0x02;
  }
  if (input.bomb) {
    flags |= 0x04;
  }
  writer.u8(flags);
  writer.i8(input.cardSlot);
  writer.string(input.modeActionId);
  return writer.finish();
}

export function decodeBattleInput(payload: Uint8Array): BattleInput | null {
  try {
    const reader = new ByteReader(payload);
    if (reader.u8() !== BattlePayloadType.INPUT) {
      return null;
    }
    const protocolVersion = reader.u32();
    const matchId = reader.string();
    const playerId = reader.string();
    const tick = reader.u64();
    const seq = reader.u64();
    const directionBits = reader.u32();
    const flags = reader.u8();
    const cardSlot = reader.i8();
    const modeActionId = reader.string();
    return {
      version: { ...emptyVersionStamp(), protocolVersion },
      matchId,
      playerId,
      tick,
      seq,
      directionBits,
      slow: (flags & 0x01) !== 0,
      shoot: (flags & 0x02) !== 0,
      bomb: (flags & 0x04) !== 0,
      cardSlot,
      modeActionId,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Server → client: JSON snapshot / result
// ---------------------------------------------------------------------------

function parseBossRaceState(value: string): BossRaceState {
  switch (value) {
    case 'running':
      return BossRaceStateEnum.Running;
    case 'finished':
      return BossRaceStateEnum.Finished;
    default:
      return BossRaceStateEnum.Waiting;
  }
}

export function decodeBossRaceSnapshot(payload: Uint8Array): BossRaceSnapshot | null {
  if (payload.length < 2 || payload[0] !== BattlePayloadType.SNAPSHOT) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeUtf8(payload.subarray(1)));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const source = parsed as Record<string, unknown>;
  const players = Array.isArray(source.players) ? source.players : [];
  const bullets = Array.isArray(source.bullets) ? source.bullets : [];
  return {
    tick: numberAt(source, 'tick'),
    state: parseBossRaceState(stringAt(source, 'state')),
    winnerPlayerId: stringAt(source, 'winner_player_id'),
    winnerTick: numberAt(source, 'winner_tick'),
    stateHash: stringAt(source, 'state_hash'),
    players: players.filter(isRecord).map((player) => ({
      playerId: stringAt(player, 'player_id'),
      xMilli: numberAt(player, 'x_milli'),
      yMilli: numberAt(player, 'y_milli'),
      bossCurrentHp: numberAt(player, 'boss_current_hp'),
      damageDealt: numberAt(player, 'damage_dealt'),
      connected: player.connected !== false,
    })),
    bullets: bullets.filter(isRecord).map(
      (bullet): BossRaceBullet => ({
        bulletId: stringAt(bullet, 'bullet_id'),
        ownerPlayerId: stringAt(bullet, 'owner_player_id'),
        xMilli: numberAt(bullet, 'x_milli'),
        yMilli: numberAt(bullet, 'y_milli'),
        vxMilli: numberAt(bullet, 'vx_milli'),
        vyMilli: numberAt(bullet, 'vy_milli'),
        radiusMilli: numberAt(bullet, 'radius_milli'),
        patternId: stringAt(bullet, 'pattern_id'),
      }),
    ),
  };
}

export interface BattleResultPayload {
  matchId: string;
  modeId: string;
  rulesetVersion: string;
  matchSeed: number;
  winnerPlayerId: string;
  winnerTick: number;
  stateHash: string;
  players: Array<{
    playerId: string;
    damageDealt: number;
    bossCurrentHp: number;
  }>;
}

export function decodeBattleResult(payload: Uint8Array): BattleResultPayload | null {
  if (payload.length < 2 || payload[0] !== BattlePayloadType.RESULT) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeUtf8(payload.subarray(1)));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  const players = Array.isArray(parsed.players) ? parsed.players : [];
  return {
    matchId: stringAt(parsed, 'match_id'),
    modeId: stringAt(parsed, 'mode_id'),
    rulesetVersion: stringAt(parsed, 'ruleset_version'),
    matchSeed: numberAt(parsed, 'match_seed'),
    winnerPlayerId: stringAt(parsed, 'winner_player_id'),
    winnerTick: numberAt(parsed, 'winner_tick'),
    stateHash: stringAt(parsed, 'state_hash'),
    players: players.filter(isRecord).map((player) => ({
      playerId: stringAt(player, 'player_id'),
      damageDealt: numberAt(player, 'damage_dealt'),
      bossCurrentHp: numberAt(player, 'boss_current_hp'),
    })),
  };
}

/** First byte of a battle payload, i.e. its `BattlePayloadType`. */
export function peekPayloadType(payload: Uint8Array): BattlePayloadTypeEnum {
  if (payload.length === 0) {
    return BattlePayloadType.UNSPECIFIED;
  }
  return payload[0] as BattlePayloadTypeEnum;
}

// ---------------------------------------------------------------------------
// Handshake (proto contract; not yet consumed by the dev server)
// ---------------------------------------------------------------------------

export function encodeHandshakeHello(hello: BattleHandshakeHello): Uint8Array {
  const writer = new ByteWriter();
  writer.u8(BattlePayloadType.HANDSHAKE_HELLO);
  writer.raw(codec.battleHandshakeHello.encode(hello));
  return writer.finish();
}

export function encodePingPayload(): Uint8Array {
  return new Uint8Array([BattlePayloadType.PING]);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stringAt(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value : '';
}

export function numberAt(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return 0;
}
