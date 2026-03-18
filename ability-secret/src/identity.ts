/**
 * Identity types for ability-secret.
 *
 * The Identity interface represents an Ed25519 keypair used for:
 * - Authenticating with KĀDI brokers
 * - Encrypting secrets for own storage (E2E)
 * - Decrypting secrets shared by other agents
 *
 * Agents must provide their own identity when using remote vault operations.
 * Identity management (creation, persistence) is the responsibility of the
 * agent or CLI, not this library.
 */

export interface Identity {
  /** PKCS8 DER format as Buffer. Raw 32-byte seed at offset 16. */
  privateKey: Buffer;
  /** Base64-encoded SPKI DER. Raw 32-byte Ed25519 key at offset 12. */
  publicKey: string;
}
