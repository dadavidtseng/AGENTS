/**
 * Akash Provider Management
 *
 * Complete provider operations including communication, metadata fetching,
 * and reliability tracking. Handles both direct provider interaction via
 * mTLS and provider discovery via Console API and blockchain queries.
 *
 * @module targets/akash/providers
 */

import https from 'node:https';
import { URL } from 'node:url';
import axios, { type AxiosError } from 'axios';

import type { Result } from '../../types/index.js';
import { success, failure } from '../../types/index.js';
import type { ProviderUri } from '../../types/common.js';
import { DeploymentError, getErrorMessage } from '../../errors/index.js';
import {
  ProviderError,
  ProviderErrorCodes,
  providerUnreachableError,
  manifestRejectedError,
} from '../../errors/index.js';
import type { AkashProviderTlsCertificate, ProviderInfo, ProviderLocation, ProviderReliability } from './types.js';
import type { AkashNetwork } from './environment.js';
import { AkashClient } from './client.js';

// ========================================
// Type Definitions
// ========================================

/** Minimal lease identifier required for provider API operations */
export interface LeaseReference {
  readonly dseq: string | number;
  readonly gseq: number;
  readonly oseq: number;
}

/** Options for manifest delivery */
export interface ManifestDeliveryOptions {
  readonly providerUri: string;
  readonly lease: LeaseReference;
  readonly manifest: string;
  readonly certificate: AkashProviderTlsCertificate;
  readonly timeoutMs?: number;
}

/** Status information for a single service reported by the provider */
export interface ProviderServiceStatus {
  readonly name: string;
  readonly available: number;
  readonly total: number;
  readonly ready: number;
  readonly uris: readonly string[];
}

/** Forwarded port definition (useful when provider maps ports externally) */
export interface ProviderForwardedPort {
  readonly port: number;
  readonly externalPort: number;
  readonly host: string;
  readonly available: number;
}

/** Assigned IP metadata reported by provider */
export interface ProviderAssignedIp {
  readonly ip: string;
  readonly port: number;
  readonly externalPort: number;
  readonly protocol: string;
}

/** Normalised provider lease status response */
export interface ProviderLeaseStatus {
  readonly services: Readonly<Record<string, ProviderServiceStatus>>;
  readonly forwardedPorts?: Readonly<Record<string, readonly ProviderForwardedPort[]>>;
  readonly assignedIps?: Readonly<Record<string, readonly ProviderAssignedIp[]>>;
}

/** Options for querying provider container status */
export interface ProviderStatusOptions {
  readonly providerUri: string;
  readonly lease: LeaseReference;
  readonly certificate: AkashProviderTlsCertificate;
  readonly timeoutMs?: number;
}

/**
 * Akash Console API provider response structure
 *
 * This matches the structure returned by the Akash Console API.
 * The API aggregates provider data from the blockchain and adds
 * additional metrics collected by the indexer.
 */
interface ConsoleProviderResponse {
  owner: string;
  hostUri: string;
  name?: string | null;
  email?: string;
  website?: string;
  isAudited: boolean;
  isOnline?: boolean;
  uptime1d?: number;
  uptime7d?: number;
  uptime30d?: number;
  ipRegion?: string;
  ipRegionCode?: string;
  ipCountry?: string;
  ipCountryCode?: string;
  ipLat?: string;
  ipLon?: string;
  akashVersion?: string;
  cosmosSdkVersion?: string;
  lastCheckDate?: string;
}

// ========================================
// Section 1: Provider Communication (mTLS)
// ========================================

/** Normalises a provider URI string and ensures it uses HTTPS */
function normaliseProviderUri(uri: string): ProviderUri {
  const parsed = new URL(uri);

  if (parsed.protocol !== 'https:') {
    throw new ProviderError(
      `Provider URI must use HTTPS: ${uri}`,
      ProviderErrorCodes.PROVIDER_ERROR,
      { uri },
      false,
      'Ensure the provider URI begins with https://'
    );
  }

  // Force trailing slash removal for consistent downstream concatenation
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  return parsed.toString() as ProviderUri;
}

/**
 * Builds the HTTPS agent used for mutual TLS authentication with the provider
 *
 * Sets servername to empty string to disable SNI (Server Name Indication), which is required
 * for compatibility with all providers.
 */
function createMtlsAgent(certificate: AkashProviderTlsCertificate): https.Agent {
  return new https.Agent({
    cert: certificate.cert,
    key: certificate.privateKey,
    ca: certificate.chain,
    rejectUnauthorized: false, // Providers often use self-signed certificates
    servername: '', // Disable SNI for mTLS authentication (required by some providers)
  });
}

/**
 * Sends the deployment manifest to the provider over mTLS
 *
 * @param options - Manifest delivery configuration
 * @returns Result signalling success or a ProviderError on failure
 */
export async function sendManifestToProvider(
  options: ManifestDeliveryOptions
): Promise<Result<void, ProviderError>> {
  const {
    providerUri,
    lease,
    manifest,
    certificate,
    timeoutMs = 30_000,
  } = options;

  let normalised: ProviderUri;
  try {
    normalised = normaliseProviderUri(providerUri);
  } catch (error) {
    return failure(error as ProviderError);
  }

  const parsed = new URL(normalised);
  const path = `/deployment/${String(lease.dseq)}/manifest`;

  const agent = createMtlsAgent(certificate);

  return new Promise<Result<void, ProviderError>>((resolve) => {
    const request = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || '8443',
        method: 'PUT',
        path,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Content-Length': Buffer.byteLength(manifest, 'utf8'),
        },
        agent,
        timeout: timeoutMs,
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;

        // Fast-path success: provider accepted the manifest (200/202)
        if (statusCode >= 200 && statusCode < 300) {
          resolve(success(undefined));
          response.resume();
          return;
        }

        // Collect error body for diagnostics
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');

          if (statusCode === 400 || statusCode === 422) {
            resolve(
              failure(manifestRejectedError(parsed.hostname, body.trim() || undefined))
            );
          } else {
            resolve(
              failure(
                new ProviderError(
                  `Provider returned ${statusCode} while sending manifest`,
                  ProviderErrorCodes.MANIFEST_SEND_FAILED,
                  {
                    providerUri: normalised,
                    statusCode,
                    body: body.trim() || undefined,
                  },
                  true,
                  'Retry the deployment or choose another provider'
                )
              )
            );
          }
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(
        providerUnreachableError(parsed.host, new Error('Manifest delivery timed out'))
      );
    });

    request.on('error', (error) => {
      // Network errors are wrapped as provider unreachable for caller clarity
      resolve(failure(providerUnreachableError(parsed.host, error)));
    });

    request.write(manifest, 'utf8');
    request.end();
  });
}

/** Builds the provider lease status endpoint URL */
function buildLeaseStatusUrl(providerUri: ProviderUri, lease: LeaseReference): string {
  const base = new URL(providerUri);
  base.pathname = `/lease/${String(lease.dseq)}/${lease.gseq}/${lease.oseq}/status`;
  return base.toString();
}

/** Normalises provider service status objects returned by the provider API */
function normaliseServices(
  rawServices: Record<string, unknown> | undefined
): Readonly<Record<string, ProviderServiceStatus>> {
  if (!rawServices) {
    return {};
  }

  const entries: Array<[string, ProviderServiceStatus]> = [];

  for (const [name, raw] of Object.entries(rawServices)) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }

    const record = raw as Record<string, unknown>;

    const available = normaliseNumber(record.available ?? record.available_replicas, 0);
    const total = normaliseNumber(record.total ?? record.replicas, 0);
    const ready = normaliseNumber(record.ready_replicas, available);

    const uris = Array.isArray(record.uris)
      ? record.uris.filter((uri): uri is string => typeof uri === 'string')
      : [];

    entries.push([
      name,
      {
        name,
        available,
        total,
        ready,
        uris,
      },
    ]);
  }

  return Object.freeze(Object.fromEntries(entries));
}

/** Normalises forwarded ports section of provider response */
function normaliseForwardedPorts(
  raw: Record<string, unknown> | undefined
): Readonly<Record<string, readonly ProviderForwardedPort[]>> | undefined {
  if (!raw) {
    return undefined;
  }

  const entries: Array<[string, readonly ProviderForwardedPort[]]> = [];

  for (const [service, value] of Object.entries(raw)) {
    if (!Array.isArray(value)) {
      continue;
    }

    const ports = value
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const record = item as Record<string, unknown>;
        const port = normaliseNumber(record.port, 0);
        const externalPort = normaliseNumber(record.externalPort, port);
        const host = typeof record.host === 'string' ? record.host : '';
        const available = normaliseNumber(record.available, 0);

        if (!host) {
          return null;
        }

        return {
          port,
          externalPort,
          host,
          available,
        } satisfies ProviderForwardedPort;
      })
      .filter((value): value is ProviderForwardedPort => value !== null);

    if (ports.length > 0) {
      entries.push([service, Object.freeze(ports)]);
    }
  }

  return entries.length > 0 ? Object.freeze(Object.fromEntries(entries)) : undefined;
}

/** Normalises assigned IPs section of provider response */
function normaliseAssignedIps(
  raw: Record<string, unknown> | undefined
): Readonly<Record<string, readonly ProviderAssignedIp[]>> | undefined {
  if (!raw) {
    return undefined;
  }

  const entries: Array<[string, readonly ProviderAssignedIp[]]> = [];

  for (const [service, value] of Object.entries(raw)) {
    if (!Array.isArray(value)) {
      continue;
    }

    const ips = value
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const record = item as Record<string, unknown>;
        const ip = typeof record.IP === 'string' ? record.IP : undefined;
        if (!ip) {
          return null;
        }

        return {
          ip,
          port: normaliseNumber(record.Port, 0),
          externalPort: normaliseNumber(record.ExternalPort, 0),
          protocol: typeof record.Protocol === 'string' ? record.Protocol : 'TCP',
        } satisfies ProviderAssignedIp;
      })
      .filter((value): value is ProviderAssignedIp => value !== null);

    if (ips.length > 0) {
      entries.push([service, Object.freeze(ips)]);
    }
  }

  return entries.length > 0 ? Object.freeze(Object.fromEntries(entries)) : undefined;
}

/** Converts various number representations into a safe integer with fallback */
function normaliseNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

/**
 * Queries the provider status endpoint for container readiness information
 *
 * @param options - Provider status request configuration
 * @returns Result containing normalised provider status data
 */
export async function fetchProviderLeaseStatus(
  options: ProviderStatusOptions
): Promise<Result<ProviderLeaseStatus, ProviderError>> {
  const { providerUri, lease, certificate, timeoutMs = 10_000 } = options;

  let normalised: ProviderUri;
  try {
    normalised = normaliseProviderUri(providerUri);
  } catch (error) {
    return failure(error as ProviderError);
  }

  const statusUrl = buildLeaseStatusUrl(normalised, lease);

  try {
    const response = await axios.get<unknown>(statusUrl, {
      httpsAgent: createMtlsAgent(certificate),
      timeout: timeoutMs,
      headers: { Accept: 'application/json' },
      transitional: { clarifyTimeoutError: true },
    });

    const data = response.data as Record<string, unknown> | undefined;

    const services = normaliseServices(data?.services as Record<string, unknown> | undefined);
    const forwardedPorts = normaliseForwardedPorts(
      data?.forwarded_ports as Record<string, unknown> | undefined
    );
    const assignedIps = normaliseAssignedIps(data?.ips as Record<string, unknown> | undefined);

    return success(
      Object.freeze({
        services,
        forwardedPorts,
        assignedIps,
      })
    );
  } catch (error) {
    // Axios wraps network errors into AxiosError, inspect to categorise
    if (axios.isAxiosError(error)) {
      return failure(handleAxiosError(error, normalised));
    }

    const errMsg = getErrorMessage(error);
    return failure(
      new ProviderError(
        `Failed to query provider status: ${errMsg}`,
        ProviderErrorCodes.PROVIDER_STATUS_ERROR,
        { providerUri: normalised, error: errMsg },
        true,
        'Retry in a few moments – providers may need time to start the deployment'
      )
    );
  }
}

/** Maps Axios errors to ProviderError instances with helpful context */
function handleAxiosError(error: AxiosError, providerUri: ProviderUri): ProviderError {
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    return providerUnreachableError(providerUri, error);
  }

  if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
    return new ProviderError(
      `Provider ${providerUri} did not respond in time`,
      ProviderErrorCodes.PROVIDER_TIMEOUT,
      { providerUri },
      true,
      'The provider may be busy. Consider retrying the request.'
    );
  }

  if (error.response) {
    const status = error.response.status;
    const body = typeof error.response.data === 'string'
      ? error.response.data
      : JSON.stringify(error.response.data);

    return new ProviderError(
      `Provider ${providerUri} returned ${status} when querying status`,
      ProviderErrorCodes.PROVIDER_STATUS_ERROR,
      { providerUri, statusCode: status, body },
      true,
      'Inspect the provider logs or retry with a different provider'
    );
  }

  return new ProviderError(
    `Unknown provider error: ${error.message}`,
    ProviderErrorCodes.PROVIDER_STATUS_ERROR,
    { providerUri },
    true,
    'Retry the request or choose another provider',
    'error',
    error
  );
}

// ========================================
// Section 2: Provider Metadata (Console API + Blockchain)
// ========================================

/**
 * Fetch ALL providers with metadata from Console API
 *
 * Fetches the complete list of providers from the Akash Console API in a single call.
 * Returns complete metadata including reliability metrics and geographic location.
 *
 * @param network - Akash network (mainnet/testnet)
 * @returns Result with map of provider address to provider info
 *
 * @example
 * ```typescript
 * const result = await fetchAllProviders('mainnet');
 * if (result.success) {
 *   console.log(`Loaded ${result.data.size} providers`);
 * }
 * ```
 */
export async function fetchAllProviders(
  network: AkashNetwork
): Promise<Result<Map<string, ProviderInfo>, DeploymentError>> {
  // TODO: Replace with custom blockchain indexer once available
  // The console.akash.network proxy blocks external access (HTTP 403), so this will fail.
  // When you build your own provider reliability tracker (see docs/building-provider-reliability-tracker.md),
  // replace this URL with your own indexer API endpoint:
  //   - Development: http://localhost:3000/api/providers
  //   - Production: https://your-indexer.example.com/api/providers
  // Your indexer should return the same ConsoleProviderResponse[] format.

  // Use console.akash.network which proxies the API
  // Note: This currently returns 403 Forbidden for external applications
  const apiBase =
    network === 'mainnet'
      ? 'https://console.akash.network/api-mainnet/v1'
      : 'https://console.akash.network/api-testnet/v1';

  try {
    const url = `${apiBase}/providers`;

    const response = await axios.get<ConsoleProviderResponse[]>(url, {
      timeout: 15_000,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'KADI deploy-ability (+https://github.com/kadi-build)'
      },
      transitional: { clarifyTimeoutError: true },
    });

    const providers = response.data;

    // Transform array to map for fast lookups
    const providerMap = new Map<string, ProviderInfo>();

    for (const data of providers) {
      // Build location if available
      const location: ProviderLocation | undefined =
        data.ipCountry && data.ipRegion
          ? {
              region: data.ipRegion,
              regionCode: data.ipRegionCode || '',
              country: data.ipCountry,
              countryCode: data.ipCountryCode || '',
              latitude: data.ipLat,
              longitude: data.ipLon,
            }
          : undefined;

      // Build reliability if available
      const reliability: ProviderReliability | undefined =
        typeof data.uptime1d === 'number' &&
        typeof data.uptime7d === 'number' &&
        typeof data.uptime30d === 'number'
          ? {
              uptime1d: data.uptime1d,
              uptime7d: data.uptime7d,
              uptime30d: data.uptime30d,
              isOnline: data.isOnline ?? true,
              lastCheckDate: data.lastCheckDate
                ? new Date(data.lastCheckDate)
                : undefined,
            }
          : undefined;

      // Transform to ProviderInfo
      const providerInfo: ProviderInfo = {
        owner: data.owner,
        hostUri: data.hostUri,
        name: data.name ?? undefined, // Convert null to undefined
        email: data.email,
        website: data.website,
        isAudited: data.isAudited,
        akashVersion: data.akashVersion,
        cosmosSdkVersion: data.cosmosSdkVersion,
        location,
        reliability,
      };

      providerMap.set(data.owner, providerInfo);
    }

    return success(providerMap);
  } catch (error) {
    // Map axios error information into a helpful message
    const errMsg = getErrorMessage(error);
    let statusCode: number | undefined;
    let detail: string = errMsg;
    if (axios.isAxiosError(error)) {
      statusCode = error.response?.status;
      if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
        detail = `timeout after 15s`;
      } else if (statusCode) {
        detail = `HTTP ${statusCode}`;
      }
    }

    return failure(
      new DeploymentError(
        `Failed to fetch provider list: ${detail}`,
        'PROVIDER_LIST_FAILED',
        { error: errMsg, statusCode },
        true,
        'Could not fetch provider list from Console API'
      )
    );
  }
}

/**
 * Fetch provider information with enriched metadata
 *
 * Attempts to fetch complete provider information from the Akash Console API,
 * falling back to blockchain-only data if the API is unavailable.
 *
 * @deprecated Use fetchAllProviders() instead for better performance
 *
 * @param network - Akash network (mainnet/testnet)
 * @param providerAddress - Provider's blockchain address
 * @returns Result with complete provider information
 */
export async function fetchProviderInfo(
  network: AkashNetwork,
  providerAddress: string
): Promise<Result<ProviderInfo, DeploymentError>> {
  try {
    // Try Console API first for complete data
    const consoleResult = await fetchFromConsoleAPI(network, providerAddress);
    if (consoleResult.success) {
      return consoleResult;
    }

    // Fallback to blockchain query
    const blockchainResult = await fetchFromBlockchain(network, providerAddress);
    return blockchainResult;
  } catch (error) {
    const errMsg = getErrorMessage(error);
    return failure(
      new DeploymentError(
        `Failed to fetch provider info for ${providerAddress}: ${errMsg}`,
        'PROVIDER_INFO_FAILED',
        { providerAddress, error: errMsg },
        true,
        'Provider metadata fetch failed, but deployment can continue with limited information'
      )
    );
  }
}

/**
 * Fetch multiple providers in batch for efficiency
 *
 * Fetches provider information for multiple providers in parallel. Failed fetches return
 * minimal provider info. Never fails entirely - partial data is acceptable.
 *
 * @param network - Akash network (mainnet/testnet)
 * @param providerAddresses - Array of provider addresses to fetch
 * @returns Result with map of provider address to provider info
 */
export async function fetchProviderInfoBatch(
  network: AkashNetwork,
  providerAddresses: string[]
): Promise<Result<Map<string, ProviderInfo>, DeploymentError>> {
  try {
    // Fetch all providers in parallel
    const results = await Promise.allSettled(
      providerAddresses.map((address) => fetchProviderInfo(network, address))
    );

    // Build map of successful fetches
    const providerMap = new Map<string, ProviderInfo>();

    for (let i = 0; i < providerAddresses.length; i++) {
      const address = providerAddresses[i]!;
      const result = results[i]!;

      if (result.status === 'fulfilled' && result.value.success) {
        providerMap.set(address, result.value.data);
      } else {
        // For failed fetches, create minimal provider info
        // This ensures we always have at least basic data
        providerMap.set(address, {
          owner: address,
          hostUri: '', // Will be populated from bid data later
          isAudited: false,
        });
      }
    }

    return success(providerMap);
  } catch (error) {
    const errMsg = getErrorMessage(error);
    return failure(
      new DeploymentError(
        `Failed to fetch provider batch: ${errMsg}`,
        'PROVIDER_BATCH_FAILED',
        { providerAddresses, error: errMsg },
        true,
        'Batch provider fetch failed, deployment can continue with limited information'
      )
    );
  }
}

/** Fetch provider data from Akash Console API (internal helper) */
async function fetchFromConsoleAPI(
  network: AkashNetwork,
  providerAddress: string
): Promise<Result<ProviderInfo, DeploymentError>> {
  // TODO: Replace with custom blockchain indexer once available
  // See fetchAllProviders() for details on setting up your own indexer API.

  // Use console.akash.network which proxies the API
  // Note: This currently returns 403 Forbidden for external applications
  const apiBase =
    network === 'mainnet'
      ? 'https://console.akash.network/api-mainnet/v1'
      : 'https://console.akash.network/api-testnet/v1';

  try {
    const url = `${apiBase}/providers/${providerAddress}`;

    const response = await axios.get<ConsoleProviderResponse>(url, {
      timeout: 10_000,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'KADI deploy-ability (+https://github.com/kadi-build)'
      },
      transitional: { clarifyTimeoutError: true },
    });

    const data = response.data;

    // Build location if available
    const location: ProviderLocation | undefined =
      data.ipCountry && data.ipRegion
        ? {
            region: data.ipRegion,
            regionCode: data.ipRegionCode || '',
            country: data.ipCountry,
            countryCode: data.ipCountryCode || '',
            latitude: data.ipLat,
            longitude: data.ipLon,
          }
        : undefined;

    // Build reliability if available
    const reliability: ProviderReliability | undefined =
      typeof data.uptime1d === 'number' &&
      typeof data.uptime7d === 'number' &&
      typeof data.uptime30d === 'number'
        ? {
            uptime1d: data.uptime1d,
            uptime7d: data.uptime7d,
            uptime30d: data.uptime30d,
            isOnline: data.isOnline ?? true,
            lastCheckDate: data.lastCheckDate
              ? new Date(data.lastCheckDate)
              : undefined,
          }
        : undefined;

    // Transform Console API response to ProviderInfo
    const providerInfo: ProviderInfo = {
      owner: data.owner,
      hostUri: data.hostUri,
      name: data.name ?? undefined, // Convert null to undefined
      email: data.email,
      website: data.website,
      isAudited: data.isAudited,
      akashVersion: data.akashVersion,
      cosmosSdkVersion: data.cosmosSdkVersion,
      location,
      reliability,
    };

    return success(providerInfo);
  } catch (error) {
    // Map axios error information into a helpful message
    const errMsg = getErrorMessage(error);
    let statusCode: number | undefined;
    let detail: string = errMsg;
    if (axios.isAxiosError(error)) {
      statusCode = error.response?.status;
      if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
        detail = `timeout after 10s`;
      } else if (statusCode) {
        detail = `HTTP ${statusCode}`;
      }
    }

    return failure(
      new DeploymentError(
        `Console API fetch failed: ${detail}`,
        'CONSOLE_API_ERROR',
        { providerAddress, statusCode, error: errMsg },
        true,
        'Will fallback to blockchain query'
      )
    );
  }
}

/**
 * Fetch provider data directly from blockchain (internal helper)
 *
 * Fallback when Console API is unavailable. Returns basic provider data without
 * reliability metrics, location information, or version data.
 */
async function fetchFromBlockchain(
  network: AkashNetwork,
  providerAddress: string
): Promise<Result<ProviderInfo, DeploymentError>> {
  // Create temporary client for read-only query
  const client = new AkashClient({ network });

  try {
    // Query provider metadata from blockchain
    const result = await client.getProvider(providerAddress);

    if (!result.success) {
      return failure(
        new DeploymentError(
          result.error.message,
          result.error.code,
          result.error.context,
          result.error.recoverable,
          result.error.suggestion
        )
      );
    }

    // After success check, data is guaranteed to exist
    const metadata = result.data!;

    // Check if provider is audited based on attributes
    // Audited providers typically have an "audited-by" attribute
    const isAudited = metadata.attributes.some(
      (attr: { key: string; value: string }) => attr.key === 'audited-by'
    );

    // Construct minimal provider info from blockchain data
    const providerInfo: ProviderInfo = {
      owner: providerAddress,
      hostUri: metadata.hostUri || '',
      isAudited,
      // No reliability, location, or version data from blockchain alone
    };

    // Cleanup client connection
    await client.disconnect();

    return success(providerInfo);
  } catch (error) {
    // Cleanup client connection on error
    await client.disconnect();

    const errMsg = getErrorMessage(error);
    return failure(
      new DeploymentError(
        `Blockchain query failed: ${errMsg}`,
        'BLOCKCHAIN_QUERY_ERROR',
        { providerAddress, error: errMsg },
        true,
        'Unable to fetch provider info from any source'
      )
    );
  }
}
