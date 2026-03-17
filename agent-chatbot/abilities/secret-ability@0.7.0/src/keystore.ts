/**
 * Keystore - Master key storage with OS keychain and file-based fallback
 *
 * Stores Age master keys in the OS keychain (macOS Keychain, GNOME Keyring, etc.)
 * when available. In environments without a keychain (containers, CI/CD), falls
 * back to a file-based store at ~/.kadi/keystore.json.
 *
 * Keys are indexed by vault path for multi-vault support.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const SERVICE = 'kadi-secrets';
const KEYSTORE_DIR = path.join(os.homedir(), '.kadi');
const KEYSTORE_PATH = path.join(KEYSTORE_DIR, 'keystore.json');

/**
 * Error thrown when keystore access fails.
 */
export class KeystoreError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = 'KeystoreError';
  }
}

// ── Keytar availability detection (cached) ──────────────────────────

type Keytar = typeof import('keytar');

/** Cached keytar module reference: null = not yet probed, false = unavailable */
let cachedKeytar: Keytar | false | null = null;

async function getKeytar(): Promise<Keytar | null> {
  if (cachedKeytar === false) return null;
  if (cachedKeytar !== null) return cachedKeytar;

  try {
    const mod = await import('keytar');
    const kt: Keytar = mod.default ?? mod;
    // Probe to verify the OS keychain is actually functional
    await kt.getPassword(SERVICE, '__kadi_probe__');
    cachedKeytar = kt;
    return kt;
  } catch {
    cachedKeytar = false;
    return null;
  }
}

/**
 * Execute a keytar operation, wrapping errors as KeystoreError.
 * Returns null if keytar is unavailable (caller should fall back to file).
 */
async function tryKeytar<T>(
  operation: (kt: Keytar) => Promise<T>,
  errorMessage: string
): Promise<{ value: T } | null> {
  const kt = await getKeytar();
  if (!kt) return null;

  try {
    return { value: await operation(kt) };
  } catch (err) {
    const cause = err instanceof Error ? err : undefined;
    throw new KeystoreError(
      `${errorMessage}: ${cause?.message ?? String(err)}`,
      cause
    );
  }
}

// ── File-based backend ──────────────────────────────────────────────

async function readKeystoreFile(): Promise<Record<string, string>> {
  let content: string;

  try {
    content = await fs.readFile(KEYSTORE_PATH, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }

  try {
    return JSON.parse(content) as Record<string, string>;
  } catch {
    throw new KeystoreError(`Corrupt keystore file: ${KEYSTORE_PATH}`);
  }
}

async function writeKeystoreFile(data: Record<string, string>): Promise<void> {
  await fs.mkdir(KEYSTORE_DIR, { recursive: true, mode: 0o700 });
  const tempPath = `${KEYSTORE_PATH}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
  await fs.rename(tempPath, KEYSTORE_PATH);
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Get master key from keystore.
 * @param vaultPath - Path to vault file (used as key identifier)
 * @returns The master key or null if not found
 */
export async function getMasterKey(vaultPath: string): Promise<string | null> {
  const result = await tryKeytar(
    (kt) => kt.getPassword(SERVICE, vaultPath),
    'Failed to access OS keychain'
  );
  if (result) return result.value;

  const store = await readKeystoreFile();
  return store[vaultPath] ?? null;
}

/**
 * Store master key in keystore.
 * @param vaultPath - Path to vault file (used as key identifier)
 * @param masterKey - Base64-encoded master key
 */
export async function setMasterKey(vaultPath: string, masterKey: string): Promise<void> {
  const result = await tryKeytar(
    (kt) => kt.setPassword(SERVICE, vaultPath, masterKey),
    'Failed to store in OS keychain'
  );
  if (result) return;

  const store = await readKeystoreFile();
  store[vaultPath] = masterKey;
  await writeKeystoreFile(store);
}

/**
 * Delete master key from keystore.
 * @param vaultPath - Path to vault file
 */
export async function deleteMasterKey(vaultPath: string): Promise<void> {
  const result = await tryKeytar(
    (kt) => kt.deletePassword(SERVICE, vaultPath),
    'Failed to delete from OS keychain'
  );
  if (result) return;

  const store = await readKeystoreFile();
  delete store[vaultPath];
  await writeKeystoreFile(store);
}

/**
 * Check if master key exists in keystore.
 * @param vaultPath - Path to vault file
 */
export async function hasMasterKey(vaultPath: string): Promise<boolean> {
  const key = await getMasterKey(vaultPath);
  return key !== null;
}
