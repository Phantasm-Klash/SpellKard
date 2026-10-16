/**
 * `.dem` v1 container parse / encode + chain verification (client side).
 *
 * Byte-for-byte mirror of the battle server's `PhK-BattleServer/src/dem.cpp`
 * (`WriteDemDocument` / `ParseDemDocument`) and the frozen layout in
 * `COORDINATION.md` §0.2:
 *
 *   [8B magic "PHDEM001"][u32 header_len LE][header JSON]
 *   [u64 body_len LE][zlib(body)][32B sha256(header_json ++ compressed)]
 *
 * body entry: [u64 seq][i64 tick][u16 len][player_id][u16 len][action_type]
 *             [u16 len][payload]，payload = CanonicalChainInputPayload 规范化字节。
 *
 * 版权：东方同人逆向成果，仅用于自研玩法。
 */

import { bytesToHex, hexToBytes, shortHashHexOfText, sha256, utf8Encode } from './sha256';
import { deflateStoredZlib, inflateZlib } from './inflate';

export const DEM_MAGIC = 'PHDEM001';
export const DEM_FIELD_MAX_BYTES = 0xffff;
const DEM_MAX_HEADER_BYTES = 4 * 1024 * 1024;
const DEM_MAX_BODY_BYTES = 256 * 1024 * 1024;
export const DEM_CHAIN_GENESIS_PREV_DIGEST = '00000000';

export interface DemLoadout {
  character_id: string;
  shot_type: string;
  bomb_type: string;
}

export interface DemPlayer {
  player_id: string;
  user_id: string;
  loadout: DemLoadout;
}

export interface DemHeader {
  match_id: string;
  mode_id: string;
  boss_id: string;
  ruleset_version: string;
  /** 十进制字符串（对齐大厅 loadout server_seed 口径）。 */
  server_seed: string;
  tick_rate_hz: number;
  final_tick: number;
  final_state_hash: string;
  /**
   * Boss 满血值。服务端只在录到时写出（`--boss-hp`），旧容器没有这个键 → 0，
   * 表示「重放端沿用自己的默认/目录值」。玩家 HP 进了 state hash，缺了它
   * 用非默认 HP 录的容器就无法忠实重放。
   */
  boss_max_hp?: number;
  players: DemPlayer[];
  created_at: number;
  entry_count: number;
  chain_head_digest: string;
}

export interface DemBodyEntry {
  seq: number;
  tick: number;
  player_id: string;
  action_type: string;
  payload: string;
}

export interface DemDocument {
  header: DemHeader;
  entries: DemBodyEntry[];
}

/** Thrown on any container/chain integrity failure. `code` is a stable dem_* tag. */
export class DemError extends Error {
  constructor(public readonly code: string, detail = '') {
    super(detail === '' ? code : `${code}:${detail}`);
    this.name = 'DemError';
  }
}

// ---------------------------------------------------------------------------
// 规范化 payload（CanonicalChain*Payload 的镜像）
// ---------------------------------------------------------------------------

function chainBoolToken(value: boolean): string {
  return value ? '1' : '0';
}

export function canonicalChainInputPayload(
  seq: number,
  directionBits: number,
  slow: boolean,
  shoot: boolean,
  bomb: boolean,
  cardSlot: number,
  modeActionId: string,
): string {
  return (
    `seq=${seq}` +
    `|dir=${directionBits}` +
    `|slow=${chainBoolToken(slow)}` +
    `|shoot=${chainBoolToken(shoot)}` +
    `|bomb=${chainBoolToken(bomb)}` +
    `|card=${cardSlot}` +
    `|mode_action_id=${modeActionId}`
  );
}

export function canonicalChainModeActionPayload(actionId: string, seq: number, payloadJson: string): string {
  return `action_id=${actionId}|seq=${seq}|payload=${payloadJson}`;
}

export function canonicalChainSeedPayload(seedKind: string, seed: string): string {
  return `seed_kind=${seedKind}|seed=${seed}`;
}

export interface DecodedInputFields {
  seq: number;
  directionBits: number;
  slow: boolean;
  shoot: boolean;
  bomb: boolean;
  cardSlot: number;
  modeActionId: string;
}

/**
 * Decode a canonical input payload back into its fields. The last field
 * (`mode_action_id`) may itself contain '|', so only the first six are split.
 */
export function decodeCanonicalInputPayload(payload: string): DecodedInputFields {
  const parts = payload.split('|');
  if (parts.length < 7) {
    throw new DemError('dem_input_payload_malformed', payload);
  }
  const readAfter = (part: string, prefix: string): string => {
    if (!part.startsWith(prefix)) {
      throw new DemError('dem_input_payload_malformed', part);
    }
    return part.slice(prefix.length);
  };
  const seq = Number.parseInt(readAfter(parts[0], 'seq='), 10);
  const directionBits = Number.parseInt(readAfter(parts[1], 'dir='), 10);
  const slow = readAfter(parts[2], 'slow=') === '1';
  const shoot = readAfter(parts[3], 'shoot=') === '1';
  const bomb = readAfter(parts[4], 'bomb=') === '1';
  const cardSlot = Number.parseInt(readAfter(parts[5], 'card='), 10);
  // mode_action_id is the final field and may itself contain '|'.
  const modeActionId = readAfter(parts.slice(6).join('|'), 'mode_action_id=');
  if ([seq, directionBits, cardSlot].some((value) => Number.isNaN(value))) {
    throw new DemError('dem_input_payload_malformed', payload);
  }
  return { seq, directionBits, slow, shoot, bomb, cardSlot, modeActionId };
}

// ---------------------------------------------------------------------------
// 链（VerifyChain 的镜像）
// ---------------------------------------------------------------------------

export interface ChainEntry {
  seq: number;
  tick: number;
  player_id: string;
  action_type: string;
  payload_digest: string;
  prev_digest: string;
  entry_digest: string;
}

export interface ChainVerification {
  ok: boolean;
  firstBadSeq: number;
  reason: string;
}

/** Rebuild chain entries from a body entry list (body stores payload, not digests). */
export function rebuildChainEntries(entries: readonly DemBodyEntry[]): ChainEntry[] {
  const out: ChainEntry[] = [];
  for (const entry of entries) {
    const payloadDigest = shortHashHexOfText(entry.payload);
    const prevDigest = out.length === 0 ? DEM_CHAIN_GENESIS_PREV_DIGEST : out[out.length - 1].entry_digest;
    const material =
      `${entry.seq}` +
      `|${entry.tick}` +
      `|${entry.player_id}` +
      `|${entry.action_type}` +
      `|${payloadDigest}` +
      `|${prevDigest}`;
    out.push({
      seq: entry.seq,
      tick: entry.tick,
      player_id: entry.player_id,
      action_type: entry.action_type,
      payload_digest: payloadDigest,
      prev_digest: prevDigest,
      entry_digest: shortHashHexOfText(material),
    });
  }
  return out;
}

export function verifyChain(entries: readonly ChainEntry[]): ChainVerification {
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (i === 0) {
      if (entry.seq !== 1) {
        return { ok: false, firstBadSeq: entry.seq, reason: 'chain_first_seq_not_one' };
      }
      if (entry.prev_digest !== DEM_CHAIN_GENESIS_PREV_DIGEST) {
        return { ok: false, firstBadSeq: entry.seq, reason: 'chain_genesis_prev_digest_mismatch' };
      }
    } else {
      const prev = entries[i - 1];
      if (entry.seq !== prev.seq + 1) {
        return { ok: false, firstBadSeq: entry.seq, reason: 'chain_seq_gap' };
      }
      if (entry.prev_digest !== prev.entry_digest) {
        return { ok: false, firstBadSeq: entry.seq, reason: 'chain_prev_link_broken' };
      }
    }
  }
  return { ok: true, firstBadSeq: 0, reason: entries.length === 0 ? 'chain_empty' : 'ok' };
}

// ---------------------------------------------------------------------------
// 字节工具
// ---------------------------------------------------------------------------

function readU16(bytes: Uint8Array, cursor: number): number {
  if (cursor + 2 > bytes.length) throw new DemError('dem_truncated');
  return bytes[cursor] | (bytes[cursor + 1] << 8);
}

function readU32(bytes: Uint8Array, cursor: number): number {
  if (cursor + 4 > bytes.length) throw new DemError('dem_truncated');
  return (bytes[cursor] | (bytes[cursor + 1] << 8) | (bytes[cursor + 2] << 16) | (bytes[cursor + 3] << 24)) >>> 0;
}

function readU64(bytes: Uint8Array, cursor: number): number {
  const low = readU32(bytes, cursor);
  const high = readU32(bytes, cursor + 4);
  return high * 0x100000000 + low;
}

function readI64(bytes: Uint8Array, cursor: number): number {
  const value = readU64(bytes, cursor);
  return value >= 0x8000000000000000 ? value - 0x10000000000000000 : value;
}

function bytesToLatin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

/** Minimal UTF-8 decoder (core is DOM-free, so no TextDecoder). */
function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const first = bytes[i];
    if (first < 0x80) {
      out += String.fromCharCode(first);
      i += 1;
    } else if (first < 0xe0) {
      out += String.fromCharCode(((first & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (first < 0xf0) {
      out += String.fromCharCode(((first & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 3;
    } else {
      const code =
        ((first & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      const adjusted = code - 0x10000;
      out += String.fromCharCode(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff));
      i += 4;
    }
  }
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// body 编解码
// ---------------------------------------------------------------------------

function appendU16(out: number[], value: number): void {
  out.push(value & 0xff, (value >> 8) & 0xff);
}

function appendU32(out: number[], value: number): void {
  out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function appendU64(out: number[], value: number): void {
  appendU32(out, value >>> 0);
  appendU32(out, Math.floor(value / 0x100000000));
}

function appendI64(out: number[], value: number): void {
  appendU64(out, value < 0 ? value + 0x10000000000000000 : value);
}

function appendBytes(out: number[], value: string): void {
  const bytes = utf8Encode(value);
  if (bytes.length > DEM_FIELD_MAX_BYTES) {
    throw new DemError('dem_payload_too_long');
  }
  appendU16(out, bytes.length);
  for (const byte of bytes) out.push(byte);
}

export function encodeDemBody(entries: readonly DemBodyEntry[]): Uint8Array {
  const out: number[] = [];
  for (const entry of entries) {
    appendU64(out, entry.seq);
    appendI64(out, entry.tick);
    appendBytes(out, entry.player_id);
    appendBytes(out, entry.action_type);
    appendBytes(out, entry.payload);
  }
  return Uint8Array.from(out);
}

export function decodeDemBody(body: Uint8Array): DemBodyEntry[] {
  const entries: DemBodyEntry[] = [];
  let cursor = 0;
  while (cursor < body.length) {
    const seq = readU64(body, cursor);
    cursor += 8;
    const tick = readI64(body, cursor);
    cursor += 8;
    const readField = (): string => {
      const length = readU16(body, cursor);
      cursor += 2;
      if (cursor + length > body.length) throw new DemError('dem_body_decode_failed');
      const value = bytesToLatin1(body.subarray(cursor, cursor + length));
      cursor += length;
      return value;
    };
    const playerId = readField();
    const actionType = readField();
    const payload = readField();
    entries.push({ seq, tick, player_id: playerId, action_type: actionType, payload });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// header JSON
// ---------------------------------------------------------------------------

function jsonString(value: string): string {
  return JSON.stringify(value);
}

/** Encode the header exactly like `EncodeDemHeaderJson` (field order frozen). */
export function encodeDemHeaderJson(header: DemHeader): string {
  let out = `{"match_id":${jsonString(header.match_id)}`;
  out += `,"mode_id":${jsonString(header.mode_id)}`;
  out += `,"boss_id":${jsonString(header.boss_id)}`;
  out += `,"ruleset_version":${jsonString(header.ruleset_version)}`;
  out += `,"server_seed":${jsonString(header.server_seed)}`;
  out += `,"tick_rate_hz":${header.tick_rate_hz}`;
  out += `,"final_tick":${header.final_tick}`;
  out += `,"final_state_hash":${jsonString(header.final_state_hash)}`;
  // 与服务端一致：只在记录到时写出（0 = 沿用重放端默认），旧容器字节不变。
  if (header.boss_max_hp !== undefined && header.boss_max_hp > 0) {
    out += `,"boss_max_hp":${header.boss_max_hp}`;
  }
  out += ',"players":[';
  for (let i = 0; i < header.players.length; i += 1) {
    const player = header.players[i];
    if (i !== 0) out += ',';
    out += `{"player_id":${jsonString(player.player_id)}`;
    out += `,"user_id":${jsonString(player.user_id)}`;
    out += `,"loadout":{"character_id":${jsonString(player.loadout.character_id)}`;
    out += `,"shot_type":${jsonString(player.loadout.shot_type)}`;
    out += `,"bomb_type":${jsonString(player.loadout.bomb_type)}}}`;
  }
  out += ']';
  out += `,"created_at":${header.created_at}`;
  out += `,"entry_count":${header.entry_count}`;
  out += `,"chain_head_digest":${jsonString(header.chain_head_digest)}`;
  out += '}';
  return out;
}

function decodeDemHeaderJson(json: string): DemHeader {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new DemError('dem_header_decode_failed');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new DemError('dem_header_decode_failed');
  }
  const value = raw as Record<string, unknown>;
  const readString = (key: string): string => {
    const field = value[key];
    if (typeof field !== 'string') throw new DemError('dem_header_decode_failed', key);
    return field;
  };
  const readNumber = (key: string): number => {
    const field = value[key];
    if (typeof field !== 'number' || !Number.isFinite(field)) throw new DemError('dem_header_decode_failed', key);
    return field;
  };
  // Optional for backward compatibility: containers written before the field
  // existed simply do not carry it.
  const readOptionalNumber = (key: string): number | undefined => {
    const field = value[key];
    if (field === undefined) return undefined;
    if (typeof field !== 'number' || !Number.isFinite(field)) throw new DemError('dem_header_decode_failed', key);
    return field;
  };
  const bossMaxHp = readOptionalNumber('boss_max_hp');
  const rawPlayers = value['players'];
  if (!Array.isArray(rawPlayers)) throw new DemError('dem_header_decode_failed', 'players');
  const players: DemPlayer[] = rawPlayers.map((item) => {
    if (typeof item !== 'object' || item === null) throw new DemError('dem_header_decode_failed', 'player');
    const entry = item as Record<string, unknown>;
    const loadout = entry['loadout'];
    if (typeof loadout !== 'object' || loadout === null) throw new DemError('dem_header_decode_failed', 'loadout');
    const loadoutRecord = loadout as Record<string, unknown>;
    const readLoadoutString = (key: string): string => {
      const field = loadoutRecord[key];
      if (typeof field !== 'string') throw new DemError('dem_header_decode_failed', key);
      return field;
    };
    if (typeof entry['player_id'] !== 'string' || typeof entry['user_id'] !== 'string') {
      throw new DemError('dem_header_decode_failed', 'player_id/user_id');
    }
    return {
      player_id: entry['player_id'] as string,
      user_id: entry['user_id'] as string,
      loadout: {
        character_id: readLoadoutString('character_id'),
        shot_type: readLoadoutString('shot_type'),
        bomb_type: readLoadoutString('bomb_type'),
      },
    };
  });
  return {
    match_id: readString('match_id'),
    mode_id: readString('mode_id'),
    boss_id: readString('boss_id'),
    ruleset_version: readString('ruleset_version'),
    server_seed: readString('server_seed'),
    tick_rate_hz: readNumber('tick_rate_hz'),
    final_tick: readNumber('final_tick'),
    final_state_hash: readString('final_state_hash'),
    ...(bossMaxHp !== undefined && bossMaxHp > 0 ? { boss_max_hp: bossMaxHp } : {}),
    players,
    created_at: readNumber('created_at'),
    entry_count: readNumber('entry_count'),
    chain_head_digest: readString('chain_head_digest'),
  };
}

// ---------------------------------------------------------------------------
// 容器
// ---------------------------------------------------------------------------

/** Parse + fully validate a `.dem` container (magic/length/sha256/zlib/chain/header). */
export function parseDemDocument(bytes: Uint8Array): DemDocument {
  const fixedTail = 8 + 4 + 8 + 32;
  if (bytes.length < fixedTail) throw new DemError('dem_truncated');
  const magic = bytesToLatin1(bytes.subarray(0, 8));
  if (magic !== DEM_MAGIC) throw new DemError('dem_bad_magic');
  let cursor = 8;
  const headerLen = readU32(bytes, cursor);
  cursor += 4;
  if (headerLen > DEM_MAX_HEADER_BYTES) throw new DemError('dem_header_too_large');
  if (cursor + headerLen + 8 > bytes.length) throw new DemError('dem_truncated');
  const headerBytes = bytes.subarray(cursor, cursor + headerLen);
  cursor += headerLen;
  const bodyLen = readU64(bytes, cursor);
  cursor += 8;
  if (bodyLen > DEM_MAX_BODY_BYTES || cursor + bodyLen + 32 !== bytes.length) {
    throw new DemError('dem_length_mismatch');
  }
  const compressed = bytes.subarray(cursor, cursor + bodyLen);
  cursor += bodyLen;
  const trailer = bytes.subarray(cursor, cursor + 32);

  const expected = sha256(concat([headerBytes, compressed]));
  if (bytesToHex(trailer) !== bytesToHex(expected)) {
    throw new DemError('dem_sha256_mismatch');
  }

  let body: Uint8Array;
  try {
    body = inflateZlib(compressed);
  } catch (err) {
    throw new DemError('dem_zlib_failed', err instanceof Error ? err.message : String(err));
  }

  const entries = decodeDemBody(body);
  const chainEntries = rebuildChainEntries(entries);
  const verified = verifyChain(chainEntries);
  if (!verified.ok) {
    throw new DemError('dem_chain_verify_failed', verified.reason);
  }

  const header = decodeDemHeaderJson(utf8Decode(headerBytes));
  if (header.entry_count !== entries.length) {
    throw new DemError('dem_header_entry_count_mismatch');
  }
  const computedHead = chainEntries.length === 0 ? DEM_CHAIN_GENESIS_PREV_DIGEST : chainEntries[chainEntries.length - 1].entry_digest;
  if (header.chain_head_digest !== computedHead) {
    throw new DemError('dem_header_head_digest_mismatch');
  }
  return { header, entries };
}

/**
 * Encode a `.dem` container. Used by tests and `tools/dem_verify.mjs` to build
 * fixtures / round-trip; the body is zlib-compressed as stored blocks (valid
 * zlib, decoded by both the C++ `uncompress` and this module's inflater).
 */
export function encodeDemDocument(header: DemHeader, entries: readonly DemBodyEntry[]): Uint8Array {
  if (header.entry_count !== entries.length) {
    throw new DemError('dem_header_entry_count_mismatch');
  }
  const chainEntries = rebuildChainEntries(entries);
  const computedHead = chainEntries.length === 0 ? DEM_CHAIN_GENESIS_PREV_DIGEST : chainEntries[chainEntries.length - 1].entry_digest;
  if (header.chain_head_digest !== computedHead) {
    throw new DemError('dem_header_head_digest_mismatch');
  }
  const headerJson = encodeDemHeaderJson(header);
  const headerBytes = utf8Encode(headerJson);
  const bodyBytes = encodeDemBody(entries);
  const compressed = deflateStoredZlib(bodyBytes);
  const out: number[] = [];
  for (const char of DEM_MAGIC) out.push(char.charCodeAt(0));
  appendU32(out, headerBytes.length);
  for (const byte of headerBytes) out.push(byte);
  appendU64(out, compressed.length);
  for (const byte of compressed) out.push(byte);
  const digest = sha256(concat([headerBytes, compressed]));
  for (const byte of digest) out.push(byte);
  return Uint8Array.from(out);
}

/** Convenience: compute the 64-hex sha256 of a whole container (matches Go/X-PhK-Dem-Sha256). */
export function demContainerSha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

export { hexToBytes };
