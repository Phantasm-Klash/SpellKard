/**
 * Minimal pure-TypeScript **zlib** (RFC 1950) decompressor for the `.dem`
 * module.
 *
 * The battle server compresses the replay body with zlib's `compress2`
 * (`PhK-BattleServer/src/dem.cpp` `DemZlibCompress`), producing a standard zlib
 * stream: `[2B header][DEFLATE stream][4B big-endian adler32]`. The client must
 * inflate it to replay. The repo has no `pako`/`fflate`, and the core layer must
 * stay dependency-free + synchronous (no Node `zlib`, which is also absent on
 * LayaNative), so this is a self-contained DEFLATE decoder supporting all three
 * block types (stored / fixed Huffman / dynamic Huffman).
 *
 * 版权：东方同人逆向成果，仅用于自研玩法。
 */

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163,
  195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073,
  4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

class BitReader {
  private bitBuffer = 0;
  private bitCount = 0;

  constructor(private readonly data: Uint8Array, public pos: number) {}

  /** Read `count` (<= 24) bits LSB-first. */
  readBits(count: number): number {
    while (this.bitCount < count) {
      if (this.pos >= this.data.length) {
        throw new Error('dem_inflate_truncated');
      }
      this.bitBuffer |= this.data[this.pos] << this.bitCount;
      this.pos += 1;
      this.bitCount += 8;
    }
    const value = this.bitBuffer & ((1 << count) - 1);
    this.bitBuffer >>>= count;
    this.bitCount -= count;
    return value;
  }

  alignToByte(): void {
    this.bitBuffer = 0;
    this.bitCount = 0;
  }
}

interface Huffman {
  counts: number[];
  symbols: number[];
}

function buildHuffman(lengths: number[], maxBits: number): Huffman {
  const counts = new Array<number>(maxBits + 1).fill(0);
  for (const length of lengths) {
    if (length > 0) {
      counts[length] += 1;
    }
  }
  const offsets = new Array<number>(maxBits + 2).fill(0);
  for (let i = 1; i <= maxBits; i += 1) {
    offsets[i + 1] = offsets[i] + counts[i];
  }
  const symbols = new Array<number>(lengths.length).fill(0);
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    if (lengths[symbol] > 0) {
      symbols[offsets[lengths[symbol]]] = symbol;
      offsets[lengths[symbol]] += 1;
    }
  }
  return { counts, symbols };
}

function decodeSymbol(reader: BitReader, huffman: Huffman): number {
  let code = 0;
  let first = 0;
  let index = 0;
  for (let length = 1; length < huffman.counts.length; length += 1) {
    code |= reader.readBits(1);
    const count = huffman.counts[length];
    if (code - first < count) {
      return huffman.symbols[index + (code - first)];
    }
    index += count;
    first = (first + count) << 1;
    code <<= 1;
  }
  throw new Error('dem_inflate_bad_huffman_code');
}

function fixedLiteralHuffman(): Huffman {
  const lengths: number[] = [];
  for (let i = 0; i < 144; i += 1) lengths.push(8);
  for (let i = 144; i < 256; i += 1) lengths.push(9);
  for (let i = 256; i < 280; i += 1) lengths.push(7);
  for (let i = 280; i < 288; i += 1) lengths.push(8);
  return buildHuffman(lengths, 15);
}

function fixedDistanceHuffman(): Huffman {
  return buildHuffman(new Array<number>(30).fill(5), 15);
}

class Output {
  private buffer = new Uint8Array(1 << 16);
  private length = 0;

  push(byte: number): void {
    if (this.length === this.buffer.length) {
      const grown = new Uint8Array(this.buffer.length * 2);
      grown.set(this.buffer, 0);
      this.buffer = grown;
    }
    this.buffer[this.length] = byte & 0xff;
    this.length += 1;
  }

  copyBack(distance: number, count: number): void {
    if (distance <= 0 || distance > this.length) {
      throw new Error('dem_inflate_bad_distance');
    }
    for (let i = 0; i < count; i += 1) {
      this.push(this.buffer[this.length - distance]);
    }
  }

  toBytes(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

function inflateBlocks(reader: BitReader): Output {
  const output = new Output();
  let final = false;
  while (!final) {
    final = reader.readBits(1) === 1;
    const type = reader.readBits(2);
    if (type === 0) {
      inflateStored(reader, output);
    } else if (type === 1) {
      inflateHuffman(reader, output, fixedLiteralHuffman(), fixedDistanceHuffman());
    } else if (type === 2) {
      const tables = readDynamicTables(reader);
      inflateHuffman(reader, output, tables.literal, tables.distance);
    } else {
      throw new Error('dem_inflate_reserved_block_type');
    }
  }
  return output;
}

function inflateStored(reader: BitReader, output: Output): void {
  reader.alignToByte();
  const len = reader.readBits(16);
  const nlen = reader.readBits(16);
  if ((len ^ 0xffff) !== nlen) {
    throw new Error('dem_inflate_stored_length_mismatch');
  }
  for (let i = 0; i < len; i += 1) {
    output.push(reader.readBits(8));
  }
}

function inflateHuffman(reader: BitReader, output: Output, literal: Huffman, distance: Huffman): void {
  for (;;) {
    const symbol = decodeSymbol(reader, literal);
    if (symbol < 256) {
      output.push(symbol);
      continue;
    }
    if (symbol === 256) {
      return;
    }
    const lengthIndex = symbol - 257;
    if (lengthIndex < 0 || lengthIndex >= LENGTH_BASE.length) {
      throw new Error('dem_inflate_bad_length_code');
    }
    const length = LENGTH_BASE[lengthIndex] + reader.readBits(LENGTH_EXTRA[lengthIndex]);
    const distSymbol = decodeSymbol(reader, distance);
    if (distSymbol >= DIST_BASE.length) {
      throw new Error('dem_inflate_bad_distance_code');
    }
    const dist = DIST_BASE[distSymbol] + reader.readBits(DIST_EXTRA[distSymbol]);
    output.copyBack(dist, length);
  }
}

function readDynamicTables(reader: BitReader): { literal: Huffman; distance: Huffman } {
  const hlit = reader.readBits(5) + 257;
  const hdist = reader.readBits(5) + 1;
  const hclen = reader.readBits(4) + 4;
  const codeLengthLengths = new Array<number>(19).fill(0);
  for (let i = 0; i < hclen; i += 1) {
    codeLengthLengths[CODE_LENGTH_ORDER[i]] = reader.readBits(3);
  }
  const codeLengthHuffman = buildHuffman(codeLengthLengths, 7);

  const lengths: number[] = [];
  while (lengths.length < hlit + hdist) {
    const symbol = decodeSymbol(reader, codeLengthHuffman);
    if (symbol < 16) {
      lengths.push(symbol);
    } else if (symbol === 16) {
      if (lengths.length === 0) {
        throw new Error('dem_inflate_repeat_no_previous');
      }
      const previous = lengths[lengths.length - 1];
      const repeat = reader.readBits(2) + 3;
      for (let i = 0; i < repeat; i += 1) lengths.push(previous);
    } else if (symbol === 17) {
      const repeat = reader.readBits(3) + 3;
      for (let i = 0; i < repeat; i += 1) lengths.push(0);
    } else {
      const repeat = reader.readBits(7) + 11;
      for (let i = 0; i < repeat; i += 1) lengths.push(0);
    }
  }
  if (lengths.length !== hlit + hdist) {
    throw new Error('dem_inflate_code_length_overflow');
  }
  const literal = buildHuffman(lengths.slice(0, hlit), 15);
  const distance = buildHuffman(lengths.slice(hlit), 15);
  return { literal, distance };
}

/** adler32 (RFC 1950) over a byte range, modulo 65521. */
export function adler32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let a = 1;
  let b = 0;
  for (let i = start; i < end; i += 1) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * Inflate a zlib stream (RFC 1950). Throws on a malformed stream so callers can
 * treat any throw as "corrupt .dem body".
 */
export function inflateZlib(input: Uint8Array): Uint8Array {
  if (input.length < 6) {
    throw new Error('dem_inflate_truncated');
  }
  const cmf = input[0];
  const flg = input[1];
  if ((cmf & 0x0f) !== 8) {
    throw new Error('dem_inflate_bad_method');
  }
  if (((cmf << 8) | flg) % 31 !== 0) {
    throw new Error('dem_inflate_bad_header_check');
  }
  if ((flg & 0x20) !== 0) {
    throw new Error('dem_inflate_unsupported_preset_dictionary');
  }
  const reader = new BitReader(input, 2);
  const output = inflateBlocks(reader).toBytes();
  const expected = ((input[input.length - 4] << 24) |
    (input[input.length - 3] << 16) |
    (input[input.length - 2] << 8) |
    input[input.length - 1]) >>> 0;
  if (adler32(output) !== expected) {
    throw new Error('dem_inflate_adler_mismatch');
  }
  return output;
}

/**
 * Compress `input` into a **valid zlib stream using only stored (uncompressed)
 * DEFLATE blocks**. Not size-optimal, but every zlib inflater (the C++
 * `uncompress`, this module, browsers) decodes it, which is all the dem
 * encoder/round-trip tests and `tools/dem_verify.mjs` need.
 */
export function deflateStoredZlib(input: Uint8Array): Uint8Array {
  const out: number[] = [0x78, 0x01];
  let offset = 0;
  do {
    const length = Math.min(0xffff, input.length - offset);
    const final = offset + length >= input.length ? 1 : 0;
    out.push(final);
    out.push(length & 0xff, (length >> 8) & 0xff);
    const inverse = length ^ 0xffff;
    out.push(inverse & 0xff, (inverse >> 8) & 0xff);
    for (let i = 0; i < length; i += 1) {
      out.push(input[offset + i]);
    }
    offset += length;
  } while (offset < input.length);
  const checksum = adler32(input);
  out.push((checksum >>> 24) & 0xff, (checksum >>> 16) & 0xff, (checksum >>> 8) & 0xff, checksum & 0xff);
  return Uint8Array.from(out);
}

