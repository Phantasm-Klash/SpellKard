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
 *     [card block]            optional, only when a card field is non-default:
 *                             [magic u8 = 0x43 'C'][card_draw u8][card_select i8][card_use u8]
 *     [ticket block]          optional, unchanged (presence byte 0/1 + fields)
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
  BattleEncryptedPacket,
  BattleHandshakeAccept,
  BattleHandshakeHello,
  BattleInput,
  BattlePayloadType as BattlePayloadTypeEnum,
} from '../protocol/types';
import { BattlePayloadType, emptyVersionStamp } from '../protocol/types';
import { codec } from '../protocol/codec';
import type { BossRaceBullet, BossRaceSnapshot, BossRaceState } from '../sim/boss_race';
import { BossRaceState as BossRaceStateEnum } from '../sim/boss_race';
import type { CoopBossBullet, CoopBossPlayerSnapshot, CoopBossSnapshot } from '../sim/coop_boss';
import { CoopBossState as CoopBossStateEnum } from '../sim/coop_boss';

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

  /** Next byte without consuming it (0 past the end). */
  peekU8(): number {
    return this.cursor < this.data.length ? this.data[this.cursor] : 0;
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

/**
 * Magic byte that opens the optional draw/select/use block (§2.3).
 *
 * Mirrors `kCardBlockMagic` in the server's `match_lifecycle.cpp`. It is `0x43`
 * (`'C'`) precisely because the optional ticket block that may follow the input
 * body starts with a presence byte of `0` or `1` — a legacy frame can therefore
 * never be mistaken for a card block, and an old server reading a new frame
 * never sees its ticket presence byte shifted.
 */
const CARD_BLOCK_MAGIC = 0x43;

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
  // Card block: written only when a field is non-default, so an ordinary input
  // frame stays byte-for-byte identical to the pre-§2.3 wire.
  const cardSelect = input.cardSelect ?? -1;
  if (input.cardDraw === true || cardSelect !== -1 || input.cardUse === true) {
    writer.u8(CARD_BLOCK_MAGIC);
    writer.u8(input.cardDraw === true ? 1 : 0);
    writer.i8(cardSelect);
    writer.u8(input.cardUse === true ? 1 : 0);
  }
  return writer.finish();
}

/** `1` = a ticket block follows the input body (the server's present flag). */
const TICKET_BLOCK_PRESENT = 1;

/**
 * Appends the signed battle ticket to an input frame, byte-for-byte with the
 * server's `EncodeBattleInputWithTicketPayload` (field order frozen there).
 *
 * The battle server binds a session to the **first** input that carries the
 * ticket; without it the app path only logs `reason=ticket_missing` and the
 * `.dem` header keeps an empty `players[].user_id`, so the recording cannot say
 * which account played. The payload is the `battle.ticket` response: the ticket
 * object (nested under `ticket`, or the payload itself) plus the signature
 * fields at the top level. Every field is written, an absent one as empty, so
 * the server's decode still succeeds and falls back to its own checks.
 */
export function encodeBattleInputWithTicket(
  input: BattleInput,
  raw: Record<string, unknown>,
): Uint8Array {
  const base = encodeBattleInput(input);
  const ticket = isRecord(raw.ticket) ? raw.ticket : raw;
  const version = isRecord(ticket.version) ? ticket.version : {};
  const writer = new ByteWriter();
  writer.u8(TICKET_BLOCK_PRESENT);
  const protocolVersion = ticketNumber(version, 'protocol_version', 'protocolVersion');
  writer.u32(protocolVersion > 0 ? protocolVersion : 1);
  writer.string(ticketString(version, 'business_api_version', 'businessApiVersion'));
  writer.string(ticketString(version, 'battle_api_version', 'battleApiVersion'));
  writer.string(ticketString(version, 'ruleset_version', 'rulesetVersion'));
  writer.string(ticketString(ticket, 'ticket_id', 'ticketId'));
  writer.string(ticketString(ticket, 'match_id', 'matchId'));
  writer.string(ticketString(ticket, 'user_id', 'userId'));
  writer.string(ticketString(ticket, 'player_id', 'playerId'));
  writer.string(ticketString(ticket, 'mode_id', 'modeId'));
  writer.string(ticketString(ticket, 'battle_server_id', 'battleServerId'));
  writer.string(ticketString(ticket, 'endpoint'));
  writer.string(ticketString(ticket, 'deck_snapshot_hash', 'deckSnapshotHash'));
  writer.string(ticketString(ticket, 'ruleset_version', 'rulesetVersion'));
  writer.string(ticketString(ticket, 'ticket_nonce_hex', 'ticketNonceHex'));
  writer.u64(ticketNumber(ticket, 'issued_at_ms', 'issuedAtMs'));
  writer.u64(ticketNumber(ticket, 'expires_at_ms', 'expiresAtMs'));
  writer.string(ticketString(ticket, 'business_session_id', 'businessSessionId'));
  const handCards = ticketStringArray(ticket, 'hand_card_ids', 'handCardIds');
  writer.u32(handCards.length);
  for (const cardId of handCards) {
    writer.string(cardId);
  }
  const deckCards = ticketStringArray(ticket, 'deck_card_ids', 'deckCardIds');
  writer.u32(deckCards.length);
  for (const cardId of deckCards) {
    writer.string(cardId);
  }
  // Doubles travel as decimal text on this wire (the server's `%.17g`); JS's
  // shortest round-trip form parses back to the same value through `strtod`.
  writer.string(String(ticketNumber(ticket, 'initial_energy', 'initialEnergy')));
  writer.string(ticketString(ticket, 'server_seed', 'serverSeedDecimal'));
  writer.string(ticketString(raw, 'signature_alg', 'signatureAlg'));
  writer.string(ticketString(raw, 'key_id', 'keyId'));
  writer.string(ticketString(raw, 'signature', 'signatureHex'));
  writer.string(ticketString(raw, 'public_key_hex', 'publicKeyHex'));
  writer.u8(raw.server_authoritative === false ? 0 : 1);
  const block = writer.finish();
  const out = new Uint8Array(base.length + block.length);
  out.set(base, 0);
  out.set(block, base.length);
  return out;
}

/** First present string among the keys (snake_case wins over camelCase). */
function ticketString(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return '';
}

/** First finite number among the keys, or 0 when none is present. */
function ticketNumber(source: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value !== '' && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return 0;
}

/** A string array field, or an empty list when absent or of another type. */
function ticketStringArray(source: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string');
    }
  }
  return [];
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
    // Card block (§2.3). Absent on legacy frames, and absent when an old client
    // sent its ticket block instead — that block's presence byte is 0/1, never
    // the magic. Fewer than 4 trailing bytes can never be a complete block.
    let cardDraw: boolean | undefined;
    let cardSelect: number | undefined;
    let cardUse: boolean | undefined;
    if (reader.peekU8() === CARD_BLOCK_MAGIC) {
      // Server parity: the C++ `ReadBattleInputBody`
      // (`PhK-BattleServer/src/match_lifecycle.cpp`) hard-fails a magic byte
      // that is not followed by its three payload bytes, so a truncated card
      // block is a malformed frame here too — never a legacy input whose tail
      // is silently dropped (the server would have rejected the frame).
      if (reader.remaining < 4) {
        return null;
      }
      reader.u8();
      cardDraw = reader.u8() !== 0;
      cardSelect = reader.i8();
      cardUse = reader.u8() !== 0;
    }
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
      cardDraw,
      cardSelect,
      cardUse,
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
      // §2.8 增补：老服务端不发 → `undefined`，调用方按缺省处理。
      vxMilli: optionalNumberAt(player, 'vx_milli'),
      vyMilli: optionalNumberAt(player, 'vy_milli'),
      facingMillideg: optionalNumberAt(player, 'facing_millideg'),
      lives: optionalNumberAt(player, 'lives'),
      bombs: optionalNumberAt(player, 'bombs'),
      invulnerableUntilTick: optionalNumberAt(player, 'invulnerable_until_tick'),
      graze: optionalNumberAt(player, 'graze'),
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
        // ★ The reverse-engineered danmaku extensions. Without these the renderer
        // can only draw a generic bullet — `describeBulletKind` needs the
        // `kEnemyBullet` value to pick the real atlas frame, and the motion func
        // number to pick the orientation family.
        bulletKind: optionalNumberAt(bullet, 'bullet_kind'),
        motionFunc: optionalNumberAt(bullet, 'motion_func'),
        // §2.8 chain/hidden extensions.
        chainId: optionalWireStringAt(bullet, 'chain_id'),
        generation: optionalNumberAt(bullet, 'generation'),
        hidden: optionalBoolAt(bullet, 'hidden'),
      }),
    ),
    ...parseSnapshotExtensions(source),
  };
}

/**
 * §2.8 的共用尾部字段（race 与 coop 同一套 schema）。
 *
 * 全部可选：老服务端一个字段都不发时，返回对象里的键值为 `undefined`，
 * 解析不会抛、也不会把缺省值伪装成真实数据。
 */
function parseSnapshotExtensions(source: Record<string, unknown>): {
  boss?: BossWireState;
  chains?: BossWireChain[];
  hand?: BossWireCard[];
  deckRemaining?: number;
  drawCooldownTicks?: number;
  events?: BossWireEvent[];
  eventCursor?: number;
} {
  return {
    boss: parseBossWireState(source.boss),
    chains: parseChainList(source.chains),
    hand: parseHandList(source.hand),
    deckRemaining: optionalNumberAt(source, 'deck_remaining'),
    drawCooldownTicks: optionalNumberAt(source, 'draw_cooldown_ticks'),
    events: parseEventList(source.events),
    eventCursor: optionalNumberAt(source, 'event_cursor'),
  };
}

/** 结构上与 `BossRaceBossState` / `CoopBossBossState` 同形（两边共用）。 */
export interface BossWireState {
  xMilli: number;
  yMilli: number;
  hp: number;
  maxHp: number;
  phase: number;
  movement?: { type: string; phaseT: number };
  effects: BossWireEffect[];
}

export interface BossWireEffect {
  type: string;
  state: string;
  tRemaining: number;
  x0Milli?: number;
  y0Milli?: number;
  dxMilli?: number;
  dyMilli?: number;
  lengthMilli?: number;
  edgeYMilli?: number;
}

export interface BossWireChain {
  chainId: string;
  patternIndex: number;
  nodeId: number;
  generation: number;
  rngCursor: number;
}

export interface BossWireCard {
  cardId: string;
  slot: number;
  selected: boolean;
}

export interface BossWireEvent {
  tick: number;
  type: string;
  playerId: string;
  data: Record<string, unknown>;
}

function parseBossWireState(value: unknown): BossWireState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const movementSource = value.movement;
  const effects = Array.isArray(value.effects) ? value.effects.filter(isRecord) : [];
  return {
    xMilli: numberAt(value, 'x_milli'),
    yMilli: numberAt(value, 'y_milli'),
    hp: numberAt(value, 'hp'),
    maxHp: numberAt(value, 'max_hp'),
    phase: numberAt(value, 'phase'),
    movement: isRecord(movementSource)
      ? { type: stringAt(movementSource, 'type'), phaseT: numberAt(movementSource, 'phase_t') }
      : undefined,
    effects: effects.map((effect): BossWireEffect => ({
      type: stringAt(effect, 'type'),
      state: stringAt(effect, 'state'),
      tRemaining: numberAt(effect, 't_remaining'),
      x0Milli: optionalNumberAt(effect, 'x0_milli'),
      y0Milli: optionalNumberAt(effect, 'y0_milli'),
      dxMilli: optionalNumberAt(effect, 'dx_milli'),
      dyMilli: optionalNumberAt(effect, 'dy_milli'),
      lengthMilli: optionalNumberAt(effect, 'length_milli'),
      edgeYMilli: optionalNumberAt(effect, 'edge_y_milli'),
    })),
  };
}

function parseChainList(value: unknown): BossWireChain[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter(isRecord).map((chain) => ({
    chainId: optionalWireStringAt(chain, 'chain_id') ?? '',
    patternIndex: numberAt(chain, 'pattern_index'),
    nodeId: numberAt(chain, 'node_id'),
    generation: numberAt(chain, 'generation'),
    rngCursor: numberAt(chain, 'rng_cursor'),
  }));
}

function parseHandList(value: unknown): BossWireCard[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter(isRecord).map((card) => ({
    cardId: stringAt(card, 'card_id'),
    slot: numberAt(card, 'slot'),
    selected: card.selected === true,
  }));
}

function parseEventList(value: unknown): BossWireEvent[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter(isRecord).map((event) => {
    const data: Record<string, unknown> = {};
    for (const key of Object.keys(event)) {
      if (key !== 'tick' && key !== 'type' && key !== 'player_id') {
        data[key] = event[key];
      }
    }
    return {
      tick: numberAt(event, 'tick'),
      type: stringAt(event, 'type'),
      playerId: stringAt(event, 'player_id'),
      data,
    };
  });
}

function parseCoopBossState(text: string): CoopBossStateEnum {
  switch (text) {
    case 'running':
      return CoopBossStateEnum.Running;
    case 'finished':
      return CoopBossStateEnum.Finished;
    default:
      return CoopBossStateEnum.Waiting;
  }
}

/**
 * 合作模式快照（payload 字节 12，JSON 体）。
 *
 * 字段与服务端 `EncodeCoopBossSnapshotPayload`（COOP_MODE_CONTRACT.md §2.4）
 * 一一对应；畸形输入返回 null（与 `decodeBossRaceSnapshot` 同纪律）。
 */
export function decodeCoopBossSnapshot(payload: Uint8Array): CoopBossSnapshot | null {
  if (payload.length < 2 || payload[0] !== BattlePayloadType.COOP_SNAPSHOT) {
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
    state: parseCoopBossState(stringAt(source, 'state')),
    bossHp: numberAt(source, 'boss_hp'),
    bossMaxHp: numberAt(source, 'boss_max_hp'),
    seatCount: numberAt(source, 'seat_count'),
    shieldDirMask: numberAt(source, 'shield_dir_mask'),
    lockDir: numberAt(source, 'lock_dir'),
    lockUntilTick: numberAt(source, 'lock_until_tick'),
    spiralActive: source.spiral_active === true,
    stateHash: stringAt(source, 'state_hash'),
    players: players.filter(isRecord).map(
      (player): CoopBossPlayerSnapshot => ({
        playerId: stringAt(player, 'player_id'),
        seat: numberAt(player, 'seat'),
        xMilli: numberAt(player, 'x_milli'),
        yMilli: numberAt(player, 'y_milli'),
        facingMilliDeg: numberAt(player, 'facing_millideg'),
        damageDealt: numberAt(player, 'damage_dealt'),
        connected: player.connected !== false,
        locked: player.locked === true,
        shielded: player.shielded === true,
        // §2.8 增补（可选）。
        vxMilli: optionalNumberAt(player, 'vx_milli'),
        vyMilli: optionalNumberAt(player, 'vy_milli'),
        lives: optionalNumberAt(player, 'lives'),
        bombs: optionalNumberAt(player, 'bombs'),
        invulnerableUntilTick: optionalNumberAt(player, 'invulnerable_until_tick'),
        graze: optionalNumberAt(player, 'graze'),
      }),
    ),
    bullets: bullets.filter(isRecord).map(
      (bullet): CoopBossBullet => ({
        bulletId: stringAt(bullet, 'bullet_id'),
        ownerPlayerId: stringAt(bullet, 'owner_player_id'),
        xMilli: numberAt(bullet, 'x_milli'),
        yMilli: numberAt(bullet, 'y_milli'),
        vxMilli: numberAt(bullet, 'vx_milli'),
        vyMilli: numberAt(bullet, 'vy_milli'),
        radiusMilli: numberAt(bullet, 'radius_milli'),
        kind: numberAt(bullet, 'kind'),
        patternId: stringAt(bullet, 'pattern_id'),
        chainId: optionalWireStringAt(bullet, 'chain_id'),
        generation: optionalNumberAt(bullet, 'generation'),
        hidden: optionalBoolAt(bullet, 'hidden'),
      }),
    ),
    ...parseSnapshotExtensions(source),
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

/**
 * Encodes a `HANDSHAKE_ACCEPT` frame.
 *
 * The client never sends one, but tests and fixtures need to be able to stand
 * in for the server, and having the frame built by the same codec the reader
 * uses is what keeps them from drifting apart.
 */
export function encodeHandshakeAccept(accept: BattleHandshakeAccept): Uint8Array {
  const writer = new ByteWriter();
  writer.u8(BattlePayloadType.HANDSHAKE_ACCEPT);
  writer.raw(codec.battleHandshakeAccept.encode(accept));
  return writer.finish();
}

/**
 * Decodes a `HANDSHAKE_ACCEPT` frame — the server's answer to
 * {@link encodeHandshakeHello}.
 *
 * The frame carries the leading payload-type byte every other client frame has,
 * so the caller can dispatch on `peekPayloadType` before decoding.
 */
export function decodeHandshakeAccept(payload: Uint8Array): BattleHandshakeAccept | null {
  if (payload.length === 0 || payload[0] !== BattlePayloadType.HANDSHAKE_ACCEPT) {
    return null;
  }
  try {
    return codec.battleHandshakeAccept.decode(payload.subarray(1)) as BattleHandshakeAccept;
  } catch {
    return null;
  }
}

/**
 * Wraps a sealed body in the `BattleEncryptedPacket` envelope from
 * `battle.proto`.
 *
 * The frame is the **bare** protobuf message, with no leading payload-type
 * byte: the type already lives in `header.payload_type`, and the missing
 * prefix is what keeps an encrypted frame from being mistaken for one of the
 * hand-rolled plaintext frames this module encodes (all of which *do* start
 * with their type byte).
 *
 * NOTE: `MatchServer` (the deployed battle server) does **not** implement this
 * envelope — see the module header. It is the long-term contract in
 * `battle.proto` and is exercised by tests, not by the live match path.
 */
export function encodeEncryptedPacket(packet: BattleEncryptedPacket): Uint8Array {
  return codec.battleEncryptedPacket.encode(packet);
}

/** Inverse of {@link encodeEncryptedPacket}; `null` when the frame is not one. */
export function decodeEncryptedPacket(payload: Uint8Array): BattleEncryptedPacket | null {
  if (payload.length === 0) {
    return null;
  }
  try {
    return codec.battleEncryptedPacket.decode(payload) as BattleEncryptedPacket;
  } catch {
    return null;
  }
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

/**
 * Like {@link numberAt} but distinguishes "absent" from "zero".
 *
 * The real-danmaku extensions (`bullet_kind`, `motion_func`) are optional on the
 * wire so a battle server that predates them still decodes; `undefined` here is
 * what lets the renderer tell "this server never sent a kind" apart from "the
 * server sent kind 0" and fall back to the generic bullet.
 */
export function optionalNumberAt(
  source: Record<string, unknown>,
  key: string,
): number | undefined {
  if (!(key in source) || source[key] === null || source[key] === undefined) {
    return undefined;
  }
  return numberAt(source, key);
}

/** Like {@link optionalNumberAt} for strings: absent stays `undefined`. */
export function optionalStringAt(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  if (!(key in source) || typeof source[key] !== 'string') {
    return undefined;
  }
  return source[key] as string;
}

/**
 * `chain_id` on the §2.8 wire: the C++ server writes it as a JSON **number**
 * (`std::to_string(std::uint32_t)` — see `BossRaceBullet::chain_id` /
 * `BossChainWire::chain_id` in `PhK-BattleServer/include/phk/battle/
 * boss_race.hpp`), while the long-term contract carries it as text. Accept
 * both and normalise a number to the decimal text it would print as, so every
 * downstream consumer keeps the single `string` type; absent stays
 * `undefined`, so an old server that predates the field is still told apart
 * from "chain 0".
 */
export function optionalWireStringAt(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  if (!(key in source)) {
    return undefined;
  }
  const value = source[key];
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return undefined;
}

/** Like {@link optionalNumberAt} for booleans: absent stays `undefined`. */
export function optionalBoolAt(
  source: Record<string, unknown>,
  key: string,
): boolean | undefined {
  if (!(key in source) || typeof source[key] !== 'boolean') {
    return undefined;
  }
  return source[key] as boolean;
}
