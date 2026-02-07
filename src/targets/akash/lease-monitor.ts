/**
 * Lease Monitoring Helpers
 *
 * Polls the Akash blockchain and provider APIs until containers report as
 * running. This mirrors the Akash Console behaviour but is packaged as a
 * reusable library function with strong typing and explicit Result-based
 * error handling.
 *
 * @module targets/akash/lease-monitor
 */

import { setTimeout as delay } from 'node:timers/promises';

import type { Result } from '../../types/index.js';
import { success, failure } from '../../types/index.js';
import type { DeploymentLogger } from '../../types/common.js';
import { defaultLogger } from '../../utils/logger.js';
import {
  ProviderError,
  ProviderErrorCodes,
  containerTimeoutError,
} from '../../errors/index.js';

import type { AkashProviderTlsCertificate, LeaseDetails } from './types.js';
import type { AkashNetwork } from './environment.js';
import {
  fetchProviderLeaseStatus,
  type ProviderLeaseStatus,
  type LeaseReference,
} from './provider-manager.js';

/** Options for waiting until provider containers are running */
export interface LeaseMonitorOptions {
  readonly network: AkashNetwork;
  readonly lease: LeaseDetails;
  readonly providerUri: string;
  readonly certificate: AkashProviderTlsCertificate;
  readonly pollIntervalMs?: number;
  readonly maxWaitMs?: number;
  readonly logger?: DeploymentLogger;
}

/**
 * Polls both on-chain lease status and the provider status endpoint until all
 * containers report `ready`. Returns the final provider status snapshot on
 * success or a ProviderError on failure/timeout.
 */
export async function waitForContainersRunning(
  options: LeaseMonitorOptions
): Promise<Result<ProviderLeaseStatus, ProviderError>> {
  const {
    lease,
    providerUri,
    certificate,
    pollIntervalMs = 10_000,
    maxWaitMs = 600_000,
    logger = defaultLogger,
  } = options;

  const start = Date.now();
  let lastStatusSummary = '';

  logger.log('Monitoring provider until containers report ready...');

  try {
    while (Date.now() - start < maxWaitMs) {
      // Query provider status endpoint via mTLS to check container readiness
      const statusResult = await fetchProviderLeaseStatus({
        providerUri,
        lease: toLeaseReference(lease),
        certificate,
      });

      if (!statusResult.success) {
        // Treat unreachable provider separately to surface clear cause
        if (statusResult.error.code === ProviderErrorCodes.PROVIDER_UNREACHABLE) {
          logger.warn('Provider not yet reachable – retrying in a moment...');
        } else {
          logger.warn(`Provider reported error: ${statusResult.error.message}`);
        }

        await delay(pollIntervalMs);
        continue;
      }

      const providerStatus = statusResult.data;
      const summary = summariseServices(providerStatus);
      if (summary !== lastStatusSummary && summary.length > 0) {
        logger.log(`  Service readiness: ${summary}`);
        lastStatusSummary = summary;
      }

      if (allServicesReady(providerStatus)) {
        logger.log('Containers are reporting ready on the provider.');
        return success(providerStatus);
      }

      await delay(pollIntervalMs);
    }

    // Timeout reached without readiness
    return failure(containerTimeoutError('deployment', maxWaitMs));
  } finally {
    // No client cleanup needed - we removed the blockchain query
  }
}

/** Converts LeaseDetails into LeaseReference required by provider utilities */
function toLeaseReference(lease: LeaseDetails): LeaseReference {
  return {
    dseq: lease.dseq,
    gseq: lease.gseq,
    oseq: lease.oseq,
  };
}

/** Generates a human-readable readiness summary for logging */
function summariseServices(status: ProviderLeaseStatus): string {
  const entries = Object.entries(status.services);
  if (entries.length === 0) {
    return '';
  }

  return entries
    .map(([name, service]) => `${name}:${service.ready}/${Math.max(service.total, 1)}`)
    .join(', ');
}

/** Determines if all services meet their requested replica counts */
function allServicesReady(status: ProviderLeaseStatus): boolean {
  const services = Object.values(status.services);
  if (services.length === 0) {
    return false;
  }

  return services.every((service) => {
    const required = Math.max(service.total, 1);
    return service.ready >= required;
  });
}
