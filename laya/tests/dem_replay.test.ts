/**
 * `.dem` client module tests (thread B): sha256, zlib inflate, container
 * parse/encode, chain verification and the replayer skeleton.
 *
 * 版权：东方同人逆向成果，仅用于自研玩法。
 */

import { expect, expectDeepEqual, expectEqual, test } from './harness';
import { bytesToHex, hexToBytes, sha256, utf8Encode } from '../src/core/dem/sha256';
import { adler32, deflateStoredZlib, inflateZlib } from '../src/core/dem/inflate';
import {
  canonicalChainInputPayload,
  canonicalChainSeedPayload,
  decodeCanonicalInputPayload,
  encodeDemBody,
  encodeDemDocument,
  encodeDemHeaderJson,
  parseDemDocument,
  rebuildChainEntries,
  DEM_MAGIC,
  DemError,
  type DemBodyEntry,
  type DemHeader,
} from '../src/core/dem/parse';
import { bossRaceSeedFromDecimal, DemReplayer, replayerFromDemBytes } from '../src/core/dem/replayer';

// --- sha256 / hex ---------------------------------------------------------

test('dem sha256 hashes raw bytes and matches the FIPS vectors', () => {
  expectEqual(bytesToHex(sha256(utf8Encode('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expectEqual(bytesToHex(sha256(new Uint8Array([]))), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  // Bytes >= 0x80 must not be re-encoded (the reason this module exists).
  expectEqual(bytesToHex(sha256(Uint8Array.from([0x00, 0x80, 0xff, 0x7f]))).length, 64);
  expectEqual(bytesToHex(hexToBytes('0080ff7f')), '0080ff7f');
});

// --- inflate --------------------------------------------------------------

test('inflateZlib round-trips stored blocks and matches zlib fixed/dynamic streams', () => {
  const source = utf8Encode('lobby replay body 0123456789 '.repeat(500));
  expectEqual(bytesToHex(inflateZlib(deflateStoredZlib(source))), bytesToHex(source));
  expectEqual(inflateZlib(deflateStoredZlib(new Uint8Array([]))).length, 0);

  // Fixed-Huffman stream produced by real zlib (zlib.deflateSync).
  const fixed = hexToBytes('789ccb48cdc9c957c8c04e0200a3100ae5');
  expectEqual(bytesToHex(inflateZlib(fixed)), bytesToHex(utf8Encode('hello hello hello hello hello')));

  // Dynamic-Huffman stream produced by real zlib.
  const dynamic = hexToBytes(
    '789cedc13101000000c2a06ceb5fca0cfe400100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000af01468368db',
  );
  expectEqual(inflateZlib(dynamic).length, 200000);
  expectEqual(inflateZlib(dynamic)[123456], 'A'.charCodeAt(0));

  expectThrows(() => inflateZlib(fixed.slice(0, fixed.length - 2)));
  expectThrows(() => inflateZlib(Uint8Array.from([0x00, 0x00, 0x00])));
  expectEqual(adler32(utf8Encode('abc')), 0x024d0127);
});

function expectThrows(fn: () => void): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  expect(threw, 'expected function to throw');
}

// --- canonical input payload ---------------------------------------------

test('canonical input payload decodes back to its fields (mode_action_id may contain |)', () => {
  const payload = canonicalChainInputPayload(7, 0b1010, true, false, true, 3, 'cast|card');
  expectDeepEqual(decodeCanonicalInputPayload(payload), {
    seq: 7,
    directionBits: 0b1010,
    slow: true,
    shoot: false,
    bomb: true,
    cardSlot: 3,
    modeActionId: 'cast|card',
  });
});

// --- seed -----------------------------------------------------------------

test('bossRaceSeedFromDecimal preserves the full 64-bit width', () => {
  expectDeepEqual(bossRaceSeedFromDecimal('12345'), { decimal: '12345', low32: 12345, hi32: 0 });
  expectEqual(bossRaceSeedFromDecimal('0').decimal, '0');
  const wide = bossRaceSeedFromDecimal('18446744073709551615');
  expectEqual(wide.low32, 0xffffffff);
  expectEqual(wide.hi32, 0xffffffff);
  expectEqual(bossRaceSeedFromDecimal('00042').decimal, '42');
  expectEqual(bossRaceSeedFromDecimal('').decimal, '0');
});

// --- container ------------------------------------------------------------

function sampleDocument(finalTick: number, finalStateHash: string): { header: DemHeader; entries: DemBodyEntry[] } {
  const entries: DemBodyEntry[] = [
    {
      seq: 1,
      tick: 0,
      player_id: '',
      action_type: 'match_seed',
      payload: canonicalChainSeedPayload('battle_derived', '12345'),
    },
  ];
  let chainSeq = 1;
  const playerSeqs = new Map<string, number>([
    ['p1', 0],
    ['p2', 0],
  ]);
  for (let tick = 1; tick <= finalTick; tick += 1) {
    for (const playerId of ['p1', 'p2']) {
      const playerSeq = (playerSeqs.get(playerId) ?? 0) + 1;
      playerSeqs.set(playerId, playerSeq);
      chainSeq += 1;
      entries.push({
        seq: chainSeq,
        tick,
        player_id: playerId,
        action_type: 'input',
        payload: canonicalChainInputPayload(playerSeq, playerId === 'p1' ? 0b0001 : 0b0010, false, true, false, -1, ''),
      });
    }
  }
  const head = rebuildChainEntries(entries);
  const header: DemHeader = {
    match_id: 'match-dem-test',
    mode_id: 'mvp_boss_race',
    boss_id: '',
    ruleset_version: 'ruleset-local-s0',
    server_seed: '12345',
    tick_rate_hz: 60,
    final_tick: finalTick,
    final_state_hash: finalStateHash,
    players: [
      { player_id: 'p1', user_id: 'u1', loadout: { character_id: 'reimu', shot_type: '', bomb_type: '' } },
      { player_id: 'p2', user_id: 'u2', loadout: { character_id: 'marisa', shot_type: '', bomb_type: '' } },
    ],
    created_at: 1700000000,
    entry_count: entries.length,
    chain_head_digest: head.length === 0 ? '00000000' : head[head.length - 1].entry_digest,
  };
  return { header, entries };
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
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

function appendU32(out: number[], value: number): void {
  out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function appendU64(out: number[], value: number): void {
  appendU32(out, value >>> 0);
  appendU32(out, Math.floor(value / 0x100000000));
}

/** Build a container with an authoritative header JSON + arbitrary compressed bytes. */
function rawContainer(headerJson: string, compressed: Uint8Array): Uint8Array {
  const headerBytes = utf8Encode(headerJson);
  const out: number[] = [];
  for (const ch of DEM_MAGIC) out.push(ch.charCodeAt(0));
  appendU32(out, headerBytes.length);
  for (const byte of headerBytes) out.push(byte);
  appendU64(out, compressed.length);
  for (const byte of compressed) out.push(byte);
  const digest = sha256(concatBytes([headerBytes, compressed]));
  for (const byte of digest) out.push(byte);
  return Uint8Array.from(out);
}

/** Build a container bypassing encodeDemDocument's guards (to exercise the parser). */
function rawDocument(header: DemHeader, entries: DemBodyEntry[]): Uint8Array {
  return rawContainer(encodeDemHeaderJson(header), deflateStoredZlib(encodeDemBody(entries)));
}

function magicOf(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < 8; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

function expectParseCode(bytes: Uint8Array, code: string): void {
  let caught: unknown;
  try {
    parseDemDocument(bytes);
  } catch (error) {
    caught = error;
  }
  expect(caught instanceof DemError, `expected DemError for ${code}`);
  expectEqual((caught as DemError).code, code);
}

test('encode → parse round-trips a dem container field by field', () => {
  const { header, entries } = sampleDocument(6, 'placeholder');
  const bytes = encodeDemDocument(header, entries);
  expectEqual(magicOf(bytes), DEM_MAGIC);
  const document = parseDemDocument(bytes);
  expectEqual(document.header.match_id, header.match_id);
  expectEqual(document.header.server_seed, '12345');
  expectEqual(document.header.entry_count, entries.length);
  expectEqual(document.entries.length, entries.length);
  expectEqual(document.entries[1].player_id, 'p1');
  expectEqual(document.entries[1].action_type, 'input');
  expectEqual(document.header.players[1].loadout.character_id, 'marisa');
  expectEqual(document.header.chain_head_digest, header.chain_head_digest);
});

// boss HP feeds the state hash, so a match recorded with `--boss-hp` can only
// be replayed faithfully when the container carries it. It stays optional so
// containers written before the field existed are byte-identical.
test('boss_max_hp is optional but survives the container round trip', () => {
  const { header, entries } = sampleDocument(2, 'placeholder');
  const plain = encodeDemHeaderJson(header);
  expect(!plain.includes('boss_max_hp'), 'an unrecorded boss hp is not written');
  expectEqual(parseDemDocument(encodeDemDocument(header, entries)).header.boss_max_hp ?? 0, 0);

  const withHp: DemHeader = { ...header, boss_max_hp: 300 };
  expect(encodeDemHeaderJson(withHp).includes('"boss_max_hp":300'), 'a recorded boss hp is written');
  expectEqual(parseDemDocument(encodeDemDocument(withHp, entries)).header.boss_max_hp ?? 0, 300);
});

test('parse rejects tampered containers with stable dem_* codes', () => {
  const { header, entries } = sampleDocument(4, 'placeholder');
  const bytes = encodeDemDocument(header, entries);

  const badMagic = bytes.slice();
  badMagic[0] = 'X'.charCodeAt(0);
  expectParseCode(badMagic, 'dem_bad_magic');

  const badSha = bytes.slice();
  badSha[badSha.length - 1] ^= 0x01;
  expectParseCode(badSha, 'dem_sha256_mismatch');

  expectParseCode(bytes.slice(0, bytes.length - 3), 'dem_length_mismatch');

  // Valid header + garbage body + correct sha256 → zlib failure.
  expectParseCode(rawContainer(encodeDemHeaderJson(header), utf8Encode('not-a-zlib-stream')), 'dem_zlib_failed');

  // Broken chain (seq reused) → chain verification failure.
  const brokenEntries = entries.map((entry) => ({ ...entry }));
  brokenEntries[3] = { ...brokenEntries[3], seq: 1 };
  expectParseCode(rawDocument(header, brokenEntries), 'dem_chain_verify_failed');

  // header entry_count disagrees with the body.
  expectParseCode(rawDocument({ ...header, entry_count: header.entry_count + 1 }, entries), 'dem_header_entry_count_mismatch');

  // header chain_head_digest disagrees with the recomputed chain.
  expectParseCode(rawDocument({ ...header, chain_head_digest: '00000000' }, entries), 'dem_header_head_digest_mismatch');
});

test('encodeDemDocument guards header/entry consistency', () => {
  const { header, entries } = sampleDocument(3, 'placeholder');
  expectThrows(() => encodeDemDocument({ ...header, entry_count: 999 }, entries));
  expectThrows(() => encodeDemDocument({ ...header, chain_head_digest: '00000000' }, entries));
});

// --- replayer -------------------------------------------------------------

test('DemReplayer reconstructs state, caches keyframes and verifies final hash', () => {
  const finalTick = 12;
  const first = sampleDocument(finalTick, '');
  const probe = replayerFromDemBytes(encodeDemDocument(first.header, first.entries), 3).runToEnd();
  expect(probe.completed, 'replay should complete');
  expectEqual(probe.finalTick, finalTick);
  expectEqual(probe.skippedInputs, 0, 'all inputs should be accepted at their tick');
  expectEqual(probe.acceptedInputs, finalTick * 2);
  expect(probe.replayedStateHash.length > 0, 'replayed hash should be non-empty');

  // Re-encode with the recomputed hash → the verifier must now agree.
  const sealed = sampleDocument(finalTick, probe.replayedStateHash);
  const replayer = new DemReplayer(parseDemDocument(encodeDemDocument(sealed.header, sealed.entries)), {
    keyframeIntervalTicks: 3,
  });
  const result = replayer.runToEnd();
  expect(result.hashMatched, `declared ${result.declaredStateHash} vs replayed ${result.replayedStateHash}`);
  expect(replayer.keyframes.length >= 4, 'keyframes at every 3 ticks');
  expectEqual(replayer.keyframeAt(6)?.tick, 6);

  expectEqual(replayer.seek(finalTick).tick, finalTick);
  expectEqual(replayer.seek(3).tick, 3);
});

test('DemReplayer marks a mismatching final hash instead of throwing', () => {
  const { header, entries } = sampleDocument(6, 'deadbeefdeadbeef');
  const result = replayerFromDemBytes(encodeDemDocument(header, entries)).runToEnd();
  expect(result.completed, 'replay completes');
  expect(!result.hashMatched, 'placeholder hash must not match');
  expectEqual(result.declaredStateHash, 'deadbeefdeadbeef');
});
