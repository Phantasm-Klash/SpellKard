// Self-contained UTF-8 codec. The core layer type-checks with lib ES2020
// only (no DOM), so TextEncoder/TextDecoder cannot be referenced here.
// All wire payloads in this module are JSON; the codec is total UTF-8.

export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    // Surrogate pair.
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out[i];
  return bytes;
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    let cp: number;
    let extra: number;
    if (b0 < 0x80) {
      cp = b0;
      extra = 0;
    } else if ((b0 & 0xe0) === 0xc0) {
      cp = b0 & 0x1f;
      extra = 1;
    } else if ((b0 & 0xf0) === 0xe0) {
      cp = b0 & 0x0f;
      extra = 2;
    } else if ((b0 & 0xf8) === 0xf0) {
      cp = b0 & 0x07;
      extra = 3;
    } else {
      // Invalid lead byte: replace with U+FFFD.
      out += '\ufffd';
      i++;
      continue;
    }
    let valid = true;
    for (let k = 1; k <= extra; k++) {
      const b = bytes[i + k];
      if (b === undefined || (b & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      cp = (cp << 6) | (b & 0x3f);
    }
    if (!valid) {
      out += '\ufffd';
      i++;
      continue;
    }
    if (cp > 0x10ffff) {
      out += '\ufffd';
      i += 1 + extra;
      continue;
    }
    if (cp >= 0x10000) {
      const v = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    } else {
      out += String.fromCharCode(cp);
    }
    i += 1 + extra;
  }
  return out;
}
