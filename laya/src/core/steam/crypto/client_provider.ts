// Client crypto provider selection.
//
// The LayaAir native runtime implements almost none of WebCrypto (measured:
// `crypto.subtle` only has SHA-1), so the client cannot rely on it for the
// Ed25519 + SHA-256 the DLC manifest pipeline needs. This module:
//
//   1. probes WebCrypto with the RFC 8032 test vector 1 (empty message);
//   2. uses WebCryptoProvider when the probe verifies;
//   3. otherwise falls back to PureTsCryptoProvider (pure-TS Ed25519 verify +
//      SHA-256, no runtime dependencies).
//
// The client never signs (the personal private key stays on Nakama);
// PureTsCryptoProvider.sign rejects loudly instead of pretending.

import type { CryptoProvider } from './provider';
import { WebCryptoProvider } from './web_crypto_provider';
import { ed25519Verify } from './pure_ed25519';
import { sha256 } from './pure_sha256';
import { bytesToHex, hexToBytes } from '../util/hex';

export class PureTsCryptoProvider implements CryptoProvider {
  async sign(): Promise<Uint8Array> {
    throw new Error(
      'PureTsCryptoProvider cannot sign (client never signs; use NodeCryptoProvider or WebCrypto)',
    );
  }

  async verify(
    publicKeyHex: string,
    data: Uint8Array,
    signature: Uint8Array,
  ): Promise<boolean> {
    return ed25519Verify(publicKeyHex, data, bytesToHex(signature));
  }

  async sha256Hex(data: Uint8Array): Promise<string> {
    return bytesToHex(sha256(data));
  }
}

// RFC 8032 §7.1 test vector 1 (empty message) — used to probe whether the
// runtime's WebCrypto actually supports Ed25519 verify.
const RFC_PUB = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
const RFC_SIG =
  'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b';

let probePromise: Promise<CryptoProvider> | null = null;

/** Pick the best available client crypto provider (memoized). */
export function createClientCrypto(): Promise<CryptoProvider> {
  if (probePromise === null) {
    probePromise = (async () => {
      try {
        const web = new WebCryptoProvider();
        const ok = await web.verify(RFC_PUB, new Uint8Array(0), hexToBytes(RFC_SIG));
        if (ok) return web;
      } catch {
        // fall through to the pure-TS provider
      }
      return new PureTsCryptoProvider();
    })();
  }
  return probePromise;
}
