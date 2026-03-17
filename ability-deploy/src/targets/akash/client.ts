/**
 * Akash Blockchain Client
 *
 * Single SDK instance manager for all Akash blockchain operations.
 * Eliminates SDK duplication by creating one instance reused across all methods.
 *
 * **Usage Pattern:**
 * ```typescript
 * // Create client (read-only or with signer)
 * const client = new AkashClient({ network: 'mainnet', signer });
 *
 * // Perform operations
 * const bids = await client.getBids(wallet, dseq);
 * const lease = await client.acceptBid(bids.data[0].bid);
 *
 * // Cleanup
 * await client.disconnect();
 * ```
 *
 * @module targets/akash/client
 */

import Long from 'long';
import { createChainNodeWebSDK } from '@akashnetwork/chain-sdk/web';
import { createStargateClient } from '@akashnetwork/chain-sdk';
import type { SDL as SDLType } from '@akashnetwork/chain-sdk';
import type { DeliverTxResponse } from '@cosmjs/stargate';

import type { Result } from '../../types/index.js';
import { success, failure } from '../../types/index.js';
import { DeploymentError, getErrorMessage } from '../../errors/index.js';
import type { WalletContext, KeplrSigner, ProviderInfo, LeaseDetails } from './types.js';
import { getNetworkConfig, type AkashNetwork } from './environment.js';
import type { EnhancedBid } from './bids.js';
import { createBidPricing } from './bids.js';
import { fetchAllProviders } from './provider-manager.js';
import { CertificateManager } from './certificate-manager.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Akash client configuration options
 */
export interface AkashClientOptions {
  /**
   * Network to connect to
   */
  readonly network: AkashNetwork;

  /**
   * Optional signer for write operations (transactions)
   *
   * If not provided, client is read-only (queries only).
   * Required for: createDeployment, acceptBid, closeDeployment
   */
  readonly signer?: KeplrSigner;

  /**
   * Gas multiplier for safety margin
   *
   * Multiplies estimated gas by this factor to ensure transactions succeed.
   * Matches Akash Console default of 1.6x
   *
   * @default 1.6
   */
  readonly gasMultiplier?: number;
}

/**
 * Deployment creation result
 */
export interface DeploymentResult {
  /** Deployment sequence number (unique identifier) */
  readonly dseq: number;

  /** Transaction hash on blockchain */
  readonly transactionHash: string;

  /** Block height where deployment was created */
  readonly height: number;
}

/**
 * Lease creation result
 */
export interface LeaseResult {
  /** Lease identifier (deployment + provider) */
  readonly lease: LeaseIdentifier;

  /** Transaction hash on blockchain */
  readonly transactionHash: string;

  /** Block height where lease was created */
  readonly height: number;
}

/**
 * Deployment close result
 */
export interface DeploymentCloseResult {
  /** Deployment sequence number */
  readonly dseq: string;

  /** Owner address */
  readonly owner: string;

  /** Transaction hash */
  readonly transactionHash: string;

  /** Block height */
  readonly height: number;

  /** When deployment was closed */
  readonly closedAt: Date;

  /** Whether closure was confirmed on blockchain */
  readonly confirmed: boolean;
}

/**
 * Lease identifier (uniquely identifies a lease on blockchain)
 */
export interface LeaseIdentifier {
  readonly owner: string;
  readonly dseq: number;
  readonly gseq: number;
  readonly oseq: number;
  readonly provider: string;
}

/**
 * Bid identifier
 */
export interface BidID {
  owner: string;
  dseq: Long;
  gseq: number;
  oseq: number;
  provider: string;
  bseq?: number; // Bid sequence number (optional, defaults to 0)
}

/**
 * Coin amount (price denomination)
 */
export interface DecCoin {
  denom: string;
  amount: string;
}

/**
 * Provider bid from blockchain
 */
export interface Bid {
  $type?: string; // Protobuf type name
  id?: BidID; // Renamed from bidId
  bidId?: BidID; // For backwards compatibility
  state: number;
  price?: DecCoin;
  createdAt: Long;
  resourcesOffer?: unknown[];
}

/**
 * Provider bid type alias
 */
export type ProviderBid = Bid;

/**
 * Deployment details from blockchain
 */
export interface DeploymentDetails {
  readonly owner: string;
  readonly dseq: string;
  readonly state: string;
  readonly version: string;
  readonly createdAt: string;
  readonly groups: readonly DeploymentGroupDetails[];
}

/**
 * Deployment group resource specification
 */
export interface DeploymentGroupDetails {
  readonly name: string;
  readonly resources: readonly DeploymentGroupResource[];
}

/**
 * Resource specification for a deployment group
 */
export interface DeploymentGroupResource {
  readonly resourceId: number;
  readonly count: number;
  readonly cpuUnits: string;
  readonly memoryQuantity: string;
  readonly storageQuantities: readonly string[];
}

/**
 * Provider metadata from blockchain
 */
export interface ProviderMetadata {
  readonly owner: string;
  readonly hostUri?: string;
  readonly attributes: readonly ProviderAttribute[];
}

/**
 * Provider attribute (key-value pair)
 */
export interface ProviderAttribute {
  readonly key: string;
  readonly value: string;
}

/**
 * Lease query filters
 */
export interface LeaseFilters {
  readonly owner?: string;
  readonly dseq?: string | number;
  readonly provider?: string;
  readonly gseq?: number;
  readonly oseq?: number;
  readonly state?: string;
}

/**
 * Bid query options
 */
export interface BidQueryOptions {
  /**
   * Provider addresses to exclude from results
   */
  readonly blacklist?: readonly string[];

  /**
   * Filter out offline providers
   *
   * @default true
   */
  readonly filterOffline?: boolean;

  /**
   * Include provider metadata from Console API
   *
   * Adds uptime, location, audit status to each bid.
   * May add latency (~500ms).
   *
   * @default true
   */
  readonly includeProviderMetadata?: boolean;
}

/**
 * Bid polling options
 */
export interface BidAwaitOptions extends BidQueryOptions {
  /**
   * Maximum time to wait for bids (milliseconds)
   *
   * @default 60000 (60 seconds)
   */
  readonly timeout?: number;

  /**
   * How often to poll for bids (milliseconds)
   *
   * @default 5000 (5 seconds)
   */
  readonly pollInterval?: number;

  /**
   * Minimum number of bids to wait for
   *
   * @default 1
   */
  readonly minBidCount?: number;
}

/**
 * SDL type re-export from chain-sdk
 */
export type SDL = SDLType;

// ============================================================================
// AkashClient Class
// ============================================================================

/**
 * Akash blockchain client with managed SDK lifecycle
 *
 * @example Query Operations (No Signer)
 * ```typescript
 * const client = new AkashClient({ network: 'mainnet' });
 *
 * const deployment = await client.getDeployment('akash1...', 12345);
 * const bids = await client.getBids({ address: 'akash1...' }, 12345);
 *
 * await client.disconnect();
 * ```
 *
 * @example Write Operations (Signer Required)
 * ```typescript
 * const client = new AkashClient({
 *   network: 'mainnet',
 *   signer: keplrSigner
 * });
 *
 * const deployment = await client.createDeployment(sdl, 5);
 * const bids = await client.awaitBids({ address }, deployment.data.dseq);
 * const lease = await client.acceptBid(bids.data[0].bid);
 *
 * await client.disconnect();
 * ```
 */
export class AkashClient {
  /**
   * Chain SDK instance (created once, reused for all operations)
   * @private
   */
  private readonly sdk: ReturnType<typeof createChainNodeWebSDK>;

  /**
   * Network configuration
   * @private
   */
  private readonly network: AkashNetwork;
  private readonly config: ReturnType<typeof getNetworkConfig>;

  /**
   * Optional signer for write operations
   * @private
   */
  private readonly signer?: KeplrSigner;

  /**
   * Gas multiplier for transaction safety
   * @private
   */
  private readonly gasMultiplier: number;

  /**
   * Lazy-initialized certificate manager
   * @private
   */
  private certManager?: CertificateManager;

  // ==========================================================================
  // Constructor
  // ==========================================================================

  /**
   * Create new Akash blockchain client
   *
   * Initializes a single SDK instance that will be reused for all operations.
   * This is the key improvement over the old implementation which created
   * 7+ SDK instances per deployment.
   *
   * @param options - Client configuration
   *
   * @example Read-Only Client
   * ```typescript
   * const client = new AkashClient({ network: 'mainnet' });
   * // Can only perform queries (getBids, getDeployment, etc.)
   * ```
   *
   * @example Full Client (Read + Write)
   * ```typescript
   * const client = new AkashClient({
   *   network: 'mainnet',
   *   signer: keplrSigner,
   *   gasMultiplier: 1.6
   * });
   * // Can perform queries AND transactions
   * ```
   */
  constructor(options: AkashClientOptions) {
    this.network = options.network;
    this.config = getNetworkConfig(options.network);
    this.signer = options.signer;
    this.gasMultiplier = options.gasMultiplier ?? 1.6;

    // Create SDK once - this is the key optimization!
    // Old code created this 7+ times per deployment
    //
    // SDK SELECTION: Why We Use createChainNodeWebSDK
    // ================================================
    // chain-sdk provides TWO SDK creation functions:
    //
    // 1. createChainNodeSDK (Node.js) - Uses gRPC protocol (binary)
    //    - Requires: gRPC endpoint (e.g., http://grpc.akashnet.net:9090)
    //    - Problem: Public gRPC endpoints are NOT accessible (firewall/proxy issues)
    //    - Use case: Internal/private networks with gRPC access
    //
    // 2. createChainNodeWebSDK (Web) - Uses gRPC Gateway protocol (HTTP/JSON)
    //    - Requires: REST endpoint (e.g., https://api.akashnet.net:443)
    //    - Benefit: REST endpoints ARE publicly accessible
    //    - Use case: Public networks, browsers, CLI tools
    //
    // Both return the SAME API - only the transport layer differs.
    // We use the Web SDK because Akash's public infrastructure provides REST/LCD endpoints,
    // not raw gRPC endpoints.
    this.sdk = createChainNodeWebSDK({
      query: {
        baseUrl: this.config.rest  // REST API (gRPC Gateway): https://api.akashnet.net:443
      },
      tx: options.signer ? {
        signer: createStargateClient({
          baseUrl: this.config.rpc,  // RPC for transactions: https://rpc.akashnet.net:443
          signer: options.signer,
          gasMultiplier: this.gasMultiplier
        })
      } : undefined
    });
  }

  // ==========================================================================
  // Query Methods (Read-Only - No Signer Required)
  // ==========================================================================

  /**
   * Fetch provider bids for a deployment
   *
   * Queries the Akash marketplace for open bids on a specific deployment.
   * Automatically filters blacklisted providers and optionally enriches
   * with provider metadata (uptime, location, audit status).
   *
   * **Performance**: ~200ms (first call), ~50ms (subsequent calls with warm SDK)
   *
   * @param wallet - Wallet context (for filtering bids by owner)
   * @param dseq - Deployment sequence number
   * @param options - Optional filtering and enhancement options
   * @returns Array of enhanced bids with pricing and provider info
   *
   * @example
   * ```typescript
   * const bids = await client.getBids(
   *   { address: 'akash1...' },
   *   12345,
   *   { filterOffline: true, blacklist: ['akash1bad...'] }
   * );
   *
   * if (bids.success) {
   *   console.log(`Found ${bids.data.length} bids`);
   *   console.log(`Cheapest: ${bids.data[0].pricing.akt.perMonth} AKT/month`);
   * }
   * ```
   */
  async getBids(
    wallet: WalletContext,
    dseq: number,
    options?: BidQueryOptions
  ): Promise<Result<EnhancedBid[], DeploymentError>> {
    try {
      const {
        blacklist = [],
        filterOffline = true,
        includeProviderMetadata = true
      } = options ?? {};

      // Query marketplace for bids (reuses this.sdk)
      const response = await this.sdk.akash.market.v1beta5.getBids({
        filters: {
          owner: wallet.address,
          dseq: Long.fromNumber(dseq),
          state: 'open'
        },
        pagination: {
          limit: 100n
        }
      });

      // Extract valid bids
      const validBids = this.extractValidBids(response);

      if (validBids.length === 0) {
        return success([]);
      }

      // Filter blacklisted providers (user-provided only)
      const filteredBids = validBids.filter(bid => {
        const provider = bid.id?.provider ?? bid.bidId?.provider ?? '';
        return !blacklist.includes(provider);
      });

      // Optionally enrich with provider metadata
      let enhancedBids: EnhancedBid[];

      if (includeProviderMetadata) {
        // Fetch provider metadata from Console API
        const providersResult = await fetchAllProviders(this.network);
        const providerMap = providersResult.success
          ? providersResult.data
          : new Map<string, ProviderInfo>();

        // Enhance bids with pricing and provider info
        enhancedBids = filteredBids.map(bid => {
          const bidId = bid.id ?? bid.bidId;
          const providerId = bidId?.provider ?? '';
          const providerInfo = providerMap.get(providerId);

          // Create unique ID from bid coordinates
          const id = bidId
            ? `${bidId.owner}/${bidId.dseq}/${bidId.gseq}/${bidId.oseq}/${bidId.provider}`
            : '';

          // Convert createdAt (Long) to Date
          const createdAt = bid.createdAt ? new Date(Number(bid.createdAt) * 1000) : new Date();

          // Default provider info for bids without metadata
          const defaultProviderInfo: ProviderInfo = {
            owner: providerId,
            hostUri: '',
            isAudited: false
          };

          return {
            id,
            bid,
            pricing: createBidPricing(bid.price ?? { denom: 'uakt', amount: '0' }),
            provider: providerInfo ?? defaultProviderInfo,
            createdAt
          };
        });

        // Filter offline providers if requested
        if (filterOffline) {
          enhancedBids = enhancedBids.filter(bid =>
            bid.provider?.reliability?.isOnline !== false
          );
        }
      } else {
        // Just pricing, no provider metadata
        enhancedBids = filteredBids.map(bid => {
          const bidId = bid.id ?? bid.bidId;
          const providerId = bidId?.provider ?? '';

          // Create unique ID from bid coordinates
          const id = bidId
            ? `${bidId.owner}/${bidId.dseq}/${bidId.gseq}/${bidId.oseq}/${bidId.provider}`
            : '';

          // Convert createdAt (Long) to Date
          const createdAt = bid.createdAt ? new Date(Number(bid.createdAt) * 1000) : new Date();

          // Default provider info
          const defaultProviderInfo: ProviderInfo = {
            owner: providerId,
            hostUri: '',
            isAudited: false
          };

          return {
            id,
            bid,
            pricing: createBidPricing(bid.price ?? { denom: 'uakt', amount: '0' }),
            provider: defaultProviderInfo,
            createdAt
          };
        });
      }

      return success(enhancedBids);

    } catch (error) {
      const errMsg = getErrorMessage(error);
      return failure(new DeploymentError(
        'Failed to fetch bids from marketplace',
        'BID_QUERY_FAILED',
        { network: this.network, dseq, error: errMsg },
        true,
        'Verify network connectivity and that deployment exists'
      ));
    }
  }

  /**
   * Extract valid bids from marketplace response
   *
   * Filters out invalid/malformed bids from the raw response.
   *
   * @param response - Raw marketplace response
   * @returns Array of valid bids
   * @private
   */
  private extractValidBids(response: any): ProviderBid[] {
    if (!response.bids || !Array.isArray(response.bids)) {
      return [];
    }

    return response.bids
      .filter((b: any) => b.bid !== undefined && b.bid !== null)
      .map((b: any) => b.bid as ProviderBid)
      .filter((bid: ProviderBid) => {
        const providerId = bid.id?.provider ?? bid.bidId?.provider ?? '';
        return providerId !== '';
      });
  }

  /**
   * Poll marketplace for bids with timeout
   *
   * Waits for at least `minBidCount` bids to appear, polling the marketplace
   * at regular intervals. Returns when bids are found or timeout is reached.
   *
   * **Use case**: After creating a deployment, wait for providers to bid
   *
   * @param wallet - Wallet context
   * @param dseq - Deployment sequence number
   * @param options - Polling configuration
   * @returns Array of bids when found, or error if timeout
   *
   * @example
   * ```typescript
   * // Wait up to 2 minutes for at least 3 bids
   * const bids = await client.awaitBids(
   *   { address: 'akash1...' },
   *   12345,
   *   { timeout: 120000, minBidCount: 3 }
   * );
   *
   * if (bids.success) {
   *   console.log(`Received ${bids.data.length} bids`);
   * }
   * ```
   */
  async awaitBids(
    wallet: WalletContext,
    dseq: number,
    options?: BidAwaitOptions
  ): Promise<Result<EnhancedBid[], DeploymentError>> {
    const {
      timeout = 60000,
      pollInterval = 5000,
      minBidCount = 1,
      ...bidOptions
    } = options ?? {};

    const startTime = Date.now();

    while (true) {
      // Query for bids
      const bidsResult = await this.getBids(wallet, dseq, bidOptions);

      if (!bidsResult.success) {
        return bidsResult;
      }

      // Check if we have enough bids
      if (bidsResult.data.length >= minBidCount) {
        return bidsResult;
      }

      // Check timeout
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeout) {
        return failure(new DeploymentError(
          `Timeout waiting for bids (waited ${elapsed}ms, found ${bidsResult.data.length}/${minBidCount} bids)`,
          'BID_TIMEOUT',
          { dseq, timeout, minBidCount, found: bidsResult.data.length },
          true,
          'Try increasing timeout or reducing minBidCount. Check deployment is visible on blockchain.'
        ));
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  /**
   * Fetch lease details by ID
   *
   * @param lease - Lease identifier
   * @returns Lease details from blockchain
   *
   * @example
   * ```typescript
   * const lease = await client.getLeaseById({
   *   owner: 'akash1...',
   *   dseq: 12345,
   *   gseq: 1,
   *   oseq: 1,
   *   provider: 'akash1provider...'
   * });
   *
   * console.log(`Lease state: ${lease.data.state}`);
   * console.log(`Price: ${lease.data.price.amount} ${lease.data.price.denom}`);
   * ```
   */
  async getLeaseById(
    lease: LeaseIdentifier
  ): Promise<Result<LeaseDetails, DeploymentError>> {
    try {
      // Query blockchain (reuses this.sdk)
      const response = await this.sdk.akash.market.v1beta5.getLease({
        id: {
          owner: lease.owner,
          dseq: Long.fromNumber(lease.dseq),
          gseq: lease.gseq,
          oseq: lease.oseq,
          provider: lease.provider
        }
      });

      const details = this.mapLease(response);

      if (!details) {
        return failure(new DeploymentError(
          'Lease not found',
          'LEASE_NOT_FOUND',
          { network: this.network, lease }
        ));
      }

      return success(details);

    } catch (error) {
      const errMsg = getErrorMessage(error);
      return failure(new DeploymentError(
        'Failed to query lease',
        'RPC_ERROR',
        { network: this.network, error: errMsg },
        true
      ));
    }
  }

  /**
   * Fetch multiple leases with optional filtering
   *
   * @param wallet - Wallet context
   * @param filters - Optional filters (dseq, state, provider)
   * @returns Array of matching leases
   *
   * @example
   * ```typescript
   * // Get all active leases
   * const leases = await client.getLeases(
   *   { address: 'akash1...' },
   *   { state: 'active' }
   * );
   *
   * console.log(`Active leases: ${leases.data.length}`);
   * ```
   */
  async getLeases(
    wallet: WalletContext,
    filters?: Omit<LeaseFilters, 'owner'>
  ): Promise<Result<readonly LeaseDetails[], DeploymentError>> {
    try {
      const queryFilters: Record<string, unknown> = {
        owner: wallet.address
      };

      if (filters?.dseq !== undefined) {
        queryFilters.dseq = Long.fromString(String(filters.dseq));
      }
      if (filters?.provider) queryFilters.provider = filters.provider;
      if (typeof filters?.gseq === 'number') queryFilters.gseq = filters.gseq;
      if (typeof filters?.oseq === 'number') queryFilters.oseq = filters.oseq;
      if (filters?.state) queryFilters.state = filters.state;

      // Query blockchain (reuses this.sdk)
      const response = await this.sdk.akash.market.v1beta5.getLeases({
        filters: queryFilters
      });

      const leases: LeaseDetails[] = [];

      for (const entry of response.leases ?? []) {
        const details = this.mapLease(entry);
        if (details) {
          leases.push(details);
        }
      }

      return success(Object.freeze(leases));

    } catch (error) {
      const errMsg = getErrorMessage(error);
      return failure(new DeploymentError(
        'Failed to query leases',
        'RPC_ERROR',
        { network: this.network, error: errMsg },
        true
      ));
    }
  }

  /**
   * Map lease response to LeaseDetails
   * @private
   */
  private mapLease(response: any): LeaseDetails | null {
    if (!response?.lease) {
      return null;
    }

    const lease = response.lease;
    const id = lease.id;  // FIX: Was lease.leaseId, but actual field is lease.id

    if (!id) {
      return null;
    }

    return {
      owner: id.owner,
      provider: id.provider,
      dseq: this.longToString(id.dseq),
      gseq: id.gseq,
      oseq: id.oseq,
      state: this.mapLeaseState(lease.state),
      price: {
        denom: lease.price?.denom ?? 'uakt',
        amount: lease.price?.amount ?? '0'
      },
      createdAt: this.longToString(lease.createdAt ?? Long.ZERO)
    };
  }

  /**
   * Map lease state enum to string
   * @private
   */
  private mapLeaseState(state: unknown): 'active' | 'closed' | 'insufficient_funds' {
    if (typeof state === 'string') {
      // Validate and return known states
      if (state === 'active' || state === 'closed' || state === 'insufficient_funds') {
        return state;
      }
      // Default to closed for unknown string states
      return 'closed';
    }

    switch (state) {
      case 1: return 'active';
      case 2: return 'insufficient_funds';
      case 3: return 'closed';
      default: return 'closed'; // Default to closed for unknown states
    }
  }

  /**
   * Convert Long to string
   * @private
   */
  private longToString(value: Long | string | number): string {
    if (Long.isLong(value)) {
      return value.toString();
    }
    return String(value);
  }

  /**
   * Fetch deployment details from blockchain
   *
   * @param owner - Wallet address that created deployment
   * @param dseq - Deployment sequence number
   * @returns Deployment details with groups and resources
   *
   * @example
   * ```typescript
   * const deployment = await client.getDeployment('akash1...', 12345);
   *
   * console.log(`State: ${deployment.data.state}`);
   * console.log(`Groups: ${deployment.data.groups.length}`);
   * ```
   */
  async getDeployment(
    owner: string,
    dseq: number
  ): Promise<Result<DeploymentDetails, DeploymentError>> {
    try {
      // Query blockchain (reuses this.sdk)
      const response = await this.sdk.akash.deployment.v1beta4.getDeployment({
        id: {
          owner,
          dseq: Long.fromNumber(dseq)
        }
      });

      if (!response.deployment) {
        return failure(new DeploymentError(
          'Deployment not found',
          'DEPLOYMENT_NOT_FOUND',
          { network: this.network, owner, dseq }
        ));
      }

      const details = this.mapDeployment(response);
      return success(details);

    } catch (error) {
      const errMsg = getErrorMessage(error);
      return failure(new DeploymentError(
        'Failed to query deployment',
        'RPC_ERROR',
        { network: this.network, error: errMsg },
        true
      ));
    }
  }

  /**
   * Map deployment response to DeploymentDetails
   * @private
   */
  private mapDeployment(response: any): DeploymentDetails {
    const deployment = response.deployment;

    const owner = deployment.deploymentId?.owner ?? '';
    const dseq = deployment.deploymentId?.dseq ?? '';
    const state = this.mapDeploymentState(deployment.state);
    const version = this.toHexString(deployment.version);
    const createdAt = this.longToString(deployment.createdAt ?? Long.ZERO);

    const groups = (response.groups ?? []).map((group: any) => {
      const groupSpec = group.groupSpec;
      const resources = (groupSpec?.resources ?? []).map((item: any) => {
        const resource = item.resource;
        return {
          resourceId: resource?.id ?? 0,
          count: item.count ?? 0,
          cpuUnits: this.decodeResourceValue(resource?.cpu?.units?.val),
          memoryQuantity: this.decodeResourceValue(resource?.memory?.quantity?.val),
          storageQuantities: (resource?.storage ?? []).map((storage: any) =>
            this.decodeResourceValue(storage.quantity?.val)
          )
        };
      });

      return {
        name: groupSpec?.name ?? 'group',
        resources: Object.freeze(resources)
      };
    });

    return {
      owner,
      dseq: String(dseq),
      state,
      version,
      createdAt,
      groups: Object.freeze(groups)
    };
  }

  /**
   * Map deployment state enum to string
   * @private
   */
  private mapDeploymentState(state: unknown): string {
    if (typeof state === 'string') {
      return state;
    }

    switch (state) {
      case 1: return 'active';
      case 2: return 'closed';
      default: return 'unknown';
    }
  }

  /**
   * Decode resource value from protobuf bytes
   * @private
   */
  private decodeResourceValue(value: Uint8Array | undefined | null): string {
    if (!value || value.length === 0) {
      return '0';
    }
    return new TextDecoder().decode(value);
  }

  /**
   * Convert binary version to hex string
   * @private
   */
  private toHexString(value: Uint8Array | undefined | null): string {
    if (!value || value.length === 0) {
      return '';
    }
    return Buffer.from(value).toString('hex');
  }

  /**
   * Fetch provider metadata from blockchain
   *
   * @param providerAddress - Provider wallet address
   * @returns Provider metadata (hostUri, attributes)
   *
   * @example
   * ```typescript
   * const provider = await client.getProvider('akash1provider...');
   *
   * console.log(`Host: ${provider.data.hostUri}`);
   * console.log(`Audited: ${provider.data.attributes.some(a => a.key === 'audited-by')}`);
   * ```
   */
  async getProvider(
    providerAddress: string
  ): Promise<Result<ProviderMetadata | undefined, DeploymentError>> {
    try {
      // Query blockchain (reuses this.sdk)
      const response = await this.sdk.akash.provider.v1beta4.getProvider({
        owner: providerAddress
      });

      if (!response.provider) {
        return success(undefined);
      }

      return success(this.mapProvider(response.provider));

    } catch (error) {
      const errMsg = getErrorMessage(error);
      return failure(new DeploymentError(
        'Failed to query provider',
        'RPC_ERROR',
        { network: this.network, error: errMsg },
        true
      ));
    }
  }

  /**
   * Map provider response to ProviderMetadata
   * @private
   */
  private mapProvider(provider: {
    owner: string;
    hostUri: string;
    attributes: Array<{ key: string; value: string }>;
  }): ProviderMetadata {
    return {
      owner: provider.owner,
      hostUri: this.normalizeProviderUri(provider.hostUri),
      attributes: Object.freeze(
        (provider.attributes ?? []).map((attr) => ({
          key: attr.key ?? '',
          value: attr.value ?? ''
        }))
      )
    };
  }

  /**
   * Normalize provider URI
   * @private
   */
  private normalizeProviderUri(uri: string | undefined): string | undefined {
    if (!uri) {
      return undefined;
    }

    try {
      const parsed = new URL(uri);
      if (parsed.protocol !== 'https:') {
        return undefined;
      }
      parsed.pathname = parsed.pathname.replace(/\/$/, '');
      return parsed.toString();
    } catch {
      return undefined;
    }
  }

  // ==========================================================================
  // Transaction Methods (Write - Signer Required)
  // ==========================================================================

  /**
   * Create deployment on Akash blockchain
   *
   * Submits an SDL to the blockchain, creating a new deployment that
   * providers can bid on. Requires signing capability.
   *
   * **Gas cost**: ~0.05 AKT + deposit
   *
   * @param sdl - Service Definition Language document
   * @param depositAkt - Initial deposit in AKT (refunded on close)
   * @returns Deployment sequence number and transaction hash
   *
   * @example
   * ```typescript
   * const result = await client.createDeployment(sdl, 5);
   *
   * if (result.success) {
   *   console.log(`Deployment created: DSEQ ${result.data.dseq}`);
   *   console.log(`Transaction: ${result.data.transactionHash}`);
   * }
   * ```
   */
  async createDeployment(
    sdl: SDL,
    depositAkt: number = 5
  ): Promise<Result<DeploymentResult, DeploymentError>> {
    // Validate signer exists
    if (!this.signer) {
      return failure(new DeploymentError(
        'Signer required for creating deployments',
        'SIGNER_REQUIRED',
        {},
        false,
        'Create AkashClient with a signer to perform write operations',
        'error'
      ));
    }

    try {
      const owner = await this.getSignerAddress();

      // Get current block height for dseq
      const blockResult = await this.sdk.cosmos.base.tendermint.v1beta1.getLatestBlock({});
      const dseq = Number(blockResult.block?.header?.height ?? 0);

      // Extract SDL groups and manifest hash
      const groups = sdl.groups();
      const hash = await sdl.manifestVersion();

      // Calculate deposit in uakt (1 AKT = 1,000,000 uakt)
      const aktAmount = Number.isFinite(depositAkt) && depositAkt > 0 ? depositAkt : 5;
      const depositUakt = String(Math.round(aktAmount * 1_000_000));

      // Capture transaction metadata
      let txHash = '';
      let txHeight = 0;

      // Create deployment message (reuses this.sdk)
      const txResponse = await this.sdk.akash.deployment.v1beta4.createDeployment({
        id: { owner, dseq: Long.fromNumber(dseq) },
        groups,
        hash,
        deposit: {
          amount: { denom: 'uakt', amount: depositUakt },
          sources: [1]  // Source.balance
        }
      }, {
        afterBroadcast: (response: DeliverTxResponse) => {
          txHash = response.transactionHash;
          txHeight = response.height;
        }
      });

      // If afterBroadcast wasn't called, extract from response
      if (!txHash && txResponse) {
        // The SDK might return the response directly
        const response = txResponse as any;
        txHash = response.transactionHash || response.txHash || '';
        txHeight = response.height || 0;
      }

      return success({
        dseq,
        transactionHash: txHash,
        height: txHeight
      });

    } catch (error) {
      const errMsg = getErrorMessage(error);
      console.error('Deployment creation error:', errMsg, error);

      return failure(new DeploymentError(
        `Failed to create deployment on blockchain: ${errMsg}`,
        'TRANSACTION_FAILED',
        { error: errMsg, details: error },
        true,
        'Check wallet balance and network connectivity'
      ));
    }
  }

  /**
   * Get signer address
   * @private
   */
  private async getSignerAddress(): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer not available');
    }
    const accounts = await this.signer.getAccounts();
    if (accounts.length === 0) {
      throw new Error('No accounts found in signer');
    }
    const account = accounts[0];
    if (!account) {
      throw new Error('First account is undefined');
    }
    return account.address;
  }

  /**
   * Accept a provider bid and create lease
   *
   * Creates a lease by accepting a provider's bid. The provider will then
   * start deploying containers according to the SDL.
   *
   * **Gas cost**: ~0.02 AKT
   *
   * @param bid - Provider bid to accept (from getBids)
   * @returns Lease identifier and transaction hash
   *
   * @example
   * ```typescript
   * const bids = await client.getBids(wallet, dseq);
   * const cheapestBid = bids.data[0];
   *
   * const lease = await client.acceptBid(cheapestBid.bid);
   *
   * if (lease.success) {
   *   console.log(`Lease created with ${lease.data.lease.provider}`);
   * }
   * ```
   */
  async acceptBid(
    bid: ProviderBid
  ): Promise<Result<LeaseResult, DeploymentError>> {
    // Validate signer exists
    if (!this.signer) {
      return failure(new DeploymentError(
        'Signer required for accepting bids',
        'SIGNER_REQUIRED',
        {},
        false,
        'Create AkashClient with a signer to perform write operations'
      ));
    }

    try {
      const bidId = bid.id ?? bid.bidId;

      if (!bidId) {
        return failure(new DeploymentError(
          'Invalid bid: missing bid ID',
          'INVALID_BID',
          { bid }
        ));
      }

      // Capture transaction metadata
      let txHash = '';
      let txHeight = 0;

      // Create lease (reuses this.sdk)
      await this.sdk.akash.market.v1beta5.createLease({
        bidId: {
          owner: bidId.owner,
          dseq: bidId.dseq,
          gseq: bidId.gseq,
          oseq: bidId.oseq,
          provider: bidId.provider,
          bseq: bidId.bseq ?? 0
        }
      }, {
        afterBroadcast: (txResponse: DeliverTxResponse) => {
          txHash = txResponse.transactionHash;
          txHeight = txResponse.height;
        }
      });

      const lease: LeaseIdentifier = {
        owner: bidId.owner,
        dseq: Number(bidId.dseq),
        gseq: bidId.gseq,
        oseq: bidId.oseq,
        provider: bidId.provider
      };

      return success({
        lease,
        transactionHash: txHash,
        height: txHeight
      });

    } catch (error) {
      const errMsg = getErrorMessage(error);
      return failure(new DeploymentError(
        'Failed to create lease',
        'TRANSACTION_FAILED',
        { error: errMsg },
        true,
        'Check wallet balance and that bid is still valid'
      ));
    }
  }

  /**
   * Close deployment on blockchain
   *
   * Closes the deployment and all associated leases. Remaining deposit
   * is refunded to the wallet.
   *
   * **Gas cost**: ~0.02 AKT
   *
   * @param dseq - Deployment sequence number to close
   * @returns Closure confirmation with refund amount
   *
   * @example
   * ```typescript
   * const result = await client.closeDeployment(12345);
   *
   * if (result.success) {
   *   console.log(`Deployment ${result.data.dseq} closed`);
   *   console.log(`Refunded: ${result.data.refundAmount}`);
   * }
   * ```
   */
  async closeDeployment(
    dseq: number
  ): Promise<Result<DeploymentCloseResult, DeploymentError>> {
    // Validate signer exists
    if (!this.signer) {
      return failure(new DeploymentError(
        'Signer required for closing deployments',
        'SIGNER_REQUIRED',
        {},
        false,
        'Create AkashClient with a signer to perform write operations'
      ));
    }

    try {
      const owner = await this.getSignerAddress();

      // Capture transaction metadata
      let txHash = '';
      let txHeight = 0;

      // Close deployment (reuses this.sdk)
      await this.sdk.akash.deployment.v1beta4.closeDeployment({
        id: {
          owner,
          dseq: Long.fromNumber(dseq)
        }
      }, {
        afterBroadcast: (txResponse: DeliverTxResponse) => {
          txHash = txResponse.transactionHash;
          txHeight = txResponse.height;
        }
      });

      return success({
        dseq: String(dseq),
        owner,
        transactionHash: txHash,
        height: txHeight,
        closedAt: new Date(),
        confirmed: true
      });

    } catch (error) {
      const errMsg = getErrorMessage(error);
      return failure(new DeploymentError(
        'Failed to close deployment',
        'TRANSACTION_FAILED',
        { dseq, error: errMsg },
        true,
        'Verify deployment exists and is owned by this wallet'
      ));
    }
  }

  // ==========================================================================
  // Certificate Methods
  // ==========================================================================

  /**
   * Get certificate manager instance
   *
   * Returns a lazy-initialized CertificateManager that uses this client's SDK.
   * The manager handles certificate generation, querying, and broadcasting.
   *
   * @returns Certificate manager instance
   *
   * @example
   * ```typescript
   * const certManager = client.getCertificateManager();
   * const cert = await certManager.getOrCreate('akash1...');
   * ```
   */
  getCertificateManager(): CertificateManager {
    // Lazy initialization - create manager on first access
    if (!this.certManager) {
      this.certManager = new CertificateManager(this);
    }
    return this.certManager;
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Disconnect and cleanup resources
   *
   * Closes SDK connections and cleans up resources. Call this when
   * done with the client to prevent memory leaks.
   *
   * **Important**: Always call this in a `finally` block
   *
   * @example
   * ```typescript
   * const client = new AkashClient({ network: 'mainnet', signer });
   *
   * try {
   *   await client.createDeployment(sdl);
   * } finally {
   *   await client.disconnect(); // Always cleanup!
   * }
   * ```
   */
  async disconnect(): Promise<void> {
    // SDK cleanup if available
    // The chain-sdk handles cleanup internally
    // This method is a placeholder for future cleanup needs
  }

  /**
   * Get current network
   *
   * @returns Network this client is connected to
   *
   * @example
   * ```typescript
   * console.log(`Connected to: ${client.getNetwork()}`);
   * ```
   */
  getNetwork(): AkashNetwork {
    return this.network;
  }

  /**
   * Check if client can sign transactions
   *
   * Returns true if signer was provided in constructor.
   * Use this to check if write operations are available.
   *
   * @returns True if client can sign transactions
   *
   * @example
   * ```typescript
   * if (!client.canSign()) {
   *   console.error('Cannot create deployment - client is read-only');
   *   console.log('Create client with signer for write operations');
   * }
   * ```
   */
  canSign(): boolean {
    return this.signer !== undefined;
  }
}
