/**
 * Akash Network Deployment SDK
 *
 * A delightful API for deploying to Akash Network with excellent TypeScript support.
 *
 * This module provides a clean, organized public API for all Akash deployment operations.
 * Functions are grouped by responsibility for easy discovery and intuitive usage.
 *
 * @example Quick Start - Simple Deployment
 * ```typescript
 * import { deployToAkash, connectWallet, ensureCertificate, createSigningClient } from '@deploy-ability/akash';
 *
 * // 1. Connect wallet
 * const walletResult = await connectWallet({ network: 'mainnet' });
 * if (!walletResult.success) throw walletResult.error;
 *
 * // 2. Create signing client
 * const clientResult = await createSigningClient(walletResult.data, 'mainnet');
 * if (!clientResult.success) throw clientResult.error;
 *
 * // 3. Ensure certificate exists
 * const certResult = await ensureCertificate(
 *   walletResult.data,
 *   'mainnet',
 *   clientResult.data.client
 * );
 * if (!certResult.success) throw certResult.error;
 *
 * // 4. Deploy!
 * const result = await deployToAkash({
 *   wallet: walletResult.data,
 *   certificate: certResult.data,
 *   projectRoot: './my-app',
 *   profile: 'production',
 *   network: 'mainnet'
 * });
 *
 * if (result.success) {
 *   console.log(`Deployed! DSEQ: ${result.data.dseq}`);
 *   console.log(`Endpoints:`, result.data.endpoints);
 * }
 * ```
 *
 * @example Advanced - Custom Bid Selection
 * ```typescript
 * import { createDeployment, queryBids, createLease } from '@deploy-ability/akash';
 *
 * // Create deployment
 * const deployment = await createDeployment(clientContext, wallet, sdl, 5);
 * if (!deployment.success) throw deployment.error;
 *
 * // Get bids
 * const bids = await queryBids(wallet, 'mainnet', deployment.data.dseq);
 * if (!bids.success) throw bids.error;
 *
 * // Filter for cheapest GPU bid under budget
 * const affordableBids = bids.data.filter(bid =>
 *   parseInt(bid.price?.amount ?? '0') < 1000 // uakt per block
 * );
 *
 * if (affordableBids.length === 0) {
 *   throw new Error('No affordable bids found');
 * }
 *
 * // Create lease with selected bid
 * const lease = await createLease(clientContext, affordableBids[0]);
 * if (!lease.success) throw lease.error;
 * ```
 *
 * @example Expert - Full Control with Primitives
 * ```typescript
 * import * as akash from '@deploy-ability/akash';
 *
 * // Full access to all primitives for custom workflows
 * const wallet = await akash.connectWallet({ network: 'mainnet' });
 * const cert = await akash.generateCertificate(wallet.data.address);
 * const sdl = akash.createSdlObject(profile);
 * // ... compose your own deployment flow with complete control
 * ```
 *
 * @module akash
 */

// ========================================
// Core Client API
// ========================================

/**
 * Akash blockchain client
 *
 * Single SDK instance manager for all Akash blockchain operations.
 * Creates one SDK instance (vs 7+ in old implementation) for 85% reduction in overhead.
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
 * // Cleanup when done
 * await client.disconnect();
 * ```
 */
export { AkashClient } from './client.js';

/**
 * Certificate manager for Akash Network
 *
 * Handles certificate operations using AkashClient's SDK instance.
 * Provides methods for querying, broadcasting, and ensuring certificates exist.
 */
export { CertificateManager } from './certificate-manager.js';

/**
 * Certificate utility functions
 *
 * Standalone utilities that don't require SDK access:
 * - generateCertificate: Create new X.509 certificate
 * - parseCertificate: Validate and parse certificate JSON
 */
export { generateCertificate, parseCertificate } from './certificate-manager.js';

/**
 * Core client types
 */
export type {
  AkashClientOptions,
  DeploymentResult,
  LeaseResult,
  BidQueryOptions,
  BidAwaitOptions,
  LeaseIdentifier,
  DeploymentDetails,
  ProviderBid,
} from './client.js';

// ========================================
// High-Level Deployment API
// ========================================

/**
 * Main deployment orchestration function
 *
 * Handles the complete deployment workflow:
 * - Profile loading and SDL generation
 * - Deployment creation on blockchain
 * - Provider bid collection
 * - Lease creation
 * - Manifest delivery
 * - Optional container readiness monitoring
 */
export { deployToAkash } from './deployer.js';

/**
 * Deployment execution parameters
 *
 * Requires wallet context and optional certificate for provider communication
 */
export type { AkashDeploymentExecution } from './deployer.js';

// ========================================
// Wallet Management
// ========================================

/**
 * Connect wallet (Keplr browser extension or WalletConnect)
 *
 * Primary wallet connection method. Automatically detects and uses Keplr
 * if available, otherwise falls back to WalletConnect if project ID provided.
 *
 * @example Connect with Keplr
 * ```typescript
 * const result = await connectWallet({ network: 'mainnet' });
 * if (result.success) {
 *   console.log('Connected:', result.data.address);
 * }
 * ```
 *
 * @example Connect with WalletConnect
 * ```typescript
 * const result = await connectWallet({
 *   network: 'mainnet',
 *   walletConnectProjectId: 'your-project-id'
 * });
 * ```
 */
export { connectWallet } from './wallet-manager.js';

/**
 * Initialize WalletConnect client
 *
 * Lower-level function for manual WalletConnect setup.
 * Use connectWallet() for most cases.
 */
export { initWalletConnect } from './wallet-manager.js';

/**
 * Generate WalletConnect connection URI
 *
 * Creates connection URI for QR code display.
 */
export { generateConnectionUri } from './wallet-manager.js';

/**
 * Wait for WalletConnect approval
 *
 * Polls for user approval from mobile wallet.
 */
export { waitForApproval } from './wallet-manager.js';

/**
 * Create wallet context from signer
 *
 * Converts offline signer into full wallet context with account info.
 */
export { createWalletContext } from './wallet-manager.js';

/**
 * Create wallet context from signer (for automated deployments)
 *
 * Use this for **automated deployments** where you have direct access to a signer
 * instead of interactive wallet connection. Perfect for agents, CI/CD, hardware
 * wallets, or KMS - accepts signer interface without requiring mnemonic exposure.
 *
 * **Security Model**: Signers can sign transactions without exposing private keys!
 *
 * @example Agent with encrypted wallet
 * ```typescript
 * const agentSigner = await myAgent.wallet.getSigner();
 * const walletCtx = await createWalletContextFromSigner(agentSigner, 'mainnet');
 *
 * if (walletCtx.success) {
 *   await deployToAkash({
 *     wallet: walletCtx.data,
 *     certificate: cert,
 *     projectRoot: './',
 *     profile: 'prod'
 *   });
 * }
 * ```
 *
 * @example CI/CD with secrets manager
 * ```typescript
 * const signer = await loadSignerFromSecretsManager();
 * const walletCtx = await createWalletContextFromSigner(signer, 'mainnet');
 * ```
 */
export { createWalletContextFromSigner } from './wallet-manager.js';

/**
 * Create wallet context from mnemonic (for agent-controlled wallets)
 *
 * WARNING: Only use this for wallets YOU control!
 *
 * Use this for:
 * - Your own CI/CD automation
 * - Your own agents (running on your infrastructure)
 * - Custodial services you operate
 *
 * **NEVER** give your mnemonic to third-party agents!
 * For third-party services, use `connectWallet()` with WalletConnect instead.
 *
 * @example CI/CD deployment
 * ```typescript
 * // Mnemonic from GitHub Secrets
 * const mnemonic = process.env.DEPLOYMENT_WALLET_MNEMONIC!;
 * const wallet = await createWalletFromMnemonic(mnemonic, 'mainnet');
 *
 * if (wallet.success) {
 *   await deployToAkash({ wallet: wallet.data, ... });
 * }
 * ```
 *
 * **Note**: This function is not yet fully implemented - see function documentation
 * for complete implementation plan and security considerations.
 */
export { createWalletFromMnemonic } from './wallet-manager.js';

/**
 * Disconnect wallet
 *
 * Safely disconnects wallet and cleans up WalletConnect sessions if applicable.
 */
export { disconnectWallet } from './wallet-manager.js';

/**
 * Wallet connection types
 */
export type {
  WalletConnectClient,
  ConnectionUriResult,
  ApprovalResult,
} from './wallet-manager.js';

// ========================================
// Certificate Management
// ========================================

/**
 * Certificate types
 *
 * Note: Certificate operations (broadcast, query, getOrCreate, revoke) are now
 * class methods on CertificateManager. Access via client.getCertificateManager()
 */
export type {
  CertificateBroadcastResult,
  CertificateRevokeResult,
  OnChainCertificateInfo,
} from './certificate-manager.js';

// ========================================
// Blockchain Operations
// ========================================

/**
 * Blockchain operations are now class methods on AkashClient.
 *
 * Create a client instance and call methods directly:
 * - client.createDeployment()
 * - client.getBids()
 * - client.awaitBids()
 * - client.acceptBid()
 * - client.closeDeployment()
 * - client.getLeaseById()
 * - client.getDeployment()
 * - etc.
 *
 * @example
 * ```typescript
 * import { AkashClient } from '@kadi.build/deploy-ability/akash';
 *
 * const client = new AkashClient({ network: 'mainnet', signer });
 *
 * // Create deployment
 * const deployment = await client.createDeployment(wallet.address, sdl, 5);
 *
 * // Wait for bids
 * const bids = await client.awaitBids(wallet, deployment.data.dseq);
 *
 * // Accept bid
 * const lease = await client.acceptBid(bids.data[0].bid);
 *
 * // Cleanup
 * await client.disconnect();
 * ```
 */

// ========================================
// Provider Selection & Bid Management
// ========================================

/**
 * Enhanced bid with complete provider information
 *
 * Combines raw blockchain bid data with enriched provider metadata,
 * comprehensive pricing calculations, and reliability metrics. This is
 * the primary type for working with provider bids.
 *
 * **What's Included:**
 * - Provider identity (name, owner address, host URI)
 * - Location information (country, region, coordinates)
 * - Reliability metrics (uptime1d, uptime7d, uptime30d)
 * - Audit status
 * - Complete pricing across multiple time periods (hour/day/week/month)
 * - Pricing in multiple currencies (uAKT, AKT, USD via conversion)
 *
 * **Data Availability:**
 * - Some providers may not have complete metadata
 * - Reliability data requires provider to be tracked by indexer
 * - Location data comes from IP geolocation
 * - Always check for undefined before using optional fields
 *
 * @example Working with enhanced bids
 * ```typescript
 * const bidsResult = await queryBids(wallet, 'mainnet', dseq);
 * if (!bidsResult.success) throw bidsResult.error;
 *
 * for (const bid of bidsResult.data) {
 *   console.log('Provider:', bid.provider.name || bid.provider.owner);
 *   console.log('Location:', bid.provider.location?.country || 'Unknown');
 *   console.log('Price:', bid.pricing.akt.perMonth, 'AKT/month');
 *
 *   if (bid.provider.reliability) {
 *     console.log('Uptime (7d):', (bid.provider.reliability.uptime7d * 100).toFixed(1) + '%');
 *   }
 * }
 * ```
 *
 * @see BidPricing for pricing structure details
 * @see ProviderInfo for provider metadata structure
 */
export type { EnhancedBid } from './bids.js';

/**
 * Bid selector function type
 *
 * Function signature for selecting a provider from available bids.
 * Can be synchronous or asynchronous to support both algorithmic
 * and interactive selection strategies.
 *
 * **Contract:**
 * - Input: Non-empty array of EnhancedBid
 * - Output: Selected EnhancedBid or null if none acceptable
 * - Should not throw - return null instead for unacceptable bids
 *
 * **Use Cases:**
 * - Algorithmic selection (cheapest, most reliable, balanced)
 * - Interactive selection (CLI prompts, UI selection)
 * - External validation (check against allowlist, query external APIs)
 * - Complex business logic (budget constraints, compliance requirements)
 *
 * @example Simple algorithmic selector
 * ```typescript
 * const selector: BidSelector = (bids) => {
 *   if (bids.length === 0) return null;
 *   return bids.reduce((cheapest, current) =>
 *     current.pricing.uakt.perMonth < cheapest.pricing.uakt.perMonth
 *       ? current : cheapest
 *   );
 * };
 * ```
 *
 * @example Async interactive selector
 * ```typescript
 * const selector: BidSelector = async (bids) => {
 *   console.log('Available providers:');
 *   bids.forEach((bid, i) => {
 *     console.log(`${i + 1}. ${bid.provider.name} - ${bid.pricing.akt.perMonth} AKT/month`);
 *   });
 *
 *   const choice = await promptUser('Select provider: ');
 *   return bids[parseInt(choice) - 1] || null;
 * };
 * ```
 *
 * @see Pre-built selectors: selectCheapestBid, selectMostReliableBid, selectBalancedBid
 */
export type { BidSelector } from './bids.js';

/**
 * Comprehensive bid pricing structure
 *
 * Pre-calculated pricing across multiple time periods and currencies.
 * All calculations are derived from the raw per-block price returned
 * by the blockchain.
 *
 * **Time Periods:**
 * - Per block: Raw blockchain price
 * - Per hour: ~590.8 blocks (based on 6.098s average block time)
 * - Per day: ~14,179 blocks
 * - Per week: ~99,254 blocks
 * - Per month: ~431,572 blocks (30.437 days average)
 *
 * **Currencies:**
 * - uAKT: Micro AKT (1 AKT = 1,000,000 uAKT)
 * - AKT: Standard token denomination
 * - USD: Via toUSD() method with market price
 *
 * @example Display pricing
 * ```typescript
 * const bid: EnhancedBid = // ... from queryBids
 *
 * // Native currency
 * console.log(`${bid.pricing.uakt.perMonth} uAKT/month`);
 * console.log(`${bid.pricing.akt.perMonth.toFixed(2)} AKT/month`);
 *
 * // USD conversion
 * const aktPrice = 0.50; // $0.50 per AKT
 * const usd = bid.pricing.toUSD(aktPrice);
 * console.log(`$${usd.perMonth.toFixed(2)}/month`);
 * console.log(`$${usd.perHour.toFixed(4)}/hour`);
 * ```
 *
 * @see createBidPricing to create pricing from raw blockchain data
 */
export type { BidPricing } from './bids.js';

/**
 * Create BidPricing from raw blockchain price
 *
 * Calculates all time-period prices from per-block price.
 * Used internally by queryBids, but exposed for advanced use cases.
 *
 * @example
 * ```typescript
 * const pricing = createBidPricing({
 *   denom: 'uakt',
 *   amount: '1234' // uAKT per block
 * });
 *
 * console.log(pricing.akt.perMonth); // Monthly cost in AKT
 * ```
 */
export { createBidPricing } from './bids.js';

/**
 * Select cheapest bid
 *
 * Returns the bid with the lowest monthly price. Best for development
 * and testing where cost is the primary concern.
 *
 * **Considerations:**
 * - Only considers price, not reliability or location
 * - For production, combine with filterBids for quality constraints
 * - Cheapest doesn't always mean best value
 *
 * @example Simple cheapest selection
 * ```typescript
 * import { deployToAkash, selectCheapestBid } from '@kadi.build/deploy-ability/akash';
 *
 * const result = await deployToAkash({
 *   wallet,
 *   certificate,
 *   projectRoot: './',
 *   profile: 'dev',
 *   bidSelector: selectCheapestBid
 * });
 * ```
 *
 * @example With quality filtering
 * ```typescript
 * const result = await deployToAkash({
 *   wallet,
 *   certificate,
 *   projectRoot: './',
 *   profile: 'prod',
 *   bidSelector: (bids) => {
 *     const qualityBids = filterBids(bids, {
 *       requireAudited: true,
 *       minUptime: { value: 0.95, period: '7d' }
 *     });
 *     return selectCheapestBid(qualityBids);
 *   }
 * });
 * ```
 */
export { selectCheapestBid } from './bids.js';

/**
 * Select most reliable bid
 *
 * Returns the bid with highest uptime percentage. Best for production
 * deployments where reliability is critical.
 *
 * **Uptime Periods:**
 * - '1d': Last 24 hours (most recent, limited sample)
 * - '7d': Last 7 days (recommended default)
 * - '30d': Last 30 days (long-term stability)
 *
 * **Fallback:**
 * If no providers have reliability data, returns first bid.
 *
 * @example Default 7-day uptime
 * ```typescript
 * const result = await deployToAkash({
 *   wallet,
 *   certificate,
 *   projectRoot: './',
 *   profile: 'production',
 *   bidSelector: selectMostReliableBid
 * });
 * ```
 *
 * @example Custom 30-day period
 * ```typescript
 * const result = await deployToAkash({
 *   wallet,
 *   certificate,
 *   projectRoot: './',
 *   profile: 'production',
 *   bidSelector: (bids) => selectMostReliableBid(bids, '30d')
 * });
 * ```
 */
export { selectMostReliableBid } from './bids.js';

/**
 * Select balanced bid (price + reliability)
 *
 * Calculates weighted score combining normalized price and uptime,
 * then selects highest-scoring bid. Best for production where both
 * cost and reliability matter.
 *
 * **Scoring:**
 * - Price score: 0-1 (lower price = higher score)
 * - Reliability score: uptime7d (0-1)
 * - Total: (price × weight) + (reliability × weight)
 *
 * **Default weights:** 0.5 price, 0.5 reliability (equal balance)
 *
 * @example Equal balance (default)
 * ```typescript
 * const result = await deployToAkash({
 *   wallet,
 *   certificate,
 *   projectRoot: './',
 *   profile: 'production',
 *   bidSelector: selectBalancedBid
 * });
 * ```
 *
 * @example Prioritize reliability (70/30)
 * ```typescript
 * const result = await deployToAkash({
 *   wallet,
 *   certificate,
 *   projectRoot: './',
 *   profile: 'critical-prod',
 *   bidSelector: (bids) => selectBalancedBid(bids, {
 *     price: 0.3,
 *     reliability: 0.7
 *   })
 * });
 * ```
 *
 * @example Prioritize cost (80/20)
 * ```typescript
 * const result = await deployToAkash({
 *   wallet,
 *   certificate,
 *   projectRoot: './',
 *   profile: 'dev',
 *   bidSelector: (bids) => selectBalancedBid(bids, {
 *     price: 0.8,
 *     reliability: 0.2
 *   })
 * });
 * ```
 */
export { selectBalancedBid } from './bids.js';

/**
 * Filter bids by criteria
 *
 * Apply multiple filters to narrow down options. All criteria are
 * optional and combined with AND logic.
 *
 * **Philosophy:**
 * Use this to establish minimum quality standards, then apply a
 * selection strategy to choose from acceptable bids.
 *
 * **Available Filters:**
 * - maxPricePerMonth: Budget constraint (uAKT or USD)
 * - minUptime: Minimum reliability requirement
 * - requireAudited: Only audited providers
 * - preferredRegions: Geographic requirements
 * - requireOnline: Only currently online providers
 *
 * @example Price and uptime filtering
 * ```typescript
 * const filtered = filterBids(bids, {
 *   maxPricePerMonth: { usd: 50, aktPrice: 0.45 },
 *   minUptime: { value: 0.95, period: '7d' }
 * });
 * const selected = selectCheapestBid(filtered);
 * ```
 *
 * @example Audit and location filtering
 * ```typescript
 * const filtered = filterBids(bids, {
 *   requireAudited: true,
 *   preferredRegions: ['US', 'EU'],
 *   requireOnline: true
 * });
 * ```
 *
 * @example Price filtering in uAKT
 * ```typescript
 * const filtered = filterBids(bids, {
 *   maxPricePerMonth: { uakt: 500_000_000 }
 * });
 * ```
 */
export { filterBids } from './bids.js';

/**
 * Provider information with metadata and metrics
 *
 * Complete provider profile including identity, location, reliability,
 * and audit status. Returned as part of EnhancedBid.
 *
 * **Data Sources:**
 * - Blockchain: Owner address, host URI, audit status
 * - Cloudmos API: Reliability metrics, location, version info
 *
 * **Field Availability:**
 * - owner, hostUri, isAudited: Always present
 * - name, email, website: Optional (provider-specified)
 * - location: Optional (from IP geolocation)
 * - reliability: Optional (requires indexer tracking)
 * - versions: Optional (from provider status)
 */
export type { ProviderInfo } from './types.js';

/**
 * Provider geographic location
 *
 * IP-based geolocation data for the provider's host.
 * Useful for latency optimization and compliance requirements.
 */
export type { ProviderLocation } from './types.js';

/**
 * Provider reliability metrics
 *
 * Uptime statistics tracked by the Cloudmos indexer.
 * Shows provider availability over different time periods.
 *
 * **Uptime Values:**
 * - Range: 0.0 to 1.0 (0% to 100%)
 * - Example: 0.95 = 95% uptime
 *
 * **Time Periods:**
 * - uptime1d: Last 24 hours
 * - uptime7d: Last 7 days (recommended)
 * - uptime30d: Last 30 days
 */
export type { ProviderReliability } from './types.js';

/**
 * Fetch provider metadata
 *
 * Fetches complete provider information from Cloudmos API with
 * blockchain fallback. Includes reliability metrics, location,
 * and audit status.
 *
 * **Use Cases:**
 * - Pre-deployment provider research
 * - Building custom provider directories
 * - Monitoring provider status
 *
 * @example Fetch single provider
 * ```typescript
 * const result = await fetchProviderInfo('mainnet', 'akash1...');
 * if (result.success) {
 *   const provider = result.data;
 *   console.log('Provider:', provider.name || provider.owner);
 *   if (provider.reliability) {
 *     console.log('Uptime:', (provider.reliability.uptime7d * 100) + '%');
 *   }
 * }
 * ```
 */
export { fetchProviderInfo } from './provider-manager.js';

/**
 * Fetch multiple providers in parallel
 *
 * Efficiently fetches information for multiple providers at once.
 * Used internally by queryBids, but exposed for advanced use cases.
 *
 * @example Batch fetch
 * ```typescript
 * const addresses = ['akash1...', 'akash2...', 'akash3...'];
 * const result = await fetchProviderInfoBatch('mainnet', addresses);
 *
 * if (result.success) {
 *   for (const [address, info] of result.data) {
 *     console.log(address, ':', info.name || 'Unknown');
 *   }
 * }
 * ```
 */
export { fetchProviderInfoBatch } from './provider-manager.js';

// ========================================
// Query & Monitoring
// ========================================

/**
 * Query functions are now AkashClient methods:
 * - client.getLeases() - Query leases with filters
 * - client.getLeaseById() - Get lease details
 * - client.getDeployment() - Get deployment details
 * - client.getProvider() - Get provider metadata
 *
 * Types are exported from client.ts and types.ts
 */

/**
 * Wait for containers to reach running state
 *
 * Polls provider for container status until all containers are running or timeout.
 */
export { waitForContainersRunning } from './lease-monitor.js';

/**
 * Monitoring configuration and result types
 */
export type { LeaseMonitorOptions } from './lease-monitor.js';

/**
 * Send manifest to provider
 *
 * Delivers deployment manifest to provider via HTTPS with mTLS authentication.
 */
export { sendManifestToProvider } from './provider-manager.js';

/**
 * Fetch lease status from provider
 *
 * Query provider for current lease status and service URIs.
 */
export { fetchProviderLeaseStatus } from './provider-manager.js';

/**
 * Provider communication types
 */
export type {
  LeaseReference,
  ProviderLeaseStatus,
  ProviderServiceStatus,
} from './provider-manager.js';

// ========================================
// Log Streaming
// ========================================

/**
 * Stream container logs from Akash deployment in real-time
 *
 * Returns an EventEmitter that emits parsed log lines as they arrive from the provider.
 * Uses WebSocket with mTLS authentication to connect directly to the Akash provider.
 *
 * **Key Features:**
 * - Real-time log streaming with WebSocket
 * - Service filtering (filter by specific containers)
 * - Tail support (show last N lines)
 * - Automatic log parsing and service name extraction
 * - Event-based API for flexible consumption
 *
 * @example Stream logs and watch for specific messages
 * ```typescript
 * const stream = streamDeploymentLogs({
 *   deployment: deploymentData,
 *   wallet: walletContext,
 *   certificate: certData,
 *   network: 'mainnet',
 *   services: ['ollama'],
 *   follow: true,
 *   tail: 100
 * });
 *
 * stream.on('log', (log) => {
 *   console.log(`[${log.service}] ${log.message}`);
 *
 *   // Watch for specific events
 *   if (log.message.includes('Model ready!')) {
 *     console.log('Model is ready!');
 *     stream.close();
 *   }
 * });
 *
 * stream.on('error', (error) => {
 *   console.error('Stream error:', error);
 * });
 * ```
 *
 * @example Monitor model weight downloads
 * ```typescript
 * const stream = streamDeploymentLogs({
 *   deployment: modelDeployment,
 *   wallet: walletContext,
 *   certificate: certData,
 *   network: 'mainnet',
 *   tail: 0 // Start from now
 * });
 *
 * stream.on('log', (log) => {
 *   if (log.message.includes('pulling manifest')) {
 *     console.log('📦 Downloading model weights...');
 *   }
 *   if (log.message.includes('100%')) {
 *     console.log('Download complete!');
 *   }
 * });
 * ```
 */
export { streamDeploymentLogs } from './logs.js';

/**
 * Get deployment logs as a complete array (non-streaming)
 *
 * Collects logs up to maxLogs or timeout, then returns them as an array.
 * Useful for downloading full logs or one-time log retrieval.
 *
 * @example Download logs to file
 * ```typescript
 * const logs = await getDeploymentLogs({
 *   deployment: deploymentData,
 *   wallet: walletContext,
 *   certificate: certData,
 *   network: 'mainnet',
 *   tail: 1000,
 *   maxLogs: 1000
 * });
 *
 * const logText = logs.map(log =>
 *   `[${log.receivedAt.toISOString()}] [${log.service}] ${log.message}`
 * ).join('\n');
 *
 * fs.writeFileSync('deployment.log', logText);
 * ```
 */
export { getDeploymentLogs } from './logs.js';

/**
 * Log streaming types
 */
export type {
  StreamLogsOptions,
  GetLogsOptions,
  LogEntry,
  LogStream,
} from './logs.js';

// ========================================
// 📋 SDL Generation
// ========================================

/**
 * Generate Akash SDL YAML from profile
 *
 * Transforms deployment profile into SDL format for blockchain submission.
 *
 * @example
 * ```typescript
 * const yaml = generateAkashSdl(profile, {
 *   defaultCpuUnits: 1.0,
 *   defaultMemorySize: '1Gi'
 * });
 * ```
 */
export { generateAkashSdl } from './sdl-generator.js';

/**
 * Create SDL object instance
 *
 * Generates SDL YAML and returns instantiated SDL helper from akashjs.
 * Provides access to groups() and manifestVersion() methods.
 */
export { createSdlObject } from './sdl-generator.js';

/**
 * SDL generation options
 */
export type { AkashSdlGenerationOptions } from './sdl-generator.js';

// ========================================
// Pricing Utilities
// ========================================

/**
 * Lease price calculator with multi-format support
 *
 * Calculates lease costs in multiple formats (per block, per hour, per month)
 * and supports USD conversion when AKT market price is provided.
 *
 * **Key Features:**
 * - Pre-computed prices in uAKT and AKT
 * - Per-block, per-hour, and per-month calculations
 * - USD conversion with custom AKT price
 * - Matches Akash Console calculations exactly
 *
 * **Constants Used:**
 * - Average block time: 6.098 seconds
 * - Average days per month: 30.437 days
 *
 * @example Display pricing in uAKT
 * ```typescript
 * const result = await deployToAkash({ ... });
 * if (result.success) {
 *   const { leasePrice } = result.data;
 *   console.log(`Cost: ${leasePrice.uakt.perMonth} uAKT/month`);
 *   console.log(`Cost: ${leasePrice.akt.perMonth} AKT/month`);
 * }
 * ```
 *
 * @example Convert to USD
 * ```typescript
 * // Fetch AKT price from CoinGecko or other source
 * const aktPrice = 0.50; // $0.50 per AKT
 *
 * const result = await deployToAkash({ ... });
 * if (result.success) {
 *   const usd = result.data.leasePrice.toUSD(aktPrice);
 *   console.log(`Cost: $${usd.perMonth.toFixed(2)}/month`);
 *   console.log(`Cost: $${usd.perHour.toFixed(4)}/hour`);
 * }
 * ```
 *
 * @see LeasePrice class documentation for detailed usage
 */
export { LeasePrice } from './pricing.js';

/**
 * Pricing constants
 *
 * Average block time and days in month used for price calculations.
 * These match the values used by Akash Console.
 */
export {
  AVERAGE_BLOCK_TIME_SECONDS,
  AVERAGE_DAYS_IN_MONTH,
  UAKT_PER_AKT,
} from './pricing.js';

// ========================================
// Environment & Configuration
// ========================================

/**
 * Get network configuration
 *
 * Returns RPC endpoint and chain ID for specified network.
 *
 * @example
 * ```typescript
 * const config = getNetworkConfig('mainnet');
 * console.log('RPC:', config.rpc);
 * ```
 */
export { getNetworkConfig } from './environment.js';

/**
 * Network configurations for mainnet and testnet
 */
export { AKASH_NETWORKS } from './environment.js';

/**
 * Environment configuration types
 */
export type { AkashNetwork, NetworkConfiguration } from './environment.js';

/**
 * Placement attribute constants
 *
 * Valid values for geographic and provider targeting when deploying to Akash.
 * These reflect **actual provider values** from mainnet, not the official schema.
 *
 * @example
 * ```typescript
 * import { AKASH_REGIONS, AKASH_TIERS } from '@kadi.build/deploy-ability';
 *
 * console.log(AKASH_REGIONS['us-west']);
 * // "Western United States (California, Oregon, Washington, Nevada)"
 *
 * console.log(AKASH_TIERS['community']);
 * // "Community-tier providers (standard pricing, good for most workloads)"
 * ```
 */
export {
  AKASH_REGIONS,
  AKASH_TIERS,
  getAkashRegions,
  getAkashTiers,
} from './constants.js';

/**
 * Placement attribute types
 */
export type {
  AkashRegion,
  AkashTier,
} from './constants.js';

// ========================================
// 🐳 Local Image Registry
// ========================================

/**
 * Setup temporary registry for local images
 *
 * Automatically detects local images and makes them accessible to Akash providers:
 * 1. Starts temporary registry on localhost
 * 2. Pushes local images to registry
 * 3. Exposes registry publicly via tunnel (ngrok/serveo/bore)
 * 4. Rewrites profile to use public registry URLs
 * 5. Returns cleanup function to shut down registry after deployment
 *
 * **Three Outcomes:**
 * - No local images → Returns profile unchanged
 * - User opted out (useRemoteRegistry: true) → Returns profile unchanged
 * - Local images found → Starts registry, transforms profile
 *
 * @example
 * ```typescript
 * const ctx = await setupRegistryIfNeeded(profile, logger, {
 *   containerEngine: 'docker',
 *   tunnelService: 'serveo'
 * });
 *
 * try {
 *   await deployToAkash({
 *     loadedProfile: { profile: ctx.deployableProfile }
 *   });
 * } finally {
 *   await ctx.cleanup(); // Always cleanup
 * }
 * ```
 */
export { setupRegistryIfNeeded } from '../../utils/registry/index.js';

/**
 * Check if profile contains local images
 *
 * Uses reality-based detection (docker images -q) to check if images
 * actually exist locally rather than guessing based on name patterns.
 *
 * @example
 * ```typescript
 * if (hasLocalImages(profile, 'docker')) {
 *   console.log('Local images detected - registry will be needed');
 * }
 * ```
 */
export { hasLocalImages } from '../../utils/registry/index.js';

/**
 * Registry manager class for advanced use cases
 *
 * Provides low-level control over registry operations. Most users should
 * use `setupRegistryIfNeeded()` instead.
 */
export { TemporaryContainerRegistryManager } from '../../utils/registry/index.js';

/**
 * Registry types
 */
export type {
  RegistryContext,
  RegistryOptions,
  ContainerMapping,
  RegistryCredentials
} from '../../utils/registry/types.js';

// ========================================
// 📦 Core Types
// ========================================

/**
 * Wallet context for Akash operations
 *
 * Contains wallet address, signers, and optional WalletConnect session.
 */
export type { WalletContext } from './types.js';

/**
 * Akash provider TLS certificate
 *
 * X.509 certificate for mTLS authentication with providers.
 */
export type { AkashProviderTlsCertificate } from './types.js';

/**
 * Keplr signer with dual signing capabilities
 */
export type { KeplrSigner } from './types.js';

/**
 * Account data from blockchain
 */
export type { AccountData } from './types.js';

/**
 * Type guards for wallet context
 */
export { isWalletConnectSession, hasAccountData } from './types.js';
