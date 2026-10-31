// Abstraction over the crypto the Steam integration needs (Ed25519 + SHA-256).
// Two providers ship: WebCryptoProvider (browser + LayaAir native JSVM) and
// NodeCryptoProvider (local test runs + reference server tooling).

export interface Ed25519KeyPair {
  /** 32-byte raw public key, hex (64 chars). */
  publicKeyHex: string;
  /** 32-byte raw private key, hex (64 chars). */
  privateKeyHex: string;
}

export interface CryptoProvider {
  /**
   * Optional: implemented where key generation is available (server / tooling
   * via NodeCryptoProvider). Client runtimes never generate keys — the
   * personal key pair is created by the Nakama service at Steam binding.
   */
  generateEd25519KeyPair?(): Promise<Ed25519KeyPair>;
  sign(privateKeyHex: string, data: Uint8Array): Promise<Uint8Array>;
  verify(publicKeyHex: string, data: Uint8Array, signature: Uint8Array): Promise<boolean>;
  sha256Hex(data: Uint8Array): Promise<string>;
}
