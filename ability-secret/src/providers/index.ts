/**
 * Provider Registry
 *
 * Manages remote vault provider instances. Each vault type maps to a provider
 * class. Providers are lazily instantiated and cached by vault name.
 */

import type { RemoteVaultProvider, RemoteVaultConfig } from './types.js';
import { KadiVaultProvider } from './kadi.js';

export type { RemoteVaultProvider, RemoteVaultConfig };

// =============================================================================
// Registry
// =============================================================================

const providers = new Map<string, RemoteVaultProvider>();

type ProviderFactory = () => RemoteVaultProvider;

const factories: Record<string, ProviderFactory> = {
  kadi: () => new KadiVaultProvider(),
};

/**
 * Get or create a provider for a vault.
 * Connects automatically if not already connected.
 */
export async function getProvider(
  vaultName: string,
  config: RemoteVaultConfig
): Promise<RemoteVaultProvider> {
  let provider = providers.get(vaultName);

  if (provider && provider.isConnected()) {
    return provider;
  }

  const factory = factories[config.type];
  if (!factory) {
    throw new Error(
      `Unknown vault type: '${config.type}'. Supported: ${Object.keys(factories).join(', ')}`
    );
  }

  provider = factory();
  await provider.connect(config);
  providers.set(vaultName, provider);

  return provider;
}

/**
 * Disconnect and remove a specific provider.
 */
export async function disconnectProvider(vaultName: string): Promise<void> {
  const provider = providers.get(vaultName);
  if (provider) {
    await provider.disconnect();
    providers.delete(vaultName);
  }
}

/**
 * Disconnect all providers. Called on shutdown.
 */
export async function disconnectAllProviders(): Promise<void> {
  const entries = Array.from(providers.entries());
  for (const [name, provider] of entries) {
    try {
      await provider.disconnect();
    } catch {
      // Best effort on shutdown
    }
    providers.delete(name);
  }
}
