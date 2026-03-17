/**
 * E2E encryption for secrets.
 *
 * Converts Ed25519 identity keypairs to X25519 and uses NaCl sealed boxes
 * for authenticated encryption. The broker and kadi-secret-service only
 * ever see ciphertext.
 *
 * Crypto flow:
 * - Ed25519 keypair (signing) → X25519 keypair (encryption) via ed2curve
 * - Encrypt: sealedbox.seal(plaintext, recipientX25519PublicKey)
 * - Decrypt: sealedbox.open(ciphertext, ownX25519PublicKey, ownX25519SecretKey)
 */

// @ts-expect-error - ed2curve doesn't have type definitions
import ed2curve from 'ed2curve';
// @ts-expect-error - tweetnacl-sealedbox-js doesn't have type definitions
import sealedbox from 'tweetnacl-sealedbox-js';
import type { Identity } from './identity.js';

interface EncryptionKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/**
 * Derive an X25519 encryption keypair from an Ed25519 identity.
 *
 * DER format offsets (stable for Ed25519):
 * - SPKI DER: 44 bytes total, raw public key at offset 12 (32 bytes)
 * - PKCS8 DER: 48 bytes total, raw seed at offset 16 (32 bytes)
 */
function deriveEncryptionKeyPair(identity: Identity): EncryptionKeyPair {
  // Extract raw 32-byte Ed25519 public key from SPKI DER (offset 12)
  const pubDer = Buffer.from(identity.publicKey, 'base64');
  const rawPublicKey = new Uint8Array(pubDer.subarray(12));

  // Extract raw 32-byte seed from PKCS8 DER (offset 16)
  const rawSeed = new Uint8Array(identity.privateKey.subarray(16, 48));

  // Reconstruct full 64-byte NaCl secret key: seed || publicKey
  const fullSecretKey = new Uint8Array(64);
  fullSecretKey.set(rawSeed, 0);
  fullSecretKey.set(rawPublicKey, 32);

  // Convert Ed25519 → X25519
  const x25519PublicKey = ed2curve.convertPublicKey(rawPublicKey) as Uint8Array | null;
  if (!x25519PublicKey) {
    throw new Error('Failed to convert Ed25519 public key to X25519');
  }

  const x25519SecretKey = ed2curve.convertSecretKey(fullSecretKey) as Uint8Array;

  return { publicKey: x25519PublicKey, secretKey: x25519SecretKey };
}

/**
 * Encrypt a value using own identity's X25519 public key.
 * Used when storing secrets in own namespace on the service.
 * Returns base64-encoded ciphertext.
 */
export function encrypt(value: string, identity: Identity): string {
  const keyPair = deriveEncryptionKeyPair(identity);
  const message = new TextEncoder().encode(value);
  const sealed = sealedbox.seal(message, keyPair.publicKey) as Uint8Array;
  return Buffer.from(sealed).toString('base64');
}

/**
 * Encrypt a value FOR a target agent's public key.
 * Only the target agent (holder of matching private key) can decrypt.
 * Used when sharing secrets with other agents.
 *
 * @param targetPublicKeyBase64 - Recipient's Ed25519 public key in base64 SPKI DER format
 */
export function encryptFor(value: string, targetPublicKeyBase64: string): string {
  const derBytes = Buffer.from(targetPublicKeyBase64, 'base64');
  const rawPublicKey = new Uint8Array(derBytes.subarray(12));

  const x25519PublicKey = ed2curve.convertPublicKey(rawPublicKey) as Uint8Array | null;
  if (!x25519PublicKey) {
    throw new Error('Failed to convert target Ed25519 public key to X25519');
  }

  const message = new TextEncoder().encode(value);
  const sealed = sealedbox.seal(message, x25519PublicKey) as Uint8Array;
  return Buffer.from(sealed).toString('base64');
}

/**
 * Decrypt a value using own identity's X25519 keypair.
 * Used for retrieving own secrets and shared secrets (encrypted for our key).
 * Takes base64-encoded ciphertext, returns plaintext string.
 */
export function decrypt(encrypted: string, identity: Identity): string {
  const keyPair = deriveEncryptionKeyPair(identity);
  const ciphertext = new Uint8Array(Buffer.from(encrypted, 'base64'));
  const decrypted = sealedbox.open(
    ciphertext,
    keyPair.publicKey,
    keyPair.secretKey
  ) as Uint8Array | null;

  if (!decrypted) {
    throw new Error('Failed to decrypt: invalid ciphertext or wrong key');
  }

  return new TextDecoder().decode(decrypted);
}
