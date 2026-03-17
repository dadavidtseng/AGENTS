/**
 * Provider System for Remote Vaults
 *
 * Resolves vault type to the appropriate provider implementation.
 * Local (age) vaults don't use providers - they're just file I/O + encryption.
 *
 * Connection Pooling:
 * Providers are cached by broker+network+vault+identity to reuse WebSocket
 * connections across multiple operations. Different identities get different
 * connections to prevent authentication mixing. Call disconnectAllProviders()
 * during shutdown.
 */

export * from './types.js';
export { KadiRemoteProvider } from './kadi.js';

import type { RemoteVaultProvider, RemoteVaultConfig } from './types.js';
import { KadiRemoteProvider } from './kadi.js';

// =============================================================================
// Connection Pool
// =============================================================================

const providerCache = new Map<string, RemoteVaultProvider>();

/**
 * Generate a cache key for a remote vault config.
 * Includes identity to prevent different agents from sharing connections.
 */
function getCacheKey(config: RemoteVaultConfig): string {
  return `${config.type}|${config.broker ?? ''}|${config.network ?? ''}|${config.vault ?? 'default'}|${config.identity.publicKey}`;
}

/**
 * Create a provider instance for the given vault type.
 */
function createProvider(type: string): RemoteVaultProvider {
  if (type === 'kadi') {
    return new KadiRemoteProvider();
  }
  // Future: add 'aws', 'hashicorp' cases here
  throw new Error(
    `Unsupported remote vault type: '${type}'. Supported types: kadi`
  );
}

/**
 * Get the appropriate provider for a remote vault config.
 * Providers are cached and reused across calls with the same config.
 *
 * @param config - Vault configuration from secrets.toml
 * @returns Connected provider instance
 * @throws If vault type is not supported
 */
export async function getRemoteProvider(
  config: RemoteVaultConfig
): Promise<RemoteVaultProvider> {
  const cacheKey = getCacheKey(config);

  // Return cached provider if still connected
  const cached = providerCache.get(cacheKey);
  if (cached?.isConnected()) {
    return cached;
  }

  // Remove stale connection from cache
  providerCache.delete(cacheKey);

  // Create, connect, and cache new provider
  const provider = createProvider(config.type);
  await provider.connect(config);
  providerCache.set(cacheKey, provider);
  return provider;
}

/**
 * Disconnect all cached providers.
 * Call this during application shutdown to release broker WebSocket connections.
 */
export async function disconnectAllProviders(): Promise<void> {
  const disconnects = [...providerCache.values()].map((p) => p.disconnect());
  await Promise.allSettled(disconnects);
  providerCache.clear();
}

/**
 * Disconnect a specific provider by config.
 * Removes it from the cache.
 */
export async function disconnectProvider(config: RemoteVaultConfig): Promise<void> {
  const cacheKey = getCacheKey(config);
  const provider = providerCache.get(cacheKey);
  if (provider) {
    await provider.disconnect();
    providerCache.delete(cacheKey);
  }
}

/**
 * Check if a vault type is a remote type (requires provider).
 */
export function isRemoteVaultType(type: string): boolean {
  return type === 'kadi';
  // Future: return ['kadi', 'aws', 'hashicorp'].includes(type);
}

/**
 * Check if a vault type is a local type (no provider, just file I/O).
 */
export function isLocalVaultType(type: string): boolean {
  return type === 'age';
}
