/**
 * Akash Network Environment Configuration
 *
 * Pure, readonly configuration for Akash Network deployments.
 * NO file I/O, NO user prompts, NO environment variable loading.
 *
 * @module targets/akash/environment
 */

export type AkashNetwork = 'mainnet' | 'testnet';

/** Network configuration (RPC for transactions, REST for queries, chain ID) */
export interface NetworkConfiguration {
  readonly rpc: string;
  readonly rest: string;
  readonly chainId: string;
}

/** Mainnet RPC endpoints (ordered by priority, first is default) */
export const MAINNET_RPC_ENDPOINTS: readonly string[] = [
  'https://rpc.akashnet.net:443',
  'https://rpc.akash.forbole.com:443',
  'https://rpc-akash.ecostake.com:443',
  'https://akash-rpc.polkachu.com:443',
  'https://akash.c29r3.xyz:443/rpc'
] as const;

/** Mainnet REST API endpoints (LCD - Light Client Daemon) */
export const MAINNET_REST_ENDPOINTS: readonly string[] = [
  'https://api.akashnet.net:443',
  'https://api.akash.forbole.com:443',
] as const;

/** Testnet RPC endpoints */
export const TESTNET_RPC_ENDPOINTS: readonly string[] = [
  'https://rpc.sandbox-2.aksh.pw:443'
] as const;

/** Testnet REST API endpoints */
export const TESTNET_REST_ENDPOINTS: readonly string[] = [
  'https://api.sandbox-2.aksh.pw:443'
] as const;

/** Network configurations for mainnet and testnet */
export const AKASH_NETWORKS = {
  mainnet: {
    rpc: MAINNET_RPC_ENDPOINTS[0]!,
    rest: MAINNET_REST_ENDPOINTS[0]!,
    chainId: 'akashnet-2'
  },
  testnet: {
    rpc: TESTNET_RPC_ENDPOINTS[0]!,
    rest: TESTNET_REST_ENDPOINTS[0]!,
    chainId: 'sandbox-2'
  }
} as const;

/** Get network configuration */
export function getNetworkConfig(network: AkashNetwork): NetworkConfiguration {
  return AKASH_NETWORKS[network];
}

/** Get all RPC endpoints for network (for fallback/load balancing) */
export function getAllRpcEndpoints(network: AkashNetwork): readonly string[] {
  return network === 'mainnet' ? MAINNET_RPC_ENDPOINTS : TESTNET_RPC_ENDPOINTS;
}

/** Type guard: Check if string is valid AkashNetwork */
export function isAkashNetwork(value: string): value is AkashNetwork {
  return value === 'mainnet' || value === 'testnet';
}
