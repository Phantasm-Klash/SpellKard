// WebCrypto-based provider (browser runtimes and any LayaAir build whose
// JSVM implements it). The LayaAir native runtime does NOT (measured) —
// client_provider.ts probes and falls back to the pure-TS provider.
//
// NOTE: lib-ES2020-only types (no DOM lib in the client core layer); the
// WebCrypto surface is referenced through minimal structural interfaces.

import type { CryptoProvider } from './provider';
import { bytesToHex, hexToBytes } from '../util/hex';

interface SubtleCryptoLike {
  importKey(
    format: string,
    keyData: Uint8Array,
    algorithm: { name: string },
    extractable: boolean,
    usages: string[],
  ): Promise<unknown>;
  sign(algorithm: { name: string }, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
  verify(
    algorithm: { name: string },
    key: unknown,
    signature: Uint8Array,
    data: Uint8Array,
  ): Promise<boolean>;
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
}

interface CryptoLike {
  subtle?: SubtleCryptoLike;
}

function toBuf(u: Uint8Array): Uint8Array {
  const out = new Uint8Array(u.length);
  out.set(u);
  return out;
}

export class WebCryptoProvider implements CryptoProvider {
  private subtle(): SubtleCryptoLike {
    const scope = globalThis as { crypto?: CryptoLike };
    const subtle = scope.crypto === undefined ? undefined : scope.crypto.subtle;
    if (subtle === undefined || subtle === null) {
      throw new Error('WebCrypto is unavailable in this runtime');
    }
    return subtle;
  }

  // Key generation is intentionally NOT implemented here: the client never
  // generates keys (the personal key pair is created on Nakama at Steam
  // binding). Tooling uses NodeCryptoProvider.

  async sign(privateKeyHex: string, data: Uint8Array): Promise<Uint8Array> {
    const key = await this.subtle().importKey(
      'raw',
      toBuf(hexToBytes(privateKeyHex)),
      { name: 'Ed25519' },
      false,
      ['sign'],
    );
    const sig = await this.subtle().sign({ name: 'Ed25519' }, key, toBuf(data));
    return new Uint8Array(sig);
  }

  async verify(
    publicKeyHex: string,
    data: Uint8Array,
    signature: Uint8Array,
  ): Promise<boolean> {
    try {
      const key = await this.subtle().importKey(
        'raw',
        toBuf(hexToBytes(publicKeyHex)),
        { name: 'Ed25519' },
        false,
        ['verify'],
      );
      return await this.subtle().verify(
        { name: 'Ed25519' },
        key,
        toBuf(signature),
        toBuf(data),
      );
    } catch {
      return false;
    }
  }

  async sha256Hex(data: Uint8Array): Promise<string> {
    const digest = await this.subtle().digest('SHA-256', toBuf(data));
    return bytesToHex(new Uint8Array(digest));
  }
}
