/**
 * V2 Encryption Module - ChaCha20-Poly1305 for local (age) vaults
 *
 * Encryption format: ENC[base64(nonce + ciphertext + tag)]
 * - nonce: 12 bytes
 * - ciphertext: variable length
 * - tag: 16 bytes (Poly1305 authentication tag)
 *
 * Master keys are stored in OS keychain, indexed by resolved config path.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import * as path from 'node:path';
import { getMasterKey, setMasterKey, deleteMasterKey, hasMasterKey } from '../keystore.js';

// =============================================================================
// Constants
// =============================================================================

const ENC_PREFIX = 'ENC[';
const ENC_SUFFIX = ']';
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

// =============================================================================
// ENC[...] Format
// =============================================================================

/**
 * Check if a value is in ENC[...] format.
 * Type guard that narrows unknown to string.
 */
export function isEncrypted(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return value.startsWith(ENC_PREFIX) && value.endsWith(ENC_SUFFIX);
}

/**
 * Extract the base64 payload from ENC[...] format.
 */
export function extractPayload(encValue: string): string {
  if (!isEncrypted(encValue)) {
    throw new Error('Value is not in ENC[...] format');
  }
  return encValue.slice(ENC_PREFIX.length, -ENC_SUFFIX.length);
}

/**
 * Wrap a base64 payload in ENC[...] format.
 */
export function wrapPayload(base64: string): string {
  return `${ENC_PREFIX}${base64}${ENC_SUFFIX}`;
}

// =============================================================================
// ChaCha20-Poly1305 Encryption
// =============================================================================

/**
 * Validate key length.
 */
function validateKey(key: Buffer): void {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Invalid key length: expected ${KEY_LENGTH}, got ${key.length}`);
  }
}

/**
 * Encrypt plaintext using ChaCha20-Poly1305.
 * Returns ENC[base64(nonce + ciphertext + tag)].
 */
export function encrypt(plaintext: string, key: Buffer): string {
  validateKey(key);

  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const blob = Buffer.concat([nonce, encrypted, tag]);
  return wrapPayload(blob.toString('base64'));
}

/**
 * Decrypt an ENC[...] value using ChaCha20-Poly1305.
 * Returns the plaintext string.
 */
export function decrypt(encValue: string, key: Buffer): string {
  validateKey(key);

  const payload = extractPayload(encValue);
  const blob = Buffer.from(payload, 'base64');

  if (blob.length < NONCE_LENGTH + TAG_LENGTH) {
    throw new Error('Invalid ciphertext: too short');
  }

  const nonce = blob.subarray(0, NONCE_LENGTH);
  const tag = blob.subarray(-TAG_LENGTH);
  const encrypted = blob.subarray(NONCE_LENGTH, -TAG_LENGTH);

  const decipher = createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Decryption failed: invalid ciphertext or wrong key');
  }
}

// =============================================================================
// Master Key Management
// =============================================================================

/**
 * Get the keychain key for a config path.
 * Uses resolved absolute path for consistency.
 */
function getKeychainKey(configPath: string): string {
  return path.resolve(configPath);
}

/**
 * Initialize a new master key for a config file.
 * Throws if key already exists.
 */
export async function initMasterKey(configPath: string): Promise<void> {
  const keychainKey = getKeychainKey(configPath);

  if (await hasMasterKey(keychainKey)) {
    throw new Error(`Master key already exists for: ${configPath}`);
  }

  const key = randomBytes(KEY_LENGTH);
  await setMasterKey(keychainKey, key.toString('base64'));
}

/**
 * Get the master key for a config file.
 * Returns null if not found.
 */
export async function loadMasterKey(configPath: string): Promise<Buffer | null> {
  const keychainKey = getKeychainKey(configPath);
  const keyBase64 = await getMasterKey(keychainKey);

  if (!keyBase64) {
    return null;
  }

  return Buffer.from(keyBase64, 'base64');
}

/**
 * Get the master key for a config file.
 * Throws if not found.
 */
export async function requireMasterKey(configPath: string): Promise<Buffer> {
  const key = await loadMasterKey(configPath);

  if (!key) {
    throw new Error(
      `Master key not found for: ${configPath}\n` +
        `Run 'kadi secret create <vault>' to initialize.`
    );
  }

  return key;
}

/**
 * Delete the master key for a config file.
 */
export async function removeMasterKey(configPath: string): Promise<void> {
  const keychainKey = getKeychainKey(configPath);
  await deleteMasterKey(keychainKey);
}

/**
 * Check if a master key exists for a config file.
 */
export async function masterKeyExists(configPath: string): Promise<boolean> {
  const keychainKey = getKeychainKey(configPath);
  return hasMasterKey(keychainKey);
}
