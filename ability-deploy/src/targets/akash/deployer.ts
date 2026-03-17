/**
 * Akash Deployment Orchestrator
 *
 * High-level helper that glues together the lower-level modules:
 * - profile loading
 * - SDL generation
 * - blockchain deployment workflow (create deployment → wait for bids → create lease)
 * - provider manifest delivery and optional readiness monitoring
 *
 * This mirrors the legacy kadi-deploy deployment flow while embracing the
 * composable building blocks exposed by deploy-ability.
 *
 * @module targets/akash/deployer
 */

import Long from 'long';
import {
  success,
  failure,
  type AkashDeploymentOptions,
  type AkashDeploymentResult,
  type AkashDeploymentData,
  type AkashDryRunData,
  type BlacklistConfig,
  createWalletAddress,
  createDeploymentSequence,
} from '../../types/index.js';
import type {
  DeploymentLogger,
  ProviderUri,
  Network,
} from '../../types/common.js';
import { defaultLogger } from '../../utils/logger.js';
import { loadProfile } from '../../utils/profile-loader.js';
import type { EnhancedBid, BidSelector, ProviderBid } from './bids.js';
import {
  sendManifestToProvider,
  fetchProviderLeaseStatus,
  type ProviderLeaseStatus,
} from './provider-manager.js';
import type { LeaseDetails } from './types.js';
import { AkashClient, type LeaseResult, type DeploymentDetails } from './client.js';
import { waitForContainersRunning } from './lease-monitor.js';
import { LeasePrice } from './pricing.js';
import {
  generateAkashSdl,
  createSdlObject,
} from './sdl-generator.js';
import type { AkashProviderTlsCertificate, WalletContext } from './types.js';
import type { AkashDeploymentProfile } from '../../types/index.js';
import type { AkashNetwork } from './environment.js';
import { DeploymentError, getErrorMessage } from '../../errors/index.js';

/**
 * Intelligent blacklist resolution with progressive disclosure
 *
 * Resolves blacklist configuration from both profile and options with intelligent merging.
 * Supports simple array syntax for common cases and advanced config object for full control.
 *
 * @param profileBlacklist - Blacklist from deployment profile
 * @param optionsBlacklist - Blacklist from deployment options
 * @param logger - Logger for debugging
 * @returns Resolved blacklist of provider addresses
 *
 * @example
 * ```typescript
 * // Simple array - merges with profile
 * const blacklist = resolveBlacklist(['akash1a...'], ['akash1b...'], logger);
 * ```
 */
function resolveBlacklist(
  profileBlacklist: readonly string[] | undefined,
  optionsBlacklist: readonly string[] | BlacklistConfig | undefined,
  logger: DeploymentLogger
): readonly string[] {

  const profileList = profileBlacklist || [];

  // No options blacklist - use profile only
  if (!optionsBlacklist) {
    if (profileList.length > 0) {
      logger.debug(`Using profile blacklist (${profileList.length} providers)`);
    }
    return profileList;
  }

  // Simple array syntax - merge with profile (most common case)
  if (Array.isArray(optionsBlacklist)) {
    const merged = Array.from(new Set([...profileList, ...optionsBlacklist]));
    logger.debug(
      `Merged blacklist: ${merged.length} total ` +
      `(${profileList.length} from profile, ${optionsBlacklist.length} from options)`
    );
    return merged;
  }

  // Advanced config object - explicit control
  // TypeScript requires us to narrow the type first
  const config = optionsBlacklist as BlacklistConfig;
  const { mode, providers = [] } = config;

  switch (mode) {
    case 'merge': {
      const merged = Array.from(new Set([...profileList, ...providers]));
      logger.debug(
        `Explicitly merged blacklist: ${merged.length} total ` +
        `(${profileList.length} from profile, ${providers.length} from options)`
      );
      return merged;
    }

    case 'replace': {
      logger.debug(
        `Replaced profile blacklist (${profileList.length} providers) ` +
        `with options blacklist (${providers.length} providers)`
      );
      return providers;
    }

    case 'none': {
      logger.debug(
        `Blacklisting disabled (ignoring ${profileList.length} providers from profile)`
      );
      return [];
    }

    default: {
      // TypeScript exhaustiveness check
      // @ts-expect-error - This ensures we handle all modes
      const _exhaustive: never = mode;
      throw new Error(`Invalid blacklist mode: ${mode}`);
    }
  }
}

/**
 * Additional parameters required to execute a deployment
 *
 * For dry-run mode, wallet and certificate are optional (only SDL generation needed).
 * For actual deployments, wallet, certificate, and bidSelector are all required.
 */
export interface AkashDeploymentExecution extends AkashDeploymentOptions {
  readonly wallet?: WalletContext;
  readonly certificate?: AkashProviderTlsCertificate;

  /**
   * Bid selection function
   *
   * Called with all available bids after waiting for provider responses.
   * Must return the selected bid or null if none are acceptable.
   *
   * @example
   * ```typescript
   * import { deployToAkash, selectCheapestBid} from '@kadi.build/deploy-ability/akash';
   *
   * const result = await deployToAkash({
   *   wallet,
   *   certificate,
   *   projectRoot: './',
   *   profile: 'production',
   *   bidSelector: selectCheapestBid
   * });
   * ```
   */
  readonly bidSelector?: BidSelector;

  /**
   * Timeout for provider bidding phase (milliseconds)
   * @default 180000 (3 minutes)
   */
  readonly bidTimeout?: number;
}

/**
 * Executes a full Akash deployment.
 */
export async function deployToAkash(
  params: AkashDeploymentExecution
): Promise<AkashDeploymentResult> {
  const {
    wallet,
    certificate,
    bidSelector,
    logger: customLogger,
    dryRun = false,
    ...options
  } = params;

  const logger: DeploymentLogger = customLogger ?? defaultLogger;

  // ---------------------------------------------------------------------------
  // Load and validate deployment profile
  // Use pre-loaded profile if provided (e.g., with registry URL transformations),
  // otherwise load from disk
  // ---------------------------------------------------------------------------
  let loadedProfile;

  if (options.loadedProfile) {
    loadedProfile = options.loadedProfile;
  } else {
    try {
      loadedProfile = await loadProfile(
        options.projectRoot,
        options.profile,
        logger
      );
    } catch (error) {
      const errMsg = getErrorMessage(error);
      return failure(
        new DeploymentError(
          `Failed to load deployment profile '${options.profile}': ${errMsg}`,
          'PROFILE_LOAD_FAILED',
          { error: errMsg }
        )
      );
    }
  }

  if (loadedProfile.profile.target !== 'akash') {
    return failure(
      new DeploymentError(
        `Profile '${loadedProfile.name}' is not an Akash deployment profile`,
        'INVALID_PROFILE_TARGET',
        { profile: loadedProfile.name }
      )
    );
  }

  // Type assertion: we've verified target === 'akash' above
  const akashProfile = loadedProfile.profile as AkashDeploymentProfile;
  const akashLoadedProfile = loadedProfile as typeof loadedProfile & {
    profile: AkashDeploymentProfile;
  };
  const selectedNetwork = (options.network ?? akashProfile.network) as Network;
  if (selectedNetwork !== 'mainnet' && selectedNetwork !== 'testnet') {
    return failure(
      new DeploymentError(
        `Unsupported Akash network '${selectedNetwork}'`,
        'INVALID_NETWORK',
        { selectedNetwork }
      )
    );
  }
  const network: AkashNetwork = selectedNetwork;

  // ---------------------------------------------------------------------------
  // Generate SDL (Akash manifest)
  // ---------------------------------------------------------------------------
  const sdlYaml = generateAkashSdl(akashLoadedProfile);
  const sdlDocument = createSdlObject(akashLoadedProfile);

  if (dryRun) {
    const dryRunResult: AkashDryRunData = {
      dryRun: true,
      sdl: sdlYaml,
      profile: loadedProfile.name,
      network,
    };
    return success(dryRunResult);
  }

  // ---------------------------------------------------------------------------
  // Runtime validation: wallet and certificate required for actual deployment
  // ---------------------------------------------------------------------------
  if (!wallet) {
    return failure(
      new DeploymentError(
        'Wallet is required for deployment (not dry-run)',
        'WALLET_REQUIRED',
        {},
        false,
        'Connect wallet using wallet-manager before deployment'
      )
    );
  }

  if (!certificate) {
    return failure(
      new DeploymentError(
        'TLS certificate is required to communicate with the provider',
        'CERTIFICATE_REQUIRED',
        {},
        false,
        'Generate or load a certificate using certificate-manager before deployment'
      )
    );
  }

  if (!bidSelector) {
    return failure(
      new DeploymentError(
        'Bid selector function is required for deployment',
        'BID_SELECTOR_REQUIRED',
        {},
        false,
        'Provide a bidSelector function to choose which provider bid to accept. ' +
        'Use pre-built selectors like selectCheapestBid, selectMostReliableBid, or implement custom logic.'
      )
    );
  }

  // -----------------------------------------------------------------------
  // Initialize AkashClient with signing capability
  // -----------------------------------------------------------------------
  const client = new AkashClient({
    network,
    signer: wallet.signer,
  });

  const depositAkt = determineDeposit(options, akashProfile);

  logger.log('📝 Creating deployment on blockchain...');
  const deploymentResult = await client.createDeployment(sdlDocument, depositAkt);
  if (!deploymentResult.success) {
    return deploymentResult;
  }
  logger.debug?.(`Deployment created: DSEQ ${deploymentResult.data.dseq}`);

  // Resolve blacklist from both profile and options with intelligent merging
  const mergedBlacklist = resolveBlacklist(
    akashProfile.blacklist,
    options.blacklist,
    logger
  );

  logger.log('Waiting for provider bids...');
  const bidTimeoutMs = options.bidTimeout ?? 180000; // 3 minutes default
  const bidsResult = await client.awaitBids(
    wallet,
    deploymentResult.data.dseq,
    {
      blacklist: mergedBlacklist.length > 0 ? [...mergedBlacklist] : undefined,
      timeout: bidTimeoutMs,
    }
  );

  if (!bidsResult.success) {
    // Cleanup: close deployment to return escrow
    logger.warn('No bids received, closing deployment to return escrow...');

    const closeResult = await client.closeDeployment(deploymentResult.data.dseq);

    if (closeResult.success) {
      logger.log('Deployment closed, escrow returned');
    } else {
      logger.warn('Failed to close deployment automatically:', closeResult.error.message);
    }

    // Return enhanced error with cleanup info
    return failure(
      new DeploymentError(
        `No provider bids received within ${bidTimeoutMs / 1000}s. Deployment closed, escrow returned.`,
        'BID_TIMEOUT',
        {
          dseq: deploymentResult.data.dseq,
          timeoutMs: bidTimeoutMs,
          cleaned: closeResult.success,
          originalError: bidsResult.error
        },
        true,
        'Try: 1) Increase bidTimeout, 2) Reduce resource requirements, 3) Increase deposit amount'
      )
    );
  }

  const bids = bidsResult.data;
  logger.debug?.(`Received ${bids.length} bid(s) from providers`);

  // Call user's bid selector to choose which provider to use
  logger.log('Selecting provider...');
  let selectedBid: EnhancedBid | null;
  try {
    selectedBid = await bidSelector(bids);
  } catch (error) {
    const errMsg = getErrorMessage(error);
    return failure(
      new DeploymentError(
        `Bid selector function threw an error: ${errMsg}`,
        'BID_SELECTOR_ERROR',
        { error: errMsg },
        true,
        'Check your bidSelector implementation for errors'
      )
    );
  }

  if (!selectedBid) {
    return failure(
      new DeploymentError(
        'Bid selector returned null - no acceptable bids found',
        'NO_ACCEPTABLE_BIDS',
        { bidCount: bids.length },
        true,
        'Adjust your bid selection criteria or wait for more provider bids'
      )
    );
  }

  logger.debug?.(
    `Selected provider: ${selectedBid.provider.name || selectedBid.provider.owner} ` +
    `(${selectedBid.pricing.akt.perMonth.toFixed(2)} AKT/month)`
  );

  logger.log('📋 Creating lease with provider...');
  const leaseResult = await client.acceptBid(selectedBid.bid);
  if (!leaseResult.success) {
    return leaseResult;
  }
  logger.debug?.('Lease created successfully');


  const lease = leaseResult.data.lease;

  // ---------------------------------------------------------------------------
  // Provider manifest delivery
  // ---------------------------------------------------------------------------
  const providerMetadataResult = await client.getProvider(lease.provider);
  if (!providerMetadataResult.success) {
    return failure(
      new DeploymentError(
        'Failed to retrieve provider metadata',
        'PROVIDER_METADATA_ERROR',
        { provider: lease.provider },
        true,
        'Retry deployment or choose a different provider',
        'error',
        providerMetadataResult.error
      )
    );
  }

  const providerMetadata = providerMetadataResult.data;
  const providerUri = providerMetadata?.hostUri as ProviderUri;
  if (!providerUri) {
    return failure(
      new DeploymentError(
        'Selected provider does not expose a host URI',
        'PROVIDER_URI_MISSING',
        { provider: lease.provider },
        true,
        'Select a different provider or verify on-chain provider records'
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Send manifest to provider with delay + retry
  // ---------------------------------------------------------------------------
  // Wait 5s before first attempt to give provider time to register the lease
  // Retry up to 3 times on 4xx errors (especially 401 "no lease for deployment")
  // Use exponential backoff (6s, 8s) to match Akash Console behavior
  // Total worst case: 5s + 0s + 6s + 8s = 19s before third attempt
  logger.log('📤 Sending manifest to provider...');
  logger.log('⏳ Waiting 5s for provider to register lease...');

  await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay

  const maxAttempts = 5;  // Increased for slow GPU providers
  let manifestResult;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      logger.log(`🔄 Retry attempt ${attempt}/${maxAttempts}...`);
    }

    manifestResult = await sendManifestToProvider({
      providerUri,
      lease: {
        // Long types from protobuf need explicit toString() conversion
        dseq: Long.isLong(lease.dseq) ? lease.dseq.toString() : lease.dseq,
        gseq: lease.gseq,
        oseq: lease.oseq,
      },
      manifest: sdlDocument.manifestSortedJSON(),
      certificate,
    });

    // Success - break out of retry loop
    if (manifestResult.success) {
      logger.log('Manifest sent successfully');
      break;
    }

    // Check if error is retryable (4xx status codes)
    const error = manifestResult.error;
    const statusCode = error.context?.statusCode as number | undefined;
    const isRetryable = typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500;

    // If not retryable or last attempt, return the error
    if (!isRetryable || attempt === maxAttempts) {
      logger.log(`Manifest send failed (status: ${statusCode}): ${error.message}`);
      if (error.context?.body) {
        logger.log(`Provider response: ${error.context.body}`);
      }
      return manifestResult;
    }

    // Exponential backoff: 6s for first retry, 8s for second retry
    // Mirrors Akash Console's ~6s delay between attempts
    const retryDelayMs = 4000 + (attempt * 2000); // 6s, 8s
    logger.log(`⏱️  Got ${statusCode} error, retrying in ${retryDelayMs / 1000}s...`);
    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
  }

  // Should not reach here, but TypeScript needs this
  if (!manifestResult!.success) {
    return manifestResult!;
  }


  // ---------------------------------------------------------------------------
  // Query additional deployment information
  // ---------------------------------------------------------------------------
  // Validate blockchain addresses using Zod schemas
  // This ensures the addresses are properly formatted
  try {
    createWalletAddress(lease.owner);
    createWalletAddress(lease.provider);
  } catch (error) {
    const errMsg = getErrorMessage(error);
    return failure(
      new DeploymentError(
        'Invalid wallet addresses received from blockchain',
        'INVALID_BLOCKCHAIN_DATA',
        { owner: lease.owner, provider: lease.provider, error: errMsg },
        false,
        'This indicates malformed blockchain data. Please report this issue.'
      )
    );
  }

  // Skip querying lease details immediately after creation
  // The blockchain needs time to process the transaction
  // Set to undefined since we're not querying immediately
  // These are optional fields used for additional info only
  const leaseDetailsResult = { success: false, data: undefined };
  const deploymentDetailsResult = { success: false, data: undefined };

  // ---------------------------------------------------------------------------
  // Optional readiness monitoring
  // ---------------------------------------------------------------------------
  let providerStatus: ProviderLeaseStatus | undefined;
  if (options.containerTimeout && options.containerTimeout > 0) {
    // Build lease details with validation
    let leaseDetails: LeaseDetails;
    try {
      leaseDetails = buildLeaseDetails(selectedBid.bid, leaseResult.data);
    } catch (error) {
      const errMsg = getErrorMessage(error);
      return failure(
        new DeploymentError(
          'Invalid wallet addresses in lease data',
          'INVALID_BLOCKCHAIN_DATA',
          { error: errMsg },
          false,
          'This indicates malformed blockchain data. Please report this issue.'
        )
      );
    }

    const monitorResult = await waitForContainersRunning({
      network,
      lease: leaseDetails,
      providerUri,
      certificate,
      pollIntervalMs: 10_000,
      maxWaitMs: options.containerTimeout,
      logger,
    });

    if (!monitorResult.success) {
      // Cleanup: close deployment to return escrow
      logger.warn('Containers failed to start, closing deployment...');

      const closeResult = await client.closeDeployment(deploymentResult.data.dseq);

      if (closeResult.success) {
        logger.log('Deployment closed, escrow returned');
      } else {
        logger.warn('Failed to close deployment automatically:', closeResult.error.message);
      }

      // Return enhanced error with cleanup info
      return failure(
        new DeploymentError(
          `Containers failed to start within ${options.containerTimeout / 1000}s. Deployment closed, escrow returned.`,
          'CONTAINER_TIMEOUT',
          {
            dseq: deploymentResult.data.dseq,
            timeoutMs: options.containerTimeout,
            cleaned: closeResult.success,
            originalError: monitorResult.error
          },
          true,
          'Try: 1) Increase containerTimeout for large images, 2) Check provider logs, 3) Try different provider'
        )
      );
    }

    providerStatus = monitorResult.data;
  } else {
    const statusResult = await fetchProviderLeaseStatus({
      providerUri,
      lease: {
        // Long types from protobuf need explicit toString() conversion
        dseq: Long.isLong(lease.dseq) ? lease.dseq.toString() : lease.dseq,
        gseq: lease.gseq,
        oseq: lease.oseq,
      },
      certificate,
    });

    if (statusResult.success) {
      providerStatus = statusResult.data;
    }
  }

  // ---------------------------------------------------------------------------
  // Compose deployment result
  // ---------------------------------------------------------------------------
  try {
    const deploymentData = createDeploymentData({
      deployment: deploymentResult.data,
      lease: leaseResult.data,
      leaseDetails: leaseDetailsResult.success ? leaseDetailsResult.data : undefined,
      deploymentDetails: deploymentDetailsResult.success
        ? deploymentDetailsResult.data
        : undefined,
      providerUri,
      profileName: loadedProfile.name,
      network,
      certificate,
      providerStatus,
      selectedBid, // Pass selectedBid for pricing fallback
    });

    return success(deploymentData);
  } catch (error) {
    // Validation error from Zod schemas (malformed blockchain data)
    const errMsg = getErrorMessage(error);
    return failure(
      new DeploymentError(
        'Failed to validate deployment data from blockchain',
        'INVALID_BLOCKCHAIN_DATA',
        { error: errMsg },
        false,
        'This indicates malformed blockchain data. Please report this issue.'
      )
    );
  }
}

/** Determines deposit in AKT to use for deployment. */
function determineDeposit(
  options: AkashDeploymentOptions,
  profile: AkashDeploymentProfile
): number {
  // Check CLI options first (takes precedence)
  if (typeof options.deposit === 'number' && options.deposit > 0) {
    return options.deposit; // Already in AKT
  }

  // Check profile deposit
  if (typeof profile.deposit === 'number' && profile.deposit > 0) {
    return profile.deposit; // Already in AKT
  }

  return 5; // Default deposit in AKT
}

interface DeploymentDataParams {
  readonly deployment: {
    dseq: number;
    transactionHash: string;
    height: number;
  };
  readonly lease: LeaseResult;
  readonly leaseDetails?: LeaseDetails;
  readonly deploymentDetails?: DeploymentDetails;
  readonly providerUri: ProviderUri;
  readonly profileName: string;
  readonly network: Network;
  readonly certificate: AkashProviderTlsCertificate;
  readonly providerStatus?: ProviderLeaseStatus;
  readonly selectedBid: EnhancedBid; // For pricing fallback when leaseDetails unavailable
}

/** Normalises deployment data into the published AkashDeploymentData structure */
function createDeploymentData(params: DeploymentDataParams): AkashDeploymentData {
  const {
    deployment,
    lease,
    leaseDetails,
    deploymentDetails,
    providerUri,
    profileName,
    network,
    certificate,
    providerStatus,
    selectedBid,
  } = params;

  const endpoints = providerStatus
    ? buildEndpointMap(providerStatus)
    : undefined;

  // Create LeasePrice instance from lease details
  // If lease details weren't fetched successfully, use selectedBid's per-block rate
  const leasePrice = leaseDetails
    ? new LeasePrice(leaseDetails.price)
    : new LeasePrice(selectedBid.bid.price ?? { denom: 'uakt', amount: '0' }); // Use actual per-block rate from bid

  // Extract deployment status (active or closed)
  // Default to 'active' if deployment details weren't fetched
  const status = deploymentDetails?.state === 'closed' ? 'closed' : 'active';

  // Extract services with their resource allocations from deployment groups
  const services = deploymentDetails
    ? buildServicesFromGroups(deploymentDetails.groups)
    : undefined;

  // Extract lease created timestamp
  // This is the block height or timestamp when the lease was created on-chain
  const leaseCreatedAt = leaseDetails?.createdAt ?? '0';

  // Validate branded types from blockchain data
  // If validation fails, throw error (will be caught by deployToAkash)
  const validatedDseq = createDeploymentSequence(deployment.dseq);
  const validatedOwner = createWalletAddress(lease.lease.owner);
  const validatedProvider = createWalletAddress(lease.lease.provider);

  return {
    dseq: validatedDseq,
    owner: validatedOwner,
    provider: validatedProvider,
    providerUri,
    gseq: lease.lease.gseq,
    oseq: lease.lease.oseq,
    network,
    endpoints,
    certificate: {
      cert: certificate.cert,
      privateKey: certificate.privateKey,
    },
    profile: profileName,
    deployedAt: new Date(),
    // New fields with complete deployment information
    status,
    leasePrice,
    leaseCreatedAt,
    services,
  };
}

/** Builds a simple service → URI mapping from provider lease status */
function buildEndpointMap(
  status: ProviderLeaseStatus
): Readonly<Record<string, string>> | undefined {
  const entries: Array<[string, string]> = [];

  for (const [name, service] of Object.entries(status.services)) {
    // 1. Try URIs first (provider-published endpoints)
    const uri = service.uris?.[0];
    if (uri) {
      entries.push([name, uri]);
      continue;
    }

    // 2. Fallback: synthesize URL from forwarded ports
    const ports = status.forwardedPorts?.[name];
    const port = ports?.[0];
    if (port) {
      // Use https only for typical TLS ports (443, 8443)
      const protocol = port.externalPort === 443 || port.externalPort === 8443
        ? 'https'
        : 'http';
      const synthesizedUrl = `${protocol}://${port.host}:${port.externalPort}/`;
      entries.push([name, synthesizedUrl]);
    }
  }

  return entries.length > 0 ? Object.freeze(Object.fromEntries(entries)) : undefined;
}

/**
 * Extracts services with complete resource allocations from deployment groups
 *
 * Processes all resource specs in each group, calculates aggregated totals, and preserves
 * detailed specs with individual replica counts.
 *
 * @param groups - Deployment groups from blockchain query
 * @returns Array of services with aggregated totals and detailed resource specs
 */
function buildServicesFromGroups(
  groups: ReadonlyArray<import('./client.js').DeploymentGroupDetails>
): ReadonlyArray<{
  name: string;
  totalResources: {
    cpu: string;
    memory: string;
    storage: string;
  };
  replicaCount: number;
  resourceSpecs: ReadonlyArray<{
    count: number;
    cpu: string;
    memory: string;
    storage: string;
  }>;
}> {
  const services: Array<{
    name: string;
    totalResources: {
      cpu: string;
      memory: string;
      storage: string;
    };
    replicaCount: number;
    resourceSpecs: ReadonlyArray<{
      count: number;
      cpu: string;
      memory: string;
      storage: string;
    }>;
  }> = [];

  for (const group of groups) {
    if (group.resources.length === 0) {
      continue; // Skip groups with no resources
    }

    // Process ALL resource specs (not just the first)
    const resourceSpecs: Array<{
      count: number;
      cpu: string;
      memory: string;
      storage: string;
    }> = [];

    let totalCpuMicroUnits = 0;
    let totalMemoryBytes = 0;
    let totalStorageBytes = 0;
    let totalReplicas = 0;

    for (const resource of group.resources) {
      const count = resource.count;
      const cpuMicroUnits = parseFloat(resource.cpuUnits || '0');
      const memoryBytes = parseFloat(resource.memoryQuantity || '0');
      // Storage is an array - sum all storage quantities
      const storageBytes = resource.storageQuantities
        .map((s: string) => parseFloat(s || '0'))
        .reduce((a: number, b: number) => a + b, 0);

      // Accumulate totals (count × resource value)
      totalCpuMicroUnits += count * cpuMicroUnits;
      totalMemoryBytes += count * memoryBytes;
      totalStorageBytes += count * storageBytes;
      totalReplicas += count;

      // Format individual spec resources
      resourceSpecs.push({
        count,
        cpu: formatCpu(cpuMicroUnits),
        memory: formatBytes(memoryBytes),
        storage: formatBytes(storageBytes),
      });
    }

    services.push({
      name: group.name,
      totalResources: {
        cpu: formatCpu(totalCpuMicroUnits),
        memory: formatBytes(totalMemoryBytes),
        storage: formatBytes(totalStorageBytes),
      },
      replicaCount: totalReplicas,
      resourceSpecs: Object.freeze(resourceSpecs),
    });
  }

  return Object.freeze(services);
}

/** Formats CPU micro-units to human-readable CPU cores (1,000,000 micro-units = 1 CPU core) */
function formatCpu(microUnits: number): string {
  const cpuCores = microUnits / 1_000_000;
  // Use up to 2 decimal places, remove trailing zeros
  return cpuCores.toFixed(2).replace(/\.?0+$/, '');
}

/** Formats bytes to human-readable storage/memory with appropriate unit (Mi/Gi/Ti) */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0';

  const units = ['', 'Ki', 'Mi', 'Gi', 'Ti', 'Pi'];
  let unitIndex = 0;
  let value = bytes;

  // Find appropriate unit (prefer larger units for readability)
  // Use 1024 for binary units (Mi, Gi, etc.)
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  // Format with up to 2 decimal places, remove trailing zeros
  const formatted = value.toFixed(2).replace(/\.?0+$/, '');
  return `${formatted}${units[unitIndex]}`;
}

/** Constructs LeaseDetails for monitoring using bid and lease information */
function buildLeaseDetails(
  bid: ProviderBid,
  lease: LeaseResult
): LeaseDetails {
  // Validate wallet addresses - throws ZodError if invalid
  const validatedOwner = createWalletAddress(lease.lease.owner);
  const validatedProvider = createWalletAddress(lease.lease.provider);

  return {
    owner: validatedOwner,
    provider: validatedProvider,
    // Long types from protobuf need explicit toString() conversion
    dseq: typeof lease.lease.dseq === 'number'
      ? String(lease.lease.dseq)
      : String(lease.lease.dseq),
    gseq: lease.lease.gseq,
    oseq: lease.lease.oseq,
    state: 'active',
    price: {
      // Bid price is optional in SDK type, provide fallback
      denom: bid.price?.denom ?? 'uakt',
      amount: bid.price?.amount ?? '0',
    },
    createdAt: new Date().toISOString(),
  };
}
